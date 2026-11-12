// ─────────────────────────────────────────────────────────────────────────────
// OROLOGIO — l'ora del mondo. Scorre da sola (`dayMinutes` minuti veri per un giorno di gioco, da
// db.json) e salta in avanti quando si dorme. Chi la trasforma in luce è main.ts (`setHour`).
// ─────────────────────────────────────────────────────────────────────────────

/** Quante ore mancano alla prossima volta che sono le `target`: mai zero (chi dorme "fino a mezzogiorno" a mezzogiorno si sveglia domani). */
export const hoursUntil = (now: number, target: number): number => (((target - now) % 24) + 24) % 24 || 24;

export class Clock {
  day = 1;
  hour: number;
  private rate: number;

  constructor(start: number, dayMinutes: number) {
    this.hour = start;
    this.rate = 24 / (dayMinutes * 60);   // ore di gioco per secondo vero
  }

  update(dt: number): void { this.advance(dt * this.rate); }

  advance(hours: number): void {
    this.hour += hours;
    while (this.hour >= 24) { this.hour -= 24; this.day++; }
  }

  /** "Giorno 2 · 07:00" */
  label(): string {
    const m = Math.floor(this.hour * 60);
    return `Giorno ${this.day} · ${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
}
