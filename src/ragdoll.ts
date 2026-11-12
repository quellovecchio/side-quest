import { Quaternion, TransformNode, Vector3 } from "@babylonjs/core";
import type { Creature, QuadDef } from "./creature";
import { EAST, HALF } from "./world/terrain";
import type { Collider } from "./world/vegetation";

// ─────────────────────────────────────────────────────────────────────────────
// RAGDOLL — il corpo di un quadrupede morto, lasciato alla fisica.
//
// Niente motore fisico: punti e bastoncini alla Verlet (Jakobsen, "Advanced Character Physics").
// Un punto per articolazione: otto per il tronco (anche, spalle, groppa, garrese, ventre, petto —
// tutti legati fra loro, quindi rigido), poi collo, testa e muso, la coda, e ginocchio / garretto /
// piede di ogni zampa. Ogni punto ricorda dov'era un istante prima (la sua velocità è la
// differenza); a ogni passo cade, poi i vincoli rimettono a posto le distanze:
//   · bastoncini rigidi lungo le ossa;
//   · limiti (distanza minima / massima) al posto dei limiti d'angolo: un ginocchio non si chiude
//     su se stesso, una zampa non passa attraverso il corpo, il collo non si ripiega sulla schiena;
//   · il terreno e i cerchi di tronchi e rocce respingono i punti, con attrito a terra.
// Il corpo parte dalla posa che aveva morendo, con la velocità che aveva più quella del colpo che
// l'ha ucciso (`impulse`): ne prende di più chi sta in alto e dal lato del colpo, così rotola.
// Dai punti si ricavano le rotazioni delle ossa (`apply`): il tronco dai suoi punti, ogni osso
// con l'arco più breve che porta la sua direzione di riposo su quella fra i due punti.
//
// ponytail: i punti urtano terreno e cerchi, non gli altri corpi né il giocatore. Per pile di
// cadaveri o corpi da spingere coi piedi servono collisioni fra capsule.
// ─────────────────────────────────────────────────────────────────────────────

export interface RagSpec {
  /** Quanto stanno sopra le anche / le spalle la groppa e il garrese, e sotto il ventre e il petto (m, nel modello). */
  back: [number, number]; under: [number, number];
  /** La punta del muso rispetto alla base del cranio [y, z]. */
  nose: [number, number];
  /** Raggi di contatto: tronco, testa, zampe. */
  body: number; head: number; limb: number;
  /** Peso relativo (lupo = 1): un corpo leggero vola più lontano. */
  mass: number;
}

const H = 1 / 90, GRAVITY = 19, DAMP = 0.998, ITER = 6, FRICTION = 0.16, BOUNCE = 0.2;
// indici dei punti
const HIP_L = 0, HIP_R = 1, SH_L = 2, SH_R = 3, CROUP = 4, WITHERS = 5, TRUNK = 8, NECK = 8, HEAD = 9, NOSE = 10, TAIL = 11;

interface Stick { a: number; b: number; min: number; max: number }

export class Ragdoll {
  private p: Vector3[] = [];
  private prev: Vector3[] = [];
  private r: number[] = [];
  private w: number[] = [];
  private sticks: Stick[] = [];
  private acc = 0;
  private legAt: number[] = [];
  private near: Collider[] = [];
  private restInv: Quaternion;
  /** Centro del tronco, sua velocità, direzione (per chi segue il corpo: ombra, pulviscolo, foschia). */
  readonly center = new Vector3();
  readonly vel = new Vector3();
  yaw = 0;
  /** La velocità più alta fra i punti del tronco (m/s): sotto una soglia il corpo è fermo. */
  speed = 99;
  /** Il colpo più forte preso dal tronco contro il terreno dall'ultima lettura (m/s); chi lo legge lo azzera. */
  impact = 0;

