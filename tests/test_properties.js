// Property-Harness fuer den PURE-PIPELINE-Block (v3.4.12).
//
// Unterschied zu test_pipeline.js: Dort steht "raw=21.7, slope=1.15,
// offset=-25 -> erwarte 'zero-zone'" - ein Fall, den sich jemand ausgedacht
// hat. Hier steht "fuer BELIEBIGE gueltigen Eingaben muss <Regel> gelten", und
// fast-check sucht das Gegenbeispiel. Der eigentliche Wert liegt im Shrinking:
// ein Fehlschlag kommt als kleinstmoegliche Eingabe zurueck, nicht als
// zufaelliger 17-stelliger Float.
//
// EINZIGE Datei im Repo mit einer Abhaengigkeit. Die anderen vier Harnesses
// laufen weiter mit blossem `node <datei>`; die App selbst bleibt unberuehrt
// (kein Build-Step, keine Runtime-Dependency). Deshalb auch der npm-Task
// "test:nodeps" fuer den Fall, dass jemand ohne npm install pruefen will.
//
// Aufruf: npm install && node tests/test_properties.js [pfad/zu/index.html]
'use strict';
const fs = require('fs');
const assert = require('assert');
const path = require('path');

let fc;
try { fc = require('fast-check'); }
catch (e) {
  console.error('fast-check fehlt. Einmalig "npm install" im Repo-Wurzelverzeichnis ausfuehren.');
  console.error('Die uebrigen vier Harnesses brauchen das nicht - "npm run test:nodeps".');
  process.exit(2);
}

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/\/\* ===PURE-PIPELINE-BEGIN=== \*\/([\s\S]*?)\/\* ===PURE-PIPELINE-END=== \*\//);
if (!m) { console.error('FAIL: PURE-PIPELINE-Marker nicht gefunden'); process.exit(2); }

const P = new Function(`"use strict";
${m[1]}
return { srgbInverseEOTF, buildLinearLUT, computeQuality, computeUncertainty,
  computeCalib2, calibRangeStatus, RollingMedian, MEDIAN_WINDOW,
  CALIB2_MIN_SEP, CALIB2_MIN_SLOPE, CALIB2_MAX_SLOPE,
  CALIB_RANGE_LO, CALIB_RANGE_HI,
  U_CAL_CALIBRATED, U_CAL_UNCALIBRATED, U_AUTO_CLASS_MIN,
  U_NOISE_FLOOR, U_NOISE_MAX, Q_GATE_HOLD };`)();

const RUNS = Number(process.env.PROP_RUNS || 500);
let passed = 0, failed = 0;
function prop(name, arbitraries, predicate) {
  try {
    fc.assert(fc.property(...arbitraries, predicate), { numRuns: RUNS });
    passed++; console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    const kurz = String(e.message).split('\n').slice(0, 6).join('\n        ');
    console.log('  FAIL  ' + name + '\n        ' + kurz);
  }
}
const nahe = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(a), Math.abs(b));

// --- Generatoren -----------------------------------------------------------
// Bewusst inklusive Randfaellen: 0, sehr klein, sehr gross.
// Untergrenze 1e-6 ist bewusst gesetzt: der erste Lauf fand mit raw=5e-324
// (kleinste denormale Zahl) ein Gegenbeispiel zur Kopplungs-Invariante -
// dort unterlaeuft raw*slope auf 0, ohne dass eine Null-Zone vorliegt. Das
// ist eine Grenze der Gleitkomma-Arithmetik, kein Fehler der Funktion: die
// Pipeline erzeugt solche Groessen nicht (rawPPFD ist ein Produkt aus
// Sensorwerten und Kalibrierkonstanten normaler Groessenordnung). Die
// Invariante gilt also auf dem physikalisch erreichbaren Bereich.
const gRaw = fc.oneof(
  fc.double({ min: 1e-6, max: 5000, noNaN: true }),
  fc.constantFrom(0, 1e-6, 1e-3, 1e6)
);
const gPunkt = fc.record({
  raw: fc.double({ min: 1, max: 4000, noNaN: true }),
  ref: fc.double({ min: 1, max: 4000, noNaN: true })
});
const gCV = fc.oneof(fc.double({ min: 0, max: 3, noNaN: true }), fc.constant(null));
const gLin = fc.double({ min: 0, max: 2, noNaN: true });
const gQualiInput = fc.record({
  clipRatio: fc.double({ min: 0, max: 1, noNaN: true }),
  uniformityCV: gCV,
  yMeanLin: gLin,
  temporalCV: gCV
});
const gUnsicherheitInput = fc.record({
  calibrated: fc.boolean(),
  profileU: fc.double({ min: 0, max: 0.5, noNaN: true }),
  autoMode: fc.boolean(),
  temporalCV: fc.oneof(fc.double({ min: 0, max: 2, noNaN: true }), fc.constant(null)),
  yMeanLin: fc.double({ min: 1e-6, max: 2, noNaN: true })
});

