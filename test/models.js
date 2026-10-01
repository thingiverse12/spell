/**
 * Spell - model tests (rule: check the models).
 *
 * In the order the rule asks for:
 *   1. the design   - every model matches the size the gameplay uses
 *   2. the colours  - every colour comes from client/src/palette.js
 *   3. the materials- shared, flat shaded, one per piece+damage level
 *   4. how good they are - triangle budgets, meshes per model, draw calls
 *   5. the errors   - the audit finds NaN, empty geometry, missing materials
 *
 * Runs in jsdom without a GPU: three.js builds scene graphs fine in Node, only
 * *rendering* needs WebGL.
 *
 * Usage:  npm run test:models
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { createDom } from './dom-env.js';
import { NODES, ANIMALS, PIECES, PHYS, ITEMS, playerColor } from '../shared/config.js';
import {
  PALETTE, SKY, MATERIALS, SHARED_MATERIALS, BUDGET,
  normalizeColor, isColor, colorNumber, trianglesOf, auditObject3D, auditScene,
  describeModelProblems, allColors,
} from '../client/src/palette.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

createDom(); // textures (name tags) need a canvas
const {
  NodeView, BuildingView, AnimalView, PlayerView, ViewModel, BuildGhost,
  buildingCacheStats, nodeLayout,
} = await import('../client/src/entities.js');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const sizeOf = (root) => {
  const box = new THREE.Box3().setFromObject(root);
  return box.isEmpty() ? new THREE.Vector3() : box.getSize(new THREE.Vector3());
};
const meshesOf = (root) => {
  const out = [];
  root.traverse((o) => { if (o.isMesh) out.push(o); });
  return out;
};

console.log('\n\x1b[1mModelltest (design, färger, material, kvalitet, fel)\x1b[0m');

/* ------------------------------------------------------------------ *
 * 1. Palette
 * ------------------------------------------------------------------ */
section('1. Paletten');

check('paletten har minst 15 namngivna färger', Object.keys(PALETTE).length >= 15, `${Object.keys(PALETTE).length}`);
check('himmelpaletten har minst 10 färger', Object.keys(SKY).length >= 10, `${Object.keys(SKY).length}`);
check('alla palettfärger är giltiga', allColors().every((c) => !!normalizeColor(c)), allColors().filter((c) => !normalizeColor(c)).join(','));
check('inga dubblerade färger i paletten', new Set(allColors()).size === allColors().length);
check('normalizeColor klarar #abc', normalizeColor('#abc') === '#aabbcc');
check('normalizeColor klarar #AABBCC', normalizeColor('#AABBCC') === '#aabbcc');
check('normalizeColor klarar tal', normalizeColor(0x6b4a2a) === '#6b4a2a');
check('normalizeColor avvisar skräp', normalizeColor('blå') === null && normalizeColor(null) === null && normalizeColor('#12345') === null);
check('isColor accepterar serverns hsl()', isColor('hsl(210, 62%, 55%)'));
check('isColor avvisar tomt', !isColor('') && !isColor(undefined));
check('colorNumber är trevligt', colorNumber('#000000') === 0 && colorNumber('#ffffff') === 0xffffff);

/* ------------------------------------------------------------------ *
 * 2. Materials
 * ------------------------------------------------------------------ */
section('2. Material');

const matList = Object.entries(MATERIALS);
check('minst 12 delade material', matList.length >= 12, `${matList.length}`);
check('alla material har en giltig färg', matList.every(([, m]) => !!normalizeColor(m.color.getHex())));
check('alla material är delade (samma objekt)', matList.every(([, m]) => SHARED_MATERIALS.has(m)));
check('varje material används av något palettnamn', SHARED_MATERIALS.size === matList.length);
const lambert = matList.filter(([, m]) => m.isMeshLambertMaterial);
check('modellmaterialen är Lambert (billiga, low-poly)', lambert.length >= 10, `${lambert.length}`);
check('modellmaterialen är flat shaded', lambert.every(([, m]) => m.flatShading === true));
check('ingen textur används (low-poly = inga texturer)', matList.every(([, m]) => !m.map && !m.normalMap));
check('genomskinliga material skriver inte djup', ['ghostOk', 'ghostBad'].every((k) => MATERIALS[k].transparent && MATERIALS[k].depthWrite === false));
check('lågan är genomskinlig', MATERIALS.flame.transparent === true && MATERIALS.flame.opacity > 0.8);
check('ingen NaN i materialfärger', matList.every(([, m]) => Number.isFinite(m.color.r) && Number.isFinite(m.color.g) && Number.isFinite(m.color.b)));

