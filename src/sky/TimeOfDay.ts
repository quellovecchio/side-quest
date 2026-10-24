/**
 * TimeOfDay — l'ORA del giorno da cui discendono sole (o luna), luce ambiente, colori del cielo, delle
 * nuvole e della foschia, esposizione della notte e luci artificiali. Una sola fonte per la partita
 * (main.ts) e per il campus (CampusScene): stessa ora, stessa luce. Chi la applica a una scena è
 * DayCycle.ts; qui ci sono solo i numeri.
 *
 * Il giro è di 24 ore, a chiavi interpolate: notte (fino alle 4:45), crepuscolo dell'alba (5:30), alba
 * (6), le 10:30, mezzogiorno, pomeriggio, tramonto (19), l'ora blu (19:30), notte piena dalle 21.
 *
 * Sole: quota da una curva diurna (0 alle 6 e alle 19, ~62° a metà giornata), azimut che ruota di
 * 180° fra alba e tramonto. ⚠️ L'azimut è ANCORATO: alle 10:30 la luce viaggia nella stessa direzione
 * orizzontale di prima (−0,6, −0,5), quindi le ombre di giocatori, tribune ed edifici non cambiano
 * verso rispetto a come il gioco è stato composto; la quota (55°) è quasi quella di prima (57°).
 * Fuori dalla finestra 5:30-19:30 la luce direzionale della scena è la LUNA (alta, fissa, fredda): il
 * passaggio avviene quando entrambe sono spente (intensità 0 alle 5:30 e alle 19:30), senza scatti.
 *
 * ⚠️ Intensità: il cel shading dei materiali (CelShading.ts) ha soglie tarate sulla LUMINANZA del
 * sole (≈1,11 = 1,25 × il giallo del tardo pomeriggio). Di giorno l'intensità di ogni ora è scelta perché
 * la luminanza resti in quell'intorno; una luce più bianca ha un'intensità più bassa.
 * Di notte le intensità sono ASSOLUTE (la luna è ~0,34 del sole) e a rimettere il contrasto di giorno è
 * l'ESPOSIZIONE (`exposure`): il cel shading confronta la luce con le sue soglie DIVISA per l'esposizione
 * e ne moltiplica il risultato (vedi CelShading.ts). Così la luna fa la stessa ombra netta del sole, solo
 * più scura e più fredda, e una luce vera (lampione, faro) che somma luce assoluta ESCE dal buio.
 */
import { Color3, DirectionalLight, HemisphericLight, Vector3 } from "@babylonjs/core";
import { tokenColor } from "./palette";

/** L'ora di RIFERIMENTO del gioco (le 10:30): quella su cui sono tarati materiali e colori. */
export const GAME_HOUR = 10.5;

/** Finestra in cui la luce direzionale è il sole (fuori, la luna). */
const SUN_FROM = 5.5, SUN_TO = 19.5;

export interface DayLight {
  hour: number;
  /** Direzione in cui VIAGGIA la luce direzionale della scena (sole o luna), normalizzata. */
  sunDir: Vector3;
  sunElevDeg: number;
  /** Colore e intensità della luce direzionale (sole di giorno, luna di notte). */
  sunColor: Color3;
  sunIntensity: number;
  /** La luce direzionale è la luna? */
  moonlight: boolean;
  ambientSky: Color3;
  ambientGround: Color3;
  ambientIntensity: number;
  /** Cielo: zenit, a metà altezza, all'orizzonte, e la foschia che lo lava sull'orizzonte. */
  zenith: Color3;
  mid: Color3;
  horizon: Color3;
  haze: Color3;
  /** Nuvole: faccia al sole, tono medio, pancia in ombra, bordo acceso. */
  cloudLit: Color3;
  cloudMid: Color3;
  cloudShadow: Color3;
  cloudRim: Color3;
  /** Colore della foschia del post-process (ToonShading `hazeColor`): quello dell'orizzonte. */
  fog: Color3;
  /** Direzione VERA del sole (anche sotto l'orizzonte: il disco nel cielo tramonta davvero). */
  sunDiscDir: Vector3;
  /** Direzione verso la luna (disco nel cielo) e quanto si vede, 0..1. */
  moonDir: Vector3;
  moonVis: number;
  /** Stelle, 0..1. */
  stars: number;
  /** Esposizione della scena: 1 di giorno, 0,34 di notte (vedi l'intestazione). */
  exposure: number;
  /** Luci artificiali (finestre, lampioni, fari): 0 spente, 1 piene. */
  glow: number;
}

