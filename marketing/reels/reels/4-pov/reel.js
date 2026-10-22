// Reel 4: POV 8:59 -> the session goes live -> everyone dials -> first Setting -> evening: numbers in, Serie +1 -> CTA.
const L = H.L;

// ---------- S1 POV clock ----------
const s1 = H.scene("s1");
H.show(tl, s1, 0);
const pov = H.el("div", "kicker", `<span class="dot" style="background:#68d8ff;box-shadow:0 0 0 6px rgba(104,216,255,.2)"></span>POV`, s1);
H.css(pov, { position: "absolute", left: "50%", top: "330px", fontSize: "40px", padding: "16px 34px" });
gsap.set(pov, { xPercent: -50 });
const esist = H.headline(s1, ["Es ist"], { y: 470, size: 96 });
H.speak(tl, esist.words, 0, [0, 1], { lead: 0.08, y: 40 });
const clock = H.el("div", null, `<span class="c-h">8</span><span class="c-c">:</span><span class="c-m1">5</span><span class="c-m2">9</span>`, s1);
H.css(clock, { position: "absolute", left: "0", width: "1080px", top: "590px", textAlign: "center", fontWeight: "800", fontSize: "330px", lineHeight: "1", letterSpacing: "-.06em", fontVariantNumeric: "tabular-nums", color: "#fff" });
const cParts = [...clock.children];
cParts.forEach((c) => H.css(c, { display: "inline-block" }));
const tAcht = H.at(0, "acht"), tNeun = H.at(0, "neun");
H.waterfall(tl, cParts.slice(0, 2), tAcht - 0.05, { y: 90, dur: 0.24 });
H.waterfall(tl, cParts.slice(2), tNeun - 0.05, { y: 90, dur: 0.24, gap: 0.12 });
tl.to(cParts[1], { opacity: 0.25, duration: 0.01, ease: "steps(1)", repeat: 7, yoyo: true, repeatDelay: 0.49 }, tNeun + 0.6);
H.sfx("click", tAcht - 0.02, 0.35); H.sfx("click", tNeun, 0.35);

// ---------- S1b "Gleich startet die Call-Session." (clock nudges up, line + session card arrive) ----------
const t1 = L(1).s - 0.1;
tl.to([esist.el], { opacity: 0, y: -60, duration: 0.3, ease: "power3.in" }, t1 - 0.2);
tl.to(clock, { y: -230, scale: 0.62, duration: 0.6, ease: "power3.inOut" }, t1 - 0.15);
tl.to(pov, { y: -120, opacity: 0, duration: 0.4, ease: "power3.in" }, t1 - 0.15);
const h2 = H.headline(s1, ["Gleich startet die", "*Call-Session.*"], { y: 800, size: 116 });
H.speak(tl, h2.words, 1, [0, 1, 2, 3], { lead: 0.07, y: 60 });
const sess = H.box(s1, 140, 1090, 800, "ui");
H.css(sess, { padding: "28px 32px" });
sess.innerHTML = `<div class="row" style="gap:22px"><div style="width:84px;height:84px;border-radius:24px;display:grid;place-items:center;background:#e9f1ff"><div style="width:46px;height:46px">${H.icon("users", "#0755f5", 2)}</div></div>
  <div style="flex:1"><div style="font-weight:800;font-size:36px;letter-spacing:-.03em">Call-Session · 9:00</div><div class="meta" style="font-size:26px;margin-top:4px">Host Lena W. · 11 von 12 Plätzen</div></div><span class="pill green s-pill" style="font-size:26px">Gleich</span></div>`;
gsap.set(sess, { opacity: 0 });
H.pop(tl, sess, H.at(1, "Call") - 0.05, { from: 0.85, y: 60, ease: "back.out(1.3)", sfx: "pop", gain: 0.35 });
// 8:59 -> 9:00, the session goes live
const tFlip = L(2).s - 0.32;
tl.to([cParts[0], cParts[2], cParts[3]], { y: -60, opacity: 0, duration: 0.14, ease: "power3.in" }, tFlip - 0.14);
tl.set(cParts[0], { textContent: "9" }, tFlip); tl.set(cParts[2], { textContent: "0" }, tFlip); tl.set(cParts[3], { textContent: "0" }, tFlip);
tl.fromTo([cParts[0], cParts[2], cParts[3]], { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.24, ease: "power4.out", immediateRender: false, stagger: 0.04 }, tFlip);
const sp = sess.querySelector(".s-pill");
tl.set(sp, { textContent: "● Live", attr: { class: "pill live s-pill" } }, tFlip);
tl.fromTo(sp, { scale: 1.4 }, { scale: 1, duration: 0.4, ease: "back.out(2)", immediateRender: false }, tFlip);
H.sfx("ping", tFlip, 0.5);

