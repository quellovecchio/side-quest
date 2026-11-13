// Controllo del database: `npm run check`. Verifica il file vero (public/data/db.json) e che il
// lettore rifiuti gli errori tipici dicendo dove stanno. Gira con Node, senza altro.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseDb } from "./db.ts";
import { Clock, hoursUntil } from "../clock.ts";
import { layout, problems, seedOf } from "../world/layouts.ts";
import { mulberry32 } from "../world/noise.ts";
import { advance, react, stage, test } from "./effects.ts";
import { State } from "./state.ts";
import { derive, need, unlocked } from "./character.ts";

const real = JSON.parse(readFileSync(new URL("../../public/data/db.json", import.meta.url), "utf8"));
const db = parseDb(real);
assert.ok(db.creatures.length > 0 && db.spawns.length > 0, "il file vero ha creature e gruppi");

/** Una copia del file vero con una modifica, e l'errore che deve dare. */
const broken = (change, expected) => {
  const copy = structuredClone(real);
  change(copy);
  assert.throws(() => parseDb(copy), (e) => e.message.includes(expected), `atteso un errore con "${expected}"`);
};
broken((d) => { d.creatures[0].stats.salute = "sessanta"; }, "creatures[0].stats.salute: atteso un numero");
broken((d) => { d.creatures[0].stats.saluet = 1; }, 'campo sconosciuto "saluet"');
broken((d) => { delete d.creatures[1].attack.pausa; }, "creatures[1].attack.pausa: atteso un numero");
broken((d) => { d.creatures[0].model = "orso"; }, "creatures[0].model: atteso uno fra wolf, rat");
broken((d) => { d.spawns[0].creature = "lupoo"; }, 'spawns[0].creature: "lupoo" non è fra le creature');
broken((d) => { d.creatures[1].id = d.creatures[0].id; }, "c'è già");
broken((d) => { d.spawns[0].at = [1]; }, "spawns[0].at: attese due coordinate");
broken((d) => { d.time.wake[0].hour = 24; }, "time.wake[0].hour: atteso un numero sotto 24");
broken((d) => { delete d.time; }, "time: atteso un oggetto");
const town = real.locations.findIndex((l) => l.kind === "settlement");
broken((d) => { d.spawn = "raduraa"; }, 'spawn: "raduraa" non è fra i luoghi');
broken((d) => { d.locations[town].children[1].prefab = "castello"; }, `locations[${town}].children[1].prefab: atteso uno fra`);
broken((d) => { delete d.locations[town].children[1].size; }, `locations[${town}].children[1].size: a "casa.graticcio" serve la misura`);
// gli interni: serve un nome (senza punti, uno solo), l'interno giusto per l'edificio, il seme solo dove c'è un interno; la porta della città ha il suo
broken((d) => { d.locations[town].children.push({ id: "locanda", prefab: "casa.ricca", at: [0, 30], size: [8, 8], interior: "locanda" }); }, '"locanda" c\'è già');
broken((d) => { d.locations[town].children.push({ prefab: "casa.ricca", at: [0, 30], size: [8, 8], interior: "casa.ricca" }); }, "a un edificio in cui si entra serve un nome");
broken((d) => { d.locations[town].children[1].interior = "cattedrale"; }, 'l\'interno "cattedrale" sta in un "cattedrale", non in un "casa.graticcio"');
broken((d) => { d.locations[town].children[1].interior = "taverna"; }, `locations[${town}].children[1].interior: atteso uno fra`);
broken((d) => { d.locations[town].children[1].id = "casa.uno"; }, "non può contenere un punto");
broken((d) => { d.locations[town].children.find((c) => c.prefab === "pozzo").seed = 3; }, "il seme sceglie la pianta di un interno");
broken((d) => { d.locations[town].children[0].interior = "porta"; }, "sta in una porta della città (gate)");
broken((d) => { d.locations[town].children.find((c) => c.prefab === "festone").at = [0, 0]; }, "si tende fra due capi");
broken((d) => { d.locations[town].children.find((c) => c.prefab === "panni").to = [90, 3, 0]; }, "fra i due capi ci vogliono da 0,5 a 40 m");
broken((d) => { d.locations[town].children.find((c) => c.prefab === "pozzo").from = [0, 0, 0]; }, "from e to sono solo degli oggetti tesi");
broken((d) => { d.locations[town].gate.interior = "locanda"; }, "gate.interior: atteso uno fra porta");
broken((d) => { d.locations[town].gate.id = "locanda"; }, '"locanda" c\'è già');
broken((d) => { d.locations[0].gate = { id: "porta2" }; }, "solo un insediamento ha una porta");
broken((d) => { d.locations[town].paving[0].line = [[0, 0], [5, 5]]; }, "un selciato è una striscia dritta");
broken((d) => { delete d.locations[town].ground; }, "ground: a un insediamento servono");
broken((d) => { d.locations.splice(town, 1); }, "serve esattamente un insediamento");
broken((d) => { d.roads[1].to = "radura"; }, "roads[1].to: una strada porta a un insediamento");
broken((d) => { d.roads[0].line = [[0, 0]]; }, "roads[0].line: attesi almeno 2 punti");

