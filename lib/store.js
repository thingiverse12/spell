'use strict';

/**
 * Lagring i Supabase (PostgREST) för Vercel-miljön.
 * Hela spelardatabasen ligger som en JSON-rad i public.casino_state.
 * Optimistisk låsning via kolumnen "version" för att undvika tappade skrivningar.
 */

const BASE = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  '';

let loadedVersion = 0;

/* Varje anrop läste tidigare hela databasklumpen från Supabase – och appen
   frågar efter inställningarna var femte sekund. Nu hålls svaret kvar i
   minnet i drygt en sekund, så en sida som gör flera anrop bara hämtar
   databasen en gång. En lyckad skrivning uppdaterar cachen direkt och en
   versionskrock tömmer den, så vi kan aldrig svara med något som är äldre
   än så. */
const CACHE_MS = Number(process.env.DB_CACHE_MS || 1500);
let cache = null; // { text, version, at }

/* Versionen följer med databasen som en osynlig egenskap. Två förfrågningar
   som körs samtidigt i samma serverprocess kan då inte råka skriva över
   varandras ändringar – varje skrivning kontrolleras mot den version just
   den förfrågan läste in. */
function withVersion(db, version) {
  try {
    Object.defineProperty(db, '__version', { value: version, enumerable: false });
  } catch (e) {
    /* redan satt – inget att göra */
  }
  return db;
}

function headers(extra = {}) {
  return {
    apikey: KEY,
    authorization: 'Bearer ' + KEY,
    'content-type': 'application/json',
    accept: 'application/json',
    ...extra
  };
}

function assertConfigured() {
  if (!BASE || !KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY saknas');
  }
}

async function loadDb() {
  assertConfigured();

  if (cache && Date.now() - cache.at < CACHE_MS) {
    const rows = JSON.parse(cache.text);
    loadedVersion = cache.version;
    return withVersion(rows[0].data || {}, cache.version);
  }

  const res = await fetch(`${BASE}/rest/v1/casino_state?id=eq.1&select=data,version`, {
    headers: headers(),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${(await res.text()).slice(0, 200)}`);

  // Texten sparas rå i cachen – då behöver den bara tolkas om, inte hämtas om.
  const text = await res.text();
  let rows;
  try {
    rows = JSON.parse(text);
  } catch (err) {
    throw new Error('Supabase svarade inte med JSON: ' + text.slice(0, 200));
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    loadedVersion = 0;
    const insert = await fetch(`${BASE}/rest/v1/casino_state`, {
      method: 'POST',
      headers: headers({ Prefer: 'return=representation' }),
      body: JSON.stringify([{ id: 1, data: {}, version: 0 }])
    });
    if (!insert.ok && insert.status !== 409) {
      throw new Error(`Supabase INSERT ${insert.status}: ${(await insert.text()).slice(0, 200)}`);
    }
    cache = null;
    return withVersion({}, 0);
  }

  loadedVersion = Number(rows[0].version) || 0;
  cache = { text, version: loadedVersion, at: Date.now() };
  return withVersion(rows[0].data || {}, loadedVersion);
}

/**
 * Sparar hela databasen. Skrivningen är villkorad av den version vi läste in:
 * har någon annan hunnit spara emellanåt får vi inga rader tillbaka och
 * kastar en konflikt. API:t läser då om databasen och kör om förfrågan med
 * färska siffror – vi skriver aldrig tillbaka en gammal kopia, för då skulle
 * t.ex. en adminändring kunna suddas av en spelares snurr.
 */
async function saveDb(db) {
  assertConfigured();

  const expected = db && db.__version != null ? Number(db.__version) : loadedVersion;
  const payload = JSON.stringify({ data: db, version: expected + 1 });

  /* select=version: vi vill bara veta om raden uppdaterades, inte få tillbaka
     hela databasen (som tidigare laddades ner igen vid varje skrivning). */
  const res = await fetch(`${BASE}/rest/v1/casino_state?id=eq.1&version=eq.${expected}&select=version`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: payload
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const rows = await res.json();
  if (Array.isArray(rows) && rows.length > 0) {
    loadedVersion = expected + 1;
    // Cachen är redan den senaste kända versionen – spara den utan ny hämtning.
    cache = { text: '[' + payload + ']', version: loadedVersion, at: Date.now() };
    return;
  }

  cache = null; // versionskrock: nästa läsning hämtar färsk data

  // Versionskrock: kom ihåg senaste versionen så att omförsöket kan lyckas.
  const read = await fetch(`${BASE}/rest/v1/casino_state?id=eq.1&select=version`, {
    headers: headers(),
    cache: 'no-store'
  });
  if (read.ok) {
    const info = await read.json();
    loadedVersion = Number(info?.[0]?.version) || 0;
  }
  const err = new Error('Skrivkonflikt – databasen hann ändras av en annan förfrågan');
  err.conflict = true;
  throw err;
}

module.exports = { loadDb, saveDb };
