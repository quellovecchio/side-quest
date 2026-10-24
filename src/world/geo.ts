import { Color4, Matrix, Mesh, Quaternion, Scene, Vector3, VertexData } from "@babylonjs/core";

/** Accumula vertici e triangoli; `mesh()` li consegna a Babylon. Colori = occlusione finta per vertice. */
export class Geo {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = []; idx: number[] = [];

  vert(p: Vector3, n: Vector3, u: number, v: number, ao = 1): number {
    this.p.push(p.x, p.y, p.z); this.n.push(n.x, n.y, n.z); this.uv.push(u, v); this.c.push(ao, ao, ao, 1);
    return this.p.length / 3 - 1;
  }

  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }

  mesh(name: string, scene: Scene): Mesh {
    const m = new Mesh(name, scene);
    const vd = new VertexData();
    vd.positions = this.p; vd.normals = this.n; vd.uvs = this.uv; vd.colors = this.c; vd.indices = this.idx;
    vd.applyToMesh(m);
    return m;
  }
}

/**
 * Tubo lungo una polilinea (tronchi, rami, tronchi caduti), con frame a trasporto parallelo:
 * niente torsioni dove la curva gira. `uRep` ripetizioni della texture attorno, `vLen` metri per ripetizione lungo.
 */
export function tube(g: Geo, pts: Vector3[], radii: number[], sides: number, uRep: number, vLen: number, ao: (i: number) => number = () => 1): void {
  const n = pts.length;
  const T = pts.map((_, i) => pts[Math.min(n - 1, i + 1)].subtract(pts[Math.max(0, i - 1)]).normalize());
  let N = Math.abs(T[0].y) < 0.9 ? Vector3.Cross(T[0], Vector3.Up()).normalize() : Vector3.Cross(T[0], Vector3.Right()).normalize();
  let len = 0;
  const base = g.p.length / 3;
  for (let i = 0; i < n; i++) {
    if (i > 0) len += Vector3.Distance(pts[i], pts[i - 1]);
    N = N.subtract(T[i].scale(Vector3.Dot(N, T[i]))).normalize();
    const B = Vector3.Cross(T[i], N);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const d = N.scale(Math.cos(a)).addInPlace(B.scale(Math.sin(a)));
      g.vert(pts[i].add(d.scale(radii[i])), d, (s / sides) * uRep, len / vLen, ao(i));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let s = 0; s < sides; s++) {
    const a = base + i * (sides + 1) + s, b = a + sides + 1;
    g.tri(a, b, a + 1); g.tri(a + 1, b, b + 1);
  }
}

/**
 * Carta suddivisa lungo la lunghezza (fogliame): `path(t)` dà il centro, `side` la semilarghezza,
 * `normal(p, t)` la normale (di solito "a sfera" dalla chioma), `uvAt(t, s)` le uv (s = 0|1 sui due lati).
 */
export function strip(
  g: Geo, segs: number, path: (t: number) => Vector3, side: (t: number) => Vector3,
  normal: (p: Vector3, t: number) => Vector3, uvAt: (t: number, s: number) => [number, number], ao: (p: Vector3, t: number) => number,
): void {
  const base = g.p.length / 3;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, c = path(t), sd = side(t);
    for (let s = 0; s < 2; s++) {
      const p = s ? c.add(sd) : c.subtract(sd);
      const [u, v] = uvAt(t, s);
      g.vert(p, normal(p, t), u, v, ao(p, t));
    }
  }
  for (let i = 0; i < segs; i++) {
    const a = base + i * 2;
    g.tri(a, a + 2, a + 1); g.tri(a + 1, a + 2, a + 3);
  }
}

export interface Placement { m: Matrix; color?: Color4 }

/**
 * Sparge istanze di `source` raggruppate in CHUNK spaziali (una mesh a istanze sottili per chunk):
 * così frustum culling e cascate d'ombra scartano i chunk fuori vista invece di disegnare tutto
 * ovunque. Restituisce le mesh dei chunk. La sorgente resta spenta.
 */
export function scatter(source: Mesh, items: Placement[], chunk = 40): Mesh[] {
  const groups = new Map<string, Placement[]>();
  const t = new Vector3();
  for (const it of items) {
    it.m.getTranslationToRef(t);
    const key = `${Math.floor(t.x / chunk)}_${Math.floor(t.z / chunk)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = []);
    g.push(it);
  }
  const out: Mesh[] = [];
  for (const [key, g] of groups) {
    const m = source.clone(`${source.name}_${key}`, null, true, false);
    // ⚠️ Babylon mette i buffer delle istanze sottili sulla GEOMETRIA: con la geometria condivisa
    // del clone ogni chunk sovrascriveva quelli degli altri e si vedeva solo l'ultimo.
    m.makeGeometryUnique();
    m.setEnabled(true);
    const buf = new Float32Array(g.length * 16);
    g.forEach((it, i) => it.m.copyToArray(buf, i * 16));
    m.thinInstanceSetBuffer("matrix", buf, 16, true);
    if (g[0].color) {
      const col = new Float32Array(g.length * 4);
      g.forEach((it, i) => { const c = it.color!; col.set([c.r, c.g, c.b, c.a], i * 4); });
      m.thinInstanceSetBuffer("color", col, 4, true);
    }
    m.thinInstanceRefreshBoundingInfo(false);
    m.isPickable = false;
    m.alwaysSelectAsActiveMesh = false;
    m.freezeWorldMatrix();
    out.push(m);
  }
  source.setEnabled(false);
  return out;
}

/** Matrice: scala uniforme `s`, rotazione (yaw, tilt), posizione. */
export function trs(x: number, y: number, z: number, s: number | Vector3, yaw: number, tiltX = 0, tiltZ = 0): Matrix {
  const sc = typeof s === "number" ? new Vector3(s, s, s) : s;
  return Matrix.Compose(sc, Quaternion.RotationYawPitchRoll(yaw, tiltX, tiltZ), new Vector3(x, y, z));
}

