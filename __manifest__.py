# -*- coding: utf-8 -*-

{
  "name" : "InfoSaône - Tableau de bord pour Odoo 16",
  "version" : "16.0.0.3.0",
  "author" : "InfoSaône / Tony Galmiche",
  "category" : "InfoSaône",
  "description": """
InfoSaône - Tableau de bord pour Odoo 16

Module permettant de créer des tableaux de bord personnalisés en affichant
plusieurs recherches enregistrées sur une même page.

Fonctionnalités :
- Création de tableaux de bord avec nom personnalisé
- Ajout de recherches enregistrées (listes, graphiques, tableaux croisés)
- Configuration de la taille et position des éléments
- Affichage en temps réel des données
""",
  "maintainer": "InfoSaône",
  "website": "http://www.infosaone.com",
  "depends" : [
    'base',
    'web',
  ], 
  "init_xml" : [],            
  "demo_xml" : [
    'data/demo_data.xml',
  ],            
  "data" : [
  'security/is_tableau_de_bord_security.xml',
  'security/ir.model.access.csv',
  'views/ir_filters_views.xml',
  'views/is_tableau_de_bord_views.xml',
  ],   
   'assets': {
        'web.assets_backend': [
            'is_tableau_de_bord16/static/src/css/dashboard.css',
            'is_tableau_de_bord16/static/src/scss/kanban_view.scss',
            'web/static/lib/Chart/Chart.js',
            'is_tableau_de_bord16/static/src/js/dashboard_view.js',
        ],
    },
  "installable": True,         
  "active": False,            
  "application": True,
  "license": "AGPL-3",
}


