/* =====================================================================
   Inpostern – sällskapsspel med ett ord, en bluff och en hemlig roll.

   Alla utom en får samma ord. Inpostern får bara en svår ledtråd (en bred
   kategori) och ska lista ut ordet utan att avslöja sig. Man spelar på en
   och samma telefon: den skickas runt och varje spelare trycker fram sitt
   kort själv, så ingen annan ser rollen.

   Spelledaren kan välja ord själv – då får hen ordet från start och kan
   därför aldrig bli inpostern. Spelet kräver ingen server och inga spelmynt:
   allt sker i klienten, och rollerna blandas om för varje omgång.
   ===================================================================== */

import { registerView, sfx, esc, navigate, toast } from './core.js';

/* Reglerna som siffror – exporteras så att npm run audit kan kontrollera
   spelet utanför webbläsaren. */
export const IMPOSTER = {
  MIN_PLAYERS: 3,
  MAX_PLAYERS: 12,
  NAME_MAX: 14
};

/* Ordlistan. Ledtråden är med flit bred: inpostern får veta kategorin, inte
   ordet, och måste spela sig fram till resten. */
export const IMPOSTER_WORDS = [
  /* Mat */
  { word: 'Pizza', hint: 'Mat' },
  { word: 'Pannkaka', hint: 'Mat' },
  { word: 'Tacos', hint: 'Mat' },
  { word: 'Sushi', hint: 'Mat' },
  { word: 'Glass', hint: 'Mat' },
  { word: 'Popcorn', hint: 'Mat' },
  { word: 'Kanelbulle', hint: 'Mat' },
  { word: 'Köttbullar', hint: 'Mat' },
  { word: 'Våffla', hint: 'Mat' },
  { word: 'Sallad', hint: 'Mat' },
  { word: 'Choklad', hint: 'Mat' },
  { word: 'Blåbärssoppa', hint: 'Mat' },

  /* Djur */
  { word: 'Pingvin', hint: 'Djur' },
  { word: 'Elefant', hint: 'Djur' },
  { word: 'Haj', hint: 'Djur' },
  { word: 'Uggla', hint: 'Djur' },
  { word: 'Myra', hint: 'Djur' },
  { word: 'Krokodil', hint: 'Djur' },
  { word: 'Fjäril', hint: 'Djur' },
  { word: 'Igelkott', hint: 'Djur' },
  { word: 'Bläckfisk', hint: 'Djur' },
  { word: 'Katt', hint: 'Djur' },
  { word: 'Hund', hint: 'Djur' },
  { word: 'Häst', hint: 'Djur' },

  /* Saker hemma */
  { word: 'Kylskåp', hint: 'Sak i hemmet' },
  { word: 'Dammsugare', hint: 'Sak i hemmet' },
  { word: 'Kudde', hint: 'Sak i hemmet' },
  { word: 'Spegel', hint: 'Sak i hemmet' },
  { word: 'Brödrost', hint: 'Sak i hemmet' },
  { word: 'Tvättmaskin', hint: 'Sak i hemmet' },
  { word: 'Ficklampa', hint: 'Sak i hemmet' },
  { word: 'Stearinljus', hint: 'Sak i hemmet' },
  { word: 'Element', hint: 'Sak i hemmet' },
  { word: 'Tvål', hint: 'Sak i hemmet' },

  /* Platser */
  { word: 'Strand', hint: 'Plats' },
  { word: 'Bibliotek', hint: 'Plats' },
  { word: 'Simhall', hint: 'Plats' },
  { word: 'Biograf', hint: 'Plats' },
  { word: 'Flygplats', hint: 'Plats' },
  { word: 'Fotbollsplan', hint: 'Plats' },
  { word: 'Slott', hint: 'Plats' },
  { word: 'Skogsstig', hint: 'Plats' },
  { word: 'Zoo', hint: 'Plats' },
  { word: 'Kajen', hint: 'Plats' },

  /* Sport */
  { word: 'Basket', hint: 'Sport' },
  { word: 'Tennis', hint: 'Sport' },
  { word: 'Skidåkning', hint: 'Sport' },
  { word: 'Brottning', hint: 'Sport' },
  { word: 'Badminton', hint: 'Sport' },
  { word: 'Orientering', hint: 'Sport' },
  { word: 'Innebandy', hint: 'Sport' },
  { word: 'Friidrott', hint: 'Sport' },

  /* Fordon */
  { word: 'Buss', hint: 'Fordon' },
  { word: 'Cykel', hint: 'Fordon' },
  { word: 'Ubåt', hint: 'Fordon' },
  { word: 'Traktor', hint: 'Fordon' },
  { word: 'Spårvagn', hint: 'Fordon' },
  { word: 'Helikopter', hint: 'Fordon' },
  { word: 'Kanot', hint: 'Fordon' },
  { word: 'Skoter', hint: 'Fordon' },

  /* Väder */
  { word: 'Åska', hint: 'Väder' },
  { word: 'Snöstorm', hint: 'Väder' },
  { word: 'Hagel', hint: 'Väder' },
  { word: 'Dimma', hint: 'Väder' },
  { word: 'Regnbåge', hint: 'Väder' },
  { word: 'Värmebölja', hint: 'Väder' },

  /* Yrken */
  { word: 'Brandman', hint: 'Yrke' },
  { word: 'Tandläkare', hint: 'Yrke' },
  { word: 'Frisör', hint: 'Yrke' },
  { word: 'Pilot', hint: 'Yrke' },
  { word: 'Bagare', hint: 'Yrke' },
  { word: 'Astronaut', hint: 'Yrke' },
  { word: 'Trädgårdsmästare', hint: 'Yrke' },
  { word: 'Polis', hint: 'Yrke' },

  /* Kläder */
  { word: 'Regnjacka', hint: 'Kläder' },
  { word: 'Baddräkt', hint: 'Kläder' },
  { word: 'Stövel', hint: 'Kläder' },
  { word: 'Mössa', hint: 'Kläder' },
  { word: 'Vante', hint: 'Kläder' },
  { word: 'Kjol', hint: 'Kläder' },

  /* Spel */
  { word: 'Schack', hint: 'Spel' },
  { word: 'Twister', hint: 'Spel' },
  { word: 'Yatzy', hint: 'Spel' },
  { word: 'Memory', hint: 'Spel' },
  { word: 'Kubb', hint: 'Spel' },
  { word: 'Monopol', hint: 'Spel' },

  /* Kroppen */
  { word: 'Näsa', hint: 'Kroppsdel' },
  { word: 'Axel', hint: 'Kroppsdel' },
  { word: 'Tand', hint: 'Kroppsdel' },
  { word: 'Tumme', hint: 'Kroppsdel' },
  { word: 'Häl', hint: 'Kroppsdel' },

  /* Växter */
  { word: 'Kaktus', hint: 'Växt' },
  { word: 'Solros', hint: 'Växt' },
  { word: 'Björk', hint: 'Växt' },
  { word: 'Ormbunke', hint: 'Växt' },
  { word: 'Tusensköna', hint: 'Växt' },

  /* Instrument */
  { word: 'Gitarr', hint: 'Instrument' },
  { word: 'Trumma', hint: 'Instrument' },
  { word: 'Fiol', hint: 'Instrument' },
  { word: 'Trombon', hint: 'Instrument' },
  { word: 'Munspel', hint: 'Instrument' },

  /* Sagofigurer */
  { word: 'Drake', hint: 'Sagofigur' },
  { word: 'Häxa', hint: 'Sagofigur' },
  { word: 'Trollkarl', hint: 'Sagofigur' },
  { word: 'Sjöjungfru', hint: 'Sagofigur' },
  { word: 'Troll', hint: 'Sagofigur' },
  { word: 'Enhörning', hint: 'Sagofigur' },

  /* Skolsaker */
  { word: 'Suddgummi', hint: 'Skolsak' },
  { word: 'Linjal', hint: 'Skolsak' },
  { word: 'Whiteboard', hint: 'Skolsak' },
  { word: 'Pennvässare', hint: 'Skolsak' },
  { word: 'Skolväska', hint: 'Skolsak' }
];

