import { GroundMesh, MeshBuilder, RawTexture, Scene, Texture, VertexBuffer, VertexData } from "@babylonjs/core";
import { clamp, fbm2, smoothstep } from "./noise";

// ─────────────────────────────────────────────────────────────────────────────
// TERRENO — una conca boscosa di 320 m: colline morbide, una radura dove si
// nasce (con le pietre erette), un sentiero che serpeggia nel bosco, e i bordi
// che salgono a crinali rocciosi (il confine naturale della demo).
// Tutto discende da funzioni pure (altezza, sentiero, densità del bosco): le usano
// la mesh, la splat map del materiale e il piazzamento della vegetazione.
// ─────────────────────────────────────────────────────────────────────────────

export const WORLD = 320;
export const HALF = WORLD / 2;
export const SPAWN = { x: 0, z: -6 };

// Il sentiero: dalla radura verso nord-est, poi giù a sud-ovest nel fitto.
const PATH: [number, number][] = [
  [-120, -95], [-95, -70], [-70, -58], [-45, -38], [-22, -22], [0, -6], [14, 10], [22, 34], [18, 58],
  [30, 80], [55, 92], [85, 98], [112, 118],
];

/** Distanza dal sentiero (m). */
export function pathDist(x: number, z: number): number {
  // il tracciato ondeggia un po' fra i punti di controllo, per non sembrare tirato col righello
  const wx = x + fbm2(x / 30, z / 30, 2, 91) * 4, wz = z + fbm2(x / 30, z / 30, 2, 92) * 4;
  let d = Infinity;
  for (let i = 0; i < PATH.length - 1; i++) {
    const [ax, az] = PATH[i], [bx, bz] = PATH[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((wx - ax) * dx + (wz - az) * dz) / (dx * dx + dz * dz));
    d = Math.min(d, Math.hypot(wx - ax - dx * t, wz - az - dz * t));
  }
  return d;
}

const spawnDist = (x: number, z: number): number => Math.hypot(x - SPAWN.x, z - SPAWN.z);

/** Quanto si è verso il bordo della conca, 0..1. */
function edge(x: number, z: number): number {
  const e = Math.max(Math.abs(x), Math.abs(z)) * 0.55 + Math.hypot(x, z) * 0.45;
  return smoothstep(95, 158, e + fbm2(x / 40, z / 40, 3, 93) * 14);
}

export function terrainHeight(x: number, z: number): number {
  const broad = fbm2(x / 110, z / 110, 4, 1) * 10;
  let h = broad + fbm2(x / 28, z / 28, 4, 2) * 2.2 + fbm2(x / 7, z / 7, 2, 3) * 0.25;
  // crinali ai bordi: rumore "ridged" che sale fino a ~40 m
  const e = edge(x, z);
  const ridge = 1 - Math.abs(fbm2(x / 45, z / 45, 4, 4));
  h += e * e * (28 + ridge * 22);
  // radura: si spiana verso la quota del rumore largo
  const flat = 1 - smoothstep(10, 30, spawnDist(x, z));
  h = h + (broad * 0.5 - h) * flat * 0.85;
  // sentiero: segue la quota larga, spianato e appena incassato
  const p = 1 - smoothstep(1.5, 5, pathDist(x, z));
  h = h + (broad + fbm2(x / 28, z / 28, 2, 2) * 1.5 - 0.15 - h) * p * 0.8;
  return h;
}

/** Densità del bosco 0..1 (fuori dalla radura e dal sentiero, a chiazze con prati). */
export function forestDensity(x: number, z: number): number {
  const n = fbm2(x / 55, z / 55, 4, 7) * 0.5 + 0.5;
  let d = smoothstep(0.34, 0.56, n);
  d *= smoothstep(16, 34, spawnDist(x, z));
  d *= 1 - edge(x, z) * 0.35;
  return d;
}

export interface Terrain {
  mesh: GroundMesh;
  splat: Texture;
  height(x: number, z: number): number;
}

export function createTerrain(scene: Scene): Terrain {
  const sub = 320;
  const mesh = MeshBuilder.CreateGround("terrain", { width: WORLD, height: WORLD, subdivisions: sub, updatable: true }, scene);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = terrainHeight(pos[i], pos[i + 2]);
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, mesh.getIndices()!, normals);
  mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
  mesh.updateCoordinateHeights();
  mesh.refreshBoundingInfo();
  mesh.freezeWorldMatrix();
  mesh.receiveShadows = true;

  // Splat map: R sentiero, G sottobosco (sotto gli alberi), B variazione macro, A umidità/muschio
  const S = 512;
  const data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i / (S - 1) - 0.5) * WORLD, z = (j / (S - 1) - 0.5) * WORLD;
    const k = (j * S + i) * 4;
    const pd = pathDist(x, z);
    data[k] = (1 - smoothstep(1.2, 3.2, pd + fbm2(x / 3, z / 3, 2, 95) * 0.8)) * 255;
    const fd = forestDensity(x, z);
    data[k + 1] = smoothstep(0.25, 0.75, fd + fbm2(x / 9, z / 9, 3, 96) * 0.25) * 255;
    data[k + 2] = (fbm2(x / 35, z / 35, 4, 97) * 0.5 + 0.5) * 255;
    data[k + 3] = clamp(fd * 0.9 + fbm2(x / 14, z / 14, 3, 98) * 0.6) * 255;
  }
  // ⚠️ RawTexture: la riga 0 è z = −HALF, come in uv = xz / WORLD + 0.5 nello shader (invertY = false)
  const splat = RawTexture.CreateRGBATexture(data, S, S, scene, true, false, Texture.BILINEAR_SAMPLINGMODE);
  splat.wrapU = splat.wrapV = Texture.CLAMP_ADDRESSMODE;
  splat.gammaSpace = false;

  return { mesh, splat, height: (x, z) => mesh.getHeightAtCoordinates(x, z) };
}
