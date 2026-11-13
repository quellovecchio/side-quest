import { Color4, Matrix, MeshBuilder, PointerEventTypes, Vector3, type FreeCamera, type LinesMesh, type PointerInfo, type Scene } from "@babylonjs/core";
import { ACTS, LOOKS } from "./data/db";
import type { Town } from "./world/town";

// ─────────────────────────────────────────────────────────────────────────────
// EDITOR DELLA MAPPA, gli abitanti (fase 4: docs/editor.md) — chi sono, la loro giornata, cosa dicono. Modifica il blocco
// `npcs` del file così com'è scritto (grezzo: le ore restano "HH:MM"); il giro dell'abitante scelto si vede sulla mappa, un
// colore per tratto della giornata, e una tappa si può puntare cliccando un posto. Gli abitanti nel gioco cambiano salvando.
// ─────────────────────────────────────────────────────────────────────────────

/** Un abitante com'è scritto nel file. */
export interface RawNpc {
  id: string; name: string; look: string; home?: string; speed: number; social?: boolean;
  services?: unknown; routine: { from: string; stops?: { at: string; act: string; stay?: [number, number] }[]; follow?: string }[];
  dialogue: string[]; interactions?: unknown[];
}

export interface NpcCtx { scene: Scene; cam: FreeCamera; town: Town; ground: (x: number, z: number) => number;
  list: () => RawNpc[]; commit: () => void; redraw: () => void; go: (x: number, z: number) => void }

const COLORS = [[1.8, 0.9, 0.15], [0.2, 1.4, 1.8], [1.6, 0.3, 1.6], [0.3, 1.7, 0.3], [1.9, 1.9, 1.9], [1.9, 0.35, 0.2], [0.5, 0.6, 1.9]];

