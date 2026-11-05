/* =====================================================================
   Pokémon-kort – öppna pack, samla och sälj korten till varandra.

   Allt som kostar eller ger spelmynt räknas på servern (lib/api.js): priset
   för ett pack, oddsen och vad korten är värda. Den här vyn ritar bara det
   spelaren äger och skickar knapptrycken vidare.
   ===================================================================== */

import { registerView, state, api, sfx, toast, kr, esc, navigate, openModal, confirmModal, updateBalanceUI } from './core.js';

export const POKEMON_RARITY = {
  common: { label: 'Vanligt', icon: '⚪', cls: 'pk-card--common' },
  rare: { label: 'Ovanligt', icon: '🔵', cls: 'pk-card--rare' },
  legendary: { label: 'Legendariskt', icon: '🌟', cls: 'pk-card--legendary' }
};

const ui = {
  root: null,
  data: null,
  error: '',
  busy: false,
  opening: false,
  revealed: null
};

const cards = () => (ui.data && Array.isArray(ui.data.cards) ? ui.data.cards : []);
const market = () => (ui.data && Array.isArray(ui.data.market) ? ui.data.market : []);
const balance = () => Number((ui.data && ui.data.balance) ?? state.player?.balance ?? 0);
const packPrice = () => Number((ui.data && ui.data.packPrice) || 0);
const cardLimit = () => Number((ui.data && ui.data.cardLimit) || 0);
const valueOf = (rarity) => Number((ui.data && ui.data.values && ui.data.values[rarity]) || 0);
const rarityOf = (rarity) => POKEMON_RARITY[rarity] || POKEMON_RARITY.common;

/* ------------------------------ smådelar ------------------------------ */

const percent = (share) => String(Math.round(Number(share || 0) * 1000) / 10).replace('.', ',') + ' %';

function oddsHTML() {
  const odds = (ui.data && ui.data.odds) || {};
  return ['legendary', 'rare', 'common']
    .map((rarity) => {
      const info = rarityOf(rarity);
      return `<li class="pk-odds__row">
        <span class="pk-badge ${info.cls}">${info.icon} ${info.label}</span>
        <span class="pk-odds__chance">${percent(odds[rarity])}</span>
        <span class="pk-odds__value">${kr(valueOf(rarity))}</span>
      </li>`;
    })
    .join('');
}

function cardHTML(card) {
  const info = rarityOf(card.rarity);
  const ownValue = valueOf(card.rarity);
  return `<article class="pk-card ${info.cls}" data-card="${esc(card.id)}">
    <div class="pk-card__art">${esc(card.emoji || '❔')}</div>
    <h4 class="pk-card__name">${esc(card.name || 'Okänt')}</h4>
    <p class="pk-card__rarity">${info.label} · värd ${kr(ownValue)}</p>
    <div class="pk-card__actions">
      <button class="btn btn--sm btn--ghost" data-sell="${esc(card.id)}">Sälj ${kr(ownValue)}</button>
      <button class="btn btn--sm" data-list="${esc(card.id)}">Lägg ut</button>
    </div>
  </article>`;
}

function listingHTML(listing) {
  const info = rarityOf(listing.rarity);
  const foot = listing.mine
    ? `<button class="btn btn--sm btn--ghost" data-unlist="${esc(listing.id)}">Ta bort</button>
       <span class="tiny muted">Ditt kort · ${kr(listing.price)}</span>`
    : `<button class="btn btn--sm btn--primary" data-buy="${esc(listing.id)}">Köp ${kr(listing.price)}</button>`;
  return `<article class="pk-listing ${info.cls}">
    <span class="pk-listing__art">${esc(listing.emoji || '❔')}</span>
    <div class="pk-listing__text">
      <b>${esc(listing.name || 'Okänt')}</b>
      <span class="tiny muted">${info.label} · säljs av ${esc(listing.sellerName || 'okänd')}</span>
    </div>
    <div class="pk-listing__side">${foot}</div>
  </article>`;
}

