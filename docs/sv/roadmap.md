# Spell — Roadmap och prioriteringar

> Rapportens ursprungliga Gantt-diagram hade några fel (release-milstolpen låg *före*
> beta-fasen, aktivitetsmarkeringar stämde inte med datumen, och flera rader saknade
> beroenden). Här är en rättad plan. Utgångspunkt: **oktober 2026**, då prototypen är klar.

## Nuläge (klart)

| Område | Status |
|---|---|
| Deterministisk världsgenerering (delad kod) | ✅ |
| Server-auktoritativ rörelse, fysik, kollision | ✅ |
| Klientprediktion + reconciliation + interpolation | ✅ |
| Nätverk (WebSocket, intressehantering, delta-replikering) | ✅ |
| Samlande, crafting, inventory | ✅ |
| Bygge (rutnät, stöd, dörrar, rivning, decay) | ✅ |
| Survival (hunger, törst, stamina, andning, kyla, fallskada) | ✅ |
| Djur med enkel AI | ✅ |
| PvP med server-auktoritativ skada och loot | ✅ |
| Persistens + autosave + återanslutning | ✅ |
| HUD, inventory, crafting-UI, byggläge, karta, inställningar, sv/en | ✅ |
| Proceduralt ljud | ✅ |
| Testsvit (301 kontroller, 5 sviter) | ✅ |
| Autentisering, anti-cheat utöver serverauktoritet | ❌ medvetet |
| Grafik/animationspolish, XP-system, ekonomi | ❌ nästa steg |

## Faser

### M0 — Prototyp (klar, oktober 2026)
Bevisar att tekniken håller: en webbläsare, en server, flera spelare, bygge som
överlever omstart. **Framgångskriterium:** två spelare kan tillsammans samla,
bygga en bas och se varandra röra sig mjukt i en webbläsare.

### M1 — MVP (nov 2026 → feb 2027, ~3–4 mån)
Målet är "en främling kan börja spela utan att någon förklarar".

| Prioritet | Funktion |
|---|---|
| Måste | Riktig autentisering (OAuth/GitHub eller Steam), sessioner |
| Måste | Grundläggande anti-cheat: rörelseheuristik, avvikelselogg, kick på avvikelse |
| Måste | Deployment: Docker, reverse proxy med TLS, CDN för statiska filer |
| Måste | Onboarding: första-5-minutersguide, målhintar, tydligare dödsorsak |
| Måste | Speltest-runda 1 (10–20 externa spelare), mät: tid till första verktyg, sessionlängd |
| Bör | Ryggsäckar/vikt (rapportens inventory-förslag) |
| Bör | Serverval: PvP/PvE och spawn-regler |
| Kan | Enkel statistik/leaderboard i webb-UI |

### M2 — Alpha (mar → jul 2027, ~5 mån)
Målet är "innehållet räcker för veckor, inte timmar".

| Prioritet | Funktion |
|---|---|
| Måste | XP + tekniknivåer, blueprints i grottor |
| Måste | Fler djurarter + ekosystem (bytesdjur, rovdjur, respawnbalans) |
| Måste | Grottor och sällsynta resurser (metall → bättre verktyg) |
| Måste | Robust telemetri: tick-tid, minne, bandbredd per spelare, felspårning |
| Måste | CI/CD: `npm run test:all` + `verify:browser` på varje push |
| Bör | Hird/klaner, enkel handel, gemensam basbehörighet |
| Bör | Väder och årstider (regn, snö, temperatur) |
| Kan | Modstöd (serverplattform, Steam Workshop-liknande lösning) |

### M3 — Beta (aug → okt 2027, ~3 mån)
Målet är "släppbart för en betalande publik".

| Prioritet | Funktion |
|---|---|
| Måste | Prestandapass: instansering av byggnader, LOD, GPU-budgetmätningar |
| Måste | Anti-cheat: beteendeanalys, rate limits, DDoS-skydd |
| Måste | Backendflytt till Postgres + Redis, backup/återställning testad |
| Måste | Balansrunda 2 utifrån telemetri (hunger, decay, loot) |
| Måste | Tillgänglighetsgenomgång (kontrast, tangentbindningar, textstorlek) |
| Bör | PvP-raidmekanik (forcera väggar), fällor |
| Bör | Kläder/rustningar med värme/vikt |
| Kan | Fordon, elektricitet, NPC-bosättningar |

### Release 1.0 (nov 2027 →)
Polering, lokalisering, butik/kosmetika (aldrig pay-to-win), kundsupport och
moderation. Kostnadsbild och drift finns i [arkitektur.md §7](arkitektur.md).

```mermaid
gantt
  title Spell — rättad plan (utgångspunkt okt 2026)
  dateFormat YYYY-MM-DD
  axisFormat %b %y
  section Prototyp
  Prototyp klar (M0)            :done,    m0, 2026-10-01, 1d
  section MVP
  Autentisering + anti-cheat    :active,  m1a, 2026-11-01, 60d
  Deployment + CDN + TLS        :         m1b, 2026-12-01, 45d
  Onboarding + speltest 1       :         m1c, 2027-01-15, 45d
  section Alpha
  XP, tekniknivåer, blueprints  :         m2a, 2027-03-01, 60d
  Ekosystem: fler djur, grottor :         m2b, 2027-04-15, 75d
  Telemetri, CI/CD, hird/handel :         m2c, 2027-06-01, 60d
  section Beta
  Prestanda + LOD + instanser   :         m3a, 2027-08-01, 45d
  DB-flytt + backup/restore     :         m3b, 2027-08-15, 45d
  Balans + tillgänglighet       :         m3c, 2027-09-15, 45d
  section Release
  Releasekandidat + sluttest    :         rel, 2027-11-01, 30d
  Lansering 1.0                 :milestone, lan, 2027-12-01, 1d
```

## Vad vi medvetet skar bort ur MVP (och varför)

| Rapportförslag | Beslut | Motiv |
|---|---|---|
| "Fullt dynamiskt ekosystem" | Skjuts till Alpha | Kräver simuleringstid per tick; utan mätdata riskerar det att äta tickbudgeten. |
| Viktbaserat inventory | Bör i M1 | Rapportens förslag är bra, men 12 platser räcker för att testa kärnloopen. |
| Unity WebGL | Ersatt av three.js | Ingen byggkedja, ingen 40 MB WASM-bundle, snabbare iteration; Unity passar först när animationer/asset-pipeline är tunga. |
| WebRTC-datachannels | Skjuts upp | WebSocket räcker för 20 Hz-tick och är trivialt att drifta. Protokollet är transportagnostiskt. |
| BattlEye/anti-cheat i klient | Omöjligt i webbläsare | Ingen kärnintegritet finns; satsa på serverauktoritet och beteendeanalys. |

## Beroenden och risker (kopplade till planen)

| Risk | Sannolikhet | Påverkan | Åtgärd i planen |
|---|---|---|---|
| Klientprestanda på svaga maskiner | Medel | Hög | Inställningen "enkel grafik" finns redan; GPU-budgetmätning i M3. |
| Fusk i webbläsare | Hög | Medel | Serverauktoritet (klart), heuristik + logg i M1, PvE som standard. |
| Kostnader skenar med många världar | Medel | Medel | En värld per process, mät via `/api/status`, kostnadsmodell i arkitekturdokumentet. |
| Scope: för mycket innehåll | Hög | Hög | MoSCoW-listorna ovan; varje fas har ett mätbart framgångskriterium. |
| Nätverkslatens för närstrid | Medel | Låg | Cooldown 0,55 s och kon-baserad träff gör striden mindre latenskänslig. |
