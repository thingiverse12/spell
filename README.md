# SPELL — Arkan arena

Ett 2D-arenaspel som körs i webbläsaren. Ingen motor, inga beroenden — bara
canvas, HTML och JavaScript. Du är en magiker i en mörk arena och överlever
våg efter våg av varelser med fem besvärjelser och permanenta uppgraderingar
mellan vågorna.

## Starta

```bash
npm start          # http://localhost:4173
```

eller vilken statisk server som helst:

```bash
python3 -m http.server 4173
```

> Öppna `index.html` via en server, inte som `file://` — spelet använder
> ES-moduler som webbläsare blockerar på `file://`.

## Spela

| Styrning        | Gör                                        |
| --------------- | ------------------------------------------ |
| `WASD` / piltangenter | Rör dig                              |
| Musen           | Sikta                                      |
| Vänster mus     | Arkan bult (gratis, snabb)                 |
| Höger mus       | Eldklot — explosion + brinnskada           |
| `E`             | Frostnova — fryser allt nära dig           |
| `R`             | Kedjeblixt — hoppar mellan fiender         |
| `Space`         | Blink — kasta dig framåt och bli kort osårbar |
| `1` `2` `3`     | Välj belöning mellan vågor                 |
| `Esc`           | Paus                                       |
| `M`             | Ljud av/på                                 |

På touch: vänster halva av skärmen är en rörelsespak, höger halva siktar och
skjuter.

### Regler

- Var femte våg kommer en **väktare** (boss) med ringformade projektilskurar.
- Mellan vågorna får du välja 1 av 3 belöningar — 15 olika uppgraderingar med
  flera nivåer (skada, fler projektiler, kritchans, mana, liv, kedjehopp …).
- Källor droppar kristaller som ger liv eller mana.
- Poängen sparas lokalt som rekord.

## Fiender

| Fiende  | Beteende                                             |
| ------- | ---------------------------------------------------- |
| Kryp    | Jagar rakt på dig, snabb att omringa                 |
| Skärva  | Snabb, rör sig i vågor                               |
| Orb     | Håller avstånd och skjuter projektilskurar            |
| Råskinn | Långsam, mycket liv, hård kontakt                    |
| Väktare | Boss: 8-kanoners salva, stor livpool                 |

## Struktur

```
index.html        Markup för canvas + alla skärmar (titel, uppgradering, paus, game over)
css/style.css     HUD, menyer och animationer
src/main.js       Bootstrap, spelloop, HUD-synk, skärmlogik
src/game.js       Spellogik, fiender, projektiler, uppgraderingar och rendering
src/spells.js     Besvärjelsedefinitioner (delas av logik och HUD)
src/input.js      Tangentbord, mus och touch
src/audio.js      Syntetiserat ljud via WebAudio (inga ljudfiler)
src/gfx.js        Glow-sprites och enkla former
server.mjs        Minimal statisk server utan beroenden
tests/smoke.mjs   Headless speltest: 6 minuters simulering av riktig spellogik
tests/render.mjs  Renderar PNG-frames utan webbläsare (kräver @napi-rs/canvas)
```

## Testa

```bash
npm test                             # headless genomspelning, inga beroenden
npx --yes @napi-rs/canvas npm run shots   # valfritt: skriv ut bilder till ./shots
```
