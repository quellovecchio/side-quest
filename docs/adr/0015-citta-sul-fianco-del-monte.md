# 0015. La città sul fianco del monte: il terreno nasce dalle vie, il torrente scende a vasche

- Stato: accettata
- Data: 2026-11-16
- Sostituisce: [0014](0014-citta-sul-meandro.md) (impianto e generatore; restano validi i nomi conservati e «ogni elemento sta alla quota del suo suolo»)

## Contesto

La città sul meandro, vista nel gioco, non reggeva. Lo strumento `tools/analisi/citta.py` (scritto per misurarla senza aprire il
gioco) ha dato i numeri: 36 edifici su 67 con difetti (18 sospesi, 17 senza via, 5 nella riva, 4 compenetrati), la cattedrale
con 31 m di vuoto sotto l'abside, il teatro con l'ingresso contro il pendio, una scala di 111 m attorno al picco senza un
uscio, il 10% del suolo dentro le mura oltre il 60% di pendenza. Le cause stavano nel generatore, non nei singoli pezzi:

- un'ansa di 50 m di raggio non regge un colle di 34 m (il promontorio di Durham ne ha 30 su 250 m di larghezza), e la
  piazzola della cattedrale, più larga della cima, veniva estrusa in verticale: il «picco» era un tappo;
- le vie si applicavano dopo le piazzole e le scavavano; una scala nasceva ovunque il profilo superava il 9%;
- le case «degli isolati» erano punti a caso entro 25 m da una via, controllate con cerchi invece che con rettangoli.

## Decisione

- **L'impianto**: la città bassa in piano dietro la porta (piazza del mercato e municipio); il torrente che scende dal monte,
  attraversa la città alta e in piano piega a sud; la città alta sul versante, fino a una spalla a 20,5 m con il sagrato e
  la cattedrale; il monte continua dietro. L'asse è una cordonata dritta dal ponte delle botteghe al sagrato; due carrabili
  salgono di sbieco al 10% e chiudono due anelli; il teatro ha la sua piazza sulla carrabile di sud.
- **Il terreno nasce dalle vie** (`tools/citta/fianco.py`, Python con numpy, senza Blender): ogni nodo della rete ha una quota
  scritta a mano; vie, piazze, piazzole degli edifici e letto del torrente sono vincoli, e fra un vincolo e l'altro il suolo è
  l'interpolazione armonica; oltre 35 m da ogni vincolo torna una forma di base (piana, versante, spalla, monte). Una via non
  può più essere in trincea né un edificio su un tappo, per costruzione.
- **Le case solo in schiera lungo le vie**, con l'uscio sul selciato. Un lotto si scarta se tocca qualcosa (rettangoli veri),
  se è a meno di 4 m dalle mura o di 3,5 dalla riva, o se il suolo sotto varia più di 4 m: resta un orto.
- **Il torrente ha una quota e una larghezza per punto** (`river.levels`, `river.widths` nel file): due punti alla stessa
  quota sono una vasca piana, un salto in pochi metri è una cascatella con la sua briglia di pietra; dove la striscia
  scende il materiale dell'acqua fa la schiuma (lo legge dalla normale). Il nastro d'acqua piano di prima resta valido
  tratto per tratto.
- **L'analisi è il collaudo**: dopo ogni rigenerazione `python tools/analisi/citta.py` deve dare zero edifici sospesi,
  compenetrati, senza via, nelle mura o nel torrente.
- Il mondo si allunga di altri 50 m a est (`EAST` = 400) per dare al monte la sua salita; `SAVE` = 4.

## Conseguenze

- 77 case (55 senza interno) invece di 66, quattro ponti corti invece di tre lunghi, 26 lampioni.
- `tools/blender/meandro.py` e `meandro_mappa.py` sono tolti; `tools/editor/meandro.mjs` (che scrive la pianta nel file)
  resta col suo nome. I render degli impianti (`citta.py`, `tavole_citta.py`) restano come riferimento storico.
- I riflessi del fiume (resa retrò) valgono solo per il tratto in piano, alla quota più bassa: le vasche alte e le cascate
  non riflettono la città (tengono il riflesso del cielo).
- Cambiare `EAST` sposta cespugli, felci ed erba della conca (gli alberi no).
- Sul versante fra una schiera e la via sopra restano scarpate dal 30 al 60% (il 7,5% dell'area): sono i salti delle
  terrazze, per ora di terra. Un muro di sostegno come elemento del file non è stato fatto.

## Alternative considerate

- **Lo sperone basso dentro l'ansa** (tenere fiume, mura e ponti, abbassare il colle a 11 m): il meno da rifare, ma perdeva
  la profondità che l'impianto voleva.
- **Il fiume di traverso in fondovalle** (la prima versione di questa proposta): funzionava, ma non dava un asse alla città;
  il torrente che scende dal monte lo dà, e porta la cascata come sfondo.
- **Correggere la pianta del meandro a mano nell'editor**: i difetti venivano dal rilievo, non dalle posizioni.
