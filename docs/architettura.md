# Side Quest — architettura tecnica

Schema [arc42](https://arc42.org), ridotto a ciò che serve. Le singole decisioni, con contesto e conseguenze, stanno in
[adr/](adr/README.md); le trappole operative in [CLAUDE.md](../CLAUDE.md).

## 1. Scopo e requisiti di qualità

Un RPG in prima persona che gira nel browser senza installazione (vedi [GDD.md](GDD.md)). In ordine di priorità:

| Qualità | Cosa vuol dire qui |
|---|---|
| Continuità | un mondo solo: nessun caricamento fra bosco, città, interni e sottosuolo |
| Resa | dettaglio alto sulla scheda dedicata, degradabile con selettori fino a una scheda integrata |
| Fluidità | nessun blocco durante il gioco: i costi si pagano al caricamento |
| Modificabilità dei contenuti | chi, dove, quando e quanto si cambiano in un file di dati, non nel codice |
| Riproducibilità | lo stesso file e lo stesso seme danno lo stesso mondo |

## 2. Vincoli

- Browser con WebGL2; niente server di gioco, niente rete dopo il caricamento.
- TypeScript, Vite, BabylonJS 7.54.3 (`core`, `materials`, `loaders`). Nessun motore fisico.
- Asset esterni solo con licenza CC0 e dalla stessa origine (Poly Haven); ogni scarico è deciso dall'autore.
- Lingua del progetto: italiano (codice commentato, testi, documenti).

## 3. Contesto

```
 public/data/db.json ──┐
 public/textures (CC0) ─┤
 public/models   (CC0) ─┼──►  gioco nel browser  ◄──► localStorage (salvataggio, impostazioni)
 public/kit (da Blender)┘            ▲
                                     │ tastiera e mouse
 tools/blender/*.py ──► public/kit/*.json      docs/reference/*/tavole ──► ispirazione
```

## 4. Strategia

1. **Generare all'avvio.** Terreno, vegetazione, città, interni, abitanti e gran parte delle texture nascono dal codice
   a partire da semi. Gli asset esterni sono eccezioni dichiarate.
2. **Il file decide, il codice genera.** `db.json` dice cosa esiste e dove; il codice sa come si costruisce e come si
   muove. Il file richiama il codice per chiave (`prefab`, `look`, `act`, `interior`).
3. **Definizioni separate dallo stato.** `db.json` non cambia durante la partita; ciò che cambia sta in `State`, che è
   ciò che si salva.
4. **Luce finta dove si può, vera dove si vede.** Sole con mappa d'ombre statica, lampioni e interni con luce cotta, tre
   luci vere per i fuochi vicini. Ciò che si muove ha soluzioni dedicate.
5. **Pagare prima.** Compilazione degli shader e generazione del mondo al caricamento; durante il gioco niente che
   cambi il numero di luci o introduca materiali mai disegnati.
6. **Stili come strati.** Stile a pixel e cel shading si accendono sopra la stessa scena senza toccare il mondo.

## 5. Vista a blocchi

```
src/main.ts ── orchestra: carica i dati, costruisce il mondo, lega i sistemi, ciclo di gioco
 ├─ data/      db.ts (lettura e controllo), state.ts (partita), effects.ts e character.ts (regole, pure)
 ├─ world/     terrain, vegetation, rocks ─ il bosco
 │             town (Mason), layouts, interiors (Kit), underground ─ il costruito
 │             levels, doors ─ dove si cammina
 │             materials, textures, flames, mist, flocks, props, kit ─ la resa
 ├─ sky/       cielo, nuvole, ora del giorno
 ├─ player/    controller, combattimento, equipaggiamento
 ├─ enemies, creature, ragdoll ─ i nemici
 ├─ npcs, human ─ gli abitanti
 ├─ interact, outline, hud, ui/ ─ interazione e interfaccia
 └─ settings, pixel, cel ─ impostazioni e stili di resa
```

### Dati (`src/data`)

- `db.ts` legge `public/data/db.json` prima di costruire il mondo e controlla ogni campo e ogni riferimento. Gli
  elenchi di chiavi (`PREFABS`, `LOOKS`, `ACTS`) stanno due volte apposta: qui, perché il controllo gira anche con Node
  senza Babylon, e nel modulo che li realizza, dove il compilatore li vuole completi.
- `effects.ts` è l'interprete unico di condizioni ed effetti, usato da interazioni, oggetti e missioni.
- `character.ts` contiene le regole del personaggio. Entrambi sono puri.
- `state.ts` è lo stato della partita con `save`/`load` e una versione (`SAVE`) da alzare a ogni cambio di forma.

Tabelle del file oggi: orologio, creature e gruppi, abitanti, livelli, classi, abilità, missioni, oggetti, forzieri,
dotazione iniziale, punto di partenza, luoghi, strade.

### Il costruito (`src/world`)

- **`Mason`** (`town.ts`) è il muratore: scatole, falde, archi, pareti coi vani veri, pezzi del kit. Produce una mesh
  per materiale per tutta la città. Un generatore per chiave (`PREFABS`) realizza ciò che il file elenca.
- **`layouts.ts`** descrive le piante degli interni (stanze, vani, scale, arredi, nodi, posti). È puro e caricabile da
  Node: lo usano il gioco, le tavole e i controlli (`problems()` verifica che ogni posto sia raggiungibile).
- **`Kit`** (`interiors.ts`) costruisce un interno da una pianta, cuoce la luce sui vertici e restituisce pavimenti,
  ostacoli, porte, nodi e posti con nome. Lo stesso cantiere costruisce il sottosuolo.
- **`Levels`** rende il mondo a più quote: pavimenti, solai e rampe sopra un terreno che resta un campo d'altezze.
- L'ordine conta: i numeri a caso si estraggono in fila, quindi aggiungere qualcosa in mezzo cambia tutto ciò che
  viene dopo. Le cose nuove vanno in fondo, o non devono estrarre.

### Luce e resa

| Fonte | Tecnica | Ombra di ciò che è fermo | Ombra di ciò che si muove |
|---|---|---|---|
| Sole | luce direzionale, mappa 4096 disegnata a scatti | la mappa | una seconda mappa piccola attorno a chi gioca |
| Cielo | luce emisferica | — | — |
| Nuvole | lo stesso campo di rumore del cielo, letto dai materiali | — | — |
| Lampioni | texture cotta vista dall'alto | no | sfere analitiche |
| Interni | luce cotta sui vertici, due strati (fuoco, finestre) | cotta | sfere analitiche |
| Fuochi vicini | tre luci puntiformi che passano da un fuoco all'altro | mappa cubica sulla più vicina | la stessa mappa |

I materiali sono `PBRCustomMaterial` con frammenti di shader iniettati (`materials.ts`); gli interni usano un materiale
standard a luci spente. `lampLit` è il punto in cui un materiale riceve lampioni, luce di dentro, ombre fatte a mano,
nuvole e cel shading.

### Stili di resa

- `pixel.ts`: bassa risoluzione, filtro finale con tavolozza, texture a blocchi.
- `cel.ts` e `materials.ts`: luce a gradini, texture dipinte al posto delle foto, scafo rovesciato sui personaggi.
- `outline.ts`: il contorno di ciò che si può usare, come maschera più filtro.

## 6. Vista a tempo di esecuzione

**Caricamento**: dati → kit → terreno e bosco → città (con interni) → sottosuolo → oggetti da modello → abitanti e
nemici → ombre → post-processing → riscaldamento degli shader (si disegna tutto finché due fotogrammi tornano svelti) →
ripresa del salvataggio.

**Ciclo di gioco**, a ogni fotogramma: orologio → giocatore → luci dei fuochi e fiamme → abitanti, porte, nemici →
foschia → interazione e contorni → disegno. Quattro volte al secondo: luce dell'ora, luci accese e spente della città,
avanzamento delle missioni.

**Entrare in un edificio**: le mesh di un interno stanno nella scena solo mentre servono. Entrano quando ci si avvicina
a una finestra trasparente o quando l'uscio si apre; da quel momento il lume opaco delle finestre sfuma.

## 7. Distribuzione

Sito statico: `npm run build` produce `dist/`. Nessun servizio. Gli asset in `public/` pesano circa 145 MB (texture 89,
modelli 53, kit 2,4).

## 8. Concetti trasversali

- **Posti con nome**: abitanti, forzieri e missioni puntano a `luogo.posto`; le coordinate stanno solo nei luoghi.
- **Gruppi di luci**: tutto ciò che si dichiara dentro un gruppo (un edificio, un lampione) si accende e si spegne
  insieme.
- **Spazi colore**: il PBR lavora in lineare, il materiale degli interni e `scene.fogColor` in gamma. È la fonte di
  errori più frequente.
- **HDR e bloom**: ogni emissivo sta appena sopra la soglia del bloom, o diventa una lampadina.
- **Fine riga**: alcuni file sono CRLF e altri LF; gli script non devono convertirli.
- **Impostazioni**: `settings.ts` è l'unico punto che applica i selettori; si salvano in `localStorage`.

## 9. Verifica

- `npm run build`: tipi e build.
- `npm run check`: dati, piante degli interni, allineamento delle finestre.
- Resa e prestazioni: script di prova con un browser senza interfaccia, tenuti fuori dal repository. Misurano
  fotogrammi lunghi e shader compilati durante una camminata in città.

## 10. Rischi e debiti

| Rischio o debito | Nota |
|---|---|
| `main.ts` fa da collante per quasi tutto | cresce a ogni sistema nuovo |
| Ordine dei numeri a caso | un inserimento in mezzo cambia il mondo; mitigato da regole, non da struttura |
| Ombre fatte a mano moltiplicano tutta la luce diffusa | scuriscono più del vero |
| Misure di prestazione solo in headless | sulla scheda dell'autore quasi mai misurato |
| Niente test automatici di resa | si guarda lo scatto |
| Dipendenze da parti private di Babylon | campionatori dei materiali personalizzati, legatura diretta delle texture, copia del framebuffer |
| Peso degli asset | 145 MB per una demo |

## 11. Glossario

| Termine | Significato |
|---|---|
| Conca | i 320 m di bosco a ovest; non è tutto il mondo |
| Muratore (`Mason`) | il costruttore di geometria della città |
| Cantiere (`Kit`) | il costruttore degli interni da una pianta |
| Kit | i pezzi scolpiti con Blender, senza uv né texture |
| Posto | un punto con nome in cui un abitante sta o un oggetto si trova |
| Lume | la finestra accesa vista da fuori |
| Scafo rovesciato | copia gonfiata di un modello di cui si vedono solo le facce dietro: dà un bordo |
