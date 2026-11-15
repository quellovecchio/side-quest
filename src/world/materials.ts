import { Color3, Constants, DirectionalLight, RawTexture, Scene, ShadowGenerator, Texture, Vector3, type AbstractMesh, type Effect } from "@babylonjs/core";
import { CustomMaterial, PBRCustomMaterial } from "@babylonjs/materials";
import { CLOUD_FUNCS, CloudField } from "../sky/Clouds";
import type { TexPair } from "./textures";

// ─────────────────────────────────────────────────────────────────────────────
// MATERIALI — tutti PBR (luci, ombre a cascata e nebbia di Babylon restano), con
// pezzi di shader iniettati da PBRCustomMaterial:
//   · vento: i vertici ondeggiano in proporzione all'altezza locale (erba, felci, chiome);
//   · terreno: erba / sottobosco / sentiero / roccia mescolati PER ALTEZZA dalla splat map,
//     roccia triplanare sui pendii, anti-tiling a due scale;
//   · roccia: triplanare, muschio sulle facce rivolte in su.
// ⚠️ Il codice va in Fragment_Before_Lights: è l'unico punto dentro main() dove
// surfaceAlbedo e normalW sono già definiti e non ancora consumati dalla luce.
// ⚠️ PBRCustomMaterial sostituisce la PRIMA occorrenza di "result" nei pezzi di shader:
// la parola non va mai usata qui dentro.
// ─────────────────────────────────────────────────────────────────────────────

let time = 0;
let ticking = false;
function tick(scene: Scene): void {
  if (ticking) return;
  ticking = true;
  scene.onBeforeRenderObservable.add(() => { time += scene.getEngine().getDeltaTime() / 1000; });
}

const GLSL_COMMON = `
vec3 sq_lin(vec3 c) { return pow(c, vec3(2.2)); }
vec3 sq_nm(vec4 t) { return t.xyz * 2.0 - 1.0; }
// normal map su proiezione planare XZ (uv = xz): tangente +X, bitangente +Z
vec3 sq_planarN(vec3 tn, vec3 N) {
  vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
  vec3 B = cross(T, N);
  return normalize(T * tn.x + B * tn.y + N * tn.z);
}
vec3 sq_triW(vec3 N) { vec3 w = pow(abs(N), vec3(4.0)); return w / (w.x + w.y + w.z); }
// triplanare "whiteout" (Golus): albedo in rgb, altezza in a
vec4 sq_triA(sampler2D tex, vec3 p, vec3 w) {
  return texture2D(tex, p.zy) * w.x + texture2D(tex, p.xz) * w.y + texture2D(tex, p.xy) * w.z;
}
vec3 sq_triN(sampler2D tex, vec3 p, vec3 N, vec3 w) {
  vec3 tx = sq_nm(texture2D(tex, p.zy)), ty = sq_nm(texture2D(tex, p.xz)), tz = sq_nm(texture2D(tex, p.xy));
  tx = vec3(tx.xy + N.zy, abs(tx.z) * N.x);
  ty = vec3(ty.xy + N.xz, abs(ty.z) * N.y);
  tz = vec3(tz.xy + N.xy, abs(tz.z) * N.z);
  return normalize(tx.zyx * w.x + ty.xzy * w.y + tz.xyz * w.z);
}
// peso del layer B sopra A: la maschera decide dove, le altezze decidono il bordo
float sq_hb(float mask, float ha, float hb) {
  float t = mask * 1.4 - 0.2 + (hb - ha) * 0.5;
  return smoothstep(0.42, 0.58, t);
}
`;

/** Vento: `amp` = ondeggiamento in punta (m), `flutter` = tremolio fine, `ref` = altezza della punta. */
export function addWind(mat: PBRCustomMaterial, amp: number, flutter: number, ref: number): void {
  const scene = mat.getScene();
  tick(scene);
  mat.AddUniform("sqTime", "float", undefined);
  mat.AddUniform("sqWind", "vec3", undefined);
  mat.Vertex_After_WorldPosComputed(`
    float sqH = clamp(positionUpdated.y / sqWind.z, 0.0, 1.5);
    float sqPh = dot(worldPos.xz, vec2(0.071, 0.093));
    vec2 sqGust = vec2(sin(sqTime * 0.9 + sqPh), cos(sqTime * 0.7 + sqPh * 1.3)) * (0.6 + 0.4 * sin(sqTime * 0.23 + sqPh * 0.2));
    vec2 sqFl = vec2(sin(sqTime * 5.3 + sqPh * 9.0 + positionUpdated.x * 4.0), cos(sqTime * 4.7 + sqPh * 7.0 + positionUpdated.z * 4.0));
    worldPos.xz += sqGust * sqWind.x * sqH * sqH + sqFl * sqWind.y * sqH;
    vPositionW = worldPos.xyz;
  `);
  // ⚠️ Non onBindObservable + getEffect(): il PBR disegna con l'effect del submesh, e getEffect()
  // restituisce un altro effect; le uniform restavano a zero e sqWind.z = 0 mandava i vertici a NaN.
  const attach = mat.AttachAfterBind.bind(mat);
  mat.AttachAfterBind = (mesh, effect) => {
    attach(mesh, effect);
    effect.setFloat("sqTime", time);
    effect.setFloat3("sqWind", amp, flutter, ref);
  };
}

/**
 * Stoffa al vento (drappi, bandierine, teli dei banchi): un vertice con l'alfa del colore sotto 1 ondeggia lungo la sua
 * normale, tanto di più quanto più l'alfa è bassa (peso = 1 − alfa: l'orlo appeso sta fermo, quello libero sbatte).
 * Le raffiche sono quelle dell'erba.
 */
export function addFlutter(mat: PBRCustomMaterial): void {
  tick(mat.getScene());
  mat.AddUniform("sqTime", "float", undefined);
  mat.Vertex_Before_PositionUpdated(`
    #ifdef VERTEXCOLOR
    float sqFw = 1.0 - color.a;
    if (sqFw > 0.0) {
      float sqFp = dot(position.xz, vec2(0.61, 0.47));
      float sqFg = 0.55 + 0.45 * sin(sqTime * 0.23 + sqFp * 0.2);
      positionUpdated += normal * ((sin(sqTime * 2.1 + sqFp * 1.9 + position.y * 2.3) * 0.17 + sin(sqTime * 5.3 + sqFp * 4.1 + position.y * 6.0) * 0.045) * sqFw * sqFg);
    }
    #endif
  `);
  const attach = mat.AttachAfterBind.bind(mat);
  mat.AttachAfterBind = (mesh, effect) => { attach(mesh, effect); effect.setFloat("sqTime", time); };
}

