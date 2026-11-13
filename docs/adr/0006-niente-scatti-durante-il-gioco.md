# 0006. Riscaldamento degli shader al caricamento e luci mai spente

- Stato: accettata
- Data: 2026-11-12

## Contesto

Il gioco si bloccava fino a sei secondi. Due cause: accendere o spegnere una luce cambia il numero di luci e fa ricompilare ogni materiale; e la scheda video traduce uno shader solo la prima volta che lo disegna.

## Decisione

Le luci dei fuochi restano sempre accese e si spengono a intensità zero. Al caricamento si disegna tutto, forzando ogni mesh dentro l'inquadratura, finché due fotogrammi tornano svelti.

## Conseguenze

- Circa nove secondi di caricamento in più.
- Ogni materiale nuovo che entra in scena più tardi deve passare dal riscaldamento.
- Tecniche che aggiungono luci alla scena vanno evitate o rese invisibili ai materiali (la luce finta della mappa piccola illumina una sola mesh).

## Alternative considerate

Compilare in parallelo e mostrare il materiale quando è pronto: lasciava buchi visibili.
