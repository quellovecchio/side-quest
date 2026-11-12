import { DynamicTexture, RawTexture, Scene, Texture } from "@babylonjs/core";
import { fbm2, mulberry32, noise2 } from "./noise";
import { by, DARK } from "../style";

// ─────────────────────────────────────────────────────────────────────────────
// TEXTURE PROCEDURALI — niente file: ogni materiale si disegna all'avvio.
//   base per-pixel con rumore PERIODICO (si ripetono senza cuciture) + tratti su
//   canvas (aghi, foglie, ciottoli) disegnati "a toro" per restare tileable.
//   L'altezza (luminanza) diventa la normal map.
// ─────────────────────────────────────────────────────────────────────────────

/** Colore e normali; le texture fotografiche hanno anche `arm` (occlusione, ruvidezza, metallo nei tre canali) e il rilievo nell'alfa delle normali (`relief`). */
export interface TexPair { albedo: Texture; normal: Texture; arm?: Texture; relief?: boolean }

/**
 * Una texture fotografica (CC0, Poly Haven) da `public/textures/`: colore, normali, e occlusione/ruvidezza/metallo.
 * Una per nome, condivisa (come `tileable`): mai toccarne la scala, la scala sta nelle uv della geometria.
 * Le normali e il rilievo (`_disp`) si fondono in una texture sola, col rilievo nell'alfa: è lì che il materiale lo cerca
 * per la parallasse (le pietre sporgono, le fughe rientrano). Finché le immagini non sono arrivate la texture è piatta:
 * chi avvia il gioco aspetta `photosReady()`.
 */
const PHOTOS = new Map<string, TexPair>(), LOADING: Promise<void>[] = [];
export const photosReady = (): Promise<unknown> => Promise.all(LOADING);
const image = (url: string): Promise<HTMLImageElement> => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error(`texture mancante: ${url}`)); i.src = url; });
export function photoTex(scene: Scene, id: string): TexPair {
  let t = PHOTOS.get(id);
  if (!t) {
    const load = (map: string, linear: boolean): Texture => {
      const tx = new Texture(`${import.meta.env.BASE_URL}textures/${id}_${map}.jpg`, scene);
      tx.gammaSpace = !linear; tx.anisotropicFilteringLevel = 8;
      return tx;
    };
    const base = `${import.meta.env.BASE_URL}textures/${id}_`, S = 2048;
    const normal = new DynamicTexture(`${id}_nor`, { width: S, height: S }, scene, true);
    normal.gammaSpace = false; normal.hasAlpha = false; normal.anisotropicFilteringLevel = 8; normal.wrapU = normal.wrapV = Texture.WRAP_ADDRESSMODE;
    LOADING.push(Promise.all([image(`${base}nor_gl.jpg`), image(`${base}disp.jpg`)]).then(([n, d]) => {
      const ctx = normal.getContext() as CanvasRenderingContext2D, tmp = document.createElement("canvas");
      tmp.width = tmp.height = S;
      const c2 = tmp.getContext("2d", { willReadFrequently: true })!;
      c2.drawImage(d, 0, 0, S, S);
      const h = c2.getImageData(0, 0, S, S).data;
      ctx.drawImage(n, 0, 0, S, S);
      const px = ctx.getImageData(0, 0, S, S);
      for (let i = 0; i < h.length; i += 4) px.data[i + 3] = h[i];
      ctx.putImageData(px, 0, 0);
      normal.update();   // (capovolta come le texture caricate da file)
    }));
    PHOTOS.set(id, t = { albedo: load("diff", false), normal, arm: load("arm", true), relief: true });
  }
  return t;
}

type Rgb = [number, number, number];
type Draw = (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c: Rgb, k = 1, a = 1): string => `rgba(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0},${a})`;
const sat = (x: number): number => Math.min(1, Math.max(0, x));
/** Colore secondo lo stile grafico. */
const P = (moderno: string, dark: string): Rgb => hex(by(moderno, dark));

/**
 * Stile dark: il passaggio "foto dei primi anni 2000" su ogni texture — meno satura, più scura e
 * contrastata, appena calda, con la grana di una fotografia compressa.
 */
function grade(px: Uint8ClampedArray, w: number, h: number): void {
  for (let i = 0; i < w * h; i++) {
    let n = Math.imul(i % w, 374761393) ^ Math.imul((i / w) | 0, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    const grain = (((n ^ (n >>> 16)) >>> 0) / 4294967296 - 0.5) * 30;
    const l = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11;
    const f = (c: number, tint: number): number => (((l + (c - l) * 0.75) / 255 - 0.3) * 1.18 + 0.3) * 255 * 0.95 * tint + grain;
    px[i * 4] = f(px[i * 4], 1.05); px[i * 4 + 1] = f(px[i * 4 + 1], 1); px[i * 4 + 2] = f(px[i * 4 + 2], 0.88);
  }
}

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c.getContext("2d", { willReadFrequently: true })!;
}

