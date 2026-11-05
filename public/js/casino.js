/* =====================================================================
   Spelhallen – lobby och navigation.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, esc, navigate, openModal, updateBalanceUI, isPaused, pauseText } from './core.js';
import { openAdminCode } from './admin.js';

const GAMES = [
  { key: 'blackjack', icon: '♠', title: 'Blackjack', text: 'Slå dealern utan att gå över 21.', badge: 'Bord', tile: 'blackjack' },
  { key: 'slots', icon: '🎰', title: 'Star Fortune', text: '5 hjul – minst 2 lika i rad ger vinst. Vinst varannan snurr.', badge: 'Högst vinst', tile: 'slots' },
  { key: 'scratch', icon: '🎟️', title: 'Skraplotter', text: 'Köp ett lott och skrapa fram tre lika.', badge: 'Ny', tile: 'scratch' },
  { key: 'videopoker', icon: '🃏', title: 'Videopoker', text: 'Jacks or Better med held kort.', badge: 'Skicklighet', tile: 'poker' },
  { key: 'roulette', icon: '🎡', title: 'Roulette', text: '37 nummer – enkelnummer och nollan betalar bäst.', badge: 'Ny', tile: 'roulette' },
  { key: 'revolver', icon: '🔫', title: 'Rysk roulette', text: 'En kula, sex kammare – hur många klick vågar du?', badge: 'Ny', tile: 'revolver' },
  { key: 'revolver/bord', icon: '👥', title: 'Rysk roulette – bord', text: 'Spela mot varandra: alla lägger insats, en tar hela kassan.', badge: 'Mot varandra', tile: 'revolver' },
  { key: 'finns', icon: '🐟', title: 'Finns i sjön', text: 'Kortspel mot varandra: samla fyrtal och ta kassan.', badge: 'Kortspel', tile: 'deck' },
  { key: 'imposter', icon: '🎭', title: 'Inpostern', text: 'En ledtråd i taget på egen skärm – hitta bluffen.', badge: 'Sällskapsspel', tile: 'imposter' },
  { key: 'sport', icon: '⚽', title: 'Live Sport', text: 'Fotboll, SHL och NHL med live-odds.', badge: 'Live', tile: 'sport' },
  { key: 'kortleken', icon: '📖', title: 'Kortleken', text: 'Alla 52 kort – namn på svenska och engelska.', badge: 'Lär dig', tile: 'deck' },
  { key: 'rikast', icon: '🏆', title: 'Rikast', text: 'Topplistan: vem som har mest spelmynt just nu.', badge: 'Topplista', tile: 'deck' },
  { key: 'historik', icon: '🧾', title: 'Logg', text: 'Allt som hänt med dina spelmynt – insatser, vinster och bonusar.', badge: 'Kvitto', tile: 'deck' }
];

function renderCasino(root) {
  const p = state.player || {};
  const lastBonus = Number(p.lastBonus) || 0;
  const readyIn = Math.max(0, lastBonus + 6 * 60 * 60 * 1000 - Date.now());
  const canClaim = readyIn <= 0;
  const paused = isPaused(p);
  const pauseLeftText = paused ? pauseText(p) : '';
  const pauseLabel = pauseLeftText ? 'i ' + pauseLeftText : 'tills vidare';

  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Golden Spade</h1>
          <p>Spelhall med spelmynt · inga riktiga pengar</p>
        </div>
        <div style="flex:1"></div>
        <div class="row" style="gap:8px;flex-wrap:wrap">
          <button class="btn btn--sm ${canClaim ? 'btn--primary' : 'btn--ghost'}" id="casino-bonus">
            ${canClaim ? '🎁 Hämta bonus' : '🎁 Bonus om ' + hoursText(readyIn)}
          </button>
          <button class="btn btn--sm btn--ghost" id="casino-admin" title="Personal">⚙</button>
          <button class="btn btn--sm btn--ghost" id="casino-back">Studieläge</button>
        </div>
      </div>

      ${state.settings.maintenance ? `<div class="banner-strip" style="margin:14px 0 0"><span>🔧</span><span>Spelhallen är i underhållsläge – spel kan stängas av tillfälligt.</span></div>` : ''}

      ${paused ? `<div class="banner-strip banner-strip--pause" id="casino-pause" style="margin:14px 0 0"><span>⏸</span><span data-pause-text>Du är pausad ${esc(pauseLabel)} – spelandet är avstängt. Plugget funkar som vanligt.</span></div>` : ''}

      <div class="disclaimer">
        <span>🔒</span>
        <div><strong>Endast spelmynt.</strong> Allt här inne är påhittat – du kan inte sätta in eller ta ut riktiga pengar. Saldot fylls på genom att plugga och genom bonusar.</div>
      </div>

      <div class="game-grid${paused ? ' is-paused' : ''}">
        ${GAMES.filter((g) => g.key !== 'sport' || state.settings.sportEnabled !== false).map(
          (g) => `<button class="game-tile tile--${g.tile}" data-game="${g.key}">
            <span class="game-tile__badge">${g.badge}</span>
            <span class="game-tile__icon">${g.icon}</span>
            <h3>${g.title}</h3>
            <p>${g.text}</p>
          </button>`
        ).join('')}
      </div>

      <div class="grid grid--3" style="margin-top:22px">
        <div class="panel" style="padding:20px;background:var(--surface-2)">
          <div class="tiny muted" style="letter-spacing:.1em;text-transform:uppercase;font-weight:800">Saldo</div>
          <div style="font-size:26px;font-weight:800;margin-top:4px">${kr(p.balance ?? 0)}</div>
          <p class="tiny muted" style="margin-top:6px">Spelmynt – inte riktiga kronor.</p>
        </div>
        <div class="panel" style="padding:20px;background:var(--surface-2)">
          <div class="tiny muted" style="letter-spacing:.1em;text-transform:uppercase;font-weight:800">Insatsgränser</div>
          <div style="font-size:26px;font-weight:800;margin-top:4px">${kr(state.settings.minBet)} – ${kr(state.settings.maxBet)}</div>
          <p class="tiny muted" style="margin-top:6px">Per spel och runda.</p>
        </div>
        <div class="panel" style="padding:20px;background:var(--surface-2)">
          <div class="tiny muted" style="letter-spacing:.1em;text-transform:uppercase;font-weight:800">Dina rundor</div>
          <div style="font-size:26px;font-weight:800;margin-top:4px">${p.rounds ?? 0}</div>
          <p class="tiny muted" style="margin-top:6px">Totalt spelade rundor.</p>
        </div>
      </div>

      <div class="panel" style="padding:22px;margin-top:18px">
        <div class="row row--between" style="flex-wrap:wrap;gap:12px">
          <div>
            <h3 style="font-size:16px">Fyll på med plugg</h3>
            <p class="small muted" style="margin-top:4px">Varje rätt svar i studieläget ger ${kr(state.settings.quizReward || 25)} extra.</p>
          </div>
          <button class="btn btn--sm btn--primary" id="casino-study">Plugga och tjäna mynt</button>
        </div>
      </div>
    </div>`;

  root.querySelectorAll('[data-game]').forEach((el) => {
    el.addEventListener('click', () => {
      sfx.click();
      // Pausen stänger spelen men inte loggen.
      if (paused && el.dataset.game !== 'historik') {
        toast(`Du är pausad ${pauseLabel} – plugga så länge`, 'bad');
        return;
      }
      navigate('/kasino/' + el.dataset.game);
    });
  });

  /* Bannertexten räknas ned utan att hela lobbyn ritas om. */
  const pauseBanner = root.querySelector('#casino-pause');
  if (pauseBanner) {
    const tick = setInterval(() => {
      if (!document.body.contains(pauseBanner)) {
        clearInterval(tick);
        return;
      }
      const left = pauseText(state.player);
      if (!left) {
        clearInterval(tick);
        renderCasino(root);
        return;
      }
      const text = pauseBanner.querySelector('[data-pause-text]');
      if (text) text.textContent = 'Du är pausad i ' + left + ' – spelandet är avstängt. Plugget funkar som vanligt.';
    }, 20000);
  }

  root.querySelector('#casino-back').addEventListener('click', () => navigate('/'));
  root.querySelector('#casino-study').addEventListener('click', () => navigate('/'));
  root.querySelector('#casino-admin').addEventListener('click', () => openAdminCode());

  const bonusBtn = root.querySelector('#casino-bonus');
  bonusBtn.addEventListener('click', async () => {
    if (!canClaim) return;
    try {
      const data = await api.bonus();
      sfx.win();
      toast(`Bonus hämtad: +${kr(data.bonus || state.settings.dailyBonus)}`, 'gold');
      updateBalanceUI();
      renderCasino(root);
    } catch (err) {
      if (err.status === 429) {
        toast('Bonusen är redan hämtad – kom tillbaka senare', 'bad');
      } else {
        toast(err.message, 'bad');
      }
    }
  });

  document.onkeydown = null;
}

function hoursText(ms) {
  const h = Math.ceil(ms / (60 * 60 * 1000));
  return h + ' h';
}

registerView('casino', renderCasino);
