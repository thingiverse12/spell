# Spell — Roadmap and priorities

> The original Gantt chart in the report had a few problems (the release milestone sat
> *before* the beta phase, task states did not match the dates, and several rows had no
> dependencies). Here is a corrected plan. Start point: **October 2026**, when the
> prototype is complete.

## Current status (done)

| Area | Status |
|---|---|
| Deterministic world generation (shared code) | ✅ |
| Server-authoritative movement, physics, collision | ✅ |
| Client prediction + reconciliation + interpolation | ✅ |
| Networking (WebSocket, interest management, delta replication) | ✅ |
| Gathering, crafting, inventory | ✅ |
| Building (grid, support, doors, demolition, decay) | ✅ |
| Survival (hunger, thirst, stamina, breath, cold, fall damage) | ✅ |
| Animals with simple AI | ✅ |
| PvP with server-authoritative damage and loot | ✅ |
| Persistence + autosave + reconnection | ✅ |
| HUD, inventory, crafting UI, build mode, map, settings, sv/en | ✅ |
| Procedural audio | ✅ |
| Test suite (301 checks, 5 suites) | ✅ |
| Authentication, anti-cheat beyond server authority | ❌ deliberate |
| Art/animation polish, XP system, economy | ❌ next step |

## Phases

### M0 — Prototype (done, October 2026)
Proves the technology: one browser, one server, several players, builds that
survive a restart. **Success criterion:** two players can gather together, build
a base and see each other move smoothly in a browser.

### M1 — MVP (Nov 2026 → Feb 2027, ~3–4 months)
The goal is "a stranger can start playing without anyone explaining it".

| Priority | Feature |
|---|---|
| Must | Real authentication (OAuth/GitHub or Steam), sessions |
| Must | Basic anti-cheat: movement heuristics, anomaly log, kick on deviation |
| Must | Deployment: Docker, reverse proxy with TLS, CDN for static files |
| Must | Onboarding: first-five-minutes guidance, goal hints, clearer death cause |
| Must | Playtest round 1 (10–20 external players); measure time-to-first-tool, session length |
| Should | Backpacks/weight (the report's inventory proposal) |
| Should | Server rules: PvP/PvE and spawn settings |
| Could | Simple stats/leaderboard web UI |

### M2 — Alpha (Mar → Jul 2027, ~5 months)
The goal is "enough content for weeks, not hours".

| Priority | Feature |
|---|---|
| Must | XP + tech tiers, blueprints found in caves |
| Must | More animal species + ecosystem (prey, predators, respawn balance) |
| Must | Caves and rare resources (metal → better tools) |
| Must | Solid telemetry: tick time, memory, bandwidth per player, error tracking |
| Must | CI/CD: `npm run test:all` + `verify:browser` on every push |
| Should | Clans, simple trade, shared base permissions |
| Should | Weather and seasons (rain, snow, temperature) |
| Could | Mod support (server platform, Workshop-like distribution) |

### M3 — Beta (Aug → Oct 2027, ~3 months)
The goal is "shippable to a paying audience".

| Priority | Feature |
|---|---|
| Must | Performance pass: building instancing, LOD, GPU budget measurements |
| Must | Anti-cheat: behaviour analysis, rate limits, DDoS protection |
| Must | Backend move to Postgres + Redis, backup/restore tested |
| Must | Balance round 2 driven by telemetry (hunger, decay, loot) |
| Must | Accessibility review (contrast, key bindings, font scaling) |
| Should | PvP raiding (forcing walls), traps |
| Should | Clothing/armour with warmth/weight |
| Could | Vehicles, electricity, NPC settlements |

### Release 1.0 (Nov 2027 →)
Polish, localisation, store/cosmetics (never pay-to-win), customer support and
moderation. Costs and operations are covered in [architecture.md §7](architecture.md).

```mermaid
gantt
  title Spell — corrected plan (starting Oct 2026)
  dateFormat YYYY-MM-DD
  axisFormat %b %y
  section Prototype
  Prototype complete (M0)       :done,    m0, 2026-10-01, 1d
  section MVP
  Authentication + anti-cheat   :active,  m1a, 2026-11-01, 60d
  Deployment + CDN + TLS        :         m1b, 2026-12-01, 45d
  Onboarding + playtest 1       :         m1c, 2027-01-15, 45d
  section Alpha
  XP, tech tiers, blueprints    :         m2a, 2027-03-01, 60d
  Ecosystem: more animals, caves:         m2b, 2027-04-15, 75d
  Telemetry, CI/CD, clans, trade:         m2c, 2027-06-01, 60d
  section Beta
  Performance + LOD + instancing:         m3a, 2027-08-01, 45d
  DB migration + backup/restore :         m3b, 2027-08-15, 45d
  Balance + accessibility       :         m3c, 2027-09-15, 45d
  section Release
  Release candidate + final QA  :         rel, 2027-11-01, 30d
  1.0 launch                    :milestone, lan, 2027-12-01, 1d
```

## What we deliberately cut from the MVP (and why)

| Report proposal | Decision | Reasoning |
|---|---|---|
| "Fully dynamic ecosystem" | Deferred to Alpha | Costs simulation time per tick; without measurements it risks eating the tick budget. |
| Weight-based inventory | Should-have in M1 | The report's proposal is good, but 12 slots are enough to test the core loop. |
| Unity WebGL | Replaced by three.js | No build step, no 40 MB WASM bundle, faster iteration; Unity becomes attractive once animation/asset pipelines get heavy. |
| WebRTC data channels | Deferred | WebSocket is enough at a 20 Hz tick and trivial to operate. The protocol is transport-agnostic. |
| BattlEye-class anti-cheat | Impossible in a browser | There is no kernel integrity to rely on; invest in server authority and behaviour analysis instead. |

## Dependencies and risks (tied to the plan)

| Risk | Likelihood | Impact | Mitigation in the plan |
|---|---|---|---|
| Client performance on weak machines | Medium | High | The "simple graphics" switch already exists; GPU budget measurement in M3. |
| Cheating in a browser | High | Medium | Server authority (done), heuristics + logging in M1, PvE as the default. |
| Costs ballooning with many worlds | Medium | Medium | One world per process, measured through `/api/status`; cost model in the architecture doc. |
| Scope: too much content | High | High | The MoSCoW lists above; each phase has a measurable success criterion. |
| Network latency hurting melee | Medium | Low | A 0.55 s cooldown and cone-based hits make combat less latency-sensitive. |
