// ─────────────────────────────────────────────────────────────────────────────
// KIT — i pezzi fatti con Blender (`tools/blender/kit.py` → `public/kit/kit.json`): gradini,
// montanti, colonnini, corrimano, travi, battenti, imposte, piombi delle vetrate. Sono geometria pura (posizioni, normali, occlusione cotta
// nei vertici, indici), un blocco per materiale del gioco: li posa il muratore (`Mason.piece` in
// town.ts) nelle stesse mesh del resto, così prendono le stesse texture e la stessa luce — cotta
// dentro gli edifici, il sole fuori.
// Va caricato prima di costruire il mondo (`loadKit` in main.ts): chi costruisce lo usa subito.
// ─────────────────────────────────────────────────────────────────────────────

export type PieceId = "gradino" | "montante" | "colonnino" | "corrimano" | "trave" | "anta" | "imposta" | "piombi" | "rosone" | "trafori" | "guglia" | "colonnina"
  | "fontana" | "vera" | "fusto" | "ruota" | "incudine" | "tavolo" | "panca" | "sgabello" | "scranno" | "letto" | "botte" | "forziere"
  | "lettone" | "bancone" | "scrittoio" | "leggio" | "scaffale" | "armadio" | "bancochiesa" | "plinto" | "capitello" | "fonte" | "altare" | "candeliere" | "braciere"
  | "bugia" | "boccale" | "brocca" | "ciotola" | "cesta" | "secchio" | "paiolo" | "sacco" | "lumiera" | "panchina" | "bancarella" | "bacheca";
/** Un blocco di un pezzo: posizioni e normali (tre numeri per vertice), occlusione (uno), indici dei triangoli. */
export interface Block { p: number[]; n: number[]; c: number[]; i: number[] }

let KIT: Record<string, Record<string, Block>> = {};
/** Le teste scolpite (`tools/blender/teste.py` → `public/kit/teste.json`): in "teste" (alta 1, il mento a quota 0, il viso a +Z), e dove sta l'occhio destro. */
export type HeadId = "uomo" | "donna" | "vecchio" | "bimbo";
let HEADS: Record<HeadId, Block> & { eye: [number, number, number] } | null = null;

export async function loadKit(): Promise<void> {
  const [kit, heads] = await Promise.all(["kit", "teste"].map((n) => fetch(`${import.meta.env.BASE_URL}kit/${n}.json`)));
  if (!kit.ok) throw new Error(`kit.json: non si carica (${kit.status}) — va rigenerato con tools/blender/kit.py`);
  if (!heads.ok) throw new Error(`teste.json: non si carica (${heads.status}) — va rigenerato con tools/blender/teste.py`);
  KIT = await kit.json(); HEADS = await heads.json();
}

export function heads(): NonNullable<typeof HEADS> {
  if (!HEADS) throw new Error("kit: le teste non sono state caricate (loadKit)");
  return HEADS;
}

/** I blocchi di un pezzo, per materiale. */
export function piece(name: PieceId): Record<string, Block> {
  const p = KIT[name];
  if (!p) throw new Error(`kit: il pezzo "${name}" non c'è (kit.json va rigenerato, o non è stato caricato)`);
  return p;
}
