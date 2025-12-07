/** @odoo-module **/

import { onMounted, onWillStart } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { FormController } from "@web/views/form/form_controller";
import { useService } from "@web/core/utils/hooks";
import { patch } from "@web/core/utils/patch";
import { SearchModel } from "@web/search/search_model";

// Fonction utilitaire pour formater les nombres
function formatNumber(value) {
    if (value === null || value === undefined) return '0';
    const num = parseFloat(value);
    if (isNaN(num)) return value;
    if (Number.isInteger(num)) {
        return num.toLocaleString('fr-FR');
    }
    return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Classe DashboardFormController supprimée - toutes les méthodes sont maintenant dans le patch ci-dessous

// Utiliser patch pour étendre le FormController de manière compatible Odoo 16
patch(FormController.prototype, "is_tableau_de_bord16.FormController", {
    setup() {
        this._super();
        this.rpc = useService("rpc");
        this.actionService = useService("action");
        
        onMounted(() => {
            if (this._isDashboardMode()) {
                this._setupDashboard();
            }
        });
    },

    _isDashboardMode() {
        // Vérification du contexte
        const contextMode = this.props.context?.dashboard_mode;
        
        // Vérification de l'arch (XML de la vue)
        let archMode = false;
        try {
            if (this.props.arch) {
                const arch = this.props.arch;
                if (typeof arch.getAttribute === 'function') {
                    const className = arch.getAttribute('class');
                    if (className) {
                        archMode = className.includes('o_dashboard_form');
                    }
                }
                else if (arch.attrs && arch.attrs.class) {
                    archMode = arch.attrs.class.includes('o_dashboard_form');
                }
            }
        } catch(e) {
            // Ignorer les erreurs
        }
        
        return contextMode || archMode;
    },

    async _setupDashboard() {
        // Vérifier si l'utilisateur est gestionnaire
        await this._checkUserPermissions();
        
        // Créer les inputs de filtres
        this._createFilterInputs();
        
        // Charger le filtre mémorisé pour cet utilisateur
        await this._loadSavedFilter();
        
        // Attendre que le formulaire soit complètement chargé
        setTimeout(() => {
            this._createDashboardLayout();
            this._loadDashboardItems();
        }, 1500);
    },

    _createFilterInputs() {
        const record = this.model.root;
        const filterDefs = record?.data?.filter_def_ids?.records || [];
        
        const container = document.getElementById('dashboard_filters_container');
        if (!container || filterDefs.length === 0) {
            return;
        }

        let html = '';
        
        for (const filterDefRecord of filterDefs) {
            const filterDef = filterDefRecord.data;
            const filterId = filterDefRecord.resId || filterDef.id;
            const filterName = filterDef.name || 'Filtre';
            const filterType = filterDef.filter_type || 'text';
            
            const inputType = filterType === 'date' ? 'text' : 'text';
            let placeholder = '';
            let helpContent = '';
            
            if (filterType === 'date') {
                placeholder = 'AAAA, >2025, 2024-01 OU 2024-03...';
                helpContent = `
                    <div style="text-align: left; line-height: 1.6;">
                        <strong style="color: #0066cc; font-size: 1.1em;">📅 FILTRES DE DATE</strong>
                        <hr style="margin: 8px 0;">
                        
                        <strong>🔹 Formats de base :</strong><br>
                        &nbsp;&nbsp;• <code>AAAA</code> : Année complète (ex: 2025)<br>
                        &nbsp;&nbsp;• <code>AAAA-MM</code> : Mois (ex: 2025-03)<br>
                        &nbsp;&nbsp;• <code>AAAA-SXX</code> : Semaine (ex: 2025-S15)<br>
                        &nbsp;&nbsp;• <code>JJ/MM/AAAA</code> : Date exacte (ex: 07/12/2025)<br>
                        &nbsp;&nbsp;• <code>AAAA-MM-JJ</code> : Date ISO (ex: 2025-12-07)<br><br>
                        
                        <strong>🔹 Opérateurs de comparaison :</strong><br>
                        &nbsp;&nbsp;• <code>&gt;2025</code> : Après 2025<br>
                        &nbsp;&nbsp;• <code>&gt;=2025-03</code> : À partir de Mars 2025<br>
                        &nbsp;&nbsp;• <code>&lt;2025</code> : Avant 2025<br>
                        &nbsp;&nbsp;• <code>&lt;=2025-06</code> : Jusqu'à Juin 2025<br><br>
                        
                        <strong>🔹 Opérateurs logiques :</strong><br>
                        &nbsp;&nbsp;• <code>2024-01, 2024-03</code> : Janvier <strong>OU</strong> Mars 2024<br>
                        &nbsp;&nbsp;• <code>2024-01 OU 2024-03</code> : Même résultat<br>
                        &nbsp;&nbsp;• <code>&gt;2024-01 ET &lt;2024-06</code> : Entre Fév et Mai 2024
                    </div>
                `;
            } else {
                placeholder = 'abc, abc*, >100, toto ET tutu...';
                helpContent = `
                    <div style="text-align: left; line-height: 1.6;">
                        <strong style="color: #0066cc; font-size: 1.1em;">🔍 FILTRES DE TEXTE</strong>
                        <hr style="margin: 8px 0;">
                        
                        <strong>🔹 Wildcards (*) :</strong><br>
                        &nbsp;&nbsp;• <code>abc</code> : Contient "abc"<br>
                        &nbsp;&nbsp;• <code>abc*</code> : Commence par "abc"<br>
                        &nbsp;&nbsp;• <code>*abc</code> : Se termine par "abc"<br>
                        &nbsp;&nbsp;• <code>abc*xyz</code> : Commence par "abc" et finit par "xyz"<br><br>
                        
                        <strong>🔹 Opérateurs logiques :</strong><br>
                        &nbsp;&nbsp;• <code>toto, tutu</code> : Contient "toto" <strong>OU</strong> "tutu"<br>
                        &nbsp;&nbsp;• <code>toto OU tutu</code> : Même résultat<br>
                        &nbsp;&nbsp;• <code>toto ET tutu</code> : Contient "toto" <strong>ET</strong> "tutu"<br><br>
                        
                        <strong>🔹 Champs numériques :</strong><br>
                        &nbsp;&nbsp;• <code>100</code> : Égal à 100<br>
                        &nbsp;&nbsp;• <code>&gt;100</code>, <code>&gt;=100</code>, <code>&lt;100</code>, <code>&lt;=100</code><br>
                        &nbsp;&nbsp;• <code>&gt;100 ET &lt;200</code> : Entre 100 et 200<br>
                        &nbsp;&nbsp;• <code>10, 20, 30</code> : Égal à 10 <strong>OU</strong> 20 <strong>OU</strong> 30<br><br>
                        
                        <strong>🔹 Champs booléens :</strong><br>
                        &nbsp;&nbsp;• <code>1, true, vrai, yes, oui</code> : VRAI<br>
                        &nbsp;&nbsp;• <code>0, false, faux, no, non</code> : FAUX
                    </div>
                `;
            }
            
            html += `
                <div class="col-md-3">
                    <label class="form-label">
                        ${filterName}
                        <i class="fa fa-info-circle text-primary filter-help-icon" 
                           data-filter-id="${filterId}"
                           data-help-content="${helpContent.replace(/"/g, '&quot;')}"
                           title="Cliquez pour voir l'aide détaillée"
                           style="cursor: pointer; font-size: 0.9em;"></i>
                    </label>
                    <input type="${inputType}" 
                           class="form-control dashboard-filter-input" 
                           id="dashboard_filter_${filterId}"
                           data-filter-id="${filterId}"
                           data-filter-type="${filterType}"
                           placeholder="${placeholder}">
                </div>
            `;
        }
        
        html += `
            <div class="col-md-3 d-flex align-items-end">
                <button class="btn btn-primary w-100" id="apply_filters_btn">
                    <i class="fa fa-search"></i> Appliquer les filtres
                </button>
            </div>
        `;
        
        container.innerHTML = html;
        
        // Attacher les événements
        setTimeout(() => {
            // Gérer les clics sur les icônes d'aide
            document.querySelectorAll('.filter-help-icon').forEach(icon => {
                icon.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._showFilterHelp(icon);
                });
            });
            
            // Event sur les inputs (touche Enter)
            document.querySelectorAll('.dashboard-filter-input').forEach(input => {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        this._applyFilters();
                    }
                });
            });
            
            // Event sur le bouton
            const applyBtn = document.getElementById('apply_filters_btn');
            if (applyBtn) {
                applyBtn.addEventListener('click', () => {
                    this._applyFilters();
                });
            }
        }, 100);
    },

    _showFilterHelp(icon) {
        // Supprimer toute popup existante
        const existingPopup = document.querySelector('.filter-help-popup');
        if (existingPopup) {
            existingPopup.remove();
        }
        
        const helpContent = icon.dataset.helpContent;
        
        // Créer la popup
        const popup = document.createElement('div');
        popup.className = 'filter-help-popup';
        popup.innerHTML = `
            <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: flex; align-items: center; justify-content: center;" class="filter-help-backdrop">
                <div style="background: white; padding: 20px; border-radius: 8px; max-width: 600px; max-height: 80vh; overflow-y: auto; box-shadow: 0 4px 20px rgba(0,0,0,0.3); position: relative;">
                    <button style="position: absolute; top: 10px; right: 10px; border: none; background: none; font-size: 24px; cursor: pointer; color: #666;" class="filter-help-close">&times;</button>
                    ${helpContent}
                </div>
            </div>
        `;
        
        document.body.appendChild(popup);
        
        // Fermer au clic sur le backdrop ou le bouton X
        popup.querySelector('.filter-help-backdrop').addEventListener('click', (e) => {
            if (e.target.classList.contains('filter-help-backdrop') || e.target.classList.contains('filter-help-close')) {
                popup.remove();
            }
        });
        
        // Fermer avec Escape
        const escapeHandler = (e) => {
            if (e.key === 'Escape') {
                popup.remove();
                document.removeEventListener('keydown', escapeHandler);
            }
        };
        document.addEventListener('keydown', escapeHandler);
    },

    _applyFilters() {
        // Collecter toutes les valeurs de filtres (y compris les vides pour les supprimer)
        const filtersDict = {};
        document.querySelectorAll('.dashboard-filter-input').forEach(input => {
            const filterId = input.dataset.filterId;
            const value = input.value.trim();
            // Toujours ajouter au dictionnaire, même si vide (pour supprimer en base)
            filtersDict[filterId] = value;
        });
        
        // Sauvegarder les filtres
        this._saveFilter(filtersDict);
        
        // Recharger les données
        this._loadDashboardItems();
    },

    async _loadSavedFilter() {
        const dashboardId = this.model?.root?.resId;
        if (!dashboardId) return;
        
        try {
            const result = await this.rpc("/tableau_de_bord/get_saved_filter/" + dashboardId);
            if (result && result.filters) {
                // Peupler les inputs avec les valeurs sauvegardées
                for (const [filterId, value] of Object.entries(result.filters)) {
                    const input = document.getElementById(`dashboard_filter_${filterId}`);
                    if (input) {
                        input.value = value;
                    }
                }
            }
        } catch (error) {
            // Ignorer les erreurs silencieusement
        }
    },

    async _saveFilter(filtersDict) {
        const dashboardId = this.model?.root?.resId;
        if (!dashboardId) return;
        
        try {
            await this.rpc("/tableau_de_bord/save_filter", {
                dashboard_id: dashboardId,
                filters_dict: filtersDict
            });
        } catch (error) {
            // Ignorer les erreurs silencieusement
        }
    },

    async _checkUserPermissions() {
        try {
            const result = await this.rpc("/web/dataset/call_kw/is.tableau.de.bord/check_is_manager", {
                model: 'is.tableau.de.bord',
                method: 'check_is_manager',
                args: [],
                kwargs: {},
            });
            this.isManager = result;
        } catch (error) {
            this.isManager = false;
        }
    },

    _createDashboardLayout() {
        const record = this.model.root;
        if (!record?.data?.line_ids?.records) {
            return;
        }

        const container = document.getElementById('dashboard_container');
        if (!container) {
            return;
        }

        let html = '<div class="row">';
        
        for (const lineRecord of record.data.line_ids.records) {
            const line = lineRecord.data;
            let filterId = null;
            if (Array.isArray(line.filter_id)) {
                filterId = line.filter_id[0];
            } else if (line.filter_id && typeof line.filter_id === 'object') {
                filterId = line.filter_id.id || line.filter_id.resId || null;
            } else if (typeof line.filter_id === 'number') {
                filterId = line.filter_id;
            }
            
            const serverLineId = lineRecord.resId || line.id || (line._values && line._values.id) || lineRecord.id;
            
            const widthCol = parseInt(line.width || 6, 10);
            const heightPx = parseInt(line.height || 400, 10);
            
            let editButtons = '';
            if (this.isManager) {
                editButtons = `
                    <a href="#" class="btn btn-sm btn-outline-info edit-line-link" data-line-id="${serverLineId}" title="Modifier la ligne du tableau de bord">
                        <i class="fa fa-pencil"></i>
                    </a>
                    <a href="#" class="btn btn-sm btn-outline-secondary edit-filter-link" data-line-id="${serverLineId}" title="Modifier le filtre">
                        <i class="fa fa-search"></i>
                    </a>
                `;
            }

            html += `
                <div class="col-md-${isNaN(widthCol) ? 6 : widthCol} mb-3">
                    <div class="card h-100">
                        <div class="card-header d-flex justify-content-between align-items-start">
                            <div style="min-width: 0; flex: 1;">
                                <h5 class="card-title mb-0" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${line.name || 'Sans nom'}">${line.name || 'Sans nom'}</h5>
                            </div>
                            <div class="d-flex gap-2">
                                <a href="#" class="btn btn-sm btn-outline-primary open-filter-link" data-line-id="${serverLineId}" title="Ouvrir la recherche complète en plein écran">
                                    <i class="fa fa-expand"></i>
                                </a>
                                ${editButtons}
                            </div>
                        </div>
                        <div class="card-body p-0" style="height: ${isNaN(heightPx) ? 400 : heightPx}px; overflow: auto;">
                            <div id="dashboard_item_${lineRecord.id}" class="dashboard-item h-100 d-flex align-items-center justify-content-center">
                                <div class="spinner-border text-primary" role="status">
                                    <span class="visually-hidden">Chargement...</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        container.innerHTML = html;
        
        setTimeout(() => {
            this._attachOpenFilterLinks();
            if (this.isManager) {
                this._attachEditLineLinks();
                this._attachEditFilterLinks();
            }
        }, 100);
    },

    _attachOpenFilterLinks() {
        const links = document.querySelectorAll('.open-filter-link');
        links.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineId = parseInt(link.dataset.lineId);
                if (lineId) {
                    await this._openFilterFullScreen(lineId);
                }
            });
        });
    },

    _attachEditFilterLinks() {
        const links = document.querySelectorAll('.edit-filter-link');
        links.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineId = parseInt(link.dataset.lineId);
                if (lineId) {
                    await this._editFilter(lineId);
                }
            });
        });
    },

    _attachEditLineLinks() {
        const links = document.querySelectorAll('.edit-line-link');
        links.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineId = parseInt(link.dataset.lineId);
                if (lineId) {
                    await this._editLine(lineId);
                }
            });
        });
    },

    async _openFilterFullScreen(lineId) {
        try {
            const result = await this.rpc("/web/dataset/call_kw/is.tableau.de.bord.line/action_open_filter", {
                model: 'is.tableau.de.bord.line',
                method: 'action_open_filter',
                args: [[lineId]],
                kwargs: {}
            });
            if (result && result.type) {
                await this.actionService.doAction(result);
            }
        } catch (error) {
            console.error("[TDB] Erreur lors de l'ouverture du filtre:", error);
        }
    },

    async _editFilter(lineId) {
        try {
            const result = await this.rpc("/web/dataset/call_kw/is.tableau.de.bord.line/action_edit_filter", {
                model: 'is.tableau.de.bord.line',
                method: 'action_edit_filter',
                args: [[lineId]],
                kwargs: {}
            });
            if (result && result.type) {
                await this.actionService.doAction(result);
            }
        } catch (error) {
            console.error("[TDB] Erreur lors de l'édition du filtre:", error);
        }
    },

    async _editLine(lineId) {
        try {
            await this.actionService.doAction({
                type: 'ir.actions.act_window',
                name: 'Modifier la ligne du tableau de bord',
                res_model: 'is.tableau.de.bord.line',
                res_id: lineId,
                views: [[false, 'form']],
                view_mode: 'form',
                target: 'current',
                context: {
                    'form_view_ref': 'is_tableau_de_bord16.view_is_tableau_de_bord_line_edit_form'
                }
            });
        } catch (error) {
            console.error("[TDB] Erreur lors de l'édition de la ligne:", error);
        }
    },

    async _loadDashboardItems() {
        const record = this.model.root;
        if (!record?.data?.line_ids?.records) return;

        for (const lineRecord of record.data.line_ids.records) {
            const line = lineRecord.data;
            let filterId = null;
            if (Array.isArray(line.filter_id)) {
                filterId = line.filter_id[0];
            } else if (line.filter_id && typeof line.filter_id === 'object') {
                filterId = line.filter_id.id || line.filter_id.resId || null;
            } else if (typeof line.filter_id === 'number') {
                filterId = line.filter_id;
            }
            if (filterId) {
                const serverLineId = lineRecord.resId || line.id || (line._values && line._values.id) || lineRecord.id;
                // Gérer les booléens correctement (peuvent être undefined, null, ou booléen)
                const graphShowLegend = line.graph_show_legend === false ? false : (line.graph_show_legend === true ? true : true);
                const showDataTitle = line.show_data_title === false ? false : (line.show_data_title === true ? true : true);
                const showRecordCount = line.show_record_count === false ? false : (line.show_record_count === true ? true : true);
                
                const overrides = {
                    display_mode: line.display_mode,
                    graph_chart_type: line.graph_chart_type,
                    graph_aggregator: line.graph_aggregator,
                    graph_show_legend: graphShowLegend,
                    show_data_title: showDataTitle,
                    show_record_count: showRecordCount,
                    graph_measure: line.graph_measure,
                    graph_groupbys: line.graph_groupbys,
                    pivot_row_groupby: line.pivot_row_groupby,
                    pivot_column_groupby: line.pivot_col_groupby,
                    pivot_measures: line.pivot_measure,
                    pivot_sort_by: line.pivot_sort_by,
                    pivot_sort_order: line.pivot_sort_order,
                    list_groupby: line.list_groupby,
                };
                await this._loadFilterData(lineRecord.id, filterId, serverLineId, overrides);
            } else {
                this._renderError(lineRecord.id, "Aucun filtre sélectionné");
            }
        }
    },

    async _loadFilterData(lineId, filterId, backendLineId, overrides) {
        try {
            const lid = backendLineId || lineId;
            const dashboardId = this.model?.root?.resId;
            
            // Collecter toutes les valeurs de filtres
            const filtersValues = {};
            document.querySelectorAll('.dashboard-filter-input').forEach(input => {
                const filterDefId = input.dataset.filterId;
                const value = input.value.trim();
                if (value) {
                    filtersValues[filterDefId] = value;
                }
            });
            
            const data = await this.rpc("/tableau_de_bord/get_filter_data/" + filterId, { 
                line_id: lid, 
                overrides, 
                dashboard_id: dashboardId,
                filters_values: filtersValues
            });
            this._renderFilterData(lineId, data);
        } catch (error) {
            this._renderError(lineId, "Erreur lors du chargement des données: " + error.message);
        }
    },

    _renderFilterData(lineId, data) {
        const container = document.getElementById(`dashboard_item_${lineId}`);
        if (!container) return;

        if (data.error) {
            this._renderError(lineId, data.error);
            return;
        }

        switch (data.type) {
            case 'list':
                this._renderListData(container, data);
                break;
            case 'graph':
                this._renderGraphData(container, data);
                break;
            case 'pivot':
                this._renderPivotData(container, data);
                break;
            default:
                this._renderError(lineId, "Type de données non supporté: " + data.type);
        }
    },

    _renderListData(container, data) {
        if (!data.data || data.data.length === 0) {
            container.innerHTML = '<div class="alert alert-info m-2">Aucune donnée à afficher</div>';
            return;
        }
        
        const validFields = (data.fields || []).filter(f => f !== null && f !== undefined);
        if (validFields.length === 0) {
            container.innerHTML = '<div class="alert alert-warning m-2">Aucun champ à afficher</div>';
            return;
        }
        
        const isGrouped = data.is_grouped === true;
        let html = '<div class="table-responsive h-100"><table class="table table-sm mb-0">';
        html += '<thead class="table-light"><tr>';
        for (const f of validFields) {
            const label = typeof f === 'string' ? f : (f?.string || f?.name || 'Sans nom');
            const fieldType = f?.type || 'char';
            const isNumeric = ['integer', 'float', 'monetary'].includes(fieldType);
            const isAggregate = f?.is_aggregate === true;
            const alignClass = isNumeric ? 'text-end' : '';
            const headerStyle = isAggregate ? 'background-color: #e3f2fd;' : '';
            html += `<th class="${alignClass}" style="white-space: nowrap; font-size: 0.875rem; overflow: hidden; text-overflow: ellipsis; max-width: 200px; padding: 0.25rem 0.5rem; ${headerStyle}" title="${label}">${label}</th>`;
        }
        html += '</tr></thead><tbody>';
        
        for (const row of data.data) {
            const isGroupHeader = row._is_group_header === true;
            const groupLevel = row._group_level || 1;
            let rowClass = '';
            let rowStyle = '';
            if (isGroupHeader) {
                rowClass = 'table-primary';
                rowStyle = 'font-weight: 600;';
            } else if (groupLevel === 2) {
                rowStyle = 'background-color: #fafbfc;';
            }
            
            html += `<tr class="${rowClass}" style="${rowStyle}">`;
            for (const f of validFields) {
                const name = typeof f === 'string' ? f : (f?.name || '');
                const fieldType = f?.type || 'char';
                const digits = f?.digits;
                const isAggregate = f?.is_aggregate === true;
                let val = row[name];
                let displayVal = '';
                let alignClass = '';
                let cellStyle = '';
                
                if (isAggregate && !isGroupHeader) {
                    cellStyle = 'background-color: #f5faff;';
                }
                
                if (fieldType === 'integer' && val !== null && val !== undefined && val !== false && val !== '') {
                    alignClass = 'text-end';
                    displayVal = parseInt(val).toLocaleString('fr-FR');
                } else if ((fieldType === 'float' || fieldType === 'monetary') && val !== null && val !== undefined && val !== false && val !== '') {
                    alignClass = 'text-end';
                    const numDigits = digits !== undefined ? digits : 2;
                    displayVal = parseFloat(val).toLocaleString('fr-FR', {
                        minimumFractionDigits: numDigits,
                        maximumFractionDigits: numDigits
                    });
                } else if (Array.isArray(val)) {
                    displayVal = val.length > 1 ? val[1] : val[0];
                } else if (val && typeof val === 'object') {
                    displayVal = val.display_name || val.name || JSON.stringify(val);
                } else if (val !== null && val !== undefined && val !== false) {
                    displayVal = val;
                }
                
                html += `<td class="${alignClass}" style="${cellStyle}">${displayVal}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody></table></div>';
        
        if (data.show_record_count !== false && data.count !== undefined) {
            const countLabel = isGrouped ? 'Total enregistrements' : 'Total';
            html += `<div class="text-muted small p-2 border-top">${countLabel}: ${data.count} enregistrement(s)</div>`;
        }
        
        container.innerHTML = html;
        container.className = "dashboard-item h-100 d-flex flex-column";
    },

    _renderGraphData(container, data) {
        const chartId = `chart_${Math.random().toString(36).slice(2)}`;
        const isPieChart = (data.chart_type || 'bar') === 'pie';
        const paddingClass = isPieChart ? 'p-1' : 'p-2';
        const titleMargin = isPieChart ? 'mb-0' : 'mb-1';
        const graphTitle = data.data?.datasets?.[0]?.label || 'Graphique';
        const showDataTitle = data.show_data_title !== undefined ? data.show_data_title : true;
        
        let titleHtml = '';
        if (showDataTitle) {
            titleHtml = `<div class="${titleMargin}">
                <h6 class="mb-0 small" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${graphTitle}">${graphTitle}</h6>
            </div>`;
        }
        
        let html = `<div class="${paddingClass} h-100 d-flex flex-column">
            ${titleHtml}
            <div class="flex-grow-1 position-relative" style="min-height: 0;">
                <canvas id="${chartId}" style="max-height: 100%; max-width: 100%;"></canvas>
            </div>
        </div>`;
        container.innerHTML = html;
        container.className = "dashboard-item h-100";

        const dataset = data.data?.datasets?.[0];
        const labels = data.data?.labels || [];
        if (!dataset) {
            container.innerHTML = '<div class="alert alert-info m-2">Aucune donnée graphique disponible</div>';
            return;
        }

        const el = document.getElementById(chartId);
        if (window.Chart && el) {
            const showLegend = data.show_legend !== undefined ? data.show_legend : true;
            const chartType = data.chart_type || 'bar';
            const isPieChart = chartType === 'pie';
            
            const chartOptions = {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: isPieChart ? 2 : 10
                },
                legend: {
                    display: showLegend,
                    position: isPieChart ? 'right' : 'top',
                    labels: {
                        boxWidth: isPieChart ? 10 : 40,
                        padding: isPieChart ? 4 : 10,
                        fontSize: isPieChart ? 9 : 12
                    }
                },
                plugins: {
                    legend: {
                        display: showLegend,
                        position: isPieChart ? 'right' : 'top',
                        labels: {
                            boxWidth: isPieChart ? 10 : 40,
                            padding: isPieChart ? 4 : 10,
                            font: {
                                size: isPieChart ? 9 : 12
                            }
                        }
                    }
                }
            };
            
            if (!isPieChart) {
                chartOptions.scales = {
                    y: { beginAtZero: true }
                };
            }
            
            new window.Chart(el.getContext('2d'), {
                type: chartType,
                data: {
                    labels,
                    datasets: [{
                        label: dataset.label,
                        data: dataset.data,
                        backgroundColor: dataset.backgroundColor || '#1f77b4',
                        borderWidth: 1,
                    }]
                },
                options: chartOptions
            });
        } else {
            let fallback = '<div class="text-center p-4 h-100 d-flex flex-column justify-content-center">';
            fallback += `<h5 class="mb-3">${dataset.label}</h5>`;
            fallback += '<div class="row flex-grow-1 align-items-center">';
            for (let i = 0; i < labels.length; i++) {
                const value = dataset.data[i];
                const label = labels[i];
                fallback += `<div class="col text-center">
                    <div class="display-4 text-primary mb-2">${value}</div>
                    <div class="small text-muted">${label}</div>
                </div>`;
            }
            fallback += '</div></div>';
            container.innerHTML = fallback;
        }
    },

    _renderPivotData(container, data) {
        if (data.data && data.data.columns && data.data.rows) {
            const cols = data.data.columns;
            const rows = data.data.rows;
            const measureLabel = data.data.measure_label || 'Total';
            const rowLabel = data.data.row_label || 'Lignes';
            const colLabel = data.data.col_label || 'Colonnes';
            const colTotals = data.data.col_totals || null;
            const grandTotal = data.data.grand_total || null;
            const showRowTotals = rows.length > 0 && rows[0].hasOwnProperty('row_total');
            const showColTotals = colTotals !== null;
            const showDataTitle = data.show_data_title !== undefined ? data.show_data_title : true;
            
            let html = '<div class="h-100 d-flex flex-column">';
            if (showDataTitle) {
                html += '<div class="px-2 pt-2"><small class="text-muted">Mesure: <strong>' + measureLabel + '</strong></small></div>';
            }
            html += '<div class="table-responsive flex-grow-1 px-2"><table class="table table-sm table-hover mb-0" style="font-size: 0.9rem;">';
            html += '<thead class="table-light"><tr>';
            html += '<th class="border-end" style="background-color: #f8f9fa;">' + rowLabel + '</th>';
            for (const c of cols) html += '<th class="text-end">' + c.label + '</th>';
            if (showRowTotals) {
                html += '<th class="text-end border-start fw-bold" style="background-color: #e9ecef;">Total</th>';
            }
            html += '</tr></thead><tbody>';
            
            for (const r of rows) {
                html += '<tr><td class="border-end fw-bold" style="background-color: #fafbfc;">' + r.row + '</td>';
                for (const v of (r.values || [])) {
                    const formattedValue = formatNumber(v);
                    html += '<td class="text-end">' + formattedValue + '</td>';
                }
                if (showRowTotals) {
                    const total = r.row_total !== undefined ? r.row_total : (r.values || []).reduce((a, b) => a + (b || 0), 0);
                    const formattedTotal = formatNumber(total);
                    html += '<td class="text-end border-start fw-bold" style="background-color: #f8f9fa;">' + formattedTotal + '</td>';
                }
                html += '</tr>';
            }
            
            if (showColTotals) {
                html += '<tr class="table-secondary border-top border-2"><td class="border-end fw-bold">Total</td>';
                for (const t of colTotals) {
                    const formattedValue = formatNumber(t);
                    html += '<td class="text-end fw-bold">' + formattedValue + '</td>';
                }
                if (showRowTotals && grandTotal !== null) {
                    const formattedGrand = formatNumber(grandTotal);
                    html += '<td class="text-end border-start fw-bold">' + formattedGrand + '</td>';
                } else if (showRowTotals) {
                    const grand = colTotals.reduce((a, b) => a + b, 0);
                    const formattedGrand = formatNumber(grand);
                    html += '<td class="text-end border-start fw-bold">' + formattedGrand + '</td>';
                }
                html += '</tr>';
            }
            html += '</tbody></table></div></div>';
            container.innerHTML = html;
            container.className = "dashboard-item h-100";
            return;
        }

        const measureLabel = data.measure_label || 'Valeur';
        const rowLabel = data.row_label || 'Lignes';
        const showTotal = data.total !== undefined;
        const showDataTitle = data.show_data_title !== undefined ? data.show_data_title : true;
        
        let html = '<div class="h-100 d-flex flex-column">';
        if (showDataTitle) {
            html += '<div class="px-2 pt-2"><small class="text-muted">Mesure: <strong>' + measureLabel + '</strong></small></div>';
        }
        html += '<div class="table-responsive flex-grow-1 px-2"><table class="table table-sm table-hover mb-0" style="font-size: 0.9rem;">';
        html += '<thead class="table-light"><tr><th>' + rowLabel + '</th><th class="text-end">' + measureLabel + '</th></tr></thead>';
        html += '<tbody>';
        
        for (const row of (data.data || [])) {
            const formattedValue = formatNumber(row.value);
            html += '<tr><td>' + row.row + '</td><td class="text-end fw-bold">' + formattedValue + '</td></tr>';
        }
        
        if (showTotal) {
            const formattedTotal = formatNumber(data.total);
            html += '<tr class="table-secondary border-top border-2"><td class="fw-bold">Total</td><td class="text-end fw-bold">' + formattedTotal + '</td></tr>';
        }
        
        html += '</tbody></table></div></div>';
        container.innerHTML = html;
        container.className = "dashboard-item h-100";
    },

    _renderError(lineId, message) {
        const container = document.getElementById(`dashboard_item_${lineId}`);
        if (container) {
            container.innerHTML = `<div class="alert alert-warning m-2 h-100 d-flex align-items-center justify-content-center text-center">${message}</div>`;
            container.className = "dashboard-item h-100";
        }
    }
});

