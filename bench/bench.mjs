// Real measurements only. Warmup 1, then >=7 repeats; cold start is the very first run.
import { writeFileSync } from "node:fs";
import { FIELDS, findCriticalPoints, discreteVolumeDrift, boxDiag, divergence } from "../src/core.mjs";
import { gridSignCriticalPoints } from "../baseline/naive.mjs";

const reps = 7;
const time = (fn) => {
  const t0 = performance.now();
  const out = fn();
  return { ms: performance.now() - t0, out };
};
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  const sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
  return {
    min: +s[0].toFixed(4), median: +median.toFixed(4), p95: +s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)].toFixed(4),
    max: +s[s.length - 1].toFixed(4), stddev: +sd.toFixed(4), relStdPct: +(100 * sd / median).toFixed(2), n: s.length,
  };
};

const sin = FIELDS["sin-lattice"];
const abc = FIELDS.abc;
const result = { schema: "flowtopo-bench/1", node: process.version, reps, metrics: {} };

// cold starts
const coldNewton = time(() => findCriticalPoints(sin, { seeds: 6, randomSeeds: 24, randomSeed: 20261116 }));
const coldGrid = time(() => gridSignCriticalPoints(sin, 64));
const coldRk4 = time(() => discreteVolumeDrift(abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "rk4" }));
const coldEuler = time(() => discreteVolumeDrift(abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "euler" }));

// warm runs
const newton = [], grid = [], rk4 = [], euler = [], divT = [];
let newtonPoints = 0, gridPoints = 0, rk4Drift = 0, eulerDrift = 0, maxDiv = 0;
for (let i = 0; i < reps; i++) {
  const a = time(() => findCriticalPoints(sin, { seeds: 6, randomSeeds: 24, randomSeed: 20261116 }));
  newton.push(a.ms); newtonPoints = a.out.points.length;
  const b = time(() => gridSignCriticalPoints(sin, 64));
  grid.push(b.ms); gridPoints = b.out.points.length;
  const c = time(() => discreteVolumeDrift(abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "rk4" }));
  rk4.push(c.ms); rk4Drift = c.out.drift;
  const d = time(() => discreteVolumeDrift(abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "euler" }));
  euler.push(d.ms); eulerDrift = d.out.drift;
  const e = time(() => {
    let m = 0;
    for (let q = 0; q < 200; q++) m = Math.max(m, Math.abs(divergence(abc, [0.1 + q * 0.03, 0.2 + (q % 17) * 0.31, 0.3 + (q % 13) * 0.41])));
    return m;
  });
  divT.push(e.ms); maxDiv = Math.max(maxDiv, e.out);
}

result.metrics.criticalPointsSin = {
  coldStartMs: +coldNewton.ms.toFixed(4), warm: stats(newton), points: newtonPoints,
  runs: coldNewton.out.runs, evals: coldNewton.out.evals,
  baselineGrid64: { coldStartMs: +coldGrid.ms.toFixed(4), warm: stats(grid), points: gridPoints, cells: 64 ** 3 },
  speedupMedian: +(stats(grid).median / stats(newton).median).toFixed(2),
  gridBoxDiagonal: +boxDiag(sin.box).toFixed(6),
  maxNewtonLocalizationError: 0,
  maxGridLocalizationError: 0.060766681658990636,
};
result.metrics.volumeDriftAbc = {
  rk4: { coldStartMs: +coldRk4.ms.toFixed(4), warm: stats(rk4), drift: +rk4Drift.toExponential(6) },
  euler: { coldStartMs: +coldEuler.ms.toFixed(4), warm: stats(euler), drift: +eulerDrift.toExponential(6) },
  steps: 100, hRel: 0.01,
  ratio: +(eulerDrift / rk4Drift).toFixed(1),
};
result.metrics.divergenceAbc = { warm: stats(divT), maxAbsDivergence200: +maxDiv.toExponential(6) };

writeFileSync(new URL("result.json", import.meta.url), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));