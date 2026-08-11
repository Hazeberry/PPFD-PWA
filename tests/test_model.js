// Model-Based-Harness (v3.4.13) - fast-check fc.commands.
//
// Unterschied zu den anderen Harnesses:
//   test_pipeline.js     - ein ausgedachter Fall, eine Erwartung
//   test_properties.js   - eine Regel, viele zufaellige EINGABEN, aber jede
//                          Funktion fuer sich
//   hier                 - viele zufaellige BEFEHLSFOLGEN gegen ein
//                          Parallelmodell. Findet Fehler, die erst durch die
//                          Reihenfolge entstehen: Kalibrieren, Profil wechseln,
//                          Kamera wechseln, zuruecksetzen, neu laden - in
//                          beliebiger Verschraenkung.
//
// Zwei Automaten, bewusst dort angesetzt, wo in diesem Projekt real Fehler
// gesteckt haben:
//   1. Kalibrier-Storage  - v3.4.3 (Profilbindung), v3.4.8 (Reset-Umfang),
//                           v3.4.11 (Legacy ohne Fit): drei Fehler, alle in
//                           der Verdrahtung zwischen localStorage und
//                           Modul-Zustand, keiner in der Mathematik.
//   2. AppStatusStateMachine - v3.4.5 (Hysterese zaehlte Frames statt
//                           Detektionen). Reine Zustandslogik mit
//                           Akkumulatoren, klassischer Fall fuer ein Modell.
//
// Das Modell bildet NICHT die Mathematik nach: fuer die erwarteten
// Kalibrierwerte wird das echte computeCalib2() als Orakel benutzt (es ist
// durch test_properties.js abgedeckt). Geprueft wird die Routing- und
// Zustandslogik drumherum - sonst pruefte man eine Reimplementierung gegen
// sich selbst.
//
// Aufruf: npm install && node tests/test_model.js [pfad/zu/index.html]
'use strict';
const fs = require('fs');
const assert = require('assert');
const path = require('path');

let fc;
try { fc = require('fast-check'); }
catch (e) {
  console.error('fast-check fehlt. Einmalig "npm install" ausfuehren.');
  process.exit(2);
}

const htmlPath = process.argv[2] || path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];

// --- Attrappe (wie test_calib_storage.js, plus Schreibzugriff auf den
//     Messzustand, den applyCalibration() liest) --------------------------
function neueApp() {
  const store = {};
  const localStorage = {
    getItem: k => k in store ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  };
  const mkEl = () => new Proxy({
    textContent: '', value: '', style: { setProperty() {}, removeProperty() {} }, className: '',
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, appendChild() {}, querySelectorAll: () => []
  }, {
    get(t, p) { if (p in t) return t[p]; return typeof p === 'string' ? () => mkEl() : undefined; },
    set(t, p, v) { t[p] = v; return true; }
  });
  const els = new Map();
  const document = {
    getElementById: (id) => { if (!els.has(id)) els.set(id, mkEl()); return els.get(id); },
    createElement: () => mkEl(), addEventListener() {}, body: mkEl(),
    querySelectorAll: () => [], visibilityState: 'visible', hidden: false
  };
  const api = new Function('localStorage', 'document', 'window', 'navigator', 'console',
    'requestAnimationFrame', 'performance', 'alert', 'confirm',
    src + `
    ;return {
      get customCalibFactor(){return customCalibFactor;},
      get calibOffset(){return calibOffset;}, get calibPoints(){return calibPoints;},
      get calibLegacyScope(){return calibLegacyScope;},
      get calibP1(){return calibP1;}, get calibP2(){return calibP2;}, get calibFit(){return calibFit;},
      get manualLightKey(){return manualLightKey;}, set manualLightKey(v){manualLightKey=v;},
      get cameraFacing(){return cameraFacing;}, set cameraFacing(v){cameraFacing=v;},
      set currentRawPPFDUncalibrated(v){currentRawPPFDUncalibrated=v;},
      set currentSignalLevel(v){currentSignalLevel=v;},
      set lastFrameSnapshot(v){lastFrameSnapshot=v;},
      loadCalib, applyCalibration, resetCalibration, computeCalib2,
      calibStorageKey, calibLegacyKey, calibRangeStatus,
      AppStatusStateMachine, LIGHT_PROFILES, CALIB2_MIN_SEP };`
  )(localStorage, document, { AudioContext: function () {}, addEventListener() {} },
    { userAgent: 'Node-Test', mediaDevices: {} }, { log() {}, warn() {}, error() {} },
    () => 0, { now: () => Date.now() }, () => {}, () => true);
  return { api, store, els, document };
}

let passed = 0, failed = 0;
const RUNS = Number(process.env.MODEL_RUNS || 120);
function modell(name, commandArb, aufbau, opts = {}) {
  try {
    fc.assert(fc.property(fc.commands(commandArb, { maxCommands: opts.maxCommands || 40 }), (cmds) => {
      fc.modelRun(aufbau, cmds);
    }), { numRuns: RUNS });
    passed++; console.log('  PASS  ' + name);
  } catch (e) {
    failed++;
    console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').slice(0, 8).join('\n        '));
  }
}

// ===========================================================================
console.log('== Modell 1: Kalibrier-Zustandsautomat ==');
// ===========================================================================
// Modell haelt nur, WELCHE Punkte unter WELCHEM Schluessel liegen. Was daraus
// an slope/offset folgt, liefert das echte computeCalib2().

const KAMERAS = ['user', 'environment'];
const PROFILE = ['SUNLIGHT', 'LED_GROW', 'SODIUM_HPS', 'AUTO'];

const schluessel = (cam, prof) => cam + '|' + prof;

function pruefeGleichstand(m, api, wo) {
  // Erwartung aus dem Modell ableiten - exakt die Rangfolge aus loadCalib():
  // profilspezifisch, dann profil-unabhaengiger Legacy, dann reiner Faktor.
  const spez = m.slots.get(schluessel(m.camera, m.profile));
  const legacy = m.legacy.get(m.camera);
  const faktor = m.v2.get(m.camera);
  let erwartet = null, erwarteterScope = false, erwartetePunkte = null;
  const fit = (d) => d ? api.computeCalib2(d.p1 || null, d.p2 || null) : null;

  if (fit(spez)) { erwartet = fit(spez); erwartetePunkte = spez; }
  else if (fit(legacy)) { erwartet = fit(legacy); erwarteterScope = true; erwartetePunkte = legacy; }
  else if (faktor !== undefined && faktor > 0) {
    erwartet = { slope: faktor, offset: 0, points: 1 }; erwarteterScope = true; erwartetePunkte = null;
  }

  if (erwartet === null) {
    assert.strictEqual(api.customCalibFactor, null, wo + ': erwartet unkalibriert');
    assert.strictEqual(api.calibFit, null, wo + ': calibFit muesste null sein');
    return;
  }
  assert.ok(api.customCalibFactor !== null, wo + ': erwartet kalibriert');
  assert.ok(Math.abs(api.customCalibFactor - erwartet.slope) < 1e-9,
    wo + ': slope ' + api.customCalibFactor + ' != ' + erwartet.slope);
  assert.ok(Math.abs(api.calibOffset - erwartet.offset) < 1e-6, wo + ': offset');
  assert.strictEqual(api.calibPoints, erwartet.points, wo + ': Punktzahl');
  assert.strictEqual(api.calibLegacyScope, erwarteterScope, wo + ': Geltungsbereich-Flag');
  // v3.4.11: auch der reine Faktor muss einen Fit haben, sonst behauptet
  // calibRangeStatus 'uncalibrated' obwohl kalibriert.
  assert.ok(api.calibFit !== null, wo + ': calibFit fehlt trotz Kalibrierung');
  const bereich = api.calibRangeStatus(500, api.calibP1, api.calibP2, api.calibFit).state;
  assert.notStrictEqual(bereich, 'uncalibrated', wo + ': Bereich widerspricht der Kalibrierung');
  if (erwartetePunkte) {
    assert.ok(api.calibP1 !== null, wo + ': Stuetzstellen nicht mitgefuehrt');
  } else {
    assert.strictEqual(api.calibP1, null, wo + ': Faktor ohne Punkte darf keine vortaeuschen');
  }
}

class CmdKalibrieren {
  constructor(raw, ref) { this.raw = raw; this.ref = ref; }
  check() { return true; }
  run(m, r) {
    r.api.currentRawPPFDUncalibrated = this.raw;
    r.api.currentSignalLevel = 'ok';
    r.api.lastFrameSnapshot = { clipLevel: 'ok' };
    r.document.getElementById('refPPFD').value = String(this.ref);
    r.api.applyCalibration();

    // Modell: dieselben Torwaechter wie applyCalibration()
    const k = schluessel(m.camera, m.profile);
    if (this.ref > 0 && this.raw >= 5) {
      const alt = m.slots.get(k);
      const pt = { raw: this.raw, ref: this.ref };
      const neu = (!alt || !alt.p1) ? { p1: pt, p2: null } : { p1: alt.p1, p2: pt };
      if (r.api.computeCalib2(neu.p1, neu.p2)) {
        m.slots.set(k, neu);
        m.legacy.delete(m.camera);   // applyCalibration raeumt beide Legacy-Generationen
        m.v2.delete(m.camera);
      }
    }
    pruefeGleichstand(m, r.api, 'nach Kalibrieren');
  }
  toString() { return `Kalibrieren(raw=${this.raw},ref=${this.ref})`; }
}

