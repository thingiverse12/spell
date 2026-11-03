/* =====================================================================
   Ateljén – där spelaren gör figuren och rummet till sitt eget.

   Allt köps för spelmynt som man tjänar genom att plugga. Priser, ägande och
   vilka saker som är upplåsta avgörs av servern (lib/api.js); den här vyn
   ritar bara det spelaren faktiskt har rätt till.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, esc, navigate, updateBalanceUI, confirmModal } from './core.js';
import {
  ATELJE_ITEMS,
  ATELJE_KINDS,
  ATELJE_ROOM_SLOTS,
  DEFAULT_LOOK,
  avatarHTML,
  roomHTML,
  itemById,
  ownsItem
} from './look.js';

const ui = {
  root: null,
  data: null, // { look, owned, catalog, balance, quizCorrect, needAccount }
  tab: 'emblem',
  busy: false,
  error: ''
};

const itemsOf = (kind) => ATELJE_ITEMS.filter((item) => item.kind === kind);

function look() {
  return (ui.data && ui.data.look) || DEFAULT_LOOK;
}

function owned() {
  return (ui.data && ui.data.owned) || [];
}

function balance() {
  return Number((ui.data && ui.data.balance) ?? state.player?.balance ?? 0);
}

function quizCorrect() {
  return Number((ui.data && ui.data.quizCorrect) ?? state.player?.quizCorrect ?? 0);
}

function isUsing(item) {
  const l = look();
  if (item.kind === 'room') return l.room.includes(item.id);
  return l[item.kind] === item.id;
}

/* ------------------------------ smådelar ------------------------------ */

function itemState(item) {
  const have = ownsItem(owned(), item.id);
  const need = item.requires ? Number(item.requires.quizCorrect) || 0 : 0;
  const locked = need > 0 && quizCorrect() < need;
  const affordable = balance() >= item.price;
  return { have, locked, need, affordable };
}

function swatchHTML(item) {
  if (item.kind === 'color') return `<span class="atelje__swatch atelje__swatch--${item.id}"></span>`;
  if (!item.emoji) return `<span class="atelje__swatch atelje__swatch--none">∅</span>`;
  return `<span class="atelje__emoji">${item.emoji}</span>`;
}

function priceLabel(item) {
  if (item.price === 0) return 'Gratis';
  return kr(item.price);
}

function itemHTML(item) {
  const { have, locked, need, affordable } = itemState(item);
  const used = isUsing(item);
  const cls = [
    'atelje__item',
    used ? 'is-used' : '',
    have ? 'is-owned' : '',
    locked ? 'is-locked' : '',
    !have && !locked && !affordable ? 'is-too-expensive' : ''
  ]
    .filter(Boolean)
    .join(' ');

  let foot;
  if (used) foot = `<span class="atelje__tag">✓ I bruk</span>`;
  else if (have) foot = `<span class="atelje__tag atelje__tag--own">Ägd</span>`;
  else if (locked) foot = `<span class="atelje__tag atelje__tag--lock">🔒 ${need} rätt (${quizCorrect()})</span>`;
  else foot = `<span class="atelje__price">${priceLabel(item)}</span>`;

  return `<button class="${cls}" data-item="${item.id}">
    ${swatchHTML(item)}
    <span class="atelje__name">${esc(item.name)}</span>
    ${foot}
  </button>`;
}

function gridHTML(tab) {
  const items = itemsOf(tab);
  const head =
    tab === 'room'
      ? `<p class="atelje__hint">Sakerna ställs i din hörna på startsidan. Plats kvar: ${ATELJE_ROOM_SLOTS - look().room.length} av ${ATELJE_ROOM_SLOTS}.</p>`
      : '';
  return `${head}<div class="atelje__grid">${items.map(itemHTML).join('')}</div>`;
}

function previewHTML() {
  const p = state.player || {};
  return `<div class="atelje__card">
    <div class="atelje__figure">
      ${avatarHTML(look(), { size: 'xl' })}
    </div>
    <h3 class="atelje__who">${esc(p.name || 'Gäst')}</h3>
    <p class="atelje__who-sub">Så här ser du ut i appen</p>
    <div class="atelje__room">
      ${roomHTML(look(), { className: 'atelje__room-inner' })}
    </div>
    <div class="atelje__pills">
      <span class="mini-pill">Saldo <strong>${kr(balance())}</strong></span>
      <span class="mini-pill">Rätt svar <strong>${quizCorrect()}</strong></span>
    </div>
    <p class="atelje__tip tiny muted">
      Spelmynt får du genom att svara rätt i plugget – ${kr(state.settings.quizReward || 25)} per rätt svar.
      Några saker låses upp av att du har många rätt, inte av att du betalar.
    </p>
  </div>`;
}

/* ------------------------------ vyn ------------------------------ */

