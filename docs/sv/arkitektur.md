# Spell — arkitektur (teknisk översikt)

> Status: **prototyp implementerad**. Det som står i kursiv stil är planerat men inte byggt.
> Koden finns i `server/`, `client/` och `shared/`; siffror och regler är hämtade direkt ur
> `shared/config.js` så att dokument och kod inte glider ifrån varandra.

## 1. Översikt

```
                    ┌──────────────────────────────┐
                    │        Webbläsare            │
                    │  WebGL2 (three.js, ESM)      │
                    │  ┌────────────────────────┐  │
                    │  │ shared/physics.js      │  │  ← exakt samma kod som
                    │  │ shared/prediction.js   │  │    servern kör
                    │  │ shared/noise.js        │  │
                    │  └────────────────────────┘  │
                    └───────┬───────────────┬──────┘
             HTTPS (statik) │               │ WSS /ws (spelprotokoll)
                            ▼               ▼
                    ┌───────────────┐ ┌────────────────────────────┐
                    │ Statiska      │ │  Spell-server (Node.js)    │
                    │ filer         │ │  ┌──────────────────────┐  │
                    │ /client       │ │  │ Tick-loop 20 Hz      │  │
                    │ /shared       │ │  │ rules.js (auktoritet)│  │
                    │ /vendor       │ │  │ World (chunks, AI)   │  │
                    └───────────────┘ │  └──────────┬───────────┘  │
                           ▲          │             │              │
                           │          │      JSON-persistens       │
                     *CDN (prod)*     └─────────────┬──────────────┘
                                                     ▼
                                        server/data*/world-<seed>.json
                                        *(prod: Postgres + Redis, se §7)*
```

**Grundprincipen**: klienten skickar bara *input*, servern äger all sanning
(loot, skada, crafting, bygge, tid, AI). Klienten predikterar sin egen rörelse
med samma modul som servern använder, och stämmer av mot varje snapshot
(reconciliation). Det gör att spelet känns omedelbart trots att servern är
auktoritativ — och det gör fusk svårare än i en klientauktoritativ modell.

## 2. Komponenter

| Komponent | Fil(er) | Ansvar |
|---|---|---|
| Konfiguration | `shared/config.js` | Alla spelsiffror: fysik, survival, recept, byggdelar, nätverksparametrar. Delas av klient och server. |
| Världsgenerering | `shared/noise.js` | Deterministisk hashning, value noise, fbm, höjdfält, biomer, solvinkel. Samma seed → identisk terräng överallt. |
| Fysik | `shared/physics.js` | Kapsel-kollision mot terräng och byggnader, steg upp-funktion, simning, stamina, fallskada (rapporteras tillbaka). |
| Prediktion | `shared/prediction.js` | `LocalWorld` (kollisionsvärld från replikerade byggnader), `Predictor` (rewind + replay av obekräftad input), `Interpolator` (andra spelare visas ~120 ms i det förflutna), `NetStats`. |
| Spellogik (auktoritativ) | `server/rules.js` | Skörd, melee/PvP, crafting, bygge, dörrar, rivning, ätande, inventory-flytt, reparation, survival-nedbrytning, död/respawn. |
| Världen | `server/world.js` | Chunk-streaming (64 m), noder, djur, AI, byggindex, day/night, decay, spara/ladda JSON. |
| Spelserver | `server/index.js` | HTTP (statik + `/api/*`), WebSocket-protokoll, 20 Hz tick-loop, intressehantering, delta-replikering, autosave, avstängning. |
| Klient | `client/src/*` | Rendering, HUD, input, UI-paneler, ljud, nätverksklient. Ingen byggkedja: rena ES-moduler + importmap. |

### Varför delade moduler?
Det här är den viktigaste arkitekturkonstruktionen i prototypen. Klient och
server importerar **samma** `config.js`, `noise.js`, `physics.js` och
`prediction.js` (webbläsaren hämtar dem från `/shared/*`, Node läser dem från
disken). Därmed kan prediktion och auktoritet inte glida isär på grund av
dubblerad kod — en klassisk källa till rubber-banding i nätkodade spel.

## 3. Simulering och nätverk

* **Tickrate:** 20 Hz (`NET.tickRate`). Rapporten föreslår 20–30 Hz för ett
  överlevnadsspel — vi ligger i nedre kanten eftersom det räcker för bygge,
  samlande och närstrid och ger lägre CPU-kostnad per spelare.
* **Input:** klienten skickar 30 input/s (`NET.inputRate`) med sekvensnummer.
  Servern simulerar dem i ordning, högst 1,35 × realtid per tick (skydd mot
  speedhack), och kvittar `seq` i varje snapshot.