// il muschio sui muri e sui tetti della città: rumore a chiazze, più fitto al piede dei muri e sulle facce che guardano in su
const MOSS_GLSL = `
float sqMh(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sqMn(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sqMh(i), sqMh(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sqMh(i + vec3(0.0, 1.0, 0.0)), sqMh(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(sqMh(i + vec3(0.0, 0.0, 1.0)), sqMh(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sqMh(i + vec3(0.0, 1.0, 1.0)), sqMh(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}`;

// ── Lampioni ─────────────────────────────────────────────────────────────────
// La luce dei lampioni non è una luce (il PBR ne regge poche e la città ha una ventina di lanterne): è COTTA in una
// texture vista dall'alto che copre la città. Ogni texel dice quanta luce arriva lì (b, in radice) e da che parte
// (r, g: il verso orizzontale medio verso le lanterne). I materiali la leggono con la posizione nel mondo e la
// sommano alla luce diffusa: selciato, muri, botti, abitanti e mani di chi gioca prendono la pozza calda, chi volta
// le spalle alla lanterna no. Costa una lettura di texture per pixel, e nulla quando è spenta (di giorno).
// La quota delle fiamme che illuminano un texel sta nell'alfa (sopra la più bassa, fino a `LAMP_SPAN` metri): la città
// ha colline, e una lanterna sul promontorio sta 30 m sopra una della piazza.
// ponytail: niente ombre portate (la luce passa i muri: con 6,5 m di raggio non si nota); se servono ombre vere, si
// cuoce un'occlusione per lanterna nella stessa texture.
const LAMP_SPAN = 64;
const LAMP = { n: 256, reach: 6.5, tex: null as RawTexture | null, rect: [0, 0, 1, 1], y: 0, glow: 0, on: true, color: new Color3(1.2, 0.62, 0.24) };

function lampTex(scene: Scene): RawTexture {
  if (!LAMP.tex) {
    LAMP.tex = RawTexture.CreateRGBATexture(new Uint8Array(LAMP.n * LAMP.n * 4), LAMP.n, LAMP.n, scene, false, false, Texture.BILINEAR_SAMPLINGMODE);
    LAMP.tex.wrapU = LAMP.tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  }
  return LAMP.tex;
}

/** Cuoce la luce delle lanterne (posizioni nel mondo) sul rettangolo [x0, z0, larghezza, profondità], che deve contenerle con `reach` metri di margine. */
export function bakeLamps(scene: Scene, lamps: { x: number; y: number; z: number; k?: number; r?: number }[], rect: [number, number, number, number]): void {
  const n = LAMP.n, sum = new Float32Array(n * n * 3), high = new Float32Array(n * n), data = new Uint8Array(n * n * 4);
  const low = Math.min(...lamps.map((l) => l.y));
  for (const l of lamps) {
    const R = l.r ?? LAMP.reach, K = l.k ?? 1;   // (una finestra accesa o un uscio aperto: più debole e più corta di una lanterna)
    const i0 = Math.max(0, Math.floor((l.x - R - rect[0]) / rect[2] * n)), i1 = Math.min(n - 1, Math.ceil((l.x + R - rect[0]) / rect[2] * n));
    const j0 = Math.max(0, Math.floor((l.z - R - rect[1]) / rect[3] * n)), j1 = Math.min(n - 1, Math.ceil((l.z + R - rect[1]) / rect[3] * n));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = l.x - (rect[0] + (i + 0.5) / n * rect[2]), dz = l.z - (rect[1] + (j + 0.5) / n * rect[3]), d = Math.hypot(dx, dz);
      if (d >= R) continue;
      const c = K * (1 - (d / R) ** 2) ** 2, k = (j * n + i) * 3, u = c / Math.max(d, 0.35);   // proprio sotto la lanterna la luce viene dall'alto: nessun verso
      sum[k] += c; sum[k + 1] += dx * u; sum[k + 2] += dz * u; high[k / 3] += c * l.y;
    }
  }
  for (let k = 0; k < n * n; k++) {
    const c = sum[k * 3];
    if (c <= 0) continue;
    data[k * 4] = 127.5 + 127.5 * sum[k * 3 + 1] / c; data[k * 4 + 1] = 127.5 + 127.5 * sum[k * 3 + 2] / c;
    data[k * 4 + 2] = 255 * Math.sqrt(Math.min(1, c)); data[k * 4 + 3] = 255 * Math.min(1, Math.max(0, (high[k] / c - low) / LAMP_SPAN));
  }
  lampTex(scene).update(data);
  LAMP.rect = rect;
  LAMP.y = Number.isFinite(low) ? low : 0;   // (la quota più bassa: l'alfa di ogni texel dice quanto più in alto)
}

/** Quanto sono accese le lanterne (0..1: lo decide l'ora) e se la loro luce si disegna (impostazioni grafiche). */
export function setLampGlow(k: number): void { LAMP.glow = k; }
export function setLampLight(on: boolean): void { LAMP.on = on; }

// ── Ombre di chi si muove ────────────────────────────────────────────────────
// Il sole ha una mappa d'ombre disegnata una volta, i lampioni e gli interni hanno la luce cotta: nessuna di queste luci
// può fare l'ombra di chi cammina con una mappa. La fa il conto: chi si muove (chi gioca e gli abitanti più vicini) è una
// pila di tre sfere, e ogni pixel che prende una di quelle luci guarda se una sfera sta fra sé e la luce (la distanza della
// sfera dal segmento pixel → luce), col bordo sfumato. Vale per il sole (verso fisso), per la pozza dei lampioni (il verso
// che la texture cotta già dà) e, dentro, per i due fuochi e la finestra più vicini a chi gioca (`setShadeLights`).
// I fuochi veri più vicini hanno invece una mappa d'ombre vera (flames.ts).
// ponytail: dodici sfere (quattro corpi), sagome a pupazzo e non la figura vera; per di più serve una cascata d'ombre
// vicina che si ridisegna a ogni fotogramma.
const NS = 12;
const SHADE = { s: new Float32Array(NS * 4), sun: new Vector3(0, 1, 0), k: 0, l: new Float32Array(12) };
/** Le sfere di chi fa ombra [x, y, z, raggio, …] (nel mondo), il verso DEL sole e quanto pesa la sua ombra (0 di notte). */
export function setShade(spheres: number[], toSun: Vector3, k: number): void { SHADE.s.fill(0); SHADE.s.set(spheres.slice(0, NS * 4)); SHADE.sun.copyFrom(toSun); SHADE.k = k; }
/** Dentro: le luci cotte che fanno ombra, [x, y, z, portata] per due fuochi e una finestra (zeri = nessuna). */
export function setShadeLights(l: number[]): void { SHADE.l.fill(0); SHADE.l.set(l.slice(0, 12)); }
/** GLSL: mette in `out` (float già dichiarato) quanta ombra fanno le sfere sul punto P rispetto alla luce in L. */
const occ = (P: string, L: string, out: string): string => `{ vec3 sqD = ${L} - ${P}; float sqD2 = max(dot(sqD, sqD), 1e-4);
  ${Array.from({ length: NS }, (_, i) => `if (sqO${i}.w > 0.0) { vec3 c = sqO${i}.xyz - ${P}; if (dot(c, c) > sqO${i}.w * sqO${i}.w * 1.25) { float e = length(c - sqD * clamp(dot(c, sqD) / sqD2, 0.0, 1.0)); ${out} = max(${out}, 1.0 - smoothstep(sqO${i}.w * 0.6, sqO${i}.w * 1.3, e)); } }`).join("\n  ")} }`;