const mix = (a: Color3, b: Color3, t: number): Color3 => Color3.Lerp(a, b, t);
const T = tokenColor;
/** Un token scurito: il cielo di notte è fatto degli stessi colori, con meno luce. */
const D = (name: string, k: number): Color3 => tokenColor(name).scale(k);

interface Key {
  h: number;
  /** Luce direzionale della chiave (sole nella finestra del giorno, luna fuori). */
  sun: [number, number, number]; sunI: number;
  amb: [number, number, number]; ground: [number, number, number]; ambI: number;
  exp: number; glow: number; stars: number; moon: number;
  sky: () => { zenith: Color3; mid: Color3; horizon: Color3; haze: Color3 };
  cloud: () => { lit: Color3; mid: Color3; shadow: Color3; rim: Color3 };
}

// Notte: luna fredda a ~0,34 della luminanza del sole, cielo ambiente nella stessa proporzione. Con
// l'esposizione a 0,34 la luna "fa" il sole di giorno: stesse soglie, stessa ombra netta, più scura.
// (0,34 e non meno: una partita di notte in uno stadio senza fari deve restare giocabile.)
const NIGHT = {
  sun: [0.62, 0.72, 1.0] as [number, number, number], sunI: 0.52,
  amb: [0.35, 0.42, 0.7] as [number, number, number], ground: [0.1, 0.1, 0.16] as [number, number, number], ambI: 0.25,
  exp: 0.34, glow: 1, stars: 1, moon: 1,
  sky: () => ({ zenith: mix(D("--stmp-sky-600", 0.2), D("--stmp-grape-500", 0.12), 0.25), mid: D("--stmp-sky-600", 0.32),
    horizon: mix(D("--stmp-sky-600", 0.45), D("--stmp-grape-500", 0.3), 0.3), haze: mix(D("--stmp-sky-500", 0.34), D("--stmp-grape-400", 0.3), 0.25) }),
  cloud: () => ({ lit: mix(D("--stmp-sky-300", 0.42), D("--stmp-bone-200", 0.4), 0.35), mid: D("--stmp-sky-500", 0.34),
    shadow: D("--stmp-sky-600", 0.2), rim: D("--stmp-sky-100", 0.5) }),
};

