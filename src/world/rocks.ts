import { Mesh, MeshBuilder, Scene, Vector3, VertexBuffer, VertexData } from "@babylonjs/core";
import { Geo, Placement, scatter, trs, tube } from "./geo";
import { mossyBarkMaterial, rockMaterial } from "./materials";
import { clamp, fbm2, fbm3, mulberry32, noise3, smoothstep } from "./noise";
import { forestDensity, HALF, pathDist, SPAWN, terrainHeight } from "./terrain";
import { barkTex, mossTex, rockTex } from "./textures";
import type { Collider } from "./vegetation";
import { by, DARK } from "../style";

// ─────────────────────────────────────────────────────────────────────────────
// ROCCE E TRONCHI — massi, affioramenti sui crinali, il cerchio di pietre erette
// della radura, tronchi caduti coperti di muschio.
//
// Stile moderno: `buildCrag`, poliedri scheggiati. Ogni vertice di un'icosfera fitta viene portato
// sul più vicino dei piani che racchiudono la roccia: facce piatte e spigoli vivi, come una pietra
// spaccata. Sopra: spaccature profonde, strati orizzontali, rugosità; nei colori dei vertici
// l'ombra delle spaccature e della base. Forme: massi, lastre, blocchi di parete, menhir.
// Stile dark: `buildRock`, le prime rocce (icosfera spostata col rumore), a poche facce.
// ─────────────────────────────────────────────────────────────────────────────

/** Centro del cerchio di pietre, davanti a dove si nasce. */
export const STONES = { x: 2, z: 14, r: 7 };

interface Crag {
  stretch: Vector3; sub: number;
  /** Quante facce, e quanto sono orizzontali (sotto 1 = più pareti verticali, sopra 1 = più piani). */
  planes?: number; flat?: number;
  /** Ampiezza e frequenza degli strati, numero di spaccature. */
  strata: number; cracks: number;
  shape?: "menhir" | "block";
}

function buildCrag(scene: Scene, seed: number, o: Crag): Mesh {
  const rnd = mulberry32(seed * 7919 + 13);
  const m = MeshBuilder.CreateIcoSphere(`crag${seed}`, { radius: 1, subdivisions: o.sub, flat: false }, scene);
  const pos = m.getVerticesData(VertexBuffer.PositionKind)!;
  const dir = (): Vector3 => {
    const y = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    return new Vector3(r * Math.cos(a), y, r * Math.sin(a));
  };
  const planes: { n: Vector3; d: number }[] = [];
  const face = (x: number, y: number, z: number, d: number): void => { planes.push({ n: new Vector3(x, y, z).normalize(), d }); };
  if (o.shape === "menhir") {
    // lastra eretta: quattro fianchi quasi verticali che si stringono in alto, smussi, cima a due spioventi
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + (rnd() - 0.5) * 0.35; face(Math.cos(a), 0.1 + rnd() * 0.12, Math.sin(a), 0.5 + rnd() * 0.12); }
    for (let k = 0; k < 5; k++) { const a = rnd() * Math.PI * 2; face(Math.cos(a), (rnd() - 0.3) * 0.3, Math.sin(a), 0.6 + rnd() * 0.1); }
    face(0.5 * (rnd() < 0.5 ? -1 : 1), 0.85, (rnd() - 0.5) * 0.5, 0.8 + rnd() * 0.1);
    face((rnd() - 0.5) * 0.6, 0.9, 0.4 * (rnd() < 0.5 ? -1 : 1), 0.9);
  } else if (o.shape === "block") {
    // blocco di parete: fratture quasi ortogonali, qualche smusso
    for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      face(x + (rnd() - 0.5) * 0.35, y + (rnd() - 0.5) * 0.25, z + (rnd() - 0.5) * 0.35, 0.55 + rnd() * 0.2);
    }
    for (let k = 0; k < 6; k++) { const n = dir(); face(n.x, n.y, n.z, 0.74 + rnd() * 0.2); }
  } else {
    for (let k = 0; k < (o.planes ?? 15); k++) { const n = dir(); face(n.x, n.y * (o.flat ?? 1), n.z, 0.6 + rnd() * 0.32); }
  }
  face(0, -1, 0, 0.42);                                          // la base, che sta sotto terra
  for (const [x, y, z] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, -1]]) face(x, y, z, 1.08);   // involucro
  const cracks = Array.from({ length: o.cracks }, () => ({ n: dir(), w: 0.035 + rnd() * 0.035, a: 0.1 + rnd() * 0.1, s: rnd() * 50 }));

  const colors = new Float32Array((pos.length / 3) * 4);
  const u = new Vector3();
  for (let i = 0; i < pos.length; i += 3) {
    u.set(pos[i], pos[i + 1], pos[i + 2]).normalize();
    // il piano più vicino lungo questa direzione; ogni faccia ondeggia appena, così gli spigoli non sono rasoi
    let r = 1.3;
    planes.forEach((p, k) => {
      const c = Vector3.Dot(u, p.n);
      if (c > 0.02) r = Math.min(r, p.d * (1 + noise3(u.x * 2.5 + k * 7.1, u.y * 2.5, u.z * 2.5, seed) * 0.06) / c);
    });
    // spaccature: solchi lungo cerchi massimi, interrotti dal rumore
    let cd = 0;
    for (const c of cracks) {
      const t = 1 - Math.abs(Vector3.Dot(u, c.n)) / c.w;
      if (t > 0) cd = Math.max(cd, t * t * c.a * smoothstep(-0.15, 0.2, fbm3(u.x * 2 + c.s, u.y * 2, u.z * 2, 2, seed)));
    }
    r *= 1 - cd;
    r *= 1 + fbm3(u.x * 4.5, u.y * 4.5, u.z * 4.5, 4, seed + 3) * 0.05 + (1 - Math.abs(noise3(u.x * 11, u.y * 11, u.z * 11, seed + 5))) * 0.012;
    const y = u.y * r;
    // strati: cenge orizzontali (un seno tagliato fa i gradini)
    const st = 1 + clamp(Math.sin((y * 5.5 + fbm3(u.x * 1.5, u.y * 1.5, u.z * 1.5, 2, seed + 9) * 0.7) * Math.PI * 2) * 2.5, -1, 1) * o.strata;
    pos[i] = u.x * r * st * o.stretch.x; pos[i + 1] = y * o.stretch.y; pos[i + 2] = u.z * r * st * o.stretch.z;
    const ao = clamp(1 - cd * 5.5, 0.25, 1) * (0.7 + 0.3 * smoothstep(-0.42, 0.1, y));
    const j = (i / 3) * 4;
    colors[j] = colors[j + 1] = colors[j + 2] = ao; colors[j + 3] = 1;
  }
  m.updateVerticesData(VertexBuffer.PositionKind, pos);
  // normali lisce, saldate per posizione: l'icosfera duplica i vertici lungo le cuciture delle uv
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, m.getIndices()!, normals);
  const sums = new Map<string, number[]>();
  const key = (i: number): string => `${Math.round(pos[i] * 2000)},${Math.round(pos[i + 1] * 2000)},${Math.round(pos[i + 2] * 2000)}`;
  for (let i = 0; i < pos.length; i += 3) {
    const k = key(i), s = sums.get(k);
    if (s) { s[0] += normals[i]; s[1] += normals[i + 1]; s[2] += normals[i + 2]; } else sums.set(k, [normals[i], normals[i + 1], normals[i + 2]]);
  }
  for (let i = 0; i < pos.length; i += 3) {
    const s = sums.get(key(i))!, l = Math.hypot(s[0], s[1], s[2]) || 1;
    normals[i] = s[0] / l; normals[i + 1] = s[1] / l; normals[i + 2] = s[2] / l;
  }
  m.updateVerticesData(VertexBuffer.NormalKind, normals);
  m.setVerticesData(VertexBuffer.ColorKind, colors, false, 4);
  m.refreshBoundingInfo();
  return m;
}

