# 0014. La città sul meandro: rilievo da Blender, pianta generata, nomi conservati

- Stato: sostituita dalla [0015](0015-citta-sul-fianco-del-monte.md) (16 novembre 2026)
- Data: 2026-11-13

## Contesto

La città era un rettangolo piatto (`TOWN.y`), con le mura sui quattro lati. Per renderla scenografica l'utente ha chiesto un
fiume che la attraversa con un ponte, la cattedrale nel punto più alto con le montagne dalle finestre, una zona povera e
una ricca nette, salite e discese, un teatro nella zona ricca. Fra sei impianti disegnati in Blender
(`docs/reference/citta/scenografia/`) ha scelto il **meandro** (F): il fiume gira attorno a un promontorio, i ricchi e la
cattedrale stanno sopra, i borghi poveri fuori dall'ansa.

## Decisione

- **Il rilievo viene da Blender.** `tools/blender/meandro.py` gira in Blender con lo stesso piano e lo stesso rumore dei
  render, e scrive `public/data/rilievo.bin`: la quota della città, assoluta, su una griglia da un metro, più un peso per
  punto che dice quanto vale rispetto al terreno generato (tutto dentro le mura e lungo il fiume, poi sfuma). Il terreno lo
  usa al posto del piano (`townGround`, `townWeight` in `terrain.ts`). Sotto ogni edificio il rilievo ha una piazzola
  spianata.
- **La pianta è generata, poi scritta nel file.** Lo stesso script mette le case lungo vie curve, prima quelle con un nome
  (hanno un interno e qualcuno dentro), poi le altre; `tools/editor/meandro.mjs` la scrive in `db.json` con lo scrittore
  dell'editor. Dopo, il file è la sola verità come prima: si ritocca con l'editor.
- **I nomi restano.** Abitanti, missioni e forzieri nominano posti (`plazaN`, `market`, `well`…) e interni (`casa01`…): i
  gruppi legati fra loro (la piazza col municipio e i banchi, la cattedrale col sagrato e il cimitero, la fucina, il pozzo)
  si spostano in blocco con le stesse distanze interne, e le giornate restano valide senza riscriverle. Si rifà solo il giro
  di Lumier, sui lampioni nuovi.
- **Ogni elemento sta alla quota del suo suolo**, con uno zoccolo dove il terreno scende; le mura sono un poligono che segue
  il suolo; i selciati possono essere nastri lungo una spezzata; i ponti sono oggetti tesi (`from`, `to`) con un piano
  calpestabile all'aperto (`Floor.open`). Senza rilievo, mura e fiume nel file, tutto si comporta come prima.

## Conseguenze

- La città ha 66 case invece di 21 (44 senza interno): 5,3 milioni di vertici attivi; in headless 92 fps, nessun frame lungo.
- Il mondo si allunga a est (`EAST` = 350) e attorno c'è un anello di montagne lontane (`mountains.ts`).
- I salvataggi di prima non valgono più (`SAVE` = 3).
- La luce cotta dei lampioni tiene la quota di ogni lanterna (nell'alfa della texture): con 35 m di dislivello una quota
  sola non bastava.

## Alternative considerate

Disegnare la nuova pianta a mano nell'editor: troppo lento per un centinaio di elementi e un rilievo nuovo. Scolpire il
terreno con l'editor: va bene per ritocchi, non per un promontorio e un alveo.
