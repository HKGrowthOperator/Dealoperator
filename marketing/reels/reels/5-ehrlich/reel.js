// Reel 5: "Wie viele Anwahlen hast du diese Woche gemacht? Ehrlich." -> unclear -> two-minute entry -> Tagesmarke, Serie, Woche in black and white -> Discord.
const L = H.L;

// ---------- S1 the question + an empty field ----------
const s1 = H.scene("s1");
H.show(tl, s1, 0);
const h1 = H.headline(s1, ["Wie viele *Anwahlen*", "hast du diese", "Woche gemacht?"], { y: 420, size: 120 });
H.speak(tl, h1.words, 0, [0, 1, 2, 3, 4, 5, 6, 7], { lead: 0.07, y: 60 });
const fld = H.box(s1, 190, 900, 700, "ui");
H.css(fld, { padding: "30px 36px" });
fld.innerHTML = `<div class="field-l">Anwahlen diese Woche</div><div class="field q-field" style="height:150px;font-size:96px;justify-content:center"><span class="q-n" style="color:#b5c3d8">?</span><span class="caret" style="height:90px;width:6px"></span></div>`;
gsap.set(fld, { opacity: 0 });
H.pop(tl, fld, H.at(0, "Woche") - 0.1, { from: 0.85, y: 60, ease: "back.out(1.3)", sfx: "pop", gain: 0.35 });
const caret = fld.querySelector(".caret");
tl.fromTo(caret, { opacity: 1 }, { opacity: 0, duration: 0.01, repeat: 9, yoyo: true, repeatDelay: 0.32, ease: "steps(1)", immediateRender: false }, H.at(0, "Woche"));

// ---------- S2 "Ehrlich." deeper (zoom-through) ----------
const s2 = H.scene("s2");
const t2 = L(1).s - 0.08;
H.zoomThrough(tl, s1, s2, t2);
const h2 = H.headline(s2, ["*Ehrlich.*"], { y: 560, size: 210 });
H.speak(tl, h2.words, 1, [0], { lead: 0.06, y: 70 });
const h2b = H.headline(s2, ["Ohne nachzuschauen."], { y: 820, size: 84, cls: "" });
h2b.words.forEach((w) => w.classList.add("dim"));
H.speak(tl, h2b.words, 1, [1, 2], { lead: 0.06, y: 40 });
H.sfx("impact-bass-1", H.at(1, "Ehrlich") - 0.04, 0.45);

// ---------- S3 the number won't settle ----------
const s3 = H.scene("s3");
const t3 = L(2).s - 0.08;
H.seam(tl, s2, s3, t3);
const fld3 = H.box(s3, 140, 520, 800, "ui");
H.css(fld3, { padding: "34px 40px" });
fld3.innerHTML = `<div class="field-l">Anwahlen diese Woche</div><div class="field f3" style="height:190px;font-size:130px;justify-content:center"><span class="n3" style="filter:blur(3px)">214</span></div>
  <div class="meta m3" style="margin-top:20px;text-align:center">Irgendwas zwischen 80 und 400?</div>`;
H.enter(tl, fld3, t3, { dx: 150 });
const n3 = fld3.querySelector(".n3"), f3 = fld3.querySelector(".f3");
const rs = H.rng(99);
const tP = H.at(2, "Problem");
for (let t = t3 + 0.1; t < tP; t += 0.085) tl.set(n3, { textContent: String(60 + Math.floor(rs() * 380)) }, t);
tl.set(n3, { textContent: "?", filter: "blur(0px)" }, tP);
tl.set(f3, { borderColor: "#e5484d", boxShadow: "0 0 0 8px rgba(229,72,77,.15)" }, tP);
tl.fromTo(fld3, { x: 0 }, { x: 14, duration: 0.05, repeat: 5, yoyo: true, ease: "none", immediateRender: false }, tP);
H.sfx("error", tP, 0.3);

