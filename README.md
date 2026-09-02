# Konsertsalen

Konsertskärm i 9:16 med automatisk schemahämtning, pågående konsert, nedräkning och lösenordsskyddad redigering. Publiceras med GitHub Pages och lagrar ändringar i Firebase Firestore. En lokal Python/SQLite-förhandsvisning ingår.

## Starta

Python 3.9 eller senare behövs. Inga externa Python-paket krävs.

```sh
python3 server.py
```

- Skärm: http://127.0.0.1:4173/
- Skärm utan kontroller: http://127.0.0.1:4173/?kiosk
- Administration: http://127.0.0.1:4173/admin
- Tester: `python3 -m unittest discover -s tests -v`

Klicka på Helskärm eller använd webbläsarens helskärmsläge. Sidan behåller 9:16 även på en liggande dator. Tiderna visas alltid i Europe/Stockholm oavsett enhetens tidszon. Enhetens klocka ska vara korrekt.

## Regler

Källa: [Örebro universitets schema för Konsertsal-Konsert](https://schema.oru.se/setup/jsp/Schema.jsp?startDatum=idag&intervallTyp=m&intervallAntal=6&sokMedAND=false&sprak=SV&resurser=l.Konsertsal-Konsert%2C).

| Exakt bokningsintervall | Typ | Konsertstart |
| --- | --- | --- |
| 16:00–21:00 | Kvällskonsert | 19:00 |
| 18:00–21:00 | Kvällskonsert | 19:00 |
| 12:00–14:00 | Lunchkonsert | 12:30 |

Alla andra intervall utesluts från automatisk visning. De listas i administrationen. Extra konserter kan läggas till med valfritt datum, starttid och sluttid samma dag. Affischen visas med ”Konsert pågår” från konsertstart tills bokningens sluttid passerats. Under pågående konsert visar nedräkningen tiden till nästa konsert. Om flera konserter pågår samtidigt växlar affischen var 15:e sekund. Konserter med samma starttid listas även under kommande.

Momenttexten blir rubrik. Rubrik, extra information och synlighet kan redigeras. För schemakonserter ligger starttiden fast enligt tabellen; för extra konserter går datum, starttid och sluttid att ändra. Schemakonserternas sluttid hämtas från bokningen.

## Lagring och uppdatering

- `state`: senaste lyckade hämtningen och eventuell felstatus.
- `edits`: separata ändringsposter per importerad konsert. Återställning tar bort ändringsposten.
- `manual`: egna konserter. Dessa påverkas inte av schemauppdateringar.
- Databasen finns i `data/concerts.sqlite3` och versionshanteras inte. Säkerhetskopiera den om förhandsvisningen används längre.
- Servern hämtar schemat var femte minut. Skärmen läser servern var 15:e sekund; nedräkningen uppdateras varje sekund. Detta är den lokala implementationens intervall, inte ett löfte om Spark.
- Misslyckad hämtning behåller senaste schemat. Skärmen visar när data är inaktuella. Vid ett helt nytt besök utan anslutning till servern krävs att servern åter blir tillgänglig.

Det publika HTML-schemat innehåller inget boknings-id. Därför används lokal + datum + exakt intervall som identitet. Momentändringar behåller kopplingen. Flyttade bokningar behandlas som nya; gamla ändringar appliceras inte automatiskt på dem. Om en annan bokning ersätter en tidigare i samma tidslucka kan en äldre ändring följa med: administrationen markerar ändrad momenttext så att detta kan granskas. Flera rader i samma tidslucka stoppar importen och behåller förra versionen. För säker identifiering vid alla slags ombokningar behövs ett stabilt boknings-id från schemaleverantören.

## GitHub Pages + Firebase Spark

Produktionsappen använder GitHub Pages och Firebase-projektet `ksskarm`. Spark avser Firebase-planen; någon GitHub Spark-app behövs inte.

- Skärm: https://gustavsund-sys.github.io/ksskarm/?kiosk
- Redigering: https://gustavsund-sys.github.io/ksskarm/?admin
- GitHub Actions hämtar schemat och publicerar statiska filer vid push till main, manuell körning och var femte minut. Schemalagda körningar kan försenas av GitHub. Vid importfel misslyckas körningen och den senast publicerade sidan ligger kvar.
- Firestore använder `concertEdits` för separata ändringsposter och `manualConcerts` för egna konserter. Realtidslyssnare uppdaterar skärmen när dessa ändras. Schemahämtningar skriver aldrig till dessa samlingar.
- Administrationen visar endast ett lösenordsfält. Firebase Authentication använder ett dedikerat konto bakom detta. Själva lösenordet ligger aldrig i koden eller repositoryt.
- `screenAdmins/{uid}` med `enabled: true` ger kontot skrivrättighet. Denna samling får inte skrivas av webbklienten. En inloggning utan sådan behörighet kan inte redigera.
- Besökare kan läsa konsertuppgifterna utan inloggning. Att dölja en konsert innebär att den inte visas på skärmen; det gör den inte hemlig i databasen.
- Firestore-reglerna validerar tillåtna fält, textlängder, typer, start/slut och administratörsbehörighet. Andra databassamlingar nekas.
- Ingen Cloud Function, Cloud Storage, betald plan eller servicekontonyckel används för schemauppdateringen.

Den publika Firebase-konfigurationen finns i `public/firebase-config.mjs`. Säkerheten ligger i Firebase Authentication och `firestore.rules`, inte i att gömma API-nyckeln.

### Ändra lösenord

Använd Firebase Console → Authentication → Users för det dedikerade kontot `skarmadmin@ksskarm.firebaseapp.com`, eller ändra lösenord via Firebase Admin API med en behörig administratör. Adressen är ett tekniskt användarnamn, ingen inkorg för återställningsmejl. Dela lösenordet bara med dem som ska kunna ändra programmet. Efter att lösenordet bytts måste användarna logga in igen.

### Publicera ändringar

Push till repositoryts main-gren kör tester, hämtar schemat och publicerar till GitHub Pages. Databasreglerna publiceras separat med `firebase deploy --only firestore:rules --project ksskarm` från en behörig Firebase-inloggning. Det behövs inga Firebase-hemligheter i GitHub för sidans eller schemats publicering.

GitHub stänger normalt av schemalagda körningar i publika repositoryn efter 60 dagar utan aktivitet. Kontrollera därför Actions vid längre uppehåll och återaktivera körningen vid behov. Skärmen markerar schemauppgifter äldre än 20 minuter.

### Lokal utveckling

Den lokala Python-servern använder SQLite och kräver inte Firebase. För att prova det riktiga Firebase-projektet på localhost, lägg till `?firebase` eller `?admin&firebase`. Lokala SQLite-ändringar kopieras inte automatiskt till Firestore. Python-servern är endast bunden till localhost och ska inte exponeras som publik driftserver.

### Filer

- `scripts/schedule.py`: schematolkning och intervallfilter.
- `scripts/export_schedule.py`: export för GitHub Actions.
- `.github/workflows/publish.yml`: tester, schemahämtning och publicering.
- `public/firebase-store.mjs`: inloggning och databasanslutning.
- `public/program.mjs`: nästa/pågående konsert.
- `firestore.rules`: behörighet och datavalidering.
- `server.py`: lokal utvecklingsserver.

Google Fonts används med systemtypsnitt som reserv. Ingen universitetslogotyp har kopierats; avsändaren anges som text.
