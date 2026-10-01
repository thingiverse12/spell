# Spell — architecture (technical overview)

> Status: **prototype implemented**. Anything in *italics* is planned, not built.
> The code lives in `server/`, `client/` and `shared/`; all numbers and rules below are
> taken directly from `shared/config.js`, so this document cannot drift from the code.

## 1. Overview

```
                    ┌──────────────────────────────┐
                    │          Browser             │
                    │  WebGL2 (three.js, ESM)      │
                    │  ┌────────────────────────┐  │
                    │  │ shared/physics.js      │  │  ← the exact same code the
                    │  │ shared/prediction.js   │  │    server executes
                    │  │ shared/noise.js        │  │
                    │  └────────────────────────┘  │
                    └───────┬───────────────┬──────┘
        HTTPS (static)      │               │ WSS /ws (game protocol)
                            ▼               ▼
                    ┌───────────────┐ ┌────────────────────────────┐
                    │ Static files  │ │  Spell server (Node.js)    │
                    │ /client       │ │  ┌──────────────────────┐  │
                    │ /shared       │ │  │ 20 Hz tick loop      │  │
                    │ /vendor       │ │  │ rules.js (authority) │  │
                    └───────────────┘ │  │ World (chunks, AI)   │  │
                           ▲          │  └──────────┬───────────┘  │
                           │          │      JSON persistence      │
                     *CDN (prod)*     └─────────────┬──────────────┘
                                                     ▼
                                        server/data*/world-<seed>.json
                                        *(prod: Postgres + Redis, see §7)*
```

**The core principle**: the client only sends *input*; the server owns all truth
(loot, damage, crafting, building, time, AI). The client predicts its own
movement with the same module the server runs and reconciles against every
snapshot, which keeps the game feeling instant even though authority is
server-side — and makes cheating harder than it would be in a
client-authoritative model.

## 2. Components

| Component | File(s) | Responsibility |
|---|---|---|
| Configuration | `shared/config.js` | Every game number: physics, survival, recipes, building pieces, network parameters. Shared by client and server. |
| World generation | `shared/noise.js` | Deterministic hashing, value noise, fbm, heightfield, biomes, sun angle. Same seed → identical terrain everywhere. |
| Physics | `shared/physics.js` | Capsule collision against terrain and buildings, step-up, swimming, stamina, fall damage (reported back to the caller). |
| Prediction | `shared/prediction.js` | `LocalWorld` (collision world built from replicated buildings), `Predictor` (rewind + replay of unacked input), `Interpolator` (remote players rendered ~120 ms in the past), `NetStats`. |
| Gameplay (authoritative) | `server/rules.js` | Harvesting, melee/PvP, crafting, building, doors, demolition, eating, inventory moves, repairs, survival decay, death/respawn. |
| World | `server/world.js` | 64 m chunk streaming, resource nodes, animals, AI, building index, day/night, decay, JSON save/load. |
| Game server | `server/index.js` | HTTP (static + `/api/*`), WebSocket protocol, 20 Hz tick loop, interest management, delta replication, autosave, shutdown. |
| Client | `client/src/*` | Rendering, HUD, input, UI panels, audio, net client. No build step: plain ES modules + an import map. |

### Why shared modules?
This is the single most important architectural decision in the prototype.
Client and server import the **same** `config.js`, `noise.js`, `physics.js` and
`prediction.js` (the browser fetches them from `/shared/*`, Node reads them from
disk). Prediction and authority therefore cannot drift apart through duplicated
code — a classic source of rubber-banding in networked games.

## 3. Simulation and networking

* **Tick rate:** 20 Hz (`NET.tickRate`). The report suggests 20–30 Hz for a
  survival game; we sit at the low end because it is plenty for building,
  gathering and melee, and it keeps CPU cost per player down.
* **Input:** the client sends 30 inputs/s (`NET.inputRate`) with sequence
  numbers. The server simulates them in order, at most 1.35 × real time per
  tick (speed-hack guard), and acknowledges `seq` in every snapshot.
* **Reconciliation:** the client keeps unacked input, and on every snapshot it
  rewinds to the server state and replays what has not been acknowledged yet.
  A deviation > 2 cm counts as a correction (visible in the F3 overlay).
* **Interpolation:** remote players and animals are rendered
  `NET.interpDelayMs` (120 ms) in the past, which produces smooth motion even
  with packet loss.
