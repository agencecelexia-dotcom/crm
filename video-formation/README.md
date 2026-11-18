# Vidéo de prise en main de l'espace artisan

Vidéo verticale (1080 × 1920, ~4 min) montrée à l'artisan à sa première
ouverture de l'espace. Elle est faite avec [Remotion](https://www.remotion.dev)
(de la vidéo écrite en React) à partir de **captures du vrai espace artisan**,
sur les données fictives des tests : aucune donnée d'un vrai artisan ou client.

Ce dossier est indépendant du CRM. Il n'est ni bâti ni déployé avec lui, et
il a ses propres dépendances.

## Fichiers

| Fichier | Rôle |
|---|---|
| `src/script.ts` | **Le texte.** Il est la source unique de ce qu'Antoine lit et du découpage des scènes. |
| `src/plans.ts` | Le storyboard : écran montré, zoom, bouton mis en valeur et mot qui le déclenche. |
| `SCRIPT-ANTOINE.md` | Le texte à remettre à Antoine, généré depuis `src/script.ts`. |
| `capture/` | Captures Playwright du vrai espace artisan, sur le faux backend des tests. |
| `src/calage.json` | Début et fin de chaque partie dans la voix : provisoire, ou celle d'Antoine. |

## Commandes

```bash
cd video-formation && npm install        # une fois
npm run script-antoine                   # régénère SCRIPT-ANTOINE.md après une modification du texte
(cd .. && npx playwright test --config video-formation/capture/capture.config.ts)   # nouvelles captures si l'espace artisan a changé
npm run voix-provisoire                  # voix de synthèse macOS, pour caler sans Antoine
npm run apercu                           # aperçu interactif dans le navigateur
npm run rendu                            # out/formation-espace-artisan.mp4
```

## Quand Antoine a tourné

1. Récupérer ses **14 vidéos originales**, une par partie, dans un dossier.
2. Lancer `npm run caler-voix -- ~/Downloads/videos-antoine`.
   - L'outil les met bout à bout. Il en tire `public/antoine.mp4`, qui donne le son et l'image de la bulle.
   - Il mesure aussi où commence et finit chaque partie, puis réécrit `src/calage.json`.
   - S'il n'a tourné qu'**une seule vidéo**, passer le fichier au lieu du dossier. Le calage se fait alors sur ses silences de 2 s entre les parties.
3. Si le visage est mal centré dans le rond, ajouter `--cadrage 50%,30%` : position horizontale, puis verticale.
4. `npm run apercu` pour vérifier, puis `npm run rendu`.

Les mises en valeur se déclenchent à la position du mot dans la phrase. Si une
mise en valeur arrive trop tôt ou trop tard, changer le `mot` qui la déclenche
dans `src/plans.ts`.

## Licence Remotion

Remotion est gratuit pour les particuliers et les entreprises de 3 personnes au
plus. Au-delà, une licence entreprise est nécessaire : voir remotion.pro.
