'use strict';

/**
 * Vercel-funktion: allt under /api/* hamnar här.
 */

const { createApi } = require('../lib/api.js');
const { loadDb, saveDb } = require('../lib/store.js');

const api = createApi({
  loadDb,
  saveDb,
  adminCode: process.env.ADMIN_CODE || 'Vincent12'
});

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'https://' + (req.headers.host || 'localhost'));
  await api.handle(req, res, url);
};