// ---------- S4 two minutes a day (brand arrives with the entry) ----------
const s4 = H.scene("s4");
const t4 = H.at(3, "Deal") - 0.05;
H.arrive(tl, s3, s4, t4, { from: 1.25, sfx: "impact-bass-2", gain: 0.5 });
const wm = H.box(s4, 0, 140, 1080); wm.style.textAlign = "center"; wm.innerHTML = H.wordmark(84);
const F = H.formCard(s4, 80, 360, 920);
gsap.set(F.el, { opacity: 1 });
const tTag = H.at(3, "Calling");
H.fillForm(tl, F, { a: 104, s: 2, c: 1 }, { a: tTag - 0.1, s: tTag + 0.45, c: tTag + 0.7, energy: tTag + 0.9, submit: L(3).e - 0.05 });
const tmr = H.el("div", "pill blue", `${H.icon("clock", "#0755f5").replace("<svg", '<svg width="34" height="34"')}2 Minuten am Tag`, s4);
H.css(tmr, { position: "absolute", left: "50%", top: "258px", fontSize: "34px", padding: "14px 28px", background: "rgba(233,241,255,.95)" });
gsap.set(tmr, { xPercent: -50, opacity: 0 });
H.pop(tl, tmr, H.at(3, "zwei") - 0.05, { from: 0.7, sfx: "pop", gain: 0.4 });
const cur = H.cursor(s4);
H.cursorIn(tl, cur, 600, 1102, L(3).e - 0.7, { fromX: 980, fromY: 1500 });
H.click(tl, cur, L(3).e - 0.05, 600, 1102);
H.cursorOut(tl, cur, L(3).e + 0.3);

// ---------- S5 Mein Tag: Tagesmarke, Serie, Woche ----------
const s5 = H.scene("s5");
const t5 = L(4).s - 0.08;
H.seam(tl, s4, s5, t5);
const md = H.box(s5, 70, 250, 940, "ui");
const rg = H.ringSVG(270, 24, ["#68d8ff", "#0755f5"], "#e9f1ff");
md.innerHTML = `<span class="demo-tag">Beispiel</span>
  <div class="row"><div class="ttl">Mein Tag</div><span class="pill green vr" style="margin-left:18px;font-size:26px;opacity:0">Volle Runde</span></div>
  <div class="row" style="gap:36px;margin-top:30px">
    <div class="ring" style="width:270px;height:270px">${rg.html}<div class="inner"><div class="mk-n" style="font-weight:800;font-size:92px;letter-spacing:-.05em;line-height:1;font-variant-numeric:tabular-nums">0</div><div class="meta" style="font-size:24px;margin-top:6px">von 100</div></div></div>
    <div style="flex:1"><div class="mk-l" style="font-weight:800;font-size:40px;letter-spacing:-.03em">Tagesmarke</div><div class="meta" style="margin-top:8px">Dein eigenes Ziel für heute</div>
      <div class="flame-badge" style="margin-top:26px">${H.icon("flame", "#e8590c", 2.4)}<span class="fn">8</span>&nbsp;Tage Serie</div></div>
  </div>
  <div style="height:1.5px;background:#e8eef7;margin:34px 0 28px"></div>
  <div class="row" style="align-items:flex-end;gap:18px"><div><div class="meta">Diese Woche</div><div class="wk-n" style="font-weight:800;font-size:120px;letter-spacing:-.055em;line-height:1;margin-top:8px;font-variant-numeric:tabular-nums">0</div></div><div class="meta" style="margin-bottom:16px;font-size:32px">Anwahlen</div></div>
  <div class="bar" style="height:16px;margin-top:22px"><i class="wk-bar" style="transform:scaleX(0)"></i></div>
  <div class="meta wk-goal" style="margin-top:10px">Wochenziel: 0 von 500 Anwahlen</div>`;
