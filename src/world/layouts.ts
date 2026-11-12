// ─────────────────────────────────────────────────────────────────────────────
// PIANTE — la disposizione degli interni, in numeri: stanze, vani, scale, arredi, posti con nome, percorsi.
//
// Un modello per tipo di edificio (`layout`): dà una pianta nel riferimento dell'edificio, quello di house() in
// town.ts (origine a terra al centro dell'ingombro, +Z verso la strada, quote dalla strada). Il seme dell'edificio
// (`rnd`) sceglie il verso della scala, dove stanno letto e tavola, quali arredi e contro quale muro: prima si
// tracciano i percorsi, poi gli arredi si posano dove non li intralciano (`Plan.free`).
//
// Qui non c'è Babylon né altro: lo stesso file lo leggono interiors.ts (che ne fa muri, arredi, ostacoli e luce),
// le tavole (docs/reference/citta/tavole.mjs, che lo disegna) e `npm run check` (che prova, per ogni edificio di
// db.json, che ogni posto sia raggiungibile: `problems`). ⚠️ Gira anche con Node, che toglie i tipi e basta:
// niente enum, niente "constructor(private x)", niente import di valori senza estensione.
//
// Convenzioni: un pezzo guarda +Z nel suo riferimento; `turn` (gradi) lo gira come uno yaw: 0 guarda +Z, 90 guarda +X.
// I pezzi da muro hanno l'origine sul muro, gli altri al centro. Il verso dei posti (`deg`) si legge allo stesso modo.
// ─────────────────────────────────────────────────────────────────────────────

export type Side = "x-" | "x+" | "z-" | "z+";
/** x0, z0, x1, z1. */
export type Rect = [number, number, number, number];
export type Finish = "pietra" | "intonaco" | "cotto" | "assi" | "terra" | "lastre";
export type InteriorKind = "casa.povera" | "casa.graticcio" | "casa.ricca" | "cattedrale" | "municipio" | "porta" | "fucina";

/** Una stanza: una scatola vuota col suo pavimento, i suoi quattro muri e il soffitto (piano a travi, o a due falde). */
export interface Room {
  name: string; x0: number; z0: number; x1: number; z1: number;
  /** Quota del pavimento e altezza dei muri (fino al soffitto, o all'imposta delle falde). */
  y: number; h: number;
  floor: Finish; wall: Finish;
  /** Spessore dei muri esterni attorno, e fin dove il muro è di pietra a vista (lo zoccolo delle case povere). */
  t: number; foot?: number;
  /** Tetto a vista: colmo lungo x o z, alto `rise` sopra i muri; `ties` = dove stanno le catene, lungo il colmo. */
  ridge?: "x" | "z"; rise?: number; ties?: number[];
  /** Soffitto piano: il verso delle travi. */
  beams?: "x" | "z";
}

/**
 * Un vano in un muro. `uscio` = la porta sulla strada (coi battenti), `porta` = fra due stanze (con l'anta),
 * `varco` = senza anta, `finestra` = una nicchia coi vetri (non si passa). `at` = centro lungo il muro,
 * `y0` e `h` dal pavimento della stanza.
 */
export interface Opening { kind: "uscio" | "porta" | "varco" | "finestra"; room: string; side: Side; at: number; w: number; h: number; y0: number; to?: string; arch?: boolean }

/** Una rampa dritta: ingombro, da che parte sale, quote, alzate. `under` = chiusa sotto da un assito. `vano` = quanti metri, dalla cima, è aperto il solaio di sopra. */
export interface Stair { rect: Rect; up: Side; y0: number; y1: number; n: number; under: boolean; vano: number }
/** Un impalcato dentro una stanza (pianerottoli); `t` = spessore. */
export interface Deck { rect: Rect; y: number; t: number }
export interface Piece { t: PieceId; x: number; z: number; y: number; turn: number; v?: number; foot?: Rect }
/** Un posto con nome; `node` = è anche un nodo dei percorsi; `on` = ci si sta sopra (letto, sedile): l'arredo che lo contiene non è un ostacolo. */
export interface Place { name: string; x: number; z: number; y: number; deg: number; node: boolean; on?: boolean }

export interface Layout {
  kind: InteriorKind;
  /** Lato massimo dei quadrilateri (la luce sta sui vertici): mezzo metro nelle case, di più nei saloni. */
  cell: number;
  rooms: Room[]; openings: Opening[]; stairs: Stair[]; decks: Deck[];
  /** Superfici su cui si cammina che l'interno non disegna (i gradini davanti alla cattedrale). */
  steps: Deck[];
  /** Parapetti che non stanno attorno al vano di una scala (l'orlo di un pianerottolo). */
  rails: Seg[];
  pieces: Piece[]; places: Place[]; links: [string, string][];
}

/** Ostacolo nel riferimento dell'edificio: un segmento (o un cerchio, se gli estremi coincidono) con la sua fascia d'altezza. */
export interface Seg { ax: number; az: number; bx: number; bz: number; r: number; y0: number; y1: number }

/** Quanto i battenti stanno dietro il filo del muro di facciata. */
export const LIP = 0.08;

interface PieceDef {
  /** Ingombro a terra nel riferimento del pezzo (o il raggio), e altezza dell'ostacolo (0 = non ferma il passo). */
  foot: Rect | number; h: number;
  /** La luce che fa: dx, dy, dz, raggio, forza. */
  glow?: [number, number, number, number, number];
  /** Arredo minuto: sparisce col dettaglio basso. */
  minor?: boolean;
}
const def = <T extends Record<string, PieceDef>>(t: T): T => t;

/** Il catalogo degli arredi: ingombri e luci. Le forme stanno in interiors.ts, i disegni nelle tavole. */
export const PIECES = def({
  // liberi: origine al centro
  tavolo: { foot: [-0.9, -0.78, 0.9, 0.78], h: 0.8 }, tavolino: { foot: [-0.45, -0.35, 0.45, 0.35], h: 0.75 }, tavolone: { foot: [-1.8, -0.55, 1.8, 0.55], h: 0.8 },
  panca: { foot: [-0.8, -0.16, 0.8, 0.16], h: 0.45 }, sgabello: { foot: 0.17, h: 0.45 }, scranno: { foot: [-0.26, -0.26, 0.26, 0.26], h: 1.25 },
  letto: { foot: [-0.5, -1, 0.5, 1], h: 0.6 }, lettone: { foot: [-0.8, -1.05, 0.8, 1.05], h: 0.6 },
  forziere: { foot: [-0.45, -0.25, 0.45, 0.25], h: 0.55 }, botte: { foot: 0.33, h: 0.95 }, sacco: { foot: 0.27, h: 0.5 },
  banco: { foot: [-0.8, -0.3, 0.8, 0.3], h: 1.05 }, scrittoio: { foot: [-0.6, -0.33, 0.6, 0.33], h: 0.95 }, leggio: { foot: 0.25, h: 1.3 },
  fonte: { foot: 0.55, h: 1 }, altare: { foot: [-1.2, -0.5, 1.2, 0.5], h: 1.1 }, "banco.chiesa": { foot: [-0.85, -0.3, 0.85, 0.3], h: 0.9 }, pilastro: { foot: 0.5, h: 3 },
  candeliere: { foot: 0.14, h: 1.6, glow: [0, 1.75, 0, 5, 0.5] }, braciere: { foot: 0.32, h: 0.75, glow: [0, 0.95, 0, 6, 0.7] }, argano: { foot: [-0.8, -0.45, 0.8, 0.45], h: 1.3 },
  // contro un muro: origine sul muro
  scaffale: { foot: [-0.7, 0, 0.7, 0.4], h: 1.9 }, armadio: { foot: [-0.6, 0, 0.6, 0.5], h: 1.9 }, legna: { foot: [-0.7, 0, 0.7, 0.5], h: 0.95 }, rastrelliera: { foot: [-0.7, 0, 0.7, 0.3], h: 2 },
  focolare: { foot: [-0.9, 0, 0.9, 0.9], h: 2.2, glow: [0, 0.65, 0.5, 8, 0.9] }, camino: { foot: [-0.55, 0, 0.55, 2], h: 2.2, glow: [0, 0.6, 2.1, 7, 0.85] }, canna: { foot: [-0.5, 0, 0.5, 1.2], h: 3 },
  "candela.muro": { foot: 0, h: 0, glow: [0, 0.1, 0.17, 4, 0.45] }, stendardo: { foot: 0, h: 0 },
  // appesi o appoggiati
  candelabro: { foot: 0, h: 0, glow: [0, 0.25, 0, 6.5, 0.8] }, candela: { foot: 0, h: 0, glow: [0, 0.22, 0, 3.5, 0.4] }, paiolo: { foot: 0, h: 0 },
  boccale: { foot: 0, h: 0, minor: true }, brocca: { foot: 0, h: 0, minor: true }, ciotola: { foot: 0, h: 0, minor: true },
  cesta: { foot: 0, h: 0, minor: true }, secchio: { foot: 0, h: 0, minor: true }, libri: { foot: 0, h: 0, minor: true },
  // la fucina, all'aperto
  mantice: { foot: [-0.7, 0, 0.7, 0.6], h: 1.1 }, "banco.lavoro": { foot: [-0.8, 0, 0.8, 0.6], h: 0.9 }, attrezzi: { foot: 0, h: 0 },
  tempra: { foot: 0.4, h: 0.6 }, carbone: { foot: 0.45, h: 0.5 }, mola: { foot: [-0.45, -0.25, 0.45, 0.25], h: 1 },
});
export type PieceId = keyof typeof PIECES;

