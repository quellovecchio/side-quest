# 0008. Texture e modelli CC0, e un kit di pezzi fatto con Blender

- Stato: accettata
- Data: 2026-11-12

## Contesto

Con sole texture generate e scatole la città restava piatta e lontana dal traguardo fotorealistico.

## Decisione

L'autore ha tolto il vincolo «tutto procedurale». Texture fotografiche e modelli CC0 da un'unica origine (Poly Haven), scaricati solo col suo permesso. I pezzi che servono in forme precise (scale, ante, trafori, arredi, teste) si scolpiscono con Blender da riga di comando e si esportano senza uv né texture: il gioco li posa nelle sue mesh calcolando le uv dalle misure vere.

## Conseguenze

- Un pezzo del kit prende texture e luce di ciò che ha attorno, e allungarlo non stira niente.
- Circa 145 MB di asset.
- Un modello esterno dentro un edificio prenderebbe il sole invece della luce cotta: lì va fuso nelle mesh dell'interno.
- Serve Blender per rigenerare il kit.

## Alternative considerate

Restare procedurali: scartato dall'autore. Modellare a mano gli edifici interi: troppo lavoro.