function upload(scene: Scene, data: Uint8Array, w: number, h: number, name: string, srgb: boolean, wrap = true): Texture {
  const t = RawTexture.CreateRGBATexture(data, w, h, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.name = name;
  t.gammaSpace = srgb;
  t.anisotropicFilteringLevel = 8;
  t.wrapU = t.wrapV = wrap ? Texture.WRAP_ADDRESSMODE : Texture.CLAMP_ADDRESSMODE;
  return t;
}

function normalFromHeight(hgt: Float32Array, w: number, h: number, strength: number, wrap: boolean): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  let lo = Infinity, hi = -Infinity;
  for (const v of hgt) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const span = Math.max(1e-6, hi - lo);
  const at = (x: number, y: number): number => {
    if (wrap) return hgt[((y + h) % h) * w + ((x + w) % w)];
    return hgt[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * w + x) * 4;
    out[i] = (-dx / l * 0.5 + 0.5) * 255;
    out[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    out[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    out[i + 3] = (hgt[y * w + x] - lo) / span * 255;   // alfa = altezza (blend dei layer per altezza)
  }
  return out;
}

/**
 * Texture opaca tileable: `base(u,v)` → [colore, altezza] per pixel, poi `draw` ci disegna sopra
 * (ripetuto sui 9 offset del toro, stesso seme: i tratti che escono da un bordo rientrano dall'altro).
 */
const made = new Map<string, TexPair>();

function tileable(
  scene: Scene, name: string, s: number, base: (u: number, v: number) => [Rgb, number],
  draw: Draw | null, normalStrength: number, seed: number, graded = true,
): TexPair {
  // la stessa texture serve a più materiali (roccia del terreno e dei massi, corteccia…): si fa una volta
  const hit = made.get(name);
  if (hit) return hit;
  const ctx = canvas(s, s);
  const img = ctx.createImageData(s, s);
  const hb = new Float32Array(s * s);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const [c, hh] = base(x / s, y / s);
    const i = (y * s + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
    hb[y * s + x] = hh;
  }
  ctx.putImageData(img, 0, 0);
  if (draw) {
    for (const ox of [-s, 0, s]) for (const oy of [-s, 0, s]) {
      ctx.save(); ctx.translate(ox, oy);
      draw(ctx, s, mulberry32(seed));
      ctx.restore();
    }
  }
  const px = ctx.getImageData(0, 0, s, s).data;
  // altezza finale: quella della base, più quanto i tratti hanno cambiato la luminanza
  const hgt = new Float32Array(s * s);
  for (let i = 0; i < s * s; i++) {
    const lum = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11) / 255;
    const lb = (img.data[i * 4] * 0.3 + img.data[i * 4 + 1] * 0.59 + img.data[i * 4 + 2] * 0.11) / 255;
    hgt[i] = hb[i] + (lum - lb) * 1.5;
  }
  if (DARK && graded) grade(px, s, s);
  const albedo = upload(scene, new Uint8Array(px.buffer.slice(0)), s, s, `${name}Albedo`, true);
  const normal = upload(scene, normalFromHeight(hgt, s, s, normalStrength, true), s, s, `${name}Normal`, false);
  const pair = { albedo, normal };
  made.set(name, pair);
  return pair;
}

/**
 * Carta di fogliame con alfa (alpha test): i pixel trasparenti prendono il colore medio di quelli
 * pieni, così le mipmap non sbordano di nero attorno ad aghi e foglie.
 */
function cutout(scene: Scene, name: string, w: number, h: number, draw: Draw, seed: number): TexPair {
  const ctx = canvas(w, h);
  draw(ctx, w, mulberry32(seed));
  const px = ctx.getImageData(0, 0, w, h).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (px[i * 4 + 3] > 200) { r += px[i * 4]; g += px[i * 4 + 1]; b += px[i * 4 + 2]; n++; }
  n = Math.max(1, n);
  const hgt = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = px[i * 4 + 3];
    if (a < 255) {
      const k = a / 255;
      px[i * 4] = px[i * 4] * k + (r / n) * (1 - k);
      px[i * 4 + 1] = px[i * 4 + 1] * k + (g / n) * (1 - k);
      px[i * 4 + 2] = px[i * 4 + 2] * k + (b / n) * (1 - k);
    }
    hgt[i] = (a / 255) * 0.6 + (px[i * 4 + 1] / 255) * 0.4;
  }
  if (DARK) grade(px, w, h);
  const albedo = upload(scene, new Uint8Array(px.buffer.slice(0)), w, h, `${name}Albedo`, true, false);
  albedo.hasAlpha = true;
  const normal = upload(scene, normalFromHeight(hgt, w, h, 3, false), w, h, `${name}Normal`, false, false);
  return { albedo, normal };
}

let dot: Texture | null = null;
/** Puntino morbido per le particelle (schegge, sangue, pulviscolo): uno solo, condiviso. */
export function softDotTex(scene: Scene): Texture {
  if (dot) return dot;
  const t = new DynamicTexture("softDot", 32, scene, false);
  const c = t.getContext() as CanvasRenderingContext2D;
  const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 32, 32);
  t.hasAlpha = true; t.update();
  return (dot = t);
}

// ── Superfici del terreno ───────────────────────────────────────────────────

