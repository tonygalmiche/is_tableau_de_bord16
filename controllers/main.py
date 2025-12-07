# -*- coding: utf-8 -*-

import json
import ast
import logging
import re
from datetime import datetime, timedelta
from odoo import http
from odoo.http import request
from lxml import etree


_logger = logging.getLogger(__name__)


def clean_for_json(obj):
    """Convertit récursivement les frozendict et autres objets non-sérialisables en objets JSON-compatibles"""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    elif isinstance(obj, (list, tuple)):
        return [clean_for_json(item) for item in obj]
    elif isinstance(obj, dict) or (hasattr(obj, '__class__') and 'frozendict' in str(type(obj))):
        # Convertir dict ou frozendict
        return {str(k): clean_for_json(v) for k, v in dict(obj).items()}
    else:
        # Pour les autres types, tenter une conversion en string
        return str(obj)


class TableauDeBordController(http.Controller):

    def _parse_filter_value(self, field_name, field_type, filter_value, filter_type='text'):
        """Parse une valeur de filtre avec support des opérateurs avancés
        
        Syntaxe supportée:
        - Opérateur OU: virgule ou mot-clé OU (ex: "toto, tutu" ou "toto OU tutu")
        - Opérateur ET: mot-clé ET (ex: ">100 ET <200")
        - Wildcards: * pour texte (ex: "abc*", "*xyz", "abc*xyz")
        - Opérateurs numériques: >, >=, <, <=, = (ex: ">100", "<=50")
        - Opérateurs de dates: mêmes opérateurs (ex: ">2025", "<=2025-03")
        - Booléens: 1/0, true/false, vrai/faux, yes/no, oui/non
        """
        if not filter_value or not filter_value.strip():
            return []
        
        filter_value = filter_value.strip()
        
        # Gérer l'opérateur ET en priorité (car il ne peut pas être dans une valeur)
        if ' ET ' in filter_value.upper():
            parts = re.split(r'\s+ET\s+', filter_value, flags=re.IGNORECASE)
            domain = []
            for part in parts:
                sub_domain = self._parse_filter_value(field_name, field_type, part.strip(), filter_type)
                domain.extend(sub_domain)
            return domain
        
        # Gérer l'opérateur OU (virgule ou mot-clé OU)
        # Pour les nombres décimaux, éviter de split sur la virgule décimale
        or_parts = []
        if ' OU ' in filter_value.upper():
            or_parts = re.split(r'\s+OU\s+', filter_value, flags=re.IGNORECASE)
        elif ',' in filter_value:
            # Vérifier si c'est un nombre décimal ou une liste
            if field_type in ['integer', 'float', 'monetary']:
                # Si commence par un opérateur ou contient plusieurs virgules, c'est une liste
                if re.match(r'^[><=]', filter_value) or filter_value.count(',') > 1:
                    or_parts = [p.strip() for p in filter_value.split(',')]
                else:
                    # Sinon c'est probablement un décimal unique
                    or_parts = [filter_value]
            else:
                or_parts = [p.strip() for p in filter_value.split(',')]
        else:
            or_parts = [filter_value]
        
        if len(or_parts) > 1:
            # Créer un domaine OR
            or_domains = []
            for part in or_parts:
                sub_domain = self._parse_single_filter(field_name, field_type, part.strip(), filter_type)
                if sub_domain:
                    or_domains.append(sub_domain)
            
            if len(or_domains) == 0:
                return []
            elif len(or_domains) == 1:
                return or_domains[0]
            else:
                # Construire le domaine OR en Odoo
                # Pour n domaines, on a besoin de (n-1) opérateurs '|'
                result = []
                
                # Ajouter les opérateurs OR
                for i in range(len(or_domains) - 1):
                    result.append('|')
                
                # Ajouter chaque domaine
                for dom in or_domains:
                    if len(dom) == 1:
                        # Condition simple, l'ajouter directement
                        result.append(dom[0])
                    elif len(dom) == 2:
                        # Deux conditions (ex: année avec >= et <=)
                        # Il faut les grouper avec '&'
                        result.append('&')
                        result.extend(dom)
                    else:
                        # Plus de 2 conditions, ajouter des '&' pour toutes
                        for i in range(len(dom) - 1):
                            result.append('&')
                        result.extend(dom)
                
                return result
        else:
            return self._parse_single_filter(field_name, field_type, filter_value, filter_type)
    
    def _parse_single_filter(self, field_name, field_type, filter_value, filter_type='text'):
        """Parse une valeur de filtre unique (sans opérateurs OU/ET)"""
        domain = []
        
        try:
            # Booléen
            if field_type == 'boolean':
                val_lower = filter_value.lower()
                if val_lower in ['1', 'true', 'vrai', 'yes', 'oui']:
                    return [(field_name, '=', True)]
                elif val_lower in ['0', 'false', 'faux', 'no', 'non']:
                    return [(field_name, '=', False)]
                return []
            
            # Numérique (integer, float, monetary)
            if field_type in ['integer', 'float', 'monetary']:
                return self._parse_numeric_filter(field_name, filter_value)
            
            # Date
            if field_type == 'date' and filter_type == 'date':
                return self._parse_date_filter(field_name, filter_value)
            
            # Texte (char, text, many2one, selection)
            if field_type in ['char', 'text', 'selection']:
                return self._parse_text_filter(field_name, filter_value)
            
            # Many2one
            if field_type == 'many2one':
                return self._parse_text_filter(field_name + '.name', filter_value)
                
        except Exception:
            pass
        
        return domain
    
    def _parse_numeric_filter(self, field_name, filter_value):
        """Parse un filtre numérique avec opérateurs"""
        # Remplacer virgule par point pour les décimaux
        filter_value = filter_value.replace(',', '.')
        
        # Détecter l'opérateur
        match = re.match(r'^(>=?|<=?|=)?\s*(-?\d+\.?\d*)$', filter_value)
        if match:
            operator = match.group(1) or '='
            value = float(match.group(2))
            return [(field_name, operator, value)]
        
        return []
    
    def _parse_text_filter(self, field_name, filter_value):
        """Parse un filtre texte avec wildcards"""
        # Gérer les wildcards
        if '*' in filter_value:
            pattern = filter_value.replace('*', '%')
            return [(field_name, 'ilike', pattern)]
        else:
            # Recherche contient par défaut (ajouter % des 2 côtés)
            pattern = f'%{filter_value}%'
            return [(field_name, 'ilike', pattern)]

    def _parse_date_filter(self, field_name, filter_value):
        """Parse une valeur de filtre de date avec opérateurs
        Formats supportés:
        - AAAA : année complète
        - AAAA-MM : mois complet  
        - AAAA-SXX : semaine XX de l'année
        - JJ/MM/AAAA ou AAAA-MM-JJ : date exacte
        - Avec opérateurs: >2025, <=2025-03, etc.
        """
        domain = []
        
        # Détecter l'opérateur
        match = re.match(r'^(>=?|<=?|=)?\s*(.+)$', filter_value.strip())
        if not match:
            return []
        
        operator = match.group(1) or '='
        date_str = match.group(2).strip()
        
        try:
            # Format année seule (AAAA)
            if re.match(r'^\d{4}$', date_str):
                year = int(date_str)
                if operator == '=':
                    domain.append((field_name, '>=', f'{year}-01-01'))
                    domain.append((field_name, '<=', f'{year}-12-31'))
                elif operator == '>':
                    domain.append((field_name, '>', f'{year}-12-31'))
                elif operator == '>=':
                    domain.append((field_name, '>=', f'{year}-01-01'))
                elif operator == '<':
                    domain.append((field_name, '<', f'{year}-01-01'))
                elif operator == '<=':
                    domain.append((field_name, '<=', f'{year}-12-31'))
            
            # Format année-mois (AAAA-MM)
            elif re.match(r'^\d{4}-\d{2}$', date_str):
                year, month = map(int, date_str.split('-'))
                start_date = datetime(year, month, 1)
                if month == 12:
                    end_date = datetime(year + 1, 1, 1) - timedelta(days=1)
                else:
                    end_date = datetime(year, month + 1, 1) - timedelta(days=1)
                
                if operator == '=':
                    domain.append((field_name, '>=', start_date.strftime('%Y-%m-%d')))
                    domain.append((field_name, '<=', end_date.strftime('%Y-%m-%d')))
                elif operator == '>':
                    domain.append((field_name, '>', end_date.strftime('%Y-%m-%d')))
                elif operator == '>=':
                    domain.append((field_name, '>=', start_date.strftime('%Y-%m-%d')))
                elif operator == '<':
                    domain.append((field_name, '<', start_date.strftime('%Y-%m-%d')))
                elif operator == '<=':
                    domain.append((field_name, '<=', end_date.strftime('%Y-%m-%d')))
            
            # Format année-semaine (AAAA-SXX)
            elif re.match(r'^\d{4}-S\d{2}$', date_str.upper()):
                year_week = date_str.upper().split('-S')
                year = int(year_week[0])
                week = int(year_week[1])
                jan1 = datetime(year, 1, 1)
                start_date = jan1 + timedelta(weeks=week-1, days=-jan1.weekday())
                end_date = start_date + timedelta(days=6)
                
                if operator == '=':
                    domain.append((field_name, '>=', start_date.strftime('%Y-%m-%d')))
                    domain.append((field_name, '<=', end_date.strftime('%Y-%m-%d')))
                elif operator == '>':
                    domain.append((field_name, '>', end_date.strftime('%Y-%m-%d')))
                elif operator == '>=':
                    domain.append((field_name, '>=', start_date.strftime('%Y-%m-%d')))
                elif operator == '<':
                    domain.append((field_name, '<', start_date.strftime('%Y-%m-%d')))
                elif operator == '<=':
                    domain.append((field_name, '<=', end_date.strftime('%Y-%m-%d')))
            
            # Format date complète JJ/MM/AAAA
            elif re.match(r'^\d{2}/\d{2}/\d{4}$', date_str):
                day, month, year = map(int, date_str.split('/'))
                date_value = f'{year:04d}-{month:02d}-{day:02d}'
                domain.append((field_name, operator, date_value))
            
            # Format date complète AAAA-MM-JJ
            elif re.match(r'^\d{4}-\d{2}-\d{2}$', date_str):
                domain.append((field_name, operator, date_str))
                
        except Exception:
            pass
        
        return domain

    @http.route('/tableau_de_bord/save_filter', type='json', auth='user')
    def save_filter(self, dashboard_id=None, filters_dict=None):
        """Sauvegarde les filtres pour l'utilisateur courant"""
        if dashboard_id and filters_dict:
            request.env['is.tableau.de.bord.mem.filter'].save_filters(dashboard_id, filters_dict)
        return {'success': True}

    @http.route('/tableau_de_bord/get_saved_filter/<int:dashboard_id>', type='json', auth='user')
    def get_saved_filter(self, dashboard_id):
        """Récupère les derniers filtres saisis pour l'utilisateur courant"""
        filters_dict = request.env['is.tableau.de.bord.mem.filter'].get_filters(dashboard_id)
        return {'filters': filters_dict}

    @http.route('/tableau_de_bord/get_filter_data/<int:filter_id>', type='json', auth='user')
    def get_filter_data(self, filter_id, line_id=None, **kwargs):
        """Récupère les données d'un filtre pour l'afficher dans le tableau de bord"""
        try:
            # line_id/overrides peuvent arriver uniquement dans kwargs selon le client JS
            if not line_id:
                line_id = kwargs.get('line_id')
            overrides = kwargs.get('overrides') or {}
            dashboard_id = kwargs.get('dashboard_id')
            filters_values = kwargs.get('filters_values') or {}
            
            filter_obj = request.env['ir.filters'].browse(filter_id)
            if not filter_obj.exists():
                return {'error': 'Filtre non trouvé'}

            model = request.env[filter_obj.model_id]

            # Récupérer le domaine du filtre
            domain = []
            if filter_obj.domain:
                try:
                    domain = ast.literal_eval(filter_obj.domain)
                except Exception:
                    domain = []

            # Appliquer les filtres dynamiques si définis
            if filters_values and line_id:
                try:
                    line = request.env['is.tableau.de.bord.line'].browse(int(line_id))
                    if line and line.exists() and line.line_filter_ids:
                        for line_filter in line.line_filter_ids:
                            filter_def_id = line_filter.filter_def_id.id
                            # Convertir les clés du dictionnaire en int pour la comparaison
                            filter_value = None
                            for key, val in filters_values.items():
                                if int(key) == filter_def_id:
                                    filter_value = val
                                    break
                            
                            if filter_value:
                                field_name = line_filter.field_id.name
                                field_type = line_filter.field_id.ttype
                                filter_type = line_filter.filter_def_id.filter_type
                                
                                # Utiliser le parser avancé
                                parsed_domain = self._parse_filter_value(field_name, field_type, filter_value, filter_type)
                                if parsed_domain:
                                    domain.extend(parsed_domain)
                except Exception:
                    import traceback
                    traceback.print_exc()

            print(f"Domaine final: {domain}")

            # Récupérer le contexte du filtre
            context = {}
            if filter_obj.context:
                try:
                    # Remplacer null par None pour que ast.literal_eval fonctionne
                    context_str = filter_obj.context.replace('null', 'None').replace('true', 'True').replace('false', 'False')
                    context = ast.literal_eval(context_str)
                except Exception as e:
                    context = {}

            # Fusionner avec le contexte actuel
            ctx = dict(request.env.context)
            # Conserver les informations importantes du contexte du filtre AVANT d'ajouter celles de la ligne
            if context:
                ctx.update(context)
            
            # Ajouter le line_id au contexte pour qu'il soit accessible dans _get_list_data
            if line_id:
                ctx['line_id'] = line_id

            # Récupérer la ligne pour accéder à ses paramètres (notamment limit)
            line = None
            # Appliquer overrides éventuels de la ligne (sur ctx)
            # Ces overrides peuvent SURCHARGER le contexte du filtre si définis dans la ligne
            if line_id:
                try:
                    line = request.env['is.tableau.de.bord.line'].browse(int(line_id))
                    if line and line.exists():
                        if line.display_mode and line.display_mode != 'auto':
                            ctx['search_default_view_type'] = line.display_mode
                        # Seulement surcharger si la ligne a des valeurs définies
                        if line.graph_chart_type:
                            ctx['graph_chart_type'] = line.graph_chart_type
                        if line.graph_aggregator:
                            ctx['graph_aggregator'] = line.graph_aggregator
                        if line.graph_measure:
                            ctx['graph_measure'] = line.graph_measure
                        if line.graph_groupbys:
                            ctx['graph_groupbys'] = line.graph_groupbys
                        # Toujours passer graph_show_legend (avec valeur par défaut True)
                        ctx['graph_show_legend'] = line.graph_show_legend if hasattr(line, 'graph_show_legend') else True
                        if line.pivot_row_groupby:
                            # Convertir la chaîne en liste si nécessaire
                            ctx['pivot_row_groupby'] = [g.strip() for g in line.pivot_row_groupby.split(',')] if ',' in line.pivot_row_groupby else [line.pivot_row_groupby]
                        if line.pivot_col_groupby:
                            # Convertir la chaîne en liste si nécessaire
                            col_groupby_list = [g.strip() for g in line.pivot_col_groupby.split(',')] if ',' in line.pivot_col_groupby else [line.pivot_col_groupby]
                            ctx['pivot_column_groupby'] = col_groupby_list
                            # Garder aussi la forme simple pour compatibilité
                            ctx['pivot_col_groupby'] = col_groupby_list
                        if line.pivot_measure:
                            # Convertir la chaîne en liste si nécessaire
                            ctx['pivot_measures'] = [g.strip() for g in line.pivot_measure.split(',')] if ',' in line.pivot_measure else [line.pivot_measure]
                        # Ajouter les paramètres de tri
                        if line.pivot_sort_by:
                            ctx['pivot_sort_by'] = line.pivot_sort_by
                        if line.pivot_sort_order:
                            ctx['pivot_sort_order'] = line.pivot_sort_order
                        # Ajouter les paramètres d'affichage des totaux
                        if hasattr(line, 'pivot_show_row_totals'):
                            ctx['pivot_show_row_totals'] = line.pivot_show_row_totals
                        if hasattr(line, 'pivot_show_col_totals'):
                            ctx['pivot_show_col_totals'] = line.pivot_show_col_totals
                except Exception:
                    pass

            # Appliquer aussi d'éventuels overrides envoyés côté client (sécurisé au scope utilisateur)
            if isinstance(overrides, dict):
                safe_keys = {
                    'search_default_view_type', 'graph_chart_type', 'graph_aggregator', 'graph_show_legend', 'show_data_title', 'show_record_count',
                    'pivot_row_groupby', 'pivot_column_groupby', 'pivot_measures',
                    'pivot_sort_by', 'pivot_sort_order',
                    'graph_groupbys', 'graph_measure', 'list_fields', 'measure', 'group_by',
                    'list_groupby'
                }
                for k, v in overrides.items():
                    if k in ('display_mode',):
                        ctx['search_default_view_type'] = v
                    elif k in safe_keys:
                        ctx[k] = v

            # Déterminer le type de vue à utiliser
            view_type = self._get_view_type_from_context(ctx)

            model = model.with_context(ctx)
            if view_type == 'graph':
                return self._get_graph_data(model, filter_obj, domain, ctx, line)
            elif view_type == 'pivot':
                return self._get_pivot_data(model, filter_obj, domain, ctx, line)
            else:
                return self._get_list_data(model, filter_obj, domain, ctx, line)

        except Exception as e:
            import traceback
            traceback.print_exc()
            return {'error': 'Une erreur s\'est produite'}

    def _get_view_type_from_context(self, context):
        """Détermine le type de vue à partir du contexte"""
        # Priorité 1: display_mode explicite (depuis la ligne du tableau de bord)
        if 'search_default_view_type' in context:
            view_type = context.get('search_default_view_type', '')
            if 'graph' in view_type:
                return 'graph'
            if 'pivot' in view_type:
                return 'pivot'
            if 'list' in view_type:
                return 'list'
        
        # Priorité 2: paramètres spécifiques au type de vue
        if context.get('graph_measure') or context.get('graph_groupbys'):
            return 'graph'
        if context.get('pivot_measures') or context.get('pivot_row_groupby') or context.get('pivot_column_groupby'):
            return 'pivot'
        
        # Par défaut: liste
        return 'list'

    def _get_list_data(self, model, filter_obj, domain, context, line=None):
        """Génère les données pour une vue liste
        
        Si un regroupement (list_groupby) est défini, affiche une ligne par groupe
        avec les totaux des champs numériques visibles.
        """
        # Déterminer la limite et show_record_count
        limit = 50  # Valeur par défaut
        show_record_count = context.get('show_record_count', True)
        list_groupby = None  # Regroupement pour le mode liste
        
        # Priorité au contexte (overrides JS), sinon la ligne
        if context.get('list_groupby'):
            list_groupby_str = context.get('list_groupby')
            if isinstance(list_groupby_str, str) and list_groupby_str.strip():
                list_groupby = [g.strip() for g in list_groupby_str.split(',') if g.strip()]
        
        if line and hasattr(line, 'limit') and line.limit > 0:
            limit = line.limit
        if line and hasattr(line, 'show_record_count'):
            show_record_count = line.show_record_count
        if not list_groupby and line and hasattr(line, 'list_groupby') and line.list_groupby:
            list_groupby = [g.strip() for g in line.list_groupby.split(',') if g.strip()]
        
        # 1) Priorité 1: Champs configurés dans la ligne du tableau de bord (field_ids)
        line_id = context.get('line_id')
        explicit_fields = []
        field_labels = {}
        order_string = None  # Chaîne de tri pour search()
        
        if line_id:
            try:
                line = request.env['is.tableau.de.bord.line'].browse(int(line_id))
                if line and line.exists() and line.field_ids:
                    # Récupérer uniquement les champs visibles
                    visible_fields = line.field_ids.filtered(lambda f: f.visible).sorted('sequence')
                    
                    # Récupérer les champs avec ordre de tri (sort_order > 0)
                    sort_fields = line.field_ids.filtered(lambda f: f.sort_order > 0).sorted('sort_order')
                    
                    if sort_fields:
                        # Construire la chaîne de tri : "field1 asc, field2 desc, ..."
                        order_parts = []
                        for field_config in sort_fields:
                            field_name = field_config.field_name
                            direction = field_config.sort_direction or 'asc'
                            if field_name and field_name in model._fields:
                                order_parts.append(f"{field_name} {direction}")
                        if order_parts:
                            order_string = ', '.join(order_parts)
                    
                    # Maintenant field_name contient le nom technique et field_label le libellé
                    for field_config in visible_fields:
                        field_name = field_config.field_name
                        field_label = field_config.field_label or field_name
                        
                        # Vérifier que le champ existe dans le modèle
                        if field_name and field_name in model._fields:
                            explicit_fields.append(field_name)
                            field_labels[field_name] = field_label
                    
            except Exception:
                pass
        
        # 2) Champs explicitement définis dans le favori (list_fields)
        if not explicit_fields and context.get('list_fields'):
            lf = context.get('list_fields')
            if isinstance(lf, str):
                # accepter "a,b,c"
                explicit_fields = [f.strip() for f in lf.split(',') if f.strip()]
            elif isinstance(lf, (list, tuple)):
                explicit_fields = [str(f).strip() for f in lf if str(f).strip()]
            # ne garder que les champs existants
            explicit_fields = [f for f in explicit_fields if f in model._fields]
            if explicit_fields:
                fields_def = model.fields_get(explicit_fields)
                field_labels = {f: fields_def.get(f, {}).get('string', f) for f in explicit_fields}

        view_id = None
        xmlid = context.get('tree_view_ref') or context.get('list_view_ref')
        if xmlid:
            try:
                view_id = request.env.ref(xmlid).id
            except Exception:
                view_id = None

        if explicit_fields:
            # libellés depuis fields_get
            if not field_labels:
                fields_def = model.fields_get(explicit_fields)
                field_labels = {f: fields_def.get(f, {}).get('string', f) for f in explicit_fields}
            fields_to_display = explicit_fields
        else:
            fields_to_display, field_labels = self._get_fields_from_view(model, 'list', view_id=view_id)

        # Récupérer les métadonnées complètes des champs pour le formatage
        fields_def = model.fields_get(fields_to_display)
        
        # Si regroupement défini, utiliser read_group au lieu de search/read
        if list_groupby:
            return self._get_grouped_list_data(
                model, filter_obj, domain, context, line,
                list_groupby, fields_to_display, field_labels, fields_def,
                order_string, limit, show_record_count
            )
        
        # Mode normal sans regroupement
        # Appliquer le tri si défini
        
        if order_string:
            recs = model.search(domain, limit=limit, order=order_string)
        else:
            recs = model.search(domain, limit=limit)
            
        # Lire les données et convertir en dictionnaires normaux pour éviter les frozendict
        raw_data = recs.read(fields_to_display) if recs else []
        
        # Convertir les valeurs de selection en leurs libellés
        for row in raw_data:
            for f in fields_to_display:
                field_info = fields_def.get(f, {})
                if field_info.get('type') == 'selection' and f in row and row[f]:
                    # Récupérer les options de sélection
                    selection = field_info.get('selection', [])
                    if selection:
                        # Chercher le libellé correspondant à la valeur
                        for key, label in selection:
                            if key == row[f]:
                                row[f] = label
                                break
        
        data = [clean_for_json(row) for row in raw_data]

        # Créer les métadonnées avec type et digits pour le formatage
        fields_meta = []
        for f in fields_to_display:
            field_info = fields_def.get(f, {})
            
            meta = {
                'name': f,
                'string': field_labels.get(f, f),
                'type': field_info.get('type', 'char'),
            }
            # Ajouter digits pour les champs float et monetary
            if meta['type'] in ('float', 'monetary'):
                digits = field_info.get('digits')
                if digits:
                    # digits peut être [precision, scale] ou (precision, scale)
                    if isinstance(digits, (list, tuple)) and len(digits) >= 2:
                        meta['digits'] = int(digits[1])  # scale (nombre de décimales) - convertir en int
                    else:
                        meta['digits'] = 2  # Par défaut 2 décimales
                else:
                    meta['digits'] = 2  # Par défaut 2 décimales
            fields_meta.append(meta)

        result = {
            'type': 'list',
            'data': data,
            'fields': fields_meta,
            'model': filter_obj.model_id,
        }
        
        # Ajouter le compteur seulement si show_record_count est True
        if show_record_count:
            result['count'] = model.search_count(domain)
            result['show_record_count'] = True
        else:
            result['show_record_count'] = False
        
        return result
    
    def _get_grouped_list_data(self, model, filter_obj, domain, context, line,
                                list_groupby, fields_to_display, field_labels, fields_def,
                                order_string, limit, show_record_count):
        """Génère les données groupées pour une vue liste avec regroupement hiérarchique
        
        Si plusieurs niveaux de regroupement, affiche :
        - Une ligne de total par groupe de niveau 1 (ex: Secteur)
        - En dessous, les lignes de détail du niveau 2 (ex: Partner) avec la colonne niveau 1 vide
        """
        
        # Parser order_string pour le tri après read_group
        # Format: "field1 asc, field2 desc"
        sort_config = []
        if order_string:
            for part in order_string.split(','):
                part = part.strip()
                if ' ' in part:
                    field_name, direction = part.rsplit(' ', 1)
                    sort_config.append({
                        'field': field_name.strip(),
                        'reverse': direction.lower() == 'desc'
                    })
                elif part:
                    sort_config.append({'field': part, 'reverse': False})
        
        # Identifier les champs numériques visibles ET stockés en base
        numeric_fields = []
        numeric_types = ['integer', 'float', 'monetary']
        
        for fname in fields_to_display:
            field_info = fields_def.get(fname, {})
            # Vérifier que le champ est numérique ET stocké (store=True)
            if field_info.get('type') in numeric_types:
                # Vérifier si le champ est stocké (par défaut True, sauf si explicitement False)
                is_stored = field_info.get('store', True)
                if is_stored:
                    numeric_fields.append(fname)
        
        # Construire les champs pour read_group (agrégation sum des champs numériques)
        read_group_fields = []
        for fname in numeric_fields:
            read_group_fields.append(f"{fname}:sum")
        
        # Si aucun champ numérique, utiliser __count
        if not read_group_fields:
            read_group_fields = ['__count']
        
        # Récupérer les mappings pour les champs Selection
        selection_maps = {}
        groupby_base_fields = [gb.split(':')[0] for gb in list_groupby]
        for gb in list_groupby:
            base_field = gb.split(':')[0]
            selection_maps[base_field] = self._get_selection_map(model, base_field)
        
        # Fonction helper pour extraire le libellé d'une valeur de regroupement
        def get_groupby_label(gb, value):
            base_field = gb.split(':')[0]
            if isinstance(value, (list, tuple)) and len(value) > 1:
                return value[1]  # [id, display_name]
            elif selection_maps.get(base_field) and value in selection_maps[base_field]:
                return selection_maps[base_field][value]
            else:
                return str(value) if value is not None else 'Non défini'
        
        # Fonction helper pour extraire les valeurs numériques d'un résultat read_group
        def get_numeric_values(r):
            values = {}
            for fname in numeric_fields:
                values[fname] = r.get(fname) or r.get(f"{fname}_sum") or 0
            values['__count'] = r.get('__count', 0)
            return values
        
        data = []
        
        if len(list_groupby) >= 2:
            # Mode hiérarchique : regroupement sur plusieurs niveaux
            first_gb = list_groupby[0]
            first_base = first_gb.split(':')[0]
            
            # 1) Récupérer les totaux du premier niveau (ex: par Secteur)
            try:
                level1_results = model.read_group(
                    domain,
                    fields=read_group_fields,
                    groupby=[first_gb],
                    lazy=False
                )
            except Exception as e:
                level1_results = []
            
            # 2) Récupérer les détails du deuxième niveau (ex: par Secteur + Partner)
            try:
                level2_results = model.read_group(
                    domain,
                    fields=read_group_fields,
                    groupby=list_groupby,
                    lazy=False
                )
            except Exception as e:
                level2_results = []
            
            # Appliquer le tri sur les résultats de niveau 1 si configuré
            # On peut trier sur les champs numériques ET sur le champ de regroupement niveau 1
            if sort_config and level1_results:
                # Filtrer les critères de tri pour ne garder que les champs pertinents
                # (champs numériques OU premier champ de regroupement)
                valid_sort_fields = numeric_fields + [first_base]
                level1_sort_config = [cfg for cfg in sort_config if cfg['field'] in valid_sort_fields]
                
                if level1_sort_config:
                    for cfg in reversed(level1_sort_config):
                        field_name = cfg['field']
                        reverse = cfg['reverse']
                        
                        def get_val_l1(row, fn=field_name, fb=first_base):
                            # Si c'est le champ de regroupement, utiliser le libellé
                            if fn == fb:
                                val = row.get(fn) or row.get(f"{fn}_sum")
                                # Pour les many2one, la valeur est (id, name)
                                if isinstance(val, (list, tuple)) and len(val) > 1:
                                    return str(val[1]).lower()
                                return str(val).lower() if val else ''
                            # Sinon c'est un champ numérique
                            val = row.get(fn) or row.get(f"{fn}_sum") or 0
                            if isinstance(val, (int, float)):
                                return val
                            return 0
                        
                        try:
                            level1_results.sort(key=get_val_l1, reverse=reverse)
                        except Exception:
                            pass
            
            # 3) Organiser les données niveau 2 par valeur du niveau 1
            level2_by_level1 = {}
            for r in level2_results:
                # Clé du niveau 1
                val1 = r.get(first_gb) or r.get(first_base)
                if isinstance(val1, (list, tuple)):
                    key1 = val1[0] if val1 else None  # Utiliser l'ID comme clé
                else:
                    key1 = val1
                
                if key1 not in level2_by_level1:
                    level2_by_level1[key1] = []
                level2_by_level1[key1].append(r)
            
            # Trier les détails de niveau 2 par groupe si tri configuré
            # On peut trier sur les champs numériques ET sur les champs de regroupement niveau 2+
            other_groupby_fields = [gb.split(':')[0] for gb in list_groupby[1:]]
            valid_sort_fields_l2 = numeric_fields + other_groupby_fields
            level2_sort_config = [cfg for cfg in sort_config if cfg['field'] in valid_sort_fields_l2]
            
            if level2_sort_config:
                for key1 in level2_by_level1:
                    details = level2_by_level1[key1]
                    for cfg in reversed(level2_sort_config):
                        field_name = cfg['field']
                        reverse = cfg['reverse']
                        
                        def get_val_l2(row, fn=field_name, ogf=other_groupby_fields):
                            # Si c'est un champ de regroupement, utiliser le libellé
                            if fn in ogf:
                                val = row.get(fn)
                                # Pour les many2one, la valeur est (id, name)
                                if isinstance(val, (list, tuple)) and len(val) > 1:
                                    return str(val[1]).lower()
                                return str(val).lower() if val else ''
                            # Sinon c'est un champ numérique
                            val = row.get(fn) or row.get(f"{fn}_sum") or 0
                            if isinstance(val, (int, float)):
                                return val
                            return 0
                        
                        try:
                            details.sort(key=get_val_l2, reverse=reverse)
                        except Exception:
                            pass
            
            # 4) Construire les données hiérarchiques
            for r1 in level1_results:
                val1 = r1.get(first_gb) or r1.get(first_base)
                if isinstance(val1, (list, tuple)):
                    key1 = val1[0] if val1 else None
                else:
                    key1 = val1
                
                label1 = get_groupby_label(first_gb, val1)
                
                # Ligne de total du niveau 1 (Secteur)
                row_total = {
                    first_base: label1,
                    '_is_group_header': True,  # Marqueur pour le style
                    '_group_level': 1,
                }
                # Les autres colonnes de regroupement sont vides pour la ligne de total
                for gb in list_groupby[1:]:
                    base_field = gb.split(':')[0]
                    row_total[base_field] = ''
                
                # Ajouter les valeurs numériques (totaux du niveau 1)
                row_total.update(get_numeric_values(r1))
                data.append(row_total)
                
                # Lignes de détail du niveau 2 (Partners de ce Secteur)
                details = level2_by_level1.get(key1, [])
                for r2 in details:
                    row_detail = {
                        first_base: '',  # Colonne niveau 1 vide
                        '_is_group_header': False,
                        '_group_level': 2,
                    }
                    # Remplir les colonnes des autres niveaux de regroupement
                    for gb in list_groupby[1:]:
                        base_field = gb.split(':')[0]
                        val = r2.get(gb) or r2.get(base_field)
                        row_detail[base_field] = get_groupby_label(gb, val)
                    
                    # Ajouter les valeurs numériques
                    row_detail.update(get_numeric_values(r2))
                    data.append(row_detail)
        
        else:
            # Mode simple : un seul niveau de regroupement
            try:
                results = model.read_group(
                    domain,
                    fields=read_group_fields,
                    groupby=list_groupby,
                    lazy=False
                )
            except Exception:
                results = []
            
            for r in results:
                row = {'_is_group_header': False, '_group_level': 1}
                
                # Ajouter les champs de regroupement avec leurs libellés
                for gb in list_groupby:
                    base_field = gb.split(':')[0]
                    val = r.get(gb) or r.get(base_field)
                    row[base_field] = get_groupby_label(gb, val)
                
                # Ajouter les valeurs numériques
                row.update(get_numeric_values(r))
                data.append(row)
        
        # Appliquer le tri si configuré (mode simple uniquement - pas en mode hiérarchique)
        # Le tri est déjà appliqué avant pour le mode hiérarchique
        if sort_config and data and len(list_groupby) < 2:
            # Trier selon le type de données
            # Si un seul critère de tri, utiliser reverse directement
            if len(sort_config) == 1:
                field_name = sort_config[0]['field']
                reverse = sort_config[0]['reverse']
                
                def get_sort_value(row):
                    val = row.get(field_name, 0)
                    if isinstance(val, (int, float)):
                        return val
                    return str(val).lower() if val else ''
                
                try:
                    data.sort(key=get_sort_value, reverse=reverse)
                except Exception:
                    pass
            else:
                # Tri multi-critères plus complexe
                # On doit inverser l'ordre des critères et trier en plusieurs passes
                for cfg in reversed(sort_config):
                    field_name = cfg['field']
                    reverse = cfg['reverse']
                    
                    def get_val(row, fn=field_name):
                        val = row.get(fn, 0)
                        if isinstance(val, (int, float)):
                            return val
                        return str(val).lower() if val else ''
                    
                    try:
                        data.sort(key=get_val, reverse=reverse)
                    except Exception:
                        pass
        
        # Appliquer la limite (attention : en mode hiérarchique, compter les groupes principaux)
        # Pour l'instant, on limite le nombre total de lignes
        if limit and limit > 0:
            data = data[:limit]
        
        data = [clean_for_json(row) for row in data]
        
        # Récupérer les métadonnées des champs de regroupement
        groupby_fields_def = model.fields_get(groupby_base_fields)
        
        # Construire les métadonnées des champs à afficher (groupement + numériques seulement)
        fields_meta = []
        
        # D'abord les champs de regroupement
        for gb in list_groupby:
            base_field = gb.split(':')[0]
            field_info = groupby_fields_def.get(base_field, {})
            meta = {
                'name': base_field,
                'string': field_info.get('string', base_field),
                'type': 'char',  # Afficher comme texte (le libellé)
                'is_groupby': True,
            }
            fields_meta.append(meta)
        
        # Ensuite les champs numériques
        for fname in numeric_fields:
            field_info = fields_def.get(fname, {})
            meta = {
                'name': fname,
                'string': field_labels.get(fname, field_info.get('string', fname)),
                'type': field_info.get('type', 'float'),
                'is_aggregate': True,
            }
            # Ajouter digits pour les champs float et monetary
            if meta['type'] in ('float', 'monetary'):
                digits = field_info.get('digits')
                if digits:
                    if isinstance(digits, (list, tuple)) and len(digits) >= 2:
                        meta['digits'] = int(digits[1])
                    else:
                        meta['digits'] = 2
                else:
                    meta['digits'] = 2
            fields_meta.append(meta)
        
        result = {
            'type': 'list',
            'data': data,
            'fields': fields_meta,
            'model': filter_obj.model_id,
            'is_grouped': True,
            'groupby': list_groupby,
        }
        
        # Ajouter le compteur seulement si show_record_count est True
        if show_record_count:
            result['count'] = model.search_count(domain)
            result['show_record_count'] = True
        else:
            result['show_record_count'] = False
        
        return result

    def _get_graph_data(self, model, filter_obj, domain, context, line=None):
        """Génère les données pour un graphique simple"""
        # Déterminer la limite et le tri (depuis line ou contexte)
        limit = None
        sort_by = context.get('pivot_sort_by', 'row')  # Par défaut tri par libellé
        sort_order = context.get('pivot_sort_order', 'asc')
        
        if line and hasattr(line, 'limit') and line.limit > 0:
            limit = line.limit
        if line and hasattr(line, 'pivot_sort_by') and line.pivot_sort_by:
            sort_by = line.pivot_sort_by  # 'row' = tri par libellé, 'total' = tri par valeur
        if line and hasattr(line, 'pivot_sort_order') and line.pivot_sort_order:
            sort_order = line.pivot_sort_order
        
        groupbys = context.get('graph_groupbys') or context.get('group_by') or []
        
        if isinstance(groupbys, str):
            # Si c'est une chaîne séparée par des virgules, on split
            if ',' in groupbys:
                groupbys = [g.strip() for g in groupbys.split(',')]
            else:
                groupbys = [groupbys]
        
        measure = context.get('graph_measure') or context.get('measure')
        aggregator = context.get('graph_aggregator') or 'sum'
        chart_type = context.get('graph_chart_type') or 'bar'
        # Gérer explicitement le booléen (peut être False, True, ou absent)
        show_legend = context.get('graph_show_legend')
        if show_legend is None:
            show_legend = True
        show_data_title = context.get('show_data_title')
        if show_data_title is None:
            show_data_title = True

        agg_label = "Nombre d'enregistrements"
        use_count = not measure or str(measure) in ('count', '__count')
        fields = [] if use_count else [f"{measure}:{aggregator}"]
        
        if not use_count:
            # Traduire l'agrégateur
            agg_translations = {
                'sum': 'Somme',
                'avg': 'Moyenne',
                'max': 'Maximum',
                'min': 'Minimum',
                'count': 'Nombre',
            }
            agg_french = agg_translations.get(aggregator, aggregator)
            
            # Récupérer le nom traduit du champ
            measure_field_name = measure
            try:
                field_info = model.fields_get([measure])
                measure_field_name = field_info.get(measure, {}).get('string', measure)
            except Exception:
                pass
            
            agg_label = f"{agg_french} de {measure_field_name}"

        try:
            # NE PAS appliquer limit dans read_group (on le fera après le tri)
            results = model.read_group(domain, fields=fields, groupby=groupbys, lazy=False)
        except Exception:
            results = []

        # Construire les labels et valeurs
        data_list = []
        if results:
            for r in results:
                label_parts = []
                for gb in groupbys:
                    base = gb.split(':')[0]
                    val = r.get(gb) or r.get(base) or r.get(f"{gb}_name") or r.get(f"{base}_name")
                    # Pour les many2one (tuple/list), prendre le display_name (2ème élément)
                    if isinstance(val, (list, tuple)) and len(val) > 1:
                        label_parts.append(str(val[1]) if val[1] is not None else '')
                    elif val is not None:
                        label_parts.append(str(val))
                    else:
                        label_parts.append('')
                label = " / ".join([p for p in label_parts if p])
                
                if use_count:
                    value = r.get("__count") or 0
                else:
                    value = r.get(f"{measure}_{aggregator}") or r.get(measure) or 0
                
                data_list.append({'label': label, 'value': value})
        else:
            total_count = model.search_count(domain)
            data_list = [{'label': 'Total', 'value': total_count}]

        # Appliquer le tri et la limite
        if sort_by == 'total':
            # Tri par valeur
            reverse = (sort_order == 'desc')
            data_list.sort(key=lambda x: x['value'], reverse=reverse)
        else:
            # Tri par libellé (smart key)
            reverse = (sort_order == 'desc')
            data_list.sort(key=lambda x: self._sort_key_smart(x['label']), reverse=reverse)
        
        # Appliquer la limite après le tri
        if limit and limit > 0:
            data_list = data_list[:limit]
        
        # Extraire les labels et valeurs triés/limités
        labels = [item['label'] for item in data_list]
        values = [item['value'] for item in data_list]

        # Ajuster la palette à la longueur
        palette = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22', '#17becf']
        bg = [palette[i % len(palette)] for i in range(len(values))]

        result = {
            'type': 'graph',
            'chart_type': chart_type,
            'show_legend': show_legend,
            'show_data_title': show_data_title,
            'data': {
                'labels': labels,
                'datasets': [{
                    'label': agg_label,
                    'data': values,
                    'backgroundColor': bg
                }]
            }
        }
        
        return result

    def _get_selection_map(self, model, field_name):
        """Récupère le mapping pour un champ Selection"""
        try:
            fields_info = model.fields_get([field_name])
            field_info = fields_info.get(field_name, {})
            if field_info.get('type') == 'selection' and field_info.get('selection'):
                return dict(field_info['selection'])
        except Exception:
            pass
        return {}

    def _extract_label_from_record(self, record, groupby, selection_map=None):
        """Extrait le libellé d'un enregistrement read_group pour un groupby donné"""
        full = (groupby or '')
        base = full.split(':')[0]
        # Tenter d'abord la clé complète (utile pour date groupby: field:year)
        val = record.get(full) or record.get(base)
        
        # Pour les many2one, prendre le display_name
        if isinstance(val, (list, tuple)) and len(val) > 1:
            return val[1]  # [id, display_name]
        
        # Pour les Selection, chercher le libellé
        if selection_map and val in selection_map:
            return selection_map[val]
        
        # Pour les dates avec groupement temporel
        if record.get(f"{base}") and ':' in full:
            return str(val) if val else 'Indéfini'
        
        return str(val) if val is not None else 'Indéfini'

    def _sort_key_smart(self, label):
        """Génère une clé de tri intelligente (numérique si possible, sinon alphabétique)"""
        if label is None:
            return (2, '')  # Les None à la fin
        
        label_str = str(label)
        
        # Mapping des mois français vers leur numéro
        french_months = {
            'janvier': 1, 'février': 2, 'mars': 3, 'avril': 4, 'mai': 5, 'juin': 6,
            'juillet': 7, 'août': 8, 'septembre': 9, 'octobre': 10, 'novembre': 11, 'décembre': 12
        }
        
        # Détecter les dates au format "mois YYYY" (groupement date:month en français)
        # Ex: "janvier 2025", "février 2025", etc.
        import re
        french_month_match = re.match(r'^(\w+)\s+(\d{4})$', label_str, re.IGNORECASE)
        if french_month_match:
            month_name, year = french_month_match.groups()
            month_name_lower = month_name.lower()
            if month_name_lower in french_months:
                # Retourner une clé de tri : (0, année, mois) pour tri chronologique
                return (0, int(year), french_months[month_name_lower])
        
        # Détecter les dates au format "MM/YYYY" (groupement date:month numérique)
        # Ex: "01/2024", "02/2024", etc.
        month_match = re.match(r'^(\d{2})/(\d{4})$', label_str)
        if month_match:
            month, year = month_match.groups()
            # Retourner une clé de tri : (0, année, mois) pour tri chronologique
            return (0, int(year), int(month))
        
        # Détecter les dates au format "YYYY" (groupement date:year)
        year_match = re.match(r'^(\d{4})$', label_str)
        if year_match:
            return (0, int(year_match.group(1)), 0)
        
        # Détecter les dates au format "Q1/2024", "Q2/2024" (groupement date:quarter)
        quarter_match = re.match(r'^Q(\d)/(\d{4})$', label_str)
        if quarter_match:
            quarter, year = quarter_match.groups()
            return (0, int(year), 0, int(quarter))
        
        # Essayer de convertir en nombre pour tri numérique
        try:
            return (1, float(label_str.replace(',', '.').replace(' ', '')))
        except (ValueError, AttributeError):
            # Si ce n'est pas un nombre, tri alphabétique insensible à la casse
            return (2, label_str.lower())

    def _sort_and_limit_rows(self, rows, context, limit, is_2d=False):
        """Trie et limite les lignes selon les paramètres du contexte
        
        Args:
            rows: Liste de dict avec clé 'row' (et 'value' pour 1D ou 'values' pour 2D)
            context: Contexte contenant pivot_sort_by et pivot_sort_order
            limit: Nombre max de lignes à retourner (None = pas de limite)
            is_2d: True pour pivot 2D (avec 'values'), False pour 1D (avec 'value')
        
        Returns:
            Liste triée et limitée
        """
        sort_by = context.get('pivot_sort_by', 'row')
        sort_order = context.get('pivot_sort_order', 'asc')
        reverse = (sort_order == 'desc')
        
        if sort_by == 'total':
            # Trier par le total
            if is_2d:
                rows.sort(key=lambda r: sum(r['values']), reverse=reverse)
            else:
                rows.sort(key=lambda r: r['value'], reverse=reverse)
        else:
            # Trier par le libellé de la ligne
            rows.sort(key=lambda r: self._sort_key_smart(r['row']), reverse=reverse)
        
        # Appliquer la limite après le tri
        if limit and limit > 0:
            rows = rows[:limit]
        
        return rows

    def _get_pivot_data(self, model, filter_obj, domain, context, line=None):
        """Génère les données pour un tableau croisé; support 1D (lignes) et 2D (lignes x colonnes).
        Utilise les informations du contexte du filtre pour respecter les paramètres de la vue pivot standard."""
        
        # Récupérer show_data_title
        show_data_title = context.get('show_data_title', True)
        
        # Déterminer la limite
        limit = None  # Pas de limite par défaut pour les pivots
        if line and hasattr(line, 'limit') and line.limit > 0:
            limit = line.limit
        
        # Récupérer les groupements et mesures depuis le contexte (priorité au contexte du filtre)
        row_gb = context.get('pivot_row_groupby') or context.get('graph_groupbys') or context.get('group_by')
        if isinstance(row_gb, list):
            row_gb = row_gb[0] if row_gb else None
        
        # Vérifier les deux noms possibles (pivot_column_groupby du filtre et pivot_col_groupby de la ligne)
        col_gb = context.get('pivot_column_groupby') or context.get('pivot_col_groupby')
        if isinstance(col_gb, list):
            col_gb = col_gb[0] if col_gb else None
        
        # Pour la mesure, utiliser graph_measure du contexte si pivot_measures n'est pas défini
        measures = context.get('pivot_measures') or context.get('graph_measure') or context.get('measure')
        if isinstance(measures, list):
            measure = measures[0] if measures else None
        else:
            measure = measures

        use_count = not measure or str(measure) in ('count', '__count')
        fields = [] if use_count else [f"{measure}:sum"]
        
        # Récupérer le libellé de la mesure
        measure_label = "Nombre"
        if measure and measure not in ('count', '__count'):
            try:
                field_info = model.fields_get([measure])
                measure_label = field_info.get(measure, {}).get('string', measure)
            except Exception:
                measure_label = measure
        
        # Récupérer les libellés des groupements
        row_label = "Lignes"
        col_label = "Colonnes"
        if row_gb:
            try:
                row_field = row_gb.split(':')[0]
                field_info = model.fields_get([row_field])
                row_label = field_info.get(row_field, {}).get('string', row_field)
            except Exception:
                row_label = row_gb
        if col_gb:
            try:
                col_field = col_gb.split(':')[0]
                field_info = model.fields_get([col_field])
                col_label = field_info.get(col_field, {}).get('string', col_field)
            except Exception:
                col_label = col_gb

        if row_gb and col_gb:
            # 2D pivot
            # Ne pas appliquer la limite au read_group, on triera et limitera après
            try:
                results = model.read_group(domain, fields=fields or ["__count"], groupby=[row_gb, col_gb], lazy=False)
            except Exception:
                results = []
            
            # Récupérer les mappings pour les champs Selection
            row_selection_map = self._get_selection_map(model, row_gb.split(':')[0])
            col_selection_map = self._get_selection_map(model, col_gb.split(':')[0])
            
            # Construire la structure des colonnes et des lignes
            col_labels = []
            col_index = {}
            rows_map = {}
            
            for r in results:
                rlab = self._extract_label_from_record(r, row_gb, row_selection_map)
                clab = self._extract_label_from_record(r, col_gb, col_selection_map)
                
                if clab not in col_index:
                    col_index[clab] = len(col_labels)
                    col_labels.append(clab)
                
                if rlab not in rows_map:
                    rows_map[rlab] = []
                
                # Assurer la taille de la liste des lignes
                while len(rows_map[rlab]) < len(col_labels):
                    rows_map[rlab].append(0)
                
                val = (r.get('__count') if use_count else (r.get(f"{measure}_sum") or r.get(measure) or 0)) or 0
                rows_map[rlab][col_index[clab]] = val
            
            # Assurer que toutes les lignes ont la largeur complète
            for rlab, vals in rows_map.items():
                if len(vals) < len(col_labels):
                    vals.extend([0] * (len(col_labels) - len(vals)))
            
            # Construire la liste des lignes
            rows = [{'row': rlab, 'values': vals} for rlab, vals in rows_map.items()]
            
            # Trier et limiter
            rows = self._sort_and_limit_rows(rows, context, limit, is_2d=True)
            
            # Calculer les totaux si demandé
            show_row_totals = context.get('pivot_show_row_totals', True)
            show_col_totals = context.get('pivot_show_col_totals', True)
            
            col_totals = None
            if show_col_totals and rows:
                # Calculer le total de chaque colonne
                col_totals = [0] * len(col_labels)
                for row in rows:
                    for i, val in enumerate(row['values']):
                        col_totals[i] += val
            
            # Ajouter le total de ligne à chaque ligne si demandé
            if show_row_totals:
                for row in rows:
                    row['row_total'] = sum(row['values'])
            
            # sort columns by label for stability
            columns = [{'key': i, 'label': lbl} for i, lbl in enumerate(col_labels)]
            
            result = {
                'type': 'pivot',
                'data': {
                    'columns': columns,
                    'rows': rows,
                    'measure_label': measure_label,
                    'row_label': row_label,
                    'col_label': col_label,
                },
                'show_data_title': show_data_title,
            }
            
            # Ajouter les totaux au résultat
            if show_col_totals and col_totals is not None:
                result['data']['col_totals'] = col_totals
                if show_row_totals:
                    # Ajouter aussi le grand total (total des totaux)
                    result['data']['grand_total'] = sum(col_totals)
            
            return result

        # 1D pivot (lignes uniquement)
        data_rows = []
        if row_gb:
            # Récupérer le mapping pour les champs Selection
            row_selection_map = self._get_selection_map(model, row_gb.split(':')[0])
            
            # Ne pas appliquer la limite au read_group, on triera et limitera après
            try:
                results = model.read_group(domain, fields=fields or ["__count"], groupby=[row_gb], lazy=False)
                for r in results:
                    label = self._extract_label_from_record(r, row_gb, row_selection_map)
                    value = (r.get('__count') if use_count else (r.get(f"{measure}_sum") or r.get(measure))) or 0
                    data_rows.append({'row': label, 'value': value})
            except Exception:
                pass

        if not data_rows:
            # Retourner un total cohérent (sum de measure si défini, sinon count)
            total_value = None
            if not use_count:
                try:
                    res = model.read_group(domain, fields=[f"{measure}:sum"], groupby=[], lazy=False)
                    if res and isinstance(res, list):
                        total_value = res[0].get(f"{measure}_sum") or 0
                except Exception:
                    total_value = None
            if total_value is None:
                total_value = model.search_count(domain)
            data_rows = [{'row': 'Total', 'value': total_value}]
        else:
            # Trier et limiter (sauf si c'est juste le total)
            data_rows = self._sort_and_limit_rows(data_rows, context, limit, is_2d=False)
        
        # Calculer le total général pour les pivots 1D si demandé
        show_col_totals = context.get('pivot_show_col_totals', True)
        result = {
            'type': 'pivot',
            'data': data_rows,
            'measure_label': measure_label,
            'row_label': row_label,
            'show_data_title': show_data_title,
        }
        
        # Ajouter le total si demandé et si ce n'est pas déjà un total unique
        if show_col_totals and data_rows and not (len(data_rows) == 1 and data_rows[0]['row'] == 'Total'):
            total_value = sum(row['value'] for row in data_rows)
            result['total'] = total_value
        
        return result

    def _get_fields_from_view(self, model, view_type, view_id=None):
        """Récupère les champs et leurs libellés depuis la vue list/tree.
        Essaie d'abord 'list', puis 'tree' si nécessaire. Supporte un view_id explicite.
        """
        try:
            vt_primary = 'list' if view_type in ('tree', 'list') else view_type
            vt_fallback = 'tree' if vt_primary == 'list' else 'list'

            def _extract(view_res):
                arch = view_res.get('arch', '')
                fields_def = view_res.get('fields', {})
                names = []
                if arch:
                    root = etree.fromstring(arch.encode('utf-8')) if isinstance(arch, str) else etree.fromstring(arch)
                    for node in root.xpath('//list/field | //tree/field'):
                        name = node.get('name')
                        if name and name not in names:
                            # Ne pas filtrer les champs invisibles - on veut toutes les colonnes
                            # if node.get('invisible') in ('1', 'True', 'true'):
                            #     continue
                            names.append(name)
                return names, fields_def
            
            # Vérifier si le modèle a la méthode fields_view_get
            if hasattr(model, 'fields_view_get'):
                view = model.fields_view_get(view_id=view_id, view_type=vt_primary)
                field_names, fields_def = _extract(view)

                if not field_names:
                    view2 = model.fields_view_get(view_type=vt_fallback)
                    field_names, fields_def = _extract(view2)

                if len(field_names) <= 1:
                    View = request.env['ir.ui.view'].sudo()
                    candidates = View.search([
                        ('model', '=', model._name),
                        ('type', 'in', ['list', 'tree'])
                    ], order='priority, id')
                    for v in candidates:
                        try:
                            vt = v.type or 'list'
                            vres = model.fields_view_get(view_id=v.id, view_type=vt)
                            fn, fd = _extract(vres)
                            if len(fn) > 1:
                                field_names, fields_def = fn, fd
                                break
                        except Exception:
                            continue
            else:
                field_names = []
                fields_def = {}

            if not field_names:
                # Récupérer tous les champs du modèle (sauf relations complexes et binaires)
                field_names = []
                for fname, fdef in model._fields.items():
                    t = getattr(fdef, 'type', '')
                    # Exclure les champs techniques et complexes
                    if fname.startswith('_'):
                        continue
                    if t in ('one2many', 'many2many', 'binary'):
                        continue
                    # Inclure les champs standards
                    field_names.append(fname)
                
                # Limiter à 15 champs pour ne pas surcharger l'affichage
                if len(field_names) > 15:
                    # Préférer certains champs communs
                    preference = [
                        'name', 'display_name', 'date', 'invoice_date', 'partner_id', 'amount_total', 
                        'amount_untaxed', 'amount_tax', 'user_id', 'company_id', 'state', 'ref',
                        'create_date', 'write_date'
                    ]
                    preferred = [f for f in preference if f in field_names]
                    others = [f for f in field_names if f not in preference]
                    field_names = preferred + others[:15-len(preferred)]
                
                # Récupérer les définitions des champs
                fields_def = model.fields_get(field_names)

            # Ne pas limiter le nombre de champs pour afficher toutes les colonnes de la vue
            labels = {fn: fields_def.get(fn, {}).get('string', fn) for fn in field_names}
            return field_names, labels
        except Exception:
            return ['display_name'], {'display_name': 'Nom à afficher'}
