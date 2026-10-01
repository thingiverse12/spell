# Spell — Game Design Document (sv)

> **Version:** 0.1 (prototyp) · **Datum:** 2026-10-01
> Dokumentet beskriver spelet som faktiskt är byggt, och märker tydligt ut vad som är
> nästa steg. Alla siffror är desamma som i `shared/config.js` — vill du ändra balansen
> ändrar du där, och både klient och server följer med.

---

## 1. Vision och designpelare

**Vision:** ett lågpolyspel för överlevnad i webbläsaren där en grupp vänner kan
kliva in i en delad ö, samla, bygga och försvara sig mot väder, vildmark och
varandra — utan att installera något, utan en kraftfull dator, och utan att
vänta på en 40 GB nedladdning.

**Pelare**

1. **Direkt in, direkt igång.** En URL, en klick, spelbar inom några sekunder.
2. **Friktion med mening.** Svält, kyla och natt är hot som går att planera mot
   — inte straff som känns godtyckliga.
3. **Bygget är berättelsen.** Basen är spelarens avtryck i världen och överlever
   mellan sessioner.
4. **Konflikt är valfri.** PvP finns, men Världen ska vara njutbar att spela
   ensam eller i co-op.
5. **Samma regler för alla.** Servern äger sanningen; klienten får aldrig en
   fördel av att fuska.

**Målgrupp:** spelare som gillar *Valheim*s samarbete, *Rust*s basbygge och
*Unturned*s låga instegströskel. Sessioner på 20–90 minuter.

## 2. Spellökar

**Stund (0–5 min):** vakna, orientera sig, slå en buske och ett träd, göra en
stenyxa. Känslan ska vara "jag förstår vad jag gör".

**Session (20–90 min):** samla resurser → bygga skydd → hantera hunger/törst →
utforska → möta djur eller andra spelare → lägga grunden till nästa session.

**Långsiktigt (dagar):** flytta från handkraft till verktyg, sten till träbas,
ensam till grupp; försvara bygget mot decay och plundring.

## 3. Världen

* **Storlek:** 512 × 512 m ö, genererad från en seed. Terrängen är deterministisk:
  samma seed ger samma ö i klient och server (och över omstarter).
* **Upplösning:** 4 m rutnät, platt skuggning, vertexfärger. Lågpoly är ett
  designval, inte en nödlösning: det håller nere polygonantal och gör att en
  integrerad GPU orkar.
* **Biomer:** vatten, strand, gräs, skog, klippa, snö — styr vilka resurser och
  djur som finns var. Skog ger mest trä, klippa mest sten, strand nästan inget.
* **Streaming:** världen laddas i 64 m-chunkar runt spelarna; klienten får bara
  entiteter inom 220 m (intressehantering).
* **Dag/natt:** ett dygn = 10 minuter. Natt = ca 38 % av dygnet. Natt ger kyla
  (skada utan lägereld) och sämre sikt.

## 4. Överlevnad

| Stat | Max | Nedbrytning | Effekt vid 0 |
|---|---|---|---|
| Hälsa | 100 | — | Dödsfall, respawn vid startpunkten |
| Hunger | 100 | Tom på ~15 min | 1,6 hp/s |
| Törst | 100 | Tom på ~12 min | 2,2 hp/s |
| Stamina | 100 | −13/s vid sprint, +11/s efter 1,1 s | Ingen sprint/hopp |
| Andning | 100 | Tom på 18 s under vatten | 6 hp/s (drunkning) |

* **Regenerering:** hälsa +1,2 hp/s när hunger och törst > 45.
* **Kyla:** på natten tar spelaren 0,4 hp/s om ingen lägereld finns inom 9 m.
* **Fallskada:** över 18 m/s fallhastighet, 3,2 hp per m/s därutöver.
* **Sprint** kostar hunger/törst 60 % snabbare — resurshantering är en
  avvägning mot tempo.

**Designnot:** siffrorna är avsiktligt generösa i prototypen (15 min till hunger)
så att en utvecklare eller testare hinner uppleva byggandet utan att ständigt
jaga mat. Skärpning sker efter speltest.

## 5. Resurser och samlande

| Nod | HP | Verktyg | Utbyte per slag | Respawn | Bonus |
|---|---|---|---|---|---|
| Träd | 100 | Yxa (26) / hand (8) | Trä 1–3 | 4 min | 25 % chans till fiber; +4 trä när den fälls |
| Sten | 100 | Hacka (26) / hand (8) | Sten 1–3 | 7 min | +3 sten när den är slut |
| Bärbuske | 24 | Hand (8) | Bär 1 | 2,5 min | 50 % chans till fiber |

* Utbytet skalar med verktygets skick: handkraft ger ca en tredjedel.
* Verktyg har hållbarhet (yxa/hacka 220, spjut 180, fackla 400) och tar 1 poäng
  per slag. De kan repareras för material.
* Allt samlande sker inom 3,4 m (`COMBAT.reach`) och valideras av servern —
  klienten kan inte samla på avstånd.

## 6. Crafting och progression

| Recept | Kräver | Station | Kategori |
|---|---|---|---|
| Fiberrep | 5 fiber | – | Resurs |
| Stenyxa | 3 trä, 2 sten, 2 fiber | – | Verktyg |
| Stenhacka | 3 trä, 3 sten, 2 fiber | – | Verktyg |
| Spjut | 4 trä, 1 sten, 2 fiber | – | Verktyg |
| Fackla | 2 trä, 1 fiber | – | Verktyg |
| Grund | 6 trä | – | Byggdel |
| Vägg | 4 trä | – | Byggdel |
| Dörr | 6 trä, 2 sten | – | Byggdel |
| Lägereld | 8 sten, 4 trä | – | Byggdel |
| Tillagat kött | 1 rått kött | Lägereld | Mat |

