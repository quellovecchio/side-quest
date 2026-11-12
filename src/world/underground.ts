import { Color3, Mesh, Scene } from "@babylonjs/core";
import { Kit } from "./interiors";
import { flame } from "./flames";
import { surfaceMaterial } from "./materials";
import { PITS, terrainHeight, type Pit } from "./terrain";
import { dirtTex, photoTex } from "./textures";
import { Mason, type Interior, type Tint, type TownPlan } from "./town";
import type { Floor } from "./levels";
import type { Collider } from "./vegetation";
import { DbError } from "../data/db";

// ─────────────────────────────────────────────────────────────────────────────
// SOTTOSUOLO — cripte e grotte (i luoghi `crypt` e `cave` del file). Si scende camminando: una
// trincea aperta nel terreno, con una rampa e un parapetto, porta a una camera chiusa sotto terra.
//
// Il terreno è un campo d'altezze: sotto non c'è niente. Dove passa la trincea gli si tolgono i
// triangoli (terrain.ts, celle da un metro: per questo la trincea è dritta lungo x o z e sta sulla
// griglia), e i suoi muri salgono fino al bordo del buco, vertice per vertice. La camera sta tutta
// sotto il terreno, chiusa su sei lati: da dentro il cielo non si vede.
//
// Due mani: la trincea è all'aperto e prende il sole come la città (un `Mason`); la camera ha la
// luce cotta sui vertici come gli interni (un `Kit`): candele o funghi di dentro, il giorno che
// entra dalla porta.
// ponytail: la camera è una scatola (anche la grotta): pareti storte, cunicoli e più stanze quando serviranno.
// ─────────────────────────────────────────────────────────────────────────────

/** Mezza larghezza della trincea, altezza della porta e della camera, spessore del muro fra trincea e camera. */
const A = 1.5, DOOR = 2.4, H = 3, WALL = 0.3;

const SKIN: Record<Pit["kind"], { wall: string; floor: string; out: string; muro: Tint; suolo: Tint }> = {
  crypt: { wall: "stone", floor: "flag", out: "stone", muro: [0.62, 0.6, 0.58], suolo: [0.6, 0.58, 0.56] },
  cave: { wall: "earth", floor: "earth", out: "earth", muro: [0.4, 0.37, 0.34], suolo: [0.5, 0.45, 0.4] },
};

export interface Underground {
  /** La trincea e il parapetto: mesh all'aperto, sempre accese. */
  meshes: Mesh[];
  /** Le camere: come gli interni, si disegnano solo da vicino. */
  interiors: Interior[];
  floors: Floor[]; colliders: Collider[];
  /** Gli stessi muri come file di cerchi, per chi non sa dei segmenti (i nemici: enemies.ts). */
  fences: Collider[];
  /** I posti con nome (`<id>.ingresso`, `<id>.fondo`): servono a forzieri e nemici. */
  spots: TownPlan["spots"];
}