* **Interest management:** only entities within `NET.interestRadius` (220 m) are
  sent. Static entities (nodes, buildings) go out as *deltas* with version
  numbers (`v`); animals as light arrays every tick. Typical prototype
  bandwidth: single-digit kbit/s per player.
* **Transport:** WebSocket (JSON), TLS in production. WebRTC data channels are
  the likely upgrade for movement traffic if latency becomes a problem — the
  protocol is deliberately simple enough to be swapped behind
  `client/src/net.js`.

## 4. Protocol

### Client → server

| Message | Fields | Description |
|---|---|---|
| `hello` | `playerId, name` | Identifies the player (id stored in localStorage; reconnecting restores progression). |
| `input` | `seq, dt, yaw, pitch, wish, strafe, jump, sprint, crouch` | 30 Hz, `wish`/`strafe` ∈ [-1,1]. |
| `action` | `a, rid, …` | `harvest{id}`, `melee`, `craft{id}`, `place{piece,cx,cz,rot}`, `door{id}`, `demolish{id}`, `use{slot}`, `equip{slot}`, `moveitem{from,to}`, `repair{slot}`, `respawn`. |
| `chat` | `text` (≤200 chars, 1.2 s cooldown) | Broadcast to everyone. |
| `ping` | `id, at` | RTT measurement. |

### Server → client

| Message | Content |
|---|---|
| `welcome` | `seed`, `world{size,grid,seaLevel,maxHeight}`, `config`, `time01`, `day`, `you{x,y,z,yaw,inv,toolSlot,spawn}`, player list |
| `snap` | `tick, time01, day, ack`, `you{seq,x,y,z,vx,vy,vz,health,hunger,thirst,stamina,breath,onGround,inWater,inv,toolSlot,kills,deaths,killsAnimal,dead}`, `players[]`, `nodes[]` (upserts), `nrem[]`, `animals[]`, `buildings[]` (upserts), `brem[]`, `ev[]` |
| `res` | `a, r, ok, …` — a reply to every action (including `place`) |
| `ev` | `swing`, `hurt`, `died`, `respawned`, `placed`, `door`, `buildingGone`, `join`, `leave`, `chat`, `chatSlow` |
| `pong` | `id, at, now, serverTime` |

As long as the data fields stay the same, the transport can change (binary
encoding, WebRTC) without touching gameplay logic.

## 5. Data model and persistence

The prototype stores one JSON document per world
(`server/data*/world-<seed>.json`) containing:

* `buildings[]` — cell, rotation, height, hp, owner, decay timer
* `players{}` — position, stats, inventory, statistics (keyed by player id)
* `deadNodes[]` — only *dead* nodes and their respawn time (terrain is
  regenerated from the seed and never stored)
* `time01`, `day`, `nextBuildingId`

Writes are atomic (temp file + `rename`), every 20 seconds, on disconnect and on
`SIGTERM`/`SIGINT`. On load, player records pass through `sanitizePlayer()` so
older save files missing newer fields cannot crash the simulation — a bug that
actually happened during development and is now covered by harness test 7.

