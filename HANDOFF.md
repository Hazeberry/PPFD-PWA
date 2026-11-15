# Handoff: offene Punkte

Erstellt nach v3.4.27 (PR #26), Stand jetzt **v3.4.28**. CI läuft seit PR #27/#28 (`CI.md`).

Diese Datei sammelt, was **bewusst nicht** erledigt wurde, und warum – und seit v3.4.28 auch, was davon inzwischen erledigt oder entschieden ist. Was in v3.4.22–28 behoben ist, steht in den PR-Beschreibungen und im README. Zeilennummern beziehen sich auf `index.html` zum Zeitpunkt des Schreibens und verschieben sich mit jeder Änderung – im Zweifel nach dem Funktionsnamen suchen.

## Kurzüberblick

| # | Punkt | Art | Stand |
|---|---|---|---|
| 1 | Keine Prüfung mit echter Handykamera | Validierung | **offen** – braucht Geräte |
| 2 | Konstanten und Gewichte unbelegt | Validierung | **offen** – braucht PAR-Meter, ≥ 10 Sitzungen |
| 3 | −2-%-Stufe bei 1/30 s | Messfehler (klein) | entschieden: bleibt, bis Referenzdaten vorliegen |
| 4 | Schwarzwert nach dem Kalibrieren | Messfehler (klein) | **erledigt** (v3.4.28) |
| 5 | Manuell-Nachweis in der Rampe | Fehlklassifikation (selten) | entschieden: erst nach Gerätetest (Punkt 1) |
| 6 | Manuell-Modus ohne ISO-Steuerung | ungeklärt | gekennzeichnet (v3.4.28); Klärung braucht Gerät |
| 7 | Trainingspunkte sind Einzelbilder | Inkonsistenz | **erledigt** (v3.4.28) |
| 8 | Schwellwerte ohne Datenbasis | Annahmen | **offen** – braucht Daten |
| 9 | Zwei-Punkt-Gerade ist linear | Modellgrenze | **offen** – braucht Daten |
| 10 | Bekannte Grenzen 2–5 im README | Produktentscheidungen | Grenze 2 **erledigt** (v3.4.28); 3–5 offen |
| 11 | Auswertung: Zuordnung alter Punkte | Datenqualität | abgeschlossen – mehr ist aus alten Daten nicht zu holen |
| 12 | Browser-Test liegt nicht im Repo | Werkzeug | **erledigt** (PR #27/#28) |

Nebenbei in v3.4.28 behoben: Die Feldbeschriftungen setzten „µmol“ per CSS in Großbuchstaben, daraus wurde „ΜMOL“ – gelesen als mmol, Faktor 1000 beim Eintippen der Referenz.

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

**Entscheidung (v3.4.28):** (a) – bleibt. Wiedervorlage mit Punkt 2.

## 4. Schwarzwert messen oder löschen nach dem Kalibrieren

**Wo:** `measureBlackLevel`, `resetBlackLevel`; Kalibrierpunkte in `applyCalibration`.

**Problem:** Der Schwarzwert wird von jedem Pixel abgezogen, bevor der Rohwert entsteht. Misst oder löscht man ihn nach dem Kalibrieren, ändert sich die Rohwert-Basis, die Kalibrierung gilt aber unverändert weiter – ohne Hinweis. Der Effekt ist klein bei hellem Licht und wird bei schwachem Licht relevant (Schwarzwert-Grenze 0,02 linear gegen ein Signal von z. B. 0,04).

**Erledigt (v3.4.28):**
- Jeder Kalibrierpunkt speichert den Schwarzwert (`bl`, Y-gewichtet).
- Wird danach ein Schwarzwert gemessen oder gelöscht, kommt eine Meldung. Die Unsicherheitszeile nennt die Verschiebung, sobald sie 1 % übersteigt („· Schwarzwert seit Kalibrierung geändert: −x % (neu kalibrieren)“, `blackLevelShift`, `BL_SHIFT_NOTICE`). Export: `calibSchwarzwertFaktor`.
- Ein zweiter Kalibrierpunkt mit anderem Schwarzwert verwirft den ersten, statt zwei Basen zu mischen (wie beim ISO-Modell).

**Bleibt:** Kalibrierungen von vor v3.4.28 haben keinen gespeicherten Schwarzwert; für sie gibt es nur die Meldung beim Ändern, keine Größenangabe. Die Größe ist eine Näherung über die Y-Helligkeit, nicht kanalweise mit den PAR-Gewichten.

## 5. Manuell-Nachweis in der Rampe kann von der Kamera-Automatik kommen

**Wo:** `tuneExposure` (Rampe), `rampReactionObserved`.

**Problem:** Als Beleg zählt seit v3.4.24 nur die *gemeldete* Belichtungszeit, die sich nach einem Stellbefehl richtungskonsistent um > 20 % bewegt. Eine Kamera, die Befehle ignoriert, aber in Auto-Belichtung gerade in dieselbe Richtung nachregelt (z. B. weil die Szene beim Start dunkel ist und die App die Zeit verlängert anfordert), liefert genau dieses Muster. Dann gilt sie als „Manuell“, obwohl sie es nicht ist.

**Abfederung heute:** Der Drift-Check (alle 60 Frames, 3 Strikes, > 15 % Abweichung) schaltet beim nächsten Lichtwechsel auf Software-Modus zurück. Bis dahin ist der Wert richtig, solange die Kamera die gemeldete Zeit nicht weiter ändert – die Formel teilt durch die gemeldete Zeit.

**Option:** Nach einer Rampe zusätzlich den Verify-Schritt fahren (stören ×2/÷2, zurückstellen, gemeldete Zeit muss beiden Befehlen folgen). Zwei gegenläufige Befehle, beide befolgt, schließen gleichgerichtetes Nachregeln praktisch aus. Kostet `VERIFY_COST_MS` ≈ 1,6 s Startzeit; das Zeitbudget von `tuneExposure` (8 s) und der 15-s-Watchdog in `startCamera` müssen das tragen – `tests/test_exposure_budget.js` prüft genau das und muss mitwachsen.

**Empfehlung:** Erst nach Punkt 1 entscheiden. Wenn echte Geräte nie in diesen Fall laufen, ist die Startzeit wertvoller.

**Entscheidung (v3.4.28):** so übernommen – keine Änderung vor dem Gerätetest. Beim Gerätetest auf `rampEvidence` achten: Steht im Debug-Trail eine Rampe ohne `(verify…)`, und meldet das Gerät `exposureMode: continuous`, ist das genau dieser Fall.

## 6. Manuell-Modus ohne ISO-Steuerung

**Wo:** `applyHardwareConstraints` (`if(cap.iso) constraints.iso=…`), `exposureStatus`.

**Problem:** Bietet eine Kamera manuelle Belichtungszeit, aber keine ISO-Steuerung an, setzt die App keine ISO. Meldet sie die ISO auch nicht, rechnet die Formel mit dem Startwert (`getSettings()` beim Start, sonst 100). Ob eine Kamera in diesem Zustand die ISO selbst nachregelt, ist **ungeprüft**. Wenn ja, ist der Wert dort ähnlich lichtunabhängig wie im Platzhalter-Zustand; die App behandelt es aber nur als Hinweis („· ISO nicht gemeldet“), Kalibrieren bleibt möglich.

**Weg:** An einem Gerät mit diesem Profil (Test-Kamera von Chromium hat es: Manuell-Modus, keine ISO) mit echtem Licht prüfen, ob der Wert bei halbem Licht auf etwa die Hälfte fällt. Wenn nicht: `exposureStatus` so ändern, dass `!isoReported && !isoControlled` auch im Manuell-Modus als Platzhalter gilt.

**Stand (v3.4.28):** gekennzeichnet, Verhalten unverändert. `applyHardwareConstraints` hält `isoControlled` fest (hat die App die ISO gesetzt?), der Export führt es als `isoGesteuert` (1/0). Die Frage lässt sich damit an Trainingsdaten beantworten: Punkte mit `hardwareMode=manuell`, `isoGemeldet=0`, `isoGesteuert=0` bei mehreren Helligkeiten – folgt `rawPPFDUncalibrated` der Referenz proportional, regelt die Kamera nicht nach. Die Umstellung auf „Platzhalter“ wäre danach eine Zeile in `exposureStatus`; der CI-Browser-Test (Chromium-Test-Kamera hat genau dieses Profil) müsste dann mit angepasst werden.

## 7. Trainingspunkte sind weiterhin Einzelbilder

**Wo:** `saveTrainPoint` übernimmt `lastFrameSnapshot` (den letzten Frame). Kalibrieren nutzt seit v3.4.27 den Median der letzten 31 gültigen Frames (`calibRawMedian`).

**Problem:** Dieselben Gründe, die bei der Kalibrierung zum Median geführt haben (Ausreißer-Frames, Abfrage-Verzug der Belichtung im Software-Modus, PWM-Flackern), gelten für Trainingspunkte. Für die Auswertung ist es weniger kritisch, weil viele Punkte gemittelt werden; ein einzelner falscher Punkt verzerrt aber den Modellvergleich einer kleinen Sitzung.

**Erledigt (v3.4.28):** `saveTrainPoint` nutzt dieselbe Prüfung wie die Kalibrierung (`calibRawCheck`: Fenster voll, Spanne ≤ `CALIB_RAW_MAX_SPREAD`). `rawPPFDUncalibrated` ist der Median, der Einzelframe steht in `rawPPFDFrame`, `rawFenster` (= 31) kennzeichnet den Median; Punkte ohne das Feld sind Einzelbilder. Farbanteile, Güte und Unsicherheit bleiben Werte des letzten Frames. `tools/auswertung.js` liest weiter `rawPPFDUncalibrated` und brauchte keine Änderung.

## 8. Schwellwerte ohne Datenbasis

Alle in v3.4.22–27 neu gesetzt, begründet, aber nicht aus Messdaten abgeleitet:

| Konstante | Wert | Wirkung | Risiko bei falscher Wahl |
|---|---|---|---|
| `AFFINE_GAIN_LIMIT` | 5 | ab hier Unsicherheit „nicht quantifizierbar“ | zu klein: Hinweis erscheint schon weit vor der Null-Zone |
| `CALIB_RAW_WINDOW` | 31 Frames | Fenster für den Kalibrier-Median | zu groß: Kalibrieren fühlt sich träge an |
| `CALIB_RAW_MAX_SPREAD` | 0,20 | Sperre „Messwert schwankt noch“ | zu klein: unter PWM-LEDs nie kalibrierbar |
| `ISO_SHIFT_NOTICE` | 0,005 | ab hier Warnung zur Altkalibrierung | unkritisch |
| `rampReactionObserved` / `verifyReactionObserved` | > 20 % bzw. > 2 Einheiten | Manuell-Beleg | zu groß: quantisierende Treiber gelten nicht als manuell |
| `BL_SHIFT_NOTICE` (v3.4.28) | 0,01 | ab hier Hinweis „Schwarzwert seit Kalibrierung geändert“ | unkritisch |

`Q_GATE_HOLD` (0,35) und die Q-Rampen sind älter und im Code ausführlich begründet, aber ebenso nicht gegen Daten geprüft.

**Weg:** Mit Punkt 1 (echte Geräte) prüfen, ob die Sperren im Alltag zu oft greifen. Die Zahlen stehen jeweils an einer Stelle; Tests in `tests/test_pipeline.js` binden manche an die Kommentare (z. B. Q-Gate), die müssen dann mitgeändert werden.

## 9. Zwei-Punkt-Kalibrierung ist eine Gerade

**Stand:** `computeCalib2` legt Steigung und Offset fest. Eine gekrümmte Kennlinie (Tonkurve des Handys, HDR, Sättigung) gleicht das nur zwischen den beiden Punkten näherungsweise aus. Die sRGB-Umkehr ist exakt, garantiert aber keine radiometrisch linearen Pixel. Texte im Dialog, README und Kommentar sagen das seit v3.4.27 korrekt.

**Wenn Daten es zeigen:** `tools/auswertung.js` vergleicht schon ein Modell „Faktor + Helligkeit“ (log-linear). Schlägt es den globalen Faktor belastbar über Sitzungen, wäre eine Mehrpunkt- oder log-lineare Kalibrierung die nächste Stufe. Vorher nicht.

## 10. Bekannte Grenzen 2–5 im README

Weiterhin offen, jeweils mit Analyse im README unter „Bekannte Grenzen“:

- **2. Der erste Kalibrierpunkt ist unlöschbar** – **erledigt (v3.4.28):** Der Kalibrier-Dialog listet die Punkte mit Rohwert und Referenz, jeder ist einzeln löschbar (`renderCalibPoints`, `deleteCalibPoint`); der verbleibende wird Punkt 1. Ältere Kalibrierungen ohne einzeln gespeicherte Punkte verweisen auf „Reset“. Ein neuer Punkt ersetzt weiterhin Punkt 2.
- **3. Q kennt keinen Belichtungs-Faktor** – eine Sitzung dauerhaft außerhalb des Zielbands meldet Q = 100 %.
- **4. Zielband prüft nur den Mittelwert** – Übersteuerung kann innerhalb des Bands landen; seit v3.4.14 korrigiert der Manuell-Modus nach ~1,5–3 s selbst. Nächste Stufe wäre, das Band an den Clipping-Anteil zu koppeln.
- **5. Unsicherheits-Boden ±14 %** – Folge von `u_cal` = `u_profile` = 0,05; ändert sich nur mit belastbar kleineren Profil-Unsicherheiten (Punkt 2).

## 11. Auswertung: Zuordnung alter Trainingspunkte

**Wo:** `tools/auswertung.js`, `rohwertBasis`.

**Stand:** Punkte ohne `isoModell` werden über den Zeitstempel zugeordnet. Vor dem ersten Commit von v3.4.22 (`2026-11-09T18:23:09Z`) gilt „alt“ und wird exakt umgerechnet; danach „unklar“, weil v3.4.22–26 schon die neue Kurve hatten, aber noch keine Kennung schrieben. Unklare Punkte im ISO-Band 401–1599 bleiben dem Modellvergleich fern; die Unsicherheits-Zählung nutzt sie weiter.

**Grenzen:** Die Zuordnung hängt an der Uhr des Geräts. Punkte zwischen Commit und Auslieferung (Merge auf `main` um 19:11 UTC) sind in der Praxis alt, zählen aber als unklar – konservativ, kostet nur Punkte. Mehr ist aus den alten Daten nicht herauszuholen.

## 12. Browser-Test liegt nicht im Repo – erledigt

**Erledigt:** `tests/test_browser.js` mit Workflow `.github/workflows/test.yml` (PR #27), Diagnose-Artefakte und Wiederholungsläufe (PR #28). Einzelheiten in `CI.md`. Der folgende Abschnitt ist der ursprüngliche Stand.

**Stand:** Der Lauf in headless Chromium (Playwright, Test-Kamera mit `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, `permissions:['camera']`, lokaler HTTP-Server für Service Worker) war ein Einmal-Skript außerhalb des Repos. Er hat zwei Fehler gefunden, die die Node-Harnesses nicht sahen (DLI im Platzhalter-Zustand, Halt-Abzeichen verdeckte den Platzhalter).

**Vorschlag:** Als `tests/test_browser.js` aufnehmen, optional wie `test_properties.js` (eigene Abhängigkeit `playwright`, nicht in `test:nodeps`). Den Platzhalter-Fall erzeugt man im Browser, indem man per `addInitScript` `MediaStreamTrack.prototype.getCapabilities/getSettings` um `exposureMode`, `exposureTime`, `iso` kürzt.

---

## Arbeitshinweise

- **Version hochzählen** an allen Stellen gleichzeitig: `<title>`, Kopfzeile, Feature-Liste (`v… · Exakte`), `sw.js` (`CACHE='ppfd-v…'`), `package.json`, `package-lock.json` (2×). `tests/test_pipeline.js` prüft das. Ohne neuen Cache-Namen aktualisieren installierte PWAs nicht.
- **Reine Funktionen** gehören zwischen `/* ===PURE-PIPELINE-BEGIN=== */` und `…-END`, sonst sieht `test_pipeline.js` sie nicht. Neue Funktionen dort in die Export-Liste oben im Test eintragen.
- **Ablauf prüfen** statt nur Funktionen: `tests/test_messablauf.js` fährt das echte Skript mit simulierter Kamera, Frames und Uhr. Neue Fehler im Zusammenspiel dort als Regressionstest anlegen; gegen den Stand vor dem Fix laufen lassen (`node tests/test_messablauf.js pfad/zu/alter/index.html`), um zu sehen, dass der Test den Fehler wirklich fängt.
- **Rohwert-Basis:** Alles, was `rawPPFDUncalibrated` verändert (Konstanten, ISO-/Belichtungsfaktoren, Schwarzwert, PAR-Gewichte), entwertet gespeicherte Kalibrierungen und mischt Trainingsdaten. Dann das Modell-Kennzeichen (`ISO_MODEL`, CSV `isoModell`) hochzählen und `tools/auswertung.js` nachziehen.
- **Tests:** `npm install` einmalig, dann `npm test` (8 Suites, 369 Tests in v3.4.28). Ohne Abhängigkeiten: `npm run test:nodeps`. Browser: `npx playwright install --with-deps chromium`, dann `npm run test:browser` (lokal mit vorhandenem Chromium: `CHROMIUM_EXECUTABLE_PATH=…`). Beides läuft in der CI (`CI.md`).
- **Test-Attrappe `test_messablauf.js`:** `requestAnimationFrame` ist seit v3.4.28 eine Warteschlange wie im Browser (vorher verdrängte jeder weitere rAF-Aufruf – etwa die Balken-Animation der Schwarzwertmessung – die Messschleife), Elemente haben eine Kindliste (`kinder`).
