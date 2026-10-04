# Runtime AI Quantizer

Questo runtime è parte di MLSM Studio e alimenta `Music → AI Quantizer`; non dipende da cartelle o progetti esterni.

| Percorso | Ruolo |
| --- | --- |
| `server.cjs` | API locale, progetti, upload/download e pipeline FFmpeg/Rubber Band. |
| `public/` | Interfaccia incorporata nella modalità Music. |
| `audio_engine/` | Beat This, analisi ritmica e AI Music Forensics. |
| `requirements.txt` | Dipendenze di `.venv-ai-quantizer`. |

Nel passaggio Quantizza, **Interpretazione ritmica** permette di scegliere tempo normale o half-time. Il BPM obiettivo è sempre intero, anche quando viene inserito manualmente, salvato o riaperto da un progetto precedente. Un valore 118,81 viene arrotondato a 119. Il BPM rilevato può invece mostrare decimali. Cambiare il BPM obiettivo modifica il tempo del risultato.

Dopo **Analisi Smart**, il BPM obiettivo automatico è **l'intero più vicino alla media aritmetica dei BPM locali delle sequenze affidabili**. I beat mancanti vengono normalizzati per il numero di pulsazioni trascorse. In half-time si dimezza prima la media e poi si arrotonda: media 142,8 → target normale 143, oppure media half-time 71,4 → target 71. Cambiando interpretazione il target automatico viene ricalcolato dalla media originale.

Il calcolo mantiene la stima originale basata sulle battute quando disponibile, riconosce il metro ternario solo con evidenza ripetuta e usa i beat se non ci sono abbastanza downbeat. La mappa condivisa tra browser e server (`public/rhythm.cjs`) verifica sequenze ritmiche coerenti: un beat mancante conta per il numero di pulsazioni trascorse, senza aggiungere marker sintetici. Le zone senza riferimenti non subiscono correzioni locali e seguono solo l'eventuale cambio globale di BPM. La presenza di batteria non è un requisito; se i riferimenti sono insufficienti o troppo irregolari, il rendering viene bloccato con un messaggio esplicito. La percentuale di pulsazione utilizzabile misura la copertura temporale, non la certezza musicale del BPM. Il rilevamento automatico può restare ambiguo tra tempo normale e half-time, soprattutto con ritmi complessi.

I risultati già esportati non vengono modificati automaticamente: per correggere una vecchia mappa occorre ripetere **Analisi Smart** e quantizzazione dall'originale.

Preparazione manuale:

```bash
npm run ai-quantizer:setup
npm run ai-quantizer:server
```

Il normale `npm run dev` prepara l’ambiente quando manca e inoltra i log alla schermata di bootstrap. I modelli vengono scaricati al primo uso in `tools/ai-quantizer/models/`; i progetti vivono in `.ai-quantizer-data/`. Entrambi sono esclusi da Git.

AI Music Forensics usa `lofcz/ai-music-detector` (licenza MIT), revisione fissata `6ba389e94a179ac90f3eb134b741ef37baa30434`.

Per il flusso utente consulta [Music · AI Quantizer](../../docs/music.md); per ambiente e test consulta [Installazione e sviluppo](../../docs/development.md).
