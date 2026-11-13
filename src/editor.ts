import {
  Color3, GizmoManager, Mesh, MeshBuilder, PointerEventTypes, Quaternion, StandardMaterial, TransformNode, Vector3,
  type AbstractMesh, type FreeCamera, type RenderTargetTexture, type Scene,
} from "@babylonjs/core";
import { INTERIORS, PREFABS, SPANS, type PrefabId } from "./data/db";
import { TOWN } from "./world/terrain";
import type { Town } from "./world/town";
import { propCopies } from "./world/props";
import type { ChildDef } from "./data/db";
import { createDraw, LAYERS, type DrawDoc, type Layer } from "./editorDraw";
import { createSculpt } from "./editorTerrain";
import { createNpcs, type RawNpc } from "./editorNpcs";
import type { GroundMesh } from "@babylonjs/core";

/** I due livelli della fase 4: gli abitanti (editorNpcs.ts) e il terreno (editorTerrain.ts). */
const TOOLS = ["abitanti", "terreno"] as const;
type Tool = (typeof TOOLS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// EDITOR DELLA MAPPA (fase 1: docs/editor.md) — una modalità del gioco (`?editor`, solo in sviluppo) per disporre la città
// guardandola. Non tocca geometria: modifica gli elementi del file (il blocco `children` della città, letto GREZZO, così si
// riscrive come stava) e li salva tramite il server di sviluppo (vite.config.mjs), che controlla e ripristina se serve; poi
// la pagina si ricarica e il gioco ricostruisce dal file.
// In modalità editor la città costruisce ogni elemento nelle sue mesh (town.ts, `editor.parts`): qui ognuno si appende a un
// perno, e spostarlo o ruotarlo è muovere il perno. Ciò che non è uno spostamento (tipo, misura, scala…) si vede solo
// salvando; gli oggetti tesi (festoni, panni) invece si ricostruiscono subito, anche mentre se ne trascina un capo.
// ─────────────────────────────────────────────────────────────────────────────

type V3 = [number, number, number];
/** Un elemento del file com'è scritto (i campi sono quelli di `ChildDef`, ma gli oggetti tesi non hanno `at`). */
interface Raw { id?: string; prefab: PrefabId; at?: [number, number]; yaw?: number; size?: [number, number]; scale?: number; tint?: string; interior?: string; seed?: number; variant?: number; from?: V3; to?: V3 }
interface Item { uid: number; raw: Raw }
/** Ciò che si vede di un elemento: le sue mesh appese a un perno. `at0`/`yaw0` = dove stava quando le mesh sono state fatte. */
interface Part { meshes: AbstractMesh[]; pivot: TransformNode; at0: [number, number]; yaw0: number; sig: string; ghost: boolean; own: boolean;
  /** Con quale forma è stato costruito (`shapeOf`): se l'elemento cambia forma, si ricostruisce. */
  shape: string }

const KEY = "sidequest.editor", rad = (d: number): number => d * Math.PI / 180, deg = (r: number): number => r * 180 / Math.PI;
const isSpan = (r: Raw): boolean => SPANS.includes(r.prefab);
/** Centro e verso di un elemento: per i tesi dai due capi (come li ricava il lettore del file, db.ts). */
function placeOf(r: Raw): { at: [number, number]; yaw: number } {
  if (!isSpan(r)) return { at: r.at!, yaw: r.yaw ?? 0 };
  const [a, b] = [r.from!, r.to!];
  return { at: [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2], yaw: deg(Math.atan2(-(b[2] - a[2]), b[0] - a[0])) };
}
/** Ruota (x, z) di `t` radianti come fa Babylon attorno alla verticale. */
const turn = (x: number, z: number, t: number): [number, number] => [x * Math.cos(t) + z * Math.sin(t), -x * Math.sin(t) + z * Math.cos(t)];
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Ciò che cambia la forma (non la posizione): se è diverso da com'era al caricamento, si vedrà salvando. */
/** Ciò che obbliga a ricostruire un teso. */
const sigOf = (r: Raw): string => JSON.stringify([r.prefab, r.from, r.to]);
const shapeOf = (r: Raw): string => JSON.stringify([r.prefab, r.size, r.scale, r.tint, r.interior, r.seed, r.variant]);

export interface EditorCtx { scene: Scene; cam: FreeCamera; town: Town; locationId: string; ground: (x: number, z: number) => number; shadowMap: RenderTargetTexture; pickables: AbstractMesh[]; terrain: AbstractMesh;
  /** Le copie da modello (botti, casse, merce), una mesh ciascuna, segnate con l'elemento che le ha volute (`metadata.owner`). */
  props: AbstractMesh[] }

export async function startEditor(ctx: EditorCtx): Promise<{ update(dt: number): void }> {
  const { scene, cam, town } = ctx, parts = town.editor!.parts;
  // il file grezzo: gli elementi come sono scritti, nello stesso ordine di quelli costruiti
  const db = await (await fetch(`${import.meta.env.BASE_URL}data/db.json`, { cache: "no-cache" })).json();
  const place = db.locations.find((l: { id: string }) => l.id === ctx.locationId), rawList: Raw[] = place.children;
  // ciò che si disegna (fase 2: editorDraw.ts): tracciati, posti, verde, selciati della città; le strade del mondo
  let doc: DrawDoc = structuredClone({ walks: place.walks ?? [], spots: place.spots ?? {}, green: place.green ?? [], paving: place.paving ?? [], roads: db.roads ?? [] });
  /** Chi nomina un posto: abitanti, forzieri, luoghi (il loro `arrive`), missioni. */
  const uses = (spot: string): string[] => {
    const say = `"${spot}"`, out: string[] = [];
    for (const n of db.npcs ?? []) if (JSON.stringify(n.routine ?? []).includes(say)) out.push(n.name ?? n.id);
    for (const c of db.containers ?? []) if (c.at === spot) out.push(`forziere ${c.id}`);
    for (const l of db.locations ?? []) if (l.arrive === spot) out.push(`luogo ${l.id}`);
    for (const q of db.quests ?? []) if (JSON.stringify(q).includes(say)) out.push(`missione ${q.id}`);
    return out;
  };
  let items: Item[] = rawList.map((raw, uid) => ({ uid, raw: structuredClone(raw) }));
  // gli abitanti come sono scritti (fase 4); si riscrivono salvando solo se sono cambiati
  let npcs: RawNpc[] = structuredClone(db.npcs ?? []);
  const npcs0 = JSON.stringify(npcs);
  let nextUid = items.length;
  const P = new Map<number, Part>();

  // ── i perni: ogni elemento costruito appeso al suo, coi suoi interni ──
  /**
   * Appende delle mesh al perno di un elemento. Il perno, a riposo, sta in P0 (dove l'elemento era quando le mesh sono state
   * fatte) senza rotazione: ogni mesh tiene la sua trasformazione, solo spostata di −P0. Vale anche per chi arriva dopo (le
   * copie da modello, che si caricano mentre il perno magari è già stato spostato).
   */
  const hook = (part: Part, uid: number, meshes: AbstractMesh[]): void => {
    const P0 = new Vector3(TOWN.x + part.at0[0], TOWN.y, TOWN.z + part.at0[1]);
    for (const m of meshes) {
      m.unfreezeWorldMatrix();
      m.parent = part.pivot; m.position.subtractInPlace(P0);
      m.isPickable = true; m.metadata = { ...m.metadata, edit: uid };
      if (part.own && !m.metadata.interior) ctx.shadowMap.renderList?.push(m);   // (le mesh nuove fanno ombra al sole come le altre)
    }
    part.meshes.push(...meshes);
  };
  const hang = (uid: number, meshes: AbstractMesh[], at0: [number, number], yaw0: number, sig: string, ghost = false, own = false, shape = ""): Part => {
    const pivot = new TransformNode(`perno${uid}`, scene);
    pivot.position.set(TOWN.x + at0[0], TOWN.y, TOWN.z + at0[1]); pivot.rotationQuaternion = Quaternion.Identity();
    const part: Part = { meshes: [], pivot, at0, yaw0, sig, ghost, own, shape };
    hook(part, uid, meshes);
    P.set(uid, part);
    return part;
  };
  const props = new Map<number, AbstractMesh[]>();
  for (const m of ctx.props) { const o = m.metadata?.owner as number | undefined; if (o !== undefined && o >= 0) (props.get(o) ?? props.set(o, []).get(o)!).push(m); }
  items.forEach((it) => {
    const p = placeOf(it.raw), inside = it.raw.id ? town.interiors.find((i) => i.id === it.raw.id)?.meshes ?? [] : [];
    for (const m of inside) m.metadata = { ...m.metadata, interior: true };   // (l'interno si sposta con l'edificio, ma non si contorna né si copia)
    hang(it.uid, [...parts[it.uid], ...(props.get(it.uid) ?? []), ...inside], p.at, p.yaw, sigOf(it.raw), false, false, shapeOf(it.raw));
  });
  /** Dove finiscono gli interni di un edificio ricostruito: spenti fino al salvataggio (la pianta potrebbe non entrarci più). */
  const parked = new TransformNode("editor_interni_da_rifare", scene);
  parked.setEnabled(false);
  for (const m of ctx.pickables) m.isPickable = true;   // (i capi dei tesi si agganciano a muri e terreno)

  // ── materiali dell'editor ──
  const mat = (name: string, c: Color3, alpha = 1): StandardMaterial => {
    const m = new StandardMaterial(name, scene);
    m.disableLighting = true; m.emissiveColor = c; m.alpha = alpha; m.backFaceCulling = false;
    return m;
  };
  const ghostMat = mat("editor_segnaposto", new Color3(0.9, 0.6, 0.2), 0.35), handleMat = mat("editor_capo", new Color3(1, 0.55, 0.15));
  handleMat.disableDepthWrite = true;

  /** Un elemento così come la città lo costruirebbe (`Town.editor.build`), e le sue copie da modello quando sono caricate. */
  const rebuild = (it: Item, old?: Part): Part => {
    if (old) {   // via le mesh di prima (gli interni si mettono da parte), via il perno
      for (const m of old.meshes) if (m.metadata?.interior) m.parent = parked; else m.dispose();
      old.pivot.dispose();
    }
    const p = placeOf(it.raw), def = { ...it.raw, at: p.at, yaw: p.yaw, scale: it.raw.scale ?? 1 } as ChildDef;
    let built: ReturnType<NonNullable<Town["editor"]>["build"]>;
    try { built = town.editor!.build(def, it.uid); } catch (e) { message = `✗ ${it.raw.prefab}: non si costruisce (${(e as Error).message})`; return ghostFor(it); }
    const part = hang(it.uid, built.meshes, p.at, p.yaw, "", false, true, shapeOf(it.raw));
    if (built.props.length) void propCopies(scene, built.props).then((ms) => { if (P.get(it.uid) === part) hook(part, it.uid, ms); else for (const m of ms) m.dispose(); });
    return part;
  };
  /** Un segnaposto, se un elemento non si lascia costruire (manca una misura, per esempio). */
  const ghostFor = (it: Item): Part => {
    const p = placeOf(it.raw), [w, d] = it.raw.size ?? [1.6, 1.6], k = it.raw.scale ?? 1;
    const box = MeshBuilder.CreateBox(`segnaposto${it.uid}`, { width: w * k, depth: d * k, height: 3 * k }, scene);
    box.material = ghostMat;
    box.position.set(TOWN.x + p.at[0], TOWN.y + 1.5 * k, TOWN.z + p.at[1]); box.rotation.y = rad(p.yaw);
    box.bakeCurrentTransformIntoVertices();
    return hang(it.uid, [box], p.at, p.yaw, "", true, true, shapeOf(it.raw));
  };

  /** Mette ciò che si vede d'accordo con gli elementi: presenti o no, dove, come girati; i tesi si ricostruiscono se i capi sono cambiati. */
  const sync = (): void => {
    const alive = new Set(items.map((it) => it.uid));
    for (const [uid, part] of P) part.pivot.setEnabled(alive.has(uid));
    for (const it of items) {
      let part = P.get(it.uid);
      if (isSpan(it.raw)) {
        const sig = sigOf(it.raw);
        if (!part || part.sig !== sig || part.ghost) {
          if (part) { for (const m of part.meshes) if (part.own || !m.metadata?.interior) m.dispose(); part.pivot.dispose(); }
          const p = placeOf(it.raw);
          part = hang(it.uid, town.editor!.span(it.raw as never), p.at, p.yaw, sig, false, true);
        }
      } else if (!part || part.shape !== shapeOf(it.raw)) part = rebuild(it, part);   // (nuovo, o cambiato di forma: si costruisce subito)
      const p = placeOf(it.raw);
      part.pivot.setEnabled(true);
      part.pivot.position.set(TOWN.x + p.at[0], TOWN.y, TOWN.z + p.at[1]);
      part.pivot.rotationQuaternion = Quaternion.RotationYawPitchRoll(rad(p.yaw - part.yaw0), 0, 0);
    }
    ctx.shadowMap.resetRefreshCounter();
    outline(sel, true);   // (un teso ricostruito ha mesh nuove)
    showHandles();
    panel();
  };

  // ── annulla e ripeti ──
  const undo: string[] = [], redo: string[] = [];
  const snap = (): string => JSON.stringify({ items, sel, doc, npcs });
  const commit = (): void => { undo.push(last); if (undo.length > 200) undo.shift(); redo.length = 0; last = snap(); dirty = true; };
  const restore = (s: string): void => { const o = JSON.parse(s); items = o.items; doc = o.doc; npcs = o.npcs; select(o.sel); last = s; sync(); draw.reset(); if (tool === "abitanti") people.draw(); panel(); };
  let last = "", dirty = false;

  // ── selezione e manipolatori ──
  let sel: number | null = null;
  const gizmos = new GizmoManager(scene);
  gizmos.usePointerToAttachGizmos = false;
  gizmos.positionGizmoEnabled = true; gizmos.rotationGizmoEnabled = true;
  const pos = gizmos.gizmos.positionGizmo!, rot = gizmos.gizmos.rotationGizmo!;
  pos.yGizmo.isEnabled = false; pos.snapDistance = 0.25; pos.updateGizmoRotationToMatchAttachedMesh = false; pos.scaleRatio = 1.4;
  rot.xGizmo.isEnabled = false; rot.zGizmo.isEnabled = false; rot.snapDistance = Math.PI / 12; rot.updateGizmoRotationToMatchAttachedMesh = false; rot.scaleRatio = 1.4;
  let mode: "move" | "turn" = "move";
  const setMode = (m: typeof mode): void => { mode = m; gizmos.positionGizmoEnabled = m === "move"; gizmos.rotationGizmoEnabled = m === "turn"; attach(); };
  const attach = (): void => { gizmos.attachToNode(sel !== null ? P.get(sel)?.pivot ?? null : null); };
  /** Dopo un trascinamento: la nuova posizione del perno torna nell'elemento. */
  const fromPivot = (): void => {
    const it = items.find((i) => i.uid === sel), part = sel !== null ? P.get(sel) : undefined;
    if (!it || !part) return;
    const x = r3(part.pivot.position.x - TOWN.x), z = r3(part.pivot.position.z - TOWN.z), dy = part.pivot.rotationQuaternion!.toEulerAngles().y;
    if (isSpan(it.raw)) {   // un teso si sposta coi suoi capi
      const old = placeOf(it.raw), t = rad(old.yaw - part.yaw0), move = (c: V3): V3 => {
        const [ox, oz] = turn(c[0] - old.at[0], c[2] - old.at[1], dy - t);
        return [r3(x + ox), c[1], r3(z + oz)];
      };
      it.raw.from = move(it.raw.from!); it.raw.to = move(it.raw.to!);
    } else { it.raw.at = [x, z]; it.raw.yaw = r3(((part.yaw0 + deg(dy)) % 360 + 540) % 360 - 180); }
    commit(); sync();
  };
  pos.onDragEndObservable.add(fromPivot); rot.onDragEndObservable.add(fromPivot);

  const outline = (uid: number | null, on: boolean): void => { const p = uid !== null ? P.get(uid) : undefined; for (const m of p?.meshes ?? []) if (!m.metadata?.interior) m.showBoundingBox = on; };
  const select = (uid: number | null): void => { outline(sel, false); sel = uid; outline(sel, true); attach(); showHandles(); panel(); };

  // ── i capi dei tesi: maniglie che si agganciano alla superficie sotto il puntatore ──
  const handles = [0, 1].map((i) => {
    const h = MeshBuilder.CreateSphere(`editor_capo${i}`, { diameter: 0.35, segments: 8 }, scene);
    h.material = handleMat; h.renderingGroupId = 2; h.isPickable = true; h.metadata = { handle: i }; h.setEnabled(false);
    return h;
  });
  function showHandles(): void {
    const it = items.find((i) => i.uid === sel);
    const on = !!it && isSpan(it.raw);
    handles.forEach((h, i) => {
      h.setEnabled(on);
      if (on) { const c = i ? it!.raw.to! : it!.raw.from!; h.position.set(TOWN.x + c[0], TOWN.y + c[1], TOWN.z + c[2]); }
    });
  }
  let dragging = -1;

  // ── il puntatore ──
  const pickable = (m: AbstractMesh): boolean => m.isPickable && m.isEnabled() && m.isVisible && m.metadata?.handle === undefined;
  // i livelli da disegnare (fase 2)
  // i selciati si rifanno dal vivo (le loro mesh di partenza, poi quelle rifatte)
  let paving: AbstractMesh[] = town.editor!.pavingMeshes, paved = "";
  const repave = (): void => {
    const sig = JSON.stringify(doc.paving);
    if (sig === paved) return;
    paved = sig;
    for (const m of paving) m.dispose();
    paving = town.editor!.paving(doc.paving as never);
    for (const m of paving) ctx.shadowMap.renderList?.push(m);
  };
  paved = JSON.stringify(doc.paving);
  const draw = createDraw({ scene, cam, town, ground: ctx.ground, terrain: ctx.terrain, doc: () => doc, commit: () => { commit(); panel(); }, changed: () => panel(), uses, paved: repave });
  // fase 4: gli abitanti e il terreno
  let tool: Tool | null = null;
  const sculpt = createSculpt({ scene, terrain: ctx.terrain as GroundMesh, changed: () => panel(), shadows: () => ctx.shadowMap.resetRefreshCounter() });
  const people = createNpcs({ scene, cam, town, ground: ctx.ground, list: () => npcs, commit: () => commit(), redraw: () => { people.draw(); panel(); },
    go: (x, z) => { const y = ctx.ground(x, z); cam.position.set(x - 10, y + 9, z - 10); yaw = Math.atan2(10, 10); pitch = Math.atan2(9, Math.hypot(10, 10)); } });
  const setLayer = (l: Layer | Tool | null): void => {
    select(null);
    tool = (TOOLS as readonly string[]).includes(l ?? "") ? l as Tool : null;
    draw.setLayer(tool ? null : l as Layer | null);
    if (tool !== "terreno") sculpt.off();
    if (tool === "abitanti") people.draw(); else people.hide();
    panel();
  };
  scene.onPointerObservable.add((pi) => {
    if (tool === "terreno") { sculpt.pointer(pi); return; }
    if (tool === "abitanti") { people.pointer(pi); return; }
    if (draw.layer) { draw.pointer(pi); return; }
    const e = pi.event as PointerEvent;
    if (pi.type === PointerEventTypes.POINTERDOWN && e.button === 0) {
      const h = scene.pick(scene.pointerX, scene.pointerY, (m) => m.metadata?.handle !== undefined && m.isEnabled());
      if (h?.hit) { dragging = h.pickedMesh!.metadata.handle; return; }
    }
    if (pi.type === PointerEventTypes.POINTERMOVE && dragging >= 0) {
      const it = items.find((i) => i.uid === sel)!, own = P.get(sel!)?.meshes ?? [];
      const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => pickable(m) && !own.includes(m));
      if (hit?.hit && hit.pickedPoint) {
        const n = hit.getNormal(true) ?? Vector3.Up(), p = hit.pickedPoint.add(n.scale(0.05));
        const c: V3 = [r3(p.x - TOWN.x), r3(p.y - TOWN.y), r3(p.z - TOWN.z)];
        if (dragging) it.raw.to = c; else it.raw.from = c;
        const [a, b] = [it.raw.from!, it.raw.to!];
        if (Math.hypot(b[0] - a[0], b[2] - a[2]) >= 0.5) sync();
      }
      return;
    }
    if (pi.type === PointerEventTypes.POINTERUP && dragging >= 0) { dragging = -1; commit(); return; }
    if (pi.type === PointerEventTypes.POINTERTAP && e.button === 0) {
      const hit = scene.pick(scene.pointerX, scene.pointerY, (m) => pickable(m) && m.metadata?.edit !== undefined);
      select(hit?.hit ? hit.pickedMesh!.metadata.edit : null);
    }
  });

  // ── la camera libera: tasto destro e mouse per guardare, WASD per muoversi, R/F su e giù, Shift veloce ──
  const keys = new Set<string>();
  let yaw = cam.rotation.y, pitch = cam.rotation.x, look = false, speed = 12;
  const typing = (e: Event): boolean => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
  const canvas = scene.getEngine().getRenderingCanvas()!;
  canvas.addEventListener("pointerdown", (e) => { if (e.button === 2) look = true; });
  addEventListener("pointerup", (e) => { if (e.button === 2) look = false; });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // (pointermove, non mousemove: Babylon fa preventDefault sul pointerdown e il browser non manda più i mouse event;
  // e il tasto destro si legge da `buttons`, perché premuto mentre un altro è già giù non dà pointerdown né pointerup)
  addEventListener("pointermove", (e) => { if (!look) return; if (!(e.buttons & 2)) { look = false; return; } yaw += e.movementX * 0.003; pitch = Math.max(-1.5, Math.min(1.5, pitch + e.movementY * 0.003)); });
  canvas.addEventListener("wheel", (e) => { speed = Math.max(2, Math.min(80, speed * (e.deltaY > 0 ? 0.85 : 1.18))); e.preventDefault(); }, { passive: false });
  addEventListener("keydown", (e) => {
    if (typing(e)) return;
    keys.add(e.code);
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.code === "KeyZ") { e.preventDefault(); back(); }
    else if (ctrl && (e.code === "KeyY" || (e.shiftKey && e.code === "KeyZ"))) { e.preventDefault(); again(); }
    else if (ctrl && e.code === "KeyD") { e.preventDefault(); duplicate(); }
    else if (ctrl && e.code === "KeyS") { e.preventDefault(); void save(); }
    else if (tool) { if (tool === "abitanti" && people.key(e)) e.preventDefault(); }
    else if (draw.layer) { if (draw.key(e)) e.preventDefault(); }
    else if (e.code === "Delete") remove();
    else if (e.code === "Escape") select(null);
    else if (e.code === "Digit1") setMode("move");
    else if (e.code === "Digit2") setMode("turn");
  });
  addEventListener("keyup", (e) => keys.delete(e.code));
  /** Annulla e ripeti: sul terreno i suoi passi (una pennellata ciascuno), altrove quelli del file. */
  function back(): void { if (tool === "terreno") sculpt.undo(); else if (undo.length) { redo.push(last); restore(undo.pop()!); } }
  function again(): void { if (tool === "terreno") sculpt.redo(); else if (redo.length) { undo.push(last); restore(redo.pop()!); } }
  addEventListener("blur", () => { keys.clear(); look = false; });

  // ── nuovo, duplica, elimina ──
  /** Il punto della città che si sta guardando (al centro dello schermo), in coordinate della città. */
  const aim = (): [number, number] => {
    const hit = scene.pick(scene.getEngine().getRenderWidth() / 2, scene.getEngine().getRenderHeight() / 2, pickable);
    const p = hit?.pickedPoint ?? cam.position.add(cam.getDirection(Vector3.Forward()).scale(10));
    return [r3(Math.round((p.x - TOWN.x) * 4) / 4), r3(Math.round((p.z - TOWN.z) * 4) / 4)];
  };
  const add = (prefab: PrefabId): void => {
    const [x, z] = aim(), variant = Math.floor(Math.random() * 1e6), raw: Raw = { prefab };
    if (SPANS.includes(prefab)) {
      const [dx, dz] = [Math.cos(yaw), -Math.sin(yaw)], h = prefab === "festone" ? 5.3 : 3.3;
      raw.from = [r3(x - dx * 3), h, r3(z - dz * 3)]; raw.to = [r3(x + dx * 3), h, r3(z + dz * 3)];
    } else { raw.at = [x, z]; raw.yaw = 0; if (prefab.startsWith("casa.") || prefab === "cassa") raw.size = prefab === "cassa" ? [0.8, 0.8] : [6.4, 7]; }
    raw.variant = variant;
    const it = { uid: nextUid++, raw };
    items.push(it);
    sel = it.uid; commit(); sync(); select(it.uid);
  };
  function duplicate(): void {
    const src = items.find((i) => i.uid === sel);
    if (!src) return;
    const raw: Raw = structuredClone(src.raw), uid = nextUid++, step = 2;
    if (raw.id) { let n = 2; while (items.some((i) => i.raw.id === `${src.raw.id}_${n}`)) n++; raw.id = `${src.raw.id}_${n}`; }
    if (isSpan(raw)) { raw.from = [r3(raw.from![0] + step), raw.from![1], r3(raw.from![2] + step)]; raw.to = [r3(raw.to![0] + step), raw.to![1], r3(raw.to![2] + step)]; }
    else {
      raw.at = [r3(raw.at![0] + step), r3(raw.at![1] + step)];   // (lo costruisce `sync`, come un elemento nuovo)
    }
    const it = { uid, raw };
    items.splice(items.indexOf(src) + 1, 0, it);
    commit(); sync(); select(uid);
  }
  function remove(): void {
    if (sel === null) return;
    items = items.filter((i) => i.uid !== sel);
    commit(); select(null); sync();
  }

  // ── il pannello ──
  const css = document.createElement("style");
  css.textContent = `
    body.editing > :not(canvas):not(#editor) { display: none !important; }
    #editor { position: fixed; top: 10px; right: 10px; width: 340px; max-height: calc(100vh - 20px); overflow: auto; z-index: 50;
      background: rgba(18, 16, 14, 0.9); color: #e6dcc6; font: 12px/1.4 system-ui, sans-serif; border: 1px solid #5a4c38; border-radius: 6px; padding: 10px; }
    #editor h3 { margin: 0 0 6px; font-size: 13px; color: #f0c070; } #editor label { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
    #editor label > span { width: 82px; color: #b9ad94; } #editor input, #editor select { flex: 1; min-width: 0; background: #2a251f; color: #f2e8d2; border: 1px solid #5a4c38; border-radius: 3px; padding: 2px 4px; font: inherit; }
    #editor .row { display: flex; gap: 4px; flex-wrap: wrap; margin: 6px 0; } #editor button { background: #3b3226; color: #f2e8d2; border: 1px solid #6d5a40; border-radius: 3px; padding: 3px 7px; cursor: pointer; font: inherit; }
    #editor button:hover { background: #4d4130; } #editor .note { color: #f0b060; margin: 4px 0; } #editor .err { color: #ff8a70; white-space: pre-wrap; }
    #editor .hint { color: #8f846f; font-size: 11px; margin-top: 8px; } #editor .on { border-color: #f0c070; }`;
  document.head.appendChild(css);
  document.body.classList.add("editing");
  const box = document.body.appendChild(document.createElement("div"));
  box.id = "editor";
  let message = "";
  const field = (label: string, input: HTMLElement): HTMLLabelElement => { const l = document.createElement("label"); l.innerHTML = `<span>${label}</span>`; l.appendChild(input); return l; };
  /** Dopo una modifica dal pannello: gli elementi si rimettono a posto, o i disegni si ridisegnano. */
  const after = (): void => { if (draw.layer) { draw.touch(); panel(); } else sync(); };
  const num = (v: number | undefined, step: number, set: (n: number) => void): HTMLInputElement => {
    const i = document.createElement("input"); i.type = "number"; i.step = String(step); i.value = v === undefined ? "" : String(v);
    i.onchange = () => { if (i.value !== "" && Number.isFinite(+i.value)) { set(+i.value); commit(); after(); } };
    return i;
  };
  const choice = (opts: readonly string[], v: string | undefined, set: (s: string) => void, blank = false): HTMLSelectElement => {
    const s = document.createElement("select");
    for (const o of [...(blank ? [""] : []), ...opts]) s.add(new Option(o || "—", o, false, o === (v ?? "")));
    s.onchange = () => { set(s.value); commit(); after(); };
    return s;
  };
  function panel(): void {
    box.replaceChildren();
    const h = box.appendChild(document.createElement("h3")); h.textContent = "Editor della mappa";
    // i livelli: gli elementi (fase 1) e ciò che si disegna (fase 2)
    const tabs = box.appendChild(document.createElement("div")); tabs.className = "row";
    for (const l of ["elementi", ...LAYERS, ...TOOLS] as const) {
      const b = tabs.appendChild(document.createElement("button")); b.textContent = l; if ((tool ?? draw.layer ?? "elementi") === l) b.className = "on";
      b.onclick = () => setLayer(l === "elementi" ? null : l);
    }
    const it = items.find((i) => i.uid === sel);
    if (tool === "terreno") sculpt.panel(box, field);
    else if (tool === "abitanti") people.panel(box, field);
    else if (draw.layer) draw.panel(box, num, field, (o, v, set) => choice(o, v, set));
    else if (it) {
      const r = it.raw;
      box.append(field("tipo", choice(PREFABS, r.prefab, (v) => {
        r.prefab = v as PrefabId;
        if (isSpan(r) && !r.from) { const p = placeOf({ ...r, prefab: "pozzo" }); r.from = [p.at[0] - 3, 4, p.at[1]]; r.to = [p.at[0] + 3, 4, p.at[1]]; delete r.at; delete r.yaw; delete r.size; }
        else if (!isSpan(r) && !r.at) { const p = placeOf({ ...r, prefab: "festone" }); r.at = p.at; r.yaw = 0; delete r.from; delete r.to; }
      })));
      const id = document.createElement("input"); id.value = r.id ?? ""; id.placeholder = "(nessuno)";
      id.onchange = () => { if (id.value) r.id = id.value; else delete r.id; commit(); sync(); };
      box.append(field("nome (id)", id));
      if (isSpan(r)) {
        for (const [k, name] of [["from", "da"], ["to", "a"]] as const) for (const [j, ax] of ["x", "quota", "z"].entries())
          box.append(field(`${name} ${ax}`, num(r[k]![j], 0.25, (n) => { r[k]![j] = n; })));
      } else {
        box.append(field("x", num(r.at![0], 0.25, (n) => { r.at![0] = n; })), field("z", num(r.at![1], 0.25, (n) => { r.at![1] = n; })), field("rotazione", num(r.yaw ?? 0, 15, (n) => { r.yaw = n; })));
        box.append(field("larghezza", num(r.size?.[0], 0.25, (n) => { r.size = [n, r.size?.[1] ?? n]; })), field("profondità", num(r.size?.[1], 0.25, (n) => { r.size = [r.size?.[0] ?? n, n]; })));
        box.append(field("scala", num(r.scale, 0.25, (n) => { r.scale = n; })));
      }
      box.append(field("tinta", choice(["vino", "ocra", "muschio"], r.tint, (v) => { if (v) r.tint = v; else delete r.tint; }, true)));
      box.append(field("interno", choice(INTERIORS, r.interior, (v) => { if (v) r.interior = v; else delete r.interior; }, true)));
      const vr = document.createElement("div"); vr.className = "row";
      box.append(field("variante", num(r.variant, 1, (n) => { r.variant = Math.max(0, Math.round(n)); })));
      const again = vr.appendChild(document.createElement("button")); again.textContent = "Nuova variante";
      again.onclick = () => { r.variant = Math.floor(Math.random() * 1e6); commit(); sync(); };
      box.append(vr);
      if (P.get(it.uid)?.ghost) box.append(Object.assign(document.createElement("div"), { className: "err", textContent: "Questo elemento non si lascia costruire così: si vede un segnaposto." }));
      else if (r.interior && P.get(it.uid)?.own) box.append(Object.assign(document.createElement("div"), { className: "note", textContent: "L'interno si vedrà salvando." }));
      const ops = box.appendChild(document.createElement("div")); ops.className = "row";
      for (const [label, f, on] of [["Sposta (1)", () => setMode("move"), mode === "move"], ["Ruota (2)", () => setMode("turn"), mode === "turn"], ["Duplica", duplicate, false], ["Elimina", remove, false]] as const) {
        const b = ops.appendChild(document.createElement("button")); b.textContent = label; b.onclick = f; if (on) b.className = "on";
      }
    } else box.append(Object.assign(document.createElement("div"), { textContent: "Clic su un elemento della città per sceglierlo." }));
    if (!draw.layer && !tool) {
      const nu = box.appendChild(document.createElement("div")); nu.className = "row";
      const kind = choice(PREFABS, "lampione", () => {}); kind.onchange = null;
      const plus = document.createElement("button"); plus.textContent = "Nuovo qui"; plus.onclick = () => add(kind.value as PrefabId);
      nu.append(kind, plus);
    }
    const io = box.appendChild(document.createElement("div")); io.className = "row";
    for (const [label, f] of [["Annulla", back], ["Ripeti", again], ["Salva", () => void save()], ["Esci", leave]] as const) {
      const b = io.appendChild(document.createElement("button")); b.textContent = label; b.onclick = f;
    }
    if (sculpt.dirty) box.append(Object.assign(document.createElement("div"), { className: "note", textContent: "Terreno modificato, non salvato." }));
    if (dirty && undo.length) box.append(Object.assign(document.createElement("div"), { className: "note", textContent: `Modifiche non salvate (${undo.length}).` }));
    if (message) box.append(Object.assign(document.createElement("div"), { className: message.startsWith("✗") ? "err" : "note", textContent: message }));
    box.append(Object.assign(document.createElement("div"), { className: "hint", textContent: "Si aggiornano salvando: interni, luci e lanterne, porte, terreno (strade e verde), la rete degli abitanti nel gioco." }));
    box.append(Object.assign(document.createElement("div"), { className: "hint", innerHTML: "Tasto destro + mouse: guarda · WASD: muovi · R/F: su/giù · Shift: veloce · rotella: velocità<br>Clic: scegli · 1 sposta · 2 ruota · Ctrl+D duplica · Canc elimina · Ctrl+Z/Y · Ctrl+S salva<br>Festoni e panni: trascina un capo sopra un muro per agganciarlo." }));
  }

  // ── salvare e uscire ──
  const remember = (): void => sessionStorage.setItem(KEY, JSON.stringify({ x: cam.position.x, y: cam.position.y, z: cam.position.z, yaw, pitch, sel: sel !== null ? items.findIndex((i) => i.uid === sel) : -1, layer: tool ?? draw.layer }));
  async function save(): Promise<void> {
    message = "Salvo e controllo…"; panel();
    remember();
    // il terreno a parte (un file suo), poi il file dei dati, che controlla e ricarica
    if (sculpt.dirty) {
      const t = await fetch("/__editor/terrain", { method: "POST", body: sculpt.data().buffer as ArrayBuffer });
      if (!t.ok) { message = `✗ Terreno non salvato: ${await t.text()}`; panel(); return; }
    }
    const changed = JSON.stringify(npcs) !== npcs0 ? npcs : undefined;
    const res = await fetch("/__editor/save", { method: "POST", body: JSON.stringify({ location: ctx.locationId, fields: { children: items.map((i) => i.raw), walks: doc.walks, spots: doc.spots, green: doc.green, paving: doc.paving }, roads: doc.roads, npcs: changed }) });
    if (res.ok) { dirty = false; message = "Salvato: ricostruisco…"; panel(); location.reload(); return; }
    message = `✗ Non salvato: il file non passa i controlli.\n${await res.text()}`; panel();
  }
  function leave(): void {
    if ((dirty || sculpt.dirty) && !confirm("Ci sono modifiche non salvate: uscire lo stesso?")) return;
    sessionStorage.removeItem(KEY);
    location.search = "";
  }
  addEventListener("beforeunload", (e) => { if (dirty || sculpt.dirty) e.preventDefault(); });

  // ── si riparte da dove si era ──
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null");
    if (s) { cam.position.set(s.x, s.y, s.z); yaw = s.yaw; pitch = s.pitch; if (s.sel >= 0 && items[s.sel]) sel = items[s.sel].uid; }
    else { cam.position.set(TOWN.x - 20, TOWN.y + 22, TOWN.z - 30); yaw = 0.6; pitch = 0.45; }
  } catch { /* sessionStorage non disponibile */ }
  last = snap();
  select(sel);
  setMode("move");
  try { const l = JSON.parse(sessionStorage.getItem(KEY) ?? "null")?.layer; if (l) setLayer(l); } catch { /* niente */ }
  Object.assign(window, { editor: { items: () => items, doc: () => doc, npcs: () => npcs, sculpt, people, setLayer, parts: P, select, gizmos, look: (x: number, y: number, z: number, tx: number, ty: number, tz: number) => { cam.position.set(x, y, z); yaw = Math.atan2(tx - x, tz - z); pitch = Math.atan2(y - ty, Math.hypot(tx - x, tz - z)); } } });   // (per le prove da console)

  return {
    update(dt) {
      if (tool === "terreno") sculpt.update(dt);
      const k = speed * (keys.has("ShiftLeft") || keys.has("ShiftRight") ? 4 : 1) * dt, f = new Vector3(Math.sin(yaw), 0, Math.cos(yaw)), rt = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      if (keys.has("KeyW")) cam.position.addInPlace(f.scale(k));
      if (keys.has("KeyS")) cam.position.addInPlace(f.scale(-k));
      if (keys.has("KeyD")) cam.position.addInPlace(rt.scale(k));
      if (keys.has("KeyA")) cam.position.addInPlace(rt.scale(-k));
      if (keys.has("KeyR")) cam.position.y += k;
      if (keys.has("KeyF")) cam.position.y -= k;
      cam.position.y = Math.max(cam.position.y, ctx.ground(cam.position.x, cam.position.z) + 0.5);
      cam.rotation.set(pitch, yaw, 0);
    },
  };
}
