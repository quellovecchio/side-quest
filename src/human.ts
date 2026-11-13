import { Bone, Matrix, Mesh, Scene, Skeleton, TransformNode, Vector3, VertexData, type Material } from "@babylonjs/core";
import { mulberry32 } from "./world/noise";
import { heads, type HeadId } from "./world/kit";

// ─────────────────────────────────────────────────────────────────────────────
// UMANI — gli abitanti della città, procedurali come le creature: una pelle sola a due ossa.
//
// Sono le figure delle tavole in docs/reference/citta (stesse misure, stessa palette): sagome
// spigolose a poche facce, teste piccole, occhi in ombra, tinte spente. Il corpo è fatto di LOFT
// verticali: anelli orizzontali (semilarghezza, profondità davanti e dietro) impilati lungo y.
// Vesti, grembiuli, mantelli, barbe e cappucci sono altri loft che seguono il profilo del busto
// o del cranio un po' più larghi (`wrap`), anche solo su un arco (davanti, dietro).
// Il colore è nei vertici, sopra una tela neutra; gli oggetti in mano sono scatole.
//
// Convenzioni: +Z avanti, +X la destra del personaggio, origine a terra fra i piedi; in posa di
// riposo i nodi-osso hanno rotazione nulla. Lato 0 = sinistra (−X), lato 1 = destra.
// ⚠️ rotation.x POSITIVA porta ciò che pende (braccio, gamba) all'INDIETRO: avanti è negativo.
// ─────────────────────────────────────────────────────────────────────────────

export type Col = [number, number, number];
type BoneW = string | [string, string, number];
interface Ring { y: number; rx: number; f: number; b?: number; x?: number; z?: number; col: Col | ((a: number) => Col); bone: BoneW | ((c: number) => BoneW) }
interface LoftOpts { sides?: number; sq?: number; arc?: [number, number]; jag?: number }
interface WrapOpts { arc?: [number, number]; grow?: number; flare?: number; bone?: BoneW; sides?: number; on?: Ring[]; jag?: number; hold?: number }

export interface Shape {
  /** Altezza (m) e quante teste è alta la figura. */
  h: number; heads?: number;
  /** Mezza spalla (frazione dell'altezza), vita e fianchi (frazioni della spalla). */
  sh?: number; w?: number; hip?: number;
  /** Schiena curva (rad) e pancia (m). */
  stoop?: number; belly?: number;
  skin?: Col;
  /** Quale testa scolpita (senza: bimbo se è basso di teste, vecchio se `head(true)`, altrimenti uomo). */
  face?: HeadId;
}

export interface Human {
  root: TransformNode; mesh: Mesh;
  /** Nodi-osso: hips, spine, head, arm0/1, fore0/1, leg0/1, shin0/1, foot0/1; hand0/1 (polso), grip0/1 (dita); nel volto jaw, brow, eyes, mouth. */
  j: Record<string, TransformNode>;
  H: number; hipY: number; leg: number; stoop: number; kid: boolean;
  /** Quanto è alta la testa (m) e la quota a riposo dell'osso delle sopracciglia nel riferimento della testa. */
  hd: number; brow0: number; mouth0: number;
}

// la palette delle tavole (sRGB → lineare; la tela su cui si moltiplica è chiara, non bianca)
const HEX = {
  lino: "#a89c80", lana: "#5c4a38", cuoio: "#4a3423", ruggine: "#74402a", ocra: "#8c7034", muschio: "#4c5434",
  vino: "#592a30", petrolio: "#3c4f52", viola: "#46344d", nero: "#2a2623", grigio: "#6a665e", bianco: "#c9c0a8",
  pelle: "#b48d6e", pallido: "#c3a385", ferro: "#35373a", oro: "#9a7b34", legno: "#5a4330", paglia: "#8a7743",
  trave: "#3a2a1e", coppo: "#6e3d2b", tonaca: "#3b3029", abito: "#3d3c3e", scuro: "#33292a", biondo: "#7a683c",
  rame: "#5e3323", canuto: "#a9a595", mantello: "#3f4436", scialle: "#5e3b2e", brache: "#3a332c", cristallo: "#7fa39d",
} as const;
const lin = (h: string): Col => [1, 3, 5].map((i) => Math.min(1, Math.pow(parseInt(h.slice(i, i + 2), 16) / 255, 2.2) * 1.3)) as Col;
export const K = Object.fromEntries(Object.entries(HEX).map(([k, v]) => [k, lin(v)])) as Record<keyof typeof HEX, Col>;
const dim = (c: Col, k: number): Col => [c[0] * k, c[1] * k, c[2] * k];

const PI = Math.PI, FRONT = PI / 2;
/** Archi: davanti (±h attorno al petto) e tutto il resto (tutto tranne il viso). */
const front = (h: number): [number, number] => [FRONT - h, FRONT + h];
const around = (h: number): [number, number] => [FRONT + h, FRONT + 2 * PI - h];

/** Dove sta l'occhio nella testa scolpita (in teste). */
const eyeAt = (): [number, number, number] => heads().eye;

export class Body {
  private P: number[] = []; private N: number[] = []; private UV: number[] = []; private C: number[] = [];
  private BI: number[] = []; private BW: number[] = []; private I: number[] = [];
  private nodes = new Map<string, TransformNode>(); private index = new Map<string, number>(); private abs = new Map<string, Vector3>();
  private skeleton: Skeleton; private root: TransformNode; private rnd = mulberry32(77);
  /** Profilo del busto (l'ultima veste) e del cranio: ciò che `wrap` segue. */
  torso: Ring[] = []; skull: Ring[] = [];
  readonly H: number; readonly hd: number; readonly chin: number; readonly shy: number; readonly sh: number; readonly w: number; readonly hw: number;
  readonly wy: number; readonly hy: number; readonly cy: number; readonly ky: number; readonly ay: number;
  readonly ex: number; readonly ey: number; readonly wx: number; readonly wry: number; readonly fw: number; readonly nw: number;
  /** Scala degli spessori (1 = adulto di 1,75 m). */
  readonly s: number; readonly skin: Col; readonly belly: number; readonly kid: boolean;

