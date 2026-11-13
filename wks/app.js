"use strict";
/* WKS Wissen – Notizen im Stil eines Obsidian-Tresors aus Lionels Schulunterlagen.
   Daten: verschlüsselt im geheimen Gist «WKS Wissen (verschlüsselt)», auf dem Gerät zwischengespeichert. */
const APP_VERSION = "1.0.0";
const GIST_DESC = "WKS Wissen (verschlüsselt)", F_KEYS = "wks-keys.json", F_VAULT = "wks-vault.enc.json", F_PROG = "wks-progress.enc.json";
const K_CFG = "wks-sync-v1", K_CACHE = "wks-vault-cache-v1", K_PROG = "wks-progress-v1", K_UI = "wks-ui-v1";
const INTERVAL = [1, 1, 3, 7, 14, 30], NEW_PER_DAY = 20, EXAM_DAYS = 3;
const MON = ["Jan","Feb","März","Apr","Mai","Juni","Juli","Aug","Sep","Okt","Nov","Dez"], WD = ["So","Mo","Di","Mi","Do","Fr","Sa"];

/* ---------- Hilfen ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const str = v => typeof v === "string" ? v : v == null ? "" : String(v);
const arr = v => Array.isArray(v) ? v : [];
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const D = s => { const [y, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(y, m - 1, d, 12); };
const today = () => iso(new Date());
const daysUntil = s => Math.round((D(s) - D(today())) / 864e5);
const fmtDate = s => { const d = D(s); return WD[d.getDay()] + ", " + d.getDate() + ". " + MON[d.getMonth()] + " " + d.getFullYear(); };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const slug = s => str(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
const say = t => { $("live").textContent = ""; setTimeout(() => { $("live").textContent = t; }, 60); };
let toastT; function toast(t, ms = 3500) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, ms); }
const isMobile = () => matchMedia("(max-width:860px)").matches;

/* ---------- Zustand ---------- */
let CFG = lsGet(K_CFG, {token:"", pass:"", gistId:""});
let V = null, isDemo = true, PR = lsGet(K_PROG, {}), DUE = new Set();
let notes = new Map(), byTitle = new Map(), F = [], K = [], TE = [];
let UI = lsGet(K_UI, {open:{}, pane:"files"});
let view = {type:"home"}, session = null, learnScope = "faellig", query = "", privKey = null, syncState = "", lastDay = today();

/* ---------- Daten aufbereiten ---------- */
function clean(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    beispiel:!!o.beispiel, erstellt:str(o.erstellt), status:o.status && typeof o.status === "object" ? o.status : null,
    faecher:arr(o.faecher).filter(f => f && str(f.name).trim()).map(f => ({id:str(f.id) || slug(f.name), name:str(f.name), farbe:Math.abs(+f.farbe || 0) % 8, reihenfolge:+f.reihenfolge || 99, beispiel:!!f.beispiel})),
    themen:arr(o.themen).filter(t => t && str(t.titel).trim()).map(t => ({id:str(t.id), fach:str(t.fach), titel:str(t.titel).trim(), zusammenfassung:str(t.zusammenfassung), quelle:str(t.quelle),
      aktualisiert:/^\d{4}-\d{2}-\d{2}/.test(str(t.aktualisiert)) ? str(t.aktualisiert).slice(0, 10) : "", beispiel:!!t.beispiel,
      tags:arr(t.tags).map(x => slug(x)).filter(Boolean), kernpunkte:arr(t.kernpunkte).filter(p => typeof p === "string" && p.trim()),
      begriffe:arr(t.begriffe).filter(b => b && typeof b === "object" && str(b.begriff).trim()).map(b => ({begriff:str(b.begriff).trim(), erklaerung:str(b.erklaerung)}))})),
    karten:arr(o.karten).filter(k => k && str(k.frage).trim() && str(k.antwort).trim()).map(k => ({id:str(k.id), fach:str(k.fach), thema:str(k.thema), frage:str(k.frage), antwort:str(k.antwort)})),
    termine:arr(o.termine).filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(str(t.datum)) && str(t.titel).trim()).map(t => ({id:str(t.id), fach:str(t.fach), titel:str(t.titel), art:str(t.art) || "Termin", datum:str(t.datum), beispiel:!!t.beispiel})),
  };
}
const fachOf = id => F.find(f => f.id === id);
const fcol = f => `var(--c${f ? f.farbe : 0})`;
const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
function setVault(v, demo) {
  V = clean(v); isDemo = demo || !V.themen.length;
  if (isDemo && !demo) V = clean(DEMO_VAULT);
  F = V.faecher.sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, "de"));
  K = V.karten; TE = V.termine;
  notes = new Map(); byTitle = new Map();
  for (const t of V.themen) {
    const id = "t:" + t.id;
    notes.set(id, {id, type:"thema", src:t, title:t.titel, fach:t.fach, tags:t.tags, links:new Set(), unres:new Set(), back:new Map()});
  }
  for (const t of V.themen) for (const b of t.begriffe) {
    const id = "b:" + t.fach + ":" + slug(b.begriff);
    if (!notes.has(id)) notes.set(id, {id, type:"begriff", title:b.begriff, fach:t.fach, tags:["begriff"], erklaerung:b.erklaerung, links:new Set(), unres:new Set(), back:new Map()});
    notes.get("t:" + t.id).links.add(id);
  }
  for (const n of notes.values()) { const k = n.title.toLowerCase(); if (!byTitle.has(k) || n.type === "thema") byTitle.set(k, n.id); }
  // [[Links]] im Text auflösen
  for (const n of notes.values()) {
    if (n.type !== "thema") continue;
    const text = [n.src.zusammenfassung, ...n.src.kernpunkte].join("\n");
    for (const m of text.matchAll(LINK_RE)) { const target = resolve(m[1], n.fach); if (target && target !== n.id) n.links.add(target); else if (!target) n.unres.add(m[1].trim()); }
  }
  // Rückverweise mit Textstelle
  for (const n of notes.values()) for (const to of n.links) {
    const t = notes.get(to); if (!t) continue;
    let ctx = "";
    if (n.type === "thema") {
      const para = [n.src.zusammenfassung.split(/\n\s*\n/), n.src.kernpunkte].flat().find(p => p.toLowerCase().includes("[[" + t.title.toLowerCase()) || p.toLowerCase().includes(t.title.toLowerCase()));
      ctx = para ? para.replace(LINK_RE, (_, a, b) => b || a) : (n.src.begriffe.find(b => b.begriff === t.title) ? "Begriff in dieser Notiz" : "");
    }
    t.back.set(n.id, ctx);
  }
  computeDue();
}
function resolve(name, fach) {
  const k = str(name).trim().toLowerCase();
  const exact = byTitle.get(k); if (exact) return exact;
  const local = notes.get("b:" + fach + ":" + slug(name)); return local ? local.id : null;
}

