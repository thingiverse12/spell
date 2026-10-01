/**
 * Spell - deterministic world generation.
 *
 * Same code, same seed => bit-identical terrain on client and server. That is a
 * hard requirement: the client predicts movement against its locally generated
 * heightfield and the server validates against its own. Any divergence shows up
 * as rubber-banding, so keep this module pure (no Math.random, no Date).
 */

import { WORLD, clamp, smoothstep } from './config.js';

/* ---------------- hashing / value noise ---------------- */

/** 32-bit integer hash (x, y, seed) -> [0, 1). */
export function hash2(x, y, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 1442695040888963407) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** Smoothed 2D value noise in [-1, 1]. */
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const top = a + (b - a) * u;
  const bot = c + (d - c) * u;
  return (top + (bot - top) * v) * 2 - 1;
}

/** Fractal brownian motion on top of valueNoise. */
export function fbm(x, y, seed = 0, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 1013) * amp;
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/* ---------------- terrain heightfield ---------------- */

/**
 * Island height at world (x, z). Signed: negative = below sea level.
 * Deterministic & pure - called by physics on every step, so keep it cheap.
 */
export function terrainHeight(x, z, seed = WORLD.seed) {
  const base = fbm(x * 0.0052, z * 0.0052, seed, 5, 2.0, 0.5);
  const hills = fbm(x * 0.014, z * 0.014, seed + 5171, 3, 2.0, 0.45);
  const micro = valueNoise(x * 0.12, z * 0.12, seed + 991) * 0.35;

  // Radial island falloff: flat-ish plateau in the middle, ocean at the rim.
  const r = Math.sqrt(x * x + z * z) / WORLD.half;
  const falloff = 1 - smoothstep(0.42, 1.02, r);

  let h = (base * 0.85 + hills * 0.35 + micro * 0.06) * WORLD.maxHeight * falloff;
  // Push the shoreline below the water line so the rim becomes ocean.
  h += (falloff - 1) * 9;
  // A little coastal shelf so beaches exist.
  h = h < 0 ? h * 0.55 : h;
  return h;
}

/**
 * Height of the terrain surface at (x, z) - *exactly* the surface the renderer
 * draws. The mesh is two triangles per grid cell split along the (0,0)-(1,1)
 * diagonal (see client/src/terrain.js), so sampling must use the same split;
 * bilinear interpolation would disagree with the visible ground by up to ~0.25 m
 * and make players, props and collisions sink slightly into it.
 */
export function sampleHeight(x, z, seed = WORLD.seed) {
  const g = WORLD.grid;
  const x0 = Math.floor(x / g) * g;
  const z0 = Math.floor(z / g) * g;
  const tx = (x - x0) / g;
  const tz = (z - z0) / g;
  const h00 = terrainHeight(x0, z0, seed);
  const h10 = terrainHeight(x0 + g, z0, seed);
  const h01 = terrainHeight(x0, z0 + g, seed);
  const h11 = terrainHeight(x0 + g, z0 + g, seed);
  return (tx + tz <= 1)
    ? h00 + (h10 - h00) * tx + (h01 - h00) * tz
    : h11 + (h10 - h11) * (1 - tz) + (h01 - h11) * (1 - tx);
}

/** Surface normal, for slope checks and prop placement. */
export function sampleNormal(x, z, seed = WORLD.seed) {
  const d = WORLD.grid;
  const hL = sampleHeight(x - d, z, seed);
  const hR = sampleHeight(x + d, z, seed);
  const hD = sampleHeight(x, z - d, seed);
  const hU = sampleHeight(x, z + d, seed);
  const nx = hL - hR;
  const nz = hD - hU;
  const ny = 2 * d;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

/** rise/run slope magnitude at a point (0 = flat). */
export function slopeAt(x, z, seed = WORLD.seed) {
  const n = sampleNormal(x, z, seed);
  return Math.sqrt(n.x * n.x + n.z * n.z) / Math.max(0.0001, n.y);
}

/**
 * Biome / surface classification, used for vertex colours and prop placement.
 * Returns one of: 'water' | 'sand' | 'grass' | 'forest' | 'rock' | 'snow'
 */
export function biomeAt(x, z, h, slope, seed = WORLD.seed) {
  if (h < WORLD.seaLevel - 0.4) return 'water';
  if (h < WORLD.seaLevel + 1.5 && slope < 0.5) return 'sand';
  if (h > WORLD.maxHeight * 0.72) return 'snow';
  if (slope > 1.15 || h > WORLD.maxHeight * 0.58) return 'rock';
  const moisture = fbm(x * 0.0075, z * 0.0075, seed + 3313, 3, 2, 0.5);
  if (moisture > 0.05 && h > 2 && h < WORLD.maxHeight * 0.6) return 'forest';
  return 'grass';
}

/** Sun elevation/azimuth for the day/night cycle (t in [0, 1)). */
export function sunDirection(t) {
  const ang = (t - 0.25) * Math.PI * 2;
  return {
    x: Math.cos(ang) * 0.6,
    y: Math.sin(ang),
    z: Math.sin(ang * 0.5) * 0.35 + 0.15,
  };
}

/** 0 = pitch black night, 1 = full daylight. */
export function dayLight(t, nightFraction = 0.38) {
  const s = Math.sin((t - 0.25) * Math.PI * 2);
  return clamp(0.5 + s * 0.75, 0, 1) * (1 - nightFraction * 0.35) + 0.04;
}

export function isNight(t) {
  const s = Math.sin((t - 0.25) * Math.PI * 2);
  return s < -0.05;
}
