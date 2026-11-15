// ─────────────────────────────────────────────────────────────────────────────
// DATABASE — `public/data/db.json`: tutto ciò che nel gioco è "chi, dove, quanto" sta in un file
// solo, a tabelle con id a stringa e riferimenti per id (il paradigma di dragonmountain). Il codice
// tiene i generatori (aspetto, movenze, il significato degli effetti); il file li richiama per chiave.
//
// Si carica una volta all'avvio, PRIMA del mondo, e non cambia durante la partita: ciò che cambia è
// lo stato della partita, altrove. Ogni campo è controllato alla lettura: un errore ferma l'avvio
// dicendo dove sta ("creatures[1].stats.salute: …"), invece di un valore di ripiego che si scopre tardi.
//
// Il piano completo (tabelle in arrivo: npcs, items, classes, skills, locations, quests) è in
// docs/piano-dati-e-interni.md. Oggi ci sono l'orologio, le creature e dove nascono, i luoghi (radura, città), le strade
// gli abitanti (chi sono, la giornata a orari, cosa dicono, come reagiscono, cosa vendono), gli oggetti, i forzieri e ciò
// con cui comincia chi gioca.
// ─────────────────────────────────────────────────────────────────────────────

export interface CreatureDef {
  id: string; name: string;
  /** Quale animale è: aspetto e movenze stanno nel codice (`MODELS` in enemies.ts). */
  model: "wolf" | "rat";
  /** Salute, danno del morso, passo e corsa (m/s), da quanto fiuta la preda e da quanto la morde (m), spinta del morso, se le gira attorno fra un assalto e l'altro. */
  stats: { salute: number; morso: number; passo: number; corsa: number; fiuto: number; portata: number; spinta: number; accerchia: boolean };
  /** I tempi dell'assalto (s): carica, balzo, recupero, pausa prima del prossimo; e la velocità del balzo (m/s). */
  attack: { carica: number; balzo: number; recupero: number; pausa: number; slancio: number };
  /** Cosa lascia a chi la uccide: oggetto → quantità; e quanta esperienza. */
  loot: Record<string, number>; xp: number;
}

/** Un gruppo di creature e la sua casa: ci nasce, ci torna, ci rinasce. */
export interface SpawnDef {
  creature: string; at: [number, number]; count: number;
  /** Nascono sotto terra, in una cripta o in una grotta (l'id del luogo): allora `at` è lo scarto dal centro della camera. */
  in?: string;
}

/** L'orologio: a che ora comincia la partita, quanti minuti veri dura un giorno, a che ore ci si può svegliare dormendo. */
export interface TimeDef { start: number; dayMinutes: number; wake: { name: string; hour: number }[] }

/** I generatori che il file può richiamare: il codice sta in `world/town.ts` (uno per chiave, lo controlla il compilatore). */
export const PREFABS = ["casa.povera", "casa.graticcio", "casa.ricca", "cattedrale", "municipio", "fucina", "pozzo", "fontana", "banco", "panchina", "panca.pietra", "lampione", "botte", "cassa", "carretto", "bacheca", "orto", "lapidi", "festone", "stendardo", "insegna", "panni", "ponte", "teatro", "ponte.botteghe", "scala", "scala.parapetto"] as const;
export type PrefabId = typeof PREFABS[number];
/** Quelli che hanno bisogno di una misura (`size`: larghezza e profondità in metri). */
const SIZED: PrefabId[] = ["casa.povera", "casa.graticcio", "casa.ricca", "cassa"];

/**
 * Gli interni che il file può richiamare (`interior`): il codice sta in `world/interiors.ts`, le piante in `world/layouts.ts`
 * (un modello per chiave, lo controlla il compilatore). `FITS` dice in quale edificio entra ognuno: la locanda sta in una
 * casa del ricco, gli altri nell'edificio che porta il loro nome; `porta` è il corpo di guardia della porta della città (`gate`).
 */
export const INTERIORS = ["locanda", "casa.povera", "casa.graticcio", "casa.ricca", "cattedrale", "municipio", "fucina", "porta"] as const;
export type InteriorId = typeof INTERIORS[number];
const FITS: Record<InteriorId, PrefabId | "gate"> = { locanda: "casa.ricca", "casa.povera": "casa.povera", "casa.graticcio": "casa.graticcio", "casa.ricca": "casa.ricca", cattedrale: "cattedrale", municipio: "municipio", fucina: "fucina", porta: "gate" };

/**
 * Una cosa posata in un insediamento: coordinate locali all'insediamento (+x est, +z nord), `yaw` in gradi (0 = la facciata
 * guarda a nord, 90 a est). `tint` è il telo dei banchi; `interior` dice che ci si entra, e con quale interno: allora serve
 * un `id` (i posti dentro si chiamano `<id>.<posto>`, i letti `<id>.….letto`), e `seed` sceglie la pianta fra quelle del suo
 * tipo (senza, la sceglie l'id: due case dello stesso tipo non sono gemelle).
 * ⚠️ L'ordine conta: i numeri a caso (case appena storte, finestre accese) si estraggono in fila. Le cose nuove vanno in fondo.
 */
export interface ChildDef { id?: string; prefab: PrefabId; at: [number, number]; yaw: number; size?: [number, number]; /** Quanto è ingrandito l'edificio, altezze comprese (gli arredi dentro restano a misura d'uomo). */ scale: number; tint?: "vino" | "ocra" | "muschio"; interior?: InteriorId; seed?: number;
  /** Il seme delle piccole differenze a caso di questo elemento (inclinazioni, merci, numeri delle finestre): ognuno il suo, così aggiungerne o toglierne uno non cambia gli altri. */
  variant?: number;
  /**
   * Solo per scale e ponti (`LINED`): i punti, [x, quota, z] nelle coordinate dell'insediamento, la quota dal suolo sotto il
   * punto (come i capi dei festoni). A ogni punto di mezzo un pianerottolo o una svolta; la larghezza di una scala è `size[0]`.
   * Il lettore ne ricava `at`.
   */
  line?: [number, number, number][];
  /** Solo per gli oggetti tesi (`SPANS`): i due capi, [x, quota, z] nelle coordinate dell'insediamento. Il lettore ne ricava `at`, `yaw` e `size`. */
  from?: [number, number, number]; to?: [number, number, number] }
