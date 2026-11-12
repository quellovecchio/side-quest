import type { Collider } from "./vegetation";

// ─────────────────────────────────────────────────────────────────────────────
// QUOTE — il mondo a più livelli.
//
// Il terreno ha una quota sola per punto; solai, pianerottoli e rampe di scale no. Qui il suolo
// diventa "la superficie più alta che si ha sotto i piedi": terreno e pavimenti (`Floor`), cercati
// in una griglia. Tre domande:
//   · `ground(x, z, y)`  dove si appoggia chi sta a quota y (sale da sé un gradino alto fino a STEP);
//   · `ceiling(x, z, y)` dove batte la testa chi salta;
//   · `covered(x, z)`    se lì sopra c'è un pavimento (dentro un edificio: niente foschia).
// Una rampa è un pavimento in pendenza: le scale si salgono camminando. Dove il solaio ha un vano
// non c'è pavimento, e si cade al piano di sotto.
// Gli ostacoli restano quelli di sempre (`Collider`), ma possono essere segmenti (muri sottili, porte)
// e fermare solo in una fascia d'altezza: `nearest()` dice il loro punto più vicino.
// ─────────────────────────────────────────────────────────────────────────────

/** Superficie calpestabile: un rettangolo orientato, piano o in pendenza. */
export interface Floor {
  /** Centro, semilati lungo x e z locali, rotazione attorno a y (come lo yaw di un edificio). */
  x: number; z: number; hx: number; hz: number; yaw: number;
  /** Quota al centro. */
  y: number;
  /** Rampa: dislivello da −hz a +hz (z locale). */
  rise?: number;
  /** Spessore del solaio sotto la superficie: chi sta sotto ci batte la testa. Assente = nessun soffitto (una rampa aperta). */
  thick?: number;
}

/** Il gradino che si sale senza saltare, e l'altezza di chi cammina. */
export const STEP = 0.55, BODY = 1.8;

const CELL = 4, key = (ix: number, iz: number): number => (ix + 4096) * 8192 + iz + 4096;
/**
 * Un pavimento nella griglia, col coseno e il seno del suo yaw e il raggio che lo contiene. Con tutti gli edifici aperti i
 * pavimenti sono centinaia, e a ogni frame li interroga chi cammina e ogni falda di foschia: il conto va tenuto corto.
 */
interface Slot { f: Floor; c: number; s: number; r: number }

export class Levels {
  private cells = new Map<number, Slot[]>();

  /** `holes` = i rettangoli [x0, z0, x1, z1] dove il terreno non c'è (le trincee del sottosuolo): lì si sta solo sui pavimenti. */
  constructor(private terrain: (x: number, z: number) => number, floors: Floor[] = [], private holes: number[][] = []) {
    for (const f of floors) this.add(f);
  }

  add(f: Floor): void {
    const r = Math.hypot(f.hx, f.hz), q: Slot = { f, c: Math.cos(f.yaw), s: Math.sin(f.yaw), r };
    for (let ix = Math.floor((f.x - r) / CELL); ix <= Math.floor((f.x + r) / CELL); ix++) {
      for (let iz = Math.floor((f.z - r) / CELL); iz <= Math.floor((f.z + r) / CELL); iz++) {
        const k = key(ix, iz), c = this.cells.get(k);
        if (c) c.push(q); else this.cells.set(k, [q]);
      }
    }
  }

  /** Quota della superficie `f` in (x, z), o NaN se (x, z) è fuori dal rettangolo. */
  private at(q: Slot, x: number, z: number): number {
    const f = q.f, dx = x - f.x, dz = z - f.z;
    if (dx > q.r || dx < -q.r || dz > q.r || dz < -q.r) return NaN;
    const lx = dx * q.c - dz * q.s, lz = dx * q.s + dz * q.c;
    if (Math.abs(lx) > f.hx || Math.abs(lz) > f.hz) return NaN;
    return f.y + (f.rise ? f.rise * lz / (2 * f.hz) : 0);
  }

  /** Dove si appoggia chi sta a quota `y` (senza `y`: chi cammina sul terreno). Arrow: si passa come funzione. */
  ground = (x: number, z: number, y?: number): number => {
    const t = this.terrain(x, z), floors = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    if (!floors) return t;
    const top = (y ?? t) + STEP, hole = this.holes.some((h) => x > h[0] && x < h[2] && z > h[1] && z < h[3]);
    let best = !hole && t <= top ? t : -Infinity;
    for (const f of floors) { const h = this.at(f, x, z); if (h <= top && h > best) best = h; }   // NaN non passa nessun confronto
    // sotto il terreno senza un pavimento si torna in superficie (non dovrebbe capitare: il sottosuolo ha sempre un pavimento)
    return best === -Infinity ? t : best;
  };

  /** Il soffitto più basso sopra chi sta a quota `y` (Infinity = cielo aperto). */
  ceiling = (x: number, z: number, y: number): number => {
    const floors = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    let low = Infinity;
    if (floors) for (const q of floors) {
      if (!q.f.thick) continue;
      const u = this.at(q, x, z) - q.f.thick;
      if (u > y + 1 && u < low) low = u;
    }
    return low;
  };

  /** C'è un pavimento sopra questo punto del terreno? */
  covered = (x: number, z: number): boolean => {
    const floors = this.cells.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
    return !!floors && floors.some((f) => !Number.isNaN(this.at(f, x, z)));
  };
}

/** Il punto dell'ostacolo più vicino a (x, z): il centro del cerchio, o il punto del segmento. Scrive in `out`. */
export function nearest(c: Collider, x: number, z: number, out: { x: number; z: number }): void {
  out.x = c.x; out.z = c.z;
  if (c.bx === undefined) return;
  const ex = c.bx - c.x, ez = c.bz! - c.z, t = Math.min(1, Math.max(0, ((x - c.x) * ex + (z - c.z) * ez) / (ex * ex + ez * ez || 1)));
  out.x += ex * t; out.z += ez * t;
}

/** L'ostacolo ferma chi ha i piedi a quota `y`? (È acceso, e la sua fascia incrocia il corpo dal ginocchio in su.) */
export const blocks = (c: Collider, y: number): boolean =>
  !c.off && (c.y0 === undefined || (y + BODY > c.y0 && y + 0.3 < c.y1!));

/**
 * Il tratto da a a b, fatto a piedi dalla quota `ya` alla quota `yb`, passa ad almeno `gap` metri da ogni ostacolo?
 * Lo usa la rete degli abitanti (town.ts): per legare l'uscio di ogni edificio alle strade, e per controllarla.
 */
export function clearWay(cols: Collider[], ax: number, az: number, bx: number, bz: number, ya: number, yb = ya, gap = 0.18): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.15)), p = { x: 0, z: 0 };
  for (let i = 0; i <= n; i++) {
    const k = i / n, x = ax + (bx - ax) * k, z = az + (bz - az) * k, y = ya + (yb - ya) * k;
    for (const c of cols) {
      if (c.soft || !blocks(c, y)) continue;
      nearest(c, x, z, p);
      if (Math.hypot(x - p.x, z - p.z) < c.r + gap) return false;
    }
  }
  return true;
}
