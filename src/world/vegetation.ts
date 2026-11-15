import { Color3, Color4, Matrix, Mesh, Quaternion, Scene, Vector3 } from "@babylonjs/core";
import { Geo, Placement, scatter, strip, trs, tube } from "./geo";
import { addWind, foliageMaterial, grassMaterial, surfaceMaterial } from "./materials";
import { clamp, fbm2, mulberry32, smoothstep } from "./noise";
import { EAST, forestDensity, greenAt, HALF, pathDist, pitDist, riverDist, SPAWN, terrainHeight, townDist } from "./terrain";
import { barkTex, fernCardTex, grassCardTex, leafCardTex, spruceCardTex } from "./textures";
import { by, DARK } from "../style";

// ─────────────────────────────────────────────────────────────────────────────
// VEGETAZIONE — abeti rossi (la maggioranza), latifoglie, alberi morti, cespugli,
// felci ed erba. Ogni specie è generata in qualche variante e poi sparsa a istanze
// sottili per chunk (vedi geo.ts/scatter). Le chiome hanno normali "a sfera" e
// occlusione finta nei colori dei vertici: è quello che le fa leggere come volumi.
// Nello stile dark (vedi style.ts) gli stessi generatori fanno alberi "da primi anni 2000":
// tronchi tozzi a poche facce, poche carte grandi, abeti a gonne spioventi, erba a quad incrociati.
// ─────────────────────────────────────────────────────────────────────────────

/** Ostacolo a cerchio. `soft` = una persona: ferma il passo, ma la spada non ci rimbalza come sul legno. */
export interface Collider {
  x: number; z: number; r: number; soft?: boolean;
  /** Se ci sono, l'ostacolo è un segmento da (x, z) a (bx, bz), spesso r per parte (muri sottili, porte). */
  bx?: number; bz?: number;
  /** Fascia d'altezza in cui ferma il passo (assente = a ogni quota). */
  y0?: number; y1?: number;
  /** Spento: una porta aperta. */
  off?: boolean;
}

const UP = Vector3.Up();

// ── Abete rosso ─────────────────────────────────────────────────────────────

