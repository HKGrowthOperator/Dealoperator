// Reel 1: "Callen alleine ist brutal." Lonely dialing -> the room fills -> Discord CTA.
const { orbs, floor } = H.bg;
const L = H.L;

// The night starts cold: the stage light is low until the community arrives.
gsap.set(orbs, { opacity: 0.28 });
gsap.set(floor, { opacity: 0.25 });

// ---------- S1 hook: words land as they are spoken ----------
const s1 = H.scene("s1");
H.show(tl, s1, 0);
const hook = H.headline(s1, ["Callen", "alleine ist", "*brutal.*"], { y: 600, size: 176 });
H.speak(tl, hook.words, 0, [0, 1, 2, 3], { lead: 0.1, y: 90 });
const tBrutal = H.at(0, "brutal");
tl.fromTo(hook.words[3], { scale: 1.35 }, { scale: 1, duration: 0.5, ease: "expo.out", immediateRender: false }, tBrutal - 0.1);
tl.to(H.bg.world, { x: 10, duration: 0.04, yoyo: true, repeat: 3, ease: "none" }, tBrutal - 0.02);
H.sfx("impact-bass-1", tBrutal - 0.06, 0.75);
const ended = H.el("div", "pill", `${H.icon("phone", "#ff8a8f", 2.4).replace("<svg", '<svg width="34" height="34"')}Anruf beendet · 0:04`, s1);
H.css(ended, { position: "absolute", left: "50%", top: "420px", background: "rgba(229,72,77,.14)", color: "#ffb3b6", border: "1.5px solid rgba(229,72,77,.4)", fontSize: "32px", padding: "14px 28px" });
gsap.set(ended, { xPercent: -50, opacity: 0 });
H.pop(tl, ended, tBrutal - 0.04, { from: 0.7, y: -20 });
tl.fromTo(hook.el, { scale: 1 }, { scale: 1.06, duration: L(1).s, ease: "none", immediateRender: false }, 0);

// ---------- S2 the lonely list ----------
const s2 = H.scene("s2");
const t2 = L(1).s - 0.1;
H.seam(tl, s1, s2, t2);
const list = H.box(s2, 80, 300, 920, "ui");
const leads = [
  ["Kanzlei Berger", "Anwahl 37", "Mailbox", "#8a9bb5"],
  ["Hofmann Logistik", "Anwahl 38", "Kein Interesse", "#e5484d"],
  ["Studio Kranz", "Anwahl 39", "Besetzt", "#8a9bb5"],
  ["Weber & Partner", "Anwahl 40", "Mailbox", "#8a9bb5"],
  ["Nordwerk GmbH", "Anwahl 41", "Wählt …", "#0755f5"],
];
list.innerHTML = `<span class="demo-tag">Beispieldaten</span>
  <div class="row"><div class="ttl">Deine Liste</div><span class="sp"></span><span class="pill blue" style="margin-right:150px">${H.icon("phone", "#0755f5")}<span class="dial-n">Anwahl 37</span></span></div>
  <div class="meta" style="margin:6px 0 18px">Heute · 120 Leads offen</div>
  ${leads.map((l, i) => `<div class="rank-row ld" style="padding:22px 4px"><div class="av soft" style="width:76px;height:76px">${H.icon("phone", "#0755f5", 2)}</div>
    <div class="rank-main"><div class="rank-name" style="font-size:34px">${l[0]}</div><div class="meta" style="font-size:25px;margin-top:4px">${l[1]}</div></div>
    <span class="pill st" style="background:${l[3]}1a;color:${l[3]};font-size:26px">${l[2]}</span></div>`).join("")}
  <div class="row alone" style="margin-top:22px;gap:18px;padding:22px 26px;border-radius:26px;background:#f3f6fb">
    <div class="av c6" style="width:70px;height:70px;font-size:26px">Du</div>
    <div><div style="font-weight:800;font-size:32px">Im Raum: nur du</div><div class="meta" style="font-size:24px">Niemand ruft gerade mit</div></div></div>`;
