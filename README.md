# Side Quest

RPG 3D in prima persona, dark fantasy, che gira nel browser. Un mondo solo e senza caricamenti: una conca boscosa, una
strada che taglia il crinale e una piccola città murata con i suoi abitanti, i suoi interni e il suo sottosuolo.

È una **demo**: serve a provare il combattimento, la vita della città, gli interni e la resa grafica.

## Avvio

Serve Node.js (provato con la 22).

```bash
npm install
```

```bash
npm run dev
```

Il gioco risponde su `http://localhost:5173` (o sulla porta 5180 se lanciato da `.claude/launch.json`). Conviene un
browser che usi la scheda video dedicata: sul portatile di sviluppo la differenza è da 20 a 190 fotogrammi al secondo.

## Comandi

| Comando | Cosa fa |
|---|---|
| `npm run dev` | server di sviluppo (Vite) |
| `npm run build` | controllo dei tipi (`tsc --noEmit`) e build di produzione in `dist/` |
| `npm run check` | controlla `public/data/db.json`, le piante degli interni e l'allineamento delle finestre |
| `node src/world/vetri.check.mjs` | il solo controllo delle finestre |
| `node docs/reference/citta/tavole.mjs` | rigenera le tavole vettoriali di riferimento |
| `http://localhost:5173/?editor` | l'editor della mappa (solo in sviluppo; anche dal menu di pausa): vedi [docs/editor.md](docs/editor.md) |
| `blender --background --python tools/blender/kit.py` | rigenera il kit di pezzi (`public/kit/kit.json`) |
| `blender --background --python tools/blender/teste.py` | rigenera le teste degli abitanti (`public/kit/teste.json`) |

Non c'è una suite di test: le verifiche automatiche sono `build` e `check`; la resa si verifica guardando il gioco.

## Tasti

| Tasto | Azione |
|---|---|
| W A S D, mouse | muoversi e guardare |
| Shift | correre |
| E | usare ciò che si ha davanti (parlare, aprire, dormire, accendere), proseguire un dialogo |
| I | inventario |
| C | scheda del personaggio |
| J | diario delle missioni |
| 1, 2 | abilità attive |

Attacco (combo a tre colpi), parata e salto completano il combattimento. Il menu di pausa contiene le impostazioni
grafiche, il salvataggio e il viaggio rapido.

## Tecnologia

TypeScript, Vite e BabylonJS 7 (`@babylonjs/core`, `materials`, `loaders`). Nessun motore fisico, nessun framework di
interfaccia: l'HUD è DOM. Il mondo è quasi tutto generato all'avvio dal codice; fanno eccezione le texture fotografiche e
i modelli CC0 di Poly Haven (`public/textures`, `public/models`) e i pezzi scolpiti con Blender (`public/kit`).

## Documentazione

| Documento | Contenuto |
|---|---|
| [docs/GDD.md](docs/GDD.md) | documento di design del gioco: cosa fa il gioco e perché |
| [docs/architettura.md](docs/architettura.md) | architettura tecnica (schema arc42) |
| [docs/adr/](docs/adr/README.md) | registro delle decisioni di architettura |
| [docs/editor.md](docs/editor.md) | l'editor della mappa: cosa fa, come, fasi |
| [docs/piano-dati-e-interni.md](docs/piano-dati-e-interni.md) | il piano originale dei dati su file e degli interni |
| [CLAUDE.md](CLAUDE.md) | guida operativa per chi lavora sul codice, con le trappole già incontrate |
| `docs/reference/` | tavole di riferimento (città, kit, abitanti) |

Commenti nel codice, testi di gioco e documentazione sono in italiano.
