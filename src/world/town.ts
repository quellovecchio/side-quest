import { CustomMaterial } from "@babylonjs/materials";
import { BaseTexture, Color3, type DirectionalLight, type Engine, Matrix, Mesh, RawTexture, Scene, StandardMaterial, Vector3, VertexBuffer, type Material } from "@babylonjs/core";
import { Geo } from "./geo";
import { embers, fire, flame, group, markFlames, smoke } from "./flames";
import { markProps, prop, propOwner, takeProps, type Want } from "./props";
import { piece as kitPiece, type PieceId } from "./kit";
import { addFlutter, bakeLamps, onPainted, setMossGround, surfaceMaterial } from "./materials";
import { mulberry32 } from "./noise";
import { LIP, entry, layout, seedOf } from "./layouts";
import { reliefGrid, TOWN, townGround } from "./terrain";
import { brickFloorTex, clothTex, masonryTex, paintedTex, photoTex, type Painted } from "./textures";
import type { DoorDef } from "./doors";
import { createInterior, doorFronts, furnish, onInteriorShown, openDoors, type Built } from "./interiors";
import { clearWay, type Floor } from "./levels";
import type { Collider } from "./vegetation";
import type { ChildDef, InteriorId, LocationDef, PrefabId, SpotDef } from "../data/db";

// ─────────────────────────────────────────────────────────────────────────────
// CITTÀ — una piccola città murata sul piano a est della conca, costruita dalle tavole in
// docs/reference/citta: porta a ovest, via maestra lastricata fino alla piazza con la fontana,
// cattedrale in fondo (la torre sud mai finita), municipio a nord, mercato a sud, case a
// graticcio lungo le vie e case povere negli angoli, lampioni a olio accesi.
//
// È tutta geometria fatta a mano da un "muratore" (`Mason`): scatole, falde, sagome a sesto acuto,
// tamburi. Ogni pezzo finisce nella Geo del suo materiale: alla fine c'è UNA mesh per materiale
// (una dozzina di draw call per tutta la città). Le coordinate sono locali alla città (centro in
// TOWN, +x est, +z nord) e ogni edificio ha il suo riferimento, con la facciata rivolta a +Z.
// Gli ostacoli sono cerchi lungo i perimetri; dove si entra, segmenti con una fascia d'altezza.
//
// COSA c'è e DOVE lo dice db.json (l'insediamento in `locations`): selciati, tracciati degli abitanti, posti con
// un nome e la lista delle cose posate (`children`), ognuna con la chiave del suo generatore (`PREFABS` in
// `createTown`). Mura, torri d'angolo e porta discendono dal rettangolo dell'insediamento.
// ponytail: i generatori restano qui, in una tabella, e non dichiarano ancora ingombro e posti propri (i posti
// stanno nel file, accanto all'insediamento); un prefabs.ts a parte quando gli interni (fase 5) li faranno crescere.
//
// Dove il file dice che si entra (`interior`), qui si fa solo il guscio: muri senza i coperchi che taglierebbero le
// stanze, il vano dell'uscio nella facciata; l'interno, i suoi ostacoli, le porte e i posti degli abitanti li fa
// interiors.ts dalle piante di layouts.ts. Un edificio senza `interior` resta una scatola piena col perimetro a cerchi.
// ⚠️ Le facce del guscio non devono stare sullo stesso piano di una parete dell'interno (sfarfallano): l'interno sta
// sempre più dentro dello spessore di un muro, e dove due volumi si toccano (navata e abside) la faccia in comune non si disegna.
// ─────────────────────────────────────────────────────────────────────────────

/** Dove gli abitanti camminano e si fermano: nodi delle strade, collegamenti, posti con un nome. */
export interface TownPlan {
  /** [x, z, quota]: la quota serve dentro gli edifici (piani, scale); all'aperto si omette e vale il terreno. */
  nodes: [number, number, number?][];
  links: [number, number][];
  spots: Record<string, { x: number; z: number; yaw: number; y?: number }>;
}

/** Un interno: le sue mesh si accendono solo quando chi guarda è entro `r` metri da (x, z). */
export interface Interior { id: string; meshes: Mesh[]; x: number; z: number; r: number }

export interface Town {
  meshes: Mesh[]; colliders: Collider[]; plan: TownPlan;
  /** Pavimenti, solai e rampe degli edifici in cui si entra; le loro porte; i loro interni. */
  floors: Floor[]; doors: DoorDef[]; interiors: Interior[];
  /** I lumi che seguono l'ora: le finestre accese e i vetri delle lanterne (main.ts ne regola l'emissivo). Le fiamme sono un terzo materiale, sempre acceso. */
  lumi: { finestre: StandardMaterial; lanterne: StandardMaterial };
  /**
   * Accende o spegne le finestre delle case: `level(id)` da 0 (buie) a 1 (accese come vuole l'ora) per ogni casa del file
   * (`children[].id`). Le finestre di cattedrale e municipio non sono di nessuno: seguono solo l'ora.
   */
  windows(level: (id: string) => number): void;
  /** Le lanterne che si accendono e si spengono: i lampioni (`lampione.N`, `lampione.porta`) e quelle degli edifici (col loro nome). */
  lamps: { id: string; x: number; z: number }[];
  /** Accende o spegne le lanterne con quel nome: il vetro e la pozza di luce cotta sulla strada (la fiammella la spegne chi chiama: flames.ts). */
  light(id: string, on: boolean): void;
  /** Solo in modalità editor (`createTown(..., { editor: true })`): le mesh di ogni elemento del file, nell'ordine, e chi costruisce un oggetto teso a parte. */
  editor?: {
    parts: Mesh[][]; span(c: ChildDef): Mesh[]; replan(walks: [number, number][][], spots: Record<string, SpotDef>): TownPlan;
    /** Un elemento costruito da solo (`i` = il suo posto nell'elenco, per le copie da modello), e i selciati rifatti; le mesh dei selciati di partenza. */
    build(c: ChildDef, i: number): { meshes: Mesh[]; props: Want[] }; paving(list: LocationDef["paving"]): Mesh[]; pavingMeshes: Mesh[];
  };
}

export type V3 = [number, number, number];
export type Tint = [number, number, number];
/** `under` disegna anche il fondo di una scatola, `open` ne toglie il coperchio. */
export interface Opt { uv?: number; tint?: Tint; rot?: V3; under?: boolean; open?: boolean; /** Niente faccia a +Z: la fa `wall`, con i vani. */ noFront?: boolean; /** Niente fianchi né retro: li fa `wall`. */ noSides?: boolean; /** Stoffa: quanto si muove al vento ogni vertice (0 = fermo … 1), dalla sua posizione locale. */ wave?: (p: V3) => number }

/** I materiali che non si separano mai dal resto (chi li usa conta i loro vertici nella mesh comune: lumi, lanterne; o si muovono: stoffa). */
const UNTAGGED = new Set(["lume", "lamp", "fire", "glass", "vetro", "dark", "cloth"]);
/**
 * L'arredo di strada: piccolo e basso, nella mappa d'ombre del sole (14 cm per pixel su tutto il mondo, coi bordi sfumati)
 * la sua ombra quasi sparisce. Sta quindi in mesh a parte (chiave `<materiale>+`), che main.ts mette anche nella mappa
 * piccola e nitida attorno a chi gioca (`setLiveShadow`): lì fontana, lampioni, banchi e carretti fanno un'ombra vera.
 */
const FURNITURE = new Set(["pozzo", "fontana", "banco", "panchina", "panca.pietra", "lampione", "botte", "cassa", "carretto", "bacheca", "lapidi"]);
/** Metri per ripetizione della texture di ogni materiale. */
const UV: Record<string, number> = { stone: 2.6, plaster: 3, timber: 1.2, wood: 1.2, slate: 2.4, tile: 2.4, thatch: 3, iron: 0.5, cloth: 0.33, flag: 3, sett: 1.6, cobble: 1.6, brick: 0.88, glass: 0.6, vetro: 0.6, earth: 2 };
const PI = Math.PI;
// tinte (lineari) per pietra in ombra, porte, stoffe
const DARK: Tint = [0.62, 0.62, 0.62], DOOR: Tint = [0.55, 0.45, 0.38];
const VINO: Tint = [0.2, 0.05, 0.065], ORO: Tint = [0.55, 0.36, 0.08], LINO: Tint = [0.5, 0.45, 0.33], OCRA: Tint = [0.36, 0.23, 0.06], MUSCHIO: Tint = [0.1, 0.13, 0.05], RUGGINE: Tint = [0.24, 0.08, 0.04], BIANCO: Tint = [0.6, 0.55, 0.43];

export class Mason {
  readonly geos = new Map<string, Geo>();
  readonly colliders: Collider[] = [];
  /** Lato massimo di un quadrilatero: quelli più grandi si suddividono (negli interni la luce sta sui vertici). 0 = mai. */
  cell = 0;
  /** Si aggiunge al nome del materiale: ciò che si costruisce finisce in una Geo a parte (gli arredi minuti degli interni). */
  tag = "";
  /** La chiave della mesh in cui finisce un materiale: col suo `tag`, tranne lumi, vetri e stoffe quando il tag è "+" (l'arredo di strada: vedi `createTown`). */
  private key(k: string): string { return k + (this.tag === "+" && UNTAGGED.has(k) ? "" : this.tag); }
  /** Il materiale di una chiave di mesh (senza il segno dell'arredo, `+`, o dell'elemento, `#n`). */
  static material(key: string): string { return key.split(/[+#]/)[0]; }
  private stack: Matrix[] = [Matrix.Identity()];
  private ks: number[] = [1];
  private get m(): Matrix { return this.stack[this.stack.length - 1]; }
  /** Quanto è ingrandito il riferimento corrente: le uv e i raggi degli ostacoli ne tengono conto (la texture non si stira). */
  get k(): number { return this.ks[this.ks.length - 1]; }

  /**
   * Esegue `f` in un riferimento locale: spostato, girato attorno a y, appena fuori piombo (`lean`), ingrandito di `k`
   * (tutto, altezze comprese: un edificio scritto alla sua misura di disegno viene su una volta e mezzo).
   */
  in(x: number, y: number, z: number, yaw: number, f: () => void, lean = 0, k = 1): void {
    this.stack.push(Matrix.Scaling(k, k, k).multiply(Matrix.RotationYawPitchRoll(yaw, 0, lean)).multiply(Matrix.Translation(x, y, z)).multiply(this.m));
    this.ks.push(this.k * k);
    f();
    this.stack.pop(); this.ks.pop();
  }

  /** Un punto del riferimento corrente, nel mondo. */
  world(x: number, y: number, z: number): Vector3 { return Vector3.TransformCoordinates(new Vector3(x, y, z), this.m); }
  /** Lo yaw del riferimento corrente nel mondo, e la matrice che dal mondo riporta al riferimento. */
  get yaw(): number { return Math.atan2(this.m.m[8], this.m.m[10]); }
  get inverse(): Matrix { return Matrix.Invert(this.m); }

  /** Poligono convesso con la sua normale. Le uv sono le coordinate locali (di `src`) lungo i due assi più vicini al piano. */
  poly(k: string, pts: V3[], n: V3, o: Opt = {}, src: V3[] = pts): void {
    const g = this.geos.get(this.key(k)) ?? new Geo();
    this.geos.set(this.key(k), g);
    const s = (o.uv ?? UV[k] ?? 1) / this.k, ax = Math.abs(n[1]) > 0.7 ? [0, 2] : Math.abs(n[0]) > Math.abs(n[2]) ? [2, 1] : [0, 1];
    const N = Vector3.TransformNormal(new Vector3(n[0], n[1], n[2]), this.m).normalize();
    const put = (p: V3, q: V3): number => {
      const id = g.vert(Vector3.TransformCoordinates(new Vector3(p[0], p[1], p[2]), this.m), N, q[ax[0]] / s, q[ax[1]] / s, 1, o.tint);
      if (o.wave) g.c[id * 4 + 3] = 1 - Math.max(0, Math.min(1, o.wave(p)));   // (il peso sta nell'alfa: vedi addFlutter)
      return id;
    };
    if (this.cell && pts.length === 4) {   // una griglia al posto del quadrilatero
      const len = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const nu = Math.max(1, Math.ceil(Math.max(len(pts[0], pts[1]), len(pts[3], pts[2])) / this.cell)), nv = Math.max(1, Math.ceil(Math.max(len(pts[0], pts[3]), len(pts[1], pts[2])) / this.cell));
      const mix = (a: V3[], u: number, v: number): V3 => [0, 1, 2].map((i) => (a[0][i] * (1 - u) + a[1][i] * u) * (1 - v) + (a[3][i] * (1 - u) + a[2][i] * u) * v) as V3;
      const ids: number[] = [];
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) ids.push(put(mix(pts, i / nu, j / nv), mix(src, i / nu, j / nv)));
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i; g.tri(ids[a], ids[a + 1], ids[a + nu + 2]); g.tri(ids[a], ids[a + nu + 2], ids[a + nu + 1]); }
      return;
    }
    const ids = pts.map((p, i) => put(p, src[i]));
    for (let i = 1; i < pts.length - 1; i++) g.tri(ids[0], ids[i], ids[i + 1]);
  }

  /**
   * Un pezzo del kit (kit.ts) posato in (x, y, z): allungato di `size` lungo i suoi assi, girato di `rot` [attorno a x, a y,
   * a z], tinto. Le uv si calcolano dalle sue misure vere, faccia per faccia (come per i poligoni), così allungarlo non
   * stira la texture; l'occlusione cotta in Blender scurisce i vertici.
   */
  piece(name: PieceId, x: number, y: number, z: number, o: { size?: V3; rot?: V3; /** Una tinta per tutto il pezzo, o una per blocco (col nome del suo materiale nel kit). */ tint?: Tint | Record<string, Tint>; /** Tutto il pezzo in questo materiale, o un materiale per blocco (negli interni non c'è "timber"). */ as?: string | Record<string, string> } = {}): void {
    const [sx, sy, sz] = o.size ?? [1, 1, 1], R = o.rot ? Matrix.RotationYawPitchRoll(o.rot[1], o.rot[0], o.rot[2]) : Matrix.Identity();
    const T = R.multiply(Matrix.Translation(x, y, z)).multiply(this.m), P = new Vector3(), N = new Vector3();
    for (const [own, b] of Object.entries(kitPiece(name))) {
      const k = (typeof o.as === "string" ? o.as : o.as?.[own]) ?? own, g = this.geos.get(this.key(k)) ?? new Geo(), s = (UV[k] ?? 1) / this.k, ids: number[] = [], tint = Array.isArray(o.tint) ? o.tint : o.tint?.[own];
      this.geos.set(this.key(k), g);
      for (let v = 0; v < b.p.length; v += 3) {
        const px = b.p[v] * sx, py = b.p[v + 1] * sy, pz = b.p[v + 2] * sz, nx = b.n[v] / sx, ny = b.n[v + 1] / sy, nz = b.n[v + 2] / sz;
        const ax = Math.abs(ny) > Math.max(Math.abs(nx), Math.abs(nz)) ? [px, pz] : Math.abs(nx) > Math.abs(nz) ? [pz, py] : [px, py];
        Vector3.TransformCoordinatesFromFloatsToRef(px, py, pz, T, P); Vector3.TransformNormalFromFloatsToRef(nx, ny, nz, T, N);
        ids.push(g.vert(P.clone(), N.normalize().clone(), ax[0] / s, ax[1] / s, 0.35 + 0.65 * b.c[v / 3], tint));
      }
      for (let t = 0; t < b.i.length; t += 3) g.tri(ids[b.i[t]], ids[b.i[t + 1]], ids[b.i[t + 2]]);
    }
  }

  /** Quadrilatero o triangolo: la normale si calcola e si gira dalla parte di `hint`. */
  face(k: string, pts: V3[], hint: V3, o: Opt = {}): void {
    const [a, b, c] = pts, u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n: V3 = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(n[0], n[1], n[2]) || 1;
    const sg = (n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0 ? -1 : 1) / l;
    this.poly(k, pts, [n[0] * sg, n[1] * sg, n[2] * sg], o);
  }

  /** Scatola fra due angoli (il fondo non si disegna, salvo `under`); `rot` la ruota attorno al suo centro. */
  box(k: string, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, o: Opt = {}): void {
    const c: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h: V3 = [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2];
    const R = o.rot ? Matrix.RotationYawPitchRoll(o.rot[1], o.rot[0], o.rot[2]) : null;
    const tr = (q: V3, pos: boolean): V3 => {
      const v = R ? Vector3.TransformNormal(new Vector3(q[0], q[1], q[2]), R) : new Vector3(q[0], q[1], q[2]);
      return pos ? [c[0] + v.x, c[1] + v.y, c[2] + v.z] : [v.x, v.y, v.z];
    };
    for (let ax = 0; ax < 3; ax++) for (const sg of [-1, 1]) {
      if (ax === 1 && (sg < 0 ? !o.under : o.open) || ax === 2 && sg > 0 && o.noFront || o.noSides && (ax === 0 || ax === 2 && sg < 0)) continue;
      const u = (ax + 1) % 3, w = (ax + 2) % 3, n: V3 = [0, 0, 0];
      n[ax] = sg;
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sw]) => { const p: V3 = [0, 0, 0]; p[ax] = sg * h[ax]; p[u] = su * h[u]; p[w] = sw * h[w]; return p; });
      this.poly(k, q.map((p) => tr(p, true)), tr(n, false), o, q.map((p) => [c[0] + p[0], c[1] + p[1], c[2] + p[2]] as V3));
    }
  }

  /**
   * Parete sul piano z = 0 rivolta a +Z, fra (x0, y0) e (x1, y1), con i vani VERI: rettangoli [x0, y0, x1, y1] in ordine
   * di x e senza sovrapporsi, profondi `depth`. La faccia va a pezzi attorno ai vani, ogni vano ha le sue quattro spallette.
   * Un quinto numero diverso da zero fa il vano a sesto acuto (la sagoma di `arch`, dentro quel rettangolo).
   */
  wall(k: string, x0: number, y0: number, x1: number, y1: number, holes: number[][], depth: number, o: Opt = {}): void {
    const q = (a: number, b: number, c: number, d: number): void => this.poly(k, [[a, b, 0], [c, b, 0], [c, d, 0], [a, d, 0]], [0, 0, 1], o);
    let x = x0;
    for (const [a, b, c, d, arched] of holes) {
      q(x, y0, a, y1); q(a, y0, c, b); q(a, d, c, y1); x = c;
      const top = arched ? d - (c - a) * 0.75 : d;   // dove finiscono le spallette dritte
      for (const [px, n] of [[a, 1], [c, -1]]) this.poly(k, [[px, b, 0], [px, b, -depth], [px, top, -depth], [px, top, 0]], [n, 0, 0], o);
      this.poly(k, [[a, b, 0], [c, b, 0], [c, b, -depth], [a, b, -depth]], [0, 1, 0], o);
      if (!arched) { this.poly(k, [[a, d, 0], [c, d, 0], [c, d, -depth], [a, d, -depth]], [0, -1, 0], o); continue; }
      for (const g of [-1, 1]) for (let i = 0; i < 5; i++) {   // i pennacchi fra il rettangolo e l'arco, e l'intradosso
        const A = this.archSide((a + c) / 2, b, c - a, d - b, 0, g, i / 5), B = this.archSide((a + c) / 2, b, c - a, d - b, 0, g, (i + 1) / 5);
        this.poly(k, [A, B, [B[0], d, 0], [A[0], d, 0]], [0, 0, 1], o);
        this.face(k, [A, B, [B[0], B[1], -depth], [A[0], A[1], -depth]], [-g, -1, 0], o);
      }
    }
    q(x, y0, x1, y1);
  }

  /** Sagoma a sesto acuto sul piano z, rivolta a +Z: porte, finestre, fornici. */
  arch(k: string, cx: number, y0: number, w: number, h: number, z: number, o: Opt = {}): void {
    const pts: V3[] = [[cx - w / 2, y0, z], [cx + w / 2, y0, z]];
    for (let i = 0; i < 5; i++) pts.push(this.archSide(cx, y0, w, h, z, 1, i / 5));
    for (let i = 5; i >= 0; i--) pts.push(this.archSide(cx, y0, w, h, z, -1, i / 5));
    this.poly(k, pts, [0, 0, 1], o);
  }

  /** Un punto del fianco di una sagoma a sesto acuto (g = ±1 il lato, t = 0 all'imposta, 1 in chiave). */
  archSide(cx: number, y0: number, w: number, h: number, z: number, g: number, t: number): V3 {
    return [cx + g * (w / 2) * (1 - t * t), (y0 + h - w * 0.75) * (1 - t) * (1 - t) + (y0 + h - w * 0.15) * 2 * t * (1 - t) + (y0 + h) * t * t, z];
  }

  /** Disco sul piano z (rosone, orologio, stemmi). */
  disc(k: string, cx: number, cy: number, r: number, z: number, o: Opt = {}, sides = 14): void {
    this.poly(k, Array.from({ length: sides }, (_, i): V3 => [cx + Math.cos(i / sides * 2 * PI) * r, cy + Math.sin(i / sides * 2 * PI) * r, z]), [0, 0, 1], o);
  }

  /** Tamburo (o tronco di cono) verticale col coperchio: pozzi, vasche, botti, colonne. */
  drum(k: string, cx: number, cz: number, r0: number, y0: number, y1: number, o: Opt = {}, r1 = r0, sides = 10): void {
    const at = (i: number, r: number, y: number): V3 => [cx + Math.cos(i / sides * 2 * PI) * r, y, cz + Math.sin(i / sides * 2 * PI) * r];
    for (let i = 0; i < sides; i++) this.face(k, [at(i, r0, y0), at(i + 1, r0, y0), at(i + 1, r1, y1), at(i, r1, y1)], [Math.cos((i + 0.5) / sides * 2 * PI), 0, Math.sin((i + 0.5) / sides * 2 * PI)], o);
    this.poly(k, Array.from({ length: sides }, (_, i) => at(i, r1, y1)), [0, 1, 0], o);
  }

  /** Tetto a due falde col colmo lungo z: gronde a ±hw (sporgono di `ov`), da y0 a y0 + rise. */
  roof(k: string, hw: number, z0: number, z1: number, y0: number, rise: number, ov = 0.45): void {
    const dy = ov * rise / hw, ex = hw + ov, ey = y0 - dy, top = y0 + rise;
    for (const s of [-1, 1]) this.face(k, [[s * ex, ey, z0 - ov], [s * ex, ey, z1 + ov], [0, top, z1 + ov], [0, top, z0 - ov]], [s, 1, 0]);
    if (hw < 1) return;   // (i tettucci di pozzi e bacheche restano un foglio)
    // lo spessore: il manto ha un bordo (di paglia è un cuscino, di tegole un filo) e sotto lo regge una tavola; in testata
    // le tavole di chiusura seguono la falda; in cima il colmo
    const t = k === "thatch" ? 0.3 : 0.09, edge = k === "thatch" ? k : "timber", cap = k === "thatch" ? 0.2 : 0.12;
    for (const s of [-1, 1]) {
      this.face(k, [[s * ex, ey, z0 - ov], [s * ex, ey, z1 + ov], [s * ex, ey - t, z1 + ov], [s * ex, ey - t, z0 - ov]], [s, 0, 0]);                                   // la gronda
      this.face(edge, [[s * ex, ey - t, z0 - ov], [s * ex, ey - t, z1 + ov], [s * (ex - 0.5), ey - t + 0.5 * rise / hw, z1 + ov], [s * (ex - 0.5), ey - t + 0.5 * rise / hw, z0 - ov]], [0, -1, 0], { tint: [0.5, 0.42, 0.36] });   // il sotto della gronda
      for (const z of [z0 - ov, z1 + ov]) this.face(edge, [[s * ex, ey, z], [0, top, z], [0, top - t * 1.6, z], [s * ex, ey - t, z]], [0, 0, z < (z0 + z1) / 2 ? -1 : 1], { tint: k === "thatch" ? undefined : [0.5, 0.42, 0.36] });   // la testata
    }
    this.box(k, -cap, top - cap * 0.5, z0 - ov - 0.03, cap, top + cap * 0.6, z1 + ov + 0.03, { tint: [0.72, 0.72, 0.72] });                                      // il colmo
  }

  /** Tetto a padiglione su un rettangolo ±hx, ±hz (colmo lungo x). */
  hip(k: string, hx: number, hz: number, y0: number, rise: number): void {
    const r = Math.max(0, hx - hz);
    for (const s of [-1, 1]) {
      this.face(k, [[-hx, y0, s * hz], [hx, y0, s * hz], [r, y0 + rise, 0], [-r, y0 + rise, 0]], [0, 1, s]);
      this.face(k, [[s * hx, y0, -hz], [s * hx, y0, hz], [s * r, y0 + rise, 0]], [s, 1, 0]);
    }
  }

  pyramid(k: string, x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, o: Opt = {}): void {
    const c: V3 = [(x0 + x1) / 2, y1, (z0 + z1) / 2], q: V3[] = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]];
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; this.face(k, [a, b, c], [(a[0] + b[0]) / 2 - c[0], 1, (a[2] + b[2]) / 2 - c[2]], o); }
  }

  private circle(x: number, z: number, r: number): void {
    const p = Vector3.TransformCoordinates(new Vector3(x, 0, z), this.m);
    this.colliders.push({ x: p.x, z: p.z, r: r * this.k });
  }

  /** Ostacolo: il perimetro di un rettangolo, a cerchi. */
  solid(x0: number, z0: number, x1: number, z1: number, r = 0.45): void {
    const nx = Math.max(1, Math.ceil((x1 - x0 - 2 * r) / (r * 1.7))), nz = Math.max(1, Math.ceil((z1 - z0 - 2 * r) / (r * 1.7)));
    for (let i = 0; i <= nx; i++) { const x = x0 + r + (x1 - x0 - 2 * r) * i / nx; this.circle(x, z0 + r, r); this.circle(x, z1 - r, r); }
    for (let i = 1; i < nz; i++) { const z = z0 + r + (z1 - z0 - 2 * r) * i / nz; this.circle(x0 + r, z, r); this.circle(x1 - r, z, r); }
  }

  /** Ostacolo: una fila di cerchi (mura) o un cerchio solo (pali, pozzi). */
  line(x0: number, z0: number, x1: number, z1: number, r: number): void {
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (r * 1.6)));
    for (let i = 0; i <= n; i++) this.circle(x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n, r);
  }

  /** Ostacolo a segmento, spesso r per parte, che ferma solo fra le quote y0 e y1 (dove due piani stanno uno sull'altro). Due estremi uguali: un cerchio. */
  seg(x0: number, z0: number, x1: number, z1: number, r: number, y0: number, y1: number): void {
    const a = this.world(x0, y0, z0), b = this.world(x1, y1, z1);
    const rr = r * this.k;
    this.colliders.push(x0 === x1 && z0 === z1 ? { x: a.x, z: a.z, r: rr, y0: a.y, y1: b.y } : { x: a.x, z: a.z, bx: b.x, bz: b.z, r: rr, y0: a.y, y1: b.y });
  }
}

