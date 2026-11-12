# Piano: dati da file, giorno e notte, interni

Porta in Side Quest i paradigmi di dragonmountain (tabelle con id, riferimenti risolti all'avvio,
interazioni "reagisce a → effetto", skill tree sbloccato dalle statistiche) e aggiunge ciò che là
manca: orari, coordinate, stato della partita, interni.

## Decisioni prese

- **Un file solo**: `public/data/db.json`, id a stringa.
- **Ciclo giorno/notte** visibile, non solo un orologio logico.
- **Classi** sì.
- **Interni subito**: tutti gli edifici si aprono, a più piani fin dall'inizio; grotte e sotterranei subito.
- **Tutto sul posto**: niente celle separate né dissolvenze. Il mondo diventa a più quote e il
  sottosuolo sta sotto il terreno, con un'apertura.
- **Finestre opache** per ora (da fuori non si vede dentro).
- Fuori dal piano: mura e torri percorribili, scale a pioli, finestre trasparenti, un editor dei dati.

## Principi

1. **Il codice genera, il file decide.** Aspetto dei personaggi (`CAST`), animazioni (`ACTS`),
   generatori di edifici e arredi, e il *significato* di ogni effetto restano codice. Il file dice
   chi, dove, quando, cosa dice, cosa possiede, quanto vale. Il file richiama il codice per chiave
   (`"look": "parroco"`, `"act": "pray"`, `"prefab": "casa.graticcio"`).
2. **Definizioni separate dallo stato.** `db.json` non cambia mai durante la partita. Ciò che cambia
   (ora, inventari, bandierine, interazioni già fatte, porte aperte, morti) sta nello stato, che è
   ciò che si salva. In dragonmountain le due cose sono mescolate: è l'errore da non ripetere.
3. **Un solo vocabolario di effetti e condizioni**, usato da interazioni, oggetti, skill e quest.
4. **Posti con nome, non coordinate sparse.** NPC e quest puntano a `location.posto`
   (`locanda.bancone`). Le coordinate stanno solo nelle location; spostare la città sposta tutto.
5. **Il file si legge prima del mondo.** Il terreno, il bosco e le ombre si generano una volta
   all'avvio: le location devono essere note prima.
6. **Asset grafici in due passi.** Tutto ciò che si vede (edifici, interni, arredi, texture, materiali) nasce
   prima come tavola vettoriale in `docs/reference/`, poi come asset in gioco. Lo fanno agenti Fable a impegno Extra.
7. **Errori chiari al caricamento.** Un id che non esiste o un campo sbagliato ferma l'avvio con
   il nome della tabella e della voce. Niente valori di ripiego silenziosi.

## Il file

```jsonc
{
  "version": 1,
  "world":   { "dayMinutes": 48, "startHour": 8, "start": "radura" },
  "classes": [{ "id": "guerriero", "name": "Guerriero",
                "stats": { "forza": 8, "destrezza": 5, "costituzione": 7, "intelligenza": 3, "saggezza": 3, "carisma": 4 },
                "skillTree": [{ "skill": "colpo_pesante", "stat": "forza", "level": 10, "requires": [] }] }],
  "skills":  [{ "id": "guardia_salda", "name": "Guardia salda", "kind": "passive",
                "mods": [{ "stat": "parata.costoVigore", "mul": 0.8 }] },
              { "id": "scintilla", "name": "Scintilla", "kind": "active", "cost": { "magicka": 20 },
                "effect": { "cast": "dardo", "power": 12 } }],
  "items":   [{ "id": "pozione_piccola", "name": "Pozione piccola", "kind": "consumable", "value": 15,
                "use": [{ "heal": 15 }] },
              { "id": "spada_argento", "name": "Spada d'argento", "kind": "weapon", "value": 100,
                "equip": { "slot": "mano", "model": "spada", "stats": { "danno": 5 } } }],
  "creatures": [{ "id": "lupo", "model": "wolf", "stats": { "salute": 40, "morso": 9 }, "loot": { "pelle": 1 } }],
  "spawns":  [{ "creature": "lupo", "at": [55, 48], "radius": 12, "count": 3 }],
  "npcs":    [{ "id": "anselmo", "name": "Padre Anselmo", "look": "parroco", "home": "canonica",
                "routine": [{ "from": "06:00", "at": "cattedrale.portale", "act": "pray" },
                            { "from": "12:00", "at": "piazza.est", "act": "stand", "social": true },
                            { "from": "21:00", "at": "canonica.letto", "act": "sleep" }],
                "inventory": { "acqua_santa": 2 }, "equipment": ["tonaca"],
                "dialogue": ["[Ti squadra.]", "La torre sud? Non la finiranno mai."],
                "interactions": [{ "on": "use:anello", "if": { "flag": "furto_scoperto" }, "once": true,
                                   "do": [{ "say": ["Dove l'hai trovato?"] }, { "give": { "monete": 50 } }, { "flag": "anello_reso" }] }],
                "services": { "rest": { "cost": 20 } } }],
  "locations": [{ "id": "citta", "kind": "settlement", "at": [252, 40], "ground": { "rect": [46, 40], "level": 5 },
                  "children": [{ "id": "locanda", "prefab": "casa.ricca", "at": [-37.5, 7.9], "yaw": 180,
                                 "size": [9, 9], "interior": "locanda", "door": { "open": ["06:00", "24:00"] } },
                               { "id": "pozzo", "prefab": "pozzo", "at": [-13.2, 23.6] }],
                  "streets": [{ "paving": "lastre", "width": 6, "line": [[-55, 0], [-14, 0]] }] },
                { "id": "grotta_crinale", "kind": "cave", "at": [150, 70], "layout": "grotta.piccola", "seed": 3 }],
  "roads":   [{ "from": "sentiero", "to": "citta.porta", "via": [[112, 92], [140, 78], [165, 60], [186, 46]] }],
  "quests":  [{ "id": "anello", "name": "L'anello del mercante",
                "stages": [{ "id": "cerca", "text": "Ritrova l'anello.", "done": { "has": "anello" } }] }]
}
```