const shadeUniforms = (m: { AddUniform(name: string, kind: string, param: unknown): unknown }): void => { for (let i = 0; i < NS; i++) m.AddUniform(`sqO${i}`, "vec4", undefined); };
const bindShade = (effect: Effect): void => { for (let i = 0; i < NS; i++) effect.setFloat4(`sqO${i}`, SHADE.s[i * 4], SHADE.s[i * 4 + 1], SHADE.s[i * 4 + 2], SHADE.s[i * 4 + 3]); };

// ── L'ombra vera di chi si muove sotto il sole ───────────────────────────────
// La mappa d'ombre del sole è una sola, grande, disegnata una volta: chi cammina non c'è. Per loro c'è una seconda mappa,
// piccola (2048 su 44 m attorno a chi gioca), ridisegnata a ogni fotogramma con SOLO chi si muove (abitanti vicini, la
// sagoma di chi gioca, la sua spada e il suo scudo): costa poche mesh. La disegna un generatore d'ombre di Babylon appeso a
// una seconda luce direzionale che non illumina niente (`includedOnlyMeshes`: nessun materiale la conta); i materiali la
// leggono a mano in `lampLit` e tolgono la luce diretta. Una luce sola non può avere due mappe: per questo il giro.
const LIVE = { gen: null as ShadowGenerator | null, light: null as DirectionalLight | null, size: 44, depth: 90 };
function liveShadow(scene: Scene): ShadowGenerator {
  if (!LIVE.gen) {
    const l = new DirectionalLight("ombreVive", new Vector3(0, -1, 0), scene);
    l.intensity = 0; l.shadowFrustumSize = LIVE.size; l.shadowMinZ = 1; l.shadowMaxZ = LIVE.depth;
    const g = new ShadowGenerator(2048, l);
    g.bias = 0; g.getShadowMap()!.renderList = [];
    LIVE.gen = g; LIVE.light = l;
  }
  return LIVE.gen;
}
/**
 * Una volta per fotogramma: chi fa ombra al sole (`casters`, solo chi sta vicino), attorno a quale punto, da che parte
 * viene la luce. `only` = una mesh qualsiasi che non si disegna: la luce finta illumina solo quella, cioè niente.
 */
export function setLiveShadow(scene: Scene, casters: AbstractMesh[], at: Vector3, sunDir: Vector3, only: AbstractMesh): void {
  const g = liveShadow(scene), l = LIVE.light!;
  if (!l.includedOnlyMeshes.length) l.includedOnlyMeshes = [only];
  g.getShadowMap()!.renderList = casters;
  l.direction.copyFrom(sunDir);
  l.position.copyFrom(at).addInPlace(sunDir.scale(-LIVE.depth / 2));
}

// ── Le ombre delle nuvole ────────────────────────────────────────────────────
// Il cielo disegna un campo di nuvole che scorre col vento (sky/Clouds.ts); lo stesso campo, letto da terra, dice quanto
// un punto sta sotto una nuvola: da ogni pixel si risale verso il sole fino allo strato e si legge la stessa densità
// (`cloudShadowAt`). Così la macchia d'ombra che passa sulla piazza è proprio la nuvola che si vede in cielo. Toglie la sola
// luce diretta (quella d'ambiente resta), e solo di giorno: di notte spegnerebbe la luce dei fuochi sotto ogni nuvola.
// La prendono tutti i materiali all'aperto: quelli di `lampLit` e, con `cloudLit`, pelo, fogliame, erba, rocce, cortecce.
const CLOUD = { day: 0, on: true };
/** Quanto è giorno (0 di notte … 1) e se le ombre delle nuvole si disegnano (impostazioni). */
export function setCloudShadows(day: number): void { CLOUD.day = day; }
export function setCloudShadowsOn(on: boolean): void { CLOUD.on = on; }
const CLOUD_CODE = `
    if (cloudSun.w > 0.0) {
      float sqCs = 1.0 - cloudSun.w * cloudShadowAt(vPositionW);
      finalDiffuse *= sqCs;
      #ifdef SPECULARTERM
      finalSpecularScaled *= sqCs;
      #endif
    }`;
/** Dichiara ciò che serve a `CLOUD_CODE`. Le funzioni vanno in coda alle definizioni del materiale, chiunque le scriva e quando. */
function cloudUniforms(m: PBRCustomMaterial): boolean {
  const done = m as unknown as { sqClouds?: boolean };
  if (done.sqClouds) return false;   // (già fatto: un materiale passa di qui una volta sola, o le uniform si dichiarano due volte)
  done.sqClouds = true;
  for (const u of ["cloudShape", "cloudWind", "cloudSun"]) m.AddUniform(u, "vec4", undefined);
  const defs = m.Fragment_Definitions.bind(m);
  m.CustomParts.Fragment_Definitions = (m.CustomParts.Fragment_Definitions ?? "") + CLOUD_FUNCS;
  m.Fragment_Definitions = (code: string) => defs(code + CLOUD_FUNCS);
  return true;
}
function bindClouds(m: PBRCustomMaterial, effect: Effect): void {
  const c = CloudField.of(m.getScene());
  if (!c) { effect.setFloat4("cloudSun", 0, 1, 0, 0); return; }
  effect.setVector4("cloudShape", c.shape); effect.setVector4("cloudWind", c.wind);
  effect.setFloat4("cloudSun", c.sun.x, c.sun.y, c.sun.z, CLOUD.on ? c.sun.w * CLOUD.day * 0.75 : 0);   // (un poco meno della forza piena: col cielo coperto a metà la città restava quasi sempre spenta)
}
/** Le ombre delle nuvole su un materiale che non passa da `lampLit`. Va chiamata per ultima (dopo che il materiale ha messo il suo `AttachAfterBind`). */
export function cloudLit(m: PBRCustomMaterial): void {
  if (!cloudUniforms(m)) return;   // (ha già `lampLit`, che le comprende)
  m.Fragment_Before_FinalColorComposition(CLOUD_CODE);
  const attach = m.AttachAfterBind.bind(m);
  m.AttachAfterBind = (mesh, effect) => { attach(mesh, effect); bindClouds(m, effect); };
}

