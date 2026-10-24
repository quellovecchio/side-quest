# Side Quest

RPG 3D in prima persona fortemente ispirato a The Elder Scrolls (look & feel alla Skyrim: bussola in alto, barre magicka/salute/vigore, spada e scudo in vista). Gira nel browser su **BabylonJS 7** (TypeScript + Vite).

Stato attuale: **demo** — una conca boscosa di 320 m con radura, pietre erette, sentiero, abeti, latifoglie, felci, erba, massi e tronchi caduti; giocatore con spada e scudo che salta, attacca (combo a due fendenti) e para.

## Comandi

- `npm run dev` — server di sviluppo (porta 5180 da `.claude/launch.json`)
- `npm run build` — type-check + build di produzione

## Struttura

- `src/main.ts` — engine, luci, cielo, mondo, ombre, post-processing, loop
- `src/sky/` — **cielo portato da footie-stars** (`Sky.ts`, `Clouds.ts`, `TimeOfDay.ts`): shader procedurale con nuvole in movimento. `palette.ts` sostituisce i token CSS di footie-stars con una tabella di valori. `Clouds.ts` e `TimeOfDay.ts` sono copie identiche: tenerle allineate all'originale se lo si migliora là.
- `src/world/` — tutto procedurale, niente file di asset:
  - `noise.ts` rumore deterministico (anche periodico per le texture tileable)
  - `textures.ts` texture generate all'avvio (albedo + normal map con l'altezza nell'alfa)
  - `materials.ts` materiali `PBRCustomMaterial` con shader iniettati (terreno a splat, roccia triplanare con muschio, vento)
  - `terrain.ts` heightfield, sentiero, densità del bosco, splat map
  - `vegetation.ts` / `rocks.ts` generazione delle specie e piazzamento
  - `geo.ts` builder di mesh, tubi, carte di fogliame e `scatter` (istanze sottili a chunk)
- `src/player/` — controller in prima persona (`Player.ts`) ed equipaggiamento procedurale (`equipment.ts`)
- `src/hud.ts` — HUD DOM; `src/settings.ts` — impostazioni grafiche nel menu di pausa

## Database JSON (in arrivo)

Personaggi, interazioni notevoli, oggetti e quest verranno caricati da un database JSON, con un sistema già realizzato dall'utente per un altro progetto e da importare più avanti. Finché non arriva, niente dati hardcoded "provvisori" nel codice di gioco: aspettare quel sistema.

## Decisioni e trappole (lette a caro prezzo)

- **Impostazioni grafiche**: gli effetti costosi (SSAO, raggi di luce, MSAA, ombre, bloom, distanza dell'erba, risoluzione) non si rimuovono per guadagnare prestazioni: vanno dietro un selettore in `settings.ts`, con i preset.
- **Ombre statiche**: sole fisso e mondo statico → una shadow map da 4096 su tutta la conca, disegnata una volta (`REFRESHRATE_RENDER_ONCE`, poi `resetRefreshCounter()` a shader pronti). Le cascate ogni frame costavano due terzi del frame sulla iGPU. Oggetti in movimento richiederanno una cascata vicina dedicata.
- **`scatter` e `makeGeometryUnique()`**: Babylon tiene i buffer delle istanze sottili sulla *geometria*; i cloni con geometria condivisa si sovrascrivono a vicenda (si vedeva un solo chunk).
- **Uniform in `PBRCustomMaterial`**: impostarle in `AttachAfterBind(mesh, effect)`, non con `onBindObservable` + `getEffect()` (effect sbagliato → uniform a zero).
- **Niente `subSurface` translucency** sul fogliame: senza mappa di spessore sbianca tutto come neve.
- **Colori lineari**: albedo e colori per vertice sono in spazio lineare nel PBR; un colore scelto "a occhio" in sRGB esce troppo scuro. L'erba sta fra ~0,03 e 0,2.
- **Input**: usare `pointerdown`/`pointerup`, non `mousedown`: Babylon fa `preventDefault` sul pointerdown e il browser sopprime i mouse event.
- **GPU**: l'engine chiede `powerPreference: "high-performance"`. Sul portatile dell'utente il pannello browser dell'app usa la Intel integrata (~20 fps in "Alto"), Chrome la RTX 5070 (~190 fps).
- Commenti e testi di gioco in italiano.
