/* ─────────────────────────────────────────────────────────────────────────
   C|F · Besucherzählung — und die Wahl darüber.            26. Juli 2026

   Warum es diese Datei gibt: Fast jede Seite im Netz stellt ihren Besuchern
   ein Fenster in den Weg und lässt sie Cookies wegklicken. Wir setzen keine
   Cookies, also gibt es hier auch kein Fenster. Stattdessen einen Schalter
   in der Fußzeile, den niemand suchen muss und der niemanden aufhält.

   Drei Zustände:
     ohne Wahl, ohne DNT   → wir zählen  (berechtigtes Interesse, Art. 6 I f)
     ohne Wahl, mit DNT    → wir zählen NICHT, und bieten es an
     mit Wahl              → was der Besucher gesagt hat, gilt

   Die Wahl liegt als EIN Wort in localStorage („ja" / „nein") auf dem Gerät
   des Besuchers. Sie geht an keinen Server. Eine Entscheidung zu speichern,
   die jemand selbst getroffen hat, ist keine Erfassung — und nach
   § 25 Abs. 2 TDDDG ausdrücklich erlaubt.

   Gemessen wird über Vercel Web Analytics und Speed Insights: cookielos,
   Hash aus der Anfrage, nach 24 Stunden verfallen. Siehe datenschutz.html.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var SCHLUESSEL = 'cf-zaehlen';
  var SKRIPTE = ['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'];
  var geladen = false;

  /* „Do Not Track" und „Global Privacy Control" sind dasselbe Signal in zwei
     Generationen. Beide heißen: lass mich in Ruhe. Wir hören auf beide. */
  function nichtVerfolgen() {
    try {
      return navigator.doNotTrack === '1' || window.doNotTrack === '1' ||
             navigator.msDoNotTrack === '1' || navigator.globalPrivacyControl === true;
    } catch (e) { return false; }
  }
  function wahl()      { try { return localStorage.getItem(SCHLUESSEL); } catch (e) { return null; } }
  function merke(w)    { try { localStorage.setItem(SCHLUESSEL, w); } catch (e) {} }

  function zaehltJetzt() {
    var w = wahl();
    if (w === 'nein') return false;
    if (w === 'ja')   return true;
    return !nichtVerfolgen();
  }
  window.__cfZaehltJetzt = zaehltJetzt;

  function laden() {
    if (geladen || !zaehltJetzt()) return;
    geladen = true;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    window.si = window.si || function () { (window.siq = window.siq || []).push(arguments); };
    SKRIPTE.forEach(function (src) {
      var s = document.createElement('script');
      s.defer = true; s.src = src;
      document.head.appendChild(s);
    });
  }
  laden();

  /* ── Der Schalter ──────────────────────────────────────────────────────
     Erscheint nur, wo im Dokument ein Platz dafür steht (#cfZaehlung).
     Eingangsseite und Spezialausgabe haben keine Fußzeile und deshalb
     keinen Schalter — dort führt der Sternchen-Hinweis hierher. */
  var TEXT = {
    de: {
      an:     'Keine Cookies, kein Banner. Wir zählen Seitenaufrufe anonym.',
      anKnopf:'abschalten',
      aus:    'Wir zählen Dich nicht.',
      ausKnopf:'doch mitzählen',
      dnt:    'Dein Browser sagt „Do Not Track". Wir halten uns daran und zählen Dich nicht.',
      dntKnopf:'trotzdem mitzählen',
      wegDank:'Notiert. Ab dem nächsten Seitenaufruf zählen wir Dich nicht.',
      anDank: 'Danke. Ab jetzt zählen wir Dich mit.'
    },
    en: {
      an:     'No cookies, no banner. We count page views anonymously.',
      anKnopf:'switch it off',
      aus:    'We are not counting you.',
      ausKnopf:'count me after all',
      dnt:    'Your browser says “Do Not Track”. We honour that and are not counting you.',
      dntKnopf:'count me anyway',
      wegDank:'Noted. From your next page view on, we will not count you.',
      anDank: 'Thank you. From now on we count you in.'
    }
  };
  function t() { return TEXT[document.documentElement.lang === 'de' ? 'de' : 'en']; }

  function stil() {
    if (document.getElementById('cfZaehlStil')) return;
    var s = document.createElement('style');
    s.id = 'cfZaehlStil';
    s.textContent =
      '#cfZaehlung{margin-top:14px;text-align:center;font-family:ui-monospace,"JetBrains Mono",monospace;' +
      'font-size:11.5px;line-height:1.7;letter-spacing:.03em;opacity:.62;' +
      'display:flex;gap:8px;justify-content:center;align-items:baseline;flex-wrap:wrap}' +
      '#cfZaehlung:hover,#cfZaehlung:focus-within{opacity:.92}' +
      '#cfZaehlung button{appearance:none;background:none;border:0;padding:2px 0;margin:0;cursor:pointer;' +
      'font:inherit;color:inherit;text-decoration:underline;text-underline-offset:3px;' +
      'text-decoration-thickness:1px;opacity:.85}' +
      '#cfZaehlung button:hover{opacity:1}' +
      '#cfZaehlung button:focus-visible{outline:1px solid currentColor;outline-offset:3px;border-radius:2px}' +
      '@media (prefers-reduced-motion: reduce){#cfZaehlung{transition:none}}';
    document.head.appendChild(s);
  }

  var meldung = null;   /* nach einem Klick: die Bestätigung, statt der Lage */

  function zeichne() {
    var kasten = document.getElementById('cfZaehlung');
    if (!kasten) return;
    stil();
    var w = wahl(), s = t(), satz, knopf, ziel;

    if (meldung) { satz = meldung; knopf = null; }
    else if (w === 'nein')        { satz = s.aus; knopf = s.ausKnopf; ziel = 'ja'; }
    else if (w === 'ja')          { satz = s.an;  knopf = s.anKnopf;  ziel = 'nein'; }
    else if (nichtVerfolgen())    { satz = s.dnt; knopf = s.dntKnopf; ziel = 'ja'; }
    else                          { satz = s.an;  knopf = s.anKnopf;  ziel = 'nein'; }

    kasten.textContent = '';
    var sp = document.createElement('span');
    sp.textContent = satz;
    kasten.appendChild(sp);

    if (!knopf) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.textContent = knopf;
    b.addEventListener('click', function () {
      merke(ziel);
      meldung = (ziel === 'ja') ? t().anDank : t().wegDank;
      if (ziel === 'ja') laden();
      zeichne();
      /* Die Bestätigung steht kurz, dann wieder die Lage — sonst weiß beim
         nächsten Blick niemand mehr, was gerade gilt. */
      setTimeout(function () { meldung = null; zeichne(); }, 6000);
    });
    kasten.appendChild(b);
  }

  function start() {
    zeichne();
    /* Der Sprachwechsel schreibt nur <html lang>; wir hängen uns daran,
       statt in jeder Seite einen eigenen Haken zu brauchen. */
    try {
      new MutationObserver(function () { zeichne(); })
        .observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