// ── Cel shading ──────────────────────────────────────────────────────────────
// La luce a gradini: invece di sfumare, la luce diretta di ogni pixel cade su pochi toni netti (con un filo di passaggio fra
// l'uno e l'altro, o il bordo del gradino sfarfalla). Non cambia le luci né le ombre, solo come si leggono: campiture
// piatte, da disegno. Vale per tutti i materiali che passano da `lampLit` e per gli interni (lì è la luce cotta a gradini).
const CEL = { on: 0 };
export function setCel(on: boolean): void { CEL.on = on ? 1 : 0; }
// Col cel shading i materiali che hanno una texture DIPINTA (textures.ts, `paintedTex`) la prendono al posto della foto:
// chi crea un materiale iscrive qui come scambiarle, e `setPainted` le scambia tutte.
const PAINT: ((on: boolean) => void)[] = [];
export function onPainted(f: (on: boolean) => void): void { PAINT.push(f); }
export function setPainted(on: boolean): void { for (const f of PAINT) f(on); }
/** GLSL: una quantità di luce `l` portata al gradino più vicino, larghi `step`. */
// ⚠️ Sotto mezzo gradino la luce resta com'è: col primo gradino a zero, tutto ciò che stava in ombra (sotto una nuvola, col
// sole basso, sul lato in ombra di una persona) usciva NERO pieno, perché lì arriva solo la luce del cielo, che è poca.
// E il passaggio fra un gradino e l'altro è largo (0,3–0,7): stretto, sul bordo sfumato di un'ombra faceva i denti.
const bands = (l: string, step: number): string => `max((floor(${l} / ${step.toFixed(3)}) + smoothstep(0.3, 0.7, fract(${l} / ${step.toFixed(3)}))) * ${step.toFixed(3)}, min(${l}, ${(step * 0.5).toFixed(3)}))`;

const v3 = (c: Color3): string => `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;

/**
 * Fa prendere al materiale la luce cotta dei lampioni. Con `indoor` (i colori della luce degli interni) anche quella di
 * dentro: una mesh che dichiara `metadata.indoor = [fuoco, finestre, quanto]` (chi cammina in una stanza: npcs.ts) lascia
 * il sole e il cielo di fuori e prende la luce della stanza, come i muri che ha attorno. Senza, di notte un abitante
 * resta scuro in una sala illuminata e di giorno troppo chiaro. `gloss` (i metalli di chi gioca: lama, ferri) = quanto
 * la luce di dentro ci si RIFLETTE: un lampo verso il fuoco e uno verso la finestra, al posto del cielo di fuori.
 */
export function lampLit(m: PBRCustomMaterial, indoor?: { warm: Color3; cold: Color3; ambient: Color3 }, gloss = 0): void {
  m.AddUniform("sqLampMap", "sampler2D", lampTex(m.getScene()));
  m.AddUniform("sqLampRect", "vec4", undefined);
  m.AddUniform("sqLamp", "vec4", undefined);   // rgb = colore per forza (zero = spenta), a = quota delle fiamme
  shadeUniforms(m);
  m.AddUniform("sqSun", "vec4", undefined);   // xyz = verso il sole, w = quanto pesa la sua ombra (negativo: questa mesh non prende ombre)
  m.AddUniform("sqL0", "vec4", undefined);
  m.AddUniform("sqCel", "float", undefined);
  m.AddUniform("sqLive", "sampler2D", liveShadow(m.getScene()).getShadowMap());
  m.AddUniform("sqLiveM", "mat4", undefined);
  m.AddUniform("sqLiveK", "float", undefined);   // 0 = questa mesh non prende l'ombra della mappa piccola (chi la proietta: vedi sotto)
  if (indoor) { m.AddUniform("sqIndoor", "vec3", undefined); m.AddUniform("sqDay", "vec3", undefined); m.AddUniform("sqInW", "vec3", undefined); m.AddUniform("sqInC", "vec3", undefined); }
  cloudUniforms(m);
  m.Fragment_Before_FinalColorComposition(`
    // cel shading: la luce diretta (quanta ne arriva, tolto il colore della superficie) a gradini. Va PRIMA delle ombre
    // fatte a mano qui sotto (nuvole, chi si muove): quelle sfumano, e una sfumatura messa sui gradini li attraversa uno
    // alla volta ingigantendo ogni minima differenza fra un triangolo e l'altro (le "zigrinature" nell'ombra di una nuvola).
    // ⚠️ Nessun salto: un fattore che cambia di colpo a una certa luce fa lo stesso difetto.
    if (sqCel > 0.5) {
      float sqAl = max(dot(surfaceAlbedo.rgb, vec3(0.299, 0.587, 0.114)), 0.02), sqLl = dot(finalDiffuse, vec3(0.299, 0.587, 0.114)) / sqAl;
      finalDiffuse *= ${bands("sqLl", 0.4)} / max(sqLl, 1e-4);
      #ifdef SPECULARTERM
      finalSpecularScaled = step(vec3(0.5), finalSpecularScaled) * finalSpecularScaled;   // il riflesso: o c'è o non c'è
      #endif
    }
    ${CLOUD_CODE}
    if (sqSun.w > 0.0 && sqLiveK > 0.5) {   // l'ombra di chi si muove sotto il sole (la mappa piccola): toglie la luce diretta, quella d'ambiente resta
      vec4 sqQ = sqLiveM * vec4(vPositionW, 1.0);
      vec3 sqC = sqQ.xyz / sqQ.w * 0.5 + 0.5;
      float sqA = 0.0, sqE = min(min(sqC.x, 1.0 - sqC.x), min(sqC.y, 1.0 - sqC.y));
      if (sqE > 0.0 && sqC.z < 1.0) {
        for (int i = 0; i < 4; i++) {   // quattro letture attorno: il bordo sfuma di un texel
          vec2 o = vec2(i == 0 || i == 3 ? -0.8 : 0.8, i < 2 ? -0.8 : 0.8) / 2048.0;
          sqA += step(texture2D(sqLive, sqC.xy + o).r, sqC.z - 0.0011);
        }
        sqA *= 0.25 * smoothstep(0.0, 0.06, sqE);
      }
      finalDiffuse *= 1.0 - sqSun.w * sqA;
      #ifdef SPECULARTERM
      finalSpecularScaled *= 1.0 - sqSun.w * sqA;
      #endif
    }
    if (sqLamp.r > 0.0) {
      vec4 sqL = texture2D(sqLampMap, (vPositionW.xz - sqLampRect.xy) / sqLampRect.zw);
      float sqUp = sqLamp.a + sqL.a * ${LAMP_SPAN.toFixed(1)} - vPositionW.y;
      // da dove viene: il verso orizzontale dal campo, per la distanza stimata da quanta luce arriva; la quota dalla fiamma
      vec2 sqH = (sqL.rg * 2.0 - 1.0) * ${LAMP.reach.toFixed(1)} * sqrt(max(0.0, 1.0 - sqL.b));
      float sqN = max(dot(normalW, normalize(vec3(sqH.x, max(sqUp, 0.3), sqH.y))), 0.0);
      // sopra la lanterna c'è il suo cappello di ferro: la luce si spegne salendo
      float sqB = 0.0;
      if (sqSun.w >= 0.0 && sqL.b > 0.02) ${occ("vPositionW", "(vPositionW + vec3(sqH.x, max(sqUp, 0.3), sqH.y))", "sqB")}
      finalDiffuse += surfaceAlbedo.rgb * sqLamp.rgb * (sqL.b * sqL.b * (0.25 + 0.75 * sqN) * smoothstep(-2.5, 0.3, sqUp) * (1.0 - 0.8 * sqB));
    }
    ${indoor ? `if (sqIndoor.z > 0.0) {
      // la luce di dentro ha un verso: il lato verso il fuoco (o la finestra) è in luce, l'altro in ombra; un verso nullo vale "da ogni parte"
      float sqNw = dot(sqInW, sqInW) > 0.01 ? 0.3 + 1.25 * max(dot(normalW, sqInW), 0.0) : 0.9;
      float sqNc = dot(sqInC, sqInC) > 0.01 ? 0.35 + 1.15 * max(dot(normalW, sqInC), 0.0) : 0.9;
      if (sqSun.w >= 0.0 && sqL0.w > 0.0 && distance(vPositionW, sqL0.xyz) < sqL0.w) {   // chi sta fra questo e il fuoco gli fa ombra
        float sqC = 0.0;
        ${occ("vPositionW", "sqL0.xyz", "sqC")}
        sqNw *= 1.0 - 0.7 * sqC;
      }
      finalDiffuse = mix(finalDiffuse, surfaceAlbedo.rgb * (${v3(indoor.warm)} * (sqIndoor.x * sqNw) + ${v3(indoor.cold)} * (sqIndoor.y * sqNc * sqDay) + ${v3(indoor.ambient)}), sqIndoor.z);
      #ifdef SPECULARTERM
      finalSpecularScaled *= 1.0 - sqIndoor.z;
      #endif
      ${gloss ? `vec3 sqR = reflect(-viewDirectionW, normalW);
      float sqGw = dot(sqInW, sqInW) > 0.01 ? pow(max(dot(sqR, sqInW), 0.0), 6.0) * 2.2 + 0.25 : 0.5;
      float sqGc = dot(sqInC, sqInC) > 0.01 ? pow(max(dot(sqR, sqInC), 0.0), 6.0) * 2.2 + 0.25 : 0.5;
      finalDiffuse += (${v3(indoor.warm)} * (sqIndoor.x * sqGw) + ${v3(indoor.cold)} * (sqIndoor.y * sqGc * sqDay)) * (${gloss.toFixed(2)} * sqIndoor.z);
      #ifdef REFLECTION
      finalRadianceScaled *= 1.0 - 0.85 * sqIndoor.z;
      #endif` : ""}
    }` : ""}
  `);
  const attach = m.AttachAfterBind.bind(m);
  m.AttachAfterBind = (mesh, effect) => {
    attach(mesh, effect);
    if (indoor) {
      const li = mesh?.metadata?.indoor as number[] | undefined;
      effect.setFloat3("sqIndoor", li?.[0] ?? 0, li?.[1] ?? 0, li?.[2] ?? 0);
      effect.setFloat3("sqInW", li?.[3] ?? 0, li?.[4] ?? 0, li?.[5] ?? 0); effect.setFloat3("sqInC", li?.[6] ?? 0, li?.[7] ?? 0, li?.[8] ?? 0);
      effect.setColor3("sqDay", daylight);
    }
    bindShade(effect);
    effect.setFloat4("sqSun", SHADE.sun.x, SHADE.sun.y, SHADE.sun.z, mesh?.metadata?.noShade ? -1 : SHADE.k);
    effect.setFloat4("sqL0", SHADE.l[0], SHADE.l[1], SHADE.l[2], SHADE.l[3]);
    effect.setMatrix("sqLiveM", LIVE.gen!.getTransformMatrix());
    // chi sta nella mappa piccola non ne prende l'ombra: su un corpo, a 2 cm per texel e senza sfumatura, la sua stessa
    // ombra usciva a macchie dure (il braccio sul fianco, il mento sul petto). L'ombra vera dei fuochi la prende comunque.
    effect.setFloat("sqLiveK", mesh?.skeleton ? 0 : 1);
    effect.setFloat("sqCel", CEL.on);
    bindClouds(m, effect);
    const k = (LAMP.on ? LAMP.glow : 0) * (1 + 0.035 * Math.sin(time * 7.3) + 0.025 * Math.sin(time * 17.1 + 1.3));   // (la fiamma delle lanterne trema appena)
    effect.setFloat4("sqLampRect", LAMP.rect[0], LAMP.rect[1], LAMP.rect[2], LAMP.rect[3]);
    effect.setFloat4("sqLamp", LAMP.color.r * k, LAMP.color.g * k, LAMP.color.b * k, LAMP.y);
  };
}