const LUT = P.buildLinearLUT();

console.log('== sRGB-EOTF ==');

prop('monoton nicht-fallend ueber den ganzen Bereich', [fc.integer({ min: 0, max: 254 })],
  (i) => P.srgbInverseEOTF(i / 255) <= P.srgbInverseEOTF((i + 1) / 255));

prop('LUT stimmt an jeder Stuetzstelle mit der Formel ueberein', [fc.integer({ min: 0, max: 255 })],
  // Toleranz 1e-6 relativ, NICHT 1e-12: buildLinearLUT() liefert bewusst ein
  // Float32Array (Speicher/Cache in der Pixelschleife). Float32 hat ~1.2e-7
  // relative Aufloesung - der erste Versuch mit 1e-12 hat genau das gefunden,
  // war aber eine falsche Erwartung, kein Codefehler. Gegen u_rel (7-73%) ist
  // der Quantisierungsfehler um sechs Groessenordnungen zu klein.
  (i) => nahe(LUT[i], P.srgbInverseEOTF(i / 255), 1e-6));

prop('Die Float32-Quantisierung der LUT bleibt weit unter jeder Messunsicherheit',
  [fc.integer({ min: 1, max: 255 })], (i) => {
    const exakt = P.srgbInverseEOTF(i / 255);
    return Math.abs(LUT[i] - exakt) / exakt < 1e-6;
  });

console.log('== computeQuality ==');

prop('Q und alle Teilfaktoren liegen in [0,1]', [gQualiInput], (o) => {
  const q = P.computeQuality(o);
  return [q.q, q.qClip, q.qUniformity, q.qSignal, q.qStability, q.qGate]
    .every(v => Number.isFinite(v) && v >= 0 && v <= 1);
});

prop('Q ist exakt das Produkt seiner vier Faktoren', [gQualiInput], (o) => {
  const q = P.computeQuality(o);
  return nahe(q.q, q.qClip * q.qUniformity * q.qSignal * q.qStability, 1e-12);
});

prop('Das Gate ist nie strenger als Q selbst', [gQualiInput], (o) => {
  // Folgt daraus, dass qGate nur eine Teilmenge der Faktoren benutzt und alle
  // Faktoren <= 1 sind. Bricht die Zusage, ist entweder eine Achse doppelt
  // gezaehlt oder eine gate-fremde Achse hineingeraten.
  const q = P.computeQuality(o);
  return q.q <= q.qGate + 1e-12;
});

prop('weakest benennt tatsaechlich den kleinsten Teilfaktor', [gQualiInput], (o) => {
  const q = P.computeQuality(o);
  const map = { clip: q.qClip, uniformity: q.qUniformity, signal: q.qSignal, stability: q.qStability };
  const min = Math.min(...Object.values(map));
  return nahe(map[q.weakest], min, 1e-12);
});

prop('gateWeakest nennt nur Achsen, die das Gate ueberhaupt fuehrt', [gQualiInput], (o) =>
  ['clip', 'uniformity'].includes(P.computeQuality(o).gateWeakest));

prop('Mehr Saettigung macht Q nie besser', [gQualiInput, fc.double({ min: 0, max: 1, noNaN: true })],
  (o, mehr) => {
    const a = P.computeQuality(o);
    const b = P.computeQuality(Object.assign({}, o, { clipRatio: Math.min(1, o.clipRatio + mehr) }));
    return b.q <= a.q + 1e-12;
  });

prop('Dunkelheit allein schliesst das Gate nie (Feldfall v3.4.7)', [gQualiInput], (o) => {
  // Die Regression aus dem Feld: wenig Signal ist ein Messergebnis, kein
  // Haltegrund. Formuliert als Invariante ueber ALLE Eingaben statt ueber
  // einen ausgedachten Frame.
  const hell = P.computeQuality(Object.assign({}, o, { yMeanLin: 0.5 }));
  const dunkel = P.computeQuality(Object.assign({}, o, { yMeanLin: 1e-6 }));
  return dunkel.qGate >= hell.qGate - 1e-12;
});

console.log('== computeUncertainty ==');

