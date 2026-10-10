/* Venerdì day builder (v7): turns picked option ids into a calm, loose plan inside the day's frame
   (start at the hostel at 10:00, the bags to the flat after 15:00 with time to rest, an optional
   evening stop, dinner at 19:00), and her four answers (plus the things she named) into picks.
   Pure and deterministic; all copy comes from content.json. Loads in the page and in Node.
   Spec: qa/design-v7.md sections 3, 5 and 7, with the amendments of section 13. */
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

  /* The day's frame (spec 2.3, 13.2, 13.4, 13.6). START and DINNER are read from content
     (meta.startsAt, anchors.dinner.time) by frameOf(); the values here are what content says today. */
  const FRAME = Object.freeze({
    START: toMin('10:00'),         // the clock starts at the hostel
    CHECKIN: toMin('15:00'),       // earliest arrival at the flat
    BAGS_GRAB: 10,                 // minutes at the hostel to get the bags
    BAGS_RIDE: 20,                 // taxi from the hostel to the flat (not counted against maxTaxis)
    SETTLE: 15,                    // minutes to get into the flat
    REST_MIN: 30,                  // least time at the flat before going out again
    SUNSET_START: toMin('17:55'),  // earliest start on the Vittoriano roof
    EVENING_END: toMin('18:30'),   // no visit ends after this, and none starts at or after it
    DINNER: toMin('19:00'),        // dinner starts exactly then; arrival is at or before it
    LUNCH_FROM: toMin('12:30'),    // the plain lunch line starts no earlier
    NOON: toMin('12:00'),          // a stop that would start at noon or later waits for lunch
    LUNCH_MINUTES: 45,             // the plain "lunch wherever we are" stop
    BUFFER: 15,                    // relaxed buffer after every daytime stop (evening stops take none)
    FREE_GAP: 90,                  // idle minutes that earn the quiet free-time line
    FIXED_EARLY: 10,               // default minutes early for a fixed-time thing
    MORNING_BY: toMin('11:00'),    // a stop whose first window starts before this could fill a morning
    BUDGET: 2.5,                   // weight of a composed day (main 1, area 1, short 0.5, the rest 0)
    ROOM_BUDGET: 3.5,              // "Room for one more?" may take the day this far
    ROOM_MAINS: 2,                 // ...with at most this many mains
    COST_CAP: 80,                  // per-person euros before dinner on a composed day
    ROOM_COST_CAP: 100,            // ...and with a Room offer
    NEAR_M: 1200,                  // "on the way": straight-line metres
    SNACK_GAP: 120,                // street food starts this long after lunch ends, ends this long before dinner (fold-in C3)
  });
  const frameCache = new WeakMap();
  function frameOf(C) {
    let F = frameCache.get(C);
    if (!F) {
      F = Object.freeze({ ...FRAME, START: toMin(C.meta.startsAt.slice(11, 16)), DINNER: toMin(C.anchors.dinner.time) });
      frameCache.set(C, F);
    }
    return F;
  }

  /* The calmer caps (spec 3.2, 13.9). `lunch` counts every option with `lunch: true` (the pasta
     class is a main and the lunch at once); every other role counts options of that role. */
  const ROLE_CAPS = Object.freeze({
    main: Object.freeze({ cap: 1, weight: 1 }),
    area: Object.freeze({ cap: 1, weight: 1 }),
    short: Object.freeze({ cap: 2, weight: 0.5 }),
    lunch: Object.freeze({ cap: 1, weight: 0 }),
    pastry: Object.freeze({ cap: 1, weight: 0 }),
    snack: Object.freeze({ cap: 1, weight: 0 }),
    evening: Object.freeze({ cap: 2, weight: 0 }),
  });

  const isEvening = (o) => o.role === 'evening';
  const earlyOf = (o) => o.early ?? (o.fixedAt ? FRAME.FIXED_EARLY : 0);
  // Evening stops are timed to the light and to dinner, so the walk on is their buffer (13.1).
  const stay = (o) => o.minutes + (isEvening(o) ? 0 : FRAME.BUFFER);
  // A daytime stop the overflow rule may drop first: not a lunch, not a fixed-time thing, not evening.
  const isOrdinary = (o) => !o.lunch && !o.fixedAt && !isEvening(o);
  const isTimed = (o) => !!(o.fixedAt || o.sessions);

  /* Latest feasible start (spec 5.2): per published interval, intersected with planWindow,
     lo..latest where latest = min(last entry, interval end minus the visit). Sessions and fixed
     times are filtered to these windows. Returns [{ lo, latest, sessions: [min] | null }]. */
  const windowCache = new WeakMap();
  function windowsOf(o) {
    let ws = windowCache.get(o);
    if (ws) return ws;
    ws = [];
    const ivs = (o.hours && o.hours.intervals) || [['00:00', '23:59']];
    const last = (o.hours && o.hours.lastEntry) || [];
    const pw = o.planWindow ? o.planWindow.map(toMin) : [-Infinity, Infinity];
    const starts = o.fixedAt ? [toMin(o.fixedAt)] : o.sessions ? o.sessions.map(toMin) : null;
    ivs.forEach(([a, b], i) => {
      const lo = Math.max(toMin(a), pw[0]);
      const end = Math.min(toMin(b), pw[1]);
      const latest = Math.min(last[i] ? toMin(last[i]) : end, end - o.minutes);
      if (lo > latest) return;
      if (!starts) { ws.push({ lo, latest, sessions: null }); return; }
      const s = starts.filter((x) => x >= lo && x <= latest);
      if (s.length) ws.push({ lo, latest, sessions: s });
    });
    windowCache.set(o, ws);
    return ws;
  }
  // The earliest feasible start at or after `t`, or null.
  function firstFeasible(o, t) {
    for (const w of windowsOf(o)) {
      if (w.sessions) { const s = w.sessions.find((x) => x >= t); if (s !== undefined) return s; }
      else if (w.latest >= t) return Math.max(t, w.lo);
    }
    return null;
  }
  const feasibleAt = (o, s) => windowsOf(o).some((w) => s >= w.lo && s <= w.latest && (!w.sessions || w.sessions.includes(s)));
  // The last possible start (for "Closes at {time}").
  function lastStartOf(o) {
    const ws = windowsOf(o);
    if (!ws.length) { const iv = (o.hours && o.hours.intervals) || [['00:00', '23:59']]; return toMin(iv[iv.length - 1][0]); }
    const w = ws[ws.length - 1];
    return w.sessions ? w.sessions[w.sessions.length - 1] : w.latest;
  }
  // A stop that could fill an empty morning: daytime, movable, first possible start before 11:00.
  const morningStop = (o) => {
    if (!isOrdinary(o)) return false;
    const w = windowsOf(o)[0];
    return !!w && (w.sessions ? w.sessions[0] : w.lo) < FRAME.MORNING_BY;
  };

  /* Legs (gate B2 of the v7 fold-in): walks use the metres routed on foot in content.walks (OSRM on
     OpenStreetMap), at its pace of 75 m a minute; a leg from or to the hostel's area uses its routed
     ride in content.rides. A pair the tables lack falls back to the straight-line estimate. */
  const placeId = (C, p) => p.id || (p === C.anchors.dinner ? 'dinner' : '');
  function makeTransfer(C, a, b) {
    const U = C.ui;
    const ride = C.rides && C.rides[`${placeId(C, a)}>${placeId(C, b)}`];
    if (ride) return { text: ride.text, m: ride.m, min: ride.min, taxi: !!ride.taxi };
    const routed = C.walks && C.walks.m[placeId(C, a)] && C.walks.m[placeId(C, a)][placeId(C, b)];
    const walk = (m, tpl = U.walk) => { const min = Math.max(1, Math.round(m / 75)); return { text: fmt(tpl, { min }), m, min }; };
    if (a.area === b.area) return walk(routed ?? Math.round(haversine(a, b) * 1.3));
    // A listed transfer: a walk ("{min} min walk ...") takes the routed minutes; one with no walking
    // in it is a taxi ride.
    const e = (C.transfers || []).find((t) => t.from === a.area && t.to === b.area);
    if (e && e.text.includes('{min}')) return routed !== undefined ? walk(routed, e.text) : { text: fmt(e.text, { min: e.min }), m: e.m, min: e.min };
    if (e) return { text: e.text, m: e.m, min: e.min, taxi: e.m === 0 };
    const d = haversine(a, b);
    if (d < 1500) return walk(routed ?? Math.round(d));
    const min = Math.max(10, Math.round((5 + d / 333) / 5) * 5); // a cab at city speed, plus finding one
    return { text: fmt(U.taxi, { min }), m: 0, min, taxi: true };
  }

  // Why something did not fit: the board's code plus values, the planner's own code (`why`), and an
  // English line (for Details). noTimeDay, noTimeEvening and fixedMissed all read NO TIME LEFT.
  function dropOf(C, option, why, vars = {}) {
    const code = ['noTimeDay', 'noTimeEvening', 'fixedMissed'].includes(why) ? 'noTime' : why;
    return { option, code, why, vars, reason: fmt(C.ui.reasons[why] || '', vars) };
  }

  /* The daytime, from the hostel at START (spec 7.2 step 1). Lunch goes in by the clock: before the
     first stop that would start at noon or later. Fixed-time things (the noon cannon) go in before
     anything that would make us miss them, lunch included. `lunchBefore`, when set, puts lunch right
     before that stop whatever the clock says (build's lunch repair uses it). Street food is never a
     third meal (fold-in C3): with no sit-down lunch on the day, the snack is lunch (it takes the plain
     lunch line's place, by the clock); with one, it comes after it, starts SNACK_GAP after lunch ends
     (we wait, as for an opening time) and ends SNACK_GAP before dinner. */
  function daytime(C, F, seq, lunches, fixed, lunchBefore) {
    const out = [], drops = [];
    const fixedQ = [...fixed].sort((a, b) => toMin(a.fixedAt) - toMin(b.fixedAt));
    let clock = F.START, prev = C.places.hostel, lunchDone = false, lunchEnd = null, idle = 0;
    const isSnack = (o) => o.role === 'snack';
    const snackLunch = lunches.length ? null : seq.find(isSnack) || null;

    // When we would get to `o` from where we are now, and the first start we can make there.
    function arrival(o, from = prev) {
      const t = makeTransfer(C, from, o);
      const arrive = clock + t.min;
      let start = firstFeasible(o, arrive + earlyOf(o));
      if (isSnack(o) && start !== null) {
        // Waiting for the gap after lunch, and done two hours before dinner; when only the gap is in
        // the way, that is the reason (snackGap), not the opening hours.
        const snackBy = F.DINNER - F.SNACK_GAP - o.minutes;
        const gapped = firstFeasible(o, Math.max(arrive + earlyOf(o), lunchEnd === null ? -Infinity : lunchEnd + F.SNACK_GAP));
        if (gapped === null || gapped > snackBy) return { t, arrive, start: arrive, code: start <= snackBy ? 'snackGap' : 'closes', vars: { time: hhmm(Math.min(lastStartOf(o), snackBy)) } };
        start = gapped;
      }
      if (start === null) return { t, arrive, start: arrive, code: o.fixedAt ? 'fixedMissed' : 'closes', vars: { time: o.fixedAt || hhmm(lastStartOf(o)) } };
      return { t, arrive, start };
    }
    function place(o, a) {
      idle += Math.max(0, a.start - earlyOf(o) - a.arrive);
      out.push({ kind: 'option', option: o, start: a.start, end: a.start + stay(o), arrive: a.arrive, transfer: a.t });
      clock = a.start + stay(o);
      prev = o;
    }
    // Would something ending at `end` at place `loc` make the next fixed-time thing unreachable?
    function missesFixed(end, loc) {
      const X = fixedQ[0];
      if (!X) return false;
      return end + makeTransfer(C, loc, X).min + earlyOf(X) > toMin(X.fixedAt);
    }
    function placeFixed() {
      const X = fixedQ.shift();
      const a = arrival(X);
      if (a.code) drops.push(dropOf(C, X, a.code, a.vars));
      else place(X, a);
    }
    // The snack as lunch: by the clock, not before the plain lunch line would be.
    function snackAsLunch() {
      const a = arrival(snackLunch);
      if (a.code) return a;
      const start = firstFeasible(snackLunch, Math.max(a.start, F.LUNCH_FROM));
      return start === null ? { ...a, code: 'closes', vars: { time: hhmm(lastStartOf(snackLunch)) } } : { ...a, start };
    }
    // The lunch that would be placed right now: the first lunch pick we can make, else the snack,
    // else the plain line.
    function lunchPreview() {
      for (const L of lunches) { const a = arrival(L); if (!a.code) return { end: a.start + stay(L), loc: L }; }
      if (snackLunch) { const a = snackAsLunch(); if (!a.code) return { end: a.start + stay(snackLunch), loc: snackLunch }; }
      return { end: Math.max(clock, F.LUNCH_FROM) + F.LUNCH_MINUTES, loc: prev };
    }
    function placeLunch() {
      while (fixedQ.length) { const p = lunchPreview(); if (!missesFixed(p.end, p.loc)) break; placeFixed(); }
      lunchDone = true;
      for (let i = 0; i < lunches.length; i++) {
        const a = arrival(lunches[i]);
        if (a.code) { drops.push(dropOf(C, lunches[i], a.code, a.vars)); continue; }
        place(lunches[i], a);
        lunchEnd = a.start + lunches[i].minutes;
        lunches.slice(i + 1).forEach((o) => drops.push(dropOf(C, o, 'lunchTaken')));
        return;
      }
      if (snackLunch) {
        const a = snackAsLunch();
        if (!a.code) { place(snackLunch, a); out[out.length - 1].asLunch = true; lunchEnd = a.start + snackLunch.minutes; return; }
        drops.push(dropOf(C, snackLunch, a.code, a.vars));
      }
      const at = Math.max(clock, F.LUNCH_FROM);
      out.push({ kind: 'lunch-filler', start: at, end: at + F.LUNCH_MINUTES, transfer: null });
      clock = at + F.LUNCH_MINUTES;
      lunchEnd = clock;
    }

    for (const o of seq) {
      if (o === snackLunch) continue; // it goes in with lunch, by the clock
      while (fixedQ.length) { const a = arrival(o); if (a.code || !missesFixed(a.start + stay(o), o)) break; placeFixed(); }
      // Compared on the rounded time, so a stop shown under Morning never reads "around 12:00".
      if (!lunchDone && (o === lunchBefore || isSnack(o) || round30(arrival(o).start) >= F.NOON)) placeLunch();
      const a = arrival(o);
      if (a.code) { drops.push(dropOf(C, o, a.code, a.vars)); continue; }
      place(o, a);
    }
    while (fixedQ.length) placeFixed();
    if (!lunchDone) placeLunch();
    return { out, drops, clock, prev, idle };
  }

  /* The afternoon and evening (spec 7.2 steps 2 to 5): back to the hostel, the bags to the flat,
     rest, then the evening stops (Gesù at 17:30, the Vittoriano from 17:55) or straight to dinner. */
  function evening(C, F, day, ev) {
    const H = C.places.hostel, FL = C.places.flat, dinner = C.anchors.dinner;
    const tH = day.prev === H ? null : makeTransfer(C, day.prev, H);
    const atHostel = day.clock + (tH ? tH.min : 0);
    const flatArrive = Math.max(atHostel + F.BAGS_GRAB + F.BAGS_RIDE, F.CHECKIN);
    const grab = flatArrive - F.BAGS_RIDE - F.BAGS_GRAB;
    const checkedIn = flatArrive + F.SETTLE;
    const out = [];
    let late = false, leave, clock, prev = FL;
    if (ev.length) {
      const first = ev[0];
      const target = (first.fixedAt ? toMin(first.fixedAt) : F.SUNSET_START) - earlyOf(first);
      leave = target - makeTransfer(C, FL, first).min;
      clock = leave;
      for (const o of ev) {
        const t = makeTransfer(C, prev, o);
        const arrive = clock + t.min;
        const start = o.fixedAt ? toMin(o.fixedAt) : Math.max(arrive + earlyOf(o), F.SUNSET_START);
        if (arrive + earlyOf(o) > start || !feasibleAt(o, start) || start + stay(o) > F.EVENING_END) late = true;
        out.push({ kind: 'option', option: o, start, end: start + stay(o), arrive, transfer: t });
        clock = start + stay(o);
        prev = o;
      }
    } else {
      leave = F.DINNER - makeTransfer(C, FL, dinner).min;
      clock = leave;
    }
    const tDinner = makeTransfer(C, prev, dinner);
    const dinnerArrive = clock + tDinner.min;
    const ok = !late && checkedIn + F.REST_MIN <= leave && dinnerArrive <= F.DINNER;
    return { ok, bags: { tH, atHostel, grab, flatArrive, checkedIn, leave }, out, tDinner, dinnerArrive };
  }

  function build(C, pickIds, { keep = null } = {}) {
    const F = frameOf(C);
    const picked = C.options.filter((o) => pickIds.includes(o.id)).sort((a, b) => a.order - b.order);
    const K = keep ? picked.find((o) => o.id === keep) || null : null;

    // The best plan for a set of options: v6's repairs on the loop both ways round, then the
    // better of the two.
    function solve(set) {
      const eveningPicks = set.filter(isEvening);
      // Lunch picks in order of preference: the must-do first, then the longest sit-down lunch
      // (the class, then a trattoria).
      const lunches0 = set.filter((o) => o.lunch && !isEvening(o)).sort((a, b) => (b === K) - (a === K) || b.minutes - a.minutes || a.order - b.order);
      const fixed0 = set.filter((o) => o.fixedAt && !isEvening(o) && !o.lunch);
      const rest = set.filter((o) => !isEvening(o) && !o.lunch && !o.fixedAt);
      // The loop by `order`, both ways round. A pastry stays first either way: she starts with one.
      const pastries = rest.filter((o) => o.role === 'pastry');
      const others = rest.filter((o) => o.role !== 'pastry');
      const asc = [...pastries, ...others];
      const desc = [...pastries, ...[...others].reverse()];

      /* One full pass over an order: the daytime, then the frame; when the frame breaks, drop a stop
         and go again (13.3): the evening yields when the evening is what overflows (Gesù first),
         otherwise the last ordinary daytime stop, then any other daytime stop. `keep` never yields. */
      function run(order, lunchBefore = null) {
        let seq = [...order], lunches = [...lunches0], fixed = [...fixed0], ev = [...eveningPicks];
        const victims = [];
        let day = null, eve = null, broken = false;
        for (let guard = 0; guard < 60; guard++) {
          day = daytime(C, F, seq, lunches, fixed, lunchBefore);
          eve = evening(C, F, day, ev);
          if (eve.ok) break;
          const yieldEv = ev.filter((o) => o !== K);
          if (yieldEv.length && evening(C, F, day, ev.filter((o) => o === K)).ok) {
            for (const o of yieldEv) {
              ev = ev.filter((x) => x !== o);
              victims.push(dropOf(C, o, 'noTimeEvening'));
              if (evening(C, F, day, ev).ok) break;
            }
            continue;
          }
          const placed = day.out.filter((x) => x.kind === 'option').map((x) => x.option).reverse();
          const victim = placed.find((o) => o !== K && isOrdinary(o)) || placed.find((o) => o !== K);
          if (!victim) { broken = true; break; }
          victims.push(dropOf(C, victim, 'noTimeDay'));
          seq = seq.filter((o) => o !== victim);
          lunches = lunches.filter((o) => o !== victim);
          fixed = fixed.filter((o) => o !== victim);
          if (victim === lunchBefore) lunchBefore = null;
        }
        const dropped = [...victims, ...day.drops].map((d) => d.option);
        const ride = day.out.reduce((m, x) => m + (x.transfer ? x.transfer.min : 0), 0)
          + (eve.bags.tH ? eve.bags.tH.min : 0)
          + eve.out.reduce((m, x) => m + x.transfer.min, 0) + eve.tDinner.min;
        return { order, lunchBefore, day, eve, victims, dropped, ride, idle: day.idle, broken, keepOK: !K || !dropped.includes(K) };
      }
      // A repair variant is better when it saves `rescued` without dropping anything new, and rides
      // least. Saving the must-do may cost another stop: then fewer drops win, then the ride.
      const better = (r, cur, pick, rescued) => {
        if (r.dropped.includes(rescued)) return false;
        if (rescued && rescued === K) return !pick || r.dropped.length < pick.dropped.length || (r.dropped.length === pick.dropped.length && r.ride < pick.ride);
        return !r.dropped.some((o) => !cur.dropped.includes(o)) && (!pick || r.ride < pick.ride);
      };
      const timing = (d) => d.why === 'closes';
      // v6's three repairs on one direction of the loop.
      function repaired(seq) {
        let best = run(seq);
        // Timing: a stop dropped for its hours may fit earlier in the loop. Try it at each earlier
        // place and keep the variant that drops nothing new and rides least (ties: the smallest move).
        const tried = new Set();
        for (let guard = 0; guard < 8; guard++) {
          const d = best.day.drops.find((x) => timing(x) && best.order.includes(x.option) && !tried.has(x.option));
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
        // Lunch: a sit-down lunch (or the class) can be gone by the time the morning is done. Try it
        // before each stop instead.
        const lunchLost = best.day.drops.find((x) => timing(x) && lunches0.includes(x.option));
        if (lunchLost) {
          let pick = null;
          for (const o of best.order) { const r = run(best.order, o); if (better(r, best, pick, lunchLost.option)) pick = r; }
          if (pick) best = pick;
        }
        // Morning: if the first stop starts at noon or later while a stop that could go in the
        // morning waits for later, try that stop first.
        const firstStart = (r) => (r.day.out.length ? r.day.out[0].start : Infinity);
        if (firstStart(best) >= F.NOON) {
          let pick = null;
          for (const o of best.order) {
            if (o === best.order[0] || !morningStop(o)) continue;
            const r = run([o, ...best.order.filter((x) => x !== o)], best.lunchBefore);
            if (firstStart(r) < F.NOON && better(r, best, pick, null)) pick = r;
          }
          if (pick) best = pick;
        }
        return best;
      }
      const A1 = repaired(asc);
      const A2 = desc.length > 1 ? repaired(desc) : A1;
      return cmp(A2, A1) < 0 ? A2 : A1;
    }
    // Between plans: a whole frame, `keep` placed, fewer drops, fewer idle minutes before the bags
    // (waits for a window or session; the check-in wait is not counted), fewer ride minutes. A full
    // tie keeps the loop's own direction.
    const rank = (r) => [r.broken ? 1 : 0, r.keepOK ? 0 : 1, r.dropped.length, r.idle, r.ride];
    function cmp(a, b) { const x = rank(a), y = rank(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }

    let best = solve(picked);
    // The must-do never yields to something else (spec 3.1): if it still drops, leave out the stop
    // (or stops) in its way, the one whose absence costs least first.
    const left = [];
    const alone = K && !best.keepOK ? solve([K]).keepOK : false;
    while (alone && !best.keepOK && left.length < picked.length - 1) {
      let pick = null;
      for (const o of [...picked].reverse()) {
        if (o === K || left.includes(o)) continue;
        const r = solve(picked.filter((x) => x !== o && !left.includes(x)));
        if (!pick || cmp(r, pick.r) < 0) pick = { r, o };
      }
      if (!pick) break;
      left.push(pick.o);
      best = pick.r;
    }
    if (left.length) {
      const why = (o) => (o.lunch && K.lunch ? 'lunchTaken' : isEvening(o) ? 'noTimeEvening' : 'noTimeDay');
      best = { ...best, victims: [...left.map((o) => dropOf(C, o, why(o))), ...best.victims] };
      best.dropped = [...left, ...best.dropped];
    }
    const { day, eve } = best;

    const didntFit = [...best.victims];
    day.drops.forEach((d) => { if (!didntFit.some((x) => x.option === d.option)) didntFit.push(d); });
    didntFit.sort((a, b) => a.option.order - b.option.order);

    /* Display list: arrival, the daytime stops (each after its transfer; the first from the hostel),
       the lunch line, one quiet free-time line, the bags, the evening stops (the first from the flat),
       dinner, the early night. */
    const Anc = C.anchors;
    const items = [{ kind: 'anchor', id: 'arrival', anchor: Anc.arrival, start: toMin(Anc.arrival.time), slot: 'morning', exact: true }];
    let lastEnd = F.START;
    let lunchSeen = false, freeShown = false;
    // Idle time (after travel) of 90+ minutes before the bags earns the free-time line, once.
    const pushStop = (entry, transfer, daytimeGap) => {
      if (daytimeGap && !freeShown && entry.start - (lastEnd + (transfer ? transfer.min : 0)) >= F.FREE_GAP) { items.push({ kind: 'free' }); freeShown = true; }
      if (transfer) items.push({ kind: 'transfer', transfer });
      items.push(entry);
    };
    for (const x of day.out) {
      const o = x.option;
      const isLunch = x.kind === 'lunch-filler' || o.lunch || x.asLunch;
      // A fixed-time stop before lunch (the noon cannon) is filed under Morning.
      const slot = isLunch ? 'lunch' : lunchSeen ? 'afternoon' : 'morning';
      if (isLunch) lunchSeen = true;
      const entry = x.kind === 'lunch-filler'
        ? { kind: 'lunch-filler', start: x.start, end: x.end, slot }
        : { kind: 'option', id: o.id, option: o, start: x.start, end: x.end, arrive: x.arrive, slot, exact: isTimed(o), ...(x.asLunch ? { asLunch: true } : {}) };
      pushStop(entry, x.transfer, true);
      lastEnd = x.end;
    }
    const B = eve.bags;
    pushStop({ kind: 'anchor', id: 'bags', anchor: Anc.bags, start: B.grab, end: B.checkedIn, slot: 'afternoon', exact: false, grab: B.grab, atHostel: B.atHostel, flatArrive: B.flatArrive, checkedIn: B.checkedIn, leave: B.leave }, B.tH, true);
    for (const x of eve.out) {
      pushStop({ kind: 'option', id: x.option.id, option: x.option, start: x.start, end: x.end, arrive: x.arrive, slot: 'evening', exact: isTimed(x.option) }, x.transfer, false);
    }
    pushStop({ kind: 'anchor', id: 'dinner', anchor: Anc.dinner, start: F.DINNER, slot: 'evening', exact: true, arrive: eve.dinnerArrive }, eve.tDinner, false);
    items.push({ kind: 'anchor', id: 'end', anchor: Anc.end, start: toMin(Anc.end.time), slot: 'evening', exact: true });
    items.forEach((it) => {
      if (!('start' in it)) return;
      it.rough = it.kind === 'anchor' && it.anchor.time ? it.anchor.time : it.exact ? hhmm(it.start) : hhmm(round30(it.start));
    });

    // Two pastry stops in one morning: the later one is second breakfast.
    const pastryIds = (C.departures && C.departures.breakfasts) || [];
    const placedPastries = items.filter((it) => it.kind === 'option' && pastryIds.includes(it.id));
    if (placedPastries.length >= 2) placedPastries.slice(1).forEach((it) => { it.secondBreakfast = true; });

    const options = [...day.out, ...eve.out].filter((x) => x.kind === 'option').map((x) => x.option);
    const legs = [...day.out.map((x) => x.transfer), B.tH, ...eve.out.map((x) => x.transfer), eve.tDinner].filter(Boolean);
    const walkM = legs.reduce((s, t) => s + t.m, 0);
    const taxis = legs.filter((t) => t.taxi).length;
    return {
      items, options, didntFit, walkM, taxis, picked, keep: K ? K.id : null, dinnerTransfer: eve.tDinner,
      bags: { ...B }, idle: best.idle, rest: B.leave - B.checkedIn, ride: best.ride, broken: best.broken,
    };
  }

  /* Composer: her answers become an ordered list of picks, each carrying the answer it came from.
     Every option has one home (`serves`, one key: reason -> rank, lower is better) and a `role`
     (spec 3.2). build() stays the scheduler and the judge of what fits. */

  const TRIES = 6;           // candidates tried for one answer before it goes to extras
  const FILL_BELOW = 3;      // a composed day with fewer picks than this gets my default-day picks too
  const STEP_ORDER = ['see', 'wander', 'wild', 'eat']; // the order the board fills in
  // Food that anchors the clock is composed before the sights (street food only when it is a lunch,
  // the market); a snack comes after them, the last thing added, so it never takes a sight's place
  // (fold-in A1).
  const FOOD_FIRST = ['class', 'pastry', 'lunch'];
  const SNACK_LAST = 'street';

  const byIdCache = new WeakMap();
  const optionsById = (C) => {
    let m = byIdCache.get(C);
    if (!m) { m = Object.fromEntries(C.options.map((o) => [o.id, o])); byIdCache.set(C, m); }
    return m;
  };
  // `wander` covers every wander:<area> key, so the area cards can swap with each other.
  const servesKey = (o, reason) => Object.keys(o.serves || {}).find((k) => (reason === 'wander' ? k.startsWith('wander:') : k === reason));
  const rankFor = (o, reason) => { const k = servesKey(o, reason); return k ? o.serves[k] : null; };
  // An option's home (what ADDED and Felix's picks swap within).
  const bestReason = (o) => {
    const [k] = Object.entries(o.serves || {}).sort((a, b) => a[1] - b[1])[0] || [];
    return k && k.startsWith('wander:') ? 'wander' : k || null;
  };
  const optsOf = (C, ids) => { const O = optionsById(C); return ids.map((id) => O[id]).filter(Boolean); };
  const weightOf = (C, ids) => optsOf(C, ids).reduce((s, o) => s + ((ROLE_CAPS[o.role] && ROLE_CAPS[o.role].weight) || 0), 0);
  const costOf = (C, ids) => optsOf(C, ids).reduce((s, o) => s + (o.cost || 0), 0);
  const countRole = (C, ids, role) => optsOf(C, ids).filter((o) => (role === 'lunch' ? o.lunch : o.role === role)).length;
  // Role caps and the weight budget of a composed day (spec 3.2).
  const capsOK = (C, ids, budget = FRAME.BUDGET) => weightOf(C, ids) <= budget
    && Object.entries(ROLE_CAPS).every(([role, r]) => countRole(C, ids, role) <= r.cap);
  // "On the way" (spec 7.1): within NEAR_M of a placed main, area, lunch or pastry stop, or of the
  // hostel; true while no daytime non-food stop is placed yet.
  function onTheWay(C, id, taken) {
    const O = optionsById(C), o = O[id];
    const placed = optsOf(C, taken);
    if (!placed.some((p) => ['main', 'area', 'short'].includes(p.role) && p.group !== 'food')) return true;
    const refs = [...placed.filter((p) => ['main', 'area', 'pastry'].includes(p.role) || p.lunch), C.places.hostel];
    return refs.some((p) => haversine(o, p) <= FRAME.NEAR_M);
  }

  // Memo by the set of ids and `keep` (build depends on nothing else), per content object.
  const memoCache = new WeakMap();
  function memo(C, tag, ids, keep, fn) {
    let m = memoCache.get(C);
    if (!m) { m = new Map(); memoCache.set(C, m); }
    const set = [...new Set(ids)].sort();
    const k = `${tag}|${set.join(',')}|${keep && set.includes(keep) ? keep : ''}`;
    if (!m.has(k)) m.set(k, fn());
    return m.get(k);
  }
  const dropsOf = (C, ids, keep = null) => memo(C, 'd', ids, keep, () => build(C, ids, { keep }).didntFit.map((d) => d.option.id));
  // Nothing in `after` that was not already in `before`.
  const noNewDrops = (before, after) => after.every((id) => before.includes(id));
  // A morning left empty although a stop that could go in the morning waits for later: build's
  // morning repair could not move it, so it does not fit there.
  const lostMorning = (C, r) => {
    const F = frameOf(C);
    const stops = r.items.filter((it) => (it.kind === 'option' && !isEvening(it.option)) || it.kind === 'lunch-filler');
    return stops.length > 0 && stops[0].start >= F.NOON && stops.some((it) => it.kind === 'option' && morningStop(it.option));
  };
  // The composer's test for a day: nothing dropped, the frame whole, rides and walking within
  // content.meta's caps, and no wasted morning.
  const easyDay = (C, ids, keep = null) => memo(C, `e${C.meta.maxTaxis ?? 3}/${C.meta.walkCapKm || 10}`, ids, keep, () => {
    const r = build(C, ids, { keep });
    return !r.broken && !r.didntFit.length && r.taxis <= (C.meta.maxTaxis ?? 3) && r.walkM <= (C.meta.walkCapKm || 10) * 1000 && !lostMorning(C, r);
  });

  // score = rank * 10 + km to the reference place * 6, plus 1000 for a second lunch. Distances start
  // at the hostel while nothing is placed; pastries measure from the morning end of the loop, lunch
  // and street food from its middle.
  function scoreOf(C, o, reason, others) {
    const O = optionsById(C);
    const placed = others.map((id) => O[id]).filter((p) => p && typeof p.lat === 'number');
    let refs = placed;
    if (!placed.length) refs = [C.places.hostel];
    else if (reason === 'pastry' || reason === 'lunch' || reason === 'street') {
      const byOrder = [...placed].sort((a, b) => a.order - b.order);
      refs = [reason === 'pastry' ? byOrder[0] : byOrder[Math.floor((byOrder.length - 1) / 2)]];
    }
    const km = Math.min(...refs.map((p) => haversine(o, p))) / 1000;
    let s = (rankFor(o, reason) ?? 99) * 10 + km * 6;
    if (o.lunch && placed.some((p) => p.lunch)) s += 1000;
    return s;
  }
  // Every option serving a reason that is not on the day yet, best first.
  function ranked(C, reason, taken, others, keepIf = () => true) {
    return C.options
      .filter((o) => !taken.includes(o.id) && rankFor(o, reason) !== null && keepIf(o))
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
  // The must-do (spec 3.1): the first thing she named that still exists and serves one of her answers.
  const mustOf = (C, answers = {}) => { const O = optionsById(C); return (answers.want || []).find((id) => O[id] && wantReason(O[id], answers)) || null; };

  /* compose(C, answers) -> { picks, extras, keep } (spec 7.1, with the fold-in's order): the must-do
     first, then the other things she named (in the order she pressed them), the area, the wild card,
     the food that anchors the clock (the class, a pastry, lunch), the sights, and street food last,
     each only while the calmer caps and the clock allow. */
  function compose(C, answers = {}) {
    const see = answers.see || [], eatIn = answers.eat || [];
    const wander = answers.wander || null, wild = answers.wild || null;
    if (!see.length && !eatIn.length && !wander && !wild) return { picks: (C.defaultDay || []).map((p) => ({ id: p.id, reason: p.reason })), extras: [], keep: null };
    const O = optionsById(C);
    const step = (id) => C.ask.steps.find((s) => s.id === id);
    const must = mustOf(C, answers);
    const stepFor = (reason) => (see.includes(reason) ? 'see' : 'eat');

    const queue = [];
    if (must) { const reason = wantReason(O[must], answers); queue.push({ reason, step: stepFor(reason), fixed: must, want: true, must: true }); }
    // The things she named by hand come before the tiles she only tapped (fold-in A2).
    (answers.want || []).forEach((id) => {
      if (id === must) return;
      const reason = O[id] && wantReason(O[id], answers);
      if (reason) queue.push({ reason, step: stepFor(reason), fixed: id, want: true });
    });
    const area = wander && step('wander').tiles.find((t) => t.id === wander);
    if (area && O[area.option]) queue.push({ reason: 'wander', step: 'wander', fixed: area.option });
    if (wild && O[wild]) queue.push({ reason: 'wild', step: 'wild', fixed: wild });
    FOOD_FIRST.filter((r) => eatIn.includes(r)).forEach((reason) => queue.push({ reason, step: 'eat' }));
    if (eatIn.includes(SNACK_LAST)) queue.push({ reason: SNACK_LAST, step: 'eat', lunchOnly: true });
    see.forEach((reason) => queue.push({ reason, step: 'see' }));
    if (eatIn.includes(SNACK_LAST)) queue.push({ reason: SNACK_LAST, step: 'eat' });

    const picks = [], extras = [];
    const ids = () => picks.map((p) => p.id);
    const toExtras = (id, reason, want) => { if (id && !extras.some((e) => e.id === id) && !ids().includes(id)) extras.push(want ? { id, reason, want } : { id, reason }); };
    // The quick tests first (caps, cost, on the way), then the whole day through build().
    const light = (id, exempt) => {
      const next = [...ids(), id];
      return capsOK(C, next) && costOf(C, next) <= FRAME.COST_CAP && (O[id].role !== 'short' || exempt || onTheWay(C, id, ids()));
    };
    const fits = (id, exempt) => light(id, exempt) && easyDay(C, [...ids(), id], must);
    // What she chose by name needs no "on the way": a thing she named, her area, her wild card.
    const exemptFor = (q) => !!(q.want || q.reason === 'wander' || q.reason === 'wild');
    // A named thing that was parked is tried again before each sight or food of mine (a lunch on the
    // day can make room for it), while its own sight or food has no pick of mine yet.
    const parkedWant = (id) => extras.some((e) => e.want && e.id === id);
    const retryWants = () => {
      for (const e of extras.filter((x) => x.want)) {
        if (picks.some((p) => !p.want && p.reason === e.reason)) continue;
        if (!fits(e.id, true)) continue;
        picks.push({ id: e.id, reason: e.reason, step: stepFor(e.reason), want: true });
        extras.splice(extras.indexOf(e), 1);
      }
    };
    // Her area and her wild card she chose by name too. One that was parked only because nothing yet
    // filled the morning (build puts the noon cannon first and the area after lunch, and the morning
    // sits empty) is tried again at the end, once the rest of the day is in (fold-in check N1). Only
    // at the end: tried before each later step, it would take the room of her sights and her lunch.
    const retryTiles = () => {
      for (const e of extras.filter((x) => !x.want && (x.reason === 'wander' || x.reason === 'wild'))) {
        if (!fits(e.id, true)) continue;
        picks.push({ id: e.id, reason: e.reason, step: e.reason });
        extras.splice(extras.indexOf(e), 1);
      }
    };
    // A sight with no stop yet is tried once more right before the snack: a later stop (a museum
    // nearby) can have put one of its places on the way, and the snack must not take that place.
    const retrySights = () => {
      for (const reason of see) {
        if (picks.some((p) => p.reason === reason) || extras.some((e) => e.want && e.reason === reason)) continue;
        const taken = ids();
        let tries = 0;
        for (const o of ranked(C, reason, taken, taken, (x) => !parkedWant(x.id))) {
          if (!light(o.id, false)) continue;
          if (tries++ >= TRIES) break;
          if (!easyDay(C, [...taken, o.id], must)) continue;
          picks.push({ id: o.id, reason, step: 'see' });
          const k = extras.findIndex((e) => !e.want && e.reason === reason);
          if (k >= 0) extras.splice(k, 1);
          break;
        }
      }
    };
    for (const q of queue) {
      if (!q.fixed) retryWants();
      if (!q.fixed && q.reason === SNACK_LAST && !q.lunchOnly) retrySights();
      // The class is lunch, once it is on the day; if it did not fit, lunch gets its trattoria.
      if (!q.fixed && q.reason === 'lunch' && picks.some((p) => p.reason === 'class')) continue;
      // Street food: the market as lunch early, while the day has no lunch; anything else after the sights.
      if (!q.fixed && q.reason === SNACK_LAST && (picks.some((p) => p.reason === SNACK_LAST) || (q.lunchOnly && picks.some((p) => O[p.id].lunch)))) continue;
      // A sight or food with one of her named things on the day needs no pick of mine. If every
      // thing she named under it was parked, it still gets a pick when one fits; when none does,
      // her named things already hold the answer on her list, so nothing more is parked for it
      // (fold-in F4: the same sight twice on the list and the board).
      if (!q.fixed && picks.some((p) => p.want && p.reason === q.reason)) continue;
      if (q.fixed) {
        if (ids().includes(q.fixed)) continue;
        if (fits(q.fixed, exemptFor(q))) picks.push({ id: q.fixed, reason: q.reason, step: q.step, want: !!q.want });
        else toExtras(q.fixed, q.reason, q.want);
        continue;
      }
      const taken = ids();
      const cands = ranked(C, q.reason, taken, taken, (o) => !parkedWant(o.id) && (!q.lunchOnly || !!o.lunch));
      let chosen = null, tries = 0;
      for (const o of cands) {
        if (!light(o.id, false)) continue; // over a cap or off the way: another may still fit
        if (tries++ >= TRIES) break;
        if (easyDay(C, [...taken, o.id], must)) { chosen = o; break; }
      }
      if (chosen) picks.push({ id: chosen.id, reason: q.reason, step: q.step });
      else if (cands.length && !q.lunchOnly && !extras.some((e) => e.want && e.reason === q.reason)) toExtras(cands[0].id, q.reason);
    }
    // A later pick can put a parked named thing on the way: one last try, under her own label; then
    // her area and wild card.
    retryWants();
    retryTiles();
    // Her named things outrank the tiles she only tapped (fold-in A2): a thing she named that is still
    // parked takes the place of the wild card, else of the area, when the day fits with it there.
    for (const e of extras.filter((x) => x.want && x.id !== must)) {
      for (const reason of ['wild', 'wander']) {
        const t = picks.find((p) => p.reason === reason);
        if (!t) continue;
        const next = [...ids().filter((id) => id !== t.id), e.id];
        if (!capsOK(C, next) || costOf(C, next) > FRAME.COST_CAP || !easyDay(C, next, must)) continue;
        picks.splice(picks.indexOf(t), 1, { id: e.id, reason: e.reason, step: stepFor(e.reason), want: true });
        extras.splice(extras.indexOf(e), 1, { id: t.id, reason });
        break;
      }
    }
    // The board fills in the order she answered: the sights, the area, the wild card, then food,
    // and her tap order inside each step.
    const tap = (p) => (p.step === 'see' ? see.indexOf(p.reason) : p.step === 'eat' ? eatIn.indexOf(p.reason) : 0);
    const boardOrder = (a, b) => (a.step === 'felix') - (b.step === 'felix') || STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) || tap(a) - tap(b);
    picks.sort(boardOrder);
    // A light day (fewer than FILL_BELOW picks) gets my picks from the default day wherever they still
    // fit the caps and the clock. They go last on the board, as Felix's pick. Her parked area or wild
    // card is tried again after each one (a pastry of mine can fill the morning it was missing).
    if (picks.length < FILL_BELOW) {
      for (const d of C.defaultDay || []) {
        // A thing she named stays hers: it is never my pick, even when it is on my default day.
        if (!O[d.id] || ids().includes(d.id) || parkedWant(d.id) || !fits(d.id, false)) continue;
        picks.push({ id: d.id, reason: 'felix', step: 'felix' });
        retryTiles();
      }
      picks.sort(boardOrder);
    }
    return { picks: picks.map(({ id, reason }) => ({ id, reason })), extras: extras.filter((e) => !ids().includes(e.id)), keep: must };
  }

  /* Swap (spec 3.3): up to three options from the same home that could replace picks[i], the things
     she named in that home first, each fitting without a new drop and keeping the day's main count
     and weight no higher than now (or within the compose caps). Never offered on the must-do. */
  function alternatives(C, picks, i, { keep = null, want = [] } = {}) {
    const O = optionsById(C);
    const cur = picks[i];
    if (!cur || !O[cur.id] || cur.id === keep) return [];
    const reason = bestReason(O[cur.id]);
    if (!reason) return [];
    const ids = picks.map((p) => p.id);
    const others = ids.filter((_, j) => j !== i);
    const before = dropsOf(C, ids, keep);
    const mainCap = Math.max(countRole(C, ids, 'main'), ROLE_CAPS.main.cap);
    const weightCap = Math.max(weightOf(C, ids), FRAME.BUDGET);
    const named = want.filter((id) => O[id] && !ids.includes(id) && rankFor(O[id], reason) !== null);
    const cands = [...named.map((id) => O[id]), ...ranked(C, reason, ids, others).filter((o) => !named.includes(o.id))];
    const out = [];
    for (const o of cands) {
      const next = ids.map((id, j) => (j === i ? o.id : id));
      if (countRole(C, next, 'main') <= mainCap && weightOf(C, next) <= weightCap && noNewDrops(before, dropsOf(C, next, keep))) out.push(o.id);
      if (out.length === 3) break;
    }
    return out;
  }

  /* "Room for one more?" (spec 3.3): her parked interests first, then anything serving what she
     answered, then short things on the way. Each must add no drop and keep the day within
     ROOM_BUDGET, ROOM_MAINS mains and ROOM_COST_CAP; a short must be on the way unless it is the
     must-do, her wild card or her area. */
  function suggestions(C, picks, answers = {}, { keep = null } = {}) {
    const O = optionsById(C);
    const ids = picks.map((p) => p.id);
    const before = dropsOf(C, ids, keep);
    const area = answers.wander && (C.ask.steps.find((s) => s.id === 'wander').tiles.find((t) => t.id === answers.wander) || {}).option;
    const exempt = new Set([keep, answers.wild, area].filter(Boolean));
    const out = [];
    const tried = new Set(ids);
    const take = (id, reason) => {
      if (out.length >= 3 || tried.has(id) || !O[id]) return;
      tried.add(id);
      const next = [...ids, id];
      if (weightOf(C, next) > FRAME.ROOM_BUDGET || countRole(C, next, 'main') > FRAME.ROOM_MAINS || costOf(C, next) > FRAME.ROOM_COST_CAP) return;
      if (O[id].role === 'short' && !exempt.has(id) && !onTheWay(C, id, ids)) return;
      if (noNewDrops(before, dropsOf(C, next, keep))) out.push({ id, reason });
    };
    compose(C, answers).extras.forEach((e) => take(e.id, e.reason));
    const answered = [...(answers.see || []), ...(answers.eat || []), ...(answers.wander ? ['wander'] : []), ...(answers.wild ? ['wild'] : [])];
    answered
      .flatMap((reason) => ranked(C, reason, ids, ids).map((o) => ({ id: o.id, reason, s: scoreOf(C, o, reason, ids) })))
      .sort((a, b) => a.s - b.s)
      .forEach((x) => take(x.id, x.reason));
    C.options
      .filter((o) => o.role === 'short' && !ids.includes(o.id) && onTheWay(C, o.id, ids))
      .map((o) => ({ id: o.id, s: scoreOf(C, o, bestReason(o), ids) }))
      .sort((a, b) => a.s - b.s)
      .forEach((x) => take(x.id, 'added'));
    return out;
  }

  /* The catalogue's Add (fold-in A3): what adding `id` by hand would cost. It fits as the day is; or
     the only things it pushes out are my picks (Felix's, never hers), which then make way; or it does
     not fit, with its own reason, or "Only if we skip {title}" naming what it would push out when
     skipping that makes room, or "No time left" when it does not. */
  function catalogueAdd(C, picks, id, { keep = null, answers = {} } = {}) {
    const ids = picks.map((p) => p.id);
    const before = dropsOf(C, ids, keep);
    const fresh = build(C, [...ids, id], { keep }).didntFit.filter((d) => !before.includes(d.option.id));
    if (!fresh.length) return { ok: true, yields: [] };
    const own = fresh.find((d) => d.option.id === id);
    if (own) return { ok: false, code: own.code, vars: own.vars };
    const answered = [...(answers.see || []), ...(answers.eat || []), ...(answers.wander ? ['wander'] : []), ...(answers.wild ? ['wild'] : [])];
    const felixPick = (p) => !!p && (p.reason === 'felix' || (p.reason !== 'added' && !answered.includes(p.reason)));
    const yields = fresh.map((d) => d.option.id);
    // Only true when skipping them makes room: else it is plain "No time left" (fold-in check N3).
    const rest = ids.filter((x) => !yields.includes(x));
    if (!noNewDrops(before.filter((x) => !yields.includes(x)), dropsOf(C, [...rest, id], keep))) return { ok: false, code: 'noTime', vars: {} };
    if (fresh.every((d) => felixPick(picks.find((p) => p.id === d.option.id)))) return { ok: true, yields };
    return { ok: false, code: 'bumps', vars: { title: fresh.map((d) => d.option.title).join(C.ui.listJoin) } };
  }

  /* Rain lines (spec 3.4 and 13.7; fold-in F3): a card names its plan B only when that place is open
     within RAIN_SLACK minutes of the stop it stands in for, is not on the day already, and no earlier
     card has promised it; otherwise the card says we skip it. Returns { <option id>: { id, text } }. */
  const RAIN_SLACK = 15;
  function rainLines(C, plan) {
    const O = optionsById(C);
    const out = {}, taken = new Set(plan.options.map((o) => o.id));
    for (const it of plan.items) {
      if (it.kind !== 'option' || !('rainPlan' in it.option)) continue;
      const alt = it.option.rainPlan && O[it.option.rainPlan.id];
      const s = alt && !taken.has(alt.id) ? firstFeasible(alt, it.start - RAIN_SLACK) : null;
      if (s !== null && s <= it.start + RAIN_SLACK) { out[it.id] = { id: alt.id, text: it.option.rainPlan.text }; taken.add(alt.id); }
      else out[it.id] = { id: null, text: C.day.rainSkip };
    }
    return out;
  }

  root.VenerdiPlan = {
    build, compose, alternatives, suggestions, bestReason, wantReason, mustOf, toMin, hhmm, fmt, haversine,
    windowsOf, firstFeasible, roleCaps: ROLE_CAPS, FRAME, frameOf, makeTransfer, onTheWay, capsOK, weightOf, costOf, easyDay,
    catalogueAdd, rainLines, RAIN_SLACK,
  };
})(typeof window !== 'undefined' ? window : globalThis);
