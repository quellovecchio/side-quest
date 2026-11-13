import { Mesh, MeshBuilder, Scene, Vector3 } from "@babylonjs/core";
import { buildHuman, type Human } from "./human";
import { blobShadowMaterial } from "./enemies";
import { surfaceMaterial } from "./world/materials";
import { clamp, mulberry32, smoothstep } from "./world/noise";
import { clothTex } from "./world/textures";
import { LIGHT } from "./world/interiors";
import type { TownPlan } from "./world/town";
import { DbError, type ActId, type LookId, type NpcDef, type RoutineDef, type StopDef } from "./data/db";
import type { Collider } from "./world/vegetation";

// ─────────────────────────────────────────────────────────────────────────────
// ABITANTI — i diciotto delle tavole, che vivono la città.
//
// Animazione procedurale: ogni attività scrive una POSA (angoli delle giunture, in termini
// "naturali": positivo = in avanti / piegato / in fuori), e le giunture la inseguono con uno
// smorzamento. Così ogni passaggio (camminare → fermarsi → pregare → sedersi) si raccorda da sé.
//
// Comportamento: chi sono, dove stanno e a che ora lo dice db.json (`npcs`). La giornata è fatta di tratti a orari:
// in ogni tratto un giro di tappe (posto + attività + durata), o qualcuno da seguire. Ci si cammina lungo i nodi
// delle strade e degli interni; la sera si va a letto. Due che si incrociano si fermano a chiacchierare; tutti
// seguono il giocatore con lo sguardo e si scansano dalla spada; a chi gli parla (tasto E) si voltano e rispondono.
// Qui restano le movenze (`ACTS`) e cosa ha in mano ogni figura (`HOLD`).
// ─────────────────────────────────────────────────────────────────────────────

const KEYS = ["drop", "hipX", "hipY", "hipZ", "spX", "spY", "spZ", "hdX", "hdY", "a0X", "a0Y", "a0Z", "f0", "a1X", "a1Y", "a1Z", "f1", "l0", "s0", "l1", "s1", "t0", "t1", "w0", "w1", "g0", "g1", "y0", "y1", "jaw", "brow", "blink"] as const;
/** drop = quanto si abbassa il bacino (m); sp = schiena, hd = testa, a = braccio (X avanti, Y verso dentro, Z in fuori), f = gomito, l = coscia, s = ginocchio, t = punta del piede (in giù; a zero il piede resta piatto a terra), w = polso (piegato in avanti), g = dita (0 aperte … 1 chiuse a pugno), y = come è girata la mano (0 = palmo avanti, dove stanno gli oggetti; 1 = verso il corpo, come pende un braccio rilassato; 2 = all'indietro, cioè in giù se l'avambraccio è steso su un tavolo); nel volto jaw = quanto è aperta la bocca (rad), brow = sopracciglia (+1 alzate, −1 aggrottate), blink = palpebre (1 = chiuse). */
type Pose = Record<(typeof KEYS)[number], number>;
const blank = (): Pose => Object.fromEntries(KEYS.map((k) => [k, 0])) as Pose;

/** Cosa tiene in mano [sinistra, destra]: 0 niente, 1 un oggetto, 2 un bastone piantato a terra. */
type Hold = [number, number];

/** In piedi: respiro, peso da un piede all'altro, sguardo che gira. Le altre pose partono da qui. */
function rest(p: Pose, h: Human, t: number, ph: number, hold: Hold): void {
  for (const k of KEYS) p[k] = 0;
  p.spX = h.stoop + Math.sin(t * 1.3 + ph) * 0.012; p.hdX = -h.stoop * 0.55;
  p.hipZ = Math.sin(t * 0.37 + ph) * 0.02; p.spZ = -p.hipZ;
  p.hdY = Math.sin(t * 0.23 + ph * 3) * Math.sin(t * 0.071 + ph) * 0.45;
  // le braccia pendono a piombo anche se la schiena è curva; chi ha un bastone lo tiene dritto
  p.a0X = p.a1X = h.stoop;
  p.a0Z = hold[0] === 2 ? 0 : 0.06; p.a1Z = hold[1] === 2 ? 0 : 0.06;
  p.f0 = hold[0] === 2 ? 0 : hold[0] ? 0.3 : 0.14; p.f1 = hold[1] === 2 ? 0 : hold[1] ? 0.3 : 0.14;
  // chi tiene qualcosa lo stringe (e il polso resta fermo: l'oggetto è rigido con l'avambraccio); una mano libera pende socchiusa
  // (rilassata vuol dire: il palmo verso la coscia, le dita a metà, il polso appena piegato)
  p.g0 = hold[0] ? 1 : 0.5; p.g1 = hold[1] ? 1 : 0.5; p.w0 = hold[0] ? 0 : 0.14; p.w1 = hold[1] ? 0 : 0.14; p.y0 = hold[0] ? 0 : 1; p.y1 = hold[1] ? 0 : 1;
  // fermo, ma vivo: ogni tanto sposta il peso su un fianco (l'anca sale, il ginocchio dell'altra gamba si piega), il petto respira
  const w = smoothstep(0.35, 0.8, Math.sin(t * 0.19 + ph * 2)) - smoothstep(0.35, 0.8, Math.sin(t * 0.19 + ph * 2 + Math.PI));
  p.hipZ += 0.05 * w; p.spZ -= 0.04 * w; p.s0 = 0.14 * Math.max(0, w); p.s1 = 0.14 * Math.max(0, -w); p.l0 = 0.05 * Math.max(0, w); p.l1 = 0.05 * Math.max(0, -w);
  if (!hold[0]) p.a0X += Math.sin(t * 0.8 + ph) * 0.025; if (!hold[1]) p.a1X += Math.sin(t * 0.8 + ph + 1.3) * 0.025;
}