export function grassGroundTex(scene: Scene): TexPair {
  const dark = P("#2c3d16", "#2b2d14"), mid = P("#4a5e22", "#4a4c22"), light = P("#71803a", "#6e6a34"), dry = P("#8a7f45", "#927a42");
  return tileable(scene, "grassGround", 512, (u, v) => {
    const n = fbm2(u * 8, v * 8, 5, 11, 8, 8) * 0.5 + 0.5;
    const d = fbm2(u * 3, v * 3, 3, 12, 3, 3) * 0.5 + 0.5;
    let c = mixc(dark, mid, sat(n * 1.6 - 0.2));
    c = mixc(c, light, sat(n * 2 - 1.1));
    c = mixc(c, dry, sat(d * 2.2 - 1.4) * 0.6);
    return [c, n];
  }, (ctx, s, rnd) => {
    // fili d'erba visti dall'alto: trattini corti, chiari e scuri
    for (let i = 0; i < 9000; i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2, l = 3 + rnd() * 9;
      const t = rnd();
      ctx.strokeStyle = t < 0.5 ? rgb(mixc(mid, light, rnd()), 1, 0.7) : t < 0.85 ? rgb(dark, 0.8, 0.6) : rgb(dry, 1, 0.6);
      ctx.lineWidth = 0.6 + rnd() * 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  }, 4, 101);
}

export function forestFloorTex(scene: Scene): TexPair {
  const soil = hex("#2e2117"), litter = hex("#5a3f24"), needle = hex("#8a5a2e"), moss = hex("#3c5220");
  return tileable(scene, "forestFloor", 512, (u, v) => {
    const n = fbm2(u * 6, v * 6, 5, 21, 6, 6) * 0.5 + 0.5;
    const m = fbm2(u * 3, v * 3, 4, 22, 3, 3) * 0.5 + 0.5;
    let c = mixc(soil, litter, sat(n * 1.4 - 0.1));
    c = mixc(c, moss, sat(m * 3 - 1.9));
    return [c, n * 0.6];
  }, (ctx, s, rnd) => {
    // foglie morte: ellissi ocra e ruggine
    for (let i = 0; i < by(260, 700); i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI, l = 7 + rnd() * 10;
      ctx.fillStyle = rgb(mixc(P("#6b4a26", "#74431a"), P("#9a6a32", "#b46c26"), rnd()), 0.6 + rnd() * 0.5, 0.9);
      ctx.beginPath(); ctx.ellipse(x, y, l, l * 0.45, a, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = rgb(soil, 1, 0.6); ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(x - Math.cos(a) * l, y - Math.sin(a) * l); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    // aghi di pino: tanti segmenti sottili
    for (let i = 0; i < 6000; i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2, l = 6 + rnd() * 10;
      ctx.strokeStyle = rgb(mixc(needle, litter, rnd()), 0.7 + rnd() * 0.6, 0.85);
      ctx.lineWidth = 0.7 + rnd() * 0.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    // rametti
    for (let i = 0; i < 30; i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2, l = 20 + rnd() * 40;
      ctx.strokeStyle = rgb(hex("#3a2a1a"), 1, 1); ctx.lineWidth = 1.5 + rnd() * 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  }, 5, 202);
}

export function dirtTex(scene: Scene): TexPair {
  const a = hex("#3b2d20"), b = hex("#6b5440"), c2 = hex("#857060");
  return tileable(scene, "dirt", 512, (u, v) => {
    const n = fbm2(u * 7, v * 7, 5, 31, 7, 7) * 0.5 + 0.5;
    const r = 1 - Math.abs(noise2(u * 14, v * 14, 32, 14, 14));
    let c = mixc(a, b, sat(n * 1.5 - 0.2));
    c = mixc(c, c2, sat(r * 3 - 2.4) * 0.5);
    return [c, n * 0.7 + r * 0.2];
  }, (ctx, s, rnd) => {
    for (let i = 0; i < 420; i++) {
      const x = rnd() * s, y = rnd() * s, r = 1.2 + rnd() * rnd() * 6, ang = rnd() * Math.PI;
      const g = 0.55 + rnd() * 0.35;
      ctx.fillStyle = rgb(mixc(hex("#6e655a"), hex("#8f7a62"), rnd()), g * 0.7, 1);
      ctx.beginPath(); ctx.ellipse(x + 1, y + 1.5, r, r * 0.75, ang, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = rgb(mixc(hex("#6e655a"), hex("#8f7a62"), rnd()), g, 1);
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.75, ang, 0, Math.PI * 2); ctx.fill();
    }
  }, 6, 303);
}

/** La pietra di massi e pareti: quella nuova nello stile moderno, la prima nel dark. */
export function rockTex(scene: Scene): TexPair {
  return DARK ? rockTexDark(scene) : cragTex(scene);
}

/**
 * Pietra (stile moderno): chiazze larghe di grigi caldi e freddi, grana fine di cristalli, fratture
 * sottili a due scale, licheni chiari dal bordo frastagliato. L'altezza scava le fratture.
 */
function cragTex(scene: Scene): TexPair {
  const dk = hex("#4b4945"), md = hex("#7a766d"), lt = hex("#aaa59a"), warm = hex("#8a7c69"), cool = hex("#6c757c");
  return tileable(scene, "crag", 512, (u, v) => {
    const n = fbm2(u * 4, v * 4, 6, 141, 4, 4) * 0.5 + 0.5;
    const g = fbm2(u * 40, v * 40, 3, 142, 40, 40);
    const hue = fbm2(u * 2, v * 2, 3, 143, 2, 2) * 0.5 + 0.5;
    let c = mixc(dk, md, sat(n * 1.7 - 0.25));
    c = mixc(c, lt, sat(n * 2.4 - 1.45));
    c = mixc(c, mixc(warm, cool, hue), 0.35);
    c = [c[0] * (1 + g * 0.18), c[1] * (1 + g * 0.18), c[2] * (1 + g * 0.18)];
    const lm = sat((fbm2(u * 7, v * 7, 4, 146, 7, 7) - 0.28) * 9);
    c = mixc(c, hue > 0.5 ? hex("#a3a78c") : hex("#9c8c5c"), lm * 0.5);
    return [c, n * 0.8 + g * 0.12 + lm * 0.05];
  }, (ctx, s, rnd) => {
    // fratture: spezzate ad angoli vivi, che si assottigliano (le curve di livello di un rumore
    // sembrano tracce di vermi, non crepe)
    for (let i = 0; i < 16; i++) {
      let x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2;
      const n = 8 + Math.floor(rnd() * 16);
      for (let k = 0; k < n; k++) {
        a += rnd() < 0.25 ? (rnd() - 0.5) * 2.2 : (rnd() - 0.5) * 0.35;
        const l = 5 + rnd() * 16, nx = x + Math.cos(a) * l, ny = y + Math.sin(a) * l, w = 1.5 * (1 - k / n) + 0.35;
        ctx.strokeStyle = "rgba(255,250,240,0.07)"; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x + 1, y + 1); ctx.lineTo(nx + 1, ny + 1); ctx.stroke();
        ctx.strokeStyle = "rgba(22,21,19,0.6)"; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny;
      }
    }
    // cristalli: puntini appena più chiari o più scuri
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = rnd() < 0.5 ? "rgba(222,216,205,0.14)" : "rgba(24,23,21,0.2)";
      const r = 0.6 + rnd() * 0.9;
      ctx.beginPath(); ctx.arc(rnd() * s, rnd() * s, r, 0, Math.PI * 2); ctx.fill();
    }
  }, 8, 1404);
}

function rockTexDark(scene: Scene): TexPair {
  const dk = hex("#3d3c39"), md = hex("#6d6a63"), lt = hex("#8f8b82"), lichen = hex("#8f9a5a");
  return tileable(scene, "rock", 512, (u, v) => {
    const n = fbm2(u * 5, v * 5, 6, 41, 5, 5) * 0.5 + 0.5;
    const crack = Math.abs(fbm2(u * 4, v * 4, 4, 42, 4, 4));
    const strata = Math.sin((v + fbm2(u * 2, v * 2, 3, 43, 2, 2) * 0.15) * Math.PI * 18) * 0.5 + 0.5;
    let c = mixc(dk, md, sat(n * 1.6 - 0.2));
    c = mixc(c, lt, sat(n * 2.2 - 1.3));
    c = mixc(c, mixc(c, dk, 0.4), strata * 0.25);
    const cr = 1 - sat(crack * 22);
    c = mixc(c, hex("#2a2825"), cr * by(0.45, 0.2));
    const l = fbm2(u * 10, v * 10, 3, 44, 10, 10);
    c = mixc(c, lichen, sat(l * 4 - 1.6) * 0.55);
    return [c, n - cr * 0.35 + strata * 0.08];
  }, null, 7, 404);
}

export function mossTex(scene: Scene): TexPair {
  const dk = hex("#1f2e10"), md = hex("#3f5a1c"), lt = hex("#6b8a2a");
  return tileable(scene, "moss", 512, (u, v) => {
    const n = fbm2(u * 16, v * 16, 5, 51, 16, 16) * 0.5 + 0.5;
    const b = fbm2(u * 4, v * 4, 3, 52, 4, 4) * 0.5 + 0.5;
    let c = mixc(dk, md, sat(n * 1.8 - 0.3));
    c = mixc(c, lt, sat(n * 2.5 - 1.5) * b);
    return [c, n];
  }, null, 5, 505);
}

// ── Alberi ──────────────────────────────────────────────────────────────────

export function barkTex(scene: Scene): TexPair {
  const dk = hex("#1f1610"), md = hex("#4a3828"), lt = hex("#7a6450");
  return tileable(scene, "bark", 512, (u, v) => {
    // creste verticali a placche: rumore "ridged" stirato lungo il tronco
    const w = fbm2(u * 3, v * 2, 3, 61, 3, 2) * 0.3;
    const r = 1 - Math.abs(noise2((u + w) * 10, v * 3, 62, 10, 3));
    const r2 = 1 - Math.abs(noise2((u + w) * 22, v * 6, 63, 22, 6));
    const n = fbm2(u * 12, v * 12, 4, 64, 12, 12) * 0.5 + 0.5;
    const hgt = r * 0.65 + r2 * 0.25 + n * 0.1;
    let c = mixc(dk, md, sat(hgt * 1.6 - 0.3));
    c = mixc(c, lt, sat(hgt * 2.5 - 1.8) * n);
    return [c, hgt];
  }, null, 9, 606);
}

/** Ramo di abete: rachide con rametti laterali fitti di aghi. Il ramo va da sinistra a destra. */
export function spruceCardTex(scene: Scene): TexPair {
  return cutout(scene, "spruceCard", 512, 512, (ctx, s, rnd) => {
    const greens = by(["#2a4a2c", "#345a35", "#3f6a3c", "#4b7845", "#5f8a50"], ["#1c3328", "#243f2e", "#2c4a33", "#365538", "#46603e"]).map(hex);
    const needles = (x0: number, y0: number, x1: number, y1: number, len: number, dens: number): void => {
      const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      const nn = L * dens;
      for (let i = 0; i < nn; i++) {
        const t = rnd(), x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        const side = rnd() < 0.5 ? -1 : 1;
        const ang = Math.atan2(uy, ux) + side * (0.7 + rnd() * 0.6);
        const l = len * (1 - t * 0.5) * (0.6 + rnd() * 0.5);
        ctx.strokeStyle = rgb(greens[(rnd() * greens.length) | 0], 0.85 + rnd() * 0.4, 1);
        ctx.lineWidth = 1.3 + rnd() * 1.0;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * l, y + Math.sin(ang) * l); ctx.stroke();
      }
    };
    const cy = s * 0.5;
    // rametti laterali, dalla base verso la punta
    for (let i = 0; i < 22; i++) {
      const t = 0.04 + (i / 22) * 0.86;
      const bx = s * t, by = cy + Math.sin(t * 3) * 6;
      const len = s * (0.34 - t * 0.26) * (0.8 + rnd() * 0.4);
      for (const side of [-1, 1]) {
        const a = side * (0.75 + rnd() * 0.3);
        const ex = bx + Math.cos(a) * len, ey = by + Math.sin(a) * len;
        ctx.strokeStyle = rgb(hex("#3a2a1c")); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(ex, ey); ctx.stroke();
        needles(bx, by, ex, ey, 20, 1.1);
      }
    }
    ctx.strokeStyle = rgb(hex("#4a3424")); ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, cy); ctx.quadraticCurveTo(s * 0.5, cy + 8, s * 0.97, cy); ctx.stroke();
    needles(0, cy, s * 0.97, cy, 26, 1.6);
  }, 707);
}

/** Stile dark: ciuffo d'erba per i quad incrociati (fili che salgono dal bordo basso della carta). */
export function grassCardTex(scene: Scene): TexPair {
  return cutout(scene, "grassCard", 256, 256, (ctx, s, rnd) => {
    const cols = ["#3a4a1c", "#4f5c24", "#66702c", "#7d7a36", "#96864a"].map(hex);
    for (let i = 0; i < 150; i++) {
      const x = s * (0.05 + rnd() * 0.9), h = s * (0.35 + rnd() * rnd() * 0.62), lean = (rnd() - 0.5) * s * 0.3, wd = 2.5 + rnd() * 3.5;
      const c = cols[(rnd() * cols.length) | 0], k = 0.75 + rnd() * 0.45;
      const g = ctx.createLinearGradient(0, s, 0, s - h);
      g.addColorStop(0, rgb(c, k * 0.45)); g.addColorStop(1, rgb(c, k * 1.15));
      ctx.fillStyle = g;
      // un filo: largo alla base, curvo, a punta in cima
      ctx.beginPath(); ctx.moveTo(x - wd, s);
      ctx.quadraticCurveTo(x + lean * 0.3, s - h * 0.6, x + lean, s - h);
      ctx.quadraticCurveTo(x + lean * 0.3 + wd * 0.6, s - h * 0.55, x + wd, s);
      ctx.fill();
    }
  }, 1301);
}

/** Ciuffo di foglie (latifoglia): foglie ovali con nervatura, irradiate dal centro. */
export function leafCardTex(scene: Scene): TexPair {
  return cutout(scene, "leafCard", 512, 512, (ctx, s, rnd) => {
    const c = s / 2;
    ctx.strokeStyle = rgb(hex("#3a2a1c")); ctx.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a) * s * 0.35, c + Math.sin(a) * s * 0.35); ctx.stroke();
    }
    const greens = by(["#3f6a26", "#4f7a2c", "#628c33", "#73983a", "#86a443"], ["#2f4a1c", "#3c5820", "#4c6626", "#62702c", "#7c7430"]).map(hex);
    for (let i = 0; i < 170; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * s * 0.38;
      const x = c + Math.cos(a) * r, y = c + Math.sin(a) * r;
      const ang = a + (rnd() - 0.5) * 1.2, l = 26 + rnd() * 22, wd = l * (0.38 + rnd() * 0.14);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      const g = greens[(rnd() * greens.length) | 0], k = 0.8 + rnd() * 0.35;
      const grd = ctx.createLinearGradient(-l, 0, l, 0);
      grd.addColorStop(0, rgb(g, k * 0.75)); grd.addColorStop(1, rgb(g, k * 1.1));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.moveTo(-l, 0);
      ctx.quadraticCurveTo(0, -wd, l, 0); ctx.quadraticCurveTo(0, wd, -l, 0); ctx.fill();
      ctx.strokeStyle = rgb(g, k * 0.55, 0.8); ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.moveTo(-l, 0); ctx.lineTo(l * 0.9, 0); ctx.stroke();
      ctx.restore();
    }
  }, 808);
}

