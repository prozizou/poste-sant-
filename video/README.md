# Vidéo de présentation — Poste de Santé

`presentation-poste-sante.mp4` : présentation animée de l'application de A à Z
(1280×720, 25 i/s, 4 min 48 s), avec voix off française (voix neuronale « Henri »)
et sous-titres incrustés.

## Chapitres

| # | Début | Sujet |
|---|---|---|
| — | 0:00 | Introduction |
| 01 | 0:14 | Le contexte |
| 02 | 0:37 | Architecture technique |
| 03 | 1:03 | Connexion et rôles |
| 04 | 1:33 | Multi-villages, données isolées |
| 05 | 1:55 | Facturation |
| 06 | 2:23 | Pharmacie et stock |
| 07 | 2:48 | Retours et annulations |
| 08 | 3:07 | Dépenses et rapports |
| 09 | 3:31 | Notifications en temps réel |
| 10 | 3:47 | Sécurité et fiabilité |
| 11 | 4:09 | Super administration et abonnement |
| — | 4:34 | Conclusion |

## Régénérer

Le texte de la voix off est dans `source/script.json`, les scènes dans
`source/scenes.js` et `source/style.css`. Depuis `source/` (Python avec
`edge-tts`, Node avec Playwright, ffmpeg) :

```bash
mkdir -p audio && python3 gen_audio.py         # voix off par scène
# durations.json : {"intro": 12.8, ...} (durée de chaque mp3, via ffprobe)
node build.js && node render.js                 # video.html → silent.mp4
```

puis mixer les pistes audio (décalées au début de chaque scène) avec `silent.mp4`.
