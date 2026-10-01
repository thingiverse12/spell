# Spell — Game Design Document (en)

> **Version:** 0.1 (prototype) · **Date:** 2026-10-01
> This document describes the game that actually exists and clearly marks what comes
> next. Every number matches `shared/config.js` — change balance there and both the
> client and the server follow.

---

## 1. Vision and design pillars

**Vision:** a low-poly survival game in the browser where a group of friends can
walk into a shared island together, gather, build, and defend against weather,
wildlife and each other — without installing anything, without a powerful PC,
and without waiting for a 40 GB download.

**Pillars**

1. **Straight in, straight playing.** One URL, one click, playable in seconds.
2. **Friction that means something.** Starvation, cold and night are threats you
   can plan around — not arbitrary punishment.
3. **The build is the story.** Your base is your mark on the world and it
   persists between sessions.
4. **Conflict is optional.** PvP exists, but the world should be enjoyable solo
   or in co-op.
5. **The same rules for everyone.** The server owns the truth; the client never
   gains an advantage by cheating.

**Audience:** players who like *Valheim*'s co-op, *Rust*'s base building and
*Unturned*'s low entry barrier. Sessions of 20–90 minutes.

## 2. Play loops

**Minute 0–5:** wake up, orient yourself, hit a bush and a tree, make a stone
axe. The feeling should be "I understand what I'm doing".

**Session (20–90 min):** gather → build shelter → manage hunger/thirst → explore
→ meet animals or other players → lay the groundwork for the next session.

**Long term (days):** move from bare hands to tools, from stone to a timber
base, from solo to group; defend the build against decay and raiding.

## 3. The world

* **Size:** a 512 × 512 m island generated from a seed. Terrain is
  deterministic: the same seed produces the same island on the client and the
  server (and across restarts).
* **Resolution:** 4 m grid, flat shading, vertex colours. Low-poly is a design
  choice, not a compromise: it keeps polygon counts low and lets an integrated
  GPU cope.
* **Biomes:** water, sand, grass, forest, rock, snow — they decide which
  resources and animals spawn where. Forest means wood, rock means stone, beach
  means almost nothing.
* **Streaming:** the world loads in 64 m chunks around the players; the client
  only receives entities within 220 m (interest management).
* **Day/night:** one day is 10 minutes; night is roughly 38 % of it. Night
  brings cold (damage without a campfire) and poor visibility.

## 4. Survival

| Stat | Max | Decay | Effect at 0 |
|---|---|---|---|
| Health | 100 | — | Death, respawn at the spawn point |
| Hunger | 100 | Empty in ~15 min | 1.6 hp/s |
| Thirst | 100 | Empty in ~12 min | 2.2 hp/s |
| Stamina | 100 | −13/s sprinting, +11/s after 1.1 s | No sprint/jump |
| Breath | 100 | Empty in 18 s under water | 6 hp/s (drowning) |

* **Regeneration:** health +1.2 hp/s while hunger and thirst are above 45.
* **Cold:** at night, 0.4 hp/s unless a campfire is within 9 m.
* **Fall damage:** above 18 m/s impact speed, 3.2 hp per m/s beyond that.
* **Sprinting** costs 60 % more hunger/thirst — resource management is a
  trade-off against pace.

**Design note:** the numbers are deliberately generous in the prototype (15
minutes to hunger) so a developer or playtester can experience building without
constantly chasing food. Tighten after playtesting.

## 5. Resources and gathering

| Node | HP | Tool | Yield per hit | Respawn | Bonus |
|---|---|---|---|---|---|
| Tree | 100 | Axe (26) / hands (8) | Wood 1–3 | 4 min | 25 % chance of fibre; +4 wood when felled |
| Rock | 100 | Pickaxe (26) / hands (8) | Stone 1–3 | 7 min | +3 stone when depleted |
| Berry bush | 24 | Hands (8) | Berries 1 | 2.5 min | 50 % chance of fibre |

* Yield scales with tool quality: bare hands give roughly a third.
* Tools have durability (axe/pickaxe 220, spear 180, torch 400) and lose 1 per
  swing. They can be repaired for materials.
* All gathering happens within 3.4 m (`COMBAT.reach`) and is validated by the
  server — the client cannot gather at range.

## 6. Crafting and progression

| Recipe | Requires | Station | Category |
|---|---|---|---|
| Fibre twine | 5 fibre | – | Resource |
| Stone axe | 3 wood, 2 stone, 2 fibre | – | Tool |
| Stone pickaxe | 3 wood, 3 stone, 2 fibre | – | Tool |
| Spear | 4 wood, 1 stone, 2 fibre | – | Tool |
| Torch | 2 wood, 1 fibre | – | Tool |
| Foundation | 6 wood | – | Building |
| Wall | 4 wood | – | Building |
| Door | 6 wood, 2 stone | – | Building |
| Campfire | 8 stone, 4 wood | – | Building |
| Cooked meat | 1 raw meat | Campfire | Food |

