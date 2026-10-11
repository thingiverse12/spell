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

Eimi is the taller, faster sprinter (8.0 m/s); Asch the stockier jogger (5.5 m/s).

## Character models

`public/models/*.glb` are real glTF 2.0 binaries, loaded at runtime with
`GLTFLoader`. They are generated, not authored — there is no network access here
to fetch assets — but they are ordinary model files, so a hand-made `.glb` can
replace them without touching any runtime code.

```bash
npm run build:models   # regenerate public/models/{eimi,asch}.glb
```

`tools/humanoid.ts` builds each body from lofted elliptical tubes: a profile of
cross-sections swept along a curve, which gives tapered limbs and a shaped
torso. Details are per character:

| | Eimi | Asch |
|---|---|---|
| Height | 1.74 m | 1.60 m |
| Build | slim (0.92) | stocky (1.12) |
| Hair | long — fringe, side locks, back mane | short, spiked |
| Outfit | skirt with hem band, scarf | vest, shoulder pads, boot cuffs |

Both are normalised after generation to exactly their configured height with
their soles on `y = 0`, so the gameplay code can rely on that regardless of how
the generator is tweaked.

Each model exports the joints the controller animates as named nodes — `torso`,
`head`, `armLeft`, `armRight`, `legLeft`, `legRight` — each positioned at its
joint so rotating the node articulates the limb. `ModelLibrary` loads each file
once and hands out clones; clones share buffers, so two characters cost one copy
of the mesh data on the GPU.

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

### Screenshots — CPU renderer, no browser needed

```bash
npm run screenshots    # writes screenshots/*.png
```

There is no GPU or browser in CI, so `tools/softrender.ts` rasterises the scene
on the CPU: it walks the real scene graph, projects through the real camera
matrices, z-buffers the triangles and writes PNGs using only Node's built-in
`zlib`. Camera framing, rig geometry and character placement all come from the
production code — only *shading* is reimplemented (Lambert + hemisphere ambient,
ACES tone mapping, sRGB output, per-pixel fog, frustum clipping).

`tools/capture.ts` poses six shots: Eimi idle, Eimi sprinting, Asch jogging,
Eimi airborne, both characters side by side, and a close-up.

> It is an approximation of three.js, not a match — no specular/IBL, flat-shaded
> faces. Good enough to confirm composition, silhouette and palette; do not treat
> it as a reference render.

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
