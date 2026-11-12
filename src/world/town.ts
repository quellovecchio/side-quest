import { Color3, Matrix, Mesh, Scene, StandardMaterial, Vector3, VertexBuffer, type Material } from "@babylonjs/core";
import { Geo } from "./geo";
import { embers, fire, flame } from "./flames";
import { bakeLamps, surfaceMaterial } from "./materials";
import { mulberry32 } from "./noise";
import { LIP, entry, layout, seedOf } from "./layouts";
import { TOWN } from "./terrain";
import { clothTex, masonryTex, photoTex } from "./textures";
import type { DoorDef } from "./doors";
import { createInterior, doorFronts, furnish, type Built } from "./interiors";
import { clearWay, type Floor } from "./levels";
import type { Collider } from "./vegetation";
import type { ChildDef, InteriorId, LocationDef, PrefabId } from "../data/db";

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
export interface Interior { meshes: Mesh[]; x: number; z: number; r: number }

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
}

export type V3 = [number, number, number];
export type Tint = [number, number, number];
/** `under` disegna anche il fondo di una scatola, `open` ne toglie il coperchio. */
export interface Opt { uv?: number; tint?: Tint; rot?: V3; under?: boolean; open?: boolean }

/** Metri per ripetizione della texture di ogni materiale. */
const UV: Record<string, number> = { stone: 2.6, plaster: 3, timber: 1.2, wood: 1.2, slate: 2.4, tile: 2.4, thatch: 3, iron: 0.5, cloth: 0.33, flag: 3, sett: 1.6, cobble: 1.6, brick: 0.88, glass: 0.6, earth: 2 };
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
  private stack: Matrix[] = [Matrix.Identity()];
  private get m(): Matrix { return this.stack[this.stack.length - 1]; }

  /** Esegue `f` in un riferimento locale: spostato, girato attorno a y, appena fuori piombo (`lean`). */
  in(x: number, y: number, z: number, yaw: number, f: () => void, lean = 0): void {
    this.stack.push(Matrix.RotationYawPitchRoll(yaw, 0, lean).multiply(Matrix.Translation(x, y, z)).multiply(this.m));
    f();
    this.stack.pop();
  }

  /** Un punto del riferimento corrente, nel mondo. */
  world(x: number, y: number, z: number): Vector3 { return Vector3.TransformCoordinates(new Vector3(x, y, z), this.m); }
  /** Lo yaw del riferimento corrente nel mondo, e la matrice che dal mondo riporta al riferimento. */
  get yaw(): number { return Math.atan2(this.m.m[8], this.m.m[10]); }
  get inverse(): Matrix { return Matrix.Invert(this.m); }

  /** Poligono convesso con la sua normale. Le uv sono le coordinate locali (di `src`) lungo i due assi più vicini al piano. */
  poly(k: string, pts: V3[], n: V3, o: Opt = {}, src: V3[] = pts): void {
    const g = this.geos.get(k + this.tag) ?? new Geo();
    this.geos.set(k + this.tag, g);
    const s = o.uv ?? UV[k] ?? 1, ax = Math.abs(n[1]) > 0.7 ? [0, 2] : Math.abs(n[0]) > Math.abs(n[2]) ? [2, 1] : [0, 1];
    const N = Vector3.TransformNormal(new Vector3(n[0], n[1], n[2]), this.m).normalize();
    const put = (p: V3, q: V3): number => g.vert(Vector3.TransformCoordinates(new Vector3(p[0], p[1], p[2]), this.m), N, q[ax[0]] / s, q[ax[1]] / s, 1, o.tint);
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
      if (ax === 1 && (sg < 0 ? !o.under : o.open)) continue;
      const u = (ax + 1) % 3, w = (ax + 2) % 3, n: V3 = [0, 0, 0];
      n[ax] = sg;
      const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sw]) => { const p: V3 = [0, 0, 0]; p[ax] = sg * h[ax]; p[u] = su * h[u]; p[w] = sw * h[w]; return p; });
      this.poly(k, q.map((p) => tr(p, true)), tr(n, false), o, q.map((p) => [c[0] + p[0], c[1] + p[1], c[2] + p[2]] as V3));
    }
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
    this.colliders.push({ x: p.x, z: p.z, r });
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
    this.colliders.push(x0 === x1 && z0 === z1 ? { x: a.x, z: a.z, r, y0: a.y, y1: b.y } : { x: a.x, z: a.z, bx: b.x, bz: b.z, r, y0: a.y, y1: b.y });
  }
}

// ── pezzi di facciata (nel riferimento della facciata: piano z = 0, rivolto a +Z) ──

function win(M: Mason, x: number, y: number, w: number, h: number, k: string, arched = false): void {
  if (arched) {
    // finestra di pietra: il vetro in fondo, attorno i conci in rilievo (piedritti e arco a pezzi alterni), il davanzale che
    // sporge, la ferrata
    const spring = Math.max(0, h - w * 0.75), n = 5;
    M.arch("stone", x, y - 0.18, w + 0.4, h + 0.36, 0.02, { tint: DARK });
    M.arch(k, x, y, w, h, 0.05);
    for (const g of [-1, 1]) {
      for (let i = 0, yy = y; yy < y + spring - 0.05; i++, yy += 0.36) M.box("stone", x + g * (w / 2 + 0.11) - (i % 2 ? 0.16 : 0.11), yy, 0, x + g * (w / 2 + 0.11) + (i % 2 ? 0.16 : 0.11), Math.min(yy + 0.34, y + spring), 0.15, { tint: i % 2 ? DARK : undefined });
      for (let i = 0; i < n; i++) {
        const a = M.archSide(x, y, w + 0.22, h + 0.11, 0, g, i / n), b = M.archSide(x, y, w + 0.22, h + 0.11, 0, g, (i + 1) / n);
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        M.box("stone", cx - L / 2 - 0.015, cy - 0.11, 0, cx + L / 2 + 0.015, cy + 0.11, 0.15, { rot: [0, 0, Math.atan2(b[1] - a[1], b[0] - a[0])], tint: i % 2 ? undefined : DARK });
      }
    }
    M.box("stone", x - w / 2 - 0.3, y - 0.17, 0, x + w / 2 + 0.3, y - 0.02, 0.26, { tint: DARK, under: true });
    M.box("iron", x - 0.018, y, 0.05, x + 0.018, y + h - w * 0.16, 0.085);
    for (let i = 1; i * 0.5 < spring + 0.2; i++) M.box("iron", x - w / 2, y + i * 0.5 - 0.015, 0.05, x + w / 2, y + i * 0.5 + 0.015, 0.08);
    return;
  }
  // finestra a telaio: il vetro in fondo a un telaio spesso, la croce, l'architrave e il davanzale che sporgono; se non è
  // una vetrina, due imposte di tavole aperte contro il muro, con le traverse e le bandelle di ferro
  const f = 0.09, dz = 0.15;
  M.box(k, x - w / 2, y, 0, x + w / 2, y + h, 0.03);
  for (const s of [-1, 1]) M.box("timber", x + s * (w / 2 + f / 2) - f / 2, y - f, 0, x + s * (w / 2 + f / 2) + f / 2, y + h + f, dz);
  M.box("timber", x - w / 2, y + h, 0, x + w / 2, y + h + f, dz);
  M.box("timber", x - w / 2 - 0.17, y + h + f, 0, x + w / 2 + 0.17, y + h + f + 0.1, dz + 0.05, { under: true });
  M.box("timber", x - w / 2 - 0.19, y - f - 0.06, 0, x + w / 2 + 0.19, y - f + 0.03, dz + 0.12, { under: true });
  M.box("timber", x - w / 2, y - f + 0.03, 0, x + w / 2, y, dz);
  M.box("timber", x - 0.03, y, 0.03, x + 0.03, y + h, 0.1);
  M.box("timber", x - w / 2, y + h * 0.55 - 0.03, 0.03, x + w / 2, y + h * 0.55 + 0.03, 0.1);
  if (w > 1.3) return;
  for (const s of [-1, 1]) {
    const a = x + s * (w / 2 + f + 0.03), b = a + s * w * 0.5, x0 = Math.min(a, b), x1 = Math.max(a, b);
    M.box("wood", x0, y, 0.015, x1, y + h, 0.06, { tint: DOOR });
    for (const yy of [y + h * 0.18, y + h * 0.78]) { M.box("timber", x0 + 0.02, yy - 0.05, 0.06, x1 - 0.02, yy + 0.05, 0.09); M.box("iron", Math.min(a, a + s * 0.24), yy - 0.018, 0.09, Math.max(a, a + s * 0.24), yy + 0.018, 0.1); }
  }
}