export interface CreatureFx { flash: number; dissolve: number }

/**
 * Pelle delle creature: un materiale solo per tutte (uno shader solo da compilare). Il lampo rosso
 * del colpo e la dissolvenza in pulviscolo sono per-mesh: si leggono da `mesh.metadata.fx` al bind.
 * La dissolvenza è una soglia su un rumore 3D nello spazio mondo, con l'orlo che brucia.
 */
export function creatureMaterial(scene: Scene, fur: TexPair): PBRCustomMaterial {
  const m = new PBRCustomMaterial("furMat", scene);
  m.albedoTexture = fur.albedo;
  m.bumpTexture = fur.normal;
  m.metallic = 0;
  m.roughness = 0.95;
  m.AddUniform("sqFx", "vec2", undefined);
  m.Fragment_Definitions(`
float sq_h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sq_n3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sq_h3(i), sq_h3(i + vec3(1.0, 0.0, 0.0)), f.x), mix(sq_h3(i + vec3(0.0, 1.0, 0.0)), sq_h3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(sq_h3(i + vec3(0.0, 0.0, 1.0)), sq_h3(i + vec3(1.0, 0.0, 1.0)), f.x), mix(sq_h3(i + vec3(0.0, 1.0, 1.0)), sq_h3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`);
  m.Fragment_Before_Lights(`
    float sqEdge = 1.0;
    if (sqFx.y > 0.0) {
      float sqN = sq_n3(vPositionW * 11.0) * 0.65 + sq_n3(vPositionW * 31.0) * 0.35;
      sqEdge = sqN - (0.2 + sqFx.y * 0.68);   // il rumore sta quasi tutto fra 0,2 e 0,85
      if (sqEdge < 0.0) discard;
      surfaceAlbedo *= smoothstep(0.0, 0.3, sqEdge) * 0.75 + 0.25;   // incenerisce prima di sparire
    }
  `);
  m.Fragment_Before_FragColor(`
    finalColor.rgb += vec3(1.0, 0.4, 0.32) * sqFx.x;
    finalColor.rgb += vec3(1.7, 1.45, 1.0) * (1.0 - smoothstep(0.0, 0.06, sqEdge)) * step(0.001, sqFx.y);
  `);
  const attach = m.AttachAfterBind.bind(m);
  m.AttachAfterBind = (mesh, effect) => {
    attach(mesh, effect);
    const fx = mesh?.metadata?.fx as CreatureFx | undefined;
    effect.setFloat2("sqFx", fx?.flash ?? 0, fx?.dissolve ?? 0);
  };
  cloudLit(m);
  return m;
}

