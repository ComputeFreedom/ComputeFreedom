// GET /api/altcha-challenge
// Gibt eine frische ALTCHA-Aufgabe aus (die "Rechenaufgabe fuer den Browser").
// Der Browser des Besuchers loest sie unsichtbar; geprueft wird sie in /api/subscribe.
import { createChallenge } from 'altcha-lib';

const hmacKey = process.env.ALTCHA_HMAC_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method' }); return; }
  if (!hmacKey) { res.status(500).json({ error: 'ALTCHA_HMAC_KEY fehlt (Umgebungsvariable setzen)' }); return; }

  // maxNumber steuert die Schwierigkeit (hoeher = mehr Rechenaufwand fuer Bots).
  // expires: die Aufgabe ist 5 Minuten gueltig (Schutz gegen Wiederverwendung).
  const challenge = await createChallenge({
    hmacKey,
    maxNumber: 120000,
    expires: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(challenge);
}
