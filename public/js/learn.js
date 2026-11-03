/* =====================================================================
   Täckmanteln: studeappen. Matte, engelska och svenska.
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, kr, num, esc, storage, navigate, openModal, updateBalanceUI,
  avatarLetter, renderRoute, confirmModal
} from './core.js';
import { avatarHTML, roomHTML } from './look.js';
import {
  CONTINENTS, CONTINENT_KEYS, CONTINENT_NAMES, ALL_COUNTRIES, ALL_CITIES, continentName
} from './geo-data.js';

/* ------------------------------ Statistik ------------------------------ */

const COUNTRY_KEY = ['asien', 'europa', 'amerika', 'afrika', 'blandat'];

const DEFAULT_STATS = {
  subjects: {
    matte: { correct: 0, total: 0 },
    engelska: { correct: 0, total: 0 },
    svenska: { correct: 0, total: 0 },
    geografi: { correct: 0, total: 0 }
  },
  geo: COUNTRY_KEY.reduce((acc, key) => {
    acc[key] = { correct: 0, total: 0 };
    return acc;
  }, {}),
  streak: 0,
  bestStreak: 0,
  dailyCount: 0,
  dailyDate: '',
  sessions: 0,
  totalCorrect: 0,
  totalAnswered: 0
};

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getStats() {
  const saved = storage.get('ph.learn', null) || {};
  const savedGeo = saved.geo || {};
  return {
    ...DEFAULT_STATS,
    ...saved,
    subjects: { ...DEFAULT_STATS.subjects, ...(saved.subjects || {}) },
    geo: COUNTRY_KEY.reduce((acc, key) => {
      acc[key] = { ...DEFAULT_STATS.geo[key], ...(savedGeo[key] || {}) };
      return acc;
    }, {})
  };
}

function saveStats(next) {
  storage.set('ph.learn', next);
}

function recordAnswer(subject, correct, continent, coins = 0) {
  const stats = getStats();
  const key = stats.subjects[subject] ? subject : 'matte';
  const slot = stats.subjects[key] || { correct: 0, total: 0 };
  slot.total += 1;
  if (correct) slot.correct += 1;
  stats.subjects[key] = slot;
  if (continent && stats.geo[continent]) {
    const geoSlot = stats.geo[continent];
    geoSlot.total += 1;
    if (correct) geoSlot.correct += 1;
    stats.geo[continent] = geoSlot;
  }
  stats.totalAnswered += 1;
  if (correct) {
    stats.totalCorrect += 1;
    stats.streak += 1;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  } else {
    stats.streak = 0;
  }
  if (stats.dailyDate !== todayKey()) {
    stats.dailyDate = todayKey();
    stats.dailyCount = 0;
  }
  stats.dailyCount += 1;
  saveStats(stats);

  // Varje svar hamnar i studieloggen, så eleven kan se vad hen gjort.
  api.studyEvent({ subject: stats.subjects[subject] ? subject : 'utmaning', correct, coins: correct ? coins : 0 });

  return stats;
}

/* ------------------------------ Ämnen ------------------------------ */

const SUBJECTS = {
  matte: { name: 'Matematik', icon: '➗', cls: 'math', text: 'Räkna, procent, bråk och ekvationer i din takt.' },
  engelska: { name: 'Engelska', icon: '📘', cls: 'eng', text: 'Glosor, grammatik och ordkunskap inför proven.' },
  svenska: { name: 'Svenska', icon: '✏️', cls: 'swe', text: 'Ordklasser, stavning och läsförståelse.' },
  geografi: { name: 'Geografi', icon: '🌍', cls: 'geo', text: 'Världsdelar, länder, huvudstäder och städer.' },
  utmaning: { name: 'Dagens utmaning', icon: '🎯', cls: 'mix', text: 'Blandade frågor från alla ämnena.' }
};

/* ------------------------------ Frågebank ------------------------------ */

