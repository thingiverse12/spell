/* =====================================================================
   Läsaren – böcker och bildspel man kan läsa, fråga på och quizza om.

   Två ämnen i samma vy:
     • Idrott och hälsa – vitaminer och mineraler (boken s. 24–27 + bildspelet)
     • Kolets kemi – scannade boksidor (s. 100–139)

   Adresserna ser ut så här (allt går att länka till):
     #/lasaren/<ämne>/las/<dokument>/<sida>
     #/lasaren/<ämne>/fraga/<fråga>
     #/lasaren/<ämne>/begrepp
     #/lasaren/<ämne>/quiz

   Sökningen sker i webbläsaren (js/lasaren-sok.js) – inget material lämnar
   sidan och svaren kommer alltid ur det inlämnade materialet.
   ===================================================================== */

import { registerView, navigate, esc } from './core.js';
import { makeSubject, pgLabel } from './lasaren-sok.js';

const DATA = '/lasaren/data';
const VIEWS = ['las', 'fraga', 'begrepp', 'quiz'];

const state = {
  subjects: null,
  loaded: new Map(),
  zoom: 'fit',
  panel: 'notes',
  quiz: { right: 0, answered: 0 },
  answer: null,
  renderToken: 0
};

/* ------------------------------ data ------------------------------ */

async function loadSubjects() {
  if (state.subjects) return state.subjects;
  const res = await fetch(DATA + '/subjects.json');
  if (!res.ok) throw new Error('Kunde inte läsa ämneslistan');
  const data = await res.json();
  state.subjects = data.subjects || [];
  return state.subjects;
}

async function loadSubject(id) {
  if (state.loaded.has(id)) return state.loaded.get(id);
  const [notes, pages] = await Promise.all([
    fetch(`${DATA}/${id}/notes.json`).then((r) => {
      if (!r.ok) throw new Error('Kunde inte läsa anteckningarna');
      return r.json();
    }),
    fetch(`${DATA}/${id}/pages.json`).then((r) => {
      if (!r.ok) throw new Error('Kunde inte läsa sidorna');
      return r.json();
    })
  ]);
  const subject = makeSubject({ id, meta: notes.meta || { id, title: id, subtitle: '' }, notes, pages });
  state.loaded.set(id, subject);
  return subject;
}

/* ------------------------------ smådelar ------------------------------ */

const href = (subjectId, rest) => `/lasaren/${subjectId}${rest ? '/' + rest : ''}`;
const pageHref = (subjectId, doc, n) => href(subjectId, `las/${doc}/${n}`);
const answerHref = (subjectId, q) => href(subjectId, 'fraga/' + encodeURIComponent(q));

const zoomClass = () => 'is-' + state.zoom;

/* Flera kapitel kan dela dokument: välj det som har ett avsnitt på sidan. */
function chapterFor(subject, doc, n) {
  const byDoc = subject.chapters.filter((c) => c.doc === doc);
  if (!byDoc.length) return null;
  const withPage = byDoc
    .filter((c) => c.sections.some((s) => s.where.n === n))
    .sort((a, b) => Math.abs(n - a.first.n) - Math.abs(n - b.first.n));
  if (withPage.length) return withPage[0];
  const before = byDoc.filter((c) => c.first.n <= n).sort((a, b) => b.first.n - a.first.n);
  return before[0] || byDoc[0];
}

function neighbor(subject, doc, n, step) {
  const order = subject.docOrder;
  const count = (subject.pages.filter((p) => p.doc === doc).length || 1);
  const idx = order.indexOf(doc);
  if (step > 0) {
    if (n < count) return { doc, n: n + 1 };
    const nextDoc = order[idx + 1];
    return nextDoc ? { doc: nextDoc, n: 1 } : null;
  }
  if (n > 1) return { doc, n: n - 1 };
  const prevDoc = order[idx - 1];
  if (!prevDoc) return null;
  return { doc: prevDoc, n: subject.pages.filter((p) => p.doc === prevDoc).length };
}

function subjectsHTML(active) {
  return state.subjects
    .map(
      (s) => `<a class="las-subject ${s.id === active ? 'is-on' : ''}" href="#${href(s.id, 'las')}">
        <span class="las-subject__title">${esc(s.title)}</span>
        <span class="las-subject__meta">${esc(s.subtitle || '')} · ${s.pageCount} sidor · ${s.quizCount} quiz</span>
      </a>`
    )
    .join('');
}

