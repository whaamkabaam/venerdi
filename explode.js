/* Explode everything (v9e, "real physics"; v9f: the button "Don't press me"). app.js loads this file when the button
   at the bottom comes near, or on its tap. Every component of the page becomes a solid box with weight: the real elements are moved with
   transforms (nothing is cloned, captured or drawn again), so a photo stays a photo and a flap stays a flap. A small
   rigid-body solver after Erin Catto's Box2D-Lite (MIT; box against box, contacts with warm starting, a hinge and a
   finger joint) gives the weight and the collisions. The blast starts at the button; the camera pulls back so the
   long page fits on her screen; what she scrolled past comes down from the top, nearest first, and the ARRIVALS
   board lands last. The heap stays live (grab, fling, tap) until a reload, which brings the page back as it was:
   nothing about the explosion is stored. */
(() => {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* The solver                                                          */
  /* ------------------------------------------------------------------ */

  // World units are CSS px at the page's own size; the camera scales them onto the screen.
  const W = {
    bodies: [], arbiters: new Map(), joints: [], stamp: 0,
    gravity: 5200, gx: 0, gy: 5200, iterations: 8, slop: 1, baum: 0.2, maxBias: 320, restitution: 0.18, restThreshold: 260,
  };
  let nextId = 1;
  function makeBody(w, h, mass) {
    const b = {
      id: nextId++, x: 0, y: 0, a: 0, vx: 0, vy: 0, w: 0, hw: w / 2, hh: h / 2, fr: 0.55,
      m: mass, im: 0, I: 0, iI: 0, live: false, ghost: false, minX: 0, maxX: 0, minY: 0, maxY: 0, piece: null,
    };
    setMass(b, mass);
    return b;
  }
  function setMass(b, m) {
    b.m = m;
    if (m > 0) { b.im = 1 / m; b.I = m * (4 * b.hw * b.hw + 4 * b.hh * b.hh) / 12; b.iI = 1 / b.I; } else { b.im = 0; b.I = 0; b.iI = 0; }
  }

  // Box against box (Box2D-Lite Collide.cpp): the axis of least penetration, then the incident edge clipped
  // against the reference face's sides. Up to two contacts, each with a feature key for warm starting.
  const INC = new Float64Array(6), CL1 = new Float64Array(6), CL2 = new Float64Array(6);
  function clip(vIn, out, nx, ny, off, edge) {
    let n = 0;
    const d0 = nx * vIn[0] + ny * vIn[1] - off, d1 = nx * vIn[3] + ny * vIn[4] - off;
    if (d0 <= 0) { out[0] = vIn[0]; out[1] = vIn[1]; out[2] = vIn[2]; n = 1; }
    if (d1 <= 0) { out[n * 3] = vIn[3]; out[n * 3 + 1] = vIn[4]; out[n * 3 + 2] = vIn[5]; n++; }
    if (d0 * d1 < 0 && n < 2) {
      const t = d0 / (d0 - d1);
      out[n * 3] = vIn[0] + t * (vIn[3] - vIn[0]);
      out[n * 3 + 1] = vIn[1] + t * (vIn[4] - vIn[1]);
      if (d0 > 0) { const f = vIn[2]; out[n * 3 + 2] = (f & ~(7 | (7 << 6))) | edge; } else { const f = vIn[5]; out[n * 3 + 2] = (f & ~((7 << 3) | (7 << 9))) | (edge << 3); }
      n++;
    }
    return n;
  }
  function incident(hx, hy, px, py, c, s, nx, ny) {
    // The reference normal in the incident box's frame, flipped.
    const lx = -(c * nx + s * ny), ly = -(-s * nx + c * ny);
    let ax, ay, f0, bx, by, f1;
    if (Math.abs(lx) > Math.abs(ly)) {
      if (lx > 0) { ax = hx; ay = -hy; f0 = (3 << 6) | (4 << 9); bx = hx; by = hy; f1 = (4 << 6) | (1 << 9); }
      else { ax = -hx; ay = hy; f0 = (1 << 6) | (2 << 9); bx = -hx; by = -hy; f1 = (2 << 6) | (3 << 9); }
    } else if (ly > 0) { ax = hx; ay = hy; f0 = (4 << 6) | (1 << 9); bx = -hx; by = hy; f1 = (1 << 6) | (2 << 9); }
    else { ax = -hx; ay = -hy; f0 = (2 << 6) | (3 << 9); bx = hx; by = -hy; f1 = (3 << 6) | (4 << 9); }
    INC[0] = px + c * ax - s * ay; INC[1] = py + s * ax + c * ay; INC[2] = f0;
    INC[3] = px + c * bx - s * by; INC[4] = py + s * bx + c * by; INC[5] = f1;
  }
  const flipF = (f) => ((f >> 6) & 7) | (((f >> 9) & 7) << 3) | ((f & 7) << 6) | (((f >> 3) & 7) << 9);
  function collide(A, B, out) {
    const hAx = A.hw, hAy = A.hh, hBx = B.hw, hBy = B.hh;
    const cA = Math.cos(A.a), sA = Math.sin(A.a), cB = Math.cos(B.a), sB = Math.sin(B.a);
    const dpx = B.x - A.x, dpy = B.y - A.y;
    const dAx = cA * dpx + sA * dpy, dAy = -sA * dpx + cA * dpy;
    const dBx = cB * dpx + sB * dpy, dBy = -sB * dpx + cB * dpy;
    const a11 = Math.abs(cA * cB + sA * sB), a12 = Math.abs(-cA * sB + sA * cB), a21 = Math.abs(-sA * cB + cA * sB), a22 = Math.abs(sA * sB + cA * cB);
    const fAx = Math.abs(dAx) - hAx - (a11 * hBx + a12 * hBy), fAy = Math.abs(dAy) - hAy - (a21 * hBx + a22 * hBy);
    if (fAx > 0 || fAy > 0) return 0;
    const fBx = Math.abs(dBx) - (a11 * hAx + a21 * hAy) - hBx, fBy = Math.abs(dBy) - (a12 * hAx + a22 * hAy) - hBy;
    if (fBx > 0 || fBy > 0) return 0;
    let axis = 0, sep = fAx, nx = dAx > 0 ? cA : -cA, ny = dAx > 0 ? sA : -sA;
    if (fAy > 0.95 * sep + 0.01 * hAy) { axis = 1; sep = fAy; nx = dAy > 0 ? -sA : sA; ny = dAy > 0 ? cA : -cA; }
    if (fBx > 0.95 * sep + 0.01 * hBx) { axis = 2; sep = fBx; nx = dBx > 0 ? cB : -cB; ny = dBx > 0 ? sB : -sB; }
    if (fBy > 0.95 * sep + 0.01 * hBy) { axis = 3; sep = fBy; nx = dBy > 0 ? -sB : sB; ny = dBy > 0 ? cB : -cB; }
    let fnx, fny, front, snx, sny, negSide, posSide, negEdge, posEdge;
    if (axis === 0) {
      fnx = nx; fny = ny; front = A.x * fnx + A.y * fny + hAx; snx = -sA; sny = cA;
      const side = A.x * snx + A.y * sny; negSide = -side + hAy; posSide = side + hAy; negEdge = 3; posEdge = 1;
      incident(hBx, hBy, B.x, B.y, cB, sB, fnx, fny);
    } else if (axis === 1) {
      fnx = nx; fny = ny; front = A.x * fnx + A.y * fny + hAy; snx = cA; sny = sA;
      const side = A.x * snx + A.y * sny; negSide = -side + hAx; posSide = side + hAx; negEdge = 2; posEdge = 4;
      incident(hBx, hBy, B.x, B.y, cB, sB, fnx, fny);
    } else if (axis === 2) {
      fnx = -nx; fny = -ny; front = B.x * fnx + B.y * fny + hBx; snx = -sB; sny = cB;
      const side = B.x * snx + B.y * sny; negSide = -side + hBy; posSide = side + hBy; negEdge = 3; posEdge = 1;
      incident(hAx, hAy, A.x, A.y, cA, sA, fnx, fny);
    } else {
      fnx = -nx; fny = -ny; front = B.x * fnx + B.y * fny + hBy; snx = cB; sny = sB;
      const side = B.x * snx + B.y * sny; negSide = -side + hBx; posSide = side + hBx; negEdge = 2; posEdge = 4;
      incident(hAx, hAy, A.x, A.y, cA, sA, fnx, fny);
    }
    if (clip(INC, CL1, -snx, -sny, negSide, negEdge) < 2) return 0;
    if (clip(CL1, CL2, snx, sny, posSide, posEdge) < 2) return 0;
    let n = 0;
    for (let i = 0; i < 2; i++) {
      const vx = CL2[i * 3], vy = CL2[i * 3 + 1];
      const s = fnx * vx + fny * vy - front;
      if (s <= 0) {
        const c = out[n];
        c.sep = s; c.nx = nx; c.ny = ny; c.x = vx - s * fnx; c.y = vy - s * fny;
        c.f = axis >= 2 ? flipF(CL2[i * 3 + 2]) : CL2[i * 3 + 2];
        n++;
      }
    }
    return n;
  }
  const newContact = () => ({ x: 0, y: 0, nx: 0, ny: 0, sep: 0, f: 0, fresh: true, Pn: 0, Pt: 0, mn: 0, mt: 0, bias: 0, r1x: 0, r1y: 0, r2x: 0, r2y: 0 });
  const FRESH = [newContact(), newContact()];

  // Contacts that persist keep last step's impulses (Arbiter.cpp Update), which is what lets a heap rest.
  function arbiter(b1, b2) {
    const n = collide(b1, b2, FRESH);
    const key = b1.id * 8192 + b2.id;
    let arb = W.arbiters.get(key);
    if (!n) { if (arb) W.arbiters.delete(key); return; }
    if (!arb) { arb = { b1, b2, n: 0, c: [newContact(), newContact()], fr: Math.sqrt(b1.fr * b2.fr), stamp: 0 }; W.arbiters.set(key, arb); }
    arb.stamp = W.stamp;
    let p0 = 0, t0 = 0, p1 = 0, t1 = 0, n0 = true, n1 = true;
    for (let i = 0; i < n; i++) {
      const f = FRESH[i].f;
      let pn = 0, pt = 0, fresh = true;
      for (let j = 0; j < arb.n; j++) if (arb.c[j].f === f) { pn = arb.c[j].Pn; pt = arb.c[j].Pt; fresh = false; break; }
      if (i === 0) { p0 = pn; t0 = pt; n0 = fresh; } else { p1 = pn; t1 = pt; n1 = fresh; }
    }
    for (let i = 0; i < n; i++) {
      const c = arb.c[i], s = FRESH[i];
      c.x = s.x; c.y = s.y; c.nx = s.nx; c.ny = s.ny; c.sep = s.sep; c.f = s.f;
      c.Pn = i === 0 ? p0 : p1; c.Pt = i === 0 ? t0 : t1; c.fresh = i === 0 ? n0 : n1;
    }
    arb.n = n;
  }

  function broadphase() {
    const bs = W.live;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i], c = Math.abs(Math.cos(b.a)), s = Math.abs(Math.sin(b.a));
      const ex = c * b.hw + s * b.hh, ey = s * b.hw + c * b.hh;
      b.minX = b.x - ex; b.maxX = b.x + ex; b.minY = b.y - ey; b.maxY = b.y + ey;
    }
    // Sweep along x over a list that stays nearly sorted from step to step (insertion sort).
    for (let i = 1; i < bs.length; i++) { const b = bs[i]; let j = i - 1; while (j >= 0 && bs[j].minX > b.minX) { bs[j + 1] = bs[j]; j--; } bs[j + 1] = b; }
    W.stamp++;
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i];
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j];
        if (b.minX > a.maxX) break;
        if (b.minY > a.maxY || b.maxY < a.minY) continue;
        if (a.im === 0 && b.im === 0) continue;
        if (a.id < b.id) arbiter(a, b); else arbiter(b, a);
      }
    }
    for (const [k, arb] of W.arbiters) if (arb.stamp !== W.stamp) W.arbiters.delete(k);
  }

  function preStep(arb, inv) {
    const b1 = arb.b1, b2 = arb.b2;
    for (let i = 0; i < arb.n; i++) {
      const c = arb.c[i];
      const r1x = c.x - b1.x, r1y = c.y - b1.y, r2x = c.x - b2.x, r2y = c.y - b2.y;
      c.r1x = r1x; c.r1y = r1y; c.r2x = r2x; c.r2y = r2y;
      const rn1 = r1x * c.nx + r1y * c.ny, rn2 = r2x * c.nx + r2y * c.ny;
      c.mn = 1 / (b1.im + b2.im + b1.iI * (r1x * r1x + r1y * r1y - rn1 * rn1) + b2.iI * (r2x * r2x + r2y * r2y - rn2 * rn2));
      const tx = c.ny, ty = -c.nx;
      const rt1 = r1x * tx + r1y * ty, rt2 = r2x * tx + r2y * ty;
      c.mt = 1 / (b1.im + b2.im + b1.iI * (r1x * r1x + r1y * r1y - rt1 * rt1) + b2.iI * (r2x * r2x + r2y * r2y - rt2 * rt2));
      let bias = Math.min(W.maxBias, -W.baum * inv * Math.min(0, c.sep + W.slop));
      // A bounce on a hard landing (a contact that is new this step), none at rest and none once it is all settling.
      if (c.fresh && !W.settle) {
        const dvx = b2.vx - b2.w * r2y - b1.vx + b1.w * r1y, dvy = b2.vy + b2.w * r2x - b1.vy - b1.w * r1x;
        const vn = dvx * c.nx + dvy * c.ny;
        if (vn < -W.restThreshold) bias = Math.max(bias, -W.restitution * vn);
      }
      c.bias = bias;
      const Px = c.Pn * c.nx + c.Pt * tx, Py = c.Pn * c.ny + c.Pt * ty;
      b1.vx -= b1.im * Px; b1.vy -= b1.im * Py; b1.w -= b1.iI * (r1x * Py - r1y * Px);
      b2.vx += b2.im * Px; b2.vy += b2.im * Py; b2.w += b2.iI * (r2x * Py - r2y * Px);
    }
  }
  function applyImpulse(arb) {
    const b1 = arb.b1, b2 = arb.b2;
    for (let i = 0; i < arb.n; i++) {
      const c = arb.c[i];
      const r1x = c.r1x, r1y = c.r1y, r2x = c.r2x, r2y = c.r2y;
      let dvx = b2.vx - b2.w * r2y - b1.vx + b1.w * r1y, dvy = b2.vy + b2.w * r2x - b1.vy - b1.w * r1x;
      const vn = dvx * c.nx + dvy * c.ny;
      let dPn = c.mn * (-vn + c.bias);
      const Pn0 = c.Pn; c.Pn = Math.max(Pn0 + dPn, 0); dPn = c.Pn - Pn0;
      let Px = dPn * c.nx, Py = dPn * c.ny;
      b1.vx -= b1.im * Px; b1.vy -= b1.im * Py; b1.w -= b1.iI * (r1x * Py - r1y * Px);
      b2.vx += b2.im * Px; b2.vy += b2.im * Py; b2.w += b2.iI * (r2x * Py - r2y * Px);
      dvx = b2.vx - b2.w * r2y - b1.vx + b1.w * r1y; dvy = b2.vy + b2.w * r2x - b1.vy - b1.w * r1x;
      const tx = c.ny, ty = -c.nx;
      const vt = dvx * tx + dvy * ty;
      let dPt = c.mt * -vt;
      const maxPt = arb.fr * c.Pn, Pt0 = c.Pt;
      c.Pt = Math.max(-maxPt, Math.min(maxPt, Pt0 + dPt)); dPt = c.Pt - Pt0;
      Px = dPt * tx; Py = dPt * ty;
      b1.vx -= b1.im * Px; b1.vy -= b1.im * Py; b1.w -= b1.iI * (r1x * Py - r1y * Px);
      b2.vx += b2.im * Px; b2.vy += b2.im * Py; b2.w += b2.iI * (r2x * Py - r2y * Px);
    }
  }

  // A hinge (Box2D-Lite Joint.cpp): the bar at the top hangs from one corner for a moment.
  function hinge(b1, b2, ax, ay) {
    const c1 = Math.cos(b1.a), s1 = Math.sin(b1.a), c2 = Math.cos(b2.a), s2 = Math.sin(b2.a);
    const d1x = ax - b1.x, d1y = ay - b1.y, d2x = ax - b2.x, d2y = ay - b2.y;
    const j = { kind: 'hinge', b1, b2, l1x: c1 * d1x + s1 * d1y, l1y: -s1 * d1x + c1 * d1y, l2x: c2 * d2x + s2 * d2y, l2y: -s2 * d2x + c2 * d2y, Px: 0, Py: 0, r1x: 0, r1y: 0, r2x: 0, r2y: 0, m11: 0, m12: 0, m21: 0, m22: 0, bx: 0, by: 0 };
    W.joints.push(j);
    return j;
  }
  // Her finger (Box2D's mouse joint): a soft spring from the point she grabbed to her finger.
  function finger(b, wx, wy) {
    const c = Math.cos(b.a), s = Math.sin(b.a), dx = wx - b.x, dy = wy - b.y;
    const j = { kind: 'finger', b2: b, lx: c * dx + s * dy, ly: -s * dx + c * dy, tx: wx, ty: wy, Px: 0, Py: 0, rx: 0, ry: 0, m11: 0, m12: 0, m21: 0, m22: 0, cx: 0, cy: 0, gamma: 0, maxP: 0 };
    W.joints.push(j);
    return j;
  }
  function jointPre(j, dt) {
    const inv = 1 / dt;
    if (j.kind === 'hinge') {
      const b1 = j.b1, b2 = j.b2, c1 = Math.cos(b1.a), s1 = Math.sin(b1.a), c2 = Math.cos(b2.a), s2 = Math.sin(b2.a);
      j.r1x = c1 * j.l1x - s1 * j.l1y; j.r1y = s1 * j.l1x + c1 * j.l1y; j.r2x = c2 * j.l2x - s2 * j.l2y; j.r2y = s2 * j.l2x + c2 * j.l2y;
      const k11 = b1.im + b2.im + b1.iI * j.r1y * j.r1y + b2.iI * j.r2y * j.r2y;
      const k12 = -b1.iI * j.r1x * j.r1y - b2.iI * j.r2x * j.r2y;
      const k22 = b1.im + b2.im + b1.iI * j.r1x * j.r1x + b2.iI * j.r2x * j.r2x;
      const det = 1 / (k11 * k22 - k12 * k12);
      j.m11 = det * k22; j.m12 = -det * k12; j.m21 = -det * k12; j.m22 = det * k11;
      const dx = b2.x + j.r2x - b1.x - j.r1x, dy = b2.y + j.r2y - b1.y - j.r1y;
      j.bx = -0.2 * inv * dx; j.by = -0.2 * inv * dy;
      b1.vx -= b1.im * j.Px; b1.vy -= b1.im * j.Py; b1.w -= b1.iI * (j.r1x * j.Py - j.r1y * j.Px);
      b2.vx += b2.im * j.Px; b2.vy += b2.im * j.Py; b2.w += b2.iI * (j.r2x * j.Py - j.r2y * j.Px);
    } else {
      const b = j.b2, c = Math.cos(b.a), s = Math.sin(b.a);
      j.rx = c * j.lx - s * j.ly; j.ry = s * j.lx + c * j.ly;
      const omega = 2 * Math.PI * 6, zeta = 0.75, k = b.m * omega * omega, d = 2 * b.m * zeta * omega;
      j.gamma = 1 / (dt * (d + dt * k));
      const beta = dt * k * j.gamma;
      const k11 = b.im + b.iI * j.ry * j.ry + j.gamma, k12 = -b.iI * j.rx * j.ry, k22 = b.im + b.iI * j.rx * j.rx + j.gamma;
      const det = 1 / (k11 * k22 - k12 * k12);
      j.m11 = det * k22; j.m12 = -det * k12; j.m21 = -det * k12; j.m22 = det * k11;
      j.cx = (b.x + j.rx - j.tx) * beta; j.cy = (b.y + j.ry - j.ty) * beta;
      j.maxP = 900 * b.m * W.gravity * dt / 60;
      b.w *= 0.96;
      b.vx += b.im * j.Px; b.vy += b.im * j.Py; b.w += b.iI * (j.rx * j.Py - j.ry * j.Px);
    }
  }
  function jointSolve(j) {
    if (j.kind === 'hinge') {
      const b1 = j.b1, b2 = j.b2;
      const dvx = b2.vx - b2.w * j.r2y - b1.vx + b1.w * j.r1y, dvy = b2.vy + b2.w * j.r2x - b1.vy - b1.w * j.r1x;
      const ex = j.bx - dvx, ey = j.by - dvy;
      const ix = j.m11 * ex + j.m12 * ey, iy = j.m21 * ex + j.m22 * ey;
      b1.vx -= b1.im * ix; b1.vy -= b1.im * iy; b1.w -= b1.iI * (j.r1x * iy - j.r1y * ix);
      b2.vx += b2.im * ix; b2.vy += b2.im * iy; b2.w += b2.iI * (j.r2x * iy - j.r2y * ix);
      j.Px += ix; j.Py += iy;
    } else {
      const b = j.b2;
      const cdx = b.vx - b.w * j.ry, cdy = b.vy + b.w * j.rx;
      const ex = -(cdx + j.cx + j.gamma * j.Px), ey = -(cdy + j.cy + j.gamma * j.Py);
      let ix = j.m11 * ex + j.m12 * ey, iy = j.m21 * ex + j.m22 * ey;
      const ox = j.Px, oy = j.Py;
      j.Px += ix; j.Py += iy;
      const len = Math.hypot(j.Px, j.Py);
      if (len > j.maxP) { j.Px *= j.maxP / len; j.Py *= j.maxP / len; }
      ix = j.Px - ox; iy = j.Py - oy;
      b.vx += b.im * ix; b.vy += b.im * iy; b.w += b.iI * (j.rx * iy - j.ry * ix);
    }
  }

  const MAXV = 3000, MAXW = 26;
  function step(dt) {
    const inv = 1 / dt, bs = W.live;
    broadphase();
    const ld = W.settle ? 5 : 0.08, ad = W.settle ? 9 : 0.9;
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.im === 0) continue;
      b.vx += W.gx * dt; b.vy += W.gy * dt;
      b.vx *= 1 / (1 + dt * ld); b.vy *= 1 / (1 + dt * ld); b.w *= 1 / (1 + dt * ad);
    }
    for (const arb of W.arbiters.values()) preStep(arb, inv);
    for (let i = 0; i < W.joints.length; i++) jointPre(W.joints[i], dt);
    for (let k = 0; k < W.iterations; k++) {
      for (const arb of W.arbiters.values()) applyImpulse(arb);
      for (let i = 0; i < W.joints.length; i++) jointSolve(W.joints[i]);
    }
    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      if (b.im === 0) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v > MAXV) { b.vx *= MAXV / v; b.vy *= MAXV / v; }
      if (b.w > MAXW) b.w = MAXW; else if (b.w < -MAXW) b.w = -MAXW;
      b.x += dt * b.vx; b.y += dt * b.vy; b.a += dt * b.w;
    }
  }
  function addLive(b) { if (!b.live) { b.live = true; if (!b.ghost) W.live.push(b); } }
  function dropLive(b) {
    if (!b.live) return;
    b.live = false;
    const i = W.live.indexOf(b); if (i >= 0) W.live.splice(i, 1);
    for (const [k, arb] of W.arbiters) if (arb.b1 === b || arb.b2 === b) W.arbiters.delete(k);
  }
  W.live = [];

  /* ------------------------------------------------------------------ */
  /* The pieces: the page's own elements                                 */
  /* ------------------------------------------------------------------ */

  // In the order they are claimed: a whole thing first (the bar, the hero board, a departures row), then the small
  // parts. An element inside a claimed one, or around one, is never a piece itself. tier: 1 always comes down, 2
  // while there is room, 3 if there is still room. text: the box is the words, not the line. lines: a paragraph comes
  // apart into its lines. photo: may be shrunk to fit the box she is looking into.
  const SPEC = [
    ['.hud[data-on]', { kind: 'hud', tier: 1, narrow: 1 }],
    // On a wide screen the bar is as wide as the window: its clock and its place come loose instead.
    ['.hud[data-on] .hud-clock', { kind: 'hud', tier: 1, wide: 1 }],
    ['.hud[data-on] .hud-place', { text: 1, tier: 1, wide: 1 }],
    ['.hud[data-on] .hud-map', { tier: 1, wide: 1 }],
    ['.hero .board', { kind: 'hero', tier: 1 }],
    ['.stage-foot', { tier: 1 }],
    ['.stage-closed', { tier: 1, rank: 5 }],
    ['.section--dep .board-head', { tier: 1, rank: 6 }],
    ['.section--dep .board-row:not(.is-empty)', { kind: 'row', tier: 2 }],
    ['.day-map', { photo: 1, tier: 1 }],
    ['.note-greeting', { text: 1, tier: 1, rank: 2 }],
    ['.note-sign', { text: 1, tier: 1, rank: 3 }],
    ['.note > p', { lines: 1, tier: 2 }],
    ['.day-head h2', { text: 1, tier: 1, rank: 4 }],
    ['.day-change', { tier: 2 }],
    ['.dep-weather', { text: 1, tier: 3 }],
    ['.chip', { tier: 1, rank: 8 }],
    ['.stop-title', { text: 1, tier: 1, rank: 7 }],
    ['.plan-title, .dinner-name, h4.plan-line', { text: 1, tier: 2 }],
    ['.strip-frame', { photo: 1, tier: 1, rank: 1 }],
    ['.dinner-toggle', { tier: 1 }],
    ['.plan-group .label', { text: 1, tier: 2 }],
    ['.plan-trip > span:not(.sr-only)', { text: 1, tier: 2 }],
    ['.stop-around', { text: 1, tier: 3 }],
    ['.stop-actions .tbtn, .dinner-acts .tbtn', { tier: 2 }],
    ['.stop-tip', { text: 1, tier: 2 }],
    ['p.plan-line, .dinner-line', { lines: 1, tier: 3 }],
    ['.stop-line', { text: 1, tier: 3 }],
    ['.stop-facts .fact, .dinner-facts .fact', { text: 1, tier: 3 }],
    ['.later-photo', { photo: 1, tier: 2 }],
    ['.later-name, .later-why', { text: 1, tier: 2 }],
    ['.later-in', { tier: 2 }],
    ['.room-photo', { photo: 1, tier: 1 }],
    ['.room-why, .room-name', { text: 1, tier: 2 }],
    ['.room-add, .room-all', { tier: 2 }],
    ['.send-label', { text: 1, tier: 1 }],
    ['.send-text', { tier: 1 }],
    ['.send-btn', { tier: 1 }],
    ['.map-note', { text: 1, tier: 3 }],
    ['.xp-btn', { kind: 'bomb', tier: 1 }],
  ];
  const GROUP = '.hud, .hero .board, .stage, .section--dep, .hero-note, .day-head, .plan-item, .plan-group, .dinner-idea, .room-tile, .later-row, .send, .xp, .day-map';

  let seed = 1;
  const rnd = () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rr = (a, b) => a + (b - a) * rnd();

  // A paragraph of plain text comes apart into its lines: each line is wrapped in a block of its own (the same
  // words on the same line, so nothing moves). Only paragraphs of plain text: one with a button in it stays whole.
  function splitLines(p) {
    if ([...p.childNodes].some((n) => n.nodeType !== 3)) return null;
    const text = p.textContent;
    if (!text.trim()) return null;
    if (p.childNodes.length > 1) p.normalize();
    const node = p.firstChild;
    const r = document.createRange();
    const starts = [];
    let prevTop = null;
    const re = /\S+/g;
    let m;
    while ((m = re.exec(text))) {
      r.setStart(node, m.index); r.setEnd(node, m.index + 1);
      const top = r.getBoundingClientRect().top;
      if (prevTop === null || top > prevTop + 3) starts.push(m.index);
      prevTop = top;
    }
    if (starts.length < 2) return null;
    const out = [];
    for (let k = starts.length - 1; k >= 0; k--) {
      const s = starts[k], e = k + 1 < starts.length ? starts[k + 1] : text.length;
      const span = document.createElement('span');
      span.className = 'xp-ln';
      r.setStart(p.firstChild, s); r.setEnd(p.firstChild, e);
      span.appendChild(r.extractContents());
      r.insertNode(span);
      out.unshift(span);
    }
    // Text left in front of the first line (leading spaces) stays in the paragraph, which is not a piece.
    return out;
  }

  function harvest(H) {
    const claimed = [];
    const isIn = (el) => { for (let a = el; a; a = a.parentElement) if (a.__xp) return true; return false; };
    const pending = [];
    const wide = VW >= 700;
    for (const [sel, o] of SPEC) {
      if ((o.narrow && wide) || (o.wide && !wide)) continue;
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest('[hidden], .sr-only, dialog, .peek, .sheet')) continue;
        if (isIn(el) || el.querySelector('[data-xp]')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        el.__xp = true; el.setAttribute('data-xp', '');
        pending.push({ el, o, r, inline: cs.display === 'inline' });
      }
    }
    // A transform does nothing to an inline box (the dinner card's facts are spans): those become inline blocks, before
    // anything is measured.
    for (const p of pending) if (p.inline) p.el.classList.add('xp-ib');
    // Paragraphs come apart into lines (one batch of writes, then the reads below).
    const pieces = [];
    const lineSets = [];
    for (const p of pending) {
      if (p.o.lines) {
        const near = p.r.bottom > H.viewTop - 60;
        const lines = (p.o.tier <= 2 || near) ? splitLines(p.el) : null;
        if (lines) { lineSets.push({ p, lines }); continue; }
        p.o = { ...p.o, text: 1 };
      }
      pieces.push(p);
    }
    for (const { p, lines } of lineSets) for (const ln of lines) pieces.push({ el: ln, o: { text: 1, tier: p.o.tier, line: 1 }, group: p.el.closest(GROUP) || p.el, r: null });
    const range = document.createRange();
    const out = [];
    for (const p of pieces) {
      const el = p.el, r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      let bx = r.left, by = r.top, bw = r.width, bh = r.height;
      if (p.o.text) {
        range.selectNodeContents(el);
        const t = range.getBoundingClientRect();
        if (t.width >= 2 && t.height >= 2) { bx = Math.max(r.left, t.left - 1); by = Math.max(r.top, t.top); bw = Math.min(r.right, t.right + 1) - bx; bh = Math.min(r.bottom, t.bottom) - by; }
      }
      const g = p.group || el.closest(GROUP) || el;
      out.push({
        el, kind: p.o.kind || (p.o.line ? 'line' : p.o.text ? 'text' : p.o.photo ? 'photo' : 'box'), tier: p.o.tier || 2, rank: p.o.rank || 50, photo: !!p.o.photo,
        lx: r.left, ly: r.top, ox: bx - r.left + bw / 2, oy: by - r.top + bh / 2, cx: bx + bw / 2, cy: by + bh / 2, sw: bw, sh: bh,
        group: g, s: 1, sc: 1, body: null, state: 'idle', t3d: false, last: '', near: false,
      });
    }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* The show                                                            */
  /* ------------------------------------------------------------------ */

  const root = document.documentElement;
  const S = { on: false, t: 0, raf: 0, last: 0, asleep: false, quiet: 0, shake: 0, shx: 0, shy: 0, events: [], pieces: [], idleSince: 0 };
  let VW = 0, VH = 0, AX = 0, AY = 0, ZF = 0.6, Z = 1, viewTop = 0, wallL = 0, wallR = 0, floorY = 0;
  let opts = {};
  let ui = null;

  // The live line for a screen reader, ready before the tap (a region has to exist before it speaks).
  const said = document.createElement('p');
  said.className = 'sr-only xp-ui'; said.setAttribute('role', 'status');
  document.body.appendChild(said);

  const camZ = (t) => {
    // A short punch in (the blast), then the camera pulls back to take in the whole page.
    if (t < 0.07) return 1.02 + 0.03 * Math.sin((t / 0.07) * Math.PI * 0.5);
    const u = Math.min(1, (t - 0.07) / 1.05), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    return 1.05 + (ZF - 1.05) * e;
  };
  const toScreenX = (x) => AX + (x - AX) * Z + S.shx;
  const toScreenY = (y) => AY + (y - AY) * Z + S.shy;
  const toWorldX = (sx) => AX + (sx - AX - S.shx) / Z;
  const toWorldY = (sy) => AY + (sy - AY - S.shy) / Z;

  function write(p, force) {
    const b = p.body;
    if (p.sc !== p.s) p.sc = p.state === 'live' ? p.s + (p.sc - p.s) * 0.9 : p.sc;
    if (Math.abs(p.sc - p.s) < 0.002) p.sc = p.s;
    const k = Z * p.sc;
    const sx = toScreenX(b.x), sy = toScreenY(b.y);
    const tx = sx - (p.lx + p.ox), ty = sy - (p.ly + p.oy) + (p.fixed ? 0 : S.dy);
    if (force === 'rest') p.t3d = false;
    else if (!p.t3d && (p.state === 'pinned' || Math.abs(b.vx) + Math.abs(b.vy) > 4 || Math.abs(b.w) > 0.05)) p.t3d = true;
    const moving = p.t3d;
    // A moving piece is its own layer (will-change: the browser moves it without painting it again); a piece at
    // rest is painted with the page, so nothing holds layers while nothing moves.
    if (moving !== p.layer) { p.layer = moving; p.el.style.willChange = moving ? 'transform' : ''; }
    const tf = moving
      ? `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) rotate(${b.a.toFixed(4)}rad) scale(${k.toFixed(4)})`
      : `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) rotate(${b.a.toFixed(4)}rad) scale(${k.toFixed(4)})`;
    if (tf !== p.last) { p.el.style.transform = tf; p.last = tf; }
  }

  function vibrate(ms) { if (opts.vibrate && navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* not here */ } } }
  // The blast on an Android phone: one big hit, then aftershocks that fade (0.49 s; nothing else buzzes over it).
  const BOOM = [130, 30, 80, 40, 50, 50, 30, 60, 20];
  let lastBuzz = -1, lastLen = 0;
  function thud(power, big) {
    // Weight you can feel: the camera jolts on a heavy landing, and an Android phone buzzes with it, harder and longer
    // for a heavier hit. One knock at a time, each its own beat (each call ends the last), so a heap coming down is a
    // rhythm and not one long buzz; the ARRIVALS board landing always gets through.
    S.shake = Math.max(S.shake, Math.min(big ? 11 : 6, power));
    if (power < 1.5 || S.t < (S.hush || 0)) return;
    const gap = S.t - lastBuzz;
    if (gap < Math.max(0.075, lastLen + 0.035) && !(big && gap > 0.04)) return;
    lastLen = Math.min(big ? 0.07 : 0.042, 0.018 + power * 0.004);
    lastBuzz = S.t;
    vibrate(Math.round(lastLen * 1000));
  }

  function plan(pieces) {
    // The box she is looking into: the camera ends at ZF, anchored at the bottom middle of her screen. The heap is
    // the picture she keeps, so the camera stops no further back than it needs: 72 % on a phone and 66 % on a laptop,
    // closer (up to 80 %) when her day is light and all of it fits with room to spare.
    const wideView = VW >= 700;
    const fill = wideView ? 0.4 : 0.5;
    const sizeAt = (z) => {
      const wW = VW / z, wH = VH / z, Lmax = Math.min(wW * 0.25, wH * 0.4, 400), Bmax = Math.min(wW * 0.45, 520);
      for (const p of pieces) {
        p.s = 1;
        if (p.photo && Math.max(p.sw, p.sh) > Lmax) p.s = Lmax / Math.max(p.sw, p.sh);
        if ((p.kind === 'box' || p.kind === 'row') && p.sw > Bmax) p.s = Math.min(p.s, Bmax / p.sw);
      }
    };
    ZF = wideView ? 0.66 : 0.72;
    sizeAt(ZF);
    let all = 0;
    for (const p of pieces) if (p.tier <= 2 || p.cy + p.sh / 2 > 0) all += p.sw * p.sh * p.s * p.s;
    if (all < VW * VH * fill / (ZF * ZF)) { ZF = Math.min(0.8, Math.sqrt(VW * VH * fill / all)); sizeAt(ZF); }
    const worldW = VW / ZF, worldH = VH / ZF;
    viewTop = AY - AY / ZF;
    wallL = AX - worldW / 2; wallR = AX + worldW / 2; floorY = VH;
    const budget = worldW * worldH * fill;
    let used = 0;
    const near = [], far = [];
    for (const p of pieces) {
      p.near = p.kind === 'hud' || p.kind === 'bomb' || (p.cy + p.sh / 2 > viewTop - 30 && p.kind !== 'hero');
      // What she could see when she tapped always explodes; what the camera only reveals above it competes for room.
      p.seen = p.near && (p.kind === 'hud' || p.kind === 'bomb' || p.cy + p.sh / 2 > 0);
      if (p.seen) near.push(p);
      // From above, only what reads at the camera's distance: the small print (tier 3) goes with the rest of the page.
      else if (p.tier <= 2) far.push(p);
    }
    for (const p of near) used += p.sw * p.sh * p.s * p.s;
    // Then, while there is room: the ARRIVALS board, tier 1, tier 2, tier 3, nearest first within a tier.
    // What the camera reveals above her screen ranks high (she sees it still standing, then going); so do three of the
    // departures rows (planks of flaps with the day's times and places on them).
    let rows = 0;
    for (const p of far) {
      p.lot = rnd();
      if (p.near && p.tier <= 2) p.rank = Math.min(p.rank, 9);
      if (p.kind === 'row' && p.el.textContent.trim() && rows < 3) { p.rank = 10; p.tier = 1; rows++; }
    }
    far.sort((a, b) => (b.kind === 'hero') - (a.kind === 'hero') || a.tier - b.tier || a.rank - b.rank || a.lot - b.lot);
    const chosen = [];
    for (const p of far) {
      const area = p.sw * p.sh * p.s * p.s;
      if (p.kind === 'hero' || used + area <= budget) { chosen.push(p); used += area; }
    }
    // Revealed pieces are pinned where they were and go with the shock; the rest falls in from above.
    for (let i = chosen.length - 1; i >= 0; i--) if (chosen[i].near) near.push(chosen.splice(i, 1)[0]);
    // A few loose flaps from the departures board, if its rows did not all come.
    const keep = new Set(chosen.map((p) => p.el));
    const loose = [];
    for (const row of document.querySelectorAll('.section--dep .board-row')) {
      if (keep.has(row) || row.closest('[hidden]')) continue;
      for (const f of row.querySelectorAll('.flap')) {
        if (!f.textContent.trim()) continue;
        loose.push(f);
      }
    }
    const nLoose = Math.min(loose.length, wideView ? 30 : 24);
    for (let i = 0; i < nLoose; i++) {
      const f = loose.splice(Math.floor(rnd() * loose.length), 1)[0];
      const r = f.getBoundingClientRect();
      f.__xp = true;
      chosen.push({ el: f, kind: 'flap', tier: 3, photo: false, lx: r.left, ly: r.top, ox: r.width / 2, oy: r.height / 2, cx: r.left + r.width / 2, cy: r.top + r.height / 2, sw: r.width, sh: r.height, group: f.closest('.board-row'), s: 1, sc: 1, body: null, state: 'idle', t3d: false, last: '', near: false });
    }
    return { near, far: chosen };
  }

  function bodyFor(p) {
    const w = Math.max(4, p.sw * p.s), h = Math.max(4, p.sh * p.s);
    // Mass grows slower than area, so a board is heavy but a flap under it is not crushed through (the solver
    // stacks well up to a mass ratio of about 1:20).
    // A floor under the small ones: a flap squeezed between heavy pieces otherwise jitters and never rests.
    let m = Math.max(5, Math.pow(w * h, 0.72) / 40);
    if (p.kind === 'hero') m *= 1.6;
    const b = makeBody(w, h, m);
    b.fr = p.kind === 'photo' || p.photo ? 0.6 : p.kind === 'line' || p.kind === 'text' ? 0.45 : 0.55;
    b.piece = p; p.body = b;
    b.x = p.cx; b.y = p.cy;
    return b;
  }

  // Before the blast, a drum roll: hits that come faster and harder (BEATS, seconds from the tap), then a held roll to
  // DRUM; then the inhale (everything leans toward the button, a beat of silence) and the blast at BLAST. What she sees
  // and what an Android phone buzzes come from this one list.
  const BEATS = [0, 0.15, 0.276, 0.382, 0.471, 0.546, 0.609, 0.662, 0.706, 0.746];
  const ROLL = 0.79, DRUM = 1.15, INHALE = 0.11, BLAST = DRUM + INHALE;
  // Android: each hit 20 to 32 ms (shorter ones many motors do not feel), the gap to the next, then the roll held.
  function drumPattern() {
    const out = [];
    BEATS.forEach((t, i) => { const on = Math.round(20 + 12 * i / (BEATS.length - 1)); out.push(on, Math.round(((BEATS[i + 1] ?? ROLL) - t) * 1000) - on); });
    out.push(Math.round((DRUM - ROLL) * 1000));
    return out;
  }
  // A hit of the drum: the camera thumps in and jolts, and everything she sees jumps a little, harder each time; the
  // button most.
  function hit(k) {
    const a = 0.25 + 0.75 * k / (BEATS.length - 1);
    S.shake = Math.max(S.shake, 1.5 + 3 * a);
    S.thump = 0.004 + 0.01 * a;
    for (const p of S.pieces) if (p.state === 'pinned') kick(p, a);
  }
  function kick(p, a) {
    const big = Math.max(p.sw, p.sh) > 240 ? 0.4 : 1, bomb = p.kind === 'bomb';
    const r = (bomb ? 4 : 1.6) * a * big;
    p.jx = (Math.random() - 0.5) * 2 * r; p.jy = -Math.random() * r * (bomb ? 1.4 : 1);
    p.ja = (Math.random() - 0.5) * (bomb ? 0.36 : 0.016) * a * big;
  }
  // Between hits the jumps settle back; in the held roll everything shakes all the time.
  function rattle(dt) {
    const roll = S.t >= ROLL, k = Math.exp(-dt / 0.045);
    if (roll) S.shake = Math.max(S.shake, 4.5);
    S.thump = (S.thump || 0) * Math.exp(-dt / 0.06);
    for (const p of S.pieces) {
      if (p.state !== 'pinned' || p.x0 === undefined) continue;
      if (roll) kick(p, 1); else if (p.jx !== undefined) { p.jx *= k; p.jy *= k; p.ja *= k; }
      const b = p.body;
      b.x = p.x0 + (p.jx || 0); b.y = p.y0 + (p.jy || 0); b.a = p.ja || 0;
    }
  }
  function schedule(near, far) {
    const ev = [];
    const bx = opts.from.x, by = opts.from.y;
    const shock = 5200;
    BEATS.forEach((t, k) => ev.push({ t, fn: () => hit(k) }));
    // The blast itself: the jolt, the buzz on Android, and the evening coming in above as the camera steps back.
    ev.push({ t: BLAST, fn: () => { S.shake = 10; vibrate(BOOM); S.hush = S.t + BOOM.reduce((x, y) => x + y) / 1000; if (S.sky) S.sky.classList.add('is-in'); } });
    for (const p of near) {
      const b = bodyFor(p);
      const dx = p.cx - bx, dy = p.cy - by, d = Math.hypot(dx, dy);
      if (p.kind === 'bomb') {
        b.ghost = true; setMass(b, b.m);
        p.state = 'pinned'; p.x0 = b.x; p.y0 = b.y;
        ev.push({ t: BLAST, fn: () => { p.state = 'live'; b.x = p.x0; b.y = p.y0; b.a = 0; addLiveGhost(b); b.vx = rr(-120, 120); b.vy = -4200; b.w = rr(-9, 9); } });
        continue;
      }
      const m = b.m; setMass(b, 0); p.state = 'pinned'; addLive(b);
      p.x0 = b.x; p.y0 = b.y; p.pull = Math.min(9, d * 0.03) / (d || 1);
      const tRel = BLAST + (p.kind === 'hud' ? 0.02 : Math.min(0.55, d / shock) + rr(0, 0.03));
      ev.push({ t: tRel, fn: () => {
        setMass(b, m); p.state = 'live'; b.a = 0;
        let ux = dx / (d || 1), uy = dy / (d || 1) - 0.75;
        const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
        const v = 3700 / (1 + d / 260) * rr(0.8, 1.15);
        b.vx = ux * v + rr(-90, 90); b.vy = uy * v;
        b.w = (rnd() < 0.5 ? -1 : 1) * rr(3, 11) / Math.sqrt(Math.max(1, Math.max(b.hw, b.hh) / 40));
        if (p.kind === 'hud') {
          // The bar does not fly: its left end drops and it hangs from its right corner, then the hinge gives.
          b.vx = 0; b.vy = 0; b.w = 0;
          const anchor = makeBody(4, 4, 0); anchor.ghost = true;
          const sx = VW >= 700 ? p.lx + p.sw - 4 : VW - 14, sy = p.ly + 8;
          anchor.x = sx; anchor.y = sy; anchor.live = true;
          const j = hinge(anchor, b, sx, sy);
          S.hudAnchor = { anchor, sx, sy, j };
          b.w = 2.2;
          at(S.t + 0.95, () => { W.joints.splice(W.joints.indexOf(j), 1); S.hudAnchor = null; b.vx -= 500; b.vy -= 300; b.w -= 3.2; });
        }
      } });
    }
    // From above, by group; each group comes in as it was laid out, then breaks apart on landing. Her day's own things
    // (a stop with its photo and title, "Your Friday", the note's "Hey Sasha," and "Felix") come last, just before the
    // ARRIVALS board, so they end up on top of the heap where she can see them; the rest first. Nearest first in each.
    const groups = new Map();
    let hero = null;
    for (const p of far) {
      if (p.kind === 'hero') { hero = p; continue; }
      const g = groups.get(p.group) || []; g.push(p); groups.set(p.group, g);
    }
    const list = [...groups.values()].map((ps) => ({ ps, y: Math.max(...ps.map((p) => p.cy)), top: ps.some((p) => p.rank <= 4 || p.rank === 7) }))
      .sort((a, b) => a.top - b.top || b.y - a.y);
    const t0 = BLAST + 0.24, t1 = BLAST + (hero ? 1.6 : 1.9);
    const bins = new Float64Array(12);
    // Where each group comes down: evenly spread across the box, but drawn in toward the middle so the heap is a mound
    // under the board and not a flat layer (a triangle's quantiles mixed in: mostly on a laptop, a little on a phone).
    const tri = (u) => (u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2));
    const peak = VW >= 700 ? 0.85 : 0.35;
    const slots = list.map((_, i) => { const u = (i + rr(0.15, 0.85)) / list.length; return 0.04 + 0.92 * (u + (tri(u) - u) * peak); });
    for (let i = slots.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [slots[i], slots[j]] = [slots[j], slots[i]]; }
    list.forEach((g, i) => {
      const t = t0 + (t1 - t0) * (list.length > 1 ? i / (list.length - 1) : 0) + rr(-0.04, 0.04);
      ev.push({ t, fn: () => drop(g.ps, bins, { slot: slots[i] }) });
    });
    if (hero) ev.push({ t: t1 + 0.34, fn: () => drop([hero], bins, { hero: true }) });
    const bomb = near.find((p) => p.kind === 'bomb');
    const back = (hero ? t1 + 0.34 : t1) + 0.6;
    if (bomb) ev.push({ t: back, fn: () => returnBomb(bomb) });
    // The line comes a beat after the button has landed back on the board (it falls for about 0.3 s).
    S.sayAt = back + 1;
    ev.sort((a, b) => a.t - b.t);
    return ev;
  }
  function addLiveGhost(b) { b.live = true; S.ghosts.push(b); }
  function at(t, fn) { let i = S.events.length; while (i > 0 && S.events[i - 1].t > t) i--; S.events.splice(i, 0, { t, fn }); }

  // A group falls in from above the top of the box, over the part of the heap that is lowest.
  function drop(ps, bins, { hero = false, slot = null } = {}) {
    let minX = Infinity, maxX = -Infinity, maxY = -Infinity, minY = Infinity;
    for (const p of ps) { minX = Math.min(minX, p.cx - p.sw * p.s / 2); maxX = Math.max(maxX, p.cx + p.sw * p.s / 2); minY = Math.min(minY, p.cy - p.sh * p.s / 2); maxY = Math.max(maxY, p.cy + p.sh * p.s / 2); }
    const gw = maxX - minX, worldW = wallR - wallL;
    let cx;
    if (hero) cx = AX + rr(-0.08, 0.08) * worldW;
    else if (slot !== null) cx = wallL + slot * worldW;
    else {
      heights(bins);
      let best = 0, bestScore = -Infinity;
      for (let i = 0; i < bins.length; i++) {
        const mid = (i + 0.5) / bins.length, centre = 1 - Math.abs(mid - 0.5) * 1.1;
        const score = -bins[i] * 1.0 + centre * 120 + rr(0, 140);
        if (score > bestScore) { bestScore = score; best = i; }
      }
      cx = wallL + (best + 0.5) / bins.length * worldW;
    }
    cx = Math.max(wallL + gw / 2 + 6, Math.min(wallR - gw / 2 - 6, cx));
    const dx = cx - (minX + maxX) / 2;
    const dy = (viewTop - 40) - maxY;
    const vy = hero ? 1900 : rr(1150, 1650), vx = rr(-160, 160), w = rr(-1.2, 1.2);
    for (const p of ps) {
      const b = p.body || bodyFor(p);
      p.sc = p.s;
      b.x = p.cx + dx; b.y = p.cy + dy; b.a = hero ? rr(-0.12, 0.12) : rr(-0.03, 0.03);
      b.vx = vx + rr(-60, 60); b.vy = vy + rr(-40, 40); b.w = w + rr(-0.8, 0.8);
      p.state = 'live';
      addLive(b);
    }
  }
  function heights(bins) {
    const worldW = wallR - wallL;
    bins.fill(0);
    for (const b of W.live) {
      const p = b.piece; if (!p || p.state !== 'live' || b.y < viewTop) continue;
      const i0 = Math.max(0, Math.floor((b.minX - wallL) / worldW * bins.length)), i1 = Math.min(bins.length - 1, Math.floor((b.maxX - wallL) / worldW * bins.length));
      for (let i = i0; i <= i1; i++) bins[i] = Math.max(bins[i], floorY - b.minY);
    }
  }
  function returnBomb(p) {
    const b = p.body;
    const i = S.ghosts.indexOf(b); if (i >= 0) S.ghosts.splice(i, 1);
    b.ghost = false; b.live = false; b.parked = false;
    // It comes down last, onto the ARRIVALS board (the joke is that it lands on top, still saying what it says).
    const hero = S.pieces.find((q) => q.kind === 'hero' && q.state === 'live');
    const hx = hero ? hero.body.x + rr(-0.18, 0.18) * hero.body.hw * 2 : AX + rr(-0.1, 0.1) * (wallR - wallL);
    b.x = Math.max(wallL + b.hw + 4, Math.min(wallR - b.hw - 4, hx)); b.y = viewTop - 120; b.a = hero ? hero.body.a + rr(-0.25, 0.25) : rr(-0.5, 0.5);
    b.vx = rr(-40, 40); b.vy = 1400; b.w = rr(-1.5, 1.5);
    addLive(b);
  }

  function frame(now) {
    S.raf = 0;
    if (!S.on) return;
    let dt = S.last ? (now - S.last) / 1000 : 1 / 60;
    S.last = now;
    if (dt > 0.05) dt = 0.05;
    advance(dt);
    if (!S.asleep) S.raf = requestAnimationFrame(frame);
  }
  const H_STEP = 1 / 180;
  let acc = 0;
  function advance(dt) {
    acc += dt;
    let n = 0;
    // Up to 9 steps a frame: a phone in Low Power Mode draws 30 frames a second (6 steps each) and must not go slow.
    while (acc >= H_STEP && n < 9) {
      acc -= H_STEP; n++;
      S.t += H_STEP;
      while (S.events.length && S.events[0].t <= S.t) S.events.shift().fn();
      Z = S.t < DRUM ? 1 + (S.thump || 0) : S.t < BLAST ? 1 + 0.02 * ((S.t - DRUM) / INHALE) : S.t < 1.3 + BLAST ? camZ(S.t - BLAST) : ZF;
      if (S.t >= DRUM && S.t < BLAST) {
        // The inhale: the drum stops and everything she sees leans a few px toward the button.
        const e = Math.pow((S.t - DRUM) / INHALE, 2);
        for (const p of S.pieces) if (p.state === 'pinned' && p.pull !== undefined) { p.body.x = p.x0 + (opts.from.x - p.x0) * p.pull * e; p.body.y = p.y0 + (opts.from.y - p.y0) * p.pull * e; p.body.a = 0; }
      }
      if (S.hudAnchor) {
        // The hinge keeps to the top right corner of her screen while the camera pulls back.
        const a = S.hudAnchor.anchor; a.x = toWorldX(S.hudAnchor.sx); a.y = toWorldY(S.hudAnchor.sy);
      }
      track();
      step(H_STEP);
      for (const b of S.ghosts) { if (b.parked) continue; b.vy += W.gravity * H_STEP; b.x += b.vx * H_STEP; b.y += b.vy * H_STEP; b.a += b.w * H_STEP; if (b.y < viewTop - 400) b.parked = true; }
      impacts();
      topple();
      if (W.settle) rest(H_STEP);
    }
    if (n === 9) acc = 0;
    if (S.t < DRUM) rattle(dt);
    // The camera's jolt, decaying. Its own dice (not the show's), so the heap does not depend on the frame rate.
    S.shake *= Math.pow(0.0009, dt);
    if (S.shake < 0.15) S.shake = 0;
    S.shx = S.shake ? (Math.random() - 0.5) * 2 * S.shake : 0; S.shy = S.shake ? (Math.random() - 0.5) * 2 * S.shake : 0;
    if (S.batches && S.batches.length) { for (const el of S.batches.shift()) el.classList.add('xp-gone'); }
    let moving = 0;
    for (const p of S.pieces) {
      const b = p.body;
      if (!b || p.state === 'idle' || p.state === 'gone') continue;
      if (p.state === 'live' && b.y < viewTop - 2400) continue;
      write(p);
      // Moving means it moved on screen since the last frame.
      if (p.state === 'live' && !b.frozen && !(W.settle && p.kind === 'flap') && (p.px === undefined || Math.abs(b.x - p.px) + Math.abs(b.y - p.py) > 0.6 || Math.abs(b.a - p.pa) > 0.004)) { moving++; }
      p.px = b.x; p.py = b.y; p.pa = b.a;
    }

    // Asleep when nothing has moved for a while and nothing is still to come; then the loop stops.
    W.settle = !S.drag && S.t > (S.endAt || 1e9) && S.t - S.idleSince > 1.6;
    if (T.on) tiltStep(dt);
    if (!S.events.length && !S.ghosts.length && !S.drag && Z === ZF && !tilting()) {
      if (moving === 0) S.quiet += dt; else S.quiet = 0;
      if (S.quiet > 0.5 || S.rested || S.t - S.idleSince > 8) sleep();
    }
    if (!S.done && S.t > (S.sayAt || 1e9)) finish();
  }
  // Velocity before each step, to feel the landings.
  function track() { for (const b of W.live) { b.pvx = b.vx; b.pvy = b.vy; } }
  function impacts() {
    for (const b of W.live) {
      if (b.im === 0 || b.pvx === undefined) continue;
      const dv = Math.hypot(b.vx - b.pvx - W.gx * H_STEP, b.vy - b.pvy - W.gy * H_STEP);
      if (dv < 500) continue;
      const area = 4 * b.hw * b.hh;
      const big = b.piece && b.piece.kind === 'hero';
      const power = (dv / 600) * Math.min(3, Math.sqrt(area) / 90) * (big ? 2.2 : 1);
      if (power > 1.4) thud(power, big);
    }
  }
  function topple() {
    if (T.on) return; // down is wherever the phone leans now
    for (const b of W.live) {
      if (b.im === 0 || !b.piece) continue;
      const long = Math.max(b.hw, b.hh), short = Math.min(b.hw, b.hh);
      if (long < short * 1.7) continue;
      // The angle of the long side from the floor.
      const along = b.hw >= b.hh ? b.a : b.a + Math.PI / 2;
      const c = Math.abs(Math.cos(along));
      if (c > 0.42) continue;
      if (Math.abs(b.vx) + Math.abs(b.vy) > 60 || Math.abs(b.w) > 0.6) continue;
      const side = Math.sin(along) * Math.cos(along) >= 0 ? 1 : -1;
      b.w += side * 0.05 * (1 + (1 - c));
    }
  }
  // Once the show is over the whole heap goes to sleep together when no piece has drifted more than 4 px (or 3 degrees)
  // in 0.4 s. Still means where it is, not how fast: wedged in a heap a piece can sit within a pixel while its velocity
  // flickers. (One piece at a time would leave a live piece pressed against a frozen one, which only makes it worse.)
  function rest(dt) {
    let all = true;
    for (const b of W.live) {
      if (b.im === 0 || !b.piece || b.piece.kind === 'flap') continue;
      if (b.ax === undefined || Math.abs(b.x - b.ax) + Math.abs(b.y - b.ay) > 4 || Math.abs(b.a - b.aa) > 0.05) { b.ax = b.x; b.ay = b.y; b.aa = b.a; b.still = 0; }
      else b.still += dt;
      if (b.still < 0.4) all = false;
    }
    if (all) S.rested = true;
  }
  function thaw() { S.rested = false; for (const b of W.live) b.ax = undefined; }
  function sleep() {
    S.asleep = true; S.quiet = 0; S.rested = false;
    for (const b of W.live) { b.vx = 0; b.vy = 0; b.w = 0; }
    // At rest the pieces are painted with the page again: no layers held while nothing moves.
    for (const p of S.pieces) if (p.body && p.state === 'live') write(p, 'rest');
    if (!S.done) finish();
  }
  function wake() {
    if (!S.on) return;
    S.idleSince = S.t;
    if (S.asleep) { S.asleep = false; S.last = 0; }
    if (!S.raf) S.raf = requestAnimationFrame(frame);
  }

  function finish() {
    S.done = true;
    tiltStart(false);
    said.textContent = opts.line;
    if (ui) {
      ui.top.hidden = false;
      requestAnimationFrame(() => ui.top.classList.add('is-in'));
      // Focus goes to the line, which says how to get the page back (the status line above says what happened).
      try { ui.line.focus({ preventScroll: true, focusVisible: false }); } catch { /* old focus options */ }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Tilt: the heap is trapped in the phone                              */
  /* ------------------------------------------------------------------ */

  // On a phone, once the heap has settled, its gravity follows the way the phone leans: the pieces slide and fall
  // toward the low side, and a ceiling closes the box at the top of the screen. From deviceorientation's beta (front to
  // back) and gamma (left to right), gravity in the plane of the screen is (sin gamma cos beta, sin beta), turned by the
  // screen's own rotation; its length is how much of gravity lies in the screen (none with the phone flat on a table).
  // The reading is smoothed (a 120 ms lag) and a change under 2 degrees does not wake a sleeping heap, so it does not
  // jitter. Nothing on a laptop (no coarse pointer), and none in the reduced-motion version.
  const T = { on: false, asked: false, listening: false, tx: 0, ty: 1, gx: 0, gy: 1 };
  const tilting = () => T.on && Math.abs(T.tx - T.gx) + Math.abs(T.ty - T.gy) > 0.01;
  function tiltStart(tap) {
    if (T.listening || !S.done || opts.reduced || !matchMedia('(pointer: coarse)').matches) return;
    const ask = typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function';
    if (!ask) { T.listening = true; addEventListener('deviceorientation', onTilt); return; }
    if (!tap || T.asked) return;
    T.asked = true;
    DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted' && !T.listening) { T.listening = true; addEventListener('deviceorientation', onTilt); } }, () => {});
  }
  function onTilt(e) {
    if (e.beta == null || e.gamma == null) return;
    const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    const x = Math.sin(g) * Math.cos(b), y = Math.sin(b);
    const turn = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180, c = Math.cos(turn), sn = Math.sin(turn);
    const sx = c * x + sn * y, sy = -sn * x + c * y;
    // Held within 5 degrees of upright counts as upright, so a phone held a little crooked does not keep the heap drifting.
    const len = Math.hypot(sx, sy), ang = Math.atan2(sx, sy), dead = 5 * Math.PI / 180;
    const a2 = Math.sign(ang) * Math.max(0, Math.abs(ang) - dead) * Math.PI / (Math.PI - dead);
    T.tx = len * Math.sin(a2); T.ty = len * Math.cos(a2);
    if (!T.on) {
      T.on = true;
      // The lid: the top of the box the camera ended on (above any piece still poking out).
      let top = viewTop;
      for (const o of W.live) if (o.piece) top = Math.min(top, o.minY);
      const lid = makeBody((wallR - wallL) * 3, 2000, 0); lid.x = AX; lid.y = top - 2 - 1000; lid.fr = 0.7; addLive(lid);
      // Slippery, like things loose behind glass: the sides of the box (walls, floor, lid) have no grip, so the heap
      // cannot wedge itself between them and hang there, and the pieces slide on each other more easily.
      for (const o of W.live) o.fr = o.piece ? o.fr * 0.6 : 0.02;
      W.arbiters.clear();
    }
    if (Math.hypot(T.tx - T.gx, T.ty - T.gy) > 0.035) { if (S.asleep) thaw(); wake(); }
  }
  function tiltStep(dt) {
    const k = 1 - Math.exp(-dt / 0.12);
    T.gx += (T.tx - T.gx) * k; T.gy += (T.ty - T.gy) * k;
    W.gx = W.gravity * T.gx; W.gy = W.gravity * T.gy;
    // While it turns, the heap stays awake and lively (not the settling damping).
    if (tilting()) S.idleSince = S.t;
  }

  /* ------------------------------------------------------------------ */
  /* Her hands on the heap                                               */
  /* ------------------------------------------------------------------ */

  function pick(sx, sy) {
    const wx = toWorldX(sx), wy = toWorldY(sy);
    let best = null, bestA = Infinity;
    for (const b of W.live) {
      const p = b.piece; if (!p || p.state !== 'live' || b.im === 0) continue;
      const c = Math.cos(b.a), s = Math.sin(b.a), dx = wx - b.x, dy = wy - b.y;
      const lx = c * dx + s * dy, ly = -s * dx + c * dy, pad = 10 / Z;
      if (Math.abs(lx) <= b.hw + pad && Math.abs(ly) <= b.hh + pad) { const a = b.hw * b.hh; if (a < bestA) { bestA = a; best = b; } }
    }
    return { b: best, wx, wy };
  }
  function bindTouch(layer) {
    let down = null;
    // On an iPhone the tilt needs her permission, asked from a tap: her first tap on the heap once it has settled
    // (asked at the tap on the button, Safari's prompt would cover the drum roll and the blast).
    layer.addEventListener('click', () => tiltStart(true));
    layer.addEventListener('pointerdown', (e) => {
      // No text selection from a drag across the heap (the click that ticks the iPhone's switch still comes).
      if (e.pointerType === 'mouse') e.preventDefault();
      if (down) return;
      const { b, wx, wy } = pick(e.clientX, e.clientY);
      down = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), b, moved: false };
      try { layer.setPointerCapture(e.pointerId); } catch { /* fine */ }
      thaw();
      wake();
      if (b) { S.drag = finger(b, wx, wy); layer.classList.add('is-grab'); vibrate(20); }
    });
    layer.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 7) down.moved = true;
      if (S.drag) { S.drag.tx = toWorldX(e.clientX); S.drag.ty = toWorldY(e.clientY); wake(); }
    });
    const up = (e) => {
      if (!down || e.pointerId !== down.id) return;
      const tap = !down.moved && performance.now() - down.t < 350;
      if (S.drag) { W.joints.splice(W.joints.indexOf(S.drag), 1); S.drag = null; }
      layer.classList.remove('is-grab');
      if (tap) poke(down.b, e.clientX, e.clientY);
      down = null;
      wake();
    };
    layer.addEventListener('pointerup', up);
    layer.addEventListener('pointercancel', up);
  }
  // A tap: the piece under her finger hops; a tap on the sky sets off a little blast there.
  function poke(b, sx, sy) {
    const wx = toWorldX(sx), wy = toWorldY(sy);
    if (b) { b.vy -= rr(1100, 1500); b.vx += (wx - b.x) * -2 + rr(-200, 200); b.w += rr(-9, 9); vibrate(26); return; }
    let hit = 0;
    for (const o of W.live) {
      if (!o.piece || o.im === 0) continue;
      const dx = o.x - wx, dy = o.y - wy, d = Math.hypot(dx, dy);
      if (d > 360) continue;
      const v = 1500 / (1 + d / 110);
      o.vx += (dx / (d || 1)) * v; o.vy += (dy / (d || 1)) * v - 300; o.w += rr(-6, 6); hit++;
    }
    if (hit) { S.shake = Math.max(S.shake, 3); vibrate([40, 30, 24]); }
  }

  /* ------------------------------------------------------------------ */
  /* Start                                                               */
  /* ------------------------------------------------------------------ */

  const stopScroll = (e) => { if (S.on) e.preventDefault(); };
  const KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);
  function lockPage() {
    addEventListener('selectstart', (e) => { if (S.on) e.preventDefault(); });
    try { getSelection().removeAllRanges(); } catch { /* none */ }
    addEventListener('scroll', () => {
      const dy = scrollY - S.scrollY;
      if (dy === S.dy) return;
      S.dy = dy;
      if (S.asleep) for (const p of S.pieces) if (p.body && p.state === 'live') write(p, 'rest');
    }, { passive: true });
    addEventListener('wheel', stopScroll, { passive: false });
    addEventListener('touchmove', stopScroll, { passive: false });
    addEventListener('keydown', (e) => {
      if (!S.on && !S.done) return;
      if (KEYS.has(e.key) && !(e.target && e.target.closest && e.target.closest('button'))) e.preventDefault();
      // The page is gone: Tab stays on the line.
      if (e.key === 'Tab' && ui) { e.preventDefault(); try { ui.line.focus({ preventScroll: true }); } catch { /* fine */ } }
    });
  }

  function buildUI() {
    const layer = document.createElement('label');
    layer.className = 'xp-touch xp-ui';
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = '<input type="checkbox" switch tabindex="-1">';
    // Once it settles, one line at the top in Felix's words, and nothing else.
    const top = document.createElement('div');
    top.className = 'xp-top xp-ui';
    top.hidden = true;
    top.innerHTML = '<p class="xp-said" tabindex="-1"></p>';
    const line = top.querySelector('.xp-said');
    line.textContent = opts.said;
    document.body.append(layer, top);
    return { layer, top, line };
  }

  function run(o) {
    if (S.on) return;
    opts = o;
    seed = (Math.random() * 2 ** 31) | 0;
    VW = document.documentElement.clientWidth; VH = window.innerHeight;
    AX = VW / 2; AY = VH;
    const br = o.button.getBoundingClientRect();
    opts.from = { x: br.left + br.width / 2, y: br.top + br.height / 2 };
    if (o.reduced) return hang(o);
    viewTop = AY - AY / (VW >= 700 ? 0.62 : 0.66);
    // Ancestors that clip or contain paint would cut a piece off as it leaves: they let go first (before any
    // measuring, so whatever this moves is measured where it now is).
    const clips = harvestPrep();
    for (const el of clips) el.classList.add('xp-unclip');
    const pieces = harvest({ viewTop });
    const { near, far } = plan(pieces);
    S.pieces = [...near, ...far];
    for (const p of S.pieces) {
      p.el.classList.add('xp-p');
      p.fixed = !!p.el.closest('.hud');
      p.el.style.transformOrigin = `${p.ox.toFixed(2)}px ${p.oy.toFixed(2)}px`;
      const img = p.el.tagName === 'IMG' ? [p.el] : p.el.querySelectorAll('img');
      for (const im of img) { if (im.loading === 'lazy') im.loading = 'eager'; }
    }
    // Only what can be seen goes: the screen and the strip above it that the camera reveals. Hiding the whole page
    // would restyle every element at once (81 ms with the CPU slowed 4x); this restyles a few hundred.
    hideRegion(viewTop - 40, VH + 40);
    S.batches = laterBatches();
    root.classList.add('xp-on');
    // Gone for a screen reader and the keyboard too (aria-hidden, not inert: inert restyles the whole page).
    for (const sel of ['header', 'main', '.hud', '.footer']) { const el = document.querySelector(sel); if (el) el.setAttribute('aria-hidden', 'true'); }
    ui = buildUI();
    // As the camera steps back it shows the page above her screen, which is earlier in the evening: the sky there is the
    // page's blue hour, down to the night she was in at the floor. One still layer over the page's sky, faded in once.
    S.sky = null;
    if (o.sky) {
      S.sky = document.createElement('div');
      S.sky.className = 'xp-sky xp-ui';
      S.sky.style.backgroundImage = `linear-gradient(to bottom, ${o.sky[0]}, ${o.sky[1]} 64%)`;
      document.body.appendChild(S.sky);
    }
    bindTouch(ui.layer);
    lockPage();
    W.bodies.length = 0; W.live.length = 0; W.arbiters.clear(); W.joints.length = 0;
    S.ghosts = [];
    // The floor is the bottom of her screen, the walls the sides of the box the camera ends on.
    const worldW = VW / ZF;
    const floor = makeBody(worldW * 3, 2000, 0); floor.x = AX; floor.y = VH + 1000; floor.fr = 0.7; addLive(floor);
    const wl = makeBody(2000, 40000, 0); wl.x = AX - worldW / 2 - 1000; wl.y = VH - 20000; addLive(wl);
    const wr = makeBody(2000, 40000, 0); wr.x = AX + worldW / 2 + 1000; wr.y = VH - 20000; addLive(wr);
    S.events = schedule(near, far);
    S.endAt = 4.6 + BLAST;
    // Read after the changes on purpose: the forced layout lands in this task and the paint in the next frame's, two
    // tasks of about 70 ms with the CPU slowed 4x instead of one of 160 ms.
    S.on = true; S.t = 0; S.last = 0; S.asleep = false; S.idleSince = 0; S.scrollY = scrollY; S.dy = 0;
    S.shake = 0;
    // The pieces that start in view are written once now, so the first frame already has them as bodies.
    for (const p of near) if (p.body) write(p);
    vibrate(drumPattern());
    S.raf = requestAnimationFrame(frame);
  }
  function ownPaint(el) {
    const cs = getComputedStyle(el);
    if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || cs.backgroundImage !== 'none' || cs.boxShadow !== 'none') return true;
    if ((parseFloat(cs.borderTopWidth) || parseFloat(cs.borderBottomWidth) || parseFloat(cs.borderLeftWidth) || parseFloat(cs.borderRightWidth)) && cs.borderStyle !== 'none') return true;
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth)) return true;
    for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true;
    for (const ps of ['::before', '::after']) { const c = getComputedStyle(el, ps).content; if (c && c !== 'none' && c !== 'normal') return true; }
    return false;
  }
  function hideRegion(top, bottom) {
    const out = [];
    const visit = (el) => {
      if (el.classList.contains('xp-p') || el.classList.contains('xp-ui') || el.classList.contains('sky-bg') || el.tagName === 'SCRIPT') return;
      const r = el.getBoundingClientRect();
      if (r.bottom < top || r.top > bottom || (!r.width && !r.height && getComputedStyle(el).display === 'none')) return;
      if (!el.querySelector('.xp-p')) { out.push(el); return; }
      if (ownPaint(el)) out.push(el);
      for (const c of el.children) visit(c);
    };
    for (const c of document.body.children) visit(c);
    for (const el of out) el.classList.add('xp-gone');
    return out.length;
  }
  // The rest of the page (above, out of sight) goes too, a few hundred elements a frame: while it is drawn, the
  // browser has to give the content around the moving pieces layers of its own (as tall as the page).
  function laterBatches() {
    const out = [];
    const visit = (el, depth) => {
      if (el.classList.contains('xp-p') || el.classList.contains('xp-ui') || el.classList.contains('sky-bg') || el.classList.contains('xp-gone') || el.tagName === 'SCRIPT' || el.tagName === 'DIALOG') return;
      const n = el.getElementsByTagName('*').length;
      if (!el.querySelector('.xp-p') && n < 500) { out.push([el, n + 1]); return; }
      if (n >= 500 && !el.querySelector('.xp-p') && depth > 6) { out.push([el, n + 1]); return; }
      out.push([el, 1, true]);
      for (const c of el.children) visit(c, depth + 1);
    };
    for (const c of document.body.children) visit(c, 0);
    const batches = [];
    let cur = [], size = 0;
    for (const [el, n, self] of out) {
      if (self && !ownPaint(el)) continue;
      cur.push(el); size += n;
      if (size > 350) { batches.push(cur); cur = []; size = 0; }
    }
    if (cur.length) batches.push(cur);
    return batches;
  }
  function harvestPrep() {
    // Every ancestor of a would-be piece that clips: found before anything is changed.
    const out = new Set(), seen = new Set();
    for (const [sel] of SPEC) for (const el of document.querySelectorAll(sel)) {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        if (seen.has(a)) break;
        seen.add(a);
        const cs = getComputedStyle(a);
        if (cs.overflow !== 'visible' || (cs.contain && /paint|strict|content/.test(cs.contain)) || cs.clipPath !== 'none') out.add(a);
      }
    }
    return [...out];
  }

  /* ------------------------------------------------------------------ */
  /* Reduced motion: everything comes loose, nothing flies                */
  /* ------------------------------------------------------------------ */

  // Each part of the page drops onto one screw: it tips down from a top corner and stays like that. No motion, just
  // the new state; she can still scroll the crooked page.
  const RM = ['.hud[data-on]', '.board', '.note-greeting', '.note > p', '.note-sign', '.stage-closed', '.dep-weather', '.day-head h2', '.day-change',
    '.plan-group .label', '.plan-trip > span:not(.sr-only)', '.plan-time', '.plan-title', 'h4.plan-line', 'p.plan-line', '.stop-top', '.strip-frame', '.stop-dots', '.stop-title', '.stop-line', '.stop-facts', '.stop-tip', '.stop-actions .hapw', '.stop-actions .tbtn',
    '.dinner-name', '.dinner-line', '.dinner-facts', '.dinner-acts .hapw', '.dinner-acts .tbtn', '.room-tile > *', '.hapw--all', '.later-row > *', '.send-label', '.send-text', '.hapw--send', '.day-map', '.map-note', '.xp-btn'];
  function hang(o) {
    const els = [];
    for (const sel of RM) for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[hidden], .sr-only, dialog')) continue;
      let inside = false; for (let a = el.parentElement; a; a = a.parentElement) if (a.__xp) { inside = true; break; }
      if (inside || el.__xp) continue;
      const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
      el.__xp = true; els.push({ el, w: r.width, h: r.height });
    }
    for (const { el, w, h } of els) {
      const left = rnd() < 0.5;
      // Tipped from one top corner; the far end drops by 4 to 22 px whatever its width.
      const drop = el.matches('.xp-btn') ? 0 : rr(4, 22);
      let ang = Math.asin(Math.min(0.5, drop / Math.max(w, 12))) * (left ? 1 : -1);
      if (el.matches('.hud')) ang = 0.05;
      el.classList.add('xp-hung');
      el.style.transformOrigin = left ? '0 0' : '100% 0';
      el.style.transform = el.matches('.xp-btn') ? 'rotate(176deg)' : `translateY(${rr(0, 3).toFixed(1)}px) rotate(${ang.toFixed(4)}rad)`;
      if (el.matches('.xp-btn')) el.style.transformOrigin = '50% 50%';
    }
    for (const sel of ['header', 'main', '.hud']) { const el = document.querySelector(sel); if (el) el.inert = true; }
    ui = buildUI();
    ui.layer.remove();
    root.classList.add('xp-rm');
    vibrate(BOOM);
    S.on = false; S.done = true;
    finish();
  }

  window.VenerdiExplode = { run };
})();
