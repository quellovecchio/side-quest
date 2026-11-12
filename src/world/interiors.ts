import { embers, fire, flame } from "./flames";
import { Color3, Matrix, Mesh, Scene, TransformNode, Vector3, VertexBuffer, VertexData, type Material } from "@babylonjs/core";
import { by } from "../style";
import type { DoorDef } from "./doors";
import type { Geo } from "./geo";
import type { Floor } from "./levels";
import { interiorMaterial } from "./materials";
import { TOWN } from "./terrain";
import { clothTex, dirtTex, leadedGlassTex, photoTex } from "./textures";
import type { Interior, Mason, Opt, Tint, V3 } from "./town";
import type { Collider } from "./vegetation";
import { LIP, PIECES, caps, face, lamps, layout, point, solids, thick, vanoRect, walls, type Finish, type InteriorKind, type Layout, type Opening, type Piece, type PieceId, type Rect, type Room, type Side, type Stair } from "./layouts";
import { mulberry32 } from "./noise";

// ─────────────────────────────────────────────────────────────────────────────
// INTERNI — dentro gli edifici della città, dalle tavole docs/reference/citta/interni-*.
//
// Si lavora nel riferimento dell'edificio, quello di house() in town.ts: origine a terra al centro
// dell'ingombro, +Z verso la strada, +X a destra per chi da dentro guarda la strada, quote dalla strada.
//
// Tre pezzi:
//   · il CANTIERE (`Kit`): un muratore per l'interno, le sue luci, le ombre, i pavimenti, le porte, i posti; alla fine
//     ne fa le mesh (una per materiale) e ci cuoce la luce;
//   · gli ARREDI (`ARREDI`): un catalogo, una funzione per pezzo, nel riferimento del pezzo (davanti = +Z);
//   · i MODELLI: la locanda è fatta a mano (è la pilota, tavole interni-1 e -2); tutti gli altri nascono da una
//     pianta di layouts.ts (`build`): stanze, vani, scale, arredi, posti. Un seme per edificio varia la pianta.
//
// Ne escono: le mesh dell'interno (accese solo da vicino, e tenute FUORI DALLA SCENA finché l'uscio è chiuso e chi guarda
// è fuori: le finestre sono opache; Babylon scorre tutte le mesh della scena a ogni frame, anche quelle spente, e con
// venticinque interni erano 340 in più), i battenti delle porte, i pavimenti e le rampe (`Floor`), gli ostacoli a segmento con
// la loro fascia d'altezza, le porte (`DoorDef`) e il piano degli abitanti (nodi con quota, percorsi, posti `<id>.*`).
//
// La luce è calcolata qui una volta, vertice per vertice: il fuoco e le candele in uno strato, le finestre
// nell'altro (vedi `interiorMaterial`). Un tratto vertice–sorgente che attraversa una scatola d'ombra è al buio.
// Le scatole non si elencano: le lasciano dietro di sé i muri e i solai (`Kit.panel`, `Kit.slab`: una lastra sottile
// dietro ogni faccia) e gli arredi (`Kit.box`: ogni scatola abbastanza grande; cappe e scale ne dichiarano una, `shade`).
// Per questo muri e pavimenti sono suddivisi (`Mason.cell`) e tagliati lungo i muri: nessun vertice sotto un tramezzo.
// I battenti hanno la luce cotta due volte, da chiusi e da aperti: mentre girano si sfuma dall'una all'altra.
// ponytail: fra chiuso e aperto la luce dell'anta è una media, non un calcolo: a metà corsa un'anta che esce
// dall'ombra di un muro è approssimata. Per l'esatto servirebbe ricuocerla a ogni frame mentre gira (un centinaio di vertici).
// ponytail: chi cammina dentro (gli abitanti) prende la luce delle sorgenti senza ombre (`interiorLight`): dietro un
// tramezzo resta rischiarato dal fuoco della stanza accanto. Le mani e la spada di chi gioca non la prendono affatto.
// ponytail: gli ostacoli degli arredi sono capsule sull'ingombro (`caps` in layouts.ts: due affiancate se l'arredo è largo;
// gli angoli restano smussati di una quindicina di centimetri): bastano a chi cammina.
// ponytail: tutti gli interni si costruiscono e si cuociono all'avvio (un secondo in più, misurato): se pesano, si cuociono
// la prima volta che ci si avvicina.
// ─────────────────────────────────────────────────────────────────────────────

/** Il portone della locanda (lo stesso vano che town.ts apre nella facciata di una casa del ricco: `entry` in layouts.ts). */
const PORTONE = { w: 1.7, h: 2.5, lip: LIP };

export interface InteriorOptions {
  /** Il nome dell'edificio nel file: i suoi posti si chiamano `<id>.<posto>`. */
  id: string;
  kind: InteriorKind | "locanda";
  /** Ingombro dell'edificio (larghezza, profondità) e il seme della sua pianta. */
  size: [number, number]; seed: number;
  /** Un muratore nuovo (town.ts): qui se ne usa uno per l'interno e uno per ogni battente. */
  mason: () => Mason;
  /** Dove sta l'edificio nella città e come è girato. */
  x: number; z: number; yaw: number;
  /** Materiali della città: il legno delle porte (l'uscio si vede da fuori) e il lume delle fiamme. */
  wood: Material; lume: Material;
}

export interface Built {
  interior: Interior;
  /** I battenti dell'uscio visti da fuori: stanno con le mesh della città (sempre accesi, fanno ombra). */
  meshes: Mesh[];
  colliders: Collider[]; floors: Floor[]; doors: DoorDef[];
  /** Nodi con quota, collegamenti fra loro (indici in `nodes`) e posti. Il nodo 0 è davanti all'uscio, in strada: va legato alla rete. */
  nodes: [number, number, number][]; links: [number, number][];
  spots: Record<string, { x: number; z: number; yaw: number; y: number }>;
}

type Box = [number, number, number, number, number, number];
/** Sorgente di luce nel riferimento dell'edificio: raggio, forza; `n` = è una finestra (fredda, solo di giorno) che illumina da quella parte. */
interface Light { p: V3; r: number; f: number; n?: V3; pts?: V3[]; occ?: Box[] }

const PI = Math.PI, rad = (deg: number): number => deg * PI / 180;
const DOOR_H = 2.15, CELL = 0.5;

// tinte (lineari): la pietra della sala è affumicata, l'intonaco sporco, il legno scuro
const MURO: Tint = [0.8, 0.74, 0.68], FUMO: Tint = [0.13, 0.11, 0.1], PIETRA: Tint = [0.5, 0.47, 0.44], INTONACO: Tint = [0.78, 0.7, 0.58];
const LEGNO: Tint = [0.72, 0.62, 0.52], TRAVE: Tint = [0.36, 0.29, 0.25], ASSITO: Tint = [0.56, 0.48, 0.41], SCURO: Tint = [0.3, 0.25, 0.21], PORTA: Tint = [0.55, 0.45, 0.38];
const FERRO: Tint = [0.5, 0.5, 0.52], FERRATO: Tint = [0.09, 0.09, 0.1], COTTO: Tint = [0.78, 0.84, 0.88], TERRACOTTA: Tint = [0.75, 0.6, 0.5];
const LINO: Tint = [0.5, 0.45, 0.33], LANA: Tint = [0.2, 0.14, 0.11], BIANCO: Tint = [0.6, 0.55, 0.43], PAGLIA: Tint = [0.42, 0.34, 0.16], CERA: Tint = [0.75, 0.68, 0.5];
const TERRA: Tint = [0.62, 0.56, 0.5], LASTRE: Tint = [0.72, 0.7, 0.68], STRAME: Tint = [0.5, 0.46, 0.36], VINO: Tint = [0.2, 0.05, 0.065], ORO: Tint = [0.55, 0.36, 0.08], CUOIO: Tint = [0.26, 0.17, 0.11];
const ACQUA: Tint = [0.05, 0.08, 0.09], CARBONE: Tint = [0.03, 0.03, 0.035], MUSCHIO: Tint = [0.1, 0.13, 0.05], PELLE: Tint = [0.11, 0.065, 0.04];
/** Come si veste ogni finitura delle piante: materiale e tinta. */
const FIN: Record<Finish, [string, Tint]> = { pietra: ["stone", MURO], intonaco: ["plaster", INTONACO], cotto: ["brick", COTTO], assi: ["wood", ASSITO], terra: ["earth", TERRA], lastre: ["flag", LASTRE] };

/** I colori della luce e quanto è forte, secondo lo stile: il moderno è un po' più chiaro e meno aranciato. Serve anche a chi sta dentro (gli abitanti: npcs.ts). */
export const LIGHT = by(
  { warm: new Color3(1, 0.7, 0.44), cold: new Color3(0.56, 0.7, 0.84), ambient: new Color3(0.12, 0.113, 0.108), gain: 2.4, glass: 1.5 },
  { warm: new Color3(1, 0.66, 0.38), cold: new Color3(0.47, 0.6, 0.72), ambient: new Color3(0.09, 0.085, 0.081), gain: 2, glass: 1.3 },
);

// punti della sorgente da cui si prova a vedere il vertice: più d'uno ammorbidisce le ombre dei fuochi e delle finestre
const SOLO: V3[] = [[0, 0, 0]];
const FLAME: V3[] = [[0, 0, 0], [0.16, 0.1, 0.18], [-0.16, 0.14, 0.1], [0.04, 0.2, -0.2]];

/** Il tratto da `o` a `o + d` attraversa la scatola? (Sfiorarne una faccia non conta: i vertici stanno sulle facce.) */
function crosses(o: V3, d: V3, b: Box): boolean {
  let t0 = 1e-3, t1 = 1 - 1e-3;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) { if (o[i] <= b[i] || o[i] >= b[i + 3]) return false; continue; }
    const a = (b[i] - o[i]) / d[i], c = (b[i + 3] - o[i]) / d[i];
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c));
    if (t1 - t0 < 1e-4) return false;
  }
  return true;
}

/** Prepara le sorgenti: i punti da cui si guarda (una finestra è un rettangolo nel suo piano) e le sole scatole che stanno nel loro raggio. */
function aim(lights: Light[], occ: Box[]): void {
  const size = (b: Box): number => (b[3] - b[0]) * (b[4] - b[1]) + (b[4] - b[1]) * (b[5] - b[2]) + (b[3] - b[0]) * (b[5] - b[2]);
  occ.sort((a, b) => size(b) - size(a));   // le più grandi per prime: un raggio in ombra si ferma subito
  for (const l of lights) {
    l.pts = l.n ? [-1, 1].flatMap((a) => [-1, 1].map((b): V3 => [a * 0.28 * Math.abs(l.n![2]), b * 0.4, a * 0.28 * Math.abs(l.n![0])])) : l.r > 4 ? FLAME : SOLO;
    l.occ = occ.filter((b) => [0, 1, 2].reduce((d, i) => d + Math.max(b[i] - l.p[i], 0, l.p[i] - b[i + 3]) ** 2, 0) < l.r * l.r);
  }
}

/**
 * La luce sui vertici di `g`: per ognuno [fuoco e candele, finestre]. `at` e `dir` portano posizioni e normali
 * nel riferimento dell'edificio, dove stanno sorgenti e scatole d'ombra. Le sorgenti devono essere passate da `aim`.
 */
function bake(g: Geo, at: (x: number, y: number, z: number) => V3, dir: (x: number, y: number, z: number) => V3, lights: Light[]): Float32Array {
  const n = g.p.length / 3, out = new Float32Array(n * 2), d: V3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const N = dir(g.n[i * 3], g.n[i * 3 + 1], g.n[i * 3 + 2]), o = at(g.p[i * 3], g.p[i * 3 + 1], g.p[i * 3 + 2]);
    for (let k = 0; k < 3; k++) o[k] += N[k] * 0.04;   // appena staccato dalla superficie
    for (const l of lights) {
      const vx = l.p[0] - o[0], vy = l.p[1] - o[1], vz = l.p[2] - o[2], dist = Math.hypot(vx, vy, vz) || 1e-3;
      if (dist >= l.r) continue;
      // mezza luce anche di taglio (il riverbero che non si calcola), niente a chi volta le spalle
      const facing = Math.min(1, Math.max(0, 0.4 + 0.6 * (N[0] * vx + N[1] * vy + N[2] * vz) / dist));
      const e = l.f * (1 - dist / l.r) ** 2 * facing * (l.n ? Math.max(0, -(l.n[0] * vx + l.n[1] * vy + l.n[2] * vz) / dist) ** 0.6 : 1);
      if (e <= 0) continue;
      let seen = 0;
      for (const s of l.pts!) { d[0] = vx + s[0]; d[1] = vy + s[1]; d[2] = vz + s[2]; if (!l.occ!.some((b) => crosses(o, d, b))) seen++; }
      out[i * 2 + (l.n ? 1 : 0)] += e * seen / l.pts!.length * 3 * LIGHT.gain;
    }
  }
  return out;
}

/** Le tinte dei vertici in gamma, come le vuole il materiale degli interni (vedi `interiorMaterial`). */
function gamma(g: Geo): Geo {
  for (let i = 0; i < g.c.length; i++) if (i % 4 < 3) g.c[i] **= 1 / 2.2;
  return g;
}

/** Dove tagliare un rettangolo [lo, hi] perché i bordi dei vani `holes` cadano su un taglio (i = 0 o 1: quale delle due coordinate). */
const cuts = (lo: number, hi: number, holes: number[][], i: number): number[] =>
  [...new Set([lo, hi, ...holes.flatMap((h) => [h[i], h[i + 2]])])].filter((v) => v >= lo && v <= hi).sort((p, q) => p - q);

/** Fonde i riquadri che si toccano per un lato intero: le lastre d'ombra di un muro pieno sono una, non una per riquadro. */
function merge(r: Rect[]): Rect[] {
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < r.length && !again; i++) for (let j = i + 1; j < r.length; j++) {
      const a = r[i], b = r[j], eq = (p: number, q: number): boolean => Math.abs(p - q) < 1e-6;
      const side = eq(a[1], b[1]) && eq(a[3], b[3]) && (eq(a[2], b[0]) || eq(a[0], b[2])), up = eq(a[0], b[0]) && eq(a[2], b[2]) && (eq(a[3], b[1]) || eq(a[1], b[3]));
      if (!side && !up) continue;
      r[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]; r.splice(j, 1); again = true;
      break;
    }
  }
  return r;
}

/** Un rettangolo [a0, b0, a1, b1] meno i buchi: i riquadri che restano. */
function cells(a0: number, b0: number, a1: number, b1: number, holes: number[][]): Rect[] {
  const as = cuts(a0, a1, holes, 0), bs = cuts(b0, b1, holes, 1), out: Rect[] = [];
  for (let i = 0; i < as.length - 1; i++) for (let j = 0; j < bs.length - 1; j++) {
    const ca = (as[i] + as[i + 1]) / 2, cb = (bs[j] + bs[j + 1]) / 2;
    if (!holes.some((h) => ca > h[0] && ca < h[2] && cb > h[1] && cb < h[3])) out.push([as[i], bs[j], as[i + 1], bs[j + 1]]);
  }
  return out;
}

// ── materiali: uno per trama, gli stessi per tutti gli interni ──
const MATS = new Map<string, Material>();
function material(scene: Scene, k: string): Material {
  if (!MATS.size) {
    // le stesse texture fotografiche della città (textures.ts); stoffa, vetri e terra battuta restano generate
    const photo = (id: string) => (sc: Scene) => photoTex(sc, id);
    const tex = { stone: photo("medieval_blocks_05"), plaster: photo("plastered_wall_04"), wood: photo("weathered_planks"), brick: photo("herringbone_brick_02"), iron: photo("rusty_metal_02"), cloth: clothTex, glass: leadedGlassTex, earth: dirtTex, flag: photo("monastery_stone_floor"), thatch: photo("thatch_roof_angled") };
    for (const [n, t] of Object.entries(tex)) MATS.set(n, interiorMaterial(scene, `interno_${n}`, t(scene), LIGHT));
  }
  return MATS.get(k)!;
}

/** Un'anta con la sua luce: cotta da chiusa (`a`) e da aperta (`b`); `k` = a che punto è oggi. */
interface LeafLight { mesh: Mesh; pivot: TransformNode; shut: number; angle: number; a: Float32Array; b: Float32Array; k: number }

