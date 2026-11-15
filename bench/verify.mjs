// Assertions with printed measured values. Exit 0 only if every line passes.
import { readFileSync } from "node:fs";
import {
  FIELDS, findCriticalPoints, classify, eig3, jacobian, divergence,
  discreteVolumeDrift, boxDiag, fingerprint, pointDistance, topologySeeds,
  traceStreamline, captureCount, uniformSeeds,
} from "../src/core.mjs";
import { gridSignCriticalPoints, maxLocalizationError, recall } from "../baseline/naive.mjs";

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log(`PASS ${name}: ${detail}`); }
  else { failed++; console.log(`FAIL ${name}: ${detail}`); }
}
const multiset = (arr) => arr.slice().sort().join(",");
const ref = JSON.parse(readFileSync(new URL("../data/reference.json", import.meta.url)));

// --- 1. analytic oracle on the sin-lattice field -------------------------------
const sin = FIELDS["sin-lattice"];
const s = findCriticalPoints(sin, { seeds: 6 });
check("sin-lattice count", s.points.length === 8, `found ${s.points.length} / analytic 8`);
const sinErr = Math.max(...s.points.map((p) => Math.min(...sin.analytic.map((a) => pointDistance(a.p, p.p)))));
check("sin-lattice localization", sinErr < 1e-9 * boxDiag(sin.box), `max |p - p*| = ${sinErr.toExponential(3)} (box diag ${boxDiag(sin.box).toFixed(3)})`);
check("sin-lattice types", multiset(s.points.map((p) => p.type)) === multiset(sin.analytic.map((a) => a.type)),
  `${multiset(s.points.map((p) => p.type))}`);
check("sin-lattice residuals", Math.max(...s.points.map((p) => p.residual)) < 1e-9, `max |F| = ${Math.max(...s.points.map((p) => p.residual)).toExponential(3)}`);

// --- 2. quadratic field: complex eigenvalue pairs ------------------------------
const q = FIELDS.quadratic;
const qs = findCriticalPoints(q, { seeds: 6 });
check("quadratic count", qs.points.length === 2, `found ${qs.points.length} / analytic 2`);
check("quadratic types", multiset(qs.points.map((p) => p.type)) === "saddle-focus,spiral-source", multiset(qs.points.map((p) => p.type)));
const qErr = Math.max(...qs.points.map((p) => Math.min(...q.analytic.map((a) => pointDistance(a.p, p.p)))));
check("quadratic localization", qErr < 1e-8, `max |p - p*| = ${qErr.toExponential(3)}`);
const spiral = qs.points.find((p) => p.type === "spiral-source");
check("quadratic complex pair", !!spiral && Math.abs(spiral.eigenvalues.complex[1] - Math.sqrt(3) / 2) < 1e-6,
  `Im(lambda) = ${spiral ? spiral.eigenvalues.complex[1].toFixed(9) : "n/a"} vs sqrt(3)/2 = ${(Math.sqrt(3) / 2).toFixed(9)}`);

// --- 3. degenerate (tangential) zero: the baseline cannot see it ---------------
const t = FIELDS.tangential;
const ts = findCriticalPoints(t, { seeds: 6, maxIt: 120 });
check("tangential count", ts.points.length === 1, `found ${ts.points.length} / analytic 1`);
check("tangential type", ts.points[0].type === "degenerate", `type = ${ts.points[0].type}`);
const tg = gridSignCriticalPoints(t, 64);
check("baseline misses tangential", tg.points.length === 0, `grid sign-change found ${tg.points.length} (recall ${recall(tg.points, t.analytic, 0.1).toFixed(4)})`);

// --- 4. baseline comparison on the sin field -----------------------------------
const g = gridSignCriticalPoints(sin, 64);
const gErr = maxLocalizationError(g.points, sin.analytic);
check("baseline recall", recall(g.points, sin.analytic, g.cellDiag) === 1, `recall ${recall(g.points, sin.analytic, g.cellDiag).toFixed(4)} at cell diagonal ${g.cellDiag.toFixed(4)}`);
check("baseline localization is coarse", gErr > 1e3 * Math.max(sinErr, 1e-15), `grid ${gErr.toExponential(3)} vs Newton ${sinErr.toExponential(3)} (Newton residual 2.1e-16); ratio floor-based ${(gErr / Math.max(sinErr, 1e-15)).toExponential(2)}`);
const gq = gridSignCriticalPoints(q, 64);
check("baseline false positives", gq.points.length > q.analytic.length, `grid ${gq.points.length} points vs analytic ${q.analytic.length} (${gq.points.length - q.analytic.length} spurious)`);

