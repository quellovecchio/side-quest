# 0003. Bosco, città, interni e sottosuolo nello stesso mondo

- Stato: accettata
- Data: 2026-11-12

## Contesto

Il pilastro del gioco è la continuità: si entra in una casa aprendo la porta. Il terreno però è un campo d'altezze, sotto il quale non c'è niente.

## Decisione

Nessuna cella separata. `Levels` aggiunge al terreno pavimenti, solai e rampe a più quote. Gli edifici sono gusci vuoti con l'interno costruito dentro. Il sottosuolo è una trincea a rampa che toglie triangoli alla mesh del terreno, più una camera chiusa. Le mesh degli interni stanno nella scena solo mentre si vedono.

## Conseguenze

- Niente schermate di caricamento.
- La trincea deve essere allineata alla griglia del terreno.
- Ogni sistema (urti, percorsi degli abitanti, luce, ombre) deve sapere di quote e di «dentro o fuori».
- Le zone che decidono cosa mostrare e quelle che decidono che luce si prende sono cose diverse: confonderle ha scurito la piazza davanti alla cattedrale.

## Alternative considerate

Interni come scene a parte con dissolvenza: più semplice, scartato perché contrario al pilastro.
