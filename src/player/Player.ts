import { AbstractMesh, BaseTexture, Color4, FreeCamera, ParticleSystem, Quaternion, Scene, Texture, TransformNode, Vector3, DynamicTexture } from "@babylonjs/core";
import type { Collider } from "../world/vegetation";
import { HALF } from "../world/terrain";
import { buildArm, buildShield, buildSword } from "./equipment";
import type { Hud } from "../hud";

// ─────────────────────────────────────────────────────────────────────────────
// GIOCATORE — prima persona alla Elder Scrolls.
//   WASD muoversi · Shift correre · Spazio saltare · Click sinistro attaccare
//   Click destro (tenuto) parare con lo scudo.
// Fisica fatta a mano: gravità, quota del terreno, collisioni a cerchi coi tronchi
// e le rocce. L'arma in vista (viewmodel) è figlia della camera, disegnata in un
// rendering group suo (non entra nei tronchi) e animata a pose interpolate.
// ─────────────────────────────────────────────────────────────────────────────

const EYE = 1.68;
const WALK = 4.2, RUN = 7.4, BLOCK_SPEED = 2.4;
const GRAVITY = 22, JUMP_V = 7.4;
const RADIUS = 0.35;
const REACH = 2.3;

// Una posa della mano: posizione nello spazio camera (m, +Z avanti) e dove punta la lama (+Y locale;
// per lo scudo, il suo "su"). Il pugno guarda via dalla spalla (+Z locale): così l'avambraccio, che
// esce dal pugno lungo −Z, torna sempre verso la spalla. Lo scudo passa `fwd` (+Z = la faccia con l'umbone).
interface Pose { p: Vector3; q: Quaternion }
const SHOULDER_R = new Vector3(0.24, -0.5, -0.15);
function pose(p: [number, number, number], up: [number, number, number], fwd?: [number, number, number]): Pose {
  const Y = new Vector3(...up).normalize();
  const f = fwd ? new Vector3(...fwd) : new Vector3(...p).subtract(SHOULDER_R);
  const Z = f.subtract(Y.scale(Vector3.Dot(f, Y))).normalize();
  const X = Vector3.Cross(Y, Z);
  return { p: new Vector3(...p), q: Quaternion.RotationQuaternionFromAxis(X, Y, Z) };
}

// mano destra (spada)
const SWORD_REST = pose([0.3, -0.34, 0.56], [-0.22, 0.9, 0.38]);
const SWORD_BLOCK = pose([0.36, -0.44, 0.46], [-0.55, 0.6, 0.55]);
// fendente da destra a sinistra, poi da sinistra a destra (combo alternata)
const SLASH_A = [
  { t: 0, pose: SWORD_REST },
  { t: 0.16, pose: pose([0.34, -0.04, 0.5], [0.45, 0.85, -0.25]) },
  { t: 0.3, pose: pose([-0.2, -0.25, 0.62], [-0.8, -0.25, 0.55]) },
  { t: 0.62, pose: SWORD_REST },
];
const SLASH_B = [
  { t: 0, pose: SWORD_REST },
  { t: 0.16, pose: pose([-0.04, -0.06, 0.5], [-0.6, 0.75, -0.2]) },
  { t: 0.3, pose: pose([0.36, -0.27, 0.62], [0.75, -0.3, 0.6]) },
  { t: 0.62, pose: SWORD_REST },
];
const HIT_T = 0.23;
// mano sinistra (scudo): a riposo quasi fuori campo, in parata davanti al petto
const SHIELD_REST = pose([-0.56, -0.58, 0.62], [0.1, 1, 0], [0.4, 0, 1]);
const SHIELD_BLOCK = pose([-0.13, -0.16, 0.5], [0.05, 1, 0], [0.12, 0.08, 1]);

const ease = (t: number): number => t * t * (3 - 2 * t);
function lerpPose(a: Pose, b: Pose, t: number, out: { p: Vector3; q: Quaternion }): void {
  Vector3.LerpToRef(a.p, b.p, t, out.p);
  Quaternion.SlerpToRef(a.q, b.q, t, out.q);
}

export class Player {
  readonly camera: FreeCamera;
  private pos: Vector3;
  private vel = new Vector3();
  private yaw = 0;
  private pitch = 0;
  private grounded = true;
  private keys = new Set<string>();
  private blocking = false;
  private attackT = -1;
  private attackSide = 0;
  private hitDone = false;
  private queued = false;
  private stamina = 100;
  private staminaWait = 0;
  private bobPhase = 0;
  private bobAmt = 0;
  private sway = { x: 0, y: 0 };
  private dip = 0;
  private dipV = 0;
  private shake = 0;
  private blockW = 0;
  private swordHand: TransformNode;
  private shieldHand: TransformNode;
  private vm: TransformNode;
  private chips: ParticleSystem;
  private tmp = { p: new Vector3(), q: new Quaternion() };
  locked = false;

