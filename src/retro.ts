import {
  Color4, DynamicTexture, Effect, MaterialPluginBase, MirrorTexture, ParticleSystem, PBRMaterial, Plane, PostProcess,
  RegisterMaterialPlugin, StandardMaterial, Texture, Vector3, type AbstractMesh, type Camera, type DepthRenderer,
  type Engine, type Material, type Scene, type UniformBuffer,
} from "@babylonjs/core";
import { interiorLight } from "./world/interiors";

// ─────────────────────────────────────────────────────────────────────────────
// EXTRA DELLA RESA RETRÒ — quattro selettori, ognuno indipendente dallo stile a pixel:
//   • profondità di campo: lontano si sfoca (un disegno in più della scena: la sola profondità);
//   • riflessi del fiume: la città specchiata nell'acqua (un disegno in più, a un quarto di risoluzione, di ciò che sta entro 80 m);
//   • pioggia: gocce allungate attorno a chi guarda, ferme sotto un tetto;
//   • PS1: i vertici agganciati a una griglia di schermo (tremano) e le texture stese senza prospettiva (si piegano).
// Nessuno tocca i file del mondo: il PS1 è un plugin di tutti i materiali, il riflesso un plugin del materiale dell'acqua.
// ponytail: pioggia senza schizzi né selciato bagnato; profondità di campo a fuoco fisso (nitido fino a 25 m, sfocato del tutto a 145), senza autofocus.
// ─────────────────────────────────────────────────────────────────────────────

/** I filtri che devono stare in testa alla catena (prima di tutti, anche dei blocchi dello stile a pixel), nell'ordine: li rimette al loro posto `setPixelStyle`. */
export const HEAD: PostProcess[] = [];

// ── PS1 ── (registrato quando si carica il modulo: prima che nasca qualsiasi materiale)
const PS1 = [0, 0, 0, 0];   // mezza griglia in x e y (0 = spento), texture affini (1 = sì)
class Ps1Plugin extends MaterialPluginBase {
  constructor(m: Material) { super(m, "Ps1", 300, { SQPS1: false }); this._enable(true); }
  override prepareDefines(defines: Record<string, unknown>): void { defines.SQPS1 = true; }
  override getClassName(): string { return "Ps1Plugin"; }
  override getUniforms() { return { ubo: [{ name: "sqPs1", size: 4, type: "vec4" }], vertex: "uniform vec4 sqPs1;", fragment: "uniform vec4 sqPs1;" }; }
  override bindForSubMesh(ubo: UniformBuffer): void { ubo.updateFloat4("sqPs1", PS1[0], PS1[1], PS1[2], 0); }
  override getCustomCode(type: string): Record<string, string> | null {
    if (type === "vertex") return {
      CUSTOM_VERTEX_DEFINITIONS: "varying vec2 sqAffUV; varying float sqAffW;",
      CUSTOM_VERTEX_MAIN_END: `
        if (sqPs1.x > 0.0 && gl_Position.w > 0.3) gl_Position.xy = floor(gl_Position.xy / gl_Position.w * sqPs1.xy + 0.5) / sqPs1.xy * gl_Position.w;
        sqAffW = gl_Position.w;
        #ifdef MAINUV1
        sqAffUV = vMainUV1 * gl_Position.w;
        #else
        sqAffUV = vec2(0.0);
        #endif`,
    };
    // le uv lette senza prospettiva: il varying moltiplicato per w e diviso qui, dopo l'interpolazione lineare
    return { CUSTOM_FRAGMENT_DEFINITIONS: `
      varying vec2 sqAffUV; varying float sqAffW;
      #ifdef MAINUV1
      #define vMainUV1 (sqPs1.z > 0.5 ? sqAffUV / sqAffW : vMainUV1)
      #endif` };
  }
}
RegisterMaterialPlugin("Ps1", (m) => (m instanceof StandardMaterial || m instanceof PBRMaterial ? new Ps1Plugin(m) : null));