// ---------- S2 the room: everyone dials at once ----------
const s2 = H.scene("s2");
const t2 = L(2).s - 0.05;
H.zoomThrough(tl, s1, s2, t2, { gain: 0.45 });
const room = H.box(s2, 70, 210, 940, "ui");
const ppl = [["LW", "Lena W.", "c1", 31], ["MK", "Malik K.", "c3", 27], ["SR", "Sophie R.", "c5", 24], ["Du", "Du", "c6", 22], ["DA", "Deniz A.", "c4", 29], ["CM", "Clara M.", "c2", 19]];
room.innerHTML = `<span class="demo-tag">Beispiel</span>
  <div class="room-head"><span class="pill live">● Live</span><div class="ttl">Call-Session</div><span class="sp"></span><span class="pill blue">${H.icon("mic", "#0755f5").replace("<svg", '<svg width="28" height="28"')}im Discord</span></div>
  <div class="row" style="margin-top:22px;padding:22px 26px;border-radius:24px;background:#f3f7fd;gap:14px"><div style="width:44px;height:44px">${H.icon("phone", "#0755f5")}</div><span style="font-weight:800;font-size:34px">Raum gesamt</span><span class="sp"></span><span class="tot" style="font-weight:800;font-size:46px;letter-spacing:-.03em;font-variant-numeric:tabular-nums;color:#0755f5">0</span><span class="meta">Anwahlen</span></div>
  <div class="tiles" style="margin-top:24px">${ppl.map((p) => `<div class="tile"><div class="speak"></div><span class="cnt">0</span><div class="av ${p[2]}" style="width:96px;height:96px">${p[0]}</div><div class="nm">${p[1]}</div><div class="rl">wählt …</div></div>`).join("")}</div>`;
H.rise(tl, room, t2, { sfx: false, y: 200, rx: 18, from: 0.95 });
H.glare(tl, room, t2 + 0.35);
const tiles = [...room.querySelectorAll(".tile")];
const cnts = [...room.querySelectorAll(".cnt")];
const tot = room.querySelector(".tot");
tiles.forEach((tile, k) => H.pop(tl, tile, t2 + 0.15 + k * 0.08, { from: 0.7, y: 20, dur: 0.36, ease: "back.out(1.4)" }));
const tDial = H.at(2, "alle");
const tSet = H.at(3, "Setting");
const tMit = H.at(3, "zieht");
const tEnd = L(3).e + 0.2;
// counters: slow start on "Liste auf", together on "wählen gleichzeitig", faster after the first Setting
ppl.forEach((p, k) => {
  const mid = Math.round(p[3] * 0.45);
  H.countPath(tl, cnts[k], [[tDial - 0.2 + k * 0.03, 0], [tSet + 0.1, mid], [tMit, mid + 1], [tEnd, p[3]]], { ease: "none" });
});
const sum = ppl.reduce((a, p) => a + p[3], 0);
H.countPath(tl, tot, [[tDial - 0.2, 0], [tSet + 0.1, Math.round(sum * 0.45)], [tMit, Math.round(sum * 0.45) + 4], [tEnd, sum]], { ease: "none" });
for (let i = 0; i < 9; i++) H.sfx("key-press", tDial + i * 0.11, 0.1);
// the first Setting: Lena's tile lights up, a toast lands, then the wave runs through the room
const speaks = [...room.querySelectorAll(".speak")];
tl.to(speaks[0], { opacity: 1, duration: 0.12 }, tSet);
const toast = H.el("div", "toast", `<div class="ic">${H.icon("cal", "#17a463", 2.4)}</div><div>Lena W.: Setting gelegt<small>Erstes Setting im Raum</small></div>`, s2);
H.css(toast, { left: "50%", top: "1110px" });
gsap.set(toast, { xPercent: -50, opacity: 0 });
tl.set(toast, { opacity: 1 }, tSet - 0.05);
tl.fromTo(toast, { y: 90, scale: 0.85 }, { y: 0, scale: 1, duration: 0.5, ease: "back.out(1.6)", immediateRender: false }, tSet - 0.05);
H.sfx("chime", tSet, 0.45);
[1, 2, 3, 4, 5].forEach((i, k) => {
  tl.to(speaks[i], { opacity: 1, duration: 0.1 }, tMit + k * 0.12);
  tl.to(speaks[i], { opacity: 0, duration: 0.25 }, tMit + k * 0.12 + 0.45);
});
tl.to(speaks[0], { opacity: 0, duration: 0.25 }, tMit + 0.6);
tl.to(toast, { y: 160, opacity: 0, duration: 0.35, ease: "power3.in" }, tMit + 0.5);
H.cam(tl, t2, { scale: 1.05, y: -30 }, L(3).e - t2 + 0.2, "none");

