# Pianificazione della traiettoria

## Modello

Gli eventi abilitati diventano `ScheduledImpact` ordinati stabilmente per `(timeSeconds, id)`. Due impatti consecutivi definiscono un segmento. Con `T = t1 - t0`, posizione iniziale `p0`, target `p1` e gravità costante `g`:

```text
v0 = (p1 - p0 - 0.5 * g * T²) / T
p(t) = p0 + v0 * t + 0.5 * g * t²
v(t) = v0 + g * t
```

Il planner rifiuta `T <= epsilon`. Eventi simultanei sono un singolo cue composito oppure richiedono che solo uno controlli la collisione.

## Pipeline deterministica

1. Normalizzare e filtrare eventi senza mutare l'ordine originale.
2. Associare oggetti usando un PRNG con seed esplicito.
3. Proporre punti di contatto e normali nello spazio mondo.
4. Risolvere ogni arco in double precision e verificarne endpoint, velocità, apice e limiti.
5. Se necessario, applicare assistenze in ordine stabile.
6. Salvare segmenti completi; l'evaluator non riesegue il planner.

Ogni modifica di un marker invalida il segmento precedente e quello successivo. La propagazione continua finché posizione/velocità ai confini tornano compatibili; intervalli bloccati non vengono modificati.

## Impatto e continuità

Alla fine di un segmento la velocità incidente `v` viene decomposta rispetto alla normale unitaria `n`:

```text
vn = dot(v, n) * n
vt = v - vn
vReflected = -restitution * vn + tangentialRetention * vt + controlledImpulse
```

La posizione è sempre continua. La velocità può avere una discontinuità fisicamente motivata dall'impatto; l'impulso risultante è poi confrontato con i limiti percettivi. Il solver dell'arco seguente ha autorità finale sulla velocità di partenza e registra la differenza come assistenza se supera la tolleranza.

## Vincoli e assistenza

Controlli: gravità min/max, velocità, altezza, distanza orizzontale, restituzione, energia, accelerazione percepita e spin. In caso di violazione si prova, nell'ordine:

1. spostamento del prossimo oggetto entro safe area e limiti di layout;
2. gravità locale entro range;
3. sostituzione con molla/trampolino e impulso visibile;
4. guida invisibile con accelerazione continua e limitata;
5. scala spaziale del tratto.

Ogni segmento assistito memorizza `assisted: true`, `assistanceKind` e una motivazione diagnostica. Nessuna strategia può introdurre teletrasporto. Se nessuna soluzione soddisfa i limiti, il segmento è `invalid` e la generazione non può dichiararsi completata.

## Evaluator

L'evaluator è puro: input snapshot + tempo, output `BallState`. Una ricerca binaria seleziona il segmento; posizione e velocità sono calcolate dalla formula chiusa. Rotazione e squash/stretch sono funzioni deterministiche del tempo assoluto e degli impatti. Prima del primo e dopo l'ultimo segmento si applicano stati di hold espliciti.

## Test

- endpoint spaziale con tolleranza configurabile (default `1e-6` unità);
- tempo di contatto sotto 0,5 ms nel modello;
- identico stato per ordine di valutazione casuale e sequenziale;
- indipendenza da FPS 30/60/120;
- casi eventi densi, pause lunghe, gravità limite e assistenza;
- continuità di posizione ai confini e velocità finita;
- seed uguale produce byte-equivalent segment data.