// ── profondità di campo ──
Effect.ShadersStore.sqFuocoFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D sqDepth;
uniform vec2 sqScreen;
uniform vec2 sqFocus;   // da dove comincia a sfocare, in quanti metri arriva al massimo
float sqCoc(vec2 uv) { return clamp((texture2D(sqDepth, uv).r - sqFocus.x) / sqFocus.y, 0.0, 1.0); }
void main(void) {
  vec3 c = texture2D(textureSampler, vUV).rgb;
  float coc = sqCoc(vUV);
  if (coc > 0.01) {
    float w = 1.0, r = coc * sqScreen.y / 200.0;
    for (int i = 0; i < 16; i++) {
      float a = float(i) * 2.39996, d = sqrt((float(i) + 0.5) / 16.0) * r;
      vec2 uv = vUV + vec2(cos(a), sin(a)) * d / sqScreen;
      float k = sqCoc(uv);   // (ciò che è a fuoco non si spande sullo sfondo)
      c += texture2D(textureSampler, uv).rgb * k; w += k;
    }
    c /= w;
  }
  gl_FragColor = vec4(c, 1.0);
}`;

// ── riflessi del fiume: il plugin che legge lo specchio nel materiale dell'acqua ──
let mirror: MirrorTexture | null = null;
class MirrorPlugin extends MaterialPluginBase {
  constructor(m: Material, private eng: Engine) { super(m, "Specchio", 310, { SQMIRROR: false }); this._enable(true); }
  override prepareDefines(defines: Record<string, unknown>): void { defines.SQMIRROR = true; }
  override getClassName(): string { return "MirrorPlugin"; }
  override getSamplers(s: string[]): void { s.push("sqMirror"); }
  override getUniforms() { return { ubo: [{ name: "sqMir", size: 4, type: "vec4" }], fragment: "uniform vec4 sqMir;" }; }
  override bindForSubMesh(ubo: UniformBuffer): void {
    ubo.updateFloat4("sqMir", this.eng.getRenderWidth(), this.eng.getRenderHeight(), mirror && on.reflections ? 1 : 0, performance.now() / 1000);
    if (mirror) ubo.setTexture("sqMirror", mirror);
  }
  override getCustomCode(type: string): Record<string, string> | null {
    if (type !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: "uniform sampler2D sqMirror;",
      CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
        if (sqMir.z > 0.5) {
          vec3 sqMv = normalize(vEyePosition.xyz - vPositionW);
          float sqMf = 0.06 + 0.94 * pow(1.0 - clamp(sqMv.y, 0.0, 1.0), 4.0);
          vec2 sqMw = vec2(sin(vPositionW.x * 1.7 + sqMir.w * 1.3) + sin(vPositionW.z * 2.3 - sqMir.w * 1.1), cos(vPositionW.z * 1.9 + sqMir.w)) * 0.004;
          vec3 sqMc = texture2D(sqMirror, gl_FragCoord.xy / sqMir.xy + sqMw).rgb;
          color.rgb = mix(color.rgb, sqMc * 0.8, clamp(sqMf, 0.0, 0.85));
        }`,
    };
  }
}

export interface Extras { dof: boolean; reflections: boolean; rain: boolean; ps1: boolean }
const on: Extras = { dof: false, reflections: false, rain: false, ps1: false };
let fuoco: PostProcess | null = null, depth: DepthRenderer | null = null, rain: ParticleSystem | null = null, water: AbstractMesh | null = null, hooked = false;

