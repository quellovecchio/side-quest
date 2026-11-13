import {
  AbstractMesh, BaseTexture, Color3, Color4, Constants, FreeCamera, Mesh, ParticleSystem, Quaternion, Scene, StandardMaterial,
  TransformNode, Vector3, VertexBuffer, VertexData,
} from "@babylonjs/core";
import type { Collider } from "../world/vegetation";
import { EAST, HALF } from "../world/terrain";
import { blocks, BODY, nearest } from "../world/levels";
import { softDotTex } from "../world/textures";
import { buildArm, buildShield, buildSword } from "./equipment";
import type { Hud } from "../hud";
import type { BlockResult, Hit, Target } from "../enemies";
import { sfx } from "../sfx";

// ─────────────────────────────────────────────────────────────────────────────
// GIOCATORE — prima persona alla Elder Scrolls.
//   WASD muoversi · Shift correre · Spazio saltare · Click sinistro attaccare
//   Click destro (tenuto) parare con lo scudo.
// Fisica fatta a mano: gravità, quota del terreno, collisioni a cerchi coi tronchi e le rocce.
// L'arma in vista (viewmodel) è figlia della camera, disegnata in un rendering group suo (non
// entra nei tronchi) e animata a pose interpolate.
//
// COMBATTIMENTO. Una combo di tre colpi: fendente (destra → sinistra), rovescio (sinistra →
// destra), colpo dall'alto (più lento, più forte, apre la guardia del bersaglio). Ogni colpo è
// carica → colpo → tenuta → recupero; un click durante il colpo prenota il successivo, che parte
// dalla posa in cui la lama si trova. Il colpo si fa sentire:
//   · la vista si torce con la carica e scatta col fendente; un passo in avanti accompagna la lama;
//   · la lama lascia una scia; l'aria smossa sposta la foschia a terra;
//   · quando va a segno il tempo si ferma un istante (hit-stop), sangue, scossa, il mirino scatta;
//   · su legno e pietra la lama rimbalza con le schegge; ogni cosa ha il suo suono.
// La parata alza lo scudo con una molla (un filo di rimbalzo); un morso parato lo ributta indietro
// con le scintille.
// ─────────────────────────────────────────────────────────────────────────────

const EYE = 1.68;
const WALK = 4.2, RUN = 7.4, BLOCK_SPEED = 2.4;
const GRAVITY = 22, JUMP_V = 7.4;
const RADIUS = 0.35;
const REACH = 2.4;
const NEAR = { x: 0, z: 0 };   // il punto più vicino dell'ostacolo in esame
const FOV = 1.05;

// Una posa della mano: posizione nello spazio camera (m, +Z avanti), dove punta la lama (+Y locale;
// per lo scudo il suo "su") e il rollio della lama attorno a sé (0 = filo in avanti, π/2 = piatto
// verso chi guarda / filo di traverso). Il pugno guarda via dalla spalla (+Z locale): così
// l'avambraccio torna sempre verso la spalla. Lo scudo passa `fwd` (+Z = la faccia con l'umbone).
interface Pose { p: Vector3; q: Quaternion; roll: number }
const SHOULDER_R = new Vector3(0.24, -0.5, -0.15);
function pose(p: [number, number, number], up: [number, number, number], roll = 0, fwd?: [number, number, number]): Pose {
  const Y = new Vector3(...up).normalize();
  const f = fwd ? new Vector3(...fwd) : new Vector3(...p).subtract(SHOULDER_R);
  const Z = f.subtract(Y.scale(Vector3.Dot(f, Y))).normalize();
  const X = Vector3.Cross(Y, Z);
  return { p: new Vector3(...p), q: Quaternion.RotationQuaternionFromAxis(X, Y, Z), roll };
}
const blank = (): Pose => ({ p: new Vector3(), q: new Quaternion(), roll: 0 });
function mix(a: Pose, b: Pose, t: number, out: Pose): void {
  Vector3.LerpToRef(a.p, b.p, t, out.p);
  Quaternion.SlerpToRef(a.q, b.q, Math.min(1, Math.max(0, t)), out.q);
  out.roll = a.roll + (b.roll - a.roll) * t;
}
const copy = (a: Pose, out: Pose): void => { out.p.copyFrom(a.p); out.q.copyFrom(a.q); out.roll = a.roll; };

