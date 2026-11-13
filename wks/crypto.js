"use strict";
/* Verschlüsselung für WKS Wissen.
   - Schlüsselpaar (RSA-OAEP 2048): Claude verschlüsselt die Notizen mit dem öffentlichen Schlüssel und kennt kein Passwort.
   - Der private Schlüssel ist mit deinem Passwort versiegelt (PBKDF2 600 000 Runden + AES-GCM) und liegt so im Repo.
     Ohne Passwort ist er nutzlos; ein langes Passwort schützt auch gegen Ausprobieren.
   - Der Lernstand wird direkt mit dem Passwort verschlüsselt. */
const WC = {
  ITER:600000,
  b64: u8 => { let s = ""; new Uint8Array(u8).forEach(b => s += String.fromCharCode(b)); return btoa(s); },
  unb64: t => Uint8Array.from(atob(t), c => c.charCodeAt(0)),
  enc: new TextEncoder(), dec: new TextDecoder(),
  async passKey(pass, salt, iter) {
    const base = await crypto.subtle.importKey("raw", WC.enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
  },
  async sealWithPass(bytes, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, await WC.passKey(pass, salt, WC.ITER), bytes);
    return {iter:WC.ITER, salt:WC.b64(salt), iv:WC.b64(iv), ct:WC.b64(ct)};
  },
  async openWithPass(box, pass) {
    const key = await WC.passKey(pass, WC.unb64(box.salt), +box.iter || 250000);
    return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM", iv:WC.unb64(box.iv)}, key, WC.unb64(box.ct)));
  },
  // Kennung eines öffentlichen Schlüssels (kurz, zum Vergleichen)
  async kid(jwk) { const h = await crypto.subtle.digest("SHA-256", WC.enc.encode(jwk.n)); return WC.b64(new Uint8Array(h).slice(0, 9)).replace(/[+/=]/g, ""); },
  async createKeys(pass) {
    const kp = await crypto.subtle.generateKey({name:"RSA-OAEP", modulusLength:2048, publicExponent:new Uint8Array([1, 0, 1]), hash:"SHA-256"}, true, ["encrypt", "decrypt"]);
    const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    const keys = {v:2, app:"wks-wissen", kid:await WC.kid(pub), pub:{kty:pub.kty, n:pub.n, e:pub.e, alg:pub.alg}, priv:await WC.sealWithPass(priv, pass)};
    return {keys, privateKey:kp.privateKey};
  },
  async unlockKeys(keys, pass) {
    const pk = await WC.openWithPass(keys.priv, pass); // wirft bei falschem Passwort
    // Passt der öffentliche Schlüssel wirklich zum privaten? Schützt davor, dass jemand nur den öffentlichen Teil austauscht.
    const j = await crypto.subtle.exportKey("jwk", await crypto.subtle.importKey("pkcs8", pk, {name:"RSA-OAEP", hash:"SHA-256"}, true, ["decrypt"]));
    if (j.n !== keys.pub.n || j.e !== keys.pub.e || keys.kid !== await WC.kid(keys.pub)) throw Object.assign(new Error("Schlüssel verändert"), {tampered:true});
    return crypto.subtle.importKey("pkcs8", pk, {name:"RSA-OAEP", hash:"SHA-256"}, false, ["decrypt"]);
  },
  // Schlüssel für den Lernstand: aus Passwort und Schlüssel-Kennung abgeleitet, nicht exportierbar
  async progressKey(pass, kid) { return WC.passKey(pass, WC.enc.encode("wks-progress/" + kid), WC.ITER); },
  async sealWithKey(obj, key) { const iv = crypto.getRandomValues(new Uint8Array(12)); return {v:2, iv:WC.b64(iv), ct:WC.b64(await crypto.subtle.encrypt({name:"AES-GCM", iv}, key, WC.enc.encode(JSON.stringify(obj))))}; },
  async openWithKey(box, key) { return JSON.parse(WC.dec.decode(await crypto.subtle.decrypt({name:"AES-GCM", iv:WC.unb64(box.iv)}, key, WC.unb64(box.ct)))); },
  async openVault(file, privateKey) {
    const raw = await crypto.subtle.decrypt({name:"RSA-OAEP"}, privateKey, WC.unb64(file.ek));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv:WC.unb64(file.iv)}, key, WC.unb64(file.ct));
    return JSON.parse(WC.dec.decode(pt));
  },
};
/* Gesperrte Schlüssel im Gerät (IndexedDB): Das Passwort selbst wird nie gespeichert. */
const KeyStore = {
  db() { return new Promise((res, rej) => { const r = indexedDB.open("wks-keys", 1); r.onupgradeneeded = () => r.result.createObjectStore("k"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get() { try { const d = await KeyStore.db(); return await new Promise(res => { const q = d.transaction("k").objectStore("k").get("keys"); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); } catch { return null; } },
  async set(v) { const d = await KeyStore.db(); return new Promise((res, rej) => { const t = d.transaction("k", "readwrite"); t.objectStore("k").put(v, "keys"); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async clear() { try { const d = await KeyStore.db(); d.transaction("k", "readwrite").objectStore("k").delete("keys"); } catch {} },
};
