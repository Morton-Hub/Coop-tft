# Coop TFT

Compagnon Teamfight Tactics pensé pour l'écran partagé d'un Galaxy Z Fold : le jeu d'un côté,
l'app de l'autre. Tu reproduis ton plateau en quelques taps et l'app t'indique en direct les
synergies actives, les unités qui les complètent et les défauts de placement.

## Ce que fait la v0.1

| Fonction | Détail |
| --- | --- |
| Données du set | Champions, traits et paliers du set en cours, chargés depuis Community Dragon (français, repli anglais), mis en cache 12 h. Sélecteur de set. |
| Plateau 4 × 7 | Tap sur une unité : elle se pose sur la meilleure case libre pour son rôle. Tap unité puis case : déplacement ou échange. |
| Synergies | Compteur par trait avec paliers ; tap sur un trait pour filtrer les unités correspondantes. |
| Conseils de placement | Alertes (carry trop avancé, tank au fond, pas de première ligne, carry non couvert, ligne arrière groupée), « Placement auto », « Inverser G/D ». |
| Pistes pour la suite | Plusieurs unités classées selon les paliers qu'elles activent ou rapprochent, filtrées selon ton niveau. |
| Mes compos | Enregistre tes compos (par exemple recopiées d'une tier list) et recharge-les en un tap. |
| PWA | Installable depuis Chrome (« Ajouter à l'écran d'accueil »), mise en page étroite ou large selon le volet. |

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

Sur le Fold : ouvrir l'URL déployée dans Chrome, installer l'app, puis la glisser en écran
partagé à côté de TFT. Le workflow `.github/workflows/deploy.yml` publie sur GitHub Pages à
chaque push sur `main` (activer Pages avec la source « GitHub Actions » dans les réglages du repo).

## Architecture

```
src/data/cdragon.ts        chargement + normalisation des données Community Dragon
src/data/demo.ts           jeu fictif de secours si les données sont injoignables
src/engine/traits.ts       comptage des traits et paliers
src/engine/suggest.ts      classement des unités à ajouter
src/engine/positioning.ts  cases préférées par rôle, placement auto, analyse
src/App.tsx                interface (plateau, synergies, onglets)
```

Le moteur est du TypeScript pur, sans dépendance à l'interface, et couvert par `tests/`.
Le rôle d'une unité (tank, mêlée, distance, fond) est déduit de sa portée, du champ `role`
quand Community Dragon le fournit, sinon de son armure.

## Feuille de route

1. **Compos méta réelles** : petit service qui agrège les parties des meilleurs joueurs via
   l'API Riot (clé développeur requise) pour proposer les compos les plus performantes du patch.
2. **Objets** : recettes, objets recommandés par carry, choix au carrousel.
3. **Plan de partie** : économie, paliers d'intérêts, moments de montée de niveau et de roll.
4. **Placement avancé** : saisie rapide du plateau adverse pour des conseils ciblés.
5. **Bilan après partie** : historique via l'API Riot et points à travailler.
