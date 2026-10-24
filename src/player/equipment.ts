import { BaseTexture, Color3, Mesh, MeshBuilder, PBRMaterial, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { Geo, tube } from "../world/geo";
import { surfaceMaterial } from "../world/materials";
import { leatherTex, planksTex } from "../world/textures";

// ─────────────────────────────────────────────────────────────────────────────
// EQUIPAGGIAMENTO — spada d'acciaio e scudo rotondo di assi cerchiato di ferro,
// con le braccia guantate che li tengono. Coordinate locali in metri:
//   spada: impugnatura all'origine, lama lungo +Y;
//   scudo: faccia (umbone) verso +Z, impugnatura dietro.
// ─────────────────────────────────────────────────────────────────────────────

function metal(scene: Scene, name: string, color: Color3, rough: number, env: BaseTexture): PBRMaterial {
  const m = new PBRMaterial(name, scene);
  m.albedoColor = color;
  // non del tutto metallico: senza una vera mappa d'ambiente HDR l'acciaio puro esce nero
  m.metallic = 0.7;
  m.roughness = rough;
  m.reflectionTexture = env;
  m.realTimeFiltering = true;
  return m;
}

/** Lama a sezione esagonale (sguscio piatto al centro), sfaccettata: ogni faccia ha le sue normali. */
function blade(scene: Scene): Mesh {
  const g = new Geo();
  const L = 0.86, n = 12;
  const ring = (t: number): Vector3[] => {
    const w = t < 0.82 ? 0.024 * (1 - t * 0.22) : 0.024 * 0.82 * Math.max(0, (1 - t) / 0.18);
    const th = 0.0055 * (1 - t * 0.5) + 0.001;
    const y = 0.03 + t * L;
    return [new Vector3(w, y, 0), new Vector3(w * 0.32, y, th), new Vector3(-w * 0.32, y, th),
      new Vector3(-w, y, 0), new Vector3(-w * 0.32, y, -th), new Vector3(w * 0.32, y, -th)];
  };
  for (let i = 0; i < n; i++) {
    const a = ring(i / n), b = ring((i + 1) / n);
    for (let k = 0; k < 6; k++) {
      const k1 = (k + 1) % 6;
      const nrm = Vector3.Cross(b[k].subtract(a[k]), a[k1].subtract(a[k])).normalize();
      const v0 = g.vert(a[k], nrm, 0, 0), v1 = g.vert(a[k1], nrm, 1, 0), v2 = g.vert(b[k], nrm, 0, 1), v3 = g.vert(b[k1], nrm, 1, 1);
      g.tri(v0, v2, v1); g.tri(v1, v2, v3);
    }
  }
  return g.mesh("blade", scene);
}

export function buildSword(scene: Scene, env: BaseTexture): TransformNode {
  const root = new TransformNode("sword", scene);
  const steel = metal(scene, "steel", new Color3(0.82, 0.83, 0.86), 0.2, env);
  const iron = metal(scene, "iron", new Color3(0.36, 0.33, 0.3), 0.5, env);
  const leather = surfaceMaterial(scene, "gripLeather", leatherTex(scene), { rough: 0.8, uv: [1, 3] });

  const b = blade(scene); b.material = steel; b.parent = root;
  // guardia: barra con le estremità piegate verso la lama
  const gg = new Geo();
  tube(gg, [new Vector3(-0.11, 0.035, 0), new Vector3(-0.08, 0.012, 0), new Vector3(0, 0, 0), new Vector3(0.08, 0.012, 0), new Vector3(0.11, 0.035, 0)],
    [0.009, 0.012, 0.016, 0.012, 0.009], 8, 1, 1);
  const guard = gg.mesh("guard", scene); guard.material = iron; guard.parent = root;
  const grip = MeshBuilder.CreateCylinder("grip", { height: 0.17, diameterTop: 0.03, diameterBottom: 0.034, tessellation: 14 }, scene);
  grip.position.y = -0.09; grip.material = leather; grip.parent = root;
  const pommel = MeshBuilder.CreateSphere("pommel", { diameterX: 0.05, diameterY: 0.04, diameterZ: 0.05, segments: 12 }, scene);
  pommel.position.y = -0.19; pommel.material = iron; pommel.parent = root;
  return root;
}

export function buildShield(scene: Scene, env: BaseTexture): TransformNode {
  const root = new TransformNode("shield", scene);
  const R = 0.34;
  const wood = surfaceMaterial(scene, "shieldWood", planksTex(scene), { rough: 0.8 });
  wood.backFaceCulling = false;   // faccia e retro sono due dischi: si vedono entrambi da ogni lato
  const iron = metal(scene, "shieldIron", new Color3(0.32, 0.3, 0.28), 0.55, env);
  const leather = surfaceMaterial(scene, "strapLeather", leatherTex(scene), { rough: 0.85 });

  // faccia bombata (+Z) e retro piatto (−Z), uv planari sulle assi
  const disc = (front: boolean): Mesh => {
    const g = new Geo();
    const rings = 8, seg = 40;
    const z = (r: number): number => front ? 0.012 + (1 - (r / R) ** 2) * 0.045 : -0.012;
    const c = g.vert(new Vector3(0, 0, z(0)), new Vector3(0, 0, front ? 1 : -1), 0.5, 0.5);
    for (let i = 1; i <= rings; i++) for (let s = 0; s <= seg; s++) {
      const r = (i / rings) * R, a = (s / seg) * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const slope = front ? 2 * 0.045 * r / (R * R) : 0;
      const nrm = new Vector3(x / Math.max(r, 1e-4) * slope, y / Math.max(r, 1e-4) * slope, front ? 1 : -1).normalize();
      g.vert(new Vector3(x, y, z(r)), nrm, x / (2 * R) + 0.5, y / (2 * R) + 0.5);
    }
    for (let s = 0; s < seg; s++) front ? g.tri(c, 1 + s, 2 + s) : g.tri(c, 2 + s, 1 + s);
    for (let i = 0; i < rings - 1; i++) for (let s = 0; s < seg; s++) {
      const a = 1 + i * (seg + 1) + s, b = a + seg + 1;
      if (front) { g.tri(a, b, a + 1); g.tri(a + 1, b, b + 1); } else { g.tri(a, a + 1, b); g.tri(a + 1, b + 1, b); }
    }
    const m = g.mesh(front ? "shieldFront" : "shieldBack", scene);
    m.material = wood; m.parent = root;
    return m;
  };
  disc(true); disc(false);

  const rim = MeshBuilder.CreateTorus("rim", { diameter: R * 2, thickness: 0.03, tessellation: 64 }, scene);
  rim.rotation.x = Math.PI / 2; rim.scaling.y = 1.6; rim.material = iron; rim.parent = root;
  const boss = MeshBuilder.CreateSphere("boss", { diameter: 0.14, segments: 16, slice: 0.5 }, scene);
  boss.rotation.x = Math.PI / 2; boss.position.z = 0.05; boss.scaling.y = 0.7; boss.material = iron; boss.parent = root;
  // due fasce di ferro inchiodate di traverso
  for (const y of [-0.15, 0.15]) {
    const band = MeshBuilder.CreateBox("band", { width: Math.sqrt(R * R - y * y) * 2, height: 0.035, depth: 0.012 }, scene);
    band.position.set(0, y, 0.012 + (1 - (y / R) ** 2) * 0.045 * 0.75); band.material = iron; band.parent = root;
  }
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const rv = MeshBuilder.CreateSphere("rivet", { diameter: 0.018, segments: 6 }, scene);
    rv.position.set(Math.cos(a) * (R - 0.025), Math.sin(a) * (R - 0.025), 0.016); rv.material = iron; rv.parent = root;
  }
  // retro: impugnatura e cinghia per l'avambraccio
  const handle = MeshBuilder.CreateBox("handle", { width: 0.16, height: 0.035, depth: 0.03 }, scene);
  handle.position.set(0, -0.02, -0.04); handle.material = leather; handle.parent = root;
  const strap = MeshBuilder.CreateBox("strap", { width: 0.05, height: 0.2, depth: 0.012 }, scene);
  strap.position.set(-0.1, 0.0, -0.025); strap.material = leather; strap.parent = root;
  return root;
}

