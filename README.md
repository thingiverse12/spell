# Spell

**Lågpoly-firstperson-överlevnad i webbläsaren — spelbar prototyp.** · **Low-poly first-person browser survival — playable prototype.**

En delad ö, samla trä och sten, bygg en bas, håll dig varm om natten, slåss mot
vildsvin och (om du vill) mot varandra. Ingen nedladdning, ingen motorlicens,
ingen byggkedja: Node.js-server + WebGL-klient i rena ES-moduler.

This repository turns the design report into a running prototype. The server is
authoritative; the client predicts its own movement with **the same physics code
the server runs**, so it feels instant and stays in sync.

---

## Snabbstart / Quick start

Krav: **Node.js 18+** (testat på 22) och en webbläsare med WebGL2.

```bash
npm install          # three.js (klient) + ws (server)
npm start            # startar på http://localhost:8080
```

Öppna <http://localhost:8080>, skriv ett namn och tryck **Spela**.
Öppna fliken i två fönster (eller två enheter i samma nätverk) för att se
multiplayern: den andra spelaren dyker upp direkt, och ni ser varandras byggen.

Useful environment variables:

```bash
PORT=9000 SEED=42 DATA_DIR=./server/data-special node server/index.js
```

| Variabel | Betydelse | Default |
|---|---|---|
| `PORT` | HTTP/WebSocket-port | `8080` |
| `HOST` | Bind-adress (måste vara `0.0.0.0` i containrar) | `0.0.0.0` |
| `SEED` | Världens seed → identisk terräng för alla | `1337` |
| `DATA_DIR` | Var världen sparas | `server/data` |

## Kontroller / Controls

| Tangent | Funktion |
|---|---|
| `W A S D` | Gå |
| `Skift` / `Shift` | Springa (kostar stamina + mer hunger) |
| `Mellanslag` / `Space` | Hoppa |
| `Ctrl` | Smyga |
| Vänsterklick | Samla / slå (mot nod, djur eller spelare) |
| Högerklick | Äta eller använda valt föremål · ta bort byggdel i byggläge |
| `E` | Öppna/stänga dörr · äta nästa mat om ingen dörr finns |
| `1`–`9`, mushjul | Välja verktyg (hotbar = ryggsäckens 9 första platser) |
| `Tab` | Ryggsäck (föremål + recept) |
| `C` | Tillverka |
| `B` | Byggläge (spökmodell, `R` roterar, högerklick river) |
| `M` | Karta |
| `T` | Chatt |
| `R` | Reparera valt verktyg · rotera byggdel |
| `Esc` | Inställningar (paus) |
| `F1` / `F3` | Hjälp / felsökningsinfo (fps, ping, korrigeringar) |

## Vad som faktiskt fungerar / What actually works

* **Server-auktoritativ simulering** i 20 Hz med klientprediktion,
  reconciliation och interpolation (120 ms) för andra spelare och djur.
* **Deterministisk värld** (512 × 512 m ö, seed-styrd) som genereras ur delad kod
  — klient och server är alltid överens om marken.
* **Intressehantering**: bara det som är inom 220 m skickas; statiska entiteter
  skickas som delta. Bandbredden ligger på några kbit/s per spelare.
* **Samlande, crafting, bygge** (4 m-rutnät, stödregler, dörrar, rivning med
  50 % återvinning, decay/upkeep så att världen inte fylls av övergivna baser).
* **Överlevnad**: hunger, törst, stamina, andning, nattkyla, fallskada, död och
  respawn. Dödade spelare tappar hälften av sina resurser.
* **Djur med enkel AI** (rådjur flyr, vildsvin anfaller) och **PvP** med
  server-auktoritativ skada och loot.
* **Persistens**: byggnader, inventory och progression överlever omstart och
  återanslutning (atomiska skrivningar var 20:e sekund).