const FLAT = 1.3;
// ⚠️ Cosa si vede: a profondità z il campo va da −1,02·z a +1,02·z in x e da −0,58·z a +0,58·z in y.
// Le pose dei colpi tengono la mano dentro il campo e la lama DI PIATTO verso chi guarda, che
// attraversa il centro: una lama puntata in avanti si vede di scorcio, cioè non si vede.
const SWORD_REST = pose([0.3, -0.34, 0.5], [-0.12, 0.9, 0.42], FLAT);
const SWORD_GUARD = pose([0.36, -0.4, 0.44], [-0.35, 0.82, 0.45], FLAT);
// mano sinistra (scudo): a riposo in basso a sinistra, in parata davanti al petto (la vista resta libera sopra)
const SHIELD_REST = pose([-0.54, -0.56, 0.6], [0.1, 1, 0], 0, [0.45, 0, 1]);
const SHIELD_BLOCK = pose([-0.14, -0.3, 0.56], [0.08, 1, -0.04], 0, [0.16, 0.12, 1]);

interface Attack {
  /** Durate (s): carica, colpo, tenuta a fine colpo, recupero. */
  windup: number; swing: number; hold: number; recover: number;
  /** Pose: fine della carica, impatto, fine del colpo. */
  a: Pose; b: Pose; c: Pose;
  dmg: number; arc: number; power: number; cost: number;
  /** Passo in avanti che accompagna il colpo (m/s). */
  lunge: number;
  /** Verso del colpo nello spazio camera [destra, avanti]: sposta la foschia. */
  dir: [number, number];
  /**
   * La velocità [destra, su, avanti] (m/s) che il colpo dà a un corpo del peso di un lupo quando lo
   * uccide: il cadavere parte nel verso in cui passava la lama. I più leggeri volano più lontano.
   */
  launch: [number, number, number];
  /** Torsione della vista [beccheggio, imbardata, rollio] (rad) durante la carica e durante il colpo. */
  pre: [number, number, number]; kick: [number, number, number];
}

const ATTACKS: Attack[] = [
  { // 1 · fendente: dall'alto a destra al basso a sinistra
    windup: 0.15, swing: 0.11, hold: 0.05, recover: 0.34,
    a: pose([0.34, -0.08, 0.48], [0.45, 0.85, -0.25], 1.57), b: pose([0.16, -0.2, 0.6], [-0.62, 0.5, 0.6], 1.57), c: pose([-0.12, -0.3, 0.56], [-0.92, -0.12, 0.37], 1.57),
    dmg: 18, arc: 0.5, power: 1, cost: 9, lunge: 1.4, dir: [-1, 0.3], launch: [-7, 3.4, 3.5], pre: [-0.012, 0.03, -0.02], kick: [0.02, -0.05, 0.04],
  },
  { // 2 · rovescio: da sinistra a destra, quasi orizzontale
    windup: 0.13, swing: 0.11, hold: 0.05, recover: 0.34,
    a: pose([-0.1, -0.22, 0.5], [-0.85, 0.35, -0.1], 1.57), b: pose([0.06, -0.24, 0.62], [0.5, 0.42, 0.75], 1.57), c: pose([0.34, -0.26, 0.56], [0.93, 0.05, 0.36], 1.57),
    dmg: 20, arc: 0.5, power: 1, cost: 9, lunge: 1.4, dir: [1, 0.3], launch: [7.5, 3, 3.5], pre: [0, -0.03, 0.02], kick: [0.01, 0.05, -0.04],
  },
  { // 3 · colpo dall'alto: carica lunga, cala al centro; pesa di più e fa più male
    windup: 0.24, swing: 0.12, hold: 0.1, recover: 0.44,
    a: pose([0.18, 0.02, 0.44], [0.12, 0.9, -0.42], 0), b: pose([0.12, -0.12, 0.62], [-0.1, 0.62, 0.78], 0), c: pose([0.08, -0.3, 0.58], [-0.12, -0.25, 0.96], 0),
    dmg: 34, arc: 0.78, power: 1.8, cost: 15, lunge: 2.8, dir: [0, 1], launch: [0, 5.6, 10], pre: [-0.05, 0, 0], kick: [0.075, 0, 0],
  },
];

type Phase = "windup" | "swing" | "hold" | "recover";

const ease = (t: number): number => t * t * (3 - 2 * t);
const easeOut = (t: number): number => 1 - (1 - t) ** 3;

// la scia della lama: un nastro fra due punti della lama, campionato a ogni frame del colpo
const TRAIL_N = 14, TRAIL_LIFE = 0.13;