// ── pezzi di facciata (nel riferimento della facciata: piano z = 0, rivolto a +Z) ──

// ── finestre da cui si vede dentro ──
// Un edificio in cui si entra ha le finestre APERTE dove la pianta ha una nicchia allo stesso posto (layouts.ts, `deep`): lì
// il vetro è una lastra trasparente (`vetro`) e, un filo dietro, resta il lume opaco di sempre. Da lontano l'interno non sta
// nella scena e si vede il lume (acceso o spento); avvicinandosi l'interno entra in scena e quel lume SFUMA (l'alfa dei suoi
// vertici), fino a un velo: ciò che resta è il chiarore del vetro di una stanza accesa. Così non c'è scatto, e da lontano
// la città non paga gli interni. `THRU` raccoglie, per l'edificio in costruzione, quali vertici dei lumi sono di finestre
// aperte; `GLOW` da dove la loro luce cade sulla strada (un metro e mezzo davanti a ognuna).
/** Mentre è vero le finestre a telaio si disegnano con le imposte CHIUSE: dietro non c'è una stanza (il sottotetto della casa del ricco). */
let SHUT = false;
/** Due imposte di tavole chiuse sul vano da (a, y) a (b, yt), sul piano z. */
function boards(M: Mason, a: number, y: number, b: number, yt: number, z: number): void {
  M.box("wood", a, y, z, b, yt, z + 0.035, { tint: DOOR });
  M.box("timber", (a + b) / 2 - 0.012, y, z + 0.035, (a + b) / 2 + 0.012, yt, z + 0.042, { tint: DARK });
  for (const f of [0.2, 0.8]) M.box("timber", a + 0.03, y + (yt - y) * f - 0.035, z + 0.035, b - 0.03, y + (yt - y) * f + 0.035, z + 0.06);
}
let THRU: number[] | null = null, SEE = false, GLOW: { x: number; y: number; z: number }[] = [];
/** Ciò che `f` disegna sono finestre aperte (se l'edificio ha un interno). */
const see = (f: () => void): void => { SEE = !!THRU; f(); SEE = false; };
/** Il vetro di una finestra col centro in (cx, cy, z): `draw(materiale, scarto in z)`. */
function pane(M: Mason, k: string, cx: number, cy: number, z: number, draw: (k: string, dz: number) => void): void {
  if (!SEE || k !== "lume") { draw(k, 0); return; }
  const w = M.world(cx, cy, z + 2);
  GLOW.push({ x: w.x, y: w.y, z: w.z });
  const n = (): number => (M.geos.get("lume")?.p.length ?? 0) / 3, a = n();
  draw("vetro", 0); draw(k, -0.004);
  THRU!.push(a, n());
}

/** `deep` (solo ad arco) = quanto il vetro sta dentro il muro: il vano lo apre `Mason.wall` (`[x - w / 2, y, x + w / 2, y + h, 1]`). */
function win(M: Mason, x: number, y: number, w: number, h: number, k: string, arched = false, deep = 0): void {
  if (arched) {
    const zg = deep ? -deep : 0.05, zb = deep ? -deep + 0.025 : 0.05;   // il vetro, la ferrata
    // finestra di pietra: il vetro in fondo, attorno i conci in rilievo (piedritti e arco a pezzi alterni), il davanzale che
    // sporge, la ferrata
    const spring = Math.max(0, h - w * 0.75), n = 5;
    if (!deep) M.arch("stone", x, y - 0.18, w + 0.4, h + 0.36, 0.02, { tint: DARK });
    pane(M, k, x, y + h / 2, zg, (kk, dz) => M.arch(kk, x, y, w, h, zg + dz));
    for (const g of [-1, 1]) {
      for (let i = 0, yy = y; yy < y + spring - 0.05; i++, yy += 0.36) M.box(TRIM, x + g * (w / 2 + 0.11) - (i % 2 ? 0.16 : 0.11), yy, 0, x + g * (w / 2 + 0.11) + (i % 2 ? 0.16 : 0.11), Math.min(yy + 0.34, y + spring), 0.15, { tint: i % 2 ? GOLA : LISCIA });
      for (let i = 0; i < n; i++) {
        const a = M.archSide(x, y, w + 0.22, h + 0.11, 0, g, i / n), b = M.archSide(x, y, w + 0.22, h + 0.11, 0, g, (i + 1) / n);
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        M.box(TRIM, cx - L / 2 - 0.015, cy - 0.11, 0, cx + L / 2 + 0.015, cy + 0.11, 0.15, { rot: [0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])], tint: i % 2 ? LISCIA : GOLA });
      }
    }
    M.box(TRIM, x - w / 2 - 0.3, y - 0.17, -deep, x + w / 2 + 0.3, y - 0.02, 0.26, { tint: LISCIA, under: true });
    M.box("iron", x - 0.018, y, zb, x + 0.018, y + h - w * 0.16, zb + 0.035);
    for (let i = 1; i * 0.5 < spring + 0.2; i++) M.box("iron", x - w / 2, y + i * 0.5 - 0.015, zb, x + w / 2, y + i * 0.5 + 0.015, zb + 0.03);
    return;
  }
  // finestra a telaio: il vetro in fondo a un telaio spesso, la croce, l'architrave e il davanzale che sporgono; se non è
  // una vetrina, due imposte di tavole aperte contro il muro, con le traverse e le bandelle di ferro
  const f = 0.09, dz = 0.15;
  if (SHUT) boards(M, x - w / 2, y, x + w / 2, y + h, 0); else M.box(k, x - w / 2, y, 0, x + w / 2, y + h, 0.03);
  for (const s of [-1, 1]) M.box("timber", x + s * (w / 2 + f / 2) - f / 2, y - f, 0, x + s * (w / 2 + f / 2) + f / 2, y + h + f, dz);
  M.box("timber", x - w / 2, y + h, 0, x + w / 2, y + h + f, dz);
  M.box("timber", x - w / 2 - 0.17, y + h + f, 0, x + w / 2 + 0.17, y + h + f + 0.1, dz + 0.05, { under: true });
  M.box("timber", x - w / 2 - 0.19, y - f - 0.06, 0, x + w / 2 + 0.19, y - f + 0.03, dz + 0.12, { under: true });
  M.box("timber", x - w / 2, y - f + 0.03, 0, x + w / 2, y, dz);
  M.box("timber", x - 0.03, y, 0.03, x + 0.03, y + h, 0.1);
  M.box("timber", x - w / 2, y + h * 0.55 - 0.03, 0.03, x + w / 2, y + h * 0.55 + 0.03, 0.1);
  if (SHUT) return;
  M.piece("piombi", x - w / 2, y, 0.032, { size: [w, h, 1] });
  if (w > 1.3) return;
  // le imposte vere (kit), staccate dal muro quanto basta a stare DAVANTI alle travi del graticcio, che sporgono di 10–11 cm
  M.piece("imposta", x + w / 2 + f + 0.03, y, 0.115, { size: [w, h, 1], tint: { wood: DOOR } });
  M.piece("imposta", x - w / 2 - f - 0.03, y + h, 0.115, { size: [w, h, 1], rot: [0, 0, PI], tint: { wood: DOOR } });
}

/**
 * Una fascia di pietra che segue un sesto acuto, piedritti compresi: fra la sagoma (w, h) e quella più larga di `t` (con
 * l'imposta alla stessa quota), sporgente dal muro da z0 a z1. Ghiere dei portali, cornici delle finestre, arcatelle.
 */
function archRing(M: Mason, k: string, cx: number, y0: number, w: number, h: number, t: number, z0: number, z1: number, o: Opt = {}): void {
  const n = 6, line = (ww: number, hh: number): V3[] => {
    const p: V3[] = [[cx - ww / 2, y0, 0]];
    for (let i = 0; i <= n; i++) p.push(M.archSide(cx, y0, ww, hh, 0, -1, i / n));
    for (let i = n - 1; i >= 0; i--) p.push(M.archSide(cx, y0, ww, hh, 0, 1, i / n));
    p.push([cx + ww / 2, y0, 0]);
    return p;
  };
  const a = line(w, h), b = line(w + 2 * t, h + 1.5 * t), at = (p: V3, z: number): V3 => [p[0], p[1], z], cy = y0 + h * 0.45;
  for (let i = 0; i < a.length - 1; i++) {
    const mx = (a[i][0] + a[i + 1][0]) / 2 - cx, my = (a[i][1] + a[i + 1][1]) / 2 - cy;
    M.face(k, [at(a[i], z1), at(a[i + 1], z1), at(b[i + 1], z1), at(b[i], z1)], [0, 0, 1], o);
    M.face(k, [at(a[i], z0), at(a[i + 1], z0), at(a[i + 1], z1), at(a[i], z1)], [-mx, -my, 0], o);
    M.face(k, [at(b[i], z0), at(b[i + 1], z0), at(b[i + 1], z1), at(b[i], z1)], [mx, my, 0], o);
  }
}

/**
 * Bifora di pietra su un muro pieno (torri, navate): il vetro a filo del muro e, davanti, ciò che le dà corpo: la cornice a
 * due gole che sporge di `out`, il davanzale, i trafori scolpiti (kit) con la colonnina in mezzo.
 */
function lancet(M: Mason, x: number, y: number, w: number, h: number, k: string, out = 0.24, deep = 0): void {
  const t = Math.min(0.24, w * 0.2), sp = y + h - w * 0.75, zg = deep ? -deep : 0.012;   // (`deep`: il vetro in fondo al vano che `Mason.wall` ha aperto)
  pane(M, k, x, y + h / 2, zg, (kk, dz) => M.arch(kk, x, y, w, h, zg + dz));
  archRing(M, TRIM, x, y, w, h, t, 0, out, { tint: LISCIA });
  archRing(M, TRIM, x, y, w + 2 * t, h + 1.5 * t, 0.07, 0, out * 0.45, { tint: GOLA });
  M.box(TRIM, x - w / 2 - t - 0.12, y - 0.2, 0, x + w / 2 + t + 0.12, y, out + 0.1, { tint: LISCIA, under: true });
  M.piece("trafori", x, sp, 0.03, { size: [w, w, 1.2], as: TRIM, tint: LISCIA });
  M.box(TRIM, x - 0.045 * w, y, 0.03, x + 0.045 * w, sp, 0.15, { tint: LISCIA });
}

/** Contrafforte a tre riseghe nel riferimento del suo muro (sporge verso +Z): zoccolo, spioventi a ogni risega, la guglia in cima (kit). */
function buttress(M: Mason, h: number): void {
  const hw = 0.5, st = [[0, 1.3], [h * 0.42, 1.1], [h * 0.78, 0.9]];   // [da che quota, quanto sporge]
  st.forEach(([y, d], i) => {
    const top = i < 2 ? st[i + 1][0] : h;
    M.box("stone", -hw, y, 0, hw, top, d, { tint: DARK });
    if (i === 2) return;
    const nd = st[i + 1][1], up = top + (d - nd) * 1.2;   // lo spiovente fino alla risega di sopra
    M.face(TRIM, [[-hw, top, d], [hw, top, d], [hw, up, nd], [-hw, up, nd]], [0, 1, 1], { tint: LISCIA });
    for (const s of [-1, 1]) M.face("stone", [[s * hw, top, d], [s * hw, top, nd], [s * hw, up, nd]], [s, 0, 0]);
  });
  M.box("stone", -hw - 0.07, 0, 0, hw + 0.07, 0.55, 1.37, { tint: DARK });
  M.piece("guglia", 0, h, 0.6, { size: [1.3, 1.3, 1.3], as: TRIM, tint: LISCIA });
}

const SASH = 0.07, DEEP = 0.08;
// la pietra LAVORATA (cornici, trafori, colonnine, guglie): liscia e chiara, o sul muro a sassi non si legge. È l'intonaco tinto.
const TRIM = "plaster", LISCIA: Tint = [0.74, 0.68, 0.57], GOLA: Tint = [0.5, 0.46, 0.39];
const NOISE_GLSL = `
float sqGh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sqGn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sqGh(i), sqGh(i + vec2(1.0, 0.0)), f.x), mix(sqGh(i + vec2(0.0, 1.0)), sqGh(i + vec2(1.0, 1.0)), f.x), f.y); }`;

/**
 * Il lume delle finestre viste da lontano (e il velo che ne resta da vicino). Non è una lampadina: dietro ci sono fuochi e
 * candele, quindi è ambra e non arancio pieno, non è uguale su tutta la finestra (più chiaro dove sta la fiamma, più
 * scuro verso gli angoli) e TREMA, ogni finestra per conto suo (la fase viene dalla posizione nel mondo).
 * ⚠️ HDR: passa appena la soglia del bloom; più acceso diventa una lampadina bianca.
 */
function lumeMat(scene: Scene): Material {
  const m = new CustomMaterial("town_lume", scene);
  m.diffuseColor = Color3.Black(); m.emissiveColor = new Color3(0.98, 0.66, 0.36); m.specularColor = Color3.Black(); m.backFaceCulling = false;   // (il colore di un muro chiaro alla luce del fuoco, non una lampadina arancione)
  m.AddUniform("sqTime", "float", undefined);
  m.Fragment_Definitions(NOISE_GLSL);
  m.Fragment_Before_FragColor(`
    float sqPh = vPositionW.x * 1.7 + vPositionW.z * 1.3 + floor(vPositionW.y * 0.33) * 2.1;
    float sqT = sqTime * (0.8 + 0.4 * fract(sqPh * 0.137));
    float sqF = 0.84 + 0.1 * sin(sqT * 5.3 + sqPh) + 0.07 * sin(sqT * 12.7 - sqPh * 1.9) + 0.06 * sin(sqT * 2.3 + sqPh * 0.6);
    // la luce dentro non è uniforme: chiazze larghe che si spostano piano (ombre di chi passa davanti al fuoco), una
    // grana più fitta che guizza con la fiamma, più chiaro in basso (dove stanno fuoco e candele) che verso il soffitto
    vec2 sqQ = vec2(vPositionW.x + vPositionW.z, vPositionW.y);
    float sqS = sqGn(sqQ * 1.6 + vec2(sqTime * 0.13, sqTime * 0.08)), sqS2 = sqGn(sqQ * 4.7 - vec2(sqTime * 0.5, sqTime * 0.31));
    float sqUp = 0.82 + 0.3 * (1.0 - fract(vPositionW.y * 0.31));
    color.rgb *= sqF * (0.5 + 0.5 * sqS + 0.22 * sqS2) * sqUp;
  `);
  const attach = m.AttachAfterBind.bind(m);
  m.AttachAfterBind = (mesh, effect) => { attach(mesh, effect); effect.setFloat("sqTime", performance.now() / 1000); };
  return m;
}

/** Va chiamata un attimo prima di disegnare il vetro (createTown la appende alla sua mesh). */
let GRAB: () => void = () => {};

/**
 * La scena già disegnata, copiata in una texture a metà fotogramma: tutto ciò che viene prima del vetro (il mondo, e fra le
 * trasparenti il lume). Babylon non la dà: si copia a mano il framebuffer corrente (WebGL2, `blitFramebuffer`, che scioglie
 * anche l'antialiasing) in una texture nostra, avvolta perché un materiale la possa leggere. Vale solo nel passaggio
 * principale (non nelle mappe d'ombra, dove il vetro pure si disegna) e una volta per fotogramma. La texture si crea
 * all'INIZIO di un fotogramma (mai a metà: toccare le texture alle spalle di Babylon vuole `wipeCaches`), nel formato del
 * bersaglio corrente (con l'antialiasing i due formati devono coincidere). Se qualcosa non torna (niente WebGL2, niente
 * bersaglio HDR, un errore alla prima copia) non c'è rifrazione e il vetro resta trasparente com'era.
 */
function grabber(scene: Scene): { grab(): void; tex(): BaseTexture | null; w(): number; h(): number } {
  const engine = scene.getEngine() as Engine, gl = engine._gl as WebGL2RenderingContext;
  let fbo: WebGLFramebuffer | null = null, raw: WebGLTexture | null = null, tex: BaseTexture | null = null;
  let w = 0, h = 0, want: [number, number, number] | null = null, main = false, dead = !gl || !gl.blitFramebuffer, tried = false, fresh = false;
  scene.onBeforeDrawPhaseObservable.add(() => { main = true; });
  scene.onAfterDrawPhaseObservable.add(() => { main = false; });
  scene.onBeforeRenderObservable.add(() => {
    if (dead || !want) return;
    const [W, H, type] = want, fmt = type === 2 ? [gl.RGBA16F, gl.HALF_FLOAT] : type === 1 ? [gl.RGBA32F, gl.FLOAT] : [gl.RGBA8, gl.UNSIGNED_BYTE];
    want = null;
    if (raw) { gl.deleteTexture(raw); gl.deleteFramebuffer(fbo); }
    raw = gl.createTexture(); fbo = gl.createFramebuffer();
    gl.bindTexture(gl.TEXTURE_2D, raw);
    gl.texImage2D(gl.TEXTURE_2D, 0, fmt[0], W, H, 0, gl.RGBA, fmt[1], null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, raw, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindTexture(gl.TEXTURE_2D, null);
    engine.wipeCaches(true);
    tex = new BaseTexture(scene, engine.wrapWebGLTexture(raw!, false, 2, W, H));   // (2 = bilineare)
    w = W; h = H; fresh = false;
  });
  return {
    tex: () => (dead || !fresh ? null : tex), w: () => w, h: () => h,
    grab() {
      const rt = engine._currentRenderTarget;
      if (dead || !main || !rt?.texture) return;
      main = false;
      const W = rt.width, H = rt.height;
      if (W !== w || H !== h) { want = [W, H, rt.texture.type]; fresh = false; return; }
      const cur = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, cur); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, fbo);
      gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, cur);
      if (!tried) { tried = true; if (gl.getError() !== gl.NO_ERROR) { dead = true; console.warn("vetro: niente rifrazione (la copia della scena non è riuscita)"); return; } }
      fresh = true;
    },
  };
}