/** Gli oggetti tesi fra due punti: non hanno posizione e misura ma due capi (`from`, `to`), e si popolano in base alla lunghezza (town.ts, `span`). */
export const SPANS: PrefabId[] = ["festone", "panni"];
/** Quelli che seguono una mezzeria (`line`: due punti o più): le scale e i ponti. */
export const LINED: PrefabId[] = ["scala", "scala.parapetto", "ponte", "ponte.botteghe"];
/** Un selciato: una striscia dritta lungo x o lungo z, larga `width`. */
export interface PavingDef { kind: "lastre" | "lastre.diagonali" | "cubetti" | "ciottoli"; width: number; line: [number, number][] }
/** Un posto con un nome, dove qualcuno si ferma: coordinate locali, `yaw` in gradi. */
export interface SpotDef { at: [number, number]; yaw: number }

/**
 * Un luogo del mondo. `clearing` è una radura nel bosco; `settlement` una città murata, con la porta a ovest; `crypt` e `cave`
 * stanno sotto terra: `at` è dove comincia la discesa (nel mondo), `yaw` verso dove si scende (0 nord, 90 est, 180 sud, 270 ovest),
 * `depth` quanto sta sotto il pavimento della camera, `room` larghezza e profondità della camera.
 */
export interface LocationDef {
  id: string; kind: "clearing" | "settlement" | "crypt" | "cave"; at: [number, number];
  yaw?: number; depth?: number; room?: [number, number];
  /** Il nome con cui compare nel menu fra i viaggi rapidi (senza, non ci compare). */
  name?: string;
  /** Solo per gli insediamenti: il posto (uno dei suoi `spots`) dove si arriva, guardando dove guarda il posto. Senza, si arriva in `at`. */
  arrive?: string;
  /** Solo per gli insediamenti: mezzi lati del rettangolo delle mura e quota del piano. */
  ground?: { rect: [number, number]; level: number };
  /** Selciati, tracciati su cui camminano gli abitanti (i punti sono i nodi; un punto ripetuto in due tracciati è un incrocio), cose posate, posti. */
  paving: PavingDef[]; walks: [number, number][][]; /** Le zone verdi dentro le mura: rettangoli fra due angoli, nel riferimento del luogo. */ green: [number, number][][]; children: ChildDef[]; spots: Record<string, SpotDef>;
  /** Solo per gli insediamenti: la porta della città (a ovest). Con `interior` si entra nella torre sud e si sale al corpo di guardia. */
  /** La porta: `at` dove sta (senza: a metà del lato ovest del rettangolo), `yaw` verso dove guarda il fuori (gradi; senza: ovest, −90). */
  gate?: { id: string; interior?: "porta"; seed?: number; scale: number; at?: [number, number]; yaw?: number };
  /** Le mura come poligono chiuso nel riferimento del luogo (senza: il rettangolo di `ground.rect`); seguono il suolo. */
  walls?: [number, number][];
  /** Il fiume che attraversa il luogo: la mezzeria, la larghezza e la quota dell'acqua (assoluta). L'alveo è nel rilievo. */
  river?: { line: [number, number][]; width: number; level: number };
}

/** Un tracciato nel mondo: `trail` è un sentiero; `road` una strada che scende a un insediamento (`to`) e arriva alla sua porta. */
export interface RoadDef { id: string; kind: "trail" | "road"; line: [number, number][]; to?: string }

/** Gli aspetti che il file può richiamare (`look`): corporatura e vesti stanno in `CAST` (human.ts), cosa si tiene in mano in npcs.ts. */
export const LOOKS = ["monello", "bambina", "garzone", "educanda", "contadino", "fabbro", "cittadino", "lavandaia", "ostessa", "cittadina", "mercante", "sindaco", "parroco", "suora", "avventuriero", "mago", "vecchio", "vecchia", "lampionaio"] as const;
export type LookId = typeof LOOKS[number];
/** Le attività che il file può richiamare (`act`): le pose stanno in `ACTS` (npcs.ts). */
export const ACTS = ["stand", "pray", "hawk", "hammer", "work", "wash", "sit", "crossed", "ponder", "oversee", "sleep", "light", "lean"] as const;
export type ActId = typeof ACTS[number];

/**
 * Una condizione: una bandierina alzata, degli oggetti nell'inventario (oggetto → quanti almeno; `monete` vale le monete), un
 * forziere già aperto, l'ora fra due ore (anche a cavallo della mezzanotte), il contrario di un'altra, tutte insieme.
 */
export type Cond = { flag: string } | { has: Record<string, number> } | { opened: string } | { hour: [number, number] } | { not: Cond } | { all: Cond[] };
/**
 * Un effetto: righe da dire (fra parentesi quadre la narrazione), una bandierina da alzare, cose da dare o da prendere a chi
 * gioca (oggetto → quantità; `monete` è un numero, non un oggetto), salute da rendere.
 */
export type Effect = { say: string[] } | { flag: string } | { give: Record<string, number> } | { take: Record<string, number> } | { heal: number } | { quest: string };
/**
 * Una missione: comincia con l'effetto `quest`, e avanza da sé di tappa in tappa quando la condizione `done` della tappa in
 * corso diventa vera. Ogni tappa dice cosa fare (`text`) e, se c'è, dove (`at` = un posto con nome, o `npc` = un abitante):
 * lì punta il segnalino della bussola.
 */
export interface QuestDef { id: string; name: string; stages: { text: string; done: Cond; at?: string; npc?: string }[] }
/**
 * "Reagisce a → effetto": a cosa (`talk` = gli si parla, `hit` = gli si vibra la spada addosso, `use:<oggetto>` = gli si porge
 * quell'oggetto), a che condizione, se una volta sola, cosa succede.
 */
export interface InteractionDef { on: string; if?: Cond; once: boolean; do: Effect[] }
/** Gli aspetti della spada che il file può richiamare (`equip.look`): i materiali stanno in player/equipment.ts. */
export const BLADES = ["ferro", "argento"] as const;
/**
 * Un oggetto. `consumable` si usa (su di sé, o porgendolo a un abitante: se lui non reagisce vale `use`); `weapon` si impugna
 * (`equip`: il danno che aggiunge a ogni colpo e l'aspetto della lama); `misc` si raccoglie e si vende. `value` è il prezzo
 * in monete (chi compra da chi gioca ne dà la metà).
 */
