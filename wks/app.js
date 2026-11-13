"use strict";
/* WKS Wissen – Notizen im Stil eines Obsidian-Tresors aus Lionels Schulunterlagen.
   Daten: verschlüsselt im Branch «wks-data» des Repos (vault.enc.json, keys.json), auf dem Gerät zwischengespeichert.
   Lernstand: lokal, auf Wunsch über ein geheimes Gist zwischen Geräten abgeglichen. */
const APP_VERSION = "1.1.0";
const REPO = "6dw6g8bch2-lab/Lionel", DATA_BRANCH = "wks-data";
const ISSUE_TITLE = "WKS-Schlüssel", PROG_DESC = "WKS Lernstand (verschlüsselt)", F_PROG = "wks-progress.enc.json";
const K_CFG = "wks-cfg-v2", K_CACHE = "wks-vault-cache-v2", K_PROG = "wks-progress-v1", K_UI = "wks-ui-v1", K_KEYS = "wks-keys-v2";
const INTERVAL = [1, 1, 3, 7, 14, 30], NEW_PER_DAY = 20, EXAM_DAYS = 3, STALE_DAYS = 2;
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
const lsDel = k => { try { localStorage.removeItem(k); } catch {} };
const say = t => { $("live").textContent = ""; setTimeout(() => { $("live").textContent = t; }, 60); };
let toastT; function toast(t, ms = 3500) { const el = $("toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, ms); }
const isMobile = () => matchMedia("(max-width:860px)").matches;

/* ---------- Zustand ---------- */
// CFG: ready (eingerichtet), kid (Kennung des eigenen Schlüssels), token/gistId (nur für den Lernstand-Abgleich), etag.
// Das Passwort wird nie gespeichert; die entsperrten Schlüssel liegen nicht exportierbar in IndexedDB (KeyStore).
let CFG = lsGet(K_CFG, {ready:false, kid:"", token:"", gistId:"", etag:{}});
let progKey = null;
let V = null, isDemo = true, PR = lsGet(K_PROG, {}), DUE = new Set();
let notes = new Map(), byTitle = new Map(), F = [], K = [], TE = [];
let UI = lsGet(K_UI, {open:{}, pane:"files"});
let view = {type:"home"}, session = null, learnScope = "faellig", query = "", privKey = null, sync = {state:"", msg:""}, lastDay = today(), lastRefresh = 0;
let remoteKeys = null; // keys.json aus dem Branch (null = noch nicht übergeben)

/* ---------- Daten aufbereiten ---------- */
function clean(v) {
  const o = v && typeof v === "object" ? v : {};
  return {
    beispiel:!!o.beispiel, erstellt:str(o.erstellt), status:o.status && typeof o.status === "object" ? o.status : null,
    faecher:arr(o.faecher).filter(f => f && str(f.name).trim()).map(f => ({id:str(f.id) || slug(f.name), name:str(f.name), farbe:Math.abs(+f.farbe || 0) % 8, reihenfolge:+f.reihenfolge || 99})),
    themen:arr(o.themen).filter(t => t && str(t.titel).trim()).map(t => ({id:str(t.id), fach:str(t.fach), titel:str(t.titel).trim(), zusammenfassung:str(t.zusammenfassung), quelle:str(t.quelle),
      aktualisiert:/^\d{4}-\d{2}-\d{2}/.test(str(t.aktualisiert)) ? str(t.aktualisiert).slice(0, 10) : "",
      tags:arr(t.tags).map(x => slug(x)).filter(Boolean), kernpunkte:arr(t.kernpunkte).filter(p => typeof p === "string" && p.trim()),
      begriffe:arr(t.begriffe).filter(b => b && typeof b === "object" && str(b.begriff).trim()).map(b => ({begriff:str(b.begriff).trim(), erklaerung:str(b.erklaerung)}))})),
    karten:arr(o.karten).filter(k => k && str(k.frage).trim() && str(k.antwort).trim()).map(k => ({id:str(k.id), fach:str(k.fach), thema:str(k.thema), frage:str(k.frage), antwort:str(k.antwort)})),
    termine:arr(o.termine).filter(t => t && /^\d{4}-\d{2}-\d{2}$/.test(str(t.datum)) && str(t.titel).trim()).map(t => ({id:str(t.id), fach:str(t.fach), titel:str(t.titel), art:str(t.art) || "Termin", datum:str(t.datum)})),
  };
}
const fachOf = id => F.find(f => f.id === id);
const fcol = f => `var(--c${f ? f.farbe : 0})`;
const LINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g;
function setVault(v, demo) {
  V = clean(v); isDemo = !!demo || !V.themen.length;
  if (isDemo && !demo) V = clean(DEMO_VAULT);
  F = V.faecher.sort((a, b) => a.reihenfolge - b.reihenfolge || a.name.localeCompare(b.name, "de"));
  K = V.karten; TE = V.termine;
  notes = new Map(); byTitle = new Map();
  for (const t of V.themen) notes.set("t:" + t.id, {id:"t:" + t.id, type:"thema", src:t, title:t.titel, fach:t.fach, tags:t.tags, links:new Set(), back:new Map()});
  for (const t of V.themen) for (const b of t.begriffe) {
    const id = "b:" + t.fach + ":" + slug(b.begriff);
    if (!notes.has(id)) notes.set(id, {id, type:"begriff", title:b.begriff, fach:t.fach, tags:["begriff"], erklaerung:b.erklaerung, links:new Set(), back:new Map()});
    notes.get("t:" + t.id).links.add(id);
  }
  for (const n of notes.values()) { const k = n.title.toLowerCase(); if (!byTitle.has(k) || n.type === "thema") byTitle.set(k, n.id); }
  for (const n of notes.values()) {
    if (n.type !== "thema") continue;
    for (const m of [n.src.zusammenfassung, ...n.src.kernpunkte].join("\n").matchAll(LINK_RE)) { const t = resolve(m[1], n.fach); if (t && t !== n.id) n.links.add(t); }
  }
  for (const n of notes.values()) for (const to of n.links) {
    const t = notes.get(to); if (!t) continue;
    let ctx = "";
    if (n.type === "thema") {
      const low = t.title.toLowerCase();
      const para = [...n.src.zusammenfassung.split(/\n\s*\n/), ...n.src.kernpunkte].find(p => p.toLowerCase().includes(low));
      ctx = para ? para.replace(LINK_RE, (_, a, b) => b || a) : n.src.begriffe.some(b => b.begriff === t.title) ? "Als Begriff in dieser Notiz erklärt" : "";
    }
    t.back.set(n.id, ctx);
  }
  computeDue();
}
function resolve(name, fach) {
  const k = str(name).trim().toLowerCase(), exact = byTitle.get(k); if (exact) return exact;
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
  const n = DUE.size, b = $("dueBadge"); b.hidden = !n; b.textContent = n > 99 ? "99+" : String(n);
  $("learnLabel").textContent = n ? `, ${n} fällig` : "";
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
  // Vor einer Prüfung zählt jedes Üben des Fachs
  const exam = scope.startsWith("fach:") && examSoon(scope.slice(5));
  session = cards.length ? {cards:cards.map(c => c.id), i:0, shown:false, ok:0, again:0, retried:new Set(), counted:new Set(cards.filter(c => exam || DUE.has(c.id) || !PR[c.id]).map(c => c.id))} : null;
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
  setTimeout(() => (document.querySelector("[data-reveal]") || document.querySelector("#content [data-learn]") || $("h-main")).focus({preventScroll:true}), 0);
}

/* ---------- Markdown (klein) ---------- */
const fmt = s => esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>").replace(/`([^`]+)`/g, "<code>$1</code>");
function inline(s, fach) {
  let out = "", last = 0;
  for (const m of s.matchAll(LINK_RE)) {
    out += fmt(s.slice(last, m.index));
    const target = resolve(m[1], fach), label = esc((m[2] || m[1]).trim());
    out += target ? `<button type="button" class="wl" data-open="${esc(target)}">${label}</button>` : `<span class="wl unres" title="Noch keine Notiz dazu">${label}</span>`;
    last = m.index + m[0].length;
  }
  return out + fmt(s.slice(last));
}
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
const ICON_HOME = `<svg class="doc-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11l8-7 8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5z"/></svg>`;
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
    return folder(f.id, f.name, inner, th.length + be.length, `<span class="fdot" style="--fc:${fcol(f)}"></span>`);
  }).join("");
  $("pane-files").innerHTML = `<button type="button" class="node" data-home${view.type === "home" ? ` aria-current="page"` : ""}>${ICON_HOME}<span class="lbl">Übersicht</span></button>` + (F.length ? `<ul class="tree">${html}</ul>` : `<p class="pane-note">Noch keine Fächer.</p>`);
}
function renderTags() {
  const c = new Map(); for (const n of notes.values()) for (const t of n.tags) c.set(t, (c.get(t) || 0) + 1);
  const list = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  $("pane-tags").innerHTML = list.length ? list.map(([t, n]) => `<button type="button" class="tagrow" data-tag="${esc(t)}"><span>#${esc(t)}</span><span class="cnt">${n}</span></button>`).join("") : `<p class="pane-note">Noch keine Tags.</p>`;
}
function renderSearch() {
  const q = query.trim().toLowerCase(), res = $("qres"), note = $("qn");
  if (q.length < 2) { res.innerHTML = ""; note.textContent = `Durchsucht ${plural(notes.size, "Notiz", "Notizen")}. Mit # nach Tags suchen.`; return; }
  const hl = s => { const t = str(s).replace(LINK_RE, (_, a, b) => b || a), i = t.toLowerCase().indexOf(q); if (i < 0) return esc(t.slice(0, 100)); const a = Math.max(0, i - 40); return (a ? "… " : "") + esc(t.slice(a, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length, i + q.length + 60)) + " …"; };
  let hits;
  if (q.startsWith("#")) { const tg = slug(q.slice(1)); hits = [...notes.values()].filter(n => n.tags.some(t => t.startsWith(tg))).map(n => ({n, s:n.tags.map(t => "#" + esc(t)).join(" ")})); }
  else hits = [...notes.values()].map(n => {
    const parts = n.type === "thema" ? [n.title, n.src.zusammenfassung, ...n.src.kernpunkte, ...n.src.begriffe.map(b => b.begriff + ": " + b.erklaerung)] : [n.title, n.erklaerung];
    const m = parts.find(p => str(p).toLowerCase().includes(q)); return m ? {n, s:hl(m), score:n.title.toLowerCase().includes(q) ? 0 : 1} : null;
  }).filter(Boolean).sort((a, b) => a.score - b.score);
  note.textContent = hits.length ? `${hits.length} Treffer` : `Nichts gefunden für «${query.trim()}».`;
  res.innerHTML = hits.slice(0, 60).map(h => { const f = fachOf(h.n.fach); return `<button type="button" class="hit" data-open="${esc(h.n.id)}"><b>${esc(h.n.title)}</b><span>${f ? esc(f.name) + " · " : ""}${h.s}</span></button>`; }).join("");
}
function setPane(p) {
  UI.pane = p; lsSet(K_UI, UI);
  for (const x of ["files", "search", "tags"]) { $("pane-" + x).hidden = x !== p; const t = $("tab-" + x); t.setAttribute("aria-selected", String(x === p)); t.tabIndex = x === p ? 0 : -1; }
  if (p === "search") renderSearch(); else if (p === "tags") renderTags(); else renderFiles();
}
function drawerOpen() { return $("side").classList.contains("open"); }
function openSide(p) {
  if (p) setPane(p);
  if (!isMobile()) { if (p === "search") $("q").focus(); return; }
  $("side").classList.add("open"); $("side").inert = false; $("side").setAttribute("role", "dialog"); $("side").setAttribute("aria-modal", "true"); $("scrim").hidden = false; $("menuBtn").setAttribute("aria-expanded", "true");
  $("main").inert = true; $("ribbon").inert = true;
  setTimeout(() => (p === "search" ? $("q") : ($("side").querySelector("[aria-current]") || $("tab-" + UI.pane))).focus({preventScroll:true}), 80);
}
function closeSide(focusBack) {
  if (!drawerOpen()) return;
  $("side").classList.remove("open"); $("side").removeAttribute("role"); $("side").removeAttribute("aria-modal"); $("scrim").hidden = true; $("menuBtn").setAttribute("aria-expanded", "false");
  $("main").inert = false; $("ribbon").inert = false; if (isMobile()) $("side").inert = true;
  if (focusBack) $("menuBtn").focus();
}
function layoutMode() { const m = isMobile(); $("side").inert = m && !drawerOpen(); if (!m) { $("main").inert = false; $("ribbon").inert = false; $("scrim").hidden = true; $("side").classList.remove("open"); } }