/* ---------- Lernlogik ---------- */
const examSoon = fid => TE.some(t => t.fach === fid && t.datum >= today() && daysUntil(t.datum) <= EXAM_DAYS);
function computeDue() {
  const t = today(), due = [], fresh = [];
  for (const k of K) { const p = PR[k.id]; if (!p) fresh.push(k); else if (p.faellig <= t || (examSoon(k.fach) && p.zuletzt !== t)) due.push(k); }
  const newToday = Object.values(PR).filter(p => p.erstmals === t).length;
  const fe = fresh.filter(k => examSoon(k.fach)), fo = fresh.filter(k => !examSoon(k.fach)).slice(0, Math.max(NEW_PER_DAY - newToday, 0));
  DUE = new Set([...due, ...fe, ...fo].map(k => k.id));
  const n = DUE.size, b = $("dueBadge"); b.hidden = !n; b.innerHTML = (n > 99 ? "99+" : n) + `<span class="sr-only"> fällig</span>`;
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
  session = cards.length ? {cards:cards.map(c => c.id), i:0, shown:false, ok:0, again:0, retried:new Set(), counted:new Set(cards.filter(c => DUE.has(c.id) || !PR[c.id]).map(c => c.id))} : null;
  go({type:"learn"});
}
function grade(ok) {
  const id = session.cards[session.i], first = !session.retried.has(id);
  if (first) ok ? session.ok++ : session.again++;
  if (first && session.counted.has(id) && !isDemo) {
    const p = PR[id], t = today(), stufe = ok ? Math.min(((p && p.stufe) || 0) + 1, 5) : 0;
    const d = new Date(); d.setDate(d.getDate() + INTERVAL[stufe]);
    PR[id] = {stufe, faellig:iso(d), zuletzt:t, erstmals:(p && p.erstmals) || t, ts:Date.now()};
    lsSet(K_PROG, PR); schedulePush();
  }
  if (!ok && first) { session.retried.add(id); session.cards.push(id); }
  session.i++; session.shown = false; computeDue(); render();
  setTimeout(() => (document.querySelector("[data-reveal]") || document.querySelector("[data-learn]") || $("content")).focus({preventScroll:true}), 0);
}