  constructor(scene: Scene, private name: string, private shape: Shape) {
    const H = this.H = shape.h, heads = shape.heads ?? 7.3, hd = this.hd = H / heads;
    this.kid = heads < 7; this.s = H / 1.75; this.skin = shape.skin ?? K.pelle; this.belly = shape.belly ?? 0;
    this.chin = H - hd; this.shy = this.chin - hd * 0.28;
    this.sh = H * (shape.sh ?? 0.122); this.w = this.sh * (shape.w ?? 0.7); this.hw = this.sh * (shape.hip ?? 0.84);
    this.wy = H * 0.6; this.hy = H * 0.52; this.cy = H * 0.47; this.ky = H * 0.27; this.ay = H * 0.05;
    const out = Math.max(this.sh, this.w);
    this.ex = out + 0.03; this.ey = H * 0.615; this.wx = out + 0.045; this.wry = H * 0.465;
    this.fw = hd * 0.38; this.nw = hd * 0.19;
    this.root = new TransformNode(name, scene);
    this.skeleton = new Skeleton(`${name}Skel`, `${name}Skel`, scene);
    this.bone("hips", null, 0, this.hy, 0);
    this.bone("spine", "hips", 0, this.wy, 0);
    this.bone("head", "spine", 0, this.shy + hd * 0.1, 0);
    // il volto: la mandibola gira attorno a un asse davanti all'orecchio, le sopracciglia salgono e scendono, gli occhi si
    // schiacciano quando le palpebre si chiudono (npcs.ts, `apply`)
    const E = eyeAt();
    this.bone("jaw", "head", 0, this.chin + hd * 0.42, hd * 0.03);
    this.bone("brow", "head", 0, this.chin + hd * 0.6, hd * 0.35);
    this.bone("eyes", "head", 0, this.chin + hd * E[1], hd * (0.05 + E[2]));
    this.bone("mouth", "head", 0, this.chin + hd * 0.243, hd * 0.43);   // l'apertura della bocca: si allarga in altezza quando la mandibola scende
    for (const i of [0, 1]) {
      const g = i ? 1 : -1;
      this.bone(`arm${i}`, "spine", g * (this.sh - 0.015), this.shy - 0.03, 0);
      this.bone(`fore${i}`, `arm${i}`, g * this.ex, this.ey, 0);
      // la mano: il polso, e le dita che si chiudono attorno alle nocche (npcs.ts, `apply`)
      this.bone(`hand${i}`, `fore${i}`, g * this.wx, this.wry, 0);
      this.bone(`grip${i}`, `hand${i}`, g * this.wx, this.wry - 0.105 * this.s, 0.01 * this.s);
      this.bone(`leg${i}`, "hips", g * this.hw * 0.52, this.hy, 0);
      this.bone(`shin${i}`, `leg${i}`, g * this.hw * 0.52, this.ky, 0);
      this.bone(`foot${i}`, `shin${i}`, g * this.hw * 0.52, this.ay, 0);   // la caviglia: il piede resta a terra mentre lo stinco gira (npcs.ts, `apply`)
    }
  }

  private bone(key: string, parent: string | null, x: number, y: number, z: number): void {
    const p = new Vector3(x, y, z), local = parent ? p.subtract(this.abs.get(parent)!) : p;
    const node = new TransformNode(`${this.name}:${key}`, this.root.getScene());
    node.parent = parent ? this.nodes.get(parent)! : this.root;
    node.position.copyFrom(local);
    const b = new Bone(key, this.skeleton, parent ? this.skeleton.bones[this.index.get(parent)!] : null, Matrix.Translation(local.x, local.y, local.z));
    b.linkTransformNode(node);
    this.index.set(key, this.skeleton.bones.length - 1); this.nodes.set(key, node); this.abs.set(key, p);
  }

  private push(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: Col, bw: BoneW): void {
    const [b0, b1, wt] = typeof bw === "string" ? [bw, bw, 0] : bw;
    this.P.push(x, y, z); this.N.push(nx, ny, nz); this.UV.push(u, v); this.C.push(c[0], c[1], c[2], 1);
    this.BI.push(this.index.get(b0)!, this.index.get(b1)!, 0, 0); this.BW.push(1 - wt, wt, 0, 0);
  }

