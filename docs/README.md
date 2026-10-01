# Dokumentation / Documentation

| Svenska | English | Innehåll |
|---|---|---|
| [sv/GDD.md](sv/GDD.md) | [en/GDD.md](en/GDD.md) | Speldesign: pelare, loopar, survival-siffror, crafting, bygge, strid, UI, balansfilosofi, öppna frågor. |
| [sv/arkitektur.md](sv/arkitektur.md) | [en/architecture.md](en/architecture.md) | Teknik: komponenter, protokoll, datamodell, skalning, drift och kostnader, säkerhet, prestanda, tester. |
| [sv/roadmap.md](sv/roadmap.md) | [en/roadmap.md](en/roadmap.md) | Faser M0–M3 + release med MoSCoW-prioritering, rättad Gantt, medvetna nedskärningar och risker. |
| [REPORT_CHECKLIST.md](REPORT_CHECKLIST.md) | samma fil | Rad för rad: den ursprungliga rapportens rekommendationer → byggt / delvis / planerat. |

Kort läsordning om du är ny i projektet:

1. `README.md` i repo-roten — kom igång och kör spelet.
2. `docs/sv/GDD.md` — vad spelet är och varför siffrorna ser ut som de gör.
3. `docs/sv/arkitektur.md` — hur det hänger ihop, inklusive protokollet.
4. `docs/REPORT_CHECKLIST.md` — status mot den ursprungliga rapporten.
5. `docs/sv/roadmap.md` — vad som händer härnäst.

Alla siffror i dokumentationen är hämtade ur `shared/config.js`. Ändrar du
balansen där uppdaterar du dokumenten i samma veva — och kör `npm run test:all`
för att se att inget gick sönder.
