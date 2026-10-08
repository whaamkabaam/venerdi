/* Venerdì v4: a picker that builds a relaxed Friday, played back on a DEPARTURES board.
   Renders from window.SITE (data.js) and plan.js (the day builder), then wires the boards,
   the sky, HUD, map, persistence and sharing. Every visible string comes from content.json. */
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
  const store = {
    get(k, d) { try { const v = localStorage.getItem('venerdi:v3:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('venerdi:v3:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const OPT = Object.fromEntries(C.options.map((o) => [o.id, o]));

  const ICON = {
    out: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6.5 5H11v4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg class="i" viewBox="0 0 18 18" aria-hidden="true"><path d="m5 7 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    plus: '<svg class="mark-off" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 7.75v8.5M7.75 12h8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
    check: '<svg class="mark-on" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"/><path class="tick" d="m7.5 12.4 3 3 6-6.7" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
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
  const linkBtn = (href, label, ctx, cls = 'btn btn--small') =>
    `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}${ctx ? `<span class="sr-only">: ${esc(ctx)}</span>` : ''}${newTab}${ICON.out}</a>`;
  // Decorative photos (the title next to them says what they are). Missing photos keep a quiet colour block.
  function thumbHTML(key, cls, sizes, extra = '') {
    const im = key && IMG[key];
    if (!im) return `<span class="${cls} is-empty">${extra}</span>`;
    return `<span class="${cls}" style="--ph:${esc(im.color || '')}"><img src="${esc(im.src800)}" srcset="${esc(im.src800)} 800w, ${esc(im.src1600)} 1600w" sizes="${sizes}" width="${+im.w}" height="${+im.h}" alt="" loading="lazy" decoding="async" style="object-position:${esc(im.focal || '50% 50%')}">${extra}</span>`;
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
  // One flip: the upper leaf with the old glyph folds down, the lower leaf with the new glyph lands.
  function addFlip(tl, f, next, at, d) {
    tl.call(() => {
      f.lt.textContent = f.cur;
      f.ft.textContent = next;
      f.lb.textContent = next;
      gsap.set(f.lbEl, { rotationX: 90 });
    }, null, at);
    tl.fromTo(f.ltEl, { rotationX: 0 }, { rotationX: -90, duration: d, ease: 'power1.in', immediateRender: false }, at);
    tl.fromTo(f.lbEl, { rotationX: 90 }, { rotationX: 0, duration: d, ease: 'power1.out', immediateRender: false }, at + d);
    tl.call(() => { f.fb.textContent = next; f.cur = next; }, null, at + 2 * d);
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

  // A row's data: { time, to, remark, kind, key, target, label, en }. Columns: time | to (who) | remark.
  const KINDS = ['is-pick', 'is-drop', 'is-anchor', 'is-tbc', 'is-sun', 'is-you', 'is-live'];
  const rowHTML = (w) => `<div class="board-row" role="row">
      <span class="c c--time" role="cell"><span class="sr-only"></span><span class="cells" aria-hidden="true">${FLAP.repeat(w[0])}</span></span>
      <span class="c c--who" role="cell"><span class="sr-only"></span><span class="cells" aria-hidden="true">${FLAP.repeat(w[1])}</span></span>
      <span class="c c--note" role="cell"><span class="sr-only"></span><span class="cells" aria-hidden="true">${FLAP.repeat(w[2])}</span><span class="note-en" aria-hidden="true"></span></span>
      <button type="button" class="board-hit" hidden></button>
    </div>`;
  function rowModel(el, widths) {
    return {
      el, widths,
      cols: $$('.cells', el).map((c) => [...c.children].map(flapOf)),
      srs: [...el.children].slice(0, 3).map((c) => c.firstElementChild),
      en: $('.note-en', el),
      hit: $('.board-hit', el),
      shown: ['', '', ''],
      data: null,
      tls: [],
    };
  }
  function makeBoard(host, { title, sub, label, columns, widths, rows, sun = false }) {
    const cls = ['time', 'who', 'note'];
    host.innerHTML = `<div class="board">
      <div class="board-head"><p class="board-title">${esc(title)}</p><p class="board-sub label">${esc(sub)}</p></div>
      <div class="board-grid" role="table" aria-label="${esc(label)}" style="--n1:${widths[0]};--n2:${widths[1]};--n3:${widths[2]}">
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
  const rowTexts = (d, w) => (d ? [d.time, d.to, d.remark] : ['', '', '']).map((t, c) => boardText(t, w[c]));
  // Classes, screen-reader text, the tap target and the caption follow the row's data.
  function applyRowMeta(row, d) {
    row.data = d;
    KINDS.forEach((k) => row.el.classList.remove(k));
    if (d && d.kind) row.el.classList.add('is-' + d.kind);
    if (d && d.live) row.el.classList.add('is-live');
    const t = rowTexts(d, row.widths);
    row.srs[0].textContent = d ? (d.srTime ?? d.time ?? '') : '';
    row.srs[1].textContent = d ? (d.label || d.to || '') : '';
    row.srs[2].textContent = d ? (d.srRemark || d.remark || '') + (d.en && d.enOn ? ` ${d.en}` : '') : '';
    row.en.textContent = d && d.en ? d.en : '';
    row.en.classList.toggle('is-on', !!(d && d.enOn));
    const hasTarget = !!(d && d.target);
    row.hit.hidden = !hasTarget;
    if (hasTarget) row.hit.setAttribute('aria-label', d.hitLabel || fmt(U.boardHit, { time: d.time, to: d.label || d.to }));
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
  // A single quiet flip of one row, outside any replay (live statuses, eggs, chips of thought).
  function flipRowNow(row, d, opts = { scramble: 0, D: 0.07, stagger: 0.02 }) {
    if (reduced) { setRowNow(row, d); return; }
    const tl = gsap.timeline({ onComplete: () => { row.tls = row.tls.filter((x) => x !== tl); } });
    row.tls.push(tl);
    flipRow(tl, row, d, 0, opts);
  }

  /* ------------------------------------------------------------------ */
  /* ARRIVALS: live statuses and the SUNRISE egg                         */
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
    slot('hero-title').textContent = H.title;
    slot('hero-date').textContent = H.dateLine;
    slot('hero-lead').textContent = H.lead;
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
  /* Static parts: note, picker, bring, footer                           */
  /* ------------------------------------------------------------------ */

  function renderStatic() {
    const N = C.note;
    slot('note-title').textContent = U.noteTitle;
    slot('note').innerHTML = `<p class="note-greeting">${esc(N.greeting)}</p>${N.paras.map((p) => `<p>${esc(p)}</p>`).join('')}<p class="note-sign">${esc(N.sign)}</p>`;

    const K = C.picker;
    slot('pick-title').textContent = K.title;
    const chip = `<span class="chip" aria-hidden="true">${FLAP.repeat(5)}</span>`;
    slot('pick-groups').innerHTML = K.groups
      .map((g) => {
        const opts = C.options.filter((o) => o.group === g.id);
        if (!opts.length) return '';
        return `<div class="pick-group"><h3 id="pg-${esc(g.id)}">${esc(g.label)}</h3><div class="pick-row" role="group" aria-labelledby="pg-${esc(g.id)}">${opts
          .map((o) => {
            const id = esc(o.id);
            const described = [`pk-${id}-d`, o.tag ? `pk-${id}-g` : '', `pk-${id}-s`].filter(Boolean).join(' ');
            return `<button type="button" class="pick" aria-pressed="false" data-id="${id}" aria-labelledby="pk-${id}-t" aria-describedby="${described}">
              ${thumbHTML(o.image, 'pick-photo', '(min-width: 768px) 320px, 240px', chip)}
              <span class="pick-text"><span class="pick-title" id="pk-${id}-t">${esc(o.title)}</span><span class="pick-line" id="pk-${id}-d">${esc(o.line)}</span>${o.tag ? `<span class="tag" id="pk-${id}-g">${esc(o.tag)}</span>` : ''}</span>
              <span class="pick-mark" aria-hidden="true">${ICON.plus}${ICON.check}</span>
              <span class="sr-only" id="pk-${id}-s"></span>
            </button>`;
          })
          .join('')}</div></div>`;
      })
      .join('');
    slot('dep-title').textContent = DEPC.srTitle;
    slot('free-label').textContent = K.freeTextLabel;
    slot('free-text').placeholder = K.freeTextPlaceholder;
    slot('send').textContent = K.sendLabel;

    slot('day-title').textContent = C.day.title;
    slot('map-title').textContent = U.mapTitle;
    slot('bring-title').textContent = U.bringTitle;
    slot('bring').innerHTML = C.bring.map((b) => `<li>${esc(b)}</li>`).join('');

    // Credits: every photo the page renders (option cards and dinner) plus hero-rome for og.jpg.
    const shown = [];
    const add = (k) => { if (k && IMG[k] && IMG[k].credit && !shown.includes(k)) shown.push(k); };
    C.options.forEach((o) => add(o.image));
    add(C.anchors.dinner?.image);
    add('hero-rome');
    slot('credits').innerHTML = shown.length
      ? `<details class="credits"><summary>${esc(U.credits)}${ICON.chev}</summary><ul>${shown
          .map((k) => { const c = IMG[k].credit; return `<li><a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.title)}</a>${c.author ? ` ${esc(U.creditBy)} ${esc(c.author)}` : ''}, ${c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(c.license)}</a>` : esc(c.license)}</li>`; })
          .join('')}</ul></details>`
      : '';
    slot('footer').textContent = C.footer.line;

    slot('hud').setAttribute('aria-label', U.hud.label);
    $$('main > section').forEach((sec) => { if (U.hud[sec.id]) sec.dataset.hud = U.hud[sec.id]; });
    slot('now-long').textContent = U.jumpNow;
    slot('now-short').textContent = U.jumpNowShort;
    $('.hud-now').setAttribute('aria-label', U.jumpNow);
  }

  /* ------------------------------------------------------------------ */
  /* Picks: state (in tap order), persistence, the link                  */
  /* ------------------------------------------------------------------ */

  let picks = new Set();   // insertion order is tap order; the replay and the link keep it
  let freeText = '';
  let fromLink = false;
  let plan = null;
  let hasBackup = false;

  function loadState() {
    const q = new URLSearchParams(location.search);
    if (q.has('p')) {
      const linkPicks = q.get('p').split(',').map((s) => s.trim()).filter((id) => OPT[id]);
      const linkNote = q.get('n') || '';
      // Keep her own picks before adopting the link's, so "Back to my picks" can restore them.
      const saved = store.get('picks', null), savedNote = store.get('note', '');
      hasBackup = Array.isArray(saved) && ([...saved].sort().join() !== [...linkPicks].sort().join() || savedNote !== linkNote);
      if (hasBackup) store.set('before-link', { picks: saved, note: savedNote });
      picks = new Set(linkPicks);
      freeText = linkNote;
      fromLink = true;
      saveState();
      // A link always replays its build in tap order, whatever this phone has seen before.
      store.set('depSeen', null);
      DEP.seen = null;
      // Drop the query at once, so a reload or a restored tab keeps her later edits.
      history.replaceState(null, '', location.pathname + location.hash);
      return;
    }
    const saved = store.get('picks', null);
    picks = new Set(Array.isArray(saved) ? saved.filter((id) => OPT[id]) : C.options.filter((o) => o.default).map((o) => o.id));
    freeText = store.get('note', '');
  }
  function saveState() { store.set('picks', [...picks]); store.set('note', freeText); }

  function backToMine() {
    const b = store.get('before-link', null);
    if (!b) return;
    picks = new Set((b.picks || []).filter((id) => OPT[id]));
    freeText = b.note || '';
    slot('free-text').value = freeText;
    fromLink = false;
    hasBackup = false;
    saveState();
    syncCards();
    update();
  }

  // Links in chat apps end at the last "safe" character, so the note goes first, `p` (ids, in tap
  // order) last, and ! ' ( ) * . are encoded too. The link carries a capped copy of the note.
  const NOTE_LINK_MAX = 1000;
  const encodeNote = (s) => encodeURIComponent(s).replace(/[!'()*.]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  function linkURL() {
    const base = location.href.split(/[?#]/)[0];
    const n = Array.from(freeText.trim()).slice(0, NOTE_LINK_MAX).join('');
    return `${base}?${n ? `n=${encodeNote(n)}&` : ''}p=${[...picks].join(',')}`;
  }
  // A mini timetable: "10:00 Maritozzo" per stop, then her line, then the link.
  function shareText() {
    const stops = plan.items.filter((it) => it.kind === 'option').map((it) => `${it.rough} ${it.option.title}`);
    const note = freeText.trim();
    // Only a note: send the note and the link, without the timetable frame.
    if (!stops.length) return [note, linkURL()].filter(Boolean).join('\n');
    const lines = [C.picker.shareIntro, ...stops];
    if (note) lines.push(`${C.picker.shareExtra} ${note}`);
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

  function syncCards() {
    $$('.pick').forEach((b) => b.setAttribute('aria-pressed', String(picks.has(b.dataset.id))));
  }
  function toggle(id) {
    if (picks.has(id)) picks.delete(id); else picks.add(id);
    fromLink = false;
    saveState();
    syncCards();
    update();
  }

  /* ------------------------------------------------------------------ */
  /* DEPARTURES: rows, the replay, live remarks, eggs                    */
  /* ------------------------------------------------------------------ */

  const DW = [5, 20, 20];
  const R = DEPC.rows;
  const anchorRow = (key, extra = {}) => ({ key, time: R[key].time, to: R[key].to, remark: R[key].remark, kind: 'anchor', ...extra });
  const skeletonRows = () => [anchorRow('coffee'), anchorRow('dinner'), anchorRow('end')];
  const sundayRow = (egg) => {
    const S = DEPC.sunday;
    return { key: 'sunday', time: S.time, to: S.to, remark: egg ? S.egg.remark : S.remark, kind: 'sun', en: S.egg.en, enOn: !!egg, target: 'sunday', hitLabel: `${S.to}, ${egg ? S.egg.remark : S.remark}` };
  };
  const dropRemark = (d) => (d.code === 'sunsetTaken' && d.option.slotTakenRemark ? d.option.slotTakenRemark : fmt(DEPC.drop.reasons[d.code] || '', d.vars || {}));

  // Whole-word, case-insensitive keyword match ("nap" matches "a nap", not "napoli").
  const escRe = (w) => w.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
  const wordRe = (w) => new RegExp('(^|[^\\p{L}])' + escRe(w.toLowerCase()) + '($|[^\\p{L}])', 'u');
  // Her free text as a TBC row: her words on the board, and a dry answer when a keyword matches.
  function tbcRow() {
    const text = freeText.trim();
    if (!text) return null;
    const lower = text.toLowerCase();
    let word = null;
    const hit = DEPC.tbc.keywords.find((k) => (word = k.words.find((w) => wordRe(w).test(lower))));
    // Emoji and other glyphs a flap lacks drop out and the spaces around them collapse. A long line
    // breaks at the last space that fits (a single long word is cut hard).
    const all = boardText(text, text.length).replace(/ +/g, ' ').trim();
    let to = all;
    if (all.length > DW[1]) { const cut = all.lastIndexOf(' ', DW[1]); to = cut > 0 ? all.slice(0, cut) : all.slice(0, DW[1]); }
    // The reply answers a word: if that word is past what the board shows, the word itself goes up.
    if (hit && !wordRe(word).test(to.toLowerCase())) to = boardText(word, DW[1]);
    return { key: 'tbc', time: DEPC.tbc.time, to: to || DEPC.tbc.blank, remark: hit ? hit.remark : DEPC.tbc.remark, kind: 'tbc', target: 'tbc', label: text, hitLabel: `${DEPC.tbc.time}, ${text}` };
  }

  // The board for a plan: coffee, the stops, her TBC line, dinner, the end, then what didn't fit.
  function depRows(pl, { tbc = tbcRow(), live = true } = {}) {
    const heavy = pl.picked.length >= 7 || pl.walkM >= 8000;
    const rows = [anchorRow('coffee', { target: 'arrival', label: R.coffee.to })];
    for (const it of pl.items) {
      if (it.kind === 'lunch-filler') rows.push({ key: 'lunch', time: it.rough, to: R.lunch.to, remark: R.lunch.remark, kind: 'anchor', target: 'lunch', label: C.day.noLunch });
      else if (it.kind === 'option') rows.push({ key: it.id, time: it.rough, to: it.option.board.to, remark: it.secondBreakfast ? DEPC.secondBreakfast : it.option.board.remark, kind: 'pick', target: it.id, label: it.option.title });
      else if (it.kind === 'anchor' && it.id === 'dinner') {
        if (tbc) rows.push(tbc);
        rows.push(anchorRow('dinner', { target: 'dinner', label: C.anchors.dinner.title }));
      } else if (it.kind === 'anchor' && it.id === 'end') {
        rows.push(anchorRow('end', { remark: heavy ? R.end.heavyRemark : R.end.remark, target: 'end', label: C.anchors.end.title }));
      }
    }
    for (const d of pl.didntFit) rows.push({ key: 'x-' + d.option.id, time: DEPC.drop.time, to: d.option.board.to, remark: dropRemark(d), kind: 'drop', label: d.option.title, srTime: '', srRemark: d.reason });
    // On the day, remarks become status by the clock: DEPARTED for past rows, BOARDING for the current one.
    if (live && isToday()) {
      const now = romeNow().min;
      const timed = rows.filter((r) => /^\d\d:\d\d$/.test(r.time) && r.kind !== 'drop');
      let current = null;
      timed.forEach((r) => { if (toMin(r.time) <= now) current = r; });
      timed.forEach((r) => {
        if (!current) return;
        if (r === current) Object.assign(r, { remark: DEPC.live.boarding, live: true });
        else if (toMin(r.time) < toMin(current.time) || (toMin(r.time) === toMin(current.time) && timed.indexOf(r) < timed.indexOf(current))) Object.assign(r, { remark: DEPC.live.departed, live: true });
      });
    }
    return rows;
  }

  const DEP = { board: null, replay: null, seen: store.get('depSeen', null), sunEgg: false, shown: [], pending: false, sunPending: false, stats: null };
  const depSig = () => `${[...picks].join(',')}|${freeText.trim()}`;
  const plainRows = (rows) => rows.map((r) => (r ? { time: r.time, to: r.to, remark: r.remark, kind: r.kind } : null));
  const sameRows = (a, b) => JSON.stringify(plainRows(a)) === JSON.stringify(plainRows(b));
  const gapEl = () => $('.dep-gap', DEP.board.host);

  function renderDepBoard() {
    DEP.board = makeBoard(slot('dep-board'), {
      title: DEPC.title, sub: DEPC.sub, label: `${DEPC.title}, ${DEPC.sub}`,
      columns: DEPC.columns, widths: DW, rows: 0, sun: true,
    });
  }
  // The first 3D transform on a leaf is the expensive one (style read, layer setup), so give every
  // leaf on the board its resting transform before the replay instead of in the middle of it.
  const boardLeaves = () => [...DEP.board.rows, DEP.board.sun].flatMap((row) => row.cols.flat()).flatMap((f) => [f.ltEl, f.lbEl]);
  function warmBoard() {
    const leaves = boardLeaves().filter((el) => !el._warm);
    leaves.forEach((el) => { el._warm = true; });
    if (leaves.length) gsap.set(leaves, { rotationX: 0 });
  }
  function setBoardNow(rows) {
    DEP.board.rows.forEach((row, i) => setRowNow(row, rows[i] || null));
    DEP.shown = rows;
  }
  function setSunNow(on = true) {
    setRowNow(DEP.board.sun, on ? sundayRow(DEP.sunEgg) : null);
    gsap.set(gapEl(), { scaleX: on ? 1 : 0 });
  }
  // A spare row while her note is empty, so her TBC line takes it and the page never moves.
  const spare = () => (freeText.trim() ? 0 : 1);
  const slotsFor = (states) => Math.max(...states.map((s) => s.length)) + spare();
  // What the board last showed, and the pick order last replayed in full (only a replay with at
  // least two picks counts, so a look at the default card does not spend it).
  function markSeen(fullPicks = null) {
    DEP.seen = { sig: depSig(), rows: plainRows(DEP.shown), picks: [...picks], fullPicks: fullPicks || DEP.seen?.fullPicks || null };
    store.set('depSeen', DEP.seen);
  }
  // Her build replays in full unless she has watched one: then only if two or more picks are new
  // since. Without a full replay on record, any change of picks earns one; typing alone does not.
  function needsFull() {
    const s = DEP.seen;
    if (!s) return true;
    if (!s.fullPicks) return (s.picks || []).join() !== [...picks].join();
    return [...picks].filter((id) => !s.fullPicks.includes(id)).length >= 2;
  }
  function primeFull() {
    const states = replayStates();
    DEP.board.ensure(Math.max(DEP.board.rows.length, slotsFor(states)));
    setBoardNow(states[0]);
    setSunNow(false);
    DEP.sunPending = false;
    return states;
  }
  // The replay: one state per tap, each wave re-sorting the board as the day re-plans itself.
  function replayStates() {
    const order = [...picks];
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
    if (full && states.length > 2) r.fullPicks = [...picks];
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
  // After picks or her line change: settle the board now if she is looking at it, else on the next visit.
  function syncDepBoard({ initial = false } = {}) {
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
    else if (sameRows(DEP.shown, finalRows)) { DEP.shown = finalRows; DEP.board.rows.forEach((row, i) => applyRowMeta(row, finalRows[i] || null)); markSeen(); return; }
    DEP.pending = true;
    clearTimeout(depTimer);
    depTimer = setTimeout(() => { if (boardInView()) maybePlay(); }, 250);
  }
  // On the day, the minute tick flips only the remarks that changed.
  function depTick() {
    if (DEP.replay || DEP.pending || !plan) return;
    const finalRows = depRows(plan);
    DEP.board.rows.forEach((row, i) => {
      const d = finalRows[i] || null;
      if (JSON.stringify(plainRows([row.data])) !== JSON.stringify(plainRows([d]))) flipRowNow(row, d);
    });
    DEP.shown = finalRows;
    markSeen();
  }

  // Board taps: finish a running replay; the Sunday and SASHA eggs; otherwise go to the stop in Details.
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
  /* Card chips: her departure time on each picked card                  */
  /* ------------------------------------------------------------------ */

  function syncChips() {
    $$('.pick').forEach((card) => {
      const id = card.dataset.id;
      const sr = $(`#pk-${CSS.escape(id)}-s`, card);
      if (!picks.has(id)) { sr.textContent = ''; return; }
      const it = plan.items.find((x) => x.kind === 'option' && x.id === id);
      const text = it ? it.rough : DEPC.drop.time;
      sr.textContent = it ? fmt(U.pickedAt, { time: it.rough }) : U.pickedDrop;
      const chip = $('.chip', card);
      chip.classList.toggle('is-drop', !it);
      const fl = [...chip.children].map(flapOf);
      const fresh = fl.every((f) => !f.cur);
      if (chip.tl) { chip.tl.progress(1).kill(); chip.tl = null; }
      if (fresh || reduced) { fl.forEach((f, k) => setFlap(f, cellChar(text, k))); return; }
      const tl = gsap.timeline({ onComplete: () => { chip.tl = null; } });
      fl.forEach((f, k) => { const b = cellChar(text, k); if (f.cur !== b) addFlip(tl, f, b, k * 0.03, 0.07); });
      chip.tl = tl;
    });
  }

  /* ------------------------------------------------------------------ */
  /* Details: the plan list                                              */
  /* ------------------------------------------------------------------ */

  const placeOf = (it) => (it.kind === 'option' ? it.option : it.kind === 'anchor' && typeof it.anchor.lat === 'number' ? it.anchor : null);

  function renderDepNote() {
    const D = C.day;
    const back = hasBackup ? ` <button class="btn btn--small" type="button" data-action="back-to-mine">${esc(D.backToMine)}</button>` : '';
    slot('dep-note').innerHTML = fromLink ? `<p class="day-note">${esc(D.fromLink)}${back}</p>` : '';
    const books = plan.options.filter((o) => o.book).map((o) => o.book).concat(U.bookDinner);
    const list = books.length > 1 ? books.slice(0, -1).join(U.listJoin) + U.listJoinLast + books[books.length - 1] : books.join('');
    const after = [`<p>${esc(fmt(D.willBook, { list }))}</p>`];
    if (C.options.some((o) => o.default && !plan.options.includes(o))) after.push(`<p>${esc(D.bibsSaturday)}</p>`);
    slot('send-after').innerHTML = after.join('');
  }

  function renderDay() {
    const D = C.day;
    const body = slot('day-body');
    if (!picks.size) { body.innerHTML = `<p class="day-empty">${esc(D.empty)}</p>`; return; }
    let html = '', group = '', walked = 0;
    for (const it of plan.items) {
      if (it.kind === 'transfer') { walked += it.transfer.m; html += `<li class="plan-transfer"><p>${esc(it.transfer.text)}</p></li>`; continue; }
      if (it.kind === 'free') { html += `<li class="plan-free"><p>${esc(D.freeTime)}</p></li>`; continue; }
      if (it.slot !== group) { group = it.slot; html += `<li class="plan-group"><h3 class="label">${esc(D.slots[group])}</h3></li>`; }
      const time = it.exact ? it.rough : fmt(U.around, { time: it.rough });
      const timeRow = `<p class="plan-time"><span aria-hidden="true">${esc(time)}</span> <span class="tag tag--now">${esc(U.nowTag)}</span></p>`;
      const key = it.kind === 'lunch-filler' ? 'lunch' : it.id;
      const attrs = `data-min="${toMin(it.rough)}" data-km="${walked}" data-key="${esc(key)}"`;
      if (it.kind === 'lunch-filler') {
        html += `<li class="plan-item plan-item--text" ${attrs} data-hud-title="${esc(D.noLunch)}"><div class="plan-text">${timeRow}<h4 class="plan-line"><span class="sr-only">${esc(time)}, </span>${esc(D.noLunch)}</h4></div></li>`;
        continue;
      }
      const o = it.kind === 'option' ? it.option : it.anchor;
      const title = o.title;
      const line = it.kind === 'option' ? o.line : o.body;
      const link = o.links?.[0] ? linkBtn(o.links[0].url, o.links[0].label, title) : '';
      const tag = it.kind === 'option' && o.tag ? `<span class="tag">${esc(o.tag)}</span>` : '';
      const photo = o.image ? thumbHTML(o.image, 'plan-photo', '64px') : '';
      html += `<li class="plan-item${photo ? '' : ' plan-item--text'}" ${attrs} data-dot="${placeOf(it) ? esc(it.id) : ''}" data-hud-title="${esc(o.hud || title)}">
        ${photo}<div class="plan-text">${timeRow}<h4 class="plan-title"><span class="sr-only">${esc(time)}, </span>${esc(title)}</h4>${line ? `<p class="plan-line">${esc(line)}</p>` : ''}${tag || link ? `<div class="plan-meta">${tag}${link}</div>` : ''}</div>
      </li>`;
    }
    // What didn't fit is on the board as dim rows; screen readers get the reasons here.
    const didnt = plan.didntFit.length
      ? `<div class="sr-only"><h3>${esc(D.didntFitTitle)}</h3><ul>${plan.didntFit.map((d) => `<li>${esc(d.option.title)}: ${esc(d.reason)}</li>`).join('')}</ul></div>`
      : '';
    body.innerHTML = `<ol class="plan">${html}</ol>${didnt}`;
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
        <defs>${fade('mapFadeX', vx + vw, vy)}${fade('mapFadeY', vx, vy + vh)}<g class="map-masks"></g></defs>
        <g mask="url(#mapFadeY)"><path class="map-river" d="${MAP.river}" mask="url(#mapFadeX)"/></g>
        <g class="map-plan"></g>
      </svg>
      <figcaption class="label">${esc(U.mapCredit)}</figcaption>`;
  }

  // The plan's stops as dots, joined in plan order by straight dashed lines. Labels are rough times.
  function renderMapPlan() {
    const svg = $('svg', mapFig);
    const [vx, vy, vw, vh] = MAP.viewBox;
    mapPts = (picks.size ? plan.items : []).filter(placeOf).map((it) => {
      const p = placeOf(it);
      const [x, y] = project(p.lat, p.lon);
      return { id: it.id, x: Math.round(x), y: Math.round(y), label: it.rough };
    });
    const lines = mapPts.slice(1).map((b, i) => ({ a: mapPts[i], b }));
    $('.map-masks', svg).innerHTML = lines
      .map((l, i) => `<mask id="mk${i}" maskUnits="userSpaceOnUse" x="${vx - 500}" y="${vy - 500}" width="${vw + 1000}" height="${vh + 1000}"><path class="leg-mask" data-i="${i}" d="M${l.a.x} ${l.a.y}L${l.b.x} ${l.b.y}" fill="none" stroke="#fff" stroke-linecap="round"/></mask>`)
      .join('');
    $('.map-plan', svg).innerHTML = lines
      .map((l, i) => `<path class="leg leg--dash" d="M${l.a.x} ${l.a.y}L${l.b.x} ${l.b.y}" mask="url(#mk${i})"/>`)
      .join('') + mapPts
      .map((p) => `<g class="map-stop" data-id="${esc(p.id)}" data-o="${p.x} ${p.y}">
        <circle class="map-halo" cx="${p.x}" cy="${p.y}"/>
        <circle class="map-dot" cx="${p.x}" cy="${p.y}"/>
        <text class="map-label" x="${p.x}" y="${p.y}" dominant-baseline="central">${esc(p.label)}</text>
      </g>`)
      .join('');
    mapUnit = 0;
    mapCurrent = null;
    layoutMap();
    if (!mapRevealed && !reduced && window.gsap) {
      $$('.leg-mask', svg).forEach((el) => gsap.set(el, { drawSVG: '0%' }));
      $$('.map-stop', svg).forEach((g) => gsap.set(g, { scale: 0, autoAlpha: 0, svgOrigin: g.dataset.o }));
    }
  }

  // Sizes in the SVG follow the rendered width so lines, dots and labels keep a fixed on-screen size
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
    set('.leg--dash', { 'stroke-width': 2.25 * u, 'stroke-dasharray': `${6 * u} ${5 * u}` });
    set('.leg-mask', { 'stroke-width': 10 * u });
    set('.map-dot', { r: 4.5 * u, 'stroke-width': 1.75 * u });
    set('.map-halo', { r: 9.5 * u, 'stroke-width': 2 * u });
    set('.map-label', { 'font-size': 12.5 * u, 'stroke-width': 3.5 * u });
    placeLabels(svg, u);
  }

  // Greedy label placement: crowded dots first, eight candidate spots each, scored by overlap
  // with placed labels, other dots, the lines and the frame edge.
  function placeLabels(svg, u) {
    const [vx, vy, vw, vh] = MAP.viewBox;
    const font = 12.5 * u, dotR = 4.5 * u;
    const w = font * 2.45, h = font * 0.95;
    const gap = dotR + font * 0.35;
    const cands = [
      [gap, 0, 'start'], [-gap, 0, 'end'],
      [0, -(gap + h / 2), 'middle'], [0, gap + h / 2, 'middle'],
      [gap * 0.8, -(gap * 0.8 + h / 2), 'start'], [-gap * 0.8, -(gap * 0.8 + h / 2), 'end'],
      [gap * 0.8, gap * 0.8 + h / 2, 'start'], [-gap * 0.8, gap * 0.8 + h / 2, 'end'],
    ];
    const box = (x, y, anchor) => { const x0 = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2; return [x0, y - h / 2, x0 + w, y + h / 2]; };
    const overlap = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const frame = [vx + 2 * u, vy + 2 * u, vx + vw - 2 * u, vy + vh - 2 * u];
    const pts = mapPts;
    const linePts = [];
    pts.slice(1).forEach((b, i) => { const a = pts[i]; for (let k = 1; k < 12; k++) linePts.push([a.x + ((b.x - a.x) * k) / 12, a.y + ((b.y - a.y) * k) / 12]); });
    const dots = pts.map((s) => [s.x - dotR * 1.6, s.y - dotR * 1.6, s.x + dotR * 1.6, s.y + dotR * 1.6]);
    const crowd = (s) => pts.filter((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < w * 1.6).length;
    const placed = [];
    [...pts].sort((a, b) => crowd(b) - crowd(a)).forEach((s) => {
      let best = null;
      cands.forEach(([dx, dy, anchor], ci) => {
        const b = box(s.x + dx, s.y + dy, anchor);
        let score = ci * 0.01 * w * h;
        for (const p of placed) score += overlap(b, p) * 50;
        dots.forEach((d, i) => { if (pts[i] !== s) score += overlap(b, d) * 30; });
        for (const [px, py] of linePts) if (px > b[0] && px < b[2] && py > b[1] && py < b[3]) score += w * h * 0.05;
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

  // Every frame: write the page and HUD backgrounds directly (cheap, no inheritance).
  // The --sky custom property restyles the whole document, so it follows at most every 120 ms,
  // when the colour has visibly moved, and once more when scrolling settles.
  const themeMeta = $('meta[name="theme-color"]');
  const hud = $('.hud');
  let skyHex = '', skyRgb = [0, 0, 0], varHex = '', varLch = null, varAt = 0, varTimer = 0;
  let isDark = false;
  function syncSkyVar() {
    clearTimeout(varTimer);
    varTimer = 0;
    if (skyHex === varHex) return;
    varHex = skyHex;
    varLch = rgbToOklch(skyRgb);
    varAt = performance.now();
    root.style.setProperty('--sky', skyHex);
    themeMeta.content = skyHex;
  }
  function applySky(t) {
    const lch = skyAt(t);
    const rgb = oklchToRgb(lch);
    const hex = rgbHex(rgb);
    if (hex === skyHex) return;
    skyHex = hex;
    skyRgb = rgb;
    root.style.backgroundColor = hex;
    hud.style.backgroundColor = `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.85)`;
    const Y = relLum(rgb);
    const dark = contrast(Y, Y_LAMP) > contrast(Y, Y_INK); // flip at the luminance crossover
    if (dark !== isDark) { isDark = dark; root.toggleAttribute('data-dark', dark); syncSkyVar(); return; }
    const moved = !varLch || Math.abs(lch[0] - varLch[0]) > 0.01 || Math.abs(((lch[2] - varLch[2] + 540) % 360) - 180) > 3;
    if (moved && performance.now() - varAt >= 120) syncSkyVar();
    else if (!varTimer) varTimer = setTimeout(syncSkyVar, 140);
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
  /* Scroll model: page position -> time of day, current item, km       */
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
  const hudKm = $('[data-slot="hud-km"]');
  let hudPlaceText = '', hudKmText = '', mapCurrent = null;
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

    const m = el ? +el.dataset.km : 0;
    const km = (m / 1000).toFixed(1);
    if (km !== hudKmText) {
      hudKmText = km;
      hudKm.innerHTML = `<span aria-hidden="true">${esc(fmt(U.km, { km }))}</span><span class="sr-only">${esc(fmt(U.kmSr, { km }))}</span>`;
      hud.style.setProperty('--legs', Math.min(1, m / (C.meta.walkCapKm * 1000)).toFixed(3));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Time: the minute tick (live boards, "now" in Details and the HUD)   */
  /* ------------------------------------------------------------------ */

  const nowBtns = $$('.hud-now');
  let jumpEl = null;
  function tick() {
    const r = romeNow();
    const today = r.date === C.meta.date;
    if (HERO && HERO.rows[0].data) heroTick();
    if (DEP.board) depTick();
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
    const show = (data) => { const html = describeWeather(data); if (!html) return false; el.innerHTML = html; return true; };
    const cached = store.get('wx', null);
    if (cached && Date.now() - cached.t < 3600e3 && show(cached.d)) return;
    el.textContent = WX.climate;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(url, { signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();
      if (show(data)) { store.set('wx', { t: Date.now(), d: data }); return; }
    } catch { /* offline or API down: fall through */ }
    if (cached) show(cached.d); // a stale forecast beats the climate line
  }

  /* ------------------------------------------------------------------ */
  /* Update cycle                                                        */
  /* ------------------------------------------------------------------ */

  let booted = false;
  let refreshTimer = 0;
  // Send needs something to send: a pick or a line of text.
  function syncSend() { slot('send').disabled = !picks.size && !freeText.trim(); }

  function update() {
    plan = P.build(C, [...picks]);
    syncSend();
    renderDepNote();
    renderDay();
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

  function setupMotion() {
    const mm = gsap.matchMedia();

    mm.add({ motion: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      reduced = !ctx.conditions.motion;
      skyHex = '';

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

      // Hero: the ARRIVALS board flips in (or only its changed cells on a return visit), then the word and the lead.
      const intro = gsap.timeline();
      HERO.intro = intro;
      heroIntro(intro, 0.2);
      intro.from(['.hero-title', '.hero-date', '.hero-lead', '.hero-meta'], {
        autoAlpha: 0, y: 18, duration: 0.8, ease: 'power3.out', stagger: 0.1, clearProps: 'transform,visibility,opacity',
      }, 0.75);

      // DEPARTURES: her build replays when the board comes into view.
      ScrollTrigger.create({ trigger: '#dep .board', start: 'top 45%', onEnter: maybePlay, onEnterBack: maybePlay });
      // A replay under way waits while the board is off screen and carries on when it is back.
      ScrollTrigger.create({ trigger: '#dep .board', start: 'top bottom', end: 'bottom top+=64', onLeave: pauseReplay, onLeaveBack: pauseReplay, onEnter: resumeReplay, onEnterBack: resumeReplay });
      // A long board pushes the Sunday row below the fold; it then waits for its own trigger.
      ScrollTrigger.create({ trigger: '#dep .board-sun', start: 'bottom bottom', onEnter: maybeSun });

      // Map: the first time it scrolls in, the lines draw and the dots pop in plan order.
      revealMap = () => {
        if (mapRevealed) return;
        mapRevealed = true;
        const svg = $('svg', mapFig);
        const tl = gsap.timeline();
        let at = 0;
        $$('.map-stop', svg).forEach((g, i) => {
          tl.to(g, { scale: 1, autoAlpha: 1, duration: 0.35, ease: 'back.out(2.4)' }, at);
          const line = $(`.leg-mask[data-i="${i}"]`, svg);
          if (line) { tl.to(line, { drawSVG: '100%', duration: 0.3, ease: 'power1.inOut' }, at + 0.1); at += 0.3; }
          at += 0.08;
        });
      };
      ScrollTrigger.create({ trigger: mapFig, start: 'top 75%', once: true, onEnter: () => revealMap() });
    });

    // HUD appears once the hero has scrolled away.
    ScrollTrigger.create({
      trigger: '.hero',
      start: 'bottom top+=64',
      onEnter: () => hud.setAttribute('data-on', ''),
      onLeaveBack: () => hud.removeAttribute('data-on'),
      onRefresh: (self) => hud.toggleAttribute('data-on', self.progress > 0 || scrollY > self.start),
    });

    ScrollTrigger.addEventListener('refresh', () => { measure(); render(reduced ? scrollY : lastY); });
    ScrollTrigger.addEventListener('scrollEnd', syncSkyVar);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */

  gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);
  renderHero();
  renderStatic();
  renderDepBoard();
  renderMapFrame();
  placeMap();
  loadState();
  syncCards();
  slot('free-text').value = freeText;
  update();
  syncDepBoard({ initial: true });

  slot('pick-groups').addEventListener('click', (e) => {
    const b = e.target.closest('.pick');
    if (b) toggle(b.dataset.id);
  });
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
  (window.requestIdleCallback || ((fn) => setTimeout(fn, 2500)))(() => warmBoard(), { timeout: 3000 });
  window.__venerdi = { finishBoard, depRows: () => depRows(plan), boardRows: () => DEP.board.rows.map((r) => r.shown), replayStats: () => DEP.stats, plan: () => plan, state: () => ({ replaying: !!DEP.replay, paused: !!DEP.replay?.paused, pending: DEP.pending, seen: !!DEP.seen, fullPicks: DEP.seen?.fullPicks || null, sun: DEP.board.sun.shown }) };

  $$('details').forEach((d) => d.addEventListener('toggle', () => ScrollTrigger.refresh()));
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  if (location.hash.length > 1) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
})();
