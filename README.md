# ⛏️ MINKRAFT

Ett **Minecraft-inspirerat voxelspel** som körs helt i webbläsaren — generera en
blockvärld, gräv, bygg, slöjda och överlev nätterna. Byggt med
[Three.js](https://threejs.org/) (`lib/three.min.js`, MIT-licens). All grafik,
alla texturer och allt ljud genereras av kod — inga filer laddas ner.

## ▶️ Spela

```bash
python3 -m http.server 8000
# gå sedan till http://localhost:8000 — på dator eller telefon
```

## 📱 Kontroller på telefonen

| Kontroll | Gör |
|---|---|
| **Vänster spak** | Gå |
| **Dra på skärmen** | Titta runt |
| **⛏️ (håll inne)** | Gräv / slåss |
| **▣ (håll inne)** | Placera valt block |
| **⤒** | Hoppa (håll i vattnet för att simma upp) |
| **⬆️** | Flyg uppåt (i flygläge) |
| **Hotbar längst ner** | Tryck för att välja block |

## ⌨️ Kontroller på dator

| Tangent | Gör |
|---|---|
| **WASD** | Gå • **Mus** titta (klicka i spelet för muslås) |
| **Mellanslag** | Hoppa • **Shift** springa |
| **Vänsterklick (håll)** | Gräv • **Högerklick** placera block |
| **1–9 / scroll** | Välj block • **F** flygläge • **C** flyg ner |
| **E** | Ät mat • **Esc** paus |

## 🌍 Världen

- Procedurgenererad voxelvärld (96×96) med berg, sjöar, stränder, snötoppar,
  träd, blommor och högt gräs
- **Grottor** under jorden med kol- och **diamantmalm** djupt nere 💎 — och nu är
  det faktiskt **mörkt** där nere tack vare himmelsljus per block!
- Valbart **frö** — samma frö ger samma värld
- Dag/natt-cykel på **20 minuter** (precis som Minecraft!): synlig sol och måne
  vandrar över himlen, och på natten kommer zombies 🧟
- Grisar 🐷 och kor 🐮 vandrar omkring på dagen — besegra dem för mat och XP
- Bara synliga blockytor renderas (chunk-meshing med **ambient occlusion** i
  blockhörnen) och upplösningen anpassas automatiskt för telefoner

## 🔨 Slöjd & verktyg

Öppna slöjden med **🔨-knappen** eller **R**:

- 1 vedträ → 4 plankor • 2 plankor → 4 pinnar
- **Trähacka** (plankor + pinnar) — krävs för att få drop från sten/kol!
- **Stenhacka** (kullersten + pinnar) — krävs för **diamant** 💎
- **Facklor ×4** (kol + pinne) — placera dem så lyser de upp grottor och hus
  med varmt ljus, precis som på riktigt

Grävning har sprick-animation, fel verktyg ger inget drop, sand **faller**
när blocket under försvinner, och du samlar **XP och levlar** av malm och monster.

## 🎮 Lägen

- **⛏️ Överlevnad:** hjärtan, hunger, fallskada, verktyg, XP, dödsskärm
- **🎨 Kreativ:** odödlig och oändligt med alla block + flygläge

I pausmenyn finns inställningar för **känslighet**, **auto-hopp** och
**grafikkvalitet**. Världen, ryggsäcken, verktygen och positionen **sparas
automatiskt** i webbläsaren (localStorage).
