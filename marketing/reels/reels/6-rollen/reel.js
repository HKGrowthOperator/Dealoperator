// Reel 6: "Opener. Setter. Closer. Selbstständig." -> wherever you stand -> people like you -> Call-Partner, Roleplay, Rangliste -> kostenfrei -> CTA.
const L = H.L;

// ---------- S1 four roles slam in, one per spoken word ----------
const s1 = H.scene("s1");
H.show(tl, s1, 0);
const roles = ["Opener.", "Setter.", "Closer.", "*Selbstständig.*"];
const h1 = H.headline(s1, roles, { y: 520, size: 150 });
const lines1 = [...h1.el.querySelectorAll(".line")];
h1.words.forEach((w, i) => {
  const t = L(0).words[i].s - 0.06;
  gsap.set(w, { opacity: 0 });
  tl.set(w, { opacity: 1 }, Math.max(0.001, t));
  tl.fromTo(w, { scale: 1.6, filter: "blur(8px)" }, { scale: 1, filter: "blur(0px)", duration: 0.32, ease: "expo.out", immediateRender: false }, Math.max(0.001, t));
  H.sfx(i === 3 ? "impact-bass-1" : "whoosh-short", t, i === 3 ? 0.5 : 0.4);
  // earlier words step back as the next one lands
  if (i > 0) tl.to(h1.words.slice(0, i), { opacity: 0.38, duration: 0.2 }, t);
});

// ---------- S2 the roles become chips, the line arrives ----------
const t2 = L(1).s - 0.1;
tl.to(h1.el, { y: -260, scale: 0.5, duration: 0.45, ease: "power3.inOut" }, L(0).e - 0.15);
tl.to(h1.words, { opacity: 0.85, duration: 0.3 }, L(0).e - 0.15);
const h2 = H.headline(s1, ["Egal, wo du", "gerade *stehst.*"], { y: 1000, size: 132 });
H.speak(tl, h2.words, 1, [0, 1, 2, 3, 4], { lead: 0.07, y: 60 });

// ---------- S3 people like you, calling together ----------
const s3 = H.scene("s3");
const t3 = H.at(2, "Deal") - 0.05;
H.arrive(tl, s1, s3, t3, { from: 1.25, sfx: "impact-bass-2", gain: 0.5 });
const wm = H.box(s3, 0, 230, 1080); wm.style.textAlign = "center"; wm.innerHTML = H.wordmark(96);
const people = [["LW", "Lena W.", "Setter", "c1"], ["MK", "Malik K.", "Closer", "c3"], ["SR", "Sophie R.", "Opener", "c5"], ["DA", "Deniz A.", "Selbstständig", "c4"],
  ["CM", "Clara M.", "Closer", "c2"], ["EF", "Emre F.", "Opener", "c1"], ["NH", "Nina H.", "Setter", "c3"], ["OP", "Ole P.", "Selbstständig", "c5"]];
