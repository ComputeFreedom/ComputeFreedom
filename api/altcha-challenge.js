// GET /api/altcha-challenge
// Gibt eine frische ALTCHA-Aufgabe aus (die "Rechenaufgabe fuer den Browser").
// Der Browser des Besuchers loest sie unsichtbar; geprueft wird sie in /api/subscribe.
// WICHTIG: der Unterpfad /v1. altcha-lib 2.x hat eine zweite, voellig andere
// Aufgaben-Form ({parameters:{...}} statt {algorithm,challenge,salt,signature}).
// Das ausgelieferte Widget spricht die ERSTE Form. Nimmt man die Vorgabe von
// 2.x, bekommt der Browser eine Aufgabe ohne Signatur, loest sie falsch, und
// die Pruefung sagt NEIN — genau der ALTCHA-Fehler vom 25.07.2026.
import { createChallenge } from 'altcha-lib/v1';

const hmacKey = process.env.ALTCHA_HMAC_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'method' }); return; }
  if (!hmacKey) { res.status(500).json({ error: 'ALTCHA_HMAC_KEY fehlt (Umgebungsvariable setzen)' }); return; }

  // maxNumber steuert die Schwierigkeit (hoeher = mehr Rechenaufwand fuer Bots).
  // expires: die Aufgabe ist 5 Minuten gueltig (Schutz gegen Wiederverwendung).
  const challenge = await createChallenge({
    hmacKey,
    // 50 000 statt 120 000: der Browser rechnet die Aufgabe im schlechtesten
    // Fall doppelt so schnell durch. Auf einem alten Handy ist das der
    // Unterschied zwischen »faellt nicht auf« und »haengt«. Fuer einen Bot
    // bleibt es Arbeit, und zwar bei JEDEM Versuch.
    maxNumber: 50000,
    expires: new Date(Date.now() + 5 * 60 * 1000),
  });

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(challenge);
}
