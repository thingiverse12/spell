'use strict';

/**
 * Lokal server: statiska filer + API med filbaserad lagring i data/db.json.
 * (På Vercel körs API:t i api/[...path].js med Supabase som lagring.)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { createApi, normalizeDb } = require('./lib/api.js');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_CODE = (process.env.ADMIN_CODE || 'Vincent12').trim();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

function loadDb() {
  try {
    return normalizeDb(JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (err) {
    return normalizeDb({});
  }
}

function saveDb(db) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('Kunde inte spara databasen:', err.message);
  }
}

const api = createApi({ loadDb, saveDb, adminCode: ADMIN_CODE });

function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  try {
    rel = decodeURIComponent(rel);
  } catch (err) {
    res.writeHead(400, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Felaktig sökväg' }));
  }
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Nekad');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      const index = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(index)) {
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        fs.createReadStream(index).pipe(res);
        return;
      }
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Hittades inte');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('x-content-type-options', 'nosniff');
  try {
    const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
    if (url.pathname.startsWith('/api/')) {
      await api.handle(req, res, url);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('Serverfel:', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Serverfel: ' + err.message }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Plugghörnan körs på http://${HOST}:${PORT} (admin-kod: ${ADMIN_CODE})`);
});
