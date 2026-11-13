# 0004. Una mappa d'ombre statica per il mondo, una piccola per chi si muove

- Stato: accettata
- Data: 2026-11-12

## Contesto

Le cascate d'ombra ridisegnate a ogni fotogramma costavano due terzi del fotogramma su una scheda integrata. Il mondo è quasi tutto fermo.

## Decisione

Una mappa da 4096 su tutto il mondo, ridisegnata solo quando il sole scatta di direzione. Per ciò che si muove, e per l'arredo di strada che in quella mappa quasi sparisce, una seconda mappa da 2048 su 44 m attorno a chi gioca, ridisegnata a ogni fotogramma, letta a mano dai materiali.

## Conseguenze

- Il costo delle ombre non dipende dalla grandezza del mondo.
- Il sole si muove a scatti (selettore del passo).
- La mappa grande ha circa 14 cm per pixel: le ombre fini vengono solo vicino a chi gioca.
- Gli oggetti da modello restano fuori dalla mappa piccola: troppi triangoli a ogni fotogramma.

## Alternative considerate

Cascate; ombre solo analitiche a sfere: usate, ma solo per lampioni e interni.
