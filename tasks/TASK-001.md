# TASK-001 — Third-Person Character Controller & Dual Character Switching (Eimi & Asch)

**System:** Gameplay Engineering
**Status:** Implemented
**Dependencies:** Three.js core scene, input manager

## Objective

Implement responsive third-person movement (WASD + camera-relative) and a seamless
character switch button (`Tab` or gamepad `Y`) between **Eimi** and **Asch**, with
preserved momentum and distinct camera offsets.

## Acceptance criteria & how each is met

| # | Criterion | Implementation | Where |
|---|-----------|----------------|-------|
| 1 | Smooth third-person orbit camera following the active character | Spherical orbit rig with exponential (frame-rate independent) damping on the follow point; drag/pointer or right-stick to orbit, wheel to zoom | `src/camera/ThirdPersonCamera.ts` |
| 2 | Instant character swap retaining world position and camera angle | Yaw/pitch live on the **camera rig**, not the character, so a swap cannot disturb them; the incoming character inherits the outgoing one's exact position (including airborne height) and facing | `src/characters/CharacterManager.ts` |
| 3 | Unique speeds — Eimi 8.0 m/s sprint, Asch 5.5 m/s jog | Per-profile `sprintSpeed` / `walkSpeed` / `acceleration` / `turnRate` / `jumpSpeed` | `src/characters/roster.ts` |
| 4 | Clean state transition, no memory leaks or duplicate meshes | Both rigs are built **once** at boot and parented to the scene once; switching only toggles visibility and transfers motion state. A `Disposer` releases every geometry/material/texture on teardown | `src/characters/CharacterManager.ts`, `src/characters/placeholderRig.ts` |

## Design decisions

**Momentum is carried across the swap, but clamped.**
The objective asks for "preserved momentum" while criterion 3 fixes each
character's top speed. Carrying Eimi's full 8 m/s into Asch would let Asch exceed
his 5.5 m/s ceiling, so the velocity vector is transferred *and* clamped to the
incoming body's top speed. Direction and intent survive; the per-character speed
contract is never violated.

**Camera framing blends, the camera angle does not.**
Each character declares a `CameraProfile` (distance, height, shoulder, FOV,
pitch offset) so Eimi and Asch frame differently. On a swap those values blend
over ~100 ms. Yaw and pitch — the *player's* camera angle — are never touched.

**Only the active character is simulated.**
Parked characters are frozen and invisible, so an unbounded number of switches
costs nothing per frame.

**Placeholder rigs are procedural.**
Capsule/sphere/box primitives assembled into a humanoid, uniformly scaled so the
standing height matches the profile exactly (Eimi 1.74 m, Asch 1.60 m). No
external assets, no network fetch.

## Verification

```bash
npm run test:logic   # 33 headless checks, no browser required
npm run test:e2e     # Playwright, drives real keyboard input in Chromium
```

The headless harness runs the real controller, switch and camera code in Node
(`tests/logic.test.ts`) and covers all four criteria, including 1000 consecutive
switches with an unchanged scene graph. See the README for the full list.