export class Player implements Target {
  readonly camera: FreeCamera;
  private pos: Vector3;
  private vel = new Vector3();
  private yaw = 0;
  private pitch = 0;
  private grounded = true;
  private keys = new Set<string>();
  private blocking = false;
  private stamina = 100;
  private staminaWait = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private sway = { x: 0, y: 0 };
  private dip = 0;
  private dipV = 0;
  private shake = 0;
  private health = 100;
  private hurtWait = 0;
  private deadT = -1;
  // attacco
  private atk = -1;
  private phase: Phase = "recover";
  private pt = 0;
  private combo = 0;
  private comboT = 0;
  private queued = false;
  private struck = false;
  private hitStop = 0;
  private from = blank();
  private cur = blank();
  private tmp = blank();
  private kick = new Vector3();
  private kickT = new Vector3();
  private fovKick = 0;
  private atkW = 0;
  // parata
  private blockW = 0;
  private blockV = 0;
  private shieldKick = 0;
  // viewmodel
  private vm: TransformNode;
  private swordHand: TransformNode;
  private sword: TransformNode;
  private shieldHand: TransformNode;
  private chips: ParticleSystem;
  private trail: Mesh;
  private trailPts: { b: Vector3; t: Vector3; age: number }[] = [];
  private trailPos = new Float32Array(TRAIL_N * 6);
  private trailCol = new Float32Array(TRAIL_N * 8);
  locked = false;
  /** In modalità editor il giocatore non riceve tastiera né mouse (e non chiede il puntatore): li usa l'editor. */
  inputOff = false;
  /** Fermo e sordo ai comandi (mentre sceglie quanto dormire, mentre dorme). */
  private frozen = false;
  /** I numeri che il personaggio cambia (statistiche e abilità: main.ts): moltiplicatori del vigore di un colpo e di una parata, del passo, del danno ricevuto. */
  tune = { cost: 1, block: 1, speed: 1, resist: 1 };
  /** I nemici da colpire col fendente (main.ts). */
  combat: { strike(origin: Vector3, dir: Vector3, reach: number, dmg: number, arc: number, power: number, push: Vector3): Hit[] } | null = null;
  onDeath: (() => void) | null = null;
  /** Lo spostamento d'aria di un fendente: punto, direzione, forza (lo sente la foschia a terra). */
  onGust: ((x: number, z: number, dx: number, dz: number, str: number) => void) | null = null;
  /** Mentre la lama passa, a ogni fotogramma: un punto della lama a terra, il verso in cui taglia, quanto spinge. */
  onSweep: ((x: number, z: number, dx: number, dz: number, str: number) => void) | null = null;

  /** Il soffitto sopra un punto (i solai degli edifici); senza, si salta a cielo aperto. */
  ceiling: ((x: number, z: number, y: number) => number) | null = null;
  /** Il tasto d'interazione (E). */
  onUse: (() => void) | null = null;

  constructor(private scene: Scene, private ground: (x: number, z: number, y?: number) => number,
    private colliders: Collider[], env: BaseTexture, private hud: Hud, spawn: { x: number; z: number }, lookAt: { x: number; z: number }) {
    this.pos = new Vector3(spawn.x, ground(spawn.x, spawn.z), spawn.z);
    this.yaw = Math.atan2(lookAt.x - spawn.x, lookAt.z - spawn.z);
    const cam = new FreeCamera("player", this.pos.add(new Vector3(0, EYE, 0)), scene);
    cam.minZ = 0.05; cam.maxZ = 1200; cam.fov = FOV;
    cam.inputs.clear();
    this.camera = cam;

    // viewmodel: figlio della camera, gruppo 1 (profondità pulita: la lama non entra nei tronchi)
    this.vm = new TransformNode("viewmodel", scene);
    this.vm.parent = cam;
    this.swordHand = buildArm(scene, "rightArm", false);
    this.sword = buildSword(scene, env);
    this.sword.parent = this.swordHand;
    this.swordHand.parent = this.vm;
    this.swordHand.rotationQuaternion = new Quaternion();
    this.shieldHand = buildArm(scene, "leftArm", true);
    buildShield(scene, env).parent = this.shieldHand;
    this.shieldHand.parent = this.vm;
    this.shieldHand.rotationQuaternion = new Quaternion();
    this.trail = this.makeTrail();
    for (const m of this.vm.getChildMeshes()) { m.renderingGroupId = 1; m.isPickable = false; m.receiveShadows = true; }
    copy(SWORD_REST, this.cur);

    this.chips = this.makeChips();
    this.bindInput();
  }

  get position(): Vector3 { return this.pos; }
  get velocity(): Vector3 { return this.vel; }
  get alive(): boolean { return this.deadT < 0; }

