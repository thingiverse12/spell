# Plugghörnan ♠ Golden Spade

En studeapp för **matte, engelska och svenska** – med en dold spelhall bakom kulisserna.
Allt spel sker med **spelmynt**: inga riktiga pengar, inga insättningar, inga uttag.

**Publicerad:** https://plugghornan.vercel.app

---

## Publicering (Vercel)

Appen ligger som projektet `plugghornan` på Vercel och byggs från grenen
`arena/79083637-spell` i det här repot.

| Del | Hur det körs |
| --- | --- |
| Frontend | Statiska filer ur `public/` (output directory: `public`, ingen build) |
| API | Serverless-funktion `api/[...path].js` |
| Lagring | Supabase-projekt `spell-casino`, tabellen `public.casino_state` (en JSON-rad med versionslåsning) |

Miljövariabler som måste finnas i Vercel-projektet:

```
SUPABASE_URL=https://<projektref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service role-nyckel>
ADMIN_CODE=Vincent12
```

Saknas eller fallerar lagringen svarar API:t `503` och appen fortsätter i
**lokalt läge**: spel, saldo och adminpanel fungerar då per enhet via localStorage.

> Adressen är publik (Deployment Protection avstängt i projektet).

### Självtest av driften

`GET /api/selftest?key=<ADMIN_CODE>` kör igenom hela kedjan i skarp miljö –
skapa konto, insats, vinst, bonus, admininloggning, saldoändring, avstängning
och radering – och städar bort testdatan efteråt. Svarar `{"ok": true, "steps": [...]}`.

---

## Kom igång

```bash
npm start          # startar på http://localhost:3000
PORT=4000 npm start
ADMIN_CODE=MittEgenKod npm start
```

Inga beroenden behövs – servern är ren Node (>= 18).

---

## Vad finns i appen?

### 🎓 Täckmanteln – studieläget
- **Matematik** – räknesätt, procent, bråk, ekvationer och taljämförelser (slumpas fram).
- **Engelska** – glosor, grammatik, plural och ordförståelse.
- **Svenska** – ordklasser, stavning, synonymer, meningsbyggnad.
- **Geografi** – välj världsdel (Asien, Europa, Amerika, Afrika eller Blandat) och träna på
  länderna som hör dit, deras huvudstäder och kända städer. Fyra frågetyper: vilken världsdel
  landet ligger i, vilken huvudstad landet har, vilket land en huvudstad tillhör och i vilket
  land en stad ligger. Statistik sparas per världsdel (106 länder och 33 städer i databasen,
  se `public/js/geo-data.js`).
- **Dagens utmaning** – blandade frågor från alla ämnen, inklusive geografi.
- Framstegssida med träffsäkerhet, streaks och sparad statistik.
- Varje rätt svar ger spelmynt (`quizReward`, standard 25 kr).

### 🎰 Spelhallen
- **Blackjack** – sex kortlekar, hit/stanna/dubbel/splitta, blackjack 3:2.
- **Star Fortune (slots)** – 5 hjul, 3 rader, 20 vinstlinjer, autospel (RTP ≈ 93 %).
- **Videopoker** – Jacks or Better med håll-kort.
- **Skraplotter** – köp ett lott (10–500 kr), skrapa de nio rutorna med musen eller
  fingret och få vinst på tre lika belopp. Vinsttrappan går från 1,5× till 50× lottpriset
  (RTP ≈ 90 %), och ett lott visar alltid "Netto +X kr" när det ger vinst.
- **Kortleken** – alla 52 kort + 2 jokrar med svenska och engelska namn.
- Daglig bonus, saldo och insatsgränser.

### 👤 Konton
- **Skapa konto** med namn + fyrsiffrig PIN via **Konto** i menyn (gästkontot uppgraderas
  och behåller saldo och framsteg).
- **Logga in** med namn + PIN på vilken enhet som helst.
- Unika namn, PIN-kod och utloggning. Gäster kan spela direkt utan konto.

