# Module Tableau de Bord pour Odoo 16

## 📊 Vue d'ensemble

Le module **is_tableau_de_bord16** est un module développé par InfoSaône permettant de créer des tableaux de bord personnalisés et dynamiques dans Odoo 16. Il offre la possibilité d'afficher plusieurs recherches enregistrées (favoris) sur une même page avec différents modes de visualisation.

## ✨ Fonctionnalités principales

### 1. Création de tableaux de bord personnalisés
- **Création illimitée** : Créez autant de tableaux de bord que nécessaire
- **Nom et description** : Donnez un nom explicite et une description à chaque tableau de bord
- **Organisation flexible** : Organisez vos indicateurs clés selon vos besoins métier

### 2. Intégration des recherches enregistrées
- **Utilisation des favoris Odoo** : Réutilisez vos recherches enregistrées existantes
- **Filtrage par modèle** : Sélectionnez le modèle (factures, commandes, contacts, etc.)
- **Filtrage par utilisateur** : Affichez vos propres recherches ou celles d'autres utilisateurs
- **Support multi-modèles** : Combinez des données de différents modèles sur un même tableau de bord

### 3. Modes d'affichage multiples

#### 📋 Mode Liste
- Affichage tabulaire des données
- Configuration des colonnes visibles
- Personnalisation des champs affichés
- Gestion de la visibilité et de l'ordre des colonnes
- Support des libellés personnalisés

#### 📊 Mode Graphique
- **Types de graphiques** :
  - Barres (bar)
  - Courbes (line)
  - Camembert (pie)
- **Configuration avancée** :
  - Choix de la mesure (champ numérique à analyser)
  - Sélection des groupements (ex: par date, par client, etc.)
  - Agrégateurs disponibles : somme, moyenne, minimum, maximum, compte
- **Palettes de couleurs** automatiques

#### 📈 Mode Tableau croisé dynamique (Pivot)
- **Analyse multidimensionnelle** :
  - Groupement par lignes
  - Groupement par colonnes
  - Mesures personnalisables
- **Support des analyses** :
  - Analyse 1D (lignes uniquement)
  - Analyse 2D (lignes × colonnes)
- **Agrégations** : somme, compte, moyenne, etc.

### 4. Personnalisation de l'affichage

#### Dimensions
- **Largeur** :
  - Pleine largeur (12/12)
  - Demi largeur (6/12)
  - Tiers de largeur (4/12)
  - Quart de largeur (3/12)
- **Hauteur** :
  - Petit : 300px
  - Moyen : 400px
  - Grand : 500px
  - Très grand : 600px

#### Organisation
- **Séquençage** : Définissez l'ordre d'affichage avec une poignée de glisser-déposer
- **Mise en page responsive** : Adaptation automatique sur différentes tailles d'écran
- **Layout en grille** : Système de grille Bootstrap pour un alignement parfait

### 5. Actions et interactions

#### Actions disponibles
- **👁️ Voir en plein écran** : Ouvrir la recherche dans une vue complète
- **🔍 Modifier le filtre** : Accéder directement à la fiche du filtre
- **📋 Dupliquer une ligne** : Créer rapidement une variante d'un élément
- **✏️ Modifier la ligne** : Éditer la configuration de l'élément (gestionnaires uniquement)

#### Navigation
- Accès rapide depuis le menu principal
- Vue kanban pour sélectionner le tableau de bord
- Mode édition pour les gestionnaires
- Mode consultation pour les utilisateurs

## 🔐 Gestion des droits

### Deux niveaux d'accès

#### 👥 Utilisateur (group_tableau_de_bord_user)
- Visualisation des tableaux de bord
- Accès en lecture seule
- Vue kanban uniquement
- Impossibilité de modifier les configurations

#### 👤 Gestionnaire (group_tableau_de_bord_manager)
- Tous les droits utilisateur
- Création de nouveaux tableaux de bord
- Modification des tableaux de bord existants
- Accès aux vues liste et formulaire
- Configuration des éléments du tableau de bord
- Actions d'édition visibles dans l'interface

## 🛠️ Architecture technique

### Modèles de données

#### is.tableau.de.bord
Modèle principal représentant un tableau de bord
- `name` : Nom du tableau de bord
- `description` : Description détaillée
- `line_ids` : Lignes/éléments du tableau de bord
- `active` : Statut actif/inactif

#### is.tableau.de.bord.line
Éléments individuels d'un tableau de bord
- `tableau_id` : Référence au tableau de bord parent
- `name` : Nom de l'élément
- `sequence` : Ordre d'affichage
- `model_id` : Modèle Odoo concerné
- `user_id` : Utilisateur propriétaire du filtre
- `filter_id` : Recherche enregistrée (favori)
- `width` / `height` : Dimensions de l'élément
- `display_mode` : Mode d'affichage (list/graph/pivot)
- `graph_*` : Configuration spécifique aux graphiques
- `pivot_*` : Configuration spécifique aux tableaux croisés
- `field_ids` : Configuration des champs pour le mode liste

#### is.tableau.de.bord.line.field
Configuration des champs en mode liste
- `line_id` : Référence à la ligne parent
- `sequence` : Ordre des colonnes
- `field_name` : Nom technique du champ
- `field_label` : Libellé affiché
- `visible` : Visibilité de la colonne

### Contrôleur HTTP

#### TableauDeBordController (`/tableau_de_bord/get_filter_data`)
- Récupération dynamique des données
- Support de tous les modes d'affichage
- Gestion des contextes et domaines
- Optimisation des requêtes avec `read_group`

### Frontend (JavaScript)

#### DashboardFormController
- Extension du `FormController` d'Odoo
- Génération dynamique de l'interface
- Intégration avec Chart.js pour les graphiques
- Gestion des événements utilisateur
- Appels RPC pour charger les données

