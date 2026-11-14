"use strict";
/* WKS Wissen – Schulunterlagen verstehen, anwenden, üben.
   Daten: verschlüsselt im Branch «wks-data» des Repos (vault.enc.json, keys.json), auf dem Gerät zwischengespeichert.
   Lernstand (Karten und «Verstanden»): lokal, auf Wunsch über ein geheimes Gist zwischen Geräten abgeglichen. */
const APP_VERSION = "2.0.0";
const REPO = "6dw6g8bch2-lab/Lionel", DATA_BRANCH = "wks-data";
const ISSUE_TITLE = "WKS-Schlüssel", PROG_DESC = "WKS Lernstand (verschlüsselt)", F_PROG = "wks-progress.enc.json";
const K_CFG = "wks-cfg-v2", K_CACHE = "wks-vault-cache-v2", K_PROG = "wks-progress-v1", K_KEYS = "wks-keys-v2", K_RKEYS = "wks-remote-keys";
const INTERVAL = [1, 1, 3, 7, 14, 30], NEW_PER_DAY = 20, EXAM_DAYS = 3, STALE_DAYS = 2;
const MON = ["Jan","Feb","März","Apr","Mai","Juni","Juli","Aug","Sep","Okt","Nov","Dez"], WD = ["So","Mo","Di","Mi","Do","Fr","Sa"];
const U_LABEL = ["Noch nicht bewertet", "Noch unklar", "Fast", "Verstanden"];

/* ---------- Hilfen ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const str = v => typeof v === "string" ? v : v == null ? "" : String(v);
const arr = v => Array.isArray(v) ? v : [];
const strs = v => arr(v).filter(x => typeof x === "string" && x.trim());
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const D = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d, 12); };
const today = () => iso(new Date());
const daysUntil = s => Math.round((D(s) - D(today())) / 864e5);
const fmtDate = s => { const d = D(s); return WD[d.getDay()] + ", " + d.getDate() + ". " + MON[d.getMonth()] + " " + d.getFullYear(); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const slug = s => str(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };
const say = t => { $("live").textContent = ""; setTimeout(() => { $("live").textContent = t; }, 60); };
let toastT; function toast(t, ms = 3200) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, ms); }
const ARROW = `<span class="arr" aria-hidden="true">→</span>`;
const BACK = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;

/* ---------- Zustand ---------- */
// CFG: ready, kid, token/gistId (nur Lernstand-Abgleich), etag. Das Passwort wird nie gespeichert.
let CFG = lsGet(K_CFG, {ready:false, kid:"", token:"", gistId:"", etag:{}});
let V = null, isDemo = true, PR = lsGet(K_PROG, {}), DUE = new Set(), F = [], TH = [], K = [], TE = [];
let view = {tab:"start"}, session = null, learnScope = "faellig", query = "", privKey = null, progKey = null, remoteKeys = null;
let sync = {state:"", msg:""}, lastDay = today(), lastRefresh = 0, depth = 0;

/* ---------- Daten aufbereiten ---------- */
const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
const plain = s => str(s).replace(LINK_RE, (_, a, b) => b || a);
function clean(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    erstellt:str(o.erstellt), status:o.status && typeof o.status === "object" ? o.status : null,
    faecher:arr(o.faecher).filter(f => f && str(f.name).trim()).map(f => ({id:str(f.id) || slug(f.name), name:str(f.name), farbe:Math.abs(+f.farbe || 0) % 8, reihenfolge:+f.reihenfolge || 99})),
    themen:arr(o.themen).filter(t => t && str(t.titel).trim()).map(t => ({id:str(t.id), fach:str(t.fach), titel:str(t.titel).trim(), kurz:str(t.kurz), zusammenfassung:str(t.zusammenfassung),
      quelle:str(t.quelle), aktualisiert:/^\d{4}-\d{2}-\d{2}/.test(str(t.aktualisiert)) ? str(t.aktualisiert).slice(0, 10) : "",
      kernpunkte:strs(t.kernpunkte), beispiel:str(t.beispiel), schritte:strs(t.schritte), fehler:strs(t.fehler), merksatz:str(t.merksatz),
      aufgaben:arr(t.aufgaben).filter(a => a && str(a.frage).trim()).map(a => ({frage:str(a.frage), loesung:str(a.loesung), tipp:str(a.tipp)})),
      begriffe:arr(t.begriffe).filter(b => b && typeof b === "object" && str(b.begriff).trim()).map(b => ({begriff:str(b.begriff).trim(), erklaerung:str(b.erklaerung)}))})),
    karten:arr(o.karten).filter(k => k && str(k.frage).trim() && str(k.antwort).trim()).map(k => ({id:str(k.id), fach:str(k.fach), thema:str(k.thema), frage:str(k.frage), antwort:str(k.antwort)})),
    termine:arr(o.termine).filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(str(t.datum)) && str(t.titel).trim()).map(t => ({id:str(t.id), fach:str(t.fach), titel:str(t.titel), art:str(t.art) || "Termin", datum:str(t.datum)})),
  };
}
function setVault(v, demo) {
  V = clean(v); isDemo = !!demo || !V.themen.length;
  if (isDemo && !demo) V = clean(DEMO_VAULT);
  F = V.faecher.sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, "de"));
  TH = V.themen; K = V.karten; TE = V.termine;
  computeDue();
}
const fachOf = id => F.find(f => f.id === id);
const themaOf = id => TH.find(t => t.id === id);
const fcol = f => `var(--c${f ? f.farbe : 0})`;
const uOf = id => (PR["th:" + id] || {}).u || 0;
const fachStats = id => { const th = TH.filter(t => t.fach === id); return {th, done:th.filter(t => uOf(t.id) === 3).length, kc:K.filter(k => k.fach === id).length, due:K.filter(k => k.fach === id && DUE.has(k.id)).length}; };

/* ---------- Text (fett, kursiv, Links auf andere Themen) ---------- */
const fmt = s => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
function inline(s) {
  s = str(s); let out = "", last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    out += fmt(s.slice(last, m.index));
    const t = TH.find(x => x.titel.toLowerCase() === m[1].trim().toLowerCase()), label = esc((m[2] || m[1]).trim());
    out += t ? `<a href="#" data-thema="${esc(t.id)}">${label}</a>` : `<strong>${label}</strong>`;
    last = m.index + m[0].length;
  }
  return out + fmt(s.slice(last));
}
const paras = t => str(t).split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);

/* ---------- Lernlogik ---------- */
const examSoon = fid => TE.some(t => t.fach === fid && t.datum >= today() && daysUntil(t.datum) <= EXAM_DAYS);
function computeDue() {
  const t = today(), due = [], fresh = [];
  for (const k of K) { const p = PR[k.id]; if (!p) fresh.push(k); else if (p.faellig <= t || (examSoon(k.fach) && p.zuletzt !== t)) due.push(k); }
  const newToday = Object.entries(PR).filter(([id, p]) => !id.startsWith("th:") && p.erstmals === t).length;
  const fe = fresh.filter(k => examSoon(k.fach)), fo = fresh.filter(k => !examSoon(k.fach)).slice(0, Math.max(NEW_PER_DAY - newToday, 0));
  DUE = new Set([...due, ...fe, ...fo].map(k => k.id));
  document.querySelectorAll("[data-due]").forEach(b => { b.hidden = !DUE.size; b.textContent = DUE.size > 99 ? "99+" : String(DUE.size); });
  document.querySelectorAll(".tabbar [data-tab='learn'], .topnav [data-tab='learn']").forEach(b => b.setAttribute("aria-label", DUE.size ? `Lernen, ${DUE.size} Karten fällig` : "Lernen"));
}
function scopeCards(s) {
  if (s === "faellig") return K.filter(k => DUE.has(k.id));
  if (s === "alle") return [...K];
  if (s.startsWith("thema:")) return K.filter(k => k.thema === s.slice(6));
  if (s.startsWith("fach:")) return K.filter(k => k.fach === s.slice(5));
  return [];
}
function startSession(scope) {
  learnScope = scope;
  const cards = scopeCards(scope).sort(() => Math.random() - .5).sort((a, b) => ((PR[a.id] || {}).stufe || 0) - ((PR[b.id] || {}).stufe || 0));
  const exam = scope.startsWith("fach:") && examSoon(scope.slice(5));
  session = cards.length ? {cards:cards.map(c => c.id), i:0, shown:false, ok:0, again:0, retried:new Set(), counted:new Set(cards.filter(c => exam || DUE.has(c.id) || !PR[c.id]).map(c => c.id))} : null;
  go({tab:"learn"});
}
function grade(ok) {
  const id = session.cards[session.i], first = !session.retried.has(id);
  if (first) ok ? session.ok++ : session.again++;
  if (first && session.counted.has(id) && !isDemo) {
    const p = PR[id], t = today(), stufe = ok ? Math.min(((p && p.stufe) || 0) + 1, 5) : 0, d = new Date(); d.setDate(d.getDate() + INTERVAL[stufe]);
    PR[id] = {stufe, faellig:iso(d), zuletzt:t, erstmals:(p && p.erstmals) || t, ts:Date.now()};
    lsSet(K_PROG, PR); schedulePush();
  }
  if (!ok && first) { session.retried.add(id); session.cards.push(id); }
  session.i++; session.shown = false; render();
  setTimeout(() => (document.querySelector("[data-reveal]") || document.querySelector("#page [data-learn]") || $("h-main")).focus({preventScroll:true}), 0);
}
function setUnderstood(id, u) {
  if (isDemo) { toast("Im Beispiel wird nichts gespeichert."); return; }
  PR["th:" + id] = {u, ts:Date.now()}; lsSet(K_PROG, PR); schedulePush(); render();
  say(U_LABEL[u] + " gespeichert.");
  document.querySelector(`[data-u="${u}"]`)?.focus({preventScroll:true});
}

/* ---------- Bausteine ---------- */
function statusText() {
  if (!CFG.ready) return "Beispiel";
  if (isDemo) return remoteKeys ? "Eingerichtet · noch keine Unterlagen" : "Eingerichtet · Schlüssel noch nicht bei Claude";
  const s = V.status, w = s && s.letzteAktualisierung ? new Date(s.letzteAktualisierung) : V.erstellt ? new Date(V.erstellt) : null;
  return w ? "Stand " + w.toLocaleString("de-CH", {day:"numeric", month:"numeric", hour:"2-digit", minute:"2-digit"}) : "";
}
function notice() {
  if (!CFG.ready) return `<div class="note"><b>Das ist ein Beispiel.</b><p>Richte die App einmal mit einem Passwort ein. Danach siehst du hier deine eigenen Unterlagen.</p><button class="pill sm" type="button" data-tab="settings">Einrichten ${ARROW}</button></div>`;
  if (!remoteKeys) return lsGet(K_KEYS, null) ? `<div class="note warn"><b>Noch ein Schritt</b><p>Übergib deinen Schlüssel an Claude, sonst kann Claude deine Notizen nicht für dich verschlüsseln.</p><button class="pill sm" type="button" data-tab="settings">Schlüssel übergeben ${ARROW}</button></div>` : "";
  if (isDemo) return `<div class="note warn"><b>Noch keine Unterlagen</b><p>Leg PDFs, Word- oder PowerPoint-Dateien in deinen OneDrive-Ordner <b>WKS</b>, am besten in einen Unterordner pro Fach. Claude bereitet sie jeden Abend um 18:37 Uhr auf. Bis dahin siehst du ein Beispiel.</p></div>`;
  const s = V.status, w = s && s.letzteAktualisierung ? new Date(s.letzteAktualisierung) : null;
  if (w && (Date.now() - w) / 864e5 > STALE_DAYS) return `<div class="note warn"><b>Seit ${Math.floor((Date.now() - w) / 864e5)} Tagen nicht aktualisiert</b><p>Schreib Claude: «Aktualisier die WKS-App».</p></div>`;
  return "";
}
const back = (label, tab) => `<button class="back" type="button" data-back="${esc(tab || "")}">${BACK}${esc(label)}</button>`;
const stateChip = id => { const u = uOf(id); return `<span class="state s${u}">${u ? U_LABEL[u] : "Neu"}</span>`; };
function tile(f) {
  const s = fachStats(f.id), pct = s.th.length ? Math.round(s.done / s.th.length * 100) : 0;
  return `<button type="button" class="tile glow" data-fach="${esc(f.id)}" style="--fc:${fcol(f)}">
    <span class="row" style="justify-content:space-between;gap:8px"><span class="eyebrow">${plural(s.th.length, "Thema", "Themen")} · ${plural(s.kc, "Karte", "Karten")}</span>${s.due ? `<span class="chip"><span class="dot"></span>${s.due} fällig</span>` : ""}</span>
    <span class="tfoot"><span class="tname">${esc(f.name)}</span><span class="tmeta">${s.done} von ${s.th.length} verstanden</span><span class="meter" aria-hidden="true"><div style="width:${pct}%"></div></span></span></button>`;
}
const trow = t => `<button type="button" class="trow" data-thema="${esc(t.id)}"><span class="t">${esc(t.titel)}</span>${stateChip(t.id)}<span class="s">${esc(plain(t.kurz || paras(t.zusammenfassung)[0] || ""))}</span></button>`;
const ghost = `class="pill ghost" style="color:#f4f4f5;border-color:#6a6a72"`;

/* ---------- Seiten ---------- */
function pageStart() {
  const h = new Date().getHours(), hi = h < 11 ? "Guten Morgen" : h < 17 ? "Hallo" : "Guten Abend";
  const next = TE.filter(t => t.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum))[0];
  const open = TH.filter(t => uOf(t.id) < 3).sort((a, b) => uOf(b.id) - uOf(a.id) || b.aktualisiert.localeCompare(a.aktualisiert)).slice(0, 4);
  const done = TH.filter(t => uOf(t.id) === 3).length;
  let html = `<section class="hero"><span class="eyebrow">${esc(statusText())}</span><h1 class="display" id="h-main" tabindex="-1">${hi}, Lionel.</h1>
    <p class="lead">${DUE.size ? `Heute warten ${plural(DUE.size, "Karte", "Karten")} auf dich.` : TH.length ? "Heute ist nichts fällig. Nimm dir ein Thema vor, das noch nicht sitzt." : "Sobald deine Unterlagen da sind, geht es los."}</p>
    ${DUE.size ? `<button class="pill" type="button" data-learn="faellig">Jetzt üben ${ARROW}</button>` : ""}</section>${notice()}`;
  if (sync.state === "err") html += `<div class="note err"><b>Verbindung</b><p>${esc(sync.msg)} Du siehst den letzten gespeicherten Stand.</p></div>`;
  if (next) {
    const n = daysUntil(next.datum), f = fachOf(next.fach), s = f ? fachStats(f.id) : null;
    html += `<section class="hero-card glow" style="--fc:${fcol(f)}" aria-labelledby="h-next"><span class="eyebrow">${n === 0 ? "Heute" : n === 1 ? "Morgen" : `In ${n} Tagen`} · ${esc(next.art)}${f ? " · " + esc(f.name) : ""}${isDemo ? " · Beispiel" : ""}</span>
      <h2 class="big" id="h-next">${esc(next.titel)}</h2><p class="when">${esc(fmtDate(next.datum))}${s && s.th.length ? ` · ${s.done} von ${s.th.length} Themen verstanden` : ""}</p>
      ${f ? `<div class="row"><button class="pill light" type="button" data-learn="fach:${esc(f.id)}">Für diese Prüfung üben ${ARROW}</button><button ${ghost} type="button" data-fach="${esc(f.id)}">Themen ansehen</button></div>` : ""}</section>`;
  }
  html += `<section class="stats" aria-label="Überblick"><div class="stat"><b class="num">${TH.length}</b><span>Themen</span></div><div class="stat"><b class="num">${done}</b><span>verstanden</span></div><div class="stat"><b class="num">${DUE.size}</b><span>Karten fällig</span></div></section>`;
  if (open.length) html += `<section class="sec" aria-labelledby="h-open"><div class="sec-head"><h2 class="h2" id="h-open">Als Nächstes verstehen</h2></div><div class="tlist">${open.map(trow).join("")}</div></section>`;
  html += `<section class="sec" aria-labelledby="h-f"><div class="sec-head"><h2 class="h2" id="h-f">Deine Fächer</h2></div><div class="mosaic">${F.map(tile).join("")}</div></section>`;
  return html;
}
function pageFaecher() {
  return `<section class="hero"><span class="eyebrow">${plural(F.length, "Fach", "Fächer")} · ${plural(TH.length, "Thema", "Themen")}</span><h1 class="display" id="h-main" tabindex="-1">Fächer</h1></section>
    ${F.length ? `<div class="mosaic">${F.map(tile).join("")}</div>` : `<div class="note"><p>Noch keine Fächer. Leg Unterlagen in deinen OneDrive-Ordner WKS.</p></div>`}`;
}
function pageFach(id) {
  const f = fachOf(id); if (!f) return pageFaecher();
  const s = fachStats(id), te = TE.filter(t => t.fach === id && t.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum));
  const th = [...s.th].sort((a, b) => uOf(a.id) - uOf(b.id) || a.titel.localeCompare(b.titel, "de"));
  return `${back("Fächer", "faecher")}<section class="hero-card glow" style="--fc:${fcol(f)}"><span class="eyebrow">Fach${isDemo ? " · Beispiel" : ""}</span><h1 class="big" id="h-main" tabindex="-1">${esc(f.name)}</h1>
    <p class="when">${s.done} von ${s.th.length} Themen verstanden · ${plural(s.kc, "Karte", "Karten")}${te[0] ? ` · ${esc(te[0].art)} am ${esc(fmtDate(te[0].datum))}` : ""}</p>
    <div class="meter" aria-hidden="true" style="background:#2a2a30"><div style="width:${s.th.length ? s.done / s.th.length * 100 : 0}%"></div></div>
    ${s.kc ? `<div class="row"><button class="pill light" type="button" data-learn="fach:${esc(id)}">${te[0] && daysUntil(te[0].datum) <= EXAM_DAYS ? "Für die Prüfung üben" : s.due ? `${plural(s.due, "fällige Karte", "fällige Karten")} üben` : "Karten wiederholen"} ${ARROW}</button></div>` : ""}</section>
    <section class="sec" aria-labelledby="h-th"><h2 class="h2" id="h-th">Themen</h2><div class="tlist">${th.map(trow).join("") || `<p class="muted">Noch keine Themen.</p>`}</div></section>`;
}
function pageThema(id) {
  const t = themaOf(id); if (!t) return pageFaecher();
  const f = fachOf(t.fach), ks = K.filter(k => k.thema === t.id), u = uOf(t.id), blocks = [];
  const add = (key, title, body) => blocks.push({key, title, body});
  if (t.zusammenfassung) add("erklaert", "Einfach erklärt", `<div class="prose">${paras(t.zusammenfassung).map(p => `<p>${inline(p)}</p>`).join("")}</div>`);
  if (t.kernpunkte.length) add("wichtig", "Das Wichtigste", `<ul class="points">${t.kernpunkte.map(p => `<li><span>${inline(p)}</span></li>`).join("")}</ul>`);
  if (t.beispiel) add("beispiel", "Beispiel", `<div class="example-box">${inline(t.beispiel)}</div>`);
  if (t.schritte.length) add("anwenden", "So wendest du es an", `<ol class="steps">${t.schritte.map(s => `<li><span>${inline(s)}</span></li>`).join("")}</ol>`);
  if (t.aufgaben.length) add("ueben", "Übungen", t.aufgaben.map((a, i) => `<div class="task"><p class="q">${inline(a.frage)}</p>${a.tipp ? `<p class="small muted">Tipp: ${inline(a.tipp)}</p>` : ""}<button class="pill ghost sm" type="button" data-sol="${i}" aria-expanded="false" aria-controls="sol-${i}">Lösung zeigen</button><div class="sol" id="sol-${i}" hidden>${inline(a.loesung || "Keine Lösung hinterlegt.")}</div></div>`).join(""));
  if (t.fehler.length) add("fehler", "Typische Fehler", `<ul class="mistakes">${t.fehler.map(x => `<li>${inline(x)}</li>`).join("")}</ul>`);
  if (t.merksatz) add("merksatz", "Merksatz", `<div class="motto glow" style="--fc:${fcol(f)}">${inline(t.merksatz)}</div>`);
  if (t.begriffe.length) add("begriffe", "Begriffe", `<dl class="terms">${t.begriffe.map(b => `<div><dt>${esc(b.begriff)}</dt><dd>${inline(b.erklaerung)}</dd></div>`).join("")}</dl>`);
  return `${back(f ? f.name : "Fächer", f ? "fach:" + f.id : "faecher")}
    <section class="thead glow" style="--fc:${fcol(f)}"><div class="row">${f ? `<span class="chip" style="--fc:${fcol(f)}"><span class="dot"></span>${esc(f.name)}</span>` : ""}${stateChip(t.id)}${isDemo ? `<span class="example">Beispiel</span>` : ""}</div>
      <h1 class="display" id="h-main" tabindex="-1" style="font-size:clamp(2rem,7vw,3.6rem)">${esc(t.titel)}</h1>${t.kurz ? `<p class="lead">${inline(t.kurz)}</p>` : ""}
      <div class="row">${ks.length ? `<button class="pill" type="button" data-learn="thema:${esc(t.id)}">${plural(ks.length, "Karte", "Karten")} üben ${ARROW}</button>` : ""}<a class="pill ghost sm" href="#check">Verstanden?</a></div>
      ${t.quelle ? `<p class="source">Aus: ${esc(t.quelle)}${t.aktualisiert ? " · " + esc(fmtDate(t.aktualisiert)) : ""}</p>` : ""}</section>
    ${blocks.length > 2 ? `<nav class="toc" aria-label="Auf dieser Seite">${blocks.map(b => `<a href="#${b.key}">${esc(b.title)}</a>`).join("")}<a href="#check">Verstanden?</a></nav>` : ""}
    ${blocks.map((b, i) => `<section class="block" id="${b.key}" aria-labelledby="h-${b.key}" style="--fc:${fcol(f)}"><div class="block-h"><span class="n" aria-hidden="true">${i + 1}</span><h2 id="h-${b.key}">${esc(b.title)}</h2></div>${b.body}</section>`).join("")}
    <section class="block card check" id="check" aria-labelledby="h-check"><h2 id="h-check" class="h2">Hast du es verstanden?</h2><p class="muted">Sei ehrlich mit dir. Was noch unklar ist, zeigt dir die Startseite als Nächstes.</p>
      <div class="seg" role="group" aria-label="Wie gut verstehst du das Thema?">${[1, 2, 3].map(x => `<button type="button" data-u="${x}" data-uid="${esc(t.id)}" aria-pressed="${u === x}">${U_LABEL[x]}<small>${["", "Nochmals lesen", "Übungen machen", "Sitzt"][x]}</small></button>`).join("")}</div>
      ${u && u < 3 && ks.length ? `<button class="pill sm" type="button" data-learn="thema:${esc(t.id)}">Mit den Karten festigen ${ARROW}</button>` : ""}</section>`;
}
function pageLearn() {
  let html = `<section class="hero"><span class="eyebrow">Karteikarten</span><h1 class="display" id="h-main" tabindex="-1">Lernen</h1></section>`;
  if (isDemo) html += `<div class="note warn"><p>Beispielkarten: Dein Lernstand wird erst mit echten Unterlagen gespeichert.</p></div>`;
  if (!K.length) return html + `<div class="note"><p>Noch keine Karten.</p></div>`;
  const scopes = [["faellig", "Fällig", DUE.size], ["alle", "Alle", K.length], ...F.map(f => ["fach:" + f.id, f.name, K.filter(k => k.fach === f.id).length]).filter(x => x[2])];
  const custom = learnScope.startsWith("thema:") ? themaOf(learnScope.slice(6)) : null;
  html += `<div class="scope" role="group" aria-label="Welche Karten">${scopes.map(([id, name, n]) => `<button type="button" data-scope="${esc(id)}" aria-pressed="${learnScope === id}">${esc(name)} <span class="n">${n}</span></button>`).join("")}${custom ? `<button type="button" aria-pressed="true" data-scope="${esc(learnScope)}">${esc(custom.titel)}</button>` : ""}</div>`;
  if (!session) {
    const n = scopeCards(learnScope).length, box = [0, 0, 0, 0, 0, 0];
    K.forEach(k => { const p = PR[k.id]; box[!p ? 0 : Math.max(1, Math.min(p.stufe || 0, 5))]++; });
    const waiting = K.filter(k => !PR[k.id] && !DUE.has(k.id)).length;
    html += `<section class="card"><p class="lead" style="color:var(--fg)">${n ? `${plural(n, "Karte", "Karten")} bereit.` : learnScope === "faellig" ? "Heute ist nichts mehr fällig. Stark." : "Keine Karten in dieser Auswahl."}</p>
      ${learnScope === "faellig" && waiting ? `<p class="muted small">${waiting} neue Karten kommen in den nächsten Tagen dazu, höchstens ${NEW_PER_DAY} pro Tag.</p>` : ""}
      <div class="row">${n ? `<button class="pill" type="button" data-learn="${esc(learnScope)}">Los geht's ${ARROW}</button>` : learnScope === "faellig" ? `<button class="pill ghost" type="button" data-learn="alle">Trotzdem alle wiederholen</button>` : ""}</div></section>
      <section class="sec" aria-labelledby="h-stand"><h2 class="h2" id="h-stand">Dein Stand</h2><div class="boxes">${box.map((c, i) => `<div><b class="num">${c}</b><span>${["Neu", "1 Tag", "3 Tage", "1 Woche", "2 Wochen", "Sitzt"][i]}</span></div>`).join("")}</div>
      <p class="small muted">Gewusste Karten kommen nach 1, 3, 7, 14 und 30 Tagen wieder. Nicht gewusste kommen am Ende der Runde nochmals und morgen wieder. Drei Tage vor einer Prüfung wird das ganze Fach fällig.</p></section>`;
    return html;
  }
  if (session.i >= session.cards.length) {
    const tot = session.ok + session.again; say(`Runde fertig. ${session.ok} von ${tot} gewusst.`);
    return html + `<section class="hero-card glow" style="--fc:var(--c3)"><span class="eyebrow">Runde fertig</span><p class="big">${session.ok} von ${tot}</p><p class="when">beim ersten Versuch gewusst${session.again ? ` · ${plural(session.again, "Karte kommt", "Karten kommen")} morgen wieder` : ""}</p>
      <div class="row"><button class="pill light" type="button" data-learn="${esc(learnScope)}">Nochmals üben ${ARROW}</button><button ${ghost} type="button" data-endsession>Fertig</button></div></section>`;
  }
  const k = K.find(x => x.id === session.cards[session.i]); if (!k) { session.i++; return pageLearn(); }
  const f = fachOf(k.fach), th = themaOf(k.thema);
  return html + `<div class="progress" aria-hidden="true"><div style="width:${session.i / session.cards.length * 100}%"></div></div><p class="small muted num">Karte ${session.i + 1} von ${session.cards.length}</p>
    <section class="flash glow" aria-label="Karteikarte" style="--fc:${fcol(f)}"><div class="row">${f ? `<span class="chip"><span class="dot"></span>${esc(f.name)}</span>` : ""}${th ? `<span class="small muted">${esc(th.titel)}</span>` : ""}</div>
      <p class="q" id="cardQ">${esc(k.frage)}</p>
      ${session.shown ? `<div class="a" id="cardA" tabindex="-1">${esc(k.antwort)}</div><div class="acts"><button class="pill no" type="button" data-grade="0" aria-keyshortcuts="1">Nicht gewusst</button><button class="pill yes" type="button" data-grade="1" aria-keyshortcuts="2">Gewusst</button></div>`
      : `<div class="acts one"><button class="pill" type="button" data-reveal aria-keyshortcuts="Space" aria-describedby="cardQ">Antwort zeigen</button></div>`}
      <p class="keys">Tastatur: Leertaste zeigt die Antwort, 1 = nicht gewusst, 2 = gewusst.</p></section>`;
}
function pageDates() {
  const up = TE.filter(t => t.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum)), past = TE.filter(t => t.datum < today()).sort((a, b) => b.datum.localeCompare(a.datum));
  const row = t => { const d = D(t.datum), f = fachOf(t.fach), n = daysUntil(t.datum);
    return `<button class="term" type="button" ${f ? `data-fach="${esc(f.id)}"` : "disabled"}><span class="date" aria-hidden="true"><span>${WD[d.getDay()]}</span><b class="num">${d.getDate()}</b><span>${MON[d.getMonth()]}</span></span>
      <span class="tb"><span class="t">${esc(t.titel)}</span><span class="s">${esc(t.art)}${f ? " · " + esc(f.name) : ""}<span class="sr-only">, ${esc(fmtDate(t.datum))}</span>${isDemo ? ` <span class="example">Beispiel</span>` : ""}</span>${n >= 0 ? `<span class="when-pill ${n <= EXAM_DAYS ? "bad" : n <= 10 ? "warn" : "neutral"}">${n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`}</span>` : ""}</span></button>`; };
  return `<section class="hero"><span class="eyebrow">Prüfungen und Abgaben</span><h1 class="display" id="h-main" tabindex="-1">Termine</h1></section>
    ${up.length ? `<div class="tlist">${up.map(row).join("")}</div>` : `<div class="note"><p>Keine kommenden Termine. Claude erkennt Prüfungsdaten, wenn sie in deinen Unterlagen stehen.</p></div>`}
    ${past.length ? `<details class="sec"><summary class="eyebrow" style="cursor:pointer;min-height:44px;display:flex;align-items:center">Vergangen (${past.length})</summary><div class="tlist">${past.map(row).join("")}</div></details>` : ""}`;
}
function pageSearch() {
  return `<section class="hero"><span class="eyebrow">In allen Fächern</span><h1 class="display" id="h-main" tabindex="-1">Suche</h1></section>
    <label class="searchbox" for="q"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg><input id="q" type="search" placeholder="Begriff, z. B. Bilanz" autocomplete="off" aria-label="In allen Themen suchen" aria-describedby="qn" value="${esc(query)}"></label>
    <p class="small muted" id="qn" role="status"></p><div class="tlist" id="qres"></div>`;
}
function searchResults() {
  const q = query.trim().toLowerCase(), res = $("qres"), note = $("qn"); if (!res) return;
  if (q.length < 2) { res.innerHTML = ""; note.textContent = `Durchsucht ${plural(TH.length, "Thema", "Themen")} und ${plural(K.length, "Karte", "Karten")}.`; return; }
  const hl = s => { const t = plain(s), i = t.toLowerCase().indexOf(q); if (i < 0) return esc(t.slice(0, 120)); const a = Math.max(0, i - 50); return (a ? "… " : "") + esc(t.slice(a, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length, i + q.length + 70)) + " …"; };
  const hits = TH.map(t => {
    const parts = [t.titel, t.kurz, t.zusammenfassung, ...t.kernpunkte, t.beispiel, ...t.schritte, ...t.aufgaben.map(a => a.frage + " " + a.loesung), ...t.fehler, t.merksatz, ...t.begriffe.map(b => b.begriff + ": " + b.erklaerung)];
    const m = parts.find(p => str(p).toLowerCase().includes(q)); return m ? {t, s:hl(m), score:t.titel.toLowerCase().includes(q) ? 0 : 1} : null;
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  K.forEach(k => { if (hits.some(h => h.t.id === k.thema)) return; const m = [k.frage, k.antwort].find(p => p.toLowerCase().includes(q)), t = themaOf(k.thema); if (m && t) hits.push({t, s:hl(m), score:2}); });
  note.textContent = hits.length ? `${hits.length} Treffer` : `Nichts gefunden für «${query.trim()}».`;
  res.innerHTML = hits.slice(0, 50).map(h => { const f = fachOf(h.t.fach); return `<button type="button" class="trow" data-thema="${esc(h.t.id)}"><span class="t">${esc(h.t.titel)}</span>${f ? `<span class="chip" style="--fc:${fcol(f)}"><span class="dot"></span>${esc(f.name)}</span>` : "<span></span>"}<span class="s">${h.s}</span></button>`; }).join("");
}
function issueUrl(keys) {
  const body = "Das ist mein Schlüssel für die App WKS Wissen. Claude übernimmt ihn beim nächsten Abendlauf.\n\n```json\n" + JSON.stringify(keys) + "\n```";
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(ISSUE_TITLE)}&body=${encodeURIComponent(body)}`;
}
function pageSettings() {
  const local = lsGet(K_KEYS, null);
  let html = `<section class="hero"><span class="eyebrow">WKS Wissen ${APP_VERSION}</span><h1 class="display" id="h-main" tabindex="-1">Einstellungen</h1></section><section class="card" aria-labelledby="h-setup"><h2 class="h2" id="h-setup">Einrichten</h2>`;
  if (!CFG.ready) {
    html += remoteKeys
      ? `<p>Die App ist auf einem anderen Gerät schon eingerichtet. Gib hier <b>dasselbe Passwort</b> ein.</p>
         <label class="field"><span>Passwort</span><input id="cfgPass" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false"></label>
         <button class="pill" type="button" id="btnUnlock">Entsperren ${ARROW}</button>`
      : `<p>Wähl ein Passwort. Damit sind deine Notizen geschützt: Nur wer es kennt, kann sie lesen, auch Claude nicht. Auf deinen anderen Geräten gibst du später dasselbe Passwort ein.</p>
         <label class="field"><span>Passwort (mindestens 10 Zeichen)</span><input id="cfgPass" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>
         <label class="field"><span>Passwort wiederholen</span><input id="cfgPass2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>
         <p class="small muted">Speichere es in deinen iPhone-Passwörtern. Vergisst du es, richtet Claude die App mit einem neuen Passwort ein; deine Unterlagen in OneDrive bleiben, nur der Lernstand geht verloren.</p>
         <button class="pill" type="button" id="btnCreate">Passwort festlegen ${ARROW}</button>`;
    html += `<p class="status" id="setMsg" role="status"></p>`;
  } else {
    html += `<p>Eingerichtet. ${esc(statusText())}.</p>`;
    if (!remoteKeys && local) html += `<div class="note warn"><b>Schlüssel an Claude übergeben</b><ol class="olist"><li>Tippe auf den Knopf. GitHub öffnet ein ausgefülltes Formular.</li><li>Tippe dort auf <b>«Submit new issue»</b> bzw. <b>«Create»</b>.</li><li>Claude übernimmt den Schlüssel beim nächsten Abendlauf. Sofort: schreib Claude «Aktualisier die WKS-App».</li></ol><p class="small">Der Schlüssel ist mit deinem Passwort versiegelt und ohne Passwort nutzlos.</p><a class="pill" href="${esc(issueUrl(local))}" target="_blank" rel="noopener">Schlüssel übergeben ${ARROW}</a></div>`;
    html += `<p class="status ${sync.state === "err" ? "err" : ""}" id="setMsg" role="status">${sync.state === "err" ? esc(sync.msg) : ""}</p>
      <div class="row"><button class="pill ghost" type="button" id="btnRefresh">Jetzt neu laden</button><button class="pill ghost" style="color:var(--bad);border-color:var(--bad)" type="button" id="btnReset">Auf diesem Gerät abmelden</button></div>`;
  }
  html += `</section>`;
  if (CFG.ready) html += `<section class="card" aria-labelledby="h-prog"><h2 class="h2" id="h-prog">Lernstand auf allen Geräten</h2>
    ${CFG.token ? `<p>Dein Lernstand wird zwischen deinen Geräten abgeglichen.</p><button class="pill ghost" type="button" id="btnProgOff">Abgleich beenden</button>`
    : `<p class="muted">Freiwillig. Ohne Abgleich lernt jedes Gerät für sich. Dafür braucht es einen GitHub-Token mit dem Recht «gist»: <a style="color:var(--accent);font-weight:700" href="https://github.com/settings/tokens/new?scopes=gist&amp;description=WKS-Lernstand" target="_blank" rel="noopener">hier erstellen</a>, «No expiration» wählen, unten «Generate token», kopieren.</p>
      <label class="field"><span>GitHub-Token</span><input id="cfgToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…"></label><button class="pill ghost" type="button" id="btnProgOn">Abgleich einschalten</button>`}<p class="status" id="progMsg" role="status"></p></section>`;
  html += `<section class="card" aria-labelledby="h-how"><h2 class="h2" id="h-how">So kommen Unterlagen hinein</h2><p>Leg PDFs, Word- oder PowerPoint-Dateien in deinen OneDrive-Ordner <b>WKS</b>, am besten in einen Unterordner pro Fach (z. B. <b>WKS › Französisch</b>). Claude macht daraus jeden Abend um 18:37 Uhr Erklärungen, Beispiele, Übungen, Karteikarten und Termine.</p></section>`;
  return html;
}
function bindSettings() {
  const msg = (id, t, ok) => { const m = $(id); if (m) { m.className = "status " + (ok ? "ok" : "err"); m.textContent = t; } };
  $("btnCreate") && ($("btnCreate").onclick = async () => {
    const p = $("cfgPass").value, p2 = $("cfgPass2").value;
    if (p.length < 10) { msg("setMsg", "Das Passwort braucht mindestens 10 Zeichen."); $("cfgPass").focus(); return; }
    if (p !== p2) { msg("setMsg", "Die beiden Passwörter sind nicht gleich."); $("cfgPass2").focus(); return; }
    if (!window.crypto || !crypto.subtle) { msg("setMsg", "Dieser Browser kann nicht verschlüsseln. Öffne die App über https."); return; }
    $("btnCreate").disabled = true; msg("setMsg", "Schlüssel wird erstellt …", true);
    const k = await WC.createKeys(p); lsSet(K_KEYS, k.keys); await unlockAndStore(k.keys, p);
    toast("Passwort festgelegt."); render(); setTimeout(() => document.querySelector("a.pill[href*='issues/new']")?.focus(), 50);
  });
  $("btnUnlock") && ($("btnUnlock").onclick = async () => {
    const p = $("cfgPass").value; $("btnUnlock").disabled = true; msg("setMsg", "Prüfe …", true);
    try { await unlockAndStore(remoteKeys, p); } catch (e) { $("btnUnlock").disabled = false; msg("setMsg", e.tampered ? "Der Schlüssel im Repo ist beschädigt oder verändert. Schreib Claude." : "Falsches Passwort. Es muss dasselbe sein wie auf deinem anderen Gerät."); $("cfgPass").focus(); return; }
    toast("Entsperrt."); await refresh(true); go({tab:"start"});
  });
  $("btnRefresh") && ($("btnRefresh").onclick = async () => { await refresh(true); render(); });
  $("btnReset") && ($("btnReset").onclick = () => {
    const b = $("btnReset"); if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Wirklich abmelden? Nochmals tippen"; return; }
    CFG = {ready:false, kid:"", token:"", gistId:"", etag:{}}; privKey = null; progKey = null; KeyStore.clear(); lsSet(K_CFG, CFG); lsDel(K_CACHE); lsDel(K_KEYS);
    setVault(DEMO_VAULT, true); toast("Abgemeldet."); go({tab:"start"});
  });
  $("btnProgOn") && ($("btnProgOn").onclick = async () => {
    const t = $("cfgToken").value.trim();
    if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/.test(t)) { msg("progMsg", "Das sieht nicht nach einem GitHub-Token aus. Er beginnt mit «ghp_»."); return; }
    msg("progMsg", "Verbinde …", true);
    try { CFG.token = t; CFG.gistId = ""; await syncProgress(); lsSet(K_CFG, CFG); toast("Abgleich eingeschaltet."); render(); } catch (e) { CFG.token = ""; msg("progMsg", e.message); }
  });
  $("btnProgOff") && ($("btnProgOff").onclick = () => { CFG.token = ""; CFG.gistId = ""; lsSet(K_CFG, CFG); toast("Abgleich beendet."); render(); });
}

/* ---------- Navigation ---------- */
function render() {
  computeDue();
  const v = view, top = v.tab.startsWith("fach:") || v.tab.startsWith("thema:") ? "faecher" : v.tab;
  document.querySelectorAll("[data-tab]").forEach(b => { if (b.classList.contains("brand")) return; b.dataset.tab === top ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"); });
  $("page").innerHTML = v.tab === "start" ? pageStart() : v.tab === "faecher" ? pageFaecher() : v.tab.startsWith("fach:") ? pageFach(v.tab.slice(5)) : v.tab.startsWith("thema:") ? pageThema(v.tab.slice(6))
    : v.tab === "learn" ? pageLearn() : v.tab === "dates" ? pageDates() : v.tab === "search" ? pageSearch() : pageSettings();
  if (v.tab === "search") { $("q").addEventListener("input", e => { query = e.target.value; searchResults(); }); searchResults(); }
  if (v.tab === "settings") bindSettings();
}
function go(v, {focus = true} = {}) {
  view = v; if (v.tab !== "learn" && session && session.i >= session.cards.length) session = null;
  try { history.pushState({v, depth:++depth}, ""); } catch {}
  render(); window.scrollTo(0, 0);
  if (focus) setTimeout(() => (v.tab === "search" ? $("q") : document.querySelector("[data-reveal]") || $("h-main") || $("page")).focus({preventScroll:true}), 0);
}
window.addEventListener("popstate", e => { const s = e.state; view = s && s.v ? s.v : {tab:"start"}; depth = s ? s.depth || 0 : 0; render(); window.scrollTo(0, 0); setTimeout(() => ($("h-main") || $("page")).focus({preventScroll:true}), 0); });

document.addEventListener("click", e => {
  const a = e.target.closest("a[data-thema]"); if (a) { e.preventDefault(); return go({tab:"thema:" + a.dataset.thema}); }
  const l = e.target.closest("a[href^='#']");
  if (l && l.getAttribute("href").length > 1) { e.preventDefault(); const t = document.getElementById(l.getAttribute("href").slice(1)); if (t) { t.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth"}); const h = t.querySelector("h2"); if (h) { h.setAttribute("tabindex", "-1"); h.focus({preventScroll:true}); } } return; }
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  if (b.dataset.tab) return go({tab:b.dataset.tab});
  if (b.dataset.fach) return go({tab:"fach:" + b.dataset.fach});
  if (b.dataset.thema) return go({tab:"thema:" + b.dataset.thema});
  if (b.dataset.back !== undefined) { if (depth > 0) history.back(); else go({tab:b.dataset.back || "start"}); return; }
  if (b.dataset.learn) return startSession(b.dataset.learn);
  if (b.dataset.scope) { learnScope = b.dataset.scope; session = null; render(); document.querySelector(`[data-scope="${CSS.escape(learnScope)}"]`)?.focus(); return; }
  if (b.hasAttribute("data-endsession")) { session = null; render(); $("h-main")?.focus(); return; }
  if (b.hasAttribute("data-reveal")) { session.shown = true; render(); const k = K.find(x => x.id === session.cards[session.i]); say("Antwort: " + (k ? k.antwort : "")); $("cardA")?.focus({preventScroll:true}); return; }
  if (b.dataset.grade) return grade(b.dataset.grade === "1");
  if (b.dataset.sol !== undefined) { const s = $("sol-" + b.dataset.sol), open = s.hidden; s.hidden = !open; b.setAttribute("aria-expanded", String(open)); b.textContent = open ? "Lösung verbergen" : "Lösung zeigen"; return; }
  if (b.dataset.u) return setUnderstood(b.dataset.uid, +b.dataset.u);
});
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); go({tab:"search"}); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || view.tab !== "learn" || !session || session.i >= session.cards.length) return;
  const a = document.activeElement; if (a && a !== document.body && a !== $("page") && a.id !== "h-main" && !a.closest(".flash")) return;
  if (e.key === " " && !session.shown) { e.preventDefault(); document.querySelector("[data-reveal]")?.click(); }
  else if (session.shown && e.key === "1") grade(false); else if (session.shown && e.key === "2") grade(true);
});

/* ---------- Daten aus dem Repo (Branch wks-data) ---------- */
async function fetchData(file) {
  const etag = (CFG.etag || {})[file];
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${file}?ref=${DATA_BRANCH}`, {cache:"no-store", headers:{Accept:"application/vnd.github.raw", ...(etag ? {"If-None-Match":etag} : {})}});
  if (r.status === 304) return {unchanged:true};
  if (r.status === 404) return {missing:true};
  if (r.status === 403 || r.status === 429) throw new Error("GitHub lässt gerade keine Anfragen zu. Versuch es in einer Stunde.");
  if (!r.ok) throw new Error("GitHub antwortet mit Fehler " + r.status + ".");
  const text = await r.text(); CFG.etag = {...(CFG.etag || {}), [file]:r.headers.get("ETag") || ""};
  return {data:JSON.parse(text)};
}
async function refresh(manual = false) {
  if (!manual && Date.now() - lastRefresh < 5 * 60e3) return;
  lastRefresh = Date.now();
  if (!navigator.onLine) { if (manual) { sync = {state:"err", msg:"Du bist offline."}; render(); } return; }
  try {
    if (manual) CFG.etag = {};
    const k = await fetchData("keys.json");
    if (k.data) { remoteKeys = k.data; lsSet(K_RKEYS, remoteKeys); } else if (k.missing) { remoteKeys = null; lsDel(K_RKEYS); }
    if (CFG.ready && privKey) {
      if (remoteKeys && remoteKeys.kid !== CFG.kid) throw new Error("Auf einem anderen Gerät wurde ein neues Passwort festgelegt. Melde dich unter Einstellungen ab und entsperre mit dem neuen Passwort.");
      if (remoteKeys && lsGet(K_KEYS, null)?.kid === remoteKeys.kid) lsDel(K_KEYS);
      const v = await fetchData("vault.enc.json");
      if (v.data) {
        if (v.data.kid && v.data.kid !== CFG.kid) throw new Error("Die Notizen sind noch für einen anderen Schlüssel verschlüsselt. Claude holt das beim nächsten Abendlauf nach.");
        let vault; try { vault = await WC.openVault(v.data, privKey); } catch { throw new Error("Die Notizen liessen sich nicht entschlüsseln."); }
        lsSet(K_CACHE, vault); setVault(vault, false);
      }
      if (CFG.token) await syncProgress().catch(() => {});
    }
    sync = {state:"", msg:""}; lsSet(K_CFG, CFG);
    if (manual && CFG.ready) toast(isDemo ? "Geladen. Noch keine Unterlagen verarbeitet." : "Auf dem neuesten Stand.");
  } catch (e) { sync = {state:"err", msg:e.message || "Laden hat nicht geklappt."}; }
  if (!(view.tab === "learn" && session) && view.tab !== "search") render();
}
async function unlockAndStore(keys, pass) {
  const priv = await WC.unlockKeys(keys, pass), prog = await WC.progressKey(pass, keys.kid);
  await KeyStore.set({priv, prog, kid:keys.kid});
  privKey = priv; progKey = prog; CFG.ready = true; CFG.kid = keys.kid; lsSet(K_CFG, CFG);
}

/* ---------- Lernstand-Abgleich (freiwillig, geheimes Gist) ---------- */
async function gh(path, opts = {}) {
  const r = await fetch("https://api.github.com" + path, {...opts, cache:"no-store", headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + CFG.token, "X-GitHub-Api-Version":"2022-11-28", ...(opts.body ? {"Content-Type":"application/json"} : {})}});
  if (r.status === 401) throw new Error("Der Token ist ungültig oder abgelaufen.");
  if (r.status === 403) throw new Error("GitHub verweigert den Zugriff. Hat der Token das Recht «gist»?");
  if (r.status === 404) throw Object.assign(new Error("Der Speicher für den Lernstand wurde nicht gefunden."), {missing:true});
  if (!r.ok) throw new Error("GitHub antwortet mit Fehler " + r.status + ".");
  return r.json();
}
async function syncProgress() {
  if (!progKey) return;
  if (!CFG.gistId) { for (let p = 1; p <= 5 && !CFG.gistId; p++) { const l = await gh(`/gists?per_page=100&page=${p}`); const g = l.find(x => x.description === PROG_DESC); if (g) CFG.gistId = g.id; if (l.length < 100) break; } }
  if (!CFG.gistId) { CFG.gistId = (await gh("/gists", {method:"POST", body:JSON.stringify({description:PROG_DESC, public:false, files:{[F_PROG]:{content:JSON.stringify(await WC.sealWithKey(PR, progKey))}}})})).id; lsSet(K_CFG, CFG); return; }
  let g; try { g = await gh("/gists/" + CFG.gistId); } catch (e) { if (e.missing) { CFG.gistId = ""; return syncProgress(); } throw e; }
  const f = g.files[F_PROG]; let remote = {};
  if (f) { let text = f.content; if (f.truncated) { const r = await fetch(f.raw_url); if (!r.ok) throw new Error("Lernstand unvollständig geladen."); text = await r.text(); }
    try { remote = await WC.openWithKey(JSON.parse(text), progKey); } catch { throw new Error("Der Lernstand wurde mit einem anderen Passwort gespeichert."); } }
  let changed = false;
  for (const [id, p] of Object.entries(remote || {})) if (!PR[id] || (+p.ts || 0) > (+PR[id].ts || 0)) { PR[id] = p; changed = true; }
  if (changed) lsSet(K_PROG, PR);
  if (Object.keys(PR).some(id => !remote[id] || (+PR[id].ts || 0) > (+remote[id].ts || 0))) await gh("/gists/" + CFG.gistId, {method:"PATCH", body:JSON.stringify({files:{[F_PROG]:{content:JSON.stringify(await WC.sealWithKey(PR, progKey))}}})});
}
let pushT = null;
function schedulePush(ms = 3000) { if (!CFG.token || !progKey || isDemo) return; clearTimeout(pushT); pushT = setTimeout(() => syncProgress().catch(() => setTimeout(() => schedulePush(), 60000)), ms); }

/* ---------- Start ---------- */
(async function start() {
  remoteKeys = lsGet(K_RKEYS, null);
  const ks = CFG.ready ? await KeyStore.get() : null;
  if (ks && ks.kid === CFG.kid) { privKey = ks.priv; progKey = ks.prog; } else if (CFG.ready) { CFG.ready = false; lsSet(K_CFG, CFG); }
  const cache = CFG.ready ? lsGet(K_CACHE, null) : null;
  setVault(cache || DEMO_VAULT, !cache);
  try { const s = history.state; if (s && s.v && s.v.tab) { view = s.v; depth = s.depth || 0; } else history.replaceState({v:view, depth:0}, ""); } catch {}
  render();
  refresh(true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) return; if (today() !== lastDay) { lastDay = today(); render(); } refresh(); });
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