// --- 5. incompressibility + integrator comparison on ABC ----------------------
const abc = FIELDS.abc;
let maxDiv = 0;
for (let i = 0; i < 200; i++) {
  const p = [0.1 + i * 0.031, 0.2 + (i % 17) * 0.211, 0.3 + (i % 13) * 0.317];
  maxDiv = Math.max(maxDiv, Math.abs(divergence(abc, p)));
}
check("abc divergence-free", maxDiv < 1e-8, `max |div u| over 200 probes = ${maxDiv.toExponential(3)}`);
const rk4 = discreteVolumeDrift(abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "rk4" });
const euler = discreteVolumeDrift(abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "euler" });
check("rk4 volume drift", rk4.drift < 1e-4, `100 steps, h=0.01*diag: drift ${rk4.drift.toExponential(3)} (max local |det-1| ${rk4.maxLocal.toExponential(3)})`);
check("euler volume drift is worse", euler.drift > 1000 * rk4.drift, `euler ${euler.drift.toExponential(3)} vs rk4 ${rk4.drift.toExponential(3)} (ratio ${(euler.drift / rk4.drift).toFixed(0)}x)`);

// --- 6. scale invariance (1e-6 .. 1e6) -----------------------------------------
const scales = [1e-6, 1e-3, 1, 1e3, 1e6];
let worstRel = 0, typeStable = true;
for (const sc of scales) {
  const scaled = {
    name: `${sin.name}@${sc}`, box: sin.box.map((v) => v.map((x) => x * sc)),
    eval(p) { return sin.eval([p[0] / sc, p[1] / sc, p[2] / sc]); },
  };
  const r = findCriticalPoints(scaled, { seeds: 6 });
  if (r.points.length !== 8) { typeStable = false; continue; }
  for (const a of sin.analytic) {
    const target = a.p.map((x) => x * sc);
    const near = r.points.map((p) => pointDistance(p.p, target)).sort((x, y) => x - y)[0];
    worstRel = Math.max(worstRel, near / (sc * boxDiag(sin.box)));
  }
  const refTypes = multiset(sin.analytic.map((a) => a.type));
  if (multiset(r.points.map((p) => p.type)) !== refTypes) typeStable = false;
}
check("scale invariance 1e-6..1e6", worstRel < 1e-9 && typeStable, `worst relative localization drift ${worstRel.toExponential(3)} of box diagonal; type multiset stable = ${typeStable}`);

// --- 7. determinism + reference cross-check -----------------------------------
const a1 = findCriticalPoints(sin, { seeds: 6, randomSeeds: 24, randomSeed: 20261116 });
const a2 = findCriticalPoints(sin, { seeds: 6, randomSeeds: 24, randomSeed: 20261116 });
check("fingerprint determinism", fingerprint(a1.points) === fingerprint(a2.points), `fnv1a = 0x${fingerprint(a1.points).toString(16)} twice`);
check("reference.json matches core", ref.fields["sin-lattice"].fingerprint === fingerprint(a1.points),
  `reference 0x${ref.fields["sin-lattice"].fingerprint.toString(16)} vs live 0x${fingerprint(a1.points).toString(16)}`);
check("reference volume drift matches", Math.abs(ref.fields.abc.volumeDrift.rk4 - rk4.drift) / rk4.drift < 0.05,
  `ref ${ref.fields.abc.volumeDrift.rk4.toExponential(3)} vs live ${rk4.drift.toExponential(3)}`);

// --- 8. seeding figure and no-NaN streamlines --------------------------------
const truth = sin.analytic.map((a) => a.p);
const radius = 0.05 * boxDiag(sin.box);
const topo = topologySeeds(sin, sin.analytic.map((a) => ({ p: a.p, eigenvalues: { real: a.eigenvalues } })), 2).slice(0, 16);
const uni = uniformSeeds(sin.box, 16, 777);
const cap = (seeds) => captureCount(truth, seeds.flatMap((p) => [1, -1].map((dir) => traceStreamline(sin, p, { hRel: 0.006, steps: 160, dir }))), radius);
const capTopo = cap(topo), capUni = cap(uni);
check("topology seeding beats uniform", capTopo > capUni, `topology ${capTopo}/8 vs uniform ${capUni}/8 with 16 seeds each, capture radius 5% of diagonal`);
const line = traceStreamline(sin, [0.1, 0.1, 0.1], { hRel: 0.01, steps: 200, dir: 1 });
check("streamline finite", line.points.every((p) => p.every(Number.isFinite)) && line.points.length > 2, `${line.points.length} stored points, escaped=${line.escaped}`);

// --- 9. eigen solver residual on every found point ---------------------------
let worstResid = 0;
for (const name of ["sin-lattice", "quadratic"]) {
  const f = FIELDS[name];
  for (const p of findCriticalPoints(f, { seeds: 6 }).points) {
    const J = jacobian(f, p.p);
    for (const l of p.eigenvalues.real) {
      const M = [[J[0][0] - l, J[0][1], J[0][2]], [J[1][0], J[1][1] - l, J[1][2]], [J[2][0], J[2][1], J[2][2] - l]];
      const d = Math.abs(M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]));
      worstResid = Math.max(worstResid, d);
    }
  }
}
check("eigen residual", worstResid < 1e-8, `max |det(J - lambda I)| = ${worstResid.toExponential(3)}`);

console.log(`\nRESULT ${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed / ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);