export interface ItemDef {
  id: string; name: string; kind: "consumable" | "weapon" | "misc"; value: number;
  use?: Effect[]; equip?: { slot: "mano"; look: typeof BLADES[number]; stats: { danno: number } };
}
/** Le statistiche del personaggio e i numeri del gioco su cui agiscono le abilità passive: il loro significato sta in `data/character.ts`. */
export const STATS = ["forza", "destrezza", "costituzione", "intelligenza", "saggezza", "carisma"] as const;
export type StatId = typeof STATS[number];
export const MODS = ["danno", "costo.colpo", "costo.parata", "passo", "resistenza", "prezzi", "magicka.max", "magicka.rec"] as const;
export type ModId = typeof MODS[number];
/** I tipi di abilità attiva che il codice sa fare (`effect.cast`): un dardo che colpisce chi si ha davanti, una cura. */
export const CASTS = ["dardo", "cura"] as const;
/**
 * Un'abilità. `passive`: cambia dei numeri (`mods`: moltiplica e/o somma). `active`: si lancia (tasti 1, 2… nell'ordine
 * dell'albero), costa magicka e fa ciò che dice `effect` con quella potenza.
 */
export interface SkillDef {
  id: string; name: string; text: string; kind: "passive" | "active";
  mods?: { stat: ModId; mul?: number; add?: number }[];
  cost?: { magicka: number }; effect?: { cast: typeof CASTS[number]; power: number };
}
/** Una classe: le statistiche di partenza e l'albero delle abilità (ognuna si sblocca quando la statistica arriva al livello, se i prerequisiti sono sbloccati). */
export interface ClassDef {
  id: string; name: string; text: string; stats: Record<StatId, number>;
  skillTree: { skill: string; stat: StatId; level: number; requires: string[] }[];
}
/** Come si cresce: l'esperienza per il secondo livello (ogni livello ne chiede una volta di più) e i punti da spendere a ogni livello. */
export interface LevelsDef { xp: number; points: number }

/** Un forziere: sta in un posto con nome (dove ci si mette per aprirlo) e dà ciò che contiene una volta sola. */
export interface ContainerDef { id: string; name: string; at: string; items: Record<string, number>; monete: number }
/** Ciò con cui comincia chi gioca. */
export interface StartDef { monete: number; inventory: Record<string, number>; equipment: string[] }
/** Ciò che un abitante offre a chi gli parla: una bottega (cosa vende, fra che ore) e un letto a pagamento. */
export interface ServicesDef { shop?: { hours: [number, number]; items: string[] }; rest?: { cost: number } }
/** Una tappa: un posto con nome, cosa ci si fa e, se il giro ha più tappe, per quanti secondi (minimo e massimo). */
export interface StopDef { at: string; act: ActId; stay?: [number, number] }
/** Un tratto della giornata, da `from` (ore, nel file "HH:MM") al tratto dopo: un giro di tappe, oppure si segue qualcuno. */
export interface RoutineDef { from: number; stops: StopDef[]; follow?: string }
/** Un abitante. `home` è l'edificio dove abita (le sue finestre si accendono quando è dentro e sveglio); `social` = si ferma a chiacchierare con chi incrocia. */
export interface NpcDef {
  id: string; name: string; look: LookId; home?: string; speed: number; social: boolean;
  routine: RoutineDef[]; dialogue: string[]; interactions: InteractionDef[]; services: ServicesDef;
}

export interface Db {
  version: number; time: TimeDef; creatures: CreatureDef[]; spawns: SpawnDef[]; npcs: NpcDef[];
  items: ItemDef[]; containers: ContainerDef[]; player: StartDef;
  classes: ClassDef[]; skills: SkillDef[]; levels: LevelsDef; quests: QuestDef[];
  /** Il luogo dove comincia la partita. */
  spawn: string; locations: LocationDef[]; roads: RoadDef[];
}

export class DbError extends Error {}

/** Legge un valore controllandolo; `path` è dove sta nel file, per il messaggio d'errore. */
class Reader {
  private v: unknown; private path: string;
  // ⚠️ campi espliciti, non "constructor(private v…)": db.check.mjs fa girare questo file con Node, che toglie i tipi ma non sa espandere quelli
  constructor(v: unknown, path: string) { this.v = v; this.path = path; }

  private fail(what: string): never { throw new DbError(`${this.path}: ${what} (trovato ${JSON.stringify(this.v) ?? "niente"})`); }

  /** Un oggetto con esattamente questi campi: uno in più è quasi sempre un nome sbagliato. */
  obj<T>(fields: { [K in keyof T]: (r: Reader) => T[K] }): T {
    if (typeof this.v !== "object" || this.v === null || Array.isArray(this.v)) this.fail("atteso un oggetto");
    const o = this.v as Record<string, unknown>, extra = Object.keys(o).filter((k) => !(k in fields));
    if (extra.length) throw new DbError(`${this.path}: campo sconosciuto "${extra[0]}" (ammessi: ${Object.keys(fields).join(", ")})`);
    const out = {} as T;
    for (const k of Object.keys(fields) as (keyof T & string)[]) out[k] = fields[k](new Reader(o[k], `${this.path}.${k}`));
    return out;
  }

  list<T>(item: (r: Reader) => T): T[] {
    if (!Array.isArray(this.v)) this.fail("attesa una lista");
    return (this.v as unknown[]).map((x, i) => item(new Reader(x, `${this.path}[${i}]`)));
  }

  num(min = -Infinity, below = Infinity): number {
    if (typeof this.v !== "number" || !Number.isFinite(this.v)) this.fail("atteso un numero");
    if ((this.v as number) < min) this.fail(`atteso un numero da ${min} in su`);
    if ((this.v as number) >= below) this.fail(`atteso un numero sotto ${below}`);
    return this.v as number;
  }

  str(): string {
    if (typeof this.v !== "string" || !this.v) this.fail("atteso un testo");
    return this.v as string;
  }