/**
 * Il vetro delle finestre aperte: vetro soffiato, non una lastra moderna. È ondulato (la normale si piega con un rumore
 * lento e una grana fine), quindi il riflesso del cielo e il lampo del sole non sono piatti ma si rompono e scorrono
 * camminando; di fronte è quasi trasparente, di sbieco riflette (Fresnel); ha un'ombra verdastra appena accennata.
 * Il cielo riflesso è il colore della nebbia (l'orizzonte di quell'ora), più scuro verso terra.
 * RIFRANGE: un attimo prima di disegnarlo, ciò che è già a schermo viene copiato in una texture (`grabber`), e il vetro la
 * rilegge spostata di quanto la sua normale è piegata (più da vicino, meno da lontano), coi tre colori spostati appena
 * diversamente (la frangia colorata ai bordi di ciò che si vede attraverso). Senza copia (vedi `grabber`) torna trasparente.
 * ⚠️ Niente `opacityFresnelParameters`: in Babylon quell'opacità si SOMMA all'alfa e la faccia vista da dietro vale sempre
 * "di sbieco" (da dentro il vetro diventava un muro): qui la normale si gira verso chi guarda e il conto è fatto a mano.
 */
function glassMat(scene: Scene): Material {
  const m = new CustomMaterial("town_vetro", scene), sun = new Vector3(), ZERO = Color3.Black(), back = grabber(scene);
  GRAB = back.grab;
  m.diffuseColor = new Color3(0.06, 0.09, 0.08); m.emissiveColor = Color3.Black(); m.specularColor = new Color3(0.9, 0.88, 0.8); m.specularPower = 160;
  m.backFaceCulling = false; m.alpha = 0.16;
  // ⚠️ Con la rifrazione il vetro esce ad alfa 1: se il materiale potesse scrivere anche profondità e normali (il "prepass"
  // dell'occlusione ambientale lo fa per ogni pixel con alfa > 0,4) l'occlusione lo prenderebbe per un muro in fondo a una
  // nicchia e lo scurirebbe del 60%. Un materiale che non scrive la profondità non partecipa.
  m.disableDepthWrite = true;
  m.AddUniform("sqSky", "vec3", undefined); m.AddUniform("sqSunDir", "vec3", undefined); m.AddUniform("sqSunCol", "vec3", undefined);
  m.AddUniform("sqScene", "sampler2D", RawTexture.CreateRGBATexture(new Uint8Array(4), 1, 1, scene)); m.AddUniform("sqRes", "vec3", undefined);   // la scena dietro, la sua misura, se c'è
  m.Fragment_Definitions(NOISE_GLSL);
  m.Fragment_Before_FragColor(`
    vec3 sqV = normalize(vEyePosition.xyz - vPositionW);
    vec3 sqN = normalize(vNormalW); if (dot(sqN, sqV) < 0.0) sqN = -sqN;
    vec3 sqTx = normalize(vec3(sqN.z, 0.0, -sqN.x) + vec3(1e-4, 0.0, 0.0));
    vec2 sqU = vec2(dot(vPositionW, sqTx), vPositionW.y);                       // metri sul piano del vetro
    // le onde del vetro: larghe e lente, più una grana fine
    vec2 sqW = vec2(sqGn(sqU * 7.0) - 0.5, sqGn(sqU * 7.0 + 31.7) - 0.5) * 0.22 + vec2(sqGn(sqU * 41.0) - 0.5, sqGn(sqU * 41.0 + 9.3) - 0.5) * 0.05;
    vec3 sqN2 = normalize(sqN + sqTx * sqW.x + vec3(0.0, 1.0, 0.0) * sqW.y);
    float sqF = 0.05 + 0.95 * pow(1.0 - max(dot(sqN2, sqV), 0.0), 4.0);
    vec3 sqR = reflect(-sqV, sqN2);
    // (qui il colore è già lineare: il cielo, che è dato in gamma, va portato in lineare)
    vec3 sqEnv = pow(sqSky, vec3(2.2)) * mix(0.22, 1.25, smoothstep(-0.2, 0.45, sqR.y));
    float sqGl = pow(max(dot(sqR, sqSunDir), 0.0), 260.0) + 0.15 * pow(max(dot(sqR, sqSunDir), 0.0), 24.0);   // il sole: un lampo e il suo alone
    vec3 sqTint = mix(vec3(0.86, 0.97, 0.9), vec3(1.0), sqGn(sqU * 2.3 + 5.0));   // l'ombra verdastra del vetro, appena
    if (sqRes.z > 0.5) {
      // rifrazione: la scena dietro, letta dove la piega del vetro la sposta; rosso e blu un filo più in qua e più in là
      vec2 sqUv = gl_FragCoord.xy / sqRes.xy, sqO = sqW * vec2(sqRes.y / sqRes.x, 1.0) * (0.045 / max(length(vEyePosition.xyz - vPositionW), 1.0));
      vec3 sqB = vec3(texture2D(sqScene, sqUv + sqO * 0.82).r, texture2D(sqScene, sqUv + sqO).g, texture2D(sqScene, sqUv + sqO * 1.2).b);
      color.rgb = mix(mix(sqB * sqTint, color.rgb, 0.06), sqEnv, sqF) + sqSunCol * sqGl;
      color.a = 1.0;
    } else {
      color.rgb = mix(color.rgb * sqTint, sqEnv, sqF) + sqSunCol * sqGl;
      color.a = clamp(color.a + sqF * 0.8 + sqGl * 2.0, 0.0, 1.0);
    }
  `);
  const attach = m.AttachAfterBind.bind(m);
  m.AttachAfterBind = (mesh, effect) => {
    attach(mesh, effect);
    const s = scene.getLightByName("sun") as DirectionalLight | null, up = s ? -s.direction.y : 0;
    effect.setColor3("sqSky", scene.fogColor);
    effect.setVector3("sqSunDir", s ? sun.copyFrom(s.direction).scaleInPlace(-1) : sun.set(0, 1, 0));
    effect.setColor3("sqSunCol", s && up > 0 ? s.diffuse.scale(Math.min(1.4, s.intensity * 0.5)) : ZERO);
    const t = back.tex();
    if (t) effect.setTexture("sqScene", t);
    effect.setFloat3("sqRes", back.w(), back.h(), t ? 1 : 0);
  };
  return m;
}

/**
 * L'acqua del fiume: una lastra opaca col fondo scuro, che riflette il cielo dell'ora (il colore della nebbia, più chiaro
 * verso l'alto: Fresnel, quasi niente di fronte e tutto di sbieco) e il lampo del sole. Le increspature sono tre strati di
 * rumore che scorrono a velocità e versi diversi: la normale si piega secondo la loro pendenza.
 * ponytail: niente riflesso delle case né corrente lungo l'alveo (lo scorrere è uguale ovunque); se servono, una sonda
 * di riflessione e il verso del fiume nei colori dei vertici.
 */
function waterMat(scene: Scene): Material {
  const m = new CustomMaterial("town_acqua", scene), sun = new Vector3(), ZERO = Color3.Black();
  m.diffuseColor = new Color3(0.02, 0.035, 0.038); m.specularColor = Color3.Black(); m.backFaceCulling = false;
  m.AddUniform("sqSky", "vec3", undefined); m.AddUniform("sqSunDir", "vec3", undefined); m.AddUniform("sqSunCol", "vec3", undefined); m.AddUniform("sqTime", "float", undefined);
  m.Fragment_Definitions(NOISE_GLSL + `
float sqWh(vec2 p, float t) {
  return sqGn(p * 0.35 + vec2(t * 0.05, t * 0.03)) * 0.6 + sqGn(p * 1.3 - vec2(t * 0.11, -t * 0.07)) * 0.3 + sqGn(p * 4.1 + vec2(t * 0.2, t * 0.15)) * 0.1;
}`);
  m.Fragment_Before_FragColor(`
    vec2 sqP = vPositionW.xz; float sqE = 0.12;
    vec3 sqN = normalize(vec3(-(sqWh(sqP + vec2(sqE, 0.0), sqTime) - sqWh(sqP - vec2(sqE, 0.0), sqTime)) * 1.6, 1.0,
                              -(sqWh(sqP + vec2(0.0, sqE), sqTime) - sqWh(sqP - vec2(0.0, sqE), sqTime)) * 1.6));
    vec3 sqV = normalize(vEyePosition.xyz - vPositionW);
    float sqF = 0.02 + 0.98 * pow(1.0 - max(dot(sqN, sqV), 0.0), 5.0);
    vec3 sqR = reflect(-sqV, sqN);
    // (qui il colore è già lineare: il cielo, che è dato in gamma, va portato in lineare)
    vec3 sqEnv = pow(sqSky, vec3(2.2)) * mix(0.3, 1.1, smoothstep(-0.1, 0.5, sqR.y));
    float sqGl = pow(max(dot(sqR, sqSunDir), 0.0), 420.0) * 1.3 + 0.12 * pow(max(dot(sqR, sqSunDir), 0.0), 40.0);
    color.rgb = mix(color.rgb, sqEnv, sqF) + sqSunCol * sqGl;
  `);
  const attach = m.AttachAfterBind.bind(m);
  m.AttachAfterBind = (mesh, effect) => {
    attach(mesh, effect);
    const s = scene.getLightByName("sun") as DirectionalLight | null, up = s ? -s.direction.y : 0;
    effect.setColor3("sqSky", scene.fogColor);
    effect.setVector3("sqSunDir", s ? sun.copyFrom(s.direction).scaleInPlace(-1) : sun.set(0, 1, 0));
    effect.setColor3("sqSunCol", s && up > 0 ? s.diffuse.scale(Math.min(1.4, s.intensity * 0.5)) : ZERO);
    effect.setFloat("sqTime", performance.now() / 1000);
  };
  return m;
}

/** Il vano che `sash` vuole nel muro (per `Mason.wall`): la luce più il telaio. */
const hole = (x: number, y: number, w: number, h: number): number[] => [x - w / 2 - SASH, y - SASH, x + w / 2 + SASH, y + h + SASH];
/**
 * Finestra a telaio INCASSATA nel suo vano (`hole`, aperto da `Mason.wall`): il vetro 8 cm dentro il muro con la rete dei
 * piombi (kit), il telaio nello sguancio, la croce, davanzale e architrave che sporgono, due imposte vere (kit) aperte
 * contro il muro, davanti alle travi del graticcio. Più in fondo di così no: lì cominciano i vetri della nicchia di dentro.
 */
function sash(M: Mason, x: number, y: number, w: number, h: number, k: string, shutters = true): void {
  const f = SASH, z = -DEEP, a = x - w / 2, b = x + w / 2;
  if (SHUT) boards(M, a, y, b, y + h, z);
  else { pane(M, k, x, y + h / 2, z, (kk, dz) => M.poly(kk, [[a, y, z + dz], [b, y, z + dz], [b, y + h, z + dz], [a, y + h, z + dz]], [0, 0, 1])); M.piece("piombi", a, y, z + 0.004, { size: [w, h, 1] }); }
  M.box("timber", a - f, y - f, z, a, y + h + f, -0.01); M.box("timber", b, y - f, z, b + f, y + h + f, -0.01);
  M.box("timber", a, y + h, z, b, y + h + f, -0.01, { under: true }); M.box("timber", a, y - f, z, b, y, -0.01);
  M.box("timber", x - 0.025, y, z, x + 0.025, y + h, z + 0.045); M.box("timber", a, y + h * 0.55 - 0.025, z, b, y + h * 0.55 + 0.025, z + 0.045);
  M.box("timber", a - f - 0.1, y + h + f, 0, b + f + 0.1, y + h + f + 0.1, 0.2, { under: true });
  M.box("timber", a - f - 0.12, y - f - 0.07, z, b + f + 0.12, y - f, 0.27, { under: true });
  if (!shutters || SHUT) return;   // (una vetrina non ne ha)
  const sw = (w / 2 + f * 0.5) / 0.5;
  M.piece("imposta", b + f + 0.03, y, 0.115, { size: [sw, h, 1], tint: { wood: DOOR } });
  M.piece("imposta", a - f - 0.03, y + h, 0.115, { size: [sw, h, 1], rot: [0, 0, PI], tint: { wood: DOOR } });
}

/**
 * Un drappo appeso per l'orlo di sopra (y1) sul piano z: una griglia fitta che il vento muove, più in basso più forte;
 * `tail` = quanto è lunga la coda di rondine in fondo.
 */
function drape(M: Mason, x0: number, y0: number, x1: number, y1: number, z: number, tint: Tint, tail = 0): void {
  const was = M.cell, wave = (p: V3): number => (y1 - p[1]) / (y1 - y0 + tail), xm = (x0 + x1) / 2;
  M.cell = 0.3;
  M.poly("cloth", [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], [0, 0, 1], { tint, wave });
  M.cell = was;
  if (tail) { M.poly("cloth", [[x0, y0, z], [xm, y0, z], [x0, y0 - tail, z]], [0, 0, 1], { tint, wave }); M.poly("cloth", [[xm, y0, z], [x1, y0, z], [x1, y0 - tail, z]], [0, 0, 1], { tint, wave }); }
}

