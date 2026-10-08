/* Venerdì day builder: turns a set of picked option ids into a loose, relaxed plan.
   Pure and deterministic; all copy comes from content.json. Loads in the page and in Node. */
(function (root) {
  'use strict';

  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
  const fmt = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  const round30 = (min) => Math.round(min / 30) * 30;
  // Great-circle distance in metres.
  function haversine(a, b) {
    const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const BUFFER = 15;                   // relaxed buffer added to every daytime stay
  const NOON = toMin('12:00');         // nothing that starts after this is "morning"
  const LUNCH_FROM = toMin('12:30');   // the plain lunch line, and the earliest afternoon-slot stop
  const LUNCH_MINUTES = 45;            // the plain "lunch wherever we are" stop
  const SUNSET_START = toMin('17:45');
  const AFTERNOON_END = toMin('17:30');
  const FREE_GAP = 90;                 // idle minutes that earn the quiet free-time line
  const FIXED_EARLY = 10;              // be there this long before a fixed-time thing...
  const FIXED_LATEST = 5;              // ...and no later than this

  const isEvening = (o) => o.slot === 'sunset' || o.slot === 'predinner';
  // Evening fixtures are timed to the light and to dinner, so they carry no relaxed buffer.
  const stay = (o) => o.minutes + (isEvening(o) ? 0 : BUFFER);
  const isOrdinary = (o) => !['sunset', 'lunch', 'fixed', 'predinner'].includes(o.slot);

  function makeTransfer(C, a, b) {
    const U = C.ui;
    if (a.area === b.area) {
      const m = Math.round(haversine(a, b) * 1.3);
      const min = Math.max(1, Math.round(m / 75));
      return { text: fmt(U.walk, { min }), m, min };
    }
    const e = (C.transfers || []).find((t) => t.from === a.area && t.to === b.area);
    if (e) return { text: e.text, m: e.m, min: e.min };
    const d = haversine(a, b);
    if (d < 1500) { const min = Math.max(1, Math.round(d / 75)); return { text: fmt(U.walk, { min }), m: Math.round(d), min }; }
    const min = Math.max(10, Math.round((5 + d / 333) / 5) * 5); // a cab at city speed, plus finding one
    return { text: fmt(U.taxi, { min }), m: 0, min };
  }

  // Why something did not fit: a machine code plus values (for the board) and an English line (for Details).
  function dropOf(C, option, code, vars = {}) {
    const R = C.ui.reasons;
    const english = { closes: R.closes, closedGap: R.closedGap, sunsetTaken: R.sunsetTaken, lunchTaken: R.lunchTaken, noTimeSunset: R.noTimeSunset, noTimeDinner: R.noTimeDinner, fixedMissed: R.fixedMissed };
    const boardCode = ['noTimeSunset', 'noTimeDinner', 'fixedMissed'].includes(code) ? 'noTime' : code;
    return { option, code: boardCode, vars, reason: fmt(english[code] || '', vars) };
  }

  // One pass over the ordered picks. Lunch is placed by the clock, not by `order`: before the first
  // stop that would start at noon or later, and always before afternoon-slot stops and the sunset.
  // Fixed-time things (the noon cannon) go in before anything that would make us miss them, lunch
  // included. Pre-dinner things go last, as late as they can before dinner.
  function schedule(C, seq, lunches, fixed, predinner) {
    const start = toMin(C.meta.startsAt.slice(11, 16));
    const dinner = C.anchors.dinner;
    const out = [], drops = [];
    const fixedQ = [...fixed].sort((a, b) => toMin(a.at) - toMin(b.at));
    let clock = start, prev = null, lunchDone = false;

    // When we would arrive at `o` from where we are now (travel, opening time, midday closure).
    function arrival(o, from = prev) {
      const t = from ? makeTransfer(C, from, o) : null;
      let arrive = clock + (t ? t.min : 0);
      if (o.slot === 'sunset') arrive = Math.max(arrive, SUNSET_START);
      if (o.slot === 'afternoon') arrive = Math.max(arrive, LUNCH_FROM);
      if (o.slot === 'fixed') {
        const at = toMin(o.at);
        arrive = Math.max(arrive, at - FIXED_EARLY);
        if (arrive > at - FIXED_LATEST) return { t, arrive, start: at, code: 'fixedMissed', vars: { time: o.at } };
        return { t, arrive, start: at };
      }
      if (o.open && arrive < toMin(o.open)) arrive = toMin(o.open);
      // `close` is the latest useful arrival (last entry, desk or gate), so the checks use arrival time.
      if (o.closedFrom && o.closedTo) {
        const from2 = toMin(o.closedFrom), to = toMin(o.closedTo);
        if (arrive >= from2 && arrive < to) {
          if (!o.close || to <= toMin(o.close)) arrive = to;
          else return { t, arrive, start: arrive, code: 'closedGap', vars: { from: o.closedFrom, to: o.closedTo } };
        }
      }
      // A late sunset is fixed by trimming the afternoon (see the overflow loop), never by dropping it.
      if (o.close && arrive > toMin(o.close) && o.slot !== 'sunset') return { t, arrive, start: arrive, code: 'closes', vars: { time: o.close } };
      return { t, arrive, start: arrive };
    }
    function place(o, a) {
      out.push({ kind: 'option', option: o, start: a.start, end: a.start + stay(o), transfer: a.t });
      clock = a.start + stay(o);
      prev = o;
    }
    // Would something ending at `end` at place `loc` make the next fixed-time thing unreachable?
    function missesFixed(end, loc) {
      const F = fixedQ[0];
      if (!F) return false;
      const t = loc ? makeTransfer(C, loc, F) : null;
      return end + (t ? t.min : 0) > toMin(F.at) - FIXED_LATEST;
    }
    function placeFixed() {
      const F = fixedQ.shift();
      const a = arrival(F);
      if (a.code) drops.push(dropOf(C, F, a.code, a.vars));
      else place(F, a);
    }
    // The lunch that would be placed right now: the first lunch pick that is still open, else the plain line.
    function lunchPreview() {
      for (const L of lunches) { const a = arrival(L); if (!a.code) return { end: a.start + stay(L), loc: L }; }
      return { end: Math.max(clock, LUNCH_FROM) + LUNCH_MINUTES, loc: prev };
    }
    function placeLunch() {
      while (fixedQ.length) { const p = lunchPreview(); if (!missesFixed(p.end, p.loc)) break; placeFixed(); }
      lunchDone = true;
      for (let i = 0; i < lunches.length; i++) {
        const a = arrival(lunches[i]);
        if (a.code) { drops.push(dropOf(C, lunches[i], a.code, a.vars)); continue; }
        place(lunches[i], a);
        lunches.slice(i + 1).forEach((o) => drops.push(dropOf(C, o, 'lunchTaken')));
        return;
      }
      const at = Math.max(clock, LUNCH_FROM);
      out.push({ kind: 'lunch-filler', start: at, end: at + LUNCH_MINUTES, transfer: null });
      clock = at + LUNCH_MINUTES;
    }

    for (const o of seq) {
      // A fixed-time thing goes first if this stop would make us miss it.
      while (fixedQ.length) { const a = arrival(o); if (a.code || !missesFixed(a.start + stay(o), o)) break; placeFixed(); }
      // Compared on the rounded time, so a stop shown under Morning never reads "around 12:00".
      if (!lunchDone && (o.slot === 'sunset' || o.slot === 'afternoon' || round30(arrival(o).start) >= NOON)) placeLunch();
      const a = arrival(o);
      if (a.code) { drops.push(dropOf(C, o, a.code, a.vars)); continue; }
      place(o, a);
    }
    while (fixedQ.length) placeFixed();
    if (!lunchDone) placeLunch();
    // Pre-dinner things: last, and as late as they can be before dinner.
    for (const o of predinner) {
      const a = arrival(o);
      if (a.code) { drops.push(dropOf(C, o, a.code, a.vars)); continue; }
      const toDinner = makeTransfer(C, o, dinner);
      a.start = Math.max(a.start, toMin(dinner.time) - toDinner.min - o.minutes);
      place(o, a);
    }

    const tDinner = prev ? makeTransfer(C, prev, dinner) : null;
    const lastPlain = [...out].reverse().find((x) => x.kind === 'option' && isOrdinary(x.option));
    const sunsetItem = out.find((x) => x.kind === 'option' && x.option.slot === 'sunset');
    const predItem = [...out].reverse().find((x) => x.kind === 'option' && x.option.slot === 'predinner');
    let overflow = null;
    if (sunsetItem && lastPlain && lastPlain.end > AFTERNOON_END) overflow = { code: 'noTimeSunset', victim: lastPlain.option };
    else if (clock + (tDinner ? tDinner.min : 0) > toMin(dinner.time)) {
      const code = sunsetItem ? 'noTimeSunset' : 'noTimeDinner';
      // Dropping daytime stops cannot help an evening that already starts at the sunset floor.
      if (predItem) overflow = { code: 'noTimeDinner', victim: predItem.option };
      else if (sunsetItem && sunsetItem.start <= SUNSET_START) overflow = { code: 'noTimeDinner', victim: sunsetItem.option };
      else if (lastPlain) overflow = { code, victim: lastPlain.option };
      else if (sunsetItem) overflow = { code: 'noTimeDinner', victim: sunsetItem.option };
    }
    return { out, drops, overflow, tDinner };
  }

  function build(C, pickIds) {
    const picked = C.options.filter((o) => pickIds.includes(o.id)).sort((a, b) => a.order - b.order);
    const didntFit = [];

    // One sunset-slot thing: the earliest in the loop wins (the Vittoriano).
    const sunsets = picked.filter((o) => o.slot === 'sunset');
    const sunset = sunsets[0] || null;
    sunsets.slice(1).forEach((o) => didntFit.push(dropOf(C, o, 'sunsetTaken')));
    // Lunch picks in order of preference: the longest sit-down lunch first.
    const lunches = picked.filter((o) => o.slot === 'lunch').sort((a, b) => b.minutes - a.minutes || a.order - b.order);
    const fixed = picked.filter((o) => o.slot === 'fixed');
    const predinner = picked.filter((o) => o.slot === 'predinner');

    let seq = picked.filter(isOrdinary);
    if (sunset) seq.push(sunset);
    let pre = [...predinner];

    let res = schedule(C, seq, lunches, fixed, pre);
    for (let guard = 0; guard < 60 && res.overflow; guard++) {
      // Too long: drop the stop that makes it too long, then try again.
      const { victim, code } = res.overflow;
      didntFit.push(dropOf(C, victim, code));
      seq = seq.filter((o) => o !== victim);
      pre = pre.filter((o) => o !== victim);
      res = schedule(C, seq, lunches, fixed, pre);
    }
    res.drops.forEach((d) => { if (!didntFit.some((x) => x.option === d.option)) didntFit.push(d); });
    didntFit.sort((a, b) => a.option.order - b.option.order);

    // Display list: arrival, the stops (with transfers and one quiet free-time line), dinner, end.
    const A = C.anchors;
    const items = [{ kind: 'anchor', id: 'arrival', anchor: A.arrival, start: toMin(A.arrival.time), slot: 'morning', exact: true }];
    let lastEnd = toMin(C.meta.startsAt.slice(11, 16));
    let lunchSeen = false, freeShown = false;
    // Idle time (after travel) of 90+ minutes earns the quiet free-time line, once a day, before the connector.
    const pushStop = (entry, transfer) => {
      if (!freeShown && entry.start - (lastEnd + (transfer ? transfer.min : 0)) >= FREE_GAP) { items.push({ kind: 'free' }); freeShown = true; }
      if (transfer) items.push({ kind: 'transfer', transfer });
      items.push(entry);
    };
    for (const x of res.out) {
      const o = x.option;
      const isLunch = x.kind === 'lunch-filler' || o.slot === 'lunch';
      const slot = isLunch ? 'lunch'
        : o.slot === 'sunset' ? 'sunset'
        : o.slot === 'predinner' ? 'evening'
        : o.slot === 'fixed' && !lunchSeen && x.start >= NOON ? 'lunch'
        : lunchSeen ? 'afternoon' : 'morning';
      if (isLunch) lunchSeen = true;
      const entry = x.kind === 'lunch-filler'
        ? { kind: 'lunch-filler', start: x.start, end: x.end, slot }
        : { kind: 'option', id: o.id, option: o, start: x.start, end: x.end, slot, exact: o.slot === 'fixed' };
      pushStop(entry, x.transfer);
      lastEnd = x.end;
    }
    const dinnerStart = toMin(A.dinner.time);
    pushStop({ kind: 'anchor', id: 'dinner', anchor: A.dinner, start: dinnerStart, slot: 'evening', exact: true }, res.tDinner);
    items.push({ kind: 'anchor', id: 'end', anchor: A.end, start: toMin(A.end.time), slot: 'evening', exact: true });
    items.forEach((it) => {
      if (!('start' in it)) return;
      it.rough = it.kind === 'anchor' ? it.anchor.time : it.exact ? hhmm(it.start) : hhmm(round30(it.start));
    });

    // Two pastry stops in one morning: the later one is second breakfast.
    const pastries = (C.departures?.breakfasts || []);
    const placedPastries = items.filter((it) => it.kind === 'option' && pastries.includes(it.id));
    if (placedPastries.length >= 2) placedPastries.slice(1).forEach((it) => { it.secondBreakfast = true; });

    const options = res.out.filter((x) => x.kind === 'option').map((x) => x.option);
    const walkM = res.out.reduce((s, x) => s + (x.transfer ? x.transfer.m : 0), 0) + (res.tDinner ? res.tDinner.m : 0);
    return { items, options, didntFit, walkM, picked, dinnerTransfer: res.tDinner };
  }

  root.VenerdiPlan = { build, toMin, hhmm, fmt, haversine };
})(typeof window !== 'undefined' ? window : globalThis);