/** Un interno finito, per chi lo accende e lo spegne (vedi `watch`) e per chi ci sta dentro (`interiorLight`). */
interface Site {
  shown: Mesh[]; minor: Mesh[]; gates: { pivot: TransformNode; shut: number }[]; leaves: LeafLight[];
  /** Se le sue mesh (e quelle degli arredi minuti) stanno nella scena in questo momento. */
  vis: boolean; small: boolean;
  /** Dal mondo al riferimento dell'edificio; le stanze [x0, z0, x1, z1, y0, y1]; le luci; centro e raggio nel mondo. */
  inv: Matrix; zones: Box[]; lights: Light[]; x: number; z: number; r: number; in: boolean;
}
const SITES: Site[] = [];
let DETAIL = 2;
/**
 * Mentre è vero tutti gli interni stanno nella scena: main.ts lo accende durante il caricamento e disegna un paio di frame,
 * così la scheda video compila gli shader di ogni interno subito e non la prima volta che una porta si apre (erano scatti
 * di mezzo secondo: il programma è già pronto, ma il driver lo traduce davvero solo al primo disegno).
 */
let WARMING = false;
export function warmInteriors(on: boolean): void { WARMING = on; }
/** Dettaglio degli interni (impostazioni): 0 = senza arredi minuti e accesi solo da vicinissimo, 1 = i minuti solo nell'edificio in cui si è, 2 = tutto. */
export function setInteriorDetail(level: number): void { DETAIL = level; }
/** Di quanto il dettaglio accorcia il raggio a cui gli interni si accendono. */
export const interiorReach = (): number => [0.5, 0.75, 1][DETAIL];

/** Il cantiere di un interno (lo usa anche il sottosuolo: underground.ts). */
export class Kit {
  readonly I: Mason;
  readonly lights: Light[] = []; readonly occ: Box[] = []; readonly floors: Floor[] = []; readonly doors: DoorDef[] = [];
  readonly shown: Mesh[] = []; readonly outside: Mesh[] = []; readonly gates: TransformNode[] = [];
  readonly nodes: [number, number, number][] = []; readonly links: [number, number][] = []; readonly spots: Built["spots"] = {};
  private names = new Map<string, number>(); private pending: { g: Geo; mesh: Mesh; pivot: TransformNode; h: V3; turn: number; angle: number }[] = [];
  /** Lo yaw dell'edificio nel mondo e la matrice che dal mondo riporta al suo riferimento (vanno presi dentro il riferimento: `frame`). */
  yaw = 0; inv = Matrix.Identity();
  private tmp = new Vector3();
  /** Gli arredi mettono da sé il loro ostacolo (la locanda); nelle piante lo dà `solids`. `plain` = all'aperto, nel muratore della città: niente luce cotta. */
  blocks = false;

  constructor(readonly scene: Scene, I: Mason, readonly id: string, readonly make: () => Mason, readonly wood: Material | null, readonly plain = false) { this.I = I; }

  frame(): void { this.yaw = this.I.yaw; this.inv = this.I.inverse; }
  /** Dal mondo al riferimento dell'edificio: punti e direzioni. */
  local = (x: number, y: number, z: number): V3 => { Vector3.TransformCoordinatesFromFloatsToRef(x, y, z, this.inv, this.tmp); return [this.tmp.x, this.tmp.y, this.tmp.z]; };
  localN = (x: number, y: number, z: number): V3 => { Vector3.TransformNormalFromFloatsToRef(x, y, z, this.inv, this.tmp); return [this.tmp.x, this.tmp.y, this.tmp.z]; };
  /** Un punto del riferimento corrente del muratore, in quello dell'edificio. */
  at(x: number, y: number, z: number): V3 { const w = this.I.world(x, y, z); return this.local(w.x, w.y, w.z); }

  /** Una scatola d'ombra, data nel riferimento corrente. */
  shade(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (this.plain) return;
    const b: Box = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) { const p = this.at(x, y, z); for (let i = 0; i < 3; i++) { b[i] = Math.min(b[i], p[i]); b[i + 3] = Math.max(b[i + 3], p[i]); } }
    this.occ.push(b);
  }

  /** Una scatola tinta. Se è abbastanza grande (un piano di tavolo, un materasso, un piedritto: non un listello, non un arredo minuto, non ruotata) fa ombra. */
  box(k: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tint: Tint, o: Opt = {}): void {
    this.I.box(k, x0, y0, z0, x1, y1, z1, { ...o, tint });
    const d = [x1 - x0, y1 - y0, z1 - z0].sort((a, b) => b - a);
    if (!o.rot && !this.I.tag && d[0] >= 0.8 && d[1] >= 0.45) this.shade(x0, y0, z0, x1, y1, z1);
  }

  /** Parete sul piano x = w ("x") o z = w ("z"), da a0 ad a1 e da y0 a y1, coi vani `holes` [a0, y0, a1, y1]; guarda dalla parte di `dir`. Dietro lascia una lastra d'ombra. Va chiamata nel riferimento dell'edificio. */
  panel(k: string, axis: "x" | "z", w: number, a0: number, a1: number, y0: number, y1: number, dir: 1 | -1, o: Opt, holes: number[][] = []): void {
    const p = (a: number, y: number): V3 => (axis === "x" ? [w, y, a] : [a, y, w]), all = cells(a0, y0, a1, y1, holes), w0 = Math.min(w - dir * 0.1, w - dir * 0.02), w1 = Math.max(w - dir * 0.1, w - dir * 0.02);
    for (const [ca, cy, da, dy] of all) this.I.poly(k, [p(ca, cy), p(da, cy), p(da, dy), p(ca, dy)], axis === "x" ? [dir, 0, 0] : [0, 0, dir], o);
    if (!this.plain) for (const [ca, cy, da, dy] of merge(all)) this.occ.push(axis === "x" ? [w0, cy, ca, w1, dy, da] : [ca, cy, w0, da, dy, w1]);
  }

  /** Pavimento o soffitto a quota y, coi buchi `holes` [x0, z0, x1, z1]; `along` gira le uv di un quarto (le assi corrono lungo x). Dietro lascia una lastra d'ombra. */
  slab(k: string, y: number, x0: number, z0: number, x1: number, z1: number, dir: 1 | -1, o: Opt, holes: number[][] = [], along = false): void {
    const all = cells(x0, z0, x1, z1, holes);
    for (const [cx, cz, dx, dz] of all) {
      const pts: V3[] = [[cx, y, cz], [dx, y, cz], [dx, y, dz], [cx, y, dz]];
      this.I.poly(k, pts, [0, dir, 0], o, along ? pts.map(([x, yy, z]) => [z, yy, x] as V3) : pts);
    }
    if (!this.plain) for (const [cx, cz, dx, dz] of merge(all)) this.occ.push([cx, Math.min(y - dir * 0.1, y - dir * 0.02), cz, dx, Math.max(y - dir * 0.1, y - dir * 0.02), dz]);
  }

  /** Ciò che fa `f` è arredo minuto: finisce in mesh a parte, che il dettaglio basso non disegna. */
  minor(f: () => void): void { const was = this.I.tag; this.I.tag = this.plain ? "" : "~"; f(); this.I.tag = was; }

  light(x: number, y: number, z: number, r: number, f: number, n?: V3): void { const p = this.at(x, y, z); this.lights.push({ p, r, f, n }); }

  /** Un pavimento sul rettangolo dato (nel riferimento corrente). `rise` = è una rampa che sale verso +Z di tanto; `thick` = spessore sotto (un soffitto per chi sta sotto). */
  floor(x0: number, z0: number, x1: number, z1: number, y: number, thick?: number, rise?: number): void {
    const c = this.I.world((x0 + x1) / 2, y, (z0 + z1) / 2);
    this.floors.push({ x: c.x, z: c.z, y: c.y, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, yaw: this.I.yaw, thick, rise });
  }

  /** Un posto con nome (e, se `node`, un nodo dei percorsi), nel riferimento dell'edificio; `deg` = dove guarda. */
  place(name: string, x: number, y: number, z: number, deg: number, node: boolean): void {
    const w = this.I.world(x, y, z);
    this.spots[`${this.id}.${name}`] = { x: w.x, z: w.z, y: w.y, yaw: this.yaw + rad(deg) };
    if (node) { this.names.set(name, this.nodes.length); this.nodes.push([w.x, w.z, w.y]); }
  }
  link(a: string, b: string): void { this.links.push([this.names.get(a)!, this.names.get(b)!]); }

  /**
   * Un battente, in mesh a parte col cardine nell'origine e l'anta chiusa lungo la sua +Z. `h` = il cardine e `tip` = lo
   * spigolo libero da chiusa, nel riferimento corrente; `swing` = da che parte gira; `street` = la faccia di fuori è legno della città.
   */
  leaf(name: string, h: V3, tip: V3, height: number, thick: number, swing: 1 | -1, street: boolean, angle = PI / 2): DoorDef["leaves"][0] {
    const A = this.at(...h), B = this.at(...tip), width = Math.hypot(B[0] - A[0], B[2] - A[2]), turn = Math.atan2(B[0] - A[0], B[2] - A[2]);
    const pivot = new TransformNode(name, this.scene), w = this.I.world(...h), far = -swing * thick, L = this.make();
    pivot.position.copyFrom(w); pivot.rotation.y = this.yaw + turn;
    L.cell = CELL;
    // la faccia verso cui si apre (sul piano del cardine), la costa libera e, per le porte fra due stanze, l'altra faccia
    L.poly("wood", [[0, 0, 0], [0, 0, width], [0, height, width], [0, height, 0]], [swing, 0, 0], { tint: PORTA });
    L.poly("wood", [[0, 0, width], [far, 0, width], [far, height, width], [0, height, width]], [0, 0, 1], { tint: TRAVE });
    if (!street) L.poly("wood", [[far, 0, 0], [far, 0, width], [far, height, width], [far, height, 0]], [-swing, 0, 0], { tint: PORTA });
    // ferramenta dalla parte verso cui si apre: le bandelle sui cardini, l'anello
    for (const hy of height > 2.4 ? [0.36, height / 2, height - 0.36] : [0.44, height - 0.44]) L.box("wood", Math.min(0, swing * 0.014), hy - 0.035, 0, Math.max(0, swing * 0.014), hy + 0.035, width * 0.7, { tint: FERRATO });
    for (const x of street ? [0] : [0, far]) L.box("wood", x - 0.02, Math.min(height * 0.48, 1.3), width - 0.2, x + 0.02, Math.min(height * 0.48, 1.3) + 0.1, width - 0.1, { tint: FERRATO });
    const g = gamma(L.geos.get("wood")!), mesh = g.mesh(name, this.scene);
    mesh.material = material(this.scene, "wood"); mesh.parent = pivot; mesh.isPickable = false;
    this.shown.push(mesh); this.pending.push({ g, mesh, pivot, h: A, turn, angle });
    if (street) {
      // la faccia verso la strada: legno della città, alla luce del sole. Finché l'uscio è chiuso la disegna la mesh comune
      // di tutti gli usci (`doorFronts`); questa, che gira col battente, si accende solo mentre è aperto
      const E = this.make(), W = this.make(), quad: V3[] = [[far, 0, 0], [far, 0, width], [far, height, width], [far, height, 0]];
      E.poly("wood", quad, [-swing, 0, 0], { tint: PORTA });
      const out = E.geos.get("wood")!.mesh(`${name}_fuori`, this.scene);
      out.material = this.wood; out.parent = pivot; out.isPickable = false; out.setEnabled(false); this.scene.removeMesh(out);
      W.in(w.x, w.y, w.z, this.yaw + turn, () => W.poly("wood", quad, [-swing, 0, 0], { tint: PORTA }));
      const g = W.geos.get("wood")!, at = FRONT.p.length / 3;
      FRONT.p.push(...g.p); FRONT.n.push(...g.n); FRONT.uv.push(...g.uv); FRONT.c.push(...g.c); FRONT.idx.push(...g.idx.map((i) => i + at));
      FRONT.list.push({ pivot, shut: pivot.rotation.y, own: out, at, open: false });
      this.outside.push(out); this.gates.push(pivot);
    }
    return { x: w.x, z: w.z, yaw: this.yaw + turn, width, pivot, swing };
  }

  /** Le mesh: una per materiale, con la luce sui vertici; poi l'interno si iscrive fra quelli da accendere e spegnere. `zones` = le sue stanze. */
  finish(zones: Box[], c: { x: number; z: number }, r: number): Built {
    const minor: Mesh[] = [], prefix = this.id === "locanda" ? "inn" : this.id;
    aim(this.lights, this.occ);
    for (const [key, g] of this.I.geos) {
      const small = key.endsWith("~"), k = small ? key.slice(0, -1) : key, mesh = gamma(g).mesh(`${prefix}_${key}`, this.scene);
      if (k === "lume") mesh.material = LUME;
      else {
        // i vetri non prendono luce: la fanno, di giorno
        mesh.setVerticesData(VertexBuffer.UV2Kind, k === "glass" ? new Float32Array(g.p.length / 3 * 2).map((_, i) => (i % 2 ? LIGHT.glass : 0.1)) : bake(g, this.local, this.localN, this.lights), false, 2);
        mesh.material = material(this.scene, k);
      }
      mesh.isPickable = false; mesh.freezeWorldMatrix();
      (small ? minor : this.shown).push(mesh);
    }
    const leaves = this.pending.map(({ g, mesh, pivot, h, turn, angle }): LeafLight => {
      const swing = this.doors.flatMap((d) => d.leaves).find((l) => l.pivot === pivot)?.swing ?? 1;
      const lit = (t: number): Float32Array => { const cs = Math.cos(t), sn = Math.sin(t); return bake(g, (x, y, z) => [h[0] + x * cs + z * sn, h[1] + y, h[2] - x * sn + z * cs], (x, y, z) => [x * cs + z * sn, y, -x * sn + z * cs], this.lights); };
      const a = lit(turn), b = lit(turn + swing * angle);
      mesh.setVerticesData(VertexBuffer.UV2Kind, a.slice(), true, 2);
      return { mesh, pivot, shut: pivot.rotation.y, angle, a, b, k: 0 };
    });
    // Nascono nella scena e ci restano finché il gioco non parte: così `scene.whenReadyAsync` (main.ts) compila i loro
    // materiali durante il caricamento, e la prima porta che si apre non si ferma a compilarli. Le toglie `watch` al primo frame.
    SITES.push({ shown: this.shown, minor, gates: this.gates.map((pivot) => ({ pivot, shut: pivot.rotation.y })), leaves, vis: true, small: true, inv: this.inv, zones, lights: this.lights, x: c.x, z: c.z, r, in: false });
    watch(this.scene);
    return { interior: { meshes: [...this.shown, ...minor], x: c.x, z: c.z, r }, meshes: this.outside, colliders: this.I.colliders, floors: this.floors, doors: this.doors, nodes: this.nodes, links: this.links, spots: this.spots };
  }
}

/** Il lume delle fiamme (materiale della città, sempre acceso): lo dà chi costruisce il primo interno. */
let LUME: Material;

/** Le facce di fuori di tutti i battenti che danno sulla strada, da chiusi: vertici nel mondo, quattro per battente (`at` = il primo). */
const FRONT = { p: [] as number[], n: [] as number[], uv: [] as number[], c: [] as number[], idx: [] as number[], pos: new Float32Array(0), mesh: null as Mesh | null,
  list: [] as { pivot: TransformNode; shut: number; own: Mesh; at: number; open: boolean }[] };

/**
 * La mesh comune degli usci chiusi: una sola per tutta la città (a porte chiuse costa una draw call, non una per battente).
 * Quando un uscio si muove la sua faccia qui sparisce (i quattro vertici in uno) e si accende quella che gira col battente (`watch`).
 * Va creata dopo tutti gli interni; sta con le mesh della città: prende il sole e fa ombra.
 */
export function doorFronts(scene: Scene, wood: Material): Mesh | null {
  if (!FRONT.list.length) return null;
  const m = new Mesh("town_usci", scene), vd = new VertexData();
  vd.positions = FRONT.p; vd.normals = FRONT.n; vd.uvs = FRONT.uv; vd.colors = FRONT.c; vd.indices = FRONT.idx;
  vd.applyToMesh(m, true);
  m.material = wood; m.isPickable = false; m.freezeWorldMatrix();
  FRONT.mesh = m; FRONT.pos = new Float32Array(FRONT.p);
  return m;
}