// gli abitanti: aspetto e attività fra quelli del codice, giornata in ordine d'ora, tappe in posti che esistono, effetti e condizioni noti
broken((d) => { d.npcs[0].look = "drago"; }, "npcs[0].look: atteso uno fra");
broken((d) => { d.npcs[1].id = d.npcs[0].id; }, "c'è già");
broken((d) => { d.npcs[0].home = "pozzo"; }, 'npcs[0].home: "pozzo" non è un edificio in cui si entra');
broken((d) => { d.npcs[0].routine[1].from = "25:00"; }, 'routine[1].from: attesa un’ora "HH:MM"');
broken((d) => { d.npcs[0].routine[1].from = "05:00"; }, "i tratti vanno in ordine d'ora");
broken((d) => { d.npcs[0].routine[0].stops[0].at = "piazzaa"; }, '"piazzaa" non è un posto della città');
broken((d) => { d.npcs[0].routine[0].stops[0].act = "dance"; }, "stops[0].act: atteso uno fra");
broken((d) => { delete d.npcs[0].routine[1].stops[0].stay; }, "in un giro di più tappe ognuna dice quanto dura");
broken((d) => { d.npcs[0].routine[0].follow = "lisetta"; }, "non tutti e due");
broken((d) => { d.npcs[0].routine[0] = { from: "06:30", follow: "lisetta" }; }, 'dev\'essere un altro abitante, che non segue nessuno');
broken((d) => { d.npcs[0].interactions = [{ on: "talk", do: [{ dance: 1 }] }]; }, "atteso un oggetto con un solo campo fra say, flag, give, take, heal, quest");
broken((d) => { d.npcs[0].interactions = [{ on: "talk", if: { flag: "a", hour: [1, 2] }, do: [] }]; }, "atteso un oggetto con un solo campo fra flag, has, opened, hour, not, all");
// gli oggetti: ogni oggetto nominato (bottino, forzieri, botteghe, effetti, condizioni, eventi "use:") esiste; chi si usa dice cosa fa
broken((d) => { d.items[0].id = "monete"; }, "non è un nome ammesso");
broken((d) => { delete d.items[0].use; }, "items[0].use: serve a un oggetto che si usa");
broken((d) => { d.items.find((i) => i.kind === "weapon").equip.look = "oro"; }, "equip.look: atteso uno fra ferro, argento");
broken((d) => { d.creatures[0].loot = { pelliccia: 1 }; }, 'creatures[0].loot: "pelliccia" non è fra gli oggetti');
broken((d) => { d.containers[0].items = { tesoro: 1 }; }, 'containers[0].items: "tesoro" non è fra gli oggetti');
broken((d) => { d.containers[0].at = "soffitta"; }, 'containers[0].at: "soffitta" non è un posto');
broken((d) => { d.player.equipment = ["pane"]; }, 'player.equipment[0]: "pane" non è un\'arma');
broken((d) => { d.npcs[0].interactions = [{ on: "use:sasso", do: [] }]; }, '"sasso" non è fra gli oggetti');
broken((d) => { d.npcs[0].interactions = [{ on: "wave", do: [] }]; }, "atteso talk, hit o use:<oggetto>");
broken((d) => { d.npcs[0].services = { shop: { hours: ["07:00", "18:00"], items: ["sasso"] } }; }, 'services.shop.items: "sasso" non è fra gli oggetti');
broken((d) => { d.npcs[0].services = { shop: { hours: ["07:00"], items: [] } }; }, "attese due ore [apre, chiude]");