- **Eventi** (`on`): `talk`, `use:<oggetto>`, `hit`, `death`, `enter`.
- **Condizioni** (`if`): `flag`, `has`, `hour`, `quest`, `stat`; si possono negare e combinare.
- **Effetti** (`do`, sempre una lista): `say`, `give`, `take`, `flag`, `quest`, `hostile`,
  `vanish`, `heal`, `damage`, `shop`, `rest`, `teach`, `open`, `spawn`.
- **Dialoghi**: lista di righe; fra parentesi quadre la narrazione, come in dragonmountain.
- **Inventari**: `{ id: quantità }`. Le monete sono un numero, non un oggetto.

## Cosa cambia nel codice

| Nuovo | Cosa fa |
|---|---|
| `src/data/db.ts` | tipi, caricamento di `db.json`, validazione, indice per id |
| `src/data/state.ts` | stato della partita e salvataggio (localStorage) |
| `src/data/effects.ts` | interprete di condizioni ed effetti |
| `src/clock.ts` | ora di gioco; chi la ascolta (cielo, luci, routine) |
| `src/world/levels.ts` | superfici a più quote, soffitti, ostacoli a segmento con fascia d'altezza |
| `src/world/prefabs.ts` | catalogo dei generatori di edifici e arredo di strada (oggi dentro `town.ts`) |
| `src/world/interiors.ts` | modelli d'interno per tipo di edificio, arredi, luce calcolata sui vertici |
| `src/world/underground.ts` | cripte e grotte, aperture nel terreno |
| `src/ui/` | dialogo, inventario, negozio, scheda del personaggio, registro delle quest |

| Esistente | Come cambia |
|---|---|
| `main.ts` | l'avvio diventa: file → mondo → abitanti → interfaccia |
| `world/terrain.ts` | legge location e strade dal file al posto di `TOWN`, `ROAD`, `PATH`; toglie i triangoli alle aperture |
| `world/town.ts` | resta il "muratore"; la lista di cosa costruire arriva dal file |
| `npcs.ts` | `ROLES` sparisce: routine a orari dal file; nodi con quota; scale e porte |
| `enemies.ts` | statistiche e gruppi (`WOLF`, `RAT`, `groups`) vanno nel file |
| `player/Player.ts` | quote, soffitti, segmenti; le costanti diventano una tabella di statistiche modificabile; tasto d'interazione |
| `player/equipment.ts` | i generatori prendono parametri dal file |
| `settings.ts` | nuovi selettori: aggiornamento delle ombre, dettaglio degli interni |
| `sky/` | il cielo segue l'ora (`setDay` c'è già); alle nuvole serve un metodo per aggiornare la luce |

## Fasi

