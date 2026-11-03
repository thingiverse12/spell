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
  const res = await fetch(`${BASE}/rest/v1/casino_state?id=eq.1&select=data,version`, {
    headers: headers(),
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`Supabase GET ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const rows = await res.json();
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
    return {};
  }

  loadedVersion = Number(rows[0].version) || 0;
  return rows[0].data || {};
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

  const res = await fetch(`${BASE}/rest/v1/casino_state?id=eq.1&version=eq.${loadedVersion}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify({ data: db, version: loadedVersion + 1 })
  });
  if (!res.ok) throw new Error(`Supabase PATCH ${res.status}: ${(await res.text()).slice(0, 200)}`);

  const rows = await res.json();
  if (Array.isArray(rows) && rows.length > 0) {
    loadedVersion += 1;
    return;
  }

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
