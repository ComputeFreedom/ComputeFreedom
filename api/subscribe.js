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

/* Die Bestätigungsmail in der Sprache der Marke: Tiefsee, Polarblau, ein
   Trennstrich. Ein einziger Knopf zählt. Der Weg hinaus steht darunter, unter
   einem Strich, in 12 px und gedämpft — sichtbar, aber nicht gleichrangig.
   Kein externes Bild, keine Schriftdatei, kein Zählpixel: was hier steht,
   steht in der Mail selbst. */
function mailHtml(bestaetigen, loeschen) {
  const e = (u) => String(u).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<!doctype html><html lang="de"><body style="margin:0;padding:0;background:#08111A;">
<div style="max-width:520px;margin:0 auto;padding:38px 26px 30px;background:#08111A;
 font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="font:500 26px/1 Georgia,serif;color:#A8BCC7;opacity:.62;letter-spacing:.02em;">C|F</div>
  <h1 style="margin:22px 0 14px;font:340 27px/1.2 Georgia,serif;color:#E6F1FA;">Fast fertig.</h1>
  <p style="margin:0 0 22px;font-size:16px;line-height:1.62;color:#B6CCDD;font-weight:300;">
    Ein Klick, und Du bist auf der C|F-Liste.</p>
  <p style="margin:0 0 26px;">
    <a href="${e(bestaetigen)}" style="display:inline-block;background:#DD7740;color:#0A1420;
      text-decoration:none;font-weight:600;font-size:16px;padding:13px 26px;border-radius:5px;">
      Ja, ich bin dabei</a></p>
  <p style="margin:0 0 8px;font-size:14.5px;line-height:1.62;color:#93AABD;font-weight:300;">
    Klickst Du nicht, passiert nichts: Deine Adresse liegt nirgends.</p>
  <p style="margin:0 0 26px;font-size:14.5px;line-height:1.62;color:#93AABD;font-weight:300;">
    Wir melden uns selten, nur wenn es wirklich etwas Neues gibt.
    Kein Tracking. Deine Adresse bleibt bei uns.</p>
  <div style="height:1px;background:#1C2A38;margin:0 0 14px;"></div>
  <p style="margin:0;font-size:12px;line-height:1.6;color:#6C8296;font-weight:300;">
    Doch nicht? <a href="${e(loeschen)}" style="color:#6C8296;text-decoration:underline;">Hier
    wieder heraus</a> — sofort und restlos, ohne Rückfrage.</p>
</div></body></html>`;
}

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

  // 4) Der Fader-Griff — oder, seit dem 26.07.2026, das Feld auf der Homepage.
  //    'CF-OK'   kommt vom Eingang: der Fader ist auf 0 dB eingerastet.
  //    'CF-HOME' kommt aus dem Bereich „Mitmachen / Abmelden" auf der Homepage,
  //              wo es keinen Fader gibt. Das ist kein Loch: der Fader war nie
  //              die Huerde — er ist die Szene. Getragen wird die Pruefung von
  //              Honeypot, Zeitfalle, ALTCHA, Sperrlisten und MX, und in die
  //              Liste kommt ohnehin nur, wer den Link in der Mail klickt.
  if (cf_human !== 'CF-OK' && cf_human !== 'CF-HOME') {
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
    // Michael, 26.07.2026: der Abmeldelink stand gleichrangig neben dem
    // Bestätigungslink und hat irritiert — niemand meldet sich an, um sich
    // sofort wieder abzumelden. Er gehört ans Ende, in kleiner Schrift,
    // unter einen Strich. Weg darf er nicht: er ist unser Versprechen.
    await transporter.sendMail({
      from: process.env.SUBSCRIBE_FROM || 'contact@computefreedom.org',
      to: syn.email,
      subject: 'Bestätige Deine Adresse · ComputeFreedom',
      text:
        'Fast fertig.\n\n' +
        'Ein Klick, und Du bist auf der C|F-Liste:\n' + bestaetigen + '\n\n' +
        'Klickst Du nicht, passiert nichts: Deine Adresse liegt nirgends.\n\n' +
        'Wir melden uns selten, nur wenn es wirklich etwas Neues gibt.\n' +
        'Kein Tracking. Deine Adresse bleibt bei uns.\n\n' +
        'C|F · ComputeFreedom\n' +
        '\n---\n' +
        'Doch nicht? Dann hier wieder heraus, sofort und restlos:\n' + loeschen + '\n',
      html: mailHtml(bestaetigen, loeschen),
    });
    p.versand = 'OK';
  } catch (e) {
    // Den Grund NICHT verschlucken. Bisher stand in den Logs nichts, und der
    // C64 sagte nur »DEVICE NOT PRESENT« — richtig, aber unbrauchbar fuer die
    // Fehlersuche. SMTP-Antworten enthalten keine Geheimnisse, nur Klartext
    // wie »535 Authentication failed«.
    const grund = (e && (e.response || e.message)) ? String(e.response || e.message).slice(0, 300) : 'unbekannt';
    // Adressen sind keine Geheimnisse — das Passwort taucht hier nirgends auf.
    // Bei »535 authentication failed« ist fast immer der BENUTZER falsch, und
    // das laesst sich sonst nicht nachsehen: Vercel zeigt gesetzte Werte, die
    // als »Sensitive« markiert sind, kein zweites Mal an.
    const wer = {
      host: process.env.SMTP_HOST || '(nicht gesetzt)',
      port: process.env.SMTP_PORT || '(nicht gesetzt)',
      user: process.env.SMTP_USER || '(nicht gesetzt)',
      von:  process.env.SUBSCRIBE_FROM || '(nicht gesetzt)',
      pass_laenge: (process.env.SMTP_PASS || '').length,
    };
    console.error('[C|F] Versand fehlgeschlagen:', grund, '· code:', e && e.code, '·', JSON.stringify(wer));
    p.versand = 'FAIL';
    return res.status(500).json({ ok: false, error: 'versand', pruefungen: p, grund, wer });
  }

  return res.status(200).json({ ok: true, pruefungen: p, domain: syn.domain, mx: mx.wirt || null });
}