// A uscio chiuso, da fuori, dell'interno non si vede nulla (le finestre sono opache): le sue mesh non stanno nemmeno nella scena.
// Si aggiunge all'accensione per distanza di main.ts: quella accende e spegne le mesh, questa le mette e le toglie dalla scena.
// Qui anche la luce delle ante che girano, e la faccia di fuori degli usci (comune da chiusi, del battente da aperti).
let watching: Scene | null = null;
function watch(scene: Scene): void {
  if (watching === scene) return;
  watching = scene;
  const p = new Vector3();
  scene.onBeforeRenderObservable.add(() => {
    const cam = scene.activeCamera;
    if (!cam) return;
    let moved = false;
    for (const f of FRONT.list) {   // gli usci che si aprono o si richiudono (anche lontano: li apre anche un abitante)
      const open = Math.abs(f.pivot.rotation.y - f.shut) > 0.002;
      if (open === f.open) continue;
      f.open = open; moved = true; f.own.setEnabled(open);
      if (open) scene.addMesh(f.own); else scene.removeMesh(f.own);
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) FRONT.pos[(f.at + i) * 3 + k] = FRONT.p[(f.at + (open ? 0 : i)) * 3 + k];
    }
    if (moved) FRONT.mesh?.updateVerticesData(VertexBuffer.PositionKind, FRONT.pos);
    for (const s of SITES) {
      const near = !!s.shown[0]?.isEnabled();   // (acceso per distanza: main.ts)
      if (near) Vector3.TransformCoordinatesToRef(cam.globalPosition, s.inv, p);
      s.in = near && s.zones.some((z) => p.x > z[0] - 0.45 && p.x < z[2] + 0.45 && p.z > z[1] - 0.45 && p.z < z[3] + 0.45 && p.y > z[4] - 0.5 && p.y < z[5] + 0.5);
      const on = WARMING || (near && (s.in || s.gates.some((g) => Math.abs(g.pivot.rotation.y - g.shut) > 0.01))), small = WARMING || (on && (DETAIL > 1 || (DETAIL === 1 && s.in)));
      if (s.vis !== on) { s.vis = on; for (const m of s.shown) if (on) scene.addMesh(m); else scene.removeMesh(m); }
      if (s.small !== small) { s.small = small; for (const m of s.minor) if (small) scene.addMesh(m); else scene.removeMesh(m); }
      if (on) for (const l of s.leaves) {
        const k = Math.min(1, Math.abs(l.pivot.rotation.y - l.shut) / l.angle);
        if (Math.abs(k - l.k) < 0.02) continue;
        l.k = k;
        l.mesh.updateVerticesData(VertexBuffer.UV2Kind, l.a.map((v, i) => v + (l.b[i] - v) * k));
      }
    }
  });
}

/**
 * La luce che c'è in un punto del mondo, se sta dentro un interno: [fuoco e candele, finestre] come nei vertici cotti
 * (senza ombre: serve a rischiarare chi ci cammina, vedi npcs.ts), o null se è all'aperto.
 */