function revealHTML() {
  if (!ui.revealed) return '';
  const card = ui.revealed;
  const info = rarityOf(card.rarity);
  const ownValue = valueOf(card.rarity);
  const extra = card.rarity === 'legendary' ? 'LEGENDARISKT KORT!' : card.rarity === 'rare' ? 'Ovanligt kort!' : 'Ett nytt kort';
  return `<div class="pk-reveal ${info.cls}" id="pk-reveal">
    <div class="pk-reveal__card">
      <span class="pk-reveal__tag">${extra}</span>
      <div class="pk-reveal__art">${esc(card.emoji || '❔')}</div>
      <h3 class="pk-reveal__name">${esc(card.name || 'Okänt')}</h3>
      <p class="pk-reveal__meta">${info.label} · värd ${kr(ownValue)}</p>
      <div class="pk-reveal__actions">
        <button class="btn btn--sm btn--primary" data-sell="${esc(card.id)}" data-from-reveal="1">Sälj för ${kr(ownValue)}</button>
        <button class="btn btn--sm btn--ghost" data-keep="1">Behåll kortet</button>
      </div>
    </div>
  </div>`;
}

function bodyHTML() {
  if (ui.error) {
    return `<div class="panel pk-note"><p>${esc(ui.error)}</p>
      <button class="btn btn--sm" data-reload="1">Försök igen</button></div>`;
  }
  if (!ui.data) return `<div class="panel pk-note"><p>Hämtar korten …</p></div>`;

  const mine = cards();
  const listed = market();
  const tooPoor = balance() < packPrice();
  const full = cardLimit() && mine.length >= cardLimit();

  return `
    <section class="panel pk-pack">
      <div class="pk-pack__text">
        <h3>Så vinner du</h3>
        <p>Varje pack kostar <b>${kr(packPrice())}</b> och ger ett slumpat kort.
          Kortet kan du sälja direkt till banken för ett fast pris – eller lägga ut
          på marknaden och låta en kompis köpa det för det pris du väljer.</p>
        <ul class="pk-odds">
          ${oddsHTML()}
        </ul>
      </div>
      <div class="pk-pack__side">
        <button class="btn btn--primary" id="pk-open" ${tooPoor || full || ui.opening ? 'disabled' : ''}>
          ${ui.opening ? 'Öppnar …' : 'Öppna pack · ' + kr(packPrice())}
        </button>
        <p class="tiny muted">
          Saldo <b>${kr(balance())}</b><br />
          ${mine.length}${cardLimit() ? ' / ' + cardLimit() : ''} kort i samlingen
        </p>
        ${tooPoor ? `<p class="tiny pk-warn">Du behöver ${kr(packPrice())} – plugga lite först.</p>` : ''}
        ${full ? `<p class="tiny pk-warn">Samlingen är full – sälj några kort först.</p>` : ''}
        ${ui.data.needAccount ? `<p class="tiny pk-warn">🔐 Skapa ett konto med namn och PIN för att köpa och sälja kort.</p>` : ''}
      </div>
    </section>

    ${revealHTML()}

    <section class="section pk-section">
      <div class="section__head">
        <div>
          <h3 class="section__title">Min samling</h3>
          <p class="section__sub">${mine.length ? mine.length + ' kort · sälj till banken eller lägg ut dem på marknaden' : 'Inga kort än – öppna ditt första pack.'}</p>
        </div>
      </div>
      ${
        mine.length
          ? `<div class="pk-grid">${mine.map(cardHTML).join('')}</div>`
          : `<p class="muted">🍒 Inga kort i samlingen än.</p>`
      }
    </section>

    <section class="section pk-section">
      <div class="section__head">
        <div>
          <h3 class="section__title">Marknaden</h3>
          <p class="section__sub">${listed.length ? listed.length + ' kort till salu – köp av varandra' : 'Ingen har lagt ut något än. Bli först!'}</p>
        </div>
      </div>
      ${
        listed.length
          ? `<div class="pk-market">${listed.map(listingHTML).join('')}</div>`
          : `<p class="muted">📦 Marknaden är tom just nu.</p>`
      }
    </section>`;
}

