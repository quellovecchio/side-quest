# 0002. I dati di gioco in un file, separati dallo stato della partita

- Stato: accettata
- Data: 2026-11-12

## Contesto

Nomi, orari, battute, statistiche e posizioni erano nel codice. In un progetto precedente dell'autore definizioni e stato erano mescolati, e salvare era un problema.

## Decisione

Tutto ciò che è «chi, dove, quando, quanto» sta in `public/data/db.json`, letto e controllato prima di costruire il mondo. Nel codice restano aspetto, movenze e il significato degli effetti; il file li richiama per chiave. Ciò che cambia durante la partita sta in `State`, l'unica cosa che si salva, con una versione.

## Conseguenze

- Un solo vocabolario di condizioni ed effetti per interazioni, oggetti e missioni.
- Gli errori del file emergono all'avvio o con `npm run check`, non durante il gioco.
- Gli elenchi di chiavi stanno due volte (nel lettore e in chi li realizza): è voluto, ma va tenuto allineato.
- Ogni cambio di forma dello stato richiede di alzare la versione del salvataggio.

## Alternative considerate

Più file per tabella; un editor dei dati: rimandati.
