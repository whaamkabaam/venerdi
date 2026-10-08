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

  const BUFFER = 15;            // relaxed buffer added to every stay
  const LUNCH_FROM = toMin('12:30');
  const LUNCH_MINUTES = 45;     // the plain "lunch wherever we are" stop
  const SUNSET_START = toMin('17:45');
  const AFTERNOON_END = toMin('17:30');
  const FREE_GAP = 90;          // idle minutes that earn the quiet free-time line

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

  // One pass over the ordered picks. Returns the timeline plus items that could not be fitted.
  function schedule(C, seq) {
    const R = C.ui.reasons;
    const start = toMin(C.meta.startsAt.slice(11, 16));
    const dinner = C.anchors.dinner;
    const hasLunch = seq.some((o) => o.slot === 'lunch');
    const out = [], drops = [];
    let clock = start, prev = null, lunchDone = hasLunch;

    const lunchFiller = () => {
      const at = Math.max(clock, LUNCH_FROM);
      out.push({ kind: 'lunch-filler', start: at, end: at + LUNCH_MINUTES, transfer: null });
      clock = at + LUNCH_MINUTES;
      lunchDone = true;
    };

    for (const o of seq) {
      const isSunset = o.slot === 'sunset';
      if (!lunchDone && (isSunset || clock >= LUNCH_FROM)) lunchFiller();
      const t = prev ? makeTransfer(C, prev, o) : null;
      let arrive = clock + (t ? t.min : 0);
      if (isSunset) arrive = Math.max(arrive, SUNSET_START);
      if (o.open && arrive < toMin(o.open)) arrive = toMin(o.open);
      // `close` is the latest useful arrival (last entry, desk or gate), so the checks use arrival time.
      if (o.closedFrom && o.closedTo) {
        const from = toMin(o.closedFrom), to = toMin(o.closedTo);
        if (arrive >= from && arrive < to) {
          if (!o.close || to <= toMin(o.close)) arrive = to;
          else { drops.push({ option: o, reason: fmt(R.closedGap, { from: o.closedFrom, to: o.closedTo }) }); continue; }
        }
      }
      // A late sunset is fixed by trimming the afternoon (see the overflow loop), never by dropping it.
      if (o.close && arrive > toMin(o.close) && !isSunset) {
        drops.push({ option: o, reason: fmt(R.closes, { time: o.close }) });
        continue;
      }
      out.push({ kind: 'option', option: o, start: arrive, end: arrive + o.minutes + BUFFER, transfer: t });
      clock = arrive + o.minutes + BUFFER;
      prev = o;
    }
    if (!lunchDone) lunchFiller();

    const tDinner = prev ? makeTransfer(C, prev, dinner) : null;
    const lastPlain = [...out].reverse().find((x) => x.kind === 'option' && x.option.slot !== 'sunset');
    const sunsetPicked = out.some((x) => x.kind === 'option' && x.option.slot === 'sunset');
    let overflow = null;
    if (sunsetPicked && lastPlain && lastPlain.end > AFTERNOON_END) overflow = 'sunset';
    else if (clock + (tDinner ? tDinner.min : 0) > toMin(dinner.time)) overflow = sunsetPicked ? 'sunset' : 'dinner';
    return { out, drops, overflow, tDinner, lastPlain };
  }

  function build(C, pickIds) {
    const R = C.ui.reasons;
    const picked = C.options.filter((o) => pickIds.includes(o.id)).sort((a, b) => a.order - b.order);
    const didntFit = [];

    // One sunset: the earliest in the loop wins (the Vittoriano).
    const sunsets = picked.filter((o) => o.slot === 'sunset');
    const sunset = sunsets[0] || null;
    sunsets.slice(1).forEach((o) => didntFit.push({ option: o, reason: R.sunsetTaken }));
    // One lunch: the longer sit-down lunch wins (the market).
    const lunches = picked.filter((o) => o.slot === 'lunch');
    const lunchQueue = [...lunches].sort((a, b) => b.minutes - a.minutes || a.order - b.order);
    const lunch = lunchQueue.shift() || null;
    lunchQueue.forEach((o) => didntFit.push({ option: o, reason: R.lunchTaken }));

    let seq = picked.filter((o) => o.slot !== 'sunset' && (o.slot !== 'lunch' || o === lunch));
    if (sunset) seq.push(sunset);

    let res = schedule(C, seq);
    for (let guard = 0; guard < 40; guard++) {
      // A lunch stop that could not open in time is replaced by the plain lunch line.
      // If it was the preferred one, the next lunch pick gets its chance.
      const lostLunch = res.drops.find((d) => d.option.slot === 'lunch');
      if (lostLunch && seq.includes(lostLunch.option)) {
        didntFit.push(lostLunch);
        seq = seq.filter((o) => o !== lostLunch.option);
        const next = lunchQueue.shift();
        if (next) {
          didntFit.splice(didntFit.findIndex((d) => d.option === next), 1);
          seq = [...seq, next].sort((a, b) => (a.slot === 'sunset') - (b.slot === 'sunset') || a.order - b.order);
        }
        res = schedule(C, seq);
        continue;
      }
      if (!res.overflow) break;
      // Too long: drop the latest afternoon item and try again.
      const victim = res.lastPlain ? res.lastPlain.option : null;
      if (!victim) break;
      didntFit.push({ option: victim, reason: res.overflow === 'sunset' ? R.noTimeSunset : R.noTimeDinner });
      seq = seq.filter((o) => o !== victim);
      res = schedule(C, seq);
    }
    res.drops.forEach((d) => { if (!didntFit.some((x) => x.option === d.option)) didntFit.push(d); });
    didntFit.sort((a, b) => a.option.order - b.option.order);

    // Display list: arrival, the stops (with transfers and quiet free-time lines), dinner, end.
    const A = C.anchors;
    const items = [{ kind: 'anchor', id: 'arrival', anchor: A.arrival, start: toMin(A.arrival.time), slot: 'morning', exact: true }];
    let lastEnd = toMin(C.meta.startsAt.slice(11, 16));
    let lunchSeen = false;
    // Idle time (after travel) of 90+ minutes earns one quiet free-time line, before the connector.
    const pushStop = (entry, transfer) => {
      if (entry.start - (lastEnd + (transfer ? transfer.min : 0)) >= FREE_GAP) items.push({ kind: 'free' });
      if (transfer) items.push({ kind: 'transfer', transfer });
      items.push(entry);
    };
    for (const x of res.out) {
      const isLunch = x.kind === 'lunch-filler' || x.option.slot === 'lunch';
      const isSunset = x.kind === 'option' && x.option.slot === 'sunset';
      const slot = isLunch ? 'lunch' : isSunset ? 'sunset' : lunchSeen ? 'afternoon' : 'morning';
      if (isLunch) lunchSeen = true;
      const entry = x.kind === 'lunch-filler'
        ? { kind: 'lunch-filler', start: x.start, slot }
        : { kind: 'option', id: x.option.id, option: x.option, start: x.start, slot };
      pushStop(entry, x.transfer);
      lastEnd = x.end;
    }
    const dinnerStart = toMin(A.dinner.time);
    pushStop({ kind: 'anchor', id: 'dinner', anchor: A.dinner, start: dinnerStart, slot: 'evening', exact: true }, res.tDinner);
    items.push({ kind: 'anchor', id: 'end', anchor: A.end, start: toMin(A.end.time), slot: 'evening', exact: true });
    items.forEach((it) => { if ('start' in it) it.rough = it.exact ? it.anchor.time : hhmm(round30(it.start)); });

    const options = res.out.filter((x) => x.kind === 'option').map((x) => x.option);
    const walkM = res.out.reduce((s, x) => s + (x.transfer ? x.transfer.m : 0), 0) + (res.tDinner ? res.tDinner.m : 0);
    return { items, options, didntFit, walkM, picked };
  }

  root.VenerdiPlan = { build, toMin, hhmm, fmt, haversine };
})(typeof window !== 'undefined' ? window : globalThis);
