// Le finestre aperte (layouts.ts: `deep`) devono arrivare esattamente al vetro incassato nella facciata (town.ts: `sash`,
// `win` e `lancet` con `deep`): più corta, fra nicchia e vetro resta una fessura da cui si vede il vuoto; più lunga, buca
// la facciata. E ogni finestra di un edificio in cui si entra deve essere aperta: una nicchia chiusa da vetri opachi
// vorrebbe dire una finestra finta. I piani dei vetri di fuori sono riscritti qui a mano (quanto distano dal centro
// dell'edificio, alla misura di disegno): cambiandoli in town.ts vanno cambiati anche qui.
// node src/world/vetri.check.mjs
import assert from "node:assert/strict";
import { layout, face } from "./layouts.ts";

const rnd = () => 0.5, K = 1.5;   // la scala degli edifici nel file (`children[].scale`)
// interno, larghezza e profondità di disegno, e per ogni finestra (stanza, lato) il piano del vetro di fuori
const CASI = [
  ["casa.povera", 5, 6, (r, s, hw, hd) => hd - 0.14],
  ["casa.graticcio", 6.6, 8, (r, s, hw, hd) => (r.y < 3 ? hd - 0.08 : s === "z+" ? hd + 0.35 - 0.08 : s === "z-" ? hd - 0.08 : hw + 0.05 - 0.08)],
  ["casa.ricca", 8, 9, (r, s, hw, hd) => (r.y < 3 ? hd - 0.08 : s[0] === "z" ? hd - 0.09 : hw - 0.09)],
  ["locanda", 9, 9, (r, s, hw, hd) => (r.y < 3 ? hd - 0.08 : s[0] === "z" ? hd - 0.09 : hw - 0.09)],
  ["municipio", 22, 11, (r) => (r.y < 4 ? 5.5 - 0.18 : 5.4 - 0.08)],
  ["cattedrale", 0, 0, (r, s) => (r.name === "navata" ? 6.52 - 0.3 : s === "z-" ? 14.52 - 0.2 : 4.02 - 0.2)],
];
let n = 0;
for (const [id, w, d, glass] of CASI) {
  const L = layout(id, w, d, rnd, K);
  for (const o of L.openings) {
    if (o.kind !== "finestra") continue;
    const r = L.rooms.find((q) => q.name === o.room), out = glass(r, o.side, w / 2, d / 2) * K;
    n++;
    assert.ok(o.deep !== undefined, `${id}, ${o.room} ${o.side}: finestra chiusa da vetri opachi (manca \`deep\`)`);
    const z = Math.abs(face(r, o.side).w) + o.deep;
    assert.ok(Math.abs(z - out) < 0.011, `${id}, ${o.room} ${o.side}: la nicchia aperta arriva a ${z.toFixed(3)}, il vetro della facciata è a ${out.toFixed(3)}`);
  }
}
assert.ok(n >= 40, `finestre controllate: ${n}`);
console.log(`vetri: a posto (${n} finestre)`);
