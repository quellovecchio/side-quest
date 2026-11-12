import { Color3, Particle, ParticleSystem, RawTexture, Scene, Texture, Vector3 } from "@babylonjs/core";
import { fbm2, smoothstep } from "./noise";

// ─────────────────────────────────────────────────────────────────────────────
// FOSCHIA A TERRA — banchi bassi che reagiscono a chi li attraversa.
//
// Qualche centinaio di falde morbide attorno al giocatore, simulate una per una. Sono billboard
// larghi e bassi (FLAT) col bordo inferiore appena sopra il suolo: un billboard quadrato entra nel
// terreno e il taglio si vede come una riga netta.
//   · derivano col vento e ristagnano a chiazze, più fitte dove il terreno è basso;
//   · chi si muove (giocatore, lupi, ratti) le sposta: le spinge di lato, se le trascina dietro
//     e le solleva, lasciando un varco che il vento richiude piano;
//   · un soffio (`gust`: il fendente della spada, un corpo che si disfa) le scaglia via;
//   · poi rallentano, tornano alla deriva del vento e ridiscendono alla loro quota.
// Le falde che escono dal raggio rientrano dal lato opposto: il banco segue il giocatore.
//
// ponytail: fisica per falda sulla CPU (N × chi si muove, per frame). Per una nebbia che riempia
// tutta la valle o reagisca a centinaia di corpi serve un campo di velocità su griglia (GPU).
// ─────────────────────────────────────────────────────────────────────────────

export interface Mover { x: number; z: number; vx: number; vz: number; r: number }

const COUNT = 520, RADIUS = 27, FLAT = 0.3;

type Wisp = Particle & { ok?: boolean; vx: number; vz: number; lift: number; rest: number; a0: number; s0: number; seed: number };

