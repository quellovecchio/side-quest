// ─────────────────────────────────────────────────────────────────────────────
// DIALOGO — le righe di un abitante, una alla volta, in un riquadro in basso (#talk in index.html).
// Il tasto E passa alla riga dopo; finite le righe il riquadro si chiude. Una riga fra parentesi
// quadre è narrazione ("[Ti squadra.]"): si mostra in corsivo, senza le parentesi.
// ─────────────────────────────────────────────────────────────────────────────

export class Dialogue {
  busy = false;
  private lines: string[] = []; private i = 0; private end: (() => void) | null = null;
  private box = document.getElementById("talk")!;
  private who = document.getElementById("talk-name")!;
  private text = document.getElementById("talk-text")!;
  private freeze: (on: boolean) => void;

  /** `freeze` ferma chi gioca finché si parla. */
  constructor(freeze: (on: boolean) => void) { this.freeze = freeze; }

  /** Apre il riquadro con le righe di `name`; `end` viene chiamata alla chiusura. */
  open(name: string, lines: string[], end: () => void): void {
    if (this.busy || !lines.length) return;
    this.busy = true; this.lines = lines; this.i = 0; this.end = end;
    this.who.textContent = name;
    this.freeze(true);
    this.show();
    this.box.classList.remove("hidden");
  }

  /** La riga dopo, o la chiusura. */
  next(): void {
    if (!this.busy) return;
    if (++this.i < this.lines.length) { this.show(); return; }
    this.busy = false;
    this.box.classList.add("hidden");
    this.freeze(false);
    this.end?.();
  }

  private show(): void {
    const l = this.lines[this.i], told = /^\[.*\]$/.test(l);
    this.text.textContent = told ? l.slice(1, -1) : l;
    this.text.classList.toggle("told", told);
  }
}
