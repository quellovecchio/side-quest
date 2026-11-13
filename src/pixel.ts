import { Effect, PostProcess, Texture, type Camera, type DefaultRenderingPipeline, type Engine, type Scene } from "@babylonjs/core";

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

/** I filtri che devono stare in coda (dopo quelli della pipeline), nell'ordine; per ultimo viene comunque quello dello stile a pixel. */
export const TAIL: PostProcess[] = [];
let pix: PostProcess | null = null, was: { sharpen: boolean; grain: boolean } | null = null, detail = 0;
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

/** `rows` = a quante righe si disegna (0 = stile spento); `scale` = la scala di risoluzione normale, a cui si torna; `cel` = il cel shading è acceso (vuole le texture semplificate anche senza lo stile a pixel). */
export function setPixelStyle(scene: Scene, engine: Engine, camera: Camera, pipe: DefaultRenderingPipeline, rows: number, scale: number, cel: boolean): void {
  const canvas = engine.getRenderingCanvas();
  was ??= { sharpen: pipe.sharpenEnabled, grain: pipe.grainEnabled };
  if (canvas) canvas.style.imageRendering = rows ? "pixelated" : "";
  if (rows) {
    const full = engine.getRenderHeight(true) * engine.getHardwareScalingLevel();   // le righe vere dello schermo
    engine.setHardwareScalingLevel(Math.max(1, full / rows));
    pipe.samples = 1; pipe.fxaaEnabled = false; pipe.sharpenEnabled = false; pipe.grainEnabled = false;
  } else { engine.setHardwareScalingLevel(scale); pipe.sharpenEnabled = was.sharpen; pipe.grainEnabled = was.grain; }
  textures(scene, engine, rows > 0 ? -TEXELS : cel ? CEL_TEXELS : 0);
  // il filtro dei colori deve restare l'ultimo: la pipeline, quando cambia, riattacca i suoi dopo di lui. Lo si rimette
  // in coda un paio di fotogrammi dopo (quando la pipeline ha finito di ricostruirsi)
  pix ??= new PostProcess("pixel", "sqPixel", [], null, 1, null, Texture.NEAREST_SAMPLINGMODE, engine);
  const p = pix;
  let wait = 3;
  const o = scene.onBeforeRenderObservable.add(() => {
    if (--wait > 0) return;
    scene.onBeforeRenderObservable.remove(o);
    for (const t of TAIL) { camera.detachPostProcess(t); camera.attachPostProcess(t); }
    camera.detachPostProcess(p);
    if (rows) camera.attachPostProcess(p);
  });
}
