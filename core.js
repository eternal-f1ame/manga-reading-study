/* The reading study's logic, kept apart from the screens so that Node can test it (tests/js/human_study_core.test.mjs).
   Spec: docs/paper/human_eval_protocol.md. In the browser it is window.StudyCore; in Node, module.exports. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StudyCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const STUDY = 'reading-2026-10';
  const MAX_CHARS = 45000;                                  // the Sheet script's limit (a cell holds 50,000)
  const SECONDS = {question: 35, chapter: 240, event: 40};  // the protocol's time estimates

  // cyrb128 hashes the seed text into four 32-bit words, and sfc32 turns them into a generator (both public domain).
  function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
      k = str.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= (h2 ^ h3 ^ h4); h2 ^= h1; h3 ^= h1; h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
  }

  function sfc32(a, b, c, d) {
    return function () {
      a |= 0; b |= 0; c |= 0; d |= 0;
      const t = (a + b | 0) + d | 0;
      d = d + 1 | 0;
      a = b ^ b >>> 9;
      b = c + (c << 3) | 0;
      c = (c << 21 | c >>> 11);
      c = c + t | 0;
      return (t >>> 0) / 4294967296;
    };
  }

  /** A deterministic generator in [0, 1) for a seed text. */
  function rng(seedText) {
    const s = cyrb128(String(seedText));
    const r = sfc32(s[0], s[1], s[2], s[3]);
    for (let i = 0; i < 15; i++) r();
    return r;
  }

  /** A shuffled copy (Fisher-Yates). */
  function shuffle(list, rand) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /** A participant code: "r" and a random UUID, so the Sheet never reads it as a number. */
  function newParticipant(cryptoObj) {
    return 'r' + cryptoObj.randomUUID();
  }

  /** What one reader gets: the shared block and rotating block `block`, in an order seeded by the participant code. */
  function readerPlan(pkg, participant, block) {
    const rand = rng(participant + '|' + pkg.tag);
    const mine = b => b === 'S' || b === 'R' + block;
    const questions = pkg.mangaqa.filter(q => mine(q.block));
    const part1 = shuffle(questions.map(q => q.id), rand);
    const orders = {};
    for (const id of part1) {
      const q = questions.find(x => x.id === id);
      orders[id] = shuffle(Array.from({length: (q.options || [0, 0, 0, 0]).length}, (_, i) => i), rand);
    }
    const part2 = shuffle(pkg.mtg.filter(c => mine(c.block)), rand).map(c => ({key: c.key, events: shuffle(c.events.map(e => e.id), rand)}));
    return {block, part1, orders, part2};
  }

  /** Minutes left in part 1, part 2, or both (no part given), from the protocol's estimates. */
  function minutesLeft(state, plan, part) {
    const a1 = state.answers1 || {}, a2 = state.answers2 || {};
    const s1 = plan.part1.filter(id => !a1[id]).length * SECONDS.question;
    let s2 = 0;
    for (const c of plan.part2) {
      const left = c.events.filter(id => !a2[id]).length;
      if (left === c.events.length) s2 += SECONDS.chapter;     // not started: the chapter still has to be read
      s2 += left * SECONDS.event;
    }
    return Math.ceil((part === 1 ? s1 : part === 2 ? s2 : s1 + s2) / 60);
  }

  /** The message for a finished part (1 or 2) or for the feedback ("feedback"), in the protocol's format. */
  function message(state, part, ctx) {
    const practice = state.practice || {};
    const base = {study: STUDY, items_sha: ctx.itemsSha, participant: state.participant, background: state.background, first_version: !!state.firstVersion, manga: state.manga || '', block: state.block,
      assigned: state.assigned, part: part, screen: ctx.screen || {}};
    if (part === 1) return Object.assign(base, {started: state.started1, finished: state.finished1, answers: state.answers1 || {}, practice: practice.mangaqa || null});
    if (part === 2) return Object.assign(base, {started: state.started2, finished: state.finished2, answers: state.answers2 || {},
      chapter_ms: state.chapterMs || {}, practice: practice.mtg || null});
    return Object.assign(base, {feedback: String(state.feedback || '').slice(0, 4000)});
  }

  /** POST a message as text/plain (no CORS preflight). Retries network failures; stops at once when the script refuses the message. */
  async function send(url, payload, fetchFn, opts) {
    const tries = (opts && opts.tries) || 3;
    const waitMs = opts && opts.waitMs != null ? opts.waitMs : 1500;
    const body = JSON.stringify(payload);
    if (body.length > MAX_CHARS) return {ok: false, error: 'too large'};
    let last = 'network';
    for (let k = 0; k < tries; k++) {
      try {
        const r = await fetchFn(url, {method: 'POST', body: body});
        const j = await r.json().catch(() => null);
        if (j && j.ok === true) return {ok: true};
        if (j && j.ok === false) return {ok: false, error: String(j.error || 'refused')};
        last = r.ok ? 'bad reply' : 'status ' + r.status;
      } catch (e) {
        last = 'network';
      }
      if (k < tries - 1) await new Promise(res => setTimeout(res, waitMs * (k + 1)));
    }
    return {ok: false, error: last};
  }

  /** The reader's rotating block from the Sheet (handed out in turn); a random block when the Sheet cannot answer. */
  async function assign(url, fetchFn, rand) {
    try {
      const r = await fetchFn(url + (url.indexOf('?') < 0 ? '?' : '&') + 'action=assign');
      const j = await r.json();
      const b = Number(j && j.block);
      if (j && j.ok && (b === 1 || b === 2 || b === 3)) return {block: b, assigned: 'sheet'};
    } catch (e) { /* offline or blocked: fall back to a random block */ }
    return {block: 1 + Math.floor(rand() * 3), assigned: 'random'};
  }

  return {STUDY, SECONDS, rng, shuffle, newParticipant, readerPlan, minutesLeft, message, send, assign};
});
