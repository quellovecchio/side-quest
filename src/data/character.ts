import type { ClassDef, ModId, SkillDef, StatId } from "./db.ts";

// ─────────────────────────────────────────────────────────────────────────────
// PERSONAGGIO — le regole: cosa vale ogni statistica, quali abilità sono sbloccate, quanta
// esperienza serve per salire. Modulo puro (lo prova anche `npm run check`): classi e abilità le
// dà il file, qui sta il loro significato. Chi applica i numeri al gioco è main.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** I numeri del gioco su cui agiscono statistiche e abilità passive (`mods` nel file). Tranne la magicka, sono moltiplicatori: 1 = com'era. */
export type Tune = Record<ModId, number>;
export type Stats = Record<StatId, number>;

/** Una statistica a 5 non cambia niente; ogni punto sopra o sotto sposta il suo numero di qualche centesimo. */
export function derive(s: Stats, passives: SkillDef[]): Tune {
  const d = (v: number): number => v - 5;
  const t: Tune = {
    danno: 1 + 0.04 * d(s.forza),                    // il danno dei colpi
    "costo.colpo": 1 - 0.03 * d(s.destrezza),        // il vigore che costa un colpo
    passo: 1 + 0.01 * d(s.destrezza),                // passo e corsa
    resistenza: 1 - 0.04 * d(s.costituzione),        // il danno che si riceve
    "costo.parata": 1 - 0.03 * d(s.costituzione),    // il vigore che costa una parata
    "magicka.max": 20 + 10 * s.intelligenza,
    "magicka.rec": 0.5 + 0.3 * s.saggezza,           // magicka al secondo
    prezzi: 1 - 0.03 * d(s.carisma),                 // quanto si paga in bottega
  };
  for (const k of passives) for (const m of k.mods ?? []) t[m.stat] = t[m.stat] * (m.mul ?? 1) + (m.add ?? 0);
  for (const k of Object.keys(t) as ModId[]) t[k] = Math.max(k.startsWith("magicka") ? 0 : 0.3, t[k]);
  return t;
}

/** Le abilità dell'albero della classe sbloccate con queste statistiche: la statistica al livello richiesto e i prerequisiti già sbloccati. */
export function unlocked(cls: ClassDef | undefined, s: Stats): string[] {
  const out: string[] = [];
  for (let grown = true; grown && cls;) {
    grown = false;
    for (const n of cls.skillTree) {
      if (out.includes(n.skill) || s[n.stat] < n.level || !n.requires.every((r) => out.includes(r))) continue;
      out.push(n.skill); grown = true;
    }
  }
  return out;
}

/** L'esperienza che serve per passare dal livello `level` al successivo. */
export const need = (level: number, base: number): number => base * level;