  /** Loft verticale. Le normali guardano sempre in fuori (il materiale non scarta le facce dietro). */
  loft(rings: Ring[], o: LoftOpts = {}): void {
    const sq = o.sq ?? 0.9, [a0, a1] = o.arc ?? [0, 2 * PI], sides = Math.round((o.sides ?? 8) * 1.5), base = this.P.length / 3;   // (corpi tondi: una volta e mezzo le facce di prima)
    const pw = (v: number, e: number): number => Math.sign(v) * Math.pow(Math.abs(v), e);
    const rad = (q: Ring): number => (q.rx + (q.f + (q.b ?? q.f)) / 2) / 2;
    rings.forEach((r, i) => {
      const p = rings[Math.max(0, i - 1)], n = rings[Math.min(rings.length - 1, i + 1)];
      const dy = n.y - p.y, dr = rad(n) - rad(p), l = Math.hypot(dy, dr) || 1;
      const kr = Math.abs(dy) / l, ny = Math.abs(dy) < 1e-4 ? 1 : -dr * Math.sign(dy) / l;
      for (let j = 0; j <= sides; j++) {
        const a = a0 + (a1 - a0) * j / sides, c = Math.cos(a), s = Math.sin(a), rz = s > 0 ? r.f : r.b ?? r.f;
        const k = o.jag ? 1 + (this.rnd() - 0.5) * o.jag : 1;
        let nx = pw(c, 2 - sq) / Math.max(r.rx, 1e-4), nz = pw(s, 2 - sq) / Math.max(rz, 1e-4);
        const nl = Math.hypot(nx, nz) || 1; nx *= kr / nl; nz *= kr / nl;
        const am = ((a % (2 * PI)) + 2 * PI) % (2 * PI);
        this.push((r.x ?? 0) + pw(c, sq) * r.rx * k, r.y, (r.z ?? 0) + pw(s, sq) * rz * k, nx, ny, nz, j / sides * 3, r.y * 3,
          typeof r.col === "function" ? r.col(am) : r.col, typeof r.bone === "function" ? r.bone(c) : r.bone);
      }
    });
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = base + i * (sides + 1) + j, b = a + sides + 1;
      this.I.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  /** Scatola: centro, semilati, rotazione di Eulero (x, y, z). */
  box(c: [number, number, number], h: [number, number, number], col: Col, bone: string, rot: [number, number, number] = [0, 0, 0]): void {
    const m = Matrix.RotationYawPitchRoll(rot[1], rot[0], rot[2]), v = new Vector3(), n = new Vector3();
    for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) {
      const base = this.P.length / 3, u = (ax + 1) % 3, w = (ax + 2) % 3;
      Vector3.TransformNormalFromFloatsToRef(ax == 0 ? sg : 0, ax == 1 ? sg : 0, ax == 2 ? sg : 0, m, n);
      for (const [su, sw] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = [0, 0, 0]; q[ax] = sg * h[ax]; q[u] = su * h[u]; q[w] = sw * h[w];
        Vector3.TransformNormalFromFloatsToRef(q[0], q[1], q[2], m, v);
        this.push(c[0] + v.x, c[1] + v.y, c[2] + v.z, n.x, n.y, n.z, su * h[u] * 3, sw * h[w] * 3, col, bone);
      }
      this.I.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  private at(prof: Ring[], y: number): { rx: number; f: number; b: number; x: number; z: number; bone: Ring["bone"] } {
    let i = 0;
    while (i < prof.length - 2 && prof[i + 1].y < y) i++;
    const p = prof[i], q = prof[i + 1], t = Math.min(1, Math.max(0, (y - p.y) / (q.y - p.y || 1))), m = (a: number, b: number): number => a + (b - a) * t;
    return { rx: m(p.rx, q.rx), f: m(p.f, q.f), b: m(p.b ?? p.f, q.b ?? q.f), x: m(p.x ?? 0, q.x ?? 0), z: m(p.z ?? 0, q.z ?? 0), bone: t < 0.5 ? p.bone : q.bone };
  }

  /**
   * Uno strato che segue il profilo del busto (o del cranio, `on`) fra due quote, più largo di `grow`
   * e svasato di `flare` verso il basso: grembiuli, corpetti, fasce, mantelli, capelli, veli.
   * `hold` = quota sotto la quale il profilo non si restringe più (capelli e veli che scendono oltre il mento).
   */
  wrap(col: Col, y0: number, y1: number, o: WrapOpts = {}): void {
    const prof = o.on ?? this.torso, g = o.grow ?? 0.012;
    const ys = [y0, ...prof.map((r) => r.y).filter((y) => y > y0 + 0.015 && y < y1 - 0.015), y1];
    this.loft(ys.map((y) => {
      const p = this.at(prof, o.hold !== undefined ? Math.max(y, o.hold) : y), k = g + (o.flare ?? 0) * (y1 - y) / (y1 - y0);
      return { y, rx: p.rx + k, f: p.f + k, b: p.b + k, x: p.x, z: p.z, col, bone: o.bone ?? p.bone };
    }), { arc: o.arc, sides: o.sides ?? 10, jag: o.jag });
  }

  legs(col: Col, shoe: Col = K.cuoio, boot?: Col): void {
    const { hy, ky, ay, hw, s } = this, lo = boot ?? col, k = boot ? 1.12 : 1;
    for (const i of [0, 1]) {
      const x = (i ? 1 : -1) * hw * 0.52, L = `leg${i}`, S = `shin${i}`, F = `foot${i}`;
      this.loft([
        { y: 0.04 * s, rx: 0.036 * s * k, f: 0.04 * s * k, x, col: lo, bone: F },
        { y: ay, rx: 0.035 * s * k, f: 0.038 * s * k, b: 0.04 * s * k, x, col: lo, bone: [S, F, 0.5] },
        { y: ay + (ky - ay) * 0.3, rx: 0.044 * s * k, f: 0.042 * s * k, b: 0.052 * s * k, x, col: lo, bone: S },
        { y: ay + (ky - ay) * 0.62, rx: 0.056 * s * k, f: 0.048 * s * k, b: 0.07 * s * k, x, col: lo, bone: S },          // il polpaccio
        { y: ky - 0.03 * s, rx: 0.052 * s * k, f: 0.056 * s * k, b: 0.054 * s * k, x, col: lo, bone: S },
        { y: ky + 0.01 * s, rx: 0.056 * s, f: 0.064 * s, b: 0.054 * s, x, col, bone: [L, S, 0.5] },                        // il ginocchio
        { y: ky + (hy - ky) * 0.35, rx: 0.066 * s, f: 0.074 * s, b: 0.07 * s, x, col, bone: L },
        { y: ky + (hy - ky) * 0.72, rx: 0.08 * s, f: 0.088 * s, b: 0.09 * s, x, col, bone: L },                             // la coscia
        { y: hy + 0.03 * s, rx: hw * 0.5, f: 0.092 * s, b: 0.1 * s, x, col, bone: L },
      ]);
      // la scarpa, sull'osso del piede: il tallone, la tomaia che scende verso la punta, la suola
      this.box([x, 0.04 * s, 0.01 * s], [0.048 * s, 0.04 * s, 0.085 * s], shoe, F);
      this.box([x, 0.03 * s, 0.125 * s], [0.045 * s, 0.026 * s, 0.06 * s], shoe, F, [0.22, 0, 0]);
      this.box([x, 0.006 * s, 0.05 * s], [0.052 * s, 0.006 * s, 0.135 * s], dim(shoe, 0.45), F);
    }
  }

  /** Veste dalle spalle all'orlo (quota `hem`), svasata di `flare`; `wk` allarga o stringe la vita. */
  robe(col: Col, hem = this.hy - 0.05, flare = 0.015, wk = 1): void {
    const { hy, wy, shy, sh, w, hw, s, hd, nw, belly } = this, R: Ring[] = [];
    // l'orlo segue le cosce: i vertici sui lati pesano sulla gamba di quel lato
    const skirt = (k: number) => (c: number): BoneW => (Math.abs(c) > 0.3 ? ["hips", c > 0 ? "leg1" : "leg0", k] : "hips");
    const hipR = Math.max(hw, w * wk) + 0.012;
    if (hem < hy - 0.03) {
      const hemR = hipR + flare;
      R.push({ y: hem, rx: hemR, f: hemR * 0.8, b: hemR * 0.86, col: dim(col, 0.7), bone: skirt(0.62) });
      if (hy - hem > 0.3) R.push({ y: (hem + hy) / 2, rx: (hemR + hipR) / 2, f: (hemR * 0.8 + 0.105 * s) / 2, b: (hemR * 0.86 + 0.11 * s) / 2, col: dim(col, 0.88), bone: skirt(0.35) });
    }
    // il busto non è un tubo: i fianchi, la vita che rientra (la schiena si inarca), le costole, il petto, le spalle che
    // scendono dal collo, il trapezio. Una donna ha il petto più pieno.
    const top = Math.max(hem, hy), wr = w * wk + 0.008, fem = this.shape.face === "donna" ? 0.02 * s : 0;
    R.push({ y: top, rx: hipR, f: 0.105 * s + belly, b: 0.12 * s, col, bone: "hips" },
      { y: top + (wy - top) * 0.55, rx: (hipR + wr) / 2 + 0.004, f: 0.1 * s + belly * 1.1, b: 0.1 * s, col, bone: "hips" },
      { y: wy, rx: wr, f: 0.093 * s + belly, b: 0.08 * s, z: 0.006 * s, col, bone: ["hips", "spine", 0.5] },
      { y: (wy + shy - 0.12 * s) / 2, rx: (wr + sh * 0.95) / 2 + 0.004, f: 0.106 * s + belly * 0.6 + fem * 0.5, b: 0.094 * s, col, bone: "spine" },
      { y: shy - 0.125 * s, rx: sh * 0.95, f: 0.12 * s + belly * 0.3 + fem, b: 0.106 * s, col, bone: "spine" },
      { y: shy - 0.065 * s, rx: sh * 1.0, f: 0.104 * s + fem * 0.4, b: 0.11 * s, col, bone: "spine" },
      { y: shy - 0.018 * s, rx: sh * 0.9, f: 0.08 * s, b: 0.094 * s, col, bone: "spine" },
      { y: shy + 0.028 * s, rx: sh * 0.52, f: 0.058 * s, b: 0.076 * s, z: -0.004 * s, col, bone: "spine" },
      { y: shy + hd * 0.1, rx: nw + 0.022 * s, f: 0.048 * s, b: 0.055 * s, z: -0.006 * s, col, bone: "spine" });
    this.loft(R, { sides: 10 });
    this.torso = R;
  }

  /** Maniche e mani. `cuff` = raggio del polsino; `bare` = avambracci nudi; `fore` = colore dell'avambraccio (bracciali, pelo). */
  arms(col: Col, cuff = 0.036, bare = false, fore?: Col): void {
    const { shy, sh, ex, ey, wx, wry, s, skin } = this, lo = fore ?? (bare ? skin : col);
    for (const i of [0, 1]) {
      const g = i ? 1 : -1, A = `arm${i}`, F = `fore${i}`;
      this.loft([
        { y: wry + 0.005, x: g * wx, rx: cuff * s, f: cuff * s, col: dim(lo, 0.85), bone: F },
        { y: (ey + wry) / 2, x: g * (ex + wx) / 2, rx: (0.04 + cuff) / 2 * s, f: (0.04 + cuff) / 2 * s, col: lo, bone: F },
        { y: wry + (ey - wry) * 0.72, x: g * (wx + (ex - wx) * 0.72), rx: 0.046 * s, f: 0.047 * s, col: lo, bone: F },   // il ventre dell'avambraccio
        { y: ey - 0.025 * s, x: g * ex, rx: 0.041 * s, f: 0.043 * s, col: lo, bone: F },
        { y: ey + 0.025 * s, x: g * ex, rx: 0.042 * s, f: 0.045 * s, col, bone: [A, F, 0.5] },                            // il gomito
        { y: (ey + shy - 0.1 * s) / 2, x: g * (ex + sh + 0.012) / 2, rx: 0.05 * s, f: 0.054 * s, col, bone: A },         // il bicipite
        { y: shy - 0.1 * s, x: g * (sh + 0.014), rx: 0.056 * s, f: 0.06 * s, col, bone: A },
        { y: shy - 0.045 * s, x: g * (sh + 0.008), rx: 0.06 * s, f: 0.064 * s, col, bone: A },                             // il deltoide
        { y: shy - 0.006 * s, x: g * (sh - 0.016), rx: 0.046 * s, f: 0.052 * s, col, bone: A },
        { y: shy + 0.016 * s, x: g * (sh - 0.034), rx: 0.018 * s, f: 0.024 * s, col, bone: A },
      ]);
      // la mano: polso, palmo, nocche, le dita appena piegate in avanti; il pollice a parte
      // (il palmo guarda avanti: lì stanno gli oggetti; il palmo pesa sul polso, le dita sull'osso che le chiude, le nocche a metà)
      const Hd = `hand${i}`, Gr = `grip${i}`;
      this.loft([
        { y: wry - 0.185 * s, x: g * wx, z: 0.012 * s, rx: 0.014 * s, f: 0.008 * s, col: dim(skin, 0.85), bone: Gr },
        { y: wry - 0.165 * s, x: g * wx, z: 0.011 * s, rx: 0.025 * s, f: 0.012 * s, col: skin, bone: Gr },
        { y: wry - 0.135 * s, x: g * wx, z: 0.01 * s, rx: 0.029 * s, f: 0.014 * s, col: skin, bone: Gr },
        { y: wry - 0.105 * s, x: g * wx, z: 0.008 * s, rx: 0.031 * s, f: 0.018 * s, col: dim(skin, 0.9), bone: [Hd, Gr, 0.5] },
        { y: wry - 0.055 * s, x: g * wx, rx: 0.032 * s, f: 0.022 * s, col: skin, bone: Hd },
        { y: wry - 0.015 * s, x: g * wx, rx: 0.028 * s, f: 0.023 * s, col: skin, bone: Hd },
        { y: wry + 0.02 * s, x: g * wx, rx: 0.025 * s, f: 0.023 * s, col: skin, bone: [F, Hd, 0.5] },
      ], { sides: 6 });
      // il pollice: parte dal palmo, verso il corpo e un poco in avanti; si chiude a metà con le dita
      this.box([g * (wx - 0.03 * s), wry - 0.075 * s, 0.022 * s], [0.011 * s, 0.034 * s, 0.012 * s], skin, Hd, [-0.45, 0, -g * 0.5]);
    }
  }

  /** Cintura (o corda) alla quota `y`. */
  belt(col: Col = K.cuoio, y = this.wy): void {
    this.wrap(col, y - 0.022 * this.s, y + 0.022 * this.s, { grow: 0.01 });
    this.box([0, y, this.at(this.torso, y).f + 0.014], [0.02, 0.026, 0.006], K.ferro, "hips");
  }

  /** Mantellina, scialle o mantello sulle spalle: copre le braccia fino a `len` sotto la spalla. */
  cape(col: Col, len: number, arc?: [number, number]): void {
    const { shy, sh, nw, hd, s } = this, r = sh + 0.075 * s;
    this.loft([
      { y: shy - len, rx: r + len * 0.12, f: 0.14 * s + len * 0.08, b: 0.15 * s + len * 0.1, col: dim(col, 0.8), bone: len > 0.5 ? "hips" : "spine" },
      ...(len > 0.5 ? [{ y: shy - len * 0.5, rx: r + len * 0.05, f: 0.14 * s, b: 0.15 * s, col, bone: ["hips", "spine", 0.6] as BoneW }] : []),
      { y: shy - 0.07 * s, rx: r, f: 0.125 * s, b: 0.13 * s, col, bone: "spine" },
      { y: shy + 0.005, rx: sh * 0.9, f: 0.09 * s, b: 0.1 * s, col, bone: "spine" },
      { y: shy + hd * 0.13, rx: nw + 0.035 * s, f: 0.06 * s, b: 0.065 * s, col, bone: "spine" },
    ], { sides: 10, arc });
  }

  head(old = false): void {
    const { chin, hd, fw, nw, shy, skin, kid } = this, y = (k: number): number => chin + hd * k, z = hd * 0.03;
    const eye = (a: number): Col => { const d = Math.abs(a - FRONT); return d > 0.25 && d < 0.95 ? dim(skin, kid ? 0.45 : 0.2) : skin; };
    const jaw = old ? 0.78 : 0.86;
    void eye;
    this.loft([{ y: shy + hd * 0.03, rx: nw * 1.2, f: nw * 1.05, col: dim(skin, 0.75), bone: ["spine", "head", 0.4] }, { y: y(0.14), rx: nw, f: nw * 0.95, z: -hd * 0.03, col: dim(skin, 0.75), bone: "head" }], { sides: 8 });
    this.skull = [
      { y: y(-0.01), rx: fw * 0.2, f: hd * 0.2, b: hd * 0.02, z, col: skin, bone: "head" },
      { y: y(0.04), rx: fw * 0.5, f: hd * 0.33, b: hd * 0.12, z, col: skin, bone: "head" },
      { y: y(0.22), rx: fw * jaw, f: hd * 0.39, b: hd * 0.3, z, col: skin, bone: "head" },
      { y: y(0.44), rx: fw, f: hd * 0.41, b: hd * 0.42, z, col: skin, bone: "head" },
      { y: y(0.56), rx: fw * 1.02, f: hd * 0.385, b: hd * 0.45, z, col: eye, bone: "head" },
      { y: y(0.68), rx: fw * 1.03, f: hd * 0.42, b: hd * 0.46, z, col: skin, bone: "head" },
      { y: y(0.88), rx: fw * 0.9, f: hd * 0.36, b: hd * 0.42, z, col: skin, bone: "head" },
      { y: y(0.99), rx: fw * 0.45, f: hd * 0.18, b: hd * 0.22, z, col: skin, bone: "head" },
      { y: y(1.0), rx: 0.002, f: 0.002, z, col: skin, bone: "head" },
    ];
    // (il profilo del cranio serve ancora a capelli e copricapi, che lo seguono; la testa vera è la scultura fatta con Blender)
    const T = heads(), H = T[this.shape.face ?? (kid ? "bimbo" : old ? "vecchio" : "uomo")], base = this.P.length / 3, wx = 1.14, z0 = hd * 0.05;
    const ss = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let v = 0; v < H.p.length; v += 3) {
      const ao = 0.4 + 0.6 * H.c[v / 3], hy = H.p[v + 1], hz = H.p[v + 2];
      // chi muove quel punto: la mandibola (sotto il taglio della bocca; di lato sfuma verso la guancia; il collo no) o le sopracciglia
      const front = ss(0.12, 0.32, hz), jawW = (1 - ss(0.228, 0.25 + (1 - front) * 0.14, hy)) * ss(0.0, 0.14, hz + hy * 0.6);
      const browW = ss(0.545, 0.6, hy) * (1 - ss(0.66, 0.75, hy)) * ss(0.2, 0.3, hz);
      this.push(H.p[v] * hd * wx, chin + hy * hd, z0 + hz * hd, H.n[v], H.n[v + 1], H.n[v + 2], H.p[v] * 3, hy * 3, dim(skin, ao),
        jawW > 0.02 ? ["head", "jaw", jawW] : browW > 0.02 ? ["head", "brow", browW] : "head");
    }
    for (const i of H.i) this.I.push(base + i);
    // la bocca: la scultura alleggerita non ha una fessura vera, quindi l'apertura è una lente scura a filo delle labbra, sul suo
    // osso: chiusa è una riga, e si allarga in altezza quando la mandibola scende (npcs.ts, `apply`)
    const m0 = this.P.length / 3, mw = hd * 0.082, mh = hd * 0.009, my = chin + hd * 0.243, mz = z0 + hd * 0.383;
    this.push(0, my, mz, 0, 0, 1, 0, 0, [0.03, 0.008, 0.008], "mouth");
    for (let i = 0; i <= 12; i++) { const a = i / 12 * 2 * PI, cx = Math.cos(a), sy = Math.sin(a); this.push(cx * mw, my + sy * mh, mz - cx * cx * hd * 0.03, 0, 0, 1, 0, 0, [0.03, 0.008, 0.008], "mouth"); }
    for (let i = 0; i < 12; i++) this.I.push(m0, m0 + 1 + i, m0 + 2 + i);
    for (const g of [-1, 1]) this.eye(g * T.eye[0] * hd * wx, chin + T.eye[1] * hd, z0 + (T.eye[2] + 0.008) * hd, hd * 0.052);
  }

  /**
   * Un occhio: una perla nera lucida in fondo all'orbita (la variante B della tavola `docs/reference/npc/occhi.png`, scelta
   * dall'utente). Il materiale degli abitanti è opaco: il lucido lo fa un riflesso piccolo e fisso, in alto, i cui vertici
   * hanno l'alfa del colore sotto 0,5 e quindi brillano di suo (npcs.ts).
   */
  private eye(x: number, y: number, z: number, r: number): void {
    const n = 10, m = 5, base = this.P.length / 3, nero: Col = [0.012, 0.012, 0.015];
    // mezza perla schiacciata: larga r, alta 0,78 r, sporge di 0,6 r
    for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) {
      const v = j / m * PI / 2, u = i / n * 2 * PI, cx = Math.cos(u) * Math.cos(v), cy = Math.sin(u) * Math.cos(v), cz = Math.sin(v);
      this.push(x + cx * r, y + cy * r * 0.78, z + cz * r * 0.6, cx, cy, cz * 1.4, 0, 0, nero, "eyes");
    }
    for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) { const a = base + j * (n + 1) + i, b = a + n + 1; this.I.push(a, b, a + 1, a + 1, b, b + 1); }
    // il riflesso: un rombo chiaro, in alto verso il naso
    const g = x > 0 ? -1 : 1, hx = x + g * r * 0.3, hy = y + r * 0.3, hz = z + r * 0.56, k = r * 0.17, at = this.P.length / 3;
    for (const [dx, dy] of [[-1, 0], [0, -0.7], [1, 0], [0, 0.7]]) { this.push(hx + dx * k, hy + dy * k, hz, 0, 0, 1, 0, 0, [0.62, 0.62, 0.58], "eyes"); this.C[this.C.length - 1] = 0.25; }
    this.I.push(at, at + 1, at + 2, at, at + 2, at + 3);
  }

  private shell(col: Col, k0: number, k1: number, arc: [number, number] | undefined, grow: number, jag = 0, hold?: number): void {
    const y = (k: number): number => this.chin + this.hd * k;
    this.wrap(col, y(k0), y(k1), { on: this.skull, arc, grow: grow * this.hd, sides: arc ? 9 : 12, jag, hold: hold === undefined ? undefined : y(hold) });
  }

  hair(kind: "corti" | "arruffati" | "lunghi" | "crocchia" | "trecce" | "tonsura", col: Col): void {
    const { chin, hd, fw } = this, y = (k: number): number => chin + hd * k;
    if (kind === "tonsura") { this.shell(col, 0.4, 0.74, around(1.2), 0.05); return; }
    const wild = kind === "arruffati";
    this.shell(col, 0.66, 1.03, undefined, wild ? 0.1 : 0.05, wild ? 0.45 : 0.12);
    this.shell(col, kind === "lunghi" ? -0.45 : 0.3, 0.66, around(kind === "lunghi" ? 1.0 : 1.2), wild ? 0.1 : 0.05, wild ? 0.45 : 0.1, 0.44);
    if (kind === "crocchia") this.loft([0.72, 0.8, 0.95, 1.04].map((k, i) => ({ y: y(k), rx: hd * [0.05, 0.2, 0.2, 0.03][i], f: hd * [0.05, 0.2, 0.2, 0.03][i], z: -hd * 0.42, col, bone: "head" })));
    if (kind === "trecce") for (const g of [-1, 1]) this.loft([-0.95, -0.85, -0.3, 0.2, 0.42].map((k, i) => ({ y: y(k), x: g * fw * 1.08, z: hd * 0.06, rx: hd * [0.02, 0.06, 0.065, 0.07, 0.05][i], f: hd * [0.02, 0.06, 0.065, 0.07, 0.05][i], col, bone: "head" })), { sides: 6, jag: 0.3 });
  }

  /** Barba: `len` in teste sotto il mento, `wk` quanto è larga in fondo. */
  beard(col: Col, len = 0.12, wk = 1): void {
    const { chin, hd, fw } = this, z = hd * 0.03;
    this.loft([
      { y: chin - hd * len, rx: fw * 0.12, f: hd * 0.2, z, col: dim(col, 0.8), bone: "jaw" },
      { y: chin - hd * len * 0.5, rx: fw * 0.6 * wk, f: hd * 0.36, z, col, bone: "jaw" },
      { y: chin + hd * 0.1, rx: fw * 0.9, f: hd * 0.43, z, col, bone: ["head", "jaw", 0.7] },
      { y: chin + hd * 0.24, rx: fw * 1.0, f: hd * 0.44, z, col, bone: "head" },
      { y: chin + hd * 0.33, rx: fw * 1.05, f: hd * 0.4, z, col, bone: "head" },
    ], { arc: front(1.25), sides: 8, jag: 0.12 });
  }

  hat(kind: "cuffia" | "fazzoletto" | "soggolo" | "velo" | "cappuccio" | "paglia" | "berretto" | "tocco", col: Col): void {
    const { chin, hd, fw, shy, sh, s } = this, y = (k: number): number => chin + hd * k, z = hd * 0.03;
    switch (kind) {
      case "cuffia": this.shell(col, 0.64, 1.04, undefined, 0.07); this.shell(col, 0.18, 0.64, around(1.15), 0.07, 0, 0.3); break;
      case "fazzoletto":
        this.shell(col, 0.64, 1.04, undefined, 0.08); this.shell(col, 0.3, 0.64, around(1.2), 0.08, 0, 0.44);
        this.box([0, y(0.38), z - hd * 0.56], [hd * 0.12, hd * 0.07, hd * 0.07], dim(col, 0.8), "head", [0.5, 0, 0]); break;
      case "soggolo":   // copre capo, orecchie, collo e petto; resta fuori il viso
        this.shell(col, 0.7, 1.04, undefined, 0.07); this.shell(col, -0.5, 0.7, around(1.0), 0.07, 0, 0.44);
        this.loft([{ y: shy - 0.1 * s, rx: sh * 0.8, f: 0.125 * s, col, bone: "spine" }, { y: shy + hd * 0.05, rx: fw * 1.25, f: hd * 0.36, col, bone: "spine" }, { y: y(0.16), rx: fw * 0.98, f: hd * 0.42, z, col, bone: "head" }], { arc: front(1.5), sides: 8 }); break;
      case "velo":
        this.shell(col, 0.76, 1.07, undefined, 0.13);
        this.loft([{ y: shy - 0.3 * s, rx: sh * 0.92, f: 0.02, b: 0.16 * s, col: dim(col, 0.8), bone: "spine" }, { y: shy, rx: sh * 0.8, f: 0.02, b: 0.15 * s, col, bone: "spine" },
          { y: y(0.3), rx: fw * 1.3, f: hd * 0.2, b: hd * 0.6, z, col, bone: "head" }, { y: y(0.76), rx: fw * 1.2, f: hd * 0.5, b: hd * 0.6, z, col, bone: "head" }], { arc: around(1.25), sides: 9 }); break;
      case "cappuccio":   // alzato, a punta, con la mantellina
        this.shell(col, 0.7, 1.0, undefined, 0.12);
        this.loft([{ y: y(1.0), rx: fw * 0.55, f: hd * 0.3, b: hd * 0.4, z, col, bone: "head" }, { y: y(1.12), rx: 0.004, f: 0.004, z: z - hd * 0.3, col, bone: "head" }]);
        this.shell(col, -0.2, 0.7, around(0.95), 0.12, 0, 0.44);
        this.cape(col, 0.16 * s); break;
      case "paglia":
        this.loft([{ y: y(0.74), rx: fw * 1.08, f: hd * 0.46, b: hd * 0.5, z, col, bone: "head" }, { y: y(1.08), rx: fw * 0.75, f: hd * 0.33, z, col, bone: "head" }, { y: y(1.1), rx: 0.004, f: 0.004, z, col, bone: "head" }]);
        this.loft([{ y: y(0.72), rx: fw * 2.5, f: hd * 0.95, z, col: dim(col, 0.8), bone: "head" }, { y: y(0.76), rx: fw * 1.0, f: hd * 0.42, z, col, bone: "head" }], { sides: 12, sq: 1 }); break;
      case "berretto":
        this.loft([{ y: y(0.72), rx: fw * 1.12, f: hd * 0.47, b: hd * 0.5, z, col: dim(col, 0.8), bone: "head" }, { y: y(0.86), rx: fw * 1.5, f: hd * 0.56, x: fw * 0.25, z, col, bone: "head" },
          { y: y(1.0), rx: fw * 1.2, f: hd * 0.46, x: fw * 0.4, z, col, bone: "head" }, { y: y(1.04), rx: 0.004, f: 0.004, x: fw * 0.4, z, col, bone: "head" }]);
        this.box([-fw * 1.1, y(1.12), z], [hd * 0.02, hd * 0.3, hd * 0.07], K.bianco, "head", [0.3, 0, 0.5]); break;
      case "tocco":
        this.loft([{ y: y(0.74), rx: fw * 1.1, f: hd * 0.47, b: hd * 0.5, z, col, bone: "head" }, { y: y(0.98), rx: fw * 1.3, f: hd * 0.55, z, col, bone: "head" }, { y: y(1.0), rx: 0.004, f: 0.004, z, col, bone: "head" }]); break;
    }
  }

  /** Un'asta nella mano `i`: da `lo` a `hi` rispetto alla mano (m), inclinata in avanti di `tilt`. */
  rod(i: 0 | 1, lo: number, hi: number, col: Col, tilt = 0, r = 0.014): [number, number, number] {
    const g = i ? 1 : -1, hx = g * (this.wx + 0.01), hy = this.wry - 0.05 * this.s, hz = 0.035, m = (lo + hi) / 2;
    this.box([hx, hy + Math.cos(tilt) * m, hz + Math.sin(tilt) * m], [r, (hi - lo) / 2, r], col, `fore${i}`, [tilt, 0, 0]);
    return [hx, hy + Math.cos(tilt) * hi, hz + Math.sin(tilt) * hi];
  }

  /** Secchio, cesto o brocca appesi alla mano `i`. */
  pail(i: 0 | 1, col: Col, r = 0.1, h = 0.2, fill?: Col): void {
    const x = (i ? 1 : -1) * (this.wx + 0.01), y = this.wry - 0.1 * this.s, z = 0.02;
    this.loft([{ y: y - h - 0.07, rx: 0.004, f: 0.004, x, z, col: dim(col, 0.6), bone: `fore${i}` }, { y: y - h - 0.07, rx: r * 0.8, f: r * 0.8, x, z, col: dim(col, 0.75), bone: `fore${i}` },
      { y: y - 0.07, rx: r, f: r, x, z, col, bone: `fore${i}` }, ...(fill ? [{ y: y - 0.04, rx: r * 0.7, f: r * 0.7, x, z, col: fill, bone: `fore${i}` }, { y: y - 0.02, rx: 0.004, f: 0.004, x, z, col: fill, bone: `fore${i}` }] : [])], { sq: 1 });
    this.box([x, y - 0.035, z], [0.006, 0.04, 0.006], dim(col, 0.6), `fore${i}`);
  }

  finish(mat: Material): Human {
    const mesh = new Mesh(`${this.name}Skin`, this.root.getScene()), vd = new VertexData();
    vd.positions = this.P; vd.normals = this.N; vd.uvs = this.UV; vd.colors = this.C; vd.indices = this.I;
    vd.matricesIndices = this.BI; vd.matricesWeights = this.BW;
    vd.applyToMesh(mesh);
    mesh.skeleton = this.skeleton; mesh.numBoneInfluencers = 2; mesh.parent = this.root; mesh.isPickable = false; mesh.material = mat;
    // le ossa spostano la pelle fuori dalla scatola calcolata a riposo: una scatola larga, o sparisce di lato allo schermo
    mesh.buildBoundingInfo(new Vector3(-1, -0.2, -1), new Vector3(1, this.H + 0.5, 1));
    return { root: this.root, mesh, j: Object.fromEntries(this.nodes), H: this.H, hipY: this.hy, leg: this.hy - 0.035 * this.s, stoop: this.shape.stoop ?? 0, kid: this.kid, hd: this.hd, brow0: this.nodes.get("brow")!.position.y, mouth0: this.nodes.get("mouth")!.position.y };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// I diciotto delle tavole. Ogni voce: corporatura e come vestirla (dal basso in alto, come si vestirebbe).
// ─────────────────────────────────────────────────────────────────────────────

export interface Part { shape: Shape; make(b: Body): void }

export const CAST = {
  monello: { shape: { h: 1.24, heads: 5.5, sh: 0.125 }, make(b) {
    b.legs(b.skin, b.skin); b.robe(K.lino, b.ky + 0.04, 0.05, 1.25); b.belt(K.paglia, b.wy - 0.03); b.arms(K.lino, 0.046);
    b.head(); b.hair("arruffati", K.lana); b.rod(1, -0.08, 0.42, K.legno, 0.9); } },
  garzone: { shape: { h: 1.4, heads: 6.2, sh: 0.122 }, make(b) {
    b.legs(K.lana); b.robe(K.lino, b.hy - 0.04, 0.02, 1.1); b.wrap(K.cuoio, b.hy - 0.02, b.shy - 0.03, { arc: around(0.3), grow: 0.014 }); b.belt(K.nero);
    b.arms(K.lino, 0.034, true); b.head(); b.hair("corti", K.trave); b.hat("cuffia", K.lino); b.pail(1, K.legno, 0.1, 0.18); } },
  bambina: { shape: { h: 1.18, heads: 5.5, sh: 0.115 }, make(b) {
    b.legs(b.skin); b.robe(K.muschio, b.ay + 0.09, 0.09, 0.95); b.wrap(K.lino, b.ay + 0.14, b.wy + 0.07, { arc: front(1.0), grow: 0.014 }); b.arms(K.muschio);
    b.head(); b.hair("trecce", K.biondo); b.box([-(b.wx + 0.01), b.wry - 0.2, 0.03], [0.03, 0.07, 0.02], K.ruggine, "fore0"); } },
  educanda: { shape: { h: 1.38, heads: 6.2, sh: 0.112 }, make(b) {
    b.legs(K.lana); b.robe(K.petrolio, b.ay + 0.04, 0.08, 0.9); b.belt(K.paglia); b.arms(K.petrolio); b.cape(K.lana, 0.2);
    b.head(); b.hair("lunghi", K.trave); b.hat("fazzoletto", K.ruggine); b.pail(1, K.paglia, 0.11, 0.12); } },

  contadino: { shape: { h: 1.74 }, make(b) {
    b.legs(K.lana); b.robe(K.lino, b.hy - 0.09, 0.03, 1.15); b.belt(K.cuoio); b.arms(K.lino, 0.034, true);
    b.head(); b.beard(K.lana, 0.06); b.hat("paglia", K.paglia);
    const t = b.rod(0, -(b.wry - 0.1), 1.6 - b.wry, K.legno); b.box([t[0], 0.07, t[2] + 0.07], [0.05, 0.012, 0.07], K.ferro, "fore0", [0.5, 0, 0]); } },
  // il lampionaio: giubba scura, cappuccio, e la pertica con lo stoppino in cima
  lampionaio: { shape: { h: 1.76, sh: 0.114, w: 0.7 }, make(b) {
    b.legs(K.brache); b.robe(K.petrolio, b.ky + 0.06, 0.03, 1.02); b.belt(K.cuoio); b.arms(K.petrolio); b.cape(K.nero, 0.3);
    b.head(); b.beard(K.trave, 0.05); b.hat("cappuccio", K.nero);
    const t = b.rod(1, -0.35, 2.1, K.legno); b.box([t[0], t[1] + 0.03, t[2]], [0.02, 0.05, 0.02], K.ferro, "fore1"); } },
  fabbro: { shape: { h: 1.78, sh: 0.138, w: 0.85, hip: 0.8 }, make(b) {
    b.legs(K.brache); b.robe(K.ruggine, b.hy - 0.06, 0.02); b.wrap(K.cuoio, b.ky + 0.02, b.shy - 0.09, { arc: front(0.95), grow: 0.016 }); b.belt(K.nero);
    b.arms(b.skin, 0.04, true); b.head(); b.beard(K.nero, 0.75, 1.1);
    b.rod(1, -0.3, 0.06, K.legno); b.box([b.wx + 0.01, b.wry - 0.36, 0.035], [0.035, 0.04, 0.07], K.ferro, "fore1"); } },
  cittadino: { shape: { h: 1.72, sh: 0.118 }, make(b) {
    b.legs(K.petrolio); b.robe(K.ruggine, b.cy - 0.12, 0.04, 1.05); b.belt(K.cuoio); b.box([0.1, b.wy - 0.07, 0.1], [0.035, 0.045, 0.02], K.cuoio, "hips");
    b.arms(K.ruggine); b.head(); b.hat("cappuccio", K.muschio); } },
  lavandaia: { shape: { face: "donna", h: 1.64, sh: 0.105, w: 0.66, hip: 0.98 }, make(b) {
    b.legs(K.lana); b.robe(K.ocra, b.ay + 0.04, 0.1); b.wrap(K.lino, b.ay + 0.12, b.wy, { arc: front(1.0), grow: 0.014 }); b.arms(K.ocra, 0.034, true);
    b.head(); b.hat("fazzoletto", K.ruggine); b.pail(0, K.paglia, 0.17, 0.12, K.bianco); } },
  ostessa: { shape: { face: "donna", h: 1.68, sh: 0.108, w: 0.64, hip: 1 }, make(b) {
    b.legs(K.lana); b.robe(K.vino, b.ay + 0.03, 0.11); b.wrap(K.lino, b.shy - 0.13, b.shy + b.hd * 0.1, { grow: 0.006 }); b.wrap(K.cuoio, b.wy - 0.03, b.shy - 0.12, { grow: 0.012 });
    b.wrap(K.lino, b.ky, b.wy - 0.03, { arc: front(0.9), grow: 0.016 }); b.arms(K.lino, 0.042);
    b.head(); b.hair("crocchia", K.rame); b.pail(1, K.coppo, 0.07, 0.17); } },
  cittadina: { shape: { face: "donna", h: 1.66, sh: 0.106, w: 0.66, hip: 0.95 }, make(b) {
    b.legs(K.lana); b.robe(K.muschio, b.ay + 0.02, 0.09); b.belt(K.cuoio); b.arms(K.muschio, 0.04); b.cape(K.viola, 0.3);
    b.head(); b.hat("soggolo", K.bianco); } },

  mercante: { shape: { h: 1.7, sh: 0.128, w: 1.1, hip: 1.12, belly: 0.05, skin: K.pallido }, make(b) {
    b.legs(K.nero); b.robe(K.vino, b.ay + 0.16, 0.06); b.wrap(K.lana, b.ay + 0.16, b.shy + b.hd * 0.08, { arc: front(0.26), grow: 0.016 }); b.wrap(K.lana, b.ay + 0.16, b.ay + 0.22, { grow: 0.016 });
    b.belt(K.cuoio, b.wy - 0.07); b.box([-0.13, b.wy - 0.15, 0.17], [0.05, 0.06, 0.03], K.cuoio, "hips"); b.arms(K.vino, 0.05, false, K.vino); b.cape(K.lana, 0.07);
    b.head(); b.box([0, b.chin + b.hd * 0.3, b.hd * 0.43], [b.hd * 0.16, b.hd * 0.025, b.hd * 0.02], K.lana, "head"); b.hat("berretto", K.ocra); } },
  sindaco: { shape: { h: 1.84, sh: 0.112, w: 0.7, hip: 0.85, skin: K.pallido }, make(b) {
    b.legs(K.nero); b.robe(K.nero, b.ay + 0.03, 0.07); b.wrap(K.viola, b.ay + 0.03, b.shy - 0.05, { arc: front(0.3), grow: 0.012 }); b.wrap(K.bianco, b.shy - 0.03, b.shy + b.hd * 0.1, { grow: 0.012 });
    b.wrap(K.oro, b.shy - 0.085, b.shy - 0.06, { grow: 0.017 }); b.box([0, b.shy - 0.17, 0.125 * b.s], [0.03, 0.03, 0.008], K.oro, "spine"); b.arms(K.nero, 0.05);
    b.head(); b.beard(K.grigio, 0.5, 0.5); b.hat("tocco", K.nero);
    const t = b.rod(1, -(b.wry - 0.06), b.H * 0.8 - b.wry, K.trave); b.box(t, [0.03, 0.03, 0.03], K.oro, "fore1"); } },
  parroco: { shape: { h: 1.72, sh: 0.12, w: 0.88, hip: 0.9 }, make(b) {
    b.legs(K.nero); b.robe(K.tonaca, b.ay + 0.02, 0.06);
    for (const g of [-1, 1]) b.wrap(K.viola, b.ky - 0.04, b.shy + b.hd * 0.05, { arc: [FRONT + g * 0.34 - 0.16, FRONT + g * 0.34 + 0.16], grow: 0.014, sides: 2 });
    b.belt(K.paglia, b.wy - 0.02); b.box([0, b.shy - 0.17, 0.125 * b.s], [0.026, 0.026, 0.008], K.oro, "spine"); b.arms(K.tonaca, 0.048);
    b.head(); b.hair("tonsura", K.grigio); b.box([-(b.wx + 0.02), b.wry - 0.1, 0.03], [0.02, 0.075, 0.055], K.cuoio, "fore0"); } },
  suora: { shape: { face: "donna", h: 1.6, sh: 0.104, w: 0.75, hip: 1, skin: K.pallido }, make(b) {
    b.legs(K.nero); b.robe(K.abito, 0.015, 0.09); b.wrap(K.grigio, 0.06, b.shy - 0.08, { arc: front(0.42), grow: 0.012 }); b.belt(K.paglia); b.arms(K.abito, 0.06);
    b.head(); b.hat("soggolo", K.bianco); b.hat("velo", K.nero); } },

  avventuriero: { shape: { h: 1.8, sh: 0.128, w: 0.72 }, make(b) {
    b.legs(K.lana, K.cuoio, K.cuoio); b.robe(K.ferro, b.cy - 0.1, 0.03, 1.05); b.wrap(K.cuoio, b.hy - 0.04, b.shy + b.hd * 0.1, { grow: 0.012 }); b.belt(K.nero);
    b.box([-(b.hw + 0.06), b.hy - 0.28, -0.1], [0.022, 0.42, 0.012], K.trave, "hips", [0.45, 0, 0]); b.box([-(b.hw + 0.06), b.hy + 0.14, 0.1], [0.015, 0.07, 0.015], K.nero, "hips", [0.45, 0, 0]);
    b.box([-(b.hw + 0.06), b.hy + 0.07, 0.07], [0.09, 0.014, 0.014], K.ferro, "hips", [0.45, 0, 0]);
    b.box([0, b.shy - 0.03, -0.17], [b.sh * 0.85, 0.065, 0.065], K.ruggine, "spine"); b.cape(K.mantello, 0.95 * b.s, around(1.15));
    b.arms(K.lana, 0.04, false, K.cuoio); b.cape(K.muschio, 0.09); b.head(); b.hair("corti", K.nero); } },
  mago: { shape: { h: 1.82, sh: 0.11, w: 0.8, hip: 0.9, skin: K.pallido }, make(b) {
    b.legs(K.nero); b.robe(K.viola, 0.015, 0.1); b.wrap(K.ocra, 0.015, 0.09, { grow: 0.012 }); b.belt(K.cuoio); b.box([0.11, b.wy - 0.07, 0.09], [0.04, 0.05, 0.022], K.cuoio, "hips");
    b.arms(K.viola, 0.078, false); b.head(true); b.hat("cappuccio", K.viola); b.beard(K.canuto, 1.5, 0.6);
    const t = b.rod(1, -(b.wry - 0.06), 2.02 - b.wry, K.trave, 0, 0.017); b.box([t[0], t[1] + 0.06, t[2]], [0.035, 0.06, 0.035], K.cristallo, "fore1", [0.6, 0.78, 0]); } },
  vecchio: { shape: { h: 1.64, stoop: 0.34, sh: 0.112, w: 0.8 }, make(b) {
    b.legs(K.grigio); b.robe(K.lana, b.ky - 0.02, 0.04, 1.05); b.belt(K.paglia); b.arms(K.lana, 0.04); b.cape(K.muschio, 0.22);
    b.head(true); b.hair("tonsura", K.bianco); b.beard(K.bianco, 1.1, 0.7); b.rod(1, -(b.wry - 0.12), 0.06, K.legno); } },
  vecchia: { shape: { h: 1.5, stoop: 0.38, sh: 0.112, w: 0.85, hip: 1.05 }, make(b) {
    b.legs(K.nero); b.robe(K.scuro, 0.015, 0.08); b.wrap(K.grigio, 0.12, b.wy, { arc: front(0.9), grow: 0.014 }); b.arms(K.scuro, 0.042);
    b.head(true); b.hat("cappuccio", K.scialle); b.rod(1, -(b.wry - 0.12), 0.06, K.legno); b.pail(0, K.paglia, 0.1, 0.12, K.muschio); } },
} satisfies Record<string, Part>;

export type Who = keyof typeof CAST;

export function buildHuman(scene: Scene, who: Who, name: string, mat: Material): Human {
  const b = new Body(scene, name, CAST[who].shape);
  CAST[who].make(b);
  return b.finish(mat);
}