**Progressionskurva i prototypen**

1. **Handkraft** — överlev första minuten, slå buskar och unga träd.
2. **Stenyxa** — fyrdubblar samlandet och öppnar bygget.
3. **Skydd** — grund + väggar + dörr; lägereld mot nattkylan.
4. **Jakt** — spjut, kött, skinn (skinn är reserverat för nästa nivå: kläder).

**Planerat (Alpha):** XP och tekniknivåer, blueprints i grottor, verktygs- och
vapendelar, klädeslager med värme/vikt, forskningsstation. Formeln från
rapporten (`100 · 1,1^(n−1)`) behålls som utgångspunkt men trimmas efter speltest,
eftersom ren exponentiell XP-kurva snabbt gör sena nivåer meningslösa.

## 7. Bygge

* **Rutnät:** byggdelar snäpper mot terrängrutnätet (4 m). Golv och lägereld
  fyller en ruta; väggar och dörrar snäpper mot en av rutans fyra kanter
  (rotation 0–3, N/Ö/S/V).
* **Stöd:** väggar och dörrar kräver en grund i rutan (eller i rutan intill) —
  annars måste marken vara plan (< 0,45 lutning). Golv kräver plan mark
  (< 0,85) och kan inte ligga i vatten.
* **HP:** grund 500, vägg 400, dörr 300, lägereld 200.
* **Rivning:** spelaren får tillbaka 50 % av materialet.
* **Decay/upkeep:** varje byggdel har en decay-tid (6 h). Spelarens närvaro inom
  12 m förnyar timern; annars tappar delen 4 hp/s och försvinner till slut. Det
  håller världen fri från övergivna baser (samma problem som Rust löser med
  upkeep) utan att kräva ett fullt resurslager-system i MVP.
* **PvP-plundring:** på PvP-servrar kan väggar och dörrar forceras (planerat),
  vilket gör försvar — dörrar, höga väggar, läge — meningsfullt.

## 8. Strid

* **Räckvidd:** 3,4 m, kon ~57° framåt, 2,4 m vertikalt, 0,55 s cooldown.
* **Skada:** hand 8, stenyxa 22, spjut 34, stenhacka 15 (mot djur).
* **Djur:** rådjur flyr (45 hp), vildsvin anfaller inom 12 m (80 hp, 14 skada).
* **Död:** spelaren tappar hälften av sina resurser och mat (inte verktyg — de
  förstörs i stället, som i Rust), och respawnar vid startpunkten.
* **PvP/PvE:** prototypen är PvP-på. Planerat: serverreglage för PvP av/på, samt
  separata regler för loot vid död.

## 9. Inventory och föremål

* 12 platser i ryggsäcken; de 9 första speglas i hotbaren (1–9, mushjul).
* Staplar: resurser 200, mat 100, verktyg 1.
* Verktyg har hållbarhet som visas som en tunn stapel i inventory och hotbar.
* Flytt och sammanslagning av staplar görs server-auktoritativt (`moveitem`).

## 10. UI/UX

* **HUD:** hälsa/stamina/hunger/törst/andning, klocka med dag/natt, hotbar,
  kompasslös karta (`M`), chatt (`T`), kontextuell tipsrad.
* **Ryggsäck (`Tab`)** med flikar för föremål och recept; recept visas med
  "har/kräver" och gråas ut när de inte går att tillverka.
* **Byggläge (`B`)** med spökmodell som visar giltighet i grönt/rött, rotation
  med `R`, rivning med högerklick.
* **Inställningar (`Esc`):** siktavstånd, FOV, musens känslighet, skuggor, ljud,
  språk (svenska/engelska), "enkel grafik" för svaga GPU:er.
* **Tillgänglighet:** text i DOM (skalbar, kontrastrik), ikoner vid sidan av
  färger, tangentbordsgenvägar för allt, ingen information som enbart förmedlas
  med färg, ljud kan stängas av.

## 11. Ljud

Allt ljud genereras i webbläsaren med Web Audio (inga filer): vindbädd, fotsteg,
hugg, sten, svärdshugg, bygge, såg, ätande och en dovare klang vid död. Det gör
prototypen helt självständig — men produktionsversionen bör gå över till
inspelade OGG-loopar med HRTF-panning, som rapporten föreslår.

## 12. Balansfilosofi

1. **Allt ska gå att förstå utan text.** Grönt = bra, rött = dåligt, tydliga
   ikoner, ljudåterkoppling.
2. **Första verktyget inom 60 sekunder.** Annars tappar nyfikna spelare.
3. **En resurs per roll.** Trä = struktur, sten = verktyg/värme, fiber =
   bindningar, skinn = (framtida) skydd.
4. **Ingen grind utan alternativ.** Saknar du material kan du alltid byta aktivitet.
5. **Siffror är billiga att ändra.** Allt ligger i `shared/config.js`; ändra där
   och kör `npm test` för att se att inget går sönder.

## 13. Öppna frågor inför speltest

* Är 15 min till hunger för långt (händelselöst) eller för kort (stressigt) i en
  45-minuterssession?
* Känns decay-tiden 6 h rimlig för en spelare som spelar 1 h/dag?
* Ska nattkylan vara dödlig eller bara obehaglig?
* Räcker 12 inventory-platser, eller behövs ryggsäckar (rapportens förslag om
  viktbaserat inventory) redan i Alpha?
* Blir byggrutnätet 4 m för grovt när spelare vill bygga tak och andra våningar?