function tabsHTML(subjectId, view) {
  const items = [
    { key: 'las', label: 'Läs' },
    { key: 'fraga', label: 'Fråga texten' },
    { key: 'begrepp', label: 'Begrepp' },
    { key: 'quiz', label: 'Quiz' }
  ];
  return items
    .map(
      (item) =>
        `<a class="las-tab ${item.key === view ? 'is-on' : ''}" href="#${href(subjectId, item.key)}">${item.label}</a>`
    )
    .join('');
}

function shellHTML(subject, subjectId, view) {
  return `
    <div class="wrap las-wrap">
      <section class="section">
        <div class="section__head">
          <div>
            <h2 class="section__title">Läsaren</h2>
            <p class="section__sub">Läs boken och bildspelet, ställ frågor och få svar med sidhänvisning – allt ur det inlämnade materialet.</p>
          </div>
        </div>
        <div class="las-subjects">${subjectsHTML(subjectId)}</div>
        <div class="las-head">
          <div>
            <h3 class="las-head__title">${esc(subject.meta.title)}</h3>
            <p class="las-head__meta">${esc(subject.meta.source || '')} · ${subject.counts.pageCount} sidor · ${subject.counts.glossaryCount} begrepp · ${subject.counts.quizCount} quizfrågor</p>
          </div>
        </div>
        <nav class="las-tabs">${tabsHTML(subjectId, view)}</nav>
        <div id="las-body"></div>
      </section>
    </div>`;
}

/* ------------------------------ läs ------------------------------ */

function renderReader(root, subject, subjectId, doc, n) {
  const count = subject.pages.filter((p) => p.doc === doc).length;
  const page =
    subject.pageData(doc, n) ||
    subject.pageData(doc, count) ||
    subject.pageData(subject.chapters[0].doc, subject.chapters[0].first.n);
  const chapter = chapterFor(subject, page.doc, page.n) || subject.chapters[0];
  const prev = neighbor(subject, page.doc, page.n, -1);
  const next = neighbor(subject, page.doc, page.n, 1);
  const body = root.querySelector('#las-body');

  body.innerHTML = `
    <div class="las-chapters">
      ${subject.chapters
        .map(
          (c) =>
            `<a class="las-chip ${c.id === chapter.id ? 'is-on' : ''}" href="#${pageHref(subjectId, c.doc, c.first.n)}">${esc(c.title)}<small>${esc(c.pages)}</small></a>`
        )
        .join('')}
    </div>

    <div class="las-reader">
      <div class="las-viewer">
        <div class="las-viewer__bar">
          <button class="btn btn--sm" data-step="-1" ${prev ? '' : 'disabled'} title="Föregående sida">←</button>
          <button class="btn btn--sm" data-step="1" ${next ? '' : 'disabled'} title="Nästa sida">→</button>
          <span class="las-viewer__where">${esc(page.pageLabel)}</span>
          <span class="las-spacer"></span>
          <button class="btn btn--sm ${state.zoom === 'fit' ? 'btn--primary' : ''}" data-zoom="fit">Anpassa</button>
          <button class="btn btn--sm ${state.zoom === '100' ? 'btn--primary' : ''}" data-zoom="100">100 %</button>
          <button class="btn btn--sm ${state.zoom === '150' ? 'btn--primary' : ''}" data-zoom="150">150 %</button>
        </div>
        <div class="las-stage ${zoomClass()}" id="las-stage">
          <img id="las-page" src="${esc(page.img)}" alt="${esc(page.pageLabel)}" />
        </div>
        <div class="las-viewer__foot">
          <span>${esc(chapter ? chapter.title : '')} · sida ${page.n} av ${subject.pages.filter((p) => p.doc === page.doc).length}</span>
        </div>
      </div>

      <aside class="las-panel">
        <div class="las-panel__tabs">
          <button class="las-panel__tab ${state.panel === 'notes' ? 'is-on' : ''}" data-panel="notes">Anteckningar</button>
          <button class="las-panel__tab ${state.panel === 'text' ? 'is-on' : ''}" data-panel="text">Sidans text</button>
        </div>
        <div class="las-panel__body" id="las-panel"></div>
      </aside>
    </div>`;

  body.querySelectorAll('[data-step]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const step = Number(btn.dataset.step);
      const target = neighbor(subject, page.doc, page.n, step);
      if (target) navigate(pageHref(subjectId, target.doc, target.n));
    })
  );

  body.querySelectorAll('[data-zoom]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.zoom = btn.dataset.zoom;
      body.querySelector('#las-stage').className = 'las-stage ' + zoomClass();
      body
        .querySelectorAll('[data-zoom]')
        .forEach((b) => b.classList.toggle('btn--primary', b.dataset.zoom === state.zoom));
    })
  );

  body.querySelectorAll('[data-panel]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.panel = btn.dataset.panel;
      body
        .querySelectorAll('[data-panel]')
        .forEach((b) => b.classList.toggle('is-on', b.dataset.panel === state.panel));
      drawPanel(body.querySelector('#las-panel'), subject, subjectId, page, chapter);
    })
  );

  drawPanel(body.querySelector('#las-panel'), subject, subjectId, page, chapter);

  const onKey = (event) => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const target = neighbor(subject, page.doc, page.n, event.key === 'ArrowRight' ? 1 : -1);
    if (target) {
      event.preventDefault();
      navigate(pageHref(subjectId, target.doc, target.n));
    }
  };
  document.addEventListener('keydown', onKey);
  state.cleanup = () => document.removeEventListener('keydown', onKey);
}