const HERE = new Vector3();
export function interiorLight(x: number, y: number, z: number): [number, number] | null {
  for (const s of SITES) {
    if (Math.hypot(x - s.x, z - s.z) > s.r) continue;
    const p = Vector3.TransformCoordinatesFromFloatsToRef(x, y + 1, z, s.inv, HERE);
    if (!s.zones.some((b) => p.x > b[0] - 0.2 && p.x < b[2] + 0.2 && p.z > b[1] - 0.2 && p.z < b[3] + 0.2 && p.y > b[4] && p.y < b[5] + 0.3)) continue;
    const out: [number, number] = [0, 0];
    for (const l of s.lights) {
      const vx = l.p[0] - p.x, vy = l.p[1] - p.y, vz = l.p[2] - p.z, d = Math.hypot(vx, vy, vz) || 1e-3;
      // (0,5: un corpo in piedi guarda la sorgente solo con mezzo sé)
      if (d < l.r) out[l.n ? 1 : 0] += l.f * (1 - d / l.r) ** 2 * 0.5 * (l.n ? Math.max(0, -(l.n[0] * vx + l.n[2] * vz) / d) ** 0.6 : 1) * 3 * LIGHT.gain;
    }
    return out;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ARREDI — una funzione per pezzo, nel riferimento del pezzo: origine a terra (al centro, o sul muro per i pezzi da
// muro), davanti = +Z. `v` è il parametro che la pianta dà a qualcuno (l'altezza di una cappa, il contenuto di uno scaffale).
// Sono le tavole interni-2 (locanda) e interni-8 (case ed edifici).
// ─────────────────────────────────────────────────────────────────────────────

/** Una fiamma col piede in (x, y, z), alta h: la disegna flames.ts (al chiuso prende poco vento; all'aperto, nella fucina, tutto). */
const fiamma = (K: Kit, x: number, y: number, z: number, _w: number, h: number): void => flame(K.I.world(x, y, z), h * 1.25, K.plain ? 1 : 0.12);
/** Il fuoco di un focolare attorno a (0, y, z): due ciocchi, la brace, le fiamme. */
function fuoco(K: Kit, y: number, z: number, k = 1): void {
  K.box("wood", -0.4 * k, y, z - 0.14, 0.4 * k, y + 0.1, z, SCURO); K.box("wood", -0.35 * k, y, z + 0.12, 0.45 * k, y + 0.1, z + 0.26, SCURO); K.box("wood", -0.07, y + 0.1, z - 0.2, 0.07, y + 0.2, z + 0.3, SCURO);
  // un fuoco solo sopra il suo letto di braci, fra i ciocchi (flames.ts)
  const air = K.plain ? 1 : 0.12; embers(K.I.world(0, y + 0.03, z + 0.05), 0.36 * k); fire(K.I.world(0, y + 0.1, z + 0.05), 0.75 * k, 0.72 * k, air);
}
/** Cappa a tronco (il davanti e i due fianchi) fra due rettangoli: in basso largo 2·xb e profondo zb, in alto 2·xt e zt; fa ombra. */
function cappa(K: Kit, xb: number, zb: number, yb: number, xt: number, zt: number, yt: number): void {
  K.I.face("plaster", [[-xb, yb, zb], [xb, yb, zb], [xt, yt, zt], [-xt, yt, zt]], [0, 0.3, 1], { tint: INTONACO });
  for (const s of [-1, 1]) K.I.face("plaster", [[s * xb, yb, 0], [s * xb, yb, zb], [s * xt, yt, zt], [s * xt, yt, 0]], [s, 0.3, 0], { tint: INTONACO });
  K.shade(-xb, yb, 0, xb, yt, zb);
}
const candela = (K: Kit): void => {
  K.I.drum("iron", 0, 0, 0.06, 0, 0.016, { tint: FERRO }, 0.06, 6);
  K.box("cloth", -0.02, 0.016, -0.02, 0.02, 0.15, 0.02, CERA);
  fiamma(K, 0, 0.155, 0, 0.017, 0.09);
};
const boccale = (K: Kit): void => K.I.drum("wood", 0, 0, 0.045, 0, 0.13, { tint: ASSITO }, 0.045, 6);
const brocca = (K: Kit): void => { K.I.drum("brick", 0, 0, 0.05, 0, 0.1, { tint: TERRACOTTA }, 0.075, 6); K.I.drum("brick", 0, 0, 0.075, 0.1, 0.24, { tint: TERRACOTTA }, 0.04, 6); };
/** Una panca lungo x, col centro in (0, z). */
const panca = (K: Kit, z = 0): void => {
  K.box("wood", -0.8, 0.37, z - 0.16, 0.8, 0.42, z + 0.16, LEGNO, { under: true });
  for (const q of [-1, 1]) K.box("wood", q * 0.6 - 0.025, 0, z - 0.13, q * 0.6 + 0.025, 0.37, z + 0.13, TRAVE);
};
/** Quattro gambe e i traversi di un tavolo o di un sedile. */
const gambe = (K: Kit, hx: number, hz: number, h: number, t = 0.06): void => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box("wood", sx * hx - t / 2, 0, sz * hz - t / 2, sx * hx + t / 2, h, sz * hz + t / 2, TRAVE);
};
/** Qualcosa posato su un ripiano (in un riferimento suo): è arredo minuto. */
const sopra = (K: Kit, x: number, y: number, z: number, f: (K: Kit) => void): void => K.minor(() => K.I.in(x, y, z, 0, () => f(K)));

const ARREDI: Record<PieceId, (K: Kit, v: number | undefined, p?: Piece) => void> = {
  // tavolo di assi su due cavalletti, con le due panche
  tavolo(K) {
    K.box("wood", -0.9, 0.7, -0.4, 0.9, 0.76, 0.4, LEGNO, { under: true });
    for (const s of [-1, 1]) K.box("wood", s * 0.7 - 0.03, 0, -0.3, s * 0.7 + 0.03, 0.7, 0.3, TRAVE);
    K.box("wood", -0.67, 0.26, -0.04, 0.67, 0.34, 0.04, TRAVE);
    for (const s of [-1, 1]) panca(K, s * 0.62);
  },
  tavolino(K) { K.box("wood", -0.45, 0.68, -0.35, 0.45, 0.72, 0.35, LEGNO, { under: true }); gambe(K, 0.38, 0.28, 0.68); K.box("wood", -0.38, 0.3, -0.03, 0.38, 0.36, 0.03, TRAVE); },
  tavolone(K) {
    K.box("wood", -1.8, 0.72, -0.55, 1.8, 0.78, 0.55, LEGNO, { under: true });
    for (const x of [-1.57, 0, 1.57]) { K.box("wood", x - 0.03, 0, -0.42, x + 0.03, 0.72, 0.42, TRAVE); K.box("wood", x - 0.1, 0, -0.48, x + 0.1, 0.06, 0.48, TRAVE); }
    K.box("wood", -1.54, 0.28, -0.04, 1.54, 0.36, 0.04, TRAVE);
  },
  panca: (K) => panca(K),
  sgabello(K) {
    K.I.drum("wood", 0, 0, 0.17, 0.37, 0.42, { tint: LEGNO }, 0.17, 8);
    for (let i = 0; i < 3; i++) { const a = i * 2.094 + 0.5, lx = Math.cos(a) * 0.1, lz = Math.sin(a) * 0.1; K.box("wood", lx - 0.02, 0, lz - 0.02, lx + 0.02, 0.37, lz + 0.02, TRAVE); }
  },
  // scranno: chi siede guarda +Z, lo schienale alto sta dietro
  scranno(K) {
    for (const s of [-1, 1]) { K.box("wood", s * 0.23 - 0.03, 0, -0.26, s * 0.23 + 0.03, 1.25, -0.2, TRAVE); K.box("wood", s * 0.23 - 0.03, 0, 0.2, s * 0.23 + 0.03, 0.46, 0.26, TRAVE); K.box("wood", s * 0.23 - 0.025, 0.66, -0.2, s * 0.23 + 0.025, 0.7, 0.24, TRAVE); }
    K.box("wood", -0.26, 0.4, -0.26, 0.26, 0.46, 0.28, LEGNO, { under: true }); K.box("wood", -0.2, 0.62, -0.25, 0.2, 1.18, -0.21, LEGNO); K.box("wood", -0.2, 0.1, 0.21, 0.2, 0.14, 0.25, TRAVE);
  },
  // letto con la testa verso +Z
  letto(K) {
    for (const s of [-1, 1]) {
      K.box("wood", s * 0.46 - 0.04, 0, 0.92, s * 0.46 + 0.04, 0.95, 1, TRAVE); K.box("wood", s * 0.46 - 0.04, 0, -1, s * 0.46 + 0.04, 0.65, -0.92, TRAVE);
      K.box("wood", s * 0.48 - 0.02, 0.25, -0.92, s * 0.48 + 0.02, 0.45, 0.92, LEGNO, { under: true });
    }
    K.box("wood", -0.42, 0.45, 0.94, 0.42, 0.9, 0.98, LEGNO); K.box("wood", -0.42, 0.25, -0.98, 0.42, 0.6, -0.94, LEGNO);
    K.box("cloth", -0.46, 0.3, -0.92, 0.46, 0.5, 0.92, PAGLIA);     // il pagliericcio
    K.box("cloth", -0.3, 0.5, 0.5, 0.3, 0.58, 0.88, BIANCO);        // il cuscino
    K.box("cloth", -0.47, 0.5, -0.93, 0.47, 0.535, 0.3, LANA);      // la coperta
  },
  // letto grande: quattro colonne e il cielo di panno; la testa verso +Z
  lettone(K) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) K.box("wood", sx * 0.76 - 0.04, 0, sz * 1.01 - 0.04, sx * 0.76 + 0.04, 1.9, sz * 1.01 + 0.04, TRAVE);
      K.box("wood", sx * 0.78 - 0.02, 0.25, -0.97, sx * 0.78 + 0.02, 0.45, 0.97, LEGNO, { under: true });
      K.box("cloth", sx * 0.78 - 0.015, 1.68, -1.05, sx * 0.78 + 0.015, 1.92, 1.05, VINO, { under: true });                                    // le falde del cielo
    }
    for (const sz of [-1, 1]) K.box("cloth", -0.8, 1.68, sz * 1.03 - 0.015, 0.8, 1.92, sz * 1.03 + 0.015, VINO, { under: true });
    K.box("cloth", -0.8, 1.9, -1.05, 0.8, 1.93, 1.05, VINO, { under: true });
    K.box("wood", -0.72, 0.45, 0.98, 0.72, 1.2, 1.02, LEGNO); K.box("wood", -0.72, 0.25, -1.02, 0.72, 0.6, -0.98, LEGNO);
    K.box("cloth", -0.76, 0.3, -0.97, 0.76, 0.52, 0.97, LINO);
    for (const s of [-1, 1]) K.box("cloth", s * 0.38 - 0.28, 0.52, 0.55, s * 0.38 + 0.28, 0.6, 0.92, BIANCO);
    K.box("cloth", -0.77, 0.52, -0.98, 0.77, 0.56, 0.35, VINO);
  },
  // forziere col coperchio a falde; il davanti (la serratura) guarda −Z: nelle piante lo si gira di mezzo giro
  forziere(K) {
    K.box("wood", -0.45, 0, -0.25, 0.45, 0.34, 0.25, LEGNO, { open: true });
    for (const s of [-1, 1]) {
      K.I.face("wood", [[-0.45, 0.34, s * 0.25], [0.45, 0.34, s * 0.25], [0.45, 0.5, s * 0.17], [-0.45, 0.5, s * 0.17]], [0, 0.5, s], { tint: ASSITO });
      K.I.face("wood", [[s * 0.45, 0.34, -0.25], [s * 0.45, 0.34, 0.25], [s * 0.45, 0.5, 0.17], [s * 0.45, 0.5, -0.17]], [s, 0, 0], { tint: ASSITO });
      K.box("iron", s * 0.28 - 0.03, 0, -0.262, s * 0.28 + 0.03, 0.512, 0.262, FERRO);   // le bandelle
    }
    K.I.face("wood", [[-0.45, 0.5, -0.17], [0.45, 0.5, -0.17], [0.45, 0.5, 0.17], [-0.45, 0.5, 0.17]], [0, 1, 0], { tint: ASSITO });
    K.box("iron", -0.05, 0.2, -0.275, 0.05, 0.36, -0.25, FERRO);                          // la serratura
  },
  // botte in piedi
  botte(K) {
    K.I.drum("wood", 0, 0, 0.28, 0, 0.45, { tint: LEGNO }, 0.33); K.I.drum("wood", 0, 0, 0.33, 0.45, 0.9, { tint: LEGNO }, 0.28);
    for (const h of [0.18, 0.7]) K.I.drum("iron", 0, 0, 0.32, h, h + 0.05, { tint: FERRO }, 0.32);
  },
  sacco(K) { K.I.drum("cloth", 0, 0, 0.25, 0, 0.36, { tint: LINO }, 0.21, 7); K.I.drum("cloth", 0, 0, 0.21, 0.36, 0.5, { tint: LINO }, 0.07, 7); K.I.drum("cloth", 0, 0, 0.07, 0.5, 0.56, { tint: LANA }, 0.1, 7); },
  // banco di bottega: fronte chiuso di tavole verso +Z, dietro aperto con un ripiano
  banco(K) {
    K.box("wood", -0.8, 0, 0.24, 0.8, 0.97, 0.3, ASSITO); for (const s of [-1, 1]) K.box("wood", s * 0.77 - 0.03, 0, -0.3, s * 0.77 + 0.03, 0.97, 0.24, ASSITO);
    K.box("wood", -0.74, 0.48, -0.26, 0.74, 0.52, 0.24, LEGNO, { under: true }); K.box("wood", -0.85, 0.97, -0.3, 0.85, 1.05, 0.36, LEGNO, { under: true });
  },
  // scrittoio: chi scrive sta dalla parte di +Z, il piano scende verso di lui
  scrittoio(K) {
    for (const s of [-1, 1]) K.box("wood", s * 0.57 - 0.03, 0, -0.3, s * 0.57 + 0.03, 0.8, 0.3, TRAVE);
    K.box("wood", -0.54, 0.2, -0.03, 0.54, 0.26, 0.03, TRAVE); K.box("wood", -0.54, 0.58, -0.3, 0.54, 0.8, 0.3, LEGNO, { under: true });
    K.I.face("wood", [[-0.62, 0.96, -0.35], [0.62, 0.96, -0.35], [0.62, 0.82, 0.35], [-0.62, 0.82, 0.35]], [0, 1, 0.2], { tint: LEGNO });
    K.I.face("wood", [[-0.62, 0.96, -0.35], [0.62, 0.96, -0.35], [0.62, 0.8, -0.35], [-0.62, 0.8, -0.35]], [0, 0, -1], { tint: LEGNO });
    for (const s of [-1, 1]) K.I.face("wood", [[s * 0.62, 0.96, -0.35], [s * 0.62, 0.82, 0.35], [s * 0.62, 0.8, 0.35], [s * 0.62, 0.8, -0.35]], [s, 0, 0], { tint: LEGNO });
    K.shade(-0.6, 0.58, -0.33, 0.6, 0.86, 0.33);
    K.minor(() => K.I.face("cloth", [[-0.3, 0.925, -0.15], [0.05, 0.925, -0.15], [0.05, 0.865, 0.15], [-0.3, 0.865, 0.15]], [0, 1, 0.2], { tint: BIANCO }));
  },
  leggio(K) {
    K.box("wood", -0.22, 0, -0.22, 0.22, 0.06, 0.22, TRAVE); K.box("wood", -0.04, 0.06, -0.04, 0.04, 1.06, 0.04, TRAVE);
    K.I.face("wood", [[-0.27, 1.22, -0.2], [0.27, 1.22, -0.2], [0.27, 1.04, 0.2], [-0.27, 1.04, 0.2]], [0, 1, 0.4], { tint: LEGNO });
    K.minor(() => K.I.face("cloth", [[-0.2, 1.2, -0.13], [0.2, 1.2, -0.13], [0.2, 1.08, 0.13], [-0.2, 1.08, 0.13]], [0, 1, 0.4], { tint: BIANCO }));
  },
  fonte(K) {
    K.I.drum("stone", 0, 0, 0.4, 0, 0.1, { tint: PIETRA }, 0.4, 8); K.I.drum("stone", 0, 0, 0.24, 0.1, 0.62, { tint: PIETRA }, 0.24, 8);
    K.I.drum("stone", 0, 0, 0.24, 0.62, 0.8, { tint: MURO }, 0.55, 8); K.I.drum("stone", 0, 0, 0.55, 0.8, 1, { tint: MURO }, 0.55, 8);
    K.I.drum("iron", 0, 0, 0.47, 0.99, 1.005, { tint: ACQUA }, 0.47, 8);
    K.shade(-0.4, 0.62, -0.4, 0.4, 1, 0.4);
  },
  // altare di pietra con la tovaglia e due ceri; dietro, sull'asta, il disco d'oro (quello della guglia)
  altare(K) {
    K.box("stone", -1.2, 0, -0.5, 1.2, 1.05, 0.5, PIETRA);
    K.box("cloth", -1.25, 0.82, -0.52, 1.25, 1.075, 0.52, BIANCO); K.box("cloth", -1.255, 0.88, -0.525, 1.255, 0.92, 0.525, VINO);
    K.box("iron", -0.02, 1.075, -0.36, 0.02, 1.85, -0.32, FERRO);
    for (const z of [-0.33, -0.35]) K.I.in(0, 0, z, 0, () => K.I.disc("cloth", 0, 2.12, 0.32, 0, { tint: ORO }, 16));
    for (const s of [-1, 1]) K.I.in(s * 0.92, 1.075, 0.1, 0, () => { K.I.drum("iron", 0, 0, 0.06, 0, 0.02, { tint: FERRO }, 0.06, 6); K.box("cloth", -0.025, 0.02, -0.025, 0.025, 0.25, 0.025, CERA); fiamma(K, 0, 0.255, 0, 0.02, 0.1); });
  },
  // banco di chiesa: chi siede guarda +Z
  "banco.chiesa"(K) {
    K.box("wood", -0.85, 0.4, -0.14, 0.85, 0.45, 0.24, LEGNO, { under: true }); K.box("wood", -0.85, 0.45, -0.2, 0.85, 0.9, -0.14, LEGNO);
    for (const s of [-1, 1]) K.box("wood", s * 0.82 - 0.03, 0, -0.2, s * 0.82 + 0.03, 0.9, 0.24, TRAVE);
    K.box("wood", -0.82, 0.08, 0.4, 0.82, 0.12, 0.54, LEGNO, { under: true });
  },
  // pilastro ottagono su un plinto, alto v
  pilastro(K, v = 3) {
    K.box("stone", -0.55, 0, -0.55, 0.55, 0.22, 0.55, PIETRA); K.I.drum("stone", 0, 0, 0.45, 0.22, v - 0.45, { tint: MURO }, 0.45, 8); K.box("stone", -0.55, v - 0.45, -0.55, 0.55, v, 0.55, PIETRA, { under: true });
    K.shade(-0.38, 0.22, -0.38, 0.38, v, 0.38);
  },
  candeliere(K) {
    K.I.drum("iron", 0, 0, 0.14, 0, 0.1, { tint: FERRATO }, 0.04, 6); K.box("iron", -0.02, 0.1, -0.02, 0.02, 1.5, 0.02, FERRATO); K.I.drum("iron", 0, 0, 0.09, 1.5, 1.53, { tint: FERRATO }, 0.09, 6);
    K.box("cloth", -0.03, 1.53, -0.03, 0.03, 1.75, 0.03, CERA); fiamma(K, 0, 1.755, 0, 0.022, 0.11);
  },
  braciere(K) {
    for (let i = 0; i < 3; i++) { const a = i * 2.094, x = Math.cos(a) * 0.2, z = Math.sin(a) * 0.2; K.box("iron", x - 0.015, 0, z - 0.015, x + 0.015, 0.46, z + 0.015, FERRATO); }
    K.I.drum("iron", 0, 0, 0.2, 0.44, 0.7, { tint: FERRATO }, 0.32, 8);
    embers(K.I.world(0, 0.66, 0), 0.27);
    fire(K.I.world(0, 0.7, 0), 0.42, 0.4, K.plain ? 1 : 0.12);
  },
  // argano della saracinesca: il tamburo coricato fra due cavalletti, le manovelle, la catena che scende
  argano(K) {
    for (const s of [-1, 1]) { K.box("wood", s * 0.67 - 0.05, 0, -0.05, s * 0.67 + 0.05, 1.12, 0.05, TRAVE); K.box("wood", s * 0.67 - 0.05, 0, -0.42, s * 0.67 + 0.05, 0.1, 0.42, TRAVE); K.box("iron", s * 0.84 - 0.015, 0.5, -0.015, s * 0.84 + 0.015, 0.83, 0.015, FERRATO); K.box("iron", s * 0.84 - 0.015, 0.48, -0.1, s * 0.84 + 0.015, 0.51, 0.1, FERRATO); }
    K.I.in(0.58, 0.81, 0, 0, () => K.I.drum("wood", 0, 0, 0.19, 0, 1.16, { tint: LEGNO }, 0.19, 8), PI / 2);
    K.box("iron", -0.86, 0.795, -0.015, 0.86, 0.825, 0.015, FERRATO); K.box("iron", -0.012, 0, -0.2, 0.012, 0.8, -0.176, FERRATO);
    K.shade(-0.58, 0.62, -0.19, 0.58, 1, 0.19);
  },
  // scaffale: lo schienale sul muro, il davanti guarda +Z. v = cosa c'è sopra: 0 stoviglie, 1 libri e carte, 2 roba di casa
  scaffale(K, v = 0) {
    K.box("wood", -0.7, 0, 0, 0.7, 1.9, 0.03, SCURO);
    for (const s of [-1, 1]) K.box("wood", s * 0.675 - 0.025, 0, 0.03, s * 0.675 + 0.025, 1.9, 0.4, LEGNO);
    for (const h of [0.08, 0.52, 0.98, 1.44, 1.86]) K.box("wood", -0.65, h, 0.03, 0.65, h + 0.04, 0.4, LEGNO, { under: true });
    K.minor(() => {
      if (v === 1) {   // file di libri, qualcuno coricato, rotoli
        for (const [h, n] of [[0.56, 7], [1.02, 9], [1.48, 6]]) for (let i = 0; i < n; i++) K.box("cloth", -0.6 + i * 0.11, h, 0.1, -0.52 + i * 0.11, h + 0.22 + (i * 7 % 5) * 0.025, 0.34, [VINO, CUOIO, MUSCHIO, LANA][(i + n) % 4]);
        for (const z of [0.12, 0.2, 0.28]) K.I.in(0.6, 1.07 + (z > 0.25 ? 0.07 : 0), z, 0, () => K.I.drum("cloth", 0, 0, 0.035, 0, 0.3, { tint: BIANCO }, 0.035, 6), PI / 2);
        K.box("cloth", -0.5, 0.12, 0.08, 0.3, 0.36, 0.36, CUOIO);
        return;
      }
      if (v !== 2) for (const bx of [-0.52, -0.38, -0.24, -0.1]) K.I.in(bx, 1.02, 0.22, 0, () => boccale(K));
      for (const [x, y, z] of v === 2 ? [[-0.4, 1.02, 0.2], [0.42, 1.48, 0.2]] : [[0.3, 1.02, 0.2], [0.5, 1.02, 0.24], [0.42, 1.48, 0.2]]) K.I.in(x, y, z, 0, () => brocca(K));
      K.box("cloth", 0.05, 0.12, 0.08, 0.6, 0.42, 0.36, LINO);                                // un sacco
      K.I.drum("wood", -0.35, 0.22, 0.16, 0.12, 0.48, { tint: LEGNO }, 0.16, 8);              // un barilotto
      for (const h of [0.6, 0.62]) K.box("wood", -0.6, h, 0.1, -0.05, h + 0.012, 0.34, ASSITO);   // due taglieri
      if (v === 2) { K.box("cloth", 0, 1.02, 0.08, 0.5, 1.2, 0.34, LANA); K.I.drum("brick", -0.3, 0.22, 0.09, 1.48, 1.6, { tint: TERRACOTTA }, 0.12, 6); }
    });
  },
  armadio(K) {
    K.box("wood", -0.6, 0.08, 0, 0.6, 1.84, 0.48, LEGNO); K.box("wood", -0.63, 0, 0, 0.63, 0.08, 0.5, TRAVE); K.box("wood", -0.64, 1.84, 0, 0.64, 1.94, 0.52, TRAVE);
    K.box("wood", -0.012, 0.08, 0.48, 0.012, 1.84, 0.487, SCURO);
    for (const s of [-1, 1]) { for (const h of [0.4, 1.5]) K.box("iron", s * 0.58 - 0.02, h, 0.48, s * 0.36, h + 0.04, 0.492, FERRATO); K.box("iron", s * 0.06 - 0.02, 0.92, 0.48, s * 0.06 + 0.02, 1.02, 0.5, FERRATO); }
  },
  // catasta di legna fra due pali
  legna(K) {
    for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) K.I.in(-0.52 + i * 0.208 + (j % 2) * 0.05, 0.11 + j * 0.2, 0, -PI / 2, () => K.I.drum("wood", 0, 0, 0.1, 0, 0.5, { tint: j % 2 ? LEGNO : ASSITO }, 0.1, 6), -PI / 2);
    for (const x of [-0.68, 0.7]) K.box("wood", x - 0.04, 0, 0.42, x + 0.04, 0.95, 0.5, TRAVE);
    K.shade(-0.6, 0, 0, 0.7, 0.8, 0.5);
  },
  rastrelliera(K) {
    for (const s of [-1, 1]) K.box("wood", s * 0.67 - 0.03, 0, 0, s * 0.67 + 0.03, 2, 0.08, TRAVE);
    for (const h of [0.2, 1.5]) K.box("wood", -0.7, h, 0.02, 0.7, h + 0.08, 0.1, TRAVE);
    [-0.44, -0.14, 0.16, 0.46].forEach((x, i) => {
      K.box("wood", x - 0.015, 0.02, 0.12, x + 0.015, i % 2 ? 2.12 : 2, 0.15, LEGNO);
      if (i % 2) K.I.pyramid("iron", x - 0.03, 0.105, x + 0.03, 0.165, 2.12, 2.4, { tint: FERRO });
      else { K.box("iron", x - 0.015, 2, 0.12, x + 0.14, 2.2, 0.15, FERRO); K.I.pyramid("iron", x - 0.02, 0.115, x + 0.02, 0.155, 2.2, 2.34, { tint: FERRO }); }
    });
  },
  // focolare contro il muro: piedritti, pietra, architrave, la cappa che stringe fino a v
  focolare(K, v = 2.8) {
    for (const s of [-1, 1]) K.box("stone", s > 0 ? 0.65 : -0.9, 0, 0, s > 0 ? 0.9 : -0.65, 1.25, 0.9, PIETRA, { open: true });
    K.box("stone", -0.65, 0, 0, 0.65, 0.15, 0.9, PIETRA);
    K.I.poly("stone", [[-0.65, 0.15, 0.01], [0.65, 0.15, 0.01], [0.65, 1.3, 0.01], [-0.65, 1.3, 0.01]], [0, 0, 1], { tint: FUMO });
    K.I.poly("stone", [[-0.65, 1.3, 0], [0.65, 1.3, 0], [0.65, 1.3, 0.65], [-0.65, 1.3, 0.65]], [0, -1, 0], { tint: FUMO });   // la gola: nera
    K.box("wood", -1, 1.25, 0.6, 1, 1.47, 0.96, TRAVE, { under: true });
    cappa(K, 0.9, 0.9, 1.47, 0.45, 0.5, v);
    fuoco(K, 0.15, 0.4);
    for (const s of [-1, 1]) K.box("iron", s * 0.52 - 0.02, 0.15, 0.35, s * 0.52 + 0.02, 0.42, 0.8, FERRO);   // gli alari
  },
  // camino della casa povera: una penisola di pietra che parte dal muro (lunga `foot[3]`), la bocca in testa, la canna fino a v
  camino(K, v = 6, p) {
    const D = p?.foot?.[3] ?? 2, m = D - 0.75;
    K.box("stone", -0.55, 0, 0, 0.55, 1.12, m, PIETRA);
    for (const s of [-1, 1]) K.box("stone", s > 0 ? 0.35 : -0.55, 0, m, s > 0 ? 0.55 : -0.35, 1.12, D, PIETRA, { open: true });
    K.box("stone", -0.35, 0, m, 0.35, 0.15, D, PIETRA); K.box("stone", -0.55, 0.95, m, 0.55, 1.12, D, PIETRA, { under: true });
    K.I.poly("stone", [[-0.35, 0.15, m + 0.01], [0.35, 0.15, m + 0.01], [0.35, 0.95, m + 0.01], [-0.35, 0.95, m + 0.01]], [0, 0, 1], { tint: FUMO });
    K.box("wood", -0.6, 1.12, D - 0.1, 0.6, 1.28, D + 0.06, TRAVE, { under: true });
    // la cappa sopra la bocca e la canna, che avvolge quella che si vede da fuori
    K.I.in(0, 0, D - 0.98, 0, () => { cappa(K, 0.55, 0.98, 1.12, 0.43, 0.86, 1.85); K.I.face("plaster", [[-0.55, 1.12, 0], [0.55, 1.12, 0], [0.43, 1.85, 0], [-0.43, 1.85, 0]], [0, 0.3, -1], { tint: INTONACO }); });
    K.box("stone", -0.43, 1.85, D - 0.98, 0.43, v, D - 0.12, MURO, { open: true });
    K.I.in(0, 0, m, 0, () => fuoco(K, 0.15, 0.32, 0.7));
  },
  canna: (K, v = 3) => K.box("stone", -0.5, 0, 0, 0.5, v, 1.2, MURO, { open: true }),
  // candela su un braccio di ferro che esce dal muro
  "candela.muro"(K) { K.box("iron", -0.012, -0.03, 0, 0.012, -0.006, 0.2, FERRO, { under: true }); K.I.in(0, -0.006, 0.17, 0, () => candela(K)); },
  stendardo(K) {
    K.box("wood", -0.56, 0.8, 0.02, 0.56, 0.86, 0.08, TRAVE); K.I.box("cloth", -0.5, -1.3, 0.03, 0.5, 0.8, 0.05, { tint: VINO });
    K.I.face("cloth", [[-0.5, -1.3, 0.04], [0.5, -1.3, 0.04], [0, -1.6, 0.04]], [0, 0, 1], { tint: VINO }); K.I.in(0, 0, 0.055, 0, () => K.I.disc("cloth", 0, -0.1, 0.24, 0, { tint: ORO }, 14));
  },
  // candelabro a ruota (otto lati, otto candele) appeso alle travi; v = quanto è grande (2: quelli della cattedrale, con le catene lunghe)
  candelabro(K, v = 1) {
    K.I.in(0, 0, 0, 0, () => {
      for (let i = 0; i < 8; i++) K.I.in(0, 0, 0, i * PI / 4, () => {
        K.box("wood", -0.25 * v, 0, 0.52 * v, 0.25 * v, 0.08, 0.52 * v + 0.08, TRAVE, { under: true });   // un lato della ruota
        K.box("iron", 0.2 * v, 0.08, 0.52 * v, 0.2 * v + 0.08, 0.095, 0.52 * v + 0.08, FERRO); K.box("cloth", 0.2 * v + 0.025, 0.095, 0.52 * v + 0.025, 0.2 * v + 0.055, 0.21, 0.52 * v + 0.055, CERA); fiamma(K, 0.2 * v + 0.04, 0.215, 0.52 * v + 0.04, 0.014, 0.075);
      });
      for (const a of [0, PI / 2]) K.I.in(0, 0, 0, a, () => K.box("wood", -0.56 * v, 0.01, -0.03, 0.56 * v, 0.07, 0.03, TRAVE, { under: true }));
      const top = v > 1 ? 5.2 : 1.17;
      for (let i = 0; i < 3; i++) { const a = i * 2.094; K.I.poly("iron", [[Math.cos(a) * 0.52 * v, 0.08, Math.sin(a) * 0.52 * v], [Math.cos(a + 0.05) * 0.52 * v, 0.08, Math.sin(a + 0.05) * 0.52 * v], [0.01, 0.8, 0.01], [0, 0.8, 0]], [-Math.sin(a), 0, Math.cos(a)], { tint: FERRATO }); }
      K.box("iron", -0.01, 0.8, -0.01, 0.01, top, 0.01, FERRATO);
    });
  },
  candela,
  // paiolo alla catena, sopra il fuoco
  paiolo(K) { K.I.drum("iron", 0, 0, 0.17, 0.62, 0.94, { tint: FERRATO }, 0.26, 8); K.box("iron", -0.008, 0.94, -0.008, 0.008, 1.6, 0.008, FERRO); },
  boccale, brocca,
  ciotola: (K) => K.I.drum("wood", 0, 0, 0.05, 0, 0.06, { tint: ASSITO }, 0.085, 6),
  cesta(K) { K.I.drum("cloth", 0, 0, 0.19, 0, 0.26, { tint: PAGLIA }, 0.24, 8); },
  secchio(K) { K.I.drum("wood", 0, 0, 0.13, 0, 0.3, { tint: LEGNO }, 0.16, 8); K.I.drum("iron", 0, 0, 0.145, 0.08, 0.11, { tint: FERRO }, 0.148, 8); },
  libri(K) { K.box("cloth", -0.14, 0, -0.1, 0.14, 0.05, 0.1, VINO); K.box("cloth", -0.12, 0.05, -0.09, 0.12, 0.09, 0.09, CUOIO); K.box("cloth", -0.13, 0.09, -0.08, 0.11, 0.14, 0.1, MUSCHIO); },
  // ── la fucina (all'aperto, nei materiali della città) ──
  mantice(K) {
    K.box("wood", -0.7, 0, 0.25, -0.62, 1.12, 0.33, TRAVE); K.box("wood", 0.26, 0, 0.25, 0.34, 0.84, 0.33, TRAVE); K.box("wood", -0.7, 0.4, 0.26, 0.34, 0.46, 0.32, TRAVE);
    for (const s of [-1, 1]) K.I.face("cloth", [[-0.6, 0.52, 0.29 + s * 0.22], [0.34, 0.64, 0.29 + s * 0.05], [0.34, 0.8, 0.29 + s * 0.05], [-0.6, 0.98, 0.29 + s * 0.22]], [0, 0, s], { tint: PELLE });
    K.I.face("cloth", [[-0.6, 0.98, 0.07], [0.34, 0.8, 0.24], [0.34, 0.8, 0.34], [-0.6, 0.98, 0.51]], [0, 1, 0], { tint: PELLE }); K.I.face("cloth", [[-0.6, 0.52, 0.07], [0.34, 0.64, 0.24], [0.34, 0.64, 0.34], [-0.6, 0.52, 0.51]], [0, -1, 0], { tint: PELLE });
    K.I.face("cloth", [[-0.6, 0.52, 0.07], [-0.6, 0.52, 0.51], [-0.6, 0.98, 0.51], [-0.6, 0.98, 0.07]], [-1, 0, 0], { tint: PELLE });
    K.box("iron", -1.05, 0.69, 0.27, -0.6, 0.75, 0.31, FERRO, { under: true }); K.box("wood", -0.74, 1.12, 0.27, 0.54, 1.17, 0.31, TRAVE, { rot: [0, 0, 0.08] });
  },
  "banco.lavoro"(K) {
    gambe(K, 0.72, 0.24, 0.84, 0.08); K.I.in(0, 0, 0.3, 0, () => { K.box("wood", -0.8, 0.84, -0.3, 0.8, 0.9, 0.3, LEGNO, { under: true }); K.box("wood", -0.7, 0.22, -0.22, 0.7, 0.28, 0.22, LEGNO, { under: true }); });
    K.box("iron", 0.38, 0.9, 0.2, 0.62, 1.04, 0.4, FERRO); K.box("iron", -0.5, 0.9, 0.22, -0.18, 0.94, 0.3, FERRO); K.box("wood", -0.38, 0.94, 0.24, -0.3, 1.04, 0.28, TRAVE);
  },
  attrezzi(K) {
    K.box("wood", -0.8, 0, 0, 0.8, 0.06, 0.06, TRAVE);
    [-0.6, -0.34, -0.08, 0.18, 0.44, 0.66].forEach((x, i) => { const l = 0.25 + (i % 3) * 0.08; K.box("iron", x - 0.012, -l, 0.02, x + 0.012, 0, 0.045, FERRO); if (i % 2) K.box("iron", x - 0.06, -l - 0.1, 0.015, x + 0.06, -l, 0.05, FERRO); else K.box("iron", x - 0.04, -l - 0.02, 0.02, x + 0.04, -l, 0.045, FERRO); });
  },
  tempra(K) { K.I.drum("wood", 0, 0, 0.36, 0, 0.55, { tint: LEGNO }, 0.4, 10); for (const h of [0.12, 0.4]) K.I.drum("iron", 0, 0, 0.375 + h * 0.07, h, h + 0.04, { tint: FERRO }, 0.378 + h * 0.07, 10); K.I.drum("iron", 0, 0, 0.37, 0.5, 0.51, { tint: ACQUA }, 0.37, 10); },
  carbone(K) { for (const [x, z, w, h] of [[0, 0, 0.45, 0.42], [0.2, 0.15, 0.3, 0.3], [-0.22, -0.1, 0.3, 0.26], [-0.05, 0.25, 0.25, 0.22]]) K.I.pyramid("iron", x - w, z - w, x + w, z + w, 0, h, { tint: CARBONE }); },
  mola(K) {
    for (const s of [-1, 1]) { K.box("wood", s * 0.35 - 0.04, 0, -0.2, s * 0.35 + 0.04, 0.62, -0.12, TRAVE); K.box("wood", s * 0.35 - 0.04, 0, 0.12, s * 0.35 + 0.04, 0.62, 0.2, TRAVE); K.box("wood", s * 0.35 - 0.04, 0.56, -0.2, s * 0.35 + 0.04, 0.62, 0.2, TRAVE); }
    K.I.in(0.06, 0.72, 0, 0, () => K.I.drum("stone", 0, 0, 0.3, 0, 0.12, { tint: [0.62, 0.62, 0.62] }, 0.3, 12), PI / 2);
    K.box("iron", -0.44, 0.705, -0.015, 0.44, 0.735, 0.015, FERRO); K.box("iron", 0.42, 0.72, -0.015, 0.45, 0.86, 0.015, FERRO); K.box("wood", -0.3, 0.3, -0.12, 0.3, 0.4, 0.12, LEGNO);
  },
};

