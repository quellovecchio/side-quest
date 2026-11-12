import { Color3, Color4, DynamicTexture, Mesh, MeshBuilder, ParticleSystem, Scene, StandardMaterial, Vector3 } from "@babylonjs/core";
import { buildQuadruped, eyeMaterials, solveLeg, tooth, type Col, type Creature, type Part, type QuadDef, type R } from "./creature";
import { Ragdoll, type RagSpec } from "./ragdoll";
import { creatureMaterial, type CreatureFx } from "./world/materials";
import { clamp, mulberry32, smoothstep } from "./world/noise";
import { furTex, softDotTex } from "./world/textures";
import { EAST, HALF } from "./world/terrain";
import type { Collider } from "./world/vegetation";
import type { CreatureDef, Db } from "./data/db";

// ─────────────────────────────────────────────────────────────────────────────
// NEMICI — lupi (in branco) e ratti giganti, per provare il combattimento.
//
// Modelli: quadrupedi a pelle unica (creature.ts), profilo e proporzioni dell'animale vero,
// mantello dipinto nei colori dei vertici sopra una texture di pelo.
// Animazione procedurale: le zampe sono in IK (l'appoggio resta fermo a terra mentre il corpo
// avanza, poi si stacca e torna avanti), l'andatura passa da passo a trotto a galoppo con la
// velocità, la schiena si flette al galoppo, il corpo segue il pendio e si inclina in curva.
//
// IA a stati: idle (gironzola attorno a casa, annusa) → chase → attack (si acquatta, balza,
// morde) → di nuovo chase; i lupi fra un assalto e l'altro girano attorno alla preda. stagger
// quando colpiti o quando il morso finisce sullo scudo; return se portati troppo lontano da casa.
// Il branco si allerta insieme. Chi muore passa alla fisica (ragdoll.ts): il colpo che lo uccide
// lo sbalza nel verso della lama, il corpo rotola e si ferma, poi si disfa in pulviscolo
// (soglia di rumore sulla pelle + particelle) e si rigenera a casa.
//
// ponytail: ombra a macchia sotto ogni bestia — la shadow map del mondo è statica
// (vedi CLAUDE.md); per ombre vere serve una cascata vicina solo per chi si muove.
// ─────────────────────────────────────────────────────────────────────────────

export type BlockResult = "hit" | "blocked" | "ignored";

/** Ciò che i nemici chiedono al giocatore. */
export interface Target {
  readonly position: Vector3;
  readonly alive: boolean;
  damage(amount: number, from: Vector3): BlockResult;
}

type Ground = (x: number, z: number) => number;
/** Il suolo a più quote (`Levels.ground`): con `y` dice dove si appoggia chi sta a quella quota (sotto terra, sul pavimento della grotta). */
type Ground3 = (x: number, z: number, y?: number) => number;

interface Anim {
  /** Frequenza del passo (Hz) = f0 + f1 · velocità. */
  f0: number; f1: number;
  /** Alzata della zampa (m), quanto si piega il terzo segmento in volo, taglia delle zampe (lupo = 1). */
  lift: number; flex: number; size: number;
  /** 1 se corre al galoppo (schiena che si flette), 0 se trotterella sempre. */
  gallop: number;
  /** Mezza lunghezza del corpo (per seguire il pendio) e quota del corpo steso su un fianco. */
  len: number; lie: number;
  /** Coda: quanto si alza correndo, ampiezza dell'ondeggiare. */
  tailUp: number; tailSway: number;
  /** Apertura della bocca nel morso (rad). */
  gape: number;
}

interface Species {
  name: string; hp: number; dmg: number; walk: number; run: number;
  aggro: number; reach: number; radius: number;
  windup: number; lunge: number; recover: number; cooldown: number; lungeSpeed: number;
  knock: number;
  /** Fra un assalto e l'altro gira attorno alla preda. */
  circle: boolean;
  scale: [number, number];
  eye: Color3; anim: Anim; def: QuadDef; rag: RagSpec;
}

// ── Lupo ─────────────────────────────────────────────────────────────────────
// mantello (colori lineari, moltiplicano la texture del pelo): sella scura, fianchi grigio-fulvi,
// ventre e zampe crema, naso e punta della coda neri
const wD: Col = [0.055, 0.05, 0.045], wG: Col = [0.16, 0.145, 0.13], wS: Col = [0.29, 0.255, 0.21];
const wB: Col = [0.48, 0.44, 0.37], wC: Col = [0.6, 0.55, 0.47], K: Col = [0.012, 0.012, 0.012];
const wL: Col = [0.36, 0.32, 0.26];
const IVORY: Col = [0.8, 0.74, 0.58];
// bocca: labbra nere, gengive e palato scuri, lingua, fondo della gola
const LIP: Col = [0.02, 0.018, 0.018], GUM: Col = [0.2, 0.05, 0.05], TONGUE: Col = [0.4, 0.12, 0.13], THROAT: Col = [0.07, 0.012, 0.012];
const wM: Col = [0.34, 0.305, 0.255], EAR_IN: Col = [0.34, 0.25, 0.21];

/** Ingrossa una fila di anelli (zampe). */
const fat = (rings: R[], k: number): R[] => rings.map((r): R => [r[0], r[1], r[2] * k, r[3] * k, r[4] * k, r[5], r[6], r[7], r[8]]);
const HEAD_AT: [number, number] = [0.80, 0.62];

