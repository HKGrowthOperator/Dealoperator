/* Deal Operator reel library: stage, brand, captions, motion helpers, product cards.
   Everything is seek-safe: state is a function of timeline time only. */
(function () {
  const R = window.REEL;
  const H = (window.H = {});
  const SVGNS = "http://www.w3.org/2000/svg";
  let uid = 0;

  // ---------- dom ----------
  H.el = (tag, cls, html, parent) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    if (parent) parent.appendChild(n);
    return n;
  };
  H.css = (n, styles) => { Object.assign(n.style, styles); return n; };
  H.rng = (seed) => () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  H.de = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  // ---------- voice clock ----------
  H.L = (i) => R.lines[i];
  H.W = (li, wi) => R.lines[li].words[wi < 0 ? R.lines[li].words.length + wi : wi];
  const norm = (s) => s.toLowerCase().replace(/[^a-zäöüß0-9]/g, "");
  // first word in line li whose text starts with `q`
  H.at = (li, q, end) => {
    const w = R.lines[li].words.find((x) => norm(x.w).startsWith(norm(q)));
    if (!w) throw new Error("word not found: " + q + " in line " + li);
    return end ? w.e : w.s;
  };
  H.cta = () => R.lines[R.lines.length - 1];

  // ---------- sound cues (read by the mixer) ----------
  window.__sfx = [];
  H.sfx = (name, t, gain) => { window.__sfx.push({ name, t: Math.max(0, +t.toFixed(3)), gain: gain == null ? 1 : gain }); };

  // ---------- icons (lucide, ISC) ----------
  const ICON = {
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
    cal: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    hand: '<path d="m11 17 2 2a1 1 0 1 0 3-3"/><path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.88-3.88a3 3 0 0 0-4.24 0l-.88.88a1 1 0 1 1-3-3l2.81-2.81a5.79 5.79 0 0 1 7.06-.87l.47.28a2 2 0 0 0 1.42.25L21 4"/><path d="m21 3 1 11h-2"/><path d="M3 3 2 14l6.47 6.47a1 1 0 1 0 3-3"/><path d="M3 4h8"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>',
    send: '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
    msg: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    voice: '<path d="M2 10v3"/><path d="M6 6v11"/><path d="M10 3v18"/><path d="M14 8v7"/><path d="M18 5v13"/><path d="M22 10v3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
    bolt: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  };
  H.icon = (name, color, sw) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="${color || "currentColor"}" stroke-width="${sw || 2.2}" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

  // ---------- brand ----------
  H.dmark = () => {
    const a = "dmo" + ++uid, b = "dmf" + uid;
    return `<svg class="dmark" viewBox="0 0 360 340" width="100%" height="100%"><defs><linearGradient id="${a}" x1=".1" y1="0" x2=".8" y2="1"><stop stop-color="#061b40"/><stop offset=".48" stop-color="#0755f5"/><stop offset="1" stop-color="#04bafa"/></linearGradient><linearGradient id="${b}" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#04c2f8"/><stop offset="1" stop-color="#0755f5"/></linearGradient></defs><path fill="url(#${a})" fill-rule="evenodd" d="M20 4H174C279 4 352 74 352 170S279 336 174 336H22Q4 336 4 318V286L111 176 4 74V22Q4 4 20 4ZM105 98 176 169 109 240H171C215 240 245 211 245 170S215 98 171 98Z"/><path fill="#061b40" d="M4 286 112 178 164 229 53 336H22Q4 336 4 318Z"/><path fill="url(#${b})" d="M8 8 178 171Q197 190 178 210L127 262Q135 239 115 220L15 124Q4 113 4 94V23Q4 13 8 8Z"/></svg>`;
  };
  // the mark on dark: the navy fold is lifted so it reads against the night stage
  H.dmarkDark = () => H.dmark().replace(/#061b40/g, "#0b2a66");
  H.wordmark = (size, onLight) =>
    `<span class="wordmark${onLight ? " on-light" : ""}" style="font-size:${size}px"><span class="dm">${onLight ? H.dmark() : H.dmarkDark()}</span><span class="eal">eal</span><span class="op">Operator</span></span>`;

  // ---------- stage ----------
  H.stage = () => {
    const root = document.getElementById("root");
    const bg = H.el("div", "layer", null, root); bg.id = "bg";
    H.el("div", "bg-base", null, bg);
    const orbs = ["o1", "o2", "o3"].map((c) => H.el("div", "orb " + c, null, bg));
    const floor = H.el("div", "floor", null, bg);
    // perspective grid: verticals converge on a vanishing point above the frame
    let s = '<svg viewBox="0 0 2160 1100" preserveAspectRatio="none"><g stroke="#68d8ff" stroke-width="2" fill="none" opacity=".5">';
    for (let i = -14; i <= 14; i++) s += `<line x1="${1080 + i * 52}" y1="0" x2="${1080 + i * 260}" y2="1100"/>`;
    for (let k = 1; k <= 11; k++) { const y = Math.pow(k / 11, 1.9) * 1100; s += `<line x1="0" y1="${y.toFixed(1)}" x2="2160" y2="${y.toFixed(1)}" opacity="${(0.25 + k / 14).toFixed(2)}"/>`; }
    s += "</g></svg>";
    floor.innerHTML = s;
    const grain = H.el("div", "grain", null, bg);
    const cv = document.createElement("canvas"); cv.width = cv.height = 256;
    const cx = cv.getContext("2d"), img = cx.createImageData(256, 256), rnd = H.rng(1337);
    for (let i = 0; i < img.data.length; i += 4) { const v = (rnd() * 255) | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    cx.putImageData(img, 0, 0);
    grain.style.backgroundImage = `url(${cv.toDataURL()})`;
    const world = H.el("div", "layer", null, root); world.id = "world";
    H.el("div", "vignette", null, root);
    const caps = H.el("div", null, null, root); caps.id = "captions";
    H.bg = { bg, orbs, floor, world, grain };
    return H.bg;
  };

  // camera: world transform + counter-parallax on the stage so depth reads
  H.cam = (tl, t, to, dur, ease) => {
    const d = dur == null ? 1.2 : dur, e = ease || "power2.inOut";
    tl.to(H.bg.world, { ...to, duration: d, ease: e }, t);
    const px = to.x || 0, py = to.y || 0, sc = to.scale || 1;
    tl.to(H.bg.orbs[0], { x: px * -0.35, y: py * -0.35, scale: 1 + (sc - 1) * 0.4, duration: d, ease: e }, t);
    tl.to(H.bg.orbs[1], { x: px * -0.55, y: py * -0.55, scale: 1 + (sc - 1) * 0.6, duration: d, ease: e }, t);
    tl.to(H.bg.orbs[2], { x: px * -0.2, y: py * -0.2, duration: d, ease: e }, t);
    tl.to(H.bg.floor, { x: px * -0.8, y: py * -0.4, scaleX: 1 + (sc - 1) * 0.8, duration: d, ease: e }, t);
  };
  // slow drift of the floor grid that runs the whole film: the stage is always travelling
  H.drift = (tl, dur) => {
    tl.fromTo(H.bg.floor.firstChild, { y: 0 }, { y: 140, duration: dur, ease: "none" }, 0);
    tl.fromTo(H.bg.grain, { x: 0, y: 0 }, { x: 64, y: -48, duration: dur, ease: "steps(" + Math.round(dur * 12) + ")" }, 0);
  };

  // ---------- scenes ----------
  H.scene = (id) => { const s = H.el("div", "scene", null, H.bg.world); s.id = id; return s; };
  H.show = (tl, n, t) => (t <= 0 ? gsap.set(n, { autoAlpha: 1 }) : tl.set(n, { autoAlpha: 1 }, t));
  H.hide = (tl, n, t) => tl.set(n, { autoAlpha: 0 }, t);
  H.box = (parent, x, y, w, cls) => { const b = H.el("div", "wrap " + (cls || ""), null, parent); H.css(b, { left: x + "px", top: y + "px", width: w + "px" }); return b; };

  // headline: lines of text; *word* = brand gradient, _word_ = dimmed, ^word^ = gold
  H.headline = (parent, lines, opt) => {
    opt = opt || {};
    const h = H.el("div", "hl " + (opt.cls || ""), null, parent);
    H.css(h, { position: "absolute", left: (opt.x == null ? 60 : opt.x) + "px", width: (opt.w || 960) + "px", top: (opt.y || 300) + "px", fontSize: (opt.size || 136) + "px" });
    if (opt.align) h.style.textAlign = opt.align;
    const words = [];
    lines.forEach((ln) => {
      const L = H.el("span", "line", null, h);
      ln.split(" ").forEach((tok) => {
        let cls = "w", txt = tok;
        if (/^\*.*\*[.,!?:]*$/.test(tok)) { cls += " em"; txt = tok.replace(/\*/g, ""); }
        else if (/^_.*_[.,!?:]*$/.test(tok)) { cls += " dim"; txt = tok.replace(/_/g, ""); }
        else if (/^\^.*\^[.,!?:]*$/.test(tok)) { cls += " gold-t"; txt = tok.replace(/\^/g, ""); }
        words.push(H.el("span", cls, txt, L));
      });
    });
    // fit: shrink the size until the widest line fits the box
    const lns = [...h.querySelectorAll(".line")];
    lns.forEach((l) => (l.style.display = "inline-block"));
    const widest = Math.max(...lns.map((l) => l.getBoundingClientRect().width));
    lns.forEach((l) => (l.style.display = ""));
    const W = opt.w || 960;
    if (widest > W) h.style.fontSize = ((opt.size || 136) * W) / widest + "px";
    return { el: h, words };
  };

  // waterfall entry (binary opacity, power4.out from below), as one cascade from t
  H.waterfall = (tl, els, t, o) => {
    o = o || {};
    let gap = o.gap == null ? 0.055 : o.gap, at = t;
    els.forEach((e, i) => {
      gsap.set(e, { opacity: 0 });
      tl.set(e, { opacity: 1 }, at);
      tl.fromTo(e, { y: o.y || 70, rotate: o.rot || 0 }, { y: 0, rotate: 0, duration: o.dur || 0.2, ease: "power4.out", immediateRender: false }, at);
      at += gap; gap *= o.decay || 0.88;
    });
    return at;
  };
  // words land exactly when they are spoken: spans[i] <- line li word map[i]
  H.speak = (tl, spans, li, map, o) => {
    o = o || {};
    spans.forEach((e, i) => {
      const wi = map ? map[i] : i;
      const t = H.W(li, wi).s - (o.lead == null ? 0.05 : o.lead);
      gsap.set(e, { opacity: 0 });
      tl.set(e, { opacity: 1 }, t);
      tl.fromTo(e, { y: o.y || 80, scale: o.scale || 1 }, { y: 0, scale: 1, duration: o.dur || 0.22, ease: "power4.out", immediateRender: false }, t);
    });
  };

  // cut-the-curve (default seam, current = LEFT)
  H.exit = (tl, n, t, o) => {
    o = o || {};
    const d = o.dur || 0.3, dx = o.dx == null ? -150 : o.dx, dy = o.dy || 0;
    tl.to(n, { x: "+=" + dx, y: "+=" + dy, duration: d, ease: "power4.in" }, t - d);
    tl.to(n, { opacity: 0, duration: d * 0.72, ease: "none" }, t - d * 0.72);
  };
  H.enter = (tl, n, t, o) => {
    o = o || {};
    const d = o.dur || 0.42, dx = o.dx == null ? 150 : o.dx, dy = o.dy || 0;
    tl.fromTo(n, { x: dx, y: dy, opacity: 0.35 }, { x: 0, y: 0, opacity: 1, duration: d, ease: "power4.out", immediateRender: false }, t);
  };
  // full seam between two scene roots at t (o.dir: "left" default, or "up")
  H.seam = (tl, a, b, t, o) => {
    o = o || {};
    const up = o.dir === "up", D = o.dist || 150;
    H.exit(tl, a, t, up ? { dx: 0, dy: -D } : { dx: -D });
    H.hide(tl, a, t);
    H.show(tl, b, t);
    H.enter(tl, b, t, up ? { dx: 0, dy: D, dur: o.inDur } : { dx: D, dur: o.inDur });
    if (o.sfx !== false) H.sfx(o.sfx || "whoosh-short", t - 0.12, o.gain == null ? 0.55 : o.gain);
  };
  // zoom-through: deeper into the same thought (everything grows)
  H.zoomThrough = (tl, a, b, t, o) => {
    o = o || {};
    tl.to(a, { scale: 1.2, duration: 0.2, ease: "power3.in" }, t - 0.2);
    tl.to(a, { filter: "blur(10px)", duration: 0.2, ease: "power3.in" }, t - 0.2);
    tl.to(a, { opacity: 0.15, duration: 0.2, ease: "none" }, t - 0.2);
    H.hide(tl, a, t); H.show(tl, b, t);
    tl.fromTo(b, { scale: 0.75, filter: "blur(10px)" }, { scale: 1, filter: "blur(0px)", duration: 0.5, ease: "expo.out", immediateRender: false }, t);
    tl.fromTo(b, { opacity: 0.15 }, { opacity: 1, duration: 0.3, ease: "expo.out", immediateRender: false }, t);
    if (o.sfx !== false) H.sfx("whoosh", t - 0.18, o.gain == null ? 0.5 : o.gain);
  };
  // inverse zoom: arrival, something bigger lands (everything shrinks)
  H.arrive = (tl, a, b, t, o) => {
    o = o || {};
    if (a) {
      tl.to(a, { scale: 0.8, duration: 0.22, ease: "power3.in" }, t - 0.22);
      tl.to(a, { filter: "blur(10px)", duration: 0.22, ease: "power3.in" }, t - 0.22);
      tl.to(a, { opacity: 0.1, duration: 0.22, ease: "none" }, t - 0.22);
      H.hide(tl, a, t);
    }
    H.show(tl, b, t);
    tl.fromTo(b, { scale: o.from || 1.3, filter: "blur(12px)" }, { scale: 1, filter: "blur(0px)", duration: o.dur || 0.6, ease: "expo.out", immediateRender: false }, t);
    tl.fromTo(b, { opacity: 0.15 }, { opacity: 1, duration: 0.35, ease: "expo.out", immediateRender: false }, t);
    if (o.sfx !== false) H.sfx(o.sfx || "impact-bass-1", t - 0.02, o.gain == null ? 0.6 : o.gain);
  };

  // a single element pops into place (cards, chips) with an overshoot
  H.pop = (tl, n, t, o) => {
    o = o || {};
    gsap.set(n, { opacity: 0 });
    tl.set(n, { opacity: 1 }, t);
    tl.fromTo(n, { scale: o.from || 0.6, y: o.y || 30, rotate: o.rot || 0 }, { scale: 1, y: 0, rotate: o.toRot || 0, duration: o.dur || 0.42, ease: o.ease || "back.out(1.6)", immediateRender: false }, t);
    if (o.sfx) H.sfx(o.sfx, t, o.gain == null ? 0.5 : o.gain);
  };
  // card rises in 3D from below the frame edge
  H.rise = (tl, n, t, o) => {
    o = o || {};
    gsap.set(n, { opacity: 0 });
    tl.set(n, { opacity: 1 }, t);
    tl.fromTo(n, { y: o.y || 520, rotationX: o.rx == null ? 38 : o.rx, rotationY: o.ry || 0, scale: o.from || 0.9, transformPerspective: 1600 },
      { y: 0, rotationX: 0, rotationY: 0, scale: 1, duration: o.dur || 0.75, ease: "expo.out", immediateRender: false }, t);
    if (o.sfx !== false) H.sfx(o.sfx || "whoosh-short", t - 0.05, o.gain == null ? 0.45 : o.gain);
  };

  // counters / typing (proxy drivers)
  H.count = (tl, n, from, to, t, dur, o) => {
    o = o || {};
    const fmt = o.fmt || H.de, p = { v: from };
    n.textContent = fmt(from);
    tl.fromTo(p, { v: from }, { v: to, duration: dur, ease: o.ease || "power2.out", immediateRender: false, onUpdate: () => { n.textContent = fmt(p.v); } }, t);
    if (o.tick) {
      const steps = Math.min(o.tick, Math.abs(to - from));
      for (let i = 1; i <= steps; i++) H.sfx("key-press", t + (dur * i) / (steps + 1), o.tickGain || 0.12);
    }
  };
  // one counter through several waypoints [[t, v], ...]: a single driver, so seeking never shows a stale segment
  H.countPath = (tl, n, keys, o) => {
    o = o || {};
    const fmt = o.fmt || H.de, p = { t: keys[0][0] };
    const ease = gsap.parseEase(o.ease || "power1.inOut");
    const val = (t) => {
      for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
        return v0 + (v1 - v0) * ease((t - t0) / Math.max(1e-6, t1 - t0));
      }
      return keys[keys.length - 1][1];
    };
    n.textContent = fmt(keys[0][1]);
    tl.fromTo(p, { t: keys[0][0] }, { t: keys[keys.length - 1][0], duration: keys[keys.length - 1][0] - keys[0][0], ease: "none", immediateRender: false, onUpdate: () => { n.textContent = fmt(val(p.t)); } }, keys[0][0]);
  };
  H.type = (tl, n, text, t, cps, o) => {
    o = o || {};
    const p = { k: 0 }, d = text.length / (cps || 24);
    tl.fromTo(p, { k: 0 }, { k: text.length, duration: d, ease: "none", immediateRender: false, onUpdate: () => { n.textContent = text.slice(0, Math.round(p.k)); } }, t);
    if (o.sfx !== false) for (let i = 0; i < text.length; i += 3) H.sfx("key-press", t + i / (cps || 24), 0.08);
    return t + d;
  };

  // oversized cursor
  H.cursor = (parent) => {
    const c = H.el("div", "cursor", '<svg viewBox="0 0 32 32"><path d="M6 3.5v22.2l6.1-5.6 3.9 8.8 4-1.8-3.9-8.6 8.4-.4z" fill="#fff" stroke="#061b40" stroke-width="1.8" stroke-linejoin="round"/></svg>', parent);
    const ring = H.el("div", "tap", null, parent);
    return { c, ring };
  };
  H.cursorIn = (tl, cur, x, y, t, o) => {
    o = o || {};
    gsap.set(cur.c, { opacity: 0 });
    tl.set(cur.c, { opacity: 1 }, t);
    tl.fromTo(cur.c, { x: o.fromX == null ? 1180 : o.fromX, y: o.fromY == null ? y + 260 : o.fromY }, { x, y, duration: o.dur || 0.6, ease: "power3.out", immediateRender: false }, t);
  };
  H.cursorTo = (tl, cur, x, y, t, dur) => tl.to(cur.c, { x, y, duration: dur || 0.45, ease: "power3.inOut" }, t);
  H.click = (tl, cur, t, x, y, o) => {
    o = o || {};
    tl.to(cur.c, { scale: 0.82, duration: 0.07, ease: "power2.in", transformOrigin: "10% 10%" }, t - 0.07);
    tl.to(cur.c, { scale: 1, duration: 0.22, ease: "back.out(2)" }, t);
    tl.set(cur.ring, { x: x + 14, y: y + 12 }, t);
    tl.fromTo(cur.ring, { scale: 0.3, opacity: 0.95 }, { scale: 1.25, opacity: 0, duration: 0.45, ease: "power2.out", immediateRender: false }, t);
    H.sfx(o.sfx || "click", t, o.gain == null ? 0.7 : o.gain);
  };
  H.cursorOut = (tl, cur, t, o) => {
    o = o || {};
    tl.to(cur.c, { x: o.x == null ? 1200 : o.x, y: o.y == null ? "+=300" : o.y, duration: 0.45, ease: "power3.in" }, t);
    tl.set(cur.c, { opacity: 0 }, t + 0.45);
  };


  // specular light sweep across a card as it lands
  H.glare = (tl, card, t, o) => {
    o = o || {};
    const w = H.el("div", "glare-wrap", null, card);
    const g = H.el("div", "glare", null, w);
    tl.fromTo(g, { xPercent: -120, rotate: 18 }, { xPercent: 360, rotate: 18, duration: o.dur || 0.9, ease: "power2.inOut", immediateRender: true }, t);
    return g;
  };
  // the card keeps turning with the camera: slow 3D yaw through its scene
  H.tilt = (tl, card, t, dur, o) => {
    o = o || {};
    tl.fromTo(card, { rotationY: o.from == null ? -5 : o.from, rotationX: o.fx || 3, transformPerspective: 1800 },
      { rotationY: o.to == null ? 5 : o.to, rotationX: o.tx || -2, duration: dur, ease: "none", immediateRender: false }, t);
  };
  H.notif = (parent, x, y, title, text, when) => {
    const n = H.el("div", "notif", `<div class="app"><div>${H.dmark()}</div></div><div style="flex:1"><div class="row"><b>${title}</b><span class="when">${when || "jetzt"}</span></div><p>${text}</p></div>`, parent);
    H.css(n, { left: x + "px", top: y + "px" });
    return n;
  };


  // Tagesabschluss as in the app: three numbers, energy, one reflection, submit
  H.formCard = (parent, x, y, w, o) => {
    o = o || {};
    const c = H.box(parent, x, y, w, "ui");
    c.innerHTML = `<span class="demo-tag">Beispiel</span>
      <div class="ttl">Tagesabschluss</div><div class="meta" style="margin-top:6px">Du trägst ein als <b style="color:#0a2043">${o.name || "Alex"}</b> · Heute</div>
      <div class="row" style="gap:20px;margin-top:30px">
        <div style="flex:1"><div class="field-l">Anwahlen</div><div class="field" data-f="a"><span>0</span></div></div>
        <div style="flex:1"><div class="field-l">Settings</div><div class="field" data-f="s"><span>0</span></div></div>
        <div style="flex:1"><div class="field-l">Closings</div><div class="field" data-f="c"><span>0</span></div></div>
      </div>
      <div class="field-l" style="margin-top:28px">Energie</div>
      <div class="energy"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></div>
      <div class="field-l" style="margin-top:28px">Was lief gut?</div>
      <div class="textarea"><span class="tx"></span><span class="caret" style="opacity:0"></span></div>
      <div class="btn" style="margin-top:30px">Einreichen</div>
      <div class="done" style="position:absolute;inset:0;border-radius:40px;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;opacity:0">
        <div class="ring done-ring" style="width:250px;height:250px"></div>
        <div style="font-weight:800;font-size:56px;letter-spacing:-.04em;margin-top:30px;text-align:center;line-height:1.08">Volle Runde.<br>Dein Tag ist drin.</div>
        <div class="meta done-sum" style="margin-top:18px;font-size:30px"></div>
      </div>`;
    const ring = H.ringSVG(250, 22, ["#3ddc97", "#17a463"], "#e3f7ec");
    const rEl = c.querySelector(".done-ring");
    rEl.innerHTML = ring.html + `<div class="inner"><div style="width:110px;height:110px">${H.icon("check", "#17a463", 3)}</div></div>`;
    const f = (k) => c.querySelector(`[data-f="${k}"]`);
    return {
      el: c, f, num: (k) => f(k).firstChild, energy: [...c.querySelectorAll(".energy span")], tx: c.querySelector(".tx"), caret: c.querySelector(".textarea .caret"),
      btn: c.querySelector(".btn"), done: c.querySelector(".done"), arc: rEl.querySelector(".arc"), C: ring.C, check: rEl.querySelector(".inner > div"), sum: c.querySelector(".done-sum"),
    };
  };
  // fill the form on given beats: vals {a,s,c}, times {a,s,c,energy,text,submit}
  H.fillForm = (tl, F, vals, tm, o) => {
    o = o || {};
    [["a", 0.55], ["s", 0.25], ["c", 0.25]].forEach(([k, d]) => {
      if (tm[k] == null) return;
      tl.set(F.f(k), { attr: { class: "field focus" } }, tm[k] - 0.05);
      H.count(tl, F.num(k), 0, vals[k], tm[k], vals[k] > 20 ? d + 0.2 : d, { tick: Math.min(vals[k], 6), tickGain: 0.12, ease: "power1.out" });
      tl.set(F.f(k), { attr: { class: "field" } }, tm[k] + d + 0.35);
    });
    if (tm.energy != null) { tl.set(F.energy[3], { attr: { class: "on" } }, tm.energy); H.sfx("click-soft", tm.energy, 0.4); }
    if (tm.text != null) {
      tl.set(F.caret, { opacity: 1 }, tm.text);
      H.type(tl, F.tx, o.text || "Nach dem Einwand nachgefragt statt aufgelegt.", tm.text, o.cps || 34);
    }
    if (tm.submit != null) {
      const t = tm.submit;
      tl.to(F.btn, { scale: 0.96, duration: 0.08 }, t - 0.08);
      tl.to(F.btn, { scale: 1, duration: 0.25, ease: "back.out(2)" }, t);
      tl.set(F.sum, { textContent: `${H.de(vals.a)} Anwahlen · ${vals.s} Settings · ${vals.c} ${vals.c === 1 ? "Closing" : "Closings"}` }, 0);
      tl.to(F.done, { opacity: 1, duration: 0.25, ease: "power2.out" }, t + 0.12);
      tl.fromTo(F.arc, { strokeDashoffset: F.C }, { strokeDashoffset: 0, duration: 0.7, ease: "power3.inOut", immediateRender: false }, t + 0.2);
      tl.fromTo(F.check, { scale: 0, rotate: -20 }, { scale: 1, rotate: 0, duration: 0.45, ease: "back.out(2)", immediateRender: false }, t + 0.75);
      H.sfx("chime", t + 0.75, 0.42);
    }
  };

  // ---------- captions (verbatim rail) ----------
  H.captions = (tl, o) => {
    o = o || {};
    const box = document.getElementById("captions");
    const skip = new Set(R.embed || []);
    const pages = [];
    R.lines.forEach((ln, li) => {
      if (skip.has(li) || (o.skipCta && li === R.lines.length - 1)) return;
      let cur = [];
      ln.words.forEach((w, wi) => {
        cur.push(w);
        const chars = cur.map((x) => x.w).join(" ").length;
        const punct = /[.,:!?–]$/.test(w.w);
        const next = ln.words[wi + 1];
        if (!next || punct || cur.length >= (o.max || 3) || chars + (next ? next.w.length : 0) > (o.chars || 19)) { pages.push({ li, words: cur }); cur = []; }
      });
    });
    pages.forEach((p, i) => {
      const n = H.el("div", "cap-page", null, box);
      const spans = p.words.map((w) => H.el("span", "cap-w", w.w.replace(/[„“"]/g, ""), n));
      gsap.set(n, { xPercent: -50 });
      const s = p.words[0].s - 0.04;
      const nxt = pages[i + 1];
      let e = p.words[p.words.length - 1].e + 0.4;
      if (nxt && nxt.words[0].s - 0.04 < e) e = nxt.words[0].s - 0.04;
      if (o.until && e > o.until) e = o.until;
      tl.set(n, { autoAlpha: 1 }, s);
      tl.fromTo(n, { y: 22, scale: 0.92 }, { y: 0, scale: 1, duration: 0.18, ease: "power3.out", immediateRender: false }, s);
      tl.set(n, { autoAlpha: 0 }, e);
      p.words.forEach((w, k) => {
        tl.set(spans[k], { color: "#68d8ff" }, w.s);
        const nw = p.words[k + 1];
        tl.set(spans[k], { color: "#ffffff" }, nw ? nw.s : e);
      });
    });
  };

  // ---------- product pieces ----------
  H.statsCard = (parent, x, y, w, vals) => {
    const c = H.box(parent, x, y, w, "ui dark");
    c.innerHTML = `<span class="demo-tag">Beispieldaten</span><div class="ttl">Gemeinsam erreicht</div><div class="meta" style="margin-top:8px">Heute · alle Caller</div>
      <div class="stats">
        <div class="stat"><div class="lbl">${H.icon("phone", "#68d8ff")}Anwahlen</div><div class="num" data-k="a">0</div><div class="cap">an diesem Tag</div></div>
        <div class="stat"><div class="lbl">${H.icon("cal", "#68d8ff")}Settings</div><div class="num" data-k="s">0</div><div class="cap">vereinbart</div></div>
        <div class="stat"><div class="lbl">${H.icon("hand", "#68d8ff")}Closings</div><div class="num" data-k="c">0</div><div class="cap">vereinbart</div></div>
        <div class="stat"><div class="lbl">${H.icon("users", "#68d8ff")}Personen</div><div class="num" data-k="p">0</div><div class="cap">mit Tagesbericht</div></div>
      </div>`;
    return { el: c, num: (k) => c.querySelector(`[data-k="${k}"]`), vals };
  };

  H.rankCard = (parent, x, y, w, rows, o) => {
    o = o || {};
    const c = H.box(parent, x, y, w, "ui");
    let h = `<span class="demo-tag">Beispieldaten</span><div class="row" style="margin-bottom:10px"><div class="ttl">Rangliste</div></div>`;
    const pl = (v, one, many) => `<b>${v}</b>${v === 1 ? one : many}`;
    rows.forEach((r, i) => {
      const medal = i === 0 ? "g" : i === 1 ? "s" : i === 2 ? "b" : "";
      h += `<div class="rank-row${r.me ? " me-row" : ""}" data-i="${i}"><div class="rank-no ${medal}">${r.no || i + 1}</div><div class="rank-main"><div class="rank-name">${r.name}</div>
        <div class="bar${i === 0 ? " g" : ""}"><i style="transform:scaleX(${r.p})"></i></div>
        <div class="trio"><span>${pl(r.a, "Anwahl", "Anwahlen")}</span><span>${pl(r.s, "Setting", "Settings")}</span><span>${pl(r.c, "Closing", "Closings")}</span></div></div></div>`;
    });
    c.innerHTML = h;
    return { el: c, rows: [...c.querySelectorAll(".rank-row")], bars: [...c.querySelectorAll(".bar i")] };
  };

  H.ringSVG = (size, stroke, color, track) => {
    const r = (size - stroke) / 2, C = 2 * Math.PI * r, g = "rg" + ++uid;
    return {
      html: `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${color[0]}"/><stop offset="1" stop-color="${color[1]}"/></linearGradient></defs>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${track}" stroke-width="${stroke}"/>
        <circle class="arc" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#${g})" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`,
      C,
    };
  };

  H.endCard = (parent, o) => {
    o = o || {};
    const s = H.el("div", "center", null, parent);
    s.innerHTML = `
      <div class="ec-mark">${H.wordmark(86)}</div>
      <div class="hl ec-h" style="font-size:112px;margin-top:60px;width:980px"><span class="line"><span class="w">Schreib</span></span><span class="line"><span class="w"><span class="key-chip">Discord</span></span></span><span class="line" style="font-size:.62em;margin-top:26px"><span class="w">in</span><span class="w">die</span><span class="w">Kommentare.</span></span></div>
      <div class="comment ec-c" style="margin-top:64px"><div class="av c1" style="width:88px;height:88px;font-size:32px">Du</div><div class="field-t"><span class="ec-typed"></span><span class="caret"></span></div><div class="send">${H.icon("send", "#fff", 2.4)}</div></div>
      <div class="sub ec-s" style="margin-top:40px">Ich schick dir den Link. <span style="color:#68d8ff">Kostenfrei.</span></div>`;
    return {
      el: s,
      mark: s.querySelector(".ec-mark"),
      words: [...s.querySelectorAll(".ec-h .w")],
      comment: s.querySelector(".ec-c"),
      typed: s.querySelector(".ec-typed"),
      caret: s.querySelector(".caret"),
      sub: s.querySelector(".ec-s"),
      send: s.querySelector(".send"),
    };
  };

  // the CTA beat shared by every reel: lands on the CTA line, holds to the end
  H.ctaBeat = (tl, prevScene, o) => {
    o = o || {};
    const c = H.cta();
    const sc = H.scene("cta");
    const ec = H.endCard(sc);
    const t0 = c.s - 0.12;
    H.arrive(tl, prevScene, sc, t0, { from: 1.25, sfx: "impact-bass-2", gain: 0.55 });
    tl.fromTo(ec.mark, { scale: 0.75, y: 40 }, { scale: 1, y: 0, duration: 0.7, ease: "expo.out", immediateRender: false }, t0);
    // headline words land with the voice: Schreib / Discord / in die / Kommentare
    const map = [["Schreib"], ["Discord"], ["in"], ["die"], ["Kommentare"]];
    ec.words.forEach((w, i) => {
      const t = H.at(R.lines.length - 1, map[i][0]) - 0.05;
      gsap.set(w, { opacity: 0 }); tl.set(w, { opacity: 1 }, t);
      tl.fromTo(w, { y: 70, scale: i === 1 ? 1.25 : 1 }, { y: 0, scale: 1, duration: i === 1 ? 0.5 : 0.22, ease: i === 1 ? "back.out(1.7)" : "power4.out", immediateRender: false }, t);
      if (i === 1) H.sfx("pop", t, 0.6);
    });
    // the comment gets typed while "Discord" is said, then sent
    const tType = H.at(R.lines.length - 1, "Discord") + 0.05;
    gsap.set(ec.comment, { opacity: 0 }); tl.set(ec.comment, { opacity: 1 }, tType - 0.25);
    tl.fromTo(ec.comment, { y: 60 }, { y: 0, duration: 0.4, ease: "power4.out", immediateRender: false }, tType - 0.25);
    const tEnd = H.type(tl, ec.typed, "DISCORD", tType, 14);
    tl.fromTo(ec.caret, { opacity: 1 }, { opacity: 0, duration: 0.3, repeat: 9, yoyo: true, ease: "steps(1)" }, tEnd);
    const tSend = Math.max(tEnd + 0.25, H.at(R.lines.length - 1, "ich") - 0.1);
    tl.to(ec.send, { scale: 0.86, duration: 0.08 }, tSend - 0.08);
    tl.to(ec.send, { scale: 1, duration: 0.3, ease: "back.out(2)" }, tSend);
    tl.to(ec.send, { boxShadow: "0 0 0 18px rgba(104,216,255,0)", duration: 0.5, ease: "power2.out" }, tSend);
    H.sfx("notification", tSend, 0.45);
    gsap.set(ec.sub, { opacity: 0 }); tl.set(ec.sub, { opacity: 1 }, tSend);
    tl.fromTo(ec.sub, { y: 40 }, { y: 0, duration: 0.35, ease: "power4.out", immediateRender: false }, tSend);
    // the frame keeps travelling to the last frame: slow push-in on the end card
    tl.fromTo(ec.el, { y: 0 }, { y: -24, duration: R.duration - t0, ease: "none", immediateRender: false }, t0);
    return { scene: sc, t0 };
  };
})();
