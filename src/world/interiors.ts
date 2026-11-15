import { embers, fire, flame, group } from "./flames";
import { Color3, Matrix, Mesh, Scene, TransformNode, Vector3, VertexBuffer, VertexData, type Material } from "@babylonjs/core";
import { by } from "../style";
import type { DoorDef } from "./doors";
import type { Geo } from "./geo";
import type { Floor } from "./levels";
import { interiorMaterial, onPainted } from "./materials";
import { TOWN } from "./terrain";
import { clothTex, dirtTex, leadedGlassTex, paintedTex, photoTex, type Painted } from "./textures";
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
  kind: InteriorKind;
  /** Ingombro dell'edificio (larghezza, profondità) e il seme della sua pianta. */
  size: [number, number]; seed: number;
  /** Quanto è ingrandito l'edificio (`children[].scale`): la pianta e le altezze lo seguono, gli arredi no. */
  scale: number;
  /** Un muratore nuovo (town.ts): qui se ne usa uno per l'interno e uno per ogni battente. */
  mason: () => Mason;
  /** Dove sta l'edificio nella città e come è girato; `y` = la quota del suo piano terra nel mondo (senza: il piano della città). */
  x: number; z: number; yaw: number; y?: number;
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
    for (const [n, t] of Object.entries(tex)) {
      const pair = t(scene), m = interiorMaterial(scene, `interno_${n}`, pair, LIGHT);
      MATS.set(n, m);
      // col cel shading: la texture dipinta al posto della foto (il colore, e l'altezza che scurisce le fughe: è un campionatore
      // che il materiale tiene da parte, `_newSamplerInstances`)
      if (["stone", "plaster", "wood", "brick", "flag"].includes(n)) onPainted((on) => {
        const p = on ? paintedTex(scene, n as Painted) : pair;
        m.diffuseTexture = p.albedo; (m as unknown as { _newSamplerInstances: Record<string, unknown> })._newSamplerInstances.sqHeight = p.normal;
      });
    }
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
  /** Il suo nome, e se ha finestre aperte sulla strada (allora si disegna anche da fuori, da vicino: `REACH`). */
  id: string; thru: boolean; told?: number;
  /** Dove chi cammina prende la luce di dentro, quando non sono le `zones` (vedi `Kit.finish`). */
  lit?: Box[];
  /** Dal riferimento dell'edificio al mondo (si calcola la prima volta che serve: `interiorLight`). */
  out?: Matrix;
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
/**
 * Da quanti metri (dal muro) si vede dentro dalle finestre: entro questa distanza l'interno sta nella scena anche a porta
 * chiusa. Più lontano la finestra torna un lume opaco (town.ts). 0 = da fuori mai; da dentro si vede fuori comunque.
 */
let REACH = 16;
export function setWindowReach(m: number): void { REACH = m; }
/** Chi vuole sapere quanto si vede dentro un interno, da 0 (lontano: non è in scena) a 1 (da vicino): town.ts ci sfuma i lumi opachi delle finestre. */
let SHOWN: (id: string, k: number) => void = () => {};
export function onInteriorShown(f: (id: string, k: number) => void): void { SHOWN = f; }
/** Gli usci sulla strada aperti in questo momento: di chi sono e dove (il cardine). */
export function openDoors(): { id: string; x: number; y: number; z: number }[] {
  return FRONT.list.filter((f) => f.open).map((f) => ({ id: f.id, x: f.pivot.position.x, y: f.pivot.position.y, z: f.pivot.position.z }));
}
/**
 * Le luci cotte che fanno ombra a chi sta in (x, y, z): i due fuochi (o candele) che lì danno più luce e la finestra che ne
 * dà di più, [x, y, z, portata] ciascuno nel mondo (zeri dove non c'è); vuoto all'aperto. Per `setShadeLights` (materials.ts).
 */