### 💸 Egna insatser
Alla tre spelen har ett fält för **egen insats** (utöver marker och snabbknappar):

- Blackjack: skriv valfritt belopp + knapparna ½, 2× och Max.
- Star Fortune och Videopoker: redigera insatsen direkt i insatsrutan.

Insatsen begränsas av saldot och av admin-inställningen **högsta insats** (standard 5 000 kr).

### 📈 Admin: vinster
Fliken **Vinster** visar:

- utbetalt, satsat, netto och största enskilda vinst,
- tabell **per spel** (Blackjack, Star Fortune, Videopoker, Skraplotter, Quiz) med insatser, utbetalningar och netto,
- tabell **per spelare** med vunnet, satsat, netto och största vinst,
- lista över de senaste utbetalningarna.

Statistiken räknas per spelare i databasen (`gameStats`) och följer med i admin-översikten.

### ⚽🏒 Live Sport (fotboll, SHL och NHL med live-odds)
Spelet **Live Sport** i spelhallen visar fotbollsmatcher och hockeymatcher med odds som rör sig live.
Två flikar: **Fotboll** och **Hockey · SHL & NHL** – hockeyn har dessutom ligafilter för SHL och NHL.

- **Marknader fotboll:** matchresultat (1X2), mål över/under 2,5, båda lagen gör mål,
  handikapp −1/+1, halvtidsresultat och nästa mål.
- **Marknader hockey:** vinnare inkl. förlängning och straffar (inget kryss), mål över/under 5,5,
  båda lagen gör mål samt handikapp −1/+1. Perioder visas som `2:a perioden 35′`.
- **Live:** ställning, matchminut och odds uppdateras var 15:e sekund.
- **Spelkvitto:** välj odds, ange valfri insats, se möjlig vinst och lägg spelet.
  Insatsen dras direkt och vinsten betalas ut automatiskt när matchen är slut
  (handikapp kan bli "återbetald" vid oavgjort efter handikapp).
- **Mina spel:** öppna, vunna, förlorade och återbetalda spel.
- Statistiken hamnar under spelet `sport` och syns i adminpanelens **Vinster**-flik.

Datakällor (första som svarar används):

| Källa | Kräver nyckel | Innehåll |
| --- | --- | --- |
| `allsportsapi` | Ja (adminpanelen eller `ALLSPORTS_API_KEY`) | Riktiga matcher, odds från api:t när de finns |
| `fotmob` | Nej – helt öppen | Globala matcher inkl. Allsvenskan, Superettan och Damallsvenskan, live-resultat |
| `openligadb` | Nej – helt öppen | Bundesliga 1–3 och DFB-pokalen, hela säsongen, riktiga mål och halvtidsresultat |
| `espn` | Nej – öppen | Allsvenskan, Europas toppligor och Champions League (blockeras ibland från datacenter) |
| `thesportsdb` | Nej – öppen demo-nyckel `3` | Global livescore, dagens matcher (blockeras ibland från datacenter) |
| `demo` | Nej | Inbyggd demoliga som rullar dygnet runt |

FotMob ligger först i autoläget eftersom källan är nyckelfri, global och svarar från Vercel.
Matcherna sorteras med live-matcher först, därefter svenska ligor och de stora europeiska ligorna.
Matcher utan känd avsparkstid hoppas över, och listan kapas till 24 matcher för att pollningen
var 15:e sekund ska vara lätt.

Ordningen går att låsa i adminpanelen (**Sport → Datakälla**), annars testas källorna i tur och
ordning. Svarar ingen visas demoligan, så vyn fungerar alltid. Svaret innehåller fältet `tried`
som visar vilka källor som provats och varför de inte gav några matcher.

Hockeyn har egna, nyckelfria källor (testas i den här ordningen):