/** Il passo: `k` = ampiezza (1 = passo d'uomo, oltre 1,2 è una corsa). */
function walk(p: Pose, h: Human, ph: number, k: number, hold: Hold): void {
  const A = 0.48 * Math.min(k, 1.4), s = Math.sin(ph), c = Math.cos(ph), run = smoothstep(1.1, 1.4, k);
  p.l0 = A * s; p.l1 = -A * s;
  p.s0 = (0.85 + run * 0.6) * k * Math.max(0, c); p.s1 = (0.85 + run * 0.6) * k * Math.max(0, -c);   // il ginocchio si piega mentre la gamba viene avanti
  p.drop = h.leg * (1 - Math.cos(A * s));                                                              // il piede d'appoggio resta a terra
  // la rullata: il tallone tocca con la punta alzata, a fine appoggio il tallone si stacca, in volo la punta pende appena
  const roll = (q: number, cq: number): number => 0.55 * smoothstep(0.35, 1, -q) * Math.min(k, 1.2) + 0.16 * Math.max(0, cq) - 0.3 * smoothstep(0.6, 1, q);
  p.t0 = roll(s, c); p.t1 = roll(-s, -c);
  // il bacino gira con la gamba che avanza e cala dalla parte di quella che si stacca; le spalle girano al contrario, la
  // testa resta dritta; a ogni passo il corpo sale e scende un poco (due volte per ciclo)
  p.drop += 0.012 * k * (1 - Math.cos(2 * ph));
  p.spX += 0.035 + run * 0.16; p.hipY = 0.1 * s * Math.min(k, 1.2); p.hipZ = 0.045 * Math.sin(ph + 0.5);
  p.spY = -0.17 * s * Math.min(k, 1.2); p.spZ = -p.hipZ * 0.7; p.hdY = -(p.spY + p.hipY) * 0.85; p.hdX -= run * 0.1 + 0.02;
  // le braccia oscillano dalla spalla; l'avambraccio resta indietro di un attimo e si piega quando il braccio viene avanti
  const sw = 0.42 * k + run * 0.3, lag = Math.sin(ph - 0.55);
  if (!hold[0]) { p.a0X += sw * s * -1; p.a0Z += 0.03; p.f0 = 0.22 + run * 0.9 + 0.32 * Math.max(0, -lag); }
  if (!hold[1]) { p.a1X += sw * s; p.a1Z += 0.03; p.f1 = 0.22 + run * 0.9 + 0.32 * Math.max(0, lag); }
}