export function shadeLights(x: number, y: number, z: number): number[] {
  for (const s of SITES) {
    if (Math.hypot(x - s.x, z - s.z) > s.r) continue;
    const p = Vector3.TransformCoordinatesFromFloatsToRef(x, y + 1, z, s.inv, HERE);
    if (!(s.lit ?? s.zones).some((b) => p.x > b[0] - 0.2 && p.x < b[2] + 0.2 && p.z > b[1] - 0.2 && p.z < b[3] + 0.2 && p.y > b[4] && p.y < b[5] + 0.3)) continue;
    const w = (l: Light): number => { const d = Math.hypot(l.p[0] - p.x, l.p[1] - p.y, l.p[2] - p.z); return d < l.r ? l.f * (1 - d / l.r) ** 2 : 0; };
    const by = (win: boolean, n: number): Light[] => s.lights.filter((l) => !!l.n === win && w(l) > 0).sort((a, b) => w(b) - w(a)).slice(0, n);
    const fires = by(false, 2), out = new Array<number>(12).fill(0);
    s.out ??= Matrix.Invert(s.inv);
    [fires[0], fires[1], by(true, 1)[0]].forEach((l, i) => {
      if (!l) return;
      const q = Vector3.TransformCoordinatesFromFloatsToRef(l.p[0], l.p[1], l.p[2], s.out!, DIR);
      out[i * 4] = q.x; out[i * 4 + 1] = q.y; out[i * 4 + 2] = q.z; out[i * 4 + 3] = l.r;
    });
    return out;
  }
  return [];
}
/** Su quanti metri la finestra passa da lume opaco a vetro (avvicinandosi). */
const FADE = 7;
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
  /** Ha finestre aperte sulla strada. */
  thru = false;
  /** La quota del piano terra dell'edificio, nel mondo. */
  base = 0;

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
    // il battente vero (kit): tavole, traverse, bandelle coi chiodi e anello dalla parte verso cui si apre. Il pezzo apre
    // verso +X: per l'altro verso si gira di mezzo giro. Se dà sulla strada è un po' più sottile, così la faccia di fuori
    // (che è un'altra mesh, col legno della città) gli resta davanti.
    const fit: V3 = [(street ? 0.8 : 1) * thick / 0.05, height / 2.1, width], tints = { wood: PORTA, timber: TRAVE, iron: FERRATO };
    if (swing > 0) L.piece("anta", 0, 0, 0, { size: fit, as: "wood", tint: tints });
    else L.piece("anta", 0, 0, width, { size: fit, rot: [0, PI, 0], as: "wood", tint: tints });
    void far;
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
      FRONT.list.push({ pivot, shut: pivot.rotation.y, own: out, at, open: false, id: this.id });
      this.outside.push(out); this.gates.push(pivot);
    }
    return { x: w.x, z: w.z, yaw: this.yaw + turn, width, pivot, swing };
  }

  /** Le mesh: una per materiale, con la luce sui vertici; poi l'interno si iscrive fra quelli da accendere e spegnere. `zones` = le sue stanze. */
  /** `lit` = dove vale la luce di dentro, se non coincide con `zones` (il sottosuolo: la zona è larga, la camera no). */
  finish(zones: Box[], c: { x: number; z: number }, r: number, lit?: Box[]): Built {
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
    SITES.push({ shown: this.shown, minor, gates: this.gates.map((pivot) => ({ pivot, shut: pivot.rotation.y })), leaves, vis: true, small: true, inv: this.inv, zones, lights: this.lights, x: c.x, z: c.z, r, in: false, id: this.id, thru: this.thru, lit });
    watch(this.scene);
    return { interior: { id: this.id, meshes: [...this.shown, ...minor], x: c.x, z: c.z, r }, meshes: this.outside, colliders: this.I.colliders, floors: this.floors, doors: this.doors, nodes: this.nodes, links: this.links, spots: this.spots };
  }
}

/** Il lume delle fiamme (materiale della città, sempre acceso): lo dà chi costruisce il primo interno. */
let LUME: Material;

/** Le facce di fuori di tutti i battenti che danno sulla strada, da chiusi: vertici nel mondo, quattro per battente (`at` = il primo). */
const FRONT = { p: [] as number[], n: [] as number[], uv: [] as number[], c: [] as number[], idx: [] as number[], pos: new Float32Array(0), mesh: null as Mesh | null,
  list: [] as { pivot: TransformNode; shut: number; own: Mesh; at: number; open: boolean; id: string }[] };

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