/** Corteccia, legno, pelle: PBR classico con albedo + normal map. */
/**
 * Il suolo sotto il muschio: la quota del terreno della città in una texture (un float per metro), letta con la posizione
 * nel mondo. Così il muschio sta al piede dei muri anche su una collina. Senza rilievo, un texel solo alla quota del piano.
 */
const MOSS = { tex: null as RawTexture | null, rect: [-1e5, -1e5, 2e5, 2e5] as number[] };
export function setMossGround(scene: Scene, ground: { y: Float32Array; w: number; h: number; rect: [number, number, number, number] } | null, flat: number): void {
  MOSS.tex?.dispose();
  const g = ground ?? { y: new Float32Array([flat]), w: 1, h: 1, rect: [-1e5, -1e5, 2e5, 2e5] as [number, number, number, number] };
  MOSS.tex = RawTexture.CreateRTexture(g.y, g.w, g.h, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  MOSS.tex.wrapU = MOSS.tex.wrapV = Texture.CLAMP_ADDRESSMODE;
  MOSS.rect = g.rect;
}

export function surfaceMaterial(scene: Scene, name: string, t: TexPair, opts: { tint?: Color3; rough?: number; uv?: [number, number]; /** Profondità del rilievo (parallasse), in unità di uv: 0 = niente. */ relief?: number; indoor?: { warm: Color3; cold: Color3; ambient: Color3 }; /** Muschio: `y` = la quota del suolo, `k` = quanto (0..1). */ moss?: { y: number; k: number } } = {}): PBRCustomMaterial {
  const m = new PBRCustomMaterial(name, scene);
  m.albedoTexture = t.albedo;
  m.bumpTexture = t.normal;
  m.albedoColor = opts.tint ?? Color3.White();
  m.metallic = 0;
  m.roughness = opts.rough ?? 0.9;
  if (t.arm) {
    // texture fotografica: occlusione, ruvidezza e metallo vengono dalla sua mappa (i numeri qui sopra diventano fattori)
    m.metallicTexture = t.arm; m.useAmbientOcclusionFromMetallicTextureRed = true; m.useRoughnessFromMetallicTextureGreen = true; m.useMetallnessFromMetallicTextureBlue = true;
    m.metallic = 1; m.roughness = 1;
  }
  if (t.relief && opts.relief) {
    // il rilievo sta nell'alfa delle normali: parallasse con occlusione (le pietre sporgono davvero, da ogni angolo)
    m.useParallax = true; m.useParallaxOcclusion = true; m.parallaxScaleBias = opts.relief;
  }
  if (opts.uv) for (const tx of [t.albedo, t.normal]) { (tx as Texture).uScale = opts.uv[0]; (tx as Texture).vScale = opts.uv[1]; }
  if (opts.moss) {
    m.Fragment_Definitions(MOSS_GLSL);
    // (la quota del suolo: dal rilievo della città, `setMossGround`, se c'è; altrimenti quella data)
    m.AddUniform("sqMossG", "sampler2D", MOSS.tex ?? undefined); m.AddUniform("sqMossR", "vec4", undefined);
    const attach = m.AttachAfterBind.bind(m);
    m.AttachAfterBind = (mesh, effect) => { attach(mesh, effect); if (MOSS.tex) effect.setTexture("sqMossG", MOSS.tex); effect.setFloat4("sqMossR", MOSS.rect[0], MOSS.rect[1], MOSS.rect[2], MOSS.rect[3]); };
    m.Fragment_Custom_Albedo(`
      float sqMy = vPositionW.y - ${MOSS.tex ? "texture2D(sqMossG, (vPositionW.xz - sqMossR.xy) / sqMossR.zw).r" : opts.moss.y.toFixed(2)};
      float sqMm = sqMn(vPositionW * 0.9) * 0.6 + sqMn(vPositionW * 3.1) * 0.4;
      float sqMk = smoothstep(0.56, 0.74, sqMm + (1.0 - smoothstep(0.0, 2.4, sqMy)) * 0.34 + clamp(normalize(vNormalW).y, 0.0, 1.0) * 0.14 - 0.08);
      surfaceAlbedo = mix(surfaceAlbedo, vec3(0.05, 0.085, 0.03) * (0.65 + 0.7 * sqMn(vPositionW * 9.0)), sqMk * ${opts.moss.k.toFixed(2)});
    `);
  }
  lampLit(m, opts.indoor);
  return m;
}

/** Fogliame a ritaglio (alpha test), doppia faccia, controluce traslucido. */
export function foliageMaterial(scene: Scene, name: string, t: TexPair, opts: { tint?: Color3; translucency?: number } = {}): PBRCustomMaterial {
  const m = new PBRCustomMaterial(name, scene);
  m.albedoTexture = t.albedo;
  m.useAlphaFromAlbedoTexture = true;
  m.transparencyMode = PBRCustomMaterial.PBRMATERIAL_ALPHATEST;
  m.alphaCutOff = 0.42;
  m.bumpTexture = t.normal;
  m.bumpTexture.level = 0.6;
  m.albedoColor = opts.tint ?? Color3.White();
  m.metallic = 0;
  m.roughness = 0.75;
  m.backFaceCulling = false;
  // ⚠️ niente twoSidedLighting: le normali delle chiome sono "a sfera" (dal centro della chioma
  // verso fuori) e rovesciarle sulle facce posteriori le annerirebbe a scacchi
  m.twoSidedLighting = false;
  // ⚠️ niente subSurface.translucency del PBR: senza mappa di spessore sbianca le chiome come neve
  void opts.translucency;
  cloudLit(m);
  return m;
}

/** Erba: niente texture, colore dai vertici (base scura → punta chiara) e per istanza. */
export function grassMaterial(scene: Scene): PBRCustomMaterial {
  const m = new PBRCustomMaterial("grassMat", scene);
  m.albedoColor = Color3.White();
  m.metallic = 0;
  m.roughness = 0.7;
  m.backFaceCulling = false;
  cloudLit(m);
  return m;
}

export interface TerrainTex {
  grass: TexPair; floor: TexPair; dirt: TexPair; rock: TexPair; moss: TexPair;
  /** Splat map e il rettangolo che copre: [x0, z0, larghezza, profondità]. */
  splat: Texture; rect: [number, number, number, number];
}

export function terrainMaterial(scene: Scene, t: TerrainTex): PBRCustomMaterial {
  const m = new PBRCustomMaterial("terrainMat", scene);
  m.metallic = 0;
  m.roughness = 0.92;
  m.albedoColor = Color3.White();
  const S: [string, Texture][] = [
    ["tGrassA", t.grass.albedo], ["tGrassN", t.grass.normal], ["tFloorA", t.floor.albedo], ["tFloorN", t.floor.normal],
    ["tDirtA", t.dirt.albedo], ["tDirtN", t.dirt.normal], ["tRockA", t.rock.albedo], ["tRockN", t.rock.normal],
    ["tMossA", t.moss.albedo], ["tSplat", t.splat],
  ];
  for (const [n, tex] of S) m.AddUniform(n, "sampler2D", tex);
  m.Fragment_Definitions(GLSL_COMMON);
  m.Fragment_Before_Lights(`
    vec3 P = vPositionW;
    vec3 N = normalize(vNormalW);
    vec4 sp = texture2D(tSplat, (P.xz - vec2(${t.rect[0].toFixed(1)}, ${t.rect[1].toFixed(1)})) / vec2(${t.rect[2].toFixed(1)}, ${t.rect[3].toFixed(1)}));
    float macro = sp.b;
    float dist = length(vEyePosition.xyz - P);
    // anti-tiling: due scale dello stesso layer, mescolate col rumore macro
    vec2 uv1 = P.xz * 0.33, uv2 = P.xz * 0.083 + vec2(0.37, 0.71);
    float k = smoothstep(0.3, 0.7, macro);
    vec4 gA = mix(texture2D(tGrassA, uv1), texture2D(tGrassA, uv2), k * 0.6);
    vec4 gN = mix(texture2D(tGrassN, uv1), texture2D(tGrassN, uv2), k * 0.6);
    vec4 fA = mix(texture2D(tFloorA, uv1 * 0.9), texture2D(tFloorA, uv2), k * 0.5);
    vec4 fN = mix(texture2D(tFloorN, uv1 * 0.9), texture2D(tFloorN, uv2), k * 0.5);
    vec4 dA = texture2D(tDirtA, uv1 * 1.2);
    vec4 dN = texture2D(tDirtN, uv1 * 1.2);
    vec3 tw = sq_triW(N);
    vec3 rp = P * 0.16;
    vec4 rA = sq_triA(tRockA, rp, tw);
    vec4 rH = sq_triA(tRockN, rp, tw);

    // erba un po' più secca o più verde a chiazze grandi
    vec3 grassC = sq_lin(gA.rgb) * mix(vec3(1.08, 1.02, 0.78), vec3(0.85, 1.0, 0.9), macro);
    vec3 col = grassC; float h = gN.a; vec3 tn = sq_nm(gN);
    float wf = sq_hb(sp.g, h, fN.a);
    col = mix(col, sq_lin(fA.rgb), wf); tn = mix(tn, sq_nm(fN), wf); h = mix(h, fN.a, wf);
    float wd = sq_hb(sp.r, h, dN.a);
    col = mix(col, sq_lin(dA.rgb), wd); tn = mix(tn, sq_nm(dN), wd); h = mix(h, dN.a, wd);
    vec3 nG = sq_planarN(normalize(tn), N);
    // roccia dove il pendio è ripido (rumore macro sul bordo)
    float slope = 1.0 - N.y;
    float wr = sq_hb(smoothstep(0.28, 0.5, slope + (macro - 0.5) * 0.15), h, rH.a);
    col = mix(col, sq_lin(rA.rgb), wr);
    vec3 nR = sq_triN(tRockN, rp, N, tw);
    // muschio sul sottobosco umido
    vec3 mo = sq_lin(texture2D(tMossA, uv1 * 1.5).rgb);
    col = mix(col, mo, smoothstep(0.55, 0.8, sp.a) * (1.0 - wr) * (1.0 - wd) * 0.85);
    vec3 nn = normalize(mix(nG, nR, wr));
    // in lontananza la normal map sfarfalla: si spegne con la distanza
    normalW = normalize(mix(nn, N, smoothstep(40.0, 120.0, dist) * 0.7));
    surfaceAlbedo = col;
  `);
  lampLit(m);
  return m;
}

/** Massi: roccia triplanare, muschio sulle facce in su (spostato dal rumore). */
export function rockMaterial(scene: Scene, rock: TexPair, moss: TexPair): PBRCustomMaterial {
  const m = new PBRCustomMaterial("rockMat", scene);
  m.metallic = 0;
  m.roughness = 0.85;
  m.albedoColor = Color3.White();
  m.AddUniform("rRockA", "sampler2D", rock.albedo);
  m.AddUniform("rRockN", "sampler2D", rock.normal);
  m.AddUniform("rMossA", "sampler2D", moss.albedo);
  m.AddUniform("rMossN", "sampler2D", moss.normal);
  m.Fragment_Definitions(GLSL_COMMON);
  m.Fragment_Before_Lights(`
    vec3 P = vPositionW;
    vec3 N = normalize(vNormalW);
    vec3 tw = sq_triW(N);
    // due scale della stessa pietra: la larga dà chiazze e fratture, la fine la grana da vicino
    vec3 p1 = P * 0.31, p2 = P * 1.37 + 3.7;
    vec4 a = sq_triA(rRockA, p1, tw);
    vec4 hh = sq_triA(rRockN, p1, tw);
    float fine = sq_triA(rRockN, p2, tw).a;
    vec3 nr = normalize(sq_triN(rRockN, p1, N, tw) + (sq_triN(rRockN, p2, N, tw) - N) * 0.55);
    vec3 rockC = sq_lin(a.rgb) * mix(0.72, 1.22, fine);
    // tinta a chiazze grandi (metri): massi vicini non hanno tutti lo stesso grigio
    rockC *= mix(0.8, 1.15, texture2D(rMossA, P.xz * 0.011 + P.y * 0.017).g * 2.2);
    // muschio sulle facce in su. ⚠️ triplanare anche lui: proiettato solo dall'alto, sulle pareti
    // ripide si stira in strisce verticali
    vec4 ma = sq_triA(rMossA, P * 0.5, tw);
    float mh = sq_triA(rMossN, P * 0.5, tw).a;
    float up = N.y + (texture2D(rMossA, P.xz * 0.05).g - 0.25) * 0.9;
    float wm = sq_hb(smoothstep(0.5, 0.9, up), hh.a, mh);
    surfaceAlbedo = mix(rockC, sq_lin(ma.rgb), wm);
    #ifdef VERTEXCOLOR
    surfaceAlbedo *= vColor.rgb;   // spaccature e base in ombra (colori dei vertici dei massi)
    #endif
    normalW = normalize(mix(nr, sq_triN(rMossN, P * 0.5, N, tw), wm));
  `);
  cloudLit(m);
  return m;
}

/** Tronchi caduti: corteccia sulle uv, muschio che li ricopre dall'alto. */
export function mossyBarkMaterial(scene: Scene, bark: TexPair, moss: TexPair): PBRCustomMaterial {
  const m = surfaceMaterial(scene, "mossyBarkMat", bark, { tint: new Color3(0.8, 0.75, 0.7) });
  m.AddUniform("mMossA", "sampler2D", moss.albedo);
  m.AddUniform("mMossN", "sampler2D", moss.normal);
  m.Fragment_Definitions(GLSL_COMMON);
  m.Fragment_Before_Lights(`
    vec3 N = normalize(vNormalW);
    vec4 ma = texture2D(mMossA, vPositionW.xz * 0.6);
    float up = N.y + (texture2D(mMossA, vPositionW.xz * 0.08).g - 0.25) * 1.5;
    float wm = smoothstep(0.25, 0.6, up);
    surfaceAlbedo = mix(surfaceAlbedo, sq_lin(ma.rgb), wm);
    normalW = normalize(mix(normalW, sq_planarN(sq_nm(texture2D(mMossN, vPositionW.xz * 0.6)), N), wm));
  `);
  cloudLit(m);
  return m;
}

// ── Interni ──────────────────────────────────────────────────────────────────

const daylight = new Color3(1, 1, 1);

/**
 * Interni: niente sole, cielo né shadow map (e niente luci dinamiche: la città non le regge). La luce è calcolata
 * una volta sui vertici, in due strati che stanno in uv2: x = fuoco e candele, y = finestre. Qui si sommano soltanto;
 * lo strato delle finestre passa per `setInteriorDaylight` (la tinta della luce di fuori: bianco = il giorno pieno,
 * nero = niente, in mezzo il blu della luna o l'arancio del tramonto). L'altezza (alfa della normal map)
 * scurisce appena le fughe, al posto del rilievo.
 * È un materiale standard a luci spente, non uno shader a sé: così scrive profondità e normali per l'occlusione
 * ambientale (SSAO), che altrimenti annerisce tutto l'interno.
 * ⚠️ Il materiale standard lavora in gamma e porta in lineare solo il colore finale: qui si va in lineare, si
 * moltiplica per la luce e si torna indietro. Per questo i colori dei vertici (le tinte) vanno dati già in gamma.
 * ⚠️ HDR: `warm` e `cold` sono i colori lineari di una parete bianca in piena luce: tenerli sotto la soglia del bloom.
 */
export function interiorMaterial(scene: Scene, name: string, t: TexPair, light: { warm: Color3; cold: Color3; ambient: Color3 }): CustomMaterial {
  tick(scene);
  const m = new CustomMaterial(name, scene);
  m.diffuseTexture = t.albedo;
  m.disableLighting = true; m.emissiveColor = Color3.White(); m.specularColor = Color3.Black();
  m.backFaceCulling = false;
  m.AddUniform("sqDay", "vec3", undefined);
  m.AddUniform("sqTime", "float", undefined);
  m.AddUniform("sqWarm", "float", undefined);   // quanto sono accesi fuoco e candele di quell'edificio (`mesh.metadata.warm`, 0..1)
  m.AddUniform("sqHeight", "sampler2D", t.normal);
  shadeUniforms(m);
  m.AddUniform("sqCel", "float", undefined);
  for (const i of [0, 1, 2]) m.AddUniform(`sqL${i}`, "vec4", undefined);   // le luci cotte che fanno ombra: due fuochi e una finestra
  m.Vertex_Definitions("varying vec2 vSqLum;");
  m.Vertex_MainEnd(`
    #ifdef UV2
    vSqLum = uv2;
    #else
    vSqLum = vec2(0.0);
    #endif
  `);
  m.Fragment_Definitions("varying vec2 vSqLum;");
  m.Fragment_Custom_Diffuse(`
    // il fuoco è vivo: la sua luce trema, e il tremito corre sui muri (non tutta la stanza insieme)
    float sqPh = vPositionW.x * 0.9 + vPositionW.z * 0.7 + vPositionW.y * 0.5;
    float sqFlick = 1.0 + 0.06 * sin(sqTime * 9.3 + sqPh) + 0.045 * sin(sqTime * 23.0 + 1.7 - sqPh * 1.6) + 0.05 * sin(sqTime * 3.7 + sqPh * 0.4);
    // l'ombra di chi sta fra questo punto e le luci cotte più vicine (due fuochi, una finestra)
    float sqSw = 0.0, sqSc = 0.0;
    if (sqL0.w > 0.0 && distance(vPositionW, sqL0.xyz) < sqL0.w) ${occ("vPositionW", "sqL0.xyz", "sqSw")}
    if (sqL1.w > 0.0 && distance(vPositionW, sqL1.xyz) < sqL1.w) { float sqS1 = 0.0; ${occ("vPositionW", "sqL1.xyz", "sqS1")} sqSw = max(sqSw, sqS1 * 0.6); }
    if (sqL2.w > 0.0 && distance(vPositionW, sqL2.xyz) < sqL2.w) ${occ("vPositionW", "sqL2.xyz", "sqSc")}
    vec3 sqLight = ${v3(light.warm)} * (vSqLum.x * sqFlick * sqWarm * (1.0 - 0.75 * sqSw)) + ${v3(light.cold)} * (vSqLum.y * sqDay * (1.0 - 0.65 * sqSc)) + ${v3(light.ambient)};
    if (sqCel > 0.5) {   // cel shading: la luce cotta della stanza a gradini (mezzo gradino di fondo, o gli angoli bui diventano neri)
      float sqLl = dot(sqLight, vec3(0.299, 0.587, 0.114));
      sqLight *= (${bands("sqLl", 0.14)} + 0.07) / max(sqLl, 1e-4);
    }
    baseColor.rgb = pow(pow(baseColor.rgb, vec3(2.2)) * sqLight * mix(0.7, 1.12, texture2D(sqHeight, vDiffuseUV).a), vec3(0.4545));
  `);
  const attach = m.AttachAfterBind.bind(m);
  m.AttachAfterBind = (mesh, effect) => {
    attach(mesh, effect);
    effect.setColor3("sqDay", daylight);
    effect.setFloat("sqTime", time);
    effect.setFloat("sqWarm", (mesh?.metadata?.warm as number | undefined) ?? 1);
    bindShade(effect);
    effect.setFloat("sqCel", CEL.on);
    for (const i of [0, 1, 2]) effect.setFloat4(`sqL${i}`, SHADE.l[i * 4], SHADE.l[i * 4 + 1], SHADE.l[i * 4 + 2], SHADE.l[i * 4 + 3]);
  };
  return m;
}

/** La luce che entra dalle finestre negli interni, come tinta: bianco = il giorno pieno su cui sono tarati. La guida l'orologio (main.ts). */
export function setInteriorDaylight(c: Color3): void { daylight.copyFrom(c); }
