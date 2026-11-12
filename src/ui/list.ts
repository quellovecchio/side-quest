// ─────────────────────────────────────────────────────────────────────────────
// ELENCO — il pannello a liste di testo (#list in index.html) che fa da inventario, da bottega e da
// banco dell'oste: un titolo, una riga di stato (le monete), una o più pagine di voci. Si sceglie
// con W/S o le frecce, E o Invio conferma, Tab cambia pagina, Q o I chiude. Le voci si ricalcolano
// dopo ogni scelta (ciò che si è comprato compare, ciò che si è usato sparisce).
// ─────────────────────────────────────────────────────────────────────────────

/** Una voce: nome, una nota in piccolo, un testo a destra (prezzo, quantità); senza `run` è spenta. */
export interface Row { label: string; note?: string; right?: string; run?: () => void }
export interface Page { name: string; rows: () => Row[]; /** Cosa dire se la pagina è vuota. */ empty: string }

export class ListPanel {
  busy = false;
  private pages: Page[] = []; private page = 0; private cur = 0; private rows: Row[] = [];
  private sub: () => string = () => ""; private end: (() => void) | null = null; private armed = false;
  private box = document.getElementById("list")!;
  private freeze: (on: boolean) => void;

  constructor(freeze: (on: boolean) => void) {
    this.freeze = freeze;
    addEventListener("keydown", (e) => {
      if (!this.busy || !this.armed || e.repeat) return;
      const c = e.code;
      if (c === "Tab") { e.preventDefault(); this.page = (this.page + 1) % this.pages.length; this.cur = 0; }
      else if (c === "KeyW" || c === "ArrowUp") this.cur--;
      else if (c === "KeyS" || c === "ArrowDown") this.cur++;
      else if (c === "KeyE" || c === "Enter") this.rows[this.cur]?.run?.();
      else if (c === "KeyQ" || c === "KeyI" || c === "Backspace") { this.close(); return; }
      else return;
      if (this.busy) this.draw();   // (una voce può aver chiuso il pannello)
    });
  }

  /** Apre il pannello; `sub` è la riga sotto il titolo (ricalcolata a ogni scelta), `end` viene chiamata alla chiusura. */
  open(title: string, sub: () => string, pages: Page[], end?: () => void): void {
    if (this.busy) return;
    this.busy = true; this.pages = pages; this.page = 0; this.cur = 0; this.sub = sub; this.end = end ?? null;
    document.getElementById("list-title")!.textContent = title;
    this.freeze(true);
    this.draw();
    this.box.classList.remove("hidden");
    // il tasto che ha aperto il pannello (E alla fine di un dialogo, I) non deve valere anche come prima scelta
    this.armed = false; setTimeout(() => { this.armed = true; }, 0);
  }

  close(): void {
    if (!this.busy) return;
    this.busy = false;
    this.box.classList.add("hidden");
    this.freeze(false);
    this.end?.();
  }

  private draw(): void {
    const p = this.pages[this.page];
    this.rows = p.rows();
    this.cur = this.rows.length ? (this.cur + this.rows.length) % this.rows.length : 0;
    document.getElementById("list-sub")!.textContent = this.sub();
    const tabs = document.getElementById("list-tabs")!, body = document.getElementById("list-rows")!;
    tabs.replaceChildren(...(this.pages.length > 1 ? this.pages.map((q, i) => { const b = document.createElement("b"); b.textContent = q.name; b.className = i === this.page ? "on" : ""; return b; }) : []));
    body.replaceChildren(...this.rows.map((r, i) => {
      const d = document.createElement("div");
      d.className = (i === this.cur ? "on" : "") + (r.run ? "" : " off");
      const name = d.appendChild(document.createElement("span")); name.textContent = r.label;
      if (r.note) { const s = name.appendChild(document.createElement("small")); s.textContent = r.note; }
      d.appendChild(document.createElement("b")).textContent = r.right ?? "";
      return d;
    }));
    if (!this.rows.length) { const d = body.appendChild(document.createElement("p")); d.textContent = p.empty; }
    document.getElementById("list-hint")!.textContent = (this.pages.length > 1 ? "Tab cambia pagina · " : "") + "W S scegli · E conferma · Q chiudi";
  }
}