  constructor(private rig: Creature, private def: QuadDef, private scale: number, private spec: RagSpec, velocity: Vector3) {
    const s = scale, d = def;
    rig.root.computeWorldMatrix(true);
    for (const n of rig.root.getDescendants(false)) (n as TransformNode).computeWorldMatrix(true);

    // punti: posizione nel modello a riposo (per le lunghezze) e nel mondo adesso (da dove parte)
    const rest: Vector3[] = [];
    const add = (model: Vector3, world: Vector3, radius: number, invMass: number): number => {
      rest.push(model); this.p.push(world.clone()); this.r.push(radius * s); this.w.push(invMass);
      return rest.length - 1;
    };
    // un punto del modello portato nel mondo da un osso che a riposo ha l'origine in `origin` [y, z]
    const via = (node: TransformNode, origin: [number, number], m: Vector3): Vector3 =>
      Vector3.TransformCoordinates(new Vector3(m.x, m.y - origin[0], m.z - origin[1]), node.getWorldMatrix());
    const [fl, fr, hl, hr] = rig.legs;
    const hy = d.hind.j[0][0], hz = d.hind.j[0][1], sy = d.front.j[0][0], sz = d.front.j[0][1];
    add(new Vector3(-d.hind.x, hy, hz), hl.n[0].getAbsolutePosition(), spec.body, 0.35);
    add(new Vector3(d.hind.x, hy, hz), hr.n[0].getAbsolutePosition(), spec.body, 0.35);
    add(new Vector3(-d.front.x, sy, sz), fl.n[0].getAbsolutePosition(), spec.body, 0.35);
    add(new Vector3(d.front.x, sy, sz), fr.n[0].getAbsolutePosition(), spec.body, 0.35);
    for (const [m, node] of [
      [new Vector3(0, hy + spec.back[0], hz), rig.pelvis], [new Vector3(0, sy + spec.back[1], sz), rig.chest],
      [new Vector3(0, hy - spec.under[0], hz), rig.pelvis], [new Vector3(0, sy - spec.under[1], sz), rig.chest],
    ] as [Vector3, TransformNode][]) add(m, via(node, d.pivot, m), spec.body, 0.35);
    add(new Vector3(0, d.neckAt[0], d.neckAt[1]), rig.neck.getAbsolutePosition(), spec.body, 0.35);
    add(new Vector3(0, d.headAt[0], d.headAt[1]), rig.head.getAbsolutePosition(), spec.head, 0.8);
    const nose = new Vector3(0, d.headAt[0] + spec.nose[0], d.headAt[1] + spec.nose[1]);
    add(nose, via(rig.head, d.headAt, nose), spec.limb, 1);
    // coda: la base sta sul bacino, gli altri punti pendono
    const tp = d.tail.pts;
    tp.forEach((t, i) => {
      const m = new Vector3(0, t[0], t[1]);
      add(m, i < rig.tail.length ? rig.tail[i].getAbsolutePosition() : via(rig.tail[i - 1], tp[i - 1], m), spec.limb * 0.8, i === 0 ? 0.35 : 1.6);
    });
    // zampe: ginocchio, garretto, piede
    rig.legs.forEach((leg, li) => {
      const L = leg.front ? d.front : d.hind, x = L.x * (li % 2 ? 1 : -1);
      this.legAt.push(rest.length);
      add(new Vector3(x, L.j[1][0], L.j[1][1]), leg.n[1].getAbsolutePosition(), spec.limb, 0.9);
      add(new Vector3(x, L.j[2][0], L.j[2][1]), leg.n[2].getAbsolutePosition(), spec.limb, 1.1);
      add(new Vector3(x, L.j[3][0], L.j[3][1]), via(leg.n[2], L.j[2], new Vector3(0, L.j[3][0], L.j[3][1])), spec.limb * 0.8, 1.3);
    });

    // vincoli, con le lunghezze della posa di riposo
    const len = (a: number, b: number): number => Vector3.Distance(rest[a], rest[b]) * s;
    const rigid = (a: number, b: number): void => { const l = len(a, b); this.sticks.push({ a, b, min: l, max: l }); };
    const limit = (a: number, b: number, lo: number, hi = 1e9): void => { const l = len(a, b); this.sticks.push({ a, b, min: l * lo, max: l * hi }); };
    for (let a = 0; a < TRUNK; a++) for (let b = a + 1; b < TRUNK; b++) rigid(a, b);
    for (const b of [SH_L, SH_R, WITHERS, CROUP]) rigid(NECK, b);
    for (const b of [HIP_L, HIP_R, CROUP, WITHERS]) rigid(TAIL, b);
    rigid(NECK, HEAD); rigid(HEAD, NOSE);
    limit(HEAD, WITHERS, 0.75, 1.25); limit(HEAD, SH_L, 0.8); limit(HEAD, SH_R, 0.8); limit(NOSE, NECK, 0.75);
    for (let i = 1; i < tp.length; i++) rigid(TAIL + i - 1, TAIL + i);
    if (tp.length > 2) { limit(TAIL + 1, HIP_L, 0.6); limit(TAIL + 1, HIP_R, 0.6); limit(TAIL + 2, CROUP, 0.7); }
    rig.legs.forEach((leg, li) => {
      const k = this.legAt[li], right = li % 2 === 1;
      const top = leg.front ? (right ? SH_R : SH_L) : (right ? HIP_R : HIP_L);
      const other = leg.front ? (right ? SH_L : SH_R) : (right ? HIP_L : HIP_R);
      rigid(top, k); rigid(k, k + 1); rigid(k + 1, k + 2);
      limit(top, k + 1, 0.6, 1.01);                             // il ginocchio non si chiude né si tende oltre
      limit(k, k + 2, 0.65);
      limit(k, other, 0.85); limit(k + 1, other, 0.6);          // la zampa non attraversa il corpo
      limit(k, leg.front ? WITHERS : CROUP, 0.75);              // né si ripiega sopra la schiena
      limit(k, leg.front ? NECK : TAIL, 0.8);                   // il gomito resta dietro, il ginocchio davanti
    });

    // a riposo la linea anche → spalle non è proprio orizzontale: `apply` ne tiene conto
    this.restInv = Quaternion.RotationAxis(Vector3.Right(), -Math.atan2(-(sy - hy), sz - hz));
    for (const q of this.p) this.prev.push(q.subtract(velocity.scale(H)));
    this.measure();
  }