/* ---------- Ansichten ---------- */
function crumb(html) { $("crumb").innerHTML = html; }
function standDate() { const s = V && V.status, w = s && s.letzteAktualisierung ? s.letzteAktualisierung : V && V.erstellt; return w ? new Date(w) : null; }
function statusText() {
  if (!CFG.ready) return "Beispiel";
  if (isDemo) return remoteKeys ? "Eingerichtet, noch keine Unterlagen" : "Eingerichtet, Schlüssel noch nicht bei Claude";
  const w = standDate(); return w ? "Stand " + w.toLocaleString("de-CH", {day:"numeric", month:"numeric", hour:"2-digit", minute:"2-digit"}) : "";
}
function homeNotice() {
  if (!CFG.ready) return `<div class="callout warn"><div class="callout-t">Beispiel</div><p>Das ist ein Beispiel. Richte die App unter Einstellungen einmal mit einem Passwort ein, dann siehst du hier deine echten Unterlagen.</p><div><button class="btn" type="button" data-go="settings">Einrichten</button></div></div>`;
  if (!remoteKeys && !lsGet(K_KEYS, null)) return "";
  if (!remoteKeys) return `<div class="callout warn"><div class="callout-t">Noch ein Schritt</div><p>Übergib deinen Schlüssel an Claude, sonst kann Claude deine Notizen nicht für dich verschlüsseln.</p><div><button class="btn" type="button" data-go="settings">Schlüssel übergeben</button></div></div>`;
  if (isDemo) return `<div class="callout warn"><div class="callout-t">Noch keine Unterlagen</div><p>Leg PDFs, Word- oder PowerPoint-Dateien in deinen OneDrive-Ordner <b>WKS</b>, am besten in einen Unterordner pro Fach. Claude erstellt daraus jeden Abend um 18:37 Uhr Notizen und Karteikarten. Bis dahin siehst du ein Beispiel.</p></div>`;
  const w = standDate();
  if (w && (Date.now() - w) / 864e5 > STALE_DAYS) return `<div class="callout warn"><div class="callout-t">Seit ${Math.floor((Date.now() - w) / 864e5)} Tagen nicht aktualisiert</div><p>Der Abendlauf hat länger nichts geliefert. Schreib Claude: «Aktualisier die WKS-App».</p></div>`;
  return "";
}
function renderHome() {
  crumb(`<b>Übersicht</b>`);
  const next = TE.filter(t => t.datum >= today()).sort((a, b) => a.datum.localeCompare(b.datum))[0];
  const recent = [...notes.values()].filter(n => n.type === "thema").sort((a, b) => b.src.aktualisiert.localeCompare(a.src.aktualisiert)).slice(0, 6);
  let h = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">WKS Wissen</h1><p class="muted small">${esc(statusText())}</p>${homeNotice()}`;
  if (sync.state === "err") h += `<div class="callout err"><div class="callout-t">Verbindung</div><p>${esc(sync.msg)} Du siehst den letzten gespeicherten Stand.</p></div>`;
  if (next) { const n = daysUntil(next.datum), f = fachOf(next.fach); h += `<div class="callout${n <= EXAM_DAYS ? " err" : ""}"><div class="callout-t">${n === 0 ? "Heute" : n === 1 ? "Morgen" : `In ${n} Tagen`}: ${esc(next.titel)}${isDemo ? ` <span class="example">Beispiel</span>` : ""}</div><p class="small">${esc(fmtDate(next.datum))}${f ? " · " + esc(f.name) : ""}</p>${f ? `<div><button class="btn" type="button" data-learn="fach:${esc(f.id)}">Für diese Prüfung üben</button></div>` : ""}</div>`; }
  if (DUE.size) h += `<button class="btn primary" type="button" data-learn="faellig">${plural(DUE.size, "Karte", "Karten")} üben</button>`;
  h += `<div class="section"><div class="section-h"><span>Fächer</span></div><div class="home-grid">${F.map(f => { const th = [...notes.values()].filter(n => n.type === "thema" && n.fach === f.id).length, kc = K.filter(k => k.fach === f.id).length;
    return `<button type="button" class="fcard" data-fach="${esc(f.id)}" style="--fc:${fcol(f)}"><b>${esc(f.name)}</b><span>${plural(th, "Notiz", "Notizen")} · ${plural(kc, "Karte", "Karten")}</span></button>`; }).join("")}</div></div>`;
  if (recent.length) h += `<div class="section"><div class="section-h"><span>Zuletzt geändert</span></div><div class="bl">${recent.map(n => `<button type="button" data-open="${esc(n.id)}"><b>${esc(n.title)}</b><span>${esc((fachOf(n.fach) || {}).name || "")}${n.src.aktualisiert ? " · " + esc(fmtDate(n.src.aktualisiert)) : ""}</span></button>`).join("")}</div></div>`;
  $("content").innerHTML = h + `</div>`;
}
function renderFach(id) {
  const f = fachOf(id); if (!f) return renderHome();
  crumb(`<span class="fdot" style="--fc:${fcol(f)}"></span> <b>${esc(f.name)}</b>`);
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
  crumb(`${f ? `<span class="fdot" style="--fc:${fcol(f)}"></span> ${esc(f.name)} / ` : ""}${n.type === "begriff" ? "Begriffe / " : ""}<b>${esc(n.title)}</b>`);
  let h = `<article class="doc"><h1 class="note-title" id="h-main" tabindex="-1">${esc(n.title)}</h1>`;
  const props = [];
  if (f) props.push(["Fach", `<button type="button" class="wl" data-fach="${esc(f.id)}"><span class="fdot" style="--fc:${fcol(f)}"></span> ${esc(f.name)}</button>`]);
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
      <div class="section"><div class="section-h"><span>Dein Stand</span></div><div class="boxes">${box.map((c, i) => `<div><b class="num">${c}</b><span>${["Neu", "1 Tag", "3 Tage", "1 Woche", "2 Wochen", "Sitzt"][i]}</span></div>`).join("")}</div>
      <p class="small muted">Gewusste Karten kommen nach 1, 3, 7, 14 und 30 Tagen wieder. Nicht gewusste kommen am Ende der Runde nochmals und morgen wieder. Drei Tage vor einer Prüfung wird das ganze Fach fällig, dann zählt jedes Üben.</p></div>`;
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
    return `<button class="term" type="button" ${f ? `data-fach="${esc(f.id)}"` : "disabled"}><span class="date" aria-hidden="true"><span>${WD[d.getDay()]}</span><b class="num">${d.getDate()}</b><span>${MON[d.getMonth()]}</span></span><span class="tbody"><span class="t">${esc(t.titel)}</span><span class="s">${esc(t.art)}${f ? " · " + esc(f.name) : ""}${isDemo ? ` <span class="example">Beispiel</span>` : ""}<span class="sr-only">, ${esc(fmtDate(t.datum))}</span></span>${n >= 0 ? `<span class="pill ${n <= EXAM_DAYS ? "bad" : n <= 10 ? "warn" : "neutral"}">${n === 0 ? "heute" : n === 1 ? "morgen" : `in ${n} Tagen`}</span>` : ""}</span></button>`; };
  $("content").innerHTML = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">Termine</h1>
    ${up.length ? `<div>${up.map(row).join("")}</div>` : `<p class="muted">Keine kommenden Termine. Claude erkennt Prüfungsdaten, wenn sie in deinen Unterlagen stehen.</p>`}
    ${past.length ? `<details class="section"><summary class="section-h" style="cursor:pointer;min-height:40px;align-items:center">Vergangen (${past.length})</summary><div>${past.map(row).join("")}</div></details>` : ""}</div>`;
}
function issueUrl(keys) {
  const body = "Das ist mein Schlüssel für die App WKS Wissen. Claude übernimmt ihn beim nächsten Abendlauf.\n\n```json\n" + JSON.stringify(keys) + "\n```";
  return `https://github.com/${REPO}/issues/new?title=${encodeURIComponent(ISSUE_TITLE)}&body=${encodeURIComponent(body)}`;
}
function renderSettings() {
  crumb(`<b>Einstellungen</b>`);
  const local = lsGet(K_KEYS, null), setup = !!CFG.ready;
  let h = `<div class="doc"><h1 class="note-title" id="h-main" tabindex="-1">Einstellungen</h1><div class="section"><div class="section-h"><span>Einrichten</span></div>`;
  if (!setup) {
    const second = !!remoteKeys;
    h += second
      ? `<p>Diese App ist auf einem anderen Gerät schon eingerichtet. Gib hier <b>dasselbe Passwort</b> ein wie dort.</p>
         <label class="field"><span>Passwort</span><input id="cfgPass" type="password" autocomplete="current-password" autocapitalize="off" spellcheck="false"></label>
         <div class="row"><button class="btn primary" type="button" id="btnUnlock">Entsperren</button></div>`
      : `<p>Wähl ein Passwort. Damit werden deine Notizen geschützt: Nur wer es kennt, kann sie lesen, auch Claude nicht. Auf deinen anderen Geräten gibst du später dasselbe Passwort ein.</p>
         <label class="field"><span>Passwort (mindestens 10 Zeichen)</span><input id="cfgPass" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>
         <label class="field"><span>Passwort wiederholen</span><input id="cfgPass2" type="password" autocomplete="new-password" autocapitalize="off" spellcheck="false"></label>
         <p class="small muted">Speichere es in deinen iPhone-Passwörtern. Vergisst du es, richtet Claude die App mit einem neuen Passwort ein; deine Unterlagen in OneDrive bleiben, nur der Lernstand geht verloren.</p>
         <div class="row"><button class="btn primary" type="button" id="btnCreate">Passwort festlegen</button></div>`;
    h += `<p class="status" id="setMsg" role="status"></p>`;
  } else {
    h += `<p>Eingerichtet. ${esc(statusText())}.</p>`;
    if (!remoteKeys && local) h += `<div class="callout warn"><div class="callout-t">Schlüssel an Claude übergeben</div>
      <ol class="steps"><li>Tippe auf den Knopf. GitHub öffnet ein ausgefülltes Formular.</li><li>Tippe dort auf <b>«Submit new issue»</b> bzw. <b>«Create»</b>. Mehr ist nicht nötig.</li><li>Beim nächsten Abendlauf übernimmt Claude den Schlüssel. Willst du es sofort, schreib Claude: «Aktualisier die WKS-App».</li></ol>
      <p class="small">Der Schlüssel ist mit deinem Passwort versiegelt und ohne Passwort nutzlos.</p>
      <div><a class="btn primary" href="${esc(issueUrl(local))}" target="_blank" rel="noopener">Schlüssel übergeben</a></div></div>`;
    h += `<p class="status ${sync.state === "err" ? "err" : ""}" id="setMsg" role="status">${sync.state === "err" ? esc(sync.msg) : ""}</p>
      <div class="row"><button class="btn" type="button" id="btnRefresh">Jetzt neu laden</button><button class="btn danger" type="button" id="btnReset">Auf diesem Gerät abmelden</button></div>`;
  }
  h += `</div>`;
  if (setup) h += `<div class="section"><div class="section-h"><span>Lernstand auf allen Geräten (freiwillig)</span></div>
    ${CFG.token ? `<p>Dein Lernstand wird zwischen deinen Geräten abgeglichen.</p><div><button class="btn danger" type="button" id="btnProgOff">Abgleich beenden</button></div>`
    : `<p class="small">Ohne Abgleich lernt jedes Gerät für sich. Für den Abgleich braucht es einen GitHub-Token mit dem Recht «gist»: <a href="https://github.com/settings/tokens/new?scopes=gist&amp;description=WKS-Lernstand" target="_blank" rel="noopener">hier erstellen</a>, «No expiration» wählen, unten «Generate token», kopieren.</p>
      <label class="field"><span>GitHub-Token</span><input id="cfgToken" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="ghp_…"></label>
      <div><button class="btn" type="button" id="btnProgOn">Abgleich einschalten</button></div>`}<p class="status" id="progMsg" role="status"></p></div>`;
  h += `<div class="section"><div class="section-h"><span>So kommen Unterlagen hinein</span></div><p>Leg PDFs, Word- oder PowerPoint-Dateien in deinen OneDrive-Ordner <b>WKS</b>, am besten in einen Unterordner pro Fach (z. B. <b>WKS › Französisch</b>). Claude erstellt daraus jeden Abend um 18:37 Uhr Notizen, Begriffe, Karteikarten und Termine.</p></div>
    <div class="section"><div class="section-h"><span>App</span></div><p class="small muted">WKS Wissen ${APP_VERSION} · ${plural(Object.keys(PR).length, "Karte", "Karten")} gelernt.</p></div></div>`;
  $("content").innerHTML = h;
  const msg = (id, t, ok) => { const m = $(id); if (m) { m.className = "status " + (ok ? "ok" : "err"); m.textContent = t; } };
  $("btnCreate") && ($("btnCreate").onclick = async () => {
    const p = $("cfgPass").value, p2 = $("cfgPass2").value;
    if (p.length < 10) { msg("setMsg", "Das Passwort braucht mindestens 10 Zeichen."); $("cfgPass").focus(); return; }
    if (p !== p2) { msg("setMsg", "Die beiden Passwörter sind nicht gleich."); $("cfgPass2").focus(); return; }
    if (!crypto.subtle) { msg("setMsg", "Dieser Browser kann nicht verschlüsseln. Öffne die App über https."); return; }
    const b = $("btnCreate"); b.disabled = true; msg("setMsg", "Schlüssel wird erstellt …", true);
    const k = await WC.createKeys(p); lsSet(K_KEYS, k.keys);
    await unlockAndStore(k.keys, p); toast("Passwort festgelegt."); render();
    setTimeout(() => document.querySelector("a.btn.primary")?.focus(), 50);
  });
  $("btnUnlock") && ($("btnUnlock").onclick = async () => {
    const p = $("cfgPass").value, b = $("btnUnlock"); b.disabled = true; msg("setMsg", "Prüfe …", true);
    try { await unlockAndStore(remoteKeys, p); } catch (e) { b.disabled = false; msg("setMsg", e.tampered ? "Der Schlüssel im Repo ist beschädigt oder verändert. Schreib Claude." : "Falsches Passwort. Es muss dasselbe sein wie auf deinem anderen Gerät."); $("cfgPass").focus(); return; }
    toast("Entsperrt."); await refresh(true); go({type:"home"});
  });
  $("btnRefresh") && ($("btnRefresh").onclick = async () => { await refresh(true); render(); });
  $("btnReset") && ($("btnReset").onclick = () => {
    const b = $("btnReset");
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Wirklich abmelden? Nochmals tippen"; return; }
    CFG = {ready:false, kid:"", token:"", gistId:"", etag:{}}; privKey = null; progKey = null; KeyStore.clear(); lsSet(K_CFG, CFG); lsDel(K_CACHE); lsDel(K_KEYS);
    setVault(DEMO_VAULT, true); toast("Abgemeldet."); go({type:"home"});
  });
  $("btnProgOn") && ($("btnProgOn").onclick = async () => {
    const t = $("cfgToken").value.trim();
    if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/.test(t)) { msg("progMsg", "Das sieht nicht nach einem GitHub-Token aus. Er beginnt mit «ghp_»."); return; }
    msg("progMsg", "Verbinde …", true);
    try { CFG.token = t; CFG.gistId = ""; await syncProgress(); lsSet(K_CFG, CFG); toast("Abgleich eingeschaltet."); render(); }
    catch (e) { CFG.token = ""; msg("progMsg", e.message); }
  });
  $("btnProgOff") && ($("btnProgOff").onclick = () => { CFG.token = ""; CFG.gistId = ""; lsSet(K_CFG, CFG); toast("Abgleich beendet."); render(); });
}

