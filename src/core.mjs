// flowtopo core — pure numeric 3D vector-field analysis.
// No three.js, no DOM, no I/O, no environment access. Everything below is a pure
// function of its arguments so node and the browser compute identical numbers.
//
// All tolerances are RELATIVE to the field's box diagonal (see boxDiag). There is
// no absolute epsilon anywhere; rescaling the box and the field together rescales
// every result by the same factor (verified in bench/verify.mjs).

const TAU = Math.PI * 2;

export function boxDiag(box) {
  const d = [box[1][0] - box[0][0], box[1][1] - box[0][1], box[1][2] - box[0][2]];
  return Math.hypot(d[0], d[1], d[2]);
}
export function boxCenter(box) {
  return [(box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, (box[0][2] + box[1][2]) / 2];
}

export function makeBox(min, max) { return [min.slice(), max.slice()]; }

// ---------------------------------------------------------------------------
// Fields. Each field is a plain object: { name, box, eval(p) -> [u,v,w] }.
// `eval` is a pure arithmetic expression, so importing this module has no side
// effects. The critical points listed in `analytic` are derived by hand from the
// closed form (not from the numeric solver below) and are the independent oracle.
// ---------------------------------------------------------------------------

const SIN_OFF = [0.37, 0.41, 0.29];
export const SIN_LATTICE = {
  name: "sin-lattice",
  box: makeBox([0, 0, 0], [TAU, TAU, TAU]),
  eval(p) {
    return [Math.sin(p[0] - SIN_OFF[0]), Math.sin(p[1] - SIN_OFF[1]), Math.sin(p[2] - SIN_OFF[2])];
  },
  // hand-derived: sin(x-a)=0 -> x = a + k*pi; 8 points inside [0,2pi]^3;
  // Jacobian is diag(cos(x-a),...) = +/-1, so every eigenvalue is exactly +/-1.
  analytic: (() => {
    const out = [];
    for (let kx = 0; kx < 2; kx++) for (let ky = 0; ky < 2; ky++) for (let kz = 0; kz < 2; kz++) {
      const p = [SIN_OFF[0] + kx * Math.PI, SIN_OFF[1] + ky * Math.PI, SIN_OFF[2] + kz * Math.PI];
      const s = [Math.cos(p[0] - SIN_OFF[0]), Math.cos(p[1] - SIN_OFF[1]), Math.cos(p[2] - SIN_OFF[2])];
      const neg = s.filter((v) => v < 0).length;
      out.push({ p, eigenvalues: s, type: neg === 3 ? "sink" : neg === 0 ? "source" : `saddle-${neg}` });
    }
    return out;
  })(),
};

export const QUADRATIC = {
  name: "quadratic",
  box: makeBox([-1.5, -1.5, -1.5], [2.5, 2.5, 2.5]),
  eval(p) { return [p[0] * p[0] - p[1], p[1] * p[1] - p[2], p[2] * p[2] - p[0]]; },
  // hand-derived: x^2=y, y^2=z, z^2=x -> x = x^8 -> x in {0,1}; both inside the box.
  analytic: [
    { p: [0, 0, 0], eigenvalues: [-1, [0.5, Math.sqrt(3) / 2]], type: "saddle-focus" },
    { p: [1, 1, 1], eigenvalues: [1, [2.5, Math.sqrt(3) / 2]], type: "spiral-source" },
  ],
};

const ABC = [1, 1, 1];
export const ABC_FLOW = {
  name: "abc",
  box: makeBox([0, 0, 0], [TAU, TAU, TAU]),
  eval(p) {
    const [x, y, z] = p;
    return [
      ABC[0] * Math.sin(z) + ABC[2] * Math.cos(y),
      ABC[1] * Math.sin(x) + ABC[2] * Math.cos(z),
      ABC[2] * Math.sin(y) + ABC[0] * Math.cos(x),
    ];
  },
  // ABC is incompressible: div = 0 identically. No analytic critical-point list is
  // claimed (its zeros have no compact closed form); only the divergence oracle is used.
  analytic: null,
  divergenceFree: true,
};

// Degenerate zero: every component touches zero without changing sign. A grid
// sign-change scan cannot see it; the damped Newton solver can. This is the
// documented hard case for the baseline, not the corpus the main claims use.
export const TANGENTIAL = {
  name: "tangential",
  box: makeBox([0, 0, 0], [2, 2, 2]),
  eval(p) { return [(p[0] - 1) ** 2, (p[1] - 1) ** 2, (p[2] - 1) ** 2]; },
  analytic: [{ p: [1, 1, 1], eigenvalues: [0, 0, 0], type: "degenerate" }],
};

export const FIELDS = { "sin-lattice": SIN_LATTICE, quadratic: QUADRATIC, abc: ABC_FLOW, tangential: TANGENTIAL };

// ---------------------------------------------------------------------------
// Linear algebra
// ---------------------------------------------------------------------------
export function jacobian(field, p, epsRel = 1e-6) {
  const h = epsRel * boxDiag(field.box);
  const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let j = 0; j < 3; j++) {
    const a = p.slice(), b = p.slice();
    a[j] += h; b[j] -= h;
    const fa = field.eval(a), fb = field.eval(b);
    for (let i = 0; i < 3; i++) J[i][j] = (fa[i] - fb[i]) / (2 * h);
  }
  return J;
}

