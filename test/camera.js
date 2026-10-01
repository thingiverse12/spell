/**
 * Spell - camera unit tests.
 *
 * The camera is the one system where a bug makes the game unplayable ("the view
 * is upside down / I am looking at the sky and cannot get back"). So the rules
 * are stated as tests instead of hopes:
 *
 *   - pitch can never reach straight up/down (the up-vector would flip)
 *   - roll is always exactly 0
 *   - screen convention: mouse up = look up
 *   - the first mousemove of a drag cannot snap the camera (regression)
 *   - absurd/NaN deltas cannot poison the rotation (regression)
 *   - the camera never ends up inside the terrain
 *   - the runtime self-check actually detects the failure modes
 *
 * Usage:  npm run test:camera
 */

import {
  PITCH_LIMIT, LOOK_SCALE, DEFAULT_SENSITIVITY, MAX_LOOK_DELTA, TAP_MAX_MS, TAP_MAX_PX,
  clampPitch, applyLook, anchorDrag, dragDelta, isTap, computeCameraPose, checkCamera,
} from '../client/src/camera.js';
import { settings } from '../client/src/settings.js';

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);

console.log('\n\x1b[1mKameratets\x1b[0m');

/* ------------------------------------------------------------------ *
 * 1. Pitch limits
 * ------------------------------------------------------------------ */
section('1. Pitch-gränser (kameran får aldrig vända)');
check('gränsen ligger under 90°', PITCH_LIMIT < Math.PI / 2, `${PITCH_LIMIT} vs ${Math.PI / 2}`);
check('clampPitch klipper uppåt', clampPitch(99) === PITCH_LIMIT);
check('clampPitch klipper nedåt', clampPitch(-99) === -PITCH_LIMIT);
check('clampPitch tillåter värden inom intervallet', Math.abs(clampPitch(0.5) - 0.5) < 1e-12);
check('clampPitch gör NaN ofarligt', clampPitch(NaN) === 0);
check('clampPitch gör Infinity ofarligt', clampPitch(Infinity) === 0 && clampPitch(-Infinity) === 0);

check('1000 drag uppåt når aldrig zenit', (() => {
  const look = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 1000; i++) applyLook(look, 0, -200, { sensitivity: 4 });
  return look.pitch <= PITCH_LIMIT && look.pitch > PITCH_LIMIT - 1e-9;
})());
check('1000 drag nedåt når aldrig nadir', (() => {
  const look = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 1000; i++) applyLook(look, 0, 200, { sensitivity: 4 });
  return look.pitch >= -PITCH_LIMIT && look.pitch < -PITCH_LIMIT + 1e-9;
})());

/* ------------------------------------------------------------------ *
 * 2. Screen convention
 * ------------------------------------------------------------------ */
section('2. Skärmkonvention (mus upp = titta upp)');
check('mus uppåt höjer blicken', (() => {
  const look = { yaw: 0, pitch: 0 };
  applyLook(look, 0, -100, { sensitivity: 1 });
  return look.pitch > 0;
})());
check('mus nedåt sänker blicken', (() => {
  const look = { yaw: 0, pitch: 0 };
  applyLook(look, 0, 100, { sensitivity: 1 });
  return look.pitch < 0;
})());
check('inverterad Y gör tvärtom', (() => {
  const look = { yaw: 0, pitch: 0 };
  applyLook(look, 0, -100, { sensitivity: 1, invertY: true });
  return look.pitch < 0;
})());
check('mus åt höger vrider åt höger (yaw minskar)', (() => {
  const look = { yaw: 0, pitch: 0 };
  applyLook(look, 100, 0, { sensitivity: 1 });
  return look.yaw < 0;
})());
check('känsligheten skalar linjärt', (() => {
  const a = { yaw: 0, pitch: 0 };
  const b = { yaw: 0, pitch: 0 };
  applyLook(a, 100, 0, { sensitivity: 1 });
  applyLook(b, 100, 0, { sensitivity: 2 });
  return Math.abs(b.yaw - a.yaw * 2) < 1e-9;
})());
check('standardkänslighet motsvarar LOOK_SCALE per pixel', (() => {
  const look = { yaw: 0, pitch: 0 };
  applyLook(look, 100, 0, { sensitivity: 1 });
  return Math.abs(look.yaw + 100 * LOOK_SCALE) < 1e-12;
})());
check('orimlig känslighet faller tillbaka på standardvärdet', (() => {
  const fallback = { yaw: 0, pitch: 0 };
  const explicit = { yaw: 0, pitch: 0 };
  applyLook(fallback, 100, 0, { sensitivity: NaN });
  applyLook(explicit, 100, 0, { sensitivity: DEFAULT_SENSITIVITY });
  return Math.abs(fallback.yaw - explicit.yaw) < 1e-12;
})());
check('kamerans standardkänslighet matchar appens inställning', (() => {
  const fallback = { yaw: 0, pitch: 0 };
  const appDefault = { yaw: 0, pitch: 0 };
  applyLook(fallback, 100, 0, { sensitivity: undefined });
  applyLook(appDefault, 100, 0, { sensitivity: settings.sensitivity });
  return Math.abs(fallback.yaw - appDefault.yaw) < 1e-12;
})());