const OPP: Record<Side, Side> = { "x-": "x+", "x+": "x-", "z-": "z+", "z+": "z-" };
/** Un pezzo contro quel muro guarda dentro la stanza. */
const TURN: Record<Side, number> = { "z-": 0, "x-": 90, "z+": 180, "x+": 270 };
const rot = (x: number, z: number, deg: number): [number, number] => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [x * c + z * s, -x * s + z * c]; };

/** Un lato di una stanza: l'asse perpendicolare (0 = x, 1 = z), da che parte guarda il muro, dove sta e da dove a dove corre. */
export function face(r: Room, s: Side): { ax: 0 | 1; dir: 1 | -1; w: number; a0: number; a1: number } {
  return s === "x-" ? { ax: 0, dir: -1, w: r.x0, a0: r.z0, a1: r.z1 } : s === "x+" ? { ax: 0, dir: 1, w: r.x1, a0: r.z0, a1: r.z1 }
    : s === "z-" ? { ax: 1, dir: -1, w: r.z0, a0: r.x0, a1: r.x1 } : { ax: 1, dir: 1, w: r.z1, a0: r.x0, a1: r.x1 };
}
/** Il punto del muro `s` a `at` lungo il muro, `off` metri dentro la stanza. */
export function point(r: Room, s: Side, at: number, off = 0): [number, number] {
  return s === "x-" ? [r.x0 + off, at] : s === "x+" ? [r.x1 - off, at] : s === "z-" ? [at, r.z0 + off] : [at, r.z1 - off];
}

/** Spessore del muro dietro un lato: fino alla stanza accanto, se ce n'è una entro un metro; altrimenti il muro esterno. */
export function thick(L: Layout, r: Room, s: Side): number {
  const f = face(r, s);
  for (const q of L.rooms) {
    if (q === r || q.y >= r.y + r.h || q.y + q.h <= r.y) continue;
    const g = face(q, OPP[s]), gap = (g.w - f.w) * f.dir;
    if (gap > 0.01 && gap <= 1 && Math.min(f.a1, g.a1) - Math.max(f.a0, g.a0) > 0.2) return gap;
  }
  return r.t;
}

/** L'ingombro a terra di un pezzo nel riferimento dell'edificio (`any`: anche di quelli che non fermano il passo). */
export function footprint(p: Piece, any = false): Rect | null {
  const d = PIECES[p.t] as PieceDef, f = p.foot ?? d.foot;
  if (!any && !d.h) return null;
  const r: Rect = typeof f === "number" ? [-f, -f, f, f] : f, [ax, az] = rot(r[0], r[1], p.turn), [bx, bz] = rot(r[2], r[3], p.turn);
  return [Math.min(ax, bx) + p.x, Math.min(az, bz) + p.z, Math.max(ax, bx) + p.x, Math.max(az, bz) + p.z];
}

/** Un punto del riferimento di un pezzo, in quello dell'edificio. */
export function local(p: Piece, dx: number, dz: number): [number, number] { const [x, z] = rot(dx, dz, p.turn); return [p.x + x, p.z + z]; }

/** Le luci di una pianta: quelle degli arredi e le finestre (`n` = da che parte entra la luce). */
export function lamps(L: Layout): { x: number; y: number; z: number; r: number; f: number; n?: [number, number] }[] {
  const out: ReturnType<typeof lamps> = [];
  for (const p of L.pieces) {
    const g = (PIECES[p.t] as PieceDef).glow;
    if (!g) continue;
    const [x, z] = local(p, g[0], p.t === "camino" && p.foot ? p.foot[3] + 0.1 : g[2]);
    out.push({ x, y: p.y + g[1], z, r: g[3], f: g[4] });
  }
  for (const o of L.openings) {
    if (o.kind !== "finestra") continue;
    const r = L.rooms.find((q) => q.name === o.room)!, f = face(r, o.side), [x, z] = point(r, o.side, o.at, 0.12);
    out.push({ x, y: r.y + o.y0 + o.h / 2, z, r: 4 + 1.6 * Math.sqrt(o.w * o.h), f: 0.9, n: f.ax ? [0, -f.dir] : [-f.dir, 0] });
  }
  return out;
}

/**
 * Un rettangolo come capsule lungo il lato lungo: una se è stretto (o se l'arredo è tondo), due o più affiancate se è largo
 * oltre 90 cm, così gli angoli di una tavola o di un lettone restano quasi vivi (una capsula sola li taglierebbe di 30 cm).
 * La usano `solids` qui e chi posa gli arredi a mano (la locanda, la fucina: interiors.ts).
 */
export const caps = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, round = false): Seg[] => {
  const w = x1 - x0, d = z1 - z0, m = Math.min(w, d), n = round ? 1 : Math.max(1, Math.ceil(m / 0.9 - 1e-9)), r = m / n / 2;
  return Array.from({ length: n }, (_, i): Seg => {
    const o = r * (2 * i + 1);
    return w >= d ? { ax: x0 + r, az: z0 + o, bx: x1 - r, bz: z0 + o, r, y0, y1 } : { ax: x0 + o, az: z0 + r, bx: x0 + o, bz: z1 - r, r, y0, y1 };
  });
};

/** I muri che fermano il passo: un segmento a metà spessore per ogni lato di ogni stanza, interrotto dove c'è un vano (e solo alla sua altezza). */
export function walls(L: Layout): Seg[] {
  const out: Seg[] = [];
  for (const r of L.rooms) for (const s of ["x-", "x+", "z-", "z+"] as Side[]) {
    const f = face(r, s), t = thick(L, r, s), w = f.w + f.dir * t / 2, lo = r.y - 0.3, hi = r.y + r.h + 0.3;
    const seg = (a: number, b: number, y0: number, y1: number): void => {
      if (b < a) a = b = (a + b) / 2;
      out.push(f.ax ? { ax: a, az: w, bx: b, bz: w, r: t / 2, y0, y1 } : { ax: w, az: a, bx: w, bz: b, r: t / 2, y0, y1 });
    };
    const gaps = L.openings.filter((o) => o.kind !== "finestra" && ((o.room === r.name && o.side === s) || (o.to === r.name && OPP[o.side] === s))).sort((p, q) => p.at - q.at);
    if (!gaps.length) { seg(f.a0, f.a1, lo, hi); continue; }
    // ⚠️ i vani di uno stesso muro stanno tutti alla stessa quota (lo controlla `problems`): la fascia col varco è una sola
    const src = L.rooms.find((q) => q.name === gaps[0].room)!, g0 = src.y + gaps[0].y0, g1 = g0 + gaps[0].h + 0.3;
    if (g0 > r.y + 0.5) seg(f.a0, f.a1, lo, g0 + 0.25);
    if (hi - g1 > 0.5) seg(f.a0, f.a1, g1, hi);
    let a = f.a0;
    for (const g of gaps) { seg(a, g.at - g.w / 2 - t / 2, g0 > r.y + 0.5 ? g0 + 0.25 : lo, g1); a = g.at + g.w / 2 + t / 2; }
    seg(a, f.a1, g0 > r.y + 0.5 ? g0 + 0.25 : lo, g1);
  }
  return out;
}

/** Il vano che una scala apre nel solaio di sopra (dalla cima in giù per `vano` metri), o null se sopra non c'è solaio da aprire. */
export function vanoRect(s: Stair): Rect | null {
  const [x0, z0, x1, z1] = s.rect, along = s.up[0] === "x", sg = s.up[1] === "+" ? 1 : -1, len = along ? x1 - x0 : z1 - z0;
  if (s.vano >= len) return null;
  return along ? (sg > 0 ? [x1 - s.vano, z0, x1, z1] : [x0, z0, x0 + s.vano, z1]) : (sg > 0 ? [x0, z1 - s.vano, x1, z1] : [x0, z0, x1, z0 + s.vano]);
}

/** Gli altri ostacoli: gli arredi (una capsula sull'ingombro), i fianchi delle scale, i parapetti. */
export function solids(L: Layout): Seg[] {
  const out: Seg[] = [...L.rails];
  for (const p of L.pieces) {
    const f = footprint(p), h = p.t === "pilastro" || p.t === "canna" ? p.v ?? 3 : (PIECES[p.t] as PieceDef).h;
    if (f) out.push(...caps(f[0], f[1], f[2], f[3], p.y, p.y + h, typeof (p.foot ?? (PIECES[p.t] as PieceDef).foot) === "number"));
  }
  for (const s of L.stairs) {
    const [x0, z0, x1, z1] = s.rect, along = s.up[0] === "x", sg = s.up[1] === "+" ? 1 : -1, lo = along ? (sg > 0 ? x0 : x1) : (sg > 0 ? z0 : z1), hi = along ? (sg > 0 ? x1 : x0) : (sg > 0 ? z1 : z0);
    const len = Math.abs(hi - lo), cut = hi - sg * Math.min(s.vano, len), pt = (a: number, b: number): [number, number] => (along ? [a, b] : [b, a]);
    for (const side of along ? [z0, z1] : [x0, x1]) {   // i due fianchi: sotto il solaio fermano solo chi sta sotto, lungo il vano anche chi sta sopra (il parapetto)
      const [ax, az] = pt(lo, side), [cx, cz] = pt(cut, side), [bx, bz] = pt(hi, side);
      if (s.vano < len) out.push({ ax, az, bx: cx, bz: cz, r: 0.06, y0: s.y0 - 0.1, y1: s.under ? s.y1 - 0.9 : s.y1 + 1 });
      out.push({ ax: cx, az: cz, bx, bz, r: 0.06, y0: s.y0 - 0.1, y1: s.y1 + 1 });
    }
    const [px, pz] = pt(cut, along ? z0 : x0), [qx, qz] = pt(cut, along ? z1 : x1);
    if (s.vano < len) out.push({ ax: px, az: pz, bx: qx, bz: qz, r: 0.06, y0: s.y1 - 0.25, y1: s.y1 + 1 });   // il parapetto in testa al vano
    const [ex, ez] = pt(hi, along ? z0 : x0), [fx, fz] = pt(hi, along ? z1 : x1);
    if (s.under) out.push({ ax: ex, az: ez, bx: fx, bz: fz, r: 0.05, y0: s.y0, y1: s.y1 - 0.4 });                               // il fondo del sottoscala: chi sale ci passa sopra
  }
  return out;
}

const dist = (px: number, pz: number, c: Seg): number => {
  const ex = c.bx - c.ax, ez = c.bz - c.az, t = Math.min(1, Math.max(0, ((px - c.ax) * ex + (pz - c.az) * ez) / (ex * ex + ez * ez || 1)));
  return Math.hypot(px - c.ax - ex * t, pz - c.az - ez * t) - c.r;
};
const inside = (r: Rect, x: number, z: number, m = 0): boolean => x > r[0] - m && x < r[2] + m && z > r[1] - m && z < r[3] + m;

/**
 * Il controllo di una pianta: ogni posto deve essere raggiungibile da `porta.fuori` lungo i percorsi, e ogni tratto
 * (fra due nodi, e dal nodo più vicino al posto) deve passare ad almeno `gap` metri da muri e arredi.
 * Restituisce l'elenco dei problemi (vuoto = a posto).
 */
export function problems(L: Layout, gap = 0.22): string[] {
  const out: string[] = [], by = new Map(L.places.map((p) => [p.name, p])), segs = [...walls(L), ...solids(L)];
  for (const r of L.rooms) for (const s of ["x-", "x+", "z-", "z+"] as Side[]) {
    const g = L.openings.filter((o) => o.kind !== "finestra" && ((o.room === r.name && o.side === s) || (o.to === r.name && OPP[o.side] === s)));
    if (new Set(g.map((o) => L.rooms.find((q) => q.name === o.room)!.y + o.y0)).size > 1) out.push(`${r.name} ${s}: vani a quote diverse nello stesso muro`);
  }
  /** Il tratto da a a b è sgombro? `skip` = l'ingombro dell'arredo su cui sta il posto d'arrivo. */
  const clear = (a: Place, b: Place, skip: Rect | null): string | null => {
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
    for (let i = 0; i <= n; i++) {
      const k = i / n, x = a.x + (b.x - a.x) * k, z = a.z + (b.z - a.z) * k, y = a.y + (b.y - a.y) * k;
      if (skip && inside(skip, x, z, 0.3)) continue;
      for (const c of segs) if (y + 1.8 > c.y0 && y + 0.3 < c.y1 && dist(x, z, c) < gap) return `a ${(k * 100).toFixed(0)}% (${x.toFixed(2)}, ${z.toFixed(2)}, quota ${y.toFixed(2)}) da [${[c.ax, c.az, c.bx, c.bz, c.r, c.y0, c.y1].map((v) => +v.toFixed(2)).join(", ")}]`;
    }
    return null;
  };
  const nodes = L.places.filter((p) => p.node), seen = new Set(["porta.fuori"]);
  if (!by.has("porta.fuori")) return ["manca il nodo porta.fuori"];
  for (const [a, b] of L.links) {
    const A = by.get(a), B = by.get(b);
    if (!A?.node || !B?.node) { out.push(`percorso ${a}–${b}: non sono due nodi`); continue; }
    const bad = clear(A, B, null);
    if (bad) out.push(`percorso ${a}–${b}: sbarrato ${bad}`);
  }
  for (let grew = true; grew;) { grew = false; for (const [a, b] of L.links) if (seen.has(a) !== seen.has(b)) { seen.add(a); seen.add(b); grew = true; } }
  for (const p of L.places) {
    if (p.node) { if (!seen.has(p.name)) out.push(`${p.name}: nodo staccato dalla rete`); continue; }
    // come fa un abitante: va al nodo più vicino (un piano di differenza pesa sei volte), poi dritto al posto
    const near = nodes.reduce((b, n) => (Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 6 < Math.hypot(b.x - p.x, b.z - p.z) + Math.abs(b.y - p.y) * 6 ? n : b));
    if (!seen.has(near.name)) { out.push(`${p.name}: il nodo più vicino (${near.name}) è staccato dalla rete`); continue; }
    const own = p.on ? L.pieces.map((q) => footprint(q)).find((f) => f && inside(f, p.x, p.z, 0.05)) ?? null : null;
    const bad = clear(near, p, own);
    if (bad) out.push(`${p.name}: da ${near.name} sbarrato ${bad}`);
  }
  return out;
}

/** Chi compone una pianta: tiene il conto di ciò che è già posato e di dove si deve poter passare. */
class Plan {
  L: Layout; rnd: () => number;
  /** Zone da lasciare sgombre (davanti alle porte, le scale) con la quota a cui valgono. */
  keep: { r: Rect; y: number }[] = [];
  constructor(kind: InteriorKind, cell: number, rnd: () => number) {
    this.L = { kind, cell, rooms: [], openings: [], stairs: [], decks: [], steps: [], rails: [], pieces: [], places: [], links: [] };
    this.rnd = rnd;
  }

  r(name: string): Room { return this.L.rooms.find((q) => q.name === name)!; }
  pick<T>(...a: T[]): T { return a[Math.floor(this.rnd() * a.length)]; }
  /** Gli stessi elementi in un ordine a caso. */
  mix<T>(...a: T[]): T[] { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

  room(name: string, rect: Rect, y: number, h: number, floor: Finish, wall: Finish, t: number, extra: Partial<Room> = {}): void {
    this.L.rooms.push({ name, x0: rect[0], z0: rect[1], x1: rect[2], z1: rect[3], y, h, floor, wall, t, ...extra });
  }

  open(kind: Opening["kind"], room: string, side: Side, at: number, w: number, h: number, y0 = 0, extra: Partial<Opening> = {}): void {
    this.L.openings.push({ kind, room, side, at, w, h, y0, ...extra });
    // un metro sgombro davanti al vano, da tutte e due le parti; davanti a una finestra, mezzo metro (niente armadi contro i vetri)
    const r = this.r(room), f = face(r, side), d = f.dir * (kind === "finestra" ? 0.75 : 1.6), a = at - w / 2 - 0.15, b = at + w / 2 + 0.15, lo = Math.min(f.w - d * 0.7, f.w + d), hi = Math.max(f.w - d * 0.7, f.w + d);
    this.keep.push({ r: f.ax ? [a, lo, b, hi] : [lo, a, hi, b], y: r.y + y0 });
  }

  stair(rect: Rect, up: Side, y0: number, y1: number, n: number, under: boolean, vano: number): void {
    this.L.stairs.push({ rect, up, y0, y1, n, under, vano });
    // sgombri la rampa, un metro al piede e, di sopra, il vano e un metro in cima
    const along = up[0] === "x", sg = up[1] === "+" ? 1 : -1, grow = (r: Rect, lo: number, hi: number): Rect => (along ? [r[0] - lo, r[1], r[2] + hi, r[3]] : [r[0], r[1] - lo, r[2], r[3] + hi]);
    this.keep.push({ r: grow(rect, sg > 0 ? 1 : 0, sg > 0 ? 0 : 1), y: y0 }, { r: grow(rect, sg > 0 ? 0 : 1.1, sg > 0 ? 1.1 : 0), y: y1 });
  }

  node(name: string, x: number, z: number, y: number, deg: number): void { this.L.places.push({ name, x, z, y, deg, node: true }); }
  spot(name: string, x: number, z: number, y: number, deg: number, on = false): void { this.L.places.push({ name, x, z, y, deg: ((deg % 360) + 360) % 360, node: false, on }); }
  /** Collega in fila i nodi dati. */
  link(...names: string[]): void { for (let i = 1; i < names.length; i++) this.L.links.push([names[i - 1], names[i]]); }

  /** Posa un pezzo senza guardare (i pezzi che fanno la pianta: focolari, letti, tavole). */
  put(t: PieceId, x: number, z: number, y: number, turn: number, v?: number, foot?: Rect): Piece {
    const p: Piece = { t, x, z, y, turn: ((turn % 360) + 360) % 360, v, foot };
    this.L.pieces.push(p);
    return p;
  }

  /** Qui un arredo ci sta? Non tocca altri arredi né le zone sgombre, e lascia mezzo metro ai percorsi e all'ultimo tratto verso ogni posto. */
  free(f: Rect, y: number): boolean {
    const hit = (a: Rect, b: Rect, m: number): boolean => a[0] < b[2] + m && a[2] > b[0] - m && a[1] < b[3] + m && a[3] > b[1] - m;
    for (const k of this.keep) if (Math.abs(k.y - y) < 1.2 && hit(k.r, f, 0)) return false;
    for (const p of this.L.pieces) { const g = footprint(p, true); if (g && Math.abs(p.y - y) < 1.2 && hit(g, f, 0.06)) return false; }
    const P = this.L.places, by = (n: string): Place => P.find((p) => p.name === n)!, nodes = P.filter((p) => p.node);
    const lanes: [Place, Place][] = this.L.links.map(([a, b]) => [by(a), by(b)]);
    for (const p of P) if (!p.node) lanes.push([nodes.reduce((b, n) => (Math.hypot(n.x - p.x, n.z - p.z) + Math.abs(n.y - p.y) * 6 < Math.hypot(b.x - p.x, b.z - p.z) + Math.abs(b.y - p.y) * 6 ? n : b)), p]);
    for (const [a, b] of lanes) {
      if (Math.abs(a.y - y) > 1.2 || Math.abs(b.y - y) > 1.2) continue;
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.15));
      for (let i = 0; i <= n; i++) if (inside(f, a.x + (b.x - a.x) * i / n, a.z + (b.z - a.z) * i / n, 0.5)) return false;
    }
    return true;
  }

  /** Posa un pezzo contro uno dei muri dati, nel primo punto libero (a partire da uno a caso); `at` lo vuole lì. */
  wall(t: PieceId, room: string, sides: Side[], o: { v?: number; y?: number; at?: number; foot?: Rect } = {}): Piece | null {
    const r = this.r(room), f = o.foot ?? (PIECES[t] as PieceDef).foot, fr: Rect = typeof f === "number" ? [-f, -f, f, f] : f;
    const hw = Math.max(-fr[0], fr[2]), back = -fr[1];
    for (const s of sides) {
      const fc = face(r, s), lo = fc.a0 + hw + 0.1, hi = fc.a1 - hw - 0.1, n = Math.max(1, Math.floor((hi - lo) / 0.3)), k0 = Math.floor(this.rnd() * (n + 1));
      if (hi < lo) continue;
      for (let i = 0; i <= n; i++) {
        const [x, z] = point(r, s, o.at ?? lo + (hi - lo) * ((k0 + i) % (n + 1)) / n, back ? back + 0.06 : 0);
        const p: Piece = { t, x, z, y: r.y + (o.y ?? 0), turn: TURN[s], v: o.v, foot: o.foot };
        if (this.free(footprint(p, true)!, p.y)) { this.L.pieces.push(p); return p; }
        if (o.at !== undefined) break;
      }
    }
    return null;
  }

  /** Un posto a sedere su un pezzo: (dx, dz) nel riferimento del pezzo, verso relativo al pezzo. */
  seat(name: string, p: Piece, dx: number, dz: number, deg: number): void { const [x, z] = local(p, dx, dz); this.spot(name, x, z, p.y, p.turn + deg, true); }
}

// ── i modelli ────────────────────────────────────────────────────────────────

/** Casa povera: una stanza sola aperta fino alla paglia, il camino che la divide (dietro, il cantuccio caldo del letto). */
function povera(P: Plan, hw: number, hd: number): void {
  const ix = hw - 0.3, iz = hd - 0.3, y = 0.1, dx = -0.4 * hw, D = 0.7 * hw - 0.1, top = 2.7 + iz * 1.2;
  P.room("stanza", [-ix, -iz, ix, iz], y, 2.7, "terra", "intonaco", 0.3, { foot: 0.8, ridge: "x", rise: iz * 1.2, ties: [-ix * 0.55, 0.1] });
  P.open("uscio", "stanza", "z+", dx, 1, 1.9);
  P.open("finestra", "stanza", "z+", 0.45 * hw, 0.8, 0.7, 1.15);
  P.node("porta.fuori", dx, hd + 1.2, 0, 180); P.node("porta", dx, iz - 0.9, y, 180); P.node("stanza", -0.5, 0.3, y, 90); P.node("fondo", -0.5, -iz + 1.2, y, 180);
  P.link("porta.fuori", "porta", "stanza", "fondo");
  P.put("camino", ix, 0, y, 270, top - y, [-0.55, 0, 0.55, D]);
  P.spot("focolare", ix - D - 0.75, 0, y, 90);
  const bed = P.rnd() < 0.5 ? P.put("letto", ix - 1.05, -iz + 0.56, y, 90) : P.put("letto", -ix + 0.56, -iz + 1.05, y, 180);
  P.spot("letto", bed.x, bed.z, y, bed.turn + 180, true);
  // la tavola: nel cantuccio sotto la finestra, o contro il muro di sinistra
  const nook = P.rnd() < 0.5, tb = nook ? P.put("tavolino", ix - 1.05, iz - 0.85, y, 0) : P.put("tavolino", -ix + 0.42, 0.25, y, 90);
  const st = nook ? P.put("sgabello", tb.x - 0.75, tb.z, y, 0) : P.put("sgabello", tb.x + 0.68, tb.z, y, 0);
  P.spot("tavolo.1", st.x, st.z, y, nook ? 90 : 270, true);
  P.put("sgabello", nook ? tb.x : tb.x, nook ? tb.z - 0.68 : tb.z + 0.78, y, 0);
  P.put("candela", tb.x - 0.1, tb.z + 0.05, y + 0.72, 0); P.put(P.pick<PieceId>("ciotola", "boccale", "brocca"), tb.x + 0.2, tb.z - 0.1, y + 0.72, 0);
  for (const t of P.mix<PieceId>("forziere", "scaffale", "botte", "sacco", "sacco", "legna").slice(0, 4 + Math.floor(P.rnd() * 2))) P.wall(t, "stanza", P.mix<Side>("x-", "z-", "z+", "x+"), { v: 2 });
  P.put(P.pick<PieceId>("cesta", "secchio"), ix - D - 0.3, 0.95, y, 0);
}

/** Casa a graticcio: la bottega di pietra a terra (focolare sul fondo, la tavola, il banco sotto la finestra), di sopra una camera sola; la scala lungo il muro di destra. */
function graticcio(P: Plan, hw: number, hd: number): void {
  const ix = hw - 0.4, iz = hd - 0.4, jx = hw - 0.2, zb = -hd + 0.25, zf = hd + 0.1, Y0 = 0.12, Y1 = 3.27, dx = -0.48 * hw, cx = -0.5 * hw + 0.35, run = 4.35, sx = ix - 1.5;   // (la scala è larga un metro e mezzo: in due ci si incrocia)
  P.room("bottega", [-ix, -iz, ix, iz], Y0, 2.83, "cotto", "pietra", 0.4, { beams: "x" });
  P.room("camera", [-jx, zb, jx, zf], Y1, 2.63, "assi", "intonaco", 0.25, { beams: "x" });
  P.open("uscio", "bottega", "z+", dx, 1.15, 1.98, 0, { arch: true });
  P.open("finestra", "bottega", "z+", 0.4 * hw, 1.7, 1.25, 0.83);
  for (const s of [-1, 1]) P.open("finestra", "camera", "z+", s * 0.38 * hw, 0.95, 1.25, 0.83);
  // la scala sale verso il fondo (e si arriva dietro) o verso la strada (e si arriva sotto le finestre)
  const back = P.rnd() < 0.5, zt = back ? zb + 1.15 : -iz + 1.1 + run, z0 = back ? zt + run : -iz + 1.1, e = back ? 1 : -1;
  P.stair([sx, Math.min(zt, z0), ix, Math.max(zt, z0)], back ? "z-" : "z+", Y0, Y1, 16, true, 3.5);
  P.node("porta.fuori", dx, hd + 1.3, 0, 180); P.node("porta", dx, iz - 0.9, Y0, 180); P.node("sala", dx + 0.3, 0.9, Y0, 180); P.node("fondo", dx + 0.3, -iz + 1.85, Y0, 180);
  P.node("scala", ix - 0.75, z0 + (back ? 0.43 : -0.55), Y0, back ? 180 : 0); P.node("scala.cima", ix - 0.75, zt - e * 0.5, Y1, back ? 180 : 0);
  P.node("pianerottolo", sx - 0.7, zt - e * 0.55, Y1, 270); P.node("camera", 0.3, back ? 0 : 1.2, Y1, 0);
  P.link("porta.fuori", "porta", "sala", "fondo");
  // (con la scala larga, dal fondo non ci si arriva più dritti: si passa davanti al piede, rasente al muro di fondo)
  if (!back) { P.node("scala.piede", sx - 0.55, -iz + 0.6, Y0, 90); P.link("fondo", "scala.piede", "scala"); }
  P.link(...(back ? ["porta"] : []), "scala", "scala.cima", "pianerottolo", "camera");
  P.put("focolare", cx, -iz, Y0, 0, 2.83); P.spot("focolare", cx, -iz + 1.65, Y0, 180); P.put("paiolo", cx, -iz + 0.45, Y0, 0);
  const tb = P.put("tavolo", sx - 1.15, -0.3, Y0, 90);
  P.seat("tavolo.1", tb, 0.45, -0.62, 0); P.seat("tavolo.2", tb, -0.45, -0.62, 0);
  P.put("candela", tb.x, tb.z + 0.2, Y0 + 0.76, 0); P.put("brocca", tb.x + 0.1, tb.z - 0.4, Y0 + 0.76, 0); P.put("boccale", tb.x - 0.15, tb.z - 0.65, Y0 + 0.76, 0); P.put("ciotola", tb.x + 0.12, tb.z + 0.6, Y0 + 0.76, 0);
  if (!back) {   // sotto la finestra, il banco di chi vende
    const b = P.put("banco", Math.min(0.4 * hw, sx - 0.95), iz - 0.95, Y0, 0);
    P.spot("banco", b.x, b.z - 0.85, Y0, 0); P.put("ciotola", b.x - 0.4, b.z, Y0 + 1.05, 0); P.put("brocca", b.x + 0.35, b.z + 0.05, Y0 + 1.05, 0);
  }
  P.wall("legna", "bottega", ["z-"], { at: cx + 1.75 });
  for (const t of P.mix<PieceId>("scaffale", "forziere", "botte", "botte", "sacco", "armadio", "panca").slice(0, 3)) P.wall(t, "bottega", P.mix<Side>("x-", "z-", "z+"), { v: P.pick(0, 2) });
  P.wall("candela.muro", "bottega", ["x-"], { y: 1.7, at: 0.6 }); P.put("cesta", cx + 1.15, -iz + 1.25, Y0, 0);
  // di sopra: la canna del camino, il letto grande con la testa al muro, il resto dove capita
  P.put("canna", cx, zb, Y1, 0, 2.63);
  const bz = back ? zf - 1.5 : zb + 2.6, bed = P.put("lettone", -jx + 1.12, bz, Y1, 270);
  P.spot("letto", bed.x, bed.z, Y1, 90, true);
  // un nodo accanto al letto: senza, il nodo più vicino potrebbe essere quello della casa accanto, oltre il muro
  P.node("letto.fianco", bed.x + 0.35, bz + (back ? -1.3 : 1.3), Y1, back ? 0 : 180); P.link("camera", "letto.fianco");
  P.wall("forziere", "camera", ["x-"], { at: bz + (back ? -1.5 : 1.5) });
  const tv = P.wall("tavolino", "camera", P.mix<Side>("z+", "z-", "x-"));
  if (tv) { P.put("candela", tv.x, tv.z, Y1 + 0.72, 0); const s = local(tv, 0, 0.62); P.put("sgabello", s[0], s[1], Y1, 0); }
  for (const t of P.mix<PieceId>("armadio", "scaffale", "forziere", "letto", "sacco").slice(0, 3)) P.wall(t, "camera", P.mix<Side>("x-", "z-", "z+"), { v: 2 });
  P.wall("candela.muro", "camera", ["x+"], { y: 1.7, at: zt - e * 0.6 });
}

/** Casa del ricco: la sala coi due focolari e la tavola lunga, la scala lungo il muro di fondo; di sopra il corridoio, la camera padronale e lo studio. `m` la specchia. */
function ricca(P: Plan, hw: number, hd: number): void {
  const ix = hw - 0.4, iz = hd - 0.4, Y0 = 0.12, Y1 = 3.52, m = P.rnd() < 0.5 ? -1 : 1, T = (deg: number): number => (m > 0 ? deg : 360 - deg);
  const top = m * (ix - 1.1), foot = top - m * 4.8, zs = -iz + 1.7, xp = m * 1.2;
  P.room("sala", [-ix, -iz, ix, iz], Y0, 3.3, "cotto", "pietra", 0.4, { beams: "z" });
  P.room("corridoio", [-ix, -iz, ix, -1.1], Y1, 2.97, "assi", "intonaco", 0.4, { beams: "z" });
  const cam: Rect = m > 0 ? [-ix, -0.8, xp - 0.15, iz] : [xp + 0.15, -0.8, ix, iz], stu: Rect = m > 0 ? [xp + 0.15, -0.8, ix, iz] : [-ix, -0.8, xp - 0.15, iz];
  P.room("camera", cam, Y1, 2.97, "assi", "intonaco", 0.4, { beams: "z" }); P.room("studio", stu, Y1, 2.97, "assi", "intonaco", 0.4, { beams: "z" });
  P.open("uscio", "sala", "z+", 0, 1.7, 2.38, 0, { arch: true });
  for (const s of [-1, 1]) P.open("finestra", "sala", "z+", s * 0.66 * hw, 0.9, 1.4, 0.98);
  P.open("finestra", "camera", "z+", 0, 1, 1.9, 0.68); P.open("finestra", "camera", "z+", -m * 0.6 * hw, 1, 1.9, 0.68); P.open("finestra", "studio", "z+", m * 0.6 * hw, 1, 1.9, 0.68);
  const xc = -m * 1.5, xs = m * (ix - 1.2);
  P.open("porta", "corridoio", "z+", xc, 1.2, 2.15, 0, { to: "camera" }); P.open("porta", "corridoio", "z+", xs, 1.1, 2.15, 0, { to: "studio" });
  P.stair([Math.min(foot, top), -iz, Math.max(foot, top), zs], m > 0 ? "x+" : "x-", Y0, Y1, 17, true, 3.5);
  P.node("porta.fuori", 0, hd + 1.3, 0, 180); P.node("porta", 0, iz - 0.9, Y0, 180); P.node("sala", 0, 1.5, Y0, 180); P.node("sala.lato", -m * 2.2, 1.3, Y0, 180);
  P.node("sala.fondo", -m * 2.2, -1.3, Y0, 180); P.node("scala.piede", foot - m * 0.75, -2.0, Y0, 180); P.node("scala", foot - m * 0.6, -iz + 0.85, Y0, T(90)); P.node("sala.tavola", m * 0.5, 0.7, Y0, 180);
  P.node("scala.cima", top + m * 0.55, -iz + 0.85, Y1, 0); P.node("pianerottolo", top + m * 0.55, -1.75, Y1, T(270)); P.node("studio.porta", xs, -1.75, Y1, 0);
  P.node("corridoio", 0, -1.75, Y1, 180); P.node("camera.porta", xc, -1.75, Y1, 0); P.node("camera", xc, 0.3, Y1, 0); P.node("studio", xs - m * 0.55, 1.5, Y1, 0);
  P.link("porta.fuori", "porta", "sala", "sala.lato", "sala.fondo", "scala.piede", "scala", "scala.cima", "pianerottolo", "studio.porta", "corridoio", "camera.porta", "camera"); P.link("studio.porta", "studio"); P.link("sala", "sala.tavola");
  // la sala: un focolare per muro di fianco (sotto i due comignoli), quello di destra per chi cucina
  P.put("focolare", -ix, 0, Y0, 90, 3.3); P.put("focolare", ix, 0, Y0, 270, 3.3); P.put("paiolo", m * (ix - 0.45), 0, Y0, 0);
  P.spot("focolare", -m * (ix - 1.7), 0.5, Y0, T(270)); P.spot("cucina", m * (ix - 1.7), 0.5, Y0, T(90));
  const tb = P.put("tavolone", m * 0.5, -1.25, Y0, 0);
  for (const [i, x] of [-1.1, 0, 1.1].entries()) { const a = P.put("scranno", tb.x + x, tb.z + 0.9, Y0, 180); P.spot(`tavola.${i + 1}`, a.x, a.z, Y0, 180, true); }   // (dietro la tavola ora passa la scala: si siede solo da questa parte)
  P.put("candelabro", tb.x, tb.z, Y0 + 2.25, 0);
  P.put("candela", tb.x - 0.9, tb.z, Y0 + 0.78, 0); P.put("candela", tb.x + 0.9, tb.z, Y0 + 0.78, 0); P.put("brocca", tb.x + 0.3, tb.z + 0.15, Y0 + 0.78, 0);
  for (const x of [-0.5, 0.1, 1.3]) P.put("boccale", tb.x + x, tb.z - 0.2, Y0 + 0.78, 0);
  P.put("ciotola", tb.x - 1.3, tb.z + 0.2, Y0 + 0.78, 0);
  for (const t of P.mix<PieceId>("scaffale", "scaffale", "armadio", "forziere", "botte", "botte", "panca", "legna")) P.wall(t, "sala", P.mix<Side>("x-", "x+", "z+"), { v: P.pick(0, 2) });
  for (const s of [-1, 1]) P.wall("candela.muro", "sala", ["z+"], { y: 1.8, at: s * 1.55 });
  // di sopra: le due canne attraversano camera e studio
  P.put("canna", -ix, 0, Y1, 90, 2.97); P.put("canna", ix, 0, Y1, 270, 2.97);
  const bed = P.put("lettone", -m * (ix - 1.12), 2.6, Y1, T(270)); P.spot("camera.letto", bed.x, bed.z, Y1, T(90), true);
  P.node("camera.letto.fianco", bed.x + m * 0.3, bed.z - 1.35, Y1, 0); P.link("camera", "camera.letto.fianco");
  P.put("forziere", bed.x + m * 1.45, bed.z, Y1, T(270));
  const tv = P.wall("tavolino", "camera", [m > 0 ? "x+" : "x-"], { at: 1.6 });
  if (tv) { P.put("candela", tv.x, tv.z, Y1 + 0.72, 0); P.put("libri", tv.x, tv.z + 0.2, Y1 + 0.72, 0); const s = local(tv, 0, 0.62); P.put("scranno", s[0], s[1], Y1, tv.turn + 180); }
  for (const t of P.mix<PieceId>("armadio", "forziere", "scaffale")) P.wall(t, "camera", P.mix<Side>("z-", m > 0 ? "x+" : "x-"), { v: 1 });
  const ds = P.put("scrittoio", xs + m * 0.1, iz - 1, Y1, 180), ch = P.put("scranno", ds.x, ds.z - 0.72, Y1, 0);
  P.spot("studio.scrittoio", ch.x, ch.z, Y1, 0, true); P.put("candela", ds.x - 0.4, ds.z + 0.1, Y1 + 0.82, 0); P.put("libri", ds.x + 0.35, ds.z + 0.1, Y1 + 0.82, 0);
  for (const t of ["scaffale", "scaffale", "forziere"] as PieceId[]) P.wall(t, "studio", P.mix<Side>(m > 0 ? "x-" : "x+", "z-"), { v: 1 });
  for (const x of [-2, 1.6]) P.wall("candela.muro", "corridoio", ["z+"], { y: 1.75, at: x * m });
}

/**
 * Cattedrale: il nartece fra le torri, la navata a tetto in vista coi pilastri e i banchi, l'abside con l'altare.
 * ponytail: le torri restano chiuse (le loro porte sono finte) e il rosone da dentro non si vede: il nartece ha il soffitto
 * più in basso. Una galleria sopra il nartece, con la scala in una torre, quando servirà; la cripta è la fase 9.
 */
function cattedrale(P: Plan): void {
  const y = 0.45, L = 11.5;
  P.room("navata", [-5.9, -10.9, 5.9, 4.9], y, 10.4, "lastre", "pietra", 0.6, { ridge: "z", rise: 5.4, ties: [-6, -1.7, 2.6] });
  P.room("nartece", [-3.1, 5.5, 3.1, 10.6], y, 6.6, "lastre", "pietra", 0.6, { beams: "x" });
  P.room("abside", [-3.4, -14, 3.4, -11.5], y + 0.15, 6.9, "lastre", "pietra", 0.5, { beams: "x" });
  P.open("uscio", "nartece", "z+", 0, 3.2, 4.95, 0, { arch: true });
  P.open("varco", "navata", "z+", 0, 4.6, 6, 0, { to: "nartece", arch: true }); P.open("varco", "abside", "z+", 0, 5.2, 6.6, 0, { to: "navata", arch: true });
  for (const s of ["x-", "x+"] as Side[]) for (let i = 0; i < 4; i++) P.open("finestra", "navata", s, -L + 3.35 + i * 4.3, 1.15, 4.6, 2.95, { arch: true });
  for (let i = 0; i < 3; i++) P.L.steps.push({ rect: [-3.4 - i * 0.3, L - 0.3, 3.4 + i * 0.3, L + 0.4 + i * 0.6], y: 0.45 - i * 0.15, t: 0 });
  P.node("porta.fuori", 0, L + 2.6, 0, 180); P.node("porta", 0, 9.3, y, 180); P.node("nartece", 0, 6.8, y, 180); P.node("navata", 0, 3.4, y, 180);
  P.node("navata.fondo", 0, -8.6, y, 180);
  for (const [n, s] of [["nord", 1], ["sud", -1]] as [string, number][]) { P.node(`navatella.${n}`, s * 4.5, 3.4, y, 180); P.node(`navatella.${n}.fondo`, s * 4.5, -8.6, y, 180); P.link("navata", `navatella.${n}`, `navatella.${n}.fondo`, "navata.fondo"); }
  P.link("porta.fuori", "porta", "nartece", "navata");
  P.spot("altare", 0, -11.3, y + 0.15, 180);
  for (const s of [-1, 1]) for (const z of [-6, -1.7, 2.6]) P.put("pilastro", s * 3, z, y, 0, 10.4);
  P.put("altare", 0, -12.95, y + 0.15, 0);
  for (const s of [-1, 1]) { P.put("candeliere", s * 1.75, -12.6, y + 0.15, 0); P.put("candeliere", s * 3.75, -10.2, y, 0); }
  // sei file di banchi ai lati della corsia: ogni fila ha il suo nodo, e ci si siede dal capo verso la corsia
  const rows = [1.6, 0.2, -1.2, -2.6, -4, -5.4];
  rows.forEach((z, r) => {
    P.node(`navata.${r + 1}`, 0, z, y, 180); P.link(r ? `navata.${r}` : "navata", `navata.${r + 1}`);
    [-1, 1].forEach((s, k) => P.seat(`banco${r + 1}.${k + 1}`, P.put("banco.chiesa", s * 1.6, z, y, 180), s * 0.5, 0.05, 0));
  });
  P.link(`navata.${rows.length}`, "navata.fondo");
  P.put("leggio", -2.1, -9.5, y, 0); P.spot("leggio", -2.1, -8.85, y, 180);
  P.put("fonte", -2.1, 8.1, y, 0); P.spot("fonte", -1.1, 8.1, y, 270);
  for (const z of [-4, 1]) P.put("candelabro", 0, z, y + 5.2, 0, 2);
  for (const s of ["x-", "x+"] as Side[]) for (const z of [-6, -1.7, 2.6]) P.wall("candela.muro", "navata", [s], { y: 2, at: z });
  for (const s of ["x-", "x+"] as Side[]) { P.wall("panca", "nartece", [s], { at: 6.5 }); P.wall("candela.muro", "nartece", [s], { y: 2, at: 9.2 }); P.wall("stendardo", "abside", [s], { y: 2.2, at: -12.7 }); }
}

/** Municipio: l'atrio con la scala, l'archivio e l'esattoria a terra; di sopra il corridoio, la sala del consiglio e lo studio. ponytail: la torre dell'orologio resta chiusa, il balcone non si apre. */
function municipio(P: Plan): void {
  const Y0 = 0.12, Y1 = 4.5, zs = -2.9;
  P.room("atrio", [-4.2, -4.9, 4.2, 4.9], Y0, 4.13, "lastre", "pietra", 0.6, { beams: "z" });
  P.room("archivio", [-10.4, -4.9, -4.5, 4.9], Y0, 4.13, "cotto", "pietra", 0.6, { beams: "z" }); P.room("esattoria", [4.5, -4.9, 10.4, 4.9], Y0, 4.13, "cotto", "pietra", 0.6, { beams: "z" });
  P.room("corridoio", [-10.5, -5, 10.5, -1.5], Y1, 4.5, "assi", "intonaco", 0.4, { beams: "z" });
  P.room("consiglio", [-10.5, -1.2, 1.4, 5], Y1, 4.5, "assi", "intonaco", 0.4, { beams: "z" }); P.room("studio", [1.7, -1.2, 10.5, 5], Y1, 4.5, "assi", "intonaco", 0.4, { beams: "z" });
  P.open("uscio", "atrio", "z+", 0, 2.8, 3.58, 0, { arch: true });
  P.open("porta", "atrio", "x-", 1.6, 1.2, 2.15, 0, { to: "archivio" }); P.open("porta", "atrio", "x+", 1.6, 1.2, 2.15, 0, { to: "esattoria" });
  P.open("porta", "corridoio", "z+", -4.5, 1.4, 2.3, 0, { to: "consiglio" }); P.open("porta", "corridoio", "z+", 6, 1.2, 2.15, 0, { to: "studio" });
  for (const x of [-8.4, -4.2]) P.open("finestra", "consiglio", "z+", x, 1.3, 2.7, 1.1, { arch: true });
  P.open("finestra", "consiglio", "z+", 0, 1.5, 3.3, 0.6, { arch: true });
  for (const x of [4.2, 8.4]) P.open("finestra", "studio", "z+", x, 1.3, 2.7, 1.1, { arch: true });
  P.stair([-3, -4.9, 3.09, zs], "x+", Y0, Y1, 22, true, 3.6);
  P.node("porta.fuori", 0, 6.9, 0, 180); P.node("porta", 0, 3.8, Y0, 180); P.node("atrio", 0, 1.6, Y0, 180); P.node("atrio.fondo", -3.6, -2.4, Y0, 180); P.node("scala", -3.5, -3.9, Y0, 90);
  P.node("archivio.porta", -3.4, 1.6, Y0, 270); P.node("archivio", -6.2, 1.6, Y0, 270); P.node("esattoria.porta", 3.4, 1.6, Y0, 90); P.node("esattoria", 5.6, 1.6, Y0, 90); P.node("esattoria.varco", 7.4, -1, Y0, 90); P.node("esattoria.dietro", 8.6, 0.9, Y0, 270);
  P.node("scala.cima", 3.65, -3.9, Y1, 0); P.node("pianerottolo", 3.65, -2.2, Y1, 270); P.node("studio.porta", 6, -2.2, Y1, 0); P.node("studio", 6, 0, Y1, 0);
  P.node("consiglio.porta", -4.5, -2.2, Y1, 0); P.node("consiglio", -4.5, -0.4, Y1, 0);
  P.link("porta.fuori", "porta", "atrio", "atrio.fondo", "scala", "scala.cima", "pianerottolo", "studio.porta", "studio"); P.link("pianerottolo", "consiglio.porta", "consiglio");
  P.link("atrio", "archivio.porta", "archivio"); P.link("atrio", "esattoria.porta", "esattoria", "esattoria.varco", "esattoria.dietro");
  // atrio
  P.put("candelabro", 0, 0.6, Y0 + 2.9, 0);
  for (const s of ["x-", "x+"] as Side[]) { P.wall("panca", "atrio", [s], { at: -0.4 }); P.wall("stendardo", "atrio", [s], { y: 2.4, at: -0.4 }); P.wall("candela.muro", "atrio", [s], { y: 2, at: 3.6 }); P.wall("candela.muro", "atrio", [s], { y: 2, at: -2.4 }); }
  // archivio: scaffali di carte lungo i muri, lo scrittoio dell'archivista
  for (const z of [-3.6, -2, 3.7]) P.wall("scaffale", "archivio", ["x-"], { v: 1, at: z });
  for (const x of [-9.4, -7.8, -6.2]) P.wall("scaffale", "archivio", ["z-"], { v: 1, at: x });
  for (const x of [-9.3, -7.7]) P.wall("scaffale", "archivio", ["z+"], { v: 1, at: x });
  const d1 = P.put("scrittoio", -8.4, 1, Y0, 90), c1 = P.put("scranno", d1.x + 0.72, d1.z, Y0, 270);
  P.spot("archivio.scrittoio", c1.x, c1.z, Y0, 270, true); P.put("candela", d1.x, d1.z - 0.4, Y0 + 0.82, 0); P.put("libri", d1.x, d1.z + 0.3, Y0 + 0.82, 0);
  P.wall("forziere", "archivio", ["x+"], { at: -2.6 }); P.wall("forziere", "archivio", ["x+"], { at: -1.4 }); P.wall("candela.muro", "archivio", ["x+"], { y: 2, at: 3.6 }); P.wall("candela.muro", "archivio", ["x-"], { y: 2, at: 0.6 });
  // esattoria: il banco dove si paga, i forzieri dietro, la rastrelliera delle guardie
  const b1 = P.put("banco", 7.4, 0.8, Y0, 270), b2 = P.put("banco", 7.4, 2.4, Y0, 270);
  P.spot("esattoria.banco", b1.x - 0.85, 1.6, Y0, 90); P.spot("esattoria.esattore", b1.x + 0.95, 1.6, Y0, 270);
  P.put("candela", b1.x, b1.z + 0.3, Y0 + 1.05, 0); P.put("libri", b2.x, b2.z - 0.2, Y0 + 1.05, 0); P.put("scranno", 8.8, 2.6, Y0, 270);
  for (const z of [-0.6, 0.6]) P.wall("forziere", "esattoria", ["x+"], { at: z });
  P.wall("rastrelliera", "esattoria", ["z-"], { at: 6 }); P.wall("scaffale", "esattoria", ["z-"], { v: 1, at: 8.8 }); P.wall("armadio", "esattoria", ["z+"], { at: 9 });
  P.wall("candela.muro", "esattoria", ["x-"], { y: 2, at: 3.6 }); P.wall("candela.muro", "esattoria", ["x+"], { y: 2, at: 3 }); P.wall("panca", "esattoria", ["z+"], { at: 6 });
  // sala del consiglio: due tavole in fila, gli scranni attorno, lo stendardo sul fondo
  const t1 = P.put("tavolone", -6.3, 1.9, Y1, 0), t2 = P.put("tavolone", -2.7, 1.9, Y1, 0);
  [t1, t2].forEach((t, k) => [-1.2, 0, 1.2].forEach((x, i) => { const a = P.put("scranno", t.x + x, t.z - 0.9, Y1, 0); P.spot(`consiglio.scranno${k * 3 + i + 1}`, a.x, a.z, Y1, 0, true); P.put("scranno", t.x + x, t.z + 0.9, Y1, 180); }));
  P.put("scranno", -8.75, 1.9, Y1, 90);
  for (const t of [t1, t2]) { P.put("candelabro", t.x, t.z, Y1 + 2.9, 0); P.put("candela", t.x - 0.8, t.z, Y1 + 0.78, 0); P.put("libri", t.x + 0.5, t.z + 0.1, Y1 + 0.78, 0); P.put("brocca", t.x + 1.2, t.z - 0.1, Y1 + 0.78, 0); }
  P.wall("stendardo", "consiglio", ["x-"], { y: 2.6, at: 1.9 }); P.wall("panca", "consiglio", ["z-"], { at: -8.6 }); P.wall("panca", "consiglio", ["z-"], { at: -1 }); P.wall("forziere", "consiglio", ["x+"], { at: 3.6 });
  for (const x of [-9.4, -6.3, -2.1]) P.wall("candela.muro", "consiglio", ["z-"], { y: 2.1, at: x });
  // studio: lo scrittoio davanti alla finestra, i registri
  const d2 = P.put("scrittoio", 4.2, 3.6, Y1, 180), c2 = P.put("scranno", d2.x, d2.z - 0.72, Y1, 0);
  P.spot("studio.scrittoio", c2.x, c2.z, Y1, 0, true); P.put("candela", d2.x - 0.4, d2.z + 0.1, Y1 + 0.82, 0); P.put("libri", d2.x + 0.3, d2.z + 0.1, Y1 + 0.82, 0);
  for (const z of [0.4, 2, 3.6]) P.wall("scaffale", "studio", ["x+"], { v: 1, at: z });
  P.wall("forziere", "studio", ["x-"], { at: 3.8 }); P.wall("armadio", "studio", ["z-"], { at: 9.3 }); P.wall("panca", "studio", ["z-"], { at: 3.4 }); P.wall("stendardo", "studio", ["x-"], { y: 2.6, at: 1.4 });
  const tv = P.put("tavolino", 8.3, 3.5, Y1, 0); P.put("scranno", tv.x - 0.75, tv.z, Y1, 90); P.put("brocca", tv.x, tv.z, Y1 + 0.72, 0); P.put("boccale", tv.x - 0.2, tv.z + 0.15, Y1 + 0.72, 0);
  for (const x of [3, 8.5]) P.wall("candela.muro", "studio", ["z-"], { y: 2.1, at: x });
  for (const x of [-7.5, -2.2, 7.8]) P.wall("candela.muro", "corridoio", ["z+"], { y: 2, at: x });
  P.wall("panca", "corridoio", ["z+"], { at: -8 }); P.wall("forziere", "corridoio", ["x-"], { at: -3.4 });
}

/** Porta della città (qui +Z è verso la città): nella torre sud il posto di guardia e due rampe ripide; sopra il fornice, il corpo di guardia con l'argano della saracinesca. */
function porta(P: Plan): void {
  const Y0 = 0.12, Ym = 2.71, Y1 = 5.3;
  P.room("torre", [2.5, -2.3, 4.7, 2.3], Y0, 8.3, "lastre", "pietra", 0.3, { beams: "x" });
  P.room("guardia", [-4.7, -2.3, 2.2, 2.3], Y1, 3.12, "assi", "pietra", 0.3, { beams: "z" });
  P.open("uscio", "torre", "z+", 3.6, 1.1, 2.08, 0, { arch: true });
  P.open("varco", "torre", "x-", 1.8, 1, 2.1, Y1 - Y0, { to: "guardia" });
  P.stair([2.5, -1.3, 3.55, 1.3], "z-", Y0, Ym, 10, true, 9); P.stair([3.65, -1.3, 4.7, 1.3], "z+", Ym, Y1, 10, false, 9);
  P.L.decks.push({ rect: [2.5, -2.3, 4.7, -1.3], y: Ym, t: 0.15 }, { rect: [2.5, 1.3, 4.7, 2.3], y: Y1, t: 0.15 });
  P.L.rails.push({ ax: 2.5, az: 1.3, bx: 3.6, bz: 1.3, r: 0.06, y0: Y1 - 0.25, y1: Y1 + 1 });   // l'orlo del pianerottolo di cima sopra la prima rampa
  P.node("porta.fuori", 3.6, 3.8, 0, 180); P.node("porta", 3.75, 1.8, Y0, 180); P.node("scala", 3.03, 1.75, Y0, 180); P.node("scala.mezzo", 3.03, -1.8, Ym, 90);
  P.node("scala.mezzo2", 4.17, -1.8, Ym, 0); P.node("scala.cima", 4.17, 1.8, Y1, 270); P.node("varco", 3.05, 1.8, Y1, 270); P.node("guardia.porta", 1.4, 1.8, Y1, 270); P.node("guardia", -0.2, 0.3, Y1, 270); P.node("guardia.fondo", -3.2, 0, Y1, 270);
  P.link("porta.fuori", "porta", "scala", "scala.mezzo", "scala.mezzo2", "scala.cima", "varco", "guardia.porta", "guardia", "guardia.fondo");
  P.wall("candela.muro", "torre", ["x+"], { y: 1.9, at: 1.9 }); P.wall("candela.muro", "torre", ["z-"], { y: Ym + 1.8, at: 3.6 }); P.wall("candela.muro", "torre", ["x+"], { y: Y1 + 1.7, at: 1.8 });
  P.put("sgabello", 4.3, 0.9, Y0, 0); P.wall("rastrelliera", "torre", ["x+"], { at: -0.3 }); P.put("botte", 4.3, -0.95, Y0, 0);
  // il corpo di guardia
  P.put("braciere", 0.6, -0.4, Y1, 0);
  P.put("argano", -1, -1.75, Y1, 0); P.spot("guardia.argano", -1, -0.85, Y1, 180);
  const tb = P.put("tavolo", -1.9, 1.5, Y1, 0);
  P.seat("guardia.tavolo.1", tb, 0.45, -0.62, 0); P.seat("guardia.tavolo.2", tb, -0.45, -0.62, 0);
  P.put("candela", tb.x, tb.z, Y1 + 0.76, 0); P.put("boccale", tb.x + 0.4, tb.z - 0.15, Y1 + 0.76, 0); P.put("boccale", tb.x - 0.5, tb.z + 0.1, Y1 + 0.76, 0); P.put("brocca", tb.x - 0.1, tb.z + 0.15, Y1 + 0.76, 0);
  for (const [i, z] of [-1.25, 1.25].entries()) { const b = P.put("letto", -4.14, z, Y1, i ? 0 : 180); P.spot(`guardia.branda${i + 1}.letto`, b.x, b.z, Y1, b.turn + 180, true); }
  P.wall("rastrelliera", "guardia", ["z-"], { at: 1.3 }); P.wall("rastrelliera", "guardia", ["z-"], { at: -2.75 }); P.wall("forziere", "guardia", ["z+"], { at: 0.2 }); P.wall("botte", "guardia", ["z+"], { at: -0.9 });
  for (const x of [-2.6, 0.9]) P.wall("candela.muro", "guardia", ["z+"], { y: 1.8, at: x });
  P.wall("candela.muro", "guardia", ["z-"], { y: 1.8, at: -1 });
}

/**
 * Fucina: è una tettoia aperta sulla via e resta aperta. Qui stanno solo gli attrezzi del fabbro attorno alla forgia e
 * all'incudine che ci sono già, e i posti.
 * ponytail: niente uscio da aprire con E. Una stanza chiusa (la casa del fabbro) andrebbe aggiunta dietro il muro di fondo:
 * sarebbe un volume nuovo, che si vede da fuori.
 */
function fucina(P: Plan): void {
  P.node("porta.fuori", 0.9, 3.9, 0, 180); P.node("porta", 1.1, 1.9, 0, 180); P.node("bottega", 1, 0.2, 0, 180); P.link("porta.fuori", "porta", "bottega");
  P.spot("incudine", 0.2, 2.3, 0, 180); P.spot("forgia", -2.1, -0.15, 0, 180); P.spot("mantice", -0.5, -1.05, 0, 180); P.spot("banco", 1.3, -1.05, 0, 180); P.spot("tempra", -0.75, 0.35, 0, 270);
  P.put("mantice", -0.5, -2.4, 0, 0); P.put("banco.lavoro", 1.3, -2.4, 0, 0); P.put("attrezzi", 1.3, -2.4, 1.25, 0);
  P.put("tempra", -1.55, 0.6, 0, 0); P.put("carbone", -2.5, 1.5, 0, 0); P.put("mola", 2.45, 0.9, 0, 90);
}

/** Il seme della pianta di un edificio: quello che dice il file, o uno ricavato dal suo nome. */
export const seedOf = (c: { id?: string; seed?: number }): number => c.seed ?? [...(c.id ?? "")].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 7);

/** I vani di facciata che town.ts deve aprire: l'uscio di ogni tipo (centro, larghezza, altezza dalla strada, se a sesto acuto). */
export function entry(kind: InteriorKind, w: number): { x: number; w: number; h: number; arch: boolean } {
  return kind === "casa.povera" ? { x: -0.2 * w, w: 1, h: 2, arch: false } : kind === "casa.graticcio" ? { x: -0.24 * w, w: 1.15, h: 2.1, arch: true }
    : kind === "casa.ricca" ? { x: 0, w: 1.7, h: 2.5, arch: true } : kind === "cattedrale" ? { x: 0, w: 3.2, h: 5.4, arch: true }
      : kind === "municipio" ? { x: 0, w: 2.8, h: 3.7, arch: true } : { x: 3.6, w: 1.1, h: 2.2, arch: true };
}

/** La pianta di un edificio: tipo, ingombro (larghezza e profondità: solo le case lo usano), i numeri a caso del suo seme. */
export function layout(kind: InteriorKind, w: number, d: number, rnd: () => number): Layout {
  const P = new Plan(kind, kind.startsWith("casa.") ? 0.5 : kind === "porta" ? 0.6 : 0.9, rnd);
  if (kind === "casa.povera") povera(P, w / 2, d / 2);
  else if (kind === "casa.graticcio") graticcio(P, w / 2, d / 2);
  else if (kind === "casa.ricca") ricca(P, w / 2, d / 2);
  else if (kind === "cattedrale") cattedrale(P);
  else if (kind === "municipio") municipio(P);
  else if (kind === "porta") porta(P);
  else fucina(P);
  return P.L;
}
