import { Color3, Constants, Effect, Light, Matrix, Mesh, MeshBuilder, PointLight, Scene, ShaderMaterial, ShadowGenerator, Vector3, Vector4, type AbstractMesh } from "@babylonjs/core";

// ─────────────────────────────────────────────────────────────────────────────
// FIAMME — candele, lanterne, focolari, bracieri, la forgia. Chi costruisce il mondo le dichiara
// (`flame`, `fire`, `embers`); `createFlames()` le disegna tutte con poche mesh a istanze.
//
// Due fuochi diversi, come nella realtà:
//   · la FIAMMELLA di una candela o di una lanterna: una goccia sola, quasi ferma, senza fumo;
//   · il FUOCO di un focolare o della forgia: non tante fiammelle ma un corpo unico. Lo shader
//     calcola un campo — rumore deformato su se stesso che sale (domain warping), più caldo e
//     largo in basso, con una soglia che cresce con l'altezza — e ne disegna ciò che supera la
//     soglia: in basso le lingue sono fuse in una massa, salendo si assottigliano, si dividono, si
//     staccano e si spengono. Il colore viene dalla temperatura (rosso cupo → arancio → giallo →
//     quasi bianco). Due strati sovrapposti con semi diversi gli danno spessore; dentro salgono
//     le scintille. Sotto sta un LETTO DI BRACI: carboni neri con le crepe che pulsano.
// Riferimenti: le ricette correnti del fuoco procedurale in tempo reale (coordinata che sale, fbm
// deformato, maschera verticale, scala di colori; più strati sovrapposti; scintille a parte).
//
// Il vento è lo stesso dell'erba (`addWind` in materials.ts): piega la cima e porta via il fumo;
// al chiuso ne arriva una frazione (`wind`).
// ⚠️ HDR: il fuoco passa la soglia del bloom di poco (`GAIN`): più acceso diventa una lampadina.
// ─────────────────────────────────────────────────────────────────────────────

/** Una fiamma: il piede, l'altezza (m), il vento che prende (0 al chiuso … 1 all'aperto); con `w` è un fuoco largo `w`, non una fiammella. */
export interface Flame { x: number; y: number; z: number; h: number; wind: number; w?: number }
export const FLAMES: Flame[] = [];
/** I letti di braci: centro e raggio. */
const EMBERS: { x: number; y: number; z: number; r: number }[] = [];

type P = { x: number; y: number; z: number };
/** La fiammella di una candela o di una lanterna. */
export function flame(p: P, h: number, wind = 1): void { FLAMES.push({ x: p.x, y: p.y, z: p.z, h, wind }); }
/** Il fuoco di un focolare, di un braciere, della forgia: largo `w`, alto `h`. */
export function fire(p: P, w: number, h: number, wind = 1): void { FLAMES.push({ x: p.x, y: p.y, z: p.z, h, wind, w }); }
/** Un letto di braci di raggio `r`. */
export function embers(p: P, r: number): void { EMBERS.push({ x: p.x, y: p.y, z: p.z, r }); }

const GAIN = 1.5;

const NOISE = `
  float sqHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float sqNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(sqHash(i), sqHash(i + vec2(1.0, 0.0)), f.x), mix(sqHash(i + vec2(0.0, 1.0)), sqHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  float sqFbm(vec2 p) { return sqNoise(p) * 0.55 + sqNoise(p * 2.1 + 3.7) * 0.3 + sqNoise(p * 4.3 + 9.1) * 0.15; }
  // dalla temperatura (0..1) al colore: rosso cupo, arancio, giallo, quasi bianco
  vec3 sqHeat(float t) {
    vec3 c = mix(vec3(0.32, 0.02, 0.0), vec3(1.0, 0.3, 0.02), smoothstep(0.0, 0.4, t));
    c = mix(c, vec3(1.0, 0.72, 0.2), smoothstep(0.35, 0.75, t));
    return mix(c, vec3(1.0, 0.94, 0.72), smoothstep(0.75, 1.0, t));
  }`;