function uniqueOptions(correct, generator) {
  const options = [correct];
  let guard = 0;
  while (options.length < 4 && guard < 80) {
    const candidate = generator();
    if (!options.includes(candidate) && candidate !== correct) options.push(candidate);
    guard++;
  }
  while (options.length < 4) options.push(correct + options.length * 3 + 1);
  return options;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuestion(prompt, options, correctValue, hint) {
  const shuffled = shuffleArray(options);
  return { q: prompt, options: shuffled, a: shuffled.indexOf(correctValue), hint };
}

const int = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function mathQuestion(level) {
  const kinds =
    level < 3 ? ['add', 'sub', 'mul'] :
    level < 6 ? ['add', 'sub', 'mul', 'div', 'compare'] :
    ['mul', 'div', 'percent', 'frac', 'equation', 'compare'];
  const kind = kinds[int(0, kinds.length - 1)];

  if (kind === 'add') {
    const a = int(6, level > 5 ? 240 : 60);
    const b = int(4, level > 5 ? 180 : 50);
    const correct = a + b;
    return buildQuestion(`${a} + ${b} = ?`, uniqueOptions(correct, () => correct + int(-12, 12)), correct, `${a} + ${b} blir ${correct}.`);
  }
  if (kind === 'sub') {
    const a = int(20, level > 5 ? 300 : 90);
    const b = int(3, a - 1);
    const correct = a - b;
    return buildQuestion(`${a} − ${b} = ?`, uniqueOptions(correct, () => correct + int(-10, 10)), correct, `${a} − ${b} blir ${correct}.`);
  }
  if (kind === 'mul') {
    const a = int(2, level > 5 ? 12 : 9);
    const b = int(2, level > 5 ? 12 : 9);
    const correct = a * b;
    return buildQuestion(`${a} × ${b} = ?`, uniqueOptions(correct, () => correct + int(-14, 14)), correct, `${a} × ${b} = ${correct}.`);
  }
  if (kind === 'div') {
    const b = int(2, 9);
    const correct = int(2, 12);
    const a = b * correct;
    return buildQuestion(`${a} ÷ ${b} = ?`, uniqueOptions(correct, () => correct + int(-4, 4)), correct, `${b} × ${correct} = ${a}, alltså är ${a} ÷ ${b} = ${correct}.`);
  }
  if (kind === 'percent') {
    const percent = [10, 20, 25, 50, 75][int(0, 4)];
    const base = int(2, 20) * 20;
    const correct = Math.round((percent / 100) * base);
    return buildQuestion(`Vad är ${percent} % av ${base}?`, uniqueOptions(correct, () => correct + int(-base / 10, base / 10) || correct + 5), correct, `${percent} % av ${base} = ${correct}.`);
  }
  if (kind === 'frac') {
    const denom = [2, 3, 4, 5][int(0, 3)];
    const numer = int(1, denom - 1);
    const base = denom * int(2, 12);
    const correct = (numer / denom) * base;
    return buildQuestion(`Vad är ${numer}/${denom} av ${base}?`, uniqueOptions(correct, () => correct + int(-base / 4, base / 4) || correct + 4), correct, `${base} ÷ ${denom} = ${base / denom}, gånger ${numer} = ${correct}.`);
  }
  if (kind === 'equation') {
    const x = int(2, 20);
    const b = int(2, 20);
    const ops = Math.random() < 0.5 ? '+' : '−';
    const result = ops === '+' ? x + b : x - b;
    const correct = x;
    return buildQuestion(`${ops === '+' ? `x + ${b} = ${result}` : `x − ${b} = ${result}`}. Vad är x?`, uniqueOptions(correct, () => correct + int(-6, 6)), correct, `Flytta över ${b} och räkna: x = ${correct}.`);
  }
  // compare
  const nums = [int(10, 999), int(10, 999), int(10, 999), int(10, 999)];
  const uniq = [...new Set(nums)];
  while (uniq.length < 4) uniq.push(int(1000, 9999));
  const options = uniq.slice(0, 4);
  const correct = Math.max(...options);
  return buildQuestion('Vilket tal är störst?', options, correct, `${correct} är störst av talen.`);
}

const ENGELSKA = [
  { q: 'Vad heter "äpple" på engelska?', options: ['Apple', 'Orange', 'Pear', 'Grape'], a: 0, hint: 'En vanlig frukt som ofta är röd eller grön.' },
  { q: 'Vad heter "skola" på engelska?', options: ['School', 'Schol', 'Skool', 'Scool'], a: 0, hint: 'Stavningen har "ch".' },
  { q: 'Vilket ord betyder "glad"?', options: ['Happy', 'Angry', 'Tired', 'Hungry'], a: 0, hint: 'Motsatsen till ledsen.' },
  { q: 'Vad är plural av "child"?', options: ['Children', 'Childs', 'Childes', 'Childrens'], a: 0, hint: 'Ett oregelbundet plural.' },
  { q: 'Vad är plural av "mouse" (datormus)?', options: ['Mice', 'Mouses', 'Mices', 'Mouse'], a: 0, hint: 'Samma som för djuret.' },
  { q: 'Välj rätt form: "She ___ to school every day."', options: ['goes', 'go', 'going', 'gone'], a: 0, hint: 'Tredje person singular får -es.' },
  { q: 'Vad betyder "weather"?', options: ['Väder', 'Vatten', 'Vinter', 'Vägg'], a: 0, hint: 'Regn, sol och snö handlar om det.' },
  { q: 'Vilket ord är en preposition?', options: ['under', 'quickly', 'happy', 'jump'], a: 0, hint: 'Den beskriver var något är.' },
  { q: 'Vad heter "tack" på engelska?', options: ['Thank you', 'Please', 'Sorry', 'Welcome'], a: 0, hint: 'Säger man när man får något.' },
  { q: 'Välj rätt: "I have ___ apple."', options: ['an', 'a', 'the', 'some'], a: 0, hint: 'Ordet börjar med en vokal.' },
  { q: 'Vad betyder "library"?', options: ['Bibliotek', 'Bokhandel', 'Bokhylla', 'Läsning'], a: 0, hint: 'Där man lånar böcker.' },
  { q: 'Vad är dåtid av "eat"?', options: ['ate', 'eated', 'eaten', 'eating'], a: 0, hint: 'Oregelbundet verb.' },
  { q: 'Vad betyder "neighbour"?', options: ['Granne', 'Näsa', 'Näbb', 'Nerv'], a: 0, hint: 'Personen som bor bredvid dig.' },
  { q: 'Vilket ord betyder "snabb"?', options: ['Fast', 'Slow', 'Late', 'Weak'], a: 0, hint: 'Motsatsen till långsam.' },
  { q: 'Välj rätt fråga: ___ do you live?', options: ['Where', 'What', 'Who', 'When'], a: 0, hint: 'Frågar om plats.' },
  { q: 'Vad heter "onsdag" på engelska?', options: ['Wednesday', 'Wensday', 'Wednsday', 'Wendsday'], a: 0, hint: 'En lurig stavning med tyst d.' },
  { q: 'Vad betyder "expensive"?', options: ['Dyr', 'Billig', 'Stor', 'Tung'], a: 0, hint: 'Motsatsen till cheap.' },
  { q: 'Välj rätt: "They ___ playing football."', options: ['are', 'is', 'am', 'be'], a: 0, hint: 'Pluralform av "to be".' },
  { q: 'Vad heter "fisk" på engelska?', options: ['Fish', 'Fich', 'Fisch', 'Fisk'], a: 0, hint: 'Simmar i vattnet.' },
  { q: 'Vad betyder "breakfast"?', options: ['Frukost', 'Lunch', 'Middag', 'Mellanmål'], a: 0, hint: 'Måltiden på morgonen.' }
];

const SVENSKA = [
  { q: 'Vilken ordklass är "springa"?', options: ['Verb', 'Substantiv', 'Adjektiv', 'Adverb'], a: 0, hint: 'Den beskriver vad någon gör.' },
  { q: 'Vilken ordklass är "glad"?', options: ['Adjektiv', 'Verb', 'Substantiv', 'Pronomen'], a: 0, hint: 'Den beskriver hur något är.' },
  { q: 'Vad är synonym till "vacker"?', options: ['Vacker och grann', 'Ful', 'Trött', 'Snabb'], a: 0, hint: 'Ord med samma betydelse.' },
  { q: 'Vilket ord är rätt stavat?', options: ['Intressant', 'Intresant', 'Interessant', 'Intressannt'], a: 0, hint: 'Dubbelt s och dubbelt t.' },
  { q: 'Vad är motsatsen till "stor"?', options: ['Liten', 'Hög', 'Bred', 'Tung'], a: 0, hint: 'Motsatsord.' },
  { q: 'Vilken mening är korrekt?', options: ['Jag går till skolan.', 'Jag går till skolan igår.', 'Jag gå till skolan.', 'Jag går på skolan till.'], a: 0, hint: 'Presens av verbet "gå".' },
  { q: 'Vad kallas en person som skriver böcker?', options: ['Författare', 'Författning', 'Skrivare', 'Lärare'], a: 0, hint: 'Yrket som skriver romaner.' },
  { q: 'Vilken ordklass är "mycket"?', options: ['Adverb', 'Verb', 'Substantiv', 'Konjunktion'], a: 0, hint: 'Den beskriver mängd.' },
  { q: 'Vad är plural av "bil"?', options: ['Bilar', 'Bil', 'Bilarna', 'Bilens'], a: 0, hint: 'Lägg till ett -r.' },
  { q: 'Vilket tecken avslutar en fråga?', options: ['?', '.', '!', ','], a: 0, hint: 'Frågetecken.' },
  { q: 'Vad betyder "ordstäv"?', options: ['Ett bevingat ordspråk', 'Ett räkneord', 'En mening', 'Ett verb'], a: 0, hint: 'Som "bättre sent än aldrig".' },
  { q: 'Vilket ord är ett pronomen?', options: ['Hon', 'Hus', 'Hoppa', 'Hög'], a: 0, hint: 'Ersätter ett namn.' },
  { q: 'Stavning: hur skrivs talet 40?', options: ['Fyrtio', 'Fyrtiofyra', 'Förtio', 'Fyrtig'], a: 0, hint: 'Inte "fyrtio" med -a.' },
  { q: 'Vad är ett sammansatt ord?', options: ['Solsken', 'Sol', 'Skönt', 'Sola'], a: 0, hint: 'Två ord som satts ihop.' },
  { q: 'Vilken mening har rätt ordföljd?', options: ['Igår åt jag tårta.', 'Igår jag åt tårta.', 'Jag igår åt tårta.', 'Tårta igår åt jag inte.'], a: 0, hint: 'Verb på andra plats.' },
  { q: 'Vad kallas motsatsord?', options: ['Antonymer', 'Synonymer', 'Homonymer', 'Pronomen'], a: 0, hint: 'Som stor–liten.' },
  { q: 'Vilket ord är rätt stavat?', options: ['Dessutom', 'Desutom', 'Dess utom', 'Däsutom'], a: 0, hint: 'Skrivs ihop med dubbelt s.' },
  { q: 'Vad betyder "korrekt"?', options: ['Riktig', 'Fel', 'Otydlig', 'Snabb'], a: 0, hint: 'Motsatsen till fel.' },
  { q: 'Vilken ordklass är "och"?', options: ['Konjunktion', 'Adjektiv', 'Verb', 'Adverb'], a: 0, hint: 'Binder samman ord och satser.' },
  { q: 'Vad är rubriken i en text?', options: ['Textens titel', 'Textens slut', 'En bildtext', 'Ett stycke'], a: 0, hint: 'Står överst.' }
];

/* ------------------------------ Geografi ------------------------------ */

const GEO_MODES = ['capital', 'country', 'continent', 'capital', 'city', 'country', 'continent', 'capital', 'city', 'country'];

function geoCountriesFor(key) {
  if (key === 'blandat' || !CONTINENTS[key]) return ALL_COUNTRIES;
  return CONTINENTS[key].countries.map(([country, capital]) => ({ country, capital, continent: key }));
}

function geoCitiesFor(key) {
  if (key === 'blandat' || !CONTINENTS[key]) return ALL_CITIES;
  return CONTINENTS[key].cities.map(([city, country]) => ({ city, country, continent: key }));
}

function distract(correct, pool, count = 3) {
  const out = [];
  shuffleArray(pool).forEach((value) => {
    if (value !== correct && !out.includes(value) && out.length < count) out.push(value);
  });
  return out;
}

/** Frågor om länder, huvudstäder och städer i en världsdel (eller blandat). */
function geoQuestions(key, count = 10) {
  const countries = geoCountriesFor(key);
  const cities = geoCitiesFor(key);
  const capitals = countries.map((c) => c.capital);
  const countryNames = countries.map((c) => c.country);
  const out = [];
  const usedCountries = new Set();
  const usedCities = new Set();
  let guard = 0;

  while (out.length < count && guard < 400) {
    guard += 1;
    const mode = GEO_MODES[out.length % GEO_MODES.length];
    const pool = shuffleArray(countries);
    const pick = pool.find((c) => !usedCountries.has(c.country)) || pool[0];
    usedCountries.add(pick.country);

    if (mode === 'capital') {
      out.push(
        buildQuestion(
          `Vilken är huvudstaden i ${pick.country}?`,
          [pick.capital, ...distract(pick.capital, capitals)],
          pick.capital,
          `Huvudstaden i ${pick.country} är ${pick.capital}.`
        )
      );
    } else if (mode === 'country') {
      out.push(
        buildQuestion(
          `${pick.capital} är huvudstad i vilket land?`,
          [pick.country, ...distract(pick.country, countryNames)],
          pick.country,
          `${pick.capital} ligger i ${pick.country}.`
        )
      );
    } else if (mode === 'continent') {
      out.push(
        buildQuestion(
          `Vilken världsdel ligger ${pick.country} i?`,
          CONTINENT_NAMES.slice(),
          CONTINENTS[pick.continent].name,
          `${pick.country} ligger i ${CONTINENTS[pick.continent].name.toLowerCase()}.`
        )
      );
    } else {
      const city = shuffleArray(cities).find((c) => !usedCities.has(c.city));
      if (!city) continue;
      usedCities.add(city.city);
      out.push(
        buildQuestion(
          `I vilket land ligger staden ${city.city}?`,
          [city.country, ...distract(city.country, countryNames)],
          city.country,
          `${city.city} ligger i ${city.country}.`
        )
      );
    }
  }

  return out;
}

function subjectQuestions(subject, count = 10, continent = null) {
  const questions = [];
  if (subject === 'matte') {
    for (let i = 0; i < count; i++) questions.push(mathQuestion(i + 1));
    return questions;
  }
  if (subject === 'engelska' || subject === 'svenska') {
    const bank = subject === 'engelska' ? ENGELSKA : SVENSKA;
    const pool = shuffleArray(bank).slice(0, count);
    return pool.map((q) => buildQuestion(q.q, q.options, q.options[q.a], q.hint));
  }
  if (subject === 'geografi') {
    return geoQuestions(continent || 'blandat', count);
  }
  // utmaning: blandat – matte, engelska, svenska och geografi
  const geo = geoQuestions('blandat', Math.max(3, Math.ceil(count / 3)));
  const banks = [...shuffleArray(ENGELSKA), ...shuffleArray(SVENSKA)];
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) {
      questions.push(mathQuestion(i + 1));
    } else if (i % 3 === 1 && geo.length) {
      questions.push(geo.pop());
    } else {
      const q = banks.pop();
      questions.push(buildQuestion(q.q, q.options, q.options[q.a], q.hint));
    }
  }
  return questions;
}

