/**
 * Spell - one home for every colour and material in the game.
 *
 * Rule: check the models - the design, then the colours, then the materials,
 * then how good they are, then the errors in them.
 *
 * Colours used to be hex literals scattered through entities.js and terrain.js,
 * which made it impossible to answer simple questions ("is the deer the same
 * brown as the boar?", "is every material flat shaded?", "how many materials do
 * 200 trees create?"). Now:
 *
 *   PALETTE   - named colours for anything the player can see and touch
 *   SKY       - named colours for light, sky and water
 *   MATERIALS - shared, immutable-ish materials built from PALETTE
 *   BUDGET    - triangle budgets per model kind (low-poly is a requirement)
 *   trianglesOf / auditObject3D / auditScene / describeModelProblems
 *
 * The audit functions are used by test/models.js and, at runtime, by the F3
 * overlay - so "the models look wrong" becomes a number instead of a feeling.
 */

import * as THREE from 'three';

/** Colours of things in the world (hex strings so they can be compared). */
export const PALETTE = {
  // nature
  trunk: '#6b4a2a',
  foliage: '#2f6b33',
  bush: '#3d7a34',
  rock: '#8d9099',
  // built
  wood: '#9a6b3c',
  woodDark: '#7a5230',
  stone: '#9aa0a6',
  foundation: '#8d8577',
  metal: '#b9c2c9',
  // creatures
  animal: '#a9793f',
  animalDark: '#5d4a3a',
  skin: '#e8b48a',
  // effects
  flame: '#ffa23c',
  ember: '#ff9a3c',
  ghostOk: '#7ac74f',
  ghostBad: '#e2574c',
  wire: '#ffffff',
};

/** Light, sky and water. */
export const SKY = {
  sun: '#fff2dc',
  hemiSky: '#bfd8ff',
  hemiGround: '#4a4433',
  ambient: '#ffffff',
  dayTop: '#5aa9e6',
  nightTop: '#0a1226',
  dayBottom: '#cfe6f2',
  duskBottom: '#e08a4a',
  nightBottom: '#131c2e',
  water: '#2f6f8f',
  star: '#ffffff',
  celestial: '#ffe9b0',
  celestialNight: '#dfe8ff',
  fogNight: '#1d4258',
};

/** Hex string -> number, three.js style. Throws on anything that is not a colour. */
export function colorNumber(value) {
  const hex = normalizeColor(value);
  return Number.parseInt(hex.slice(1), 16);
}

/** Accepts '#abc', '#aabbcc', 'aabbcc' or a number; returns '#aabbcc' or null. */
export function normalizeColor(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `#${(value >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
  }
  if (typeof value !== 'string') return null;
  let s = value.trim().toLowerCase();
  if (s.startsWith('#')) s = s.slice(1);
  if (/^[0-9a-f]{3}$/.test(s)) return `#${s[0]}${s[0]}${s[1]}${s[1]}${s[2]}${s[2]}`;
  if (/^[0-9a-f]{6}$/.test(s)) return `#${s}`;
  return null;
}

