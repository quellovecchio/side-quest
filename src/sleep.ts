import { hoursUntil, type Clock } from "./clock";

// ─────────────────────────────────────────────────────────────────────────────
// DORMIRE — davanti a un letto (tasto E) si sceglie quando svegliarsi fra le ore di db.json
// (`time.wake`): si vede il buio, l'orologio salta, ci si sveglia riposati. La scelta si fa coi
// tasti numerici, senza lasciare la presa del mouse: il risveglio è sempre la PROSSIMA volta che
// arriva quell'ora (dopo mezzanotte, quindi "domani").
// ─────────────────────────────────────────────────────────────────────────────

const fmt = (h: number): string => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

export class Sleep {
  /** Il pannello è aperto, o si sta dormendo. */
  busy = false;
  private choosing = false;
  private panel = document.getElementById("sleep")!;
  private now = document.getElementById("sleep-now")!;
  private list = document.getElementById("sleep-list")!;
  private fade = document.getElementById("fade")!;
  private clock: Clock; private wake: { name: string; hour: number }[];
  private hooks: { freeze(on: boolean): void; woke(): void };

  constructor(clock: Clock, wake: { name: string; hour: number }[], hooks: { freeze(on: boolean): void; woke(): void }) {
    this.clock = clock; this.wake = wake; this.hooks = hooks;
    addEventListener("keydown", (e) => {
      if (!this.choosing || !e.code.startsWith("Digit")) return;
      const i = Number(e.code.slice(5)) - 1;
      if (i === this.wake.length) this.close();
      else if (this.wake[i]) this.until(this.wake[i].hour);
    });
  }

  /** Apre il pannello della scelta. */
  show(): void {
    if (this.busy) return;
    this.busy = this.choosing = true;
    this.hooks.freeze(true);
    // la grafica è in index.html (#sleep): al centro del quadrante l'ora e il giorno, sul bordo il rombo di adesso,
    // una tacca e un glifo per ogni risveglio; a destra le righe (tasto, glifo, nome e fra quanto, ora)
    const [giorno, ora] = this.clock.label().split(" · ");
    this.now.textContent = ora;
    document.getElementById("sleep-day")!.textContent = giorno;
    document.getElementById("sleep-dial")!.style.setProperty("--h", String(this.clock.hour));
    const ticks = document.getElementById("sleep-ticks")!;
    ticks.replaceChildren(); this.list.replaceChildren();
    const el = (parent: HTMLElement, tag: string, cls = "", text = ""): HTMLElement => {
      const e = parent.appendChild(document.createElement(tag));
      e.className = cls; e.textContent = text;
      return e;
    };
    const glyph = (h: number): string => `g g-${h < 5.5 || h >= 19.5 ? "moon" : h < 8 || h >= 17.5 ? "low" : "sun"}`;
    this.wake.forEach((w, i) => {
      const h = hoursUntil(this.clock.hour, w.hour), n = Math.round(h);
      for (const cls of ["tick", glyph(w.hour)]) el(ticks, "i", cls).style.setProperty("--h", String(w.hour));
      el(this.list, "kbd", "", String(i + 1)); el(this.list, "i", glyph(w.hour));
      el(el(this.list, "span", "", w.name), "small", "", `${this.clock.hour + h >= 24 ? "domani, " : ""}fra ${n} ${n === 1 ? "ora" : "ore"}`);
      el(this.list, "b", "", fmt(w.hour));
    });
    el(this.list, "hr");
    el(this.list, "kbd", "stay", String(this.wake.length + 1)); el(this.list, "i", "stay"); el(this.list, "span", "stay", "Resta sveglio"); el(this.list, "b");
    this.panel.classList.remove("hidden");
  }

  private close(): void {
    this.panel.classList.add("hidden");
    this.busy = this.choosing = false;
    this.hooks.freeze(false);
  }

  /** Dorme fino alla prossima volta che sono le `hour`: buio, salto dell'orologio, risveglio. */
  until(hour: number): void {
    this.choosing = false; this.busy = true;
    this.panel.classList.add("hidden");
    this.fade.textContent = "";
    this.fade.classList.add("on");
    setTimeout(() => {
      this.clock.advance(hoursUntil(this.clock.hour, hour));
      this.hooks.woke();
      this.fade.textContent = this.clock.label();
      setTimeout(() => { this.fade.classList.remove("on"); this.busy = false; this.hooks.freeze(false); }, 1400);
    }, 900);
  }
}
