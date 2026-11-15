# Handoff: offene Punkte nach v3.4.27

Stand: Branch `claude/ppfd-calibration-validation-urvwbh`, PR #26 (noch nicht gemerged). Basis ist `main` mit v3.4.26 (PR #25).

Diese Datei sammelt, was **bewusst nicht** erledigt wurde, und warum. Was in v3.4.22–27 behoben ist, steht in den PR-Beschreibungen von #25 und #26 sowie im README; hier geht es nur um das, was noch offen ist. Zeilennummern beziehen sich auf `index.html` im Stand dieses Commits und verschieben sich mit jeder Änderung – im Zweifel nach dem Funktionsnamen suchen.

## Kurzüberblick

| # | Punkt | Art | Braucht |
|---|---|---|---|
| 1 | Keine Prüfung mit echter Handykamera | Validierung | Geräte |
| 2 | Konstanten und Gewichte unbelegt | Validierung | PAR-Meter, ≥ 10 Sitzungen |
| 3 | −2-%-Stufe bei 1/30 s | Messfehler (klein) | Entscheidung |
| 4 | Schwarzwert nach dem Kalibrieren | Messfehler (klein) | Umsetzung |
| 5 | Manuell-Nachweis in der Rampe | Fehlklassifikation (selten) | Entscheidung + Gerät |
| 6 | Manuell-Modus ohne ISO-Steuerung | ungeklärt | Gerät |
| 7 | Trainingspunkte sind Einzelbilder | Inkonsistenz | Umsetzung |
| 8 | Schwellwerte ohne Datenbasis | Annahmen | Daten |
| 9 | Zwei-Punkt-Gerade ist linear | Modellgrenze | Daten |
| 10 | Bekannte Grenzen 2–5 im README | Produktentscheidungen | Entscheidung |
| 11 | Auswertung: Zuordnung alter Punkte | Datenqualität | – |
| 12 | Browser-Test liegt nicht im Repo | Werkzeug | Umsetzung |

---

## 1. Keine Prüfung mit echter Handykamera

**Stand:** Alles ist mit dem echten Skript gegen simulierte Kameras (`tests/test_messablauf.js`) und einmal in headless Chromium mit dessen Test-Kamera geprüft. Die Test-Kamera meldet Manuell-Modus und Belichtungszeit, aber keine ISO. Ein echtes Gerät hat nie mitgespielt.

**Am dringendsten zu prüfen**, weil v3.4.22–27 dort das Verhalten geändert haben:

- **Android mit manueller Belichtung** (z. B. Galaxy A17, der Feldfall aus den Code-Kommentaren): Erscheint weiterhin „Manuell“? Seit v3.4.26 braucht das einen Beleg (Modus `manual` gemeldet, gemeldete Zeit = angeforderte, oder gemeldete Zeit folgt nachweislich). Der Debug-Trail sollte `(verifyS…)` oder eine Rampe zeigen. Fällt das Gerät jetzt auf `exposure-mode-unconfirmed`, ist die Belegregel zu streng.
- **iPhone (Safari):** Erwartet ist der Platzhalter-Zustand („Nur Platzhalter – keine Messung“, Kalibrieren gesperrt). Das ist eine Annahme über die Kamera-Schnittstelle von Safari, nicht geprüft. Wenn iOS Belichtung und ISO doch meldet, misst die App dort normal.
- **Android ohne manuelle Belichtung:** Meldet es Belichtung und ISO im Auto-Modus? Wenn ja: normale Messung im Software-Modus. Wenn nein: Platzhalter.
- **Erster Wert nach dem Einschwingen:** sollte sofort der Messwert sein, kein Hochlaufen.
- **Kalibrieren:** braucht jetzt ~1 s ruhigen Wert (Median über 31 Frames). Prüfen, ob die Sperre „Messwert schwankt noch“ unter echten LED-Lampen mit PWM zu oft greift (Schwelle 20 %, siehe Punkt 8).

