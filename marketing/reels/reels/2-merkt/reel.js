// Reel 2: "Du hörst nicht wegen der Absagen auf." Quitting goes unnoticed -> someone notices -> Tagesabschluss, Serie, Rangliste.
const { orbs, floor } = H.bg;
const L = H.L;

// ---------- S1 hook: rejections rain behind the line ----------
const s1 = H.scene("s1");
H.show(tl, s1, 0);
const rain = H.el("div", "layer", null, s1);
const rnd = H.rng(42);
const nos = ["Kein Interesse", "Mailbox", "Kein Bedarf", "Aufgelegt", "Keine Zeit", "Mailbox", "Kein Interesse", "Schicken Sie Infos", "Besetzt", "Kein Bedarf", "Aufgelegt", "Mailbox"];
nos.concat(nos).forEach((txt, i) => {
  const r = H.el("div", "rain", txt, rain);
  const x = -40 + rnd() * 820, depth = 0.45 + rnd() * 0.65;
  H.css(r, { left: x + "px", top: "0px", fontSize: 36 * depth + "px", filter: depth < 0.75 ? "blur(3px)" : depth < 0.95 ? "blur(1px)" : "none" });
  // already falling on frame 0, spread over the whole height; closer chips fall faster
  const y0 = -300 + rnd() * 2100, speed = 260 * depth;
  gsap.set(r, { opacity: 0.18 + depth * 0.32, rotate: (rnd() - 0.5) * 16 });
  tl.fromTo(r, { y: y0 }, { y: y0 + speed * 2.4, duration: 2.4, ease: "none", immediateRender: true }, 0);
});
const hook = H.headline(s1, ["Du hörst nicht", "wegen der", "*Absagen* auf."], { y: 640, size: 150 });
H.speak(tl, hook.words, 0, [0, 1, 2, 3, 4, 5, 6], { lead: 0.08, y: 70 });
H.sfx("impact-bass-1", H.at(0, "Absagen") - 0.05, 0.55);
tl.fromTo(hook.words[5], { scale: 1.25 }, { scale: 1, duration: 0.45, ease: "expo.out", immediateRender: false }, H.at(0, "Absagen") - 0.06);

// ---------- S2 deeper: nobody notices (zoom-through) ----------
const s2 = H.scene("s2");
const t2 = L(1).s - 0.08;
H.zoomThrough(tl, s1, s2, t2);
const h2 = H.headline(s2, ["Sondern, weil", "*keiner* *merkt,*", "wenn du", "aufhörst."], { y: 560, size: 140 });
H.speak(tl, h2.words, 1, [0, 1, 2, 3, 4, 5, 6], { lead: 0.08, y: 60 });
// the week quietly empties under the line: days go dark one after another
const wk = H.el("div", "week", ["Mo", "Di", "Mi", "Do", "Fr"].map((d) => `<div class="d on"><i>${H.icon("check", "#fff", 3)}</i><span style="color:#9fb5d6">${d}</span></div>`).join(""), s2);
H.css(wk, { position: "absolute", left: "150px", width: "780px", top: "1180px" });
const days = [...wk.children];
H.waterfall(tl, days, t2 + 0.1, { y: 40, gap: 0.05 });
const tQuit = H.at(1, "wenn");
days.slice(2).forEach((d, i) => {
  tl.set(d, { attr: { class: "d" } }, tQuit + i * 0.22);
  tl.to(d, { opacity: 0.35, duration: 0.3 }, tQuit + i * 0.22);
});
// lights go out on "aufhörst"
const tOff = H.at(1, "aufhörst");
tl.to(orbs, { opacity: 0.15, duration: 0.5, ease: "power2.in" }, tOff);
tl.to(floor, { opacity: 0.15, duration: 0.5, ease: "power2.in" }, tOff);
tl.to(h2.words.slice(0, 6), { opacity: 0.35, duration: 0.4 }, tOff + 0.1);

