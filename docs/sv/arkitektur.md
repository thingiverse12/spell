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
| `npm test` | Riktig server + bot-klienter: multiplayer, fysik/prediktion, skörd, crafting, bygge, strid och persistens (32 kontroller). |
| `npm run test:client` | Webbläsarens egen `client/src/net.js` mot live-servern (22). |
| `npm run test:ui` | DOM-id:n, i18n, importmap, CSS och importer (271). |
| `npm run test:dom` | HUD:en i jsdom: staplar, snabbrad, recept, bygge, karta och chatt (65). |
| `npm run test:render` | Scenlogik utan GPU: terräng, triangelriktning, instanser, byggnader och djur (73). |
| `npm run test:camera` | Pitch/roll, drag-look, NaN och klick kontra drag (43). |
| `npm run test:controls` | Tangenter, mus, hjul, paneler, död/frånkoppling och HUD-knappar (119). |
| `npm run test:ground` | Yta, fotavtryck, begravda objekt, serverrevision och klientinterpolation (59). |
| `npm run test:models` | Palett, geometri, material, storlekar, budgetar och planterade modellfel (117). |
| `npm run test:catalog` | De åtta modellkategorierna; varje verklig modell byggs och placeringskontrolleras en i taget (178). |
| `npm run test:errors` | Protokollfuzz, namn/input-skydd, karaktärens tillstånd, reparationer och serverns felräknare (72). |
| `npm run verify:browser` | Riktig Chromium när den finns; annars statisk modulkontroll. |

`npm run test:all` kör de 11 Node-sviterna: **1 051 kontroller**. CI kör samma
kommando vid varje push och PR; `verify:browser` försöker dessutom Chromium.

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


## 13. Kontroller (regel: alla kontroller ska fungera)

Varje tangent, musknapp, hjulsteg och HUD-knapp är ett **beslut** i
`client/src/controls.js`, så att samma regel kan köras i test. `main.js` äger
biverkningarna; modulen äger besluten.

| Kontroll | Gör | Test |
|---|---|---|
| `W A S D` | gå (hålls) | keyIntent → `hold`, läses bara via `HOLD_CODES` |
| `Skift` / `Ctrl` | spring / smyg (hålls) | keyIntent → `hold` |
| `Mellanslag` | hoppa (hålls) | keyIntent → `hold` |
| Vänsterklick | samla / slå / bygg (i byggläge) | pekarlås: direkt; dragläge: kort klick utan rörelse |
| Högerklick | ät/använd, dörr, riv (byggläge) | samma uppdelning som vänsterklick |
| `1`–`9`, mushjul | välja verktyg | hjul stegar **båda** hållen och slår runt åt båda hållen |
| Klick i snabbraden | väljer verktyg | jsdom: klick på plats 3 → `equip(2)` |
| `E` | öppna dörr, annars ät | keyIntent → `use` |
| `R` | reparera, eller rotera i byggläge | keyIntent → `repair` / `rotate` |
| `Tab` / `C` / `B` / `M` | ryggsäck / tillverka / byggläge / karta | keyIntent → egen sorts panelväxling |
| `T` | chatt | keyIntent → `chat` (och inmatningen nollställs) |
| `Esc` | stänger det översta, annars inställningar | `escapeIntent`: settings → help → chat → inventory → build → map |
| `F1` / `F3` | hjälp / felsökningsinfo | fungerar även i menyn och när man är död |
| Alla "Stäng"-knappar | stänger sin panel | jsdom: 5 knappar, var och en stänger **rätt** panel |
| Respawn / anslut igen / gäst | knappar i skärmarna | bundna i main.js, fokus släpps efter klick |

Regler som var riktiga buggar och nu är testade:

| Fel | Vad som hände | Fix |
|---|---|---|
| Döda stäng-knappar | alla fem "Stäng"-knappar saknade bindning — klicket gjorde ingenting | `bindHudControls` binder dem och testet kräver att rätt panel stängs |
| Tangentupprepning | att hålla `B`/`C`/`M`/`Tab` växlade panelen ~30 gånger i sekunden | `keyIntent` ignorerar `repeat` för allt utom håll-tangenter |
| Fastnade rörelsetangenter | öppnade man chatten medan man gick fortsatte man gå | `clearInputs` vid panel/chat + `typing` nollar inmatningen |
| Spökklick med mellanslag | en klickad knapp behöll fokus; mellanslag (hoppa) aktiverade den igen | fokus släpps efter varje knappklick |
| Handlingar efter döden | man kunde öppna ryggsäcken och byta verktyg liggande död | bara `Esc`, `F1`, `F3` svarar när död/frånkopplad |
| Hjul tillbaka från "tomt" läge | hoppade från plats 9 till 8 i stället för att slå runt | hjulintentet räknar från rätt ände |

