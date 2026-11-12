// ─────────────────────────────────────────────────────────────────────────────
// STILE GRAFICO — due direzioni artistiche per lo stesso mondo, scelte dal menu:
//   "moderno": il primo look (PBR pulito, mattino, colori pieni);
//   "dark":    RPG cupo dei primi anni 2000 (Gothic, Oblivion, Two Worlds): texture
//              sgranate e desaturate, alberi a poche carte grandi, erba a quad incrociati,
//              tardo pomeriggio coperto, nebbia fitta, bloom pesante.
// Gli asset si generano all'avvio secondo lo stile: cambiarlo ricarica la pagina.
// ─────────────────────────────────────────────────────────────────────────────

export type StyleId = "moderno" | "dark";

const KEY = "sidequest.style";

function read(): StyleId {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "moderno" || v === "dark") return v;
  } catch { /* storage non disponibile: default */ }
  return "dark";
}

// Lo stile è uno solo: il dark fantasy. Il "moderno" è stato tolto (non si sceglie più); nel codice restano i suoi
// valori come primo argomento di `by(…)`, da ripulire man mano che si rifanno gli asset.
export const STYLE: StyleId = (read(), "dark");
export const DARK = true;

/** Sceglie il valore dello stile attivo (sempre il secondo: il dark). */
export const by = <T>(_moderno: T, dark: T): T => dark;

export function setStyle(s: StyleId): void {
  if (s === STYLE) return;
  try { localStorage.setItem(KEY, s); } catch { return; }
  location.reload();
}