// A uscio chiuso e da lontano, da fuori, dell'interno non si vede nulla (le finestre sono lumi opachi): le sue mesh non stanno nemmeno nella scena.
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
      // (dalle finestre: `r` è il raggio a cui si accende, 24 m più della mezza diagonale)
      const gap = s.r - 24 + REACH - Math.hypot(cam.globalPosition.x - s.x, cam.globalPosition.z - s.z), seen = near && s.thru && REACH > 0 && gap > 0;
      const on = WARMING || (near && (s.in || seen || s.gates.some((g) => Math.abs(g.pivot.rotation.y - g.shut) > 0.01))), small = WARMING || (on && (DETAIL > 1 || (DETAIL === 1 && s.in)));
      if (s.vis !== on) { s.vis = on; for (const m of s.shown) if (on) scene.addMesh(m); else scene.removeMesh(m); }
      // quanto si vede dentro: l'interno entra in scena col lume ancora opaco, poi avvicinandosi il lume sfuma (niente scatto)
      // (ha la sua memoria, a parte da `vis`: un interno nasce nella scena, e chi parte lì accanto non lo vedrebbe mai cambiare)
      const k = !on ? 0 : s.in ? 1 : seen ? Math.min(1, gap / FADE) : 1;
      if (s.told === undefined || Math.abs(k - s.told) > 0.03 || (k !== s.told && (k === 0 || k === 1))) { s.told = k; SHOWN(s.id, k); }
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
 * (senza ombre: serve a rischiarare chi ci cammina, vedi npcs.ts), o null se è all'aperto. In coda, DA DOVE viene:
 * il verso medio (nel mondo) verso i fuochi e quello verso le finestre, pesati per quanta luce danno. Con quelli chi sta
 * dentro ha un lato in luce e uno in ombra, e il volto prende rilievo. Il fuoco conta quanto è acceso (`metadata.warm`).
 */