F3-panelen visar `kontroller n` — antalet bundna HUD-kontroller — så att en
kontroll som tappar sin bindning syns direkt i spelet.


## 14. Inget får hamna under marken

Samma kod (`shared/ground.js`) används av server och klient, så de är eniga om
var marken är. Marken *under en yta* är inte samma sak som marken i *en punkt*:
en vägg är 4 m bred, så en vägg placerad på höjden i sin mittpunkt kan bli
begravd upp till ~1 m på den uppåtlutande sidan.

| Regel | Varför | Test |
|---|---|---|
| Ytan under ett **fotavtryck** = högsta punkten | en 4 m bred vägg får inte slukas av en sluttning | syntetisk sluttning: fotavtryck 2 m högre än mitten |
| Platta delar (grund, lägereld) mäts i **mitten** | en plattform *ska* skära in i en backe | samma sluttning, grund = inget fel |
| Vägg på bar mark baseras på fotavtryckets topp; lyft > 0,2 m kräver grund | annars grävs väggen ner | `needs-foundation` på brant cell, accepteras på plan |
| Djur och spelare **lyfts** av revisionen | serverns simulering är sanningen | planterat fel: djur 1,95 m under ytan → lyfts, rapporteras |
| Byggnader **rapporteras** men flyttas aldrig | att tyst flytta en struktur skulle förstöra den | planterat fel: vägg 1,52 m under ytan, `y` oförändrad |
| Klienten lyfter interpolerade kroppar | en rät linje mellan två ticks på en sluttning går *under* backen | 40 bildrutor över en brant: aldrig under ytan |
| Revision varannan sekund på servern | fångar äldre sparade världar efter en geometriändring | `checked` > 100, `buried === 0` efter en spelomgång |

Felen syns på tre ställen: serverloggen (`[spell:ground] … objects below the
surface`), `/api/status` (`world.ground` med `checked/lifted/buried/worst`) och
F3-panelen i spelet (`under mark: n`). `world.ground.checkedBy` visar exakt
hur många spelare, djur, levande noder och byggnader som ingick i samma
revisionsbild; det jämförs inte med en senare, förändrad chunkstatus. Klienten
lägger också händelsen i fel-listan (`window.__spellErrors`, högst en rapport
var 5:e sekund).


## 15. Modellerna (regel: design → färger → material → kvalitet → fel)

Alla färger bor i `client/src/palette.js` (`PALETTE` för saker i världen, `SKY`
för ljus, himmel och vatten). Innan låg hex-literaler utspridda i `entities.js`
och `terrain.js`, vilket gjorde att ingen kunde svara på "är rådjuret samma
bruna som vildsvinet?" eller "hur många material skapar 200 väggar?".

**Design — modellen ska vara den storlek speldatan säger.** Om silhuetten och
kollisionsboxen säger olika saker siktar man på en sak och träffar en annan.

| Modell | Före | Efter |
|---|---|---|
| Rådjur | 2,54 m (speldatan säger 1,50) | **1,50 m** |
| Vildsvin | 1,32 m (speldatan säger 1,00) | **1,00 m** |
| Träd | 9,0 m (designen säger 7) | **7,0 m** |
| Sten | 0,26 m **under marken** | vilar på marken |
| Buske | 0,14 m **under marken** | vilar på marken |
| Lägereld | 1,60 m bred (boxen är 1,40) | ryms i boxen |
| Spelare | fötterna 0,04 m över marken | fötterna i **y = 0** |

**Färger.** Paletten har 17 namngivna världsfärger + 14 himmelsfärger, inga
dubbletter, alla giltiga. Djurens färger i `shared/config.js` måste finnas i
paletten (testat), så speldatan och renderaren inte glider ifrån varandra.
Skadetinten använde `color.setScalar(ratio)` — det sätter R=G=B, så en skadad
trävägg blev **grå**. Nu multipliceras palettfärgen, så nyansen finns kvar.
Spelarfärgen skickas som HSL med kommatecken eftersom Three.js 0.169 tolkade
modern HSL med mellanslag som **vit**. Äldre sparfiler migreras vid laddning och
testet provar `THREE.Color`, inte bara att strängen ser giltig ut.

**Material.**

| Före | Efter |
|---|---|
| Varje byggdel klonade ett material | ett material per (del, skadenivå), delade |
| Varje byggdel skapade sin egen geometri | en geometri per (del, storlek) |
| Varje djur skapade 6-7 geometrier | fyra delade djurgeometrier |
| Huvudet skapade ett nytt skinnmaterial per spelare | ett delat skinnmaterial |