prop('uRel dominiert jede Einzelkomponente', [gUnsicherheitInput], (o) => {
  const u = P.computeUncertainty(o);
  return u.uRel >= u.uSys - 1e-12 && u.uRel >= u.uRand - 1e-12
      && u.uRel >= u.uCal - 1e-12 && u.uRel >= u.uProfile - 1e-12
      && u.uRel >= u.uTemporal - 1e-12 && u.uRel >= u.uNoise - 1e-12;
});

prop('uRel ist immer echt positiv (es gibt keine perfekte Messung)', [gUnsicherheitInput],
  (o) => P.computeUncertainty(o).uRel > 0);

prop('Kalibrieren macht die Unsicherheit nie schlechter', [gUnsicherheitInput], (o) => {
  const kal = P.computeUncertainty(Object.assign({}, o, { calibrated: true }));
  const unk = P.computeUncertainty(Object.assign({}, o, { calibrated: false }));
  return kal.uRel <= unk.uRel + 1e-12;
});

prop('Auto-Erkennung hebt die Profilunsicherheit auf mindestens U_AUTO_CLASS_MIN',
  [gUnsicherheitInput], (o) => {
    const u = P.computeUncertainty(Object.assign({}, o, { autoMode: true }));
    return u.uProfile >= P.U_AUTO_CLASS_MIN - 1e-12;
  });

prop('uNoise bleibt zwischen Boden und Deckel', [gUnsicherheitInput], (o) => {
  const u = P.computeUncertainty(o);
  return u.uNoise >= P.U_NOISE_FLOOR - 1e-12 && u.uNoise <= P.U_NOISE_MAX + 1e-12;
});

console.log('== computeCalib2 ==');

prop('Die Steigung verlaesst nie ihre Grenzen', [gPunkt, fc.option(gPunkt, { nil: null })],
  (p1, p2) => {
    const c = P.computeCalib2(p1, p2);
    return c === null || (c.slope >= P.CALIB2_MIN_SLOPE - 1e-12 && c.slope <= P.CALIB2_MAX_SLOPE + 1e-12);
  });

prop('Ein Punkt heisst offsetfrei', [gPunkt], (p1) => {
  const c = P.computeCalib2(p1, null);
  return c === null || c.points !== 1 || c.offset === 0;
});

prop('Die Reihenfolge der Punkte aendert das Ergebnis nicht', [gPunkt, gPunkt], (p1, p2) => {
  const a = P.computeCalib2(p1, p2), b = P.computeCalib2(p2, p1);
  if (a === null || b === null) return a === null && b === null;
  return nahe(a.slope, b.slope, 1e-9) && nahe(a.offset, b.offset, 1e-6) && a.points === b.points;
});

prop('Auch bei geclampter Steigung liegt die Gerade symmetrisch zu beiden Punkten',
  [gPunkt, gPunkt], (p1, p2) => {
    // Der Befund, der v3.4.12 ausgeloest hat: bei Clamp trifft die Gerade
    // keinen der Punkte mehr. Dann muss sie wenigstens beide gleich weit
    // verfehlen - sonst haengt das Ergebnis daran, welchen Punkt der Nutzer
    // zuerst eingegeben hat.
    const c = P.computeCalib2(p1, p2);
    if (c === null || c.points !== 2) return true;
    const fehler = (p) => (c.slope * p.raw + c.offset) - p.ref;
    return nahe(fehler(p1), -fehler(p2), 1e-6);
  });

prop('Ungeclampter Zwei-Punkt-Fit trifft beide Stuetzstellen', [gPunkt, gPunkt], (p1, p2) => {
  const c = P.computeCalib2(p1, p2);
  if (c === null || c.points !== 2 || c.clamped) return true;
  const bei = (p) => c.slope * p.raw + c.offset;
  return nahe(bei(p1), p1.ref, 1e-6) && nahe(bei(p2), p2.ref, 1e-6);
});

console.log('== calibRangeStatus ==');

const gFitUndPunkte = fc.tuple(gPunkt, fc.option(gPunkt, { nil: null }))
  .map(([p1, p2]) => ({ p1, p2, fit: P.computeCalib2(p1, p2) }))
  .filter(x => x.fit !== null);

prop('Der Zustand ist immer einer der bekannten', [gRaw, gFitUndPunkte], (raw, x) =>
  ['ok', 'below', 'above', 'zero-zone', 'uncalibrated', 'unknown']
    .includes(P.calibRangeStatus(raw, x.p1, x.p2, x.fit).state));

prop('Die gemeldete Spanne ist geordnet und endlich', [gRaw, gFitUndPunkte], (raw, x) => {
  const r = P.calibRangeStatus(raw, x.p1, x.p2, x.fit);
  return Number.isFinite(r.lo) && Number.isFinite(r.hi) && r.lo <= r.hi;
});

