import { Bone, Color3, Matrix, Mesh, MeshBuilder, Scene, Skeleton, StandardMaterial, TransformNode, Vector3, VertexData } from "@babylonjs/core";

// ─────────────────────────────────────────────────────────────────────────────
// CREATURE — quadrupedi procedurali con una pelle sola (skinning a due ossa).
//
// Il corpo è fatto di LOFT sul piano sagittale: una fila di anelli (centro, semilarghezza,
// quanto sale e quanto scende) che disegnano il profilo dell'animale visto di fianco —
// groppa, lombi rientrati, torace profondo, garrese, collo, cranio, muso. Zampe, coda,
// orecchie, mandibola, lingua e denti sono altri loft. Ogni anello dice a quali ossa è
// attaccato: vicino a un'articolazione si divide fra le due, e la pelle si piega invece di spezzarsi.
//
// Le ossa sono guidate da TransformNode (`bone.linkTransformNode`): chi anima ruota i nodi.
// In posa di riposo tutti i nodi hanno rotazione nulla: la geometria è costruita già in piedi.
//
// Convenzioni: +Z avanti, +Y su, origine a terra sotto il corpo. Un angolo θ di un segmento di
// zampa si misura dalla verticale in giù (−Y) verso l'avanti (+Z). ⚠️ rotation.x POSITIVA porta
// l'avanti verso il BASSO (muso giù, zampa indietro): per ruotare un segmento di Δθ serve −Δθ.
// ─────────────────────────────────────────────────────────────────────────────

export type Col = [number, number, number];
/** Chiave d'osso di un anello: una, oppure due con il peso della seconda. */
export type BoneKey = string | [string, string, number];
/** Anello: z, y, semilarghezza, su, giù, colore sopra, colore sotto, osso, [scostamento x]. */
export type R = [number, number, number, number, number, Col, Col, BoneKey, number?];

/** Un loft in più (cranio, muso, mandibola, lingua, orecchie, denti…). */
export interface Part {
  rings: R[];
  sides?: number;
  /** Sezione: 1 = ellisse, sotto 1 più squadrata (un muso non è un cono). */
  sq?: number;
  /** Dove sta il passaggio dal colore di sotto a quello di sopra, da 0 (fondo) a 1 (cima): [0.1, 0.3] = solo una fascia in basso (le labbra). */
  band?: [number, number];
  /** Una copia per lato (orecchie, denti): lo scostamento x degli anelli viene specchiato. */
  mirror?: boolean;
}

export interface LegDef {
  x: number;
  /** Articolazioni [y, z]: anca/spalla, ginocchio/gomito, garretto/polso, appoggio a terra. */
  j: [[number, number], [number, number], [number, number], [number, number]];
  /** Anelli della zampa; ossa: "B" (il tronco), "1", "2", "3". */
  rings: R[];
  paw: R[];
  /** +1 ginocchio in avanti (posteriori), −1 gomito indietro (anteriori). */
  bend: 1 | -1;
}

export interface QuadDef {
  /** Punto a metà schiena attorno a cui ruotano torace e bacino. */
  pivot: [number, number];
  /** Ossa: "P" bacino, "C" torace, "N" collo, "H" testa, "J" mandibola. */
  trunk: R[]; neck: R[];
  neckAt: [number, number]; headAt: [number, number]; jawAt: [number, number];
  /** Testa: cranio, muso, mandibola, lingua, fondo della bocca, orecchie, denti. */
  parts: Part[];
  /** Occhio: centro, raggio, colore dell'iride; la pupilla guarda lungo `look`. */
  eye: { x: number; y: number; z: number; r: number; look: [number, number, number] };
  tail: { pts: [number, number][]; r: number[]; top: Col; bot: Col; tip: Col; rings?: boolean };
  front: LegDef; hind: LegDef;
  sides: number;
}

