// Verschlüsselt den Inhalt der WKS-Datenbank und legt ihn ins geheime Gist «WKS Wissen (verschlüsselt)».
// Aufruf: NODE_USE_ENV_PROXY=1 node publish-vault.mjs <ordner>
// <ordner> ist das out_dir eines ArtifactData-list-Aufrufs: <ordner>/<sammlung>/<id>.json (faecher, themen, karten, termine, meta/status.json).
// Der GitHub-Token wird vom Netzwerk-Proxy der Umgebung eingesetzt; hier steht nur ein Platzhalter.
import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle, DESC = "WKS Wissen (verschlüsselt)";
const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) { console.error("Ordner fehlt: " + dir); process.exit(2); }
const read = c => { const d = path.join(dir, c); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => ({id:f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))})) : []; };
const statusFile = path.join(dir, "meta", "status.json");
const vault = {v:1, erstellt:new Date().toISOString(), faecher:read("faecher"), themen:read("themen"), karten:read("karten"), termine:read("termine"),
  status:fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, "utf8")) : null};

const H = {Authorization:"Bearer ghp_platzhalter000000000000000000000000", Accept:"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28", "User-Agent":"wks-publisher"};
const gh = async (p, o = {}) => { const r = await fetch((process.env.WKS_API || "https://api.github.com") + p, {...o, headers:{...H, ...(o.body ? {"Content-Type":"application/json"} : {})}}); if (!r.ok) throw new Error(`GitHub ${r.status} bei ${p}: ${(await r.text()).slice(0, 200)}`); return r.json(); };

let gist = null;
for (let page = 1; page <= 5 && !gist; page++) { const list = await gh(`/gists?per_page=100&page=${page}`); gist = list.find(g => g.description === DESC) || null; if (list.length < 100) break; }
if (!gist) { console.error("Kein Gist «" + DESC + "» gefunden. Lionel muss die App zuerst einrichten (Token und Passwort)."); process.exit(3); }
const full = await gh("/gists/" + gist.id);
const kf = full.files["wks-keys.json"];
if (!kf) { console.error("Im Gist fehlt wks-keys.json. Lionel muss die App zuerst einrichten."); process.exit(3); }
const keys = JSON.parse(kf.truncated ? await (await fetch(kf.raw_url)).text() : kf.content);
const pub = await subtle.importKey("jwk", keys.pub, {name:"RSA-OAEP", hash:"SHA-256"}, false, ["encrypt"]);
const aes = await subtle.generateKey({name:"AES-GCM", length:256}, true, ["encrypt"]);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const ct = await subtle.encrypt({name:"AES-GCM", iv}, aes, new TextEncoder().encode(JSON.stringify(vault)));
const ek = await subtle.encrypt({name:"RSA-OAEP"}, pub, await subtle.exportKey("raw", aes));
const b64 = u => Buffer.from(new Uint8Array(u)).toString("base64");
const file = {v:1, app:"wks-wissen", erstellt:vault.erstellt, ek:b64(ek), iv:b64(iv), ct:b64(ct)};
await gh("/gists/" + gist.id, {method:"PATCH", body:JSON.stringify({files:{"wks-vault.enc.json":{content:JSON.stringify(file)}}})});
console.log(`Veröffentlicht: ${vault.faecher.length} Fächer, ${vault.themen.length} Themen, ${vault.karten.length} Karten, ${vault.termine.length} Termine.`);