const ACTS: Record<ActId, (p: Pose, h: Human, t: number, ph: number) => void> = {
  stand() { /* la posa di base */ },
  // dietro il banco, le mani sul piano (chi gli parla lo trova così: vedi `update`)
  lean(p, _h, t, ph) { lean(p, t, ph, false, [0, 0]); },
  // mani giunte davanti al petto, capo chino, un dondolio appena
  pray(p, _h, t, ph) {
    p.spX += 0.2 + Math.sin(t * 0.7 + ph) * 0.03; p.hdX += 0.34; p.hdY = 0;
    p.blink = 1; p.jaw = 0.03 + 0.03 * Math.abs(Math.sin(t * 2.6 + ph));   // occhi chiusi, le labbra che mormorano
    p.a0X = p.a1X = 0.5; p.a0Y = p.a1Y = 0.72; p.a0Z = p.a1Z = 0.1; p.f0 = p.f1 = 2.05;
    p.g0 = p.g1 = 0.04; p.w0 = p.w1 = -0.25;   // le mani giunte, piatte
  },
  // il lampionaio: la pertica alzata verso la lanterna, lo sguardo in su
  light(p, _h, t, ph) {
    const w = Math.sin(t * 1.6 + ph) * 0.05;
    p.spX -= 0.08; p.hdX -= 0.42; p.hdY = 0;
    p.a1X = 2.35 + w; p.a1Z = 0.12; p.f1 = 0.25 - w;
  },
  // il mercante al banco: un braccio alto che chiama, l'altro che mostra la merce, il busto che gira verso chi passa
  hawk(p, _h, t, ph) {
    const call = smoothstep(-0.2, 0.3, Math.sin(t * 0.55 + ph)), w = Math.sin(t * 5.2);
    p.spX += 0.06; p.spY = Math.sin(t * 0.4 + ph) * 0.4; p.hdY = p.spY * 0.6; p.hdX -= 0.08 * call;
    p.jaw = call * (0.1 + 0.16 * Math.abs(Math.sin(t * 7.3 + ph))); p.brow = 0.7 * call;   // chiama a bocca aperta
    p.g1 = 0.25 - 0.2 * call; p.w1 = -0.3 * call; p.g0 = 0.1; p.w0 = -0.35; p.y0 = 0; p.y1 = 0.3;                 // la mano alzata si apre, l'altra mostra la merce a palmo in su
    p.a1X = 0.4 + 2.0 * call + 0.14 * w * call; p.a1Z = 0.1 + 0.35 * call; p.f1 = 1.2 - 0.6 * call + 0.3 * w * call;
    p.a0X = 0.75; p.a0Z = 0.5; p.a0Y = -0.3; p.f0 = 0.7 + 0.15 * Math.sin(t * 1.7);
  },
  // il fabbro: alza piano, cala di colpo
  hammer(p, _h, t) {
    const u = (t % 1.15) / 1.15, up = u < 0.62 ? smoothstep(0, 0.62, u) : 1 - smoothstep(0.62, 0.76, u);
    p.spX += 0.28 - 0.12 * up; p.hdX += 0.2; p.hdY = 0;
    p.brow = -0.9; p.jaw = 0.04 * (1 - up);   // lo sforzo: aggrottato, i denti stretti
    p.a1X = 0.45 + 1.5 * up; p.f1 = 0.7 + 0.95 * up; p.a1Y = 0.25;
    p.a0X = 0.6; p.a0Y = 0.35; p.f0 = 0.9;
  },
  // la zappa: schiena piegata, le braccia tirano il ferro avanti e indietro
  work(p, _h, t, ph) {
    const u = Math.sin(t * 2.3 + ph);
    p.spX += 0.32 + 0.08 * u; p.hdX += 0.15; p.hdY = 0; p.brow = -0.6; p.g0 = p.g1 = 1; p.w0 = p.w1 = 0;
    p.a0X = 0.3 + 0.22 * u; p.f0 = 0.1; p.a1X = 0.75 + 0.25 * u; p.a1Y = 0.55; p.f1 = 0.55;
    p.l0 = 0.25; p.l1 = -0.2; p.s1 = 0.15;
  },
  // i panni alla fontana: piegata in avanti, le braccia strofinano a turno
  wash(p, _h, t, ph) {
    const u = Math.sin(t * 4.1 + ph);
    p.spX += 0.5; p.hdX += 0.15; p.hdY = 0; p.g0 = p.g1 = 0.75;
    p.a0X = 0.85 + 0.22 * u; p.a1X = 0.85 - 0.22 * u; p.f0 = p.f1 = 0.55; p.a0Y = p.a1Y = 0.25;
    p.l0 = p.l1 = 0.12; p.s0 = p.s1 = 0.3; p.drop = 0.03;
  },
  // seduto sulla panchina: cosce avanti, mani in grembo; il capo ciondola e si riprende
  sit(p, h, t, ph) {
    p.drop = 0.25 * h.H - 0.05; p.l0 = p.l1 = 1.45; p.s0 = p.s1 = 1.45;
    p.spX += 0.06; p.hdX += 0.12 + 0.2 * smoothstep(0.55, 1, Math.sin(t * 0.21 + ph));
    p.a0X = 0.35; p.a0Y = 0.35; p.f0 = 1.0; p.a1X = 0.75; p.f1 = 0.05;
  },
  // braccia conserte, peso su una gamba
  crossed(p) {
    p.a0X = 0.45; p.a0Y = 0.9; p.f0 = 1.7; p.a1X = 0.4; p.a1Y = 0.9; p.f1 = 1.6;
    p.spX -= 0.05; p.hipZ = 0.05; p.l1 = 0.14; p.s1 = 0.1;
  },
  // il mago: la mano libera alla barba, lo sguardo altrove
  ponder(p, _h, t, ph) {
    p.a0X = 0.85; p.a0Y = 0.75; p.f0 = 2.25 + Math.sin(t * 0.9 + ph) * 0.08; p.hdX += 0.1; p.hdY *= 0.5; p.spY = Math.sin(t * 0.17 + ph) * 0.15;
    p.brow = -0.7 + 0.5 * smoothstep(0.7, 1, Math.sin(t * 0.31 + ph));   // pensoso; ogni tanto gli viene un'idea
  },
  // il sindaco: petto in fuori, una mano dietro la schiena, lo sguardo che passa in rassegna la piazza
  oversee(p, _h, t, ph) {
    p.spX -= 0.07; p.a0X = -0.35; p.a0Y = 0.55; p.f0 = 0.55; p.hdY = Math.sin(t * 0.33 + ph) * 0.6; p.hdX -= 0.05; p.brow = -0.45;
  },
  // a letto: supino sul materasso (il bacino a 70 cm da terra, tutto il corpo rovesciato all'indietro), le braccia lungo i fianchi
  // (ciò che ha in mano è rigido con l'avambraccio: a braccia piegate resterebbe per aria)
  sleep(p, h, t, ph) {
    for (const k of KEYS) p[k] = 0;
    p.hipX = SUPINE; p.drop = h.hipY - 0.72; p.hdY = 0.25 * Math.sin(ph * 5); p.spX = Math.sin(t * 0.9 + ph) * 0.015;
    p.blink = 1; p.jaw = 0.05 + 0.03 * Math.sin(t * 0.9 + ph);   // dorme a bocca socchiusa
  },
};

/** Di quanto ruota il bacino per stendersi sulla schiena. */
const SUPINE = -Math.PI / 2;

/** Chiacchiera: chi parla gesticola, chi ascolta annuisce. */
function talk(p: Pose, t: number, ph: number, speaking: boolean, hold: Hold): void {
  p.hdY = 0;
  if (!speaking) { p.brow = 0.35 * Math.max(0, Math.sin(t * 0.8 + ph)); p.hdX += 0.07 * Math.max(0, Math.sin(t * 1.9 + ph)); if (!hold[0]) { p.a0Z = 0.45; p.a0Y = -0.3; p.f0 = 1.5; } return; }   // una mano sul fianco
  const g = Math.sin(t * 2.3 + ph), g2 = Math.sin(t * 3.7 + ph * 2);
  p.hdX += 0.05 * g2; p.spY = 0.06 * g; p.spX += 0.03;
  // la bocca: sillabe a scatti, con le pause fra una frase e l'altra; le sopracciglia accompagnano
  p.jaw = (0.04 + 0.2 * Math.abs(Math.sin(t * 8.7 + ph))) * smoothstep(-0.55, -0.2, Math.sin(t * 1.3 + ph * 2)); p.brow = 0.3 * g + 0.2;
  const i = hold[1] ? 0 : 1;   // gesticola con la mano libera
  if (!hold[i]) { p[`y${i}` as "y0"] = 0.35; p[`g${i}` as "g0"] = 0.08 + 0.12 * Math.max(0, g2); p[`w${i}` as "w0"] = -0.3 + 0.25 * g; p[`a${i}X` as "a0X"] = 0.55 + 0.2 * g; p[`a${i}Y` as "a0Y"] = 0.3; p[`a${i}Z` as "a0Z"] = 0.15 + 0.1 * g2; p[`f${i}` as "f0"] = 1.2 + 0.35 * g2; }
  if (!hold[0] && !hold[1]) { p.a0X = 0.4 + 0.15 * g2; p.f0 = 0.9 - 0.3 * g; }
}