// La testa del lupo. Quote assolute (y da terra, z dal centro del corpo); la mandibola ruota attorno
// a JAW_AT. A bocca chiusa denti, lingua e gola stanno dentro il volume di muso e mandibola.
const WOLF_HEAD: Part[] = [
  // cranio: largo alle gote, fronte che scende allo stop
  { sq: 0.8, rings: [
    [0.59, 0.835, 0.04, 0.035, 0.035, wS, wS, "H"],
    [0.63, 0.84, 0.095, 0.075, 0.08, wS, wC, "H"],
    [0.685, 0.84, 0.112, 0.082, 0.085, wS, wC, "H"],
    [0.745, 0.845, 0.096, 0.075, 0.074, wG, wC, "H"],
    [0.79, 0.84, 0.078, 0.062, 0.058, wG, wC, "H"],
    [0.832, 0.826, 0.06, 0.044, 0.04, wG, wM, "H"],
  ] },
  // muso: squadrato, non a cono; sotto, la riga nera delle labbra; in punta il tartufo
  { sq: 0.7, band: [0.06, 0.26], rings: [
    [0.80, 0.83, 0.062, 0.046, 0.042, wM, LIP, "H"],
    [0.835, 0.824, 0.056, 0.04, 0.038, wM, LIP, "H"],
    [0.875, 0.818, 0.052, 0.036, 0.032, wM, LIP, "H"],
    [0.915, 0.814, 0.048, 0.034, 0.03, wM, LIP, "H"],
    [0.943, 0.812, 0.043, 0.033, 0.028, wM, LIP, "H"],
    [0.955, 0.811, 0.032, 0.027, 0.023, wM, LIP, "H"],
    [0.96, 0.811, 0.006, 0.006, 0.005, LIP, LIP, "H"],
  ] },
  { sides: 10, rings: [   // tartufo
    [0.94, 0.816, 0.02, 0.018, 0.016, K, K, "H"],
    [0.955, 0.815, 0.029, 0.024, 0.02, K, K, "H"],
    [0.968, 0.814, 0.026, 0.021, 0.018, K, K, "H"],
    [0.977, 0.813, 0.014, 0.012, 0.01, K, K, "H"],
    [0.98, 0.813, 0.003, 0.003, 0.003, K, K, "H"],
  ] },
  // mandibola: più stretta del muso (il labbro superiore la copre), sopra il pavimento della bocca
  { sq: 0.8, band: [0.62, 0.86], rings: [
    [0.70, 0.771, 0.06, 0.012, 0.04, GUM, wC, "J"],
    [0.76, 0.774, 0.052, 0.012, 0.034, GUM, wC, "J"],
    [0.83, 0.778, 0.046, 0.011, 0.026, GUM, wC, "J"],
    [0.89, 0.781, 0.04, 0.01, 0.02, GUM, wC, "J"],
    [0.925, 0.784, 0.034, 0.009, 0.015, GUM, wC, "J"],
    [0.942, 0.786, 0.02, 0.007, 0.01, GUM, wC, "J"],
    [0.947, 0.786, 0.004, 0.003, 0.003, LIP, LIP, "J"],
  ] },
  { sides: 8, rings: [   // lingua
    [0.74, 0.793, 0.028, 0.008, 0.006, TONGUE, GUM, "J"],
    [0.81, 0.795, 0.027, 0.008, 0.006, TONGUE, GUM, "J"],
    [0.87, 0.796, 0.023, 0.007, 0.005, TONGUE, GUM, "J"],
    [0.9, 0.795, 0.014, 0.005, 0.004, TONGUE, GUM, "J"],
    [0.907, 0.795, 0.003, 0.002, 0.002, TONGUE, GUM, "J"],
  ] },
  { sides: 8, rings: [   // fondo della bocca: fra cranio e mandibola, riempie l'angolo quando si apre
    [0.70, 0.79, 0.02, 0.02, 0.02, THROAT, THROAT, ["H", "J", 0.5]],
    [0.73, 0.79, 0.052, 0.03, 0.034, THROAT, THROAT, ["H", "J", 0.5]],
    [0.775, 0.79, 0.05, 0.028, 0.03, THROAT, THROAT, ["H", "J", 0.5]],
    [0.80, 0.79, 0.02, 0.015, 0.015, THROAT, THROAT, ["H", "J", 0.5]],
  ] },
  // orecchie: triangoli dalla punta tonda, larghi alla base, scuri dietro e chiari dentro
  { mirror: true, sides: 8, rings: [
    [0.668, 0.90, 0.044, 0.022, 0.018, wD, EAR_IN, "H", 0.06],
    [0.658, 0.95, 0.036, 0.014, 0.012, wD, EAR_IN, "H", 0.074],
    [0.651, 0.985, 0.022, 0.008, 0.007, wD, EAR_IN, "H", 0.083],
    [0.648, 1.0, 0.008, 0.004, 0.004, K, K, "H", 0.087],
  ] },
  // denti di sopra: canini, incisivi, premolari
  tooth(0.027, 0.922, 0.792, -0.022, 0.007, "H", IVORY),
  tooth(0.008, 0.938, 0.79, -0.009, 0.004, "H", IVORY), tooth(0.018, 0.934, 0.79, -0.01, 0.0045, "H", IVORY),
  tooth(0.031, 0.895, 0.79, -0.011, 0.0055, "H", IVORY), tooth(0.034, 0.868, 0.79, -0.012, 0.006, "H", IVORY),
  tooth(0.037, 0.842, 0.79, -0.014, 0.0065, "H", IVORY), tooth(0.039, 0.815, 0.79, -0.012, 0.006, "H", IVORY),
  // denti di sotto
  tooth(0.028, 0.902, 0.786, 0.022, 0.0065, "J", IVORY),
  tooth(0.008, 0.932, 0.788, 0.007, 0.004, "J", IVORY), tooth(0.018, 0.926, 0.788, 0.008, 0.0045, "J", IVORY),
  tooth(0.032, 0.878, 0.786, 0.01, 0.0055, "J", IVORY), tooth(0.035, 0.852, 0.786, 0.011, 0.0055, "J", IVORY),
  tooth(0.038, 0.826, 0.786, 0.012, 0.006, "J", IVORY), tooth(0.041, 0.798, 0.786, 0.01, 0.006, "J", IVORY),
];