/* ------------------------------------------------------------------ *
 * 3. Resource nodes: design + shared pools
 * ------------------------------------------------------------------ */
section('3. Resursnoder');

for (const [type, def] of Object.entries(NODES)) {
  const layout = nodeLayout(type, 1);
  check(`nod ${type}: silhuetten är exakt speldatans ${def.height} m`, Math.abs(layout.height - def.height) < 0.02,
    `${layout.height.toFixed(3)}`);
  // base of every part: centre - half its authored height
  const raw = { tree: 9.0, rock: 1.615, bush: 1.275 }[type];
  const bottoms = Object.entries(layout.parts).map(([kind, part]) => {
    const partRaw = type === 'tree' ? (kind === 'trunk' ? 4.2 : 5.2) : raw;
    return part.y - (partRaw * part.sy) / 2;
  });
  check(`nod ${type}: modellen börjar i marken (inte under)`, Math.abs(Math.min(...bottoms)) < 0.02,
    `lägsta ${Math.min(...bottoms).toFixed(3)}`);
  check(`nod ${type}: skalan är positiv och rimlig`, Object.values(layout.parts).every((p) => p.sy > 0.1 && p.sy < 2));
}
{
  const src = fs.readFileSync(path.join(ROOT, 'client/src/entities.js'), 'utf8');
  check('placeringen använder nodeLayout (en sanning)', /_place\(entry\) \{[\s\S]{0,300}nodeLayout\(entry\.type/.test(src));
  check('ingen gammal hårdkodad placering kvar', !/entry\.y \+ 0\.55 \* s/.test(src) && !/entry\.y \+ h \+ 2\.2/.test(src));
}

const nodeScene = new THREE.Scene();
const nodeView = new NodeView(nodeScene);
for (let i = 0; i < 25; i++) nodeView.upsert({ id: `n${i}`, type: 'tree', x: i, y: 0, z: 0, rot: 0, scale: 1 });
const instanced = nodeScene.children.filter((o) => o.isInstancedMesh);
check('25 träd ritas med instansning (få meshes)', nodeScene.children.length <= 8, `${nodeScene.children.length} objekt`);
check('instansningen har kapacitet för noderna', instanced.some((m) => m.count > 0));
check('träden använder två instanspooler (stam + krona)', instanced.length >= 2, `${instanced.length}`);

/* ------------------------------------------------------------------ *
 * 4. Animals: the silhouette must match the gameplay height
 * ------------------------------------------------------------------ */
section('4. Djur');

for (const [type, def] of Object.entries(ANIMALS)) {
  const scene = new THREE.Scene();
  const view = new AnimalView(scene);
  view.upsert({ id: 'a1', type, x: 0, y: 0, z: 0, yaw: 0, hp: def.hp });
  const size = sizeOf(scene);
  check(`djur ${type}: modellhöjden är exakt speldatans ${def.height} m`, Math.abs(size.y - def.height) < 0.02,
    `modell ${size.y.toFixed(3)}`);
  check(`djur ${type}: har kropp, huvud och ben`, meshesOf(scene).length >= 6, `${meshesOf(scene).length} meshes`);
  check(`djur ${type}: delar material med paletten`, meshesOf(scene).every((m) => SHARED_MATERIALS.has(m.material)));
  check(`djur ${type}: kastar skugga från kroppen`, meshesOf(scene).some((m) => m.castShadow));
  const tris = meshesOf(scene).reduce((n, m) => n + trianglesOf(m.geometry), 0);
  check(`djur ${type}: ryms i tri-budgeten (${tris} ≤ ${BUDGET.animal})`, tris <= BUDGET.animal);
}
{
  // Two deer must share geometry *and* material - otherwise every animal costs memory.
  const scene = new THREE.Scene();
  const view = new AnimalView(scene);
  view.upsert({ id: 'a1', type: 'deer', x: 0, y: 0, z: 0, yaw: 0, hp: 10 });
  view.upsert({ id: 'a2', type: 'deer', x: 5, y: 0, z: 0, yaw: 0, hp: 10 });
  const geos = new Set();
  const mats = new Set();
  for (const m of meshesOf(scene)) { geos.add(m.geometry.uuid); mats.add(m.material.uuid); }
  check('två djur delar geometrier (7 delar -> 4 geometrier)', geos.size <= 5, `${geos.size} geometrier`);
  check('två djur delar material (2 material)', mats.size <= 2, `${mats.size} material`);
}

// The gameplay data describes colours too: they must live in the palette, so the
// config and the renderer cannot drift apart.
check('djurens färger i speldatan finns i paletten', Object.values(ANIMALS).every((a) => allColors().includes(normalizeColor(a.color))),
  Object.values(ANIMALS).map((a) => a.color).join(','));
check('njuret använder sin egen färg (inte grannens)', (() => {
  const scene = new THREE.Scene();
  const view = new AnimalView(scene);
  view.upsert({ id: 'd', type: 'deer', x: 0, y: 0, z: 0, yaw: 0, hp: 10 });
  const deerCol = meshesOf(scene)[0]?.material?.color?.getHexString();
  const scene2 = new THREE.Scene();
  const view2 = new AnimalView(scene2);
  view2.upsert({ id: 'b', type: 'boar', x: 0, y: 0, z: 0, yaw: 0, hp: 10 });
  const boarCol = meshesOf(scene2)[0]?.material?.color?.getHexString();
  return deerCol !== boarCol;
})(), 'deer och boar ritas i samma färg');

/* ------------------------------------------------------------------ *
 * 5. Buildings: size, cache, damage tint
 * ------------------------------------------------------------------ */
section('5. Byggdelar');

for (const [piece, def] of Object.entries(PIECES)) {
  const scene = new THREE.Scene();
  const view = new BuildingView(scene);
  view.upsert({ id: 'b1', piece, cx: 0, cz: 0, rot: 0, y: 0, hp: def.hp, open: false, ownerName: 'x' });
  const size = sizeOf(scene);
  // Never *bigger* than the collision box (you would walk through visible walls);
  // solid pieces must match it, decorative pieces (the campfire) may be smaller.
  const overhang = Math.max(size.x - def.size[0], size.z - def.size[2]);
  const deviation = Math.max(Math.abs(size.x - def.size[0]), Math.abs(size.z - def.size[2]));
  const decorative = piece === 'campfire';
  check(`byggdel ${piece}: modellen är aldrig större än speldatans box`, overhang <= 0.15,
    `modell ${size.x.toFixed(2)}×${size.z.toFixed(2)} vs ${def.size[0]}×${def.size[2]}`);
  check(`byggdel ${piece}: ${decorative ? 'dekoren ryms inom' : 'storleken stämmer med'} speldatan`,
    decorative ? overhang <= 0.15 : deviation < 0.15,
    `modell ${size.x.toFixed(2)}×${size.z.toFixed(2)} vs ${def.size[0]}×${def.size[2]}`);
  check(`byggdel ${piece}: höjden ryms i speldatans höjd + dekor`,
    size.y <= def.size[1] + 0.95, `modell ${size.y.toFixed(2)} vs ${def.size[1]}`);
  const tris = meshesOf(scene).reduce((n, m) => n + trianglesOf(m.geometry), 0);
  check(`byggdel ${piece}: ryms i tri-budgeten (${tris} ≤ ${BUDGET.piece * 2})`, tris <= BUDGET.piece * 2);
  check(`byggdel ${piece}: materialet är delat eller cachat`, meshesOf(scene).every((m) => SHARED_MATERIALS.has(m.material) || m.material.userData.ownColor === true));
}
{
  const scene = new THREE.Scene();
  const view = new BuildingView(scene);
  const before = buildingCacheStats();
  for (let i = 0; i < 12; i++) {
    view.upsert({ id: `w${i}`, piece: 'wall', cx: i, cz: 0, rot: 0, y: 0, hp: 400, open: false, ownerName: 'x' });
  }
  const after = buildingCacheStats();
  const geos = new Set();
  const mats = new Set();
  for (const m of meshesOf(scene)) { geos.add(m.geometry.uuid); mats.add(m.material.uuid); }
  check('12 likadana väggar delar EN geometri', geos.size === 1, `${geos.size}`);
  check('12 likadana väggar delar ETT material', mats.size === 1, `${mats.size}`);
  check('cachen växer inte per byggnad', after.geometries - before.geometries <= 1 && after.materials - before.materials <= 1,
    `geo +${after.geometries - before.geometries}, mat +${after.materials - before.materials}`);

  // damage tint: hue must survive (the old code used setScalar, which greyed it)
  const wood = MATERIALS.wood.color;
  view.upsert({ id: 'w0', piece: 'wall', cx: 0, cz: 0, rot: 0, y: 0, hp: 60, open: false, ownerName: 'x' });
  const mesh = meshesOf(scene)[0];
  const c = mesh.material.color;
  check('skadad vägg blir mörkare, inte grå', c.getHex() !== wood.getHex() && c.r > c.g && c.g > c.b,
    `#${c.getHexString()} (original #${wood.getHexString()})`);
  check('skadad vägg har en annan (cachad) materialinstans', mesh.material !== MATERIALS.wood && mesh.material.userData.ownColor === true);
  check('oskadad vägg använder det delade materialet', (() => {
    view.upsert({ id: 'w1', piece: 'wall', cx: 1, cz: 0, rot: 0, y: 0, hp: 400, open: false, ownerName: 'x' });
    return meshesOf(scene).some((m) => m.material === MATERIALS.wood);
  })());
}

/* ------------------------------------------------------------------ *
 * 6. Player + view model
 * ------------------------------------------------------------------ */
section('6. Spelare och viewmodel');

{
  const scene = new THREE.Scene();
  const view = new PlayerView(scene, 'self');
  view.setSeed(1337);
  view.upsert({ id: 'p2', name: 'Anna', x: 0, y: 0, z: 0, yaw: 0, crouch: false, health: 100, toolItem: null, color: 'hsl(210, 62%, 55%)' });
  const body = new THREE.Box3();
  for (const m of meshesOf(scene)) body.union(new THREE.Box3().setFromObject(m));
  const bsize = body.getSize(new THREE.Vector3());
  check('spelarkroppen är PHYS.height hög', Math.abs(bsize.y - PHYS.height) < 0.1, `${bsize.y.toFixed(2)} vs ${PHYS.height}`);
  check('spelarens fötter står på marken (y≈0)', Math.abs(body.min.y) < 0.02, `lägsta y ${body.min.y.toFixed(3)}`);
  check('playerColor ger en giltig färg (inte NaN)', (() => {
  const ids = ['color-a', 'player-17', 'gäst', 7, ''];
  return ids.every((id) => {
    const c = playerColor(id);
    return /^hsl\(\d+, 62%, 55%\)$/.test(c) && !/NaN/.test(c);
  });
})(), ['color-a', 'player-17', 'gäst', 7, ''].map(playerColor).join(' | '));
check('playerColor är stabil och ungefär unik', (() => {
  const a = playerColor('anna');
  const b = playerColor('anna');
  const hues = new Set(['anna', 'bo', 'carl', 'dora', 'erik'].map((n) => playerColor(n).match(/^hsl\((\d+),/)?.[1]));
  const hueOf = (id) => Number(playerColor(id).match(/^hsl\((\d+),/)?.[1]);
  const gap = Math.abs(hueOf('preview-anna') - hueOf('preview-bo'));
  return a === b && hues.size >= 4 && Math.min(gap, 360 - gap) >= 30;
})());
check('Three.js ritar spelar-HSL som riktiga färger (inte vit fallback)', (() => {
  const a = new THREE.Color(playerColor('anna'));
  const b = new THREE.Color(playerColor('bo'));
  return a.getHex() !== 0xffffff && b.getHex() !== 0xffffff && a.getHex() !== b.getHex();
})());
check('spelarens kroppsmaterial är eget (färg per spelare)', meshesOf(scene).some((m) => !SHARED_MATERIALS.has(m.material)));
  check('huvudet använder det delade skinnmaterialet', meshesOf(scene).some((m) => m.material === MATERIALS.skin));
  check('spelaren får serverns färg och Three.js faktiskt ritar den', (() => {
    const color = playerColor('color-test');
    const expected = new THREE.Color(color);
    view.upsert({ id: 'p3', name: 'Bo', x: 2, y: 0, z: 0, yaw: 0, crouch: false, health: 100, toolItem: null, color });
    const bodyMat = meshesOf(scene).map((m) => m.material).find((m) => m.color?.getHex() === expected.getHex());
    return !!bodyMat && expected.getHex() !== 0xffffff;
  })(), 'färgen från snapshoten saknas eller blev vit');
  check('namnskylten ritas som sprite', (() => {
    let sprites = 0;
    scene.traverse((o) => { if (o.isSprite) sprites++; });
    return sprites >= 1;
  })());
  check('spelarmodellen ryms i budgeten', meshesOf(scene).reduce((n, m) => n + trianglesOf(m.geometry), 0) <= BUDGET.player * 2);
}
{
  const vm = new ViewModel();
  const keys = ['fist', 'stone_axe', 'stone_pickaxe', 'torch', 'spear'];
  check('viewmodel har modeller för alla verktyg', keys.every((k) => !!vm.models[k]), Object.keys(vm.models).join(','));
  for (const key of keys) {
    if (!vm.models[key]) continue;
    const tris = meshesOf(vm.models[key]).reduce((n, m) => n + trianglesOf(m.geometry), 0);
    check(`viewmodel ${key}: ryms i budgeten (${tris} ≤ ${BUDGET.viewModel})`, tris <= BUDGET.viewModel);
    check(`viewmodel ${key}: delar material med paletten`, meshesOf(vm.models[key]).every((m) => SHARED_MATERIALS.has(m.material)));
  }
  check('varje ITEMS-verktyg har en modell eller en fallback', Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'tool')
    .every((k) => vm.models[k] || vm.models.fist), Object.keys(ITEMS).filter((k) => ITEMS[k].kind === 'tool' && !vm.models[k]).join(','));
}
{
  const scene = new THREE.Scene();
  const ghost = new BuildGhost(scene);
  const budgetProblems = auditObject3D(ghost.mesh, { palette: false });
  check('spöket (byggmarkören) har en färgad mesh', meshesOf(ghost.mesh).length >= 1 && ghost.mesh.material?.color);
  check('spöket har inga modellfel', budgetProblems.problems.length === 0, budgetProblems.problems.join('; '));
  ghost.show('wall', 0, 0, 0, 0, true);
  const okColor = normalizeColor(ghost.mesh.material.color.getHex());
  ghost.show('wall', 0, 0, 0, 0, false);
  const badColor = normalizeColor(ghost.mesh.material.color.getHex());
  check('spöket byter färg när platsen är ogiltig', okColor === normalizeColor(PALETTE.ghostOk) && badColor === normalizeColor(PALETTE.ghostBad),
    `${okColor} / ${badColor}`);
}

/* ------------------------------------------------------------------ *
 * 7. The audit itself (rule 8e: "then the errors in it")
 * ------------------------------------------------------------------ */
section('7. Revisionen hittar fel');

const clean = new THREE.Group();
clean.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), MATERIALS.wood));
check('en frisk modell ger inga fel', auditObject3D(clean, { palette: true }).problems.length === 0,
  auditObject3D(clean, { palette: true }).problems.join('; '));
