# PPFD Meter Pro

**Smartphone-Kamera-basierte PPFD/PAR-Messung für Pflanzenbeleuchtung — als installierbare PWA, komplett offline-fähig, ohne App-Store.**

Die App verwandelt die Handykamera in ein PPFD-Messgerät (µmol·m⁻²·s⁻¹): Sie linearisiert die Kamerapixel exakt (sRGB-EOTF nach IEC 61966-2-1), gewichtet spektral nach Lichtquellen-Profil, rechnet physikalisch auf PPFD um und gibt zu jedem Messwert eine **Qualitätsbewertung (Q)** und eine **GUM-inspirierte erweiterte Messunsicherheit (± %, k = 2)** aus.

## Live

👉 **https://hazeberry.github.io/PPFD-PWA/** (HTTPS ist Kamera-Voraussetzung)

Auf dem Smartphone: Seite öffnen → Browser-Menü → **„Zum Startbildschirm hinzufügen“** → App-Icon auf dem Homescreen, danach komplett offline nutzbar (Service Worker cached alles lokal).

## Bedienung in 3 Schritten

1. **Diffusor:** Empfohlen ist ein echter **Kosinus-Korrektor** wie der **Lightray Diffuser & Cosine Corrector** (Clip-On vor der Frontkamera). DIY-Alternative: 2–3 Lagen weißes Kopierpapier (80 g/m²) auf die Linse legen.
2. **Kamera aktivieren**, 300 Frames Warmup abwarten (Temperatur-Stabilisierung).
3. **Kalibrieren** (einmalig pro Kamera): Referenz-PAR-Meter danebenhalten, Wert eingeben. Optional **Zwei-Punkt-Kalibrierung** bei deutlich anderer Helligkeit — ersetzt die reine Steigung durch `Steigung·raw + Offset` und kompensiert Sensor-Nichtlinearität über den Dynamikbereich.

Optional: **Schwarzwert messen** (Linse abdecken) korrigiert den Dunkeloffset pixelgenau pro Kamera.

**Warum Kosinus-Korrektor?** PPFD ist eine flächenbezogene Größe — die Sensorantwort muss dem Lambertschen Kosinusgesetz folgen. Papier streut und dämpft zwar, besitzt aber keine definierte Kosinus-Richtcharakteristik; die Winkelabhängigkeit bleibt unbestimmt und gerätespezifisch. Genau diese Eigenschaft beschreibt die Norm **ISO/CIE 19476** über den Güteindex **f₂** (directional response, Kosinusgesetz-Abweichung) — formal für Beleuchtungsstärke-/Leuchtdichtemesser, aber dasselbe Konzept, mit dem auch PAR-Sensoren ihre Kosinus-Korrektur spezifizieren.

## Was drinsteckt

- **Exakte sRGB-Linearisierung** (statt γ≈2.2-Näherung), BT.709-Luma, lineare Domäne für alle Statistiken
- **Lichtquellen-Profile** (Sonnenlicht, weiße LED, LED Grow, HPS, MH, Leuchtstoff) mit Faktor + nominaler Unsicherheit, Auto-Erkennung oder manuelle Wahl (persistiert). Die Nutzer-Kalibrierung wird **pro Kamera und Profil** gespeichert — der Profilfaktor wirkt auf die PAR-Gewichtung, nicht auf Lux, und dieser Versatz ist profilabhängig
- **Qualitätsindex Q** = Q_clip × Q_uniformity × Q_signal × Q_stability (3×3-Zonen-CV, Temporal-CV); unter Q < 0.35 wird der Kalman gehalten statt von Schrottframes weggezogen, der schwächste Teilfaktor wird als Grund angezeigt
- **Unsicherheitsbudget** u_rel = √(u_cal² + u_profile² + u_temporal² + u_noise²). Angezeigt wird die **erweiterte** Unsicherheit (k = 2, ≈ 95 %), ehrlich: ca. ±70 % unkalibriert vs. ±10 % kalibriert. Der CSV-Export führt die Standardunsicherheit (k = 1) in der Spalte `uRel_k1`.
- **Status-Checkliste** (✓/⚠ Übersteuerung, Gleichmäßigkeit, Signal, Stabilität) mit handlungsleitenden Hinweisen
- **Robustheit:** Median-Vorfilter (N=5) + adaptiver Kalman, Q-Gate gegen Schrottframes, Rolling-Shutter-Flickererkennung mit Periodizitäts-Check und Hysterese in Detektionen statt Frames, PWM-robuste Belichtungs-Verifikation, Watchdog-gehärteter Kamerastart, WakeLock, Trainingsdaten-CSV-Export (injektionssicher)
- **PWA:** `manifest.json` + `sw.js` (cache-first, versionsierter Cache), Icons inkl. maskable

## Bekannte Grenzen

Drei Punkte aus dem Code-Review, die bewusst offen sind — sie brauchen eine Produkt-/Anzeige-Entscheidung, keinen Bugfix. Wer die App ernsthaft benutzt, sollte sie kennen.

### 1. Zwei-Punkt-Kalibrierung kann eine stille Null-Zone erzeugen

Bei negativem Offset klemmt die Pipeline alles unterhalb von `|Offset| / Steigung` auf exakt **0**. Das passiert bei völlig plausiblen Kalibrierpunkten und schlägt kein Guard an:

| Punkte | Fit | ab hier wird 0 gemeldet |
|---|---|---|
| 100 → 90 und 900 → 1010 | `×1.1500 −25.0` | raw < **21,7** |

Im schwachen Licht (Zeltrand, Dämmerung) zeigt das Gerät dann hartnäckig 0 und wirkt defekt. Der Fit ist dort schlicht extrapoliert, und `u_cal` bildet das nicht ab.

