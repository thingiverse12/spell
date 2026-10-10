# Kristalldalen

Ett 3D-spel i fantasystil med en oändlig, öppen värld. Utforska terrängen, slåss mot gobliner och samla alla 10 kristaller för att vinna. Världen är procedurellt genererad och laddas i chunks när du rör dig.

Byggt i **Godot 4.7** med GDScript. Ingen extern assetfil behövs, allt byggs i kod.

## Så kör du spelet

1. Ladda ner **Godot 4.7** (eller senare 4.x) från [godotengine.org](https://godotengine.org/download). Standardversionen räcker, ingen .NET behövs.
2. Öppna Godot och klicka på **Importera**.
3. Välj mappen som innehåller `project.godot` och öppna projektet.
4. Tryck **F5** (Kör projekt).

## Kontroller

| Kontroll | Funktion |
| --- | --- |
| W A S D | Gå |
| Shift | Spring |
| Mellanslag | Hoppa |
| Vänster musknapp | Attackera med svärdet |
| Mus | Rotera kameran |
| Esc | Visa musmarkören (klicka för att fånga den igen) |
| R | Starta om efter att du dött |

## Spelet

- **Mål:** Hitta och samla alla **10 kristaller** som är utspridda i världen. HUD:en visar avståndet till närmaste kristall.
- **Strid:** Gobliner patrullerar området och jagar dig när du kommer nära. Varje träff gör 1 skada och en goblin har 3 hp. Antalet besegrade monster visas i HUD:en.
- **Hälsa:** Du har 100 hp. Hälsan återhämtar sig långsamt om du inte blir träffad på en stund.
- **Dag och natt:** En spel-dag tar 4 minuter. Solen rör sig över himlen och ljuset ändras.
- **Värld:** Berg med snö, sjöar och hav, skogar, buskar, stenar, blommor och övergivna stenruiner. Världen är slumpad varje gång du startar spelet.

## Projektstruktur

```
project.godot          Godot-projektets inställningar
scenes/main.tscn       Huvudscenen (startar spelet)
scripts/
  game.gd              Spelkontroll: indata, dag/natt, kristaller, fiendespawn, vinst/förlust
  terrain.gd           Procedurell terräng, chunk-streaming, vatten, vegetation och ruiner
  player.gd            Spelarens rörelse, tredjepersonskamera, svärd och hälsa
  enemy.gd             Gobliner: vandring, jakt, attack och knockback
  crystal.gd           Samlarobjekt
  hud.gd               HUD: status, hälsa, meddelanden och dödsskärm
icon.svg               Projektikon
```

## Att utveckla vidare

- Justera `VIEW_RADIUS`, `CHUNK_SIZE` och `RESOLUTION` i `terrain.gd` för att balansera utsikt mot prestanda.
- Lägg till fler fiendetyper i `enemy.gd` eller skapa nya scener för byar, grottor och dungeons.
- Byt ut de byggda formerna mot riktiga 3D-modeller och texturer när du har några.