**Progression curve in the prototype**

1. **Bare hands** — survive the first minute, punch bushes and saplings.
2. **Stone axe** — quadruples gathering and unlocks building.
3. **Shelter** — foundation, walls, door; a campfire against the night cold.
4. **Hunting** — spear, meat, hide (hide is reserved for the next tier: clothing).

**Planned (Alpha):** XP and tech tiers, blueprints found in caves, weapon and
tool parts, clothing layers with warmth/weight, a research station. The report's
formula (`100 · 1.1^(n−1)`) stays as a starting point but will be tuned after
playtesting, since a purely exponential XP curve makes late levels meaningless
quickly.

## 7. Building

* **Grid:** pieces snap to the terrain grid (4 m). Foundations and campfires
  fill a cell; walls and doors snap to one of the cell's four edges (rotation
  0–3, N/E/S/W).
* **Support:** walls and doors need a foundation in the cell (or the cell
  next to it) — otherwise the ground must be flat (< 0.45 slope). Foundations
  need flat ground (< 0.85) and cannot be placed in water.
* **HP:** foundation 500, wall 400, door 300, campfire 200.
* **Demolition:** the player reclaims 50 % of the materials.
* **Decay/upkeep:** every piece has a decay timer (6 h). A player's presence
  within 12 m refreshes it; otherwise the piece loses 4 hp/s and eventually
  disappears. This keeps the world free of abandoned bases (the same problem
  Rust solves with upkeep) without needing a full resource-silo system in the MVP.
* **PvP raiding:** on PvP servers walls and doors can be forced (planned), which
  makes defence — doors, height, location — meaningful.

## 8. Combat

* **Reach:** 3.4 m, ~57° forward cone, 2.4 m vertical, 0.55 s cooldown.
* **Damage:** hands 8, stone axe 22, spear 34, stone pickaxe 15 (vs animals).
* **Animals:** deer flee (45 hp), boars attack within 12 m (80 hp, 14 damage).
* **Death:** the player loses half of their resources and food (not tools — they
  are destroyed instead, as in Rust) and respawns at the spawn point.
* **PvP/PvE:** the prototype is PvP-on. Planned: a server switch for PvP, plus
  separate death-loot rules.

## 9. Inventory and items

* 12 backpack slots; the first 9 are mirrored on the hotbar (1–9, mouse wheel).
* Stack sizes: resources 200, food 100, tools 1.
* Tools have durability shown as a thin bar in the inventory and hotbar.
* Moving and merging stacks is server-authoritative (`moveitem`).

## 10. UI/UX

* **HUD:** health/stamina/hunger/thirst/breath, a day/night clock, hotbar, a
  simple map (`M`), chat (`T`), and a contextual hint bar.
* **Backpack (`Tab`)** with item and recipe tabs; recipes show "have/need" and
  grey out when unaffordable.
* **Build mode (`B`)** with a ghost preview showing validity in green/red,
  rotation with `R`, removal with right click.
* **Settings (`Esc`):** view distance, FOV, mouse sensitivity, shadows, sound,
  language (Swedish/English), "simple graphics" for weak GPUs.
* **Accessibility:** text lives in the DOM (scalable, high contrast), icons
  accompany colours, every command has a key binding, no information is conveyed
  by colour alone, and sound can be disabled.

## 11. Audio

All audio is synthesised in the browser with Web Audio (no files): a wind bed,
footsteps, chops, stone hits, weapon hits, building, crafting, eating and a low
tone on death. It keeps the prototype fully self-contained — but production
should move to recorded OGG loops with HRTF panning, as the report suggests.

## 12. Balance philosophy

1. **Everything should be understandable without text.** Green = good, red =
   bad, clear icons, audio feedback.
2. **The first tool within 60 seconds.** Otherwise curious players bounce.
3. **One resource per role.** Wood = structure, stone = tools/heat, fibre =
   bindings, hide = (future) protection.
4. **No grind without an alternative.** If you lack a material you can always
   switch activity.
5. **Numbers are cheap to change.** Everything lives in `shared/config.js`;
   change it and run `npm test` to make sure nothing breaks.

## 13. Open questions for playtesting

* Is 15 minutes to hunger too long (eventless) or too short (stressful) in a
  45-minute session?
* Is a 6 h decay timer reasonable for someone who plays 1 h/day?
* Should the night cold be lethal or merely uncomfortable?
* Are 12 inventory slots enough, or do we need backpacks (the report's
  weight-based inventory) already in Alpha?
* Does the 4 m build grid become too coarse once players want roofs and
  second floors?