Ogni fase lascia il gioco giocabile, passa `npm run build` e si verifica in Chrome headless come le
precedenti (script in scratchpad: vedute, misure, camminata). "Peso" è relativo.

### 1 · Dati: file, caricamento — piccola — **FATTA**
- `db.ts`: tipi, caricamento prima del mondo, controllo di ogni campo e dei riferimenti; `npm run check`
  verifica il file vero e che gli errori tipici vengano rifiutati dicendo dove stanno.
- Primo inquilino: `creatures` e `spawns` al posto di `WOLF`, `RAT` e `groups`.
- Indicatore di coordinate in gioco (solo in sviluppo): x, z, quota e coordinate locali alla città; F2 le copia.
- Un file sbagliato ferma l'avvio con il messaggio a schermo.
- **Rimandato alla fase 6**: `state.ts` ed `effects.ts`. Non hanno ancora nessuno che li usi; nascono con le
  interazioni degli NPC, che sono il loro primo cliente.

### 2 · Orologio e giorno/notte — media — **FATTA**
- Aspetto (tavola `docs/reference/citta/luce-1-ore.svg`, poi gioco): quattro "umori" in `LOOK` (`notte`, `alba`,
  `basso`, `blu`) pesati da `ORE`, a peso zero fra le 7:40 e le 17:20; tre materiali dei lumi (finestre dalle
  18:15, lanterne dalle 18:30, fiamme sempre accese); luce dei lampioni cotta in una texture vista dall'alto e
  sommata alla diffusa (selettore "Luce dei lampioni"); dentro, dalle finestre entra una tinta; pannello del
  sonno con quadrante e palpebre. All'ora di riferimento dei due stili l'immagine è quella di prima.
- Limiti noti: il bosco fitto di notte è molto scuro (`notte.ambI`); la luce dei lampioni non fa ombre e non
  arriva su rocce, erba, fogliame e creature; scheda integrata non misurata.
- Com'è andata: `clock.ts` (48 minuti veri per giorno, da `db.json` → `time`), `main.ts` (`paint`, `turnSun`,
  `setHour`), selettore "Ombre che seguono il sole" (di rado / lente / medie / fluide = 12°, 4°, 2°, 1°).
  La direzione del sole va a scatti insieme al ridisegno della shadow map; colori e cielo scorrono.
  Sulla RTX il ridisegno non si vede (frame più lungo 17 ms); sulla scheda integrata non è misurato.
- In più: si dorme nei letti (`sleep.ts`; ogni posto `*.letto` è un letto) fino alla prossima notte,
  mattino, mezzogiorno o tramonto (`time.wake`); il sonno ridà salute e vigore.
- Aperto: gli abitanti e i nemici non sanno ancora che ora è (fase 6); dormendo il mondo non avanza, salta solo l'ora.
- `clock.ts`; il cielo, il sole, la luce del cielo e la nebbia seguono l'ora. Lo stile grafico smette
  di decidere l'ora e resta solo una correzione (desaturazione, contrasto, nebbia).
- Ombre: la shadow map resta unica e statica, ma si ridisegna quando il sole si è spostato di qualche
  grado. Il costo va misurato sulla scheda integrata; la frequenza va dietro un selettore
  (ferme / lenta / media / veloce), come vuole la regola delle impostazioni.
- Notte: luce bassa, lampioni e finestre accesi; di giorno spenti.
- Gli interni seguono l'ora con `setInteriorDaylight(tinta)` (`materials.ts`: la tinta che entra dalle finestre, chiamata da `setHour`).
- **Fatta quando**: un giorno intero scorre senza scatti visibili in "Alto"; i lumi si accendono al tramonto.
- **Rischio**: lo scatto al ridisegno delle ombre. Ripiego: ombre ferme di notte, aggiornamento più rado.

### 3 · Mondo a più quote, porte, interazione, locanda pilota — grande — **FATTA**
- Com'è andata: tavole `interni-1-locanda.svg` e `interni-2-arredi.svg`, poi `interiors.ts` (13 mesh,
  ~14.700 triangoli, disegnate solo a portone aperto o stando dentro). Quattro abitanti hanno una tappa
  nella locanda (ostessa al banco, fabbro allo sgabello, garzone in cucina, avventuriero al tavolo e poi
  in camera). Misurata solo sulla RTX: 0,1–0,2 ms per frame a interno visibile.