const WOLF_DEF: QuadDef = {
  pivot: [0.62, -0.06], sides: 14,
  trunk: [
    [-0.55, 0.665, 0.03, 0.03, 0.03, wG, wS, "P"],
    [-0.50, 0.65, 0.11, 0.09, 0.105, wG, wS, "P"],
    [-0.40, 0.63, 0.16, 0.118, 0.16, wD, wB, "P"],         // groppa
    [-0.24, 0.625, 0.142, 0.108, 0.13, wD, wB, "P"],       // lombi: il ventre rientra
    [-0.06, 0.61, 0.16, 0.125, 0.165, wD, wB, ["P", "C", 0.5]],
    [0.12, 0.60, 0.182, 0.14, 0.205, wD, wB, "C"],         // torace profondo
    [0.28, 0.61, 0.182, 0.162, 0.215, wD, wB, "C"],        // garrese
    [0.40, 0.635, 0.152, 0.145, 0.19, wG, wC, "C"],
    [0.47, 0.65, 0.098, 0.105, 0.13, wG, wC, "C"],
    [0.50, 0.66, 0.03, 0.03, 0.04, wG, wC, "C"],
  ],
  neckAt: [0.68, 0.38], headAt: HEAD_AT, jawAt: [0.778, 0.70],
  neck: [
    [0.33, 0.645, 0.14, 0.13, 0.155, wG, wC, "C"],          // la gorgiera
    [0.44, 0.70, 0.125, 0.12, 0.145, wG, wC, ["C", "N", 0.6]],
    [0.54, 0.755, 0.11, 0.104, 0.12, wG, wC, "N"],
    [0.62, 0.80, 0.098, 0.09, 0.10, wS, wC, ["N", "H", 0.5]],
    [0.67, 0.825, 0.085, 0.076, 0.082, wS, wC, "H"],
  ],
  parts: WOLF_HEAD,
  eye: { x: 0.061, y: 0.872, z: 0.80, r: 0.0105, look: [0.75, 0.2, 0.62] },
  tail: {
    pts: [[0.66, -0.52], [0.553, -0.594], [0.447, -0.668], [0.34, -0.742], [0.235, -0.815]],
    r: [0.04, 0.058, 0.064, 0.052, 0.01], top: wD, bot: wS, tip: K,
  },
  front: {
    x: 0.10, bend: -1,
    j: [[0.55, 0.30], [0.43, 0.24], [0.16, 0.27], [0.035, 0.285]],
    rings: fat([
      [0.31, 0.60, 0.05, 0.07, 0.07, wS, wS, "B"],
      [0.285, 0.52, 0.055, 0.065, 0.07, wS, wS, ["B", "1", 0.7]],
      [0.24, 0.43, 0.045, 0.05, 0.05, wS, wB, ["1", "2", 0.5]],   // gomito
      [0.25, 0.36, 0.038, 0.04, 0.042, wB, wB, "2"],
      [0.262, 0.25, 0.032, 0.033, 0.033, wL, wL, "2"],
      [0.27, 0.16, 0.03, 0.032, 0.03, wL, wL, ["2", "3", 0.5]],    // polso
      [0.277, 0.09, 0.027, 0.028, 0.027, wL, wL, "3"],
      [0.283, 0.04, 0.03, 0.04, 0.028, wL, wL, "3"],
    ], 1.3),
    paw: [
      [0.25, 0.03, 0.02, 0.02, 0.02, wL, wL, "3"],
      [0.275, 0.032, 0.038, 0.034, 0.03, wL, wL, "3"],
      [0.33, 0.028, 0.042, 0.028, 0.026, wL, wL, "3"],
      [0.365, 0.022, 0.03, 0.018, 0.02, wL, wS, "3"],
      [0.375, 0.02, 0.008, 0.006, 0.008, K, K, "3"],
    ],
  },
  hind: {
    x: 0.105, bend: 1,
    j: [[0.60, -0.38], [0.42, -0.27], [0.21, -0.46], [0.035, -0.43]],
    rings: fat([
      [-0.40, 0.66, 0.05, 0.09, 0.08, wG, wG, "B"],
      [-0.36, 0.56, 0.06, 0.105, 0.085, wS, wS, ["B", "1", 0.7]],  // coscia
      [-0.31, 0.48, 0.055, 0.085, 0.075, wS, wS, "1"],
      [-0.27, 0.42, 0.045, 0.05, 0.06, wS, wB, ["1", "2", 0.5]],    // ginocchio
      [-0.345, 0.33, 0.036, 0.036, 0.045, wB, wB, "2"],
      [-0.46, 0.21, 0.028, 0.03, 0.03, wL, wL, ["2", "3", 0.5]],    // garretto
      [-0.445, 0.12, 0.025, 0.026, 0.026, wL, wL, "3"],
      [-0.432, 0.045, 0.028, 0.036, 0.026, wL, wL, "3"],
    ], 1.22),
    paw: [
      [-0.465, 0.03, 0.02, 0.02, 0.02, wL, wL, "3"],
      [-0.44, 0.032, 0.036, 0.034, 0.03, wL, wL, "3"],
      [-0.385, 0.028, 0.04, 0.028, 0.026, wL, wL, "3"],
      [-0.35, 0.022, 0.03, 0.018, 0.02, wL, wS, "3"],
      [-0.34, 0.02, 0.008, 0.006, 0.008, K, K, "3"],
    ],
  },
};

// ── Ratto gigante ────────────────────────────────────────────────────────────
// schiena inarcata, muso a cono, orecchie tonde, incisivi gialli, coda nuda ad anelli
const rD: Col = [0.07, 0.045, 0.03], rS: Col = [0.17, 0.115, 0.075], rB: Col = [0.34, 0.28, 0.23];
const PINK: Col = [0.5, 0.31, 0.28], TOOTH: Col = [0.8, 0.62, 0.25];