  bool(): boolean {
    if (typeof this.v !== "boolean") this.fail("atteso true o false");
    return this.v as boolean;
  }

  one<T extends string>(...options: T[]): T {
    if (!options.includes(this.v as T)) this.fail(`atteso uno fra ${options.join(", ")}`);
    return this.v as T;
  }

  /** Un campo che può mancare: allora vale `dflt`. */
  or<T>(dflt: T, f: (r: Reader) => T): T { return this.v === undefined ? dflt : f(this); }

  /** Un oggetto a chiavi libere (nome → valore). */
  map<T>(item: (r: Reader) => T): Record<string, T> {
    if (typeof this.v !== "object" || this.v === null || Array.isArray(this.v)) this.fail("atteso un oggetto");
    return Object.fromEntries(Object.entries(this.v as object).map(([k, x]) => [k, item(new Reader(x, `${this.path}.${k}`))]));
  }

  /** Una spezzata: almeno `min` punti [x, z]. */
  line(min = 2): [number, number][] {
    const pts = this.list((p) => p.at());
    if (pts.length < min) this.fail(`attesi almeno ${min} punti`);
    return pts;
  }

  /** Un'ora del giorno scritta "HH:MM": la restituisce in ore. */
  time(): number {
    const m = typeof this.v === "string" ? /^([01]\d|2[0-3]):([0-5]\d)$/.exec(this.v) : null;
    if (!m) this.fail('attesa un\u2019ora "HH:MM"');
    return Number(m![1]) + Number(m![2]) / 60;
  }

  /** Un oggetto con UN solo campo fra questi (una condizione, un effetto): il campo dice di che tipo è. */
  pick<T>(cases: Record<string, (r: Reader) => unknown>): T {
    const keys = typeof this.v === "object" && this.v !== null && !Array.isArray(this.v) ? Object.keys(this.v) : [];
    if (keys.length !== 1 || !(keys[0] in cases)) this.fail(`atteso un oggetto con un solo campo fra ${Object.keys(cases).join(", ")}`);
    return { [keys[0]]: cases[keys[0]](new Reader((this.v as Record<string, unknown>)[keys[0]], `${this.path}.${keys[0]}`)) } as T;
  }

  /** Un punto [x, quota, z]. */
  xyz(): [number, number, number] {
    if (!Array.isArray(this.v) || this.v.length !== 3 || this.v.some((n) => typeof n !== "number")) this.fail("attese tre coordinate [x, quota, z]");
    return this.v as [number, number, number];
  }

  /** Coordinate [x, z] nel mondo. */
  at(): [number, number] {
    if (!Array.isArray(this.v) || this.v.length !== 2 || this.v.some((n) => typeof n !== "number")) this.fail("attese due coordinate [x, z]");
    return this.v as [number, number];
  }
}

const cond = (r: Reader): Cond => r.pick<Cond>({ flag: (x) => x.str(), has: (x) => x.map((n) => n.num(1)), opened: (x) => x.str(), hour: (x) => x.at(), not: cond, all: (x) => x.list(cond) });
/** Oggetto → quantità (da 1 in su). */
const bag = (r: Reader): Record<string, number> => r.map((n) => n.num(1));
const effect = (r: Reader): Effect => r.pick<Effect>({ say: (x) => x.list((s) => s.str()), flag: (x) => x.str(), give: bag, take: bag, heal: (x) => x.num(1), quest: (x) => x.str() });
/** Gli oggetti che una condizione nomina. */
const condItems = (c: Cond | undefined): string[] => (!c ? [] : "has" in c ? Object.keys(c.has).filter((k) => k !== "monete") : "not" in c ? condItems(c.not) : "all" in c ? c.all.flatMap(condItems) : []);
/** I forzieri che una condizione nomina, e le missioni che una lista di effetti fa cominciare. */
const condChests = (c: Cond | undefined): string[] => (!c ? [] : "opened" in c ? [c.opened] : "not" in c ? condChests(c.not) : "all" in c ? c.all.flatMap(condChests) : []);
const effectQuests = (list: Effect[]): string[] => list.flatMap((e) => ("quest" in e ? [e.quest] : []));
/** Gli oggetti che una lista di effetti dà o prende. */
const effectItems = (list: Effect[]): string[] => list.flatMap((e) => ("give" in e ? Object.keys(e.give) : "take" in e ? Object.keys(e.take) : [])).filter((k) => k !== "monete");

/**
 * I nomi dei posti a cui una tappa può puntare, per quanto si sa senza costruire il mondo: i posti di strada dell'insediamento
 * e gli edifici in cui si entra (`<id>.…`: che il posto dentro esista lo controlla il gioco all'avvio, e `npm run check` con le piante).
 */
export function spotCheck(db: Db): (name: string) => boolean {
  const town = db.locations.find((l) => l.kind === "settlement")!;
  const inside = new Set([...town.children, ...(town.gate ? [town.gate] : [])].filter((c) => c.interior).map((c) => c.id!));
  for (const l of db.locations) if (l.kind === "crypt" || l.kind === "cave") inside.add(l.id);   // i posti di cripte e grotte: <id>.ingresso, <id>.centro, <id>.fondo
  // (accanto a ogni lampione la città mette un posto: `lampione.N` nell'ordine del file, e `lampione.porta` per le lanterne della porta)
  const posts = town.children.filter((c) => c.prefab === "lampione").length;
  return (name) => name in town.spots || name === "lampione.porta" || (/^lampione\.\d+$/.test(name) && +name.slice(9) < posts) || (name.includes(".") && inside.has(name.slice(0, name.indexOf("."))));
}

