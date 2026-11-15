// Baseline: textbook grid sign-change critical-point finder.
// For every cell of an n^3 lattice it tests whether each velocity component takes
// both signs on the 8 corners. Detections are cell centroids, deduplicated at one
// cell diagonal. No Newton refinement, no Jacobian, therefore no classification.
import { boxDiag } from "../src/core.mjs";

export function gridSignCriticalPoints(field, n) {
  const [lo, hi] = field.box;
  const step = [(hi[0] - lo[0]) / n, (hi[1] - lo[1]) / n, (hi[2] - lo[2]) / n];
  const val = (i, j, k) => field.eval([lo[0] + i * step[0], lo[1] + j * step[1], lo[2] + k * step[2]]);
  const out = [];
  const cellDiag = Math.hypot(step[0], step[1], step[2]);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) for (let k = 0; k < n; k++) {
    let flip = [true, true, true];
    const corners = [];
    for (const di of [0, 1]) for (const dj of [0, 1]) for (const dk of [0, 1]) corners.push(val(i + di, j + dj, k + dk));
    for (let c = 0; c < 3; c++) {
      let mn = Infinity, mx = -Infinity;
      for (const v of corners) { mn = Math.min(mn, v[c]); mx = Math.max(mx, v[c]); }
      flip[c] = mn < 0 && mx > 0;
    }
    if (!flip.every(Boolean)) continue;
    const p = [lo[0] + (i + 0.5) * step[0], lo[1] + (j + 0.5) * step[1], lo[2] + (k + 0.5) * step[2]];
    if (out.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < cellDiag * 1.01)) continue;
    out.push(p);
  }
  return { points: out, cells: n * n * n, cellDiag };
}

export function maxLocalizationError(found, analytic) {
  let worst = 0;
  for (const p of found) {
    let best = Infinity;
    for (const a of analytic) best = Math.min(best, Math.hypot(p[0] - a.p[0], p[1] - a.p[1], p[2] - a.p[2]));
    worst = Math.max(worst, best);
  }
  return worst;
}

export function recall(found, analytic, tol) {
  let hit = 0;
  for (const a of analytic) if (found.some((p) => Math.hypot(p[0] - a.p[0], p[1] - a.p[1], p[2] - a.p[2]) <= tol)) hit++;
  return analytic.length ? hit / analytic.length : 1;
}

export { boxDiag };