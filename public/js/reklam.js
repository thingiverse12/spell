/* =====================================================================
   Låtsasreklam: en påhittad annons som glider in över sidan och leder
   in till en egen annonssida. Allt är fejk – inga riktiga annonsörer,
   inga riktiga pengar, inga riktiga lån. Bonusen som delas ut är
   Plugghörnans vanliga spelmynt.
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, num, esc, navigate,
  updateBalanceUI, storage, hooks
} from './core.js';

const K = { ad: 'ph.reklam.ad', until: 'ph.reklam.until' };
const SNOOZE_MS = 45 * 60 * 1000; // annonsen vilar en stund efter att man stängt den

/* ------------------------------ Annonsörerna ------------------------------ */

export const ADS = [
  {
    id: 'snabbspin',
    brand: 'SNABBSPIN',
    brandSub: 'CASINO',
    theme: 'neon',
    emoji: '🎰',
    badge: 'Bara i dag',
    claim: 'GRATIS SPELMYNT',
    teaser: '20 gratissnurr utan insättning. Betalas ut på 0,3 sekunder.',
    cta: 'Öppna erbjudandet',
    steps: [
      ['1', 'Klicka på knappen', 'Ingen registrering, inget kort, ingen väntan.'],
      ['2', 'Mynten rasslar in', 'Vår påhittade utbetalningsrobot jobbar dygnet runt.'],
      ['3', 'Spela eller låt dem ligga', 'Du bestämmer helt själv vad mynten går till.']
    ],
    reviews: [
      ['Kevin, 17', 'Göteborg', 'Jag klickade och fick mynt direkt. Sjukt snabbt!', 5],
      ['Merve', 'Malmö', 'Bästa gratissnurren jag aldrig någonsin spelat.', 5],
      ['Roffe', 'Boden', 'Fick massa mynt och köpte ingenting. Grymt!', 4]
    ],
    fineprint: 'Bonusen är spelmynt från Plugghörnan och kan hämtas en gång var sjätte timme.'
  },
  {
    id: 'kryptokungen',
    brand: 'KRYPTOKUNGEN',
    brandSub: 'AI-HANDEL',
    theme: 'gold',
    emoji: '🪙',
    badge: 'Uppfunnet i natt',
    claim: 'DU ÄR MILJONÄR OM 3 MINUTER',
    teaser: 'Vår robot handlar medan du sover. Ingen kunskap krävs.*',
    cta: 'Starta roboten',
    steps: [
      ['1', 'Starta roboten', 'Den heter Börje och har aldrig förlorat ett mynt.'],
      ['2', 'Luta dig tillbaka', 'Roboten gör allt jobb medan du tittar på kattfilmer.'],
      ['3', 'Se siffrorna växa', 'Siffrorna är påhittade men känslan är äkta.']
    ],
    reviews: [
      ['Zlatan Jr', 'Rosengård', 'Börje fixade mitt liv på en kvart.', 5],
      ['Anki, 62', 'Trollhättan', 'Jag förstår inte vad som hände men det gick bra!', 5],
      ['Okände Sven', 'Okänd ort', 'Rekommenderas av 9 av 10 robotar.', 4]
    ],
    fineprint: '*Inga riktiga pengar, ingen riktig robot och ingen riktig börs är inblandad.'
  },
  {
    id: 'aiplugg',
    brand: 'AI-PLUGG',
    brandSub: 'PRO',
    theme: 'blue',
    emoji: '🧠',
    badge: 'Lärarnas fasa',
    claim: 'KLARA ALLA PROV UTAN ATT LÄSA',
    teaser: '47 hemliga knep som lärarna inte vill att du ska känna till.',
    cta: 'Ladda ner fusklappen',
    steps: [
      ['1', 'Ladda ner knepen', 'En PDF på 3 sidor som egentligen bara säger "plugga".'],
      ['2', 'Läs ingenting', 'Det går snabbt, för det finns inget att läsa.'],
      ['3', 'Få mynt ändå', 'Knepen ger dig spelmynt i stället för betyg.']
    ],
    reviews: [
      ['Ella, 15', 'Umeå', 'Jag lärde mig ingenting men fick 500 mynt.', 5],
      ['Studiemor', 'Uppsala', 'Äntligen något min son faktiskt klickar på.', 4],
      ['Lärare L', 'Sverige', 'Vi hatar verkligen det här. 5 stjärnor.', 5]
    ],
    fineprint: 'Knepen existerar inte. Det som existerar är den vanliga bonusen med spelmynt.'
  }
];

