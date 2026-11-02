# Révisions — mes QCM sur iPhone

Application de quiz (QCM à 4 réponses) qui s'installe sur l'écran d'accueil de l'iPhone et fonctionne hors ligne.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | La page de l'application |
| `styles.css` | L'apparence (clair et sombre automatiques) |
| `app.js` | Le fonctionnement : import, quiz, score, suivi des erreurs |
| `sw.js` | Le mode hors ligne |
| `manifest.json` + `icons/` | Le nom et l'icône sur l'écran d'accueil |
| `exemple-quiz.txt` | Un exemple de fichier de questions |

## 1. Mettre l'app en ligne avec GitHub Pages (depuis un navigateur, rien à installer)

1. Sur github.com, clique sur **New** pour créer un dépôt. Nom : `revisions`. Laisse-le **Public** (obligatoire pour GitHub Pages gratuit). Coche **Add a README file**, puis **Create repository**.
2. Dans le dépôt : **Add file → Upload files**. Glisse **tout le contenu** du dossier décompressé (les fichiers **et** le dossier `icons`). Clique sur **Commit changes**.
3. Va dans **Settings → Pages**. Sous *Build and deployment*, choisis **Deploy from a branch**, branche **main**, dossier **/ (root)**, puis **Save**.
4. Attends 1 à 2 minutes. L'adresse apparaît en haut de la page : `https://TON-PSEUDO.github.io/revisions/`

Seul le code de l'app est public. Tes quiz et tes scores restent uniquement sur ton iPhone.

## 2. Installer l'app sur l'iPhone

1. Ouvre l'adresse dans **Safari** (pas Chrome).
2. Touche le bouton **Partager** (carré avec une flèche), puis **Sur l'écran d'accueil**, puis **Ajouter**.
3. Ouvre l'app depuis son icône **Révisions**. Importe tes quiz depuis l'app installée : elle a sa propre mémoire, séparée de Safari.

## 3. Écrire un fichier de questions

```
# Les lignes qui commencent par # sont ignorées

Quelle est la capitale de l'Australie ?
* Canberra
- Sydney
- Melbourne
- Perth

En quelle année a eu lieu la prise de la Bastille ?
- 1776
* 1789
- 1799
- 1815
```

- 4 réponses par question, la bonne commence par `*`, les mauvaises par `- ` (tiret **suivi d'un espace**).
- Une ligne vide entre deux questions.
- L'ordre des réponses et des questions est mélangé à chaque partie.
- Enregistre le fichier en `.txt` (le Bloc-notes Windows convient). Les accents sont gérés.
- Si une question est mal écrite, l'app te dit laquelle et pourquoi, et importe les autres.

**Mettre le fichier sur l'iPhone :** dépose-le dans iCloud Drive, envoie-le-toi par mail (puis « Enregistrer dans Fichiers »), ou copie son contenu et colle-le directement dans l'app.

**Modifier un quiz :** dans la matière, « Remplacer les questions », puis importe le nouveau fichier. Ton suivi est gardé pour les questions qui n'ont pas changé.

## 4. Suivi des erreurs

- Une question ratée passe « à revoir ». Elle en sort quand tu y réponds juste.
- « Revoir mes erreurs » lance un quiz avec uniquement ces questions.
- La fiche de chaque matière affiche ton meilleur score, l'historique et les questions les plus ratées.

## 5. Sauvegarde

Les données sont stockées sur l'iPhone. Si tu supprimes l'app de l'écran d'accueil, elles sont perdues. Utilise **Sauvegarde → Créer une sauvegarde** de temps en temps et range le fichier dans Fichiers ou iCloud Drive.

## 6. Mettre à jour l'app

Remplace les fichiers modifiés sur GitHub (**Add file → Upload files**). L'app récupère la nouvelle version à la prochaine ouverture avec du réseau (ferme-la complètement puis rouvre-la si besoin).
