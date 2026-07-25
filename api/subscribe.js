// POST /api/subscribe
// Nimmt eine Anmeldung entgegen, prüft sie ehrlich und schickt dem Besucher eine
// Bestätigungsmail mit signiertem Link. In die Liste kommt nur, wer klickt.
//
// Antwort: { ok:true, pruefungen:{...} }  oder  { ok:false, error:<schluessel>, pruefungen:{...} }
// Die Schlüssel bespielen den C64-Bildschirm — er zeigt echte Ergebnisse und
// darf auch NEIN sagen. Ohne diese Ehrlichkeit wäre der Bildschirm Theater.
//
// Erwarteter Body: { email, website, altcha, cf_human, t_start }
//   website : Honeypot (muss leer sein)
//   altcha  : gelöste ALTCHA-Aufgabe
//   cf_human: "CF-OK", wird erst gesetzt, wenn der Fader auf 0 dB einrastet
//   t_start : Zeitstempel beim Seitenaufbau (Zeit-Falle)
// Muss aus derselben Fassung kommen wie die Aufgabe: altcha-lib/v1.
// Die Pruefung aus 2.x wirft bei einer v1-Nutzlast eine Ausnahme.
import { verifySolution } from 'altcha-lib/v1';
import nodemailer from 'nodemailer';
import { pruefeSyntax, pruefeMx, baueLink, zuVieleVersuche, ipVon, basisUrl } from './cf-mail.js';

const hmacKey = process.env.ALTCHA_HMAC_KEY;
const confirmKey = process.env.CONFIRM_HMAC_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { email = '', website = '', altcha = '', cf_human = '', t_start = 0 } = body || {};

  const p = { honeypot: null, zeit: null, cf: null, altcha: null, syntax: null, mx: null, versand: null };

  // 1) Honeypot. Ausgefüllt heißt Bot. Wir tun so, als sei alles in Ordnung,
  //    damit der Bot kein Feedback bekommt — gespeichert wird nichts.
  if (String(website).trim() !== '') {
    return res.status(200).json({ ok: true, pruefungen: { ...p, honeypot: 'OK' }, still: true });
  }
  p.honeypot = 'OK';

  // 2) Ratenbegrenzung, bevor irgendetwas Teures passiert.
  if (zuVieleVersuche(ipVon(req))) {
    return res.status(429).json({ ok: false, error: 'zu_viele', pruefungen: p });
  }

  // 3) Zeit-Falle: unter 1,5 Sekunden ist niemand durch den Fader gekommen.
  if (t_start && (Date.now() - Number(t_start)) < 1500) {
    p.zeit = 'FAIL';
    return res.status(400).json({ ok: false, error: 'zu_schnell', pruefungen: p });
  }
  p.zeit = 'OK';

  // 4) Der Fader-Griff.
  if (cf_human !== 'CF-OK') {
    p.cf = 'FAIL';
    return res.status(400).json({ ok: false, error: 'cf', pruefungen: p });
  }
  p.cf = 'OK';

  // 5) ALTCHA serverseitig nachrechnen.
  let altchaOK = false;
  try { altchaOK = await verifySolution(altcha, hmacKey); } catch { altchaOK = false; }
  if (!altchaOK) {
    p.altcha = 'FAIL';
    return res.status(400).json({ ok: false, error: 'altcha', pruefungen: p });
  }
  p.altcha = 'OK';

  // 6) Adresse: Form, Wegwerfdienste, Rollenadressen.
  const syn = pruefeSyntax(email);
  if (!syn.ok) {
    p.syntax = 'FAIL';
    return res.status(400).json({ ok: false, error: syn.grund, pruefungen: p });
  }
  p.syntax = 'OK';

  // 7) Die eigentliche Hürde: kann die Domain überhaupt Post empfangen?
  //    Erfundene Domains scheitern hier, und zwar sichtbar.
  const mx = await pruefeMx(syn.domain);
  if (!mx.ok) {
    p.mx = 'FAIL';
    return res.status(400).json({ ok: false, error: mx.grund, pruefungen: p, domain: syn.domain });
  }
  p.mx = 'OK';

  // 8) Bestätigungsmail an den Besucher. Erst ihr Link trägt den Eintrag in die Liste.
  if (!confirmKey) {
    p.versand = 'FAIL';
    return res.status(500).json({ ok: false, error: 'kein_confirm_key', pruefungen: p });
  }
  const basis = basisUrl(req);
  const bestaetigen = baueLink(`${basis}/api/confirm`, syn.email, 'sub', confirmKey);
  const loeschen = baueLink(`${basis}/api/confirm`, syn.email, 'del', confirmKey);

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    await transporter.sendMail({
      from: process.env.SUBSCRIBE_FROM || 'info@computefreedom.org',
      to: syn.email,
      subject: 'Bestätige Deine Email · ComputeFreedom',
      text:
        'Fast fertig.\n\n' +
        'Ein Klick, und Du bist in der C|F Mailing-Liste:\n' + bestaetigen + '\n\n' +
        'Klickst Du nicht, passiert nichts — Deine Adresse liegt nirgends.\n\n' +
        'Wir melden uns selten, nur wenn es wirklich etwas Neues gibt.\n' +
        'Kein Tracking. Deine Adresse bleibt bei uns.\n\n' +
        'Und wenn Du später nicht mehr magst, gehst Du mit einem Klick:\n' + loeschen + '\n\n' +
        'C|F · ComputeFreedom\n',
    });
    p.versand = 'OK';
  } catch (e) {
    // Den Grund NICHT verschlucken. Bisher stand in den Logs nichts, und der
    // C64 sagte nur »DEVICE NOT PRESENT« — richtig, aber unbrauchbar fuer die
    // Fehlersuche. SMTP-Antworten enthalten keine Geheimnisse, nur Klartext
    // wie »535 Authentication failed«.
    const grund = (e && (e.response || e.message)) ? String(e.response || e.message).slice(0, 300) : 'unbekannt';
    console.error('[C|F] Versand fehlgeschlagen:', grund, '· code:', e && e.code, '· host:', process.env.SMTP_HOST, '· port:', process.env.SMTP_PORT);
    p.versand = 'FAIL';
    return res.status(500).json({ ok: false, error: 'versand', pruefungen: p, grund });
  }

  return res.status(200).json({ ok: true, pruefungen: p, domain: syn.domain, mx: mx.wirt || null });
}
