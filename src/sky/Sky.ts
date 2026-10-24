/**
 * Sky — la volta celeste in uno SHADER (niente texture dipinta): gradiente dall'orizzonte allo zenit,
 * foschia polverosa sull'orizzonte, sole, e le NUVOLE del campo di Clouds.ts, in movimento.
 *
 * Nuvole alla Breath of the Wild: cumuli a tre toni pieni (faccia al sole, tono medio, pancia in
 * ombra) con transizioni strette ma antialiasate — toon, non fotografiche — più un bordo acceso dove la
 * nuvola è sottile e il sole ci passa dietro. La luce è finta ma coerente: si confronta la densità del
 * punto con quella un po' più in là VERSO IL SOLE; dove cala, si è sul fianco illuminato. Il nucleo
 * denso resta più scuro.
 *
 * Geometria: lo strato delle nuvole è un guscio sferico largo (la curvatura della Terra, esagerata) a
 * `height` metri sopra la camera: così verso l'orizzonte le nuvole si schiacciano e si infittiscono
 * come in un cielo vero invece di correre all'infinito, e la prospettiva aerea le sbiadisce nella
 * foschia. Sopra, un velo di cirri che scorre più piano, stirato lungo il vento: profondità.
 *
 * Notte (TimeOfDay.ts): il disco del sole segue la sua direzione VERA e tramonta sotto l'orizzonte (lo
 * copre il colore della piana); la luna è un secondo disco, pallido, e le stelle un campo a celle sulla
 * direzione di vista che le nuvole coprono come coprono il cielo.
 *
 * ⚠️ La sfera è `infiniteDistance`: il suo centro segue la camera, e la depth map (contorno a
 * inchiostro e foschia di ToonShading.ts) la salta. Sotto l'orizzonte il cielo prende il colore della
 * piana del fondale (Skybox.ts): oltre il disco di terreno non si vede la giunzione.
 */
import { Color3, Color4, Effect, Mesh, MeshBuilder, Scene, ShaderMaterial, Vector3 } from "@babylonjs/core";
import { CLOUD_FUNCS, CloudField } from "./Clouds";
import { dayLight, type DayLight } from "./TimeOfDay";

// Side Quest: dentro il far plane della camera (1200) e oltre i crinali della conca (~230 m).
// Il raggio non cambia l'aspetto (lo shader legge solo la direzione).
const SKY_RADIUS = 1000;
const EARTH_R = 20000;            // raggio del guscio: la curvatura che schiaccia le nuvole all'orizzonte
const CIRRUS_H = 5200;

Effect.ShadersStore["skyDomeVertexShader"] = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = viewProjection * world * vec4(position, 1.0);
}
`;

Effect.ShadersStore["skyDomeFragmentShader"] = `
precision highp float;
varying vec3 vDir;
uniform vec3 camPos;
uniform vec3 zenith, midSky, horizon, haze, land;
uniform vec3 sunColor, cloudLit, cloudMid, cloudShadowCol, cloudRim;
uniform vec4 cloudShape, cloudWind, cloudSun;
uniform vec3 sunDisc;            // direzione VERA del sole (verso il sole)
uniform vec3 moonDir, moonCol;   // verso la luna, colore gia' pesato sulla visibilita'
uniform float stars;
${CLOUD_FUNCS}

// distanza lungo d fino al guscio a quota h sopra una Terra di raggio R (stabile anche verso lo zenit)
float shell(vec3 d, float h) {
  float r0 = ${EARTH_R.toFixed(1)} + camPos.y;
  float b = r0 * d.y;
  float c = (h - camPos.y) * (2.0 * ${EARTH_R.toFixed(1)} + h + camPos.y);   // (R+h)^2 - (R+y)^2
  return c / (b + sqrt(b * b + c));
}