  /** Una spinta (m/s). Ne prende di più chi sta in alto e chi è più vicino a `from`, da dove arriva il colpo: il corpo ruota. */
  impulse(v: Vector3, from: Vector3, rnd: () => number): void {
    let lo = Infinity, hi = -Infinity, near = Infinity, far = 0;
    const dist = this.p.map((q) => Math.hypot(q.x - from.x, q.z - from.z));
    this.p.forEach((q, i) => { lo = Math.min(lo, q.y); hi = Math.max(hi, q.y); near = Math.min(near, dist[i]); far = Math.max(far, dist[i]); });
    this.p.forEach((q, i) => {
      const k = 0.6 + 0.4 * (q.y - lo) / Math.max(1e-3, hi - lo) + 0.45 * (1 - (dist[i] - near) / Math.max(1e-3, far - near)) + (rnd() - 0.5) * 0.15;
      this.prev[i].subtractInPlace(v.scale(k * H));
    });
    this.speed = 99;
  }

  /** Avanza la simulazione di `dt` secondi (a passi fissi). */
  step(dt: number, ground: (x: number, z: number) => number, cols: Collider[]): void {
    const c = this.center;
    this.near = cols.filter((o) => Math.abs(o.x - c.x) < 5 + o.r && Math.abs(o.z - c.z) < 5 + o.r);
    this.acc += Math.min(dt, 0.05);
    while (this.acc >= H) { this.substep(ground); this.acc -= H; }
    this.measure();
  }

