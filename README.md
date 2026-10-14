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
- 🐭 Pikachu byggd i 3D med tecknad outline, stora glansiga ögon (som blinkar!), rosiga glödande kinder, riktig blixtsvans, röd utforskar-scarf som fladdrar — och full gång-/hopp-/idle-animation med öron som släpar efter rörelsen
- 📷 Tredjepersonskamera som följer dig — snurra, luta och zooma fritt
- ⚔️ Strider i realtid, XP, level ups, HP/energi och 3D-blixtar med ljuseffekter
- 🕐 Dag/natt-cykel där ett helt dygn tar **20 minuter** (10 min dag / 10 min natt), med klocka i HUD:en och meddelanden vid soluppgång/solnedgång
- 🕳️ **Grottor att utforska:** två ingångar (Skogsgråttan i nordväst, Bergsgrottan i öster) leder ner till ett och samma underjordiska grottsystem — så du kan gå in på ett ställe och komma ut på ett annat! Där nere finns:
  - 💎 3 glödande kristaller att samla åt grottutforskaren **Brock** (belöning väntar!)
  - 🗝️ En skattkista med 60 mynt, 🍄 läkande glödsvampar och en underjordisk sjö att simma i
  - 🦇 Vilda Zubat och Geodude, stalaktiter, och en egen grottkarta på minikartan
  - 🔦 Det är alltid mörkt i grottan — Pikachus kindljus lyser upp vägen, och kameran zoomar automatiskt närmare
- 🏊 Simning, hopp, dash och en sovande Snorlax vid bron
- 🗺️ Live-minikarta, uppdragslogg, autosave (localStorage)
- 🔊 Ljud genererat med WebAudio — inga ljudfiler behövs
- 🚀 Optimerat för mobil: instanserad rendering, dynamisk upplösning vid låg FPS