// il cartello: largo `shape.x` volte la larghezza e alto `shape.y` volte l'altezza del fuoco, alzato di `shape.z`; la cima si piega col vento (`shape.w`)
Effect.ShadersStore.sqFlameVertexShader = `
  precision highp float;
  attribute vec3 position; attribute vec2 uv; attribute vec4 fx;
  #include<instancesDeclaration>
  uniform mat4 view, viewProjection; uniform float time; uniform vec4 shape;
  varying vec2 vUV; varying vec4 vFx;
  void main() {
    #include<instancesVertex>
    vec3 c = (finalWorld * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float w = length(finalWorld[0].xyz), h = length(finalWorld[1].xyz), y = uv.y;
    vec3 right = vec3(view[0][0], view[1][0], view[2][0]);
    float ph = dot(c.xz, vec2(0.071, 0.093));
    vec2 gust = vec2(sin(time * 0.9 + ph), cos(time * 0.7 + ph * 1.3)) * (0.6 + 0.4 * sin(time * 0.23 + ph * 0.2));
    vec3 p = c + right * (position.x * shape.x * w) + vec3(0.0, (y * shape.y + shape.z) * h, 0.0);
    p.xz += gust * (fx.y * shape.w * y * y * h);
    gl_Position = viewProjection * vec4(p, 1.0);
    vUV = uv; vFx = fx;
  }`;

Effect.ShadersStore.sqFlameFragmentShader = `
  precision highp float;
  uniform float time;
  varying vec2 vUV; varying vec4 vFx;
  ${NOISE}
  void main() {
    float x = vUV.x - 0.5, y = vUV.y, s = vFx.x;
    if (vFx.z < 0.5) {
      // ── la fiammella: una goccia, col piede azzurro e il cuore chiaro; trema appena ──
      float t = time * (1.2 + 0.4 * fract(s * 7.0));
      float n = sqFbm(vec2(x * 3.0 + s * 31.0, y * 1.8 - t * 1.6)), n2 = sqFbm(vec2(x * 7.0 - s * 17.0, y * 3.5 - t * 2.6));
      float w = 0.3 * pow(sin(3.14159 * pow(clamp(y, 0.0, 1.0), 0.5)), 0.85) * (0.86 + 0.28 * n2);
      float d = abs(x + (n - 0.5) * 0.2 * y * y) / max(w, 0.001);
      float body = smoothstep(1.0, 0.3, d) * smoothstep(0.0, 0.3, (1.0 - y) + (n2 - 0.5) * 0.3);
      float core = smoothstep(0.65, 0.0, d) * smoothstep(0.85, 0.1, y);
      vec3 col = mix(sqHeat(0.45 + 0.3 * body), vec3(1.0, 0.92, 0.66), core);
      col += vec3(0.03, 0.1, 0.34) * smoothstep(0.14, 0.0, y) * 1.6;
      gl_FragColor = vec4(col * ${GAIN.toFixed(2)}, body * (0.85 + 0.3 * n));
      return;
    }
    // ── il fuoco: un campo unico. Rumore deformato su se stesso, che sale; largo e caldo in basso; la soglia cresce con l'altezza ──
    float t = time * (0.9 + 0.25 * fract(s * 5.0));
    vec2 q = vec2(x * 2.6 + s * 9.0, y * 1.9 - t * 1.25);
    vec2 warp = vec2(sqFbm(q + vec2(0.0, t * 0.3)), sqFbm(q + vec2(5.2, 1.3 - t * 0.45))) - 0.5;
    float n = sqFbm(q * 1.7 + warp * 2.1 + vec2(0.0, -t * 0.85));
    float fine = sqFbm(q * 4.6 + warp * 3.0 + vec2(1.7, -t * 2.2));
    float hw = mix(0.44, 0.16, pow(y, 0.6));                       // la sagoma si stringe salendo
    float f = n * 1.15 + fine * 0.34 + 0.5 * (1.0 - y * 1.9) - 1.0 * pow(abs(x) / hw, 2.0);
    float body = smoothstep(0.52, 0.64, f) * smoothstep(0.0, 0.04, y) * smoothstep(1.0, 0.8, y);
    float temp = clamp((f - 0.52) * 1.25, 0.0, 1.0) * (1.0 - 0.6 * y) * (0.55 + 0.6 * fine);
    vec3 col = sqHeat(temp) * (0.42 + 0.4 * temp);   // (due strati si sommano: ognuno resta sotto la soglia del bloom)
    // scintille: puntini che salgono a scatti nelle celle di una griglia, più rari in alto
    vec2 g = vec2(x * 22.0, y * 14.0 - t * 3.4 + s * 3.0), cell = floor(g), in2 = fract(g) - 0.5;
    float r = sqHash(cell + s);
    float spark = step(0.955, r) * smoothstep(0.22, 0.0, length(in2 + (vec2(sqHash(cell * 1.7), sqHash(cell * 2.3)) - 0.5) * 0.5)) * smoothstep(1.0, 0.25, y) * smoothstep(0.5, 0.0, abs(x));
    col += vec3(1.0, 0.6, 0.2) * spark * 1.2;
    gl_FragColor = vec4(col * 1.15, max(body * (0.75 + 0.25 * temp), spark));
  }`;

