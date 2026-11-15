// Il server di sviluppo: Vite com'è, più il salvataggio dell'editor della mappa (src/editor.ts, docs/editor.md).
// POST /__editor/save { location, fields: { children?, walks?, spots?, green?, paving? }, roads?, npcs? } → riscrive quei
// blocchi del luogo (e strade e abitanti) in public/data/db.json lasciando com'è il resto del file, lancia
// i controlli di `npm run check` e, se falliscono, rimette il file com'era e risponde con l'errore. Solo in sviluppo.
import { defineConfig } from "vite";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { writeValues } from "./tools/editor/dbwrite.mjs";

/** I blocchi di un luogo che l'editor può riscrivere. */
const FIELDS = ["children", "walks", "spots", "green", "paving"];

const DB = new URL("./public/data/db.json", import.meta.url);
/** Le modifiche al terreno (terrain.ts, `LIFT`): Int16 per vertice, 671 × 321. */
const LIFT = new URL("./public/data/terreno.bin", import.meta.url), LIFT_BYTES = (320 + 350 + 1) * 321 * 2;   // (WORLD + EAST + 1) × (WORLD + 1): terrain.ts

function editorSave() {
  return {
    name: "side-quest-editor",
    apply: "serve",
    configureServer(server) {
      // POST /__editor/terrain (il corpo è lo strato, così com'è) → public/data/terreno.bin; tutto a zero = niente file
      server.middlewares.use("/__editor/terrain", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        const parts = [];
        req.on("data", (ch) => parts.push(ch));
        req.on("end", () => {
          const buf = Buffer.concat(parts);
          if (buf.length !== LIFT_BYTES) { res.statusCode = 400; res.end(`misura sbagliata: ${buf.length} byte invece di ${LIFT_BYTES}`); return; }
          if (buf.every((b) => b === 0)) { if (existsSync(LIFT)) rmSync(LIFT); } else writeFileSync(LIFT, buf);
          res.end("salvato");
        });
      });
      server.middlewares.use("/__editor/save", (req, res) => {
        if (req.method !== "POST") { res.statusCode = 405; res.end(); return; }
        let body = "";
        req.on("data", (ch) => { body += ch; });
        req.on("end", () => {
          const old = readFileSync(DB, "utf8");
          const reply = (code, msg) => { res.statusCode = code; res.setHeader("content-type", "text/plain; charset=utf-8"); res.end(msg); };
          try {
            const { location, fields = {}, roads, npcs } = JSON.parse(body), i = JSON.parse(old).locations.findIndex((l) => l.id === location);
            if (i < 0) throw new Error(`il luogo "${location}" non c'è`);
            const changes = Object.entries(fields).filter(([k]) => FIELDS.includes(k)).map(([k, value]) => ({ path: ["locations", i, k], value }));
            if (roads) changes.push({ path: ["roads"], value: roads });
            if (npcs) changes.push({ path: ["npcs"], value: npcs, as: "npcs" });
            writeFileSync(DB, writeValues(old, changes));
            execFileSync(process.execPath, ["src/data/db.check.mjs"], { cwd: new URL(".", import.meta.url), stdio: "pipe" });
            execFileSync(process.execPath, ["src/world/vetri.check.mjs"], { cwd: new URL(".", import.meta.url), stdio: "pipe" });
            reply(200, "salvato");
          } catch (e) {
            writeFileSync(DB, old);   // il file torna com'era
            const out = `${e.stderr ?? ""}${e.stdout ?? ""}` || e.message;
            // (solo il messaggio: la riga "DbError: …" o "AssertionError …", senza colori né pila)
            const clean = String(out).replace(/\x1b\[[0-9;]*m/g, ""), line = clean.split(/\r?\n/).find((l) => /^(DbError|AssertionError|Error)\b/.test(l.trim()));
            reply(400, (line ?? clean.slice(0, 400)).trim().replace(/^(DbError|Error): /, ""));
          }
        });
      });
    },
  };
}

export default defineConfig({ plugins: [editorSave()] });