| Källa | Kräver nyckel | Innehåll |
| --- | --- | --- |
| `nhl` | Nej – NHL:s eget öppna API | `api-web.nhle.com` – alla NHL-matcher ±en vecka, live-ställning, period och skottstatistik |
| `shl` | Nej – SHL:s publika webb-API | `www.shl.se/api/sports-v2` – kommande och senaste SHL-omgångar, perioder, förlängning/straffar |
| `demo` | Nej | Inbyggd demohockey (SHL- och NHL-lag) som rullar dygnet runt |

SHL-API:t kräver headern `x-s8y-instance-id: shl1_shl`; säsongens id hämtas automatiskt från
`latest-ssgt` så att vyn följer rätt säsong utan konfiguration. Hockeymatcher visas upp till
14 dagar framåt (SHL har uppehåll ibland), medan fotbollen håller sig inom tre dygn.
Båda sporterna går via samma endpoints – `GET /api/sport/matches?sport=hockey` respektive
`POST /api/sport/bet` med `sport: "hockey"` – och spelen avgörs automatiskt när matchen är slut,
oavsett sport.

### Låtsasreklam

Sajten har en påhittad annonsplats: ett litet popup-fönster (246 px, med låtsad fönsterlist)
glider in nere till vänster några sekunder efter att sidan laddats (tre varianter – Snabbspin Casino, Kryptokungen och AI-Plugg Pro).
Klickar man på den öppnas en egen annonssida på `#/reklam` med nedräkning, påhittade omdömen och
en knapp som delar ut den vanliga bonusen med spelmynt. Annonsen går att stänga (då vilar den i
45 minuter), försvinner av sig själv efter 22 sekunder och visas aldrig på annonssidan eller i
adminpanelen. Sidan säger rakt ut att reklamen är fejk – det finns ingen annonsör och inga pengar.

Koden ligger i `public/js/reklam.js` (vy, banner och annonstexter) och i slutet av
`public/css/casino.css` (stilen).

Oddsen räknas fram av huset med en Poisson-modell utifrån ställning och återstående tid,
plus en marginal som admin ställer in (standard 6 %).

### Utbetalningar – en vinst ska alltid ge plus

Alla spel visar både **utbetalning** (det du får tillbaka) och **netto** (vad du tjänade), så det
aldrig går att missta insatsen för en vinst:

| Spel | Utbetalning vid vinst | Exempel (insats 250 kr) |
| --- | --- | --- |
| Blackjack | 2× insatsen (insatsen + lika mycket i vinst) | 500 kr tillbaka, netto +250 kr |
| Blackjack (ess + tio) | 2,5× insatsen | 625 kr tillbaka, netto +375 kr |
| Blackjack (lika) | 1× insatsen | 250 kr tillbaka, netto 0 kr |
| Slots | lägst 1,45× insatsen, högst 85× | alla vinster ger plus |
| Videopoker | lägst 1,2× insatsen (par i knekt), högst 250× (royal flush) | 300 kr tillbaka, netto +50 kr |
| Skraplotter | lägst 1,5× lottpriset, högst 50× | 375 kr tillbaka på ett 250 kr-lott, netto +125 kr |
| Live Sport | insats × odds | 500 kr tillbaka på odds 2,00, netto +250 kr |

Blackjack visar en kvittorad under bordet – *Insats · Utbetalning · Netto* – efter varje runda,
även när handen förlorar. Slots visar "Netto +X kr" ovanför vinstraderna och videopoker skriver
ut både utbetalning och vinst.

`npm run audit` kontrollerar utbetalningarna i alla spel: att varje vinst ger mer än insatsen,
att blackjack betalar 2×/2,5×/1×, att vinsttabellerna är sorterade, att slotsens RTP ligger
mellan 88 och 97 procent och att skraplotternas RTP ligger mellan 85 och 93 procent.

