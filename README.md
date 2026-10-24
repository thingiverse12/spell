# Den sista lågan

Ett zeldalikt äventyr **uppifrån** som spelas direkt i webbläsaren. Ingen
byggprocess, inga beroenden i produktion — bara HTML, CSS och JavaScript.

Byn Häll lovade graven en låga varje vinter, och glömde. Nu har mörkret tagit
dem alla. Du är främlingen som kom med den sista facklan: tänd de tre ljusen i
markerna, få byn att lita på dig, och gå ner under kyrkan för att tända den
första lågan igen.

## Starta

```bash
npm start          # serverar spelet på http://localhost:4173
```

Öppna adressen i webbläsaren. Allt körs lokalt i webbläsaren; ingen serverlogik.

## Spela

| Tangent | Gör |
| --- | --- |
| **WASD / pilar** | gå |
| **J** | svärdshugg |
| **K** | sköld — *håll* för att blockera, *tryck* i rätt ögonblick för att parera |
| **L** | använd valt föremål |
| **Q** | byt föremål · **1–3** välj direkt |
| **E** | prata, tända, öppna |
| **Mellanslag** | rulla undan (odefinierbar stund) |
| **Esc** | paus |

### Striden

Fienderna visar vad de ska göra innan de slår — de lyser rött och växer.
Parerar du i det ögonblicket (`K` just innan slaget landar, med skölden mot
fienden) tar du ingen skada, fienden tappar balansen och ditt nästa hugg gör
dubbel skada. Fel tajmat blir det bara ett vanligt block.

### Ljuset

Mörkret är inte bara mörkt: skuggor och krypare **brinner** i starkt ljus.
Tänd en eldstad med facklan och du har både en fyr att slåss ifrån och ett rum
som slutar anfalla dig.

## Världen

```
              Björkskogen
                   │
   Fälten ──── Häll (byn) ──── Bäcken
                   │
              Kryptan (3 våningar + väktaren)
```

| Plats | Vad som händer där |
| --- | --- |
| **Häll** | Byn. Hedda ger dig facklan, smeden säljer förbättringar för glöd, de du räddar kommer tillbaka hit. |
| **Fälten** | Första ljuset. Sune sitter förstenad. Skuggor, krypare, törnsnår och en kista. |
| **Björkskogen** | Andra ljuset. Alva. Tät skog, en grind som bara en pil kan öppna. |
| **Bäcken** | Tredje ljuset. Vidar. Broar, vatten som stoppar dig och en vakt av sten. |
| **Kryptan** | Rasmassor (bomber), en pilbrytare (båge), eldstäder i mörkret — och till slut **Gravens väktare**. |

## Föremål

- **Facklan** (från Hedda) — kastar en flamma som tänder eldstäder, bränner
  törnsnår och skadar skuggor.
- **Bomberna** (från Sune) — spränger rasmassor och allt som står för nära.
- **Bågen** (från Alva) — pilar når långt och väcker gamla mekanismer.
- **Ett hjärta** (från Vidar), plus hjärtan och uppgraderingar hos smeden.

Glöd får du av besegrade fiender och kistor. Smeden Björn säljer ett hjärta
till, ett vassare svärd, en större fackla och lagning.

## Spara

Spelet sparar sig själv i `localStorage` när du byter plats, tänder ett ljus
eller får något. Välj **Fortsätt** på titelskärmen för att komma tillbaka.

## Struktur

```
index.html          markup, skärmar, boot-felskydd
css/style.css       HUD, dialog, butik, touch-kontroller
src/main.js         UI, skärmar, spelloop
src/game.js         spelmotor: rörelse, strid, eld, fiender, boss, sparning
src/world.js        alla zoner, föremål, uppdrag, butik
src/render.js       den målade renderaren (mark, hus, folk, ljus)
src/physics.js      kollision och geometri
src/input.js        tangentbord, touch-sticka och knappar
src/audio.js        allt ljud syntas i WebAudio
tests/              smoke-, boot- och render-tester
```

## Testa

```bash
npm test           # spellogik + start av hela spelet mot en DOM-attrapp
npm run shots      # ritar 8 bilder till ./shots (kräver @napi-rs/canvas)
```

`tests/smoke.mjs` spelar igenom hela spelet: alla tre ljusen, alla föremål,
bomben, pilen, pareringen, väktaren och slutet. `tests/boot.mjs` laddar
`src/main.js` mot en DOM-attrapp och klickar sig igenom titelskärmen — den
fångar den sortens krasch som ger en svart skärm.
