import type { BLADES } from "../data/db";
import { BaseTexture, Color3, Mesh, MeshBuilder, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { Geo, strip, tube } from "../world/geo";
import { PBRCustomMaterial } from "@babylonjs/materials";
import { lampLit, surfaceMaterial } from "../world/materials";
import { hideTex, ironTex, leatherTex, planksTex, shieldFaceTex, steelTex, type TexPair } from "../world/textures";
import { by } from "../style";
import { LIGHT } from "../world/interiors";

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPAGGIAMENTO — spada lunga d'acciaio, scudo tondo dipinto e cerchiato di ferro, e le mani
// guantate che li tengono. Tutto nel sistema della MANO (metri):
//   +Y lungo la lama (o il "su" dello scudo), il pugno all'origine attorno a un'impugnatura lungo Y,
//   +Z dove guardano le nocche, l'avambraccio che torna indietro lungo −Z.
// Spada: la lama è larga lungo Z (il filo guarda dove guardano le nocche) e sottile lungo X; chi la
//   anima la fa rollare attorno a Y per mostrare il piatto o portare avanti il filo.
// Scudo: la faccia (umbone) guarda +Z, l'impugnatura è una barra verticale dietro l'umbone.
// ─────────────────────────────────────────────────────────────────────────────

function metal(scene: Scene, name: string, tex: TexPair, tint: Color3, rough: number, env: BaseTexture): PBRMaterial {
  const m = new PBRCustomMaterial(name, scene);
  lampLit(m, LIGHT, 0.16);   // (e, dentro, quella della stanza, che ci si riflette)   // la lama e i ferri prendono la luce dei lampioni come il resto
  m.albedoTexture = tex.albedo;
  m.bumpTexture = tex.normal;
  m.bumpTexture.level = 0.6;
  m.albedoColor = tint.scale(by(1, 0.5));
  m.metallic = by(0.9, 0.6);
  m.roughness = by(rough, Math.min(1, rough + 0.2));
  m.reflectionTexture = env;
  m.environmentIntensity = by(0.55, 0.25);   // il cielo catturato non sa del bosco che copre: senza freno la lama brilla all'ombra
  m.realTimeFiltering = true;
  return m;
}

/** Un quadrilatero a facce piatte, orientato verso `out` (ogni faccia ha le sue normali: spigoli vivi). */
function quad(g: Geo, a: Vector3, b: Vector3, c: Vector3, d: Vector3, out: Vector3, uv: [number, number, number, number]): void {
  let n = Vector3.Cross(b.subtract(a), c.subtract(a));
  if (n.lengthSquared() < 1e-14) n = Vector3.Cross(d.subtract(b), c.subtract(b));
  n.normalize();
  const flip = Vector3.Dot(n, out) < 0;
  if (flip) n.scaleInPlace(-1);
  const [u0, v0, u1, v1] = uv;
  const i0 = g.vert(a, n, u0, v0), i1 = g.vert(b, n, u1, v0), i2 = g.vert(c, n, u0, v1), i3 = g.vert(d, n, u1, v1);
  // ⚠️ il verso che Babylon considera "davanti" è quello di geo.ts/tube: (a, c, b), (b, c, d) con n = (b−a)×(c−a) rovesciata
  if (flip) { g.tri(i0, i1, i2); g.tri(i1, i3, i2); } else { g.tri(i0, i2, i1); g.tri(i1, i2, i3); }
}

/**
 * Lama: sezione a losanga con lo sguscio (la scanalatura al centro) sui due piatti, fili smussati,
 * rastremata in larghezza e spessore, con la punta che chiude a ogiva. Lo sguscio muore ai tre quarti.
 */
function blade(scene: Scene): Mesh {
  const g = new Geo();
  const L = 0.86, Y0 = 0.082, N = 24;
  const half = (t: number): [number, number][] => {
    const tip = Math.max(0, (t - 0.84) / 0.16);
    const w = 0.0275 * (1 - t * 0.3) * Math.sqrt(Math.max(0, 1 - tip * tip)) + 0.0002;
    const th = (0.0064 - t * 0.003) * (1 - tip * 0.5);
    const f = t < 0.68 ? 1 : Math.max(0, 1 - (t - 0.68) / 0.1);
    return [[w, 0], [w * 0.56, th * 0.82], [w * 0.27, th], [0, th * (1 - 0.6 * f)], [-w * 0.27, th], [-w * 0.56, th * 0.82], [-w, 0]];
  };
  // anello completo: il lato +x da un filo all'altro, poi il lato −x al ritorno
  const ring = (t: number): Vector3[] => {
    const h = half(t), y = Y0 + t * L;
    const pts = h.map(([z, x]) => new Vector3(x, y, z));
    for (let k = h.length - 2; k >= 1; k--) pts.push(new Vector3(-h[k][1], y, h[k][0]));
    return pts;
  };
  for (let i = 0; i < N; i++) {
    const a = ring(i / N), b = ring((i + 1) / N), n = a.length;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const mid = a[k].add(a[k1]).scale(0.5);
      quad(g, a[k], a[k1], b[k], b[k1], new Vector3(mid.x, 0, mid.z * 0.05),
        [a[k].z / 0.055 + 0.5, (Y0 + (i / N) * L) / 0.3, a[k1].z / 0.055 + 0.5, (Y0 + ((i + 1) / N) * L) / 0.3]);
    }
  }
  return g.mesh("blade", scene);
}

