# PPFD Meter Pro

**Smartphone-Kamera-basierte PPFD/PAR-Messung für Pflanzenbeleuchtung — als installierbare PWA, komplett offline-fähig, ohne App-Store.**

Die App verwandelt die Handykamera in ein PPFD-Messgerät (µmol·m⁻²·s⁻¹): Sie linearisiert die Kamerapixel exakt (sRGB-EOTF nach IEC 61966-2-1), gewichtet spektral nach Lichtquellen-Profil, rechnet physikalisch auf PPFD um und gibt zu jedem Messwert eine **Qualitätsbewertung (Q)** und eine **GUM-inspirierte erweiterte Messunsicherheit (± %, k = 2)** aus.

## Live

👉 **https://hazeberry.github.io/PPFD-PWA/** (HTTPS ist Kamera-Voraussetzung)

Auf dem Smartphone: Seite öffnen → Browser-Menü → **„Zum Startbildschirm hinzufügen“** → App-Icon auf dem Homescreen, danach komplett offline nutzbar (Service Worker cached alles lokal).

## Bedienung in 3 Schritten

1. **Diffusor:** Empfohlen ist ein echter **Kosinus-Korrektor** wie der **Lightray Diffuser & Cosine Corrector** (Clip-On vor der Frontkamera). DIY-Alternative: 2–3 Lagen weißes Kopierpapier (80 g/m²) auf die Linse legen.
2. **Kamera aktivieren**, 300 Frames Warmup abwarten (Temperatur-Stabilisierung).
3. **Kalibrieren** (einmalig pro Kamera und Lichtprofil): Referenz-PAR-Meter danebenhalten, Wert eingeben. Optional **Zwei-Punkt-Kalibrierung** bei deutlich anderer Helligkeit — ersetzt die reine Steigung durch `Steigung·raw + Offset` und kompensiert Sensor-Nichtlinearität über den Dynamikbereich. Die App merkt sich die Rohwerte der Stützstellen und **warnt, sobald du außerhalb des kalibrierten Bereichs misst** (z. B. bei stark abweichender Dimmstufe).

Optional: **Schwarzwert messen** (Linse abdecken) korrigiert den Dunkeloffset pixelgenau pro Kamera.

**Warum Kosinus-Korrektor?** PPFD ist eine flächenbezogene Größe — die Sensorantwort muss dem Lambertschen Kosinusgesetz folgen. Papier streut und dämpft zwar, besitzt aber keine definierte Kosinus-Richtcharakteristik; die Winkelabhängigkeit bleibt unbestimmt und gerätespezifisch. Genau diese Eigenschaft beschreibt die Norm **ISO/CIE 19476** über den Güteindex **f₂** (directional response, Kosinusgesetz-Abweichung) — formal für Beleuchtungsstärke-/Leuchtdichtemesser, aber dasselbe Konzept, mit dem auch PAR-Sensoren ihre Kosinus-Korrektur spezifizieren.

## Was drinsteckt

