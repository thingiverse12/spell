/**
 * Spell - the ground invariant (rule: nothing may end up below the surface).
 *
 * One shared module, used by the server (authoritative simulation) and the
 * client (rendering), so both agree on where "the ground" is:
 *
 *   - `surfaceUnder(sample, x, z)`          - the surface at a point
 *   - `footprintSurface(sample, ...)`       - the *highest* surface under a box
 *   - `liftToSurface(y, surface, eps)`      - raise a value that is buried
 *   - `auditGround(sample, collections)`    - list every buried entity
 *
 * The client also uses `liftToSurface` while interpolating: between two server
 * ticks a straight line between two points on a slope passes *below* the
 * terrain, which is what makes an animal or another player sink into a hill for
 * a frame.
 */

/** How far below the surface an entity may sit before it counts as buried. */
export const GROUND_EPS = 0.05;

/** Surface height at a point, with NaN protection. */
export function surfaceUnder(sample, x, z, fallback = 0) {
  const h = sample(x, z);
  return Number.isFinite(h) ? h : fallback;
}

/**
 * Highest surface under a footprint. Buildings are 4 m wide, so a wall placed on
 * the terrain height of its *centre* can be buried up to ~1 m on the uphill
 * side; the footprint is what matters.
 */
export function footprintSurface(sample, x, z, halfX = 0, halfZ = 0, steps = 2) {
  let top = -Infinity;
  for (let ix = 0; ix <= steps; ix++) {
    for (let iz = 0; iz <= steps; iz++) {
      const px = x + (ix / steps) * 2 * halfX - halfX;
      const pz = z + (iz / steps) * 2 * halfZ - halfZ;
      const h = sample(px, pz);
      if (Number.isFinite(h)) top = Math.max(top, h);
    }
  }
  return Number.isFinite(top) ? top : surfaceUnder(sample, x, z);
}

/** Raise `y` to `surface` when it is buried; returns the new value. */
export function liftToSurface(y, surface, eps = GROUND_EPS) {
  const safe = Number.isFinite(y) ? y : surface;
  return safe < surface - eps ? surface : safe;
}

/** How far below the surface a value sits (>= 0 means buried). */
export function buryDepth(y, surface, eps = GROUND_EPS) {
  if (!Number.isFinite(y) || !Number.isFinite(surface)) return Infinity;
  return surface - y - eps;
}

/**
 * Every buried thing in a world snapshot.
 *
 * `collections` is { players, animals, nodes, buildings } where each entry is an
 * iterable of objects with { id, x, y, z }. Buildings are checked against their
 * footprint (a wall must not be swallowed by a slope); flattenable pieces
 * (foundations, campfires) are checked against their centre only, because a
 * platform is *meant* to cut into a hillside.
 *
 * @returns {Array<{kind:string,id:string,x:number,y:number,z:number,surface:number,depth:number}>}
 */
export function auditGround(sample, collections = {}, opts = {}) {
  const eps = opts.eps ?? GROUND_EPS;
  const out = [];
  const push = (kind, id, x, y, z, surface) => {
    const depth = buryDepth(y, surface, eps);
    if (depth > 0) out.push({ kind, id, x, y, z, surface, depth });
  };

  for (const p of collections.players ?? []) push('player', p.id, p.x, p.y, p.z, surfaceUnder(sample, p.x, p.z));
  for (const a of collections.animals ?? []) push('animal', a.id, a.x, a.y, a.z, surfaceUnder(sample, a.x, a.z));
  for (const n of collections.nodes ?? []) push('node', n.id, n.x, n.y, n.z, surfaceUnder(sample, n.x, n.z));
  for (const b of collections.buildings ?? []) {
    const piece = b.piece ? opts.pieces?.[b.piece] : null;
    const flat = piece ? !!piece.flat : true;
    const halfX = b.footprint?.halfX ?? 0;
    const halfZ = b.footprint?.halfZ ?? 0;
    const surface = flat
      ? surfaceUnder(sample, b.x, b.z)
      : footprintSurface(sample, b.x, b.z, halfX, halfZ, opts.steps ?? 2);
    push('building', b.id, b.x, b.y, b.z, surface);
  }
  return out.sort((a, b) => b.depth - a.depth);
}

/** Short human-readable summary used by logs and the debug overlay (sv + en). */
export function describeViolations(list, limit = 3, lang = 'en') {
  if (!list.length) return '';
  const phrase = lang === 'sv' ? 'm under ytan' : 'm below the surface';
  const more = lang === 'sv' ? 'till' : 'more';
  return list.slice(0, limit)
    .map((v) => `${v.kind} ${v.id} ${v.depth.toFixed(2)} ${phrase}`)
    .join(', ') + (list.length > limit ? ` +${list.length - limit} ${more}` : '');
}