/** Posa un pezzo: lo mette nel suo riferimento (i minuti nelle mesh a parte) e, se il cantiere lo vuole, ne aggiunge l'ostacolo. */
function put(K: Kit, t: PieceId, x: number, y: number, z: number, turn = 0, v?: number, p?: Piece): void {
  const d = PIECES[t] as { foot: Rect | number; h: number; minor?: boolean }, draw = (): void => K.I.in(x, y, z, turn, () => {
    ARREDI[t](K, v, p);
    if (!K.blocks || !d.h) return;
    const f = p?.foot ?? d.foot, r: Rect = typeof f === "number" ? [-f, -f, f, f] : f, h = t === "pilastro" || t === "canna" ? v ?? 3 : d.h;
    for (const s of caps(r[0], r[1], r[2], r[3], 0, h, typeof f === "number")) K.I.seg(s.ax, s.az, s.bx, s.bz, s.r, s.y0, s.y1);
  });
  if (d.minor) K.minor(draw); else draw();
}

/** Gli arredi di una pianta. Il forziere ha la serratura dalla parte di −Z: lo si gira. */
function furnishAll(K: Kit, L: Layout): void {
  for (const p of L.pieces) put(K, p.t, p.x, p.y, p.z, rad(p.turn + (p.t === "forziere" ? 180 : 0)), p.v, p);
}

/**
 * Gli arredi e i posti di una pianta all'aperto (la fucina), nel muratore della città e nei suoi materiali: niente luce
 * cotta, gli ostacoli a segmento. Va chiamata nel riferimento dell'edificio; restituisce il suo pezzo di rete degli abitanti.
 */
export function furnish(scene: Scene, M: Mason, L: Layout, id: string): Pick<Built, "nodes" | "links" | "spots"> {
  const K = new Kit(scene, M, id, () => M, null, true);
  K.blocks = true; K.frame();
  furnishAll(K, L);
  for (const p of L.places) K.place(p.name, p.x, p.y, p.z, p.deg, p.node);
  for (const [a, b] of L.links) K.link(a, b);
  return { nodes: K.nodes, links: K.links, spots: K.spots };
}

// ─────────────────────────────────────────────────────────────────────────────
// DALLA PIANTA ALL'INTERNO — stanze, vani, scale, impalcati, arredi, posti di una pianta di layouts.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Verso cui guarda chi esce da un muro (lo yaw del riferimento di un vano: +Z entra nel muro, +X corre lungo il muro). */
const OUT: Record<Side, number> = { "z+": 0, "x+": PI / 2, "z-": PI, "x-": -PI / 2 };
const OPP: Record<Side, Side> = { "x-": "x+", "x+": "x-", "z-": "z+", "z+": "z-" };
/** Lo yaw del riferimento in cui una rampa sale verso +Z. */
const UP = OUT;