/* ------------------------------ Quiz-motorn ------------------------------ */

const quiz = {
  subject: null,
  continent: null,
  questions: [],
  index: 0,
  correct: 0,
  coins: 0,
  answered: false,
  selected: null,
  streak: 0,
  finished: false
};

function startQuiz(subject, options = {}) {
  quiz.subject = subject;
  quiz.continent = options.continent || null;
  quiz.questions = subjectQuestions(subject, 10, quiz.continent);
  quiz.index = 0;
  quiz.correct = 0;
  quiz.coins = 0;
  quiz.answered = false;
  quiz.selected = null;
  quiz.streak = 0;
  quiz.finished = false;
}

function renderQuiz(root) {
  const subject = SUBJECTS[quiz.subject] || SUBJECTS.matte;
  const geoName = quiz.subject === 'geografi' ? continentName(quiz.continent) : '';
  const label = geoName ? `${subject.name} · ${geoName}` : subject.name;
  const q = quiz.questions[quiz.index];
  const total = quiz.questions.length;
  const reward = Number(state.settings.quizReward) || 25;

  if (quiz.finished) {
    const pct = Math.round((quiz.correct / total) * 100);
    const stars = pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 40 ? 1 : 0;
    root.innerHTML = `
      <div class="wrap">
        <div class="quiz">
          <div class="quiz__card center">
            <div style="font-size:44px;letter-spacing:6px">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
            <h2 style="margin:14px 0 6px;font-size:26px">Snyggt jobbat!</h2>
            <p class="muted">Du klarade ${quiz.correct} av ${total} frågor i ${geoName ? 'geografi – ' + geoName : subject.name.toLowerCase()}.</p>
            <div class="grid grid--3" style="margin:26px 0">
              <div class="stat-tile"><div class="stat-tile__value">${quiz.correct}/${total}</div><div class="stat-tile__label">Rätt svar</div></div>
              <div class="stat-tile"><div class="stat-tile__value">${pct} %</div><div class="stat-tile__label">Träffsäkerhet</div></div>
              <div class="stat-tile"><div class="stat-tile__value">+${num(quiz.coins)} kr</div><div class="stat-tile__label">Intjänade mynt</div></div>
            </div>
            <div class="row" style="justify-content:center;flex-wrap:wrap">
              <button class="btn btn--primary" id="quiz-again">Kör igen</button>
              <button class="btn btn--ghost" id="quiz-home">Till startsidan</button>
              ${quiz.subject !== 'utmaning' ? `<button class="btn btn--mint" id="quiz-next-subject">${quiz.subject === 'geografi' ? 'Byt världsdel' : 'Byt ämne'}</button>` : ''}
            </div>
          </div>
        </div>
      </div>`;

    root.querySelector('#quiz-again').addEventListener('click', () => {
      startQuiz(quiz.subject, { continent: quiz.continent });
      renderQuiz(root);
    });
    root.querySelector('#quiz-home').addEventListener('click', () => navigate('/'));
    const other = root.querySelector('#quiz-next-subject');
    if (other) {
      other.addEventListener('click', () => {
        if (quiz.subject === 'geografi') {
          navigate('/geografi');
          return;
        }
        const order = ['matte', 'engelska', 'svenska'];
        const next = order[(order.indexOf(quiz.subject) + 1) % order.length];
        navigate('/' + next);
      });
    }
    return;
  }

  root.innerHTML = `
    <div class="wrap">
      <div class="quiz">
        <div class="quiz__top">
          <button class="btn btn--sm btn--ghost" id="quiz-exit">← Avbryt</button>
          <div class="quiz__progress">
            <div class="row row--between tiny muted" style="margin-bottom:6px">
              <span>${esc(label)}</span>
              <span>Fråga ${quiz.index + 1} av ${total}</span>
            </div>
            <div class="progress"><div class="progress__bar" style="width:${(quiz.index / total) * 100}%"></div></div>
          </div>
          <span class="chip chip--amber">🔥 ${quiz.streak}</span>
        </div>

        <div class="quiz__card">
          <div class="quiz__prompt">${esc(label)}</div>
          <h2 class="quiz__question">${esc(q.q)}</h2>
          <div class="quiz__options" id="quiz-options">
            ${q.options
              .map(
                (opt, i) => `<button class="option" data-index="${i}">
                  <span class="option__key">${'ABCD'[i]}</span>
                  <span>${esc(opt)}</span>
                </button>`
              )
              .join('')}
          </div>
          <div id="quiz-feedback"></div>
          <div class="quiz__foot">
            <span class="tiny muted">Rätt svar ger <b>${kr(reward)}</b> i spelmynt</span>
            <button class="btn btn--primary hide" id="quiz-next">Nästa →</button>
          </div>
        </div>
      </div>
    </div>`;

  root.querySelector('#quiz-exit').addEventListener('click', () => {
    sfx.click();
    navigate(quiz.subject === 'geografi' ? '/geografi' : '/');
  });

  const optionEls = Array.from(root.querySelectorAll('.option'));
  optionEls.forEach((btn) => {
    btn.addEventListener('click', () => answer(Number(btn.dataset.index), root));
  });

  const nextBtn = root.querySelector('#quiz-next');
  nextBtn.addEventListener('click', () => {
    sfx.click();
    quiz.index += 1;
    quiz.answered = false;
    quiz.selected = null;
    if (quiz.index >= quiz.questions.length) {
      quiz.finished = true;
      const stats = getStats();
      stats.sessions += 1;
      saveStats(stats);
    }
    renderQuiz(root);
  });

  document.onkeydown = (e) => {
    if (document.body.classList.contains('theme-casino')) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (['1', '2', '3', '4'].includes(e.key) && !quiz.answered) {
      answer(Number(e.key) - 1, root);
    }
    if (e.key === 'Enter' && quiz.answered) {
      nextBtn.click();
    }
  };
}

