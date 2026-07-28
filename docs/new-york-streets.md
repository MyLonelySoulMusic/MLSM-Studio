# New York Streets

`New York Streets` è una modalità autonoma dell'editor. Riusa timeline, clock assoluto, sfera principale, finale cinematografico ed export condiviso, ma fornisce un proprio generatore, un pannello di configurazione e un ambiente procedurale.

## Percorso

La prima parte avanza in profondità lungo una strada newyorkese notturna. Un tratto di avvicinamento estende asfalto, marciapiedi e palazzi dietro alla partenza, così la camera non inquadra mai il vuoto. L'asfalto usa una texture procedurale dedicata con aggregato, solchi scuri di carreggiata, rattoppi e crepe ramificate ad alto contrasto; le crepe principali hanno anche una geometria sottile incassata nella superficie e la texture pilota il bump PBR, evitando l'aspetto di un piano colorato. Non vengono creati sassolini né detriti stradali. Comprende segnaletica, attraversamenti, cordoli continui, lampioni e palazzi alti con mattoni fini, finestre illuminate, negozi, cornicioni, serbatoi e scale antincendio. I lampioni usano corpi emissivi e luci fisiche locali che raggiungono fondo e vetro; solo quelli vicini alla biglia restano attivi per mantenere fluida la preview.

Circa al 56% degli step la carreggiata termina in un vero foro circolare ricavato nella geometria dell'asfalto, completo di bordo, pozzo in mattoni e chiusino spostato. Il segmento viene marcato esplicitamente come `sewerDrop`: tutte le biglie convergono sul centro del tombino e cadono verticalmente per `8,2 m`, senza traslazione laterale, rimbalzo o impulso verso l'alto. La camera mostra prima la caduta nel pozzo e passa gradualmente all'inseguimento sotterraneo. Soltanto dopo la caduta il percorso riprende in profondità nel tunnel.

La fognatura è quindi un livello realmente separato e inferiore alla strada. Un'unica geometria continua forma volta e pareti interne in mattoni umidi, malta, colature e muschio; non sono presenti tubi metallici longitudinali, anelli o condotte decorative. Il fondo è in muratura e contiene un canale d'acqua laterale con argini bassi. Lo scorrimento della texture dipende dal tempo assoluto, quindi pausa, seek ed export producono lo stesso fotogramma.

## Gara

Il valore `secondaryMarbleCount` indica da 1 a 13 sfere secondarie, oltre alla principale. La sfera principale conserva vetro, immagine incorporata e finale configurati nell'Inspector. Le altre non ricevono immagini interne: hanno colore collettivo e override individuali.

Le sfere secondarie non sono copie della principale. Ognuna possiede un tempo locale, una corsia, variazioni di passo, cambi di direzione, sorpassi, velocità e rotazione propri. La separazione fisica risolve le collisioni fra concorrenti e impedisce le compenetrazioni. La quota base viene ricavata dalla superficie reale della strada. Ogni concorrente usa seed e indice per scegliere un sottoinsieme diverso degli accenti su cui compiere un sobbalzo basso; negli altri segmenti la parabola condivisa viene rimossa e la biglia continua a rotolare. In prossimità del tombino corsie e oscillazioni convergono progressivamente sul foro, per riaprirsi solo dopo l'arrivo nel tunnel. La camera è calcolata esclusivamente da posizione e direzione della principale: le secondarie possono precederla, restare indietro o uscire dal campo.

Tra il 24% e l'80% del brano le secondarie si rompono progressivamente in ordine deterministico. Il punto di rottura viene congelato; ogni frammento riceve una velocità iniziale diversa, gravità, collisioni col terreno, coefficiente di restituzione e attrito progressivamente ridotti. I frammenti restano a terra invece di continuare a orbitare o scomparire. Posizione, rotazione, rottura e caduta dipendono esclusivamente dal tempo assoluto, quindi preview ed export coincidono.

La sfera principale integra la rotazione dalla distanza realmente percorsa e conserva l'orientamento fra un impatto e l'altro. La rotazione non viene più ricavata dalle coordinate assolute, evitando inversioni e scatti innaturali.

## Volantini

È possibile incorporare fino a otto immagini. Ogni immagine viene ripetuta in più copie lungo i bordi della strada e sui marciapiedi; la carta viene collocata a pochi millimetri dalla superficie corretta, resta quasi piatta e non proietta l'ombra artificiale che la farebbe sembrare sospesa. Nelle fognature i volantini sono orientati verticalmente e applicati alla superficie interna della parete curva. Pieghe leggere e strappi limitati agli angoli mantengono il contenuto riconoscibile anche in movimento. Le texture usano spazio colore sRGB e filtraggio anisotropico. I dati restano nel progetto salvato.

## Prestazioni

Il canvas chiede al browser la GPU ad alte prestazioni. In preview il pixel ratio è limitato a `1.25`, le ombre locali sono più piccole e la sonda cubica dei riflessi viene aggiornata ogni sette frame. Durante l'export il canvas passa alle dimensioni esatte scelte dall'utente e ogni fotogramma forza un aggiornamento completo del renderer e dei riflessi. Le luci locali lontane dalla sfera vengono disabilitate in entrambi i casi per evitare un numero eccessivo di point light simultanee.

## Estensibilità

La modalità è registrata in `services/animation-modes.ts`; il dispatch del generatore avviene in `services/mode-scene-generator.ts`. Il pannello sinistro seleziona un editor specifico attraverso il campo dichiarativo `panel`, mentre viewport, timeline, Inspector ed export restano condivisi.
