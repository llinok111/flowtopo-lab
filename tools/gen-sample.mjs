// Deterministic generator for data/reference.json (no network, no timestamps).
// Same command twice -> byte-identical file (sha256 checked in README/bench).
import { writeFileSync, mkdirSync } from "node:fs";
import {
  FIELDS, findCriticalPoints, fingerprint, divergence, discreteVolumeDrift,
  topologySeeds, traceStreamline, uniformSeeds, captureCount, mulberry32, boxDiag,
} from "../src/core.mjs";

const OUT = new URL("../data/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const rnd = mulberry32(20261116);
const fields = ["sin-lattice", "quadratic", "abc", "tangential"];
const report = { schema: "flowtopo-reference/1", generatedBy: "tools/gen-sample.mjs", fields: {} };

for (const name of fields) {
  const f = FIELDS[name];
  const found = findCriticalPoints(f, { seeds: 6, randomSeeds: 24, randomSeed: 20261116 });
  const pts = found.points.map((p) => ({
    p: p.p.map((v) => +v.toFixed(12)),
    type: p.type,
    residual: +p.residual.toExponential(6),
    eigenvalues: p.eigenvalues.complex
      ? { real: [+p.eigenvalues.real[0].toFixed(9)], complex: p.eigenvalues.complex.map((v) => +v.toFixed(9)) }
      : { real: p.eigenvalues.real.map((v) => +v.toFixed(9)) },
  }));

  // 512 deterministic probe points for the divergence certificate
  let maxDiv = 0;
  const [lo, hi] = f.box;
  for (let i = 0; i < 512; i++) {
    const q = [lo[0] + rnd() * (hi[0] - lo[0]), lo[1] + rnd() * (hi[1] - lo[1]), lo[2] + rnd() * (hi[2] - lo[2])];
    maxDiv = Math.max(maxDiv, Math.abs(divergence(f, q)));
  }

  // streamlines: same seeds the browser uses, sampled coarsely for a light payload
  const lines = [];
  const seeds = topologySeeds(f, found.points, 2).slice(0, 24);
  for (const s of seeds) {
    for (const dir of [1, -1]) {
      const tr = traceStreamline(f, s, { hRel: 0.006, steps: 140, dir });
      lines.push(tr.points.filter((_, i) => i % 3 === 0).map((v) => v.map((x) => +x.toFixed(5))));
    }
  }

  report.fields[name] = {
    box: f.box,
    diagonal: +boxDiag(f.box).toFixed(12),
    criticalPoints: pts,
    fingerprint: fingerprint(found.points),
    newtonRuns: found.runs,
    newtonEvals: found.evals,
    maxDivergence512: +maxDiv.toExponential(6),
    volumeDrift: {
      rk4: +discreteVolumeDrift(f, [1, 2, 1], { hRel: 0.01, steps: 100, method: "rk4" }).drift.toExponential(6),
      euler: +discreteVolumeDrift(f, [1, 2, 1], { hRel: 0.01, steps: 100, method: "euler" }).drift.toExponential(6),
    },
    streamlines: lines,
  };
}

// Uniform-seed baseline capture, for the "topology vs uniform seeding" figure.
const sin = FIELDS["sin-lattice"];
const truth = sin.analytic.map((a) => a.p);
const radius = 0.05 * boxDiag(sin.box);
const topo = topologySeeds(sin, FIELDS["sin-lattice"].analytic.map((a) => ({ p: a.p, eigenvalues: { real: a.eigenvalues } })), 2);
const topoLines = topo.slice(0, 16).flatMap((s) => [1, -1].map((dir) => traceStreamline(sin, s, { hRel: 0.006, steps: 160, dir })));
const uni = uniformSeeds(sin.box, 16, 777);
const uniLines = uni.flatMap((s) => [1, -1].map((dir) => traceStreamline(sin, s, { hRel: 0.006, steps: 160, dir })));
report.seeding = {
  radiusRel: 0.05,
  criticalPoints: truth.length,
  topologySeeds: topo.slice(0, 16).length,
  topologyCaptured: captureCount(truth, topoLines, radius),
  uniformSeeds: uni.length,
  uniformCaptured: captureCount(truth, uniLines, radius),
};

writeFileSync(new URL("reference.json", OUT), JSON.stringify(report, null, 1));
console.log("wrote data/reference.json", JSON.stringify({ fields: Object.keys(report.fields), seeding: report.seeding }));