* **Komplett HUD/UI**: ryggsäck, receptlista, byggmeny, karta, chatt,
  inställningar, döds- och frånkopplingsskärm, **svenska och engelska**.
* **Allt ljud genereras i webbläsaren** (Web Audio) — inga ljudfiler behövs.

## Vad som *inte* är byggt / Known limitations

Detta är en prototyp, inte ett färdigt spel:

* **Ingen autentisering** — spelar-id:t skapas i webbläsaren. (Byt mot OAuth/Steam.)
* **Ingen anti-cheat utöver serverauktoritet** — ingen rörelseheuristik, ingen
  beteendeloggning, ingen rate limiting.
* **Ingen kryptering i dev** — kör bakom en reverse proxy med TLS i drift.
* **En serverprocess per värld**, ~30 spelare. Skalningsvägen (Postgres/Redis,
  CDN, en process per värld) finns beskriven men är inte byggd.
* **Ingen XP/teknikträd, ekonomi, grottor, väder eller kläder** — planerat till
  Alpha/Beta, se [roadmap](docs/sv/roadmap.md).
* **Ingen riktig asset-pipeline** — allt är primitiver och proceduralt ljud.

## Testa / Testing

```bash
npm test              # server + multiplayer-harness med bot-klienter   (26 kontroller)
npm run test:client   # klientens egen net.js mot en live-server        (15 kontroller)
npm run test:ui       # DOM-id:n, i18n, importer, importmap, CSS        (213 kontroller)
npm run test:dom      # HUD:en i jsdom: barer, hotbar, recept, byggmeny (65 kontroller)
npm run test:render   # scenlogik: terräng, instanser, byggnader, djur  (65 kontroller)
npm run test:all      # allt ovan = 384 kontroller
npm run verify:browser  # riktig Chromium via puppeteer (kräver nedladdad Chrome)
```

Fullt webbläsartest (frivilligt, laddar ner Chromium en gång):

```bash
npm i -D puppeteer && npx puppeteer browsers install chrome
npm run verify:browser
```

`npm test` startar en riktig server på en ledig port och kör två bot-klienter
som spelar igenom hela loopen: handskakning, deterministisk terräng,
prediktionsavvikelse (< 25 cm), samlande, avståndsavvisning, crafting, bygge,
replikering till en andra spelare, PvP-skada och persistens över en omstart.

`npm run test:dom` och `npm run test:render` kör klientkoden i jsdom utan GPU:
HUD:ens alla paneler (barer, hotbar, ryggsäck, recept, byggmeny, karta, chatt,
språkbyte) och scenslogiken (terränggeometri, instansierade noder, dörrar som
öppnas, skadetint, djurs interpolation, spökmodell för bygge).

`npm run verify:browser` testar klienten i en riktig webbläsare: inga
konsolfel, att duken faktiskt renderar (pixelvarians), att HUD:en får data och
att spelaren kan gå — och sparar skärmdumpar i `screenshots/`. Saknas Chromium
faller den tillbaka på en statisk kontroll av att alla moduler laddas.

## Projektstruktur

