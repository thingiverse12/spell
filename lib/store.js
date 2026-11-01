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

async function saveDb(db) {
  assertConfigured();

  for (let attempt = 0; attempt < 4; attempt += 1) {
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

    // Versionskrock – läs om och försök igen.
    const read = await fetch(`${BASE}/rest/v1/casino_state?id=eq.1&select=version`, {
      headers: headers(),
      cache: 'no-store'
    });
    if (read.ok) {
      const info = await read.json();
      loadedVersion = Number(info?.[0]?.version) || 0;
    }
  }

  throw new Error('Kunde inte spara till Supabase efter flera försök');
}

module.exports = { loadDb, saveDb };
