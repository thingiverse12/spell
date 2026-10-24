# SPELL — Ett eko i djupet

Ett stämningsfullt 2D-plattformsspel i stil med Hollow Knight, byggt i ren
HTML, CSS och JavaScript (canvas). Ingen motor, inga beroenden, inga bild- eller
ljudfiler — all grafik ritas i kod och allt ljud syntetiseras.

Du är en liten vandrare i en sjunken grotta. Ta dig genom tre valv med nålen i
hand, besegra det som vakar i djupet och bär amuletten ut i ljuset.

## Starta

```bash
npm start          # http://localhost:4173
```

eller vilken statisk server som helst:

```bash
python3 -m http.server 4173
```

> Öppna via server, inte som `file://` — spelet använder ES-moduler.

## Spela

| Styrning | Gör |
| --- | --- |
| `A` `D` / piltangenter | Gå |
| `SPACE` / `Z` | Hoppa (en gång till i luften = dubbelhopp) |
| `J` / `X` / vänster mus | Slå med nålen |
| `W` + `J` | Slå uppåt |
| `S` + `J` (i luften) | Slå nedåt — studsar på fiender |
| `SHIFT` / `C` | Dash (kort osårbarhet) |
| `Q` / `I` | Besvärjelse: självisp som går genom fiender (kostar 33 själ) |
| `F` | Fokusera: byt 33 själ mot en mask (stå still) |
| `E` / `Enter` | Sätt dig vid en bänk |
| `ESC` | Paus · `M` ljud av/på |

På touch: vänster halva är en rörelsespak, höger halva har hopp, slag, dash och
besvärjelse.

### Regler

- **Masker** är ditt liv. Att vila vid en bänk fyller alla masker, tömer själen
  och blir din återuppståndelsepunkt.
- **Själ** fylls när du träffar fiender. Använd den till besvärjelsen eller för
  att fokusera fram en ny mask.
- **Själsten** droppar från allt du dödar och sparas som rekord.
- Fiender vaknar när du kommer nära; dör du återställs de.
- Amuletten ligger högst upp i Väktarens hall — når du den är rundan vunnen.

## Världen

| Område | Innehåll |
| --- | --- |
| Den sjunkna brunnen | Startbänk, krypande skalbaggar, svävande ögon, första klättringen |
| Valvet med lyktorna | Avsatser, glödande svampar, spottare som skjuter, grunda spikgropar |
| Väktarens hall | Spikgolv, en väktare med klor och språng, amulettsavsatsen |

Fiender: **krypare** (markbunden, klättrar inte av avsatser), **svävare**
(jagar i luften), **husk** (långsam, mycket liv), **spottare** (skjuter
projektiler som du kan slå sönder) och **väktaren** (boss med hopp och klor).

## Struktur

```
index.html        Canvas + HUD (masker, själ, själsten), alla skärmar
css/style.css     HUD, menyer, touch-kontroller
src/main.js       Bootstrap, spelloop, HUD-synk, skärm- och tangentlogik
src/game.js       Spellogik: rörelse, nålen, fiender, besvärjelser, all rendering
src/world.js      Banans geometri, fiendeplacering, ljus och amulett
src/physics.js    AABB-kollision, gravitation, coyote time
src/input.js      Tangentbord, mus och touch → spelaktioner
src/audio.js      Syntetiserat ljud via WebAudio
server.mjs        Minimal statisk server utan beroenden
tests/smoke.mjs   Headless speltest (mekanik + bot som spelar banan)
tests/render.mjs  Renderar PNG-frames utan webbläsare (valfritt)
```

## Testa

```bash
npm test                                   # mekanik + bot-genomspelning
npx --yes @napi-rs/canvas npm run shots    # skriv ut bilder till ./shots
```
