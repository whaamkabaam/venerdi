/* Venerdì day builder: turns picked option ids into a loose, relaxed plan, and her four answers (plus
   anything she asked for by name) into picks.
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
  const MORNING_BY = toMin('11:00');   // a stop opening before this could fill an empty morning
  const LATE_GAP = 180;                // a day over this long before dinner moves its last stop...
  const LATE_END = 75;                 // ...so it ends this long before dinner, in the late light

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
    // A listed transfer with no walking in it is a taxi ride.
    const e = (C.transfers || []).find((t) => t.from === a.area && t.to === b.area);
    if (e) return { text: e.text, m: e.m, min: e.min, taxi: e.m === 0 };
    const d = haversine(a, b);
    if (d < 1500) { const min = Math.max(1, Math.round(d / 75)); return { text: fmt(U.walk, { min }), m: Math.round(d), min }; }
    const min = Math.max(10, Math.round((5 + d / 333) / 5) * 5); // a cab at city speed, plus finding one
    return { text: fmt(U.taxi, { min }), m: 0, min, taxi: true };
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
  // included. Pre-dinner things go last, as late as they can before dinner. `lunchBefore`, when set,
  // puts lunch right before that stop whatever the clock says (build's lunch repair uses it).
  function schedule(C, seq, lunches, fixed, predinner, lunchBefore = null) {
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
      if (!lunchDone && (o === lunchBefore || o.slot === 'sunset' || o.slot === 'afternoon' || round30(arrival(o).start) >= NOON)) placeLunch();
      const a = arrival(o);
      if (a.code) { drops.push(dropOf(C, o, a.code, a.vars)); continue; }
      place(o, a);
    }
    while (fixedQ.length) placeFixed();
    if (!lunchDone) placeLunch();
    // Late light: a day that would be over three hours before dinner moves its last stop (one with
    // no close before 17:45) into the late afternoon, so the free time falls after lunch instead.
    const last = out[out.length - 1];
    if (!predinner.length && last && last.kind === 'option' && isOrdinary(last.option) && last.option.slot !== 'morning') {
      const o = last.option;
      const toDinner = makeTransfer(C, o, dinner).min;
      if (clock + toDinner < toMin(dinner.time) - LATE_GAP && (!o.close || toMin(o.close) >= SUNSET_START)) {
        const late = Math.min(toMin(dinner.time) - LATE_END - stay(o), o.close ? toMin(o.close) : Infinity);
        if (late > last.start) { last.start = late; last.end = late + stay(o); clock = last.end; }
      }
    }
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

    const seq = picked.filter(isOrdinary);
    if (sunset) seq.push(sunset);

    // One full pass over a sequence: schedule it, then drop the stop that makes the day too long
    // until it fits. Returns what was dropped and the minutes spent getting from place to place.
    function run(order, lunchBefore = null) {
      let s = [...order], pre = [...predinner];
      const victims = [];
      let res = schedule(C, s, lunches, fixed, pre, lunchBefore);
      for (let guard = 0; guard < 60 && res.overflow; guard++) {
        const { victim, code } = res.overflow;
        victims.push(dropOf(C, victim, code));
        s = s.filter((o) => o !== victim);
        pre = pre.filter((o) => o !== victim);
        res = schedule(C, s, lunches, fixed, pre, lunchBefore);
      }
      const dropped = [...victims, ...res.drops].map((d) => d.option);
      const ride = res.out.reduce((m, x) => m + (x.transfer ? x.transfer.min : 0), 0) + (res.tDinner ? res.tDinner.min : 0);
      return { order, lunchBefore, res, victims, dropped, ride };
    }
    // A variant is better when it saves `rescued` without dropping anything new, and rides least.
    const better = (r, cur, pick, rescued) => !r.dropped.includes(rescued) && !r.dropped.some((o) => !cur.dropped.includes(o)) && (!pick || r.ride < pick.ride);
    const timing = (d) => d.code === 'closes' || d.code === 'closedGap';
    // Repair: `order` gives the loop, but a stop dropped for its hours (closed by the time we get
    // there, or shut over lunch) may fit earlier. Try it at each earlier place in the sequence and
    // keep the variant that drops nothing new and rides least (ties: the smallest move).
    let best = run(seq);
    const tried = new Set();
    for (let guard = 0; guard < 8; guard++) {
      const d = best.res.drops.find((x) => timing(x) && best.order.includes(x.option) && !tried.has(x.option));
      if (!d) break;
      tried.add(d.option);
      const i = best.order.indexOf(d.option);
      let pick = null;
      for (let j = i - 1; j >= 0; j--) {
        const order = [...best.order];
        order.splice(i, 1);
        order.splice(j, 0, d.option);
        const r = run(order, best.lunchBefore);
        if (better(r, best, pick, d.option)) pick = r;
      }
      if (pick) best = pick;
    }
    // Lunch repair: lunch goes in by the clock, so a sit-down lunch (or the class) can be closed by
    // the time the morning is done. Try lunch before each stop instead.
    const lunchLost = best.res.drops.find((x) => timing(x) && lunches.includes(x.option));
    if (lunchLost) {
      let pick = null;
      for (const o of best.order) { const r = run(best.order, o); if (better(r, best, pick, lunchLost.option)) pick = r; }
      if (pick) best = pick;
    }
    // Morning repair: if the first stop starts at noon or later while a stop that opens before
    // 11:00 waits for the afternoon, try that stop first.
    const firstStart = (r) => (r.res.out.length ? r.res.out[0].start : Infinity);
    if (firstStart(best) >= NOON) {
      let pick = null;
      for (const o of best.order) {
        if (o === best.order[0] || !isOrdinary(o) || (o.open && toMin(o.open) >= MORNING_BY)) continue;
        const r = run([o, ...best.order.filter((x) => x !== o)], best.lunchBefore);
        if (firstStart(r) < NOON && better(r, best, pick, null)) pick = r;
      }
      if (pick) best = pick;
    }
    const res = best.res;
    didntFit.push(...best.victims);
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
      // A fixed-time stop before lunch (the noon cannon) is filed under Morning.
      const slot = isLunch ? 'lunch'
        : o.slot === 'sunset' ? 'sunset'
        : o.slot === 'predinner' ? 'evening'
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
    const taxis = res.out.filter((x) => x.transfer && x.transfer.taxi).length + (res.tDinner && res.tDinner.taxi ? 1 : 0);
    return { items, options, didntFit, walkM, taxis, picked, dinnerTransfer: res.tDinner };
  }

  /* Composer: her four answers become an ordered list of picks, each carrying the answer it came
     from. Options say what they serve (`serves`: reason -> rank, lower is better) and how much of
     the day they take (`weight`). build() stays the scheduler and the judge of what fits. */

  const BUDGET = 4;          // weights of a relaxed day: a main thing 1, a small thing 0.5, food 0
  const ROOM_BUDGET = 5;     // "Room for one more?" may take the day this far
  const TRIES = 6;           // candidates tried for one answer before it goes to extras
  const FILL_BELOW = 3;      // a composed day with fewer stops than this gets my default-day picks too
  const NEAR_M = 800;        // a small thing this close to a stop is on the way
  const HOME = 'pantheon';   // where distances start from when nothing is picked yet
  const STEP_ORDER = ['see', 'wander', 'wild', 'eat']; // the order the board fills in
  const FOOD_FIRST = ['class', 'pastry', 'lunch', 'street']; // the order food answers are composed in

  const byIdCache = new WeakMap();
  const optionsById = (C) => {
    let m = byIdCache.get(C);
    if (!m) { m = Object.fromEntries(C.options.map((o) => [o.id, o])); byIdCache.set(C, m); }
    return m;
  };
  // `wander` covers every wander:<area> key, so the area cards can swap with each other.
  const servesKey = (o, reason) => Object.keys(o.serves || {}).find((k) => (reason === 'wander' ? k.startsWith('wander:') : k === reason));
  const rankFor = (o, reason) => { const k = servesKey(o, reason); return k ? o.serves[k] : null; };
  // An option's own best answer (what ADDED and Felix's picks swap within).
  const bestReason = (o) => {
    const [k] = Object.entries(o.serves || {}).sort((a, b) => a[1] - b[1])[0] || [];
    return k && k.startsWith('wander:') ? 'wander' : k || null;
  };
  const weightOf = (C, ids) => { const O = optionsById(C); return ids.reduce((s, id) => s + (O[id]?.weight || 0), 0); };
  const dropsOf = (C, ids) => build(C, ids).didntFit.map((d) => d.option.id);
  // Nothing in `after` that was not already in `before`.
  const noNewDrops = (before, after) => after.every((id) => before.includes(id));
  // A morning left empty although a stop that could go in the morning (it opens before 11:00 and is
  // not a fixed-time, sunset, lunch or afternoon one) waits for later: build's morning repair could
  // not move it, so it does not fit there.
  const morningStop = (o) => isOrdinary(o) && o.slot !== 'afternoon' && o.open && toMin(o.open) < MORNING_BY;
  const lostMorning = (r) => {
    const stops = r.items.filter((it) => it.kind === 'option' || it.kind === 'lunch-filler');
    return stops.length > 0 && stops[0].start >= NOON && stops.some((it) => it.kind === 'option' && morningStop(it.option));
  };
  // The composer's test for a day: nothing dropped, rides and walking within content.meta's caps,
  // and no wasted morning.
  const easyDay = (C, ids) => {
    const r = build(C, ids);
    return !r.didntFit.length && r.taxis <= (C.meta.maxTaxis ?? 3) && r.walkM <= (C.meta.walkCapKm || 10) * 1000 && !lostMorning(r);
  };

  // score = rank * 10 + km to the reference place * 6, plus 1000 for a second sunset or lunch.
  // Pastries measure from the morning end of the loop; lunch and street food from its middle.
  function scoreOf(C, o, reason, others) {
    const O = optionsById(C);
    const placed = others.map((id) => O[id]).filter((p) => p && typeof p.lat === 'number');
    let refs = placed;
    if (!placed.length) refs = [O[HOME]];
    else if (reason === 'pastry' || reason === 'lunch' || reason === 'street') {
      const byOrder = [...placed].sort((a, b) => a.order - b.order);
      refs = [reason === 'pastry' ? byOrder[0] : byOrder[Math.floor((byOrder.length - 1) / 2)]];
    }
    const km = Math.min(...refs.map((p) => haversine(o, p))) / 1000;
    let s = (rankFor(o, reason) ?? 99) * 10 + km * 6;
    if (o.slot === 'sunset' && placed.some((p) => p.slot === 'sunset')) s += 1000;
    if (o.slot === 'lunch' && placed.some((p) => p.slot === 'lunch')) s += 1000;
    return s;
  }
  // Every option serving a reason that is not on the day yet, best first.
  function ranked(C, reason, taken, others, keep = () => true) {
    return C.options
      .filter((o) => !taken.includes(o.id) && rankFor(o, reason) !== null && keep(o))
      .map((o) => ({ o, s: scoreOf(C, o, reason, others) }))
      .sort((a, b) => a.s - b.s || a.o.order - b.o.order)
      .map((x) => x.o);
  }

  // A thing she asked for by name (answers.want) belongs to the sight or food she named it under
  // (answers.wantFrom), else, as from a link, to the first of her answered sights and foods, in tap
  // order, that it serves. That answer is the label on its card and the step it fills in with.
  const wantReason = (o, answers) => {
    const vibes = [...(answers.see || []), ...(answers.eat || [])];
    const from = answers.wantFrom && answers.wantFrom[o.id];
    if (from && vibes.includes(from) && rankFor(o, from) !== null) return from;
    return vibes.find((r) => rankFor(o, r) !== null) || null;
  };

  function compose(C, answers = {}) {
    const see = answers.see || [], eatIn = answers.eat || [];
    const wander = answers.wander || null, wild = answers.wild || null;
    if (!see.length && !eatIn.length && !wander && !wild) return { picks: (C.defaultDay || []).map((p) => ({ id: p.id, reason: p.reason })), extras: [] };
    const O = optionsById(C);
    const step = (id) => C.ask.steps.find((s) => s.id === id);

    // The wander option first (it anchors the day's geography), then the wild card, then what she
    // asked for by name, in the order she pressed it, then food (what she cares about most, and it
    // costs the least), then the sights with what is left of the budget.
    const queue = [];
    const area = wander && step('wander').tiles.find((t) => t.id === wander);
    if (area && O[area.option]) queue.push({ reason: 'wander', step: 'wander', fixed: area.option });
    if (wild && O[wild]) queue.push({ reason: 'wild', step: 'wild', fixed: wild });
    (answers.want || []).forEach((id) => {
      const reason = O[id] && wantReason(O[id], answers);
      if (reason) queue.push({ reason, step: see.includes(reason) ? 'see' : 'eat', fixed: id, want: true });
    });
    FOOD_FIRST.filter((r) => eatIn.includes(r)).forEach((reason) => queue.push({ reason, step: 'eat' }));
    see.forEach((reason) => queue.push({ reason, step: 'see' }));

    const picks = [], extras = [];
    const ids = () => picks.map((p) => p.id);
    const toExtras = (id, reason, want) => { if (id && !extras.some((e) => e.id === id) && !ids().includes(id)) extras.push(want ? { id, reason, want } : { id, reason }); };
    // Every composed day stays easy (see easyDay), so each addition is tested on the whole day.
    // A named thing that was parked is tried again before each sight or food of mine (a lunch on the
    // day can make room for it), while its own sight or food has no pick of mine yet. It is never my
    // pick for another sight or food, so it always carries the one she named it under.
    const parkedWant = (id) => extras.some((e) => e.want && e.id === id);
    const retryWants = () => {
      for (const e of extras.filter((x) => x.want)) {
        if (picks.some((p) => !p.want && p.reason === e.reason)) continue;
        const taken = ids();
        if (weightOf(C, taken) + (O[e.id].weight || 0) > BUDGET || !easyDay(C, [...taken, e.id])) continue;
        picks.push({ id: e.id, reason: e.reason, step: see.includes(e.reason) ? 'see' : 'eat', want: true });
        extras.splice(extras.indexOf(e), 1);
      }
    };
    for (const q of queue) {
      if (!q.fixed) retryWants();
      // The class is lunch, once it is on the day; if it did not fit, lunch gets its trattoria.
      if (!q.fixed && q.reason === 'lunch' && picks.some((p) => p.reason === 'class')) continue;
      // A sight or food with one of her named things on the day needs no pick of mine. If every
      // thing she named under it was parked, it gets its pick as if she had named nothing.
      if (!q.fixed && picks.some((p) => p.want && p.reason === q.reason)) continue;
      const taken = ids();
      const w = weightOf(C, taken);
      const fits = (id) => w + (O[id].weight || 0) <= BUDGET && easyDay(C, [...taken, id]);
      if (q.fixed) {
        if (taken.includes(q.fixed)) continue;
        if (fits(q.fixed)) picks.push({ id: q.fixed, reason: q.reason, step: q.step, want: !!q.want }); else toExtras(q.fixed, q.reason, q.want);
        continue;
      }
      // Street food beside a lunch already on the day: the second-lunch penalty in scoreOf (and
      // build's one-lunch rule) leave it the non-lunch stop (supplì).
      const cands = ranked(C, q.reason, taken, taken, (o) => !parkedWant(o.id));
      let chosen = null, tries = 0;
      for (const o of cands) {
        if (w + (o.weight || 0) > BUDGET) continue; // too heavy for the day: a lighter one may still fit
        if (tries++ >= TRIES) break;
        if (easyDay(C, [...taken, o.id])) { chosen = o; break; }
      }
      if (chosen) picks.push({ id: chosen.id, reason: q.reason, step: q.step });
      else if (cands.length) toExtras(cands[0].id, q.reason);
    }
    // The board fills in the order she answered: the sights, the area, the wild card, then food,
    // and her tap order inside each step (things she asked for by name, in the order she pressed them).
    const tap = (p) => (p.step === 'see' ? see.indexOf(p.reason) : p.step === 'eat' ? eatIn.indexOf(p.reason) : 0);
    picks.sort((a, b) => STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) || tap(a) - tap(b));
    // A light day (fewer than FILL_BELOW stops) gets my picks from the default day, the day that
    // skipping every step gives, wherever they still fit: picking one thing never leaves her a
    // thinner Friday than picking nothing. They go last on the board, as Felix's pick.
    if (picks.length < FILL_BELOW) {
      for (const d of C.defaultDay || []) {
        const taken = ids();
        if (!O[d.id] || taken.includes(d.id) || weightOf(C, taken) + (O[d.id].weight || 0) > BUDGET || !easyDay(C, [...taken, d.id])) continue;
        picks.push({ id: d.id, reason: 'felix', step: 'felix' });
      }
    }
    return { picks: picks.map(({ id, reason }) => ({ id, reason })), extras: extras.filter((e) => !ids().includes(e.id)) };
  }

  // Up to three options that could replace picks[i]: the same answer, fitting the day without dropping anything.
  function alternatives(C, picks, i) {
    const O = optionsById(C);
    const cur = picks[i];
    if (!cur || !O[cur.id]) return [];
    const reason = cur.reason === 'added' || cur.reason === 'felix' ? bestReason(O[cur.id]) : cur.reason;
    if (!reason) return [];
    const ids = picks.map((p) => p.id);
    const others = ids.filter((_, j) => j !== i);
    const before = dropsOf(C, ids);
    const out = [];
    for (const o of ranked(C, reason, ids, others)) {
      if (noNewDrops(before, dropsOf(C, ids.map((id, j) => (j === i ? o.id : id))))) out.push(o.id);
      if (out.length === 3) break;
    }
    return out;
  }

  // "Room for one more?": what didn't make the budget first, then anything serving what she
  // answered, then small things on the way. Each must fit and keep the day at or under ROOM_BUDGET.
  function suggestions(C, picks, answers = {}) {
    const O = optionsById(C);
    const ids = picks.map((p) => p.id);
    const w = weightOf(C, ids);
    const before = dropsOf(C, ids);
    const out = [];
    const tried = new Set(ids);
    const take = (id, reason) => {
      if (out.length >= 3 || tried.has(id) || !O[id]) return;
      tried.add(id);
      if (w + (O[id].weight || 0) <= ROOM_BUDGET && noNewDrops(before, dropsOf(C, [...ids, id]))) out.push({ id, reason });
    };
    compose(C, answers).extras.forEach((e) => take(e.id, e.reason));
    const answered = [...(answers.see || []), ...(answers.eat || []), ...(answers.wander ? ['wander'] : []), ...(answers.wild ? ['wild'] : [])];
    answered
      .flatMap((reason) => ranked(C, reason, ids, ids).map((o) => ({ id: o.id, reason, s: scoreOf(C, o, reason, ids) })))
      .sort((a, b) => a.s - b.s)
      .forEach((x) => take(x.id, x.reason));
    C.options
      .filter((o) => o.weight === 0.5 && !ids.includes(o.id) && ids.some((id) => O[id] && haversine(o, O[id]) <= NEAR_M))
      .map((o) => ({ id: o.id, s: scoreOf(C, o, bestReason(o), ids) }))
      .sort((a, b) => a.s - b.s)
      .forEach((x) => take(x.id, 'added'));
    return out;
  }

  root.VenerdiPlan = { build, compose, alternatives, suggestions, bestReason, wantReason, toMin, hhmm, fmt, haversine };
})(typeof window !== 'undefined' ? window : globalThis);
