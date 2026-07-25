// GET /api/confirm?e=…&t=…&z=sub|del&s=…
// Prüft die Signatur des Links und sein Alter. Bei z=sub meldet er Dir den
// bestätigten Eintrag, bei z=del die Löschbitte. Kein Speicher, keine Datenbank —
// die Signatur ist der Beweis, dass der Link von uns kam und die Adresse
// derjenige in der Hand hatte, der die Mail empfangen hat.
import nodemailer from 'nodemailer';
import { pruefeLink } from './cf-mail.js';

const confirmKey = process.env.CONFIRM_HMAC_KEY;

// zeile1/zeile2 sind Paare [de, en]. Welche Fassung gilt, entscheidet der
// Browser des Besuchers — der Server weiss es nicht, der Link traegt keine
// Sprache. weiter/neben sind {href, de, en} oder null.
function seite(titel, zeile1, zeile2, weiter, neben) {
  // Wird versehentlich eine einzelne Zeichenkette uebergeben, stand vorher nur
  // ihr erster Buchstabe auf der Seite — zeile1[0] von 'Fertig.' ist 'F'.
  // Das faellt beim Lesen nicht auf, auf der Seite aber sofort. Also nehmen
  // wir beides an: Paar oder Zeichenkette.
  const paar = x => Array.isArray(x) ? x : [x, x];
  zeile1 = paar(zeile1); zeile2 = paar(zeile2);
  const btn = weiter
    ? `<a class="go" href="${weiter.href}" data-de="${weiter.de}" data-en="${weiter.en}">${weiter.de}</a>`
    : '';
  const nb = neben
    ? `<p class="neben"><a href="${neben.href}" data-de="${neben.de}" data-en="${neben.en}">${neben.de}</a></p>`
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
.neben{margin-top:20px;font-size:14.5px}
.neben a{color:#8fa8bb;text-decoration:none;border-bottom:1px solid rgba(150,185,215,.25);padding-bottom:2px}
.neben a:hover{color:#cfe0ee}
p{color:var(--ink2);font-size:17px;line-height:1.6;max-width:46ch;margin:0 auto 10px;font-weight:300}
.go{display:inline-block;margin-top:26px;padding:13px 28px;border-radius:10px;text-decoration:none;
 color:#0a1420;font-weight:500;font-size:16px;
 background:linear-gradient(100deg,var(--burnt),#e7eef6 52%,var(--polar));box-shadow:0 8px 26px rgba(168,188,199,.25)}
.mark{font-family:'Fraunces',Georgia,serif;font-weight:500;font-size:30px;color:var(--polar);opacity:.5;margin-bottom:22px}
</style></head><body><div>
<div class="mark">C|F</div><h1 data-de="${zeile1[0]}" data-en="${zeile1[1]}">${zeile1[0]}</h1>
<p data-de="${zeile2[0]}" data-en="${zeile2[1]}">${zeile2[0]}</p>${btn}${nb}
</div>
<script>
/* Zwei Dinge, beide klein.
   1. Sprache: der Link in der Mail traegt keine, also fragen wir den Browser.
   2. Der Merker: wer hier ankommt, hat den Eingang hinter sich — auch wenn er
      den Link auf einem anderen Geraet oeffnet. Ohne ihn schickt die Homepage
      ihn wieder an den Regler, und genau das ist am 25.07.2026 passiert.
      Kein Cookie, kein Server, nur localStorage. */
(function(){
  try{
    var gew = localStorage.getItem('cf-lang');
    var de = (gew === 'de') || (!gew && (navigator.language||'').toLowerCase().indexOf('de') === 0);
    if(!de){
      document.querySelectorAll('[data-en]').forEach(function(el){ el.textContent = el.getAttribute('data-en'); });
      document.documentElement.lang = 'en';
    }
    localStorage.setItem('cf-seen','1');
  }catch(e){}
})();
</script>
</body></html>`;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!confirmKey) {
    return res.status(500).send(seite('Fehler',
      ['Das können wir gerade nicht prüfen.', 'We cannot check that right now.'],
      ['Auf unserer Seite fehlt ein Schlüssel. Schreib uns kurz, dann klären wir das.',
       'A key is missing on our side. Drop us a line and we will sort it out.']));
  }

  const v = pruefeLink(req.query, confirmKey);
  if (!v.ok) {
    const text = v.grund === 'abgelaufen'
      ? ['Dieser Link ist älter als sieben Tage. Melde Dich einfach noch einmal an, dann kommt ein frischer.',
         'This link is older than seven days. Just sign up once more and a fresh one arrives.']
      : ['Dieser Link passt nicht zu uns. Vielleicht ist beim Kopieren etwas verloren gegangen — melde Dich gern noch einmal an.',
         'This link does not match ours. Perhaps something was lost in copying — you are welcome to sign up again.'];
    return res.status(400).send(seite('Link ungültig',
      ['Der Link trägt nicht.', 'The link does not hold.'], text,
      { href: '/eingang.html', de: 'Noch einmal anmelden ▶', en: 'Sign up again ▶' }));
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  const an = process.env.SUBSCRIBE_TO || 'contact@computefreedom.org';
  const von = process.env.SUBSCRIBE_FROM || 'contact@computefreedom.org';

  try {
    if (v.zweck === 'del') {
      await transporter.sendMail({
        from: von, to: an,
        subject: 'C|F Löschbitte (bestätigt): ' + v.email,
        text: 'Diese Adresse bittet um Löschung und hat den Link bestätigt:\n\n' + v.email +
              '\n\nBestätigt am ' + new Date().toISOString() + '\n',
      });
      return res.status(200).send(seite('Gelöscht',
        ['Erledigt.', 'Done.'],
        ['Deine Adresse wird aus der Liste genommen. Du hörst nichts mehr von uns — es sei denn, Du willst es wieder.',
         'Your address is taken off the list. You will not hear from us again — unless you want to.'],
        { href: '/index.html', de: 'Zur Homepage ▶', en: 'To the homepage ▶' }));
    }

    await transporter.sendMail({
      from: von, to: an,
      subject: 'C|F Anmeldung BESTÄTIGT: ' + v.email,
      text: 'Bestätigte Anmeldung für die C|F Mailing-Liste:\n\n' + v.email +
            '\n\nBestätigt am ' + new Date().toISOString() +
            '\nDie Adresse hat den signierten Link geöffnet — sie existiert und der Inhaber wollte es.\n',
    });
  } catch (e) {
    return res.status(500).send(seite('Fehler',
      ['Da ist bei uns etwas schiefgegangen.', 'Something went wrong on our side.'],
      ['Versuch es bitte in einem Moment noch einmal, oder schreib uns kurz.',
       'Please try again in a moment, or drop us a line.']));
  }

  // NICHT auf die Eingangsseite. Wer hier steht, hat den Regler laengst
  // bedient und seine Adresse bestaetigt — ihn noch einmal an den Anfang zu
  // schicken war ein Fehler und hat Besucher in eine Schleife gefuehrt.
  return res.status(200).send(seite('Bestätigt',
    ['Du bist dabei.', 'You are in.'],
    ['Wir melden uns selten, nur wenn es wirklich etwas Neues gibt. Und wenn Du nicht mehr magst, gehst Du mit einem Klick.',
     'We write rarely, and only when there is genuinely something new. And if you change your mind, you leave with one click.'],
    { href: '/spezialausgabe.html', de: 'Zur Spezialausgabe ▶', en: 'To the special edition ▶' },
    { href: '/index.html', de: 'oder direkt zur Homepage', en: 'or straight to the homepage' }));
}
