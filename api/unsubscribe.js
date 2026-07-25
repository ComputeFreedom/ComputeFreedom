// POST /api/unsubscribe
// Nimmt eine Abmeldung entgegen. Wir speichern nichts, also koennen wir hier
// auch nichts streichen — was wir tun koennen, ist dasselbe wie bei der
// Anmeldung: einen signierten Link an genau diese Adresse schicken. Wer ihn
// oeffnet, hat bewiesen, dass ihm die Adresse gehoert; erst dann gilt die
// Abmeldung. So kann niemand einen anderen austragen.
//
// Antwort: { ok:true } oder { ok:false, error:<schluessel> }
import nodemailer from 'nodemailer';
import { pruefeSyntax, pruefeMx, baueLink, zuVieleVersuche, ipVon, basisUrl } from './cf-mail.js';

const confirmKey = process.env.CONFIRM_HMAC_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ ok: false, error: 'method' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { email = '', website = '' } = body || {};

  // Honeypot: ausgefuellt heisst Bot. Wir antworten freundlich und tun nichts.
  if (String(website).trim() !== '') return res.status(200).json({ ok: true, still: true });

  if (zuVieleVersuche(ipVon(req))) {
    return res.status(429).json({ ok: false, error: 'zu_viele' });
  }

  const syn = pruefeSyntax(email);
  if (!syn.ok) return res.status(400).json({ ok: false, error: 'syntax' });

  const mx = await pruefeMx(syn.domain);
  if (!mx.ok) return res.status(400).json({ ok: false, error: 'kein_mx', domain: syn.domain });

  if (!confirmKey) return res.status(500).json({ ok: false, error: 'kein_confirm_key' });

  const loeschen = baueLink(`${basisUrl(req)}/api/confirm`, syn.email, 'del', confirmKey);

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
      subject: 'Abmeldung bestätigen · ComputeFreedom',
      text:
        'Du möchtest aus der C|F Mailing-Liste heraus.\n\n' +
        'Ein Klick, und Deine Adresse ist weg:\n' + loeschen + '\n\n' +
        'Klickst Du nicht, bleibt alles wie es ist.\n' +
        'Diesen Link haben wir nur an diese Adresse geschickt — so kann niemand\n' +
        'jemand anderen austragen.\n\n' +
        'C|F · ComputeFreedom\n',
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'versand' });
  }

  return res.status(200).json({ ok: true });
}
