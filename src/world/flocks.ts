// ─────────────────────────────────────────────────────────────────────────────
// STORMI — ogni tanto un volo di piccioni si alza da un tetto, fa due giri sopra la città e si posa su un altro;
// col buio escono i pipistrelli attorno alle torri. Sono sagome (due ali che battono nello shader), una mesh sola
// a istanze: le matrici le muove la CPU, una quarantina in tutto.
// ponytail: niente boids (ognuno gira attorno al centro dello stormo su un'orbita sua); se servono uccelli che si
// posano e si vedono da vicino, vanno fatti a parte.
// ─────────────────────────────────────────────────────────────────────────────

import { Effect, Matrix, Mesh, Scene, ShaderMaterial, VertexData } from "@babylonjs/core";

Effect.ShadersStore.sqFlockVertexShader = `
  precision highp float;
  attribute vec3 position; attribute vec2 uv; attribute vec4 fx;   // fx: fase, battiti al secondo, grigio
  #include<instancesDeclaration>
  uniform mat4 viewProjection; uniform float time;
  varying float vGrey;
  void main() {
    #include<instancesVertex>
    float beat = sin(time * fx.y + fx.x);
    vec3 p = position;
    p.y += beat * uv.x * 0.45; p.x *= 1.0 - 0.3 * uv.x * abs(beat);   // la punta dell'ala sale e scende, e rientra un poco
    gl_Position = viewProjection * finalWorld * vec4(p, 1.0);
    vGrey = fx.z;
  }`;
Effect.ShadersStore.sqFlockFragmentShader = `
  precision highp float;
  uniform float tone; varying float vGrey;
  void main() { gl_FragColor = vec4(vec3(vGrey * tone), 1.0); }`;

interface Flock { from: number; n: number; night: boolean; size: number; wait: number; t: number; len: number; a: [number, number, number]; b: [number, number, number]; turn: number }

/**
 * `roosts` = i tetti da cui partono e su cui si posano (x, y, z nel mondo), `center` e `radius` = dove girano.
 * `update(dt, time, hour, tone)`: il tempo delle animazioni, l'ora del mondo, quanta luce c'è (0..1).
 */