**Production path (the report's recommendation):** Postgres for transactional
data (inventory, economy, buildings), Redis for sessions and hot state,
object storage/S3 for world backups, cross-zone replication.

## 6. Scaling

| Level | Action |
|---|---|
| Current (prototype) | One process, ~30 players (`NET.maxPlayers`), chunk streaming, interest management. Memory for an empty world: a few tens of MB. |
| 50–100 players | Dedicated node per world; move persistence to Postgres/Redis; serve static files from a CDN; scale vertically first (a world's simulation is single-threaded). |
| Many worlds | One server process per world/seed (horizontal), load balancer routing `wss://…/ws?world=id`, shared DB. |
| Huge worlds / regions | Split the map into zones with per-process ownership plus player handover (expensive: needs an inter-process protocol and interest handover). Recommended only when a world no longer fits in one process. |

To measure: `/api/status` (tick, memory, uptime, player list) can be scraped by
Prometheus/Grafana; `server.stats()` exposes world statistics.

## 7. Operations and cost

| Item | Prototype | Production (50–100 concurrent, one region) |
|---|---|---|
| Game server | 1 process, any VM | 2 × (2 vCPU/8 GB) for redundancy, ≈ $60–160/mo |
| Database | JSON file | Postgres (db.t3.medium) + Redis, ≈ $60–120/mo |
| Static/CDN | same process | CloudFront/S3, ≈ $20–50/mo |
| Bandwidth | negligible | ≈ $50–120/mo at moderate traffic |
| Monitoring | logs + `/api/status` | Prometheus/Grafana or similar, ≈ $0–50/mo |
| **Total** | **$0 (local VM)** | **≈ $250–500/mo** |

This matches the report's estimate ($300–500/mo at small/medium scale). Cost is
driven by the number of *worlds*, not the number of players, as long as each
world fits in one process.

## 8. Security and anti-cheat

**Implemented in the prototype**

* Server authority: movement, damage, loot, crafting and building are validated
  server-side.
* The client cannot set its own health, position or inventory — input only
  carries desired movement and intents.
* A per-tick time budget prevents extra inputs from simulating faster than real
  time.
* Range checks: harvesting (`COMBAT.reach`), building (`BUILD.reach`), doors,
  demolition, chat cooldown, maximum message size (16 kB), idle timeout.
* Deterministic terrain means the client cannot invent ground.

**Deliberately missing (MVP scope, tracked in `docs/*/roadmap.md`)**

* No authentication (the player id comes from the client) → replace with an
  OAuth/Steam token.
* No encryption in dev (TLS/WSS via a reverse proxy in deployment).
* No movement heuristics beyond the time budget, no suspicious-behaviour
  logging, and no kernel-level anti-cheat (none exists for browsers).
* No HTTP-level rate limiting or DDoS protection.

Because browser clients are easy to modify, the strategy is the one the report
advocates: **keep secret logic on the server**, validate everything, log
anomalies, and avoid game modes where cheating ruins the experience for others
(e.g. make PvE co-op the default).

## 9. Client performance

* Terrain is **one** mesh (129×129 heights → 32,768 triangles) with flat shading
  and vertex colours: no textures, few draw calls.
* Resource nodes are drawn with `InstancedMesh` per part (trunk, canopy, rock,
  bush) — hundreds of nodes in a handful of draw calls.
* Animals, players and buildings are simple low-poly meshes; buildings share
  geometry but own their material (so damage tinting is per-building).
* LOD is replaced by *fog + view distance*; instances beyond the view distance
  are hidden by fog, which is cheaper than rebuilding buffers every frame.
* `settings.simpleGraphics` disables shadows, lowers pixel ratio and shortens
  the view distance for weak integrated GPUs.
* Shadows: one directional light with a 1024² map following the player (can be
  switched off).

## 10. Reproducibility and testing

| Command | What it verifies |
|---|---|
| `npm test` | Real server + bot clients: multiplayer, physics/prediction, harvesting, crafting, building, combat and persistence (32 checks). |
| `npm run test:client` | The browser's own `client/src/net.js` against the live server (22). |
| `npm run test:ui` | DOM ids, i18n, import map, CSS and imports (271). |
| `npm run test:dom` | The HUD in jsdom: bars, hotbar, recipes, building, map and chat (65). |
| `npm run test:render` | Scene logic without a GPU: terrain, triangle winding, instances, buildings and animals (73). |
| `npm run test:camera` | Pitch/roll, drag-look, NaN and click versus drag (43). |
| `npm run test:controls` | Keys, mouse, wheel, panels, death/disconnect and HUD buttons (119). |
| `npm run test:ground` | Surface, footprints, buried objects, server audit and client interpolation (59). |
| `npm run test:models` | Palette, geometry, materials, sizes, budgets and planted model faults (117). |
| `npm run test:catalog` | The eight model categories; every real model is built and placement-checked one at a time (178). |
| `npm run test:errors` | Protocol fuzzing, name/input guards, character state/repair and server error counter (72). |
| `npm run verify:browser` | Real Chromium when available; otherwise static module checks. |

`npm run test:all` runs the 11 Node suites: **1,051 checks**. CI runs the same
command on every push and PR; `verify:browser` additionally tries Chromium.

## 11. Resilience (live previews and operations)

Network failures are the normal case, not the exception, so they are handled
explicitly:

* **The client reconnects by itself** with backoff (1 s → 15 s) when the link
  drops, showing "Reconnecting … (attempt n)" plus the close code instead of an
  opaque error. When the server is back the player continues where they were
  (progression lives on the server).
* **Client-side diagnosis:** on a failed connection the client first calls
  `/api/status`. If HTTP answers but the WebSocket does not, it says so plainly
  ("the server refuses the game connection — check the proxy/port"); if nothing
  answers, it reports the server as offline. The URL (`wss://…/ws`) and the code
  are shown.
* **Duplicate players:** one browser shares `localStorage`, so a second tab
  presents the same player id. The server closes with code `4001`, and the client
  automatically switches to a tab-scoped guest identity (`sessionStorage`) and
  says so. Opening two tabs to see the multiplayer therefore just works.
* **The server survives faults:** the tick loop, the message handler and the
  process itself have guards (`uncaughtException`, `unhandledRejection`) that log
  and continue instead of killing a live world.
* **Proxy-friendly WebSocket:** upgrades are accepted on `/ws`, `/` and
  `/socket` (some proxies rewrite the path) and rejected everywhere else, with
  the rejection logged, so a misconfigured proxy shows up in the server log
  instead of failing silently in the browser.

## 12. Camera and controls (rules that are tested)

Camera bugs are the only kind that make the game unplayable, so the rules live as
tests in `test/camera.js` (43 checks) instead of as intentions:

| Rule | Why | Test |
|---|---|---|
| Pitch is clamped to ±89° (`PITCH_LIMIT`) | at exactly 90° the up-vector flips and the view is upside down with no way back | 1000 drags in each direction never reach zenith/nadir |
| Roll is **always** exactly 0 | any tilt makes the view feel inverted | 50 random frames, roll === 0 |
| Rotation is assigned as a whole `(pitch, yaw, 0, 'YXZ')` | assigning x and y separately kept the roll left over from an earlier `lookAt()` | `checkCamera` flags roll > 1e-6 |
| Mouse up = look up | screen convention | 4 tests, with and without inverted Y |
| The first mousemove of a drag reports **zero** | it was compared against an unused (0,0), so the camera snapped to the ceiling as soon as you started dragging | regression test: delta 0, then sane deltas |
| Absurd jumps are clamped at 180 px and NaN is ignored | a pointer leaving the window or a synthetic event must not poison the rotation | 400 moves with jumps and NaN keep the angles valid |
| The camera never goes below the ground (floor at surface + 0.25 m) | otherwise you see the world from inside | 60 frames starting at y = −50 stay above the surface |
| Drag = look, **click** = act | otherwise you swing the axe every time you look around | `isTap`: short press without movement is a click |
| A per-frame self-check | NaN or roll is detected and **repaired** instead of showing a broken world | 6 tests inject faults and require them to be found |

In addition, `window.onerror` and `unhandledrejection` are captured in the client,
shown as a toast and listed in the F3 overlay (`fel: n — senast: …`). The array is
also exposed as `window.__spellErrors` so it can be read from the browser console.
That turns "there are some errors" into something actionable instead of a guess.

Without pointer lock (common in embedded preview panes) the client switches mode
automatically and says so in the hint bar: *drag to look · click to act*.


## 13. Controls (rule: every control must work)

Every key, mouse button, wheel tick and HUD button is a **decision** in
`client/src/controls.js`, so the same rule can run in a test. `main.js` owns the
side effects; the module owns the decisions.

| Control | Does | Test |
|---|---|---|
| `W A S D` | walk (held) | keyIntent → `hold`, read only through `HOLD_CODES` |
| `Shift` / `Ctrl` | sprint / crouch (held) | keyIntent → `hold` |
| `Space` | jump (held) | keyIntent → `hold` |
| Left click | gather / hit / place (in build mode) | pointer lock: straight away; drag mode: short click without movement |
| Right click | eat/use, door, demolish (build mode) | same split as left click |
| `1`–`9`, wheel | select tool | the wheel steps in **both** directions and wraps both ways |
| Hotbar click | selects the tool | jsdom: clicking slot 3 → `equip(2)` |
| `E` | open door, otherwise eat | keyIntent → `use` |
| `R` | repair, or rotate in build mode | keyIntent → `repair` / `rotate` |
| `Tab` / `C` / `B` / `M` | backpack / craft / build mode / map | keyIntent → its own panel toggle |
| `T` | chat | keyIntent → `chat` (and the input state is cleared) |
| `Esc` | closes the topmost panel, otherwise settings | `escapeIntent`: settings → help → chat → inventory → build → map |
| `F1` / `F3` | help / debug info | also work in the menu and while dead |
| Every "Close" button | closes its panel | jsdom: 5 buttons, each closes the **right** panel |
| Respawn / reconnect / guest | screen buttons | bound in main.js, focus is released after a click |

Rules that were real bugs and are now tested:

| Bug | What happened | Fix |
|---|---|---|
| Dead close buttons | all five "Close" buttons had no binding — clicking did nothing | `bindHudControls` binds them and the test requires the right panel to close |
| Key auto-repeat | holding `B`/`C`/`M`/`Tab` toggled the panel ~30 times per second | `keyIntent` ignores `repeat` for everything except hold keys |
| Stuck movement keys | opening the chat while walking kept you walking | `clearInputs` on panel/chat + `typing` zeroes the input |
| Space ghost-click | a clicked button kept focus; Space (jump) activated it again | focus is released after every button click |
| Acting while dead | you could open the backpack and switch tools while dead | only `Esc`, `F1`, `F3` answer when dead/disconnected |
| Wheel back from "empty" | jumped from slot 9 to 8 instead of wrapping | the wheel intent counts from the right end |

The F3 overlay shows `kontroller n` — the number of bound HUD controls — so a
control that loses its binding is visible in the game itself.


## 14. Nothing may end up below the surface

The same code (`shared/ground.js`) runs on the server and in the client, so both
agree on where the ground is. The ground *under an area* is not the ground in *a
point*: a wall is 4 m wide, so a wall based on the height of its centre can be
buried up to ~1 m on the uphill side.

| Rule | Why | Test |
|---|---|---|
| Surface under a **footprint** = the highest point | a 4 m wide wall must not be swallowed by a slope | synthetic slope: footprint 2 m above the centre |
| Flat pieces (foundation, campfire) use the **centre** | a platform is *meant* to cut into a hillside | same slope, foundation = no violation |
| A wall on bare ground uses the footprint top; a lift > 0.2 m needs a foundation | otherwise the wall is dug into the hill | `needs-foundation` on a steep cell, accepted on flat |
| Animals and players are **lifted** by the audit | the simulation is the truth | planted fault: animal 1.95 m below the surface → lifted and reported |
| Buildings are **reported** but never moved | silently moving a structure would break it | planted fault: wall 1.52 m below the surface, `y` unchanged |
| The client lifts interpolated bodies | a straight line between two ticks on a slope passes *under* the hill | 40 frames across a steep spot: never below the surface |
| The server audits every other second | catches older saves after a geometry change | `checked` > 100, `buried === 0` after a playing session |

The errors are visible in three places: the server log (`[spell:ground] …
objects below the surface`), `/api/status` (`world.ground` with
`checked/lifted/buried/worst`) and the F3 overlay in the game (`under mark: n`).
`world.ground.checkedBy` reports the exact players, animals, live nodes and
buildings in that same audit snapshot; it is not compared with a later, changed
chunk count. The client also adds the event to the error list
(`window.__spellErrors`, at most one report every 5 seconds).


## 15. The models (rule: design → colours → materials → quality → errors)

Every colour lives in `client/src/palette.js` (`PALETTE` for things in the world,
`SKY` for light, sky and water). Before, hex literals were scattered through
`entities.js` and `terrain.js`, so nobody could answer "is the deer the same
brown as the boar?" or "how many materials do 200 walls create?".

**Design - the model must be the size the gameplay data says.** If the silhouette
and the collision box disagree, you aim at one thing and hit another.

| Model | Before | After |
|---|---|---|
| Deer | 2.54 m (gameplay says 1.50) | **1.50 m** |
| Boar | 1.32 m (gameplay says 1.00) | **1.00 m** |
| Tree | 9.0 m (design says 7) | **7.0 m** |
| Rock | 0.26 m **below the surface** | rests on the ground |
| Bush | 0.14 m **below the surface** | rests on the ground |
| Campfire | 1.60 m wide (box is 1.40) | fits inside the box |
| Player | feet 0.04 m above the ground | feet at **y = 0** |

**Colours.** The palette has 17 named world colours + 14 sky colours, no
duplicates, all valid. The animal colours in `shared/config.js` must exist in the
palette (tested), so gameplay data and renderer cannot drift apart. The damage
tint used `color.setScalar(ratio)` - that sets R=G=B, so a damaged wooden wall
turned **grey**. Now the palette colour is multiplied, so the hue survives.
Player colours use comma-separated HSL because Three.js 0.169 interpreted modern
space-separated HSL as **white**. Old saves are migrated on load, and the test
uses `THREE.Color`, not just a string-format check.

**Materials.**

| Before | After |
|---|---|
| Every building piece cloned a material | one material per (piece, damage level), shared |
| Every building piece created its own geometry | one geometry per (piece, size) |
| Every animal created 6-7 geometries | four shared animal geometries |
| The head created a new skin material per player | one shared skin material |

**Quality (measured, not guessed).** Every mesh is checked against a budget:
5,000 triangles per mesh, 300-400 per model, 400 meshes per scene. A scene with
120 nodes, 40 animals, 60 building pieces and 8 players lands at ~13,000
triangles and about ten materials - low-poly as the design promises.

**Errors.** `auditScene()` measures the scene every three seconds and reports NaN
in vertex data, geometry without triangles, a mesh without a material, a colour
outside the palette and budget overruns. F3 shows `modeller n meshes/tris/mat`
and `modellfel: n`; the errors also land in `window.__spellErrors`.
`npm run test:models` runs 117 checks, including planted faults (NaN, empty
geometry, an over-heavy mesh, a wrong colour) and proof that a healthy scene
reports zero problems.


## 16. Eight model categories - built and checked one at a time

`client/src/modelCatalog.js` is the single catalog of game models. Every entry
names its category, real view builder, budget and placement rule. Tests build
each view from `entities.js` or `terrain.js` individually; the catalog cannot
drift into a drawing detached from the actual game.

| # | Category | Count | Contents | Placement check |
|---|---|---:|---|---|
| 1 | Animals | 2 | deer, boar | feet at surface; height matches `ANIMALS` |
| 2 | Ground | 5 | terrain, water, sky, stars, sun/moon | terrain span; sea level; inside of sky; stars and sun in the sky |
| 3 | Weapons | 2 | stone axe, spear | in the hand, in front of camera |
| 4 | Materials | 3 | tree, rock, berry bush | rests on ground; gameplay dimensions |
| 5 | Character | 2 | player body, first-person hand | feet at surface; hand in front of camera |
| 6 | Building | 4 | foundation, wall, door, campfire | 4 m grid, rotation, collision box |
| 7 | Equipment | 2 | stone pickaxe, torch | in the hand, in front of camera |
| 8 | Texture | 3 | name tag, build marker, resource highlight | tag attached above body; markers are transparent |

The MVP uses flat-shaded, palette-driven geometry; no external image texture/CDN
is needed. The name tag is a real canvas texture. Materials, colours and texture
are checked together, so bitmap assets cannot silently drift from model colours.

Latest result: **23 models, 34,236 triangles**, all within budget and correctly
placed. `npm run test:catalog` has 178 checks: eight categories, unique ids,
complete coverage of animals/nodes/building pieces, each model built and checked
for size/material/quality/placement, plus planted placement faults. F3 shows
`modellkatalog 23/8` and the count in every category.

## 17. Character and server errors

The character is checked once per second **after ground height is calculated**:
finite position and velocity, world bounds, feet at the surface, pitch,
health/hunger/thirst/stamina/breath, death flag, 12 inventory slots and selected
tool. Self-repair is deliberately limited to values that can be safely restored:
NaN position returns to the last known-good position, the character is lifted
out of ground, impossible speed is limited and a broken local inventory gets a
safe shape. The server stays authoritative and the next snapshot resynchronizes.

The server sanitizes player names and each input at the WebSocket boundary.
`Infinity`, `NaN`, non-numeric strings and movement outside [-1, 1] cannot reach
physics. Malformed URL escapes return HTTP 400 and `/shared/` cannot read server
files. Exceptions from incoming actions are caught and counted at
`/api/status.errors` rather than escaping the game loop. F3 shows
`karaktär: …`, `serverfel: n` and the latest server error; `window.__spellErrors`
retains client-side errors.

`npm run test:errors` sends malformed URLs/JSON, every kind of name, extreme
inputs, garbage for every action, oversized messages and planted character
faults to an isolated server. Latest: **72/72 green**, zero server exceptions,
no null/NaN coordinates.
