// ─────────────────────────────────────────────────────────────────────────────
// STATO DELLA PARTITA — ciò che cambia giocando, separato da db.json (che non cambia mai):
// bandierine alzate, interazioni "una volta sola" già fatte, monete, inventario, ciò che si impugna,
// forzieri già aperti, il personaggio (classe, statistiche, livello), le missioni. È ciò che si salva
// (`save` / `load`: main.ts ci aggiunge l'ora e dove sta chi gioca).
// ─────────────────────────────────────────────────────────────────────────────

/** La versione del salvataggio: se la forma dello stato cambia va alzata, e i salvataggi vecchi non si caricano. */
export const SAVE = 1;

export class State {
  flags = new Set<string>();
  /** Le interazioni `once` già avvenute ("abitante#indice"). */
  done = new Set<string>();
  monete = 0;
  /** Oggetto → quantità (mai zero: chi finisce sparisce). */
  inventory: Record<string, number> = {};
  /** L'arma impugnata (un oggetto dell'inventario), se c'è. */
  mano: string | null = null;
  /** I forzieri già vuotati. */
  opened = new Set<string>();
  /** Il personaggio: la classe scelta (null finché non si sceglie), le statistiche, il livello, l'esperienza verso il prossimo, i punti da spendere, la magicka. */
  classe: string | null = null;
  stats = { forza: 5, destrezza: 5, costituzione: 5, intelligenza: 5, saggezza: 5, carisma: 5 };
  level = 1; xp = 0; points = 0; magicka = 0;
  /** Le missioni cominciate: a che tappa sono (oltre l'ultima = concluse). */
  quests: Record<string, number> = {};

  count(id: string): number { return id === "monete" ? this.monete : this.inventory[id] ?? 0; }

  /** Aggiunge (o toglie, con `n` negativo) monete o oggetti; non si scende sotto zero, e ciò che non si ha più non si impugna. */
  add(id: string, n: number): void {
    if (id === "monete") { this.monete = Math.max(0, this.monete + n); return; }
    const left = Math.max(0, this.count(id) + n);
    if (left) this.inventory[id] = left; else { delete this.inventory[id]; if (this.mano === id) this.mano = null; }
  }

  /** Lo stato come dati semplici (gli insiemi diventano liste), da scrivere in JSON. */
  save(): Record<string, unknown> {
    return { ...this, flags: [...this.flags], done: [...this.done], opened: [...this.opened], stats: { ...this.stats }, inventory: { ...this.inventory }, quests: { ...this.quests } } as unknown as Record<string, unknown>;
  }

  /** Riprende ciò che `save` ha scritto. */
  load(d: Record<string, unknown>): void {
    const s = d as unknown as Omit<State, "flags" | "done" | "opened"> & { flags: string[]; done: string[]; opened: string[] };
    this.flags = new Set(s.flags); this.done = new Set(s.done); this.opened = new Set(s.opened);
    this.monete = s.monete; this.inventory = { ...s.inventory }; this.mano = s.mano; this.classe = s.classe;
    this.stats = { ...s.stats }; this.level = s.level; this.xp = s.xp; this.points = s.points; this.magicka = s.magicka; this.quests = { ...s.quests };
  }
}