// ---------- S3 evening: numbers in, Serie +1 ----------
const s3 = H.scene("s3");
const t3 = L(4).s - 0.1;
H.cam(tl, t3 - 0.01, { scale: 1, y: 0 }, 0.01);
H.seam(tl, s2, s3, t3);
const eve = H.el("div", "kicker", `<span class="dot"></span>Abends, 18:30`, s3);
H.css(eve, { position: "absolute", left: "80px", top: "130px" });
H.pop(tl, eve, t3 + 0.1, { from: 0.8 });
const F = H.formCard(s3, 80, 230, 920);
H.rise(tl, F.el, t3, { sfx: false, y: 300 });
const tZ = H.at(4, "Zahlen");
const tSerie = H.at(4, "Serie");
H.fillForm(tl, F, { a: 152, s: 2, c: 0 }, { a: tZ - 0.1, s: tZ + 0.3, c: tZ + 0.5, energy: tZ + 0.65, submit: tSerie - 0.3 });
const cur = H.cursor(s3);
H.cursorIn(tl, cur, 600, 962, tSerie - 1.0, { fromX: 980, fromY: 1400 });
H.click(tl, cur, tSerie - 0.3, 600, 962);
H.cursorOut(tl, cur, tSerie + 0.05);
const fl = H.el("div", "flame-badge", `${H.icon("flame", "#e8590c", 2.4)}<span class="fn">7</span>&nbsp;Tage Serie`, s3);
H.css(fl, { position: "absolute", left: "50%", top: "1090px", fontSize: "46px", padding: "20px 40px 20px 28px", boxShadow: "0 30px 70px -20px rgba(0,6,24,.8)" });
gsap.set(fl, { xPercent: -50, opacity: 0 });
H.pop(tl, fl, tSerie - 0.05, { from: 0.6, y: 40 });
tl.set(fl.querySelector(".fn"), { textContent: "8" }, H.at(4, "verlängert"));
tl.fromTo(fl.querySelector(".fn"), { y: -36, scale: 1.4 }, { y: 0, scale: 1, duration: 0.45, ease: "back.out(2)", immediateRender: false }, H.at(4, "verlängert"));
H.sfx("ping", H.at(4, "verlängert"), 0.45);

// ---------- S4 the feeling: big line over the room (inverse zoom = arrival) ----------
const s4 = H.scene("s4");
const t4 = L(5).s - 0.06;
const ghost = room.cloneNode(true);
s4.appendChild(ghost);
ghost.querySelectorAll("*").forEach((n) => { n.style.opacity = ""; n.style.transform = ""; n.style.visibility = ""; });
ghost.querySelectorAll(".cnt").forEach((n, k) => (n.textContent = String(ppl[k][3])));
ghost.querySelector(".tot").textContent = String(ppl.reduce((a, p) => a + p[3], 0));
ghost.style.transform = "";
H.css(ghost, { filter: "blur(14px) brightness(.55)", opacity: "0.55" });
gsap.set(ghost, { scale: 1.1, y: 120 });
H.arrive(tl, s3, s4, t4, { from: 1.2, sfx: "impact-bass-1", gain: 0.45 });
const h4 = H.headline(s4, ["So fühlt sich", "*Callen* an,", "wenn du", "*nicht* *allein*", "bist."], { y: 470, size: 128 });
H.speak(tl, h4.words, 5, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], { lead: 0.06, y: 60 });
tl.fromTo(ghost, { scale: 1.1 }, { scale: 1.18, duration: L(5).e - t4 + 0.4, ease: "none", immediateRender: false }, t4);

// ---------- CTA ----------
H.ctaBeat(tl, s4);