function drawPanel(panel, subject, subjectId, page, chapter) {
  if (!panel) return;

  if (state.panel === 'text') {
    const kind = subject.meta.textKind || 'ocr';
    panel.innerHTML = `
      <p class="las-note">
        ${
          kind === 'ocr'
            ? 'Maskinläst text från scanningen. Bra att söka i, men den kan innehålla läsfel – jämför med sidan.'
            : 'Texten är avskriven för hand från boken och bildspelet, så den stämmer med sidan bredvid.'
        }
      </p>
      <div class="las-text">${(page.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join('') || '<p class="muted">Ingen text på den här sidan.</p>'}</div>`;
    return;
  }

  const notes = subject.notes.chapters.find((c) => c.id === chapter.id) || { sections: [], mal: [] };
  const active = notes.sections.find((s) => s.where.doc === page.doc && s.where.n === page.n);
  panel.innerHTML = `
    <h4 class="las-panel__title">${esc(chapter.title)}</h4>
    <p class="las-panel__pages">${esc(chapter.pages)} · ${notes.sections.length} avsnitt</p>
    ${chapter.intro ? `<p class="las-panel__intro">${esc(chapter.intro)}</p>` : ''}
    ${
      (chapter.mal || []).length
        ? `<div class="las-panel__mal"><b>Mål</b><ul>${chapter.mal.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>`
        : ''
    }
    ${notes.sections
      .map(
        (s) => `<div class="las-sec ${active && s.title === active.title ? 'is-on' : ''}">
          <div class="las-sec__head">
            <h5>${esc(s.title)}</h5>
            <a href="#${pageHref(subjectId, s.where.doc, s.where.n)}">${esc(pgLabel(s.where.page))} →</a>
          </div>
          <ul>${s.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        </div>`
      )
      .join('')}`;
}

/* ------------------------------ fråga ------------------------------ */

const EXAMPLES = {
  idrott: [
    'Vilka vitaminer är fettlösliga?',
    'Vad händer om man har järnbrist?',
    'Varför behövs vitamin D?',
    'Vem behöver kosttillskott?'
  ],
  kemi: ['Varför kan kolatomen binda fyra atomer?', 'Vad bildas när metan förbränns?', 'Vad är en isomer?', 'Hur fungerar en tensid?']
};

function renderAsk(root, subject, subjectId, question) {
  const body = root.querySelector('#las-body');
  const chips = EXAMPLES[subjectId] || [];
  body.innerHTML = `
    <div class="las-ask">
      <form class="las-form" id="las-askform">
        <input id="las-askinput" type="text" placeholder="Skriv en fråga, t.ex. ${esc((chips[0] || 'vad är en ester?').toLowerCase())}"
               value="${esc(question || '')}" autocomplete="off" />
        <button class="btn btn--primary" type="submit">Fråga</button>
      </form>
      <div class="las-chips">
        ${chips.map((c) => `<a class="las-chip" href="#${answerHref(subjectId, c)}">${esc(c)}</a>`).join('')}
      </div>
      <div id="las-answer"></div>
    </div>`;

  const ask = (q) => navigate(answerHref(subjectId, q));
  body.querySelector('#las-askform').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = body.querySelector('#las-askinput').value.trim();
    if (value) ask(value);
  });

  const out = body.querySelector('#las-answer');
  if (!question) {
    out.innerHTML = `<p class="las-hint">Svaren hämtas ur ${esc(subject.meta.title)} och du får alltid sidan det står på.</p>`;
    return;
  }

  const result = subject.ask(question);
  const answer = result.answer;
  out.innerHTML = `
    ${
      answer
        ? `<div class="las-answer">
            <span class="las-answer__label">Svar${answer.chapter ? ' ur ' + esc(answer.chapter) : ''}</span>
            <h4>${esc(answer.lead)}</h4>
            <p>${esc(answer.body)}</p>
            ${(answer.more || []).length ? `<ul class="las-answer__more">${answer.more.map((m) => `<li>${esc(m.body)}</li>`).join('')}</ul>` : ''}
            <div class="las-answer__src">
              <span>Källa: <b>${esc(answer.source.pageLabel)}</b></span>
              <a class="btn btn--sm btn--primary" href="#${pageHref(subjectId, answer.source.doc, answer.source.n)}">Öppna sidan →</a>
            </div>
            ${
              answer.related
                ? `<p class="las-answer__rel">Begrepp: <b>${esc(answer.related.term)}</b> – ${esc(answer.related.definition)}</p>`
                : ''
            }
          </div>`
        : `<div class="las-answer las-answer--none">
            <span class="las-answer__label">Inget säkert svar</span>
            <p>${esc(result.hint || 'Jag hittar inget om det här.')}</p>
          </div>`
    }
    ${
      (result.hits || []).length
        ? `<div class="las-results">
            <h5>Stycken som matchar</h5>
            ${result.hits
              .slice(0, 8)
              .map(
                (h) => `<a class="las-result" href="#${pageHref(subjectId, h.doc, h.n)}">
                  <span class="las-result__top">
                    <span class="las-result__kind">${h.kind === 'note' ? 'Anteckning' : h.kind === 'glossary' ? 'Begrepp' : 'Sidans text'}</span>
                    <span>${esc(h.pageLabel)}</span>
                    <span>${esc(h.chapter || '')}</span>
                  </span>
                  <span class="las-result__text">${esc(h.text)}</span>
                </a>`
              )
              .join('')}
          </div>`
        : ''
    }`;
}