// condizioni ed effetti (effects.ts): l'ora a cavallo della mezzanotte, la bandierina, il "una volta sola", la ricompensa
{
  let hour = 23, healed = 0;
  const w = { state: new State(), hour: () => hour, heal: (n) => { healed += n; }, name: (id) => id.toUpperCase() };
  assert.ok(test({ hour: [22, 6] }, w) && !test({ hour: [6, 22] }, w));
  hour = 9;
  const list = [
    { on: "talk", if: { all: [{ hour: [5, 12] }, { not: { flag: "cattivo" } }] }, once: true, do: [{ say: ["Buongiorno."] }, { heal: 30 }, { flag: "benedetto" }] },
    { on: "talk", if: { flag: "benedetto" }, once: true, do: [{ give: { monete: 20 } }] },
    { on: "hit", once: false, do: [{ flag: "cattivo" }] },
  ];
  assert.deepEqual(react("x", list, "talk", w), ["Buongiorno."]);
  assert.deepEqual([healed, w.state.flags.has("benedetto")], [30, true]);
  assert.deepEqual(react("x", list, "talk", w), ["[Ricevi 20 monete.]"], "la prima è consumata: tocca alla seconda");
  assert.equal(react("x", list, "talk", w), null, "consumate tutte e due: resta il dialogo di tutti i giorni");
  assert.equal(w.state.monete, 20);
  assert.deepEqual(react("x", list, "hit", w), []);
  assert.ok(w.state.flags.has("cattivo"));
  // oggetti: dare, avere, porgere (use:<oggetto>), prendere; ciò che finisce non si impugna più
  const gift = [{ on: "use:pane", if: { has: { pane: 1 } }, once: true, do: [{ take: { pane: 1 } }, { give: { pozione: 2, monete: 3 } }] }];
  assert.equal(react("y", gift, "use:pane", w), null, "senza pane non reagisce");
  w.state.add("pane", 1); w.state.add("spada", 1); w.state.mano = "spada";
  assert.deepEqual(react("y", gift, "use:pane", w), ["[Dai PANE.]", "[Ricevi 2 × POZIONE.]", "[Ricevi 3 monete.]"]);
  assert.deepEqual([w.state.count("pane"), w.state.count("pozione"), w.state.monete], [0, 2, 23]);
  w.state.add("spada", -1);
  assert.equal(w.state.mano, null);
}

// classi e abilità: statistiche e numeri fra quelli del codice, alberi che nominano abilità vere, prerequisiti nello stesso albero
broken((d) => { d.classes[0].stats.fortuna = 3; }, 'campo sconosciuto "fortuna"');
broken((d) => { d.classes[0].skillTree[0].skill = "volo"; }, '"volo" non è fra le abilità');
broken((d) => { d.classes[0].skillTree[0].requires = ["scintilla"]; }, '"scintilla" non è un\'altra abilità di questo albero');
broken((d) => { d.skills[0].mods[0].stat = "fortuna"; }, "mods[0].stat: atteso uno fra");
broken((d) => { delete d.skills.find((k) => k.kind === "active").cost; }, 'un\'attiva ha "cost" ed "effect"');
broken((d) => { d.skills.find((k) => k.kind === "active").effect.cast = "palla"; }, "effect.cast: atteso uno fra dardo, cura");
broken((d) => { d.classes = []; }, "serve almeno una classe");
// le regole del personaggio (character.ts): a 5 una statistica non cambia niente; alzarla sblocca un'abilità (prima i prerequisiti); una passiva cambia un numero
{
  const flat = { forza: 5, destrezza: 5, costituzione: 5, intelligenza: 5, saggezza: 5, carisma: 5 }, base = derive(flat, []);
  assert.deepEqual([base.danno, base["costo.colpo"], base["costo.parata"], base.passo, base.resistenza, base.prezzi], [1, 1, 1, 1, 1, 1]);
  const g = db.classes.find((c) => c.id === "guerriero"), by = (ids) => ids.map((id) => db.skills.find((k) => k.id === id));
  assert.deepEqual(unlocked(g, g.stats), [], "il guerriero comincia senza abilità");
  assert.deepEqual(unlocked(g, { ...g.stats, forza: 10 }), [], "colpo pesante vuole prima guardia salda");
  assert.deepEqual(unlocked(g, { ...g.stats, costituzione: 8 }), ["guardia_salda"]);
  const s = { ...g.stats, costituzione: 8, forza: 10 }, u = unlocked(g, s);
  assert.deepEqual(u, ["guardia_salda", "colpo_pesante"]);
  const before = derive(s, []), after = derive(s, by(u));
  assert.ok(Math.abs(after.danno / before.danno - 1.25) < 1e-9 && Math.abs(after["costo.parata"] / before["costo.parata"] - 0.6) < 1e-9);
  assert.equal(unlocked(undefined, flat).length, 0);
  assert.deepEqual([need(1, 60), need(3, 60)], [60, 180]);
}

