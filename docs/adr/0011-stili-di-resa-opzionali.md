# 0011. Stile a pixel e cel shading come strati sopra la stessa scena

- Stato: accettata
- Data: 2026-11-13

## Contesto

L'autore vuole una resa da pixel art e una da disegno, tenendo tutta la tecnica fatta (finestre, ombre, foschia).

## Decisione

Lo stile a pixel abbassa la risoluzione, aggiunge un filtro finale con una tavolozza scelta a mano e legge le texture a blocchi. Il cel shading porta la luce a gradini dentro i materiali, scambia le foto con texture dipinte generate dal gioco, appiattisce normali e occlusione, e dà ai personaggi un bordo scuro con uno scafo rovesciato che usa lo stesso scheletro.

## Conseguenze

- Gli stili si accendono e si spengono dal menu; la resa fotorealistica resta quella di base.
- Il bordo scuro come filtro sulla profondità è stato provato e tolto: restava indietro rispetto alle animazioni, costava una scena in più ed era incoerente.
- Gli edifici non hanno bordo: le loro mesh hanno muri a una faccia sola.
- La luce a gradini non deve mai avere il primo gradino a zero né salti: hanno prodotto personaggi neri e zigrinature.

## Alternative considerate

Sostituire la resa di base: scartato, gli stili restano opzioni.