function buildSpruce(rnd: () => number, H: number): { bark: Geo; leaves: Geo } {
  const bark = new Geo(), leaves = new Geo();
  const lean = new Vector3((rnd() - 0.5) * 0.25, 0, (rnd() - 0.5) * 0.25);
  const axis = (y: number): Vector3 => new Vector3(lean.x * y * y / H, y, lean.z * y * y / H);
  const trunkR = (y: number): number => {
    const t = clamp(y / H);
    return (by(0.3, 0.42) * Math.pow(1 - t, 1.15) + 0.025) * (1 + 0.55 * Math.exp(-Math.max(0, y) * 2.2));
  };
  const pts: Vector3[] = [], radii: number[] = [];
  for (let i = 0; i <= 16; i++) {
    const y = -0.6 + (H + 0.6) * Math.pow(i / 16, 1.3);
    pts.push(axis(y)); radii.push(trunkR(y));
  }
  tube(bark, pts, radii, by(9, 7), 2, 1.4, (i) => 0.55 + 0.45 * smoothstep(0, 3, pts[i].y));

  // rami secchi in basso: monconi spogli
  for (let i = 0; i < 10; i++) {
    const y = H * (0.06 + rnd() * 0.12), a = rnd() * Math.PI * 2, L = 0.6 + rnd() * 1.2;
    const d = new Vector3(Math.cos(a), -0.3 - rnd() * 0.3, Math.sin(a)).normalize();
    const b = axis(y);
    tube(bark, [b, b.add(d.scale(L))], [0.04, 0.008], 4, 1, 1, () => 0.6);
  }

  // nel dark i rami sono lunghi e spioventi: partono più in alto, o le punte arrivano negli occhi
  const y0 = H * by(0.16, 0.36);
  const crownBase = by(3.4, 4.4) + rnd() * 0.9;
  for (let y = y0; y < H * 0.97; y += by(0.42, 0.95) + rnd() * by(0.22, 0.35)) {
    const t = (y - y0) / (H - y0);
    const nb = by(5, 6) + Math.floor(rnd() * by(3, 2));
    const off = rnd() * Math.PI * 2;
    for (let k = 0; k < nb; k++) {
      const a = off + (k / nb) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const L = (crownBase * Math.pow(1 - t, 0.95) * (0.8 + rnd() * 0.35) + 0.35);
      const droop = by(-0.18, -0.3) - by(0.35, 0.3) * (1 - t) + rnd() * 0.1;
      const dir = new Vector3(Math.cos(a), droop, Math.sin(a)).normalize();
      const base = axis(y);
      const sideH = Vector3.Cross(dir, UP).normalize();
      tube(bark, [base, base.add(dir.scale(L * 0.9))], [0.035 + L * 0.012, 0.01], 4, 1, 1, () => 0.5);
      const cards = by(t < 0.6 ? 3 : 2, 1);
      for (let c = 0; c < cards; c++) {
        // la prima carta è stesa, le altre ruotate attorno al ramo: volume visto di lato
        const roll = c === 0 ? 0 : (c === 1 ? 0.95 : -0.95) + (rnd() - 0.5) * 0.3;
        const sd = sideH.scale(Math.cos(roll)).add(Vector3.Cross(sideH, dir).scale(Math.sin(roll)));
        const w = L * by(0.42, 0.62);
        strip(leaves, 3,
          (tt) => base.add(dir.scale(L * 1.05 * tt)).add(new Vector3(0, L * (-0.12 * tt + 0.16 * tt * tt), 0)),
          () => sd.scale(w),
          (p) => {
            const rad = new Vector3(p.x, 0, p.z).normalize();
            return rad.scale(0.75).addInPlace(new Vector3(0, 0.45 + t * 0.4, 0)).normalize();
          },
          (tt, s) => [tt, s],
          (p, tt) => {
            const rd = Math.hypot(p.x, p.z) / (crownBase * (1 - t) + 0.4);
            return clamp(0.35 + 0.5 * tt + 0.25 * rd, 0, 1) * (0.7 + 0.3 * t);
          });
      }
    }
  }
  // la punta: due carte incrociate verso l'alto
  const top = axis(H * 0.96);
  for (let c = 0; c < 2; c++) {
    const sd = new Vector3(Math.cos(c * 1.57), 0, Math.sin(c * 1.57)).scale(0.35);
    strip(leaves, 2, (tt) => top.add(new Vector3(0, tt * 1.4, 0)), () => sd,
      (p) => new Vector3(p.x, 0.8, p.z).normalize(), (tt, s) => [tt, s], () => 0.9);
  }
  return { bark, leaves };
}

// ── Latifoglia e albero morto (ramificazione ricorsiva) ─────────────────────