**Erkennen:** Die aktive Kalibrierung im Kalibrier-Dialog zeigt den Offset mit Vorzeichen. Steht dort ein Minus, teile den Betrag durch die Steigung — unterhalb dieses Werts ist die Anzeige nicht vertrauenswürdig.
**Umgehen:** Für Messungen im unteren Bereich die Ein-Punkt-Kalibrierung benutzen — sie ist konstruktionsbedingt offsetfrei. Achtung, das erfordert **Zurücksetzen**: ein neuer Punkt landet sonst als zweiter Stützpunkt und der Offset ist wieder da (siehe Punkt 2).

### 2. Der erste Kalibrierpunkt ist unlöschbar

Nach dem ersten gespeicherten Punkt ersetzt jede weitere Kalibrierung nur noch `p2`. Ein veralteter `p1` — etwa aus einem anderen Diffusor-Aufbau — zieht die Gerade schief, während die Anzeige „(2 Punkte)" nach mehr Genauigkeit aussieht.

**Umgehen:** Bei geändertem optischem Aufbau (Wechsel Papier ↔ Kosinus-Korrektor, andere Halterung) erst **Zurücksetzen**, dann neu kalibrieren. Ein bloßes Nachkalibrieren behält den alten ersten Punkt.

### 3. Q kennt keinen Belichtungs-Faktor

Der Qualitätsindex ist das Produkt aus Clipping, Homogenität, Signal und Stabilität. Ob die Belichtung ihr Zielband (Y 25–220) je erreicht hat, geht **nicht** ein — eine Sitzung dauerhaft außerhalb des Bands meldet weiterhin Q = 100 %.

Das ist kein Widerspruch in sich: Wurde der manuelle Lock nachgewiesen (`(verify…)` im Trail), läuft die Messung bewusst weiter, statt auf Auto-Belichtung zurückzufallen — dieses Verhalten ist gewollt. Q behauptet dann aber mehr Sicherheit, als der Belichtungszustand hergibt.

**Erkennen:** Die Zeile *Debug: Exposure raw* zeigt bei manuellem Hardware-Modus `… Y=<Wert> …`. Liegt der weit außerhalb von 25–220, arbeitet der Sensor abseits seines Auslegungspunkts, unabhängig davon was Q sagt.

## Repo-Layout

| Pfad | Inhalt |
|---|---|
| `index.html` | **Die komplette App** — bewusst single-file, kein Build-Step |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | PWA-Infrastruktur |
| `tests/test_pipeline.js` | Node-Regressions-Harness, **75 Tests** gegen den extrahierten Pure-Pipeline-Block |
| `tests/test_calib_storage.js` | Integrations-Harness, **14 Tests** für Kalibrier-Storage, Canvas- und Flicker-Verdrahtung |
| `tests/test_exposure_budget.js` | **7 Tests** für das Zeitbudget von `tuneExposure` (simulierte Uhr) |
| `tests/test_sw_fallback.js` | **8 Tests** für den Service-Worker (Offline-Fallback, Cache-Regeln) |
| `patches/` | Gestaffelte Patches der letzten Stufen (Review-Nachvollziehbarkeit) |

## Tests

```bash
node tests/test_pipeline.js         # 75/75 erwartet (kein Browser nötig)
node tests/test_calib_storage.js    # 14/14 erwartet
node tests/test_exposure_budget.js  #  7/7  erwartet
node tests/test_sw_fallback.js      #  8/8  erwartet
```

`test_pipeline.js` extrahiert den `PURE-PIPELINE`-Block aus `index.html` und testet ihn gegen synthetische Frames: EOTF-Endpunkte/Knie, Frame-Analyse, Flicker-Regressionen, FSM, Profile, Kalman, Uniformität, Q-Komponenten, Unsicherheits-Szenarien, Schwarzwert-Subtraktion, Zwei-Punkt-Fit inkl. Guards und Clamp-Konsistenz, Median-Vorfilter, Q-Gate-Schwellen und Flicker-Hysterese.

`test_calib_storage.js` lädt das echte `<script>` in eine minimale DOM-/`localStorage`-Attrappe und prüft Kalibrier-Storage (Profilbindung, Legacy-Fallback, vollständiges Zurücksetzen) sowie die Canvas-Verdrahtung — dass `canvas.width/height` aus `PROC_W`/`PROC_H` kommen und im Skript keine nackten `320`/`240`-Literale mehr stehen.

`test_exposure_budget.js` fährt `tuneExposure()` mit einer **simulierten Uhr** (`setTimeout` lässt die Uhr springen und löst sofort auf) gegen Track-Attrappen: dass der Verify-Schritt nur startet, wenn er noch vollständig ins 8-s-Budget passt, dass eine bewegte Settings-Meldung als Beleg zählt und ein quantisierender Treiber keinen liefert.

`test_sw_fallback.js` lädt `sw.js` in eine `ServiceWorkerGlobalScope`-Attrappe: die App-Shell darf nur bei Navigationen als Offline-Fallback kommen, ein fehlgeschlagenes Bild oder JSON bekommt einen echten Netzwerkfehler statt HTML.

## Entstehung & Credits

Dieses Projekt wurde in Zusammenarbeit mit KI-Assistenten entwickelt — namentlich **Kimi (Moonshot AI)** und **Claude (Anthropic)**. Beide waren an Code-Reviews, der stufenweisen Architektur (Messkorrektheit → Konfidenzschicht → Zwei-Punkt-Kalibrierung → PWA), Fehleranalysen und Fixes beteiligt; Richtung, Entscheidungen und Feldtests lagen beim Projektinhaber. Weitere Modelle (u. a. Gemini, GLM) lieferten Review-Perspektiven, die kritisch geprüft und teils übernommen wurden.

## Lizenz

Siehe [LICENSE](LICENSE).