function answer(selected, root) {
  if (quiz.answered) return;
  const q = quiz.questions[quiz.index];
  const correct = selected === q.a;
  quiz.answered = true;
  quiz.selected = selected;

  const optionEls = Array.from(root.querySelectorAll('.option'));
  optionEls.forEach((el, i) => {
    el.disabled = true;
    if (i === q.a) el.classList.add('is-correct');
    if (i === selected && !correct) el.classList.add('is-wrong');
  });

  const feedback = root.querySelector('#quiz-feedback');
  const reward = Number(state.settings.quizReward) || 25;

  if (correct) {
    quiz.correct += 1;
    quiz.streak += 1;
    quiz.coins += reward;
    sfx.correct();
    feedback.innerHTML = `<div class="quiz__feedback quiz__feedback--ok">
      <span>✅</span><div><b>Rätt!</b> ${esc(q.hint)} <br><span class="tiny">+${kr(reward)} i spelmynt</span></div>
    </div>`;
    api.credit('quiz', reward).then((balance) => {
      updateBalanceUI();
      if (balance != null) state.player.balance = balance;
    }).catch(() => {});
  } else {
    quiz.streak = 0;
    sfx.wrong();
    feedback.innerHTML = `<div class="quiz__feedback quiz__feedback--no">
      <span>💡</span><div><b>Nästan!</b> Rätt svar är <b>${esc(q.options[q.a])}</b>. ${esc(q.hint)}</div>
    </div>`;
  }

  recordAnswer(quiz.subject, correct, quiz.continent, correct ? reward : 0);
  const nextBtn = root.querySelector('#quiz-next');
  nextBtn.classList.remove('hide');
  nextBtn.textContent = quiz.index + 1 >= quiz.questions.length ? 'Visa resultat →' : 'Nästa →';
  nextBtn.focus();
}

