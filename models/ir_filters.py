# -*- coding: utf-8 -*-

from odoo import models, fields, api
import json


class IrFilters(models.Model):
    _inherit = 'ir.filters'

    # Nouveaux champs pour stocker le menu et la vue courante
    is_menu_id = fields.Many2one(
        'ir.ui.menu', 
        string='Menu courant',
        help="Menu qui était actif lors de la création de cette recherche enregistrée"
    )
    is_view_id = fields.Many2one(
        'ir.ui.view', 
        string='Vue courante',
        help="Vue qui était active lors de la création de cette recherche enregistrée"
    )
    is_view_type = fields.Selection([
        ('list', 'Liste'),
        ('form', 'Formulaire'),
        ('kanban', 'Kanban'),
        ('calendar', 'Calendrier'),
        ('pivot', 'Tableau croisé'),
        ('graph', 'Graphique'),
        ('activity', 'Activité'),
        ('gantt', 'Gantt'),
        ('map', 'Carte'),
    ], string='Type de vue', help="Type de vue qui était active lors de la création")
    is_visible_columns = fields.Char(
        string='Colonnes visibles',
        help="Liste des colonnes visibles dans la vue list au moment de la création (séparées par des virgules)"
    )

    @api.model
    def create_or_replace(self, vals):
        """
        Override de la méthode create_or_replace pour capturer 
        le menu_id, view_id et view_type depuis le contexte du favori
        """
        # Extraire les informations du contexte dans vals si elles existent
        if 'context' in vals and vals['context']:
            try:
                # Parser le contexte (peut être une chaîne JSON ou un dict)
                if isinstance(vals['context'], str):
                    # Remplacer les valeurs JavaScript par des valeurs Python avant de parser
                    context_str = vals['context'].replace('null', 'None').replace('true', 'True').replace('false', 'False')
                    context_dict = json.loads(context_str) if context_str else {}
                else:
                    context_dict = vals['context']
                
                # Extraire menu_id, view_id et view_type du contexte
                if 'active_menu_id' in context_dict and context_dict['active_menu_id']:
                    vals['is_menu_id'] = context_dict['active_menu_id']
                    del context_dict['active_menu_id']
                
                if 'active_view_id' in context_dict and context_dict['active_view_id']:
                    vals['is_view_id'] = context_dict['active_view_id']
                    del context_dict['active_view_id']
                
                if 'view_type' in context_dict and context_dict['view_type']:
                    vals['is_view_type'] = context_dict['view_type']
                    del context_dict['view_type']
                
                if 'visible_columns' in context_dict and context_dict['visible_columns']:
                    # Convertir la liste en chaîne séparée par des virgules
                    if isinstance(context_dict['visible_columns'], list):
                        vals['is_visible_columns'] = ','.join(context_dict['visible_columns'])
                    else:
                        vals['is_visible_columns'] = str(context_dict['visible_columns'])
                    del context_dict['visible_columns']
                
                # Nettoyer les valeurs None (Python) pour les remplacer par False ou supprimer
                cleaned_context = {}
                for key, value in context_dict.items():
                    if value is not None:
                        cleaned_context[key] = value
                
                # Remettre le contexte nettoyé au format JSON valide
                vals['context'] = json.dumps(cleaned_context) if cleaned_context else '{}'
                
            except (json.JSONDecodeError, TypeError, KeyError) as e:
                # En cas d'erreur, on continue sans bloquer
                self.env['ir.logging'].sudo().create({
                    'name': 'ir.filters.create_or_replace',
                    'type': 'server',
                    'level': 'warning',
                    'message': f"Erreur lors de l'extraction des métadonnées du contexte: {str(e)}",
                    'path': 'is_tableau_de_bord16/models/ir_filters.py',
                    'line': '0',
                    'func': 'create_or_replace',
                })
        
        # Appeler la méthode parent
        return super(IrFilters, self).create_or_replace(vals)