const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
const currentAd = () => ADS.find((ad) => ad.id === storage.get(K.ad, null)) || pickRandom(ADS);

/* ------------------------------ Annonsbannern ------------------------------ */

let banner = null;
let timer = null;
let autoHide = null;

export function hideAd({ snooze = false } = {}) {
  if (snooze) storage.set(K.until, Date.now() + SNOOZE_MS);
  clearTimeout(timer);
  clearTimeout(autoHide);
  timer = null;
  autoHide = null;
  if (!banner) return;
  const el = banner;
  banner = null;
  el.classList.add('is-closing');
  setTimeout(() => el.remove(), 260);
}

function openAd(ad) {
  storage.set(K.ad, ad.id);
  hideAd();
  sfx.click();
  navigate('/reklam');
}

function mountAd(ad) {
  if (banner || state.route.name === 'reklam') return;
  storage.set(K.ad, ad.id);

  const el = document.createElement('aside');
  el.className = `ad-pop ad-pop--${ad.theme}`;
  el.setAttribute('role', 'complementary');
  el.setAttribute('aria-label', 'Annons (påhittad)');
  el.innerHTML = `
    <div class="ad-pop__grain"></div>
    <div class="ad-pop__top">
      <span class="ad-pop__tag">Annons</span>
      <span class="ad-pop__fake">påhittad</span>
      <button class="ad-pop__close" type="button" aria-label="Stäng annonsen">✕</button>
    </div>
    <button class="ad-pop__body" type="button">
      <span class="ad-pop__emoji" aria-hidden="true">${ad.emoji}</span>
      <span class="ad-pop__brand">${esc(ad.brand)} <em>${esc(ad.brandSub)}</em></span>
      <span class="ad-pop__claim">${esc(ad.claim)}</span>
      <span class="ad-pop__teaser">${esc(ad.teaser)}</span>
      <span class="ad-pop__cta">${esc(ad.cta)} <span aria-hidden="true">→</span></span>
      <span class="ad-pop__dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </button>`;

  el.querySelector('.ad-pop__close').addEventListener('click', (e) => {
    e.stopPropagation();
    sfx.click();
    hideAd({ snooze: true });
  });
  el.querySelector('.ad-pop__body').addEventListener('click', () => openAd(ad));

  document.body.appendChild(el);
  banner = el;
  requestAnimationFrame(() => el.classList.add('is-in'));
  // Stjäl inte uppmärksamhet för länge – glider undan av sig själv.
  autoHide = setTimeout(() => hideAd({ snooze: true }), 22000);
}

export function showAd(delay = 2600) {
  if (banner) return;
  if (state.route.name === 'reklam' || state.route.name === 'admin') return;
  if (Date.now() < (Number(storage.get(K.until, 0)) || 0)) return;
  clearTimeout(timer);
  timer = setTimeout(() => mountAd(pickRandom(ADS)), delay);
}

/* ------------------------------ Annonssidan ------------------------------ */

let countdown = null;

function stopCountdown() {
  if (countdown) clearInterval(countdown);
  countdown = null;
}

function stars(count) {
  return '★★★★★'.slice(0, count) + '☆☆☆☆☆'.slice(0, 5 - count);
}

