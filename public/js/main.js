/* =====================================================================
   App-skal, navigation och hemlig upplåsning av spelhallen.
   ===================================================================== */

import {
  state, hooks, storage, renderRoute, navigate, ensureSession, api, unlockCasino,
  sfx, toast, kr, esc, openModal, updateBalanceUI, avatarLetter, toggleMute, watchSettings,
  startScreenTime, isPaused, pauseText
} from './core.js';

import './learn.js';
import './casino.js';
import './cards.js';
import './blackjack.js';
import './slots.js';
import './scratch.js';
import './videopoker.js';
import './roulette.js';
import './history.js';
import './sport.js';
import './admin.js';
import { syncAccountGate } from './gate.js';
import { initReklam } from './reklam.js';

const app = document.getElementById('app');

const STUDY_NAV = [
  { path: '/', label: 'Hem' },
  { path: '/matte', label: 'Matematik' },
  { path: '/engelska', label: 'Engelska' },
  { path: '/svenska', label: 'Svenska' },
  { path: '/geografi', label: 'Geografi' },
  { path: '/framsteg', label: 'Framsteg' },
  { path: '/logg', label: 'Logg' },
  { path: '/konto', label: 'Konto' }
];

const CASINO_NAV = [
  { path: '/kasino', label: 'Spelhallen' },
  { path: '/kasino/blackjack', label: 'Blackjack' },
  { path: '/kasino/slots', label: 'Star Fortune' },
  { path: '/kasino/scratch', label: 'Skraplotter' },
  { path: '/kasino/videopoker', label: 'Videopoker' },
  { path: '/kasino/roulette', label: 'Roulette' },
  { path: '/kasino/sport', label: 'Live Sport' },
  { path: '/kasino/kortleken', label: 'Kortleken' },
  { path: '/kasino/historik', label: 'Logg' }
];

function buildShell() {
  app.innerHTML = `
    <header class="topbar">
      <div class="topbar__inner" id="topbar-inner"></div>
    </header>
    <main id="view" style="flex:1"></main>
    <footer class="footer">
      <div class="footer__inner">
        <div class="row" style="gap:10px;flex-wrap:wrap">
          <span><b>Plugghörnan</b> · studiestöd i matte, engelska och svenska</span>
        </div>
        <div class="footer__links">
          <a href="#/framsteg">Framsteg</a>
          <a href="#/konto">Mitt konto</a>
          <a href="#/lararpanel">Lärarpanel</a>
          <span class="footer__dot"></span>
          <span class="tiny">Alla mynt är påhittade · inga riktiga pengar</span>
        </div>
      </div>
    </footer>`;
}

function activeLabel(route) {
  const parts = route.parts || [];
  if (parts[0] === 'kasino' && parts[1]) return parts[1];
  return parts[0] || '';
}

function renderTopbar() {
  const bar = document.getElementById('topbar-inner');
  if (!bar) return;
  const casino = state.route.casino;
  const balance = state.player?.balance ?? 0;
  const nav = casino ? CASINO_NAV : STUDY_NAV;
  const active = activeLabel(state.route);

  bar.innerHTML = `
    <div class="brand" id="brand">
      <div class="brand__mark" id="brand-mark">${casino ? '♠' : '♠'}</div>
      <div class="brand__text">
        <span class="brand__name">${casino ? 'Golden Spade' : 'Plugghörnan'}</span>
        <span class="brand__tag">${casino ? 'Spelmynt · ej riktiga pengar' : 'Matte · Engelska · Svenska · Geografi'}</span>
      </div>
    </div>

    <nav class="nav" id="main-nav">
      ${nav
        .map((item) => {
          const key = item.path === '/' ? '' : item.path.replace(/^\//, '').replace('kasino/', '');
          const isActive = item.path === '/' ? !active : active === key;
          return `<a class="nav__link ${isActive ? 'is-active' : ''}" href="#${item.path}">${item.label}</a>`;
        })
        .join('')}
    </nav>

    <div class="topbar__spacer"></div>

    <div class="topbar__right">
      ${casino && isPaused(state.player)
        ? `<span class="chip chip--amber" title="Spelandet är avstängt under pausen">⏸ Pausad ${esc(pauseText(state.player))}</span>`
        : ''}
      <div class="balance" title="Spelmynt">
        <span class="balance__icon">${casino ? '◈' : '★'}</span>
        <div>
          <span class="balance__label">${casino ? 'Saldo' : 'Mina mynt'}</span>
          <span class="balance__value" id="balance-value">${kr(balance)}</span>
        </div>
      </div>
      <button class="btn btn--icon btn--ghost" id="sound-btn" title="Ljud">${state.muted ? '🔇' : '🔊'}</button>
      ${
        casino
          ? `<button class="btn btn--sm btn--primary" id="study-btn">Studieläge</button>`
          : `<button class="btn btn--icon btn--ghost" id="profile-btn" title="Min profil">${esc(avatarLetter(state.player?.name))}</button>`
      }
    </div>`;

  bar.querySelector('#brand').addEventListener('click', brandClick);
  bar.querySelector('#sound-btn').addEventListener('click', () => {
    const muted = toggleMute();
    bar.querySelector('#sound-btn').textContent = muted ? '🔇' : '🔊';
    if (!muted) sfx.click();
    toast(muted ? 'Ljud av' : 'Ljud på');
  });
  const profileBtn = bar.querySelector('#profile-btn');
  if (profileBtn) profileBtn.addEventListener('click', () => navigate('/konto'));
  const studyBtn = bar.querySelector('#study-btn');
  if (studyBtn) studyBtn.addEventListener('click', () => {
    sfx.click();
    navigate('/');
  });

}

