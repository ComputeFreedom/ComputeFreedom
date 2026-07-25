// GET /api/confirm?e=…&t=…&z=sub|del&s=…
// Prüft die Signatur des Links und sein Alter. Bei z=sub meldet er Dir den
// bestätigten Eintrag, bei z=del die Löschbitte. Kein Speicher, keine Datenbank —
// die Signatur ist der Beweis, dass der Link von uns kam und die Adresse
// derjenige in der Hand hatte, der die Mail empfangen hat.
import nodemailer from 'nodemailer';
import { pruefeLink } from './cf-mail.js';

const confirmKey = process.env.CONFIRM_HMAC_KEY;

function seite(titel, zeile1, zeile2, weiter) {
  const btn = weiter
    ? `<a class="go" href="${weiter}">Weiter geht’s &#9654;</a>`
    : '';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${titel} · ComputeFreedom</title><link rel="stylesheet" href="/fonts.css">
<style>
:root{--bg:#020308;--ink:#e6f1fa;--ink2:#b6ccdd;--burnt:#DD7740;--polar:#A8BCC7}
*{box-sizing:border-box}html,body{margin:0;min-height:100%;background:var(--bg);color:var(--ink);
 font-family:'IBM Plex Sans',ui-sans-serif,system-ui,sans-serif}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center;
 background:radial-gradient(ellipse 60% 44% at 50% 34%,rgba(14,30,52,.92),rgba(2,3,8,1))}
h1{font-family:'Fraunces',Georgia,serif;font-weight:340;font-size:clamp(28px,5vw,42px);margin:0 0 14px;line-height:1.15}
p{color:var(--ink2);font-size:17px;line-height:1.6;max-width:46ch;margin:0 auto 10px;font-weight:300}
.go{display:inline-block;margin-top:26px;padding:13px 28px;border-radius:10px;text-decoration:none;
 color:#0a1420;font-weight:500;font-size:16px;
 background:linear-gradient(100deg,var(--burnt),#e7eef6 52%,var(--polar));box-shadow:0 8px 26px rgba(168,188,199,.25)}
.mark{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:30px;color:var(--polar);opacity:.5;margin-bottom:22px}
</style></head><body><div>
<div class="mark">C|F</div><h1>${zeile1}</h1><p>${zeile2}</p>${btn}
</div></body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!confirmKey) {
    return res.status(500).send(seite('Fehler', 'Das können wir gerade nicht prüfen.',
      'Auf unserer Seite fehlt ein Schlüssel. Schreib uns kurz, dann klären wir das.'));
  }

  const v = pruefeLink(req.query, confirmKey);
  if (!v.ok) {
    const text = v.grund === 'abgelaufen'
      ? 'Dieser Link ist älter als sieben Tage. Melde Dich einfach noch einmal an, dann kommt ein frischer.'
      : 'Dieser Link passt nicht zu uns. Vielleicht ist beim Kopieren etwas verloren gegangen — melde Dich gern noch einmal an.';
    return res.status(400).send(seite('Link ungültig', 'Der Link trägt nicht.', text));
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const an = process.env.SUBSCRIBE_TO || 'info@computefreedom.org';
  const von = process.env.SUBSCRIBE_FROM || 'info@computefreedom.org';

  try {
    if (v.zweck === 'del') {
      await transporter.sendMail({
        from: von, to: an,
        subject: 'C|F Löschbitte (bestätigt): ' + v.email,
        text: 'Diese Adresse bittet um Löschung und hat den Link bestätigt:\n\n' + v.email +
              '\n\nBestätigt am ' + new Date().toISOString() + '\n',
      });
      return res.status(200).send(seite('Gelöscht', 'Erledigt.',
        'Deine Adresse wird aus der Liste genommen. Du hörst nichts mehr von uns — es sei denn, Du willst es wieder.'));
    }

    await transporter.sendMail({
      from: von, to: an,
      subject: 'C|F Anmeldung BESTÄTIGT: ' + v.email,
      text: 'Bestätigte Anmeldung für die C|F Mailing-Liste:\n\n' + v.email +
            '\n\nBestätigt am ' + new Date().toISOString() +
            '\nDie Adresse hat den signierten Link geöffnet — sie existiert und der Inhaber wollte es.\n',
    });
  } catch (e) {
    return res.status(500).send(seite('Fehler', 'Da ist bei uns etwas schiefgegangen.',
      'Versuch es bitte in einem Moment noch einmal, oder schreib uns kurz.'));
  }

  return res.status(200).send(seite('Bestätigt', 'Du bist dabei.',
    'Wir melden uns selten, nur wenn es wirklich etwas Neues gibt. Und wenn Du nicht mehr magst, gehst Du mit einem Klick.',
    '/eingang.html'));
}