/** Solido di rivoluzione attorno a un asse: profilo [raggio, quota]. Le normali si ricalcolano dalla forma. */
function lathe(scene: Scene, name: string, profile: [number, number][], sides: number, axis: "y" | "z"): Mesh {
  const g = new Geo();
  tube(g, profile.map(([, h]) => (axis === "y" ? new Vector3(0, h, 0) : new Vector3(0, 0, h))), profile.map(([r]) => r), sides, 2, 0.08);
  const m = g.mesh(name, scene);
  m.createNormals(false);
  return m;
}

/** Gli aspetti della lama che gli oggetti del file possono richiamare (`equip.look`): tinta e ruvidezza dell'acciaio. */
const BLADE: Record<typeof BLADES[number], [Color3, number]> = { ferro: [new Color3(1, 1, 1), 0.36], argento: [new Color3(1.55, 1.6, 1.8), 0.16] };

/** Cambia l'aspetto della lama della spada in mano (quando se ne impugna un'altra). */
export function swordLook(scene: Scene, look: typeof BLADES[number]): void {
  const m = scene.getMaterialByName("steel") as PBRMaterial | null, [tint, rough] = BLADE[look];
  if (!m) return;
  m.albedoColor = tint.scale(by(1, 0.5));
  m.roughness = by(rough, Math.min(1, rough + 0.2));
}

export function buildSword(scene: Scene, env: BaseTexture): TransformNode {
  const root = new TransformNode("sword", scene);
  const steel = metal(scene, "steel", steelTex(scene), new Color3(1, 1, 1), 0.36, env);
  const iron = metal(scene, "swordIron", ironTex(scene), new Color3(1.25, 1.2, 1.15), 0.5, env);
  const bronze = metal(scene, "bronze", ironTex(scene), new Color3(2.2, 1.5, 0.75), 0.42, env);
  const wrap = surfaceMaterial(scene, "gripLeather", leatherTex(scene), { indoor: LIGHT, rough: 0.8 });
  steel.backFaceCulling = false;
  const add = (m: Mesh, mat: PBRMaterial): Mesh => { m.material = mat; m.parent = root; return m; };

  add(blade(scene), steel);

  // guardia: una barra che si assottiglia e risale verso la lama, con i terminali a bottone
  const gg = new Geo();
  const gz = [-0.108, -0.092, -0.05, 0, 0.05, 0.092, 0.108], gy = [0.086, 0.074, 0.066, 0.064, 0.066, 0.074, 0.086];
  tube(gg, gz.map((z, i) => new Vector3(0, gy[i], z)), [0.0078, 0.007, 0.0095, 0.0125, 0.0095, 0.007, 0.0078], 10, 1, 0.08);
  add(gg.mesh("guard", scene), iron);
  for (const s of [-1, 1]) {
    const knob = MeshBuilder.CreateSphere("quillon", { diameter: 0.024, segments: 10 }, scene);
    knob.position.set(0, 0.09, s * 0.112);
    add(knob, iron);
  }
  // la piastra della guardia sopra la base della lama
  const langet = MeshBuilder.CreateBox("langet", { width: 0.02, height: 0.034, depth: 0.05 }, scene);
  langet.position.y = 0.078;
  add(langet, iron);

  // impugnatura fasciata di cuoio, più gonfia al centro, fra due ghiere di bronzo
  const hg = new Geo();
  const hn = 8;
  tube(hg, Array.from({ length: hn + 1 }, (_, i) => new Vector3(0, -0.088 + (i / hn) * 0.146, 0)),
    Array.from({ length: hn + 1 }, (_, i) => 0.0124 + 0.0024 * Math.sin((i / hn) * Math.PI)), 14, 1, 0.045);
  add(hg.mesh("grip", scene), wrap);
  for (const y of [0.056, -0.086]) {
    const ring = MeshBuilder.CreateTorus("ferrule", { diameter: 0.029, thickness: 0.007, tessellation: 20 }, scene);
    ring.position.y = y;
    add(ring, bronze);
  }
  // pomo a cipolla, sfaccettato, col ribattino in fondo
  add(lathe(scene, "pommel", [[0.0105, -0.088], [0.019, -0.094], [0.0265, -0.104], [0.0275, -0.116], [0.0225, -0.128], [0.012, -0.137], [0.006, -0.141], [0.0005, -0.143]], 10, "y"), iron);
  return root;
}

