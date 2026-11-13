import { Color3, Mesh, VertexBuffer, VertexData, type AbstractMesh, type BaseTexture, type Material, type Scene } from "@babylonjs/core";
import { CustomMaterial } from "@babylonjs/materials";

// ─────────────────────────────────────────────────────────────────────────────
// BORDO DEI PERSONAGGI — una riga scura attorno alla sagoma di chi si muove (abitanti, lupi, ratti) e
// di ciò che si tiene in mano: dà definizione ai modelli, soprattutto nello stile a pixel.
// È uno "scafo rovesciato": per ogni modello una copia con gli stessi triangoli, figlia del modello e
// con lo STESSO scheletro, quindi si muove con lui nello stesso fotogramma (il bordo fatto come filtro
// sulla profondità restava indietro rispetto alle animazioni, e costava una scena in più). Della copia
// si disegnano solo le facce che guardano via da chi guarda, in tinta scura, spostate lungo la normale:
// il modello vero le copre tutte tranne il bordo che sporge. Lo spostamento è fatto nello shader ed è
// in proporzione alla distanza, così a schermo la riga è sempre larga uguale (poco più di un pixel).
// Costa un disegno in più per modello.
// Le facce vanno girate tutte dallo stesso verso (le mesh del gioco non scartano le facce dietro, e
// l'ordine dei vertici è a caso): ogni triangolo si rigira secondo le normali dei suoi vertici. Le
// normali dello scafo sono fuse per posizione, o agli spigoli vivi si aprirebbe.
// ponytail: solo personaggi e mani. Gli edifici sono mesh fuse grandi come la città, coi muri a una
// faccia sola: per loro serve un filtro su profondità e normali dello stesso passaggio della scena.
// ─────────────────────────────────────────────────────────────────────────────

const FLIP = false;   // da che parte Babylon scarta le facce: se lo scafo esce pieno invece che a bordo, è questo da girare

export class Hulls {
  private mat: CustomMaterial;
  private list: { src: AbstractMesh; hull: Mesh }[] = [];
  private on = false;

  constructor(private scene: Scene) {
    const m = new CustomMaterial("bordo", scene);
    // (le luci restano accese solo perché lo shader abbia le normali: nero su nero non danno niente)
    m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black(); m.emissiveColor = new Color3(0.035, 0.028, 0.055); m.backFaceCulling = true;
    m.AddUniform("sqW", "float", undefined);
    m.Vertex_After_WorldPosComputed("worldPos.xyz += normalize(mat3(finalWorld) * normalUpdated) * (sqW * distance(worldPos.xyz, vEyePosition.xyz));");
    const attach = m.AttachAfterBind.bind(m);
    m.AttachAfterBind = (mesh, effect) => {
      attach(mesh, effect);
      const h = scene.getEngine().getRenderHeight(), cam = scene.activeCamera;
      effect.setFloat("sqW", Math.max(1.9, h / 400) * 2 * Math.tan((cam?.fov ?? 0.9) / 2) / h);   // due pixel scarsi, a ogni distanza e risoluzione
    };
    this.mat = m;
  }