/** Seduto a un tavolo (o al bancone): gli avambracci posati sul piano, i gomiti un poco in fuori, le mani a palmo in giù. Chi tiene qualcosa in una mano tiene quella com'è. */
function atTable(p: Pose, t: number, ph: number, hold: Hold): void {
  p.spX += 0.08;
  for (const i of [0, 1] as const) {
    if (hold[i]) continue;
    const k = Math.sin(t * 0.4 + ph + i * 2) * 0.03;
    p[`a${i}X`] = 0.72 + k; p[`a${i}Y`] = 0.38; p[`a${i}Z`] = 0.22; p[`f${i}`] = 0.95 - k; p[`w${i}`] = 0.12; p[`g${i}`] = 0.14; p[`y${i}`] = 2;
  }
}

/**
 * Dietro un banco: il busto un poco in avanti, le due mani posate sul piano. Parlando (`speaking`) non gesticola a braccia
 * larghe (attraverserebbero il banco): annuisce, e una mano si alza appena dal piano a tempo con le parole.
 */
function lean(p: Pose, t: number, ph: number, speaking: boolean, hold: Hold): void {
  const g = Math.sin(t * 2.3 + ph), beat = speaking ? Math.max(0, Math.sin(t * 3.1 + ph)) : 0;
  p.spX += 0.2 + (speaking ? 0.03 * g : 0.015 * Math.sin(t * 0.6 + ph)); p.hdX -= 0.12; p.hipZ *= 0.5;
  for (const i of [0, 1] as const) {
    if (hold[i]) continue;
    const lift = i ? beat : 0;
    p[`a${i}X`] = 0.74 + 0.1 * lift; p[`a${i}Y`] = 0.12; p[`a${i}Z`] = 0.3; p[`f${i}`] = 0.46 + 0.3 * lift; p[`w${i}`] = 0.36 - 0.5 * lift; p[`g${i}`] = 0.12; p[`y${i}`] = 2 - 0.7 * lift;
  }
  if (!speaking) return;
  p.hdY = 0; p.hdX += 0.05 * Math.sin(t * 3.7 + ph * 2);
  p.jaw = (0.04 + 0.2 * Math.abs(Math.sin(t * 8.7 + ph))) * smoothstep(-0.55, -0.2, Math.sin(t * 1.3 + ph * 2)); p.brow = 0.3 * g + 0.2;
}

/** La spada troppo vicina: si ritrae e alza le braccia. */
function cower(p: Pose): void {
  p.brow = 1; p.jaw = 0.2; p.g0 = p.g1 = 0; p.w0 = p.w1 = -0.5; p.y0 = p.y1 = 0;   // spavento: occhi sgranati, bocca aperta, le mani aperte davanti a sé
  p.spX -= 0.22; p.hdX += 0.15; p.hdY = 0; p.a0X = p.a1X = 1.5; p.a0Y = p.a1Y = 0.6; p.f0 = p.f1 = 1.5; p.l0 = -0.15; p.s1 = 0.25; p.drop = 0.04;
}

function apply(h: Human, p: Pose): void {
  const j = h.j;
  j.hips.position.y = h.hipY - p.drop; j.hips.rotation.set(p.hipX, p.hipY, p.hipZ);
  j.spine.rotation.set(p.spX, p.spY, p.spZ); j.head.rotation.set(p.hdX, p.hdY, 0);
  j.arm0.rotation.set(-p.a0X, p.a0Y, -p.a0Z); j.fore0.rotation.x = -p.f0;
  j.arm1.rotation.set(-p.a1X, -p.a1Y, p.a1Z); j.fore1.rotation.x = -p.f1;
  // le mani: il polso si piega, le dita si chiudono verso il palmo (che guarda avanti: lì sta ciò che si tiene)
  j.hand0.rotation.x = -p.w0; j.hand1.rotation.x = -p.w1; j.grip0.rotation.x = -p.g0 * 1.5; j.grip1.rotation.x = -p.g1 * 1.5;
  j.hand0.rotation.y = p.y0 * Math.PI / 2; j.hand1.rotation.y = -p.y1 * Math.PI / 2;
  j.leg0.rotation.x = -p.l0; j.shin0.rotation.x = p.s0;
  j.leg1.rotation.x = -p.l1; j.shin1.rotation.x = p.s1;
  // la caviglia disfa ciò che fanno coscia e ginocchio: il piede resta piatto, salvo la punta che la posa alza o abbassa
  j.foot0.rotation.x = p.l0 - p.s0 + p.t0; j.foot1.rotation.x = p.l1 - p.s1 + p.t1;
  // il volto: la mandibola si apre, le sopracciglia salgono o scendono (e aggrottate vengono un poco avanti), gli occhi si chiudono
  j.jaw.rotation.x = p.jaw * 1.5; j.mouth.scaling.y = 1 + 24 * p.jaw; j.mouth.position.y = h.mouth0 - p.jaw * 0.11 * h.hd; j.brow.position.y = h.brow0 + p.brow * (p.brow > 0 ? 0.095 : 0.05) * h.hd; j.brow.rotation.x = Math.max(0, -p.brow) * 0.3;   // (ampiezze da teatro: la testa è piccola e si guarda da lontano) j.eyes.scaling.y = 1 - 0.9 * Math.min(1, Math.max(0, p.blink));
}