H.rise(tl, list, t2, { sfx: false });
H.glare(tl, list, t2 + 0.4);
const rows = [...list.querySelectorAll(".ld")];
const chips = [...list.querySelectorAll(".st")];
const dialN = list.querySelector(".dial-n");
const alone = list.querySelector(".alone");
// chips tick through the rejections on the spoken beats
const beats = [H.at(1, "Telefon"), H.at(1, "in"), H.at(1, "Hand"), H.at(1, "und"), H.at(1, "niemand") - 0.12];
chips.forEach((c, i) => {
  gsap.set(c, { opacity: 0 });
  H.pop(tl, c, beats[i], { from: 0.5, y: 0, sfx: i < 4 ? "click-soft" : null, gain: 0.45 });
  tl.set(dialN, { textContent: "Anwahl " + (37 + i) }, beats[i]);
  if (i < 4) tl.to(rows[i], { opacity: 0.42, duration: 0.25 }, beats[i] + 0.12);
});
gsap.set(alone, { opacity: 0 });
H.pop(tl, alone, H.at(1, "niemand"), { from: 0.85, y: 30, sfx: "pop", gain: 0.35 });
// the cold sets in on "mitzieht"
tl.to(list, { filter: "saturate(0.35) brightness(0.82)", duration: 0.6, ease: "power2.out" }, H.at(1, "mitzieht"));
H.cam(tl, t2, { scale: 1.03, y: -20 }, L(1).e - t2, "none");

// ---------- S3 the light comes on: brand arrival ----------
const s3 = H.scene("s3");
const t3 = H.at(2, "Deal") - 0.04;
const brand = H.el("div", "center", `<div style="margin-top:-520px">${H.wordmark(118)}</div>`, s3);
H.arrive(tl, s2, s3, t3, { from: 1.35, sfx: "impact-bass-2", gain: 0.6 });
H.cam(tl, t3 - 0.02, { scale: 1, y: 0 }, 0.01);
tl.to(orbs, { opacity: 1, duration: 0.9, ease: "power2.out" }, t3);
tl.to(floor, { opacity: 0.6, duration: 0.9, ease: "power2.out" }, t3);
H.sfx("sparkle", t3 + 0.1, 0.25);
// the lone "Du" from the list sits under the mark; on "nicht allein" the others arrive around it
const cluster = H.box(s3, 0, 760, 1080);
H.css(cluster, { height: "460px" });
const names = [["LW", "c1"], ["MK", "c3"], ["SR", "c5"], ["DA", "c4"], ["CM", "c2"], ["EF", "c1"], ["NH", "c3"], ["OP", "c5"]];
const R0 = 300, cxp = 540, cyp = 230;
const lines = H.el("div", "layer", "", cluster);
let svg = `<svg width="1080" height="460" style="position:absolute;left:0;top:0"><g stroke="rgba(104,216,255,.45)" stroke-width="3">`;
names.forEach((n, i) => {
  const a = (-90 + (i * 360) / names.length) * (Math.PI / 180);
  const x = cxp + Math.cos(a) * R0, y = cyp + Math.sin(a) * R0 * 0.62;
  svg += `<line class="ln" x1="${cxp}" y1="${cyp}" x2="${x.toFixed(0)}" y2="${y.toFixed(0)}" stroke-dasharray="400" stroke-dashoffset="400"/>`;
  const av = H.el("div", "av " + n[1], n[0], cluster);
  H.css(av, { position: "absolute", left: x - 46 + "px", top: y - 46 + "px" });
  n.push(av);
});
lines.innerHTML = svg + "</g></svg>";
const me = H.el("div", "av c6", "Du", cluster);
H.css(me, { position: "absolute", left: cxp - 62 + "px", top: cyp - 62 + "px", width: "124px", height: "124px", fontSize: "40px", boxShadow: "0 0 0 8px rgba(104,216,255,.25), 0 0 60px rgba(4,186,250,.6)" });
H.pop(tl, me, t3 + 0.25, { from: 0.4, y: 0 });
const tAll = H.at(2, "nicht") - 0.05;
const lns = [...lines.querySelectorAll(".ln")];
names.forEach((n, i) => {
  const t = tAll + i * 0.045;
  gsap.set(n[2], { opacity: 0 });
  tl.set(n[2], { opacity: 1 }, t);
  tl.fromTo(n[2], { x: (cxp - parseFloat(n[2].style.left) - 46) * 0.9, y: (cyp - parseFloat(n[2].style.top) - 46) * 0.9, scale: 0.3 },
    { x: 0, y: 0, scale: 1, duration: 0.55, ease: "back.out(1.5)", immediateRender: false }, t);
  tl.to(lns[i], { strokeDashoffset: 0, duration: 0.45, ease: "power2.out" }, t + 0.05);
});
H.sfx("pop", tAll, 0.5); H.sfx("pop", tAll + 0.18, 0.35); H.sfx("pop", tAll + 0.32, 0.3);
tl.set(me, { backgroundImage: "linear-gradient(150deg,#68d8ff,#0755f5)" }, tAll + 0.2);