const RAT_DEF: QuadDef = {
  pivot: [0.2, -0.02], sides: 12,
  trunk: [
    [-0.36, 0.17, 0.02, 0.02, 0.02, rD, rS, "P"],
    [-0.33, 0.18, 0.085, 0.08, 0.09, rD, rS, "P"],
    [-0.24, 0.20, 0.135, 0.125, 0.13, rD, rB, "P"],        // cosce
    [-0.10, 0.215, 0.14, 0.135, 0.14, rD, rB, "P"],        // la gobba
    [0.03, 0.205, 0.125, 0.125, 0.13, rD, rB, ["P", "C", 0.5]],
    [0.15, 0.185, 0.105, 0.105, 0.11, rD, rB, "C"],
    [0.24, 0.17, 0.085, 0.085, 0.09, rS, rB, "C"],
    [0.30, 0.16, 0.03, 0.03, 0.03, rS, rB, "C"],
  ],
  neckAt: [0.17, 0.22], headAt: [0.165, 0.30], jawAt: [0.13, 0.38],
  neck: [
    [0.20, 0.175, 0.085, 0.085, 0.085, rD, rB, "C"],
    [0.27, 0.168, 0.075, 0.07, 0.07, rS, rB, ["C", "N", 0.6]],
    [0.33, 0.165, 0.068, 0.062, 0.06, rS, rB, ["N", "H", 0.6]],
  ],
  parts: [
    { rings: [
      [0.29, 0.17, 0.03, 0.03, 0.03, rS, rS, "H"],
      [0.32, 0.172, 0.07, 0.065, 0.06, rS, rB, "H"],
      [0.37, 0.17, 0.072, 0.062, 0.055, rS, rB, "H"],
      [0.43, 0.16, 0.052, 0.045, 0.035, rS, rB, "H"],
      [0.49, 0.148, 0.034, 0.03, 0.02, rS, rB, "H"],
      [0.535, 0.14, 0.022, 0.02, 0.014, rB, rB, "H"],
      [0.555, 0.138, 0.014, 0.014, 0.01, PINK, PINK, "H"],
      [0.565, 0.137, 0.004, 0.004, 0.003, PINK, PINK, "H"],
    ] },
    { band: [0.6, 0.85], rings: [
      [0.38, 0.125, 0.04, 0.008, 0.022, GUM, rB, "J"],
      [0.45, 0.122, 0.03, 0.008, 0.016, GUM, rB, "J"],
      [0.51, 0.122, 0.018, 0.006, 0.01, GUM, rB, "J"],
      [0.525, 0.123, 0.004, 0.003, 0.003, PINK, PINK, "J"],
    ] },
    { sides: 8, rings: [   // fondo della bocca
      [0.375, 0.14, 0.012, 0.012, 0.012, THROAT, THROAT, ["H", "J", 0.5]],
      [0.40, 0.14, 0.034, 0.02, 0.02, THROAT, THROAT, ["H", "J", 0.5]],
      [0.435, 0.138, 0.028, 0.015, 0.015, THROAT, THROAT, ["H", "J", 0.5]],
      [0.455, 0.137, 0.008, 0.006, 0.006, THROAT, THROAT, ["H", "J", 0.5]],
    ] },
    { mirror: true, sides: 6, rings: [
      [0.345, 0.225, 0.02, 0.006, 0.006, PINK, PINK, "H", 0.05],
      [0.342, 0.262, 0.034, 0.006, 0.006, PINK, PINK, "H", 0.062],
      [0.34, 0.29, 0.022, 0.005, 0.005, PINK, PINK, "H", 0.068],
      [0.339, 0.30, 0.004, 0.003, 0.003, PINK, PINK, "H", 0.07],
    ] },
    tooth(0.007, 0.533, 0.13, -0.032, 0.006, "H", TOOTH),
    tooth(0.006, 0.506, 0.124, 0.018, 0.005, "J", TOOTH),
  ],
  eye: { x: 0.049, y: 0.197, z: 0.405, r: 0.007, look: [0.8, 0.3, 0.5] },
  tail: {
    pts: [[0.17, -0.35], [0.11, -0.44], [0.06, -0.54], [0.035, -0.65], [0.03, -0.76], [0.03, -0.87], [0.03, -0.98], [0.03, -1.08]],
    r: [0.028, 0.024, 0.021, 0.018, 0.015, 0.012, 0.009, 0.004], top: PINK, bot: PINK, tip: PINK, rings: true,
  },
  front: {
    x: 0.075, bend: -1,
    j: [[0.14, 0.17], [0.085, 0.13], [0.04, 0.17], [0.012, 0.20]],
    rings: [
      [0.17, 0.16, 0.02, 0.025, 0.025, rS, rS, "B"],
      [0.155, 0.125, 0.028, 0.03, 0.032, rS, rS, ["B", "1", 0.7]],
      [0.13, 0.085, 0.026, 0.026, 0.028, rS, rB, ["1", "2", 0.5]],
      [0.15, 0.06, 0.02, 0.02, 0.02, rB, rB, "2"],
      [0.17, 0.04, 0.017, 0.017, 0.017, PINK, PINK, ["2", "3", 0.5]],
      [0.185, 0.026, 0.016, 0.016, 0.014, PINK, PINK, "3"],
    ],
    paw: [
      [0.175, 0.014, 0.012, 0.01, 0.01, PINK, PINK, "3"],
      [0.195, 0.014, 0.022, 0.012, 0.012, PINK, PINK, "3"],
      [0.225, 0.011, 0.02, 0.008, 0.009, PINK, PINK, "3"],
      [0.238, 0.01, 0.004, 0.003, 0.004, PINK, PINK, "3"],
    ],
  },
  hind: {
    x: 0.095, bend: 1,
    j: [[0.19, -0.22], [0.10, -0.14], [0.045, -0.24], [0.012, -0.15]],
    rings: [
      [-0.22, 0.20, 0.025, 0.03, 0.03, rD, rD, "B"],
      [-0.185, 0.155, 0.04, 0.04, 0.04, rS, rS, ["B", "1", 0.7]],
      [-0.14, 0.10, 0.034, 0.03, 0.036, rS, rB, ["1", "2", 0.5]],
      [-0.19, 0.07, 0.024, 0.022, 0.026, rB, rB, "2"],
      [-0.24, 0.045, 0.019, 0.02, 0.02, PINK, PINK, ["2", "3", 0.5]],
      [-0.20, 0.03, 0.017, 0.014, 0.014, PINK, PINK, "3"],
      [-0.16, 0.016, 0.02, 0.011, 0.011, PINK, PINK, "3"],
      [-0.125, 0.011, 0.018, 0.008, 0.009, PINK, PINK, "3"],
      [-0.112, 0.01, 0.004, 0.003, 0.004, PINK, PINK, "3"],
    ],
    paw: [],
  },
};

/** Ciò che di una specie è aspetto e movenze. Il resto (salute, morso, velocità, tempi dell'assalto) viene da db.json. */
type Model = Pick<Species, "radius" | "scale" | "eye" | "anim" | "def" | "rag">;

const WOLF: Model = {
  radius: 0.5, scale: [0.92, 1.12], eye: new Color3(0.6, 0.38, 0.08),
  anim: { f0: 1.3, f1: 0.32, lift: 0.075, flex: 0.9, size: 1, gallop: 1, len: 0.42, lie: 0.17, tailUp: 0.75, tailSway: 0.12, gape: 0.5 },
  def: WOLF_DEF,
  rag: { back: [0.09, 0.16], under: [0.07, 0.095], nose: [0.012, 0.34], body: 0.06, head: 0.07, limb: 0.035, mass: 1 },
};
const RAT: Model = {
  radius: 0.32, scale: [1.0, 1.35], eye: new Color3(0.4, 0.05, 0.03),
  anim: { f0: 2.5, f1: 1.5, lift: 0.03, flex: 0.7, size: 0.35, gallop: 0, len: 0.28, lie: 0.13, tailUp: 0, tailSway: 0.16, gape: 0.5 },
  def: RAT_DEF,
  rag: { back: [0.095, 0.11], under: [0.08, 0.025], nose: [-0.025, 0.255], body: 0.04, head: 0.05, limb: 0.018, mass: 0.75 },
};

const MODELS: Record<CreatureDef["model"], Model> = { wolf: WOLF, rat: RAT };

/** La specie in gioco: il modello del codice più i numeri del file. */
const species = (c: CreatureDef): Species => ({
  ...MODELS[c.model], name: c.name, hp: c.stats.salute, dmg: c.stats.morso, walk: c.stats.passo, run: c.stats.corsa,
  aggro: c.stats.fiuto, reach: c.stats.portata, knock: c.stats.spinta, circle: c.stats.accerchia,
  windup: c.attack.carica, lunge: c.attack.balzo, recover: c.attack.recupero, cooldown: c.attack.pausa, lungeSpeed: c.attack.slancio,
});

// sfasamento delle zampe (AS, AD, PS, PD) nelle tre andature
const WALK = [0.25, 0.75, 0, 0.5], TROT = [0, 0.5, 0.5, 0], GALLOP = [0.5, 0.62, 0, 0.12];
const ease = (t: number): number => t * t * (3 - 2 * t);

type State = "idle" | "chase" | "attack" | "stagger" | "return" | "dead";

// morte: il corpo vola e rotola; fermo da REST secondi (o comunque dopo LIMIT) si disfa in pulviscolo
const REST = 1.1, LIMIT = 6, DISSOLVE_LEN = 1.7;

