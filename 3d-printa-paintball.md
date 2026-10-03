# 3D-printa en paintballmarkör (pistol eller gevär) – filer, byggen & regler

Sammanställd 2026-10-03. Alla länkar är gratis-filer om inget annat anges.

---

## Kortversionen (läs denna först)

Du kan **inte** printa en hel fungerande paintballmarkör hemma. Allt som står under tryck – tub (HPA/CO₂), regulator, ventil, ASA-gänga, bolt – måste vara köpt metall. Det som däremot funkar utmärkt är att **printa ramen/Chassit/runt omkring och återanvända "internals" från en billig begagnad markör**. Det är exakt så alla seriösa projekt är byggda.

| Väg | Vad du gör | Donatormarkör | Ungefärlig kostnad | Svårighet |
|---|---|---|---|---|
| **1. FGC-68** (rekommenderas för gevär) | Printar upper, lower, grepp, stock, shroud | Tippmann TiPX/TCR (internals + magasin) | 1 500–3 000 kr beg. + ~1–2 kg filament | Medel–hög |
| **2. Bodykit till pistol** | Printar nytt skal/karbinkit runt pistolen | Tippmann TiPX/TPX | 1 500–2 500 kr beg. + 0,5–1 kg filament | Låg–medel |
| **3. Delar & tillbehör** | Printar hopper-feedneck, kolv, pipa, magasin, hölster m.m. | Vilken markör som helst | 0–200 kr filament | Låg |
| **4. Attrapp/display** | Printar en replika utan funktion | Ingen | filament | Låg |

**Rekommendation:** har du ingen markör – köp en begagnad **Tippmann 98 Custom (~400–800 kr på Blocket)** och printa tillbehör + ett gevärskit först. Vill du ha det fräcka bygget: **FGC-68** (kräver TiPX/TCR).

---

## Varför inte 100 % printat?

