/**
 * Spell - model catalog test (the 8 categories, one model at a time).
 *
 * The rule, in the order it was given:
 *   1. the catalog must have 8 categories and every model in exactly one
 *   2. build each model, one by one, and check it
 *   3. placement: check where the model ends up, per rule
 *   4. errors: a healthy model reports none, and the audit finds planted ones
 *
 * Usage:  npm run test:catalog
 */

import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDom } from './dom-env.js';
import { NODES, ANIMALS, PIECES, PHYS, WORLD, ITEMS } from '../shared/config.js';
import { BUDGET, SHARED_MATERIALS, auditObject3D, trianglesOf } from '../client/src/palette.js';

createDom(); // the name tag needs a canvas
const {
  MODEL_CATEGORIES, CATEGORY_IDS, MODELS, modelsInCategory, getModel,
  catalogSummary, auditCatalog, checkPlacement, placementText, trianglesOfModel,
} = await import('../client/src/modelCatalog.js');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};
const section = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const sizeOf = (root) => new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
/** Size of the solid parts only - sprites (name tags) hang above the model. */
const meshSizeOf = (root) => {
  const box = new THREE.Box3();
  let found = false;
  root.updateWorldMatrix(true, true); // parents' scales must be current
  root.traverse((o) => {
    if (o.isSprite || !o.isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.isEmpty()) return;
    found = true;
    box.union(b);
  });
  return found ? box.getSize(new THREE.Vector3()) : sizeOf(root);
};

console.log('\n\x1b[1mModellkatalog: 8 kategorier, en modell i taget\x1b[0m');

/* ------------------------------------------------------------------ *
 * 1. The catalog itself
 * ------------------------------------------------------------------ */
section('1. Katalogen (8 kategorier)');

check('exakt 8 kategorier', MODEL_CATEGORIES.length === 8, `${MODEL_CATEGORIES.length}`);
check('kategorierna är de efterfrågade', ['djur', 'mark', 'vapen', 'material', 'karaktar', 'bygge', 'utrustning', 'textur']
  .every((id) => CATEGORY_IDS.includes(id)), CATEGORY_IDS.join(','));
check('varje kategori har svenskt och engelskt namn', MODEL_CATEGORIES.every((c) => c.sv && c.en && c.description));
check('katalogen är felfri', auditCatalog().length === 0, auditCatalog().join('; '));
check('varje modell ligger i exakt en kategori', MODELS.every((m) => CATEGORY_IDS.filter((id) => modelsInCategory(id).some((x) => x.id === m.id)).length === 1));
check('modell-id:n är unika', new Set(MODELS.map((m) => m.id)).size === MODELS.length);
check('ingen kategori är tom', CATEGORY_IDS.every((id) => modelsInCategory(id).length > 0),
  CATEGORY_IDS.filter((id) => !modelsInCategory(id).length).join(','));
check('katalogen täcker alla djur', Object.keys(ANIMALS).every((t) => !!getModel(`animal_${t}`)));
check('katalogen täcker alla resursnoder', Object.keys(NODES).every((t) => !!getModel(`resource_${t}`)));
check('katalogen täcker alla byggdelar', Object.keys(PIECES).every((p) => !!getModel(`build_${p}`)));
check('katalogen täcker alla verktyg i ITEMS', Object.entries(ITEMS).filter(([, v]) => v.kind === 'tool')
  .every(([k]) => MODELS.some((m) => m.expect?.item === k || m.category === 'karaktar')), 'något verktyg saknar modell');

const summary = catalogSummary();
console.log(`   ${summary.total} modeller i ${summary.categories} kategorier:`);
for (const c of MODEL_CATEGORIES) {
  console.log(`     ${c.sv.padEnd(12)} ${String(summary.counts[c.id]).padStart(2)}  ${modelsInCategory(c.id).map((m) => m.sv).join(', ')}`);
}
check('sammanfattningen stämmer med katalogen', summary.total === MODELS.length
  && CATEGORY_IDS.every((id) => summary.counts[id] === modelsInCategory(id).length));
const mainSource = fs.readFileSync(path.join(ROOT, 'client/src/main.js'), 'utf8');
check('F3 visar 8 kategorier och modellantal', mainSource.includes('catalogSummary()')
  && CATEGORY_IDS.every((id) => mainSource.includes(`modelCatalog.counts.${id}`)));