class Enemy {
  pos = new Vector3();
  yaw = 0;
  hp: number;
  state: State = "idle";
  t = 0;
  cd = 0;
  knock = new Vector3();
  wander: Vector3 | null = null;
  wait = 0;
  gait = 0;
  speed = 0;
  bit = false;
  flash = 0;
  fallSide = 1;
  private slope = 0;
  private lean = 0;
  private dusted = false;
  /** Il corpo da morto; fermo da quanto, quando comincia a disfarsi, l'ultimo tonfo. */
  rag: Ragdoll | null = null;
  private still = 0;
  private dustAt = Infinity;
  private landed = 0;
  private pose = { crouch: 0, neck: 0, head: 0, jaw: 0 };
  private orbit: number;
  private seed: number;

  constructor(readonly sp: Species, readonly rig: Creature, readonly fx: CreatureFx, private blob: Mesh, readonly scale: number,
    readonly home: Vector3, readonly pack: Enemy[], private rnd: () => number, private onDissolve: (e: Enemy) => void,
    private onLand: (e: Enemy, v: number) => void, /** Quanto si allontana da casa quando gira a vuoto (m): poco, per chi sta in una grotta. */ private roam = 8) {
    this.hp = sp.hp;
    this.orbit = rnd() < 0.5 ? -1 : 1;
    this.seed = rnd() * 100;
    this.gait = rnd();
    this.reset();
  }

  reset(): void {
    this.pos.set(this.home.x + (this.rnd() - 0.5) * this.roam * 0.75, this.home.y, this.home.z + (this.rnd() - 0.5) * this.roam * 0.75);
    this.yaw = this.rnd() * Math.PI * 2;
    this.hp = this.sp.hp;
    this.state = "idle"; this.t = 0; this.cd = 0; this.wander = null;
    this.knock.setAll(0);
    this.rag?.release(); this.rag = null;
    this.fx.dissolve = 0; this.dusted = false;
    this.rig.root.setEnabled(true);
    this.rig.eyes.setEnabled(true);
    this.blob.setEnabled(true);
  }

  get alive(): boolean { return this.state !== "dead"; }

  alert(): void {
    if (this.state !== "idle" && this.state !== "return") return;
    this.state = "chase"; this.t = 0;
    // il branco non morde tutto insieme: ognuno parte con la sua attesa
    if (this.sp.circle) this.cd = this.rnd() * 1.8;
  }