/** Avambraccio guantato + pugno chiuso: il pugno è all'origine, l'avambraccio scende lungo −Z/−Y. */
export function buildArm(scene: Scene, name: string, mirror: boolean): TransformNode {
  const root = new TransformNode(name, scene);
  const glove = surfaceMaterial(scene, `${name}Glove`, leatherTex(scene), { rough: 0.85, tint: new Color3(0.55, 0.45, 0.38) });
  const sleeve = surfaceMaterial(scene, `${name}Sleeve`, leatherTex(scene), { rough: 0.9, tint: new Color3(0.42, 0.33, 0.26), uv: [2, 1] });
  const fist = MeshBuilder.CreateSphere(`${name}Fist`, { diameterX: 0.085, diameterY: 0.1, diameterZ: 0.095, segments: 12 }, scene);
  fist.material = glove; fist.parent = root;
  const g = new Geo();
  const sx = mirror ? -1 : 1;
  tube(g, [new Vector3(0, 0, -0.02), new Vector3(sx * 0.02, -0.04, -0.14), new Vector3(sx * 0.05, -0.1, -0.3), new Vector3(sx * 0.08, -0.18, -0.45)],
    [0.04, 0.046, 0.055, 0.06], 14, 2, 0.3);
  const arm = g.mesh(`${name}Forearm`, scene); arm.material = sleeve; arm.parent = root;
  // bracciale di cuoio rinforzato al polso
  const cuff = MeshBuilder.CreateCylinder(`${name}Cuff`, { height: 0.08, diameterTop: 0.1, diameterBottom: 0.11, tessellation: 16 }, scene);
  cuff.rotation.x = Math.PI / 2 - 0.3; cuff.position.set(sx * 0.012, -0.03, -0.1); cuff.material = glove; cuff.parent = root;
  return root;
}