/** Accende e spegne i quattro extra; `rows` = le righe dello stile a pixel (la griglia del PS1 le segue), 0 = 240. */
export function setRetroExtras(scene: Scene, engine: Engine, camera: Camera, x: Extras, rows: number): void {
  // PS1: un uniform, nessuna ricompilazione
  const h = (rows || 240) / 2;
  PS1[0] = x.ps1 ? h * engine.getAspectRatio(camera) : 0; PS1[1] = x.ps1 ? h : 0; PS1[2] = x.ps1 ? 1 : 0;

  // profondità di campo: in testa alla catena, prima dei blocchi (lo sfondo si sfoca, poi diventa pixel)
  if (x.dof !== on.dof) {
    if (x.dof) {
      depth = scene.enableDepthRenderer(camera, false, true, undefined, true);   // (la z della camera in metri)
      fuoco ??= new PostProcess("fuoco", "sqFuoco", ["sqScreen", "sqFocus"], ["sqDepth"], 1, null, Texture.BILINEAR_SAMPLINGMODE, engine);
      const f = fuoco;
      f.onApplyObservable.clear();
      f.onApplyObservable.add((e) => { e.setTexture("sqDepth", depth!.getDepthMap()); e.setFloat2("sqScreen", f.width, f.height); e.setFloat2("sqFocus", 25, 120); });
      HEAD.push(f);
    } else {
      HEAD.splice(HEAD.indexOf(fuoco!), 1); camera.detachPostProcess(fuoco!);
      scene.disableDepthRenderer(camera); depth = null;
    }
  }

  // riflessi: lo specchio si disegna solo a meno di 150 m dall'acqua
  water ??= scene.getMeshByName("town_acqua");
  if (x.reflections && water && !mirror) {
    const y = water.getBoundingInfo().boundingBox.maximumWorld.y, w = water;
    // (a un quarto: sotto i blocchi basta; niente vegetazione a istanze né particelle, e solo ciò che sta entro 80 m)
    mirror = new MirrorTexture("specchio", { ratio: 0.25 }, scene, true);
    mirror.mirrorPlane = new Plane(0, -1, 0, y);
    mirror.renderParticles = false; mirror.renderSprites = false;
    mirror.renderListPredicate = (m) => m !== w && m.renderingGroupId === 0 && m.isVisible && m.isEnabled() && !m.hasThinInstances
      && Vector3.Distance(m.getBoundingInfo().boundingSphere.centerWorld, camera.globalPosition) - m.getBoundingInfo().boundingSphere.radiusWorld < 80;
    mirror.clearColor = new Color4(0, 0, 0, 1);
    if (w.material) new MirrorPlugin(w.material, engine);
  }
  if (!hooked) {
    hooked = true;
    scene.onBeforeRenderObservable.add(() => {
      if (mirror) {
        const b = water!.getBoundingInfo().boundingBox, p = camera.globalPosition;
        const near = on.reflections && p.y > b.maximumWorld.y && p.x > b.minimumWorld.x - 150 && p.x < b.maximumWorld.x + 150 && p.z > b.minimumWorld.z - 150 && p.z < b.maximumWorld.z + 150;
        const i = scene.customRenderTargets.indexOf(mirror);
        if (near && i < 0) scene.customRenderTargets.push(mirror); else if (!near && i >= 0) scene.customRenderTargets.splice(i, 1);
      }
      if (rain) {
        const p = camera.globalPosition;
        (rain.emitter as Vector3).set(p.x, p.y + 9, p.z);
        rain.emitRate = interiorLight(p.x, p.y, p.z) ? 0 : 6000;   // sotto un tetto non piove
      }
    });
  }

  // pioggia
  if (x.rain && !rain) {
    const t = new DynamicTexture("goccia", { width: 4, height: 64 }, scene, false);
    const ctx = t.getContext() as CanvasRenderingContext2D, g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.7, "rgba(255,255,255,0.9)"); g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64); t.hasAlpha = true; t.update();
    const r = new ParticleSystem("pioggia", 6000, scene);
    r.particleTexture = t as unknown as Texture;
    r.emitter = new Vector3();
    r.createBoxEmitter(new Vector3(-0.6, -14, 0.3), new Vector3(-0.4, -16, 0.5), new Vector3(-22, 0, -22), new Vector3(22, 0, 22));
    r.updateSpeed = 1 / 60;   // (così velocità in m/s e vita in secondi)
    r.minLifeTime = 0.8; r.maxLifeTime = 1.1;
    r.minSize = 1; r.maxSize = 1; r.minScaleX = 0.03; r.maxScaleX = 0.045; r.minScaleY = 0.6; r.maxScaleY = 0.9;   // (più grosse del vero: sotto i blocchi una goccia di un centimetro sparisce)
    r.billboardMode = ParticleSystem.BILLBOARDMODE_STRETCHED;
    r.color1 = new Color4(0.62, 0.66, 0.72, 0.4); r.color2 = new Color4(0.5, 0.55, 0.62, 0.28); r.colorDead = new Color4(0.5, 0.55, 0.62, 0);
    r.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    r.emitRate = 6000;
    rain = r;
  }
  if (rain) { if (x.rain) rain.start(); else rain.stop(); }

  Object.assign(on, x);
}