export function createFlocks(scene: Scene, roosts: [number, number, number][], center: [number, number], radius: number): { mesh: Mesh; update(dt: number, time: number, hour: number, tone: number): void } {
  // la sagoma: corpo, coda, due ali (uv.x = quanto batte quel vertice: 1 in punta)
  const vd = new VertexData();
  vd.positions = [0, 0, 0.38, -0.08, 0, -0.1, 0.08, 0, -0.1, 0, 0, -0.42, -0.08, 0, 0.15, -0.08, 0, -0.2, -0.6, 0, -0.06, 0.08, 0, 0.15, 0.08, 0, -0.2, 0.6, 0, -0.06];
  vd.uvs = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0];
  vd.indices = [0, 1, 2, 1, 3, 2, 4, 5, 6, 7, 9, 8];
  const mesh = new Mesh("stormi", scene);
  vd.applyToMesh(mesh);
  const mat = new ShaderMaterial("sqFlock", scene, { vertex: "sqFlock", fragment: "sqFlock" }, { attributes: ["position", "uv", "fx"], uniforms: ["world", "view", "viewProjection", "time", "tone"] });
  mat.backFaceCulling = false;
  mesh.material = mat; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
  const rnd = (i: number, k: number): number => Math.abs(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453) % 1;
  const flocks: Flock[] = [
    { from: 0, n: 22, night: false, size: 0.62, wait: 12, t: 0, len: 0, a: roosts[0], b: roosts[1 % roosts.length], turn: 1 },
    { from: 22, n: 14, night: true, size: 0.42, wait: 5, t: 0, len: 0, a: roosts[0], b: roosts[0], turn: -1 },
  ];
  const N = 36, live = new Float32Array(N * 16), fx = new Float32Array(N * 4), m = new Matrix();
  for (const f of flocks) for (let i = f.from; i < f.from + f.n; i++) { fx[i * 4] = rnd(i, 1) * 6.28; fx[i * 4 + 1] = f.night ? 15 + rnd(i, 2) * 5 : 8 + rnd(i, 2) * 3; fx[i * 4 + 2] = f.night ? 0.025 : 0.2 + rnd(i, 3) * 0.25; }
  mesh.thinInstanceSetBuffer("matrix", live, 16, false);
  mesh.thinInstanceSetBuffer("fx", fx, 4, true);
  /** Dove sta lo stormo a u (0..1) del suo volo: sale dal tetto, gira largo, scende sull'altro. */
  const at = (f: Flock, u: number, out: [number, number, number]): void => {
    const e = Math.sin(Math.min(1, u) * Math.PI), s = u * u * (3 - 2 * u), ang = f.turn * u * 9 + f.from, r = radius * (f.night ? 0.35 : 1) * e;
    out[0] = f.a[0] + (f.b[0] - f.a[0]) * s + (center[0] - (f.a[0] + f.b[0]) / 2) * e * 0.6 + Math.cos(ang) * r;
    out[1] = f.a[1] + (f.b[1] - f.a[1]) * s + e * (f.night ? 3 : 9);
    out[2] = f.a[2] + (f.b[2] - f.a[2]) * s + (center[1] - (f.a[2] + f.b[2]) / 2) * e * 0.6 + Math.sin(ang) * r;
  };
  const c: [number, number, number] = [0, 0, 0], c1: [number, number, number] = [0, 0, 0];
  let stamp = 0;
  return {
    mesh,
    update(dt, time, hour, tone) {
      mat.setFloat("time", time); mat.setFloat("tone", 0.25 + 0.75 * tone);
      const dark = hour >= 18.6 || hour < 5.2, day = hour >= 6.5 && hour < 17.8;
      let dirty = false;
      for (const f of flocks) {
        if (f.len <= 0) {   // posati: fra un po' ripartono, se è la loro ora
          if ((f.wait -= dt) > 0 || !(f.night ? dark : day)) continue;
          f.len = f.night ? 50 + rnd(stamp, 4) * 40 : 32 + rnd(stamp, 5) * 16; f.t = 0; f.turn = rnd(stamp, 6) < 0.5 ? -1 : 1;
          f.a = f.b; f.b = roosts[Math.floor(rnd(++stamp, 7) * roosts.length)];
        }
        f.t += dt;
        const u = f.t / f.len;
        at(f, u, c); at(f, u + 0.01, c1);
        for (let k = 0; k < f.n; k++) {
          const i = f.from + k, a = rnd(i, 8) * 6.28 + time * (f.night ? 1.9 : 0.7) * (rnd(i, 9) < 0.5 ? -1 : 1), r = (1 + rnd(i, 10) * (f.night ? 5 : 4.5)) * Math.min(1, u * 8, (1 - u) * 8 + 0.15);
          const jx = f.night ? Math.sin(time * 3.1 + i * 1.7) * 1.2 : 0, jy = Math.sin(time * (f.night ? 2.7 : 0.9) + i) * (f.night ? 1.4 : 0.8);
          const x = c[0] + Math.cos(a) * r + jx, y = c[1] + jy + (rnd(i, 11) - 0.5) * 2.5, z = c[2] + Math.sin(a) * r;
          // guarda dove va: il verso dello stormo più quello della sua orbita
          const hx = (c1[0] - c[0]) * 40 - Math.sin(a) * (f.night ? 1.9 : 0.7) * r, hz = (c1[2] - c[2]) * 40 + Math.cos(a) * (f.night ? 1.9 : 0.7) * r;
          Matrix.RotationYToRef(Math.atan2(hx, hz), m);
          const s = f.size * (0.85 + rnd(i, 12) * 0.3);
          for (let q = 0; q < 12; q++) live[i * 16 + q] = m.m[q] * s;
          live[i * 16 + 12] = x; live[i * 16 + 13] = y; live[i * 16 + 14] = z; live[i * 16 + 15] = 1;
        }
        if (u >= 1) { f.len = 0; f.wait = f.night ? 4 + rnd(stamp, 13) * 10 : 45 + rnd(stamp, 14) * 70; live.fill(0, f.from * 16, (f.from + f.n) * 16); }   // posati: spariscono fra i tetti
        dirty = true;
      }
      if (dirty) mesh.thinInstanceBufferUpdated("matrix");
    },
  };
}