**Was festhalten:** Gerätename, Hardware-Modus-Zeile, Debug-Zeile (`Debug: Exposure raw`), Text der Unsicherheitszeile, ob Kalibrieren möglich war. Ein CSV-Export mit ein paar Punkten reicht; die Spalten `belichtungGemeldet`, `isoGemeldet`, `hardwareMode`, `fallbackMode` beantworten die meisten Fragen.

## 2. Konstanten und Gewichte sind nicht gegen Referenzmessungen belegt

**Betrifft:** Skalenkonstante 1284 und die ISO-Stützwerte 1,00/0,95/0,88 (`getDynamicCalibrationConstant`, `isoCalibFactor`), PAR-Kanalgewichte (`calculatePARFromLinear`), Profilfaktoren und nominale Unsicherheiten `u` (`LIGHT_PROFILES`), `U_CAL_CALIBRATED` = 0,05.

**Folge:** Die absolute Skala hängt vollständig an der Nutzer-Kalibrierung. Die angezeigte Unsicherheit (k = 2) beruht auf gesetzten Teilbeiträgen; eine Trefferquote von ~95 % ist nicht belegt. Das README sagt das inzwischen auch so.

**Weg:** Referenzmessungen gegen ein PAR-Meter über mehrere Helligkeiten und Lichtquellen sammeln (Trainingsdaten → CSV) und mit `node tools/auswertung.js export.csv` auswerten. Die Auswertung zählt die Abdeckung der Unsicherheit und vergleicht Korrekturmodelle mit GroupKFold nach Sitzung. **Belastbar ab ~10 Sitzungen**; eine Sitzung = Kamera stoppen, Diffusor neu anlegen, neu starten, 3–5 Punkte bei unterschiedlicher Helligkeit.

**Nicht tun:** Konstanten „verbessern“, ohne solche Daten. Jede Änderung verschiebt die Rohwert-Basis und entwertet bestehende Kalibrierungen (siehe Punkt 3 zur Kennzeichnung).

## 3. −2-%-Stufe bei Belichtungen länger als 1/30 s

**Wo:** `getDynamicCalibrationConstant`, `if(exposureTime>1/30) c*=0.98;` (~Zeile 1442).

**Problem:** Dieselbe Art Sprung, die bei der ISO in v3.4.22 entfernt wurde: Bei 1/30 s springt der Messwert um 2 %. Ungünstig liegt die Stufe genau dort, wo eine 30-fps-Kamera im Schwachlicht stehen bleibt – der Wert kann im Auto-Modus zwischen zwei Belichtungszeiten hin- und herspringen. Der Faktor selbst ist ein Platzhalter ohne Herkunft.

**Optionen:**
- (a) Lassen. 2 % liegen unter jeder angezeigten Unsicherheit.
- (b) Glätten (z. B. linear in log₂(t) über eine Oktave). Ändert die Rohwert-Basis für Belichtungen um 1/30 s. Dann `ISO_MODEL` auf 3 setzen (besser umbenennen in ein allgemeines „Rohwert-Modell“), `isoModelShift` um den Belichtungsanteil erweitern und die Altkalibrierungs-Warnung entsprechend erweitern. Seit v3.4.27 speichern Kalibrierpunkte ISO **und** Belichtungszeit (`pt.iso`, `pt.exp`), damit lässt sich ein Punkt exakt umrechnen statt nur kennzeichnen.
- (c) Ganz streichen. Gleiche Folgen wie (b).

**Empfehlung:** (a), bis Referenzdaten zeigen, ob überhaupt ein belichtungsabhängiger Faktor nötig ist. Nur zusammen mit Punkt 2 anfassen.

## 4. Schwarzwert messen oder löschen nach dem Kalibrieren

**Wo:** `measureBlackLevel`, `resetBlackLevel`; Kalibrierpunkte in `applyCalibration`.

**Problem:** Der Schwarzwert wird von jedem Pixel abgezogen, bevor der Rohwert entsteht. Misst oder löscht man ihn nach dem Kalibrieren, ändert sich die Rohwert-Basis, die Kalibrierung gilt aber unverändert weiter – ohne Hinweis. Der Effekt ist klein bei hellem Licht und wird bei schwachem Licht relevant (Schwarzwert-Grenze 0,02 linear gegen ein Signal von z. B. 0,04).

