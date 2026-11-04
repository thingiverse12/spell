/* =====================================================================
   Läsaren – sökmotorn.

   Allt material ligger som JSON i /lasaren/data/<ämne>/. Här byggs ett
   BM25-index över anteckningar, begrepp och sidtext, plus ett frågeindex
   (notes.alias) som pekar vanliga frågor rakt på rätt avsnitt. Modulen är
   ren JavaScript utan DOM, så den kan köras både i webbläsaren och i Node
   (tools/audit-payouts.js kontrollerar den).
   ===================================================================== */

/* ------------------------------ normalisering ------------------------------ */

const STOP = new Set(
  `och att som är det en ett på i av för med till den de har kan man vad var hur vilka vilken vilket
   eller men om så sig sin sitt sina från vid under över mellan efter före när då där här dessa detta
   denna också bara även mycket många några något blir blev vara varit finns fanns kommer kom
   gör görs gjorde ska skall skulle kunna kunde vill ville får fick tar tog ger gav ser såg
   fungerar fungera används använda använt kallas kalla behövs behöver viktigt viktig exempel
   exempelvis bland annat alltså därför eftersom genom redan sedan samt både varje olika
   varför när vems vilkas fast dels`
    .split(/\s+/)
    .filter(Boolean)
);

/** å/ä/ö blir a/a/o så att stavfel och OCR-fel inte stoppar sökningen. */
export function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/å/g, 'a')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function words(text) {
  return norm(text)
    .split(' ')
    .filter((w) => w.length >= 2);
}

/* Grov svensk stam: "binda" och "bindningar" ska matcha varandra. */
function stem(word) {
  return word.length <= 4 ? word : word.slice(0, 4);
}