Effect.ShadersStore.sqSmokeFragmentShader = `
  precision highp float;
  uniform float time; uniform float tone;
  varying vec2 vUV; varying vec4 vFx;
  ${NOISE}
  void main() {
    float x = vUV.x - 0.5, y = vUV.y, s = vFx.x;
    vec2 q = vec2(x * 2.4 + s * 13.0, y * 2.6 - time * 0.4);
    vec2 warp = vec2(sqFbm(q + 3.1), sqFbm(q + vec2(7.7, 2.2))) - 0.5;
    float n = sqFbm(q * 1.5 + warp * 2.4);
    // una colonna rada sopra il fuoco: si allarga, si sfilaccia e si scioglie salendo
    float w = 0.16 + 0.3 * y;
    float d = abs(x + warp.x * 0.5 * y) / w;
    float a = smoothstep(1.0, 0.1, d) * smoothstep(0.0, 0.2, y) * pow(1.0 - y, 1.6) * smoothstep(0.35, 0.75, n) * 0.2;
    gl_FragColor = vec4(vec3(0.42, 0.4, 0.38) * tone, a);
  }`;

// le braci: una cupola bassa di carboni. Celle scure con le crepe incandescenti, che pulsano piano e a chiazze
Effect.ShadersStore.sqEmberVertexShader = `
  precision highp float;
  attribute vec3 position;
  #include<instancesDeclaration>
  uniform mat4 viewProjection;
  varying vec3 vP; varying float vUp;
  void main() {
    #include<instancesVertex>
    vec4 p = finalWorld * vec4(position, 1.0);
    vP = p.xyz; vUp = position.y * 2.0;
    gl_Position = viewProjection * p;
  }`;
Effect.ShadersStore.sqEmberFragmentShader = `
  precision highp float;
  uniform float time;
  varying vec3 vP; varying float vUp;
  ${NOISE}
  void main() {
    vec2 p = vP.xz * 16.0;
    // carboni: celle (la distanza dal centro della cella più vicina dà il sasso, il bordo dà la crepa)
    vec2 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
    for (int a = -1; a <= 1; a++) for (int b = -1; b <= 1; b++) {
      vec2 o = vec2(float(a), float(b)), c = o + vec2(sqHash(i + o), sqHash(i + o + 17.3)) - f; float d = dot(c, c);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    float crack = smoothstep(0.22, 0.0, sqrt(d2) - sqrt(d1));
    float heat = sqFbm(vP.xz * 5.0 + vec2(time * 0.07, -time * 0.05)) * (0.75 + 0.25 * sin(time * 1.3 + vP.x * 9.0 + vP.z * 7.0));
    float glow = clamp(crack * 0.9 + smoothstep(0.5, 0.85, heat) * 0.7, 0.0, 1.0) * smoothstep(-0.2, 0.5, vUp) * (0.55 + 0.6 * heat);
    vec3 col = vec3(0.012, 0.011, 0.011) + vec3(0.03, 0.028, 0.026) * sqNoise(p * 3.0) + sqHeat(glow * 0.8) * glow * 1.25;
    gl_FragColor = vec4(col, 1.0);
  }`;

const seed = (f: P, k = 0): number => Math.abs(Math.sin(f.x * 12.9898 + f.z * 78.233 + f.y * 37.719 + k * 4.1) * 43758.5453) % 1;

