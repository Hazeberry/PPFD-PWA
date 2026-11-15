# CI: Tests und Browserlauf automatisch ausführen

**Stand:** Das Repo hat keine CI. Es gibt keinen Ordner `.github/workflows`, und PRs bekommen keine Check-Runs. `npm test` läuft nur lokal, wenn jemand daran denkt. Der Browserlauf in Chromium (siehe unten) lief bisher ebenfalls nur lokal, in einer Cloud-Sitzung, und das Skript dafür liegt nicht im Repo.

Diese Datei beschreibt, wie beides auf GitHub Actions laufen soll. **Nichts davon ist auf einem GitHub-Runner ausprobiert.** Die YAML-Datei unten ist ein Entwurf; getestet ist nur der Browserlauf mit denselben Flags lokal.

## 1. Node-Tests

Alle Harnesses laufen ohne Browser. `test_properties.js` und `test_model.js` brauchen `fast-check` (`npm install`), die übrigen sechs keine Abhängigkeit (`npm run test:nodeps`). Im Stand von v3.4.27: 8 Suites, 351 Tests.

## 2. Browserlauf in Chromium

### Installation auf dem Runner

```bash
npx playwright install --with-deps chromium
```

`--with-deps` installiert zusätzlich die Systembibliotheken, die Chromium auf einem frischen Ubuntu-Runner braucht. Ohne diese Option startet der Browser dort oft nicht. Playwright als Entwicklungsabhängigkeit aufnehmen und die Version festlegen (lokal geprüft mit 1.63.0), damit die Chromium-Version nicht unbemerkt wandert.

### Chromium-Flags für die Test-Kamera

```
--use-fake-device-for-media-stream
--use-fake-ui-for-media-stream
```

- `--use-fake-device-for-media-stream`: Chromium stellt statt einer echten Kamera ein Testbild bereit, sodass `getUserMedia({video:true})` auch auf einem Runner ohne Kamera funktioniert.
- `--use-fake-ui-for-media-stream`: unterdrückt den Berechtigungsdialog.

Beides ist nötig. Zusätzlich im Browser-Kontext `permissions: ['camera']` setzen.

```js
const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const context = await browser.newContext({
  viewport: { width: 412, height: 915 },
  permissions: ['camera'],
});
```

### Lokaler HTTP-Server

Die Seite nicht über `file://` öffnen. Kamera und Service Worker brauchen einen sicheren Kontext; `http://localhost:<Port>` zählt als solcher. Ein kleiner Node-`http`-Server, der die Dateien des Repos ausliefert, reicht (Port `0`, damit das Betriebssystem einen freien vergibt).

### Was die Test-Kamera meldet

Beobachtet in lokalen Läufen (Chromium mit Playwright 1.63.0):

| Eigenschaft | Wert |
|---|---|
| `exposureMode` | `manual`, `continuous` |
| `exposureTime` | 10–100 (Einheit 100 µs), Start 50 |
| `iso` | nicht gemeldet |
| `frameRate` | 20 |

Daraus folgt: Die App startet im Hardware-Modus **Manuell** und zeigt „· ISO nicht gemeldet“ (nur Hinweis, kein Platzhalter). Start bis zum ersten Messwert dauerte lokal rund 7 s (Belichtungs-Tuning plus 300 Frames Einschwingen). Entsprechend großzügig warten, z. B. 40 s Zeitlimit.

### Platzhalter-Zustand (Gerät ohne Belichtungs-/ISO-Meldung)

Den Fall „Kamera meldet nichts“ erzeugt man, indem man vor dem Laden der Seite die Kamera-Schnittstelle kürzt:

```js
await context.addInitScript(() => {
  const strip = o => { const c = { ...o };
    for (const k of ['exposureMode','exposureTime','iso','whiteBalanceMode','colorTemperature','exposureCompensation']) delete c[k];
    return c; };
  const gc = MediaStreamTrack.prototype.getCapabilities, gs = MediaStreamTrack.prototype.getSettings;
  MediaStreamTrack.prototype.getCapabilities = function () { return strip(gc.call(this)); };
  MediaStreamTrack.prototype.getSettings = function () { return strip(gs.call(this)); };
});
```

Erwartet: Hardware-Modus „Software (no-manual-control)“, Abzeichen „Nur Platzhalter – keine Messung“, in der Unsicherheitszeile „Keine Messung: …“, Kalibrieren abgelehnt (Meldung im Toast, kein Eintrag `ppfd_calib…` in `localStorage`).

### Was geprüft werden soll

Jeweils nach dem Einschwingen:

1. **Keine JavaScript-Fehler** (`pageerror` und `console.error` sammeln). Die Warnung „Wake Lock nicht verfügbar“ (`console.warn` der App) ist in headless Chromium zu erwarten und harmlos.
2. **Erste angezeigte Werte** liegen beieinander. Bis v3.4.26 lief die Anzeige nach dem Einschwingen von fast 0 hoch (`11 15 15 15 … 17`), seit v3.4.27 beginnt sie beim Messwert (`17 17 17`). Das fängt eine Rückkehr des Fehlers.
3. **Hardware-Modus** und **Debug-Zeile** (`#debugExpVal`) entsprechen der Test-Kamera.
4. **Service Worker** registriert, Cache `ppfd-v<Version>` vorhanden und gleich der Version im Titel.
5. **Platzhalter-Lauf** wie oben.

Nützliche Elemente: `#ppfdVal`, `#zoneBadge`, `#uncertaintyVal`, `#calibRangeVal`, `#hardwareVal`, `#debugExpVal`, `#errorToast`, Start über `#startBtn`.

### Grenzen

Die Test-Kamera liefert ein Testbild (bewegte Muster), keine definierte Lichtstärke. Geprüft werden kann damit der **Ablauf** (Start, Modus, Anzeige, Sperren, Service Worker), nicht die Genauigkeit eines Messwerts. Das Verhalten echter Handykameras (Punkt 1 in `HANDOFF.md`) ersetzt es nicht.

## 3. Entwurf der Workflow-Datei

Als `.github/workflows/test.yml` anlegen. Ungetestet.

```yaml
name: Tests
on:
  pull_request:
  push:
    branches: [main]

jobs:
  node:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test

  browser:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: node tests/test_browser.js
```

Zu klären, wenn es umgesetzt wird:

- Aktions-Versionen (`actions/checkout`, `actions/setup-node`) auf die dann aktuelle Hauptversion festlegen und prüfen.
- `tests/test_browser.js` gibt es noch nicht (`HANDOFF.md`, Punkt 12). Er muss mit Exit-Code ≠ 0 enden, wenn eine Prüfung fehlschlägt.
- Playwright als `devDependency` in `package.json` aufnehmen, dann braucht `npm ci` die Lock-Datei auf dem neuesten Stand.
- `npm ci` lädt nur Abhängigkeiten; das Chromium selbst kommt erst durch `playwright install`.
- Soll der Browser-Job den PR blockieren, in den Branch-Schutzregeln als erforderlicher Check eintragen. Sonst bleibt er eine Auskunft.
- Bei Fehlern den Browserlauf mit `--trace on` wiederholen; nur dann lohnt sich der Aufwand der Trace-Dateien.

## 4. Reihenfolge

1. `tests/test_browser.js` schreiben und lokal grün bekommen.
2. Workflow mit nur dem `node`-Job anlegen und im PR prüfen.
3. `browser`-Job ergänzen.
4. Erst danach Checks als erforderlich markieren.
