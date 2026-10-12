/* Venerdì v8: Friday ideas, not a plan. Four photo questions turn into her day (v9d D1: what fits goes on it in
   the best order, with real bus, metro and walking times between the places; the rest waits under "If there's
   time"), played back on a DEPARTURES board (times and places only), then shown as story cards
   she can swap, remove and add to, with three dinner ideas on the evening card. Behind every choice,
   one tap away, a peek: the things in it, in photos, and a toggle to ask for one by name.
   Renders from window.SITE (data.js) and plan.js (the composer and the day builder), then wires the
   boards, the sky, HUD, map, persistence and sharing. Every visible string comes from content.json. */
(() => {
  'use strict';

  const { content: C, images: IMG = {}, map: MAP, transit: TRANSIT } = window.SITE;
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
  // v9c C1l: the morph (Show me Friday grows into the board) is behind a flag, off by default, for Felix to try on his
  // phone: ?moment=1 turns it on for this browser, ?moment=0 off. The parameter leaves the address at once (the
  // others keep their exact text), before anything else reads the query.
  {
    const mq = new URLSearchParams(location.search).get('moment');
    if (mq === '1') store.set('moment', true);
    if (mq === '0') store.set('moment', false);
    if (mq !== null) {
      const rest = location.search.slice(1).split('&').filter((kv) => kv && !/^moment(=|$)/.test(kv)).join('&');
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
  }
  const MOMENT = store.get('moment', false) === true;
  // v9d D3 (behind a flag, off by default, for Felix to try on his phone): ?sky=2 turns the document-height sky on for
  // this browser, ?sky=1 turns it off. The parameter leaves the address at once, like ?moment. With it on, the sky
  // layer is part of the page (as tall as the page) instead of fixed to the viewport, so what iOS Safari paints under
  // and around its floating bar is the live sky and not the root background, which trails it by design (applySky).
  {
    const sq = new URLSearchParams(location.search).get('sky');
    if (sq === '2') store.set('sky2', true);
    if (sq === '1') store.set('sky2', false);
    if (sq !== null) {
      const rest = location.search.slice(1).split('&').filter((kv) => kv && !/^sky(=|$)/.test(kv)).join('&');
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
  }
  const SKY2 = store.get('sky2', false) === true;
  if (SKY2) document.documentElement.setAttribute('data-sky2', '');
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
  // v9: the coffee stop became the pastry stop at Barnum. An old link or a stored day that names coffee
  // gets Barnum, with the same reason and in the same place (design-v9 amendments b4.2).
  const RENAMED = { coffee: 'barnum' };
  const aliasId = (id) => RENAMED[id] || id;
  const WHY = C.pickReasons;
  const PK = C.peek;
  const reasonLabel = (r) => (WHY[r] || WHY.added).label;
  // The three dinner ideas (spec 4): she picks one, or none.
  const IDEAS = C.dinners.ideas;
  const IDEA = Object.fromEntries(IDEAS.map((d) => [d.id, d]));
  // Haptics on Android: a tick on a tile or a toggle, a firmer one on Show me Friday, a light one on every other
  // deliberate tap. Called inside the tap, and only where the browser can vibrate: an iPhone has no
  // navigator.vibrate, and its tick comes from the switch her finger toggles (below). Plain pulses of 22 to 30 ms
  // (v9c C3a: web-haptics' presets cut pulses below what many Android motors can feel, research.md 4). Never on load
  // or scroll.
  const BUZZ = { light: 22, selection: 24, medium: 30 };
  const buzz = (p) => { if (!navigator.vibrate) return; try { navigator.vibrate(BUZZ[p]); } catch { /* not allowed here */ } };
  // Haptics on the iPhone (v9c C3a, research.md 1 to 3): Safari ticks only when a real finger toggles a native
  // switch. Each control she taps on purpose has a see-through <label> laid over it (touch screens only,
  // styles.css) holding a hidden switch. A label has no touch handling of its own, so a swipe that starts on it
  // scrolls the page and sends no click; a tap on it is a real click, which the label hands to its switch (the
  // tick), and the page passes the tap on to the control once (the click listener at the end of this file). The
  // label and its switch are aria-hidden and out of the tab order: the keyboard, the focus ring and screen
  // readers stay with the control.
  const HAP = '<label class="hap" aria-hidden="true"><input type="checkbox" switch tabindex="-1"></label>';
  // No :has() in these rules (a final perf pass found that `.hapw:has(...)` selectors cost the board's replay every
  // other frame in Chromium at 390 px): the wrapper carries its control's role as a class, and is hidden with it.
  const hap = (html, mod = '', hidden = false) => `<span class="hapw${mod ? ` hapw--${mod}` : ''}"${hidden ? ' hidden' : ''}>${html}${HAP}</span>`;
  const hideCtl = (el, v) => { if (el.hidden !== v) el.hidden = v; const w = el.parentElement; if (w && w.classList.contains('hapw') && w.hidden !== v) w.hidden = v; };

  const ICON = {
    out: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6.5 5H11v4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg class="i" viewBox="0 0 18 18" aria-hidden="true"><path d="m5 7 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    more: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3.5 4.5 4.5L6 12.5" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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
      f = { el, ft: ft.firstChild, fb: fb.firstChild, lt: lt.firstChild, lb: lb.firstChild, ltEl: lt, lbEl: lb, cur: '', off: false };
      flaps.set(el, f);
    }
    return f;
  }
  function setFlap(f, ch) {
    f.ft.textContent = f.fb.textContent = f.lt.textContent = f.lb.textContent = ch;
    f.cur = ch;
    dimFlap(f, !ch);
  }
  // v9c C1g (dir-3): a module resting blank is unlit (a darker flap), so a row reads as its words, not as a run of
  // empty modules. It lights the moment a flip toward a glyph starts, and goes dark again only when a write leaves it
  // blank. One class, toggled only when the state changes.
  function dimFlap(f, on) { if (f.off !== on) { f.off = on; f.el.classList.toggle('is-off', on); } }
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
      ${hap('<button type="button" class="board-hit" hidden></button>', 'hit', true)}
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
    // A row with nothing on it (a row the replay has not written yet): the board shows plain black there.
    row.el.classList.toggle('is-empty', !d);
    const t = rowTexts(d, row.widths);
    const caption = d && d.en && d.enOn ? ` ${d.en}` : '';
    row.srs[0].textContent = d ? (d.srTime ?? d.time ?? '') : '';
    row.srs[1].textContent = d ? (d.label || d.to || '') + (row.srs.length > 2 ? '' : caption) : '';
    if (row.srs[2]) row.srs[2].textContent = d ? (d.remark || '') + caption : '';
    row.en.textContent = d && d.en ? d.en : '';
    row.en.classList.toggle('is-on', !!(d && d.enOn));
    const hasTarget = !!(d && d.target);
    hideCtl(row.hit, !hasTarget);
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
  // v9c C1h, C1i (dir-3's write): how a board writes a row. Only its final text ever shows: in a column that changes,
  // every lit module first turns to blank (and goes dark), then, once the last one has landed, each module of the new
  // text lights and turns to its glyph, left to right, the time column leading. With `rolls` (ARRIVALS' write-in) a
  // module turns one or two blank leaves first (the drum moving, nothing printed), fixed per place, never random.
  // A column that does not change does not move. Returns the time its last flip lands.
  const HERO_W = { D: 0.04, cell: 0.014, row: 0.14, lead: 0.04, clearCell: 0.008, clear: 0.2 };
  // DEPARTURES (v9c C1i, dir-2's replay): one flip per module, no blank leaves, rows 0.13 s apart top to bottom.
  const DEP_W = { start: 0.15, row: 0.13, cell: 0.014, lead: 0.04, D: 0.045, clearCell: 0.008, clear: 0.2, sunPause: 0.25, rule: 0.3, sunLead: 0.22 };
  const rollsAt = (j, c, k) => ((j * 7 + c * 3 + k * 5) % 3 === 0 ? 2 : 1);
  function writeRow(tl, row, d, at, j = 0, { rolls = false, W = HERO_W } = {}) {
    const texts = rowTexts(d, row.widths);
    const changed = texts.map((t, c) => t !== row.shown[c]);
    tl.call(() => applyRowMeta(row, d), null, at);
    if (!changed.some(Boolean)) return at;
    let g = 0, gLast = -1;
    row.cols.forEach((cells, c) => cells.forEach((f, k) => {
      const i = g++;
      if (!changed[c] || !cellChar(row.shown[c], k)) return;
      const when = at + i * W.clearCell;
      addFlip(tl, f, '', when, W.D);
      tl.call(() => dimFlap(f, true), null, when + 2 * W.D);
      gLast = i;
    }));
    const t0 = gLast < 0 ? at : Math.max(at + W.clear, at + gLast * W.clearCell + 2 * W.D + 0.02);
    let end = at;
    g = 0;
    row.cols.forEach((cells, c) => {
      cells.forEach((f, k) => {
        const i = g++;
        if (!changed[c]) return;
        let when = t0 + i * W.cell + (c > 0 ? W.lead : 0);
        const ch = cellChar(texts[c], k);
        if (!ch) { tl.call(() => dimFlap(f, true), null, when); return; }
        tl.call(() => dimFlap(f, false), null, when);
        const n = rolls ? rollsAt(j, c, k) : 0;
        for (let r = 0; r < n; r++) { addFlip(tl, f, '', when, W.D); when += 2 * W.D; }
        addFlip(tl, f, ch, when, W.D);
        end = Math.max(end, when + 2 * W.D);
      });
      if (changed[c]) row.shown[c] = texts[c];
    });
    return end;
  }
  // A single quiet write of one row, outside any replay (ARRIVALS' live statuses and egg; on DEPARTURES the egg and the
  // Sunday row's TODAY and DONE).
  function flipRowNow(row, d) {
    if (reduced) { setRowNow(row, d); return; }
    const tl = gsap.timeline({ onComplete: () => { row.tls = row.tls.filter((x) => x !== tl); } });
    row.tls.push(tl);
    writeRow(tl, row, d, 0, 0, { rolls: false, W: HERO && HERO.rows.includes(row) ? HERO_W : DEP_W });
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
  // v9c C1h (dir-3's write-in, dir-2's start rule): on every load, first visit or fiftieth, the board opens dark (every
  // module unlit) and writes its rows in, row by row, left to right, each glyph after one or two blank leaves. Never a
  // wrong letter: only blanks or the final glyph. The rows' data (screen readers) is there from the first frame.
  function heroIntro(tl, start) {
    const now = H.rows.map(heroRowData);
    HERO.rows.forEach((row, i) => {
      setRowNow(row, null);
      applyRowMeta(row, now[i]);
      writeRow(tl, row, now[i], start + i * HERO_W.row, i, { rolls: true, W: HERO_W });
    });
  }
  function heroFinal() { HERO.rows.forEach((row, i) => setRowNow(row, heroRowData(H.rows[i], i))); }
  function heroTick() {
    // While the write-in waits or runs, the next minute's tick catches up (a paused intro is not active: spec gate S4).
    if (HERO.intro && HERO.intro.progress() < 1) return;
    HERO.rows.forEach((row, i) => {
      const d = heroRowData(H.rows[i], i);
      if (row.data && row.data.remark !== d.remark) flipRowNow(row, d); else if (row.data) applyRowMeta(row, d);
    });
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
    // The map's accessible description carries both credits (no credit on the page itself, brief 3).
    slot('map-credit').textContent = `${U.mapCredit} ${U.mapNolliCredit}`;
    slot('hud-map').setAttribute('aria-label', U.mapTitle);
    slot('hud-clock').setAttribute('aria-label', U.backToBoard);

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
    c.wantFrom = c.wantFrom && typeof c.wantFrom === 'object' ? Object.fromEntries(Object.entries(c.wantFrom).map(([id, r]) => [aliasId(id), r])) : {};
    c.want = (Array.isArray(c.want) ? c.want.map(aliasId) : []).filter((id, i, arr) => OPT[id] && arr.indexOf(id) === i && (vibesOf(c).some((r) => serves(OPT[id], r)) || rehome(c, id)));
    c.wantFrom = Object.fromEntries(Object.entries(c.wantFrom || {}).filter(([id, r]) => c.want.includes(id) && vibesOf(c).includes(r) && serves(OPT[id], r)));
    return c;
  };
  // `draft` is what the open stage shows; `answers` (below) only changes on Show me Friday.
  const stage = { step: 0, open: true, draft: emptyAnswers(), tl: null, count: [], busy: false };

  // A tile is the photo, then its label and sub under it; the whole tile selects. Under the sub, a
  // sibling text button (never inside the tile) opens the peek: "See all 8" on the pick-any steps,
  // "Photos" on the pick-one steps. On the pick-one steps the none button sits under the grid on a phone; on a
  // laptop it is plain words in the glass pill beside Back (renderStage, v9c C2a), never a cell in the photo grid.
  function stepHTML(s, i) {
    const lid = `ask-${esc(s.id)}-t`;
    const tiles = s.tiles.map((t, k) => {
      const state = s.multi ? 'aria-pressed="false"' : `role="radio" aria-checked="false" aria-posinset="${k + 1}" aria-setsize="${s.tiles.length}" tabindex="-1"`;
      const v = esc(tileValue(s, t));
      // "See all 8", "See both", or "Have a look" when one thing is behind it (v9, design-v9 2.4).
      const n = s.multi ? servedBy(t.id).length : 1;
      const more = n === 1 ? PK.openOne : n === 2 ? PK.openTwo : fmt(PK.open, { n });
      // The photo sits on its own layer over an ink mat: picked, it steps in 6 px (styles.css, b1.1).
      return `<div class="tile-cell">
          <span class="hapw hapw--block"><button type="button" class="tile" ${state} data-step="${i}" data-value="${v}">
            <span class="tile-photo">${thumbHTML(tilePhoto(t), 'tile-img', '(min-width: 1024px) 280px, (min-width: 640px) 31vw, 46vw', '', { loading: i ? 'lazy' : 'eager' })}<span class="tile-check" aria-hidden="true">${ICON.check}</span></span>
            <span class="tile-label">${esc(tileLabel(t))}</span><span class="tile-sub">${esc(tileSub(t))}</span>
          </button>${HAP}</span>
          ${hap(`<button type="button" class="tile-more" data-step="${i}" data-value="${v}" aria-haspopup="dialog">${esc(more)}<span class="sr-only">: ${esc(tileLabel(t))}</span>${ICON.more}</button>`, 'more')}
        </div>`;
    }).join('');
    // Laptop: four across. The none button is an answer like a tile, so her finger gets the tile's tick through
    // its own switch (fold-in, gates S3); on a laptop it steps out of the grid into the foot (fold-in, design
    // gate S2: a tile-sized empty card read as a missing photo).
    const n = s.tiles.length;
    const none = s.none ? hap(`<button type="button" class="step-none" data-action="none">${esc(s.none)}</button>`, 'none') : '';
    return `<fieldset class="step" data-step="${i}"${i ? ' hidden' : ''}>
        <legend class="step-title" id="${lid}" tabindex="-1"><span class="sr-only">${esc(progressText(i))}: </span>${esc(s.title)}</legend>
        <p class="step-hint">${esc(s.hint)}</p>
        <div class="tiles ${s.multi ? 'tiles--any' : 'tiles--one'}${n > 4 ? ' tiles--many' : ''}"${s.multi ? ` role="group" aria-labelledby="${lid}"` : ''}>${tiles}${none}</div>
      </fieldset>`;
  }
  function renderStage() {
    const host = slot('stage');
    host.innerHTML = `<div class="stage-open">
        <div class="stage-count" aria-hidden="true">${FLAP.repeat(Array.from(counterText(STEPS.length - 1)).length)}</div>
        <div class="stage-steps">${STEPS.map(stepHTML).join('')}</div>
        <div class="stage-foot">
          ${hap(`<button type="button" class="stage-back" data-action="back" aria-label="${esc(ASK.back)}">${ICON.back}</button>`, 'back')}
          ${hap('<button type="button" class="stage-none" data-action="none" hidden></button>', 'snone', true)}
          <span class="picked" aria-hidden="true"></span>
          ${hap('<button type="button" class="btn stage-next" data-action="next"></button>', 'next')}
        </div>
      </div>
      <div class="stage-closed"><p class="stage-answers"></p>${hap(`<button type="button" class="btn btn--small" data-action="change">${esc(ASK.change)}</button>`)}</div>`;
    stage.count = $$('.stage-count .flap', host).map(flapOf);
    setCount(0, false);
    // v9c C2a (dir-3): the pill never lies over the first screen. It comes up once she has scrolled (more than 24 px
    // since load) with the first step's photos risen past 55 % of the screen, at her first tap on a tile, or when
    // focus enters the stage (the keyboard). A tall phone waits for her scroll or her tap; a tap shows Next at once.
    // A window the page cannot scroll that far (a big monitor, an iPad upright: fold-in, gate-mechanics S1) counts as
    // scrolled: the pill comes up at its resting place under the photos, over nothing. The room is read again on a
    // scroll, a resize and once the fonts are in (the page is a little taller before).
    let gridIn = false, moved = false;
    const y0 = scrollY;
    const io = 'IntersectionObserver' in window ? new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) { gridIn = true; show(); } }, { rootMargin: '0px 0px -45% 0px' }) : null;
    const onScroll = () => { if (Math.abs(scrollY - y0) > 24) moved = true; show(); };
    function show() {
      if (!moved && document.documentElement.scrollHeight - innerHeight <= 24) moved = true;
      if (!gridIn || !moved || host.classList.contains('is-foot')) return;
      host.classList.add('is-foot');
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', show);
      host.removeEventListener('focusin', stage.showFoot);
      if (io) io.disconnect();
    }
    stage.showFoot = () => { gridIn = moved = true; show(); };
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', show, { passive: true });
    if (document.fonts) document.fonts.ready.then(show);
    host.addEventListener('focusin', stage.showFoot);
    if (io) io.observe($('.step .tiles', host)); else gridIn = true;
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
    // Nothing answered (every step skipped): "No picks, so we just wing it :-)".
    return labels.length ? fmt(ASK.answers, { list: labels.join(U.listJoin) }) : ASK.answersNone;
  };
  // Tiles (and their subs), the primary button, Back, the counter's screen-reader text and the
  // closed line follow the state.
  function syncStage() {
    const host = slot('stage');
    const s = STEPS[stage.step];
    // v9c C1l (dir-3, only with the morph on): while Show me Friday turns into the board (stage.hold) the step stays
    // where it is, so nothing jumps under her finger; it closes once the board is in place (morphToBoard).
    const shownOpen = stage.open || !!stage.hold;
    host.classList.toggle('is-closed', !shownOpen);
    $('.stage-open', host).hidden = !shownOpen;
    $('.stage-closed', host).hidden = shownOpen;
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
    // always reads Show me Friday. v9d D2 (felix-5.md: "include the 1/4 in the skip button"): before the last step the
    // word carries the step's count after it, "Skip 1/4", "Next 2/4", quieter than the word; screen readers hear only the
    // word, since the step's legend already says "Question 1 of 4".
    const last = stage.step === STEPS.length - 1;
    const any = chosen(stage.draft, s).length > 0;
    const next = $('.stage-next', host);
    morphPill(() => {
      next.innerHTML = last ? esc(ASK.plan) : `${esc(any ? ASK.next : ASK.skip)}<span class="stage-next-n" aria-hidden="true">${esc(counterText(stage.step))}</span>`;
      next.classList.toggle('btn--primary', last || any);
      hideCtl($('.stage-back', host), stage.step === 0);
      // The laptop's none button (in the pill), for the steps that have one: "Not really", "No thanks".
      const sn = $('.stage-none', host);
      if (s.none && sn.textContent !== s.none) sn.textContent = s.none;
      hideCtl(sn, !s.none);
      syncPicked();
    });
    $('.stage-count', host).dataset.text = counterText(stage.step);
  }
  // v9c C2b (dir-2): when what the pill holds changes (a pick, Skip turning into Next, Back coming in), it eases from
  // its old width to its new one: measured before and after, one 0.42 s tween on expo.out (no overshoot), the inline
  // width cleared at the end. With justify-content: flex-end Next stays at the pill's right edge while it opens to the
  // left. Only while the pill is shown; reduced motion or PILL_EASE off: it takes the new width at once.
  const PILL_EASE = true;
  let pillTw = null;
  function morphPill(change) {
    const host = slot('stage');
    const pill = $('.stage-foot', host);
    const live = PILL_EASE && !reduced && host.classList.contains('is-foot') && !$('.stage-open', host).hidden;
    const w0 = live ? pill.getBoundingClientRect().width : 0;
    if (pillTw) { pillTw.kill(); pillTw = null; }
    pill.style.width = '';
    change();
    if (!live || !w0) return;
    const w1 = pill.getBoundingClientRect().width;
    if (Math.abs(w1 - w0) < 1) return;
    pillTw = gsap.fromTo(pill, { width: w0 }, { width: w1, duration: 0.42, ease: 'expo.out', clearProps: 'width', onComplete: () => { pillTw = null; } });
  }
  // Beside Next: the photos of what she picked on this step, in the order she picked them, so the answer
  // stays in sight when the tiles have scrolled away (dir-3, design-v9 amendments b1.1). Only the newest
  // one pops in; the rest are already there. Decorative (the tiles carry the state).
  function syncPicked() {
    const box = $('.picked', slot('stage'));
    if (!box) return;
    const s = STEPS[stage.step];
    const vals = chosen(stage.draft, s);
    const sameStep = box.dataset.step === String(stage.step);
    const have = sameStep ? $$('.picked-ph', box).map((el) => el.dataset.v) : [];
    if (sameStep && have.join() === vals.join()) return;
    box.dataset.step = String(stage.step);
    box.innerHTML = vals.map((v) => {
      const im = IMG[tilePhoto(tileOf(s, v))];
      return `<span class="picked-ph" data-v="${esc(v)}" style="--ph:${esc(im?.color || '')}">${im ? `<img src="${esc(im.src800)}" alt="" width="${+im.w}" height="${+im.h}" decoding="async" style="object-position:${esc(im.focal || '50% 50%')}">` : ''}</span>`;
    }).join('');
    $$('.picked-ph', box).forEach((el) => { if (!sameStep || reduced || have.includes(el.dataset.v)) el.style.animation = 'none'; });
  }
  const hudBottom = () => (hud.hasAttribute('data-on') ? hud.getBoundingClientRect().bottom : 0);
  // Programmatic scrolls run on a short tween, so the sky and the HUD follow them like a real scroll.
  // While one runs the map holds still and moves once, where it lands (the sky's 0.4 s smoothing included).
  let glideTimer = 0;
  function scrollToY(y, duration, done) {
    y = Math.max(0, Math.min(y, ScrollTrigger.maxScroll(window)));
    if (reduced || Math.abs(y - scrollY) < 2) { scrollTo(0, y); if (done) done(); return; }
    const st = { y: scrollY };
    gliding = true;
    clearTimeout(glideTimer);
    gsap.to(st, { y, duration, ease: 'power2.inOut', onUpdate: () => scrollTo(0, st.y), onComplete: () => { glideTimer = setTimeout(() => { gliding = false; render(lastY); keyholeRecheck(); }, 450); if (done) done(); } });
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
    const land = () => {
      inn.hidden = false;
      $('.step-title', inn).focus({ preventScroll: true });
      refreshSoon();
      // The Aventine tile shows through the keyhole as step 3 comes in (b3.3), or later, once she can see it (v9c P3).
      if (STEPS[to].id === 'wander') watchKeyholeAt('tile', $('.tile[data-value="aventine"] .tile-photo', inn), 0.12, footCover());
    };
    if (reduced) { out.hidden = true; land(); stage.busy = false; return; }
    const parts = (f) => [$('.step-title', f), $('.step-hint', f), $('.step-none', f)].filter(Boolean);
    const run = () => {
      const tl = gsap.timeline({ onComplete: () => { stage.tl = null; stage.busy = false; } });
      stage.tl = tl;
      // Out: tiles fade and rise 8 px, staggered; in: tiles rise from 12 px; the title cross-fades.
      tl.to($$('.tile-cell', out), { opacity: 0, y: -8, duration: 0.15, stagger: 0.02, ease: 'power1.in' }, 0);
      tl.to(parts(out), { opacity: 0, duration: 0.15, ease: 'power1.in' }, 0);
      // The new step shows before the old one hides: with neither shown the page is one screen tall, and the browser
      // put her back at its top (fold-in, gates B1: on a phone the next step's tiles, the Aventine keyhole too, were
      // below the fold).
      tl.call(() => { land(); out.hidden = true; gsap.set([...$$('.tile-cell', out), ...parts(out)], { clearProps: 'opacity,transform' }); });
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
    stage.showFoot();
    loadNolli();
    const s = STEPS[+b.dataset.step];
    const v = b.dataset.value, d = stage.draft;
    const picked = s.multi && !d[s.id].includes(v);
    if (s.multi) {
      if (d[s.id].includes(v)) { dropWants(d, v); d[s.id] = d[s.id].filter((x) => x !== v); } else d[s.id] = [...d[s.id], v];
    } else d[s.id] = d[s.id] === v ? null : v;
    syncStage();
    // v9d D5 (felix-6.md, "Ask right after the tap"): a tap that picks a sight or a food opens its list at once, asking
    // "Anything in particular?", so she sees there are things to choose under it; "Any is fine" (or any other close)
    // keeps the pick and the planner chooses, as before. An unpick opens nothing, nor does a food with one thing.
    if (picked && servedBy(v).length > 1) openPeek(b, 'vibe', { step: +b.dataset.step, value: v, ask: true });
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
    if (a === 'next') { if (last) planFriday(e.target.closest('button')); else goStep(stage.step + 1); }
    else if (a === 'back') goStep(stage.step - 1);
    else if (a === 'none') {
      // An answer, like a tile (Android; an iPhone's switch already ticked). On the last step Show me Friday's own
      // buzz is the one call (v9c P5: two calls in one tap, the second cutting the first short).
      if (!last) buzz('selection');
      stage.draft[STEPS[stage.step].id] = null;
      syncStage();
      if (last) planFriday(e.target.closest('button')); else goStep(stage.step + 1);
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
  // v9c C1l: with the flag on (and motion allowed), `src`, the button under her finger, grows into the board.
  function planFriday(src = null) {
    const from = MOMENT && !reduced && src && src.offsetParent && stage.open ? src.getBoundingClientRect() : null;
    buzz('medium');
    DEP.tapped = true; // v9c C1j: the replay this tap asks for may carry the Android rhythm
    loadNolli();
    answers = cloneAnswers(stage.draft);
    picks = P.compose(C, answers).picks;
    fromLink = false;
    hasBackup = false;
    undoDrop();
    saveState();
    stage.open = false;
    if (from) { stage.hold = true; slot('stage').classList.add('is-leaving'); }
    showDay();
    syncStage();
    update();
    // Focus follows her to the board (the button she pressed is hidden with the stage).
    slot('dep-title').focus({ preventScroll: true });
    const b = DEP.board.host;
    if (from && from.width) { morphToBoard(from, src); return; }
    scrollToY(b.getBoundingClientRect().top + scrollY - scrollGap(), 0.6, () => { if (DEP.pending && boardInView()) maybePlay(); });
  }
  // v9c C1l (dir-3's signature moment, behind the flag): the button grows into the DEPARTURES board's black panel while
  // the page glides up to it, the board's title fades in on it, and once it has become the board her day is written
  // in by the one wave (C1i). One fixed box moved with transforms and sized each frame; no blur.
  const MORPH = 0.62;
  const easeSheet = (t) => { // cubic-bezier(0.32, 0.72, 0, 1), the sheets' ease
    let lo = 0, hi = 1, x = t;
    for (let i = 0; i < 18; i++) { const m = (lo + hi) / 2; const bx = 3 * m * (1 - m) ** 2 * 0.32 + m ** 3; if (bx < t) lo = m; else hi = m; x = m; }
    return 3 * x * (1 - x) ** 2 * 0.72 + 3 * x * x * (1 - x) + x ** 3;
  };
  function morphToBoard(from, src) {
    const boardEl = $('.board', DEP.board.host);
    const host = DEP.board.host;
    // Nothing jumps: the step stays open under her finger while the page glides down to the board. The step closes
    // once the board is in place (the scroll is corrected in the same frame, so the board does not move).
    const target = Math.max(0, Math.min(host.getBoundingClientRect().top + scrollY - scrollGap(), ScrollTrigger.maxScroll(window)));
    const b0 = boardEl.getBoundingClientRect();
    const land = { left: b0.left, top: b0.top - (target - scrollY), width: b0.width, height: b0.height };
    const cs = getComputedStyle(src);
    const ghost = document.createElement('div');
    ghost.className = 'morph';
    ghost.setAttribute('aria-hidden', 'true');
    ghost.innerHTML = `<span class="morph-label">${esc(src.textContent.trim())}</span><span class="morph-head"><span class="board-title">${esc(DEPC.title)}</span><span class="board-sub label">${esc(DEPC.sub)}</span></span>`;
    document.body.appendChild(ghost);
    const r0 = { x: from.left, y: from.top, w: from.width, h: from.height, rad: parseFloat(cs.borderTopLeftRadius) || 24 };
    const radEnd = parseFloat(getComputedStyle(boardEl).borderTopLeftRadius) || 10;
    const fill0 = cs.backgroundColor;
    DEP.morphing = true;
    boardEl.style.visibility = 'hidden';
    const label = $('.morph-label', ghost), head = $('.morph-head', ghost);
    const st = { p: 0 };
    const draw = () => {
      const e = easeSheet(st.p);
      const lerp = (a, z) => a + (z - a) * e;
      ghost.style.transform = `translate3d(${lerp(r0.x, land.left)}px, ${lerp(r0.y, land.top)}px, 0)`;
      ghost.style.width = `${lerp(r0.w, land.width)}px`;
      ghost.style.height = `${lerp(r0.h, land.height)}px`;
      ghost.style.borderRadius = `${lerp(r0.rad, radEnd)}px`;
      const c = Math.min(1, st.p / 0.5);
      ghost.style.backgroundColor = `color-mix(in srgb, ${fill0} ${Math.round((1 - c) * 100)}%, #0B0B0C)`;
      label.style.opacity = String(Math.max(0, 1 - st.p / 0.18));
      head.style.opacity = String(Math.min(1, Math.max(0, (st.p - 0.55) / 0.4)));
      head.style.width = `${land.width}px`;
    };
    draw();
    // The tap's own frame is a heavy one (her whole day is laid out in it), so the capsule starts moving on the frame
    // after, from where her finger left it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      scrollToY(target, MORPH);
      gsap.to(st, {
        p: 1, duration: MORPH, ease: 'none', onUpdate: draw,
        onComplete: () => {
          const before = boardEl.getBoundingClientRect().top;
          stage.hold = false;
          slot('stage').classList.remove('is-leaving');
          syncStage();
          const shift = boardEl.getBoundingClientRect().top - before;
          if (shift) scrollTo(0, scrollY + shift);
          refreshSoon();
          draw();
          boardEl.style.visibility = '';
          DEP.morphing = false;
          gsap.to(ghost, { opacity: 0, duration: 0.14, ease: 'power1.out', onComplete: () => ghost.remove() });
          if (DEP.pending) maybePlay();
        },
      });
    }));
  }

  /* ------------------------------------------------------------------ */
  /* Picks: state (in board order), persistence, the link                */
  /* ------------------------------------------------------------------ */

  let answers = null;      // her answers as of the last Show me Friday (null until then)
  let picks = [];          // [{ id, reason }]: the order the board fills in; the replay and the link keep it
  let dinner = null;       // the dinner idea she picked (an id of C.dinners.ideas), or null for none
  let dinnerAt = null;     // the dinner time she picked (v9c C1f: one of anchors.dinner.times), or null for the default
  let freeText = '';
  let fromLink = false;
  let plan = null;
  let hasBackup = false;
  const pickIds = () => picks.map((p) => p.id);
  // v9c C1d: a pick of Felix's old default fill (reason `felix`) drops out, so a stored day or an old link opens
  // without it (felix-2.md 6: his four ideas were for testing).
  const cleanPicks = (list) => (Array.isArray(list) ? list : []).filter((p) => p && p.reason !== 'felix').map((p) => (p && typeof p.id === 'string' ? { ...p, id: aliasId(p.id) } : p)).filter((p, i, a) => p && OPT[p.id] && a.findIndex((q) => q && q.id === p.id) === i).map((p) => ({ id: p.id, reason: WHY[p.reason] ? p.reason : 'added' }));
  const cleanDinner = (id) => (typeof id === 'string' && IDEA[id] ? id : null);
  // A dinner time other than the default (19:00); anything else, the default itself included, is null.
  const cleanDinnerAt = (t) => (C.anchors.dinner.times.includes(t) && t !== C.anchors.dinner.time ? t : null);
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
  // v9d D1: each "If there's time" row, worked out once per update: { id, ok } where ok says Swap in puts it on her
  // day, and `needs`, the earliest of her dinner times at which it would fit (only when it cannot go on now).
  let laterNow = [];
  // The planner's options for her day: her dinner time and pizza place, and the travel times (data.js).
  const planOpts = (o = {}) => ({ dinnerAt, dinner, transit: TRANSIT, ...o });
  const listOf = (titles) => (titles.length < 2 ? titles.join('') : `${titles.slice(0, -1).join(U.listJoin)}${U.listJoinLast}${titles[titles.length - 1]}`);

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
      const id = OPT[aliasId(seg)] ? aliasId(seg) : OPT[aliasId(seg.slice(1))] ? aliasId(seg.slice(1)) : null;
      // A v6 link's named thing whose home moved brings its home along (mechanics F2).
      if (!id || a.want.includes(id) || !(vibesOf(a).some((r) => serves(OPT[id], r)) || (v6 && rehome(a, id)))) return;
      a.want.push(id);
      const from = OPT[aliasId(seg)] ? null : byCode[seg[0]];
      if (from && vibesOf(a).includes(from) && serves(OPT[id], from)) a.wantFrom[id] = from;
    });
    return a;
  }

  // A link from before answers travelled with it (no `a`): rebuild the answers from the picks. Felix's
  // picks only ever came from the default day, which is what skipping every step gave (v9c C1d: no longer).
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
      const linkIds = q.has('p') ? q.get('p').split(',').map((s) => aliasId(s.trim())) : [];
      let linkPicks = q.has('p') ? cleanPicks(linkIds.map((id, i) => ({ id, reason: byCode[codes[i]] || 'added' }))) : null;
      if (!linkPicks || linkIds.some((id) => id && !OPT[id])) {
        // From the link's own ids and answer letters, before the gone places are cut (mechanics F6).
        linkAnswers = linkAnswers || answersFrom(linkIds.map((id, i) => ({ id, reason: byCode[codes[i]] || 'added' })));
        linkPicks = cleanPicks(P.compose(C, linkAnswers).picks);
      }
      const linkNote = q.get('n') || '';
      const linkDinner = cleanDinner(q.get('d'));
      // `t=2030`: her dinner time, 20:30 (v9c C1f).
      const tq = q.get('t') || '';
      const linkAt = cleanDinnerAt(/^\d{4}$/.test(tq) ? `${tq.slice(0, 2)}:${tq.slice(2)}` : null);
      // Keep her own day (and her dinner pick and time) before adopting the link's, so "Back to my picks" can restore it.
      const saved = store.get('picks', null), savedNote = store.get('note', ''), savedDinner = cleanDinner(store.get('dinner', null)), savedAt = cleanDinnerAt(store.get('dinnerAt', null));
      const ids = (list) => list.map((p) => p.id).sort().join();
      const same = Array.isArray(saved) && ids(saved) === ids(linkPicks) && savedNote === linkNote && savedDinner === linkDinner && savedAt === linkAt;
      // The same link opened again (from the chat a second time): the day kept from the first time stays.
      if (same && store.get('fromLink', false)) hasBackup = !!store.get('before-link', null);
      else {
        hasBackup = Array.isArray(saved) && !same;
        store.set('before-link', hasBackup ? { picks: saved, note: savedNote, answers: store.get('answers', null), dinner: savedDinner, dinnerAt: savedAt } : null);
      }
      picks = linkPicks;
      answers = linkAnswers || answersFrom(linkPicks);
      freeText = linkNote;
      dinner = linkDinner;
      dinnerAt = linkAt;
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
    dinnerAt = cleanDinnerAt(store.get('dinnerAt', null));
    // Someone's link, opened earlier: the note and "Back to my picks" stay until the day changes.
    fromLink = !!store.get('fromLink', false);
    hasBackup = fromLink && !!store.get('before-link', null);
    // Answers with no day yet (read over from v7 or v6): compose it, then put back what she added in v7.
    if (answers && store.get('picks', null) === null) {
      picks = cleanPicks(P.compose(C, answers).picks);
      // A v7 day's added coffee comes over as Barnum, like every other old coffee (fold-in, mechanics gate N3).
      carried.map(aliasId).forEach((id) => { if (OPT[id] && !OPT[id].fridayNo && !picks.some((p) => p.id === id)) picks.push({ id, reason: 'added' }); });
      saveState();
    }
  }
  function saveState() { store.set('picks', picks); store.set('answers', answers); store.set('note', freeText); store.set('dinner', dinner); store.set('dinnerAt', dinnerAt); store.set('fromLink', fromLink); }

  function backToMine(byKey = false) {
    const b = store.get('before-link', null);
    if (!b) return;
    picks = cleanPicks(b.picks);
    answers = b.answers ? cleanAnswers(b.answers) : null;
    freeText = b.note || '';
    dinner = cleanDinner(b.dinner);
    dinnerAt = cleanDinnerAt(b.dinnerAt);
    slot('free-text').value = freeText;
    fromLink = false;
    hasBackup = false;
    saveState();
    stage.draft = cloneAnswers(answers);
    undoDrop();
    syncStage();
    update();
    // The button goes with the link's note, so focus goes to her board's title instead of the page itself (fold-in,
    // gate-mechanics N2); its ring only from the keyboard.
    slot('dep-title').focus({ preventScroll: true, focusVisible: byKey });
  }

  // Links in chat apps end at the last "safe" character, so the note goes first, `p` (ids, in board
  // order) last, and ! ' ( ) * . are encoded too. `r` has one letter per pick: the answer it came from;
  // `d` is her dinner pick (absent for none), before `p` so a cut never loses it, and `t` her dinner time before it
  // (absent for the default; v9c C1f). The link carries a capped copy of the note.
  const NOTE_LINK_MAX = 1000;
  const encodeNote = (s) => encodeURIComponent(s).replace(/[!'()*.]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  function linkURL() {
    const base = location.href.split(/[?#]/)[0];
    const n = Array.from(freeText.trim()).slice(0, NOTE_LINK_MAX).join('');
    const a = answers ? encodeAnswers(answers) : null;
    const r = picks.map((p) => (WHY[p.reason] || WHY.added).code).join('');
    return `${base}?v=8&${n ? `n=${encodeNote(n)}&` : ''}${a !== null ? `a=${a}&` : ''}${r ? `r=${r}&` : ''}${dinnerAt ? `t=${dinnerAt.replace(':', '')}&` : ''}${dinner ? `d=${dinner}&` : ''}p=${pickIds().join(',')}`;
  }
  // A mini timetable: "around 10:00 Maritozzo" per card on her day (its time as the card shows it:
  // "around" for a rough time, the bare time for an exact one), her dinner pick, then her line, then the
  // link. No prices. Something that can't happen on Friday has no card, so no line.
  function shareText() {
    const timeOf = (it) => (it.exact ? it.rough : fmt(U.around, { time: it.rough }));
    const stops = plan.items.filter((it) => it.kind === 'option').map((it) => `${timeOf(it)} ${it.option.title}`);
    const note = freeText.trim();
    // Only a note: send the note and the link, without the timetable frame.
    if (!stops.length && !dinner && !dinnerAt) return [note, linkURL()].filter(Boolean).join('\n');
    const lines = [C.send.shareIntro, ...stops];
    // Her dinner place at its time; with no place, a time she moved (v9c C1f: "around 20:30 Dinner").
    const dinnerTime = timeOf(plan.items.find((it) => it.id === 'dinner'));
    if (dinner) lines.push(fmt(C.send.shareDinner, { time: dinnerTime, title: IDEA[dinner].title }));
    else if (dinnerAt) lines.push(fmt(C.send.shareDinnerTime, { time: dinnerTime }));
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

  // Two columns, TIME and TO (spec 6.2). v9c C1g (dir-3): TO is as wide as the longest text on her board (her rows,
  // the Sunday row and its egg), at least 12 cells and at most the room the board has: 20 while its section is
  // narrower than 600 px, 30 from there. LUGGAGE TO AIRBNB is on every day, so TO is never under 17. On a laptop the
  // board hugs its columns (styles.css, --dep-n). `DW` follows her day (renderDepBoard, fitDepBoard).
  let DW = [5, 20];
  const R = DEPC.rows;
  const anchorRow = (key, extra = {}) => ({ key, time: R[key].time, to: R[key].to, kind: 'anchor', ...extra });
  // The bags row: the time comes from the plan.
  const bagsRow = (it) => ({ key: 'bags', time: it.rough, to: R.bags.to, kind: 'anchor', target: 'bags', label: C.anchors.bags.title });
  // 19:00 DINNER, or the idea she picked (LI RIONI, DA REMO, DA IVO), at the time of the plan's dinner (v9c C1f: hers).
  // Her pizza place is hers (v9c C1m): the row speaks in her picks' colours once she picks one.
  const dinnerRow = (it) => anchorRow('dinner', { time: it.rough, to: dinner ? IDEA[dinner].board : R.dinner.to, target: 'dinner', label: dinner ? IDEA[dinner].title : C.anchors.dinner.title, ...(dinner ? { kind: 'pick' } : {}) });
  // SUN HALF MARATHON; the tap egg flips the TO text to HALBMARATHON with "(half marathon)" under it.
  // The Sunday row knows the day (b3.8): SUN HALF MARATHON until Sunday, TODAY HALF MARATHON from Sunday 00:00
  // Rome time, TODAY HALF MARATHON DONE from 18:00 (any finish and the lunch after are long past by then), SUN
  // HALF MARATHON DONE from Monday. `?at=2026-10-18T09:00` and `?at=2026-10-18T18:30` preview it. The egg is as before.
  const sundayState = () => {
    const S = DEPC.sunday, t = nowMs(), from = Date.parse(S.todayFrom);
    return { today: t >= from && t < from + 864e5, done: t >= Date.parse(S.doneFrom) };
  };
  const sundayRow = (egg) => {
    const S = DEPC.sunday, st = sundayState();
    const time = st.today ? S.today : S.time;
    const to = egg ? S.egg.to : st.done ? S.done : S.to;
    return { key: 'sunday', time, to, kind: 'sun', en: S.egg.en, enOn: !!egg, target: 'sunday', hitLabel: `${time}, ${to}` };
  };

  // Her free text as a TBC row: her words on the board, cut at the last space that fits. Emoji and other
  // glyphs a flap lacks drop out and the spaces around them collapse (a single long word is cut hard).
  function tbcRow(w = DW[1]) {
    const text = freeText.trim();
    if (!text) return null;
    const all = boardText(text, text.length).replace(/ +/g, ' ').trim();
    let to = all;
    if (all.length > w) { const cut = all.lastIndexOf(' ', w); to = cut > 0 ? all.slice(0, cut) : all.slice(0, w); }
    return { key: 'tbc', time: DEPC.tbc.time, to: to || DEPC.tbc.blank, kind: 'tbc', target: 'tbc', label: text, hitLabel: `${DEPC.tbc.time}, ${text}` };
  }

  // The board for a plan: every card of the day in display order (the plain lunch line as LUNCH), the
  // bags, her TBC line, dinner (v9c C1a: the day ends on dinner). Something that can't happen on Friday gets no row.
  function depRows(pl, { tbc = tbcRow() } = {}) {
    const rows = [];
    for (const it of pl.items) {
      if (it.kind === 'lunch-filler') rows.push({ key: 'lunch', time: it.rough, to: R.lunch.to, kind: 'anchor', target: 'lunch', label: C.day.noLunch });
      else if (it.kind === 'anchor' && it.id === 'bags') rows.push(bagsRow(it));
      // SECOND BREAKFAST keeps the option's title as its label, so the row's tap label names the place (AM19).
      else if (it.kind === 'option') rows.push({ key: it.id, time: it.rough, to: it.secondBreakfast ? DEPC.secondBreakfast : it.option.board.to, kind: 'pick', target: it.id, label: it.option.title });
      else if (it.kind === 'anchor' && it.id === 'dinner') {
        if (tbc) rows.push(tbc);
        rows.push(dinnerRow(it));
      }
    }
    return rows;
  }

  const DEP = { board: null, replay: null, seen: store.get('depSeen', null), sunEgg: false, shown: [], pending: false, sunPending: false, stats: null, settle: false, tapped: false };
  const depSig = () => `${pickIds().join(',')}|${dinner || ''}|${dinnerAt || ''}|${freeText.trim()}`;
  const plainRows = (rows) => rows.map((r) => (r ? { time: r.time, to: r.to, kind: r.kind } : null));
  const sameRows = (a, b) => JSON.stringify(plainRows(a)) === JSON.stringify(plainRows(b));
  const gapEl = () => $('.dep-gap', DEP.board.host);

  // The TO width her day wants (v9c C1g): her TBC words count as cut to the room.
  const depRoom = () => (slot('dep-board').parentElement.clientWidth < 600 ? 20 : 30);
  function depCells() {
    const room = depRoom();
    const texts = [...(plan ? depRows(plan, { tbc: tbcRow(room) }) : []).map((r) => r.to), sundayRow(false).to, sundayRow(true).to];
    return Math.min(room, Math.max(12, ...texts.map((t) => boardText(t, room).length)));
  }
  function renderDepBoard() {
    DW = [5, depCells()];
    slot('dep-board').closest('section').style.setProperty('--dep-n', DW[0] + DW[1]);
    DEP.board = makeBoard(slot('dep-board'), {
      title: DEPC.title, sub: DEPC.sub, label: `${DEPC.title}, ${DEPC.sub}`,
      columns: DEPC.columns, widths: DW, rows: 0, sun: true,
    });
  }
  // Her day needs another TO width (a longer name, her note, Sunday's DONE, a rotated phone): the board is built again
  // at that width showing exactly what it showed (its rows, the Sunday row, the dashed rule). Returns whether it did.
  function fitDepBoard() {
    if (!DEP.board || depCells() === DW[1]) return false;
    stopReplay();
    // What each row shows (DEP.shown: blank while a wave waits) and its data (screen readers, the tap).
    const shown = DEP.board.rows.map((r, i) => [DEP.shown[i] || null, r.data]), sun = DEP.board.sun.data, rule = gsap.getProperty(gapEl(), 'scaleX');
    renderDepBoard();
    DEP.board.ensure(shown.length);
    DEP.board.rows.forEach((row, i) => { setRowNow(row, shown[i][0]); if (!shown[i][0] && shown[i][1]) applyRowMeta(row, shown[i][1]); });
    setRowNow(DEP.board.sun, sun);
    gsap.set(gapEl(), { scaleX: rule });
    refreshSoon();
    return true;
  }
  function resizeDepBoard() { if (fitDepBoard()) refreshSoon(); }
  // The board has exactly her rows (v9c C1g: no spare row); a change of row count re-measures the triggers.
  const fitRows = (n) => { if (DEP.board.rows.length !== n) { DEP.board.ensure(n); refreshSoon(); } };
  // Before she plans, the page is the Arrivals board, the note and the questions. Her first Show me
  // Friday (or a link, or a day kept from an earlier visit) shows the rest and builds the board.
  let dayShown = false;
  let motionCtx = null;
  function showDay() {
    if (dayShown) return;
    dayShown = true;
    ['dep', 'day', 'send'].forEach((id) => { document.getElementById(id).hidden = false; });
    hideCtl(slot('hud-map'), false);
    renderDepBoard();
    ensureAtlases();
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
  // What the board last showed, and the composition last replayed in full (an array, empty for a light day
  // with no picks: v9c C1d).
  function markSeen(fullPicks = null) {
    DEP.seen = { sig: depSig(), rows: plainRows(DEP.shown), picks: pickIds(), fullPicks: fullPicks || DEP.seen?.fullPicks || null };
    store.set('depSeen', DEP.seen);
  }
  // A new composition (Plan Friday, or a link) replays in full; a swap, a removal, an addition, a
  // dinner pick or her note plays one diff wave. A planned day with no picks still plays once (v9c C1d: the
  // board is not on the page before she plans).
  function needsFull() {
    const s = DEP.seen;
    return !!answers && (!s || !Array.isArray(s.fullPicks) || s.fullPicks.join() !== composedIds().join());
  }
  // v9c C1i (dir-2's replay, dir-3's write): the board waits dark with exactly her rows, every module unlit (the rows'
  // data for screen readers is there at once), the Sunday row blank and the dashed rule undrawn. Nothing of the old
  // day, no frame-only board, no partial days. Returns the two states the wave runs between.
  function blankBoard(finalRows) {
    fitRows(finalRows.length);
    DEP.board.rows.forEach((row, i) => { setRowNow(row, null); applyRowMeta(row, finalRows[i] || null); });
    DEP.shown = finalRows.map(() => null);
    setSunNow(false);
    DEP.sunPending = false;
  }
  function primeFull() {
    fitDepBoard();
    const finalRows = depRows(plan);
    blankBoard(finalRows);
    return [DEP.shown, finalRows];
  }
  function stopReplay() {
    const r = DEP.replay;
    if (!r) return;
    r.stopping = true;
    stopBuzz(r);
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
    fitDepBoard();
    DEP.settle = false;
    const finalRows = depRows(plan);
    fitRows(finalRows.length);
    setBoardNow(finalRows);
    setSunNow(true);
    DEP.sunPending = false;
    if (r) r.done();
    markSeen(r && r.fullPicks);
    DEP.pending = false;
  }
  // One replay run: its timelines plus an rAF frame meter for the stats. `rows`: seconds until her rows were whole.
  const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length * q)] : 0; };
  // `key`: where the stats go (the Sunday row on its own keeps them apart from the replay's).
  function newReplay(key = 'stats') {
    const r = { tls: [], frames: [], meterOn: true, stopping: false, rowsAt: null };
    let last = performance.now();
    const t0 = last;
    const meter = (t) => { if (!r.meterOn) return; if (!r.paused) r.frames.push(t - last); last = t; requestAnimationFrame(meter); };
    requestAnimationFrame(meter);
    r.rowsDone = () => { r.rowsAt = +((performance.now() - t0) / 1000).toFixed(2); };
    r.done = () => {
      if (!r.meterOn) return;
      r.meterOn = false;
      const f = r.frames;
      DEP[key] = f.length ? { frames: f.length, p50: +pct(f, 0.5).toFixed(1), p90: +pct(f, 0.9).toFixed(1), max: +Math.max(...f).toFixed(1), seconds: +((performance.now() - t0) / 1000).toFixed(2), rows: r.rowsAt } : null;
    };
    DEP.replay = r;
    return r;
  }
  // The Sunday row counts as on screen once it is fully visible (or she has scrolled past it).
  const sunInView = () => DEP.board.sun.el.getBoundingClientRect().bottom <= innerHeight;
  // The Sunday row, after a short pause: the dashed rule draws, then the row writes like the others. It plays straight
  // after a full replay when it is on screen, otherwise its own trigger plays it when she scrolls down to it.
  function playSun(r, pause) {
    DEP.sunPending = false;
    r = r || newReplay('sunStats');
    DEP.replay = r;
    const tl = gsap.timeline();
    r.tls.push(tl);
    tl.fromTo(gapEl(), { scaleX: 0 }, { scaleX: 1, duration: DEP_W.rule, ease: 'power2.out', immediateRender: false }, pause);
    const end = writeRow(tl, DEP.board.sun, sundayRow(DEP.sunEgg), pause + DEP_W.sunLead, 0, { rolls: false, W: DEP_W });
    tl.call(() => { r.done(); DEP.replay = null; markSeen(r.fullPicks); }, null, Math.max(end, tl.duration()));
  }
  // v9c C1i: one wave between two states of the board, built before it plays. A full replay (after Show me Friday, a
  // changed answer, a link, or the return visit's settle) writes every row of her final day from dark, top to bottom,
  // each module straight to its final glyph: nothing else is ever on the board. A change (a swap, a removal, Undo, Add,
  // a dinner pick or time, her note) writes only the rows that change, one after the other, through the same write
  // (a changed column clears, then writes). Rows past her day are cleared, then dropped.
  function playStates([from, to], { full }) {
    stopReplay();
    warmBoard();
    const r = newReplay();
    if (full) r.fullPicks = composedIds();
    DEP.pending = false;
    const tl = gsap.timeline({ paused: true });
    r.tls.push(tl);
    let k = 0, end = 0;
    const lands = [];
    DEP.board.rows.forEach((row, j) => {
      const d = to[j] || null;
      const moves = rowTexts(d, row.widths).some((t, c) => t !== row.shown[c]);
      const at = DEP_W.start + k * DEP_W.row;
      if (moves) k++;
      const e = writeRow(tl, row, d, moves ? at : 0, j, { rolls: false, W: DEP_W });
      if (moves && d) lands.push(e);
      end = Math.max(end, e);
    });
    DEP.shown = to;
    tl.call(() => r.rowsDone(), null, end);
    tl.call(() => {
      if (!r.stopping) fitRows(to.length);
      markSeen(r.stopping ? null : r.fullPicks);
      if (full) {
        DEP.sunPending = true;
        if (!r.stopping && sunInView()) { playSun(r, DEP_W.sunPause); return; }
      }
      r.done();
      DEP.replay = null;
    }, null, Math.max(end, tl.duration()));
    tl.play(0);
    // v9c C1j (dir-2's pattern, Android only): when the board writes the day she just asked for, a pulse as each row
    // lands, in one vibrate() pattern (a 0 ms buzz first, then each pause to the next landing, 24 ms pulses; rows
    // closer than 70 ms share one). Never on load, a scroll, the return visit's settle or a change: only a full replay
    // that follows her Show me Friday tap. An iPhone has no navigator.vibrate and cannot tick after the tap: there
    // her one tick is the one under her finger.
    if (full && DEP.tapped && navigator.vibrate) {
      DEP.tapped = false;
      const pattern = [0];
      let at = 0, last = -1e9;
      [...new Set(lands.map((x) => Math.round(x * 1000)))].sort((a, b) => a - b).forEach((ms) => {
        if (ms - last < 70) return;
        pattern.push(Math.max(0, ms - at), 24);
        at = ms + 24;
        last = ms;
      });
      if (pattern.length > 1) { try { navigator.vibrate(pattern); r.buzzing = true; } catch { /* not allowed here */ } }
    }
  }
  // The rhythm stops with its replay (a tap on the board, the board off screen).
  const stopBuzz = (r) => { if (r && r.buzzing && navigator.vibrate) { r.buzzing = false; try { navigator.vibrate(0); } catch { /* fine */ } } };
  // Off screen the replay waits, so a flick past the board does not spend it.
  function pauseReplay() { const r = DEP.replay; if (r && !r.paused) { r.paused = true; stopBuzz(r); r.tls.forEach((t) => t.pause()); } }
  function resumeReplay() { const r = DEP.replay; if (r && r.paused) { r.paused = false; r.tls.forEach((t) => t.resume()); } }
  function maybeSun() { if (DEP.sunPending && !DEP.replay && !reduced) playSun(null, 0); }
  // When the board comes into view: her day in full the first time, the return visit's settle once per load, one
  // diff wave after a change.
  function maybePlay() {
    // Not while Show me Friday is turning into the board (C1l): the board writes once the button has become it.
    if (DEP.replay || !DEP.pending || DEP.morphing) return;
    if (reduced) { finishBoard(); return; }
    // Not while ARRIVALS writes itself in on load: one board at a time (playShown picks the board up after it).
    if (HERO.intro && HERO.intro.progress() < 1) return;
    if (needsFull()) {
      playStates(primeFull(), { full: true });
    } else if (DEP.settle) {
      // v9c C1i (dir-2's settle): a return visit's board waited dark below the fold; it writes her day in once per
      // load, the same wave as a full replay (with the Sunday row), with no haptic.
      DEP.settle = false;
      playStates(primeFull(), { full: true });
    } else {
      fitDepBoard();
      const finalRows = depRows(plan);
      fitRows(Math.max(DEP.board.rows.length, finalRows.length));
      playStates([DEP.shown, finalRows], { full: false });
    }
  }
  const boardInView = () => { const b = DEP.board.host.getBoundingClientRect(); return b.top < innerHeight * 0.85 && b.bottom > 80; };
  // v9c fold-in (verify S1): a board she can see never sits dark. Once ARRIVALS has written itself in, a wave that
  // waits from load (the return visit's settle, or a day this board has not shown yet) plays at once when two of her
  // rows are already on screen (a laptop, a tall phone). A board that only peeks in (its title and one row at the
  // bottom of a phone) still comes alive as she scrolls to it.
  function playShown() {
    if (!DEP.board || !DEP.pending) return;
    const on = DEP.board.rows.filter((row) => { const r = row.el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length;
    // Or its scroll trigger is already behind her (top above 45 % of the window, bottom not yet off the top): after a
    // reload that kept her scroll under the board, or a flick there while ARRIVALS wrote, that trigger has fired already.
    const b = DEP.board.host.getBoundingClientRect();
    if (on >= Math.min(2, DEP.board.rows.length) || (b.top < innerHeight * 0.45 && b.bottom > 0)) maybePlay();
  }
  let depTimer = 0;
  // After picks, her dinner pick or her line change: settle the board now if she is looking at it, else
  // on the next visit.
  function syncDepBoard({ initial = false } = {}) {
    if (!DEP.board) return;
    fitDepBoard();
    const finalRows = depRows(plan);
    const sig = depSig();
    if (initial) {
      const full = !reduced && needsFull();
      if (reduced) {
        fitRows(finalRows.length);
        setBoardNow(finalRows);
        setSunNow(true);
        markSeen();
        DEP.pending = false;
      } else if (!full && DEP.seen && DEP.seen.sig === sig) {
        // v9c C1i (dir-2's settle): a return visit with the same day: the board waits dark below the fold and writes
        // itself in once, when she first scrolls to it (on her first screen: right after ARRIVALS, playShown).
        blankBoard(finalRows);
        DEP.settle = true;
        DEP.pending = true;
      } else if (!full) {
        const old = DEP.seen ? DEP.seen.rows : [];
        fitRows(Math.max(old.length, finalRows.length));
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
    // A full replay waiting: the board goes dark now, while she is in the picker (v9c C1i).
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
    // A tap mid-wave finishes it. Stopping the Android rhythm (vibrate(0)) also cancels the tap's own pulse, sent just
    // before this click, so the pulse goes again after the stop (fold-in, verify nit 2).
    if (DEP.replay) { e.preventDefault(); const buzzing = DEP.replay.buzzing; finishBoard(); if (buzzing) buzz('light'); return; }
    const hit = e.target.closest('.board-hit');
    if (!hit) return;
    const row = DEP.board.rows.find((r) => r.hit === hit) || (DEP.board.sun.hit === hit ? DEP.board.sun : null);
    if (!row || !row.data) return;
    const t = row.data.target;
    // The egg caption adds a line to the row, so the triggers below re-measure.
    if (t === 'sunday') { DEP.sunEgg = !DEP.sunEgg; flipRowNow(DEP.board.sun, sundayRow(DEP.sunEgg)); refreshSoon(); return; }
    if (t === 'tbc') { slot('free-text').focus(); return; }
    // Her entry: a glide there (the map moves once, where it lands), then the echo (b3.10).
    goToEntry(t, echo);
  }
  function onHeroClick(e) {
    const hit = e.target.closest('.board-hit');
    if (!hit) return;
    const i = HERO.rows.findIndex((r) => r.hit === hit);
    if (i < 0 || !H.rows[i].tap) return;
    // A tap during the write-in, or while it waits for the font, finishes it first (it is paused until then, so
    // isActive() would miss it: spec gate S4), so its flips never write the plain row over her egg.
    if (HERO.intro && HERO.intro.progress() < 1) HERO.intro.progress(1);
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
    // v9 (dir-3, design-v9 amendments b1.3): every entry, text entries too, starts with its time as a chip.
    $$('#day .plan-item').forEach((li) => {
      const id = li.dataset.key;
      const text = li.dataset.min ? P.hhmm(+li.dataset.min) : '';
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
    const back = hasBackup ? ` ${hap(`<button class="btn btn--small" type="button" data-action="back-to-mine">${esc(D.backToMine)}</button>`)}` : '';
    slot('dep-note').innerHTML = fromLink ? `<p class="day-note">${esc(D.fromLink)}${back}</p>` : '';
  }

  // "About 1h 30 · €18 each · Needs booking · Shoulders and knees covered": duration, the price each
  // (or Free), "Needs booking" where it has to be booked, and an instruction tag.
  function factList(o) {
    const F = C.day.facts;
    const h = Math.floor(o.minutes / 60), m = o.minutes % 60;
    const d = h ? (m ? fmt(F.hm, { h, m: String(m).padStart(2, '0') }) : fmt(F.h, { h })) : fmt(F.m, { m });
    // v9: where Felix pays less than Sasha (`priceMe`, the EU under-26 tickets), the price says both:
    // "€18 for you, €2 for me". A whole number prints bare, anything else with two decimals (6.50).
    const money = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
    const split = typeof o.priceMe === 'number' && o.priceMe !== o.price;
    const price = typeof o.price === 'number' ? (o.price ? (split ? fmt(F.priceSplit, { you: money(o.price), me: money(o.priceMe) }) : fmt(F.price, { n: money(o.price) })) : F.free) : o.price || '';
    return [fmt(F.about, { d }), price, o.booking === 'required' ? F.needsBooking : '', o.tag || ''].filter(Boolean);
  }
  // As HTML: each fact (with the dot after it) never breaks inside, so a line can't end on "around" and
  // start the next on "€15 each", or start on a dot. The text reads the same as the facts joined.
  const factsHTML = (list) => { const J = C.day.facts.join, dot = J.trimEnd(); return list.map((f, i) => `<span class="fact">${esc(f)}${i < list.length - 1 ? esc(dot) : ''}</span>`).join(esc(J.slice(dot.length))); };
  const groupLabel = (o) => (C.catalogue.groups.find((g) => g.id === o.group) || {}).label || '';
  const nowTag = `<span class="tag tag--now">${esc(U.nowTag)}</span>`;
  const mapLink = (o) => (o.links?.[0] ? `<a class="stop-map" href="${esc(o.links[0].url)}" target="_blank" rel="noopener">${esc(o.links[0].label)}<span class="sr-only">: ${esc(o.title)}</span>${newTab}${ICON.out}</a>` : '');
  // On an entry every link of the option sits at the right: Map, and for the class its Class page too.
  const linksHTML = (o) => (o.links || []).map((l) => `<a class="stop-map tbtn" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}<span class="sr-only">: ${esc(o.title)}</span>${newTab}${ICON.out}</a>`).join('');
  // A time chip with "around" before a rough time (the board's language), and the Now tag on the day. v9c C1m: the chip
  // speaks the board's colours: her picks in yellow, the day's own lines in grey (`frame`).
  const whenHTML = (it, extra = '', tone = '') => `${it.exact ? '' : `<span class="stop-around" aria-hidden="true">${esc(aroundWord)}</span>`}<span class="chip${tone ? ` chip--${tone}` : ''}" aria-hidden="true">${FLAP.repeat(5)}</span>${extra}${nowTag}`;

  // Each alternative: its photo, its title and its facts line (fold-in, design gate N3: its line, cut to two lines,
  // read as an unfinished sentence).
  function swapHTML(id, alts) {
    const D = C.day;
    return `<div class="swap" id="sw-${esc(id)}" hidden><div class="swap-in">
        <p class="swap-title label">${esc(D.instead)}</p>
        <ul class="swap-list">${alts.map((a) => { const o = OPT[a]; return `<li class="swap-alt">
          ${thumbHTML(o.photos?.[0], 'swap-photo', '112px')}
          <span class="swap-text"><span class="swap-name">${esc(o.title)}</span><span class="swap-line">${factsHTML(factList(o))}</span></span>
          ${hap(`<button type="button" class="btn btn--quiet swap-use" data-action="use" data-id="${esc(a)}">${esc(D.useThis)}<span class="sr-only">: ${esc(o.title)}</span></button>`)}
        </li>`; }).join('')}</ul>
      </div></div>`;
  }
  // An option's photos in a scroll-snap strip with a bar per photo (entries and the peek share it). A tap
  // on a photo pages to the next one; a swipe scrolls the strip. `pill` is unused since v9 (no Photos pill).
  function stripHTML(o, sizes, pill = '', loading = 'lazy') {
    const photos = (o.photos || []).filter((k) => IMG[k]);
    const strip = photos.map((k, n) => thumbHTML(k, 'stop-photo', sizes, '', { alt: true, loading }).replace('<span', `<span data-n="${n}"`)).join('');
    const dots = photos.length > 1
      ? `<div class="stop-dots">${photos.map((k, n) => hap(`<button type="button" class="stop-dot" data-n="${n}" aria-label="${esc(IMG[k].alt || o.title)}"${n ? '' : ' aria-current="true"'}></button>`, 'dot')).join('')}</div>`
      : '';
    return `<div class="stop-photos"><div class="strip-frame"><div class="stop-strip">${strip}</div>${pill}</div>${dots}</div>`;
  }
  // A photo that opens one thing's sheet (More ideas, See everything): the photo is the button.
  const photoButtonHTML = (o, cls, sizes) => {
    const im = IMG[o.photos?.[0]];
    return `<button type="button" class="${cls}" data-action="photos" data-id="${esc(o.id)}" aria-haspopup="dialog" aria-label="${esc(PK.openPhotos)}: ${esc(o.title)}" style="--ph:${esc(im?.color || '')}">${im ? `<img src="${esc(im.src800)}" srcset="${esc(im.src800)} 800w, ${esc(im.src1600)} 1600w" sizes="${sizes}" width="${+im.w}" height="${+im.h}" alt="" loading="lazy" decoding="async" style="object-position:${esc(im.focal || '50% 50%')}">` : ''}</button>`;
  };
  const tipHTML = (o, cls) => (o.friendTip ? `<p class="${cls}">${esc(PK.tip)}</p>` : '');
  // How to say it (b3.5): in Barnum's line, "almond croissant" is a button that opens one caption under the line
  // with the Italian and a respelling. One phrase, no phrasebook: on her entry (`cid` say-barnum) and on its row
  // in the pastry sheet (say-barnum-pk); everywhere else the plain line. The caption is the paragraph's last,
  // block-level span, so a closed caption adds no space.
  function lineHTML(o, cid) {
    const line = esc(o.line), S = o.say;
    const at = S && cid ? line.indexOf(esc(S.words)) : -1;
    if (at < 0) return line;
    const w = esc(S.words);
    return `${line.slice(0, at)}${hap(`<button type="button" class="say" data-action="say" aria-expanded="false" aria-controls="${cid}">${w}</button>`, 'say')}${line.slice(at + w.length)}<span class="say-cap" id="${cid}"><span class="say-in"><span class="say-how">${howHTML(S.how)}</span></span></span>`;
  }
  // The respelling in brackets never breaks across lines (round 1: "(oon" was left at the end of a line).
  // The respelling breaks only at its spaces, never at a hyphen inside a word (fold-in, gates S1: in the pastry sheet's
  // narrow column it ran past the edge as one unbreakable piece). Its first two words are one piece, so the opening
  // bracket's word never ends a line on its own (v9c P4: on a laptop the sheet broke after "(oon").
  const howHTML = (how) => {
    const i = how.lastIndexOf('(');
    if (i <= 0) return esc(how);
    const ws = how.slice(i).split(' '), parts = ws.length > 1 ? [`${ws[0]} ${ws[1]}`, ...ws.slice(2)] : ws;
    return `${esc(how.slice(0, i))}<span class="say-sound">${parts.map((w) => `<span class="say-w">${esc(w)}</span>`).join(' ')}</span>`;
  };
  function toggleSay(b) {
    const cap = document.getElementById(b.getAttribute('aria-controls'));
    if (!cap) return;
    const open = b.getAttribute('aria-expanded') !== 'true';
    buzz('selection');
    b.setAttribute('aria-expanded', String(open));
    cap.classList.toggle('is-open', open);
  }
  // One entry (dir-3 anatomy, design-v9 amendments b1.3): no box. Its time chip ("around" before a rough
  // time, spec 8.5; exact for the noon cannon, Gesù at 17:30, a class session), "Felix's pick" when it is
  // his, then the photos (one at a time; a tap pages them), the title, the line, the facts, the friend's
  // tip, and quiet text actions: Swap (when there is something to swap to), Remove, the links at the
  // right. On a laptop the time sits in a gutter left of the photos.
  const aroundWord = fmt(U.around, { time: '' }).trim();
  function stopHTML(it, time, attrs) {
    const o = it.option, D = C.day;
    const i = picks.findIndex((p) => p.id === o.id);
    const reason = i >= 0 ? picks[i].reason : 'added';
    const alts = i >= 0 ? P.alternatives(C, picks, i, { want: answers?.want || [] }) : [];
    const id = esc(o.id);
    // Only Felix's pick says why it is there: her own answers need no label (design-v9 4.5.2).
    const why = reason === 'felix' ? `<span class="stop-why label">${esc(WHY.felix.label)}</span>` : '';
    return `<li class="plan-item stop" ${attrs} data-dot="${id}" data-hud-title="${esc(o.hud || o.title)}">
        ${tripHTML(it)}<article class="stop-card" aria-labelledby="st-${id}">
          <p class="stop-top">${whenHTML(it, why)}</p>
          ${stripHTML(o, '(min-width: 1024px) 640px, 92vw')}
          <div class="stop-text">
            <h4 class="stop-title" id="st-${id}"><span class="sr-only">${esc(time)}, </span>${esc(o.title)}</h4>
            <p class="stop-line">${lineHTML(o, `say-${o.id}`)}</p>
            <p class="stop-facts">${factsHTML(factList(o))}</p>
            ${tipHTML(o, 'stop-tip')}
            <div class="stop-actions">${alts.length ? hap(`<button type="button" class="tbtn" data-action="swap" aria-expanded="false" aria-controls="sw-${id}">${esc(D.swap)}<span class="sr-only">: ${esc(o.title)}</span></button>`) : ''}${hap(`<button type="button" class="tbtn" data-action="remove">${esc(D.remove)}<span class="sr-only">: ${esc(o.title)}</span></button>`)}${linksHTML(o)}</div>
          </div>
        </article>
        ${alts.length ? swapHTML(o.id, alts) : ''}
      </li>`;
  }
  // v9d D1 (design-d1.md 5): the trip into an entry, one quiet grey line at its top: "35 min, Bus 40" or "25 min
  // walk" (the usual minutes, rounded up to 5). Screen readers hear a sentence instead ("35 minutes there by Bus 40."),
  // inside the entry and before its heading.
  function tripHTML(it) {
    const t = it.trip, D = C.day.trip;
    if (!t) return '';
    const shown = t.walk ? fmt(D.walk, { min: t.min }) : fmt(D.ride, { min: t.min, mode: t.mode });
    const said = t.walk ? fmt(D.srWalk, { min: t.min }) : fmt(D.srRide, { min: t.min, mode: t.mode.replace(/ \+ /g, U.listJoinLast) });
    return `<p class="plan-trip"><span aria-hidden="true">${esc(shown)}</span><span class="sr-only">${esc(said)}</span></p>`;
  }
  // v9d D1 (design-d1.md 4.1): "If there's time" after dinner: her picks that do not fit, in her order, each a small
  // photo, the title and Swap in (or, when it cannot go on even first, the dinner time it needs). After a Swap in,
  // its Undo stands where the row was.
  function laterHTML() {
    const D = C.day.later;
    const rows = plan.later.map((l) => {
      const o = l.option, f = laterNow.find((x) => x.id === o.id) || { ok: true };
      const act = f.ok ? hap(`<button type="button" class="btn btn--quiet later-in" data-action="swapin" data-id="${esc(o.id)}">${esc(D.swapIn)}<span class="sr-only">: ${esc(o.title)}</span></button>`, 'add')
        : f.needs ? `<span class="later-why">${esc(fmt(D.needsTime, { time: f.needs }))}</span>` : '';
      return `<li class="later-row" data-key="${esc(o.id)}">${thumbHTML(o.photos?.[0], 'later-photo', '56px')}<span class="later-name">${esc(o.title)}</span>${act}</li>`;
    });
    const back = undo && undo.list ? undoHTML() : '';
    if (!rows.length) return back;
    if (back) rows.splice(Math.min(undo.at, rows.length), 0, back);
    return `<li class="plan-group plan-group--later"><h3 class="label" id="later-h">${esc(D.title)}</h3></li><li class="plan-later"><ul class="later-list" aria-labelledby="later-h">${rows.join('')}</ul></li>`;
  }
  // "More ideas" after the day (design-v9 4.5.7): a group label (only when there is something to offer),
  // then the ideas and "See everything". An idea is its photo (a button that opens it), the answer it
  // serves, the title and Add: no time, no price (AM12). Adding always works.
  function roomHTML() {
    const D = C.day;
    const sugg = roomNow;
    const tiles = sugg.map((x) => {
      const o = OPT[x.id];
      const label = x.reason === 'added' ? groupLabel(o) : reasonLabel(x.reason);
      return `<li class="room-tile">
          ${hap(photoButtonHTML(o, 'room-photo', '(min-width: 640px) 240px, 96px'), 'rphoto')}
          <span class="room-why label">${esc(label)}</span>
          <span class="room-name">${esc(o.title)}</span>
          ${hap(`<button type="button" class="btn btn--quiet room-add" data-action="add" data-id="${esc(x.id)}" data-reason="${esc(x.reason)}">${esc(D.add)}<span class="sr-only">: ${esc(o.title)}</span></button>`, 'add')}
        </li>`;
    }).join('');
    return `${sugg.length ? `<li class="plan-group plan-group--more"><h3 class="label">${esc(D.roomTitle)}</h3></li>` : ''}<li class="plan-room${sugg.length ? '' : ' is-bare'}">
        ${sugg.length ? `<ul class="room-list">${tiles}</ul>` : ''}
        ${hap(`<button type="button" class="btn room-all" data-action="catalogue" aria-haspopup="dialog">${esc(D.seeEverything)}</button>`, 'all')}
      </li>`;
  }
  const undoHTML = () => `<li class="plan-undo">${hap(`<button type="button" class="undo-btn" data-action="undo">${esc(C.day.undo)}<span class="sr-only">: ${esc(undo.title)}</span></button>`)}</li>`;

  // The dinner card (spec 4.2, AM2): "around 19:00", "Dinner", one line, then the three ideas. Each idea:
  // its name, its line, "{area} · {booking} · {price}", the friend's tip, Map, and "This one". Tapping
  // "This one" picks it (and lets go of the others); tapping it again goes back to none.
  const dinnerBody = () => (dinner ? fmt(C.anchors.dinner.bodyPicked, { title: IDEA[dinner].title }) : C.anchors.dinner.bodyNone);
  // Dinner's time is hers to change (v9c C1f, felix-2.md 3): the time row is one button that opens a strip of six
  // times, 18:30 to 21:00 in half hours, the current one pressed.
  function dinnerTimeHTML(it) {
    const D = C.day, A = C.anchors.dinner;
    const time = fmt(U.around, { time: it.rough });
    const opts = A.times.map((t) => hap(`<button type="button" class="dt-opt" data-action="dinner-at" data-at="${esc(t)}" aria-pressed="${t === it.rough}">${esc(t)}</button>`, 'opt')).join('');
    return `<p class="plan-time">${hap(`<button type="button" class="when-btn" data-action="dinner-time" aria-expanded="false" aria-controls="dt-pick"><span class="stop-around" aria-hidden="true">${esc(aroundWord)}</span><span class="chip${dinner ? '' : ' chip--frame'}" aria-hidden="true">${FLAP.repeat(5)}</span>${ICON.chev}<span class="sr-only">${esc(D.dinnerTime)}: ${esc(time)}</span></button>`, 'when')}${nowTag}</p>
        <div class="dt-pick" id="dt-pick" hidden><p class="dt-ask label">${esc(D.dinnerEarlier)}</p><div class="dt-opts" role="group" aria-label="${esc(D.dinnerTime)}">${opts}</div></div>`;
  }
  function dinnerHTML(it, time, attrs, timeRow) {
    const A = C.anchors.dinner;
    const ideas = IDEAS.map((d) => `<li class="dinner-idea">
          <div class="dinner-text">
            <p class="dinner-name">${esc(d.title)}</p>
            <p class="dinner-line">${esc(d.line)}</p>
            <p class="dinner-facts">${factsHTML([d.area, d.booking, d.price].filter(Boolean))}</p>
            ${tipHTML(d, 'stop-tip')}
          </div>
          <div class="dinner-acts">
            ${hap(`<button type="button" class="peek-toggle dinner-toggle" aria-pressed="${dinner === d.id}" data-action="dinner" data-id="${esc(d.id)}"><span class="peek-toggle-in">${ICON.tick}${esc(PK.pick)}</span><span class="sr-only">: ${esc(d.title)}</span></button>`)}
            ${mapLink(d).replace('class="stop-map"', 'class="stop-map tbtn"')}
          </div>
        </li>`).join('');
    return `<li class="plan-item plan-item--text plan-dinner" ${attrs} data-dot="${dinner ? 'dinner' : ''}" data-hud-title="${esc(A.hud || A.title)}">
        ${tripHTML(it)}<div class="plan-text">${timeRow}<h4 class="plan-title" id="dinner-h"><span class="sr-only">${esc(time)}, </span>${esc(A.title)}</h4><p class="plan-line dinner-body">${esc(dinnerBody())}</p></div>
        <ul class="dinner-ideas" aria-labelledby="dinner-h">${ideas}</ul>
      </li>`;
  }
  // A dinner pick builds the day again (v9d D1: the last trip goes to her pizza place, so the day may change), with
  // the board's dinner row (one diff wave), the map's dinner dot and the share text. The toggle she pressed stays
  // where it was on screen (the trip line above dinner comes and goes), keeps focus (its ring only from the keyboard)
  // and still eases into its new state. The live region names anything that moved to "If there's time".
  function setDinner(id, byKey = false) {
    buzz('selection');
    const was = dinner;
    dinner = dinner === id ? null : cleanDinner(id);
    fromLink = false;
    saveState();
    const toggle = () => $(`.dinner-toggle[data-id="${CSS.escape(id)}"]`, slot('day-body'));
    const y0 = toggle()?.getBoundingClientRect().top;
    const prev = plan;
    update();
    const b = toggle();
    if (!b) return;
    if (y0 !== undefined) { const dy = b.getBoundingClientRect().top - y0; if (dy) scrollBy({ top: dy, behavior: 'instant' }); }
    // The re-rendered toggles start from the old state, so their transition still plays.
    const flip = $$('.dinner-toggle', slot('day-body')).filter((t) => t.dataset.id === was || t.dataset.id === dinner);
    flip.forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.id === was)));
    void b.offsetWidth;
    flip.forEach((t) => t.setAttribute('aria-pressed', String(t.dataset.id === dinner)));
    b.focus({ preventScroll: true, focusVisible: byKey });
    announceMoved(prev);
  }

  function renderDay() {
    const D = C.day;
    const body = slot('day-body');
    hideCtl(slot('change-answers'), !answers);
    // Under "Your Friday": one line per pick that can't happen on Friday (v9d D1: nothing overlaps any more, and
    // what does not fit waits under "If there's time").
    const lines = [];
    plan.didntFit.forEach((d) => lines.push(`<p class="day-cant">${esc(fmt(D.cant, { title: d.option.title, why: d.why }))}</p>`));
    slot('day-lines').innerHTML = lines.join('');
    slot('day-lines').hidden = !lines.length;
    if (!picks.length && !answers) { body.innerHTML = `<p class="day-empty">${esc(D.empty)}</p>`; return; }
    let html = '', group = '', undoShown = false;
    plan.items.forEach((it) => {
      if (it.slot !== group) {
        group = it.slot;
        html += `<li class="plan-group"><h3 class="label">${esc(D.slots[group])}</h3></li>`;
      }
      const time = it.exact ? it.rough : fmt(U.around, { time: it.rough });
      const key = it.kind === 'lunch-filler' ? 'lunch' : it.id;
      const attrs = `data-min="${toMin(it.rough)}" data-key="${esc(key)}"`;
      // The plain lunch line and the luggage are the day's own lines (v9c C1m: grey chips); dinner sets its own.
      const timeRow = `<p class="plan-time">${whenHTML(it, '', it.kind === 'lunch-filler' || it.id === 'bags' ? 'frame' : '')}</p>`;
      if (it.kind === 'option') html += stopHTML(it, time, attrs);
      else if (it.kind === 'lunch-filler') html += `<li class="plan-item plan-item--text" ${attrs} data-hud-title="${esc(D.noLunch)}">${tripHTML(it)}<div class="plan-text">${timeRow}<h4 class="plan-line"><span class="sr-only">${esc(time)}, </span>${esc(D.noLunch)}</h4></div></li>`;
      else if (it.id === 'dinner') html += dinnerHTML(it, time, attrs, dinnerTimeHTML(it));
      else {
        const a = it.anchor;
        html += `<li class="plan-item plan-item--text" ${attrs} data-dot="" data-hud-title="${esc(a.hud || a.title)}">
          ${tripHTML(it)}<div class="plan-text">${timeRow}<h4 class="plan-title"><span class="sr-only">${esc(time)}, </span>${esc(a.title)}</h4>${a.body ? `<p class="plan-line">${esc(a.body)}</p>` : ''}</div>
        </li>`;
      }
      if (undo && !undo.list && !undoShown && key === undo.after) { html += undoHTML(); undoShown = true; }
    });
    if (undo && !undo.list && !undoShown) html = undoHTML() + html;
    // If there's time, then More ideas and See everything come after the day, so it reads morning to night
    // without a detour.
    html += laterHTML();
    html += roomHTML();
    body.innerHTML = `<ol class="plan">${html}</ol>`;
    watchKeyhole();
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
  // The dinner time strip opens and closes like Swap's (v9c C1f).
  function toggleDinnerTime(btn) {
    const el = document.getElementById('dt-pick');
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
  // A time from the strip: the day is built again with dinner there (only dinner moves), the strip closes and the
  // chip flips once from the old time (syncChips); the board's dinner row, the bar's clock, the sky and the map at
  // dinner, the send text and the link follow. The time she already has just closes the strip.
  function setDinnerAt(at, byKey = false) {
    buzz('selection');
    if (at === plan.dinnerAt) { const b = $('[data-action="dinner-time"]', slot('day-body')); if (b && b.getAttribute('aria-expanded') === 'true') toggleDinnerTime(b); return; }
    dinnerAt = cleanDinnerAt(at);
    fromLink = false;
    saveState();
    const prev = plan;
    update();
    announceMoved(prev); // v9d D1 (ruling S6): an earlier dinner can move something to If there's time
    // Focus goes back to the time; its ring shows only for the keyboard (after a finger or a mouse, a ring would sit
    // around the time as if it were still being chosen).
    $('[data-action="dinner-time"]', slot('day-body'))?.focus({ preventScroll: true, focusVisible: byKey });
  }
  // Use this: the stop is replaced (same answer) and goes to the front of her list, so it lands on her day (v9d D1);
  // the card fades over to the new one, and the live region names anything that moved to "If there's time".
  // Focus goes on to the new card; its ring shows only for the keyboard (v9c merge fix: after a finger on the cover,
  // WebKit would otherwise draw it, which live 24e46f2 did not). The same for Remove, Undo and Add below.
  function useAlternative(btn, byKey = false) {
    const li = btn.closest('.stop');
    const i = picks.findIndex((p) => p.id === li.dataset.key);
    const id = btn.dataset.id;
    if (i < 0 || !OPT[id]) return;
    const next = [{ id, reason: picks[i].reason }, ...picks.filter((_, j) => j !== i)];
    const land = () => {
      const prev = plan;
      setPicks(next);
      announceMoved(prev);
      const nl = stopEl(id);
      if (!nl) return;
      if (!inView(nl)) nl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
      if (!reduced) gsap.from($('.stop-card', nl), { opacity: 0, duration: 0.2, ease: 'power1.out', clearProps: 'opacity' });
      $('[data-action="swap"], [data-action="remove"]', nl).focus({ preventScroll: true, focusVisible: byKey });
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
      const waiting = plan.later.map((l) => l.id);
      setPicks(picks.filter((_, j) => j !== i), { keepUndo: true });
      // v9d D1: the time it frees can bring the top of "If there's time" onto her day; that entry lights up.
      const pulled = plan.options.filter((o) => waiting.includes(o.id));
      pulled.forEach((o) => flash(stopEl(o.id)));
      if (pulled.length) announce(pulled.map((o) => fmt(C.day.live.onDay, { title: o.title })).join(' '));
      $('.undo-btn', slot('day-body'))?.focus({ preventScroll: true, focusVisible: ev?.detail === 0 });
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
  function undoRemove(byKey = false, ev = null) {
    if (!undo) return;
    if (undo.list) { undoSwapIn(byKey, ev); return; }
    const { pick, index } = undo;
    undoDrop();
    const next = [...picks];
    next.splice(Math.min(index, next.length), 0, pick);
    setPicks(next);
    const nl = stopEl(pick.id);
    if (!nl) return;
    if (!reduced) gsap.from(nl, { opacity: 0, duration: 0.22, ease: 'power1.out', clearProps: 'opacity' });
    $('[data-action="remove"]', nl).focus({ preventScroll: true, focusVisible: byKey });
  }
  // v9d D1 (design-d1.md 4.2): Swap in puts a pick from "If there's time" first in her list, so it goes on her day;
  // whatever no longer fits moves to the list. The new entry lights up (and comes into view), focus goes to its
  // Remove (the ring only from the keyboard), the live region says what happened, and Undo stands where the row was
  // for 6 s: it puts her list back exactly as it was. A double tap's second tap, landing on that Undo, does nothing
  // (Remove's guard).
  let lastSwapIn = null;
  function swapIn(btn, ev) {
    const id = btn.dataset.id;
    const i = picks.findIndex((p) => p.id === id);
    if (i < 0 || (ev && ev.detail > 1)) return;
    const pointer = !!ev && ev.detail > 0;
    lastSwapIn = pointer ? { t: performance.now(), x: ev.clientX, y: ev.clientY } : null;
    const prev = plan, list = picks.map((p) => ({ ...p }));
    undoDrop();
    undo = { list, id, at: prev.later.findIndex((l) => l.id === id), title: OPT[id].title, timer: setTimeout(() => undoDrop(true), 6000) };
    setPicks([picks[i], ...picks.filter((_, j) => j !== i)], { keepUndo: true });
    const on = plan.options.some((o) => o.id === id);
    announceMoved(prev, fmt(on ? C.day.live.onDay : C.day.live.inLater, { title: OPT[id].title }));
    const nl = stopEl(id);
    if (!nl) return;
    flash(nl);
    if (!inView(nl)) nl.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' });
    $('[data-action="remove"]', nl).focus({ preventScroll: true, focusVisible: !pointer });
  }
  function undoSwapIn(byKey, ev) {
    const now = performance.now();
    if (ev && (ev.detail > 1 || (ev.detail > 0 && lastSwapIn && now - lastSwapIn.t < 500 && Math.hypot(ev.clientX - lastSwapIn.x, ev.clientY - lastSwapIn.y) < 24))) return;
    const { list, id } = undo;
    undoDrop();
    setPicks(list);
    $(`.later-row[data-key="${CSS.escape(id)}"] .later-in`, slot('day-body'))?.focus({ preventScroll: true, focusVisible: byKey });
  }
  // The live region (design-d1.md 4.2): `lead`, then the picks that were on her day before and now wait.
  function announceMoved(prev, lead = '') {
    const moved = plan.later.filter((l) => prev && prev.options.some((o) => o.id === l.id)).map((l) => l.option.title);
    announce([lead, moved.length ? fmt(C.day.live.moved, { list: listOf(moved) }) : ''].filter(Boolean).join(' '));
  }
  function announce(text) { const el = document.getElementById('day-live'); if (el) el.textContent = text; }
  // Add (More ideas, the catalogue): the new card lights up briefly where it lands (v9d D1: on her day, or under
  // "If there's time" when it does not fit), and the live region says which.
  function addPick(id, reason, byKey = false) {
    if (!OPT[id] || picks.some((p) => p.id === id)) return;
    setPicks([...picks, { id, reason }]);
    const on = plan.options.some((o) => o.id === id);
    announce(fmt(on ? C.day.live.onDay : C.day.live.inLater, { title: OPT[id].title }));
    flash(on ? stopEl(id) : $(`.later-row[data-key="${CSS.escape(id)}"]`, slot('day-body')));
    // Keyboard: the button she pressed is gone with the re-render; carry on from the room.
    if (!slot('catalogue').open) ($('.room-add', slot('day-body')) || $('[data-action="catalogue"]', slot('day-body')))?.focus({ preventScroll: true, focusVisible: byKey });
  }
  function flash(el, ms = 1200) {
    if (!el) return;
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
    clearTimeout(el.flashT);
    el.flashT = setTimeout(() => el.classList.remove('is-flash'), ms);
  }
  // Dots under a photo strip: a tap scrolls to that photo, a swipe moves the dot. Photos may be
  // narrower than the strip (the peek lets the next one show), so positions come from the photos.
  const stripLeft = (strip, n) => strip.children[n].offsetLeft - strip.children[0].offsetLeft;
  function onStripDot(dot) {
    const strip = $('.stop-strip', dot.closest('.stop-photos'));
    strip.scrollTo({ left: stripLeft(strip, +dot.dataset.n), behavior: reduced ? 'auto' : 'smooth' });
  }
  // A tap on a photo pages its strip to the next photo, round to the first after the last.
  function pageStrip(photo) {
    const strip = photo.closest('.stop-strip');
    const n = strip.children.length;
    if (n < 2) return;
    const cur = [...strip.children].indexOf(photo);
    strip.scrollTo({ left: stripLeft(strip, (cur + 1) % n), behavior: reduced ? 'auto' : 'smooth' });
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
    // A tap or a click on an entry's photo shows the next one (no dialog: the entry already says it all).
    const ph = e.target.closest('.stop .stop-photo');
    if (ph) { pageStrip(ph); return; }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const a = b.dataset.action;
    if (a === 'photos') openPeek(b, 'one', { id: b.dataset.id });
    else if (a === 'swap') toggleSwap(b);
    else if (a === 'use') useAlternative(b, e.detail === 0);
    else if (a === 'remove') removeStop(b, e);
    else if (a === 'undo') undoRemove(e.detail === 0, e);
    else if (a === 'swapin') swapIn(b, e);
    else if (a === 'add') addPick(b.dataset.id, b.dataset.reason, e.detail === 0);
    else if (a === 'dinner') setDinner(b.dataset.id, e.detail === 0);
    else if (a === 'dinner-time') toggleDinnerTime(b);
    else if (a === 'dinner-at') setDinnerAt(b.dataset.at, e.detail === 0);
    else if (a === 'catalogue') openCatalogue();
    else if (a === 'say') toggleSay(b);
  }

  /* ------------------------------------------------------------------ */
  /* See everything: every option, grouped like the questions            */
  /* ------------------------------------------------------------------ */

  function renderCatalogue() {
    const D = C.day;
    // The heading takes focus when the sheet opens (it names the dialog), not the Close button.
    slot('catalogue').innerHTML = `<div class="sheet-grab" aria-hidden="true"></div><div class="sheet-head"><h2 id="cat-h" tabindex="-1" autofocus>${esc(D.seeEverything)}</h2>${hap(`<button type="button" class="btn btn--small" data-action="close">${esc(D.close)}</button>`)}</div>
      <div class="sheet-body">${C.catalogue.groups.map((g) => {
        const opts = C.options.filter((o) => o.group === g.id);
        if (!opts.length) return '';
        // A tile per option, as on the questions: the photo (it opens the thing), the text under it, then Add.
        return `<section class="cat-group" aria-labelledby="cg-${esc(g.id)}"><h3 class="label" id="cg-${esc(g.id)}">${esc(g.label)}</h3><ul class="cat-list">${opts.map((o) => `<li class="cat-row">
            ${hap(photoButtonHTML(o, 'cat-photo', '(min-width: 1024px) 240px, (min-width: 640px) 30vw, 44vw'), 'cphoto')}
            <span class="cat-text"><span class="cat-name">${esc(o.title)}</span><span class="cat-line">${esc(o.line)}</span></span>
            <span class="cat-acts">
            ${hap(`<button type="button" class="cat-add" aria-pressed="false" data-id="${esc(o.id)}"><span class="cat-add-label">${esc(D.add)}</span>${ICON.check}<span class="sr-only">: ${esc(o.title)}</span></button>`)}<span class="cat-no" id="cw-${esc(o.id)}" hidden></span></span>
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
    sheetIn(dlg);
  }
  function closeCatalogue(fromY = 0, byKey = false) {
    const dlg = slot('catalogue');
    if (!dlg.open || dlg.classList.contains('is-closing')) return;
    sheetByKey = byKey;
    sheetOut(dlg, fromY, () => dlg.close());
  }
  // Adding from here carries ADDED; tapping the check takes it off the day again. Photos opens the peek.
  function onCatalogueClick(e) {
    if (e.target === slot('catalogue')) { closeCatalogue(); return; } // the backdrop
    if (e.target.closest('[data-action="close"]')) { closeCatalogue(0, e.detail === 0); return; }
    const ph = e.target.closest('[data-action="photos"]');
    if (ph) { openPeek(ph, 'one', { id: ph.dataset.id }); return; }
    const b = e.target.closest('.cat-add');
    if (!b) return;
    const id = b.dataset.id;
    if (picks.some((p) => p.id === id)) { setPicks(picks.filter((p) => p.id !== id)); return; }
    addPick(id, 'added');
  }

  /* ------------------------------------------------------------------ */
  /* Sheets: the iOS curve in, a softer exit, drag down to close         */
  /* ------------------------------------------------------------------ */

  // v9 (dir-3 openSheet/closeSheet/bindDrag; design-v9 amendments b1.2). Phone: the sheet rises from the
  // bottom over 500 ms on the iOS sheet curve and leaves in 260 ms; dragging its handle or head down past a
  // quarter of its height, or flicking it at 0.4 px/ms, closes it. Tablet and laptop: a fade with a 2 %
  // scale, 260 ms in, 160 ms out. Reduced motion: a fade, 200 / 150 ms. Web Animations, so the compositor runs them.
  // From 768 px the sheets are centred panels (styles.css), so they fade instead of rising, and do not drag.
  const sheetWide = () => matchMedia('(min-width: 768px)').matches;
  // Focus goes back to the control that opened a sheet with its ring only when the sheet was closed from the keyboard
  // (Escape, or Enter or Space on Done, X or Close): WebKit drew it after a finger too (fold-in, gate-mechanics N1).
  // A control the dialog has already handed focus back to is focused again, so the choice applies.
  let sheetByKey = false;
  const refocus = (el) => { if (document.activeElement === el) el.blur(); el.focus({ preventScroll: true, focusVisible: sheetByKey }); };
  function sheetIn(dlg) {
    dlg.classList.remove('is-closing');
    dlg.style.transform = '';
    if (reduced) return dlg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    if (sheetWide()) return dlg.animate([{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    return dlg.animate([{ transform: 'translateY(100%)' }, { transform: 'translateY(0)' }], { duration: 500, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
  }
  function sheetOut(dlg, fromY, done) {
    dlg.classList.add('is-closing');
    const a = reduced ? dlg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'ease-out', fill: 'forwards' })
      : sheetWide() ? dlg.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.98)' }], { duration: 160, easing: 'ease-out', fill: 'forwards' })
        : dlg.animate([{ transform: `translateY(${fromY}px)` }, { transform: 'translateY(100%)' }], { duration: 260, easing: 'ease-out', fill: 'forwards' });
    a.onfinish = () => { done(); a.cancel(); dlg.classList.remove('is-closing'); dlg.style.transform = ''; };
  }
  function bindDrag(dlg, close) {
    let y0 = 0, t0 = 0, dy = 0, on = false, id = null;
    dlg.addEventListener('pointerdown', (e) => {
      if (sheetWide() || dlg.classList.contains('is-closing') || !e.target.closest('.sheet-grab, .peek-head, .sheet-head') || e.target.closest('button, a, .hap')) return;
      on = true; id = e.pointerId; y0 = e.clientY; t0 = performance.now(); dy = 0;
      // A pointer the browser no longer counts as active cannot be captured; the drag works without it.
      try { dlg.setPointerCapture(id); } catch { /* not capturable */ }
    });
    dlg.addEventListener('pointermove', (e) => {
      if (!on || e.pointerId !== id) return;
      dy = e.clientY - y0;
      dlg.style.transform = `translateY(${dy < 0 ? dy * 0.15 : dy}px)`; // pulling up past the top is damped
    });
    const end = (e) => {
      if (!on || e.pointerId !== id) return;
      on = false;
      const v = dy / Math.max(1, performance.now() - t0);
      if (dy > dlg.offsetHeight * 0.25 || v > 0.4) { close(Math.max(dy, 0)); return; }
      if (dy) dlg.animate([{ transform: `translateY(${Math.max(dy, 0)}px)` }, { transform: 'translateY(0)' }], { duration: 300, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
      dlg.style.transform = '';
    };
    dlg.addEventListener('pointerup', end);
    dlg.addEventListener('pointercancel', end);
  }

  /* ------------------------------------------------------------------ */
  /* The peek: what is behind a choice, in photos, one tap away          */
  /* ------------------------------------------------------------------ */

  // One dialog, three uses: `vibe` ("See all 8" under a sight or a food: every thing behind it as a
  // compact row, each with "This one"; with one thing behind it, the class, that thing alone, "Have a
  // look"), `pick` ("Have a look" under an area or a wild card: the place, with "This one"), and `one`
  // (a More ideas photo or See everything: the place, no toggle). A bottom sheet on a phone, a centred
  // panel on a laptop; a single thing shows its photos, line, facts and details, "This one" in the foot.
  // `ask` (v9d D5): the list opened by the tile's own tap, titled "Anything in particular?".
  const peek = { kind: null, step: -1, value: null, id: null, opener: null, closing: false, ask: false };
  // "This one". For something that can't happen on Friday, its reason shows in place of the toggle (the
  // toggle stays for screen readers, disabled and described by the reason).
  const toggleHTML = (o, action) => `${o.fridayNo ? `<p class="peek-no" id="pn-${esc(o.id)}">${esc(o.fridayNo)}</p>` : ''}${hap(`<button type="button" class="peek-toggle${o.fridayNo ? ' is-no' : ''}" aria-pressed="false" data-action="${action}" data-id="${esc(o.id)}"${o.fridayNo ? ` disabled aria-describedby="pn-${esc(o.id)}"` : ''}><span class="peek-toggle-in">${ICON.tick}${esc(action === 'want' ? PK.want : PK.pick)}</span><span class="sr-only">: ${esc(o.title)}</span></button>`, 'toggle')}`;
  const peekTextHTML = (o) => `<div class="peek-text">
          <h3 class="peek-name" id="pk-${esc(o.id)}">${esc(o.title)}</h3>
          <p class="peek-line">${lineHTML(o, `say-${o.id}-pk`)}</p>
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
        ${hap(`<button type="button" class="peek-thumb" data-action="expand" aria-expanded="false" aria-controls="pp-${id}">${thumbHTML(o.photos?.[0], 'peek-thumb-img', '(min-width: 1024px) 160px, 112px')}<span class="sr-only">${esc(PK.openPhotos)}: ${esc(o.title)}</span></button>`, 'thumb')}
        ${peekTextHTML(o)}
        <div class="peek-strip" id="pp-${id}" hidden>${stripHTML(o, PEEK_ROW_SIZES, '', k < 5 ? 'eager' : 'lazy')}</div>
        ${toggleHTML(o, 'want')}
      </article>`;
  }
  // The class's details (design-v9 2.4): When, Sauce, Where, Run by (v9d D6: no Drinks row, felix-6.md); the last row
  // ends with the option's second link (the Class page), opening in a new tab.
  const detailsHTML = (o) => {
    if (!o.details?.length) return '';
    const rows = o.details.map((d, i, a) => {
      const l = i === a.length - 1 && o.links?.[1];
      const more = l ? `${esc(C.day.facts.join)}<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}<span class="sr-only">: ${esc(o.title)}</span>${newTab}${ICON.out}</a>` : '';
      return `<dt class="label">${esc(d.label)}</dt><dd>${esc(d.text)}${more}</dd>`;
    }).join('');
    return `<dl class="peek-details">${rows}</dl>`;
  };
  // The single peek: one thing, its photos (a tap pages them), line, facts and details.
  const peekOneHTML = (o) => `<article class="peek-thing" aria-labelledby="pk-${esc(o.id)}">
        ${stripHTML(o, '(min-width: 1024px) 400px, 92vw', '', 'eager')}
        <div class="peek-text">
          <h3 class="peek-name" id="pk-${esc(o.id)}">${esc(o.title)}</h3>
          <p class="peek-line">${esc(o.line)}</p>
          <p class="peek-facts">${factsHTML(factList(o))}</p>
          ${detailsHTML(o)}
          ${tipHTML(o, 'peek-tip')}
        </div>
      </article>`;
  function openPeek(opener, kind, { step = -1, value = null, id = null, ask = false } = {}) {
    const dlg = slot('peek');
    if (dlg.open) return;
    // A sight or a food with one thing behind it (the class) opens that thing alone, with "This one"
    // naming it under the food (design-v9 2.4); the list is for two or more.
    const single = kind === 'vibe' && servedBy(value).length === 1 ? servedBy(value)[0] : null;
    Object.assign(peek, { kind, step, value, id: single ? single.id : id, opener, closing: false, ask: ask && !single });
    let title, hint = '', body, foot, over = '';
    if (kind === 'vibe' && !single) {
      // v9d D5: opened by the tile's tap, it asks "Anything in particular?" under the sight or food's name, and its foot
      // reads "Any is fine" until she names a thing here, then Done (syncPeek). Either one only closes it.
      title = peek.ask ? PK.askTitle : tileLabel(tileOf(STEPS[step], value));
      if (peek.ask) over = `<p class="peek-over label">${esc(tileLabel(tileOf(STEPS[step], value)))}</p>`;
      hint = PK.vibeHint;
      body = `<div class="peek-list">${servedBy(value).map(peekRowHTML).join('')}</div>`;
      foot = hap(`<button type="button" class="btn btn--primary peek-done" data-action="peek-close">${esc(peek.ask ? PK.anyFine : PK.done)}</button>`, 'done');
    } else {
      const o = single || OPT[id];
      title = o.title;
      body = peekOneHTML(o);
      const action = single ? 'want' : kind === 'pick' ? 'pick' : '';
      foot = action ? toggleHTML(o, action) : '';
    }
    dlg.className = `sheet peek peek--${kind === 'vibe' && !single ? 'list' : 'one'}${peek.ask ? ' peek--ask' : ''}`;
    dlg.innerHTML = `<div class="sheet-grab" aria-hidden="true"></div>
      <div class="peek-head">
        <div class="peek-titles">${over}<h2 id="peek-h" tabindex="-1">${esc(title)}</h2>${hint ? `<p class="peek-hint">${esc(hint)}</p>` : ''}</div>
        ${hap(`<button type="button" class="peek-x" data-action="peek-close" aria-label="${esc(PK.close)}">${ICON.close}</button>`, 'x')}
      </div>
      <div class="peek-body">${body}</div>
      ${foot ? `<div class="peek-foot sheet-foot">${foot}</div>` : ''}`;
    syncPeek();
    root.classList.add('is-locked');
    dlg.showModal();
    // The title takes focus (it names the dialog), not the close button.
    $('#peek-h', dlg).focus({ preventScroll: true });
    sheetIn(dlg);
    // The Aventine's own sheet: its first photo shows through the keyhole (b3.3).
    if (peek.id === 'keyhole') keyholeOpen($('.peek-thing .stop-photo[data-n="0"]', dlg), 0.18, 'sheet');
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
    // v9d D5: "Any is fine" while nothing is named here, Done once something is.
    const done = peek.ask && $('.peek-done', dlg);
    if (done) { const t = d.want.some(wantedHere) ? PK.done : PK.anyFine; if (done.textContent !== t) done.textContent = t; }
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
  // Out: the sheet's exit (sheetOut). Escape, X, Done, the backdrop and a drag all close.
  function closePeek(fromY = 0, byKey = false) {
    const dlg = slot('peek');
    if (!dlg.open || peek.closing) return;
    peek.closing = true;
    sheetByKey = byKey;
    // Focus goes back right after close(), so the browser's own focus restore cannot land elsewhere.
    sheetOut(dlg, fromY, () => { const o = peek.opener; dlg.close(); if (o && o.isConnected) refocus(o); });
  }
  function onPeekClick(e) {
    const dlg = slot('peek');
    if (e.target === dlg) { closePeek(); return; } // the backdrop
    const dot = e.target.closest('.stop-dot');
    if (dot) { onStripDot(dot); return; }
    const first = e.target.closest('.peek-strip .stop-photo[data-n="0"]');
    if (first) { toggleStrip($('.peek-thumb', first.closest('.peek-row'))); return; }
    // A single thing's photo: a tap pages to the next one (a swipe still scrolls the strip).
    const ph = e.target.closest('.peek-thing .stop-photo');
    if (ph) { pageStrip(ph); return; }
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'peek-close') closePeek(0, e.detail === 0);
    else if (b.dataset.action === 'expand') toggleStrip(b);
    else if (b.dataset.action === 'want' || b.dataset.action === 'pick') onPeekToggle(b);
    else if (b.dataset.action === 'say') toggleSay(b);
  }
  // However it closed: the page scrolls again and focus goes back to the button that opened it.
  function onPeekClosed() {
    const dlg = slot('peek');
    dlg.getAnimations().forEach((a) => a.cancel());
    dlg.classList.remove('is-closing');
    dlg.style.transform = '';
    root.classList.remove('is-locked');
    peek.kind = null;
    peek.ask = false;
    peek.closing = false;
    if (peek.opener && peek.opener.isConnected && document.activeElement !== peek.opener) refocus(peek.opener);
    peek.opener = null;
  }

  /* ------------------------------------------------------------------ */
  /* The keyhole (design-v9 amendments b3.3, D1)                         */
  /* ------------------------------------------------------------------ */

  // The Aventine photo is the view through the Knights of Malta keyhole: the first time she sees it (the tile
  // when step 3 comes in, the first photo of its sheet, the photo of its entry on her day), it shows through a
  // near-black plate with a keyhole-shaped hole on the dome; after a beat the plate opens outward past the edges
  // and is gone (0.8 s). Once per page load on each of the three. Reduced motion: nothing is drawn.
  // The hole sits on the dome wherever the photo is cropped: its centre and size come from where `object-fit:
  // cover` puts the dome (48 % across, its lantern to its drum about 47 % down the photo, 27 % of its width wide)
  // in this frame, and the plate opens from the hole.
  const KEYHOLE = { x: 0.483, y: 0.47, r: 0.155 };
  const keyholeDone = new Set();
  function keyholeOpen(frame, delay, where) {
    if (reduced || !frame || keyholeDone.has(where) || !window.gsap) return;
    const img = $('img', frame);
    const W = frame.clientWidth, Hh = frame.clientHeight;
    if (!img || W < 20 || Hh < 20) return;
    keyholeDone.add(where);
    const iw = +img.getAttribute('width') || 1600, ih = +img.getAttribute('height') || 2134;
    const k = Math.max(W / iw, Hh / ih), dw = iw * k, dh = ih * k;
    const cx = (W - dw) / 2 + KEYHOLE.x * dw, cy = (Hh - dh) / 2 + KEYHOLE.y * dh, r = KEYHOLE.r * dw;
    // A keyhole: a round head and a slot that widens below it (D1's shape, scaled to the hole).
    const f = (n) => n.toFixed(1);
    const hole = `M${f(cx - 0.4375 * r)} ${f(cy + 0.9 * r)}A${f(r)} ${f(r)} 0 1 1 ${f(cx + 0.4375 * r)} ${f(cy + 0.9 * r)}L${f(cx + 0.875 * r)} ${f(cy + 3.5 * r)}H${f(cx - 0.875 * r)}Z`;
    frame.insertAdjacentHTML('beforeend', `<svg class="keyhole" viewBox="0 0 ${W} ${Hh}" aria-hidden="true"><path fill-rule="evenodd" d="M${-4 * W} ${-4 * Hh}H${5 * W}V${5 * Hh}H${-4 * W}Z${hole}"/></svg>`);
    const svg = frame.lastElementChild;
    const clip = frame.classList.contains('stop-photo'); // a photo in a strip clips the growing plate itself
    if (clip) frame.classList.add('has-keyhole');
    gsap.timeline({ delay, onComplete: () => { svg.remove(); if (clip) frame.classList.remove('has-keyhole'); } })
      .fromTo(svg, { scale: 1 }, { scale: 10, duration: 0.55, ease: 'power3.in', transformOrigin: `${f(cx)}px ${f(cy + 0.3 * r)}px` }, 0.25);
  }
  // Her entry and the Aventine tile: the first time the photo is two-thirds in view. Her entry's photo follows the
  // day's re-renders. A glide that only passes it (a board row, the clock) does not use it up; where a glide lands,
  // it is looked at again (fold-in, gates N4/N5/N1). The tile is watched from the moment step 3 comes in, and the
  // strip of screen under the stage's sticky foot does not count as in view (v9c P3: on a phone, answering step 2
  // with the questions low on the screen, the tile's keyhole opened below the fold).
  const keyholeIO = {}, keyholePh = {};
  function keyholeRecheck() { Object.keys(keyholeIO).forEach((w) => { const io = keyholeIO[w], ph = keyholePh[w]; if (io && ph) { io.unobserve(ph); io.observe(ph); } }); }
  function watchKeyholeAt(where, ph, delay, under = 0) {
    keyholeIO[where]?.disconnect();
    keyholeIO[where] = keyholePh[where] = null;
    if (reduced || !ph || keyholeDone.has(where) || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((es) => {
      if (gliding || !es.some((x) => x.isIntersecting && x.intersectionRatio >= 0.66)) return;
      io.disconnect();
      keyholeIO[where] = keyholePh[where] = null;
      keyholeOpen(ph, delay, where);
    }, { threshold: 0.66, rootMargin: `0px 0px ${-Math.round(under)}px 0px` });
    keyholeIO[where] = io;
    keyholePh[where] = ph;
    io.observe(ph);
  }
  function watchKeyhole() { watchKeyholeAt('entry', $('.stop[data-key="keyhole"] .stop-photo[data-n="0"]', slot('day-body')), 0); }
  // v9c C2a: the pill sticks 12 px above the screen's bottom, on a phone and on a laptop; what it covers is its
  // height and that gap.
  function footCover() { const f = $('.stage-foot', slot('stage')); return f && getComputedStyle(f).position === 'sticky' ? f.offsetHeight + 12 : 0; }

  /* ------------------------------------------------------------------ */
  /* Map: Nolli's Rome in 1748 under her day (design-v9 amendments b2)  */
  /* ------------------------------------------------------------------ */

  // From 1280 px the map sits sticky and unboxed left of her day; below 1280 px a pocket map in the bar
  // opens it as a sheet. One renderer (dir-2's Atlas): a canvas for the engraving, one SVG of marks on top.
  const wideMQ = matchMedia('(min-width: 1280px)');
  // Every new idle call: requestIdleCallback where it exists, else a timer (Safari has none).
  const idle = (fn, ms) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: ms }) : setTimeout(fn, 200));
  const NOL = MAP.nolli;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const rad = (d) => (d * Math.PI) / 180;
  // lat/lon to the engraving's master pixels (2250 x 2200): the affine fit in research/v9_nolli (RMS about 9 m).
  function toMap(lat, lon) {
    const e = (lon - NOL.lon0) * 111320 * Math.cos(rad(NOL.lat0)), n = (lat - NOL.lat0) * 110574;
    return { x: (NOL.ax[0] * e + NOL.ax[1] * n + NOL.ax[2] - NOL.crop[0]) * NOL.scale, y: (NOL.ay[0] * e + NOL.ay[1] * n + NOL.ay[2] - NOL.crop[1]) * NOL.scale };
  }
  // Today's OSM Tiber (map.json), carried onto the engraving: it is drawn until the engraving has come in,
  // and stays if the engraving never arrives.
  const RIVER = (() => {
    const PR = MAP.proj, out = [];
    for (const m of MAP.river.matchAll(/([ML])\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/g)) {
      const lat = PR.lat0 - ((+m[3] / PR.R) * 180) / Math.PI, lon = PR.lon0 + ((+m[2] / (PR.R * Math.cos(rad(PR.phi0)))) * 180) / Math.PI;
      if (m[1] === 'M' || !out.length) out.push([]);
      out[out.length - 1].push(toMap(lat, lon));
    }
    return out;
  })();
  // Seven places lie off the engraving or within 110 px (206 m) of its edge (Montemartini, the Pyramid, Villa
  // Borghese, St Peter's, the Sistine Chapel, the aqueducts, Coppedè). Each is a ring on the plan's edge, where
  // the line from the Pantheon towards it crosses the plan inset by 60 px.
  const PANTHEON = toMap(41.8986, 12.4768);
  // The keyhole's sight line (b3.7, dir-2 SIGHT.keyhole): from her Aventine stop to St Peter's dome, about 2.9 km,
  // the view the keyhole frames. A look from one place, so never drawn when St Peter's itself is on her day (it
  // would join two of her stops, and the map draws no route).
  const DOME = toMap(41.9022, 12.4533);
  const sightOK = () => !!plan && plan.items.some((it) => it.id === 'keyhole') && !plan.items.some((it) => it.id === 'stpeters');
  // The two race tracks (b3.9): Piazza Navona keeps the shape of Domitian's stadium, the Circus Maximus was the
  // chariot track. Each outline (OpenStreetMap, map.json `tracks`) shows when one of its stops is on her day, on the
  // laptop map and the phone's sheet, as a running lane under that stop's mark, while it is at least 24 px long.
  const TRACKS = Object.entries({ navona: ['centre'], circus: ['circovr', 'circusjog'] })
    .filter(([id]) => Array.isArray(MAP.tracks?.[id]))
    .map(([id, stops]) => {
      const pts = MAP.tracks[id].map(([la, lo]) => toMap(la, lo));
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      return { id, stops, pts, long: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) };
    });
  const trackOf = (stopId) => TRACKS.find((t) => t.stops.includes(stopId));
  const EDGE = { x0: 60, y0: 60, x1: NOL.w - 60, y1: NOL.h - 60 };
  const offSheet = (p) => p.x < 110 || p.y < 110 || p.x > NOL.w - 110 || p.y > NOL.h - 110;
  function edgePoint(p) {
    const E = EDGE;
    if (p.x >= E.x0 && p.x <= E.x1 && p.y >= E.y0 && p.y <= E.y1) return { x: p.x, y: p.y };
    const dx = p.x - PANTHEON.x, dy = p.y - PANTHEON.y;
    let t = 1;
    if (dx < 0) t = Math.min(t, (E.x0 - PANTHEON.x) / dx);
    if (dx > 0) t = Math.min(t, (E.x1 - PANTHEON.x) / dx);
    if (dy < 0) t = Math.min(t, (E.y0 - PANTHEON.y) / dy);
    if (dy > 0) t = Math.min(t, (E.y1 - PANTHEON.y) / dy);
    return { x: PANTHEON.x + dx * t, y: PANTHEON.y + dy * t };
  }
  // Two edge rings closer than 36 px: the later one in her day slides 36 px along its edge, away from the other.
  function slideEdge(m, o) {
    const E = EDGE;
    const d = [[Math.abs(m.x - E.x0), 'y'], [Math.abs(m.x - E.x1), 'y'], [Math.abs(m.y - E.y0), 'x'], [Math.abs(m.y - E.y1), 'x']].sort((a, b) => a[0] - b[0])[0][1];
    let dir = Math.sign(m[d] - o[d]) || 1;
    const lo = d === 'x' ? E.x0 : E.y0, hi = d === 'x' ? E.x1 : E.y1;
    if (m[d] + dir * 36 < lo || m[d] + dir * 36 > hi) dir = -dir;
    m[d] += dir * 36;
  }

  // Her day as marks: each place in day order, her dinner pick, and the three pizza places (shown only while
  // dinner is the current entry). A mark's `key` is its entry's data-key.
  function markList() {
    if (!plan) return [];
    const list = [];
    if (picks.length) plan.items.forEach((it) => {
      const o = placeOf(it);
      if (!o) return;
      const p = toMap(o.lat, o.lon);
      const edge = offSheet(p);
      list.push({ id: it.id, key: it.id, label: o.hud || o.title, kind: edge ? 'edge' : 'stop', ...(edge ? edgePoint(p) : p) });
    });
    const edges = list.filter((m) => m.kind === 'edge');
    edges.forEach((m, i) => { for (let n = 0; n < 6; n++) { const o = edges.slice(0, i).find((e) => Math.hypot(e.x - m.x, e.y - m.y) < 36); if (!o) break; slideEdge(m, o); } });
    if (dinner && IDEA[dinner]) list.push({ id: 'dinner', key: 'dinner', label: IDEA[dinner].title, kind: 'stop', ...toMap(IDEA[dinner].lat, IDEA[dinner].lon) });
    IDEAS.forEach((d) => list.push({ id: 'idea-' + d.id, key: 'dinner', idea: d.id, label: d.title, kind: 'idea', ...toMap(d.lat, d.lon) }));
    return list;
  }

  // The engraving: an alpha WebP (the ink colour in RGB, the engraving in the alpha), fetched and decoded off
  // the main thread. Below 1280 px only the 1125 px file loads, from 1280 px only the 2250 px one; a later
  // resize keeps what loaded. `k` is master px per bitmap px. The laptop also gets a half-size copy for far
  // views, and both widths get lamplight copies for the night, each made in its own idle task.
  const INKS = { day: 0.42, night: 0.36 };
  const INK = { day: [], night: [], dark: false, p: 0, ready: null, failed: false };
  const ATLASES = [];
  // When createImageBitmap fails (seen during quick reloads), the file goes through an <img> on an object URL, freed
  // once decoded. Never while the page is hidden or going away: WebKit then refuses the URL ("due to access control
  // checks", v9c audit), and the engraving loads again when the page is shown.
  let leaving = false;
  addEventListener('pagehide', () => { leaving = true; });
  addEventListener('pageshow', () => { leaving = false; });
  const HIDDEN = 'hidden';
  const bitmapOf = async (src, opts) => {
    try { return opts ? await createImageBitmap(src, opts) : await createImageBitmap(src); } catch { /* fall through */ }
    if (src instanceof Blob) {
      if (leaving || document.visibilityState === 'hidden') throw new Error(HIDDEN);
      const img = new Image(), u = URL.createObjectURL(src);
      img.src = u;
      try { await img.decode(); } finally { URL.revokeObjectURL(u); }
      return img;
    }
    const c = document.createElement('canvas'); c.width = opts.resizeWidth; c.height = opts.resizeHeight;
    const x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, c.width, c.height);
    return c;
  };
  async function nightOf(e) {
    performance.mark('nolli-night-start');
    const w = e.bm.width, h = e.bm.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(e.bm, 0, 0);
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = '#FFE6BF';
    x.fillRect(0, 0, w, h);
    performance.measure('nolli-night', 'nolli-night-start');
    return { bm: await bitmapOf(c), k: e.k };
  }
  // The engraving's own edges dissolve over 90 px (170 m), once, as it arrives: a far view of a wide day shows the
  // plan as a print fading into the sky, never a hard cut through the city (round 2: a day from the Gianicolo to
  // Termini did not fit the laptop's column without zooming out past the engraving's edges).
  const FEATHER = 90;
  function featherOf(bm) {
    performance.mark('nolli-feather-start');
    const w = bm.width, h = bm.height, fx = (FEATHER * w) / NOL.w / w, fy = (FEATHER * w) / NOL.w / h;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(bm, 0, 0);
    x.globalCompositeOperation = 'destination-in';
    const fade = (g, f) => { g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(f, '#000'); g.addColorStop(1 - f, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
    x.fillStyle = fade(x.createLinearGradient(0, 0, w, 0), fx); x.fillRect(0, 0, w, h);
    x.fillStyle = fade(x.createLinearGradient(0, 0, 0, h), fy); x.fillRect(0, 0, w, h);
    performance.measure('nolli-feather', 'nolli-feather-start');
    bm.close?.();
    return bitmapOf(c);
  }
  const repaint = () => ATLASES.forEach((a) => a.paint());
  function loadNolli() {
    if (INK.ready) return INK.ready;
    const url = wideMQ.matches ? NOL.files.full : NOL.files.half;
    INK.ready = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); })
      .then((b) => bitmapOf(b))
      .then(featherOf)
      .then((bm) => {
        INK.day = [{ bm, k: NOL.w / bm.width }];
        // The engraving comes in over 400 ms and the Tiber goes (at once with reduced motion).
        if (reduced || !window.gsap) { INK.p = 1; repaint(); } else gsap.to(INK, { p: 1, duration: 0.4, ease: 'power1.out', onUpdate: repaint });
        const nights = () => INK.day.forEach((e, i) => idle(() => nightOf(e).then((n) => { INK.night[i] = n; if (INK.dark && INK.night.filter(Boolean).length === INK.day.length) repaint(); }), 3000));
        if (bm.width > 1200) idle(() => bitmapOf(bm, { resizeWidth: bm.width >> 1, resizeHeight: bm.height >> 1, resizeQuality: 'high' }).then((half) => { INK.day.push({ bm: half, k: NOL.w / half.width }); nights(); }), 2000);
        else nights();
      })
      .catch((e) => {
        if (e?.message !== HIDDEN) { INK.failed = true; return; }
        // Put off while the page was hidden: the next time it is shown, the engraving loads again.
        INK.ready = null;
        const again = () => {
          if (leaving || document.visibilityState === 'hidden') return;
          document.removeEventListener('visibilitychange', again);
          removeEventListener('pageshow', again);
          loadNolli();
        };
        document.addEventListener('visibilitychange', again);
        addEventListener('pageshow', again);
        again();
      });
    return INK.ready;
  }
  // At dusk the engraving swaps to its lamplight copies (nothing is recoloured on the scroll path) and every mark
  // becomes a street lamp (styles.css, B1c), at once with the page's ink flip: no fill fade on that frame.
  function setInkDark(dark) {
    if (INK.dark === dark) return;
    INK.dark = dark;
    ATLASES.forEach((a) => a.el.classList.add('is-switching'));
    requestAnimationFrame(() => requestAnimationFrame(() => ATLASES.forEach((a) => a.el.classList.remove('is-switching'))));
    repaint();
  }

  // One map: `page` (the laptop map), `pocket` (the bar, dots only) or `sheet` (the phone's whole map).
  class Atlas {
    constructor(host, kind) {
      this.kind = kind;
      const img = kind !== 'pocket' ? ` role="img" aria-label="${esc(U.mapLabel)}" aria-describedby="map-credit"` : ' aria-hidden="true"';
      host.insertAdjacentHTML('beforeend', `<div class="atlas atlas--${kind}"${img}><canvas class="atlas-canvas"></canvas><svg class="atlas-marks" aria-hidden="true"></svg></div>`);
      this.el = host.lastElementChild;
      this.cv = $('canvas', this.el);
      this.ctx = this.cv.getContext('2d');
      this.svg = $('svg', this.el);
      this.cam = { x: NOL.w / 2, y: NOL.h / 2, s: 0.3 };
      this.goal = null;
      this.marks = [];
      this.byId = new Map();
      this.tracks = [];
      this.lapped = new Set(); // the tracks already drawn in as a lap here (once per page load)
      this.cur = null;
      this.tw = null;
      this.vw = 0; this.vh = 0; this.dpr = 1;
      this.k = kind === 'pocket' ? 0.7 : 1;
      // How far out the camera may go, as a share of the zoom at which the engraving covers the window: the laptop's
      // tall column and the phone's sheet go furthest, so a day from St Peter's to Coppedè fits them whole.
      this.coverK = { page: 0.55, sheet: 0.75, pocket: 0.85 }[kind];
      this.measure();
      if ('ResizeObserver' in window) new ResizeObserver(() => { if (this.measure()) this.settle(); }).observe(this.el);
      ATLASES.push(this);
    }
    measure() {
      const w = this.el.clientWidth, h = this.el.clientHeight, d = Math.min(2, devicePixelRatio || 1);
      if (w === this.vw && h === this.vh && d === this.dpr) return false;
      this.vw = w; this.vh = h; this.dpr = d;
      this.cv.width = Math.round(w * d); this.cv.height = Math.round(h * d);
      return true;
    }
    // The engraving fills a canvas the size of the window onto it: one drawImage per frame of a camera move.
    paint() {
      if (this.vw <= 1) return;
      const x = this.ctx, c = this.cam, d = this.dpr;
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.clearRect(0, 0, this.cv.width, this.cv.height);
      const tx = d * (this.vw / 2 - c.x * c.s), ty = d * (this.vh / 2 - c.y * c.s);
      if (INK.p > 0 && INK.day.length) {
        const night = INK.dark && INK.night.filter(Boolean).length === INK.day.length;
        const set = night ? INK.night : INK.day;
        // A far view, and every frame in flight, draws the half-size copy with the plain filter (dir-2's lowFlight,
        // on by default); the frame the camera settles on gets the full sheet and the good filter.
        const half = !!this.tw || c.s * d < 0.55;
        const e = set.find((b) => (half ? b.k > 1 : b.k === 1)) || set[0];
        x.imageSmoothingEnabled = true;
        x.imageSmoothingQuality = this.tw ? 'low' : 'high';
        x.setTransform(d * c.s * e.k, 0, 0, d * c.s * e.k, tx, ty);
        x.globalAlpha = (night ? INKS.night : INKS.day) * INK.p;
        x.drawImage(e.bm, 0, 0);
      }
      if (INK.p < 1) {
        x.setTransform(d * c.s, 0, 0, d * c.s, tx, ty);
        x.globalAlpha = 0.3 * (1 - INK.p);
        x.strokeStyle = INK.dark ? '#FFE6BF' : '#1A1830';
        x.lineWidth = 1.5 / c.s;
        x.lineJoin = 'round'; x.lineCap = 'round';
        x.beginPath();
        for (const l of RIVER) l.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
        x.stroke();
      }
      x.globalAlpha = 1;
    }
    scr(x, y, c = this.cam) { return [(x - c.x) * c.s + this.vw / 2, (y - c.y) * c.s + this.vh / 2]; }
    // The phone's sheet (fold-in, gates S2): at its whole-day zoom a ring for a place off the engraving landed on the
    // window's rim, where its name had no room, and two rings 36 engraving px apart sat 9 px apart on screen. Here
    // each ring near the window keeps 24 px inside it, and the later of two rings closer than 24 px slides 24 px
    // along the window's nearest rim, away from the other. Screen px, for this camera; a ring panned further out
    // than 24 px still steps off.
    edgeSpots() {
      const E = 24, out = new Map();
      if (this.kind !== 'sheet') return out;
      const es = this.marks.filter((m) => m.kind === 'edge' && !m.gone);
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      es.forEach((m, i) => {
        let [X, Y] = this.scr(m.x, m.y);
        if (X > -E && X < this.vw + E && Y > -E && Y < this.vh + E) { X = clamp(X, E, this.vw - E); Y = clamp(Y, E, this.vh - E); }
        for (let n = 0; n < 6; n++) {
          const o = es.slice(0, i).map((q) => out.get(q)).find((q) => Math.hypot(q[0] - X, q[1] - Y) < E);
          if (!o) break;
          if (Math.min(Y, this.vh - Y) <= Math.min(X, this.vw - X)) {
            let d = Math.sign(X - o[0]) || 1;
            if (o[0] + d * E < E || o[0] + d * E > this.vw - E) d = -d;
            X = o[0] + d * E;
          } else {
            let d = Math.sign(Y - o[1]) || 1;
            if (o[1] + d * E < E || o[1] + d * E > this.vh - E) d = -d;
            Y = o[1] + d * E;
          }
        }
        out.set(m, [X, Y]);
      });
      return out;
    }
    apply() {
      if (this.vw <= 1) return;
      this.paint();
      const k = this.k !== 1 ? ` scale(${this.k})` : '';
      const spots = this.edgeSpots();
      for (const m of this.marks) {
        if (m.gone) continue;
        const [X, Y] = spots.get(m) || this.scr(m.x, m.y);
        m.g.setAttribute('transform', `translate(${X.toFixed(1)} ${Y.toFixed(1)})${k}`);
        // A mark at or past the window's edge steps out (no half dots at the rim).
        const off = X < 4 || X > this.vw - 4 || Y < 4 || Y > this.vh - 4;
        if (off !== m.off) { m.off = off; m.g.classList.toggle('is-off', off); }
      }
      if (this.sight) this.drawSight();
      if (this.tracks.length) this.drawTracks();
    }
    // A lane in screen px, shown while its outline's long side is at least 24 px; the first time it shows in this
    // map it is drawn in as one lap (0.7 s). It is lit with its stop (past or current), hollow ahead, a lamp at night.
    drawTracks() {
      const s = this.cam.s;
      for (const t of this.tracks) {
        const show = t.long * s >= 24;
        if (show !== t.shown) {
          t.shown = show;
          t.g.classList.toggle('is-shown', show);
          // Its stop's second name line only while the lane itself can be seen (round 1: on the phone's whole-day
          // sheet "Once a running track" showed under Navona with no lane drawn).
          this.marks.forEach((m) => { if (t.stops.includes(m.id)) m.g.classList.toggle('has-track', show); });
          if (show && !this.lapped.has(t.id)) {
            this.lapped.add(t.id);
            // The lap waits for the camera to land (round 1: drawn during the flight, it was over before she could see it).
            if (!reduced && window.gsap) { gsap.set(t.paths, { strokeDashoffset: 1 }); if (this.tw) t.lapPending = true; else this.lap(t); }
          }
        }
        if (!show) continue;
        const d = 'M' + t.pts.map((q) => this.scr(q.x, q.y).map((v) => v.toFixed(1)).join(' ')).join('L') + 'Z';
        t.paths.forEach((p) => p.setAttribute('d', d));
      }
    }
    // The sight line in screen px: from 15 px outside her ring to 10 px short of the dome glyph, `p` of the way;
    // the glyph's name keeps inside the window.
    drawSight() {
      const sg = this.sight, [x1, y1] = this.scr(sg.a.x, sg.a.y), [x2, y2] = this.scr(DOME.x, DOME.y);
      const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
      const xs = x1 + ux * 15, ys = y1 + uy * 15, xt = x2 - ux * 10, yt = y2 - uy * 10;
      const xe = xs + (xt - xs) * sg.p, ye = ys + (yt - ys) * sg.p;
      sg.lines.forEach((l) => { l.setAttribute('x1', xs.toFixed(1)); l.setAttribute('y1', ys.toFixed(1)); l.setAttribute('x2', xe.toFixed(1)); l.setAttribute('y2', ye.toFixed(1)); });
      sg.end.setAttribute('transform', `translate(${x2.toFixed(1)} ${y2.toFixed(1)})`);
      const half = (sg.w || 90) / 2 + 4, lab = sg.label;
      const a = x2 - half < 8 ? 'start' : x2 + half > this.vw - 8 ? 'end' : 'middle';
      if (a !== sg.anchor) { sg.anchor = a; lab.setAttribute('text-anchor', a); lab.setAttribute('x', a === 'start' ? -8 : a === 'end' ? 8 : 0); }
      // The name sits on the far side of the glyph from the line, so the line never runs through it (round 1).
      const above = y1 > y2 + 4;
      if (above !== sg.above) { sg.above = above; lab.setAttribute('y', above ? -10 : 17); }
    }
    // autoRound off: GSAP rounds a px value to whole pixels, and on a path of length 1 that made the lap a jump at its
    // midpoint (round 2, sampled per frame) instead of a 0.7 s draw.
    lap(t) { t.lapPending = false; gsap.fromTo(t.paths, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.7, ease: 'power1.inOut', overwrite: true, autoRound: false }); }
    // On (the laptop map while the keyhole is hers, walked in once; the phone's sheet whenever the keyhole is on her
    // day, drawn complete) or off (it fades in 250 ms). Her other places step back while it shows on the laptop.
    setSight(show, animate = false) {
      if (!show) { this.clearSight(); return; }
      const a = this.byId.get('keyhole');
      if (this.sight || !a) return;
      const g = $('.sights', this.svg);
      if (window.gsap) gsap.killTweensOf(g);
      g.style.opacity = '';
      g.innerHTML = `<line class="sight-halo"/><line class="sight"/><g class="sight-end"><path class="sight-dome" d="M-7 4h14M-5.5 4a5.5 5.5 0 0 1 11 0M0 -1.5v-3"/><text class="sight-label" y="17" text-anchor="middle">${esc(U.mapSightDome)}</text></g>`;
      const sg = { a, p: animate && !reduced ? 0 : 1, lines: $$('line', g), end: $('.sight-end', g), g, anchor: 'middle' };
      sg.label = $('text', sg.end);
      try { sg.w = sg.label.getBBox().width; } catch { sg.w = 0; }
      this.sight = sg;
      const back = this.kind === 'page';
      this.drawSight();
      if (!animate || reduced || !window.gsap) { if (back) this.marks.forEach((m) => m.g.classList.toggle('is-back', m.id !== 'keyhole')); return; }
      sg.end.style.opacity = '0';
      sg.tl = gsap.timeline()
        .to(sg, { p: 1, duration: 1.1, ease: 'power2.inOut', onUpdate: () => { if (this.sight === sg) this.drawSight(); } }, 0.55)
        .to(sg.end, { opacity: 1, duration: 0.3, ease: 'power1.out' }, 1.5)
        .call(() => { if (this.sight === sg && back) this.marks.forEach((m) => m.g.classList.toggle('is-back', m.id !== 'keyhole')); }, null, 1.5);
    }
    clearSight() {
      const sg = this.sight;
      if (!sg) return;
      this.sight = null;
      sg.tl?.kill();
      this.marks.forEach((m) => m.g.classList.remove('is-back'));
      if (reduced || !window.gsap) { sg.g.innerHTML = ''; return; }
      gsap.to(sg.g, { opacity: 0, duration: 0.25, ease: 'power1.out', onComplete: () => { if (!this.sight) { sg.g.innerHTML = ''; sg.g.style.opacity = ''; } } });
    }
    setMarks(list) {
      this.tw?.kill(); this.tw = null;
      this.sight?.tl?.kill();
      this.sight = null;
      const onDay = new Set(list.map((m) => m.id));
      this.tracks = this.kind === 'pocket' ? [] : TRACKS.filter((t) => t.stops.some((id) => onDay.has(id)));
      this.svg.innerHTML = `<g class="tracks">${this.tracks.map((t) => `<g class="track" data-track="${t.id}"><path class="track-lane" pathLength="1"/><path class="track-mid" pathLength="1"/></g>`).join('')}</g><g class="sights"></g>` + list.map((m) => `<g class="mk${m.kind === 'stop' ? '' : ` is-${m.kind}`}" data-id="${esc(m.id)}">${m.id === 'cannon' ? '<circle class="boom" r="8"/>' : ''}<circle class="mk-hit" r="22"/><circle class="mk-halo"/><circle class="mk-glow"/><path class="mk-ring" d="M0 -10A10 10 0 1 1 0 10A10 10 0 1 1 0 -10" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" transform="rotate(-100)"/><circle class="mk-dot"/><text class="mk-label" dominant-baseline="central">${esc(m.label)}</text>${trackOf(m.id) && this.kind !== 'pocket' ? `<text class="mk-sub" dominant-baseline="central">${esc(U.mapTrack[trackOf(m.id).id])}</text>` : ''}</g>`).join('');
      const gs = $$(':scope > g.mk', this.svg);
      this.marks = list.map((m, i) => ({ ...m, g: gs[i], dot: $('.mk-dot', gs[i]), halo: $('.mk-halo', gs[i]), glow: $('.mk-glow', gs[i]), ring: $('.mk-ring', gs[i]), text: $('.mk-label', gs[i]), sub: $('.mk-sub', gs[i]), state: '', gone: false }));
      this.tracks.forEach((t) => { t.g = $(`.track[data-track="${t.id}"]`, this.svg); t.paths = $$('path', t.g); t.shown = false; });
      this.byId = new Map(this.marks.map((m) => [m.id, m]));
      this.cur = null;
    }
    // States follow her day: the places behind the current entry lit, the current one ringed and named in the
    // display face, the ones still to come hollow. While dinner is current the three pizza places show and her
    // places step back.
    focus(el, { jump = false, camera = true } = {}) {
      const items = $$('#day .plan-item');
      const ci = el ? items.indexOf(el) : -1;
      const ord = new Map(items.map((li, i) => [li.dataset.key, i]));
      const din = !!el && el.dataset.key === 'dinner' && this.kind !== 'pocket';
      const curId = el && el.dataset.dot ? el.dataset.dot : null;
      for (const m of this.marks) {
        const i = ord.has(m.key) ? ord.get(m.key) : -1;
        const idea = m.kind === 'idea';
        const gone = idea ? !din || m.idea === dinner : false;
        const state = idea ? 'idea' : m.id === curId ? 'current' : el && i >= 0 && i < ci ? 'past' : 'ahead';
        const dim = din && !idea && state !== 'current';
        if (state !== m.state || gone !== m.gone) {
          m.g.classList.toggle('is-current', state === 'current');
          m.g.classList.toggle('is-past', state === 'past');
          m.g.classList.toggle('is-ahead', state === 'ahead');
          m.g.classList.toggle('is-gone', gone);
          const r = { current: 5.5, past: 3.5, ahead: 4, idea: 4 }[state] + (m.kind === 'edge' && state !== 'current' ? 1 : 0);
          m.dot.setAttribute('r', r);
          m.halo.setAttribute('r', state === 'current' ? 10 : r + 2.5);
          m.glow.setAttribute('r', r * 2); // the lamp's glow after dark (B1c)
          if (state === 'current' && m.state !== 'current') {
            this.svg.append(m.g); // paints on top
            if (reduced || !window.gsap) m.ring.style.strokeDashoffset = '0';
            else gsap.fromTo(m.ring, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.5, ease: 'power2.inOut', overwrite: true, autoRound: false }); // drawn, not snapped at its midpoint (B2 round 2)
          } else if (state !== 'current' && m.state === 'current') {
            if (window.gsap) gsap.killTweensOf(m.ring);
            m.ring.style.strokeDashoffset = '1';
          }
          m.state = state; m.gone = gone;
        }
        m.g.classList.toggle('is-dim', dim);
      }
      this.cur = curId;
      for (const t of this.tracks) {
        const st = this.marks.filter((m) => t.stops.includes(m.id)).map((m) => m.state);
        t.g.classList.toggle('is-lit', st.includes('current') || st.includes('past'));
        t.g.classList.toggle('is-dim', din);
      }
      const sight = this.kind === 'page' ? curId === 'keyhole' && sightOK() : this.kind === 'sheet' && sightOK();
      if (!sight) this.clearSight();
      if (!camera) { this.name(); if (sight) this.setSight(true, false); return; }
      this.goal = this.target(el, din, curId && this.byId.get(curId), ci, ord);
      this.goTo(this.goal, jump ? 0 : this.kind === 'pocket' ? 0.55 : sight && this.kind === 'page' ? 1.0 : 0.9);
      if (sight) this.setSight(true, !jump && this.kind === 'page');
    }
    // The camera for an entry. Laptop: a place close up, the three pizza places (and her pick) for dinner, else
    // her whole day.
    // Pocket: the current place (or the last one her day has passed) about 1,500 m across. Sheet: her whole day.
    target(el, din, curM, ci, ord) {
      const shown = this.marks.filter((m) => !m.gone);
      const stops = shown.filter((m) => m.kind !== 'idea');
      if (this.kind === 'pocket') {
        let m = curM;
        if (!m) m = [...stops].filter((s) => (ord.get(s.key) ?? -1) < ci).pop() || stops[0];
        const s = this.vw / (1500 / NOL.mPerPx);
        return m ? { x: m.x, y: m.y, s } : { x: PANTHEON.x, y: PANTHEON.y, s };
      }
      // The phone's sheet: her whole day, and the dome too when the sight line is drawn.
      if (this.kind === 'sheet') return this.frame(sightOK() ? [...shown, DOME] : shown, 40, 0.9);
      // The keyhole on the laptop: the Aventine and the dome together, so the line has room to walk.
      if (curM && curM.id === 'keyhole' && sightOK()) return this.frame([curM, DOME], 110, 0.8);
      if (din) return this.frame(shown.filter((m) => m.kind === 'idea' || m.id === 'dinner'), 110, 0.8);
      if (curM) return { x: curM.x, y: curM.y, s: NOL.mPerPx / 2.5 };
      return this.frame(stops, 90, 0.75);
    }
    frame(ms, pad, maxS) {
      if (!ms.length) return { x: PANTHEON.x, y: PANTHEON.y + 300, s: 0 };
      const xs = ms.map((m) => m.x), ys = ms.map((m) => m.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const s = Math.min(maxS, (this.vw - 2 * pad) / Math.max(1, x1 - x0), (this.vh - 2 * pad) / Math.max(1, y1 - y0));
      return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, s };
    }
    // The zoom floor: the plan never shrinks to a stamp (coverK). On the phone's sheet a window taller than 3:4 counts
    // as 3:4, so on a tall phone the floor follows the sheet's width and her whole day fits across it, as on a 390 x 664
    // phone (v9c P1: at 390 x 844 the floor came from the height, and St Peter's, the aqueducts, Coppedè or the cannon
    // fell 13 to 59 px outside the window, so neither ring nor name showed).
    minS() { return Math.max(this.vw / NOL.w, (this.kind === 'sheet' ? Math.min(this.vh, (this.vw * 4) / 3) : this.vh) / NOL.h) * this.coverK; }
    // The window runs a little past the engraving's dissolving edge.
    cover(c) {
      const s = Math.max(c.s, this.minS());
      const hx = this.vw / 2 / s, hy = this.vh / 2 / s, mx = hx * 0.4, my = hy * 0.4;
      const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
      return { s, x: clamp(c.x, hx - mx, NOL.w - hx + mx), y: clamp(c.y, hy - my, NOL.h - hy + my) };
    }
    // A long move lifts off and sets down: the zoom dips mid-flight in proportion to the distance, so the old
    // place and the new one are briefly on screen together. Names step back at take-off and find their places
    // when the camera lands. Reduced motion: the camera jumps.
    goTo(to, dur) {
      if (this.vw <= 1) return;
      this.tw?.kill(); this.tw = null;
      to = this.cover(to);
      if (reduced || !dur || !window.gsap) { Object.assign(this.cam, to); this.el.classList.remove('is-flying'); this.apply(); this.name(); this.tracks.forEach((t) => { if (t.lapPending && window.gsap) this.lap(t); }); return; }
      const from = { ...this.cam }, st = { p: 0 };
      const dist = Math.hypot(to.x - from.x, to.y - from.y) * from.s;
      const dip = Math.min(0.4, Math.max(0, (dist - this.vw * 0.5) / (this.vw * 3)));
      const minS = this.minS();
      this.el.classList.add('is-flying');
      this.tw = gsap.to(st, { p: 1, duration: dur, ease: 'power3.inOut', onUpdate: () => {
        const p = st.p;
        this.cam.x = from.x + (to.x - from.x) * p;
        this.cam.y = from.y + (to.y - from.y) * p;
        this.cam.s = Math.max(minS, (from.s + (to.s - from.s) * p) * (1 - dip * Math.sin(Math.PI * p)));
        this.apply();
      }, onComplete: () => { this.tw = null; this.paint(); this.name(); this.el.classList.remove('is-flying'); this.tracks.forEach((t) => { if (t.lapPending) this.lap(t); }); } });
    }
    // Noon (b3.6): one ring leaves the cannon's mark: on the laptop map out to 230 px over 1.6 s, in the pocket to 30 px
    // over 0.9 s (screen px; the pocket's marks are drawn at 0.7). Reduced motion: a still ring, r 18 at 50 %.
    boom() {
      const m = this.byId.get('cannon'), b = m && !m.gone && this.kind !== 'sheet' ? $('.boom', m.g) : null;
      if (!b) return;
      const k = this.k;
      if (reduced || !window.gsap) { b.setAttribute('r', 18 / k); b.style.opacity = '0.5'; return; }
      const pocket = this.kind === 'pocket';
      gsap.fromTo(b, { attr: { r: 8 / k }, opacity: 0.75 }, { attr: { r: (pocket ? 30 : 230) / k }, opacity: 0, duration: pocket ? 0.9 : 1.6, ease: 'power1.out', overwrite: true });
    }
    clearBoom() {
      const m = this.byId.get('cannon'), b = m ? $('.boom', m.g) : null;
      if (!b) return;
      if (window.gsap) gsap.killTweensOf(b);
      b.style.opacity = '0';
    }
    // After a resize: the same goal, no flight.
    settle() { if (this.goal) this.goTo(this.goal, 0); else this.apply(); }
    // Names, placed when the camera lands (screen px): the current place first, in the display face, 6 px clear
    // of its ring; then the rest, crowded marks first, each at the first of six spots that keeps clear of every
    // name and dot and stays inside the window. A name that fits nowhere stays hidden (it shows under the pointer).
    name() {
      if (this.kind === 'pocket' || this.vw <= 1) return;
      const spots = this.edgeSpots();
      const pts = this.marks.filter((m) => !m.gone).map((m) => { const [x, y] = spots.get(m) || this.scr(m.x, m.y); return { m, x, y }; });
      const inView = (p) => p.x > 8 && p.x < this.vw - 8 && p.y > 8 && p.y < this.vh - 8;
      const M = 8;
      const fits = (b) => b[0] >= M && b[2] <= this.vw - M && b[1] >= M && b[3] <= this.vh - M;
      const hit = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
      const dots = pts.map((p) => { const r = p.m.state === 'current' ? 12 : +p.m.dot.getAttribute('r') + 2; return [p.x - r, p.y - r, p.x + r, p.y + r]; });
      const placed = [];
      const box = (p, w, h, [dx, dy, a]) => { const x0 = a === 'start' ? p.x + dx : a === 'end' ? p.x + dx - w : p.x + dx - w / 2; return [x0 - 1, p.y + dy - h / 2, x0 + w + 1, p.y + dy + h / 2]; };
      const clear = (p, b) => !placed.some((q) => hit(b, q)) && !dots.some((q, j) => pts[j] !== p && hit(b, q));
      // A track stop's name has a second line ("Once a running track"), shown while it is current or hovered: the
      // pair is placed as one box, the name above, the line under it.
      const put = (p, c) => {
        const sub = p.m.sub, two = sub && p.m.state === 'current' && p.m.g.classList.contains('has-track');
        p.m.text.setAttribute('x', c[0]); p.m.text.setAttribute('y', two ? c[1] - 8 : c[1]); p.m.text.setAttribute('text-anchor', c[2]);
        if (sub) { sub.setAttribute('x', c[0]); sub.setAttribute('y', two ? c[1] + 9 : c[1] + 14); sub.setAttribute('text-anchor', c[2]); }
      };
      // On a crowded day the current name may find no clear spot near its ring: it takes the spot that covers
      // the fewest dots, and those dots step back under it (is-under) until the current entry changes.
      pts.forEach((p) => p.m.g.classList.remove('is-under'));
      const cur = pts.find((p) => p.m.state === 'current');
      if (cur) {
        const { w, h } = markSize(cur.m);
        const cands = [];
        for (const d of [17, 30]) cands.push([d, 0, 'start'], [-d, 0, 'end'], [0, -(d + 8), 'middle'], [0, d + 8, 'middle'], [d - 4, -(d + 2), 'start'], [-(d - 4), d + 2, 'end'], [d - 4, d + 2, 'start'], [-(d - 4), -(d + 2), 'end']);
        let c = cands.find((k) => { const b = box(cur, w, h, k); return fits(b) && clear(cur, b); });
        if (!c) {
          const under = (k) => { const b = box(cur, w, h, k); return pts.filter((q, j) => q !== cur && hit(b, dots[j])); };
          c = cands.filter((k) => fits(box(cur, w, h, k))).sort((a, b) => under(a).length - under(b).length)[0] || cands[0];
          under(c).forEach((q) => { q.m.g.classList.add('is-under'); q.m.g.classList.remove('is-named'); });
        }
        put(cur, c);
        placed.push(box(cur, w, h, c));
      }
      const crowd = (p) => pts.filter((q) => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 90).length;
      // On the sheet the rings for places off the engraving are named first: the ring alone does not say which place
      // lies that way (fold-in, gates S2; Felix was shown "a ring with the name at the map's edge").
      const first = (p) => (this.kind === 'sheet' && p.m.kind === 'edge' ? 1000 : 0) + crowd(p);
      pts.filter((p) => p !== cur && !p.m.g.classList.contains('is-under')).sort((a, b) => first(b) - first(a)).forEach((p) => {
        const { w, h } = labelSize(p.m.text), d = +p.m.dot.getAttribute('r') + 5;
        const cands = [[d, 0, 'start'], [-d, 0, 'end'], [0, -(d + 5), 'middle'], [0, d + 5, 'middle'], [d - 2, -(d + 4), 'start'], [-(d - 2), d + 4, 'end']];
        // A ring off the engraving on the sheet also tries the other two corners, and a step further out.
        if (this.kind === 'sheet' && p.m.kind === 'edge') for (const e of [d, d + 12]) cands.push([-(e - 2), -(e + 4), 'end'], [e - 2, e + 4, 'start'], ...(e > d ? [[e, 0, 'start'], [-e, 0, 'end'], [0, -(e + 5), 'middle'], [0, e + 5, 'middle']] : []));
        const c = inView(p) ? cands.find((k) => { const b = box(p, w, h, k); return fits(b) && clear(p, b); }) : null;
        p.m.g.classList.toggle('is-named', !!c);
        p.m.spot = c || cands.find((k) => fits(box(p, w, h, k))) || cands[0];
        put(p, p.m.spot);
        if (c) placed.push(box(p, w, h, c));
      });
    }
  }
  // A name's box in its current face, measured once per text and face.
  const LABEL_W = new Map();
  // The current name's box, with its track line under it when it has one.
  function markSize(m) {
    const a = labelSize(m.text);
    if (!m.sub || !m.g.classList.contains('has-track')) return a;
    const b = labelSize(m.sub);
    return { w: Math.max(a.w, b.w), h: a.h + 17 };
  }
  function labelSize(t) {
    const key = `${t.closest('.is-current') ? 'b' : 's'}|${t.textContent}`;
    if (!LABEL_W.has(key)) { const b = t.getBBox(); LABEL_W.set(key, { w: b.width || t.textContent.length * 7, h: b.height || 16 }); }
    return LABEL_W.get(key);
  }
  if (document.fonts) document.fonts.ready.then(() => { LABEL_W.clear(); ATLASES.forEach((a) => a.name()); });

  let pageAtlas = null, pocketAtlas = null, sheetAtlas = null;
  let mapKey;            // the entry the map follows (undefined: none yet)
  let gliding = false;   // a programmatic glide: the map moves once, where it lands
  const keyEl = (key) => (key ? $(`#day .plan-item[data-key="${CSS.escape(key)}"]`) : null);
  // The laptop map and the pocket are made with her day, each only at its own width.
  function ensureAtlases() {
    if (!dayShown) return;
    if (wideMQ.matches && !pageAtlas) {
      pageAtlas = new Atlas(slot('day-map'), 'page');
      slot('day-map').insertAdjacentHTML('beforeend', `<p class="map-note">${esc(U.mapNote)}</p>`);
      bindPageMap();
      syncMap(pageAtlas);
    }
    if (!wideMQ.matches && !pocketAtlas) {
      pocketAtlas = new Atlas(slot('hud-map'), 'pocket');
      syncMap(pocketAtlas);
    }
  }
  function syncMap(only = null) {
    const list = markList();
    (only ? [only] : ATLASES).forEach((a) => {
      a.setMarks(list);
      a.focus(keyEl(mapKey), { jump: true });
    });
  }
  function mapFollow(el) {
    const key = el ? el.dataset.key : null;
    if (gliding || key === mapKey) return;
    mapKey = key;
    ATLASES.forEach((a) => { if (a.kind !== 'sheet') a.focus(el); });
  }
  // A glide to an entry (C's goToEntry): the map moves once, when the glide (and the sky's smoothing after it)
  // has landed; then the entry lights up. A tall entry (a place, dinner) lands just under the bar, where its title
  // is in view and it is still the current entry; a short one lands at the middle of the screen, which makes it
  // current (round 1: on a phone the middle left a place's title below the fold, so its flash went unseen).
  function goToEntry(key, landed = flash) {
    const el = keyEl(key);
    if (!el) return;
    const gap = scrollGap();
    const y = el.getBoundingClientRect().top + scrollY - (el.offsetHeight > innerHeight * 0.5 - gap ? gap : innerHeight * 0.5 - 2);
    scrollToY(y, Math.min(1.1, 0.45 + Math.abs(y - scrollY) / 4000), () => landed(el));
  }
  // The echo (b3.10): a board row's glide lands on its entry, whose time chip flips once more to the same time and
  // whose title lights up for 150 ms, so the row and the entry read as the same thing. Reduced motion: the light only.
  function echo(el) {
    flash(el, 150);
    if (reduced || !window.gsap) return;
    const tl = gsap.timeline();
    $$('.chip .flap', el).map(flapOf).forEach((f, k) => {
      const ch = f.cur, at = k * 0.03;
      if (!ch) return;
      addFlip(tl, f, '', at, 0.05); // v9c C1i: one blank leaf, never a random glyph
      addFlip(tl, f, ch, at + 0.1, 0.05);
    });
  }
  // Laptop: a mark names itself under the pointer, and a click glides to its entry.
  function bindPageMap() {
    const svg = pageAtlas.svg;
    svg.addEventListener('pointerover', (e) => { const g = e.target.closest('.mk'); if (g && e.pointerType === 'mouse') g.classList.add('is-hover'); });
    svg.addEventListener('pointerout', (e) => { const g = e.target.closest('.mk'); if (g) g.classList.remove('is-hover'); });
    svg.addEventListener('click', (e) => { const g = e.target.closest('.mk'); if (g) goToEntry(pageAtlas.byId.get(g.dataset.id)?.key); });
  }

  // The phone's whole map: the pocket opens it as a sheet framed on her whole day. Dragging the map pans it;
  // a tap on a mark makes it current, and 420 ms later the sheet closes and the page glides to its entry.
  function openMapSheet() {
    const dlg = slot('mapsheet');
    if (dlg.open) return;
    if (!sheetAtlas) {
      dlg.innerHTML = `<div class="sheet-grab" aria-hidden="true"></div>
        <div class="sheet-head mapsheet-head">
          <div class="mapsheet-titles"><h2 id="ms-h" tabindex="-1">${esc(U.mapTitle)}</h2><p class="mapsheet-note">${esc(U.mapNote)}</p></div>
          ${hap(`<button type="button" class="peek-x" data-action="map-close" aria-label="${esc(PK.close)}">${ICON.close}</button>`, 'x')}
        </div>
        <div class="mapsheet-map"></div>`;
      sheetAtlas = new Atlas($('.mapsheet-map', dlg), 'sheet');
      bindSheetMap();
    }
    sheetAtlas.setMarks(markList());
    root.classList.add('is-locked');
    dlg.showModal();
    $('#ms-h', dlg).focus({ preventScroll: true });
    sheetAtlas.measure();
    sheetAtlas.focus(keyEl(mapKey), { jump: true });
    sheetIn(dlg);
    loadNolli();
  }
  function closeMapSheet(fromY = 0, byKey = false) {
    const dlg = slot('mapsheet');
    if (!dlg.open || dlg.classList.contains('is-closing')) return;
    sheetByKey = byKey;
    sheetOut(dlg, fromY, () => dlg.close());
  }
  function bindSheetMap() {
    const a = sheetAtlas, el = a.el;
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, cx: a.cam.x, cy: a.cam.y, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 6) return;
      drag.moved = true;
      Object.assign(a.cam, a.cover({ x: drag.cx - dx / a.cam.s, y: drag.cy - dy / a.cam.s, s: a.cam.s }));
      a.apply();
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const was = drag;
      drag = null;
      if (was.moved) { a.name(); return; }
      if (e.type !== 'pointerup') return;
      const g = document.elementFromPoint(e.clientX, e.clientY)?.closest('.mk');
      const m = g && a.byId.get(g.dataset.id);
      if (!m) return;
      const key = m.key;
      a.focus(keyEl(key), { camera: false });
      setTimeout(() => { closeMapSheet(); setTimeout(() => goToEntry(key), reduced ? 0 : 200); }, reduced ? 0 : 420);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
  function onMapSheetClick(e) {
    const dlg = slot('mapsheet');
    if (e.target === dlg || e.target.closest('[data-action="map-close"]')) closeMapSheet(0, e.detail === 0);
  }
  function onMapSheetClosed() {
    const dlg = slot('mapsheet');
    dlg.getAnimations().forEach((x) => x.cancel());
    dlg.classList.remove('is-closing');
    dlg.style.transform = '';
    root.classList.remove('is-locked');
    refocus(slot('hud-map'));
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
  const SKY_NIGHT = SKY[SKY.length - 1].t; // 21:00, night: where the page's end scrolls to (v9c C1a)
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
    ATLASES.forEach((a) => { if (a.kind !== 'sheet') a.el.style.setProperty('--sky', hex); });
    stageHost.style.setProperty('--sky', hex);
    const Y = relLum(rgb);
    const dark = contrast(Y, Y_LAMP) > contrast(Y, Y_INK); // flip at the luminance crossover
    if (dark !== isDark) { isDark = dark; root.toggleAttribute('data-dark', dark); setInkDark(dark); syncSkyVar(); return; }
    if (!varHex) { syncSkyVar(); return; }
    clearTimeout(varTimer);
    varTimer = setTimeout(syncSkyVar, 200);
  }

  // HUD clock: four flaps, flipped only when a digit changes.
  const hudClock = $('.hud-clock');
  hudClock.innerHTML = FLAP + FLAP + '<span class="colon">:</span>' + FLAP + FLAP;
  const clockFlaps = $$('.flap', hudClock).map(flapOf);
  let clockText = '';
  // `done` runs once the flaps have landed (about 0.26 s after a flip, at once without one). Returns false
  // when the clock already read that time.
  function setClock(hhmm, animate, done) {
    if (hhmm === clockText) return false;
    clockText = hhmm;
    $('[data-slot="hud-time"]').textContent = hhmm + ', ';
    let any = false;
    [...hhmm.replace(':', '')].forEach((d, i) => {
      const f = clockFlaps[i];
      if (f.tl) { f.tl.progress(1).kill(); f.tl = null; }
      if (f.cur === d) return;
      if (!animate || !f.cur) { setFlap(f, d); return; }
      any = true;
      f.tl = gsap.timeline({ onComplete: () => { f.tl = null; } });
      addFlip(f.tl, f, d, i * 0.03, 0.07);
    });
    if (done) { if (any) gsap.delayedCall(0.26, done); else done(); }
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* The board hands over to the bar (design-v9 amendments b3.2, dir-3)  */
  /* ------------------------------------------------------------------ */

  // When the board's first row passes under the bar, its time flies up into the bar's clock and the bar comes
  // on; above that point the bar steps away again (no flight back). The bar then reads the first departure
  // until her first entry takes over. A tap on the clock takes her back to the board.
  let dockY = Infinity, docked = false, dockTl = null;
  const hudH = () => $('.hud-inner', hud).getBoundingClientRect().height + (parseFloat(getComputedStyle(hud).paddingTop) || 0);
  let firstMemo = { plan: null, v: null };
  // The board's first row as it will read once the replay is done (mid-replay the row may show another time).
  function firstDeparture() {
    if (firstMemo.plan !== plan) {
      const r = plan ? depRows(plan)[0] : null;
      const li = r ? keyEl(r.key) : null;
      firstMemo = { plan, v: { time: r ? r.time : START, place: li ? li.dataset.hudTitle : r ? r.label || '' : '' } };
    }
    return firstMemo.v;
  }
  function syncDock(fly = true) {
    const on = dayShown && scrollY >= dockY;
    if (on === docked) return;
    docked = on;
    if (on) dockIn(fly); else dockOut();
  }
  function dockIn(fly) {
    const f = firstDeparture();
    setClock(f.time, false);
    hudPlaceText = f.place;
    hudPlace.textContent = f.place;
    const row = DEP.board && DEP.board.rows[0];
    const src = row && $('.c--time .cells', row.el);
    const a = src && src.getBoundingClientRect();
    // Only from a row she can see (a restored scroll position or a fast fling just turns the bar on).
    if (reduced || !fly || !a || a.bottom < -40 || a.top > innerHeight) { hud.setAttribute('data-on', ''); render(lastY); return; }
    // The bar fades in where it is (no slide), so the time has a fixed place to land.
    hud.style.transition = 'none';
    hud.setAttribute('data-on', '');
    const b = clockFlaps[0].ltEl.parentElement.getBoundingClientRect();
    const clone = src.cloneNode(true);
    clone.className = 'dock';
    clone.setAttribute('aria-hidden', 'true');
    Object.assign(clone.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
    clone.style.setProperty('--fw', getComputedStyle(src.firstElementChild).width);
    // The final text on every cell, every leaf at rest.
    [...clone.children].forEach((fl, k) => { const ch = cellChar(f.time, k); $$('b', fl).forEach((x) => { x.textContent = ch; }); $$(':scope > span', fl).forEach((x) => { x.style.transform = ''; }); });
    document.body.appendChild(clone);
    const s = b.height / a.height;
    dockTl?.progress(1).kill();
    const tl = gsap.timeline({ onComplete: () => { clone.remove(); hud.style.transition = ''; if (dockTl === tl) dockTl = null; } });
    tl.call(() => clone.remove(), null, 0.5);
    dockTl = tl;
    tl.fromTo(hud, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: 'power1.out', clearProps: 'opacity' }, 0);
    tl.set([hudClock, hudPlace], { opacity: 0 }, 0);
    tl.to(clone, { x: b.left - a.left, y: b.top - a.top, scale: s, duration: 0.5, ease: 'power3.out' }, 0);
    // The board writes the colon on a flap; the bar's colon is a narrow glyph. The middle cell narrows on the
    // way, so the five cells land on the bar's four digits.
    const mid = clone.children[2];
    if (mid) { mid.classList.add('to-colon'); tl.to(mid, { width: 6 / s, duration: 0.5, ease: 'power3.out' }, 0); }
    tl.to(clone, { opacity: 0, duration: 0.08, ease: 'none' }, 0.42);
    tl.to(hudClock, { opacity: 1, duration: 0.12, ease: 'none', clearProps: 'opacity' }, 0.42);
    tl.fromTo(hudPlace, { opacity: 0, x: 6 }, { opacity: 1, x: 0, duration: 0.26, ease: 'power2.out', clearProps: 'opacity,transform' }, 0.46);
    // The row it left from flashes once, so the eye knows where it came from.
    flashRow(row, 0.16);
    render(lastY);
  }
  function dockOut() {
    dockTl?.progress(1).kill();
    dockTl = null;
    hud.removeAttribute('data-on');
  }
  function flashRow(row, s) {
    if (!row) return;
    row.el.classList.add('is-flash');
    clearTimeout(row.flashT);
    row.flashT = setTimeout(() => row.el.classList.remove('is-flash'), s * 1000);
  }
  // The clock: back to the board, where the row of the entry she was on flashes; focus goes to the board.
  function backToBoard(e) {
    if (!DEP.board) return;
    const key = itemAt(lastY)?.dataset.key;
    const y = DEP.board.host.getBoundingClientRect().top + scrollY - scrollGap();
    // The board's title takes focus, marked as from the keyboard only when the clock was pressed from it (fold-in,
    // merge.md's open note: after a finger it matched :focus-visible).
    const byKey = e?.detail === 0;
    scrollToY(y, 0.7, () => {
      flashRow(DEP.board.rows.find((r) => r.data && r.data.key === key), 0.6);
      slot('dep-title').focus({ preventScroll: true, focusVisible: byKey });
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

  let maxY = Infinity;
  function measure() {
    itemEls = $$('.plan-item');
    maxY = ScrollTrigger.maxScroll(window);
    const mid = innerHeight / 2;
    const top = (el) => el.getBoundingClientRect().top + scrollY;
    anchors = [{ y: 0, t: START_MIN }];
    itemEls.forEach((el) => anchors.push({ y: Math.max(top(el) - mid, anchors[anchors.length - 1].y + 1), t: +el.dataset.min, el }));
    // v9c C1a: the day ends on dinner, and the page past it (More ideas, See everything, Send) scrolls on into the
    // night, so the page end is dark and every mark a lamp whatever time dinner is. The anchor keeps dinner's entry
    // as its own, so the entry under it stays dinner.
    const last = anchors[anchors.length - 1];
    if (dayShown && last.el && last.t < SKY_NIGHT) anchors.push({ y: Math.max(maxY, last.y + 1), t: SKY_NIGHT, el: last.el });
    sectionMarks = $$('main > section')
      .filter((sec) => sec.offsetParent !== null)
      .map((sec) => ({ y: top(sec) - mid, id: sec.id, name: sec.dataset.hud || '' }));
    // The board's first row under the bar: the handover point (b3.2).
    const row0 = dayShown && DEP.board && DEP.board.rows[0];
    dockY = row0 ? top(row0.el) - hudH() : Infinity;
    // v9d D3 (?sky=2): the sky layer is as tall as the page (the in-flow content; the layer itself is out of flow).
    if (SKY2) skyBg.style.height = `${document.body.offsetHeight}px`;
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
  let hudPlaceText = '';
  const minToHHMM = (m) => P.hhmm(m);

  // The entry at a page position. At the very bottom the last entry is current, however little page there is
  // below it, so Dinner and the night map always come (dir-2's last-entry fix, b2.5).
  function itemAt(y) {
    let idx = -1;
    for (let i = 1; i < anchors.length; i++) if (y >= anchors[i].y) idx = i - 1;
    const el = idx >= 0 ? anchors[idx + 1].el : null;
    return dayShown && itemEls.length && y > 0 && y >= maxY - 2 ? itemEls[itemEls.length - 1] : el;
  }
  function render(y) {
    lastY = y;
    const el = itemAt(y);
    const end = !!el && el === itemEls[itemEls.length - 1] && y >= maxY - 2;
    // At the page end it is night (v9c C1a); the clock still reads the entry (dinner's time).
    applySky(end ? SKY_NIGHT : reduced ? (el ? +el.dataset.min : START_MIN) : timeAt(y));
    // v9d D3 (?sky=2): at the page end the sky is still (night), so the root background (what the rubber band past
    // the end shows) follows at once instead of 200 ms later. One restyle per arrival, not one per frame.
    if (SKY2 && end) syncSkyVar();

    let sec = null;
    for (const s of sectionMarks) if (y >= s.y) sec = s;
    const inDay = sec && sec.id === 'day' && el;
    // Docked with no entry current yet: the first departure, the time that flew up from the board.
    const first = docked && !el ? firstDeparture() : null;
    // Noon (b3.6): the cannon entry becoming current while the bar is on, by her scroll or where a glide lands
    // (never a glide passing through), once per arrival. It fires when the clock's flaps land on 12:00.
    const key = el ? el.dataset.key : null;
    if (key !== noonKey) { if (noonKey === 'cannon') ATLASES.forEach((a) => a.clearBoom()); noonKey = key; noonDone = false; }
    const fire = key === 'cannon' && !noonDone && !gliding && hud.hasAttribute('data-on');
    if (fire) noonDone = true;
    const flipped = setClock(first ? first.time : el ? minToHHMM(+el.dataset.min) : START, !reduced && hud.hasAttribute('data-on'), fire ? noon : null);
    if (fire && !flipped) noon();
    const place = first ? first.place : inDay ? el.dataset.hudTitle : sec ? sec.name : '';
    if (place !== hudPlaceText) { hudPlaceText = place; hudPlace.textContent = place; }

    // The map follows the entry she is on (the laptop map and the pocket).
    mapFollow(el);
  }

  // Noon at the cannon (b3.6, dir-3): the clock has landed on 12:00. The entry's photo kicks back a little, the
  // clock jolts, and one ring leaves the Gianicolo on the map. No haptic (nobody tapped). Reduced motion: no kick
  // or jolt, a still ring while the cannon is current.
  let noonKey = null, noonDone = false;
  function noon() {
    if (noonKey !== 'cannon') return; // she scrolled on before the flaps landed
    ATLASES.forEach((a) => a.boom());
    if (reduced || !window.gsap) return;
    const ph = $('.stop[data-key="cannon"] .stop-photos', slot('day-body'));
    if (ph) gsap.fromTo(ph, { x: -5, rotation: -0.6 }, { x: 0, rotation: 0, duration: 0.7, ease: 'elastic.out(1, 0.42)', clearProps: 'transform', overwrite: true });
    gsap.fromTo(hudClock, { x: -3 }, { x: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)', clearProps: 'transform', overwrite: true });
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
    // The Sunday row turns to TODAY at midnight and to DONE at 18:00, with one quiet flip (b3.8).
    const sun = DEP.board && DEP.board.sun;
    if (sun && sun.data && !DEP.replay) { const d = sundayRow(DEP.sunEgg); if (d.time !== sun.data.time || d.to !== sun.data.to) { fitDepBoard(); flipRowNow(DEP.board.sun, d); } } // DONE may need a wider TO (v9c C1g)
    const items = $$('.plan-item');
    let nowEl = null;
    jumpEl = null;
    if (today && items.length) {
      items.forEach((el, i) => { const end = i < items.length - 1 ? +items[i + 1].dataset.min : 24 * 60; if (r.min >= +el.dataset.min && r.min < end) nowEl = el; });
      jumpEl = nowEl || (r.min < +items[0].dataset.min ? items[0] : null);
    }
    items.forEach((el) => el.classList.toggle('is-now', el === nowEl));
    nowBtns.forEach((b) => hideCtl(b, !jumpEl));
    hud.toggleAttribute('data-today', !!jumpEl);
  }
  function jumpToNow(e) {
    if (!jumpEl) return;
    jumpEl.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'center' });
    const h = $('h4', jumpEl);
    // The entry's title takes focus; its ring shows only when Now was pressed from the keyboard (v9c C3b: a finger
    // on Now's cover would otherwise leave a ring around the title).
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true, focusVisible: e?.detail === 0 }); }
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
  // Send needs something to send: a pick, her dinner pick or time, or a line of text.
  function syncSend() { slot('send').disabled = !picks.length && !dinner && !dinnerAt && !freeText.trim(); }

  function update() {
    plan = P.build(C, pickIds(), planOpts());
    // v9d D1: More ideas offers only what would go on her day as it is, and each "If there's time" row knows whether
    // Swap in can put it on (else the dinner time it needs). All of it in the tap (at most a few ms on her longest
    // day, gate-d1-spec browser-timing.txt), so the day and its buttons render once.
    roomNow = picks.length || answers ? P.suggestionsFit(C, picks, answers || {}, planOpts(), plan).ideas : [];
    laterNow = plan.later.map((l) => (P.canSwapIn(C, l.id, planOpts()) ? { id: l.id, ok: true }
      : { id: l.id, ok: false, needs: C.anchors.dinner.times.find((t) => P.canSwapIn(C, l.id, planOpts({ dinnerAt: t }))) || null }));
    syncSend();
    renderDepNote();
    renderDay();
    syncCatalogue();
    syncMap();
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

  let skyTween = null;
  function setupMotion() {
    const mm = gsap.matchMedia();

    mm.add({ motion: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      reduced = !ctx.conditions.motion;
      skyHex = '';
      motionCtx = null;

      if (reduced) {
        HERO.intro = null;
        heroFinal();
        finishBoard();
        ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => render(self.scroll()) });
        render(scrollY);
        return;
      }

      // Sky scrub: smoothed scroll position drives the time of day.
      const st = { y: scrollY };
      skyTween = gsap.fromTo(st, { y: 0 }, {
        y: () => ScrollTrigger.maxScroll(window),
        ease: 'none',
        onUpdate: () => render(st.y),
        scrollTrigger: { start: 0, end: 'max', scrub: 0.4, invalidateOnRefresh: true },
      });
      render(scrollY);

      // Hero (v9c C1h): the ARRIVALS board writes itself in on every load, once the fonts are in (at most 0.7 s) and a
      // frame with the dark board has been painted, so it is seen rather than spent while the page loads. Felix's note
      // and the first question fade up from 0.55 s into the write, and never later than 0.9 s from here, so a slow
      // font never keeps her waiting for the first question.
      const intro = gsap.timeline({ paused: true, onComplete: playShown });
      HERO.intro = intro;
      heroIntro(intro, 0.1);
      // Their own tween: from() renders its start at once even when paused, so neither shows before its fade.
      const ask = gsap.from(['#note .note', '#ask .stage'], { autoAlpha: 0, y: 18, duration: 0.8, ease: 'power3.out',
        stagger: 0.1, clearProps: 'transform,visibility,opacity', paused: true });
      let asked = false;
      const showAsk = () => { if (!asked) { asked = true; ask.play(); } };
      intro.call(showAsk, null, 0.55);
      setTimeout(showAsk, 900);
      const go = () => requestAnimationFrame(() => requestAnimationFrame(() => { if (!intro.progress()) intro.play(0); }));
      Promise.race([...(document.fonts ? [document.fonts.ready] : []), new Promise((r) => setTimeout(r, 700))]).then(go);

      // The board's triggers come with the board (showDay adds them to this context later).
      motionCtx = ctx;
      if (DEP.board) depTriggers();
    });

    // The HUD stays off the hero, the questions and the top of the board: it comes on when the board's
    // first row passes under it (syncDock, b3.2). A refresh (a resize, a font, a new day) re-measures that
    // point and puts the bar right without a flight.
    // v9c C1k (dir-3's fix): after a refresh the sky goes straight to where she is. When Show me Friday makes the page
    // longer she was at the bottom of the short page, and the smoothed sky caught up from the new bottom (night) for a
    // frame: a night flash under the glide.
    ScrollTrigger.addEventListener('refresh', () => { measure(); syncDock(false); const tw = skyTween?.scrollTrigger?.getTween?.(); if (tw) tw.progress(1); render(reduced ? scrollY : lastY); });
    // v9d D3 (?sky=2): while ScrollTrigger measures the page the layer is one window tall again, so a page that has just
    // got shorter (a pick removed) is not measured at the layer's old height; measure() then sets the new one.
    if (SKY2) ScrollTrigger.addEventListener('refreshInit', () => { skyBg.style.height = ''; });
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
  slot('peek').addEventListener('cancel', (e) => { e.preventDefault(); closePeek(0, true); });
  slot('peek').addEventListener('close', onPeekClosed);
  bindDrag(slot('peek'), closePeek);
  bindDrag(slot('catalogue'), closeCatalogue);
  slot('catalogue').addEventListener('cancel', (e) => { e.preventDefault(); closeCatalogue(0, true); });
  // Closing the sheet (Close, Escape, the backdrop) returns focus to "See everything".
  slot('catalogue').addEventListener('close', () => { const b = $('[data-action="catalogue"]', slot('day-body')); if (b) refocus(b); });
  let textTimer = 0;
  slot('free-text').addEventListener('input', (e) => {
    freeText = e.target.value;
    saveState();
    syncSend();
    // Her line shows up on the board as a TBC row, half a second after she stops typing.
    clearTimeout(textTimer);
    textTimer = setTimeout(() => { if (booted) syncDepBoard(); }, 500);
  });
  slot('dep-note').addEventListener('click', (e) => { if (e.target.closest('[data-action="back-to-mine"]')) backToMine(e.detail === 0); });
  slot('dep-board').addEventListener('click', onBoardClick);
  slot('board').addEventListener('click', onHeroClick);
  slot('send').addEventListener('click', send);
  nowBtns.forEach((b) => b.addEventListener('click', jumpToNow));
  slot('hud-clock').addEventListener('click', backToBoard);
  // Her finger on a control's label cover (v9c C3a). The label's click is her real tap; the label then hands a
  // click to its hidden switch (the tick on an iPhone), and that click passes the tap on to the control: focus,
  // then one click at the same spot and with the same count, so Remove's double-tap guard still sees a finger. One
  // token per tap: whichever comes first, the switch's click or the fallback timer (a browser that did not hand
  // the click on), runs the control's action, and only once. Neither click reaches the page's own handlers.
  // A disabled or hidden control gets nothing (its cover is off in styles.css anyway).
  let pending = null;
  function forwardTap(tap) {
    const ctl = tap.ctl;
    if (!ctl || ctl.classList.contains('hap') || ctl.disabled || ctl.hidden) return;
    // Android: the tiles, the toggles, the word, the none answers, the dinner times and Show me Friday buzz in their
    // own handlers; every other deliberate tap gets a light one here. (An iPhone has no navigator.vibrate.)
    if (!ctl.matches('.tile, .peek-toggle, .say, [data-action="none"], .dt-opt') && !(ctl.matches('.stage-next') && stage.step === STEPS.length - 1)) buzz('light');
    try { ctl.focus({ preventScroll: true, focusVisible: false }); } catch { /* focus options unsupported */ }
    ctl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, detail: tap.detail, clientX: tap.clientX, clientY: tap.clientY, screenX: tap.screenX, screenY: tap.screenY }));
  }
  const fireTap = (tap) => { if (tap.done) return; tap.done = true; if (pending === tap) pending = null; forwardTap(tap); };
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    if (t.matches('label.hap')) {
      // Never preventDefault here: that would cancel the switch's click, and with it the tick.
      e.stopPropagation();
      const tap = { ctl: t.parentElement.firstElementChild, done: false, detail: e.detail, clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY };
      pending = tap;
      setTimeout(() => fireTap(tap), 0);
      return;
    }
    if (t.matches('label.hap > input')) {
      e.stopPropagation();
      const ctl = t.parentElement.parentElement.firstElementChild;
      if (pending && pending.ctl === ctl) fireTap(pending);
    }
  }, true);
  // The press her finger would give the control (0.96), shown while it is on the control's label cover (b3.4).
  const press = (e, on) => { const sw = e.target; if (sw.classList && sw.classList.contains('hap') && sw.previousElementSibling) sw.previousElementSibling.classList.toggle('is-pressed', on); };
  document.addEventListener('pointerdown', (e) => press(e, true), { passive: true });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => document.addEventListener(t, (e) => press(e, false), { passive: true, capture: t === 'pointerleave' }));
  addEventListener('scroll', () => syncDock(), { passive: true });
  wideMQ.addEventListener('change', () => { ensureAtlases(); ScrollTrigger.refresh(); });
  slot('hud-map').addEventListener('click', openMapSheet);
  slot('mapsheet').addEventListener('click', onMapSheetClick);
  slot('mapsheet').addEventListener('cancel', (e) => { e.preventDefault(); closeMapSheet(0, true); });
  slot('mapsheet').addEventListener('close', onMapSheetClosed);
  bindDrag(slot('mapsheet'), closeMapSheet);
  // The engraving loads after her first tile tap or Show me Friday; a visit that already has a day loads it once
  // the page has loaded and the browser is idle. Never on a fresh first screen.
  if (dayShown) { const later = () => idle(loadNolli, 2000); if (document.readyState === 'complete') later(); else addEventListener('load', later, { once: true }); }

  measure();
  setupMotion();
  booted = true;
  tick();
  setTimeout(() => { tick(); setInterval(tick, 60000); }, 60000 - (nowMs() % 60000) + 50);
  loadWeather();
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 2500)))(() => { if (DEP.board) warmBoard(); }, { timeout: 3000 });
  window.__venerdi = {
    moment: () => MOMENT, sky2: () => SKY2,
    finishBoard, depRows: () => depRows(plan), boardRows: () => (DEP.board ? DEP.board.rows.map((r) => r.shown) : []), replayStats: () => DEP.stats, plan: () => plan,
    introDone: () => !HERO.intro || HERO.intro.progress() === 1,
    state: () => ({ replaying: !!DEP.replay, paused: !!DEP.replay?.paused, pending: DEP.pending, settle: DEP.settle, seen: !!DEP.seen, fullPicks: DEP.seen?.fullPicks || null, sun: DEP.board ? DEP.board.sun.shown : [], stageBusy: stage.busy, draft: cloneAnswers(stage.draft), peek: peek.kind }),
    compose: (a) => P.compose(C, a), answers: () => answers && cloneAnswers(answers), picks: () => picks.map((p) => ({ ...p })),
    shareText: () => shareText(), dinner: () => dinner, dinnerAt: () => dinnerAt,
    // The handover (b3.2): where the bar comes on, and what the clock reads.
    dockY: () => dockY, clock: () => clockText, firstDeparture: () => ({ ...firstDeparture() }),
    glideTo: (key) => goToEntry(key),
    // For the frame shots of the race tracks' lap: forget that the lanes were drawn in, so the next one laps again.
    mapRelap: () => ATLASES.forEach((a) => { a.lapped.clear(); a.tracks.forEach((t) => { t.shown = false; t.g.classList.remove('is-shown'); }); a.marks.forEach((m) => m.g.classList.remove('has-track')); }),
    // The map, for the checks: whether the engraving is in, each atlas's marks in screen px, and a way to put
    // the map on an entry directly (reduced motion, so the camera jumps).
    mapReady: () => INK.day.length > 0 && INK.p === 1,
    mapState: (kind) => { const a = ATLASES.find((x) => x.kind === kind); if (!a) return null; const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; }; return { kind, key: mapKey, cam: { ...a.cam }, vw: a.vw, vh: a.vh, rect: box(a.el), dark: INK.dark, night: INK.night.filter(Boolean).length, inks: INK.day.length, flying: !!a.tw, marks: a.marks.map((m) => ({ id: m.id, key: m.key, kind: m.kind, x: m.x, y: m.y, label: m.text.textContent, state: m.state, gone: m.gone, cls: m.g.getAttribute('class'), op: +getComputedStyle(m.g).opacity, named: m.g.classList.contains('is-named') || m.state === 'current', labelOpacity: +getComputedStyle(m.text).opacity, dot: box(m.dot), labelBox: box(m.text), fill: getComputedStyle(m.dot).fill, glow: +getComputedStyle(m.glow).opacity, ring: String(parseFloat(getComputedStyle(m.ring).strokeDashoffset)) })) }; },
    mapFocus: (key, jump = true) => { const el = keyEl(key); ATLASES.forEach((a) => a.focus(el, { jump, camera: a.kind !== 'sheet' })); mapKey = el ? key : null; },
  };

  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  if (location.hash.length > 1) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
})();