const AVATARS = ['🦊', '🐼', '🐝', '🐸', '🦉', '🐙', '🐯', '🦄', '🐲', '🐨', '🐰', '🦁'];
const randomIndex = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

const ui = {
  root: null,
  step: 'setup', // setup | deal | table | reveal
  count: 4,
  names: [],
  hostWord: false,
  customWord: '',
  customHint: '',
  round: 1,
  index: 0,
  open: false,
  imposter: -1,
  secret: '',
  clue: '',
  imposterName: ''
};

/* ------------------------------ smådelar ------------------------------ */

const nameOf = (index) => (ui.names[index] || '').trim() || `Spelare ${index + 1}`;

const avatarOf = (index) => AVATARS[index % AVATARS.length];

function fillNames() {
  while (ui.names.length < ui.count) ui.names.push(`Spelare ${ui.names.length + 1}`);
  ui.names = ui.names.slice(0, ui.count);
}

/** Delar ut rollerna. Spelledaren (spelare 1) kan aldrig bli inposter när
    hen har valt ordet själv – hen sitter redan på svaret. */
function deal() {
  if (ui.hostWord) {
    const word = ui.customWord.trim();
    if (word.length < 2) {
      toast('Skriv ordet som spelarna ska gissa på', 'bad');
      return false;
    }
    ui.secret = word.slice(0, 40);
    ui.clue = ui.customHint.trim().slice(0, 60) || 'Spelledaren valde ordet';
    /* Inpostern dras bland de andra spelarna – spelledaren vet redan ordet. */
    ui.imposter = randomIndex(1, ui.count - 1);
  } else {
    const entry = IMPOSTER_WORDS[randomIndex(0, IMPOSTER_WORDS.length - 1)];
    ui.secret = entry.word;
    ui.clue = entry.hint;
    ui.imposter = randomIndex(0, ui.count - 1);
  }
  ui.imposterName = nameOf(ui.imposter);
  ui.index = 0;
  ui.open = false;
  ui.step = 'deal';
  return true;
}

