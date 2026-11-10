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
| Données du set | Champions, traits et paliers du set en cours, chargés depuis Community Dragon (français, repli anglais), mis en cache 12 h. Sélecteur de set. |
| Plateau 4 × 7 | Tap sur une unité : elle se pose sur la meilleure case libre pour son rôle. Tap unité puis case : déplacement ou échange. |
| Synergies | Compteur par trait avec paliers ; tap sur un trait pour filtrer les unités correspondantes. |
| Conseils de placement | Alertes (carry trop avancé, tank au fond, pas de première ligne, carry non couvert, ligne arrière groupée), « Auto-placer », « Inverser » (miroir gauche/droite). |
| Pistes pour la suite | Plusieurs unités classées selon les paliers qu'elles activent ou rapprochent, filtrées selon ton niveau. |
| Mes compos | Enregistre tes compos (par exemple recopiées d'une tier list) et recharge-les en un tap. |
| Écran partagé | Volet large (TFT en haut, app en bas) : plateau, synergies et unités sur trois colonnes, sans défilement côté plateau. Volet étroit (côte à côte) : tout empilé. Le conseil prioritaire reste toujours visible sous le plateau. |

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

L'APK est signé avec une clé de debug régénérée à chaque build : pour installer une nouvelle
version, il faut désinstaller l'ancienne (les compos enregistrées sont alors perdues). Une clé
de signature fixe est à prévoir avant d'accumuler des données.

L'app Android est une enveloppe [Capacitor](https://capacitorjs.com) autour du même code web ;
le projet `android/` est généré pendant le build et n'est pas versionné. Une version web reste
possible via le workflow manuel `Deploy web (Pages)`.

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