/* ---------- Graph ---------- */
let G = null;
function renderGraph() {
  crumb(`<b>Graph</b>`);
  const c = $("content"); c.classList.add("graph-mode");
  const showB = UI.graphBegriffe ?? notes.size < 400;
  const items = [...notes.values()].filter(n => showB || n.type === "thema").sort((a, b) => a.title.localeCompare(b.title, "de"));
  c.innerHTML = `<div class="graph-wrap"><h1 class="sr-only" id="h-main" tabindex="-1">Graph</h1>
    <canvas id="graph" aria-hidden="true"></canvas>
    <div class="graph-ui"><button type="button" class="gchip" id="gB" aria-pressed="${showB}">${showB ? "✓ " : ""}Begriffe</button><button type="button" class="gchip" id="gFit">Einpassen</button></div>
    <div class="graph-legend" aria-hidden="true">${F.map(f => `<span><span class="fdot" style="--fc:${fcol(f)}"></span>${esc(f.name)}</span>`).join("")}</div><div class="graph-tip" id="gTip" hidden></div>
    <ul class="sr-only" aria-label="Notizen und ihre Verbindungen">${items.map(n => `<li><button type="button" data-open="${esc(n.id)}">${esc(n.title)}, verbunden mit ${n.links.size + n.back.size}</button></li>`).join("")}</ul></div>`;
  $("gB").onclick = () => { UI.graphBegriffe = !showB; lsSet(K_UI, UI); renderGraph(); };
  $("gFit").onclick = () => G && fitGraph();
  startGraph(showB);
}
function startGraph(showB) {
  if (G) { cancelAnimationFrame(G.raf); G.ro && G.ro.disconnect(); }
  const cv = $("graph"), cs = getComputedStyle(document.documentElement), col = v => cs.getPropertyValue(v).trim();
  const list = [...notes.values()].filter(n => showB || n.type === "thema"), idx = new Map(list.map((n, i) => [n.id, i]));
  const edges = [], seen = new Set();
  list.forEach(n => n.links.forEach(t => { if (!idx.has(t)) return; const a = idx.get(n.id), b = idx.get(t), k = a < b ? a + "-" + b : b + "-" + a; if (!seen.has(k)) { seen.add(k); edges.push([a, b]); } }));
  const deg = list.map(() => 0); edges.forEach(([a, b]) => { deg[a]++; deg[b]++; });
  const N = list.map((n, i) => { const f = fachOf(n.fach), ang = i / Math.max(list.length, 1) * Math.PI * 2; return {n, x:Math.cos(ang) * 120 + Math.random() * 20, y:Math.sin(ang) * 120 + Math.random() * 20, vx:0, vy:0, r:(n.type === "thema" ? 6 : 3.5) + Math.min(deg[i], 8) * .7, color:col("--c" + (f ? f.farbe : 0)), deg:deg[i]}; });
  G = {cv, N, E:edges, scale:1, tx:0, ty:0, alpha:1, hover:-1, drag:null, ptrs:new Map(), fg:col("--fg"), edge:col("--faint"), raf:0, fitted:false, grid:null};
  const resize = () => { const r = cv.getBoundingClientRect(), dpr = devicePixelRatio || 1; cv.width = r.width * dpr; cv.height = r.height * dpr; G.w = r.width; G.h = r.height; G.dpr = dpr; };
  resize(); G.ro = new ResizeObserver(() => { resize(); draw(); }); G.ro.observe(cv);
  const toWorld = (x, y) => [(x - G.w / 2 - G.tx) / G.scale, (y - G.h / 2 - G.ty) / G.scale];
  const hit = (x, y) => { const [wx, wy] = toWorld(x, y); let best = -1, bd = 1e9; G.N.forEach((p, i) => { const d = Math.hypot(p.x - wx, p.y - wy); if (d < p.r + 12 / G.scale && d < bd) { bd = d; best = i; } }); return best; };
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); const [x, y] = pos(e); G.ptrs.set(e.pointerId, [x, y]);
    if (G.ptrs.size === 1) { G.drag = {i:hit(x, y), sx:x, sy:y, moved:false, tx:G.tx, ty:G.ty}; cv.classList.add("drag"); }
    else { G.drag = null; const p = [...G.ptrs.values()]; G.pinch = {d:Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), s:G.scale}; } };
  cv.onpointermove = e => { const [x, y] = pos(e);
    if (G.ptrs.has(e.pointerId)) G.ptrs.set(e.pointerId, [x, y]);
    if (G.pinch && G.ptrs.size === 2) { const p = [...G.ptrs.values()]; G.scale = Math.min(4, Math.max(.2, G.pinch.s * Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) / G.pinch.d)); draw(); return; }
    if (G.drag) { const d = G.drag; if (Math.hypot(x - d.sx, y - d.sy) > 6) d.moved = true;
      if (d.i >= 0 && d.moved) { const [wx, wy] = toWorld(x, y), p = G.N[d.i]; p.x = wx; p.y = wy; p.vx = p.vy = 0; G.alpha = Math.max(G.alpha, .3); }
      else if (d.i < 0) { G.tx = d.tx + x - d.sx; G.ty = d.ty + y - d.sy; draw(); } return; }
    const i = hit(x, y); if (i !== G.hover) { G.hover = i; const tip = $("gTip"); if (i >= 0) { tip.textContent = G.N[i].n.title; tip.hidden = false; tip.style.left = Math.min(x + 12, G.w - 160) + "px"; tip.style.top = y + 12 + "px"; } else tip.hidden = true; draw(); } };
  const up = e => { G.ptrs.delete(e.pointerId); if (G.ptrs.size < 2) G.pinch = null; const d = G.drag; G.drag = null; cv.classList.remove("drag"); if (d && !d.moved && d.i >= 0) go({type:"note", id:G.N[d.i].n.id}); };
  cv.onpointerup = up; cv.onpointercancel = up;
  cv.onpointerleave = () => { G.hover = -1; const t = $("gTip"); if (t) t.hidden = true; draw(); };
  cv.onwheel = e => { e.preventDefault(); const [x, y] = pos(e), [wx, wy] = toWorld(x, y); G.scale = Math.min(4, Math.max(.2, G.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); G.tx = x - G.w / 2 - wx * G.scale; G.ty = y - G.h / 2 - wy * G.scale; draw(); };
  const step = () => {
    const n = G.N.length, cell = 140, grid = new Map();
    // Abstossung nur zwischen Nachbarn im Raster: schnell auch bei vielen Notizen
    G.N.forEach((p, i) => { const k = Math.floor(p.x / cell) + ":" + Math.floor(p.y / cell); (grid.get(k) || grid.set(k, []).get(k)).push(i); });
    for (let i = 0; i < n; i++) { const a = G.N[i], cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) for (const j of grid.get(gx + ":" + gy) || []) { if (j <= i) continue; const b = G.N[j]; let dx = a.x - b.x, dy = a.y - b.y; const d2 = dx * dx + dy * dy || .01; const f = 900 / d2 * G.alpha; dx *= f; dy *= f; a.vx += dx; a.vy += dy; b.vx -= dx; b.vy -= dy; } }
    for (const [i, j] of G.E) { const a = G.N[i], b = G.N[j], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, f = (d - 70) / d * .06 * G.alpha; a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f; }
    for (let i = 0; i < n; i++) { const p = G.N[i]; if (G.drag && G.drag.i === i && G.drag.moved) continue; p.vx -= p.x * .006 * G.alpha; p.vy -= p.y * .006 * G.alpha; p.vx *= .55; p.vy *= .55; p.x += p.vx; p.y += p.vy; }
    G.alpha *= .985;
  };
  const still = matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (still) { while (G.alpha > .02) step(); fitGraph(); }
  const tick = () => {
    if (!document.body.contains(cv)) { G.ro.disconnect(); return; }
    if (G.alpha > .02) { step(); if (!G.fitted && G.alpha < .3) { G.fitted = true; fitGraph(); } draw(); }
    G.raf = requestAnimationFrame(tick);
  };
  G.raf = requestAnimationFrame(tick); draw();
}
function fitGraph() {
  if (!G || !G.N.length) return;
  const xs = G.N.map(p => p.x), ys = G.N.map(p => p.y), w = Math.max(...xs) - Math.min(...xs) + 120, h = Math.max(...ys) - Math.min(...ys) + 120;
  G.scale = Math.min(1.2, Math.max(.2, Math.min(G.w / w, G.h / h)));
  G.tx = -(Math.max(...xs) + Math.min(...xs)) / 2 * G.scale; G.ty = -(Math.max(...ys) + Math.min(...ys)) / 2 * G.scale; draw();
}
function draw() {
  if (!G) return; const {cv, N, E} = G, ctx = cv.getContext("2d");
  ctx.setTransform(G.dpr, 0, 0, G.dpr, 0, 0); ctx.clearRect(0, 0, G.w, G.h);
  ctx.translate(G.w / 2 + G.tx, G.h / 2 + G.ty); ctx.scale(G.scale, G.scale);
  const hv = G.hover, near = new Set(); if (hv >= 0) { near.add(hv); E.forEach(([a, b]) => { if (a === hv) near.add(b); if (b === hv) near.add(a); }); }
  ctx.lineWidth = 1.2 / G.scale;
  for (const [a, b] of E) { const on = hv >= 0 && (a === hv || b === hv); ctx.strokeStyle = on ? N[hv].color : G.edge; ctx.globalAlpha = hv >= 0 && !on ? .2 : on ? 1 : .6; ctx.beginPath(); ctx.moveTo(N[a].x, N[a].y); ctx.lineTo(N[b].x, N[b].y); ctx.stroke(); }
  N.forEach((p, i) => { const dim = hv >= 0 && !near.has(i); ctx.globalAlpha = dim ? .25 : p.n.type === "begriff" ? .6 : 1; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill(); });
  const fs = 12 / Math.max(G.scale, .6); ctx.fillStyle = G.fg; ctx.textAlign = "center"; ctx.font = `${fs}px -apple-system,Segoe UI,sans-serif`;
  N.forEach((p, i) => { if (G.scale > .9 || p.deg >= 3 || near.has(i)) { ctx.globalAlpha = hv >= 0 && !near.has(i) ? .25 : .9; ctx.fillText(p.n.title.length > 28 ? p.n.title.slice(0, 27) + "…" : p.n.title, p.x, p.y + p.r + fs + 1); } });
  ctx.globalAlpha = 1;
}

