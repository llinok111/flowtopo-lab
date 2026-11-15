// Rendering + interaction only. Every number shown is produced by src/core.mjs,
// either here in the page (live) or baked into data/reference.json by node.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  FIELDS, findCriticalPoints, fingerprint, divergence, discreteVolumeDrift,
  boxDiag, pointDistance, topologySeeds, traceStreamline,
} from "./src/core.mjs";

const ref = await (await fetch("./data/reference.json")).json();
const app = document.getElementById("app");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090f);
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 1e6);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

const COLORS = {
  source: 0xff5a3c, sink: 0x3c8cff, "spiral-source": 0xff8a00, "spiral-sink": 0x00c2ff,
  "saddle-focus": 0xb56cff, "saddle-1": 0xffc93c, "saddle-2": 0xffe27a,
  "saddle-center": 0x8fe3c0, center: 0x9ad3ff, degenerate: 0x9aa4b8,
};

let group = new THREE.Group();
scene.add(group);
let current = "sin-lattice";
let lastLive = null;

function clear() {
  group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  scene.remove(group);
  group = new THREE.Group();
  scene.add(group);
  while (scene.children.length > 1) scene.remove(scene.children[0]);
  scene.add(group);
}

function boxWire(field, color = 0x1d2740) {
  const [lo, hi] = field.box;
  const g = new THREE.BoxGeometry(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color }));
  edges.position.set((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
  return edges;
}

function renderField(name) {
  clear();
  current = name;
  const field = FIELDS[name];
  const diag = boxDiag(field.box);
  const data = ref.fields[name];
  scene.add(boxWire(field));

  const r = 0.028 * diag;
  for (const cp of data.criticalPoints) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(r, 18, 12),
      new THREE.MeshStandardMaterial({ color: COLORS[cp.type] ?? 0xffffff, emissive: COLORS[cp.type] ?? 0xffffff, emissiveIntensity: 0.45, roughness: 0.4 }),
    );
    m.position.set(...cp.p);
    group.add(m);
  }

  const verts = [];
  for (const line of data.streamlines) for (let i = 0; i + 1 < line.length; i++) verts.push(...line[i], ...line[i + 1]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  group.add(new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x3ea6ff, transparent: true, opacity: 0.42 })));

  const c = [(field.box[0][0] + field.box[1][0]) / 2, (field.box[0][1] + field.box[1][1]) / 2, (field.box[0][2] + field.box[1][2]) / 2];
  camera.position.set(c[0] + 1.5 * diag, c[1] + 1.05 * diag, c[2] + 1.6 * diag);
  controls.target.set(...c);
  controls.update();
  document.getElementById("f-name").textContent = name;
  updateHud(data.criticalPoints, data.fingerprint, null);
}

function updateHud(points, refFp, live) {
  const types = {};
  for (const p of points) types[p.type] = (types[p.type] ?? 0) + 1;
  document.getElementById("m-count").textContent = `${points.length}`;
  document.getElementById("m-types").textContent = Object.entries(types).map(([k, v]) => `${k}×${v}`).join(" ");
  document.getElementById("m-fp").textContent = "0x" + refFp.toString(16);
  const field = FIELDS[current];
  let md = 0;
  for (let i = 0; i < 200; i++) {
    const p = [field.box[0][0] + (i * 0.137 % 1) * (field.box[1][0] - field.box[0][0]),
               field.box[0][1] + (i * 0.311 % 1) * (field.box[1][1] - field.box[0][1]),
               field.box[0][2] + (i * 0.577 % 1) * (field.box[1][2] - field.box[0][2])];
    md = Math.max(md, Math.abs(divergence(field, p)));
  }
  document.getElementById("m-div").textContent = md.toExponential(2);
  const rk4 = discreteVolumeDrift(FIELDS.abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "rk4" });
  const euler = discreteVolumeDrift(FIELDS.abc, [1, 2, 1], { hRel: 0.01, steps: 100, method: "euler" });
  document.getElementById("m-vol").textContent = `${rk4.drift.toExponential(2)} / ${euler.drift.toExponential(2)}`;
  if (live) {
    const err = Math.max(...live.points.map((p) => Math.min(...ref.fields[current].criticalPoints.map((q) => pointDistance(p.p, q.p)))));
    document.getElementById("m-err").textContent = err === 0 ? "0 (exact match)" : err.toExponential(2);
    document.getElementById("m-fp").textContent = "0x" + live.fp.toString(16) + (live.fp === refFp ? " ✓" : " ✗");
  } else {
    document.getElementById("m-err").textContent = "–";
  }
}

document.getElementById("recompute").addEventListener("click", () => {
  const n = Number(document.getElementById("seeds").value);
  const t0 = performance.now();
  const r = findCriticalPoints(FIELDS[current], { seeds: n, randomSeeds: 24, randomSeed: 20261116 });
  const ms = performance.now() - t0;
  lastLive = { points: r.points, fp: fingerprint(r.points) };
  updateHud(r.points, ref.fields[current].fingerprint, lastLive);
  document.getElementById("seeds-v").textContent = `${n}³ · ${ms.toFixed(1)} ms`;
});
document.getElementById("seeds").addEventListener("input", (e) => {
  document.getElementById("seeds-v").textContent = `${e.target.value}³`;
});

renderField("sin-lattice");
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });