"use strict";
/* Lionels Budget – läuft komplett im Browser, Daten liegen in localStorage auf dem Gerät. */
const APP_VERSION = "2.2.0";
const STORE_KEY = "lionel-budget-v1";
const EARLY_PAY_DAYS = 7, MIN_TEMPO_DAYS = 5, GOOD_MARGIN = 20, WARN_SHARE = .8, PACE_TOL = .05, BACKUP_REMIND_DAYS = 7;

const OUT = [
  {id:"essen", label:"Essen & Trinken", short:"Essen"},
  {id:"freizeit", label:"Freizeit & Ausgang", short:"Freizeit"},
  {id:"kleider", label:"Kleider & Shopping", short:"Kleider"},
  {id:"handy", label:"Fixkosten", short:"Fixkosten", fixed:true},
  {id:"sonstiges", label:"Sonstiges", short:"Sonstiges"},
];
const IN = [
  {id:"lohn", label:"Lehrlingslohn", short:"Lohn"},
  {id:"einnahme", label:"Andere Einnahme", short:"Andere"},
];
// Überweisung aufs Sparkonto: verlässt das Konto, zählt aber nicht als Ausgabe
const SAVE = {id:"sparen", label:"Aufs Sparkonto", short:"Sparen"};
const SPECIAL = {unerfasst:"Nicht erfasst", korrektur:"Korrektur Kontostand", rueckerstattung:"Rückerstattung"};
const LABEL = {...Object.fromEntries([...OUT, ...IN, SAVE].map(c => [c.id, c.label])), ...SPECIAL};
const ICON = {essen:"🍴", freizeit:"🎉", kleider:"👕", handy:"📌", sonstiges:"•", sparen:"💰", lohn:"＋", einnahme:"＋", unerfasst:"?", korrektur:"±", rueckerstattung:"↩"};
const MON = ["Jan","Feb","März","Apr","Mai","Juni","Juli","Aug","Sep","Okt","Nov","Dez"];
const MONL = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const WD = ["Sonntag","Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag"];

/* ---------- Hilfsfunktionen ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const r2 = x => Math.round(x * 100) / 100;
function chf(n, {sign=false, bare=false} = {}) {
  const neg = n < -0.005; const s = Math.abs(n).toFixed(2).split(".");
  s[0] = s[0].replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  return (neg ? "−" : (sign && n > 0.005 ? "+" : "")) + (bare ? "" : "CHF ") + s[0] + "." + s[1];
}
function parseAmt(v) {
  // akzeptiert 12.50, 12,50, 12.–, 1'250.00, 1.250,00 und «CHF 885.20»
  const raw = String(v || "").trim().replace(/^(chf|fr\.?)\s*/i, "").replace(/\s*(chf|fr\.?)$/i, "").replace(/[.,][-–]$/, "").replace(/['’\s]/g, "");
  if (!/^\d[\d.,]*$/.test(raw)) return NaN;
  let a = raw;
  if (a.includes(",") && a.includes(".")) a = a.lastIndexOf(",") > a.lastIndexOf(".") ? a.replace(/\./g, "").replace(",", ".") : a.replace(/,/g, "");
  else a = a.replace(",", ".");
  return /^\d+(\.\d{1,2})?$/.test(a) ? r2(+a) : NaN;
}
const D = s => { const [y,m,d] = s.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const addDays = (s, n) => { const d = D(s); d.setDate(d.getDate() + n); return iso(d); };
const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const fmtDay = s => { const d = D(s); return d.getDate() + ". " + MON[d.getMonth()]; };
const dShort = s => { const d = D(s); return d.getDate() + "." + (d.getMonth() + 1) + "."; };
const todayIso = () => iso(new Date());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v));

/* ---------- Speicher ---------- */
const DEF_SETTINGS = {startBalance:0, startDate:todayIso(), goal:0, income:0, payday:25, limits:{}, recurring:[], skips:{}};
const CAR_DEF = {name:"Occasion, z. B. Mazda MX-5 oder Suzuki Swift Sport", price:8000, reserve:2000, saved:0, start:"2026-08", wages:[850,1050,1584], rates:[100,350,700], inBudget:true};
let S = structuredClone(DEF_SETTINGS), P = [], C = structuredClone(CAR_DEF), carStored = false, M = {}, apSeen = new Set(), lastBackup = 0, storeOk = true;

function catId(v, type) {
  const t = String(v || "").trim().toLowerCase();
  const all = [...OUT, ...IN, SAVE];
  const hit = all.find(c => c.id === t || c.label.toLowerCase() === t || c.short.toLowerCase() === t);
  if (hit) return hit.id;
  if (SPECIAL[t]) return t;
  const sp = Object.entries(SPECIAL).find(([, l]) => l.toLowerCase() === t);
  if (sp) return sp[0];
  return type === "in" ? "einnahme" : "sonstiges";
}
function cleanPayment(p) {
  if (!p || typeof p !== "object") return null;
  const amount = +p.amount, type = p.type === "in" ? "in" : p.type === "out" ? "out" : null;
  if (!(amount > 0) || !type || !isDate(p.date)) return null;
  const o = {id:String(p.id || uid()), amount:r2(amount), type, category:catId(p.category, type), date:p.date, note:String(p.note || "").slice(0, 80), createdAt:+p.createdAt || Date.now()};
  if (p.source) o.source = String(p.source);
  if (p.merchant) o.merchant = String(p.merchant).slice(0, 60);
  if (p.rid) o.rid = String(p.rid);
  if (p.needsCat) o.needsCat = true;
  if (p.refundOf && OUT.some(c => c.id === p.refundOf)) o.refundOf = p.refundOf;
  return o;
}
function cleanSettings(b) {
  b = b || {};
  return {
    startBalance:+b.startBalance || 0,
    startDate:isDate(b.startDate) ? b.startDate : todayIso(),
    goal:+b.goal || 0, income:+b.income || 0,
    payday:Math.min(Math.max(Math.round(+b.payday || 25), 1), 28),
    limits:Object.fromEntries(Object.entries(b.limits || {}).filter(([k, v]) => OUT.some(c => c.id === k) && +v > 0).map(([k, v]) => [k, +v])),
    recurring:Array.isArray(b.recurring) ? b.recurring.filter(r => r && r.name && +r.amount > 0).map(r => ({id:String(r.id || uid()), name:String(r.name).slice(0, 40), amount:r2(+r.amount), day:Math.min(Math.max(Math.round(+r.day || 1), 1), 28)})) : [],
    skips:b.skips && typeof b.skips === "object" ? {...b.skips} : {},
  };
}
function cleanCar(c) {
  const arr = (a, d) => Array.isArray(a) && a.length === 3 ? a.map(x => +x || 0) : [...d];
  return {name:String(c.name || CAR_DEF.name), price:+c.price || 0, reserve:+c.reserve || 0, saved:+c.saved || 0,
    start:/^\d{4}-\d{2}$/.test(String(c.start)) ? c.start : CAR_DEF.start, wages:arr(c.wages, CAR_DEF.wages), rates:arr(c.rates, CAR_DEF.rates), inBudget:c.inBudget !== false};
}
function applyData(d) {
  S = cleanSettings(d.settings);
  P = (Array.isArray(d.payments) ? d.payments : []).map(cleanPayment).filter(Boolean);
  const ids = new Set(); P = P.filter(p => !ids.has(p.id) && ids.add(p.id));
  carStored = !!d.car; C = d.car ? cleanCar(d.car) : structuredClone(CAR_DEF);
  M = d.merchants && typeof d.merchants === "object" ? Object.fromEntries(Object.entries(d.merchants).filter(([, v]) => OUT.some(c => c.id === v))) : {};
  apSeen = new Set(Array.isArray(d.apSeen) ? d.apSeen.map(String) : []);
  P.forEach(p => { if (p.source === "applepay") apSeen.add(p.id); });
  lastBackup = +d.lastBackup || 0;
}
function snapshot() {
  return {app:"lionels-budget", v:1, exportedAt:new Date().toISOString(), settings:S, payments:P, car:carStored ? C : null, merchants:M, apSeen:[...apSeen], lastBackup};
}
function load() {
  try { const raw = localStorage.getItem(STORE_KEY); if (raw) applyData(JSON.parse(raw)); }
  catch { storeOk = false; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(snapshot())); storeOk = true; return true; }
  catch { storeOk = false; showNotice(); toast("Speichern hat nicht geklappt. Ist der Speicher voll oder der private Modus an?", {err:true}); return false; }
}

/* ---------- Perioden & Berechnung ---------- */
const payday = () => S.payday;
function periodOf(s) {
  const d = D(s); let y = d.getFullYear(), m = d.getMonth();
  if (d.getDate() < payday()) { m--; if (m < 0) { m = 11; y--; } }
  const start = iso(new Date(y, m, payday(), 12)); const end = addDays(iso(new Date(y, m + 1, payday(), 12)), -1);
  return {start, end, days:diff(start, end) + 1};
}
function shiftPeriod(start, n) { const d = D(start); return periodOf(iso(new Date(d.getFullYear(), d.getMonth() + n, payday(), 12))).start; }
const net = (from, to) => P.filter(p => p.date >= from && p.date < to).reduce((a, p) => a + (p.type === "in" ? p.amount : -p.amount), 0);
function balanceAt(day) { return r2(S.startBalance + (day >= S.startDate ? net(S.startDate, day) : -net(day, S.startDate))); }
const budgetTotal = () => OUT.reduce((a, c) => a + (+S.limits[c.id] || 0), 0);
const isFix = id => OUT.some(c => c.fixed && c.id === id);
const sum = a => r2(a.reduce((x, p) => x + p.amount, 0));
const isSave = p => p.type === "out" && p.category === SAVE.id;
const isSpend = p => p.type === "out" && p.category !== SAVE.id;
function stats(per) {
  const list = P.filter(p => p.date >= per.start && p.date <= per.end);
  // Rückerstattungen verringern die Ausgaben der ursprünglichen Kategorie
  const ref = list.filter(p => p.category === "rueckerstattung"), refSum = sum(ref);
  const out = r2(sum(list.filter(isSpend)) - refSum), inc = r2(sum(list.filter(p => p.type === "in")) - refSum);
  const by = {}; list.filter(isSpend).forEach(p => by[p.category] = r2((by[p.category] || 0) + p.amount));
  ref.forEach(p => { const c = p.refundOf || "sonstiges"; by[c] = r2(Math.max((by[c] || 0) - p.amount, 0)); });
  return {list, out, inc, by, ref, saved:sum(list.filter(isSave))};
}
// Sparziel: C.saved ist der Stand ohne die Einträge in der App, dazu kommen alle Überweisungen aufs Sparkonto
const savedPays = () => sum(P.filter(isSave));
const savedTotal = () => r2(C.saved + savedPays());
const saveOn = () => carStored && C.inBudget;
// Sparrate der Periode: richtet sich nach dem Lehrjahr beim Lohn, mit dem die Periode beginnt
function saveInfo(per) {
  const [sy, sm] = C.start.split("-").map(Number), s0 = sy * 12 + (sm - 1), d = D(per.start), k = d.getFullYear() * 12 + d.getMonth();
  const yr = Math.floor((k - s0) / 12), rate = yr >= 0 && yr <= 2 ? (+C.rates[yr] || 0) : 0;
  const done = sum(P.filter(p => isSave(p) && p.date >= per.start && p.date <= per.end));
  return {k, s0, yr, rate, done, rest:r2(Math.max(rate - done, 0))};
}
// Wann ist eine feste Zahlung in dieser Periode fällig?
function dueDate(per, day) {
  const s = D(per.start); let d = new Date(s.getFullYear(), s.getMonth(), day, 12);
  if (iso(d) < per.start) d = new Date(s.getFullYear(), s.getMonth() + 1, day, 12);
  return iso(d);
}