/** Un angolo "a caso" che dipende solo dal posto: gli arredi da modello non devono estrarre numeri da `rnd`. */
const turn = (p: { x: number; z: number }): number => (Math.abs(Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1) * 2 * PI;

/** Comignolo: il fusto, la cimasa che sporge, due canne di cotto. */
function chimney(M: Mason, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  M.box("stone", x0, y0, z0, x1, y1, z1, { tint: DARK });
  M.box("stone", x0 - 0.09, y1, z0 - 0.09, x1 + 0.09, y1 + 0.13, z1 + 0.09, { under: true });
  const cz = (z0 + z1) / 2, n = x1 - x0 > 0.75 ? 2 : 1;
  smoke(M.world((x0 + x1) / 2, y1 + 0.5, cz), 1.1, 2);   // il fumo esce finché in casa arde il fuoco (il gruppo dell'edificio)
  for (let i = 0; i < n; i++) { const cx = x0 + (x1 - x0) * (i + 0.5) / n; M.drum("tile", cx, cz, 0.12, y1 + 0.13, y1 + 0.5, {}, 0.1, 8); M.drum("dark", cx, cz, 0.075, y1 + 0.5, y1 + 0.505, {}, 0.075, 8); }
}

/** Cantonali: conci alterni in rilievo sullo spigolo (x, z) di un muro di pietra, da terra a `h`; `sx`, `sz` = da che parte sta il muro. Solo lastre sottili: dietro c'è la stanza. */
function quoins(M: Mason, x: number, z: number, sx: number, sz: number, h: number): void {
  for (let i = 0, y = 0.02; y < h - 0.3; i++, y += 0.44) {
    const lx = i % 2 ? 0.56 : 0.32, lz = i % 2 ? 0.32 : 0.56;
    M.box("stone", Math.min(x, x - sx * lx), y, Math.min(z, z + sz * 0.045), Math.max(x, x - sx * lx), y + 0.4, Math.max(z, z + sz * 0.045), { tint: DARK });
    M.box("stone", Math.min(x, x + sx * 0.045), y, Math.min(z + sz * 0.045, z - sz * lz), Math.max(x, x + sx * 0.045), y + 0.4, Math.max(z + sz * 0.045, z - sz * lz), { tint: DARK });
  }
}

function door(M: Mason, x: number, w: number, h: number, arched = false): void {
  if (arched) { M.arch("stone", x, 0, w + 0.5, h + 0.3, 0.03, { tint: DARK }); M.arch("wood", x, 0, w, h, 0.07, { tint: DOOR }); }
  else { M.box("wood", x - w / 2, 0, 0, x + w / 2, h, 0.06, { tint: DOOR }); M.box("timber", x - w / 2 - 0.1, h, 0, x + w / 2 + 0.1, h + 0.16, 0.1); }
  M.box("stone", x - w / 2 - 0.2, 0, 0, x + w / 2 + 0.2, 0.12, 0.45, { tint: DARK });
}

/** Graticcio: correnti, montanti e le saette nelle campate d'angolo. */
/** `gaps` = le finestre di quella parete [centro, larghezza, sotto, sopra]: un montante che ci cadrebbe dentro si ferma al davanzale e riprende sopra l'architrave, e una saetta che le attraverserebbe non si mette. */
function frame(M: Mason, w: number, y0: number, y1: number, bays: number, gaps: number[][] = []): void {
  const hw = w / 2, t = 0.09, bw = w / bays, h = y1 - y0 - 0.32, a = Math.atan2(bw - 2 * t, h), L = Math.hypot(bw - 2 * t, h);
  // (le travi sporgono dall'intonaco quanto una mano: l'ombra fra trave e riquadro è ciò che dà corpo alla facciata)
  M.box("timber", -hw, y0, 0, hw, y0 + 0.18, 0.11); M.box("timber", -hw, y1 - 0.18, 0, hw, y1, 0.11);
  for (let i = 0; i <= bays; i++) {
    const x = -hw + i * bw, g = gaps.find(([gx, gw]) => Math.abs(x - gx) < gw / 2 + 0.12 + t);
    if (!g) { M.box("timber", x - t, y0, 0, x + t, y1, 0.1); continue; }
    M.box("timber", x - t, y0, 0, x + t, g[2] - 0.15, 0.1); M.box("timber", x - t, g[3] + 0.19, 0, x + t, y1, 0.1);
  }
  for (const s of [-1, 1]) if (!gaps.some(([gx, gw]) => Math.abs(s * (hw - bw / 2) - gx) < gw / 2 + bw / 2 - 0.15)) M.box("timber", s * (hw - bw / 2) - 0.075, y0 + 0.16 + h / 2 - L / 2, 0, s * (hw - bw / 2) + 0.075, y0 + 0.16 + h / 2 + L / 2, 0.085, { rot: [0, 0, s * a] });
}

/** Le fiamme che di notte fanno luce attorno (lanterne, forgia), nel mondo: da qui si cuoce la luce dei lampioni (`bakeLamps`). */
const flames: Vector3[] = [];

/** Le lanterne che si accendono e si spengono: il nome, dov'è la fiamma, e quali vertici della mesh dei vetri sono suoi. */
const LAMPS: { id: string; p: Vector3; a: number; b: number }[] = [];
/** Lanterna a olio: vetri accesi fra un fondo e un cappello di ferro. `id` = con che nome si accende e si spegne. */
function lantern(M: Mason, x: number, y: number, z: number, id: string): void {
  const a = (M.geos.get("lamp")?.c.length ?? 0) / 4;
  group(id, () => flame(M.world(x, y + 0.07, z), 0.2, 0.3));   // la fiammella dietro i vetri: il vento la tocca poco
  // una gabbia di ferro attorno ai vetri: il fondo, quattro montanti, la cornice, il cappello a punta col suo anello
  M.box("iron", x - 0.13, y, z - 0.13, x + 0.13, y + 0.04, z + 0.13, { under: true });
  M.box("lamp", x - 0.1, y + 0.04, z - 0.1, x + 0.1, y + 0.38, z + 0.1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box("iron", x + sx * 0.105 - 0.012, y + 0.04, z + sz * 0.105 - 0.012, x + sx * 0.105 + 0.012, y + 0.38, z + sz * 0.105 + 0.012);
  M.box("iron", x - 0.15, y + 0.38, z - 0.15, x + 0.15, y + 0.41, z + 0.15, { under: true });
  M.pyramid("iron", x - 0.19, z - 0.19, x + 0.19, z + 0.19, y + 0.41, y + 0.6);
  M.box("iron", x - 0.02, y + 0.6, z - 0.02, x + 0.02, y + 0.66, z + 0.02);
  LAMPS.push({ id, p: M.world(x, y + 0.2, z), a, b: M.geos.get("lamp")!.c.length / 4 });
}

/**
 * Di quanto alzare (o abbassare) ciò che si posa in (x, z) del riferimento corrente perché stia sul suolo della città
 * (`townGround`: il rilievo, o il piano di sempre; sul piano vale zero).
 */
function rise(M: Mason, x: number, z: number): number { const p = M.world(x, 0, z); return townGround(p.x, p.z) - p.y; }
/** Lo zoccolo: se sotto l'ingombro (centrato nell'origine) il suolo scende, un basamento di pietra fino a terra. */
function footing(M: Mason, w: number, d: number): void {
  const drop = Math.max(...[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => -rise(M, sx * w / 2, sz * d / 2)));
  if (drop > 0.05) M.box("stone", -w / 2 - 0.08, -drop - 0.3, -d / 2 - 0.08, w / 2 + 0.08, 0.02, d / 2 + 0.08, { tint: DARK });
}

function lamppost(M: Mason, x: number, z: number, id: string): void {
  M.in(x, rise(M, x, z), z, 0, () => {
    // base di pietra a due gradini, fusto di ferro a otto facce con due nodi, la traversa con i riccioli
    M.box("stone", -0.24, 0, -0.24, 0.24, 0.14, 0.24, { tint: DARK }); M.box("stone", -0.17, 0.14, -0.17, 0.17, 0.36, 0.17, { tint: DARK });
    M.piece("fusto", 0, 0.36, 0);   // il fusto tornito, coi nodi e il braccio a riccioli (kit)
    lantern(M, 0, 2.75, 0, id);
    M.line(0, 0, 0, 0, 0.2);
  });
}

function barrel(M: Mason, x: number, z: number): void {
  // una botte vera (modello: props.ts), girata a caso ma sempre uguale (dal posto, non da `rnd`)
  const p = M.world(x, 0, z);
  prop("wine_barrel_01", p, turn(p), { h: 0.95 });
  M.line(x, z, x, z, 0.36);
}

/**
 * Un muro di facciata col vano a sesto acuto di un uscio (nel riferimento della facciata): da x0 a x1, alto h0; la mostra
 * di pietra (più larga e più alta del vano di `frame[0]` e `frame[1]`, sporgente `frame[2]`), l'imbotte e la soglia.
 * I battenti stanno dietro, a LIP dal filo del muro (vedi interiors.ts).
 */
function portal(M: Mason, x0: number, x1: number, h0: number, d: { x: number; w: number; h: number }, frame: V3 = [0.5, 0.3, 0.03], sill = true, holes: number[][] = [], deep = 0): void {
  const { x: cx, w, h } = d, W = w + frame[0], H = h + frame[1], fz = frame[2], n = 5;
  const inner = (g: number, i: number, z = 0): V3 => M.archSide(cx, 0, w, h, z, g, i / n), outer = (g: number, i: number): V3 => M.archSide(cx, 0, W, H, fz, g, i / n);
  for (const g of [-1, 1]) {
    const e = g < 0 ? x0 : x1;
    M.wall("stone", Math.min(e, cx + g * w / 2), 0, Math.max(e, cx + g * w / 2), h0, holes.filter((q) => (q[0] - cx) * g > 0), deep);       // il muro ai lati del vano, coi vani delle sue finestre
    M.face("stone", [[cx + g * w / 2, 0, fz], [cx + g * W / 2, 0, fz], outer(g, 0), inner(g, 0, fz)], [0, 0, 1], { tint: DARK });              // la mostra: piedritto
    M.face("stone", [[cx + g * w / 2, 0, -LIP], [cx + g * w / 2, 0, fz], inner(g, 0, fz), inner(g, 0, -LIP)], [-g, 0, 0], { tint: DARK });      // l'imbotte: piedritto
    for (let i = 0; i < n; i++) {
      const a = inner(g, i), b = inner(g, i + 1);
      M.face("stone", [a, b, [b[0], h0, 0], [a[0], h0, 0]], [0, 0, 1]);                                                                     // il muro sopra l'arco
      M.face("stone", [inner(g, i, fz), inner(g, i + 1, fz), outer(g, i + 1), outer(g, i)], [0, 0, 1], { tint: DARK });                     // la mostra: arco
      M.face("stone", [inner(g, i, -LIP), inner(g, i + 1, -LIP), inner(g, i + 1, fz), inner(g, i, fz)], [-g, -1, 0], { tint: DARK });       // l'imbotte: arco
    }
  }
  if (sill) M.box("stone", cx - w / 2 - 0.2, 0, -LIP - 0.07, cx + w / 2 + 0.2, 0.12, 0.45, { tint: DARK });                                 // la soglia, fin sotto i battenti
}

/** Una cornice attorno a un edificio in cui si entra (semilati `o` e `p`, da y a t): le facce di fuori e, sopra e sotto, solo una striscia larga `w`: dentro passano i solai. */
function ring(M: Mason, o: number, p: number, y: number, t: number, w: number): void {
  const q = o - w, r = p - w;
  for (const s of [-1, 1]) {
    M.face("stone", [[s * o, y, -p], [s * o, y, p], [s * o, t, p], [s * o, t, -p]], [s, 0, 0], { tint: DARK });
    M.face("stone", [[-o, y, s * p], [o, y, s * p], [o, t, s * p], [-o, t, s * p]], [0, 0, s], { tint: DARK });
    for (const [yy, up] of [[y, -1], [t, 1]]) {
      M.face("stone", [[s * q, yy, -p], [s * o, yy, -p], [s * o, yy, p], [s * q, yy, p]], [0, up, 0], { tint: DARK });
      M.face("stone", [[-q, yy, s * r], [q, yy, s * r], [q, yy, s * p], [-q, yy, s * p]], [0, up, 0], { tint: DARK });
    }
  }
}

/** Un muro dritto fra due punti a terra (nel riferimento corrente), da y0 a y1, che guarda dalla parte di `n`. */
const wallFace = (M: Mason, k: string, ax: number, az: number, bx: number, bz: number, y0: number, y1: number, n: V3, o: Opt = {}): void =>
  M.face(k, [[ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az]], n, o);

/**
 * Casa. kind 0 = povera (sasso, intonaco, paglia); 1 = a graticcio, timpano sulla strada;
 * 2 = del ricco (due piani, l'ultimo a graticcio, gronda sulla strada, comignoli).
 * `open` = ci si entra, e con quale interno: un guscio vuoto al posto della scatola piena (l'interno, i muri che fermano
 * il passo e i battenti dell'uscio li fa interiors.ts); la locanda ha anche l'insegna. Restituisce lo yaw con cui è stata posata.
 */
function house(M: Mason, rnd: () => number, x: number, z: number, yaw: number, w: number, d: number, kind: 0 | 1 | 2, open?: InteriorId, scale = 1): number {
  const hw = w / 2, hd = d / 2, lit = (): string => (rnd(), "lume"), inn = open === "locanda";   // (ogni finestra è un lume: accesa se c'è qualcuno)
  const e = open ? entry((["casa.povera", "casa.graticcio", "casa.ricca"] as const)[kind], w) : null;   // il vano dell'uscio
  // ⚠️ i due numeri a caso si estraggono comunque, in quest'ordine: il resto della città ne dipende
  const a = yaw + (rnd() - 0.5) * 0.05, lean = (rnd() - 0.5) * 0.035;
  M.in(x, rise(M, x, z), z, a, () => {
    footing(M, w, d);
    if (!e) M.solid(-hw, -hd, hw, hd);
    if (kind === 0) {
      const rise = Math.min(d * 0.6, 4.4);   // (le case larghe non hanno un tetto alto il doppio: la falda si fa più dolce; lo stesso conto in layouts.ts)
      if (e) {   // guscio: tre muri e la facciata col vano dell'uscio (alto quanto serve a chi gioca); niente coperchi, dello zoccolo resta la risega
        const p = hw - 0.06, q = hd - 0.06, a = e.x - e.w / 2, b = e.x + e.w / 2;
        for (const s of [-1, 1]) {
          wallFace(M, "stone", s * hw, -hd, s * hw, hd, 0, 0.9, [s, 0, 0]); wallFace(M, "plaster", s * p, -q, s * p, q, 0.9, 2.7, [s, 0, 0]);
          M.face("stone", [[s * p, 0.9, -hd], [s * hw, 0.9, -hd], [s * hw, 0.9, hd], [s * p, 0.9, hd]], [0, 1, 0]);
          for (const [u0, u1] of s > 0 ? [[-p, a], [b, p]] : [[-p, p]]) M.face("stone", [[u0, 0.9, s * q], [u1, 0.9, s * q], [u1, 0.9, s * hd], [u0, 0.9, s * hd]], [0, 1, 0]);
          wallFace(M, "stone", e.x + s * e.w / 2, hd - LIP, e.x + s * e.w / 2, hd, 0, 0.9, [-s, 0, 0], { tint: DARK });   // l'imbotte, nello zoccolo
        }
        wallFace(M, "stone", -hw, -hd, hw, -hd, 0, 0.9, [0, 0, -1]); M.in(0, 0, -q, PI, () => M.wall("plaster", -p, 0.9, p, 2.7, [hole(-hw * 0.3, 1.25, 0.8, 0.7)], DEEP));
        wallFace(M, "stone", -hw, hd, a, hd, 0, 0.9, [0, 0, 1]); wallFace(M, "stone", b, hd, hw, hd, 0, 0.9, [0, 0, 1]);
        wallFace(M, "plaster", -p, q, a, q, 0.9, 2.7, [0, 0, 1]); M.in(0, 0, q, 0, () => M.wall("plaster", b, 0.9, p, 2.7, [hole(hw * 0.45, 1.25, 0.8, 0.7)], DEEP)); wallFace(M, "plaster", a, q, b, q, e.h, 2.7, [0, 0, 1]);
      } else {
        M.box("stone", -hw, 0, -hd, hw, 0.9, hd);
        M.box("plaster", -hw + 0.06, 0.9, -hd + 0.06, hw - 0.06, 2.7, hd - 0.06);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box("timber", sx * hw - 0.1, 0.9, sz * hd - 0.1, sx * hw + 0.1, 2.7, sz * hd + 0.1);
      M.in(0, 0, hd - 0.05, 0, () => {
        if (e) { M.box("timber", e.x - e.w / 2 - 0.1, e.h, 0, e.x + e.w / 2 + 0.1, e.h + 0.16, 0.1); M.box("stone", e.x - e.w / 2 - 0.2, 0, 0, e.x + e.w / 2 + 0.2, 0.12, 0.45, { tint: DARK }); }   // l'architrave e la soglia
        else door(M, -hw * 0.4, 1.0, 1.75);
        const k = lit();
        if (e) M.in(0, 0, -0.01, 0, () => see(() => sash(M, hw * 0.45, 1.25, 0.8, 0.7, k))); else win(M, hw * 0.45, 1.25, 0.8, 0.7, k);
      });
      if (e) M.in(0, 0, -hd + 0.06, PI, () => see(() => sash(M, -hw * 0.3, 1.25, 0.8, 0.7, "lume"))); else M.in(0, 0, -hd + 0.05, PI, () => win(M, -hw * 0.3, 1.25, 0.8, 0.7, "lume"));   // (sul retro: spenta, così `lit` non estrae un numero in più)
      M.in(0, 0, 0, PI / 2, () => {
        M.roof("thatch", hd, -hw, hw, 2.6, rise, 0.6);
        for (const s of [-1, 1]) M.face("plaster", [[-hd, 2.6, s * (hw - 0.06)], [hd, 2.6, s * (hw - 0.06)], [0, 2.6 + rise, s * (hw - 0.06)]], [0, 0, s]);
      });
      chimney(M, hw * 0.3, 2.6, -0.35, hw * 0.3 + 0.7, 2.6 + rise + 0.8, 0.35);
      return;
    }
    const h0 = kind === 2 ? 3.3 : 3, j = 0.35, fz = hd + j;
    const gh = kind === 2 ? [-1, 1].map((s) => [s * w * 0.33 - 0.45, 1.1, s * w * 0.33 + 0.45, 2.5, 1]) : e ? [hole(w * 0.2, 0.95, 1.7, 1.25)] : [];   // i vani delle finestre del piano terra
    if (e) {   // tre muri pieni e la facciata col vano dell'uscio; niente coperchio, che taglierebbe la sala
      for (const s of [-1, 1]) M.face("stone", [[s * hw, 0, -hd], [s * hw, 0, hd], [s * hw, h0, hd], [s * hw, h0, -hd]], [s, 0, 0]);
      M.face("stone", [[-hw, 0, -hd], [hw, 0, -hd], [hw, h0, -hd], [-hw, h0, -hd]], [0, 0, -1]);
      M.in(0, 0, hd, 0, () => portal(M, -hw, hw, h0, e, undefined, undefined, gh, DEEP));
    } else { M.box("stone", -hw, 0, -hd, hw, h0, hd, { noFront: true }); M.in(0, 0, hd, 0, () => M.wall("stone", -hw, 0, hw, h0, gh, DEEP)); }
    let y = h0;
    if (kind === 2) {   // piano nobile in pietra e intonaco
      if (e) ring(M, hw + 0.08, hd + 0.08, y, y + 0.22, 0.12);        // il marcapiano come cornice: dentro ci passa il solaio
      else M.box("stone", -hw - 0.08, y, -hd - 0.08, hw + 0.08, y + 0.22, hd + 0.08, { tint: DARK, under: true });
      M.box("plaster", -hw + 0.04, y + 0.22, -hd + 0.04, hw - 0.04, y + 3.2, hd - 0.04, { open: !!e, noFront: true, noSides: !!e });
      M.in(0, 0, hd - 0.04, 0, () => {   // (l'intonaco sta già 4 cm dentro la pietra: il vetro scende di altri 5)
        M.wall("plaster", -hw + 0.04, y + 0.22, hw - 0.04, y + 3.2, [-1, 0, 1].map((s) => [s * w * 0.3 - 0.5, y + 0.9, s * w * 0.3 + 0.5, y + 2.8, 1]), 0.05);
        for (const s of [-1, 0, 1]) see(() => win(M, s * w * 0.3, y + 0.9, 1, 1.9, lit(), true, 0.05));
      });
      if (e) {   // ci si entra: anche retro e fianchi hanno vani veri, alle stesse misure di quelli della pianta
        const vano = (x: number): number[] => [x - 0.5, y + 0.9, x + 0.5, y + 2.8, 1];
        M.in(0, 0, -hd + 0.04, PI, () => { M.wall("plaster", -hw + 0.04, y + 0.22, hw - 0.04, y + 3.2, [-1, 1].map((s) => vano(s * w * 0.25)), 0.05); for (const s of [-1, 1]) see(() => win(M, s * w * 0.25, y + 0.9, 1, 1.9, "lume", true, 0.05)); });
        for (const s of [-1, 1]) M.in(s * (hw - 0.04), 0, 0, s * PI / 2, () => { M.wall("plaster", -hd + 0.04, y + 0.22, hd - 0.04, y + 3.2, [vano(0)], 0.05); see(() => win(M, 0, y + 0.9, 1, 1.9, "lume", true, 0.05)); });
      } else {
        M.in(0, 0, -hd + 0.03, PI, () => { for (const s of [-1, 1]) win(M, s * w * 0.25, y + 0.9, 1, 1.9, "lume", true); });
        for (const s of [-1, 1]) M.in(s * (hw - 0.03), 0, 0, s * PI / 2, () => win(M, 0, y + 0.9, 1, 1.9, "lume", true));
      }
      y += 3.2;
    }
    // piano a graticcio, in aggetto sulla strada
    if (e && kind === 1) {   // dentro ci passa la scala: del solaio in aggetto restano i fianchi e, di sotto, solo ciò che sporge
      M.box("timber", -hw - 0.1, y, -hd, hw + 0.1, y + 0.25, fz + 0.05, { open: true });
      M.face("timber", [[-hw - 0.1, y, hd], [hw + 0.1, y, hd], [hw + 0.1, y, fz + 0.05], [-hw - 0.1, y, fz + 0.05]], [0, -1, 0]);
      for (const s of [-1, 1]) M.face("timber", [[s * hw, y, -hd], [s * (hw + 0.1), y, -hd], [s * (hw + 0.1), y, hd], [s * hw, y, hd]], [0, -1, 0]);
    } else M.box("timber", -hw - 0.1, y, -hd, hw + 0.1, y + 0.25, fz + 0.05, { under: true });
    const y1 = y + 0.25, y2 = y1 + 2.7;
    // le teste dei travetti che reggono lo sbalzo, e i cantonali di pietra del piano terra
    for (let i = 0, n = Math.round(w / 0.75); i <= n; i++) M.box("timber", -hw + i * w / n - 0.08, y - 0.02, fz - 0.1, -hw + i * w / n + 0.08, y + 0.17, fz + 0.24, { under: true });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) quoins(M, sx * hw, sz * hd, sx, sz, h0);
    const thruUp = !!e && kind === 1;
    SHUT = !!e && kind === 2;
    M.box("plaster", -hw - 0.05, y1, -hd, hw + 0.05, y2, fz, { noFront: true, noSides: thruUp });
    /** La finestra di mezzo di un fianco o del retro, lungo `len`. */
    const mezzo = (len: number): void => {
      if (!thruUp) { win(M, 0, y1 + 0.85, 0.95, 1.25, "lume"); return; }
      M.wall("plaster", -len / 2, y1, len / 2, y2, [hole(0, y1 + 0.85, 0.95, 1.25)], DEEP);
      see(() => sash(M, 0, y1 + 0.85, 0.95, 1.25, "lume"));
    };
    M.in(0, 0, fz, 0, () => {   // la facciata coi vani veri: le finestre stanno DENTRO il muro
      // (una facciata larga ha quattro finestre e il doppio delle campate; le due in più sono spente: `lit` estrae solo per le prime)
      const fx = w > 10 ? [-0.38, -0.19, 0.19, 0.38] : [-0.19, 0.19];
      M.wall("plaster", -hw - 0.05, y1, hw + 0.05, y2, fx.map((f) => hole(f * w, y1 + 0.85, 0.95, 1.25)), DEEP);
      frame(M, w + 0.1, y1, y2, (kind === 2 ? 5 : 4) * (w > 10 ? 2 : 1), fx.map((f) => [f * w, 0.95, y1 + 0.85, y1 + 2.1]));
      for (const s of [-1, 1]) { const k = lit(); if (kind === 1) see(() => sash(M, s * w * 0.19, y1 + 0.85, 0.95, 1.25, k)); else sash(M, s * w * 0.19, y1 + 0.85, 0.95, 1.25, k); }
      if (w > 10) for (const s of [-1, 1]) sash(M, s * w * 0.38, y1 + 0.85, 0.95, 1.25, "lume");
    });
    // (fianchi e retro: una finestra nella campata di mezzo, sempre spenta: `lit` non deve estrarre numeri in più)
    const mid = [[0, 0.95, y1 + 0.85, y1 + 2.1]];
    for (const s of [-1, 1]) M.in(s * (hw + 0.05), 0, j / 2, s * PI / 2, () => { frame(M, d + j, y1, y2, Math.round((d + j) / 2.7), mid); mezzo(d + j); });
    M.in(0, 0, -hd, PI, () => { frame(M, w + 0.1, y1, y2, Math.round(w / 2.3), mid); mezzo(w + 0.1); });
    SHUT = false;
    // piano terra: porta e bottega
    M.in(0, 0, hd, 0, () => {
      if (!e) door(M, kind === 2 ? 0 : -w * 0.24, kind === 2 ? 1.7 : 1.15, kind === 2 ? 2.5 : 2.1, true);
      if (kind === 2) for (const s of [-1, 1]) see(() => win(M, s * w * 0.33, 1.1, 0.9, 1.4, "lume", true, DEEP));
      else { if (e) see(() => sash(M, w * 0.2, 0.95, 1.7, 1.25, "lume", false)); else win(M, w * 0.2, 0.95, 1.7, 1.25, "lume"); M.box("wood", w * 0.2 - 1, 0.82, 0, w * 0.2 + 1, 0.9, 0.4); }
      if (inn) {   // l'insegna della locanda, su un braccio di ferro
        M.box("iron", hw * 0.62 - 0.03, 3.05, 0, hw * 0.62 + 0.03, 3.11, 1.25);
        M.box("wood", hw * 0.62 - 0.04, 2.25, 0.45, hw * 0.62 + 0.04, 2.95, 1.2);
        for (const s of [-1, 1]) M.box("cloth", hw * 0.62 + s * 0.045, 2.42, 0.66, hw * 0.62 + s * 0.05, 2.78, 1.0, { tint: OCRA });
        lantern(M, -hw * 0.62, 2.3, 0.5, "locanda"); M.box("iron", -hw * 0.62 - 0.02, 2.86, 0, -hw * 0.62 + 0.02, 2.9, 0.6);
      }
    });
    if (kind === 1) {   // timpano sulla strada
      const rise = Math.min(w * 0.66, 6.2);
      M.roof("slate", hw + 0.05, -hd, fz, y2, rise);
      M.face("plaster", [[-hw - 0.05, y2, fz], [hw + 0.05, y2, fz], [0, y2 + rise, fz]], [0, 0, 1]);
      M.face("plaster", [[-hw - 0.05, y2, -hd], [hw + 0.05, y2, -hd], [0, y2 + rise, -hd]], [0, 0, -1]);
      M.in(0, 0, fz, 0, () => {
        M.box("timber", -0.09, y2, 0, 0.09, y2 + rise - 0.25, 0.07); M.box("timber", -hw * 0.52, y2 + rise * 0.42, 0, hw * 0.52, y2 + rise * 0.42 + 0.16, 0.07);
        win(M, hw * 0.34, y2 + 0.5, 0.7, 0.9, lit());
      });
      chimney(M, -hw * 0.5, y2 + rise * 0.3, -hd + 0.6, -hw * 0.5 + 0.7, y2 + rise + 0.6, -hd + 1.3);
    } else {            // gronda sulla strada
      const rise = Math.min(d * 0.56, 6);
      M.in(0, 0, j / 2, PI / 2, () => {
        M.roof("slate", hd + j / 2, -hw - 0.05, hw + 0.05, y2, rise);
        for (const s of [-1, 1]) M.face("plaster", [[-hd - j / 2, y2, s * (hw + 0.05)], [hd + j / 2, y2, s * (hw + 0.05)], [0, y2 + rise, s * (hw + 0.05)]], [0, 0, s]);
      });
      for (const s of [-1, 1]) chimney(M, s * hw * 0.72 - 0.4, y2, -0.4, s * hw * 0.72 + 0.4, y2 + rise + 1.3, 0.4);
    }
  }, e ? 0 : lean, scale);   // dove si entra i pavimenti sono in piano: niente fuori piombo (ma il numero a caso si estrae lo stesso)
  return a;
}

/** Un numero stabile da un elemento che non ha ancora la sua `variant` (chi lo aggiunge a mano nel file): dal tipo e dal posto. */
const variantOf = (c: ChildDef): number => c.variant ?? [...`${c.prefab}${c.at[0]},${c.at[1]}`].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 11);

/**
 * Un oggetto teso fra due capi (festoni, panni: `SPANS` in db.ts), nel riferimento della città. Si popola in base alla
 * lunghezza: una bandierina ogni 55 cm, i panni finché c'è corda. La corda fa la pancia, più profonda se è più lunga, e i
 * capi possono stare a quote diverse.
 */
function span(M: Mason, c: ChildDef): void {
  // (le quote dei capi sono dal suolo sotto ciascun capo)
  const [ax, ay0, az] = c.from!, [bx, by0, bz] = c.to!, ay = ay0 + rise(M, ax, az), by = by0 + rise(M, bx, bz), len = Math.hypot(bx - ax, bz - az), sag = Math.min(0.9, 0.05 * len + 0.08);
  const yAt = (t: number): number => ay + (by - ay) * t - sag * (1 - (2 * t - 1) ** 2), cord = (x0: number, x1: number, t0: number, t1: number): void => {
    const y0 = yAt(t0), y1 = yAt(t1), my = (y0 + y1) / 2;
    M.box("timber", x0 - 0.01, my - 0.012, -0.012, x1 + 0.01, my + 0.012, 0.012, { rot: [0, 0, Math.atan2(y1 - y0, x1 - x0)], under: true });
  };
  M.in(ax, 0, az, Math.atan2(-(bz - az), bx - ax), () => {   // (lungo la sua x locale, da 0 a `len`)
    if (c.prefab === "festone") {
      const n = Math.max(1, Math.round(len / 0.55)), TINTS = [VINO, OCRA, LINO, MUSCHIO];
      for (let i = 0; i < n; i++) {
        const x0 = i / n * len, x1 = (i + 1) / n * len, top = (yAt(i / n) + yAt((i + 1) / n)) / 2;
        cord(x0, x1, i / n, (i + 1) / n);
        M.poly("cloth", [[x0 + 0.06, top, 0], [x1 - 0.06, top, 0], [(x0 + x1) / 2, top - 0.42, 0]], [0, 0, 1], { tint: TINTS[i % 4], wave: (p) => (top - p[1]) / 0.42 });
      }
      return;
    }
    // panni: la corda a tratti (fa la pancia), poi il bucato finché c'è posto, ognuno appeso dove la corda passa
    const steps = Math.max(2, Math.round(len / 0.5));
    for (let i = 0; i < steps; i++) cord(i / steps * len, (i + 1) / steps * len, i / steps, (i + 1) / steps);
    const PANNI: [number, number, Tint][] = [[0.9, 1.1, BIANCO], [0.5, 0.7, LINO], [1.1, 0.9, BIANCO], [0.45, 0.6, OCRA], [0.7, 1, LINO], [0.5, 0.55, VINO]];
    for (let i = 0, x = 0.4; ; i++) {
      const [w, h, tint] = PANNI[i % PANNI.length];
      if (x + w > len - 0.4) break;
      const top = yAt((x + w / 2) / len);
      drape(M, x, top - h, x + w, top, 0, tint); x += w + 0.25;
    }
  });
}

/** I piani calpestabili all'aperto (i ponti), nel mondo: li raccoglie `createTown`. */
const OPEN: Floor[] = [];
/**
 * Un ponte lungo una spezzata (`line` nel file: due punti o più, [x, quota, z] nel riferimento della città, la quota dal suolo
 * sotto il punto, come i capi dei festoni). L'impalcato va dalla quota del primo capo a quella dell'ultimo, salendo in
 * proporzione alla strada fatta (un punto di mezzo con una sua quota la impone: sopra l'acqua di solito non serve); a ogni
 * punto di mezzo una svolta, col suo raccordo tondo e una pila sotto. Fiancate col parapetto, pile fino all'alveo ogni 14 m, un arco fra un appoggio e l'altro,
 * e il piano su cui si cammina (`OPEN`). `ponte.botteghe` è più largo e ha le botteghe a sbalzo ai due lati: si cammina nel
 * mezzo. ponytail: i parapetti fermano a ogni quota (chi passa sotto un ponte alto ci sbatte).
 */
function bridge(M: Mason, c: ChildDef): void {
  const pts = c.line!.map(([x, , z]): [number, number] => [x, z]), shops = c.prefab === "ponte.botteghe", W = shops ? 10 : 5.4, hw = W / 2, lane = shops ? 2.6 : hw - 0.3;
  const S = [0];
  for (let i = 1; i < pts.length; i++) S.push(S[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  // le quote imposte: i capi sempre, i punti di mezzo solo se ne hanno una; fra l'una e l'altra in proporzione alla strada
  const fix = c.line!.map(([x, q, z], i) => (i === 0 || i === pts.length - 1 || q ? { s: S[i], y: rise(M, x, z) + q } : null)).filter((f): f is { s: number; y: number } => !!f);
  const deck = (s: number): number => {
    const k = Math.max(1, fix.findIndex((f) => f.s >= s)), a = fix[k - 1], b = fix[k];
    return a.y + (b.y - a.y) * (s - a.s) / Math.max(b.s - a.s, 1e-6);
  };
  for (let j = 1; j < pts.length - 1; j++) {   // le svolte: un raccordo tondo all'altezza dell'impalcato, e la pila sotto
    const [x, z] = pts[j], top = deck(S[j]), g = rise(M, x, z);
    M.drum("flag", x, z, hw, top - 0.05, top, {}, hw, 20);
    M.drum("stone", x, z, hw, top - 1.3, top - 0.05, { tint: DARK }, hw, 20);
    M.drum("stone", x, z, Math.min(hw, 2.2), g - 1, top - 1.3, { tint: DARK }, Math.min(hw, 2.2), 16);
    const P = M.world(x, top, z);
    OPEN.push({ x: P.x, z: P.z, hx: hw * 0.75, hz: hw * 0.75, yaw: 0, y: P.y, thick: 1.3, open: true });
  }
  for (let j = 0; j < pts.length - 1; j++) {
    const [ax, az] = pts[j], [bx, bz] = pts[j + 1], L = S[j + 1] - S[j], y = (x: number): number => deck(S[j] + x);
    const first = j === 0, last = j === pts.length - 2;
    M.in(ax, 0, az, Math.atan2(-(bz - az), bx - ax), () => {   // lungo la x locale, da 0 a L
      const n = Math.max(1, Math.ceil(L / 2));
      for (let i = 0; i < n; i++) {
        const x0 = i * L / n, x1 = (i + 1) * L / n, a = y(x0), b = y(x1);
        M.poly("flag", [[x0, a, -hw], [x1, b, -hw], [x1, b, hw], [x0, a, hw]], [0, 1, 0]);                     // il piano
        M.poly("stone", [[x0, a - 1.3, -hw], [x1, b - 1.3, -hw], [x1, b - 1.3, hw], [x0, a - 1.3, hw]], [0, -1, 0]);
        for (const s of [-1, 1]) {
          M.poly("stone", [[x0, a - 1.3, s * hw], [x1, b - 1.3, s * hw], [x1, b + 1.05, s * hw], [x0, a + 1.05, s * hw]], [0, 0, s]);   // la fiancata col parapetto
          M.poly("stone", [[x0, a + 1.05, s * (hw - 0.4)], [x1, b + 1.05, s * (hw - 0.4)], [x1, b + 1.05, s * hw], [x0, a + 1.05, s * hw]], [0, 1, 0]);
          M.poly("stone", [[x0, a, s * (hw - 0.4)], [x1, b, s * (hw - 0.4)], [x1, b + 1.05, s * (hw - 0.4)], [x0, a + 1.05, s * (hw - 0.4)]], [0, 0, -s]);
        }
      }
      // le pile, dal fondo fin sotto l'impalcato, e fra un appoggio e l'altro (le sponde, le svolte, le pile) un arco: le fette
      // di pietra fra la curva dell'intradosso e il piano. L'arco è alto quanto un terzo della luce, ma non scende sotto il fondo.
      const props = [0];
      for (let x = 14; x < L - 6; x += 14) {
        const g = rise(M, x, 0);
        if (g < y(x) - 3) { M.box("stone", x - 1.4, g - 1, -hw - 0.3, x + 1.4, y(x) - 1.3, hw + 0.3, { tint: DARK }); props.push(x); }
      }
      props.push(L);
      for (let k = 0; k < props.length - 1; k++) {
        const s0 = props[k] + (k || !first ? 1.4 : 0), s1 = props[k + 1] - (k < props.length - 2 || !last ? 1.4 : 0), span = s1 - s0, n = Math.max(4, Math.ceil(span / 0.6));
        if (span < 1) continue;
        for (let i = 0; i < n; i++) {
          const x0 = s0 + span * i / n, x1 = s0 + span * (i + 1) / n, xm = (x0 + x1) / 2, u = (xm - s0) / span, top = y(xm) - 1.3;
          const spring = Math.max(rise(M, xm, 0), top - Math.min(7, span * 0.42) - 0.5), arch = spring + (top - 0.5 - spring) * Math.sqrt(Math.max(0, 1 - (2 * u - 1) ** 2));
          if (arch < top - 0.05) M.box("stone", x0, arch, -hw, x1 + 0.01, top, hw, { tint: DARK, under: true });
        }
      }
      if (shops) {   // le botteghe ai due lati, a sbalzo oltre le fiancate: muro di intonaco, travi, una falda, il banco verso la via
        for (let x = 4; x + 5.6 < L - 4; x += 6.2) for (const s of [-1, 1]) {
          const a = y(x), b = y(x + 5.6), top = Math.max(a, b);
          M.in(x + 2.8, top, s * (hw - 0.6), s > 0 ? PI : 0, () => {   // (la facciata, +Z, guarda la via nel mezzo)
            M.box("timber", -2.8, -(top - Math.min(a, b)) - 1.6, -2.4, 2.8, 0, 1.4, { tint: DARK });                    // il ballatoio a sbalzo
            M.box("plaster", -2.7, 0, -2.3, 2.7, 3.4, -0.2);
            for (const e of [-2.7, 2.7]) M.box("timber", e - 0.12, 0, -0.3, e + 0.12, 3.4, 0.1);
            M.box("dark", -2.1, 0.9, -0.21, 2.1, 2.6, -0.19);                                                             // la bottega aperta
            M.box("wood", -2.2, 0.85, -0.2, 2.2, 0.95, 0.35);                                                             // il banco
            M.in(0, 3.4, -1.2, 0, () => M.hip("tile", 3.05, 1.55, 0, 1.3));
            M.solid(-2.7, -2.4, 2.7, -0.2);
          });
        }
      }
      // (i parapetti non arrivano ai capi del ponte: lì passa la via lungo la sponda)
      for (const s of [-1, 1]) M.line(first ? 1.5 : 0, s * (lane + 0.2), last ? L - 1.5 : L, s * (lane + 0.2), 0.2);
    });
    const P = M.world((ax + bx) / 2, (y(0) + y(L)) / 2, (az + bz) / 2);
    OPEN.push({ x: P.x, z: P.z, hx: shops ? hw : lane, hz: L / 2 + 0.4, yaw: Math.atan2(bx - ax, bz - az), y: P.y, rise: y(L) - y(0), thick: 1.3, open: true });
  }
}

/**
 * Una scalinata lungo una spezzata (`line` nel file: [x, quota, z], la quota dal suolo sotto il punto, come i capi dei
 * festoni; larga `size[0]`): una rampa di gradini fra un punto e l'altro e un pianerottolo a ogni punto di mezzo, quindi
 * anche le svolte strette (tornanti). `scala` non ha parapetti (fra le case: la
 * chiudono i muri, e un parapetto chiuderebbe gli usci); `scala.parapetto` li ha sui due lati di ogni rampa, di mattoni con
 * la copertina di pietra e un pilastro a ogni capo. I gradini
 * la dividono in alzate di 16 cm al più. Si cammina sulle rampe e sui pianerottoli (`OPEN`), non sul profilo dei gradini.
 */
function stairs(M: Mason, c: ChildDef): void {
  const pts = c.line!.map(([x, , z]): [number, number] => [x, z]), W = c.size?.[0] ?? 4.4, hw = W / 2, CAP = 1.0;
  const Y = c.line!.map(([x, q, z]) => rise(M, x, z) + q);   // (la quota di ogni punto: dal suolo, più la sua)
  const ground = (lx: number, lz: number, y: number, rise: number, hx: number, hz: number, yaw: number): void => {
    const P = M.world(lx, y, lz);
    OPEN.push({ x: P.x, z: P.z, hx, hz, yaw, y: P.y, rise, open: true });
  };
  for (let i = 1; i < pts.length - 1; i++) {   // i pianerottoli
    M.in(pts[i][0], Y[i], pts[i][1], 0, () => {
      M.box("brick", -hw, -0.8, -hw, hw, 0.02, hw);
      M.box("stone", -hw - 0.05, -0.06, -hw - 0.05, hw + 0.05, 0.03, hw + 0.05, { tint: DARK, under: true });
    });
    ground(pts[i][0], pts[i][1], Y[i], 0, hw, hw, 0);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], ya = Y[i], yb = Y[i + 1], L0 = Math.hypot(bx - ax, bz - az);
    const t0 = i ? hw : 0, t1 = i < pts.length - 2 ? hw : 0, L = L0 - t0 - t1;   // (la rampa va dal bordo di un pianerottolo all'altro)
    if (L < 0.4) continue;
    const dh = yb - ya, n = Math.max(1, Math.round(Math.abs(dh) / 0.16)), tread = L / n, bot = Math.min(ya, yb) - 0.6;
    const yaw = Math.atan2(-(bz - az), bx - ax), up = (x: number): number => ya + dh * (x - t0) / L;
    M.in(ax, 0, az, yaw, () => {   // lungo la x locale
      for (let k = 0; k < n; k++) {
        const x0 = t0 + k * tread, x1 = x0 + tread, top = ya + dh * (k + (dh > 0 ? 1 : 0)) / n;
        M.box("brick", x0, bot, -hw, x1 + 0.01, top, hw);
        const nose = dh > 0 ? x0 : x1 - 0.1;   // la pedata finisce con una lastra di pietra sul bordo dell'alzata
        M.box("stone", nose - 0.02, top - 0.07, -hw, nose + 0.1, top + 0.01, hw, { tint: DARK, under: true });
      }
      // i parapetti (solo `scala.parapetto`): ai due capi della scala cominciano due metri più in là, perché lì di solito si
      // incrocia un'altra via e chi ci arriva di sbieco non deve trovarli davanti
      const open0 = i === 0 && L > 5 ? 2 : 0, open1 = i === pts.length - 2 && L > 5 ? 2 : 0;
      const A = t0 + open0, B = t0 + L - open1;
      if (c.prefab === "scala.parapetto" && B - A > 0.6) for (const s of [-1, 1]) {
        const zi = s * hw, zo = s * (hw + 0.36);
        const wall = (a: number, b: number): void => {
          M.poly("brick", [[a, bot, zo], [b, bot, zo], [b, up(b) + CAP, zo], [a, up(a) + CAP, zo]], [0, 0, s]);
          M.poly("brick", [[a, up(a), zi], [b, up(b), zi], [b, up(b) + CAP, zi], [a, up(a) + CAP, zi]], [0, 0, -s]);
          M.poly("stone", [[a, up(a) + CAP, zi - s * 0.04], [b, up(b) + CAP, zi - s * 0.04], [b, up(b) + CAP + 0.08, zo + s * 0.04], [a, up(a) + CAP + 0.08, zo + s * 0.04]], [0, 1, 0]);
          for (const x of [a, b]) {
            M.box("brick", x - 0.3, bot, Math.min(zi, zo) - 0.06, x + 0.3, up(x) + CAP + 0.35, Math.max(zi, zo) + 0.06);
            M.box("stone", x - 0.36, up(x) + CAP + 0.35, Math.min(zi, zo) - 0.12, x + 0.36, up(x) + CAP + 0.47, Math.max(zi, zo) + 0.12, { tint: DARK, under: true });
          }
          M.line(a + 0.3, (zi + zo) / 2, b - 0.3, (zi + zo) / 2, 0.2);
        };
        wall(A, B);
      }
    });
    const mid = t0 + L / 2;
    const P = M.world(ax + (bx - ax) * mid / L0, 0, az + (bz - az) * mid / L0);
    OPEN.push({ x: P.x, z: P.z, hx: hw, hz: L / 2 + 0.05, yaw: Math.atan2(bx - ax, bz - az), y: P.y + (ya + yb) / 2, rise: dh, open: true });
  }
}

/** Il teatro coperto, all'italiana: la sala, il fondo curvo della platea, il tetto a padiglione, il portico sulla facciata (+Z). */
function theatre(M: Mason): void {
  footing(M, 26, 46);
  M.box("plaster", -12, 0, -16, 12, 18, 17);
  M.drum("plaster", 0, -16, 12, 0, 18, {}, 12, 24);
  M.box("stone", -12.3, 0, -16, 12.3, 1.2, 17.3, { tint: DARK });
  M.box("stone", -12.4, 17.6, -16, 12.4, 18.4, 17.4, { tint: DARK, under: true });
  M.in(0, 0, 0, 0, () => M.hip("slate", 12.6, 17.6, 18.4, 6.5));
  M.drum("slate", 0, -16, 12.6, 18.4, 22, {}, 4, 24);
  for (let i = -2; i <= 2; i++) {   // il portico: sei pilastri, la trabeazione, la falda
    M.box("stone", i * 4.6 - 0.5, 0, 17, i * 4.6 + 0.5, 7, 21);
  }
  M.box("stone", -12.2, 7, 17, 12.2, 8.2, 21.2, { tint: DARK });
  M.in(0, 8.2, 19.1, 0, () => M.hip("slate", 12.4, 2.3, 0, 1.4));
  M.in(0, 0, 17.02, 0, () => door(M, 0, 2.6, 4.4, true));
  for (const s of [-1, 1]) for (let j = 0; j < 4; j++) M.in(s * 12.02, 0, -10 + j * 7, s * PI / 2, () => door(M, 0, 1.6, 4.2, true));   // (finte: le finestre alte del fianco)
  M.solid(-12, -28, 12, 21);
}

export function createTown(scene: Scene, def: LocationDef, opts: { editor?: boolean } = {}): Town {
  OPEN.length = 0;
  // (ogni elemento del file estrae dal suo seme, `variant`; questo resta per ciò che non è un elemento: mura, porta, selciati)
  let rnd = mulberry32(0x70A1);
  // (un `let`: l'editor costruisce un elemento da solo, `build`, scambiando il muratore; i generatori leggono questo)
  let M = new Mason();
  const { hx, hz } = TOWN, rad = (deg: number): number => deg * PI / 180;
  flames.length = 0; LAMPS.length = 0;
  let posts = 0;   // i lampioni si chiamano `lampione.N` nell'ordine del file
  // (ogni finestra è un lume: accesa o spenta lo decide chi c'è dentro, non un numero a caso; il numero si estrae lo stesso)
  const lit = (): string => (rnd(), "lume");
  /** Gli edifici in cui si entra: quale interno, dove sta, come è girato, ingombro e seme della pianta. Si costruiscono dopo le mesh della città. */
  const sites: { id: string; kind: InteriorId; x: number; y: number; z: number; yaw: number; size: [number, number]; seed: number; scale: number }[] = [];
  /** I pezzi di rete degli abitanti che vengono dagli interni (nodi con quota, collegamenti, posti): il nodo 0 di ognuno sta in strada. */
  const plans: Pick<Built, "nodes" | "links" | "spots">[] = [];
  const enter = (c: ChildDef, yaw: number, size: [number, number]): void => { if (c.interior) sites.push({ id: c.id!, kind: c.interior, x: c.at[0], y: townGround(TOWN.x + c.at[0], TOWN.z + c.at[1]), z: c.at[1], yaw, size, seed: seedOf(c), scale: c.scale }); };
  /** Esegue `f` nel riferimento di una cosa posata. */
  const place = (c: ChildDef, f: () => void): void => M.in(c.at[0], rise(M, c.at[0], c.at[1]), c.at[1], rad(c.yaw), f, 0, c.scale);
  // le finestre accese di ogni casa con un nome: quali vertici della mesh dei lumi sono suoi (da, a), per accenderle e spegnerle (`windows`)
  const glow = new Map<string, { x: number; y: number; z: number }[]>();   // per edificio: dove cade sulla strada la luce delle sue finestre
  const thru = new Map<string, number[]>();   // per edificio: i vertici dei lumi che stanno dietro un vetro trasparente (da, a, da, a…)
  const homes = new Map<string, [number, number]>(), lumes = (): number => (M.geos.get("lume")?.c.length ?? 0) / 4;
  const casa = (kind: 0 | 1 | 2) => (c: ChildDef): void => enter(c, house(M, rnd, c.at[0], c.at[1], rad(c.yaw), c.size![0], c.size![1], kind, c.interior, c.scale), c.size!);
  const TELI: Record<string, Tint> = { vino: VINO, ocra: OCRA, muschio: MUSCHIO };
  const PAVING = { lastre: ["flag", 0.04], "lastre.diagonali": ["flag", 0.045], cubetti: ["sett", 0.05], ciottoli: ["cobble", 0.03] } as const;
  /** I generatori, uno per tipo (si riempie dentro il riferimento della città; `build` li riusa). */
  let PREFABS = {} as Record<PrefabId, (c: ChildDef) => void>;
  /** Posa i selciati (nel riferimento della città). */
  let layPaving: (list: LocationDef["paving"]) => void = () => {};

  M.in(TOWN.x, TOWN.y, TOWN.z, 0, () => {
    // ── selciati: ognuno a una quota appena diversa, così dove si sovrappongono non sfarfallano ──
    const pave = (k: string, x0: number, z0: number, x1: number, z1: number, y: number, diag = false): void => {
      const pts: V3[] = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
      M.poly(k, pts, [0, 1, 0], diag ? { uv: 2.2 } : {}, diag ? pts.map(([x, , z]) => [(x - z) * 0.707, 0, (x + z) * 0.707] as V3) : pts);
    };
    /** Un nastro di selciato lungo una spezzata, che segue il suolo: un pezzo per metro, i bordi a squadra con la mezzeria. */
    const ribbon = (k: string, line: [number, number][], hw: number, y: number): void => {
      const pts: [number, number][] = [];
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, az] = line[i], [bx, bz] = line[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az)));
        for (let j = i ? 1 : 0; j <= n; j++) pts.push([ax + (bx - ax) * j / n, az + (bz - az) * j / n]);
      }
      const side = pts.map(([x, z], i) => {
        const [px, pz] = pts[Math.max(0, i - 1)], [qx, qz] = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(qx - px, qz - pz) || 1;
        return [-(qz - pz) / l * hw, (qx - px) / l * hw] as [number, number];
      });
      // pieno fino all'88% della larghezza, poi l'ultima fascia scende 6 cm sotto il suolo: la terra copre il bordo a tratti.
      // E il bordo non è una riga: largo un po' di più o di meno a ogni metro (dalla posizione, non da `rnd`).
      // ⚠️ Non far scendere il nastro dal mezzo: si vedrebbe solo il terzo centrale (la via sembra stretta).
      const wob = (x: number, z: number, s: number): number => 1 + 0.12 * Math.sin(x * 1.7 + z * 2.3 + s * 4.1) * Math.sin(x * 0.61 - z * 0.83 + s);
      const ACROSS = [-1, -0.88, 0, 0.88, 1];
      const at = (i: number, s: number): V3 => {
        const edge = Math.abs(s) === 1, w = edge ? wob(pts[i][0], pts[i][1], s) * s : s, x = pts[i][0] + side[i][0] * w, z = pts[i][1] + side[i][1] * w;
        return [x, rise(M, x, z) + (edge ? -0.06 : y), z];
      };
      for (let i = 0; i < pts.length - 1; i++) for (let j = 0; j < ACROSS.length - 1; j++) {
        const s0 = ACROSS[j], s1 = ACROSS[j + 1];
        M.poly(k, [at(i, s0), at(i, s1), at(i + 1, s1), at(i + 1, s0)], [0, 1, 0]);
      }
    };
    layPaving = (list) => {
      const laid: Record<string, number> = {};
      for (const p of list) {
        const [[ax, az], [bx, bz]] = p.line, h = p.width / 2, [k, y] = PAVING[p.kind], n = laid[p.kind] = (laid[p.kind] ?? -1) + 1;
        if (p.line.length > 2 || (ax !== bx && az !== bz)) { ribbon(k, p.line, h, y + n * 0.002); continue; }
        // ogni striscia dello stesso selciato sta 2 mm sopra la precedente
        if (az === bz) pave(k, Math.min(ax, bx), az - h, Math.max(ax, bx), az + h, y + n * 0.002, p.kind === "lastre.diagonali");
        else pave(k, ax - h, Math.min(az, bz), ax + h, Math.max(az, bz), y + n * 0.002, p.kind === "lastre.diagonali");
      }
    };
    // (in modalità editor i selciati nelle loro mesh, `#selciati`: si rifanno da soli quando li si ridisegna)
    M.tag = opts.editor ? "#selciati" : ""; layPaving(def.paving); M.tag = "";

    // ── mura, torri d'angolo, porta ──
    const wall = (x0: number, z0: number, x1: number, z1: number, trim0 = 0, trim1 = 0): void => {
      const ew = z0 === z1, t = 0.8, n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / 2.4);
      const X0 = Math.min(x0, x1) - (ew ? 0 : t), Z0 = Math.min(z0, z1) - (ew ? t : 0), X1 = Math.max(x0, x1) + (ew ? 0 : t), Z1 = Math.max(z0, z1) + (ew ? t : 0), a = ew ? 0 : 0.16, b = ew ? 0.16 : 0;
      M.box("stone", X0, 0, Z0, X1, 8, Z1);
      M.box("stone", X0 - a, 0, Z0 - b, X1 + a, 1.1, Z1 + b, { tint: DARK });                       // lo zoccolo
      M.box("stone", X0 - a, 7.5, Z0 - b, X1 + a, 7.8, Z1 + b, { tint: DARK, under: true });        // il cordolo sotto i merli
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k, mx = ew ? 0.7 : t, mz = ew ? t : 0.7;
        M.box("stone", x - mx, 8, z - mz, x + mx, 9, z + mz);
        M.box("stone", x - mx - 0.06, 9, z - mz - 0.06, x + mx + 0.06, 9.14, z + mz + 0.06, { tint: DARK, under: true });   // la cimasa del merlo
      }
      const l = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / l, uz = (z1 - z0) / l;
      M.line(x0 + ux * trim0, z0 + uz * trim0, x1 - ux * trim1, z1 - uz * trim1, t);
    };
    // ⚠️ i cerchi delle mura fermano a ogni quota: dove toccano la porta, se dentro ci si sale, vanno tenuti fuori dalle sue torri
    const guard = def.gate?.interior ? def.gate : null, trim = guard ? 0.8 : 0, gk = def.gate?.scale ?? 1;   // (la porta ingrandita: le mura la raggiungono più in là)
    const gp = def.gate?.at ?? [-hx, 0], gy = rad(def.gate?.yaw ?? -90);
    /** Sull'acqua (le mura si aprono dove passa il fiume). */
    const wet = (x: number, z: number): boolean => !!def.river && townGround(TOWN.x + x, TOWN.z + z) < def.river.level + 0.6;
    if (def.walls) {
      // ── mura a poligono, che seguono il suolo: tratti di 8 m circa, ognuno alla quota del suo mezzo con lo zoccolo fino a terra ──
      const ring = def.walls, t = 0.8;
      /** Un tratto di mura da (ax, az) a (bx, bz), a pezzi di 8 m circa. */
      const run = (ax: number, az: number, bx: number, bz: number): void => {
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 8)), l = L / n, yaw = Math.atan2(-(bz - az), bx - ax);
        for (let k = 0; k < n && L > 0.5; k++) {
          const mx = ax + (bx - ax) * (k + 0.5) / n, mz = az + (bz - az) * (k + 0.5) / n;
          if (wet(mx, mz)) continue;
          M.in(mx, rise(M, mx, mz), mz, yaw, () => {
            const drop = Math.max(0, -rise(M, -l / 2, 0), -rise(M, l / 2, 0)), h = l / 2 + 0.05;
            M.box("stone", -h, -drop - 0.3, -t, h, 8, t);
            M.box("stone", -h, -drop - 0.3, -t - 0.16, h, 1.1, t + 0.16, { tint: DARK });                       // lo zoccolo
            M.box("stone", -h, 7.5, -t - 0.16, h, 7.8, t + 0.16, { tint: DARK, under: true });                 // il cordolo sotto i merli
            for (let j = 0, m = Math.max(1, Math.floor(l / 2.4)); j < m; j++) {
              const x = -l / 2 + l * (j + 0.5) / m;
              M.box("stone", x - 0.7, 8, -t, x + 0.7, 9, t);
              M.box("stone", x - 0.76, 9, -t - 0.06, x + 0.76, 9.14, t + 0.06, { tint: DARK, under: true });
            }
            M.line(-l / 2, 0, l / 2, 0, t);
          });
        }
      };
      const tower = 5 * gk + 0.4;   // (mezza larghezza della porta con le sue torri)
      ring.forEach(([ax, az], i) => {
        const [bx, bz] = ring[(i + 1) % ring.length], L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
        const t = (gp[0] - ax) * ux + (gp[1] - az) * uz, off = Math.abs((gp[0] - ax) * uz - (gp[1] - az) * ux);
        if (off < 3 && t > -tower && t < L + tower) {   // la porta sta su questo lato: le mura arrivano alle sue torri, da una parte e dall'altra
          if (t - tower > 0) run(ax, az, ax + ux * (t - tower), az + uz * (t - tower));
          if (t + tower < L) run(ax + ux * (t + tower), az + uz * (t + tower), bx, bz);
        } else run(ax, az, bx, bz);
        if (Math.hypot(ax - gp[0], az - gp[1]) < 8 * gk || wet(ax, az)) return;
        M.in(ax, rise(M, ax, az), az, 0, () => {   // la torre sullo spigolo
          footing(M, 5, 5);
          M.box("stone", -2.5, 0, -2.5, 2.5, 11, 2.5);
          for (const y of [0, 5.6, 10.6]) M.box("stone", -2.64, y, -2.64, 2.64, y + (y ? 0.32 : 1.3), 2.64, { tint: DARK, under: true });
          M.pyramid("slate", -2.9, -2.9, 2.9, 2.9, 11, 15.5);
          M.solid(-2.5, -2.5, 2.5, 2.5, 0.8);
        });
      });
    } else wall(-hx, -hz, -hx, -5 * gk, 0, trim), wall(-hx, 5 * gk, -hx, hz, trim, 0), wall(-hx, hz, hx, hz), wall(hx, hz, hx, -hz), wall(hx, -hz, -hx, -hz);
    if (!def.walls) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      M.box("stone", sx * hx - 2.5, 0, sz * hz - 2.5, sx * hx + 2.5, 11, sz * hz + 2.5);
      for (const y of [0, 5.6, 10.6]) M.box("stone", sx * hx - 2.64, y, sz * hz - 2.64, sx * hx + 2.64, y + (y ? 0.32 : 1.3), sz * hz + 2.64, { tint: DARK, under: true });   // zoccolo e marcapiani
      M.pyramid("slate", sx * hx - 2.9, sz * hz - 2.9, sx * hx + 2.9, sz * hz + 2.9, 11, 15.5);
      M.solid(sx * hx - 2.5, sz * hz - 2.5, sx * hx + 2.5, sz * hz + 2.5, 0.8);
    }
    if (guard) sites.push({ id: guard.id, kind: "porta", x: gp[0], y: townGround(TOWN.x + gp[0], TOWN.z + gp[1]), z: gp[1], yaw: gy + PI, size: [10, 5.2], seed: seedOf(guard), scale: gk });   // (la pianta guarda la città: mezzo giro rispetto alla porta)
    M.in(gp[0], rise(M, gp[0], gp[1]), gp[1], gy, () => {   // la porta: il fuori è a +Z
      for (const s of [-1, 1]) {
        const x0 = s * 3.6 - 1.4, x1 = s * 3.6 + 1.4, xi = s < 0 ? x1 : x0, xo = s < 0 ? x0 : x1;
        if (!guard) { M.box("stone", x0, 0, -2.6, x1, 14, 2.6); M.solid(x0, -2.6, x1, 2.6, 0.7); continue; }
        // col corpo di guardia: le facce verso il fornice salgono solo fino alla volta (sopra c'è la stanza); la torre sud (s = −1) ha l'usciolo verso la città e i muri dell'interno
        wallFace(M, "stone", xo, -2.6, xo, 2.6, 0, 14, [s, 0, 0]); wallFace(M, "stone", xi, -2.6, xi, 2.6, 0, 5, [-s, 0, 0]); wallFace(M, "stone", x0, 2.6, x1, 2.6, 0, 14, [0, 0, 1]);
        M.face("stone", [[x0, 14, -2.6], [x1, 14, -2.6], [x1, 14, 2.6], [x0, 14, 2.6]], [0, 1, 0]);
        // la torre nord resta piena, ma solo fino alla volta: sopra, dentro, c'è il corpo di guardia
        if (s > 0) { wallFace(M, "stone", x0, -2.6, x1, -2.6, 0, 14, [0, 0, -1]); for (const z of [-1.9, 0, 1.9]) M.seg(x0 + 0.7, z, x1 - 0.7, z, 0.7, -1, 5); }
        else M.in(0, 0, -2.6, PI, () => portal(M, 2.2, 5, 14, entry("porta", 0)));
      }
      if (guard) {   // il blocco sopra il fornice: senza i fianchi, che starebbero in mezzo alla stanza
        for (const f of [-1, 1]) wallFace(M, "stone", -2.2, f * 2.6, 2.2, f * 2.6, 5, 14, [0, 0, f]);
        for (const [yy, up] of [[5, -1], [14, 1]]) M.face("stone", [[-2.2, yy, -2.6], [2.2, yy, -2.6], [2.2, yy, 2.6], [-2.2, yy, 2.6]], [0, up, 0]);
      } else M.box("stone", -2.2, 5, -2.6, 2.2, 14, 2.6, { under: true });
      for (const s of [-1, 1]) for (const f of [-1, 1]) quoins(M, s * 5, f * 2.6, s, f, 12.4);                         // i cantonali delle torri
      for (let i = -3; i <= 3; i++) M.box("iron", i * 0.6 - 0.04, 3.9, 2.2, i * 0.6 + 0.04, 5, 2.3, { under: true });   // la saracinesca, a metà
      M.box("iron", -2.2, 4.4, 2.2, 2.2, 4.48, 2.3, { under: true });
      M.box("stone", -5.4, 12.4, -3, 5.4, 14.2, 3, { under: true, tint: DARK });                                         // caditoie
      for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) M.box("stone", i * 2.2 - 0.6, 14.2, s * 2.75 - 0.25, i * 2.2 + 0.6, 15.2, s * 2.75 + 0.25, { tint: DARK });
      M.in(0, 0, 0, 0, () => M.hip("slate", 5.8, 3.4, 15, 4.4));
      for (const f of [-1, 1]) M.in(0, 0, f * 2.61, f > 0 ? 0 : PI, () => {
        for (const s of [-1, 1]) { drape(M, s * 3.6 - 0.45, 6.6, s * 3.6 + 0.45, 11.4, 0.04, VINO, 0.5); M.box("iron", s * 3.6 - 0.55, 11.4, 0, s * 3.6 + 0.55, 11.46, 0.07, { under: true }); lantern(M, s * 2.75, 3.3, 0.3, "lampione.porta"); M.box("iron", s * 2.75 - 0.02, 3.86, 0, s * 2.75 + 0.02, 3.9, 0.4); }
        drape(M, -0.6, 6.4, 0.6, 7.9, 0.04, VINO, 0.3); M.disc("cloth", 0, 7.15, 0.3, 0.07, { tint: ORO, wave: (p) => (7.9 - p[1]) / 1.8 });
      });
    }, 0, gk);

    // ── il fiume: un nastro d'acqua alla sua quota, più largo dell'alveo (le sponde lo coprono) ──
    if (def.river) {
      const r = def.river, y = r.level - TOWN.y, hw = r.width / 2 + 4;
      for (let i = 0; i < r.line.length - 1; i++) {
        const [ax, az] = r.line[i], [bx, bz] = r.line[i + 1], l = Math.hypot(bx - ax, bz - az), nx = -(bz - az) / l * hw, nz = (bx - ax) / l * hw, ex = (bx - ax) / l * hw, ez = (bz - az) / l * hw;
        M.poly("acqua", [[ax - ex - nx, y, az - ez - nz], [ax - ex + nx, y, az - ez + nz], [bx + ex + nx, y, bz + ez + nz], [bx + ex - nx, y, bz + ez - nz]], [0, 1, 0]);
      }
    }

    // ── i generatori: una chiave del file, una funzione. Ognuno lavora nel riferimento della cosa (facciata a +Z) ──
    PREFABS = {
    "casa.povera": casa(0), "casa.graticcio": casa(1), "casa.ricca": casa(2),

    // cattedrale: la torre a destra di chi la guarda ha la guglia, l'altra non è mai stata finita
    cattedrale: (c) => place(c, () => {
      const L = 11.5, open = !!c.interior;
      enter(c, rad(c.yaw), [19, 29]);
      if (open) {   // guscio: la navata senza coperchio; dei muri di testa resta ciò che si vede da fuori (il resto è dietro torri, facciata e abside, e dentro lo fa l'interno)
        for (const s of [-1, 1]) {
          // il muro della navata coi vani delle quattro bifore (lungo il muro, x locale = s · (centro − z))
          const zc = (5.5 - L) / 2, vani = [0, 1, 2, 3].map((i) => s * (zc - (-L + 3.35 + i * 4.3))).sort((a, b) => a - b).map((x) => [x - 0.575, 3.4, x + 0.575, 8, 1]);
          M.in(s * 6.5, 0, zc, s * PI / 2, () => M.wall("stone", -(5.5 + L) / 2, 0, (5.5 + L) / 2, 11, vani, 0.3));
          wallFace(M, "stone", s * 4, -L, s * 6.5, -L, 0, 11, [0, 0, -1]); wallFace(M, "stone", s * 3.5, 5.5, s * 6.5, 5.5, 0, 11, [0, 0, 1]);
          M.in(s * 4, 0, -L - 1.5, s * PI / 2, () => M.wall("stone", -1.5, 0, 1.5, 8, [[-0.45, 2.4, 0.45, 6.6, 1]], 0.2));
        }
        wallFace(M, "stone", -4, -L, 4, -L, 8, 11, [0, 0, -1]); wallFace(M, "stone", -3.5, 5.5, 3.5, 5.5, 7.5, 11, [0, 0, 1]);
        M.in(0, 0, -L - 3, PI, () => M.wall("stone", -4, 0, 4, 8, [[-0.55, 2.4, 0.55, 6.8, 1]], 0.2)); M.face("stone", [[-4, 8, -L - 3], [4, 8, -L - 3], [4, 8, -L], [-4, 8, -L]], [0, 1, 0]);
      } else { M.box("stone", -6.5, 0, -L, 6.5, 11, 5.5); M.solid(-6.5, -L, 6.5, 5.5, 0.7); M.box("stone", -4, 0, -L - 3, 4, 8, -L); M.solid(-4, -L - 3, 4, -L, 0.7); }
      // l'abside: tre bifore, lo zoccolo, la cornice sotto il tetto, i contrafforti d'angolo
      M.in(0, 0, -L - 3.02, PI, () => { if (open) see(() => lancet(M, 0, 2.4, 1.1, 4.4, "lume", 0.24, 0.2)); else lancet(M, 0, 2.4, 1.1, 4.4, "lume"); for (const s of [-1, 1]) M.in(s * 3.4, 0, 0, 0, () => buttress(M, 6.2)); });
      for (const s of [-1, 1]) M.in(s * 4.02, 0, -L - 1.5, s * PI / 2, () => { if (open) see(() => lancet(M, 0, 2.4, 0.9, 4.2, "lume", 0.24, 0.2)); else lancet(M, 0, 2.4, 0.9, 4.2, "lume"); });
      M.box("stone", -4.14, 0, -L - 3.14, 4.14, 0.9, -L, { tint: DARK }); M.box(TRIM, -4.16, 7.7, -L - 3.16, 4.16, 8, -L, { tint: GOLA, under: true });
      M.roof("slate", 6.5, -L, 5.5, 11, 6, 0.5);
      M.face("stone", [[-6.5, 11, -L], [6.5, 11, -L], [0, 17, -L]], [0, 0, -1]);
      if (open) {   // il tetto dell'abside entra nel muro della navata: di quel che sta oltre il muro (dentro la navata) resta solo ciò che l'interno copre
        const q: V3[] = [[-4.3, 8, -L - 3.3], [4.3, 8, -L - 3.3], [4.3, 8, -L + 1.5], [-4.3, 8, -L + 1.5]], c: V3 = [0, 11.5, -L - 0.9], zc = -L + 0.45;
        for (let i = 0; i < 4; i++) {
          const a = q[i], b = q[(i + 1) % 4], tri = [a, b, c], cut: V3[] = [];
          tri.forEach((p, k) => { const n = tri[(k + 1) % 3]; if (p[2] <= zc) cut.push(p); if ((p[2] <= zc) !== (n[2] <= zc)) { const t = (zc - p[2]) / (n[2] - p[2]); cut.push([p[0] + (n[0] - p[0]) * t, p[1] + (n[1] - p[1]) * t, zc]); } });
          if (cut.length > 2) M.face("slate", cut, [(a[0] + b[0]) / 2 - c[0], 1, (a[2] + b[2]) / 2 - c[2]]);
        }
      } else M.pyramid("slate", -4.3, -L - 3.3, 4.3, -L + 1.5, 8, 11.5);   // abside
      for (let i = 0; i < 4; i++) for (const s of [-1, 1]) {
        const z = -L + 1.2 + i * 4.3;
        M.in(s * 6.5, 0, z, s * PI / 2, () => buttress(M, 8));                                   // contrafforti a riseghe, con la guglia
        M.in(s * 6.52, 0, z + 2.15, s * PI / 2, () => { if (open) see(() => lancet(M, 0, 3.4, 1.15, 4.6, "lume", 0.24, 0.3)); else lancet(M, 0, 3.4, 1.15, 4.6, "lume"); });    // le bifore della navata
      }
      for (const s of [-1, 1]) {   // s = +1 torre nord, −1 torre sud
        const top = s > 0 ? 20 : 17, cx = s * 6.5;
        M.box("stone", cx - 3, 0, 5.5, cx + 3, top, L); M.solid(cx - 3, 5.5, cx + 3, L, 0.7);
        for (const y of [7, 13.5, top]) M.box("stone", cx - 3.14, y, 5.36, cx + 3.14, y + (y === top ? 0.6 : 0.3), L + 0.14, { tint: DARK, under: true });
        // (ai piedi delle torri c'erano due portoncini che non portavano da nessuna parte: ora una bifora alta, come di sopra)
        M.in(cx, 0, L + 0.02, 0, () => { lancet(M, 0, 1.5, 1.5, 4.3, "glass", 0.3); lancet(M, 0, 8.2, 0.9, 3.8, "glass"); for (const q of [-1, 1]) lancet(M, q, top - 5.2, 1.1, 4.2, "dark"); });
        M.in(cx + s * 3.02, 0, 8.5, s * PI / 2, () => { lancet(M, 0, 8.2, 0.9, 3.8, "glass"); for (const q of [-1, 1]) lancet(M, q, top - 5.2, 1.1, 4.2, "dark"); });
        for (const q of [-1, 1]) quoins(M, cx + q * 3, L, q, 1, top);
        quoins(M, cx + s * 3, 5.5, s, -1, top);
        M.box("stone", cx - 3.12, 0, 5.38, cx + 3.12, 0.9, L + 0.12, { tint: DARK });   // lo zoccolo
      }
      M.pyramid("slate", 3.3, 5.3, 9.7, L + 0.2, 20.6, 33.5);
      for (const [px, pz] of [[3.6, 5.6], [9.4, 5.6], [3.6, L - 0.1], [9.4, L - 0.1]]) M.piece("guglia", px, 20.6, pz, { size: [2.1, 1.5, 2.1], as: TRIM, tint: LISCIA });
      M.box("iron", 6.47, 33.3, 8.47, 6.53, 34.3, 8.53); M.in(6.5, 0, 8.5, 0, () => M.disc("cloth", 0, 34.6, 0.34, 0, { tint: ORO }));
      // torre sud: tetto provvisorio di assi, ponteggio e argano
      M.pyramid("wood", -9.8, 5.2, -3.2, L + 0.3, 17.6, 20.2);
      for (const [px, pz, h] of [[-9.95, L + 0.25, 23], [-3.05, L + 0.25, 22], [-9.95, 5.05, 22.4]]) M.box("wood", px - 0.08, 14, pz - 0.08, px + 0.08, h, pz + 0.08);
      M.box("wood", -10.1, 21.2, L + 0.19, -2.9, 21.36, L + 0.31); M.box("wood", -10.01, 21.6, 4.9, -9.89, 21.76, L + 0.4);
      M.box("wood", -7.2, 21.3, L + 0.17, -7.04, 25.6, L + 0.33, { rot: [0.75, 0, 0] }); M.box("iron", -7.13, 20.2, L + 1.75, -7.11, 22.9, L + 1.77);
      // facciata fra le torri: portale, galleria di nicchie, rosone
      if (open) {   // senza la faccia di dietro, che starebbe in mezzo al nartece; davanti, il vano del portale
        for (const s of [-1, 1]) wallFace(M, "stone", s * 3.5, 9.4, s * 3.5, L - 0.3, 0, 14, [s, 0, 0]);
        M.face("stone", [[-3.5, 14, 9.4], [3.5, 14, 9.4], [3.5, 14, L - 0.3], [-3.5, 14, L - 0.3]], [0, 1, 0]);
        M.in(0, 0, L - 0.3, 0, () => portal(M, -3.5, 3.5, 14, entry("cattedrale", 0), [1.4, 1.2, 0.02], false));
      } else M.box("stone", -3.5, 0, 9.4, 3.5, 14, L - 0.3);
      M.face("stone", [[-3.5, 14, L - 0.3], [3.5, 14, L - 0.3], [0, 17.6, L - 0.3]], [0, 0, 1]);
      M.in(0, 0, L - 0.28, 0, () => {
        if (!open) { M.arch("stone", 0, 0, 4.6, 6.6, 0, { tint: DARK }); M.arch("wood", 0, 0, 3.2, 5.4, 0.05, { tint: DOOR }); }
        if (open) {   // il portale strombato: tre ghiere una davanti all'altra, ognuna sulle sue colonnine
          const e = entry("cattedrale", 0), sp = e.h - e.w * 0.75;
          for (let i = 0; i < 3; i++) archRing(M, TRIM, e.x, 0, e.w + i * 0.6, e.h + i * 0.45, 0.3, 0, 0.13 * (i + 1), { tint: i % 2 ? GOLA : LISCIA });
          for (const s of [-1, 1]) for (let i = 0; i < 3; i++) M.piece("colonnina", e.x + s * (e.w / 2 + 0.15 + i * 0.3), 0.45, 0.13 * (i + 1) + 0.1, { size: [1.5, sp - 0.45, 1.5], as: TRIM, tint: LISCIA });
        }
        // la galleria: sette nicchie fra otto colonnine, sulla sua cornice
        M.box(TRIM, -3.5, 6.6, 0, 3.5, 6.85, 0.36, { tint: GOLA, under: true });
        for (let i = -3; i <= 3; i++) { M.arch("dark", i * 0.92, 6.95, 0.6, 1.5, 0.015); archRing(M, TRIM, i * 0.92, 6.95, 0.6, 1.5, 0.14, 0, 0.2, { tint: LISCIA }); }
        for (let i = -4; i <= 3; i++) M.piece("colonnina", i * 0.92 + 0.46, 6.85, 0.25, { size: [1, 1.15, 1], as: TRIM, tint: LISCIA });
        // il rosone (kit, sul modello di quello ovest di Chartres): la vetrata dietro, il traforo di pietra davanti
        M.disc("lume", 0, 10.95, 2.15, 0.02, {}, 32);
        M.piece("rosone", 0, 10.95, 0.03, { size: [2.25, 2.25, 2.2], as: TRIM, tint: LISCIA });
        M.disc("glass", 0, 15.2, 0.5, 0.02, {}, 12); M.piece("rosone", 0, 15.2, 0.03, { size: [0.62, 0.62, 1], as: TRIM, tint: LISCIA });
      });
      for (let i = 0; i < 5; i++) M.box("stone", -3.4 - i * 0.18, 0, L - 0.3, 3.4 + i * 0.18, 0.45 - i * 0.09, L + 0.4 + i * 0.36, { tint: DARK });   // (cinque gradini bassi: ingranditi restano da salire; gli stessi in layouts.ts)
    }),

    // municipio: portico, balcone con lo stendardo, torre dell'orologio
    municipio: (c) => place(c, () => {
      const open = !!c.interior;
      enter(c, rad(c.yaw), [22, 11]);
      if (open) {   // guscio: tre muri, la facciata col vano del portone nell'arco di mezzo, il marcapiano come cornice (dentro ci passano il solaio e la scala)
        for (const s of [-1, 1]) wallFace(M, "stone", s * 11, -5.5, s * 11, 5.5, 0, 4.4, [s, 0, 0]);
        wallFace(M, "stone", -11, -5.5, 11, -5.5, 0, 4.4, [0, 0, -1]);
        // ai lati del portone c'erano quattro archi neri dipinti sul muro: ora sono le finestre della sala, in vani veri
        const gx = [-8.9, -5.9, 5.9, 8.9], gm = gx.map((x) => [x - 0.9, 0.9, x + 0.9, 3.9, 1]);
        M.in(0, 0, 5.5, 0, () => { portal(M, -11, 11, 4.4, entry("municipio", 0), [0.7, 0.4, 0.02], true, gm, 0.18); for (const x of gx) see(() => win(M, x, 0.9, 1.8, 3, "lume", true, 0.18)); });
        ring(M, 11.15, 5.65, 4.3, 4.6, 0.6);
      } else { M.box("stone", -11, 0, -5.5, 11, 4.4, 5.5); M.solid(-11, -5.5, 11, 5.5, 0.7); M.box("stone", -11.15, 4.3, -5.65, 11.15, 4.6, 5.65, { tint: DARK, under: true }); }
      M.box("plaster", -10.9, 4.4, -5.4, 10.9, 9.2, 5.4, { noFront: true });
      M.in(0, 0, 5.4, 0, () => {   // la facciata del piano nobile coi vani veri delle cinque finestre
        const ws = [-2, -1, 0, 1, 2].map((i) => (i ? [i * 4.2, 5.6, 1.3, 2.7] : [0, 5.1, 1.5, 3.3]));
        M.wall("plaster", -10.9, 4.4, 10.9, 9.2, ws.map(([x, y, w, h]) => [x - w / 2, y, x + w / 2, y + h, 1]), DEEP);
        for (const i of [0, 1, 3, 4, 2]) see(() => win(M, ws[i][0], ws[i][1], ws[i][2], ws[i][3], i === 2 ? "lume" : lit(), true, DEEP));   // (l'ordine di prima: `lit` estrae)
      });
      M.box("timber", -11.25, 9.2, -5.75, 11.25, 9.5, 5.75, { under: true });
      M.in(0, 0, 0, 0, () => M.hip("tile", 11.6, 6.1, 9.5, 4.8));
      M.in(0, 0, 5.52, 0, () => {
        if (!open) for (let i = -2; i <= 2; i++) { M.arch("stone", i * 4.2, 0, 3.5, 4.1, 0, { tint: DARK }); M.arch("dark", i * 4.2, 0, 2.8, 3.7, 0.04); }
        M.box("stone", -2.4, 4.6, 0, 2.4, 4.85, 1.1, { tint: DARK, under: true });
        for (const s of [-1, 1]) { M.box("stone", s * 2.33 - 0.07, 4.85, 0, s * 2.33 + 0.07, 5.75, 1.1); M.box("stone", s * 1.2 - 0.12, 4.2, 0, s * 1.2 + 0.12, 4.6, 0.9, { tint: DARK, under: true }); }   // i fianchi, le mensole
        M.box("stone", -2.4, 5.6, 0.93, 2.4, 5.75, 1.13, { tint: DARK, under: true });                                                                         // la balaustra: colonnini (kit) sotto la cimasa
        for (let i = -7; i <= 7; i++) M.piece("colonnino", i * 0.3, 4.85, 1.03, { size: [2.4, 0.75 / 0.85, 2.4], as: TRIM, tint: LISCIA });
        for (let i = -18; i <= 18; i++) M.box("timber", i * 0.6 - 0.07, 8.95, -0.12, i * 0.6 + 0.07, 9.2, 0.2, { under: true });                                // le mensole della gronda
        drape(M, -0.75, 1.9, 0.75, 4.85, 1.13, VINO, 0.5); M.disc("cloth", 0, 3.6, 0.38, 1.17, { tint: ORO, wave: (p) => (4.85 - p[1]) / 3.45 });
        for (const s of [-1, 1]) { drape(M, s * 6.3 - 0.55, 5.3, s * 6.3 + 0.55, 8.8, -0.06, s > 0 ? OCRA : VINO, 0.45); M.box("iron", s * 6.3 - 0.65, 8.8, -0.12, s * 6.3 + 0.65, 8.86, 0, { under: true }); }   // due drappi lunghi fra le finestre
      });
      M.box("stone", -2.3, 9.2, 0.6, 2.3, 20, 5.2);
      M.in(0, 0, 5.22, 0, () => {
        // l'orologio: la mostra di pietra, il quadrante, le dodici tacche, le due lancette che partono dal perno
        M.disc(TRIM, 0, 15, 1.42, 0.005, { tint: GOLA }, 24); M.disc("cloth", 0, 15, 1.15, 0.03, { tint: BIANCO }, 24);
        const hand = (a: number, r0: number, r1: number, hw: number, z: number): void => M.box("iron", Math.sin(a) * (r0 + r1) / 2 - hw, 15 + Math.cos(a) * (r0 + r1) / 2 - (r1 - r0) / 2, z, Math.sin(a) * (r0 + r1) / 2 + hw, 15 + Math.cos(a) * (r0 + r1) / 2 + (r1 - r0) / 2, z + 0.02, { rot: [0, 0, -a] });
        for (let i = 0; i < 12; i++) hand(i * PI / 6, 0.88, 1.08, i % 3 ? 0.022 : 0.04, 0.035);
        hand(0.7, -0.12, 0.92, 0.03, 0.06); hand(-1.9, -0.1, 0.6, 0.04, 0.045); M.disc("iron", 0, 15, 0.08, 0.085, {}, 8);
        for (const q of [-1, 1]) { lancet(M, q * 0.9, 16.9, 0.9, 2.5, "dark", 0.2); quoins(M, q * 2.3, -0.02, q, 1, 20); }
      });
      M.box("stone", -2.55, 20, 0.35, 2.55, 20.5, 5.45, { tint: DARK, under: true });
      M.pyramid("slate", -2.6, 0.3, 2.6, 5.5, 20.5, 25.8);
      for (const sx of [-1, 1]) for (const z of [0.55, 5.25]) M.piece("guglia", sx * 2.35, 20.5, z, { size: [1.5, 1.5, 1.5], as: TRIM, tint: LISCIA });
    }),

    // fucina: una tettoia aperta sulla via, con la forgia accesa e l'incudine
    fucina: (c) => place(c, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box("timber", sx * 3.1 - 0.1, 0, sz * 2.6 - 0.1, sx * 3.1 + 0.1, 2.8, sz * 2.6 + 0.1);
      M.box("stone", -3.2, 0, -2.9, 3.2, 2.8, -2.4); M.solid(-3.2, -2.9, 3.2, -2.4, 0.3);
      M.in(0, 0, 0, PI / 2, () => M.roof("slate", 2.9, -3.3, 3.3, 2.8, 1.9, 0.5));
      M.box("stone", -2.9, 0, -2.4, -1.3, 1.5, -1); M.box("stone", -2.5, 1.5, -2.4, -1.7, 5.4, -1.6, { tint: DARK });
      // il focolare della forgia: un bordo di pietra sul piano, dentro il letto di braci e sopra un fuoco solo (flames.ts)
      for (const [x0, z0, x1, z1] of [[-2.9, -1.12, -1.3, -1], [-2.9, -1.6, -2.76, -1.12], [-1.44, -1.6, -1.3, -1.12]]) M.box("stone", x0, 1.5, z0, x1, 1.64, z1, { tint: DARK });
      embers(M.world(-2.1, 1.5, -1.34), 0.56); fire(M.world(-2.1, 1.56, -1.36), 0.95, 0.8, 1);
      flames.push(M.world(-2.1, 2.2, 0.2));   // il riverbero della forgia sotto la tettoia (alla quota delle lanterne: la luce cotta ne ha una sola)
      M.solid(-2.9, -2.4, -1.3, -1, 0.35);
      M.drum("wood", 0.2, 1.3, 0.26, 0, 0.5); M.piece("incudine", 0.2, 0.5, 1.3, { size: [1.5, 1.5, 1.5] }); M.line(0.2, 1.3, 0.2, 1.3, 0.35);
      barrel(M, 2.5, -1.7);
      // "si entra" in una tettoia aperta: gli attrezzi del fabbro e i posti, all'aperto e nei materiali della città (il seme non è quello della città)
      if (c.interior) plans.push(furnish(scene, M, layout("fucina", 0, 0, mulberry32(seedOf(c))), c.id!));
    }),

    pozzo: (c) => place(c, () => {
      // vera di pietra a tre corsi con la cimasa che sporge, il buio dentro; due montanti con le saette, l'argano col suo
      // rullo e la manovella, la corda, il secchio di doghe
      M.piece("vera", 0, 0, 0, { as: TRIM, tint: LISCIA });   // la vera tornita, cava (kit); in fondo il buio
      M.drum("dark", 0, 0, 0.73, 0.3, 0.305, {}, 0.73, 14);
      for (const s of [-1, 1]) {
        M.box("timber", s * 0.86 - 0.075, 0.9, -0.075, s * 0.86 + 0.075, 2.4, 0.075);
        M.box("timber", s * 0.62 - 0.05, 1.85, -0.05, s * 0.62 + 0.05, 2.45, 0.05, { rot: [0, 0, s * 0.75] });
      }
      M.box("timber", -1.0, 2.3, -0.08, 1.0, 2.42, 0.08);
      M.in(0, 1.78, 0, 0, () => { for (let i = 0; i < 8; i++) M.box("wood", -0.72, -0.05, -0.1, 0.72, 0.05, 0.1, { rot: [i * PI / 8, 0, 0] }); });
      M.box("iron", -0.98, 1.76, -0.02, 0.98, 1.8, 0.02); M.box("iron", 0.98, 1.5, -0.02, 1.02, 1.8, 0.02); M.box("iron", 0.98, 1.48, -0.02, 1.2, 1.52, 0.02);
      M.box("cloth", -0.015, 1.24, 0.09, 0.015, 1.72, 0.12, { tint: LINO });
      prop("wooden_bucket_01", M.world(0, 0.96, 0.105), 0.6, { h: 0.3 });   // il secchio appeso (modello)
      { const q = M.world(1.25, 0, 0.5); prop("wooden_bucket_01", q, turn(q), { h: 0.34 }); }
      M.roof("slate", 1.2, -0.6, 0.6, 2.4, 0.75, 0.1);
      M.line(0, 0, 0, 0, 1.0);
    }),
    fontana: (c) => place(c, () => {
      // vasca a sedici lati su un gradino, con lo zoccolo e l'orlo che sporgono; dentro l'acqua; al centro il fusto a nodi,
      // il catino, la seconda colonna e la pigna
      M.piece("fontana", 0, 0, 0, { as: TRIM, tint: LISCIA });   // tutta la pietra, tornita (kit); l'acqua nella vasca e nel catino
      M.drum("glass", 0, 0, 2.06, 0.7, 0.72, {}, 2.06, 32); M.drum("glass", 0, 0, 0.97, 1.79, 1.8, {}, 0.97, 32);
      M.line(0, 0, 0, 0, 2.3);
    }),
    // banco del mercato: il telo a strisce (`tint` e lino), la merce a mucchietti
    banco: (c) => place(c, () => {
      const a = TELI[c.tint ?? "vino"], b = LINO, sx = Math.round(c.at[0]);
      // il piano di tre tavole su due cavalletti, la fascia davanti; quattro pali con le traverse che reggono il telo; il telo
      // a strisce fa una pancia nel mezzo e scende davanti in una balza a punte
      M.piece("bancarella", 0, 0, 0);   // tutto il legno (kit)
      for (let i = 0; i < 6; i++) {
        const x0 = -1.65 + i * 0.55, x1 = x0 + 0.55, tint = i % 2 ? a : b;
        for (let j = 0; j < 4; j++) {
          const u0 = j / 4, u1 = (j + 1) / 4, sag = (u: number): number => 2.42 - 0.44 * u - 0.09 * Math.sin(u * PI);
          M.face("cloth", [[x0, sag(u0), -0.7 + 1.65 * u0], [x1, sag(u0), -0.7 + 1.65 * u0], [x1, sag(u1), -0.7 + 1.65 * u1], [x0, sag(u1), -0.7 + 1.65 * u1]], [0, 1, 0], { tint, wave: () => 0.3 });
        }
        M.face("cloth", [[x0, 1.98, 0.95], [x1, 1.98, 0.95], [(x0 + x1) / 2, 1.74, 0.97]], [0, 0, 1], { tint, wave: (p) => (p[1] < 1.9 ? 1 : 0.3) });
      }
      // la merce: ceste, brocche, ciotole e paioli veri sul piano (modelli); ⚠️ `rnd` si estrae lo stesso, cinque volte: il resto della città ne dipende
      const WARES = ["wicker_basket_01", "jug_01", "wooden_bowl_01", "brass_pot_01", "wicker_basket_01"] as const, WIDE = [0.42, 0.26, 0.3, 0.3, 0.36];
      for (let i = 0; i < 5; i++) {
        rnd();
        const k = ((i + sx + 16) % 5 + 5) % 5, p = M.world(-1.1 + i * 0.55, 0.86, (k % 2 ? 0.12 : -0.1));
        prop(WARES[k], p, turn(p), { w: WIDE[k] });
        if (k % 2 === 0) { const q = M.world(-1.1 + i * 0.55 + 0.05, 0.86, 0.3); prop(WARES[(k + 2) % 5], q, turn(q), { w: WIDE[(k + 2) % 5] * 0.8 }); }
      }
      M.solid(-1.5, -0.5, 1.5, 0.55, 0.4);
    }),
    panchina: (c) => place(c, () => {
      // sedile di tre assi, fianchi sagomati con i piedi e il bracciolo, schienale di due assi inclinato
      M.piece("panchina", 0, 0, 0);   // (kit)
    }),
    "panca.pietra": (c) => place(c, () => { M.box("stone", -0.7, 0.34, -0.22, 0.7, 0.46, 0.22, { under: true }); for (const s of [-1, 1]) M.box("stone", s * 0.5 - 0.12, 0, -0.2, s * 0.5 + 0.12, 0.34, 0.2, { tint: DARK }); }),

    lampione: (c) => lamppost(M, c.at[0], c.at[1], `lampione.${posts++}`),
    botte: (c) => place(c, () => barrel(M, 0, 0)),
    cassa: (c) => place(c, () => {   // cassa di tavole: i listelli agli spigoli e in croce sui fianchi, il coperchio che sporge
      // una cassa vera (modello): le grandi sono casse lunghe, le piccole cassette basse
      const s = c.size![0] / 2, p = M.world(0, 0, 0);
      prop(s > 0.29 ? "wooden_crate_02" : "wooden_crate_01", p, turn(p), { w: s * 2.6 });
      M.line(0, 0, 0, 0, s * 1.2);
    }),
    carretto: (c) => place(c, () => {   // carretto a mano
      M.box("wood", -0.75, 0.55, -0.5, 0.75, 0.63, 0.5, { under: true });
      for (const s of [-1, 1]) {
        M.box("wood", -0.75, 0.63, s * 0.5 - 0.03, 0.75, 0.98, s * 0.5 + 0.03); M.box("timber", -1.75, 0.6, s * 0.44 - 0.03, -0.75, 0.66, s * 0.44 + 0.03, { rot: [0, 0, 0.12] });
        // la ruota: il cerchione a dodici pezzi col ferro attorno, otto raggi, il mozzo
        M.in(0.15, 0.42, s * 0.57, 0, () => {
          M.piece("ruota", 0, 0, 0);   // (kit)
        });
      }
      M.box("timber", 0.12, 0.39, -0.6, 0.18, 0.45, 0.6);
      for (const px of [-0.7, 0.7]) M.box("wood", px - 0.03, 0.63, -0.5, px + 0.03, 0.98, 0.5);
      M.box("cloth", -0.6, 0.63, -0.42, 0.6, 1.05, 0.42, { tint: LINO });
      M.solid(-0.75, -0.5, 0.75, 0.5, 0.4);
    }),
    bacheca: (c) => place(c, () => {   // bacheca degli avvisi
      M.piece("bacheca", 0, 0, 0); M.roof("slate", 0.78, -0.12, 0.12, 1.95, 0.3, 0.02);   // pali e tavolato (kit)
      M.box("cloth", -0.5, 1.15, 0.03, -0.14, 1.62, 0.04, { tint: LINO }); M.box("cloth", -0.06, 1.25, 0.03, 0.26, 1.6, 0.04, { tint: BIANCO }); M.box("cloth", 0.3, 0.98, 0.03, 0.56, 1.45, 0.04, { tint: LINO, rot: [0, 0, 0.1] });
      M.line(-0.6, 0, 0.6, 0, 0.2);
    }),
    // festone e panni: tesi fra due capi (`span`)
    festone: (c) => span(M, c),
    // stendardo: un'asta su uno zoccolo di pietra, la traversa, il drappo con lo stemma
    stendardo: (c) => place(c, () => {
      M.box("stone", -0.22, 0, -0.22, 0.22, 0.2, 0.22, { tint: DARK }); M.box("timber", -0.045, 0.2, -0.045, 0.045, 4.4, 0.045); M.box("timber", -0.6, 4.1, -0.03, 0.6, 4.16, 0.03, { under: true });
      M.pyramid("iron", -0.07, -0.07, 0.07, 0.07, 4.4, 4.62);
      drape(M, -0.5, 1.9, 0.5, 4.1, 0.035, TELI[c.tint ?? "vino"], 0.4); M.disc("cloth", 0, 3.3, 0.24, 0.045, { tint: ORO, wave: (p) => (4.1 - p[1]) / 2.6 }, 12);
      M.line(0, 0, 0, 0, 0.25);
    }),
    // insegna di bottega: l'origine è sul muro, +Z in fuori; un braccio di ferro con la saetta, la tavola appesa a due anelli, lo stemma sulle due facce
    insegna: (c) => place(c, () => {
      M.box("iron", -0.025, 3.42, 0, 0.025, 3.47, 1.15, { under: true }); M.box("iron", -0.02, 2.95, 0, 0.02, 3.42, 0.04);
      M.box("iron", -0.012, 3.17, 0.02, 0.012, 3.2, 0.62, { rot: [-0.62, 0, 0], under: true });
      for (const z of [0.5, 1]) M.box("iron", -0.008, 3.2, z - 0.008, 0.008, 3.42, z + 0.008);
      M.box("wood", -0.035, 2.66, 0.36, 0.035, 3.2, 1.14, { tint: DOOR, under: true });
      for (const s of [-1, 1]) M.in(s * 0.04, 0, 0.75, s * PI / 2, () => M.disc("cloth", 0, 2.93, 0.19, 0, { tint: TELI[c.tint ?? "ocra"] }, 10));
    }),
    panni: (c) => span(M, c),
    ponte: (c) => bridge(M, c),
    "ponte.botteghe": (c) => bridge(M, c),
    scala: (c) => stairs(M, c),
    "scala.parapetto": (c) => stairs(M, c),
    teatro: (c) => place(c, () => theatre(M)),
    // orto: quattro file di cavoli, dall'angolo in poi verso est e nord
    orto: (c) => place(c, () => { for (let i = 0; i < 4; i++) for (let j = 0; j < 9; j++) M.box("cloth", j * 0.8, 0, i * 0.85, 0.3 + j * 0.8, 0.14 + rnd() * 0.16, 0.3 + i * 0.85, { tint: MUSCHIO }); }),
    // lapidi: due file da cinque, un po' storte
    lapidi: (c) => place(c, () => {
      for (let i = 0; i < 10; i++) {
        const gx = (i % 5) * 2.6 + rnd() * 0.8, gz = -Math.floor(i / 5) * 4.2 + rnd() * 0.8;
        M.in(gx, 0, gz, (rnd() - 0.5) * 0.4, () => M.box("stone", -0.3, 0, -0.07, 0.3, 0.75 + rnd() * 0.4, 0.07, { tint: DARK }), (rnd() - 0.5) * 0.2);
      }
    }),
    };
    // ogni cosa con un nome è un gruppo: le sue fiamme e il suo fumo si accendono e si spengono insieme (flames.ts), le sue finestre pure
    const shared = rnd;
    def.children.forEach((c, i) => {
      const from = lumes();
      THRU = c.id && c.interior ? [] : null; GLOW = [];
      // (in modalità editor ogni elemento nelle SUE mesh, `#i`, così si sposta da solo; altrimenti l'arredo di strada a parte, `+`)
      M.tag = opts.editor ? `#${i}` : FURNITURE.has(c.prefab) ? "+" : "";
      rnd = mulberry32(variantOf(c)); propOwner(i);
      group(c.id ?? "", () => PREFABS[c.prefab](c));
      M.tag = "";
      if (c.id && lumes() > from) homes.set(c.id, [from, lumes()]);
      if (THRU?.length) { thru.set(c.id!, THRU); glow.set(c.id!, GLOW); }
      THRU = null;
    });
    rnd = shared; propOwner(-1);
  });

  // ── materiali e mesh ──
  setMossGround(scene, reliefGrid(), TOWN.y);   // (il muschio al piede dei muri, sul suolo vero: prima dei materiali)
  const surf = (name: string, tex: ReturnType<typeof masonryTex>, tint?: Color3, rough?: number, relief?: number, moss?: number): Material => {
    const m = surfaceMaterial(scene, `town_${name}`, tex, { tint, rough, relief, moss: moss ? { y: TOWN.y, k: moss } : undefined });
    // col cel shading: la texture dipinta al posto della foto (colore e normali; la mappa di occlusione e ruvidezza della foto non c'entra più)
    const kind = ({ stone: "stone", plaster: "plaster", timber: "wood", wood: "wood", slate: "slate", tile: "tile", flag: "flag", sett: "sett", cobble: "cobble", brick: "brick" } as Record<string, Painted>)[name];
    if (kind) {
      const photo = { a: m.albedoTexture, n: m.bumpTexture, arm: m.metallicTexture, met: m.metallic, r: m.roughness };
      onPainted((on) => {
        const t = on ? paintedTex(scene, kind) : null;
        m.albedoTexture = t ? t.albedo : photo.a; m.bumpTexture = t ? t.normal : photo.n;
        m.metallicTexture = t ? null : photo.arm; m.metallic = t ? 0 : photo.met; m.roughness = t ? 0.9 : photo.r;
      });
    }
    if (name === "cloth") addFlutter(m);   // drappi, bandierine e teli si muovono al vento
    m.backFaceCulling = false;   // le normali guardano fuori: falde e teloni si vedono anche da sotto
    return m;
  };
  const flat = (name: string, diffuse: Color3, emissive: Color3): Material => {
    const m = new StandardMaterial(`town_${name}`, scene);
    m.diffuseColor = diffuse; m.emissiveColor = emissive; m.specularColor = Color3.Black(); m.backFaceCulling = false;
    return m;
  };
  const mats: Record<string, Material> = {
    // texture fotografiche (CC0, Poly Haven: `photoTex`); le tinte le riportano al tono cupo della città
    stone: surf("stone", photoTex(scene, "medieval_blocks_05"), new Color3(0.8, 0.78, 0.76), undefined, 0.022, 0.9), plaster: surf("plaster", photoTex(scene, "plastered_wall_04"), new Color3(0.82, 0.74, 0.6), undefined, 0.004, 0.5),
    timber: surf("timber", photoTex(scene, "medieval_wood"), new Color3(0.5, 0.42, 0.36), undefined, 0.012, 0.3), wood: surf("wood", photoTex(scene, "weathered_planks"), new Color3(0.8, 0.72, 0.62), undefined, 0.012),
    slate: surf("slate", photoTex(scene, "roof_slates_02"), new Color3(0.8, 0.82, 0.86), undefined, 0.016, 0.8), tile: surf("tile", photoTex(scene, "clay_roof_tiles_02"), new Color3(0.85, 0.75, 0.7), undefined, 0.03, 0.6),
    thatch: surf("thatch", photoTex(scene, "thatch_roof_angled"), new Color3(0.8, 0.74, 0.6), undefined, 0.02, 0.85), iron: surf("iron", photoTex(scene, "rusty_metal_02"), new Color3(0.5, 0.5, 0.52)),
    cloth: surf("cloth", clothTex(scene), undefined, 0.95),
    flag: surf("flag", photoTex(scene, "monastery_stone_floor"), new Color3(0.8, 0.78, 0.76), undefined, 0.012), sett: surf("sett", photoTex(scene, "cobblestone_floor_08"), new Color3(0.8, 0.78, 0.76), undefined, 0.03),
    cobble: surf("cobble", photoTex(scene, "cobblestone_05"), new Color3(0.8, 0.78, 0.76), undefined, 0.03),
    glass: flat("glass", new Color3(0.03, 0.05, 0.06), Color3.Black()), dark: flat("dark", Color3.Black(), new Color3(0.004, 0.004, 0.004)),
    // ⚠️ HDR: il lume passa appena la soglia del bloom; più acceso diventa una lampadina bianca.
    // Tre materiali con lo stesso colore di partenza: finestre e lanterne seguono l'ora (main.ts), le fiamme no.
    lume: lumeMat(scene), lamp: flat("lamp", Color3.Black(), new Color3(1.2, 0.5, 0.12)),
    fire: flat("fire", Color3.Black(), new Color3(1.2, 0.5, 0.12)),
    // il vetro vero delle finestre aperte: una lastra scura quasi trasparente (da tutte e due le parti)
    vetro: glassMat(scene),
    acqua: waterMat(scene),   // il fiume
    brick: surf("brick", brickFloorTex(scene), new Color3(0.95, 0.85, 0.8)),   // i mattoni delle scale
  };
  const meshes: Mesh[] = [], byChild: Mesh[][] = [];
  for (const [k, g] of M.geos) {
    const mesh = g.mesh(`town_${k}`, scene);
    mesh.material = mats[Mason.material(k)]; mesh.isPickable = false; mesh.receiveShadows = true; mesh.freezeWorldMatrix();
    const el = /#(\d+)$/.exec(k);
    if (el) { const i = Number(el[1]); mesh.metadata = { child: i }; (byChild[i] ??= []).push(mesh); }
    meshes.push(mesh);
  }
  // gli interni (interiors.ts): le loro mesh stanno a parte e si accendono da vicino; i battenti degli usci, visti da fuori, stanno con la città
  const built = sites.map((s) => createInterior(scene, { ...s, mason: () => new Mason(), wood: mats.wood, lume: mats.fire }));
  for (const b of built) meshes.push(...b.meshes);
  const fronts = doorFronts(scene, mats.wood);
  if (fronts) meshes.push(fronts);
  const colliders = [...M.colliders, ...built.flatMap((b) => b.colliders)];
  // la luce dei lampioni, cotta sul rettangolo della città (la porta e il suo lampione stanno fuori dalle mura, a ovest)
  // la pozza di luce dei lampioni si ricuoce ogni volta che uno si accende o si spegne (pochi millisecondi)
  // (e ciò che esce dalle case: `spill`, le finestre accese e gli usci aperti, più deboli e più corti di una lanterna)
  let spill: { x: number; y: number; z: number; k: number; r: number }[] = [];
  const lampOn = new Map<string, boolean>(), bake = (): void => bakeLamps(scene, [...flames, ...LAMPS.filter((l) => lampOn.get(l.id) ?? true).map((l) => l.p), ...spill], [TOWN.x - hx - 20, TOWN.z - hz - 10, 2 * hx + 30, 2 * hz + 20]);
  bake();

  // ── il piano degli abitanti: nodi delle strade, collegamenti, posti ──
  // (una funzione: l'editor la rifà coi tracciati e i posti che sta modificando, per controllare la rete mentre si disegna)
  const replan = (walks: [number, number][][], spotDefs: Record<string, SpotDef>): TownPlan => {
  const w = (x: number, z: number): [number, number] => [TOWN.x + x, TOWN.z + z];
  // i tracciati del file: ogni punto è un nodo, i punti in fila sono collegati, un punto ripetuto è un incrocio
  const nodes: [number, number, number?][] = [], links: [number, number][] = [], seen = new Map<string, number>();
  for (const line of walks) {
    const ids = line.map(([x, z]) => seen.get(`${x},${z}`) ?? (seen.set(`${x},${z}`, nodes.push(w(x, z)) - 1), nodes.length - 1));
    for (let i = 1; i < ids.length; i++) links.push([ids[i - 1], ids[i]]);
  }
  const spots: TownPlan["spots"] = Object.fromEntries(Object.entries(spotDefs).map(([k, s]) => [k, { x: TOWN.x + s.at[0], z: TOWN.z + s.at[1], yaw: rad(s.yaw) }]));
  // un posto accanto a ogni lampione, dalla parte della strada: da lì il lampionaio lo accende
  for (const l of LAMPS) if (l.id.startsWith("lampione.")) {
    const n = nodes.reduce((b, q) => (Math.hypot(q[0] - l.p.x, q[1] - l.p.z) < Math.hypot(b[0] - l.p.x, b[1] - l.p.z) ? q : b)), d = Math.hypot(n[0] - l.p.x, n[1] - l.p.z) || 1, ux = (n[0] - l.p.x) / d, uz = (n[1] - l.p.z) / d;
    spots[l.id] = { x: l.p.x + ux * 0.95, z: l.p.z + uz * 0.95, yaw: Math.atan2(-ux, -uz) };
  }
  // i nodi di ogni interno in coda a quelli delle strade. Quello davanti all'uscio (il primo) si lega al nodo di strada più
  // vicino fra quelli che si raggiungono dritti, senza attraversare un muro (se non ce n'è, al più vicino: lo segnala `checkPlan`),
  // e a un secondo solo se è un suo vicino lungo la strada: così l'uscio sta "lungo" quel tratto e non diventa una scorciatoia
  // fra due strade (chi la prendesse passerebbe a un passo dalla porta, e la aprirebbe)
  const streets = nodes.length, road = links.slice();
  for (const b of [...built, ...plans]) {
    if (!streets || !b.nodes.length) continue;
    const base = nodes.length, [dx, dz, dy] = b.nodes[0];
    const near = nodes.slice(0, streets).map((n, i) => [Math.hypot(n[0] - dx, n[1] - dz), i]).sort((p, q) => p[0] - q[0]);
    // (dal più vicino, fermandosi al primo buono: provarli tutti contro tutti gli ostacoli costava due secondi di caricamento)
    const clear = ([, i]: number[]): boolean => clearWay(colliders, nodes[i][0], nodes[i][1], dx, dz, townGround(nodes[i][0], nodes[i][1]), dy ?? townGround(dx, dz), 0.03);
    const first = near.find(clear), next = first && near.find((n) => road.some(([p, q]) => (p === n[1] && q === first[1]) || (q === n[1] && p === first[1])) && clear(n));
    nodes.push(...b.nodes);
    links.push(...b.links.map(([p, q]): [number, number] => [p + base, q + base]), ...(first ? (next ? [first, next] : [first]) : near.slice(0, 1)).map(([, i]): [number, number] => [i, base]));
    Object.assign(spots, b.spots);
  }
  return { nodes, links, spots };
  };
  const plan = replan(def.walks, def.spots);
  // i lumi delle case: il colore dei vertici moltiplica l'emissivo del materiale (che segue l'ora), e si riscrive solo quando una casa cambia
  const panes = meshes.find((m) => m.name === "town_lume"), tint = panes?.getVerticesData(VertexBuffer.ColorKind), was = new Map<string, number>();
  if (panes && tint) panes.setVerticesData(VertexBuffer.ColorKind, tint, true);
  const windows = (level: (id: string) => number): void => {
    let dirty = false;
    for (const [id, [a, b]] of homes) {
      const v = level(id);
      if (v === (was.get(id) ?? 1)) continue;
      was.set(id, v); dirty = true;
      for (let i = a * 4; i < b * 4; i++) if (i % 4 !== 3) tint![i] = v;
    }
    if (dirty) panes!.updateVerticesData(VertexBuffer.ColorKind, tint!);
    // la luce che esce sulla strada: da ogni finestra aperta di una casa accesa, e dal suo uscio quando è aperto
    const lit = [...glow.keys()].filter((id) => level(id) > 0.25), doors = openDoors().filter((d) => level(d.id) > 0.25);
    const sig = lit.join() + "|" + doors.map((d) => d.id + d.x.toFixed(1)).join();
    if (sig === spilt) return;
    spilt = sig;
    spill = lit.flatMap((id) => glow.get(id)!.map((g) => ({ ...g, k: 0.75, r: 5.5 })));
    for (const d of doors) {
      const c = built.find((b) => b.interior.id === d.id)!.interior, ux = d.x - c.x, uz = d.z - c.z, n = Math.hypot(ux, uz) || 1;
      spill.push({ x: d.x + ux / n * 1.8, y: d.y + 1.2, z: d.z + uz / n * 1.8, k: 1, r: 6 });
    }
    bake();
  };
  let spilt = "";
  // le finestre aperte: avvicinandosi (interiors.ts dice quanto) i loro lumi opachi sfumano fino a un velo, e si vede dentro.
  // Per questo la mesh dei lumi si mescola (alfa dei vertici) e si disegna per prima fra le trasparenti, il vetro subito dopo.
  if (panes) { panes.hasVertexAlpha = true; panes.alphaIndex = 0; }
  const glassMesh = meshes.find((m) => m.name === "town_vetro");
  if (glassMesh) { glassMesh.alphaIndex = 1; glassMesh.onBeforeRenderObservable.add(() => GRAB()); }
  onInteriorShown((id, k) => {
    const t = thru.get(id);
    if (!t || !tint) return;
    for (let i = 0; i < t.length; i += 2) for (let v = t[i]; v < t[i + 1]; v++) tint[v * 4 + 3] = 1 - 0.9 * k;
    panes!.updateVerticesData(VertexBuffer.ColorKind, tint);
  });
  // i vetri delle lanterne: come le finestre, il colore dei vertici spegne l'emissivo
  const glass = meshes.find((m) => m.name === "town_lamp"), gt = glass?.getVerticesData(VertexBuffer.ColorKind);
  if (glass && gt) glass.setVerticesData(VertexBuffer.ColorKind, gt, true);
  const light = (id: string, on: boolean): void => {
    if ((lampOn.get(id) ?? true) === on) return;
    lampOn.set(id, on);
    let hit = false;
    for (const l of LAMPS) if (l.id === id) { hit = true; for (let i = l.a * 4; i < l.b * 4; i++) if (i % 4 !== 3) gt![i] = on ? 1 : 0.05; }
    if (hit) { glass!.updateVerticesData(VertexBuffer.ColorKind, gt!); bake(); }
  };
  /** Le mesh di ciò che un muratore ha costruito, coi materiali della città. */
  const meshesOf = (m: Mason, name: string): Mesh[] => [...m.geos].map(([k, g]) => {
    const mesh = g.mesh(`${name}_${k}`, scene); mesh.material = mats[Mason.material(k)]; mesh.receiveShadows = true; return mesh;
  });
  /**
   * Un elemento costruito da solo, nelle sue mesh, come lo costruirebbe la città (stesso generatore, stesso seme): l'editor lo
   * usa per mostrare subito un elemento nuovo o cambiato. Ciò che il generatore dichiara altrove (fiamme, lanterne, interni,
   * posti dei lampioni) si butta: arriva salvando. Le copie da modello che dichiara le restituisce, per chi le vuole posare.
   */
  const build = (c: ChildDef, i: number): { meshes: Mesh[]; props: Want[] } => {
    const keep = { M, rnd, posts, lamps: LAMPS.length, flames: flames.length, sites: sites.length, plans: plans.length, open: OPEN.length }, fl = markFlames(), pm = markProps();
    M = new Mason(); rnd = mulberry32(variantOf(c)); propOwner(i);
    const m = M;
    try { M.in(TOWN.x, TOWN.y, TOWN.z, 0, () => PREFABS[c.prefab](c)); }
    finally { M = keep.M; rnd = keep.rnd; posts = keep.posts; LAMPS.length = keep.lamps; flames.length = keep.flames; sites.length = keep.sites; plans.length = keep.plans; OPEN.length = keep.open; fl(); propOwner(-1); }
    return { meshes: meshesOf(m, `elemento${i}`), props: takeProps(pm) };
  };
  /** I selciati rifatti da soli (l'editor li ridisegna mentre se ne trascina un capo). */
  const pavingAlone = (list: LocationDef["paving"]): Mesh[] => {
    const keep = M, m = new Mason();
    M = m;
    try { M.in(TOWN.x, TOWN.y, TOWN.z, 0, () => layPaving(list)); } finally { M = keep; }
    return meshesOf(m, "selciati");
  };
  /** Un oggetto teso costruito da solo, nelle sue mesh (l'editor lo ricostruisce mentre se ne trascina un capo). */
  const spanAlone = (c: ChildDef): Mesh[] => {
    const m = new Mason();
    m.in(TOWN.x, TOWN.y, TOWN.z, 0, () => span(m, c));
    return [...m.geos].map(([k, g]) => { const mesh = g.mesh(`span_${k}`, scene); mesh.material = mats[Mason.material(k)]; mesh.receiveShadows = true; return mesh; });
  };
  return {
    editor: opts.editor ? { parts: def.children.map((_, i) => byChild[i] ?? []), span: spanAlone, replan, build, paving: pavingAlone, pavingMeshes: meshes.filter((m) => m.name.endsWith("#selciati")) } : undefined,
    windows, light, lamps: LAMPS.map((l) => ({ id: l.id, x: l.p.x, z: l.p.z })),
    meshes, colliders, plan,
    floors: [...built.flatMap((b) => b.floors), ...OPEN], doors: built.flatMap((b) => b.doors), interiors: built.map((b) => b.interior), lumi: { finestre: mats.lume as StandardMaterial, lanterne: mats.lamp as StandardMaterial },
  };
}