/* ------------------------------ vyer ------------------------------ */

function setupHTML() {
  fillNames();
  const hostNote = ui.hostWord
    ? `<p class="imp__note">Spelledaren är <b>${esc(nameOf(0))}</b> – du väljer ordet själv och får det från
       start, så du kan inte bli inpostern. Alla andra kan bli det.</p>`
    : `<p class="imp__note">Ord och inposter slumpas. Vill du bestämma ordet själv? Slå på
       <b>Spelledaren väljer ordet</b>.</p>`;

  return `<div class="imp">
    <section class="rvb__panel imp__panel">
      <h2>Hur många är ni?</h2>
      <p class="rvb__panel-text">
        En spelare får en hemlig roll som <b>inposter</b>. Alla andra får samma ord – inpostern får bara
        en svår ledtråd. Sedan beskriver ni ordet med ett ord var och ska lista ut vem som bluffar.
      </p>

      <div class="imp__count">
        <button class="imp__step" data-act="dec" aria-label="Färre spelare">−</button>
        <div class="imp__count-value"><strong>${ui.count}</strong><span>spelare</span></div>
        <button class="imp__step" data-act="inc" aria-label="Fler spelare">+</button>
      </div>
      <p class="imp__hint">Minst ${IMPOSTER.MIN_PLAYERS} och högst ${IMPOSTER.MAX_PLAYERS} spelare. En telefon räcker –
        ni skickar den runt och var och en tittar på sitt kort.</p>

      <h3 class="imp__sub">Vilka spelar?</h3>
      <div class="imp__names">
        ${ui.names
          .map(
            (value, i) => `<label class="imp__name">
              <span class="imp__avatar">${avatarOf(i)}</span>
              <input class="input" data-name="${i}" maxlength="${IMPOSTER.NAME_MAX}" value="${esc(value)}"
                     placeholder="Spelare ${i + 1}" />
              ${i === 0 && ui.hostWord ? '<span class="imp__tag">spelledare</span>' : ''}
            </label>`
          )
          .join('')}
      </div>

      <div class="switch imp__switch">
        <div>
          <div class="switch__label">Spelledaren väljer ordet</div>
          <div class="switch__hint">Då får du skriva ordet själv – och du kan inte bli inpostern</div>
        </div>
        <div class="toggle ${ui.hostWord ? 'is-on' : ''}" data-act="toggle-host"></div>
      </div>

      ${
        ui.hostWord
          ? `<div class="imp__custom">
              <label class="field"><span>Ordet spelarna ska gissa på</span>
                <input class="input" id="imp-word" maxlength="40" value="${esc(ui.customWord)}" placeholder="T.ex. Zebra" /></label>
              <label class="field"><span>Ledtråd till inpostern (valfri)</span>
                <input class="input" id="imp-hint" maxlength="60" value="${esc(ui.customHint)}" placeholder="T.ex. Djur" /></label>
            </div>`
          : ''
      }
      ${hostNote}

      <div class="chip-row imp__chips">
        <span class="mini-pill">Ord i listan <strong>${IMPOSTER_WORDS.length}</strong></span>
        <span class="mini-pill">Inposter <strong>1</strong></span>
        <span class="mini-pill">Kostar <strong>0 kr</strong></span>
      </div>

      <button class="action-btn action-btn--deal imp__go" id="imp-start">🎭 Dela ut rollerna</button>

      <h3 class="imp__sub">Så spelar ni</h3>
      <ol class="imp__rules">
        <li>Skicka telefonen runt – var och en trycker fram sitt kort och håller rollen hemlig.</li>
        <li>Alla beskriver ordet med <b>ett enda ord</b>, i tur och ordning.</li>
        <li>Diskutera och rösta: vem tror ni är inpostern?</li>
        <li>Inpostern vinner om hen listar ut ordet – eller om ni röstar ut fel person.</li>
      </ol>
    </section>
  </div>`;
}