/** Controlla il contenuto del file e i riferimenti fra le tabelle. */
export function parseDb(raw: unknown): Db {
  const db = new Reader(raw, "db.json").obj<Db>({
    version: (r) => r.num(1),
    time: (r) => r.obj<TimeDef>({
      start: (x) => x.num(0, 24), dayMinutes: (x) => x.num(1),
      wake: (x) => x.list((w) => w.obj({ name: (n) => n.str(), hour: (n) => n.num(0, 24) })),
    }),
    creatures: (r) => r.list((c) => c.obj<CreatureDef>({
      id: (x) => x.str(), name: (x) => x.str(), model: (x) => x.one("wolf", "rat"),
      stats: (x) => x.obj({ salute: (n) => n.num(1), morso: (n) => n.num(0), passo: (n) => n.num(0), corsa: (n) => n.num(0), fiuto: (n) => n.num(0), portata: (n) => n.num(0), spinta: (n) => n.num(0), accerchia: (n) => n.bool() }),
      attack: (x) => x.obj({ carica: (n) => n.num(0), balzo: (n) => n.num(0), recupero: (n) => n.num(0), pausa: (n) => n.num(0), slancio: (n) => n.num(0) }),
      loot: (x) => x.or({}, bag), xp: (x) => x.or(0, (n) => n.num(0)),
    })),
    classes: (r) => r.list((c) => c.obj<ClassDef>({
      id: (x) => x.str(), name: (x) => x.str(), text: (x) => x.str(),
      stats: (x) => x.obj<ClassDef["stats"]>(Object.fromEntries(STATS.map((s) => [s, (n: Reader) => n.num(1)])) as { [K in StatId]: (r: Reader) => number }),
      skillTree: (x) => x.list((n) => n.obj({ skill: (s) => s.str(), stat: (s) => s.one(...STATS), level: (s) => s.num(1), requires: (s) => s.or([], (q) => q.list((i) => i.str())) })),
    })),
    skills: (r) => r.list((k) => k.obj<SkillDef>({
      id: (x) => x.str(), name: (x) => x.str(), text: (x) => x.str(), kind: (x) => x.one("passive", "active"),
      mods: (x) => x.or<SkillDef["mods"]>(undefined, (m) => m.list((o) => o.obj({ stat: (s) => s.one(...MODS), mul: (n) => n.or(undefined, (v) => v.num(0)), add: (n) => n.or(undefined, (v) => v.num()) }))),
      cost: (x) => x.or<SkillDef["cost"]>(undefined, (c) => c.obj({ magicka: (n) => n.num(0) })),
      effect: (x) => x.or<SkillDef["effect"]>(undefined, (e) => e.obj({ cast: (s) => s.one(...CASTS), power: (n) => n.num(0) })),
    })),
    levels: (r) => r.obj<LevelsDef>({ xp: (x) => x.num(1), points: (x) => x.num(0) }),
    quests: (r) => r.list((q) => q.obj<QuestDef>({
      id: (x) => x.str(), name: (x) => x.str(),
      stages: (x) => x.list((s) => s.obj({ text: (t) => t.str(), done: cond, at: (t) => t.or(undefined, (v) => v.str()), npc: (t) => t.or(undefined, (v) => v.str()) })),
    })),
    items: (r) => r.list((i) => i.obj<ItemDef>({
      id: (x) => x.str(), name: (x) => x.str(), kind: (x) => x.one("consumable", "weapon", "misc"), value: (x) => x.num(0),
      use: (x) => x.or(undefined, (u) => u.list(effect)),
      equip: (x) => x.or<ItemDef["equip"]>(undefined, (e) => e.obj({ slot: (s) => s.one("mano"), look: (s) => s.one(...BLADES), stats: (s) => s.obj({ danno: (n) => n.num(0) }) })),
    })),
    containers: (r) => r.list((c) => c.obj<ContainerDef>({ id: (x) => x.str(), name: (x) => x.str(), at: (x) => x.str(), items: (x) => x.or({}, bag), monete: (x) => x.or(0, (n) => n.num(0)) })),
    player: (r) => r.obj<StartDef>({ monete: (x) => x.num(0), inventory: (x) => x.or({}, bag), equipment: (x) => x.or([], (e) => e.list((s) => s.str())) }),
    spawns: (r) => r.list((s) => s.obj<SpawnDef>({ creature: (x) => x.str(), at: (x) => x.at(), count: (x) => x.num(1), in: (x) => x.or(undefined, (n) => n.str()) })),
    npcs: (r) => r.list((n) => n.obj<NpcDef>({
      id: (x) => x.str(), name: (x) => x.str(), look: (x) => x.one(...LOOKS), home: (x) => x.or(undefined, (s) => s.str()),
      speed: (x) => x.num(0.1), social: (x) => x.or(false, (b) => b.bool()),
      routine: (x) => x.list((t) => t.obj<RoutineDef>({
        from: (h) => h.time(), follow: (f) => f.or(undefined, (s) => s.str()),
        stops: (s) => s.or([], (v) => v.list((p) => p.obj<StopDef>({ at: (a) => a.str(), act: (a) => a.one(...ACTS), stay: (a) => a.or(undefined, (t2) => t2.at()) }))),
      })),
      dialogue: (x) => x.or([], (v) => v.list((s) => s.str())),
      interactions: (x) => x.or([], (v) => v.list((i) => i.obj<InteractionDef>({ on: (o) => o.str(), if: (c) => c.or(undefined, cond), once: (o) => o.or(false, (b) => b.bool()), do: (d) => d.list(effect) }))),
      services: (x) => x.or<ServicesDef>({}, (s) => s.obj<ServicesDef>({
        shop: (p) => p.or<ServicesDef["shop"]>(undefined, (q) => q.obj({ hours: (h) => { const t = h.list((n) => n.time()); if (t.length !== 2) throw new DbError("services.shop.hours: attese due ore [apre, chiude]"); return [t[0], t[1]] as [number, number]; }, items: (l) => l.list((n) => n.str()) })),
        rest: (p) => p.or<ServicesDef["rest"]>(undefined, (q) => q.obj({ cost: (n) => n.num(0) })),
      })),
    })),
    spawn: (r) => r.str(),
    locations: (r) => r.list((l) => l.obj<LocationDef>({
      id: (x) => x.str(), kind: (x) => x.one("clearing", "settlement", "crypt", "cave"), at: (x) => x.at(),
      yaw: (x) => x.or(undefined, (n) => n.one(...([0, 90, 180, 270] as unknown as string[])) as unknown as number),
      depth: (x) => x.or(undefined, (n) => n.num(4, 12)), room: (x) => x.or(undefined, (n) => n.at()),
      name: (x) => x.or(undefined, (s) => s.str()), arrive: (x) => x.or(undefined, (s) => s.str()),
      ground: (x) => x.or<LocationDef["ground"]>(undefined, (g) => g.obj({ rect: (n) => n.at(), level: (n) => n.num() })),
      paving: (x) => x.or([], (v) => v.list((p) => p.obj<PavingDef>({ kind: (k) => k.one("lastre", "lastre.diagonali", "cubetti", "ciottoli"), width: (n) => n.num(0.5), line: (n) => n.line() }))),
      walks: (x) => x.or([], (v) => v.list((w) => w.line())), green: (x) => x.or([], (v) => v.list((w) => w.line())),
      children: (x) => x.or([], (v) => v.list((c) => c.obj<ChildDef>({
        id: (n) => n.or(undefined, (s) => s.str()), prefab: (n) => n.one(...PREFABS), at: (n) => n.or(undefined as unknown as [number, number], (a) => a.at()), yaw: (n) => n.or(0, (a) => a.num(-360, 360.001)),
        size: (n) => n.or(undefined, (s) => s.at()), tint: (n) => n.or(undefined, (s) => s.one("vino", "ocra", "muschio")), interior: (n) => n.or(undefined, (s) => s.one(...INTERIORS)),
        seed: (n) => n.or(undefined, (s) => s.num(0)), scale: (n) => n.or(1, (s) => s.num(0.5, 3)),
        variant: (n) => n.or(undefined, (s) => s.num(0)), from: (n) => n.or(undefined, (s) => s.xyz()), to: (n) => n.or(undefined, (s) => s.xyz()),
        line: (n) => n.or(undefined, (s) => s.list((p) => p.xyz())),
      }))),
      spots: (x) => x.or({}, (v) => v.map((s) => s.obj<SpotDef>({ at: (n) => n.at(), yaw: (n) => n.or(0, (a) => a.num(-360, 360.001)) }))),
      gate: (x) => x.or<LocationDef["gate"]>(undefined, (g) => g.obj({ id: (n) => n.str(), interior: (n) => n.or(undefined, (s) => s.one("porta")), seed: (n) => n.or(undefined, (s) => s.num(0)), scale: (n) => n.or(1, (s) => s.num(0.5, 3)), at: (n) => n.or(undefined, (s) => s.at()), yaw: (n) => n.or(undefined, (s) => s.num(-360, 360.001)) })),
      walls: (x) => x.or(undefined, (v) => v.line()),
      river: (x) => x.or<LocationDef["river"]>(undefined, (r) => r.obj({ line: (n) => n.line(), width: (n) => n.num(2, 60), level: (n) => n.num() })),
    })),
    roads: (r) => r.list((d) => d.obj<RoadDef>({ id: (x) => x.str(), kind: (x) => x.one("trail", "road"), line: (x) => x.line(), to: (x) => x.or(undefined, (s) => s.str()) })),
  });
  const ids = new Set<string>();
  db.creatures.forEach((c, i) => {
    if (ids.has(c.id)) throw new DbError(`db.json.creatures[${i}].id: "${c.id}" c'è già`);
    ids.add(c.id);
  });
  db.spawns.forEach((s, i) => {
    if (!ids.has(s.creature)) throw new DbError(`db.json.spawns[${i}].creature: "${s.creature}" non è fra le creature (${[...ids].join(", ")})`);
    if (s.in && !db.locations.some((l) => l.id === s.in && (l.kind === "crypt" || l.kind === "cave"))) throw new DbError(`db.json.spawns[${i}].in: "${s.in}" non è una cripta né una grotta`);
  });
  // luoghi e strade
  const places = new Map<string, LocationDef>();
  db.locations.forEach((l, i) => {
    const at = `db.json.locations[${i}]`;
    if (places.has(l.id)) throw new DbError(`${at}.id: "${l.id}" c'è già`);
    places.set(l.id, l);
    const under = l.kind === "crypt" || l.kind === "cave";
    if (under ? l.yaw === undefined || l.depth === undefined || !l.room : l.yaw !== undefined || l.depth !== undefined || !!l.room) throw new DbError(`${at}: a una cripta o a una grotta (e solo a loro) servono yaw, depth e room`);
    if (under && (l.id.includes(".") || l.room!.some((v) => v < 4 || v > 30))) throw new DbError(`${at}: l'id non può contenere un punto, e la camera va da 4 a 30 m di lato`);
    if (l.arrive && !(l.arrive in l.spots)) throw new DbError(`${at}.arrive: "${l.arrive}" non è fra i posti di questo luogo`);
    if (l.gate && l.kind !== "settlement") throw new DbError(`${at}.gate: solo un insediamento ha una porta`);
    if (l.kind !== "settlement") return;
    if (!l.ground) throw new DbError(`${at}.ground: a un insediamento servono il rettangolo delle mura e la quota`);
    if (l.ground.rect.some((h) => h < 10)) throw new DbError(`${at}.ground.rect: mezzi lati da 10 m in su`);
    if (l.walls && (l.walls.length < 3 || l.walls.some(([x, z]) => Math.abs(x) > l.ground!.rect[0] + 0.01 || Math.abs(z) > l.ground!.rect[1] + 0.01))) throw new DbError(`${at}.walls: un poligono di almeno tre punti, dentro il rettangolo di ground.rect`);
    l.paving.forEach((p, j) => {
      const [[ax, az], [bx, bz]] = p.line;
      // (due punti allineati: una striscia dritta, piatta; altrimenti un nastro lungo la spezzata, che segue il suolo)
      if (p.line.length < 2 || (p.line.length === 2 && ax === bx && az === bz)) throw new DbError(`${at}.paving[${j}].line: un selciato va da un punto a un altro`);
    });
    const seen = new Set<string>(l.gate ? [l.gate.id] : []);
    if (l.gate?.id.includes(".")) throw new DbError(`${at}.gate.id: "${l.gate.id}" non può contenere un punto (i posti dentro si chiamano id.posto)`);
    l.children.forEach((c, j) => {
      // un oggetto teso ha i due capi e niente altro che lo metta a posto; ne ricaviamo centro, verso e lunghezza
      if (SPANS.includes(c.prefab)) {
        if (!c.from || !c.to || c.at || c.size) throw new DbError(`${at}.children[${j}]: un "${c.prefab}" si tende fra due capi: servono from e to [x, quota, z], e niente at né size`);
        const dx = c.to[0] - c.from[0], dz = c.to[2] - c.from[2], len = Math.hypot(dx, dz);
        if (len < 0.5 || len > 40) throw new DbError(`${at}.children[${j}]: fra i due capi ci vogliono da 0,5 a 40 m (sono ${len.toFixed(1)})`);
        c.at = [(c.from[0] + c.to[0]) / 2, (c.from[2] + c.to[2]) / 2]; c.yaw = Math.atan2(-dz, dx) * 180 / Math.PI; c.size = [len, 0];
      } else if (LINED.includes(c.prefab)) {   // scale e ponti seguono la loro mezzeria: il centro è a metà
        if (!c.line || c.line.length < 2 || c.at || c.from || c.to) throw new DbError(`${at}.children[${j}]: un "${c.prefab}" segue una mezzeria: serve line [[x, quota, z], …] (almeno due punti), e niente at, from, to`);
        const len = c.line.slice(1).reduce((a, p, k) => a + Math.hypot(p[0] - c.line![k][0], p[2] - c.line![k][2]), 0);
        if (len < 2 || len > 160) throw new DbError(`${at}.children[${j}].line: lunga da 2 a 160 m (è ${len.toFixed(1)})`);
        const m = c.line[Math.floor((c.line.length - 1) / 2)];
        c.at = [m[0], m[2]]; c.yaw = 0; if (c.prefab.startsWith("scala")) c.size ??= [4.4, 0];
      } else if (c.line) throw new DbError(`${at}.children[${j}].line: la mezzeria è solo di scale e ponti (${LINED.join(", ")})`);
      else if (!c.at || c.from || c.to) throw new DbError(`${at}.children[${j}]: a un "${c.prefab}" serve at [x, z] (from e to sono solo degli oggetti tesi: ${SPANS.join(", ")})`);
      if (SIZED.includes(c.prefab) && !c.size) throw new DbError(`${at}.children[${j}].size: a "${c.prefab}" serve la misura [larghezza, profondità]`);
      if (c.interior && FITS[c.interior] !== c.prefab) throw new DbError(`${at}.children[${j}].interior: l'interno "${c.interior}" sta in ${FITS[c.interior] === "gate" ? "una porta della città (gate)" : `un "${FITS[c.interior]}"`}, non in un "${c.prefab}"`);
      if (c.interior && !c.id) throw new DbError(`${at}.children[${j}].id: a un edificio in cui si entra serve un nome (i posti dentro si chiamano id.posto)`);
      if (c.interior && c.id!.includes(".")) throw new DbError(`${at}.children[${j}].id: "${c.id}" non può contenere un punto (i posti dentro si chiamano id.posto)`);
      if (c.seed !== undefined && !c.interior) throw new DbError(`${at}.children[${j}].seed: il seme sceglie la pianta di un interno, e qui non c'è`);
      if (c.id && seen.has(c.id)) throw new DbError(`${at}.children[${j}]: "${c.id}" c'è già in questo insediamento`);
      if (c.id) seen.add(c.id);
    });
  });
  // ponytail: una città sola (terreno, ombre e luce dei lampioni sono tarati su un rettangolo); più insediamenti quando servono
  if (db.locations.filter((l) => l.kind === "settlement").length !== 1) throw new DbError("db.json.locations: per ora serve esattamente un insediamento");
  if (!places.has(db.spawn)) throw new DbError(`db.json.spawn: "${db.spawn}" non è fra i luoghi (${[...places.keys()].join(", ")})`);
  const roads = new Set<string>();
  db.roads.forEach((d, i) => {
    if (roads.has(d.id)) throw new DbError(`db.json.roads[${i}].id: "${d.id}" c'è già`);
    roads.add(d.id);
    if (d.kind === "road" && places.get(d.to ?? "")?.kind !== "settlement") throw new DbError(`db.json.roads[${i}].to: una strada porta a un insediamento ("${d.to ?? ""}" non lo è)`);
    if (d.kind === "trail" && d.to) throw new DbError(`db.json.roads[${i}].to: un sentiero non ha destinazione`);
  });
  // oggetti: id unici (e mai "monete", che è un numero); ciò che si usa dice cosa fa, ciò che si impugna dice come; ogni oggetto nominato esiste
  const items = new Map(db.items.map((i) => [i.id, i]));
  const known = (ids: string[], at: string): void => { for (const id of ids) if (!items.has(id)) throw new DbError(`${at}: "${id}" non è fra gli oggetti`); };
  db.items.forEach((it, i) => {
    const at = `db.json.items[${i}]`;
    if (it.id === "monete" || it.id.includes(":") || db.items.findIndex((o) => o.id === it.id) !== i) throw new DbError(`${at}.id: "${it.id}" c'è già o non è un nome ammesso`);
    if ((it.kind === "consumable") !== !!it.use) throw new DbError(`${at}.use: serve a un oggetto che si usa (consumable), e solo a quello`);
    if ((it.kind === "weapon") !== !!it.equip) throw new DbError(`${at}.equip: serve a un'arma (weapon), e solo a quella`);
    known(effectItems(it.use ?? []), `${at}.use`);
  });
  db.creatures.forEach((c, i) => known(Object.keys(c.loot), `db.json.creatures[${i}].loot`));
  known(Object.keys(db.player.inventory), "db.json.player.inventory");
  db.player.equipment.forEach((id, i) => { if (items.get(id)?.kind !== "weapon") throw new DbError(`db.json.player.equipment[${i}]: "${id}" non è un'arma`); });
  db.containers.forEach((c, i) => {
    const at = `db.json.containers[${i}]`;
    if (db.containers.findIndex((o) => o.id === c.id) !== i) throw new DbError(`${at}.id: "${c.id}" c'è già`);
    if (!spotCheck(db)(c.at)) throw new DbError(`${at}.at: "${c.at}" non è un posto della città né sta in un edificio in cui si entra`);
    known(Object.keys(c.items), `${at}.items`);
  });
  // classi e abilità: id unici; una passiva ha i suoi `mods`, un'attiva costo ed effetto; l'albero nomina abilità che esistono, una volta sola,
  // e i prerequisiti stanno nello stesso albero
  const skills = new Set<string>();
  db.skills.forEach((k, i) => {
    const at = `db.json.skills[${i}]`;
    if (skills.has(k.id)) throw new DbError(`${at}.id: "${k.id}" c'è già`);
    skills.add(k.id);
    if ((k.kind === "passive") !== !!k.mods || (k.kind === "active") !== !!(k.cost && k.effect)) throw new DbError(`${at}: una passiva ha "mods"; un'attiva ha "cost" ed "effect"`);
  });
  if (!db.classes.length) throw new DbError("db.json.classes: serve almeno una classe");
  db.classes.forEach((c, i) => {
    const at = `db.json.classes[${i}]`, tree = c.skillTree.map((n) => n.skill);
    if (db.classes.findIndex((o) => o.id === c.id) !== i) throw new DbError(`${at}.id: "${c.id}" c'è già`);
    c.skillTree.forEach((n, j) => {
      if (!skills.has(n.skill) || tree.indexOf(n.skill) !== j) throw new DbError(`${at}.skillTree[${j}].skill: "${n.skill}" non è fra le abilità, o è ripetuta`);
      const miss = n.requires.find((q) => !tree.includes(q) || q === n.skill);
      if (miss !== undefined) throw new DbError(`${at}.skillTree[${j}].requires: "${miss}" non è un'altra abilità di questo albero`);
    });
  });
  // missioni: id unici, almeno una tappa; posti, abitanti, oggetti e forzieri nominati esistono; e ogni missione che un effetto fa cominciare c'è
  const chests = new Set(db.containers.map((c) => c.id)), quests = new Set(db.quests.map((q) => q.id));
  const wants = (c: Cond | undefined, at: string): void => {
    known(condItems(c), at);
    for (const id of condChests(c)) if (!chests.has(id)) throw new DbError(`${at}: "${id}" non è fra i forzieri`);
  };
  db.quests.forEach((q, i) => {
    const at = `db.json.quests[${i}]`;
    if (db.quests.findIndex((o) => o.id === q.id) !== i) throw new DbError(`${at}.id: "${q.id}" c'è già`);
    if (!q.stages.length) throw new DbError(`${at}.stages: serve almeno una tappa`);
    q.stages.forEach((s, j) => {
      wants(s.done, `${at}.stages[${j}].done`);
      if (s.at && !spotCheck(db)(s.at)) throw new DbError(`${at}.stages[${j}].at: "${s.at}" non è un posto della città né sta in un edificio in cui si entra`);
      if (s.npc && !db.npcs.some((n) => n.id === s.npc)) throw new DbError(`${at}.stages[${j}].npc: "${s.npc}" non è fra gli abitanti`);
    });
  });
  for (const [i, it] of db.items.entries()) for (const id of effectQuests(it.use ?? [])) if (!quests.has(id)) throw new DbError(`db.json.items[${i}].use: "${id}" non è fra le missioni`);
  // abitanti: la giornata è in ordine d'ora; ogni tratto è un giro di tappe o un "segui"; posti, case e capofila esistono
  const spot = spotCheck(db), town = db.locations.find((l) => l.kind === "settlement")!, who = new Map(db.npcs.map((n) => [n.id, n]));
  db.npcs.forEach((n, i) => {
    const at = `db.json.npcs[${i}]`;
    if (db.npcs.findIndex((o) => o.id === n.id) !== i) throw new DbError(`${at}.id: "${n.id}" c'è già`);
    if (n.home && !town.children.some((c) => c.id === n.home && c.interior)) throw new DbError(`${at}.home: "${n.home}" non è un edificio in cui si entra`);
    if (!n.routine.length) throw new DbError(`${at}.routine: serve almeno un tratto della giornata`);
    n.interactions.forEach((it, j) => {
      const use = /^use:(.+)$/.exec(it.on);
      if (it.on !== "talk" && it.on !== "hit" && !use) throw new DbError(`${at}.interactions[${j}].on: atteso talk, hit o use:<oggetto> (trovato "${it.on}")`);
      known([...(use ? [use[1]] : []), ...effectItems(it.do)], `${at}.interactions[${j}]`);
      wants(it.if, `${at}.interactions[${j}].if`);
      for (const id of effectQuests(it.do)) if (!quests.has(id)) throw new DbError(`${at}.interactions[${j}].do: "${id}" non è fra le missioni`);
    });
    known(n.services.shop?.items ?? [], `${at}.services.shop.items`);
    n.routine.forEach((t, j) => {
      if (j && t.from <= n.routine[j - 1].from) throw new DbError(`${at}.routine[${j}].from: i tratti vanno in ordine d'ora`);
      if (!t.follow === !t.stops.length) throw new DbError(`${at}.routine[${j}]: serve un giro di tappe (stops) oppure qualcuno da seguire (follow), non tutti e due`);
      const lead = t.follow ? who.get(t.follow) : undefined;
      if (t.follow && (!lead || lead === n || lead.routine.some((r) => r.follow))) throw new DbError(`${at}.routine[${j}].follow: "${t.follow}" dev'essere un altro abitante, che non segue nessuno`);
      t.stops.forEach((s, k) => {
        if (!spot(s.at)) throw new DbError(`${at}.routine[${j}].stops[${k}].at: "${s.at}" non è un posto della città né sta in un edificio in cui si entra`);
        if (t.stops.length > 1 && !s.stay) throw new DbError(`${at}.routine[${j}].stops[${k}].stay: in un giro di più tappe ognuna dice quanto dura [minimo, massimo] in secondi`);
        if (s.stay && (s.stay[0] <= 0 || s.stay[1] < s.stay[0])) throw new DbError(`${at}.routine[${j}].stops[${k}].stay: attesi [minimo, massimo] in secondi`);
      });
    });
  });
  return db;
}

export async function loadDb(): Promise<Db> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/db.json`, { cache: "no-cache" });
  if (!res.ok) throw new DbError(`db.json: non si carica (${res.status})`);
  let raw: unknown;
  try { raw = await res.json(); } catch (e) { throw new DbError(`db.json: non è JSON valido — ${(e as Error).message}`); }
  return parseDb(raw);
}
