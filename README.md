# Lykttändaren — ett minne i skymningen

Ett pusselplattformsspel i en skog som aldrig riktigt somnar. Du är en liten
lykttändare som gick ut i mörkret efter en röst som lät som din egen — och nu
letar din följeslagare Glim efter dig. Hitta tre minnen, bär dem till altaret i
Lykthuset och möt dig själv i det inre rummet.

Byggt i ren HTML, CSS och JavaScript (canvas). Inga beroenden, inga bildfiler,
ingen ljudfil — all grafik ritas i kod och allt ljud syntetiseras.

## Starta

```bash
npm start          # http://localhost:4173
```

> Öppna via en server, inte som `file://` (spelet använder ES-moduler).

## Spela

| Styrning | Gör |
| --- | --- |
| `A` `D` / piltangenter | Gå |
| `SPACE` / `Z` | Hoppa (en gång till i luften) |
| `J` / vänster mus | **Ladda staven** — släpp för att kasta |
| `W` | Sikta ljuset uppåt |
| `S` (i luften) + full laddning | Bomben stöter dig uppåt |
| `E` / `Enter` | Vrid speglar, spela in ekon, vila vid lyktan, använd altaret |
| `ESC` | Paus · `M` ljud av/på |

### Staven i tre steg

| Laddning | Effekt |
| --- | --- |
| Kort tryck (< 0,3 s) | **Knuff** — en liten ljusorb som tänder, knuffar stenar och skingrar mygg |
| Ett andetag (0,3–0,9 s) | **Stråle** — bränner rankor, tänder lyktor och skär genom mygg |
| Ett helt andetag (> 0,9 s) | **Bomb** — ljus i en radie, knuffar allt och ger rekyl (hoppa med `S` i luften) |

### Världen — sex rum

```
            Spegellunden ──► Stenkammaren ──► Ekokammaren
                  ▲                                 │
Törngården ──► Lykthuset ◄─────────────────────────┘
                  │
                  └──► (altaret, med tre minnen) Det inre rummet
```

| Rum | Pusslet |
| --- | --- |
| **Lykthuset** | Navet. Bänken vid lyktan fyller hjärtan, altaret öppnar slutet. |
| **Törngården** | Bränn tre rankor, tänd tre eldar → porten öppnas. Första minnet. |
| **Spegellunden** | Vrid två speglar så ljuset från sändaren träffar mottagaren. Andra minnet. |
| **Stenkammaren** | Knuffa två runstenar på två plattor. Båda samtidigt → porten. |
| **Ekokammaren** | Spela in ditt eget eko och låt det stå på en platta medan du står på den andra. Tredje minnet. |
| **Det inre rummet** | Slutet. |

Du kan gå tillbaka genom alla rum när du vill — dörrar och karta hänger ihop.

### Svårighet som anpassar sig

Skogen lyssnar. Faller du ofta blir den lugnare (färre mygg, inga taggar, längre
viskningar från Glim). Löser du pussel snabbt blir den vaksammare (fler mygg,
taggar som gör ont, snabbare faror). Nivån visas i pausmenyn.

## Struktur

```
index.html        Canvas + HUD (hjärtan, minnen, laddningsmätare, viskningar)
css/style.css     HUD, menyer, touch-kontroller
src/main.js       Bootstrap, spelloop, HUD-synk, skärm- och tangentlogik
src/game.js       Spellogik: rörelse, stavens tre nivåer, pussel, ljus, rendering
src/world.js      Sex rum: geometri, pusselobjekt, dörrar, minnestexter
src/physics.js    AABB-kollision och strålkastning/spegling för ljusstrålar
src/input.js      Tangentbord, mus och touch → spelaktioner
src/audio.js      Syntetiserat ljud (laddningshum, lyktor, ekon, vind)
server.mjs        Minimal statisk server utan beroenden
tests/smoke.mjs   Headless speltest: mekanik + alla fem pussel spelas igenom
tests/render.mjs  Renderar PNG-frames utan webbläsare (valfritt)
```

## Testa

```bash
npm test                                   # alla pussel + mekanik
npx --yes @napi-rs/canvas npm run shots    # bilder till ./shots
```