H.rise(tl, md, t5, { sfx: false, y: 260 });
H.glare(tl, md, t5 + 0.35);
const arc = md.querySelector(".arc"), mkN = md.querySelector(".mk-n");
const tMk = H.at(4, "Tagesmarke");
tl.fromTo(arc, { strokeDashoffset: rg.C }, { strokeDashoffset: 0, duration: 0.9, ease: "power3.inOut", immediateRender: false }, tMk - 0.15);
H.count(tl, mkN, 0, 100, tMk - 0.15, 0.9, { ease: "power3.inOut" });
tl.set(md.querySelector(".mk-l"), { textContent: "Tagesmarke geschafft" }, tMk + 0.8);
tl.to(md.querySelector(".vr"), { opacity: 1, duration: 0.2 }, tMk + 0.8);
tl.fromTo(md.querySelector(".vr"), { scale: 0.6 }, { scale: 1, duration: 0.4, ease: "back.out(2)", immediateRender: false }, tMk + 0.8);
H.sfx("chime", tMk + 0.8, 0.35);
const tSw = H.at(4, "wächst");
const fn = md.querySelector(".fn");
tl.set(fn, { textContent: "9" }, tSw);
tl.fromTo(fn, { y: -36, scale: 1.4 }, { y: 0, scale: 1, duration: 0.45, ease: "back.out(2)", immediateRender: false }, tSw);
H.sfx("ping", tSw, 0.4);
const tBW = H.at(4, "schwarz");
const wkN = md.querySelector(".wk-n"), wkBar = md.querySelector(".wk-bar"), wkGoal = md.querySelector(".wk-goal");
H.count(tl, wkN, 0, 412, tBW - 0.1, 1.0, { ease: "power2.out", tick: 6, tickGain: 0.1 });
tl.fromTo(wkBar, { scaleX: 0 }, { scaleX: 412 / 500, duration: 1.0, ease: "power2.out", immediateRender: false }, tBW - 0.1);
const pg = { v: 0 };
tl.fromTo(pg, { v: 0 }, { v: 412, duration: 1.0, ease: "power2.out", immediateRender: false, onUpdate: () => { wkGoal.textContent = `Wochenziel: ${Math.round(pg.v)} von 500 Anwahlen`; } }, tBW - 0.1);
H.cam(tl, t5, { scale: 1.04, y: -24 }, L(4).e - t5 + 0.2, "none");

// ---------- S6 in Discord with people who keep going ----------
const s6 = H.scene("s6");
const t6 = L(5).s - 0.08;
H.cam(tl, t6 - 0.01, { scale: 1, y: 0 }, 0.01);
H.seam(tl, s5, s6, t6, { dir: "up" });
const room = H.box(s6, 70, 300, 940, "ui");
const ppl = [["LW", "Lena W.", "c1", 14], ["MK", "Malik K.", "c3", 9], ["SR", "Sophie R.", "c5", 21], ["DA", "Deniz A.", "c4", 6], ["CM", "Clara M.", "c2", 11], ["Du", "Du", "c6", 9]];
room.innerHTML = `<span class="demo-tag">Beispiel</span>
  <div class="room-head"><span class="pill live">● Live</span><div class="ttl">Call-Session</div><span class="sp"></span><span class="pill blue dp">${H.icon("mic", "#0755f5").replace("<svg", '<svg width="28" height="28"')}im Discord</span></div>
  <div class="tiles">${ppl.map((p) => `<div class="tile"><div class="speak"></div><div class="av ${p[2]}" style="width:96px;height:96px">${p[0]}</div><div class="nm">${p[1]}</div><div class="rl" style="color:#e8590c">${H.icon("flame", "#e8590c", 2.4).replace("<svg", '<svg width="22" height="22" style="vertical-align:-3px;margin-right:4px"')}${p[3]} Tage</div></div>`).join("")}</div>`;
H.rise(tl, room, t6, { sfx: false, y: 260 });
H.glare(tl, room, t6 + 0.3);
[...room.querySelectorAll(".tile")].forEach((tile, k) => H.pop(tl, tile, t6 + 0.15 + k * 0.07, { from: 0.7, y: 20, dur: 0.36, ease: "back.out(1.4)" }));
const dp = room.querySelector(".dp");
tl.fromTo(dp, { scale: 1 }, { scale: 1.18, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, H.at(5, "Discord") - 0.04);
H.sfx("ping", H.at(5, "Discord"), 0.3);
const tDr = H.at(5, "dranbleiben");
[...room.querySelectorAll(".speak")].forEach((sp, k) => { tl.to(sp, { opacity: 1, duration: 0.1 }, tDr - 0.2 + k * 0.08); tl.to(sp, { opacity: 0, duration: 0.25 }, tDr + 0.35 + k * 0.08); });
H.cam(tl, t6, { scale: 1.04 }, L(5).e - t6 + 0.2, "none");

// ---------- CTA ----------
H.cam(tl, L(6).s - 0.2, { scale: 1, y: 0 }, 0.01);
H.ctaBeat(tl, s6);