/* ---------- Markdown (klein) ---------- */
function inline(s, fach) {
  let out = "", last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    out += fmt(s.slice(last, m.index));
    const target = resolve(m[1], fach), label = esc((m[2] || m[1]).trim());
    out += target ? `<button type="button" class="wl" data-open="${esc(target)}">${label}</button>` : `<span class="wl unres" title="Noch keine Notiz">${label}</span>`;
    last = m.index + m[0].length;
  }
  return out + fmt(s.slice(last));
}
const fmt = s => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
function md(text, fach) {
  return str(text).split(/\n\s*\n/).map(b => b.trim()).filter(Boolean).map(b => {
    if (/^##\s/.test(b)) return `<h2>${inline(b.replace(/^##\s*/, ""), fach)}</h2>`;
    const lines = b.split("\n");
    if (lines.every(l => /^\s*[-*]\s/.test(l))) return `<ul>${lines.map(l => `<li>${inline(l.replace(/^\s*[-*]\s/, ""), fach)}</li>`).join("")}</ul>`;
    return `<p>${lines.map(l => inline(l, fach)).join("<br>")}</p>`;
  }).join("");
}

/* ---------- Seitenleiste ---------- */
const ICON_DOC = `<svg class="doc-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z"/><path d="M14 3.5V8h4"/></svg>`;
const ICON_CAR = `<svg class="car" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
function renderFiles() {
  const cur = view.type === "note" ? view.id : null;
  const item = n => `<li><button type="button" class="node" data-open="${esc(n.id)}"${n.id === cur ? ` aria-current="page"` : ""}>${ICON_DOC}<span class="lbl">${esc(n.title)}</span></button></li>`;
  const folder = (key, label, inner, count, dot) => {
    const open = UI.open[key] !== false;
    return `<li><button type="button" class="node folder" data-folder="${esc(key)}" aria-expanded="${open}">${ICON_CAR}${dot || ""}<span class="lbl">${esc(label)}</span><span class="cnt">${count}</span></button>${open ? `<ul class="tree">${inner}</ul>` : ""}</li>`;
  };
  const html = F.map(f => {
    const th = [...notes.values()].filter(n => n.type === "thema" && n.fach === f.id).sort((a, b) => a.title.localeCompare(b.title, "de"));
    const be = [...notes.values()].filter(n => n.type === "begriff" && n.fach === f.id).sort((a, b) => a.title.localeCompare(b.title, "de"));
    const inner = th.map(item).join("") + (be.length ? folder(f.id + "/begriffe", "Begriffe", be.map(item).join(""), be.length) : "");
    return folder(f.id, f.name, inner, th.length, `<span class="fdot" style="--fc:${fcol(f)}"></span>`);
  }).join("");
  $("pane-files").innerHTML = (F.length ? `<ul class="tree">${html}</ul>` : `<p class="pane-note">Noch keine Fächer.</p>`) + `<button type="button" class="node" data-home style="margin-top:8px">${ICON_DOC}<span class="lbl">Übersicht</span></button>`;
}
function renderTags() {
  const c = new Map(); for (const n of notes.values()) for (const t of n.tags) c.set(t, (c.get(t) || 0) + 1);
  const list = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $("pane-tags").innerHTML = list.length ? list.map(([t, n]) => `<button type="button" class="tagrow" data-tag="${esc(t)}"><span>#${esc(t)}</span><span class="cnt">${n}</span></button>`).join("") : `<p class="pane-note">Noch keine Tags.</p>`;
}
function renderSearch() {
  const q = query.trim().toLowerCase(), res = $("qres"), note = $("qn");
  if (q.length < 2) { res.innerHTML = ""; note.textContent = `${plural([...notes.values()].length, "Notiz", "Notizen")} und ${plural(K.length, "Karte", "Karten")}`; return; }
  const hl = s => { const t = str(s).replace(LINK_RE, (_, a, b) => b || a), i = t.toLowerCase().indexOf(q); if (i < 0) return esc(t.slice(0, 100)); const a = Math.max(0, i - 40); return (a ? "… " : "") + esc(t.slice(a, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length, i + q.length + 60)) + " …"; };
  let hits;
  if (q.startsWith("#")) { const tg = slug(q.slice(1)); hits = [...notes.values()].filter(n => n.tags.some(t => t.startsWith(tg))).map(n => ({n, s:n.tags.map(t => "#" + t).join(" ")})); }
  else hits = [...notes.values()].map(n => {
    const parts = n.type === "thema" ? [n.title, n.src.zusammenfassung, ...n.src.kernpunkte, ...n.src.begriffe.map(b => b.begriff + ": " + b.erklaerung)] : [n.title, n.erklaerung];
    const m = parts.find(p => str(p).toLowerCase().includes(q)); return m ? {n, s:hl(m), score:n.title.toLowerCase().includes(q) ? 0 : 1} : null;
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  note.textContent = hits.length ? `${hits.length} Treffer` : `Nichts gefunden für «${query.trim()}».`;
  res.innerHTML = hits.slice(0, 60).map(h => { const f = fachOf(h.n.fach); return `<button type="button" class="hit" data-open="${esc(h.n.id)}"><b>${esc(h.n.title)}</b><span>${f ? esc(f.name) + " · " : ""}${h.s}</span></button>`; }).join("");
}
function setPane(p) {
  UI.pane = p; lsSet(K_UI, UI);
  for (const x of ["files", "search", "tags"]) { $("pane-" + x).hidden = x !== p; $("tab-" + x).setAttribute("aria-selected", String(x === p)); }
  if (p === "search") { renderSearch(); setTimeout(() => $("q").focus(), 50); }
  if (p === "tags") renderTags();
  if (p === "files") renderFiles();
}
function openSide(p) { if (p) setPane(p); if (isMobile()) { $("side").classList.add("open"); $("scrim").hidden = false; setTimeout(() => ($("side").querySelector("[aria-current]") || $("tab-" + UI.pane)).focus({preventScroll:true}), 60); } }
function closeSide() { $("side").classList.remove("open"); $("scrim").hidden = true; }

/* ---------- Ansichten ---------- */
function crumb(html) { $("crumb").innerHTML = html; }
function statusText() {
  if (isDemo) return CFG.token ? "Verbunden, noch keine Unterlagen" : "Beispiel";
  const s = V.status, when = s && s.letzteAktualisierung ? new Date(s.letzteAktualisierung) : V.erstellt ? new Date(V.erstellt) : null;
  return when ? "Stand " + when.toLocaleString("de-CH", {day:"numeric", month:"numeric", hour:"2-digit", minute:"2-digit"}) : "";
}
function renderHome() {
  crumb(`<b>Übersicht</b>`);
  const next = TE.filter(t => t.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum))[0];
  const recent = [...notes.values()].filter(n => n.type === "thema").sort((a, b) => b.src.aktualisiert.localeCompare(a.src.aktualisiert)).slice(0, 6);
  let h = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">WKS Wissen</h1><p class="muted small">${esc(statusText())}</p>`;
  if (!CFG.token) h += `<div class="callout"><div class="callout-t">Einrichten</div><p>Das ist ein Beispiel. Verbinde die App einmal mit deinem Token und einem Passwort, dann erscheinen hier deine echten Unterlagen.</p><div><button class="btn primary" type="button" data-go="settings">Jetzt einrichten</button></div></div>`;
  else if (isDemo) h += `<div class="callout warn"><div class="callout-t">Noch keine Unterlagen</div><p>Leg PDFs, Word- oder PowerPoint-Dateien in deinen OneDrive-Ordner <b>WKS</b>, am besten in einen Unterordner pro Fach. Jeden Abend um 18:37 Uhr mache ich daraus Notizen und Karteikarten. Bis dahin siehst du ein Beispiel.</p></div>`;
  if (syncState === "err") h += `<div class="callout err"><div class="callout-t">Verbindung</div><p>${esc(CFG.lastErr || "Laden hat nicht geklappt.")} Du siehst den letzten gespeicherten Stand.</p></div>`;
  if (next) { const n = daysUntil(next.datum), f = fachOf(next.fach); h += `<div class="callout${n <= EXAM_DAYS ? " err" : ""}"><div class="callout-t">${n === 0 ? "Heute" : n === 1 ? "Morgen" : `In ${n} Tagen`}: ${esc(next.titel)}${next.beispiel || isDemo ? ` <span class="example">Beispiel</span>` : ""}</div><p class="small">${esc(fmtDate(next.datum))}${f ? " · " + esc(f.name) : ""}</p>${f ? `<div><button class="btn" type="button" data-learn="fach:${esc(f.id)}">Dafür üben</button></div>` : ""}</div>`; }
  if (DUE.size) h += `<button class="btn primary" type="button" data-learn="faellig">${plural(DUE.size, "Karte", "Karten")} üben</button>`;
  h += `<div class="section"><div class="section-h"><span>Fächer</span></div><div class="home-grid">${F.map(f => { const th = [...notes.values()].filter(n => n.type === "thema" && n.fach === f.id).length, kc = K.filter(k => k.fach === f.id).length;
    return `<button type="button" class="fcard" data-fach="${esc(f.id)}" style="--fc:${fcol(f)}"><b>${esc(f.name)}</b><span>${plural(th, "Notiz", "Notizen")} · ${plural(kc, "Karte", "Karten")}</span></button>`; }).join("")}</div></div>`;
  if (recent.length) h += `<div class="section"><div class="section-h"><span>Zuletzt geändert</span></div><div class="bl">${recent.map(n => `<button type="button" data-open="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc((fachOf(n.fach) || {}).name || "")}${n.src.aktualisiert ? " · " + esc(fmtDate(n.src.aktualisiert)) : ""}</span></button>`).join("")}</div></div>`;
  $("content").innerHTML = h + `</div>`;
}
function renderFach(id) {
  const f = fachOf(id); if (!f) return renderHome();
  crumb(`<b>${esc(f.name)}</b>`);
  const th = [...notes.values()].filter(n => n.type === "thema" && n.fach === id).sort((a, b) => a.title.localeCompare(b.title, "de"));
  const kc = K.filter(k => k.fach === id).length, te = TE.filter(t => t.fach === id && t.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum));
  $("content").innerHTML = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">${esc(f.name)}</h1>
    <dl class="props"><div class="prop"><dt>Notizen</dt><dd>${th.length}</dd></div><div class="prop"><dt>Karten</dt><dd>${kc}</dd></div>${te[0] ? `<div class="prop"><dt>Nächster Termin</dt><dd>${esc(te[0].titel)} · ${esc(fmtDate(te[0].datum))}</dd></div>` : ""}</dl>
    ${kc ? `<div class="row"><button class="btn primary" type="button" data-learn="fach:${esc(id)}">${plural(kc, "Karte", "Karten")} üben</button></div>` : ""}
    <div class="bl">${th.map(n => `<button type="button" data-open="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc(n.src.zusammenfassung.replace(LINK_RE, (_, a, b) => b || a).slice(0, 140))}</span></button>`).join("") || `<p class="muted">Noch keine Notizen.</p>`}</div></div>`;
}
function renderNote(id) {
  const n = notes.get(id); if (!n) return renderHome();
  const f = fachOf(n.fach);
  crumb(`${f ? esc(f.name) + " / " : ""}${n.type === "begriff" ? "Begriffe / " : ""}<b>${esc(n.title)}</b>`);
  let h = `<article class="doc"><h1 class="note-title" id="h-main" tabindex="-1">${esc(n.title)}</h1>`;
  const props = [];
  if (f) props.push(["Fach", `<button type="button" class="wl" data-fach="${esc(f.id)}"><span class="fdot" style="--fc:${fcol(f)};display:inline-block;margin-right:6px"></span>${esc(f.name)}</button>`]);
  if (n.tags.length) props.push(["Tags", n.tags.map(t => `<button type="button" class="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")]);
  if (n.type === "thema") { if (n.src.quelle) props.push(["Quelle", esc(n.src.quelle)]); if (n.src.aktualisiert) props.push(["Geändert", esc(fmtDate(n.src.aktualisiert))]); }
  if (isDemo) props.push(["Status", `<span class="example">Beispiel</span>`]);
  h += `<dl class="props">${props.map(([k, v]) => `<div class="prop"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl><div class="md">`;
  if (n.type === "thema") {
    h += md(n.src.zusammenfassung, n.fach);
    if (n.src.kernpunkte.length) h += `<h2>Das Wichtigste</h2><ul>${n.src.kernpunkte.map(p => `<li>${inline(p, n.fach)}</li>`).join("")}</ul>`;
    if (n.src.begriffe.length) h += `<h2>Begriffe</h2><ul>${n.src.begriffe.map(b => { const t = notes.get("b:" + n.fach + ":" + slug(b.begriff)); return `<li>${t ? `<button type="button" class="wl" data-open="${esc(t.id)}">${esc(b.begriff)}</button>` : esc(b.begriff)}: ${fmt(b.erklaerung)}</li>`; }).join("")}</ul>`;
  } else h += md(n.erklaerung || "Keine Erklärung.", n.fach);
  h += `</div>`;
  const ks = n.type === "thema" ? K.filter(k => k.thema === n.src.id) : [];
  if (ks.length) h += `<div class="section"><div class="section-h"><span>Karteikarten</span><span>${ks.length}</span></div><div class="row"><button class="btn primary" type="button" data-learn="thema:${esc(n.src.id)}">${plural(ks.length, "Karte", "Karten")} üben</button></div></div>`;
  const out = [...n.links].map(x => notes.get(x)).filter(x => x && x.type === "thema");
  if (out.length) h += `<div class="section"><div class="section-h"><span>Verlinkt</span><span>${out.length}</span></div><div class="bl">${out.map(x => `<button type="button" data-open="${esc(x.id)}"><b>${esc(x.title)}</b></button>`).join("")}</div></div>`;
  const back = [...n.back.entries()].map(([k, ctx]) => [notes.get(k), ctx]).filter(([x]) => x);
  h += `<div class="section"><div class="section-h"><span>Rückverweise</span><span>${back.length}</span></div>${back.length ? `<div class="bl">${back.map(([x, ctx]) => `<button type="button" data-open="${esc(x.id)}"><b>${esc(x.title)}</b>${ctx ? `<span>${esc(ctx.slice(0, 160))}</span>` : ""}</button>`).join("")}</div>` : `<p class="muted small">Keine Notiz verlinkt hierher.</p>`}</div>`;
  $("content").innerHTML = h + `</article>`;
}
function renderLearn() {
  crumb(`<b>Lernen</b>`);
  let h = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">Lernen</h1>`;
  if (isDemo) h += `<div class="callout warn"><p>Beispielkarten: Dein Lernstand wird erst mit echten Unterlagen gespeichert.</p></div>`;
  if (!K.length) { $("content").innerHTML = h + `<p class="muted">Noch keine Karten.</p></div>`; return; }
  const scopes = [["faellig", "Fällig", DUE.size], ["alle", "Alle", K.length], ...F.map(f => ["fach:" + f.id, f.name, K.filter(k => k.fach === f.id).length]).filter(x => x[2])];
  const custom = learnScope.startsWith("thema:") ? notes.get("t:" + learnScope.slice(6)) : null;
  h += `<div class="scope" role="group" aria-label="Welche Karten">${scopes.map(([id, name, n]) => `<button type="button" data-scope="${esc(id)}" aria-pressed="${learnScope === id}">${esc(name)} <span class="n">${n}</span></button>`).join("")}${custom ? `<button type="button" aria-pressed="true" data-scope="${esc(learnScope)}">${esc(custom.title)}</button>` : ""}</div>`;
  if (!session) {
    const n = scopeCards(learnScope).length, box = [0, 0, 0, 0, 0, 0];
    K.forEach(k => { const p = PR[k.id]; box[!p ? 0 : Math.max(1, Math.min(p.stufe || 0, 5))]++; });
    const waiting = K.filter(k => !PR[k.id] && !DUE.has(k.id)).length;
    h += `<p>${n ? `${plural(n, "Karte", "Karten")} bereit.` : learnScope === "faellig" ? "Heute ist nichts mehr fällig. Gut gemacht." : "Keine Karten in dieser Auswahl."}${learnScope === "faellig" && waiting ? ` ${waiting} weitere neue Karten kommen in den nächsten Tagen dazu, höchstens ${NEW_PER_DAY} pro Tag.` : ""}</p>
      <div class="row">${n ? `<button class="btn primary" type="button" data-learn="${esc(learnScope)}">Los geht's</button>` : learnScope === "faellig" ? `<button class="btn" type="button" data-learn="alle">Trotzdem alle wiederholen</button>` : ""}</div>
      ${learnScope !== "faellig" && n ? `<p class="small muted">Freiwilliges Üben: Nur fällige oder neue Karten rücken eine Stufe weiter.</p>` : ""}
      <div class="section"><div class="section-h"><span>Dein Stand</span></div><div class="boxes">${box.map((c, i) => `<div><b class="num">${c}</b><span>${["Neu", "1 Tag", "3 Tage", "1 Woche", "2 Wochen", "Sitzt"][i]}</span></div>`).join("")}</div>
      <p class="small muted">Gewusste Karten kommen nach 1, 3, 7, 14 und 30 Tagen wieder. Nicht gewusste kommen am Ende der Runde nochmals und morgen wieder. Drei Tage vor einer Prüfung wird das ganze Fach fällig.</p></div>`;
    $("content").innerHTML = h + `</div>`; return;
  }
  if (session.i >= session.cards.length) {
    const tot = session.ok + session.again;
    h += `<div class="callout"><div class="callout-t">Runde fertig</div><p><b>${session.ok}</b> von ${tot} beim ersten Versuch gewusst${tot ? ` (${Math.round(session.ok / tot * 100)} %)` : ""}.${session.again ? ` ${plural(session.again, "Karte kommt", "Karten kommen")} morgen wieder.` : ""}</p><div class="row"><button class="btn primary" type="button" data-learn="${esc(learnScope)}">Nochmals üben</button><button class="btn" type="button" data-endsession>Fertig</button></div></div>`;
    $("content").innerHTML = h + `</div>`; say(`Runde fertig. ${session.ok} von ${tot} gewusst.`); return;
  }
  const k = K.find(x => x.id === session.cards[session.i]); if (!k) { session.i++; return renderLearn(); }
  const f = fachOf(k.fach), th = notes.get("t:" + k.thema);
  h += `<div class="progress" aria-hidden="true"><div style="width:${session.i / session.cards.length * 100}%"></div></div><p class="small muted num">Karte ${session.i + 1} von ${session.cards.length}</p>
    <section class="flash" aria-label="Karteikarte" style="--fc:${fcol(f)}"><div class="small muted">${f ? esc(f.name) : ""}${th ? " · " + esc(th.title) : ""}</div><div class="q" id="cardQ">${esc(k.frage)}</div>
    ${session.shown ? `<div class="a" id="cardA" tabindex="-1">${esc(k.antwort)}</div><div class="acts"><button class="btn" type="button" data-grade="0" aria-keyshortcuts="1">Nicht gewusst</button><button class="btn good" type="button" data-grade="1" aria-keyshortcuts="2">Gewusst</button></div>`
    : `<div class="acts one"><button class="btn primary" type="button" data-reveal aria-keyshortcuts="Space" aria-describedby="cardQ">Antwort zeigen</button></div>`}
    <p class="keys">Tastatur: Leertaste zeigt die Antwort, 1 = nicht gewusst, 2 = gewusst.</p></section>`;
  $("content").innerHTML = h + `</div>`;
}
function renderDates() {
  crumb(`<b>Termine</b>`);
  const up = TE.filter(t => t.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum)), past = TE.filter(t => t.datum < today()).sort((a, b) => b.datum.localeCompare(a.datum));
  const row = t => { const d = D(t.datum), f = fachOf(t.fach), n = daysUntil(t.datum);
    return `<button class="term" type="button" ${f ? `data-fach="${esc(f.id)}"` : "disabled"}><span class="date" aria-hidden="true"><span>${WD[d.getDay()]}</span><b class="num">${d.getDate()}</b><span>${MON[d.getMonth()]}</span></span><span><span class="t">${esc(t.titel)}</span><span class="s">${esc(t.art)}${f ? " · " + esc(f.name) : ""}${t.beispiel || isDemo ? ` <span class="example">Beispiel</span>` : ""}<span class="sr-only">, ${esc(fmtDate(t.datum))}</span></span></span>${n >= 0 ? `<span class="pill ${n <= EXAM_DAYS ? "bad" : n <= 10 ? "warn" : "neutral"}">${n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`}</span>` : "<span></span>"}</button>`; };
  $("content").innerHTML = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">Termine</h1>
    ${up.length ? `<div>${up.map(row).join("")}</div>` : `<p class="muted">Keine kommenden Termine. Ich erkenne Prüfungsdaten, wenn sie in deinen Unterlagen stehen.</p>`}
    ${past.length ? `<details class="section"><summary class="section-h" style="cursor:pointer;min-height:40px;align-items:center">Vergangen (${past.length})</summary><div>${past.map(row).join("")}</div></details>` : ""}</div>`;
}
function renderSettings() {
  crumb(`<b>Einstellungen</b>`);
  const budget = lsGet("lionel-budget-sync-v1", null), hasBudgetToken = budget && budget.token;
  const on = !!(CFG.token && CFG.pass);
  $("content").innerHTML = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">Einstellungen</h1>
    <div class="section"><div class="section-h"><span>Verbindung</span></div>
    ${on ? `<p>Verbunden. ${esc(statusText())}.</p><p class="status ${syncState === "err" ? "err" : ""}" id="syncMsg" role="status">${syncState === "err" ? esc(CFG.lastErr || "") : ""}</p>
      <div class="row"><button class="btn" type="button" id="btnRefresh">Jetzt neu laden</button><button class="btn danger" type="button" id="btnDisconnect">Auf diesem Gerät trennen</button></div>`
    : `<p>Deine Notizen liegen verschlüsselt in einem geheimen Gist auf GitHub. Gib einmal deinen Token und ein Passwort ein. Auf dem zweiten Gerät dieselben Angaben.</p>
      <ol class="steps"><li>${hasBudgetToken ? "Den Token kannst du aus der Budget-App übernehmen (Knopf unten)." : `Token erstellen: <a href="https://github.com/settings/tokens/new?scopes=gist&amp;description=WKS-und-Budget" target="_blank" rel="noopener">diesen Link öffnen</a>, «No expiration» wählen, ganz unten «Generate token», Token kopieren.`}</li>
      <li>Passwort wählen und merken. Ohne Passwort kann niemand, auch du nicht, die Notizen lesen.</li></ol>
      <label class="field"><span>GitHub-Token</span><input id="cfgToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…"></label>
      ${hasBudgetToken ? `<div><button class="btn" type="button" id="btnBudgetToken">Token aus der Budget-App übernehmen</button></div>` : ""}
      <label class="field"><span>Passwort</span><input id="cfgPass" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>
      <div class="row"><button class="btn primary" type="button" id="btnConnect">Verbinden</button></div><p class="status" id="syncMsg" role="status"></p>`}
    </div>
    <div class="section"><div class="section-h"><span>So kommen Unterlagen hinein</span></div><p>Leg PDFs, Word- oder PowerPoint-Dateien in deinen OneDrive-Ordner <b>WKS</b>, am besten in einen Unterordner pro Fach (z. B. <b>WKS › Französisch</b>). Jeden Abend um 18:37 Uhr erstelle ich daraus Notizen, Begriffe, Karteikarten und Termine.</p></div>
    <div class="section"><div class="section-h"><span>App</span></div><p class="small muted">WKS Wissen ${APP_VERSION} · Lernstand: ${Object.keys(PR).length} Karten gelernt.</p></div></div>`;
  const msg = t => { const m = $("syncMsg"); if (m) { m.className = "status err"; m.textContent = t; } };
  $("btnBudgetToken") && ($("btnBudgetToken").onclick = () => { $("cfgToken").value = budget.token; toast("Token übernommen."); });
  $("btnConnect") && ($("btnConnect").onclick = async () => {
    const token = $("cfgToken").value.trim(), pass = $("cfgPass").value;
    if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/.test(token)) { msg("Das sieht nicht nach einem GitHub-Token aus. Er beginnt mit «ghp_»."); $("cfgToken").focus(); return; }
    if (pass.length < 6) { msg("Wähl ein Passwort mit mindestens 6 Zeichen."); $("cfgPass").focus(); return; }
    const b = $("btnConnect"); b.disabled = true; const m = $("syncMsg"); m.className = "status"; m.textContent = "Verbinde …";
    const err = await connect(token, pass); b.disabled = false;
    if (err) msg(err); else { toast("Verbunden."); go({type:"home"}); }
  });
  $("btnRefresh") && ($("btnRefresh").onclick = async () => { await refresh(true); render(); });
  $("btnDisconnect") && ($("btnDisconnect").onclick = () => {
    const b = $("btnDisconnect");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Wirklich trennen? Nochmals tippen"; return; }
    CFG = {token:"", pass:"", gistId:""}; privKey = null; lsSet(K_CFG, CFG); try { localStorage.removeItem(K_CACHE); } catch {}
    setVault(DEMO_VAULT, true); toast("Getrennt."); go({type:"home"});
  });
}

