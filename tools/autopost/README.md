# Programmare articoli su WordPress

Nel JSON importato, aggiungere i campi opzionali `status: "future"` e
`date_gmt` a ogni articolo da programmare:

```json
{
  "articles": [{
    "title": "Articolo programmato",
    "content": "<p>Contenuto dell’articolo.</p>",
    "status": "future",
    "date_gmt": "2027-01-10T14:30:00"
  }]
}
```

`date_gmt` è sempre UTC: nell’esempio sono le 15:30 italiane del 10 gennaio.
Sono accettati secondi obbligatori e una Z finale facoltativa. Anche il solo
`date_gmt` abilita la programmazione; se presente, `status` deve essere
`future`. Il campo locale `date` non è supportato, per evitare ambiguità
fra blog con fusi orari differenti. La data deve essere valida e distante
più di un minuto sia durante l’importazione sia al momento dell’invio.

Importare e inviare gli articoli con i comandi della coda **prima** dell’orario
desiderato. L’importazione da sola non carica gli articoli su WordPress.
L’intervallo della coda regola l’invio da Studio, non la data di pubblicazione.
Una data scaduta produce un errore senza pubblicare immediatamente l’articolo.

Una programmazione esplicita prevale sull’impostazione Pubblico/Bozza del blog.
Senza questi campi, il comportamento precedente resta invariato.
Dopo la conferma “Programmato su WordPress”, Studio può essere chiuso:
la pubblicazione è affidata a WordPress e al suo WP-Cron.
La coda conserva la conferma di programmazione e non verifica successivamente
l’effettiva pubblicazione. Un nuovo tentativo dopo un errore parziale salta i
blog che hanno già accettato l’articolo.
