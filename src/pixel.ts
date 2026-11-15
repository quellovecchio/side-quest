import { Constants, Effect, PostProcess, Texture, type Camera, type DefaultRenderingPipeline, type Engine, type Scene } from "@babylonjs/core";

// ─────────────────────────────────────────────────────────────────────────────
// STILE A PIXEL — il mondo resta quello (luci, ombre, vetri, foschia: tutto come prima), cambia come
// arriva a schermo: sembra pixel art in tre dimensioni. Tre cose insieme:
//   1. poche righe: il gioco si disegna a `rows` righe e il browser lo ingrandisce a pixel netti
//      (`image-rendering: pixelated`), senza antialiasing, nitidezza né grana, che li sporcherebbero;
//   2. pochi colori: un ultimo filtro schiarisce, alza la saturazione e porta ogni pixel al colore più
//      vicino di una tavolozza scelta a mano (`PALETTE`), col retino ordinato (Bayer 4 × 4) solo dove
//      il colore cade a metà fra due;
//   3. texture a blocchi: ogni texture con le mipmap si legge da un livello piccolo (64 pixel di lato)
//      e senza sfumare fra un texel e l'altro, così da vicino si vedono i quadretti.
// Si spegne e torna tutto com'era: non tocca materiali né shader del gioco.
// Seconda resa, "retrò" (`look` = "retro", come i giochi a pixel di oggi): colore pieno, effetti moderni.
//   1. il mondo si disegna alla risoluzione di sempre e un PRIMO filtro (`sqBlocchi`, in testa a tutti) lo riduce a blocchi
//      di `block` pixel facendo la media di ognuno (16 letture): pixel grossi ma lisci, che non sfarfallano camminando;
//   2. bloom, occlusione, raggi di luce e viraggio vengono DOPO, a piena risoluzione: la luce resta morbida sopra i pixel;
//   3. l'ultimo filtro (`sqRetro`) porta i colori a 24 gradini col retino per blocco (le sfumature restano, appena a scalini)
//      e scosta un filo rosso e blu verso i bordi; le righe dello schermo sono un velo HTML sopra il canvas (gratis, nitide).
// Costa quanto il gioco senza stile a pixel (il mondo si disegna intero) più due filtri leggeri.
// ponytail: la tavolozza è una sola per tutte le ore (di notte usa i viola e gli ambra della stessa
// lista); niente vertici agganciati alla griglia.
// ─────────────────────────────────────────────────────────────────────────────

const TEXELS = 64, CEL_TEXELS = 128;
/**
 * La tavolozza, scelta a mano (sRGB): chiara e pastello, da pixel art. Le ombre sono viola e non nere, la pietra è sabbia
 * calda, il cielo lavanda e rosa, i verdi pieni, la luce dei fuochi ambra. Ogni pixel prende il colore più vicino; a cavallo
 * fra due colori il retino li alterna. Per cambiare il carattere dell'immagine si cambia questa lista, non lo shader.
 */
const PALETTE = [
  "17131f", "241d33", "342a47", "473a5c",                       // ombre (viola scuro, mai nero pieno)
  "5d5182", "7b70a6", "9d94c4", "bfb8dd", "e0dbf2",             // lavanda: ombre chiare, cielo, pietra in ombra
  "c88aa3", "e7b4c1", "f7dfe1",                                 // rosa: tramonti, intonaco al sole
  "33507a", "5380b0", "86b0d4", "b9d8ec",                       // azzurri: cielo, vetro, acqua
  "24402a", "356434", "529040", "84bb4e", "bbdc74",             // verdi: bosco, erba, muschio
  "40201d", "672f26", "94422f", "bf5f40",                       // rossi e bruni: coppi, legno, stoffa
  "50443c", "73614f", "978166", "bba27d", "dcc695", "f3e6b9", "fff8e0",   // pietra e sabbia, fino al bianco caldo
  "cf7d31", "eca843", "f9d466", "fff2a6",                       // luce: fiamme, finestre, sole
  "62626e", "92929c", "c4c4cb",                                 // grigi: ferro, selciato
];
const rgb = (h: string): string => `vec3(${[0, 2, 4].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)).join(", ")})`;