`npm run simulera` räknar ut marginalen på riktigt: exakt RTP för slots och skraplotter i varje
tur-nivå (×0,70 / ×1,00 / ×1,40), marginalen för alla saldon genom gummibandet, träffchans,
storvinster, längsta nit-svit, hur ofta en hel spelkväll slutar med tomt konto – plus videopoker
och blackjack. Resultatet finns i [docs/simulering.md](docs/simulering.md).

### Gummiband – turen följer saldot

Alla spel använder en dynamisk turfaktor som håller ekonomin i balans. Den räknas ut från
saldot jämfört med startsaldot (2 500 kr) och gäller i **slots, videopoker, blackjack och Live
Sport**:

| Saldo | Tur | Effekt |
| --- | --- | --- |
| 0 kr | ×1,35 | vinner mer |
| 1 250 kr | ×1,18 | vinner lite mer |
| 2 500 kr (startsaldo) | ×1,00 | neutralt |
| 5 000 kr | ×0,90 | vinner mindre |
| 10 000 kr eller mer | ×0,70 | vinner minst |

- **Lite kvar → du vinner mer.** Har du spelat bort nästan allt blir vinsterna större, så det
  går att spela sig tillbaka.
- **Vunnit mycket → du vinner mindre.** Har du byggt upp en stor hög betalar spelen sämre, så
  saldot inte skenar iväg.
- Faktorn påverkar bara **vinsten ovanpå insatsen**. En vinst ger alltid mer än insatsen
  tillbaka – sämsta tänkbara fall (lägsta tur + lägsta vinstrad) är ändå plus.
- Turen **låses när en runda startar** (given i blackjack, snurret i slots, given i videopoker)
  och sparas på sportspelen när de läggs, så utbetalningen alltid matchar det som visades.
- Alla spel visar ett litet märke – *"Tur ×1,18 · du har lite kvar"* – så det går att se vad som
  gäller. Spelkvittot i blackjack och sport visar också vilken tur som användes.
- Gummibandet slås på/av med en kryssruta i adminpanelen → **Spelinställningar → Gummiband
  (dynamisk tur)**. Även tur-nivåerna för slots och videopoker väljs med kryssrutor
  (Låg ×0,70 / Normal ×1,00 / Hög ×1,40) och sparas i samma sekund som man kryssar i.

Med gummibandet varierar slotsens RTP mellan ungefär 75 % (stor hög) och 114 % (nästan tomt
konto); mitt på skalan, vid startsaldot, ligger den på 92,6 %. Det är uträknat i
[docs/simulering.md](docs/simulering.md).

**Koppla in AllSportsAPI (frivilligt, bara fotboll):** logga in i adminpanelen → fliken **Sport** → klistra in
din API-nyckel (eller sätt miljövariabeln `ALLSPORTS_API_KEY` i Vercel). Sportfliken visar också
källa för fotboll respektive hockey, antal live-matcher, vilka källor som testats, öppna spel,
utbetalningar och inställningar för högsta insats, marginal och på/av.

> Servern hämtar matcherna med REST-anrop och cachar dem i 15 sekunder. WebSocket-versionen
> (`wss://wss.allsportsapi.com/live_events`) kan inte användas på Vercel, eftersom serverlösa
> funktioner inte kan hålla en socket öppen mellan anrop.

### ⚙️ Adminpanelen
Nås på tre sätt:
1. Länken **Lärarpanel** i sidfoten (koden krävs).
2. Kugghjulet **⚙** uppe till höger i spelhallen.
3. Direkt via `#/admin`.

**Koden är `Vincent12`** (ändra med miljövariabeln `ADMIN_CODE`).

I panelen kan admin:
- se alla spelare, konton/gäster, saldon, omsättning och utbetalningar,
- följa exakt vad varje spelare vinner, per spel,
- sätta/justera spelares saldo, stänga av eller nollställa konton,
- **ge sig själv spelmynt** uppe på Översikt: snabbknappar (+500, +1 000, +5 000, +10 000)
  eller valfritt eget belopp. Saldot uppdateras direkt i panelen och i toppraden, påfyllningen
  loggas som `admin` i transaktionsloggen, och din egen rad i spelarlistan märks med **du**,
