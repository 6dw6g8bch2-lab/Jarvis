"use strict";
/* Abgleich zwischen Geräten.
   Die Daten werden im Browser mit einem Passwort verschlüsselt (AES-GCM) und als geheimes GitHub-Gist gespeichert.
   Das Gist enthält nur unlesbaren Text. Token und Passwort bleiben auf dem Gerät. */
const SYNC_KEY = "lionel-budget-sync-v1", GIST_DESC = "Lionels Budget Sync (verschlüsselt)", GIST_FILE = "budget.enc.json";
let SY = {token:"", pass:"", gistId:"", last:0, error:""}, syncBusy = false, syncTimer = null, syncAgain = false, syncLastTry = 0;

function syncLoad() { try { const r = JSON.parse(localStorage.getItem(SYNC_KEY) || "null"); if (r && typeof r === "object") SY = {...SY, ...r, error:""}; } catch {} }
function syncStore() { try { localStorage.setItem(SYNC_KEY, JSON.stringify({token:SY.token, pass:SY.pass, gistId:SY.gistId, last:SY.last})); } catch {} }
const syncOn = () => !!(SY.token && SY.pass);

/* ---------- Verschlüsselung ---------- */
const b64 = u8 => { let s = ""; u8.forEach(b => s += String.fromCharCode(b)); return btoa(s); };
const unb64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function aesKey(pass, salt) {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:200000, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
}
async function encryptData(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), key = await aesKey(pass, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, new TextEncoder().encode(JSON.stringify(obj))));
  return {app:"lionels-budget", v:1, salt:b64(salt), iv:b64(iv), ct:b64(ct)};
}
async function decryptData(blob, pass) {
  const key = await aesKey(pass, unb64(blob.salt));
  const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv:unb64(blob.iv)}, key, unb64(blob.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/* ---------- GitHub ---------- */
async function gh(path, opts = {}) {
  const res = await fetch("https://api.github.com" + path, {...opts, headers:{Accept:"application/vnd.github+json", Authorization:"Bearer " + SY.token, "X-GitHub-Api-Version":"2022-11-28", ...(opts.body ? {"Content-Type":"application/json"} : {})}});
  if (res.status === 401) throw Object.assign(new Error("token"), {code:"token"});
  if (res.status === 403 || res.status === 404) throw Object.assign(new Error("access"), {code:res.status === 404 ? "missing" : "access"});
  if (!res.ok) throw Object.assign(new Error("http " + res.status), {code:"http"});
  return res.json();
}
async function findGist() {
  for (let page = 1; page <= 5; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    const hit = list.find(g => g.description === GIST_DESC && g.files && g.files[GIST_FILE]);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return "";
}
async function readRemote() {
  const g = await gh("/gists/" + SY.gistId);
  const f = g.files && g.files[GIST_FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated || text == null) { const r = await fetch(f.raw_url); text = await r.text(); }
  try { return JSON.parse(text); } catch { return null; }
}
async function writeRemote(blob) {
  const files = {[GIST_FILE]:{content:JSON.stringify(blob)}};
  if (!SY.gistId) { const g = await gh("/gists", {method:"POST", body:JSON.stringify({description:GIST_DESC, public:false, files})}); SY.gistId = g.id; }
  else await gh("/gists/" + SY.gistId, {method:"PATCH", body:JSON.stringify({files})});
}

/* ---------- Zusammenführen ---------- */
// Zahlungen: nach Nummer vereinen, die neuere Änderung gewinnt. Gelöschtes bleibt gelöscht.
// Einstellungen und Sparplan: die zuletzt geänderte Version gewinnt.
function mergeData(a, b) {
  const del = {...(b.del || {}), ...(a.del || {})};
  for (const k of Object.keys(del)) del[k] = Math.max(+(a.del || {})[k] || 0, +(b.del || {})[k] || 0);
  const map = new Map();
  for (const raw of [...(b.payments || []), ...(a.payments || [])]) { const p = cleanPayment(raw); if (!p) continue; const o = map.get(p.id); if (!o || p.ts > o.ts) map.set(p.id, p); }
  const payments = [...map.values()].filter(p => !(del[p.id] && del[p.id] >= p.ts));
  const sa = a.settings || {}, sb = b.settings || {}, ca = a.car, cb = b.car;
  return {
    app:"lionels-budget", v:1, exportedAt:new Date().toISOString(),
    settings:(+sa.ts || 0) >= (+sb.ts || 0) ? sa : sb,
    payments,
    car:!ca ? cb : !cb ? ca : ((+ca.ts || 0) >= (+cb.ts || 0) ? ca : cb),
    merchants:{...(b.merchants || {}), ...(a.merchants || {})},
    apSeen:[...new Set([...(a.apSeen || []), ...(b.apSeen || [])])],
    lastBackup:Math.max(+a.lastBackup || 0, +b.lastBackup || 0),
    del,
  };
}
// Gleicher Inhalt? (ohne Exportzeit)
const sig = d => JSON.stringify([d.settings, [...(d.payments || [])].map(p => cleanPayment(p)).sort((x, y) => x.id.localeCompare(y.id)), d.car || null, Object.entries(d.merchants || {}).sort(), [...(d.apSeen || [])].sort(), d.del || {}]);

/* ---------- Ablauf ---------- */
function syncMsg(text, cls = "") { const el = $("syncStatus"); if (el) { el.className = "status " + cls; el.textContent = text; } }
function syncRender() {
  const box = $("syncBox"); if (!box) return;
  const on = syncOn();
  $("syncOff").hidden = on; $("syncOn").hidden = !on;
  if (on) {
    const when = SY.last ? new Date(SY.last).toLocaleString("de-CH", {day:"numeric", month:"numeric", hour:"2-digit", minute:"2-digit"}) : "noch nie";
    $("syncInfo").textContent = SY.error ? "" : `Verbunden. Zuletzt abgeglichen: ${when}.`;
    if (SY.error) syncMsg(SY.error, "err"); else if (!syncBusy) syncMsg("");
  }
}
const SYNC_ERR = {token:"Der Token ist ungültig oder abgelaufen. Erstelle einen neuen und verbinde nochmals.", access:"GitHub verweigert den Zugriff. Prüf, ob der Token das Recht «gist» hat.", missing:"Das Sync-Gist wurde nicht gefunden. Verbinde nochmals.", pass:"Falsches Passwort. Es muss auf allen Geräten gleich sein."};
async function syncNow({manual = false} = {}) {
  if (!syncOn()) return false;
  if (syncBusy) { syncAgain = true; return false; }
  if (!navigator.onLine) { SY.error = "Du bist offline. Der Abgleich läuft später automatisch."; syncRender(); return false; }
  syncBusy = true; syncLastTry = Date.now(); if (manual || $("syncStatus")) syncMsg("Gleiche ab …");
  try {
    if (!SY.gistId) SY.gistId = await findGist();
    let remote = null;
    if (SY.gistId) {
      const blob = await readRemote();
      if (blob && blob.ct) { try { remote = await decryptData(blob, SY.pass); } catch { throw Object.assign(new Error("pass"), {code:"pass"}); } }
    }
    const local = snapshot();
    const merged = remote ? mergeData(local, remote) : local;
    if (sig(merged) !== sig(local)) { applyData(merged); save({sync:false}); renderAll(); if (tab === "mehr") { fillSettings(); } if (tab === "sparen" && !$("carEdit").open) fillCar(); }
    if (!remote || sig(merged) !== sig(remote)) await writeRemote(await encryptData(snapshot(), SY.pass));
    SY.last = Date.now(); SY.error = ""; syncStore();
    return true;
  } catch (e) {
    SY.error = SYNC_ERR[e.code] || (e instanceof TypeError ? "Keine Verbindung. Der Abgleich läuft später automatisch." : "Der Abgleich hat nicht geklappt. Versuch es später nochmals.");
    if (e.code === "token" || e.code === "pass" || e.code === "missing") { SY.gistId = e.code === "missing" ? "" : SY.gistId; }
    return false;
  } finally {
    syncBusy = false; syncRender();
    if (syncAgain) { syncAgain = false; scheduleSync(1500); }
  }
}
function scheduleSync(ms = 4000) { if (!syncOn()) return; clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), ms); }