Effect.ShadersStore.sqPixelFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
float sqB2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float sqB4(vec2 a) { return sqB2(0.5 * a) * 0.25 + sqB2(a); }
// quanto due colori si somigliano all'occhio: la luce conta più della tinta
float sqDist(vec3 a, vec3 b) { vec3 d = a - b; return dot(d * d, vec3(0.3, 0.5, 0.2)) + 0.6 * pow(dot(d, vec3(0.299, 0.587, 0.114)), 2.0); }
void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  c = pow(c, vec3(0.74)) * 1.06 + 0.02;                                             // più chiaro: il gioco è cupo, la tavolozza no
  c = clamp(mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 1.5), 0.0, 1.0);        // colori pieni
  // i due colori della tavolozza più vicini
  vec3 a = vec3(0.0), b = vec3(0.0); float da = 1e9, db = 1e9;
  ${PALETTE.map((h) => `{ vec3 p = ${rgb(h)}; float d = sqDist(c, p); if (d < da) { db = da; b = a; da = d; a = p; } else if (d < db) { db = d; b = p; } }`).join(" ")}
  // il retino: solo dove il colore sta davvero a metà strada (a piena ampiezza punteggia tutto lo schermo)
  float t = sqrt(da) / (sqrt(da) + sqrt(db) + 1e-5);
  gl_FragColor = vec4(sqB4(gl_FragCoord.xy) < (t - 0.3) * 2.2 ? b : a, 1.0);
}`;

Effect.ShadersStore.sqBlocchiFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 sqScreen;
uniform float sqBlock;
void main(void) {
  vec2 o = floor(vUV * sqScreen / sqBlock) * sqBlock;                 // l'angolo del blocco, in pixel
  vec3 c = vec3(0.0);
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++) {
    vec2 p = min(o + (vec2(float(i), float(j)) + 0.5) * sqBlock * 0.25, sqScreen - 0.5);
    c += texture2D(textureSampler, p / sqScreen).rgb;
  }
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;

Effect.ShadersStore.sqRetroFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform vec2 sqScreen;
uniform float sqBlock;
float sqB2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float sqB4(vec2 a) { return sqB2(0.5 * a) * 0.25 + sqB2(a); }
void main(void) {
  vec2 d = vUV - 0.5;
  vec2 off = d * dot(d, d) * 1.5 * sqBlock / sqScreen;                // rosso e blu scostati, solo verso i bordi
  vec3 c = vec3(texture2D(textureSampler, vUV + off).r, texture2D(textureSampler, vUV).g, texture2D(textureSampler, vUV - off).b);
  c = floor(c * 24.0 + sqB4(floor(gl_FragCoord.xy / sqBlock))) / 24.0;   // 24 gradini, retino per blocco
  gl_FragColor = vec4(c, 1.0);
}`;

/** I filtri che devono stare in coda (dopo quelli della pipeline), nell'ordine; per ultimo viene comunque quello dello stile a pixel. */
export const TAIL: PostProcess[] = [];
let pix: PostProcess | null = null, blocchi: PostProcess | null = null, retro: PostProcess | null = null, lines: HTMLDivElement | null = null, block = 1, was: { sharpen: boolean; grain: boolean } | null = null, detail = 0;
const modes = new Map<Texture, number>();

/**
 * Quanto dettaglio si legge dalle texture dei materiali: `texels` = il lato del livello di mipmap più grande che si può
 * leggere (0 = tutto, com'erano); negativo = lo stesso lato ma SENZA sfumare fra un texel e l'altro (i blocchi dello
 * stile a pixel). Il cel shading le vuole piccole ma sfumate: restano le macchie grandi (i conci, le assi), spariscono
 * la grana e le ombre fotografiche, e normali e occlusione si ammorbidiscono con loro.
 */
function textures(scene: Scene, engine: Engine, texels: number): void {
  if (texels === detail) return;
  detail = texels;
  const on = texels !== 0, blocks = texels < 0;
  const gl = engine._gl as WebGL2RenderingContext;
  if (!gl.TEXTURE_MIN_LOD) return;
  for (const t of scene.textures) {
    const it = t.getInternalTexture();
    // (solo le texture dei materiali: con le mipmap, in due dimensioni, non quelle su cui si disegna)
    if (!(t instanceof Texture) || !it || !it.generateMipMaps || it.isCube || t.isRenderTarget || it.width < 128 || t.name.startsWith("dipinto")) continue;   // (le dipinte sono già a campiture: restano nitide)
    if (!modes.has(t)) modes.set(t, t.samplingMode);
    t.updateSamplingMode(blocks ? Texture.NEAREST_SAMPLINGMODE : modes.get(t)!);
    engine._bindTextureDirectly(gl.TEXTURE_2D, it, true);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_LOD, on ? Math.max(0, Math.log2(it.width / Math.abs(texels))) : -1000);
    engine._bindTextureDirectly(gl.TEXTURE_2D, null);
  }
}