function buildBroadleaf(rnd: () => number, H: number, leafy: boolean): { bark: Geo; leaves: Geo } {
  const bark = new Geo(), leaves = new Geo();
  const center = new Vector3(0, H * 0.66, 0);
  const crownR = H * 0.36;
  const maxDepth = 3;

  const branch = (p0: Vector3, dir: Vector3, len: number, r0: number, depth: number): void => {
    const nSeg = Math.max(3, Math.ceil(len / 0.7));
    const pts = [p0.clone()], radii = [r0];
    let p = p0.clone(), d = dir.clone();
    for (let i = 1; i <= nSeg; i++) {
      d = d.add(new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).scale(0.28)).add(UP.scale(depth > 0 ? 0.06 : 0.02)).normalize();
      p = p.add(d.scale(len / nSeg));
      pts.push(p.clone());
      radii.push(r0 * (1 - 0.55 * i / nSeg) * (depth === 0 && i === 1 ? 1.0 : 1));
    }
    if (depth === 0) {
      // svasatura delle radici
      pts.unshift(p0.add(new Vector3(0, -0.5, 0))); radii.unshift(r0 * 1.7);
    }
    tube(bark, pts, radii, depth === 0 ? by(12, 8) : depth === 1 ? by(7, 5) : by(5, 4), depth === 0 ? 3 : 1, 1.6,
      (i) => depth === 0 ? 0.55 + 0.45 * smoothstep(0, 2.5, pts[i].y) : 0.75);
    if (depth < maxDepth) {
      const nc = depth === 0 ? 4 + Math.floor(rnd() * 2) : 3;
      for (let c = 0; c < nc; c++) {
        const t = depth === 0 ? 0.5 + 0.5 * (c + 1) / nc : 0.35 + 0.6 * rnd();
        const fi = t * nSeg, i0 = Math.floor(fi), i1 = Math.min(nSeg, i0 + 1);
        const at = Vector3.Lerp(pts[i0 + (depth === 0 ? 1 : 0)], pts[i1 + (depth === 0 ? 1 : 0)], fi - i0);
        const perp = Vector3.Cross(d, new Vector3(Math.cos(c * 2.4 + rnd()), 0.1, Math.sin(c * 2.4 + rnd()))).normalize();
        const ang = 0.55 + rnd() * 0.45;
        const cd = d.scale(Math.cos(ang)).add(perp.scale(Math.sin(ang))).add(UP.scale(0.25)).normalize();
        branch(at, cd, len * (by(0.58, 0.66) + rnd() * 0.18), r0 * (1 - 0.55 * t) * 0.72, depth + 1);
      }
    }
    if (leafy && depth >= maxDepth - 1) {
      const nl = depth === maxDepth ? by(5, 3) : by(2, 1);
      for (let k = 0; k < nl; k++) {
        const t = 0.3 + 0.7 * (k + rnd() * 0.5) / nl;
        const c = Vector3.Lerp(pts[0], pts[pts.length - 1], t).add(new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).scale(0.6));
        const size = by(0.85, 1.5) + rnd() * by(0.45, 0.7);
        const out = c.subtract(center).normalize();
        // la carta guarda verso fuori e un po' in alto, girata a caso attorno a sé
        const nrm = out.add(new Vector3(rnd() - 0.5, 0.8, rnd() - 0.5)).normalize();
        const tA = Vector3.Cross(nrm, new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
        const tB = Vector3.Cross(nrm, tA);
        strip(leaves, 1, (tt) => c.add(tA.scale((tt - 0.5) * 2 * size)), () => tB.scale(size),
          (p) => p.subtract(center).normalize().scale(0.7).addInPlace(new Vector3(0, 0.5, 0)).normalize(),
          (tt, s) => [tt, s],
          (p) => clamp(0.3 + 0.75 * Vector3.Distance(p, center) / crownR, 0.3, 1.05));
      }
    }
  };
  const trunkLen = H * (leafy ? by(0.46, 0.4) : 0.55);
  branch(new Vector3(0, 0, 0), new Vector3((rnd() - 0.5) * 0.15, 1, (rnd() - 0.5) * 0.15).normalize(), trunkLen, H * by(0.024, 0.032) + by(0.12, 0.2), 0);
  return { bark, leaves };
}

function buildBush(rnd: () => number): Geo {
  const g = new Geo();
  const c = new Vector3(0, 0.45, 0);
  for (let k = 0; k < by(26, 11); k++) {
    const a = rnd() * Math.PI * 2, e = rnd() * 1.2;
    const dir = new Vector3(Math.cos(a) * Math.cos(e), Math.sin(e) * 0.8, Math.sin(a) * Math.cos(e));
    const p = c.add(dir.scale(0.25 + rnd() * 0.45));
    const nrm = dir.add(new Vector3(0, 0.6, 0)).normalize();
    const tA = Vector3.Cross(nrm, new Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5)).normalize();
    const tB = Vector3.Cross(nrm, tA);
    const size = by(0.45, 0.75) + rnd() * by(0.25, 0.35);
    strip(g, 1, (tt) => p.add(tA.scale((tt - 0.5) * 2 * size)), () => tB.scale(size),
      (q) => q.subtract(c).normalize().add(new Vector3(0, 0.4, 0)).normalize(), (tt, s) => [tt, s],
      (q) => clamp(0.35 + q.y * 0.6 + Vector3.Distance(q, c) * 0.4, 0.3, 1));
  }
  return g;
}

