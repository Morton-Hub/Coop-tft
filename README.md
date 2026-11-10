# Coop TFT

Compagnon Teamfight Tactics pensé pour l'écran partagé d'un Galaxy Z Fold : le jeu d'un côté,
l'app de l'autre. Tu reproduis ton plateau en quelques taps et l'app t'indique en direct les
synergies actives, les unités qui les complètent et les défauts de placement.

## 📲 Télécharger

**[Télécharger Coop TFT pour Android (APK)](https://github.com/Morton-Hub/Coop-tft/releases/latest/download/coop-tft.apk)**

Ouvre ce lien depuis ton téléphone, autorise l'installation quand Android le demande, puis
lance TFT et glisse Coop TFT en écran partagé. Toutes les versions :
[page Releases](https://github.com/Morton-Hub/Coop-tft/releases).

## Ce que fait la v0.1

| Fonction | Détail |
| --- | --- |
| Méta en direct | Compos les plus performantes du patch en cours (tier S à C, place moyenne, top 4, taux de victoire, popularité, objets des carrys), recalculées toutes les 4 h à partir des parties des meilleurs joueurs EUW. Un tap charge la compo sur le plateau. |
| Vue Direct | L'affichage suit le conseil : couleur dominante de l'app selon l'action (vert économise, bleu monte de niveau, or roll, rouge clignotant roll tout), grande carte d'action, cartes qui apparaissent selon la situation (achat en boutique, objet faisable, placement à corriger), jauges PV/or/intérêts, cases mal placées en rouge et carry étoilé sur le plateau. |
| Économie | Conseil « économise / monte de niveau / roll » selon la manche, l'or, les PV et le coût du carry visé, avec la chance de le trouver en boutique au niveau actuel et au suivant. |
| Objets | Objets conseillés pour les carrys de la compo chargée, leurs recettes, les composants à prioriser et ce qui est faisable avec ceux en main. |
| Lecture d'écran (expérimental) | Dans l'app Android : capture de l'écran et lecture du texte sur l'appareil pour repérer la boutique et signaler les unités de la compo. Non conforme aux règles de Riot sur les outils en partie : à activer en connaissance de cause. |
| Données du set | Champions, traits, paliers et objets du set en cours uniquement, chargés depuis Community Dragon (français, repli anglais), mis en cache 12 h. |
| Plateau 4 × 7 | Tap sur une unité : elle se pose sur la meilleure case libre pour son rôle. Tap unité puis case : déplacement ou échange. |
| Synergies | Compteur par trait avec paliers ; tap sur un trait pour filtrer les unités correspondantes. |
| Conseils de placement | Alertes (carry trop avancé, tank au fond, pas de première ligne, carry non couvert, ligne arrière groupée), « Auto-placer », « Inverser » (miroir gauche/droite). |
| Pistes pour la suite | Plusieurs unités classées selon les paliers qu'elles activent ou rapprochent, filtrées selon ton niveau. |
| Perso | Enregistre tes propres compos et recharge-les en un tap. |
| Écran partagé | Volet large (TFT en haut, app en bas) : plateau, synergies et unités sur trois colonnes, sans défilement côté plateau. Volet étroit (côte à côte) : tout empilé. Le conseil prioritaire reste toujours visible sous le plateau. |

## Activer la méta en direct

L'onglet « Méta » lit `meta.json`, publié sur la branche `meta` par le workflow `Meta`
(`scripts/fetch-meta.mjs`). Ce workflow interroge l'API officielle de Riot : classement
Challenger, puis les dernières parties classées de ces joueurs, regroupées par compo
(`src/meta/aggregate.ts`). Trois réglages sont nécessaires, une seule fois :

1. **Clé Riot** : sur [developer.riotgames.com](https://developer.riotgames.com), se connecter
   avec son compte Riot. La clé de développement affichée fonctionne tout de suite mais expire
   au bout de 24 h ; pour une méta qui se met à jour sans intervention, demander une
   *Personal API Key* (« Register Product »), qui n'expire pas.
2. **Secret GitHub** : dans le repo, *Settings → Secrets and variables → Actions → New
   repository secret*, nom `RIOT_API_KEY`, valeur = la clé.
3. **Repo public** : *Settings → General → Change repository visibility*. L'app lit le fichier
   sans authentification, ce qui est impossible sur un repo privé. (La clé reste secrète.)

Puis lancer une première fois : *Actions → Meta → Run workflow* (environ 6 minutes).
Région modifiable avec les variables `RIOT_PLATFORM` / `RIOT_REGION` du script.

## Limite assumée : pas de lecture automatique de la partie

TFT mobile n'expose aucune API de partie en cours, et la
[politique développeur de Riot pour TFT](https://developer.riotgames.com/docs/tft) interdit aux
apps et overlays d'utiliser des données temps réel pour dicter les actions du joueur. Une app
qui capturerait l'écran pour dire quoi faire exposerait ton compte. Coop TFT reste donc du côté
autorisé : c'est toi qui saisis ton plateau, l'app ne lit ni ne touche le jeu, et elle propose
toujours plusieurs pistes plutôt qu'une consigne unique.

## Lancer

```bash
npm install
npm run dev      # développement
npm test         # tests du moteur
npm run build    # build de production dans dist/
```

## Installer l'application Android

Chaque push construit un APK (workflow `Android APK`). Sur `main`, il est publié dans la
release **latest** du repo :

1. Sur le Fold, ouvrir le [lien de téléchargement](https://github.com/Morton-Hub/Coop-tft/releases/latest/download/coop-tft.apk).
2. Autoriser l'installation depuis le navigateur quand Android le demande, puis installer.
3. Lancer TFT, puis glisser Coop TFT en écran partagé.

À chaque ouverture, l'app compare son build à la dernière release et affiche un bandeau
« Mise à jour disponible » avec le lien de l'APK. L'APK est signé avec la clé de debug versionnée
dans `signing/` : la nouvelle version s'installe par-dessus la précédente en conservant les
données. Cette clé est publique dans le repo ; elle convient à un usage personnel, pas à un store.

L'app Android est une enveloppe [Capacitor](https://capacitorjs.com) autour du même code web ;
le projet `android/` est généré pendant le build et n'est pas versionné. Une version web reste
possible via le workflow manuel `Deploy web (Pages)`.

## Architecture

```
src/data/cdragon.ts        chargement + normalisation des données Community Dragon
src/data/demo.ts           jeu fictif de secours si les données sont injoignables
src/meta/aggregate.ts      parties Riot -> compos méta classées
src/meta/load.ts           lecture de meta.json côté app
scripts/fetch-meta.mjs     collecte des parties via l'API Riot (workflow Meta)
src/engine/traits.ts       comptage des traits et paliers
src/engine/suggest.ts      classement des unités à ajouter
src/engine/positioning.ts  cases préférées par rôle, placement auto, analyse
src/engine/economy.ts      conseil d'économie (tables de boutique, niveaux clés)
src/engine/items.ts        recettes, composants prioritaires, objets faisables
src/screen/                lecture d'écran : repérage de la boutique dans le texte lu
plugins/screen-reader/     plugin Android : capture (MediaProjection) + texte (ML Kit)
src/App.tsx                interface (plateau, synergies, onglets)
```

Le moteur est du TypeScript pur, sans dépendance à l'interface, et couvert par `tests/`.
Le rôle d'une unité (tank, mêlée, distance, fond) est déduit de sa portée, du champ `role`
quand Community Dragon le fournit, sinon de son armure.

## Feuille de route

1. **Méta plus fine** : regroupement des variantes d'une même compo, placement type par compo,
   plusieurs régions.
2. **Objets** : recettes et choix au carrousel.
3. **Plan de partie** : économie, paliers d'intérêts, moments de montée de niveau et de roll.
4. **Placement avancé** : saisie rapide du plateau adverse pour des conseils ciblés.
5. **Bilan après partie** : historique via l'API Riot et points à travailler.
