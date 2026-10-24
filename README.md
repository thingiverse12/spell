# Den sista lågan

Ett top-down äventyr i en värld som håller på att slockna. Du är främlingen som
kommer till byn Vedstorp i den långa natten. Byn lovade elden att bära den
vidare — och glömde. Nu tar förbannelsen tillbaka sitt.

Spelbart direkt i webbläsaren. Vanilla JS, canvas 2D, inga beroenden, inget
byggsteg.

## Starta

```bash
npm start          # http://0.0.0.0:4173
```

Eller öppna `index.html` via valfri statisk server. Inget installeras.

## Spela

| Tangent | Gör |
| --- | --- |
| `W A S D` / piltangenter | gå |
| `J` | hugg med svärdet |
| `K` | **parera** (timing) eller håll för sköld |
| `L` | använd valt föremål |
| `1` `2` `3` | fackla · båge · bomber |
| `Tab` | byt föremål |
| `Q` | sätt en lykta på marken |
| `E` / `Enter` | prata, tänd, öppna, gå ned |
| `M` | karta |
| `Esc` | paus |

### Pareringen

Det viktigaste knepet i spelet. Fienden **lyser upp och drar fram en kil** innan
den slår — tryck `K` i det ögonblicket. En perfekt parering:

- avbryter attacken och kastar fienden baklänges (stagger),
- ger dig ett fönster där varje hugg gör dubbel skada,
- saktar ner tiden en kort stund.

Håller du `K` i stället blir det en sköld: den stoppar slag framifrån men ger
ingen fördel. Bakifrån träffar allt.

### Eld är både vapen och verktyg

- **Facklan** tänder eldar (stora ljuskällor) och skrämmer bort skuggor.
- **Lykta (`Q`)** lämnar ett ljus där du står. Skuggor kan inte gå in i ljuset,
  och de som redan står i det brinner upp. Lyktorna kostar olja, och olja fyller
  du vid brunnen i byn.
- **Bågen** öppnar saker på håll (det finns ögon i väggarna i kryptan).
- **Bomberna** spränger sprickor i sten.

I mörka zoner tar kylan dig långsamt om du står utanför ljuset. Ljuset är inte
bara taktik — det är överlevnad.

## Världen

En sammanhängande karta i fem zoner, plus en kyrka under jorden:

```
                    Vindberget
                         │
   Vedskogen ── Stenringen ── Kärret
        │            │
        └── Vedstorp ┘
```

| Zon | Vad som händer |
| --- | --- |
| **Vedstorp** | Byn. Smed, värdshus, handlare, präst, jägare, barn. Den stora slocknade elden. |
| **Vedskogen** | Mörk skog, skuggor, bågen i en kista. |
| **Stenringen** | Ruinerna där löftet gavs. Tre eldar öppnar vägen ned. |
| **Kärret** | Vatten, bågskyttar, dimma. |
| **Vindberget** | Högt uppe, kallt, utsikt över allt. |
| **Under Stenringen** | Tre våningar: Förgården, Kryptan, Hjärtat. |

### Byn

- **Halvor (smed)** härdar svärdet för glöd. Tre nivåer.
- **Inga (värdshus)** helar dig och fyller oljan.
- **Bote (handlare)** säljer bomber, pilar och olja för glöd.
- **Vidar (präst)** berättar vad som faktiskt hände.
- **Ylva (barn)** vet mer än de vuxna tror.
- **Rurik (jägare)** ger dig ett extra hjärta om du tänder fyra eldar ute i världen.

Glöd får du av skuggor, krukor och kistor. Allt sparas automatiskt — stänger du
fliken fortsätter du där du var, eller vid elden om du dog.

## Dungeon

Tre våningar, tre pusseltyper som var för sig lär dig en mekanik:

1. **Förgården** — tänd två eldar, grinden öppnar sig.
2. **Kryptan** — en vägg delar rummet. Skjut ögat i väggen för att öppna övre
   grinden, eller spräng den spruckna nedre halvan med en bomb.
3. **Hjärtat** — **Förbannelsen**. Den slår, skickar chockvågor och reser
   skuggor ur golvet i sin andra fas. Parera den, och den vacklar.

Efter bossen bär du tillbaka lågan och tänder den stora elden i Vedstorp.

## Svårighet

Ingen meny. Mörkret är hårdare ju djupare du går, fienden slår hårdare i mörker,
men du blir också starkare: fler hjärtan, bättre svärd, fler lyktor. Kylan gör
aldrig slut på dig — den tar ett hjärta i taget och ger dig tid att hitta ljus.

## Struktur

```
index.html          markup för HUD, dialog, butik, skärmar
css/style.css       all UI-stil (mörk, varm lampa mot kall natt)
src/main.js         start, DOM-koppling, spelloop, touch
src/game.js         motor: rörelse, strid, parering, eld, mörker, quests, boss, spara
src/render.js       målaren: värld, sprites, ljus, dimma, karta
src/world.js        all data: zoner, byn, NPC, eldar, kistor, dungeon, fiender
src/physics.js      top-down kollision, bågar, vinklar
src/input.js        tangentbord + touch
src/audio.js        WebAudio-syntes (inget ljudmaterial)
tests/smoke.mjs     huvudlös spelmekanik: gå, slåss, parera, eld, dungeon, boss
tests/boot.mjs      laddar riktiga main.js mot stub-DOM och klickar igång spelet
tests/render.mjs    renderar 10 PNG till ./shots för visuell granskning
```

## Testa

```bash
npm test                  # smoke + boot
npm run shots             # kräver: npm i --no-save @napi-rs/canvas
```