export interface Leg {
  n: [TransformNode, TransformNode, TransformNode];
  hip: [number, number]; foot: [number, number];
  L: [number, number, number]; rest: [number, number, number];
  bend: 1 | -1; front: boolean;
}

export interface Creature {
  root: TransformNode; mesh: Mesh; eyes: Mesh;
  body: TransformNode; chest: TransformNode; pelvis: TransformNode;
  neck: TransformNode; head: TransformNode; jaw: TransformNode;
  tail: TransformNode[];
  /** AS, AD, PS, PD. */
  legs: Leg[];
  pivot: [number, number];
}

const ang = (a: [number, number], b: [number, number]): number => Math.atan2(b[1] - a[1], -(b[0] - a[0]));
const dist = (a: [number, number], b: [number, number]): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Un dente: cono a quattro facce da `y0` lungo `len` (negativo = verso il basso). */
export function tooth(x: number, z: number, y0: number, len: number, w: number, bone: "H" | "J", col: Col): Part {
  return {
    mirror: true, sides: 4,
    rings: [[z, y0, w, w, w, col, col, bone, x], [z, y0 + len * 0.55, w * 0.7, w * 0.7, w * 0.7, col, col, bone, x], [z, y0 + len, w * 0.12, w * 0.12, w * 0.12, col, col, bone, x]],
  };
}

