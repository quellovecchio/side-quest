import type { Cond, Effect, InteractionDef, QuestDef } from "./db.ts";
import type { State } from "./state.ts";

// ─────────────────────────────────────────────────────────────────────────────
// EFFETTI E CONDIZIONI — l'unico interprete: il file dice "reagisce a → effetto" (db.ts), qui sta
// cosa vuol dire. Lo usano le interazioni degli abitanti, gli oggetti che si usano e le missioni.
// Modulo puro (lo prova anche `npm run check`, con Node): il mondo gli arriva come poche voci.
// ─────────────────────────────────────────────────────────────────────────────

export interface World { state: State; hour(): number; heal(n: number): void; /** Il nome di un oggetto, per la narrazione. */ name(item: string): string }

export function test(c: Cond | undefined, w: World): boolean {
  if (!c) return true;
  if ("flag" in c) return w.state.flags.has(c.flag);
  if ("has" in c) return Object.entries(c.has).every(([id, n]) => w.state.count(id) >= n);
  if ("opened" in c) return w.state.opened.has(c.opened);
  if ("not" in c) return !test(c.not, w);
  if ("all" in c) return c.all.every((x) => test(x, w));
  const [a, b] = c.hour, h = w.hour();
  return a <= b ? h >= a && h < b : h >= a || h < b;   // "da 22 a 6" passa per la mezzanotte
}

/** "20 monete", "Pozione piccola", "3 × Pelle di lupo". */
export const amount = (id: string, n: number, w: World): string => (id === "monete" ? `${n} monete` : `${n > 1 ? `${n} × ` : ""}${w.name(id)}`);

/** Applica gli effetti in fila e restituisce le righe da mostrare (ciò che viene detto, e la narrazione di ciò che si riceve o si dà). */
export function run(list: Effect[], w: World): string[] {
  const out: string[] = [];
  for (const e of list) {
    if ("say" in e) out.push(...e.say);
    else if ("flag" in e) w.state.flags.add(e.flag);
    else if ("give" in e) for (const [id, n] of Object.entries(e.give)) { w.state.add(id, n); out.push(`[Ricevi ${amount(id, n, w)}.]`); }
    else if ("take" in e) for (const [id, n] of Object.entries(e.take)) { w.state.add(id, -n); out.push(`[Dai ${amount(id, n, w)}.]`); }
    else if ("quest" in e) w.state.quests[e.quest] ??= 0;   // comincia (se non è già cominciata): ad avanzarla pensa `advance`
    else w.heal(e.heal);
  }
  return out;
}

/**
 * La prima interazione di `list` che reagisce a `on`, con la condizione vera e non già consumata: la applica e ne
 * restituisce le righe. null se nessuna reagisce (chi chiama allora ripiega: per `talk` il dialogo di tutti i giorni,
 * per `use:<oggetto>` l'effetto proprio dell'oggetto).
 */
export function react(owner: string, list: InteractionDef[], on: string, w: World): string[] | null {
  for (const [i, it] of list.entries()) {
    const key = `${owner}#${i}`;
    if (it.on !== on || (it.once && w.state.done.has(key)) || !test(it.if, w)) continue;
    if (it.once) w.state.done.add(key);
    return run(it.do, w);
  }
  return null;
}

/** La tappa in corso di una missione cominciata e non conclusa. */
export const stage = (q: QuestDef, s: State): QuestDef["stages"][0] | undefined => (q.id in s.quests ? q.stages[s.quests[q.id]] : undefined);

/**
 * Fa avanzare le missioni cominciate: finché la condizione della tappa in corso è vera si passa alla successiva.
 * Restituisce le missioni che si sono mosse (per dirlo a schermo): quelle arrivate in fondo sono concluse.
 */
export function advance(quests: QuestDef[], w: World): { quest: QuestDef; over: boolean }[] {
  const out: { quest: QuestDef; over: boolean }[] = [];
  for (const q of quests) {
    let moved = false;
    for (let st = stage(q, w.state); st && test(st.done, w); st = stage(q, w.state)) { w.state.quests[q.id]++; moved = true; }
    if (moved) out.push({ quest: q, over: !stage(q, w.state) });
  }
  return out;
}