function buildFern(rnd: () => number): Geo {
  const g = new Geo();
  const nf = 9 + Math.floor(rnd() * 5);
  for (let f = 0; f < nf; f++) {
    const a = (f / nf) * Math.PI * 2 + rnd() * 0.5;
    const L = 0.75 + rnd() * 0.5, W = L * 0.2;
    const e0 = 1.05 + rnd() * 0.35;
    const dirH = new Vector3(Math.cos(a), 0, Math.sin(a));
    const side = Vector3.Cross(dirH, UP).normalize();
    // integra l'arco: parte quasi dritta in su e ricade verso la punta
    const P: Vector3[] = [];
    let p = new Vector3(0, 0, 0);
    for (let i = 0; i <= 6; i++) {
      P.push(p.clone());
      const e = e0 - (i / 6) * 1.7;
      p = p.add(dirH.scale(Math.cos(e) * L / 6)).add(new Vector3(0, Math.sin(e) * L / 6, 0));
    }
    strip(g, 6, (t) => P[Math.round(t * 6)], (t) => side.scale(W * (1 - t * 0.3)),
      () => new Vector3(dirH.x * 0.25, 1, dirH.z * 0.25).normalize(),
      (t, s) => [s, 1 - t], (q, t) => 0.45 + 0.55 * t);
  }
  return g;
}

/** Toppa d'erba: qualche ciuffo sparso su ~1,6 m (un'istanza copre più terreno: meno istanze, stesse foglie). */
function buildGrassPatch(rnd: () => number): Geo {
  const g = new Geo();
  // colori LINEARI (albedo vero: l'erba sta fra 0,03 e 0,2)
  const base = new Color3(0.02, 0.035, 0.008), tip = new Color3(0.11, 0.17, 0.035), dry = new Color3(0.2, 0.17, 0.06);
  const tufts = Array.from({ length: 5 }, () => { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * 0.8; return [Math.cos(a) * r, Math.sin(a) * r]; });
  for (let b = 0; b < 34; b++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 0.14;
    const [tx, tz] = tufts[b % tufts.length];
    const o = new Vector3(tx + Math.cos(a) * r, 0, tz + Math.sin(a) * r);
    const h = 0.28 + rnd() * 0.42, w = 0.022 + rnd() * 0.018;
    const bend = rnd() * Math.PI * 2, lean = 0.15 + rnd() * 0.45;
    const bd = new Vector3(Math.cos(bend), 0, Math.sin(bend));
    const face = Vector3.Cross(bd, UP).normalize();
    const tc = rnd() < 0.12 ? dry : tip;
    const segs = 3;
    const start = g.p.length / 3;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const c = o.add(bd.scale(Math.sin(t * lean * 1.6) * h * t * 0.6)).add(new Vector3(0, h * t * Math.cos(lean * t), 0));
      const col = Color3.Lerp(base, tc, Math.pow(t, 0.8));
      const nrm = bd.scale(-0.25).add(UP).normalize();
      const ww = w * (1 - t * 0.85);
      for (const s of [-1, 1]) {
        g.p.push(c.x + face.x * ww * s, c.y, c.z + face.z * ww * s);
        g.n.push(nrm.x, nrm.y, nrm.z);
        g.uv.push(s * 0.5 + 0.5, t);
        g.c.push(col.r, col.g, col.b, 1);
      }
    }
    for (let i = 0; i < segs; i++) {
      const q = start + i * 2;
      g.tri(q, q + 2, q + 1); g.tri(q + 1, q + 2, q + 3);
    }
  }
  return g;
}

/**
 * Stile dark: erba a quad incrociati con una texture di ciuffi. Le normali guardano in su: l'erba
 * prende la stessa luce del terreno e non si vedono le carte.
 */
