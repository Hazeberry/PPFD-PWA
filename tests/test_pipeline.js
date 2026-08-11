// Node-Regressions-Harness für die reine Messpipeline (v3.3.0, Stage 1).
// Extrahiert den PURE-PIPELINE-Block direkt aus index.html (Single Source of
// Truth) und testet ihn gegen synthetische Frames - kein Browser nötig.
// Aufruf: node test_pipeline.js [pfad/zu/index.html]
'use strict';
const fs = require('fs');
const assert = require('assert');

const htmlPath = process.argv[2] || require('path').join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = html.match(/\/\* ===PURE-PIPELINE-BEGIN=== \*\/([\s\S]*?)\/\* ===PURE-PIPELINE-END=== \*\//);
if (!m) { console.error('FAIL: PURE-PIPELINE-Marker nicht gefunden'); process.exit(2); }

const P = new Function(`"use strict";
${m[1]}
return { srgbInverseEOTF, buildLinearLUT, Y_R, Y_G, Y_B, LIGHT_PROFILES,
  SIGNAL_CRIT_LIN, SIGNAL_LOW_LIN, classifySignal, analyzeFrame,
  AdaptivePPFDKalmanFilter, LightSourceDetector, SpatialFlickerDetector,
  ClippingDetector, TemperatureCompensator, AppStatusStateMachine,
  calculatePARFromLinear, ramp01, TemporalStats, computeQuality,
  Q_CLIP_FULL, Q_CLIP_ZERO, Q_UNI_FULL, Q_UNI_ZERO,
  Q_STAB_FULL, Q_STAB_ZERO, SIGNAL_FULL_LIN, computeUncertainty,
  U_CAL_CALIBRATED, U_CAL_UNCALIBRATED, U_AUTO_CLASS_MIN,
  U_NOISE_FLOOR, U_NOISE_K, U_NOISE_MAX, computeCalib2, CALIB2_MIN_SEP, CALIB2_MIN_SLOPE, CALIB2_MAX_SLOPE,
  RollingMedian, MEDIAN_WINDOW, Q_GATE_HOLD, calibRangeStatus, CALIB_RANGE_LO, CALIB_RANGE_HI, Q_UNI_GATE_MIN_LIN, SIGNAL_CRIT_LIN, TemperatureCompensator };`)();

const W = 320, H = 240;
const LUT = P.buildLinearLUT();
let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('  PASS  ' + name); }
  catch (e) { failed++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
}
// Synthetischer Frame: fn(x,y) -> [r,g,b]
function makeFrame(fn, w = W, h = H) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const [r, g, b] = fn(p % w, (p / w) | 0);
    d[p * 4] = r; d[p * 4 + 1] = g; d[p * 4 + 2] = b; d[p * 4 + 3] = 255;
  }
  return d;
}
const uniform = v => makeFrame(() => [v, v, v]);
const approx = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} |${a} - ${b}| > ${tol}`);

console.log('== A: exakte sRGB-EOTF ==');
t('EOTF Endpunkte: f(0)=0, f(1)=1', () => {
  assert.strictEqual(P.srgbInverseEOTF(0), 0);
  approx(P.srgbInverseEOTF(1), 1, 1e-12);
});
t('EOTF linearer Ast: f(10/255)=c/12.92', () => {
  approx(P.srgbInverseEOTF(10 / 255), (10 / 255) / 12.92, 1e-12);
});
t('EOTF stetig am Knick 0.04045', () => {
  const a = P.srgbInverseEOTF(0.04045), b = P.srgbInverseEOTF(0.0404501);
  approx(a, b, 1e-4, 'Knick-Stetigkeit');
});
t('EOTF monoton über gesamte LUT', () => {
  for (let i = 1; i < 256; i++) assert.ok(LUT[i] >= LUT[i - 1], `LUT[${i}] < LUT[${i - 1}]`);
});
t('EOTF weicht von γ2.2 wie erwartet ab (Dokumentation der Skalierung)', () => {
  const exact = P.srgbInverseEOTF(50 / 255);
  const gamma22 = Math.pow(50 / 255, 2.2);
  const shift = (exact - gamma22) / gamma22;
  console.log(`        [info] Skalen-Shift bei 50/255: ${(shift * 100).toFixed(1)}% (gamma2.2=${gamma22.toFixed(5)} -> exact=${exact.toFixed(5)})`);
  assert.ok(shift > 0.05 && shift < 0.30, 'Shift außerhalb Erwartungsbereich');
});

console.log('== analyzeFrame: Stichprobe & Arithmetik ==');
t('Uniform 128: yMean_lin == LUT[128], gamma == 128, kein Clipping', () => {
  const f = P.analyzeFrame(uniform(128), W, H, 4, LUT);
  approx(f.yMean_lin, LUT[128], 1e-6, 'yMean_lin');
  approx(f.yMean_gamma, 128, 1e-6, 'yMean_gamma');
  assert.strictEqual(f.clippingPixels, 0);
  assert.ok(f.sampledPixels > 0);
});
t('Uniform 0 und 255: Endpunkte exakt', () => {
  approx(P.analyzeFrame(uniform(0), W, H, 4, LUT).yMean_lin, 0, 1e-9);
  const f = P.analyzeFrame(uniform(255), W, H, 4, LUT);
  approx(f.yMean_lin, 1, 1e-6);
  assert.strictEqual(f.clippingPixels, f.sampledPixels);
});
t('pixelStep 8: gleiche Mittelwerte, rowAverages konstant gefüllt', () => {
  const d = uniform(100);
  const f4 = P.analyzeFrame(d, W, H, 4, LUT), f8 = P.analyzeFrame(d, W, H, 8, LUT);
  approx(f8.yMean_lin, f4.yMean_lin, 1e-6);
  for (let r = 0; r < H; r++) approx(f8.rowAverages[r], f8.yMean_lin, 1e-9);
});
t('Farb-Frame: BT.709-Gewichtung der linearen Kanäle', () => {
  const d = makeFrame(() => [200, 100, 50]);
  const f = P.analyzeFrame(d, W, H, 4, LUT);
  approx(f.yMean_lin, P.Y_R * LUT[200] + P.Y_G * LUT[100] + P.Y_B * LUT[50], 1e-6);
});
t('Gradient (vertikal): rowAverages monoton steigend', () => {
  const d = makeFrame((x, y) => [y, y, y]); // 0 oben -> 239 unten
  const f = P.analyzeFrame(d, W, H, 4, LUT);
  for (let r = 1; r < H; r++) assert.ok(f.rowAverages[r] >= f.rowAverages[r - 1], `Zeile ${r}`);
});

console.log('== B: Unterbelichtungs-Klassifikation ==');
t('classifySignal: kritisch / schwach / ok + Grenzen', () => {
  assert.strictEqual(P.classifySignal(0.0005).level, 'critical');
  assert.strictEqual(P.classifySignal(P.SIGNAL_CRIT_LIN).level, 'low'); // Grenze: nicht mehr critical
  assert.strictEqual(P.classifySignal(0.01).level, 'low');
  assert.strictEqual(P.classifySignal(P.SIGNAL_LOW_LIN).level, 'ok'); // Grenze: ok
  assert.strictEqual(P.classifySignal(0.5).level, 'ok');
});
t('Dunkler Frame (v=5) -> critical; v=30 -> low; v=128 -> ok', () => {
  assert.strictEqual(P.classifySignal(P.analyzeFrame(uniform(5), W, H, 4, LUT).yMean_lin).level, 'critical');
  assert.strictEqual(P.classifySignal(P.analyzeFrame(uniform(30), W, H, 4, LUT).yMean_lin).level, 'low');
  assert.strictEqual(P.classifySignal(P.analyzeFrame(uniform(128), W, H, 4, LUT).yMean_lin).level, 'ok');
});

console.log('== Flicker (Regression Review #2) ==');
const flick = new P.SpatialFlickerDetector(0.95);
t('Statischer Gradient: KEINE Flicker-Meldung trotz Modulation', () => {
  const d = makeFrame((x, y) => [Math.min(255, 30 + y), Math.min(255, 30 + y), Math.min(255, 30 + y)]);
  const f = P.analyzeFrame(d, W, H, 4, LUT);
  const res = flick.detect(Array.from(f.rowAverages), 30);
  assert.ok(!res.isFlickering, `Gradient fälschlich als Flicker: ${res.modulation}%`);
});
t('Periodische Bänder (Rolling Shutter): Flicker erkannt', () => {
  const d = makeFrame((x, y) => { const v = ((y / 12) | 0) % 2 === 0 ? 40 : 220; return [v, v, v]; });
  const f = P.analyzeFrame(d, W, H, 4, LUT);
  const res = flick.detect(Array.from(f.rowAverages), 30);
  assert.ok(res.isFlickering, 'Bänder nicht erkannt');
  assert.ok(res.freq.includes('Hz'), 'Frequenzschätzung fehlt');
});

console.log('== Clipping-Schwellen ==');
t('50% gesättigt -> critical; 8% -> warning; 1% -> ok', () => {
  const cd = new P.ClippingDetector();
  const mk = frac => makeFrame((x, y) => { const sat = ((x + y * W) % W) < frac * W; return sat ? [255, 255, 255] : [100, 100, 100]; });
  assert.strictEqual(cd.analyze(P.analyzeFrame(mk(0.5), W, H, 4, LUT).clippingPixels, P.analyzeFrame(mk(0.5), W, H, 4, LUT).sampledPixels).level, 'critical');
  const f8 = P.analyzeFrame(mk(0.08), W, H, 4, LUT);
  assert.strictEqual(cd.analyze(f8.clippingPixels, f8.sampledPixels).level, 'warning');
  const f1 = P.analyzeFrame(mk(0.01), W, H, 4, LUT);
  assert.strictEqual(cd.analyze(f1.clippingPixels, f1.sampledPixels).level, 'ok');
});

console.log('== FSM (Regression Review #4) ==');
t('LOW_PERF -> CLIPPING bei beginnender Übersteuerung', () => {
  const fsm = new P.AppStatusStateMachine();
  fsm.update(true, false, false, 30); // WARMUP -> STABLE
  let s;
  for (let i = 0; i < 50; i++) s = fsm.update(true, false, false, 10); // fps<18 -> LOW_PERF
  assert.strictEqual(s.id, 'LOW_PERF');
  for (let i = 0; i < 6; i++) s = fsm.update(true, false, true, 10);  // Clipping beginnt
  assert.strictEqual(s.id, 'CLIPPING', 'Clipping verliert gegen LOW_PERF');
});

console.log('== Kalibrier-Geltungsbereich (v3.4.10) ==');

const P1 = { raw: 100, ref: 90 }, P2 = { raw: 900, ref: 1010 };
const FIT2 = P.computeCalib2(P1, P2);          // x1.15 -25.0, Null-Zone bei 21.7
const FIT1 = P.computeCalib2({ raw: 400, ref: 500 }, null); // reine Steigung, offsetfrei

t('Innerhalb der Stuetzstellen: ok', () => {
  for (const raw of [100, 300, 500, 900]) {
    assert.strictEqual(P.calibRangeStatus(raw, P1, P2, FIT2).state, 'ok', 'raw=' + raw);
  }
});

t('REGRESSION: die Null-Zone wird als eigener Zustand gemeldet', () => {
  // Punkt 1 der bekannten Grenzen: unterhalb |offset|/slope klemmt der
  // Aufrufer auf 0 - das ist keine Messung mehr, sondern ein Artefakt.
  const zeroAt = -FIT2.offset / FIT2.slope;
  assert.ok(Math.abs(zeroAt - 21.74) < 0.1, 'Testaufbau: Null-Zone bei ' + zeroAt.toFixed(2));
  for (const raw of [1, 10, 21]) {
    const r = P.calibRangeStatus(raw, P1, P2, FIT2);
    assert.strictEqual(r.state, 'zero-zone', 'raw=' + raw);
    assert.ok(Math.abs(r.zeroAt - zeroAt) < 1e-9, 'zeroAt muss mitgeliefert werden');
  }
  // Knapp darueber ist es wieder "nur" Extrapolation.
  assert.strictEqual(P.calibRangeStatus(23, P1, P2, FIT2).state, 'below');
});

t('Unter- und Ueberschreitung an den dokumentierten Faktoren', () => {
  const lo = P1.raw, hi = P2.raw;
  assert.strictEqual(P.calibRangeStatus(lo * P.CALIB_RANGE_LO - 1, P1, P2, FIT2).state, 'below');
  assert.strictEqual(P.calibRangeStatus(lo * P.CALIB_RANGE_LO + 1, P1, P2, FIT2).state, 'ok');
  assert.strictEqual(P.calibRangeStatus(hi * P.CALIB_RANGE_HI + 1, P1, P2, FIT2).state, 'above');
  assert.strictEqual(P.calibRangeStatus(hi * P.CALIB_RANGE_HI - 1, P1, P2, FIT2).state, 'ok');
});

t('Ein-Punkt-Kalibrierung hat keine Null-Zone', () => {
  const r = P.calibRangeStatus(1, { raw: 400, ref: 500 }, null, FIT1);
  assert.strictEqual(r.zeroAt, 0, 'offsetfreier Fit darf keine Null-Zone melden');
  assert.strictEqual(r.state, 'below', 'weit unterhalb der Stuetzstelle -> extrapoliert');
});

t('Ein-Punkt-Fit spannt um seine eine Stuetzstelle', () => {
  const p = { raw: 400, ref: 500 };
  assert.strictEqual(P.calibRangeStatus(400, p, null, FIT1).state, 'ok');
  assert.strictEqual(P.calibRangeStatus(250, p, null, FIT1).state, 'ok');
  assert.strictEqual(P.calibRangeStatus(150, p, null, FIT1).state, 'below');
  assert.strictEqual(P.calibRangeStatus(900, p, null, FIT1).state, 'above');
});

t('Reihenfolge der Punkte ist egal', () => {
  for (const raw of [10, 50, 300, 2000]) {
    assert.strictEqual(P.calibRangeStatus(raw, P1, P2, FIT2).state,
      P.calibRangeStatus(raw, P2, P1, FIT2).state, 'raw=' + raw);
  }
});

t('Ohne Kalibrierung und ohne Stuetzstellen wird nichts behauptet', () => {
  assert.strictEqual(P.calibRangeStatus(500, P1, P2, null).state, 'uncalibrated');
  // Legacy-Faktor: Fit vorhanden, Punkte nicht -> Bereich unbekannt.
  assert.strictEqual(P.calibRangeStatus(500, null, null, FIT1).state, 'unknown');
  assert.strictEqual(P.calibRangeStatus(500, { raw: 0 }, null, FIT1).state, 'unknown');
});

t('Unbrauchbare Rohwerte kippen die Auskunft nicht', () => {
  for (const raw of [0, -5, NaN, Infinity]) {
    const r = P.calibRangeStatus(raw, P1, P2, FIT2);
    assert.strictEqual(r.state, 'ok', 'raw=' + raw + ' -> ' + r.state);
    assert.ok(Number.isFinite(r.lo) && Number.isFinite(r.hi), 'Spanne muss trotzdem stimmen');
  }
});

t('Die gemeldete Spanne ist die tatsaechliche der Stuetzstellen', () => {
  const r = P.calibRangeStatus(500, P1, P2, FIT2);
  assert.strictEqual(r.lo, 100);
  assert.strictEqual(r.hi, 900);
});

console.log('== Lichtprofile: Blurple-Neuzuschnitt (v3.4.8) ==');

const erkannt = (r, g, b) => {
  const d = new P.LightSourceDetector();
  let res; for (let i = 0; i < 6; i++) res = d.detect(r * 255, g * 255, b * 255);
  return res;
};
const skala = (r, g, b, id) => P.calculatePARFromLinear(r, g, b, id) * P.LIGHT_PROFILES[id].factor;

t('REGRESSION: Warmweiss wird nicht mehr als Blurple klassifiziert', () => {
  // 2700K ohne jeden Rot-Boost landete auf LED_GROW (conf 59%) und wurde
  // dadurch ~14% zu niedrig gemessen - Faktor 0.0155 statt 0.0185.
  const res = erkannt(0.45, 0.34, 0.24);
  assert.notStrictEqual(res.id, 'LED_GROW', 'Warmweiss wieder auf dem Blurple-Profil');
  assert.strictEqual(res.factor, 0.0185, 'Faktor muss der Weisslicht-Faktor sein');
});

t('LED_GROW ist aus dem Kandidatenpool der Auto-Erkennung raus', () => {
  const kandidaten = Object.keys(new P.LightSourceDetector().profiles);
  assert.ok(!kandidaten.includes('LED_GROW'), 'noch im Pool: ' + kandidaten.join(', '));
  assert.strictEqual(P.LIGHT_PROFILES.LED_GROW.detect, false);
});

t('Kein Weisslicht-Spektrum faellt mehr auf ein Nicht-Weisslicht-Profil', () => {
  const weisstoene = [[0.42, 0.36, 0.26], [0.36, 0.38, 0.30], [0.45, 0.34, 0.24], [0.33, 0.34, 0.33]];
  for (const [r, g, b] of weisstoene) {
    const res = erkannt(r, g, b);
    assert.strictEqual(res.factor, 0.0185,
      `(${r}/${g}/${b}) -> ${res.id} mit Faktor ${res.factor}`);
  }
});

t('HPS bleibt zuverlaessig erkennbar (das Profil verdient seinen Platz)', () => {
  const res = erkannt(0.70, 0.45, 0.06);
  assert.strictEqual(res.id, 'SODIUM_HPS');
  assert.ok(res.conf > 0.5, 'Konfidenz zu niedrig: ' + res.conf.toFixed(2));
});

t('Der Schluessel LED_GROW bleibt erhalten (Kalibrierungen haengen daran)', () => {
  // calibStorageKey() bindet an den String. Ein Umbenennen des Keys wuerde
  // gespeicherte Kalibrierungen verwaisen lassen.
  assert.ok('LED_GROW' in P.LIGHT_PROFILES, 'Schluessel entfernt - Kalibrierungen verwaisen');
  assert.ok(/Blurple/i.test(P.LIGHT_PROFILES.LED_GROW.name), 'Name benennt das Spektrum nicht');
});

t('Manuelle Wahl von LED_GROW benutzt weiterhin die Blurple-Gewichte', () => {
  assert.strictEqual(P.calculatePARFromLinear(1, 0, 0, 'LED_GROW'), 0.50, 'r-Gewicht verloren');
  assert.strictEqual(P.calculatePARFromLinear(0, 1, 0, 'LED_GROW'), 0.15);
  assert.strictEqual(P.calculatePARFromLinear(0, 0, 1, 'LED_GROW'), 0.35);
});

t('Blurple-Profil wirkt selbst unter Blurple nur marginal (dokumentierte Begruendung)', () => {
  const b = [0.60, 0.12, 0.45];
  const rel = skala(...b, 'LED_GROW') / skala(...b, 'WHITE_LED');
  assert.ok(Math.abs(rel - 1) < 0.05,
    'Abweichung ' + ((rel - 1) * 100).toFixed(1) + ' % - die note im Profil nennt ~3 %');
});

console.log('== Q-Gate: nur Frame-Repraesentativitaet (v3.4.7) ==');

const qq = (o) => P.computeQuality(Object.assign(
  { clipRatio: 0, uniformityCV: 0.05, yMeanLin: 0.2, temporalCV: 0.01 }, o));

t('REGRESSION Feldfall: dunkle Szene haelt die Anzeige NICHT mehr an', () => {
  // Screenshot v3.4.6: Licht ging aus, Anzeige blieb auf 1.7 stehen mit
  // "gehalten: Signal". Wenig Signal heisst wenig Licht - das ist der
  // Messwert, kein Grund ihn einzufrieren.
  const dunkel = qq({ yMeanLin: 0.001, uniformityCV: null, temporalCV: null });
  assert.strictEqual(dunkel.q, 0, 'Q soll weiterhin 0 melden (Guete ist wirklich schlecht)');
  assert.ok(dunkel.qGate >= P.Q_GATE_HOLD,
    'Gate muss offen bleiben, qGate=' + dunkel.qGate.toFixed(3));
});

t('REGRESSION: echter Lichtwechsel (hoher temporalCV) haelt nicht an', () => {
  // Beim Uebergang hell->dunkel spitzt temporalCV zu. Genau die Aenderung
  // will man messen - halten unterdrueckt sie.
  const wechsel = qq({ temporalCV: 0.8, yMeanLin: 0.02 });
  assert.ok(wechsel.q < 0.1, 'Q faellt zu Recht');
  assert.ok(wechsel.qGate >= P.Q_GATE_HOLD, 'Gate muss offen bleiben, qGate=' + wechsel.qGate.toFixed(3));
});

t('Unrepraesentative Frames werden weiterhin gehalten', () => {
  const schraeg = qq({ uniformityCV: 0.30 });
  assert.ok(schraeg.qGate < P.Q_GATE_HOLD, 'CV 30% muss halten, qGate=' + schraeg.qGate.toFixed(3));
  assert.strictEqual(schraeg.gateWeakest, 'uniformity');

  const uebersteuert = qq({ clipRatio: 0.12 });
  assert.ok(uebersteuert.qGate < P.Q_GATE_HOLD, 'starkes Clipping muss halten');
  assert.strictEqual(uebersteuert.gateWeakest, 'clip');
});

t('REGRESSION v3.4.8: Restband knapp ueber SIGNAL_CRIT_LIN haelt nicht an', () => {
  // Der v3.4.7-Test oben setzt uniformityCV von Hand auf null und trifft damit
  // nur das Regime UNTERHALB SIGNAL_CRIT_LIN (0.003), wo analyzeFrame() cv
  // ohnehin auf null setzt. Knapp darueber liefert analyzeFrame() eine grosse
  // endliche Zahl: cv = std/zMean, bei zMean=0.0035 und einem Zonen-std von
  // 0.0015 (Vignettierung + Schwarzwert-Rest, mitteln sich nicht weg) sind das
  // 0.43 -> qUniformity = 0 -> Gate zu. Exakt der Feldfall aus v3.4.7, nur
  // ueber die Uniformitaets- statt der Signal-Achse.
  const zMean = 0.0035, zoneStd = 0.0015;
  assert.ok(zMean > P.SIGNAL_CRIT_LIN, 'Testaufbau: cv ist hier NICHT null');
  const cv = zoneStd / zMean;
  assert.ok(cv > P.Q_UNI_ZERO, 'Testaufbau: cv muss qUniformity auf 0 druecken, cv=' + cv.toFixed(3));

  const band = qq({ yMeanLin: zMean, uniformityCV: cv, temporalCV: 0.3 });
  assert.strictEqual(band.qUniformity, 0, 'qUniformity soll in der ANZEIGE weiterhin 0 sein');
  assert.ok(band.qGate >= P.Q_GATE_HOLD,
    'Gate muss offen bleiben, qGate=' + band.qGate.toFixed(3));
  assert.strictEqual(band.gateWeakest, 'clip', 'gehaltene Achse darf nicht Ausleuchtung sein');
});

t('v3.4.8: die Uniformitaets-Achse gatet oberhalb der Schwelle weiterhin', () => {
  // Gegenprobe zum Test darueber - der Fix darf die Achse nicht generell
  // abschalten, sonst faellt der Schutz vor schraeg gehaltenen Frames weg.
  const hell = qq({ yMeanLin: P.Q_UNI_GATE_MIN_LIN, uniformityCV: 0.30 });
  assert.ok(hell.qGate < P.Q_GATE_HOLD, 'CV 30% bei ausreichendem Signal muss halten');
  assert.strictEqual(hell.gateWeakest, 'uniformity');

  // Direkt unterhalb der Schwelle kippt dasselbe Frame auf "offen".
  const knappDrunter = qq({ yMeanLin: P.Q_UNI_GATE_MIN_LIN * 0.99, uniformityCV: 0.30 });
  assert.ok(knappDrunter.qGate >= P.Q_GATE_HOLD, 'unterhalb der Schwelle darf cv nicht gaten');
});

t('qGate haengt nicht vom Signal als MESSWERT ab (nur cv-Eignung, fail-open)', () => {
  // v3.4.8 praezisiert den Vertrag von v3.4.7: der Signalpegel darf das Gate
  // niemals SCHLIESSEN - er darf die Uniformitaets-Achse nur deaktivieren,
  // wenn cv dort unbeurteilbar wird. Beide Richtungen werden geprueft.
  const basis = qq({}).qGate;
  assert.ok(Number.isFinite(basis), 'qGate existiert nicht (Wert: ' + basis + ')');
  for (const y of [0.0001, 0.001, 0.01, 0.5, 5]) {
    assert.strictEqual(qq({ yMeanLin: y }).qGate, basis,
      'yMeanLin=' + y + ' hat qGate veraendert (cv unauffaellig, darf nichts aendern)');
  }
  // Fail-open: bei auffaelligem cv darf weniger Signal das Gate nur OEFFNEN.
  let vorher = 1;
  for (const y of [0.5, 0.05, P.Q_UNI_GATE_MIN_LIN, 0.01, 0.004]) {
    const g = qq({ yMeanLin: y, uniformityCV: 0.30 }).qGate;
    assert.ok(g >= vorher || y >= P.Q_UNI_GATE_MIN_LIN,
      'weniger Signal hat das Gate weiter geschlossen (yMeanLin=' + y + ')');
    vorher = g;
  }
  for (const tcv of [0, 0.05, 0.3, 2.0, null]) {
    assert.strictEqual(qq({ temporalCV: tcv }).qGate, basis, 'temporalCV=' + tcv + ' hat qGate veraendert');
  }
});

t('Q selbst bleibt der unveraenderte 4-Faktor-Index', () => {
  const q = qq({ clipRatio: 0.02, uniformityCV: 0.09, yMeanLin: 0.03, temporalCV: 0.03 });
  assert.ok(Math.abs(q.q - q.qClip * q.qUniformity * q.qSignal * q.qStability) < 1e-12,
    'Q ist nicht mehr das Produkt aller vier');
  assert.ok(q.q < q.qGate, 'Q muss strenger sein als das Gate');
});

t('gateWeakest nennt nur Gate-Achsen und ist im Label-Vokabular', () => {
  for (const o of [{ clipRatio: 0.2 }, { uniformityCV: 0.5 }, { yMeanLin: 1e-5 }, { temporalCV: 3 }]) {
    const g = P.computeQuality(Object.assign({ clipRatio: 0, uniformityCV: 0.05, yMeanLin: 0.2, temporalCV: 0.01 }, o)).gateWeakest;
    assert.ok(g === 'clip' || g === 'uniformity', 'gateWeakest = ' + g);
  }
});

t('Ende zu Ende: nach Lichtausfall laeuft die Anzeige gegen 0', () => {
  // Median -> Kalman -> Gate, so wie im Render-Pfad verdrahtet.
  const k = new P.AdaptivePPFDKalmanFilter();
  const med = new P.RollingMedian(P.MEDIAN_WINDOW);
  let x = 0;
  for (let i = 0; i < 300; i++) x = k.update(med.push(400));   // eingeschwungen hell
  assert.ok(x > 380, 'Vorbedingung: haelt 400');
  // Licht aus: Rohwert faellt auf ~0, Guete kippt ueber das Signal
  const dunkel = qq({ yMeanLin: 0.0008, uniformityCV: null, temporalCV: null });
  let gehalten = 0;
  for (let i = 0; i < 300; i++) {
    const m = med.push(0.5);
    if (dunkel.qGate >= P.Q_GATE_HOLD) x = k.update(m); else gehalten++;
  }
  assert.strictEqual(gehalten, 0, 'Gate hat ' + gehalten + ' Frames blockiert');
  assert.ok(x < 5, 'Anzeige haengt bei ' + x.toFixed(1) + ' statt gegen 0 zu laufen');
});

console.log('== Unsicherheits-Boden & README-Konsistenz (v3.4.7) ==');

// Der kleinste Wert, den die App ueberhaupt anzeigen kann: kalibriert, bestes
// Profil, manuell gewaehlt, perfekt stabil, hell ausgeleuchtet.
function unsicherheitsBodenProzentK2() {
  const uProfileMin = Math.min(...Object.values(P.LIGHT_PROFILES).map(p => p.u));
  const u = P.computeUncertainty({
    calibrated: true, profileU: uProfileMin, autoMode: false,
    temporalCV: 0, yMeanLin: 1.0
  });
  return u.uRel * 200; // x100 fuer Prozent, x2 fuer k=2
}

t('Der Boden liegt bei ~14 %, nicht bei 10 %', () => {
  const boden = unsicherheitsBodenProzentK2();
  assert.ok(Math.abs(boden - 14.3) < 0.2, 'Boden = ' + boden.toFixed(2) + ' %, erwartet ~14,3 %');
  assert.ok(boden > 12, 'Ein Boden unter 12 % waere mit u_cal=u_profile=0.05 rechnerisch unmoeglich');
});

t('u_cal und u_profile sind gleich gross - Kalibrieren allein bringt nur Faktor sqrt(2)', () => {
  // Genau das macht den Boden aus: waere u_profile vernachlaessigbar, laege er
  // bei 2*0.05 = 10 % - die Zahl, die frueher im README stand.
  const uProfileMin = Math.min(...Object.values(P.LIGHT_PROFILES).map(p => p.u));
  assert.strictEqual(uProfileMin, P.U_CAL_CALIBRATED,
    'Annahme gebrochen: bestes u_profile (' + uProfileMin + ') != u_cal (' + P.U_CAL_CALIBRATED + ')');
  const nurCal = P.U_CAL_CALIBRATED * 200;
  assert.ok(unsicherheitsBodenProzentK2() > nurCal * 1.3,
    'Boden muss deutlich ueber der reinen u_cal-Verdopplung liegen');
});

t('Kein Messverhalten kann den Boden unterschreiten', () => {
  const uProfileMin = Math.min(...Object.values(P.LIGHT_PROFILES).map(p => p.u));
  const boden = unsicherheitsBodenProzentK2();
  // Beliebig gute Stabilitaet und beliebig helles Signal helfen nicht weiter.
  for (const yMean of [0.25, 0.5, 1.0, 10]) {
    for (const tcv of [0, 0.001, 0.005]) {
      const u = P.computeUncertainty({ calibrated: true, profileU: uProfileMin, autoMode: false, temporalCV: tcv, yMeanLin: yMean });
      assert.ok(u.uRel * 200 >= boden - 1e-9,
        `yMean=${yMean} tCV=${tcv} unterschreitet den Boden: ${(u.uRel * 200).toFixed(3)}`);
    }
  }
});

t('README nennt denselben Boden, den der Code rechnet', () => {
  // Die alte Angabe "±10 % kalibriert" stammte aus der uCal-KONSTANTE, nicht
  // aus dem Budget - unkalibriert faellt das nicht auf (uCal dominiert dort
  // alles), kalibriert schon. Dieser Test bindet die Doku an die Rechnung.
  const readme = fs.readFileSync(require('path').join(__dirname, '..', 'README.md'), 'utf8');
  const boden = Math.round(unsicherheitsBodenProzentK2());
  assert.ok(new RegExp('±' + boden + '\\s*%').test(readme),
    'README nennt den berechneten Boden ±' + boden + ' % nicht');
  assert.ok(!/±10\s*%\s*kalibriert/.test(readme), 'alte, zu optimistische Angabe wieder da');
});

console.log('== Kalman-Reset beim Moduswechsel (v3.4.6) ==');

t('reset() loescht den Schaetzzustand vollstaendig', () => {
  const k = new P.AdaptivePPFDKalmanFilter();
  for (let i = 0; i < 200; i++) k.update(600);
  assert.ok(k.x > 500 && k.lastMeasurement === 600, 'Vorbedingung: eingeschwungen');
  k.reset();
  assert.strictEqual(k.x, 0);
  assert.strictEqual(k.p, 1.0);
  assert.strictEqual(k.lastMeasurement, 0);
  assert.strictEqual(k.lastInnovation, 0);
});

t('reset() laesst q/r in Ruhe (Aufrufer setzt sie je Betriebsart)', () => {
  const k = new P.AdaptivePPFDKalmanFilter();
  k.r = 8.0; k.q = 0.05;              // wie in revertToAutoExposure()
  k.reset();
  assert.strictEqual(k.r, 8.0, 'r wurde ueberschrieben - Software-Gain-Tuning verloren');
  assert.strictEqual(k.q, 0.05, 'q wurde ueberschrieben');
});

t('REGRESSION: ohne reset() startet die Anzeige beim alten Wert', () => {
  // Der Fall aus revertToAutoExposure(): eingeschwungen auf 600, danach
  // liefert der Software-Gain-Pfad 200.
  const alt = new P.AdaptivePPFDKalmanFilter();
  for (let i = 0; i < 400; i++) alt.update(600);
  alt.r = 8.0;
  const ersterWertOhneReset = alt.update(200);
  assert.ok(ersterWertOhneReset > 500,
    'Erwartet: erster Wert klebt am alten Zustand, war ' + ersterWertOhneReset.toFixed(1));

  const neu = new P.AdaptivePPFDKalmanFilter();
  for (let i = 0; i < 400; i++) neu.update(600);
  neu.r = 8.0; neu.reset();
  const ersterWertMitReset = neu.update(200);
  assert.ok(ersterWertMitReset < ersterWertOhneReset,
    'reset() muss den Altwert loswerden');
  assert.ok(Math.abs(ersterWertMitReset - 200) < Math.abs(ersterWertOhneReset - 200),
    'mit reset() naeher am Ist-Wert');
});

t('Nach reset() konvergiert die Schaetzung schneller auf den neuen Pegel', () => {
  const bis5 = (k, ziel) => { for (let i = 1; i <= 600; i++) { const v = k.update(ziel); if (Math.abs(v - ziel) / ziel < 0.05) return i; } return Infinity; };
  const ohne = new P.AdaptivePPFDKalmanFilter();
  for (let i = 0; i < 400; i++) ohne.update(600);
  ohne.r = 8.0;
  const mit = new P.AdaptivePPFDKalmanFilter();
  for (let i = 0; i < 400; i++) mit.update(600);
  mit.r = 8.0; mit.reset();
  const nOhne = bis5(ohne, 200), nMit = bis5(mit, 200);
  assert.ok(nMit < nOhne, `mit reset ${nMit} Frames, ohne ${nOhne} - kein Gewinn`);
});

t('REGRESSION: stehengebliebener temporalStats-Puffer kippt Q auf 0', () => {
  // Beim Moduswechsel springt yMean_lin; ein gemischter Ringpuffer erzeugt
  // einen temporalCV, der nichts mit echter Instabilitaet zu tun hat - und
  // seit dem Q-Gate (v3.4.3) die Anzeige zusaetzlich anhaelt.
  const ts = new P.TemporalStats(30);
  for (let i = 0; i < 25; i++) ts.push(0.02);   // vor dem Revert: dunkel/manuell
  for (let i = 0; i < 5; i++) ts.push(0.15);    // danach: Auto hellt auf
  const cvGemischt = ts.cv();
  assert.ok(cvGemischt > 0.5, 'gemischter Puffer sollte hohen CV zeigen, war ' + cvGemischt);
  const qGemischt = P.computeQuality({ clipRatio: 0, uniformityCV: 0.03, yMeanLin: 0.15, temporalCV: cvGemischt });
  assert.ok(qGemischt.q < P.Q_GATE_HOLD, 'Q-Gate wuerde halten, q=' + qGemischt.q.toFixed(3));
  assert.strictEqual(qGemischt.weakest, 'stability');

  ts.reset();                                    // das macht revertToAutoExposure() jetzt
  for (let i = 0; i < 10; i++) ts.push(0.15);
  const qSauber = P.computeQuality({ clipRatio: 0, uniformityCV: 0.03, yMeanLin: 0.15, temporalCV: ts.cv() });
  assert.ok(qSauber.q >= P.Q_GATE_HOLD, 'nach reset muss das Gate wieder oeffnen, q=' + qSauber.q.toFixed(3));
});

t('Warmup laeuft nach dem Moduswechsel neu an (Kalman ruht so lange)', () => {
  // Waehrend des Warmups ruft der Aufrufer update() gar nicht auf - genau
  // deshalb ueberlebte das alte x bisher die vollen 300 Frames.
  const tc = new P.TemperatureCompensator();
  for (let i = 0; i < 400; i++) tc.update();
  assert.strictEqual(tc.update().isWarmedUp, true);
  tc.reset();
  assert.strictEqual(tc.update().isWarmedUp, false, 'reset muss den Warmup neu starten');
  assert.strictEqual(tc.warmupFrames, 300);
});

console.log('== Flicker-Hysterese (v3.4.5) ==');
// Die FSM wird pro Frame aufgerufen (~60/s), die Flicker-Erkennung liefert
// aber nur 1x/s ein Ergebnis. Ohne flickerFresh zaehlte dasselbe Ergebnis 60x.
const warm = (fsm) => { fsm.update(true, false, false, 30, true); return fsm; };
// Ein Detektionsergebnis, ueber `frames` Frames an die FSM gereicht.
function sekunde(fsm, flickering, frames = 60) {
  let s;
  for (let i = 0; i < frames; i++) s = fsm.update(true, flickering, false, 30, i === 0);
  return s;
}

t('REGRESSION: eine einzelne Detektion trippt das Badge NICHT mehr', () => {
  const fsm = warm(new P.AppStatusStateMachine());
  const s = sekunde(fsm, true);
  assert.strictEqual(s.id, 'STABLE', 'ein Befund darf keine Warnung ausloesen');
  assert.strictEqual(fsm.acc.flicker, 1, 'Akkumulator darf nur 1 Schritt machen, war ' + fsm.acc.flicker);
});

t('Anhaltender Flicker loest nach FLICKER_ENTER Detektionen aus', () => {
  const fsm = warm(new P.AppStatusStateMachine());
  let s;
  for (let i = 0; i < fsm.LIMITS.FLICKER_ENTER - 1; i++) s = sekunde(fsm, true);
  assert.strictEqual(s.id, 'STABLE', 'zu frueh ausgeloest');
  s = sekunde(fsm, true);
  assert.strictEqual(s.id, 'FLICKER', 'nach ' + fsm.LIMITS.FLICKER_ENTER + ' Detektionen erwartet');
});

t('Warnung verschwindet wieder, wenn der Flicker aufhoert', () => {
  const fsm = warm(new P.AppStatusStateMachine());
  let s;
  for (let i = 0; i < 5; i++) s = sekunde(fsm, true);
  assert.strictEqual(s.id, 'FLICKER');
  for (let i = 0; i < fsm.CAPS.flicker; i++) s = sekunde(fsm, false);
  assert.strictEqual(s.id, 'STABLE', 'Badge blieb haengen, acc=' + fsm.acc.flicker);
});

t('Langer Flicker leuchtet nicht ewig nach (Deckel begrenzt das Loeschen)', () => {
  const fsm = warm(new P.AppStatusStateMachine());
  for (let i = 0; i < 300; i++) sekunde(fsm, true); // 5 Minuten Dauerbefund
  assert.ok(fsm.acc.flicker <= fsm.CAPS.flicker,
    'Akkumulator ueber dem Deckel: ' + fsm.acc.flicker);
  let s;
  for (let i = 0; i < fsm.CAPS.flicker; i++) s = sekunde(fsm, false);
  assert.strictEqual(s.id, 'STABLE', 'nach ' + fsm.CAPS.flicker + ' sauberen Sekunden erwartet');
});

t('Pausierte Erkennung (Pixel-Step 8x) laesst die Warnung abklingen', () => {
  // Die Pausen-Zweige setzen isFlickering=false und melden das als frisches
  // Ergebnis - genau der Fall aus dem Feld-Screenshot.
  const fsm = warm(new P.AppStatusStateMachine());
  let s;
  for (let i = 0; i < 5; i++) s = sekunde(fsm, true);
  assert.strictEqual(s.id, 'FLICKER');
  for (let i = 0; i < fsm.CAPS.flicker; i++) s = sekunde(fsm, false);
  assert.strictEqual(s.id, 'STABLE');
});

t('Ohne frisches Ergebnis ruht der Akkumulator vollstaendig', () => {
  const fsm = warm(new P.AppStatusStateMachine());
  sekunde(fsm, true);
  const vorher = fsm.acc.flicker;
  for (let i = 0; i < 200; i++) fsm.update(true, true, false, 30, false);
  assert.strictEqual(fsm.acc.flicker, vorher, 'abgelaufene Frames haben mitgezaehlt');
});

t('Clipping und FPS bleiben Pro-Frame-Groessen (Schwellen unveraendert)', () => {
  const fsm = warm(new P.AppStatusStateMachine());
  let s;
  for (let i = 0; i < fsm.LIMITS.CLIP_ENTER; i++) s = fsm.update(true, false, true, 30, false);
  assert.strictEqual(s.id, 'CLIPPING', 'Clipping muss ohne frisches Flicker-Ergebnis greifen');
});

console.log('== F: Profil-Bibliothek & Detektor ==');
t('Profile: Faktoren/Unsicherheiten plausibel, detect-Flags korrekt', () => {
  for (const [k, p] of Object.entries(P.LIGHT_PROFILES)) {
    assert.ok(p.factor > 0.005 && p.factor < 0.03, `${k}.factor=${p.factor}`);
    assert.ok(p.u > 0 && p.u <= 0.5, `${k}.u=${p.u}`);
    assert.ok(p.name && p.note, `${k} ohne name/note`);
    if (p.detect !== false) { assert.ok(typeof p.r === 'number' && typeof p.g === 'number', `${k} detect ohne Signatur`); }
  }
  assert.strictEqual(P.LIGHT_PROFILES.WHITE_LED.detect, false);
  assert.strictEqual(P.LIGHT_PROFILES.METAL_HALIDE.detect, false);
});
t('Detektor nutzt nur detect-Profile; Hysterese haelt die Wahl fest', () => {
  const det = new P.LightSourceDetector();
  // v3.4.8: LED_GROW ist zu WHITE_LED und METAL_HALIDE dazugekommen - alle
  // drei sind nur noch manuell waehlbar (Begruendung s. LIGHT_PROFILES).
  for (const k of ['WHITE_LED', 'METAL_HALIDE', 'LED_GROW']) {
    assert.ok(!(k in det.profiles), k + ' darf nicht auto-erkannt werden');
  }
  // Chromatizitaet auf der HPS-Signatur (r=0.52,g=0.41): R=133,G=105,B=18
  let r;
  for (let i = 0; i < 5; i++) r = det.detect(133, 105, 18);
  assert.strictEqual(r.id, 'SODIUM_HPS');
  // Ein einzelner abweichender Frame kippt die Wahl nicht (Hysterese 3).
  const vorher = r.id;
  const s1 = det.detect(84, 87, 84);
  assert.strictEqual(s1.id, vorher, 'ein Frame hat die Klassifikation gekippt');
});
t('calculatePARFromLinear: Gewichtungen summieren sich zu 1', () => {
  for (const id of ['LED_GROW', 'SODIUM_HPS', 'SUNLIGHT', 'WHITE_LED', 'METAL_HALIDE']) {
    const w = P.calculatePARFromLinear(1, 1, 1, id);
    approx(w, 1, 1e-9, `Gewichtssumme ${id}`);
  }
});

console.log('== Kalman & Warmup ==');
t('Kalman konvergiert auf konstante Messreihe', () => {
  const k = new P.AdaptivePPFDKalmanFilter(0.02, 2.5, 1.0, 0.0);
  let x;
  for (let i = 0; i < 60; i++) x = k.update(500);
  approx(x, 500, 25, 'Konvergenz');
});
t('Warmup-Faktor: 0.98 bei Frame 0 -> 1.0 nach 300 Frames', () => {
  const tc = new P.TemperatureCompensator();
  approx(tc.update().factor, 0.98, 1e-3);
  let s; for (let i = 0; i < 300; i++) s = tc.update();
  assert.strictEqual(s.factor, 1.0); assert.ok(s.isWarmedUp);
});

console.log('== Uniformität (3x3-CV, v3.3.1) ==');
t('Uniform-Frame: CV ≈ 0', () => {
  const f = P.analyzeFrame(uniform(128), W, H, 4, LUT);
  assert.ok(f.uniformity.cv !== null, 'CV null bei gutem Signal');
  approx(f.uniformity.cv, 0, 1e-9, 'CV uniform');
  approx(f.uniformity.mean, LUT[128], 1e-6, 'Zonen-Gesamtmittel');
});
t('Rauschdomäne (v=5): CV ist null, nicht eine Zahl', () => {
  const f = P.analyzeFrame(uniform(5), W, H, 4, LUT);
  assert.strictEqual(f.uniformity.cv, null);
});
t('Vertikaler Gradient: CV trifft semi-analytischen Erwartungswert', () => {
  const d = makeFrame((x, y) => [y, y, y]);
  const f = P.analyzeFrame(d, W, H, 4, LUT);
  // Erwartung: Zeilenbänder 0-79 / 80-159 / 160-239, Spalten identisch
  const band = (a, b) => { let s = 0; for (let y = a; y <= b; y++) s += LUT[y]; return s / (b - a + 1); };
  const A = band(0, 79), B = band(80, 159), C = band(160, 239);
  const zones = [A, A, A, B, B, B, C, C, C];
  const mu = zones.reduce((s, v) => s + v, 0) / 9;
  const cvExp = Math.sqrt(zones.reduce((s, v) => s + (v - mu) ** 2, 0) / 9) / mu;
  approx(f.uniformity.cv, cvExp, 0.02, `CV gradient (erwartet ~${cvExp.toFixed(3)})`);
  console.log(`        [info] Gradient v=0..239 -> CV ${(f.uniformity.cv * 100).toFixed(1)}%`);
});
t('Zentrum-Hotspot: CV deutlich größer als beim Gradienten', () => {
  const grad = P.analyzeFrame(makeFrame((x, y) => [y, y, y]), W, H, 4, LUT);
  const hot = P.analyzeFrame(makeFrame((x, y) => {
    const cx = x - W / 2, cy = y - H / 2;
    const v = (cx * cx + cy * cy < 2500) ? 240 : 40; // heller Fleck in der Mitte
    return [v, v, v];
  }), W, H, 4, LUT);
  console.log(`        [info] Hotspot -> CV ${(hot.uniformity.cv * 100).toFixed(1)}% vs Gradient ${(grad.uniformity.cv * 100).toFixed(1)}%`);
  assert.ok(hot.uniformity.cv > grad.uniformity.cv * 1.3, 'Hotspot-CV nicht klar höher');
});
t('Zonen-Stichprobe: Summe = sampledPixels, alle Zonen belegt (4x und 8x)', () => {
  for (const step of [4, 8]) {
    const f = P.analyzeFrame(uniform(100), W, H, step, LUT);
    // zoneCounts nicht exportiert -> indirekt: 9 Zonen, Mittel konsistent
    for (let z = 0; z < 9; z++) approx(f.uniformity.zoneMeans[z], LUT[100], 1e-6, `Zone ${z} @${step}x`);
  }
});

console.log('== Schwarzwert-Subtraktion (v3.3.7/v3.3.16) ==');
t('Default-Parameter: Aufruf ohne blackLevelLin ≡ 0', () => {
  const a = P.analyzeFrame(uniform(128), W, H, 4, LUT);
  const b = P.analyzeFrame(uniform(128), W, H, 4, LUT, 0);
  approx(a.yMean_lin, b.yMean_lin, 1e-12, 'yMean_lin abweichend');
  approx(a.uniformity.cv ?? -1, b.uniformity.cv ?? -1, 1e-12, 'CV abweichend');
});
t('Subtraktion exakt: yMean_lin == LUT[128] - bl', () => {
  const bl = 0.05;
  const f = P.analyzeFrame(uniform(128), W, H, 4, LUT, bl);
  approx(f.yMean_lin, LUT[128] - bl, 1e-6, 'yMean_lin');
  approx(f.avgR_lin, LUT[128] - bl, 1e-6, 'avgR_lin (Kanal-Subtraktion)');
});
t('Clamp bei 0: Offset > Signal -> 0, nicht negativ; CV null (Rauschdomäne)', () => {
  const f = P.analyzeFrame(uniform(5), W, H, 4, LUT, 0.01); // LUT[5]≈0.0017 < 0.01
  assert.strictEqual(f.yMean_lin, 0);
  assert.strictEqual(f.avgR_lin, 0);
  assert.strictEqual(f.uniformity.cv, null);
});
t('rowAverages subtrahiert (Flicker-Pfad sieht denselben Offset)', () => {
  const bl = 0.02;
  const f = P.analyzeFrame(uniform(100), W, H, 4, LUT, bl);
  for (let r = 0; r < H; r += 60) approx(f.rowAverages[r], LUT[100] - bl, 1e-6, `Zeile ${r}`);
});
t('Clipping-Zählung unberührt (kodierte Domäne, vor Subtraktion)', () => {
  const f = P.analyzeFrame(uniform(255), W, H, 4, LUT, 0.5);
  assert.strictEqual(f.clippingPixels, f.sampledPixels);
  approx(f.yMean_lin, 1 - 0.5, 1e-6, 'yMean_lin bei Sättigung minus bl');
});
t('Zonen-CV steigt mit Offset (sigma_zones konstant, mu sinkt)', () => {
  const d = makeFrame((x, y) => [y, y, y]); // vertikaler Gradient 0..239
  const cv0 = P.analyzeFrame(d, W, H, 4, LUT, 0).uniformity.cv;
  const cvB = P.analyzeFrame(d, W, H, 4, LUT, 0.02).uniformity.cv;
  console.log(`        [info] Gradient-CV ohne/mit bl=0.02: ${(cv0 * 100).toFixed(1)}% -> ${(cvB * 100).toFixed(1)}%`);
  assert.ok(cvB > cv0, 'CV müsste durch Offset-Subtraktion steigen');
});

console.log('== Qualitätsindex Q (v3.3.2) ==');
t('ramp01: Endpunkte, Mitte 0.5, Monotonie, invertierte Rampe', () => {
  assert.strictEqual(P.ramp01(0, 0.01, 0.15), 1);
  assert.strictEqual(P.ramp01(0.2, 0.01, 0.15), 0);
  approx(P.ramp01(0.08, 0.01, 0.15), 0.5, 1e-9, 'Smoothstep-Mitte');
  let prev = 1;
  for (let x = 0; x <= 0.2; x += 0.01) { const v = P.ramp01(x, 0.01, 0.15); assert.ok(v <= prev + 1e-12); prev = v; }
  // invertiert (x1<x0): "mehr ist besser"
  assert.strictEqual(P.ramp01(0.1, 0.04, 0.003), 1);
  assert.strictEqual(P.ramp01(0.001, 0.04, 0.003), 0);
});
t('TemporalStats: <5 Samples -> null; konstant -> ~0; alternierend -> hoch', () => {
  const ts = new P.TemporalStats(30);
  for (let i = 0; i < 4; i++) ts.push(0.1);
  assert.strictEqual(ts.cv(), null);
  ts.push(0.1);
  approx(ts.cv(), 0, 1e-12, 'konstante Reihe');
  const ts2 = new P.TemporalStats(30);
  for (let i = 0; i < 20; i++) ts2.push(i % 2 === 0 ? 0.1 : 0.2);
  approx(ts2.cv(), 0.05 / 0.15, 1e-9, 'alternierende Reihe');
  const ts3 = new P.TemporalStats(10);
  for (let i = 0; i < 50; i++) ts3.push(0.1);
  assert.strictEqual(ts3.buf.length, 10, 'Ringpuffer begrenzt');
});
t('computeQuality: ideale Bedingungen -> Q ≈ 1', () => {
  const r = P.computeQuality({ clipRatio: 0, uniformityCV: 0.02, yMeanLin: 0.2, temporalCV: 0.01 });
  approx(r.q, 1, 1e-9); assert.strictEqual(r.weakest, 'clip'); // alle 1 -> erster Eintrag
});
t('computeQuality: Clipping dominant -> Q=0, weakest=clip', () => {
  const r = P.computeQuality({ clipRatio: 0.2, uniformityCV: 0.02, yMeanLin: 0.2, temporalCV: 0.01 });
  assert.strictEqual(r.q, 0); assert.strictEqual(r.weakest, 'clip');
});
t('computeQuality: null-Komponenten sind neutral (keine Doppelbestrafung)', () => {
  const r = P.computeQuality({ clipRatio: 0, uniformityCV: null, yMeanLin: 0.001, temporalCV: null });
  assert.strictEqual(r.qUniformity, 1); assert.strictEqual(r.qStability, 1);
  assert.strictEqual(r.qSignal, 0); assert.strictEqual(r.q, 0); assert.strictEqual(r.weakest, 'signal');
});
t('computeQuality: Produkt & weakest-Benennung bei Mischlage', () => {
  const r = P.computeQuality({ clipRatio: 0.03, uniformityCV: 0.25, yMeanLin: 0.2, temporalCV: 0.02 });
  approx(r.q, r.qClip * r.qUniformity * r.qSignal * r.qStability, 1e-12, 'Produkt');
  assert.strictEqual(r.weakest, 'uniformity');
  assert.ok(r.q > 0 && r.q < 1);
});
t('computeQuality: Zeitlicher CV oberhalb Zero-Schwelle -> Q=0 via stability', () => {
  const r = P.computeQuality({ clipRatio: 0, uniformityCV: 0.01, yMeanLin: 0.2, temporalCV: 0.3 });
  assert.strictEqual(r.qStability, 0); assert.strictEqual(r.q, 0); assert.strictEqual(r.weakest, 'stability');
});

console.log('== Unsicherheitsbudget (v3.3.3) ==');
t('u_noise: Shot-Noise-Form, Floor und Cap', () => {
  const at = y => P.computeUncertainty({ calibrated: true, profileU: 0.05, autoMode: false, temporalCV: 0, yMeanLin: y }).uNoise;
  approx(at(0.25), 0.01, 1e-9, 'Mitte ~1%');
  assert.strictEqual(at(1), P.U_NOISE_FLOOR); // Floor greift
  approx(at(P.SIGNAL_CRIT_LIN), 0.005 / Math.sqrt(P.SIGNAL_CRIT_LIN), 1e-9, 'dunkel ~9%');
  assert.strictEqual(at(1e-6), P.U_NOISE_MAX); // Cap
  assert.ok(at(0.01) > at(0.1), 'monoton steigend zur dunklen Seite');
});
t('u_cal: kalibriert 5%, unkalibriert 35%', () => {
  const base = { profileU: 0.05, autoMode: false, temporalCV: 0, yMeanLin: 0.2 };
  assert.strictEqual(P.computeUncertainty({ ...base, calibrated: true }).uCal, 0.05);
  assert.strictEqual(P.computeUncertainty({ ...base, calibrated: false }).uCal, 0.35);
});
t('u_profile: Auto-Modus hebt Klassifikationsrisiko auf >=10%', () => {
  const base = { calibrated: true, temporalCV: 0, yMeanLin: 0.2 };
  assert.strictEqual(P.computeUncertainty({ ...base, profileU: 0.05, autoMode: true }).uProfile, 0.10);
  assert.strictEqual(P.computeUncertainty({ ...base, profileU: 0.05, autoMode: false }).uProfile, 0.05);
  assert.strictEqual(P.computeUncertainty({ ...base, profileU: 0.12, autoMode: true }).uProfile, 0.12);
});
t('Kombination: Quadratur, sys/rand getrennt, uRel >= uSys,uRand', () => {
  const r = P.computeUncertainty({ calibrated: true, profileU: 0.05, autoMode: false, temporalCV: 0.01, yMeanLin: 0.25 });
  approx(r.uSys, Math.sqrt(0.05 ** 2 + 0.05 ** 2), 1e-12, 'uSys');
  approx(r.uRand, Math.sqrt(0.01 ** 2 + 0.01 ** 2), 1e-9, 'uRand');
  approx(r.uRel, Math.sqrt(r.uSys ** 2 + r.uRand ** 2), 1e-12, 'uRel');
  assert.ok(r.uRel >= r.uSys && r.uRel >= r.uRand);
});
t('null temporalCV -> 0-Beitrag (kein falscher Ausschlag)', () => {
  const r = P.computeUncertainty({ calibrated: true, profileU: 0.05, autoMode: false, temporalCV: null, yMeanLin: 0.2 });
  assert.strictEqual(r.uTemporal, 0);
});
t('Realistische Szenarien: kalibriert/manuell ~7%, unkalibriert/auto ~37%', () => {
  const cal = P.computeUncertainty({ calibrated: true, profileU: 0.05, autoMode: false, temporalCV: 0.01, yMeanLin: 0.3 });
  console.log(`        [info] kalibriert+manuell: ±${(cal.uRel * 100).toFixed(1)}%`);
  assert.ok(cal.uRel > 0.06 && cal.uRel < 0.09, 'kalibriert außerhalb 6-9%');
  const uncal = P.computeUncertainty({ calibrated: false, profileU: 0.05, autoMode: true, temporalCV: 0.01, yMeanLin: 0.3 });
  console.log(`        [info] unkalibriert+auto: ±${(uncal.uRel * 100).toFixed(1)}% (sys ${(uncal.uSys * 100).toFixed(1)} / rand ${(uncal.uRand * 100).toFixed(1)})`);
  assert.ok(uncal.uRel > 0.33 && uncal.uRel < 0.42, 'unkalibriert außerhalb 33-42%');
});

console.log('== Zwei-Punkt-Kalibrierung (v3.4.0) ==');
t('Ein Punkt: reine Steigung, offset 0 (Legacy-Verhalten)', () => {
  const c = P.computeCalib2({ raw: 400, ref: 500 }, null);
  approx(c.slope, 1.25, 1e-12, 'slope');
  assert.strictEqual(c.offset, 0);
  assert.strictEqual(c.points, 1);
});
t('Zwei Punkte: exakte Gerade durch beide Stützen', () => {
  const c = P.computeCalib2({ raw: 100, ref: 90 }, { raw: 900, ref: 1010 });
  approx(c.slope, 1.15, 1e-12, 'slope');
  approx(c.offset, 90 - 1.15 * 100, 1e-9, 'offset');
  assert.strictEqual(c.points, 2);
  approx(c.slope * 100 + c.offset, 90, 1e-9, 'Punkt 1 liegt auf der Geraden');
  approx(c.slope * 900 + c.offset, 1010, 1e-9, 'Punkt 2 liegt auf der Geraden');
});
t('Reihenfolge der Punkte ist irrelevant', () => {
  const a = P.computeCalib2({ raw: 100, ref: 90 }, { raw: 900, ref: 1010 });
  const b = P.computeCalib2({ raw: 900, ref: 1010 }, { raw: 100, ref: 90 });
  approx(a.slope, b.slope, 1e-12, 'slope');
  approx(a.offset, b.offset, 1e-9, 'offset');
});
t('Rohwerte zu nah beieinander -> null (Guard)', () => {
  assert.strictEqual(P.computeCalib2({ raw: 400, ref: 410 }, { raw: 402, ref: 412 }), null);
});
t('Negative Steigung -> null (Guard)', () => {
  assert.strictEqual(P.computeCalib2({ raw: 100, ref: 500 }, { raw: 900, ref: 100 }), null);
});
t('Leere Eingabe / ungültiger Punkt -> null', () => {
  assert.strictEqual(P.computeCalib2(null, null), null);
  assert.strictEqual(P.computeCalib2({ raw: 0, ref: 100 }, null), null);
});
t('Nur p2 gesetzt == Ein-Punkt-Fit von p2', () => {
  const c = P.computeCalib2(null, { raw: 200, ref: 100 });
  approx(c.slope, 0.5, 1e-12, 'slope');
  assert.strictEqual(c.points, 1);
});
t('v3.4.1: Ein-Punkt-Clamp (slope>10) mit Flag', () => {
  const c = P.computeCalib2({ raw: 10, ref: 200 }, null); // raw 20 -> 10
  approx(c.slope, P.CALIB2_MAX_SLOPE, 1e-12, 'slope geclamppt');
  assert.strictEqual(c.clamped, true);
  assert.strictEqual(c.offset, 0);
});
t('v3.4.12: Zwei-Punkt-Clamp - Offset am Schwerpunkt, Fehler gleich verteilt', () => {
  // Bis v3.4.11 haing der Offset an p1: die Gerade traf p1 exakt und verfehlte
  // p2 um den vollen Clamp-Fehler. Ein Property-Test hat gezeigt, dass das
  // ergebnisrelevant von der EINGABEREIHENFOLGE abhing - dieselben zwei
  // Messpunkte, andere Reihenfolge, andere Kalibrierung.
  // Jetzt verankert der Schwerpunkt: reihenfolgeunabhaengig, und die durch
  // den Clamp erzwungene Abweichung verteilt sich auf beide Stuetzstellen.
  const p1 = { raw: 100, ref: 100 }, p2 = { raw: 200, ref: 1500 }; // rawSlope 14 -> 10
  const c = P.computeCalib2(p1, p2);
  approx(c.slope, P.CALIB2_MAX_SLOPE, 1e-12, 'slope geclamppt');
  assert.strictEqual(c.clamped, true);
  const mRaw = (p1.raw + p2.raw) / 2, mRef = (p1.ref + p2.ref) / 2;
  approx(c.offset, mRef - P.CALIB2_MAX_SLOPE * mRaw, 1e-9, 'offset am Schwerpunkt');
  // Beide Punkte werden um denselben Betrag verfehlt, mit umgekehrtem Vorzeichen.
  const fehler = (p) => (c.slope * p.raw + c.offset) - p.ref;
  approx(fehler(p1), -fehler(p2), 1e-9, 'Fehler symmetrisch auf beide Punkte');
});
t('v3.4.12: Der geclampte Fit haengt nicht an der Eingabereihenfolge', () => {
  const p1 = { raw: 100, ref: 100 }, p2 = { raw: 200, ref: 1500 };
  const a = P.computeCalib2(p1, p2), b = P.computeCalib2(p2, p1);
  approx(a.slope, b.slope, 1e-12);
  approx(a.offset, b.offset, 1e-9, 'Offset haengt an der Reihenfolge');
});
t('v3.4.1: Ungeclamppte Fits tragen clamped=false', () => {
  assert.strictEqual(P.computeCalib2({ raw: 400, ref: 500 }, null).clamped, false);
  assert.strictEqual(P.computeCalib2({ raw: 100, ref: 90 }, { raw: 900, ref: 1010 }).clamped, false);
});

console.log('== Median-Vorfilter (v3.4.3) ==');
t('Median glaettet nicht, solange die Reihe monoton ist', () => {
  const rm = new P.RollingMedian(5);
  // Vor dem Volllaufen: Median der bisherigen Werte, nie null nach dem 1. push
  assert.strictEqual(rm.push(100), 100);
  assert.strictEqual(rm.push(110), 105);
  assert.strictEqual(rm.push(120), 110);
});
t('Einzelner Ausreisser wird vollstaendig verworfen', () => {
  const rm = new P.RollingMedian(5);
  [500, 505, 495, 500].forEach(v => rm.push(v));
  const withSpike = rm.push(50000); // Reflex / Blitz
  assert.strictEqual(withSpike, 500, 'Median bleibt beim Nutzsignal, Spike ohne Wirkung');
});
t('Auch ein Ausreisser nach unten (Wolkenschatten) greift nicht durch', () => {
  const rm = new P.RollingMedian(5);
  [800, 795, 805, 800].forEach(v => rm.push(v));
  assert.strictEqual(rm.push(0), 800);
});
t('Zwei von fuenf Ausreissern sind noch abgedeckt, drei nicht mehr', () => {
  const rm = new P.RollingMedian(5);
  [400, 400, 400].forEach(v => rm.push(v));
  rm.push(9999); rm.push(9999);
  assert.strictEqual(rm.value(), 400, '2/5 Ausreisser: Median haelt');
  rm.push(9999);
  assert.notStrictEqual(rm.value(), 400, '3/5 Ausreisser: Median kippt (erwartet)');
});
t('Echter Pegelwechsel setzt sich nach der halben Fensterlaenge durch', () => {
  const rm = new P.RollingMedian(5);
  [100, 100, 100, 100, 100].forEach(v => rm.push(v));
  rm.push(900); rm.push(900);
  assert.strictEqual(rm.value(), 100, 'nach 2 neuen Werten noch alter Pegel');
  assert.strictEqual(rm.push(900), 900, 'nach 3 von 5 kippt der Median auf den neuen Pegel');
});
t('Fenster laeuft nicht ueber und reset() leert es', () => {
  const rm = new P.RollingMedian(5);
  for (let i = 0; i < 50; i++) rm.push(i);
  assert.strictEqual(rm.buf.length, 5);
  assert.strictEqual(rm.value(), 47);
  rm.reset();
  assert.strictEqual(rm.value(), null, 'leeres Fenster -> null');
});
t('Nicht-endliche Werte werden ignoriert, nicht eingekippt', () => {
  const rm = new P.RollingMedian(5);
  [10, 20, 30].forEach(v => rm.push(v));
  assert.strictEqual(rm.push(NaN), 20, 'NaN veraendert den Median nicht');
  assert.strictEqual(rm.push(Infinity), 20);
  assert.strictEqual(rm.buf.length, 3, 'Fenster bleibt unveraendert');
});
t('Gerades Fenster mittelt die beiden mittleren Werte', () => {
  const rm = new P.RollingMedian(4);
  [10, 20, 30, 40].forEach(v => rm.push(v));
  assert.strictEqual(rm.value(), 25);
});
t('MEDIAN_WINDOW ist ungerade (Median ist ein echter Messwert)', () => {
  assert.strictEqual(P.MEDIAN_WINDOW % 2, 1);
});

console.log('== Q-Gate (v3.4.3) ==');
t('Q_GATE_HOLD liegt zwischen 0 und 1 und unter der 0.85-Anzeigeschwelle', () => {
  assert.ok(P.Q_GATE_HOLD > 0 && P.Q_GATE_HOLD < 0.85, 'sonst friert die Live-Anzeige ein');
});
t('Sauberer Frame passiert das Gate, kollabierter nicht', () => {
  const gut = P.computeQuality({ clipRatio: 0, uniformityCV: 0.02, yMeanLin: 0.2, temporalCV: 0.005 });
  assert.ok(gut.q >= P.Q_GATE_HOLD, 'guter Frame darf nicht gehalten werden, q=' + gut.q.toFixed(3));
  const schlecht = P.computeQuality({ clipRatio: 0.12, uniformityCV: 0.35, yMeanLin: 0.005, temporalCV: 0.22 });
  assert.ok(schlecht.q < P.Q_GATE_HOLD, 'Schrottframe muss gehalten werden, q=' + schlecht.q.toFixed(3));
});
t('Brauchbare Freihand-Lage bliebe bei Gate=0.85 haengen, bei 0.35 nicht', () => {
  // Das ist der Grund fuer 0.35 statt der 0.85 aus der Referenzarchitektur:
  // leicht schraeg gehalten ist eine benutzbare Messlage, keine Schrottmessung.
  const q = P.computeQuality({ clipRatio: 0.01, uniformityCV: 0.16, yMeanLin: 0.2, temporalCV: 0.06 });
  assert.ok(q.q < 0.85, 'wuerde ein 0.85-Gate schliessen, q=' + q.q.toFixed(3));
  assert.ok(q.q >= P.Q_GATE_HOLD, 'darf das 0.35-Gate nicht schliessen, q=' + q.q.toFixed(3));
});
t('Dokumentierte Einzelschwellen des Gates stimmen mit den Rampen ueberein', () => {
  const nur = (o) => P.computeQuality(Object.assign(
    { clipRatio: 0, uniformityCV: 0.02, yMeanLin: 0.2, temporalCV: 0.005 }, o)).q;
  // Werte aus dem Kommentar an Q_GATE_HOLD - schlagen an, wenn jemand die
  // Rampenkonstanten aendert, ohne die Begruendung nachzuziehen.
  assert.ok(Math.abs(nur({ uniformityCV: 0.26 }) - P.Q_GATE_HOLD) < 0.02, 'CV 26% ~ Gate');
  assert.ok(Math.abs(nur({ temporalCV: 0.158 }) - P.Q_GATE_HOLD) < 0.02, 'tCV 15.8% ~ Gate');
  assert.ok(Math.abs(nur({ uniformityCV: 0.136 }) - 0.85) < 0.02, 'CV 13.6% ~ 0.85');
  assert.ok(Math.abs(nur({ temporalCV: 0.076 }) - 0.85) < 0.02, 'tCV 7.6% ~ 0.85');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
