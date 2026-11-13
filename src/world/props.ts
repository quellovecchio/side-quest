import "@babylonjs/loaders/glTF";
import { Matrix, Mesh, Quaternion, Scene, SceneLoader, Vector3 } from "@babylonjs/core";

// ─────────────────────────────────────────────────────────────────────────────
// ARREDI DA MODELLO — botti, casse, secchi, ceste… non più forme fatte a codice ma modelli veri:
// scansioni e modelli CC0 di Poly Haven, in `public/models/<id>/` (glTF con texture a 1k, scaricati
// col permesso dell'utente il 12 novembre 2026).
//
// Chi costruisce il mondo dichiara dove ne vuole uno (`prop`); a mondo costruito `placeProps` carica
// i modelli usati e ne mette tutte le copie in scena come istanze sottili: una draw call per
// materiale del modello, quante che siano le copie.
// Nell'editor della mappa ogni copia è invece una mesh a sé (una copia che condivide la geometria), segnata con l'elemento
// del file che l'ha dichiarata (`propOwner`, `metadata.owner`): così si sposta con lui, e un elemento costruito mentre si
// modifica ha le sue (`propCopies`).
// ponytail: prendono il sole come la città; dentro gli edifici vogliono la luce cotta della stanza
// (un passo a parte: lì le copie vanno fuse nelle mesh dell'interno, coi modelli alleggeriti).
// ─────────────────────────────────────────────────────────────────────────────

export type PropId = "wine_barrel_01" | "wooden_crate_01" | "wooden_crate_02" | "wooden_bucket_01" | "wicker_basket_01" | "jug_01" | "wooden_bowl_01" | "brass_pot_01";

/** Una copia da posare: dove poggia (il centro della base), come è girata, e quanto è grande — alta `h` metri, o larga `w` (il lato più lungo in pianta); senza, com'è il modello. `owner` = l'elemento del file che l'ha voluta (-1 nessuno). */
export interface Want { id: PropId; x: number; y: number; z: number; yaw: number; h?: number; w?: number; owner: number }
const WANT: Want[] = [];
let OWNER = -1;

/** Le copie dichiarate d'ora in poi sono dell'elemento `i` del file (-1: di nessuno). */
export function propOwner(i: number): void { OWNER = i; }
export function prop(id: PropId, p: { x: number; y: number; z: number }, yaw = 0, size: { h?: number; w?: number } = {}): void {
  WANT.push({ id, x: p.x, y: p.y, z: p.z, yaw, ...size, owner: OWNER });
}
/** Quante copie sono state dichiarate finora; `takeProps(n)` toglie e restituisce quelle dichiarate dopo. */
export const markProps = (): number => WANT.length;
export const takeProps = (from: number): Want[] => WANT.splice(from);

/** Un modello caricato una volta: le sue mesh (nel riferimento del modello, spente: sono le sorgenti) e il suo ingombro. */
interface Model { meshes: Mesh[]; lo: Vector3; hi: Vector3 }
const MODELS = new Map<PropId, Promise<Model>>();
function model(scene: Scene, id: PropId): Promise<Model> {
  let m = MODELS.get(id);
  if (!m) MODELS.set(id, m = (async () => {
    const c = await SceneLoader.LoadAssetContainerAsync(`${import.meta.env.BASE_URL}models/${id}/`, `${id}.gltf`, scene);
    c.addAllToScene();
    // ogni mesh del modello nel riferimento del modello (compreso il ribaltamento che il caricatore fa per i sistemi destrorsi)
    const meshes = c.meshes.filter((x): x is Mesh => x instanceof Mesh && x.getTotalVertices() > 0);
    const lo = new Vector3(1e9, 1e9, 1e9), hi = new Vector3(-1e9, -1e9, -1e9);
    for (const x of meshes) {
      x.computeWorldMatrix(true); x.setParent(null); x.bakeCurrentTransformIntoVertices(); x.refreshBoundingInfo();
      const b = x.getBoundingInfo().boundingBox;
      lo.minimizeInPlace(b.minimumWorld); hi.maximizeInPlace(b.maximumWorld);
      x.name = `prop_${id}`; x.isPickable = false; x.receiveShadows = true;
    }
    for (const n of [...c.transformNodes, ...c.meshes.filter((x) => !meshes.includes(x as Mesh))]) n.dispose();
    return { meshes, lo, hi };
  })());
  return m;
}
/** Dove va una copia: la matrice che porta il modello (centrato sulla base) al suo posto, alla sua misura. */
function placeOf(md: Model, w: Want): Matrix {
  const { lo, hi } = md, s = w.h ? w.h / (hi.y - lo.y) : w.w ? w.w / Math.max(hi.x - lo.x, hi.z - lo.z) : 1;
  return Matrix.Translation(-(lo.x + hi.x) / 2, -lo.y, -(lo.z + hi.z) / 2).multiply(Matrix.Scaling(s, s, s)).multiply(Matrix.RotationY(w.yaw)).multiply(Matrix.Translation(w.x, w.y, w.z));
}

/** Copie che si spostano da sole (per l'editor): una mesh per copia e per mesh del modello, che condivide la geometria. */
export async function propCopies(scene: Scene, wants: Want[]): Promise<Mesh[]> {
  const out: Mesh[] = [];
  for (const w of wants) {
    const md = await model(scene, w.id), m = placeOf(md, w), s = new Vector3(), q = new Quaternion(), t = new Vector3();
    m.decompose(s, q, t);
    for (const src of md.meshes) {
      src.setEnabled(false);
      const c = src.clone(`prop_${w.id}`, null, true)!;
      c.setEnabled(true); c.position.copyFrom(t); c.rotationQuaternion = q.clone(); c.scaling.copyFrom(s);
      c.metadata = { ...c.metadata, owner: w.owner };
      out.push(c);
    }
  }
  return out;
}

/** Carica i modelli dichiarati e ne posa le copie. Restituisce le mesh (fanno ombra come la città). `editor`: una mesh per copia. */
export async function placeProps(scene: Scene, editor = false): Promise<Mesh[]> {
  if (editor) return propCopies(scene, WANT);
  const out: Mesh[] = [];
  await Promise.all([...new Set(WANT.map((w) => w.id))].map(async (id) => {
    const md = await model(scene, id), wants = WANT.filter((w) => w.id === id), buf = new Float32Array(wants.length * 16);
    wants.forEach((w, i) => placeOf(md, w).copyToArray(buf, i * 16));
    for (const x of md.meshes) {
      x.alwaysSelectAsActiveMesh = true;
      x.thinInstanceSetBuffer("matrix", buf, 16, true);
      out.push(x);
    }
  }));
  return out;
}
