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

console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
