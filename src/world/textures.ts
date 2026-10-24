import { RawTexture, Scene, Texture } from "@babylonjs/core";
import { fbm2, mulberry32, noise2 } from "./noise";

// ─────────────────────────────────────────────────────────────────────────────
// TEXTURE PROCEDURALI — niente file: ogni materiale si disegna all'avvio.
//   base per-pixel con rumore PERIODICO (si ripetono senza cuciture) + tratti su
//   canvas (aghi, foglie, ciottoli) disegnati "a toro" per restare tileable.
//   L'altezza (luminanza) diventa la normal map.
// ─────────────────────────────────────────────────────────────────────────────

export interface TexPair { albedo: Texture; normal: Texture }

type Rgb = [number, number, number];
type Draw = (ctx: CanvasRenderingContext2D, s: number, rnd: () => number) => void;

const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mixc = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgb = (c: Rgb, k = 1, a = 1): string => `rgba(${c[0] * k | 0},${c[1] * k | 0},${c[2] * k | 0},${a})`;
const sat = (x: number): number => Math.min(1, Math.max(0, x));

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
function tileable(
  scene: Scene, name: string, s: number, base: (u: number, v: number) => [Rgb, number],
  draw: Draw | null, normalStrength: number, seed: number,
): TexPair {
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
  const albedo = upload(scene, new Uint8Array(px.buffer.slice(0)), s, s, `${name}Albedo`, true);
  const normal = upload(scene, normalFromHeight(hgt, s, s, normalStrength, true), s, s, `${name}Normal`, false);
  return { albedo, normal };
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
  const albedo = upload(scene, new Uint8Array(px.buffer.slice(0)), w, h, `${name}Albedo`, true, false);
  albedo.hasAlpha = true;
  const normal = upload(scene, normalFromHeight(hgt, w, h, 3, false), w, h, `${name}Normal`, false, false);
  return { albedo, normal };
}

// ── Superfici del terreno ───────────────────────────────────────────────────

export function grassGroundTex(scene: Scene): TexPair {
  const dark = hex("#2c3d16"), mid = hex("#4a5e22"), light = hex("#71803a"), dry = hex("#8a7f45");
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
    for (let i = 0; i < 260; i++) {
      const x = rnd() * s, y = rnd() * s, a = rnd() * Math.PI, l = 7 + rnd() * 10;
      ctx.fillStyle = rgb(mixc(hex("#6b4a26"), hex("#9a6a32"), rnd()), 0.6 + rnd() * 0.5, 0.9);
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

export function rockTex(scene: Scene): TexPair {
  const dk = hex("#3d3c39"), md = hex("#6d6a63"), lt = hex("#8f8b82"), lichen = hex("#8f9a5a");
  return tileable(scene, "rock", 512, (u, v) => {
    const n = fbm2(u * 5, v * 5, 6, 41, 5, 5) * 0.5 + 0.5;
    const crack = Math.abs(fbm2(u * 4, v * 4, 4, 42, 4, 4));
    const strata = Math.sin((v + fbm2(u * 2, v * 2, 3, 43, 2, 2) * 0.15) * Math.PI * 18) * 0.5 + 0.5;
    let c = mixc(dk, md, sat(n * 1.6 - 0.2));
    c = mixc(c, lt, sat(n * 2.2 - 1.3));
    c = mixc(c, mixc(c, dk, 0.4), strata * 0.25);
    const cr = 1 - sat(crack * 22);
    c = mixc(c, hex("#2a2825"), cr * 0.45);
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
    const greens = [hex("#2a4a2c"), hex("#345a35"), hex("#3f6a3c"), hex("#4b7845"), hex("#5f8a50")];
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

/** Ciuffo di foglie (latifoglia): foglie ovali con nervatura, irradiate dal centro. */
export function leafCardTex(scene: Scene): TexPair {
  return cutout(scene, "leafCard", 512, 512, (ctx, s, rnd) => {
    const c = s / 2;
    ctx.strokeStyle = rgb(hex("#3a2a1c")); ctx.lineWidth = 4;
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(c + Math.cos(a) * s * 0.35, c + Math.sin(a) * s * 0.35); ctx.stroke();
    }
    const greens = [hex("#3f6a26"), hex("#4f7a2c"), hex("#628c33"), hex("#73983a"), hex("#86a443")];
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
    const col = [hex("#3f6a28"), hex("#4f7c2e"), hex("#629036"), hex("#719c3c")];
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