const HERE = new Vector3(), DIR = new Vector3();
export function interiorLight(x: number, y: number, z: number): number[] | null {
  for (const s of SITES) {
    if (Math.hypot(x - s.x, z - s.z) > s.r) continue;
    const p = Vector3.TransformCoordinatesFromFloatsToRef(x, y + 1, z, s.inv, HERE);
    if (!(s.lit ?? s.zones).some((b) => p.x > b[0] - 0.2 && p.x < b[2] + 0.2 && p.z > b[1] - 0.2 && p.z < b[3] + 0.2 && p.y > b[4] && p.y < b[5] + 0.3)) continue;
    const out = [0, 0, 0, 0, 0, 0, 0, 0];
    for (const l of s.lights) {
      const vx = l.p[0] - p.x, vy = l.p[1] - p.y, vz = l.p[2] - p.z, d = Math.hypot(vx, vy, vz) || 1e-3;
      if (d >= l.r) continue;
      // (0,5: un corpo in piedi guarda la sorgente solo con mezzo sé)
      const w = l.f * (1 - d / l.r) ** 2 * 0.5 * (l.n ? Math.max(0, -(l.n[0] * vx + l.n[2] * vz) / d) ** 0.6 : 1) * 3 * LIGHT.gain, k = l.n ? 1 : 0;
      out[k] += w; out[2 + k * 3] += vx / d * w; out[3 + k * 3] += vy / d * w; out[4 + k * 3] += vz / d * w;
    }
    out[0] *= (s.shown[0]?.metadata?.warm as number | undefined) ?? 1;
    s.out ??= Matrix.Invert(s.inv);
    for (const k of [2, 5]) {   // i due versi, nel mondo e di lunghezza uno (o nulli se di lì non arriva niente)
      Vector3.TransformNormalFromFloatsToRef(out[k], out[k + 1], out[k + 2], s.out, DIR);
      const n = DIR.length();
      out[k] = n > 1e-4 ? DIR.x / n : 0; out[k + 1] = n > 1e-4 ? DIR.y / n : 0; out[k + 2] = n > 1e-4 ? DIR.z / n : 0;
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
const candela = (K: Kit): void => { K.I.piece("bugia", 0, 0, 0, { tint: { iron: FERRO, cloth: CERA } }); fiamma(K, 0, 0.155, 0, 0.017, 0.09); };
const boccale = (K: Kit): void => K.I.piece("boccale", 0, 0, 0, { tint: ASSITO });
const brocca = (K: Kit): void => K.I.piece("brocca", 0, 0, 0, { tint: TERRACOTTA });
/** Un mobile del kit nell'origine del pezzo: le tavole chiare, l'ossatura scura, il ferro; `timber` qui dentro è `wood`. */
const mobile = (K: Kit, name: Parameters<Mason["piece"]>[0], size?: V3, z = 0): void =>
  K.I.piece(name, 0, 0, z, { size, as: { timber: "wood" }, tint: { wood: LEGNO, timber: TRAVE, iron: FERRO } });
/** Una cosa del kit in un materiale solo (pietra, ferro, coccio, panno), con la sua tinta o una per blocco. */
const cosa = (K: Kit, name: Parameters<Mason["piece"]>[0], tint: Tint | Record<string, Tint>, size?: V3): void => K.I.piece(name, 0, 0, 0, { size, tint, as: { timber: "wood" } });
/** Una panca lungo x, col centro in (0, z). */
const panca = (K: Kit, z = 0): void => mobile(K, "panca", undefined, z);
/** Quattro gambe e i traversi di un tavolo o di un sedile. */
const gambe = (K: Kit, hx: number, hz: number, h: number, t = 0.06): void => {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) K.box("wood", sx * hx - t / 2, 0, sz * hz - t / 2, sx * hx + t / 2, h, sz * hz + t / 2, TRAVE);
};
/** Qualcosa posato su un ripiano (in un riferimento suo): è arredo minuto. */
const sopra = (K: Kit, x: number, y: number, z: number, f: (K: Kit) => void): void => K.minor(() => K.I.in(x, y, z, 0, () => f(K)));

const ARREDI: Record<PieceId, (K: Kit, v: number | undefined, p?: Piece) => void> = {
  // i mobili di legno sono pezzi del kit (tools/blender/kit.py): tavole smussate, gambe tornite, cavalletti, pomi
  // tavolo di assi su due cavalletti, con le due panche
  tavolo(K) { mobile(K, "tavolo"); K.shade(-0.9, 0.7, -0.4, 0.9, 0.76, 0.4); for (const s of [-1, 1]) panca(K, s * 0.62); },
  tavolino(K) { mobile(K, "tavolo", [0.5, 0.72 / 0.76, 0.875]); },
  tavolone(K) { mobile(K, "tavolo", [2, 0.78 / 0.76, 1.375]); K.shade(-1.8, 0.72, -0.55, 1.8, 0.78, 0.55); },
  panca: (K) => panca(K),
  sgabello(K) { mobile(K, "sgabello"); },
  // scranno: chi siede guarda +Z, lo schienale alto sta dietro
  scranno(K) { mobile(K, "scranno"); },
  // letto con la testa verso +Z
  letto(K) {
    mobile(K, "letto"); K.shade(-0.48, 0.25, -0.95, 0.48, 0.45, 0.95);
    K.box("cloth", -0.46, 0.3, -0.92, 0.46, 0.5, 0.92, PAGLIA);     // il pagliericcio
    K.box("cloth", -0.3, 0.5, 0.5, 0.3, 0.58, 0.88, BIANCO);        // il cuscino
    K.box("cloth", -0.47, 0.5, -0.93, 0.47, 0.535, 0.3, LANA);      // la coperta
  },
  // letto grande: quattro colonne e il cielo di panno; la testa verso +Z
  lettone(K) {
    mobile(K, "lettone"); K.shade(-0.78, 0.25, -1, 0.78, 0.45, 1);   // il telaio a colonne tornite (kit)
    for (const sx of [-1, 1]) K.box("cloth", sx * 0.78 - 0.015, 1.68, -1.05, sx * 0.78 + 0.015, 1.92, 1.05, VINO, { under: true });                                    // le falde del cielo
    for (const sz of [-1, 1]) K.box("cloth", -0.8, 1.68, sz * 1.03 - 0.015, 0.8, 1.92, sz * 1.03 + 0.015, VINO, { under: true });
    K.box("cloth", -0.8, 1.9, -1.05, 0.8, 1.93, 1.05, VINO, { under: true });
    K.box("cloth", -0.76, 0.3, -0.97, 0.76, 0.52, 0.97, LINO);
    for (const s of [-1, 1]) K.box("cloth", s * 0.38 - 0.28, 0.52, 0.55, s * 0.38 + 0.28, 0.6, 0.92, BIANCO);
    K.box("cloth", -0.77, 0.52, -0.98, 0.77, 0.56, 0.35, VINO);
  },
  // forziere col coperchio a falde; il davanti (la serratura) guarda −Z: nelle piante lo si gira di mezzo giro
  forziere(K) { mobile(K, "forziere"); },
  // botte in piedi
  botte(K) { mobile(K, "botte"); },
  sacco(K) { cosa(K, "sacco", LINO); },
  // banco di bottega: fronte chiuso di tavole verso +Z, dietro aperto con un ripiano
  banco(K) { mobile(K, "bancone"); K.shade(-0.85, 0.97, -0.3, 0.85, 1.05, 0.36); K.shade(-0.8, 0, 0.24, 0.8, 0.97, 0.3); },
  // scrittoio: chi scrive sta dalla parte di +Z, il piano scende verso di lui
  scrittoio(K) {
    mobile(K, "scrittoio");
    K.shade(-0.6, 0.58, -0.33, 0.6, 0.86, 0.33);
    K.minor(() => K.I.face("cloth", [[-0.3, 0.94, -0.15], [0.05, 0.94, -0.15], [0.05, 0.88, 0.15], [-0.3, 0.88, 0.15]], [0, 1, 0.2], { tint: BIANCO }));
  },
  leggio(K) {
    mobile(K, "leggio");
    K.minor(() => K.I.face("cloth", [[-0.2, 1.215, -0.13], [0.2, 1.215, -0.13], [0.2, 1.098, 0.13], [-0.2, 1.098, 0.13]], [0, 1, 0.4], { tint: BIANCO }));
  },
  fonte(K) {
    cosa(K, "fonte", PIETRA);
    K.I.drum("iron", 0, 0, 0.48, 0.965, 0.975, { tint: ACQUA }, 0.48, 16);
    K.shade(-0.4, 0.62, -0.4, 0.4, 1, 0.4);
  },
  // altare di pietra con la tovaglia e due ceri; dietro, sull'asta, il disco d'oro (quello della guglia)
  altare(K) {
    cosa(K, "altare", PIETRA); K.shade(-1.2, 0, -0.5, 1.2, 1.05, 0.5);
    K.box("cloth", -1.27, 0.86, -0.57, 1.27, 1.075, 0.57, BIANCO); K.box("cloth", -1.275, 0.9, -0.575, 1.275, 0.94, 0.575, VINO);
    K.box("iron", -0.02, 1.075, -0.36, 0.02, 1.85, -0.32, FERRO);
    for (const z of [-0.33, -0.35]) K.I.in(0, 0, z, 0, () => K.I.disc("cloth", 0, 2.12, 0.32, 0, { tint: ORO }, 16));
    for (const s of [-1, 1]) K.I.in(s * 0.92, 1.075, 0.1, 0, () => { K.I.drum("iron", 0, 0, 0.06, 0, 0.02, { tint: FERRO }, 0.06, 6); K.box("cloth", -0.025, 0.02, -0.025, 0.025, 0.25, 0.025, CERA); fiamma(K, 0, 0.255, 0, 0.02, 0.1); });
  },
  // banco di chiesa: chi siede guarda +Z
  "banco.chiesa"(K) {
    mobile(K, "bancochiesa"); K.shade(-0.85, 0.45, -0.2, 0.85, 0.9, -0.14);
  },
  // pilastro ottagono su un plinto, alto v
  pilastro(K, v = 3) {
    cosa(K, "plinto", PIETRA); K.I.drum("stone", 0, 0, 0.45, 0.5, v - 0.6, { tint: MURO }, 0.45, 8); K.I.piece("capitello", 0, v - 0.6, 0, { tint: PIETRA });   // base e capitello scolpiti (kit), il fusto lungo quanto serve
    K.shade(-0.38, 0.22, -0.38, 0.38, v, 0.38);
  },
  candeliere(K) {
    cosa(K, "candeliere", FERRATO);
    K.box("cloth", -0.03, 1.53, -0.03, 0.03, 1.75, 0.03, CERA); fiamma(K, 0, 1.755, 0, 0.022, 0.11);
  },
  braciere(K) {
    cosa(K, "braciere", FERRATO);
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
    mobile(K, "scaffale"); K.shade(-0.7, 0, 0, 0.7, 1.9, 0.4);
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
    K.I.piece("armadio", 0, 0, 0, { as: { timber: "wood" }, tint: { wood: LEGNO, timber: TRAVE, iron: FERRATO } }); K.shade(-0.6, 0, 0, 0.6, 1.9, 0.48);
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
        K.box("cloth", 0.2 * v + 0.025, 0.095, 0.52 * v + 0.025, 0.2 * v + 0.055, 0.21, 0.52 * v + 0.055, CERA); fiamma(K, 0.2 * v + 0.04, 0.215, 0.52 * v + 0.04, 0.014, 0.075);
      });
      K.I.piece("lumiera", 0, 0, 0, { size: [v, 1, v], as: { timber: "wood" }, tint: { timber: TRAVE, iron: FERRO } });   // il cerchio, la croce, i piattelli (kit)
      const top = v > 1 ? 5.2 : 1.17;
      for (let i = 0; i < 3; i++) { const a = i * 2.094; K.I.poly("iron", [[Math.cos(a) * 0.52 * v, 0.08, Math.sin(a) * 0.52 * v], [Math.cos(a + 0.05) * 0.52 * v, 0.08, Math.sin(a + 0.05) * 0.52 * v], [0.01, 0.8, 0.01], [0, 0.8, 0]], [-Math.sin(a), 0, Math.cos(a)], { tint: FERRATO }); }
      K.box("iron", -0.01, 0.8, -0.01, 0.01, top, 0.01, FERRATO);
    });
  },
  candela,
  // paiolo alla catena, sopra il fuoco
  paiolo(K) { cosa(K, "paiolo", FERRATO); K.box("iron", -0.008, 0.94, -0.008, 0.008, 1.6, 0.008, FERRO); },
  boccale, brocca,
  ciotola: (K) => cosa(K, "ciotola", ASSITO),
  cesta(K) { cosa(K, "cesta", PAGLIA); },
  secchio(K) { cosa(K, "secchio", { wood: LEGNO, iron: FERRO }); },
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