- Lasciato alla fase 5: le ombre della luce interna vengono da una quarantina di scatole elencate a
  mano (vanno ricavate dai muri); la luce sulle ante è calcolata ad anta chiusa; un edificio con
  interno non può essere fuori piombo (per la locanda l'inclinazione è azzerata).
- Non provato: fps sulla scheda integrata; raggiungibilità di ogni singolo posto con nome.
- `levels.ts`: il suolo diventa "la superficie più alta sotto i piedi" fra terreno, solai e rampe;
  soffitti; ostacoli a segmento con fascia d'altezza. Alberi e massi restano cerchi.
- `Player.ts` e `npcs.ts` passano a questo suolo; i nodi delle strade prendono una quota.
- Porta a battente con il suo ostacolo; tasto d'interazione ("E") e scritta a schermo.
- **La locanda** rifatta come guscio a due piani con scala, camere, bancone e focolare: è il banco di
  prova di muri, vani, solai, arredi, luce sui vertici e attivazione da vicino.
- Foschia a terra esclusa dentro gli edifici.
- **Fatta quando**: si entra, si sale, si salta senza attraversare il solaio, si cade dal vano scala;
  un NPC sale in camera; da fuori nulla è cambiato nelle vedute di prima.

### 4 · Location dal file — media — **FATTA**
- Com'è andata: `db.json` ha `spawn`, `locations` (la radura e la città: mura, selciati, tracciati degli abitanti,
  61 cose posate, 27 posti) e `roads` (il sentiero, la strada che arriva alla porta). `terrain.ts` li legge con
  `layWorld`; `town.ts` costruisce dalla lista, un generatore per chiave. Verificato con una fotografia numerica
  prima e dopo: stessi vertici, ostacoli, nodi, collegamenti, posti e terreno (scarto sotto 0,1 mm; i selciati
  sovrapposti cambiano quota di qualche millimetro). Spostata la città di 8 m: tutto la segue, abitanti compresi.
  Aggiunti in fondo alla lista una casa e un pozzo: compaiono, con i loro ostacoli.
- Scostamenti dal piano: i generatori restano in `town.ts` (niente `prefabs.ts`) e non dichiarano ancora ingombro
  e posti propri: i posti stanno nel file accanto alla città, con i nomi di oggi (li usa `ROLES`, che sparisce
  con la fase 6). Selciati (`paving`) e tracciati degli abitanti (`walks`) sono due liste: la piazza è un
  rettangolo solo ma ci si gira attorno. Una città sola, con la porta a ovest.
- Cambiato di proposito: botti, casse e orto hanno la texture ancorata a sé e non alla città (spostandoli non
  scorre); i teli e la merce dei banchi, le pietre erette e i nemici non sono ancora nel file.
- `terrain.ts` legge `locations` e `roads`: spianate, radure, sentieri.
- `prefabs.ts`: ogni generatore dichiara ingombro, ostacoli e posti con nome in coordinate locali.
- La città di oggi viene riscritta nel file senza cambiarne l'aspetto: insediamento, edifici, arredo, strade.
  Le strade nel file fanno da selciato e da rete di nodi.
- **Fatta quando**: la città generata dal file coincide con quella attuale; spostare `at` dell'insediamento
  sposta città, strada e abitanti; aggiungere una casa o un pozzo nel file li fa comparire.

### 5 · Interni di tutti gli edifici — grande — **FATTA** (con una riserva sulle prestazioni)
- Com'è andata: sei tavole nuove (`interni-3`…`8`) e 25 interni costruiti da piante (`src/world/layouts.ts`, lo
  stesso modulo per gioco, tavole e `npm run check`): 6 case povere, 14 a graticcio, la casa del ricco, cattedrale,
  municipio, torre sud della porta con la sala di guardia; la locanda è passata sullo stesso cantiere. 34 porte,
  26 letti, 405 posti. Quale interno ha un edificio lo dice `db.json`. Selettore "Dettaglio degli interni".
  Lasciti della fase 3 chiusi: ombre ricavate da muri e arredi, luce sui battenti, abitanti rischiarati dentro,
  edifici con interno a piombo senza cambiare gli altri.
- Verificato: tutti e 24 gli edifici con uscio camminati in gioco (uscio chiuso che ferma, E, tappe, spinte contro
  i muri, salti sotto i solai); tutti i letti danno "Dormi"; dormito in una casa; due abitanti entrano e si
  siedono o salgono. Da fuori: terreno identico, nessun posto o nodo tolto; le case con interno non pendono più
  (fino a 19 cm di differenza), gli usci sono battenti veri, quello delle povere è alto 2,0 m.