export function solve3(A, b) {
  // Gaussian elimination with partial pivoting on a 3x3 system.
  const M = [[A[0][0], A[0][1], A[0][2], b[0]], [A[1][0], A[1][1], A[1][2], b[1]], [A[2][0], A[2][1], A[2][2], b[2]]];
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-300) return null;
    if (piv !== c) { const t = M[c]; M[c] = M[piv]; M[piv] = t; }
    for (let r = c + 1; r < 3; r++) {
      const k = M[r][c] / M[c][c];
      for (let q = c; q < 4; q++) M[r][q] -= k * M[c][q];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = M[r][3];
    for (let c = r + 1; c < 3; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

// Eigenvalues of a real 3x3 matrix: characteristic cubic + trigonometric solve.
// Returns { real: [..3] } or { real: [r], complex: [re, im] } (conjugate pair).
export function eig3(J) {
  const c2 = J[0][0] + J[1][1] + J[2][2];
  const c1 = (J[0][0] * J[1][1] - J[0][1] * J[1][0]) + (J[0][0] * J[2][2] - J[0][2] * J[2][0]) + (J[1][1] * J[2][2] - J[1][2] * J[2][1]);
  const c0 = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1]) - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0]) + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
  const P = (l) => ((l - c2) * l + c1) * l - c0;
  const dP = (l) => (3 * l - 2 * c2) * l + c1;
  const R = 1 + Math.max(Math.abs(c2), Math.abs(c1), Math.abs(c0));
  let lo = -R, hi = R;
  for (let i = 0; i < 120; i++) {
    const mid = (lo + hi) / 2;
    if (P(mid) > 0) hi = mid; else lo = mid;
  }
  let r = (lo + hi) / 2;
  // Bisection cannot resolve repeated roots (the polynomial is flat to rounding);
  // Newton on the cubic does, because it uses the derivative and not the sign.
  for (let i = 0; i < 80; i++) {
    const d = dP(r);
    if (!Number.isFinite(d) || Math.abs(d) < 1e-300) break;
    const step = P(r) / d;
    r -= step;
    if (Math.abs(step) <= 1e-16 * R) break;
  }
  const a = r - c2;              // deflated quadratic: lambda^2 + a lambda + b
  const b = c1 + a * r;
  const disc = a * a - 4 * b;
  const scale = Math.max(Math.abs(r), Math.sqrt(Math.abs(b)), 1e-300);
  const tol = 1e-10 * scale * scale;
  if (disc >= -tol) {
    const sq = Math.sqrt(Math.max(0, disc));
    return { real: [r, (-a + sq) / 2, (-a - sq) / 2].sort((x, y) => x - y) };
  }
  return { real: [r], complex: [-a / 2, Math.sqrt(-disc) / 2] };
}