  /**
   * Un morso. Con lo scudo alzato e l'attaccante davanti (±65°) si para: danno a un quinto, ma costa
   * vigore; senza vigore la parata cede e passa più di metà del colpo.
   */
  damage(amount: number, from: Vector3): BlockResult {
    if (!this.alive) return "ignored";
    amount *= this.tune.resist;
    const to = from.subtract(this.pos); to.y = 0; to.normalize();
    const facing = Math.sin(this.yaw) * to.x + Math.cos(this.yaw) * to.z;
    let blocked = this.blockW > 0.6 && facing > 0.42;
    if (blocked && this.stamina < 8) { blocked = false; amount *= 0.6; this.hud.flashStamina(); }
    if (blocked) {
      this.stamina = Math.max(0, this.stamina - 14 * this.tune.block); this.staminaWait = 0.9;
      this.shieldKick = 1;
      this.shake = Math.max(this.shake, 0.45);
      this.kick.x -= 0.035;
      amount *= 0.2;
      sfx.block();
      // scintille sul ferro dello scudo
      const f = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      this.burst(this.camera.position.add(f.scale(0.6)).addInPlaceFromFloats(0, -0.22, 0), f.scale(-1), 26,
        new Color4(2.4, 1.8, 0.8, 1), new Color4(1.6, 0.9, 0.3, 1), 4.5);
    } else {
      this.shake = Math.max(this.shake, 0.85);
      // il colpo spinge indietro, via dall'attaccante
      this.vel.x -= to.x * 3; this.vel.z -= to.z * 3;
      sfx.hurt();
    }
    this.health = Math.max(0, this.health - amount);
    this.hurtWait = 6;
    this.hud.hurt(blocked ? 0.25 : Math.min(1, amount / 15 + 0.35));
    if (this.health <= 0) {
      this.deadT = 0;
      this.atk = -1; this.blocking = false; this.queued = false;
      this.vm.setEnabled(false);
      this.onDeath?.();
    }
    return blocked ? "blocked" : "hit";
  }

  /** Rinasce alla radura, sano. */
  /** Sposta chi gioca in un punto del mondo, rivolto a `lookAt` (il viaggio rapido del menu). */
  teleport(at: { x: number; z: number }, lookAt: { x: number; z: number }): void {
    this.pos.set(at.x, this.ground(at.x, at.z), at.z);
    this.vel.setAll(0);
    this.yaw = Math.atan2(lookAt.x - at.x, lookAt.z - at.z); this.pitch = 0;
  }

  respawn(at: { x: number; z: number }, lookAt: { x: number; z: number }): void {
    this.teleport(at, lookAt);
    this.health = 100; this.stamina = 100; this.deadT = -1;
    this.combo = 0; this.kick.setAll(0); this.kickT.setAll(0);
    copy(SWORD_REST, this.cur);
    this.vm.setEnabled(true);
  }

  /** Mesh dell'arma in vista (per escluderle da god rays e simili). */
  get viewmodelMeshes(): AbstractMesh[] { return this.vm.getChildMeshes(); }

  private makeChips(): ParticleSystem {
    const ps = new ParticleSystem("chips", 160, this.scene);
    ps.particleTexture = softDotTex(this.scene);
    ps.minSize = 0.015; ps.maxSize = 0.05; ps.minLifeTime = 0.3; ps.maxLifeTime = 0.8;
    ps.colorDead = new Color4(0.2, 0.15, 0.1, 0);
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.emitRate = 0; ps.manualEmitCount = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return ps;
  }

  /** Uno schizzo di particelle (schegge, sangue, scintille) da `at`, attorno alla direzione `dir`. */
  private burst(at: Vector3, dir: Vector3, n: number, c1: Color4, c2: Color4, power = 3, size = 1): void {
    const ps = this.chips;
    ps.emitter = at;
    ps.minSize = 0.015 * size; ps.maxSize = 0.05 * size;
    ps.color1 = c1; ps.color2 = c2;
    ps.direction1 = dir.add(new Vector3(-0.8, 0.4, -0.8));
    ps.direction2 = dir.add(new Vector3(0.8, 1.6, 0.8));
    ps.minEmitPower = power * 0.45; ps.maxEmitPower = power;
    ps.manualEmitCount = n;
  }

