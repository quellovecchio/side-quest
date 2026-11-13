# 0013. Un editor della mappa dentro il gioco, che scrive il file

- Stato: accettata
- Data: 2026-11-13

## Contesto

Disporre la città a mano nel file (coordinate, angoli, misure) è lento e cieco. Il mondo nasce già da `db.json`, e il
motore, il muratore e i controlli esistono.

## Decisione

Una modalità editor dentro il gioco (`?editor`), solo in sviluppo. Modifica il file grezzo e lo salva tramite un plugin
del server di sviluppo, che lo riscrive, lancia `npm run check` e lo ripristina se il controllo fallisce; poi il gioco si
ricarica. In modalità editor ogni elemento della città è costruito nelle sue mesh, così si sposta da solo. Ogni elemento
ha la sua `variant`, il seme delle sue differenze a caso, invece di una sola sequenza per tutta la città. Gli oggetti che
vanno da una parte all'altra (festoni, panni) sono descritti da due capi (`from`, `to`) e si popolano in base alla
lunghezza.

## Conseguenze

- La città si dispone guardandola; il file resta la sola verità e resta leggibile nelle differenze.
- Il passaggio ai semi per elemento ha cambiato una volta i piccoli dettagli a caso della città (inclinazioni, merci).
- Le modifiche che non sono spostamenti si vedono solo dopo il salvataggio, che ricarica il gioco.
- In modalità editor la città ha molte più mesh (una per elemento e materiale): va bene per modificare, non per giocare.

## Alternative considerate

Un editor 2D visto dall'alto in una pagina a parte: più semplice, ma non mostra il risultato e il lavoro vero (dipendenze,
controlli, semi) resta lo stesso. Un editor esterno (Blender): scartato, il mondo si genera nel gioco.