/* ------------------------------------------------------------------ *
 * 3. Yaw hygiene
 * ------------------------------------------------------------------ */
section('3. Yaw hålls inom rimligt intervall');
check('yaw stannar inom ±180° efter lång snurr', (() => {
  const look = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 2000; i++) applyLook(look, 200, 0, { sensitivity: 4 });
  return Math.abs(look.yaw) <= Math.PI + 1e-9;
})());
check('yaw förblir ändligt', (() => {
  const look = { yaw: 0, pitch: 0 };
  for (let i = 0; i < 500; i++) applyLook(look, Math.random() * 40 - 20, Math.random() * 40 - 20, {});
  return Number.isFinite(look.yaw) && Number.isFinite(look.pitch);
})());

/* ------------------------------------------------------------------ *
 * 4. Regression: drag-look must not snap
 * ------------------------------------------------------------------ */
section('4. Regression: drag-look fick kameran att slå i taket');
check('första musrörelsen i drag-läge ger noll delta', (() => {
  const mouse = { lastX: 0, lastY: 0, hasAnchor: false, drag: true };
  const { dx, dy } = dragDelta(mouse, 812, 431); // spelarens pekare långt från 0,0
  return dx === 0 && dy === 0;
})());
check('andra rörelsen ger en rimlig delta', (() => {
  const mouse = { lastX: 0, lastY: 0, hasAnchor: false };
  dragDelta(mouse, 800, 400); // ankrar
  const { dx, dy } = dragDelta(mouse, 806, 404);
  return dx === 6 && dy === 4;
})());
check('ankaret flyttas med varje rörelse', (() => {
  const mouse = { lastX: 0, lastY: 0, hasAnchor: false };
  dragDelta(mouse, 100, 100);
  dragDelta(mouse, 110, 120);
  const { dx } = dragDelta(mouse, 115, 125);
  return dx === 5;
})());
check('orimliga hopp klipps (pekaren lämnar fönstret)', (() => {
  const mouse = { lastX: 0, lastY: 0, hasAnchor: false };
  anchorDrag(mouse, 100, 100);
  const { dx, dy } = dragDelta(mouse, 9000, -9000);
  return Math.abs(dx) === MAX_LOOK_DELTA && Math.abs(dy) === MAX_LOOK_DELTA;
})());
check('syntetisk delta med NaN ignoreras', (() => {
  const mouse = { lastX: 0, lastY: 0, hasAnchor: false };
  anchorDrag(mouse, 100, 100);
  const { dx, dy } = dragDelta(mouse, NaN, NaN);
  return dx === 0 && dy === 0;
})());
check('en hel drag-session kan inte vända kameran', (() => {
  const mouse = { lastX: 0, lastY: 0, hasAnchor: false, drag: true };
  const look = { yaw: 0, pitch: 0 };
  // simulera 400 musrörelser med hopp, NaN och normala rörelser huller om buller
  for (let i = 0; i < 400; i++) {
    const x = i % 37 === 0 ? 5000 : 400 + Math.sin(i) * 30;
    const y = i % 53 === 0 ? NaN : 300 + Math.cos(i) * 20;
    const { dx, dy } = dragDelta(mouse, x, y);
    applyLook(look, dx, dy, { sensitivity: 2 });
  }
  return Number.isFinite(look.pitch) && Math.abs(look.pitch) <= PITCH_LIMIT
    && Number.isFinite(look.yaw) && Math.abs(look.yaw) <= Math.PI + 1e-9;
})());

/* ------------------------------------------------------------------ *
 * 5. NaN-säkerhet
 * ------------------------------------------------------------------ */
section('5. NaN får aldrig nå rotationen');
check('applyLook med NaN lämnar blicken orörd', (() => {
  const look = { yaw: 0.3, pitch: 0.2 };
  applyLook(look, NaN, NaN, {});
  return look.yaw === 0.3 && look.pitch === 0.2;
})());
check('applyLook reparerar en redan förstörd vinkel', (() => {
  const look = { yaw: NaN, pitch: NaN };
  applyLook(look, 0, 0, {});
  return Number.isFinite(look.yaw) && Number.isFinite(look.pitch);
})());
check('computeCameraPose reparerar NaN-position', (() => {
  const pose = computeCameraPose({
    you: { x: 5, y: 10, z: 5, yaw: NaN, pitch: NaN },
    ground: 9, eyeHeight: 1.62, dt: 1 / 60, currentY: NaN,
  });
  return Number.isFinite(pose.x) && Number.isFinite(pose.y) && Number.isFinite(pose.yaw) && Number.isFinite(pose.pitch);
})());