**Umsetzungsvorschlag:** Den aktiven Schwarzwert (Y-gewichtet, `blackLevelLin`) mit jedem Kalibrierpunkt speichern. Weicht der aktuelle um mehr als einen Bruchteil davon ab, in der Unsicherheitszeile „Schwarzwert seit Kalibrierung geändert – neu kalibrieren“ zeigen. Alternativ beim Messen/Löschen des Schwarzwerts eine Bestätigung verlangen, wenn eine Kalibrierung existiert. Aufwand klein; Test in `test_messablauf.js` ergänzen.

## 5. Manuell-Nachweis in der Rampe kann von der Kamera-Automatik kommen

**Wo:** `tuneExposure` (Rampe), `rampReactionObserved`.

**Problem:** Als Beleg zählt seit v3.4.24 nur die *gemeldete* Belichtungszeit, die sich nach einem Stellbefehl richtungskonsistent um > 20 % bewegt. Eine Kamera, die Befehle ignoriert, aber in Auto-Belichtung gerade in dieselbe Richtung nachregelt (z. B. weil die Szene beim Start dunkel ist und die App die Zeit verlängert anfordert), liefert genau dieses Muster. Dann gilt sie als „Manuell“, obwohl sie es nicht ist.

**Abfederung heute:** Der Drift-Check (alle 60 Frames, 3 Strikes, > 15 % Abweichung) schaltet beim nächsten Lichtwechsel auf Software-Modus zurück. Bis dahin ist der Wert richtig, solange die Kamera die gemeldete Zeit nicht weiter ändert – die Formel teilt durch die gemeldete Zeit.

**Option:** Nach einer Rampe zusätzlich den Verify-Schritt fahren (stören ×2/÷2, zurückstellen, gemeldete Zeit muss beiden Befehlen folgen). Zwei gegenläufige Befehle, beide befolgt, schließen gleichgerichtetes Nachregeln praktisch aus. Kostet `VERIFY_COST_MS` ≈ 1,6 s Startzeit; das Zeitbudget von `tuneExposure` (8 s) und der 15-s-Watchdog in `startCamera` müssen das tragen – `tests/test_exposure_budget.js` prüft genau das und muss mitwachsen.

**Empfehlung:** Erst nach Punkt 1 entscheiden. Wenn echte Geräte nie in diesen Fall laufen, ist die Startzeit wertvoller.

## 6. Manuell-Modus ohne ISO-Steuerung

**Wo:** `applyHardwareConstraints` (`if(cap.iso) constraints.iso=…`), `exposureStatus`.

**Problem:** Bietet eine Kamera manuelle Belichtungszeit, aber keine ISO-Steuerung an, setzt die App keine ISO. Meldet sie die ISO auch nicht, rechnet die Formel mit dem Startwert (`getSettings()` beim Start, sonst 100). Ob eine Kamera in diesem Zustand die ISO selbst nachregelt, ist **ungeprüft**. Wenn ja, ist der Wert dort ähnlich lichtunabhängig wie im Platzhalter-Zustand; die App behandelt es aber nur als Hinweis („· ISO nicht gemeldet“), Kalibrieren bleibt möglich.

**Weg:** An einem Gerät mit diesem Profil (Test-Kamera von Chromium hat es: Manuell-Modus, keine ISO) mit echtem Licht prüfen, ob der Wert bei halbem Licht auf etwa die Hälfte fällt. Wenn nicht: `exposureStatus` so ändern, dass `!isoReported && !constraints.iso` auch im Manuell-Modus als Platzhalter gilt. Dazu müsste `applyHardwareConstraints` festhalten, ob die ISO gesetzt wurde (z. B. `result.isoControlled`).

## 7. Trainingspunkte sind weiterhin Einzelbilder

**Wo:** `saveTrainPoint` übernimmt `lastFrameSnapshot` (den letzten Frame). Kalibrieren nutzt seit v3.4.27 den Median der letzten 31 gültigen Frames (`calibRawMedian`).