export function buildShield(scene: Scene, env: BaseTexture): TransformNode {
  const root = new TransformNode("shield", scene);
  const R = 0.37, T = 0.011, DOME = 0.05, Z0 = 0.03;
  const face = surfaceMaterial(scene, "shieldFace", shieldFaceTex(scene), { indoor: LIGHT, rough: 0.72 });
  const back = surfaceMaterial(scene, "shieldBack", planksTex(scene), { indoor: LIGHT, rough: 0.85, tint: new Color3(1.1, 1.0, 0.92) });
  const iron = metal(scene, "shieldIron", ironTex(scene), new Color3(1.05, 1, 0.97), 0.58, env);
  const leather = surfaceMaterial(scene, "handleLeather", leatherTex(scene), { indoor: LIGHT, rough: 0.85 });
  const add = (m: Mesh, mat: PBRMaterial): Mesh => { m.material = mat; m.parent = root; return m; };

  // il tavolato è una lente: bombato davanti, cavo dietro (dove sta il pugno)
  const zf = (r: number): number => Z0 + T + DOME * (1 - (r / R) ** 2);
  const zb = (r: number): number => Z0 - T + DOME * 0.85 * (1 - (r / R) ** 2);
  const disc = (front: boolean): Mesh => {
    const g = new Geo();
    const rings = 10, seg = 48, z = front ? zf : zb, sgn = front ? 1 : -1;
    const k = 2 * DOME * (front ? 1 : 0.85) / (R * R);
    const c = g.vert(new Vector3(0, 0, z(0)), new Vector3(0, 0, sgn), 0.5, 0.5);
    for (let i = 1; i <= rings; i++) for (let s = 0; s <= seg; s++) {
      const r = (i / rings) * R, a = (s / seg) * Math.PI * 2, x = Math.cos(a) * r, y = Math.sin(a) * r;
      g.vert(new Vector3(x, y, z(r)), new Vector3(x * k * sgn, y * k * sgn, sgn).normalize(), x / (2 * R) + 0.5, y / (2 * R) + 0.5);
    }
    for (let s = 0; s < seg; s++) front ? g.tri(c, 1 + s, 2 + s) : g.tri(c, 2 + s, 1 + s);
    for (let i = 0; i < rings - 1; i++) for (let s = 0; s < seg; s++) {
      const a = 1 + i * (seg + 1) + s, b = a + seg + 1;
      if (front) { g.tri(a, b, a + 1); g.tri(a + 1, b, b + 1); } else { g.tri(a, a + 1, b); g.tri(a + 1, b + 1, b); }
    }
    return g.mesh(front ? "shieldFront" : "shieldBack", scene);
  };
  // ⚠️ senza culling: i due dischi hanno il verso che torna visto da una parte sola (vedi CLAUDE.md)
  face.backFaceCulling = false; back.backFaceCulling = false;
  add(disc(true), face);
  add(disc(false), back);

  // cerchiatura di ferro attorno al bordo, coi suoi chiodi
  const rg = new Geo();
  const rim: Vector3[] = [];
  for (let s = 0; s <= 64; s++) { const a = (s / 64) * Math.PI * 2; rim.push(new Vector3(Math.cos(a) * R, Math.sin(a) * R, Z0)); }
  tube(rg, rim, rim.map(() => 0.0165), 10, 12, 0.1);
  add(rg.mesh("rim", scene), iron);
  const rivet = (x: number, y: number, z: number, d: number): void => {
    const m = MeshBuilder.CreateSphere("rivet", { diameter: d, segments: 6 }, scene);
    m.position.set(x, y, z); m.scaling.z = 0.6;
    add(m, iron);
  };
  for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2 + 0.2, r = R - 0.032; rivet(Math.cos(a) * r, Math.sin(a) * r, zf(r) + 0.002, 0.017); }

  // quattro bande di ferro dall'umbone al bordo, adagiate sulla bombatura
  const bg = new Geo();
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2, dx = Math.cos(a), dy = Math.sin(a);
    const at = (t: number): number => 0.085 + t * (R - 0.1);
    strip(bg, 6, (t) => new Vector3(dx * at(t), dy * at(t), zf(at(t)) + 0.0035), () => new Vector3(-dy * 0.021, dx * 0.021, 0),
      (p) => new Vector3(p.x * 0.7, p.y * 0.7, 1).normalize(), (t, s) => [s * 0.3, t * 1.4], () => 1);
    for (const t of [0.25, 0.6, 0.93]) rivet(dx * at(t), dy * at(t), zf(at(t)) + 0.006, 0.014);
  }
  const bands = bg.mesh("bands", scene);
  add(bands, iron);
  (bands.material as PBRMaterial).backFaceCulling = false;

  // umbone: una falda piatta inchiodata e la cupola
  const zc = zf(0);
  add(lathe(scene, "boss", [[0.1, zf(0.1) + 0.001], [0.098, zf(0.098) + 0.006], [0.072, zf(0.072) + 0.007], [0.064, zc + 0.014], [0.054, zc + 0.034],
    [0.038, zc + 0.05], [0.02, zc + 0.059], [0.006, zc + 0.062], [0.0005, zc + 0.0625]], 24, "z"), iron);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; rivet(Math.cos(a) * 0.086, Math.sin(a) * 0.086, zf(0.086) + 0.008, 0.012); }

  // dietro: l'impugnatura verticale fasciata, i suoi attacchi di ferro, due traverse di legno
  const hg = new Geo();
  tube(hg, [-0.15, -0.1, 0, 0.1, 0.15].map((y) => new Vector3(0, y, 0)), [0.011, 0.0135, 0.0145, 0.0135, 0.011], 12, 1, 0.045);
  add(hg.mesh("handle", scene), leather);
  for (const s of [-1, 1]) {
    const mount = MeshBuilder.CreateBox("mount", { width: 0.03, height: 0.03, depth: zb(0.16) + 0.012 }, scene);
    mount.position.set(0, s * 0.16, (zb(0.16) - 0.012) / 2 + 0.006);
    add(mount, iron);
    const y = s * 0.215, w = Math.sqrt(R * R - y * y) * 2 - 0.05;
    const batten = MeshBuilder.CreateBox("batten", { width: w, height: 0.04, depth: 0.014 }, scene);
    batten.position.set(0, y, zb(Math.abs(y)) - 0.012);
    add(batten, back);
  }
  return root;
}