/* ------------------------------ målning ------------------------------ */

function paint() {
  const root = ui.root;
  if (!root) return;
  const body = root.querySelector('#pk-body');
  if (!body) return;
  body.innerHTML = bodyHTML();
  bind();
}

function bind() {
  const root = ui.root;
  if (!root) return;

  const openBtn = root.querySelector('#pk-open');
  if (openBtn) openBtn.addEventListener('click', openPack);

  root.querySelectorAll('[data-sell]').forEach((btn) =>
    btn.addEventListener('click', () => sell(btn.dataset.sell, !!btn.dataset.fromReveal))
  );

  root.querySelectorAll('[data-list]').forEach((btn) =>
    btn.addEventListener('click', () => askPrice(btn.dataset.list))
  );

  root.querySelectorAll('[data-buy]').forEach((btn) =>
    btn.addEventListener('click', () => buy(btn.dataset.buy))
  );

  root.querySelectorAll('[data-unlist]').forEach((btn) =>
    btn.addEventListener('click', () => unlist(btn.dataset.unlist))
  );

  const keep = root.querySelector('[data-keep]');
  if (keep)
    keep.addEventListener('click', () => {
      sfx.click();
      ui.revealed = null;
      paint();
    });

  const reload = root.querySelector('[data-reload]');
  if (reload)
    reload.addEventListener('click', () => {
      ui.error = '';
      load();
    });
}

/* ------------------------------ handlingar ------------------------------ */

async function load() {
  try {
    ui.data = await api.pokemon();
    ui.error = '';
    updateBalanceUI();
  } catch (err) {
    ui.error = err.message || 'Kunde inte hämta korten';
    ui.data = null;
  }
  paint();
}

async function openPack() {
  if (ui.opening || ui.busy) return;
  if (ui.data && ui.data.needAccount) {
    toast('Skapa ett konto först – då sparas korten', 'bad', 3200);
    return;
  }
  if (balance() < packPrice()) {
    toast('Du har inte tillräckligt med spelmynt – plugga lite först', 'bad', 3200);
    return;
  }
  ui.opening = true;
  ui.revealed = null;
  paint();
  try {
    const data = await api.pokemonPack();
    ui.data = data;
    ui.revealed = data.card || null;
    const info = rarityOf(data.card?.rarity);
    if (data.card?.rarity === 'legendary') {
      sfx.win();
      toast(`🌟 LEGENDARISKT! ${data.card.name} – värd ${kr(data.value)}`, 'gold', 4000);
    } else if (data.card?.rarity === 'rare') {
      sfx.win();
      toast(`🔵 Ovanligt kort: ${data.card.name} – värd ${kr(data.value)}`, 'gold', 3400);
    } else {
      sfx.chip();
      toast(`${info.icon} ${data.card?.name || 'Kort'} – värt ${kr(data.value)}`, '', 2400);
    }
    updateBalanceUI();
  } catch (err) {
    toast(err.message, 'bad', 3400);
  }
  ui.opening = false;
  paint();
}

async function sell(cardId, fromReveal) {
  if (ui.busy) return;
  const card = cards().find((c) => c && c.id === cardId) || (ui.revealed && ui.revealed.id === cardId ? ui.revealed : null);
  if (!card) return;
  if (!fromReveal) {
    const yes = await confirmModal({
      title: 'Sälja kortet?',
      text: `${card.name} säljs till banken för ${kr(valueOf(card.rarity))}.`,
      confirmLabel: 'Sälj'
    });
    if (!yes) return;
  }
  ui.busy = true;
  try {
    const data = await api.pokemonSell(cardId);
    ui.data = data;
    if (ui.revealed && ui.revealed.id === cardId) ui.revealed = null;
    sfx.win();
    toast(`Sålt! +${kr(data.value)}`, 'gold', 2600);
    updateBalanceUI();
  } catch (err) {
    toast(err.message, 'bad', 3200);
  }
  ui.busy = false;
  paint();
}

