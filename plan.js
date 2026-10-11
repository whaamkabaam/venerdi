/* Venerdì day builder (v8): the loose sketch. Her picks go on the day in a rough order with rough
   times (always on :00 or :30), inside opening hours, sessions and fixed times, the bags block around
   15:00 and dinner around 19:00. Nothing is refused: what the plain timeline cannot hold is squeezed
   in at a time it can happen, and the day then says what overlaps (or, past six things, that it is
   full). Only something that cannot happen on
   Friday at all (`fridayNo`) stays off the day. Her four answers (and the things she named) become
   picks with no caps and no fit test. Pure and deterministic; all copy comes from content.json.
   Loads in the page and in Node.
   Spec: qa/design-v8.md section 8, with the amendments of section 14. */
(function (root) {
  'use strict';

  const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
  const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
  const fmt = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  const round30 = (min) => Math.round(min / 30) * 30;
  const floor30 = (min) => Math.floor(min / 30) * 30;
  const ceil30 = (min) => Math.ceil(min / 30) * 30;
  // Great-circle distance in metres.
  function haversine(a, b) {
    const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* The day's frame (spec 8.1; FREE_GAP retired by AM5). START and DINNER are read from content
     (meta.startsAt, anchors.dinner.time) by frameOf(); the values here are what content says today. */
  const FRAME = Object.freeze({
    START: toMin('10:00'),         // the day starts near Termini
    GAP: 20,                       // minutes between two stops in different areas (never shown, never a refusal)
    GAP_NEAR: 10,                  // ...between two stops in the same area
    NOON: toMin('12:00'),          // a stop that would start (rounded) at noon or later waits for lunch
    LUNCH_FROM: toMin('12:30'),    // the plain lunch line starts no earlier
    LUNCH_MINUTES: 45,             // "Lunch wherever we are."
    SNACK_GAP: 120,                // a snack that is not lunch: this long after lunch ends and before dinner
    FIXED_EARLY: 10,               // default minutes early for a fixed-time thing
    MORNING_BY: toMin('11:00'),    // a stop whose first window starts before this could fill a morning
    BAGS_FROM: toMin('14:30'),     // the bags block starts no earlier...
    BAGS_TO: toMin('16:00'),       // ...and no later
    BAGS_BLOCK: 120,               // the bags to the flat, settling in, a break, and back out
    SUNSET_START: toMin('17:55'),  // the Vittoriano roof starts then
    EVENING_END: toMin('18:30'),   // nothing but dinner starts at or after this, and nothing ends after it
    DINNER: toMin('19:00'),        // dinner
    CROWDED: 6,                    // more things than this (lunch and dinner not counted) make a full day
    NEAR_M: 1200,                  // "near her day" for More ideas, straight-line metres
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
  // A card whose rough start is 17:00 or later sits under Evening (spec 8.5).
  const EVENING_SLOT = toMin('17:00');

  const isEvening = (o) => o.role === 'evening';
  const isSnack = (o) => o.role === 'snack';
  const isPastry = (o) => o.role === 'pastry';
  const isClass = (o) => !!(o && o.serves && 'class' in o.serves);
  const earlyOf = (o) => o.early ?? (o.fixedAt ? FRAME.FIXED_EARLY : 0);
  // No "around" for fixed times and for things with at most two sessions (the class at 11:00 or 13:00).
  const exactOf = (o) => !!o.fixedAt || (!!o.sessions && o.sessions.length <= 2);
  const byOrder = (a, b) => a.order - b.order;
  // Evening stops start at their own time: Gesù at 17:30, the Vittoriano roof at SUNSET_START.
  const evStart = (F, o) => (o.fixedAt ? toMin(o.fixedAt) : F.SUNSET_START);
  const gapOf = (F, from, o) => (!from ? 0 : from.area === o.area ? F.GAP_NEAR : F.GAP);

  /* Feasible starts (spec 5.2 of v7, unchanged): per published interval, intersected with planWindow,
     lo..latest where latest = min(last entry, interval end minus the visit). Sessions and fixed times
     are filtered to these windows. Returns [{ lo, latest, sessions: [min] | null }]. */
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
  // The last feasible start, or null.
  function lastStart(o) {
    const ws = windowsOf(o);
    if (!ws.length) return null;
    const w = ws[ws.length - 1];
    return w.sessions ? w.sessions[w.sessions.length - 1] : w.latest;
  }
  // A stop that could fill a morning (R7): not lunch, not a fixed time, not evening, first window before 11:00.
  function morningCapable(o) {
    if (isEvening(o) || o.lunch || o.fixedAt) return false;
    const w = windowsOf(o)[0];
    return !!w && (w.sessions ? w.sessions[0] : w.lo) < FRAME.MORNING_BY;
  }

  /* Pass A, the daytime (spec 8.2): v7's daytime with the leg replaced by the hidden gap. Lunch goes in
     by the clock, before the first stop that would start (rounded) at noon or later, or before a snack.
     Fixed-time things (the noon cannon) go in before anything that would make us miss them, lunch
     included. A stop that cannot start, or would end after capA, goes to `later` (never dropped).
     Lunch is the lead lunch, else the first snack as lunch, else the plain line; it is placed even when
     it ends after capA. `lunchBefore`, when set, puts lunch right before that stop (the lunch repair). */
  function passA(F, S, order, lunchBefore) {
    const out = [], later = [];
    const fixedQ = [...S.fixedDay].sort((a, b) => toMin(a.fixedAt) - toMin(b.fixedAt));
    const snackLunch = S.lead ? null : order.find(isSnack) || null;
    let clock = F.START, prev = null, lunchDone = false, lunchEnd = null, idle = 0, leadEntry = null, leadLost = false;
    function at(o) {
      const arrive = clock + gapOf(F, prev, o);
      let t = arrive + earlyOf(o);
      // A snack that is not lunch keeps SNACK_GAP after lunch and ends SNACK_GAP before dinner (v7 C3).
      const gapped = isSnack(o) && o !== snackLunch;
      if (gapped && lunchEnd !== null) t = Math.max(t, lunchEnd + F.SNACK_GAP);
      let start = firstFeasible(o, t);
      if (start !== null && gapped && start + o.minutes > F.DINNER - F.SNACK_GAP) start = null;
      return { arrive, start };
    }
    function place(o, a, extra) {
      idle += Math.max(0, a.start - earlyOf(o) - a.arrive);
      const e = { kind: 'option', option: o, start: a.start, end: a.start + o.minutes, arrive: a.arrive, ...extra };
      out.push(e);
      clock = e.end;
      prev = o;
      return e;
    }
    const missesFixed = (end, loc) => { const X = fixedQ[0]; return !!X && end + gapOf(F, loc, X) + earlyOf(X) > toMin(X.fixedAt); };
    function placeFixed() {
      const X = fixedQ.shift();
      const a = at(X);
      if (a.start === null || a.start + X.minutes > S.capA) later.push(X);
      else place(X, a, {});
    }
    // The snack as lunch: by the clock, not before the plain line would be.
    function snackLunchAt() {
      const a = at(snackLunch);
      return { arrive: a.arrive, start: a.start === null ? null : firstFeasible(snackLunch, Math.max(a.start, F.LUNCH_FROM)) };
    }
    // Where and when the lunch that would go in right now ends.
    function lunchPreview() {
      if (S.lead) { const a = at(S.lead); if (a.start !== null) return { end: a.start + S.lead.minutes, loc: S.lead }; }
      else if (snackLunch) { const a = snackLunchAt(); if (a.start !== null) return { end: a.start + snackLunch.minutes, loc: snackLunch }; }
      return { end: Math.max(clock, F.LUNCH_FROM) + F.LUNCH_MINUTES, loc: prev };
    }
    function placeLunch() {
      while (fixedQ.length) { const p = lunchPreview(); if (!missesFixed(p.end, p.loc)) break; placeFixed(); }
      lunchDone = true;
      if (S.lead) {
        const a = at(S.lead);
        if (a.start !== null) { leadEntry = place(S.lead, a, { lead: true, lunchItem: true }); lunchEnd = leadEntry.end; return; }
        leadLost = true; // it becomes a lunch idea; every repair ranks this worst (build)
      } else if (snackLunch) {
        const a = snackLunchAt();
        if (a.start !== null) { leadEntry = place(snackLunch, a, { lead: true, lunchItem: true, asLunch: true }); lunchEnd = leadEntry.end; return; }
        later.push(snackLunch); // it goes on as an ordinary snack
      }
      const s = Math.max(clock, F.LUNCH_FROM);
      leadEntry = { kind: 'lunch-filler', start: s, end: s + F.LUNCH_MINUTES, lead: true, lunchItem: true };
      out.push(leadEntry);
      clock = leadEntry.end; // the plain line does not change `prev` (v7)
      lunchEnd = clock;
    }

    for (const o of order) {
      if (o === snackLunch) continue; // it goes in with lunch, by the clock
      while (fixedQ.length) { const a = at(o); if (a.start === null || !missesFixed(a.start + o.minutes, o)) break; placeFixed(); }
      if (!lunchDone) {
        const a = at(o);
        // Compared on the rounded time, so a stop under Morning never reads "around 12:00".
        if (o === lunchBefore || isSnack(o) || round30(a.start === null ? a.arrive : a.start) >= F.NOON) placeLunch();
      }
      const a = at(o);
      if (a.start === null || a.start + o.minutes > S.capA) { later.push(o); continue; }
      place(o, a, {});
    }
    while (fixedQ.length) placeFixed();
    if (!lunchDone) placeLunch();
    const endA = Math.max(...out.map((e) => e.end));
    return { out, later, idle, leadEntry, leadLost, lunchEnd, endA };
  }

  /* Pass B, the late block [bags end, EVENING_END] (spec 8.2): `later` items by order, with the
     evening picks (Gesù 17:30, the roof 17:55) inserted as fixed times. An item is placed only if it
     ends by EVENING_END and does not make us miss the next evening pick; otherwise it is squeezed.
     An evening pick that cannot be reached from the bags is squeezed at its own time. */
  function passB(F, S, later, B, lunchEnd) {
    const out = [], squeeze = [];
    let clock = B + F.BAGS_BLOCK, prev = null;
    const fixedQ = S.evening.filter((o) => evStart(F, o) - earlyOf(o) >= clock).sort((a, b) => evStart(F, a) - evStart(F, b));
    const unreachable = S.evening.filter((o) => !fixedQ.includes(o));
    function at(o) {
      const arrive = clock + gapOf(F, prev, o);
      let t = arrive + earlyOf(o);
      if (isSnack(o)) t = Math.max(t, lunchEnd + F.SNACK_GAP);
      let start = firstFeasible(o, t);
      if (start !== null && isSnack(o) && start + o.minutes > F.DINNER - F.SNACK_GAP) start = null;
      return { arrive, start };
    }
    const missesFixed = (end, loc) => { const X = fixedQ[0]; return !!X && end + gapOf(F, loc, X) + earlyOf(X) > evStart(F, X); };
    function place(o, arrive, start) {
      out.push({ kind: 'option', option: o, start, end: start + o.minutes, arrive, late: true });
      clock = start + o.minutes;
      prev = o;
    }
    function placeFixed() {
      const X = fixedQ.shift();
      const arrive = clock + gapOf(F, prev, X), start = evStart(F, X);
      if (arrive + earlyOf(X) > start || !feasibleAt(X, start) || start + X.minutes > F.EVENING_END) unreachable.push(X);
      else place(X, arrive, start);
    }
    for (const o of [...later].sort(byOrder)) {
      while (fixedQ.length) { const a = at(o); if (a.start === null || !missesFixed(a.start + o.minutes, o)) break; placeFixed(); }
      const a = at(o);
      if (a.start === null || a.start + o.minutes > F.EVENING_END || missesFixed(a.start + o.minutes, o)) { squeeze.push(o); continue; }
      place(o, a.arrive, a.start);
    }
    while (fixedQ.length) placeFixed();
    return { out, squeeze, unreachable };
  }

  /* Display order (spec 8.5): lunch items under Lunch; a card whose rough start is earlier than the
     first lunch item's goes under Morning; else Afternoon before 17:00, else Evening. The bags card is
     Afternoon. Sorted by group, then start. */
  const SLOT_RANK = { morning: 0, lunch: 1, afternoon: 2, evening: 3 };
  const tieRank = (e) => (e.lead ? 0 : e.bags ? 2 : 1);
  function arrange(list) {
    let firstLunch = Infinity;
    for (const e of list) if (e.lunchItem) firstLunch = Math.min(firstLunch, round30(e.start));
    const out = list.map((e) => {
      const r = round30(e.start);
      const slot = e.lunchItem ? 'lunch' : e.bags ? 'afternoon' : r < firstLunch ? 'morning' : r < EVENING_SLOT ? 'afternoon' : 'evening';
      return { e, slot };
    });
    out.sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot] || a.e.start - b.e.start || tieRank(a.e) - tieRank(b.e)
      || (a.e.option ? a.e.option.order : 0) - (b.e.option ? b.e.option.order : 0));
    return out;
  }
  // Starts and rough times never go backwards down the page (R5).
  function inOrder(list) {
    const a = arrange(list);
    for (let i = 1; i < a.length; i++) {
      if (a[i].e.start < a[i - 1].e.start || round30(a[i].e.start) < round30(a[i - 1].e.start)) return false;
    }
    return true;
  }
  // Minutes of [s, e] that overlap cards already placed (lunch ideas take no time).
  const overlapWith = (s, e, cards) => cards.reduce((m, c) => (c.idea ? m : m + Math.max(0, Math.min(e, c.end) - Math.max(s, c.start))), 0);

  /* A squeezed card (spec 8.2 with AM17): among its feasible starts on a 10-minute grid (sessions and
     fixed times as given) inside 10:00 to 18:30, keep clear of the bags block, the lead lunch and, for a
     snack, the snack gaps; keep Morning before noon and the display in time order; take the start with
     the fewest minutes overlapping cards already placed, then the earliest. When nothing passes, relax
     in this order: the time order, the lead lunch and the noon rule; then the snack gaps; then the bags.
     A card placed with any relaxation is `loose`. */
  const RELAX = [['lunch', 'noon', 'snack', 'bags', 'order'], ['snack', 'bags'], ['bags'], []];
  function squeezeOne(F, o, cards, B, lead, lunchEnd) {
    const early = earlyOf(o), m = o.minutes;
    const starts = [];
    for (const w of windowsOf(o)) {
      if (w.sessions) starts.push(...w.sessions);
      else for (let s = Math.ceil(w.lo / 10) * 10; s <= w.latest; s += 10) starts.push(s);
    }
    const base = [...new Set(starts)].filter((s) => s >= F.START && s + m <= F.EVENING_END).sort((a, b) => a - b);
    const test = {
      lunch: (s) => !(s - early < lead.end && s + m > lead.start),
      noon: (s) => exactOf(o) || s >= lead.start || round30(s) < F.NOON,
      snack: (s) => !isSnack(o) || (s >= lunchEnd + F.SNACK_GAP && s + m <= F.DINNER - F.SNACK_GAP),
      bags: (s) => !(s - early < B + F.BAGS_BLOCK && s + m > B),
      order: (s) => inOrder([...cards, { kind: 'option', option: o, start: s, end: s + m }]),
    };
    for (let lv = 0; lv < RELAX.length; lv++) {
      let best = null;
      for (const s of base) {
        if (!RELAX[lv].every((k) => test[k](s))) continue;
        const ov = overlapWith(s, s + m, cards);
        if (!best || ov < best.ov) best = { s, ov };
      }
      if (best) return { start: best.s, loose: lv > 0 };
    }
    // Data rule R15 says every option has a start inside the frame on its own, so this is not reached.
    return { start: firstFeasible(o, F.START) ?? lastStart(o) ?? F.START, loose: true };
  }

  /* build(C, ids) -> plan (spec 8.2). `ids` are her picks in board order. */
  function build(C, pickIds) {
    const F = frameOf(C);
    const O = optionsById(C);
    const ids = [...new Set(pickIds)].filter((id) => O[id]);
    const picked = C.options.filter((o) => ids.includes(o.id)).sort(byOrder);
    const cant = picked.filter((o) => o.fridayNo);
    const P = ids.map((id) => O[id]).filter((o) => !o.fridayNo); // in board order
    const evening = P.filter(isEvening);
    const lunches = P.filter((o) => o.lunch && !isEvening(o));
    const lead = lunches.find(isClass) || lunches[0] || null;
    const alts = lunches.filter((o) => o !== lead);
    const fixedDay = P.filter((o) => o.fixedAt && !isEvening(o) && !o.lunch);
    const rest = P.filter((o) => !isEvening(o) && !o.lunch && !o.fixedAt);
    const seqA = [...rest.filter(isPastry).sort(byOrder), ...rest.filter((o) => !isPastry(o)).sort(byOrder)];
    // The day block ends early enough to reach the evening picks after the bags (Gesù 15:00, the roof 15:30).
    const eveCap = evening.length ? floor30(Math.min(...evening.map((o) => evStart(F, o) - earlyOf(o))) - F.BAGS_BLOCK) : F.BAGS_TO;
    const S = { lead, fixedDay, evening, capA: Math.min(F.BAGS_TO, eveCap) };

    // One full pass over an order of the daytime stops. Ranked by a lost lead lunch (never wanted),
    // then fewer squeezed, fewer `later`, fewer idle minutes.
    function solve(order, lunchBefore = null) {
      const A = passA(F, S, order, lunchBefore);
      const B = Math.min(F.BAGS_TO, Math.max(F.BAGS_FROM, ceil30(A.endA)));
      const Bp = passB(F, S, A.later, B, A.lunchEnd);
      return { order, lunchBefore, A, B, Bp, rank: [A.leadLost ? 1 : 0, Bp.squeeze.length + Bp.unreachable.length, A.later.length, A.idle] };
    }
    const cmp = (x, y) => { for (let i = 0; i < x.rank.length; i++) if (x.rank[i] !== y.rank[i]) return x.rank[i] - y.rank[i]; return 0; };
    let best = solve(seqA);

    // Repair 1, move earlier: a stop that went to `later` is tried at each earlier place in the order
    // (never ahead of the pastries: a pastry goes first in the morning); the best variant wins (ties:
    // the smallest move) when it beats the current plan.
    const pastries = seqA.filter(isPastry).length;
    const tried = new Set();
    for (let guard = 0; guard <= seqA.length; guard++) {
      const o = best.order.find((x) => best.A.later.includes(x) && !tried.has(x));
      if (!o) break;
      tried.add(o);
      const i = best.order.indexOf(o);
      let pick = null;
      for (let j = i - 1; j >= (isPastry(o) ? 0 : pastries); j--) {
        const order = [...best.order];
        order.splice(i, 1);
        order.splice(j, 0, o);
        const r = solve(order, best.lunchBefore);
        if (!pick || cmp(r, pick) < 0) pick = r;
      }
      if (pick && cmp(pick, best) < 0) best = pick;
    }
    // Repair 2, lunch first: the lead lunch could not start at the clock, or ended after capA. Try it
    // before each stop after the pastries.
    if (lead && (best.A.leadLost || best.A.leadEntry.end > S.capA)) {
      let pick = null;
      for (const o of best.order) {
        if (isPastry(o)) continue;
        const r = solve(best.order, o);
        if (!pick || cmp(r, pick) < 0) pick = r;
      }
      if (pick && cmp(pick, best) < 0) best = pick;
    }
    // Repair 3, morning: the first stop starts at noon or later while a stop that could fill the
    // morning sits later. Try that stop first.
    const firstStart = (r) => Math.min(...r.A.out.map((e) => e.start));
    if (firstStart(best) >= F.NOON) {
      let pick = null;
      for (const o of best.order) {
        if (o === best.order[0] || !morningCapable(o)) continue;
        const r = solve([o, ...best.order.filter((x) => x !== o)], best.lunchBefore);
        if (firstStart(r) < F.NOON && (!pick || cmp(r, pick) < 0)) pick = r;
      }
      if (pick && pick.rank[0] <= best.rank[0] && pick.rank[1] <= best.rank[1]) best = pick;
    }

    const { A, B, Bp } = best;
    const cards = [...A.out, ...Bp.out, { kind: 'anchor', id: 'bags', start: B, end: B + F.BAGS_BLOCK, bags: true }];
    // Second lunch ideas (spec 8.4): at the first start from the lead's, else the latest one they have. They
    // show under Lunch and take no time from the day.
    const L = A.leadEntry;
    for (const o of [...(A.leadLost ? [lead] : []), ...alts]) {
      const s = firstFeasible(o, L.start) ?? lastStart(o);
      cards.push({ kind: 'option', option: o, start: s, end: s + o.minutes, lunchItem: true, idea: true });
    }
    // Squeezed: evening picks the bags block cuts off, at their own time; then whatever pass B could
    // not place.
    for (const o of Bp.unreachable) cards.push({ kind: 'option', option: o, start: evStart(F, o), end: evStart(F, o) + o.minutes, squeezed: true });
    for (const o of [...Bp.squeeze].sort(byOrder)) {
      const q = squeezeOne(F, o, cards, B, L, A.lunchEnd);
      cards.push({ kind: 'option', option: o, start: q.start, end: q.start + o.minutes, squeezed: true, ...(q.loose ? { loose: true } : {}) });
    }

    const Anc = C.anchors;
    const items = [{ kind: 'anchor', id: 'arrival', anchor: Anc.arrival, start: toMin(Anc.arrival.time), slot: 'morning', rough: Anc.arrival.time, exact: true }];
    for (const { e, slot } of arrange(cards)) {
      if (e.bags) { items.push({ kind: 'anchor', id: 'bags', anchor: Anc.bags, start: e.start, end: e.end, slot, rough: hhmm(e.start), exact: false }); continue; }
      if (e.kind === 'lunch-filler') { items.push({ kind: 'lunch-filler', start: e.start, end: e.end, slot, rough: hhmm(round30(e.start)), exact: false, lead: true }); continue; }
      const o = e.option;
      const it = { kind: 'option', id: o.id, option: o, start: e.start, end: e.end, slot, rough: hhmm(round30(e.start)), exact: exactOf(o) };
      if (e.arrive !== undefined) it.arrive = e.arrive;
      if (e.late) it.late = true;
      if (e.lead) it.lead = true;
      if (e.asLunch) it.asLunch = true;
      if (e.idea) it.lunchIdea = true;
      if (e.squeezed) it.squeezed = true;
      if (e.loose) it.loose = true;
      items.push(it);
    }
    items.push({ kind: 'anchor', id: 'dinner', anchor: Anc.dinner, start: F.DINNER, slot: 'evening', rough: hhmm(F.DINNER), exact: false });
    items.push({ kind: 'anchor', id: 'end', anchor: Anc.end, start: toMin(Anc.end.time), slot: 'evening', rough: Anc.end.time, exact: true });

    // Two pastry stops in one day: the later one is second breakfast.
    const breakfasts = (C.departures && C.departures.breakfasts) || [];
    items.filter((it) => it.kind === 'option' && breakfasts.includes(it.id)).slice(1).forEach((it) => { it.secondBreakfast = true; });

    const cardsOn = items.filter((it) => it.kind === 'option');
    const things = cardsOn.filter((it) => !it.option.lunch && !it.asLunch).length;
    const squeezed = cardsOn.filter((it) => it.squeezed).map((it) => it.id);
    // The cards whose times overlap because one of them was squeezed in (v8 fold-in, gate F1): each
    // squeezed card against the other cards, the plain lunch line and the bags block. Lunch ideas take
    // no time. A squeeze that clashes with nothing (a snack a little soon after lunch) is not an overlap.
    const timed = items.filter((it) => (it.kind === 'option' && !it.lunchIdea) || it.kind === 'lunch-filler' || it.id === 'bags');
    const clash = new Set();
    for (const q of timed) {
      if (!q.squeezed) continue;
      for (const o of timed) if (o !== q && q.start < o.end && o.start < q.end) { clash.add(q); clash.add(o); }
    }
    const overlaps = timed.filter((it) => clash.has(it)).map((it) => it.id || 'lunch');
    return {
      items,
      options: cardsOn.map((it) => it.option),
      didntFit: cant.map((o) => ({ option: o, code: 'fridayNo', why: o.fridayNo, reason: o.fridayNo })),
      squeezed,
      loose: cardsOn.filter((it) => it.loose).map((it) => it.id),
      crowded: things > F.CROWDED,
      overlaps,
      things,
      lunchIdeas: cardsOn.filter((it) => it.lunchIdea).map((it) => it.id),
      picked,
      bags: { start: B, end: B + F.BAGS_BLOCK },
      idle: A.idle,
    };
  }

  /* Composer (spec 8.3): her answers become an ordered list of picks, each carrying the answer it came
     from. Every option has one home (`serves`, one key: reason -> rank, lower is better). No caps, no
     fit test, nothing parked: build() puts everything on the day. */

  const FILL_TO = 3;          // a composed day with fewer picks than this gets my default-day picks up to it
  const STEP_ORDER = ['see', 'wander', 'wild', 'eat']; // the order the board fills in
  const FOOD_FIRST = ['class', 'pastry', 'lunch'];
  const STREET = 'street';

  const byIdCache = new WeakMap();
  const optionsById = (C) => {
    let m = byIdCache.get(C);
    if (!m) { m = Object.fromEntries(C.options.map((o) => [o.id, o])); byIdCache.set(C, m); }
    return m;
  };
  // `wander` covers every wander:<area> key, so the area cards can swap with each other.
  const servesKey = (o, reason) => Object.keys(o.serves || {}).find((k) => (reason === 'wander' ? k.startsWith('wander:') : k === reason));
  const rankFor = (o, reason) => { const k = servesKey(o, reason); return k ? o.serves[k] : null; };
  // An option's home (what Swap swaps within).
  const bestReason = (o) => {
    const [k] = Object.entries(o.serves || {}).sort((a, b) => a[1] - b[1])[0] || [];
    return k && k.startsWith('wander:') ? 'wander' : k || null;
  };
  const optsOf = (C, ids) => { const O = optionsById(C); return ids.map((id) => O[id]).filter(Boolean); };

  // score = rank * 10 + km to the reference place * 6, plus 1000 for a second lunch (v7). Distances
  // start at the hostel while nothing is placed; pastries measure from the morning end of the loop,
  // lunch and street food from its middle.
  function scoreOf(C, o, reason, others) {
    const placed = optsOf(C, others).filter((p) => typeof p.lat === 'number');
    let refs = placed;
    if (!placed.length) refs = [C.places.hostel];
    else if (reason === 'pastry' || reason === 'lunch' || reason === 'street') {
      const byOrd = [...placed].sort(byOrder);
      refs = [reason === 'pastry' ? byOrd[0] : byOrd[Math.floor((byOrd.length - 1) / 2)]];
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

  // A thing she named (answers.want) belongs to the sight or food she named it under (answers.wantFrom),
  // else, as from a link, to the first of her answered sights and foods, in tap order, that it serves.
  const wantReason = (o, answers) => {
    const vibes = [...(answers.see || []), ...(answers.eat || [])];
    const from = answers.wantFrom && answers.wantFrom[o.id];
    if (from && vibes.includes(from) && rankFor(o, from) !== null) return from;
    return vibes.find((r) => rankFor(o, r) !== null) || null;
  };

  /* compose(C, answers) -> { picks, extras: [] } (spec 8.3). `extras` is always empty (kept for old
     callers). */
  function compose(C, answers = {}) {
    const O = optionsById(C);
    const can = (o) => !!o && !o.fridayNo;
    const see = answers.see || [], eat = answers.eat || [];
    const wander = answers.wander || null, wild = answers.wild || null;
    if (!see.length && !eat.length && !wander && !wild) return { picks: (C.defaultDay || []).filter((p) => can(O[p.id])).map((p) => ({ id: p.id, reason: p.reason })), extras: [] };
    const picks = [];
    const ids = () => picks.map((p) => p.id);
    const on = (id) => picks.some((p) => p.id === id);
    const add = (id, reason, step, want = false) => { picks.push({ id, reason, step, want }); };
    const stepFor = (reason) => (see.includes(reason) ? 'see' : 'eat');
    // 1. Every thing she named, in pressed order, that serves one of her answers.
    for (const id of answers.want || []) {
      const o = O[id];
      if (!can(o) || on(id)) continue;
      const reason = wantReason(o, answers);
      if (reason) add(id, reason, stepFor(reason), true);
    }
    // 2. Her area and her wild card.
    const wanderStep = C.ask.steps.find((s) => s.id === 'wander');
    const tile = wander && wanderStep && wanderStep.tiles.find((t) => t.id === wander);
    if (tile && can(O[tile.option]) && !on(tile.option)) add(tile.option, 'wander', 'wander');
    if (wild && can(O[wild]) && !on(wild)) add(wild, 'wild', 'wild');
    const namedUnder = (reason) => picks.some((p) => p.want && p.reason === reason);
    const best = (reason, keepIf = () => true) => ranked(C, reason, ids(), ids(), (o) => can(o) && keepIf(o))[0] || null;
    // 3. Food she tapped with nothing named under it: the class, a pastry, lunch (none once the class is on).
    for (const reason of FOOD_FIRST) {
      if (!eat.includes(reason) || namedUnder(reason)) continue;
      if (reason === 'lunch' && picks.some((p) => isClass(O[p.id]))) continue;
      const o = best(reason);
      if (o) add(o.id, reason, 'eat');
    }
    // 4. Sights she tapped with nothing named under them, in tap order.
    for (const reason of see) {
      if (namedUnder(reason)) continue;
      const o = best(reason);
      if (o) add(o.id, reason, 'see');
    }
    // 5. Street food: the market while the day has no lunch; with lunch on, the best street option that
    //    is not a snack (a snack keeps two hours after lunch, so it would only be squeezed in; v8 fold-in,
    //    mechanics F4), else the best street option.
    if (eat.includes(STREET) && !namedUnder(STREET)) {
      const lunchOn = picks.some((p) => O[p.id].lunch);
      const o = (!lunchOn && best(STREET, (x) => !!x.lunch)) || (lunchOn && best(STREET, (x) => !x.lunch && !isSnack(x))) || best(STREET);
      if (o) add(o.id, STREET, 'eat');
    }
    // 6. A light day gets my default-day picks, in order, up to three.
    for (const d of C.defaultDay || []) {
      if (picks.length >= FILL_TO) break;
      if (can(O[d.id]) && !on(d.id)) add(d.id, 'felix', 'felix');
    }
    // The board fills in the order she answered: the sights, the area, the wild card, then food, her tap
    // order inside each step, my picks last.
    const tap = (p) => (p.step === 'see' ? see.indexOf(p.reason) : p.step === 'eat' ? eat.indexOf(p.reason) : 0);
    picks.sort((a, b) => (a.step === 'felix') - (b.step === 'felix') || STEP_ORDER.indexOf(a.step) - STEP_ORDER.indexOf(b.step) || tap(a) - tap(b));
    return { picks: picks.map(({ id, reason }) => ({ id, reason })), extras: [] };
  }

  /* Swap (spec 8.8): up to three options from the same home that are not on the day and can happen on
     Friday, the things she named in that home first, then by score. No fit test. */
  function alternatives(C, picks, i, { want = [] } = {}) {
    const O = optionsById(C);
    const cur = picks[i];
    if (!cur || !O[cur.id]) return [];
    const reason = bestReason(O[cur.id]);
    if (!reason) return [];
    const ids = picks.map((p) => p.id);
    const others = ids.filter((_, j) => j !== i);
    const ok = (o) => !!o && !o.fridayNo && !ids.includes(o.id) && rankFor(o, reason) !== null;
    const named = [...new Set(want)].filter((id) => ok(O[id]));
    const rest = ranked(C, reason, ids, others, (o) => !o.fridayNo).map((o) => o.id).filter((id) => !named.includes(id));
    return [...named, ...rest].slice(0, 3);
  }

  /* More ideas (spec 8.8, AM12): up to three, skipping anything on the day or with fridayNo: options
     serving what she answered (sights, foods, area, wild card), best score first; then options within
     NEAR_M of a card on her day, nearest first. Each is { id, reason } (reason `added` for a near one). */
  function suggestions(C, picks, answers = {}) {
    const O = optionsById(C);
    const ids = picks.map((p) => p.id);
    const out = [];
    const seen = new Set(ids);
    const take = (id, reason) => {
      if (out.length >= 3 || seen.has(id) || !O[id] || O[id].fridayNo) return;
      seen.add(id);
      out.push({ id, reason });
    };
    const answered = [...(answers.see || []), ...(answers.eat || []), ...(answers.wander ? ['wander'] : []), ...(answers.wild ? ['wild'] : [])];
    answered
      .flatMap((reason) => ranked(C, reason, ids, ids, (o) => !o.fridayNo).map((o) => ({ id: o.id, reason, s: scoreOf(C, o, reason, ids), order: o.order })))
      .sort((a, b) => a.s - b.s || a.order - b.order)
      .forEach((x) => take(x.id, x.reason));
    const placed = optsOf(C, ids).filter((o) => !o.fridayNo && typeof o.lat === 'number');
    if (placed.length) {
      C.options
        .filter((o) => !seen.has(o.id) && !o.fridayNo && typeof o.lat === 'number')
        .map((o) => ({ o, d: Math.min(...placed.map((p) => haversine(o, p))) }))
        .filter((x) => x.d <= FRAME.NEAR_M)
        .sort((a, b) => a.d - b.d || a.o.order - b.o.order)
        .forEach((x) => take(x.o.id, 'added'));
    }
    return out;
  }

  /* See everything's Add (spec 8.8): it always works, unless the thing cannot happen on Friday at all.
     Adding never pushes anything out. */
  function catalogueAdd(C, picks, id) {
    const o = optionsById(C)[id];
    if (o && o.fridayNo) return { ok: false, code: 'fridayNo', vars: { why: o.fridayNo } };
    return { ok: true, yields: [] };
  }

  root.VenerdiPlan = {
    build, compose, alternatives, suggestions, catalogueAdd, bestReason, wantReason, toMin, hhmm, fmt, haversine,
    windowsOf, firstFeasible, FRAME, frameOf,
  };
})(typeof window !== 'undefined' ? window : globalThis);
