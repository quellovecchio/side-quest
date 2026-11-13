import { Color3, Color4, Effect, Mesh, PostProcess, RenderTargetTexture, StandardMaterial, Texture, VertexBuffer, VertexData, type AbstractMesh, type Scene } from "@babylonjs/core";
import { TAIL } from "./pixel";

// ─────────────────────────────────────────────────────────────────────────────
// CONTORNI — ciò che si può usare, quando si è abbastanza vicini da usarlo, ha un contorno chiaro
// attorno alla sua sagoma: SOLO il bordo di fuori (niente righe dentro: i cuscini di un letto, gli
// occhi di una persona), che ondeggia come un filo di fumo e compare e scompare in un attimo.
// Come: ogni cosa da usare ha una COPIA (stessi triangoli) che non si disegna mai nella scena ma solo
// in una maschera, una texture a parte: bianca dove c'è l'oggetto, nera altrove (più chiara per ciò a
// cui il tasto E si rivolge, e più o meno chiara mentre compare o scompare). Un filtro a fine
// fotogramma guarda la maschera: un pixel che sta FUORI dalla sagoma ma ne ha un pezzo vicino prende
// il colore del contorno. Quanto "vicino" lo decide un rumore che sale: per questo il bordo è più
// largo qui e più stretto lì, e si muove.
// Molte cose da usare non sono una mesh a sé (un letto sta nella mesh della stanza): la loro copia si
// fa dai soli triangoli dell'arredo (interiors.ts, `PROPS`). Chi ha uno scheletro ha una copia che
// segue le stesse ossa.
// ponytail: la maschera non sa cosa sta DAVANTI all'oggetto (un contorno si vede anche attraverso un
// tavolo che copre mezzo forziere): a portata di mano capita di rado; per farlo bene la maschera va
// disegnata contro la profondità della scena.
// ─────────────────────────────────────────────────────────────────────────────

const FADE = 0.13;   // secondi per comparire o scomparire

Effect.ShadersStore.sqContornoFragmentShader = `
precision highp float;
varying vec2 vUV;
uniform sampler2D textureSampler;
uniform sampler2D sqMask;
uniform vec3 sqInfo;   // tempo, larghezza / altezza, acceso
float sqH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sqN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(sqH(i), sqH(i + vec2(1.0, 0.0)), f.x), mix(sqH(i + vec2(0.0, 1.0)), sqH(i + vec2(1.0, 1.0)), f.x), f.y); }
void main(void) {
  vec4 c = texture2D(textureSampler, vUV);
  if (sqInfo.z > 0.5 && texture2D(sqMask, vUV).r < 0.04) {   // solo FUORI dalla sagoma
    vec2 q = vUV * vec2(sqInfo.y, 1.0);
    // il fumo: un rumore che sale decide quanto è largo il bordo in quel punto, uno più fitto quanto è acceso
    float n = sqN(q * 11.0 + vec2(0.0, -sqInfo.x * 0.8)), n2 = sqN(q * 27.0 + vec2(sqInfo.x * 0.35, -sqInfo.x * 1.5));
    vec2 r = vec2(1.0 / sqInfo.y, 1.0) * (0.0026 + 0.0052 * n);
    float near = 0.0, far = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.7853982; vec2 d = vec2(cos(a), sin(a));
      near = max(near, texture2D(sqMask, vUV + d * r).r);
      far = max(far, texture2D(sqMask, vUV + d * r * 2.3).r);
    }
    float e = max(near, far * 0.42 * n2);   // un bordo netto e, attorno, un alone a sbuffi
    c.rgb += vec3(0.95, 0.76, 0.42) * e * (0.6 + 0.5 * n2);
  }
  gl_FragColor = c;
}`;

export class Outliner {
  private strong: StandardMaterial; private weak: StandardMaterial;
  private copies = new WeakMap<AbstractMesh, Mesh>();
  private fade = new Map<Mesh, number>();
  private mask: RenderTargetTexture;
  private t = 0;