  constructor(private scene: Scene, private ground: (x: number, z: number) => number,
    private colliders: Collider[], env: BaseTexture, private hud: Hud, spawn: { x: number; z: number }, lookAt: { x: number; z: number }) {
    this.pos = new Vector3(spawn.x, ground(spawn.x, spawn.z), spawn.z);
    this.yaw = Math.atan2(lookAt.x - spawn.x, lookAt.z - spawn.z);
    const cam = new FreeCamera("player", this.pos.add(new Vector3(0, EYE, 0)), scene);
    cam.minZ = 0.05; cam.maxZ = 1200; cam.fov = 1.05;
    cam.inputs.clear();
    this.camera = cam;

    // viewmodel: figlio della camera, gruppo 1 (profondità pulita: la lama non entra nei tronchi)
    this.vm = new TransformNode("viewmodel", scene);
    this.vm.parent = cam;
    this.swordHand = buildArm(scene, "rightArm", false);
    const sword = buildSword(scene, env);
    sword.parent = this.swordHand;
    this.swordHand.parent = this.vm;
    this.shieldHand = buildArm(scene, "leftArm", true);
    const shield = buildShield(scene, env);
    shield.parent = this.shieldHand;
    shield.position.set(0, 0, 0.07);   // impugnatura centrale: il pugno sta dietro l'umbone
    this.shieldHand.parent = this.vm;
    for (const m of this.vm.getChildMeshes()) { m.renderingGroupId = 1; m.isPickable = false; m.receiveShadows = true; }

    this.chips = this.makeChips();
    this.bindInput();
  }

  /** Mesh dell'arma in vista (per escluderle da god rays e simili). */
  get viewmodelMeshes(): AbstractMesh[] { return this.vm.getChildMeshes(); }