/* ------------------------------------------------------------------ *
 * 2 + 3. Build and check every model, one by one
 * ------------------------------------------------------------------ */
section('2. Varje modell byggd och kontrollerad en för en');

const built = new Map();

for (const category of MODEL_CATEGORIES) {
  console.log(`  \x1b[1m${category.sv}\x1b[0m — ${category.description}`);
  for (const spec of modelsInCategory(category.id)) {
    let result = null;
    let error = null;
    try {
      result = await spec.build();
      built.set(spec.id, result);
    } catch (err) {
      error = err;
    }

    check(`${spec.id}: byggs utan fel`, !error, error?.message);
    if (error) continue;

    const { object, scene } = result;
    check(`${spec.id}: har en modell`, !!object, 'byggaren returnerade inget');

    // --- how good it is (budget) + errors in it
    const audit = auditObject3D(object, { budget: { mesh: Math.max(BUDGET.mesh, spec.budget) } });
    check(`${spec.id}: inga modellfel (${audit.meshes} meshes, ${audit.triangles} trianglar)`,
      audit.problems.length === 0, audit.problems.join('; '));
    const tris = trianglesOfModel(object);
    check(`${spec.id}: ryms i sin budget (${tris} ≤ ${spec.budget})`, tris <= spec.budget, `${tris} trianglar`);

    // --- materials come from the palette (per-player colours are the exception)
    const mats = new Set();
    let ownMaterial = 0;
    object.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        mats.add(m.uuid);
        const excused = m.isSpriteMaterial || m.vertexColors || m.userData.ownColor || m.userData.perPlayerColor;
        if (!SHARED_MATERIALS.has(m) && !excused) ownMaterial++;
      }
    });
    check(`${spec.id}: använder delade palettmaterial (${mats.size} material)`, ownMaterial === 0, `${ownMaterial} egna material`);

    // --- size against the gameplay data, where the data says something
    if (spec.expect?.height !== undefined) {
      const size = meshSizeOf(object);
      check(`${spec.id}: höjden stämmer med speldatan (${spec.expect.height} m)`,
        Math.abs(size.y - spec.expect.height) < 0.05, `modell ${size.y.toFixed(3)}`);
    }
    if (spec.expect?.size) {
      const size = sizeOf(object);
      const [ex, ey, ez] = spec.expect.size;
      const rotated = (spec.expect.rot ?? 0) % 2 === 1; // the model is rotated on the edge
      const wantX = rotated ? ez : ex;
      const wantZ = rotated ? ex : ez;
      check(`${spec.id}: ryms inom speldatans box (rot ${spec.expect.rot ?? 0}: ${wantX}×${wantZ})`,
        size.x <= wantX + 0.2 && size.z <= wantZ + 0.2, `modell ${size.x.toFixed(2)}×${size.z.toFixed(2)}`);
    }

    // --- textures: the name tag is a real, deterministic canvas texture.
    if (spec.id === 'name_tag') {
      const texture = object.material?.map;
      check('name_tag: riktig CanvasTexture', !!texture?.isCanvasTexture);
      check('name_tag: texturatlas har användbar storlek', (texture?.image?.width ?? 0) >= 128
        && (texture?.image?.height ?? 0) >= 32, `${texture?.image?.width ?? 0}×${texture?.image?.height ?? 0}`);
    }

    // --- placement (rule 8 + the placement request)
    const placement = checkPlacement(spec, result);
    check(`${spec.id}: placerad rätt (${placementText(spec)})`, placement.length === 0, placement.join('; '));

    if (scene?.parent === null && scene) scene.clear?.();
    console.log(`     ✓ ${spec.sv.padEnd(18)} ${String(tris).padStart(5)} tri  ${placementText(spec)}`);
  }
}

/* ------------------------------------------------------------------ *
 * 4. Placement rules must actually fail when the placement is wrong
 * ------------------------------------------------------------------ */
section('3. Placeringsreglerna fångar fel placering');