check('antalet meshes och trianglar räknas', (() => {
  const r = auditObject3D(clean);
  return r.meshes === 1 && r.triangles === 12;
})(), JSON.stringify(auditObject3D(clean)));

const missingMat = new THREE.Group();
missingMat.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), null));
check('mesh utan material rapporteras', auditObject3D(missingMat).problems.some((p) => /material/.test(p)), auditObject3D(missingMat).problems.join('; '));

const emptyGeo = new THREE.Group();
emptyGeo.add(new THREE.Mesh(new THREE.BufferGeometry(), MATERIALS.wood));
check('tom geometri rapporteras', auditObject3D(emptyGeo).problems.some((p) => /trianglar/.test(p)), auditObject3D(emptyGeo).problems.join('; '));

const nanGeo = new THREE.Group();
{
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.attributes.position.setXYZ(0, NaN, 0, 0);
  nanGeo.add(new THREE.Mesh(g, MATERIALS.wood));
}
check('NaN i vertex-data rapporteras', auditObject3D(nanGeo).problems.some((p) => /NaN/.test(p)), auditObject3D(nanGeo).problems.join('; '));

const heavy = new THREE.Group();
heavy.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), MATERIALS.rock));
check('för tung mesh rapporteras', auditObject3D(heavy).problems.some((p) => /över taket/.test(p)), auditObject3D(heavy).problems.join('; '));