// ---------- S3 someone notices: brand + reminder ----------
const s3 = H.scene("s3");
const t3 = H.at(2, "Deal") - 0.04;
H.arrive(tl, s2, s3, t3, { from: 1.3, sfx: "impact-bass-2", gain: 0.55 });
tl.to(orbs, { opacity: 1, duration: 0.8, ease: "power2.out" }, t3);
tl.to(floor, { opacity: 0.6, duration: 0.8, ease: "power2.out" }, t3);
const wm = H.box(s3, 0, 300, 1080); wm.style.textAlign = "center"; wm.innerHTML = H.wordmark(104);
const h3 = H.headline(s3, ["merkt es", "*jemand.*"], { y: 500, size: 150 });
H.speak(tl, h3.words, 2, [3, 4, 5], { lead: 0.06, y: 60 });
const nt = H.notif(s3, 90, 960, "Deal Operator", "Dein Tagesabschluss ist noch offen. Zahlen eintragen?", "18:30");
gsap.set(nt, { opacity: 0 });
const tN = H.at(2, "jemand") - 0.1;
tl.set(nt, { opacity: 1 }, tN);
tl.fromTo(nt, { y: -80, scale: 0.92 }, { y: 0, scale: 1, duration: 0.55, ease: "back.out(1.4)", immediateRender: false }, tN);
H.sfx("notification", tN, 0.5);
H.cam(tl, t3, { scale: 1.04 }, L(2).e - t3 + 0.3, "none");

// ---------- S4/S5 the Tagesabschluss: card rises, numbers land on the spoken words ----------
const s4 = H.scene("s4");
const t4 = L(3).s - 0.1;
H.cam(tl, t4 - 0.01, { scale: 1 }, 0.01);
H.seam(tl, s3, s4, t4);
const F = H.formCard(s4, 80, 220, 920);
H.rise(tl, F.el, t4, { sfx: false, y: 360, rx: 26 });
H.glare(tl, F.el, t4 + 0.35);
H.tilt(tl, F.el, t4 + 0.75, L(4).e - t4, { from: 0, to: -4, fx: 0, tx: 2 });
const tSubmit = H.at(4, "Zwei") + 0.15;
H.fillForm(tl, F, { a: 112, s: 3, c: 1 }, { a: H.at(4, "Anwahlen"), s: H.at(4, "Settings"), c: H.at(4, "Closings"), energy: H.at(4, "Closings") + 0.3, submit: tSubmit });
const timer = H.el("div", "pill blue", `${H.icon("clock", "#0755f5").replace("<svg", '<svg width="34" height="34"')}Zwei Minuten`, s4);
H.css(timer, { position: "absolute", left: "50%", top: "120px", fontSize: "34px", padding: "14px 28px", background: "rgba(233,241,255,.95)" });
gsap.set(timer, { xPercent: -50, opacity: 0 });
H.pop(tl, timer, H.at(4, "Zwei") - 0.05, { from: 0.7, sfx: "pop", gain: 0.25 });
const cur = H.cursor(s4);
H.cursorIn(tl, cur, 600, 962, tSubmit - 0.6, { fromX: 980, fromY: 1400 });
H.click(tl, cur, tSubmit, 600, 962);
H.cursorOut(tl, cur, tSubmit + 0.4);

// ---------- S6 the streak grows ----------
const s6 = H.scene("s6");
const t6 = L(5).s - 0.08;
H.seam(tl, s4, s6, t6);
const sk = H.box(s6, 80, 380, 920, "ui");
sk.innerHTML = `<span class="demo-tag">Beispiel</span><div class="ttl">Deine Serie</div><div class="meta sk-meta" style="margin-top:6px">Jeder rechtzeitige Abschluss zählt</div>
  <div class="row" style="margin:34px 0 36px;gap:26px"><div class="flame-badge" style="font-size:64px;padding:22px 40px 22px 30px">${H.icon("flame", "#e8590c", 2.4).replace('<svg', '<svg style="width:70px;height:70px"')}<span class="sk-n">9</span></div>
  <div style="font-weight:800;font-size:44px;letter-spacing:-.03em;line-height:1.1">Tage<br><span style="color:#5a6e8c;font-size:32px;font-weight:700">am Stück</span></div></div>
  <div class="week">${["Mo", "Di", "Mi", "Do", "Fr"].map((d, i) => `<div class="d${i < 4 ? " on" : ""}"><i>${H.icon("check", "#fff", 3)}</i><span>${d}</span></div>`).join("")}</div>
  <div class="pill blue sk-pill" style="position:absolute;right:40px;top:170px;font-size:30px">Etappe erreicht</div>`;