// ground: a model sunk into the terrain
{
  const spec = getModel('animal_deer');
  const result = await spec.build();
  result.object.position.y -= 0.5;
  check('nedsänkt djur rapporteras', checkPlacement(spec, result).length === 1, 'placeringen godkändes felaktigt');
  result.object.position.y += 0.5;
  check('samma djur på marken är okej', checkPlacement(spec, result).length === 0);
}
// ground: a floating model
{
  const spec = getModel('resource_tree');
  const result = await spec.build();
  result.object.position.y += 2;
  check('svävande träd rapporteras', checkPlacement(spec, result).length === 1, 'svävande modell godkändes');
}
// grid: a wall moved off the grid
{
  const spec = getModel('build_wall');
  const result = await spec.build();
  result.object.position.x += 1.5;
  check('vägg utanför rutnätet rapporteras', checkPlacement(spec, result).length === 1, 'felplacerad vägg godkändes');
}
// grid: a wall rotated wrongly
{
  const spec = getModel('build_wall');
  const result = await spec.build();
  result.object.rotation.y = 0.3;
  check('vägg med fel rotation rapporteras', checkPlacement(spec, result).length === 1);
}
// held: a weapon left behind the camera
{
  const spec = getModel('weapon_axe');
  const result = await spec.build();
  result.object.position.set(0, 0, 2);
  check('vapen bakom kameran rapporteras', checkPlacement(spec, result).length === 1, 'vapnet godkändes bakom kameran');
}
// held: a weapon that is not in a hand at all
{
  const spec = getModel('equipment_torch');
  const result = await spec.build();
  result.object.parent?.remove(result.object);
  check('vapen utan hand rapporteras', checkPlacement(spec, result).length === 1);
}
// attached: a name tag at head height instead of above
{
  const spec = getModel('name_tag');
  const result = await spec.build();
  result.object.position.y = 1.2;
  check('namnskylt för lågt rapporteras', checkPlacement(spec, result).length === 1);
}
// marker: a ghost that casts a shadow
{
  const spec = getModel('build_ghost');
  const result = await spec.build();
  result.object.castShadow = true;
  check('markör med skugga rapporteras', checkPlacement(spec, result).length === 1);
}
// layer: water below sea level
{
  const spec = getModel('water');
  const result = await spec.build();
  const before = result.object.position.y;
  result.object.position.y = before - 5;
  check('vatten under havsnivån rapporteras', checkPlacement(spec, result).length === 1, 'vattnet godkändes på fel höjd');
  result.object.position.y = before;
}
// layer: sky drawn from the outside
{
  const spec = getModel('sky');
  const result = await spec.build();
  const before = result.object.material.side;
  result.object.material.side = THREE.FrontSide;
  check('himmel ritad utifrån rapporteras', checkPlacement(spec, result).length === 1);
  result.object.material.side = before;
}
// layer: the sun/moon left at the world origin instead of in the sky around the player
{
  const spec = getModel('celestial');
  const result = await spec.build();
  const before = result.object.position.clone();
  result.object.position.set(0, 0, 0);
  check('sol/måne vid världsorigo (fel placering) rapporteras', checkPlacement(spec, result).length === 1);
  result.object.position.copy(before);
}

/* ------------------------------------------------------------------ *
 * 5. Placement of everything at once - the picture the player sees
 * ------------------------------------------------------------------ */
section('4. Alla modeller samtidigt: ingen hamnar fel');

const placed = [];
for (const spec of MODELS) {
  const result = built.get(spec.id) ?? await spec.build();
  const problems = checkPlacement(spec, result);
  placed.push({ spec, problems });
}
const misplaced = placed.filter((p) => p.problems.length);
check('alla modeller på sina platser', misplaced.length === 0, misplaced.map((p) => p.problems.join('; ')).join(' | '));
check('varje modell har en placeringsregel', MODELS.every((m) => !!placementText(m) && placementText(m) !== 'okänd'));

const totalTris = MODELS.reduce((n, spec) => n + trianglesOfModel(built.get(spec.id)?.object ?? new THREE.Group()), 0);
console.log(`   ${MODELS.length} modeller, ${totalTris} trianglar tillsammans`);
check('hela katalogen är low-poly (< 120k trianglar)', totalTris < 120000, `${totalTris}`);

console.log(`\n\x1b[1mResultat:\x1b[0m ${passed} godkända, ${failed} misslyckade\n`);
if (failed) process.exit(1);