- **Exakte sRGB-Linearisierung** (statt γ≈2.2-Näherung), BT.709-Luma, lineare Domäne für alle Statistiken
- **Lichtquellen-Profile** (Sonnenlicht, weiße LED, Blurple-Panel, HPS, MH, Leuchtstoff) mit Faktor + nominaler Unsicherheit. Auto-Erkennung nur für die drei Klassen, die sich in der RGB-Chromatizität belastbar trennen lassen (Sonnenlicht, HPS, Leuchtstoff) — der Rest ist manuell wählbar. **Moderne Grow-LEDs mit Weißlicht-Basis gehören auf „Weiße LED“**: ihr 660-nm-Rot-Boost ist für eine RGB-Kamera unsichtbar (V(λ) ≈ 0,06 bei 660 nm gegen ≈ 0,50 bei 610 nm) und ohne Kalibrierung nicht erfassbar. Die Nutzer-Kalibrierung wird **pro Kamera und Profil** gespeichert — der Profilfaktor wirkt auf die PAR-Gewichtung, nicht auf Lux, und dieser Versatz ist profilabhängig
- **Qualitätsindex Q** = Q_clip × Q_uniformity × Q_signal × Q_stability (3×3-Zonen-CV, Temporal-CV) als Güte-Anzeige. Der **Kalman-Halt** läuft bewusst auf einem engeren Kriterium (`Q_clip × Q_uniformity < 0.35`): nur wenn der *Frame die Szene nicht abbildet* — übersteuert oder ungleich ausgeleuchtet — wird der letzte Wert gehalten. Wenig Signal und hohe zeitliche Streuung sind *Messergebnisse*, keine Haltegründe: wird es dunkel, läuft die Anzeige gegen 0, statt einzufrieren
- **Unsicherheitsbudget** u_rel = √(u_cal² + u_profile² + u_temporal² + u_noise²). Angezeigt wird die **erweiterte** Unsicherheit (k = 2, ≈ 95 %). Realistische Spanne — kalibrieren bringt den größten Sprung, hat aber einen harten Boden bei **±14 %** (siehe „Bekannte Grenzen"):

  | Lage | angezeigt (k = 2) |
  |---|---|
  | unkalibriert + Auto-Erkennung (Auslieferungszustand) | ±73 % |
  | unkalibriert, Profil manuell gewählt | ±71 % |
  | kalibriert, Blurple-Panel oder Auto-Erkennung | ±22 % |
  | kalibriert, weiße LED manuell | ±19 % |
  | kalibriert, Sonnenlicht/HPS manuell | **±14 %** ← Boden |

  Der CSV-Export führt die Standardunsicherheit (k = 1) in der Spalte `uRel_k1`.
- **Status-Checkliste** (✓/⚠ Übersteuerung, Gleichmäßigkeit, Signal, Stabilität) mit handlungsleitenden Hinweisen
- **Robustheit:** Median-Vorfilter (N=5) + adaptiver Kalman, Q-Gate gegen unrepräsentative Frames, Rolling-Shutter-Flickererkennung mit Periodizitäts-Check und Hysterese in Detektionen statt Frames, PWM-robuste Belichtungs-Verifikation, Watchdog-gehärteter Kamerastart, gegen Canvas-Fehler abgesicherte Messschleife, WakeLock, Trainingsdaten-CSV-Export (injektionssicher)
- **PWA:** `manifest.json` + `sw.js` (cache-first, versionsierter Cache), Icons inkl. maskable

## Bekannte Grenzen

Vier Punkte aus dem Code-Review, die bewusst offen sind — sie brauchen eine Produkt-/Anzeige-Entscheidung, keinen Bugfix. Wer die App ernsthaft benutzt, sollte sie kennen.

### 1. Zwei-Punkt-Kalibrierung kann eine Null-Zone erzeugen

Bei negativem Offset klemmt die Pipeline alles unterhalb von `|Offset| / Steigung` auf exakt **0**. Das passiert bei völlig plausiblen Kalibrierpunkten und schlägt kein Guard an:

| Punkte | Fit | ab hier wird 0 gemeldet |
|---|---|---|
| 100 → 90 und 900 → 1010 | `×1.1500 −25.0` | raw < **21,7** |

Im schwachen Licht (Zeltrand, Dämmerung) zeigt das Gerät dann 0. Der Fit ist dort schlicht extrapoliert, und `u_cal` bildet das nicht ab. **Seit v3.4.10 ist es immerhin nicht mehr still** — die App warnt, sobald der Rohwert die Null-Zone oder allgemein den kalibrierten Bereich verlässt. Die angezeigte Unsicherheit bleibt bewusst unverändert: Extrapolation ist eine echte Unsicherheitsquelle, aber ihre Größe ist ohne Vergleichsmessungen nicht bezifferbar.

**Erkennen:** Seit v3.4.10 meldet die App das selbst — unterhalb der Schwelle steht in der Unsicherheitszeile „⚠ unter der Null-Zone der Kalibrierung (ab Rohwert X geklemmt) – Anzeige ist keine Messung". Zusätzlich zeigt der Kalibrier-Dialog den Offset mit Vorzeichen; steht dort ein Minus, ist der Betrag durch die Steigung die Schwelle.
**Umgehen:** Für Messungen im unteren Bereich die Ein-Punkt-Kalibrierung benutzen — sie ist konstruktionsbedingt offsetfrei. Achtung, das erfordert **Zurücksetzen**: ein neuer Punkt landet sonst als zweiter Stützpunkt und der Offset ist wieder da (siehe Punkt 2).

### 2. Der erste Kalibrierpunkt ist unlöschbar

Nach dem ersten gespeicherten Punkt ersetzt jede weitere Kalibrierung nur noch `p2`. Ein veralteter `p1` — etwa aus einem anderen Diffusor-Aufbau — zieht die Gerade schief, während die Anzeige „(2 Punkte)" nach mehr Genauigkeit aussieht.

**Umgehen:** Bei geändertem optischem Aufbau (Wechsel Papier ↔ Kosinus-Korrektor, andere Halterung) erst **Zurücksetzen**, dann neu kalibrieren. Ein bloßes Nachkalibrieren behält den alten ersten Punkt.

**Was Zurücksetzen räumt (seit v3.4.8):** alle Lichtprofile der **aktuellen Kamera**, nicht nur das gerade gewählte — ein geänderter Aufbau entwertet jedes Profil gleichermaßen, der Diffusor sitzt vor dem Sensor. Bis v3.4.7 blieb unter den übrigen Profilen still die Kalibrierung des alten Aufbaus stehen und lieferte beim nächsten Profilwechsel unbemerkt falsche Werte. Die **andere Kamera** wird nicht mitgeräumt (eigener Sensor) — liegt dort noch etwas, sagt die Meldung nach dem Zurücksetzen, wie viel.

### 3. Q kennt keinen Belichtungs-Faktor

Der Qualitätsindex ist das Produkt aus Clipping, Homogenität, Signal und Stabilität. Ob die Belichtung ihr Zielband (Y 25–220) je erreicht hat, geht **nicht** ein — eine Sitzung dauerhaft außerhalb des Bands meldet weiterhin Q = 100 %.

Das ist kein Widerspruch in sich: Wurde der manuelle Lock nachgewiesen (`(verify…)` im Trail), läuft die Messung bewusst weiter, statt auf Auto-Belichtung zurückzufallen — dieses Verhalten ist gewollt. Q behauptet dann aber mehr Sicherheit, als der Belichtungszustand hergibt.

**Erkennen:** Die Zeile *Debug: Exposure raw* zeigt bei manuellem Hardware-Modus `… Y=<Wert> …`. Liegt der weit außerhalb von 25–220, arbeitet der Sensor abseits seines Auslegungspunkts, unabhängig davon was Q sagt.

### 4. Die angezeigte Unsicherheit hat einen Boden bei ±14 %

Auch bei perfekter Messung — kalibriert, Profil manuell gewählt, Gerät auf dem Stativ, hell ausgeleuchtet — geht die angezeigte Unsicherheit nicht unter **±14 %**. Das ist kein Einzelfall, sondern ein rechnerischer Boden:

```
u_cal      = 0.05   (fix für „kalibriert")
u_profile  = 0.05   (bestes Profil: Sonnenlicht oder HPS)
u_sys      = √(0.05² + 0.05²) = 0.0707   ← die beiden sind gleich groß
u_noise    = 0.01   (U_NOISE_FLOOR, signalunabhängig)
u_rel      = √(0.0707² + 0.01²) = 0.0714
angezeigt  = 0.0714 × 2 (k = 2) = 14,3 %
```

Weil `u_cal` und `u_profile` gleich groß sind, bringt das Kalibrieren allein nur den Faktor √2 gegenüber der Profil-Unsicherheit — nicht mehr. Wer tiefer will, müsste das Spektrum der eigenen Lampe kennen und ein Profil mit belastbar kleinerem `u` hinterlegen; das ist eine Erweiterung der Profil-Bibliothek, keine Sache der Bedienung.

**Praktisch heißt das:** Kalibrieren ist der mit Abstand größte Hebel (von ±73 % auf ±14–22 %). Danach bringt mehr Sorgfalt bei der Messung selbst kaum noch etwas an der *angezeigten* Zahl — die Reproduzierbarkeit verbessert sich, die ausgewiesene Unsicherheit aber nicht.

## Repo-Layout

| Pfad | Inhalt |
|---|---|
| `index.html` | **Die komplette App** — bewusst single-file, kein Build-Step |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | PWA-Infrastruktur |
| `tests/test_pipeline.js` | Node-Regressions-Harness, **110 Tests** gegen den extrahierten Pure-Pipeline-Block |
| `tests/test_calib_storage.js` | Integrations-Harness, **30 Tests** für Kalibrier-Storage, Canvas-/Flicker-/Gate-Verdrahtung, Zustands-Reset und Schleifen-Robustheit |
| `tests/test_exposure_budget.js` | **7 Tests** für das Zeitbudget von `tuneExposure` (simulierte Uhr) |
| `tests/test_sw_fallback.js` | **8 Tests** für den Service-Worker (Offline-Fallback, Cache-Regeln) |
| `patches/` | Gestaffelte Patches der letzten Stufen (Review-Nachvollziehbarkeit) |

## Tests

```bash
node tests/test_pipeline.js         # 110/110 erwartet (kein Browser nötig)
node tests/test_calib_storage.js    # 30/30 erwartet
node tests/test_exposure_budget.js  #  7/7  erwartet
node tests/test_sw_fallback.js      #  8/8  erwartet
```

`test_pipeline.js` extrahiert den `PURE-PIPELINE`-Block aus `index.html` und testet ihn gegen synthetische Frames: EOTF-Endpunkte/Knie, Frame-Analyse, Flicker-Regressionen, FSM, Profile, Kalman, Uniformität, Q-Komponenten, Unsicherheits-Szenarien, Schwarzwert-Subtraktion, Zwei-Punkt-Fit inkl. Guards und Clamp-Konsistenz, Median-Vorfilter, Q-Gate-Abgrenzung (dunkle Szene und Lichtwechsel dürfen nicht halten), Flicker-Hysterese, Kalman-Reset beim Moduswechsel und den Unsicherheits-Boden (inkl. Abgleich gegen die Zahlen in diesem README).

`test_calib_storage.js` lädt das echte `<script>` in eine minimale DOM-/`localStorage`-Attrappe und prüft Kalibrier-Storage (Profilbindung, Legacy-Fallback, vollständiges Zurücksetzen) sowie die Canvas-Verdrahtung — dass `canvas.width/height` aus `PROC_W`/`PROC_H` kommen und im Skript keine nackten `320`/`240`-Literale mehr stehen.

`test_exposure_budget.js` fährt `tuneExposure()` mit einer **simulierten Uhr** (`setTimeout` lässt die Uhr springen und löst sofort auf) gegen Track-Attrappen: dass der Verify-Schritt nur startet, wenn er noch vollständig ins 8-s-Budget passt, dass eine bewegte Settings-Meldung als Beleg zählt und ein quantisierender Treiber keinen liefert.

`test_sw_fallback.js` lädt `sw.js` in eine `ServiceWorkerGlobalScope`-Attrappe: die App-Shell darf nur bei Navigationen als Offline-Fallback kommen, ein fehlgeschlagenes Bild oder JSON bekommt einen echten Netzwerkfehler statt HTML.

## Entstehung & Credits

Dieses Projekt wurde in Zusammenarbeit mit KI-Assistenten entwickelt — namentlich **Kimi (Moonshot AI)** und **Claude (Anthropic)**. Beide waren an Code-Reviews, der stufenweisen Architektur (Messkorrektheit → Konfidenzschicht → Zwei-Punkt-Kalibrierung → PWA), Fehleranalysen und Fixes beteiligt; Richtung, Entscheidungen und Feldtests lagen beim Projektinhaber. Weitere Modelle (u. a. Gemini, GLM) lieferten Review-Perspektiven, die kritisch geprüft und teils übernommen wurden.

## Lizenz

Siehe [LICENSE](LICENSE).
