# Editor della mappa — specifica

Stato: fasi 1–4 fatte (13 novembre 2026), tranne le piante degli interni nei dati. Le decisioni di fondo stanno in [adr/0013](adr/0013-editor-della-mappa.md).

## Scopo

Disporre la città guardandola: spostare, ruotare, aggiungere, duplicare e togliere ciò che il file `public/data/db.json`
elenca, e tendere festoni e panni da un muro all'altro. L'editor non modifica geometria: modifica il file, e il gioco
ricostruisce dal file.

## Principi

1. **Dentro il gioco.** Una modalità dello stesso programma (`?editor` nell'indirizzo, o il pulsante nel menu in
   sviluppo): ciò che si vede è ciò che si gioca.
2. **Il file resta la verità.** L'editor legge il file grezzo e lo riscrive; il gioco lo rilegge al ricaricamento.
3. **Ogni salvataggio è controllato.** Prima di sostituire il file girano gli stessi controlli di `npm run check`; se
   falliscono il file torna com'era e l'errore si vede nel pannello.
4. **Elementi indipendenti.** Ogni elemento ha la sua `variant` (il seme delle sue piccole differenze a caso): aggiungerne
   o toglierne uno non cambia gli altri.
5. **Solo in sviluppo.** Il salvataggio passa dal server di sviluppo; nella build di produzione l'editor non c'è.

## Oggetti tesi fra due punti

Festoni, panni stesi e in generale tutto ciò che va da una parte all'altra non hanno posizione, rotazione e misura: hanno
**due capi**. Scale e ponti funzionano allo stesso modo, ma con due punti o più (`line`, una lista di [x, quota, z]): a ogni
punto di mezzo un pianerottolo (la scala) o una svolta (il ponte), quindi anche i tornanti.

```json
{ "prefab": "festone", "from": [-49.7, 5.3, 0], "to": [-40.3, 5.3, 0], "variant": 1234 }
```

- `from` e `to` sono [x, quota, z] nelle coordinate della città (la quota dal suolo sotto quel capo).
- Il contenuto **si popola da sé in base alla lunghezza**: un festone mette una bandierina ogni 55 cm, i panni riempiono
  la corda finché c'è posto. La corda ha una pancia che cresce con la lunghezza.
- I due capi possono stare a quote diverse (da un balcone a una finestra).
- Il lettore del file ne ricava centro, verso e lunghezza, così il resto del gioco li tratta come gli altri elementi.
- Oggi sono tesi: `festone`, `panni`. Un nuovo tipo teso si aggiunge all'elenco `SPANS` (`db.ts`) e alla funzione
  `span()` (`town.ts`).

**Nell'editor** un oggetto teso, una scala o un ponte selezionati mostrano i loro punti come maniglie. Per scale e ponti
Shift+clic su una maniglia aggiunge un punto subito dopo, Alt+clic la toglie. La quota di ogni punto si scrive dal suolo che
gli sta sotto (in collina: il rilievo della città). Trascinando una maniglia il capo si
**aggancia alla superficie che sta sotto il puntatore** (un muro, un palo, un balcone, il terreno), con 5 cm di stacco.
L'oggetto si ricostruisce mentre si trascina. Si può anche spostare tutto l'oggetto, come gli altri.

## Fase 1 — cosa fa

| Funzione | Come |
|---|---|
| Camera libera | tasto destro tenuto e mouse per guardare; W A S D per muoversi, R e F per salire e scendere, Shift per andare veloci |
| Selezione | clic sinistro su un elemento; Esc deseleziona |
| Spostare e ruotare | manipolatori sull'elemento: 1 sposta (sul piano), 2 ruota (attorno alla verticale); aggancio a 25 cm e a 15° |
| Pannello | tipo, nome, posizione, rotazione, misura, scala, tinta, interno, variante; per i tesi i due capi |
| Nuovo | sceglie il tipo e lo posa dove si guarda |
| Duplica, elimina | Ctrl+D, Canc |
| Annulla, ripeti | Ctrl+Z, Ctrl+Y |
| Salva | scrive il file, controlla, ricarica l'editor nello stesso punto di vista |

**Cosa si vede subito e cosa al salvataggio.** Dalla fase 3 quasi tutto si vede subito (vedi sotto). Si aggiornano solo
salvando: gli interni, le luci (lanterne, lampioni, finestre accese, fuochi), le porte, il terreno (strade e verde) e la
rete degli abitanti dentro il gioco.

**Come lo fa.**

- In modalità editor la città costruisce **ogni elemento nelle sue mesh** (invece di fonderle per materiale), così ogni
  elemento si sposta da solo appeso a un perno.
- Il salvataggio passa per un plugin del server di sviluppo (`vite.config.mjs`) che riscrive solo il blocco `children`
  della città, un elemento per riga, coi fine riga del file, e lancia il controllo.
- Al ricaricamento l'editor ritrova camera e selezione da `sessionStorage`.

## Fase 2 — disegnare

Nel pannello, oltre a **elementi**, ci sono cinque livelli. Ognuno si vede come linee sopra la scena, anche attraverso i
muri, e si tocca nello spazio dello schermo: il punto o il tratto più vicino al puntatore.

