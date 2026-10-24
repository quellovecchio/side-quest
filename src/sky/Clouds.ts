/**
 * Clouds — il CAMPO delle nuvole di una scena: uno solo, letto da due parti che devono coincidere.
 *
 *  - il cielo (Sky.ts) lo disegna: i cumuli sullo strato a `height` metri, visti dal basso;
 *  - i materiali (CelShading.ts) ne ricevono l'OMBRA: da ogni punto illuminato si risale verso il sole
 *    fino allo strato e si legge la stessa densità. Una macchia d'ombra a terra è la nuvola che ci sta
 *    sopra, non un rumore a parte.
 *
 * La densità è un fbm di value noise sul piano dello strato (`CLOUD_FUNCS`, lo stesso GLSL in entrambi
 * gli shader), spostato dal VENTO: tutto il campo scorre, e le ottave fini derivano un po' più in fretta
 * e di traverso, così le nuvole cambiano forma mentre passano invece di scivolare rigide. La copertura
 * (`coverage`) dice quanta parte del cielo è nuvola: una giornata di bel tempo in savana, cumuli sparsi.
 *
 * ⚠️ Il tempo è quello REALE del browser (delta dell'engine), non quello della simulazione: le nuvole
 * sono solo visive e headless non esistono.
 */
import { Scene, Vector3, Vector4 } from "@babylonjs/core";

export interface CloudOptions {
  /** Dimensione tipica di un cumulo (m): scala del rumore. */
  size?: number;
  /** Quota dello strato (m). */
  height?: number;
  /** Copertura: soglia della densità (0-1). Più alta = meno nuvole. */
  coverage?: number;
  /** Morbidezza del bordo (in densità). */
  softness?: number;
  /** Vento in quota: velocità (m/s) e verso in cui soffia (angolo sul piano XZ, come Cloth.Wind). */
  speed?: number;
  angle?: number;
  /** Quanto un'ombra di nuvola spegne il sole nei materiali (0-1). */
  shadow?: number;
}

const DEFAULTS: Required<CloudOptions> = {
  // 600 m (era 950): con cumuli da quasi un chilometro sul campo da 105 m passava una macchia d'ombra
  // ogni qualche minuto, e a terra le ombre sembravano sparite
  size: 600, height: 1600, coverage: 0.5, softness: 0.05, speed: 9, angle: 0.65, shadow: 0.6,
};

/**
 * GLSL condiviso: solo FUNZIONI. Le uniform (`cloudShape`, `cloudWind`, `cloudSun`) le dichiara chi le
 * include (lo shader del cielo, il plugin dei materiali):
 *   cloudShape = (1/size, copertura, morbidezza, quota)
 *   cloudWind  = (spostamento del campo xz in m, deriva in più per ottava xz in m)
 *   cloudSun   = (verso il sole xyz, forza dell'ombra)
 */
export const CLOUD_FUNCS = `
float cHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float cNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x),
             mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// densita' del campo nel punto xz dello strato. Forma da CUMULO: due ottave larghe decidono dove sta la
// nuvola (masse tondeggianti), un fbm "a sbuffi" (billow: 1 - |2n - 1|) ne erode solo il bordo, con
// 'oct' ottave (<= 4). Le ottave di dettaglio derivano un po' di traverso: la forma cambia mentre passa.
float cloudFbm(vec2 xz, int oct) {
  vec2 p = (xz - cloudWind.xy) * cloudShape.x;
  vec2 drift = cloudWind.zw * cloudShape.x;
  float base = 0.62 * cNoise(p) + 0.38 * cNoise(p * 2.03 + vec2(7.3, 2.9) - drift);
  vec2 q = p * 4.1 - drift * 2.0;
  float a = 0.5, s = 0.0, n = 0.0;
  for (int i = 0; i < 4; i++) {
    if (i >= oct) break;
    s += a * (1.0 - abs(2.0 * cNoise(q) - 1.0));
    n += a;
    q = mat2(1.6, 1.2, -1.2, 1.6) * q + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return base - (1.0 - s / max(n, 1e-3)) * 0.2;
}
float cloudCover(float n) { return smoothstep(cloudShape.y, cloudShape.y + cloudShape.z, n); }
// quanto il punto pw (mondo) sta all'ombra di una nuvola: 0 al sole, 1 sotto una nuvola piena.
// L'ombra si prende solo dalla parte PIENA della nuvola (soglia alzata di 0,07): i bordi sfilacciati,
// che in cielo si vedono, a terra allargavano ogni macchia ben oltre la nuvola che la proietta.
float cloudShadowAt(vec3 pw) {
  float t = (cloudShape.w - pw.y) / max(cloudSun.y, 0.08);
  float n = cloudFbm(pw.xz + cloudSun.xz * t, 3);
  return smoothstep(cloudShape.y + 0.07, cloudShape.y + 0.07 + cloudShape.z, n);
}
`;

export class CloudField {
  readonly o: Required<CloudOptions>;
  readonly shape = new Vector4();
  readonly wind = new Vector4();
  readonly sun = new Vector4();
  private t = 0;

  constructor(scene: Scene, sunLightDir: Vector3, opts: CloudOptions = {}) {
    this.o = { ...DEFAULTS, ...opts };
    this.shape.set(1 / this.o.size, this.o.coverage, this.o.softness, this.o.height);
    this.setSun(sunLightDir);
    // si parte a metà giornata di vento: all'avvio il campo non è quello "in posa" all'origine
    this.t = 3600;
    this.advance(0);
    (scene.metadata ??= {}).cloudField = this;
    scene.onBeforeRenderObservable.add(() => {
      this.advance(Math.min(0.5, scene.getEngine().getDeltaTime() / 1000));
    });
  }

  /**
   * Direzione della LUCE (quella della DirectionalLight): le ombre si proiettano lungo di lei. `k`
   * scala la forza dell'ombra (DayCycle: 0 quando né sole né luna illuminano, all'ora blu).
   */
  setSun(lightDir: Vector3, k = 1): void {
    const d = lightDir.normalizeToNew();
    this.sun.set(-d.x, -d.y, -d.z, this.o.shadow * k);
  }

  private advance(dt: number): void {
    this.t += dt;
    const { speed, angle } = this.o;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const s = speed * this.t;
    // le ottave fini: un po' più veloci e un po' di traverso, cioè la forma che cambia
    const drift = 0.18 * s;
    this.wind.set(dx * s, dz * s, dx * drift - dz * drift * 0.6, dz * drift + dx * drift * 0.6);
  }

  static of(scene: Scene): CloudField | undefined {
    return scene.metadata?.cloudField as CloudField | undefined;
  }
}
