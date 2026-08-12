# Roadmap tecnica

## Priorità

1. Parità visiva verificabile fra preview ed export.
2. Test con media reali su macOS/Windows e GPU diverse.
3. Riduzione dei chunk iniziali tramite caricamento differito dei runtime AI.
4. Firma e notarizzazione dei pacchetti desktop.
5. Virtualizzazione di pool/decoder per montaggi molto grandi.
6. Metriche di qualità per sottotitoli, lip sync e ricostruzione volto.

## Criteri per nuove modalità

Ogni modalità deve avere schema versionato, pannello isolato, renderer deterministico, export offline, stato di avanzamento, test di timing e documentazione utente. I modelli devono essere opzionali, scaricati al primo uso e ignorati da Git.

## Fuori dal percorso critico

Cloud obbligatorio, upload automatico dei media e dipendenze da progetti esterni non fanno parte dell’architettura prevista.