const KEYS: Key[] = [
  { h: 0, ...NIGHT },
  { h: 4.75, ...NIGHT },
  // crepuscolo dell'alba: né sole né luna, il cielo si schiarisce da est, le luci ancora accese
  { h: 5.5, sun: [0.8, 0.7, 0.9], sunI: 0, amb: [0.5, 0.5, 0.72], ground: [0.2, 0.14, 0.12], ambI: 0.32,
    exp: 0.55, glow: 0.8, stars: 0.2, moon: 0.3,
    sky: () => ({ zenith: D("--stmp-sky-600", 0.55), mid: mix(D("--stmp-sky-500", 0.6), D("--stmp-grape-400", 0.55), 0.4),
      horizon: mix(T("--stmp-sunset-300"), T("--stmp-grape-400"), 0.35), haze: mix(T("--stmp-sunset-300"), T("--stmp-sunset-100"), 0.4) }),
    cloud: () => ({ lit: mix(T("--stmp-sunset-300"), T("--stmp-grape-400"), 0.3), mid: mix(D("--stmp-grape-400", 0.8), D("--stmp-sky-500", 0.7), 0.5),
      shadow: D("--stmp-sky-600", 0.5), rim: T("--stmp-sunset-300") }) },
  { h: 6.0, sun: [1.0, 0.7, 0.48], sunI: 1.35, amb: [0.42, 0.45, 0.62], ground: [0.30, 0.18, 0.10], ambI: 0.45,
    exp: 1, glow: 0.2, stars: 0, moon: 0,
    sky: () => ({ zenith: T("--stmp-sky-600"), mid: mix(T("--stmp-sky-400"), T("--stmp-sunset-300"), 0.35),
      horizon: T("--stmp-gold-300"), haze: T("--stmp-sunset-100") }),
    cloud: () => ({ lit: T("--stmp-gold-100"), mid: mix(T("--stmp-sunset-100"), T("--stmp-sky-300"), 0.3),
      shadow: mix(T("--stmp-sky-500"), T("--stmp-sunset-300"), 0.35), rim: T("--stmp-gold-300") }) },
  { h: 6.5, sun: [1.0, 0.76, 0.54], sunI: 1.33, amb: [0.44, 0.49, 0.66], ground: [0.31, 0.19, 0.10], ambI: 0.46,
    exp: 1, glow: 0, stars: 0, moon: 0,
    sky: () => ({ zenith: T("--stmp-sky-600"), mid: mix(T("--stmp-sky-400"), T("--stmp-sunset-300"), 0.3),
      horizon: mix(T("--stmp-gold-300"), T("--stmp-sky-100"), 0.2), haze: mix(T("--stmp-sunset-100"), T("--stmp-bone-100"), 0.2) }),
    cloud: () => ({ lit: T("--stmp-gold-100"), mid: mix(T("--stmp-sunset-100"), T("--stmp-sky-300"), 0.35),
      shadow: mix(T("--stmp-sky-500"), T("--stmp-sunset-300"), 0.3), rim: T("--stmp-gold-300") }) },
  // le 10:30: luce bianca appena calda, cielo azzurro pieno, orizzonte chiaro e un filo polveroso
  { h: 10.5, sun: [1.0, 0.95, 0.86], sunI: 1.16, amb: [0.52, 0.66, 0.9], ground: [0.36, 0.26, 0.13], ambI: 0.5,
    exp: 1, glow: 0, stars: 0, moon: 0,
    sky: () => ({ zenith: mix(T("--stmp-sky-500"), T("--stmp-sky-400"), 0.25), mid: mix(T("--stmp-sky-400"), T("--stmp-sky-300"), 0.45),
      horizon: mix(T("--stmp-sky-100"), T("--stmp-sky-300"), 0.25), haze: mix(T("--stmp-sky-100"), T("--stmp-bone-100"), 0.55) }),
    cloud: () => ({ lit: T("--stmp-bone-50"), mid: mix(T("--stmp-bone-100"), T("--stmp-sky-100"), 0.5),
      shadow: mix(T("--stmp-sky-300"), T("--stmp-bone-300"), 0.35), rim: mix(T("--stmp-bone-50"), T("--stmp-gold-100"), 0.5) }) },
  { h: 13.0, sun: [1.0, 0.98, 0.93], sunI: 1.13, amb: [0.52, 0.67, 0.92], ground: [0.36, 0.27, 0.14], ambI: 0.5,
    exp: 1, glow: 0, stars: 0, moon: 0,
    sky: () => ({ zenith: T("--stmp-sky-500"), mid: T("--stmp-sky-400"), horizon: T("--stmp-sky-100"),
      haze: mix(T("--stmp-sky-100"), T("--stmp-bone-100"), 0.4) }),
    cloud: () => ({ lit: T("--stmp-bone-50"), mid: mix(T("--stmp-bone-100"), T("--stmp-sky-100"), 0.5),
      shadow: mix(T("--stmp-sky-300"), T("--stmp-bone-300"), 0.3), rim: T("--stmp-bone-50") }) },
  // il pomeriggio del cielo di prima
  { h: 16.5, sun: [1.0, 0.88, 0.65], sunI: 1.25, amb: [0.45, 0.60, 0.85], ground: [0.35, 0.22, 0.08], ambI: 0.5,
    exp: 1, glow: 0, stars: 0, moon: 0,
    sky: () => ({ zenith: T("--stmp-sky-500"), mid: T("--stmp-sky-300"), horizon: T("--stmp-gold-100"), haze: T("--stmp-gold-100") }),
    cloud: () => ({ lit: T("--stmp-bone-50"), mid: T("--stmp-bone-200"), shadow: mix(T("--stmp-sky-300"), T("--stmp-bone-300"), 0.5),
      rim: T("--stmp-gold-100") }) },
  // le luci artificiali si accendono col sole basso, prima del tramonto
  { h: 18.25, sun: [1.0, 0.72, 0.48], sunI: 1.36, amb: [0.42, 0.48, 0.70], ground: [0.32, 0.19, 0.08], ambI: 0.46,
    exp: 1, glow: 0, stars: 0, moon: 0,
    sky: () => ({ zenith: T("--stmp-sky-500"), mid: mix(T("--stmp-sky-300"), T("--stmp-sunset-300"), 0.45),
      horizon: mix(T("--stmp-gold-300"), T("--stmp-sunset-300"), 0.5), haze: mix(T("--stmp-gold-100"), T("--stmp-sunset-300"), 0.4) }),
    cloud: () => ({ lit: mix(T("--stmp-gold-100"), T("--stmp-sunset-300"), 0.4), mid: mix(T("--stmp-bone-200"), T("--stmp-sunset-100"), 0.5),
      shadow: mix(T("--stmp-sky-500"), T("--stmp-grape-400"), 0.3), rim: T("--stmp-gold-300") }) },
  { h: 19.0, sun: [1.0, 0.58, 0.36], sunI: 1.45, amb: [0.40, 0.38, 0.55], ground: [0.30, 0.16, 0.08], ambI: 0.42,
    exp: 1, glow: 0.45, stars: 0, moon: 0,
    sky: () => ({ zenith: T("--stmp-sky-600"), mid: mix(T("--stmp-grape-400"), T("--stmp-sunset-300"), 0.5),
      horizon: T("--stmp-sunset-400"), haze: T("--stmp-sunset-300") }),
    cloud: () => ({ lit: T("--stmp-sunset-300"), mid: mix(T("--stmp-sunset-100"), T("--stmp-grape-400"), 0.3),
      shadow: mix(T("--stmp-grape-500"), T("--stmp-sky-500"), 0.4), rim: T("--stmp-gold-300") }) },
  // l'ora blu: il sole è sotto, l'orizzonte ancora acceso, le luci piene
  { h: 19.5, sun: [0.8, 0.6, 0.7], sunI: 0, amb: [0.42, 0.42, 0.66], ground: [0.2, 0.13, 0.1], ambI: 0.3,
    exp: 0.6, glow: 0.9, stars: 0.1, moon: 0.3,
    sky: () => ({ zenith: D("--stmp-sky-600", 0.62), mid: mix(D("--stmp-sky-600", 0.7), D("--stmp-grape-500", 0.8), 0.45),
      horizon: mix(T("--stmp-sunset-500"), T("--stmp-grape-400"), 0.45), haze: mix(T("--stmp-sunset-400"), T("--stmp-grape-400"), 0.35) }),
    cloud: () => ({ lit: mix(T("--stmp-sunset-400"), T("--stmp-grape-400"), 0.4), mid: mix(D("--stmp-grape-500", 0.8), D("--stmp-sky-600", 0.8), 0.5),
      shadow: D("--stmp-sky-600", 0.45), rim: T("--stmp-sunset-300") }) },
  { h: 20.25, sun: [0.62, 0.72, 1.0], sunI: 0.4, amb: [0.36, 0.42, 0.7], ground: [0.12, 0.1, 0.14], ambI: 0.27,
    exp: 0.42, glow: 1, stars: 0.6, moon: 0.9,
    sky: () => ({ zenith: D("--stmp-sky-600", 0.3), mid: mix(D("--stmp-sky-600", 0.42), D("--stmp-grape-500", 0.4), 0.3),
      horizon: mix(D("--stmp-grape-500", 0.6), D("--stmp-sunset-500", 0.5), 0.3), haze: mix(D("--stmp-grape-400", 0.5), D("--stmp-sky-500", 0.45), 0.4) }),
    cloud: () => ({ lit: mix(D("--stmp-sky-300", 0.5), D("--stmp-grape-400", 0.5), 0.35), mid: D("--stmp-sky-500", 0.4),
      shadow: D("--stmp-sky-600", 0.25), rim: D("--stmp-sky-100", 0.55) }) },
  { h: 21.0, ...NIGHT },
  { h: 24.0, ...NIGHT },
];