- ändra min-/maxinsats, startsaldo, bonus, quizbelöning, blackjack-utbetalning,
- ändra "tur" för slots och videopoker genom att **kryssa i Låg / Normal / Hög** – det sparas
  direkt utan att man trycker på spara,
- slå på/av gummibandet (dynamisk tur) med en kryssruta – sparas också direkt,
- underhållsläge,
- läsa hela transaktionsloggen och skicka meddelande till studiestartsidan.

### Ändringar slår igenom direkt
Klienten frågar servern var femte sekund (bara när fliken är synlig) om inställningarna har
ändrats – `GET /api/settings` svarar med en kort **version** som räknas fram ur inställningarna.
När versionen skiljer sig:

- **spelarnas sidor laddas om automatiskt** (inom ~5 sekunder) med notisen
  *"Inställningarna uppdaterades – sidan laddas om …"*, så nya insatsgränser, bonusar,
  quizbelöning, gummiband och underhållsläge gäller direkt,
- omladdningen **väntar** om en runda pågår (blackjack-hand, snurr, videopokerbyte, köpt men
  oskrapat lott) eller om en modal är öppen – den sker först när rundan är klar och vinsten
  är utbetald,
- **adminens egen flik laddas inte om** (då skulle panelen stängas) – den får bara de nya
  värdena och en liten notis.

---

## Hemlig ingång till spelhallen

Spelhallen är dold för obehöriga. Den öppnas genom att:

- klicka på **logotypen tre gånger**, eller
- skriva **`kasino`** (eller `golden`) med tangentbordet när inget fält är aktivt.

När den är upplåst dyker en diskret flik och en "Studieläge"-knapp upp så att du
snabbt kan växla tillbaka till studiematerialet.

---

## Teknik

| Fil | Innehåll |
| --- | --- |
| `server.js` | Nollberoende HTTP-server, JSON-API, spelardata i `data/db.json` |
| `public/css/base.css` | Bastema, studieläge, knappar, modaler |
| `public/css/casino.css` | Spelkort, filt, slots, videopoker, kortlek, admin |
| `public/js/core.js` | State, API (med offline-fallback), router, ljud, toast, modaler |
| `public/js/learn.js` | Frågebank och quizmotor |
| `public/js/cards.js` | Kortmodell, kortrendering, kortgalleriet |
| `public/js/blackjack.js` | Blackjack-bordet |
| `public/js/slots.js` | Star Fortune |
| `public/js/videopoker.js` | Videopoker |
| `public/js/scratch.js` | Skraplotter |
| `public/js/casino.js` | Spelhallen (lobby) |
| `public/js/admin.js` | Adminpanelen |
| `public/js/main.js` | Skal, navigation, hemlig upplåsning |

- Spelarnas saldon och loggar ligger i `data/db.json` (skapas automatiskt, git-ignoreras).
- Klienten har en lokal fallback i `localStorage` om servern inte skulle svara.
- `watchSettings()` i `core.js` pollar inställningarnas version och laddar om sidan när admin
  sparar; spelen anmäler pågående rundor med `guardRound()` så att omladdningen väntar.
- API: `GET /api/settings` (med `version`), `POST /api/guest`, `GET /api/me`, `POST /api/bet`, `POST /api/credit`,
  `POST /api/bonus`, `POST /api/admin/login`, `GET /api/admin/overview`,
  `POST /api/admin/player`, `POST /api/admin/settings`, `POST /api/admin/broadcast`.

---

## Viktigt

> Alla mynt är **påhittade**. De kan inte köpas för pengar, växlas eller tas ut.
> Appen innehåller ingen betalningslösning och inget riktigt spel om pengar.
