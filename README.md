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

- Proce­durgenererad voxelvärld (96×96) med berg, sjöar, stränder, snötoppar och träd
- **Grottor** under jorden med kol- och **diamantmalm** djupt nere 💎
- Valbart **frö** — samma frö ger samma värld
- Dag/natt-cykel på **20 minuter** (precis som Minecraft!): på natten kommer zombies 🧟
- Grisar 🐷 vandrar omkring på dagen — besegra dem för mat
- Bara synliga blockytor renderas (chunk-meshing) och upplösningen anpassas
  automatiskt, så det flyter även på telefoner

## 🎮 Lägen

- **⛏️ Överlevnad:** hjärtan och hunger, fallskada, grävda block hamnar i din
  hotbar, slöjd (1 vedträ → 4 plankor med 🔨-knappen), ät för att läka
- **🎨 Kreativ:** odödlig och oändligt med alla block + flygläge

Världen, dina blockändringar, ryggsäcken och positionen **sparas automatiskt**
i webbläsaren (localStorage).