  /**
   * Colpito dalla spada. `power` > 1 = colpo pesante: spinge di più e fa barcollare più a lungo.
   * `push` = la velocità (m/s) che il colpo darebbe a un corpo del peso di un lupo, nel verso della lama:
   * piega la spinta di chi sopravvive e sbalza via chi muore.
   */
  hit(dmg: number, from: Vector3, power: number, push: Vector3): boolean {
    if (!this.alive) return false;
    this.hp -= dmg;
    this.flash = 0.14 * power;
    const away = this.pos.subtract(from); away.y = 0; away.normalize();
    this.knock.copyFrom(away.add(new Vector3(push.x, 0, push.z).normalize()).normalize().scaleInPlace(this.sp.knock * power));
    this.fallSide = Math.sign(Vector3.Cross(new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)), away).y) || 1;
    for (const e of this.pack) e.alert();
    if (this.hp <= 0) {
      this.state = "dead"; this.t = 0; this.still = 0; this.dustAt = Infinity; this.landed = 0;
      this.rig.eyes.setEnabled(false);
      // da qui il corpo è della fisica: parte dalla posa e con la velocità che aveva, più l'ultimo colpo
      this.rag = new Ragdoll(this.rig, this.sp.def, this.scale, this.sp.rag, new Vector3(Math.sin(this.yaw) * this.speed, 0, Math.cos(this.yaw) * this.speed));
      this.shove(push, from);
      return true;
    }
    // ⚠️ durante il balzo non barcolla: il morso parte comunque, chi attacca deve parare
    if (!(this.state === "attack" && this.t > this.sp.windup) || power > 1) { this.state = "stagger"; this.t = power > 1 ? -0.3 : 0; }
    return true;
  }

  /** Una spinta al corpo morto (il colpo che uccide, o un colpo dato a un cadavere): i leggeri volano più lontano. */
  shove(push: Vector3, from: Vector3): void {
    this.rag?.impulse(push.scale(1 / Math.sqrt(this.sp.rag.mass)), from, this.rnd);
    this.still = 0;
  }

  /** L'inclinazione del terreno sotto il corpo, lungo la sua direzione (rotation.x positiva = muso in giù). */
  private tilt(dt: number, ground: Ground): void {
    const sx = Math.sin(this.yaw), cz = Math.cos(this.yaw), half = this.sp.anim.len * this.scale;
    const rise = ground(this.pos.x + sx * half, this.pos.z + cz * half) - ground(this.pos.x - sx * half, this.pos.z - cz * half);
    this.slope += (-Math.atan2(rise, 2 * half) - this.slope) * Math.min(1, dt * 8);
  }

  /** L'ombra a macchia: a terra sotto il corpo, più tenue quanto più il corpo è in aria. */
  private shadow(height = 0): void {
    this.blob.position.set(this.pos.x, this.pos.y + 0.04, this.pos.z);
    this.blob.rotation.set(Math.PI / 2 + this.slope, this.yaw, 0);
    this.blob.visibility = clamp(1 - height / 2.5);
  }

  update(dt: number, target: Target, ground: Ground, colliders: Collider[], others: Enemy[]): void {
    const sp = this.sp;
    this.t += dt;
    this.cd -= dt;
    this.flash = Math.max(0, this.flash - dt);
    this.fx.flash = Math.min(0.45, this.flash * 2.4);   // un lampo, non un palloncino rosso
    const toP = target.position.subtract(this.pos); toP.y = 0;
    const d = toP.length();
    let move = 0, faceYaw = this.yaw;

    if (this.state === "dead") {
      // il corpo è della fisica: vola dove l'ha mandato il colpo, rotola, si ferma; fermo da un
      // momento si disfa in pulviscolo; poi si rigenera a casa
      if (this.t > 30) { this.reset(); return; }
      const rag = this.rag!, k = clamp((this.t - this.dustAt) / DISSOLVE_LEN);
      this.fx.dissolve = k;
      if (k > 0 && !this.dusted) { this.dusted = true; this.onDissolve(this); }
      if (k > 0.45) this.blob.setEnabled(false);
      if (k >= 1) { this.rig.root.setEnabled(false); return; }
      rag.step(dt, ground, colliders);
      rag.apply();
      this.pos.set(rag.center.x, ground(rag.center.x, rag.center.z), rag.center.z);
      this.yaw = rag.yaw;
      this.speed = 0;
      this.tilt(dt, ground);
      this.shadow(rag.center.y - this.pos.y);
      if (rag.impact > 4 && this.t - this.landed > 0.25) { this.landed = this.t; this.onLand(this, rag.impact); }
      rag.impact = 0;
      this.still = rag.speed < 0.6 ? this.still + dt : 0;
      if (this.dustAt === Infinity && (this.still > 0.4 || this.t > LIMIT)) this.dustAt = this.t + REST;
      return;
    }

    if (!target.alive && this.state !== "idle") { this.state = "return"; }
    switch (this.state) {
      case "idle": {
        if (target.alive && d < sp.aggro) { for (const e of this.pack) e.alert(); this.alert(); break; }
        if (this.wander && Vector3.DistanceSquared(this.wander, this.pos) > 0.5) {
          move = sp.walk; faceYaw = Math.atan2(this.wander.x - this.pos.x, this.wander.z - this.pos.z);
        } else if ((this.wait -= dt) <= 0) {
          this.wander = new Vector3(this.home.x + (this.rnd() - 0.5) * this.roam * 2, 0, this.home.z + (this.rnd() - 0.5) * this.roam * 2);
          this.wait = 3 + this.rnd() * 6;
        } else this.wander = null;
        break;
      }
      case "return": {
        const h = this.home.subtract(this.pos); h.y = 0;
        if (h.length() < 3) { this.state = "idle"; this.hp = sp.hp; break; }
        move = sp.run * 0.6; faceYaw = Math.atan2(h.x, h.z);
        break;
      }
      case "chase": {
        if (Vector3.Distance(this.pos, this.home) > 60 || d > sp.aggro * 2.5) { this.state = "return"; break; }
        const toYaw = Math.atan2(toP.x, toP.z);
        if (d < sp.reach + 0.35 && this.cd <= 0) { this.state = "attack"; this.t = 0; this.bit = false; faceYaw = toYaw; }
        else if (sp.circle && this.cd > 0 && d < 7) {
          // in attesa del prossimo assalto gira attorno alla preda: lungo la tangente, correggendo
          // verso dentro se è lontano e verso fuori se è troppo sotto
          faceYaw = toYaw + this.orbit * (Math.PI / 2 - clamp((d - 3.4) * 0.5, -0.7, 0.9));
          move = sp.run * 0.45;
        } else {
          faceYaw = toYaw;
          if (d > sp.reach * 0.8) move = d < 4 ? sp.run * 0.55 : sp.run;
        }
        break;
      }
      case "attack": {
        if (this.t < sp.windup) faceYaw = Math.atan2(toP.x, toP.z);
        else if (this.t < sp.windup + sp.lunge) move = sp.lungeSpeed;
        if (!this.bit && this.t >= sp.windup + sp.lunge * 0.6) {
          this.bit = true;
          const fwd = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
          if (d < sp.reach + 0.5 && Vector3.Dot(fwd, toP.normalizeToNew()) > 0.5) {
            if (target.damage(sp.dmg, this.pos) === "blocked") {
              // morso sullo scudo: rimbalza indietro e barcolla
              this.knock.copyFrom(toP.normalizeToNew().scale(-sp.knock * 0.8));
              this.state = "stagger"; this.t = -0.25; this.cd = sp.cooldown;
              break;
            }
          }
        }
        if (this.t > sp.windup + sp.lunge + sp.recover) { this.state = "chase"; this.cd = sp.cooldown * (0.7 + this.rnd() * 0.6); }
        break;
      }
      case "stagger": {
        if (this.t > 0.4) { this.state = "chase"; this.cd = Math.max(this.cd, 0.3); }
        break;
      }
    }

    // rotazione morbida verso dove vuole andare
    let dy = faceYaw - this.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const turn = dy * Math.min(1, dt * (this.state === "attack" ? 6 : this.speed > 3 ? 5 : 8));
    this.yaw += turn;
    this.lean += (clamp(-turn / Math.max(dt, 1e-3) * this.speed * 0.012, -0.3, 0.3) - this.lean) * Math.min(1, dt * 6);
    this.speed += (move - this.speed) * Math.min(1, dt * 6);
    this.knock.scaleInPlace(Math.exp(-dt * 7));
    this.pos.x += (Math.sin(this.yaw) * this.speed + this.knock.x) * dt;
    this.pos.z += (Math.cos(this.yaw) * this.speed + this.knock.z) * dt;

    // collisioni: tronchi e rocce, gli altri nemici, il giocatore
    const push = (cx: number, cz: number, r: number): void => {
      const dx = this.pos.x - cx, dz = this.pos.z - cz, d2 = dx * dx + dz * dz;
      if (d2 < r * r && d2 > 1e-6) { const k = r / Math.sqrt(d2); this.pos.x = cx + dx * k; this.pos.z = cz + dz * k; }
    };
    // (gli ostacoli con una fascia d'altezza, i muri del sottosuolo, fermano solo chi sta a quella quota)
    for (const c of colliders) if (Math.abs(c.x - this.pos.x) < 8 && Math.abs(c.z - this.pos.z) < 8 && (c.y0 === undefined || (this.pos.y + 1 > c.y0 && this.pos.y < c.y1!))) push(c.x, c.z, c.r + sp.radius);
    for (const o of others) if (o !== this && o.alive) push(o.pos.x, o.pos.z, sp.radius + o.sp.radius);
    if (target.alive) push(target.position.x, target.position.z, sp.radius + 0.4);
    const lim = HALF - 14;
    this.pos.x = Math.max(-lim, Math.min(lim + EAST, this.pos.x));   // a est il mondo prosegue (la strada, la grotta, la città)
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));
    this.pos.y = ground(this.pos.x, this.pos.z);

    this.animate(dt, d, toP, ground);
  }

  private animate(dt: number, d: number, toP: Vector3, ground: Ground): void {
    const c = this.rig, sp = this.sp, A = sp.anim, sc = this.scale;
    const now = performance.now() / 1000 + this.seed;

    // radice: a terra, girata, inclinata come il pendio
    this.tilt(dt, ground);
    c.root.position.copyFrom(this.pos);
    c.root.rotation.set(this.slope, this.yaw, 0);
    this.shadow();

    // andatura: passo → trotto → galoppo con la velocità (in unità del modello)
    const v = Math.abs(this.speed) / sc, k = Math.abs(this.speed) / sp.run;
    const gal = A.gallop * smoothstep(0.6, 0.9, k), trot = smoothstep(0.2, 0.42, k) * (1 - gal), walk = 1 - trot - gal;
    const duty = walk * 0.62 + trot * 0.5 + gal * 0.34;
    const f = A.f0 + A.f1 * v;
    this.gait += dt * f;
    const stride = v * duty / f;                              // strada fatta dal corpo durante un appoggio
    const moving = Math.min(1, v / (0.5 * A.size));
    const lift = A.lift * moving * (1 + gal * 0.8);
    const ph = this.gait * Math.PI * 2;

    // tronco: al galoppo la schiena si raccoglie e si distende, il corpo beccheggia e rimbalza
    const flex = gal * 0.12 * Math.sin(ph + 2.4);
    const rock = gal * 0.05 * Math.sin(ph + 0.9);
    let pc = flex + rock, pp = -flex + rock;
    let bob = (trot * 0.014 * Math.sin(2 * ph) + gal * 0.04 * Math.sin(ph + 1.5) + (1 - moving) * 0.004 * Math.sin(now * 1.7)) * A.size;
    let crouch = 0, neck = 0, head = 0, jaw = 0, reach = 0, reachLift = 0, roll = this.lean;

    if (this.state === "attack") {
      const w = sp.windup, t = this.t;
      if (t < w) {
        // si acquatta: corpo giù, testa bassa, labbra che si alzano
        const u = ease(t / w);
        crouch = 0.2 * c.pivot[0] * u; pc += 0.1 * u; neck = 0.3 * u; jaw = 0.18 * u;
      } else if (t < w + sp.lunge) {
        // il balzo: petto in su, zampe anteriori lanciate avanti, fauci spalancate
        const u = (t - w) / sp.lunge, s = Math.sin(u * Math.PI);
        crouch = 0.2 * c.pivot[0] * (1 - u) - 0.06 * A.size * s; pc -= 0.16 * s; pp -= 0.06 * s;
        neck = 0.12; head = -0.1; jaw = A.gape;
        reach = 0.24 * A.size * s; reachLift = 0.2 * A.size * s;
      } else {
        jaw = A.gape * (1 - clamp((t - w - sp.lunge) / 0.25));
      }
    } else if (this.state === "stagger") {
      const s = Math.sin(clamp(Math.max(0, this.t) / 0.4) * Math.PI);
      crouch = 0.12 * c.pivot[0] * s; roll += this.fallSide * 0.3 * s; head = 0.35 * s; pc += 0.08 * s;
    } else if (this.state === "chase") {
      // testa bassa e protesa; da vicino ringhia
      neck = 0.28 * (1 - gal * 0.4); head = -0.12;
      if (d < 7) jaw = 0.09 + 0.03 * Math.sin(now * 23);
    } else if (moving < 0.5) {
      // fermo: ogni tanto annusa a terra
      const s = smoothstep(0.5, 0.8, Math.sin(now * 0.37));
      neck = 0.7 * s * A.gallop + 0.12 * (1 - A.gallop) * Math.sin(now * 2.3);
      head = 0.3 * s * A.gallop + 0.05 * Math.sin(now * 9) * (1 - A.gallop);
    }
    const P = this.pose, q = Math.min(1, dt * 16);
    P.crouch += (crouch - P.crouch) * q; P.neck += (neck - P.neck) * q; P.head += (head - P.head) * q; P.jaw += (jaw - P.jaw) * q;

    c.body.position.y = c.pivot[0] - P.crouch + bob;
    c.body.rotation.z = roll;
    c.chest.rotation.x = pc;
    c.pelvis.rotation.x = pp;
    // la testa segue la preda (il collo fa metà del lavoro) e resta ferma mentre il torace beccheggia
    let look = 0;
    if (this.state !== "idle" && this.state !== "return") {
      look = Math.atan2(toP.x, toP.z) - this.yaw;
      look = clamp(Math.atan2(Math.sin(look), Math.cos(look)), -1.1, 1.1);
    }
    c.neck.rotation.set(P.neck - pc * 0.7, look * 0.5, 0);
    c.head.rotation.set(P.head, look * 0.5, 0);
    c.jaw.rotation.x = P.jaw;

    // zampe in IK: in appoggio il piede scorre all'indietro alla velocità del terreno, poi si alza e torna avanti
    const py = c.pivot[0], pz = c.pivot[1];
    c.legs.forEach((leg, i) => {
      const p = (this.gait + walk * WALK[i] + trot * TROT[i] + gal * GALLOP[i]) % 1;
      let fz: number, fy = 0, swing = 0;
      if (p < duty) fz = stride * (0.5 - p / duty);
      else {
        const u = (p - duty) / (1 - duty);
        swing = Math.sin(u * Math.PI);
        fz = stride * (-0.5 + ease(u)); fy = lift * swing;
      }
      if (leg.front) { fz += reach; fy += reachLift; }
      const a = leg.front ? pc : pp;
      const oy = leg.hip[0] - py, oz = leg.hip[1] - pz;
      const hy = py + oy * Math.cos(a) - oz * Math.sin(a) - P.crouch + bob, hz = pz + oy * Math.sin(a) + oz * Math.cos(a);
      solveLeg(leg, hy, hz, leg.foot[0] + fy, leg.foot[1] + fz, leg.rest[2] - A.flex * swing * moving, a);
    });

    // coda: il lupo la alza correndo e la fa ondeggiare; quella del ratto serpeggia a terra
    const sway = A.tailSway * (1 + k);
    c.tail.forEach((n, i) => {
      const w = Math.sin(now * (2 + k * 9) - i * 0.9) * sway;
      n.rotation.set(i === 0 ? A.tailUp * k : A.tailUp * 0.12 * k, w, A.gallop * w);
    });
  }
}

