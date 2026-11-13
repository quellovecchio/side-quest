# 0010. Finestre trasparenti da vicino, lume opaco da lontano

- Stato: accettata
- Data: 2026-11-12

## Contesto

Le finestre erano vetri opachi: da dentro non si vedeva fuori e viceversa. Tenere in scena tutti gli interni costa.

## Decisione

Dove la pianta ha una nicchia allineata a un vano vero della facciata, il vetro è trasparente. Da lontano l'interno non è in scena e si vede un lume; avvicinandosi l'interno entra in scena e il lume sfuma su qualche metro. Il vetro rifrange copiando il fotogramma a metà disegno. Un controllo automatico pretende che ogni finestra di una pianta arrivi al vetro di fuori.

## Conseguenze

- Dentro e fuori si vedono a vicenda senza pagare gli interni lontani.
- Facciate e piante devono restare allineate al centimetro.
- La rifrazione dipende da WebGL2 e da parti interne del motore; se manca, il vetro torna trasparente semplice.
- Dove dietro non c'è una stanza le imposte sono chiuse.

## Alternative considerate

Stanze finte disegnate nel vetro (interior mapping): non mostrerebbero gli abitanti veri.
