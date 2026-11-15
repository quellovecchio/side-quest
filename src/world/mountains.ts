import { Color3, Mesh, VertexData, type Scene } from "@babylonjs/core";
import { CustomMaterial } from "@babylonjs/materials";
import { fbm2 } from "./noise";

// ─────────────────────────────────────────────────────────────────────────────
// MONTAGNE — l'anello di creste lontane che fa da sfondo (dalle vetrate della cattedrale, dal promontorio, dalla strada).
// Va da sotto il terreno (150 m dal centro: il terreno finisce a 165 m verso nord e sud), con una pianura che sfuma tutta
// nel colore della nebbia (così non si vede dove il terreno finisce), alle creste, fra 750 e 1150 m dal centro della città.
// La nebbia del gioco a quella distanza le cancellerebbe: il materiale non la prende e le vela da sé col colore della nebbia
// del momento (la pianura del tutto, i piedi molto, le cime meno: lo shader lo calcola da distanza e quota), così cambiano
// con l'ora come il resto. Una mesh sola; non fanno ombra.
// ⚠️ Non nell'alfa dei vertici: senza `hasVertexAlpha` Babylon la passa sempre a 1.
// ─────────────────────────────────────────────────────────────────────────────

export function createMountains(scene: Scene, cx: number, cz: number): Mesh {
  const rows = 70, cols = 480, R0 = 150, R1 = 1150, pos: number[] = [], col: number[] = [], idx: number[] = [];
  const s = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };   // smoothstep
  for (let j = 0; j < rows; j++) {
    const r = R0 + (R1 - R0) * (j / (rows - 1)) ** 0.8;
    for (let i = 0; i < cols; i++) {
      const a = i / cols * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const ridge = 1 - Math.abs(fbm2(x / 420, z / 420, 4, 61)), rise = s(640, 980, r);
      const y = -6 + (ridge ** 1.7) * 340 * rise + fbm2(x / 120, z / 120, 3, 62) * 40 * rise + fbm2(x / 60, z / 60, 2, 63) * 6;
      pos.push(cx + x, y, cz + z);
      const snow = y > 190 ? Math.min(1, (y - 190) / 50) : 0, rock = Math.min(1, Math.max(0, (y - 40) / 140));
      const c = [0.16 + rock * 0.26, 0.18 + rock * 0.24, 0.13 + rock * 0.26].map((v) => v + (0.95 - v) * snow);
      col.push(c[0], c[1], c[2], 1);
    }
  }
  for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols; i++) {
    const a = j * cols + i, b = j * cols + (i + 1) % cols, c = a + cols, d = b + cols;
    idx.push(a, c, b, b, c, d);
  }
  const mesh = new Mesh("montagne", scene), vd = new VertexData(), nor: number[] = [];
  VertexData.ComputeNormals(pos, idx, nor);
  Object.assign(vd, { positions: pos, indices: idx, normals: nor, colors: col });
  vd.applyToMesh(mesh);
  const m = new CustomMaterial("montagne", scene);
  m.specularColor = Color3.Black(); m.backFaceCulling = false; m.fogEnabled = false;
  // la foschia a mano, verso il colore della nebbia (in gamma: qui, dopo la conversione in lineare, va portato in lineare)
  m.AddUniform("sqHaze", "vec3", undefined);
  m.AddUniform("sqHazeAt", "vec2", undefined);
  m.Fragment_Before_FragColor(`
    float sqR = distance(vPositionW.xz, sqHazeAt), sqT = clamp((sqR - 560.0) / 200.0, 0.0, 1.0);
    float sqV = max(1.0 - sqT * sqT * (3.0 - 2.0 * sqT), 0.8 - 0.5 * clamp(vPositionW.y / 300.0, 0.0, 1.0));
    color.rgb = mix(color.rgb, pow(sqHaze, vec3(2.2)), sqV);`);
  const attach = m.AttachAfterBind.bind(m);   // (le uniform si danno qui, con l'effetto giusto: vedi CLAUDE.md)
  m.AttachAfterBind = (mesh, effect) => { attach(mesh, effect); const f = scene.fogColor; effect.setFloat3("sqHaze", f.r, f.g, f.b); effect.setFloat2("sqHazeAt", cx, cz); };
  mesh.material = m; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true;
  mesh.freezeWorldMatrix();
  return mesh;
}