const offPalette = new THREE.Group();
offPalette.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xff00ff })));
check('färg utanför paletten rapporteras', auditObject3D(offPalette, { palette: true }).problems.some((p) => /paletten/.test(p)), auditObject3D(offPalette, { palette: true }).problems.join('; '));

const ownMat = new THREE.Group();
ownMat.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), MATERIALS.wood.clone()));
check('eget material rapporteras när delning krävs', auditObject3D(ownMat, { requireShared: true }).problems.length === 1, auditObject3D(ownMat, { requireShared: true }).problems.join('; '));

check('beskrivningen är läsbar på svenska', /trasig/.test(describeModelProblems(['mesh trasig: NaN'], 3, 'sv')) || describeModelProblems(['mesh trasig: NaN'], 3, 'sv').includes('trasig'));
check('beskrivningen kapar långa listor', describeModelProblems(['a', 'b', 'c', 'd'], 2, 'en').includes('+2'));

/* ------------------------------------------------------------------ *
 * 8. Whole scene: budget and a clean build of the real world
 * ------------------------------------------------------------------ */
section('8. Hela scenen');

const bigScene = new THREE.Scene();
const nodes = new NodeView(bigScene);
const animals = new AnimalView(bigScene);
const buildings = new BuildingView(bigScene);
const players = new PlayerView(bigScene, 'self');
for (let i = 0; i < 120; i++) nodes.upsert({ id: `n${i}`, type: ['tree', 'rock', 'bush'][i % 3], x: i, y: 0, z: i % 7, rot: 0, scale: 1 });
for (let i = 0; i < 40; i++) animals.upsert({ id: `a${i}`, type: i % 2 ? 'deer' : 'boar', x: i, y: 0, z: 0, yaw: 0, hp: 10 });
for (let i = 0; i < 60; i++) buildings.upsert({ id: `b${i}`, piece: ['foundation', 'wall', 'door', 'campfire'][i % 4], cx: i % 10, cz: Math.floor(i / 10), rot: i % 4, y: 0, hp: 400, open: false, ownerName: 'x' });
for (let i = 0; i < 8; i++) players.upsert({ id: `p${i}`, name: `P${i}`, x: i, y: 0, z: 0, yaw: 0, crouch: false, health: 100, toolItem: null, color: `hsl(${i * 40}, 62%, 55%)` });

