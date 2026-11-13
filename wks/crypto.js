"use strict";
/* Verschlüsselung für WKS Wissen.
   - Schlüsselpaar (RSA-OAEP): Die abendliche Aufgabe verschlüsselt mit dem öffentlichen Schlüssel und kennt kein Passwort.
   - Der private Schlüssel liegt nur mit deinem Passwort verschlüsselt im Gist (PBKDF2 + AES-GCM).
   - Der Lernstand wird direkt mit dem Passwort verschlüsselt. */
const WC = {
  b64: u8 => { let s = ""; new Uint8Array(u8).forEach(b => s += String.fromCharCode(b)); return btoa(s); },
  unb64: t => Uint8Array.from(atob(t), c => c.charCodeAt(0)),
  enc: new TextEncoder(), dec: new TextDecoder(),
  async passKey(pass, salt) {
    const base = await crypto.subtle.importKey("raw", WC.enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:250000, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt", "decrypt"]);
  },
  async sealWithPass(bytes, pass) {
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, await WC.passKey(pass, salt), bytes);
    return {salt:WC.b64(salt), iv:WC.b64(iv), ct:WC.b64(ct)};
  },
  async openWithPass(box, pass) {
    return new Uint8Array(await crypto.subtle.decrypt({name:"AES-GCM", iv:WC.unb64(box.iv)}, await WC.passKey(pass, WC.unb64(box.salt)), WC.unb64(box.ct)));
  },
  // Neues Schlüsselpaar, privater Schlüssel mit Passwort versiegelt
  async createKeys(pass) {
    const kp = await crypto.subtle.generateKey({name:"RSA-OAEP", modulusLength:3072, publicExponent:new Uint8Array([1, 0, 1]), hash:"SHA-256"}, true, ["encrypt", "decrypt"]);
    const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
    return {file:{v:1, app:"wks-wissen", pub, priv:await WC.sealWithPass(priv, pass)}, privateKey:kp.privateKey};
  },
  async unlockKeys(file, pass) {
    const pk = await WC.openWithPass(file.priv, pass); // wirft bei falschem Passwort
    return crypto.subtle.importKey("pkcs8", pk, {name:"RSA-OAEP", hash:"SHA-256"}, false, ["decrypt"]);
  },
  async openVault(file, privateKey) {
    const raw = await crypto.subtle.decrypt({name:"RSA-OAEP"}, privateKey, WC.unb64(file.ek));
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const pt = await crypto.subtle.decrypt({name:"AES-GCM", iv:WC.unb64(file.iv)}, key, WC.unb64(file.ct));
    return JSON.parse(WC.dec.decode(pt));
  },
  async sealJson(obj, pass) { return {v:1, ...(await WC.sealWithPass(WC.enc.encode(JSON.stringify(obj)), pass))}; },
  async openJson(box, pass) { return JSON.parse(WC.dec.decode(await WC.openWithPass(box, pass))); },
};