/**
 * Gli arredi che si possono usare (letti, forzieri, candele e candelieri): stanno fusi nelle mesh della stanza, quindi di
 * ognuno si tengono a parte i triangoli (nel mondo) e il centro. Servono a fargli il contorno quando si è a portata (outline.ts).
 */
export interface Prop { t: string; x: number; y: number; z: number; pos: number[]; nor: number[]; idx: number[] }
export const PROPS: Prop[] = [];
/** L'arredo usabile di quel genere più vicino a un punto, entro `r` metri. */
export function propNear(x: number, y: number, z: number, kind: RegExp, r: number): Prop | null {
  let best: Prop | null = null, bd = r;
  for (const p of PROPS) { const d = Math.hypot(p.x - x, p.y - y, p.z - z); if (d < bd && kind.test(p.t)) { bd = d; best = p; } }
  return best;
}

/** Posa un pezzo: lo mette nel suo riferimento (i minuti nelle mesh a parte) e, se il cantiere lo vuole, ne aggiunge l'ostacolo. */
function put(K: Kit, t: PieceId, x: number, y: number, z: number, turn = 0, v?: number, p?: Piece): void {
  const track = !K.plain && /letto|forziere|candel|lumiera|bugia/.test(t), before = new Map<string, [number, number]>();
  if (track) for (const [k, g] of K.I.geos) before.set(k, [g.p.length / 3, g.idx.length]);
  const d = PIECES[t] as { foot: Rect | number; h: number; minor?: boolean }, draw = (): void => K.I.in(x, y, z, turn, () => {
    ARREDI[t](K, v, p);
    if (!K.blocks || !d.h) return;
    const f = p?.foot ?? d.foot, r: Rect = typeof f === "number" ? [-f, -f, f, f] : f, h = t === "pilastro" || t === "canna" ? v ?? 3 : d.h;
    for (const s of caps(r[0], r[1], r[2], r[3], 0, h, typeof f === "number")) K.I.seg(s.ax, s.az, s.bx, s.bz, s.r, s.y0, s.y1);
  });
  if (d.minor) K.minor(draw); else draw();
  if (!track) return;
  const pr: Prop = { t, x: 0, y: 0, z: 0, pos: [], nor: [], idx: [] };
  for (const [k, g] of K.I.geos) {
    const [v0, i0] = before.get(k) ?? [0, 0], base = pr.pos.length / 3;
    for (let i = v0 * 3; i < g.p.length; i++) { pr.pos.push(g.p[i]); pr.nor.push(g.n[i]); }
    for (let i = i0; i < g.idx.length; i++) pr.idx.push(g.idx[i] - v0 + base);
  }
  const n = pr.pos.length / 3;
  if (!n) return;
  for (let i = 0; i < n; i++) { pr.x += pr.pos[i * 3] / n; pr.y += pr.pos[i * 3 + 1] / n; pr.z += pr.pos[i * 3 + 2] / n; }
  PROPS.push(pr);
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
const RAIL = 0.88;
/**
 * Il parapetto di una rampa che sale verso +Z, sul fianco a `x` (kit): un montante sul primo e sull'ultimo gradino, un
 * colonnino tornito su ogni gradino in mezzo, il corrimano dall'uno all'altro montante, poggiato sui colonnini.
 */
function stairRail(I: Mason, x: number, y0: number, alz: number, ped: number, n: number): void {
  const last = n - 2, at = (i: number): [number, number] => [y0 + (i + 1) * alz, (i + 0.5) * ped];
  for (const i of [0, last]) I.piece("montante", x, at(i)[0], at(i)[1], { tint: TRAVE, as: "wood" });
  for (let i = 1; i < last; i++) I.piece("colonnino", x, at(i)[0], at(i)[1], { size: [1, RAIL / 0.85, 1], tint: LEGNO, as: "wood" });
  const [ya, za] = at(0), [yb, zb] = at(last);
  I.piece("corrimano", x, ya + RAIL, za, { size: [1, 1, Math.hypot(zb - za, yb - ya)], rot: [-Math.atan2(yb - ya, zb - za), 0, 0], tint: TRAVE, as: "wood" });
}

/** Un parapetto in piano da (ax, az) a (bx, bz), a quota y (kit): montanti ai capi (e ogni due metri), colonnini ogni 16 cm, corrimano sopra. */
function levelRail(I: Mason, ax: number, az: number, bx: number, bz: number, y: number): void {
  const len = Math.hypot(bx - ax, bz - az), posts = Math.max(1, Math.round(len / 2));
  I.in(ax, y, az, Math.atan2(bx - ax, bz - az), () => {
    for (let i = 0; i <= posts; i++) I.piece("montante", 0, 0, len * i / posts, { tint: TRAVE, as: "wood" });
    for (let z = 0.16; z < len - 0.1; z += 0.16) if (Math.abs((z / (len / posts)) - Math.round(z / (len / posts))) * (len / posts) > 0.1) I.piece("colonnino", 0, 0, z, { size: [1, RAIL / 0.85, 1], tint: LEGNO, as: "wood" });
    I.piece("corrimano", 0, RAIL, 0, { size: [1, 1, len], tint: TRAVE, as: "wood" });
  });
}

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
        // una finestra aperta (`deep`) arriva fino al vetro della facciata, che è della città: di qui si vede la strada.
        // Le altre restano chiuse da vetri opachi, più dentro della finestra che si vede da fuori (lo controlla vetri.check.mjs)
        const see = o.deep !== undefined, d = see ? o.deep! : Math.min(0.24, t - 0.12);
        for (const s of [-1, 1]) I.poly(wk, [[s * hw, 0, 0], [s * hw, 0, d], [s * hw, h, d], [s * hw, h, 0]], [-s, 0, 0], { tint: wt });
        I.poly(wk, [[-hw, 0, 0], [hw, 0, 0], [hw, 0, d], [-hw, 0, d]], [0, 1, 0], { tint: wt }); I.poly(wk, [[-hw, h, 0], [hw, h, 0], [hw, h, d], [-hw, h, d]], [0, -1, 0], { tint: wt });
        if (o.arch) { if (!see) I.arch("glass", 0, 0, o.w, h, d); arcata(d - 0.005, 0, h, h, -1); } else if (!see) I.poly("glass", [[-hw, 0, d], [hw, 0, d], [hw, h, d], [-hw, h, d]], [0, 0, -1]);
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
        K.doors.push({ y: K.base + r.y, angle: PI / 2, leaves: two ? [K.leaf(`${name}_a`, [jw, 0, z], [0, 0, z], hy, 0.06, -1, true), K.leaf(`${name}_b`, [-jw, 0, z], [0, 0, z], hy, 0.06, 1, true)]
          : [K.leaf(name, [side * jw, 0, z], [-side * hw, 0, z], hy, 0.06, -side as 1 | -1, true)] });
        return;
      }
      // una porta fra due stanze: il telaio (due montanti e l'architrave, che fanno anche da spalletta) e l'anta, che si apre nell'altra stanza
      for (const s of [-1, 1]) K.box("wood", Math.min(s * hw, s * (hw + 0.1)), 0, -0.02, Math.max(s * hw, s * (hw + 0.1)), h, t + 0.02, TRAVE);
      K.box("wood", -hw - 0.1, h, -0.02, hw + 0.1, h + 0.12, t + 0.02, TRAVE, { under: true });
      K.doors.push({ y: K.base + r.y + o.y0, angle: PI / 2, leaves: [K.leaf(name, [hw, 0, t], [-hw, 0, t], h, 0.05, 1, false)] });
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
        I.piece("gradino", 0, top, z, { size: [2 * hw, 1, ped / 0.3], tint: ASSITO, as: "wood" });   // la pedata vera, col naso che sporge (kit)
        for (const q of open) I.poly("wood", [[q * hw, s.under ? s.y0 : top - alz - 0.2, z], [q * hw, s.under ? s.y0 : top - 0.2, z + ped], [q * hw, top, z + ped], [q * hw, top, z]], [q, 0, 0], { tint: ASSITO });
        if (i % 2 === 0) K.shade(-hw, s.under ? s.y0 : top - 0.25, z, hw, top + alz, z + 2 * ped);
      }
      if (s.under) I.poly("wood", [[-hw, s.y0, run], [hw, s.y0, run], [hw, s.y1 - 0.12, run], [-hw, s.y1 - 0.12, run]], [0, 0, 1], { tint: ASSITO });
      else I.poly("wood", [[-hw, s.y0 - 0.2, 0], [hw, s.y0 - 0.2, 0], [hw, s.y1 - alz - 0.2, run], [-hw, s.y1 - alz - 0.2, run]], [0, -1, 0], { tint: SCURO });
      // corrimano sui fianchi aperti; attorno al vano, di sopra, il parapetto
      for (const q of open) {
        const x = q * (hw - 0.04);
        // il parapetto vero (kit): un montante sul primo e sull'ultimo gradino, un colonnino tornito su ogni gradino in
        // mezzo, e il corrimano che corre dall'uno all'altro montante poggiando sui colonnini — niente più tavole per aria
        stairRail(I, x, s.y0, alz, ped, s.n);
        if (cut > 0) levelRail(I, x, cut, x, run, s.y1);
      }
      if (cut > 0) levelRail(I, -hw + 0.04, cut - 0.04, hw - 0.04, cut - 0.04, s.y1);
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
    levelRail(I, c.ax, c.az, c.bx, c.bz, c.y0 + 0.25);
  }

  furnishAll(K, L);
  for (const l of lamps(L)) K.light(l.x, l.y, l.z, l.r, l.f, l.n && [l.n[0], 0, l.n[1]]);
  for (const c of [...walls(L), ...solids(L)]) I.seg(c.ax, c.az, c.bx, c.bz, c.r, c.y0, c.y1);
  for (const p of L.places) K.place(p.name, p.x, p.y, p.z, p.deg, p.node);
  for (const [a, b] of L.links) K.link(a, b);
}

