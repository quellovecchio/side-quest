import { Color3, Particle, ParticleSystem, RawTexture, Scene, Texture, Vector3 } from "@babylonjs/core";
import { fbm2, smoothstep } from "./noise";

// ─────────────────────────────────────────────────────────────────────────────
// FOSCHIA A TERRA — una polvere bassa che si posa sul suolo e si comporta come un liquido finto.
//
// Non sono più falde sciolte: è un CAMPO su una griglia ancorata al mondo (una maglia di vertici a
// passo `C` attorno a chi guarda, che scorre con lui). Ogni vertice ha quanta foschia c'è (`rho`),
// quanta ce ne dovrebbe essere a riposo (`rest`: le chiazze, più fitte nelle conche), una velocità e
// quanto è sollevata. A ogni frame:
//   · chi si muove e i soffi (il fendente della spada, un corpo che cade) danno velocità ai vertici vicini;
//   · la foschia SCORRE da un vertice ai suoi vicini lungo quella velocità (un flusso che conserva la
//     quantità: quella che lascia un vertice arriva al vicino), quindi si ammucchia davanti alla spinta
//     e lascia un varco dietro;
//   · dove ce n'è più di quanta ne spetta, spinge verso dove ce n'è meno (come l'acqua bassa che si
//     livella): il mucchio si allarga in un'onda, il varco si richiude da fuori verso dentro, da tutti
//     i lati, e non "riappare";
//   · la velocità si spegne piano e ciò che resta di differenza torna lentamente a riposo.
// Si disegna con una particella per vertice, bassa e larga, posata sul terreno: quanto è opaca e
// grande lo dice `rho`, e scivola dalla parte verso cui sta scorrendo. Ciò che distingue una
// particella (scarto, misura, grana) viene dalla cella del MONDO in cui sta, non dal suo numero:
// quando la griglia scorre l'immagine non salta.
//
// `density` e `weight` si regolano dal menu: quanta ce n'è, e quanto è pesante (pesante = si sposta
// meno, si alza meno, si ricompone prima; leggera = vola via e ci mette di più a tornare).
//
// ponytail: flusso "a monte" del primo ordine sulla CPU (2300 vertici): diffonde un po' da sé, e va
// bene (è fumo). Per una valle intera o centinaia di corpi serve la stessa cosa su GPU.
// ─────────────────────────────────────────────────────────────────────────────

export interface Mover { x: number; z: number; vx: number; vz: number; r: number }

// (maglia fitta: il taglio di una lama è largo un metro, e deve vedersi)
const N = 64, C = 0.8, COUNT = N * N, RADIUS = N * C / 2, FLAT = 0.24;
/** Quanto forte la foschia in più spinge verso dove ce n'è meno (la velocità dell'onda è circa la sua radice, in m/s). */
const PRESS = 3.5;

type Mote = Particle & { ok?: boolean };

