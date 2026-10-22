// Reel 3: "Schicken Sie mir einfach mal Infos per Mail." -> "Was sagst du jetzt?" -> Roleplay im Discord -> CTA.
const L = H.L;

// ---------- S1 the objection, live on a call ----------
const s1 = H.scene("s1");
H.show(tl, s1, 0);
const call = H.box(s1, 90, 250, 900, "ui");
H.css(call, { padding: "30px 34px" });
call.innerHTML = `<div class="row" style="gap:24px"><div class="av c4" style="width:100px;height:100px">HL</div>
  <div style="flex:1"><div style="font-weight:800;font-size:40px;letter-spacing:-.03em">Hofmann Logistik</div><div class="meta" style="font-size:27px;margin-top:4px">Interessent · im Gespräch</div></div>
  <div style="text-align:right"><span class="pill live" style="font-size:24px;padding:8px 18px">● Live</span><div class="call-t" style="font-weight:800;font-size:34px;margin-top:10px;font-variant-numeric:tabular-nums">00:41</div></div></div>
  <div class="wave" style="display:flex;align-items:center;gap:9px;height:70px;margin-top:22px">${Array.from({ length: 34 }, () => '<i style="flex:1;height:100%;border-radius:6px;background:linear-gradient(180deg,#68d8ff,#0755f5);transform:scaleY(.12)"></i>').join("")}</div>`;
H.rise(tl, call, 0, { sfx: false, y: 120, rx: 18, dur: 0.6 });
gsap.set(call, { opacity: 1 });
const callT = call.querySelector(".call-t");
H.count(tl, callT, 41, 44, 0, 3, { ease: "none", fmt: (v) => "00:" + String(Math.floor(v)).padStart(2, "0") });
// the waveform answers the prospect's words only
const bars = [...call.querySelectorAll(".wave i")];
const rw = H.rng(7);
L(0).words.forEach((w) => {
  bars.forEach((b, k) => {
    const h = 0.25 + rw() * 0.75;
    tl.to(b, { scaleY: h, duration: 0.09, ease: "power2.out" }, w.s + (k % 5) * 0.012);
    tl.to(b, { scaleY: 0.12 + rw() * 0.1, duration: 0.16, ease: "power2.in" }, Math.max(w.s + 0.1, w.e - 0.08));
  });
});
const bub = H.el("div", "bubble in", `<span class="who">Interessent</span><span class="q"></span>`, s1);
H.css(bub, { left: "90px", top: "640px", width: "900px", maxWidth: "900px", fontSize: "76px", lineHeight: "1.06", letterSpacing: "-.045em", padding: "40px 46px 46px" });
const q = bub.querySelector(".q");
const qWords = "„Schicken Sie mir einfach mal Infos per Mail.“".split(" ").map((w) => `<span class="w" style="display:inline-block;margin-right:.22em">${w}</span>`).join("");
q.innerHTML = qWords;
const qs = [...q.querySelectorAll(".w")];
H.pop(tl, bub, 0.02, { from: 0.85, y: 40, ease: "back.out(1.4)", dur: 0.4 });
H.speak(tl, qs, 0, [0, 1, 2, 3, 4, 5, 6, 7], { lead: 0.06, y: 40 });
tl.fromTo(qs.slice(5), { color: "#0a2043" }, { color: "#0755f5", duration: 0.2, immediateRender: false }, H.at(0, "Infos"));
H.sfx("notification", 0.0, 0.25);

// ---------- S2 "Was sagst du jetzt?" + countdown (zoom-through: deeper into the same moment) ----------
const s2 = H.scene("s2");
const t2 = L(1).s - 0.08;
H.zoomThrough(tl, s1, s2, t2);
const h2 = H.headline(s2, ["Was sagst", "*du* jetzt?"], { y: 500, size: 176 });
H.speak(tl, h2.words, 1, [0, 1, 2, 3], { lead: 0.07, y: 70 });
const ringBox = H.box(s2, 390, 1000, 300);
const rg = H.ringSVG(300, 18, ["#68d8ff", "#0755f5"], "rgba(104,216,255,.14)");
ringBox.innerHTML = `<div class="ring" style="width:300px;height:300px">${rg.html}<div class="inner"><span class="cd" style="font-weight:800;font-size:150px;letter-spacing:-.05em;color:#fff;font-variant-numeric:tabular-nums">3</span></div></div>`;
const arc = ringBox.querySelector(".arc"), cd = ringBox.querySelector(".cd");
const tc0 = L(1).e - 0.15, tc1 = L(2).s - 0.05;
gsap.set(ringBox, { opacity: 0 });
H.pop(tl, ringBox, tc0 - 0.25, { from: 0.6, y: 40 });
tl.fromTo(arc, { strokeDashoffset: 0 }, { strokeDashoffset: rg.C, duration: tc1 - tc0, ease: "none", immediateRender: false }, tc0);
["3", "2", "1"].forEach((n, i) => {
  const t = tc0 + (i * (tc1 - tc0)) / 3;
  tl.set(cd, { textContent: n }, t);
  tl.fromTo(cd, { scale: 1.35, opacity: 0.4 }, { scale: 1, opacity: 1, duration: 0.3, ease: "expo.out", immediateRender: false }, t);
  H.sfx("click", t, 0.55);
});