export function buildQuadruped(scene: Scene, name: string, d: QuadDef, iris: StandardMaterial, pupil: StandardMaterial): Creature {
  const root = new TransformNode(name, scene);
  const skeleton = new Skeleton(`${name}Skel`, `${name}Skel`, scene);
  const nodes = new Map<string, TransformNode>(), index = new Map<string, number>(), abs = new Map<string, Vector3>();
  const bone = (key: string, parent: string | null, y: number, z: number, x = 0): TransformNode => {
    const p = new Vector3(x, y, z);
    const local = parent ? p.subtract(abs.get(parent)!) : p;
    const node = new TransformNode(`${name}:${key}`, scene);
    node.parent = parent ? nodes.get(parent)! : root;
    node.position.copyFrom(local);
    const b = new Bone(key, skeleton, parent ? skeleton.bones[index.get(parent)!] : null, Matrix.Translation(local.x, local.y, local.z));
    b.linkTransformNode(node);
    index.set(key, skeleton.bones.length - 1); nodes.set(key, node); abs.set(key, p);
    return node;
  };

  const P: number[] = [], N: number[] = [], UV: number[] = [], C: number[] = [], BI: number[] = [], BW: number[] = [], I: number[] = [];
  /** Loft sul piano sagittale; `side` specchia x, `map` traduce le chiavi d'osso, `swap` scambia le uv (peli ad anello). */
  const loft = (rings: R[], sides: number, side = 1, x0 = 0, map: (k: string) => string = (k) => k, swap = false, sq = 1, band: [number, number] = [0, 1]): void => {
    const base = P.length / 3;
    let len = 0;
    const pw = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
    rings.forEach((r, i) => {
      const [z, y, w, up, dn, top, bot, bk, dx] = r;
      const a = rings[Math.max(0, i - 1)], b = rings[Math.min(rings.length - 1, i + 1)];
      let ty = b[1] - a[1], tz = b[0] - a[0];
      const tl = Math.hypot(ty, tz) || 1; ty /= tl; tz /= tl;
      const uy = tz, uz = -ty;                       // "su" dell'anello = tangente × X
      if (i > 0) len += Math.hypot(y - rings[i - 1][1], z - rings[i - 1][0]);
      const cx = (x0 + (dx ?? 0)) * side;
      const [b0, b1, wt] = typeof bk === "string" ? [bk, bk, 0] : bk;
      for (let j = 0; j <= sides; j++) {
        const t = (j / sides) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
        const h = s > 0 ? up : dn;
        // superellisse: con sq < 1 i fianchi si appiattiscono e gli spigoli si avvicinano
        const ce = pw(c, sq), se = pw(s, sq);
        P.push(cx + ce * w, y + uy * se * h, z + uz * se * h);
        const nx = pw(c, 2 - sq) / Math.max(w, 1e-4), nu = pw(s, 2 - sq) / Math.max(h, 1e-4), nl = Math.hypot(nx, nu) || 1;
        N.push(nx / nl, uy * nu / nl, uz * nu / nl);
        const u = (j / sides) * 2, v = len * 3;
        UV.push(swap ? v : u, swap ? u : v);
        const k = Math.min(1, Math.max(0, (se * 0.5 + 0.5 - band[0]) / (band[1] - band[0]))), m = k * k * (3 - 2 * k);
        C.push(bot[0] + (top[0] - bot[0]) * m, bot[1] + (top[1] - bot[1]) * m, bot[2] + (top[2] - bot[2]) * m, 1);
        BI.push(index.get(map(b0))!, index.get(map(b1))!, 0, 0);
        BW.push(1 - wt, wt, 0, 0);
      }
    });
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, b = a + sides + 1;
      I.push(a, b, a + 1, a + 1, b, b + 1);
    }
  };

  // ── ossa ──
  const body = bone("body", null, d.pivot[0], d.pivot[1]);
  const pelvis = bone("P", "body", d.pivot[0], d.pivot[1]);
  const chest = bone("C", "body", d.pivot[0], d.pivot[1]);
  const neck = bone("N", "C", ...d.neckAt);
  const head = bone("H", "N", ...d.headAt);
  const jaw = bone("J", "H", ...d.jawAt);
  const tail: TransformNode[] = [];
  d.tail.pts.slice(0, -1).forEach((p, i) => tail.push(bone(`T${i}`, i ? `T${i - 1}` : "P", p[0], p[1])));

  const legs: Leg[] = [];
  for (const [def, part, tag] of [[d.front, "C", "F"], [d.hind, "P", "H"]] as [LegDef, string, string][]) {
    for (const side of [-1, 1]) {
      const id = `${tag}${side < 0 ? "L" : "R"}`;
      const n = [0, 1, 2].map((i) => bone(`${id}${i + 1}`, i ? `${id}${i}` : part, def.j[i][0], def.j[i][1], def.x * side)) as Leg["n"];
      const map = (k: string): string => (k === "B" ? part : `${id}${k}`);
      loft(def.rings, 8, side, def.x, map);
      loft(def.paw, 8, side, def.x, map);
      legs.push({
        n, hip: def.j[0], foot: def.j[3], bend: def.bend, front: tag === "F",
        L: [dist(def.j[0], def.j[1]), dist(def.j[1], def.j[2]), dist(def.j[2], def.j[3])],
        rest: [ang(def.j[0], def.j[1]), ang(def.j[1], def.j[2]), ang(def.j[2], def.j[3])],
      });
    }
  }

  // ── pelle ──
  loft(d.trunk, d.sides);
  loft(d.neck, d.sides);
  for (const p of d.parts) {
    for (const side of p.mirror ? [-1, 1] : [1]) loft(p.rings, p.sides ?? d.sides, side, 0, undefined, false, p.sq ?? 1, p.band);
  }
  const tp = d.tail.pts, last = tp.length - 1;
  loft(tp.map((p, i): R => [
    p[1], p[0], d.tail.r[i], d.tail.r[i], d.tail.r[i],
    i === last ? d.tail.tip : d.tail.top, i === last ? d.tail.tip : d.tail.bot,
    i === 0 ? "P" : i === last ? `T${last - 1}` : [`T${i - 1}`, `T${i}`, 0.5],
  ]), 8, 1, 0, undefined, d.tail.rings);

  const mesh = new Mesh(`${name}Skin`, scene);
  const vd = new VertexData();
  vd.positions = P; vd.normals = N; vd.uvs = UV; vd.colors = C; vd.indices = I;
  vd.matricesIndices = BI; vd.matricesWeights = BW;
  vd.applyToMesh(mesh);
  mesh.skeleton = skeleton;
  mesh.numBoneInfluencers = 2;
  mesh.parent = root;
  mesh.isPickable = false;
  mesh.receiveShadows = true;

  // occhi: iride incassata nel cranio (ne sporge uno spicchio a mandorla) e pupilla nera
  const e = d.eye, look = new Vector3(...e.look).normalize();
  const ball = (r: number, off: number): Mesh => Mesh.MergeMeshes([-1, 1].map((s) => {
    const m = MeshBuilder.CreateSphere("eye", { diameter: r * 2, segments: 10 }, scene);
    m.position.set((e.x + look.x * off) * s, e.y - d.headAt[0] + look.y * off, e.z - d.headAt[1] + look.z * off);
    return m;
  }), true)!;
  const eyes = ball(e.r, 0);
  eyes.name = `${name}Eyes`; eyes.material = iris; eyes.parent = head; eyes.isPickable = false;
  const pupils = ball(e.r * 0.58, e.r * 0.54);
  pupils.name = `${name}Pupils`; pupils.material = pupil; pupils.parent = eyes; pupils.isPickable = false;
  // l'orlo scuro dell'occhio: una sfera nera un po' più grande, appena più dentro
  const rims = ball(e.r * 1.28, -e.r * 0.42);
  rims.name = `${name}EyeRims`; rims.material = pupil; rims.parent = eyes; rims.isPickable = false;

  return { root, mesh, eyes, body, chest, pelvis, neck, head, jaw, tail, legs, pivot: d.pivot };
}