/** Comignolo: il fusto, la cimasa che sporge, due canne di cotto. */
function chimney(M: Mason, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  M.box("stone", x0, y0, z0, x1, y1, z1, { tint: DARK });
  M.box("stone", x0 - 0.09, y1, z0 - 0.09, x1 + 0.09, y1 + 0.13, z1 + 0.09, { under: true });
  const cz = (z0 + z1) / 2, n = x1 - x0 > 0.75 ? 2 : 1;
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
function frame(M: Mason, w: number, y0: number, y1: number, bays: number): void {
  const hw = w / 2, t = 0.09, bw = w / bays, h = y1 - y0 - 0.32, a = Math.atan2(bw - 2 * t, h), L = Math.hypot(bw - 2 * t, h);
  // (le travi sporgono dall'intonaco quanto una mano: l'ombra fra trave e riquadro è ciò che dà corpo alla facciata)
  M.box("timber", -hw, y0, 0, hw, y0 + 0.18, 0.11); M.box("timber", -hw, y1 - 0.18, 0, hw, y1, 0.11);
  for (let i = 0; i <= bays; i++) M.box("timber", -hw + i * bw - t, y0, 0, -hw + i * bw + t, y1, 0.1);
  for (const s of [-1, 1]) M.box("timber", s * (hw - bw / 2) - 0.075, y0 + 0.16 + h / 2 - L / 2, 0, s * (hw - bw / 2) + 0.075, y0 + 0.16 + h / 2 + L / 2, 0.085, { rot: [0, 0, s * a] });
}

/** Le fiamme che di notte fanno luce attorno (lanterne, forgia), nel mondo: da qui si cuoce la luce dei lampioni (`bakeLamps`). */
const flames: Vector3[] = [];

/** Lanterna a olio: vetri accesi fra un fondo e un cappello di ferro. */
function lantern(M: Mason, x: number, y: number, z: number): void {
  flames.push(M.world(x, y + 0.2, z));
  flame(M.world(x, y + 0.07, z), 0.2, 0.3);   // la fiammella dietro i vetri: il vento la tocca poco
  // una gabbia di ferro attorno ai vetri: il fondo, quattro montanti, la cornice, il cappello a punta col suo anello
  M.box("iron", x - 0.13, y, z - 0.13, x + 0.13, y + 0.04, z + 0.13, { under: true });
  M.box("lamp", x - 0.1, y + 0.04, z - 0.1, x + 0.1, y + 0.38, z + 0.1);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box("iron", x + sx * 0.105 - 0.012, y + 0.04, z + sz * 0.105 - 0.012, x + sx * 0.105 + 0.012, y + 0.38, z + sz * 0.105 + 0.012);
  M.box("iron", x - 0.15, y + 0.38, z - 0.15, x + 0.15, y + 0.41, z + 0.15, { under: true });
  M.pyramid("iron", x - 0.19, z - 0.19, x + 0.19, z + 0.19, y + 0.41, y + 0.6);
  M.box("iron", x - 0.02, y + 0.6, z - 0.02, x + 0.02, y + 0.66, z + 0.02);
}

function lamppost(M: Mason, x: number, z: number): void {
  M.in(x, 0, z, 0, () => {
    // base di pietra a due gradini, fusto di ferro a otto facce con due nodi, la traversa con i riccioli
    M.box("stone", -0.24, 0, -0.24, 0.24, 0.14, 0.24, { tint: DARK }); M.box("stone", -0.17, 0.14, -0.17, 0.17, 0.36, 0.17, { tint: DARK });
    M.drum("iron", 0, 0, 0.06, 0.36, 2.75, {}, 0.04, 8);
    for (const yy of [0.5, 1.5, 2.36]) M.drum("iron", 0, 0, 0.075, yy, yy + 0.07, {}, 0.075, 8);
    M.box("iron", -0.28, 2.42, -0.02, 0.28, 2.46, 0.02);
    for (const s of [-1, 1]) M.box("iron", s * 0.28 - 0.02, 2.36, -0.02, s * 0.28 + 0.02, 2.52, 0.02);
    lantern(M, 0, 2.75, 0);
    M.line(0, 0, 0, 0, 0.2);
  });
}

function barrel(M: Mason, x: number, z: number): void {
  // doghe panciute (quattro tronchi di cono, dodici facce), il coperchio incassato sotto l'orlo, quattro cerchi di ferro
  const R = [0.29, 0.345, 0.365, 0.345, 0.29], Y = [0, 0.22, 0.45, 0.68, 0.9];
  for (let i = 0; i < 4; i++) M.drum("wood", x, z, R[i], Y[i], Y[i + 1], { tint: i % 2 ? [0.8, 0.76, 0.7] : undefined }, R[i + 1], 12);
  M.drum("timber", x, z, 0.265, 0.84, 0.86, {}, 0.265, 12);
  for (const [y, r] of [[0.06, 0.312], [0.27, 0.357], [0.6, 0.357], [0.81, 0.312]]) M.drum("iron", x, z, r, y, y + 0.045, {}, r, 12);
  M.line(x, z, x, z, 0.36);
}

/**
 * Un muro di facciata col vano a sesto acuto di un uscio (nel riferimento della facciata): da x0 a x1, alto h0; la mostra
 * di pietra (più larga e più alta del vano di `frame[0]` e `frame[1]`, sporgente `frame[2]`), l'imbotte e la soglia.
 * I battenti stanno dietro, a LIP dal filo del muro (vedi interiors.ts).
 */
function portal(M: Mason, x0: number, x1: number, h0: number, d: { x: number; w: number; h: number }, frame: V3 = [0.5, 0.3, 0.03], sill = true): void {
  const { x: cx, w, h } = d, W = w + frame[0], H = h + frame[1], fz = frame[2], n = 5;
  const inner = (g: number, i: number, z = 0): V3 => M.archSide(cx, 0, w, h, z, g, i / n), outer = (g: number, i: number): V3 => M.archSide(cx, 0, W, H, fz, g, i / n);
  for (const g of [-1, 1]) {
    const e = g < 0 ? x0 : x1;
    M.face("stone", [[cx + g * w / 2, 0, 0], [e, 0, 0], [e, h0, 0], [cx + g * w / 2, h0, 0]], [0, 0, 1]);                                       // il muro ai lati del vano
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
function house(M: Mason, rnd: () => number, x: number, z: number, yaw: number, w: number, d: number, kind: 0 | 1 | 2, open?: InteriorId): number {
  const hw = w / 2, hd = d / 2, lit = (): string => (rnd() < 0.55 ? "lume" : "glass"), inn = open === "locanda";
  const e = open ? entry((["casa.povera", "casa.graticcio", "casa.ricca"] as const)[kind], w) : null;   // il vano dell'uscio
  // ⚠️ i due numeri a caso si estraggono comunque, in quest'ordine: il resto della città ne dipende
  const a = yaw + (rnd() - 0.5) * 0.05, lean = (rnd() - 0.5) * 0.035;
  M.in(x, 0, z, a, () => {
    if (!e) M.solid(-hw, -hd, hw, hd);
    if (kind === 0) {
      const rise = d * 0.6;
      if (e) {   // guscio: tre muri e la facciata col vano dell'uscio (alto quanto serve a chi gioca); niente coperchi, dello zoccolo resta la risega
        const p = hw - 0.06, q = hd - 0.06, a = e.x - e.w / 2, b = e.x + e.w / 2;
        for (const s of [-1, 1]) {
          wallFace(M, "stone", s * hw, -hd, s * hw, hd, 0, 0.9, [s, 0, 0]); wallFace(M, "plaster", s * p, -q, s * p, q, 0.9, 2.7, [s, 0, 0]);
          M.face("stone", [[s * p, 0.9, -hd], [s * hw, 0.9, -hd], [s * hw, 0.9, hd], [s * p, 0.9, hd]], [0, 1, 0]);
          for (const [u0, u1] of s > 0 ? [[-p, a], [b, p]] : [[-p, p]]) M.face("stone", [[u0, 0.9, s * q], [u1, 0.9, s * q], [u1, 0.9, s * hd], [u0, 0.9, s * hd]], [0, 1, 0]);
          wallFace(M, "stone", e.x + s * e.w / 2, hd - LIP, e.x + s * e.w / 2, hd, 0, 0.9, [-s, 0, 0], { tint: DARK });   // l'imbotte, nello zoccolo
        }
        wallFace(M, "stone", -hw, -hd, hw, -hd, 0, 0.9, [0, 0, -1]); wallFace(M, "plaster", -p, -q, p, -q, 0.9, 2.7, [0, 0, -1]);
        wallFace(M, "stone", -hw, hd, a, hd, 0, 0.9, [0, 0, 1]); wallFace(M, "stone", b, hd, hw, hd, 0, 0.9, [0, 0, 1]);
        wallFace(M, "plaster", -p, q, a, q, 0.9, 2.7, [0, 0, 1]); wallFace(M, "plaster", b, q, p, q, 0.9, 2.7, [0, 0, 1]); wallFace(M, "plaster", a, q, b, q, e.h, 2.7, [0, 0, 1]);
      } else {
        M.box("stone", -hw, 0, -hd, hw, 0.9, hd);
        M.box("plaster", -hw + 0.06, 0.9, -hd + 0.06, hw - 0.06, 2.7, hd - 0.06);
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box("timber", sx * hw - 0.1, 0.9, sz * hd - 0.1, sx * hw + 0.1, 2.7, sz * hd + 0.1);
      M.in(0, 0, hd - 0.05, 0, () => {
        if (e) { M.box("timber", e.x - e.w / 2 - 0.1, e.h, 0, e.x + e.w / 2 + 0.1, e.h + 0.16, 0.1); M.box("stone", e.x - e.w / 2 - 0.2, 0, 0, e.x + e.w / 2 + 0.2, 0.12, 0.45, { tint: DARK }); }   // l'architrave e la soglia
        else door(M, -hw * 0.4, 1.0, 1.75);
        win(M, hw * 0.45, 1.25, 0.8, 0.7, lit());
      });
      M.in(0, 0, 0, PI / 2, () => {
        M.roof("thatch", hd, -hw, hw, 2.6, rise, 0.6);
        for (const s of [-1, 1]) M.face("plaster", [[-hd, 2.6, s * (hw - 0.06)], [hd, 2.6, s * (hw - 0.06)], [0, 2.6 + rise, s * (hw - 0.06)]], [0, 0, s]);
      });
      chimney(M, hw * 0.3, 2.6, -0.35, hw * 0.3 + 0.7, 2.6 + rise + 0.8, 0.35);
      return;
    }
    const h0 = kind === 2 ? 3.3 : 3, j = 0.35, fz = hd + j;
    if (e) {   // tre muri pieni e la facciata col vano dell'uscio; niente coperchio, che taglierebbe la sala
      for (const s of [-1, 1]) M.face("stone", [[s * hw, 0, -hd], [s * hw, 0, hd], [s * hw, h0, hd], [s * hw, h0, -hd]], [s, 0, 0]);
      M.face("stone", [[-hw, 0, -hd], [hw, 0, -hd], [hw, h0, -hd], [-hw, h0, -hd]], [0, 0, -1]);
      M.in(0, 0, hd, 0, () => portal(M, -hw, hw, h0, e));
    } else M.box("stone", -hw, 0, -hd, hw, h0, hd);
    let y = h0;
    if (kind === 2) {   // piano nobile in pietra e intonaco
      if (e) ring(M, hw + 0.08, hd + 0.08, y, y + 0.22, 0.12);        // il marcapiano come cornice: dentro ci passa il solaio
      else M.box("stone", -hw - 0.08, y, -hd - 0.08, hw + 0.08, y + 0.22, hd + 0.08, { tint: DARK, under: true });
      M.box("plaster", -hw + 0.04, y + 0.22, -hd + 0.04, hw - 0.04, y + 3.2, hd - 0.04, { open: !!e });
      M.in(0, 0, hd - 0.03, 0, () => { for (const s of [-1, 0, 1]) win(M, s * w * 0.3, y + 0.9, 1, 1.9, lit(), true); });
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
    M.box("plaster", -hw - 0.05, y1, -hd, hw + 0.05, y2, fz);
    M.in(0, 0, fz, 0, () => { frame(M, w + 0.1, y1, y2, kind === 2 ? 5 : 4); for (const s of [-1, 1]) win(M, s * w * 0.19, y1 + 0.85, 0.95, 1.25, lit()); });
    for (const s of [-1, 1]) M.in(s * (hw + 0.05), 0, j / 2, s * PI / 2, () => frame(M, d + j, y1, y2, 3));
    M.in(0, 0, -hd, PI, () => frame(M, w + 0.1, y1, y2, 3));
    // piano terra: porta e bottega
    M.in(0, 0, hd, 0, () => {
      if (!e) door(M, kind === 2 ? 0 : -w * 0.24, kind === 2 ? 1.7 : 1.15, kind === 2 ? 2.5 : 2.1, true);
      if (kind === 2) for (const s of [-1, 1]) win(M, s * w * 0.33, 1.1, 0.9, 1.4, "glass", true);
      else { win(M, w * 0.2, 0.95, 1.7, 1.25, "lume"); M.box("wood", w * 0.2 - 1, 0.82, 0, w * 0.2 + 1, 0.9, 0.4); }
      if (inn) {   // l'insegna della locanda, su un braccio di ferro
        M.box("iron", hw * 0.62 - 0.03, 3.05, 0, hw * 0.62 + 0.03, 3.11, 1.25);
        M.box("wood", hw * 0.62 - 0.04, 2.25, 0.45, hw * 0.62 + 0.04, 2.95, 1.2);
        for (const s of [-1, 1]) M.box("cloth", hw * 0.62 + s * 0.045, 2.42, 0.66, hw * 0.62 + s * 0.05, 2.78, 1.0, { tint: OCRA });
        lantern(M, -hw * 0.62, 2.3, 0.5); M.box("iron", -hw * 0.62 - 0.02, 2.86, 0, -hw * 0.62 + 0.02, 2.9, 0.6);
      }
    });
    if (kind === 1) {   // timpano sulla strada
      const rise = w * 0.66;
      M.roof("slate", hw + 0.05, -hd, fz, y2, rise);
      M.face("plaster", [[-hw - 0.05, y2, fz], [hw + 0.05, y2, fz], [0, y2 + rise, fz]], [0, 0, 1]);
      M.face("plaster", [[-hw - 0.05, y2, -hd], [hw + 0.05, y2, -hd], [0, y2 + rise, -hd]], [0, 0, -1]);
      M.in(0, 0, fz, 0, () => {
        M.box("timber", -0.09, y2, 0, 0.09, y2 + rise - 0.25, 0.07); M.box("timber", -hw * 0.52, y2 + rise * 0.42, 0, hw * 0.52, y2 + rise * 0.42 + 0.16, 0.07);
        win(M, hw * 0.34, y2 + 0.5, 0.7, 0.9, lit());
      });
      chimney(M, -hw * 0.5, y2 + rise * 0.3, -hd + 0.6, -hw * 0.5 + 0.7, y2 + rise + 0.6, -hd + 1.3);
    } else {            // gronda sulla strada
      const rise = d * 0.56;
      M.in(0, 0, j / 2, PI / 2, () => {
        M.roof("slate", hd + j / 2, -hw - 0.05, hw + 0.05, y2, rise);
        for (const s of [-1, 1]) M.face("plaster", [[-hd - j / 2, y2, s * (hw + 0.05)], [hd + j / 2, y2, s * (hw + 0.05)], [0, y2 + rise, s * (hw + 0.05)]], [0, 0, s]);
      });
      for (const s of [-1, 1]) chimney(M, s * hw * 0.72 - 0.4, y2, -0.4, s * hw * 0.72 + 0.4, y2 + rise + 1.3, 0.4);
    }
  }, e ? 0 : lean);   // dove si entra i pavimenti sono in piano: niente fuori piombo (ma il numero a caso si estrae lo stesso)
  return a;
}

export function createTown(scene: Scene, def: LocationDef): Town {
  const rnd = mulberry32(0x70A1), M = new Mason(), { hx, hz } = TOWN, rad = (deg: number): number => deg * PI / 180;
  flames.length = 0;
  const lit = (): string => (rnd() < 0.5 ? "lume" : "glass");
  /** Gli edifici in cui si entra: quale interno, dove sta, come è girato, ingombro e seme della pianta. Si costruiscono dopo le mesh della città. */
  const sites: { id: string; kind: InteriorId; x: number; z: number; yaw: number; size: [number, number]; seed: number }[] = [];
  /** I pezzi di rete degli abitanti che vengono dagli interni (nodi con quota, collegamenti, posti): il nodo 0 di ognuno sta in strada. */
  const plans: Pick<Built, "nodes" | "links" | "spots">[] = [];
  const enter = (c: ChildDef, yaw: number, size: [number, number]): void => { if (c.interior) sites.push({ id: c.id!, kind: c.interior, x: c.at[0], z: c.at[1], yaw, size, seed: seedOf(c) }); };
  /** Esegue `f` nel riferimento di una cosa posata. */
  const place = (c: ChildDef, f: () => void): void => M.in(c.at[0], 0, c.at[1], rad(c.yaw), f);
  // le finestre accese di ogni casa con un nome: quali vertici della mesh dei lumi sono suoi (da, a), per accenderle e spegnerle (`windows`)
  const homes = new Map<string, [number, number]>(), lumes = (): number => (M.geos.get("lume")?.c.length ?? 0) / 4;
  const casa = (kind: 0 | 1 | 2) => (c: ChildDef): void => {
    const from = lumes();
    enter(c, house(M, rnd, c.at[0], c.at[1], rad(c.yaw), c.size![0], c.size![1], kind, c.interior), c.size!);
    if (c.id) homes.set(c.id, [from, lumes()]);
  };
  const TELI: Record<string, Tint> = { vino: VINO, ocra: OCRA, muschio: MUSCHIO };
  const PAVING = { lastre: ["flag", 0.04], "lastre.diagonali": ["flag", 0.045], cubetti: ["sett", 0.05], ciottoli: ["cobble", 0.03] } as const;

  M.in(TOWN.x, TOWN.y, TOWN.z, 0, () => {
    // ── selciati: ognuno a una quota appena diversa, così dove si sovrappongono non sfarfallano ──
    const pave = (k: string, x0: number, z0: number, x1: number, z1: number, y: number, diag = false): void => {
      const pts: V3[] = [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
      M.poly(k, pts, [0, 1, 0], diag ? { uv: 2.2 } : {}, diag ? pts.map(([x, , z]) => [(x - z) * 0.707, 0, (x + z) * 0.707] as V3) : pts);
    };
    const laid: Record<string, number> = {};
    for (const p of def.paving) {
      const [[ax, az], [bx, bz]] = p.line, h = p.width / 2, [k, y] = PAVING[p.kind], n = laid[p.kind] = (laid[p.kind] ?? -1) + 1;
      // ogni striscia dello stesso selciato sta 2 mm sopra la precedente
      if (az === bz) pave(k, Math.min(ax, bx), az - h, Math.max(ax, bx), az + h, y + n * 0.002, p.kind === "lastre.diagonali");
      else pave(k, ax - h, Math.min(az, bz), ax + h, Math.max(az, bz), y + n * 0.002, p.kind === "lastre.diagonali");
    }

    // ── mura, torri d'angolo, porta ──
    const wall = (x0: number, z0: number, x1: number, z1: number, trim0 = 0, trim1 = 0): void => {
      const ew = z0 === z1, t = 0.8, n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / 2.4);
      M.box("stone", Math.min(x0, x1) - (ew ? 0 : t), 0, Math.min(z0, z1) - (ew ? t : 0), Math.max(x0, x1) + (ew ? 0 : t), 8, Math.max(z0, z1) + (ew ? t : 0));
      for (let i = 0; i < n; i++) {
        const k = (i + 0.5) / n, x = x0 + (x1 - x0) * k, z = z0 + (z1 - z0) * k;
        M.box("stone", x - (ew ? 0.7 : t), 8, z - (ew ? t : 0.7), x + (ew ? 0.7 : t), 9, z + (ew ? t : 0.7));
      }
      const l = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / l, uz = (z1 - z0) / l;
      M.line(x0 + ux * trim0, z0 + uz * trim0, x1 - ux * trim1, z1 - uz * trim1, t);
    };
    // ⚠️ i cerchi delle mura fermano a ogni quota: dove toccano la porta, se dentro ci si sale, vanno tenuti fuori dalle sue torri
    const guard = def.gate?.interior ? def.gate : null, trim = guard ? 0.8 : 0;
    wall(-hx, -hz, -hx, -5, 0, trim); wall(-hx, 5, -hx, hz, trim, 0); wall(-hx, hz, hx, hz); wall(hx, hz, hx, -hz); wall(hx, -hz, -hx, -hz);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      M.box("stone", sx * hx - 2.5, 0, sz * hz - 2.5, sx * hx + 2.5, 11, sz * hz + 2.5);
      M.pyramid("slate", sx * hx - 2.9, sz * hz - 2.9, sx * hx + 2.9, sz * hz + 2.9, 11, 15.5);
      M.solid(sx * hx - 2.5, sz * hz - 2.5, sx * hx + 2.5, sz * hz + 2.5, 0.8);
    }
    if (guard) sites.push({ id: guard.id, kind: "porta", x: -hx, z: 0, yaw: PI / 2, size: [10, 5.2], seed: seedOf(guard) });   // (la pianta guarda la città: mezzo giro rispetto alla porta)
    M.in(-hx, 0, 0, -PI / 2, () => {   // la porta: il fuori è a +Z
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
      for (let i = -3; i <= 3; i++) M.box("iron", i * 0.6 - 0.04, 3.9, 2.2, i * 0.6 + 0.04, 5, 2.3, { under: true });   // la saracinesca, a metà
      M.box("iron", -2.2, 4.4, 2.2, 2.2, 4.48, 2.3, { under: true });
      M.box("stone", -5.4, 12.4, -3, 5.4, 14.2, 3, { under: true, tint: DARK });                                         // caditoie
      for (let i = -2; i <= 2; i++) for (const s of [-1, 1]) M.box("stone", i * 2.2 - 0.6, 14.2, s * 2.75 - 0.25, i * 2.2 + 0.6, 15.2, s * 2.75 + 0.25, { tint: DARK });
      M.in(0, 0, 0, 0, () => M.hip("slate", 5.8, 3.4, 15, 4.4));
      for (const f of [-1, 1]) M.in(0, 0, f * 2.61, f > 0 ? 0 : PI, () => {
        for (const s of [-1, 1]) { M.box("cloth", s * 3.6 - 0.45, 6.6, 0, s * 3.6 + 0.45, 11.4, 0.05, { tint: VINO }); lantern(M, s * 2.75, 3.3, 0.3); M.box("iron", s * 2.75 - 0.02, 3.86, 0, s * 2.75 + 0.02, 3.9, 0.4); }
        M.box("cloth", -0.6, 6.4, 0, 0.6, 7.9, 0.05, { tint: VINO }); M.disc("cloth", 0, 7.15, 0.3, 0.07, { tint: ORO });
      });
    });

    // ── i generatori: una chiave del file, una funzione. Ognuno lavora nel riferimento della cosa (facciata a +Z) ──
    const PREFABS: Record<PrefabId, (c: ChildDef) => void> = {
    "casa.povera": casa(0), "casa.graticcio": casa(1), "casa.ricca": casa(2),

    // cattedrale: la torre a destra di chi la guarda ha la guglia, l'altra non è mai stata finita
    cattedrale: (c) => place(c, () => {
      const L = 11.5, open = !!c.interior;
      enter(c, rad(c.yaw), [19, 29]);
      if (open) {   // guscio: la navata senza coperchio; dei muri di testa resta ciò che si vede da fuori (il resto è dietro torri, facciata e abside, e dentro lo fa l'interno)
        for (const s of [-1, 1]) {
          wallFace(M, "stone", s * 6.5, -L, s * 6.5, 5.5, 0, 11, [s, 0, 0]);
          wallFace(M, "stone", s * 4, -L, s * 6.5, -L, 0, 11, [0, 0, -1]); wallFace(M, "stone", s * 3.5, 5.5, s * 6.5, 5.5, 0, 11, [0, 0, 1]);
          wallFace(M, "stone", s * 4, -L - 3, s * 4, -L, 0, 8, [s, 0, 0]);
        }
        wallFace(M, "stone", -4, -L, 4, -L, 8, 11, [0, 0, -1]); wallFace(M, "stone", -3.5, 5.5, 3.5, 5.5, 7.5, 11, [0, 0, 1]);
        wallFace(M, "stone", -4, -L - 3, 4, -L - 3, 0, 8, [0, 0, -1]); M.face("stone", [[-4, 8, -L - 3], [4, 8, -L - 3], [4, 8, -L], [-4, 8, -L]], [0, 1, 0]);
      } else { M.box("stone", -6.5, 0, -L, 6.5, 11, 5.5); M.solid(-6.5, -L, 6.5, 5.5, 0.7); M.box("stone", -4, 0, -L - 3, 4, 8, -L); M.solid(-4, -L - 3, 4, -L, 0.7); }
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
        M.box("stone", s > 0 ? 6.5 : -7.4, 0, z - 0.45, s > 0 ? 7.4 : -6.5, 8.6, z + 0.45, { tint: DARK });   // contrafforti
        M.in(s * 6.52, 0, z + 2.15, s * PI / 2, () => M.arch("glass", 0, 3.4, 1.15, 4.6, 0));
      }
      for (const s of [-1, 1]) {   // s = +1 torre nord, −1 torre sud
        const top = s > 0 ? 20 : 17, cx = s * 6.5;
        M.box("stone", cx - 3, 0, 5.5, cx + 3, top, L); M.solid(cx - 3, 5.5, cx + 3, L, 0.7);
        for (const y of [7, 13.5, top]) M.box("stone", cx - 3.14, y, 5.36, cx + 3.14, y + (y === top ? 0.6 : 0.3), L + 0.14, { tint: DARK, under: true });
        M.in(cx, 0, L + 0.02, 0, () => { door(M, 0, 1.5, 3, true); M.arch("glass", 0, 8.2, 0.9, 3.8, 0); for (const q of [-1, 1]) M.arch("dark", q, top - 5.2, 1.1, 4.2, 0); });
        M.in(cx + s * 3.02, 0, 8.5, s * PI / 2, () => { M.arch("glass", 0, 8.2, 0.9, 3.8, 0); for (const q of [-1, 1]) M.arch("dark", q, top - 5.2, 1.1, 4.2, 0); });
      }
      M.pyramid("slate", 3.3, 5.3, 9.7, L + 0.2, 20.6, 33.5);
      for (const [px, pz] of [[3.6, 5.6], [9.4, 5.6], [3.6, L - 0.1], [9.4, L - 0.1]]) M.pyramid("stone", px - 0.45, pz - 0.45, px + 0.45, pz + 0.45, 20.6, 23.4, { tint: DARK });
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
        M.box("stone", -3.5, 6.6, 0, 3.5, 6.85, 0.14, { tint: DARK, under: true });
        for (let i = -3; i <= 3; i++) M.arch("stone", i * 0.92, 6.95, 0.6, 1.5, 0.02, { tint: DARK });
        M.disc("stone", 0, 10.7, 2.3, 0.02, { tint: DARK }); M.disc("glass", 0, 10.7, 1.8, 0.05);
        for (let i = 0; i < 8; i++) M.disc("cloth", Math.cos(i * PI / 4) * 1.15, 10.7 + Math.sin(i * PI / 4) * 1.15, 0.27, 0.07, { tint: i % 2 ? VINO : OCRA }, 8);
        M.disc("stone", 0, 10.7, 0.4, 0.08, { tint: DARK }, 8); M.disc("glass", 0, 15.2, 0.5, 0.02, {}, 8);
      });
      for (let i = 0; i < 3; i++) M.box("stone", -3.4 - i * 0.3, 0, L - 0.3, 3.4 + i * 0.3, 0.45 - i * 0.15, L + 0.4 + i * 0.6, { tint: DARK });
    }),

    // municipio: portico, balcone con lo stendardo, torre dell'orologio
    municipio: (c) => place(c, () => {
      const open = !!c.interior;
      enter(c, rad(c.yaw), [22, 11]);
      if (open) {   // guscio: tre muri, la facciata col vano del portone nell'arco di mezzo, il marcapiano come cornice (dentro ci passano il solaio e la scala)
        for (const s of [-1, 1]) wallFace(M, "stone", s * 11, -5.5, s * 11, 5.5, 0, 4.4, [s, 0, 0]);
        wallFace(M, "stone", -11, -5.5, 11, -5.5, 0, 4.4, [0, 0, -1]);
        M.in(0, 0, 5.5, 0, () => portal(M, -11, 11, 4.4, entry("municipio", 0), [0.7, 0.4, 0.02]));
        ring(M, 11.15, 5.65, 4.3, 4.6, 0.6);
      } else { M.box("stone", -11, 0, -5.5, 11, 4.4, 5.5); M.solid(-11, -5.5, 11, 5.5, 0.7); M.box("stone", -11.15, 4.3, -5.65, 11.15, 4.6, 5.65, { tint: DARK, under: true }); }
      M.box("plaster", -10.9, 4.4, -5.4, 10.9, 9.2, 5.4);
      M.box("timber", -11.25, 9.2, -5.75, 11.25, 9.5, 5.75, { under: true });
      M.in(0, 0, 0, 0, () => M.hip("tile", 11.6, 6.1, 9.5, 4.8));
      M.in(0, 0, 5.52, 0, () => {
        for (let i = -2; i <= 2; i++) if (i || !open) { M.arch("stone", i * 4.2, 0, 3.5, 4.1, 0, { tint: DARK }); M.arch("dark", i * 4.2, 0, 2.8, 3.7, 0.04); }
        for (const i of [-2, -1, 1, 2]) win(M, i * 4.2, 5.6, 1.3, 2.7, lit(), true);
        win(M, 0, 5.1, 1.5, 3.3, "lume", true);
        M.box("stone", -2.4, 4.6, 0, 2.4, 4.85, 1.1, { tint: DARK, under: true });
        M.box("stone", -2.4, 4.85, 0.96, 2.4, 5.75, 1.1); for (const s of [-1, 1]) M.box("stone", s * 2.33 - 0.07, 4.85, 0, s * 2.33 + 0.07, 5.75, 1.1);
        M.box("cloth", -0.75, 1.9, 1.11, 0.75, 4.85, 1.15, { tint: VINO }); M.disc("cloth", 0, 3.6, 0.38, 1.17, { tint: ORO });
      });
      M.box("stone", -2.3, 9.2, 0.6, 2.3, 20, 5.2);
      M.in(0, 0, 5.22, 0, () => {
        M.disc("cloth", 0, 15, 1.15, 0, { tint: BIANCO }); M.box("iron", -0.035, 15, 0.02, 0.035, 15.95, 0.05, { rot: [0, 0, -0.7] });
        for (const q of [-1, 1]) M.arch("dark", q * 0.9, 16.9, 0.9, 2.5, 0);
      });
      M.box("stone", -2.55, 20, 0.35, 2.55, 20.5, 5.45, { tint: DARK, under: true });
      M.pyramid("slate", -2.6, 0.3, 2.6, 5.5, 20.5, 25.8);
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
      M.drum("wood", 0.2, 1.3, 0.26, 0, 0.5); M.box("iron", -0.22, 0.5, 1.16, 0.62, 0.72, 1.44); M.line(0.2, 1.3, 0.2, 1.3, 0.35);
      barrel(M, 2.5, -1.7);
      // "si entra" in una tettoia aperta: gli attrezzi del fabbro e i posti, all'aperto e nei materiali della città (il seme non è quello della città)
      if (c.interior) plans.push(furnish(scene, M, layout("fucina", 0, 0, mulberry32(seedOf(c))), c.id!));
    }),

    pozzo: (c) => place(c, () => {
      // vera di pietra a tre corsi con la cimasa che sporge, il buio dentro; due montanti con le saette, l'argano col suo
      // rullo e la manovella, la corda, il secchio di doghe
      M.drum("stone", 0, 0, 1.0, 0, 0.3, { tint: DARK }, 0.97, 14); M.drum("stone", 0, 0, 0.93, 0.3, 0.78, {}, 0.91, 14); M.drum("stone", 0, 0, 0.99, 0.78, 0.9, { tint: DARK }, 0.99, 14);
      M.drum("dark", 0, 0, 0.72, 0.9, 0.905, {}, 0.72, 14);
      for (const s of [-1, 1]) {
        M.box("timber", s * 0.86 - 0.075, 0.9, -0.075, s * 0.86 + 0.075, 2.4, 0.075);
        M.box("timber", s * 0.62 - 0.05, 1.85, -0.05, s * 0.62 + 0.05, 2.45, 0.05, { rot: [0, 0, s * 0.75] });
      }
      M.box("timber", -1.0, 2.3, -0.08, 1.0, 2.42, 0.08);
      M.in(0, 1.78, 0, 0, () => { for (let i = 0; i < 8; i++) M.box("wood", -0.72, -0.05, -0.1, 0.72, 0.05, 0.1, { rot: [i * PI / 8, 0, 0] }); });
      M.box("iron", -0.98, 1.76, -0.02, 0.98, 1.8, 0.02); M.box("iron", 0.98, 1.5, -0.02, 1.02, 1.8, 0.02); M.box("iron", 0.98, 1.48, -0.02, 1.2, 1.52, 0.02);
      M.box("cloth", -0.015, 1.24, 0.09, 0.015, 1.72, 0.12, { tint: LINO });
      M.drum("wood", 0, 0.105, 0.12, 0.98, 1.24, {}, 0.15, 10); M.drum("iron", 0, 0.105, 0.155, 1.19, 1.22, {}, 0.155, 10); M.drum("dark", 0, 0.105, 0.12, 1.24, 1.245, {}, 0.12, 10);
      M.roof("slate", 1.2, -0.6, 0.6, 2.4, 0.75, 0.1);
      M.line(0, 0, 0, 0, 1.0);
    }),
    fontana: (c) => place(c, () => {
      // vasca a sedici lati su un gradino, con lo zoccolo e l'orlo che sporgono; dentro l'acqua; al centro il fusto a nodi,
      // il catino, la seconda colonna e la pigna
      M.drum("stone", 0, 0, 2.62, 0, 0.16, { tint: DARK }, 2.62, 16);
      M.drum("stone", 0, 0, 2.36, 0.16, 0.3, { tint: DARK }, 2.3, 16); M.drum("stone", 0, 0, 2.26, 0.3, 0.68, {}, 2.24, 16); M.drum("stone", 0, 0, 2.36, 0.68, 0.8, { tint: DARK }, 2.36, 16);
      M.drum("glass", 0, 0, 2.0, 0.64, 0.66, {}, 2.0, 16);
      M.drum("stone", 0, 0, 0.5, 0.6, 0.78, { tint: DARK }, 0.42, 10); M.drum("stone", 0, 0, 0.34, 0.78, 1.42, {}, 0.28, 10); M.drum("stone", 0, 0, 0.4, 1.42, 1.52, { tint: DARK }, 0.4, 10);
      M.drum("stone", 0, 0, 0.42, 1.52, 1.72, {}, 1.02, 14); M.drum("stone", 0, 0, 1.06, 1.72, 1.82, { tint: DARK }, 1.06, 14); M.drum("glass", 0, 0, 0.9, 1.78, 1.79, {}, 0.9, 14);
      M.drum("stone", 0, 0, 0.24, 1.72, 2.4, { tint: DARK }, 0.17, 10); M.drum("stone", 0, 0, 0.26, 2.4, 2.48, {}, 0.26, 10); M.drum("stone", 0, 0, 0.2, 2.48, 2.72, {}, 0.12, 8); M.drum("stone", 0, 0, 0.12, 2.72, 2.92, { tint: DARK }, 0.02, 8);
      M.line(0, 0, 0, 0, 2.3);
    }),
    // banco del mercato: il telo a strisce (`tint` e lino), la merce a mucchietti
    banco: (c) => place(c, () => {
      const a = TELI[c.tint ?? "vino"], b = LINO, sx = Math.round(c.at[0]);
      // il piano di tre tavole su due cavalletti, la fascia davanti; quattro pali con le traverse che reggono il telo; il telo
      // a strisce fa una pancia nel mezzo e scende davanti in una balza a punte
      for (let i = 0; i < 3; i++) M.box("wood", -1.5, 0.8, -0.5 + i * 0.35, 1.5, 0.86, -0.17 + i * 0.35, { under: true, tint: i % 2 ? [0.8, 0.76, 0.7] : undefined });
      M.box("timber", -1.5, 0.66, 0.5, 1.5, 0.8, 0.55);
      for (const px of [-1.1, 1.1]) for (const s of [-1, 1]) M.box("timber", px - 0.04, 0, s * 0.3 - 0.04, px + 0.04, 0.8, s * 0.3 + 0.04, { rot: [s * 0.22, 0, 0] });
      for (const px of [-1.4, 1.4]) { M.box("timber", px - 0.05, 0, -0.5, px + 0.05, 2.4, -0.4); M.box("timber", px - 0.05, 0, 0.45, px + 0.05, 2.05, 0.55); M.box("timber", px - 0.035, 2.16, -0.62, px + 0.035, 2.23, 0.9, { rot: [0.26, 0, 0] }); }
      M.box("timber", -1.6, 2.36, -0.49, 1.6, 2.42, -0.41); M.box("timber", -1.6, 2.01, 0.46, 1.6, 2.07, 0.54);
      for (let i = 0; i < 6; i++) {
        const x0 = -1.65 + i * 0.55, x1 = x0 + 0.55, tint = i % 2 ? a : b;
        for (let j = 0; j < 4; j++) {
          const u0 = j / 4, u1 = (j + 1) / 4, sag = (u: number): number => 2.42 - 0.44 * u - 0.09 * Math.sin(u * PI);
          M.face("cloth", [[x0, sag(u0), -0.7 + 1.65 * u0], [x1, sag(u0), -0.7 + 1.65 * u0], [x1, sag(u1), -0.7 + 1.65 * u1], [x0, sag(u1), -0.7 + 1.65 * u1]], [0, 1, 0], { tint });
        }
        M.face("cloth", [[x0, 1.98, 0.95], [x1, 1.98, 0.95], [(x0 + x1) / 2, 1.74, 0.97]], [0, 0, 1], { tint });
      }
      for (let i = 0; i < 5; i++) M.box("cloth", -1.3 + i * 0.56, 0.86, -0.3, -0.9 + i * 0.56, 0.98 + rnd() * 0.12, 0.3, { tint: [RUGGINE, MUSCHIO, OCRA, LINO, VINO][((i + sx + 16) % 5 + 5) % 5] });
      M.solid(-1.5, -0.5, 1.5, 0.55, 0.4);
    }),
    panchina: (c) => place(c, () => {
      // sedile di tre assi, fianchi sagomati con i piedi e il bracciolo, schienale di due assi inclinato
      for (let i = 0; i < 3; i++) M.box("wood", -0.9, 0.38, -0.22 + i * 0.15, 0.9, 0.43, -0.085 + i * 0.15, { under: true, tint: i % 2 ? [0.8, 0.76, 0.7] : undefined });
      for (const s of [-1, 1]) {
        for (const pz of [-0.2, 0.17]) M.box("timber", s * 0.76 - 0.045, 0, pz - 0.045, s * 0.76 + 0.045, 0.38, pz + 0.045);
        M.box("timber", s * 0.76 - 0.04, 0.3, -0.22, s * 0.76 + 0.04, 0.38, 0.22); M.box("timber", s * 0.76 - 0.04, 0.6, -0.26, s * 0.76 + 0.04, 0.66, 0.2);
        M.box("timber", s * 0.76 - 0.04, 0.38, -0.29, s * 0.76 + 0.04, 0.95, -0.21, { rot: [-0.1, 0, 0] }); M.box("timber", s * 0.76 - 0.035, 0.43, 0.13, s * 0.76 + 0.035, 0.6, 0.2);
      }
      for (const yy of [0.56, 0.78]) M.box("wood", -0.9, yy, -0.33, 0.9, yy + 0.16, -0.29, { rot: [-0.1, 0, 0] });
    }),
    "panca.pietra": (c) => place(c, () => { M.box("stone", -0.7, 0.34, -0.22, 0.7, 0.46, 0.22, { under: true }); for (const s of [-1, 1]) M.box("stone", s * 0.5 - 0.12, 0, -0.2, s * 0.5 + 0.12, 0.34, 0.2, { tint: DARK }); }),

    lampione: (c) => lamppost(M, c.at[0], c.at[1]),
    botte: (c) => place(c, () => barrel(M, 0, 0)),
    cassa: (c) => place(c, () => {   // cassa di tavole: i listelli agli spigoli e in croce sui fianchi, il coperchio che sporge
      const s = c.size![0] / 2, h = s * 1.6, b = Math.min(0.07, s * 0.16);
      M.box("wood", -s, 0, -s, s, h, s);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) M.box("timber", sx * s - (sx > 0 ? b : -0) - (sx < 0 ? 0.012 : 0), 0, sz * s - (sz > 0 ? b : 0) - (sz < 0 ? 0.012 : 0), sx * s + (sx > 0 ? 0.012 : b), h, sz * s + (sz > 0 ? 0.012 : b));
      for (const yy of [0, h - b]) for (const g of [-1, 1]) { M.box("timber", -s, yy, g * s - (g > 0 ? 0 : 0.014), s, yy + b, g * s + (g > 0 ? 0.014 : 0)); M.box("timber", g * s - (g > 0 ? 0 : 0.014), yy, -s, g * s + (g > 0 ? 0.014 : 0), yy + b, s); }
      M.box("wood", -s - 0.02, h, -s - 0.02, s + 0.02, h + 0.035, s + 0.02, { under: true, tint: [0.8, 0.76, 0.7] });
      M.line(0, 0, 0, 0, s * 1.2);
    }),
    carretto: (c) => place(c, () => {   // carretto a mano
      M.box("wood", -0.75, 0.55, -0.5, 0.75, 0.63, 0.5, { under: true });
      for (const s of [-1, 1]) {
        M.box("wood", -0.75, 0.63, s * 0.5 - 0.03, 0.75, 0.98, s * 0.5 + 0.03); M.box("timber", -1.75, 0.6, s * 0.44 - 0.03, -0.75, 0.66, s * 0.44 + 0.03, { rot: [0, 0, 0.12] });
        // la ruota: il cerchione a dodici pezzi col ferro attorno, otto raggi, il mozzo
        M.in(0.15, 0.42, s * 0.57, 0, () => {
          for (let i = 0; i < 12; i++) { const a = i / 12 * 2 * PI; M.box("timber", Math.cos(a) * 0.38 - 0.11, Math.sin(a) * 0.38 - 0.035, -0.03, Math.cos(a) * 0.38 + 0.11, Math.sin(a) * 0.38 + 0.035, 0.03, { rot: [0, 0, a + PI / 2], under: true }); }
          for (let i = 0; i < 4; i++) M.box("timber", -0.37, -0.022, -0.018, 0.37, 0.022, 0.018, { rot: [0, 0, i * PI / 4], under: true });
          M.box("iron", -0.07, -0.07, -0.05, 0.07, 0.07, 0.05, { under: true });
        });
      }
      M.box("timber", 0.12, 0.39, -0.6, 0.18, 0.45, 0.6);
      for (const px of [-0.7, 0.7]) M.box("wood", px - 0.03, 0.63, -0.5, px + 0.03, 0.98, 0.5);
      M.box("cloth", -0.6, 0.63, -0.42, 0.6, 1.05, 0.42, { tint: LINO });
      M.solid(-0.75, -0.5, 0.75, 0.5, 0.4);
    }),
    bacheca: (c) => place(c, () => {   // bacheca degli avvisi
      for (const s of [-1, 1]) M.box("timber", s * 0.6 - 0.05, 0, -0.05, s * 0.6 + 0.05, 1.95, 0.05);
      M.box("wood", -0.62, 0.85, -0.03, 0.62, 1.75, 0.03); M.roof("slate", 0.78, -0.12, 0.12, 1.95, 0.3, 0.02);
      M.box("cloth", -0.5, 1.15, 0.03, -0.14, 1.62, 0.04, { tint: LINO }); M.box("cloth", -0.06, 1.25, 0.03, 0.26, 1.6, 0.04, { tint: BIANCO }); M.box("cloth", 0.3, 0.98, 0.03, 0.56, 1.45, 0.04, { tint: LINO, rot: [0, 0, 0.1] });
      M.line(-0.6, 0, 0.6, 0, 0.2);
    }),
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
    for (const c of def.children) PREFABS[c.prefab](c);
  });

  // ── materiali e mesh ──
  const surf = (name: string, tex: ReturnType<typeof masonryTex>, tint?: Color3, rough?: number, relief?: number): Material => {
    const m = surfaceMaterial(scene, `town_${name}`, tex, { tint, rough, relief });
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
    stone: surf("stone", photoTex(scene, "medieval_blocks_05"), new Color3(0.8, 0.78, 0.76), undefined, 0.022), plaster: surf("plaster", photoTex(scene, "plastered_wall_04"), new Color3(0.82, 0.74, 0.6), undefined, 0.004),
    timber: surf("timber", photoTex(scene, "medieval_wood"), new Color3(0.5, 0.42, 0.36), undefined, 0.012), wood: surf("wood", photoTex(scene, "weathered_planks"), new Color3(0.8, 0.72, 0.62), undefined, 0.012),
    slate: surf("slate", photoTex(scene, "roof_slates_02"), new Color3(0.8, 0.82, 0.86), undefined, 0.016), tile: surf("tile", photoTex(scene, "clay_roof_tiles_02"), new Color3(0.85, 0.75, 0.7), undefined, 0.03),
    thatch: surf("thatch", photoTex(scene, "thatch_roof_angled"), new Color3(0.8, 0.74, 0.6), undefined, 0.02), iron: surf("iron", photoTex(scene, "rusty_metal_02"), new Color3(0.5, 0.5, 0.52)),
    cloth: surf("cloth", clothTex(scene), undefined, 0.95),
    flag: surf("flag", photoTex(scene, "monastery_stone_floor"), new Color3(0.8, 0.78, 0.76), undefined, 0.012), sett: surf("sett", photoTex(scene, "cobblestone_floor_08"), new Color3(0.8, 0.78, 0.76), undefined, 0.03),
    cobble: surf("cobble", photoTex(scene, "cobblestone_05"), new Color3(0.8, 0.78, 0.76), undefined, 0.03),
    glass: flat("glass", new Color3(0.03, 0.05, 0.06), Color3.Black()), dark: flat("dark", Color3.Black(), new Color3(0.004, 0.004, 0.004)),
    // ⚠️ HDR: il lume passa appena la soglia del bloom; più acceso diventa una lampadina bianca.
    // Tre materiali con lo stesso colore di partenza: finestre e lanterne seguono l'ora (main.ts), le fiamme no.
    lume: flat("lume", Color3.Black(), new Color3(1.2, 0.5, 0.12)), lamp: flat("lamp", Color3.Black(), new Color3(1.2, 0.5, 0.12)),
    fire: flat("fire", Color3.Black(), new Color3(1.2, 0.5, 0.12)),
  };
  const meshes: Mesh[] = [];
  for (const [k, g] of M.geos) {
    const mesh = g.mesh(`town_${k}`, scene);
    mesh.material = mats[k]; mesh.isPickable = false; mesh.receiveShadows = true; mesh.freezeWorldMatrix();
    meshes.push(mesh);
  }
  // gli interni (interiors.ts): le loro mesh stanno a parte e si accendono da vicino; i battenti degli usci, visti da fuori, stanno con la città
  const built = sites.map((s) => createInterior(scene, { ...s, mason: () => new Mason(), wood: mats.wood, lume: mats.fire }));
  for (const b of built) meshes.push(...b.meshes);
  const fronts = doorFronts(scene, mats.wood);
  if (fronts) meshes.push(fronts);
  const colliders = [...M.colliders, ...built.flatMap((b) => b.colliders)];
  // la luce dei lampioni, cotta sul rettangolo della città (la porta e il suo lampione stanno fuori dalle mura, a ovest)
  bakeLamps(scene, flames, [TOWN.x - hx - 20, TOWN.z - hz - 10, 2 * hx + 30, 2 * hz + 20]);

  // ── il piano degli abitanti: nodi delle strade, collegamenti, posti ──
  const w = (x: number, z: number): [number, number] => [TOWN.x + x, TOWN.z + z];
  // i tracciati del file: ogni punto è un nodo, i punti in fila sono collegati, un punto ripetuto è un incrocio
  const nodes: [number, number, number?][] = [], links: [number, number][] = [], seen = new Map<string, number>();
  for (const line of def.walks) {
    const ids = line.map(([x, z]) => seen.get(`${x},${z}`) ?? (seen.set(`${x},${z}`, nodes.push(w(x, z)) - 1), nodes.length - 1));
    for (let i = 1; i < ids.length; i++) links.push([ids[i - 1], ids[i]]);
  }
  const spots: TownPlan["spots"] = Object.fromEntries(Object.entries(def.spots).map(([k, s]) => [k, { x: TOWN.x + s.at[0], z: TOWN.z + s.at[1], yaw: rad(s.yaw) }]));
  // i nodi di ogni interno in coda a quelli delle strade. Quello davanti all'uscio (il primo) si lega al nodo di strada più
  // vicino fra quelli che si raggiungono dritti, senza attraversare un muro (se non ce n'è, al più vicino: lo segnala `checkPlan`),
  // e a un secondo solo se è un suo vicino lungo la strada: così l'uscio sta "lungo" quel tratto e non diventa una scorciatoia
  // fra due strade (chi la prendesse passerebbe a un passo dalla porta, e la aprirebbe)
  const streets = nodes.length, road = links.slice();
  for (const b of [...built, ...plans]) {
    if (!streets || !b.nodes.length) continue;
    const base = nodes.length, [dx, dz] = b.nodes[0];
    const near = nodes.slice(0, streets).map((n, i) => [Math.hypot(n[0] - dx, n[1] - dz), i]).sort((p, q) => p[0] - q[0]);
    // (dal più vicino, fermandosi al primo buono: provarli tutti contro tutti gli ostacoli costava due secondi di caricamento)
    const clear = ([, i]: number[]): boolean => clearWay(colliders, nodes[i][0], nodes[i][1], dx, dz, TOWN.y, TOWN.y, 0.03);
    const first = near.find(clear), next = first && near.find((n) => road.some(([p, q]) => (p === n[1] && q === first[1]) || (q === n[1] && p === first[1])) && clear(n));
    nodes.push(...b.nodes);
    links.push(...b.links.map(([p, q]): [number, number] => [p + base, q + base]), ...(first ? (next ? [first, next] : [first]) : near.slice(0, 1)).map(([, i]): [number, number] => [i, base]));
    Object.assign(spots, b.spots);
  }
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
  };
  return {
    windows,
    meshes, colliders, plan: { nodes, links, spots },
    floors: built.flatMap((b) => b.floors), doors: built.flatMap((b) => b.doors), interiors: built.map((b) => b.interior), lumi: { finestre: mats.lume as StandardMaterial, lanterne: mats.lamp as StandardMaterial },
  };
}