/**
 * Il controllo della rete degli abitanti (in sviluppo: main.ts lo fa girare all'avvio e lo espone come `checkPlan()`):
 * ogni tratto fra due nodi dev'essere sgombro, ogni nodo raggiungibile dal primo, e da un nodo raggiungibile si deve
 * arrivare dritti a ogni posto (l'ultimo metro non conta: è l'arredo su cui il posto sta). Restituisce i problemi.
 * Dentro gli edifici lo stesso controllo, più fino, lo fa `problems` di layouts.ts (npm run check).
 */
export function checkPlan(town: Town, ground: (x: number, z: number) => number, skip = new Set<string>()): string[] {
  const { nodes, links, spots } = town.plan, out: string[] = [], y = (n: [number, number, number?]): number => n[2] ?? ground(n[0], n[1]);
  const seen = new Set([0]);
  for (let grew = true; grew;) { grew = false; for (const [a, b] of links) if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; } }
  nodes.forEach((n, i) => { if (!seen.has(i)) out.push(`nodo ${i} (${n[0].toFixed(1)}, ${n[1].toFixed(1)}): staccato dalla rete`); });
  for (const [a, b] of links) {
    const A = nodes[a], B = nodes[b];
    if (!clearWay(town.colliders, A[0], A[1], B[0], B[1], y(A), y(B), 0.03)) out.push(`tratto ${a}–${b} da (${A[0].toFixed(1)}, ${A[1].toFixed(1)}) a (${B[0].toFixed(1)}, ${B[1].toFixed(1)}): sbarrato`);
  }
  for (const [name, s] of Object.entries(spots)) {
    if (skip.has(name)) continue;
    const sy = s.y ?? ground(s.x, s.z), far = (n: [number, number, number?]): number => Math.hypot(n[0] - s.x, n[1] - s.z) + Math.abs(y(n) - sy) * 6;
    const i = nodes.reduce((b, n, k) => (far(n) < far(nodes[b]) ? k : b), 0), N = nodes[i], d = Math.hypot(N[0] - s.x, N[1] - s.z), k = d > 1.4 ? (d - 1.4) / d : 0;
    if (!seen.has(i)) out.push(`${name}: il nodo più vicino (${i}) è staccato dalla rete`);
    else if (!clearWay(town.colliders, N[0], N[1], N[0] + (s.x - N[0]) * k, N[1] + (s.z - N[1]) * k, y(N), y(N) + (sy - y(N)) * k, 0.03)) out.push(`${name}: dal nodo ${i} (${N[0].toFixed(1)}, ${N[1].toFixed(1)}) sbarrato`);
  }
  return out;
}