/** Fronda di felce: rachide verticale (dal basso in alto), pinne a coppie fatte di pinnule. */
export function fernCardTex(scene: Scene): TexPair {
  return cutout(scene, "fernCard", 256, 1024, (ctx, _s, rnd) => {
    const W = 256, H = 1024, cx = W / 2;
    const col = by(["#3f6a28", "#4f7c2e", "#629036", "#719c3c"], ["#33522a", "#40602c", "#4e6c30", "#5e7434"]).map(hex);
    ctx.strokeStyle = rgb(hex("#4a5a24")); ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(cx, H); ctx.quadraticCurveTo(cx + 6, H * 0.5, cx, 6); ctx.stroke();
    for (let i = 0; i < 34; i++) {
      const t = i / 34, y = H * (1 - 0.06 - t * 0.92);
      const env = Math.sin(Math.min(1, t * 1.25 + 0.08) * Math.PI) * (1 - t * 0.35);
      const len = W * 0.47 * env;
      for (const side of [-1, 1]) {
        const ex = cx + side * len, ey = y - len * 0.35;
        const g = col[(rnd() * col.length) | 0];
        const pinn = Math.max(3, Math.round(len / 7));
        for (let k = 0; k < pinn; k++) {
          const u = k / pinn;
          const px = cx + (ex - cx) * u, py = y + (ey - y) * u;
          const r = (1 - u * 0.75) * 7.5;
          ctx.fillStyle = rgb(g, 0.85 + rnd() * 0.3);
          ctx.beginPath(); ctx.ellipse(px, py + 2, r * 0.7, r * 1.1, side * 0.5, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.ellipse(px, py - 2, r * 0.7, r * 1.1, side * 0.5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = rgb(hex("#3d5222")); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(ex, ey); ctx.stroke();
      }
    }
  }, 909);
}

// ── Equipaggiamento ─────────────────────────────────────────────────────────

/** Assi di legno dello scudo: venature verticali, fughe scure fra le assi. */
export function planksTex(scene: Scene): TexPair {
  const dk = hex("#3a2616"), md = hex("#6b4a2c"), lt = hex("#8c6a44");
  return tileable(scene, "planks", 512, (u, v) => {
    const plank = Math.floor(u * 6), pu = u * 6 - plank;
    const off = plank * 0.37;
    const grain = fbm2(u * 6, (v + off) * 2, 3, 71 + plank, 6, 2) * 0.5;
    const lines = Math.sin((pu + grain) * Math.PI * 14) * 0.5 + 0.5;
    const n = fbm2(u * 20, v * 20, 3, 72, 20, 20) * 0.5 + 0.5;
    let c = mixc(dk, md, 0.45 + lines * 0.35 + (plank % 2) * 0.08);
    c = mixc(c, lt, sat(n * 2 - 1.2) * 0.4);
    const gap = Math.min(pu, 1 - pu) < 0.018 ? 1 : 0;
    c = mixc(c, hex("#120b06"), gap * 0.9);
    return [c, 0.6 + lines * 0.15 - gap * 0.6 + n * 0.05];
  }, null, 6, 1001);
}

export function leatherTex(scene: Scene): TexPair {
  const dk = hex("#2a1a10"), md = hex("#5a3a22");
  return tileable(scene, "leather", 256, (u, v) => {
    const n = fbm2(u * 24, v * 24, 4, 81, 24, 24) * 0.5 + 0.5;
    const wrap = Math.sin((u * 2 + v * 8) * Math.PI * 2) * 0.5 + 0.5;  // fasciatura a spirale
    const c = mixc(dk, md, sat(n * 1.2 - 0.1) * (0.65 + wrap * 0.35));
    return [c, n * 0.3 + wrap * 0.7];
  }, null, 5, 1101);
}

/** Cuoio liscio dei guanti: grana fine e qualche piega, senza fasciatura. */
export function hideTex(scene: Scene): TexPair {
  const dk = hex("#2c1d13"), md = hex("#59402a"), lt = hex("#7a5c3e");
  return tileable(scene, "hide", 256, (u, v) => {
    const n = fbm2(u * 30, v * 30, 4, 171, 30, 30) * 0.5 + 0.5;
    const crease = 1 - Math.abs(fbm2(u * 5, v * 5, 3, 172, 5, 5));
    let c = mixc(dk, md, sat(n * 1.3 - 0.1));
    c = mixc(c, lt, sat(crease * 4 - 3.3) * 0.5);
    return [c, n * 0.4 + crease * 0.3];
  }, null, 4, 1701);
}

/** Acciaio della lama: spazzolato per il lungo (v), aloni di patina, qualche graffio. */
export function steelTex(scene: Scene): TexPair {
  return tileable(scene, "steel", 256, (u, v) => {
    const streak = fbm2(u * 56, v * 3, 3, 151, 56, 3) * 0.5 + 0.5;
    const pat = fbm2(u * 3, v * 3, 4, 152, 3, 3) * 0.5 + 0.5;
    const k = 0.6 + streak * 0.22 + pat * 0.18;
    const c: Rgb = [198 * k, 201 * k, 208 * k];
    return [mixc(c, hex("#5c5248"), sat(pat * 2.6 - 1.7) * 0.4), streak * 0.5 + pat * 0.25];
  }, (ctx, s, rnd) => {
    for (let i = 0; i < 70; i++) {
      const x = rnd() * s, y = rnd() * s, a = Math.PI / 2 + (rnd() - 0.5) * 1.1, l = 10 + rnd() * 50;
      ctx.strokeStyle = rnd() < 0.5 ? "rgba(255,255,255,0.22)" : "rgba(20,20,24,0.3)";
      ctx.lineWidth = 0.5 + rnd() * 0.6;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  }, 2, 1501);
}

/** Ferro battuto di guardia, pomo, umbone e cerchiature: scuro, a martellate, con fioriture di ruggine. */
export function ironTex(scene: Scene): TexPair {
  const dk = hex("#2f2c2a"), md = hex("#56524d"), rust = hex("#74452a");
  return tileable(scene, "iron", 256, (u, v) => {
    const n = fbm2(u * 6, v * 6, 5, 161, 6, 6) * 0.5 + 0.5;
    const dent = fbm2(u * 14, v * 14, 2, 162, 14, 14);
    const r = sat((fbm2(u * 9, v * 9, 4, 163, 9, 9) - 0.18) * 5);
    let c = mixc(dk, md, sat(n * 1.5 - 0.2));
    c = mixc(c, rust, r * 0.5);
    return [c, n * 0.3 + dent * 0.55 - r * 0.1];
  }, null, 4, 1601);
}

/**
 * Faccia dello scudo: le assi, dipinte a quarti rosso e osso. La vernice è consumata lungo le fughe
 * e a chiazze, e segnata dai colpi.
 */
export function shieldFaceTex(scene: Scene): TexPair {
  const dk = hex("#3a2616"), md = hex("#6b4a2c"), red = hex("#7c2f24"), bone = hex("#b9aa8a");
  return tileable(scene, "shieldFace", 512, (u, v) => {
    const plank = Math.floor(u * 7), pu = u * 7 - plank;
    const grain = fbm2(u * 7, (v + plank * 0.37) * 2, 3, 181 + plank, 7, 2) * 0.5;
    const lines = Math.sin((pu + grain) * Math.PI * 12) * 0.5 + 0.5;
    const gapD = Math.min(pu, 1 - pu);
    const wood = mixc(mixc(dk, md, 0.4 + lines * 0.4 + (plank % 2) * 0.08), hex("#120b06"), gapD < 0.02 ? 0.9 : 0);
    const wear = fbm2(u * 9, v * 9, 4, 182, 9, 9) * 0.5 + 0.5 + sat(1 - gapD * 9) * 0.3 + sat((Math.hypot(u - 0.5, v - 0.5) - 0.38) * 6) * 0.5;
    const paint = sat((0.64 - wear) * 7);
    const col = (u > 0.5) !== (v > 0.5) ? red : bone;
    const c = mixc(wood, mixc(col, wood, 0.12 + lines * 0.1), paint * 0.92);
    return [c, 0.55 + lines * 0.15 - (gapD < 0.02 ? 0.6 : 0) + paint * 0.06];
  }, (ctx, s, rnd) => {
    // tagli di lama: un solco scuro col bordo di legno vivo
    for (let i = 0; i < 12; i++) {
      const x = s * (0.15 + rnd() * 0.7), y = s * (0.15 + rnd() * 0.7), a = rnd() * Math.PI, l = 18 + rnd() * 50;
      ctx.strokeStyle = "rgba(190,160,110,0.5)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
      ctx.strokeStyle = "rgba(20,12,6,0.85)"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
  }, 6, 1801);
}

/**
 * Pelliccia: peli corti tutti nello stesso verso (lungo v), a ciocche. È chiara e neutra: il colore
 * del mantello lo danno i colori dei vertici dell'animale, che la moltiplicano.
 */
export function furTex(scene: Scene): TexPair {
  const b = hex("#cfc8bc"), d = hex("#8f877c"), l = hex("#f4efe6");
  return tileable(scene, "fur", 256, (u, v) => {
    const n = fbm2(u * 6, v * 6, 4, 1201, 6, 6) * 0.5 + 0.5;
    return [mixc(d, b, sat(n * 1.5 - 0.1)), n * 0.5];
  }, (ctx, s, rnd) => {
    for (let i = 0; i < 5000; i++) {
      const x = rnd() * s, y = rnd() * s, len = 4 + rnd() * 7, a = Math.PI / 2 + (rnd() - 0.5) * 0.5;
      const t = rnd();
      ctx.strokeStyle = t < 0.35 ? rgb(d, 1, 0.35) : t < 0.85 ? rgb(b, 1.05, 0.45) : rgb(l, 1, 0.5);
      ctx.lineWidth = 0.7 + rnd() * 0.8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); ctx.stroke();
    }
  }, 1.5, 1202, false);   // niente passaggio "dark": resta neutra, o il mantello vira al fulvo
}

/**
 * Tela: trama fitta, chiara e neutra. Il colore di vesti e pelle degli abitanti lo danno i colori dei
 * vertici, che la moltiplicano (come il pelo per le creature).
 */
export function clothTex(scene: Scene): TexPair {
  const b = hex("#e2dccf"), d = hex("#b0a89a");
  return tileable(scene, "cloth", 256, (u, v) => {
    const weave = (Math.sin(u * Math.PI * 96) * 0.5 + 0.5) * (Math.sin(v * Math.PI * 96) * 0.5 + 0.5);
    const n = fbm2(u * 8, v * 8, 4, 1301, 8, 8) * 0.5 + 0.5;
    return [mixc(d, b, sat(0.3 + weave * 0.4 + n * 0.5)), weave * 0.6 + n * 0.3];
  }, null, 2.5, 1302, false);
}

// ── Città ───────────────────────────────────────────────────────────────────

const hash2 = (a: number, b: number, s: number): number => {
  let n = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(s + 1, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};

interface Coursed {
  rows: number; cols: number;
  /** Larghezza delle fughe (0..1 del concio) e forma: 2 = ciottolo tondo, 10 = concio squadrato. */
  gap: number; sq: number;
  dk: Rgb; md: Rgb; lt: Rgb; joint: Rgb;
  /** Quanto ogni filare sale verso il basso (tegole e ardesie che si sormontano). */
  lap?: number;
  /** Colore delle macchie (muschio, sporco). */
  stain?: Rgb;
  seed: number; normal: number;
}

/**
 * Pietre a filari sfalsati con i giunti irregolari: la stessa funzione fa muratura, lastre, cubetti,
 * ciottoli, tegole e ardesie (cambiano filari, forma, fughe e sormonto).
 */
function coursed(scene: Scene, name: string, o: Coursed): TexPair {
  const wrap = (b: number): number => ((b % o.cols) + o.cols) % o.cols;
  const jit = (row: number, b: number): number => (hash2(row, wrap(b), o.seed) - 0.5) * 0.42;
  return tileable(scene, name, 512, (u, v) => {
    const row = Math.floor(v * o.rows), fv = v * o.rows - row;
    const cu = u * o.cols + (row % 2) * 0.5 + hash2(row, 99, o.seed) * 0.25;
    let b = Math.floor(cu);
    if (cu < b + jit(row, b)) b--; else if (cu >= b + 1 + jit(row, b + 1)) b++;
    const left = b + jit(row, b), fu = (cu - left) / (b + 1 + jit(row, b + 1) - left);
    const r = Math.pow(Math.abs(2 * fu - 1), o.sq) + Math.pow(Math.abs(2 * fv - 1), o.sq);
    const tone = hash2(row, wrap(b), o.seed + 7);
    const n = fbm2(u * 24, v * 24, 4, o.seed, 24, 24) * 0.5 + 0.5, m = fbm2(u * 5, v * 5, 3, o.seed + 1, 5, 5) * 0.5 + 0.5;
    const inside = sat((1 - o.gap - r) * 9), lap = (o.lap ?? 0) * (0.5 - fv);
    let c = mixc(o.dk, o.md, sat(0.28 + tone * 0.45 + n * 0.4));   // ogni concio ha il suo tono, ma poco: da lontano il muro non deve fare scacchiera
    c = mixc(c, o.lt, sat(n * 2.4 - 1.5) * 0.6 + lap * 0.5);
    if (o.stain) c = mixc(c, o.stain, sat(m * 3.2 - 1.9) * 0.6);
    return [mixc(o.joint, c, inside), inside * (0.55 + tone * 0.2 + n * 0.12 + lap + (o.sq < 4 ? (1 - r) * 0.5 : 0))];
  }, null, o.normal, o.seed);
}

/** Muro di conci: grigio freddo, giunti scuri, licheni. Una ripetizione = 2 m. */
export const masonryTex = (scene: Scene): TexPair => coursed(scene, "masonry", { rows: 8, cols: 4, gap: 0.1, sq: 10, dk: hex("#4a4944"), md: hex("#77756c"), lt: hex("#99968a"), joint: hex("#2b2a27"), stain: hex("#5a6040"), seed: 2101, normal: 6 });
/** Lastre irregolari delle vie principali. Una ripetizione = 3 m. */
export const flagstoneTex = (scene: Scene): TexPair => coursed(scene, "flagstone", { rows: 4, cols: 3, gap: 0.05, sq: 14, dk: hex("#55534d"), md: hex("#7a776d"), lt: hex("#948f82"), joint: hex("#25221e"), stain: hex("#4d5238"), seed: 2201, normal: 5 });
/** Cubetti della piazza. Una ripetizione = 1,6 m. */
export const settTex = (scene: Scene): TexPair => coursed(scene, "setts", { rows: 14, cols: 14, gap: 0.16, sq: 6, dk: hex("#403f3b"), md: hex("#62605a"), lt: hex("#7e7b72"), joint: hex("#1f1d1a"), seed: 2301, normal: 6 });
/** Acciottolato dei vicoli: ciottoli tondi nella terra. Una ripetizione = 1,6 m. */
export const cobbleTex = (scene: Scene): TexPair => coursed(scene, "cobbles", { rows: 11, cols: 9, gap: 0.14, sq: 2.4, dk: hex("#5a5952"), md: hex("#85837a"), lt: hex("#a19d92"), joint: hex("#2a251e"), stain: hex("#4c5434"), seed: 2401, normal: 8 });
/** Ardesie del tetto. Una ripetizione = 2,4 m. */
export const slateTex = (scene: Scene): TexPair => coursed(scene, "slate", { rows: 9, cols: 9, gap: 0.05, sq: 12, dk: hex("#2c3136"), md: hex("#3f464c"), lt: hex("#586067"), joint: hex("#17191b"), lap: 0.5, stain: hex("#3d4630"), seed: 2501, normal: 5 });
/** Coppi spenti del municipio. */
export const roofTileTex = (scene: Scene): TexPair => coursed(scene, "roofTile", { rows: 9, cols: 12, gap: 0.08, sq: 5, dk: hex("#4f2a1e"), md: hex("#74402c"), lt: hex("#93573b"), joint: hex("#24130d"), lap: 0.6, stain: hex("#4a4630"), seed: 2601, normal: 6 });

/** Intonaco sporco, mai bianco: colature dall'alto, macchie di umido, qualche crepa. */
export function plasterTex(scene: Scene): TexPair {
  const dk = hex("#6e6654"), md = hex("#948a72"), lt = hex("#aba188"), damp = hex("#545340");
  return tileable(scene, "plaster", 512, (u, v) => {
    const n = fbm2(u * 6, v * 6, 5, 2701, 6, 6) * 0.5 + 0.5, g = fbm2(u * 40, v * 40, 3, 2702, 40, 40) * 0.5 + 0.5;
    const run = fbm2(u * 22, v * 2, 3, 2703, 22, 2) * 0.5 + 0.5;
    let c = mixc(dk, md, sat(n * 1.5 - 0.15));
    c = mixc(c, lt, sat(g * 2 - 1.1) * 0.5);
    return [mixc(c, damp, sat(run * 2.6 - 1.5) * 0.45), n * 0.4 + g * 0.3];
  }, (ctx, s, rnd) => {
    for (let i = 0; i < 9; i++) {
      let x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI * 2;
      for (let k = 0; k < 14; k++) {
        a += (rnd() - 0.5) * 1.1;
        const nx = x + Math.cos(a) * 12, ny = y + Math.sin(a) * 12;
        ctx.strokeStyle = "rgba(30,26,20,0.55)"; ctx.lineWidth = 1.2 * (1 - k / 14) + 0.4;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
        x = nx; y = ny;
      }
    }
  }, 3, 2704);
}

/** Paglia del tetto delle case povere: steli che scendono lungo la falda, a strati. */
export function thatchTex(scene: Scene): TexPair {
  const dk = hex("#4b4022"), md = hex("#7d6d3c"), lt = hex("#a39356");
  return tileable(scene, "thatch", 512, (u, v) => {
    const layer = (v * 5) % 1, n = fbm2(u * 60, v * 5, 3, 2801, 60, 5) * 0.5 + 0.5, m = fbm2(u * 4, v * 4, 3, 2802, 4, 4) * 0.5 + 0.5;
    let c = mixc(dk, md, sat(n * 1.4 - 0.1 + layer * 0.3));
    c = mixc(c, lt, sat(n * 2.5 - 1.6) * 0.6);
    return [mixc(c, hex("#3c3a22"), sat(m * 3 - 2) * 0.5), n * 0.5 + layer * 0.5];
  }, (ctx, s, rnd) => {
    for (let i = 0; i < 2600; i++) {
      const x = rnd() * s, y = rnd() * s, l = 14 + rnd() * 30;
      ctx.strokeStyle = rnd() < 0.5 ? rgb(lt, 1, 0.35) : rgb(dk, 0.8, 0.45); ctx.lineWidth = 0.6 + rnd();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rnd() - 0.5) * 5, y + l); ctx.stroke();
    }
  }, 5, 2803);
}

// ── Interni ─────────────────────────────────────────────────────────────────

/**
 * Cotto a spina di pesce (tavola dei mattonati: «cortili, locanda, botteghe»): mattoni 22 × 11 cm, tinte ruggine
 * disuguali, qualcuno annerito, fughe scure. Una ripetizione = 88 cm (otto mezzi mattoni: due periodi della spina).
 */
export function brickFloorTex(scene: Scene): TexPair {
  const dk = hex("#4a3024"), md = hex("#6d4635"), lt = hex("#876049"), joint = hex("#2a1f19"), soot = hex("#352e29");
  const wrap = (c: number): number => ((c % 8) + 8) % 8;
  return tileable(scene, "brickFloor", 512, (u, v) => {
    const cx = Math.floor(u * 8), cy = Math.floor(v * 8), fu = u * 8 - cx, fv = v * 8 - cy, m = (((cx - cy) % 4) + 4) % 4;
    // il mattone a cui appartiene questo mezzo mattone: coricato (m 0, 1) o in piedi (m 3, 2); la sua origine e il punto dentro di lui
    const flat = m < 2, bx = flat ? cx - m : cx, by = flat ? cy : cy - (3 - m);
    const pu = flat ? cx - bx + fu : fu, pv = flat ? fv : cy - by + fv;
    const edge = Math.min(pu, (flat ? 2 : 1) - pu, pv, (flat ? 1 : 2) - pv);
    const tone = hash2(wrap(bx), wrap(by), 3101), burnt = hash2(wrap(bx), wrap(by), 3102) > 0.86 ? 1 : 0;
    const n = fbm2(u * 28, v * 28, 4, 3103, 28, 28) * 0.5 + 0.5, wear = fbm2(u * 4, v * 4, 3, 3104, 4, 4) * 0.5 + 0.5;
    let c = mixc(dk, md, sat(0.15 + tone * 0.6 + n * 0.35));
    c = mixc(c, lt, sat(n * 2.2 - 1.3) * 0.5 + sat(wear * 2 - 1.2) * 0.25);
    c = mixc(c, soot, burnt * 0.6);
    const inside = sat((edge - 0.045) * 14);
    return [mixc(joint, c, inside), inside * (0.6 + tone * 0.18 + n * 0.12)];
  }, null, 5, 3105);
}

/** Vetri piombati visti da dentro: losanghe verdastre, una diversa dall'altra, nella rete scura dei piombi. Una ripetizione = 60 cm. */
export function leadedGlassTex(scene: Scene): TexPair {
  const lead = hex("#17181a"), a = hex("#7f958c"), b = hex("#a9b8a8");
  return tileable(scene, "leadedGlass", 256, (u, v) => {
    const p = (u + v) * 4, q = (u - v) * 4 + 8, fp = p - Math.floor(p), fq = q - Math.floor(q);
    const i = Math.floor(p), j = Math.floor(q), edge = Math.min(fp, 1 - fp, fq, 1 - fq), tone = hash2((i + j) % 8, (((i - j) % 8) + 8) % 8, 3201);   // somma e differenza: si ripetono coi bordi
    const n = fbm2(u * 12, v * 12, 3, 3202, 12, 12) * 0.5 + 0.5;
    return [mixc(lead, mixc(a, b, sat(tone * 0.7 + n * 0.4)), sat((edge - 0.05) * 16)), sat((edge - 0.05) * 16) * 0.5 + 0.3];
  }, null, 2, 3203);
}
