// Baut die verschlüsselte Notizdatei für WKS Wissen.
// Aufruf: node build-vault.mjs <dumpOrdner> <keys.json> <ausgabe.json>
// <dumpOrdner>: out_dir von ArtifactData (faecher/, themen/, karten/, termine/, meta/status.json)
// <keys.json>: Lionels Schlüsseldatei aus dem Branch wks-data (nur der öffentliche Teil wird gebraucht)
import fs from "node:fs";
import path from "node:path";
import { webcrypto } from "node:crypto";

const [dir, keysFile, outFile] = process.argv.slice(2);
if (!dir || !keysFile || !outFile) { console.error("Aufruf: node build-vault.mjs <dumpOrdner> <keys.json> <ausgabe.json>"); process.exit(2); }
if (!fs.existsSync(keysFile)) { console.error("Keine Schlüsseldatei. Lionel hat die App noch nicht eingerichtet."); process.exit(3); }
const subtle = webcrypto.subtle;
const read = c => { const d = path.join(dir, c); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".json")).map(f => ({id:f.slice(0, -5), ...JSON.parse(fs.readFileSync(path.join(d, f), "utf8"))})) : []; };
const statusFile = path.join(dir, "meta", "status.json");
const vault = {v:1, erstellt:new Date().toISOString(), faecher:read("faecher"), themen:read("themen"), karten:read("karten"), termine:read("termine"),
  status:fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, "utf8")) : null};
if (!vault.themen.length && !vault.faecher.length) { console.error("Export ist leer. Nichts veröffentlicht, damit keine Notizen verloren gehen."); process.exit(5); }
const keys = JSON.parse(fs.readFileSync(keysFile, "utf8"));
const pub = await subtle.importKey("jwk", {kty:"RSA", n:keys.pub.n, e:keys.pub.e, alg:"RSA-OAEP-256", ext:true}, {name:"RSA-OAEP", hash:"SHA-256"}, false, ["encrypt"]);
const aes = await subtle.generateKey({name:"AES-GCM", length:256}, true, ["encrypt"]);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const ct = await subtle.encrypt({name:"AES-GCM", iv}, aes, new TextEncoder().encode(JSON.stringify(vault)));
const ek = await subtle.encrypt({name:"RSA-OAEP"}, pub, await subtle.exportKey("raw", aes));
const b64 = u => Buffer.from(new Uint8Array(u)).toString("base64");
fs.writeFileSync(outFile, JSON.stringify({v:1, app:"wks-wissen", kid:keys.kid, erstellt:vault.erstellt, ek:b64(ek), iv:b64(iv), ct:b64(ct)}));
console.log(`Gebaut: ${vault.faecher.length} Fächer, ${vault.themen.length} Themen, ${vault.karten.length} Karten, ${vault.termine.length} Termine.`);