/** Cosa tiene in mano ogni figura: fa parte dell'aspetto (l'oggetto è nel modello, human.ts), non della giornata. */
const HOLD: Record<LookId, Hold> = {
  monello: [0, 1], bambina: [1, 0], garzone: [0, 1], educanda: [0, 1], contadino: [2, 0], fabbro: [0, 1], cittadino: [0, 0], lavandaia: [1, 0], ostessa: [0, 1],
  cittadina: [0, 0], mercante: [0, 0], sindaco: [0, 2], parroco: [1, 0], suora: [0, 0], avventuriero: [0, 0], mago: [0, 2], vecchio: [0, 2], vecchia: [1, 2], lampionaio: [0, 1],
};

type Ground = (x: number, z: number, y?: number) => number;
/** La luce che c'è in un punto, se sta dentro un edificio ([fuoco, finestre]: `interiorLight` di interiors.ts), o null all'aperto. */
type Indoor = (x: number, y: number, z: number) => number[] | null;
/** Un nodo delle strade con la sua quota; `tight` = dentro un edificio (niente scarto di lato, soglie strette: ci sono muri e porte). */
interface Node { x: number; z: number; y: number; tight: boolean }
interface Spot { x: number; z: number; y: number; yaw: number }
interface Plan { nodes: Node[]; links: [number, number][]; spots: Record<string, Spot> }

export class Npc {
  readonly pos = new Vector3();
  yaw = 0;
  readonly col: Collider = { x: 0, z: 0, r: 0.3, soft: true };
  private cur = blank(); private tgt = blank();
  private t: number; private ph: number; private phase = 0;
  /** Velocità del passo in questo frame (m/s). */
  speed = 0;
  /** La velocità che il passo aveva preso (per partire piano): `speed` si azzera a ogni fotogramma, questa resta finché si cammina. */
  private gait = 0;
  /** `speak` = sta parlando con chi gioca (fermo, voltato verso di lui). */
  private state: "go" | "do" | "talk" | "cower" | "speak" = "do"; private back: "go" | "do" = "do";
  /** Il tratto della giornata in corso e la tappa del suo giro. */
  private slot = 0; private step = 0;
  private timer = 0; private route: [number, number, boolean][] = []; private stuck = 0; private trail = 0;
  private mate: Npc | null = null; private lead = false; private chatWait: number;
  private hold: Hold;
  /** Era troppo lontano per essere animato: al rientro si rimette dove dev'essere a quell'ora. */
  away = true;
  /** La luce di dentro, per il materiale: [fuoco, finestre, quanto è dentro (sfuma in mezzo secondo passando la soglia)]. */
  private lit = [0, 0, 0, 0, 1, 0, 0, 1, 0];   // (in coda: da dove vengono la luce del fuoco e quella delle finestre)

  constructor(readonly def: NpcDef, readonly h: Human, private blob: Mesh, private plan: Plan, private rnd: () => number) {
    this.hold = HOLD[def.look];
    h.mesh.metadata = { ...h.mesh.metadata, indoor: this.lit };
    this.t = rnd() * 100; this.ph = rnd() * 6.28; this.chatWait = 6 + rnd() * 25;
  }

  private get tract(): RoutineDef { return this.def.routine[this.slot]; }
  /** La tappa in corso (nessuna mentre segue qualcuno). */
  private get stop(): StopDef | undefined { return this.tract.stops[this.step]; }
  get asleep(): boolean { return this.state === "do" && this.stop?.act === "sleep"; }
  /** In quale edificio è (o sta entrando per fare qualcosa) da sveglio: il nome prima del punto del posto verso cui va. Lì fuoco e candele sono suoi. */
  get inside(): string | null { const at = this.stop?.at; return at && at.includes(".") && !this.asleep && (this.lit[2] > 0.5 || this.state === "do") ? at.slice(0, at.indexOf(".")) : null; }
  /** La tappa a cui è fermo, se è fermo a fare qualcosa. */
  get doing(): StopDef | null { return this.state === "do" && this.stop ? this.stop : null; }
  /** A casa sua, dentro e sveglio: le finestre di quella casa sono accese. */
  get atHome(): boolean { return !!this.def.home && !this.asleep && this.lit[2] > 0.5 && !!this.stop?.at.startsWith(this.def.home + "."); }

  /** Il tratto della giornata che vale a quest'ora: l'ultimo cominciato (prima del primo vale ancora l'ultimo di ieri). */
  private slotAt(hour: number): number {
    const r = this.def.routine;
    let i = r.length - 1;
    for (let k = 0; k < r.length; k++) if (r[k].from <= hour) i = k;
    return i;
  }

  /** Lo mette dove dev'essere a quest'ora, senza camminarci: all'avvio, quando chi gioca si sveglia, al rientro da lontano. */
  settle(hour: number, all: Npc[]): void {
    this.slot = this.slotAt(hour); this.step = 0; this.route = []; this.state = this.back = "do"; this.mate = null; this.away = false;
    // chi segue qualcuno parte accanto a lui
    const f = this.tract.follow, lead = f ? all.find((o) => o.def.id === f)! : this;
    const st = lead.def.routine[lead.slotAt(hour)].stops[0], s = this.plan.spots[st.at], j = f ? 1.6 : st.at.includes(".") || st.act === "sit" ? 0 : 1;   // (chi siede sta proprio sul suo posto, non lì accanto)
    this.pos.set(s.x + (this.rnd() - 0.5) * j, s.y, s.z + (this.rnd() - 0.5) * j); this.yaw = s.yaw;
    this.timer = st.stay ? this.rnd() * st.stay[1] : Infinity;
  }