**Kvalitet (mätt, inte gissat).** Varje mesh prövas mot en budget: 5 000
trianglar per mesh, 300-400 per modell, 400 meshes per scen. En scen med
120 noder, 40 djur, 60 byggdelar och 8 spelare landar på ~13 000 trianglar och
ett tiotal material — low-poly som designen lovar.

**Fel.** `auditScene()` mäter scenen var tredje sekund och rapporterar NaN i
vertexdata, geometri utan trianglar, mesh utan material, färg utanför paletten
och budgetöverskridanden. F3 visar `modeller n meshes/tris/mat` och
`modellfel: n`; felen hamnar också i `window.__spellErrors`. `npm run test:models`
kör 117 kontroller, inklusive planterade fel (NaN, tom geometri, för tung mesh,
fel färg) och beviset att en frisk scen ger noll fel.


## 16. Åtta modellkategorier — bygg och kontrollera en i taget

`client/src/modelCatalog.js` är den enda katalogen för modellerna. Varje rad
anger kategori, verklig vy-byggare, budget och placeringsregel; testet bygger
varje vy från `entities.js` eller `terrain.js` en åt gången — det är inte en
frikopplad skiss som kan glida från spelet.

| # | Kategori | Antal | Innehåll | Placeringskontroll |
|---|---|---:|---|---|
| 1 | Djur | 2 | rådjur, vildsvin | fot i markytan; höjd enligt `ANIMALS` |
| 2 | Mark | 5 | terräng, vatten, himmel, stjärnor, sol/måne | terrängens spann; havsnivå; himmelns insida; stjärnor och sol i skyn |
| 3 | Vapen | 2 | stenyxa, spjut | i handen, framför kameran |
| 4 | Material | 3 | träd, sten, bärbuske | modellen vilar på marken; rätt gameplay-mått |
| 5 | Karaktär | 2 | spelarkropp, förstapersonshand | fötter på markytan; hand framför kameran |
| 6 | Bygge | 4 | grund, vägg, dörr, lägereld | 4 m-rutnät, rätt rotation, kollisionsbox |
| 7 | Utrustning | 2 | stenhacka, fackla | i handen, framför kameran |
| 8 | Textur | 3 | namnskylt, byggmarkör, resursmarkering | skylt fäst ovanför kroppen; markörer genomskinliga |

MVP:ns geometri är flat-shaded och palettstyrd; ingen extern bildtextur/CDN
behövs. Namnskylten är en riktig canvas-textur. Material, färg och textur granskas
tillsammans, i stället för att bildfiler kan avvika från modellens färg.

Resultatet vid senaste körningen: **23 modeller, 34 236 trianglar**, alla inom
budget och på rätt plats. `npm run test:catalog` har 178 kontroller: 8 kategorier,
unika ids, full täckning av djur/noder/byggdelar, varje modell byggd och granskad
för mått/färg/material/kvalitet/placering, plus planterade placeringsfel.
F3 visar `modellkatalog 23/8` och antal i varje kategori.

## 17. Karaktärs- och serverfel

Karaktären granskas en gång i sekunden **efter att markhöjden har räknats ut**:
ändliga koordinater och fart, värden inom världen, fot på markytan, pitch,
hälsa/hunger/törst/stamina/andning, dödflagga, ryggsäckens 12 platser och vald
verktygsplats. Självlagning är avsiktligt begränsad till värden som går att
återställa säkert: NaN-position går tillbaka till senast giltig position,
karaktären lyfts ur marken, orimlig fart begränsas och trasig ryggsäck får en
säker lokal struktur. Servern förblir auktoritet och nästa snapshot synkar om.

Servern sanerar spelarens namn och varje input vid WebSocket-gränsen. `Infinity`,
`NaN`, strängar som inte är tal och rörelsevärden utanför [-1, 1] kan inte läcka
in i fysiken. Trasig URL-kodning får HTTP 400 och `/shared/` kan inte användas
för att läsa serverfiler. Ett fel i en inkommande handling fångas och räknas i
`/api/status.errors` i stället för att slå ut spel-loopen. F3 visar
`karaktär: …`, `serverfel: n` och senaste serverfel; `window.__spellErrors` sparar
klienthändelserna.

`npm run test:errors` skickar trasig URL/JSON, alla typer av namn, extrema inputs,
skräp i varje handling, överstora paket och planterade fel i karaktären mot en
egen server. Senast: **72/72 gröna**, noll serverundantag, inga null/NaN i
positionerna.
