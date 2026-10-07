# PPFD Meter Pro

**Smartphone-Kamera-basierte PPFD/PAR-Messung für Pflanzenbeleuchtung — als installierbare PWA, komplett offline-fähig, ohne App-Store.**

Die App schätzt mit der Handykamera die PPFD ab (µmol·m⁻²·s⁻¹): Sie linearisiert die Kamerapixel mit der exakten sRGB-Kennlinie (IEC 61966-2-1), gewichtet spektral nach Lichtquellen-Profil, rechnet über die Belichtungsgleichung (Bildhelligkeit, Belichtungszeit, ISO) auf PPFD um und gibt zu jedem Messwert eine **Qualitätsbewertung (Q)** und eine **GUM-inspirierte erweiterte Messunsicherheit (± %, k = 2)** aus. Absolut belastbar wird der Wert erst mit Kosinus-Korrektor und Kalibrierung — ohne beides taugt er vor allem für Vergleiche im selben Aufbau.

> **Empfohlener Aufbau: Kosinus-Korrektor *und* Kalibrierung.**
> Wir empfehlen ausdrücklich das [**Lightray Diffusor- & Kosinuskorrektor-Zubehör**](https://lightray.io/de/diffuser/) der Lightray Innovation GmbH vor der Frontkamera. **Auch der Kosinus-Korrektor muss in der App kalibriert werden** — einmalig gegen ein Referenz-PAR-Meter. Beides ergänzt sich, keins ersetzt das andere: Der Korrektor sorgt dafür, dass das Licht *aus allen Richtungen richtig gewichtet* wird; die Kalibrierung legt die *absolute Skala* fest. Papier ist nur ein Notbehelf zum Ausprobieren.

## Live

👉 **https://hazeberry.github.io/PPFD-PWA/** (HTTPS ist Kamera-Voraussetzung)

Auf dem Smartphone: Seite öffnen → Browser-Menü → **„Zum Startbildschirm hinzufügen“** → App-Icon auf dem Homescreen, danach komplett offline nutzbar (Service Worker cached alles lokal).

## Bedienung in 3 Schritten

1. **Diffusor:** Für belastbare Werte gehört ein echter **Kosinus-Korrektor** vor die Kamera — empfohlen ist das [**Lightray Diffusor- & Kosinuskorrektor-Zubehör**](https://lightray.io/de/diffuser/) der Lightray Innovation GmbH (Clip mit Gummidichtung vor der Frontkamera). **Papier ist nur ein Notbehelf** zum Ausprobieren: 2–3 Lagen weißes Kopierpapier (80 g/m²) auf die Linse legen.
2. **Kamera aktivieren und einschwingen lassen** (300 Frames, je nach Bildrate 5–10 s): Kamera, Bildverarbeitung und Lichtquellen-Erkennung stellen sich nach dem Start ein. Erst danach erscheint der Messwert — und erst dann lässt sich kalibrieren oder ein Trainingspunkt speichern. Eine Temperatur misst die App dabei nicht; bis v3.4.17 hieß diese Phase irreführend „Aufwärmen".
3. **Kalibrieren — auch mit Kosinus-Korrektor, und zwar mit genau dem Diffusor, mit dem du misst** (einmalig pro Kamera und Lichtprofil): Referenz-PAR-Meter danebenhalten, Wert eingeben. Jeder Diffusor schwächt das Licht um einen eigenen Faktor, den die App nicht kennen kann; ohne Kalibrierung bleibt die angezeigte Unsicherheit deshalb bei rund ±72 % — mit Korrektor genauso wie mit Papier. Wechselst du den Diffusor (Papier ↔ Kosinus-Korrektor, andere Halterung), im Kalibrier-Dialog erst **Reset**, dann neu kalibrieren (siehe „Bekannte Grenzen", Punkt 2). Optional **Zwei-Punkt-Kalibrierung** bei deutlich anderer Helligkeit — ersetzt die reine Steigung durch `Steigung·raw + Offset` und kompensiert Sensor-Nichtlinearität über den Dynamikbereich. Die App merkt sich die Rohwerte der Stützstellen und **warnt, sobald du außerhalb des kalibrierten Bereichs misst** (z. B. bei stark abweichender Dimmstufe).

Optional: **Schwarzwert messen** (Linse abdecken) korrigiert den Dunkeloffset pixelgenau pro Kamera.

**Warum Kosinus-Korrektor?** PPFD ist eine flächenbezogene Größe — die Sensorantwort muss dem Lambertschen Kosinusgesetz folgen. Papier streut und dämpft zwar, besitzt aber keine definierte Kosinus-Richtcharakteristik; die Winkelabhängigkeit bleibt unbestimmt und gerätespezifisch. Genau diese Eigenschaft beschreibt die Norm **ISO/CIE 19476** über den Güteindex **f₂** (directional response, Kosinusgesetz-Abweichung) — formal für Beleuchtungsstärke-/Leuchtdichtemesser, aber dasselbe Konzept, mit dem auch PAR-Sensoren ihre Kosinus-Korrektur spezifizieren.

## So misst du richtig

Die App rechnet sauber — ob die Zahl stimmt, entscheidet sich aber vor allem daran, *wie* das Handy liegt. Haltung und Position verändern den Wert um Größenordnungen, mehr als alles andere.

1. **Kamera im Licht starten.** Beim Start stellt die App die Belichtung ein. Ist die Kamera dabei abgedeckt oder zeigt nach unten, findet sie kein brauchbares Bild, fährt bis zur längsten Belichtung und fällt auf die Auto-Belichtung des Handys zurück. Erkennbar an *Hardware-Modus: Software (exposure-out-of-range)* und `→FALLBACK` in der Debug-Zeile. Dann einfach unter der Lampe neu starten — es soll **Manuell** dastehen: Nur dort kennt die App die Belichtungszeit selbst, statt sie vom Handy erfragen zu müssen.
2. **Handy flach auf Höhe der Pflanzenspitzen, Frontkamera nach oben** — parallel zu der Fläche, die du messen willst. **Nicht auf die Lampe zielen.** PPFD ist eine flächenbezogene Größe; ein gekippter Sensor bekommt tatsächlich weniger Licht ab, auch ein echtes PAR-Meter zeigt dann weniger:

   | Neigung zur Lampe | korrekter Messwert |
   |---|---|
   | 0° | 100 % |
   | 30° | 87 % |
   | 45° | 71 % |
   | 60° | 50 % |

3. **Kosinus-Korrektor statt Papier.** Damit die Anzeige beim Neigen dem Verlauf der Tabelle folgt, muss der Diffusor eine definierte Kosinus-Charakteristik haben — genau dafür ist der [Lightray-Kosinuskorrektor](https://lightray.io/de/diffuser/) gebaut. Papier hat keine: Die Handykamera sieht nur einen begrenzten Winkel und wird zum Bildrand hin dunkler, Papier gleicht das nur teilweise aus. **Wenn es vorerst Papier sein muss, dann 2–3 Lagen, nicht eine** — durch ein einzelnes Blatt scheint die Lampe als heller Fleck durch, der Wert schwankt je nachdem, wo im Bild er landet, und fällt beim Kippen viel steiler ab als in der Tabelle. Mit Papier gemessene Werte sind gut für Vergleiche im selben Aufbau, für absolute Angaben aber nur grob. **Und auch mit Kosinus-Korrektor gilt: erst nach der Kalibrierung stimmt die Skala** (Bedienung, Schritt 3).
4. **Lichtquelle manuell wählen.** Die Auto-Erkennung kennt nur Sonnenlicht, HPS und Leuchtstoff — eine weiße LED-Lampe zeigt sie als „Sonnenlicht" an. Der Faktor ist zufällig derselbe, die ausgewiesene Unsicherheit aber höher. Moderne Grow-LEDs mit Weißlicht-Basis gehören auf „Weiße LED".
5. **Stillhalten, bis die Messqualität grün ist.** Die Anzeige wird geglättet und braucht nach jeder Bewegung einige Sekunden. Flackert die Lampe (*FLICKER_WARN*), schwankt der Wert stärker — länger halten.
6. **Jedes Mal gleich messen.** Gleiche Höhe, gleiche Stelle, gleiches Papier.

**Kontrollblick vor dem Ablesen:** *Hardware-Modus: Manuell* · *Clipping: OK* · *Signal: OK* · *Messqualität* grün (ab 85 %). Steht in der Debug-Zeile `clip↓ …`, hat die App eine Übersteuerung selbst korrigiert (siehe „Bekannte Grenzen", Punkt 4) — das ist in Ordnung.

**Vergleichen ist genauer als die Zahl.** Ohne Kalibrierung zeigt die App rund ±72 %. Das ist fast vollständig ein *Skalenfehler*: Er bleibt gleich, solange Handy, Papier und Lampe gleich bleiben. Fragen wie „Ist es 20 cm tiefer doppelt so hell?" beantwortet die App deshalb deutlich genauer als die ±72 % vermuten lassen. Für belastbare absolute Werte einmal gegen ein Referenz-PAR-Meter kalibrieren.

**Eigenen Aufbau prüfen (optional):** Lampe fest, Handy bei 0°, 30°, 45° und 60° Neigung jeweils stillhalten, Werte notieren und auf den 0°-Wert beziehen. Der Vergleich mit der Tabelle in Schritt 2 zeigt, wie weit dein Diffusor vom Kosinus-Ideal abweicht.

## Was drinsteckt

- **sRGB-Linearisierung mit der exakten Kennlinie** (IEC 61966-2-1 statt γ≈2,2-Näherung), BT.709-Luma, lineare Domäne für alle Statistiken. Exakt ist dabei die *Umkehrung der sRGB-Kurve* — nicht zwingend die Linearität der Pixel: Handys legen Tonkurven, HDR-Effekte und Rauschfilter über das Bild, bevor die App es sieht. Was davon übrig bleibt, fängt die Kalibrierung auf; die Zwei-Punkt-Kalibrierung in erster Näherung auch über den Helligkeitsbereich
- **Umrechnung über die Belichtungsgleichung** der Fotografie: Die linearisierte Bildhelligkeit wird durch Belichtungszeit und ISO geteilt — beide liest die App live von der Kamera —, mit dem Quadrat der Blendenzahl multipliziert und über eine Skalenkonstante und den Profilfaktor auf PPFD gebracht. **Physikalisch ist die Form, nicht jede Zahl darin:** Die Blende ist für jedes Handy fest mit f/2 angenommen (echte Handy-Blenden liegen grob zwischen f/1,7 und f/2,4 — allein das ist bis zu Faktor 2), die Skalenkonstante (1284) ist ein empirischer Platzhalter, und es gibt pauschale Abschläge, die sogar *stufenweise* greifen: −5 % über ISO 400, −12 % über ISO 800 (betrifft vor allem den Auto-Modus, in dem sich die ISO ändert) und −2 % bei Belichtungen länger als 1/30 s. Die absolute Skala liefert deshalb die Kalibrierung. Dass die Form trägt, zeigt ein Feldtest: Zwei Messungen mit 4 ms und 1 ms Belichtung ergaben im Verhältnis stimmige Werte. Die ISO-Stufen bleiben vorerst — ohne Vergleichsmessungen wäre jede glattere Kurve genauso geraten.
- **Lichtquellen-Profile** (Sonnenlicht, weiße LED, Blurple-Panel, HPS, MH, Leuchtstoff) mit Faktor + nominaler Unsicherheit. Auto-Erkennung nur für die drei Klassen, die sich in der RGB-Chromatizität belastbar trennen lassen (Sonnenlicht, HPS, Leuchtstoff) — der Rest ist manuell wählbar. **Moderne Grow-LEDs mit Weißlicht-Basis gehören auf „Weiße LED“**: ihren 660-nm-Rot-Boost bewertet die Kamera im Verhältnis zu seinen Photonen **deutlich zu schwach**. Unsichtbar ist er nicht — der Rotkanal registriert 660 nm —, aber der Infrarot-Sperrfilter vor dem Sensor dämpft dort bereits, und die Bildverarbeitung zielt auf augenähnliche Farben. Zur Größenordnung: Das *Auge* ist bei 660 nm rund achtmal unempfindlicher als bei 610 nm (V(λ) ≈ 0,06 gegen ≈ 0,50); die Kurve der Kamera ist das nicht, sie ist gerätespezifisch. Ohne Kalibrierung fällt der Wert unter solchen Lampen deshalb zu niedrig aus. Die Nutzer-Kalibrierung wird **pro Kamera und Profil** gespeichert — der Profilfaktor wirkt auf die PAR-Gewichtung, nicht auf Lux, und dieser Versatz ist profilabhängig
- **Qualitätsindex Q** = Q_clip × Q_uniformity × Q_signal × Q_stability (3×3-Zonen-CV, Temporal-CV) als Güte-Anzeige. Der **Kalman-Halt** läuft bewusst auf einem engeren Kriterium (`Q_clip × Q_uniformity < 0.35`): nur wenn der *Frame die Szene nicht abbildet* — übersteuert oder ungleich ausgeleuchtet — wird der letzte Wert gehalten. Wenig Signal und hohe zeitliche Streuung sind *Messergebnisse*, keine Haltegründe: wird es dunkel, läuft die Anzeige gegen 0, statt einzufrieren.

  Dazu gehört eine zweite Bedingung, ohne die genau dieses Versprechen bricht: **die Uniformitäts-Achse zählt im Halte-Kriterium erst ab `yMean_lin ≥ 0.02`** (seit v3.4.8). `Q_uniformity` beruht auf `CV = std / zMean` — ein Nenner, der gegen 0 geht. Im Dunkeln wächst CV allein durch Rauschen, `Q_uniformity` fiele auf 0, und die Anzeige würde einfrieren: derselbe Fehler wie vorher, nur über eine andere Achse. Unterhalb der Schwelle gilt die Achse deshalb als unbeurteilbar und gatet nicht. In der *Anzeige* bleibt `Q_uniformity` unverändert ehrlich — eine im Dunkeln unbeurteilbare Ausleuchtung ist zu Recht ein Gütemangel
- **Unsicherheitsbudget** u_rel = √(u_cal² + u_profile² + u_temporal² + u_noise²). Angezeigt wird die **erweiterte** Unsicherheit (k = 2). Die Teilbeiträge sind **begründete Annahmen, nicht gegen Referenzmessungen geprüft** — `u_cal` (5 % kalibriert, 35 % unkalibriert) und die Profil-Unsicherheiten (5–10 %) sind gesetzt, nur `u_temporal` und `u_noise` kommen aus dem laufenden Bild. Deshalb nennt die App bewusst **keine Trefferquote**: Die bei k = 2 übliche Lesart „≈ 95 % der Messungen liegen im Bereich" gilt nur, wenn diese Annahmen stimmen. Nachzählen lässt sich das mit dem CSV-Export und `tools/auswertung.js` (siehe „Trainingsdaten auswerten“), über viele *unabhängige* Aufbauten. Realistische Spanne — kalibrieren bringt den größten Sprung, hat aber einen harten Boden bei **±14 %** (siehe „Bekannte Grenzen"):

  | Lage | angezeigt (k = 2) |
  |---|---|
  | unkalibriert + Auto-Erkennung (Auslieferungszustand) | ±73 % |
  | unkalibriert, Profil manuell gewählt | ±71 % |
  | kalibriert, Blurple-Panel oder Auto-Erkennung | ±22 % |
  | kalibriert, weiße LED manuell | ±19 % |
  | kalibriert, Sonnenlicht/HPS manuell | **±14 %** ← Boden |

  Der CSV-Export führt die Standardunsicherheit (k = 1) in der Spalte `uRel_k1`.
- **Status-Checkliste** (✓/⚠ Übersteuerung, Gleichmäßigkeit, Signal, Stabilität) mit handlungsleitenden Hinweisen
- **Robustheit:** Median-Vorfilter (N=5) + adaptiver Kalman, Q-Gate gegen unrepräsentative Frames, Rolling-Shutter-Flickererkennung mit Periodizitäts-Check und Hysterese in Detektionen statt Frames, PWM-robuste Belichtungs-Verifikation, stufenweises Herunterregeln bei dauerhaftem Übersteuern im Manuell-Modus, Watchdog-gehärteter Kamerastart, gegen Canvas-Fehler abgesicherte Messschleife, WakeLock, Trainingsdaten-CSV-Export (injektionssicher)
- **PWA:** `manifest.json` + `sw.js` (cache-first, versionsierter Cache), Icons inkl. maskable

## Bekannte Grenzen

Fünf Punkte aus dem Code-Review und aus Feldbeobachtungen. Keiner davon ist ein Rechenfehler — es sind Eigenschaften der Messkette, an denen eine Produkt- oder Anzeige-Entscheidung hängt. Wo seither nachgebessert wurde, steht es beim jeweiligen Punkt („seit v…"); offen bleibt dort jeweils die Entscheidung, nicht die Analyse. Wer die App ernsthaft benutzt, sollte alle fünf kennen.

### 1. Zwei-Punkt-Kalibrierung kann eine Null-Zone erzeugen

Bei negativem Offset klemmt die Pipeline alles unterhalb von `|Offset| / Steigung` auf exakt **0**. Das passiert bei völlig plausiblen Kalibrierpunkten und schlägt kein Guard an:

| Punkte | Fit | ab hier wird 0 gemeldet |
|---|---|---|
| 100 → 90 und 900 → 1010 | `×1.1500 −25.0` | raw < **21,7** |

Im schwachen Licht (Zeltrand, Dämmerung) zeigt das Gerät dann 0. Der Fit ist dort schlicht extrapoliert, und `u_cal` bildet das nicht ab. **Seit v3.4.10 ist es immerhin nicht mehr still** — die App warnt, sobald der Rohwert die Null-Zone oder allgemein den kalibrierten Bereich verlässt. Die angezeigte Unsicherheit bleibt bewusst unverändert: Extrapolation ist eine echte Unsicherheitsquelle, aber ihre Größe ist ohne Vergleichsmessungen nicht bezifferbar.

**Erkennen:** Seit v3.4.10 meldet die App das selbst — unterhalb der Schwelle erscheint unter dem Messwert eine gelbe Warnzeile: „⚠ Unter der Null-Zone der Kalibrierung (ab Rohwert X geklemmt) – die Anzeige ist hier keine Messung". Zusätzlich zeigt der Kalibrier-Dialog den Offset mit Vorzeichen; steht dort ein Minus, ist der Betrag durch die Steigung die Schwelle.
**Umgehen:** Für Messungen im unteren Bereich die Ein-Punkt-Kalibrierung benutzen — sie ist konstruktionsbedingt offsetfrei. Achtung, das erfordert **Zurücksetzen**: ein neuer Punkt landet sonst als zweiter Stützpunkt und der Offset ist wieder da (siehe Punkt 2).

### 2. Der erste Kalibrierpunkt ist unlöschbar

Nach dem ersten gespeicherten Punkt ersetzt jede weitere Kalibrierung nur noch `p2`. Ein veralteter `p1` — etwa aus einem anderen Diffusor-Aufbau — zieht die Gerade schief, während die Anzeige „(2 Punkte)" nach mehr Genauigkeit aussieht.

**Umgehen:** Bei geändertem optischem Aufbau (Wechsel Papier ↔ Kosinus-Korrektor, andere Halterung) erst **Zurücksetzen**, dann neu kalibrieren. Ein bloßes Nachkalibrieren behält den alten ersten Punkt.

**Was Zurücksetzen räumt (seit v3.4.8):** alle Lichtprofile der **aktuellen Kamera**, nicht nur das gerade gewählte — ein geänderter Aufbau entwertet jedes Profil gleichermaßen, der Diffusor sitzt vor dem Sensor. Bis v3.4.7 blieb unter den übrigen Profilen still die Kalibrierung des alten Aufbaus stehen und lieferte beim nächsten Profilwechsel unbemerkt falsche Werte. Die **andere Kamera** wird nicht mitgeräumt (eigener Sensor) — liegt dort noch etwas, sagt die Meldung nach dem Zurücksetzen, wie viel.

### 3. Q kennt keinen Belichtungs-Faktor

Der Qualitätsindex ist das Produkt aus Clipping, Homogenität, Signal und Stabilität. Ob die Belichtung ihr Zielband (Y 25–220) je erreicht hat, geht **nicht** ein — eine Sitzung dauerhaft außerhalb des Bands meldet weiterhin Q = 100 %.

Das ist kein Widerspruch in sich: Wurde der manuelle Lock nachgewiesen (`(verify…)` im Trail), läuft die Messung bewusst weiter, statt auf Auto-Belichtung zurückzufallen — dieses Verhalten ist gewollt. Q behauptet dann aber mehr Sicherheit, als der Belichtungszustand hergibt.

**Erkennen:** Die Zeile *Debug: Exposure raw* zeigt bei manuellem Hardware-Modus `… Y=<Wert> …`. Liegt der weit außerhalb von 25–220, arbeitet der Sensor abseits seines Auslegungspunkts, unabhängig davon was Q sagt.

### 4. Das Belichtungs-Zielband lässt Übersteuerung zu

Punkt 3 beschreibt den Fall *außerhalb* des Zielbands. Der gefährlichere ist der umgekehrte: **innerhalb** des Bands und trotzdem übersteuert.

`targetBandMet` prüft nur den Bild-Mittelwert (`y >= 25 && y <= 220`). Ein Mittelwert von 208 gilt damit als gelungene Belichtung — bei realer Ausleuchtungs-Schieflage sättigt dort aber bereits ein erheblicher Teil der Pixel. Übersteuerte Pixel werden bei 255 gekappt, der gemessene Mittelwert fällt dadurch **zu niedrig** aus, und die Anzeige mit ihm. Die App meldet in dieser Lage keinen Belichtungsfehler, weil das Band ja erfüllt ist.

Dazu kommt, dass der Belichtungs-Arbeitspunkt grob gestuft ist. Zwei Sitzungen auf derselben Szene, zwei Minuten auseinander:

| | Trail | gelandet bei | Y | Anzeige |
|---|---|---|---|---|
| Lauf A | `40→160→40` | 40 → 0,004 s | 150,5 | **163** µmol |
| Lauf B | `40→160` | 160 → 0,016 s | 208,5 | **45** µmol |

Lauf B löste `Sensor dauerhaft übersteuert` aus — diese Meldung kommt erst nach 90 aufeinanderfolgenden Frames mit kritischem Clipping.

Dass zwischen den beiden Arbeitspunkten nichts liegt, ist kein Zufall: die Tuning-Rampe verändert die Belichtungszeit ausschließlich in **Vierer-Schritten** (`req*4` bzw. `req/4`, begrenzt durch die Treiber-Range). Es gibt also keine Zwischenstufe, auf der die Belichtung hätte landen können — welchen der beiden Punkte man erwischt, kippt bei marginaler Szenenhelligkeit.

Eigentlich sollte das egal sein: PPFD ist proportional zu `Y_linear / Belichtungszeit`, die Belichtung kürzt sich also heraus. Rechnet man beide Zeilen mit der exakten EOTF durch, bleibt nach dieser Normierung trotzdem ein Faktor ≈ 1,9 (angezeigt sind 3,6). Die Normierung kompensiert also nur die Hälfte; der Rest passt in Richtung und Größenordnung zum Clipping-Bias. Belastbar ist die Zahl nicht — das Debug-`Y` stammt aus dem Tuning-Moment, nicht aus dem Frame der Anzeige, und die Szene kann sich zwischen den Läufen geändert haben.

**Seit v3.4.14 regelt der Manuell-Modus nach.** Bis v3.4.13 gab es dort keine Gegenmaßnahme: die EV-Korrektur griff nur im Software-Gain-Modus, sonst erschien genau *ein* Hinweis, ein Flag rastete ein, und die Messung lief mit übersteuertem Sensor weiter bis zum Neustart. Jetzt wird nach 90 Frames kritischem Clipping die Belichtung um **eine Stufe gekürzt** — dieselbe Vierer-Stufe wie in der Tuning-Rampe, der Manuell-Modus bleibt. Hält das Clipping an, folgt nach weiteren 90 Frames die nächste Stufe. Erst wenn der Treiber am Minimum ist oder die Anforderung ignoriert, kommt der Hinweis auf Diffusor und Abstand; dann hilft nur noch Physik.

Bewusst **nicht** der Rückfall auf Auto-Belichtung: ein nachgewiesener manueller Lock ist die bessere Messkette (ruhigerer Kalman, kein Nachregeln durch die Kamera-Automatik), und das Projekt hält ihn auch sonst, statt zurückzufallen (Punkt 3). Während der Umstellung (~0,5 s) hält die Anzeige ihren letzten Wert, übernommen wird die vom Treiber *gemeldete* Belichtung, nicht die angeforderte, und der Belichtungs-Drift-Check setzt seine Baseline um — sonst hielte er die eigene Stufe für Drift und schaltete doch auf Auto.

**Was bleibt:** Das Zielband selbst prüft weiter nur den Mittelwert. Eine Sitzung kann also nach wie vor übersteuert *landen*; sie korrigiert sich jetzt aber nach rund 1,5–3 s (90 Frames bei 60 bzw. 30 fps) selbst, statt bis zum Neustart falsch zu messen. Das Band zusätzlich an den Clipping-Anteil zu koppeln, würde schon das Landen verhindern — die naheliegende nächste Stufe, falls die Selbstkorrektur im Feld nicht reicht.

**Nach einer Stufe wird nie wieder hochgeregelt (seit v3.4.16 mit Hinweis).** Gehst du danach an eine deutlich dunklere Stelle, bleibt die Belichtung kurz, das Signal wird schwach und der Wert rauschig — im Mittel weiter richtig, weil die Formel die Belichtung herausrechnet. Bleibt das Signal rund 3 s (180 Frames) am Stück schwach, meldet die App „Signal schwach – die Belichtung wurde vorhin wegen Übersteuerung gekürzt …" mit dem Rat, die Kamera neu zu starten; der Neustart stellt die Belichtung neu ein. Einmal pro Stufe, kurzes Vorbeischwenken an einer dunklen Stelle löst nichts aus. Bewusst **kein automatisches Hochregeln**: das könnte pendeln (hoch → übersteuert → runter → …), weil ein dunkler Mittelwert einzelne gesättigte Pixel nicht ausschließt — etwa die Lampe als heller Fleck hinter einer einzelnen Lage Papier. Kommt der Hinweis direkt nach der Korrektur, ohne dass du dich bewegt hast, ist das Bild zu ungleichmäßig für eine einzige Belichtung: Abstand erhöhen oder den Kosinus-Korrektor verwenden.

**Erkennen:** Der Hinweis „Dauerhaft übersteuert – Belichtung eine Stufe kürzer (… → … ms)" und in der Zeile *Debug: Exposure raw* ein angehängtes `clip↓ …→…ms`. Kommt stattdessen „Sensor dauerhaft übersteuert – Abstand zur Lampe erhöhen oder Diffusor prüfen …", ist die Software am Ende.

**Umgehen** (nur noch im letzten Fall nötig): Abstand zur Lampe vergrößern bzw. den Diffusor prüfen — mit Papier notfalls eine Lage mehr; nach jedem Diffusor-Wechsel neu kalibrieren. Eine Kalibrierung gilt streng genommen nur für den Arbeitspunkt, an dem sie erhoben wurde; der CSV-Export führt `exposureTime` und `sessionId` mit, sodass sich ein Versatz zwischen Arbeitspunkten an echten Daten nachmessen lässt.

### 5. Die angezeigte Unsicherheit hat einen Boden bei ±14 %

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

## Trainingsdaten auswerten

Die App kann Messpunkte mit Referenzwert sammeln (*Trainingsdaten* → Punkt speichern → *CSV exportieren*). `tools/auswertung.js` beantwortet damit zwei Fragen — ohne Abhängigkeiten, nur Node:

```bash
node tools/auswertung.js ppfd_traindata_….csv              # Bericht
node tools/auswertung.js export.csv --geraet "Galaxy S23"  # nur ein Gerät
node tools/auswertung.js export.csv --json                 # maschinenlesbar
```

1. **Stimmt die angezeigte Unsicherheit?** Anteil der Referenzwerte, die im angezeigten Bereich ±k·uRel liegen — getrennt nach kalibriert/unkalibriert und zusätzlich *pro Sitzung gemittelt*, damit eine große Sitzung nicht dominiert. Liegt k = 2 über viele Sitzungen deutlich unter 95 %, ist die angezeigte Unsicherheit zu klein.
2. **Bringt eine Korrektur etwas?** Verglichen werden einfache, physikalisch begründete Modelle für den Faktor Referenz/Rohwert: global, abhängig von der Helligkeit, von den Farbanteilen (Spektrum der Lampe), oder beides. Validiert mit **GroupKFold nach `sessionId`**: Jede Sitzung wird vorhergesagt, ohne dass das Modell sie gesehen hat. Ein Modell gilt nur als besser, wenn es in signifikant mehr *Sitzungen* gewinnt (Vorzeichentest, Bonferroni über die Kandidaten) **und** mindestens 10 % genauer ist.

**Warum nach Sitzung gruppiert?** Punkte derselben Sitzung teilen Diffusor-Aufbau und Haltung. Eine Kreuzvalidierung, die sie auf Trainings- und Testseite verteilt, misst sich selbst — 300 Punkte aus 12 Sitzungen sind statistisch eher 12 als 300. Der Bericht zeigt das direkt: Er validiert ein Modell zusätzlich *ungruppiert* und nennt, um wie viel besser es dort aussieht, als es für eine neue Sitzung ist.

**Wie viele Daten?** Die ehrliche Stichprobengröße ist die Zahl der **Sitzungen**. Für die Unsicherheitsfrage braucht es grob 10 und mehr; im Modellvergleich findet die Auswertung mit 8 Sitzungen nur sehr deutliche Effekte (in Simulationen ~2 von 3), mit 16 fast immer. „Kein belastbarer Gewinn“ heißt bei wenigen Sitzungen deshalb *nicht nachweisbar*, nicht *nicht vorhanden*. Eine Sitzung ist ein Kamerastart: für jede neue Sitzung Kamera stoppen, Diffusor neu anlegen, neu starten, dann 3–5 Punkte bei unterschiedlicher Helligkeit.

**Bewusst noch nicht drin:** flexiblere Modelle (neuronales Netz, Gradient Boosting). Solange die einfachen nicht gemessen sind, gibt es nichts, wogegen sich ein flexibleres behaupten müsste — und die bräuchten Python-Abhängigkeiten. Gruppierung, Metrik und Gegenprobe sind dafür schon da; ein weiteres Modell ist ein Eintrag in `MODELLE`.

Punkte ohne `sessionId` (vor v3.4.8 erfasst) zählen bei der Unsicherheit mit, im Modellvergleich nicht: Ihre Gruppe ist unbekannt. Eine von einem deutschen Excel neu gespeicherte Datei (Semikolon, Dezimalkomma) wird erkannt.

## Repo-Layout

| Pfad | Inhalt |
|---|---|
| `index.html` | **Die komplette App** — bewusst single-file, kein Build-Step |
| `manifest.json`, `sw.js`, `icon-*.png`, `apple-touch-icon.png` | PWA-Infrastruktur |
| `tests/test_pipeline.js` | Node-Regressions-Harness, **112 Tests** gegen den extrahierten Pure-Pipeline-Block |
| `tests/test_calib_storage.js` | Integrations-Harness, **42 Tests** für Kalibrier-Storage, Canvas-/Flicker-/Gate-Verdrahtung, Zustands-Reset, Schleifen-Robustheit und die Sperre von Kalibrierung und Trainingspunkten während des Einschwingens |
| `tests/test_exposure_budget.js` | **28 Tests** für das Zeitbudget von `tuneExposure`, die Belichtungs-Stufe bei Übersteuerung und den Neustart-Hinweis danach (simulierte Uhr) |
| `tests/test_sw_fallback.js` | **8 Tests** für den Service-Worker (Offline-Fallback, Cache-Regeln) |
| `tests/test_properties.js` | **31 Property-Tests** (fast-check) — Invarianten über zufällig erzeugte Eingaben |
| `tests/test_model.js` | **3 Model-Based-Tests** (fast-check `fc.commands`) — zufällige Befehlsfolgen gegen ein Parallelmodell |
| `tools/auswertung.js` | Auswertung des CSV-Exports: Unsicherheits-Check und Modellvergleich mit GroupKFold (siehe „Trainingsdaten auswerten“) |
| `tests/test_auswertung.js` | **16 Tests** für die Auswertung — gegen echte Exporte der App, inkl. Fehlalarmrate und Trennschärfe über simulierte Datensätze |
| `package.json` | **Nur für die Property-Tests.** Die App selbst hat keine Abhängigkeiten und keinen Build-Step |
| `patches/` | Gestaffelte Patches der letzten Stufen (Review-Nachvollziehbarkeit) |

## Tests

```bash
node tests/test_pipeline.js         # 112/112 erwartet (kein Browser nötig)
node tests/test_calib_storage.js    # 42/42 erwartet
node tests/test_exposure_budget.js  # 28/28 erwartet
node tests/test_sw_fallback.js      #  8/8  erwartet
node tests/test_auswertung.js       # 16/16 erwartet

npm install                         # einmalig, nur für die Property-Tests
node tests/test_properties.js       # 31/31 erwartet
node tests/test_model.js            #  3/3  erwartet
```

Die ersten fünf Harnesses laufen **ohne jede Abhängigkeit** — `npm run test:nodeps` fasst sie zusammen. Nur `test_properties.js` braucht fast-check; die App selbst bleibt unberührt.

`test_pipeline.js` extrahiert den `PURE-PIPELINE`-Block aus `index.html` und testet ihn gegen synthetische Frames: EOTF-Endpunkte/Knie, Frame-Analyse, Flicker-Regressionen, FSM, Profile, Kalman, Uniformität, Q-Komponenten, Unsicherheits-Szenarien, Schwarzwert-Subtraktion, Zwei-Punkt-Fit inkl. Guards und Clamp-Konsistenz, Median-Vorfilter, Q-Gate-Abgrenzung (dunkle Szene und Lichtwechsel dürfen nicht halten), Flicker-Hysterese, Kalman-Reset beim Moduswechsel und den Unsicherheits-Boden (inkl. Abgleich gegen die Zahlen in diesem README) sowie, dass die Versionsnummer in Titel, Kopfzeile, Service Worker und `package.json` übereinstimmt.

`test_calib_storage.js` lädt das echte `<script>` in eine minimale DOM-/`localStorage`-Attrappe und prüft Kalibrier-Storage (Profilbindung, Legacy-Fallback, vollständiges Zurücksetzen) sowie die Canvas-Verdrahtung — dass `canvas.width/height` aus `PROC_W`/`PROC_H` kommen und im Skript keine nackten `320`/`240`-Literale mehr stehen.

`test_exposure_budget.js` fährt `tuneExposure()` mit einer **simulierten Uhr** (`setTimeout` lässt die Uhr springen und löst sofort auf) gegen Track-Attrappen: dass der Verify-Schritt nur startet, wenn er noch vollständig ins 8-s-Budget passt, dass eine bewegte Settings-Meldung als Beleg zählt und ein quantisierender Treiber keinen liefert. Seit v3.4.14 zusätzlich `stepDownExposureManual()`: dass Formel-Belichtung und Drift-Baseline auf den vom Treiber **gemeldeten** Wert nachziehen (sonst fiele die Anzeige um Faktor 4 bzw. schaltete der Drift-Check auf Auto zurück), dass ein ignorierender Treiber, das Treiber-Minimum, ein Stopp oder ein Auto-Rückfall während der Umstellung nichts anfassen — und, am Quelltext, dass Kalman und Drift-Check während der Umstellung pausieren. Seit v3.4.16 außerdem der Neustart-Hinweis: nie ohne vorherige erfolgreiche Stufe, erst nach der vollen Frame-Zahl, Rücksetzen durch einen guten Frame, einmal pro Stufe — und am Quelltext, dass nirgends automatisch hochgeregelt wird.

`test_sw_fallback.js` lädt `sw.js` in eine `ServiceWorkerGlobalScope`-Attrappe: die App-Shell darf nur bei Navigationen als Offline-Fallback kommen, ein fehlgeschlagenes Bild oder JSON bekommt einen echten Netzwerkfehler statt HTML.

`test_properties.js` prüft **Invarianten statt Beispiele**: nicht „raw = 21,7 → erwarte `zero-zone`", sondern „für *jede* gültige Eingabe muss gelten: `state === 'ok'` heißt, der Rohwert liegt wirklich innerhalb der Toleranz". fast-check erzeugt je 500 Fälle pro Regel inklusive Randwerten und schrumpft einen Fehlschlag auf das kleinstmögliche Gegenbeispiel. Abgedeckt: sRGB-EOTF, `computeQuality`, `computeUncertainty`, `computeCalib2`, `calibRangeStatus`, `RollingMedian`. Laufzahl über `PROP_RUNS` steuerbar.

Die stärkste Regel dort ist eine **Kopplung**: `state === 'zero-zone'` muss *genau dann* gelten, wenn `Math.max(0, raw·slope + offset)` auf 0 klemmt — wäre die Warnung zu eng, bliebe eine stille Null-Zone; wäre sie zu weit, warnte sie über echte Messwerte.

`test_auswertung.js` erzeugt seine Test-CSV mit dem **echten** `exportTrainCSV()` aus `index.html` (inkl. Formel-Injektionsschutz und Punkten ohne `sessionId`), prüft GroupKFold (keine Sitzung auf beiden Seiten) und misst über je 50 simulierte Datensätze die **Fehlalarmrate** (kein Effekt, trotzdem „Gewinn“ gemeldet) und die **Trennschärfe** (echter Effekt erkannt). Anlass: Die erste Fassung entschied nur über „Median 10 % besser“ und meldete bei 16 Sitzungen ohne jeden Effekt in rund einem Viertel der Fälle einen Gewinn.

`test_model.js` geht eine Stufe weiter: Statt einzelne Funktionen zu prüfen, würfelt es **Befehlsfolgen** (kalibrieren, Profil wechseln, Kamera wechseln, zurücksetzen, neu laden — beliebig verschränkt) und hält nach jedem Schritt ein Parallelmodell gegen den echten Modul-Zustand. Das findet Fehler, die erst durch die *Reihenfolge* entstehen.

Angesetzt ist es dort, wo in diesem Projekt real Fehler steckten: der **Kalibrier-Storage** (drei Fehler — Profilbindung, Reset-Umfang, fehlender Fit beim Legacy-Faktor, alle in der Verdrahtung zwischen `localStorage` und Modul-Zustand, keiner in der Mathematik) und die **`AppStatusStateMachine`** (Hysterese zählte Frames statt Detektionen). Das Modell bildet bewusst *nicht* die Mathematik nach — für erwartete Kalibrierwerte dient das echte `computeCalib2()` als Orakel, sonst prüfte man eine Reimplementierung gegen sich selbst.

## Entstehung & Credits

Dieses Projekt wurde in Zusammenarbeit mit KI-Assistenten entwickelt — namentlich **Claude (Anthropic)**, beteiligt an Code-Reviews, der stufenweisen Architektur (Messkorrektheit → Konfidenzschicht → Zwei-Punkt-Kalibrierung → PWA), Fehleranalysen und Fixes; Richtung, Entscheidungen und Feldtests lagen beim Projektinhaber. Weitere Modelle (u. a. Gemini, GLM) lieferten Review-Perspektiven, die kritisch geprüft und teils übernommen wurden.

## Lizenz

Siehe [LICENSE](LICENSE).