/** Materiali degli occhi: iride lucida con un filo di luce propria (si legge nel bosco buio), pupilla nera. */
export function eyeMaterials(scene: Scene, name: string, color: Color3): [StandardMaterial, StandardMaterial] {
  const iris = new StandardMaterial(`${name}Iris`, scene);
  iris.diffuseColor = color; iris.emissiveColor = color.scale(0.3); iris.specularColor = new Color3(1, 1, 1); iris.specularPower = 96;
  const pupil = new StandardMaterial(`${name}Pupil`, scene);
  pupil.diffuseColor = Color3.Black(); pupil.specularColor = new Color3(0.8, 0.8, 0.8); pupil.specularPower = 128;
  return [iris, pupil];
}

/**
 * IK della zampa sul piano sagittale: porta l'appoggio in (footY, footZ) partendo dall'anca in
 * (hipY, hipZ), con il terzo segmento all'angolo assoluto `th3`. `parentPitch` è la rotazione x
 * accumulata del tronco a cui la zampa è attaccata (va tolta: gli angoli risolti sono assoluti).
 */
export function solveLeg(leg: Leg, hipY: number, hipZ: number, footY: number, footZ: number, th3: number, parentPitch: number): void {
  const [L1, L2, L3] = leg.L;
  const ay = footY + L3 * Math.cos(th3), az = footZ - L3 * Math.sin(th3);
  const dy = ay - hipY, dz = az - hipZ;
  const D = Math.min(L1 + L2 - 1e-3, Math.max(Math.abs(L1 - L2) + 1e-3, Math.hypot(dy, dz)));
  const alpha = Math.atan2(dz, -dy);
  const th1 = alpha + leg.bend * Math.acos((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D));
  const ky = hipY - L1 * Math.cos(th1), kz = hipZ + L1 * Math.sin(th1);
  // la caviglia raggiungibile (se il bersaglio è troppo lontano la zampa si tende verso di lui)
  const ry = hipY - D * Math.cos(alpha), rz = hipZ + D * Math.sin(alpha);
  const th2 = Math.atan2(rz - kz, -(ry - ky));
  const a1 = -(th1 - leg.rest[0]), a2 = -(th2 - leg.rest[1]), a3 = -(th3 - leg.rest[2]);
  leg.n[0].rotation.x = a1 - parentPitch;
  leg.n[1].rotation.x = a2 - a1;
  leg.n[2].rotation.x = a3 - a2;
}