/** Le prime rocce (stile dark): icosfera spostata col rumore e spianata da qualche piano. */
function buildRock(scene: Scene, seed: number, stretch: Vector3): Mesh {
  const rnd = mulberry32(seed);
  const m = MeshBuilder.CreateIcoSphere(`rock${seed}`, { radius: 1, subdivisions: 5, flat: false }, scene);
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
  const moss = mossTex(scene);
  const mat = rockMaterial(scene, rockTex(scene), moss);
  const V = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);
  // massi grandi: tre massi, una lastra, un blocco di parete; sassi: gli stessi a poche facce
  const big = DARK ? [
    buildRock(scene, 1, V(1.3, 0.8, 1.0)), buildRock(scene, 2, V(1.0, 0.7, 1.2)), buildRock(scene, 3, V(1.1, 1.0, 1.0)),
    buildRock(scene, 4, V(1.6, 0.6, 1.1)), buildRock(scene, 5, V(0.9, 1.2, 0.9)),
  ] : [
    buildCrag(scene, 1, { stretch: V(1.25, 0.85, 1.05), sub: 16, planes: 16, flat: 1, strata: 0.03, cracks: 2 }),
    buildCrag(scene, 2, { stretch: V(1.0, 0.8, 1.3), sub: 16, planes: 13, flat: 0.7, strata: 0.045, cracks: 3 }),
    buildCrag(scene, 3, { stretch: V(1.15, 0.95, 0.95), sub: 16, planes: 18, flat: 1.3, strata: 0.025, cracks: 2 }),
    buildCrag(scene, 4, { stretch: V(1.7, 0.55, 1.25), sub: 16, planes: 12, flat: 2.2, strata: 0.05, cracks: 2 }),
    buildCrag(scene, 5, { stretch: V(1.1, 1.2, 1.0), sub: 16, shape: "block", strata: 0.06, cracks: 3 }),
  ];
  const small = DARK ? big : [
    buildCrag(scene, 11, { stretch: V(1.2, 0.8, 1.0), sub: 6, planes: 12, strata: 0.02, cracks: 1 }),
    buildCrag(scene, 12, { stretch: V(1.0, 0.7, 1.3), sub: 6, planes: 10, flat: 1.4, strata: 0.02, cracks: 1 }),
    buildCrag(scene, 13, { stretch: V(1.1, 1.0, 0.9), sub: 6, planes: 14, strata: 0.02, cracks: 0 }),
  ];
  const standing = DARK ? [buildRock(scene, 9, V(0.55, 1.0, 0.4))]
    : [21, 22, 23].map((s) => buildCrag(scene, s, { stretch: V(0.78, 1.0, 0.5), sub: 20, shape: "menhir", strata: 0.035, cracks: 2 }));
  const SLAB = 3, BLOCK = 4;
  const all = [...new Set([...big, ...small, ...standing])];
  for (const v of all) v.material = mat;
  const items = new Map<Mesh, Placement[]>(all.map((v) => [v, []]));
  const colliders: Collider[] = [];
  const put = (v: Mesh, x: number, z: number, s: number, sink: number): void => {
    items.get(v)!.push({ m: trs(x, terrainHeight(x, z) - s * sink, z, s * (0.85 + rnd() * 0.3), rnd() * 6.28, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.4) });
  };
  const pick = (list: Mesh[]): Mesh => list[(rnd() * list.length) | 0];
  const free = (x: number, z: number, r: number): boolean =>
    pathDist(x, z) > r + 1.5 && Math.hypot(x - SPAWN.x, z - SPAWN.z) > r + 4 && Math.hypot(x - STONES.x, z - STONES.z) > STONES.r + r + 1;

  // gruppi di massi nel bosco, con i loro detriti attorno
  for (let c = 0; c < 26; c++) {
    const cx = (rnd() - 0.5) * (HALF * 2 - 40), cz = (rnd() - 0.5) * (HALF * 2 - 40);
    if (!free(cx, cz, 4)) continue;
    const n = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const s = 0.8 + rnd() * rnd() * 3;
      const x = cx + (rnd() - 0.5) * 7, z = cz + (rnd() - 0.5) * 7;
      if (!free(x, z, s)) continue;
      put(pick(big), x, z, s, by(0.14, 0.3));
      colliders.push({ x, z, r: s * 1.05 });
      for (let k = 0; k < 3; k++) { const a = rnd() * 6.28, d = s * (1.1 + rnd() * 0.9); put(pick(small), x + Math.cos(a) * d, z + Math.sin(a) * d, 0.12 + rnd() * 0.3, 0.3); }
    }
  }
  // sassi sparsi
  for (let i = 0; i < 900; i++) {
    const x = (rnd() - 0.5) * (HALF * 2 - 10), z = (rnd() - 0.5) * (HALF * 2 - 10);
    if (rnd() > 0.3 + forestDensity(x, z) * 0.5 || pathDist(x, z) < 1.3) continue;
    put(pick(small), x, z, 0.12 + rnd() * rnd() * 0.6, 0.35);
  }
  // affioramenti sui crinali: dove il terreno è ripido e alto
  for (let i = 0; i < 1400 && colliders.length < 260; i++) {
    const x = (rnd() - 0.5) * (HALF * 2 - 4), z = (rnd() - 0.5) * (HALF * 2 - 4);
    const h = terrainHeight(x, z);
    const sl = Math.hypot(terrainHeight(x + 1, z) - h, terrainHeight(x, z + 1) - h);
    if (sl < 0.55 || h < 8 + fbm2(x / 20, z / 20, 2, 5) * 4) continue;
    const s = 2.5 + rnd() * 5;
    put(rnd() < 0.6 ? big[BLOCK] : pick(big), x, z, s, by(0.25, 0.45));
    colliders.push({ x, z, r: s * 1.05 });
  }

  // il cerchio di pietre erette, con la lastra in mezzo
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + 0.3;
    const x = STONES.x + Math.cos(a) * STONES.r, z = STONES.z + Math.sin(a) * STONES.r;
    const s = 1.6 + rnd() * 0.9;
    // ⚠️ le pietre guardano il centro: la faccia larga (x locale) sta lungo la tangente
    items.get(pick(standing))!.push({ m: trs(x, terrainHeight(x, z) + s * 0.3, z, V(s * by(1.25, 1), s * 1.9, s * by(1.25, 1)), -a + Math.PI / 2, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.12) });
    colliders.push({ x, z, r: s * 0.6 });
  }
  items.get(DARK ? standing[0] : big[SLAB])!.push({ m: trs(STONES.x, terrainHeight(STONES.x, STONES.z) + 0.1, STONES.z, V(by(1.5, 2.2), by(1.5, 0.9), by(1.5, 1.6)), 0.4) });
  colliders.push({ x: STONES.x, z: STONES.z, r: 1.6 });

  const casters: Mesh[] = [];
  for (const [v, list] of items) casters.push(...scatter(v, list, 50));

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