/* ------------------------------------------------------------------ *
 * 6. Camera pose
 * ------------------------------------------------------------------ */
section('6. Kameraposition');
check('ögat hamnar en ögonhöjd över marken', (() => {
  const pose = computeCameraPose({ you: { x: 0, y: 10, z: 0 }, ground: 10, eyeHeight: 1.62, dt: 1, currentY: 11.62 });
  return Math.abs(pose.y - 11.62) < 1e-9;
})());
check('smygande sänker ögat', (() => {
  const stand = computeCameraPose({ you: { x: 0, y: 10, z: 0 }, ground: 10, eyeHeight: 1.62, dt: 1, currentY: 11.62 });
  const crouch = computeCameraPose({ you: { x: 0, y: 10, z: 0 }, ground: 10, eyeHeight: 1.05, dt: 1, currentY: 11.05 });
  return crouch.y < stand.y;
})());
check('kameran går aldrig under marken', (() => {
  let y = -50;
  for (let i = 0; i < 60; i++) {
    y = computeCameraPose({ you: { x: 0, y: 10, z: 0 }, ground: 10, eyeHeight: 1.62, dt: 1 / 60, currentY: y }).y;
    if (y < 10.25 - 1e-9) return false;
  }
  return true;
})());
check('mjuk följning (ingen återfjädring) konvergerar uppåt', (() => {
  let y = 4;
  const samples = [];
  for (let i = 0; i < 40; i++) {
    y = computeCameraPose({ you: { x: 0, y: 10, z: 0 }, ground: 10, eyeHeight: 1.62, dt: 1 / 60, currentY: y }).y;
    samples.push(y);
  }
  const monotonic = samples.every((v, i) => i === 0 || v >= samples[i - 1] - 1e-9);
  return monotonic && Math.abs(samples[samples.length - 1] - 11.62) < 0.01;
})());
check('roll är alltid exakt 0', (() => {
  for (let i = 0; i < 50; i++) {
    const pose = computeCameraPose({
      you: { x: 0, y: 5, z: 0, yaw: Math.random() * 10, pitch: Math.random() * 3 - 1.5 },
      ground: 5, eyeHeight: 1.62, dt: 1 / 60, currentY: 6.6,
    });
    if (pose.roll !== 0) return false;
  }
  return true;
})());
check('dt = 0 ändrar inget', (() => {
  const pose = computeCameraPose({ you: { x: 0, y: 10, z: 0 }, ground: 10, eyeHeight: 1.62, dt: 0, currentY: 20 });
  return Math.abs(pose.y - 20) < 1e-9;
})());

/* ------------------------------------------------------------------ *
 * 7. Runtime self-check
 * ------------------------------------------------------------------ */
section('7. Självkontrollen hittar felen');
const good = { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0.3, y: 1, z: 0 }, fov: 78 };
check('godkänd kamera ger inga problem', checkCamera(good).length === 0, checkCamera(good).join('; '));
check('NaN i position upptäcks', checkCamera({ ...good, position: { x: NaN, y: 2, z: 3 } }).length === 1);
check('lutning upptäcks', checkCamera({ ...good, rotation: { x: 0.3, y: 1, z: 0.4 } }).some((p) => /lutning/.test(p)));
check('pitch utanför gränsen upptäcks', checkCamera({ ...good, rotation: { x: 2.0, y: 1, z: 0 } }).some((p) => /pitch/.test(p)));
check('orimligt synfält upptäcks', checkCamera({ ...good, fov: 5 }).some((p) => /synfält/.test(p)));
check('upp-och-ned (pitch = π) upptäcks', checkCamera({ ...good, rotation: { x: Math.PI, y: 0, z: 0 } }).length > 0);

/* ------------------------------------------------------------------ *
 * 8. Click vs drag
 * ------------------------------------------------------------------ */
section('8. Klick kontra drag (så att tittandet inte hugger)');
const press = { at: 1000, x: 100, y: 100 };
check('kort tryck utan rörelse = klick', isTap(press, 1100, 102, 101) === true);
check('långt tryck = drag', isTap(press, 1000 + TAP_MAX_MS + 1, 100, 100) === false);
check('stor rörelse = drag', isTap(press, 1100, 100 + TAP_MAX_PX + 5, 100) === false);
check('inget tryck = inget klick', isTap(null, 1100, 100, 100) === false);

console.log(`\n\x1b[1mResultat:\x1b[0m ${passed} godkända, ${failed} misslyckade\n`);
process.exit(failed ? 1 : 0);