/** Verso orizzontale della luce alle 10:30: quello di prima, (−0,6, −0,5). */
const ANCHOR_AZ = Math.atan2(-0.5, -0.6);
/** La luna: alta e ferma, dal lato opposto al sole del mattino (le sue ombre cadono verso la TV). */
const MOON_ELEV = 42 * Math.PI / 180;
const MOON_AZ = ANCHOR_AZ + Math.PI * 0.82;

/** Quota VERA del sole in gradi (negativa sotto l'orizzonte). */
function sunElevation(hour: number): number {
  const h = hour < 0 ? hour + 24 : hour;
  // la curva va da 0 alle 6 a 0 alle 19; oltre prosegue sotto l'orizzonte fino a −30°
  const e = 62 * Math.sin(Math.PI * (h - 6) / 13);
  return h < 6 - 4 || h > 19 + 4 ? -30 : Math.max(-30, e);
}

function dirFrom(az: number, elev: number): Vector3 {
  const h = Math.cos(elev);
  // direzione in cui VIAGGIA la luce: verso il basso
  return new Vector3(Math.cos(az) * h, -Math.sin(elev), Math.sin(az) * h).normalize();
}

function sunDirection(hour: number): { dir: Vector3; disc: Vector3; elevDeg: number } {
  const day = Math.min(1, Math.max(0, (hour - 6) / 13));
  const elev = Math.max(2, 62 * Math.sin(Math.PI * day)) * Math.PI / 180;
  // mezzo giro fra le 6 e le 19, ancorato alle 10:30
  const az = ANCHOR_AZ + (hour - GAME_HOUR) * (Math.PI / 13);
  const trueElev = sunElevation(hour) * Math.PI / 180;
  return { dir: dirFrom(az, elev), disc: dirFrom(az, trueElev).scale(-1), elevDeg: elev * 180 / Math.PI };
}