```
shared/            kod som BÅDE klient och server importerar
  config.js          alla spelsiffror (fysik, recept, byggdelar, nätverk)
  noise.js           deterministisk världsgenerering + biom + dag/natt
  physics.js         rörelse och kollision (identisk på båda sidor)
  prediction.js      LocalWorld, Predictor, Interpolator, NetStats
server/
  index.js           HTTP + WebSocket + 20 Hz tick-loop + delta-replikering
  world.js           chunk-streaming, noder, djur, byggindex, persistens
  rules.js           all auktoritativ spellogik
client/              körs direkt i webbläsaren, ingen byggkedja
  index.html         importmap: "three" -> /vendor/three.module.js
  src/main.js        spelloop, input, interaktion, rendering
  src/net.js         WebSocket-klient med prediktion/reconciliation
  src/terrain.js     terräng, vatten, himmel, sol, kartbild
  src/entities.js    noder (instanserade), byggnader, djur, spelare, vy-modell
  src/hud.js         HUD, ryggsäck, recept, byggmeny, karta, inställningar
  src/audio.js       proceduralt ljud (Web Audio)
  src/i18n.js        svenska/engelska
  vendor/            three.js r169 (endast byggfil, MIT)
test/
  harness.js         server + bot-klienter (26 kontroller)
  client-net.js      klientens net.js mot live-server (15 kontroller)
  ui-static.js       DOM/i18n/import-konsistens (130 kontroller)
  hud-dom.js         HUD/UI-beteende i jsdom (65 kontroller)
  render-logic.js    scenlogik utan GPU i jsdom (65 kontroller)
  dom-env.js         delad jsdom-miljö + canvas-2D-stubbe
  browser.js         puppeteer-smoketest + statisk fallback
docs/
  sv/ en/            GDD, arkitektur, roadmap på båda språken
  REPORT_CHECKLIST.md  varje rekommendation i rapporten: byggt / delvis / planerat
```

## Dokumentation

| Dokument | Svenska | English |
|---|---|---|
| Game Design Document | [docs/sv/GDD.md](docs/sv/GDD.md) | [docs/en/GDD.md](docs/en/GDD.md) |
| Arkitektur | [docs/sv/arkitektur.md](docs/sv/arkitektur.md) | [docs/en/architecture.md](docs/en/architecture.md) |
| Roadmap | [docs/sv/roadmap.md](docs/sv/roadmap.md) | [docs/en/roadmap.md](docs/en/roadmap.md) |
| Rapport → implementation | [docs/REPORT_CHECKLIST.md](docs/REPORT_CHECKLIST.md) | samma fil |

## Så hänger det ihop / How it fits together

```
webbläsare ── input 30 Hz ──▶ server (20 Hz tick, auktoritativ)
   ▲                              │
   └── snapshot + ev ─────────────┘
        │
   spola tillbaka till serverns tillstånd, spela upp obekräftad input
```

1. Varje input prediceras lokalt direkt (ingen fördröjning i känslan).
2. Servern simulerar samma input med samma fysikmodul och kvittar `seq`.
3. Klienten jämför: stämmer det inte (> 2 cm) korrigeras det, annars inget märks.
4. Andra spelare och djur ritas 120 ms i det förflutna och interpoleras mjukt.

Fuskskyddet hänger på samma princip: klienten kan bara be om saker (samla den
noden, slå, bygg där), och servern avgör om det är tillåtet — avstånd, material,
marklutning, cooldown och tid.

## Licens

Prototypkod: MIT. `client/vendor/three.module.js` är three.js r169 (MIT, © three.js
authors). Inga andra externa tillgångar används.

---

## English summary

`npm install && npm start`, open <http://localhost:8080>, pick a name, press Play.
Share the URL with a friend on the same machine/network and you are playing
together — same island, same buildings, server-authoritative combat.

The interesting engineering bit: `shared/` is imported *unchanged* by both the
Node server and the browser client (the server serves `/shared/*`), so client
prediction and server simulation can never drift apart. Player movement is
predicted locally, verified by the server, and reconciled on every snapshot;
remote players and animals are interpolated 120 ms in the past.

Test it: `npm run test:all` runs 384 checks — the server/multiplayer harness
(26), the real client network module against a live server (15), DOM/i18n
consistency (130), HUD behaviour in jsdom (65) and scene/render logic without a
GPU (65). `npm run verify:browser` additionally drives a real Chromium and saves
screenshots when Chrome is available.

Read the design in [docs/en/GDD.md](docs/en/GDD.md), the engineering in
[docs/en/architecture.md](docs/en/architecture.md), the plan in
[docs/en/roadmap.md](docs/en/roadmap.md), and the report-to-code mapping in
[docs/REPORT_CHECKLIST.md](docs/REPORT_CHECKLIST.md).