| Livello | Cosa sono nel file | Come si modifica |
|---|---|---|
| percorsi | `walks`: le spezzate su cui camminano gli abitanti; un punto ripetuto è un incrocio | trascinare un punto (gli stessi punti degli altri tracciati vengono con lui: l'incrocio resta tale; lasciato entro 60 cm da un altro punto ci si attacca); Shift+clic su un tratto aggiunge un punto; trascinare un tratto sposta il tracciato |
| posti | `spots`: i punti con un nome dove qualcuno si ferma, col verso | trascinare; Q ed E girano di 15°; nome, posizione e verso dal pannello. Un posto usato da abitanti, forzieri, luoghi o missioni non si rinomina (il pannello dice chi lo usa) |
| verde | `green`: rettangoli dati da due angoli | trascinare un angolo o un lato |
| selciati | `paving`: strisce dritte con tipo e larghezza | trascinare un capo: la striscia resta dritta lungo x o lungo z; tipo e larghezza dal pannello |
| strade | `roads`: sentieri e strade, nelle coordinate del mondo | come i percorsi; nome e tipo dal pannello |

Per tutti: il pulsante "Nuovo…" e poi un clic per punto (Invio per finire una spezzata, Esc per lasciar perdere;
rettangoli e selciati si chiudono al secondo clic, un posto al primo); Canc toglie il punto scelto, Shift+Canc la forma.

**Controllo in diretta.** Mentre si toccano percorsi e posti la rete degli abitanti si ricostruisce coi tracciati nuovi
(gli usci degli edifici si legano di nuovo al nodo di strada più vicino) e si ricontrolla con lo stesso controllo che il
gioco fa all'avvio: il pannello dice "a posto" o elenca i problemi, che compaiono come croci rosse sulla mappa.

**Quando si vede.** Le linee subito; selciati, verde e strade cambiano il mondo (terreno, erba, alberi) solo dopo il
salvataggio. Il salvataggio riscrive i blocchi `children`, `walks`, `spots`, `green`, `paving` della città e `roads`,
ognuno un elemento per riga, lasciando com'è il resto del file.

## Fase 3 — ricostruire dal vivo

Ciò che nella fase 1 compariva come segnaposto ora si costruisce subito: cambiare tipo, misura, scala, tinta o variante di
un elemento, aggiungerne uno nuovo, duplicarlo. Anche i selciati si rifanno mentre li si ridisegna, e le copie da modello
(botti, casse, secchi, la merce dei banchi) seguono il loro elemento quando lo si sposta.

**Come.** La città sa costruire un elemento da solo (`Town.editor.build`): lo stesso generatore e lo stesso seme del gioco,
in un muratore a parte; ciò che il generatore dichiara altrove (fiamme, lanterne, interni, posti dei lampioni) si butta e
arriva salvando. Le copie da modello che dichiara le posa l'editor, caricando il modello se ancora non c'è. Un elemento che
non si lascia costruire (per esempio una casa senza misura) torna un segnaposto, e il pannello lo dice.

**Cosa resta al salvataggio.** Un edificio ricostruito perde il suo interno fino al salvataggio (la pianta potrebbe non
entrarci più) e la faccia di fuori dell'uscio resta dov'era. Le luci e i lumi delle finestre non seguono.

## Fase 4 — abitanti e terreno

**abitanti** (`src/editorNpcs.ts`). Si sceglie un abitante (o se ne crea uno, o lo si toglie) e se ne cambiano id, nome,
aspetto, casa, passo e se si ferma a chiacchierare. La giornata è un elenco di tratti, ognuno con la sua ora: un giro di
tappe (posto, attività, sosta da … a …) oppure "segue" un altro abitante. Il nome del posto si scrive (con i suggerimenti) o
si punta: ◎ e poi un clic sul posto nella mappa; una tappa col bordo rosso nomina un posto che non c'è. Il giro
dell'abitante scelto si vede sulla mappa, un colore per tratto. Battute una per riga; interazioni e servizi come JSON
(accettato solo se si legge). Gli abitanti nel gioco seguono la giornata nuova salvando; il blocco `npcs` si riscrive solo
se è cambiato, un abitante per voce come lo scrive la mano.

**terreno** (`src/editorTerrain.ts`). Un pennello col cerchio sul terreno: alza, abbassa (di «forza» metri al secondo),
spiana (alla quota dove si è cominciato), leviga; raggio e forza dal pannello. Annulla e ripeti vanno per pennellate. Le
modifiche non toccano il rilievo generato: sono uno strato a parte, centimetri in più o in meno su ogni vertice della griglia
da un metro, salvato in `public/data/terreno.bin` (Int16, 521 × 321; senza modifiche il file non c'è). Il gioco lo somma al
rilievo (`terrainHeight`), quindi rocce, alberi, erba, città e sottosuolo si posano sul terreno nuovo, ma solo dopo il
salvataggio: mentre si dipinge cambia la sola mesh del terreno.

## Fasi successive

5. **Le piante degli interni nei dati**: oggi le scrive il codice (`layouts.ts`); portarle nel file vuol dire definire un
   formato per stanze, scale, vani e arredi e un modo di disegnarle. È un lavoro grosso, rimandato.

## Limiti noti

- Una sola città; fuori dalla città si modificano solo le strade (non bosco, radura, sottosuolo).
- I posti accanto ai lampioni (`lampione.N`) li mette il gioco: non compaiono fra i posti.
- Spostando un lampione il giro di Lumier non si aggiorna (le tappe sono un elenco nel file).
- Le finestre trasparenti e la rifrazione non funzionano in modalità editor.
- Il terreno scolpito sotto la città sposta il suolo ma non gli edifici: un edificio prende la quota del rilievo della città
  (`rilievo.bin`) solo dove si posa, e uno spostato dall'editor la segue subito; lo strato scolpito a mano no.
- Salvando gli abitanti la prima volta le righe della giornata cambiano spaziatura (`{ "from": … }`): i dati sono gli stessi.
