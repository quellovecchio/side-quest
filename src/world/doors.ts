import type { TransformNode } from "@babylonjs/core";
import type { Interact } from "../interact";
import type { Collider } from "./vegetation";

// ─────────────────────────────────────────────────────────────────────────────
// PORTE — ante a battente. L'asset dà, per ogni anta, il cardine, la direzione da chiusa e il nodo
// da ruotare; qui stanno il comportamento e l'ostacolo: un segmento per anta, che ferma il passo
// finché è chiusa. Una porta può avere due ante (un portone): si aprono insieme, con un tasto solo.
// Il giocatore la apre e la chiude con il tasto d'interazione; chi le arriva davanti camminando
// (un abitante) la apre da sé; resta aperta finché c'è qualcuno vicino, poi si richiude.
// ─────────────────────────────────────────────────────────────────────────────

export interface Leaf {
  /** Il cardine. */
  x: number; z: number;
  /** Direzione dell'anta chiusa dal cardine (rad: 0 = +Z, come uno yaw) e sua larghezza. */
  yaw: number; width: number;
  /** Il nodo dell'anta, con l'origine sul cardine: a riposo è chiusa. */
  pivot: TransformNode;
  /** Da che parte gira aprendosi (+1 o −1 attorno a y). */
  swing?: 1 | -1;
}

export interface DoorDef {
  /** Quota del pavimento. */
  y: number;
  leaves: Leaf[];
  /** Di quanto si aprono le ante (rad). Una porta in un tramezzo si ferma a 90°: oltre entrerebbe nel muro. */
  angle?: number;
}

interface Door { def: DoorDef; cols: Collider[]; base: number[]; open: number; want: boolean; idle: number; cx: number; cz: number }

const ANGLE = 1.75, HOLD = 4;

export class Doors {
  private doors: Door[];

  /** `solid` = gli ostacoli del giocatore (ci si aggiungono le ante); `interact` = dove si iscrivono al tasto. */
  constructor(defs: DoorDef[], solid: Collider[], interact: Pick<Interact, "list">) {
    this.doors = defs.map((def) => {
      let cx = 0, cz = 0;
      const cols = def.leaves.map((l): Collider => {
        const dx = Math.sin(l.yaw) * l.width, dz = Math.cos(l.yaw) * l.width;
        cx += (l.x + dx / 2) / def.leaves.length; cz += (l.z + dz / 2) / def.leaves.length;
        return { x: l.x, z: l.z, bx: l.x + dx, bz: l.z + dz, r: 0.06, y0: def.y, y1: def.y + 2.3 };
      });
      const d: Door = { def, cols, base: def.leaves.map((l) => l.pivot.rotation.y), open: 0, want: false, idle: 0, cx, cz };
      solid.push(...cols);
      interact.list.push({ x: cx, y: def.y + 1.3, z: cz, label: () => (d.want ? "Chiudi" : "Apri"), use: () => { d.want = !d.want; d.idle = 0; } });
      return d;
    });
  }

  /** `people` = chi può aprirle passando (gli abitanti); anche il giocatore, standole vicino, le tiene aperte. */
  update(dt: number, people: { pos: { x: number; y: number; z: number }; speed: number }[], player: { x: number; y: number; z: number }): void {
    for (const d of this.doors) {
      let near = Math.hypot(player.x - d.cx, player.z - d.cz) < 2 && Math.abs(player.y - d.def.y) < 1.5;
      for (const p of people) {
        if (Math.abs(p.pos.y - d.def.y) > 1.5) continue;
        const dist = Math.hypot(p.pos.x - d.cx, p.pos.z - d.cz);
        if (dist < 2) near = true;
        if (dist < 1.3 && p.speed > 0.1) d.want = true;   // un abitante in cammino la apre
      }
      d.idle = near ? 0 : d.idle + dt;
      if (d.want && d.idle > HOLD) d.want = false;        // nessuno nei paraggi: si richiude
      d.open += ((d.want ? 1 : 0) - d.open) * Math.min(1, dt * 6);
      d.def.leaves.forEach((l, i) => { l.pivot.rotation.y = d.base[i] + (l.swing ?? 1) * (d.def.angle ?? ANGLE) * d.open; });
      for (const c of d.cols) c.off = d.open > 0.35;
    }
  }
}
