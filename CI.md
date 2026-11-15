# CI: Tests und Browserlauf automatisch ausführen

**Stand:** `.github/workflows/test.yml` führt die Node-Tests und den Chromium-Browser-Test bei Pull Requests und Pushes auf `main` aus. Manuelles Starten ist über `workflow_dispatch` möglich, sobald der Workflow auf dem Standardbranch liegt.

Die Fake-Kamera stammt aus Chromium. Sie läuft ausschließlich im Testbrowser und benötigt weder eine echte Kamera noch einen Anthropic-Zugang.

## 1. Node-Tests

Alle Harnesses laufen ohne Browser. `test_properties.js` und `test_model.js` brauchen `fast-check` (`npm install`), die übrigen sechs keine Abhängigkeit (`npm run test:nodeps`). Im Stand von v3.4.27: 8 Suites, 351 Tests.

## 2. Browserlauf in Chromium

### Installation auf dem Runner

```bash
npx playwright install --with-deps chromium
```

`--with-deps` installiert zusätzlich die Systembibliotheken, die Chromium auf einem frischen Ubuntu-Runner braucht. Ohne diese Option startet der Browser dort oft nicht. Playwright ist als Entwicklungsabhängigkeit auf 1.63.0 festgelegt; die Lock-Datei wird mitgeführt.

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

### Was `tests/test_browser.js` prüft

Jeweils nach dem Einschwingen:

1. **Keine JavaScript-Fehler** (`pageerror` und `console.error` sammeln). Die Warnung „Wake Lock nicht verfügbar“ (`console.warn` der App) ist in headless Chromium zu erwarten und harmlos.
2. **Erste angezeigte Werte** liegen beieinander. Bis v3.4.26 lief die Anzeige nach dem Einschwingen von fast 0 hoch (`11 15 15 15 … 17`), seit v3.4.27 beginnt sie beim Messwert (`17 17 17`). Das fängt eine Rückkehr des Fehlers.
3. **Hardware-Modus** und **Debug-Zeile** (`#debugExpVal`) entsprechen der Test-Kamera.
4. **Service Worker** registriert, Cache `ppfd-v<Version>` vorhanden und gleich der Version im Titel.
5. **Platzhalter-Lauf** wie oben.

Nützliche Elemente: `#ppfdVal`, `#zoneBadge`, `#uncertaintyVal`, `#calibRangeVal`, `#hardwareVal`, `#debugExpVal`, `#errorToast`, Start über `#startBtn`.

### Grenzen

Die Test-Kamera liefert ein Testbild (bewegte Muster), keine definierte Lichtstärke. Geprüft werden kann damit der **Ablauf** (Start, Modus, Anzeige, Sperren, Service Worker), nicht die Genauigkeit eines Messwerts. Das Verhalten echter Handykameras (Punkt 1 in `HANDOFF.md`) ersetzt es nicht.

## 3. Ausführen

```bash
npm ci
npm test
npx playwright install --with-deps chromium
npm run test:browser
```

Die verbindliche Workflow-Datei ist `.github/workflows/test.yml`. Beide Jobs verwenden Node.js 22, `actions/checkout@v7` und `actions/setup-node@v7`, npm-Caching und ein Zeitlimit von zehn Minuten. Neue Läufe brechen ältere Läufe desselben PRs ab.

Der Browser-Test startet einen lokalen HTTP-Server und zwei getrennte Browser-Kontexte. Bei einem Fehler endet er mit einem Fehlercode und schreibt den Seiteninhalt ins Job-Log. Browser und Server werden anschließend geschlossen. Die ersten zehn numerischen Anzeigewerte werden erfasst; der erste muss innerhalb von 20 % ihres Medians liegen. Das prüft den Anzeigeanlauf, nicht die Messgenauigkeit.

## 4. Prüfnachweis und Grenzen

Die Node-Tests wurden bei der Einrichtung lokal erfolgreich ausgeführt (Node.js 24). Der lokale Browserlauf war durch die Ausführungsumgebung blockiert: Der Playwright-Browserdownload lieferte kein gültiges Archiv; der vorhandene Systembrowser durfte seinen Prozess-Socket nicht öffnen. Der maßgebliche Nachweis für Node.js 22 und den gepinnten Chromium-Browser ist deshalb der GitHub-Actions-Lauf im PR.

Die Checks sind nicht automatisch als verpflichtender Branch-Schutz eingerichtet. Ein erfolgreicher Browser-Test ersetzt keine Prüfung mit einer echten Handykamera.