/* ---------- Navigation ---------- */
function render() {
  const c = $("content"); c.classList.remove("graph-mode");
  if (view.type !== "graph" && G) { cancelAnimationFrame(G.raf); G.ro && G.ro.disconnect(); G = null; }
  document.querySelectorAll(".ribbon [data-view]").forEach(b => b.dataset.view === view.type ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  const fb = document.querySelector(".ribbon [data-pane='files']");
  if (!isMobile() && ["home", "note", "fach"].includes(view.type)) fb.setAttribute("aria-current", "page"); else fb.removeAttribute("aria-current");
  ({home:renderHome, note:() => renderNote(view.id), fach:() => renderFach(view.id), graph:renderGraph, learn:renderLearn, dates:renderDates, settings:renderSettings})[view.type]();
  $("backBtn").hidden = !(history.state && history.state.depth > 0);
  $("vaultInfo").textContent = statusText();
  const st = sync.state === "busy" ? ["busy", "Lädt …"] : sync.state === "err" ? ["err", sync.msg || "Verbindungsproblem"] : CFG.ready && !isDemo ? ["ok", "Aktuell"] : ["", "Nicht eingerichtet"];
  $("syncDot").className = "sync " + st[0]; $("syncDot").title = st[1]; $("syncDot").setAttribute("aria-label", st[1]);
  if (UI.pane === "files") renderFiles(); else if (UI.pane === "tags") renderTags(); else renderSearch();
}
let depth = 0;
function go(v, {replace = false} = {}) {
  view = v; if (v.type !== "learn" && session && session.i >= session.cards.length) session = null;
  try { if (replace) history.replaceState({v, depth}, ""); else history.pushState({v, depth:++depth}, ""); } catch {}
  closeSide(false); render(); $("content").scrollTop = 0;
  setTimeout(() => (document.querySelector("[data-reveal]") || $("h-main") || $("content")).focus({preventScroll:true}), 0);
}
window.addEventListener("popstate", e => { const s = e.state; view = s && s.v ? s.v : {type:"home"}; depth = s ? s.depth || 0 : 0; closeSide(false); render(); setTimeout(() => ($("h-main") || $("content")).focus({preventScroll:true}), 0); });

document.addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.disabled) return;
  if (b.dataset.open) return go({type:"note", id:b.dataset.open});
  if (b.dataset.fach) return go({type:"fach", id:b.dataset.fach});
  if (b.hasAttribute("data-home")) return go({type:"home"});
  if (b.dataset.go) return go({type:b.dataset.go});
  if (b.dataset.folder) { const k = b.dataset.folder; UI.open[k] = UI.open[k] === false; lsSet(K_UI, UI); renderFiles(); document.querySelector(`[data-folder="${CSS.escape(k)}"]`)?.focus(); return; }
  if (b.dataset.tag) { query = "#" + b.dataset.tag; $("q").value = query; openSide("search"); return; }
  if (b.dataset.pane) { if (b.closest(".ribbon")) return isMobile() ? openSide(b.dataset.pane) : (setPane(b.dataset.pane), b.dataset.pane === "search" && $("q").focus()); return setPane(b.dataset.pane); }
  if (b.dataset.view) return go({type:b.dataset.view});
  if (b.dataset.scope) { learnScope = b.dataset.scope; session = null; render(); document.querySelector(`[data-scope="${CSS.escape(learnScope)}"]`)?.focus(); return; }
  if (b.dataset.learn) return startSession(b.dataset.learn);
  if (b.hasAttribute("data-endsession")) { session = null; render(); return; }
  if (b.hasAttribute("data-reveal")) { session.shown = true; render(); const k = K.find(x => x.id === session.cards[session.i]); say("Antwort: " + (k ? k.antwort : "")); $("cardA")?.focus({preventScroll:true}); return; }
  if (b.dataset.grade) return grade(b.dataset.grade === "1");
});
$("backBtn").onclick = () => history.back();
$("menuBtn").onclick = () => openSide("files");
$("settingsTop").onclick = () => go({type:"settings"});
$("sideClose").onclick = () => closeSide(true);
$("scrim").onclick = () => closeSide(true);
$("q").addEventListener("input", e => { query = e.target.value; renderSearch(); });
// Seitenleisten-Tabs mit Pfeiltasten
document.querySelector(".side-tabs").addEventListener("keydown", e => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return; const order = ["files", "search", "tags"], i = order.indexOf(UI.pane);
  const n = order[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3]; setPane(n); $("tab-" + n).focus(); e.preventDefault();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && drawerOpen()) { closeSide(true); return; }
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSide("search"); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || view.type !== "learn" || !session || session.i >= session.cards.length) return;
  const a = document.activeElement; if (a && a !== document.body && a !== $("content") && a.id !== "h-main" && !a.closest(".flash")) return;
  if (e.key === " " && !session.shown) { e.preventDefault(); document.querySelector("[data-reveal]")?.click(); }
  else if (session.shown && e.key === "1") grade(false); else if (session.shown && e.key === "2") grade(true);
});
matchMedia("(max-width:860px)").addEventListener("change", () => { layoutMode(); render(); });

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
  sync = {state:"busy", msg:""}; render();
  try {
    if (manual) CFG.etag = {};
    const k = await fetchData("keys.json");
    if (k.data) { remoteKeys = k.data; lsSet("wks-remote-keys", remoteKeys); }
    else if (k.missing) { remoteKeys = null; lsDel("wks-remote-keys"); }
    if (CFG.ready && privKey) {
      // Liegt im Repo ein anderer Schlüssel (neues Passwort auf einem anderen Gerät)? Dann muss dieses Gerät neu entsperren.
      if (remoteKeys && remoteKeys.kid !== CFG.kid) throw new Error("Auf einem anderen Gerät wurde ein neues Passwort festgelegt. Melde dich unter Einstellungen ab und entsperre mit dem neuen Passwort.");
      if (remoteKeys && lsGet(K_KEYS, null)?.kid === remoteKeys.kid) lsDel(K_KEYS); // Schlüssel ist übergeben
      const v = await fetchData("vault.enc.json");
      if (v.data) {
        if (v.data.kid && v.data.kid !== CFG.kid) throw new Error("Die Notizen sind noch für einen anderen Schlüssel verschlüsselt. Claude holt das beim nächsten Abendlauf nach.");
        let vault; try { vault = await WC.openVault(v.data, privKey); } catch { throw new Error("Die Notizen liessen sich nicht entschlüsseln."); }
        lsSet(K_CACHE, vault); setVault(vault, false);
      }
      if (CFG.token) await syncProgress().catch(() => {});
    }
    sync = {state:"", msg:""}; lsSet(K_CFG, CFG);
    if (manual) toast(isDemo ? "Geladen. Noch keine Unterlagen verarbeitet." : "Auf dem neuesten Stand.");
  } catch (e) { sync = {state:"err", msg:e.message || "Laden hat nicht geklappt."}; }
  render();
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
  const f = g.files[F_PROG];
  let remote = {};
  if (f) {
    let text = f.content; if (f.truncated) { const r = await fetch(f.raw_url); if (!r.ok) throw new Error("Lernstand unvollständig geladen."); text = await r.text(); }
    try { remote = await WC.openWithKey(JSON.parse(text), progKey); } catch { throw new Error("Der Lernstand wurde mit einem anderen Passwort gespeichert."); }
  }
  let changed = false;
  for (const [id, p] of Object.entries(remote || {})) if (!PR[id] || (+p.ts || 0) > (+PR[id].ts || 0)) { PR[id] = p; changed = true; }
  if (changed) { lsSet(K_PROG, PR); computeDue(); }
  if (Object.keys(PR).some(id => !remote[id] || (+PR[id].ts || 0) > (+remote[id].ts || 0))) await pushProgress();
}
let pushT = null;
// Vor dem Schreiben immer zuerst lesen und zusammenführen, damit kein Gerät das andere überschreibt
function schedulePush(ms = 3000) { if (!CFG.token || !progKey || isDemo) return; clearTimeout(pushT); pushT = setTimeout(() => syncProgress().catch(() => setTimeout(() => schedulePush(), 60000)), ms); }
async function pushProgress() { await gh("/gists/" + CFG.gistId, {method:"PATCH", body:JSON.stringify({files:{[F_PROG]:{content:JSON.stringify(await WC.sealWithKey(PR, progKey))}}})}); }
async function unlockAndStore(keys, pass) {
  const priv = await WC.unlockKeys(keys, pass), prog = await WC.progressKey(pass, keys.kid);
  await KeyStore.set({priv, prog, kid:keys.kid});
  privKey = priv; progKey = prog; CFG.ready = true; CFG.kid = keys.kid; lsSet(K_CFG, CFG);
}

/* ---------- Start ---------- */
(async function start() {
  remoteKeys = lsGet("wks-remote-keys", null);
  const ks = CFG.ready ? await KeyStore.get() : null;
  if (ks && ks.kid === CFG.kid) { privKey = ks.priv; progKey = ks.prog; } else if (CFG.ready) { CFG.ready = false; lsSet(K_CFG, CFG); }
  const cache = CFG.ready ? lsGet(K_CACHE, null) : null;
  setVault(cache || DEMO_VAULT, !cache);
  try { const s = history.state; if (s && s.v) { view = s.v; depth = s.depth || 0; } else history.replaceState({v:view, depth:0}, ""); } catch {}
  layoutMode(); setPane(UI.pane || "files"); render();
  refresh(true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) return; if (today() !== lastDay) { lastDay = today(); computeDue(); render(); } refresh(); });
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); computeDue(); render(); } }, 60000);
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