export interface Hit { point: Vector3; name: string; frac: number; killed: boolean }

let blobMat: StandardMaterial | null = null;
/** L'ombra a macchia sotto chi si muove (creature e abitanti: la shadow map è disegnata una volta sola). */
export function blobShadowMaterial(scene: Scene): StandardMaterial {
  if (blobMat) return blobMat;
  const m = new StandardMaterial("blobShadow", scene);
  const st = new DynamicTexture("blobTex", 64, scene, false);
  const c = st.getContext() as CanvasRenderingContext2D;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(0,0,0,0.55)"); g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g; c.fillRect(0, 0, 64, 64); st.hasAlpha = true; st.update();
  m.diffuseTexture = st; m.useAlphaFromDiffuseTexture = true; m.disableLighting = true;
  m.emissiveColor = Color3.Black(); m.zOffset = -2;
  return (blobMat = m);
}

export class Enemies {
  private list: Enemy[] = [];
  /** Chiamato quando un morto comincia a disfarsi (la foschia a terra ci fa un soffio). */
  onDust: ((x: number, z: number) => void) | null = null;
  /** Chiamato quando un corpo sbalzato via batte a terra, con la velocità dell'urto (m/s). */
  onLand: ((x: number, z: number, v: number) => void) | null = null;

  /** `under(id)` = il centro della camera di una cripta o di una grotta (per i gruppi che nascono sotto terra: `spawns[].in`). */
  constructor(private scene: Scene, private ground: Ground3, private colliders: Collider[], db: Db, under: (id: string) => { x: number; z: number; y?: number } | undefined = () => undefined) {
    const rnd = mulberry32(0xE4E);
    const furMat = creatureMaterial(scene, furTex(scene));
    const shadowMat = blobShadowMaterial(scene);
    const eyes = new Map<Species, [StandardMaterial, StandardMaterial]>();
    // specie e case dei gruppi vengono dal file (tabelle `creatures` e `spawns`)
    const kinds = new Map(db.creatures.map((c) => [c.id, species(c)]));
    for (const sp of kinds.values()) eyes.set(sp, eyeMaterials(scene, sp.name, sp.eye));
    // la casa di un gruppo: nel mondo, sul terreno; o sotto terra, attorno al centro di una camera (con la sua quota, e senza andare lontano)
    const groups = db.spawns.map((s): [Species, number, number, number, number, number] => {
      const c = s.in ? under(s.in) : undefined, x = (c?.x ?? 0) + s.at[0], z = (c?.z ?? 0) + s.at[1];
      return [kinds.get(s.creature)!, x, z, s.count, ground(x, z, c?.y ?? 1e6), c ? 2 : 8];
    });
    let id = 0;
    for (const [sp, x, z, n, y, roam] of groups) {
      const pack: Enemy[] = [];
      for (let i = 0; i < n; i++) {
        const rig = buildQuadruped(scene, `${sp.name}${id++}`, sp.def, ...eyes.get(sp)!);
        const fx: CreatureFx = { flash: 0, dissolve: 0 };
        rig.mesh.material = furMat;
        rig.mesh.metadata = { fx };
        const scale = sp.scale[0] + rnd() * (sp.scale[1] - sp.scale[0]);
        rig.root.scaling.setAll(scale);
        const blob: Mesh = MeshBuilder.CreateDisc("blob", { radius: 1, tessellation: 20 }, scene);
        // non è figlia del modello: resta a terra anche quando il corpo vola (la mette Enemy.shadow)
        blob.scaling.set(sp.radius * 0.9 * scale, sp.anim.len * 1.9 * scale, 1); blob.material = shadowMat; blob.isPickable = false;
        const e = new Enemy(sp, rig, fx, blob, scale, new Vector3(x, y, z), pack, rnd, (d) => this.dust(d),
          (d, v) => this.onLand?.(d.pos.x, d.pos.z, v), roam);
        pack.push(e); this.list.push(e);
      }
    }
  }