function build(K: Kit, L: Layout): void {
  const I = K.I, room = (n: string): Room => L.rooms.find((r) => r.name === n)!;
  const vani = L.stairs.map((s) => ({ s, r: vanoRect(s) })).filter((v): v is { s: Stair; r: Rect } => !!v.r);
  const inRoom = (x: number, z: number, y: number): boolean => L.rooms.some((r) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1 && y > r.y - 0.3 && y < r.y + r.h);

  for (const r of L.rooms) {
    const [fk, ft] = FIN[r.floor], [wk, wt] = FIN[r.wall], top = r.y + r.h;
    const below = vani.filter((v) => Math.abs(v.s.y1 - r.y) < 0.5).map((v) => v.r), above = vani.filter((v) => Math.abs(v.s.y0 - r.y) < 0.5);
    K.slab(fk, r.y, r.x0, r.z0, r.x1, r.z1, 1, { tint: ft }, below, r.floor === "assi");
    for (const [a, b, c, d] of cells(r.x0, r.z0, r.x1, r.z1, below)) K.floor(a, b, c, d, r.y);
    // ── i quattro muri, coi loro vani ──
    for (const s of ["x-", "x+", "z-", "z+"] as Side[]) {
      const f = face(r, s), holes: number[][] = [];
      for (const o of L.openings) {
        const src = room(o.room), y = src.y + o.y0;
        if (o.room === r.name && o.side === s) holes.push(o.kind === "uscio" ? [o.at - o.w / 2 - 0.1, y, o.at + o.w / 2 + 0.1, y + o.h + 0.24] : [o.at - o.w / 2, y, o.at + o.w / 2, y + o.h]);
        else if (o.to === r.name && OPP[o.side] === s) holes.push([o.at - o.w / 2, y, o.at + o.w / 2, y + o.h]);
      }
      const ax = f.ax ? "z" : "x", dir = -f.dir as 1 | -1;
      if (r.foot) { K.panel("stone", ax, f.w, f.a0, f.a1, r.y, r.y + r.foot, dir, { tint: PIETRA }, holes); K.panel(wk, ax, f.w, f.a0, f.a1, r.y + r.foot, top, dir, { tint: wt }, holes); }
      else K.panel(wk, ax, f.w, f.a0, f.a1, r.y, top, dir, { tint: wt }, holes);
      // il timpano sotto le falde (i due muri di testa, quelli che il colmo attraversa): a fasce, perché la luce sta sui vertici
      if (r.ridge === ax) {
        const m = (f.a0 + f.a1) / 2, hw = (f.a1 - f.a0) / 2, n = Math.ceil(r.rise! / L.cell), p = (a: number, y: number): V3 => (f.ax ? [a, y, f.w] : [f.w, y, a]);
        for (let i = 0; i < n; i++) { const w0 = hw * (1 - i / n), w1 = hw * (1 - (i + 1) / n), y0 = top + r.rise! * i / n, y1 = top + r.rise! * (i + 1) / n; I.poly(wk, [p(m - w0, y0), p(m + w0, y0), p(m + w1, y1), p(m - w1, y1)], f.ax ? [0, 0, dir] : [dir, 0, 0], { tint: wt }); }
      }
    }
    // ── il soffitto ──
    if (r.ridge) {   // due falde a vista (paglia nelle case povere, tavole nella cattedrale), le catene, i monaci; il soffitto per chi salta sono due rampe
      const rx = r.ridge === "x", lo = rx ? r.z0 : r.x0, hi = rx ? r.z1 : r.x1, m = (lo + hi) / 2, a0 = rx ? r.x0 : r.z0, a1 = rx ? r.x1 : r.z1, yt = top + r.rise!, [ck, ct]: [string, Tint] = r.floor === "terra" ? ["thatch", STRAME] : ["wood", SCURO];
      const p = (a: number, y: number, c: number): V3 => (rx ? [a, y, c] : [c, y, a]);
      for (const [c, s] of [[lo, 1], [hi, -1]]) I.poly(ck, [p(a0, top, c), p(a1, top, c), p(a1, yt, m), p(a0, yt, m)], rx ? [0, -0.6, s] : [s, -0.6, 0], { tint: ct });
      for (const c of r.ties ?? []) {
        I.box("wood", ...(rx ? [c - 0.1, top, lo, c + 0.1, top + 0.22, hi] : [lo, top, c - 0.1, hi, top + 0.22, c + 0.1]) as Box, { tint: TRAVE, under: true });
        if (r.rise! > 4) I.box("wood", ...(rx ? [c - 0.09, top + 0.22, m - 0.09, c + 0.09, yt - 0.05, m + 0.09] : [m - 0.09, top + 0.22, c - 0.09, m + 0.09, yt - 0.05, c + 0.09]) as Box, { tint: TRAVE });
      }
      const half = (hi - lo) / 2;
      for (const s of [1, -1]) I.in(rx ? (r.x0 + r.x1) / 2 : m - s * half / 2, 0, rx ? m - s * half / 2 : (r.z0 + r.z1) / 2, rx ? (s > 0 ? 0 : PI) : (s > 0 ? PI / 2 : -PI / 2), () => K.floor(-(a1 - a0) / 2, -half / 2, (a1 - a0) / 2, half / 2, top + r.rise! / 2 + 0.3, 0.3, r.rise));
    } else {         // tavolato scuro, travi (interrotte dove passa una scala), il bordo del solaio attorno al vano
      const holes = above.map((v) => v.r), bx = r.beams === "x";
      K.slab("wood", top, r.x0, r.z0, r.x1, r.z1, -1, { tint: SCURO }, holes, true);
      for (const [a, b, c, d] of cells(r.x0, r.z0, r.x1, r.z1, holes)) K.floor(a, b, c, d, top + 0.1, 0.32);
      const lo = bx ? r.z0 : r.x0, hi = bx ? r.z1 : r.x1, n = Math.max(1, Math.round((hi - lo) / 1.25));
      for (let i = 0; i < n; i++) {
        const c = lo + (hi - lo) * (i + 0.5) / n;
        for (const [a, , b] of cells(bx ? r.x0 : r.z0, 0, bx ? r.x1 : r.z1, 1, holes.filter((h) => (bx ? c > h[1] - 0.1 && c < h[3] + 0.1 : c > h[0] - 0.1 && c < h[2] + 0.1)).map((h) => (bx ? [h[0], -1, h[2], 2] : [h[1], -1, h[3], 2]))))
          I.box("wood", ...(bx ? [a, top - 0.22, c - 0.1, b, top, c + 0.1] : [c - 0.1, top - 0.22, a, c + 0.1, top, b]) as Box, { tint: TRAVE, open: true, under: true });
      }
      for (const v of above) {
        const [x0, z0, x1, z1] = v.r, y1 = v.s.y1;
        K.panel("wood", "z", z0, x0, x1, top, y1, 1, { tint: TRAVE }); K.panel("wood", "z", z1, x0, x1, top, y1, -1, { tint: TRAVE });
        K.panel("wood", "x", x0, z0, z1, top, y1, 1, { tint: TRAVE }); K.panel("wood", "x", x1, z0, z1, top, y1, -1, { tint: TRAVE });
      }
    }
  }

  // ── i vani: nel loro riferimento (origine sul filo della stanza, +Z dentro il muro, +X lungo il muro) ──
  L.openings.forEach((o, n) => {
    const r = room(o.room), t = thick(L, r, o.side), [px, pz] = point(r, o.side, o.at), hw = o.w / 2, h = o.h, [wk, wt] = FIN[r.wall], [fk, ft] = FIN[r.floor];
    const arcata = (z: number, y0: number, hh: number, top: number, nz: 1 | -1): void => {   // i pennacchi fra un vano rettangolare e il suo arco a sesto acuto
      for (const g of [-1, 1]) for (let i = 0; i < 5; i++) { const a = I.archSide(0, y0, o.w, hh, z, g, i / 5), b = I.archSide(0, y0, o.w, hh, z, g, (i + 1) / 5); I.face(wk, [a, b, [b[0], top, z], [a[0], top, z]], [0, 0, nz], { tint: wt }); }
    };
    I.in(px, r.y + o.y0, pz, OUT[o.side], () => {
      if (o.kind === "finestra") {   // una nicchia e, in fondo, i vetri piombati (opachi: da fuori non si vede dentro)
        const d = Math.min(0.28, t - 0.1);   // i vetri stanno più dentro della finestra finta che si vede da fuori
        for (const s of [-1, 1]) I.poly(wk, [[s * hw, 0, 0], [s * hw, 0, d], [s * hw, h, d], [s * hw, h, 0]], [-s, 0, 0], { tint: wt });
        I.poly(wk, [[-hw, 0, 0], [hw, 0, 0], [hw, 0, d], [-hw, 0, d]], [0, 1, 0], { tint: wt }); I.poly(wk, [[-hw, h, 0], [hw, h, 0], [hw, h, d], [-hw, h, d]], [0, -1, 0], { tint: wt });
        if (o.arch) { I.arch("glass", 0, 0, o.w, h, d); arcata(d - 0.005, 0, h, h, -1); } else I.poly("glass", [[-hw, 0, d], [hw, 0, d], [hw, h, d], [-hw, h, d]], [0, 0, -1]);
        return;
      }
      const usc = o.kind === "uscio", jw = usc ? hw + 0.1 : hw, top = usc ? h + 0.24 : h, zl = usc ? t - LIP : t;
      // lo sguancio: spallette, cielo, soglia; il pavimento del passaggio e il suo soffitto basso (chi salta sulla soglia batte la testa)
      if (o.kind !== "porta") for (const s of [-1, 1]) I.poly(wk, [[s * jw, 0, 0], [s * jw, 0, zl], [s * jw, top, zl], [s * jw, top, 0]], [-s, 0, 0], { tint: wt });
      if (o.kind !== "porta") I.poly(wk, [[-jw, top, 0], [jw, top, 0], [jw, top, zl], [-jw, top, zl]], [0, -1, 0], { tint: wt });
      I.poly(o.kind === "porta" ? fk : "stone", [[-jw, 0.002, 0], [jw, 0.002, 0], [jw, 0.002, zl], [-jw, 0.002, zl]], [0, 1, 0], { tint: o.kind === "porta" ? ft : PIETRA });
      K.floor(-jw - 0.1, -0.05, jw + 0.1, usc ? t + 0.45 : t + 0.05, 0); K.floor(-jw - 0.1, -0.02, jw + 0.1, t + 0.02, top + 0.3, 0.3);
      if (o.kind === "varco") { if (o.arch) { arcata(0, 0, h, h, -1); arcata(t, 0, h, h, 1); for (const g of [-1, 1]) for (let i = 0; i < 5; i++) { const a = I.archSide(0, 0, o.w, h, 0, g, i / 5), b = I.archSide(0, 0, o.w, h, 0, g, (i + 1) / 5); I.face(wk, [a, b, [b[0], b[1], t], [a[0], a[1], t]], [-g, -1, 0], { tint: wt }); } } return; }
      const name = `${K.id}_${usc ? "uscio" : "porta"}${n}`;   // (i nomi contano solo per chi guarda la scena)
      if (usc) {
        // il rovescio della battuta: attorno al vano vero (a sesto acuto o dritto), che è quello che town.ts apre nella facciata. L'arco parte dalla strada, non dal pavimento
        for (const s of [-1, 1]) I.poly(wk, [[s * hw, 0, zl], [s * jw, 0, zl], [s * jw, top, zl], [s * hw, top, zl]], [0, 0, -1], { tint: wt });
        if (o.arch) arcata(zl, -r.y, h + r.y, top, -1); else I.poly(wk, [[-hw, h, zl], [hw, h, zl], [hw, top, zl], [-hw, top, zl]], [0, 0, -1], { tint: wt });
        const two = o.w >= 1.6, hy = h + (o.arch ? 0.1 : 0.04), z = zl - 0.065;
        // un'anta sola si apre contro il muro più vicino
        const a = face(r, o.side), side = (o.at - a.a0 < a.a1 - o.at ? -1 : 1) * (K.at(1, 0, 0)[a.ax ? 0 : 2] - K.at(0, 0, 0)[a.ax ? 0 : 2] > 0 ? 1 : -1);
        K.doors.push({ y: TOWN.y + r.y, angle: PI / 2, leaves: two ? [K.leaf(`${name}_a`, [jw, 0, z], [0, 0, z], hy, 0.06, -1, true), K.leaf(`${name}_b`, [-jw, 0, z], [0, 0, z], hy, 0.06, 1, true)]
          : [K.leaf(name, [side * jw, 0, z], [-side * hw, 0, z], hy, 0.06, -side as 1 | -1, true)] });
        return;
      }
      // una porta fra due stanze: il telaio (due montanti e l'architrave, che fanno anche da spalletta) e l'anta, che si apre nell'altra stanza
      for (const s of [-1, 1]) K.box("wood", Math.min(s * hw, s * (hw + 0.1)), 0, -0.02, Math.max(s * hw, s * (hw + 0.1)), h, t + 0.02, TRAVE);
      K.box("wood", -hw - 0.1, h, -0.02, hw + 0.1, h + 0.12, t + 0.02, TRAVE, { under: true });
      K.doors.push({ y: TOWN.y + r.y + o.y0, angle: PI / 2, leaves: [K.leaf(name, [hw, 0, t], [-hw, 0, t], h, 0.05, 1, false)] });
    });
  });

  // ── le scale: nel loro riferimento (origine al piede, in mezzo; si sale verso +Z). In gioco si sale una rampa: i gradini sono solo disegno ──
  for (const s of L.stairs) {
    const [x0, z0, x1, z1] = s.rect, al = s.up[0] === "x", sg = s.up[1] === "+" ? 1 : -1, run = al ? x1 - x0 : z1 - z0, hw = (al ? z1 - z0 : x1 - x0) / 2, ped = run / (s.n - 1), alz = (s.y1 - s.y0) / s.n, cut = run - Math.min(s.vano, run);
    I.in(al ? (sg > 0 ? x0 : x1) : (x0 + x1) / 2, 0, al ? (z0 + z1) / 2 : (sg > 0 ? z0 : z1), UP[s.up], () => {
      const open = [-1, 1].filter((q) => { const p = K.at(q * (hw + 0.2), 0, run / 2); return inRoom(p[0], p[2], s.y0 + 0.5); });   // i fianchi che non stanno contro un muro
      for (let i = 0; i < s.n; i++) {
        const z = i * ped, top = s.y0 + (i + 1) * alz;
        I.poly("wood", [[-hw, top - alz, z], [hw, top - alz, z], [hw, top, z], [-hw, top, z]], [0, 0, -1], { tint: TRAVE });
        if (i === s.n - 1) break;
        I.poly("wood", [[-hw, top, z], [hw, top, z], [hw, top, z + ped], [-hw, top, z + ped]], [0, 1, 0], { tint: ASSITO });
        for (const q of open) I.poly("wood", [[q * hw, s.under ? s.y0 : top - alz - 0.2, z], [q * hw, s.under ? s.y0 : top - 0.2, z + ped], [q * hw, top, z + ped], [q * hw, top, z]], [q, 0, 0], { tint: ASSITO });
        if (i % 2 === 0) K.shade(-hw, s.under ? s.y0 : top - 0.25, z, hw, top + alz, z + 2 * ped);
      }
      if (s.under) I.poly("wood", [[-hw, s.y0, run], [hw, s.y0, run], [hw, s.y1 - 0.12, run], [-hw, s.y1 - 0.12, run]], [0, 0, 1], { tint: ASSITO });
      else I.poly("wood", [[-hw, s.y0 - 0.2, 0], [hw, s.y0 - 0.2, 0], [hw, s.y1 - alz - 0.2, run], [-hw, s.y1 - alz - 0.2, run]], [0, -1, 0], { tint: SCURO });
      // corrimano sui fianchi aperti; attorno al vano, di sopra, il parapetto
      for (const q of open) {
        const x = q * (hw - 0.04);
        for (let i = 0; i < s.n - 1; i += 4) K.box("wood", x - 0.04, s.y0 + (i + 1) * alz, i * ped + 0.02, x + 0.04, s.y0 + (i + 1) * alz + 0.95, i * ped + 0.1, TRAVE);
        K.box("wood", x - 0.04, (s.y0 + s.y1) / 2 + 0.92, 0, x + 0.04, (s.y0 + s.y1) / 2 + 0.98, Math.hypot(run, s.y1 - s.y0 - alz), TRAVE, { under: true, rot: [-Math.atan2(s.y1 - s.y0 - alz, run), 0, 0] });
        if (cut > 0) { for (let z = cut; z < run - 0.3; z += 1.2) K.box("wood", x - 0.04, s.y1, z, x + 0.04, s.y1 + 0.98, z + 0.08, TRAVE); for (const hh of [0.45, 0.92]) K.box("wood", x - 0.04, s.y1 + hh, cut, x + 0.04, s.y1 + hh + 0.06, run, TRAVE, { under: true }); }
      }
      if (cut > 0) { for (const q of [-1, 0, 1]) K.box("wood", q * (hw - 0.04) - 0.04, s.y1, cut - 0.08, q * (hw - 0.04) + 0.04, s.y1 + 0.98, cut, TRAVE); for (const hh of [0.45, 0.92]) K.box("wood", -hw, s.y1 + hh, cut - 0.08, hw, s.y1 + hh + 0.06, cut, TRAVE, { under: true }); }
      // la rampa passa a metà di ogni gradino: comincia e finisce mezza alzata dentro i due pavimenti
      K.floor(-hw, 0, hw, run, (s.y0 + s.y1) / 2, s.under ? undefined : 0.25, s.y1 - s.y0 - alz);
    });
  }
  // ── impalcati e parapetti ──
  for (const d of L.decks) {
    const [x0, z0, x1, z1] = d.rect;
    K.slab("wood", d.y, x0, z0, x1, z1, 1, { tint: ASSITO }, [], true); K.slab("wood", d.y - d.t, x0, z0, x1, z1, -1, { tint: SCURO }, [], true);
    K.panel("wood", "z", z0, x0, x1, d.y - d.t, d.y, -1, { tint: TRAVE }); K.panel("wood", "z", z1, x0, x1, d.y - d.t, d.y, 1, { tint: TRAVE });
    K.floor(x0, z0, x1, z1, d.y, d.t);
  }
  for (const d of L.steps) K.floor(d.rect[0], d.rect[1], d.rect[2], d.rect[3], d.y);
  for (const c of L.rails) {
    const y = c.y0 + 0.25, n = Math.max(1, Math.round(Math.hypot(c.bx - c.ax, c.bz - c.az) / 1.1));
    for (let i = 0; i <= n; i++) { const x = c.ax + (c.bx - c.ax) * i / n, z = c.az + (c.bz - c.az) * i / n; K.box("wood", x - 0.04, y, z - 0.04, x + 0.04, y + 0.98, z + 0.04, TRAVE); }
    for (const hh of [0.45, 0.92]) K.box("wood", Math.min(c.ax, c.bx) - 0.04, y + hh, Math.min(c.az, c.bz) - 0.04, Math.max(c.ax, c.bx) + 0.04, y + hh + 0.06, Math.max(c.az, c.bz) + 0.04, TRAVE, { under: true });
  }

  furnishAll(K, L);
  for (const l of lamps(L)) K.light(l.x, l.y, l.z, l.r, l.f, l.n && [l.n[0], 0, l.n[1]]);
  for (const c of [...walls(L), ...solids(L)]) I.seg(c.ax, c.az, c.bx, c.bz, c.r, c.y0, c.y1);
  for (const p of L.places) K.place(p.name, p.x, p.y, p.z, p.deg, p.node);
  for (const [a, b] of L.links) K.link(a, b);
}

// ─────────────────────────────────────────────────────────────────────────────
// LA LOCANDA — fatta a mano dalle tavole interni-1-locanda e interni-2-arredi (è stata la pilota degli interni).
// Piano terra: la sala (focolare a −X, bancone e cucina a +X, scala lungo il muro di fondo). Primo piano: corridoio e tre camere. Sopra è chiuso.
// ─────────────────────────────────────────────────────────────────────────────

// faccia interna dei muri, pavimenti, sotto il tavolato e sotto le travi (piano terra), soffitto e travi del primo piano
const IW = 4.1, Y0 = 0.12, Y1 = 3.52, DECK = 3.42, BEAM = 3.2, CEIL = 6.49, BEAM1 = 6.3;
/** La rampa lungo il muro di fondo: piede, cima, larghezza, dove comincia il vano nel solaio, alzate. */
const STAIR = { x0: -2, x1: 2.8, z0: -IW, z1: -2.9, vano: -0.8, n: 17 };
const TABLES: [number, number][] = [[-0.5, -2], [-3, 3.3], [3, 3.3]];
/** Le camere: da x a x, centro della porta, cardine, letto, centro, sgabello. */
const ROOMS = [[-IW, -1.4, -2.1, -1.5, -3.55, -2.2, -2.75], [-1.1, 1.1, -0.4, -1, 0.55, -0.45, -0.75], [1.4, IW, 2.1, 1.5, 3.55, 2.2, 2.75]];

