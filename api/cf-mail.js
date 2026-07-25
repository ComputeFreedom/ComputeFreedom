// Gemeinsame Prüfungen und Helfer für die C|F-Anmeldung.
// Kein Speicher, keine Datenbank, keine dritte Partei.
import crypto from 'node:crypto';
import { promises as dns } from 'node:dns';

// ---------------------------------------------------------------- Adressprüfung
// Etwas strenger als die übliche Faustregel: kein doppelter Punkt, kein Punkt
// am Rand des lokalen Teils, Domain mit mindestens einem Punkt, TLD ≥ 2 Zeichen.
const RE_MAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,24}$/i;

// Wegwerf- und Weiterleitungsdienste. Bewusst kurz gehalten: die MX-Prüfung
// erledigt den Großteil, diese Liste fängt die bekannten Bequemlichkeiten.
const WEGWERF = new Set([
  'mailinator.com','10minutemail.com','10minutemail.net','guerrillamail.com','guerrillamail.net',
  'sharklasers.com','grr.la','tempmail.com','temp-mail.org','tempmailo.com','trashmail.com',
  'trashmail.de','wegwerfmail.de','wegwerfemail.de','byom.de','yopmail.com','yopmail.fr',
  'getnada.com','dispostable.com','maildrop.cc','mailnesia.com','moakt.com','mohmal.com',
  'fakeinbox.com','spam4.me','throwawaymail.com','emailondeck.com','inboxbear.com',
  'mailcatch.com','tempr.email','discard.email','einrot.com','tmpmail.org','luxusmail.org',
  'harakirimail.com','anonbox.net','muellmail.com','spoofmail.de','trbvm.com','mvrht.net',
]);

// Rollenadressen: gehören keiner Person, taugen nicht für eine Mailing-Liste.
const ROLLEN = new Set([
  'admin','administrator','postmaster','hostmaster','webmaster','abuse','noreply','no-reply',
  'donotreply','mailer-daemon','root','info','kontakt','contact','office','support','help',
  'sales','billing','marketing','newsletter','spam','test','testing','null','void','nobody',
]);

export function pruefeSyntax(email) {
  const em = String(email || '').trim().toLowerCase();
  if (!em || em.length > 254) return { ok: false, grund: 'syntax' };
  if (em.includes('..')) return { ok: false, grund: 'syntax' };
  if (!RE_MAIL.test(em)) return { ok: false, grund: 'syntax' };
  const [lokal, domain] = em.split('@');
  if (lokal.length > 64) return { ok: false, grund: 'syntax' };
  if (WEGWERF.has(domain)) return { ok: false, grund: 'wegwerf' };
  if (ROLLEN.has(lokal)) return { ok: false, grund: 'rolle' };
  return { ok: true, email: em, lokal, domain };
}

// ---------------------------------------------------------------- MX-Prüfung
// Fragt die Mailserver der Domain ab. Existiert die Domain nicht oder nennt sie
// keinen Mailserver, kann sie keine Post empfangen — dann ist die Adresse erfunden.
// Fällt auf A/AAAA zurück, denn nach RFC 5321 gilt ein A-Eintrag als impliziter MX.
export async function pruefeMx(domain, timeoutMs = 4000) {
  const lauf = (async () => {
    try {
      const mx = await dns.resolveMx(domain);
      const gut = (mx || []).filter(r => r.exchange && r.exchange !== '.' && r.exchange !== '');
      if (gut.length) return { ok: true, art: 'mx', wirt: gut.sort((a, b) => a.priority - b.priority)[0].exchange };
    } catch (e) { /* weiter mit A-Fallback */ }
    try {
      const a = await dns.resolve(domain).catch(() => null);
      if (a && a.length) return { ok: true, art: 'a', wirt: a[0] };
    } catch (e) { /* nichts */ }
    return { ok: false, grund: 'kein_mx' };
  })();
  const abbruch = new Promise(r => setTimeout(() => r({ ok: false, grund: 'dns_timeout' }), timeoutMs));
  return Promise.race([lauf, abbruch]);
}

// ---------------------------------------------------------------- HMAC-Links
// Bestätigen und Löschen laufen über signierte Links: die Adresse steht im Link,
// dazu ein Zeitstempel und eine Signatur. Der Server rechnet die Signatur nach —
// dafür braucht es keinen Speicher und keine Datenbank.
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function vonB64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

export function signiere(email, zweck, ts, key) {
  return b64url(crypto.createHmac('sha256', key).update(`${zweck}:${email}:${ts}`).digest());
}

export function baueLink(basis, email, zweck, key) {
  const ts = Date.now();
  const q = new URLSearchParams({ e: b64url(email), t: String(ts), z: zweck, s: signiere(email, zweck, ts, key) });
  return `${basis}?${q.toString()}`;
}

export function pruefeLink(query, key, maxAlterMs = 7 * 24 * 3600 * 1000) {
  const { e, t, z, s } = query || {};
  if (!e || !t || !z || !s) return { ok: false, grund: 'unvollstaendig' };
  let email;
  try { email = vonB64url(e).toLowerCase(); } catch { return { ok: false, grund: 'defekt' }; }
  const ts = Number(t);
  if (!Number.isFinite(ts)) return { ok: false, grund: 'defekt' };
  if (Date.now() - ts > maxAlterMs) return { ok: false, grund: 'abgelaufen' };
  if (Date.now() - ts < -60000) return { ok: false, grund: 'defekt' };
  const soll = signiere(email, String(z), ts, key);
  const a = Buffer.from(String(s)); const b = Buffer.from(soll);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, grund: 'signatur' };
  return { ok: true, email, zweck: String(z) };
}

// ---------------------------------------------------------------- Ratenbegrenzung
// Schlichter Zähler im Speicher der Funktionsinstanz. Kein vollständiger Schutz
// (Vercel startet mehrere Instanzen), aber er bremst das plumpe Nachschießen.
const EIMER = new Map();
export function zuVieleVersuche(ip, grenze = 5, fensterMs = 10 * 60 * 1000) {
  const jetzt = Date.now();
  const liste = (EIMER.get(ip) || []).filter(t => jetzt - t < fensterMs);
  liste.push(jetzt);
  EIMER.set(ip, liste);
  if (EIMER.size > 5000) EIMER.clear();
  return liste.length > grenze;
}

export function ipVon(req) {
  const h = req.headers || {};
  return String(h['x-forwarded-for'] || h['x-real-ip'] || '').split(',')[0].trim() || 'unbekannt';
}

export function basisUrl(req) {
  const h = req.headers || {};
  const proto = h['x-forwarded-proto'] || 'https';
  const host = h['x-forwarded-host'] || h.host || 'www.computefreedom.com';
  return `${proto}://${host}`;
}