void main() {
  vec3 d = normalize(vDir);
  float e = d.y;
  // luce delle nuvole: la direzionale della scena (il sole, o la luna di notte)
  vec3 sunD = normalize(cloudSun.xyz);
  vec3 discD = normalize(sunDisc);

  // gradiente del cielo, la foschia che lo lava sull'orizzonte
  vec3 col = mix(horizon, midSky, smoothstep(0.0, 0.22, e));
  col = mix(col, zenith, smoothstep(0.22, 0.85, e));
  col = mix(col, haze, (1.0 - smoothstep(0.0, 0.07, e)) * 0.75);
  // attorno al sole il cielo si schiarisce
  float cs = dot(d, sunD);
  float cd = dot(d, discD);
  col = mix(col, horizon, pow(max(cd, 0.0), 6.0) * 0.35);

  if (e > 0.0 && stars > 0.001) {
    // stelle: una per cella (poche celle accese), sotto le nuvole che le coprono
    vec3 sp = d * 180.0;
    vec3 cell = floor(sp);
    float hs = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float hb = fract(hs * 91.7);
    vec3 off = vec3(fract(hs * 13.1), fract(hs * 57.3), fract(hs * 31.9)) - 0.5;
    float r = length(fract(sp) - 0.5 - off * 0.6);
    float st = step(0.965, hs) * smoothstep(0.16, 0.02, r) * (0.35 + 0.65 * hb);
    col += vec3(0.85, 0.9, 1.0) * st * stars * smoothstep(0.03, 0.25, e);
  }
  // luna: disco pallido con un alone stretto
  float cm = dot(d, normalize(moonDir));
  col = mix(col, moonCol, smoothstep(0.99925, 0.99945, cm));
  col += moonCol * pow(max(cm, 0.0), 400.0) * 0.25;

  if (e > 0.0) {
    // cirri: velo alto, stirato lungo il vento, lentissimo
    vec2 hc = camPos.xz + d.xz * shell(d, ${CIRRUS_H.toFixed(1)});
    vec2 w = normalize(cloudWind.xy + vec2(1e-3));
    vec2 q = vec2(dot(hc, w), dot(hc, vec2(-w.y, w.x)));
    q = vec2(q.x / 2600.0, q.y / 420.0) - cloudWind.xy / 9000.0;
    float ci = cNoise(q) * 0.55 + cNoise(q * 2.7 + 5.0) * 0.3 + cNoise(q * 6.1 + 1.0) * 0.15;
    float ca = smoothstep(0.62, 0.9, ci) * 0.22 * smoothstep(0.05, 0.3, e);
    col = mix(col, cloudLit, ca);

    // cumuli
    float t = shell(d, cloudShape.w);
    vec2 hx = camPos.xz + d.xz * t;
    float n = cloudFbm(hx, 4);
    float a = cloudCover(n);
    if (a > 0.002) {
      vec2 toSun = normalize(sunD.xz + vec2(1e-4));
      float ns = cloudFbm(hx + toSun * (0.12 / cloudShape.x), 4);
      // dal basso si vede la pancia: il nucleo spesso e' in ombra, i fianchi verso il sole si accendono
      float thick = smoothstep(cloudShape.y, cloudShape.y + 0.22, n);
      float lit = clamp(0.82 - thick * 0.6 + (n - ns) * 7.0, 0.0, 1.0);
      float k1 = smoothstep(0.30, 0.35, lit), k2 = smoothstep(0.58, 0.63, lit);
      vec3 cc = mix(mix(cloudShadowCol, cloudMid, k1), cloudLit, k2);
      // bordo acceso: dove la nuvola e' sottile, di piu' guardando verso il sole
      float thin = 1.0 - smoothstep(0.0, 0.55, a);
      cc = mix(cc, cloudRim, thin * (0.35 + 0.65 * pow(max(cs, 0.0), 3.0)));
      // prospettiva aerea: le lontane sbiadiscono nella foschia e spariscono sull'orizzonte
      cc = mix(cc, haze, (1.0 - smoothstep(0.015, 0.3, e)) * 0.65);
      a *= smoothstep(0.004, 0.035, e);
      col = mix(col, cc, a);
    }
  }

  // sole: disco pieno e due aloni, sopra le nuvole solo dove sono sottili (sotto l'orizzonte lo copre la piana)
  float disc = smoothstep(0.99935, 0.99955, cd);
  col = mix(col, sunColor, disc);
  col += sunColor * (pow(max(cd, 0.0), 180.0) * 0.35 + pow(max(cd, 0.0), 24.0) * 0.08);

  // sotto l'orizzonte: la piana del fondale
  col = mix(col, land, smoothstep(0.0, -0.004, e));
  gl_FragColor = vec4(col, 1.0);
}
`;

export class Sky {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  /** `land`: il colore sotto l'orizzonte (Side Quest: la nebbia della foresta). */
  constructor(private scene: Scene, day: DayLight, private land: Color3) {
    const cf = CloudField.of(scene);
    if (!cf) throw new Error("Sky: serve prima il campo delle nuvole (CloudField) della scena");
    this.mesh = MeshBuilder.CreateSphere("sky", { diameter: SKY_RADIUS * 2, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
    this.mesh.isPickable = false;
    this.mesh.infiniteDistance = true;

    this.mat = new ShaderMaterial("skyMat", scene, { vertex: "skyDome", fragment: "skyDome" }, {
      attributes: ["position"],
      uniforms: ["world", "viewProjection", "camPos", "zenith", "midSky", "horizon", "haze", "land", "sunColor",
        "cloudLit", "cloudMid", "cloudShadowCol", "cloudRim", "cloudShape", "cloudWind", "cloudSun",
        "sunDisc", "moonDir", "moonCol", "stars"],
    });
    this.mat.backFaceCulling = false;
    this.mesh.material = this.mat;
    this.setDay(day);
    const tmp = new Vector3();
    this.mat.onBindObservable.add(() => {
      const eff = this.mat.getEffect();
      const cam = scene.activeCamera;
      if (!eff) return;
      if (cam) tmp.copyFrom(cam.globalPosition);
      eff.setVector3("camPos", tmp);
      eff.setVector4("cloudShape", cf.shape);
      eff.setVector4("cloudWind", cf.wind);
      eff.setVector4("cloudSun", cf.sun);
    });
  }

  /** Colori dell'ora del giorno. */
  setDay(day: DayLight): void {
    const m = this.mat;
    m.setColor3("zenith", day.zenith);
    m.setColor3("midSky", day.mid);
    m.setColor3("horizon", day.horizon);
    m.setColor3("haze", day.haze);
    m.setColor3("land", this.land);
    // il disco del sole: del colore del sole, anche quando la luce della scena è già la luna
    const sunCol = day.moonlight ? dayLight(19).sunColor : day.sunColor;
    m.setColor3("sunColor", sunCol.add(day.cloudRim).scale(0.5));
    m.setVector3("sunDisc", day.sunDiscDir);
    m.setVector3("moonDir", day.moonDir);
    m.setColor3("moonCol", new Color3(0.93, 0.95, 1.0).scale(day.moonVis));
    m.setFloat("stars", day.stars);
    m.setColor3("cloudLit", day.cloudLit);
    m.setColor3("cloudMid", day.cloudMid);
    m.setColor3("cloudShadowCol", day.cloudShadow);
    m.setColor3("cloudRim", day.cloudRim);
    // se per un frame la sfera non c'è (resize, primo render) il fondo resta del colore dell'orizzonte
    this.scene.clearColor = new Color4(day.horizon.r, day.horizon.g, day.horizon.b, 1);
  }
}
