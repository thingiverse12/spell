# spell

A Three.js prototype. Current work: **TASK-001 — third-person character
controller with dual character switching (Eimi & Asch)**.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Controls

| Input | Action |
|-------|--------|
| `W` `A` `S` `D` / arrows | Move (camera-relative) |
| `Shift` | Sprint |
| `Space` | Jump |
| `Tab` | Switch character |
| `1` / `2` | Select Eimi / Asch directly |
| Drag | Orbit camera |
| Wheel | Zoom |
| Gamepad | Left stick move · `Y` switch · `A` jump · right stick orbit · `LT` sprint |

Characters are geometric placeholders — Eimi is the taller, faster sprinter
(8.0 m/s), Asch the stockier jogger (5.5 m/s).

## Layout

```
src/
  main.ts                      bootstrap
  App.ts                       renderer, frame loop, wiring
  camera/ThirdPersonCamera.ts  orbit + follow rig (owns yaw/pitch)
  characters/
    Character.ts               motion + procedural locomotion
    CharacterManager.ts        roster, switching, momentum transfer
    placeholderRig.ts          primitive humanoid + Disposer
    roster.ts                  Eimi & Asch profiles
    types.ts                   profile/intent contracts
  input/InputManager.ts        keyboard, pointer, gamepad
  scene/World.ts               ground, lighting, landmarks
  ui/Hud.ts                    DOM overlay
  debug.ts                     read-only telemetry seam for tests
tests/
  logic.test.ts                headless acceptance harness (Node)
  e2e/task-001.spec.ts         Playwright end-to-end suite
scripts/atlas_run.sh           Atlas Market async API runner
```

## Testing

### Headless — runs anywhere, no browser needed

```bash
npm test           # typecheck + 33 logic checks
```

`tests/logic.test.ts` executes the real controller, switch and camera code under
Node (three.js works headlessly; only rasterisation needs a GPU). It asserts:

- **Speeds** — Eimi settles at 8.0 m/s and never exceeds it; Asch at 5.5 m/s and
  never exceeds it; walking is slower than sprinting.
- **Swap** — world position preserved to 1e-9, camera yaw/pitch preserved to
  1e-12, momentum carried across but clamped to the incoming body, outgoing
  character frozen and hidden.
- **Camera** — sits behind and above, lags an instant 8 m teleport (proving it
  damps rather than snaps), then re-frames to the configured distance; orbiting
  preserves follow distance; zoom is clamped.
- **Stability** — 1000 consecutive switches add zero meshes and zero scene
  children; every character keeps exactly one parent; `dispose()` empties the
  scene.

### End-to-end — Playwright, requires a browser

```bash
npm run test:e2e:install   # one-off: downloads Chromium
npm run test:e2e
```

Drives the real input path with keyboard events and reads measurements through
`window.__spell` (installed by `src/debug.ts`). Covers camera framing, the `Tab`
swap, per-character speed ceilings, momentum clamping, jump/land, the HUD roster
chips, and a 50-switch leak check against `renderer.info`.

> Chromium is launched with SwiftShader (`--use-angle=swiftshader`) so WebGL
> works in headless CI.

## Atlas Market API runner

`scripts/atlas_run.sh` submits `tasks/TASK-001.payload.json` to the Atlas
`api_execute_async` endpoint and polls `api_status` until completion.

```bash
export API_KEY=...                                  # Atlas workspace API key
./scripts/atlas_run.sh -i fba2855f-2e0a-485e-ac0c-193f99a58400
./scripts/atlas_run.sh -i <id> -t tasks/TASK-001.payload.json -o result.json -q
```

The key is passed to curl through a config file on **stdin**, so it never appears
in the process table. It is prompted for interactively if `API_KEY` is unset.
Run `./scripts/atlas_run.sh --help` for all options.

## Notes

- The dev server binds `0.0.0.0` with `allowedHosts: true` so it works behind
  arbitrary preview/proxy hostnames.
- Frame delta is clamped to 50 ms so a backgrounded tab cannot teleport the
  character on return.