function locanda(K: Kit): void {
  const I = K.I;
  K.blocks = true;
  const box = (k: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, tint: Tint, o: Opt = {}): void => K.box(k, x0, y0, z0, x1, y1, z1, tint, o);
  const light = (x: number, y: number, z: number, r: number, f: number, cold = false): void => K.light(x, y, z, r, f, cold ? [0, 0, -1] : undefined);
  const floor = (x0: number, z0: number, x1: number, z1: number, y: number, thick?: number): void => K.floor(x0, z0, x1, z1, y, thick);
  const candelaSu = (x: number, y: number, z: number): void => put(K, "candela", x, y, z);
  const candelaMuro = (x: number, y: number, z: number, nz: number): void => put(K, "candela.muro", x, y, z, nz > 0 ? 0 : PI);
  const sgabello = (x: number, y: number, z: number): void => put(K, "sgabello", x, y, z);
  const boccale = (x: number, y: number, z: number): void => put(K, "boccale", x, y, z), brocca = (x: number, y: number, z: number): void => put(K, "brocca", x, y, z);
  /** Botte da mescita coricata sul cavalletto, col fondo e la spina verso −X. */
  const botteDaMescita = (z: number): void => {
    I.in(IW, Y0 + 0.75, z, 0, () => {   // coricata: la y del tamburo va verso −X
      I.drum("wood", 0, 0, 0.29, 0, 0.45, { tint: LEGNO }, 0.35); I.drum("wood", 0, 0, 0.35, 0.45, 0.9, { tint: LEGNO }, 0.29);
      for (const [h, r] of [[0.07, 0.305], [0.3, 0.337], [0.56, 0.337], [0.79, 0.305]]) I.drum("iron", 0, 0, r, h, h + 0.045, { tint: FERRO }, r);
      box("iron", -0.24, 0.9, -0.02, -0.18, 1.02, 0.02, FERRO);
    }, PI / 2);
    for (const x of [3.36, 3.86]) box("wood", x, Y0, z - 0.33, x + 0.08, Y0 + 0.5, z + 0.33, TRAVE);
    box("wood", 3.44, Y0 + 0.1, z - 0.03, 3.86, Y0 + 0.16, z + 0.03, TRAVE);
    I.seg(3.55, z, 3.75, z, 0.36, Y0, Y0 + 1.2);
    K.shade(3.2, Y0 + 0.42, z - 0.33, IW, Y0 + 1.1, z + 0.33);
  };

  // ── piano terra: pavimento, muri, soffitto ──
  K.slab("brick", Y0, -IW, STAIR.z1, IW, IW, 1, { tint: COTTO }, [[-IW, -1.1, -2.8, 1.1], [3.3, -0.8, IW, 0.8]]);
  K.slab("brick", Y0, -IW, -IW, STAIR.x0, STAIR.z1, 1, { tint: COTTO }); K.slab("brick", Y0, STAIR.x1, -IW, IW, STAIR.z1, 1, { tint: COTTO });
  K.panel("stone", "z", -IW, -IW, IW, Y0, Y1, 1, { tint: MURO });
  K.panel("stone", "x", -IW, -IW, IW, Y0, Y1, 1, { tint: MURO }, [[-1.1, Y0, 1.1, Y0 + 1.55]]);
  K.panel("stone", "x", IW, -IW, IW, Y0, Y1, -1, { tint: MURO });
  K.panel("stone", "z", IW, -IW, IW, Y0, Y1, -1, { tint: MURO }, [[-0.95, Y0, 0.95, 2.74], [-3.42, 1.1, -2.52, 2.5], [2.52, 1.1, 3.42, 2.5]]);
  // sotto il tavolato: tre rettangoli (il resto è il vano della scala), le travi lungo Z, i travetti attorno al vano
  const soffitto = (x0: number, z0: number, x1: number, z1: number, holes: number[][] = []): void => K.slab("wood", DECK, x0, z0, x1, z1, -1, { tint: SCURO }, holes, true);
  soffitto(-IW, STAIR.z1, IW, IW, [[-IW, -0.5, -2.8, 0.5], [2.8, -0.5, IW, 0.5]]); soffitto(-IW, -IW, STAIR.vano, STAIR.z1); soffitto(STAIR.x1, -IW, IW, STAIR.z1);
  for (const x of [-2.4, -1.2, 0, 1.2, 2.4]) box("wood", x - 0.1, BEAM, x < STAIR.vano ? -IW : STAIR.z1 + 0.18, x + 0.1, DECK, IW, TRAVE, { open: true, under: true });
  box("wood", STAIR.vano, BEAM, STAIR.z1, STAIR.x1, DECK, STAIR.z1 + 0.18, TRAVE, { open: true, under: true });
  box("wood", STAIR.vano - 0.18, BEAM, -IW, STAIR.vano, DECK, STAIR.z1, TRAVE, { open: true, under: true });
  box("wood", STAIR.x1, BEAM, -IW, STAIR.x1 + 0.18, DECK, STAIR.z1, TRAVE, { open: true, under: true });
  K.panel("wood", "z", STAIR.z1, STAIR.vano, STAIR.x1, DECK, Y1, -1, { tint: TRAVE }); K.panel("wood", "x", STAIR.vano, -IW, STAIR.z1, DECK, Y1, 1, { tint: TRAVE });   // il bordo del tavolato sul vano

  // ── finestre: una nicchia nel muro e, in fondo, i vetri piombati (opachi: da fuori non si vede dentro) ──
  const finestra = (xc: number, w: number, y0: number, y1: number, zo: number, k: string, tint: Tint): void => {
    const a = xc - w / 2, b = xc + w / 2;
    I.poly(k, [[a, y0, IW], [a, y0, zo], [a, y1, zo], [a, y1, IW]], [1, 0, 0], { tint }); I.poly(k, [[b, y0, IW], [b, y0, zo], [b, y1, zo], [b, y1, IW]], [-1, 0, 0], { tint });
    I.poly(k, [[a, y0, IW], [b, y0, IW], [b, y0, zo], [a, y0, zo]], [0, 1, 0], { tint }); I.poly(k, [[a, y1, IW], [b, y1, IW], [b, y1, zo], [a, y1, zo]], [0, -1, 0], { tint });
    I.poly("glass", [[a, y0, zo], [b, y0, zo], [b, y1, zo], [a, y1, zo]], [0, 0, -1]);
    light(xc, (y0 + y1) / 2, IW - 0.12, 5.5, 0.9, true);
  };
  for (const s of [-1, 1]) finestra(s * 2.97, 0.9, 1.1, 2.5, IW + 0.28, "stone", MURO);
  for (const s of [-1, 0, 1]) finestra(s * 2.7, 1, 4.2, 6.1, IW + 0.26, "plaster", INTONACO);

  // ── il portone visto da dentro: lo sguancio rettangolare e il rovescio della battuta a sesto acuto ──
  const { w: pw, h: ph } = PORTONE, zl = 4.5 - PORTONE.lip, pt = 2.74;
  for (const s of [-1, 1]) {
    I.poly("stone", [[s * 0.95, Y0, IW], [s * 0.95, Y0, zl], [s * 0.95, pt, zl], [s * 0.95, pt, IW]], [-s, 0, 0], { tint: MURO });
    I.poly("stone", [[s * pw / 2, Y0, zl], [s * 0.95, Y0, zl], [s * 0.95, pt, zl], [s * pw / 2, pt, zl]], [0, 0, -1], { tint: MURO });
    for (let i = 0; i < 5; i++) {
      const a = I.archSide(0, 0, pw, ph, zl, s, i / 5), b = I.archSide(0, 0, pw, ph, zl, s, (i + 1) / 5);
      I.face("stone", [a, b, [b[0], pt, zl], [a[0], pt, zl]], [0, 0, -1], { tint: MURO });
    }
  }
  I.poly("stone", [[-0.95, pt, IW], [0.95, pt, IW], [0.95, pt, zl], [-0.95, pt, zl]], [0, -1, 0], { tint: MURO });
  I.poly("stone", [[-0.95, Y0 + 0.002, IW], [0.95, Y0 + 0.002, IW], [0.95, Y0 + 0.002, zl], [-0.95, Y0 + 0.002, zl]], [0, 1, 0], { tint: PIETRA });
  box("wood", 1.18, Y0, IW - 0.12, 1.3, Y0 + 1.9, IW - 0.02, TRAVE);   // la stanga, tolta e appoggiata al muro finché è giorno

  // ── il focolare della sala (muro −X): piedritti, pietra, architrave, cappa che stringe verso la canna ──
  for (const s of [-1, 1]) box("stone", -IW, Y0, s > 0 ? 0.75 : -1.1, -2.8, Y0 + 1.55, s > 0 ? 1.1 : -0.75, PIETRA, { open: true });
  box("stone", -IW, Y0, -0.75, -2.8, Y0 + 0.15, 0.75, PIETRA);
  K.panel("stone", "x", -IW + 0.01, -0.75, 0.75, Y0 + 0.15, Y0 + 1.6, 1, { tint: FUMO });
  K.slab("stone", Y0 + 1.6, -IW, -0.75, -3.05, 0.75, -1, { tint: FUMO });   // la gola: nera
  box("wood", -3.1, Y0 + 1.25, -1.2, -2.74, Y0 + 1.55, 1.2, TRAVE, { under: true });
  const hood = (x0: number, x1: number, zb: number, zt: number, yb: number, yt: number, facing: 1 | -1): void => {   // cappa a tronco: il davanti e i due fianchi
    const xf = facing > 0 ? x1 : x0;
    I.face("plaster", [[xf, yb, -zb], [xf, yb, zb], [xf, yt, zt], [xf, yt, -zt]], [facing, 0, 0], { tint: INTONACO });
    for (const s of [-1, 1]) I.face("plaster", [[x0, yb, s * zb], [x1, yb, s * zb], [x1, yt, s * zt], [x0, yt, s * zt]], [0, 0.3, s], { tint: INTONACO });
    K.shade(x0, yb, -zb + 0.15, x1, yt, zb - 0.15);
  };
  hood(-IW, -2.8, 1.1, 0.5, Y0 + 1.55, DECK, 1);
  box("wood", -3.85, Y0 + 0.15, -0.3, -3.05, Y0 + 0.25, -0.16, SCURO); box("wood", -3.8, Y0 + 0.15, 0.12, -3.0, Y0 + 0.25, 0.26, SCURO); box("wood", -3.7, Y0 + 0.25, -0.34, -3.56, Y0 + 0.35, 0.3, SCURO);   // i ciocchi
  for (const s of [-1, 1]) box("iron", -3.4, Y0 + 0.15, s * 0.56 - 0.02, -3.0, Y0 + 0.42, s * 0.56 + 0.02, FERRO);                                                                                              // gli alari
  fire(I.world(-3.42, Y0 + 0.31, 0), 0.72, 0.75, 0.12);
  embers(I.world(-3.42, Y0 + 0.25, 0), 0.36);   // la brace
  light(-3.1, Y0 + 0.65, 0, 9, 1);
  I.seg(-2.9, -1, -2.9, 1, 0.1, 0, 3.3); for (const s of [-1, 1]) I.seg(-IW, s, -2.9, s, 0.1, 0, 3.3);   // la bocca è chiusa al passo
  for (const s of [-1, 1]) sgabello(-2.45, Y0, s * 1.05);
  // la legna, accatastata fra due pali
  for (let j = 0; j < 4; j++) for (let i = 0; i < 6; i++) I.in(-IW, Y0 + 0.11 + j * 0.2, -2.52 + i * 0.208 + (j % 2) * 0.05, 0, () => I.drum("wood", 0, 0, 0.1, 0, 0.5, { tint: j % 2 ? LEGNO : ASSITO }, 0.1, 6), -PI / 2);
  for (const z of [-2.68, -1.3]) box("wood", -3.68, Y0, z, -3.6, Y0 + 0.95, z + 0.08, TRAVE);
  I.seg(-3.85, -2.4, -3.85, -1.5, 0.25, 0, 1);

  // ── la scala: 17 alzate da 20 cm e 16 pedate da 30, chiusa sotto da un assito; in gioco si sale una rampa ──
  const ped = (STAIR.x1 - STAIR.x0) / (STAIR.n - 1), alz = (Y1 - Y0) / STAIR.n;
  for (let i = 0; i < STAIR.n; i++) {
    const x = STAIR.x0 + i * ped, top = Y0 + (i + 1) * alz;
    I.poly("wood", [[x, top - alz, STAIR.z0], [x, top - alz, STAIR.z1], [x, top, STAIR.z1], [x, top, STAIR.z0]], [-1, 0, 0], { tint: TRAVE });
    if (i === STAIR.n - 1) break;
    I.poly("wood", [[x, top, STAIR.z0], [x + ped, top, STAIR.z0], [x + ped, top, STAIR.z1], [x, top, STAIR.z1]], [0, 1, 0], { tint: ASSITO });
    I.poly("wood", [[x, Y0, STAIR.z1], [x + ped, Y0, STAIR.z1], [x + ped, top, STAIR.z1], [x, top, STAIR.z1]], [0, 0, 1], { tint: ASSITO });
    if (i % 2 === 0) K.shade(x, Y0, STAIR.z0, x + 2 * ped, top, STAIR.z1);
  }
  K.panel("wood", "x", STAIR.x1, STAIR.z0, STAIR.z1, Y0, DECK, 1, { tint: ASSITO });
  // parapetti: sulla scala (colonnini e corrimano inclinato) e attorno al vano, al primo piano
  for (let i = 0; i < 16; i += 4) box("wood", STAIR.x0 + i * ped + 0.02, Y0 + (i + 1) * alz, STAIR.z1 - 0.08, STAIR.x0 + i * ped + 0.1, Y0 + (i + 1) * alz + 0.95, STAIR.z1, TRAVE);
  box("wood", 0.4 - 2.9, Y0 + 2.72, STAIR.z1 - 0.08, 0.4 + 2.9, Y0 + 2.78, STAIR.z1, TRAVE, { under: true, rot: [0, 0, Math.atan2((STAIR.n - 1) * alz, STAIR.x1 - STAIR.x0)] });
  for (const x of [STAIR.vano, 0.4, 1.6, STAIR.x1]) box("wood", x - 0.04, Y1, STAIR.z1, x + 0.04, Y1 + 0.98, STAIR.z1 + 0.08, TRAVE);
  for (const h of [0.45, 0.92]) box("wood", STAIR.vano - 0.04, Y1 + h, STAIR.z1, STAIR.x1 + 0.04, Y1 + h + 0.06, STAIR.z1 + 0.08, TRAVE, { under: true });
  box("wood", STAIR.vano - 0.08, Y1, -IW, STAIR.vano, Y1 + 0.98, -IW + 0.08, TRAVE);
  for (const h of [0.45, 0.92]) box("wood", STAIR.vano - 0.08, Y1 + h, -IW, STAIR.vano, Y1 + h + 0.06, STAIR.z1, TRAVE, { under: true });
  I.seg(STAIR.x0, STAIR.z1 - 0.04, STAIR.vano, STAIR.z1 - 0.04, 0.06, 0, 2.2);            // il fianco della scala sotto il ripostiglio
  I.seg(STAIR.vano, STAIR.z1, STAIR.x1, STAIR.z1, 0.07, 0, Y1 + 1);                         // il fianco e, sopra, il parapetto del vano: chi lo scavalca cade sulla rampa
  I.seg(STAIR.vano - 0.04, -IW, STAIR.vano - 0.04, STAIR.z1, 0.06, Y1, Y1 + 1);
  I.seg(STAIR.x1, -IW, STAIR.x1, STAIR.z1, 0.05, 0, 3.15);                                  // il fondo del sottoscala (chi sale ci passa sopra)
  candelaMuro(0.4, 3.56, -IW, 1); light(0.4, 3.66, -IW + 0.2, 4, 0.45);
  put(K, "botte", 3.72, Y0, -3.72); box("cloth", 2.9, Y0, -4.0, 3.38, Y0 + 0.5, -3.5, LINO); I.seg(3.15, -3.74, 3.15, -3.74, 0.27, Y0, Y0 + 0.6);   // sotto l'arrivo: una botte, un sacco

  // ── il bancone, le botti da mescita, la cucina (muro +X) ──
  box("wood", 1.7, Y0, STAIR.z1, 1.76, Y0 + 0.97, 1.1, ASSITO); box("wood", 1.76, Y0, 1.04, 2.3, Y0 + 0.97, 1.1, ASSITO);
  for (const z of [-2.84, -1.6, -0.3, 0.98]) box("wood", 2.24, Y0, z, 2.3, Y0 + 0.97, z + 0.06, TRAVE);
  box("wood", 1.76, Y0 + 0.48, STAIR.z1, 2.26, Y0 + 0.52, 1.04, LEGNO, { under: true });
  box("wood", 1.64, Y0 + 0.97, STAIR.z1, 2.3, Y0 + 1.05, 1.14, LEGNO, { under: true });
  I.seg(2, -2.6, 2, 0.8, 0.3, 0, 1.25);
  for (const [cz, bz] of [[-2.5, -2.1], [0.6, 0.25]]) { candelaSu(2, Y0 + 1.05, cz); light(2, Y0 + 1.27, cz, 3.5, 0.4); boccale(1.9, Y0 + 1.05, bz); }
  brocca(2.05, Y0 + 1.05, -0.9); boccale(1.85, Y0 + 1.05, -1.2);
  for (const s of [-2.3, -1.5]) sgabello(1.35, Y0, s);
  botteDaMescita(-2.3); botteDaMescita(-1.45);
  box("stone", 3.3, Y0, -0.8, IW, Y0 + 0.5, 0.8, PIETRA);                                   // il banco di pietra col fuoco sopra
  K.panel("stone", "x", IW - 0.01, -0.8, 0.8, Y0 + 0.5, Y0 + 2.15, -1, { tint: FUMO });
  embers(I.world(3.7, Y0 + 0.48, 0.05), 0.22); fire(I.world(3.7, Y0 + 0.52, 0.05), 0.4, 0.38, 0.12);
  I.drum("iron", 3.7, 0, 0.17, Y0 + 0.76, Y0 + 1.08, { tint: FERRATO }, 0.26, 8); box("iron", 3.692, Y0 + 1.08, -0.008, 3.708, Y0 + 2.2, 0.008, FERRO);   // il paiolo alla catena
  for (const s of [-1, 1]) box("stone", 3.72, Y0 + 1.9, s * 0.83 - 0.07, IW, Y0 + 2.15, s * 0.83 + 0.07, PIETRA, { under: true });                          // le mensole
  box("wood", 2.7, Y0 + 2.15, -0.92, 2.82, Y0 + 2.27, 0.92, TRAVE, { under: true }); for (const s of [-1, 1]) box("wood", 2.82, Y0 + 2.15, s > 0 ? 0.8 : -0.92, IW, Y0 + 2.27, s > 0 ? 0.92 : -0.8, TRAVE, { under: true });
  hood(2.75, IW, 0.9, 0.5, Y0 + 2.27, DECK, -1);
  K.slab("stone", Y0 + 2.3, 2.82, -0.8, IW, 0.8, -1, { tint: FUMO });
  light(3.62, Y0 + 0.85, 0, 5.5, 0.6);
  I.seg(3.7, -0.4, 3.7, 0.4, 0.4, 0, 3);
  put(K, "scaffale", IW, Y0, 1.7, -PI / 2);

  // ── i tavoli, il candelabro a ruota ──
  for (const [x, z] of TABLES) put(K, "tavolo", x, Y0, z);
  candelaSu(-1, Y0 + 0.76, -2); light(-1, Y0 + 0.98, -2, 3.5, 0.4);
  for (const s of [-1, 1]) { candelaSu(s * 3.5, Y0 + 0.76, 3.3); light(s * 3.5, Y0 + 0.98, 3.3, 3.5, 0.4); }
  put(K, "candelabro", -0.5, Y0 + 2.25, 1.2);
  light(-0.5, Y0 + 2.5, 1.2, 6.5, 0.8);

  // ── primo piano: pavimento stanza per stanza, muri, tramezzi a graticcio, soffitto a travi ──
  const assi = (x0: number, z0: number, x1: number, z1: number, holes: number[][] = []): void => {
    K.slab("wood", Y1, x0, z0, x1, z1, 1, { tint: ASSITO }, holes, true); K.slab("wood", CEIL, x0, z0, x1, z1, -1, { tint: SCURO }, holes, true);
  };
  const canna = (m: number): number[] => (m < 0 ? [-IW, -0.5, -2.8, 0.5] : [2.8, -0.5, IW, 0.5]);
  assi(-IW, STAIR.z1, IW, -1.6); assi(-IW, -IW, STAIR.vano, STAIR.z1); assi(STAIR.x1, -IW, IW, STAIR.z1);
  K.slab("wood", CEIL, STAIR.vano, -IW, STAIR.x1, STAIR.z1, -1, { tint: SCURO }, [], true);
  ROOMS.forEach(([x0, x1, door], i) => { assi(x0, -1.3, x1, IW, i === 1 ? [] : [canna(i - 1)]); K.slab("wood", Y1, door - 0.6, -1.6, door + 0.6, -1.3, 1, { tint: ASSITO }, [], true); });
  K.panel("plaster", "z", -IW, -IW, IW, Y1, CEIL, 1, { tint: INTONACO });
  K.panel("plaster", "z", IW, -IW, IW, Y1, CEIL, -1, { tint: INTONACO }, [[-1.4, Y1, -1.1, CEIL], [1.1, Y1, 1.4, CEIL], ...[-1, 0, 1].map((s) => [s * 2.7 - 0.5, 4.2, s * 2.7 + 0.5, 6.1])]);
  for (const m of [-1, 1]) {
    K.panel("plaster", "x", m * IW, -IW, IW, Y1, CEIL, -m as 1 | -1, { tint: INTONACO }, [[-0.5, Y1, 0.5, CEIL], [-1.6, Y1, -1.3, CEIL]]);
    // la canna fumaria che attraversa la camera
    K.panel("stone", "x", m * 2.8, -0.5, 0.5, Y1, CEIL, -m as 1 | -1, { tint: MURO });
    for (const s of [-1, 1] as const) K.panel("stone", "z", s * 0.5, Math.min(m * 2.8, m * IW), Math.max(m * 2.8, m * IW), Y1, CEIL, s, { tint: MURO });
    I.seg(m * 3.3, 0, m * IW, 0, 0.5, Y1 - 0.1, 6.6);
  }
  const vani = ROOMS.map(([, , door]) => [door - 0.6, Y1, door + 0.6, Y1 + DOOR_H]);
  K.panel("plaster", "z", -1.6, -IW, IW, Y1, CEIL, -1, { tint: INTONACO }, vani);
  K.panel("plaster", "z", -1.3, -IW, IW, Y1, CEIL, 1, { tint: INTONACO }, [...vani, [-1.4, Y1, -1.1, CEIL], [1.1, Y1, 1.4, CEIL]]);
  for (const x of [-1.4, 1.1]) {
    K.panel("plaster", "x", x, -1.3, IW, Y1, CEIL, -1, { tint: INTONACO }); K.panel("plaster", "x", x + 0.3, -1.3, IW, Y1, CEIL, 1, { tint: INTONACO });
    for (const z of [0.6, 2.4]) box("wood", x - 0.02, Y1, z, x + 0.32, CEIL, z + 0.12, TRAVE);   // i montanti del graticcio
    I.seg(x + 0.15, -1.3, x + 0.15, IW, 0.15, Y1 - 0.1, 6.6);
  }
  const edges = [-IW, ...vani.flatMap((v) => [v[0], v[2]]), IW];
  for (let i = 0; i < edges.length; i += 2) I.seg(edges[i] + (i ? 0.15 : 0), -1.45, edges[i + 1] - (i < edges.length - 2 ? 0.15 : 0), -1.45, 0.15, Y1 - 0.1, 6.6);   // i pezzi di tramezzo fra una porta e l'altra
  for (const v of vani) {   // il telaio di ogni porta: due montanti e l'architrave, che fanno anche da spalletta
    for (const x of [v[0] - 0.1, v[2]]) box("wood", x, Y1, -1.62, x + 0.1, Y1 + DOOR_H, -1.28, TRAVE);
    box("wood", v[0] - 0.1, Y1 + DOOR_H, -1.62, v[2] + 0.1, Y1 + DOOR_H + 0.12, -1.28, TRAVE, { under: true });
  }
  for (const x of [-2.5, -1.25, 0, 1.25, 2.5]) box("wood", x - 0.1, BEAM1, -IW, x + 0.1, CEIL, IW, TRAVE, { open: true, under: true });
  for (const x of [-1.25, 0.85]) { candelaMuro(x, Y1 + 1.7, -1.6, -1); light(x, Y1 + 1.8, -1.8, 4, 0.45); }

  // ── le camere e il ripostiglio ──
  for (const [, , , , bed, , stool] of ROOMS) {
    put(K, "letto", bed, Y1, 3); put(K, "forziere", bed, Y1, 1.65); sgabello(stool, Y1, 3.75); candelaSu(stool, Y1 + 0.42, 3.75); light(stool, Y1 + 0.64, 3.75, 3.5, 0.4);
  }
  put(K, "scaffale", -3, Y1, -IW); put(K, "forziere", -3.82, Y1, -3.05, -PI / 2);

  // ── i muri che fermano il passo: perimetro a ogni quota, col vano del portone (i battenti li ferma Doors) ──
  I.seg(-4.3, -4.3, 4.3, -4.3, 0.2, -0.5, 7);
  for (const s of [-1, 1]) { I.seg(s * 4.3, -4.3, s * 4.3, 4.3, 0.2, -0.5, 7); I.seg(s * 4.3, 4.3, s * (pw / 2 + 0.2), 4.3, 0.2, -0.5, 7); }
  I.seg(-pw / 2 - 0.2, 4.3, pw / 2 + 0.2, 4.3, 0.2, 3.2, 7);   // sopra il portone: ferma solo chi sta al primo piano (chi salta sulla soglia batte la testa, vedi il soffitto qui sotto)

  // ── pavimenti: sala e soglia, primo piano in tre rettangoli (il quarto è il vano), rampa, e il piano chiuso di sopra che fa da soffitto ──
  floor(-IW, -IW, IW, IW, Y0); floor(-pw / 2 - 0.2, IW, pw / 2 + 0.2, 4.95, Y0);
  floor(-pw / 2 - 0.2, IW, pw / 2 + 0.2, 4.5, Y1, Y1 - 2.62);   // l'architrave del portone: un soffitto basso dentro lo spessore del muro
  floor(-IW, STAIR.z1, IW, IW, Y1, Y1 - BEAM); floor(-IW, -IW, STAIR.vano, STAIR.z1, Y1, Y1 - BEAM); floor(STAIR.x1, -IW, IW, STAIR.z1, Y1, Y1 - BEAM);
  floor(-IW, -IW, IW, IW, 6.75, 6.75 - BEAM1);
  // la rampa passa a metà di ogni gradino: comincia e finisce mezza alzata dentro i due pavimenti (sale verso +X)
  I.in(STAIR.x0, 0, (STAIR.z0 + STAIR.z1) / 2, PI / 2, () => K.floor(-(STAIR.z1 - STAIR.z0) / 2, 0, (STAIR.z1 - STAIR.z0) / 2, STAIR.x1 - STAIR.x0, (Y0 + Y1) / 2, undefined, Y1 - Y0 - alz));

  // ── le porte: battenti in mesh a parte ──
  K.doors.push({ y: TOWN.y + Y0, angle: PI / 2, leaves: [K.leaf("inn_portone_a", [0.95, Y0, zl - 0.065], [0, Y0, zl - 0.065], 2.6, 0.06, -1, true), K.leaf("inn_portone_b", [-0.95, Y0, zl - 0.065], [0, Y0, zl - 0.065], 2.6, 0.06, 1, true)] });
  ROOMS.forEach(([, , door, hinge], i) => K.doors.push({ y: TOWN.y + Y1, angle: PI / 2, leaves: [K.leaf(`inn_porta${i + 1}`, [hinge, Y1, -1.3], [hinge + (hinge > door ? -1.2 : 1.2), Y1, -1.3], DOOR_H, 0.05, hinge > door ? 1 : -1, false)] }));

  // ── il piano degli abitanti: nodi (con quota), percorsi, posti. Coordinate e versi come nella tavola. ──
  const spot = (name: string, p: number, x: number, z: number, deg: number, node = false): void => K.place(name, x, p < 0 ? 0 : p ? Y1 : Y0, z, deg, node);
  const P: [string, number, number, number, number][] = [   // nome, piano (−1 = in strada), x, z, verso
    ["porta.fuori", -1, 0, 5.45, 180], ["porta", 0, 0, 2.6, 180], ["sala", 0, -0.5, 1.2, 180], ["sala.fondo", 0, -2.5, -2.2, 180], ["scala", 0, -2.5, -3.5, 90],
    ["bancone", 0, 1.25, 0, 90], ["bancone.varco", 0, 2.9, 1.8, 180], ["cucina", 0, 2.85, 0, 90],
    ["scala.cima", 1, 3.45, -3.5, 0], ["pianerottolo", 1, 3.45, -2.25, 270], ["camera3.porta", 1, 2.1, -2.25, 0], ["corridoio", 1, 0.6, -2.3, 180],
    ["camera2.porta", 1, -0.4, -2.25, 0], ["camera1.porta", 1, -2.1, -2.25, 0], ["camera1", 1, -2.2, 2.3, 0], ["camera2", 1, -0.45, 2.3, 0], ["camera3", 1, 2.2, 2.3, 0],
  ];
  for (const [name, p, x, z, deg] of P) spot(name, p, x, z, deg, true);
  for (const [a, b] of [["porta.fuori", "porta"], ["porta", "sala"], ["sala", "sala.fondo"], ["sala.fondo", "scala"], ["scala", "scala.cima"], ["sala", "bancone"], ["sala", "bancone.varco"], ["bancone.varco", "cucina"],
    ["scala.cima", "pianerottolo"], ["pianerottolo", "camera3.porta"], ["camera3.porta", "corridoio"], ["corridoio", "camera2.porta"], ["camera2.porta", "camera1.porta"],
    ["camera1.porta", "camera1"], ["camera2.porta", "camera2"], ["camera3.porta", "camera3"]]) K.link(a, b);
  // i posti che non sono nodi: ci si arriva dritti dal nodo più vicino
  spot("focolare", 0, -2.35, 0, 270); spot("focolare.sgabello1", 0, -2.45, -1.05, 310); spot("focolare.sgabello2", 0, -2.45, 1.05, 230);
  spot("bancone.sgabello1", 0, 1.35, -2.3, 90); spot("bancone.sgabello2", 0, 1.35, -1.5, 90); spot("bancone.oste", 0, 2.75, -0.9, 270); spot("botti", 0, 2.8, -1.9, 90);
  TABLES.forEach(([x, z], i) => [-1, 1].forEach((b, j) => [-1, 1].forEach((a, k) => spot(`tavolo${i + 1}.${j * 2 + k + 1}`, 0, x + a * 0.45, z + b * 0.62, b < 0 ? 0 : 180))));
  spot("ripostiglio", 1, -2.9, -3.2, 180);
  ROOMS.forEach(([, , , , bed], i) => { spot(`camera${i + 1}.letto`, 1, bed, 3, 180); spot(`camera${i + 1}.forziere`, 1, bed, 1, 0); });
}

/** L'interno di un edificio: la locanda, o il modello del suo tipo con la pianta del suo seme. */
export function createInterior(scene: Scene, opt: InteriorOptions): Built {
  LUME = opt.lume;
  const K = new Kit(scene, opt.mason(), opt.id, opt.mason, opt.wood), zones: Box[] = [];
  K.I.in(TOWN.x, TOWN.y, TOWN.z, 0, () => K.I.in(opt.x, 0, opt.z, opt.yaw, () => {
    K.frame();
    if (opt.kind === "locanda") { K.I.cell = CELL; locanda(K); zones.push([-4.5, -4.5, 4.5, 4.5, 0, 6.6]); return; }
    const L = layout(opt.kind, opt.size[0], opt.size[1], mulberry32(opt.seed));
    K.I.cell = L.cell;
    build(K, L);
    for (const r of L.rooms) zones.push([r.x0, r.z0, r.x1, r.z1, r.y, r.y + r.h + (r.rise ?? 0)]);
  }));
  return K.finish(zones, { x: TOWN.x + opt.x, z: TOWN.z + opt.z }, Math.max(32, Math.hypot(opt.size[0], opt.size[1]) / 2 + 24));
}