export function createUnderground(scene: Scene): Underground {
  const out: Underground = { meshes: [], interiors: [], floors: [], colliders: [], fences: [], spots: {} };
  const mats = { stone: surfaceMaterial(scene, "sotto_pietra", photoTex(scene, "medieval_blocks_05"), { tint: new Color3(0.8, 0.78, 0.76), relief: 0.022 }), earth: surfaceMaterial(scene, "sotto_terra", dirtTex(scene), { rough: 1 }) };
  // ⚠️ come i materiali della città: il muratore non cura l'ordine dei vertici, quindi niente scarto delle facce dietro
  for (const m of Object.values(mats)) m.backFaceCulling = false;
  for (const p of PITS) {
    const s = SKIN[p.kind], O = new Mason(), K = new Kit(scene, new Mason(), p.id, () => new Mason(), null);
    const yaw = Math.atan2(p.dx, p.dz);
    // nel riferimento della trincea: +z è la discesa, x il traverso; le quote sono quelle del mondo
    K.I.in(p.x, 0, p.z, yaw, () => O.in(p.x, 0, p.z, yaw, () => {
      K.frame(); K.I.cell = 0.5;
      const ground = (x: number, z: number): number => { const w = O.world(x, 0, z); return terrainHeight(w.x, w.z); };
      const top = Math.min(...[-1.5, -0.5, 0.5, 1.5].map((x) => ground(x, 0))), yb = top - p.depth, L = p.len, z0 = L + WALL, z1 = z0 + p.room[1], hw = p.room[0] / 2;
      // la camera deve stare sotto il terreno con un po' di terra sopra
      for (let x = -hw - 1; x <= hw + 1; x++) for (let z = L; z <= z1 + 1; z++) {
        if (ground(x, z) < yb + H + 0.4) throw new DbError(`db.json.locations "${p.id}": qui il terreno sopra la camera è troppo basso (serve più profondità, o un altro posto)`);
      }

      // ── la trincea (all'aperto): rampa, muri fino al bordo del buco, soglia, parapetto ──
      O.poly(s.floor === "flag" ? "stone" : "earth", [[-A, top, 0], [A, top, 0], [A, yb, L], [-A, yb, L]], [0, 1, 0], { tint: s.suolo });
      O.poly(s.floor === "flag" ? "stone" : "earth", [[-A, yb, L], [A, yb, L], [A, yb, z0], [-A, yb, z0]], [0, 1, 0], { tint: s.suolo });
      for (let x = -A; x < A; x++) {
        O.poly(s.out, [[x, top - 0.05, 0], [x + 1, top - 0.05, 0], [x + 1, ground(x + 1, 0), 0], [x, ground(x, 0), 0]], [0, 0, 1], { tint: s.muro });        // la soglia in cima
        O.poly(s.out, [[x, yb + DOOR, L], [x + 1, yb + DOOR, L], [x + 1, ground(x + 1, L), L], [x, ground(x, L), L]], [0, 0, -1], { tint: s.muro });          // sopra la porta
        O.box("stone", x, Math.min(ground(x, L), ground(x + 1, L)) - 0.3, L, x + 1, Math.max(ground(x, L), ground(x + 1, L)) + 0.55, L + 0.3);                // parapetto in fondo
      }
      O.poly(s.out, [[-A, yb + DOOR, L], [A, yb + DOOR, L], [A, yb + DOOR, z0], [-A, yb + DOOR, z0]], [0, -1, 0], { tint: s.muro });                          // l'architrave, da sotto
      for (const g of [-1, 1]) {
        for (let z = 0; z < L; z++) {
          O.poly(s.out, [[g * A, yb - 0.3, z], [g * A, yb - 0.3, z + 1], [g * A, ground(g * A, z + 1), z + 1], [g * A, ground(g * A, z), z]], [-g, 0, 0], { tint: s.muro });   // i fianchi
          const lo = Math.min(ground(g * A, z), ground(g * A, z + 1)), hi = Math.max(ground(g * A, z), ground(g * A, z + 1));
          O.box("stone", Math.min(g * A, g * (A + 0.3)), lo - 0.3, z, Math.max(g * A, g * (A + 0.3)), hi + 0.55, z + 1);                                      // parapetto sui fianchi
        }
        O.poly(s.out, [[g * A, yb, L], [g * A, yb, z0], [g * A, yb + DOOR, z0], [g * A, yb + DOOR, L]], [-g, 0, 0], { tint: s.muro });                        // gli stipiti
      }
      K.floor(-A, 0, A, L, (top + yb) / 2, undefined, yb - top);
      K.floor(-A, L, A, z0, yb);

      // ── la camera (luce cotta): pavimento, soffitto, quattro pareti con la porta ──
      K.slab(s.floor, yb, -hw, z0, hw, z1, 1, { tint: s.suolo });
      K.slab(s.wall, yb + H, -hw, z0, hw, z1, -1, { tint: s.muro });
      K.panel(s.wall, "z", z0, -hw, hw, yb, yb + H, 1, { tint: s.muro }, [[-A, yb, A, yb + DOOR]]);
      K.panel(s.wall, "z", z1, -hw, hw, yb, yb + H, -1, { tint: s.muro });
      K.panel(s.wall, "x", -hw, z0, z1, yb, yb + H, 1, { tint: s.muro });
      K.panel(s.wall, "x", hw, z0, z1, yb, yb + H, -1, { tint: s.muro });
      K.floor(-hw, z0, hw, z1, yb);
      K.floor(-hw, z0, hw, z1, yb + H + 0.3, 0.3);   // il soffitto: chi salta ci batte la testa (da sopra è sotto il terreno: non ci cammina nessuno)
      K.light(0, yb + 1.6, z0 + 0.4, 9, 1.1, [0, 0, 1]);   // il giorno che entra dalla porta
      if (p.kind === "crypt") {
        // due sarcofagi ai lati, un altare in fondo con due candele
        for (const g of [-1, 1]) { K.box("stone", g * (hw - 1.5) - 0.5, yb, z0 + 2.2, g * (hw - 1.5) + 0.5, yb + 0.8, z0 + 4.4, [0.5, 0.48, 0.46]); K.box("stone", g * (hw - 1.5) - 0.58, yb + 0.8, z0 + 2.12, g * (hw - 1.5) + 0.58, yb + 0.95, z0 + 4.48, [0.4, 0.38, 0.37]); }
        K.box("stone", -1.1, yb, z1 - 1.1, 1.1, yb + 1, z1 - 0.3, [0.55, 0.53, 0.5]);
        for (const g of [-1, 1]) { K.box("stone", g * 0.8 - 0.03, yb + 1, z1 - 0.73, g * 0.8 + 0.03, yb + 1.22, z1 - 0.67, [0.75, 0.68, 0.5]); flame(K.I.world(g * 0.8, yb + 1.225, z1 - 0.7), 0.12, 0.1); K.light(g * 0.8, yb + 1.4, z1 - 0.9, 7, 1.3); }
      } else {
        // funghi che fanno un po' di luce negli angoli in fondo
        for (const g of [-1, 1]) { K.box("lume", g * (hw - 0.5) - 0.07, yb, z1 - 0.57, g * (hw - 0.5) + 0.07, yb + 0.12, z1 - 0.43, [1, 1, 1]); K.light(g * (hw - 0.6), yb + 0.5, z1 - 0.7, 6, 0.8); }
      }
      K.place("ingresso", 0, yb, z0 + 1, 0, false);
      K.place("centro", 0, yb, (z0 + z1) / 2, 0, false);
      K.place("fondo", 0, yb, z1 - (p.kind === "crypt" ? 1.9 : 1.2), 0, false);

      // ── muri che fermano il passo: i fianchi e il fondo della trincea (anche per chi sta sopra: c'è il parapetto), la camera ──
      const wall = (ax: number, az: number, bx: number, bz: number, y0: number, y1: number): void => {
        const a = O.world(ax, 0, az), b = O.world(bx, 0, bz);
        out.colliders.push({ x: a.x, z: a.z, bx: b.x, bz: b.z, r: 0.15, y0, y1 });
        for (let n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.5), i = 0; i <= n; i++) out.fences.push({ x: a.x + (b.x - a.x) * i / n, z: a.z + (b.z - a.z) * i / n, r: 0.3, y0, y1 });
      };
      const rim = Math.max(ground(-A, 0), ground(A, 0), ground(-A, L), ground(A, L)) + 1.2;
      for (const g of [-1, 1]) wall(g * (A + 0.15), 0, g * (A + 0.15), L, yb - 1, rim);
      wall(-A - 0.3, L + 0.15, A + 0.3, L + 0.15, yb + DOOR, rim);
      for (const g of [-1, 1]) { wall(g * A, z0, g * hw, z0, yb - 1, yb + H); wall(g * hw, z0, g * hw, z1, yb - 1, yb + H); wall(g * (A + 0.15), L, g * (A + 0.15), z0, yb - 1, yb + H); }
      wall(-hw, z1, hw, z1, yb - 1, yb + H);
    }));
    for (const [k, g] of O.geos) {
      const mesh = g.mesh(`sotto_${p.id}_${k}`, scene);
      mesh.material = mats[k as "stone" | "earth"]; mesh.isPickable = false; mesh.receiveShadows = true; mesh.freezeWorldMatrix();
      out.meshes.push(mesh);
    }
    // (una zona larga quanto il raggio: la camera si vede anche da fuori, guardando giù per la trincea)
    const b = K.finish([[-60, -60, 60, 60, -200, 200]], { x: p.x, z: p.z }, 55);
    out.interiors.push(b.interior); out.floors.push(...b.floors); Object.assign(out.spots, b.spots);
  }
  return out;
}