function terms(text) {
  const out = [];
  for (const w of words(text)) {
    if (STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

export const pgLabel = (page) => (typeof page === 'number' ? 's. ' + page : String(page));

/* ------------------------------ indexet ------------------------------ */

const KIND_WEIGHT = { glossary: 1.25, note: 1.12, page: 0.95 };
const K1 = 1.4;
const B = 0.72;

const escapeRx = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Bygger ett sökbart ämne av notes.json + pages.json.
 * @param {{id: string, meta: object, notes: object, pages: Array}} input
 */
export function makeSubject({ id, meta, notes, pages }) {
  const units = [];
  const add = (unit) => {
    const tf = new Map();
    for (const t of terms(unit.text)) tf.set(t, (tf.get(t) || 0) + 1);
    unit.tf = tf;
    unit.len = [...tf.values()].reduce((a, b) => a + b, 0) || 1;
    unit.titleTerms = new Set(terms(unit.title || ''));
    unit.weight = KIND_WEIGHT[unit.kind] || 1;
    units.push(unit);
    return unit;
  };

  for (const chapter of notes.chapters) {
    for (const section of chapter.sections) {
      section.points.forEach((point) => {
        add({
          kind: 'note',
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          section: section.title,
          title: section.title,
          text: point,
          doc: section.where.doc,
          n: section.where.n,
          page: section.where.page
        });
      });
    }
  }

  for (const page of pages) {
    const chapter = notes.chapters.find((c) => c.doc === page.doc && c.id) || null;
    add({
      kind: 'page',
      chapterId: chapter ? chapter.id : '',
      chapterTitle: chapter ? chapter.title : '',
      section: '',
      title: 'Sidans text',
      text: (page.paragraphs || []).join(' '),
      doc: page.doc,
      n: page.n,
      page: page.page
    });
  }

  const glossaryUnits = (notes.glossary || []).map((g) =>
    add({
      kind: 'glossary',
      chapterId: '',
      chapterTitle: '',
      section: 'Begrepp',
      title: g.term,
      text: g.term + ': ' + g.definition,
      doc: g.doc,
      n: g.n,
      page: g.page,
      term: g.term,
      definition: g.definition
    })
  );

  const N = units.length || 1;
  const avgLen = units.reduce((sum, u) => sum + u.len, 0) / N;
  const df = new Map();
  for (const u of units) for (const t of u.tf.keys()) df.set(t, (df.get(t) || 0) + 1);

  const idf = (t) => {
    const n = df.get(t) || 0;
    return Math.log(1 + (N - n + 0.5) / (n + 0.5));
  };

  const score = (unit, queryTerms) => {
    let total = 0;
    let titleHits = 0;
    for (const t of queryTerms) {
      const f = unit.tf.get(t);
      if (!f) continue;
      total += idf(t) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * unit.len) / avgLen)));
      if (unit.titleTerms.has(t)) titleHits += 1;
    }
    if (!total) return 0;
    /* står ordet i rubriken är stycket nästan alltid rätt svar */
    return total * unit.weight * (1 + 1.5 * titleHits);
  };

  const pageIndex = new Map(pages.map((p) => [p.doc + ':' + p.n, p]));

  function snippet(text, queryTerms, width = 220) {
    const plain = String(text || '').replace(/\s+/g, ' ').trim();
    if (!plain) return '';
    const flat = norm(plain);
    let hit = -1;
    for (const t of queryTerms) {
      const i = flat.indexOf(t);
      if (i >= 0 && (hit < 0 || i < hit)) hit = i;
    }
    if (hit < 0) hit = 0;
    const start = Math.max(0, Math.min(hit - 60, Math.max(0, plain.length - width)));
    const cut = plain.slice(start, start + width);
    return (start > 0 ? '… ' : '') + cut + (start + width < plain.length ? ' …' : '');
  }

  function search(query, limit = 12) {
    const q = terms(query);
    if (!q.length) return [];
    const seen = new Set();
    const hits = [];
    for (const unit of units) {
      const s = score(unit, q);
      if (s <= 0) continue;
      const key = unit.kind + '|' + unit.doc + '|' + unit.n + '|' + (unit.section || unit.title);
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        kind: unit.kind,
        chapter: unit.chapterTitle,
        chapterId: unit.chapterId,
        section: unit.section || unit.title,
        doc: unit.doc,
        n: unit.n,
        page: unit.page,
        pageLabel: pgLabel(unit.page),
        score: Math.round(s * 100) / 100,
        text: unit.kind === 'page' ? snippet(unit.text, q) : unit.text
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }

  function findGlossary(query) {
    const q = norm(query);
    let best = null;
    for (const g of notes.glossary || []) {
      const term = norm(g.term);
      if (!term) continue;
      if (q === term) return { entry: g, exact: true };
      const inside = new RegExp('(^| )' + escapeRx(term) + '( |$)').test(q);
      if (inside && (!best || term.length > norm(best.term).length)) best = g;
    }
    return best ? { entry: best, exact: false } : null;
  }

  /** Frågeindex: vanliga frågor pekar rakt på rätt avsnitt. */
  function findAlias(query) {
    const q = ' ' + norm(query) + ' ';
    let best = null;
    for (const entry of notes.alias || []) {
      for (const say of entry.say) {
        const phrase = norm(say);
        if (!phrase) continue;
        /* "kalcium" ska matcha både "kalciumbrist" och "kalciumet" */
        const rx = new RegExp('(^| )' + phrase.replace(/[^a-z0-9]+/g, ' ') + '[a-z0-9]*( |$)');
        if (rx.test(q)) {
          if (!best || phrase.length > best.matched.length) best = { target: entry.target, matched: phrase };
        }
      }
    }
    return best;
  }

  /** Inom avsnittet: det stycke som svarar bäst på frågan. */
  function bestPointFor(sectionTitle, query) {
    const q = terms(query);
    const points = units.filter((u) => u.kind === 'note' && u.section === sectionTitle);
    if (!points.length) return null;
    let best = points[0];
    let bestScore = -1;
    for (const p of points) {
      const s = score(p, q);
      if (s > bestScore) {
        bestScore = s;
        best = p;
      }
    }
    return { best, rest: points.filter((p) => p !== best) };
  }

  function ask(query) {
    const q = terms(query);
    const gl = findGlossary(query);
    const alias = findAlias(query);
    const hits = search(query, 6);

    /* "vad är struma?" eller "vad betyder folsyra?" – då svarar begreppslistan */
    const wantsDefinition = /^(vad ar|vad betyder|vad kallas|vem ar|vad menas)/.test(norm(query));
    if (gl && (gl.exact || wantsDefinition)) {
      return {
        answer: {
          lead: gl.entry.term,
          body: gl.entry.definition,
          source: { doc: gl.entry.doc, n: gl.entry.n, page: gl.entry.page, pageLabel: pgLabel(gl.entry.page), section: 'Begrepp' },
          chapter: ''
        },
        hits
      };
    }

    if (alias) {
      const found = bestPointFor(alias.target.section, query);
      const t = alias.target;
      if (found) {
        const others = found.rest
          .filter((p) => score(p, q) > 0)
          .sort((a, b) => score(b, q) - score(a, q))
          .slice(0, 2);
        return {
          answer: {
            lead: t.section,
            body: found.best.text,
            source: { doc: t.doc, n: t.n, page: t.page, pageLabel: pgLabel(t.page), section: t.section },
            chapter: t.chapter,
            more: others.map((p) => ({
              body: p.text,
              source: { doc: p.doc, n: p.n, page: p.page, pageLabel: pgLabel(p.page), section: p.section }
            })),
            related: gl
              ? {
                  term: gl.entry.term,
                  definition: gl.entry.definition,
                  pageLabel: pgLabel(gl.entry.page),
                  doc: gl.entry.doc,
                  n: gl.entry.n
                }
              : null
          },
          hits
        };
      }
    }

    if (!q.length) {
      return { answer: null, hits: [], hint: 'Skriv en fråga, till exempel "vilka vitaminer är fettlösliga?".' };
    }

    if (!hits.length) {
      return {
        answer: null,
        hits: [],
        hint: 'Jag hittar inget om det i de här sidorna. Prova andra ord – eller bläddra bland begreppen.'
      };
    }

    const bestOverall = hits[0];

    /* Frågar man "vad är en ester?" ska begreppslistan svara, inte en bisats. */
    if (bestOverall.kind === 'glossary' && norm(query).includes(norm(bestOverall.section))) {
      const entry = glossaryUnits.find((g) => g.term === bestOverall.section);
      return {
        answer: {
          lead: bestOverall.section,
          body: entry ? entry.definition : bestOverall.text,
          source: {
            doc: bestOverall.doc,
            n: bestOverall.n,
            page: bestOverall.page,
            pageLabel: bestOverall.pageLabel,
            section: 'Begrepp'
          },
          chapter: '',
          more: hits
            .filter((h) => h.kind === 'note' && h.score >= bestOverall.score * 0.5)
            .slice(0, 2)
            .map((h) => ({
              body: h.text,
              source: { doc: h.doc, n: h.n, page: h.page, pageLabel: h.pageLabel, section: h.section }
            }))
        },
        hits
      };
    }

    const notes0 = hits.filter((h) => h.kind === 'note');
    const relevant = notes0.filter((h) => h.score >= bestOverall.score * 0.6);
    const top = (relevant.length ? relevant : hits).slice(0, 3);
    const best = top[0];
    return {
      answer: {
        lead: best.section || best.chapter || 'Ur boken',
        body: best.text,
        source: { doc: best.doc, n: best.n, page: best.page, pageLabel: best.pageLabel, section: best.section },
        chapter: best.chapter,
        more: top.slice(1).map((h) => ({
          body: h.text,
          source: { doc: h.doc, n: h.n, page: h.page, pageLabel: h.pageLabel, section: h.section }
        })),
        related: gl
          ? {
              term: gl.entry.term,
              definition: gl.entry.definition,
              pageLabel: pgLabel(gl.entry.page),
              doc: gl.entry.doc,
              n: gl.entry.n
            }
          : null
      },
      hits
    };
  }

  const chapters = notes.chapters.map((c) => ({
    id: c.id,
    doc: c.doc,
    title: c.title,
    pages: c.pages,
    intro: c.intro,
    mal: c.mal,
    first: c.first,
    pagesTotal: pages.filter((p) => p.doc === c.doc).length,
    sections: c.sections.map((s) => ({ title: s.title, where: s.where, points: s.points.length }))
  }));

  function pageData(doc, n) {
    const page = pageIndex.get(doc + ':' + n);
    if (!page) return null;
    const chapter = chapters.find((c) => c.doc === doc) || null;
    return {
      doc,
      n,
      page: page.page,
      pageLabel: pgLabel(page.page),
      img: page.img,
      chapterId: chapter ? chapter.id : '',
      chapterTitle: chapter ? chapter.title : '',
      paragraphs: page.paragraphs || []
    };
  }

  const quiz = (notes.quiz || []).map((item, index) => ({ ...item, id: index }));

  return {
    id,
    meta,
    notes,
    pages,
    pageIndex,
    units,
    chapters,
    search,
    ask,
    pageData,
    glossary: notes.glossary || [],
    quiz,
    docOrder: [...new Set(pages.map((p) => p.doc))],
    counts: {
      pageCount: pages.length,
      glossaryCount: (notes.glossary || []).length,
      quizCount: quiz.length
    }
  };
}