class CmdProfilWechseln {
  constructor(p) { this.p = p; }
  check() { return true; }
  run(m, r) {
    m.profile = this.p;
    r.api.manualLightKey = this.p;
    r.api.loadCalib();
    pruefeGleichstand(m, r.api, 'nach Profilwechsel auf ' + this.p);
  }
  toString() { return `ProfilWechseln(${this.p})`; }
}

class CmdKameraWechseln {
  check() { return true; }
  run(m, r) {
    m.camera = m.camera === 'user' ? 'environment' : 'user';
    r.api.cameraFacing = m.camera;
    r.api.loadCalib();
    pruefeGleichstand(m, r.api, 'nach Kamerawechsel');
  }
  toString() { return 'KameraWechseln()'; }
}

class CmdZuruecksetzen {
  check() { return true; }
  run(m, r) {
    r.api.resetCalibration();
    // v3.4.8: ALLE Profile der aktuellen Kamera, die andere bleibt unberuehrt.
    for (const p of PROFILE) m.slots.delete(schluessel(m.camera, p));
    m.legacy.delete(m.camera);
    m.v2.delete(m.camera);
    pruefeGleichstand(m, r.api, 'nach Zuruecksetzen');
  }
  toString() { return 'Zuruecksetzen()'; }
}

class CmdNeuLaden {
  check() { return true; }
  run(m, r) {
    // Idempotenz: loadCalib() darf den Zustand nicht veraendern.
    const vorher = [r.api.customCalibFactor, r.api.calibOffset, r.api.calibPoints, r.api.calibLegacyScope];
    r.api.loadCalib();
    const nachher = [r.api.customCalibFactor, r.api.calibOffset, r.api.calibPoints, r.api.calibLegacyScope];
    assert.deepStrictEqual(nachher, vorher, 'loadCalib() ist nicht idempotent');
    pruefeGleichstand(m, r.api, 'nach Neuladen');
  }
  toString() { return 'NeuLaden()'; }
}

const kalibrierBefehle = [
  fc.tuple(fc.double({ min: 0, max: 2000, noNaN: true }), fc.double({ min: 0.1, max: 2000, noNaN: true }))
    .map(([raw, ref]) => new CmdKalibrieren(raw, ref)),
  fc.constantFrom(...PROFILE).map(p => new CmdProfilWechseln(p)),
  fc.constant(new CmdKameraWechseln()),
  fc.constant(new CmdZuruecksetzen()),
  fc.constant(new CmdNeuLaden())
];

modell('Beliebige Befehlsfolgen halten Modell und Modul-Zustand gleich',
  kalibrierBefehle, () => {
    const r = neueApp();
    r.api.cameraFacing = 'user'; r.api.manualLightKey = 'SUNLIGHT'; r.api.loadCalib();
    return { model: { slots: new Map(), legacy: new Map(), v2: new Map(), camera: 'user', profile: 'SUNLIGHT' }, real: r };
  });

modell('Dasselbe, ausgehend von einem Altbestand (Legacy + reiner Faktor)',
  kalibrierBefehle, () => {
    // Startzustand wie bei einem Nutzer, der seit v3.3.x nicht neu kalibriert
    // hat: profil-unabhaengiger Eintrag fuer eine Kamera, reiner Faktor fuer
    // die andere. Genau die Konstellation, in der v3.4.11 den Fit vergass.
    const r = neueApp();
    r.store['ppfd_calib2_v1_user'] = JSON.stringify({ p1: { raw: 200, ref: 300 }, p2: null });
    r.store['ppfd_calibFactor_v2_environment'] = '2.5';
    r.api.cameraFacing = 'user'; r.api.manualLightKey = 'SUNLIGHT'; r.api.loadCalib();
    return {
      model: {
        slots: new Map(),
        legacy: new Map([['user', { p1: { raw: 200, ref: 300 }, p2: null }]]),
        v2: new Map([['environment', 2.5]]),
        camera: 'user', profile: 'SUNLIGHT'
      }, real: r
    };
  }, { maxCommands: 30 });

// ===========================================================================
console.log('== Modell 2: AppStatusStateMachine ==');
// ===========================================================================
// Hier bildet das Modell die dokumentierten Regeln nach - Abweichung heisst,
// dass Code und Dokumentation auseinanderlaufen. Zusaetzlich werden
// Uebergaenge auf Legalitaet geprueft, was ohne Nachbau auskommt.