/* ---------- Zustand ---------- */
let tab = "heute", mode = "out", viewStart = null, heroToday = null, heroBal = null, heroDaily = null, heroProjEnd = null, lohnDue = false;
let chartData = {}, CW = 340, toastTimer = null, apState = null, editId = null, editMode = "out";
let reconOpen = false, reconNote = "", reconUndoId = null, reconDraft = "", reconConfirm = null, reconTimer = null;

/* ---------- Toast & Hinweise ---------- */
function toast(html, {err=false, undo=null, ms=err ? 6000 : 4500} = {}) {
  clearTimeout(toastTimer);
  const t = $("toast");
  t.className = "toast" + (err ? " err" : "");
  t.innerHTML = `<span>${html}</span>${undo ? `<button class="btn ghost" type="button" id="toastUndo">Rückgängig</button>` : ""}`;
  t.hidden = false;
  if (undo) $("toastUndo").onclick = () => { clearTimeout(toastTimer); t.hidden = true; undo(); };
  const dur = undo ? 8000 : ms, arm = () => { clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, dur); };
  t.onpointerenter = t.onfocusin = () => clearTimeout(toastTimer);
  t.onpointerleave = t.onfocusout = arm;
  arm();
}
function showNotice() {
  const n = $("storeNotice");
  if (!storeOk) { n.hidden = false; n.textContent = "Dieses Gerät lässt die App gerade nichts speichern (privater Modus?). Einträge gehen beim Schliessen verloren."; return; }
  const days = lastBackup ? (Date.now() - lastBackup) / 864e5 : Infinity;
  if (P.length >= 5 && days > BACKUP_REMIND_DAYS) {
    n.hidden = false;
    n.innerHTML = `${lastBackup ? "Dein letztes Backup ist über eine Woche alt." : "Noch kein Backup."} Deine Daten liegen nur auf diesem iPhone. <button class="linkbtn" type="button" id="goBackup">Jetzt sichern</button>`;
    $("goBackup").onclick = () => { switchTab("mehr"); $("bakExport").focus(); $("bakExport").scrollIntoView({block:"center"}); };
  } else n.hidden = true;
}

/* ---------- Eintragen ---------- */
function addEntry(e, {quiet=false, refill=true} = {}) {
  const p = cleanPayment({...e, id:e.id || uid(), createdAt:Date.now()});
  P = [...P, p];
  if (!save()) { P = P.filter(x => x.id !== p.id); return null; }
  renderAll();
  if (!quiet) {
    const t = todayIso(), when = p.date === t ? "" : p.date === addDays(t, -1) ? " für gestern" : ` für den ${fmtDay(p.date)}`;
    const free = heroToday !== null && p.date >= periodOf(t).start ? ` Heute noch frei: ${chf(heroToday)}.` : "";
    toast(`${esc(LABEL[p.category])} ${esc(chf(p.amount))}${esc(when)} eingetragen.${esc(free)}`, {undo:() => {
      P = P.filter(x => x.id !== p.id); save(); renderAll();
      if (refill && !e.rid && !e.source) { $("fAmount").value = p.amount.toFixed(2); $("fNote").value = p.note; $("fDate").value = p.date; mode = p.type; syncDayChips(); renderAll(); }
      toast("Eintrag rückgängig gemacht.");
    }});
  }
  return p.id;
}
function removeEntry(id) {
  const p = P.find(x => x.id === id); if (!p) return;
  P = P.filter(x => x.id !== id);
  if (id === reconUndoId) { reconNote = ""; reconUndoId = null; }
  save(); renderAll();
  toast("Zahlung gelöscht.", {undo:() => { P = [...P, p]; save(); renderAll(); toast("Wiederhergestellt."); }});
}

/* ---------- Render: Heute ---------- */
function setPill(cls, text) { const p = $("heroPill"); p.className = "pill " + cls; p.textContent = text; }
function facts(rows) { $("facts").innerHTML = rows.map(([k, v, c]) => `<div><dt>${esc(k)}</dt><dd${c ? ` class="${c}"` : ""}>${esc(v)}</dd></div>`).join(""); }

function renderHero() {
  heroBal = null; heroProjEnd = null; heroToday = null; heroDaily = null;
  const today = todayIso(), per = periodOf(today), st = stats(per), total = budgetTotal(), goal = +S.goal || 0;
  const elapsed = diff(per.start, today) + 1, left = per.days - elapsed + 1, after = per.days - elapsed;
  const outs = st.list.filter(p => isSpend(p) && p.date <= today);
  // «Nicht erfasst» stammt aus früheren Tagen und belastet nicht das heutige Tagesbudget
  const refunds = sum(st.ref.filter(p => p.date <= today && !isFix(p.refundOf)));
  const varBefore = r2(sum(outs.filter(p => (p.date < today || p.category === "unerfasst") && !isFix(p.category))) - refunds);
  const varToday = sum(outs.filter(p => p.date === today && p.category !== "unerfasst" && !isFix(p.category)));
  const outSoFar = sum(outs);
  const fixedLimit = OUT.filter(c => c.fixed).reduce((x, c) => x + Math.max(+S.limits[c.id] || 0, st.by[c.id] || 0), 0);
  const fixedRest = OUT.filter(c => c.fixed).reduce((x, c) => x + Math.max((+S.limits[c.id] || 0) - (st.by[c.id] || 0), 0), 0);
  const balNow = balanceAt(addDays(today, 1));
  // Lohn, der schon vor dem Lohntag kam (z. B. am 23.), gehört zur nächsten Periode
  const earlyInc = sum(P.filter(p => p.type === "in" && p.category === "lohn" && p.date > addDays(per.end, -EARLY_PAY_DAYS) && p.date <= today));
  const balAdj = r2(balNow - earlyInc);
  // Offene Sparrate wird wie offene Fixkosten reserviert. Ist sie überwiesen, sinkt der Kontostand um denselben Betrag.
  const sv = saveInfo(per), saveRest = saveOn() ? sv.rest : 0;
  const goalRoom = balAdj + varToday - goal - fixedRest - saveRest;
  const budgetRoom = total > 0 ? (total - fixedLimit) - varBefore : Infinity;
  const base = r2(Math.min(budgetRoom, goalRoom));
  const daily = r2(Math.max(base, 0) / left), todayLeft = r2(daily - varToday);
  const unerf = st.by.unerfasst || 0, varSoFar = sum(outs.filter(p => !isFix(p.category)));
  let proj;
  if (elapsed >= MIN_TEMPO_DAYS) proj = (varSoFar - unerf) / elapsed * after + fixedRest;
  else proj = total > 0 ? Math.max((total - fixedLimit) - varSoFar, 0) * (after / left) + fixedRest : fixedRest;
  const projEnd = r2(balAdj - proj - saveRest);
  heroToday = todayLeft; heroBal = balNow; heroDaily = r2(daily); heroProjEnd = projEnd;

  const noSetup = !S.startBalance && !P.length;
  if (noSetup) {
    $("heroBig").innerHTML = `<span class="cur">CHF</span>–`; $("heroBig").className = "big num";
    $("heroSub").innerHTML = `Willkommen! Trag deinen Kontostand, deinen Lohn und dein Ziel ein. Dann rechnet die App dein Tagesbudget aus.<br><button class="btn primary" type="button" id="goSetup" style="margin-top:10px">Jetzt einrichten</button>`;
    $("goSetup").onclick = () => { switchTab("mehr"); $("sBal").focus(); };
    setPill("neutral", "Einrichten"); $("heroMore").hidden = true; facts([]); renderRecon(); return;
  }
  $("heroMore").hidden = false; $("heroBalSum").textContent = chf(balNow);
  $("heroBig").innerHTML = `<span class="cur">CHF</span>${esc(chf(todayLeft, {bare:true}))}`;
  const tomorrow = left > 1 ? Math.max(base - varToday, 0) / (left - 1) : 0;
  let sub;
  const res = []; if (fixedRest > 0) res.push(`${chf(fixedRest)} für Fixkosten`); if (saveRest > 0) res.push(`${chf(saveRest)} fürs Sparziel`);
  if (base <= 0 && saveRest > 0 && base + saveRest > 0) sub = `Mit der Sparrate von ${chf(saveRest)} geht es diesen Monat nicht auf, es fehlen ${chf(-base)}. Überweis weniger aufs Sparkonto oder gib bis zum Lohn nichts mehr aus.`;
  else if (base <= 0) sub = `Dein Budget ist um ${chf(-base)} überzogen. Bis zum Lohn solltest du nichts mehr ausgeben.`;
  else if (todayLeft >= 0) sub = `Noch ${left} ${left === 1 ? "Tag" : "Tage"} bis zum Lohn.${res.length ? ` Reserviert: ${res.join(" und ")}.` : ""}`;
  else sub = `Du bist heute ${chf(-todayLeft)} über deinem Tagesbudget von ${chf(daily)}.${left > 1 ? ` Ab morgen hast du noch ${chf(tomorrow)} pro Tag.` : ""}`;
  $("heroSub").textContent = sub;
  const goalPart = goal > 0 ? (projEnd >= goal + GOOD_MARGIN ? "good" : projEnd >= goal ? "warn" : "bad") : "none";
  // Rot nur, wenn das Ziel in Gefahr ist. Ein teurer Tag allein ist nur ein Hinweis.
  $("heroBig").className = "big num" + (base <= 0 || goalPart === "bad" ? " bad" : todayLeft < 0 ? " warn" : "");
  if (base <= 0 || goalPart === "bad") setPill("bad", "Ziel in Gefahr");
  else if (todayLeft < 0) setPill("warn", "Heute drüber");
  else if (goalPart === "good") setPill("good", "Auf Kurs");
  else if (goalPart === "warn") setPill("warn", "Knapp auf Kurs");
  else setPill("neutral", "Kein Ziel gesetzt");
  $("pace").hidden = !(total > 0);
  if (total > 0) {
    const tp = Math.min(elapsed / per.days * 100, 100), bp = Math.min(outSoFar / total * 100, 100), fast = (outSoFar - unerf) / total > elapsed / per.days + PACE_TOL;
    $("paceFill").style.width = bp + "%"; $("paceFill").style.background = fast ? "var(--warn-fill)" : "var(--accent)";
    $("paceMarker").style.left = `calc(${tp}% - 1px)`;
    $("paceLeft").innerHTML = `${esc(chf(outSoFar, {bare:true}))} von ${esc(chf(total, {bare:true}))} ausgegeben<span class="sr-only">, ${fast ? "schneller als geplant" : "im Plan"}</span>`;
    $("paceRight").textContent = `Tag ${elapsed} von ${per.days}`;
  }
  const inc = earlyInc > 0 ? earlyInc : (+S.income || 0), gap = r2(projEnd - goal);
  const head = [["Tagesbudget", chf(daily)]];
  if (saveOn() && sv.rate > 0) head.push(["Aufs Sparkonto diese Periode", `${chf(sv.done, {bare:true})} von ${chf(sv.rate, {bare:true})}`, sv.rest > 0 ? "" : "good"]);
  facts(inc > 0 && goal > 0
    ? [...head, ["Nach dem Lohn voraussichtlich", chf(r2(projEnd + inc))], [(gap >= 0 ? "Über" : "Unter") + " deinem Ziel von " + chf(r2(goal + inc), {bare:true}).replace(/\.00$/, ""), chf(gap, {sign:true}), gap >= GOOD_MARGIN ? "good" : gap >= 0 ? "warn" : "bad"]]
    : [...head, ["Voraussichtlich am " + fmtDay(per.end), chf(projEnd), goal && projEnd < goal ? "bad" : ""], ["Dein Ziel", goal ? chf(goal) : "–"]]);
  renderRecon();
}

function reconSay(t) { $("reconLive").textContent = ""; setTimeout(() => { $("reconLive").textContent = t; }, 150); }
function armReconTimer() { clearTimeout(reconTimer); reconTimer = setTimeout(() => { reconNote = ""; reconUndoId = null; if (!reconOpen) renderRecon(); }, 12000); }
function reconClose(focus) { reconOpen = false; reconDraft = ""; reconConfirm = null; renderRecon(); if (focus) $("reconOpen")?.focus(); }
function renderRecon() {
  const box = $("recon");
  if (heroBal === null || (!S.startBalance && !P.length)) { box.innerHTML = ""; return; }
  if (!reconOpen) {
    box.innerHTML = reconNote
      ? `<div class="note"><span>${esc(reconNote)}</span>${reconUndoId ? `<button class="linkbtn" type="button" id="reconUndo">Rückgängig</button>` : ""}</div>`
      : `<button class="linkbtn" type="button" id="reconOpen">Mit Bank-App abgleichen</button>`;
    const o = $("reconOpen"); if (o) o.onclick = () => { reconOpen = true; reconDraft = ""; reconConfirm = null; renderRecon(); $("reconAmt").focus(); };
    const u = $("reconUndo"); if (u) u.onclick = () => { P = P.filter(x => x.id !== reconUndoId); save(); reconNote = ""; reconUndoId = null; renderAll(); reconSay("Abgleich rückgängig gemacht."); $("reconOpen")?.focus(); };
    return;
  }
  const hadFocus = document.activeElement && document.activeElement.id === "reconAmt";
  box.innerHTML = `<label class="q" for="reconAmt">Verfügbarer Betrag in deiner Bank-App</label>
    <span class="amount"><span>CHF</span><input id="reconAmt" type="text" inputmode="decimal" autocomplete="off" placeholder="${esc(heroBal.toFixed(2))}" aria-describedby="reconPrev reconHint"></span>
    <div class="preview" id="reconPrev"></div>
    <div class="inrow"><button class="btn" type="button" id="reconCancel">Abbrechen</button><button class="btn primary" type="button" id="reconOk">Übernehmen</button></div>
    <p class="hint" id="reconHint">Laut deinen Einträgen sind es ${esc(chf(heroBal))}. Nimm den Betrag, den die Bank-App als «verfügbar» zeigt. Am besten einmal pro Woche.</p>`;
  const inp = $("reconAmt"); inp.value = reconDraft; if (hadFocus) inp.focus();
  const preview = () => {
    const real = parseAmt(inp.value), el = $("reconPrev"); el.className = "preview";
    if (!inp.value.trim() || Number.isNaN(real)) { el.textContent = ""; $("reconOk").textContent = "Übernehmen"; return; }
    const d = r2(real - heroBal);
    el.textContent = Math.abs(d) < 0.005 ? "Stimmt genau, es wird nichts gebucht." : d < 0 ? `Differenz ${chf(d)}: wird als «Nicht erfasst» gebucht.` : `Differenz ${chf(d, {sign:true})}: wird als Korrektur gebucht.`;
    if (Math.abs(d) >= 100) el.classList.add("big-diff");
    $("reconOk").textContent = reconConfirm === d ? `Ja, ${chf(Math.abs(d))} buchen` : "Übernehmen";
  };
  preview();
  inp.addEventListener("input", () => { reconDraft = inp.value; reconConfirm = null; inp.removeAttribute("aria-invalid"); preview(); });
  const go = () => {
    const real = parseAmt(inp.value);
    if (!inp.value.trim() || Number.isNaN(real)) { const t = "Betrag nicht erkannt. Schreib ihn so: 885.20"; $("reconPrev").textContent = t; inp.setAttribute("aria-invalid", "true"); reconSay(t); inp.focus(); return; }
    const d = r2(real - heroBal);
    if (Math.abs(d) < 0.005) { reconNote = "Stimmt genau. Deine Einträge sind vollständig."; reconUndoId = null; reconClose(true); reconSay(reconNote); armReconTimer(); return; }
    if (d > 0 && lohnDue) { const t = "Trag zuerst den Lohn ein. Der Knopf steht oben bei «Heute»."; $("reconPrev").textContent = t; reconSay(t); return; }
    if (Math.abs(d) >= 100 && reconConfirm !== d) { reconConfirm = d; preview(); const t = `Grosse Differenz von ${chf(Math.abs(d))}. Stimmt der Betrag? Tipp nochmals zum Bestätigen.`; $("reconPrev").textContent = t; $("reconPrev").classList.add("big-diff"); reconSay(t); $("reconOk").focus(); return; }
    const id = addEntry(d < 0
      ? {amount:-d, type:"out", category:"unerfasst", date:todayIso(), note:"Abgleich mit Bank-App"}
      : {amount:d, type:"in", category:"korrektur", date:todayIso(), note:"Abgleich mit Bank-App"}, {quiet:true});
    if (!id) return;
    reconUndoId = id; reconOpen = false; reconDraft = ""; reconConfirm = null;
    renderAll();
    reconNote = (d < 0 ? `${chf(-d)} als «Nicht erfasst» gebucht.` : `${chf(d)} als Korrektur gebucht.`) + (heroDaily !== null ? ` Tagesbudget jetzt ${chf(heroDaily)}.` : "");
    renderRecon(); reconSay(reconNote); $("reconUndo")?.focus(); armReconTimer();
  };
  $("reconOk").onclick = go;
  inp.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); go(); } });
  box.onkeydown = e => { if (e.key === "Escape") { e.preventDefault(); reconClose(true); } };
  $("reconCancel").onclick = () => reconClose(true);
}

function renderBanners() {
  const today = todayIso(), per = periodOf(today), out = [];
  lohnDue = S.income > 0 && per.start > S.startDate && !P.some(p => p.type === "in" && p.category === "lohn" && p.date >= addDays(per.start, -EARLY_PAY_DAYS) && p.date <= per.end);
  if (lohnDue) out.push(`<div class="banner"><div class="t"><b>Lohn eingegangen?</b>Lohn vom ${esc(fmtDay(per.start))} ist noch nicht eingetragen.</div><div class="acts"><button class="btn primary" type="button" data-lohn="${per.start}">${esc(chf(S.income))} eintragen</button></div></div>`);
  // Lohn kommt manchmal ein paar Tage vor dem Lohntag
  else if (S.income > 0 && diff(today, per.end) < 3 && !P.some(p => p.type === "in" && p.category === "lohn" && p.date > addDays(per.end, -EARLY_PAY_DAYS)))
    out.push(`<div class="banner"><div class="t"><b>Lohn schon da?</b>Manchmal kommt er vor dem ${esc(fmtDay(addDays(per.end, 1)))}.</div><div class="acts"><button class="btn" type="button" data-lohn="${today}">${esc(chf(S.income))} eintragen</button></div></div>`);
  const sv = saveInfo(per);
  if (saveOn() && sv.rest > 0 && !lohnDue && !S.skips["save:" + per.start] && P.some(p => p.type === "in" && p.category === "lohn" && p.date >= addDays(per.start, -EARLY_PAY_DAYS) && p.date <= per.end))
    out.push(`<div class="banner"><div class="t"><b>${esc(chf(sv.rest))} fürs Sparziel</b>Schon aufs Sparkonto überwiesen?</div><div class="acts"><button class="btn ghost" type="button" data-skip="save">Ausblenden</button><button class="btn primary" type="button" data-save="${sv.rest}">Eintragen</button></div></div>`);
  for (const r of S.recurring) {
    const due = dueDate(per, r.day), key = r.id + ":" + per.start;
    if (due > today || S.skips[key] || P.some(p => p.rid === r.id && p.date >= per.start && p.date <= per.end)) continue;
    out.push(`<div class="banner"><div class="t"><b>${esc(r.name)} · ${esc(chf(r.amount))}</b>Fällig seit ${esc(fmtDay(due))}.</div><div class="acts"><button class="btn ghost" type="button" data-skip="${esc(r.id)}">Nicht diesen Monat</button><button class="btn primary" type="button" data-rec="${esc(r.id)}">Eintragen</button></div></div>`);
  }
  $("dueBanners").innerHTML = out.join("");
}

function renderCats() {
  const per = periodOf(todayIso()), cats = mode === "out" ? [...OUT, SAVE] : IN, st = stats(per), sv = saveInfo(per);
  $("entryPanel").classList.toggle("income", mode === "in");
  document.querySelectorAll("#modeSeg [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  $("entryHint").textContent = mode === "out" ? "Betrag eingeben, dann Kategorie antippen." : "Betrag eingeben, dann antippen, woher das Geld kommt.";
  $("cats").innerHTML = cats.map(c => {
    let sub = "";
    if (c.id === SAVE.id) sub = saveOn() && sv.rate > 0 ? (sv.rest > 0 ? `<small><span class="sr-only">, </span>noch ${chf(sv.rest, {bare:true})}</small>` : `<small class="good"><span class="sr-only">, </span>erledigt</small>`) : `<small class="none"><span class="sr-only">, </span>Sparziel</small>`;
    else if (mode === "out") {
      const lim = +S.limits[c.id] || 0, used = st.by[c.id] || 0;
      if (lim > 0) { const rest = lim - used; sub = rest >= 0 ? `<small><span class="sr-only">, </span>${chf(rest, {bare:true})} frei</small>` : `<small class="bad"><span class="sr-only">, </span>${chf(-rest, {bare:true})} drüber</small>`; }
      else sub = `<small class="none"><span aria-hidden="true">–</span><span class="sr-only">, nicht eingeplant</span></small>`;
    } else if (c.id === "lohn" && S.income) sub = `<small>${chf(S.income, {bare:true})}</small>`;
    return `<button class="cat" type="button" data-cat="${esc(c.id)}"><b>${esc(c.short)}</b>${sub}</button>`;
  }).join("");
}

function itemHtml(p, showDate) {
  const icon = ICON[p.category] || "•", open = p.needsCat ? `<div class="note open">Kategorie wählen</div>` : "";
  return `<button class="item" type="button" data-edit="${esc(p.id)}" aria-label="${esc(LABEL[p.category] || p.category)}, ${p.type === "in" ? "plus" : "minus"} ${esc(chf(p.amount))}${showDate ? ", " + esc(fmtDay(p.date)) : ""}${p.note ? ", " + esc(p.note) : ""}. Bearbeiten">
    <span class="ic" aria-hidden="true">${icon}</span>
    <span class="what"><div>${esc(LABEL[p.category] || p.category)}</div>${p.note ? `<div class="note">${esc(p.note)}</div>` : ""}${open}</span>
    <span class="amt ${p.type === "in" ? "in" : ""}">${p.type === "in" ? "+" : "−"}${chf(p.amount, {bare:true})}</span><span class="chev" aria-hidden="true"></span></button>`;
}
const byNewest = (a, b) => b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0);
function renderTodayList() {
  const t = todayIso(), list = P.filter(p => p.date === t).sort(byNewest);
  const out = sum(list.filter(p => isSpend(p) && p.category !== "unerfasst"));
  $("todaySum").textContent = out ? "− " + chf(out, {bare:true}) : "";
  $("todayList").innerHTML = list.length ? `<div class="list">${list.map(p => itemHtml(p)).join("")}</div>` : `<div class="empty">Heute noch nichts eingetragen.</div>`;
}

function renderToday() {
  const d = new Date();
  $("todayDate").textContent = WD[d.getDay()] + ", " + d.getDate() + ". " + MONL[d.getMonth()];
  renderBanners(); renderHero(); renderCats(); renderTodayList(); showNotice();
}

/* ---------- Render: Verlauf ---------- */
function renderVerlauf() {
  const today = todayIso(), cur = periodOf(today);
  if (!viewStart) viewStart = cur.start;
  const per = periodOf(viewStart), st = stats(per), total = budgetTotal();
  const isCur = per.start === cur.start, isPast = per.end < today, isFuture = per.start > today;
  $("periodLabel").textContent = fmtDay(per.start) + " – " + fmtDay(per.end) + " " + D(per.end).getFullYear();
  $("todayP").hidden = isCur;
  $("nextP").disabled = isFuture;
  const goal = +S.goal || 0, endBal = balanceAt(addDays(isPast ? per.end : today, 1));
  $("kpis").innerHTML = [
    ["Ausgaben", chf(st.out, {bare:true}), total && st.out > total ? "bad" : ""],
    ["Budget", total ? chf(total, {bare:true}) : "–", ""],
    [isPast ? "Kontostand Ende" : "Kontostand", chf(endBal, {bare:true}), isPast && goal ? (endBal >= goal ? "good" : "bad") : ""],
  ].map(([k, v, c]) => `<div><dt>${esc(k)}</dt><dd${c ? ` class="${c}"` : ""}>${esc(v)}</dd></div>`).join("");
  renderInsights(per, st, {today, isCur, isPast, total});
  renderBars(st, total, per);
  renderCharts(per, st, {today, isCur, total});
  const list = [...st.list].sort(byNewest);
  if (!list.length) { $("list").innerHTML = `<div class="empty">${isFuture ? "Diese Periode hat noch nicht begonnen." : "In dieser Periode sind keine Zahlungen erfasst."}</div>`; return; }
  let html = "", last = "";
  for (const p of list) {
    if (p.date !== last) {
      last = p.date; const d = D(p.date);
      const daySum = sum(list.filter(x => x.date === p.date && isSpend(x)));
      html += `<div class="dayhead"><span>${WD[d.getDay()].slice(0, 2)}, ${esc(fmtDay(p.date))}</span><span class="num">${daySum ? "− " + chf(daySum, {bare:true}) : ""}</span></div>`;
    }
    html += itemHtml(p, true);
  }
  $("list").innerHTML = `<div class="list">${html}</div>`;
}
function renderInsights(per, st, o) {
  const L = [], goal = +S.goal || 0;
  if (!st.list.length) { $("insights").innerHTML = ""; return; }
  OUT.forEach(c => {
    const lim = +S.limits[c.id] || 0, used = st.by[c.id] || 0; if (!lim) return;
    if (used > lim) L.push({c:"bad", t:`<b>${esc(c.label)}</b> liegt ${chf(used - lim)} über dem Limit.`});
    else if (!c.fixed && used >= WARN_SHARE * lim && o.isCur) L.push({c:"warn", t:`Bei <b>${esc(c.label)}</b> bleiben dir noch ${chf(lim - used)}.`});
  });
  if (o.isCur && o.total > 0) {
    const elapsed = diff(per.start, o.today) + 1, tq = elapsed / per.days, bq = (st.out - (st.by.unerfasst || 0)) / o.total;
    if (bq > tq + PACE_TOL) L.push({c:"warn", t:`Nach ${elapsed} von ${per.days} Tagen hast du ${Math.round(bq * 100)} % des Budgets gebraucht. Du bist schneller als geplant.`});
  }
  const small = st.list.filter(p => isSpend(p) && p.amount <= 10 && p.category !== "unerfasst");
  if (small.length >= 5) L.push({c:"", t:`${small.length} kleine Ausgaben bis CHF 10 ergeben zusammen <b>${chf(sum(small))}</b>.`});
  if (o.isPast && goal) { const endBal = balanceAt(addDays(per.end, 1)); L.push({c:endBal >= goal ? "good" : "bad", t:endBal >= goal ? `Ziel erreicht: ${chf(endBal - goal)} mehr als geplant.` : `Dir haben ${chf(goal - endBal)} zum Ziel gefehlt.`}); }
  if (st.by.unerfasst > 0) L.push({c:"warn", t:`${chf(st.by.unerfasst)} waren beim Abgleich nicht eingetragen. Trag Zahlungen direkt nach dem Bezahlen ein.`});
  $("insights").innerHTML = L.map(x => `<li class="${x.c}"><span>${x.t}</span></li>`).join("");
}
function renderBars(st, total, per) {
  const sv = saveInfo(per), svRate = saveOn() ? sv.rate : 0;
  if (!total && !Object.keys(st.by).length && !st.saved && !svRate) { $("bars").innerHTML = `<div class="empty">Leg unter «Mehr» Limits fest. Dann siehst du hier, wie viel pro Kategorie übrig ist.</div>`; return; }
  const cats = [...OUT, {id:"unerfasst", label:SPECIAL.unerfasst}].filter(c => (st.by[c.id] || 0) > 0 || (+S.limits[c.id] || 0) > 0);
  const max = Math.max(...Object.values(st.by), 1);
  $("bars").innerHTML = cats.map(c => {
    const used = st.by[c.id] || 0, lim = +S.limits[c.id] || 0; let cls = "", pct, extra = "";
    if (lim > 0) { const q = used / lim; pct = Math.min(q * 100, 100); cls = q > 1 ? "bad" : c.fixed ? "fix" : q >= WARN_SHARE ? "warn" : "ok"; if (q > 1) extra = ` <span class="pill bad">${chf(used - lim)} drüber</span>`; }
    else pct = used / max * 100;
    return `<div class="bar"><div class="top"><span>${esc(c.label)}${extra}</span><span class="num">${chf(used, {bare:true})}${lim > 0 ? ` <span class="muted">/ ${chf(lim, {bare:true})}</span>` : ""}</span></div><div class="track"><div class="fill ${cls}" style="width:${pct}%"></div></div></div>`;
  }).join("") + (st.saved > 0 || svRate > 0 ? `<div class="bar"><div class="top"><span>${esc(SAVE.label)}${svRate > 0 && st.saved >= svRate ? ` <span class="pill good">erledigt</span>` : ""}</span><span class="num">${chf(st.saved, {bare:true})}${svRate > 0 ? ` <span class="muted">/ ${chf(svRate, {bare:true})}</span>` : ""}</span></div><div class="track"><div class="fill good" style="width:${svRate > 0 ? Math.min(st.saved / svRate * 100, 100) : 100}%"></div></div></div>` : "");
}

/* ---------- Diagramme ---------- */
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
const axNum = v => chf(v, {bare:true}).replace(/\.00$/, "");
function svgText(x, y, t, anchor = "start", extra = "") { return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="12" fill="var(--muted)" ${extra}>${esc(t)}</text>`; }
function xLabels(days, X, lastIdx, isCur, y) {
  const n = days.length; let t = svgText(X(0), y, dShort(days[0]), "start") + svgText(X(n - 1), y, dShort(days[n - 1]), "end");
  if (isCur && lastIdx > 5 && lastIdx < n - 6) t += svgText(X(lastIdx), y, "Heute", "middle", 'font-weight="600"');
  return t;
}
function renderCharts(per, st, o) {
  const show = st.list.length > 0 && per.start <= o.today;
  $("anPanel").hidden = !show; chartData = {};
  if (!show || tab !== "verlauf") return;
  CW = Math.max(280, Math.min(600, Math.round($("chBal").clientWidth || 340)));
  const days = []; for (let d = per.start; d <= per.end; d = addDays(d, 1)) days.push(d);
  const n = days.length, lastIdx = o.isCur ? Math.min(diff(per.start, o.today), n - 1) : n - 1, goal = +S.goal || 0;
  const early = P.filter(p => p.type === "in" && p.category === "lohn" && p.date > addDays(per.end, -EARLY_PAY_DAYS) && p.date <= per.end);
  const bal = days.slice(0, lastIdx + 1).map(d => r2(balanceAt(addDays(d, 1)) - early.filter(p => p.date <= d).reduce((a, p) => a + p.amount, 0)));
  const startBal = balanceAt(per.start);
  const target = goal > 0 ? goal : (o.total > 0 ? r2(startBal - o.total) : null);
  const plan = i => target == null ? null : r2(startBal + (target - startBal) * (i + 1) / n);
  const proj = o.isCur && heroProjEnd != null && lastIdx < n - 1 ? heroProjEnd : null;
  const varDay = days.map(d => sum(st.list.filter(p => isSpend(p) && p.date === d && !isFix(p.category) && p.category !== "unerfasst")));
  const fixedLimit = OUT.filter(c => c.fixed).reduce((a, c) => a + (+S.limits[c.id] || 0), 0);
  const planDaily = o.total > 0 ? r2((o.total - fixedLimit) / n) : null;

  { // Kontostand-Verlauf
    const H = 190, ml = 50, mr = 14, mt = 16, mb = 26, iw = CW - ml - mr, ih = H - mt - mb;
    const vals = [startBal, ...bal]; if (target != null) vals.push(target); if (proj != null) vals.push(proj);
    let lo = Math.min(...vals), hi = Math.max(...vals); const step = niceStep(Math.max(hi - lo, 50) / 3);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; if (hi === lo) hi = lo + step;
    const X = i => ml + (n <= 1 ? 0 : i / (n - 1)) * iw, Y = v => mt + (hi - v) / (hi - lo) * ih;
    let g = ""; for (let v = lo; v <= hi + 1e-6; v += step) g += `<line x1="${ml}" x2="${CW - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>` + svgText(ml - 8, Y(v) + 4, axNum(v), "end");
    const planP = target != null ? `<path d="M${X(0)},${Y(plan(0))} L${X(n - 1)},${Y(target)}" fill="none" stroke="var(--neutral)" stroke-width="1.5" stroke-dasharray="5 4"/><circle cx="${X(n - 1)}" cy="${Y(target)}" r="4" fill="var(--surface)" stroke="var(--neutral)" stroke-width="2"/>` : "";
    const endLab = (v, y, col, w) => `<text x="${CW - mr}" y="${y}" text-anchor="end" font-size="12" font-weight="${w}" fill="${col}" paint-order="stroke" stroke="var(--surface)" stroke-width="4">${esc(v)}</text>`;
    let tY = target != null ? Y(target) : null, pY = proj != null ? Y(proj) : null;
    if (tY != null && pY != null && Math.abs(tY - pY) < 16) { if (pY < tY) pY = tY - 16; else tY = pY - 16; }
    const ends = (target != null ? endLab(goal > 0 ? `Ziel ${axNum(target)}` : `Plan ${axNum(target)}`, (tY > mt + ih - 14 ? tY - 8 : tY + 16), "var(--muted)", 500) : "")
      + (proj != null ? endLab(`≈ ${axNum(r2(proj))}`, (pY != null && tY != null && pY < tY ? pY - 8 : pY + 16), "var(--accent)", 600) : "");
    const line = bal.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const projP = proj != null ? `<path d="M${X(lastIdx)},${Y(bal[lastIdx])} L${X(n - 1)},${Y(proj)}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="1 4" stroke-linecap="round"/>` : "";
    const lx = X(lastIdx), ly = Y(bal[lastIdx]), anchor = lx > CW - mr - 90 ? "end" : lx < ml + 40 ? "start" : "middle";
    const dot = `<circle cx="${lx}" cy="${ly}" r="5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><text x="${lx}" y="${ly - 10}" text-anchor="${anchor}" font-size="12" font-weight="600" fill="var(--fg)" paint-order="stroke" stroke="var(--surface)" stroke-width="4">${esc(chf(bal[lastIdx], {bare:true}))}</text>`;
    const onTrack = target == null ? null : bal[lastIdx] >= plan(lastIdx), what = goal > 0 ? "dein Ziel" : "deinen Plan";
    let sub = target == null ? "Lege unter «Mehr» Budget oder Ziel fest, dann siehst du hier die Plan-Linie."
      : o.isCur ? (onTrack ? `Du liegst ${chf(bal[lastIdx] - plan(lastIdx))} über der Plan-Linie. Bleib darüber, dann schaffst du ${what}.` : `Du liegst ${chf(plan(lastIdx) - bal[lastIdx])} unter der Plan-Linie. Gib ein paar Tage weniger aus, um wieder darüber zu kommen.`)
      : `Am ${fmtDay(per.end)} waren es ${chf(bal[n - 1])}, ${goal > 0 ? "Ziel" : "Plan"} war ${chf(target)}.`;
    if (early.length) sub += ` Ohne den Lohn vom ${fmtDay(early[0].date)}.`;
    $("chBal").innerHTML = `<figcaption><h3>Kontostand bis zum Lohn</h3><div class="sub">${esc(sub)}</div></figcaption>
      <svg viewBox="0 0 ${CW} ${H}" data-ch="bal" role="img" aria-label="Kontostand vom ${esc(fmtDay(per.start))} bis ${o.isCur ? "heute" : esc(fmtDay(per.end))}: ${esc(chf(bal[lastIdx]))}.${target != null ? ` ${goal > 0 ? "Ziel" : "Plan"} am ${esc(fmtDay(per.end))}: ${esc(chf(target))}.` : ""}${proj != null ? ` Prognose: ${esc(chf(proj))}.` : ""}">
        ${g}${planP}${projP}
        <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
        ${dot}${ends}${xLabels(days, X, lastIdx, o.isCur, H - 6)}
        <line class="cross" x1="0" x2="0" y1="${mt}" y2="${mt + ih}" stroke="var(--muted)" opacity="0"/>
        <circle class="crossdot" r="4" fill="var(--accent)" stroke="var(--surface)" stroke-width="2" opacity="0"/>
        <rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>
      <ul class="legend">
        <li><svg viewBox="0 0 22 10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round"/></svg>Kontostand</li>
        ${target != null ? `<li><svg viewBox="0 0 22 10" aria-hidden="true"><line x1="1" x2="21" y1="5" y2="5" stroke="var(--neutral)" stroke-width="2" stroke-dasharray="5 4"/></svg>${goal > 0 ? "Plan bis zum Ziel" : "Plan nach Budget"}</li>` : ""}
        ${proj != null ? `<li><svg viewBox="0 0 22 10" aria-hidden="true"><line x1="2" x2="20" y1="5" y2="5" stroke="var(--accent)" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/></svg>Prognose</li>` : ""}
      </ul>`;
    chartData.bal = {mt, max:lastIdx, cx:X, cy:i => Y(bal[i]), idx:sx => Math.round((sx - ml) / iw * (n - 1)),
      tip:i => { const d = target != null ? r2(bal[i] - plan(i)) : null; return `<b>${esc(dShort(days[i]))}</b><br>Kontostand ${esc(chf(bal[i]))}${target != null ? `<br>Plan ${esc(chf(plan(i)))}<br>${d >= 0 ? esc(chf(d)) + " über Plan" : esc(chf(-d)) + " unter Plan"}` : ""}`; }};
  }
  { // Ausgaben pro Tag
    const H = 170, ml = 50, mr = 14, mt = 18, mb = 26, iw = CW - ml - mr, ih = H - mt - mb, slot = iw / n, bw = Math.max(slot - 2, 2);
    const vmax = Math.max(...varDay, planDaily || 0, 5), step = niceStep(vmax / 2.5), hi = Math.ceil(vmax / step) * step;
    const Y = v => mt + (hi - v) / hi * ih, X = i => ml + (i + .5) * slot;
    let g = ""; for (let v = 0; v <= hi + 1e-6; v += step) g += `<line x1="${ml}" x2="${CW - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>` + svgText(ml - 8, Y(v) + 4, axNum(v), "end");
    const r = Math.min(3, bw / 2);
    const bars = varDay.map((v, i) => { if (i > lastIdx || v <= 0) return ""; const x = ml + i * slot + (slot - bw) / 2, y = Y(v), h = Y(0) - y, rr = Math.min(r, h);
      return `<path d="M${x},${Y(0)} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + bw - rr} Q${x + bw},${y} ${x + bw},${y + rr} V${Y(0)} Z" fill="${planDaily && v > planDaily ? "var(--warn-fill)" : "var(--accent)"}"/>`; }).join("");
    const ref = planDaily ? `<line x1="${ml}" x2="${CW - mr}" y1="${Y(planDaily)}" y2="${Y(planDaily)}" stroke="var(--neutral)" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${CW - mr}" y="${Y(planDaily) - 5}" text-anchor="end" font-size="12" fill="var(--muted)" paint-order="stroke" stroke="var(--surface)" stroke-width="4">Plan ${esc(chf(planDaily, {bare:true}))}</text>` : "";
    const spent = varDay.slice(0, lastIdx + 1), active = spent.filter(v => v > 0).length, avg = r2(spent.reduce((a, v) => a + v, 0) / (lastIdx + 1));
    const over = planDaily ? spent.filter(v => v > planDaily).length : 0;
    const sub = `Im Schnitt ${chf(avg)} pro Tag${planDaily ? `, geplant sind ${chf(planDaily)}` : ""}.${planDaily && over ? ` An ${over} ${over === 1 ? "Tag" : "Tagen"} warst du darüber.` : ""} Ohne Fixkosten.`;
    $("chDay").innerHTML = `<figcaption><h3>Ausgaben pro Tag</h3><div class="sub">${esc(sub)}</div></figcaption>
      <svg viewBox="0 0 ${CW} ${H}" data-ch="day" role="img" aria-label="Ausgaben pro Tag, im Schnitt ${esc(chf(avg))}, an ${active} von ${lastIdx + 1} Tagen etwas ausgegeben.">
        ${g}${bars}${ref}${xLabels(days, X, lastIdx, o.isCur, H - 6)}
        <line class="cross" x1="0" x2="0" y1="${mt}" y2="${mt + ih}" stroke="var(--muted)" opacity="0"/>
        <rect x="${ml}" y="${mt}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>
      ${planDaily ? `<ul class="legend"><li><svg viewBox="0 0 22 10" aria-hidden="true"><rect x="6" y="0" width="10" height="10" rx="2" fill="var(--accent)"/></svg>Im Plan</li><li><svg viewBox="0 0 22 10" aria-hidden="true"><rect x="6" y="0" width="10" height="10" rx="2" fill="var(--warn-fill)"/></svg>Über Plan</li></ul>` : ""}`;
    chartData.day = {mt, max:lastIdx, cx:X, idx:sx => Math.floor((sx - ml) / slot),
      tip:i => `<b>${esc(dShort(days[i]))}</b><br>${varDay[i] > 0 ? `Ausgegeben ${esc(chf(varDay[i]))}` : "Nichts ausgegeben"}${planDaily && varDay[i] > planDaily ? `<br>${esc(chf(varDay[i] - planDaily))} über Plan` : ""}`};
  }
  const rows = days.slice(0, lastIdx + 1).map((d, i) => `<tr><td>${esc(dShort(d))}</td><td>${esc(chf(varDay[i], {bare:true}))}</td><td>${esc(chf(bal[i], {bare:true}))}</td>${target != null ? `<td>${esc(chf(r2(bal[i] - plan(i)), {bare:true, sign:true}))}</td>` : ""}</tr>`).reverse().join("");
  $("chTableBody").innerHTML = `<table><caption class="sr-only">Ausgaben ohne Fixkosten und Kontostand pro Tag, neueste zuerst</caption><thead><tr><th>Tag</th><th>Ausgaben</th><th>Kontostand</th>${target != null ? "<th>zum Plan</th>" : ""}</tr></thead><tbody>${rows}</tbody></table>`;
}
function hideTip() { $("tip").hidden = true; document.querySelectorAll("svg[data-ch] .cross,svg[data-ch] .crossdot").forEach(e => e.setAttribute("opacity", "0")); }
function chartHover(ev) {
  const svg = ev.target.closest && ev.target.closest("svg[data-ch]"); if (!svg) { hideTip(); return; }
  const cd = chartData[svg.dataset.ch]; if (!cd) return;
  const r = svg.getBoundingClientRect(), k = r.width / CW;
  const i = Math.max(0, Math.min(cd.max, cd.idx((ev.clientX - r.left) / k))), x = cd.cx(i);
  const cross = svg.querySelector(".cross"); cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("opacity", "1");
  const dot = svg.querySelector(".crossdot"); if (dot && cd.cy) { dot.setAttribute("cx", x); dot.setAttribute("cy", cd.cy(i)); dot.setAttribute("opacity", "1"); }
  const tip = $("tip"); tip.innerHTML = cd.tip(i); tip.hidden = false;
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + x * k - tw / 2; left = Math.max(8, Math.min(window.innerWidth - tw - 8, left));
  const py = cd.cy ? r.top + cd.cy(i) * k : r.top + cd.mt * k;
  let top = py - th - 14; if (top < 8) top = r.top - th - 6; if (top < 8) top = 8;
  tip.style.left = left + "px"; tip.style.top = top + "px";
}

/* ---------- Sparziel Auto ---------- */
function carPlan() {
  const target = r2(C.price + C.reserve), sv = saveInfo(periodOf(todayIso())), saved = savedTotal();
  const rows = [0, 1, 2].map(() => ({sum:0}));
  let total = saved, reach = saved >= target && target > 0 ? {k:null, yr:-1} : null;
  const step = (k, yr, amount) => {
    if (yr < 0 || yr > 2 || !(amount > 0)) return;
    rows[yr].sum = r2(rows[yr].sum + amount); total = r2(total + amount);
    if (!reach && target > 0 && total >= target) reach = {k, yr};
  };
  step(sv.k, sv.yr, sv.rest); // offene Rate der laufenden Periode
  const endK = sv.s0 + 35;
  for (let k = Math.max(sv.k + 1, sv.s0); k <= endK; k++) { const yr = Math.floor((k - sv.s0) / 12); step(k, yr, +C.rates[yr] || 0); }
  return {target, rows, saved, end:total, reach, nowYr:sv.yr, sv, endLabel:MONL[endK % 12] + " " + Math.floor(endK / 12)};
}
function renderCar() {
  const p = carPlan(), sv = p.sv, pct = p.target > 0 ? Math.min(Math.max(p.saved, 0) / p.target, 1) : 0, tick = p.target > 0 ? Math.min(C.price / p.target, 1) : 0;
  const pill = $("carPill"); pill.className = "pill " + (carStored ? "good" : "neutral"); pill.textContent = carStored ? "Dein Plan" : "Vorschlag";
  let when;
  if (p.reach && p.reach.k === null) when = `<dd class="good">schon erreicht</dd>`;
  else if (p.reach) when = `<dd class="wrap">${MONL[p.reach.k % 12]} ${Math.floor(p.reach.k / 12)} · ${p.reach.yr + 1}. Lehrjahr</dd>`;
  else if (p.target <= 0) when = `<dd>kein Ziel gesetzt</dd>`;
  else when = `<dd class="warn wrap">nicht bis Lehrende, es fehlen ${chf(p.target - p.end)}</dd>`;
  const int = n => chf(Math.round(n), {bare:true}).replace(/\.00$/, "");
  const amt = n => chf(n, {bare:true}).replace(/\.00$/, "");
  const rows = p.rows.map((r, i) => { const w = +C.wages[i] || 0, rate = +C.rates[i] || 0, share = w > 0 ? Math.round(rate / w * 100) + " %" : "–";
    return `<tr class="${i === p.nowYr ? "now" : ""}"><td>${i + 1}. Jahr${i === p.nowYr ? ' <span class="nowtag">jetzt</span>' : ""}</td><td>${int(rate)}</td><td>${share}</td><td>${int(r.sum)}</td></tr>`; }).join("");
  // Was in dieser Periode zu tun ist
  let action;
  if (!carStored) action = `<div class="cta"><p>Das ist erst ein Vorschlag. Übernimmst du ihn, reserviert die App jeden Monat die Sparrate in deinem Tagesbudget${sv.rate > 0 ? `, im Moment <b>CHF ${amt(sv.rate)}</b>` : ""}. Die Zahlen kannst du unten anpassen.</p><button class="btn primary" id="cAdopt" type="button">Plan übernehmen</button></div>`;
  else if (sv.rate <= 0) action = "";
  else if (sv.rest > 0) action = `<div class="cta"><p><b>Diese Periode:</b> CHF ${amt(sv.done)} von ${amt(sv.rate)} aufs Sparkonto überwiesen.${C.inBudget ? ` CHF ${amt(sv.rest)} sind in deinem Tagesbudget reserviert.` : ""}</p><button class="btn primary" id="cAdd" type="button">CHF ${amt(sv.rest)} überwiesen, eintragen</button></div>`;
  else action = `<div class="cta done"><p><b>Diese Periode erledigt.</b> CHF ${amt(sv.done)} sind auf dem Sparkonto.</p></div>`;
  $("carBody").innerHTML = `
    <div class="goalname">${esc(C.name)}</div>
    <div class="saved">${chf(p.saved)}<span class="of">von CHF ${int(p.target)} gespart · ${Math.round(pct * 100)} %</span></div>
    <div class="stack" style="gap:6px">
      <div class="track" role="img" aria-label="${Math.round(pct * 100)} Prozent vom Sparziel erreicht"><div class="fill" style="width:${(pct * 100).toFixed(1)}%"></div>${p.target > 0 && C.reserve > 0 ? `<div class="tick" style="left:calc(${(tick * 100).toFixed(1)}% - 1px)"></div>` : ""}</div>
      <div class="cap"><span>Strich = Autopreis ${int(C.price)}</span><span>+ Reserve ${int(C.reserve)}</span></div>
    </div>
    ${action}
    <dl class="facts">
      <div><dt>Voraussichtlich erreicht</dt>${when}</div>
      <div><dt>Gespart bei Lehrende (${p.endLabel})</dt><dd>${chf(p.end)}</dd></div>
    </dl>
    <div class="tablewrap" role="region" aria-label="Sparplan pro Lehrjahr" tabindex="0"><table>
      <thead><tr><th>Lehrjahr</th><th>Pro Monat</th><th>%</th><th>Noch geplant</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Jede Überweisung, die du unter «Heute» als <b>Sparen</b> einträgst, zählt hier automatisch mit. Sie gilt nicht als Ausgabe, senkt aber deinen Kontostand, damit der Abgleich mit der Bank-App stimmt. Die Reserve deckt Versicherung, Service und Benzin für die ersten Monate.</p>`;
  const add = $("cAdd");
  if (add) add.onclick = () => addEntry({amount:sv.rest, type:"out", category:SAVE.id, date:todayIso(), note:""}, {refill:false});
  const adopt = $("cAdopt");
  if (adopt) adopt.onclick = () => { carStored = true; save(); renderAll(); fillCar();
    toast(sv.rate > 0 ? `Plan übernommen. CHF ${amt(sv.rest)} sind jetzt im Tagesbudget reserviert.` : "Plan übernommen.", {undo:() => { carStored = false; save(); renderAll(); }}); };
}
function fillCar() {
  $("cName").value = C.name; $("cPrice").value = C.price; $("cReserve").value = C.reserve; $("cSaved").value = savedTotal(); $("cStart").value = C.start; $("cInBudget").checked = C.inBudget;
  [0, 1, 2].forEach(i => { $("cW" + i).value = C.wages[i]; $("cR" + i).value = C.rates[i]; });
}

/* ---------- Mehr: Einstellungen ---------- */
function fillSettings() {
  $("sBal").value = S.startBalance ? S.startBalance.toFixed(2) : ""; $("sDate").value = S.startDate || "";
  $("sGoal").value = S.goal ? r2(S.goal + (+S.income || 0)).toFixed(2) : ""; $("sInc").value = S.income || ""; $("sDay").value = payday();
  $("limitFields").innerHTML = OUT.map(c => `<label class="field"><span class="flabel">${esc(c.label)}</span><input id="lim_${esc(c.id)}" type="text" inputmode="decimal" placeholder="kein Limit" value="${esc(S.limits[c.id] || "")}"></label>`).join("");
}
function renderRecurring() {
  $("recList").innerHTML = S.recurring.length ? S.recurring.map(r => `<div class="reci"><span class="n">${esc(r.name)}<small>jeden Monat am ${r.day}. · Fixkosten</small></span><span class="num">${chf(r.amount, {bare:true})}</span><button class="rm" type="button" data-rmrec="${esc(r.id)}" aria-label="${esc(r.name)} entfernen">×</button></div>`).join("") : "";
}
function renderMerchants() {
  const e = Object.entries(M).sort((a, b) => a[0].localeCompare(b[0]));
  $("merList").innerHTML = e.length ? e.map(([k, v]) => `<div class="merrow"><span>${esc(k)}</span><span class="muted">${esc((OUT.find(c => c.id === v) || {}).short || v)}</span><button class="rm" type="button" data-rmmer="${esc(k)}" aria-label="${esc(k)} vergessen">×</button></div>`).join("") : `<div class="empty">Noch keine Läden gemerkt.</div>`;
}
function renderMehr() {
  renderRecurring(); renderMerchants();
  $("bakInfo").textContent = `Deine Daten sind nur auf diesem Gerät gespeichert (${P.length} Zahlungen). ${lastBackup ? "Letztes Backup: " + new Date(lastBackup).toLocaleDateString("de-CH") + "." : "Noch kein Backup gemacht."} Speichere es z. B. in iCloud Drive.`;
  $("appVersion").textContent = "Version " + APP_VERSION;
}

