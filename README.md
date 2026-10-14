# ⚡ Pikachu Äventyr 3D — Pallet Meadow

Ett öppet **3D-utforskarspel** där du spelar som **Pikachu**! Spring runt i den stora
3D-världen Pallet Meadow, samla bär, besegra vilda Pokémon med åskstötar, hjälp Ash
och rädda den försvunna Togepi.

Byggt med [Three.js](https://threejs.org/) (ligger lokalt i `lib/three.min.js`, MIT-licens) —
fungerar helt offline, inga nedladdningar behövs när du spelar.

## ▶️ Spela

```bash
python3 -m http.server 8000
# gå sedan till http://localhost:8000  (på datorn eller telefonen på samma nätverk)
```

Eller öppna bara `index.html` i en webbläsare.

## 📱 Spela på telefonen (rekommenderat!)

| Kontroll | Gör |
|---|---|
| **Vänster spak** (nere till vänster) | Gå / springa i den riktning du drar |
| **Dra med fingret på skärmen** | Snurra kameran runt Pikachu |
| **Nyp med två fingrar** | Zooma kameran in/ut |
| **⚡-knappen** | Åskstöt |
| **PRATA-knappen** | Prata, plocka bär, läs skyltar |
| **💨-knappen** | Dash |
| **⬆️-knappen** | Hoppa |

Spelet anpassar sig automatiskt: lägre upplösning och dynamisk kvalitet på svagare
telefoner, stöd för notch/safe areas, och förhindrar scroll/zoom av sidan.

## 🎮 Kontroller på dator

| Tangent | Gör |
|---|---|
| **WASD / Pilar** | Gå (relativt kameran) |
| **Mus: dra** | Snurra kameran • **Scroll** zoomar |
| **Shift** | Springa |
| **Space / J** | Åskstöt ⚡ |
| **E / Enter** | Prata / plocka / läsa |
| **Q / K** | Dash 💨 |
| **F / L** | Hoppa |
| **M** | Ljud på/av |

## 📜 Äventyret

1. **Prata med Ash** vid det röda huset
2. **Samla 8 bär** från rosa bärbuskar
3. **Besegra 5 vilda Pokémon** (Rattata, Pidgey, Caterpie, Zubat i det höga gräset)
4. **Hitta Togepi** som gått vilse i nordvästra skogen
5. **Ta Togepi tillbaka till Ash** — och se vad som händer... ⚡

## ✨ Funktioner

- 🌍 Riktig 3D-värld (Three.js/WebGL): träd, berg, moln, sjö med bro, hus och stigar
- 🐭 Pikachu byggd i 3D med viftande öron, blixtsvans och gång-animation
- 📷 Tredjepersonskamera som följer dig — snurra, luta och zooma fritt
- ⚔️ Strider i realtid, XP, level ups, HP/energi och 3D-blixtar med ljuseffekter
- 🌙 Dag/natt-cykel med rörlig sol, stjärnor och eldflugor
- 🏊 Simning, hopp, dash och en sovande Snorlax vid bron
- 🗺️ Live-minikarta, uppdragslogg, autosave (localStorage)
- 🔊 Ljud genererat med WebAudio — inga ljudfiler behövs
- 🚀 Optimerat för mobil: instanserad rendering, dynamisk upplösning vid låg FPS