const LEGAL = {
  WARMUP: ['WARMUP', 'STABLE'],
  STABLE: ['STABLE', 'CLIPPING', 'FLICKER', 'LOW_PERF', 'WARMUP'],
  FLICKER: ['FLICKER', 'CLIPPING', 'STABLE', 'WARMUP'],
  CLIPPING: ['CLIPPING', 'STABLE', 'WARMUP'],
  LOW_PERF: ['LOW_PERF', 'CLIPPING', 'FLICKER', 'STABLE', 'WARMUP']
};

class CmdFrame {
  constructor(warm, flick, clip, fps, fresh) {
    this.warm = warm; this.flick = flick; this.clip = clip; this.fps = fps; this.fresh = fresh;
  }
  check() { return true; }
  run(m, fsm) {
    const vorher = fsm.current.id;
    const s = fsm.update(this.warm, this.flick, this.clip, this.fps, this.fresh);

    // (a) Nur legale Uebergaenge
    assert.ok(LEGAL[vorher].includes(s.id), `Uebergang ${vorher} -> ${s.id} ist nicht vorgesehen`);

    // (b) Akkumulatoren nach den dokumentierten Regeln fortschreiben
    if (!this.warm) { m.state = 'WARMUP'; }
    else {
      if (this.fresh) m.flicker = this.flick ? Math.min(fsm.CAPS.flicker, m.flicker + 1) : Math.max(0, m.flicker - 1);
      m.clipping = this.clip ? Math.min(fsm.CAPS.clipping, m.clipping + 1) : Math.max(0, m.clipping - 1);
      m.perf = (this.fps < 18) ? Math.min(fsm.CAPS.perf, m.perf + 1) : Math.max(0, m.perf - 1);
    }
    assert.strictEqual(fsm.acc.flicker, m.flicker, 'Flicker-Akkumulator weicht ab');
    assert.strictEqual(fsm.acc.clipping, m.clipping, 'Clipping-Akkumulator weicht ab');
    assert.strictEqual(fsm.acc.perf, m.perf, 'FPS-Akkumulator weicht ab');

    // (c) Deckel werden nie ueberschritten
    assert.ok(m.flicker <= fsm.CAPS.flicker && m.clipping <= fsm.CAPS.clipping && m.perf <= fsm.CAPS.perf,
      'Akkumulator ueber dem Deckel');

    // (d) Kernzusage der Hysterese aus v3.4.5: ohne frisches Detektionsergebnis
    //     darf sich der Flicker-Akkumulator NICHT bewegen. Vorher zaehlte
    //     dasselbe Ergebnis ~60x pro Sekunde und die Hysterese war wirkungslos.
    if (this.warm && !this.fresh) {
      assert.strictEqual(fsm.acc.flicker, m.flicker, 'abgelaufener Frame hat mitgezaehlt');
    }

    // (e) FLICKER kann nur erreicht werden, wenn der Akkumulator die Schwelle hat
    if (s.id === 'FLICKER') {
      assert.ok(fsm.acc.flicker >= fsm.LIMITS.FLICKER_ENTER || vorher === 'FLICKER',
        'FLICKER ohne erreichte Schwelle');
    }
    // (f) CLIPPING gewinnt gegen alles ausser WARMUP
    if (this.warm && fsm.acc.clipping >= fsm.LIMITS.CLIP_ENTER) {
      assert.strictEqual(s.id, 'CLIPPING', 'Clipping muss Vorrang haben');
    }
    m.state = s.id;
  }
  toString() {
    return `Frame(warm=${this.warm},flick=${this.flick},clip=${this.clip},fps=${this.fps},fresh=${this.fresh})`;
  }
}

const fsmBefehle = [
  fc.tuple(
    fc.boolean(), fc.boolean(), fc.boolean(),
    fc.constantFrom(5, 12, 17, 18, 30, 60),
    fc.boolean()
  ).map(([w, f, c, fps, fr]) => new CmdFrame(w, f, c, fps, fr)),
  // Ueberwiegend "normale" Frames, damit lange Laeufe auch mal stabil werden
  fc.constant(new CmdFrame(true, false, false, 60, true)),
  fc.constant(new CmdFrame(true, true, false, 60, true))
];

modell('Beliebige Frame-Folgen: nur legale Uebergaenge, Akkumulatoren wie dokumentiert',
  fsmBefehle, () => {
    const app = neueApp();
    return {
      model: { flicker: 0, clipping: 0, perf: 0, state: 'WARMUP' },
      real: new app.api.AppStatusStateMachine()
    };
  }, { maxCommands: 200 });

console.log(`\n${passed} passed, ${failed} failed  (je ${RUNS} Befehlsfolgen)`);
process.exit(failed ? 1 : 0);
