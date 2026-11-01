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

> **Viktigt:** Vercel-kontot har *Deployment Protection* påslaget, vilket gör att
> även produktionsadressen kräver Vercel-inloggning. Stäng av det under
> **Project → Settings → Deployment Protection → Vercel Authentication → Disabled**
> för att adressen ska bli publik för alla.

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
- **Dagens utmaning** – blandade frågor från alla ämnen.
- Framstegssida med träffsäkerhet, streaks och sparad statistik.
- Varje rätt svar ger spelmynt (`quizReward`, standard 25 kr).

### 🎰 Spelhallen
- **Blackjack** – sex kortlekar, hit/stanna/dubbel/splitta, blackjack 3:2.
- **Star Fortune (slots)** – 5 hjul, 3 rader, 20 vinstlinjer, autospel (RTP ≈ 94 %).
- **Videopoker** – Jacks or Better med håll-kort.
- **Kortleken** – alla 52 kort + 2 jokrar med svenska och engelska namn.
- Daglig bonus, saldo och insatsgränser.

### ⚙️ Adminpanelen
Nås på tre sätt:
1. Länken **Lärarpanel** i sidfoten (koden krävs).
2. Kugghjulet **⚙** uppe till höger i spelhallen.
3. Direkt via `#/admin`.

**Koden är `Vincent12`** (ändra med miljövariabeln `ADMIN_CODE`).

I panelen kan admin:
- se alla spelare, saldon, omsättning och utbetalningar,
- sätta/justera spelares saldo, stänga av eller nollställa konton,
- ändra min-/maxinsats, startsaldo, bonus, quizbelöning, blackjack-utbetalning,
- justera "tur" för slots och videopoker, underhållsläge,
- läsa hela transaktionsloggen och skicka meddelande till studiestartsidan.

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
| `public/js/casino.js` | Spelhallen (lobby) |
| `public/js/admin.js` | Adminpanelen |
| `public/js/main.js` | Skal, navigation, hemlig upplåsning |

- Spelarnas saldon och loggar ligger i `data/db.json` (skapas automatiskt, git-ignoreras).
- Klienten har en lokal fallback i `localStorage` om servern inte skulle svara.
- API: `POST /api/guest`, `GET /api/me`, `POST /api/bet`, `POST /api/credit`,
  `POST /api/bonus`, `POST /api/admin/login`, `GET /api/admin/overview`,
  `POST /api/admin/player`, `POST /api/admin/settings`, `POST /api/admin/broadcast`.

---

## Viktigt

> Alla mynt är **påhittade**. De kan inte köpas för pengar, växlas eller tas ut.
> Appen innehåller ingen betalningslösning och inget riktigt spel om pengar.