- Riserva: a porte chiuse sulla RTX il frame costa dal 2 al 7% in più (0,1–0,3 ms), in parte non spiegato e al
  limite del rumore; la scheda integrata non è misurata. Da dentro si disegna ancora tutto il mondo dietro i muri.
- Scostamenti: la fucina resta una tettoia senza uscio; torri di cattedrale e municipio e torre nord della porta
  chiuse; `hall` spostato di 2 m; tre `walks` in più; due tappe di prova in `ROLES` (spariscono con la fase 6);
  mani e spada non prendono la luce di dentro; una porta resta aperta finché qualcuno è entro 2 m.
- Un modello d'interno per tipo: casa povera, casa a graticcio, casa del ricco, cattedrale, municipio,
  porta, fucina. Un seme per edificio varia disposizione e arredi.
- Catalogo di arredi: letto, tavolo, panca, forziere, scaffale, banco, focolare, candele, scale, altare,
  banchi della chiesa.
- Luce interna in due strati (finestre, fuoco) mescolati dall'orologio.
- Interni in mesh separate, accesi solo da vicino; selettore di dettaglio nelle impostazioni.
- **Fatta quando**: tutte le 22 case e gli edifici civici si aprono e si salgono; gli fps in città non
  scendono rispetto a oggi a porte chiuse.

### 6 · NPC dal file — media — **FATTA**
- Com'è andata: `npcs` in `db.json` (18 abitanti con nome, aspetto, casa, passo, giornata a orari, battute,
  interazioni). `ROLES` non c'è più. Ogni tratto della giornata è un giro di tappe o un "segui"; la sera
  ognuno cammina fino al suo letto e ci si stende. `state.ts`, `effects.ts`, `ui/dialogue.ts`.
- Verificato in gioco: all'avvio ognuno è alla tappa della sua ora; portando l'orologio oltre un `from` ci si
  incammina verso la tappa nuova; da sera a notte 18 su 18 arrivano a letto camminando (97 s); alle 2 in strada
  non c'è nessuno; al risveglio di chi gioca tutti sono al posto dell'ora. Padre Anselmo benedice una volta
  sola e solo al mattino (salute +30, bandierina); Baldovino, vista la bandierina, dà 20 monete una volta
  sola; il sindaco, se gli si vibra la spada addosso, se lo ricorda e cambia risposta.
