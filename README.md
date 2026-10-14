# ⚡ Pikachu Äventyr — Pallet Meadow

Ett öppet utforskarspel där du spelar som **Pikachu**! Spring runt i den stora världen Pallet Meadow, samla bär, besegra vilda Pokémon med åskstötar, hjälp Ash och rädda den försvunna Togepi.

## ▶️ Spela

Öppna `index.html` i en webbläsare — eller starta en lokal server:

```bash
python3 -m http.server 8000
# gå sedan till http://localhost:8000
```

Inga beroenden, inga filer att ladda ner — allt (grafik, ljud, värld) genereras av koden i en enda HTML-fil.

## 🎮 Kontroller

| Tangent | Gör |
|---|---|
| **WASD / Pilar** | Gå runt |
| **Shift** | Springa |
| **Space / J** (eller klick) | Åskstöt ⚡ |
| **E / Enter** | Prata, plocka bär, läs skyltar |
| **Q** | Dash 💨 |
| **M** | Ljud på/av |

📱 På mobil/tablet finns joystick + knappar på skärmen.

## 📜 Äventyret

1. **Prata med Ash** vid det röda huset
2. **Samla 8 bär** från rosa bärbuskar
3. **Besegra 5 vilda Pokémon** (Rattata, Pidgey, Caterpie, Zubat i det höga gräset)
4. **Hitta Togepi** som gått vilse i nordvästra skogen
5. **Ta Togepi tillbaka till Ash** — och se vad som händer... ⚡

## ✨ Funktioner

- 🗺️ Stor öppen värld (3400×2600) med skog, sjö med bro, hus, stigar och högt gräs
- ⚔️ Strider i realtid, XP, level ups och HP/energi-system
- 🌙 Dag/natt-cykel med eldflugor och ljus runt Pikachu på natten
- 🏊 Simning (kostar energi!), sovande Snorlax vid bron, PokéCenter för healing
- 🗺️ Live-minikarta, uppdragslogg, autosave + manuell sparning (localStorage)
- 🔊 Producers ljud med WebAudio — inga ljudfiler behövs
- 🎨 All grafik ritas med Canvas-kod — inga bilder behövs