/* ------------------------------ Vyer ------------------------------ */

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'God natt';
  if (h < 11) return 'God morgon';
  if (h < 17) return 'Hej';
  return 'God kväll';
}

function dailyGoal() {
  const stats = getStats();
  return {
    done: stats.dailyDate === todayKey() ? stats.dailyCount : 0,
    goal: 10
  };
}

function subjectProgress(key) {
  const stats = getStats();
  const s = stats.subjects[key] || { correct: 0, total: 0 };
  if (!s.total) return 0;
  return Math.round((s.correct / s.total) * 100);
}

function renderHome(root) {
  const stats = getStats();
  const goal = dailyGoal();
  const pct = Math.min(100, Math.round((goal.done / goal.goal) * 100));
  const dateText = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
  const name = state.player?.name || 'gäst';
  const accuracy = stats.totalAnswered ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;

  root.innerHTML = `
    <div class="wrap">
      <div class="hero">
        <div>
          <span class="hero__eyebrow">${esc(dateText)}</span>
          <h1>${greeting()} ${esc(name)}! Klar för dagens plugg?</h1>
          <p>Träna tio frågor om dagen i matte, engelska, svenska och geografi. Du får spelmynt för varje rätt svar som du kan använda i belöningsspelet.</p>
          <div class="hero__actions">
            <button class="btn btn--primary btn--lg" data-go="/matte">Fortsätt: Matematik</button>
            <button class="btn" data-go="/utmaning">Dagens utmaning</button>
          </div>
        </div>
        <div class="hero__ring" style="--p:${pct}%">
          <div class="hero__ring-inner">
            <strong>${goal.done}/${goal.goal}</strong>
            <span>dagens mål</span>
          </div>
        </div>
      </div>

      ${state.broadcast ? `<div class="banner-strip" style="margin-top:18px"><span>📢</span><span>${esc(state.broadcast)}</span></div>` : ''}

      ${state.player && !state.player.hasPin
        ? `<div class="banner-strip" style="margin-top:18px;background:var(--accent-soft);color:var(--accent);border-color:transparent">
             <span>✨</span>
             <span style="flex:1">Skapa ett konto med namn och PIN så sparas saldo och vinster – även på mobilen.</span>
             <button class="btn btn--sm btn--primary" data-go="/konto">Skapa konto</button>
           </div>`
        : ''}

      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Dina ämnen</h2>
            <p class="section__sub">Välj ett ämne och kör tio frågor – geografin har fyra världsdelar.</p>
          </div>
          <button class="btn btn--sm btn--ghost" data-go="/framsteg">Se framsteg</button>
        </div>
        <div class="grid grid--2">
          ${Object.entries(SUBJECTS)
            .filter(([key]) => key !== 'utmaning')
            .map(([key, s]) => {
              const p = subjectProgress(key);
              const st = stats.subjects[key] || { correct: 0, total: 0 };
              return `<button class="subject-card subject-card--${s.cls}" data-go="/${key}">
                <div class="subject-card__icon">${s.icon}</div>
                <h3>${s.name}</h3>
                <p>${s.text}</p>
                <div class="progress"><div class="progress__bar" style="width:${p}%"></div></div>
                <div class="subject-card__meta">
                  <span>${st.correct} rätt av ${st.total}</span>
                  <span>${p} %</span>
                </div>
              </button>`;
            })
            .join('')}
        </div>
      </section>

      <section class="section" style="padding-top:0">
        <div class="home-look">
          <div class="home-look__me">
            ${avatarHTML(state.player?.look, { size: 'lg' })}
            <div>
              <span class="home-look__eyebrow">Din hörna</span>
              <h2 class="home-look__title">${esc(state.player?.name || 'Gäst')}</h2>
              <p class="home-look__text">Byt figur, färg och accessoar – eller möblera rummet med mynt du tjänat.</p>
              <button class="btn btn--sm btn--primary" data-go="/atelje">🎨 Öppna ateljén</button>
            </div>
          </div>
          <div class="home-look__room">${roomHTML(state.player?.look, { className: 'home-look__room-inner' })}</div>
          <div class="home-look__stats">
            <div class="stat-tile"><div class="stat-tile__value">${kr(state.player?.balance ?? 0)}</div><div class="stat-tile__label">Spelmynt</div></div>
            <div class="stat-tile"><div class="stat-tile__value">${stats.totalCorrect}</div><div class="stat-tile__label">Rätt svar</div></div>
          </div>
        </div>
      </section>

      <section class="section" style="padding-top:0">
        <div class="grid grid--4">
          <div class="stat-tile"><div class="stat-tile__value">${stats.totalCorrect}</div><div class="stat-tile__label">Rätt svar totalt</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${accuracy} %</div><div class="stat-tile__label">Träffsäkerhet</div></div>
          <div class="stat-tile"><div class="stat-tile__value">🔥 ${stats.streak}</div><div class="stat-tile__label">Nuvarande streak</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${kr(state.player?.balance ?? 0)}</div><div class="stat-tile__label">Dina spelmynt</div></div>
        </div>
      </section>
    </div>`;

  root.querySelectorAll('[data-go]').forEach((el) => {
    el.addEventListener('click', () => {
      sfx.click();
      navigate(el.dataset.go);
    });
  });
}

function renderSubject(subject) {
  return (root) => {
    if (quiz.subject !== subject || quiz.finished || !quiz.questions.length) startQuiz(subject);
    renderQuiz(root);
  };
}