export function createNpcs(ctx: NpcCtx) {
  const { scene, cam, town } = ctx;
  let sel = 0, picking: { r: number; s: number } | null = null, lines: LinesMesh | null = null, error = "";
  const spotNames = Object.keys(town.plan.spots).sort();
  const Y = (s: { x: number; z: number; y?: number }): number => (s.y ?? ctx.ground(s.x, s.z)) + 0.3;

  /** Il giro dell'abitante scelto: per ogni tratto le sue tappe unite, e un'asta su ogni tappa. */
  const draw = (): void => {
    lines?.dispose(); lines = null;
    const n = ctx.list()[sel];
    if (!n) return;
    const segs: Vector3[][] = [], cols: Color4[][] = [];
    n.routine.forEach((r, k) => {
      const [cr, cg, cb] = COLORS[k % COLORS.length], c = new Color4(cr, cg, cb, 1);
      const pts = (r.stops ?? []).map((s) => town.plan.spots[s.at]).filter(Boolean).map((s) => new Vector3(s.x, Y(s), s.z));
      for (const p of pts) { segs.push([p, p.add(new Vector3(0, 2.5, 0))]); cols.push([c, c]); }
      if (pts.length > 1) { segs.push([...pts, pts[0]]); cols.push([...pts, pts[0]].map(() => c)); }
    });
    if (!segs.length) return;
    lines = MeshBuilder.CreateLineSystem("editor_giro", { lines: segs, colors: cols }, scene);
    lines.renderingGroupId = 2; lines.isPickable = false;
  };
  const toScreen = (x: number, y: number, z: number): [number, number] => {
    const eng = scene.getEngine(), w = eng.getRenderWidth(), h = eng.getRenderHeight();
    const p = Vector3.Project(new Vector3(x, y, z), Matrix.IdentityReadOnly, scene.getTransformMatrix(), cam.viewport.toGlobal(w, h));
    const k = eng.getRenderingCanvas()!.getBoundingClientRect().width / w;
    return p.z < 0 || p.z > 1 ? [-1e6, -1e6] : [p.x * k, p.y * k];
  };
  /** Il posto più vicino al puntatore (entro 24 punti). */
  const spotAt = (): string | null => {
    let best: string | null = null, bd = 24;
    for (const [name, s] of Object.entries(town.plan.spots)) {
      const [x, y] = toScreen(s.x, Y(s), s.z), d = Math.hypot(x - scene.pointerX, y - scene.pointerY);
      if (d < bd) { bd = d; best = name; }
    }
    return best;
  };

  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}): HTMLElementTagNameMap[K] => Object.assign(document.createElement(tag), props);
  const select = (opts: readonly string[], v: string | undefined, set: (s: string) => void, blank = false): HTMLSelectElement => {
    const s = el("select");
    for (const o of [...(blank ? [""] : []), ...opts]) s.add(new Option(o || "—", o, false, o === (v ?? "")));
    s.onchange = () => { set(s.value); ctx.commit(); ctx.redraw(); };
    return s;
  };
  const text = (v: string, set: (s: string) => void, props: Partial<HTMLInputElement> = {}): HTMLInputElement => {
    const i = el("input", { value: v, ...props });
    i.onchange = () => { set(i.value); ctx.commit(); ctx.redraw(); };
    return i;
  };
  const button = (label: string, f: () => void, title = ""): HTMLButtonElement => el("button", { textContent: label, title, onclick: f });
  /** Un campo JSON (interazioni, servizi): si accetta solo se si legge. */
  const json = (v: unknown, set: (x: unknown) => void, rows: number): HTMLTextAreaElement => {
    const t = el("textarea", { value: v === undefined ? "" : JSON.stringify(v, null, 1), rows });
    t.style.cssText = "width:100%;box-sizing:border-box;background:#2a251f;color:#f2e8d2;border:1px solid #5a4c38;font:11px monospace";
    t.onchange = () => {
      try { set(t.value.trim() ? JSON.parse(t.value) : undefined); error = ""; ctx.commit(); }
      catch (e) { error = `JSON non valido: ${(e as Error).message}`; }
      ctx.redraw();
    };
    return t;
  };

  function panel(box: HTMLElement, field: (l: string, i: HTMLElement) => HTMLElement): void {
    const list = ctx.list(), n = list[sel];
    const top = box.appendChild(el("div", { className: "row" }));
    top.append(select(list.map((x, i) => `${i}: ${x.name}`), n ? `${sel}: ${n.name}` : "", (v) => { sel = +v.split(":")[0]; picking = null; }));
    top.append(button("Nuovo", () => {
      let k = list.length + 1; while (list.some((x) => x.id === `abitante${k}`)) k++;
      list.push({ id: `abitante${k}`, name: "Nuovo abitante", look: "cittadino", speed: 1, routine: [{ from: "06:00", stops: [{ at: "street", act: "stand" }] }], dialogue: ["…"] });
      sel = list.length - 1; ctx.commit(); ctx.redraw();
    }));
    if (!n) return;
    top.append(button("Elimina", () => { if (!confirm(`Togliere ${n.name}?`)) return; list.splice(sel, 1); sel = Math.max(0, sel - 1); ctx.commit(); ctx.redraw(); }));
    top.append(button("Vai", () => {
      const s = town.plan.spots[n.routine.find((r) => r.stops?.length)?.stops![0].at ?? ""];
      if (s) ctx.go(s.x, s.z);
    }, "la camera sulla prima tappa"));

    box.append(field("id", text(n.id, (v) => { n.id = v; })), field("nome", text(n.name, (v) => { n.name = v; })));
    box.append(field("aspetto", select(LOOKS, n.look, (v) => { n.look = v; })));
    box.append(field("casa", select(town.interiors.map((i) => i.id).sort(), n.home, (v) => { if (v) n.home = v; else delete n.home; }, true)));
    box.append(field("passo", text(String(n.speed), (v) => { if (Number.isFinite(+v) && +v > 0) n.speed = +v; }, { type: "number", step: "0.1" })));
    const soc = el("input", { type: "checkbox", checked: !!n.social });
    soc.onchange = () => { if (soc.checked) n.social = true; else delete n.social; ctx.commit(); ctx.redraw(); };
    box.append(field("chiacchiera", soc));

    // ── la giornata ──
    box.append(el("h3", { textContent: "Giornata" }));
    const names = box.appendChild(el("datalist", { id: "editor_posti" }));
    for (const s of spotNames) names.append(new Option(s));
    n.routine.forEach((r, ri) => {
      const [cr, cg, cb] = COLORS[ri % COLORS.length];
      const head = box.appendChild(el("div", { className: "row" }));
      head.style.borderLeft = `4px solid rgb(${Math.min(255, cr * 140)},${Math.min(255, cg * 140)},${Math.min(255, cb * 140)})`; head.style.paddingLeft = "4px";
      head.append(text(r.from, (v) => { r.from = v; n.routine.sort((a, b) => a.from.localeCompare(b.from)); }, { type: "time" }));
      head.append(select(["giro", "segue"], r.follow ? "segue" : "giro", (v) => {
        if (v === "segue") { r.follow = list.find((x) => x !== n)?.id ?? ""; delete r.stops; } else { r.stops = [{ at: "street", act: "stand" }]; delete r.follow; }
      }));
      head.append(button("×", () => { n.routine.splice(ri, 1); ctx.commit(); ctx.redraw(); }, "togli il tratto"));
      if (r.follow !== undefined) { box.append(field("segue", select(list.filter((x) => x !== n).map((x) => x.id), r.follow, (v) => { r.follow = v; }))); return; }
      const stops = r.stops ?? (r.stops = []);
      stops.forEach((s, si) => {
        const row = box.appendChild(el("div", { className: "row" }));
        const at = text(s.at, (v) => { s.at = v; }); at.setAttribute("list", "editor_posti"); at.style.flex = "2";
        if (!town.plan.spots[s.at]) at.style.borderColor = "#ff8a70";
        row.append(at, select(ACTS, s.act, (v) => { s.act = v; }));
        if (stops.length > 1) for (const k of [0, 1]) {
          const i = text(String(s.stay?.[k] ?? ""), (v) => {
            if (v === "") { delete s.stay; return; }
            const [a, b] = s.stay ?? [+v, +v];
            s.stay = k ? [Math.min(a, +v), +v] : [+v, Math.max(b, +v)];
          }, { type: "number", step: "0.5", title: k ? "sosta, al più" : "sosta, almeno" });
          i.style.width = "44px"; i.style.flex = "0 0 44px"; row.append(i);
        }
        const pin = button(picking?.r === ri && picking.s === si ? "…" : "◎", () => { picking = { r: ri, s: si }; ctx.redraw(); }, "scegli il posto sulla mappa");
        row.append(pin, button("×", () => { stops.splice(si, 1); ctx.commit(); ctx.redraw(); }, "togli la tappa"));
      });
      box.append(button("+ tappa", () => { stops.push({ ...stops[stops.length - 1] ?? { at: "street", act: "stand" }, stay: [1, 2] }); ctx.commit(); ctx.redraw(); }));
    });
    box.appendChild(el("div", { className: "row" })).append(button("+ tratto", () => {
      const last = n.routine[n.routine.length - 1];
      n.routine.push({ from: "12:00", stops: structuredClone(last?.stops ?? [{ at: "street", act: "stand" }]) });
      n.routine.sort((a, b) => a.from.localeCompare(b.from)); ctx.commit(); ctx.redraw();
    }));
    if (picking) box.append(el("div", { className: "note", textContent: "Clic su un posto della mappa (Esc per lasciar perdere)." }));

    // ── cosa dice, cosa fa ──
    box.append(el("h3", { textContent: "Battute" }));
    const lines = el("textarea", { value: n.dialogue.join("\n"), rows: 4 });
    lines.style.cssText = "width:100%;box-sizing:border-box;background:#2a251f;color:#f2e8d2;border:1px solid #5a4c38;font:inherit";
    lines.onchange = () => { n.dialogue = lines.value.split("\n").map((l) => l.trim()).filter(Boolean); ctx.commit(); ctx.redraw(); };
    box.append(lines, el("div", { className: "hint", textContent: "Una battuta per riga; fra parentesi quadre la narrazione." }));
    box.append(el("h3", { textContent: "Interazioni (JSON)" }), json(n.interactions, (v) => { if (v) n.interactions = v as unknown[]; else delete n.interactions; }, 5));
    box.append(el("h3", { textContent: "Servizi (JSON)" }), json(n.services, (v) => { if (v) n.services = v; else delete n.services; }, 3));
    if (error) box.append(el("div", { className: "err", textContent: error }));
    box.append(el("div", { className: "hint", textContent: "Gli abitanti nel gioco seguono la giornata nuova salvando. Le tappe con il bordo rosso nominano un posto che non c'è." }));
  }

  return {
    panel,
    draw,
    hide(): void { lines?.dispose(); lines = null; picking = null; },
    /** Il puntatore: conta solo mentre si sceglie un posto per una tappa. Restituisce vero se l'ha usato. */
    pointer(pi: PointerInfo): boolean {
      if (!picking || pi.type !== PointerEventTypes.POINTERTAP || (pi.event as PointerEvent).button !== 0) return false;
      const name = spotAt(), stop = ctx.list()[sel]?.routine[picking.r]?.stops?.[picking.s];
      if (name && stop) { stop.at = name; picking = null; ctx.commit(); ctx.redraw(); }
      return true;
    },
    key(e: KeyboardEvent): boolean { if (e.code === "Escape" && picking) { picking = null; ctx.redraw(); return true; } return false; },
    get selected() { return sel; },
    set selected(i: number) { sel = i; },
  };
}
export type Npcs = ReturnType<typeof createNpcs>;
