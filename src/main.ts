import {
  Color3, Color4, ColorCurves, DefaultRenderingPipeline, DirectionalLight, Engine, HemisphericLight,
  ImageProcessingConfiguration, Mesh, MeshBuilder, ReflectionProbe, RenderTargetTexture, Scene, SSAO2RenderingPipeline,
  ShadowGenerator, StandardMaterial, Texture, ParticleSystem, DynamicTexture, Vector3, VolumetricLightScatteringPostProcess,
} from "@babylonjs/core";
import { CloudField } from "./sky/Clouds";
import { Sky } from "./sky/Sky";
import { dayLight, type DayLight } from "./sky/TimeOfDay";
import { Clock } from "./clock";
import { Sleep } from "./sleep";
import { arrival, createTerrain, layWorld, PITS } from "./world/terrain";
import { createUnderground } from "./world/underground";
import { createFlameLights, createFlames } from "./world/flames";
import { photosReady } from "./world/textures";
import { setInteriorDaylight, setLampGlow, terrainMaterial } from "./world/materials";
import { dirtTex, forestFloorTex, grassGroundTex, mossTex, rockTex } from "./world/textures";
import { createRocks, STONES } from "./world/rocks";
import { createVegetation } from "./world/vegetation";
import { checkPlan, createTown } from "./world/town";
import { interiorLight, interiorReach, warmInteriors } from "./world/interiors";
import { Player } from "./player/Player";
import { createHud } from "./hud";
import { createGraphicsSettings } from "./settings";
import { Enemies } from "./enemies";
import { by } from "./style";
import { Mist, type Mover } from "./world/mist";
import { sfx } from "./sfx";
import { Npcs, type Npc } from "./npcs";
import { SAVE, State } from "./data/state";
import { advance, amount, react, run, stage, test, type World } from "./data/effects";
import { Dialogue } from "./ui/dialogue";
import { ListPanel, type Page } from "./ui/list";
import { swordLook } from "./player/equipment";
import { Interact } from "./interact";
import { Doors } from "./world/doors";
import { Levels } from "./world/levels";
import { DbError, loadDb, STATS, type ItemDef, type SkillDef } from "./data/db";
import { derive, need, unlocked, type Tune } from "./data/character";
import { TOWN, townDist } from "./world/terrain";

// L'atmosfera dei due stili grafici (style.ts).
//   moderno: sole caldo, colori pieni, raggi fra i tronchi;
//   dark:    cielo coperto e spento, nebbia fitta e grigia, ombre dense, immagine desaturata e
//            contrastata con il bloom largo dei giochi dei primi anni 2000.
// ⚠️ L'ora la decide l'orologio (clock.ts), non lo stile. `hour` qui è l'ora a cui questi numeri sono
// TARATI: a quell'ora il gioco è identico a com'era con l'ora fissa; alle altre, sole, cielo e nebbia
// si scalano come li scala TimeOfDay, e dove non basta (notte, crepuscoli, sole basso) li correggono
// gli UMORI qui sotto, alle ore di `ORE`. La regia delle ore è la tavola docs/reference/citta/luce-1-ore.svg.
//   `moon`, `moonI`  la luna (TimeOfDay ne dà solo quanto sale e cala);
//   `stars`, `moonVis`, `moonVeil`  quanto restano stelle e disco della luna sotto il cielo dello stile, e quanto la
//                    luna traspare dalle nubi (il dark è coperto: senza, la luna farebbe luce senza vedersi);
//   `lumeDay`  quanto restano accesi finestre e lanterne di giorno; `lamp` il vetro di una lanterna accesa.
// Colori lineari, TRANNE la nebbia (`fogTint`, `fog` degli umori): `scene.fogColor` è in spazio gamma, il PBR la porta
// in lineare da sé. ⚠️ HDR: `lamp` sta poco sopra la soglia del bloom, più su diventa una lampadina.

/** Un umore: i valori che a certe ore prendono il posto di quelli scalati (quelli che mancano restano scalati). */
interface Mood {
  /** La luce del cielo (colore e forza) e quella che risale da terra. */
  amb?: Color3; ambI?: number; ground?: Color3;
  /** Nebbia (colore e densità), foschia a terra, raggi di luce, bloom. */
  fog?: Color3; dens?: number; mist?: number; rays?: number; bloom?: number;
  /** La tinta della luce che entra dalle finestre negli interni (bianco = il giorno pieno). */
  win?: Color3;
}
const c3 = (r: number, g: number, b: number): Color3 => new Color3(r, g, b);

const LOOK = by({
  hour: 8.2, skyDim: 1, skyGrey: 0, clouds: 0.55,
  sun: c3(1.0, 0.88, 0.72), sunI: 2.6, hemiI: 1.25, ground: c3(0.22, 0.2, 0.12),
  fog: 0.0055, fogTint: c3(0.55, 0.62, 0.58), fogMix: 0.3,
  exposure: 1.05, contrast: 1.12, saturation: 0, vignette: 2.2, grain: 5, sharpen: 0.25,
  bloomThreshold: 0.9, bloomWeight: 0.22, rays: 0.6, motes: 45, mist: 0.14, mistWhite: 0.55,
  moon: c3(0.55, 0.7, 1.0), moonI: 1.0, stars: 1, moonVis: 1, moonVeil: 0.15, lumeDay: 0.4, lamp: c3(1.45, 0.7, 0.2),
  // notte serena e blu, luna chiara; alba rosa; tramonto dorato (i colori sono già quelli del cielo: si alzano solo raggi e foschia); ora blu satura
  notte: { amb: c3(0.13, 0.19, 0.36), ambI: 1.0, ground: c3(0.04, 0.05, 0.08), fog: c3(0.2, 0.25, 0.34), dens: 0.006, mist: 0.1, rays: 0, bloom: 0.3, win: c3(0.05, 0.08, 0.16) } as Mood,
  alba: { amb: c3(0.5, 0.42, 0.5), ambI: 1.5, fog: c3(0.5, 0.44, 0.46), dens: 0.008, mist: 0.24, rays: 0, bloom: 0.26, win: c3(0.4, 0.36, 0.45) } as Mood,
  basso: { ambI: 1.15, dens: 0.007, mist: 0.2, rays: 1.0, bloom: 0.3, win: c3(1.0, 0.7, 0.45) } as Mood,
  blu: { amb: c3(0.2, 0.26, 0.5), ambI: 1.0, ground: c3(0.06, 0.07, 0.11), fog: c3(0.3, 0.34, 0.5), dens: 0.006, mist: 0.14, rays: 0, bloom: 0.3, win: c3(0.14, 0.2, 0.4) } as Mood,
}, {
  hour: 16.6, skyDim: 0.6, skyGrey: 0.5, clouds: 0.33,
  sun: c3(1.0, 0.74, 0.5), sunI: 2.9, hemiI: 1.5, ground: c3(0.17, 0.15, 0.1),
  fog: 0.009, fogTint: c3(0.46, 0.5, 0.46), fogMix: 0.7,
  exposure: 1.2, contrast: 1.16, saturation: -14, vignette: 3, grain: 9, sharpen: 0,
  bloomThreshold: 0.6, bloomWeight: 0.45, rays: 0.45, motes: 20, mist: 0.2, mistWhite: 0.3,
  moon: c3(0.42, 0.6, 1.0), moonI: 1.9, stars: 0.5, moonVis: 0.85, moonVeil: 0.8, lumeDay: 0.4, lamp: c3(1.35, 0.62, 0.17),
  // notte cupa ma giocabile (la nebbia più chiara delle ombre: tutto si legge in sagoma); alba fredda nella nebbia fitta;
  // tramonto: il sole è già dietro il crinale, la città sta in un'ombra malva (viola dall'alto, calda dal basso) sotto
  // il cielo acceso; ora blu coi lumi pieni
  notte: { amb: c3(0.12, 0.19, 0.36), ambI: 1.3, ground: c3(0.035, 0.045, 0.07), fog: c3(0.17, 0.2, 0.25), dens: 0.012, mist: 0.16, rays: 0, bloom: 0.6, win: c3(0.04, 0.06, 0.11) } as Mood,
  alba: { amb: c3(0.34, 0.36, 0.46), ambI: 1.5, ground: c3(0.07, 0.07, 0.07), fog: c3(0.37, 0.39, 0.43), dens: 0.015, mist: 0.34, rays: 0, bloom: 0.5, win: c3(0.3, 0.33, 0.45) } as Mood,
  basso: { amb: c3(0.44, 0.4, 0.58), ambI: 1.5, ground: c3(0.36, 0.22, 0.14), fog: c3(0.48, 0.44, 0.46), dens: 0.0115, mist: 0.26, rays: 0.9, bloom: 0.6, win: c3(0.95, 0.62, 0.4) } as Mood,
  blu: { amb: c3(0.17, 0.24, 0.48), ambI: 1.8, ground: c3(0.04, 0.045, 0.07), fog: c3(0.25, 0.28, 0.355), dens: 0.011, mist: 0.2, rays: 0, bloom: 0.62, win: c3(0.12, 0.16, 0.3) } as Mood,
});