/* ------------------------------ begrepp ------------------------------ */

function renderGlossary(root, subject, subjectId) {
  const body = root.querySelector('#las-body');
  body.innerHTML = `
    <div class="las-form">
      <input id="las-filter" type="search" placeholder="Filtrera bland ${subject.glossary.length} begrepp …" autocomplete="off" />
    </div>
    <div class="las-grid" id="las-grid"></div>`;

  const grid = body.querySelector('#las-grid');
  const draw = (filter = '') => {
    const q = filter.trim().toLowerCase();
    const shown = subject.glossary.filter(
      (g) => !q || g.term.toLowerCase().includes(q) || g.definition.toLowerCase().includes(q)
    );
    grid.innerHTML = shown.length
      ? shown
          .map(
            (g) => `<article class="las-card">
              <h5>${esc(g.term)}</h5>
              <p>${esc(g.definition)}</p>
              <a class="las-card__foot" href="#${pageHref(subjectId, g.doc, g.n)}">Läs ${esc(pgLabel(g.page))} →</a>
            </article>`
          )
          .join('')
      : '<p class="las-hint">Inget begrepp matchar.</p>';
  };
  draw();
  body.querySelector('#las-filter').addEventListener('input', (event) => draw(event.target.value));
}

/* ------------------------------ quiz ------------------------------ */

