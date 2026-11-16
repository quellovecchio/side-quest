import { GroundMesh, MeshBuilder, RawTexture, Scene, Texture, VertexBuffer, VertexData } from "@babylonjs/core";
import { clamp, fbm2, smoothstep } from "./noise";
import { DbError, type Db, type LocationDef } from "../data/db";

// ─────────────────────────────────────────────────────────────────────────────
// TERRENO — una conca boscosa di 320 m: colline morbide, una radura dove si
// nasce (con le pietre erette), un sentiero che serpeggia nel bosco, e i bordi
// che salgono a crinali rocciosi. A est il terreno prosegue per altri 160 m: una
// strada lascia il sentiero, taglia il crinale in una gola e scende alla città,
// su un piano spianato in una valle di colline. È tutto la stessa mesh: fra bosco
// e città non c'è nessun caricamento.
// Tutto discende da funzioni pure (altezza, sentiero, densità del bosco): le usano
// la mesh, la splat map del materiale e il piazzamento della vegetazione.
// DOVE stanno radura, città, sentieri e strade lo dice db.json (`locations`, `roads`):
// `layWorld` lo legge una volta, prima che si generi qualunque cosa.
// ─────────────────────────────────────────────────────────────────────────────

/** La conca del bosco. */
export const WORLD = 320;
export const HALF = WORLD / 2;
/** Quanto il terreno prosegue a est della conca (la valle della città). */
export const EAST = 400;
// ⚠️ Questi valori arrivano dal file con `layWorld`: sono gli stessi oggetti per tutta la partita (si riempiono sul posto)
// e vanno letti solo DENTRO le funzioni, mai al caricamento di un modulo (lì sono ancora vuoti).
/** Dove comincia la partita (il luogo `spawn` del file). */
export const SPAWN = { x: 0, z: 0 };

/** Dove si arriva in un luogo (partenza, viaggio rapido): il suo posto d'arrivo (`arrive`) guardando dove guarda il posto, o il suo centro. */
export function arrival(l: LocationDef): { x: number; z: number; look?: { x: number; z: number } } {
  const s = l.arrive ? l.spots[l.arrive] : undefined;
  if (!s) return { x: l.at[0], z: l.at[1] };
  const x = l.at[0] + s.at[0], z = l.at[1] + s.at[1], a = s.yaw * Math.PI / 180;
  return { x, z, look: { x: x + Math.sin(a) * 10, z: z + Math.cos(a) * 10 } };
}
/** La città: centro, mezzi lati del rettangolo delle mura, quota del piano. La porta è a ovest, in (x − hx, z). */
export const TOWN = { x: 0, z: 0, hx: 0, hz: 0, y: 0 };
/** La porta della città, nel mondo: lì finiscono le strade (`gate.at` nel file, o il lato ovest del rettangolo). */
export const GATE = { x: 0, z: 0 };
type Line = [number, number][];
/**
 * Una discesa nel sottosuolo (i luoghi `crypt` e `cave`): dove comincia (x, z), verso dove scende (dx, dz: un asse), quanto è
 * lunga la rampa e quanto scende, la camera in fondo, e il rettangolo di terreno che le va tolto (sulla griglia da un metro).
 * La geometria la fa `underground.ts`; qui serve a bucare il terreno e a chi chiede la quota (`Levels`).
 */
export interface Pit { id: string; kind: "crypt" | "cave"; x: number; z: number; dx: number; dz: number; len: number; depth: number; room: [number, number]; rect: [number, number, number, number] }
export const PITS: Pit[] = [];
function pit(l: LocationDef): Pit {
  const a = l.yaw! * Math.PI / 180, dx = Math.round(Math.sin(a)), dz = Math.round(Math.cos(a)), len = Math.ceil(l.depth! * 1.9);
  // sulla griglia: lungo la discesa su un intero, di traverso a metà cella (la trincea è larga tre metri)
  const x = dx ? Math.round(l.at[0]) : Math.floor(l.at[0]) + 0.5, z = dz ? Math.round(l.at[1]) : Math.floor(l.at[1]) + 0.5;
  const ex = x + dx * len, ez = z + dz * len, hx = dx ? 0 : 1.5, hz = dz ? 0 : 1.5;
  return { id: l.id, kind: l.kind as Pit["kind"], x, z, dx, dz, len, depth: l.depth!, room: l.room!, rect: [Math.min(x, ex) - hx, Math.min(z, ez) - hz, Math.max(x, ex) + hx, Math.max(z, ez) + hz] };
}