function paint() {
  const root = ui.root;
  if (!root) return;
  const body = root.querySelector('#atelje-body');
  if (!body) return;

  if (ui.error && !ui.data) {
    body.innerHTML = `<div class="panel" style="padding:26px;text-align:center">
      <div style="font-size:40px">🎨</div>
      <h3 style="margin:10px 0 6px">Ateljén är stängd just nu</h3>
      <p class="small muted">${esc(ui.error)}</p>
      <button class="btn btn--sm btn--primary" id="atelje-retry" style="margin-top:14px">Försök igen</button>
    </div>`;
    const retry = body.querySelector('#atelje-retry');
    if (retry) retry.addEventListener('click', () => load());
    return;
  }

  if (!ui.data) {
    body.innerHTML = `<div class="panel" style="padding:26px;text-align:center" class="muted">Hämtar ateljén …</div>`;
    return;
  }

  body.innerHTML = `
    <div class="atelje">
      ${previewHTML()}
      <div class="atelje__shop">
        <div class="atelje__tabs">
          ${ATELJE_KINDS.map(
            (kind) =>
              `<button class="atelje__tab ${ui.tab === kind.key ? 'is-active' : ''}" data-tab="${kind.key}">${kind.label}</button>`
          ).join('')}
        </div>
        <div id="atelje-grid">${gridHTML(ui.tab)}</div>
        ${
          ui.data.needAccount
            ? `<p class="atelje__note">🔐 Skapa ett konto med namn och PIN för att kunna köpa saker – då sparas allt även på andra enheter.</p>`
            : ''
        }
      </div>
    </div>`;

  bind();
}

function bind() {
  const root = ui.root;
  if (!root) return;

  root.querySelectorAll('[data-tab]').forEach((btn) =>
    btn.addEventListener('click', () => {
      if (ui.tab === btn.dataset.tab) return;
      ui.tab = btn.dataset.tab;
      sfx.click();
      /* Bara flikraden och rutnätet behöver ritas om – förhandsvisningen står still. */
      root.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
      const grid = root.querySelector('#atelje-grid');
      if (grid) {
        grid.innerHTML = gridHTML(ui.tab);
        bindGrid();
      }
    })
  );

  bindGrid();
}

function bindGrid() {
  const root = ui.root;
  if (!root) return;
  root.querySelectorAll('[data-item]').forEach((btn) =>
    btn.addEventListener('click', () => pick(itemById(btn.dataset.item)))
  );
}

/* ------------------------------ handlingar ------------------------------ */

async function pick(item) {
  if (!item || ui.busy) return;
  const { have, locked, need, affordable } = itemState(item);

  if (locked) {
    toast(`${item.name} låses upp när du har ${need} rätt svar – du har ${quizCorrect()}`, 'bad', 3200);
    sfx.click();
    return;
  }

  if (!have) {
    if (ui.data && ui.data.needAccount) {
      toast('Skapa ett konto först – då kan du köpa saker', 'bad');
      navigate('/konto');
      return;
    }
    if (!affordable) {
      toast(`Du har ${kr(balance())} – ${item.name} kostar ${kr(item.price)}`, 'bad', 3200);
      return;
    }
    const yes = await confirmModal({
      title: `Köpa ${item.name}?`,
      text: `${item.name} kostar ${kr(item.price)}. Efter köpet har du ${kr(balance() - item.price)} kvar.`,
      confirmLabel: `Köp för ${kr(item.price)}`
    });
    if (!yes) return;
    await buy(item);
    return;
  }

  /* Redan ägd – byt till den (eller ställ in/ut ur rummet). */
  const next = { ...look(), room: look().room.slice() };
  if (item.kind === 'room') {
    if (next.room.includes(item.id)) {
      next.room = next.room.filter((id) => id !== item.id);
    } else {
      if (next.room.length >= ATELJE_ROOM_SLOTS) {
        toast('Rummet är fullt – ta bort något först', 'bad');
        return;
      }
      next.room.push(item.id);
    }
  } else {
    next[item.kind] = item.id;
  }
  await saveLook(next);
}

async function buy(item) {
  ui.busy = true;
  try {
    const data = await api.ateljeBuy(item.id);
    ui.data = { ...ui.data, ...data };
    sfx.win();
    toast(`${item.name} är din!`, 'ok');
    updateBalanceUI();
    /* Ta på sig saken direkt – utom rumsaker, som ställs fram. */
    const next = { ...look(), room: look().room.slice() };
    if (item.kind === 'room') {
      if (!next.room.includes(item.id) && next.room.length < ATELJE_ROOM_SLOTS) next.room.push(item.id);
    } else {
      next[item.kind] = item.id;
    }
    await saveLook(next);
  } catch (err) {
    toast(err.message, 'bad', 3200);
  } finally {
    ui.busy = false;
    paint();
  }
}

async function saveLook(next) {
  ui.busy = true;
  try {
    const data = await api.ateljeSave(next);
    ui.data = { ...ui.data, ...data };
    sfx.click();
  } catch (err) {
    toast(err.message, 'bad');
  } finally {
    ui.busy = false;
    paint();
  }
}

async function load() {
  if (!ui.root) return;
  ui.error = '';
  paint();
  try {
    const data = await api.atelje();
    ui.data = data;
    updateBalanceUI();
  } catch (err) {
    ui.error = err.message;
    ui.data = null;
  }
  paint();
}

function renderAtelje(root) {
  ui.root = root;
  const p = state.player || {};

  root.innerHTML = `
    <div class="wrap">
      <div class="section__head" style="margin-bottom:8px">
        <div>
          <h2 class="section__title">Ateljén</h2>
          <p class="section__sub">Gör figuren till din egen och möblera din hörna – allt köps för spelmynt du tjänat genom att plugga.</p>
        </div>
        <button class="btn btn--sm btn--ghost" data-go="/">← Hem</button>
      </div>
      <div id="atelje-body"></div>
      <p class="tiny muted" style="margin-top:18px">
        Ingenting här kostar riktiga pengar. Du är inloggad som <b>${esc(p.name || 'gäst')}</b>.
      </p>
    </div>`;

  const back = root.querySelector('[data-go="/"]');
  if (back)
    back.addEventListener('click', () => {
      sfx.click();
      navigate('/');
    });

  load();
}

registerView('atelje', renderAtelje);