  private makeTrail(): Mesh {
    const m = new Mesh("trail", this.scene);
    const idx: number[] = [];
    for (let i = 0; i < TRAIL_N - 1; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const vd = new VertexData();
    vd.positions = this.trailPos; vd.colors = this.trailCol; vd.indices = idx;
    vd.applyToMesh(m, true);
    const mat = new StandardMaterial("trailMat", this.scene);
    mat.emissiveColor = new Color3(1, 1, 1); mat.disableLighting = true; mat.backFaceCulling = false;
    mat.alphaMode = Constants.ALPHA_ADD; mat.fogEnabled = false;
    m.material = mat;
    m.hasVertexAlpha = true;
    m.parent = this.vm;
    m.alwaysSelectAsActiveMesh = true;
    m.setEnabled(false);
    return m;
  }

  /** Aggiorna la scia: mentre la lama colpisce aggiunge un campione, i vecchi svaniscono. */
  private updateTrail(dt: number, active: boolean): void {
    const pts = this.trailPts;
    for (const p of pts) p.age += dt;
    while (pts.length && pts[pts.length - 1].age > TRAIL_LIFE) pts.pop();
    if (active) {
      const b = new Vector3(0, 0.34, 0), t = new Vector3(0, 0.94, 0);
      b.rotateByQuaternionToRef(this.cur.q, b); t.rotateByQuaternionToRef(this.cur.q, t);
      pts.unshift({ b: b.addInPlace(this.cur.p), t: t.addInPlace(this.cur.p), age: 0 });
      if (pts.length > TRAIL_N) pts.pop();
    }
    if (pts.length < 2) { this.trail.setEnabled(false); return; }
    for (let i = 0; i < TRAIL_N; i++) {
      const p = pts[Math.min(i, pts.length - 1)], k = Math.max(0, 1 - p.age / TRAIL_LIFE), a = i < pts.length ? k * k * 0.36 : 0;
      this.trailPos.set([p.b.x, p.b.y, p.b.z, p.t.x, p.t.y, p.t.z], i * 6);
      this.trailCol.set([0.75, 0.82, 1, a * 0.1, 1, 1, 1, a], i * 8);
    }
    this.trail.updateVerticesData(VertexBuffer.PositionKind, this.trailPos);
    this.trail.updateVerticesData(VertexBuffer.ColorKind, this.trailCol);
    this.trail.setEnabled(true);
  }

  freeze(on: boolean): void {
    this.frozen = on;
    if (on) { this.keys.clear(); this.blocking = false; }
  }

  /** La salute, da 0 a 100 (la legge e la rimette il salvataggio). */
  get life(): number { return this.health; }
  set life(v: number) { if (this.alive) this.health = Math.max(1, Math.min(100, v)); }

  /** Una cura (una benedizione, più avanti una pozione). */
  heal(n: number): void { if (this.alive) this.health = Math.min(100, this.health + n); }

  /** Una dormita: salute e vigore pieni. */
  rest(): void { this.health = 100; this.stamina = 100; }

  private bindInput(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas()!;
    addEventListener("keydown", (e) => {
      // il tasto E vale anche da fermi: fa scorrere le righe di un dialogo (chi lo riceve decide cosa farne: main.ts)
      if (this.inputOff) return;
      if (e.code === "KeyE" && !e.repeat && this.locked && this.alive) this.onUse?.();
      if (this.frozen) return;
      this.keys.add(e.code);
      if (e.code === "Space") { e.preventDefault(); this.jump(); }
    });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.blocking = false; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // ⚠️ pointerdown, non mousedown: Babylon fa preventDefault sul pointerdown e il browser allora
    // non emette più i mousedown di compatibilità
    canvas.addEventListener("pointerdown", (e) => {
      if (this.inputOff) return;
      if (!this.locked) { canvas.requestPointerLock(); return; }
      if (this.frozen) return;
      if (e.button === 0) this.attack();
      if (e.button === 2) this.blocking = true;
    });
    addEventListener("pointerup", (e) => { if (e.button === 2) this.blocking = false; });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) { this.keys.clear(); this.blocking = false; }
      this.hud.setPaused(!this.locked);
    });
    addEventListener("mousemove", (e) => {
      if (!this.locked || this.frozen) return;
      const k = 0.0022;
      this.yaw += e.movementX * k;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + e.movementY * k));
      this.sway.x -= e.movementX * 0.00035;
      this.sway.y += e.movementY * 0.00035;
    });
  }

  private spend(n: number): boolean {
    if (this.stamina < n * 0.5) { this.hud.flashStamina(); return false; }
    this.stamina = Math.max(0, this.stamina - n);
    this.staminaWait = 0.9;
    return true;
  }

  private jump(): void {
    if (!this.locked || !this.alive || !this.grounded || !this.spend(12)) return;
    this.vel.y = JUMP_V;
    this.grounded = false;
    this.dipV -= 0.6;
  }

  /** Click d'attacco: parte un colpo, oppure prenota il prossimo della combo. */
  private attack(): void {
    if (!this.alive || this.blocking) return;
    if (this.atk < 0 || (this.phase === "recover" && this.pt > 0.03)) this.begin(this.combo);
    else this.queued = true;
  }

  /** Avvia il colpo `i` dalla posa in cui la lama si trova adesso. */
  private begin(i: number): void {
    const A = ATTACKS[i];
    if (!this.spend(A.cost * this.tune.cost)) { this.atk = -1; this.queued = false; this.combo = 0; return; }
    this.atk = i; this.phase = "windup"; this.pt = 0;
    this.struck = false; this.queued = false;
    this.combo = (i + 1) % ATTACKS.length;
    copy(this.cur, this.from);
    this.kickT.set(...A.pre);
  }

  /** Fa avanzare la macchina a stati del colpo. */
  private stepAttack(dt: number): void {
    if (this.atk < 0) {
      // fuori dalla combo: dopo un attimo si riparte dal primo colpo
      if ((this.comboT += dt) > 0.45) this.combo = 0;
      return;
    }
    this.comboT = 0;
    const A = ATTACKS[this.atk];
    this.pt += dt;
    if (this.phase === "windup" && this.pt >= A.windup) {
      this.phase = "swing"; this.pt = 0;
      this.kickT.set(...A.kick);
      // il passo che accompagna la lama, il fischio, l'aria smossa
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      this.vel.x += sy * A.lunge; this.vel.z += cy * A.lunge;
      sfx.whoosh(A.power > 1);
      this.onGust?.(this.pos.x + sy * 1.4, this.pos.z + cy * 1.4, cy * A.dir[0] + sy * A.dir[1], -sy * A.dir[0] + cy * A.dir[1], 3 + A.power * 1.5);
    } else if (this.phase === "swing") {
      if (this.onSweep) {
        // un fendente spazza da un fianco all'altro, il colpo dall'alto cala dritto davanti: cinque punti lungo la lama
        const side = A.dir[0], a = this.yaw + side * (Math.min(1, this.pt / A.swing) - 0.5) * 1.5, bx = Math.sin(a), bz = Math.cos(a), k = dt * 60 * (0.35 + 0.2 * A.power);
        for (let r = 0.8; r < 2.5; r += 0.4) this.onSweep(this.pos.x + bx * r, this.pos.z + bz * r, side * bz, -side * bx, k);
      }
      if (!this.struck && this.pt >= A.swing * 0.5) { this.struck = true; this.strike(A); }
      if (this.phase === "swing" && this.pt >= A.swing) { this.phase = "hold"; this.pt = 0; this.kickT.setAll(0); }
    } else if (this.phase === "hold" && this.pt >= A.hold) {
      // l'ultimo colpo chiude la combo: dopo si recupera per intero
      if (this.queued && this.atk < ATTACKS.length - 1) this.begin(this.combo);
      else { this.phase = "recover"; this.pt = 0; this.queued = false; copy(this.cur, this.from); }
    } else if (this.phase === "recover" && this.pt >= A.recover) {
      this.atk = -1;
    }
  }

  /** La posa della mano della spada in questo istante. */
  private swordPose(guard: Pose, out: Pose): void {
    if (this.atk < 0) { copy(guard, out); return; }
    const A = ATTACKS[this.atk], t = this.pt;
    if (this.phase === "windup") mix(this.from, A.a, easeOut(Math.min(1, t / A.windup)), out);
    else if (this.phase === "swing") {
      // il colpo accelera: lento a staccarsi dalla carica, velocissimo all'impatto
      const s = Math.pow(Math.min(1, t / A.swing), 1.5);
      if (s < 0.5) mix(A.a, A.b, s * 2, out); else mix(A.b, A.c, (s - 0.5) * 2, out);
    } else if (this.phase === "hold") mix(A.b, A.c, 1 + 0.06 * easeOut(Math.min(1, t / A.hold)), out);   // la lama prosegue ancora un filo
    else mix(this.from, guard, ease(Math.min(1, t / A.recover)), out);
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    if (!this.alive) {
      // morto: la vista crolla a terra e si inclina
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.8);
      this.camera.position.set(this.pos.x, this.pos.y + EYE - (EYE - 0.3) * k * k, this.pos.z);
      this.camera.rotation.set(this.pitch * (1 - k) - 0.3 * k, this.yaw, 0.9 * k);
      this.hud.update({ yaw: this.yaw, stamina: this.stamina, health: 0, pos: this.pos });
      return;
    }
    if ((this.hurtWait -= dt) <= 0) this.health = Math.min(100, this.health + 2 * dt);
    const k = (c: string): number => (this.keys.has(c) ? 1 : 0);
    const fwd = k("KeyW") - k("KeyS"), str = k("KeyD") - k("KeyA");
    const moving = fwd !== 0 || str !== 0;
    const running = moving && this.keys.has("ShiftLeft") && !this.blocking && fwd > 0 && this.stamina > 1;
    const speed = (this.blocking ? BLOCK_SPEED : running ? RUN : WALK) * this.tune.speed;
    if (running && this.grounded) { this.stamina = Math.max(0, this.stamina - 16 * dt); this.staminaWait = 0.9; }

    // movimento orizzontale: accelerazione morbida a terra, poco controllo in aria
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const wish = new Vector3(sy * fwd + cy * str, 0, cy * fwd - sy * str);
    if (wish.lengthSquared() > 0) wish.normalize().scaleInPlace(speed);
    const acc = this.grounded ? 14 : 2.5;
    this.vel.x += (wish.x - this.vel.x) * Math.min(1, acc * dt);
    this.vel.z += (wish.z - this.vel.z) * Math.min(1, acc * dt);
    this.vel.y -= GRAVITY * dt;
    this.pos.addInPlace(this.vel.scale(dt));

    // collisioni: spinta fuori dagli ostacoli vicini (cerchi o segmenti, nella loro fascia d'altezza), e i bordi del mondo
    for (const c of this.colliders) {
      if (!blocks(c, this.pos.y)) continue;
      nearest(c, this.pos.x, this.pos.z, NEAR);
      const dx = this.pos.x - NEAR.x, dz = this.pos.z - NEAR.z;
      const min = c.r + RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x = NEAR.x + dx / d * min; this.pos.z = NEAR.z + dz / d * min;
      }
    }
    const lim = HALF - 12;
    this.pos.x = Math.max(-lim, Math.min(lim + EAST, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));

    // soffitti: chi salta sotto un solaio ci batte la testa
    if (this.vel.y > 0 && this.ceiling) {
      const top = this.ceiling(this.pos.x, this.pos.z, this.pos.y - this.vel.y * dt) - BODY;
      if (this.pos.y > top) { this.pos.y = top; this.vel.y = 0; }
    }
    // il suolo è la superficie più alta sotto i piedi: terreno, solai, rampe di scale
    const gy = this.ground(this.pos.x, this.pos.z, this.pos.y);
    if (this.pos.y <= gy) {
      if (!this.grounded) {
        const impact = Math.min(1, -this.vel.y / 14);
        this.dipV -= 0.5 + impact * 1.6;
        this.shake = Math.max(this.shake, impact * 0.5);
      }
      this.pos.y = gy; this.vel.y = 0; this.grounded = true;
    } else if (this.pos.y > gy + 0.25 || this.vel.y > 0) {
      this.grounded = false;
    } else if (this.vel.y <= 0) {
      this.pos.y = gy; this.vel.y = 0;   // in discesa su un pendio resta incollato al terreno
    }

    // stamina
    this.staminaWait -= dt;
    if (this.staminaWait <= 0) this.stamina = Math.min(100, this.stamina + 24 * dt);

    // attacco: l'hit-stop ferma per un istante la lama (e solo lei) quando il colpo va a segno
    if (this.hitStop > 0) this.hitStop -= dt; else this.stepAttack(dt);

    // camera: occhi, dondolio del passo, scossa, torsione del colpo
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const bobTarget = this.grounded ? Math.min(1, hs / WALK) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 8);
    this.bobPhase += hs * dt * (running ? 1.45 : 1.75);
    // molla del "tuffo" (salto/atterraggio)
    this.dipV += (-this.dip * 90 - this.dipV * 14) * dt;
    this.dip += this.dipV * dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake;
    if (this.atk < 0 || this.phase === "recover") this.kickT.setAll(0);
    Vector3.LerpToRef(this.kick, this.kickT, Math.min(1, dt * 20), this.kick);
    this.fovKick *= Math.exp(-dt * 9);
    this.camera.fov = FOV + this.fovKick;
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmt * (running ? 1.4 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.025 * this.bobAmt;
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY + this.dip * 0.06, this.pos.z);
    this.camera.rotation.set(
      this.pitch + this.kick.x + (Math.random() - 0.5) * sh * 0.03 + this.dip * 0.02,
      this.yaw + this.kick.y + (Math.random() - 0.5) * sh * 0.03,
      this.kick.z + bobX * 0.15 + this.sway.x * 0.5);

    // viewmodel: sway verso il mouse (molla), dondolio, peso del salto
    this.sway.x *= Math.exp(-dt * 9); this.sway.y *= Math.exp(-dt * 9);
    this.sway.x = Math.max(-0.06, Math.min(0.06, this.sway.x)); this.sway.y = Math.max(-0.06, Math.min(0.06, this.sway.y));
    const t = performance.now() / 1000;
    const breathe = Math.sin(t * 1.6) * 0.004;
    const jitter = this.hitStop > 0 ? 0.006 : 0;
    this.vm.position.set(this.sway.x + bobX * 0.5 + (Math.random() - 0.5) * jitter,
      this.sway.y + breathe - Math.abs(Math.sin(this.bobPhase)) * 0.02 * this.bobAmt + this.dip * 0.08 + (Math.random() - 0.5) * jitter, 0);
    this.vm.rotation.set(this.sway.y * 1.5, -this.sway.x * 1.5, 0);

    // parata: lo scudo sale con una molla (un filo di rimbalzo); durante un colpo resta giù
    const want = this.blocking && (this.atk < 0 || this.phase === "recover") ? 1 : 0;
    this.blockV += ((want - this.blockW) * 260 - this.blockV * 25) * dt;
    this.blockW += this.blockV * dt;
    const bw = this.blockW;
    this.atkW += ((this.atk >= 0 && this.phase !== "recover" ? 1 : 0) - this.atkW) * Math.min(1, dt * 12);

    // mano della spada
    mix(SWORD_REST, SWORD_GUARD, bw, this.tmp);
    this.swordPose(this.tmp, this.cur);
    this.swordHand.position.copyFrom(this.cur.p);
    this.swordHand.position.y += Math.sin(t * 1.1) * 0.003;
    this.swordHand.rotationQuaternion!.copyFrom(this.cur.q);
    this.sword.rotation.y = this.cur.roll;
    this.updateTrail(dt, this.atk >= 0 && (this.phase === "swing" || this.phase === "hold"));

    // mano dello scudo: riposo/parata; si scansa mentre la spada colpisce; un morso parato la ributta indietro
    mix(SHIELD_REST, SHIELD_BLOCK, bw, this.tmp);
    this.shieldKick = Math.max(0, this.shieldKick - dt * 4.5);
    const sk = Math.sin(this.shieldKick * Math.PI);
    this.tmp.p.z -= sk * 0.09 + this.atkW * 0.05;
    this.tmp.p.x -= this.atkW * 0.07;
    this.tmp.p.y -= sk * 0.03 + this.atkW * 0.03;
    this.shieldHand.position.copyFrom(this.tmp.p);
    this.shieldHand.rotationQuaternion!.copyFrom(this.tmp.q);
    this.shieldHand.rotationQuaternion!.multiplyInPlace(Quaternion.RotationAxis(Vector3.Right(), -sk * 0.22));

    this.hud.update({ yaw: this.yaw, stamina: this.stamina, health: this.health, pos: this.pos });
  }

  /** L'impatto del colpo: prima i nemici nell'arco, altrimenti il primo tronco o masso davanti. */
  private strike(A: Attack): void {
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw), [lr, lu, lf] = A.launch;
    const dir = new Vector3(sy, 0, cy);
    // la spinta del colpo nel mondo: dallo spazio di chi guarda (destra, su, avanti)
    const hits = this.combat?.strike(this.pos, dir, REACH, A.dmg, A.arc, A.power, new Vector3(cy * lr + sy * lf, lu, -sy * lr + cy * lf)) ?? [];
    if (hits.length) {
      const kill = hits.some((h) => h.killed), heavy = kill || A.power > 1;
      // sangue: gocce piccole e scure (in HDR un rosso pieno diventa una lampadina)
      this.burst(hits[0].point, dir, heavy ? 60 : 30, new Color4(0.16, 0.006, 0.006, 1), new Color4(0.07, 0.003, 0.003, 1), heavy ? 4.5 : 3, 0.6);
      // il tempo si ferma un istante sul bersaglio, la vista prende il contraccolpo
      this.hitStop = heavy ? 0.11 : 0.065;
      this.shake = Math.max(this.shake, heavy ? 0.75 : 0.5);
      this.kick.x += heavy ? 0.03 : 0.012;
      if (heavy) this.fovKick = -0.05;
      sfx.hit(heavy);
      this.hud.hitMarker(kill);
      return;
    }
    let best: Collider | null = null, bestD = Infinity, bx = 0, bz = 0;
    for (const c of this.colliders) {
      if (c.soft || !blocks(c, this.pos.y)) continue;
      nearest(c, this.pos.x, this.pos.z, NEAR);
      const dx = NEAR.x - this.pos.x, dz = NEAR.z - this.pos.z;
      const along = dx * dir.x + dz * dir.z;
      const d = Math.hypot(dx, dz) - c.r;
      if (along > 0 && d < REACH - 0.7 && d < bestD && Math.abs(dx * dir.z - dz * dir.x) < c.r + 0.5) { best = c; bestD = d; bx = NEAR.x; bz = NEAR.z; }
    }
    if (!best) return;
    // legno o pietra: schegge, e la lama rimbalza indietro (la combo si spezza)
    const toP = new Vector3(this.pos.x - bx, 0, this.pos.z - bz).normalize();
    this.burst(new Vector3(bx + toP.x * best.r, this.camera.position.y - 0.25, bz + toP.z * best.r), toP, 24,
      new Color4(0.55, 0.42, 0.28, 1), new Color4(0.35, 0.27, 0.18, 1));
    this.shake = Math.max(this.shake, 0.55);
    this.hitStop = 0.05;
    sfx.thud();
    this.phase = "recover"; this.pt = 0; this.queued = false; this.combo = 0;
    copy(this.cur, this.from);
    this.kickT.setAll(0);
  }
}