// ---------- S4 the room: we call together in Discord ----------
const s4 = H.scene("s4");
const t4 = L(3).s - 0.08;
H.seam(tl, s3, s4, t4);
const room = H.box(s4, 70, 250, 940, "ui");
const ppl = [["LW", "Lena W.", "Setter", "c1"], ["MK", "Malik K.", "Closer", "c3"], ["SR", "Sophie R.", "Opener", "c5"], ["Du", "Du", "Setter", "c6"],
  ["DA", "Deniz A.", "Setter", "c4"], ["CM", "Clara M.", "Closer", "c2"], ["EF", "Emre F.", "Opener", "c1"], ["NH", "Nina H.", "Setter", "c3"], ["OP", "Ole P.", "Closer", "c5"]];
room.innerHTML = `<span class="demo-tag">Beispiel</span>
  <div class="room-head"><span class="pill live">● Live</span><div class="ttl">Call-Session</div><span class="sp"></span></div>
  <div class="row" style="margin-top:14px;gap:14px"><span class="meta">Sprachkanal · <span class="cnt-room">1</span> im Raum</span><span class="sp"></span><span class="pill blue dpill">${H.icon("mic", "#0755f5")}im Discord</span></div>
  <div class="tiles">${ppl.map((p) => `<div class="tile"><div class="speak"></div><div class="av ${p[3]}" style="width:96px;height:96px">${p[0]}</div><div class="nm">${p[1]}</div><div class="rl">${p[2]}</div></div>`).join("")}</div>`;
H.rise(tl, room, t4, { sfx: false, y: 300, rx: 24 });
H.glare(tl, room, t4 + 0.35);
const tiles = [...room.querySelectorAll(".tile")];
const cntRoom = room.querySelector(".cnt-room");
const order = [3, 0, 1, 4, 2, 5, 6, 7, 8];
order.forEach((ti, k) => {
  const t = t4 + 0.18 + k * 0.1;
  H.pop(tl, tiles[ti], t, { from: 0.7, y: 20, ease: "back.out(1.4)", dur: 0.36 });
  tl.set(cntRoom, { textContent: String(k + 1) }, t);
  if (k % 2 === 0) H.sfx("pop", t, 0.22);
});
const speaks = [...room.querySelectorAll(".speak")];
[[1, 0.15], [4, 0.75], [0, 1.3], [7, 1.75]].forEach(([i, dt]) => {
  tl.to(speaks[i], { opacity: 1, duration: 0.12 }, t4 + 0.9 + dt);
  tl.to(speaks[i], { opacity: 0, duration: 0.2 }, t4 + 0.9 + dt + 0.5);
});
const dpill = room.querySelector(".dpill");
tl.fromTo(dpill, { scale: 1 }, { scale: 1.18, duration: 0.16, yoyo: true, repeat: 1, ease: "power2.out", immediateRender: false }, H.at(3, "Discord") - 0.04);
tl.to(dpill, { boxShadow: "0 0 0 10px rgba(7,85,245,.18)", duration: 0.2 }, H.at(3, "Discord"));
H.sfx("ping", H.at(3, "Discord"), 0.35);
H.cam(tl, t4, { scale: 1.04, y: -24 }, L(3).e - t4 + 0.2, "none");

