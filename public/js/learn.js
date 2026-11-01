/* =====================================================================
   Täckmanteln: studeappen. Matte, engelska och svenska.
   ===================================================================== */

import {
  registerView, state, api, sfx, toast, kr, num, esc, storage, navigate, openModal, updateBalanceUI,
  avatarLetter, renderRoute
} from './core.js';

/* ------------------------------ Statistik ------------------------------ */

const DEFAULT_STATS = {
  subjects: {
    matte: { correct: 0, total: 0 },
    engelska: { correct: 0, total: 0 },
    svenska: { correct: 0, total: 0 }
  },
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
  return {
    ...DEFAULT_STATS,
    ...saved,
    subjects: { ...DEFAULT_STATS.subjects, ...(saved.subjects || {}) }
  };
}

function saveStats(next) {
  storage.set('ph.learn', next);
}

function recordAnswer(subject, correct) {
  const stats = getStats();
  const key = stats.subjects[subject] ? subject : 'matte';
  const slot = stats.subjects[key] || { correct: 0, total: 0 };
  slot.total += 1;
  if (correct) slot.correct += 1;
  stats.subjects[key] = slot;
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
  return stats;
}

/* ------------------------------ Ämnen ------------------------------ */

const SUBJECTS = {
  matte: { name: 'Matematik', icon: '➗', cls: 'math', text: 'Räkna, procent, bråk och ekvationer i din takt.' },
  engelska: { name: 'Engelska', icon: '📘', cls: 'eng', text: 'Glosor, grammatik och ordkunskap inför proven.' },
  svenska: { name: 'Svenska', icon: '✏️', cls: 'swe', text: 'Ordklasser, stavning och läsförståelse.' },
  utmaning: { name: 'Dagens utmaning', icon: '🎯', cls: 'mix', text: 'Blandade frågor från alla tre ämnena.' }
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

function subjectQuestions(subject, count = 10) {
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
  // utmaning: blandat
  const banks = [...shuffleArray(ENGELSKA), ...shuffleArray(SVENSKA)];
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) questions.push(mathQuestion(i + 1));
    else {
      const q = banks.pop();
      questions.push(buildQuestion(q.q, q.options, q.options[q.a], q.hint));
    }
  }
  return questions;
}

/* ------------------------------ Quiz-motorn ------------------------------ */

const quiz = {
  subject: null,
  questions: [],
  index: 0,
  correct: 0,
  coins: 0,
  answered: false,
  selected: null,
  streak: 0,
  finished: false
};