/* ---------- Apple Pay ---------- */
const AP_RULES = [
  ["essen", /migros|coop|denner|aldi|lidl|volg|\bspar\b|k.?kiosk|valora|avec|kantine|mensa|restaurant|pizz|burger|mc ?donald|starbucks|subway|kebab|d[öo ]ner|b[äa ]ck|bakery|caf(?:[eé]|\b)|tibits|holy cow|five guys|kfc|sushi|take ?away|selecta|migrolino|pronto|brezel|food|imbiss|bistro/i],
  ["kleider", /\bh ?[& ]? ?m\b|zara|zalando|snipes|bershka|pull ?[& ]? ?bear|manor|globus|\bc ?[& ]? ?a\b|uniqlo|nike|adidas|foot ?locker|jd sports|ochsner|v[öo ]gele|tally|primark|about you|dosenbach|jelmoli|new yorker|vans|levi/i],
  ["freizeit", /kino|path(?:[eé]|\b)|cinema|kitag|\bbar\b|club|steam|playstation|xbox|nintendo|bowling|ticketcorner|eventim|museum|escape|minigolf|billard|lasertag|arcade/i],
  ["handy", /swisscom|\bsalt\b|sunrise|wingo|yallo|mobiliar|\baxa\b|helsana|\bcss\b|spotify|netflix|disney|icloud|apple\.com|youtube premium/i],
];
const merchKey = m => String(m || "").toLowerCase().replace(/[^a-z0-9äöüéèàç&]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
function guessCat(merchant) {
  const k = merchKey(merchant); if (!k) return null;
  if (M[k]) return M[k];
  for (const [id, re] of AP_RULES) if (re.test(merchant)) return id;
  return null;
}
function pickedCat(v) { if (!v) return null; const t = v.toLowerCase(); const c = OUT.find(c => c.id === t || c.short.toLowerCase() === t); return c ? c.id : null; }
function parseAmount(s) {
  let a = String(s || "").replace(/[^\d.,'’_]/g, "").replace(/['’]/g, "");
  a = a.replace(/(\d)\.(?=\d{3}_\d{2}(?!\d))/g, "$1").replace(/(\d)_(?=\d{3}(?!\d))/g, "$1").replace(/_/g, ".");
  if (a.includes(",") && a.includes(".")) a = a.indexOf(",") < a.indexOf(".") ? a.replace(/,/g, "") : a.replace(/\./g, "").replace(",", ".");
  else a = a.replace(",", ".");
  const n = /(\d+)(?:\.(\d{1,2}))?(?!\d)/.exec(a);
  return n ? r2(parseFloat(n[1] + "." + (n[2] || "0").padEnd(2, "0"))) : NaN;
}
// Format: ap-<JJJJMMTTHHMMSS>-<Betrag>-<Händler> oder apc-<Kategorie>-<...>; Rückerstattung mit "--" vor dem Betrag
function parseAp(line) {
  let h = String(line || "").trim();
  const hashAt = h.indexOf("#ap"); if (hashAt >= 0) h = h.slice(hashAt + 1);
  try { h = decodeURIComponent(h); } catch {}
  const mm = /^ap(?:c-([A-Za-zäöü]+))?-(\d{12,14})-(-?)([^\d-]*[-−]?[^\d-]*\d[\d'’.,_]*[^-]*)-?(.*)$/i.exec(h); if (!mm) return null;
  const ts = mm[2].padEnd(14, "0"), d = `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;
  const amount = parseAmount(mm[4]), refund = mm[3] === "-" || /[-−]\s*\d/.test(mm[4]);
  const date = isDate(d) && iso(D(d)) === d && d <= todayIso() && d > "2000-01-01" ? d : todayIso();
  return {id:"ap-" + ts + "-" + (Number.isFinite(amount) ? Math.round(amount * 100) : 0), amount, date, refund, picked:pickedCat(mm[1]),
    merchant:mm[5].replace(/_+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60)};
}
function ingestAp(ap) {
  if (!(ap.amount > 0)) return {status:"bad"};
  const ex = P.find(p => p.id === ap.id);
  if (ex) return {status:"dup", p:ex};
  if (apSeen.has(ap.id)) return {status:"deleted"};
  const cat = ap.refund ? "rueckerstattung" : (ap.picked || guessCat(ap.merchant) || "sonstiges"), refundOf = ap.refund ? (guessCat(ap.merchant) || "sonstiges") : null;
  const known = ap.refund || !!ap.picked || cat !== "sonstiges" || !!M[merchKey(ap.merchant)];
  const p = cleanPayment({id:ap.id, amount:ap.amount, type:ap.refund ? "in" : "out", category:cat, date:ap.date, note:ap.merchant ? "Apple Pay · " + ap.merchant : "Apple Pay", source:"applepay", merchant:ap.merchant, refundOf, needsCat:!known, createdAt:Date.now()});
  P = [...P, p]; apSeen.add(p.id);
  return {status:"new", p, known};
}
function handleApText(text, {fromHash=false} = {}) {
  const lines = String(text || "").split(/[\r\n]+/).map(parseAp).filter(Boolean);
  if (!lines.length) { if (!fromHash) toast("In der Zwischenablage ist keine Apple-Pay-Zahlung. Sie muss mit «ap-» beginnen.", {err:true}); return; }
  const res = lines.map(ingestAp);
  if (res.some(r => r.status === "new")) save();
  renderAll();
  const news = res.filter(r => r.status === "new");
  if (lines.length === 1) {
    const r = res[0];
    if (r.status === "bad") { toast("Zahlung erkannt, aber ohne gültigen Betrag. Trag sie bitte von Hand ein.", {err:true}); return; }
    if (r.status === "deleted") { toast("Diese Zahlung hattest du schon gelöscht. Sie wird nicht nochmals eingetragen."); return; }
    apState = {id:r.p.id, dup:r.status === "dup", unknown:r.status === "new" && !r.known};
    renderAp(true); return;
  }
  const unknown = news.find(r => !r.known);
  toast(`${news.length} von ${lines.length} Zahlungen eingetragen.${res.length - news.length ? " Der Rest war schon da." : ""}`);
  if (unknown) { apState = {id:unknown.p.id, unknown:true}; renderAp(true); }
}
function renderAp(focus) {
  const box = $("apBox"), p = apState && P.find(x => x.id === apState.id);
  if (!apState || (!p && !apState.deleted)) { box.hidden = true; return; }
  box.hidden = false;
  if (apState.deleted) {
    $("apTitle").textContent = "Apple Pay"; $("apAmt").innerHTML = ""; $("apStatus").textContent = "Zahlung gelöscht.";
    $("apBody").innerHTML = `<div class="row between"><span></span><button class="btn primary" type="button" data-apclose>Schliessen</button></div>`;
    return;
  }
  const refund = p.type === "in", lab = (OUT.find(c => c.id === p.category) || {}).short || LABEL[p.category];
  $("apTitle").textContent = (refund ? "Rückerstattung über Apple Pay" : "Apple Pay") + (p.merchant ? " · " + p.merchant : "");
  $("apAmt").className = "ap-amt num" + (refund ? " in" : "");
  $("apAmt").innerHTML = `<span class="cur">CHF</span>${esc((refund ? "+" : "") + chf(p.amount, {bare:true}))}`;
  $("apStatus").innerHTML = refund ? `Gespeichert als <b>Rückerstattung</b>.`
    : apState.dup ? `War schon gespeichert als <b>${esc(lab)}</b>.`
    : apState.unknown ? `Den Laden kenne ich noch nicht. <b>Wähl die Kategorie</b>, dann merke ich ihn mir.`
    : `Gespeichert als <b>${esc(lab)}</b>.`;
  $("apBody").innerHTML = (refund ? "" : `<div class="flabel" id="apCatLab">${apState.unknown ? "Kategorie" : "Falsch? Andere Kategorie wählen"}</div>
    <div class="chips" role="group" aria-labelledby="apCatLab">${OUT.map(c => `<button class="chip" type="button" data-apcat="${esc(c.id)}" aria-pressed="${!apState.unknown && c.id === p.category}">${esc(c.short)}</button>`).join("")}</div>`)
    + `<div class="row between"><button class="linkbtn danger" type="button" data-apdel>Löschen</button><button class="btn primary" type="button" data-apclose>${apState.unknown ? "Später" : "Fertig"}</button></div>`;
  if (focus) { $("apTitle").focus(); box.scrollIntoView({block:"start", behavior:"smooth"}); }
}
async function pasteAp() {
  let text = "";
  try { text = await navigator.clipboard.readText(); }
  catch { text = window.prompt("Füge hier die Apple-Pay-Zahlung ein (beginnt mit «ap-»):") || ""; if (!text) return; }
  if (tab !== "heute") switchTab("heute");
  handleApText(text);
}

/* ---------- Bearbeiten ---------- */
function editCats() {
  const p = P.find(x => x.id === editId), cur = $("eCats").dataset.sel;
  const base = editMode === "out" ? [...OUT, SAVE] : IN;
  const list = [...base.map(c => ({id:c.id, short:c.short}))];
  if (p && !list.some(c => c.id === p.category) && SPECIAL[p.category] && (p.type === "in") === (editMode === "in")) list.push({id:p.category, short:SPECIAL[p.category]});
  const sel = list.some(c => c.id === cur) ? cur : list[0].id;
  $("eCats").dataset.sel = sel;
  $("eCats").innerHTML = list.map(c => `<button class="chip" type="button" data-ecat="${esc(c.id)}" aria-pressed="${c.id === sel}">${esc(c.short)}</button>`).join("");
  document.querySelectorAll("#eModeSeg [data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === editMode)));
}
function openEdit(id) {
  const p = P.find(x => x.id === id); if (!p) return;
  editId = id; editMode = p.type;
  $("eAmount").value = p.amount.toFixed(2); $("eDate").value = p.date; $("eDate").max = todayIso(); $("eNote").value = p.note || ""; $("eMsg").textContent = "";
  $("eCats").dataset.sel = p.category; editCats();
  const dlg = $("editDlg");
  if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
}
function refocus(id) { const el = document.querySelector(`.view:not([hidden]) [data-edit="${CSS.escape(id || "")}"]`); if (el) el.focus({preventScroll:true}); }
function closeEdit() { const dlg = $("editDlg"); if (dlg.open) dlg.close(); }

/* ---------- Navigation ---------- */
function switchTab(t) {
  tab = t; hideTip();
  document.querySelectorAll(".view").forEach(v => v.hidden = v.id !== "v-" + t);
  document.querySelectorAll(".tabbar [data-tab]").forEach(b => { if (b.dataset.tab === t) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  window.scrollTo(0, 0);
  const h = $("t-" + t); if (h && document.activeElement && document.activeElement.closest(".tabbar")) { h.setAttribute("tabindex", "-1"); h.focus({preventScroll:true}); }
  if (t === "verlauf") renderVerlauf();
  if (t === "mehr") { fillSettings(); renderMehr(); }
  if (t === "sparen") { renderCar(); if (!$("carEdit").open) fillCar(); }
  try { sessionStorage.setItem("lb-tab", t); } catch {}
}
function renderAll() {
  renderToday();
  if (tab === "verlauf") renderVerlauf();
  if (tab === "sparen") renderCar();
  if (tab === "mehr") renderMehr();
  renderAp();
}
function syncDayChips() {
  const v = $("fDate").value, t = todayIso();
  document.querySelectorAll(".chip[data-day]").forEach(c => c.setAttribute("aria-pressed", String(v === addDays(t, +c.dataset.day))));
  const label = !v || v === t ? "Heute" : v === addDays(t, -1) ? "Gestern" : fmtDay(v);
  $("moreSum").classList.toggle("otherday", !!v && v !== t); $("moreSum").querySelector(".day").textContent = label;
}

/* ---------- Events ---------- */
function bind() {
  document.querySelector(".tabbar").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) switchTab(b.dataset.tab); });

  // Eintragen
  $("modeSeg").addEventListener("click", e => { const m = e.target.closest("[data-mode]"); if (!m) return; mode = m.dataset.mode; renderCats(); });
  $("fAmount").addEventListener("input", () => $("fAmount").removeAttribute("aria-invalid"));
  $("cats").addEventListener("click", e => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    let amount = parseAmt($("fAmount").value);
    if (!$("fAmount").value.trim() && b.dataset.cat === "lohn" && S.income > 0) amount = S.income;
    // Ohne Betrag auf «Sparen»: die offene Sparrate dieser Periode
    if (!$("fAmount").value.trim() && b.dataset.cat === SAVE.id && saveOn()) { const sv = saveInfo(periodOf(todayIso())); if (sv.rest > 0) amount = sv.rest; }
    if (!(amount > 0)) { $("fAmount").setAttribute("aria-invalid", "true"); toast($("fAmount").value.trim() ? "Betrag nicht erkannt. Schreib ihn so: 12.50" : "Gib zuerst einen Betrag ein, z. B. 12.50.", {err:true}); $("fAmount").focus(); return; }
    const date = $("fDate").value || todayIso();
    if (date > todayIso()) { toast("Das Datum liegt in der Zukunft. Wähl heute oder einen Tag davor.", {err:true}); $("moreBox").open = true; return; }
    if (addEntry({amount, type:mode, category:b.dataset.cat, date, note:$("fNote").value.trim()})) {
      $("fAmount").value = ""; $("fNote").value = ""; $("fDate").value = todayIso(); syncDayChips(); $("moreBox").open = false;
      if (mode === "in") { mode = "out"; renderCats(); }
      $("fAmount").blur();
    }
  });
  document.querySelectorAll(".chip[data-day]").forEach(c => c.onclick = () => { $("fDate").value = addDays(todayIso(), +c.dataset.day); syncDayChips(); });
  $("fDate").addEventListener("change", syncDayChips);

  // Details in der Hero-Karte: offen oder zu merken
  try { $("heroMore").open = localStorage.getItem("lb-more") === "1"; } catch {}
  $("heroMore").addEventListener("toggle", () => { try { localStorage.setItem("lb-more", $("heroMore").open ? "1" : "0"); } catch {} });

  // Banner
  $("dueBanners").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const per = periodOf(todayIso());
    if (b.hasAttribute("data-lohn")) addEntry({amount:S.income, type:"in", category:"lohn", date:isDate(b.dataset.lohn) ? b.dataset.lohn : per.start, note:""});
    else if (b.dataset.save) addEntry({amount:+b.dataset.save, type:"out", category:SAVE.id, date:todayIso(), note:""}, {refill:false});
    else if (b.dataset.rec) { const r = S.recurring.find(x => x.id === b.dataset.rec); if (r) addEntry({amount:r.amount, type:"out", category:"handy", date:dueDate(per, r.day), note:r.name, rid:r.id}); }
    else if (b.dataset.skip) { const key = b.dataset.skip + ":" + per.start; S.skips[key] = true; save(); renderAll();
      toast("Für diese Periode ausgeblendet.", {undo:() => { delete S.skips[key]; save(); renderAll(); }}); }
  });

  // Listen → Bearbeiten
  document.addEventListener("click", e => { const it = e.target.closest("[data-edit]"); if (it) openEdit(it.dataset.edit); });
  $("eModeSeg").addEventListener("click", e => { const m = e.target.closest("[data-mode]"); if (!m) return; editMode = m.dataset.mode; editCats(); });
  $("eCats").addEventListener("click", e => { const c = e.target.closest("[data-ecat]"); if (!c) return; $("eCats").dataset.sel = c.dataset.ecat; editCats(); });
  $("eSave").onclick = () => {
    const amount = parseAmt($("eAmount").value), date = $("eDate").value;
    if (!(amount > 0)) { $("eMsg").textContent = "Betrag nicht erkannt. Schreib ihn so: 12.50"; $("eAmount").focus(); return; }
    if (!isDate(date) || date > todayIso()) { $("eMsg").textContent = "Wähl ein Datum bis heute."; $("eDate").focus(); return; }
    const old = P.find(x => x.id === editId); if (!old) { closeEdit(); return; }
    const upd = {...old, amount, date, type:editMode, category:$("eCats").dataset.sel, note:$("eNote").value.trim().slice(0, 80)}; delete upd.needsCat;
    if (old.merchant && upd.type === "out" && upd.category !== old.category && OUT.some(c => c.id === upd.category)) M[merchKey(old.merchant)] = upd.category;
    P = P.map(x => x.id === editId ? upd : x); save(); closeEdit(); renderAll(); refocus(old.id);
    toast("Gespeichert.", {undo:() => { P = P.map(x => x.id === old.id ? old : x); save(); renderAll(); }});
  };
  $("eDel").onclick = () => { const id = editId; closeEdit(); removeEntry(id); const h = tab === "verlauf" ? $("listTitle") : $("todayListTitle"); h.setAttribute("tabindex", "-1"); h.focus({preventScroll:true}); };
  $("editDlg").addEventListener("cancel", () => setTimeout(() => refocus(editId), 0));
  $("editForm").addEventListener("submit", () => setTimeout(() => refocus(editId), 0));
  $("editDlg").addEventListener("click", e => { if (e.target === $("editDlg")) closeEdit(); });

  // Abgleich: Rückmeldung bei Escape aus Liste etc.
  document.addEventListener("keydown", e => { if (e.key === "Escape") hideTip(); });

  // Verlauf
  $("prevP").onclick = () => { viewStart = shiftPeriod(viewStart, -1); renderVerlauf(); };
  $("nextP").onclick = () => { viewStart = shiftPeriod(viewStart, 1); renderVerlauf(); };
  $("todayP").onclick = () => { viewStart = periodOf(todayIso()).start; renderVerlauf(); $("prevP").focus(); };
  $("anPanel").addEventListener("pointermove", e => { if (e.pointerType === "mouse") chartHover(e); });
  $("anPanel").addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hideTip(); });
  document.addEventListener("click", e => { if (e.target.closest && e.target.closest("svg[data-ch]")) chartHover(e); else hideTip(); });
  window.addEventListener("scroll", hideTip, {passive:true});
  let resizeT; window.addEventListener("resize", () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (tab === "verlauf") renderVerlauf(); }, 150); });

  // Apple Pay
  $("apPasteTop").onclick = pasteAp;
  $("apPaste").onclick = pasteAp;
  $("apBox").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b || !apState) return;
    if (b.hasAttribute("data-apclose")) { apState = null; renderAp(); $("heroLabel").scrollIntoView({block:"start"}); return; }
    if (b.dataset.apcat) {
      const c = b.dataset.apcat, p = P.find(x => x.id === apState.id); if (!p) return;
      P = P.map(x => x.id === p.id ? (({needsCat, ...r}) => ({...r, category:c}))(x) : x);
      if (p.merchant) M[merchKey(p.merchant)] = c;
      save(); apState = {...apState, unknown:false, dup:false}; renderAll();
      toast(`Als ${esc((OUT.find(o => o.id === c) || {}).short)} gespeichert.${p.merchant ? " Laden gemerkt." : ""}`);
      return;
    }
    if (b.hasAttribute("data-apdel")) { const id = apState.id, old = P.find(x => x.id === id); P = P.filter(x => x.id !== id); save(); apState = null; renderAll();
      toast("Zahlung gelöscht.", {undo:() => { if (old) { P = [...P, old]; save(); apState = {id}; renderAll(); } }}); $("heroLabel").scrollIntoView({block:"start"}); }
  });
  window.addEventListener("hashchange", () => { if (/#ap/i.test(location.hash)) { const h = location.hash; clearHash(); handleApText(h, {fromHash:true}); } });

  // Sparziel
  $("cSave").onclick = () => {
    const m = $("cMsg"); m.textContent = ""; m.className = "status";
    document.querySelectorAll("#carEdit [aria-invalid]").forEach(e => e.removeAttribute("aria-invalid"));
    const num = id => { const v = $(id).value.trim(); return v === "" ? 0 : parseAmt(v); };
    const bad = ["cPrice","cReserve","cSaved","cW0","cW1","cW2","cR0","cR1","cR2"].find(id => Number.isNaN(num(id)));
    if (bad) { const f = $(bad); f.setAttribute("aria-invalid", "true"); f.focus(); m.className = "status err"; m.textContent = `«${f.previousElementSibling.textContent}» ist keine Zahl. Beispiel: 350`; return; }
    C = {name:$("cName").value.trim() || CAR_DEF.name, price:num("cPrice"), reserve:num("cReserve"), saved:r2(num("cSaved") - savedPays()), inBudget:$("cInBudget").checked, start:/^\d{4}-\d{2}$/.test($("cStart").value) ? $("cStart").value : CAR_DEF.start,
      wages:[0, 1, 2].map(i => num("cW" + i)), rates:[0, 1, 2].map(i => num("cR" + i))};
    carStored = true; save(); renderAll(); $("carEdit").open = false; toast("Sparplan gespeichert.");
  };

  // Einstellungen
  $("sBal").addEventListener("input", () => { $("sDate").value = todayIso(); });
  $("saveSettings").onclick = () => {
    const m = $("setMsg"); m.className = "status err";
    const num = id => { const v = $(id).value.trim(); return v === "" ? 0 : parseAmt(v); };
    const vals = {startBalance:num("sBal"), goal:num("sGoal"), income:num("sInc")};
    if (Object.values(vals).some(v => Number.isNaN(v))) { m.textContent = "Bitte nur Zahlen eingeben, z. B. 921.52."; return; }
    // Gespeichert wird das Ziel vor dem Lohn, eingegeben wird es nach dem Lohn
    if (vals.goal > 0) vals.goal = r2(Math.max(vals.goal - vals.income, 0));
    const limits = {};
    for (const c of OUT) { const v = num("lim_" + c.id); if (Number.isNaN(v)) { m.textContent = `Limit bei ${c.label} ist keine Zahl.`; $("lim_" + c.id).focus(); return; } if (v > 0) limits[c.id] = v; }
    const day = Math.min(Math.max(Math.round(+$("sDay").value || 25), 1), 28);
    const dayChanged = day !== S.payday;
    S = {...S, ...vals, startDate:isDate($("sDate").value) ? $("sDate").value : todayIso(), payday:day, limits};
    if (dayChanged) viewStart = null;
    if (save()) { m.className = "status ok"; m.textContent = "Gespeichert."; setTimeout(() => { m.textContent = ""; }, 3000); }
    renderAll();
  };
  $("rAdd").onclick = () => {
    const m = $("rMsg"); m.className = "status err";
    const name = $("rName").value.trim(), amount = parseAmt($("rAmt").value), day = Math.round(+$("rDay").value);
    if (!name) { m.textContent = "Gib der Zahlung einen Namen."; $("rName").focus(); return; }
    if (!(amount > 0)) { m.textContent = "Betrag nicht erkannt. Beispiel: 26.95"; $("rAmt").focus(); return; }
    if (!(day >= 1 && day <= 28)) { m.textContent = "Tag zwischen 1 und 28 eingeben."; $("rDay").focus(); return; }
    S.recurring = [...S.recurring, {id:uid(), name, amount, day}]; save();
    $("rName").value = ""; $("rAmt").value = ""; $("rDay").value = ""; m.className = "status ok"; m.textContent = `${name} hinzugefügt.`;
    renderAll(); renderRecurring();
  };
  $("recList").addEventListener("click", e => { const b = e.target.closest("[data-rmrec]"); if (!b) return;
    const r = S.recurring.find(x => x.id === b.dataset.rmrec); S.recurring = S.recurring.filter(x => x.id !== b.dataset.rmrec); save(); renderAll(); renderRecurring();
    toast(`${esc(r.name)} entfernt.`, {undo:() => { S.recurring = [...S.recurring, r]; save(); renderAll(); renderRecurring(); }}); });
  $("merList").addEventListener("click", e => { const b = e.target.closest("[data-rmmer]"); if (!b) return; delete M[b.dataset.rmmer]; save(); renderMerchants(); });

  // Backup
  $("bakExport").onclick = async () => {
    lastBackup = Date.now();
    const data = JSON.stringify(snapshot(), null, 1), name = `budget-backup-${todayIso()}.json`;
    const file = new File([data], name, {type:"application/json"});
    let done = false;
    if (navigator.canShare && navigator.canShare({files:[file]})) {
      try { await navigator.share({files:[file], title:"Budget-Backup"}); done = true; }
      catch (err) { if (err && err.name === "AbortError") { lastBackup = 0; return; } }
    }
    if (!done) { const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
    save(); renderMehr(); showNotice();
    const m = $("bakMsg"); m.className = "status ok"; m.textContent = "Backup bereit. Wähl im Menü «In Dateien sichern» und dann iCloud Drive.";
  };
  $("bakImport").addEventListener("change", async e => {
    const f = e.target.files && e.target.files[0]; e.target.value = ""; if (!f) return;
    const m = $("bakMsg"); m.className = "status err";
    let d; try { d = JSON.parse(await f.text()); } catch { m.textContent = "Die Datei ist kein gültiges Backup."; return; }
    if (!d || d.app !== "lionels-budget" || !Array.isArray(d.payments)) { m.textContent = "Die Datei ist kein Backup dieser App."; return; }
    const when = d.exportedAt ? new Date(d.exportedAt).toLocaleDateString("de-CH") : "unbekannt";
    if (!confirm(`Backup vom ${when} mit ${d.payments.length} Zahlungen laden?\n\nDas ersetzt alle Daten auf diesem Gerät.`)) return;
    const before = snapshot();
    applyData(d); if (!lastBackup) lastBackup = Date.now();
    if (!save()) { applyData(before); m.textContent = "Laden hat nicht geklappt."; return; }
    viewStart = null; fillSettings(); fillCar(); renderAll(); renderMehr();
    m.className = "status ok"; m.textContent = `Backup geladen: ${P.length} Zahlungen.`;
  });
  $("resetAll").onclick = () => {
    if (!confirm("Wirklich alle Zahlungen und Einstellungen auf diesem Gerät löschen?")) return;
    if (!confirm("Sicher? Das kann nicht rückgängig gemacht werden.")) return;
    applyData({}); save(); viewStart = null; fillSettings(); fillCar(); renderAll(); renderMehr(); switchTab("heute"); toast("Alle Daten gelöscht.");
  };

  // Tageswechsel, App wieder geöffnet
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    const t = todayIso(); if ($("fDate").max !== t) { $("fDate").max = t; $("fDate").value = t; syncDayChips(); }
    renderAll();
  });
}
function clearHash() { try { history.replaceState(null, "", location.pathname + location.search); } catch {} }

/* ---------- Start ---------- */
load();
bind();
$("fDate").max = todayIso(); $("fDate").value = todayIso(); syncDayChips();
fillSettings(); fillCar();
let startTab = "heute"; try { startTab = sessionStorage.getItem("lb-tab") || "heute"; } catch {}
switchTab(["heute","verlauf","sparen","mehr"].includes(startTab) ? startTab : "heute");
renderAll();
const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
if (/#ap/i.test(location.hash)) { const h = location.hash; clearHash();
  // Auf dem iPhone hat Safari einen eigenen Speicher. Die Zahlung käme sonst nicht in der App an.
  if (standalone || !/iPhone|iPad/.test(navigator.userAgent)) handleApText(h, {fromHash:true});
  else toast("Safari speichert getrennt von der App. Nutze für Apple Pay den Weg über die Zwischenablage.", {err:true, ms:9000}); }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
