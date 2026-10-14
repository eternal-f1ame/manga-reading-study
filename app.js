/* The reading study's screens (docs/paper/human_eval_protocol.md, "What the reader sees"). The logic that tests can pin lives in
   core.js (StudyCore); the browser tests (tests/e2e/human_study.e2e.mjs) drive these screens through their data-test hooks. */
(function () {
  'use strict';
  const C = window.StudyCore;
  const CFG = Object.assign({submit: '', contact: 'the study team', itemsSha: '', study: C.STUDY}, window.STUDY || {});
  const KEY = C.STUDY;                                         // the browser storage key
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const touch = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || 'ontouchstart' in window;
  const tap = touch ? 'Tap' : 'Click';
  let PKG = null, S = null, storageOk = true, clock = null, paused = null;

  // ---------- storage: every action saves; a blocked storage keeps the work in memory and says so ----------
  function probeStorage() {
    try { const k = KEY + '-probe'; localStorage.setItem(k, '1'); localStorage.removeItem(k); return true; } catch (e) { return false; }
  }
  function load() {
    if (!storageOk) return null;
    try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  function save() {
    if (!storageOk) return;
    try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { storageOk = false; $('#warn').hidden = false; }
  }

  function uuidFallback() {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function fresh() {
    const cryptoObj = window.crypto && crypto.randomUUID ? crypto : {randomUUID: uuidFallback};
    return {v: 1, itemsSha: CFG.itemsSha, participant: C.newParticipant(cryptoObj), background: '', firstVersion: null, manga: '',
      consent: false, block: null, assigned: '', plan: null, screen: 'welcome', i1: 0, c2: 0, e2: -1,
      answers1: {}, answers2: {}, marks: {}, around: {}, ms: {}, chapterMs: {}, practice: {mangaqa: null, mtg: null},
      started1: null, finished1: null, started2: null, finished2: null, stopped: false, sent: {}, errors: {}, feedback: ''};
  }

  // ---------- timing: an item's time counts only while it is on the screen and the tab is visible ----------
  function startClock(id, chapter) {
    stopClock();
    clock = {id: id, chapter: chapter, since: Date.now()};
  }
  function stopClock() {
    if (!clock) return;
    const dt = Date.now() - clock.since;
    if (clock.id) S.ms[clock.id] = (S.ms[clock.id] || 0) + dt;
    if (clock.chapter) S.chapterMs[clock.chapter] = (S.chapterMs[clock.chapter] || 0) + dt;
    clock = null;
    save();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { paused = clock && {id: clock.id, chapter: clock.chapter}; stopClock(); }
    else if (paused) { startClock(paused.id, paused.chapter); paused = null; }
  });

  // ---------- small helpers ----------
  const byId = id => PKG.mangaqa.find(q => q.id === id);
  const chapterOf = key => PKG.mtg.find(c => c.key === key);
  const eventOf = id => { for (const c of PKG.mtg) { const e = c.events.find(x => x.id === id); if (e) return e; } return null; };
  function planValid(plan) {
    return plan.part1.every(id => byId(id)) && plan.part2.every(c => chapterOf(c.key) && c.events.every(id => eventOf(id)));
  }
  function main(html) {
    const m = $('#main');
    m.innerHTML = html;
    m.scrollTop = 0;
    wireImages(m);
  }
  function on(sel, fn) { const el = $(sel); if (el) el.addEventListener('click', fn); }
  function notice(text) {
    const n = $('#notice');
    n.textContent = text || '';
    n.hidden = !text;
  }
  // The next questions' pages load while the reader works, so the next scene shows at once.
  const preloaded = new Set();
  function preload(srcs) {
    for (const src of srcs) {
      if (preloaded.has(src)) continue;
      preloaded.add(src);
      const im = new Image();
      im.decoding = 'async';
      im.src = src;
    }
  }
  function img(src, alt) { return `<span class="imgwrap"><img src="${esc(src)}" alt="${esc(alt)}" decoding="async"></span>`; }
  function wireImages(root) {
    $$('img', root).forEach(im => {
      if (im.dataset.wired) return;
      im.dataset.wired = '1';
      im.addEventListener('error', () => imgFail(im));
    });
  }
  function imgFail(im) {
    const wrap = im.closest('.imgwrap') || im.parentNode;
    const src = im.getAttribute('src').split('?')[0], alt = im.getAttribute('alt') || 'Page';
    const box = document.createElement('span');
    box.className = 'imgfail';
    box.innerHTML = `<span>${esc(alt)} did not load.</span><button class="btn" type="button" data-test="img-retry">Try again</button>`;
    wrap.replaceChildren(box);
    box.querySelector('button').addEventListener('click', e => {
      e.stopPropagation();
      wrap.innerHTML = `<img src="${esc(src)}?retry=${Date.now()}" alt="${esc(alt)}" decoding="async">`;
      wireImages(wrap);
    });
  }
  function faces(list) {
    if (!list || !list.length) return '';
    return `<div class="faces" aria-label="Who is who">${list.map(p => `<figure class="face">${img(p.img, p.name)}<figcaption>${esc(p.name)}</figcaption></figure>`).join('')}</div>
      <p class="hint small">These pictures show who is who. They come from other chapters.</p>`;
  }
  // The consent's contact; an email address becomes a mail link.
  function contact() {
    const c = String(CFG.contact || '');
    return /^[^@\s<>"']+@[^@\s<>"']+\.[^@\s<>"']+$/.test(c) ? `<a href="mailto:${esc(c)}">${esc(c)}</a>` : esc(c);
  }
  function screenInfo() { return {w: innerWidth, h: innerHeight, touch: !!touch}; }
  function withDetail(s) {
    const a1 = {}, a2 = {};
    for (const [id, a] of Object.entries(s.answers1)) a1[id] = {choice: a.choice, order: s.plan.orders[id], ms: s.ms[id] || 0, around: !!s.around[id], skipped: !!a.skipped};
    for (const [id, a] of Object.entries(s.answers2)) a2[id] = {pages: a.pages, ms: s.ms[id] || 0, skipped: !!a.skipped};
    return Object.assign({}, s, {answers1: a1, answers2: a2});
  }
  const ctx = () => ({itemsSha: CFG.itemsSha, screen: screenInfo()});

  // ---------- header ----------
  function header() {
    let where = '', done = 0, total = 0, part = 0;
    if (S.plan) {
      total = S.plan.part1.length + S.plan.part2.reduce((n, c) => n + c.events.length, 0);
      done = Object.keys(S.answers1).length + Object.keys(S.answers2).length;
    }
    if (S.screen === 'part1') { where = `Part 1 · ${S.i1 + 1} of ${S.plan.part1.length}`; part = 1; }
    else if (S.screen === 'part2') {
      const c = S.plan.part2[S.c2];
      where = `Part 2 · chapter ${S.c2 + 1} of ${S.plan.part2.length}` + (S.e2 >= 0 ? ` · event ${S.e2 + 1} of ${c.events.length}` : '');
      part = 2;
    }
    else if (S.screen === 'practice1') { where = 'Practice'; part = 1; }
    else if (S.screen === 'practice2') { where = 'Practice'; part = 2; }
    $('#where').textContent = where;
    $('#prog').style.width = total ? (100 * done / total) + '%' : '0';
    $('#left').textContent = part && S.plan ? `About ${C.minutesLeft(S, S.plan, part)} min left in this part` : '';
    $('#saveCopy').hidden = !S.plan;
  }

  // ---------- the screens ----------
  function render() {
    notice('');
    header();
    const screens = {welcome, consent, about, practice1, part1, break: breakScreen, practice2, part2, thanks};
    (screens[S.screen] || welcome)();
  }

  function welcome() {
    main(`<div class="mid"><div class="card">
      <h1>A study about reading manga</h1>
      <p>You read pages from a manga and answer questions about them. The study has two parts:</p>
      <ul>
        <li><b>Part 1</b>, about 18 minutes: 30 questions about scenes.</li>
        <li><b>Part 2</b>, about 13 minutes: you read 2 short chapters and mark the pages that show 8 events.</li>
      </ul>
      <p>A laptop or a tablet is best. This browser keeps your answers while you work, so you can stop and continue later with the same link.</p>
      <div class="row"><button class="btn primary" data-test="start">Start</button></div>
    </div></div>`);
    on('[data-test=start]', () => { S.screen = 'consent'; save(); render(); });
  }

  function consent() {
    main(`<div class="mid"><div class="card">
      <h1>Before you start</h1>
      <div class="consent">
        <p>This is a research study about how people read comics. You will answer questions about manga pages and mark the pages that show events. It takes about 30 minutes in two parts.</p>
        <p>Taking part is voluntary, and you can stop at any time. We do not ask for your name or for any other personal information. We store your answers, how long each answer took and the answers you give on the next screen in a spreadsheet that only the research team can open, and we publish only results over all readers.</p>
        <p>The pages come from the manga Re:Zero. Please do not copy or share them.</p>
        <p>To have your answers removed, write to the contact below with the participant code that this site shows at the end.</p>
        <p><b>Contact:</b> ${contact()}</p>
      </div>
      <label class="check"><input type="checkbox" data-test="consent" id="ok"> I am 18 years or older, I have read this text, and I agree to take part.</label>
      <div class="row"><button class="btn primary" data-test="agree" id="agree" disabled>I agree</button></div>
    </div></div>`);
    $('#ok').addEventListener('change', e => { $('#agree').disabled = !e.target.checked; });
    on('#agree', () => { S.consent = true; S.screen = 'about'; save(); render(); });
  }

  function about() {
    const sel = (cur, v) => cur === v ? ' sel' : '';
    main(`<div class="mid"><div class="card">
      <h1>About you</h1>
      <h2>Did you read or watch Re:Zero before this study?</h2>
      <div class="choices">
        <button class="choice${sel(S.background, 'naive')}" data-test="bg-naive" data-bg="naive"><b>No.</b> I do not know this story.</button>
        <button class="choice${sel(S.background, 'familiar')}" data-test="bg-familiar" data-bg="familiar"><b>Yes.</b> I know this story or its characters.</button>
      </div>
      <h2>Did you take part in the first version of this study, in September 2026?</h2>
      <div class="inline">
        <button class="choice${S.firstVersion === false ? ' sel' : ''}" data-test="first-no" data-first="no">No</button>
        <button class="choice${S.firstVersion === true ? ' sel' : ''}" data-test="first-yes" data-first="yes">Yes</button>
      </div>
      <h2>How often do you read manga or comics? <span class="hint">(optional)</span></h2>
      <div class="inline">${['never', 'sometimes', 'often'].map(v => `<button class="choice${sel(S.manga, v)}" data-test="manga-${v}" data-manga="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div>
      <div class="row"><button class="btn primary" data-test="about-next" id="next">Continue</button></div>
    </div></div>`);
    $$('[data-bg]').forEach(b => b.addEventListener('click', () => { S.background = b.dataset.bg; save(); about(); }));
    $$('[data-first]').forEach(b => b.addEventListener('click', () => { S.firstVersion = b.dataset.first === 'yes'; save(); about(); }));
    $$('[data-manga]').forEach(b => b.addEventListener('click', () => { S.manga = S.manga === b.dataset.manga ? '' : b.dataset.manga; save(); about(); }));
    on('#next', async () => {
      if (!S.background) return notice('Please answer the question about Re:Zero.');
      if (S.firstVersion === null) return notice('Please answer the question about the first version of this study.');
      main('<div class="mid"><div class="card"><p>Preparing your questions…</p></div></div>');
      if (!S.block) {
        const a = await C.assign(CFG.submit || 'collect', (u, i) => fetch(u, i), C.rng(S.participant + '|block'));
        S.block = a.block;
        S.assigned = a.assigned;
      }
      S.plan = C.readerPlan(PKG, S.participant, S.block);
      S.screen = 'practice1';
      save();
      render();
    });
  }

  // Part 1 and its practice share one screen: the pages on the left; the question, the options and the portraits on the right.
  function questionScreen(q, o) {
    const shown = !!S.around[q.id];
    const before = shown ? q.around.filter(p => p.n < q.evidence[0].n) : [];
    const after = shown ? q.around.filter(p => p.n > q.evidence[q.evidence.length - 1].n) : [];
    const pages = before.map(p => [p, 'ctx', 'Before the scene']).concat(q.evidence.map(p => [p, '', 'The scene'])).concat(after.map(p => [p, 'ctx', 'After the scene']));
    const fb = o.feedback;
    main(`<div class="work">
      <section class="pages" id="pages" aria-label="The pages of the scene">${pages.map(([p, cls, cap], k) => `
        <figure class="page ${cls}"><button class="open" data-open="${k}" aria-label="Read page ${p.n} large">${img(p.img, 'Page ' + p.n)}</button><figcaption>${cap} · page ${p.n}</figcaption></figure>`).join('')}
      </section>
      <aside class="side">
        <div class="tags"><span class="tag">${o.label}</span></div>
        <p class="q">${esc(q.question)}</p>
        <div class="opts">${o.order.map((i, k) => `
          <button class="opt${o.chosen === i ? ' sel' : ''}${fb && i === q.gold_index ? ' right' : ''}" data-test="option" data-index="${i}" ${fb ? 'disabled' : ''}><kbd>${k + 1}</kbd><span>${esc(q.options[i])}</span></button>`).join('')}
        </div>
        ${faces(q.portraits)}
        ${fb ? `<div class="feedback ${fb.right ? 'right' : 'wrong'}"><b>${fb.right ? 'Right.' : 'Not right.'}</b> The answer is: ${esc(fb.answer)}<br>
            <span class="hint">The real questions do not show the answer. If you cannot tell, push Skip. A skip helps the study. A guess does not.</span></div>
          <div class="row"><button class="btn primary" data-test="practice-next">Start Part 1</button></div>`
        : `<div class="row">
            ${q.around.length && !shown ? '<button class="btn" data-test="around">Pages around it</button>' : ''}
            ${o.onSkip ? '<button class="btn" data-test="skip">Skip</button>' : ''}
            ${o.onBack ? '<button class="btn" data-test="back">Back</button>' : ''}
          </div>
          <p class="hint">${touch ? `${tap} an answer.` : 'Push 1 to 4 to answer' + (o.onSkip ? ', S to skip' : '') + (o.onBack ? ' and the left arrow to go back' : '') + '.'} ${tap} a page to read it large.</p>`}
      </aside>
    </div>`);
    $$('[data-open]').forEach(b => b.addEventListener('click', () => openReader(pages.map(x => x[0]), +b.dataset.open, 'view', null, null)));
    $$('[data-test=option]').forEach(b => b.addEventListener('click', () => {
      if (b.disabled) return;
      $$('[data-test=option]').forEach(x => { x.classList.remove('sel'); x.disabled = true; });
      b.classList.add('sel');
      o.onPick(+b.dataset.index);
    }));
    on('[data-test=skip]', () => o.onSkip());
    on('[data-test=back]', () => o.onBack());
    on('[data-test=around]', () => { S.around[q.id] = true; save(); questionScreen(q, o); });
    on('[data-test=practice-next]', () => o.onDone());
  }

  function practiceOrder(q) { return C.shuffle(q.options.map((_, i) => i), C.rng(S.participant + '|practice')); }

  function practice1() {
    const q = PKG.practice.mangaqa, done = S.practice.mangaqa;
    questionScreen(q, {
      label: 'Practice question', order: practiceOrder(q), chosen: done ? done.choice : undefined,
      feedback: done ? {right: done.correct, answer: q.options[q.gold_index]} : null,
      onPick: i => { stopClock(); S.practice.mangaqa = {id: q.id, choice: i, correct: i === q.gold_index, ms: S.ms[q.id] || 0}; save(); setTimeout(render, 150); },
      onDone: () => { S.screen = 'part1'; S.started1 = S.started1 || new Date().toISOString(); save(); render(); },
    });
    if (!done) startClock(q.id, null);
  }

  function part1() {
    const id = S.plan.part1[S.i1], q = byId(id), a = S.answers1[id];
    questionScreen(q, {
      label: `Question <span data-test="qnum">${S.i1 + 1}</span> of ${S.plan.part1.length}`, order: S.plan.orders[id], chosen: a ? a.choice : undefined,
      onPick: i => { stopClock(); S.answers1[id] = {choice: i, skipped: false}; save(); setTimeout(nextQuestion, 300); },
      onSkip: () => { stopClock(); S.answers1[id] = {choice: null, skipped: true}; save(); nextQuestion(); },
      onBack: S.i1 > 0 ? () => { stopClock(); S.i1 -= 1; save(); render(); } : null,
    });
    startClock(id, null);
    preload(S.plan.part1.slice(S.i1 + 1, S.i1 + 3).flatMap(x => byId(x).evidence.map(p => p.img)));
  }
  function nextQuestion() {
    if (S.i1 < S.plan.part1.length - 1) { S.i1 += 1; save(); render(); return; }
    const missing = S.plan.part1.filter(x => !S.answers1[x]);
    if (missing.length) { S.i1 = S.plan.part1.indexOf(missing[0]); save(); render(); notice(`Answer or skip ${missing.length} more question(s) to finish Part 1.`); return; }
    finishPart(1);
  }

  // Part 2 and its practice share one screen: the chapter's pages as a grid on the left, the event on the right.
  function eventScreen(ev, pages, o) {
    const marks = new Set(S.marks[ev.id] || []);
    const gold = o.gold ? new Set(o.gold) : null;
    const list = [...marks].sort((x, y) => x - y);
    main(`<div class="work">
      <section class="grid" id="grid" aria-label="The pages of the chapter">${pages.map((p, k) => `
        <div class="thumb${marks.has(p.n) ? ' on' : ''}${gold && gold.has(p.n) ? ' gold' : ''}" data-test="thumb" data-page="${p.n}">
          <button class="open" data-open="${k}" aria-label="Read page ${p.n} large">${img(p.thumb || p.img, 'Page ' + p.n)}</button>
          <label class="mark"><input type="checkbox" data-test="mark" data-page="${p.n}"${marks.has(p.n) ? ' checked' : ''}${gold ? ' disabled' : ''}> Page ${p.n}</label>
        </div>`).join('')}
      </section>
      <aside class="side">
        <div class="tags"><span class="tag">${o.label}</span></div>
        <p class="q">${esc(ev.question)}</p>
        ${faces(ev.portraits)}
        <p class="marked" data-test="marked">${list.length ? `You marked page${list.length > 1 ? 's' : ''} ${list.join(', ')}.` : 'Mark every page that shows this event.'}</p>
        ${gold ? `<div class="feedback ${o.right ? 'right' : 'wrong'}"><b>These pages show the event: ${[...gold].sort((x, y) => x - y).join(', ')}.</b> They have a green frame.<br>
            <span class="hint">The real events do not show the answer. Mark every page that shows the event, and no other page.</span></div>
          <div class="row"><button class="btn primary" data-test="practice-next">Start Part 2</button></div>`
        : `<div class="row"><button class="btn primary" data-test="event-next">${o.nextLabel}</button>
            ${o.onSkip ? '<button class="btn" data-test="skip">Skip</button>' : ''}
            ${o.onBack ? '<button class="btn" data-test="back">Back</button>' : ''}</div>
          <p class="hint">${tap} a page to read it large. Tick the box under a page to mark it.</p>`}
      </aside>
    </div>`);
    $$('[data-open]').forEach(b => b.addEventListener('click', () => openReader(pages, +b.dataset.open, gold ? 'view' : 'event', ev, () => syncMarks(ev))));
    $$('[data-test=mark]').forEach(cb => cb.addEventListener('change', () => { toggleMark(ev.id, +cb.dataset.page, cb.checked); syncMarks(ev); }));
    on('[data-test=event-next]', () => {
      const m = S.marks[ev.id] || [];
      if (!m.length) return notice('Mark at least one page, or push Skip.');
      o.onNext(m.slice().sort((x, y) => x - y));
    });
    on('[data-test=skip]', () => o.onSkip());
    on('[data-test=back]', () => o.onBack());
    on('[data-test=practice-next]', () => o.onDone());
  }
  // A mark changes the grid in place, so the reader keeps the place where they scrolled to.
  function syncMarks(ev) {
    const marks = new Set(S.marks[ev.id] || []);
    $$('[data-test=thumb]').forEach(t => {
      const on = marks.has(+t.dataset.page);
      t.classList.toggle('on', on);
      const cb = $('input[data-test=mark]', t);
      if (cb) cb.checked = on;
    });
    const list = [...marks].sort((x, y) => x - y);
    const m = $('[data-test=marked]');
    if (m) m.textContent = list.length ? `You marked page${list.length > 1 ? 's' : ''} ${list.join(', ')}.` : 'Mark every page that shows this event.';
  }
  function toggleMark(id, n, value) {
    const s = new Set(S.marks[id] || []);
    if (value === undefined ? !s.has(n) : value) s.add(n); else s.delete(n);
    S.marks[id] = [...s];
    save();
  }

  function practice2() {
    const ex = PKG.practice.mtg, ev = ex.event, done = S.practice.mtg;
    eventScreen(ev, ex.pages, {
      label: 'Practice event', nextLabel: 'Done', gold: done ? ev.gold_pages : null, right: done && done.right,
      onNext: pages => {
        stopClock();
        const g = new Set(ev.gold_pages), inter = pages.filter(p => g.has(p)).length;
        S.practice.mtg = {id: ev.id, pages: pages, iou: inter / (new Set(pages.concat(ev.gold_pages)).size), right: inter === g.size && pages.length === g.size, ms: S.ms[ev.id] || 0};
        save(); render();
      },
      onDone: () => { S.screen = 'part2'; S.c2 = 0; S.e2 = -1; S.started2 = S.started2 || new Date().toISOString(); save(); render(); },
    });
    if (!done) startClock(ev.id, null);
  }

  function chapterIntro(c, ch) {
    main(`<div class="mid"><div class="card">
      <h1>Chapter ${S.c2 + 1} of ${S.plan.part2.length}</h1>
      <p>First, read this chapter. It has ${ch.pages.length} pages. Then mark the pages for ${c.events.length} events, one event at a time.</p>
      <p class="hint">In the reader, use the arrows${touch ? ' or swipe' : ' or the arrow keys'} to turn the pages. You can open any page again later.</p>
      <div class="row"><button class="btn primary" data-test="chapter-start">Start reading</button><button class="btn" data-test="chapter-skip-reading">Go to the events</button>
        ${S.c2 > 0 ? '<button class="btn" data-test="back">Back</button>' : ''}</div>
    </div></div>`);
    const toEvents = () => { S.e2 = 0; save(); render(); };
    on('[data-test=chapter-start]', () => openReader(ch.pages, 0, 'chapter', null, toEvents));
    on('[data-test=chapter-skip-reading]', toEvents);
    on('[data-test=back]', () => { stopClock(); S.c2 -= 1; S.e2 = S.plan.part2[S.c2].events.length - 1; save(); render(); });
    startClock(null, c.key);
  }

  function part2() {
    const c = S.plan.part2[S.c2], ch = chapterOf(c.key);
    if (S.e2 < 0) return chapterIntro(c, ch);
    const id = c.events[S.e2], ev = eventOf(id);
    const last = S.e2 === c.events.length - 1, lastChapter = S.c2 === S.plan.part2.length - 1;
    eventScreen(ev, ch.pages, {
      label: `Chapter ${S.c2 + 1} of ${S.plan.part2.length} · event <span data-test="enum">${S.e2 + 1}</span> of ${c.events.length}`,
      nextLabel: !last ? 'Next event' : !lastChapter ? 'Next chapter' : 'Finish Part 2',
      onNext: pages => { stopClock(); S.answers2[id] = {pages: pages, skipped: false}; advance2(); },
      onSkip: () => { stopClock(); S.answers2[id] = {pages: [], skipped: true}; advance2(); },
      onBack: () => { stopClock(); S.e2 -= 1; save(); render(); },
    });
    startClock(id, c.key);
  }
  function advance2() {
    const c = S.plan.part2[S.c2];
    if (S.e2 < c.events.length - 1) S.e2 += 1;
    else if (S.c2 < S.plan.part2.length - 1) { S.c2 += 1; S.e2 = -1; }
    else return finishPart(2);
    save();
    render();
  }

  // ---------- finishing and sending ----------
  function finishPart(part) {
    stopClock();
    if (part === 1) { S.finished1 = S.finished1 || new Date().toISOString(); S.screen = 'break'; }
    else { S.finished2 = S.finished2 || new Date().toISOString(); S.screen = 'thanks'; }
    save();
    render();
    sendPart(String(part));
  }
  async function sendPart(part) {
    S.sent[part] = 'sending';
    save();
    status();
    const msg = C.message(withDetail(S), part === 'feedback' ? 'feedback' : +part, ctx());
    const r = CFG.submit ? await C.send(CFG.submit, msg, (u, i) => fetch(u, i)) : {ok: false, error: 'no address to send to'};
    S.sent[part] = r.ok ? 'sent' : 'failed';
    S.errors[part] = r.ok ? '' : r.error;
    save();
    status();
  }
  function statusHtml(parts) {
    return parts.map(p => {
      const st = S.sent[p], name = p === 'feedback' ? 'Your message' : `Part ${p}`;
      if (st === 'sending') return `<p class="st">${name}: sending…</p>`;
      if (st === 'sent') return `<p class="st ok">${name}: ${p === 'feedback' ? 'it is sent. Thank you.' : 'your answers are sent.'}</p>`;
      if (st === 'failed') return `<div class="st bad">${name}: the answers could not be sent (${esc(S.errors[p])}).<br>
          <button class="btn" data-test="send-again" data-part="${p}">Send again</button><button class="btn" data-test="download">Download your answers</button>
          <p class="hint">If sending does not work, download the file and send it to ${contact()}.</p></div>`;
      return '';
    }).join('');
  }
  function statusParts() {
    if (S.screen === 'break') return ['1'];
    return ['1'].concat(S.finished2 ? ['2'] : []).concat(S.sent.feedback ? ['feedback'] : []);
  }
  function status() {
    const box = $('#status');
    if (!box) return;
    box.innerHTML = statusHtml(statusParts());
    $$('[data-test=send-again]', box).forEach(b => b.addEventListener('click', () => sendPart(b.dataset.part)));
    $$('[data-test=download]', box).forEach(b => b.addEventListener('click', download));
  }
  function download() {
    const s = withDetail(S), msgs = [];
    if (S.plan) msgs.push(C.message(s, 1, ctx()));
    if (S.started2) msgs.push(C.message(s, 2, ctx()));
    if (S.feedback) msgs.push(C.message(s, 'feedback', ctx()));
    const blob = new Blob([JSON.stringify({study: C.STUDY, downloaded: new Date().toISOString(), messages: msgs}, null, 1)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `reading-study-${S.participant.slice(0, 9)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function breakScreen() {
    main(`<div class="mid"><div class="card">
      <h1>Part 1 is done</h1>
      <div id="status" data-test="send-status" aria-live="polite"></div>
      <p>You can stop here. Your answers already help the study.</p>
      <p>Part 2 takes about ${C.minutesLeft(S, S.plan, 2)} minutes. You read 2 short chapters and mark the pages that show 8 events.</p>
      <div class="row"><button class="btn primary" data-test="continue-part2">Continue to Part 2</button><button class="btn" data-test="stop-here">Stop here</button></div>
    </div></div>`);
    status();
    on('[data-test=continue-part2]', () => { S.screen = 'practice2'; save(); render(); });
    on('[data-test=stop-here]', () => { S.stopped = true; S.screen = 'thanks'; save(); render(); });
  }

  function thanks() {
    main(`<div class="mid"><div class="card">
      <h1>Thank you</h1>
      <div id="status" data-test="send-status" aria-live="polite"></div>
      <p>Your participant code is <span class="code" data-test="participant-code">${esc(S.participant)}</span>. To have your answers removed, write to ${contact()} and give this code.</p>
      <p><label for="fb"><b>Do you want to tell us something?</b> (optional) For example, how long the study took, or what was not clear.</label></p>
      <textarea id="fb" data-test="feedback" maxlength="4000">${esc(S.feedback)}</textarea>
      <div class="row"><button class="btn" data-test="feedback-send">Send this message</button></div>
      ${S.stopped && !S.finished2 ? `<p class="hint">You stopped after Part 1. To do Part 2 later, open the same link in this browser.</p>
        <div class="row"><button class="btn" data-test="resume-part2">Do Part 2 now</button></div>` : ''}
    </div></div>`);
    status();
    on('[data-test=feedback-send]', () => {
      S.feedback = $('#fb').value.trim();
      if (!S.feedback) return notice('Type a message first.');
      sendPart('feedback');
    });
    on('[data-test=resume-part2]', () => { S.stopped = false; S.screen = 'practice2'; save(); render(); });
  }

  // ---------- the reading view: one page as large as the screen allows ----------
  const RV = {pages: [], k: 0, mode: 'view', ev: null, onClose: null};
  function openReader(pages, k, mode, ev, onClose) {
    Object.assign(RV, {pages: pages, k: k, mode: mode, ev: ev, onClose: onClose});
    $('#reader').hidden = false;
    document.body.classList.add('locked');
    drawReader();
    $('#rvClose').focus();
  }
  function drawReader() {
    const p = RV.pages[RV.k];
    $('#rvWhere').textContent = `Page ${p.n} · ${RV.k + 1} of ${RV.pages.length}`;
    $('#rvPage').innerHTML = img(p.img, 'Page ' + p.n);
    wireImages($('#rvPage'));
    const mk = $('#rvMark');
    mk.hidden = RV.mode !== 'event';
    if (RV.mode === 'event') {
      const on = (S.marks[RV.ev.id] || []).includes(p.n);
      mk.setAttribute('aria-pressed', String(on));
      mk.textContent = on ? 'Marked ✓' : 'Mark this page';
    }
    $('#rvPrev').disabled = RV.k === 0;
    $('#rvNext').disabled = RV.k === RV.pages.length - 1;
    preload(RV.pages.slice(RV.k + 1, RV.k + 3).map(x => x.img));
    $('#rvDone').hidden = RV.mode !== 'chapter';
    $('#rvHint').textContent = RV.mode === 'chapter' ? 'Read the whole chapter, then go to the events.' : RV.mode === 'event' ? 'Mark each page that shows the event.' : '';
  }
  function rvGo(d) { const k = RV.k + d; if (k >= 0 && k < RV.pages.length) { RV.k = k; drawReader(); } }
  function closeReader() {
    $('#reader').hidden = true;
    document.body.classList.remove('locked');
    const f = RV.onClose;
    RV.onClose = null;
    if (f) f();
  }
  $('#rvPrev').addEventListener('click', () => rvGo(-1));
  $('#rvNext').addEventListener('click', () => rvGo(1));
  $('#rvClose').addEventListener('click', closeReader);
  $('#rvDone').addEventListener('click', closeReader);
  $('#rvMark').addEventListener('click', () => { toggleMark(RV.ev.id, RV.pages[RV.k].n); drawReader(); });
  let touchX = null;
  $('#rvStage').addEventListener('touchstart', e => { touchX = e.touches.length === 1 ? e.touches[0].clientX : null; }, {passive: true});
  $('#rvStage').addEventListener('touchend', e => {
    if (touchX === null || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 60) rvGo(dx < 0 ? 1 : -1);
  });
  $('#saveCopy').addEventListener('click', download);

  // ---------- keys ----------
  addEventListener('keydown', e => {
    if (e.target.matches && e.target.matches('input[type=text], textarea')) return;
    if (!$('#reader').hidden) {
      if (e.key === 'ArrowRight') rvGo(1);
      else if (e.key === 'ArrowLeft') rvGo(-1);
      else if (e.key === 'Escape') closeReader();
      else if (e.key.toLowerCase() === 'm' && RV.mode === 'event') $('#rvMark').click();
      else return;
      e.preventDefault();
      return;
    }
    if (!S || (S.screen !== 'part1' && S.screen !== 'practice1')) return;
    const click = sel => { const b = $(sel); if (b && !b.disabled) { e.preventDefault(); b.click(); } };
    if (/^[1-9]$/.test(e.key)) { const b = $$('[data-test=option]')[+e.key - 1]; if (b && !b.disabled) { e.preventDefault(); b.click(); } }
    else if (e.key.toLowerCase() === 's') click('[data-test=skip]');
    else if (e.key === 'ArrowLeft') click('[data-test=back]');
    else if (e.key === 'ArrowRight' && S.screen === 'part1' && S.answers1[S.plan.part1[S.i1]] && S.i1 < S.plan.part1.length - 1) { e.preventDefault(); stopClock(); S.i1 += 1; save(); render(); }
    else if (e.key.toLowerCase() === 'z') click('[data-open]');
  });

  // ---------- start ----------
  async function boot() {
    storageOk = probeStorage();
    if (!storageOk) $('#warn').hidden = false;
    try {
      PKG = await (await fetch('items.json', {cache: 'no-cache'})).json();
    } catch (e) {
      main('<div class="mid"><div class="card"><h1>The study did not load</h1><p>Check your connection, then reload this page.</p></div></div>');
      return;
    }
    S = load();
    if (!S || S.v !== 1 || (S.plan && !planValid(S.plan))) S = fresh();
    save();
    render();
    for (const p of ['1', '2', 'feedback']) {           // a part that was finished but not sent (the tab closed while sending): send it again
      const finished = p === '1' ? S.finished1 : p === '2' ? S.finished2 : S.feedback;
      if (finished && S.sent[p] && S.sent[p] !== 'sent') sendPart(p);
    }
  }
  boot();
})();