/** Falda di nebbia: un alone che sfuma, sfilacciato dal rumore. */
function wispTex(scene: Scene): Texture {
  const S = 128, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S - 0.5, v = y / S - 0.5, r = Math.hypot(u, v) * 2;
    const n = fbm2(x / 22, y / 22, 4, 77) * 0.5 + 0.5;
    const a = Math.pow(Math.max(0, 1 - r * r), 1.6) * smoothstep(0.15, 0.75, n * (1.25 - r * 0.5));
    const i = (y * S + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = a * 255;
  }
  const t = RawTexture.CreateRGBATexture(data, S, S, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.hasAlpha = true;
  return t;
}

export class Mist {
  private ps: ParticleSystem;
  private center = new Vector3();
  private eye = new Vector3();
  private movers: Mover[] = [];
  private gusts: { x: number; z: number; dx: number; dz: number; str: number; r: number }[] = [];
  private dt = 0;
  private time = 0;
  private on = true;
  /** Dove non deve stare (dentro gli edifici: sopra c'è un pavimento). */
  covered: ((x: number, z: number) => boolean) | null = null;

  /** `alpha` = quanto è fitta: la cambia l'ora (main.ts: più fitta all'alba). */
  constructor(scene: Scene, private ground: (x: number, z: number) => number, color: Color3, public alpha: number) {
    const ps = new ParticleSystem("mist", COUNT, scene);
    ps.particleTexture = wispTex(scene);
    ps.emitter = this.center;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minLifeTime = ps.maxLifeTime = 1e9;
    ps.emitRate = 0;
    ps.manualEmitCount = COUNT;
    ps.color1.set(color.r, color.g, color.b, 0); ps.color2.copyFrom(ps.color1); ps.colorDead.copyFrom(ps.color1);
    ps.startPositionFunction = (_w, pos) => {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * RADIUS;
      pos.set(this.center.x + Math.cos(a) * r, this.center.y, this.center.z + Math.sin(a) * r);
    };
    ps.updateFunction = (particles) => this.simulate(particles as Wisp[], color);
    ps.start();
    this.ps = ps;
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) { this.ps.manualEmitCount = COUNT; this.ps.start(); } else { this.ps.stop(); this.ps.reset(); }
  }

  /** Un soffio: scaglia le falde entro `r` metri lungo (dx, dz) e via dal centro. */
  gust(x: number, z: number, dx: number, dz: number, str: number, r: number): void {
    if (this.on) this.gusts.push({ x, z, dx, dz, str, r });
  }

  /** Una volta per frame, prima del render: dove sta il giocatore e chi si muove. */
  update(dt: number, eye: Vector3, movers: Mover[]): void {
    this.dt = Math.min(dt, 0.05);
    this.time += this.dt;
    this.eye.copyFrom(eye);
    this.center.set(eye.x, eye.y, eye.z);
    this.movers = movers;
  }

  private simulate(ps: Wisp[], color: Color3): void {
    const dt = this.dt, t = this.time, c = this.center;
    // il vento: una deriva lenta che respira
    const wx = 0.4 + 0.2 * Math.sin(t * 0.21), wz = 0.22 + 0.15 * Math.cos(t * 0.17);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.ok) {
        p.ok = true;
        p.vx = wx; p.vz = wz; p.lift = 0;
        p.rest = 0.04 + Math.random() * 0.5;
        p.a0 = 0.5 + Math.random() * 0.5; p.s0 = 3.2 + Math.random() * 3.2;
        p.seed = Math.random() * 100;
        p.angle = 0; p.scale.set(1, FLAT);
      }
      const x = p.position.x, z = p.position.z;
      // chi si muove: spinta di lato, trascinamento nella scia, e la falda si alza
      for (const m of this.movers) {
        const dx = x - m.x, dz = z - m.z, R = m.r + 1.7, d2 = dx * dx + dz * dz;
        if (d2 > R * R) continue;
        const d = Math.sqrt(d2) || 1e-3, f = (1 - d / R) ** 2, sp = Math.hypot(m.vx, m.vz);
        const k = f * dt * 7;
        p.vx += (dx / d * (sp * 0.9 + 0.5) + m.vx * 0.7) * k;
        p.vz += (dz / d * (sp * 0.9 + 0.5) + m.vz * 0.7) * k;
        p.lift += sp * f * dt * 0.55;
      }
      for (const g of this.gusts) {
        const dx = x - g.x, dz = z - g.z, d2 = dx * dx + dz * dz;
        if (d2 > g.r * g.r) continue;
        const d = Math.sqrt(d2) || 1e-3, f = 1 - d / g.r;
        p.vx += (g.dx + dx / d * 0.6) * g.str * f;
        p.vz += (g.dz + dz / d * 0.6) * g.str * f;
        p.lift += g.str * 0.12 * f;
      }
      // torna alla deriva del vento, con un po' di turbolenza
      const back = Math.min(1, dt * 0.9);
      p.vx += (wx + Math.sin(z * 0.21 + t * 0.4 + p.seed) * 0.18 - p.vx) * back;
      p.vz += (wz + Math.cos(x * 0.19 - t * 0.33 + p.seed) * 0.18 - p.vz) * back;
      p.lift *= Math.exp(-dt * 0.55);
      let nx = x + p.vx * dt, nz = z + p.vz * dt;
      // fuori dal raggio rientra dal lato opposto, in quiete
      let dx = nx - c.x, dz = nz - c.z, dist = Math.hypot(dx, dz);
      if (dist > RADIUS) {
        nx = c.x - dx / dist * RADIUS * 0.97; nz = c.z - dz / dist * RADIUS * 0.97;
        p.vx = wx; p.vz = wz; p.lift = 0;
        dx = nx - c.x; dz = nz - c.z; dist = RADIUS * 0.97;
      }
      const gy = this.ground(nx, nz);
      p.position.set(nx, gy + p.s0 * FLAT * 0.5 + p.rest + p.lift, nz);
      // a chiazze, più fitta nelle conche; sfuma al bordo del banco e addosso a chi guarda
      const patch = smoothstep(0.3, 0.62, fbm2(nx / 19, nz / 19, 2, 404) * 0.5 + 0.5) * (0.55 + 0.45 * smoothstep(5, -3, gy));
      const edge = 1 - smoothstep(RADIUS * 0.62, RADIUS * 0.96, dist);
      const near = smoothstep(1.0, 3.2, Math.hypot(nx - this.eye.x, gy + p.rest - this.eye.y, nz - this.eye.z));
      const stir = 1 / (1 + p.lift * 0.9);
      p.color.set(color.r, color.g, color.b, this.covered?.(nx, nz) ? 0 : this.alpha * p.a0 * patch * edge * near * stir);
      p.size = p.s0 * (1 + p.lift * 0.5);
    }
    this.gusts.length = 0;
  }
}