/* ---------- Graph ---------- */
let G = null;
function renderGraph() {
  crumb(`<b>Graph</b>`);
  const c = $("content"); c.classList.add("graph-mode");
  const showB = UI.graphBegriffe !== false;
  c.innerHTML = `<div class="graph-wrap"><canvas id="graph" role="img" aria-label="Graph aller Notizen und ihrer Verbindungen. Antippen öffnet eine Notiz."></canvas>
    <div class="graph-ui"><button type="button" class="gchip" id="gB" aria-pressed="${showB}">Begriffe</button><button type="button" class="gchip" id="gFit">Alles zeigen</button></div>
    <div class="graph-legend">${F.map(f => `<span><span class="fdot" style="--fc:${fcol(f)}"></span>${esc(f.name)}</span>`).join("")}</div><div class="graph-tip" id="gTip" hidden></div></div>`;
  $("gB").onclick = () => { UI.graphBegriffe = !showB; lsSet(K_UI, UI); renderGraph(); };
  $("gFit").onclick = () => G && fitGraph();
  startGraph(showB);
}
function startGraph(showB) {
  if (G) cancelAnimationFrame(G.raf);
  const cv = $("graph"), cs = getComputedStyle(document.documentElement), col = v => cs.getPropertyValue(v).trim();
  const list = [...notes.values()].filter(n => showB || n.type === "thema");
  const idx = new Map(list.map((n, i) => [n.id, i]));
  const edges = []; const seen = new Set();
  list.forEach(n => n.links.forEach(t => { if (!idx.has(t)) return; const a = idx.get(n.id), b = idx.get(t), k = a < b ? a + "-" + b : b + "-" + a; if (!seen.has(k)) { seen.add(k); edges.push([a, b]); } }));
  const deg = list.map(() => 0); edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
  const N = list.map((n, i) => { const f = fachOf(n.fach), ang = i / Math.max(list.length, 1) * Math.PI * 2; return {n, x:Math.cos(ang) * 120 + Math.random() * 20, y:Math.sin(ang) * 120 + Math.random() * 20, vx:0, vy:0, r:(n.type === "thema" ? 6 : 3.5) + Math.min(deg[i], 8) * .7, color:col("--c" + (f ? f.farbe : 0)), deg:deg[i]}; });
  G = {cv, N, E:edges, scale:1, tx:0, ty:0, alpha:1, hover:-1, drag:null, ptrs:new Map(), fg:col("--fg"), line:col("--line"), muted:col("--muted"), bg:col("--bg"), raf:0, fitted:false};
  const resize = () => { const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; G.w = r.width; G.h = r.height; G.dpr = dpr; };
  resize(); new ResizeObserver(() => { resize(); draw(); }).observe(cv);
  const toWorld = (x, y) => [(x - G.w / 2 - G.tx) / G.scale, (y - G.h / 2 - G.ty) / G.scale];
  const hit = (x, y) => { const [wx, wy] = toWorld(x, y); let best = -1, bd = 1e9; G.N.forEach((p, i) => { const d = Math.hypot(p.x - wx, p.y - wy); if (d < p.r + 10 / G.scale && d < bd) { bd = d; best = i; } }); return best; };
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); G.ptrs.set(e.pointerId, [x, y]);
    if (G.ptrs.size === 1) { const i = hit(x, y); G.drag = {i, x, y, sx:x, sy:y, moved:false, tx:G.tx, ty:G.ty}; cv.classList.add("drag"); }
    else { G.drag = null; const p = [...G.ptrs.values()]; G.pinch = {d:Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), s:G.scale}; } };
  cv.onpointermove = e => { const [x, y] = pos(e);
    if (G.ptrs.has(e.pointerId)) G.ptrs.set(e.pointerId, [x, y]);
    if (G.pinch && G.ptrs.size === 2) { const p = [...G.ptrs.values()]; G.scale = Math.min(4, Math.max(.2, G.pinch.s * Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) / G.pinch.d)); draw(); return; }
    if (G.drag) { const d = G.drag; if (Math.hypot(x - d.sx, y - d.sy) > 5) d.moved = true;
      if (d.i >= 0 && d.moved) { const [wx, wy] = toWorld(x, y); const p = G.N[d.i]; p.x = wx; p.y = wy; p.vx = p.vy = 0; G.alpha = Math.max(G.alpha, .3); }
      else if (d.i < 0) { G.tx = d.tx + x - d.sx; G.ty = d.ty + y - d.sy; draw(); } return; }
    const i = hit(x, y); if (i !== G.hover) { G.hover = i; const tip = $("gTip"); if (i >= 0) { tip.textContent = G.N[i].n.title; tip.hidden = false; tip.style.left = x + 12 + "px"; tip.style.top = y + 12 + "px"; } else tip.hidden = true; draw(); } };
  const up = e => { G.ptrs.delete(e.pointerId); if (G.ptrs.size < 2) G.pinch = null;
    const d = G.drag; G.drag = null; cv.classList.remove("drag");
    if (d && !d.moved && d.i >= 0) go({type:"note", id:G.N[d.i].n.id}); };
  cv.onpointerup = up; cv.onpointercancel = up;
  cv.onpointerleave = () => { G.hover = -1; $("gTip") && ($("gTip").hidden = true); draw(); };
  cv.onwheel = e => { e.preventDefault(); const [x, y] = pos(e), [wx, wy] = toWorld(x, y); G.scale = Math.min(4, Math.max(.2, G.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); G.tx = x - G.w / 2 - wx * G.scale; G.ty = y - G.h / 2 - wy * G.scale; draw(); };
  const tick = () => {
    if (!document.body.contains(cv)) return;
    if (G.alpha > .02) {
      const n = G.N.length;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const a = G.N[i], b = G.N[j]; let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy || .01; if (d2 > 90000) continue; const f = 900 / d2 * G.alpha; dx *= f; dy *= f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy; }
      for (const [i, j] of G.E) { const a = G.N[i], b = G.N[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 70) / d * .06 * G.alpha; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
      for (let i = 0; i < n; i++) { const p = G.N[i]; if (G.drag && G.drag.i === i && G.drag.moved) continue; p.vx -= p.x * .006 * G.alpha; p.vy -= p.y * .006 * G.alpha; p.vx *= .55; p.vy *= .55; p.x += p.vx; p.y += p.vy; }
      G.alpha *= .985; if (!G.fitted && G.alpha < .3) { G.fitted = true; fitGraph(); }
      draw();
    }
    G.raf = requestAnimationFrame(tick);
  };
  G.raf = requestAnimationFrame(tick);
  draw();
}
function fitGraph() {
  if (!G || !G.N.length) return;
  const xs = G.N.map(p => p.x), ys = G.N.map(p => p.y), w = Math.max(...xs) - Math.min(...xs) + 80, h = Math.max(...ys) - Math.min(...ys) + 80;
  G.scale = Math.min(2, Math.max(.2, Math.min(G.w / w, G.h / h)));
  G.tx = -(Math.max(...xs) + Math.min(...xs)) / 2 * G.scale; G.ty = -(Math.max(...ys) + Math.min(...ys)) / 2 * G.scale; draw();
}
function draw() {
  if (!G) return; const {cv, N, E} = G, ctx = cv.getContext("2d");
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0); ctx.clearRect(0, 0, G.w, G.h);
  ctx.translate(G.w / 2 + G.tx, G.h / 2 + G.ty); ctx.scale(G.scale, G.scale);
  const hv = G.hover, near = new Set(); if (hv >= 0) { near.add(hv); E.forEach(([a, b]) => { if (a === hv) near.add(b); if (b === hv) near.add(a); }); }
  ctx.lineWidth = 1 / G.scale;
  for (const [a, b] of E) { const on = hv >= 0 && (a === hv || b === hv); ctx.strokeStyle = on ? N[hv].color : G.line; ctx.globalAlpha = hv >= 0 && !on ? .35 : 1; ctx.beginPath(); ctx.moveTo(N[a].x, N[a].y); ctx.lineTo(N[b].x, N[b].y); ctx.stroke(); }
  N.forEach((p, i) => { ctx.globalAlpha = hv >= 0 && !near.has(i) ? .3 : 1; ctx.fillStyle = p.n.type === "begriff" ? G.muted : p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
  ctx.globalAlpha = 1; ctx.fillStyle = G.fg; ctx.textAlign = "center"; ctx.font = `${12 / Math.max(G.scale, .6)}px -apple-system,Segoe UI,sans-serif`;
  N.forEach((p, i) => { if (G.scale > .9 || p.deg >= 3 || near.has(i)) { ctx.globalAlpha = hv >= 0 && !near.has(i) ? .3 : .9; ctx.fillText(p.n.title.length > 28 ? p.n.title.slice(0, 27) + "…" : p.n.title, p.x, p.y + p.r + 13 / Math.max(G.scale, .6)); } });
  ctx.globalAlpha = 1;
}

/* ---------- Navigation ---------- */
function render() {
  const c = $("content"); c.classList.remove("graph-mode");
  if (view.type !== "graph" && G) { cancelAnimationFrame(G.raf); G = null; }
  document.querySelectorAll(".ribbon [data-view]").forEach(b => b.setAttribute("aria-current", String(b.dataset.view === view.type)));
  document.querySelector(".ribbon [data-pane='files']").setAttribute("aria-current", String(["home", "note", "fach"].includes(view.type)));
  ({home:renderHome, note:() => renderNote(view.id), fach:() => renderFach(view.id), graph:renderGraph, learn:renderLearn, dates:renderDates, settings:renderSettings})[view.type]();
  $("backBtn").hidden = history.state && history.state.depth > 0 ? false : true;
  $("vaultInfo").textContent = statusText();
  $("syncDot").className = "sync " + (syncState === "busy" ? "busy" : syncState === "err" ? "err" : CFG.token && !isDemo ? "ok" : "");
  $("syncDot").title = syncState === "err" ? "Verbindungsproblem" : CFG.token ? "Verbunden" : "Nicht verbunden";
  if (UI.pane === "files") renderFiles(); else if (UI.pane === "tags") renderTags(); else renderSearch();
}
let depth = 0;
function go(v, {replace = false} = {}) {
  view = v; if (v.type !== "learn" && session && session.i >= session.cards.length) session = null;
  try { if (replace) history.replaceState({v, depth}, ""); else history.pushState({v, depth:++depth}, ""); } catch {}
  closeSide(); render(); $("content").scrollTop = 0;
  setTimeout(() => (document.querySelector("[data-reveal]") || $("h-main") || $("content")).focus({preventScroll:true}), 0);
}
window.addEventListener("popstate", e => { const s = e.state; view = s && s.v ? s.v : {type:"home"}; depth = s ? s.depth || 0 : 0; render(); setTimeout(() => ($("h-main") || $("content")).focus({preventScroll:true}), 0); });

document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  if (b.dataset.open) return go({type:"note", id:b.dataset.open});
  if (b.dataset.fach) return go({type:"fach", id:b.dataset.fach});
  if (b.hasAttribute("data-home")) return go({type:"home"});
  if (b.dataset.go) return go({type:b.dataset.go});
  if (b.dataset.folder) { const k = b.dataset.folder; UI.open[k] = UI.open[k] === false; lsSet(K_UI, UI); renderFiles(); document.querySelector(`[data-folder="${CSS.escape(k)}"]`)?.focus(); return; }
  if (b.dataset.tag) { query = "#" + b.dataset.tag; $("q").value = query; openSide("search"); if (!isMobile()) setPane("search"); return; }
  if (b.dataset.pane) { if (isMobile() && b.closest(".ribbon")) return openSide(b.dataset.pane); return setPane(b.dataset.pane); }
  if (b.dataset.view) return go({type:b.dataset.view});
  if (b.dataset.scope) { learnScope = b.dataset.scope; session = null; render(); document.querySelector(`[data-scope="${CSS.escape(learnScope)}"]`)?.focus(); return; }
  if (b.dataset.learn) return startSession(b.dataset.learn);
  if (b.hasAttribute("data-endsession")) { session = null; render(); return; }
  if (b.hasAttribute("data-reveal")) { session.shown = true; render(); const k = K.find(x => x.id === session.cards[session.i]); say("Antwort: " + (k ? k.antwort : "")); $("cardA")?.focus({preventScroll:true}); return; }
  if (b.dataset.grade) return grade(b.dataset.grade === "1");
});
$("backBtn").onclick = () => history.back();
$("menuBtn").onclick = () => openSide("files");
$("sideClose").onclick = closeSide;
$("scrim").onclick = closeSide;
$("q").addEventListener("input", e => { query = e.target.value; renderSearch(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && $("side").classList.contains("open")) { closeSide(); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSide("search"); setPane("search"); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || view.type !== "learn" || !session || session.i >= session.cards.length) return;
  const a = document.activeElement; if (a && a !== document.body && a !== $("content") && !a.closest(".flash")) return;
  if (e.key === " " && !session.shown) { e.preventDefault(); document.querySelector("[data-reveal]")?.click(); }
  else if (session.shown && e.key === "1") grade(false); else if (session.shown && e.key === "2") grade(true);
});