/** La grana di una particella: un alone morbido, appena sfilacciato dal rumore. */
function moteTex(scene: Scene): Texture {
  const S = 128, data = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S - 0.5, v = y / S - 0.5, r = Math.hypot(u, v) * 2;
    const n = fbm2(x / 26, y / 26, 4, 77) * 0.5 + 0.5;
    const a = Math.pow(Math.max(0, 1 - r * r), 2.1) * (0.55 + 0.45 * smoothstep(0.2, 0.8, n));
    const i = (y * S + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = a * 255;
  }
  const t = RawTexture.CreateRGBATexture(data, S, S, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.hasAlpha = true;
  return t;
}

/** Un numero fra 0 e 1 che dipende solo dalla cella del mondo. */
const hash = (cx: number, cz: number, k: number): number => { const s = Math.sin(cx * 12.9898 + cz * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };

export class Mist {
  private ps: ParticleSystem;
  private center = new Vector3();
  private eye = new Vector3();
  private movers: Mover[] = [];
  private gusts: { x: number; z: number; dx: number; dz: number; str: number; r: number }[] = [];
  private dt = 0;
  private time = 0;
  private on = true;
  // il campo: quanta, quanta a riposo, velocità, sollevamento, quota del suolo, coperto da un tetto; e l'angolo della griglia nel mondo (in celle)
  private rho = new Float32Array(COUNT); private rest = new Float32Array(COUNT); private vx = new Float32Array(COUNT); private vz = new Float32Array(COUNT);
  private lift = new Float32Array(COUNT); private gy = new Float32Array(COUNT); private cov = new Uint8Array(COUNT); private flow = new Float32Array(COUNT);
  private ox = 1e9; private oz = 1e9;
  /** Quanta ce n'è e quanto pesa (dal menu). */
  density = 1; weight = 1;
  /** Dove non deve stare (dentro gli edifici: sopra c'è un pavimento). */
  covered: ((x: number, z: number) => boolean) | null = null;

  /** `alpha` = quanto è fitta: la cambia l'ora (main.ts: più fitta all'alba). */
  constructor(scene: Scene, private ground: (x: number, z: number) => number, color: Color3, public alpha: number) {
    const ps = new ParticleSystem("mist", COUNT, scene);
    ps.particleTexture = moteTex(scene);
    ps.emitter = this.center;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.minLifeTime = ps.maxLifeTime = 1e9;
    ps.emitRate = 0;
    ps.manualEmitCount = COUNT;
    ps.color1.set(color.r, color.g, color.b, 0); ps.color2.copyFrom(ps.color1); ps.colorDead.copyFrom(ps.color1);
    ps.startPositionFunction = (_w, pos) => pos.copyFrom(this.center);
    ps.updateFunction = (particles) => { this.step(); this.draw(particles as Mote[], color); };
    ps.start();
    this.ps = ps;
  }

  setEnabled(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (on) { this.ps.manualEmitCount = COUNT; this.ps.start(); } else { this.ps.stop(); this.ps.reset(); }
  }

  /** Dal menu: quanta foschia (1 = come la vuole l'ora) e quanto è pesante (1 = normale). */
  tune(density: number, weight: number): void { this.density = density; this.weight = weight; }

  /** Un soffio: spinge la foschia entro `r` metri lungo (dx, dz) e via dal centro. */
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

  /** Un vertice appena entrato nella griglia: la quota del suolo, se è al coperto, quanta foschia gli spetta; in quiete. */
  private seed(i: number, cx: number, cz: number): void {
    const x = (cx + 0.5) * C, z = (cz + 0.5) * C, gy = this.ground(x, z);
    this.gy[i] = gy; this.cov[i] = this.covered?.(x, z) ? 1 : 0;
    // a chiazze larghe, più fitta nelle conche, con una grana più fine dentro la chiazza
    // un velo continuo, più spesso a chiazze larghe e nelle conche (non banchi separati da vuoti)
    const patch = 0.42 + 0.58 * smoothstep(0.25, 0.7, fbm2(x / 23, z / 23, 2, 404) * 0.5 + 0.5);
    this.rest[i] = this.rho[i] = patch * (0.55 + 0.45 * smoothstep(5, -3, gy)) * (0.85 + 0.3 * (fbm2(x / 5, z / 5, 2, 405) * 0.5 + 0.5));
    this.vx[i] = this.vz[i] = this.lift[i] = 0;
  }

  /** La griglia segue chi guarda, una cella alla volta: ciò che resta dentro si sposta nell'array, il resto nasce a riposo. */
  private scroll(): void {
    const ox = Math.floor(this.eye.x / C) - N / 2, oz = Math.floor(this.eye.z / C) - N / 2, dx = ox - this.ox, dz = oz - this.oz;
    if (!dx && !dz) return;
    const far = Math.abs(dx) >= N || Math.abs(dz) >= N, F = [this.rho, this.rest, this.vx, this.vz, this.lift, this.gy] as const;
    // si scorre nel verso giusto perché una cella non venga letta dopo essere stata scritta
    const xs = dx >= 0 ? 1 : -1, zs = dz >= 0 ? 1 : -1;
    for (let kz = 0; kz < N; kz++) for (let kx = 0; kx < N; kx++) {
      const ix = xs > 0 ? kx : N - 1 - kx, iz = zs > 0 ? kz : N - 1 - kz, i = iz * N + ix, sx = ix + dx, sz = iz + dz;
      if (!far && sx >= 0 && sx < N && sz >= 0 && sz < N) { const j = sz * N + sx; for (const a of F) a[i] = a[j]; this.cov[i] = this.cov[j]; }
      else this.seed(i, ox + ix, oz + iz);
    }
    this.ox = ox; this.oz = oz;
  }

  /** Un passo del liquido finto. */
  private step(): void {
    this.scroll();
    const dt = this.dt, t = this.time, { rho, rest, vx, vz, lift, flow } = this, heavy = this.weight, x0 = this.ox * C, z0 = this.oz * C;
    // 1. le spinte: chi si muove sposta di lato e si trascina dietro la foschia; un soffio la scaglia via. Una foschia pesante si sposta meno.
    const push = (px: number, pz: number, R: number, f: (i: number, dx: number, dz: number, d: number, k: number) => void): void => {
      const a = Math.max(0, Math.floor((px - R - x0) / C)), b = Math.min(N - 1, Math.floor((px + R - x0) / C)), c = Math.max(0, Math.floor((pz - R - z0) / C)), e = Math.min(N - 1, Math.floor((pz + R - z0) / C));
      for (let iz = c; iz <= e; iz++) for (let ix = a; ix <= b; ix++) {
        const dx = x0 + (ix + 0.5) * C - px, dz = z0 + (iz + 0.5) * C - pz, d = Math.hypot(dx, dz);
        if (d < R) f(iz * N + ix, dx, dz, d || 1e-3, 1 - d / R);
      }
    };
    for (const m of this.movers) {
      const sp = Math.hypot(m.vx, m.vz);
      push(m.x, m.z, m.r + 1.9, (i, dx, dz, d, k) => {
        const g = k * k * dt * 9 / heavy;
        vx[i] += (dx / d * (sp * 0.9 + 0.5) + m.vx * 0.7) * g; vz[i] += (dz / d * (sp * 0.9 + 0.5) + m.vz * 0.7) * g;
        lift[i] += sp * k * k * dt * 0.5 / heavy;
      });
    }
    for (const g of this.gusts) push(g.x, g.z, g.r, (i, dx, dz, d, k) => {
      vx[i] += (g.dx + dx / d * 0.6) * g.str * k * 1.5 / heavy; vz[i] += (g.dz + dz / d * 0.6) * g.str * k * 1.5 / heavy;
      lift[i] += g.str * 0.14 * k / heavy;
    });
    this.gusts.length = 0;
    // 2. la pressione: l'eccesso rispetto al riposo spinge verso i vicini che ne hanno meno
    const pk = PRESS * (0.6 + 0.4 * heavy) * dt / (2 * C);
    for (let iz = 1; iz < N - 1; iz++) for (let ix = 1; ix < N - 1; ix++) {
      const i = iz * N + ix;
      vx[i] -= pk * ((rho[i + 1] - rest[i + 1]) - (rho[i - 1] - rest[i - 1]));
      vz[i] -= pk * ((rho[i + N] - rest[i + N]) - (rho[i - N] - rest[i - N]));
    }
    // 3. il flusso: da ogni vertice parte verso il vicino, lungo x e lungo z, la frazione che la velocità porta via in questo passo
    flow.fill(0);
    const wx = 0.16 + 0.08 * Math.sin(t * 0.21), wz = 0.09 + 0.06 * Math.cos(t * 0.17), back = Math.min(1, dt * (0.3 + 0.3 * heavy)), settle = Math.exp(-dt * (0.4 + 0.5 * heavy));
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const i = iz * N + ix, r = rho[i];
      if (r > 1e-4) {
        const fx = Math.max(-0.45, Math.min(0.45, vx[i] * dt / C)), fz = Math.max(-0.45, Math.min(0.45, vz[i] * dt / C)), ax = Math.abs(fx) * r, az = Math.abs(fz) * r;
        flow[i] -= ax + az;
        const jx = ix + (fx > 0 ? 1 : -1), jz = iz + (fz > 0 ? 1 : -1);
        if (jx >= 0 && jx < N) flow[iz * N + jx] += ax;
        if (jz >= 0 && jz < N) flow[jz * N + ix] += az;
      }
      // 4. la velocità torna alla deriva lenta del vento (con un filo di turbolenza), il sollevamento si posa
      vx[i] += (wx + Math.sin((z0 + iz * C) * 0.21 + t * 0.4) * 0.07 - vx[i]) * back;
      vz[i] += (wz + Math.cos((x0 + ix * C) * 0.19 - t * 0.33) * 0.07 - vz[i]) * back;
      lift[i] *= settle;
    }
    // 5. e ciò che il flusso non ha pareggiato torna piano a riposo (ciò che è uscito dai bordi, ciò che si è sollevato)
    const heal = Math.min(1, dt * 0.07 * (0.6 + 0.4 * heavy));
    for (let i = 0; i < COUNT; i++) rho[i] += flow[i] + (rest[i] - rho[i] - flow[i]) * heal;
  }

  /** Una particella per vertice, posata sul terreno. */
  private draw(ps: Mote[], color: Color3): void {
    const { rho, vx, vz, lift, gy, cov, ox, oz, eye } = this, amount = this.alpha * this.density * 0.95;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p.ok) { p.ok = true; p.angle = 0; p.scale.set(1, FLAT); }
      const ix = i % N, iz = (i / N) | 0, cx = ox + ix, cz = oz + iz, r = rho[i];
      if (r < 0.015 || cov[i]) { p.color.a = 0; p.size = 0; continue; }
      const h1 = hash(cx, cz, 1), h2 = hash(cx, cz, 2), h3 = hash(cx, cz, 3), h4 = hash(cx, cz, 4);
      // dentro la sua cella, spostata dalla parte verso cui sta scorrendo; la quota del suolo si interpola fra i vertici vicini
      const fx = Math.max(-0.49, Math.min(0.49, (h1 - 0.5) * 0.9 + vx[i] * 0.22)), fz = Math.max(-0.49, Math.min(0.49, (h2 - 0.5) * 0.9 + vz[i] * 0.22));
      const jx = Math.max(0, Math.min(N - 1, ix + (fx > 0 ? 1 : -1))), jz = Math.max(0, Math.min(N - 1, iz + (fz > 0 ? 1 : -1))), ax = Math.abs(fx), az = Math.abs(fz);
      const y = (gy[i] * (1 - ax) + gy[iz * N + jx] * ax) * (1 - az) + (gy[jz * N + ix] * (1 - ax) + gy[jz * N + jx] * ax) * az;
      const x = (cx + 0.5 + fx) * C, z = (cz + 0.5 + fz) * C, up = lift[i];
      const size = (1.8 + h4 * 1.2) * (0.7 + 0.5 * Math.min(1.3, r)) * (1 + up * 0.45);
      p.size = size;
      p.position.set(x, y + size * FLAT * 0.5 + 0.02 + h3 * 0.1 + up * 0.7, z);
      // sfuma al bordo della griglia e addosso a chi guarda; sollevata si dirada
      const dist = Math.hypot(x - eye.x, z - eye.z), edge = 1 - smoothstep(RADIUS * 0.6, RADIUS * 0.95, dist);
      const d3 = Math.hypot(x - eye.x, y - eye.y, z - eye.z), near = smoothstep(0.7, 2.2, d3);
      // vista di taglio le falde si sommano una sull'altra, dall'alto se ne attraversa una sola: guardando in giù vale di più,
      // o ai propri piedi (dove passa la lama) non si vede niente
      const steep = 1 + 1.8 * Math.max(0, (eye.y - y) / d3);
      p.color.set(color.r, color.g, color.b, amount * Math.min(1.5, r) * (0.6 + 0.4 * h3) * edge * near * steep / (1 + up * 0.8));
    }
  }
}
