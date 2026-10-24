import { Color3, Scene, Texture } from "@babylonjs/core";
import { PBRCustomMaterial } from "@babylonjs/materials";
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

/** Corteccia, legno, pelle: PBR classico con albedo + normal map. */
export function surfaceMaterial(scene: Scene, name: string, t: TexPair, opts: { tint?: Color3; rough?: number; uv?: [number, number] } = {}): PBRCustomMaterial {
  const m = new PBRCustomMaterial(name, scene);
  m.albedoTexture = t.albedo;
  m.bumpTexture = t.normal;
  m.albedoColor = opts.tint ?? Color3.White();
  m.metallic = 0;
  m.roughness = opts.rough ?? 0.9;
  if (opts.uv) for (const tx of [t.albedo, t.normal]) { (tx as Texture).uScale = opts.uv[0]; (tx as Texture).vScale = opts.uv[1]; }
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
  return m;
}

/** Erba: niente texture, colore dai vertici (base scura → punta chiara) e per istanza. */
export function grassMaterial(scene: Scene): PBRCustomMaterial {
  const m = new PBRCustomMaterial("grassMat", scene);
  m.albedoColor = Color3.White();
  m.metallic = 0;
  m.roughness = 0.7;
  m.backFaceCulling = false;
  return m;
}

export interface TerrainTex {
  grass: TexPair; floor: TexPair; dirt: TexPair; rock: TexPair; moss: TexPair;
  splat: Texture; worldSize: number;
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
    vec4 sp = texture2D(tSplat, P.xz / ${t.worldSize.toFixed(1)} + 0.5);
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
    vec4 a = sq_triA(rRockA, P * 0.35, tw);
    vec4 hh = sq_triA(rRockN, P * 0.35, tw);
    vec3 nr = sq_triN(rRockN, P * 0.35, N, tw);
    vec4 ma = texture2D(rMossA, P.xz * 0.5);
    vec4 mn = texture2D(rMossN, P.xz * 0.5);
    float up = N.y + (texture2D(rMossA, P.xz * 0.05).g - 0.25) * 1.2;
    float wm = sq_hb(smoothstep(0.35, 0.85, up), hh.a, mn.a);
    surfaceAlbedo = mix(sq_lin(a.rgb) * 0.95, sq_lin(ma.rgb), wm);
    normalW = normalize(mix(nr, sq_planarN(sq_nm(mn), N), wm));
  `);
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
  return m;
}