- Scostamenti: gli eventi sono `talk` e `hit`; `use:<oggetto>` arriva con gli oggetti (fase 7), `death` quando
  gli abitanti potranno morire, `enter` con le quest. `inventory`, `equipment`, `services` arrivano con la fase 7.
  I posti si nominano senza il prefisso della città (ce n'è una sola). Le monete si vedono solo nella riga di
  narrazione "[Ricevi 20 monete.]": un contatore a schermo arriva con l'inventario. Lo stato non si salva ancora.
- Finestre: quelle di una casa sono accese solo se chi ci abita è dentro e sveglio (12 case accese alle 19:45,
  7 alle 21:10, 2 alle 23:30, nessuna alle 3); le case senza abitanti restano buie. Geometria della città identica
  (fotografia numerica). Il riquadro del dialogo riprende il pannello del sonno, senza una tavola sua.
- Aggiunte chieste in corsa: la partita comincia in città (`spawn`, con `arrive` = il posto d'arrivo); nel menu
  due voci di viaggio rapido (i luoghi con `name`). Corretto il tasto E, che a giocatore fermo non arrivava al dialogo.
- `npcs` nel file: aspetto, casa, routine a orari, inventario, equipaggiamento, dialoghi, interazioni, servizi.
- La posizione di partenza è quella della tappa valida a quell'ora; chi è lontano si rimette al suo posto al rientro.
- Di notte si va a letto (un posto vero, grazie alla fase 5; prima di allora, la porta di casa).
- Interfaccia del dialogo: righe una alla volta, narrazione fra parentesi quadre.
- `state.ts` (stato della partita) ed `effects.ts` (interprete di condizioni ed effetti) nascono qui.
- Interazioni: `talk`, `use`, `hit`, `death`, con `if`, `do`, `once`. Le finestre di una casa si accendono
  se chi ci abita è dentro e sveglio.
- **Fatta quando**: `ROLES` non esiste più; cambiando un orario nel file cambia la giornata di un personaggio;
  una interazione con condizione e ricompensa funziona una volta sola.

### 7 · Oggetti, inventario, equipaggiamento, negozio — media — **FATTA**
- Com'è andata: `items`, `containers`, `player` nel file; `loot` sulle creature, `services` sugli abitanti. Inventario
  a liste di testo (tasto I), lo stesso pannello fa da bottega (Compra / Vendi) e da banco dell'oste (Riposo).
- Verificato in gioco, coi tasti veri: da Baldovino si compra una pozione (30 → 15 monete); usata, la salute sale
  di 40; il forziere nella prima camera della locanda dà la spada d'argento e 10 monete, una volta sola; impugnata,
  un colpo da 18 ne fa 26 e la lama cambia aspetto; un lupo ucciso lascia la pelle; il pane porto a Nonna Tecla
  viene preso e ricambiato con una pozione (una volta); da Matilde la camera costa 5 monete e apre il pannello del
  sonno; alle 20 la bottega di Baldovino non si apre.
- Scostamenti: solo armi (`slot: "mano"`): scudi, armature e statistiche diverse dal danno arrivano con la fase 8.
  Il bottino va dritto nell'inventario (i corpi svaniscono in pulviscolo). Un solo forziere, dove c'è un posto con
  nome (le camere della locanda). Gli abitanti non hanno ancora inventario né equipaggiamento propri. Le botteghe
  hanno merce illimitata. `shop` e `rest` sono servizi dell'abitante, non effetti.
- `items` nel file; inventario a liste di testo (alla Skyrim: niente icone da disegnare).
- Usare un oggetto su di sé o su un NPC; se l'NPC non reagisce vale l'effetto proprio dell'oggetto.
- Equipaggiare cambia statistiche e, dove esiste un generatore, l'aspetto di spada e scudo.
- Negozio (legato a NPC e orario), riposo (fa avanzare l'orologio), forzieri e bottino dei morti.
- **Fatta quando**: si compra una pozione, la si usa, si trova una spada in un forziere e il danno cambia.

### 8 · Classi, statistiche, skill tree — media — **FATTA**
- Com'è andata: `classes` (guerriero, mago, esploratore), `skills` (cinque passive, due attive), `levels` e l'esperienza
  delle creature nel file; le regole in `data/character.ts`. Scelta della classe alla prima entrata in gioco; scheda
  col tasto C (statistiche, dove si spendono i punti, e albero delle abilità); abilità attive coi tasti 1 e 2.
- Verificato in gioco: scelto il guerriero un colpo da 20 ne fa 22,4; quattro lupi portano al livello 2 (2 punti);
  costituzione da 7 a 8 sblocca Guardia salda e il vigore di una parata scende da 0,94 a 0,55; forza a 10 sblocca
  Colpo pesante (che vuole Guardia salda) e il colpo sale a 30. Mago: Scintilla costa 20 magicka e toglie 30 a un lupo
  a 8 m; Mano lieve rende 35 di salute; senza magicka non parte. Esploratore: Lingua sciolta porta i prezzi da 0,97 a 0,80.
- Scostamenti: i punti si spendono solo nelle statistiche, le abilità si sbloccano da sé; salute e vigore massimi
  restano 100; niente scudi o armature (rimandati dalla fase 7); il dardo è una sferetta, senza tavola né effetti.
- `classes` e `skills` nel file; scelta della classe a inizio partita.
- Le costanti di `Player.ts` (danni, costi di vigore, velocità) diventano una tabella su cui agiscono i modificatori.
- Esperienza, punti da spendere, sblocco per statistica con prerequisiti; scheda del personaggio.
- Skill attive: il file dà costo e potenza, il codice implementa ogni tipo. Nella prima versione due tipi
  (un dardo, una cura), giusto per provare il meccanismo.
- **Fatta quando**: alzare una statistica sblocca una skill; una passiva cambia un numero misurabile.

### 9 · Sottosuolo — media — **FATTA**
- Com'è andata: i luoghi `crypt` e `cave` nel file; `underground.ts` fa per ognuno una trincea a rampa aperta nel
  terreno (muri fino al bordo del buco, parapetto) e una camera chiusa con la sua luce (candele o funghi, e il giorno
  dalla porta). La cripta è nel cimitero accanto alla cattedrale, con due sarcofagi, un altare e un sarcofago da
  aprire; la grotta è a nord della strada dove taglia il crinale, con tre ratti che ci nascono dentro.
- Verificato in gioco: si scende e si risale camminando in tutte e due (quote da 5,0 a 0,5 e da 4,0 a −1,0); in
  camera dodici spinte contro i muri non portano fuori (tranne dalla porta), saltando la testa si ferma al soffitto;
  dal fondo si vede la rampa, non il cielo attraverso il terreno; il parapetto ferma chi arriva di lato; i ratti
  restano nella grotta, attaccano lì e ci muoiono (il bottino arriva).
- Scostamenti: la cripta non ha la scala dalla navata ma una discesa dal cimitero, di fianco alla cattedrale (bucare
  il pavimento della cattedrale voleva dire rifarne la pianta); le camere sono scatole, anche la grotta; la rampa non
  ha gradini; niente tavole di riferimento; chi sta sotto non prende la luce della camera ma quella di fuori.
- Aperture nel terreno; `underground.ts` genera volte chiuse con la loro luce.
- La cripta sotto la cattedrale (scala dalla navata) e una grotta nel crinale vicino alla strada.
- I nemici possono nascere dentro (`spawns` con una location).
- **Fatta quando**: si scende nella cripta e si entra nella grotta camminando, senza vedere il cielo
  attraverso il terreno né cadere fuori dal mondo.

### 10 · Quest e salvataggio — media — **FATTA**
- Com'è andata: `quests` nel file (una missione di tre tappe: tre code di ratto, portarle a Raniero, aprire il
  sarcofago della cripta); diario col tasto J, riga a schermo con la tappa in corso, segnalino della bussola che
  punta alla tappa (un posto, o un abitante che si muove). Salvataggio in `localStorage` con una versione: dal
  menu (Salva, Carica, Nuova partita) e da solo a ogni risveglio; all'avvio si riprende da dove si era.
- Verificato in gioco: Raniero dà la missione; a tre code si passa alla seconda tappa e il segnalino va su di lui;
  salvato a metà in una casa, ricaricata la pagina, si ritrovano missione, posto, ora, classe, oggetti e monete;
  consegnate le code (40 monete) si apre la terza tappa; aperto il sarcofago la missione è conclusa. Un salvataggio
  di un'altra versione non viene caricato.
- Scostamenti: un salvataggio solo; i nemici non si salvano (rinascono a casa); le tappe non hanno effetti propri
  (le ricompense le danno abitanti e forzieri); non c'è l'evento `enter`.
- `quests` nel file, registro a schermo, segnalino sulla bussola verso la tappa corrente.
- Salvataggio e caricamento dello stato; una versione nel salvataggio per riconoscere quelli vecchi.
- **Fatta quando**: una quest di tre tappe si completa, si salva a metà, si ricarica e prosegue.

## Ordine e dipendenze

```
dati e gioco:   1 ─ 2 ─ 6 ─ 7 ─ 8 ─ 10
mondo:          3 ─ 4 ─ 5 ─ 9
```

- I due filoni toccano file diversi e possono avanzare in parallelo. L'unico file in comune è
  `Player.ts` (fase 3 e fasi 7–8): quelle non vanno fatte insieme.
- La 6 può partire prima della 4 usando i posti con nome di oggi; la 4 poi li genera dal file con gli stessi nomi.
- La 6 usa i letti solo dopo la 5.
- Consiglio di partire da **1** e **3**: la prima sblocca tutto il filone dei dati, la terza è il rischio tecnico maggiore.

## Rischi

- **Prestazioni sulla scheda integrata**: interni e ombre che si aggiornano pesano su un bosco che fa già
  ~20 fps. Ogni fase del mondo misura gli fps prima e dopo.
- **Bordi delle aperture nel terreno**: celle da un metro, bordi a scalini; vanno sempre coperti da un
  pavimento o da roccia.
- **Stanze strette in prima persona**: porte, scale e soffitti vanno dimensionati sul giocatore
  (raggio 0,35 m, occhi a 1,68 m), non sulle misure reali.
- **Fatica di compilare il file**: una città intera a mano è lunga. I modelli per tipo e i semi servono
  a questo; se non basta, il passo dopo è uno strumento per piazzare le cose in gioco.
- **Dimensione di `db.json`**: un file solo resta leggibile finché le location sono poche decine. Se cresce,
  si può spezzare senza cambiare formato (più file uniti al caricamento).