function buildGrassCross(rnd: () => number): Geo {
  const g = new Geo();
  for (let q = 0; q < 3; q++) {
    const a = (q / 3) * Math.PI + rnd() * 0.4, w = 0.6 + rnd() * 0.25, h = 0.55 + rnd() * 0.3;
    const d = new Vector3(Math.cos(a), 0, Math.sin(a)).scale(w);
    const o = new Vector3((rnd() - 0.5) * 0.3, 0, (rnd() - 0.5) * 0.3);
    const top = Vector3.Cross(d, UP).scale((rnd() - 0.5) * 0.4).add(new Vector3(0, h, 0));
    const i0 = g.vert(o.subtract(d), UP, 0, 1, 0.5), i1 = g.vert(o.add(d), UP, 1, 1, 0.5);
    const i2 = g.vert(o.subtract(d).add(top), UP, 0, 0, 1), i3 = g.vert(o.add(d).add(top), UP, 1, 0, 1);
    g.tri(i0, i2, i1); g.tri(i1, i2, i3);
  }
  return g;
}

// ── Piazzamento ─────────────────────────────────────────────────────────────

/**
 * Matrice di una pianta bassa posata sul terreno: il suo "su" segue la normale del pendio (presa
 * su un'impronta di raggio `r`), poi la pianta gira su se stessa. Con la base orizzontale, sui
 * dislivelli un lato affonda e l'altro resta sospeso. `follow` 0..1 = quanto si inclina (i
 * cespugli solo in parte: crescono verso l'alto). Gli alberi restano dritti e usano `trs`.
 */
function grounded(x: number, z: number, sink: number, s: number | Vector3, yaw: number, r: number, follow = 1): Matrix {
  const n = new Vector3(terrainHeight(x - r, z) - terrainHeight(x + r, z), 2 * r, terrainHeight(x, z - r) - terrainHeight(x, z + r)).normalize();
  const tilt = Quaternion.FromUnitVectorsToRef(UP, Vector3.Lerp(UP, n, follow).normalize(), new Quaternion());
  return Matrix.Compose(typeof s === "number" ? new Vector3(s, s, s) : s, tilt.multiplyInPlace(Quaternion.RotationAxis(UP, yaw)), new Vector3(x, terrainHeight(x, z) - sink, z));
}

export interface Vegetation { casters: Mesh[]; receivers: Mesh[]; grass: Mesh[]; colliders: Collider[] }