export const EIG_TOL = 1e-8; // relative to the largest |eigenvalue| of the same matrix

export const PAIR_TOL = 1e-4; // relative: imaginary parts this small are reported as real

export function classify(ev, jscale = 1) {
  // Zero tolerance is relative to the Jacobian magnitude over the whole box, not to
  // the eigenvalues themselves: all-zero spectra would otherwise call themselves sinks.
  const zero = EIG_TOL * Math.max(jscale, 1e-300);
  if (ev.complex) {
    const [re, im] = ev.complex;
    if (Math.abs(im) <= PAIR_TOL * Math.max(Math.abs(re), Math.abs(ev.real[0]), 1e-300)) {
      return classify({ real: [ev.real[0], re, re] }, jscale);
    }
    const reZ = Math.abs(re) <= zero;
    const reNeg = re < -zero, rePos = re > zero;
    const real = ev.real[0];
    if (reZ && Math.abs(real) <= zero) return "center";
    if (reZ) return real > 0 ? "saddle-center" : "saddle-center";
    if (reNeg && real < -zero) return "spiral-sink";
    if (rePos && real > zero) return "spiral-source";
    if (rePos && real < -zero) return "saddle-focus";
    if (reNeg && real > zero) return "saddle-focus";
    return "degenerate";
  }
  const r = ev.real;
  const neg = r.filter((v) => v < -zero).length;
  const pos = r.filter((v) => v > zero).length;
  if (neg + pos < 3) return "degenerate";
  if (neg === 3) return "sink";
  if (pos === 3) return "source";
  return `saddle-${neg}`;
}

export function eigenvector(J, lambda) {
  // null vector of (J - lambda I): cross product of the two best-conditioned rows.
  const R = [
    [J[0][0] - lambda, J[0][1], J[0][2]],
    [J[1][0], J[1][1] - lambda, J[1][2]],
    [J[2][0], J[2][1], J[2][2] - lambda],
  ];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const pairs = [[0, 1], [0, 2], [1, 2]];
  let best = null, bestN = -1;
  for (const [i, j] of pairs) {
    const v = cross(R[i], R[j]);
    const n = Math.hypot(v[0], v[1], v[2]);
    if (n > bestN) { bestN = n; best = v; }
  }
  if (bestN < 1e-300) return [0, 0, 0];
  return best.map((v) => v / bestN);
}

// ---------------------------------------------------------------------------
// Newton critical-point search. Tolerances are relative to the box diagonal.
// ---------------------------------------------------------------------------
export function fieldScale(field) {
  // Characteristic |F| on the box corners, used to make the residual test relative.
  let m = 0;
  const [a, b] = field.box;
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) {
    const v = field.eval([x, y, z]);
    m = Math.max(m, Math.hypot(v[0], v[1], v[2]));
  }
  return Math.max(m, 1e-12);
}

export function jacobianScale(field) {
  const [a, b] = field.box;
  let m = 0;
  for (const x of [a[0], b[0]]) for (const y of [a[1], b[1]]) for (const z of [a[2], b[2]]) {
    const J = jacobian(field, [x, y, z]);
    m = Math.max(m, Math.hypot(J[0][0], J[0][1], J[0][2], J[1][0], J[1][1], J[1][2], J[2][0], J[2][1], J[2][2]));
  }
  return Math.max(m, 1e-12);
}