/** L'interno di un edificio: la locanda, o il modello del suo tipo con la pianta del suo seme. */
export function createInterior(scene: Scene, opt: InteriorOptions): Built {
  LUME = opt.lume;
  const K = new Kit(scene, opt.mason(), opt.id, opt.mason, opt.wood), zones: Box[] = [];
  // (le fiamme di dentro sono del gruppo dell'edificio: si accendono e si spengono con chi c'è)
  K.base = opt.y ?? TOWN.y;
  group(opt.id, () => K.I.in(TOWN.x, K.base, TOWN.z, 0, () => K.I.in(opt.x, 0, opt.z, opt.yaw, () => {
    K.frame();
    const L = layout(opt.kind, opt.size[0], opt.size[1], mulberry32(opt.seed), opt.scale);
    K.thru = L.openings.some((o) => o.deep !== undefined);
    K.I.cell = L.cell;
    build(K, L);
    for (const r of L.rooms) zones.push([r.x0, r.z0, r.x1, r.z1, r.y, r.y + r.h + (r.rise ?? 0)]);
  })));
  return K.finish(zones, { x: TOWN.x + opt.x, z: TOWN.z + opt.z }, Math.max(32, Math.hypot(opt.size[0], opt.size[1]) * opt.scale / 2 + 24));
}