// Le ore degli umori: [ora, umore, peso]. Fra una chiave e l'altra si sfuma; col peso a zero valgono i numeri scalati.
// ⚠️ Dalle 7:40 alle 17:20 il peso è zero: lì stanno le ore di riferimento dei due stili, che non si toccano.
const ORE: [number, "notte" | "alba" | "basso" | "blu", number][] = [
  [0, "notte", 1], [4.75, "notte", 1], [5.5, "alba", 1], [6.25, "basso", 1], [7.67, "basso", 0],
  [17.33, "basso", 0], [18.6, "basso", 1], [19.1, "basso", 1], [19.6, "blu", 1], [20.4, "notte", 1], [24, "notte", 1],
];

async function main(): Promise<void> {
  // il file dei dati si legge prima del mondo; se è sbagliato ci si ferma qui, dicendo dove
  const db = await loadDb().then((d) => { layWorld(d); return d; }).catch((e: Error) => {
    document.querySelector("#loading p")!.textContent = e.message;
    throw e;
  });
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const engine = new Engine(canvas, true, { stencil: true, antialias: false, powerPreference: "high-performance" }, false);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0, 0, 0, 1);
  // lascia disegnare l'overlay di caricamento prima del lavoro pesante
  await new Promise((r) => setTimeout(r, 50));

  // ── luce e cielo (il cielo è quello di footie-stars, vedi src/sky): seguono l'orologio ──
  const clock = new Clock(db.time.start, db.time.dayMinutes);
  const lum = (c: Color3): number => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
  /** I numeri di un'ora, col cielo dello stile: gli stessi colori, spenti verso il grigio e scuriti. */
  const lightAt = (hour: number): DayLight => {
    const d = dayLight(hour);
    for (const k of ["zenith", "mid", "horizon", "haze", "cloudLit", "cloudMid", "cloudShadow", "cloudRim"] as const) {
      const c = d[k], l = lum(c);
      d[k] = Color3.Lerp(c, new Color3(l, l, l), LOOK.skyGrey).scale(LOOK.skyDim);
    }
    d.stars *= LOOK.stars; d.moonVis *= LOOK.moonVis;
    return d;
  };
  const REF = lightAt(LOOK.hour);   // l'ora a cui LOOK è tarato
  let day = lightAt(clock.hour);
  const sun = new DirectionalLight("sun", day.sunDir.clone(), scene);
  sun.position = day.sunDir.scale(-400);
  const hemi = new HemisphericLight("sky", new Vector3(0, 1, 0), scene);
  hemi.groundColor = LOOK.ground;
  hemi.specular = Color3.Black();
  // foschia del bosco: il colore dell'orizzonte del cielo, appena verdastra. `fog` e `mistCol` sono
  // gli stessi oggetti per tutta la partita: chi li usa (scena, cielo, foschia a terra) li vede cambiare.
  const fog = new Color3(), mistCol = new Color3();
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = LOOK.fog;
  scene.fogColor = fog;
  const clouds = new CloudField(scene, day.sunDir, { coverage: LOOK.clouds });
  const sky = new Sky(scene, day, fog);
  // gli umori dell'ora `day` (vedi `ORE`): fra quali due si è, a che punto, quanto pesano sui numeri scalati
  let mood = { a: LOOK.notte, b: LOOK.notte, t: 0, w: 0 };
  const tune = (): void => {
    let i = 0;
    while (i < ORE.length - 2 && day.hour > ORE[i + 1][0]) i++;
    const [h0, a, w0] = ORE[i], [h1, b, w1] = ORE[i + 1], t = (day.hour - h0) / (h1 - h0);
    mood = { a: LOOK[a], b: LOOK[b], t, w: w0 + (w1 - w0) * t };
  };
  /** Una grandezza all'ora `day`: il valore scalato `f`, spostato verso quello degli umori. */
  const num = (f: number, k: "ambI" | "dens" | "mist" | "rays" | "bloom"): number => {
    const a = mood.a[k] ?? f, b = mood.b[k] ?? f;
    return f + (a + (b - a) * mood.t - f) * mood.w;
  };
  const col = (f: Color3, k: "amb" | "ground" | "fog" | "win"): Color3 => Color3.Lerp(f, Color3.Lerp(mood.a[k] ?? f, mood.b[k] ?? f, mood.t), mood.w);
  const MOON = dayLight(0).sunIntensity;                                                   // la luna piena di TimeOfDay
  const FOG_REF = lum(Color3.Lerp(REF.horizon, LOOK.fogTint, LOOK.fogMix));                // quanto è chiara la nebbia all'ora di riferimento
  /** Colori e forze della luce all'ora `day` (non la direzione del sole: quella va a scatti con le ombre, vedi `turnSun`). */
  const paint = (): void => {
    tune();
    const lit = Math.min(1, Math.max(0, (day.exposure - 0.34) / 0.66));   // 0 = notte piena, 1 = giorno
    if (day.moonlight) {   // la luna: fredda, e di TimeOfDay segue solo il salire e il calare
      sun.diffuse.copyFrom(LOOK.moon);
      sun.intensity = LOOK.moonI * day.sunIntensity / MOON;
    } else {
      sun.diffuse.set(day.sunColor.r * LOOK.sun.r / REF.sunColor.r, day.sunColor.g * LOOK.sun.g / REF.sunColor.g, day.sunColor.b * LOOK.sun.b / REF.sunColor.b);
      sun.intensity = day.sunIntensity * LOOK.sunI / REF.sunIntensity;
    }
    // il cielo è la luce che riempie le ombre del bosco: forte e azzurra, come fuori
    const floor = 0.3 + 0.7 * lit;
    hemi.diffuse = col(Color3.Lerp(day.zenith, day.horizon, 0.5).scale(0.9).add(new Color3(0.08 * floor, 0.08 * floor, 0.06 * floor)), "amb");
    hemi.intensity = num(LOOK.hemiI * day.ambientIntensity / REF.ambientIntensity, "ambI");
    hemi.groundColor = col(LOOK.ground, "ground");
    // la tinta della nebbia è tarata sul cielo dell'ora di riferimento: si scurisce con l'orizzonte
    const k = Math.min(1.3, lum(day.horizon) / lum(REF.horizon));
    fog.copyFrom(col(Color3.Lerp(day.horizon, LOOK.fogTint.scale(k), LOOK.fogMix), "fog"));
    scene.fogDensity = num(LOOK.fog, "dens");
    // la foschia a terra: la nebbia schiarita. Le falde sono particelle (colore lineare) e la nebbia è in gamma:
    // più la nebbia è scura, più vanno scurite anche loro, o di notte brillano
    const w = Math.min(1, lum(fog) / FOG_REF);
    Color3.LerpToRef(fog, new Color3(w, w, w), LOOK.mistWhite, mistCol);
    mistCol.scaleInPlace(Math.pow(w, 1.2));
    sky.moonVeil = LOOK.moonVeil;
    sky.setDay(day);
    clouds.setSun(day.sunDir, Math.min(1, day.sunIntensity));
  };
  paint();

  // ambiente per i riflessi del metallo: il cielo stesso, catturato una volta
  const probe = new ReflectionProbe("envProbe", 128, scene, true);
  probe.renderList!.push(sky.mesh);
  probe.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;

  // ── mondo ──
  const t0 = performance.now();
  const lap = (what: string): void => console.log(`[load] ${what}: ${Math.round(performance.now() - t0)} ms`);
  const terrain = createTerrain(scene);
  lap("terreno");
  terrain.mesh.material = terrainMaterial(scene, {
    grass: grassGroundTex(scene), floor: forestFloorTex(scene), dirt: dirtTex(scene), rock: rockTex(scene), moss: mossTex(scene),
    splat: terrain.splat, rect: terrain.rect,
  });
  lap("texture terreno");
  const rocks = createRocks(scene);
  lap("rocce");
  const veg = createVegetation(scene, rocks.colliders);
  lap("vegetazione");
  const town = createTown(scene, db.locations.find((l) => l.kind === "settlement")!);
  lap("città");
  // il sottosuolo (cripte e grotte del file): da qui in poi fa parte della città per tutto ciò che la riguarda — mesh che
  // fanno ombra, ostacoli, pavimenti, camere che si accendono da vicino, posti con nome
  const under = createUnderground(scene);
  town.meshes.push(...under.meshes); town.colliders.push(...under.colliders); town.floors.push(...under.floors);
  town.interiors.push(...under.interiors); Object.assign(town.plan.spots, under.spots);
  lap("sottosuolo");
  // le fiamme che città, interni e sottosuolo hanno dichiarato costruendosi: fuoco e fumo veri (flames.ts)
  const fire = createFlames(scene);
  let fireT = 0;
  // tutto ciò che ferma il passo del giocatore: massi, tronchi, muri della città e, più sotto, gli abitanti
  const solid = [...rocks.colliders, ...veg.colliders, ...town.colliders];
  // il suolo a più quote: il terreno più i pavimenti, i solai e le scale degli edifici
  const levels = new Levels(terrain.height, town.floors, PITS.map((p) => p.rect));

  // ── ombre ──
  // ⚠️ Il sole non si muove e il mondo è statico: UNA shadow map da 4096 su tutta la conca
  // (~8 cm per texel), disegnata una volta sola. Le cascate rifatte ogni frame costavano due terzi
  // del frame su una GPU integrata. Quando arriveranno cose che si muovono, servirà una cascata
  // vicina in più solo per loro.
  const shadows = new ShadowGenerator(4096, sun);
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_HIGH;
  shadows.bias = 0.0006;
  shadows.normalBias = 0.02;
  sun.autoCalcShadowZBounds = true;
  const shadowMap = shadows.getShadowMap()!;
  for (const m of [...rocks.casters, ...veg.casters, ...town.meshes]) { shadows.addShadowCaster(m, false); m.receiveShadows = true; }
  for (const m of veg.receivers) m.receiveShadows = true;
  terrain.mesh.receiveShadows = true;
  shadowMap.refreshRate = RenderTargetTexture.REFRESHRATE_RENDER_ONCE;

  // ── giocatore ──
  // il segnalino della bussola: le pietre erette finché non c'è una missione da seguire, poi la sua tappa in corso
  const marker = { x: STONES.x, z: STONES.z, label: "Le pietre erette" };
  const hud = createHud(marker);
  // dove comincia la partita (e dove si rinasce): il luogo `spawn` del file; in una radura si guarda verso le pietre
  const start = arrival(db.locations.find((l) => l.id === db.spawn)!);
  const player = new Player(scene, levels.ground, solid, probe.cubeTexture, hud, start, start.look ?? STONES);
  player.ceiling = levels.ceiling;
  const interact = new Interact(hud.prompt);
  // parlare: le righe di un abitante, una alla volta; finché il riquadro è aperto il tasto E le fa scorrere
  const dialogue = new Dialogue((on) => player.freeze(on));
  // il pannello a liste: inventario (tasto I), bottega, banco dell'oste
  const list = new ListPanel((on) => player.freeze(on));
  const busy = (): boolean => dialogue.busy || list.busy || sleep.busy;
  player.onUse = () => { if (dialogue.busy) dialogue.next(); else if (!busy()) interact.use(); };
  const doors = new Doors(town.doors, solid, interact);
  const cam = player.camera;
  const enemies = new Enemies(scene, levels.ground, [...rocks.colliders, ...veg.colliders, ...under.fences], db, (id) => under.spots[`${id}.centro`]);
  // i colpi: l'arma impugnata aggiunge il suo danno; chi muore lascia il suo bottino (dal file)
  // (e la sua esperienza; lo stesso passaggio serve al dardo delle abilità)
  const strike = (o: Vector3, d: Vector3, reach: number, dmg: number, arc: number, power: number, push: Vector3): ReturnType<Enemies["strike"]> => {
    const hits = enemies.strike(o, d, reach, dmg, arc, power, push);
    for (const h of hits) {
      const c = h.killed ? db.creatures.find((k) => k.name === h.name) : undefined;
      if (c) { gain(c.loot); earn(c.xp); }
    }
    return hits;
  };
  player.combat = { strike: (o, d, reach, dmg, arc, power, push) => strike(o, d, reach, dmg * nums.danno + danno, arc, power, push) };
  player.onDeath = () => {
    hud.setDead(true);
    setTimeout(() => { player.respawn(start, start.look ?? STONES); enemies.reset(); hud.setDead(false); }, 4000);
  };
  scene.activeCamera = cam;
  scene.setRenderingAutoClearDepthStencil(1, true, true, false);

  // foschia a terra: reagisce a chi la attraversa (vedi world/mist.ts)
  const mist = new Mist(scene, terrain.height, mistCol, LOOK.mist);
  enemies.onDust = (x, z) => { mist.gust(x, z, 0, 0, 2.4, 4.5); sfx.dust(); };
  enemies.onLand = (x, z, v) => { mist.gust(x, z, 0, 0, Math.min(4, v * 0.35), 2.6); sfx.body(Math.min(1, v / 10)); };
  // gli abitanti della città (vedi npcs.ts): il giocatore non li attraversa, e una spada vibrata a un passo li spaventa
  const npcs = new Npcs(scene, levels.ground, town.plan, db.npcs, () => clock.hour);
  // lo stato della partita e il mondo come lo vedono condizioni ed effetti del file (data/effects.ts)
  const state = new State();
  const items = new Map(db.items.map((i) => [i.id, i]));
  const world: World = { state, hour: () => clock.hour, heal: (n) => player.heal(n), name: (id) => items.get(id)?.name ?? id };
  // ciò con cui si comincia (dal file)
  state.monete = db.player.monete;
  Object.assign(state.inventory, db.player.inventory);
  for (const id of db.player.equipment) { if (!state.count(id)) state.add(id, 1); state.mano = id; }
  /** Ciò che si impugna dà l'aspetto alla lama e il danno in più a ogni colpo. */
  const wield = (): number => {
    const e = state.mano ? items.get(state.mano)!.equip! : null;
    swordLook(scene, e?.look ?? "ferro");
    return e?.stats.danno ?? 0;
  };
  let danno = wield();
  /** Qualcosa entra nell'inventario (bottino, forziere): lo dice una riga a schermo. */
  const gain = (bag: Record<string, number>): void => {
    for (const [id, n] of Object.entries(bag)) { state.add(id, n); hud.notice(`+ ${amount(id, n, world)}`); }
  };

  const say = (n: Npc, lines: string[], then?: () => void): void => {
    n.speak(true);
    dialogue.open(n.def.name, lines, () => { n.speak(false); then?.(); });
  };
  // un abitante reagisce a qualcosa: la prima interazione del file che vale; se gli si parla e nessuna vale, il dialogo di
  // tutti i giorni; finito di parlare, chi ha qualcosa da offrire (bottega aperta, una camera) lo mostra
  const reactTo = (n: Npc, on: "talk" | "hit"): void => {
    if (busy()) return;
    const lines = react(n.def.id, n.def.interactions, on, world) ?? (on === "talk" ? n.def.dialogue : null);
    if (lines?.length) say(n, lines, on === "talk" ? () => serve(n) : undefined);
    else if (on === "talk") serve(n);
  };
  const npcOf = new Map<object, Npc>();
  for (const n of npcs.list) {
    const u = {
      get x() { return n.pos.x; }, get y() { return n.pos.y + 1.4; }, get z() { return n.pos.z; },
      label: () => (n.asleep || busy() ? null : "Parla"), use: () => reactTo(n, "talk"),
    };
    interact.list.push(u); npcOf.set(u, n);
  }

  // ── oggetti: inventario, botteghe, forzieri (cosa esiste, quanto vale e cosa fa lo dice il file) ──
  // ── il personaggio: classe, statistiche, abilità, esperienza (le regole stanno in data/character.ts, i dati nel file) ──
  const classes = new Map(db.classes.map((c) => [c.id, c])), skills = new Map(db.skills.map((k) => [k.id, k]));
  let nums: Tune, known: string[] = [], casts: SkillDef[] = [];
  /** Ricalcola ciò che le statistiche sbloccano e i numeri che ne vengono, e li passa al gioco. */
  const retune = (announce = true): void => {
    const before = known;
    known = unlocked(classes.get(state.classe ?? ""), state.stats);
    const got = known.map((id) => skills.get(id)!);
    if (announce) for (const k of got) if (!before.includes(k.id)) hud.notice(`Nuova abilità: ${k.name}`);
    nums = derive(state.stats, got.filter((k) => k.kind === "passive"));
    casts = got.filter((k) => k.kind === "active");
    Object.assign(player.tune, { cost: nums["costo.colpo"], block: nums["costo.parata"], speed: nums.passo, resist: nums.resistenza });
    state.magicka = Math.min(state.magicka, nums["magicka.max"]);
  };
  retune(false);
  state.magicka = nums!["magicka.max"];
  const pick = (id: string): void => {
    state.classe = id; Object.assign(state.stats, classes.get(id)!.stats);
    retune(false);
    state.magicka = nums["magicka.max"];
  };
  /** Esperienza: a ogni livello dei punti da spendere nelle statistiche (scheda del personaggio, tasto C). */
  const earn = (xp: number): void => {
    state.xp += xp;
    for (let n = need(state.level, db.levels.xp); state.xp >= n; n = need(state.level, db.levels.xp)) {
      state.xp -= n; state.level++; state.points += db.levels.points;
      hud.notice(`Livello ${state.level}: ${db.levels.points} punti da spendere (C)`);
    }
  };
  // la scelta della classe, la prima volta che si entra in gioco: non si chiude finché non si è scelto
  const choose = (): void => list.open("Scegli chi sei", () => "la classe dà le statistiche di partenza e le abilità che si possono imparare", [{
    name: "Classi", empty: "",
    rows: () => db.classes.map((c) => ({ label: c.name, note: c.text, run: () => { pick(c.id); list.close(); } })),
  }], () => { if (!state.classe) setTimeout(choose, 0); });
  document.addEventListener("pointerlockchange", () => { if (document.pointerLockElement === canvas && !state.classe && !list.busy) choose(); });
  // la scheda (tasto C): le statistiche, dove si spendono i punti, e l'albero delle abilità della classe
  const MEANS: Record<typeof STATS[number], string> = {
    forza: "il danno dei colpi", destrezza: "meno vigore per colpire, passo più svelto", costituzione: "meno danno ricevuto, parate meno care",
    intelligenza: "più magicka", saggezza: "la magicka torna prima", carisma: "prezzi migliori",
  };
  const cap = (s: string): string => s[0].toUpperCase() + s.slice(1);
  addEventListener("keydown", (e) => {
    if (e.repeat || !player.locked || !player.alive || busy()) return;
    const cls = classes.get(state.classe ?? "");
    if (e.code === "KeyC" && cls) {
      list.open("Personaggio", () => `${cls.name} · livello ${state.level} · esperienza ${state.xp} / ${need(state.level, db.levels.xp)} · ${state.points} ${state.points === 1 ? "punto" : "punti"} da spendere`, [{
        name: "Statistiche", empty: "",
        rows: () => STATS.map((s) => ({ label: cap(s), note: MEANS[s], right: `${state.stats[s]}${state.points ? "  +" : ""}`, run: state.points ? () => { state.stats[s]++; state.points--; retune(); } : undefined })),
      }, {
        name: "Abilità", empty: "Questa classe non ha abilità.",
        rows: () => cls.skillTree.map((n) => {
          const k = skills.get(n.skill)!, has = known.includes(k.id), need2 = [`${n.stat} ${n.level}`, ...n.requires.map((q) => skills.get(q)!.name)].join(", ");
          return { label: k.name, note: k.text, right: !has ? `serve ${need2}` : k.kind === "active" ? `tasto ${casts.indexOf(k) + 1} · ${k.cost!.magicka} magicka` : "passiva", run: has ? () => {} : undefined };
        }),
      }]);
    }
    // le abilità attive: i tasti 1, 2… nell'ordine dell'albero
    const k = /^Digit[1-9]$/.test(e.code) ? casts[Number(e.code.slice(5)) - 1] : undefined;
    if (!k) return;
    if (state.magicka < k.cost!.magicka) { hud.notice("Magicka insufficiente"); return; }
    state.magicka -= k.cost!.magicka;
    if (k.effect!.cast === "cura") { player.heal(k.effect!.power); hud.notice(k.name); return; }
    // il dardo: colpisce chi si ha davanti, fino a 18 m; a schermo una scintilla che parte dalla mano
    const yaw = cam.rotation.y, dir = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const hits = strike(player.position, dir, 18, k.effect!.power, 0.97, 1, dir.scale(4).add(new Vector3(0, 2.5, 0)));
    if (hits.length) hud.hitMarker(hits.some((h) => h.killed));
    bolt.from.copyFrom(cam.position).addInPlace(dir.scale(0.7)).addInPlaceFromFloats(0, -0.25, 0);
    bolt.to.copyFrom(hits[0]?.point ?? cam.position.add(dir.scale(18)));
    bolt.t = 0; bolt.mesh.setEnabled(true);
    sfx.whoosh();
  });
  // (⚠️ HDR: un emissivo pieno diventa una lampadina; questo passa appena la soglia del bloom)
  const boltMat = new StandardMaterial("bolt", scene);
  boltMat.disableLighting = true; boltMat.fogEnabled = false; boltMat.emissiveColor = new Color3(0.45, 0.7, 1.25);
  const bolt = { mesh: MeshBuilder.CreateSphere("bolt", { diameter: 0.16, segments: 6 }, scene), from: new Vector3(), to: new Vector3(), t: 1 };
  bolt.mesh.material = boltMat; bolt.mesh.isPickable = false; bolt.mesh.setEnabled(false);

  // ── missioni: avanzano da sé (data/effects.ts); qui il diario (tasto J), la riga a schermo e il segnalino sulla bussola ──
  const journal = (): void => {
    // (quattro volte al secondo, con le luci) le missioni che si sono mosse lo dicono; la prima in corso è quella seguita
    for (const m of advance(db.quests, world)) hud.notice(m.over ? `Missione conclusa: ${m.quest.name}` : `${m.quest.name}: ${stage(m.quest, state)!.text}`);
    const q = db.quests.find((k) => stage(k, state)), st = q && stage(q, state);
    hud.quest(q?.name ?? null, st?.text);
    const who = st?.npc ? npcs.list.find((n) => n.def.id === st.npc) : undefined, spot = st?.at ? town.plan.spots[st.at] : undefined;
    marker.x = who?.pos.x ?? spot?.x ?? STONES.x; marker.z = who?.pos.z ?? spot?.z ?? STONES.z;
  };
  for (const [i, q] of db.quests.entries()) for (const [j, s] of q.stages.entries()) {
    if (s.at && !town.plan.spots[s.at]) throw new DbError(`db.json.quests[${i}].stages[${j}].at: il posto "${s.at}" non esiste`);
  }
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyJ" || e.repeat || !player.locked || !player.alive || busy()) return;
    const rows = (over: boolean) => () => db.quests.filter((q) => q.id in state.quests && !stage(q, state) === over).map((q) => ({ label: q.name, note: over ? "conclusa" : stage(q, state)!.text, run: () => {} }));
    list.open("Diario", coins, [{ name: "In corso", empty: "Nessuna missione in corso.", rows: rows(false) }, { name: "Concluse", empty: "Ancora nessuna.", rows: rows(true) }]);
  });

  // ── salvataggio (localStorage): lo stato, l'ora e dove sta chi gioca; dal menu, e da solo quando ci si sveglia ──
  const KEY = "sidequest.save";
  const save = (): void => {
    const p = player.position;
    localStorage.setItem(KEY, JSON.stringify({ v: SAVE, state: state.save(), clock: { day: clock.day, hour: clock.hour }, player: { x: p.x, y: p.y, z: p.z, yaw: cam.rotation.y, life: player.life } }));
    hud.notice("Partita salvata");
  };
  /** Carica il salvataggio, se c'è ed è di questa versione: dice se l'ha fatto. */
  const load = (): boolean => {
    let d: { v: number; state: Record<string, unknown>; clock: { day: number; hour: number }; player: { x: number; y: number; z: number; yaw: number; life: number } } | null = null;
    try { d = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* un salvataggio illeggibile vale come nessuno */ }
    if (!d || d.v !== SAVE) return false;
    state.load(d.state);
    clock.day = d.clock.day; clock.hour = d.clock.hour;
    player.teleport(d.player, { x: d.player.x + Math.sin(d.player.yaw), z: d.player.z + Math.cos(d.player.yaw) });
    player.position.y = d.player.y;   // (dentro un edificio o sotto terra: la quota dice a che piano)
    player.life = d.player.life;
    retune(false); danno = wield();
    return true;
  };

  const hint = (it: ItemDef): string => (it.kind === "weapon" ? (it.equip!.stats.danno ? `+${it.equip!.stats.danno} al danno` : "arma") : it.kind === "consumable" ? "si usa" : "");
  const many = (it: ItemDef, n: number): string => it.name + (n > 1 ? ` × ${n}` : "");
  /** Usa un oggetto: un'arma si impugna o si ripone; il resto si porge a chi si ha davanti (`on`) e, se lui non reagisce, fa il suo effetto su di sé. */
  const useItem = (it: ItemDef, on: Npc | null): void => {
    if (it.kind === "weapon") { state.mano = state.mano === it.id ? null : it.id; danno = wield(); return; }
    const lines = on ? react(on.def.id, on.def.interactions, `use:${it.id}`, world) : null;
    if (lines) { list.close(); say(on!, lines); return; }   // l'abitante reagisce: se l'oggetto si consuma lo dice la sua interazione (`take`)
    state.add(it.id, -1);
    hud.notice(`Usi ${it.name}`);
    for (const l of run(it.use!, world)) hud.notice(l.replace(/^\[|\]$/g, ""));
  };
  const coins = (): string => `${state.monete} monete`;
  addEventListener("keydown", (e) => {
    if (e.code !== "KeyI" || e.repeat || !player.locked || !player.alive || busy()) return;
    const on = npcOf.get(interact.current ?? {}) ?? null;   // chi si ha davanti: a lui si porgono gli oggetti
    list.open("Inventario", coins, [{
      name: "Oggetti", empty: "Non hai niente.",
      rows: () => Object.entries(state.inventory).map(([id, n]) => {
        const it = items.get(id)!, held = state.mano === id;
        return {
          label: many(it, n), note: held ? "impugnata" : hint(it),
          right: it.kind === "weapon" ? (held ? "riponi" : "impugna") : it.kind === "consumable" ? (on ? `porgi a ${on.def.name}` : "usa") : "",
          run: it.kind === "misc" ? undefined : () => useItem(it, on),
        };
      }),
    }]);
  });
  /** Ciò che un abitante offre dopo aver parlato: la bottega (se è l'ora), una camera per dormire. */
  const serve = (n: Npc): void => {
    const sv = n.def.services, pages: Page[] = [];
    if (sv.shop && test({ hour: sv.shop.hours }, world)) {
      pages.push({
        name: "Compra", empty: "Non ha niente da vendere.",
        rows: () => sv.shop!.items.map((id) => {
          const it = items.get(id)!, price = Math.max(1, Math.round(it.value * nums.prezzi));   // il carisma fa lo sconto
          return { label: it.name, note: hint(it), right: `${price} monete`, run: state.monete >= price ? () => { state.add("monete", -price); state.add(id, 1); } : undefined };
        }),
      }, {
        name: "Vendi", empty: "Non hai niente da vendere.",
        rows: () => Object.entries(state.inventory).filter(([id]) => id !== state.mano).map(([id, k]) => {
          const it = items.get(id)!, price = Math.floor(it.value / 2);
          return { label: many(it, k), right: `${price} monete`, run: () => { state.add(id, -1); state.add("monete", price); } };
        }),
      });
    }
    if (sv.rest) {
      const cost = sv.rest.cost;
      pages.push({
        name: "Riposo", empty: "",
        rows: () => [{ label: "Una camera per dormire", note: "scegli tu quando svegliarti", right: `${cost} monete`, run: state.monete >= cost ? () => { state.add("monete", -cost); list.close(); sleep.show(); } : undefined }],
      });
    }
    if (!pages.length) return;
    n.speak(true);
    list.open(n.def.name, coins, pages, () => n.speak(false));
  };
  // i forzieri: stanno in un posto con nome, si aprono una volta e danno ciò che contengono
  for (const [i, c] of db.containers.entries()) {
    const s = town.plan.spots[c.at];
    if (!s) throw new DbError(`db.json.containers[${i}].at: il posto "${c.at}" non esiste`);
    interact.list.push({
      x: s.x, y: (s.y ?? terrain.height(s.x, s.z)) + 0.6, z: s.z,
      label: () => (state.opened.has(c.id) || busy() ? null : `Apri ${c.name}`),
      use: () => { state.opened.add(c.id); gain({ ...c.items, ...(c.monete ? { monete: c.monete } : {}) }); },
    });
  }
  solid.push(...npcs.colliders);
  npcs.indoor = interiorLight;   // chi sta dentro un edificio prende la luce di dentro
  player.onGust = (x, z, dx, dz, str) => { mist.gust(x, z, dx, dz, str, 3.6); const n = npcs.scare(x, z); if (n) reactTo(n, "hit"); };
  mist.covered = levels.covered;
  const movers: Mover[] = [];

  // erba lontana spenta: sotto la nebbia non si vede, e costa
  let grassDist = 70;
  const near = (m: Mesh, d: number): boolean => {
    const b = m.getBoundingInfo().boundingSphere;
    return Math.hypot(b.centerWorld.x - cam.position.x, b.centerWorld.z - cam.position.z) - b.radiusWorld < d;
  };
  scene.onBeforeRenderObservable.add(() => {
    for (const g of veg.grass) g.setEnabled(near(g, grassDist));
  });

  // ── post-processing: HDR, ACES, bloom, AO, raggi di luce ──
  const pipe = new DefaultRenderingPipeline("post", true, scene, [cam]);
  pipe.samples = 4;
  pipe.fxaaEnabled = false;
  pipe.bloomEnabled = true;
  pipe.bloomThreshold = LOOK.bloomThreshold;
  pipe.bloomWeight = LOOK.bloomWeight;
  pipe.bloomKernel = 64;
  pipe.bloomScale = 0.5;
  pipe.imageProcessingEnabled = true;
  const ip = pipe.imageProcessing;
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
  ip.exposure = LOOK.exposure;
  ip.contrast = LOOK.contrast;
  if (LOOK.saturation) {
    ip.colorCurvesEnabled = true;
    ip.colorCurves = new ColorCurves();
    ip.colorCurves.globalSaturation = LOOK.saturation;
  }
  ip.vignetteEnabled = true;
  ip.vignetteWeight = LOOK.vignette;
  ip.vignetteColor = new Color4(0.05, 0.04, 0.02, 0);
  ip.vignetteStretch = 0.4;
  pipe.grainEnabled = true;
  pipe.grain.intensity = LOOK.grain;
  pipe.grain.animated = true;
  pipe.sharpenEnabled = LOOK.sharpen > 0;
  pipe.sharpen.edgeAmount = LOOK.sharpen;

  const ssao = new SSAO2RenderingPipeline("ssao", scene, { ssaoRatio: 0.5, blurRatio: 1 }, [cam]);
  ssao.radius = 1.6;
  ssao.totalStrength = 1.1;
  ssao.base = 0.15;
  ssao.samples = 16;
  ssao.maxZ = 120;
  ssao.expensiveBlur = true;

  // il sole come disco lontano: sorgente dei raggi che filtrano fra le chiome
  const sunDisc = MeshBuilder.CreateDisc("sunDisc", { radius: 17, tessellation: 32 }, scene);
  sunDisc.billboardMode = Mesh.BILLBOARDMODE_ALL;
  const sm = new StandardMaterial("sunDiscMat", scene);
  const sunDiscCol = LOOK.sun.multiply(new Color3(2.2, 2.15, 1.95));
  sm.emissiveColor = sunDiscCol.clone(); sm.disableLighting = true; sm.fogEnabled = false;
  sunDisc.material = sm;
  sunDisc.applyFog = false;
  sunDisc.isPickable = false;
  const vls = new VolumetricLightScatteringPostProcess("godrays", 0.5, cam, sunDisc, 90, Texture.BILINEAR_SAMPLINGMODE, engine, false);
  vls.exposure = 0.18;
  vls.decay = 0.965;
  vls.weight = LOOK.rays;
  vls.density = 0.92;
  // gli interni non fanno ombra ai raggi (sono già dentro i muri): fuori dal secondo disegno
  vls.excludedMeshes.push(sky.mesh, ...veg.grass, ...player.viewmodelMeshes, ...town.interiors.flatMap((i) => i.meshes), ...fire.meshes);
  scene.onBeforeRenderObservable.add(() => sunDisc.position.copyFrom(cam.position).addInPlace(day.sunDir.scale(-600)));

  // pulviscolo e pollini che galleggiano attorno a chi guarda: si accendono nei raggi di sole
  const motes = new ParticleSystem("motes", 400, scene);
  const mt = new DynamicTexture("moteTex", 32, scene, false);
  const mctx = mt.getContext() as CanvasRenderingContext2D;
  const grad = mctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  mctx.fillStyle = grad; mctx.fillRect(0, 0, 32, 32); mt.hasAlpha = true; mt.update();
  motes.particleTexture = mt as unknown as Texture;
  motes.emitter = cam.position;
  motes.createBoxEmitter(new Vector3(-0.2, -0.05, -0.2), new Vector3(0.2, 0.05, 0.2), new Vector3(-14, -2, -14), new Vector3(14, 6, 14));
  motes.minSize = 0.015; motes.maxSize = 0.04;
  motes.minLifeTime = 6; motes.maxLifeTime = 12;
  motes.emitRate = LOOK.motes;
  motes.minEmitPower = 0.02; motes.maxEmitPower = 0.1;
  motes.color1 = new Color4(1, 0.92, 0.7, 0.55); motes.color2 = new Color4(0.9, 0.95, 0.75, 0.35); motes.colorDead = new Color4(1, 1, 1, 0);
  motes.blendMode = ParticleSystem.BLENDMODE_ADD;
  motes.gravity = new Vector3(0.05, -0.01, 0.03);
  motes.renderingGroupId = 0;
  motes.preWarmCycles = 200;
  motes.start();

  // ── l'ora diventa luce ──
  // ⚠️ La shadow map è una sola e si disegna a richiesta: la DIREZIONE del sole perciò non scorre, va a
  // scatti di `shadowStep` gradi, e a ogni scatto la mappa si ridisegna (se scorresse, le ombre
  // verrebbero lette con una matrice che non è quella con cui sono state disegnate). Colori e cielo scorrono.
  let shadowStep = 2;
  const turnSun = (force: boolean): void => {
    const turned = Math.acos(Math.min(1, Vector3.Dot(sun.direction, day.sunDir))) * 180 / Math.PI;
    if (!force && turned < shadowStep) return;
    sun.direction.copyFrom(day.sunDir);
    sun.position = day.sunDir.scale(-400);
    shadowMap.resetRefreshCounter();
    probe.cubeTexture.resetRefreshCounter();   // e il cielo dei riflessi
  };
  const lumeCol = town.lumi.finestre.emissiveColor.clone();
  const setHour = (force = false): void => {
    day = lightAt(clock.hour);
    paint();
    turnSun(force);
    const sunUp = day.moonlight ? 0 : Math.min(1, day.sunIntensity / REF.sunIntensity);   // quanto sole c'è
    vls.weight = num(LOOK.rays * sunUp, "rays");
    Color3.LerpToRef(day.horizon, sunDiscCol, sunUp, sm.emissiveColor);
    sunDisc.isVisible = sunUp > 0.02;
    motes.emitRate = LOOK.motes * (0.15 + 0.85 * sunUp);
    pipe.bloomWeight = num(LOOK.bloomWeight, "bloom");
    mist.alpha = num(LOOK.mist, "mist");
    // i lumi: di giorno appena accesi; la sera prima le finestre, poi (passa il lampionaio) le lanterne con la loro
    // pozza di luce sulla strada, piene all'ora blu. Le fiamme (candele, focolari, forgia) sono un altro materiale: sempre accese.
    const fin = Math.min(1, day.glow * 1.6), lam = Math.min(1, Math.max(0, (day.glow - 0.15) / 0.6));
    town.lumi.finestre.emissiveColor = lumeCol.scale(LOOK.lumeDay + (1 - LOOK.lumeDay) * fin);
    Color3.LerpToRef(lumeCol.scale(LOOK.lumeDay), LOOK.lamp, lam, town.lumi.lanterne.emissiveColor);
    setLampGlow(lam);
    // dentro: dalle finestre entra il giorno, l'arancio del tramonto, il blu della luna
    setInteriorDaylight(col(new Color3(sunUp, sunUp, sunUp), "win"));
  };
  setHour(true);

  // dormire: ogni posto che finisce per ".letto" è un letto in cui ci si corica (tasto E), scegliendo quando svegliarsi
  const homeLit = new Map<string, number>();
  const sleep = new Sleep(clock, db.time.wake, { freeze: (on) => player.freeze(on), woke: () => { player.rest(); setHour(true); npcs.settle(); save(); } });
  // il menu: salva, carica, ricomincia; e all'avvio si riprende da dove si era
  const saved = (): boolean => localStorage.getItem(KEY) !== null, loadBtn = document.getElementById("save-load") as HTMLButtonElement;
  const resume = (): void => { if (load()) { setHour(true); npcs.settle(); hud.notice("Partita caricata"); } loadBtn.disabled = !saved(); };
  document.getElementById("save-now")!.addEventListener("click", () => { save(); loadBtn.disabled = false; });
  loadBtn.addEventListener("click", resume);
  document.getElementById("save-new")!.addEventListener("click", (e) => { e.stopPropagation(); localStorage.removeItem(KEY); location.reload(); });
  resume();
  for (const [name, s] of Object.entries(town.plan.spots)) {
    if (name.endsWith(".letto")) interact.list.push({ x: s.x, y: (s.y ?? terrain.height(s.x, s.z)) + 0.6, z: s.z, label: () => (sleep.busy ? null : "Dormi"), use: () => sleep.show() });
  }

  // la luce vera delle fiamme vicine (flames.ts): le fanno ombra la città e gli abitanti; il vetro delle lanterne lascia vedere la fiammella
  const fireLights = createFlameLights(scene, [...town.meshes, ...npcs.list.map((n) => n.h.mesh)]);
  town.lumi.lanterne.alpha = 0.45;
  createGraphicsSettings({ scene, engine, camera: cam, pipeline: pipe, ssao, godrays: vls, shadowMap, mist, flameLights: fireLights }, (g) => { grassDist = g.grass; shadowStep = g.shadowStep; });

  // viaggio rapido dal menu: una voce per ogni luogo del file che ha un nome (il clic poi riprende il gioco, come ogni clic sul menu)
  const travel = document.getElementById("travel")!;
  for (const l of db.locations) {
    if (!l.name) continue;
    const b = travel.appendChild(document.createElement("button"));
    b.textContent = l.name;
    b.addEventListener("click", () => { const a = arrival(l); player.teleport(a, a.look ?? STONES); });
  }

  document.getElementById("overlay")!.addEventListener("click", () => canvas.requestPointerLock());

  await photosReady();   // le texture fotografiche col loro rilievo (textures.ts)
  await scene.whenReadyAsync();
  lap("shader pronti");
  // riscaldamento: TUTTO il mondo disegnato qualche volta adesso, col caricamento ancora a schermo — anche ciò che sta fuori
  // dall'inquadratura, è spento perché lontano (abitanti, interni) o entra in scena solo più tardi (gli interni, le facce di
  // fuori dei battenti). La scheda video traduce davvero uno shader solo la prima volta che lo disegna: senza questo, ogni
  // materiale mai visto prima (un interno alla prima porta aperta, i teli del mercato girandosi, un lupo) bloccava il gioco
  // anche per mezzo secondo, soprattutto con l'occlusione ambientale, che di ogni mesh disegna anche la geometria.
  {
    const leaves = town.meshes.filter((m) => !scene.meshes.includes(m));
    warmInteriors(true);
    for (const m of leaves) scene.addMesh(m);
    const off = [...scene.meshes, ...scene.transformNodes].filter((n) => !n.isEnabled(false));
    for (const n of off) n.setEnabled(true);
    const forced = scene.meshes.filter((m) => !m.alwaysSelectAsActiveMesh);
    for (const m of forced) m.alwaysSelectAsActiveMesh = true;
    // più frame, con una pausa fra l'uno e l'altro: gli shader si compilano in parallelo, e finché uno non è pronto la sua mesh viene saltata
    // (si smette quando due frame di fila tornano svelti: non c'è più niente da compilare)
    for (let i = 0, quick = 0; i < 14 && quick < 2; i++) {
      const t = performance.now();
      scene.render();
      const took = performance.now() - t;
      quick = took < 200 ? quick + 1 : 0;
      if (import.meta.env.DEV) console.log(`[load] riscaldamento, frame ${i}: ${Math.round(took)} ms, shader ${Object.keys((engine as unknown as { _compiledEffects: object })._compiledEffects).length}`);
      await new Promise((r) => setTimeout(r, 25));
    }
    for (const m of forced) m.alwaysSelectAsActiveMesh = false;
    for (const n of off) n.setEnabled(false);
    for (const m of leaves) scene.removeMesh(m);
    warmInteriors(false);
  }
  lap("riscaldamento");
  shadowMap.resetRefreshCounter();   // la shadow map si disegna ora che tutti i materiali sono compilati
  probe.cubeTexture.resetRefreshCounter();   // e il cielo per i riflessi, ora che il suo shader è pronto
  hud.ready();
  let lightWait = 0;
  engine.runRenderLoop(() => {
    const dt = engine.getDeltaTime() / 1000;
    // il tempo scorre solo mentre si gioca (non nel menu di pausa); la luce si aggiorna quattro volte al secondo
    if (player.locked) clock.update(Math.min(dt, 0.1));
    if ((lightWait -= dt) <= 0) {
      lightWait = 0.25; setHour();
      hud.magicka(state.magicka / nums["magicka.max"]);
      journal();
      // le finestre di una casa sono accese se qualcuno che ci abita è dentro e sveglio; si accendono e si spengono in mezzo secondo
      town.windows((id) => {
        const v = homeLit.get(id) ?? 0, to = npcs.list.some((n) => n.def.home === id && n.atHome) ? 1 : 0, next = v + Math.max(-0.5, Math.min(0.5, to - v));
        homeLit.set(id, next);
        return next;
      });
    }
    player.update(dt);
    // il fumo è chiaro di giorno e quasi nero di notte
    fireLights.update(dt, fireT + dt, cam.position);
    fire.update(fireT += dt, 0.22 + 0.78 * Math.max(0, Math.min(1, Math.sin((clock.hour - 5.5) / 13 * Math.PI) * 1.6)));
    if (player.locked) state.magicka = Math.min(nums["magicka.max"], state.magicka + nums["magicka.rec"] * dt);
    if (bolt.t < 1) {   // la scintilla del dardo vola dalla mano al bersaglio in un decimo di secondo e mezzo
      bolt.t = Math.min(1, bolt.t + dt / 0.15);
      Vector3.LerpToRef(bolt.from, bolt.to, bolt.t, bolt.mesh.position);
      if (bolt.t >= 1) bolt.mesh.setEnabled(false);
    }
    enemies.update(dt, player);
    npcs.update(dt, player.position);
    doors.update(dt, npcs.list, player.position);
    if (dialogue.busy || list.busy) hud.prompt(null); else interact.update(cam.position, cam.rotation.y);
    // gli interni si disegnano solo da vicino (da quanto, lo dice il dettaglio scelto nelle impostazioni)
    const reach = interiorReach();
    for (const i of town.interiors) {
      const on = Math.hypot(cam.position.x - i.x, cam.position.z - i.z) < i.r * reach;
      if (i.meshes[0]?.isEnabled() !== on) for (const m of i.meshes) m.setEnabled(on);
    }
    movers.length = 0;
    movers.push({ x: player.position.x, z: player.position.z, vx: player.velocity.x, vz: player.velocity.z, r: 0.7 });
    enemies.movers(movers);
    npcs.movers(movers);
    mist.update(dt, cam.position, movers);
    hud.enemy(player.alive ? enemies.nearestHostile(player.position) : null);
    scene.render();
  });
  addEventListener("resize", () => engine.resize());
  if (import.meta.env.DEV) {
    Object.assign(window, { scene, player, enemies, npcs, levels, solid, clock, setHour, sleep, town, state, dialogue, list, interact, pick, earn, choose, retune, save, load: resume, fireLights, marker: () => marker, tuneNow: () => nums, checkPlan: () => checkPlan(town, levels.ground) });   // debug da console
    // il controllo della rete degli abitanti (percorsi sgombri, posti raggiungibili): a ogni avvio in sviluppo
    const bad = checkPlan(town, levels.ground);
    if (bad.length) console.warn(`[posti] ${bad.length} problemi nella rete degli abitanti:\n  ${bad.join("\n  ")}`);
    // dove si è, per scrivere db.json: coordinate del mondo e, in città, locali alla città. F2 le copia.
    const where = document.createElement("div");
    where.style.cssText = "position:fixed;left:10px;bottom:10px;font:12px monospace;color:#d8cfb8;text-shadow:0 0 4px #000;pointer-events:none";
    document.body.appendChild(where);
    let xz = "";
    setInterval(() => {
      const p = player.position;
      xz = `${p.x.toFixed(1)}, ${p.z.toFixed(1)}`;
      where.textContent = `${clock.label()} · x, z: ${xz} · quota ${p.y.toFixed(1)}` + (townDist(p.x, p.z) < 30 ? ` · città: ${(p.x - TOWN.x).toFixed(1)}, ${(p.z - TOWN.z).toFixed(1)}` : "");
    }, 200);
    addEventListener("keydown", (e) => { if (e.code === "F2") void navigator.clipboard.writeText(`[${xz}]`); });
  }
}

main();