/**
 * La mano guantata chiusa attorno a un'impugnatura verticale, con l'avambraccio e il bracciale di cuoio.
 * Mano destra; `mirror` la specchia in x per la sinistra. Le dita partono dal dorso (+x), girano
 * davanti all'impugnatura (le nocche, +z) e chiudono sul palmo; il pollice ci passa sopra.
 */
export function buildArm(scene: Scene, name: string, mirror: boolean): TransformNode {
  const root = new TransformNode(name, scene);
  const sx = mirror ? -1 : 1;
  const hide = hideTex(scene);
  // ⚠️ niente `uv` sui materiali: le texture sono condivise per nome, la scala sta nelle uv dei tubi
  const glove = surfaceMaterial(scene, `${name}Glove`, hide, { indoor: LIGHT, rough: 0.78, tint: new Color3(1.25, 1.02, 0.84) });
  const sleeve = surfaceMaterial(scene, `${name}Sleeve`, hide, { indoor: LIGHT, rough: 0.9, tint: new Color3(0.8, 0.74, 0.66) });
  const bracer = surfaceMaterial(scene, `${name}Bracer`, leatherTex(scene), { indoor: LIGHT, rough: 0.7, tint: new Color3(1.5, 1.2, 0.85) });
  const V = (x: number, y: number, z: number): Vector3 => new Vector3(x * sx, y, z);

  const hand = new Geo();
  // quattro dita: ognuna un arco attorno all'impugnatura, che in punta stringe verso il palmo
  const arc = [-0.55, 0.15, 0.85, 1.5, 2.15, 2.8, 3.5, 4.15];
  for (let f = 0; f < 4; f++) {
    const y = 0.036 - f * 0.0235, r = f === 3 ? 0.0092 : 0.0104, rho = 0.0262 - (f === 3 ? 0.001 : 0);
    tube(hand, arc.map((a, i) => { const q = rho - Math.max(0, i - 5) * 0.003; return V(Math.cos(a) * q, y - i * 0.0006, Math.sin(a) * q); }),
      arc.map((_, i) => r * (i === 0 ? 0.85 : i >= 6 ? 0.82 : 1)), 8, 1, 0.05);
  }
  // pollice: dalla base del palmo, di traverso sopra l'indice
  tube(hand, [V(0.012, 0.05, -0.04), V(-0.01, 0.061, -0.014), V(-0.027, 0.058, 0.014), V(-0.031, 0.047, 0.034), V(-0.029, 0.042, 0.042)],
    [0.0125, 0.0122, 0.011, 0.0098, 0.006], 8, 1, 0.05);
  // polso e avambraccio
  tube(hand, [V(0.004, -0.004, -0.04), V(0.008, -0.016, -0.085), V(0.014, -0.03, -0.12)], [0.03, 0.031, 0.033], 12, 1, 0.08);
  const hm = hand.mesh(`${name}Hand`, scene); hm.material = glove; hm.parent = root;
  // dorso e palmo: il blocco a cui si attaccano le dita
  const palm = MeshBuilder.CreateSphere(`${name}Palm`, { diameterX: 0.04, diameterY: 0.104, diameterZ: 0.088, segments: 12 }, scene);
  palm.position.copyFrom(V(0.021, 0, -0.014)); palm.material = glove; palm.parent = root;

  const arm = new Geo();
  const path = [V(0.012, -0.026, -0.11), V(0.022, -0.052, -0.18), V(0.046, -0.1, -0.3), V(0.072, -0.17, -0.45), V(0.09, -0.22, -0.56)];
  tube(arm, path, [0.032, 0.037, 0.044, 0.05, 0.052], 14, 2, 0.12);
  const am = arm.mesh(`${name}Forearm`, scene); am.material = sleeve; am.parent = root;
  // bracciale di cuoio indurito con due cinghie
  const bg = new Geo();
  const at = (t: number): Vector3 => Vector3.Lerp(path[1], path[2], t);
  tube(bg, [at(-0.1), at(0.25), at(0.6), at(0.95)], [0.041, 0.044, 0.047, 0.05], 14, 1, 0.3);
  const bm = bg.mesh(`${name}Bracer`, scene); bm.material = bracer; bm.parent = root;
  const sg = new Geo();
  for (const t of [0.15, 0.7]) tube(sg, [at(t - 0.05), at(t + 0.05)], [0.046 + t * 0.006, 0.047 + t * 0.006], 14, 1, 0.05);
  const sm = sg.mesh(`${name}Straps`, scene); sm.material = sleeve; sm.parent = root;
  return root;
}