function startQuiz(subject) {
  quiz.subject = subject;
  quiz.questions = subjectQuestions(subject, 10);
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
            <p class="muted">Du klarade ${quiz.correct} av ${total} frågor i ${subject.name.toLowerCase()}.</p>
            <div class="grid grid--3" style="margin:26px 0">
              <div class="stat-tile"><div class="stat-tile__value">${quiz.correct}/${total}</div><div class="stat-tile__label">Rätt svar</div></div>
              <div class="stat-tile"><div class="stat-tile__value">${pct} %</div><div class="stat-tile__label">Träffsäkerhet</div></div>
              <div class="stat-tile"><div class="stat-tile__value">+${num(quiz.coins)} kr</div><div class="stat-tile__label">Intjänade mynt</div></div>
            </div>
            <div class="row" style="justify-content:center;flex-wrap:wrap">
              <button class="btn btn--primary" id="quiz-again">Kör igen</button>
              <button class="btn btn--ghost" id="quiz-home">Till startsidan</button>
              ${quiz.subject !== 'utmaning' ? `<button class="btn btn--mint" id="quiz-next-subject">Byt ämne</button>` : ''}
            </div>
          </div>
        </div>
      </div>`;

    root.querySelector('#quiz-again').addEventListener('click', () => {
      startQuiz(quiz.subject);
      renderQuiz(root);
    });
    root.querySelector('#quiz-home').addEventListener('click', () => navigate('/'));
    const other = root.querySelector('#quiz-next-subject');
    if (other) {
      other.addEventListener('click', () => {
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
              <span>${esc(subject.name)}</span>
              <span>Fråga ${quiz.index + 1} av ${total}</span>
            </div>
            <div class="progress"><div class="progress__bar" style="width:${(quiz.index / total) * 100}%"></div></div>
          </div>
          <span class="chip chip--amber">🔥 ${quiz.streak}</span>
        </div>

        <div class="quiz__card">
          <div class="quiz__prompt">${esc(subject.name)}</div>
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
    navigate('/');
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

  recordAnswer(quiz.subject, correct);
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
          <p>Träna tio frågor om dagen i matte, engelska och svenska. Du får spelmynt för varje rätt svar som du kan använda i belöningsspelet.</p>
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

      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Dina ämnen</h2>
            <p class="section__sub">Välj ett ämne och kör tio frågor.</p>
          </div>
          <button class="btn btn--sm btn--ghost" data-go="/framsteg">Se framsteg</button>
        </div>
        <div class="grid grid--3">
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
          ${['matte', 'engelska', 'svenska']
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

function renderProfil(root) {
  const p = state.player || {};
  root.innerHTML = `
    <div class="wrap">
      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Min profil</h2>
            <p class="section__sub">Namn och PIN-kod för att komma tillbaka till dina framsteg.</p>
          </div>
          <button class="btn btn--sm btn--ghost" data-go="/">← Tillbaka</button>
        </div>

        <div class="grid grid--2">
          <div class="panel" style="padding:24px">
            <div class="row" style="gap:14px;margin-bottom:20px">
              <div class="avatar" style="width:52px;height:52px;font-size:20px">${esc(avatarLetter(p.name))}</div>
              <div>
                <h3 style="font-size:17px">${esc(p.name || 'Gäst')}</h3>
                <p class="small muted">${kr(p.balance ?? 0)} · ${p.rounds ?? 0} rundor</p>
              </div>
            </div>

            <label class="field">
              <span>Visningsnamn</span>
              <input class="input" id="profile-name" value="${esc(p.name || '')}" maxlength="24" />
            </label>
            <button class="btn btn--primary btn--sm" id="profile-save">Spara namn</button>

            <hr style="border:0;border-top:1px solid var(--line);margin:22px 0" />

            <label class="field">
              <span>${p.hasPin ? 'Byt PIN-kod (4 siffror)' : 'Lås kontot med PIN-kod'}</span>
              <input class="input" id="profile-pin" inputmode="numeric" maxlength="4" placeholder="••••" />
            </label>
            <button class="btn btn--ghost btn--sm" id="profile-pin-save">Spara PIN</button>
            <p class="tiny muted" style="margin-top:8px">Med namn + PIN kan du logga in på en annan enhet.</p>
          </div>

          <div class="panel" style="padding:24px">
            <h3 style="font-size:16px;margin-bottom:14px">Inställningar</h3>
            <div class="switch">
              <div><div class="switch__label">Ljud</div><div class="switch__hint">Klick och vinster</div></div>
              <div class="toggle ${state.muted ? '' : 'is-on'}" id="toggle-sound"></div>
            </div>

            <h3 style="font-size:16px;margin:22px 0 12px">Logga in på annat konto</h3>
            <label class="field"><span>Namn</span><input class="input" id="login-name" placeholder="Ditt namn" /></label>
            <label class="field"><span>PIN</span><input class="input" id="login-pin" inputmode="numeric" maxlength="4" placeholder="••••" /></label>
            <button class="btn btn--sm btn--ghost" id="login-btn">Logga in</button>

            <hr style="border:0;border-top:1px solid var(--line);margin:22px 0" />
            <h3 style="font-size:16px;margin-bottom:8px">Om appen</h3>
            <p class="small muted">Plugghörnan 2.0 – ett studiestöd för matte, engelska och svenska. Alla mynt är påhittade och har inget värde.
            <br /><br /><span class="tiny">Tips: spader-symbolen ♠ i logotypen gillar att bli klickad tre gånger.</span></p>
            <button class="btn btn--sm btn--ghost" id="about-btn" style="margin-top:12px">Läs mer</button>
          </div>
        </div>
      </section>
    </div>`;

  root.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => navigate(el.dataset.go)));

  root.querySelector('#profile-save').addEventListener('click', async () => {
    const name = root.querySelector('#profile-name').value.trim();
    if (name.length < 2) return toast('Namnet är för kort', 'bad');
    try {
      await api.rename(name);
      toast('Namnet sparat', 'ok');
      renderRoute();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  root.querySelector('#profile-pin-save').addEventListener('click', async () => {
    const pin = root.querySelector('#profile-pin').value.trim();
    if (!/^\d{4}$/.test(pin)) return toast('PIN måste vara fyra siffror', 'bad');
    try {
      await api.setPin(pin);
      toast('PIN-kod sparad', 'ok');
      state.player.hasPin = true;
      renderRoute();
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  root.querySelector('#toggle-sound').addEventListener('click', (e) => {
    state.muted = !state.muted;
    storage.set('ph.muted', state.muted);
    e.currentTarget.classList.toggle('is-on', !state.muted);
    if (!state.muted) sfx.click();
  });

  root.querySelector('#login-btn').addEventListener('click', async () => {
    const name = root.querySelector('#login-name').value.trim();
    const pin = root.querySelector('#login-pin').value.trim();
    if (!name || !/^\d{4}$/.test(pin)) return toast('Fyll i namn och fyrsiffrig PIN', 'bad');
    try {
      await api.login(name, pin);
      toast('Inloggad!', 'ok');
      updateBalanceUI();
      navigate('/');
    } catch (err) {
      toast(err.message, 'bad');
    }
  });

  root.querySelector('#about-btn').addEventListener('click', () => {
    openModal({
      title: 'Om Plugghörnan',
      sub: 'Version 2.0',
      body: `<p class="small" style="line-height:1.8;color:var(--text-soft)">
        Plugghörnan är en studieapp för dig som vill träna matte, engelska och svenska.
        Varje rätt svar ger spelmynt som du kan använda i appens belöningsspel.
        <br><br>
        <b>Inga riktiga pengar.</b> Mynten är påhittade, kan inte köpas för pengar och kan inte växlas tillbaka.
        <br><br>
        <span class="tiny muted">För lärare: panelen nås via sidfoten och kräver lärarkod.</span>
      </p>`,
      actions: [{ label: 'Stäng' }]
    });
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

registerView('home', renderHome);
registerView('matte', renderSubject('matte'));
registerView('engelska', renderSubject('engelska'));
registerView('svenska', renderSubject('svenska'));
registerView('utmaning', renderSubject('utmaning'));
registerView('framsteg', renderFramsteg);
registerView('profil', renderProfil);
registerView('lararpanel', renderLararpanel);

export { SUBJECTS, startQuiz, getStats as getLearnStats };
