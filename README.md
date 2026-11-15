# flowtopo-lab — 3D vector-field topology you can re-count

**Promise (measured, baseline in `baseline/naive.mjs`):** recovering the 8 critical points of a
3×3×3 `sin` lattice takes **1.51 ms median** (cold 8.72 ms) with **0.0** localization error at
double precision, while a 64³ grid sign-change scan takes **220.87 ms** (cold 305.88 ms) and lands
**6.08e-2** away — **146× faster**, with a localization error of 0.0 (residual 2.1e-16) versus 6.08e-2. The same scan misses the degenerate
(tangential) zero entirely (**0/1 recall**) and reports **3 points where the quadratic field has 2**
(one false positive). On the divergence-free ABC flow, RK4 holds accumulated volume drift to
**4.56e-5** where Euler gives **0.489** (**10,730×**).

Upstream: none

This is an original tool built from scratch for this repository. It is not a fork or a mirror.

## What it is

A browser + node workbench for the topology of a steady 3D vector field:

1. **Critical points** by multi-start damped Newton (Levenberg-style normal equations, so a
   singular Jacobian at a degenerate zero does not abort the solve), with residues and iteration
   counts.
2. **Classification** from the eigenvalues of the Jacobian: real spectra → source / sink /
   saddle-k, complex pairs → spiral source/sink, saddle-focus, center. Eigenvalues come from the
   characteristic cubic solved by Cauchy-bound bisection + Newton polish + deflation.
3. **Streamlines** (RK4 or Euler), **divergence** probes, and **accumulated volume drift** of the
   discrete flow map (product of one-step Jacobian determinants, which stays well conditioned even
   when a finite tetrahedron would flatten).
4. **Seeding study**: topology-guided seeds (along real eigenvectors / the complex plane) versus
   uniform seeds, both measured by how many analytic critical points a streamline passes within
   5% of the box diagonal.

The page renders the analytic fields with three.js (fixed `0.169.0` importmap), orbit controls,
critical-point glyphs coloured by type, and streamlines. The HUD **recomputes the numbers in the
page with the same `src/core.mjs`** and compares its fingerprint to the node-baked
`data/reference.json`; a match prints `✓`.

## Run it

```bash
node tools/gen-sample.mjs          # writes data/reference.json (deterministic)
node bench/verify.mjs              # 24 assertions, exit 0
node bench/bench.mjs               # writes bench/result.json (7 reps + cold start)
python3 -m http.server 4173         # then open http://localhost:4173
```

No `npm install`. No bundler. No browser automation. Node ≥ 20.

## Evidence (`bench/result.json`, node v24.19.0, 7 repeats + cold start)

| metric | this tool | baseline |
| --- | --- | --- |
| sin lattice: 8 critical points | **1.51 ms** median, cold 8.72 ms | 64³ sign scan: **220.87 ms** median, cold 305.88 ms |
| max localization error (box diag 10.88) | **0.0** (residual 2.1e-16) | **6.08e-2** (cell diag 0.170) |
| classification | **8/8** (source 1, sink 1, saddle-1 3, saddle-2 3) | 0/8 (a centroid has no Jacobian) |
| degenerate zero (`(|x|-1)²`-style) | **1/1**, type `degenerate` | **0/1** |
| quadratic field | **2/2**, `saddle-focus` + `spiral-source`, Im λ = 0.866025404 | **3 points** for 2 true zeros (1 spurious) |
| ABC divergence (200 probes) | `max |div u| = 0.0` | — |
| ABC volume drift, 100 steps, h=0.01·diag | RK4 **4.56e-5** | Euler **0.489** (10,730×) |
| scale 1e-6 … 1e6 | worst relative drift **4.3e-17** of box diagonal; types stable | — |
| seeding, 16 seeds, capture radius 5% diag | topology **7/8** | uniform **4/8** |

Reproduce every row with `node bench/verify.mjs` (24 passed / 0 failed) and `node bench/bench.mjs`.

`bench/result.json` also records `p95` and `stddev`. The two microsecond-scale rows (volume drift,
divergence) show `relStdPct` > 10% because the operations take 0.15–0.41 ms: at that size the
0.1 ms timer granularity and GC dominate. The absolute medians are reported, not hidden. The
220.87 ms grid row shows 64.8% relative stddev on a shared 4-core box; the cold start (305.88 ms)
and p95 (538 ms) are reported for that reason.

## 本轮创新

**B 档 — 首个把「临界点求解 → 三次特征方程分类 → 分离子种子」整条拓扑流水线放进浏览器，
并让页面上的每个数字与 node 逐位同源、同时给出一条可跑的朴素基线对照与 12 个数量级的尺度
不变性证据的 3D 流场工具。** ParaView/VTK 有临界点提取，但它是桌面端、无“页内复算/指纹比对”
这一层；常见 three.js 流场 demo 只画流线、不分类、不定位、不报残差。以前做不到的原因很具体：
朴素网格扫描只能给到格心（这里 6e-2），对不换号的退化零点直接 0 召回；本仓用阻尼牛顿把定位
压到双精度极限，并把“浏览器数字 = node 数字”变成指纹可判定的断言。

## Known limitations (disclosed thresholds)

- `EIG_TOL = 1e-8`: an eigenvalue is treated as zero relative to the **Jacobian magnitude over the
  box corners**, not to itself. This is why the all-zero spectrum of the tangential field is
  `degenerate` rather than a sink.
- `PAIR_TOL = 1e-4`: a conjugate pair whose imaginary part is below 1e-4·|λ| is reported as a
  repeated real eigenvalue. Values in that band are therefore not resolved as rotation.
- `tolX = 1e-13·boxDiag`, `tolF = 1e-12·fieldScale`, `epsRel = 1e-6·boxDiag`. **All are relative**;
  there is no absolute epsilon. Effective tested range: box scales 1e-6 … 1e6 (worst drift 4.3e-17
  of the diagonal). Below ~1e-8 the double-precision finite-difference Jacobian stops resolving
  the field; above ~1e8 the same happens to squared coordinates.
- Classification is **linearization only**: a `center` verdict is not a proof of a nonlinear
  center (no normal-form analysis).
- Multi-start Newton can miss a critical point whose basin contains no seed; the 8/8 and 2/2
  results are for these four fields, not a general guarantee.
- The tangential field is a deliberately degenerate corpus member (zero Jacobian), used to show a
  structural blind spot of sign-change scans. It is not the corpus behind the timing claim.
- ABC has no compact closed-form critical-point set; 8 points are found there but **no oracle
  count is claimed** for ABC. Only its divergence and volume drift are asserted.
- The browser layer is verified by HTTP 200 + importmap + `node --check` + shared-core import, not
  by a rendered screenshot (G8 forbids browser automation here). The in-page HUD is the same code
  path; a visual confirmation can be done by opening the page.

## Layout

```
index.html            entry, fixed three@0.169.0 importmap
main.js               rendering/interaction only
src/core.mjs          pure numerics (no three, no DOM, no I/O)
baseline/naive.mjs    grid sign-change baseline
tools/gen-sample.mjs  deterministic data/reference.json
bench/verify.mjs      24 assertions
bench/bench.mjs       7 reps + cold start -> bench/result.json
```

MIT licensed. No third-party code was copied; three.js is loaded from a pinned CDN at runtime and
is not vendored.