/** Distanza dalla trincea più vicina (0 dentro): erba, felci e cespugli non ci crescono sopra. */
export const pitDist = (x: number, z: number): number => Math.min(1e9, ...PITS.map(({ rect: [x0, z0, x1, z1] }) => Math.hypot(Math.max(0, x0 - x, x - x1), Math.max(0, z0 - z, z - z1))));

/** Le radure, i sentieri, e le strade che scendono alla città (l'ultimo punto è la porta). */
let CLEARINGS: Line = [], TRAILS: Line[] = [], ROADS: Line[] = [];
/** Le zone verdi dentro le mura (`green` nel file: rettangoli lontani dalle vie): lì crescono erba, cespugli e qualche albero. */
let GREENS: [number, number, number, number][] = [];
export const greenAt = (x: number, z: number): boolean => GREENS.some(([x0, z0, x1, z1]) => x > x0 && x < x1 && z > z0 && z < z1);

/** Posa il mondo come dice il file. Va chiamata prima di generare terreno, bosco e città. */
export function layWorld(db: Db): void {
  const town = db.locations.find((l) => l.kind === "settlement")!, start = db.locations.find((l) => l.id === db.spawn)!;
  Object.assign(TOWN, { x: town.at[0], z: town.at[1], hx: town.ground!.rect[0], hz: town.ground!.rect[1], y: town.ground!.level });
  WALLS = (town.walls ?? []).map(([x, z]): [number, number] => [TOWN.x + x, TOWN.z + z]);
  RIVER = town.river ? { line: town.river.line.map(([x, z]): [number, number] => [TOWN.x + x, TOWN.z + z]), hw: town.river.width / 2 } : null;
  const g = town.gate?.at ?? [-TOWN.hx, 0];
  Object.assign(GATE, { x: TOWN.x + g[0], z: TOWN.z + g[1] });
  // la città con il suo margine (la strada che arriva, il piano che si raccorda) deve stare sul terreno
  if (TOWN.x - TOWN.hx < -HALF + 15 || TOWN.x + TOWN.hx > HALF + EAST - 15 || Math.abs(TOWN.z) + TOWN.hz > HALF - 15) throw new DbError(`db.json.locations: "${town.id}" esce dal terreno (x da ${-HALF + 15} a ${HALF + EAST - 15}, z entro ±${HALF - 15}, mura comprese)`);
  // ⚠️ SPAWN è la RADURA (rocce e piante la lasciano sgombra), non dove comincia la partita: quello è `db.spawn`, e lo usa main.ts
  const glade = db.locations.find((l) => l.kind === "clearing") ?? start;
  Object.assign(SPAWN, { x: glade.at[0], z: glade.at[1] });
  PITS.length = 0;
  PITS.push(...db.locations.filter((l) => l.kind === "crypt" || l.kind === "cave").map(pit));
  CLEARINGS = db.locations.filter((l) => l.kind === "clearing").map((l) => l.at);
  TRAILS = db.roads.filter((d) => d.kind === "trail").map((d) => d.line);
  ROADS = db.roads.filter((d) => d.kind === "road").map((d): Line => [...d.line, [GATE.x, GATE.z]]);
  GREENS = town.green.map(([[ax, az], [bx, bz]]) => [TOWN.x + Math.min(ax, bx), TOWN.z + Math.min(az, bz), TOWN.x + Math.max(ax, bx), TOWN.z + Math.max(az, bz)]);
}

/** Distanza da una spezzata e ascissa lungo di essa (0 all'inizio, 1 alla fine). */
function along(line: [number, number][], x: number, z: number): { d: number; t: number } {
  let d = Infinity, t = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1];
    const dx = bx - ax, dz = bz - az;
    const k = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz));
    const e = Math.hypot(x - ax - dx * k, z - az - dz * k);
    if (e < d) { d = e; t = (i + k) / (line.length - 1); }
  }
  return { d, t };
}