// il sottosuolo: a cripte e grotte (e solo a loro) servono verso, profondità e camera; la discesa va lungo un asse; chi nasce "dentro" nomina uno di loro
const crypt = real.locations.findIndex((l) => l.kind === "crypt");
broken((d) => { delete d.locations[crypt].depth; }, "servono yaw, depth e room");
broken((d) => { d.locations[0].depth = 5; }, "servono yaw, depth e room");
broken((d) => { d.locations[crypt].yaw = 45; }, `locations[${crypt}].yaw: atteso uno fra 0, 90, 180, 270`);
broken((d) => { d.locations[crypt].depth = 2; }, `locations[${crypt}].depth: atteso un numero da 4 in su`);
broken((d) => { d.spawns[0].in = "citta"; }, 'spawns[0].in: "citta" non è una cripta né una grotta');
broken((d) => { d.containers.find((c) => c.at.startsWith("cripta")).at = "criptaa.fondo"; }, "non è un posto della città né sta in un edificio");

// le missioni: tappe con posti, abitanti, oggetti e forzieri che esistono; gli effetti nominano missioni vere
broken((d) => { d.quests[0].stages = []; }, "serve almeno una tappa");
broken((d) => { d.quests[0].stages[0].at = "grottaa.centro"; }, "non è un posto della città né sta in un edificio");
broken((d) => { d.quests[0].stages[1].npc = "nessuno"; }, '"nessuno" non è fra gli abitanti');
broken((d) => { d.quests[0].stages[2].done = { opened: "baule" }; }, '"baule" non è fra i forzieri');
broken((d) => { d.quests[0].stages[0].done = { has: { codaa: 3 } }; }, '"codaa" non è fra gli oggetti');
broken((d) => { d.npcs[0].interactions = [{ on: "talk", do: [{ quest: "drago" }] }]; }, '"drago" non è fra le missioni');
// la missione vera, tappa per tappa, con un salvataggio a metà: comincia, avanza quando la condizione è vera, si salva, si ricarica e prosegue
{
  const q = db.quests[0], w = { state: new State(), hour: () => 10, heal: () => {}, name: (id) => id };
  assert.equal(stage(q, w.state), undefined, "non ancora cominciata");
  assert.deepEqual(advance(db.quests, w), []);
  w.state.quests[q.id] = 0; w.state.add("coda_ratto", 2);
  assert.deepEqual(advance(db.quests, w), [], "due code non bastano");
  w.state.add("coda_ratto", 1);
  assert.deepEqual(advance(db.quests, w).map((m) => m.over), [false]);
  assert.equal(stage(q, w.state), q.stages[1]);
  const saved = JSON.parse(JSON.stringify(w.state.save())), again = { ...w, state: new State() };
  again.state.load(saved);
  assert.deepEqual(again.state.save(), w.state.save(), "ciò che si carica è ciò che si è salvato");
  again.state.flags.add("ratti_pagati");
  assert.equal(advance(db.quests, again)[0].over, false);
  again.state.opened.add("sarcofago_cripta");
  assert.equal(advance(db.quests, again)[0].over, true);
  assert.equal(stage(q, again.state), undefined, "conclusa");
  assert.equal(stage(q, w.state), q.stages[1], "la partita di prima è rimasta dov'era");
}