// ---------- S3 thinking -> "Genau das üben wir." (arrival) ----------
const s3 = H.scene("s3");
const t3 = L(2).s - 0.08;
H.seam(tl, s2, s3, t3);
const think = H.el("div", "bubble out", `<span class="who" style="opacity:.75">Du</span><span class="dots" style="display:inline-flex;gap:14px;padding:6px 0">${"<i style='width:22px;height:22px;border-radius:50%;background:#fff;display:block'></i>".repeat(3)}</span>`, s3);
H.css(think, { right: "90px", top: "760px" });
H.pop(tl, think, t3 + 0.05, { from: 0.7, y: 30 });
const dots = [...think.querySelectorAll(".dots i")];
const tG = H.at(2, "Genau");
for (let k = 0; k < Math.floor((tG - t3) / 0.45); k++) dots.forEach((d, i) => tl.fromTo(d, { y: 0, opacity: 0.5 }, { y: -12, opacity: 1, duration: 0.15, yoyo: true, repeat: 1, ease: "power1.inOut", immediateRender: false }, t3 + 0.2 + k * 0.45 + i * 0.1));
const q3 = H.headline(s3, ["Wenn du kurz", "*überlegen* musstest:"], { y: 470, size: 120 });
H.speak(tl, q3.words, 2, [0, 1, 2, 3, 4], { lead: 0.06, y: 50 });
const s3b = H.scene("s3b");
H.arrive(tl, s3, s3b, tG - 0.06, { from: 1.3, sfx: "impact-bass-2", gain: 0.5 });
const wm = H.box(s3b, 0, 380, 1080); wm.style.textAlign = "center"; wm.innerHTML = H.wordmark(104);
const h3 = H.headline(s3b, ["Genau das", "*üben* wir."], { y: 560, size: 160 });
H.speak(tl, h3.words, 2, [5, 6, 7, 8], { lead: 0.06, y: 60 });
const rp = H.el("div", "kicker", `<span class="dot"></span>Roleplay im Discord`, s3b);
H.css(rp, { position: "absolute", left: "50%", top: "930px", fontSize: "38px" });
gsap.set(rp, { xPercent: -50, opacity: 0 });
H.pop(tl, rp, H.at(2, "üben"), { from: 0.6, sfx: "pop", gain: 0.45 });

// ---------- S4 the roleplay room ----------
const s4 = H.scene("s4");
const t4 = L(3).s - 0.1;
H.seam(tl, s3b, s4, t4);
const room = H.box(s4, 70, 150, 940, "ui");
room.innerHTML = `<span class="demo-tag">Beispiel</span>
  <div class="room-head"><div class="ttl">Roleplay</div><span class="pill blue" style="font-size:26px">Einwand: Infos per Mail</span></div>
  <div class="row" style="margin-top:12px"><span class="meta">${H.icon("mic", "#5a6e8c").replace("<svg", '<svg width="26" height="26" style="vertical-align:-4px;margin-right:8px"')}Sprachkanal im Discord · 5 dabei</span></div>
  <div class="row" style="gap:22px;margin-top:28px">
    <div class="tile t-k" style="flex:1;height:300px"><div class="speak"></div><div class="av c3" style="width:120px;height:120px;font-size:42px">MK</div><div class="nm" style="font-size:32px">Malik K.</div><span class="pill gold" style="font-size:22px;padding:6px 16px">spielt den Kunden</span></div>
    <div class="tile t-d" style="flex:1;height:300px"><div class="speak"></div><div class="av c1" style="width:120px;height:120px;font-size:42px">Du</div><div class="nm" style="font-size:32px">Du</div><span class="pill blue" style="font-size:22px;padding:6px 16px">antwortest</span></div>
  </div>
  <div class="row" style="gap:14px;margin-top:22px">${["LW", "SR", "DA"].map((n, i) => `<div class="av c${[5, 2, 4][i]}" style="width:64px;height:64px;font-size:22px">${n}</div>`).join("")}<span class="meta" style="margin-left:6px">hören zu</span></div>`;
