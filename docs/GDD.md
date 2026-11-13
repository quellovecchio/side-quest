# Side Quest — documento di design (GDD)

Stato: demo. Questo documento descrive ciò che il gioco fa oggi e le scelte funzionali che lo guidano. Il *come* tecnico
sta in [architettura.md](architettura.md); il *perché* delle scelte tecniche in [adr/](adr/README.md).

## 1. Visione

Un RPG in prima persona fortemente ispirato a The Elder Scrolls: bussola in alto, barre di magicka, salute e vigore,
spada e scudo sempre in vista. Un mondo piccolo ma continuo e abitato, in cui ogni edificio si apre, ogni abitante ha un
nome, una casa e una giornata, e fra bosco, città e sottosuolo non c'è mai un caricamento.

**Direzione artistica**: dark fantasy. La resa di base punta al dettaglio fotorealistico (texture fotografiche su
geometria procedurale, fiamme con luce e ombre). Due stili alternativi, scelti dal menu, cambiano la resa senza cambiare
il mondo: lo *stile a pixel* (pochi pixel grossi, tavolozza scelta a mano) e il *cel shading* (luce a gradini, texture
dipinte, bordo scuro sui personaggi).

## 2. Pilastri

1. **Un mondo solo.** Niente celle né dissolvenze: si entra in una casa aprendo la porta, si scende in una cripta
   camminando.
2. **Una città che vive.** Gli abitanti lavorano, chiacchierano, rientrano la sera e dormono; la città reagisce (luci,
   finestre, comignoli) a chi c'è e a che ora è.
3. **Combattimento fisico e leggibile.** Tre colpi diversi, parata frontale, nemici che volano via quando muoiono.
4. **Il file decide, il codice genera.** Chi, dove, quando e quanto stanno nei dati; aspetto e movenze nel codice.

## 3. Il mondo

| Luogo | Cosa c'è |
|---|---|
| La conca | 320 m di bosco: radura con pietre erette, sentiero, abeti, latifoglie, felci, erba, massi, tronchi caduti, foschia a terra |
| La strada | taglia il crinale a est e scende alla città; accanto, una grotta di ratti |
| La città murata | porta, via maestra, piazza con fontana e mercato, cattedrale, municipio, locanda, fucina, 21 case, lampioni a olio |
| Il sottosuolo | una cripta nel cimitero accanto alla cattedrale (con un sarcofago) e la grotta |

Gli edifici sono a una volta e mezzo la misura reale (altezze dei piani comprese): la scelta è dell'autore dopo aver
provato il doppio, giudicato troppo grosso.

**Tempo.** L'ora scorre solo mentre si gioca. Il ciclo giorno/notte cambia cielo, luce, nebbia e comportamento della
città. In ogni letto si può dormire scegliendo quando svegliarsi.

**Meteo visivo.** Nuvole che scorrono e gettano ombra a terra; foschia bassa che si apre al passaggio e ai colpi di
spada; stormi di piccioni di giorno e pipistrelli col buio.

## 4. Il giocatore

- **Movimento**: passo, corsa, salto.
- **Combattimento**: combo a tre colpi (fendente, rovescio, colpo dall'alto), parata frontale che consuma vigore.
- **Classi**: guerriero, mago, esploratore, scelta all'inizio.
- **Statistiche e livelli**: a ogni livello si spendono punti nelle statistiche. A 5 una statistica non cambia niente;
  ogni punto sposta il suo effetto di qualche centesimo.
- **Abilità**: non si comprano. Si sbloccano da sole quando la statistica arriva al livello richiesto e i prerequisiti
  ci sono. Due tipi di abilità attiva oggi: cura e dardo.
- **Inventario**: oggetti consumabili, armi da impugnare (danno in più e aspetto della lama), oggetti vari. Le monete
  sono un numero, non un oggetto.

## 5. Nemici

Lupi in branco e ratti giganti, per provare il combattimento. Inseguono, attaccano, barcollano, tornano a casa; i lupi
girano attorno alla preda fra un assalto e l'altro. Il colpo che li uccide li sbalza via, poi si disfano in pulviscolo e
lasciano il bottino (pelli, code) direttamente nell'inventario. Rinascono a casa loro e non si salvano.

## 6. Gli abitanti

Diciotto personaggi delle tavole di riferimento più Lumier, il lampionaio. Ognuno ha un aspetto, una casa e una
giornata a orari.

- **Giornata**: tratti in ordine d'ora, ciascuno un giro di tappe (un posto, un'attività, una durata) oppure "segui
  qualcuno". Di notte vale l'ultimo tratto.