**Problem:** Dieselben Gründe, die bei der Kalibrierung zum Median geführt haben (Ausreißer-Frames, Abfrage-Verzug der Belichtung im Software-Modus, PWM-Flackern), gelten für Trainingspunkte. Für die Auswertung ist es weniger kritisch, weil viele Punkte gemittelt werden; ein einzelner falscher Punkt verzerrt aber den Modellvergleich einer kleinen Sitzung.

**Umsetzungsvorschlag:** `rawPPFDUncalibrated` im Trainingspunkt durch `calibRawValue()` ersetzen (mit denselben Sperren: Fenster voll, Spanne ≤ `CALIB_RAW_MAX_SPREAD`) und den Einzelframe zusätzlich als `rawPPFDFrame` behalten. Die Farbanteile (`avgR_lin` …) bleiben Einzelbild-Werte; für die Chromatizität reicht das. `tools/auswertung.js` braucht keine Änderung, wenn der Spaltenname gleich bleibt – dann aber im CSV kennzeichnen, ab welcher Version es der Median ist.

## 8. Schwellwerte ohne Datenbasis

Alle in v3.4.22–27 neu gesetzt, begründet, aber nicht aus Messdaten abgeleitet:

| Konstante | Wert | Wirkung | Risiko bei falscher Wahl |
|---|---|---|---|
| `AFFINE_GAIN_LIMIT` | 5 | ab hier Unsicherheit „nicht quantifizierbar“ | zu klein: Hinweis erscheint schon weit vor der Null-Zone |
| `CALIB_RAW_WINDOW` | 31 Frames | Fenster für den Kalibrier-Median | zu groß: Kalibrieren fühlt sich träge an |
| `CALIB_RAW_MAX_SPREAD` | 0,20 | Sperre „Messwert schwankt noch“ | zu klein: unter PWM-LEDs nie kalibrierbar |
| `ISO_SHIFT_NOTICE` | 0,005 | ab hier Warnung zur Altkalibrierung | unkritisch |
| `rampReactionObserved` / `verifyReactionObserved` | > 20 % bzw. > 2 Einheiten | Manuell-Beleg | zu groß: quantisierende Treiber gelten nicht als manuell |

`Q_GATE_HOLD` (0,35) und die Q-Rampen sind älter und im Code ausführlich begründet, aber ebenso nicht gegen Daten geprüft.

**Weg:** Mit Punkt 1 (echte Geräte) prüfen, ob die Sperren im Alltag zu oft greifen. Die Zahlen stehen jeweils an einer Stelle; Tests in `tests/test_pipeline.js` binden manche an die Kommentare (z. B. Q-Gate), die müssen dann mitgeändert werden.

## 9. Zwei-Punkt-Kalibrierung ist eine Gerade

**Stand:** `computeCalib2` legt Steigung und Offset fest. Eine gekrümmte Kennlinie (Tonkurve des Handys, HDR, Sättigung) gleicht das nur zwischen den beiden Punkten näherungsweise aus. Die sRGB-Umkehr ist exakt, garantiert aber keine radiometrisch linearen Pixel. Texte im Dialog, README und Kommentar sagen das seit v3.4.27 korrekt.

**Wenn Daten es zeigen:** `tools/auswertung.js` vergleicht schon ein Modell „Faktor + Helligkeit“ (log-linear). Schlägt es den globalen Faktor belastbar über Sitzungen, wäre eine Mehrpunkt- oder log-lineare Kalibrierung die nächste Stufe. Vorher nicht.

## 10. Bekannte Grenzen 2–5 im README

Weiterhin offen, jeweils mit Analyse im README unter „Bekannte Grenzen“:

- **2. Der erste Kalibrierpunkt ist unlöschbar** – jeder neue Punkt ersetzt nur `p2`. Abhilfe heute: Zurücksetzen. Eine Lösung wäre, `p1`/`p2` getrennt löschbar zu machen oder Punkte als Liste mit Zeitstempel zu führen.
- **3. Q kennt keinen Belichtungs-Faktor** – eine Sitzung dauerhaft außerhalb des Zielbands meldet Q = 100 %.
- **4. Zielband prüft nur den Mittelwert** – Übersteuerung kann innerhalb des Bands landen; seit v3.4.14 korrigiert der Manuell-Modus nach ~1,5–3 s selbst. Nächste Stufe wäre, das Band an den Clipping-Anteil zu koppeln.
- **5. Unsicherheits-Boden ±14 %** – Folge von `u_cal` = `u_profile` = 0,05; ändert sich nur mit belastbar kleineren Profil-Unsicherheiten (Punkt 2).

## 11. Auswertung: Zuordnung alter Trainingspunkte

**Wo:** `tools/auswertung.js`, `rohwertBasis`.

**Stand:** Punkte ohne `isoModell` werden über den Zeitstempel zugeordnet. Vor dem ersten Commit von v3.4.22 (`2026-11-09T18:23:09Z`) gilt „alt“ und wird exakt umgerechnet; danach „unklar“, weil v3.4.22–26 schon die neue Kurve hatten, aber noch keine Kennung schrieben. Unklare Punkte im ISO-Band 401–1599 bleiben dem Modellvergleich fern; die Unsicherheits-Zählung nutzt sie weiter.

**Grenzen:** Die Zuordnung hängt an der Uhr des Geräts. Punkte zwischen Commit und Auslieferung (Merge auf `main` um 19:11 UTC) sind in der Praxis alt, zählen aber als unklar – konservativ, kostet nur Punkte. Mehr ist aus den alten Daten nicht herauszuholen.

## 12. Browser-Test liegt nicht im Repo

**Stand:** Der Lauf in headless Chromium (Playwright, Test-Kamera mit `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, `permissions:['camera']`, lokaler HTTP-Server für Service Worker) war ein Einmal-Skript außerhalb des Repos. Er hat zwei Fehler gefunden, die die Node-Harnesses nicht sahen (DLI im Platzhalter-Zustand, Halt-Abzeichen verdeckte den Platzhalter).

**Vorschlag:** Als `tests/test_browser.js` aufnehmen, optional wie `test_properties.js` (eigene Abhängigkeit `playwright`, nicht in `test:nodeps`). Den Platzhalter-Fall erzeugt man im Browser, indem man per `addInitScript` `MediaStreamTrack.prototype.getCapabilities/getSettings` um `exposureMode`, `exposureTime`, `iso` kürzt.

---

## Arbeitshinweise

- **Version hochzählen** an allen Stellen gleichzeitig: `<title>`, Kopfzeile, Feature-Liste (`v… · Exakte`), `sw.js` (`CACHE='ppfd-v…'`), `package.json`, `package-lock.json` (2×). `tests/test_pipeline.js` prüft das. Ohne neuen Cache-Namen aktualisieren installierte PWAs nicht.
- **Reine Funktionen** gehören zwischen `/* ===PURE-PIPELINE-BEGIN=== */` und `…-END`, sonst sieht `test_pipeline.js` sie nicht. Neue Funktionen dort in die Export-Liste oben im Test eintragen.
- **Ablauf prüfen** statt nur Funktionen: `tests/test_messablauf.js` fährt das echte Skript mit simulierter Kamera, Frames und Uhr. Neue Fehler im Zusammenspiel dort als Regressionstest anlegen; gegen den Stand vor dem Fix laufen lassen (`node tests/test_messablauf.js pfad/zu/alter/index.html`), um zu sehen, dass der Test den Fehler wirklich fängt.
- **Rohwert-Basis:** Alles, was `rawPPFDUncalibrated` verändert (Konstanten, ISO-/Belichtungsfaktoren, Schwarzwert, PAR-Gewichte), entwertet gespeicherte Kalibrierungen und mischt Trainingsdaten. Dann das Modell-Kennzeichen (`ISO_MODEL`, CSV `isoModell`) hochzählen und `tools/auswertung.js` nachziehen.
- **Tests:** `npm install` einmalig, dann `npm test` (8 Suites, 351 Tests im Stand dieses Commits). Ohne Abhängigkeiten: `npm run test:nodeps`.