const sceneAudit = auditScene(bigScene);
check('scenen bygger utan fel', sceneAudit.problems.length === 0, sceneAudit.problems.slice(0, 3).join('; '));
check('scenen håller sig inom mesh-budgeten', sceneAudit.meshes <= BUDGET.sceneMeshes, `${sceneAudit.meshes} > ${BUDGET.sceneMeshes}`);
check('trianglarna är low-poly (< 40k för 228 objekt)', sceneAudit.triangles < 40000, `${sceneAudit.triangles}`);
check('materialantalet är litet (< 60)', sceneAudit.materials < 60, `${sceneAudit.materials}`);
check('fler objekt ger inte fler material', (() => {
  for (let i = 0; i < 60; i++) buildings.upsert({ id: `bb${i}`, piece: 'wall', cx: i % 10, cz: 20 + Math.floor(i / 10), rot: 0, y: 0, hp: 400, open: false, ownerName: 'x' });
  const after = auditScene(bigScene);
  return after.materials <= sceneAudit.materials + 1;
})(), 'material skapas per objekt igen');
const cache = buildingCacheStats();
check('byggcachen är liten och delad', cache.materials <= 16, JSON.stringify(cache));
check('scenrevisionen ger siffror till F3', Number.isFinite(sceneAudit.triangles) && sceneAudit.meshes > 0);

console.log(`\n\x1b[1mResultat:\x1b[0m ${passed} godkända, ${failed} misslyckade\n`);
if (failed) process.exit(1);
