/* Venerdì day planner (v9d D1). Her picks are a priority list: compose() writes it in the goal order (the
   things she named, the class, her area, her wild card, then the category picks), Swap in and Use this move a
   pick to the front, Add appends. Walking down that list, the day keeps every pick that can still go on it
   together with everything kept before it: some order of the kept things fits every opening hour, last entry,
   session and fixed time, lunch, the luggage, the evening and dinner at her time, with a generous trip between
   each two places (real public transport and walking times for Friday 16 Oct 2026, from data.js's `transit`).
   What does not fit waits under "If there's time". Then one exact search orders the kept things: the day's last
   entry ends earliest, then the least travel, then the earliest starts. No two things ever share a minute, and
   the shown times are on the quarter hour, at least 15 minutes apart. Only something that cannot happen on
   Friday at all (`fridayNo`) stays off the day and off the list. Pure and deterministic; all copy comes from
   content.json. Loads in the page and in Node.
   Spec: qa/v9d/design-d1.md, with the rulings of qa/v9d/d1-rulings.md (S2 to S5). */
(function (root) {
  'use strict';

  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const hhmm = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;
  const fmt = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  const ceilTo = (min, g) => Math.ceil(min / g) * g;
  const roundTo = (min, g) => Math.round(min / g) * g;
  // Great-circle distance in metres.
  function haversine(a, b) {
    const R = 6371008.8, rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* The day's frame (spec 3.2 and 3.3). START is content's meta.startsAt; the evening end follows a dinner later
     than 19:00 (ruling S2: dinner time minus 30 minutes, never before 18:30), worked out per build. */
  const FRAME = Object.freeze({
    START: toMin('10:00'),          // from the hostel (meta.startsAt)
    NOON: toMin('12:00'),           // before lunch, nothing new starts at or after this (fixed times aside)
    LUNCH_FROM: toMin('12:30'),     // the plain lunch and a snack as lunch start no earlier
    NOON_EARLY: toMin('11:30'),     // v9c C1e: no pastry stop on her day (no breakfast), so both are 11:30
    LUNCH_FROM_EARLY: toMin('11:30'),
    LUNCH_BY: toMin('14:00'),       // lunch starts by then, whatever it is
    LUNCH_MINUTES: 45,              // "Lunch wherever we are."
    SNACK_GAP: 120,                 // a snack that is not lunch: 2 h after lunch ends, 2 h before her dinner (S3)
    FIXED_EARLY: 10,                // default minutes early for a fixed-time thing
    BAGS_FROM: toMin('14:30'),      // the luggage: at the hostel no earlier than this...
    BAGS_TO: toMin('16:00'),        // ...and no later (so the 13:00 class, which ends 16:00, never fits: O7)
    BAGS_GRAB: 10,                  // minutes at the hostel to get the bags
    CHECKIN: toMin('15:00'),        // at the flat no earlier than this
    AT_FLAT: 60,                    // settling in and a break before we head out again
    SUNSET_START: toMin('17:50'),   // the Vittoriano roof (content meta.goldenStart; 17:50 to 18:25, sunset 18:28)
    EVENING_END: toMin('18:30'),    // nothing but dinner ends after this (later with a later dinner, S2)
    STEP: 15,                       // two starts are at least this far apart (so the shown times never repeat)
    GRID: 5,                        // every planned start is on the 5-minute grid
    SHOW: 15,                       // shown times: nearest quarter hour ("around 10:45")
    WALK_ALWAYS: 12,                // a walk this short is a walk, whatever the timetable says
    WALK_MAX: 25,                   // ...and a walk up to this long when the ride saves at most WALK_SLACK
    WALK_SLACK: 5,
    WALK_BUFFER: 0,                 // planned walk = the walk at 1.0 m/s + this
    RIDE_BUFFER: 0,                 // planned ride = the generous door-to-door minutes + this
    MAX_THINGS: 8,                  // at most this many things besides lunch, the luggage and dinner
    NODE_BUDGET: 20000,             // steps per search; past it the pick waits in the list (never reached in a sweep)
    CACHE_MAX: 20000,               // remembered fit tests (cleared when full)
    NEAR_M: 1200,                   // "near her day" for More ideas, straight-line metres
  });
  const FRAME_EARLY = Object.freeze({ ...FRAME, NOON: FRAME.NOON_EARLY, LUNCH_FROM: FRAME.LUNCH_FROM_EARLY });
  const eveningEnd = (dinnerAt) => Math.max(FRAME.EVENING_END, dinnerAt - 30);

  /* ---------------- travel ---------------- */
  // data.js's `transit` (tooling/transit.json, the hourly form of qa/v9d/transit/: { v: 1, hours, nodes, labels,
  // walk: [minutes per ordered pair], walkSlow: [the same at 1.0 m/s], trip: [per pair: typ, gen - typ, label, per
  // hour] }; ordered pairs run row by row and skip the diagonal), or r1's full matrix.json shape (the sweep's
  // --matrix). Flattened once into typed arrays with the walk-or-ride choice and the planned and shown minutes of
  // every pair and hour.
  const transitCache = new WeakMap();
  function fromShip(S) {
    const n = S.nodes.length, walk = {}, trip = {};
    S.nodes.forEach((a, i) => S.nodes.forEach((b, j) => {
      if (i === j) return;
      const p = i * (n - 1) + (j < i ? j : j - 1), c = S.trip[p];
      (walk[a] ||= {})[b] = [S.walk[p], S.walkSlow[p]];
      (trip[a] ||= {})[b] = S.hours.map((_, k) => [c[k * 3], c[k * 3] + c[k * 3 + 1], c[k * 3 + 2]]);
    }));
    return { meta: { hours: S.hours }, nodes: S.nodes, labels: S.labels, walk, trip };
  }
  function transitOf(M) {
    let T = transitCache.get(M);
    if (T) return T;
    if (M.v === 1 && Array.isArray(M.trip)) { T = transitOf(fromShip(M)); transitCache.set(M, T); return T; }
    const F = FRAME, n = M.nodes.length, H = M.meta.hours, nh = H.length, NN = n * n;
    const index = new Map(M.nodes.map((id, i) => [id, i]));
    const plan = new Uint16Array(nh * NN), show = new Uint16Array(nh * NN), lab = new Int16Array(nh * NN);
    const walkIdx = M.labels.indexOf('walk');
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const w = M.walk[M.nodes[a]][M.nodes[b]], row = M.trip[M.nodes[a]][M.nodes[b]];
      for (let h = 0; h < nh; h++) {
        const [typ, gen, li] = row[h], k = h * NN + a * n + b;
        // Walk or ride (spec 3.3): a walk when the timetable says walk, or the walk is at most 12 minutes, or at
        // most 25 and no more than 5 slower than the ride's typical minutes.
        const isWalk = li === walkIdx || w[0] <= F.WALK_ALWAYS || (w[0] <= F.WALK_MAX && w[0] <= typ + F.WALK_SLACK);
        if (isWalk) { plan[k] = Math.max(w[0], w[1]) + F.WALK_BUFFER; show[k] = Math.max(5, ceilTo(w[0], 5)); lab[k] = -1; }
        else { plan[k] = gen + F.RIDE_BUFFER; show[k] = Math.max(5, ceilTo(typ, 5)); lab[k] = li; }
      }
    }
    const hourAt = (t) => Math.min(nh - 1, Math.max(0, Math.floor(t / 60) - H[0]));
    // First in, first out (spec 3.3): the buckets are hourly, so leaving a minute later can arrive sooner (the hostel
    // to the class: 56 generous minutes at 10:59, 46 at 11:00). The plan may wait for the next hour's trip: NEXT[k] is
    // the earliest arrival when ready at the start of a later bucket, and a trip ready at t arrives at
    // min(t + P[h], NEXT[k]).
    const NEXT = new Int32Array(nh * NN).fill(1e6);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      let A = 1e6;
      for (let h = nh - 1; h >= 0; h--) { const k = h * NN + a * n + b; NEXT[k] = A; A = Math.min((H[0] + h) * 60 + plan[k], A); }
    }
    const planAt = (a, b, t) => { if (a === b) return 0; const k = hourAt(t) * NN + a * n + b; return Math.min(plan[k], NEXT[k] - t); };
    // The least planned trip of each pair from 10:00 on (the search's bounds; to the last hour, because a later dinner
    // keeps the day going into the evening, S2), and the travel effort, the pair's average planned minutes over 10:00
    // to 20:59: for choosing between orders only, the same at any time, so comparing half-built days stays exact.
    const h10 = Math.max(0, 10 - H[0]), h20 = Math.min(nh - 1, 20 - H[0]);
    const minPlan = new Uint16Array(NN), effort = new Uint16Array(NN);
    for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
      if (a === b) continue;
      let m = Infinity, sum = 0;
      for (let h = h10; h < nh; h++) m = Math.min(m, plan[h * NN + a * n + b]);
      for (let h = h10; h <= h20; h++) sum += plan[h * NN + a * n + b];
      minPlan[a * n + b] = m;
      effort[a * n + b] = Math.round(sum / (h20 - h10 + 1));
    }
    // The least ride from the hostel to the flat while the luggage can go (14:00 to 17:59).
    const iH = index.get('hostel'), iF = index.get('flat');
    let minRide = Infinity;
    for (let h = Math.max(0, 14 - H[0]); h <= Math.min(nh - 1, 17 - H[0]); h++) minRide = Math.min(minRide, plan[h * NN + iH * n + iF]);
    T = {
      n, index, planArr: plan, nextArr: NEXT, nh, h0: H[0], minPlan, minRide, effort, plan: planAt,
      // The trip as the page shows it: the bucket the plan really leaves in (a later one when waiting for it is quicker).
      leg: (a, b, t) => {
        if (a === b) return null;
        let h = hourAt(t), k = h * NN + a * n + b;
        while (h < nh - 1 && NEXT[k] - t < plan[k] && (H[0] + h + 1) * 60 + plan[k + NN] === NEXT[k]) { h++; k += NN; }
        return { plan: planAt(a, b, t), min: show[k], walk: lab[k] < 0, mode: lab[k] < 0 ? 'walk' : M.labels[lab[k]] };
      },
    };
    transitCache.set(M, T);
    return T;
  }

  /* ---------------- opening hours ---------------- */
  // Feasible starts (spec 5.2 of v7, unchanged): per published interval, intersected with planWindow,
  // lo..latest where latest = min(last entry, interval end minus the visit). Sessions and fixed times
  // are filtered to these windows. Returns [{ lo, latest, sessions: [min] | null }].
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

  const isEvening = (o) => o.role === 'evening';
  const isSnack = (o) => o.role === 'snack';
  const isPastry = (o) => o.role === 'pastry';
  const isClass = (o) => !!(o && o.serves && 'class' in o.serves);
  const earlyOf = (o) => o.early ?? (o.fixedAt ? FRAME.FIXED_EARLY : 0);
  // No "around" for fixed times and for things with at most two sessions (the class at 11:00 or 13:00).
  const exactOf = (o) => !!o.fixedAt || (!!o.sessions && o.sessions.length <= 2);

  // A job's possible starts: [min] for fixed times, sessions and the roof at sunset; null for open windows.
  function startsOf(o) {
    if (isEvening(o) && !o.fixedAt) {
      const s = FRAME.SUNSET_START;
      return windowsOf(o).some((w) => s >= w.lo && s <= w.latest) ? [s] : [];
    }
    const ws = windowsOf(o);
    if (ws.some((w) => w.sessions)) return ws.flatMap((w) => w.sessions || []);
    return null;
  }
  // The first start at or after `t` on the grid, or null.
  function firstStart(job, t) {
    if (job.starts) { for (const s of job.starts) if (s >= t) return s; return null; }
    for (const w of job.wins) {
      const s = ceilTo(Math.max(t, w.lo), FRAME.GRID);
      if (s <= w.latest) return s;
    }
    return null;
  }

  /* ---------------- one exact search over the orders of a set of jobs (spec 3.5) ---------------- */
  // jobs: [{ kind: 'opt'|'lunch'|'plain'|'bags', o, node, minutes, early, wins, starts, fixed, pastry, snack,
  // snackLunch, deadline }]. Depth first over the orders, each job at its first feasible start after the trip. Mode
  // 'any' stops at the first order that fits; 'best' returns the order whose last entry ends earliest, then the least
  // travel effort, then the smallest sum of starts. A half-built day (time free, last start, lunch end; in 'best' also
  // effort and the sum of starts) at the same (jobs done, place) that is no better in every part than one seen before
  // is dropped: with first-in-first-out trips and waiting allowed, earlier is never worse, so this is exact.
  // Returns { trips, starts, end, loc, path } or null.
  const K_OPT = 0, K_LUNCH = 1, K_PLAIN = 2, K_BAGS = 3;
  const KIND_OF = { opt: K_OPT, lunch: K_LUNCH, plain: K_PLAIN, bags: K_BAGS };
  function search(ctx, jobs, mode) {
    const F = ctx.F, T = ctx.T, n = jobs.length, full = (1 << n) - 1;
    const NN = T.n, NN2 = NN * NN, PA = T.planArr, EF = T.effort, nh = T.nh, h0 = T.h0, hostel = ctx.hostel, flat = ctx.flat;
    const best = mode === 'best', exhaustive = ctx.exhaustive, budget = ctx.budget;
    const STEP = F.STEP, GRID = F.GRID, NOON = F.NOON, LUNCH_FROM = F.LUNCH_FROM, LUNCH_BY = F.LUNCH_BY, EVENING_END = F.EVENING_END;
    const SNACK_END = ctx.dinnerAt - F.SNACK_GAP; // S3: from her dinner time
    const KIND = new Int8Array(n), NODE = new Int32Array(n), MIN = new Int32Array(n), EARLY = new Int32Array(n);
    // Bounds (spec 3.5): the least trip into each job (from any place of this set, the hostel or the flat, at any hour
    // from 10:00), its least length with that trip, and its last start. A branch dies when a job left can no longer
    // start in time, when the jobs left cannot all fit before the day's end, or (in 'best') when it cannot end earlier.
    const LEG = new Float64Array(n), NEED = new Float64Array(n), DL = new Float64Array(n), MLI = new Float64Array(n);
    let pastryMask = 0, lunchMask = 0, bagsBit = 0, snackMask = 0, snackLunchMask = 0, fixedMask = 0;
    const srcs = [hostel, flat];
    for (const j of jobs) if (j.node !== undefined) srcs.push(j.node);
    // (the day can stand at the hostel when the luggage comes, so its least trip in is 0)
    const minInto = (b) => { if (b === hostel) return 0; let m = Infinity; for (const a of srcs) if (a !== b && T.minPlan[a * NN + b] < m) m = T.minPlan[a * NN + b]; return m; };
    jobs.forEach((j, i) => {
      const bit = 1 << i, k = KIND_OF[j.kind];
      KIND[i] = k;
      if (j.pastry) pastryMask |= bit;
      if (k === K_LUNCH || k === K_PLAIN) lunchMask |= bit;
      if (k === K_BAGS) bagsBit |= bit;
      if (j.snack) snackMask |= bit;
      if (j.snackLunch) snackLunchMask |= bit;
      if (j.fixed) fixedMask |= bit;
      if (k === K_PLAIN) { LEG[i] = 0; NEED[i] = F.LUNCH_MINUTES; DL[i] = LUNCH_BY; MLI[i] = 0; }
      else if (k === K_BAGS) { LEG[i] = T.minRide; NEED[i] = T.minRide + F.BAGS_GRAB + F.AT_FLAT; DL[i] = F.BAGS_TO; MLI[i] = 0; }
      else {
        NODE[i] = j.node; MIN[i] = j.minutes; EARLY[i] = j.early;
        LEG[i] = minInto(j.node); NEED[i] = LEG[i] + j.early + j.minutes; MLI[i] = LEG[i] + j.early;
        DL[i] = k === K_LUNCH ? Math.min(j.deadline, LUNCH_BY) : j.deadline;
      }
    });
    // The luggage bound: with the luggage still to come, either everything else left fits before its latest start
    // (BAGS_TO) or something comes after it, and the first thing after it is reached from the flat (FLAT_EXTRA[i]: how
    // much more the flat's least trip into i is than i's least trip from anywhere).
    const FLAT_EXTRA = new Float64Array(n);
    let bagsNeed = 0;
    jobs.forEach((j, i) => {
      if (KIND[i] === K_BAGS) bagsNeed = NEED[i];
      else if (KIND[i] !== K_PLAIN) FLAT_EXTRA[i] = Math.max(0, T.minPlan[flat * NN + j.node] - LEG[i]);
      else FLAT_EXTRA[i] = Infinity; // lunch is never after the luggage
    });
    const memo = new Map();
    let found = null, nodes = 0, cut = false;
    const path = [];
    function dominated(key, t, s, le, tr, st) {
      if (exhaustive) return false; // the reference run: every order, no pruning
      const L = memo.get(key);
      if (L === undefined) { memo.set(key, [t, s, le, tr, st]); return false; }
      const m = L.length;
      for (let q = 0; q < m; q += 5) if (L[q] <= t && L[q + 1] <= s && L[q + 2] <= le && (!best || (L[q + 3] <= tr && L[q + 4] <= st))) return true;
      let w = 0;
      for (let q = 0; q < m; q += 5) {
        if (t <= L[q] && s <= L[q + 1] && le <= L[q + 2] && (!best || (tr <= L[q + 3] && st <= L[q + 4]))) continue;
        if (w !== q) { L[w] = L[q]; L[w + 1] = L[q + 1]; L[w + 2] = L[q + 2]; L[w + 3] = L[q + 3]; L[w + 4] = L[q + 4]; }
        w += 5;
      }
      L.length = w;
      L.push(t, s, le, tr, st);
      return false;
    }
    function finish(t, loc, tr, st) {
      if (t + ctx.toDinner(loc, t) > ctx.dinnerAt) return;
      if (!found || t < found.end || (t === found.end && (tr < found.trips || (tr === found.trips && st < found.starts)))) found = { trips: tr, starts: st, end: t, loc, path: path.slice() };
    }
    function dfs(mask, t, s, loc, le, tr, st, need) {
      nodes++;
      if (mask === full) { finish(t, loc, tr, st); return; }
      if (!exhaustive) {
        if (ctx.nodes + nodes > budget) { cut = true; return; }
        if (t + need > ((mask & bagsBit) ? EVENING_END : ctx.dinnerAt)) return;
        if (best && found && t + need > found.end) return;
        for (let i = 0; i < n; i++) if (!(mask & (1 << i)) && t + MLI[i] > DL[i]) return;
        if (!(mask & bagsBit) && t + need - bagsNeed > F.BAGS_TO) {
          let extra = Infinity;
          for (let i = 0; i < n; i++) if (!(mask & (1 << i)) && FLAT_EXTRA[i] < extra) extra = FLAT_EXTRA[i];
          if (t + need + extra > EVENING_END) return;
        }
      }
      const lunchDone = (mask & lunchMask) !== 0, pastriesDone = (mask & pastryMask) === pastryMask;
      let h = ((t / 60) | 0) - h0;
      if (h < 0) h = 0; else if (h > nh - 1) h = nh - 1;
      const hb = h * NN2 + loc * NN, QA = T.nextArr;
      for (let i = 0; i < n; i++) {
        const bit = 1 << i;
        if (mask & bit) continue;
        if (!pastriesDone && !(pastryMask & bit)) continue;      // breakfast first
        const k = KIND[i];
        let start, end, nloc = loc, leg = 0, eff = 0, nle = le, ride = 0, flatAt = 0;
        if (k === K_PLAIN) {
          start = Math.ceil(Math.max(t, LUNCH_FROM, s + STEP) / GRID) * GRID;
          if (start > LUNCH_BY) continue;
          end = start + F.LUNCH_MINUTES; nle = end;
        } else if (k === K_BAGS) {
          if (!lunchDone) continue;
          leg = loc === hostel ? 0 : Math.min(PA[hb + hostel], QA[hb + hostel] - t);
          start = Math.ceil(Math.max(t + leg, F.BAGS_FROM, s + STEP) / GRID) * GRID;
          if (start > F.BAGS_TO) continue;
          ride = T.plan(hostel, flat, start + F.BAGS_GRAB);
          flatAt = Math.max(start + F.BAGS_GRAB + ride, F.CHECKIN);
          end = flatAt + F.AT_FLAT; nloc = flat;
          eff = (loc === hostel ? 0 : EF[loc * NN + hostel]) + EF[hostel * NN + flat];
          leg += ride;
        } else {
          const node = NODE[i];
          leg = loc === node ? 0 : Math.min(PA[hb + node], QA[hb + node] - t);
          let earliest = t + leg + EARLY[i];
          if (s + STEP > earliest) earliest = s + STEP;
          if ((snackLunchMask & bit) && earliest < LUNCH_FROM) earliest = LUNCH_FROM;
          if (snackMask & bit) { if (!lunchDone) continue; if (le + F.SNACK_GAP > earliest) earliest = le + F.SNACK_GAP; }
          start = firstStart(jobs[i], earliest);
          if (start === null) continue;
          if (k === K_LUNCH) { if (start > LUNCH_BY) continue; }
          else if (!lunchDone && !(fixedMask & bit) && start >= NOON) continue; // lunch comes first
          end = start + MIN[i];
          if (end > EVENING_END) continue;
          if ((snackMask & bit) && end > SNACK_END) continue;
          if (k === K_LUNCH) nle = end;
          eff = loc === node ? 0 : EF[loc * NN + node];
          nloc = node;
        }
        const ntr = tr + eff, nst = st + start;
        if (dominated((mask | bit) * 64 + nloc, end, start, nle, ntr, nst)) continue;
        path.push({ i, start, end, from: loc, depart: t, flatAt });
        dfs(mask | bit, end, start, nloc, nle, ntr, nst, need - NEED[i]);
        path.pop();
        if ((found && !best) || cut) return;
      }
    }
    let need0 = 0;
    for (let i = 0; i < n; i++) need0 += NEED[i];
    dfs(0, ctx.START, -Infinity, hostel, Infinity, 0, 0, need0);
    ctx.nodes += nodes;
    if (cut) { ctx.cut++; return best ? found : null; } // over budget: 'any' says no (the pick waits in the list)
    return found;
  }

  /* ---------------- build(C, picks, { dinnerAt, dinner, transit }) -> plan ---------------- */
  const byIdCache = new WeakMap();
  const optionsById = (C) => {
    let m = byIdCache.get(C);
    if (!m) { m = Object.fromEntries(C.options.map((o) => [o.id, o])); byIdCache.set(C, m); }
    return m;
  };
  const jobCache = new WeakMap(); // per travel table, per option
  function jobOf(T, o, kind = 'opt', snackLunch = false) {
    let byO = jobCache.get(T);
    if (!byO) { byO = new WeakMap(); jobCache.set(T, byO); }
    let per = byO.get(o);
    if (!per) { per = {}; byO.set(o, per); }
    const key = kind + (snackLunch ? '+' : '');
    if (per[key]) return per[key];
    const starts = startsOf(o);
    const wins = windowsOf(o);
    const j = {
      kind, o, id: o.id, node: T.index.get(o.id), minutes: o.minutes, early: earlyOf(o), wins, starts,
      fixed: !!o.fixedAt || isEvening(o), pastry: isPastry(o), snack: kind === 'opt' && isSnack(o), snackLunch,
      deadline: starts ? (starts.length ? starts[starts.length - 1] : -1) : (wins.length ? wins[wins.length - 1].latest : -1),
    };
    per[key] = j;
    return j;
  }
  const PLAIN = Object.freeze({ kind: 'plain', id: 'lunch', deadline: FRAME.LUNCH_BY });
  const BAGS = Object.freeze({ kind: 'bags', id: 'bags', deadline: FRAME.BAGS_TO });
  // A fit test's answer depends only on its jobs, the frame and dinner, so it is remembered across builds (spec 3.6).
  const testCache = new WeakMap();
  const cacheKeys = new Set();
  const clearCache = () => { for (const k of cacheKeys) k.clear(); };
  const appendOf = new WeakMap();

  /* `picks` are her priority list ([{ id, reason }] or ids). `dinnerAt` is her dinner time (one of
     anchors.dinner.times; anything else is the default), `dinner` her pizza place (an id of dinners.ideas) or null:
     with none picked, dinner is the nearest of the three from where the day ends. `transit` defaults to C.transit. */
  function build(C, pickList, opts = {}) { return buildDay(C, pickList, opts, false); }
  function buildDay(C, pickList, { dinnerAt = null, dinner = null, transit = null } = {}, exhaustive) {
    const T = transitOf(transit || C.transit);
    const O = optionsById(C);
    const ids = [...new Set(pickList.map((p) => (typeof p === 'string' ? p : p.id)))].filter((id) => O[id]);
    const cant = ids.map((id) => O[id]).filter((o) => o.fridayNo);
    const P = ids.map((id) => O[id]).filter((o) => !o.fridayNo);
    const at = (C.anchors.dinner.times || []).includes(dinnerAt) ? dinnerAt : C.anchors.dinner.time;
    const ideas = C.dinners.ideas;
    const place = ideas.find((d) => d.id === dinner) || null;
    const ideaNodes = (place ? [place] : ideas).map((d) => T.index.get(d.id));
    const ctx = {
      T, START: toMin(C.meta.startsAt.slice(11, 16)), dinnerAt: toMin(at),
      hostel: T.index.get('hostel'), flat: T.index.get('flat'), nodes: 0, searches: 0,
      toDinner: (loc, t) => { let m = Infinity; for (const d of ideaNodes) m = Math.min(m, T.plan(loc, d, t)); return m; },
      exhaustive: !!exhaustive, budget: FRAME.NODE_BUDGET, cut: 0, hits: 0,
    };
    // This build's two frames: the evening end follows her dinner (S2).
    const ee = eveningEnd(ctx.dinnerAt);
    const FN = ee === FRAME.EVENING_END ? FRAME : Object.freeze({ ...FRAME, EVENING_END: ee });
    const FE = ee === FRAME.EVENING_END ? FRAME_EARLY : Object.freeze({ ...FRAME_EARLY, EVENING_END: ee });
    const anyLunch = P.some((o) => o.lunch);
    const kept = [];       // jobs, in priority order
    let lunch = null;      // the lunch job (an option) or null for the plain line
    const later = [];
    const order = (list) => [...list].sort((a, b) => a.deadline - b.deadline || (a.id < b.id ? -1 : 1));
    let lastFit = null;
    let cache = testCache.get(T);
    if (!cache) { cache = new Map(); testCache.set(T, cache); cacheKeys.add(cache); }
    const keyBase = `${ctx.dinnerAt}|${place ? place.id : ''}|`;
    const fits = (list, L) => {
      const early = !list.some((j) => j.pastry);
      ctx.F = early ? FE : FN;
      ctx.searches++;
      const jobsHere = order([...list, L || PLAIN, BAGS]);
      const key = keyBase + (early ? 'E' : 'N') + jobsHere.map((j) => j.id + (j.kind === 'lunch' ? (j.snackLunch ? '+' : '*') : '')).join(',');
      let r = ctx.exhaustive ? undefined : cache.get(key);
      if (r === undefined) {
        ctx.budget = ctx.nodes + FRAME.NODE_BUDGET;
        r = search(ctx, jobsHere, 'any');
        if (!ctx.exhaustive) { if (cache.size >= FRAME.CACHE_MAX) cache.clear(); cache.set(key, r); }
      } else ctx.hits++;
      if (r) lastFit = { jobs: jobsHere, sol: r };
      return r;
    };
    // Walk her list: one lunch (a lunch place, else a snack as lunch when no lunch place is among her picks, else
    // "Lunch wherever we are"); every other pick is kept when the day still has an order with it, else it waits.
    let things = 0;
    for (const o of P) {
      if (o.lunch) {
        if (lunch) { later.push(o); continue; }
        const L = jobOf(T, o, 'lunch');
        if (fits(kept, L)) lunch = L; else later.push(o);
        continue;
      }
      if (isSnack(o) && !anyLunch && !lunch) {
        const L = jobOf(T, o, 'lunch', true);
        if (fits(kept, L)) { lunch = L; continue; }
      }
      if (things >= FRAME.MAX_THINGS) { later.push(o); continue; }
      const J = jobOf(T, o);
      if (fits([...kept, J], lunch)) { kept.push(J); things++; } else later.push(o);
    }
    // What an appended pick would do (More ideas): the same test the walk above would make for one more pick.
    const appendFits = (o) => {
      if (!o || o.fridayNo || P.includes(o)) return false;
      if (o.lunch) {
        if (lunch && !lunch.snackLunch) return false;
        if (lunch && lunch.snackLunch) return null; // a lunch place after a snack lunch changes the snack: build again
        return !!fits(kept, jobOf(T, o, 'lunch'));
      }
      if (isSnack(o) && !anyLunch && !lunch && fits(kept, jobOf(T, o, 'lunch', true))) return true;
      if (things >= FRAME.MAX_THINGS) return false;
      return !!fits([...kept, jobOf(T, o)], lunch);
    };
    let jobs = order([...kept, lunch || PLAIN, BAGS]);
    ctx.F = kept.some((j) => j.pastry) ? FN : FE;
    ctx.budget = ctx.nodes + FRAME.NODE_BUDGET; // the final ordering gets its own budget
    let sol = search(ctx, jobs, 'best');
    if (!sol && lastFit) ({ jobs, sol } = lastFit); // only past the budget: the last order the walk found
    if (!sol) throw new Error('no day for the kept picks (cannot happen: each was kept by the same test)');

    // The entries, in time order, each with the trip into it (spec 5).
    const F = ctx.F;
    const Anc = C.anchors;
    const items = [{ kind: 'anchor', id: 'arrival', anchor: Anc.arrival, start: toMin(Anc.arrival.time), slot: 'morning', rough: Anc.arrival.time, exact: true, trip: null }];
    let lunchSeen = false;
    const legOf = (from, to, depart) => { const l = T.leg(from, to, depart); return l ? { min: l.min, plan: l.plan, walk: l.walk, mode: l.mode } : null; };
    for (const step of sol.path) {
      const j = jobs[step.i];
      const show = roundTo(step.start, F.SHOW);
      if (j.kind === 'plain') {
        lunchSeen = true;
        items.push({ kind: 'lunch-filler', start: step.start, end: step.end, slot: 'lunch', rough: hhmm(show), exact: false, lead: true, trip: null });
      } else if (j.kind === 'bags') {
        items.push({ kind: 'anchor', id: 'bags', anchor: Anc.bags, start: step.start, end: step.end, flatAt: step.flatAt, slot: 'afternoon', rough: hhmm(show), exact: false,
          trip: legOf(step.from, ctx.hostel, step.depart) });
      } else {
        const o = j.o, isL = j.kind === 'lunch';
        if (isL) lunchSeen = true;
        const exact = exactOf(o);
        const rough = exact ? hhmm(step.start) : hhmm(show);
        const slot = isL ? 'lunch' : !lunchSeen ? 'morning' : toMin(rough) < toMin('17:00') ? 'afternoon' : 'evening';
        const it = { kind: 'option', id: o.id, option: o, start: step.start, end: step.end, slot, rough, exact, trip: legOf(step.from, j.node, step.depart) };
        if (isL) { it.lead = true; if (j.snackLunch) it.asLunch = true; }
        items.push(it);
      }
    }
    // Dinner: with her pizza place picked, the trip there at the latest departure that still makes dinner (S4).
    let leave = sol.end, dinnerTrip = null;
    if (place) {
      const pn = T.index.get(place.id);
      while (leave + 1 + T.plan(sol.loc, pn, leave + 1) <= ctx.dinnerAt) leave++;
      dinnerTrip = legOf(sol.loc, pn, leave);
    }
    items.push({ kind: 'anchor', id: 'dinner', anchor: Anc.dinner, start: toMin(at), slot: 'evening', rough: at, exact: false, trip: dinnerTrip, leave });
    // Two pastry stops in one day: the later one is second breakfast.
    const breakfasts = (C.departures && C.departures.breakfasts) || [];
    items.filter((it) => it.kind === 'option' && breakfasts.includes(it.id)).slice(1).forEach((it) => { it.secondBreakfast = true; });
    const cardsOn = items.filter((it) => it.kind === 'option');
    const bagsIt = items.find((it) => it.id === 'bags');
    const result = {
      items,
      options: cardsOn.map((it) => it.option),
      later: later.map((o) => ({ id: o.id, option: o })),
      didntFit: cant.map((o) => ({ option: o, code: 'fridayNo', why: o.fridayNo, reason: o.fridayNo })),
      things: cardsOn.filter((it) => !it.option.lunch && !it.asLunch).length,
      earlyLunch: F.NOON === FRAME.NOON_EARLY,
      bags: { start: bagsIt.start, end: bagsIt.end },
      dinnerAt: at,
      dinner: place ? place.id : null,
      stats: { searches: ctx.searches, nodes: ctx.nodes, cut: ctx.cut, hits: ctx.hits },
    };
    appendOf.set(result, (o) => { ctx.budget = ctx.nodes + FRAME.NODE_BUDGET; return appendFits(o); });
    return result;
  }

  /* "If there's time" (spec 4.2): Swap in puts a pick first in her list, so it goes on the day exactly when it fits
     on its own, with lunch, the luggage and dinner at her time. One small search. */
  function canSwapIn(C, id, opts) {
    return build(C, [id], opts).options.some((o) => o.id === id);
  }

  /* ---------------- the composer and her priority list ---------------- */

  // `wander` covers every wander:<area> key, so the area cards can swap with each other.
  const servesKey = (o, reason) => Object.keys(o.serves || {}).find((k) => (reason === 'wander' ? k.startsWith('wander:') : k === reason));
  const rankFor = (o, reason) => { const k = servesKey(o, reason); return k ? o.serves[k] : null; };
  // An option's home (what Swap swaps within).
  const bestReason = (o) => {
    const [k] = Object.entries(o.serves || {}).sort((a, b) => a[1] - b[1])[0] || [];
    return k && k.startsWith('wander:') ? 'wander' : k || null;
  };
  const optsOf = (C, ids) => { const O = optionsById(C); return ids.map((id) => O[id]).filter(Boolean); };
  const byOrder = (a, b) => a.order - b.order;

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

  /* Her priority list (spec 3.4, ruling S5): the things she named, in the order she pressed them; then the class, her
     areas in her tap order (v9f F6), her wild card (one tap chose one thing); then the category picks: the pastry stop, the lunch place, the
     sights in her tap order, the street food. Anything else (a hand Add) keeps its place after them. Stable, so a
     list already in this order stays as it is. */
  const TIER = { class: 1, wander: 2, wild: 3, pastry: 4, lunch: 5, street: 7 };
  // v9f F6 (felix-11.md): she can tap more than one area; her areas are the tile ids in her tap order. An answer stored
  // before v9f holds one area as a string (or null).
  const areasOf = (answers) => [].concat(answers.wander || []).filter(Boolean);
  const areaOptions = (C, answers) => {
    const step = C.ask.steps.find((s) => s.id === 'wander');
    return areasOf(answers).map((v) => step && step.tiles.find((t) => t.id === v)).filter(Boolean).map((t) => t.option);
  };
  function priorityOrder(C, picks, answers = {}) {
    const want = answers.want || [], see = answers.see || [];
    const areas = areaOptions(C, answers);
    const key = (p, i) => {
      const w = want.indexOf(p.id);
      if (w >= 0) return [0, w, i];
      // Her areas in her tap order (an area she did not tap, from Use this, after them).
      if (p.reason === 'wander') { const a = areas.indexOf(p.id); return [TIER.wander, a >= 0 ? a : areas.length, i]; }
      if (p.reason in TIER) return [TIER[p.reason], 0, i];
      const s = see.indexOf(p.reason);
      if (s >= 0) return [6, s, i];
      return [8, 0, i];
    };
    return picks.map((p, i) => ({ p, k: key(p, i) }))
      .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2]).map((x) => x.p);
  }

  /* compose(C, answers) -> { picks, extras: [] }: her answers become picks, each carrying the answer it came from,
     in her priority order. Every option has one home (`serves`, one key: reason -> rank, lower is better). No caps:
     build() keeps what fits and lists the rest. `extras` is always empty (kept for old callers). */
  const FOOD_FIRST = ['class', 'pastry', 'lunch'];
  const STREET = 'street';
  function compose(C, answers = {}) {
    const O = optionsById(C);
    const can = (o) => !!o && !o.fridayNo;
    const see = answers.see || [], eat = answers.eat || [];
    const areas = areaOptions(C, answers), wild = answers.wild || null;
    // v9c C1d (felix-2.md 6): nothing answered gives a light day, her picks only (none); no default fill.
    if (!see.length && !eat.length && !areasOf(answers).length && !wild) return { picks: [], extras: [] };
    const picks = [];
    const ids = () => picks.map((p) => p.id);
    const on = (id) => picks.some((p) => p.id === id);
    const add = (id, reason, want = false) => { picks.push({ id, reason, want }); };
    // 1. Every thing she named, in pressed order, that serves one of her answers.
    for (const id of answers.want || []) {
      const o = O[id];
      if (!can(o) || on(id)) continue;
      const reason = wantReason(o, answers);
      if (reason) add(id, reason, true);
    }
    // 2. Her areas (v9f F6: each one she tapped, in her tap order) and her wild card.
    for (const id of areas) if (can(O[id]) && !on(id)) add(id, 'wander');
    if (wild && can(O[wild]) && !on(wild)) add(wild, 'wild');
    const namedUnder = (reason) => picks.some((p) => p.want && p.reason === reason);
    const best = (reason, keepIf = () => true) => ranked(C, reason, ids(), ids(), (o) => can(o) && keepIf(o))[0] || null;
    // 3. Food she tapped with nothing named under it: the class, a pastry, lunch (none once the class is on).
    for (const reason of FOOD_FIRST) {
      if (!eat.includes(reason) || namedUnder(reason)) continue;
      if (reason === 'lunch' && picks.some((p) => isClass(O[p.id]))) continue;
      const o = best(reason);
      if (o) add(o.id, reason);
    }
    // 4. Sights she tapped with nothing named under them, in tap order.
    for (const reason of see) {
      if (namedUnder(reason)) continue;
      const o = best(reason);
      if (o) add(o.id, reason);
    }
    // 5. Street food: the market while the day has no lunch; with lunch on, the best street option that
    //    is not a snack (a snack keeps two hours after lunch; v8 fold-in, mechanics F4), else the best street option.
    if (eat.includes(STREET) && !namedUnder(STREET)) {
      const lunchOn = picks.some((p) => O[p.id].lunch);
      const o = (!lunchOn && best(STREET, (x) => !!x.lunch)) || (lunchOn && best(STREET, (x) => !x.lunch && !isSnack(x))) || best(STREET);
      if (o) add(o.id, STREET);
    }
    return { picks: priorityOrder(C, picks.map(({ id, reason }) => ({ id, reason })), answers), extras: [] };
  }

  /* Swap (spec 8.8 of v8): up to three options from the same home that are not on the day and can happen on
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

  /* More ideas (spec 4.3): v8's order (what serves her answers, best score first and one per answer; then what is
     within NEAR_M of her day; then the rest of what serves her answers), keeping only ideas that would go on her day
     as she has it (appended to her list, so adding one never moves anything off it): the first three. `plan` is
     build()'s result for the same picks and options. Returns { ideas: [{ id, reason }], tried }. */
  function suggestionsFit(C, picks, answers, opts, plan) {
    const O = optionsById(C);
    const ids = picks.map((p) => p.id);
    const out = [], seen = new Set(ids);
    const append = appendOf.get(plan);
    let tried = 0;
    const tryTake = (id, reason) => {
      if (out.length >= 3 || seen.has(id)) return;
      const o = O[id];
      if (!o || o.fridayNo) return;
      seen.add(id);
      tried++;
      let ok = append(o);
      if (ok === null) ok = build(C, [...picks, { id, reason }], opts).options.some((x) => x.id === id);
      if (ok) out.push({ id, reason });
    };
    const answered = [...(answers.see || []), ...(answers.eat || []), ...(areasOf(answers).length ? ['wander'] : []), ...(answers.wild ? ['wild'] : [])];
    const serving = answered.flatMap((reason) => ranked(C, reason, ids, ids, (o) => !o.fridayNo)
      .map((o) => ({ id: o.id, reason, s: scoreOf(C, o, reason, ids), order: o.order }))).sort((a, b) => a.s - b.s || a.order - b.order);
    const homes = new Set();
    for (const x of serving) if (!homes.has(x.reason)) { const before = out.length; tryTake(x.id, x.reason); if (out.length > before) homes.add(x.reason); }
    const placed = plan.options.filter((o) => typeof o.lat === 'number');
    if (placed.length) {
      C.options.filter((o) => !seen.has(o.id) && !o.fridayNo && typeof o.lat === 'number')
        .map((o) => ({ o, d: Math.min(...placed.map((p) => haversine(o, p))) }))
        .filter((x) => x.d <= FRAME.NEAR_M).sort((a, b) => a.d - b.d || a.o.order - b.o.order)
        .forEach((x) => tryTake(x.o.id, 'added'));
    }
    for (const x of serving) tryTake(x.id, x.reason);
    return { ideas: out, tried };
  }

  /* See everything's Add: it always works, unless the thing cannot happen on Friday at all. Adding appends to her
     list, so it never moves anything off her day (it may wait under "If there's time"). */
  function catalogueAdd(C, picks, id) {
    const o = optionsById(C)[id];
    if (o && o.fridayNo) return { ok: false, code: 'fridayNo', vars: { why: o.fridayNo } };
    return { ok: true, yields: [] };
  }

  root.VenerdiPlan = {
    build, compose, priorityOrder, alternatives, suggestionsFit, canSwapIn, catalogueAdd, bestReason, wantReason, toMin, hhmm, fmt,
    haversine, windowsOf, FRAME,
    // For the checks only: forget the remembered fit tests (cold timings), and the same build with every order tried
    // and no pruning (the sweep's exhaustive reference).
    clearCache, buildExhaustive: (C, pickList, opts = {}) => buildDay(C, pickList, opts, true),
  };
})(typeof window !== 'undefined' ? window : globalThis);