  private makeChips(): ParticleSystem {
    const tex = new DynamicTexture("chipTex", 32, this.scene, false);
    const ctx = tex.getContext() as CanvasRenderingContext2D;
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32); tex.hasAlpha = true; tex.update();
    const ps = new ParticleSystem("chips", 80, this.scene);
    ps.particleTexture = tex as unknown as Texture;
    ps.minSize = 0.015; ps.maxSize = 0.05; ps.minLifeTime = 0.3; ps.maxLifeTime = 0.8;
    ps.color1 = new Color4(0.55, 0.42, 0.28, 1); ps.color2 = new Color4(0.35, 0.27, 0.18, 1); ps.colorDead = new Color4(0.2, 0.15, 0.1, 0);
    ps.gravity = new Vector3(0, -9.8, 0);
    ps.minEmitPower = 1.5; ps.maxEmitPower = 3.5;
    ps.emitRate = 0; ps.manualEmitCount = 0;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.start();
    return ps;
  }

  private bindInput(): void {
    const canvas = this.scene.getEngine().getRenderingCanvas()!;
    addEventListener("keydown", (e) => { this.keys.add(e.code); if (e.code === "Space") { e.preventDefault(); this.jump(); } });
    addEventListener("keyup", (e) => this.keys.delete(e.code));
    addEventListener("blur", () => { this.keys.clear(); this.blocking = false; });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    // ⚠️ pointerdown, non mousedown: Babylon fa preventDefault sul pointerdown e il browser allora
    // non emette più i mousedown di compatibilità
    canvas.addEventListener("pointerdown", (e) => {
      if (!this.locked) { canvas.requestPointerLock(); return; }
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
      if (!this.locked) return;
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
    if (!this.locked || !this.grounded || !this.spend(12)) return;
    this.vel.y = JUMP_V;
    this.grounded = false;
    this.dipV -= 0.6;
  }

  private attack(): void {
    if (this.blocking) return;
    if (this.attackT >= 0) { if (this.attackT > HIT_T) this.queued = true; return; }
    if (!this.spend(10)) return;
    this.attackT = 0;
    this.hitDone = false;
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    const k = (c: string): number => (this.keys.has(c) ? 1 : 0);
    const fwd = k("KeyW") - k("KeyS"), str = k("KeyD") - k("KeyA");
    const moving = fwd !== 0 || str !== 0;
    const running = moving && this.keys.has("ShiftLeft") && !this.blocking && fwd > 0 && this.stamina > 1;
    const speed = this.blocking ? BLOCK_SPEED : running ? RUN : WALK;
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

    // collisioni: spinta fuori dai cerchi vicini, e i bordi della conca
    for (const c of this.colliders) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const min = c.r + RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x = c.x + dx / d * min; this.pos.z = c.z + dz / d * min;
      }
    }
    const lim = HALF - 12;
    this.pos.x = Math.max(-lim, Math.min(lim, this.pos.x));
    this.pos.z = Math.max(-lim, Math.min(lim, this.pos.z));

    const gy = this.ground(this.pos.x, this.pos.z);
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

    // attacco
    if (this.attackT >= 0) {
      this.attackT += dt * (this.queued ? 1.15 : 1);
      if (!this.hitDone && this.attackT >= HIT_T) { this.hitDone = true; this.strike(); }
      const end = SLASH_A[SLASH_A.length - 1].t;
      if (this.attackT >= end || (this.queued && this.attackT >= 0.42)) {
        this.attackSide ^= 1;
        this.attackT = -1;
        if (this.queued && this.spend(10)) { this.attackT = 0; this.hitDone = false; }
        this.queued = false;
      }
    }

    // camera: occhi, dondolio del passo, scossa
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const bobTarget = this.grounded ? Math.min(1, hs / WALK) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 8);
    this.bobPhase += hs * dt * (running ? 1.45 : 1.75);
    // molla del "tuffo" (salto/atterraggio)
    this.dipV += (-this.dip * 90 - this.dipV * 14) * dt;
    this.dip += this.dipV * dt;
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const sh = this.shake * this.shake;
    const bobY = Math.sin(this.bobPhase * 2) * 0.045 * this.bobAmt * (running ? 1.4 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.025 * this.bobAmt;
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY + this.dip * 0.06, this.pos.z);
    this.camera.rotation.set(this.pitch + (Math.random() - 0.5) * sh * 0.03 + this.dip * 0.02, this.yaw + (Math.random() - 0.5) * sh * 0.03,
      bobX * 0.15 + this.sway.x * 0.5);

    // viewmodel: sway verso il mouse (molla), dondolio, peso del salto
    this.sway.x *= Math.exp(-dt * 9); this.sway.y *= Math.exp(-dt * 9);
    this.sway.x = Math.max(-0.06, Math.min(0.06, this.sway.x)); this.sway.y = Math.max(-0.06, Math.min(0.06, this.sway.y));
    const t = performance.now() / 1000;
    const breathe = Math.sin(t * 1.6) * 0.004;
    this.vm.position.set(this.sway.x + bobX * 0.5, this.sway.y + breathe - Math.abs(Math.sin(this.bobPhase)) * 0.02 * this.bobAmt + this.dip * 0.08, 0);
    this.vm.rotation.set(this.sway.y * 1.5, -this.sway.x * 1.5, 0);

    this.blockW += ((this.blocking ? 1 : 0) - this.blockW) * Math.min(1, dt * 14);
    const bw = ease(this.blockW);
    // mano della spada: riposo/parata, poi il fendente sopra
    lerpPose(SWORD_REST, SWORD_BLOCK, bw, this.tmp);
    if (this.attackT >= 0) {
      const keys = this.attackSide ? SLASH_B : SLASH_A;
      let i = 0;
      while (i < keys.length - 2 && this.attackT > keys[i + 1].t) i++;
      const a = keys[i], b = keys[i + 1];
      const u = Math.min(1, (this.attackT - a.t) / (b.t - a.t));
      // il colpo vero (carica → fine fendente) è veloce al centro, le altre fasi morbide
      lerpPose(a.pose, b.pose, i === 1 ? u * u * (3 - 2 * u) * 0.6 + u * 0.4 : ease(u), this.tmp);
    }
    this.swordHand.position.copyFrom(this.tmp.p);
    (this.swordHand.rotationQuaternion ??= new Quaternion()).copyFrom(this.tmp.q);
    lerpPose(SHIELD_REST, SHIELD_BLOCK, bw, this.tmp);
    this.shieldHand.position.copyFrom(this.tmp.p);
    (this.shieldHand.rotationQuaternion ??= new Quaternion()).copyFrom(this.tmp.q);

    this.hud.update({ yaw: this.yaw, stamina: this.stamina, pos: this.pos });
  }

  /** Il colpo: il primo tronco o masso davanti, entro la portata, schizza schegge. */
  private strike(): void {
    const dir = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    let best: Collider | null = null, bestD = Infinity;
    for (const c of this.colliders) {
      const dx = c.x - this.pos.x, dz = c.z - this.pos.z;
      const along = dx * dir.x + dz * dir.z;
      const d = Math.hypot(dx, dz) - c.r;
      if (along > 0 && d < REACH - 0.6 && d < bestD && Math.abs(dx * dir.z - dz * dir.x) < c.r + 0.6) { best = c; bestD = d; }
    }
    if (!best) return;
    const toP = new Vector3(this.pos.x - best.x, 0, this.pos.z - best.z).normalize();
    this.chips.emitter = new Vector3(best.x + toP.x * best.r, this.camera.position.y - 0.25, best.z + toP.z * best.r);
    this.chips.direction1 = toP.add(new Vector3(-0.6, 0.6, -0.6));
    this.chips.direction2 = toP.add(new Vector3(0.6, 1.4, 0.6));
    this.chips.manualEmitCount = 24;
    this.shake = Math.max(this.shake, 0.45);
    this.attackT = Math.max(this.attackT, HIT_T + 0.04);   // il rinculo: la lama si ferma un attimo sul bersaglio
  }
}