* **Reconciliation:** klienten sparar obekräftad input, och vid varje snapshot
  spolar den tillbaka till serverns tillstånd och spelar upp det som ännu inte
  bekräftats. Avvikelse > 2 cm räknas som korrigering (syns i F3-overlayn).
* **Interpolation:** andra spelare och djur visas `NET.interpDelayMs` (120 ms)
  bakåt i tiden, vilket ger mjuk rörelse även vid paketförluster.
* **Intressehantering:** bara entiteter inom `NET.interestRadius` (220 m) skickas.
  Statiska entiteter (noder, byggnader) skickas som *delta* med versionsnummer
  (`v`), djur som lätta arrayer varje tick. Typisk bandbredd i prototypen:
  ensiffriga kbit/s per spelare.
* **Transport:** WebSocket (JSON) över TLS i produktion. WebRTC-datachannels är
  den troliga uppgraderingen för rörelsetrafik om latensen blir ett problem —
  protokollet är medvetet enkelt nog att kunna bytas ut bakom `client/src/net.js`.

## 4. Protokoll

### Klient → server

| Meddelande | Fält | Beskrivning |
|---|---|---|
| `hello` | `playerId, name` | Identifierar spelaren (id sparas i localStorage, återanslutning återställer progression). |
| `input` | `seq, dt, yaw, pitch, wish, strafe, jump, sprint, crouch` | 30 Hz. `wish`/`strafe` ∈ [-1,1]. |
| `action` | `a, rid, …` | `harvest{id}`, `melee`, `craft{id}`, `place{piece,cx,cz,rot}`, `door{id}`, `demolish{id}`, `use{slot}`, `equip{slot}`, `moveitem{from,to}`, `repair{slot}`, `respawn`. |
| `chat` | `text` (≤200 tecken, 1,2 s cooldown) | Broadcastas till alla. |
| `ping` | `id, at` | RTT-mätning. |

### Server → klient

| Meddelande | Innehåll |
|---|---|
| `welcome` | `seed`, `world{size,grid,seaLevel,maxHeight}`, `config`, `time01`, `day`, `you{x,y,z,yaw,inv,toolSlot,spawn}`, spelarlista |
| `snap` | `tick, time01, day, ack`, `you{seq,x,y,z,vx,vy,vz,health,hunger,thirst,stamina,breath,onGround,inWater,inv,toolSlot,kills,deaths,killsAnimal,dead}`, `players[]`, `nodes[]` (upsert), `nrem[]`, `animals[]`, `buildings[]` (upsert), `brem[]`, `ev[]` |
| `res` | `a, r, ok, …` — svar på varje action (inkl. `place`) |
| `ev` | `swing`, `hurt`, `died`, `respawned`, `placed`, `door`, `buildingGone`, `join`, `leave`, `chat`, `chatSlow` |
| `pong` | `id, at, now, serverTime` |

Så länge `data`-fälten hålls desamma kan transporten bytas (t.ex. binärt format
eller WebRTC) utan att röra spellogiken.

## 5. Datamodell och persistens

Prototypen sparar ett JSON-dokument per värld (`server/data*/world-<seed>.json`)
med:

* `buildings[]` — byggnader med cell, rotation, höjd, hp, ägare, decay-tid
* `players{}` — position, stats, inventory, statistik (nycklas på spelar-id)
* `deadNodes[]` — bara *döda* noder och deras respawn-tid (terrängen genereras om
  från seed, den lagras aldrig)
* `time01`, `day`, `nextBuildingId`

Skrivning sker atomiskt (temp-fil + `rename`) var 20:e sekund, vid frånkoppling
och vid `SIGTERM`/`SIGINT`. Vid uppstart saneras spelarobjekt
(`sanitizePlayer`) så att äldre sparfiler som saknar nya fält inte kraschar
simuleringen — ett fel som faktiskt uppstod under utvecklingen och nu täcks av
test 7 i harnessen.

**Produktionsväg (rapportens rekommendation):** Postgres för transaktionell
data (inventory, ekonomi, byggnader), Redis för sessioner och hot state,
objektlagring/S3 för världsbackuper, replikering mellan zoner.

## 6. Skalbarhet

| Nivå | Åtgärd |
|---|---|
| Nuvarande (prototyp) | En process, ~30 spelare (`NET.maxPlayers`), chunk-streaming, intressehantering. Uppmätt minne i tom värld: några tiotal MB. |
| 50–100 spelare | Dedikerad nod per värld; flytta persistens till Postgres/Redis; statiska filer till CDN; vertikal skalning först (simuleringen är single-threaded per värld). |
| Fler världar | En serverprocess per värld/seed (horisontellt), lastbalanserare som routar `wss://…/ws?world=id`, delad DB. |
| Stora världar / regioner | Dela kartan i zoner med ägarskap per process och spelaröverlämning (dyrare: kräver gränssnittsprotokoll och "interest handover"). Rekommenderas först när en värld inte längre får plats i en process. |