export function createVegetation(scene: Scene, clearings: Collider[]): Vegetation {
  const rnd = mulberry32(0x51DE);
  const bark = barkTex(scene);
  const barkMat = surfaceMaterial(scene, "barkMat", bark, { tint: new Color3(0.95, 0.85, 0.78) });
  const barkMatGrey = surfaceMaterial(scene, "barkGreyMat", bark, { tint: new Color3(0.85, 0.82, 0.8) });
  const deadMat = surfaceMaterial(scene, "deadBarkMat", bark, { tint: new Color3(0.75, 0.72, 0.7) });
  const spruceMat = foliageMaterial(scene, "spruceMat", spruceCardTex(scene), { tint: new Color3(0.9, 1.0, 0.95), translucency: 0.45 });
  const leafTex = leafCardTex(scene);
  const leafMat = foliageMaterial(scene, "leafMat", leafTex, { translucency: 0.8 });
  const bushMat = foliageMaterial(scene, "bushMat", leafTex, { tint: new Color3(0.8, 0.9, 0.75), translucency: 0.7 });
  const fernMat = foliageMaterial(scene, "fernMat", fernCardTex(scene), { translucency: 0.8 });
  fernMat.alphaCutOff = 0.35;
  addWind(spruceMat, 0.12, 0.02, 18);
  addWind(leafMat, 0.18, 0.04, 14);
  addWind(bushMat, 0.04, 0.03, 1);
  addWind(fernMat, 0.06, 0.03, 0.9);
  // la corteccia ondeggia come la sua chioma, o le foglie si staccherebbero dai rami
  addWind(barkMat, 0.12, 0, 18);
  addWind(barkMatGrey, 0.18, 0, 14);
  addWind(deadMat, 0.12, 0, 18);

  // varianti
  type Species = { bark: Mesh; leaves?: Mesh; height: number; trunk: number; items: Placement[] };
  const species: Species[] = [];
  const make = (name: string, g: { bark: Geo; leaves: Geo }, H: number, bm: typeof barkMat, lm: typeof leafMat | null, trunk: number): Species => {
    const b = g.bark.mesh(`${name}Bark`, scene); b.material = bm;
    let l: Mesh | undefined;
    if (lm && g.leaves.idx.length) { l = g.leaves.mesh(`${name}Leaves`, scene); l.material = lm; }
    const s = { bark: b, leaves: l, height: H, trunk, items: [] as Placement[] };
    species.push(s);
    return s;
  };
  const spruces = [0, 1, 2].map((i) => make(`spruce${i}`, buildSpruce(mulberry32(100 + i), 16 + i * 3), 16 + i * 3, barkMat, spruceMat, 0.42));
  const broad = [0, 1].map((i) => make(`broad${i}`, buildBroadleaf(mulberry32(200 + i), 13 + i * 3, true), 13 + i * 3, barkMatGrey, leafMat, 0.45));
  const dead = [make("dead0", buildBroadleaf(mulberry32(300), 11, false), 11, deadMat, null, 0.35)];

  const colliders: Collider[] = [];
  const blocked = (x: number, z: number, r: number): boolean =>
    (townDist(x, z) < r + 5 && !greenAt(x, z)) || riverDist(x, z) < r + 2.5 || clearings.some((c) => Math.hypot(x - c.x, z - c.z) < c.r + r);
  // il bosco continua a est, attorno alla città: x a caso su tutta la larghezza, lasciando `m` di margine
  const anyX = (m: number): number => -HALF + m / 2 + rnd() * (HALF * 2 + EAST - m);

  // alberi: griglia con jitter, probabilità dalla densità del bosco
  const cell = 5.2;
  for (let gx = -HALF + 6; gx < HALF + EAST - 6; gx += cell) for (let gz = -HALF + 6; gz < HALF - 6; gz += cell) {
    const x = gx + rnd() * cell, z = gz + rnd() * cell;
    const d = forestDensity(x, z);
    const roll = rnd();
    if (roll > d * 0.85 + 0.025) continue;
    if (pathDist(x, z) < 3.2 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 13 || blocked(x, z, 1.5)) continue;
    const meadowish = 1 - d;
    const pick = rnd();
    const sp = pick < 0.06 ? dead[0]
      : pick < 0.06 + by(0.12, 0.32) + meadowish * 0.35 ? broad[(rnd() * broad.length) | 0]
      : spruces[(rnd() * spruces.length) | 0];
    const s = 0.75 + rnd() * 0.55;
    const y = terrainHeight(x, z) - 0.1;
    const tint = 0.85 + rnd() * 0.25;
    sp.items.push({ m: trs(x, y, z, s, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.05, (rnd() - 0.5) * 0.05),
      color: new Color4(tint, tint * (0.95 + rnd() * 0.1), tint * 0.95, 1) });
    colliders.push({ x, z, r: sp.trunk * s });
  }

  const casters: Mesh[] = [], receivers: Mesh[] = [];
  for (const sp of species) {
    const b = scatter(sp.bark, sp.items, 48);
    casters.push(...b); receivers.push(...b);
    if (sp.leaves) { const l = scatter(sp.leaves, sp.items, 48); casters.push(...l); receivers.push(...l); }
  }

  // cespugli: ai margini del bosco
  const bushVariants = [0, 1, 2].map((i) => { const m = buildBush(mulberry32(400 + i)).mesh(`bush${i}`, scene); m.material = bushMat; return { m, items: [] as Placement[] }; });
  for (let i = 0; i < 1350; i++) {
    const x = anyX(16), z = (rnd() - 0.5) * (HALF * 2 - 16);
    const d = forestDensity(x, z);
    if (rnd() > d * (1 - d) * 3 + 0.05 || pathDist(x, z) < 2.4 || Math.hypot(x - SPAWN.x, z - SPAWN.z) < 9 || blocked(x, z, 1) || pitDist(x, z) < 1) continue;
    const s = 0.8 + rnd() * 1.1, t = 0.85 + rnd() * 0.3;
    bushVariants[(rnd() * 3) | 0].items.push({ m: grounded(x, z, 0.15, new Vector3(s * (1 + rnd() * 0.5), s, s * (1 + rnd() * 0.5)), rnd() * 6.28, 0.9, 0.6), color: new Color4(t, t, t * 0.9, 1) });
  }
  for (const v of bushVariants) { const m = scatter(v.m, v.items, 64); casters.push(...m); receivers.push(...m); }

  // felci: nel sottobosco, a gruppi
  const ferns = [0, 1, 2].map((i) => { const m = buildFern(mulberry32(500 + i)).mesh(`fern${i}`, scene); m.material = fernMat; return { m, items: [] as Placement[] }; });
  for (let i = 0; i < 13500; i++) {
    const x = anyX(10), z = (rnd() - 0.5) * (HALF * 2 - 10);
    const d = forestDensity(x, z);
    const patch = fbm2(x / 12, z / 12, 3, 601) * 0.5 + 0.5;
    if (rnd() > d * smoothstep(0.45, 0.65, patch) * 0.9 || pathDist(x, z) < 1.8 || blocked(x, z, 0.5) || pitDist(x, z) < 0.5) continue;
    const s = 0.7 + rnd() * 0.7, t = 0.8 + rnd() * 0.35;
    ferns[(rnd() * 3) | 0].items.push({ m: grounded(x, z, 0.05, s, rnd() * 6.28, 0.5), color: new Color4(t, t, t * 0.85, 1) });
  }
  for (const v of ferns) receivers.push(...scatter(v.m, v.items, 48));

  // erba: densa nei prati e nella radura, rada nel bosco, niente sul sentiero
  const grassMat = DARK ? foliageMaterial(scene, "grassMat", grassCardTex(scene)) : grassMaterial(scene);
  addWind(grassMat, 0.07, 0.025, 0.6);
  const clumps = [0, 1].map((i) => { const m = (DARK ? buildGrassCross : buildGrassPatch)(mulberry32(700 + i)).mesh(`grass${i}`, scene); m.material = grassMat; return { m, items: [] as Placement[] }; });
  for (let i = 0; i < 78000; i++) {
    const x = anyX(8), z = (rnd() - 0.5) * (HALF * 2 - 8);
    const d = forestDensity(x, z);
    const pd = pathDist(x, z);
    const p = (1 - d * 0.85) * smoothstep(1.4, 3.0, pd) * (greenAt(x, z) ? 1 : smoothstep(1.5, 6, townDist(x, z))) * smoothstep(0.5, 2.5, riverDist(x, z)) * (0.55 + 0.45 * (fbm2(x / 8, z / 8, 2, 801) * 0.5 + 0.5));
    // ⚠️ solo qui e in felci e cespugli: gli alberi vengono prima nella fila dei numeri a caso, e non devono spostarsi
    if (rnd() > p || pitDist(x, z) < 0.4) continue;
    const s = 0.7 + rnd() * 0.7 + (1 - d) * 0.3;
    const dryness = clamp(fbm2(x / 30, z / 30, 3, 802) * 0.8 + 0.5);
    const c = DARK ? Color3.Lerp(new Color3(0.75, 0.95, 0.7), new Color3(1.05, 1.0, 0.72), dryness)
      : Color3.Lerp(new Color3(0.85, 1.0, 0.85), new Color3(1.25, 1.1, 0.7), dryness);
    clumps[(rnd() * 2) | 0].items.push({ m: grounded(x, z, 0.03, new Vector3(s, s * (0.8 + rnd() * 0.5) * by(1, 0.55), s), rnd() * 6.28, 0.3),
      color: new Color4(c.r, c.g, c.b, 1) });
  }
  const grass: Mesh[] = [];
  for (const v of clumps) grass.push(...scatter(v.m, v.items, 32));
  receivers.push(...grass);

  return { casters, receivers, grass, colliders };
}