H.rise(tl, sk, t6, { sfx: false, y: 260 });
H.glare(tl, sk, t6 + 0.3);
const skN = sk.querySelector(".sk-n");
const day4 = sk.querySelectorAll(".week .d")[4];
const tGrow = H.at(5, "wächst");
tl.set(day4, { attr: { class: "d on" } }, tGrow);
tl.fromTo(day4.firstChild, { scale: 0.6 }, { scale: 1, duration: 0.45, ease: "back.out(2.2)", immediateRender: false }, tGrow);
tl.set(skN, { textContent: "10" }, tGrow + 0.12);
tl.fromTo(skN, { y: -40, scale: 1.4 }, { y: 0, scale: 1, duration: 0.5, ease: "back.out(2)", immediateRender: false }, tGrow + 0.12);
H.sfx("ping", tGrow + 0.12, 0.4);
H.pop(tl, sk.querySelector(".sk-pill"), tGrow + 0.5, { from: 0.6 });
tl.set(sk.querySelector(".sk-meta"), { textContent: "10 Tage Serie. Zwei Wochen ohne Lücke." }, tGrow + 0.5);
H.tilt(tl, sk, t6, L(5).e - t6 + 0.3, { from: 4, to: -3 });

// ---------- S7 the ranking: everyone sees who keeps going (up = elevation) ----------
const s7 = H.scene("s7");
const t7 = L(6).s - 0.08;
H.seam(tl, s6, s7, t7, { dir: "up" });
const rows = [
  { name: "Lena W.", a: 164, s: 4, c: 1, p: 1 },
  { name: "Malik K.", a: 151, s: 2, c: "–", p: 0.88 },
  { name: "Sophie R.", a: 138, s: 3, c: "–", p: 0.8 },
  { name: "Alex (du)", a: 112, s: 3, c: 1, p: 0.72, me: true, no: 4 },
  { name: "Deniz A.", a: 96, s: 1, c: "–", p: 0.6 },
];
const rk = H.rankCard(s7, 70, 230, 940, rows);
H.rise(tl, rk.el, t7, { sfx: false, y: 300 });
H.glare(tl, rk.el, t7 + 0.4);
rk.bars.forEach((b, i) => tl.fromTo(b, { scaleX: 0 }, { scaleX: rows[i].p, duration: 0.8, ease: "power3.out", immediateRender: false }, t7 + 0.25 + i * 0.07));
rk.rows.forEach((r, i) => { gsap.set(r, { opacity: 0 }); tl.set(r, { opacity: 1 }, t7 + 0.15 + i * 0.06); tl.fromTo(r, { y: 40 }, { y: 0, duration: 0.35, ease: "power4.out", immediateRender: false }, t7 + 0.15 + i * 0.06); });
const meRow = rk.rows[3];
tl.fromTo(meRow, { scale: 1 }, { scale: 1.03, duration: 0.25, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, H.at(6, "dranbleibt") - 0.1);
H.sfx("ping", H.at(6, "dranbleibt"), 0.3);
H.cam(tl, t7, { scale: 1.04, y: -20 }, L(6).e - t7 + 0.3, "none");

// ---------- CTA ----------
H.cam(tl, L(7).s - 0.2, { scale: 1, y: 0 }, 0.01);
H.ctaBeat(tl, s7);