H.rise(tl, room, t4, { sfx: false, y: 280, rx: 22 });
H.glare(tl, room, t4 + 0.35);
const [spK, spD] = [room.querySelector(".t-k .speak"), room.querySelector(".t-d .speak")];
const tK = H.at(3, "spielt"), tD = H.at(3, "antwortest") - 0.15, tF = H.at(3, "anderen");
tl.to(spK, { opacity: 1, duration: 0.15 }, tK); tl.to(spK, { opacity: 0, duration: 0.2 }, tD - 0.1);
tl.to(spD, { opacity: 1, duration: 0.15 }, tD); tl.to(spD, { opacity: 0, duration: 0.2 }, tF + 0.2);
const ans = H.el("div", "bubble out", `<span class="who" style="opacity:.75">Du</span><span class="at"></span>`, s4);
H.css(ans, { left: "90px", top: "800px", width: "860px", fontSize: "38px" });
gsap.set(ans, { opacity: 0 });
H.pop(tl, ans, tD, { from: 0.85, y: 30 });
H.type(tl, ans.querySelector(".at"), "Mach ich gern. Damit es passt: Was müsste drinstehen, damit es für Sie relevant ist?", tD + 0.1, 46, { sfx: false });
H.sfx("typing", tD + 0.1, 0.25);
const fb = [["LW", "c5", "Starke Rückfrage"], ["DA", "c4", "Termin direkt vorschlagen"]];
fb.forEach((f, i) => {
  const ch = H.el("div", "toast", `<div class="av ${f[1]}" style="width:60px;height:60px;font-size:22px">${f[0]}</div><div>${f[2]}<small style="color:#9fb5d6">Feedback</small></div>`, s4);
  H.css(ch, { right: "70px", top: 1010 + i * 108 + "px", fontSize: "32px", padding: "16px 30px 16px 18px", background: "rgba(6,21,47,.94)", color: "#fff", boxShadow: "0 24px 60px -16px rgba(0,6,24,.9), 0 0 0 1.5px rgba(104,216,255,.3) inset" });
  gsap.set(ch, { opacity: 0 });
  const t = tF + 0.05 + i * 0.3;
  tl.set(ch, { opacity: 1 }, t);
  tl.fromTo(ch, { x: 200, scale: 0.9 }, { x: 0, scale: 1, duration: 0.5, ease: "back.out(1.5)", immediateRender: false }, t);
  H.sfx("pop", t, 0.45);
});
H.cam(tl, t4, { scale: 1.03, y: -18 }, L(3).e - t4 + 0.2, "none");

// ---------- S5 the objection sits, before the real call ----------
const s5 = H.scene("s5");
const t5 = L(4).s - 0.08;
H.cam(tl, t5 - 0.01, { scale: 1, y: 0 }, 0.01);
H.seam(tl, s4, s5, t5);
const ck = H.box(s5, 90, 300, 900, "ui");
const items = ["„Schicken Sie mir Infos“", "„Kein Interesse“", "„Keine Zeit“", "„Haben schon jemanden“"];
ck.innerHTML = `<span class="demo-tag">Beispiel</span><div class="ttl">Einwände geübt</div><div class="meta" style="margin-top:6px">Diese Woche im Roleplay</div>
  ${items.map((it) => `<div class="row ck" style="gap:22px;margin-top:24px"><div class="ckb" style="width:64px;height:64px;border-radius:20px;border:3px solid #d6e1f0;display:grid;place-items:center">${H.icon("check", "#fff", 3.4).replace("<svg", '<svg width="38" height="38"')}</div><div style="font-weight:800;font-size:38px;letter-spacing:-.03em">${it}</div></div>`).join("")}`;
H.rise(tl, ck, t5, { sfx: false, y: 260 });
const boxes = [...ck.querySelectorAll(".ckb")];
const tS = H.at(4, "sitzt");
boxes.forEach((b, i) => {
  const t = tS + i * 0.22;
  tl.set(b, { background: "linear-gradient(150deg,#3ddc97,#17a463)", borderColor: "#17a463" }, t);
  tl.fromTo(b, { scale: 0.7 }, { scale: 1, duration: 0.35, ease: "back.out(2.4)", immediateRender: false }, t);
  H.sfx("click-soft", t, 0.4);
});
const live = H.el("div", "toast", `<div class="ic">${H.icon("cal", "#17a463", 2.4)}</div><div>Setting vereinbart<small>Echter Call · Hofmann Logistik</small></div>`, s5);
H.css(live, { left: "50%", top: "960px" });
gsap.set(live, { xPercent: -50, opacity: 0 });
const tCall = H.at(4, "echten");
tl.set(live, { opacity: 1 }, tCall);
tl.fromTo(live, { y: 80, scale: 0.85 }, { y: 0, scale: 1, duration: 0.55, ease: "back.out(1.6)", immediateRender: false }, tCall);
H.sfx("chime", tCall + 0.05, 0.4);
H.tilt(tl, ck, t5, L(4).e - t5 + 0.3, { from: -3, to: 3 });

// ---------- CTA ----------
H.ctaBeat(tl, s5);
