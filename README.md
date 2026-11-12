# NEXA — Connect. Talk. Belong.

En svensk social plattform för 13–17 år, byggd med **säkerhet som en faktisk funktion** och inte en visuell prototyp.
All användartext är svenska från start; `src/lib/i18n.ts` ger en i18n-redo struktur för fler språk.

**Live på Vercel:** `https://nexa-gules-three.vercel.app`

## Vad som finns

| Område | Implementering |
| --- | --- |
| Design | Egen abstrakt infinity + hjärta-logotyp, ordmärke, mörk premium-palett, mobil-först responsiv layout (iPhone/Android/surfplatta/desktop) |
| Navigation | Upptäck, Chatt, Communities, Notiser, Profil + dedikerat Säkerhetscenter, Inställningar och Moderatorpanel |
| Konto | Registrering/inloggning, lösenordsåterställning, server-sided åldersband (13–14 / 15–17), profil, bild, intressen, integritetsval, säkerhetsintroduktion, regelaccept |
| Upptäck | Kort med användarnamn, ålder, bild, delade intressen, intro, online-status, gemensamma communities. Filter för vänner/intressen/hobbies/communities; romantik låst för 13–14 och tills juridisk granskning |
| Chatt | Privat text, bild, röstmeddelande, gruppchatt, community-diskussioner, blockering, rapportering, realtidsabonnemang, moderering före insert. Videosamtal avstängda |
| AI-säkerhet | Server-side Edge Function: Unicode/homoglyfer/leetspeak/punktuering/mellanrum/upprepningar/fonetik/stavelser, kontext över flera meddelanden, policy-matchning, adversariell detektering, strukturerade beslut (ALLOW/WARN/HOLD_FOR_REVIEW/BLOCK/ESCALATE) |
| Multimodal | OCR/bild- och transkriberingsadapter. Utan leverantör → HOLD_FOR_REVIEW + mänsklig granskning, aldrig fejkad "säker"-status |
| Communities | Skapa/gå med/följ ämnen, inlägg, kommentarer, reaktioner, regler, moderering och rapporter |
| Moderatorpanel | RBAC, liveöversikt, rapporter, granskningskö, misstänkta konton, användarhistorik, incidenter, AI-statistik, överklaganden, policyhantering, revisionslogg, MFA |
| Testmiljö | 36 kuraterade svenska/engelska testfall; kör dem mot den **riktiga deployade motorn**, mät träffsäkerhet, falska positiva/negativa, svenska/engelska samt moderatoroverride |
| Databas | 31 `nexa_*`-tabeller (+ `nexa_engine_source`), 71 RLS-policies, 21 triggers, strikt åldersseparering och modererings-/begränsningskontroll före insert, privat media-bucket, kortlivade signed URLs, audit och raderings-RPC:er |

## Arkitektur

- **Frontend:** React + Vite + TypeScript, `@supabase/supabase-js`, lucide-ikoner.
- **Backend:** Supabase Postgres (RLS, triggers, RPC:er, realtime) + Deno Edge Functions (`nexa-moderate`, `nexa-moderate-media`, `nexa-verify-age`).
- **Säkerhetsmotor:** `supabase/functions/nexa-moderate/engine.ts` kompileras till `engine.js` och lagras i `nexa_engine_source`. En liten loader importerar den så att adminer kan uppdatera logik/policys utan ombyggnad.
- **Publicering:** Vercel (krav enligt uppdraget), `vercel.json` med SPA-rewrites och säkerhetsheaders.

## Externa beroenden – konfigurationsgränssnitt

Alla identifieras öppet under **Inställningar → Externa tjänster & API-nycklar**. Inga API-nycklar lagras i webbläsaren eller i `nexa_config`; de läggs som Supabase Edge Function-secrets.

| Behövs till | Konfigurationsnyckel | Secret-namn | Status i demo |
| --- | --- | --- | --- |
| Integritetsskyddande åldersförsäkran | `age_verification_provider` | `NEXA_AGE_PROVIDER_KEY` | Självdeklarerad, tydligt märkt demo |
| Extern AI-moderering (t.ex. OpenAI `omni-moderation-latest`) | `moderation_provider` | `NEXA_MODERATION_API_KEY` | Inbyggd motor aktiv |
| Bildanalys/OCR | `vision_ocr_provider` | `NEXA_MEDIA_API_KEY` | Saknas → manuell granskning |
| Rösttranskribering | `transcription_provider` | `NEXA_MEDIA_API_KEY` | Saknas → manuell granskning |
| Hanterad WebRTC | `webrtc_provider` | `NEXA_WEBRTC_KEY` | Avstängd |

Funktionsflaggor: `romance_enabled`, `video_calls_enabled`, `voice_messages_enabled`, `demo_mode`, `legal_review_complete`.

## Lokal körning

```bash
npm install
cp .env.example .env.local   # fyll i VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev                  # http://localhost:5173
npm run typecheck && npm run build
```

## Demokonton (endast i tydligt märkt demoläge)

| E-post | Lösenord | Grupp / Roll |
| --- | --- | --- |
| `demo_alva@nexa.demo` | `Demo1234!` | 13–14 |
| `demo_elis@nexa.demo` | `Demo1234!` | 15–17 (`safety_lead`-moderator) |

`demo_noah@nexa.demo`, `demo_mira@nexa.demo`, `demo_leo@nexa.demo`, `demo_saga@nexa.demo` finns också med samma lösenord. Alla demodata har `is_demo = true` och `demo_`-prefix.

## Viktiga förbehåll

- **Inte juridiskt godkänt.** GDPR, DSA, svensk rätt, EU:s regler för minderåriga, åldersförsäkran, DPIA och barnsäkerhetsgranskning återstår före skarp lansering.
- **Ingen E2E-kryptering påstås:** server-side moderering läser meddelandeinnehåll.
- **Ingen permanent avstängning** sker enbart på osäker AI; osäkra fall går till mänsklig moderator och kan överklagas.
- **Inga privata samtal** används för automatisk modellträning. Endast kuraterad, auktoriserad och åtkomststyrd testdata.
- `mailer_autoconfirm` är aktiverat endast för demo på det delade Supabase-projektet och måste stängas av före produktion.
- Funktioner som kräver en icke-konfigurerad leverantör blockeras inte tyst: de hamnar i granskningskö eller visas tydligt som avstängda.