async function syncConnect() {
  const token = $("syncToken").value.trim(), pass = $("syncPass").value;
  const m = $("syncMsgOff"); m.className = "status err";
  if (!/^(ghp_|github_pat_|gho_)[A-Za-z0-9_]{20,}$/.test(token)) { m.textContent = "Das sieht nicht nach einem GitHub-Token aus. Er beginnt mit «ghp_»."; $("syncToken").focus(); return; }
  if (pass.length < 6) { m.textContent = "Wähl ein Passwort mit mindestens 6 Zeichen. Es verschlüsselt deine Daten und muss auf allen Geräten gleich sein."; $("syncPass").focus(); return; }
  if (!window.crypto || !crypto.subtle) { m.textContent = "Dieser Browser kann nicht verschlüsseln. Öffne die App über https."; return; }
  const btn = $("syncConnect"); btn.disabled = true; m.className = "status"; m.textContent = "Verbinde …";
  SY = {token, pass, gistId:"", last:0, error:""};
  const ok = await syncNow({manual:true});
  btn.disabled = false;
  if (ok) { syncStore(); $("syncToken").value = ""; $("syncPass").value = ""; m.textContent = ""; toast("Sync ist eingerichtet."); }
  else { const err = SY.error; SY = {token:"", pass:"", gistId:"", last:0, error:""}; syncStore(); m.className = "status err"; m.textContent = err || "Verbinden hat nicht geklappt."; }
  syncRender();
}
function syncDisconnect() {
  if (!confirm("Sync auf diesem Gerät beenden? Deine Daten bleiben hier erhalten. Das verschlüsselte Gist bleibt auf GitHub, du kannst es dort löschen.")) return;
  clearTimeout(syncTimer); SY = {token:"", pass:"", gistId:"", last:0, error:""}; syncStore(); syncRender(); toast("Sync beendet.");
}
function syncInit() {
  syncLoad(); syncRender();
  $("syncConnect").onclick = syncConnect;
  $("syncNow").onclick = async () => { const ok = await syncNow({manual:true}); if (ok) toast("Abgeglichen."); };
  $("syncOffBtn").onclick = syncDisconnect;
  document.addEventListener("visibilitychange", () => { if (!document.hidden && syncOn() && Date.now() - syncLastTry > 20000) syncNow(); });
  window.addEventListener("online", () => scheduleSync(1000));
  if (syncOn()) syncNow();
}