/** Is this a colour at all (hex, or an hsl()/rgb() string from the server)? */
export function isColor(value) {
  if (normalizeColor(value)) return true;
  return typeof value === 'string' && /^(hsl|rgb)a?\(/.test(value.trim());
}

/** All named colours of one group, as hex strings. */
export function paletteColors(group = null) {
  const source = group === 'sky' ? SKY : PALETTE;
  return Object.values(source);
}

/**
 * Triangle budgets. Low-poly is a design decision, not an accident: exceeding a
 * budget is a bug that shows up in test/models.js and in the F3 overlay.
 */
export const BUDGET = {
  mesh: 5000,       // a single mesh must never be this heavy
  node: 400,        // one resource node (trunk + foliage)
  animal: 300,
  piece: 200,       // a building piece
  player: 400,      // capsule + head + held item (name tag excluded)
  viewModel: 400,   // what the player holds in first person
  sceneMeshes: 400, // instanced pools count as one
};

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({
  color: colorNumber(color), flatShading: true, ...extra,
});
const basic = (color, extra = {}) => new THREE.MeshBasicMaterial({ color: colorNumber(color), ...extra });

/** Shared materials. Building one per instance is what the audit looks for. */
export const MATERIALS = {
  trunk: lambert(PALETTE.trunk),
  foliage: lambert(PALETTE.foliage),
  bush: lambert(PALETTE.bush),
  rock: lambert(PALETTE.rock),
  wood: lambert(PALETTE.wood),
  woodDark: lambert(PALETTE.woodDark),
  stone: lambert(PALETTE.stone),
  foundation: lambert(PALETTE.foundation),
  metal: lambert(PALETTE.metal),
  animal: lambert(PALETTE.animal),
  animalDark: lambert(PALETTE.animalDark),
  skin: lambert(PALETTE.skin),
  flame: basic(PALETTE.flame, { transparent: true, opacity: 0.92 }),
  ghostOk: basic(PALETTE.ghostOk, { transparent: true, opacity: 0.35, depthWrite: false }),
  ghostBad: basic(PALETTE.ghostBad, { transparent: true, opacity: 0.35, depthWrite: false }),
  wire: new THREE.LineBasicMaterial({ color: colorNumber(PALETTE.wire), transparent: true, opacity: 0.6 }),
};

/** The set of materials that are shared by design (identity comparison in tests). */
export const SHARED_MATERIALS = new Set(Object.values(MATERIALS));

/** Triangles in a geometry, index-aware (hand-built terrain has no index). */
export function trianglesOf(geometry) {
  if (!geometry) return 0;
  const count = geometry.index ? geometry.index.count : (geometry.attributes?.position?.count ?? 0);
  return Math.floor(count / 3);
}

/**
 * Problems worth reporting about one object tree (meshes + sprites).
 * Returns an array of strings; empty means "the model is fine".
 */
export function auditObject3D(root, opts = {}) {
  const budget = { ...BUDGET, ...(opts.budget ?? {}) };
  const problems = [];
  const seen = new Set();
  let meshes = 0;
  let triangles = 0;

  root?.traverse?.((o) => {
    if (o.isSprite) return;
    if (!o.isMesh) return;
    meshes++;
    const geo = o.geometry;
    const tris = trianglesOf(geo);
    triangles += tris;

    if (!geo) { problems.push(`${label(o)}: ingen geometri`); return; }
    if (tris <= 0) problems.push(`${label(o)}: geometri utan trianglar`);
    if (tris > budget.mesh) problems.push(`${label(o)}: ${tris} trianglar (över taket ${budget.mesh})`);
    if (!geo.boundingBox) geo.computeBoundingBox?.();
    const bb = geo.boundingBox;
    if (bb && ![bb.min.x, bb.min.y, bb.min.z, bb.max.x, bb.max.y, bb.max.z].every(Number.isFinite)) {
      problems.push(`${label(o)}: geometrins gränser är inte ändliga (NaN)`);
    }
    const pos = geo.attributes?.position;
    if (pos?.array && !pos.array.every?.(Number.isFinite)) {
      // typed arrays have no every() guaranteed on older runtimes; check by index
      let bad = false;
      for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) { bad = true; break; }
      if (bad) problems.push(`${label(o)}: vertex-data innehåller NaN`);
    }

    const mat = o.material;
    const mats = Array.isArray(mat) ? mat : [mat];
    if (!mat) problems.push(`${label(o)}: saknar material`);
    for (const m of mats) {
      if (!m) { problems.push(`${label(o)}: material saknas i listan`); continue; }
      if (!m.color) { problems.push(`${label(o)}: materialet har ingen färg (${m.type})`); continue; }
      const col = normalizeColor(m.color.getHex());
      if (!col) problems.push(`${label(o)}: ogiltig färg`);
      if (seen.has(m.uuid)) continue;
      seen.add(m.uuid);
      if (opts.requireShared && !SHARED_MATERIALS.has(m)) {
        problems.push(`${label(o)}: eget material (${col}) - borde delas`);
      }
      if (opts.palette && !allColors().includes(col) && !opts.allowColors?.includes(col)) {
        problems.push(`${label(o)}: färgen ${col} finns inte i paletten`);
      }
    }
  });

  return { problems, meshes, triangles, materials: seen.size };
}

function label(o) {
  return o.name || o.userData?.model || o.type || 'mesh';
}

/** Every colour the palette knows about (hex strings). */
export function allColors() {
  return [...new Set([...paletteColors(), ...paletteColors('sky')])];
}

/** Scene-wide counts, used by the F3 overlay. */
export function auditScene(scene, opts = {}) {
  return auditObject3D(scene, { requireShared: false, ...opts });
}

/** Bilingual problem list for logs, toasts and the debug overlay. */
export function describeModelProblems(list, limit = 3, lang = 'sv') {
  if (!list?.length) return '';
  const more = lang === 'sv' ? 'till' : 'more';
  return list.slice(0, limit).join(', ') + (list.length > limit ? ` +${list.length - limit} ${more}` : '');
}
