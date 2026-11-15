// Mette nel file dei dati la pianta che tools/blender/meandro.py ha prodotto (la città sul meandro), lasciando com'è il resto
// del file: la città (posizione, rettangolo, porta, mura, fiume, elementi, posti, percorsi, selciati, verde), la cripta
// (spostata accanto alla nuova cattedrale) e il giro di Lumier (rifatto sui lampioni nuovi).
//   node tools/editor/meandro.mjs <meandro.json>
import { readFileSync, writeFileSync } from "node:fs";
import { writeValues } from "./dbwrite.mjs";

const DB = new URL("../../public/data/db.json", import.meta.url);
const L = JSON.parse(readFileSync(process.argv[2], "utf8")), text = readFileSync(DB, "utf8"), db = JSON.parse(text);
const town = db.locations.findIndex((l) => l.kind === "settlement"), crypt = db.locations.findIndex((l) => l.kind === "crypt");
const lumier = db.npcs.findIndex((n) => n.id === "lumier");
const changes = Object.entries(L.town).map(([k, value]) => ({ path: ["locations", town, k], value }));
changes.push({ path: ["locations", crypt, "at"], value: L.crypt.at }, { path: ["locations", crypt, "yaw"], value: L.crypt.yaw });
// il giro: le tappe dei lampioni in fila, poi la sosta alla fontana (com'era); gli altri tratti della giornata restano
const routine = db.npcs[lumier].routine.map((r) => r.stops?.some((s) => s.act === "light")
  ? { ...r, stops: [...L.lumier.map((at) => ({ at, act: "light", stay: [3, 4] })), ...r.stops.filter((s) => s.act !== "light")] } : r);
changes.push({ path: ["npcs", lumier, "routine"], value: routine });
writeFileSync(DB, writeValues(text, changes));
console.log(`scritto: ${L.town.children.length} elementi, ${L.lumier.length} tappe di Lumier, cripta in ${L.crypt.at}`);
