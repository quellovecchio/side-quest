import { Color3, MeshBuilder, PointerEventTypes, Vector3, VertexBuffer, type GroundMesh, type LinesMesh, type PointerInfo, type Scene } from "@babylonjs/core";
import { EAST, HALF, LIFT } from "./world/terrain";

// ─────────────────────────────────────────────────────────────────────────────
// EDITOR DELLA MAPPA, il terreno (fase 4: docs/editor.md) — scolpire con un pennello: alza, abbassa, spiana, leviga.
// Non tocca il rilievo generato: scrive lo strato di modifiche (`LIFT` in terrain.ts, centimetri per vertice), che si salva a
// parte in `public/data/terreno.bin`. Mentre si dipinge cambia solo la mesh del terreno; rocce, piante, città e strade si
// posano sul terreno nuovo al salvataggio, che ricostruisce tutto.
// ─────────────────────────────────────────────────────────────────────────────

export const BRUSHES = ["alza", "abbassa", "spiana", "leviga"] as const;
type Brush = (typeof BRUSHES)[number];

export interface SculptCtx { scene: Scene; terrain: GroundMesh; changed(): void; shadows(): void }

export function createSculpt(ctx: SculptCtx) {
  const { scene, terrain: mesh } = ctx, { w, h } = LIFT;
  const pos = Float32Array.from(mesh.getVerticesData(VertexBuffer.PositionKind)!), nor = Float32Array.from(mesh.getVerticesData(VertexBuffer.NormalKind)!);
  // quale vertice della mesh sta su ogni punto della griglia, e la sua quota senza modifiche
  const vtx = new Int32Array(w * h).fill(-1), base = new Float32Array(pos.length / 3);
  for (let v = 0; v < base.length; v++) {
    const i = Math.round(pos[v * 3] + EAST / 2 + HALF), j = Math.round(pos[v * 3 + 2] + HALF);
    vtx[j * w + i] = v; base[v] = pos[v * 3 + 1] - LIFT.d[j * w + i] / 100;
  }
  // lo strato al lavoro in centimetri non arrotondati (un pennello leggero sposta meno di un centimetro a fotogramma)
  const cm = Float32Array.from(LIFT.d);
  const H = (i: number, j: number): number => pos[vtx[Math.min(Math.max(j, 0), h - 1) * w + Math.min(Math.max(i, 0), w - 1)] * 3 + 1];
  /** La quota (con le modifiche in corso) in un punto del mondo. */
  const height = (x: number, z: number): number => {
    const fx = Math.min(Math.max(x + HALF, 0), w - 1.001), fz = Math.min(Math.max(z + HALF, 0), h - 1.001), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, t = fz - j;
    return (H(i, j) * (1 - u) + H(i + 1, j) * u) * (1 - t) + (H(i, j + 1) * (1 - u) + H(i + 1, j + 1) * u) * t;
  };
  /** Rimette quote e normali della mesh nel riquadro di griglia dato. */
  const refresh = (i0: number, j0: number, i1: number, j1: number): void => {
    i0 = Math.max(i0, 0); j0 = Math.max(j0, 0); i1 = Math.min(i1, w - 1); j1 = Math.min(j1, h - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const v = vtx[j * w + i]; pos[v * 3 + 1] = base[v] + cm[j * w + i] / 100; }
    for (let j = Math.max(j0 - 1, 0); j <= Math.min(j1 + 1, h - 1); j++) for (let i = Math.max(i0 - 1, 0); i <= Math.min(i1 + 1, w - 1); i++) {
      const v = vtx[j * w + i], n = new Vector3(-(H(i + 1, j) - H(i - 1, j)) / 2, 1, -(H(i, j + 1) - H(i, j - 1)) / 2).normalize();
      nor[v * 3] = n.x; nor[v * 3 + 1] = n.y; nor[v * 3 + 2] = n.z;
    }
    mesh.updateVerticesData(VertexBuffer.PositionKind, pos); mesh.updateVerticesData(VertexBuffer.NormalKind, nor);
  };

  // ── il pennello ──
  let brush: Brush = "alza", radius = 6, strength = 1, dirty = false;
  let at: Vector3 | null = null, painting = false, level = 0;
  const ring: LinesMesh = MeshBuilder.CreateLines("editor_pennello", { points: Array.from({ length: 49 }, () => Vector3.Zero()), updatable: true }, scene);
  ring.color = new Color3(2.5, 1.6, 0.4); ring.renderingGroupId = 2; ring.isPickable = false; ring.setEnabled(false);
  /** Dove il raggio dal puntatore incontra il terreno: a passi di mezzo metro, poi per bisezione. */
  const aim = (): Vector3 | null => {
    const r = scene.createPickingRay(scene.pointerX, scene.pointerY, null, scene.activeCamera);
    let a = 0;
    for (let t = 0.5; t < 600; t += 0.5) {
      const p = r.origin.add(r.direction.scale(t));
      if (p.y < height(p.x, p.z)) {
        let b = t;
        for (let k = 0; k < 12; k++) { const m = (a + b) / 2, q = r.origin.add(r.direction.scale(m)); if (q.y < height(q.x, q.z)) b = m; else a = m; }
        return r.origin.add(r.direction.scale(b));
      }
      a = t;
    }
    return null;
  };
  const showRing = (): void => {
    ring.setEnabled(!!at);
    if (!at) return;
    const pts = Array.from({ length: 49 }, (_, k) => { const t = k / 48 * Math.PI * 2, x = at!.x + Math.cos(t) * radius, z = at!.z + Math.sin(t) * radius; return new Vector3(x, height(x, z) + 0.15, z); });
    MeshBuilder.CreateLines("editor_pennello", { points: pts, instance: ring });
  };
  const stroke = (dt: number): void => {
    const p = at!, i0 = Math.floor(p.x + HALF - radius), i1 = Math.ceil(p.x + HALF + radius), j0 = Math.floor(p.z + HALF - radius), j1 = Math.ceil(p.z + HALF + radius);
    for (let j = Math.max(j0, 1); j <= Math.min(j1, h - 2); j++) for (let i = Math.max(i0, 1); i <= Math.min(i1, w - 2); i++) {
      const d = Math.hypot(i - HALF - p.x, j - HALF - p.z) / radius;
      if (d >= 1) continue;
      const f = (1 - d * d) ** 2, k = j * w + i, now = H(i, j);
      let to = now;
      if (brush === "alza") to = now + strength * dt * f;
      else if (brush === "abbassa") to = now - strength * dt * f;
      else {
        const goal = brush === "spiana" ? level : (H(i - 1, j) + H(i + 1, j) + H(i, j - 1) + H(i, j + 1)) / 4;
        to = now + (goal - now) * Math.min(1, f * strength * dt * 2);
      }
      cm[k] = Math.max(-32000, Math.min(32000, cm[k] + (to - now) * 100));
    }
    refresh(i0, j0, i1, j1);
  };

  // ── annulla e ripeti (uno stato per pennellata) ──
  const undo: Int16Array[] = [], redo: Int16Array[] = [];
  const shot = (): Int16Array => Int16Array.from(cm, Math.round);
  const back = (from: Int16Array[], to: Int16Array[]): boolean => {
    const s = from.pop();
    if (!s) return false;
    to.push(shot()); cm.set(s); refresh(0, 0, w - 1, h - 1); settle();
    return true;
  };
  /** A pennellata finita: le quote che leggono gli altri (`getHeightAtCoordinates`), l'ingombro, l'ombra del sole. */
  const settle = (): void => { mesh.updateCoordinateHeights(); mesh.refreshBoundingInfo(); ctx.shadows(); dirty = true; ctx.changed(); };

  return {
    get dirty() { return dirty; },
    off(): void { at = null; painting = false; showRing(); },
    pointer(pi: PointerInfo): void {
      const e = pi.event as PointerEvent;
      if (pi.type === PointerEventTypes.POINTERDOWN && e.button === 0 && at) {
        painting = true; level = at.y;
        undo.push(shot()); if (undo.length > 40) undo.shift(); redo.length = 0;
      } else if (pi.type === PointerEventTypes.POINTERUP && e.button === 0 && painting) { painting = false; settle(); }
    },
    update(dt: number): void {
      at = aim();
      if (painting && at) stroke(Math.min(dt, 0.05));
      showRing();
    },
    undo: (): boolean => back(undo, redo),
    redo: (): boolean => back(redo, undo),
    panel(box: HTMLElement, field: (l: string, i: HTMLElement) => HTMLElement): void {
      box.append(Object.assign(document.createElement("h3"), { textContent: "Terreno" }));
      // (impostazioni del pennello: non sono modifiche al file, niente annulla)
      const num = (v: number, step: number, set: (n: number) => void): HTMLInputElement => {
        const i = Object.assign(document.createElement("input"), { type: "number", step: String(step), value: String(v) });
        i.onchange = () => { if (Number.isFinite(+i.value)) set(+i.value); };
        return i;
      };
      const kind = document.createElement("select");
      for (const b of BRUSHES) kind.add(new Option(b, b, false, b === brush));
      kind.onchange = () => { brush = kind.value as Brush; };
      box.append(field("pennello", kind));
      box.append(field("raggio (m)", num(radius, 1, (n) => { radius = Math.max(1, Math.min(40, n)); })));
      box.append(field("forza", num(strength, 0.25, (n) => { strength = Math.max(0.05, Math.min(10, n)); })));
      box.append(Object.assign(document.createElement("div"), { className: "hint", textContent: "Clic sinistro tenuto: dipingi. Alza e abbassa vanno di «forza» metri al secondo; spiana porta alla quota dove si è cominciato. Rocce, alberi, erba, città e strade si posano sul terreno nuovo salvando." }));
    },
    /** Lo strato da salvare (centimetri interi). */
    data: (): Int16Array => shot(),
  };
}
export type Sculpt = ReturnType<typeof createSculpt>;