function clockText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function renderReklam(root) {
  stopCountdown();
  const ad = currentAd();
  const bonus = Math.round(Number(state.settings.dailyBonus) || 500);
  const viewers = 300 + Math.floor(Math.random() * 900);
  const deadline = Date.now() + 4 * 60 * 1000 + 59 * 1000;

  root.innerHTML = `
    <div class="ad-page ad-page--${ad.theme}">
      <div class="ad-page__glow" aria-hidden="true"></div>
      <div class="wrap ad-page__wrap">

        <div class="ad-page__bar">
          <span class="ad-pop__tag">Annons</span>
          <span class="ad-pop__fake">påhittad reklam · inga riktiga pengar</span>
          <span class="ad-page__viewers"><i class="ad-dot"></i> ${viewers} tittar nu</span>
        </div>

        <section class="ad-hero">
          <div class="ad-hero__left">
            <span class="ad-hero__badge">${esc(ad.badge)}</span>
            <div class="ad-hero__brand"><span aria-hidden="true">${ad.emoji}</span> ${esc(ad.brand)} <em>${esc(ad.brandSub)}</em></div>
            <h1 class="ad-hero__claim">${esc(ad.claim)}</h1>
            <p class="ad-hero__teaser">${esc(ad.teaser)}</p>
            <div class="ad-hero__actions">
              <button class="btn btn--primary ad-hero__cta" id="ad-claim">🎁 Hämta ${num(bonus)} spelmynt</button>
              <button class="btn btn--ghost" id="ad-back">Tillbaka till Plugghörnan</button>
            </div>
            <p class="ad-hero__note" id="ad-note">${esc(ad.fineprint)}</p>
          </div>

          <div class="ad-hero__right">
            <div class="ad-timer">
              <span class="ad-timer__label">Erbjudandet går ut om</span>
              <span class="ad-timer__clock" id="ad-clock">${clockText(deadline - Date.now())}</span>
              <span class="ad-timer__sub">Sedan blir det dyrare. Eller inte. Det är påhittat.</span>
            </div>
            <div class="ad-stamp">100 %<br><span>påhittat</span></div>
          </div>
        </section>

        <section class="ad-steps">
          ${ad.steps
            .map(
              ([n, title, text]) => `<div class="ad-step">
                <span class="ad-step__n">${n}</span>
                <h3>${esc(title)}</h3>
                <p>${esc(text)}</p>
              </div>`
            )
            .join('')}
        </section>

        <section class="ad-reviews">
          <h2>Riktiga omdömen från påhittade personer</h2>
          <div class="ad-reviews__grid">
            ${ad.reviews
              .map(
                ([name, city, text, rate]) => `<figure class="ad-review">
                  <div class="ad-review__stars">${stars(rate)}</div>
                  <blockquote>${esc(text)}</blockquote>
                  <figcaption>${esc(name)} · ${esc(city)}</figcaption>
                </figure>`
              )
              .join('')}
          </div>
        </section>

        <section class="ad-honest">
          <h2>Det här är en låtsasreklam</h2>
          <p>
            Annonsen finns bara för att testa annonsplatsen i Plugghörnan. Det finns ingen
            annonsör, ingen insättning, inget lån och inga riktiga pengar. Knappen delar ut
            <strong>${num(bonus)} spelmynt</strong> ur Plugghörnans vanliga bonus – precis samma
            mynt som du får på kontosidan.
          </p>
          <div class="ad-honest__actions">
            <button class="btn btn--primary" id="ad-back2">Tillbaka till Plugghörnan</button>
            <a class="btn btn--ghost" href="#/konto">Mitt konto</a>
          </div>
        </section>
      </div>
    </div>`;

  const clock = root.querySelector('#ad-clock');
  countdown = setInterval(() => {
    if (!root.contains(clock)) {
      stopCountdown();
      return;
    }
    const left = deadline - Date.now();
    clock.textContent = clockText(left);
    if (left <= 0) {
      clock.textContent = '00:00';
      clock.classList.add('is-out');
    }
  }, 1000);

  root.querySelector('#ad-back').addEventListener('click', () => {
    sfx.click();
    navigate('/');
  });
  root.querySelector('#ad-back2').addEventListener('click', () => {
    sfx.click();
    navigate('/');
  });

  const claimBtn = root.querySelector('#ad-claim');
  const note = root.querySelector('#ad-note');
  claimBtn.addEventListener('click', async () => {
    if (claimBtn.disabled) return;
    claimBtn.disabled = true;
    claimBtn.textContent = 'Hämtar …';
    try {
      const result = await api.bonus();
      const got = Math.round(Number(result && result.bonus) || bonus);
      updateBalanceUI();
      sfx.bigWin();
      toast(`🎉 ${num(got)} spelmynt insatta på kontot!`, 'gold', 3200);
      claimBtn.textContent = `✓ ${num(got)} mynt insatta`;
      claimBtn.classList.add('is-done');
      note.innerHTML = `Klart! Mynten ligger på ditt konto. ${esc(ad.fineprint)}`;
    } catch (err) {
      const wait = Number((err && err.data && err.data.nextIn) || (err && err.nextIn)) || 0;
      claimBtn.disabled = false;
      claimBtn.textContent = '🎁 Försök igen';
      const when = wait > 0
        ? `Ny bonus om ${Math.max(1, Math.ceil(wait / 60000))} min.`
        : 'Försök igen om en stund.';
      note.innerHTML = `<strong>Bonusen är redan hämtad.</strong> ${esc(when)} ${esc(ad.fineprint)}`;
      toast('Bonusen är redan hämtad', 'bad');
    }
  });
}

registerView('reklam', renderReklam);

/* ------------------------------ Start ------------------------------ */

export function initReklam() {
  const previous = hooks.onRoute;
  hooks.onRoute = (route) => {
    previous?.(route);
    if (route.name === 'reklam') {
      hideAd();
      return;
    }
    stopCountdown();
  };
  showAd(2600);
}