  update(dt: number, target: Target): void {
    dt = Math.min(dt, 0.05);
    for (const e of this.list) e.update(dt, target, (x, z) => this.ground(x, z, e.pos.y), this.colliders, this.list);
  }

  /** Chi si muove (per la foschia a terra): posizione, velocità, raggio. */
  movers(out: { x: number; z: number; vx: number; vz: number; r: number }[]): void {
    for (const e of this.list) {
      const r = e.sp.radius * 2.2;
      // un corpo che vola o rotola rasoterra la sposta come un vivo
      if (!e.alive) { if (e.rag && e.rag.speed > 1.5 && e.rag.speed < 90 && e.rag.center.y - e.pos.y < 1) out.push({ x: e.pos.x, z: e.pos.z, vx: e.rag.vel.x, vz: e.rag.vel.z, r }); continue; }
      out.push({ x: e.pos.x, z: e.pos.z, vx: Math.sin(e.yaw) * e.speed + e.knock.x, vz: Math.cos(e.yaw) * e.speed + e.knock.z, r });
    }
  }

  /** Il pulviscolo di un morto che si disfa: granelli chiari che si staccano dal corpo, ingrigiscono, salgono e vanno col vento. */
  private dust(e: Enemy): void {
    const L = e.sp.anim.len * 2.3 * e.scale, W = e.sp.radius * 1.2;
    const ex = (Math.abs(Math.sin(e.yaw)) * L + Math.abs(Math.cos(e.yaw)) * W) / 2, ez = (Math.abs(Math.cos(e.yaw)) * L + Math.abs(Math.sin(e.yaw)) * W) / 2;
    const ps = new ParticleSystem("dust", 1400, this.scene);
    ps.particleTexture = softDotTex(this.scene);
    ps.emitter = new Vector3(e.pos.x, e.pos.y + e.sp.anim.lie * e.scale, e.pos.z);
    ps.createBoxEmitter(new Vector3(-0.4, 0.4, -0.4), new Vector3(0.6, 1.5, 0.4), new Vector3(-ex, -0.12, -ez), new Vector3(ex, 0.18, ez));
    ps.minSize = 0.012; ps.maxSize = 0.045;
    ps.minLifeTime = 1.4; ps.maxLifeTime = 3.6;
    ps.minEmitPower = 0.1; ps.maxEmitPower = 0.7;
    ps.gravity = new Vector3(0.3, 0.14, 0.12);
    ps.addColorGradient(0, new Color4(1.5, 1.35, 1.05, 0.9), new Color4(1.0, 0.92, 0.78, 0.8));
    ps.addColorGradient(0.3, new Color4(0.72, 0.7, 0.66, 0.6), new Color4(0.5, 0.49, 0.47, 0.5));
    ps.addColorGradient(1, new Color4(0.45, 0.45, 0.44, 0));
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.emitRate = 700;
    ps.targetStopDuration = DISSOLVE_LEN;
    ps.disposeOnStop = true;
    ps.start();
    this.onDust?.(e.pos.x, e.pos.z);
  }

  /**
   * Fendente: colpisce tutti i vivi davanti entro la portata. `arc` = coseno della mezza apertura
   * (0.5 = 60° per lato), `power` = peso del colpo (spinta e barcollo), `push` = la velocità che la
   * lama dà a chi uccide (vedi Enemy.hit). Un cadavere nell'arco prende la spinta anche lui.
   */
  strike(origin: Vector3, dir: Vector3, reach: number, dmg: number, arc: number, power: number, push: Vector3): Hit[] {
    const hits: Hit[] = [];
    for (const e of this.list) {
      const to = e.pos.subtract(origin); to.y = 0;
      const d = to.length();
      if (d > reach + e.sp.radius || Vector3.Dot(to.normalize(), dir) < arc) continue;
      if (!e.alive) { e.shove(push.scale(0.6), origin); continue; }
      e.hit(dmg, origin, power, push);
      hits.push({ point: e.pos.add(new Vector3(0, e.rig.pivot[0] * e.scale, 0)), name: e.sp.name, frac: Math.max(0, e.hp / e.sp.hp), killed: !e.alive });
    }
    return hits;
  }

  /** Dopo la morte del giocatore: tutti a casa, sani. */
  reset(): void { for (const e of this.list) e.reset(); }

  /** Il nemico vivo più vicino che sta attaccando il giocatore (per la barra in alto). */
  nearestHostile(p: Vector3): { name: string; frac: number } | null {
    let best: Enemy | null = null, bd = Infinity;
    for (const e of this.list) {
      if (!e.alive || (e.state !== "chase" && e.state !== "attack" && e.state !== "stagger")) continue;
      const d = Vector3.DistanceSquared(e.pos, p);
      if (d < bd) { bd = d; best = e; }
    }
    return best && bd < 15 * 15 ? { name: best.sp.name, frac: best.hp / best.sp.hp } : null;
  }
}
