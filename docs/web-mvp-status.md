# Stato applicazione

## Operativo

- Home a quattro aree con lingua e tema.
- Dieci modalità Sound Animation visibili.
- Watermark Remover e upscaling immagine/video.
- Video Editor multitraccia con 14 effetti.
- AI Quantizer integrato nel repository.
- Memory locale con anteprima, ricerca, grafo e copia.
- Modelli locali con cache e fallback.
- Export video offline con verifica anti-drop.
- Installer, launcher e script di build macOS/Windows.

## Da validare su hardware reale

- prestazioni 4K/8K e 120 fps;
- disponibilità codec alpha fra piattaforme;
- Metal/CUDA per tutti i checkpoint;
- firma/notarizzazione dei pacchetti;
- stress test di timeline con centinaia di clip.

## Gate

La baseline è `typecheck + lint + test + build`. Un warning sulle dimensioni dei chunk non equivale a un errore, ma resta un obiettivo di ottimizzazione.