  private substep(ground: (x: number, z: number) => number): void {
    const n = this.p.length, p = this.p, prev = this.prev, lim = HALF - 6;
    const vy = new Float32Array(n), hit = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const q = p[i], o = prev[i];
      const vx = (q.x - o.x) * DAMP, v = (q.y - o.y) * DAMP, vz = (q.z - o.z) * DAMP;
      o.copyFrom(q);
      q.x += vx; q.y += v - GRAVITY * H * H; q.z += vz;
      vy[i] = v / H;
    }
    for (let it = 0; it < ITER; it++) {
      for (const s of this.sticks) {
        const a = p[s.a], b = p[s.b];
        const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, d = Math.hypot(dx, dy, dz) || 1e-6;
        const want = d < s.min ? s.min : d > s.max ? s.max : d;
        if (want === d) continue;
        const k = (d - want) / d, wa = this.w[s.a], wb = this.w[s.b], ka = k * wa / (wa + wb), kb = k * wb / (wa + wb);
        a.x += dx * ka; a.y += dy * ka; a.z += dz * ka;
        b.x -= dx * kb; b.y -= dy * kb; b.z -= dz * kb;
      }
      for (let i = 0; i < n; i++) {
        const q = p[i], r = this.r[i];
        // tronchi e rocce: cerchi da cui si viene spinti fuori
        for (const c of this.near) {
          const dx = q.x - c.x, dz = q.z - c.z, min = c.r + r, d2 = dx * dx + dz * dz;
          if (d2 < min * min && d2 > 1e-8) { const k = min / Math.sqrt(d2); q.x = c.x + dx * k; q.z = c.z + dz * k; }
        }
        q.x = Math.max(-lim, Math.min(lim + EAST, q.x)); q.z = Math.max(-lim, Math.min(lim, q.z));
        const gy = ground(q.x, q.z) + r;
        if (q.y < gy) { q.y = gy; hit[i] = 1; }
      }
    }
    // a terra: attrito, e un filo di rimbalzo
    for (let i = 0; i < n; i++) {
      if (!hit[i]) continue;
      const q = p[i], o = prev[i];
      o.x += (q.x - o.x) * FRICTION; o.z += (q.z - o.z) * FRICTION;
      o.y = q.y + Math.min(0, vy[i]) * H * BOUNCE;
      if (i < TRUNK) this.impact = Math.max(this.impact, -vy[i]);
    }
  }

  private measure(): void {
    const p = this.p;
    this.center.copyFrom(p[HIP_L]).addInPlace(p[HIP_R]).addInPlace(p[SH_L]).addInPlace(p[SH_R]).scaleInPlace(0.25);
    let v = 0;
    this.vel.setAll(0);
    for (let i = 0; i < TRUNK; i++) {
      const d = p[i].subtract(this.prev[i]).scaleInPlace(1 / H);
      v = Math.max(v, d.length());
      this.vel.addInPlace(d.scaleInPlace(1 / TRUNK));
    }
    this.speed = v;
    this.yaw = Math.atan2(p[SH_L].x + p[SH_R].x - p[HIP_L].x - p[HIP_R].x, p[SH_L].z + p[SH_R].z - p[HIP_L].z - p[HIP_R].z);
  }

  /** Scrive la posa dei punti sulle ossa del modello. */
  apply(): void {
    const p = this.p, rig = this.rig, d = this.def;
    const hipMid = p[HIP_L].add(p[HIP_R]).scaleInPlace(0.5), shMid = p[SH_L].add(p[SH_R]).scaleInPlace(0.5);
    const fwd = shMid.subtract(hipMid).normalize();
    const frame = (side: Vector3): Quaternion => {
      const right = side.subtract(fwd.scale(Vector3.Dot(side, fwd))).normalize();
      return Quaternion.RotationQuaternionFromAxis(right, Vector3.Cross(fwd, right), fwd).multiplyInPlace(this.restInv);
    };
    // bacino e torace hanno ciascuno il suo "destra" (i vincoli lasciano un filo di torsione)
    const qp = frame(p[HIP_R].subtract(p[HIP_L])), qc = frame(p[SH_R].subtract(p[SH_L]));
    const q = Quaternion.Slerp(qp, qc, 0.5), qi = Quaternion.Inverse(q);
    // il punto di mezzo fra anche e spalle, nel modello e nel mondo, fissa dove sta la radice
    const mid = new Vector3(0, (d.hind.j[0][0] + d.front.j[0][0]) / 2, (d.hind.j[0][1] + d.front.j[0][1]) / 2).scaleInPlace(this.scale);
    mid.rotateByQuaternionToRef(q, mid);
    rig.root.position.copyFrom(hipMid.addInPlace(shMid).scaleInPlace(0.5).subtractInPlace(mid));
    rig.root.rotationQuaternion = q;
    rig.body.position.y = d.pivot[0];
    rig.body.rotationQuaternion = Quaternion.Identity();
    rig.pelvis.rotationQuaternion = qi.multiply(qp);
    rig.chest.rotationQuaternion = qi.multiply(qc);

    // un osso: l'arco più breve che porta la sua direzione di riposo (ruotata come il padre) su quella dei punti
    const tmp = new Vector3(), swing = new Quaternion();
    const bone = (parent: Quaternion, node: TransformNode, ry: number, rz: number, from: Vector3, to: Vector3): Quaternion => {
      tmp.set(0, ry, rz).normalize().rotateByQuaternionToRef(parent, tmp);
      Quaternion.FromUnitVectorsToRef(tmp, to.subtract(from).normalize(), swing);
      const world = swing.multiply(parent);
      node.rotationQuaternion = Quaternion.Inverse(parent).multiplyInPlace(world);
      return world;
    };
    const wn = bone(qc, rig.neck, d.headAt[0] - d.neckAt[0], d.headAt[1] - d.neckAt[1], p[NECK], p[HEAD]);
    bone(wn, rig.head, this.spec.nose[0], this.spec.nose[1], p[HEAD], p[NOSE]);
    rig.jaw.rotation.x = 0.22;
    let wt = qp;
    const tp = d.tail.pts;
    rig.tail.forEach((node, i) => { wt = bone(wt, node, tp[i + 1][0] - tp[i][0], tp[i + 1][1] - tp[i][1], p[TAIL + i], p[TAIL + i + 1]); });
    rig.legs.forEach((leg, li) => {
      const k = this.legAt[li], right = li % 2 === 1;
      const pts = [p[leg.front ? (right ? SH_R : SH_L) : (right ? HIP_R : HIP_L)], p[k], p[k + 1], p[k + 2]];
      let w = leg.front ? qc : qp;
      leg.n.forEach((node, j) => { w = bone(w, node, -Math.cos(leg.rest[j]), Math.sin(leg.rest[j]), pts[j], pts[j + 1]); });
    });
  }

  /** Quanto le ossa si scostano dai punti (m): controllo che `apply` e la simulazione dicano la stessa cosa. */
  error(): number {
    const rig = this.rig;
    for (const n of rig.root.getDescendants(false)) (n as TransformNode).computeWorldMatrix(true);
    let e = Math.max(Vector3.Distance(rig.neck.getAbsolutePosition(), this.p[NECK]), Vector3.Distance(rig.head.getAbsolutePosition(), this.p[HEAD]));
    rig.legs.forEach((leg, li) => leg.n.forEach((n, j) => {
      if (j) e = Math.max(e, Vector3.Distance(n.getAbsolutePosition(), this.p[this.legAt[li] + j - 1]));
    }));
    return e;
  }

  /** Restituisce il modello all'animazione (rotazioni di Eulero). */
  release(): void {
    const rig = this.rig;
    for (const n of [rig.root, rig.body, rig.pelvis, rig.chest, rig.neck, rig.head, ...rig.tail, ...rig.legs.flatMap((l) => l.n)]) {
      n.rotationQuaternion = null;
      n.rotation.setAll(0);
    }
    rig.jaw.rotation.x = 0;
  }
}