/**
 * Extension de SearchModel pour capturer le menu et la vue courante
 * lors de la création d'un favori
 */
patch(SearchModel.prototype, "is_tableau_de_bord16.SearchModel", {
    /**
     * Override de _getIrFilterDescription pour enrichir irFilter.context avec les métadonnées
     */
    _getIrFilterDescription(params) {
        // Appeler la méthode parente pour obtenir preFavorite et irFilter
        const result = this._super(params);
        
        // Récupérer les informations du menu courant
        let activeMenuId = false;
        try {
            const menuService = this.env.services.menu;
            const currentApp = menuService?.getCurrentApp();
            activeMenuId = currentApp?.id || false;
        } catch (e) {
            // Erreur lors de la récupération du menu courant
        }
        
        // Récupérer les informations de la vue courante
        const config = this.env.config;
        const viewType = config?.viewType || false;
        const views = config?.views || [];
        
        // Trouver l'ID de la vue correspondant au type actuel
        let activeViewId = false;
        
        // Essayer d'abord avec viewId direct (peut exister dans certains cas)
        if (config?.viewId) {
            activeViewId = config.viewId;
        }
        // Sinon chercher dans views
        else if (views && viewType) {
            const currentView = views.find(v => v[1] === viewType);
            if (currentView && currentView[0]) {
                activeViewId = currentView[0];
            }
        }
        
        // Capturer les colonnes visibles pour les vues list/tree
        let visibleColumns = [];
        
        if (viewType === 'list') {
            try {
                // Méthode 1: Lire directement les colonnes visibles depuis le DOM du tableau
                const tableHeaders = document.querySelectorAll('.o_list_view thead th[data-name]');
                
                if (tableHeaders.length > 0) {
                    tableHeaders.forEach(th => {
                        const fieldName = th.getAttribute('data-name');
                        if (fieldName && !visibleColumns.includes(fieldName)) {
                            visibleColumns.push(fieldName);
                        }
                    });
                }
                
                // Méthode 2 (fallback): Utiliser le renderer ou activeFields
                if (visibleColumns.length === 0) {
                    const renderer = this.env?.config?.getDisplayRenderer?.() || this.display?.renderer;
                    
                    if (renderer?.columns) {
                        visibleColumns = renderer.columns
                            .filter(col => col.type === 'field' && !col.optional || col.optional === 'show')
                            .map(col => col.name);
                    }
                    else if (this.env?.config?.activeFields) {
                        visibleColumns = Object.keys(this.env.config.activeFields);
                    }
                }
            } catch (e) {
                // Ignorer les erreurs silencieusement
            }
        }
        
        // Enrichir irFilter.context avec les métadonnées
        result.irFilter.context = {
            ...result.irFilter.context,
            active_menu_id: activeMenuId,
            active_view_id: activeViewId,
            view_type: viewType,
            visible_columns: visibleColumns.length > 0 ? visibleColumns : false,
        };
        
        return result;
    }
});