function askPrice(cardId) {
  const card = cards().find((c) => c && c.id === cardId);
  if (!card) return;
  const suggested = valueOf(card.rarity);
  openModal({
    title: 'Lägg ut på marknaden',
    sub: `${card.name} – ${rarityOf(card.rarity).label.toLowerCase()}`,
    body: `<label class="field">
        <span>Ditt pris</span>
        <input id="pk-price" class="input" type="number" min="1" step="1" value="${suggested}" />
      </label>
      <p class="tiny muted" style="margin-top:8px">Kortet ligger kvar på marknaden tills någon köper det – du kan ta tillbaka det när du vill.</p>`,
    actions: [
      { label: 'Avbryt' },
      {
        label: 'Lägg ut',
        kind: 'primary',
        onClick: async (close, modal) => {
          const input = modal.querySelector('#pk-price');
          const price = Math.round(Number(input && input.value) || 0);
          if (!(price > 0)) {
            toast('Skriv ett pris först', 'bad');
            return;
          }
          close();
          await listCard(cardId, price);
        }
      }
    ]
  });
}

async function listCard(cardId, price) {
  if (ui.busy) return;
  ui.busy = true;
  try {
    ui.data = await api.pokemonList(cardId, price);
    sfx.click();
    toast(`Ute på marknaden för ${kr(price)}`, '', 2600);
    updateBalanceUI();
  } catch (err) {
    toast(err.message, 'bad', 3200);
  }
  ui.busy = false;
  paint();
}

async function unlist(listingId) {
  if (ui.busy) return;
  ui.busy = true;
  try {
    ui.data = await api.pokemonUnlist(listingId);
    sfx.click();
    toast('Kortet är tillbaka i samlingen', '', 2400);
  } catch (err) {
    toast(err.message, 'bad', 3200);
  }
  ui.busy = false;
  paint();
}

async function buy(listingId) {
  if (ui.busy) return;
  const listing = market().find((l) => l && l.id === listingId);
  if (!listing) return;
  if (listing.mine) {
    toast('Det är ditt eget kort', 'bad');
    return;
  }
  if (balance() < Number(listing.price)) {
    toast(`Du behöver ${kr(listing.price)} – du har ${kr(balance())}`, 'bad', 3200);
    return;
  }
  const yes = await confirmModal({
    title: `Köpa ${listing.name}?`,
    text: `${kr(listing.price)} går till ${listing.sellerName}.`,
    confirmLabel: `Köp ${kr(listing.price)}`
  });
  if (!yes) return;
  ui.busy = true;
  try {
    ui.data = await api.pokemonBuy(listingId);
    sfx.win();
    toast(`${listing.name} är din!`, 'gold', 2600);
    updateBalanceUI();
  } catch (err) {
    toast(err.message, 'bad', 3400);
  }
  ui.busy = false;
  paint();
}

/* ------------------------------ vyn ------------------------------ */

function renderPokemon(root) {
  ui.root = root;
  ui.revealed = null;
  const p = state.player || {};

  root.innerHTML = `
    <div class="wrap">
      <div class="section__head" style="margin-bottom:8px">
        <div>
          <h2 class="section__title">Pokémon-kort</h2>
          <p class="section__sub">Öppna pack, samla vanliga, ovanliga och legendariska kort – och sälj dem till varandra.</p>
        </div>
        <button class="btn btn--sm btn--ghost" data-go="/kasino">← Spelhallen</button>
      </div>
      <div id="pk-body"><div class="panel pk-note"><p>Hämtar korten …</p></div></div>
      <p class="tiny muted" style="margin-top:18px">
        Alla kort och mynt är påhittade – inget kostar riktiga pengar. Du är inloggad som <b>${esc(p.name || 'gäst')}</b>.
      </p>
    </div>`;

  const back = root.querySelector('[data-go="/kasino"]');
  if (back) back.addEventListener('click', () => {
    sfx.click();
    navigate('/kasino');
  });

  load();
}

registerView('pokemon', renderPokemon);