/**
 * Il controllo della rete degli abitanti (in sviluppo: main.ts lo fa girare all'avvio e lo espone come `checkPlan()`):
 * ogni tratto fra due nodi dev'essere sgombro, ogni nodo raggiungibile dal primo, e da un nodo raggiungibile si deve
 * arrivare dritti a ogni posto (l'ultimo metro non conta: è l'arredo su cui il posto sta). Restituisce i problemi.
 * Dentro gli edifici lo stesso controllo, più fino, lo fa `problems` di layouts.ts (npm run check).
 */
export function checkPlan(town: Town, ground: (x: number, z: number) => number): string[] {
  const { nodes, links, spots } = town.plan, out: string[] = [], y = (n: [number, number, number?]): number => n[2] ?? ground(n[0], n[1]);
  const seen = new Set([0]);
  for (let grew = true; grew;) { grew = false; for (const [a, b] of links) if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; } }
  nodes.forEach((n, i) => { if (!seen.has(i)) out.push(`nodo ${i} (${n[0].toFixed(1)}, ${n[1].toFixed(1)}): staccato dalla rete`); });
  for (const [a, b] of links) {
    const A = nodes[a], B = nodes[b];
    if (!clearWay(town.colliders, A[0], A[1], B[0], B[1], y(A), y(B), 0.03)) out.push(`tratto ${a}–${b} da (${A[0].toFixed(1)}, ${A[1].toFixed(1)}) a (${B[0].toFixed(1)}, ${B[1].toFixed(1)}): sbarrato`);
  }
  for (const [name, s] of Object.entries(spots)) {
    const sy = s.y ?? ground(s.x, s.z), far = (n: [number, number, number?]): number => Math.hypot(n[0] - s.x, n[1] - s.z) + Math.abs(y(n) - sy) * 6;
    const i = nodes.reduce((b, n, k) => (far(n) < far(nodes[b]) ? k : b), 0), N = nodes[i], d = Math.hypot(N[0] - s.x, N[1] - s.z), k = d > 1.4 ? (d - 1.4) / d : 0;
    if (!seen.has(i)) out.push(`${name}: il nodo più vicino (${i}) è staccato dalla rete`);
    else if (!clearWay(town.colliders, N[0], N[1], N[0] + (s.x - N[0]) * k, N[1] + (s.z - N[1]) * k, y(N), y(N) + (sy - y(N)) * k, 0.03)) out.push(`${name}: dal nodo ${i} (${N[0].toFixed(1)}, ${N[1].toFixed(1)}) sbarrato`);
  }
  return out;
}