- En paintballtub ligger på ~800 psi arbetstryck (burst-krav ~2 500 psi). FDM-plast spricker, läcker i hårlinjer och tål inte stötbelastningen.
- Erfarna byggare på MCB/PbNation är eniga: skippa allt tryckbärande i plast, printa bara skal, grepp, kolvar, fästen, magasin och sikten.
- Källor: [MCB – "Realistic feasibility of a largely 3D printed paintball marker"](https://www.mcarterbrown.com/forum/custom/custom-projects-custom-questions/3d-printing/511972-realistic-feasibility-of-a-largely-3d-printed-paintball-marker), [r/paintball-tråden](https://www.reddit.com/r/paintball/comments/jl9skr/im_a_3d_designer_and_someone_wants_me_to_make_a/)

---

## 1. FGC-68 – det mest kompletta gratisbygget (gevär/karbin)

Ett magasinmatat (magfed) gevär i FGC-9-stil, men byggt för **.68 paintball**. Du printar hela ytterskalet och flyttar över internals (bolt, ventil, regulator, ASA) från en **Tippmann TiPX** eller TCR. Finns i gen 2 (2024/2025) med uppdaterade uppers/lowers, manualer och kompatibilitet med TiPX, TMC, DYE DAM/CF20, T15 och Helix-magasin.

**Grundpaketet (131 filer + PDF-manualer):**
- Printables: https://www.printables.com/model/87803-fgc-68-base-package-starter-set-for-tipx-tcr-magfe
- Cults3D (spegel): https://cults3d.com/en/3d-model/various/fgc-68-base-package-starter-set-for-tipx-tcr-magfed-paintball-marker
- Manualer/parts list (Google Drive): [folder 1](https://drive.google.com/drive/folders/1cR-nfubPEXCrr6-0PsUFC_jSHIq18V4U?usp=sharing) · [folder 2 (gen 2)](https://drive.google.com/drive/folders/1POafTye0p9ps3qhr2-nWT2uAPL3kko1u?usp=sharing)
- Alla FGC-68-delar samlade: [Cults-collection (67 designs)](https://cults3d.com/en/design-collections/UntangleART/fgc-68-mkii) · [skaparens profiler (UntangleWORKS / UntangleART)](https://www.printables.com/@UntangleWORKS)

**Du måste välja till (gratis, samma skapare – Thingiverse):**

| Del | Länk |
|---|---|
| Shroud, top rail | https://www.thingiverse.com/thing:4788308 |
| Shroud, low rail | https://www.thingiverse.com/thing:4802810 |
| Shroud, ingen rail | https://www.thingiverse.com/thing:4794585 |
| Shroud, AK-stil | https://www.thingiverse.com/thing:4799215 |
| Shroud, TEC-9-stil | https://www.thingiverse.com/thing:4795858 |
| Upper (TR/LR) | https://www.thingiverse.com/thing:4797176 |
| Kolv till TR/LR-upper | https://www.thingiverse.com/thing:4796437 |
| Kolv NORA (ingen rail) | https://www.thingiverse.com/thing:4798683 |
| Laddhandtag "bolt it in" | https://www.thingiverse.com/thing:4788334 |
| Laddhandtag (JB Weld-variant) | https://www.thingiverse.com/thing:4599319 |

**Skaparens egen printregel:** *printa uppers med 100 % infill.* Använd PETG/ASA/PA-CF (helst PA6-CF/PET-CF om du har en printer som klarar det), 5–6 perimeters, 0,2 mm lager. Räkna med 1–2 kg filament för ett komplett gevär.

---

## 2. Pistol → karbin: bodykits till Tippmann TiPX (enklaste "wow"-bygget)

Har du redan en TiPX/TPX (eller köper en begagnad) är detta billigt, snabbt och beprövat.

- **"TiCR" bodykit for Tippmann TiPX** (Im-Dim) – full top rail, sidorail, vikbar stock, buffer-tube-bakstycke. Skruvar: M5x40 + M5-muttrar m.m. Listas i beskrivningen.
  - Printables: https://www.printables.com/model/1370202-ticr-bodykit-for-tippmann-tipx
  - Thingiverse: https://www.thingiverse.com/thing:7104791
- **BPX bullpup conversion kit** (Magfed_Solutions) – bygger om TiPX till en bullpup-karbin. Moduluppbyggd:
  - [BPX-BETA-Standard Top Rail](https://www.printables.com/model/491569-bpx-beta-standard-top-rail)
  - [BPX Rifle Stock](https://www.printables.com/model/590431-bpx-rifle-stock)
  - [BPX-BETA-Vert Grip Shroud](https://www.printables.com/model/503126-bpx-beta-vert-grip-shroud)
  - Övriga delar (AR-greppram, MLOK-shroud, magwell för DAM/EMF, ASA-kit): https://www.printables.com/@Magfed_Soluti_904971
- **Open Source Pistol Magazine (paintball)** – DAM-kompatibelt single-stack-magasin, verktygsfritt: https://www.printables.com/model/1229737-open-source-pistol-magazine-paintball
- **"TIPX Bullpup Paintball Marker"** (Cults, betald): https://cults3d.com/en/tags/tipx
- **Tippmann 98/A5/X7-kit** – klassikern "pistol blir prickskyttegevär" (stock, sidomatad hopper-adapter, bipod). Se [Hackaday-artikeln](https://hackaday.com/tag/3d-printed-paintball-gun/) för inspiration; filerna ligger utspridda på Thingiverse/Cults. Färdiga kit (betalda) finns hos bl.a. Magfed Maker-efterföljare och på Cults.

**Obs:** TiPX går på 12 g CO₂ i greppet. TiCR-kitet har **inte** uttag för remote line (separat zip finns). Kolla det innan du printar.

---

## 3. Bara delar & tillbehör (funkar på vilken markör som helst)

Populära gratissaker som faktiskt används på fältet:

- **Feedneck/hopper-adapter, hoppers, speedfeed** – Thingiverse/Printables, sök "feedneck".
- **Kolvar/stockadaptrar** – t.ex. 13ci-tubstock, AR-buttstock-adapter till Tippmann 98, "Buttstock – Adjustable Paintball Magfed – 13ci Bottle".
- **Pipor** – AC-gängad Freak-barrel-front/back finns gratis (sök "Freak Barrel Front" på Cults); det finns även kommersiellt 3D-printade pipor (PaintballDNA). Printade pipor slits snabbare än aluminium – räkna med det.
- **Barrel plug / barrel condom** – obligatoriskt säkerhetstillbehör: t.ex. https://www.printables.com/model/852719-paintball-barrel-plugcover-single-o-ring-no-suppor
- **Magasin & couplers** – TiPX 7/12-runds couplers, ZetaMag-couplers, MCS/DYE-lowers, "Lok-BOLT" till Tippmann TMC.
- **Hölster, MOLLE-fickor, bälteshållare** – TiPX-magasin, 10-runds tuber, Barrel Maid-fodral.
- **Paintball-mold** (gjut egna kulor, mest på skoj): https://www.printables.com/model/896353-paintball-mold
- **Ställ/väggfästen** – https://www.printables.com/tag/paintballmarker

### Bästa ställena att leta fler filer

| Källa | Varför |
|---|---|
| [Printables – tag "paintballmarker"](https://www.printables.com/tag/paintballmarker) | Modernast, bra sökning |
| [Cults – tag "tipx"](https://cults3d.com/en/tags/tipx) (99 modeller) · ["paintball" gratis (459 modeller)](https://cults3d.com/en/tags/paintball?only_free=true) | Störst bredd, mycket FGC-68 |
| [Thingiverse – sök "paintball"](https://www.thingiverse.com/search?q=paintball) | Äldst, mycket klassiska delar |
| [MCB Paintball STL Repository](https://www.mcarterbrown.com/forum/custom/custom-projects-custom-questions/3d-printing/2772-paintball-stl-repository) | Kuraterad lista av communityn (Phantom, PGP, Splatmaster, 007) |
| [PbNation 3D-print-tråd](https://www.pbnation.com/showthread.php?t=4760873) | Stort index, mycket gamla godbitar |
| [github.com/SnapshotPB/Models](https://github.com/SnapshotPB/Models) | OpenSCAD-källkod, parametriska paintball-delar (Eblade, Karnivor) |
| [Steam Labs paintball-collection](https://www.printables.com/@SteamLabs/collections/502623) | 13 utvalda modeller |
| [r/3DPRINTING4PAINTBALL](https://www.reddit.com/r/3DPRINTING4PAINTBALL/) | Community, feedback på byggen |

---

## 4. Bara en attrapp (ingen funktion)

Om du vill ha en pistol/gevär att ha på hyllan, i cosplay eller som rekvisita – här gör tryckklassen inget:

- Rec Room Paintball Pistol: https://www.thingiverse.com/thing:7331475
- "Spyder Paintball Gun (Volumizer)" – displaymodell i 7 delar, Thingiverse
- "BT-4 Combat Paintball Gun" – replika, Thingiverse
- Paintball Marker Keychain/charm: https://www.myminifactory.com/object/3d-print-paintball-marker-keychain-6745

---

## Printinställningar som gäller alla byggen

| Inställning | Rekommendation |
|---|---|
| Material | PETG (budget), ASA (UV/tålighet), PA-CF/PET-CF (bäst). PLA/PLA+ funkar till display och icke-belastade delar |
| Lagerhöjd | 0,2 mm |
| Väggar/perimeters | 4–6 (minst 5 på chassin) |
| Infill | 40–100 %; **uppers på FGC-68: 100 %** |
| Orientering | Lägg långa chassin så lagren går längs med belastningen (aldrig tvärs en skruvskalle) |
| Skruvförband | Gänga direkt i plast funkar en gång – använd M3/M4/M5 genomgående bult + mutter, eller smält in gänginsats |
| Efterbehandling | Annealing/Kristallisering av PA-CF ger mycket bättre hållbarhet |

**Säkerhet, alltid:** godkänd mask (EN 166 / ASTM F1776) på, pipa pluggad/condom utanför spel, chrona markören (fält brukar kräva ≤ 280–300 fps = ca 10–13 J) och håll dig under.

---

## Sverige: vad säger lagen?

- **Paintballvapen är tillståndsfria** om de är *avsedda att färgmarkera deltagare i stridsspel* och *konstruerade för färgampuller med minst 16 mm diameter*. Då finns ingen särskild joulegräns i vapenförordningen (1 kap. 7 §). Källa: [Polisens vägledning för vapenärenden](https://polisen.se/f7629ed359dad7f5400157bf030386a7/siteassets/dokument/vagledning-for-handlaggning-av-vapenarenden.pdf), kap. 2.1.1.1.2.
- **18-årsgräns** gäller för innehav även av tillståndsfria paintballvapen.
- **Kaliber .50 (12,7 mm) omfattas inte** av paintballundantaget (kravet är ≥16 mm) → då gäller vanliga regler: effektbegränsat luftvapen kräver <10 J, helautomatiskt <3 J. Sammanfattning: [safetysweden.com](https://www.safetysweden.com/regler-for-luftvapen-i-sverige-detta-galler-2026/)
- **Transport:** oladdat, isärtaget/nedpackat, inte på allmän plats eller kollektivtrafik (5 kap. 4 § och 6 § vapenlagen) – [Lawline-svar](https://lawline.se/answers/hur-ska-man-transportera-en-paintball-markor).
- **Egen tillverkning:** att bygga en markör som uppfyller paintballdefinitionen är ok, men bygger du en luft-/CO₂-driven sak som *inte* är en paintballmarkör (t.ex. fel kaliber eller "bara" för att skjuta kulor) kan den klassas som licenspliktigt vapen. Håll dig till ventiler/tuber/regulatorer från färdiga markörer.

### Var köper man grejerna i Sverige?

- Nytt: [tacticalstore.se](https://www.tacticalstore.se/en/paintball/paintball-markers/paintball-pistols/) (skickas från Sverige; TiPX ca 400–420 €, TMC/Stormer m.fl.).
- Prisjämförelse: [PriceRunner – paintballmarkörer](https://www.pricerunner.se/cl/10013/Vapen?attr_100005834=100017432).
- Begagnat (bäst pris för donator-markör): [Blocket](https://www.blocket.se/recommerce/forsale/search?product_category=2.69.3965.281) – Tippmann 98 Custom ~400 kr, X7 ~500 kr, TMC ~700 kr, TiPX-bundle ~2 000 kr.

---

## Vad jag skulle göra i din sits

1. **Budget & enkelt:** köp begagnad Tippmann 98 Custom + printa stock/rail/feedneck → gevärslook för under 1 000 kr.
2. **Pistol:** köp begagnad TiPX + printa **TiCR bodykit** → kompakt pistol/karbin-hybrid.
3. **Det riktiga bygget:** begagnad TiPX eller TCR + **FGC-68 gen 2** med valfri shroud → ett magfed-gevär du printat själv, med ~50/50 köpta/printade delar.
4. Vill du bara lära dig mekaniken först: printa en billig **rubber-band-gun** eller en paintball-attrapp – samma Tinkercad/FreeCAD-övning, noll tryckrisk.

Säg till om du vill ha en inköpslista (BOM) för ett specifikt bygge – t.ex. FGC-68 + vilka skruvar/fjädrar som behövs – så tar jag fram den.