/** Le mura della città nel mondo (`walls` nel file; vuoto: il rettangolo) e il fiume (mezzeria nel mondo, mezza larghezza). */
let WALLS: Line = [], RIVER: { line: Line; hw: number } | null = null;
/** Distanza fuori dalle mura (0 dentro): dal poligono se il file lo dà, altrimenti dal rettangolo. */
export function townDist(x: number, z: number): number {
  if (!WALLS.length) return Math.hypot(Math.max(0, Math.abs(x - TOWN.x) - TOWN.hx), Math.max(0, Math.abs(z - TOWN.z) - TOWN.hz));
  let inside = false;
  for (let i = 0, j = WALLS.length - 1; i < WALLS.length; j = i++) {
    const [ax, az] = WALLS[i], [bx, bz] = WALLS[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside ? 0 : along([...WALLS, WALLS[0]], x, z).d;
}
/** Distanza dalla riva del fiume della città (negativa nell'acqua; Infinity senza fiume): lì non crescono alberi né erba. */
export const riverDist = (x: number, z: number): number => (RIVER ? along(RIVER.line, x, z).d - RIVER.hw : Infinity);

// i tracciati ondeggiano un po' fra i punti di controllo, per non sembrare tirati col righello
// (non vicino alla città: la strada deve infilare la porta)
function wobble(x: number, z: number): [number, number] {
  const k = 4 * smoothstep(4, 30, townDist(x, z));
  return [x + fbm2(x / 30, z / 30, 2, 91) * k, z + fbm2(x / 30, z / 30, 2, 92) * k];
}

/** Distanza dal sentiero o dalla strada (m). La strada è più larga: conta un metro e mezzo in meno. */
export function pathDist(x: number, z: number): number {
  const [wx, wz] = wobble(x, z);
  return Math.min(...TRAILS.map((t) => along(t, wx, wz).d), ...ROADS.map((r) => along(r, wx, wz).d - 1.5));
}

/** Distanza dalla radura più vicina. */
const spawnDist = (x: number, z: number): number => Math.min(...CLEARINGS.map(([cx, cz]) => Math.hypot(x - cx, z - cz)));

/** Quanto si è verso il bordo della conca, 0..1 (fuori dalla conca vale 1: è tutto monte). */
function edge(x: number, z: number): number {
  const e = Math.max(Math.abs(x), Math.abs(z)) * 0.55 + Math.hypot(x, z) * 0.45;
  return smoothstep(95, 158, e + fbm2(x / 40, z / 40, 3, 93) * 14);
}

/**
 * Le modifiche al terreno fatte a mano con l'editor della mappa (`public/data/terreno.bin`, salvato a parte): centimetri in
 * più o in meno su ogni vertice della griglia da un metro, Int16, una riga per ogni z da −HALF a +HALF, ogni riga da x = −HALF
 * a HALF + EAST. Senza il file vale zero. Si somma al rilievo generato, quindi lo seguono mesh, rocce, piante e sottosuolo.
 */
export const LIFT = { w: WORLD + EAST + 1, h: WORLD + 1, d: new Int16Array((WORLD + EAST + 1) * (WORLD + 1)) };
/** Legge le modifiche al terreno, se ci sono. Va chiamata prima di generare il mondo. */
export async function loadLift(): Promise<void> {
  const get = (f: string): Promise<ArrayBuffer | null> => fetch(`${import.meta.env.BASE_URL}data/${f}`, { cache: "no-cache" }).then((r) => r.ok ? r.arrayBuffer() : null).catch(() => null);
  const [b, rel] = await Promise.all([get("terreno.bin"), get("rilievo.bin")]);
  if (b?.byteLength === LIFT.d.byteLength) LIFT.d.set(new Int16Array(b));   // (una misura diversa è la pagina del server, non il file)
  if (rel && rel.byteLength > 16) {
    const [x0, z0, w, h] = new Float32Array(rel, 0, 4);
    if (rel.byteLength === 16 + w * h * 3) Object.assign(RELIEF, { x0, z0, w, h, d: new Int16Array(rel, 16, w * h), k: new Uint8Array(rel, 16 + w * h * 2, w * h) });
  }
}

/**
 * Il rilievo della città (`public/data/rilievo.bin`, fatto con Blender: tools/blender/citta.py): la quota del suolo, assoluta,
 * su una griglia da un metro che copre il rettangolo delle mura e i 30 m attorno. Intestazione: quattro Float32 (x0, z0 del primo
 * punto, punti per riga, righe), poi Int16 in centimetri, una riga per ogni z, poi un Uint8 per punto: quanto il rilievo vale
 * rispetto al terreno generato (255 dentro le mura e lungo il fiume, poi sfuma). Senza il file la città è il piano a `TOWN.y`.
 */
const RELIEF = { x0: 0, z0: 0, w: 0, h: 0, d: null as Int16Array | null, k: null as Uint8Array | null };
/** Fra i quattro punti della griglia attorno a (x, z): la media pesata di `a`. */
function cell(x: number, z: number, a: Int16Array | Uint8Array): number {
  const { x0, z0, w, h } = RELIEF;
  const fx = Math.min(Math.max(x - x0, 0), w - 1.001), fz = Math.min(Math.max(z - z0, 0), h - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * w + i;
  return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + w] * (1 - u) + a[k + w + 1] * u) * v;
}
/** Il rilievo della città in metri, col suo rettangolo nel mondo [x0, z0, larghezza, profondità] (null senza il file). */
export function reliefGrid(): { y: Float32Array; w: number; h: number; rect: [number, number, number, number] } | null {
  const { x0, z0, w, h, d } = RELIEF;
  return d ? { y: Float32Array.from(d, (v) => v / 100), w, h, rect: [x0, z0, w - 1, h - 1] } : null;
}
/** La quota del suolo della città in (x, z) del mondo: dal rilievo, o il piano `TOWN.y`. */
export function townGround(x: number, z: number): number {
  return RELIEF.d ? cell(x, z, RELIEF.d) / 100 : TOWN.y;
}
/** Quanto il suolo della città conta in (x, z), da 0 a 1: col rilievo lo dice il file, senza è il piano con 22 m di raccordo. */
function townWeight(x: number, z: number, td: number): number {
  const { x0, z0, w, h, k } = RELIEF;
  if (!k) return 1 - smoothstep(0, 22, td);
  return x < x0 || z < z0 || x > x0 + w - 1 || z > z0 + h - 1 ? 0 : cell(x, z, k) / 255;
}
/** Di quanto il terreno è stato alzato a mano in (x, z), in metri (fra i quattro vertici attorno). */
export function lift(x: number, z: number): number {
  const fx = Math.min(Math.max(x + HALF, 0), LIFT.w - 1.001), fz = Math.min(Math.max(z + HALF, 0), LIFT.h - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, d = LIFT.d, k = j * LIFT.w + i;
  return ((d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + LIFT.w] * (1 - u) + d[k + LIFT.w + 1] * u) * v) / 100;
}

export const terrainHeight = (x: number, z: number): number => baseHeight(x, z) + lift(x, z);
/** Il rilievo generato, senza le modifiche a mano. */
export function baseHeight(x: number, z: number): number {
  const broad = fbm2(x / 110, z / 110, 4, 1) * 10;
  let h = broad + fbm2(x / 28, z / 28, 4, 2) * 2.2 + fbm2(x / 7, z / 7, 2, 3) * 0.25;
  const td = townDist(x, z), [wx, wz] = wobble(x, z);
  // crinali ai bordi: rumore "ridged" che sale fino a ~40 m; attorno alla città si abbassano a colline (una valle, non un pozzo)
  const e = edge(x, z);
  const ridge = 1 - Math.abs(fbm2(x / 45, z / 45, 4, 4));
  h += e * e * (28 + ridge * 22) * (0.22 + 0.78 * smoothstep(15, 95, td));
  // radura: si spiana verso la quota del rumore largo
  const flat = 1 - smoothstep(10, 30, spawnDist(x, z));
  h = h + (broad * 0.5 - h) * flat * 0.85;
  // sentiero: segue la quota larga, spianato e appena incassato
  const track = broad + fbm2(x / 28, z / 28, 2, 2) * 1.5 - 0.15;
  for (const t of TRAILS) h = h + (track - h) * (1 - smoothstep(1.5, 5, along(t, wx, wz).d)) * 0.8;
  // strada: parte come il sentiero, poi si allarga in una gola che taglia il crinale e scende alla quota della città
  for (const road of ROADS) {
    const r = along(road, wx, wz), g = smoothstep(0.1, 0.45, r.t);
    const level = track + (townGround(GATE.x, GATE.z) - track) * smoothstep(0.2, 0.8, r.t);   // (alla quota della porta)
    h += (level - h) * (1 - smoothstep(1.5 + 4.5 * g, 5 + 27 * g, r.d)) * (0.8 + 0.2 * g);
  }
  // il piano della città
  h += (townGround(x, z) - h) * townWeight(x, z, td);   // (il rilievo della città, o il suo piano)
  return h;
}

/** Densità del bosco 0..1 (fuori dalla radura, dal sentiero e dalla città, a chiazze con prati). */
export function forestDensity(x: number, z: number): number {
  if (greenAt(x, z)) return 0.38;   // un verde di città: rado
  const n = fbm2(x / 55, z / 55, 4, 7) * 0.5 + 0.5;
  let d = smoothstep(0.34, 0.56, n);
  d *= smoothstep(16, 34, spawnDist(x, z));
  d *= 1 - edge(x, z) * 0.35;
  d *= smoothstep(8, 32, townDist(x, z));
  return d;
}

export interface Terrain {
  mesh: GroundMesh;
  splat: Texture;
  /** Il rettangolo coperto dalla splat map: [x0, z0, larghezza, profondità]. */
  rect: [number, number, number, number];
  height(x: number, z: number): number;
}

export function createTerrain(scene: Scene): Terrain {
  const W = WORLD + EAST;
  // celle da 1 m; la mesh è centrata, e spostata a est di mezzo prolungamento
  const mesh = MeshBuilder.CreateGround("terrain", { width: W, height: WORLD, subdivisionsX: W, subdivisionsY: WORLD, updatable: true }, scene);
  const pos = mesh.getVerticesData(VertexBuffer.PositionKind)!;
  for (let i = 0; i < pos.length; i += 3) pos[i + 1] = terrainHeight(pos[i] + EAST / 2, pos[i + 2]);
  mesh.updateVerticesData(VertexBuffer.PositionKind, pos);
  const normals: number[] = [];
  VertexData.ComputeNormals(pos, mesh.getIndices()!, normals);
  mesh.updateVerticesData(VertexBuffer.NormalKind, normals);
  // le discese nel sottosuolo: via i triangoli sopra ogni trincea (le quote restano: le legge ancora chi chiede l'altezza)
  if (PITS.length) {
    const idx = mesh.getIndices()!, keep: number[] = [];
    for (let i = 0; i < idx.length; i += 3) {
      const cx = (pos[idx[i] * 3] + pos[idx[i + 1] * 3] + pos[idx[i + 2] * 3]) / 3 + EAST / 2, cz = (pos[idx[i] * 3 + 2] + pos[idx[i + 1] * 3 + 2] + pos[idx[i + 2] * 3 + 2]) / 3;
      if (!PITS.some(({ rect: [x0, z0, x1, z1] }) => cx > x0 && cx < x1 && cz > z0 && cz < z1)) keep.push(idx[i], idx[i + 1], idx[i + 2]);
    }
    mesh.setIndices(keep);
  }
  mesh.position.x = EAST / 2;
  mesh.computeWorldMatrix(true);
  mesh.updateCoordinateHeights();
  mesh.refreshBoundingInfo();
  mesh.freezeWorldMatrix();
  mesh.receiveShadows = true;

  // Splat map: R terra battuta (sentiero, strada, città), G sottobosco (sotto gli alberi), B variazione macro, A umidità/muschio
  const SX = 768, SZ = 512;   // 0,625 m per texel
  const data = new Uint8Array(SX * SZ * 4);
  for (let j = 0; j < SZ; j++) for (let i = 0; i < SX; i++) {
    const x = -HALF + (i / (SX - 1)) * W, z = (j / (SZ - 1) - 0.5) * WORLD;
    const k = (j * SX + i) * 4;
    const [wx, wz] = wobble(x, z), n = fbm2(x / 3, z / 3, 2, 95) * 0.8;
    const dirt = Math.max(...TRAILS.map((t) => 1 - smoothstep(1.2, 3.2, along(t, wx, wz).d + n)), ...ROADS.map((r) => 1 - smoothstep(2.4, 4.6, along(r, wx, wz).d + n)), greenAt(x, z) ? 0 : 1 - smoothstep(1, 6, townDist(x, z) + n * 2));
    data[k] = dirt * 255;
    const fd = forestDensity(x, z);
    data[k + 1] = smoothstep(0.25, 0.75, fd + fbm2(x / 9, z / 9, 3, 96) * 0.25) * 255;
    data[k + 2] = (fbm2(x / 35, z / 35, 4, 97) * 0.5 + 0.5) * 255;
    data[k + 3] = clamp(fd * 0.9 + fbm2(x / 14, z / 14, 3, 98) * 0.6) * 255;
  }
  // ⚠️ RawTexture: la riga 0 è z = −HALF, come in uv = (xz − origine) / lato nello shader (invertY = false)
  const splat = RawTexture.CreateRGBATexture(data, SX, SZ, scene, true, false, Texture.BILINEAR_SAMPLINGMODE);
  splat.wrapU = splat.wrapV = Texture.CLAMP_ADDRESSMODE;
  splat.gammaSpace = false;

  return { mesh, splat, rect: [-HALF, -HALF, W, WORLD], height: (x, z) => mesh.getHeightAtCoordinates(x, z) };
}