  /** Strada più corta lungo i nodi (Dijkstra su una ventina di nodi), poi l'ultimo tratto fino al posto. */
  private path(x: number, z: number, y: number): [number, number, boolean][] {
    // un piano di differenza pesa come una ventina di metri: il nodo "vicino" è quello dello stesso piano
    const N = this.plan.nodes, far = (n: Node, px: number, pz: number, py: number): number => Math.hypot(n.x - px, n.z - pz) + Math.abs(n.y - py) * 6;
    const near = (px: number, pz: number, py: number): number => N.reduce((b, n, i) => (far(n, px, pz, py) < far(N[b], px, pz, py) ? i : b), 0);
    const a = near(this.pos.x, this.pos.z, this.pos.y), b = near(x, z, y), dist = N.map(() => Infinity), prev = N.map(() => -1), done = new Set<number>();
    dist[a] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N.length; i++) if (!done.has(i) && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || u === b) break;
      done.add(u);
      for (const [p, q] of this.plan.links) {
        const v = p === u ? q : q === u ? p : -1;
        if (v < 0) continue;
        const d = dist[u] + Math.hypot(N[u].x - N[v].x, N[u].z - N[v].z);
        if (d < dist[v]) { dist[v] = d; prev[v] = u; }
      }
    }
    const out: [number, number, boolean][] = [[x, z, false]];
    for (let u = b; u >= 0; u = prev[u]) { const j = N[u].tight ? 0 : 1.2; out.unshift([N[u].x + (this.rnd() - 0.5) * j, N[u].z + (this.rnd() - 0.5) * j, N[u].tight]); }
    // se il primo nodo è alle spalle rispetto al secondo, si salta: niente passo indietro per "entrare" nella rete
    if (out.length > 1 && !out[0][2] && Math.hypot(out[1][0] - this.pos.x, out[1][1] - this.pos.z) < Math.hypot(out[1][0] - out[0][0], out[1][1] - out[0][1])) out.shift();
    return out;
  }

  private face(dx: number, dz: number, dt: number, rate = 6): void {
    const d = Math.atan2(dx, dz) - this.yaw;
    this.yaw += Math.atan2(Math.sin(d), Math.cos(d)) * Math.min(1, rate * dt);
  }

  /** Un passo verso (x, z), scansando gli altri e il giocatore. Restituisce quanto manca. */
  private move(x: number, z: number, dt: number, all: Npc[], player: Vector3, speed: number): number {
    let dx = x - this.pos.x, dz = z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1e-3) return 0;
    dx /= d; dz /= d;
    const push = (ox: number, oz: number, r: number, k: number): void => {
      const ex = this.pos.x - ox, ez = this.pos.z - oz, e = Math.hypot(ex, ez);
      if (e < r && e > 1e-3) { dx += ex / e * (1 - e / r) * k; dz += ez / e * (1 - e / r) * k; }
    };
    for (const o of all) if (o !== this && Math.abs(o.pos.y - this.pos.y) < 1.5) push(o.pos.x, o.pos.z, 1, 2.2);
    if (Math.abs(player.y - this.pos.y) < 1.5) push(player.x, player.z, 1.4, 3);
    const l = Math.hypot(dx, dz) || 1;
    this.face(dx, dz, dt, 7);
    // si avanza lungo dove si guarda: chi deve girarsi rallenta
    // (si parte piano: il passo prende velocità in mezzo secondo; ci si ferma di colpo, o si passerebbe oltre il posto)
    const k = Math.max(0, Math.sin(this.yaw) * dx / l + Math.cos(this.yaw) * dz / l), v = Math.min(Math.min(speed, d / dt) * k, this.gait + 3.2 * dt);
    this.pos.x += Math.sin(this.yaw) * v * dt; this.pos.z += Math.cos(this.yaw) * v * dt;
    this.speed = this.gait = v;
    return d;
  }

  private goto(i: number): void {
    this.step = i;
    const s = this.plan.spots[this.stop!.at];
    this.route = this.path(s.x, s.z, s.y);
    if (this.state === "go" || this.state === "do") this.state = "go"; else this.back = "go";   // chi sta parlando o è spaventato parte dopo
  }

  /** Lo spavento per una spada vibrata a un passo: dice se si è spaventato (chi dorme no). */
  scare(x: number, z: number): boolean {
    if (Math.hypot(this.pos.x - x, this.pos.z - z) > 2.8 || this.asleep) return false;
    if (this.state === "go" || this.state === "do") this.back = this.state;
    if (this.mate) { this.mate.endTalk(); this.endTalk(); }
    this.state = "cower"; this.timer = 1.6;
    this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z);
    return true;
  }

  /** Chi gioca gli parla: si ferma e si volta verso di lui finché il dialogo non finisce. */
  speak(on: boolean): void {
    if (!on) { if (this.state === "speak") this.state = this.back; return; }
    if (this.state === "go" || this.state === "do") this.back = this.state;
    if (this.mate) { this.mate.endTalk(); this.mate = null; }
    this.state = "speak";
  }

  private endTalk(): void {
    this.state = this.back; this.mate = null; this.chatWait = 18 + this.rnd() * 25;
  }

  private think(dt: number, all: Npc[], player: Vector3): void {
    const t = this.tract, v = this.def.speed;
    this.speed = 0;
    this.chatWait -= dt;
    if (this.state === "cower") { if ((this.timer -= dt) <= 0) this.state = this.back; return; }
    if (this.state === "speak") { this.face(player.x - this.pos.x, player.z - this.pos.z, dt); return; }
    if (this.state === "talk") {
      const m = this.mate!;
      this.face(m.pos.x - this.pos.x, m.pos.z - this.pos.z, dt);
      if ((this.timer -= dt) <= 0) { m.endTalk(); this.endTalk(); }
      return;
    }
    if (t.follow) {
      const l = all.find((o) => o.def.id === t.follow)!, d = Math.hypot(l.pos.x - this.pos.x, l.pos.z - this.pos.z);
      if (d > 6 || Math.abs(l.pos.y - this.pos.y) > 1) {
        // lontano o su un altro piano (è appena uscito di casa): lo raggiunge lungo le strade, rifacendo il conto ogni tanto
        if ((this.trail -= dt) <= 0 || !this.route.length) { this.route = this.path(l.pos.x, l.pos.z, l.pos.y); this.trail = 3; }
        const [x, z, tight] = this.route[0];
        if (this.move(x, z, dt, all, player, v) < (tight ? 0.3 : 0.9) && this.route.length > 1) this.route.shift();
      } else if (d > 1.7) this.move(l.pos.x, l.pos.z, dt, all, player, Math.min(v, (d - 1.2) * 2.5));
      else this.face(l.pos.x - this.pos.x, l.pos.z - this.pos.z, dt, 3);
      return;
    }
    const st = this.stop!;
    if (this.state === "do") {
      const s = this.plan.spots[st.at];
      this.face(Math.sin(s.yaw), Math.cos(s.yaw), dt, 4);
      if ((this.timer -= dt) <= 0) this.goto((this.step + 1) % t.stops.length);
      return;
    }
    const [x, z, tight] = this.route[0];
    const last = this.route.length === 1;
    const left = this.move(x, z, dt, all, player, v);
    // chi trova il passo sbarrato (un crocchio fermo proprio lì, il giocatore) non aspetta in eterno: dopo un po' la tappa vale come raggiunta
    this.stuck = this.speed < 0.3 * v ? this.stuck + dt : 0;
    if (left < (last ? 0.12 : tight ? 0.3 : 0.9) || this.stuck > 2.5) {
      this.stuck = 0;
      this.route.shift();
      if (last) { this.state = "do"; this.timer = st.stay ? st.stay[0] + this.rnd() * (st.stay[1] - st.stay[0]) : Infinity; }   // una tappa sola dura quanto il tratto
    }
    // due che si incrociano si fermano a parlare
    if (this.def.social && this.chatWait <= 0) {
      for (const o of all) {
        if (o === this || !o.def.social || o.chatWait > 0 || o.state === "talk" || o.state === "cower" || o.state === "speak" || (o.state === "do" && o.stop?.act !== "stand")) continue;
        if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) > 2.1 || Math.abs(o.pos.y - this.pos.y) > 1) continue;
        for (const [n, m] of [[this, o], [o, this]] as [Npc, Npc][]) { n.back = n.state as "go" | "do"; n.state = "talk"; n.mate = m; n.timer = 7 + this.rnd() * 6; n.lead = n === this; }
        o.timer = this.timer;
        break;
      }
    }
  }

  update(dt: number, all: Npc[], player: Vector3, ground: Ground, indoor: Indoor | null, hour: number): void {
    this.t += dt;
    // l'ora ha cambiato il tratto della giornata: ci si incammina verso la prima tappa di quello nuovo
    const slot = this.slotAt(hour);
    if (slot !== this.slot) { this.slot = slot; this.step = 0; this.route = []; if (!this.tract.follow) this.goto(0); }
    const li = indoor?.(this.pos.x, this.pos.y, this.pos.z);
    if (li) { this.lit[0] = li[0]; this.lit[1] = li[1]; const k = Math.min(1, dt * 6); for (let i = 0; i < 6; i++) this.lit[3 + i] += (li[2 + i] - this.lit[3 + i]) * k; }
    this.lit[2] += ((li ? 1 : 0) - this.lit[2]) * Math.min(1, dt * 5);
    this.think(dt, all, player);
    if (this.speed === 0) this.gait = 0;
    const p = this.tgt, h = this.h;
    rest(p, h, this.t, this.ph, this.hold);
    if (this.speed > 0.08) {
      const k = clamp(this.speed / 1.15, 0.45, 1.4) * (h.kid ? 0.95 : 1), stride = 4 * h.leg * Math.sin(0.48 * Math.min(k, 1.4));
      this.phase += this.speed * dt / stride * Math.PI * 2;
      walk(p, h, this.phase, k, this.hold);
    } else if (this.state === "talk") talk(p, this.t, this.ph, (Math.floor(this.timer / 2.7) % 2 === 0) === this.lead, this.hold);
    else if (this.state === "speak") { if (this.stop?.act === "lean") lean(p, this.t, this.ph, true, this.hold); else talk(p, this.t, this.ph, true, this.hold); }
    else if (this.state === "cower") cower(p);
    else if (this.state === "do" && this.stop) {
      ACTS[this.stop.act](p, h, this.t, this.ph);
      // chi siede a un tavolo, a una tavola o al bancone posa le braccia sul piano che ha davanti
      if (this.stop.act === "sit" && /tavol|scranno|bancone/.test(this.stop.at)) atTable(p, this.t, this.ph, this.hold);
    }
    // chi ha il giocatore vicino lo segue con lo sguardo
    const px = player.x - this.pos.x, pz = player.z - this.pos.z, pd = Math.hypot(px, pz);
    if (pd < 4.5 && Math.abs(player.y - this.pos.y) < 2 && this.speed < 0.08 && this.state !== "talk" && !this.asleep) {
      const a = Math.atan2(px, pz) - this.yaw - p.spY, rel = Math.atan2(Math.sin(a), Math.cos(a));
      if (Math.abs(rel) < 1.9) p.hdY += (clamp(rel, -1, 1) * 0.85 - p.hdY) * smoothstep(4.5, 3, pd);
    }
    const k = 1 - Math.exp(-(this.speed > 0.08 ? 20 : 9) * dt);
    // le palpebre battono ogni qualche secondo (un decimo e mezzo di secondo), senza smorzamento: è un gesto secco
    if (p.blink < 1 && (this.t * 0.83 + this.ph * 7) % 4.1 < 0.15) p.blink = 1;
    for (const key of KEYS) this.cur[key] += (p[key] - this.cur[key]) * k;
    this.cur.blink = p.blink; this.cur.jaw += (p.jaw - this.cur.jaw) * Math.min(1, 26 * dt);   // (la bocca segue svelta le sillabe)
    apply(h, this.cur);
    this.pos.y = ground(this.pos.x, this.pos.z, this.pos.y);   // la superficie sotto i piedi: sale e scende le scale da sé
    h.root.position.copyFrom(this.pos); h.root.rotation.y = this.yaw;
    this.blob.position.set(this.pos.x, this.pos.y + 0.035, this.pos.z);
    this.col.x = this.pos.x; this.col.z = this.pos.z; this.col.y0 = this.pos.y; this.col.y1 = this.pos.y + 1.8;
  }

  show(on: boolean): void {
    if (this.h.root.isEnabled() !== on) { this.h.root.setEnabled(on); this.blob.setEnabled(on); }
  }
}