/** L'ora ricondotta a [0, 24). */
export function wrapHour(hour: number): number {
  return ((hour % 24) + 24) % 24;
}

export function dayLight(hour = GAME_HOUR): DayLight {
  const hh = wrapHour(hour);
  let i = 0;
  while (i < KEYS.length - 2 && hh > KEYS[i + 1].h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = (hh - a.h) / (b.h - a.h);
  const lerp = (x: number, y: number): number => x + (y - x) * t;
  const lerp3 = (x: [number, number, number], y: [number, number, number]): Color3 =>
    new Color3(lerp(x[0], y[0]), lerp(x[1], y[1]), lerp(x[2], y[2]));
  const sa = a.sky(), sb = b.sky(), ca = a.cloud(), cb = b.cloud();
  const moonlight = hh < SUN_FROM || hh > SUN_TO;
  const sd = sunDirection(hh);
  const moonDirLight = dirFrom(MOON_AZ, MOON_ELEV);
  const horizon = mix(sa.horizon, sb.horizon, t), haze = mix(sa.haze, sb.haze, t);
  return {
    hour: hh,
    sunDir: moonlight ? moonDirLight : sd.dir,
    sunElevDeg: moonlight ? MOON_ELEV * 180 / Math.PI : sd.elevDeg,
    sunColor: lerp3(a.sun, b.sun), sunIntensity: lerp(a.sunI, b.sunI),
    moonlight,
    ambientSky: lerp3(a.amb, b.amb), ambientGround: lerp3(a.ground, b.ground), ambientIntensity: lerp(a.ambI, b.ambI),
    zenith: mix(sa.zenith, sb.zenith, t), mid: mix(sa.mid, sb.mid, t), horizon, haze,
    cloudLit: mix(ca.lit, cb.lit, t), cloudMid: mix(ca.mid, cb.mid, t), cloudShadow: mix(ca.shadow, cb.shadow, t),
    cloudRim: mix(ca.rim, cb.rim, t),
    fog: mix(horizon, haze, 0.5),
    sunDiscDir: sd.disc,
    moonDir: moonDirLight.scale(-1),
    moonVis: lerp(a.moon, b.moon),
    stars: lerp(a.stars, b.stars),
    exposure: lerp(a.exp, b.exp),
    glow: lerp(a.glow, b.glow),
  };
}

/** Sole (o luna) e luce ambiente della scena secondo l'ora. */
export function applyDayLight(d: DayLight, sun: DirectionalLight, ambient: HemisphericLight): void {
  sun.direction.copyFrom(d.sunDir);
  sun.diffuse = d.sunColor.clone();
  sun.intensity = d.sunIntensity;
  ambient.diffuse = d.ambientSky.clone();
  ambient.groundColor = d.ambientGround.clone();
  ambient.intensity = d.ambientIntensity;
}

/** "HH:MM" di un'ora decimale. */
export function fmtHour(hour: number): string {
  const m = Math.round(wrapHour(hour) * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