// l'orologio: il risveglio è sempre nel futuro, e il giorno scatta a mezzanotte
assert.equal(hoursUntil(22, 7), 9);
assert.equal(hoursUntil(6, 7), 1);
assert.equal(hoursUntil(12, 12), 24);
assert.equal(hoursUntil(13, 0), 11);
const c = new Clock(22, 48);
c.advance(hoursUntil(c.hour, 7));
assert.deepEqual([c.day, c.hour], [2, 7]);
assert.equal(c.label(), "Giorno 2 · 07:00");

// le piante degli interni (layouts.ts): per ogni edificio del file in cui si entra, quella del suo seme (lo stesso conto di town.ts).
// Ogni posto dev'essere raggiungibile dalla strada lungo i percorsi, senza passare attraverso muri e arredi.
// La locanda è fatta a mano e non ha una pianta: la controlla il gioco, in sviluppo, con tutta la rete (checkPlan in town.ts).
const here = db.locations[town], entered = [...here.children, ...(here.gate ? [here.gate] : [])].filter((c) => c.interior);
let posti = 0;
for (const c of entered) {
  const L = layout(c.interior, ...(c.size ?? [0, 0]), mulberry32(seedOf(c)), c.scale ?? 1);
  assert.deepEqual(problems(L), [], `${c.id} (${c.interior}): un posto non si raggiunge`);
  assert.ok(L.places.some((p) => p.name === "porta.fuori" && p.node), `${c.id}: serve il nodo porta.fuori, in strada`);
  posti += L.places.length;
}
assert.ok(entered.length >= 25, "tutte le case e gli edifici civici hanno un interno");
// case dello stesso tipo non sono gemelle: due semi, due piante
const twin = (seed) => JSON.stringify(layout("casa.graticcio", 7, 8, mulberry32(seed)).pieces);
assert.notEqual(twin(seedOf({ id: "casa05" })), twin(seedOf({ id: "casa06" })));
// e il controllo deve accorgersi di un intralcio: una botte posata in mezzo a un percorso
{
  const L = layout("casa.povera", 6, 6, mulberry32(1)), a = L.places.find((p) => p.name === "porta"), b = L.places.find((p) => p.name === "stanza");
  L.pieces.push({ t: "botte", x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: a.y, turn: 0 });
  assert.ok(problems(L).some((p) => p.startsWith("percorso porta–stanza")), "una botte in mezzo al percorso va segnalata");
}

// le tappe degli abitanti dentro gli edifici: il posto deve stare nella pianta di quell'edificio (la locanda è fatta a mano: la controlla il gioco all'avvio)
const inside = new Map(entered.map((c) => [c.id, new Set(layout(c.interior, ...(c.size ?? [0, 0]), mulberry32(seedOf(c)), c.scale ?? 1).places.map((p) => p.name))]));
for (const n of db.npcs) for (const t of n.routine) for (const s of t.stops) {
  const i = s.at.indexOf("."), names = inside.get(s.at.slice(0, i));
  assert.ok(i < 0 || !names || names.has(s.at.slice(i + 1)), `${n.id}: il posto "${s.at}" non c'è in quell'edificio`);
}
// ognuno va a letto, e nessuno nello stesso letto di un altro
const beds = db.npcs.map((n) => n.routine.flatMap((t) => t.stops).find((s) => s.act === "sleep")?.at);
assert.ok(beds.every((b) => b?.endsWith(".letto")) && new Set(beds).size === beds.length, "a ognuno il suo letto");

console.log(`db.json: ${db.npcs.length} abitanti, ${db.creatures.length} creature, ${db.spawns.length} gruppi, ${entered.length + 1} interni (${posti} posti raggiungibili) — a posto`);