function renderQuiz(root, subject, subjectId) {
  const body = root.querySelector('#las-body');
  if (state.quiz.subject !== subjectId) state.quiz = { subject: subjectId, right: 0, answered: 0 };
  body.innerHTML = `
    <p class="las-quiz__score" id="las-score">${state.quiz.right} rätt av ${state.quiz.answered}</p>
    <div class="las-quiz" id="las-quiz"></div>`;

  const list = body.querySelector('#las-quiz');
  list.innerHTML = subject.quiz
    .map(
      ( item, index ) => `<div class="las-quiz__item" data-id="${index}">
        <p class="las-quiz__q">${index + 1}. ${esc(item.q)}</p>
        ${item.options.map((option, oi) => `<button class="las-quiz__opt" data-pick="${oi}">${esc(option)}</button>`).join('')}
        <div class="las-quiz__why" hidden></div>
      </div>`
    )
    .join('');

  list.querySelectorAll('.las-quiz__item').forEach((card) => {
    const item = subject.quiz[Number(card.dataset.id)];
    card.querySelectorAll('.las-quiz__opt').forEach((btn) =>
      btn.addEventListener('click', () => {
        if (card.dataset.done) return;
        card.dataset.done = '1';
        const pick = Number(btn.dataset.pick);
        const correct = pick === item.answer;
        card.querySelectorAll('.las-quiz__opt').forEach((b, oi) => {
          b.disabled = true;
          if (oi === item.answer) b.classList.add('is-right');
          else if (oi === pick) b.classList.add('is-wrong');
        });
        const why = card.querySelector('.las-quiz__why');
        why.hidden = false;
        why.innerHTML = `
          <p>${correct ? '✅ Rätt.' : '❌ Inte riktigt.'} ${esc(item.why || '')}</p>
          <a class="btn btn--sm" href="#${pageHref(subjectId, item.doc, item.n)}">Läs ${esc(pgLabel(item.page))} →</a>`;
        state.quiz.answered += 1;
        if (correct) state.quiz.right += 1;
        body.querySelector('#las-score').textContent = `${state.quiz.right} rätt av ${state.quiz.answered}`;
      })
    );
  });
}

/* ------------------------------ vyn ------------------------------ */

function parseRoute(route) {
  const parts = (route.parts || []).slice(1); // [ämne, vy, ...]
  const subjectId = parts[0] || '';
  const view = VIEWS.includes(parts[1]) ? parts[1] : 'las';
  const doc = parts[2] || '';
  const n = Number(parts[3]) > 0 ? Number(parts[3]) : 1;
  const question = view === 'fraga' ? decodeURIComponent(parts.slice(2).join('/')) : '';
  return { subjectId, view, doc, n, question };
}

async function renderLasaren(root, route) {
  const token = ++state.renderToken;
  if (state.cleanup) {
    state.cleanup();
    state.cleanup = null;
  }

  let subjects;
  try {
    subjects = await loadSubjects();
  } catch (err) {
    root.innerHTML = `<div class="wrap"><p class="muted">Kunde inte läsa materialet: ${esc(err.message)}</p></div>`;
    return;
  }
  if (!subjects.length || token !== state.renderToken) return;

  const parsed = parseRoute(route);
  const subjectId = subjects.some((s) => s.id === parsed.subjectId) ? parsed.subjectId : subjects[0].id;
  if (parsed.subjectId !== subjectId) {
    navigate(href(subjectId, parsed.view === 'las' ? `las/${parsed.doc}/${parsed.n}` : parsed.view));
    return;
  }

  let subject;
  try {
    subject = await loadSubject(subjectId);
  } catch (err) {
    root.innerHTML = `<div class="wrap"><p class="muted">Kunde inte läsa materialet: ${esc(err.message)}</p></div>`;
    return;
  }
  if (token !== state.renderToken) return;

  root.innerHTML = shellHTML(subject, subjectId, parsed.view);

  if (parsed.view === 'las') {
    const first = subject.chapters[0];
    const doc = subject.docOrder.includes(parsed.doc) ? parsed.doc : first.doc;
    const n = subject.docOrder.includes(parsed.doc) ? parsed.n : first.first.n;
    renderReader(root, subject, subjectId, doc, n);
  } else if (parsed.view === 'fraga') {
    renderAsk(root, subject, subjectId, parsed.question);
  } else if (parsed.view === 'begrepp') {
    renderGlossary(root, subject, subjectId);
  } else {
    renderQuiz(root, subject, subjectId);
  }
}

registerView('lasaren', renderLasaren);

/* Används av startsidan och av testerna. */
export { state as lasarenState, href as lasarenHref };
