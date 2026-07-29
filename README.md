# PPFD Meter Pro

**Smartphone-Kamera-basierte PPFD/PAR-Messung für Pflanzenbeleuchtung — als installierbare PWA, komplett offline-fähig, ohne App-Store.**

Die App verwandelt die Handykamera in ein PPFD-Messgerät (µmol·m⁻²·s⁻¹): Sie linearisiert die Kamerapixel exakt (sRGB-EOTF nach IEC 61966-2-1), gewichtet spektral nach Lichtquellen-Profil, rechnet physikalisch auf PPFD um und gibt zu jedem Messwert eine **Qualitätsbewertung (Q)** und eine **GUM-inspirierte Messunsicherheit (±%)** aus.

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
- **Lichtquellen-Profile** (Sonnenlicht, weiße LED, LED Grow, HPS, MH, Leuchtstoff) mit Faktor + nominaler Unsicherheit, Auto-Erkennung oder manuelle Wahl (persistiert)
- **Qualitätsindex Q** = Q_clip × Q_uniformity × Q_signal × Q_stability (3×3-Zonen-CV, Temporal-CV) — rein advisory, verändert keine Messwerte
- **Unsicherheitsbudget** u_rel = √(u_cal² + u_profile² + u_temporal² + u_noise²), ehrlich: ±35 % unkalibriert vs. ±5 % kalibriert
- **Status-Checkliste** (✓/⚠ Übersteuerung, Gleichmäßigkeit, Signal, Stabilität) mit handlungsleitenden Hinweisen
- **Robustheit:** adaptiver Kalman, Rolling-Shutter-Flickererkennung mit Periodizitäts-Check, PWM-robuste Belichtungs-Verifikation, Watchdog-gehärteter Kamerastart, WakeLock, Trainingsdaten-CSV-Export (injektionssicher)
- **PWA:** `manifest.json` + `sw.js` (cache-first, versionsierter Cache), Icons inkl. maskable

## Repo-Layout

| Pfad | Inhalt |
|---|---|
| `index.html` | **Die komplette App** — bewusst single-file, kein Build-Step |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | PWA-Infrastruktur |
| `tests/test_pipeline.js` | Node-Regressions-Harness, **55 Tests** gegen den extrahierten Pure-Pipeline-Block |
| `patches/` | Gestaffelte Patches der letzten Stufen (Review-Nachvollziehbarkeit) |

## Tests

```bash
node tests/test_pipeline.js   # 55/55 erwartet (kein Browser nötig)
```

Der Harness extrahiert den `PURE-PIPELINE`-Block aus `index.html` und testet ihn gegen synthetische Frames: EOTF-Endpunkte/Knie, Frame-Analyse, Flicker-Regressionen, FSM, Profile, Kalman, Uniformität, Q-Komponenten, Unsicherheits-Szenarien, Schwarzwert-Subtraktion, Zwei-Punkt-Fit inkl. Guards und Clamp-Konsistenz.

## Entstehung & Credits

Dieses Projekt wurde in Zusammenarbeit mit KI-Assistenten entwickelt — namentlich **Kimi (Moonshot AI)** und **Claude (Anthropic)**. Beide waren an Code-Reviews, der stufenweisen Architektur (Messkorrektheit → Konfidenzschicht → Zwei-Punkt-Kalibrierung → PWA), Fehleranalysen und Fixes beteiligt; Richtung, Entscheidungen und Feldtests lagen beim Projektinhaber. Weitere Modelle (u. a. Gemini, GLM) lieferten Review-Perspektiven, die kritisch geprüft und teils übernommen wurden.

## Lizenz

Siehe [LICENSE](LICENSE).
