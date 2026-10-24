import { Mesh, MeshBuilder, Scene, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { Geo, Placement, scatter, trs, tube } from "./geo";
import { mossyBarkMaterial, rockMaterial } from "./materials";
import { fbm2, fbm3, mulberry32, noise3 } from "./noise";
import { forestDensity, HALF, pathDist, SPAWN, terrainHeight } from "./terrain";
import { barkTex, mossTex, rockTex } from "./textures";
import type { Collider } from "./vegetation";

// ─────────────────────────────────────────────────────────────────────────────
// ROCCE E TRONCHI — massi da icosfere spostate col rumore e "tagliate" da piani
// (le facce piatte di una roccia vera), affioramenti sui crinali, il cerchio di
// pietre erette della radura, tronchi caduti coperti di muschio.
// ─────────────────────────────────────────────────────────────────────────────

/** Centro del cerchio di pietre, davanti a dove si nasce. */
export const STONES = { x: 2, z: 14, r: 7 };

function buildRock(scene: Scene, seed: number, stretch: Vector3): Mesh {
  const rnd = mulberry32(seed);
  const m = MeshBuilder.CreateIcoSphere(`rock${seed}`, { radius: 1, subdivisions: 14, flat: false }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const planes = Array.from({ length: 6 + Math.floor(rnd() * 4) }, () => ({
    n: new Vector3(rnd() - 0.5, (rnd() - 0.3) * 0.8, rnd() - 0.5).normalize(),
    d: 0.6 + rnd() * 0.25,
  }));
  const q = new Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    q.set(pos[i], pos[i + 1], pos[i + 2]);
    const k = 1 + fbm3(q.x * 1.4 + seed, q.y * 1.4, q.z * 1.4, 4, seed) * 0.32 + (1 - Math.abs(noise3(q.x * 5, q.y * 5, q.z * 5, seed + 1))) * 0.04;
    q.scaleInPlace(k);
    for (const p of planes) {
      const s = Vector3.Dot(q, p.n) - p.d;
      if (s > 0) q.subtractInPlace(p.n.scale(s * 0.9));
    }
    if (q.y < -0.25) q.y = -0.25 + (q.y + 0.25) * 0.3;
    pos[i] = q.x * stretch.x; pos[i + 1] = q.y * stretch.y; pos[i + 2] = q.z * stretch.z;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  m.refreshBoundingInfo();
  return m;
}

function buildLog(rnd: () => number, L: number, R: number): Geo {
  const g = new Geo();
  const pts: Vector3[] = [], radii: number[] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push(new Vector3((t - 0.5) * L, Math.sin(t * 3 + rnd()) * 0.05, Math.sin(t * 2.2) * 0.12));
    // estremità spezzate: il raggio crolla negli ultimi centimetri
    const end = Math.min(t, 1 - t) * L;
    radii.push(R * (0.92 + 0.1 * Math.sin(t * 17)) * Math.min(1, 0.35 + end / 0.25));
  }
  tube(g, pts, radii, 12, 2, 1.4, () => 0.85);
  return g;
}

export interface Rocks { casters: Mesh[]; colliders: Collider[] }

export function createRocks(scene: Scene): Rocks {
  const rnd = mulberry32(0x0C4);
  const rock = rockTex(scene), moss = mossTex(scene);
  const mat = rockMaterial(scene, rock, moss);
  const variants = [
    buildRock(scene, 1, new Vector3(1.3, 0.8, 1.0)), buildRock(scene, 2, new Vector3(1.0, 0.7, 1.2)),
    buildRock(scene, 3, new Vector3(1.1, 1.0, 1.0)), buildRock(scene, 4, new Vector3(1.6, 0.6, 1.1)),
    buildRock(scene, 5, new Vector3(0.9, 1.2, 0.9)),
  ];
  const standing = buildRock(scene, 9, new Vector3(0.55, 1.0, 0.4));
  for (const v of [...variants, standing]) v.material = mat;
  const items: Placement[][] = variants.map(() => []);
  const colliders: Collider[] = [];
  const add = (x: number, z: number, s: number, sink: number, collide: boolean): void => {
    const y = terrainHeight(x, z) - s * sink;
    items[(rnd() * variants.length) | 0].push({ m: trs(x, y, z, s * (0.85 + rnd() * 0.3), rnd() * 6.28, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4) });
    if (collide) colliders.push({ x, z, r: s * 1.05 });
  };
  const free = (x: number, z: number, r: number): boolean =>
    pathDist(x, z) > r + 1.5 && Math.hypot(x - SPAWN.x, z - SPAWN.z) > r + 4 && Math.hypot(x - STONES.x, z - STONES.z) > STONES.r + r + 1;

  // gruppi di massi nel bosco
  for (let c = 0; c < 26; c++) {
    const cx = (rnd() - 0.5) * (HALF * 2 - 40), cz = (rnd() - 0.5) * (HALF * 2 - 40);
    if (!free(cx, cz, 4)) continue;
    const n = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const s = 0.8 + rnd() * rnd() * 3;
      const x = cx + (rnd() - 0.5) * 7, z = cz + (rnd() - 0.5) * 7;
      if (free(x, z, s)) add(x, z, s, 0.3, true);
    }
  }
  // sassi sparsi
  for (let i = 0; i < 900; i++) {
    const x = (rnd() - 0.5) * (HALF * 2 - 10), z = (rnd() - 0.5) * (HALF * 2 - 10);
    if (rnd() > 0.3 + forestDensity(x, z) * 0.5 || pathDist(x, z) < 1.3) continue;
    add(x, z, 0.12 + rnd() * rnd() * 0.6, 0.35, false);
  }
  // affioramenti sui crinali: dove il terreno è ripido e alto
  for (let i = 0; i < 1400 && colliders.length < 260; i++) {
    const x = (rnd() - 0.5) * (HALF * 2 - 4), z = (rnd() - 0.5) * (HALF * 2 - 4);
    const h = terrainHeight(x, z);
    const sl = Math.hypot(terrainHeight(x + 1, z) - h, terrainHeight(x, z + 1) - h);
    if (sl < 0.55 || h < 8 + fbm2(x / 20, z / 20, 2, 5) * 4) continue;
    add(x, z, 2.5 + rnd() * 5, 0.45, true);
  }
  const casters: Mesh[] = [];
  variants.forEach((v, i) => casters.push(...scatter(v, items[i], 50)));

  // il cerchio di pietre erette, con la lastra in mezzo
  const st: Placement[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const x = STONES.x + Math.cos(a) * STONES.r, z = STONES.z + Math.sin(a) * STONES.r;
    const s = 1.6 + rnd() * 0.9;
    st.push({ m: trs(x, terrainHeight(x, z) + s * 0.3, z, new Vector3(s, s * 1.9, s), -a + Math.PI / 2, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.12) });
    colliders.push({ x, z, r: s * 0.6 });
  }
  st.push({ m: trs(STONES.x, terrainHeight(STONES.x, STONES.z) + 0.1, STONES.z, new Vector3(2.2, 0.9, 1.6), 0.4) });
  colliders.push({ x: STONES.x, z: STONES.z, r: 1.6 });
  casters.push(...scatter(standing, st, 1000));

  // tronchi caduti
  const logMat = mossyBarkMaterial(scene, barkTex(scene), moss);
  const logs = [0, 1, 2].map((i) => { const m = buildLog(mulberry32(60 + i), 6 + i * 2, 0.32 + i * 0.06).mesh(`log${i}`, scene); m.material = logMat; return m; });
  const logItems: Placement[][] = logs.map(() => []);
  for (let i = 0; i < 60; i++) {
    const x = (rnd() - 0.5) * (HALF * 2 - 40), z = (rnd() - 0.5) * (HALF * 2 - 40);
    const v = (rnd() * 3) | 0, L = 6 + v * 2, R = 0.32 + v * 0.06;
    if (forestDensity(x, z) < 0.4 || !free(x, z, L * 0.5)) continue;
    const yaw = rnd() * Math.PI * 2;
    const ex = Math.cos(yaw) * L * 0.5, ez = -Math.sin(yaw) * L * 0.5;
    const h0 = terrainHeight(x - ex, z - ez), h1 = terrainHeight(x + ex, z + ez);
    logItems[v].push({ m: trs(x, (h0 + h1) / 2 + R * 0.55, z, 1, yaw, 0, Math.atan2(h1 - h0, L)) });
    for (let k = -2; k <= 2; k++) colliders.push({ x: x + ex * k / 2.5, z: z + ez * k / 2.5, r: R + 0.1 });
  }
  logs.forEach((l, i) => casters.push(...scatter(l, logItems[i], 60)));

  return { casters, colliders };
}