export function newton(field, seed, opts = {}) {
  const diag = boxDiag(field.box);
  const tolX = (opts.tolX ?? 1e-13) * diag;
  const tolF = (opts.tolF ?? 1e-12) * fieldScale(field);
  const maxIt = opts.maxIt ?? 80;
  const epsRel = opts.epsRel ?? 1e-6;
  let p = seed.slice();
  let iters = 0, evals = 1;
  for (; iters < maxIt; iters++) {
    const F = field.eval(p); evals++;
    if (!F.every(Number.isFinite)) return { converged: false, p, iters, evals, residual: Infinity };
    const J = jacobian(field, p, epsRel); evals += 6;
    // Levenberg-style damped normal equations: robust when J is singular.
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], g = [0, 0, 0];
    let tr = 0;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) A[i][j] += J[k][i] * J[k][j];
      if (i === j) tr += A[i][j];
    }
    for (let i = 0; i < 3; i++) for (let k = 0; k < 3; k++) g[i] += J[k][i] * F[k];
    const mu = 1e-14 * Math.max(tr, 1e-300);
    for (let i = 0; i < 3; i++) A[i][i] += mu;
    const d = solve3(A, g.map((v) => -v));
    if (!d) return { converged: false, p, iters, evals, residual: Math.hypot(...F) };
    const step = Math.hypot(d[0], d[1], d[2]);
    for (let i = 0; i < 3; i++) p[i] += d[i];
    const [lo, hi] = field.box;
    for (let i = 0; i < 3; i++) {
      if (p[i] < lo[i] - 0.02 * (hi[i] - lo[i]) || p[i] > hi[i] + 0.02 * (hi[i] - lo[i])) {
        return { converged: false, p, iters, evals, residual: Infinity };
      }
    }
    const Fn = field.eval(p); evals++;
    const res = Math.hypot(Fn[0], Fn[1], Fn[2]);
    if (!Number.isFinite(res)) return { converged: false, p, iters, evals, residual: Infinity };
    if (step <= tolX && res <= tolF) return { converged: true, p, iters, evals, residual: res };
  }
  const F = field.eval(p); evals++;
  const res = Math.hypot(F[0], F[1], F[2]);
  return { converged: res <= tolF * 1e3, p, iters, evals, residual: res, exhausted: true };
}

export function findCriticalPoints(field, opts = {}) {
  const diag = boxDiag(field.box);
  const jscale = jacobianScale(field);
  const n = opts.seeds ?? 6;                 // n^3 uniform seeds
  const dedupe = (opts.dedupeRel ?? 1e-6) * diag;
  const [lo, hi] = field.box;
  const found = [];
  let evals = 0, runs = 0;
  const consider = (seed) => {
    runs++;
    const r = newton(field, seed, opts);
    evals += r.evals;
    if (!r.converged) return;
    for (const f of found) {
      if (Math.hypot(r.p[0] - f.p[0], r.p[1] - f.p[1], r.p[2] - f.p[2]) < dedupe) return;
    }
    const J = jacobian(field, r.p, opts.epsRel ?? 1e-6);
    const ev = eig3(J);
    found.push({ p: r.p, eigenvalues: ev, type: classify(ev, jscale), residual: r.residual, iters: r.iters });
  };
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    const seed = [
      lo[0] + ((i + 0.5) / n) * (hi[0] - lo[0]),
      lo[1] + ((j + 0.5) / n) * (hi[1] - lo[1]),
      lo[2] + ((k + 0.5) / n) * (hi[2] - lo[2]),
    ];
    consider(seed);
  }
  if (opts.randomSeeds) {
    let s = opts.randomSeed ?? 123456789;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < opts.randomSeeds; i++) {
      consider([lo[0] + rnd() * (hi[0] - lo[0]), lo[1] + rnd() * (hi[1] - lo[1]), lo[2] + rnd() * (hi[2] - lo[2])]);
    }
  }
  // deterministic order (lexicographic on rounded coordinates) for hashing
  found.sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1] || a.p[2] - b.p[2]);
  return { points: found, runs, evals };
}

// ---------------------------------------------------------------------------
// Integration and compressibility
// ---------------------------------------------------------------------------
export function divergence(field, p, epsRel = 1e-6) {
  const h = epsRel * boxDiag(field.box);
  let d = 0;
  for (let i = 0; i < 3; i++) {
    const a = p.slice(), b = p.slice();
    a[i] += h; b[i] -= h;
    d += (field.eval(a)[i] - field.eval(b)[i]) / (2 * h);
  }
  return d;
}

function rk4Step(field, p, h) {
  const k1 = field.eval(p);
  const p2 = [p[0] + h / 2 * k1[0], p[1] + h / 2 * k1[1], p[2] + h / 2 * k1[2]];
  const k2 = field.eval(p2);
  const p3 = [p[0] + h / 2 * k2[0], p[1] + h / 2 * k2[1], p[2] + h / 2 * k2[2]];
  const k3 = field.eval(p3);
  const p4 = [p[0] + h * k3[0], p[1] + h * k3[1], p[2] + h * k3[2]];
  const k4 = field.eval(p4);
  return [
    p[0] + (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]),
    p[1] + (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]),
    p[2] + (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]),
  ];
}
function eulerStep(field, p, h) {
  const k = field.eval(p);
  return [p[0] + h * k[0], p[1] + h * k[1], p[2] + h * k[2]];
}

export function traceStreamline(field, p0, opts = {}) {
  const diag = boxDiag(field.box);
  const h = (opts.hRel ?? 0.01) * diag * (opts.dir ?? 1);
  const steps = opts.steps ?? 200;
  const method = opts.method ?? "rk4";
  const [lo, hi] = field.box;
  const pts = [p0.slice()];
  let p = p0.slice(), escapes = 0, stepsDone = 0;
  for (let s = 0; s < steps; s++) {
    p = method === "euler" ? eulerStep(field, p, h) : rk4Step(field, p, h);
    if (!p.every(Number.isFinite)) break;
    pts.push(p.slice()); stepsDone++;
    let out = false;
    for (let i = 0; i < 3; i++) if (p[i] < lo[i] || p[i] > hi[i]) out = true;
    if (out) { escapes++; break; }
  }
  return { points: pts, steps: stepsDone, escaped: escapes > 0, method };
}

