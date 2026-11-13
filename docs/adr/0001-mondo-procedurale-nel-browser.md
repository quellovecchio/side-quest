# 0001. Un mondo generato dal codice, nel browser, su BabylonJS

- Stato: accettata
- Data: 2026-11-12

## Contesto

Il gioco deve partire da un indirizzo, senza installazione, e l'autore lavora da solo: non c'è chi modelli a mano un bosco e una città.

## Decisione

TypeScript, Vite e BabylonJS 7. Terreno, vegetazione, città, interni, creature, abitanti e suoni si generano all'avvio da codice e semi. Nessun motore fisico: urti a cerchi e segmenti, ragdoll alla Verlet. HUD in DOM.

## Conseguenze

- Il mondo è riproducibile e si cambia cambiando il codice o un seme.
- Il caricamento è lungo (circa 30 s): è il prezzo della generazione e del riscaldamento degli shader.
- L'ordine in cui si estraggono i numeri a caso diventa parte del contratto: un inserimento in mezzo cambia tutto ciò che segue.
- Il vincolo «tutto procedurale» è stato poi allentato (vedi 0008).

## Alternative considerate

Un motore con editor (Unity, Godot) e asset modellati: scartato per l'installazione e per il lavoro d'arte richiesto.