  constructor(private scene: Scene) {
    const mat = (name: string, v: number): StandardMaterial => {
      const m = new StandardMaterial(name, scene);
      m.disableLighting = true; m.emissiveColor = new Color3(v, v, v); m.diffuseColor = Color3.Black(); m.specularColor = Color3.Black();
      m.fogEnabled = false; m.backFaceCulling = false;
      return m;
    };
    this.strong = mat("contorno", 1); this.weak = mat("contorno_tenue", 0.45);
    // la maschera: a mezza risoluzione, nera, con dentro solo le copie accese (la si disegna solo quando ce n'è almeno una)
    this.mask = new RenderTargetTexture("contorni", { ratio: 0.5 }, scene, false, true, 0, false, Texture.BILINEAR_SAMPLINGMODE);
    this.mask.clearColor = new Color4(0, 0, 0, 1); this.mask.renderList = [];
    this.mask.renderParticles = false; this.mask.renderSprites = false;   // (o ci finiscono dentro pulviscolo e foschia, e il filtro ne fa un alone)
    const pp = new PostProcess("contorno", "sqContorno", ["sqInfo"], ["sqMask"], 1, null, Texture.BILINEAR_SAMPLINGMODE, scene.getEngine());
    pp.onApply = (e) => {
      const en = scene.getEngine();
      e.setTexture("sqMask", this.mask);
      e.setFloat3("sqInfo", this.t, en.getRenderWidth() / en.getRenderHeight(), this.fade.size ? 1 : 0);
    };
    TAIL.push(pp);   // (sta in coda ai filtri, prima di quello dello stile a pixel: pixel.ts lo riattacca nell'ordine giusto)
  }

  /** La copia di un insieme di triangoli (posizioni nel riferimento di `parent`, o del mondo). `rig` = la mesh con le ossa da seguire. */
  shell(name: string, pos: ArrayLike<number>, idx: ArrayLike<number>, parent: AbstractMesh["parent"] = null, rig?: AbstractMesh): Mesh {
    const mesh = new Mesh(name, this.scene), vd = new VertexData();
    vd.positions = Array.from(pos); vd.indices = Array.from(idx);
    if (rig) { vd.matricesIndices = rig.getVerticesData(VertexBuffer.MatricesIndicesKind); vd.matricesWeights = rig.getVerticesData(VertexBuffer.MatricesWeightsKind); }
    vd.applyToMesh(mesh);
    if (rig) { mesh.skeleton = rig.skeleton; mesh.numBoneInfluencers = (rig as Mesh).numBoneInfluencers; }
    mesh.parent = parent;
    // (la maschera della camera non la comprende: nella scena non si disegna; l'elenco della maschera sì, qualunque maschera abbia)
    mesh.layerMask = 0x10000000; mesh.material = this.weak; mesh.isPickable = false; mesh.alwaysSelectAsActiveMesh = true; mesh.metadata = { shell: true };
    return mesh;
  }

  /** La copia di una mesh vera (la si fa la prima volta che serve). Una copia già fatta resta sé stessa. */
  private of(src: AbstractMesh): Mesh | null {
    if (src.metadata?.shell) return src as Mesh;
    let s = this.copies.get(src);
    if (!s) {
      const p = src.getVerticesData(VertexBuffer.PositionKind), i = src.getIndices();
      if (!p || !i) return null;
      // (chi ha le ossa: figlia della mesh vera, così ne segue il posto; le altre: sorella, con la stessa posa)
      s = this.shell(src.name + "_contorno", p, i, src.skeleton ? src : src.parent, src.skeleton ? src : undefined);
      if (!src.skeleton) { s.position.copyFrom(src.position); s.rotation.copyFrom(src.rotation); s.scaling.copyFrom(src.scaling); }
      this.copies.set(src, s);
    }
    return s;
  }

  /** Una volta per fotogramma: quali cose hanno il contorno, e quale è quella a cui si rivolge il tasto. */
  show(list: { meshes: AbstractMesh[]; strong: boolean }[], dt: number): void {
    this.t += dt;
    const now = new Set<Mesh>();
    for (const { meshes, strong } of list) for (const m of meshes) {
      const s = this.of(m);
      if (!s) continue;
      now.add(s);
      s.material = strong ? this.strong : this.weak;
      if (!this.fade.has(s)) this.fade.set(s, 0);
    }
    // compaiono e scompaiono in un attimo (la copia è più o meno chiara nella maschera: è la sua `visibility`)
    for (const [s, f] of this.fade) {
      const v = Math.max(0, Math.min(1, f + (now.has(s) ? dt : -dt) / FADE));
      if (v <= 0 && !now.has(s)) this.fade.delete(s); else { this.fade.set(s, v); s.visibility = v; }
    }
    this.mask.renderList = [...this.fade.keys()];
    const at = this.scene.customRenderTargets.indexOf(this.mask);
    if (this.fade.size && at < 0) this.scene.customRenderTargets.push(this.mask); else if (!this.fade.size && at >= 0) this.scene.customRenderTargets.splice(at, 1);
  }
}