export class Npcs {
  readonly list: Npc[] = [];
  /** I cerchi degli abitanti: il giocatore non ci passa attraverso (vanno aggiunti ai suoi ostacoli). */
  readonly colliders: Collider[];
  /** Chi dice quanta luce c'è dentro gli edifici (lo collega main.ts). */
  indoor: Indoor | null = null;

  constructor(scene: Scene, private ground: Ground, town: TownPlan, defs: NpcDef[], private hour: () => number) {
    const rnd = mulberry32(0x7045);
    // chi non dichiara una quota sta sul terreno
    const plan: Plan = {
      nodes: town.nodes.map(([x, z, y]) => ({ x, z, y: y ?? ground(x, z), tight: y !== undefined })), links: town.links,
      spots: Object.fromEntries(Object.entries(town.spots).map(([k, s]) => [k, { ...s, y: s.y ?? ground(s.x, s.z) }])),
    };
    const mat = surfaceMaterial(scene, "npcMat", clothTex(scene), { rough: 0.92, indoor: LIGHT });
    // ⚠️ niente scarto delle facce dietro: grembiuli, mantelli e veli sono fogli aperti, visti anche da dentro
    mat.backFaceCulling = false;
    // gli occhi di gemma brillano di suo: un vertice con l'alfa del colore sotto 0,5 aggiunge il suo colore (human.ts, `eye`)
    mat.Fragment_Before_Fog(`
      #ifdef VERTEXCOLOR
      finalColor.rgb += vColor.rgb * (0.55 * step(vColor.a, 0.5));
      #endif
    `);
    const shadow = blobShadowMaterial(scene);
    defs.forEach((def, i) => {
      // i posti dentro gli edifici esistono solo a mondo costruito: il file li nomina, qui si controlla che ci siano
      def.routine.forEach((t, j) => t.stops.forEach((s, k) => {
        if (!plan.spots[s.at]) throw new DbError(`db.json.npcs[${i}].routine[${j}].stops[${k}].at: il posto "${s.at}" non esiste`);
      }));
      const h = buildHuman(scene, def.look, def.id, mat);
      const blob = MeshBuilder.CreateDisc(`${def.id}Blob`, { radius: 0.42 * h.H / 1.75, tessellation: 16 }, scene);
      blob.rotation.x = Math.PI / 2; blob.material = shadow; blob.isPickable = false;
      this.list.push(new Npc(def, h, blob, plan, rnd));
    });
    this.colliders = this.list.map((n) => n.col);
    this.settle();
  }