/* ---------- Verbindung zum verschlüsselten Gist ---------- */
async function gh(path, opts = {}, token = CFG.token) {
  const r = await fetch("https://api.github.com" + path, {...opts, cache:"no-store", headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + token, "X-GitHub-Api-Version":"2022-11-28", ...(opts.body ? {"Content-Type":"application/json"} : {})}});
  if (r.status === 401) throw new Error("Der Token ist ungültig oder abgelaufen.");
  if (r.status === 403) throw new Error("GitHub verweigert den Zugriff. Hat der Token das Recht «gist»?");
  if (r.status === 404) throw Object.assign(new Error("Das Gist wurde nicht gefunden."), {missing:true});
  if (!r.ok) throw new Error("GitHub antwortet mit Fehler " + r.status + ".");
  return r.json();
}
async function fileText(f) { return f.truncated || f.content == null ? (await fetch(f.raw_url, {cache:"no-store"})).text() : f.content; }
async function findGist(token) {
  for (let p = 1; p <= 5; p++) { const l = await gh(`/gists?per_page=100&page=${p}`, {}, token); const g = l.find(x => x.description === GIST_DESC); if (g) return g.id; if (l.length < 100) break; }
  return "";
}
async function connect(token, pass) {
  if (!window.crypto || !crypto.subtle) return "Dieser Browser kann nicht verschlüsseln. Öffne die App über https.";
  try {
    let id = await findGist(token), keys = null;
    if (id) { const g = await gh("/gists/" + id, {}, token); if (g.files[F_KEYS]) keys = JSON.parse(await fileText(g.files[F_KEYS])); }
    if (keys) { try { privKey = await WC.unlockKeys(keys, pass); } catch { return "Falsches Passwort. Es muss auf allen Geräten gleich sein."; } }
    else {
      const k = await WC.createKeys(pass); privKey = k.privateKey;
      const files = {[F_KEYS]:{content:JSON.stringify(k.file)}, "LIESMICH.md":{content:"Verschlüsselte Daten der App WKS Wissen. Ohne Lionels Passwort nicht lesbar. Nicht löschen."}};
      if (id) await gh("/gists/" + id, {method:"PATCH", body:JSON.stringify({files})}, token);
      else id = (await gh("/gists", {method:"POST", body:JSON.stringify({description:GIST_DESC, public:false, files})}, token)).id;
    }
    CFG = {token, pass, gistId:id}; lsSet(K_CFG, CFG);
    await refresh(true);
    return "";
  } catch (e) { return e.message || "Verbinden hat nicht geklappt."; }
}
async function refresh(manual = false) {
  if (!CFG.token || !CFG.pass) return;
  if (!navigator.onLine) { syncState = "err"; CFG.lastErr = "Du bist offline."; render(); return; }
  syncState = "busy"; render();
  try {
    if (!CFG.gistId) CFG.gistId = await findGist(CFG.token);
    const g = await gh("/gists/" + CFG.gistId);
    if (!privKey) privKey = await WC.unlockKeys(JSON.parse(await fileText(g.files[F_KEYS])), CFG.pass).catch(() => { throw new Error("Das Passwort passt nicht mehr. Trenne und verbinde neu."); });
    const vf = g.files[F_VAULT];
    if (vf) {
      const file = JSON.parse(await fileText(vf)), cache = lsGet(K_CACHE, null);
      if (!cache || cache.erstellt !== file.erstellt || manual) { const vault = await WC.openVault(file, privKey); lsSet(K_CACHE, vault); setVault(vault, false); }
    }
    const pf = g.files[F_PROG];
    if (pf) { const remote = await WC.openJson(JSON.parse(await fileText(pf)), CFG.pass); let changed = false;
      for (const [id, p] of Object.entries(remote || {})) if (!PR[id] || (+p.ts || 0) > (+PR[id].ts || 0)) { PR[id] = p; changed = true; }
      if (changed) { lsSet(K_PROG, PR); computeDue(); }
      if (Object.keys(PR).some(id => !remote[id] || (+PR[id].ts || 0) > (+remote[id].ts || 0))) schedulePush(500); }
    else if (Object.keys(PR).length) schedulePush(500);
    syncState = ""; CFG.lastErr = ""; lsSet(K_CFG, CFG);
    if (manual) toast(isDemo ? "Verbunden. Noch keine Unterlagen verarbeitet." : "Auf dem neuesten Stand.");
  } catch (e) { syncState = "err"; CFG.lastErr = e.message; if (e.missing) CFG.gistId = ""; }
  render();
}
let pushT = null;
function schedulePush(ms = 3000) { if (!CFG.token || !CFG.pass || isDemo) return; clearTimeout(pushT); pushT = setTimeout(pushProgress, ms); }
async function pushProgress() {
  try { const box = await WC.sealJson(PR, CFG.pass); await gh("/gists/" + CFG.gistId, {method:"PATCH", body:JSON.stringify({files:{[F_PROG]:{content:JSON.stringify(box)}}})}); }
  catch { setTimeout(() => schedulePush(), 60000); }
}

/* ---------- Start ---------- */
(function start() {
  const cache = CFG.token ? lsGet(K_CACHE, null) : null;
  setVault(cache || DEMO_VAULT, !cache);
  try { const s = history.state; if (s && s.v) { view = s.v; depth = s.depth || 0; } else history.replaceState({v:view, depth:0}, ""); } catch {}
  setPane(UI.pane || "files");
  render();
  refresh();
  document.addEventListener("visibilitychange", () => { if (document.hidden) return; if (today() !== lastDay) { lastDay = today(); computeDue(); render(); } refresh(); });
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); computeDue(); render(); } }, 60000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