För att mäta: `/api/status` (tick, minne, uptime, spelarlista) kan pollas av
Prometheus/Grafana; `server.stats()` ger världsstatistik.

## 7. Drift och kostnader

| Post | Prototyp | Produktion (50–100 samtidiga, en region) |
|---|---|---|
| Spelserver | 1 process, valfri VM | 2 × (2 vCPU/8 GB) för redundans, ca $60–160/mån |
| Databas | JSON-fil | Postgres (db.t3.medium) + Redis, ca $60–120/mån |
| Statik/CDN | samma process | CloudFront/S3, ca $20–50/mån |
| Bandbredd | försumbar | ca $50–120/mån vid moderat trafik |
| Övervakning | loggar + `/api/status` | Prometheus/Grafana eller motsvarande, ca $0–50/mån |
| **Summa** | **$0 (lokal VM)** | **ca $250–500/mån** |

Detta ligger i linje med rapportens uppskattning ($300–500/mån för liten/medium
skala). Kostnaden domineras av antalet *världar*, inte av antalet spelare, så
länge varje värld ryms i en process.

## 8. Säkerhet och anti-cheat

**Implementerat i prototypen**

* Serverauktoritet: rörelse, skada, loot, crafting och bygge valideras server-side.
* Klienten kan inte sätta sin egen hälsa, position eller sitt inventory —
  input innehåller bara önskad rörelse och avsikter.
* Tidsbudget per tick hindrar att man skickar in extra många input för att
  simulera snabbare än realtid.
* Intervallkontroller: skörd (`COMBAT.reach`), bygge (`BUILD.reach`), dörrar,
  rivning, chatt-cooldown, max meddelandestorlek (16 kB), idle-timeout.
* Deterministisk terräng → klienten kan inte "hitta på" mark.

**Saknas medvetet (MVP-avgränsning, dokumenterat i `docs/*/roadmap.md`)**

* Ingen autentisering (spelar-id kommer från klienten) → byt mot OAuth/Steam-token.
* Ingen kryptering i dev (TLS/WSS i drift via reverse proxy).
* Ingen rörelseheuristik utöver tidsbudgeten, ingen loggning av misstänkt
  beteende, ingen kärnnivå-anti-cheat (ingen sådan finns för webbläsare).
* Ingen rate limiting på HTTP-nivå eller skydd mot DDoS.

Eftersom webbläsarklienter är lätta att modifiera är strategin densamma som
rapporten förespråkar: **håll hemlig logik på servern**, validera allt, logga
avvikelser, och undvik spellägen där fusk förstör för andra (t.ex. ren PvE-co-op
som standard).

## 9. Prestanda (klient)

* Terrängen är **en** mesh (129×129 höjder → 32 768 trianglar), platt skuggning
  och vertexfärger: inga texturer, få draw calls.
* Resursnoder ritas med `InstancedMesh` per del (stam, krona, sten, buske) —
  hundratals noder i några draw calls.
* Djur, spelare och byggnader är enkla lågpolymodeller; byggnader delar geometri
  men har egna material (för att kunna visa skadetint).
* LOD ersätts av *fog + siktavstånd*; instanserna utanför siktavståndet är kvar
  men skyms av dimman, vilket är billigare än att bygga om buffertar per frame.
* `settings.simpleGraphics` stänger av skuggor, sänker pixel ratio och kortar
  siktavståndet — för svaga integrerade GPU:er.
* Skuggor: ett riktat ljus med 1024²-karta som följer spelaren (kan stängas av).

## 10. Reproducerbarhet och test

| Kommando | Vad som verifieras |
|---|---|
| `npm test` | Startar en riktig server och två bot-klienter: handskakning, deterministisk terräng, **terräng/fysik-konsistens** (spawn, noder på ytan, begravd spelare lyfts upp, unstick), auktoritativ rörelse + prediktionsavvikelse, skörd, avståndsavvisning, crafting, bygge, replikering, PvP, persistens över omstart (31 kontroller). |
| `npm run test:client` | Kör **klientens egen** `client/src/net.js` mot en live-server med `ws` som WebSocket-stand-in: handskakning, prediktion, skörd, inventory, bygge, events (15 kontroller). |
| `npm run test:ui` | Statisk kontroll av DOM-id:n, i18n-nycklar, importmap, CSS-selektorer **och att varje importerat namn faktiskt exporteras** av målmodulen (213 kontroller). |
| `npm run test:dom` | Kör **HUD:en på riktigt** i jsdom mot `client/index.html`: barer, klocka, hotbar, ryggsäck, receptlista, byggmeny, karta, chatt, språkbyte (65 kontroller). Hittade bl.a. att byggdelar saknades i `ITEMS` och att recept-callbacks kunde bli inaktuella. |
| `npm run test:render` | Scenlogik utan GPU: terränggeometri, **trianglarnas riktning (framsidor uppåt — buggen där marken bara syntes underifrån)**, att fysikens höjdsampling är exakt den renderade ytan, instanspooler, dörrar, skadetint, interpolation, spökmodell (71 kontroller). |
| `npm run verify:browser` | Riktig Chromium (puppeteer): konsolfel, att duken faktiskt renderar, skärmdumpar. Hoppar till statisk modulkontroll om ingen webbläsare finns. |