  /** Tutti dove devono essere a quest'ora (dopo un salto dell'orologio: chi gioca ha dormito). */
  settle(): void {
    for (const n of this.list) n.settle(this.hour(), this.list);
  }

  update(dt: number, player: Vector3): void {
    dt = Math.min(dt, 0.05);
    const hour = this.hour();
    for (const n of this.list) {
      // lontani non si vedono (nebbia) e non si animano: al rientro sono dove li vuole l'ora
      const near = Math.hypot(n.pos.x - player.x, n.pos.z - player.z) < 130;
      n.show(near);
      if (!near) { n.away = true; continue; }
      if (n.away) n.settle(hour, this.list);
      n.update(dt, this.list, player, this.ground, this.indoor, hour);
    }
  }

  /** Una spada vibrata in (x, z): chi è a un passo si ritrae. Restituisce il più vicino fra gli spaventati. */
  scare(x: number, z: number): Npc | null {
    let hit: Npc | null = null;
    for (const n of this.list) if (n.scare(x, z) && (!hit || Math.hypot(n.pos.x - x, n.pos.z - z) < Math.hypot(hit.pos.x - x, hit.pos.z - z))) hit = n;
    return hit;
  }

  /** Chi cammina sposta la foschia a terra. */
  movers(out: { x: number; z: number; vx: number; vz: number; r: number }[]): void {
    for (const n of this.list) if (n.h.root.isEnabled()) out.push({ x: n.pos.x, z: n.pos.z, vx: Math.sin(n.yaw) * n.speed, vz: Math.cos(n.yaw) * n.speed, r: 0.5 });
  }
}