/* ------------------------------ Hemlig ingång ------------------------------ */

let brandClicks = 0;
let brandTimer = null;
let typed = '';

function brandClick() {
  brandClicks += 1;
  sfx.click();
  clearTimeout(brandTimer);
  brandTimer = setTimeout(() => (brandClicks = 0), 1200);
  if (brandClicks >= 3) {
    brandClicks = 0;
    openSecretDoor();
  }
}

function openSecretDoor() {
  if (state.unlocked) {
    navigate('/kasino');
    return;
  }
  sfx.bigWin();
  openModal({
    title: '♠ Du hittade dörren',
    sub: 'Bakom studiematerialet ligger Golden Spade – en spelhall med spelmynt. Inga riktiga pengar, bara påhittade mynt du tjänar genom att plugga.',
    body: `<div class="disclaimer" style="margin:0">
        <span>🔒</span>
        <div>Allt är på låtsas. Du kan aldrig sätta in eller ta ut pengar.</div>
      </div>`,
    actions: [
      { label: 'Nej tack' },
      { label: 'Öppna spelhallen', kind: 'primary', onClick: (close) => { close(); unlockCasino(); } }
    ]
  });
}

function setupSecretTyping() {
  document.addEventListener('keydown', (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (e.key.length !== 1) return;
    typed = (typed + e.key.toLowerCase()).slice(-12);
    if (typed.includes('kasino') || typed.includes('golden')) {
      typed = '';
      openSecretDoor();
    }
  });
}

/* ------------------------------ Start ------------------------------ */

async function boot() {
  state.unlocked = !!storage.get('ph.unlocked', false);
  state.muted = !!storage.get('ph.muted', false);
  state.adminToken = storage.get('ph.admin', null) || null;

  buildShell();
  hooks.onRoute = (route) => {
    renderTopbar();
    updateBalanceUI();
    syncAccountGate();
  };

  try {
    await ensureSession();
  } catch (err) {
    if (err.status === 403) {
      toast('Ditt konto är avstängt av admin. Nytt gästkonto skapas.', 'bad', 4000);
      try {
        await api.guest();
      } catch (e) {
        toast('Kunde inte skapa konto', 'bad');
      }
    }
  }

  state.broadcast = state.settings.banner || '';
  renderTopbar();
  renderRoute();
  syncAccountGate();
  initReklam();

  // Ladda om sidan när admin ändrar inställningarna.
  watchSettings();

  // Rapportera skärmtid till adminpanelen (bara när fliken är synlig).
  startScreenTime();

  // Uppdatera saldo med jämna mellanrum om fliken ligger öppen
  setInterval(async () => {
    if (!state.player || state.offline) return;
    try {
      await api.me();
      updateBalanceUI();
    } catch (e) {
      /* tyst */
    }
  }, 60000);
}

window.addEventListener('hashchange', () => renderRoute());

window.addEventListener('unhandledrejection', (e) => {
  console.error('Ohanterat fel:', e.reason);
});

setupSecretTyping();
boot();