function renderGeografi(root, route) {
  const key = route && route.parts ? route.parts[1] : '';
  const valid = key === 'blandat' || (key && CONTINENTS[key]);

  if (valid) {
    if (quiz.subject !== 'geografi' || quiz.continent !== key || quiz.finished || !quiz.questions.length) {
      startQuiz('geografi', { continent: key });
    }
    renderQuiz(root);
    return;
  }

  const stats = getStats();
  const rows = CONTINENT_KEYS.map((ck) => {
    const c = CONTINENTS[ck];
    const g = (stats.geo && stats.geo[ck]) || { correct: 0, total: 0 };
    const pct = g.total ? Math.round((g.correct / g.total) * 100) : 0;
    return { key: ck, name: c.name, icon: c.icon, note: c.note, count: c.countries.length, ...g, pct };
  });
  const mixed = (stats.geo && stats.geo.blandat) || { correct: 0, total: 0 };
  const mixedPct = mixed.total ? Math.round((mixed.correct / mixed.total) * 100) : 0;

  root.innerHTML = `
    <div class="wrap">
      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Geografi</h2>
            <p class="section__sub">Välj en världsdel och träna på länderna, huvudstäderna och städerna som hör dit.</p>
          </div>
          <button class="btn btn--sm btn--ghost" data-go="/">← Tillbaka</button>
        </div>

        <div class="grid grid--2">
          ${rows
            .map(
              (r) => `<button class="subject-card subject-card--geo" data-go="/geografi/${r.key}">
                <div class="subject-card__icon">${r.icon}</div>
                <h3>${r.name}</h3>
                <p>${r.note}</p>
                <div class="progress"><div class="progress__bar" style="width:${r.pct}%"></div></div>
                <div class="subject-card__meta">
                  <span>${r.count} länder · ${r.correct} rätt av ${r.total}</span>
                  <span>${r.pct} %</span>
                </div>
              </button>`
            )
            .join('')}
          <button class="subject-card subject-card--geo" data-go="/geografi/blandat">
            <div class="subject-card__icon">🌍</div>
            <h3>Blandat</h3>
            <p>Frågor från alla världsdelar – bra inför provet.</p>
            <div class="progress"><div class="progress__bar" style="width:${mixedPct}%"></div></div>
            <div class="subject-card__meta">
              <span>Alla länder · ${mixed.correct} rätt av ${mixed.total}</span>
              <span>${mixedPct} %</span>
            </div>
          </button>
        </div>

        <div class="panel" style="padding:22px;margin-top:18px">
          <h3 style="font-size:16px;margin-bottom:8px">Vad du tränar på</h3>
          <p class="small muted">Varje pass har tio frågor. Du får fyra sorters frågor: vilken <b>världsdel</b> ett land ligger i,
          vilken <b>huvudstad</b> ett land har, vilket <b>land</b> en huvudstad hör till och i vilket land en <b>stad</b> ligger.
          Rätt svar ger spelmynt, precis som i de andra ämnena.</p>
        </div>
      </section>
    </div>`;

  root.querySelectorAll('[data-go]').forEach((el) =>
    el.addEventListener('click', () => {
      sfx.click();
      navigate(el.dataset.go);
    })
  );
}

function renderFramsteg(root) {
  const stats = getStats();
  const accuracy = stats.totalAnswered ? Math.round((stats.totalCorrect / stats.totalAnswered) * 100) : 0;

  root.innerHTML = `
    <div class="wrap">
      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Mina framsteg</h2>
            <p class="section__sub">Allt sparas automatiskt i din profil.</p>
          </div>
          <button class="btn btn--sm btn--ghost" data-go="/">← Tillbaka</button>
        </div>

        <div class="grid grid--4" style="margin-bottom:24px">
          <div class="stat-tile"><div class="stat-tile__value">${stats.totalAnswered}</div><div class="stat-tile__label">Frågor besvarade</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${accuracy} %</div><div class="stat-tile__label">Träffsäkerhet</div></div>
          <div class="stat-tile"><div class="stat-tile__value">🚀 ${stats.bestStreak}</div><div class="stat-tile__label">Bästa streak</div></div>
          <div class="stat-tile"><div class="stat-tile__value">${stats.sessions}</div><div class="stat-tile__label">Avslutade pass</div></div>
        </div>

        <div class="panel" style="padding:22px">
          <h3 style="font-size:16px;margin-bottom:16px">Per ämne</h3>
          ${['matte', 'engelska', 'svenska', 'geografi']
            .map((key) => {
              const s = stats.subjects[key] || { correct: 0, total: 0 };
              const p = s.total ? Math.round((s.correct / s.total) * 100) : 0;
              return `<div style="margin-bottom:18px">
                <div class="row row--between" style="margin-bottom:7px">
                  <span style="font-weight:700">${SUBJECTS[key].icon} ${SUBJECTS[key].name}</span>
                  <span class="small muted">${s.correct}/${s.total} · ${p} %</span>
                </div>
                <div class="progress"><div class="progress__bar" style="width:${p}%"></div></div>
              </div>`;
            })
            .join('')}
        </div>

        <div class="grid grid--2" style="margin-top:18px">
          <div class="panel" style="padding:22px">
            <h3 style="font-size:16px;margin-bottom:8px">Så funkar mynten</h3>
            <p class="small muted">Varje rätt svar ger ${kr(state.settings.quizReward || 25)} i spelmynt. Mynten används bara i appens belöningsspel – de är aldrig värda riktiga pengar och kan inte tas ut.</p>
          </div>
          <div class="panel" style="padding:22px">
            <h3 style="font-size:16px;margin-bottom:8px">Ditt konto</h3>
            <p class="small muted">Du spelar som <b>${esc(state.player?.name || 'gäst')}</b>. Öppna din profil för att byta namn eller låsa kontot med en PIN-kod.</p>
            <button class="btn btn--sm btn--primary" data-go="/profil" style="margin-top:12px">Öppna profil</button>
          </div>
        </div>
      </section>
    </div>`;

  root.querySelectorAll('[data-go]').forEach((el) =>
    el.addEventListener('click', () => navigate(el.dataset.go))
  );
}

