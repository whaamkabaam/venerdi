/* Venerdì v8: Friday ideas, not a plan. Four photo questions turn into a loose sketch of her day
   (everything she picks goes on it at a rough time, inside the frame: the bags around 3, dinner
   around 7), played back on a DEPARTURES board (times and places only), then shown as story cards
   she can swap, remove and add to, with three dinner ideas on the evening card. Behind every choice,
   one tap away, a peek: the things in it, in photos, and a toggle to ask for one by name.
   Renders from window.SITE (data.js) and plan.js (the composer and the day builder), then wires the
   boards, the sky, HUD, map, persistence and sharing. Every visible string comes from content.json. */
(() => {
  'use strict';

  const { content: C, images: IMG = {}, map: MAP } = window.SITE;
  const P = window.VenerdiPlan;
  const U = C.ui;
  const DEPC = C.departures;
  const fmt = P.fmt;
  const toMin = P.toMin;
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const slot = (name) => $(`[data-slot="${name}"]`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const KEY = 'venerdi:v8:';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(KEY + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  // Once (spec 9.4, AM18): a v7 visitor's answers and note come over (a v6 visitor's answers when there
  // are no v7 ones), and her day is composed again, because a v7 day was cut by the calmer caps. The
  // things she added from the catalogue in v7 are kept here and go back on after the compose.
  let carried = [];
  try {
    if (localStorage.getItem(KEY + 'migrated') === null) {
      const v7 = localStorage.getItem('venerdi:v7:answers');
      const old = v7 !== null && v7 !== 'null' ? v7 : localStorage.getItem('venerdi:v6:answers');
      if (old !== null && localStorage.getItem(KEY + 'answers') === null) {
        localStorage.setItem(KEY + 'answers', old);
        const note = localStorage.getItem('venerdi:v7:note');
        if (v7 !== null && note !== null) localStorage.setItem(KEY + 'note', note);
        const v7picks = v7 !== null ? JSON.parse(localStorage.getItem('venerdi:v7:picks') || 'null') : null;
        carried = (Array.isArray(v7picks) ? v7picks : []).filter((p) => p && p.reason === 'added').map((p) => p.id);
      }
      localStorage.setItem(KEY + 'migrated', '1');
    }
  } catch { /* private mode */ }
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const OPT = Object.fromEntries(C.options.map((o) => [o.id, o]));
  const WHY = C.pickReasons;
  const PK = C.peek;
  const reasonLabel = (r) => (WHY[r] || WHY.added).label;
  // The three dinner ideas (spec 4): she picks one, or none.
  const IDEAS = C.dinners.ideas;
  const IDEA = Object.fromEntries(IDEAS.map((d) => [d.id, d]));
  // Haptics (web-haptics): a tick on a tile or a toggle, a firmer one on Show me Friday. Called inside the tap.
  const haptics = window.WebHaptics ? new window.WebHaptics() : null;
  const buzz = (p) => { try { haptics?.trigger(p)?.catch?.(() => {}); } catch { /* no haptics here */ } };

  const ICON = {
    out: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6.5 5H11v4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg class="i" viewBox="0 0 18 18" aria-hidden="true"><path d="m5 7 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg class="mark-off" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.75v8.5M7.75 12h8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    check: '<svg class="mark-on" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path class="tick" d="m7.5 12.4 3 3 6-6.7" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    tick: '<svg class="tick-i" viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 8.4 3 3 6.5-6.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    photos: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.75" y="1.75" width="5.5" height="5.5" rx="1.25" fill="currentColor"/><rect x="8.75" y="1.75" width="5.5" height="5.5" rx="1.25" fill="currentColor"/><rect x="1.75" y="8.75" width="5.5" height="5.5" rx="1.25" fill="currentColor"/><rect x="8.75" y="8.75" width="5.5" height="5.5" rx="1.25" fill="currentColor"/></svg>',
    close: '<svg class="i" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5 14.5 14.5M14.5 5.5 5.5 14.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
    back: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M13 8H3.5M7.5 4 3.5 8l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  /* ------------------------------------------------------------------ */
  /* Clock: Rome time, with an ?at= override so Felix can preview states */
  /* ------------------------------------------------------------------ */

  // ?at=2026-10-16T07:00 (Rome time unless an offset is given). Read before the query is stripped.
  const clockOffset = (() => {
    const at = new URLSearchParams(location.search).get('at');
    if (!at) return 0;
    const zone = C.meta.startsAt.slice(19); // "+02:00"
    const t = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(at) ? at : (at.length === 16 ? at + ':00' : at) + zone);
    return Number.isFinite(t) ? t - Date.now() : 0;
  })();
  const nowMs = () => Date.now() + clockOffset;
  const romeFmt = new Intl.DateTimeFormat('en-CA', { timeZone: C.meta.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function romeNow() {
    const p = Object.fromEntries(romeFmt.formatToParts(new Date(nowMs())).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
  }
  const isToday = () => romeNow().date === C.meta.date;

  /* ------------------------------------------------------------------ */
  /* Render helpers                                                      */
  /* ------------------------------------------------------------------ */

  const newTab = `<span class="sr-only"> (${esc(U.newTab)})</span>`;
  // Photos are decorative unless `alt` is set (the title next to them says what they are).
  // Missing photos keep a quiet colour block.
  function thumbHTML(key, cls, sizes, extra = '', { alt = false, loading = 'lazy' } = {}) {
    const im = key && IMG[key];
    if (!im) return `<span class="${cls} is-empty">${extra}</span>`;
    return `<span class="${cls}" style="--ph:${esc(im.color || '')}"><img src="${esc(im.src800)}" srcset="${esc(im.src800)} 800w, ${esc(im.src1600)} 1600w" sizes="${sizes}" width="${+im.w}" height="${+im.h}" alt="${alt ? esc(im.alt || '') : ''}" loading="${loading}" decoding="async" style="object-position:${esc(im.focal || '50% 50%')}">${extra}</span>`;
  }

  /* ------------------------------------------------------------------ */
  /* Split-flap engine                                                   */
  /* ------------------------------------------------------------------ */

  const FLAP = '<span class="flap"><span class="ft"><b></b></span><span class="fb"><b></b></span><span class="lt"><b></b></span><span class="lb"><b></b></span></span>';
  const flaps = new WeakMap();
  function flapOf(el) {
    let f = flaps.get(el);
    if (!f) {
      const [ft, fb, lt, lb] = el.children;
      f = { ft: ft.firstChild, fb: fb.firstChild, lt: lt.firstChild, lb: lb.firstChild, ltEl: lt, lbEl: lb, cur: '' };
      flaps.set(el, f);
    }
    return f;
  }
  function setFlap(f, ch) {
    f.ft.textContent = f.fb.textContent = f.lt.textContent = f.lb.textContent = ch;
    f.cur = ch;
  }
  // Where a leaf rests (measured, qa/v6/perf.md). Blink pays for every composited layer, so in Chrome a
  // leaf that has landed drops its transform and only flaps mid-flip are 3D. WebKit (Safari, every
  // iPhone browser) pays more to repaint the board around flat leaves than to keep each leaf on its own
  // layer, so there the leaves rest at rotateX(0) / -90deg, as in v5.
  const LEAF_LAYERS = navigator.vendor === 'Apple Computer, Inc.';
  const restFlat = (els) => { if (!LEAF_LAYERS) els.forEach((el) => { el.style.transform = ''; }); };
  // One flip: the upper leaf with the old glyph folds down, the lower leaf with the new glyph lands.
  // Resting flat, the upper leaf takes the new glyph too, so nothing moves when the transforms drop.
  function addFlip(tl, f, next, at, d) {
    tl.call(() => {
      f.lt.textContent = f.cur;
      f.ft.textContent = next;
      f.lb.textContent = next;
      gsap.set(f.lbEl, { rotationX: 90 });
    }, null, at);
    tl.fromTo(f.ltEl, { rotationX: 0 }, { rotationX: -90, duration: d, ease: 'power1.in', immediateRender: false }, at);
    tl.fromTo(f.lbEl, { rotationX: 90 }, { rotationX: 0, duration: d, ease: 'power1.out', immediateRender: false }, at + d);
    tl.call(() => { f.fb.textContent = next; f.cur = next; if (!LEAF_LAYERS) { f.lt.textContent = next; restFlat([f.ltEl, f.lbEl]); } }, null, at + 2 * d);
  }
  const GLYPHS = 'ABCDEFGHIJKLMNOPRSTUVZ0123456789';
  const randomGlyph = () => GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  // Board text: uppercase, accents dropped, only glyphs a flap carries (A-Z 0-9 space ' , . : + -).
  const boardText = (s, w) => Array.from(String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toUpperCase())
    .filter((ch) => /[A-Z0-9 ',.:+-]/.test(ch)).slice(0, w).join('');
  const cellChar = (s, k) => { const ch = Array.from(s)[k] || ''; return ch === ' ' ? '' : ch; };

  /* ------------------------------------------------------------------ */
  /* Boards: ARRIVALS (hero) and DEPARTURES share one row model          */
  /* ------------------------------------------------------------------ */

  // A row's data: { time, to, remark, kind, key, target, label, en }. ARRIVALS has three columns
  // (time | who | status); DEPARTURES has two (time | to), its egg caption under the TO cells.
  const KINDS = ['is-pick', 'is-anchor', 'is-tbc', 'is-sun', 'is-you'];
  const cellHTML = (cls, n, en = '') => `<span class="c c--${cls}" role="cell"><span class="sr-only"></span><span class="cells" aria-hidden="true">${FLAP.repeat(n)}</span>${en}</span>`;
  const EN = '<span class="note-en" aria-hidden="true"></span>';
  const rowHTML = (w) => `<div class="board-row" role="row">
      ${cellHTML('time', w[0])}${w.length > 2 ? cellHTML('who', w[1]) + cellHTML('note', w[2], EN) : cellHTML('who', w[1], EN)}
      <button type="button" class="board-hit" hidden></button>
    </div>`;
  function rowModel(el, widths) {
    return {
      el, widths,
      cols: $$('.cells', el).map((c) => [...c.children].map(flapOf)),
      srs: [...el.children].slice(0, widths.length).map((c) => c.firstElementChild),
      en: $('.note-en', el),
      hit: $('.board-hit', el),
      shown: widths.map(() => ''),
      data: null,
      tls: [],
    };
  }
  function makeBoard(host, { title, sub, label, columns, widths, rows, sun = false }) {
    const cls = ['time', 'who', 'note'];
    const two = widths.length === 2;
    host.innerHTML = `<div class="board">
      <div class="board-head"><p class="board-title">${esc(title)}</p><p class="board-sub label">${esc(sub)}</p></div>
      <div class="board-grid${two ? ' board-grid--two' : ''}" role="table" aria-label="${esc(label)}" style="--n1:${widths[0]};--n2:${widths[1]};--n3:${widths[2] || 0};--nw:${Math.max(widths[1], widths[2] || 0)}">
        <div class="board-colheads" role="row">${columns.map((c, i) => `<span class="ch c--${cls[i]} label" role="columnheader">${esc(c)}</span>`).join('')}</div>
        <div class="board-rows" role="rowgroup"></div>
        ${sun ? `<div class="dep-gap" aria-hidden="true"></div><div class="board-sun" role="rowgroup">${rowHTML(widths)}</div>` : ''}
      </div>
    </div>`;
    const B = { host, widths, rows: [], rowsEl: $('.board-rows', host) };
    B.ensure = (n) => {
      while (B.rows.length < n) { B.rowsEl.insertAdjacentHTML('beforeend', rowHTML(widths)); B.rows.push(rowModel(B.rowsEl.lastElementChild, widths)); }
      while (B.rows.length > n) { const r = B.rows.pop(); r.tls.forEach((t) => t.kill()); r.el.remove(); }
    };
    if (sun) B.sun = rowModel($('.board-sun .board-row', host), widths);
    B.ensure(rows);
    return B;
  }
  const rowTexts = (d, w) => w.map((n, c) => boardText(d ? [d.time, d.to, d.remark][c] : '', n));
  // Classes, screen-reader text, the tap target and the caption follow the row's data.
  function applyRowMeta(row, d) {
    row.data = d;
    KINDS.forEach((k) => row.el.classList.remove(k));
    if (d && d.kind) row.el.classList.add('is-' + d.kind);
    // A row with nothing on it (the spare one kept for her TBC line): the board shows plain black there.
    row.el.classList.toggle('is-empty', !d);
    const t = rowTexts(d, row.widths);
    const caption = d && d.en && d.enOn ? ` ${d.en}` : '';
    row.srs[0].textContent = d ? (d.srTime ?? d.time ?? '') : '';
    row.srs[1].textContent = d ? (d.label || d.to || '') + (row.srs.length > 2 ? '' : caption) : '';
    if (row.srs[2]) row.srs[2].textContent = d ? (d.remark || '') + caption : '';
    row.en.textContent = d && d.en ? d.en : '';
    row.en.classList.toggle('is-on', !!(d && d.enOn));
    const hasTarget = !!(d && d.target);
    row.hit.hidden = !hasTarget;
    if (hasTarget) row.hit.setAttribute('aria-label', d.hitLabel || fmt(U.boardHit, { time: d.time, to: String(d.label || d.to).replace(/\.$/, '') }));
    row.shownTexts = t;
  }
  function setRowNow(row, d) {
    row.tls.forEach((tl) => tl.progress(1).kill());
    row.tls = [];
    const t = rowTexts(d, row.widths);
    t.forEach((s, c) => { row.cols[c].forEach((f, k) => setFlap(f, cellChar(s, k))); row.shown[c] = s; });
    applyRowMeta(row, d);
  }
  // Flip a row to new data on a timeline, touching only the cells whose character changes.
  function flipRow(tl, row, d, at, { scramble = 1, D = 0.045, stagger = 0.012 } = {}) {
    tl.call(() => applyRowMeta(row, d), null, at);
    rowTexts(d, row.widths).forEach((next, c) => {
      const prev = row.shown[c];
      if (prev === next) return;
      row.cols[c].forEach((f, k) => {
        const a = cellChar(prev, k), b = cellChar(next, k);
        if (a === b) return;
        let when = at + k * stagger + (c === 2 ? 0.05 : 0);
        for (let s = 0; s < scramble; s++) { addFlip(tl, f, randomGlyph(), when, D); when += 2 * D; }
        addFlip(tl, f, b, when, D);
      });
      row.shown[c] = next;
    });
  }
  // A single quiet flip of one row, outside any replay (live statuses, eggs).
  function flipRowNow(row, d, opts = { scramble: 0, D: 0.07, stagger: 0.02 }) {
    if (reduced) { setRowNow(row, d); return; }
    const tl = gsap.timeline({ onComplete: () => { row.tls = row.tls.filter((x) => x !== tl); } });
    row.tls.push(tl);
    flipRow(tl, row, d, 0, opts);
  }

  /* ------------------------------------------------------------------ */
  /* ARRIVALS: live statuses (a row's tap egg, if content gives it one)  */
  /* ------------------------------------------------------------------ */

  const H = C.hero;
  const heroEgg = H.rows.map(() => false);
  const daysUntil = () => {
    const [y, m, d] = romeNow().date.split('-').map(Number), [Y, M, D] = C.meta.date.split('-').map(Number);
    return Math.round((Date.UTC(Y, M - 1, D) - Date.UTC(y, m - 1, d)) / 864e5);
  };
  // The last status whose `from` has passed wins; before the first, SASHA counts down.
  function heroStatus(r) {
    const t = nowMs();
    let text = null;
    for (const s of r.status || []) if (Date.parse(s.from) <= t) text = s.text;
    if (text === null && r.countdown) {
      const n = daysUntil();
      if (n === 1) text = H.countdownStatus.tomorrow;
      else if (n > 1) text = fmt(H.countdownStatus.days, { n });
    }
    return text ?? r.note;
  }
  const heroRowData = (r, i) => {
    const egg = heroEgg[i] && r.tap;
    const remark = egg ? r.tap.remark : heroStatus(r);
    return {
      time: r.time, to: r.who, remark, kind: r.highlight ? 'you' : 'anchor',
      en: r.tap ? r.tap.en : '', enOn: !!egg,
      target: r.tap ? 'egg' : null, hitLabel: `${r.who}, ${remark}`,
    };
  };
  // Every text a row can show, so the remark column never truncates.
  const heroWidths = () => {
    const variants = H.rows.flatMap((r) => [r.note, ...(r.status || []).map((s) => s.text), r.tap?.remark || '',
      ...(r.countdown ? [H.countdownStatus.tomorrow, fmt(H.countdownStatus.days, { n: 99 })] : [])]);
    return [Math.max(...H.rows.map((r) => [...r.time].length)), Math.max(...H.rows.map((r) => [...r.who].length)), Math.max(...variants.map((v) => [...v].length))];
  };
  let HERO = null;
  function renderHero() {
    HERO = makeBoard(slot('board'), {
      title: H.boardTitle, sub: H.boardSubtitle, label: `${H.boardTitle}, ${H.boardSubtitle}`,
      columns: H.columns, widths: heroWidths(), rows: H.rows.length,
    });
    slot('hero-title').textContent = U.pageTitle;
  }
  // First visit: the board flips in from blank. Later visits: it opens as it was and only changed cells flip.
  function heroIntro(tl, start) {
    const seen = store.get('heroSeen', null);
    const now = H.rows.map(heroRowData);
    if (seen && seen.length === now.length) {
      HERO.rows.forEach((row, i) => { setRowNow(row, { ...now[i], remark: seen[i] }); flipRow(tl, row, now[i], start + 0.4 + i * 0.12, { scramble: 0, D: 0.07, stagger: 0.02 }); });
    } else {
      const D = 0.045;
      HERO.rows.forEach((row, ri) => {
        setRowNow(row, null);
        tl.call(() => applyRowMeta(row, now[ri]), null, start);
        rowTexts(now[ri], row.widths).forEach((s, c) => {
          row.cols[c].forEach((f, k) => {
            let at = start + ri * 0.12 + Math.random() * 0.05;
            const n = 3 + Math.floor(Math.random() * 4);
            for (let j = 0; j < n; j++) { addFlip(tl, f, randomGlyph(), at, D); at += 2 * D; }
            addFlip(tl, f, cellChar(s, k), at, D);
          });
          row.shown[c] = s;
        });
      });
    }
    store.set('heroSeen', now.map((d) => d.remark));
  }
  function heroFinal() { HERO.rows.forEach((row, i) => setRowNow(row, heroRowData(H.rows[i], i))); store.set('heroSeen', HERO.rows.map((r) => r.data.remark)); }
  function heroTick() {
    HERO.rows.forEach((row, i) => {
      const d = heroRowData(H.rows[i], i);
      if (row.data && row.data.remark !== d.remark) flipRowNow(row, d); else if (row.data) applyRowMeta(row, d);
    });
    store.set('heroSeen', HERO.rows.map((r) => r.data && r.data.remark));
  }

  /* ------------------------------------------------------------------ */
  /* Static parts: note, send, footer                                    */
  /* ------------------------------------------------------------------ */

  function renderStatic() {
    const N = C.note;
    slot('note-title').textContent = U.noteTitle;
    slot('note').innerHTML = `<p class="note-greeting">${esc(N.greeting)}</p>${N.paras.map((p) => `<p>${esc(p)}</p>`).join('')}<p class="note-sign">${esc(N.sign)}</p>`;

    slot('ask-title').textContent = U.hud.ask;
    slot('dep-title').textContent = DEPC.srTitle;
    slot('dep-title').tabIndex = -1;
    const S = C.send;
    slot('free-label').textContent = S.label;
    slot('free-text').placeholder = S.placeholder;
    slot('send').textContent = S.button;

    slot('day-title').textContent = C.day.title;
    slot('change-answers').textContent = C.day.changeAnswers;
    slot('map-title').textContent = U.mapTitle;

    slot('hud').setAttribute('aria-label', U.hud.label);
    $$('main > section').forEach((sec) => { if (U.hud[sec.id]) sec.dataset.hud = U.hud[sec.id]; });
    slot('now-long').textContent = U.jumpNow;
    slot('now-short').textContent = U.jumpNowShort;
    $('.hud-now').setAttribute('aria-label', U.jumpNow);
  }

  /* ------------------------------------------------------------------ */
  /* The four questions: one stage, one step at a time                   */
  /* ------------------------------------------------------------------ */

  const ASK = C.ask;
  const STEPS = ASK.steps;
  const tileOption = (t) => (t.option ? OPT[t.option] : null);
  const tileLabel = (t) => t.label || tileOption(t)?.title || '';
  // A tile shows its own photo, else the first photo of the option it stands for.
  const tilePhoto = (t) => t.photo || OPT[t.photoOf || t.option]?.photos?.[0];
  // An option's own `tileSub` overrides the tile's sub.
  const tileSub = (t) => tileOption(t)?.tileSub || t.sub || '';
  // The wild card stores its option id (compose() takes it as is); the other steps store the tile id.
  const tileValue = (s, t) => (s.id === 'wild' ? t.option : t.id);
  const tileOf = (s, v) => s.tiles.find((t) => tileValue(s, t) === v);
  // `want`: the things she named in a peek (option ids, in the order she pressed them), and
  // `wantFrom`: the sight or food each was named under.
  const emptyAnswers = () => ({ ...Object.fromEntries(STEPS.map((s) => [s.id, s.multi ? [] : null])), want: [], wantFrom: {} });
  const cloneAnswers = (a) => ({ ...emptyAnswers(), ...JSON.parse(JSON.stringify(a || {})) });
  const chosen = (a, s) => { const v = a[s.id]; return Array.isArray(v) ? v : v ? [v] : []; };
  const counterText = (i) => fmt(ASK.counter, { n: i + 1, total: STEPS.length });
  const progressText = (i) => fmt(ASK.progress, { n: i + 1, total: STEPS.length });
  // The sights and foods she answered (the pick-any steps), in tap order.
  const vibesOf = (a) => STEPS.filter((s) => s.multi).flatMap((s) => a[s.id] || []);
  const serves = (o, reason) => !!(o && o.serves && reason in o.serves);
  // Every option behind a sight or a food, best first: what its peek lists.
  const servedBy = (reason) => C.options.filter((o) => serves(o, reason)).sort((a, b) => a.serves[reason] - b.serves[reason]);
  // Her named things under one sight or food (the same rule compose() uses).
  const wantsFor = (a, reason) => (a.want || []).filter((id) => OPT[id] && P.wantReason(OPT[id], a) === reason);
  // A thing named in v6 whose home moved in v7 (one home each, mechanics F2) brings its answer along:
  // its sight or food joins her answers (true: it stays a named thing, under that home); an area or a
  // wild card fills that step if she left it empty (false: it is that step's answer now).
  function rehome(a, id) {
    const k = Object.keys(OPT[id].serves || {})[0];
    if (!k) return false;
    if (k === 'wild' || k.startsWith('wander:')) {
      const s = STEPS.find((x) => x.id === (k === 'wild' ? 'wild' : 'wander'));
      const t = s && s.tiles.find((x) => x.option === id);
      if (t && !a[s.id]) a[s.id] = tileValue(s, t);
      return false;
    }
    const s = STEPS.find((x) => x.multi && tileOf(x, k));
    if (!s) return false;
    if (!a[s.id].includes(k)) a[s.id].push(k);
    a.wantFrom[id] = k;
    return true;
  }
  // Answers from storage or an old link, cut to what this page has: tiles that still exist, named
  // things that still exist and serve one of her answers (a v6 one whose home moved brings its home).
  const cleanAnswers = (a) => {
    const c = cloneAnswers(a);
    STEPS.forEach((s) => {
      if (s.multi) c[s.id] = (Array.isArray(c[s.id]) ? c[s.id] : []).filter((v, i, arr) => tileOf(s, v) && arr.indexOf(v) === i);
      else if (!tileOf(s, c[s.id])) c[s.id] = null;
    });
    c.wantFrom = c.wantFrom && typeof c.wantFrom === 'object' ? c.wantFrom : {};
    c.want = (Array.isArray(c.want) ? c.want : []).filter((id, i, arr) => OPT[id] && arr.indexOf(id) === i && (vibesOf(c).some((r) => serves(OPT[id], r)) || rehome(c, id)));
    c.wantFrom = Object.fromEntries(Object.entries(c.wantFrom || {}).filter(([id, r]) => c.want.includes(id) && vibesOf(c).includes(r) && serves(OPT[id], r)));
    return c;
  };
  // `draft` is what the open stage shows; `answers` (below) only changes on Show me Friday.
  const stage = { step: 0, open: true, draft: emptyAnswers(), tl: null, count: [], busy: false };

  // A tile is the photo, then its label and sub under it; the whole tile selects. Under the sub, a
  // sibling text button (never inside the tile) opens the peek: "See all 8" on the pick-any steps,
  // "Photos" on the pick-one steps. On the pick-one steps the none button is the grid's last cell.
  function stepHTML(s, i) {
    const lid = `ask-${esc(s.id)}-t`;
    const tiles = s.tiles.map((t, k) => {
      const state = s.multi ? 'aria-pressed="false"' : `role="radio" aria-checked="false" aria-posinset="${k + 1}" aria-setsize="${s.tiles.length}" tabindex="-1"`;
      const v = esc(tileValue(s, t));
      // "See all 8", "See both", or plain "Photos" when one thing is behind it.
      const n = s.multi ? servedBy(t.id).length : 1;
      const more = n === 1 ? PK.openPhotos : n === 2 ? PK.openTwo : fmt(PK.open, { n });
      return `<div class="tile-cell">
          <button type="button" class="tile" ${state} data-step="${i}" data-value="${v}">
            ${thumbHTML(tilePhoto(t), 'tile-photo', '(min-width: 1024px) 280px, (min-width: 640px) 31vw, 46vw', `<span class="tile-check" aria-hidden="true">${ICON.check}</span>`, { loading: i ? 'lazy' : 'eager' })}
            <span class="tile-label">${esc(tileLabel(t))}</span><span class="tile-sub">${esc(tileSub(t))}</span>
          </button>
          <button type="button" class="tile-more" data-step="${i}" data-value="${v}" aria-haspopup="dialog">${esc(more)}<span class="sr-only">: ${esc(tileLabel(t))}</span></button>
        </div>`;
    }).join('');
    // Laptop: four across. The none button fills the empty cells of the last row. When the tiles
    // would fill every row of four (the Wild card's 4), the step goes five across instead, so the none
    // button still closes the last row and the step fits one 900 px screen (qa/v7/build-notes.md).
    const n = s.tiles.length, cols = s.none && n % 4 === 0 ? 5 : 4;
    const span = s.none ? (cols - (n % cols)) || cols : 0;
    const none = s.none ? `<button type="button" class="step-none" data-action="none" style="--span:${span}">${esc(s.none)}</button>` : '';
    return `<fieldset class="step" data-step="${i}"${i ? ' hidden' : ''}>
        <legend class="step-title" id="${lid}" tabindex="-1"><span class="sr-only">${esc(progressText(i))}: </span>${esc(s.title)}</legend>
        <p class="step-hint">${esc(s.hint)}</p>
        <div class="tiles ${s.multi ? 'tiles--any' : 'tiles--one'}${n > 4 ? ' tiles--many' : ''}" style="--cols:${cols}"${s.multi ? ` role="group" aria-labelledby="${lid}"` : ''}>${tiles}${none}</div>
      </fieldset>`;
  }
  function renderStage() {
    const host = slot('stage');
    host.innerHTML = `<div class="stage-open">
        <div class="stage-count" aria-hidden="true">${FLAP.repeat(Array.from(counterText(STEPS.length - 1)).length)}</div>
        <div class="stage-steps">${STEPS.map(stepHTML).join('')}</div>
        <div class="stage-foot">
          <button type="button" class="btn stage-back" data-action="back">${ICON.back}${esc(ASK.back)}</button>
          <button type="button" class="btn stage-next" data-action="next"></button>
        </div>
      </div>
      <div class="stage-closed"><p class="stage-answers"></p><button type="button" class="btn btn--small" data-action="change">${esc(ASK.change)}</button></div>`;
    stage.count = $$('.stage-count .flap', host).map(flapOf);
    setCount(0, false);
    // The buttons appear once the first step's tiles are well in view (about 170 px of them), so the
    // first screen offers photos to tap, not a lone "Skip". (v7: the two-row ARRIVALS board is
    // shorter, so v6's 120 px would show the bar over the photos on load.)
    const showFoot = () => host.classList.add('is-foot');
    if (!('IntersectionObserver' in window)) { showFoot(); return; }
    const io = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { showFoot(); io.disconnect(); } }, { rootMargin: '0px 0px -168px 0px' });
    io.observe($('.step .tiles', host));
  }
  // The counter's flaps flip only where a character changes (D 0.07, like the HUD clock).
  function setCount(i, animate) {
    const text = counterText(i);
    stage.count.forEach((f, k) => {
      const ch = cellChar(text, k);
      if (f.tl) { f.tl.progress(1).kill(); f.tl = null; }
      if (f.cur === ch) return;
      if (!animate || reduced || !f.cur) { setFlap(f, ch); return; }
      f.tl = gsap.timeline({ onComplete: () => { f.tl = null; } });
      addFlip(f.tl, f, ch, k * 0.03, 0.07);
    });
  }
  // "Your answers: Old Rome (Pantheon), Pastries, Trastevere": the answer's own label on the pick-any
  // steps (as on the cards) with the things she named under it, the tile's label on the pick-one steps.
  const answersLine = (a) => {
    const labels = [];
    STEPS.forEach((s) => chosen(a, s).forEach((v) => {
      const t = tileOf(s, v);
      if (!t) return;
      const label = s.multi && WHY[v] ? WHY[v].label : tileLabel(t);
      const named = s.multi ? wantsFor(a, v).map((id) => OPT[id].title) : [];
      labels.push(named.length ? fmt(ASK.answerWants, { label, list: named.join(U.listJoin) }) : label);
    }));
    // Nothing answered (every step skipped): "You left it to me :)".
    return labels.length ? fmt(ASK.answers, { list: labels.join(U.listJoin) }) : ASK.answersNone;
  };
  // Tiles (and their subs), the primary button, Back, the counter's screen-reader text and the
  // closed line follow the state.
  function syncStage() {
    const host = slot('stage');
    const s = STEPS[stage.step];
    host.classList.toggle('is-closed', !stage.open);
    $('.stage-open', host).hidden = !stage.open;
    $('.stage-closed', host).hidden = stage.open;
    $('.stage-answers', host).textContent = answersLine(answers || stage.draft);
    $$('.tile', host).forEach((b) => {
      const st = STEPS[+b.dataset.step];
      const on = chosen(stage.draft, st).includes(b.dataset.value);
      b.setAttribute(st.multi ? 'aria-pressed' : 'aria-checked', String(on));
      // A sight or a food with things she named under it lists them in place of its sub.
      if (!st.multi) return;
      const w = on ? wantsFor(stage.draft, b.dataset.value) : [];
      const sub = w.length ? fmt(PK.wanted, { list: w.map((id) => OPT[id].title).join(U.listJoin) }) : tileSub(tileOf(st, b.dataset.value));
      const el = $('.tile-sub', b);
      if (el.textContent !== sub) el.textContent = sub;
    });
    // A set of radios is one tab stop: the checked tile, or the first.
    $$('.tiles--one', host).forEach((g) => {
      const tiles = $$('.tile', g);
      const cur = tiles.find((b) => b.getAttribute('aria-checked') === 'true') || tiles[0];
      tiles.forEach((b) => { b.tabIndex = b === cur ? 0 : -1; });
    });
    // Nothing picked: a quiet Skip. Something picked: Next, in the primary style. The last step
    // always reads Show me Friday.
    const last = stage.step === STEPS.length - 1;
    const any = chosen(stage.draft, s).length > 0;
    const next = $('.stage-next', host);
    next.textContent = last ? ASK.plan : any ? ASK.next : ASK.skip;
    next.classList.toggle('btn--primary', last || any);
    $('.stage-back', host).hidden = stage.step === 0;
    $('.stage-count', host).dataset.text = counterText(stage.step);
  }
  const hudBottom = () => (hud.hasAttribute('data-on') ? hud.getBoundingClientRect().bottom : 0);
  // Programmatic scrolls run on a short tween, so the sky and the HUD follow them like a real scroll.
  function scrollToY(y, duration, done) {
    y = Math.max(0, Math.min(y, ScrollTrigger.maxScroll(window)));
    if (reduced || Math.abs(y - scrollY) < 2) { scrollTo(0, y); if (done) done(); return; }
    const st = { y: scrollY };
    gsap.to(st, { y, duration, ease: 'power2.inOut', onUpdate: () => scrollTo(0, st.y), onComplete: done });
  }
  // Where a programmatic scroll lands a section: under the HUD, like an anchor jump. The HUD stays
  // away from the questions, so the stage only keeps a small gap.
  const scrollGap = () => parseFloat(getComputedStyle($('#ask')).scrollMarginTop) || 0;
  const ASK_GAP = 16;
  function goStep(to) {
    const host = slot('stage');
    const from = stage.step;
    if (to === from || to < 0 || to >= STEPS.length) return;
    if (stage.tl) { stage.tl.progress(1).kill(); stage.tl = null; }
    const fs = $$('.step', host);
    const out = fs[from], inn = fs[to];
    stage.step = to;
    stage.busy = true;
    setCount(to, true);
    syncStage();
    const land = () => { inn.hidden = false; $('.step-title', inn).focus({ preventScroll: true }); refreshSoon(); };
    if (reduced) { out.hidden = true; land(); stage.busy = false; return; }
    const parts = (f) => [$('.step-title', f), $('.step-hint', f), $('.step-none', f)].filter(Boolean);
    const run = () => {
      const tl = gsap.timeline({ onComplete: () => { stage.tl = null; stage.busy = false; } });
      stage.tl = tl;
      // Out: tiles fade and rise 8 px, staggered; in: tiles rise from 12 px; the title cross-fades.
      tl.to($$('.tile-cell', out), { opacity: 0, y: -8, duration: 0.15, stagger: 0.02, ease: 'power1.in' }, 0);
      tl.to(parts(out), { opacity: 0, duration: 0.15, ease: 'power1.in' }, 0);
      tl.call(() => { out.hidden = true; gsap.set([...$$('.tile-cell', out), ...parts(out)], { clearProps: 'opacity,transform' }); land(); });
      tl.fromTo(parts(inn), { opacity: 0 }, { opacity: 1, duration: 0.24, ease: 'power2.out', clearProps: 'opacity' });
      tl.fromTo($$('.tile-cell', inn), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', stagger: 0.04, clearProps: 'opacity,transform' }, '<');
    };
    // If the top of the stage has scrolled away, bring it back first.
    const top = host.getBoundingClientRect().top;
    if (top < hudBottom()) scrollToY(top + scrollY - ASK_GAP, 0.3, run); else run();
  }
  // Unselecting a sight or a food also lets go of the things she named under it.
  function dropWants(d, reason) {
    const gone = wantsFor(d, reason);
    d.want = d.want.filter((id) => !gone.includes(id));
    gone.forEach((id) => { delete d.wantFrom[id]; });
  }
  function onTile(b) {
    buzz('selection');
    const s = STEPS[+b.dataset.step];
    const v = b.dataset.value, d = stage.draft;
    if (s.multi) {
      if (d[s.id].includes(v)) { dropWants(d, v); d[s.id] = d[s.id].filter((x) => x !== v); } else d[s.id] = [...d[s.id], v];
    } else d[s.id] = d[s.id] === v ? null : v;
    syncStage();
  }
  // Arrow keys move through the radios and select as they go.
  function onStageKey(e) {
    const b = e.target.closest('.tiles--one .tile');
    if (!b) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const tiles = $$('.tile', b.closest('.tiles'));
    const next = tiles[(tiles.indexOf(b) + step + tiles.length) % tiles.length];
    const s = STEPS[+next.dataset.step];
    stage.draft[s.id] = next.dataset.value;
    syncStage();
    next.focus();
  }
  function onStageClick(e) {
    const more = e.target.closest('.tile-more');
    if (more) {
      const i = +more.dataset.step, s = STEPS[i], v = more.dataset.value;
      if (s.multi) openPeek(more, 'vibe', { step: i, value: v });
      else openPeek(more, 'pick', { step: i, value: v, id: tileOf(s, v).option });
      return;
    }
    const tile = e.target.closest('.tile');
    if (tile) { onTile(tile); return; }
    const a = e.target.closest('[data-action]')?.dataset.action;
    // Mid-transition the buttons already belong to the next step: a second quick tap waits.
    if (stage.busy && (a === 'next' || a === 'back' || a === 'none')) return;
    const last = stage.step === STEPS.length - 1;
    if (a === 'next') { if (last) planFriday(); else goStep(stage.step + 1); }
    else if (a === 'back') goStep(stage.step - 1);
    else if (a === 'none') {
      stage.draft[STEPS[stage.step].id] = null;
      syncStage();
      if (last) planFriday(); else goStep(stage.step + 1);
    } else if (a === 'change') openStage();
  }
  // "Change" and "Change answers": the stage opens on step 1 with her answers selected.
  function openStage() {
    const host = slot('stage');
    if (stage.tl) { stage.tl.progress(1).kill(); stage.tl = null; }
    stage.busy = false;
    stage.draft = cloneAnswers(answers);
    stage.step = 0;
    stage.open = true;
    $$('.step', host).forEach((f, i) => { f.hidden = i !== 0; });
    setCount(0, false);
    syncStage();
    refreshSoon();
    const sec = $('#ask');
    scrollToY(sec.getBoundingClientRect().top + scrollY - ASK_GAP, 0.5, () => $('.step-title', host).focus({ preventScroll: true }));
  }
  // Show me Friday: compose her answers, close the stage, glide to the board and let it play.
  function planFriday() {
    buzz('medium');
    answers = cloneAnswers(stage.draft);
    picks = P.compose(C, answers).picks;
    fromLink = false;
    hasBackup = false;
    undoDrop();
    saveState();
    stage.open = false;
    showDay();
    syncStage();
    update();
    // Focus follows her to the board (the button she pressed is hidden with the stage).
    slot('dep-title').focus({ preventScroll: true });
    const b = DEP.board.host;
    scrollToY(b.getBoundingClientRect().top + scrollY - scrollGap(), 0.6, () => { if (DEP.pending && boardInView()) maybePlay(); });
  }

  /* ------------------------------------------------------------------ */
  /* Picks: state (in board order), persistence, the link                */
  /* ------------------------------------------------------------------ */

  let answers = null;      // her answers as of the last Show me Friday (null until then)
  let picks = [];          // [{ id, reason }]: the order the board fills in; the replay and the link keep it
  let dinner = null;       // the dinner idea she picked (an id of C.dinners.ideas), or null for none
  let freeText = '';
  let fromLink = false;
  let plan = null;
  let hasBackup = false;
  const pickIds = () => picks.map((p) => p.id);
  const cleanPicks = (list) => (Array.isArray(list) ? list : []).filter((p, i, a) => p && OPT[p.id] && a.findIndex((q) => q && q.id === p.id) === i).map((p) => ({ id: p.id, reason: WHY[p.reason] ? p.reason : 'added' }));
  const cleanDinner = (id) => (typeof id === 'string' && IDEA[id] ? id : null);
  // What the answers compose to (kept while the answers stay the same): the build a full replay shows.
  let composedMemo = { key: null, res: null };
  const composed = () => {
    const key = JSON.stringify(answers);
    if (composedMemo.key !== key) composedMemo = { key, res: answers ? P.compose(C, answers) : { picks: [], extras: [] } };
    return composedMemo.res;
  };
  const composedIds = () => composed().picks.map((p) => p.id);
  // "More ideas" as it stands (worked out once per update).
  let roomNow = [];

  // Her answers in the link: one group per step, joined by "-": the pick-any steps as their
  // answers' letters, the pick-one steps as the tile's position (base 36); empty when skipped. A
  // fifth group, when she named things in a peek, holds their ids joined by "." in pressed order,
  // each after the letter of the sight or food she named it under: ar-pl-0-0-acolosseum.rpantheon
  // (an id with no letter, as in links from before, goes to the first answer it serves).
  const encodeAnswers = (a) => STEPS.map((s) => chosen(a, s).map((v) => (s.multi ? WHY[v]?.code || '' : s.tiles.findIndex((t) => tileValue(s, t) === v).toString(36))).join('')).join('-')
    + (a.want?.length ? `-${a.want.map((id) => (WHY[P.wantReason(OPT[id], a)]?.code || '') + id).join('.')}` : '');
  // A link without `v=7` or `v=8` is from v6: its pick-one steps hold positions in v6's tile lists, read
  // through these frozen tables (v7 and v8 share their tile lists, so they decode the same way). A v6 tile that is gone (the Appian Way, the film fest, the Domus) reads as none.
  const V6_TILES = {
    wander: ['trastevere', 'centre', 'aventine', 'appia', 'acquedotti', 'coppede', 'monti', 'ghetto'],
    wild: ['circovr', 'filmfest', 'domus', 'cannon', 'circusjog', 'coronati'],
  };
  function decodeAnswers(code, { v6 = false } = {}) {
    const a = emptyAnswers();
    const parts = String(code).split('-');
    parts.slice(0, STEPS.length).forEach((part, i) => {
      const s = STEPS[i];
      if (!part) return;
      if (s.multi) Array.from(part).forEach((c) => { const t = s.tiles.find((x) => WHY[x.id]?.code === c); if (t && !a[s.id].includes(t.id)) a[s.id].push(t.id); });
      else if (v6 && V6_TILES[s.id]) { const v = V6_TILES[s.id][parseInt(part, 36)]; if (tileOf(s, v)) a[s.id] = v; }
      else { const t = s.tiles[parseInt(part, 36)]; if (t) a[s.id] = tileValue(s, t); }
    });
    // Named things: ids the page does not know, or that serve none of her sights and foods, drop out.
    // A leading answer letter says which sight or food it was named under, if she answered that one.
    const byCode = Object.fromEntries(Object.entries(WHY).map(([k, v]) => [v.code, k]));
    String(parts[STEPS.length] || '').split('.').forEach((seg) => {
      const id = OPT[seg] ? seg : OPT[seg.slice(1)] ? seg.slice(1) : null;
      // A v6 link's named thing whose home moved brings its home along (mechanics F2).
      if (!id || a.want.includes(id) || !(vibesOf(a).some((r) => serves(OPT[id], r)) || (v6 && rehome(a, id)))) return;
      a.want.push(id);
      const from = id === seg ? null : byCode[seg[0]];
      if (from && vibesOf(a).includes(from) && serves(OPT[id], from)) a.wantFrom[id] = from;
    });
    return a;
  }

  // A link from before answers travelled with it (no `a`): rebuild the answers from the picks. Felix's
  // picks only ever come from the default day, which is what skipping every step gives.
  function answersFrom(list) {
    const a = emptyAnswers();
    if (list.some((p) => p.reason === 'felix')) return a;
    for (const p of list) {
      for (const s of STEPS) {
        if (s.multi && s.tiles.some((t) => t.id === p.reason) && !a[s.id].includes(p.reason)) a[s.id].push(p.reason);
        if (!s.multi && s.id === p.reason) { const t = s.tiles.find((x) => x.option === p.id); if (t) a[s.id] = tileValue(s, t); }
      }
    }
    return a;
  }

  function loadState() {
    const q = new URLSearchParams(location.search);
    if (q.has('p') || q.has('a')) {
      const byCode = Object.fromEntries(Object.entries(WHY).map(([k, v]) => [v.code, k]));
      const codes = Array.from(q.get('r') || '');
      let linkAnswers = q.has('a') ? decodeAnswers(q.get('a'), { v6: !['7', '8'].includes(q.get('v')) }) : null;
      // A link with answers but no picks composes them here, and so does a link whose picks name a
      // place this page no longer has (a v6 link with the Colosseum, say): its day comes from its answers.
      const linkIds = q.has('p') ? q.get('p').split(',').map((s) => s.trim()) : [];
      let linkPicks = q.has('p') ? cleanPicks(linkIds.map((id, i) => ({ id, reason: byCode[codes[i]] || 'added' }))) : null;
      if (!linkPicks || linkIds.some((id) => id && !OPT[id])) {
        // From the link's own ids and answer letters, before the gone places are cut (mechanics F6).
        linkAnswers = linkAnswers || answersFrom(linkIds.map((id, i) => ({ id, reason: byCode[codes[i]] || 'added' })));
        linkPicks = cleanPicks(P.compose(C, linkAnswers).picks);
      }
      const linkNote = q.get('n') || '';
      const linkDinner = cleanDinner(q.get('d'));
      // Keep her own day (and her dinner pick) before adopting the link's, so "Back to my picks" can restore it.
      const saved = store.get('picks', null), savedNote = store.get('note', ''), savedDinner = cleanDinner(store.get('dinner', null));
      const ids = (list) => list.map((p) => p.id).sort().join();
      const same = Array.isArray(saved) && ids(saved) === ids(linkPicks) && savedNote === linkNote && savedDinner === linkDinner;
      // The same link opened again (from the chat a second time): the day kept from the first time stays.
      if (same && store.get('fromLink', false)) hasBackup = !!store.get('before-link', null);
      else {
        hasBackup = Array.isArray(saved) && !same;
        store.set('before-link', hasBackup ? { picks: saved, note: savedNote, answers: store.get('answers', null), dinner: savedDinner } : null);
      }
      picks = linkPicks;
      answers = linkAnswers || answersFrom(linkPicks);
      freeText = linkNote;
      dinner = linkDinner;
      fromLink = true;
      saveState();
      // A link always replays its build in order, whatever this phone has seen before.
      store.set('depSeen', null);
      DEP.seen = null;
      // Drop the query at once, so a reload or a restored tab keeps her later edits.
      history.replaceState(null, '', location.pathname + location.hash);
      return;
    }
    picks = cleanPicks(store.get('picks', null));
    answers = store.get('answers', null);
    if (answers) answers = cleanAnswers(answers);
    freeText = store.get('note', '');
    dinner = cleanDinner(store.get('dinner', null));
    // Someone's link, opened earlier: the note and "Back to my picks" stay until the day changes.
    fromLink = !!store.get('fromLink', false);
    hasBackup = fromLink && !!store.get('before-link', null);
    // Answers with no day yet (read over from v7 or v6): compose it, then put back what she added in v7.
    if (answers && store.get('picks', null) === null) {
      picks = cleanPicks(P.compose(C, answers).picks);
      carried.forEach((id) => { if (OPT[id] && !OPT[id].fridayNo && !picks.some((p) => p.id === id)) picks.push({ id, reason: 'added' }); });
      saveState();
    }
  }
  function saveState() { store.set('picks', picks); store.set('answers', answers); store.set('note', freeText); store.set('dinner', dinner); store.set('fromLink', fromLink); }

  function backToMine() {
    const b = store.get('before-link', null);
    if (!b) return;
    picks = cleanPicks(b.picks);
    answers = b.answers ? cleanAnswers(b.answers) : null;
    freeText = b.note || '';
    dinner = cleanDinner(b.dinner);
    slot('free-text').value = freeText;
    fromLink = false;
    hasBackup = false;
    saveState();
    stage.draft = cloneAnswers(answers);
    undoDrop();
    syncStage();
    update();
  }

  // Links in chat apps end at the last "safe" character, so the note goes first, `p` (ids, in board
  // order) last, and ! ' ( ) * . are encoded too. `r` has one letter per pick: the answer it came from;
  // `d` is her dinner pick (absent for none), before `p` so a cut never loses it. The link carries a
  // capped copy of the note.
  const NOTE_LINK_MAX = 1000;
  const encodeNote = (s) => encodeURIComponent(s).replace(/[!'()*.]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  function linkURL() {
    const base = location.href.split(/[?#]/)[0];
    const n = Array.from(freeText.trim()).slice(0, NOTE_LINK_MAX).join('');
    const a = answers ? encodeAnswers(answers) : null;
    const r = picks.map((p) => (WHY[p.reason] || WHY.added).code).join('');
    return `${base}?v=8&${n ? `n=${encodeNote(n)}&` : ''}${a !== null ? `a=${a}&` : ''}${r ? `r=${r}&` : ''}${dinner ? `d=${dinner}&` : ''}p=${pickIds().join(',')}`;
  }
  // A mini timetable: "around 10:00 Maritozzo" per card on her day (its time as the card shows it:
  // "around" for a rough time, the bare time for an exact one), her dinner pick, then her line, then the
  // link. No prices. Something that can't happen on Friday has no card, so no line.
  function shareText() {
    const timeOf = (it) => (it.exact ? it.rough : fmt(U.around, { time: it.rough }));
    const stops = plan.items.filter((it) => it.kind === 'option').map((it) => `${timeOf(it)} ${it.option.title}`);
    const note = freeText.trim();
    // Only a note: send the note and the link, without the timetable frame.
    if (!stops.length && !dinner) return [note, linkURL()].filter(Boolean).join('\n');
    const lines = [C.send.shareIntro, ...stops];
    if (dinner) lines.push(fmt(C.send.shareDinner, { time: timeOf(plan.items.find((it) => it.id === 'dinner')), title: IDEA[dinner].title }));
    if (note) lines.push(`${C.send.shareExtra} ${note}`);
    lines.push(linkURL());
    return lines.join('\n');
  }
  // navigator.share is called synchronously inside the tap (WebKit needs the user activation).
  function send() {
    const text = shareText();
    if (navigator.share) {
      navigator.share({ title: U.shareTitle, text }).catch((err) => {
        if (!err || err.name !== 'AbortError') window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      });
      return;
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  }

  // Every change to her day goes through here: swap, remove, undo, add. Any change but a removal
  // (which offers its own Undo) ends a pending Undo, so Undo can never push a newer stop out.
  // Something that can't happen on Friday (only ever from an old or hand-made link) leaves her day
  // at her next change, and its "Sold out for Friday" line with it (spec 8.7).
  function setPicks(next, { keepUndo = false } = {}) {
    if (!keepUndo) undoDrop();
    picks = next.filter((p) => !OPT[p.id]?.fridayNo);
    fromLink = false;
    saveState();
    update();
  }

  /* ------------------------------------------------------------------ */
  /* DEPARTURES: rows (times and places only), the replay, the eggs     */
  /* ------------------------------------------------------------------ */

  // Two columns, TIME and TO (spec 6.2). TO gets 20 cells while the board is phone-narrow and 30 once
  // its grid is 560 px or wider (the container breakpoint the CSS uses), so the flaps stay about 10.7 px
  // on a phone and about 21 px on a laptop. `DW` follows the board's width (renderDepBoard, resizes).
  const DEP_WIDE = 560;
  let DW = [5, 20];
  const R = DEPC.rows;
  const anchorRow = (key, extra = {}) => ({ key, time: R[key].time, to: R[key].to, kind: 'anchor', ...extra });
  // The bags row: the time comes from the plan.
  const bagsRow = (it) => ({ key: 'bags', time: it.rough, to: R.bags.to, kind: 'anchor', target: 'bags', label: C.anchors.bags.title });
  // 19:00 DINNER, or the idea she picked (LI RIONI, DA REMO, DA IVO).
  const dinnerRow = () => anchorRow('dinner', { to: dinner ? IDEA[dinner].board : R.dinner.to, target: 'dinner', label: dinner ? IDEA[dinner].title : C.anchors.dinner.title });
  // Before her picks land, the board shows the day's frame: the bags, dinner, the early night.
  const skeletonRows = () => [bagsRow(P.build(C, []).items.find((it) => it.id === 'bags')), dinnerRow(), anchorRow('end', { target: 'end', label: C.anchors.end.title })];
  // SUN HALF MARATHON; the tap egg flips the TO text to HALBMARATHON with "(half marathon)" under it.
  const sundayRow = (egg) => {
    const S = DEPC.sunday;
    const to = egg ? S.egg.to : S.to;
    return { key: 'sunday', time: S.time, to, kind: 'sun', en: S.egg.en, enOn: !!egg, target: 'sunday', hitLabel: `${S.time}, ${to}` };
  };

  // Her free text as a TBC row: her words on the board, cut at the last space that fits. Emoji and other
  // glyphs a flap lacks drop out and the spaces around them collapse (a single long word is cut hard).
  function tbcRow() {
    const text = freeText.trim();
    if (!text) return null;
    const all = boardText(text, text.length).replace(/ +/g, ' ').trim();
    let to = all;
    if (all.length > DW[1]) { const cut = all.lastIndexOf(' ', DW[1]); to = cut > 0 ? all.slice(0, cut) : all.slice(0, DW[1]); }
    return { key: 'tbc', time: DEPC.tbc.time, to: to || DEPC.tbc.blank, kind: 'tbc', target: 'tbc', label: text, hitLabel: `${DEPC.tbc.time}, ${text}` };
  }

  // The board for a plan: every card of the day in display order (the plain lunch line as LUNCH), the
  // bags, her TBC line, dinner, the early night. Something that can't happen on Friday gets no row.
  function depRows(pl, { tbc = tbcRow() } = {}) {
    const rows = [];
    for (const it of pl.items) {
      if (it.kind === 'lunch-filler') rows.push({ key: 'lunch', time: it.rough, to: R.lunch.to, kind: 'anchor', target: 'lunch', label: C.day.noLunch });
      else if (it.kind === 'anchor' && it.id === 'bags') rows.push(bagsRow(it));
      // SECOND BREAKFAST keeps the option's title as its label, so the row's tap label names the place (AM19).
      else if (it.kind === 'option') rows.push({ key: it.id, time: it.rough, to: it.secondBreakfast ? DEPC.secondBreakfast : it.option.board.to, kind: 'pick', target: it.id, label: it.option.title });
      else if (it.kind === 'anchor' && it.id === 'dinner') {
        if (tbc) rows.push(tbc);
        rows.push(dinnerRow());
      } else if (it.kind === 'anchor' && it.id === 'end') {
        rows.push(anchorRow('end', { target: 'end', label: C.anchors.end.title }));
      }
    }
    return rows;
  }

  const DEP = { board: null, replay: null, seen: store.get('depSeen', null), sunEgg: false, shown: [], pending: false, sunPending: false, stats: null };
  const depSig = () => `${pickIds().join(',')}|${dinner || ''}|${freeText.trim()}`;
  const plainRows = (rows) => rows.map((r) => (r ? { time: r.time, to: r.to, kind: r.kind } : null));
  const sameRows = (a, b) => JSON.stringify(plainRows(a)) === JSON.stringify(plainRows(b));
  const gapEl = () => $('.dep-gap', DEP.board.host);

  // The TO width the board wants at its current size (the grid's own width, as the container query reads it).
  const depCells = () => {
    const grid = DEP.board && $('.board-grid', DEP.board.host);
    return grid && grid.clientWidth >= DEP_WIDE ? 30 : 20;
  };
  function renderDepBoard() {
    const build = () => {
      DEP.board = makeBoard(slot('dep-board'), {
        title: DEPC.title, sub: DEPC.sub, label: `${DEPC.title}, ${DEPC.sub}`,
        columns: DEPC.columns, widths: DW, rows: 0, sun: true,
      });
    };
    build();
    const want = depCells();
    if (want !== DW[1]) { DW = [5, want]; build(); }
  }
  // When the board crosses the breakpoint (a rotated phone, a resized window), it is built again with
  // the other cell count and shows its final rows at once (no replay).
  function resizeDepBoard() {
    if (!DEP.board) return;
    const want = depCells();
    if (want === DW[1]) return;
    const r = DEP.replay;
    stopReplay();
    const n = DEP.board.rows.length;
    DW = [5, want];
    renderDepBoard();
    if (r && r.done) r.done();
    if (!plan) return;
    const finalRows = depRows(plan);
    DEP.board.ensure(Math.max(n, finalRows.length + spare()));
    setBoardNow(finalRows);
    setSunNow(true);
    DEP.sunPending = false;
    DEP.pending = false;
    markSeen(r && r.fullPicks);
    refreshSoon();
  }
  // Before she plans, the page is the Arrivals board, the note and the questions. Her first Show me
  // Friday (or a link, or a day kept from an earlier visit) shows the rest and builds the board.
  let dayShown = false;
  let motionCtx = null;
  function showDay() {
    if (dayShown) return;
    dayShown = true;
    ['dep', 'day', 'send', 'map'].forEach((id) => { document.getElementById(id).hidden = false; });
    renderDepBoard();
    // Only a change of width matters; the rebuild waits for the next frame, so the observer never sees
    // a size change made inside its own callback.
    let seenW = 0;
    if ('ResizeObserver' in window) new ResizeObserver((es) => { const w = Math.round(es[0].contentRect.width); if (w === seenW) return; seenW = w; requestAnimationFrame(resizeDepBoard); }).observe(slot('dep-board'));
    if (motionCtx) motionCtx.add(depTriggers);
  }
  // GSAP's first tween on a leaf reads its computed style, so prime every leaf on the board before the
  // replay instead of in the middle of it (in Chrome the transform it writes is dropped at once).
  const boardLeaves = () => [...DEP.board.rows, DEP.board.sun].flatMap((row) => row.cols.flat()).flatMap((f) => [f.ltEl, f.lbEl]);
  function warmBoard() {
    const leaves = boardLeaves().filter((el) => !el._warm);
    leaves.forEach((el) => { el._warm = true; });
    if (leaves.length) { gsap.set(leaves, { rotationX: 0 }); restFlat(leaves); }
  }
  function setBoardNow(rows) {
    DEP.board.rows.forEach((row, i) => setRowNow(row, rows[i] || null));
    DEP.shown = rows;
  }
  // The Sunday row (blank before it lands).
  function setSunNow(on = true) {
    setRowNow(DEP.board.sun, on ? sundayRow(DEP.sunEgg) : null);
    gsap.set(gapEl(), { scaleX: on ? 1 : 0 });
  }
  // A spare row while her note is empty, so her TBC line takes it and the page never moves.
  const spare = () => (freeText.trim() ? 0 : 1);
  const slotsFor = (states) => Math.max(...states.map((s) => s.length)) + spare();
  // What the board last showed, and the composition last replayed in full (only a replay with at
  // least two picks counts, so a look at the empty board does not spend it).
  function markSeen(fullPicks = null) {
    DEP.seen = { sig: depSig(), rows: plainRows(DEP.shown), picks: pickIds(), fullPicks: fullPicks || DEP.seen?.fullPicks || null };
    store.set('depSeen', DEP.seen);
  }
  // A new composition (Plan Friday, or a link) replays in full; a swap, a removal, an addition, a
  // dinner pick or her note plays one diff wave. Before she plans, the board only ever diffs.
  function needsFull() {
    const s = DEP.seen;
    if (!s) return true;
    const want = composedIds();
    return want.length > 0 && (s.fullPicks || []).join() !== want.join();
  }
  function primeFull() {
    const states = replayStates();
    DEP.board.ensure(Math.max(DEP.board.rows.length, slotsFor(states)));
    setBoardNow(states[0]);
    setSunNow(false);
    DEP.sunPending = false;
    return states;
  }
  // The replay: one state per pick, in board order, each wave re-sorting the board as the day takes shape.
  function replayStates() {
    const order = pickIds();
    const finalRows = depRows(plan);
    if (!order.length) return [skeletonRows(), finalRows];
    return [skeletonRows(), ...order.map((_, i) => (i === order.length - 1 ? finalRows : depRows(P.build(C, order.slice(0, i + 1)), { tbc: null })))];
  }
  function stopReplay() {
    const r = DEP.replay;
    if (!r) return;
    r.stopping = true;
    r.tls.forEach((t) => t.progress(1).kill());
    if (DEP.sunPending) setSunNow(true);
    DEP.sunPending = false;
    r.meterOn = false;
    DEP.replay = null;
  }
  // Tap during a replay, or a test: jump to the end.
  function finishBoard() {
    if (!DEP.board) return;
    const r = DEP.replay;
    stopReplay();
    const finalRows = depRows(plan);
    DEP.board.ensure(Math.max(DEP.board.rows.length, finalRows.length + spare()));
    setBoardNow(finalRows);
    setSunNow(true);
    DEP.sunPending = false;
    if (r) r.done();
    markSeen(r && r.fullPicks);
    DEP.pending = false;
  }
  // One replay run: its timelines plus an rAF frame meter for the stats and the slow-phone fallback.
  const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * q)] : 0; };
  // `key`: where the stats go (the Sunday row on its own keeps them apart from the replay's).
  function newReplay(key = 'stats') {
    const r = { tls: [], frames: [], meterOn: true, scramble: 1, stopping: false };
    let last = performance.now();
    const t0 = last;
    const meter = (t) => { if (!r.meterOn) return; if (!r.paused) r.frames.push(t - last); last = t; requestAnimationFrame(meter); };
    requestAnimationFrame(meter);
    r.done = () => {
      if (!r.meterOn) return;
      r.meterOn = false;
      const f = r.frames;
      DEP[key] = f.length ? { frames: f.length, p50: +pct(f, 0.5).toFixed(1), p90: +pct(f, 0.9).toFixed(1), max: +Math.max(...f).toFixed(1), seconds: +((performance.now() - t0) / 1000).toFixed(2), scramble: r.scramble } : null;
    };
    DEP.replay = r;
    return r;
  }
  // The Sunday row counts as on screen once it is fully visible (or she has scrolled past it).
  const sunInView = () => DEP.board.sun.el.getBoundingClientRect().bottom <= innerHeight;
  // The Sunday row, after a short pause. It plays straight after the replay when it is on screen,
  // otherwise its own trigger plays it when she scrolls down to it (long boards).
  function playSun(r, pause) {
    DEP.sunPending = false;
    r = r || newReplay('sunStats');
    DEP.replay = r;
    const tl = gsap.timeline();
    r.tls.push(tl);
    tl.fromTo(gapEl(), { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: 'power2.out', immediateRender: false }, pause);
    flipRow(tl, DEP.board.sun, sundayRow(DEP.sunEgg), pause + 0.3, { scramble: 4, D: 0.06, stagger: 0.012 });
    tl.call(() => { r.done(); DEP.replay = null; markSeen(r.fullPicks); });
  }
  // Waves `from`.. of the replay on one timeline, built before it plays. Row models track the
  // state as each wave is added, so later waves only flip what actually changes.
  function buildWaves(r, states, from, scramble, startAt, full) {
    const waves = states.length - 1;
    const wave = Math.min(0.6, 3.2 / Math.max(1, waves));
    const tl = gsap.timeline({ paused: true });
    r.tls.push(tl);
    for (let s = from; s <= waves; s++) {
      const at = startAt + (s - from) * wave;
      DEP.board.rows.forEach((row, j) => flipRow(tl, row, states[s][j] || null, at + j * 0.05, { scramble }));
    }
    tl.call(() => {
      markSeen(r.stopping ? null : r.fullPicks);
      if (full) {
        DEP.sunPending = true;
        if (!r.stopping && sunInView()) { playSun(r, 0.4); return; }
      }
      r.done();
      DEP.replay = null;
    }, null, Math.max(startAt + (waves - from + 1) * wave, tl.duration()));
    return { tl, wave };
  }
  function playStates(states, { full }) {
    stopReplay();
    warmBoard();
    const r = newReplay();
    if (full) r.fullPicks = composedIds();
    DEP.pending = false;
    const { tl, wave } = buildWaves(r, states, 1, 1, 0.3, full);
    DEP.shown = states[states.length - 1];
    // Safety net for slow phones: if the first wave runs heavy (p90 over 40 ms, or barely any frames), the rest flips without scramble.
    if (states.length > 2) {
      tl.call(() => {
        if (r.stopping || (r.frames.length >= 6 && pct(r.frames, 0.9) <= 40)) return;
        tl.pause().kill();
        r.tls.splice(r.tls.indexOf(tl), 1);
        r.scramble = 0;
        // After this render pass: flips already under way in it may still write a glyph, so settle
        // every cell on wave 1 (leaves at rest) before the plain waves start.
        queueMicrotask(() => {
          if (r.stopping) return;
          gsap.set(boardLeaves(), { rotationX: 0 });
          restFlat(boardLeaves());
          setBoardNow(states[1]);
          buildWaves(r, states, 2, 0, 0.02, full).tl.play(0);
          DEP.shown = states[states.length - 1];
        });
      }, null, 0.3 + wave - 0.02);
    }
    tl.play(0);
  }
  // Off screen the replay waits, so a flick past the board does not spend it.
  function pauseReplay() { const r = DEP.replay; if (r && !r.paused) { r.paused = true; r.tls.forEach((t) => t.pause()); } }
  function resumeReplay() { const r = DEP.replay; if (r && r.paused) { r.paused = false; r.tls.forEach((t) => t.resume()); } }
  function maybeSun() { if (DEP.sunPending && !DEP.replay && !reduced) playSun(null, 0); }
  // When the board comes into view: replay her build the first time, one diff wave after a change.
  function maybePlay() {
    if (DEP.replay || !DEP.pending) return;
    if (reduced) { finishBoard(); return; }
    if (needsFull()) {
      playStates(primeFull(), { full: true });
    } else {
      const finalRows = depRows(plan);
      DEP.board.ensure(Math.max(DEP.board.rows.length, finalRows.length + spare()));
      playStates([DEP.shown, finalRows], { full: false });
    }
  }
  const boardInView = () => { const b = DEP.board.host.getBoundingClientRect(); return b.top < innerHeight * 0.85 && b.bottom > 80; };
  let depTimer = 0;
  // After picks, her dinner pick or her line change: settle the board now if she is looking at it, else
  // on the next visit.
  function syncDepBoard({ initial = false } = {}) {
    if (!DEP.board) return;
    const finalRows = depRows(plan);
    const sig = depSig();
    if (initial) {
      const full = !reduced && needsFull();
      if (reduced || (!full && DEP.seen.sig === sig)) {
        DEP.board.ensure(finalRows.length + spare());
        setBoardNow(finalRows);
        setSunNow(true);
        if (reduced) markSeen();
        DEP.pending = false;
      } else if (!full) {
        const old = DEP.seen.rows;
        DEP.board.ensure(Math.max(old.length, finalRows.length) + spare());
        setBoardNow(old);
        setSunNow(true);
        DEP.pending = true;
      } else {
        primeFull();
        DEP.pending = true;
      }
      return;
    }
    if (DEP.replay) stopReplay();
    if (reduced) { finishBoard(); return; }
    // A full replay waiting: the board goes back to its skeleton now, while she is in the picker.
    if (needsFull()) primeFull();
    else if (sameRows(DEP.shown, finalRows)) {
      DEP.shown = finalRows;
      DEP.board.rows.forEach((row, i) => applyRowMeta(row, finalRows[i] || null));
      if (!DEP.sunPending) setSunNow(true);
      markSeen();
      return;
    }
    DEP.pending = true;
    clearTimeout(depTimer);
    depTimer = setTimeout(() => { if (boardInView()) maybePlay(); }, 250);
  }

  // Board taps: finish a running replay; the Sunday egg; her TBC line; otherwise go to the card.
  function onBoardClick(e) {
    if (DEP.replay) { e.preventDefault(); finishBoard(); return; }
    const hit = e.target.closest('.board-hit');
    if (!hit) return;
    const row = DEP.board.rows.find((r) => r.hit === hit) || (DEP.board.sun.hit === hit ? DEP.board.sun : null);
    if (!row || !row.data) return;
    const t = row.data.target;
    // The egg caption adds a line to the row, so the triggers below re-measure.
    if (t === 'sunday') { DEP.sunEgg = !DEP.sunEgg; flipRowNow(DEP.board.sun, sundayRow(DEP.sunEgg)); refreshSoon(); return; }
    if (t === 'tbc') { slot('free-text').focus(); return; }
    const el = $(`.plan-item[data-key="${CSS.escape(t)}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 1200);
  }
  function onHeroClick(e) {
    const hit = e.target.closest('.board-hit');
    if (!hit) return;
    const i = HERO.rows.findIndex((r) => r.hit === hit);
    if (i < 0 || !H.rows[i].tap) return;
    if (HERO.intro && HERO.intro.isActive()) HERO.intro.progress(1);
    heroEgg[i] = !heroEgg[i];
    flipRowNow(HERO.rows[i], heroRowData(H.rows[i], i));
    refreshSoon();
  }

  /* ------------------------------------------------------------------ */
  /* Card chips: her departure time on each story card                   */
  /* ------------------------------------------------------------------ */

  // The day re-renders on every change, so the last time each chip showed is kept here: when a
  // change moves a stop, its chip re-flips from the old time (single flip, D 0.07).
  const chipSeen = {};
  function syncChips() {
    $$('.stop').forEach((li) => {
      const id = li.dataset.key;
      const it = plan.items.find((x) => x.kind === 'option' && x.id === id);
      const text = it ? it.rough : '';
      const fl = $$('.chip .flap', li).map(flapOf);
      const prev = chipSeen[id];
      chipSeen[id] = text;
      if (!prev || prev === text || reduced) { fl.forEach((f, k) => setFlap(f, cellChar(text, k))); return; }
      fl.forEach((f, k) => setFlap(f, cellChar(prev, k)));
      const tl = gsap.timeline();
      fl.forEach((f, k) => { const b = cellChar(text, k); if (f.cur !== b) addFlip(tl, f, b, 0.15 + k * 0.03, 0.07); });
    });
  }

  /* ------------------------------------------------------------------ */
  /* Your Friday: story cards, Swap, Remove, More ideas, dinner ideas    */
  /* ------------------------------------------------------------------ */

  // Only the cards of her day have a place on the map (the bags and the arrival never do); dinner's dot
  // is the idea she picked, drawn separately.
  const placeOf = (it) => (it.kind === 'option' && typeof it.option.lat === 'number' ? it.option : null);
  let undo = null;         // { pick, index, after, title, timer } while "Undo" is on screen

  // Over the board, a link's note and "Back to my picks". Nothing renders under Send (AM7).
  function renderDepNote() {
    const D = C.day;
    const back = hasBackup ? ` <button class="btn btn--small" type="button" data-action="back-to-mine">${esc(D.backToMine)}</button>` : '';
    slot('dep-note').innerHTML = fromLink ? `<p class="day-note">${esc(D.fromLink)}${back}</p>` : '';
  }

  // "About 1h 30 · €18 each · Needs booking · Shoulders and knees covered": duration, the price each
  // (or Free), "Needs booking" where it has to be booked, and an instruction tag.
  function factList(o) {
    const F = C.day.facts;
    const h = Math.floor(o.minutes / 60), m = o.minutes % 60;
    const d = h ? (m ? fmt(F.hm, { h, m: String(m).padStart(2, '0') }) : fmt(F.h, { h })) : fmt(F.m, { m });
    const price = typeof o.price === 'number' ? (o.price ? fmt(F.price, { n: o.price }) : F.free) : o.price || '';
    return [fmt(F.about, { d }), price, o.booking === 'required' ? F.needsBooking : '', o.tag || ''].filter(Boolean);
  }
  // As HTML: each fact (with the dot after it) never breaks inside, so a line can't end on "around" and
  // start the next on "€15 each", or start on a dot. The text reads the same as the facts joined.
  const factsHTML = (list) => { const J = C.day.facts.join, dot = J.trimEnd(); return list.map((f, i) => `<span class="fact">${esc(f)}${i < list.length - 1 ? esc(dot) : ''}</span>`).join(esc(J.slice(dot.length))); };
  const groupLabel = (o) => (C.catalogue.groups.find((g) => g.id === o.group) || {}).label || '';
  const nowTag = `<span class="tag tag--now">${esc(U.nowTag)}</span>`;
  const mapLink = (o) => (o.links?.[0] ? `<a class="stop-map" href="${esc(o.links[0].url)}" target="_blank" rel="noopener">${esc(o.links[0].label)}<span class="sr-only">: ${esc(o.title)}</span>${newTab}${ICON.out}</a>` : '');

  function swapHTML(id, alts) {
    const D = C.day;
    return `<div class="swap" id="sw-${esc(id)}" hidden><div class="swap-in">
        <p class="swap-title label">${esc(D.instead)}</p>
        <ul class="swap-list">${alts.map((a) => { const o = OPT[a]; return `<li class="swap-alt">
          ${thumbHTML(o.photos?.[0], 'swap-photo', '112px')}
          <span class="swap-text"><span class="swap-name">${esc(o.title)}</span><span class="swap-line">${esc(o.line)}</span></span>
          <button type="button" class="btn btn--small swap-use" data-action="use" data-id="${esc(a)}">${esc(D.useThis)}<span class="sr-only">: ${esc(o.title)}</span></button>
        </li>`; }).join('')}</ul>
      </div></div>`;
  }
  // An option's photos in a scroll-snap strip with a dot per photo (story cards and the peek share
  // it). `pill`, when given, sits over the photos (the "Photos" button that opens the peek).
  function stripHTML(o, sizes, pill = '', loading = 'lazy') {
    const photos = (o.photos || []).filter((k) => IMG[k]);
    const strip = photos.map((k, n) => thumbHTML(k, 'stop-photo', sizes, '', { alt: true, loading }).replace('<span', `<span data-n="${n}"`)).join('');
    const dots = photos.length > 1
      ? `<div class="stop-dots">${photos.map((k, n) => `<button type="button" class="stop-dot" data-n="${n}" aria-label="${esc(IMG[k].alt || o.title)}"${n ? '' : ' aria-current="true"'}></button>`).join('')}</div>`
      : '';
    return `<div class="stop-photos"><div class="strip-frame"><div class="stop-strip">${strip}</div>${pill}</div>${dots}</div>`;
  }
  const photosPill = (o, cls) => `<button type="button" class="pill ${cls}" data-action="photos" data-id="${esc(o.id)}" aria-haspopup="dialog">${ICON.photos}${esc(PK.openPhotos)}<span class="sr-only">: ${esc(o.title)}</span></button>`;
  const tipHTML = (o, cls) => (o.friendTip ? `<p class="${cls}">${esc(PK.tip)}</p>` : '');
  // One story card: time chip and the answer it came from, the photos, title, line, facts, actions.
  // On a laptop the card is a row: the photos on the left, the rest on the right. Every card with
  // something to swap to has Swap. The chip's time is rough, so "around" sits before it (spec 8.5),
  // except for the exact times (the noon cannon, Gesù at 17:30, a class session).
  const aroundWord = fmt(U.around, { time: '' }).trim();
  function stopHTML(it, time, attrs) {
    const o = it.option, D = C.day;
    const i = picks.findIndex((p) => p.id === o.id);
    const reason = i >= 0 ? picks[i].reason : 'added';
    const alts = i >= 0 ? P.alternatives(C, picks, i, { want: answers?.want || [] }) : [];
    const id = esc(o.id);
    return `<li class="plan-item stop" ${attrs} data-dot="${id}" data-hud-title="${esc(o.hud || o.title)}">
        <article class="stop-card" aria-labelledby="st-${id}">
          <p class="stop-top">${it.exact ? '' : `<span class="stop-around" aria-hidden="true">${esc(aroundWord)}</span>`}<span class="chip" aria-hidden="true">${FLAP.repeat(5)}</span><span class="stop-why label">${esc(reasonLabel(reason))}</span>${nowTag}</p>
          ${stripHTML(o, '(min-width: 1024px) 340px, (min-width: 768px) 640px, 92vw', photosPill(o, 'strip-peek'))}
          <div class="stop-text">
            <h4 class="stop-title" id="st-${id}"><span class="sr-only">${esc(time)}, </span>${esc(o.title)}</h4>
            <p class="stop-line">${esc(o.line)}</p>
            <p class="stop-facts">${factsHTML(factList(o))}</p>
            ${tipHTML(o, 'stop-tip')}
            <div class="stop-actions">${alts.length ? `<button type="button" class="btn btn--small" data-action="swap" aria-expanded="false" aria-controls="sw-${id}">${esc(D.swap)}<span class="sr-only">: ${esc(o.title)}</span></button>` : ''}<button type="button" class="btn btn--small" data-action="remove">${esc(D.remove)}<span class="sr-only">: ${esc(o.title)}</span></button>${mapLink(o)}</div>
          </div>
        </article>
        ${alts.length ? swapHTML(o.id, alts) : ''}
      </li>`;
  }
  // "More ideas" (hidden when there is nothing to offer) and "See everything", before dinner. A tile is
  // the photo, the answer it serves, the title and Add: no time, no price (AM12). Adding always works.
  function roomHTML() {
    const D = C.day;
    const sugg = roomNow;
    const tiles = sugg.map((x) => {
      const o = OPT[x.id];
      const label = x.reason === 'added' ? groupLabel(o) : reasonLabel(x.reason);
      return `<li class="room-tile">
          ${thumbHTML(o.photos?.[0], 'room-photo', '(min-width: 768px) 200px, 30vw')}
          <span class="room-why label">${esc(label)}</span>
          <span class="room-name">${esc(o.title)}</span>
          <button type="button" class="btn btn--small room-add" data-action="add" data-id="${esc(x.id)}" data-reason="${esc(x.reason)}">${esc(D.add)}<span class="sr-only">: ${esc(o.title)}</span></button>
        </li>`;
    }).join('');
    return `<li class="plan-room">
        ${sugg.length ? `<h3 class="room-title">${esc(D.roomTitle)}</h3><ul class="room-list">${tiles}</ul>` : ''}
        <button type="button" class="btn room-all" data-action="catalogue" aria-haspopup="dialog">${esc(D.seeEverything)}</button>
      </li>`;
  }
  const undoHTML = () => `<li class="plan-undo"><button type="button" class="undo-btn" data-action="undo">${esc(C.day.undo)}<span class="sr-only">: ${esc(undo.title)}</span></button></li>`;

  // The dinner card (spec 4.2, AM2): "around 19:00", "Dinner", one line, then the three ideas. Each idea:
  // its name, its line, "{area} · {booking} · {price}", the friend's tip, Map, and "This one". Tapping
  // "This one" picks it (and lets go of the others); tapping it again goes back to none.
  const dinnerBody = () => (dinner ? fmt(C.anchors.dinner.bodyPicked, { title: IDEA[dinner].title }) : C.anchors.dinner.bodyNone);
  function dinnerHTML(time, attrs, timeRow) {
    const A = C.anchors.dinner;
    const ideas = IDEAS.map((d) => `<li class="dinner-idea">
          <div class="dinner-text">
            <p class="dinner-name">${esc(d.title)}</p>
            <p class="dinner-line">${esc(d.line)}</p>
            <p class="dinner-facts">${factsHTML([d.area, d.booking, d.price].filter(Boolean))}</p>
            ${tipHTML(d, 'stop-tip')}
          </div>
          <div class="dinner-acts">
            <button type="button" class="peek-toggle dinner-toggle" aria-pressed="${dinner === d.id}" data-action="dinner" data-id="${esc(d.id)}"><span class="peek-toggle-in">${ICON.tick}${esc(PK.pick)}</span><span class="sr-only">: ${esc(d.title)}</span></button>
            ${mapLink(d)}
          </div>
        </li>`).join('');
    return `<li class="plan-item plan-item--text plan-dinner" ${attrs} data-dot="${dinner ? 'dinner' : ''}" data-hud-title="${esc(A.hud || A.title)}">
        <div class="plan-text">${timeRow}<h4 class="plan-title" id="dinner-h"><span class="sr-only">${esc(time)}, </span>${esc(A.title)}</h4><p class="plan-line dinner-body">${esc(dinnerBody())}</p></div>
        <ul class="dinner-ideas" aria-labelledby="dinner-h">${ideas}</ul>
      </li>`;
  }
  // A dinner pick changes the card in place (so the toggle keeps focus and its transition), the
  // board's 19:00 row (one diff wave), the map's dinner dot and the share text. The plan does not
  // depend on dinner, so the day is not built again.
  function setDinner(id) {
    buzz('selection');
    dinner = dinner === id ? null : cleanDinner(id);
    fromLink = false;
    saveState();
    const li = $('.plan-dinner', slot('day-body'));
    if (li) {
      $$('.dinner-toggle', li).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === dinner)));
      $('.dinner-body', li).textContent = dinnerBody();
      li.dataset.dot = dinner ? 'dinner' : '';
    }
    renderDepNote();
    renderMapPlan();
    syncDepBoard();
    syncSend();
    refreshSoon();
  }

  function renderDay() {
    const D = C.day;
    const body = slot('day-body');
    slot('change-answers').hidden = !answers;
    // Under "Your Friday": the full-day line (more than six things), else a line when cards overlap in
    // time ("Two of these overlap", or "Some" for three or more), and one line per pick that can't
    // happen on Friday.
    const lines = [];
    if (plan.crowded) lines.push(`<p class="day-crowded">${esc(D.crowded)}</p>`);
    else if (plan.overlaps.length) lines.push(`<p class="day-crowded day-overlap">${esc(plan.overlaps.length === 2 ? D.overlap.two : D.overlap.some)}</p>`);
    plan.didntFit.forEach((d) => lines.push(`<p class="day-cant">${esc(fmt(D.cant, { title: d.option.title, why: d.why }))}</p>`));
    slot('day-lines').innerHTML = lines.join('');
    slot('day-lines').hidden = !lines.length;
    if (!picks.length && !answers) { body.innerHTML = `<p class="day-empty">${esc(D.empty)}</p>`; return; }
    let html = '', group = '', undoShown = false;
    plan.items.forEach((it) => {
      if (it.kind === 'anchor' && it.id === 'dinner') html += roomHTML();
      if (it.slot !== group) {
        group = it.slot;
        html += `<li class="plan-group"><h3 class="label">${esc(D.slots[group])}</h3></li>`;
        // Two or more lunch cards: "We'll only have one of these." right under the Lunch heading.
        if (group === 'lunch' && plan.lunchIdeas.length) html += `<li class="plan-choice"><p>${esc(D.lunchChoice)}</p></li>`;
      }
      const time = it.exact ? it.rough : fmt(U.around, { time: it.rough });
      const key = it.kind === 'lunch-filler' ? 'lunch' : it.id;
      const attrs = `data-min="${toMin(it.rough)}" data-key="${esc(key)}"`;
      const timeRow = `<p class="plan-time"><span aria-hidden="true">${esc(time)}</span> ${nowTag}</p>`;
      if (it.kind === 'option') html += stopHTML(it, time, attrs);
      else if (it.kind === 'lunch-filler') html += `<li class="plan-item plan-item--text" ${attrs} data-hud-title="${esc(D.noLunch)}"><div class="plan-text">${timeRow}<h4 class="plan-line"><span class="sr-only">${esc(time)}, </span>${esc(D.noLunch)}</h4></div></li>`;
      else if (it.id === 'dinner') html += dinnerHTML(time, attrs, timeRow);
      else {
        const a = it.anchor;
        html += `<li class="plan-item plan-item--text" ${attrs} data-dot="" data-hud-title="${esc(a.hud || a.title)}">
          <div class="plan-text">${timeRow}<h4 class="plan-title"><span class="sr-only">${esc(time)}, </span>${esc(a.title)}</h4>${a.body ? `<p class="plan-line">${esc(a.body)}</p>` : ''}</div>
        </li>`;
      }
      if (undo && !undoShown && key === undo.after) { html += undoHTML(); undoShown = true; }
    });
    if (undo && !undoShown) html = undoHTML() + html;
    body.innerHTML = `<ol class="plan">${html}</ol>`;
  }

  const stopEl = (id) => $(`.stop[data-key="${CSS.escape(id)}"]`, slot('day-body'));
  const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > hudBottom() && r.top < innerHeight; };
  // The strip opens from 0 height with a fixed 8 px drop (220 ms); it closes softer, opacity first.
  function toggleSwap(btn) {
    const li = btn.closest('.stop');
    const el = $('.swap', li);
    if (!el) return;
    const open = el.hidden;
    btn.setAttribute('aria-expanded', String(open));
    gsap.killTweensOf(el);
    if (open) {
      el.hidden = false;
      if (!reduced) gsap.fromTo(el, { height: 0, opacity: 0, y: -8 }, { height: 'auto', opacity: 1, y: 0, duration: 0.22, ease: 'power2.out', clearProps: 'height,opacity,transform', onComplete: refreshSoon });
      else refreshSoon();
      return;
    }
    if (reduced) { el.hidden = true; refreshSoon(); return; }
    gsap.timeline({ onComplete: () => { el.hidden = true; gsap.set(el, { clearProps: 'height,opacity,transform' }); refreshSoon(); } })
      .to(el, { opacity: 0, duration: 0.1, ease: 'power1.in' })
      .to(el, { height: 0, y: -8, duration: 0.18, ease: 'power2.inOut' }, 0.04);
  }
  // Use this: the stop is replaced in place (same answer), the card fades over to the new one.
  function useAlternative(btn) {
    const li = btn.closest('.stop');
    const i = picks.findIndex((p) => p.id === li.dataset.key);
    const id = btn.dataset.id;
    if (i < 0 || !OPT[id]) return;
    const next = picks.map((p, j) => (j === i ? { id, reason: p.reason } : p));
    const land = () => {
      setPicks(next);
      const nl = stopEl(id);
      if (!nl) return;
      if (!inView(nl)) nl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      if (!reduced) gsap.from($('.stop-card', nl), { opacity: 0, duration: 0.2, ease: 'power1.out', clearProps: 'opacity' });
      $('[data-action="swap"], [data-action="remove"]', nl).focus({ preventScroll: true });
    };
    if (reduced) { land(); return; }
    gsap.to([$('.stop-card', li), $('.swap', li)], { opacity: 0, duration: 0.14, ease: 'power1.in', onComplete: land });
  }
  // Remove: the card collapses (opacity first, then height over 220 ms); "Undo" holds its place for 6 s.
  // While one card collapses no other Remove acts, and for half a second after a Remove neither does a
  // click at the same spot: a double click's second click lands on the next card's Remove as it slides
  // up (v8 mechanics review F1). A Remove on another card, at its own spot, acts as soon as the first
  // card is gone (v8 check fixes, N3).
  let removing = false, lastRemove = null;
  function removeStop(btn, ev) {
    const li = btn.closest('.stop');
    const now = performance.now();
    const pointer = !!ev && ev.detail > 0; // keyboard Enter and Space give 0
    const echo = pointer && !!lastRemove && now - lastRemove.t < 500 && Math.hypot(ev.clientX - lastRemove.x, ev.clientY - lastRemove.y) < 24;
    if (li.dataset.out || removing || (ev && ev.detail > 1) || echo) return;
    const id = li.dataset.key;
    if (!picks.some((p) => p.id === id)) return;
    li.dataset.out = '1';
    removing = true;
    lastRemove = pointer ? { t: now, x: ev.clientX, y: ev.clientY } : null;
    let prev = li.previousElementSibling;
    while (prev && !prev.matches('.plan-item')) prev = prev.previousElementSibling;
    const go = () => {
      removing = false;
      const i = picks.findIndex((p) => p.id === id);
      if (i < 0) return;
      undoDrop();
      undo = { pick: picks[i], index: i, after: prev ? prev.dataset.key : null, title: OPT[picks[i].id].title, timer: setTimeout(() => undoDrop(true), 6000) };
      setPicks(picks.filter((_, j) => j !== i), { keepUndo: true });
      $('.undo-btn', slot('day-body'))?.focus({ preventScroll: true });
    };
    if (reduced) { go(); return; }
    gsap.set(li, { overflow: 'hidden' });
    gsap.timeline({ onComplete: go })
      .to(li, { opacity: 0, duration: 0.12, ease: 'power1.in' })
      .to(li, { height: 0, paddingTop: 0, paddingBottom: 0, duration: 0.22, ease: 'power2.inOut' }, 0.06);
  }
  // Drop the Undo button (fading it when its time runs out).
  function undoDrop(fade = false) {
    if (!undo) return;
    clearTimeout(undo.timer);
    undo = null;
    const el = $('.plan-undo', slot('day-body'));
    if (!el) return;
    if (!fade || reduced) { el.remove(); refreshSoon(); return; }
    gsap.to(el, { opacity: 0, duration: 0.2, onComplete: () => { el.remove(); refreshSoon(); } });
  }
  function undoRemove() {
    if (!undo) return;
    const { pick, index } = undo;
    undoDrop();
    const next = [...picks];
    next.splice(Math.min(index, next.length), 0, pick);
    setPicks(next);
    const nl = stopEl(pick.id);
    if (!nl) return;
    if (!reduced) gsap.from(nl, { opacity: 0, duration: 0.22, ease: 'power1.out', clearProps: 'opacity' });
    $('[data-action="remove"]', nl).focus({ preventScroll: true });
  }
  // Add (More ideas, the catalogue): the new card lights up briefly where it lands.
  function addPick(id, reason) {
    if (!OPT[id] || picks.some((p) => p.id === id)) return;
    setPicks([...picks, { id, reason }]);
    flash(stopEl(id));
    // Keyboard: the button she pressed is gone with the re-render; carry on from the room.
    if (!slot('catalogue').open) ($('.room-add', slot('day-body')) || $('[data-action="catalogue"]', slot('day-body')))?.focus({ preventScroll: true });
  }
  function flash(el) {
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    setTimeout(() => el.classList.remove('is-flash'), 1200);
  }
  // Dots under a photo strip: a tap scrolls to that photo, a swipe moves the dot. Photos may be
  // narrower than the strip (the peek lets the next one show), so positions come from the photos.
  const stripLeft = (strip, n) => strip.children[n].offsetLeft - strip.children[0].offsetLeft;
  function onStripDot(dot) {
    const strip = $('.stop-strip', dot.closest('.stop-photos'));
    strip.scrollTo({ left: stripLeft(strip, +dot.dataset.n), behavior: reduced ? 'auto' : 'smooth' });
  }
  function onStripScroll(e) {
    const strip = e.target;
    if (!strip.classList || !strip.classList.contains('stop-strip')) return;
    let n = 0;
    [...strip.children].forEach((_, k) => { if (Math.abs(stripLeft(strip, k) - strip.scrollLeft) < Math.abs(stripLeft(strip, n) - strip.scrollLeft)) n = k; });
    $$('.stop-dot', strip.closest('.stop-photos')).forEach((d) => { if (+d.dataset.n === n) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
  }
  function onDayClick(e) {
    const dot = e.target.closest('.stop-dot');
    if (dot) { onStripDot(dot); return; }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'photos') openPeek(b, 'one', { id: b.dataset.id });
    else if (a === 'swap') toggleSwap(b);
    else if (a === 'use') useAlternative(b);
    else if (a === 'remove') removeStop(b, e);
    else if (a === 'undo') undoRemove();
    else if (a === 'add') addPick(b.dataset.id, b.dataset.reason);
    else if (a === 'dinner') setDinner(b.dataset.id);
    else if (a === 'catalogue') openCatalogue();
  }

  /* ------------------------------------------------------------------ */
  /* See everything: every option, grouped like the questions            */
  /* ------------------------------------------------------------------ */

  function renderCatalogue() {
    const D = C.day;
    // The heading takes focus when the sheet opens (it names the dialog), not the Close button.
    slot('catalogue').innerHTML = `<div class="sheet-head"><h2 id="cat-h" tabindex="-1" autofocus>${esc(D.seeEverything)}</h2><button type="button" class="btn btn--small" data-action="close">${esc(D.close)}</button></div>
      <div class="sheet-body">${C.catalogue.groups.map((g) => {
        const opts = C.options.filter((o) => o.group === g.id);
        if (!opts.length) return '';
        // A tile per option, as on the questions: the photo, the text under it, then Add and Photos.
        return `<section class="cat-group" aria-labelledby="cg-${esc(g.id)}"><h3 class="label" id="cg-${esc(g.id)}">${esc(g.label)}</h3><ul class="cat-list">${opts.map((o) => `<li class="cat-row">
            ${thumbHTML(o.photos?.[0], 'cat-photo', '(min-width: 1024px) 240px, (min-width: 640px) 30vw, 44vw')}
            <span class="cat-text"><span class="cat-name">${esc(o.title)}</span><span class="cat-line">${esc(o.line)}</span></span>
            <span class="cat-acts">
            <button type="button" class="cat-add" aria-pressed="false" data-id="${esc(o.id)}"><span class="cat-add-label">${esc(D.add)}</span>${ICON.check}<span class="sr-only">: ${esc(o.title)}</span></button><span class="cat-no" id="cw-${esc(o.id)}" hidden></span>
            <button type="button" class="tile-more" data-action="photos" data-id="${esc(o.id)}" aria-haspopup="dialog">${esc(PK.openPhotos)}<span class="sr-only">: ${esc(o.title)}</span></button></span>
          </li>`).join('')}</ul></section>`;
      }).join('')}</div>`;
  }
  // Each row: the check if it is on her day, else Add. Every Add works, except for something that can't
  // happen on Friday at all (plan.js catalogueAdd): its reason ("Sold out for Friday") shows in place of
  // the button, which stays for screen readers, disabled and described by the reason.
  function syncCatalogue() {
    const ids = pickIds();
    $$('.cat-add', slot('catalogue')).forEach((b) => {
      const id = b.dataset.id;
      const on = ids.includes(id);
      const res = on ? null : P.catalogueAdd(C, picks, id);
      const why = res && !res.ok ? res.vars.why : '';
      b.setAttribute('aria-pressed', String(on));
      b.disabled = !!why;
      b.classList.toggle('is-no', !!why);
      const line = $(`#cw-${CSS.escape(id)}`, slot('catalogue'));
      line.textContent = why;
      line.hidden = !why;
      if (why) b.setAttribute('aria-describedby', line.id); else b.removeAttribute('aria-describedby');
    });
  }
  function openCatalogue() {
    const dlg = slot('catalogue');
    if (dlg.open) return;
    syncCatalogue();
    dlg.showModal();
    $('.sheet-body', dlg).scrollTop = 0;
    if (!reduced) gsap.fromTo(dlg, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'opacity,transform' });
  }
  function closeCatalogue() {
    const dlg = slot('catalogue');
    if (!dlg.open) return;
    if (reduced) { dlg.close(); return; }
    gsap.to(dlg, { opacity: 0, y: 8, duration: 0.15, ease: 'power1.in', onComplete: () => { dlg.close(); gsap.set(dlg, { clearProps: 'opacity,transform' }); } });
  }
  // Adding from here carries ADDED; tapping the check takes it off the day again. Photos opens the peek.
  function onCatalogueClick(e) {
    if (e.target === slot('catalogue')) { closeCatalogue(); return; } // the backdrop
    if (e.target.closest('[data-action="close"]')) { closeCatalogue(); return; }
    const ph = e.target.closest('[data-action="photos"]');
    if (ph) { openPeek(ph, 'one', { id: ph.dataset.id }); return; }
    const b = e.target.closest('.cat-add');
    if (!b) return;
    const id = b.dataset.id;
    if (picks.some((p) => p.id === id)) { setPicks(picks.filter((p) => p.id !== id)); return; }
    addPick(id, 'added');
  }

  /* ------------------------------------------------------------------ */
  /* The peek: what is behind a choice, in photos, one tap away          */
  /* ------------------------------------------------------------------ */

  // One dialog, three uses: `vibe` ("See all 8" under a sight or a food: every thing behind it as a
  // compact row, each with "This one"), `pick` ("Photos" under an area or a wild card: the place, with
  // "This one"), and `one` (Photos on a story card or in the catalogue: the place, no toggle). A
  // bottom sheet on a phone, a centred panel on a laptop.
  const peek = { kind: null, step: -1, value: null, id: null, opener: null, closing: false };
  // "This one". For something that can't happen on Friday, its reason shows in place of the toggle (the
  // toggle stays for screen readers, disabled and described by the reason).
  const toggleHTML = (o, action) => `${o.fridayNo ? `<p class="peek-no" id="pn-${esc(o.id)}">${esc(o.fridayNo)}</p>` : ''}<button type="button" class="peek-toggle${o.fridayNo ? ' is-no' : ''}" aria-pressed="false" data-action="${action}" data-id="${esc(o.id)}"${o.fridayNo ? ` disabled aria-describedby="pn-${esc(o.id)}"` : ''}><span class="peek-toggle-in">${ICON.tick}${esc(action === 'want' ? PK.want : PK.pick)}</span><span class="sr-only">: ${esc(o.title)}</span></button>`;
  const peekTextHTML = (o) => `<div class="peek-text">
          <h3 class="peek-name" id="pk-${esc(o.id)}">${esc(o.title)}</h3>
          <p class="peek-line">${esc(o.line)}</p>
          <p class="peek-facts">${factsHTML(factList(o))}</p>
          ${tipHTML(o, 'peek-tip')}
        </div>`;
  // A row: thumbnail, title, line, facts, the friend's line and "This one". The thumbnail opens the
  // row's photo strip in place; the first five rows' strips load with the peek, the rest on opening.
  // On a phone the strip takes the 800 px files (about 2.6 px per CSS px at DPR 3, which looks the
  // same), so a peek costs a fraction of the 1600s and its first photo is the thumbnail's own file.
  const PEEK_ROW_SIZES = '(min-width: 1024px) 400px, (min-width: 640px) 80vw, 260px';
  function peekRowHTML(o, k) {
    const id = esc(o.id);
    return `<article class="peek-row" aria-labelledby="pk-${id}">
        <button type="button" class="peek-thumb" data-action="expand" aria-expanded="false" aria-controls="pp-${id}">${thumbHTML(o.photos?.[0], 'peek-thumb-img', '(min-width: 1024px) 160px, 112px')}<span class="sr-only">${esc(PK.openPhotos)}: ${esc(o.title)}</span></button>
        ${peekTextHTML(o)}
        <div class="peek-strip" id="pp-${id}" hidden>${stripHTML(o, PEEK_ROW_SIZES, '', k < 5 ? 'eager' : 'lazy')}</div>
        ${toggleHTML(o, 'want')}
      </article>`;
  }
  // The single peek: one thing, bigger (and "This one" on the questions).
  const peekOneHTML = (o, toggle) => `<article class="peek-thing" aria-labelledby="pk-${esc(o.id)}">
        ${stripHTML(o, '(min-width: 1024px) 920px, 80vw')}
        ${peekTextHTML(o)}
        ${toggle ? toggleHTML(o, 'pick') : ''}
      </article>`;
  function openPeek(opener, kind, { step = -1, value = null, id = null } = {}) {
    const dlg = slot('peek');
    if (dlg.open) return;
    Object.assign(peek, { kind, step, value, id, opener, closing: false });
    let title, hint = '', body;
    if (kind === 'vibe') {
      title = tileLabel(tileOf(STEPS[step], value));
      hint = PK.vibeHint;
      body = `<div class="peek-list">${servedBy(value).map(peekRowHTML).join('')}</div>`;
    } else {
      title = OPT[id].title;
      body = peekOneHTML(OPT[id], kind === 'pick');
    }
    dlg.className = `sheet peek peek--${kind === 'vibe' ? 'list' : 'one'}`;
    dlg.innerHTML = `<div class="peek-head">
        <div class="peek-titles"><h2 id="peek-h" tabindex="-1">${esc(title)}</h2>${hint ? `<p class="peek-hint">${esc(hint)}</p>` : ''}</div>
        <button type="button" class="peek-x" data-action="peek-close" aria-label="${esc(PK.close)}">${ICON.close}</button>
      </div>
      <div class="peek-body">${body}</div>
      <div class="peek-foot"><button type="button" class="btn btn--primary peek-done" data-action="peek-close">${esc(PK.done)}</button></div>`;
    syncPeek();
    root.classList.add('is-locked');
    dlg.showModal();
    // The title takes focus (it names the dialog), not the close button.
    $('#peek-h', dlg).focus({ preventScroll: true });
    const from = reduced ? { opacity: 0 } : matchMedia('(min-width: 1024px)').matches ? { opacity: 0, scale: 0.98 } : { opacity: 0, y: 24 };
    gsap.fromTo(dlg, from, { opacity: 1, y: 0, scale: 1, duration: 0.26, ease: 'power2.out', clearProps: 'opacity,transform' });
  }
  // The toggles show the draft: wanted things pressed, the picked area or wild card pressed.
  function syncPeek() {
    const dlg = slot('peek');
    if (!peek.kind) return;
    const d = stage.draft;
    $$('.peek-toggle', dlg).forEach((b) => {
      // A thing named under another sight shows unpressed here (pressing it moves it over).
      const on = b.dataset.action === 'want' ? wantedHere(b.dataset.id) : d[STEPS[peek.step].id] === peek.value;
      b.setAttribute('aria-pressed', String(on));
    });
  }
  // Named under the sight or food this peek is for (not just named somewhere).
  const wantedHere = (id) => stage.draft.want.includes(id) && P.wantReason(OPT[id], stage.draft) === peek.value;
  // "This one" in a sight or a food names the thing under it (and selects the answer if it was not
  // yet); pressed again it lets the thing go and leaves the answer selected. A thing already named
  // under another sight moves over to this one. "This one" on an area or a wild card picks it
  // (replacing the pick before), or clears it.
  function onPeekToggle(b) {
    buzz('selection');
    const d = stage.draft, s = STEPS[peek.step];
    if (b.dataset.action === 'want') {
      const id = b.dataset.id;
      if (wantedHere(id)) { d.want = d.want.filter((x) => x !== id); delete d.wantFrom[id]; }
      else {
        if (!d.want.includes(id)) d.want = [...d.want, id];
        d.wantFrom[id] = peek.value;
        if (!d[s.id].includes(peek.value)) d[s.id] = [...d[s.id], peek.value];
      }
    } else d[s.id] = d[s.id] === peek.value ? null : peek.value;
    syncStage();
    syncPeek();
  }
  // A row's photos open under it (200 ms) from the thumbnail, and close from it or the first photo.
  function toggleStrip(btn) {
    const el = $('.peek-strip', btn.closest('.peek-row'));
    const open = el.hidden;
    btn.setAttribute('aria-expanded', String(open));
    gsap.killTweensOf(el);
    if (open) {
      el.hidden = false;
      if (!reduced) gsap.fromTo(el, { height: 0, opacity: 0 }, { height: 'auto', opacity: 1, duration: 0.2, ease: 'power2.out', clearProps: 'height,opacity' });
      return;
    }
    if (reduced) { el.hidden = true; return; }
    gsap.to(el, { height: 0, opacity: 0, duration: 0.2, ease: 'power2.inOut', onComplete: () => { el.hidden = true; gsap.set(el, { clearProps: 'height,opacity' }); } });
  }
  // Out: 180 ms, 8 px down (a fade only under reduced motion). Escape, X, Done and the backdrop all close.
  function closePeek() {
    const dlg = slot('peek');
    if (!dlg.open || peek.closing) return;
    peek.closing = true;
    // Focus goes back right after close(), so the browser's own focus restore cannot land elsewhere.
    gsap.to(dlg, { opacity: 0, y: reduced ? 0 : 8, duration: 0.18, ease: 'power1.in', onComplete: () => { const o = peek.opener; dlg.close(); if (o && o.isConnected) o.focus({ preventScroll: true }); } });
  }
  function onPeekClick(e) {
    const dlg = slot('peek');
    if (e.target === dlg) { closePeek(); return; } // the backdrop
    const dot = e.target.closest('.stop-dot');
    if (dot) { onStripDot(dot); return; }
    const first = e.target.closest('.peek-strip .stop-photo[data-n="0"]');
    if (first) { toggleStrip($('.peek-thumb', first.closest('.peek-row'))); return; }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'peek-close') closePeek();
    else if (b.dataset.action === 'expand') toggleStrip(b);
    else if (b.dataset.action === 'want' || b.dataset.action === 'pick') onPeekToggle(b);
  }
  // However it closed: the page scrolls again and focus goes back to the button that opened it.
  function onPeekClosed() {
    const dlg = slot('peek');
    gsap.killTweensOf(dlg);
    gsap.set(dlg, { clearProps: 'opacity,transform' });
    root.classList.remove('is-locked');
    peek.kind = null;
    peek.closing = false;
    if (peek.opener && peek.opener.isConnected) peek.opener.focus({ preventScroll: true });
    peek.opener = null;
  }

  /* ------------------------------------------------------------------ */
  /* Map                                                                 */
  /* ------------------------------------------------------------------ */

  const mapFig = document.createElement('figure');
  mapFig.className = 'map';
  const PR = MAP.proj;
  const rad = (d) => (d * Math.PI) / 180;
  const project = (lat, lon) => [PR.R * rad(lon - PR.lon0) * Math.cos(rad(PR.phi0)), PR.R * rad(PR.lat0 - lat)];
  let mapPts = [];
  let mapRevealed = false;
  let revealMap = null;

  function renderMapFrame() {
    const [vx, vy, vw, vh] = MAP.viewBox;
    // The river is clipped to the frame; fade its ends into the sky instead of a hard cut.
    const fade = (id, x2, y2) => `<linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${x2}" y2="${y2}">
        <stop offset="0" stop-color="#000"/><stop offset="0.09" stop-color="#fff"/><stop offset="0.91" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
      </linearGradient>
      <mask id="${id}" maskUnits="userSpaceOnUse" x="${vx}" y="${vy}" width="${vw}" height="${vh}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#${id}g)"/></mask>`;
    mapFig.innerHTML = `<svg viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="${esc(U.mapLabel)}">
        <defs>${fade('mapFadeX', vx + vw, vy)}${fade('mapFadeY', vx, vy + vh)}</defs>
        <g mask="url(#mapFadeY)"><path class="map-river" d="${MAP.river}" mask="url(#mapFadeX)"/></g>
        <g class="map-plan"></g>
      </svg>
      <figcaption class="label">${esc(U.mapCredit)}</figcaption>`;
  }

  // Her day's cards as dots with their short names (spec 7.2), plus her dinner pick. No lines, no times.
  // A place outside the frame (the aqueduct park, far to the south-east) sits on the frame's edge.
  function renderMapPlan() {
    const svg = $('svg', mapFig);
    const [vx, vy, vw, vh] = MAP.viewBox;
    const pin = (v, lo, span) => Math.min(lo + span * 0.97, Math.max(lo + span * 0.03, v));
    const point = (id, lat, lon, label) => { const [x, y] = project(lat, lon); return { id, x: Math.round(pin(x, vx, vw)), y: Math.round(pin(y, vy, vh)), label }; };
    mapPts = (picks.length ? plan.items : []).filter(placeOf).map((it) => { const o = placeOf(it); return point(it.id, o.lat, o.lon, o.hud || o.title); });
    const din = dinner && IDEA[dinner];
    if (din && picks.length) mapPts.push(point('dinner', din.lat, din.lon, din.title));
    $('.map-plan', svg).innerHTML = mapPts
      .map((p) => `<g class="map-stop" data-id="${esc(p.id)}" data-o="${p.x} ${p.y}">
        <circle class="map-halo" cx="${p.x}" cy="${p.y}"/>
        <circle class="map-dot" cx="${p.x}" cy="${p.y}"/>
        <text class="map-label" x="${p.x}" y="${p.y}" dominant-baseline="central">${esc(p.label)}</text>
      </g>`)
      .join('');
    mapUnit = 0;
    mapCurrent = null;
    layoutMap();
    if (!mapRevealed && !reduced && window.gsap) $$('.map-stop', svg).forEach((g) => gsap.set(g, { scale: 0, autoAlpha: 0, svgOrigin: g.dataset.o }));
  }

  // Sizes in the SVG follow the rendered width so dots and labels keep a fixed on-screen size
  // (labels 12.5 px) whether the map is 250 px wide on a phone or sticky on desktop.
  let mapUnit = 0;
  function layoutMap() {
    const svg = $('svg', mapFig);
    const w = svg && svg.getBoundingClientRect().width;
    if (!w) return;
    const u = MAP.viewBox[2] / w;
    if (mapUnit && Math.abs(u - mapUnit) < mapUnit * 0.02) return;
    mapUnit = u;
    const set = (sel, attrs) => $$(sel, svg).forEach((el) => Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v)));
    set('.map-river', { 'stroke-width': 80 });
    set('.map-dot', { r: 4.5 * u, 'stroke-width': 1.75 * u });
    set('.map-halo', { r: 9.5 * u, 'stroke-width': 2 * u });
    set('.map-label', { 'font-size': 12.5 * u, 'stroke-width': 3.5 * u });
    placeLabels(svg, u);
  }

  // Greedy label placement: crowded dots first, eight candidate spots each, scored by overlap with
  // placed labels, other dots and the frame edge, and by whether another dot sits closer to the label
  // than its own (a label must read as its dot's). A label's width comes from its own text (the
  // condensed body face runs about 0.42 em a character, measured on the shots: "Maritozzo" is 46 px wide
  // at 12.5 px).
  const LABEL_EM = 0.42;
  function placeLabels(svg, u) {
    const [vx, vy, vw, vh] = MAP.viewBox;
    const font = 12.5 * u, dotR = 4.5 * u;
    const h = font * 0.95;
    const gap = dotR + font * 0.35;
    const cands = [
      [gap, 0, 'start'], [-gap, 0, 'end'],
      [0, -(gap + h / 2), 'middle'], [0, gap + h / 2, 'middle'],
      [gap * 0.8, -(gap * 0.8 + h / 2), 'start'], [-gap * 0.8, -(gap * 0.8 + h / 2), 'end'],
      [gap * 0.8, gap * 0.8 + h / 2, 'start'], [-gap * 0.8, gap * 0.8 + h / 2, 'end'],
    ];
    const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const frame = [vx, vy, vx + vw, vy + vh];
    const pts = mapPts.map((s) => ({ ...s, w: font * (LABEL_EM * Array.from(s.label).length + 0.2) }));
    const dots = pts.map((s) => [s.x - dotR * 1.6, s.y - dotR * 1.6, s.x + dotR * 1.6, s.y + dotR * 1.6]);
    const crowd = (s) => pts.filter((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < s.w * 1.2).length;
    const toBox = (b, x, y) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
    // Two dots about 18 px or less apart (the coffee by the Pantheon, 130 m): each label goes on the side
    // away from the other dot, so neither reads as the other's (v8 fold-in, gate P6).
    const twins = (s) => pts.filter((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < 18 * u);
    const placed = [];
    [...pts].sort((a, b) => crowd(b) - crowd(a)).forEach((s) => {
      const w = s.w;
      const box = (x, y, anchor) => { const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2; return [x0, y - h / 2, x0 + w, y + h / 2]; };
      const close = twins(s);
      let best = null;
      cands.forEach(([dx, dy, anchor], ci) => {
        const b = box(s.x + dx, s.y + dy, anchor);
        let score = ci * 0.01 * w * h;
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        for (const n of close) if ((cx - s.x) * (n.x - s.x) + (cy - s.y) * (n.y - s.y) > 0) score += w * h * 3;
        for (const p of placed) score += overlap(b, p) * 50;
        const own = toBox(b, s.x, s.y);
        dots.forEach((d, i) => { if (pts[i].id === s.id) return; score += overlap(b, d) * 30; if (toBox(b, pts[i].x, pts[i].y) < own + 6 * u) score += w * h * 1.5; });
        score += (w * h - overlap(b, frame)) * 60;
        if (!best || score < best.score) best = { score, b, x: s.x + dx, y: s.y + dy, anchor };
      });
      placed.push(best.b);
      const t = $(`.map-stop[data-id="${s.id}"] .map-label`, svg);
      t.setAttribute('x', best.x);
      t.setAttribute('y', best.y);
      t.setAttribute('text-anchor', best.anchor);
    });
  }

  // Below 1280 px the map has its own section; from 1280 px it sits sticky beside the plan.
  const wideMQ = matchMedia('(min-width: 1280px)');
  function placeMap() {
    const host = wideMQ.matches ? slot('day-map') : slot('map-home');
    if (mapFig.parentElement !== host) { host.append(mapFig); mapUnit = 0; }
  }

  /* ------------------------------------------------------------------ */
  /* Colour: sRGB <-> OKLCH, sky keyframes, contrast                     */
  /* ------------------------------------------------------------------ */

  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const gam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgbHex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  function rgbToOklch(rgb) {
    const [r, g, b] = rgb.map((v) => lin(v / 255));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
  }
  function oklchToRgb([L, Ch, H]) {
    const a = Ch * Math.cos((H * Math.PI) / 180);
    const b = Ch * Math.sin((H * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((v) => Math.round(Math.min(1, Math.max(0, gam(Math.max(0, v)))) * 255));
  }
  const relLum = (rgb) => { const [r, g, b] = rgb.map((v) => lin(v / 255)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const contrast = (y1, y2) => (Math.max(y1, y2) + 0.05) / (Math.min(y1, y2) + 0.05);
  const Y_INK = relLum(hexRgb('#1A1830'));
  const Y_LAMP = relLum(hexRgb('#FFE6BF'));

  // Sky over Rome (time -> colour). Sunset and civil dusk come from content.meta.
  // The afternoon goes blue -> lavender haze -> blush -> gold; a direct blue -> gold blend
  // in OKLCH crosses green hues around lunch.
  const SKY = [
    ['09:30', '#CFE4F1'], ['13:00', '#B3D7EE'], ['15:00', '#DCDCEE'], ['16:10', '#F2D5C9'], ['17:00', '#F3B862'],
    [C.meta.sunset, '#E9785F'], [C.meta.civilDusk, '#3A4A8E'], ['21:00', '#121833'],
  ].map(([t, hex]) => ({ t: toMin(t), lch: rgbToOklch(hexRgb(hex)) }));
  const DUSK = 5; // tramonto -> ora blu
  // Between sunset and blue hour the light drops fast. A steep curve also keeps the page
  // out of the mid-luminance band where neither ink nor lampione reaches 4.5:1.
  const steep = (p) => { const f = (x) => 1 / (1 + Math.exp(-30 * (x - 0.5))); return (f(p) - f(0)) / (f(1) - f(0)); };

  function skyAt(t) {
    if (t <= SKY[0].t) return SKY[0].lch;
    if (t >= SKY[SKY.length - 1].t) return SKY[SKY.length - 1].lch;
    let i = 0;
    while (t > SKY[i + 1].t) i++;
    let p = (t - SKY[i].t) / (SKY[i + 1].t - SKY[i].t);
    if (i === DUSK) p = steep(p);
    const [L1, C1, H1] = SKY[i].lch;
    const [L2, C2, H2] = SKY[i + 1].lch;
    let dh = H2 - H1;
    if (dh > 180) dh -= 360;
    if (dh < -180) dh += 360;
    return [L1 + (L2 - L1) * p, C1 + (C2 - C1) * p, (H1 + dh * p + 360) % 360];
  }

  // Every frame: write the sky layer and the HUD backgrounds directly (cheap, no inheritance), and --sky
  // on the two things that must match the page mid-scroll (the map's halos and river, the phone
  // question bar).
  // --sky on :root restyles the whole document, so it follows once the sky has been still for 200 ms
  // (the cards ease to it over their 600 ms background transition).
  const themeMeta = $('meta[name="theme-color"]');
  const hud = $('.hud');
  const skyBg = $('.sky-bg');
  let skyHex = '', varHex = '', varTimer = 0;
  const stageHost = slot('stage');
  let isDark = false;
  function syncSkyVar() {
    clearTimeout(varTimer);
    varTimer = 0;
    if (skyHex === varHex) return;
    varHex = skyHex;
    root.style.setProperty('--sky', skyHex);
    themeMeta.content = skyHex;
  }
  function applySky(t) {
    const lch = skyAt(t);
    const rgb = oklchToRgb(lch);
    const hex = rgbHex(rgb);
    if (hex === skyHex) return;
    skyHex = hex;
    skyBg.style.backgroundColor = hex;
    hud.style.backgroundColor = hex; // opaque: nothing reads through the bar
    mapFig.style.setProperty('--sky', hex);
    stageHost.style.setProperty('--sky', hex);
    const Y = relLum(rgb);
    const dark = contrast(Y, Y_LAMP) > contrast(Y, Y_INK); // flip at the luminance crossover
    if (dark !== isDark) { isDark = dark; root.toggleAttribute('data-dark', dark); syncSkyVar(); return; }
    if (!varHex) { syncSkyVar(); return; }
    clearTimeout(varTimer);
    varTimer = setTimeout(syncSkyVar, 200);
  }

  // HUD clock: four flaps, flipped only when a digit changes.
  const hudClock = $('.hud-clock');
  hudClock.innerHTML = FLAP + FLAP + '<span class="colon">:</span>' + FLAP + FLAP;
  const clockFlaps = $$('.flap', hudClock).map(flapOf);
  let clockText = '';
  function setClock(hhmm, animate) {
    if (hhmm === clockText) return;
    clockText = hhmm;
    $('[data-slot="hud-time"]').textContent = hhmm + ', ';
    [...hhmm.replace(':', '')].forEach((d, i) => {
      const f = clockFlaps[i];
      if (f.tl) { f.tl.progress(1).kill(); f.tl = null; }
      if (f.cur === d) return;
      if (!animate || !f.cur) { setFlap(f, d); return; }
      f.tl = gsap.timeline({ onComplete: () => { f.tl = null; } });
      addFlip(f.tl, f, d, i * 0.03, 0.07);
    });
  }

  /* ------------------------------------------------------------------ */
  /* Scroll model: page position -> time of day, current item           */
  /* ------------------------------------------------------------------ */

  const START = C.meta.startsAt.slice(11, 16);
  const START_MIN = toMin(START);
  let itemEls = [];
  let anchors = [];
  let sectionMarks = [];
  let reduced = reduceMotion();
  let lastY = 0;

  function measure() {
    layoutMap();
    itemEls = $$('.plan-item');
    const mid = innerHeight / 2;
    const top = (el) => el.getBoundingClientRect().top + scrollY;
    anchors = [{ y: 0, t: START_MIN }];
    itemEls.forEach((el) => anchors.push({ y: Math.max(top(el) - mid, anchors[anchors.length - 1].y + 1), t: +el.dataset.min, el }));
    sectionMarks = $$('main > section')
      .filter((sec) => sec.offsetParent !== null)
      .map((sec) => ({ y: top(sec) - mid, id: sec.id, name: sec.dataset.hud || '' }));
  }

  function timeAt(y) {
    if (y <= anchors[0].y) return anchors[0].t;
    for (let i = 0; i < anchors.length - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (y < b.y) return a.t + ((b.t - a.t) * (y - a.y)) / (b.y - a.y);
    }
    return anchors[anchors.length - 1].t;
  }

  const hudPlace = $('[data-slot="hud-place"]');
  let hudPlaceText = '', mapCurrent = null;
  const minToHHMM = (m) => P.hhmm(m);

  function render(y) {
    lastY = y;
    let idx = -1;
    for (let i = 1; i < anchors.length; i++) if (y >= anchors[i].y) idx = i - 1;
    const el = idx >= 0 ? anchors[idx + 1].el : null;
    applySky(reduced ? (el ? +el.dataset.min : START_MIN) : timeAt(y));

    let sec = null;
    for (const s of sectionMarks) if (y >= s.y) sec = s;
    const inDay = sec && sec.id === 'day' && el;
    setClock(el ? minToHHMM(+el.dataset.min) : START, !reduced && hud.hasAttribute('data-on'));
    const place = inDay ? el.dataset.hudTitle : sec ? sec.name : '';
    if (place !== hudPlaceText) { hudPlaceText = place; hudPlace.textContent = place; }

    // Sticky desktop map: mark the current item's dot.
    const cur = el && el.dataset.dot ? $(`.map-stop[data-id="${el.dataset.dot}"]`, mapFig) : null;
    if (cur !== mapCurrent) { mapCurrent?.classList.remove('is-current'); cur?.classList.add('is-current'); mapCurrent = cur; }
  }

  /* ------------------------------------------------------------------ */
  /* Time: the minute tick (the ARRIVALS statuses, "now" on the day)     */
  /* ------------------------------------------------------------------ */

  const nowBtns = $$('.hud-now');
  let jumpEl = null;
  function tick() {
    const r = romeNow();
    const today = r.date === C.meta.date;
    if (HERO && HERO.rows[0].data) heroTick();
    const items = $$('.plan-item');
    let nowEl = null;
    jumpEl = null;
    if (today && items.length) {
      items.forEach((el, i) => { const end = i < items.length - 1 ? +items[i + 1].dataset.min : 24 * 60; if (r.min >= +el.dataset.min && r.min < end) nowEl = el; });
      jumpEl = nowEl || (r.min < +items[0].dataset.min ? items[0] : null);
    }
    items.forEach((el) => el.classList.toggle('is-now', el === nowEl));
    nowBtns.forEach((b) => { b.hidden = !jumpEl; });
    hud.toggleAttribute('data-today', !!jumpEl);
  }
  function jumpToNow() {
    if (!jumpEl) return;
    jumpEl.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    const h = $('h4', jumpEl);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  /* ------------------------------------------------------------------ */
  /* Weather                                                             */
  /* ------------------------------------------------------------------ */

  // Sky words come from daytime hourly codes; wet hours are named separately, so "rain" never repeats.
  const WX = U.weather;
  const SKY_CAT = (c) => (c <= 1 ? 'sun' : c === 2 ? 'mixed' : c === 45 || c === 48 ? 'fog' : 'cloud');
  const WET_CAT = (c) => (c >= 95 ? 'storms' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 80 ? 'showers' : c >= 61 ? 'rain' : c >= 51 ? 'drizzle' : null);
  const modeOf = (arr) => { const n = {}; let best = null; for (const x of arr) { n[x] = (n[x] || 0) + 1; if (best === null || n[x] > n[best]) best = x; } return best; };

  function describeWeather(data) {
    const d = data?.daily, H = data?.hourly;
    const hi = d?.temperature_2m_max?.[0], lo = d?.temperature_2m_min?.[0], prob = d?.precipitation_probability_max?.[0];
    if (!d || d.time?.[0] !== C.meta.date || typeof hi !== 'number' || typeof lo !== 'number') return null;
    const codeAt = (h) => { const i = H?.time?.findIndex((t) => t.endsWith(`T${String(h).padStart(2, '0')}:00`)) ?? -1; const c = i >= 0 ? H.weather_code?.[i] : null; return typeof c === 'number' ? c : null; };
    const codes = (a, b) => { const out = []; for (let h = a; h <= b; h++) { const c = codeAt(h); if (c !== null) out.push(c); } return out; };
    const am = codes(10, 14).map(SKY_CAT), pm = codes(15, 20).map(SKY_CAT);
    let sky = '';
    if (am.length && pm.length) {
      const a = modeOf(am), b = modeOf(pm);
      sky = a === b ? WX.sky[a][0] : fmt(WX.then, { a: WX.sky[a][1], b: WX.sky[b][1] });
    } else if (typeof d.weather_code?.[0] === 'number') sky = WX.sky[SKY_CAT(d.weather_code[0])][0];
    let wetText = '';
    if (typeof prob === 'number') {
      const wet = [];
      for (let h = 7; h <= 23; h++) { const c = codeAt(h); if (c !== null && WET_CAT(c)) wet.push({ h, cat: WET_CAT(c) }); }
      let what = WX.rain, when = '';
      if (wet.length) {
        const hs = wet.map((x) => x.h);
        what = WX.wet[modeOf(wet.map((x) => x.cat))];
        when = Math.min(...hs) >= 19 ? WX.late : Math.max(...hs) <= 12 ? WX.early : Math.min(...hs) >= 13 && Math.max(...hs) <= 18 ? WX.afternoon : '';
      }
      wetText = fmt(esc(WX.chance), { pct: `<span class="tnum">${Math.round(prob)}</span>`, what: esc(what), when: esc(when) });
    }
    const temps = fmt(esc(WX.temps), { hi: `<span class="tnum">${Math.round(hi)}</span>`, lo: `<span class="tnum">${Math.round(lo)}</span>` });
    return [temps, esc(sky), wetText].filter(Boolean).join(', ');
  }

  async function loadWeather() {
    const el = slot('weather');
    const M = C.meta;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${M.lat}&longitude=${M.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&hourly=precipitation_probability,weather_code&timezone=Europe%2FRome&start_date=${M.date}&end_date=${M.date}`;
    // Only a real forecast for Friday shows; without one there is no weather line at all.
    const show = (data) => {
      const html = describeWeather(data);
      if (!html) return false;
      el.innerHTML = html;
      el.hidden = false;
      refreshSoon();
      return true;
    };
    el.hidden = true;
    const cached = store.get('wx', null);
    if (cached && Date.now() - cached.t < 3600e3 && show(cached.d)) return;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (show(data)) { store.set('wx', { t: Date.now(), d: data }); return; }
    } catch { /* offline or API down: fall through */ }
    if (cached) show(cached.d); // a stale forecast beats none
  }

  /* ------------------------------------------------------------------ */
  /* Update cycle                                                        */
  /* ------------------------------------------------------------------ */

  let booted = false;
  let refreshTimer = 0;
  // Send needs something to send: a pick, her dinner pick or a line of text.
  function syncSend() { slot('send').disabled = !picks.length && !dinner && !freeText.trim(); }

  function update() {
    plan = P.build(C, pickIds());
    roomNow = picks.length || answers ? P.suggestions(C, picks, answers || {}) : [];
    syncSend();
    renderDepNote();
    renderDay();
    syncCatalogue();
    renderMapPlan();
    syncChips();
    if (booted) {
      syncDepBoard();
      tick();
      refreshSoon();
    }
  }
  function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => ScrollTrigger.refresh(), 60); }

  /* ------------------------------------------------------------------ */
  /* Motion                                                              */
  /* ------------------------------------------------------------------ */

  // DEPARTURES: her build replays when the board comes into view; a replay under way waits while the
  // board is off screen; a long board's Sunday row waits for its own trigger. Made with the board.
  // The triggers watch the board's host, which stays put when the board is rebuilt at its breakpoint.
  function depTriggers() {
    const host = slot('dep-board');
    ScrollTrigger.create({ trigger: host, start: 'top 45%', onEnter: maybePlay, onEnterBack: maybePlay });
    ScrollTrigger.create({ trigger: host, start: 'top bottom', end: 'bottom top+=64', onLeave: pauseReplay, onLeaveBack: pauseReplay, onEnter: resumeReplay, onEnterBack: resumeReplay });
    ScrollTrigger.create({ trigger: host, start: 'bottom bottom', onEnter: maybeSun });
  }

  function setupMotion() {
    const mm = gsap.matchMedia();

    mm.add({ motion: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      reduced = !ctx.conditions.motion;
      skyHex = '';
      motionCtx = null;

      if (reduced) {
        heroFinal();
        finishBoard();
        mapRevealed = true;
        ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => render(self.scroll()) });
        render(scrollY);
        return;
      }

      // Sky scrub: smoothed scroll position drives the time of day.
      const st = { y: scrollY };
      gsap.fromTo(st, { y: 0 }, {
        y: () => ScrollTrigger.maxScroll(window),
        ease: 'none',
        onUpdate: () => render(st.y),
        scrollTrigger: { start: 0, end: 'max', scrub: 0.4, invalidateOnRefresh: true },
      });
      render(scrollY);

      // Hero: the ARRIVALS board flips in (or only its changed cells on a return visit), then
      // Felix's note and the first question.
      const intro = gsap.timeline();
      HERO.intro = intro;
      heroIntro(intro, 0.2);
      intro.from(['#note .note', '#ask .stage'], {
        autoAlpha: 0, y: 18, duration: 0.8, ease: 'power3.out', stagger: 0.1, clearProps: 'transform,visibility,opacity',
      }, 0.75);

      // The board's triggers come with the board (showDay adds them to this context later).
      motionCtx = ctx;
      if (DEP.board) depTriggers();

      // Map: the first time it scrolls in, the dots pop in day order (0.35 s each, 0.08 s apart).
      revealMap = () => {
        if (mapRevealed) return;
        mapRevealed = true;
        const svg = $('svg', mapFig);
        const tl = gsap.timeline();
        $$('.map-stop', svg).forEach((g, i) => tl.to(g, { scale: 1, autoAlpha: 1, duration: 0.35, ease: 'back.out(2.4)' }, i * 0.08));
      };
      ScrollTrigger.create({ trigger: mapFig, start: 'top 75%', once: true, onEnter: () => revealMap() });
    });

    // The HUD stays off the hero and the questions: it appears from DEPARTURES onward (and never
    // while DEPARTURES is still hidden).
    ScrollTrigger.create({
      trigger: '#dep',
      start: 'top top+=64',
      onEnter: () => { if (dayShown) hud.setAttribute('data-on', ''); },
      onLeaveBack: () => hud.removeAttribute('data-on'),
      onRefresh: (self) => hud.toggleAttribute('data-on', dayShown && (self.progress > 0 || scrollY > self.start)),
    });

    ScrollTrigger.addEventListener('refresh', () => { measure(); render(reduced ? scrollY : lastY); });
    ScrollTrigger.addEventListener('scrollEnd', syncSkyVar);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  gsap.registerPlugin(ScrollTrigger);
  renderHero();
  renderStatic();
  renderStage();
  renderCatalogue();
  renderMapFrame();
  placeMap();
  loadState();
  // A visitor who has planned (or opened a link) lands on her Friday; the stage waits closed.
  if (answers || picks.length) showDay();
  stage.open = !answers;
  stage.draft = cloneAnswers(answers);
  syncStage();
  slot('free-text').value = freeText;
  update();
  syncDepBoard({ initial: true });

  slot('stage').addEventListener('click', onStageClick);
  slot('stage').addEventListener('keydown', onStageKey);
  slot('change-answers').addEventListener('click', openStage);
  slot('day-body').addEventListener('click', onDayClick);
  slot('day-body').addEventListener('scroll', onStripScroll, true);
  slot('catalogue').addEventListener('click', onCatalogueClick);
  slot('catalogue').addEventListener('scroll', onStripScroll, true);
  slot('peek').addEventListener('click', onPeekClick);
  slot('peek').addEventListener('scroll', onStripScroll, true);
  // Escape plays the same exit as Done.
  slot('peek').addEventListener('cancel', (e) => { e.preventDefault(); closePeek(); });
  slot('peek').addEventListener('close', onPeekClosed);
  // Closing the sheet (Close, Escape, the backdrop) returns focus to "See everything".
  slot('catalogue').addEventListener('close', () => $('[data-action="catalogue"]', slot('day-body'))?.focus({ preventScroll: true }));
  let textTimer = 0;
  slot('free-text').addEventListener('input', (e) => {
    freeText = e.target.value;
    saveState();
    syncSend();
    // Her line shows up on the board as a TBC row, half a second after she stops typing.
    clearTimeout(textTimer);
    textTimer = setTimeout(() => { if (booted) syncDepBoard(); }, 500);
  });
  slot('dep-note').addEventListener('click', (e) => { if (e.target.closest('[data-action="back-to-mine"]')) backToMine(); });
  slot('dep-board').addEventListener('click', onBoardClick);
  slot('board').addEventListener('click', onHeroClick);
  slot('send').addEventListener('click', send);
  nowBtns.forEach((b) => b.addEventListener('click', jumpToNow));
  wideMQ.addEventListener('change', () => { placeMap(); renderMapPlan(); ScrollTrigger.refresh(); });

  measure();
  setupMotion();
  booted = true;
  tick();
  setTimeout(() => { tick(); setInterval(tick, 60000); }, 60000 - (nowMs() % 60000) + 50);
  loadWeather();
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 2500)))(() => { if (DEP.board) warmBoard(); }, { timeout: 3000 });
  window.__venerdi = {
    finishBoard, depRows: () => depRows(plan), boardRows: () => (DEP.board ? DEP.board.rows.map((r) => r.shown) : []), replayStats: () => DEP.stats, plan: () => plan,
    state: () => ({ replaying: !!DEP.replay, paused: !!DEP.replay?.paused, pending: DEP.pending, seen: !!DEP.seen, fullPicks: DEP.seen?.fullPicks || null, sun: DEP.board ? DEP.board.sun.shown : [], stageBusy: stage.busy, draft: cloneAnswers(stage.draft), peek: peek.kind }),
    compose: (a) => P.compose(C, a), answers: () => answers && cloneAnswers(answers), picks: () => picks.map((p) => ({ ...p })),
    shareText: () => shareText(), dinner: () => dinner,
  };

  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  if (location.hash.length > 1) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
})();