### Assets
- **CSS** : `static/src/css/dashboard.css` - Styles personnalisés
- **JavaScript** :
  - `static/src/js/dashboard_view.js` - Contrôleur principal
  - `static/src/js/custom_favorite_item.js` - Gestion des favoris
- **Bibliothèques** : Chart.js pour le rendu des graphiques

## 📦 Installation

### Prérequis
- Odoo 16.0
- Module `base` (inclus par défaut)
- Module `web` (inclus par défaut)

### Installation
1. Copiez le module dans le répertoire `addons` de votre instance Odoo
2. Mettez à jour la liste des applications (mode développeur)
3. Recherchez "InfoSaône - Tableau de bord"
4. Cliquez sur "Installer"

## 🚀 Guide d'utilisation

### Pour les gestionnaires

#### Créer un tableau de bord
1. Allez dans le menu **Tableaux de bord**
2. Cliquez sur **Créer**
3. Renseignez le **nom** et la **description**
4. Ajoutez des lignes dans la section "Éléments du tableau de bord"

#### Configurer une ligne
1. **Sélectionnez un modèle** : Choisissez le type de données (factures, commandes, etc.)
2. **Sélectionnez un utilisateur** : Filtrez les recherches par utilisateur (optionnel)
3. **Sélectionnez une recherche enregistrée** : Choisissez parmi vos favoris
4. **Configurez l'affichage** :
   - Choisissez le mode (Liste, Graphique, Pivot)
   - Définissez la largeur et la hauteur
   - Configurez les options spécifiques au mode choisi
5. **Enregistrez**

#### Mode Liste - Configuration des colonnes
1. Sélectionnez le mode d'affichage "Liste"
2. La liste des champs se charge automatiquement depuis la vue
3. Modifiez l'ordre avec la poignée de séquence
4. Masquez/affichez les colonnes avec le toggle "Visible"
5. Personnalisez les libellés si nécessaire

#### Mode Graphique - Configuration
1. Sélectionnez le mode d'affichage "Graphique"
2. Choisissez le type de graphique (Barres, Courbes, Camembert)
3. Les paramètres sont récupérés automatiquement du favori
4. Possibilité de surcharger manuellement si nécessaire

### Pour les utilisateurs

#### Consulter un tableau de bord
1. Allez dans le menu **Tableaux de bord**
2. Cliquez sur le tableau de bord souhaité dans la vue kanban
3. Visualisez les différents indicateurs
4. Utilisez l'icône 👁️ pour ouvrir un élément en plein écran

## 💡 Exemples d'usage

### Tableau de bord commercial
- **Graphique** : CA par mois (barres)
- **Graphique** : Répartition CA par commercial (camembert)
- **Liste** : Top 10 des clients du mois
- **Pivot** : CA par produit × mois

### Tableau de bord comptable
- **Liste** : Factures en attente de paiement
- **Graphique** : Évolution de la trésorerie (courbes)
- **Pivot** : Dépenses par catégorie × mois
- **Graphique** : Répartition des charges (camembert)

### Tableau de bord RH
- **Liste** : Employés du mois en cours
- **Graphique** : Répartition par département (barres)
- **Pivot** : Absences par type × mois
- **Liste** : Congés à valider

## 🔧 Configuration avancée

### Personnalisation des graphiques
Les paramètres suivants peuvent être configurés :
- `graph_measure` : Champ numérique à mesurer
- `graph_groupbys` : Liste des groupements (séparés par virgule)
- `graph_chart_type` : Type de graphique (bar/line/pie)
- `graph_aggregator` : Fonction d'agrégation (sum/avg/min/max/count)

### Personnalisation des pivots
Les paramètres suivants peuvent être configurés :
- `pivot_row_groupby` : Groupement en lignes
- `pivot_col_groupby` : Groupement en colonnes
- `pivot_measure` : Champ numérique à mesurer

### Filtres dynamiques
Les domaines et contextes des recherches enregistrées sont respectés :
- Filtres sur les dates relatives (mois en cours, année en cours, etc.)
- Filtres sur l'utilisateur connecté
- Domaines personnalisés

## 🐛 Dépannage

### Le tableau de bord ne s'affiche pas
- Vérifiez que vous avez bien des lignes configurées
- Vérifiez que les filtres associés existent toujours
- Consultez les logs du serveur pour d'éventuelles erreurs

### Les données ne se chargent pas
- Vérifiez les droits d'accès au modèle concerné
- Assurez-vous que le filtre est valide
- Vérifiez que les champs configurés existent dans le modèle

### Les graphiques ne s'affichent pas
- Vérifiez que Chart.js est bien chargé
- Vérifiez la configuration de la mesure et des groupements
- Consultez la console JavaScript du navigateur

## 📝 Notes de version

### Version 16.0.0.4.0
- Ajout du champ **Accès en consultation** (`consultation_user_ids`) sur le tableau de bord
- Nouvelle règle de sécurité restreignant la lecture des tableaux de bord pour les utilisateurs simples selon cette liste

### Version 16.0.0.3.0
- Migration vers Odoo 16
- Adaptation des appels RPC pour Odoo 16
- Configuration avancée des champs en mode liste
- Amélioration de la gestion des droits
- Optimisation du chargement des données
- Support des tableaux croisés 2D

## 👨‍💻 Auteur

**InfoSaône - Tony Galmiche**
- Site web : [http://www.infosaone.com](http://www.infosaone.com)
- Email : contact@infosaone.com

## 📄 Licence

Ce module est distribué sous licence **AGPL-3**.

---

**Note** : Ce module est conçu pour Odoo 16.