/** `rows` = a quante righe si disegna (0 = stile spento); `look` = "palette" (la tavolozza a mano, poche righe vere) o "retro" (colore pieno, blocchi fatti da un filtro); `scale` = la scala di risoluzione normale, a cui si torna; `cel` = il cel shading è acceso (vuole le texture semplificate anche senza lo stile a pixel). */
export function setPixelStyle(scene: Scene, engine: Engine, camera: Camera, pipe: DefaultRenderingPipeline, rows: number, look: "palette" | "retro", scale: number, cel: boolean): void {
  const canvas = engine.getRenderingCanvas();
  const pal = rows > 0 && look === "palette", ret = rows > 0 && look === "retro";
  was ??= { sharpen: pipe.sharpenEnabled, grain: pipe.grainEnabled };
  if (canvas) canvas.style.imageRendering = pal ? "pixelated" : "";
  if (pal) {
    const full = engine.getRenderHeight(true) * engine.getHardwareScalingLevel();   // le righe vere dello schermo
    engine.setHardwareScalingLevel(Math.max(1, full / rows));
    pipe.samples = 1; pipe.fxaaEnabled = false; pipe.sharpenEnabled = false; pipe.grainEnabled = false;
  } else {
    engine.setHardwareScalingLevel(scale);
    pipe.sharpenEnabled = ret ? false : was.sharpen; pipe.grainEnabled = ret ? false : was.grain;   // (grana e nitidezza a piena risoluzione sporcherebbero i blocchi)
  }
  textures(scene, engine, pal ? -TEXELS : cel ? CEL_TEXELS : 0);
  // le righe dello schermo: un velo sopra il canvas, alla risoluzione vera dello schermo
  if (ret && !lines && canvas) {
    lines = document.createElement("div");
    lines.style.cssText = "position:fixed;inset:0;pointer-events:none;background:repeating-linear-gradient(to bottom,transparent 0 2px,rgba(0,0,0,0.14) 2px 3px)";
    canvas.after(lines);
  }
  if (lines) lines.style.display = ret ? "" : "none";
  block = ret ? Math.max(1, Math.round(engine.getRenderHeight() / rows)) : 1;
  const sizes = (p: PostProcess): void => { p.onApplyObservable.add((e) => { e.setFloat2("sqScreen", p.width, p.height); e.setFloat("sqBlock", Math.max(1, Math.round(p.height / rows) || block)); }); };
  // (in HDR come il disegno del mondo che riceve, o il bloom non trova più le luci sopra 1)
  if (!blocchi) { blocchi = new PostProcess("blocchi", "sqBlocchi", ["sqScreen", "sqBlock"], null, 1, null, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_HALF_FLOAT); sizes(blocchi); }
  if (!retro) { retro = new PostProcess("retro", "sqRetro", ["sqScreen", "sqBlock"], null, 1, null, Texture.BILINEAR_SAMPLINGMODE, engine); sizes(retro); }
  // il filtro dei colori deve restare l'ultimo e quello dei blocchi il primo: la pipeline, quando cambia, riattacca i suoi
  // in fondo. Li si rimette al loro posto un paio di fotogrammi dopo (quando la pipeline ha finito di ricostruirsi)
  pix ??= new PostProcess("pixel", "sqPixel", [], null, 1, null, Texture.NEAREST_SAMPLINGMODE, engine);
  const p = pix, b = blocchi, r = retro;
  let wait = 3;
  const o = scene.onBeforeRenderObservable.add(() => {
    if (--wait > 0) return;
    scene.onBeforeRenderObservable.remove(o);
    camera.detachPostProcess(b);
    if (ret) camera.attachPostProcess(b, 0);
    for (const t of TAIL) { camera.detachPostProcess(t); camera.attachPostProcess(t); }
    camera.detachPostProcess(p); camera.detachPostProcess(r);
    if (pal) camera.attachPostProcess(p);
    if (ret) camera.attachPostProcess(r);
  });
}
