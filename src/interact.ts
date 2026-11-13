import type { AbstractMesh, Vector3 } from "@babylonjs/core";

// ─────────────────────────────────────────────────────────────────────────────
// INTERAZIONE — il tasto E. Chi vuole essere usato (una porta, più avanti un abitante, un forziere)
// si iscrive con un punto e un'etichetta; a ogni frame si sceglie ciò che il giocatore ha davanti a
// portata di braccio, e l'HUD ne mostra l'etichetta.
// ─────────────────────────────────────────────────────────────────────────────

export interface Usable {
  /** Dove sta (all'altezza a cui lo si guarda). */
  x: number; y: number; z: number;
  /** Cosa fa il tasto ora ("Apri", "Chiudi"…), o null se in questo momento non si può usare. */
  label(): string | null;
  use(): void;
  /** Le mesh che lo disegnano (o i loro gusci): chi è a portata prende un contorno (outline.ts). Senza, niente contorno. */
  outline?(): AbstractMesh[];
}

const REACH = 2.3;

export class Interact {
  readonly list: Usable[] = [];
  private cur: Usable | null = null;
  /** Tutto ciò che in questo momento è a portata di mano e si può usare (anche se non lo si sta guardando): chi disegna lo evidenzia. */
  readonly near: Usable[] = [];

  constructor(private prompt: (text: string | null) => void) {}

  /** Una volta per frame: l'occhio del giocatore e dove guarda. */
  update(eye: Vector3, yaw: number): void {
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best: Usable | null = null, score = 0.55;   // sotto questo coseno non lo si sta guardando
    this.near.length = 0;
    for (const u of this.list) {
      const dx = u.x - eye.x, dz = u.z - eye.z, d = Math.hypot(dx, dz);
      if (d > REACH || Math.abs(u.y - eye.y) > 1.6 || u.label() === null) continue;
      this.near.push(u);
      const k = d < 0.4 ? 1 : (dx * fx + dz * fz) / d;
      if (k > score) { score = k; best = u; }
    }
    this.cur = best;
    this.prompt(best ? best.label() : null);
  }

  use(): void { this.cur?.use(); }

  /** Ciò che si ha davanti in questo momento (quello a cui il tasto E si rivolge), se c'è. */
  get current(): Usable | null { return this.cur; }
}
