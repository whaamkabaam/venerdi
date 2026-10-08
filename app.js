/* Venerdì: renders the page from window.SITE (data.js), then wires the sky, HUD and motion. */
(() => {
  'use strict';

  const { content: C, images: IMG = {}, map: MAP } = window.SITE;
  const root = document.documentElement;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const slot = (name) => $(`[data-slot="${name}"]`);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const dist = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('venerdi:' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('venerdi:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
  };
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const ICON = {
    out: '<svg class="i" viewBox="0 0 16 16" aria-hidden="true"><path d="M5 11 11 5M6.5 5H11v4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chev: '<svg class="i" viewBox="0 0 18 18" aria-hidden="true"><path d="m5 7 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    alert: '<svg class="i" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3 2.5 16.5h15L10 3Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8.5v3.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="14.2" r="0.9" fill="currentColor"/></svg>',
  };

  /* ------------------------------------------------------------------ */
  /* Small render helpers                                                */
  /* ------------------------------------------------------------------ */

  const newTab = '<span class="sr-only"> (opens in a new tab)</span>';
  const linkBtn = (href, label, extra = '') =>
    `<a class="btn" href="${esc(href)}" target="_blank" rel="noopener">${esc(label)}${extra}${newTab}${ICON.out}</a>`;
  const ctxSr = (ctx) => (ctx ? `<span class="sr-only">: ${esc(ctx)}</span>` : '');
  const linksHTML = (ls, ctx) => (ls?.length ? `<div class="links">${ls.map((l) => linkBtn(l.url, l.label, ctxSr(ctx))).join('')}</div>` : '');
  const factsHTML = (fs) => (fs?.length ? `<ul class="facts">${fs.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '');
  const moveHTML = (m) => (m ? `<p class="stop-body stop-tip">${esc(m)}</p>` : '');
  const plaqueHTML = (p, small = false) =>
    p ? `<p class="plaque${small ? ' plaque--small' : ''}"><span class="plaque-rione">${esc(p.rione)}</span><span class="sr-only">, </span><span class="plaque-street">${esc(p.street)}</span></p>` : '';
  const timeRow = (s, rain = false) =>
    `<p class="stop-time"><time datetime="${C.meta.date}T${esc(s.time)}">${esc(s.time)}</time><span class="tag tag--now">Now</span>${rain ? '<span class="tag tag--rain">Rain plan</span>' : ''}</p>`;
  // Headings carry the time for screen-reader heading navigation (the visible time sits above them).
  const titleHTML = (s, title, cls = 'stop-title') => `<h3 class="${cls}"><span class="sr-only">${esc(s.time)}, </span>${esc(title)}</h3>`;
  const planBtn = (to) =>
    `<p class="plan-inline"><button class="btn" type="button" data-set-plan="${to}">${to === 'rain' ? 'Raining? Indoor option' : 'Back to the sun plan'}</button></p>`;

  const SIZES = {
    major: '(min-width: 1280px) 760px, (min-width: 1024px) min(1000px, calc(100vw - 48px)), calc(100vw - 40px)',
    pit: '96px',
    swap: '(min-width: 640px) 320px, calc(100vw - 40px)',
  };
  function photoHTML(key, kind) {
    const im = key && IMG[key];
    if (!im) return `<figure class="photo photo--${kind} is-empty" aria-hidden="true"></figure>`;
    return `<figure class="photo photo--${kind}" style="--ph:${esc(im.color || '')}"><img src="${esc(im.src800)}" srcset="${esc(im.src800)} 800w, ${esc(im.src1600)} 1600w" sizes="${SIZES[kind]}" width="${+im.w}" height="${+im.h}" alt="${esc(im.alt)}" loading="lazy" decoding="async" style="object-position:${esc(im.focal || '50% 50%')}"></figure>`;
  }

  /* ------------------------------------------------------------------ */
  /* Hero                                                                */
  /* ------------------------------------------------------------------ */

  const FLAP = '<span class="flap"><span class="ft"><b></b></span><span class="fb"><b></b></span><span class="lt"><b></b></span><span class="lb"><b></b></span></span>';

  function renderHero() {
    const H = C.hero;
    const fields = ['time', 'who', 'note'];
    const width = fields.map((f) => Math.max(...H.rows.map((r) => [...r[f]].length)));
    const cells = (text, w) => `<span class="cells" aria-hidden="true" data-text="${esc(text)}">${FLAP.repeat(w)}</span>`;
    const head = `<div class="board-colheads" role="row">${fields
      .map((f, i) => `<span class="ch c--${f} label" role="columnheader">${esc(H.columns[i])} <i>${esc(H.columnsEn[i])}</i></span>`)
      .join('')}</div>`;
    const rows = H.rows
      .map((r) => `<div class="board-row${r.highlight ? ' is-you' : ''}" role="row">
        <span class="c c--time" role="cell"><span class="sr-only">${esc(r.time)}</span>${cells(r.time, width[0])}</span>
        <span class="c c--who" role="cell"><span class="sr-only">${esc(r.who)}</span>${cells(r.who, width[1])}</span>
        <span class="c c--note" role="cell"><span class="sr-only">${esc(r.note)} (${esc(r.noteEn)})</span>${cells(r.note, width[2])}<span class="note-en" aria-hidden="true">${esc(r.noteEn)}</span></span>
      </div>`)
      .join('');
    slot('board').innerHTML = `<div class="board">
      <div class="board-head"><p class="board-title">${esc(H.boardTitle)}</p><p class="board-sub label">${esc(H.boardSubtitle)}</p></div>
      <div class="board-grid" role="table" aria-label="${esc(H.boardTitle)}, ${esc(H.boardSubtitle)}" style="--n1:${width[0]};--n2:${width[1]};--n3:${width[2]}">${head}${rows}</div>
    </div>`;
    slot('hero-title').textContent = H.title;
    slot('hero-date').textContent = H.dateLine;
    slot('hero-lead').textContent = H.lead;
    slot('sunset').innerHTML = `Sunset <time class="tnum">${esc(C.meta.sunset)}</time>`;
  }

  /* ------------------------------------------------------------------ */
  /* Sections                                                            */
  /* ------------------------------------------------------------------ */

  function renderSections() {
    const N = C.note;
    slot('note').innerHTML = `<p class="note-greeting">${esc(N.greeting)}</p>${N.paras.map((p) => `<p>${esc(p)}</p>`).join('')}<p class="note-sign">${esc(N.sign)}</p>`;

    const A = C.arrival;
    slot('arrival-title').textContent = A.title;
    slot('arrival-lead').textContent = A.lead;
    slot('arrival-options').innerHTML = A.options
      .map((o) => `<article class="option"><p class="label">${esc(o.from)}</p><h3>${esc(o.how)}</h3><p>${esc(o.detail)}</p><p class="option-time">${esc(o.time)}</p></article>`)
      .join('');
    slot('arrival-warning').innerHTML = `${ICON.alert}<span>${esc(A.warning)}</span>`;

    // Each item: owner as a small tag, cta as the button label (or one button per entry in `links`).
    slot('book').innerHTML = C.book
      .map((b) => {
        const links = b.links || [{ label: b.cta || 'Open', url: b.url }];
        const btns = links.map((l) => linkBtn(l.url, l.label, ctxSr(b.label))).join('');
        const owner = b.owner ? ` <span class="tag tag--owner"><span class="sr-only">Who: </span>${esc(b.owner)}</span>` : '';
        return `<li class="check${links.length > 1 ? ' check--multi' : ''}">
        <label class="check-row"><input type="checkbox" data-id="${esc(b.id)}"${store.get('book:' + b.id, false) ? ' checked' : ''}><span><span class="check-label"><span class="check-name">${esc(b.label)}</span>${owner}</span><span class="check-detail">${esc(b.detail)}</span></span></label>
        <div class="check-links">${btns}</div>
      </li>`;
      })
      .join('');

    const euro = (n) => n.toFixed(2).replace('.', ',');
    const total = C.budget.reduce((sum, b) => sum + b.eur, 0);
    const [y, m, d] = C.meta.date.split('-');
    slot('receipt').innerHTML = `<div class="receipt">
      <p class="receipt-head">${esc(C.hero.title)} · <span class="tnum">${d}.${m}.${y}</span></p>
      <ul>${C.budget.map((b) => `<li class="receipt-line"><span class="what">${esc(b.label)}</span><span class="leader" aria-hidden="true"></span><span class="amt">€ ${euro(b.eur)}</span></li>`).join('')}</ul>
      <p class="receipt-line receipt-total"><span class="what">Totale</span><span class="leader" aria-hidden="true"></span><span class="amt">€ ${euro(total)}</span></p>
    </div>`;
    slot('budget-note').textContent = C.budgetNote;

    slot('practical').innerHTML = C.practical.map((p) => `<div class="tip"><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p></div>`).join('');
    if (slot('also')) slot('also').innerHTML = (C.alsoOn || [])
      .map((a) => `<article class="also-item"><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p><div class="links">${linkBtn(a.url, 'Info', ctxSr(a.title))}</div></article>`)
      .join('');

    // Credit only the photos this page renders, in page order, plus hero-rome (used by og.jpg).
    const shown = [];
    const add = (k) => { if (k && IMG[k] && IMG[k].credit && !shown.includes(k)) shown.push(k); };
    C.stops.forEach((s) => { add(s.image); add(s.rain?.image); (s.swaps || []).forEach((w) => add(w.image)); });
    add('hero-rome');
    slot('credits').innerHTML = shown.length
      ? `<details class="credits"><summary>Photo credits${ICON.chev}</summary><ul>${shown
          .map((k) => { const c = IMG[k].credit; return `<li><a href="${esc(c.sourceUrl)}" target="_blank" rel="noopener">${esc(c.title)}</a>${c.author ? ` by ${esc(c.author)}` : ''}, ${c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(c.license)}</a>` : esc(c.license)}</li>`; })
          .join('')}</ul></details>`
      : '';
    slot('footer').textContent = C.footer.line;
  }

  /* ------------------------------------------------------------------ */
  /* Stops                                                               */
  /* ------------------------------------------------------------------ */

  function majorHTML(v, s, rain) {
    return `${rain ? '' : plaqueHTML(s.plaque)}${timeRow(s, rain)}${v.image ? photoHTML(v.image, 'major') : ''}
      ${titleHTML(s, v.title)}
      <p class="stop-place label">${esc(v.place)}</p>
      <p class="stop-body">${esc(v.body)}</p>
      ${!rain && s.walk ? `<p class="walk-route"><span class="label tnum">${s.walk.min} min · ${dist(s.walk.m)}</span><span>${esc(s.walk.note)}</span></p>` : ''}
      ${moveHTML(v.move)}${factsHTML(v.facts)}${linksHTML(v.links, v.title)}`;
  }
  const pitHTML = (s) => `${plaqueHTML(s.plaque, true)}
    <div class="pit-head">${photoHTML(s.image, 'pit')}<div>${timeRow(s)}${titleHTML(s, s.title)}<p class="stop-place label">${esc(s.place)}</p></div></div>
    <p class="stop-body">${esc(s.body)}</p>${moveHTML(s.move)}${factsHTML(s.facts)}${linksHTML(s.links, s.title)}`;
  const bibHTML = (s) => `${plaqueHTML(s.plaque)}${timeRow(s)}
    <div class="bib"><span class="bib-holes" aria-hidden="true"></span>
      <p class="bib-race label">${esc(s.bib.race)}</p>
      ${titleHTML(s, s.title, 'bib-number')}
      <p class="bib-foot label"><span>${esc(s.bib.distance)}</span><span>${esc(s.bib.date)}</span></p>
    </div>
    <p class="stop-place label">${esc(s.place)}</p>
    <p class="stop-body">${esc(s.body)}</p>${moveHTML(s.move)}${factsHTML(s.facts)}${linksHTML(s.links, s.title)}`;
  const breakHTML = (s) => `${timeRow(s)}${titleHTML(s, s.title)}<p class="stop-body">${esc(s.body)}</p>${factsHTML(s.facts)}`;

  function swapsHTML(s) {
    if (!s.swaps?.length) return '';
    return `<details class="swaps"><summary>Other options<span class="sr-only">: ${esc(s.title)}</span>${ICON.chev}</summary><div class="swap-cards">${s.swaps
      .map((w) => `<article class="swap">${w.image ? photoHTML(w.image, 'swap') : ''}<div class="swap-text">
        <h4>${esc(w.title)}</h4><p class="label">${esc(w.place)}</p><p class="swap-body">${esc(w.body)}</p>${factsHTML(w.facts)}${linksHTML(w.links, w.title)}
      </div></article>`)
      .join('')}</div></details>`;
  }

  // One connector element. `plan` is "all", "sun" or "rain"; data-m feeds the legs meter.
  function connectorHTML(walk, transfer, plan) {
    const attrs = `data-plan="${plan}" data-m="${walk ? walk.m : 0}"`;
    if (walk) {
      return `<div class="walk walk--foot" ${attrs}><div class="walk-inner"><span class="walk-line" aria-hidden="true"></span><p class="walk-label label">${walk.min} min · ${dist(walk.m)}</p></div></div>`;
    }
    if (transfer) {
      return `<div class="walk walk--transfer" ${attrs}><div class="walk-inner"><span class="walk-line" aria-hidden="true"></span><p class="walk-label label">${esc(transfer.mode)} · ${transfer.min} min</p><p class="walk-note">${esc(transfer.note)}</p></div></div>`;
    }
    return '';
  }
  // The connector after stop s. With the rain plan on, a rain stop can bring its own way in
  // (next.rain.transferIn) and its own way out (s.rain.walkToNext / transferToNext).
  function connectorsHTML(s, next) {
    const sun = connectorHTML(s.walkToNext, s.transferToNext, 'sun');
    let rain = '';
    if (next?.rain?.transferIn) rain = connectorHTML(null, next.rain.transferIn, 'rain');
    else if (s.rain && (s.rain.walkToNext || s.rain.transferToNext)) rain = connectorHTML(s.rain.walkToNext, s.rain.transferToNext, 'rain');
    if (!rain) return sun ? sun.replace('data-plan="sun"', 'data-plan="all"') : '<div class="stop-gap" aria-hidden="true"></div>';
    return sun + rain;
  }

  function renderStops() {
    slot('stops').innerHTML = C.stops
      .map((s, i) => {
        const sun = s.kind === 'major' ? majorHTML(s, s, false) : s.kind === 'pit' ? pitHTML(s) : s.kind === 'bib' ? bibHTML(s) : breakHTML(s);
        const rain = s.rain ? `<div class="variant variant--rain" inert>${majorHTML(s.rain, s, true)}${planBtn('sun')}</div>` : '';
        return `<li class="stop-item"><article class="stop stop--${esc(s.kind)}" id="${esc(s.id)}">
          <div class="variant variant--sun">${sun}${s.rain ? planBtn('rain') : ''}</div>${rain}${swapsHTML(s)}
        </article>${connectorsHTML(s, C.stops[i + 1])}</li>`;
      })
      .join('');
  }

  /* ------------------------------------------------------------------ */
  /* Map                                                                 */
  /* ------------------------------------------------------------------ */

  const mapFig = document.createElement('figure');
  mapFig.className = 'map';
  const ROUTE_PTS = MAP.legs.flatMap((l) => l.d.slice(1).split('L').map((p) => p.split(' ').map(Number))).filter((_, i) => i % 3 === 0);

  function renderMap() {
    const [vx, vy, vw, vh] = MAP.viewBox;
    const timeOf = Object.fromEntries(C.stops.map((s) => [s.id, s.time]));
    const defs = [];
    // The river is clipped to the frame; fade its ends into the sky instead of a hard cut.
    const fade = (id, x2, y2) => `<linearGradient id="${id}g" gradientUnits="userSpaceOnUse" x1="${vx}" y1="${vy}" x2="${x2}" y2="${y2}">
        <stop offset="0" stop-color="#000"/><stop offset="0.09" stop-color="#fff"/><stop offset="0.91" stop-color="#fff"/><stop offset="1" stop-color="#000"/>
      </linearGradient>
      <mask id="${id}" maskUnits="userSpaceOnUse" x="${vx}" y="${vy}" width="${vw}" height="${vh}"><rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="url(#${id}g)"/></mask>`;
    defs.push(fade('mapFadeX', vx + vw, vy), fade('mapFadeY', vx, vy + vh));
    const legs = MAP.legs.map((l, i) => {
      if (l.kind === 'transfer') {
        defs.push(`<mask id="mk${i}" maskUnits="userSpaceOnUse" x="${vx - 500}" y="${vy - 500}" width="${vw + 1000}" height="${vh + 1000}"><path class="leg-mask" data-i="${i}" d="${l.d}" fill="none" stroke="#fff" stroke-linecap="round"/></mask>`);
        return `<path class="leg leg--transfer" d="${l.d}" mask="url(#mk${i})"/>`;
      }
      return `<path class="leg leg--${l.kind}" data-i="${i}" d="${l.d}"/>`;
    });
    const stops = MAP.stops
      .map((s) => `<g class="map-stop" data-id="${esc(s.id)}" data-o="${s.x} ${s.y}">
        <circle class="map-halo" cx="${s.x}" cy="${s.y}"/>
        <circle class="map-dot" cx="${s.x}" cy="${s.y}"/>
        <text class="map-label" x="${s.x}" y="${s.y}" dominant-baseline="central">${esc(timeOf[s.id] || '')}</text>
      </g>`)
      .join('');
    const ways = MAP.waypoints
      .map((w) => `<g class="map-stop" data-id="${esc(w.id)}" data-o="${w.x} ${w.y}"><circle class="map-dot map-dot--way" cx="${w.x}" cy="${w.y}"/></g>`)
      .join('');
    mapFig.innerHTML = `<svg viewBox="${vx} ${vy} ${vw} ${vh}" role="img" aria-label="Map of central Rome with the walking route and the time of each stop">
        <defs>${defs.join('')}</defs>
        <g mask="url(#mapFadeY)"><path class="map-river" d="${MAP.river}" mask="url(#mapFadeX)"/></g>
        ${legs.join('')}${ways}${stops}
      </svg>
      <figcaption class="label">Map data © OpenStreetMap contributors</figcaption>`;
  }

  // Sizes in the SVG are set per rendered width so lines, dots and labels keep a fixed
  // on-screen size (labels 12.5 px) whether the map is 250 px wide on a phone or sticky on desktop.
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
    set('.leg--walk', { 'stroke-width': 2.75 * u });
    set('.leg--night', { 'stroke-width': 2 * u });
    set('.leg--transfer', { 'stroke-width': 2 * u, 'stroke-dasharray': `${5 * u} ${5 * u}` });
    set('.leg-mask', { 'stroke-width': 10 * u });
    set('.map-dot', { r: 4.5 * u, 'stroke-width': 1.75 * u });
    set('.map-dot--way', { r: 3.2 * u, 'stroke-width': 2 * u });
    set('.map-halo', { r: 9.5 * u, 'stroke-width': 2 * u });
    set('.map-label', { 'font-size': 12.5 * u, 'stroke-width': 3.5 * u });
    placeLabels(svg, u);
  }

  // Greedy label placement: crowded dots first, eight candidate spots each, scored by overlap
  // with placed labels, other dots, the route and the frame edge.
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
    const stops = MAP.stops;
    const dots = stops.map((s) => [s.x - dotR * 1.6, s.y - dotR * 1.6, s.x + dotR * 1.6, s.y + dotR * 1.6]);
    const crowd = (s) => stops.filter((o) => o !== s && Math.hypot(o.x - s.x, o.y - s.y) < w * 1.6).length;
    const placed = [];
    [...stops].sort((a, b) => crowd(b) - crowd(a)).forEach((s) => {
      let best = null;
      cands.forEach(([dx, dy, anchor], ci) => {
        const b = box(s.x + dx, s.y + dy, anchor);
        let score = ci * 0.01 * w * h;
        for (const p of placed) score += overlap(b, p) * 50;
        dots.forEach((d, i) => { if (stops[i] !== s) score += overlap(b, d) * 30; });
        for (const [px, py] of ROUTE_PTS) if (px > b[0] && px < b[2] && py > b[1] && py < b[3]) score += w * h * 0.04;
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

  // Below 1280 px the map has its own section; from 1280 px it sits sticky beside the stops.
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
  // The --sky custom property (cards, river, bib holes, colour-mix tokens) restyles the whole
  // document, so it follows at most every 120 ms, when the colour has visibly moved, and once
  // more when scrolling settles.
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

  /* ------------------------------------------------------------------ */
  /* Split-flap                                                          */
  /* ------------------------------------------------------------------ */

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

  function boardTargets() {
    return $$('.board-row').map((row) =>
      $$('.cells', row).flatMap((cellsEl) => {
        const chars = [...cellsEl.dataset.text];
        return [...cellsEl.children].map((el, i) => ({ f: flapOf(el), ch: chars[i] || ' ' }));
      }));
  }
  function boardFinal() { boardTargets().flat().forEach(({ f, ch }) => setFlap(f, ch)); }
  function boardIntro(tl, start) {
    const D = 0.045;
    boardTargets().forEach((cells, ri) => {
      cells.forEach(({ f, ch }) => {
        setFlap(f, ' ');
        let at = start + ri * 0.12 + Math.random() * 0.05;
        const n = 3 + Math.floor(Math.random() * 4);
        for (let k = 0; k < n; k++) { addFlip(tl, f, GLYPHS[Math.floor(Math.random() * GLYPHS.length)], at, D); at += 2 * D; }
        addFlip(tl, f, ch, at, D);
      });
    });
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
  /* Scroll model: page position -> time of day, current stop, legs      */
  /* ------------------------------------------------------------------ */

  const stopsData = C.stops;
  const stopMin = stopsData.map((s) => toMin(s.time));
  const START = C.meta.startsAt.slice(11, 16);
  const START_MIN = toMin(START);
  const LAST_IDX = stopsData.length - 1;
  let stopEls = [];
  let anchors = [];
  let legMarks = [];
  let sectionMarks = [];
  let reduced = reduceMotion();
  let lastY = 0;
  let booted = false;
  let skyTrigger = null;

  function measure() {
    layoutMap();
    const mid = innerHeight / 2;
    const top = (el) => el.getBoundingClientRect().top + scrollY;
    anchors = [{ y: 0, t: START_MIN }];
    stopEls.forEach((el, i) => anchors.push({ y: Math.max(top(el) - mid, anchors[anchors.length - 1].y + 1), t: stopMin[i] }));
    legMarks = [];
    stopsData.forEach((s, i) => {
      // The connector shown for the active plan carries its metres in data-m (0 for rides).
      const w = $('.walk:not([hidden])', stopEls[i].parentElement);
      if (w && +w.dataset.m > 0) legMarks.push({ y: top(w) + w.offsetHeight - mid, m: +w.dataset.m });
      if (s.walk) legMarks.push({ y: anchors[i + 1].y, m: s.walk.m });
    });
    sectionMarks = $$('main > section')
      .filter((sec) => sec.offsetParent !== null)
      .map((sec) => ({ y: top(sec) - mid, id: sec.id, name: sec.dataset.hud || $('h2', sec).textContent }));
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
  let hudPlaceText = '', hudKmKey = '', hudLegs = -1, mapCurrent = null;

  function render(y) {
    lastY = y;
    let idx = -1;
    for (let i = 1; i < anchors.length; i++) if (y >= anchors[i].y) idx = i - 1;
    applySky(reduced ? (idx < 0 ? START_MIN : stopMin[idx]) : timeAt(y));

    let sec = null;
    for (const s of sectionMarks) if (y >= s.y) sec = s;
    const inDay = sec && sec.id === 'day' && idx >= 0;
    const s = idx >= 0 ? stopsData[idx] : null;
    setClock(idx >= 0 ? s.time : START, !reduced && hud.hasAttribute('data-on'));
    const v = s && root.dataset.plan === 'rain' && s.rain ? s.rain : s;
    const place = inDay ? (v === s ? s.hud || s.place || s.title : v.hud || v.place) : sec ? sec.name : '';
    if (place !== hudPlaceText) { hudPlaceText = place; hudPlace.textContent = place; }

    // Sticky desktop map: mark the current stop's dot.
    const cur = s && v === s ? $(`.map-stop[data-id="${s.id}"]`, mapFig) : null; // rain variants have no dot
    if (cur !== mapCurrent) { mapCurrent?.classList.remove('is-current'); cur?.classList.add('is-current'); mapCurrent = cur; }

    const m = legMarks.reduce((sum, l) => sum + (y >= l.y ? l.m : 0), 0);
    const sorted = idx === LAST_IDX;
    const key = `${m}|${sorted}`;
    if (key !== hudKmKey) {
      hudKmKey = key;
      const km = (m / 1000).toFixed(1);
      const cap = C.meta.walkCapKm;
      // Phones show "4.0 km"; from 480 px "4.0 / 10 km", and at the night walk "7.7 km · Sunday's sorted".
      hudKm.classList.toggle('is-sorted', sorted);
      hudKm.innerHTML = `<span aria-hidden="true">${km}<span class="km-cap"> / ${cap}</span> km${sorted ? '<span class="km-sorted"> · done</span>' : ''}</span><span class="sr-only">${km} of ${cap} km walked${sorted ? ", done" : ''}</span>`;
    }
    if (m !== hudLegs) {
      hudLegs = m;
      hud.style.setProperty('--legs', Math.min(1, m / (C.meta.walkCapKm * 1000)).toFixed(3));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Plan switch                                                         */
  /* ------------------------------------------------------------------ */

  // `anchor` (a stop) keeps its place on screen: rain variants above it change height, so the
  // page is shifted by the difference before measuring. If the stop's top is out of view, the
  // same instant shift puts it under the HUD; an animated scroll would pass over the following
  // stops and flash the HUD and sky through the evening. The sky scrub is then snapped.
  function setPlan(plan, save = true, anchor = null) {
    const before = anchor ? anchor.getBoundingClientRect().top : 0;
    root.dataset.plan = plan;
    $$('.stop').forEach((st) => {
      const rain = $('.variant--rain', st);
      if (!rain) return;
      $('.variant--sun', st).inert = plan === 'rain';
      rain.inert = plan !== 'rain';
    });
    $$('.walk[data-plan="sun"]').forEach((w) => { w.hidden = plan === 'rain'; });
    $$('.walk[data-plan="rain"]').forEach((w) => { w.hidden = plan !== 'rain'; });
    $$('.plan input').forEach((i) => { i.checked = i.value === plan; });
    const wet = $('[data-action="rain"]');
    if (wet) { wet.disabled = plan === 'rain'; wet.firstChild.textContent = plan === 'rain' ? 'Rain plan is on' : 'Switch to the rain plan'; }
    if (save) store.set('plan', plan);
    hudPlaceText = '';
    hudKmKey = '';
    if (!booted) return;
    if (anchor) {
      const gap = parseFloat(getComputedStyle(anchor).scrollMarginTop) || 0;
      const target = before < gap ? gap : before;
      const delta = anchor.getBoundingClientRect().top - target;
      if (Math.abs(delta) > 0.5) window.scrollBy({ top: delta, behavior: 'instant' });
    }
    lastY = scrollY;
    ScrollTrigger.refresh(); // heights and walking metres changed
    skyTrigger?.getTween()?.progress(1);
  }

  /* ------------------------------------------------------------------ */
  /* Time: countdown, "now"                                              */
  /* ------------------------------------------------------------------ */

  const romeFmt = new Intl.DateTimeFormat('en-CA', { timeZone: C.meta.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function romeNow() {
    const p = Object.fromEntries(romeFmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
  }
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  function countdownText(r) {
    if (r.date === C.meta.date) return "It's today.";
    if (r.date > C.meta.date) return 'That was Friday.';
    const mins = Math.max(0, Math.floor((new Date(C.meta.startsAt) - Date.now()) / 60000));
    const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
    const parts = d > 0 ? [[d, 'day'], [h, 'hour']] : h > 0 ? [[h, 'hour'], [m, 'minute']] : [[m, 'minute']];
    const shown = parts.filter(([n], i) => n > 0 || (i === 0 && parts.length === 1));
    return 'Starts in ' + shown.map(([n, w]) => plural(n, w)).join(', ');
  }
  const nowBtns = $$('.hud-now, .hero-now');
  let jumpIdx = -1;
  function tick() {
    const r = romeNow();
    slot('countdown').textContent = countdownText(r);
    const row = $('.countdown'), today = slot('hero-today'), isToday = r.date === C.meta.date;
    if (isToday && row.parentElement !== today) today.append(row);
    if (!isToday && row.parentElement === today) $('.hero-meta:not(.hero-today)').prepend(row);
    today.hidden = !isToday;
    let nowIdx = -1;
    jumpIdx = -1;
    if (r.date === C.meta.date) {
      stopMin.forEach((t, i) => { const end = i < LAST_IDX ? stopMin[i + 1] : 24 * 60; if (r.min >= t && r.min < end) nowIdx = i; });
      // Before the first stop, "now" means the first stop.
      jumpIdx = nowIdx >= 0 ? nowIdx : r.min < stopMin[0] ? 0 : -1;
    }
    stopEls.forEach((el, i) => el.classList.toggle('is-now', i === nowIdx));
    nowBtns.forEach((b) => { b.hidden = jumpIdx < 0; });
    hud.toggleAttribute('data-today', jumpIdx >= 0);
  }
  function jumpToNow() {
    const el = stopEls[jumpIdx];
    if (!el) return;
    el.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    const h = $('.variant:not([inert]) h3', el);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  }

  /* ------------------------------------------------------------------ */
  /* Weather                                                             */
  /* ------------------------------------------------------------------ */

  // Sky words come from daytime hourly codes; wet hours are named separately, so "rain" never repeats.
  const SKY_CAT = (c) => (c <= 1 ? 'sun' : c === 2 ? 'mixed' : c === 45 || c === 48 ? 'fog' : 'cloud');
  const SKY_WORDS = { sun: ['sunny', 'sun'], mixed: ['partly cloudy', 'sunny spells'], cloud: ['cloudy', 'cloud'], fog: ['foggy', 'fog'] };
  const WET_CAT = (c) => (c >= 95 ? 'storms' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'snow' : c >= 80 ? 'showers' : c >= 61 ? 'rain' : c >= 51 ? 'drizzle' : null);
  const modeOf = (arr) => { const n = {}; let best = null; for (const x of arr) { n[x] = (n[x] || 0) + 1; if (best === null || n[x] > n[best]) best = x; } return best; };
  const CLIMATE = 'Mid-October is usually 22° / 12°, with rain about one day in four.';

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
      sky = a === b ? SKY_WORDS[a][0] : `${SKY_WORDS[a][1]} then ${SKY_WORDS[b][1]}`;
    } else if (typeof d.weather_code?.[0] === 'number') sky = SKY_WORDS[SKY_CAT(d.weather_code[0])][0];
    let wetText = '';
    if (typeof prob === 'number') {
      const wet = [];
      for (let h = 7; h <= 23; h++) { const c = codeAt(h); if (c !== null && WET_CAT(c)) wet.push({ h, cat: WET_CAT(c) }); }
      if (wet.length) {
        const hs = wet.map((x) => x.h);
        const when = Math.min(...hs) >= 19 ? ' late' : Math.max(...hs) <= 12 ? ' early' : Math.min(...hs) >= 13 && Math.max(...hs) <= 18 ? ' in the afternoon' : '';
        wetText = `<span class="tnum">${Math.round(prob)}%</span> chance of ${modeOf(wet.map((x) => x.cat))}${when}`;
      } else wetText = `<span class="tnum">${Math.round(prob)}%</span> chance of rain`;
    }
    const html = [`Friday: <span class="tnum">${Math.round(hi)}° / ${Math.round(lo)}°</span>`, sky, wetText].filter(Boolean).join(', ');
    return { html, prob: typeof prob === 'number' ? prob : 0 };
  }

  async function loadWeather() {
    const el = slot('weather');
    const M = C.meta;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${M.lat}&longitude=${M.lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&hourly=precipitation_probability,weather_code&timezone=Europe%2FRome&start_date=${M.date}&end_date=${M.date}`;
    const show = (data) => {
      const w = describeWeather(data);
      if (!w) return false;
      let html = w.html;
      if (w.prob >= 50) html += `<span class="weather-wet"><span>Looks wet.</span><button class="btn" type="button" data-action="rain"><span>Switch to the rain plan</span></button></span>`;
      el.innerHTML = html;
      const btn = $('[data-action="rain"]', el);
      if (btn) {
        btn.addEventListener('click', () => {
          const hadFocus = document.activeElement === btn;
          setPlan('rain');
          if (hadFocus) $('.plan input[value="rain"]').focus({ preventScroll: true });
        });
        setPlan(root.dataset.plan, false);
      }
      return true;
    };
    const cached = store.get('wx', null);
    if (cached && Date.now() - cached.t < 3600e3 && show(cached.d)) return;
    el.textContent = CLIMATE;
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
  /* Motion                                                              */
  /* ------------------------------------------------------------------ */

  function setupMotion() {
    gsap.registerPlugin(ScrollTrigger, DrawSVGPlugin);
    const mm = gsap.matchMedia();

    mm.add({ motion: '(prefers-reduced-motion: no-preference)', still: '(prefers-reduced-motion: reduce)' }, (ctx) => {
      reduced = !ctx.conditions.motion;
      skyHex = '';
      skyTrigger = null;

      if (reduced) {
        boardFinal();
        ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => render(self.scroll()) });
        render(scrollY);
        return;
      }

      // Sky scrub: smoothed scroll position drives the time of day.
      const st = { y: scrollY };
      skyTrigger = gsap.fromTo(st, { y: 0 }, {
        y: () => ScrollTrigger.maxScroll(window),
        ease: 'none',
        onUpdate: () => render(st.y),
        scrollTrigger: { start: 0, end: 'max', scrub: 0.4, invalidateOnRefresh: true },
      }).scrollTrigger;
      render(scrollY);

      // Hero: the board flips in row by row, then the word and the lead.
      const intro = gsap.timeline();
      boardIntro(intro, 0.2);
      intro.from(['.hero-title', '.hero-date', '.hero-lead', '.hero-meta', '.hero-links'], {
        autoAlpha: 0, y: 18, duration: 0.8, ease: 'power3.out', stagger: 0.1, clearProps: 'transform,visibility,opacity',
      }, 0.75);

      // Map: the route draws itself, stop dots pop in day order.
      const svg = $('svg', mapFig);
      const legEl = (i) => $(MAP.legs[i].kind === 'transfer' ? `.leg-mask[data-i="${i}"]` : `.leg[data-i="${i}"]`, svg);
      const dot = Object.fromEntries($$('.map-stop', svg).map((g) => [g.dataset.id, g]));
      MAP.legs.forEach((_, i) => gsap.set(legEl(i), { drawSVG: '0%' }));
      Object.values(dot).forEach((g) => gsap.set(g, { scale: 0, autoAlpha: 0, svgOrigin: g.dataset.o }));
      const route = gsap.timeline({ paused: true });
      const raw = MAP.legs.map((l) => Math.sqrt(l.len));
      const k = 2.6 / raw.reduce((a, b) => a + b, 0);
      const shown = new Set();
      let at = 0;
      const pop = (id) => {
        if (shown.has(id) || !dot[id]) return;
        shown.add(id);
        route.to(dot[id], { scale: 1, autoAlpha: 1, duration: 0.35, ease: 'back.out(2.4)' }, at);
        at += 0.05;
      };
      MAP.legs.forEach((l, i) => {
        pop(l.from);
        const d = raw[i] * k;
        route.to(legEl(i), { drawSVG: '100%', duration: d, ease: 'power1.inOut' }, at);
        at += d;
        pop(l.to);
      });
      Object.keys(dot).forEach(pop); // any dot not on a leg
      ScrollTrigger.create({ trigger: svg, start: 'top 75%', once: true, onEnter: () => route.play() });

      // Photos: clip reveal from the bottom, slight settle in scale. Once.
      const photos = $$('.variant .photo');
      gsap.set(photos, { clipPath: 'inset(100% 0% 0% 0%)' });
      const revealImgs = photos.map((p) => $('img', p)).filter(Boolean);
      if (revealImgs.length) gsap.set(revealImgs, { scale: 1.06 });
      ScrollTrigger.batch(photos, {
        start: 'top 92%',
        once: true,
        onEnter: (els) => {
          gsap.to(els, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.1, ease: 'power3.out', stagger: 0.08 });
          const imgs = els.map((e) => $('img', e)).filter(Boolean);
          if (imgs.length) gsap.to(imgs, { scale: 1, duration: 1.4, ease: 'power3.out', stagger: 0.08 });
        },
      });

      // Walk connectors draw as you pass them.
      $$('.walk').forEach((w) => {
        gsap.fromTo($('.walk-line', w), { clipPath: 'inset(0% 0% 100% 0%)' }, {
          clipPath: 'inset(0% 0% 0% 0%)', ease: 'none',
          scrollTrigger: { trigger: w, start: 'top 92%', end: 'bottom 62%', scrub: 0.3 },
        });
      });
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

  renderHero();
  renderSections();
  renderMap();
  renderStops();
  placeMap();
  stopEls = $$('.stop');

  setPlan(store.get('plan', 'sun') === 'rain' ? 'rain' : 'sun', false);
  $$('.plan input').forEach((i) => i.addEventListener('change', () => setPlan(i.value)));
  // Inline switches on the stops themselves: swap, then bring the stop's top into view.
  slot('stops').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-set-plan]');
    if (!btn) return;
    const stop = btn.closest('.stop');
    setPlan(btn.dataset.setPlan, true, stop);
    const h = $('.variant:not([inert]) h3', stop);
    if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  });
  $$('.checklist input').forEach((i) => i.addEventListener('change', () => store.set('book:' + i.dataset.id, i.checked)));
  nowBtns.forEach((b) => b.addEventListener('click', jumpToNow));
  wideMQ.addEventListener('change', () => { placeMap(); ScrollTrigger.refresh(); });

  measure();
  setupMotion();
  booted = true;
  tick();
  setTimeout(() => { tick(); setInterval(tick, 60000); }, 60000 - (Date.now() % 60000) + 50);
  loadWeather();

  $$('details').forEach((d) => d.addEventListener('toggle', () => ScrollTrigger.refresh()));
  if (document.fonts) document.fonts.ready.then(() => ScrollTrigger.refresh());
  if (location.hash.length > 1) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) requestAnimationFrame(() => target.scrollIntoView());
  }
})();
