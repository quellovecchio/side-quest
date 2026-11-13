# 0005. Luce cotta per lampioni e interni, tre luci vere per i fuochi

- Stato: accettata
- Data: 2026-11-12

## Contesto

La città ha decine di lanterne e ogni stanza ha fuochi e candele. Il PBR regge poche luci per materiale, e ogni luce costa su ogni pixel.

## Decisione

I lampioni sono una texture vista dall'alto cotta all'avvio e ricotta quando uno si accende o si spegne. Gli interni hanno la luce cotta sui vertici in due strati (fuoco, finestre). Solo i tre fuochi più vicini sono luci vere, e solo il più vicino fa ombra.

## Conseguenze

- Decine di fonti di luce al costo di una lettura di texture.
- La luce cotta non reagisce da sola: accendere una candela, aprire una porta o far passare qualcuno richiede ogni volta un pezzo dedicato.
- Chi cammina dentro prende la luce della stanza con un conto a parte (`interiorLight`).
- Le ombre di chi si muove su luce cotta sono sfere analitiche, non la figura vera.

## Alternative considerate

Luci vere ovunque con un renderer differito o a cluster: fuori portata per il motore e per il tempo.