function dealHTML() {
  const name = nameOf(ui.index);
  const isImposter = ui.index === ui.imposter;
  const last = ui.index === ui.count - 1;

  const card = !ui.open
    ? `<div class="imp__give">
        <div class="imp__give-avatar">${avatarOf(ui.index)}</div>
        <h2>Ge telefonen till ${esc(name)}</h2>
        <p class="imp__hint">Ingen annan ska se skärmen. Tryck när du är redo.</p>
        <button class="action-btn action-btn--deal" id="imp-show">👀 Visa min roll</button>
      </div>`
    : isImposter
    ? `<div class="imp__card is-imposter">
        <span class="imp__card-tag">Hemlig roll</span>
        <h2>Du är inpostern</h2>
        <p class="imp__card-lead">Du får inte ordet – bara en svår ledtråd. Lyssna på de andra och lista ut ordet
          utan att avslöja dig.</p>
        <div class="imp__clue"><span>Ledtråd</span><strong>${esc(ui.clue)}</strong></div>
        <button class="action-btn action-btn--hit" id="imp-next">${last ? 'Alla har sett – börja spela' : 'Jag har sett – nästa'}</button>
      </div>`
    : `<div class="imp__card">
        <span class="imp__card-tag">Ditt ord</span>
        <div class="imp__word">${esc(ui.secret)}</div>
        <p class="imp__card-lead">Beskriv ordet med <b>ett enda ord</b> när det blir din tur – säg det inte rakt ut.</p>
        <button class="action-btn action-btn--deal" id="imp-next">${last ? 'Alla har sett – börja spela' : 'Jag har sett – nästa'}</button>
      </div>`;

  return `<div class="imp">
    <div class="imp__progress">
      <span class="mini-pill">Omgång <strong>${ui.round}</strong></span>
      <span class="mini-pill">Kort <strong>${ui.index + 1}/${ui.count}</strong></span>
      <span class="mini-pill">Inposter <strong>hemlig</strong></span>
      <div style="flex:1"></div>
      <button class="btn btn--sm btn--ghost" id="imp-reset">Avbryt</button>
    </div>
    ${card}
  </div>`;
}

function tableHTML() {
  return `<div class="imp">
    <div class="imp__progress">
      <span class="mini-pill">Omgång <strong>${ui.round}</strong></span>
      <span class="mini-pill">Spelare <strong>${ui.count}</strong></span>
      <span class="mini-pill">Ord <strong>hemligt</strong></span>
    </div>

    <section class="rvb__panel imp__panel">
      <h2>Alla har sett sina kort</h2>
      <p class="rvb__panel-text">
        Nu beskriver ni ordet med <b>ett ord var</b> – säg det inte rakt ut. Lyssna noga: den som är vag,
        tvekar eller råkar avslöja för mycket är ofta inpostern.
      </p>

      <div class="imp__players">
        ${ui.names
          .map(
            (value, i) => `<span class="imp__player"><span class="imp__avatar">${avatarOf(i)}</span>${esc(nameOf(i))}${
              i === 0 && ui.hostWord ? ' <small>spelledare</small>' : ''
            }</span>`
          )
          .join('')}
      </div>

      <div class="imp__steps">
        <div class="imp__step-card"><b>1</b><span>Ett ord var om ordet</span></div>
        <div class="imp__step-card"><b>2</b><span>Diskutera och rösta</span></div>
        <div class="imp__step-card"><b>3</b><span>Inpostern gissar ordet</span></div>
      </div>

      <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:18px">
        <button class="action-btn action-btn--deal" id="imp-reveal">🔎 Vem var inpostern?</button>
        <button class="btn btn--ghost" id="imp-again">↺ Spela igen</button>
        <button class="btn btn--ghost" id="imp-reset">Nytt spel</button>
      </div>
    </section>
  </div>`;
}