const grid = H.box(s3, 70, 420, 940);
H.css(grid, { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px" });
grid.innerHTML = people.map((p) => `<div class="row" style="gap:18px;padding:20px 22px;border-radius:28px;background:#fff;box-shadow:0 24px 60px -24px rgba(0,6,24,.8)"><div class="av ${p[3]}" style="width:78px;height:78px;font-size:28px">${p[0]}</div><div><div style="font-weight:800;font-size:31px;color:#0a2043;letter-spacing:-.02em">${p[1]}</div><span class="pill blue" style="font-size:22px;padding:5px 14px;margin-top:6px">${p[2]}</span></div></div>`).join("");
const cards3 = [...grid.children];
const tLeute = H.at(2, "Leute") - 0.1;
cards3.forEach((c, i) => {
  gsap.set(c, { opacity: 0 });
  const t = tLeute + i * 0.06;
  tl.set(c, { opacity: 1 }, t);
  tl.fromTo(c, { x: 160, y: 30, scale: 0.9 }, { x: 0, y: 0, scale: 1, duration: 0.45, ease: "power4.out", immediateRender: false }, t);
});
H.sfx("pop", tLeute, 0.35); H.sfx("pop", tLeute + 0.24, 0.3);
H.cam(tl, t3, { scale: 1.04, y: -20 }, L(2).e - t3 + 0.2, "none");

// ---------- S4 Call-Partner for your target group ----------
const s4 = H.scene("s4");
const t4 = L(3).s - 0.08;
H.cam(tl, t4 - 0.01, { scale: 1, y: 0 }, 0.01);
H.seam(tl, s3, s4, t4);
const deck = [["SR", "Sophie R.", "Opener", "c5", "IT-Dienstleister", "vormittags"], ["MK", "Malik K.", "Closer", "c3", "Handwerk", "nachmittags"], ["LW", "Lena W.", "Setter", "c1", "B2B-Software", "vormittags"]];
const pcs = deck.map((d, i) => {
  const c = H.box(s4, 110, 330, 860, "ui");
  c.innerHTML = `<span class="demo-tag">Beispiel</span><div class="row" style="gap:26px"><div class="av ${d[3]}" style="width:120px;height:120px;font-size:42px">${d[0]}</div>
    <div><div style="font-weight:800;font-size:48px;letter-spacing:-.035em">${d[1]}</div><span class="pill blue" style="font-size:26px;margin-top:8px">${d[2]}</span></div></div>
    <div class="zg" style="margin-top:34px;padding:22px 26px;border-radius:24px;background:#f3f7fd"><div class="meta" style="font-size:24px">Zielgruppe</div><div style="font-weight:800;font-size:38px;margin-top:4px">${d[4]}</div></div>
    <div class="row" style="gap:16px;margin-top:18px"><span class="pill" style="background:#f3f7fd;color:#33496b;font-size:26px">${H.icon("clock", "#33496b").replace("<svg", '<svg width="26" height="26"')}Call-Zeit: ${d[5]}</span><span class="pill green" style="font-size:26px">Sucht Call-Partner</span></div>
    <div class="btn wbtn" style="margin-top:30px;height:96px;font-size:34px">Auf Discord schreiben</div>`;
  gsap.set(c, { rotate: (i - 2) * 3.5, y: (2 - i) * 18, scale: 1 - (2 - i) * 0.04 });
  return c;
});
// the deck arrives, then the front card shows its Zielgruppe and the cursor writes on Discord
pcs.forEach((c, i) => { gsap.set(c, { opacity: 0 }); tl.set(c, { opacity: 1 }, t4 + i * 0.08); tl.fromTo(c, { x: 260, rotationY: -20, transformPerspective: 1400 }, { x: 0, rotationY: 0, duration: 0.55, ease: "expo.out", immediateRender: false }, t4 + i * 0.08); });
const front = pcs[2];
const tZg = H.at(3, "Zielgruppe");
tl.to(front.querySelector(".zg"), { background: "#e9f1ff", boxShadow: "0 0 0 3px #0755f5 inset", duration: 0.2 }, tZg - 0.05);
H.sfx("click-soft", tZg, 0.4);
H.glare(tl, front, t4 + 0.4);
const cur = H.cursor(s4);
const by = 330 + 560;
H.cursorIn(tl, cur, 560, by, tZg + 0.2, { fromX: 980, fromY: 1400 });
H.click(tl, cur, L(3).e + 0.05, 560, by);
tl.to(front.querySelector(".wbtn"), { scale: 0.96, duration: 0.08, yoyo: true, repeat: 1 }, L(3).e);

// ---------- S5 Roleplay ----------
const s5 = H.scene("s5");
const t5 = L(4).s - 0.08;
H.seam(tl, s4, s5, t5);
const rp = H.box(s5, 90, 360, 900, "ui");
rp.innerHTML = `<span class="demo-tag">Beispiel</span><div class="row" style="gap:16px"><div class="ttl">Roleplay</div><span class="pill blue" style="font-size:26px">„Kein Interesse“</span></div>
  <div class="row" style="gap:20px;margin-top:28px">
   <div class="tile t1" style="flex:1;height:250px"><div class="speak"></div><div class="av c3" style="width:100px;height:100px">MK</div><div class="nm">spielt den Kunden</div></div>
   <div class="tile t2" style="flex:1;height:250px"><div class="speak"></div><div class="av c1" style="width:100px;height:100px">Du</div><div class="nm">übst</div></div></div>`;
H.rise(tl, rp, t5, { sfx: false, y: 240 });
const [sp1, sp2] = [rp.querySelector(".t1 .speak"), rp.querySelector(".t2 .speak")];
tl.to(sp1, { opacity: 1, duration: 0.1 }, t5 + 0.35); tl.to(sp1, { opacity: 0, duration: 0.2 }, H.at(4, "Einwände"));
tl.to(sp2, { opacity: 1, duration: 0.1 }, H.at(4, "Einwände") + 0.05);
const fbk = H.el("div", "toast", `<div class="av c5" style="width:60px;height:60px;font-size:22px">LW</div><div>Starke Antwort<small>Feedback</small></div>`, s5);
H.css(fbk, { right: "90px", top: "800px", fontSize: "32px" });
gsap.set(fbk, { opacity: 0 });
H.pop(tl, fbk, H.at(4, "Roleplay"), { from: 0.7, y: 30, sfx: "pop", gain: 0.45 });

// ---------- S6 Rangliste: Zahlen -> Serie (who keeps going) ----------
const s6 = H.scene("s6");
const t6 = L(5).s - 0.08;
H.seam(tl, s5, s6, t6, { dir: "up" });
const rk = H.box(s6, 70, 250, 940, "ui");
const rowsZ = [["Lena W.", "164 Anwahlen", 1], ["Malik K.", "151 Anwahlen", 0.92], ["Sophie R.", "138 Anwahlen", 0.84], ["Deniz A.", "121 Anwahlen", 0.74], ["Alex (du)", "104 Anwahlen", 0.63]];
const rowsS = [["Sophie R.", "21 Tage Serie", 1], ["Lena W.", "14 Tage Serie", 0.67], ["Clara M.", "11 Tage Serie", 0.52], ["Alex (du)", "9 Tage Serie", 0.43], ["Malik K.", "9 Tage Serie", 0.43]];
const mkRows = (rows, flame) => rows.map((r, i) => `<div class="rank-row${r[0].includes("du") ? " me-row" : ""}"><div class="rank-no ${i === 0 ? "g" : i === 1 ? "s" : i === 2 ? "b" : ""}">${flame && i === 4 ? 4 : i + 1}</div><div class="rank-main"><div class="row"><div class="rank-name">${r[0]}</div><span class="sp"></span><span style="font-weight:800;font-size:30px;color:${flame ? "#e8590c" : "#0a2043"}">${flame ? H.icon("flame", "#e8590c", 2.4).replace("<svg", '<svg width="28" height="28" style="vertical-align:-4px;margin-right:6px"') : ""}${r[1]}</span></div><div class="bar${i === 0 ? " g" : ""}"><i style="transform:scaleX(${r[2]})"></i></div></div></div>`).join("");
rk.innerHTML = `<span class="demo-tag">Beispieldaten</span><div class="ttl">Rangliste</div>
  <div class="row" style="gap:16px;margin:24px 0 10px"><div class="btn tabZ" style="flex:1;height:84px;font-size:32px">Zahlen</div><div class="btn ghost tabS" style="flex:1;height:84px;font-size:32px">Serie</div></div>
  <div style="position:relative"><div class="lz">${mkRows(rowsZ, false)}</div><div class="ls" style="position:absolute;inset:0;opacity:0">${mkRows(rowsS, true)}</div></div>`;
H.rise(tl, rk, t6, { sfx: false, y: 260 });
H.glare(tl, rk, t6 + 0.35);
const tSw = H.at(5, "wer") - 0.1;
const lz = rk.querySelector(".lz"), ls = rk.querySelector(".ls");
tl.set(rk.querySelector(".tabZ"), { attr: { class: "btn ghost tabZ" } }, tSw);
tl.set(rk.querySelector(".tabS"), { attr: { class: "btn tabS" } }, tSw);
tl.to(lz, { filter: "blur(10px)", opacity: 0, duration: 0.18, ease: "power2.in" }, tSw - 0.1);
tl.fromTo(ls, { filter: "blur(10px)", opacity: 0 }, { filter: "blur(0px)", opacity: 1, duration: 0.3, ease: "power2.out", immediateRender: false }, tSw + 0.06);
H.sfx("click", tSw, 0.5);
H.cam(tl, t6, { scale: 1.04, y: -20 }, L(5).e - t6 + 0.2, "none");

// ---------- S7 "Alles kostenfrei." (zoom-through) ----------
const s7 = H.scene("s7");
const t7 = L(6).s - 0.06;
H.cam(tl, t7 - 0.01, { scale: 1, y: 0 }, 0.01);
H.zoomThrough(tl, s6, s7, t7);
const free = H.headline(s7, ["Alles", "*kostenfrei.*"], { y: 560, size: 160 });
H.speak(tl, free.words, 6, [0, 1], { lead: 0.06, y: 60 });
const perks = H.el("div", null, ["Call-Partner", "Roleplay", "Sessions", "Rangliste"].map((p) => `<span class="pill glass" style="font-size:32px">${H.icon("check", "#68d8ff", 3).replace("<svg", '<svg width="30" height="30"')}${p}</span>`).join(""), s7);
H.css(perks, { position: "absolute", left: "60px", width: "960px", top: "940px", display: "flex", flexWrap: "wrap", gap: "18px", justifyContent: "center" });
H.waterfall(tl, [...perks.children], t7 + 0.25, { y: 50, gap: 0.07 });

// ---------- CTA ----------
H.ctaBeat(tl, s7);
