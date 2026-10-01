# Rapport → implementation / Report → implementation

Varje avsnitt i den ursprungliga rapporten, vad som byggts, var det finns och vad
som återstår. · Every section of the original report: what was built, where it
lives, and what remains.

Legend: ✅ byggt och testat · 🟡 delvis / förenklat · ⬜ planerat (se roadmap)

| # | Rapportens avsnitt | Status | Var / kommentar |
|---|---|---|---|
| 1 | Konkurrentanalys (Rust, Valheim, The Forest, Eco, Unturned) | 🟡 | Ligger till grund för designvalen i [GDD](sv/GDD.md): Valheims co-op-enkelhet, Rusts upkeep/raid, Unturnedens låga tröskel, Econ:s varning för inlärningskurva. Själva jämförelsetabellen är inte kopierad in i repot. |
| 2 | Tekniska krav: WebGL/WASM-klient | 🟡 | WebGL2 via three.js (`client/`). WASM valdes bort: fysiken är billig nog i JS, och en WASM-bundle hade kostat nedladdningstid. Trådlöshet (ingen Web Worker än) är fortfarande en flaskhals. |
| 2 | LOD & chunk-streaming | 🟡 | Chunk-streaming: ✅ (`server/world.js`, 64 m). LOD: ersatt av dimma + siktavstånd (billigare i webbläsare); riktig LOD ⬜ i M3. |
| 2 | Nätverk: WebSockets, ingen rå socket | ✅ | `client/src/net.js` + `server/index.js`. WebRTC-datachannels ⬜ (protokollet är transportagnostiskt). |
| 2 | Server-auktoritär modell | ✅ | `server/rules.js`; klienten skickar bara input och avsikter. Verifieras av test 2 och 6 i `npm test`. |
| 2 | Tickrate 20–30 Hz | ✅ | 20 Hz (`NET.tickRate`), input 30 Hz. |
| 2 | Databas och persistens (SQL + cache) | 🟡 | JSON-persistens med atomiska skrivningar + autosave + sanering av gamla sparfiler. Postgres/Redis ⬜ i M3 (plan i [arkitektur.md §5](sv/arkitektur.md)). |
| 2 | Skalbarhet (molntjänster, CDN, sharding) | ⬜ | Skalningsmodell beskriven i [arkitektur.md §6](sv/arkitektur.md); en process per värld är byggd, CDN/DB utflyttning är inte. |
| 2 | Latenskorrigering (prediktion, reconciliation, interpolation) | ✅ | `shared/prediction.js` används av både webbläsaren och testbotarna; harnessen mäter avvikelsen (< 0,25 m). |
| 2 | Säkerhet: validering, TLS, anti-cheat | 🟡 | Validering ✅ (avstånd, material, mark, cooldown, tidsbudget, meddelandestorlek, idle-timeout). Autentisering, TLS i drift och heuristisk fuskdetektion ⬜ i M1. |
| 3 | MVP-innehåll (motor, rörelse, samla, stenya, hunger, enkel bas, 2P co-op) | ✅ | Allt i listan finns och testas: `npm test` avsnitt 2–6. |
| 3 | Alpha-innehåll (50 spelare, inventory, byggdelar, enkla fiender, väder, persistence, anti-cheat) | 🟡 | Inventory ✅, byggdelar ✅, fiender (djur) ✅, persistence ✅. 50 spelare ⬜ (kapacitetstest), väder ⬜, anti-cheat ⬜. |
| 3 | Beta-innehåll (ekosystem, teknologiträd, byggförsvar, klaner, optimering, admin-verktyg) | ⬜ | Planerat i [roadmap](sv/roadmap.md) M2–M3. Dörrar och decay finns som grund för byggförsvar. |
| 3 | Release-innehåll (grottor, NPC, elektricitet, fordon, polering) | ⬜ | Utanför prototypen. |
| 4 | Komponentdiagram (klient, CDN, auth, spelserver, DB) | 🟡 | Klient + spelserver + statik är byggt; CDN/auth/DB är planerade. Diagram uppdaterat i [arkitektur.md §1](sv/arkitektur.md). |
| 4 | Rekommenderade teknologier (Unity/Godot, Node + Colyseus, Postgres/Redis) | 🟡 | Node ✅. Motorn är three.js i stället för Unity WebGL (motivering i [roadmap](sv/roadmap.md)), nätverket är egen WebSocket-kod i stället för Colyseus, DB är JSON i stället för Postgres. Alla tre bytena är medvetna och dokumenterade. |
| 4 | Säkerhet och anti-cheat (WSS, token, fuskdetektion, obfuskering) | 🟡 | Serverauktoritet ✅, WSS vilande på reverse proxy ⬜, token ⬜, obfuskering ej relevant (ingen hemlig logik i klienten). |
| 5 | XP och nivåer (`100 · 1,1^(n−1)`) | ⬜ | Formeln behålls som utgångspunkt i GDD §6 men är inte implementerad; prototypens progression är verktygsbaserad. |
| 5 | Resurser och respawn | ✅ | `NODES` i `shared/config.js` (2,5–7 min) + `server/world.js` respawn-timers. |
| 5 | Föremålsraritet och loot-tabeller | 🟡 | Drops per djur ✅ (kött/skinn). Raritetsklasser ⬜. |
| 5 | Verktygs-durabilitet och reparation | ✅ | `ITEMS` (hållbarhet) + `rules.repair`, visas i HUD. |
| 5 | Vapenmodifikation | ⬜ | Planerat till Alpha. |
| 5 | Rustningar/kläder med stats | ⬜ | Planerat till M3 (värme/vikt). |
| 5 | Inventory och vikt | 🟡 | 12 platser, staplar och server-auktoritativ flytt ✅. Vikt/ryggsäckar ⬜ (M1). |
| 5 | Ekonomi och handel | ⬜ | Utanför MVP. |
| 5 | PvP/PvE-inställningar och dödsstraff | 🟡 | PvP ✅ med 50 % resursförlust. Serverväxel för PvP ⬜ (M1). |
| 5 | Base persistence, decay/upkeep, plundring | ✅ / 🟡 | Decay + upkeep ✅. Forcera väggar vid raid ⬜. |
| 6 | HUD, inventory, crafting-UI, karta, inställningar | ✅ | `client/src/hud.js` + `client/index.html`; tangentbindningar och skalbar text. |
| 6 | Prestandaoptimering (batching, textur-atlas, culling) | 🟡 | Instansierade noder, en terrängmesh, vertexfärger (inga texturer), dimma i stället för LOD ✅. Riktig culling/atlas behövs inte eftersom texturer inte används. |
| 6 | Ljud och musik (Web Audio, 3D-ljud) | 🟡 | Proceduralt Web Audio ✅ (fotsteg, hugg, bygge, vindbädd). Inspelade OGG-loopar och HRTF-panning ⬜ (M2). |
| 6 | Tillgänglighet | 🟡 | Ikoner + text vid sidan av färg, kontrast, alla kommandon har tangentbord, ljud av/på, språkval ✅. Remappning av tangenter, färgblindläge och textskalning i UI ⬜ (M3-genomgång). |
| 7 | 3D-pipeline (Blender, LOD, atlas, rigg) | ⬜ | Prototypen använder primitiver. Pipeline är planerad till M2–M3; `docs/*/roadmap.md` listar stegen. |
| 7 | Versionering och CI/CD | 🟡 | Git ✅, `npm run test:all` ✅. GitHub Actions-workflow ⬜ (nästa steg, kräver repo-inställningar). |
| 8 | Drift och kostnadsuppskattning | 🟡 | Kostnadsmodell uppdaterad med faktiska komponenter i [arkitektur.md §7](sv/arkitektur.md); övervakning via `/api/status` ✅, Prometheus/Grafana ⬜. |
| 9 | Riskanalys (prestanda, fusk, omfång, nätverk, kostnader, balans) | ✅ | Risktabellen finns i [roadmap](sv/roadmap.md) med åtgärder kopplade till faser och kod. |
| 9 | Roadmap 12 månader | 🟡 | Rättad i [roadmap](sv/roadmap.md): originaldiagrammet hade release före beta och felaktiga statusmarkeringar. Nu med MoSCoW per fas. |
| 10 | Källor och vidare läsning | ✅ | Påståenden om Unity WebGL (inga sockets, ingen trådning), WebSocket/WebRTC och anti-cheat stämmer med respektive dokuments kända innehåll; konkurrentdata (plattformar, monetisering) är oförändrad från rapporten och bör verifieras mot butikssidor innan den används externt. |

## Vad prototypen bevisar

1. **Tekniken håller:** en webbläsare kan rendera en 512 m ö i 60 fps utan
   nedladdning, med server-auktoritativ simulering och prediktion som inte glider isär
   (mätt i test 2, avvikelse < 0,25 m).
2. **Nätverket skalar ned:** intressehantering + delta-replikering ger några kbit/s
   per spelare i stället för hundratals.
3. **Innehållsloopen fungerar:** samla → verktyg → bygg → överlev natten, och
   basen finns kvar efter omstart (test 7).
4. **Delad kod är rätt väg:** klient och server kan inte hamna i otakt eftersom de
   importerar samma fysik, konfiguration och brusfunktioner.

## Vad som måste lösas innan release

Autentisering · TLS-terminering och rate limiting · riktig databas med backup och
återställning · rörelseheuristik och beteendeloggning · kapacitetstest med 50+
spelare · speltest med externa spelare för balans (hunger, decay, loot) ·
tillgänglighetsgenomgång · riktig asset-pipeline för modeller, animationer och ljud.