function revealHTML() {
  return `<div class="imp">
    <div class="imp__card is-reveal">
      <span class="imp__card-tag">Omgång ${ui.round} avgjord</span>
      <h2>Inpostern var ${esc(ui.imposterName)}</h2>
      <p class="imp__card-lead">Ordet alla andra hade:</p>
      <div class="imp__word">${esc(ui.secret)}</div>
      <p class="imp__card-lead">Inposterns ledtråd: <b>${esc(ui.clue)}</b></p>
      <div class="row" style="gap:10px;flex-wrap:wrap;justify-content:center">
        <button class="action-btn action-btn--deal" id="imp-again">↺ Spela igen</button>
        <button class="btn btn--ghost" id="imp-reset">Nytt spel</button>
      </div>
    </div>
  </div>`;
}

/* ------------------------------ målning ------------------------------ */

function bodyHTML() {
  if (ui.step === 'deal') return dealHTML();
  if (ui.step === 'table') return tableHTML();
  if (ui.step === 'reveal') return revealHTML();
  return setupHTML();
}

function paint() {
  const root = ui.root;
  if (!root) return;
  const body = root.querySelector('#imp-body');
  if (!body) return;
  body.innerHTML = bodyHTML();
  bind();
}

function repaint() {
  paint();
}

/* ------------------------------ händelser ------------------------------ */

function bind() {
  const root = ui.root;
  if (!root) return;

  root.querySelectorAll('[data-act]').forEach((el) =>
    el.addEventListener('click', () => {
      const act = el.dataset.act;
      if (act === 'inc' || act === 'dec') {
        const next = ui.count + (act === 'inc' ? 1 : -1);
        ui.count = Math.max(IMPOSTER.MIN_PLAYERS, Math.min(IMPOSTER.MAX_PLAYERS, next));
        fillNames();
        sfx.click();
        repaint();
        return;
      }
      if (act === 'toggle-host') {
        ui.hostWord = !ui.hostWord;
        sfx.click();
        repaint();
      }
    })
  );

  root.querySelectorAll('[data-name]').forEach((input) =>
    input.addEventListener('input', () => {
      ui.names[Number(input.dataset.name)] = input.value;
    })
  );

  const wordField = root.querySelector('#imp-word');
  if (wordField) wordField.addEventListener('input', () => (ui.customWord = wordField.value));
  const hintField = root.querySelector('#imp-hint');
  if (hintField) hintField.addEventListener('input', () => (ui.customHint = hintField.value));

  const on = (id, fn) => {
    const el = root.querySelector('#' + id);
    if (el) el.addEventListener('click', fn);
  };

  on('imp-start', () => {
    if (!deal()) return;
    sfx.deal();
    repaint();
  });

  on('imp-show', () => {
    ui.open = true;
    sfx.click();
    repaint();
  });

  on('imp-next', () => {
    ui.open = false;
    if (ui.index >= ui.count - 1) {
      ui.step = 'table';
      sfx.chip();
    } else {
      ui.index += 1;
    }
    repaint();
  });

  on('imp-reveal', () => {
    ui.step = 'reveal';
    sfx.win();
    repaint();
  });

  on('imp-again', () => {
    ui.round += 1;
    if (!deal()) {
      ui.step = 'setup';
      repaint();
      return;
    }
    sfx.deal();
    repaint();
  });

  on('imp-reset', () => {
    ui.step = 'setup';
    ui.round = 1;
    ui.index = 0;
    ui.open = false;
    ui.imposter = -1;
    sfx.click();
    repaint();
  });
}

/* ------------------------------ vyn ------------------------------ */

function renderImposter(root) {
  ui.root = root;
  root.innerHTML = `
    <div class="wrap">
      <div class="casino-top">
        <div class="casino-top__title">
          <h1>Inpostern</h1>
          <p>Ett ord, en bluff – och en telefon som skickas runt</p>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn--sm btn--ghost" id="imp-home">← Spelhallen</button>
      </div>
      <div id="imp-body"></div>
      <p class="tiny muted" style="margin:18px 0 30px">
        Sällskapsspel utan spelmynt. Rollerna delas ut på en och samma telefon – skicka den vidare och
        låt var och en titta själv.
      </p>
    </div>`;

  root.querySelector('#imp-home').addEventListener('click', () => {
    sfx.click();
    navigate('/kasino');
  });

  document.onkeydown = null;
  paint();
}

/** Inget att städa – spelet lever bara i klienten. */
export function stopImposter() {
  ui.root = null;
}

registerView('imposter', renderImposter);
