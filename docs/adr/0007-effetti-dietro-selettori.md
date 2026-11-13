# 0007. Gli effetti costosi non si tolgono: vanno dietro un selettore

- Stato: accettata
- Data: 2026-11-12

## Contesto

La stessa demo deve girare su una scheda integrata e rendere al massimo su una dedicata.

## Decisione

Ogni effetto costoso ha un selettore in `settings.ts` e un valore in ciascuno dei quattro preset. Togliere un effetto per guadagnare prestazioni non è un'opzione.

## Conseguenze

- Il menu grafico è lungo.
- Ogni effetto nuovo deve funzionare anche spento, e le combinazioni si moltiplicano.
- Le impostazioni salvate nel browser possono mancare di una chiave nuova: si parte sempre dal preset e ci si sovrappone il salvato.

## Alternative considerate

Un solo livello di qualità: scartato.
