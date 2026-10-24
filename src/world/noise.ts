// Rumore procedurale deterministico: lo usano terreno, piazzamento, texture e mesh.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function hash3(x: number, y: number, z: number, seed: number): number {
  return hash2(x ^ Math.imul(z, 2246822519), y, seed);
}

// 16 gradienti unitari in tabella: niente trigonometria nel ciclo caldo
const GX = new Float64Array(16), GY = new Float64Array(16);
for (let i = 0; i < 16; i++) { GX[i] = Math.cos((i + 0.5) * Math.PI / 8); GY[i] = Math.sin((i + 0.5) * Math.PI / 8); }

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/** Gradient noise 2D in [-1,1]. `px/py` > 0 = periodico (texture che si ripetono senza cuciture). */
export function noise2(x: number, y: number, seed = 0, px = 0, py = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const g = (cx: number, cy: number, dx: number, dy: number): number => {
    const k = (hash2(px ? mod(cx, px) : cx, py ? mod(cy, py) : cy, seed) * 16) | 0;
    return GX[k] * dx + GY[k] * dy;
  };
  const u = fade(fx), v = fade(fy);
  return lerp(
    lerp(g(ix, iy, fx, fy), g(ix + 1, iy, fx - 1, fy), u),
    lerp(g(ix, iy + 1, fx, fy - 1), g(ix + 1, iy + 1, fx - 1, fy - 1), u), v) * 1.41;
}

export function fbm2(x: number, y: number, oct = 5, seed = 0, px = 0, py = 0): number {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise2(x * f, y * f, seed + i * 17, px * f, py * f);
    n += a; a *= 0.5; f *= 2;
  }
  return s / n;
}

/** Value noise 3D in [-1,1] (spostamento dei massi). */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const u = fade(x - ix), v = fade(y - iy), w = fade(z - iz);
  const h = (a: number, b: number, c: number): number => hash3(ix + a, iy + b, iz + c, seed);
  return lerp(
    lerp(lerp(h(0, 0, 0), h(1, 0, 0), u), lerp(h(0, 1, 0), h(1, 1, 0), u), v),
    lerp(lerp(h(0, 0, 1), h(1, 0, 1), u), lerp(h(0, 1, 1), h(1, 1, 1), u), v), w) * 2 - 1;
}

export function fbm3(x: number, y: number, z: number, oct = 4, seed = 0): number {
  let a = 0.5, s = 0, n = 0, f = 1;
  for (let i = 0; i < oct; i++) {
    s += a * noise3(x * f, y * f, z * f, seed + i * 31);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
export const clamp = (x: number, a = 0, b = 1): number => Math.min(b, Math.max(a, x));