Totalt **406 kontroller**. CI-förslag: `npm run test:all` på varje push, `npm run verify:browser` på natten
eller före release (kräver nedladdad Chromium).

## 11. Robusthet (live-preview och drift)

Nätverksfel är normalfallet, inte undantaget, och behandlas därför explicit:

* **Klienten återansluter själv** med backoff (1 s → 15 s) när anslutningen
  tappas, och visar "Återansluter … (försök n)" med stängningskoden i stället för
  ett obegripligt fel. När servern är tillbaka fortsätter spelaren där den var
  (progressionen ligger på servern).
* **Felsökning i klienten:** vid misslyckad anslutning görs först en
  `/api/status`-förfrågan. Svarar HTTP men inte WebSocket sägs det rakt ut
  ("servern vägrar spelanslutningen — kontrollera proxyn/porten"); svarar inget
  alls står det att servern är offline. Adressen (`wss://…/ws`) och koden visas.
* **Dubblettspelare:** samma webbläsare delar `localStorage`, så en andra flik
  får samma spelar-id. Servern stänger då med kod `4001`, och klienten byter
  automatiskt till en flikbunden gästidentitet (`sessionStorage`) och berättar
  det. Det gör "öppna två flikar för att se multiplayern" friktionsfritt.
* **Servern överlever fel:** tick-loopen, meddelandehanteraren och processen har
  skyddsnät (`uncaughtException`, `unhandledRejection`) som loggar och fortsätter
  i stället för att döda en pågående värld.
* **Proxy-vänlig WebSocket:** uppgraderingar accepteras på `/ws`, `/` och
  `/socket` (vissa proxys prefixar om sökvägen), och allt annat nekas. Felet
  loggas, så en felkonfigurerad proxy syns i serverloggen i stället för att bara
  bli ett tyst fel i webbläsaren.

## 12. Kamera och kontroller (regler som testas)

Kamerafel är de enda fel som gör spelet ospelbart, så reglerna är uttryckta som
tester i `test/camera.js` (43 kontroller) snarare än som avsikter:

| Regel | Varför | Test |
|---|---|---|
| Pitch klipps till ±89° (`PITCH_LIMIT`) | vid exakt 90° vänds upp-vektorn och vyn blir upp-och-ned utan att gå att rätta | 1000 drag i vardera riktningen når aldrig zenit/nadir |
| Roll är **alltid** exakt 0 | lutning får vyn att kännas felvänd | 50 slumpade bildrutor, roll === 0 |
| Rotationen sätts som en helhet `(pitch, yaw, 0, 'YXZ')` | att sätta x och y var för sig behöll roll från en tidigare `lookAt()` | `checkCamera` flaggar roll > 1e-6 |
| Mus upp = titta upp | skärmkonvention | 4 tester, med och utan inverterad Y |
| Första musrörelsen i drag-läge ger **noll** delta | jämförelsen skedde mot ett oanvänt (0,0) → kameran small i taket så fort man började dra | regressionstest: delta 0, sedan rimliga deltan |
| Orimliga hopp klipps vid 180 px och NaN ignoreras | pekaren som lämnar fönstret eller syntetiska events får inte förgifta rotationen | 400 rörelser med hopp och NaN → vinkeln förblir giltig |
| Kameran går aldrig under marken (golv på markyta + 0,25 m) | annars ser man världen inifrån | 60 bildrutor från y = −50 stannar ovanför ytan |
| Drag = titta, **klick** = handla | annars hugger man varje gång man tittar | `isTap`: kort tryck utan rörelse = klick |
| Självkontroll varje bildruta | NaN eller lutning upptäcks och **repareras** i stället för att visa en trasig värld | 6 tester som matar in fel och kräver att de hittas |

Dessutom: `window.onerror` och `unhandledrejection` fångas i klienten, visas som
en toast och listas i F3-panelen (`fel: n — senast: …`). Arrayen finns som
`window.__spellErrors` för att kunna läsas direkt i webbläsarkonsolen. Det är
så "det är lite errors" blir ett åtgärdbart fel i stället för en gissning.

Utan pekarlås (vanligt i inbäddade preview-rutor) byter klienten automatiskt
läge och skriver ut det i tipsraden: *dra för att titta · klick för att handla*.