function renderKonto(root) {
  const p = state.player || {};
  const isGuest = !p.hasPin;
  const stats = getStats();
  const won = Math.max(0, Math.round(p.won || 0));
  const biggest = Math.max(0, Math.round(p.biggestWin || 0));
  const net = Math.round((p.won || 0) - (p.wagered || 0));

  root.innerHTML = `
    <div class="wrap">
      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Mitt konto</h2>
            <p class="section__sub">Med ett konto sparas saldo, vinster och framsteg – även på en annan enhet.</p>
          </div>
          <button class="btn btn--sm btn--ghost" data-go="/">← Tillbaka</button>
        </div>

        <div class="grid grid--2">
          <div class="panel" style="padding:24px">
            <div class="row" style="gap:14px;margin-bottom:18px">
              <div class="avatar" style="width:54px;height:54px;font-size:21px;padding:0;background:none">${avatarHTML(p.look, { size: 'lg' })}</div>
              <div>
                <h3 style="font-size:18px">${esc(p.name || 'Gäst')}</h3>
                <div class="wrap-gap" style="margin-top:6px">
                  ${isGuest
                    ? '<span class="chip chip--amber">Gästkonto</span>'
                    : '<span class="chip chip--mint">🔐 Konto med PIN</span>'}
                  <span class="chip">${kr(p.balance ?? 0)}</span>
                </div>
              </div>
            </div>

            ${isGuest
              ? `<h3 style="font-size:16px;margin-bottom:6px">Skapa konto</h3>
                 <p class="small muted" style="margin-bottom:16px">Välj ett namn och en fyrsiffrig PIN-kod. Ditt saldo och dina framsteg flyttas med.</p>
                 <label class="field"><span>Namn</span>
                   <input class="input" id="reg-name" maxlength="24" placeholder="T.ex. Vincent" value="${esc(p.name && !/^Gäst/.test(p.name) ? p.name : '')}" />
                 </label>
                 <label class="field"><span>PIN-kod (4 siffror)</span>
                   <input class="input" id="reg-pin" inputmode="numeric" maxlength="4" placeholder="••••" />
                 </label>
                 <div id="reg-error"></div>
                 <button class="btn btn--primary btn--block" id="reg-btn">Skapa konto</button>`
              : `<p class="small" style="color:var(--text-soft);margin-bottom:16px">
                   Du är inloggad med namn och PIN. På en annan enhet loggar du in med
                   <b>${esc(p.name)}</b> och din PIN-kod.
                 </p>
                 <div class="row" style="gap:10px;flex-wrap:wrap">
                   <button class="btn btn--sm btn--ghost" id="logout-btn">Logga ut</button>
                 </div>`}

            <hr style="border:0;border-top:1px solid var(--line);margin:22px 0" />

            <h3 style="font-size:16px;margin-bottom:6px">Logga in på ett annat konto</h3>
            <p class="small muted" style="margin-bottom:14px">Använd namnet och PIN-koden du valde när kontot skapades.</p>
            <label class="field"><span>Namn</span><input class="input" id="login-name" placeholder="Ditt namn" /></label>
            <label class="field"><span>PIN</span><input class="input" id="login-pin" inputmode="numeric" maxlength="4" placeholder="••••" /></label>
            <button class="btn btn--sm btn--ghost" id="login-btn">Logga in</button>
          </div>

          <div>
            <div class="panel" style="padding:22px;margin-bottom:16px">
              <h3 style="font-size:16px;margin-bottom:14px">Dina vinster</h3>
              <div class="grid grid--2" style="gap:12px">
                <div class="stat-tile" style="background:var(--surface-2)">
                  <div class="stat-tile__value">${kr(won)}</div><div class="stat-tile__label">Vunnet totalt</div>
                </div>
                <div class="stat-tile" style="background:var(--surface-2)">
                  <div class="stat-tile__value">${kr(biggest)}</div><div class="stat-tile__label">Största vinst</div>
                </div>
                <div class="stat-tile" style="background:var(--surface-2)">
                  <div class="stat-tile__value">${kr(net)}</div><div class="stat-tile__label">Netto</div>
                </div>
                <div class="stat-tile" style="background:var(--surface-2)">
                  <div class="stat-tile__value">${p.rounds ?? 0}</div><div class="stat-tile__label">Rundor</div>
                </div>
              </div>
            </div>

            <div class="panel" style="padding:22px">
              <h3 style="font-size:16px;margin-bottom:12px">Plugghörnan</h3>
              <div class="row row--between" style="margin-bottom:8px"><span class="small muted">Rätt svar</span><b>${stats.totalCorrect}</b></div>
              <div class="row row--between" style="margin-bottom:8px"><span class="small muted">Bästa streak</span><b>🔥 ${stats.bestStreak}</b></div>
              <div class="switch" style="margin-top:8px">
                <div><div class="switch__label">Ljud</div><div class="switch__hint">Klick och vinster</div></div>
                <div class="toggle ${state.muted ? '' : 'is-on'}" id="toggle-sound"></div>
              </div>
              <p class="tiny muted" style="margin-top:14px">Alla mynt är påhittade och har inget värde.
              <br /><span class="tiny">Tips: spader-symbolen ♠ i logotypen gillar att bli klickad tre gånger.</span></p>
            </div>
          </div>
        </div>
      </section>
    </div>`;

  root.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => navigate(el.dataset.go)));

  const regBtn = root.querySelector('#reg-btn');
  if (regBtn) {
    regBtn.addEventListener('click', async () => {
      const name = root.querySelector('#reg-name').value.trim();
      const pin = root.querySelector('#reg-pin').value.trim();
      const errBox = root.querySelector('#reg-error');
      errBox.innerHTML = '';
      if (name.length < 2) {
        errBox.innerHTML = '<p class="quiz__feedback quiz__feedback--no" style="margin-bottom:14px">Namnet måste vara minst två tecken.</p>';
        return;
      }
      if (!/^\d{4}$/.test(pin)) {
        errBox.innerHTML = '<p class="quiz__feedback quiz__feedback--no" style="margin-bottom:14px">PIN-koden måste vara fyra siffror.</p>';
        return;
      }
      regBtn.disabled = true;
      try {
        await api.register(name, pin);
        sfx.correct();
        toast('Konto skapat – välkommen!', 'ok');
        updateBalanceUI();
        renderRoute();
      } catch (err) {
        sfx.wrong();
        errBox.innerHTML = `<p class="quiz__feedback quiz__feedback--no" style="margin-bottom:14px">${esc(err.message)}</p>`;
      } finally {
        regBtn.disabled = false;
      }
    });
  }

  const logoutBtn = root.querySelector('#logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      const ok = await confirmModal({
        title: 'Logga ut?',
        text: 'Du fortsätter som gäst med ett nytt konto. Ditt gamla konto finns kvar – logga in igen med namn och PIN.',
        confirmLabel: 'Logga ut'
      });
      if (!ok) return;
      await api.logout();
      updateBalanceUI();
      toast('Du är nu utloggad');
      navigate('/');
    });
  }

  root.querySelector('#login-btn').addEventListener('click', async () => {
    const name = root.querySelector('#login-name').value.trim();
    const pin = root.querySelector('#login-pin').value.trim();
    if (!name || !/^\d{4}$/.test(pin)) return toast('Fyll i namn och fyrsiffrig PIN', 'bad');
    try {
      await api.login(name, pin);
      sfx.correct();
      toast('Inloggad!', 'ok');
      updateBalanceUI();
      navigate('/');
    } catch (err) {
      sfx.wrong();
      toast(err.message, 'bad');
    }
  });

  root.querySelector('#toggle-sound').addEventListener('click', (e) => {
    state.muted = !state.muted;
    storage.set('ph.muted', state.muted);
    e.currentTarget.classList.toggle('is-on', !state.muted);
    if (!state.muted) sfx.click();
  });
}

/* ------------------------------ Lärarpanel (täckmantel för admin) ------------------------------ */

function renderLararpanel(root) {
  root.innerHTML = `
    <div class="wrap">
      <section class="section" style="max-width:560px;margin:0 auto">
        <div class="panel" style="padding:30px">
          <div class="row" style="gap:12px;margin-bottom:16px">
            <div class="subject-card__icon" style="background:var(--accent-soft);color:var(--accent)">🎓</div>
            <div>
              <h2 style="font-size:20px">Lärarpanel</h2>
              <p class="small muted">Endast för personal</p>
            </div>
          </div>
          <p class="small muted" style="margin-bottom:20px">Ange lärarkoden för att se elevernas aktivitet, saldon och spelinställningar.</p>
          <label class="field">
            <span>Lärarkod</span>
            <input class="input" id="teacher-code" type="password" placeholder="••••••••••" autocomplete="off" />
          </label>
          <div id="teacher-error"></div>
          <button class="btn btn--primary btn--block" id="teacher-login">Logga in</button>
          <button class="btn btn--ghost btn--block" id="teacher-back" style="margin-top:10px">Tillbaka</button>
          <p class="tiny muted" style="margin-top:16px">Koden delas ut av administratören. All spelaktivitet loggas.</p>
        </div>
      </section>
    </div>`;

  const input = root.querySelector('#teacher-code');
  const loginBtn = root.querySelector('#teacher-login');

  async function submit() {
    const code = input.value.trim();
    if (!code) return;
    loginBtn.disabled = true;
    loginBtn.textContent = 'Kontrollerar …';
    try {
      await api.adminLogin(code);
      root.querySelector('#teacher-error').innerHTML = '';
      toast('Välkommen, chef!', 'gold');
      navigate('/admin');
    } catch (err) {
      root.querySelector('#teacher-error').innerHTML =
        `<p class="quiz__feedback quiz__feedback--no" style="margin-bottom:14px">Fel kod. Försök igen.</p>`;
      sfx.wrong();
      input.value = '';
      input.focus();
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = 'Logga in';
    }
  }

  loginBtn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
  });
  root.querySelector('#teacher-back').addEventListener('click', () => navigate('/'));
  setTimeout(() => input.focus(), 100);
}