/** Disegna tutto ciò che è stato dichiarato fin qui. `update(t, tone)`: il tempo in secondi, e quanto è chiaro il fumo (la luce del momento, 0..1). */
export function createFlames(scene: Scene): { meshes: Mesh[]; update(time: number, tone: number): void } {
  const mat = (name: string, vertex: string, attributes: string[], blend: boolean): ShaderMaterial => {
    const m = new ShaderMaterial(name, scene, { vertex, fragment: name }, { attributes, uniforms: ["world", "view", "viewProjection", "time", "shape", "tone"], needAlphaBlending: blend });
    m.backFaceCulling = false;
    if (blend) m.disableDepthWrite = true;
    return m;
  };
  const flameMat = mat("sqFlame", "sqFlame", ["position", "uv", "fx"], true), smokeMat = mat("sqSmoke", "sqFlame", ["position", "uv", "fx"], true), emberMat = mat("sqEmber", "sqEmber", ["position"], false);
  flameMat.alphaMode = Constants.ALPHA_ADD;
  flameMat.setVector4("shape", new Vector4(1, 1.25, 0, 0.45));
  smokeMat.setVector4("shape", new Vector4(1.5, 3.4, 0.75, 2.6));
  // le istanze: per ogni fiammella una; per ogni fuoco due strati (semi e misure diversi) e una colonna di fumo
  const world: number[] = [], fx: number[] = [], sWorld: number[] = [], sFx: number[] = [], m = new Matrix(), row = new Float32Array(16);
  const push = (to: number[], f: Flame, w: number, h: number): void => { Matrix.ScalingToRef(w, h, w, m); m.setTranslationFromFloats(f.x, f.y, f.z); m.copyToArray(row); to.push(...row); };
  for (const f of FLAMES) {
    if (!f.w) { push(world, f, f.h * 0.9, f.h); fx.push(seed(f), f.wind, 0, 0); continue; }
    for (const [k, kw, kh] of [[0, 1.5, 1.3], [1, 1.2, 1.05]]) { push(world, f, f.w * kw, f.h * kh); fx.push(seed(f, k), f.wind, 1, 0); }
    push(sWorld, f, f.w, f.h); sFx.push(seed(f, 2), Math.max(0.25, f.wind), 0, 0);
  }
  const quads = ([["fiamme", flameMat, world, fx], ["fumo", smokeMat, sWorld, sFx]] as const).map(([name, material, w, x]) => {
    const q = MeshBuilder.CreatePlane(name, { size: 1 }, scene);
    q.material = material; q.isPickable = false; q.alwaysSelectAsActiveMesh = true;
    q.thinInstanceSetBuffer("matrix", new Float32Array(w), 16, true);
    q.thinInstanceSetBuffer("fx", new Float32Array(x), 4, true);
    q.setEnabled(x.length > 0);
    return q;
  });
  // le braci: mezza sfera schiacciata, una per letto
  const coal = MeshBuilder.CreateSphere("braci", { diameter: 2, segments: 10, slice: 0.5 }, scene), eWorld = new Float32Array(EMBERS.length * 16);
  EMBERS.forEach((e, i) => { Matrix.ScalingToRef(e.r, e.r * 0.3, e.r, m); m.setTranslationFromFloats(e.x, e.y, e.z); m.copyToArray(eWorld, i * 16); });
  coal.material = emberMat; coal.isPickable = false; coal.alwaysSelectAsActiveMesh = true;
  coal.thinInstanceSetBuffer("matrix", eWorld, 16, true);
  coal.setEnabled(EMBERS.length > 0);
  return {
    meshes: [...quads, coal],
    update(time, tone) { for (const s of [flameMat, smokeMat, emberMat]) { s.setFloat("time", time); s.setFloat("tone", tone); } },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LA LUCE DEL FUOCO — le fiamme più vicine a chi guarda sono luci vere: illuminano muri, selciato,
// persone e spada, tremolano con la fiamma, e la più vicina fa ombre che si muovono.
// Le luci sono poche (`POOL`) e passano da un fuoco all'altro man mano che ci si sposta, sfumando.
// ⚠️ Le prendono solo i materiali che prendono luce (PBR: città, terreno, abitanti, creature, spada):
// i muri degli interni hanno la luce cotta sui vertici e non la vedono (la loro trema già da sé).
// ─────────────────────────────────────────────────────────────────────────────

const POOL = 3, REACH = 24, COLOR = new Color3(1, 0.56, 0.24);

/** Un fuoco che fa luce: più fiamme vicine (i ceri di un candeliere) contano per uno. */
interface Source { p: Vector3; power: number; seed: number }

function sources(): Source[] {
  const out: Source[] = [];
  for (const f of FLAMES) {
    const power = f.w ? Math.min(2.2, f.h * 1.6 + f.w) : f.h;
    const near = out.find((s) => Math.hypot(s.p.x - f.x, s.p.z - f.z) < 0.8 && Math.abs(s.p.y - f.y) < 0.8);
    if (near) { near.power = Math.min(2.2, near.power + power); near.p.y = Math.max(near.p.y, f.y + f.h * 0.5); continue; }
    out.push({ p: new Vector3(f.x, f.y + f.h * 0.5, f.z), power, seed: (f.x * 7.31 + f.z * 3.17) % 6.28 });
  }
  return out;
}

/**
 * Le luci delle fiamme. `casters` = ciò che fa ombra alla luce più vicina. `setLevel`: 0 spente, 1 luci, 2 luci e ombre
 * (impostazioni). `update` va chiamata a ogni frame con il tempo delle fiamme e dove sta chi guarda.
 */
export function createFlameLights(scene: Scene, casters: AbstractMesh[]): { setLevel(level: number): void; update(dt: number, time: number, eye: Vector3): void } {
  const all = sources();
  const pool = Array.from({ length: POOL }, (_, i) => {
    const light = new PointLight(`fuoco${i}`, Vector3.Zero(), scene);
    light.diffuse = COLOR; light.specular = COLOR.scale(0.4); light.intensity = 0;
    // ⚠️ niente legge dell'inverso del quadrato: a un palmo dalla fiamma (la pietra del camino, il bordo della forgia) brucia tutto a bianco
    light.falloffType = Light.FALLOFF_STANDARD;
    return { light, src: null as Source | null, k: 0 };
  });
  // ogni materiale che prende luce deve poterne contare qualcuna in più (sole, cielo e queste)
  for (const m of scene.materials) if ("maxSimultaneousLights" in m) (m as unknown as { maxSimultaneousLights: number }).maxSimultaneousLights = 2 + POOL;
  const shadow = new ShadowGenerator(512, pool[0].light);
  shadow.usePoissonSampling = true; shadow.bias = 0.012; shadow.normalBias = 0.02; shadow.setDarkness(0.25);
  shadow.getShadowMap()!.renderList = casters;
  let level = 2, wait = 0;
  return {
    // ⚠️ Le luci restano SEMPRE accese e si spengono portando l'intensità a zero. Accendere o spegnere una luce cambia il
    // numero di luci della scena, e Babylon ricompila lo shader di ogni materiale che prende luce: camminando in città erano
    // centinaia di ricompilazioni, con blocchi di secondi durante i quali i materiali non si disegnavano (restavano solo le fiamme).
    // Solo il selettore delle impostazioni le accende e le spegne davvero (una ricompilazione, quando lo si tocca).
    setLevel(l) {
      level = l; pool[0].light.shadowEnabled = l > 1;
      for (const q of pool) { q.light.setEnabled(l > 0); if (!l) { q.light.intensity = 0; q.k = 0; q.src = null; } }
    },
    update(dt, time, eye) {
      if (!level) return;
      if ((wait -= dt) <= 0) {
        // ogni tanto: i fuochi più vicini (uno grande conta come più vicino) si prendono le luci; chi ne aveva una la tiene
        wait = 0.3;
        const best = all.map((s) => ({ s, d: Vector3.Distance(s.p, eye) - s.power * 3 })).filter((c) => c.d < REACH).sort((a, b) => a.d - b.d).slice(0, POOL).map((c) => c.s);
        for (const q of pool) if (q.src && !best.includes(q.src)) q.src = null;   // (si spegne sfumando, poi è libera)
        for (const s of best) {
          if (pool.some((q) => q.src === s)) continue;
          const free = pool.find((q) => !q.src && q.k < 0.02);
          if (free) { free.src = s; free.light.position.copyFrom(s.p); }
        }
      }
      for (const q of pool) {
        q.k = Math.max(0, Math.min(1, q.k + (q.src ? dt * 3 : -dt * 4)));
        if (!q.src) { q.light.intensity *= Math.max(0, 1 - dt * 4); if (q.k <= 0) q.light.intensity = 0; continue; }
        const s = q.src, fl = 1 + 0.13 * Math.sin(time * 9.3 + s.seed) + 0.09 * Math.sin(time * 23 + s.seed * 1.7) + 0.05 * Math.sin(time * 41 + s.seed * 2.3);
        q.light.intensity = (0.7 + 0.9 * s.power) * fl * q.k; q.light.range = 5 + 4.5 * s.power;
        // la fiamma si sposta appena: le ombre tremano con lei
        q.light.position.set(s.p.x + Math.sin(time * 7.1 + s.seed) * 0.02, s.p.y + Math.sin(time * 11.3 + s.seed) * 0.015, s.p.z + Math.cos(time * 8.3 + s.seed) * 0.02);
      }
    },
  };
}