// Volume of a tiny tetrahedron advected for `steps` steps: divergence-free flows
// must preserve it. The initial edge length is relative to the box diagonal.
export function volumeDrift(field, p0, opts = {}) {
  const diag = boxDiag(field.box);
  const delta = (opts.deltaRel ?? 1e-4) * diag;
  const h = (opts.hRel ?? 0.01) * diag;
  const steps = opts.steps ?? 100;
  const method = opts.method ?? "rk4";
  const step = method === "euler" ? eulerStep : rk4Step;
  const pts = [p0.slice(), [p0[0] + delta, p0[1], p0[2]], [p0[0], p0[1] + delta, p0[2]], [p0[0], p0[1], p0[2] + delta]];
  for (let s = 0; s < steps; s++) for (let i = 0; i < 4; i++) pts[i] = step(field, pts[i], h);
  const v0 = Math.abs(det3(sub(pts[1], pts[0]), sub(pts[2], pts[0]), sub(pts[3], pts[0])));
  // reference volume: same tetrahedron in the initial frame
  const ref = Math.abs(det3([delta, 0, 0], [0, delta, 0], [0, 0, delta]));
  return { ratio: v0 / ref, drift: Math.abs(v0 / ref - 1), steps, method, hRel: opts.hRel ?? 0.01 };
}
// Volume drift of the *discrete* flow map, accumulated as a product of one-step
// Jacobian determinants. Each determinant uses a small relative probe length, so it
// stays well conditioned even when the advected tetrahedron would flatten.
export function discreteVolumeDrift(field, p0, opts = {}) {
  const diag = boxDiag(field.box);
  const h = (opts.hRel ?? 0.01) * diag;
  const d = (opts.deltaRel ?? 1e-4) * diag;
  const steps = opts.steps ?? 100;
  const step = (opts.method ?? "rk4") === "euler" ? eulerStep : rk4Step;
  const probe = [[d, 0, 0], [0, d, 0], [0, 0, d]];
  let p = p0.slice(), logDet = 0, maxLocal = 0;
  for (let s = 0; s < steps; s++) {
    const q0 = step(field, p, h);
    const e = probe.map((o) => step(field, [p[0] + o[0], p[1] + o[1], p[2] + o[2]], h));
    const det = det3(sub(e[0], q0), sub(e[1], q0), sub(e[2], q0)) / (d * d * d);
    if (!Number.isFinite(det) || det <= 0) return { drift: Infinity, steps: s, method: opts.method ?? "rk4", hRel: opts.hRel ?? 0.01 };
    logDet += Math.log(det);
    maxLocal = Math.max(maxLocal, Math.abs(det - 1));
    p = q0;
  }
  return { drift: Math.abs(Math.exp(logDet) - 1), maxLocal, steps, method: opts.method ?? "rk4", hRel: opts.hRel ?? 0.01 };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function det3(a, b, c) {
  return a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
}

// ---------------------------------------------------------------------------
// Sampling helpers: uniform vs topology-guided seeds, deterministic PRNG.
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function uniformSeeds(box, n, seed = 12345) {
  const rnd = mulberry32(seed);
  const [lo, hi] = box;
  return Array.from({ length: n }, () => [lo[0] + rnd() * (hi[0] - lo[0]), lo[1] + rnd() * (hi[1] - lo[1]), lo[2] + rnd() * (hi[2] - lo[2])]);
}
export function topologySeeds(field, points, perPoint = 3) {
  const diag = boxDiag(field.box), [lo, hi] = field.box;
  const out = [];
  for (const cp of points) {
    const ev = cp.eigenvalues;
    const dirs = [];
    for (const l of ev.real) dirs.push(eigenvector(jacobian(field, cp.p), l));
    if (ev.complex) {
      // real plane of the complex pair: two vectors spanning the plane (real/imag parts)
      const J = jacobian(field, cp.p);
      const v = eigenvector(J, ev.complex[0]);
      const w = [J[0][0] * v[0] + J[0][1] * v[1] + J[0][2] * v[2], J[1][0] * v[0] + J[1][1] * v[1] + J[1][2] * v[2], J[2][0] * v[0] + J[2][1] * v[1] + J[2][2] * v[2]];
      const nv = Math.hypot(...w) || 1;
      dirs.push(w.map((x) => x / nv));
    }
    const r = 0.06 * diag;
    for (const d of dirs.slice(0, perPoint)) for (const s of [1, -1]) {
      const q = [cp.p[0] + s * r * d[0], cp.p[1] + s * r * d[1], cp.p[2] + s * r * d[2]];
      if (q.every((v, i) => v >= lo[i] && v <= hi[i])) out.push(q);
    }
  }
  return out;
}

// How many of the analytic critical points does a set of traced streamlines pass
// within `radius` of? Sample along each polyline at every stored point.
export function captureCount(points, polylines, radius) {
  const cap = new Set();
  for (const line of polylines) for (const q of line.points) {
    points.forEach((cp, i) => {
      if (Math.hypot(q[0] - cp[0], q[1] - cp[1], q[2] - cp[2]) <= radius) cap.add(i);
    });
  }
  return cap.size;
}

// ---------------------------------------------------------------------------
// Discriminant / fingerprint helpers (deterministic, used for cross-endian checks)
// ---------------------------------------------------------------------------
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
export function fingerprint(points) {
  return fnv1a(points.map((p) => p.p.map((v) => v.toFixed(9)).join(",") + "|" + p.type).join(";"));
}
export function pointDistance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }