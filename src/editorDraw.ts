import { Color4, Matrix, MeshBuilder, PointerEventTypes, Vector3, type AbstractMesh, type FreeCamera, type LinesMesh, type PointerInfo, type Scene } from "@babylonjs/core";
import { TOWN } from "./world/terrain";
import { checkPlan, type Town } from "./world/town";

// ─────────────────────────────────────────────────────────────────────────────
// EDITOR DELLA MAPPA, fase 2 (docs/editor.md): disegnare ciò che nel file è una linea, un rettangolo o un punto.
//   percorsi  i tracciati degli abitanti (`walks`): spezzate; un punto ripetuto è un incrocio
//   posti     i punti con un nome dove qualcuno si ferma (`spots`), col verso in cui guarda
//   verde     le zone verdi dentro le mura (`green`): rettangoli dati da due angoli
//   selciati  le strisce di selciato (`paving`): dritte lungo x o lungo z, con larghezza e tipo
//   strade    sentieri e strade fuori città (`roads`): spezzate nelle coordinate del MONDO, non della città
// Tutto si vede come linee sopra la scena (anche attraverso i muri) e si tocca nello spazio dello SCHERMO: il punto o il
// tratto più vicino al puntatore, entro qualche pixel. Mentre si disegnano percorsi e posti la rete degli abitanti si
// ricontrolla da sola (la stessa `checkPlan` che il gioco fa all'avvio) e i problemi si vedono come croci rosse.
// ─────────────────────────────────────────────────────────────────────────────

type XZ = [number, number];
export interface DrawDoc {
  walks: XZ[][]; green: XZ[][];
  spots: Record<string, { at: XZ; yaw: number }>;
  paving: { kind: string; width: number; line: XZ[] }[];
  roads: { id: string; kind: string; line: XZ[]; to?: string }[];
}
export type Layer = "percorsi" | "posti" | "verde" | "selciati" | "strade";
export const LAYERS: Layer[] = ["percorsi", "posti", "verde", "selciati", "strade"];
const PAVINGS = ["lastre", "lastre.diagonali", "cubetti", "ciottoli"];

export interface DrawCtx {
  scene: Scene; cam: FreeCamera; town: Town; ground: (x: number, z: number) => number; terrain: AbstractMesh;
  doc: () => DrawDoc; commit: () => void; changed: () => void;
  /** Chi usa un posto (abitanti, forzieri, luoghi): un posto usato non si rinomina né si toglie. */
  uses: (spot: string) => string[];
  /** I selciati sono cambiati (o potrebbero): l'editor li rifà dal vivo. */
  paved: () => void;
}

const r3 = (v: number): number => Math.round(v * 1000) / 1000, grid = (v: number): number => Math.round(v * 4) / 4;

export function createDraw(ctx: DrawCtx) {
  const { scene, cam } = ctx;
  let layer: Layer | null = null, lines: LinesMesh | null = null;
  /** Ciò che è scelto: una forma (indice, o nome per i posti) e, se c'è, un suo punto. */
  let sel: { s: number | string; v: number } | null = null;
  /** Una forma che si sta disegnando: i punti messi finora (nelle coordinate del livello). */
  let drawing: XZ[] | null = null;
  let drag: { s: number | string; v: number; moving: [XZ, number][]; grab?: XZ; orig?: XZ[] } | null = null;
  let problems: string[] = [], checkTimer = 0;
  const worldOf = (p: XZ): XZ => (layer === "strade" ? p : [TOWN.x + p[0], TOWN.z + p[1]]);
  const localOf = (x: number, z: number): XZ => (layer === "strade" ? [grid(x), grid(z)] : [grid(x - TOWN.x), grid(z - TOWN.z)]);

  /** Le forme del livello: i loro punti (nelle coordinate del livello) e se sono chiuse. Per i posti, un punto ciascuno. */
  function shapes(): { key: number | string; pts: XZ[]; closed?: boolean }[] {
    const d = ctx.doc();
    switch (layer) {
      case "percorsi": return d.walks.map((pts, i) => ({ key: i, pts }));
      case "strade": return d.roads.map((r, i) => ({ key: i, pts: r.line }));
      case "selciati": return d.paving.map((p, i) => ({ key: i, pts: p.line }));
      case "verde": return d.green.map(([a, b], i) => ({ key: i, pts: [a, [b[0], a[1]], b, [a[0], b[1]]], closed: true }));
      case "posti": return Object.entries(d.spots).map(([k, s]) => ({ key: k, pts: [s.at] }));
      default: return [];
    }
  }
  /** Sposta il punto `v` della forma `s` in `p` (coordinate del livello), rispettando le regole della forma. */
  function setPoint(s: number | string, v: number, p: XZ): void {
    const d = ctx.doc();
    if (layer === "posti") { d.spots[s as string].at = p; return; }
    if (layer === "verde") {   // gli angoli derivati muovono le coordinate dei due angoli scritti
      const [a, b] = d.green[s as number];
      if (v === 0) { a[0] = p[0]; a[1] = p[1]; } else if (v === 1) { b[0] = p[0]; a[1] = p[1]; } else if (v === 2) { b[0] = p[0]; b[1] = p[1]; } else { a[0] = p[0]; b[1] = p[1]; }
      return;
    }
    if (layer === "selciati") {   // una striscia resta dritta: il capo mosso si allinea all'altro lungo l'asse dove si è spostato di più
      const line = d.paving[s as number].line, o = line[1 - v];
      line[v] = Math.abs(p[0] - o[0]) >= Math.abs(p[1] - o[1]) ? [p[0], o[1]] : [o[0], p[1]];
      return;
    }
    const line = layer === "percorsi" ? d.walks[s as number] : d.roads[s as number].line;
    line[v] = p;
  }

  // ── il disegno: linee sopra la scena ──
  const Y = (x: number, z: number): number => ctx.ground(x, z) + 0.25;
  function refresh(): void {
    lines?.dispose(); lines = null;
    ctx.paved();   // (rifà i selciati solo se sono cambiati: anche dopo un annulla da un altro livello)
    if (!layer) return;
    const segs: Vector3[][] = [], cols: Color4[][] = [];
    const add = (a: XZ, b: XZ, c: Color4): void => {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));   // (a tratti, così seguono il terreno)
      const pts = Array.from({ length: n + 1 }, (_, i) => { const x = a[0] + (b[0] - a[0]) * i / n, z = a[1] + (b[1] - a[1]) * i / n; return new Vector3(x, Y(x, z), z); });
      segs.push(pts); cols.push(pts.map(() => c));
    };
    const cross = (p: XZ, r: number, c: Color4): void => { add([p[0] - r, p[1] - r], [p[0] + r, p[1] + r], c); add([p[0] - r, p[1] + r], [p[0] + r, p[1] - r], c); };
    // (colori pieni e oltre 1: il viraggio dell'immagine toglie saturazione, e delle linee chiare uscivano tutte bianche)
    const base = { percorsi: new Color4(0.15, 1.3, 1.7, 1), strade: new Color4(1.7, 0.9, 0.15, 1), selciati: new Color4(1.3, 1.3, 1.3, 1), verde: new Color4(0.25, 1.7, 0.25, 1), posti: new Color4(1.7, 1.2, 0.1, 1) }[layer];
    const hot = new Color4(2, 0.35, 0.05, 1), bad = new Color4(2.2, 0.05, 0.05, 1);
    for (const sh of shapes()) {
      const on = sel?.s === sh.key, c = on ? hot : base, w = sh.pts.map(worldOf);
      for (let i = 1; i < w.length; i++) add(w[i - 1], w[i], c);
      if (sh.closed && w.length > 2) add(w[w.length - 1], w[0], c);
      w.forEach((p, i) => cross(p, on && sel!.v === i ? 0.45 : 0.25, c));
      if (layer === "selciati") {   // la larghezza della striscia
        const p = ctx.doc().paving[sh.key as number], [a, b] = w, along = a[1] === b[1], h = p.width / 2;
        const off = (q: XZ, s: number): XZ => (along ? [q[0], q[1] + s * h] : [q[0] + s * h, q[1]]);
        for (const s of [-1, 1]) add(off(a, s), off(b, s), new Color4(c.r, c.g, c.b, 0.5));
      }
      if (layer === "posti") {   // il verso in cui si guarda
        const yaw = ctx.doc().spots[sh.key as string].yaw * Math.PI / 180, p = w[0];
        add(p, [p[0] + Math.sin(yaw) * 0.9, p[1] + Math.cos(yaw) * 0.9], c);
      }
    }
    if (drawing) { const w = drawing.map(worldOf); for (let i = 1; i < w.length; i++) add(w[i - 1], w[i], hot); w.forEach((p) => cross(p, 0.3, hot)); }
    if (layer === "percorsi" || layer === "posti") for (const m of problems) for (const [, x, z] of m.matchAll(/\((-?[\d.]+), (-?[\d.]+)\)/g)) cross([+x, +z], 0.6, bad);
    if (!segs.length) return;
    lines = MeshBuilder.CreateLineSystem("editor_linee", { lines: segs, colors: cols }, scene);
    lines.renderingGroupId = 2; lines.isPickable = false;
  }

  // ── il controllo della rete degli abitanti, mentre si disegna ──
  function check(): void {
    clearTimeout(checkTimer);
    checkTimer = window.setTimeout(() => {
      const d = ctx.doc(), plan = ctx.town.editor!.replan(d.walks, d.spots);
      problems = checkPlan({ ...ctx.town, plan }, ctx.ground);
      refresh(); ctx.changed();
    }, 250);
  }

  // ── lo schermo ──
  const toScreen = (x: number, z: number): [number, number] => {
    const eng = scene.getEngine(), w = eng.getRenderWidth(), h = eng.getRenderHeight();
    const p = Vector3.Project(new Vector3(x, Y(x, z), z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const r = eng.getRenderingCanvas()!.getBoundingClientRect(), k = r.width / w;
    return p.z < 0 || p.z > 1 ? [-1e6, -1e6] : [p.x * k, p.y * k];
  };
  /** Il punto o il tratto sotto il puntatore. */
  function hit(): { s: number | string; v: number; seg: boolean } | null {
    const mx = scene.pointerX, my = scene.pointerY;
    let best: { s: number | string; v: number; seg: boolean } | null = null, bd = 14;
    for (const sh of shapes()) sh.pts.map(worldOf).forEach((p, i) => { const [sx, sy] = toScreen(p[0], p[1]), d = Math.hypot(sx - mx, sy - my); if (d < bd) { bd = d; best = { s: sh.key, v: i, seg: false }; } });
    if (best) return best;
    bd = 9;
    for (const sh of shapes()) {
      const w = sh.pts.map(worldOf), n = sh.closed ? w.length : w.length - 1;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = toScreen(...w[i]), [bx, by] = toScreen(...w[(i + 1) % w.length]), dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, ((mx - ax) * dx + (my - ay) * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(ax + dx * t - mx, ay + dy * t - my);
        if (d < bd) { bd = d; best = { s: sh.key, v: i, seg: true }; }
      }
    }
    return best;
  }
  /** Il punto del terreno sotto il puntatore, nelle coordinate del livello (a 25 cm). */
  function under(): XZ | null {
    const h = scene.pick(scene.pointerX, scene.pointerY, (m) => m === ctx.terrain);
    return h?.pickedPoint ? localOf(h.pickedPoint.x, h.pickedPoint.z) : null;
  }
  /** Per i percorsi: se c'è un punto di un altro tracciato entro 60 cm, ci si attacca (diventa un incrocio). */
  function snapWalk(p: XZ, skip: XZ[]): XZ {
    let best = p, bd = 0.6;
    for (const line of ctx.doc().walks) for (const q of line) if (!skip.includes(q)) { const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < bd) { bd = d; best = [q[0], q[1]]; } }
    return best;
  }

  /** Crea una forma nuova dai punti disegnati. */
  function finish(): void {
    const pts = drawing; drawing = null;
    if (!pts || !layer) return;
    const d = ctx.doc();
    if (layer === "percorsi" && pts.length >= 2) { d.walks.push(pts); sel = { s: d.walks.length - 1, v: -1 }; }
    else if (layer === "strade" && pts.length >= 2) {
      const id = prompt("Nome della strada (id):", `strada${d.roads.length + 1}`);
      if (id) { d.roads.push({ id, kind: "trail", line: pts }); sel = { s: d.roads.length - 1, v: -1 }; }
    } else if (layer === "verde" && pts.length === 2) { d.green.push([pts[0], pts[1]]); sel = { s: d.green.length - 1, v: -1 }; }
    else if (layer === "selciati" && pts.length === 2) {
      const [a, b] = pts, line: XZ[] = [a, Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? [b[0], a[1]] : [a[0], b[1]]];
      d.paving.push({ kind: "cubetti", width: 4, line }); sel = { s: d.paving.length - 1, v: -1 };
    } else { refresh(); return; }
    ctx.commit(); refresh(); if (layer === "percorsi") check();
  }
  function remove(whole: boolean): void {
    if (!sel || !layer) return;
    const d = ctx.doc();
    if (layer === "posti") {
      const name = sel.s as string, who = ctx.uses(name);
      if (who.length && !confirm(`Il posto "${name}" lo usano: ${who.join(", ")}. Il salvataggio non passerà i controlli. Toglierlo lo stesso?`)) return;
      delete d.spots[name];
    } else {
      const list = (layer === "percorsi" ? d.walks : layer === "strade" ? d.roads : layer === "verde" ? d.green : d.paving) as unknown[];
      const line = layer === "percorsi" ? d.walks[sel.s as number] : layer === "strade" ? d.roads[sel.s as number].line : null;
      if (!whole && line && sel.v >= 0 && line.length > 2) line.splice(sel.v, 1);
      else list.splice(sel.s as number, 1);
    }
    sel = null; ctx.commit(); refresh(); check();
  }

  // ── il puntatore ──
  function pointer(pi: PointerInfo): void {
    const e = pi.event as PointerEvent;
    if (pi.type === PointerEventTypes.POINTERDOWN && e.button === 0 && !drawing) {
      const h = hit();
      if (!h) return;
      const sh = shapes().find((q) => q.key === h.s)!;
      if (h.seg && e.shiftKey && (layer === "percorsi" || layer === "strade")) {   // Shift sul tratto: un punto nuovo lì, da trascinare
        const p = under();
        if (!p) return;
        sh.pts.splice(h.v + 1, 0, p); h.v += 1; h.seg = false;
      }
      sel = { s: h.s, v: h.seg ? -1 : h.v };
      if (h.seg) { const g = under(); if (g) drag = { s: h.s, v: -1, moving: [], grab: g, orig: sh.pts.map((p) => [p[0], p[1]] as XZ) }; }
      else {
        // un punto dei percorsi si porta dietro gli stessi punti degli altri tracciati: l'incrocio resta un incrocio
        const p = sh.pts[h.v], moving: [XZ, number][] = [];
        if (layer === "percorsi") for (const line of ctx.doc().walks) line.forEach((q, i) => { if (q !== p && q[0] === p[0] && q[1] === p[1]) moving.push([q, i]); });
        drag = { s: h.s, v: h.v, moving };
      }
      refresh(); ctx.changed();
      return;
    }
    if (pi.type === PointerEventTypes.POINTERMOVE && drag) {
      let p = under();
      if (!p) return;
      if (drag.v < 0) {   // tutta la forma
        const [dx, dz] = [p[0] - drag.grab![0], p[1] - drag.grab![1]], sh = shapes().find((q) => q.key === drag!.s)!;
        if (layer === "verde") { const [a, b] = ctx.doc().green[drag.s as number], [o0, , o2] = drag.orig!; a[0] = o0[0] + dx; a[1] = o0[1] + dz; b[0] = o2[0] + dx; b[1] = o2[1] + dz; }
        else sh.pts.forEach((q, i) => { q[0] = r3(drag!.orig![i][0] + dx); q[1] = r3(drag!.orig![i][1] + dz); });
      } else {
        if (layer === "percorsi") p = snapWalk(p, [shapes()[drag.s as number].pts[drag.v], ...drag.moving.map(([q]) => q)]);
        setPoint(drag.s, drag.v, p);
        for (const [q] of drag.moving) { q[0] = p[0]; q[1] = p[1]; }
      }
      refresh();
      return;
    }
    if (pi.type === PointerEventTypes.POINTERUP && drag) { drag = null; ctx.commit(); refresh(); check(); return; }
    if (pi.type === PointerEventTypes.POINTERTAP && e.button === 0) {
      if (drawing) {
        let p = under();
        if (!p) return;
        if (layer === "percorsi") p = snapWalk(p, []);
        if (layer === "posti") {
          const name = prompt("Nome del posto:", "");
          drawing = null;
          if (name && !(name in ctx.doc().spots)) { ctx.doc().spots[name] = { at: p, yaw: 0 }; sel = { s: name, v: 0 }; ctx.commit(); check(); }
          refresh(); ctx.changed();
          return;
        }
        drawing.push(p);
        if ((layer === "verde" || layer === "selciati") && drawing.length === 2) finish(); else refresh();
        return;
      }
      if (!hit()) { sel = null; refresh(); ctx.changed(); }
    }
  }
  /** I tasti del livello: true se il tasto è suo. */
  function key(e: KeyboardEvent): boolean {
    if (e.code === "Enter" && drawing) { finish(); return true; }
    if (e.code === "Escape") { drawing = null; sel = null; refresh(); ctx.changed(); return true; }
    if (e.code === "Delete") { remove(e.shiftKey); return true; }
    if ((e.code === "KeyQ" || e.code === "KeyE") && layer === "posti" && sel) {
      const s = ctx.doc().spots[sel.s as string]; s.yaw = ((s.yaw + (e.code === "KeyE" ? 15 : -15) + 540) % 360) - 180;
      ctx.commit(); refresh(); ctx.changed(); return true;
    }
    return false;
  }

  // ── il pannello del livello ──
  function panel(box: HTMLElement, num: (v: number | undefined, step: number, set: (n: number) => void) => HTMLElement, field: (l: string, el: HTMLElement) => HTMLElement, choice: (o: readonly string[], v: string | undefined, set: (s: string) => void) => HTMLElement): void {
    if (!layer) return;
    const d = ctx.doc(), note = (t: string, cls = "note"): void => { box.append(Object.assign(document.createElement("div"), { className: cls, textContent: t })); };
    const HOW: Record<Layer, string> = {
      percorsi: "Trascina un punto (si attacca a un altro tracciato entro 60 cm: un incrocio). Shift+clic su un tratto aggiunge un punto. Trascina un tratto per spostare il tracciato.",
      posti: "Trascina un posto per spostarlo; Q ed E lo girano di 15°.",
      verde: "Trascina un angolo o un lato.",
      selciati: "Trascina un capo: la striscia resta dritta lungo x o lungo z.",
      strade: "Coordinate del mondo. Trascina un punto; Shift+clic su un tratto aggiunge un punto. Il terreno cambia salvando.",
    };
    note(HOW[layer], "hint");
    if (drawing) note(layer === "posti" ? "Clic dove mettere il posto." : layer === "verde" || layer === "selciati" ? "Clic sui due capi." : "Clic per ogni punto; Invio per finire, Esc per lasciar perdere.");
    if (sel !== null && !drawing) {
      if (layer === "posti") {
        const name = sel.s as string, s = d.spots[name], who = ctx.uses(name), nm = document.createElement("input");
        nm.value = name; nm.disabled = who.length > 0;
        nm.onchange = () => {
          const to = nm.value.trim();
          if (!to || to in d.spots) { nm.value = name; return; }
          d.spots = Object.fromEntries(Object.entries(d.spots).map(([k, v]) => [k === name ? to : k, v])) as DrawDoc["spots"];
          sel = { s: to, v: 0 }; ctx.commit(); refresh(); check(); ctx.changed();
        };
        box.append(field("nome", nm), field("x", num(s.at[0], 0.25, (n) => { s.at[0] = n; })), field("z", num(s.at[1], 0.25, (n) => { s.at[1] = n; })), field("verso", num(s.yaw, 15, (n) => { s.yaw = n; })));
        if (who.length) note(`Lo usano: ${who.join(", ")} (per questo il nome non si cambia).`);
      } else if (layer === "verde") {
        const [a, b] = d.green[sel.s as number];
        box.append(field("da x", num(a[0], 0.25, (n) => { a[0] = n; })), field("da z", num(a[1], 0.25, (n) => { a[1] = n; })), field("a x", num(b[0], 0.25, (n) => { b[0] = n; })), field("a z", num(b[1], 0.25, (n) => { b[1] = n; })));
      } else if (layer === "selciati") {
        const p = d.paving[sel.s as number];
        box.append(field("tipo", choice(PAVINGS, p.kind, (v) => { p.kind = v; })), field("larghezza", num(p.width, 0.5, (n) => { p.width = Math.max(0.5, n); })));
      } else if (layer === "strade") {
        const r = d.roads[sel.s as number], id = document.createElement("input");
        id.value = r.id; id.onchange = () => { if (id.value.trim()) { r.id = id.value.trim(); ctx.commit(); } };
        box.append(field("nome (id)", id), field("tipo", choice(["trail", "road"], r.kind, (v) => { r.kind = v; })));
        note(`${r.line.length} punti${r.to ? ` · arriva a ${r.to}` : ""}`);
      } else note(`Tracciato ${(sel.s as number) + 1}: ${d.walks[sel.s as number].length} punti${sel.v >= 0 ? ` · punto ${sel.v + 1}` : ""}.`);
    }
    const ops = box.appendChild(document.createElement("div")); ops.className = "row";
    const NEW: Record<Layer, string> = { percorsi: "Nuovo tracciato", posti: "Nuovo posto", verde: "Nuova zona", selciati: "Nuovo selciato", strade: "Nuova strada" };
    const btn = (t: string, f: () => void): void => { const b = ops.appendChild(document.createElement("button")); b.textContent = t; b.onclick = f; };
    btn(NEW[layer], () => { drawing = []; sel = null; refresh(); ctx.changed(); });
    if (sel !== null) {
      if ((layer === "percorsi" || layer === "strade") && sel.v >= 0) btn("Togli punto (Canc)", () => remove(false));
      btn(layer === "posti" ? "Togli posto (Canc)" : "Togli tutto (Shift+Canc)", () => remove(true));
    }
    if (layer === "percorsi" || layer === "posti") note(problems.length ? `Rete degli abitanti: ${problems.length} problemi (croci rosse)\n${problems.slice(0, 6).join("\n")}` : "Rete degli abitanti: a posto.", problems.length ? "err" : "note");
  }

  return {
    get layer() { return layer; },
    setLayer(l: Layer | null): void { layer = l; sel = null; drawing = null; drag = null; refresh(); if (l === "percorsi" || l === "posti") check(); },
    refresh, pointer, key, panel,
    /** Dopo una modifica fatta dal pannello: ridisegna e ricontrolla. */
    touch(): void { refresh(); if (layer === "percorsi" || layer === "posti") check(); },
    /** Dopo un annulla: la scelta potrebbe non esistere più. */
    reset(): void { sel = null; drawing = null; refresh(); if (layer === "percorsi" || layer === "posti") check(); },
  };
}
