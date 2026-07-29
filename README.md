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
- **Robustheit:** Median-Vorfilter (N=5) + adaptiver Kalman, Q-Gate gegen Schrottframes, Rolling-Shutter-Flickererkennung mit Periodizitäts-Check, PWM-robuste Belichtungs-Verifikation, Watchdog-gehärteter Kamerastart, WakeLock, Trainingsdaten-CSV-Export (injektionssicher)
- **PWA:** `manifest.json` + `sw.js` (cache-first, versionsierter Cache), Icons inkl. maskable

## Repo-Layout

| Pfad | Inhalt |
|---|---|
| `index.html` | **Die komplette App** — bewusst single-file, kein Build-Step |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | PWA-Infrastruktur |
| `tests/test_pipeline.js` | Node-Regressions-Harness, **68 Tests** gegen den extrahierten Pure-Pipeline-Block |
| `tests/test_calib_storage.js` | Integrations-Harness, **9 Tests** für den Kalibrier-Storage (Profilbindung, Legacy-Fallback) |
| `patches/` | Gestaffelte Patches der letzten Stufen (Review-Nachvollziehbarkeit) |

## Tests

```bash
node tests/test_pipeline.js        # 68/68 erwartet (kein Browser nötig)
node tests/test_calib_storage.js   #   9/9 erwartet
```

`test_pipeline.js` extrahiert den `PURE-PIPELINE`-Block aus `index.html` und testet ihn gegen synthetische Frames: EOTF-Endpunkte/Knie, Frame-Analyse, Flicker-Regressionen, FSM, Profile, Kalman, Uniformität, Q-Komponenten, Unsicherheits-Szenarien, Schwarzwert-Subtraktion, Zwei-Punkt-Fit inkl. Guards und Clamp-Konsistenz, Median-Vorfilter und Q-Gate-Schwellen.

`test_calib_storage.js` lädt das echte `<script>` in eine minimale DOM-/`localStorage`-Attrappe und prüft den Kalibrier-Storage end-to-end — Profilbindung, Legacy-Fallback und dass `resetCalibration()` alle drei Storage-Generationen räumt.

## Entstehung & Credits

Dieses Projekt wurde in Zusammenarbeit mit KI-Assistenten entwickelt — namentlich **Kimi (Moonshot AI)** und **Claude (Anthropic)**. Beide waren an Code-Reviews, der stufenweisen Architektur (Messkorrektheit → Konfidenzschicht → Zwei-Punkt-Kalibrierung → PWA), Fehleranalysen und Fixes beteiligt; Richtung, Entscheidungen und Feldtests lagen beim Projektinhaber. Weitere Modelle (u. a. Gemini, GLM) lieferten Review-Perspektiven, die kritisch geprüft und teils übernommen wurden.

## Lizenz

Siehe [LICENSE](LICENSE).