- **Attività**: camminare, chiacchierare, pregare, battere il martello, zappare, fare il bucato, sedersi, dormire,
  stare al banco, accendere i lampioni.
- **Reazioni**: guardano chi gioca, si spaventano davanti alla spada, aprono le porte passando.
- **Dialogo**: con E. Una riga alla volta; fra parentesi quadre la narrazione.
- **Servizi**: il mercante vende e compra (paga metà del valore, solo nelle sue ore); l'ostessa dà una camera.
- **Porgere un oggetto**: aprendo l'inventario davanti a un abitante le voci diventano "porgi a…".

**Lumier** accende i lampioni uno a uno al crepuscolo e li spegne la mattina; accende e spegne anche municipio e
cattedrale. Il suo giro dura circa tre ore di gioco.

## 7. Luci della città

- In un edificio il fuoco arde e il comignolo fuma finché dentro c'è un abitante sveglio; le candele solo col buio.
- Le finestre di una casa sono accese solo se chi ci abita è dentro e sveglio. Una casa vuota di notte è buia.
- Chi gioca può accendere e spegnere ogni candela con E; una candela accesa in una casa vuota la rischiara.
- Da vicino le finestre sono trasparenti nei due versi; da lontano restano un lume ambrato che tremola.

## 8. Missioni

Una missione in tre tappe: Raniero, i ratti della grotta, il sarcofago della cripta. Una missione comincia da
un'interazione e avanza da sé quando la condizione della tappa in corso è vera. Le ricompense stanno nelle interazioni e
nei forzieri, non nelle tappe. La missione seguita compare in alto a sinistra e sulla bussola; il diario è al tasto J.

## 9. Interfaccia

- **HUD**: bussola con segnalino, barre di magicka, salute e vigore, barra del nemico, lampo di danno, schermata di
  morte, riga della missione, avvisi.
- **Interazione**: ciò che si può usare, quando si è abbastanza vicini da usarlo davvero, prende un contorno dorato
  attorno alla sagoma; più acceso su quello a cui si rivolge il tasto E.
- **Pannelli a liste** (inventario, bottega, banco dell'oste): W/S scegli, E conferma, Tab pagina, Q chiudi.
- **Menu di pausa**: impostazioni grafiche con preset, salvataggio, caricamento, nuova partita, viaggio rapido.

## 10. Salvataggio

Nel browser (`localStorage`). Si scrive dal menu e a ogni risveglio; all'avvio la partita riprende da dove si era.
Si salvano stato, ora, posizione e salute. "Nuova partita" cancella il salvataggio.

## 11. Impostazioni grafiche

Ogni effetto costoso ha un selettore; nessuno viene tolto per guadagnare prestazioni. Quattro preset (Basso, Medio,
Alto, Ultra) più i singoli selettori, fra cui: risoluzione, antialiasing, ombre e ombre che seguono il sole,
occlusione ambientale, raggi di luce, bloom, distanza dell'erba, foschia (densità e pesantezza), luce dei lampioni, luce
delle fiamme, dettaglio degli interni, finestre trasparenti, ombre di chi si muove, ombre delle nuvole, stile a pixel,
cel shading.

## 12. Fuori dalla demo

Dichiarati come non fatti: mura e torri percorribili, salute e vigore massimi legati alle statistiche, teste più varie
e dita separate per gli abitanti, bordo scuro sugli edifici nel cel shading, ombre nitide per gli oggetti da modello,
un editor dei dati.