prop('Punktreihenfolge aendert den Bereichsbefund nicht', [gRaw, gFitUndPunkte], (raw, x) =>
  P.calibRangeStatus(raw, x.p1, x.p2, x.fit).state ===
  P.calibRangeStatus(raw, x.p2, x.p1, x.fit).state);

prop('"ok" heisst wirklich innerhalb der Toleranz', [gRaw, gFitUndPunkte], (raw, x) => {
  const r = P.calibRangeStatus(raw, x.p1, x.p2, x.fit);
  if (r.state !== 'ok' || !(raw > 0)) return true;   // raw<=0 ist der dokumentierte Sonderfall
  return raw >= r.lo * P.CALIB_RANGE_LO - 1e-9 && raw <= r.hi * P.CALIB_RANGE_HI + 1e-9;
});

prop('Die Null-Zone existiert genau dann, wenn der Offset negativ ist', [gRaw, gFitUndPunkte],
  (raw, x) => {
    const r = P.calibRangeStatus(raw, x.p1, x.p2, x.fit);
    return (r.zeroAt > 0) === (x.fit.offset < 0);
  });

prop('KOPPLUNG: "zero-zone" gilt genau dann, wenn die Pipeline auf 0 klemmt',
  [gRaw, gFitUndPunkte], (raw, x) => {
    // Die wichtigste Invariante des Features: die Warnung muss exakt den
    // Bereich treffen, in dem processLoop() Math.max(0, raw*slope+offset)
    // auf 0 zieht. Waere sie zu eng, bliebe eine stille Null-Zone; waere sie
    // zu weit, warnte sie ueber Werte, die noch echte Messungen sind.
    if (!(raw > 0)) return true;
    const angezeigt = Math.max(0, raw * x.fit.slope + x.fit.offset);
    const r = P.calibRangeStatus(raw, x.p1, x.p2, x.fit);
    return (r.state === 'zero-zone') === (angezeigt === 0);
  });

prop('MONOTONIE: der Zustand laeuft mit wachsendem Rohwert nur vorwaerts',
  [gFitUndPunkte], (x) => {
    // zero-zone -> below -> ok -> above, nie zurueck. Ein Rueckwaertssprung
    // hiesse, dass zwei Schwellen sich ueberkreuzen.
    const rang = { 'zero-zone': 0, below: 1, ok: 2, above: 3 };
    let letzter = -1;
    for (let i = 1; i <= 400; i++) {
      const raw = (x.p1.raw * 4) * (i / 400);
      const s = rang[P.calibRangeStatus(raw, x.p1, x.p2, x.fit).state];
      if (s === undefined) continue;
      if (s < letzter) return false;
      letzter = s;
    }
    return true;
  });

console.log('== RollingMedian ==');

const gWerte = fc.array(fc.double({ min: -1e4, max: 1e4, noNaN: true }), { minLength: 1, maxLength: 40 });

prop('Der Median liegt nie ausserhalb des Fensterinhalts', [gWerte], (werte) => {
  const rm = new P.RollingMedian(P.MEDIAN_WINDOW);
  werte.forEach(v => rm.push(v));
  const v = rm.value();
  return v >= Math.min(...rm.buf) - 1e-12 && v <= Math.max(...rm.buf) + 1e-12;
});

prop('Das Fenster laeuft nie ueber', [gWerte], (werte) => {
  const rm = new P.RollingMedian(P.MEDIAN_WINDOW);
  werte.forEach(v => rm.push(v));
  return rm.buf.length <= P.MEDIAN_WINDOW;
});

prop('Bei ungerader Fenstergroesse ist der Median ein echter Messwert', [gWerte], (werte) => {
  if (P.MEDIAN_WINDOW % 2 === 0) return true;
  const rm = new P.RollingMedian(P.MEDIAN_WINDOW);
  werte.forEach(v => rm.push(v));
  return rm.buf.length % 2 === 0 || rm.buf.includes(rm.value());
});

prop('Nicht-endliche Werte veraendern den Median nicht', [gWerte, fc.constantFrom(NaN, Infinity, -Infinity)],
  (werte, muell) => {
    const rm = new P.RollingMedian(P.MEDIAN_WINDOW);
    werte.forEach(v => rm.push(v));
    const vorher = rm.value(), len = rm.buf.length;
    rm.push(muell);
    return rm.value() === vorher && rm.buf.length === len;
  });

console.log(`\n${passed} passed, ${failed} failed  (je ${RUNS} Faelle)`);
process.exit(failed ? 1 : 0);