// ---------- S5 three offers file into a stack, one per spoken word ----------
const s5 = H.scene("s5");
const t5 = L(4).s - 0.1;
H.cam(tl, t5 - 0.01, { scale: 1, y: 0 }, 0.01);
H.seam(tl, s4, s5, t5);
const offers = [
  ["clock", "Feste Sessions", "Gemeinsam callen, mit Host", "2 bis 25 Plätze", "blue", "Feste"],
  ["voice", "Roleplays", "Einwände üben, mit Feedback", "Für alle offen", "green", "Roleplays"],
  ["users", "Call-Partner", "Nach Zielgruppe und Call-Zeit", "Schreiben", "blue", "Call"],
];
offers.forEach((o, i) => {
  const c = H.box(s5, 80, 470 + i * 280, 920, "ui");
  H.css(c, { padding: "38px 40px" });
  c.innerHTML = `<div class="row" style="gap:30px"><div style="width:120px;height:120px;border-radius:32px;display:grid;place-items:center;background:linear-gradient(150deg,#e9f1ff,#d6e6ff)"><div style="width:62px;height:62px">${H.icon(o[0], "#0755f5", 2)}</div></div>
    <div style="flex:1"><div style="font-weight:800;font-size:58px;letter-spacing:-.045em;line-height:1">${o[1]}</div><div class="meta" style="margin-top:10px;font-size:29px">${o[2]}</div></div></div>
    <span class="pill ${o[4]}" style="position:absolute;right:36px;top:-24px;font-size:26px;box-shadow:0 10px 24px -8px rgba(0,20,60,.35)">${o[3]}</span>`;
  const t = H.at(4, o[5]) - 0.12;
  gsap.set(c, { opacity: 0 });
  tl.set(c, { opacity: 1 }, t);
  tl.fromTo(c, { x: 240, rotationY: -24, transformPerspective: 1400 }, { x: 0, rotationY: 0, duration: 0.6, ease: "expo.out", immediateRender: false }, t);
  H.sfx("whoosh-short", t - 0.04, 0.4);
});
H.cam(tl, t5, { y: -30 }, L(4).e - t5 + 0.2, "none");

// ---------- S6 the evening: what everyone did together (elevation: up) ----------
const s6 = H.scene("s6");
const t6 = L(5).s - 0.08;
H.cam(tl, t6 - 0.01, { y: 0 }, 0.01);
H.seam(tl, s5, s6, t6, { dir: "up" });
const st = H.statsCard(s6, 70, 400, 940);
H.glare(tl, st.el, t6 + 0.3);
const tc = H.at(5, "siehst");
H.count(tl, st.num("a"), 0, 1284, tc, 1.7, { tick: 9, tickGain: 0.1 });
H.count(tl, st.num("s"), 0, 31, tc + 0.15, 1.5);
H.count(tl, st.num("c"), 0, 6, tc + 0.3, 1.3);
H.count(tl, st.num("p"), 0, 24, tc + 0.45, 1.2);
H.sfx("chime", tc + 1.65, 0.3);
const eve = H.el("div", "kicker", `<span class="dot"></span>Abends, nach dem Calling-Tag`, s6);
H.css(eve, { position: "absolute", left: "70px", top: "290px" });
H.pop(tl, eve, t6 + 0.15, { from: 0.8, y: 20 });
H.cam(tl, t6, { scale: 1.05 }, L(5).e - t6 + 0.2, "none");

// ---------- S7 "Kostenfrei." deeper into the same thought ----------
const s7 = H.scene("s7");
const t7 = L(6).s - 0.06;
H.cam(tl, t7 - 0.01, { scale: 1 }, 0.01);
H.zoomThrough(tl, s6, s7, t7);
const free = H.headline(s7, ["*Kostenfrei.*"], { y: 600, size: 168 });
const perks = H.el("div", null, ["Tracking", "Calls", "Roleplays", "Call-Partner"].map((p) => `<span class="pill glass" style="font-size:32px">${H.icon("check", "#68d8ff", 3).replace("<svg", '<svg width="30" height="30"')}${p}</span>`).join(""), s7);
H.css(perks, { position: "absolute", left: "60px", width: "960px", top: "830px", display: "flex", flexWrap: "wrap", gap: "18px", justifyContent: "center" });
H.waterfall(tl, [...perks.children], t7 + 0.2, { y: 50, gap: 0.07 });

// ---------- S8 CTA ----------
H.ctaBeat(tl, s7);