/* ------------------------------ Registrera vyer ------------------------------ */

/* ------------------------------ Logg ------------------------------ */

/* Pluggets egen logg. Kasinots logg är en separat lista som ligger inne i
   spelhallen, så de två aldrig blandas ihop. */

const STUDY_LABELS = {
  matte: 'Matematik',
  engelska: 'Engelska',
  svenska: 'Svenska',
  geografi: 'Geografi',
  utmaning: 'Dagens utmaning'
};

const STUDY_ICONS = { matte: '➗', engelska: '📘', svenska: '✏️', geografi: '🌍', utmaning: '🎯' };

function logDayKey(ts) {
  try {
    return new Date(Number(ts) || 0).toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' });
  } catch (e) {
    return '';
  }
}

function logDayLabel(ts) {
  const today = logDayKey(Date.now());
  const yesterday = logDayKey(Date.now() - 86400000);
  const key = logDayKey(ts);
  if (key === today) return 'Idag';
  if (key === yesterday) return 'Igår';
  try {
    return new Date(ts).toLocaleDateString('sv-SE', { day: 'numeric', month: 'long', timeZone: 'Europe/Stockholm' });
  } catch (e) {
    return key;
  }
}

function logTime(ts) {
  try {
    return new Date(Number(ts) || 0).toLocaleTimeString('sv-SE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Stockholm'
    });
  } catch (e) {
    return '–';
  }
}

function renderLoggRows(entries, filter) {
  const list = entries.filter((e) => filter === 'alla' || e.subject === filter);
  if (!list.length) {
    return `<p class="muted small">Inget loggat än. Svara på några frågor i Matematik, Engelska, Svenska eller Geografi, så dyker de upp här.</p>`;
  }
  const groups = [];
  list.forEach((e) => {
    const label = logDayLabel(e.t);
    let group = groups.find((g) => g.label === label);
    if (!group) {
      group = { label, rows: [] };
      groups.push(group);
    }
    group.rows.push(e);
  });
  return groups
    .map(
      (g) => `
      <div class="study-log__day">
        <div class="study-log__day-head">${esc(g.label)} <span class="tiny muted">${g.rows.length} svar</span></div>
        <div class="log-list">
          ${g.rows
            .map(
              (e) => `
            <div class="log-row">
              <span class="log-row__time">${logTime(e.t)}</span>
              <span class="study-log__what">
                <span class="study-log__icon">${STUDY_ICONS[e.subject] || '📚'}</span>
                ${esc(STUDY_LABELS[e.subject] || 'Plugg')}
                <span class="chip ${e.correct ? 'study-log__ok' : 'study-log__no'}">${e.correct ? 'Rätt' : 'Fel'}</span>
              </span>
              <span class="log-row__amount ${e.coins > 0 ? 'is-plus' : 'is-muted'}">${e.coins > 0 ? '+' + kr(e.coins) : '–'}</span>
            </div>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('');
}

async function renderLogg(root) {
  root.innerHTML = `
    <div class="wrap">
      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Logg</h2>
            <p class="section__sub">Allt du gjort i plugget – vilka frågor du svarat på och vad de gav.</p>
          </div>
          <button class="btn btn--sm btn--ghost" data-go="/">← Tillbaka</button>
        </div>
        <div id="logg-body"><p class="muted small">Hämtar loggen…</p></div>
        <p class="tiny muted" style="margin-top:16px">
          Här ligger bara plugget. Myntens historia – insatser, vinster och bonusar – ligger i
          spelhallens egen logg.
        </p>
      </section>
    </div>`;

  root.querySelectorAll('[data-go]').forEach((el) =>
    el.addEventListener('click', () => navigate(el.dataset.go))
  );

  const body = root.querySelector('#logg-body');
  let filter = 'alla';
  let data = null;

  const draw = () => {
    if (!data) return;
    const entries = data.study || [];
    const today = data.today || {};
    body.innerHTML = `
      <div class="grid grid--3" style="margin-bottom:16px">
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${num(today.answers || 0)}</div>
          <div class="stat-tile__label">Svar idag</div>
        </div>
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${num(today.correct || 0)}</div>
          <div class="stat-tile__label">Rätt idag</div>
        </div>
        <div class="panel" style="padding:18px;background:var(--surface-2)">
          <div class="stat-tile__value">${kr(today.coins || 0)}</div>
          <div class="stat-tile__label">Mynt från plugget idag</div>
        </div>
      </div>

      <div class="wrap-gap" style="margin-bottom:14px">
        ${[['alla', 'Alla'], ...Object.entries(STUDY_LABELS)]
          .map(
            ([key, label]) =>
              `<button class="chip${filter === key ? ' is-on' : ''}" data-filter="${key}">${esc(label)}</button>`
          )
          .join('')}
      </div>

      <div id="logg-rows">${renderLoggRows(entries, filter)}</div>`;

    body.querySelectorAll('[data-filter]').forEach((chip) => {
      chip.addEventListener('click', () => {
        filter = chip.dataset.filter;
        draw();
      });
    });
  };

  try {
    data = await api.log();
    draw();
  } catch (err) {
    body.innerHTML = `<p class="small" style="color:var(--bad)">${esc(
      err.message || 'Kunde inte hämta loggen'
    )} – försök igen om en stund.</p>`;
  }
}

registerView('home', renderHome);
registerView('matte', renderSubject('matte'));
registerView('engelska', renderSubject('engelska'));
registerView('svenska', renderSubject('svenska'));
registerView('geografi', renderGeografi);
registerView('utmaning', renderSubject('utmaning'));
registerView('framsteg', renderFramsteg);
registerView('konto', renderKonto);
registerView('logg', renderLogg);
registerView('profil', renderKonto);
registerView('lararpanel', renderLararpanel);

export { SUBJECTS, startQuiz, getStats as getLearnStats };
