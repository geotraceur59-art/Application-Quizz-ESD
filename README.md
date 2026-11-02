# Révisions — mes QCM sur iPhone

Application de quiz (QCM à 4 réponses) qui s'installe sur l'écran d'accueil de l'iPhone et fonctionne hors ligne.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `index.html` | La page de l'application |
| `styles.css` | L'apparence (clair et sombre automatiques) |
| `app.js` | Le fonctionnement : import, quiz, score, suivi des erreurs |
| `sw.js` | Le mode hors ligne |
| `manifest.json` + les 3 images `.png` | Le nom et l'icône sur l'écran d'accueil |
| `exemple-quiz.txt` | Un exemple de fichier de questions |

## 1. Mettre l'app en ligne avec GitHub Pages (depuis un navigateur, rien à installer)

1. Sur github.com, clique sur **New** pour créer un dépôt. Nom : `revisions`. Laisse-le **Public** (obligatoire pour GitHub Pages gratuit). Coche **Add a README file**, puis **Create repository**.
2. Dans le dépôt : **Add file → Upload files**. Glisse **tout le contenu** du dossier décompressé (tous les fichiers). Clique sur **Commit changes**.
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
> Canberra a été choisie en 1908 comme compromis entre Sydney et Melbourne.

En quelle année a eu lieu la prise de la Bastille ?
- 1776
* 1789
- 1799
- 1815
```

- 4 réponses par question, la bonne commence par `*`, les mauvaises par `- ` (tiret **suivi d'un espace**).
- Facultatif : une ligne qui commence par `>` donne une explication, affichée après ta réponse.
- Une ligne vide entre deux questions.
- Le format sur une seule ligne est aussi accepté (pratique pour un texte copié depuis Anki, un PDF ou une page web) :
  `Quel port utilise RADIUS ? - 443 * 1812 - 22 - 3389 > Le port 1813 sert à la comptabilité.`
- L'ordre des réponses et des questions est mélangé à chaque partie.
- Enregistre le fichier en `.txt` (le Bloc-notes Windows convient). Les accents sont gérés.
- Si une question est mal écrite, l'app te dit laquelle et pourquoi, et importe les autres.

**Mettre le fichier sur l'iPhone :** dépose-le dans iCloud Drive, envoie-le-toi par mail (puis « Enregistrer dans Fichiers »), ou copie son contenu et colle-le directement dans l'app.

**Modifier un quiz :** dans la matière, « Remplacer les questions », puis importe le nouveau fichier. Ton suivi est gardé pour les questions qui n'ont pas changé.

## 4. Suivi des erreurs

- Une question ratée passe « à revoir ». Elle en sort quand tu y réponds juste.
- « Revoir mes erreurs » lance un quiz avec uniquement ces questions.
- La fiche de chaque matière affiche ton meilleur score, l'historique et les questions les plus ratées.

## 5. Synchroniser le PC et l'iPhone (dépôt privé)

Tes quiz et ton suivi sont enregistrés dans un fichier `donnees.json` d'un **second dépôt GitHub, privé**. Personne d'autre ne peut le lire.

### a. Créer le dépôt privé (une seule fois, sur le PC)
1. Sur github.com, clique sur **New**.
2. Nom : `revisions-donnees`. Choisis **Private**. Coche **Add a README file**. Clique sur **Create repository**.

### b. Créer la clé d'accès (une seule fois, sur le PC)
1. Clique sur ton avatar en haut à droite, puis **Settings**.
2. Tout en bas de la colonne de gauche : **Developer settings**.
3. **Personal access tokens → Fine-grained tokens → Generate new token**.
4. *Token name* : `Revisions`. *Expiration* : la durée la plus longue proposée (note la date, il faudra recréer une clé à ce moment).
5. *Repository access* : **Only select repositories**, puis choisis **revisions-donnees**.
6. *Permissions* : dans **Repository permissions**, règle **Contents** sur **Read and write**.
7. Clique sur **Generate token** et **copie la clé** (elle commence par `github_pat_`). GitHub ne la montre qu'une fois.

Cette clé ne donne accès qu'au dépôt `revisions-donnees`, rien d'autre sur ton compte.

### c. Connecter le PC
Dans l'app : **Réglages → Synchronisation**. Remplis ton pseudo GitHub, le nom du dépôt (`revisions-donnees`) et colle la clé. Clique sur **Connecter**. Les quiz déjà présents sur le PC sont envoyés dans le dépôt.

### d. Connecter l'iPhone
1. Sur le PC, dans **Réglages**, clique sur **Copier le code pour un autre appareil**.
2. Envoie-toi ce code (mail, note iCloud…).
3. Sur l'iPhone, dans l'app installée : **Réglages → Code de connexion**, colle le code, **Connecter avec le code**.
4. Supprime ensuite le mail ou la note : le code contient ta clé.

### Fonctionnement
- La synchro se fait seule : à l'ouverture de l'app, quand tu y reviens, après un import et à la fin de chaque quiz.
- Le point en haut de l'accueil indique l'état : vert « Synchronisé », rouge en cas de problème (touche-le pour voir le détail).
- Sans réseau, l'app fonctionne normalement et se synchronise au retour de la connexion.
- Si tu utilises la même matière sur les deux appareils sans réseau, c'est la dernière version modifiée qui est gardée.
- Quand la clé expire, l'app affiche « Clé refusée ou expirée » : crée une nouvelle clé (étape b), puis dans Réglages, **Déconnecter cet appareil** et reconnecte-le avec la nouvelle clé (PC), puis avec le nouveau code (iPhone).

## 6. Sauvegarde

Utilise **Réglages → Créer une sauvegarde** de temps en temps et range le fichier dans Fichiers ou iCloud Drive. Avec la synchronisation, le dépôt privé garde aussi un historique de chaque version de tes données.

## 7. Mettre à jour l'app

Remplace les fichiers modifiés sur GitHub (**Add file → Upload files**). L'app récupère la nouvelle version à la prochaine ouverture avec du réseau (ferme-la complètement puis rouvre-la si besoin).