  /** Dà il bordo a queste mesh (una volta sola per mesh). */
  add(meshes: AbstractMesh[]): void {
    for (const src of meshes) {
      const pos = src.getVerticesData(VertexBuffer.PositionKind), nor = src.getVerticesData(VertexBuffer.NormalKind), idx = src.getIndices();
      if (!pos || !nor || !idx || this.list.some((l) => l.src === src)) continue;
      const ind: number[] = [], sum = new Map<string, [number, number, number]>(), key = (i: number): string => `${Math.round(pos[i * 3] * 500)},${Math.round(pos[i * 3 + 1] * 500)},${Math.round(pos[i * 3 + 2] * 500)}`;
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2], vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
        let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
        // la faccia guarda dalla parte delle normali dei suoi vertici? se no la si rigira; poi tutte al contrario (lo scafo è rovesciato)
        const same = fx * (nor[a * 3] + nor[b * 3] + nor[c * 3]) + fy * (nor[a * 3 + 1] + nor[b * 3 + 1] + nor[c * 3 + 1]) + fz * (nor[a * 3 + 2] + nor[b * 3 + 2] + nor[c * 3 + 2]) >= 0;
        if (!same) { fx = -fx; fy = -fy; fz = -fz; }
        ind.push(a, same === FLIP ? c : b, same === FLIP ? b : c);
        for (const i of [a, b, c]) { const k = key(i), s = sum.get(k) ?? sum.set(k, [0, 0, 0]).get(k)!; s[0] += fx; s[1] += fy; s[2] += fz; }
      }
      const smooth = new Float32Array(pos.length);
      for (let i = 0; i < pos.length / 3; i++) { const s = sum.get(key(i)) ?? [0, 1, 0], l = Math.hypot(s[0], s[1], s[2]) || 1; for (let k = 0; k < 3; k++) smooth[i * 3 + k] = s[k] / l; }
      const hull = new Mesh(src.name + "_bordo", this.scene), vd = new VertexData();
      vd.positions = pos; vd.normals = smooth; vd.indices = ind;
      if (src.skeleton) { vd.matricesIndices = src.getVerticesData(VertexBuffer.MatricesIndicesKind); vd.matricesWeights = src.getVerticesData(VertexBuffer.MatricesWeightsKind); }
      vd.applyToMesh(hull);
      if (src.skeleton) { hull.skeleton = src.skeleton; hull.numBoneInfluencers = (src as Mesh).numBoneInfluencers; }
      hull.parent = src; hull.material = this.mat; hull.isPickable = false; hull.alwaysSelectAsActiveMesh = true;
      hull.renderingGroupId = src.renderingGroupId; hull.metadata = { shell: true };
      hull.setEnabled(this.on);
      this.list.push({ src, hull });
    }
  }

  set(on: boolean): void { this.on = on; this.update(); }

  /** Una volta per fotogramma: chi si sta disfacendo in pulviscolo (un nemico morto) perde il bordo. */
  update(): void {
    for (const { src, hull } of this.list) {
      const show = this.on && !((src.metadata?.fx?.dissolve as number | undefined) ?? 0);
      if (hull.isEnabled(false) !== show) hull.setEnabled(show);
    }
  }
}

// ── I materiali adattati al cel shading ──────────────────────────────────────
// Le texture fotografiche lavorano contro la luce a gradini: ogni sasso e ogni fuga piega la luce per conto suo e il bordo
// fra un gradino e l'altro si spezza in mille frammenti. Col cel shading acceso: le normali pesano un terzo, il rilievo a
// parallasse si spegne (i gradini seguono i volumi grandi, non i pori) e l'occlusione fotografica pesa meno della metà.
// Le texture stesse si leggono più piccole (pixel.ts, `textures`). Spento, tutto torna com'era.
const bumps = new Map<BaseTexture, number>(), reliefs = new Map<Material, boolean>(), occl = new Map<Material, number>();
type Pbr = Material & { bumpTexture?: BaseTexture | null; useParallax?: boolean; ambientTextureStrength?: number };
export function flattenMaterials(scene: Scene, on: boolean): void {
  for (const m of scene.materials as Pbr[]) {
    const b = m.bumpTexture;
    if (b) { if (!bumps.has(b)) bumps.set(b, b.level); b.level = bumps.get(b)! * (on ? 0.35 : 1); }
    if (m.useParallax !== undefined) { if (!reliefs.has(m)) reliefs.set(m, m.useParallax); m.useParallax = on ? false : reliefs.get(m)!; }
    if (m.ambientTextureStrength !== undefined) { if (!occl.has(m)) occl.set(m, m.ambientTextureStrength); m.ambientTextureStrength = occl.get(m)! * (on ? 0.4 : 1); }
  }
}
