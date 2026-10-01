/**
 * Spell - static UI/DOM consistency check.
 *
 * The browser client is DOM-heavy; a single typo in an element id or in an
 * i18n key breaks the UI at runtime. This test cross-checks the client sources
 * against client/index.html, which is exactly the class of bug a headless
 * sandbox (no Chromium) cannot otherwise catch.
 *
 * Usage:  npm run test:ui
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CLIENT = path.join(ROOT, 'client');

let passed = 0;
let failed = 0;
const check = (name, cond, detail = '') => {
  if (cond) { passed++; } else { failed++; console.log(`  \x1b[31m✗ ${name}\x1b[0m ${detail}`); }
};

const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

const sources = fs.readdirSync(path.join(CLIENT, 'src'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => ({ name: f, code: fs.readFileSync(path.join(CLIENT, 'src', f), 'utf8') }));

console.log('\n\x1b[1mStatic UI check\x1b[0m');

/* 1. every element id the code looks up must exist in index.html */
for (const { name, code } of sources) {
  const lookups = [
    ...code.matchAll(/\$\('([^']+)'\)/g),
    ...code.matchAll(/getElementById\('([^']+)'\)/g),
    ...code.matchAll(/querySelector\('#([^']+)'\)/g),
  ].map((m) => m[1]);
  for (const id of new Set(lookups)) {
    check(`${name}: #${id} exists`, htmlIds.has(id), 'not found in index.html');
  }
}

/* 2. every data-i18n key exists in both language tables */
const i18n = fs.readFileSync(path.join(CLIENT, 'src', 'i18n.js'), 'utf8');
const keysUsed = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
const svBlock = i18n.slice(i18n.indexOf('sv: {'), i18n.indexOf('en: {'));
const enBlock = i18n.slice(i18n.indexOf('en: {'));
for (const key of new Set(keysUsed)) {
  check(`i18n sv: ${key}`, new RegExp(`\\b${key}:`).test(svBlock));
  check(`i18n en: ${key}`, new RegExp(`\\b${key}:`).test(enBlock));
}

/* 3. the client must never import something the server does not serve */
const serverSrc = fs.readFileSync(path.join(ROOT, 'server', 'index.js'), 'utf8');
check('server serves /shared/* to the browser', /pathname\.startsWith\('\/shared\/'\)/.test(serverSrc));
check('server serves the vendored engine', fs.existsSync(path.join(CLIENT, 'vendor', 'three.module.js')));

/* 4. import map must map the bare "three" specifier used by the client */
check('importmap maps "three"', /"three"\s*:\s*"\/vendor\/three\.module\.js"/.test(html));

/* 5. stylesheet id selectors must exist in the markup (ignoring hex colours) */
const css = fs.readFileSync(path.join(CLIENT, 'css', 'style.css'), 'utf8');
const cssIds = [...new Set([...css.matchAll(/#([a-zA-Z][\w-]*)/g)].map((m) => m[1]))]
  .filter((token) => !/^[0-9a-f]{3,8}$/i.test(token));
const missing = cssIds.filter((id) => !htmlIds.has(id));
check('every CSS id selector exists in index.html', missing.length === 0, missing.join(', '));

/* 6. every named import must actually be exported by its target module
   (a typo here is an instant "module does not provide an export" error in the
   browser, so it is worth checking statically) */
const MODULES = [
  ...fs.readdirSync(path.join(CLIENT, 'src')).filter((f) => f.endsWith('.js'))
    .map((f) => path.join(CLIENT, 'src', f)),
  ...fs.readdirSync(path.join(ROOT, 'shared')).filter((f) => f.endsWith('.js'))
    .map((f) => path.join(ROOT, 'shared', f)),
];

function exportsOf(file) {
  const code = fs.readFileSync(file, 'utf8');
  const names = new Set();
  let permissive = false;
  for (const m of code.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const alias = piece.split(/\s+as\s+/);
      names.add((alias[1] || alias[0]).trim());
    }
  }
  if (/export\s+\*/.test(code) || /export\s+default/.test(code)) permissive = true;
  return { names, permissive };
}

for (const file of MODULES) {
  const code = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
    const spec = m[2];
    let target = null;
    if (spec === 'three') target = path.join(ROOT, 'node_modules', 'three', 'build', 'three.module.js');
    else if (spec.startsWith('.')) target = path.resolve(path.dirname(file), spec);
    if (!target || !fs.existsSync(target)) continue;
    const { names, permissive } = exportsOf(target);
    if (permissive) continue;
    for (const raw of m[1].split(',')) {
      const name = raw.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      check(`${rel} imports ${name} from ${spec}`, names.has(name), 'not exported by the target module');
    }
  }
}

const hudSource = sources.find((s) => s.name === 'hud.js')?.code ?? '';
const mainSource = sources.find((s) => s.name === 'main.js')?.code ?? '';

/* 7. member-access check: reading a property that is never declared is the
   classic "undefined is not a function" bug. Covers hud.el.* and state.*, which
   is where the client keeps all of its wired-up UI and per-session data.

   A property counts as known when it is declared in the literal OR assigned
   somewhere in the file (some fields are only created at runtime). A typo that
   only ever appears on the reading side is therefore caught. */
function declaredKeys(source, marker) {
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const body = source.slice(open, end);
  return new Set([...body.matchAll(/(?:^|[{,\s])([A-Za-z_$][\w$]*)\s*:/g)].map((m) => m[1]));
}

// hud.js uses `this.el.X` for its own lookups; a local variable called `el`
// (the hotbar slots) must not be mistaken for it, hence the this-qualified form.
{
  const declared = declaredKeys(hudSource, 'this.el = {');
  const writes = new Set([...hudSource.matchAll(/this\.el\.([A-Za-z_$][\w$]*)\s*=/g)].map((m) => m[1]));
  const reads = new Set([...hudSource.matchAll(/this\.el\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const unknown = [...reads].filter((k) => !declared?.has(k) && !writes.has(k));
  check('hud.el: alla fält som hud.js läser finns', unknown.length === 0, unknown.join(', '));
}

{
  const declared = declaredKeys(mainSource, 'const state = {');
  const writes = new Set([...mainSource.matchAll(/state\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map((m) => m[1]));
  const reads = new Set([...mainSource.matchAll(/state\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  const unknown = [...reads].filter((k) => !declared?.has(k) && !writes.has(k));
  check('state: alla fält som main.js läser finns', unknown.length === 0, unknown.join(', '));
}

/* cross-file: other modules read hud.el.X, so those must exist in hud.js */
{
  const declared = declaredKeys(hudSource, 'this.el = {');
  const unknown = new Set();
  for (const { name, code } of sources) {
    if (name === 'hud.js') continue;
    for (const m of code.matchAll(/\bhud\.el\.([A-Za-z_$][\w$]*)/g)) {
      if (declared && !declared.has(m[1])) unknown.add(`${name}: hud.el.${m[1]}`);
    }
  }
  check('hud.el: alla fält som andra moduler läser finns', unknown.size === 0, [...unknown].join(', '));
}

console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
