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

export class DashboardFormController extends FormController {
    setup() {
        super.setup();
        this.actionService = useService("action");
        this.rpc = useService("rpc");
        
        onMounted(() => {
            // Vérifier si nous sommes en mode dashboard
            if (this.isDashboard()) {
                this.setupDashboard();
            }
        });
    }

    isDashboard() {
        // Vérification du contexte
        const contextMode = this.props.context?.dashboard_mode;
        
        // Vérification de l'arch (XML de la vue)
        let archMode = false;
        try {
            if (this.props.arch) {
                const arch = this.props.arch;
                // Cas 1: Element XML (DOM) - Cas le plus fréquent en Odoo 16+
                if (typeof arch.getAttribute === 'function') {
                    const className = arch.getAttribute('class');
                    if (className) {
                        archMode = className.includes('o_dashboard_form');
                    }
                }
                // Cas 2: Objet JS avec attrs
                else if (arch.attrs && arch.attrs.class) {
                    archMode = arch.attrs.class.includes('o_dashboard_form');
                }
            }
        } catch(e) {
            // Ignorer les erreurs d'accès à l'arch
        }
        
        return contextMode || archMode;
    }

    async setupDashboard() {
        // Vérifier si l'utilisateur est gestionnaire
        await this.checkUserPermissions();
        
        // Attendre que le formulaire soit complètement chargé
        setTimeout(() => {
            this.createDashboardLayout();
            this.loadDashboardItems();
        }, 1500);
    }

    async checkUserPermissions() {
        try {
            // Vérifier si l'utilisateur appartient au groupe manager via notre méthode custom
            const result = await this.rpc("/web/dataset/call_kw/is.tableau.de.bord/check_is_manager", {
                model: 'is.tableau.de.bord',
                method: 'check_is_manager',
                args: [],
                kwargs: {},
            });
            this.isManager = result;
        } catch (error) {
            // En cas d'erreur, considérer l'utilisateur comme non-manager
            this.isManager = false;
        }
    }

    createDashboardLayout() {
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
            // filter_id peut être un many2one sous forme [id, display] ou un objet {resId}
            let filterId = null;
            if (Array.isArray(line.filter_id)) {
                filterId = line.filter_id[0];
            } else if (line.filter_id && typeof line.filter_id === 'object') {
                // Odoo 16 peut exposer m2o comme {id, display_name} ou {resId}
                filterId = line.filter_id.id || line.filter_id.resId || null;
            } else if (typeof line.filter_id === 'number') {
                filterId = line.filter_id;
            }
            
            // Récupérer l'ID serveur de la ligne
            const serverLineId = lineRecord.resId || line.id || (line._values && line._values.id) || lineRecord.id;
            
            const widthCol = parseInt(line.width || 6, 10);
            const heightPx = parseInt(line.height || 400, 10);
            
            // Boutons d'édition uniquement pour les gestionnaires
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
    
    // Ajouter les gestionnaires d'événements
    setTimeout(() => {
        this.attachOpenFilterLinks();
        // Boutons d'édition uniquement pour les gestionnaires
        if (this.isManager) {
            this.attachEditLineLinks();
            this.attachEditFilterLinks();
        }
    }, 100);
    }

    attachOpenFilterLinks() {
        const links = document.querySelectorAll('.open-filter-link');
        
        links.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineId = parseInt(link.dataset.lineId);
                
                if (!lineId) {
                    return;
                }
                
                await this.openFilterFullScreen(lineId);
            });
        });
    }

    attachEditFilterLinks() {
        const links = document.querySelectorAll('.edit-filter-link');
        
        links.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineId = parseInt(link.dataset.lineId);
                
                if (!lineId) {
                    return;
                }
                
                await this.editFilter(lineId);
            });
        });
    }

    attachEditLineLinks() {
        const links = document.querySelectorAll('.edit-line-link');
        
        links.forEach(link => {
            link.addEventListener('click', async (e) => {
                e.preventDefault();
                const lineId = parseInt(link.dataset.lineId);
                
                if (!lineId) {
                    return;
                }
                
                await this.editLine(lineId);
            });
        });
    }

    async openFilterFullScreen(lineId) {
        try {
            // Appeler la méthode Python action_open_filter sur le modèle is.tableau.de.bord.line
            const result = await this.rpc("/web/dataset/call_kw/is.tableau.de.bord.line/action_open_filter", {
                model: 'is.tableau.de.bord.line',
                method: 'action_open_filter',
                args: [[lineId]],
                kwargs: {}
            });
            
            if (result && result.type) {
                // Exécuter l'action retournée par Python
                await this.actionService.doAction(result);
            } 
            
        } catch (error) {
            console.error("[TDB] Erreur lors de l'ouverture du filtre:", error);
        }
    }

    async editFilter(lineId) {
        try {
            // Appeler la méthode Python action_edit_filter sur le modèle is.tableau.de.bord.line
            const result = await this.rpc("/web/dataset/call_kw/is.tableau.de.bord.line/action_edit_filter", {
                model: 'is.tableau.de.bord.line',
                method: 'action_edit_filter',
                args: [[lineId]],
                kwargs: {}
            });
            
            if (result && result.type) {
                // Exécuter l'action retournée par Python
                await this.actionService.doAction(result);
            }
            
        } catch (error) {
            console.error("[TDB] Erreur lors de l'édition du filtre:", error);
        }
    }

    async editLine(lineId) {
        try {
            // Ouvrir le formulaire de la ligne en plein écran avec la vue dédiée
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
    }

    async loadDashboardItems() {
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
        // Utiliser l'id serveur de la ligne si disponible pour le backend (overrides)
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
                    // Pour les graphiques, envoyer aussi graph_measure et graph_groupbys
                    graph_measure: line.graph_measure,
                    graph_groupbys: line.graph_groupbys,
                    // Pour les pivots
                    pivot_row_groupby: line.pivot_row_groupby,
                    pivot_column_groupby: line.pivot_col_groupby,
                    pivot_measures: line.pivot_measure,
                    pivot_sort_by: line.pivot_sort_by,
                    pivot_sort_order: line.pivot_sort_order,
                    // Pour les listes groupées
                    list_groupby: line.list_groupby,
                };
                await this.loadFilterData(lineRecord.id, filterId, serverLineId, overrides);
            } else {
                this.renderError(lineRecord.id, "Aucun filtre sélectionné");
            }
        }
    }

    async loadFilterData(lineId, filterId, backendLineId, overrides) {
        try {
            const lid = backendLineId || lineId;
            const dashboardId = this.model?.root?.resId;
            const data = await this.rpc("/tableau_de_bord/get_filter_data/" + filterId, { line_id: lid, overrides, dashboard_id: dashboardId });
            this.renderFilterData(lineId, data);
        } catch (error) {
            this.renderError(lineId, "Erreur lors du chargement des données: " + error.message);
        }
    }

    renderFilterData(lineId, data) {
        const container = document.getElementById(`dashboard_item_${lineId}`);
        if (!container) {
            return;
        }

        if (data.error) {
            this.renderError(lineId, data.error);
            return;
        }

        switch (data.type) {
            case 'list':
                this.renderListData(container, data);
                break;
            case 'graph':
                this.renderGraphData(container, data);
                break;
            case 'pivot':
                this.renderPivotData(container, data);
                break;
            default:
                this.renderError(lineId, "Type de données non supporté: " + data.type);
        }
    }

    renderListData(container, data) {
        if (!data.data || data.data.length === 0) {
            container.innerHTML = '<div class="alert alert-info m-2">Aucune donnée à afficher</div>';
            return;
        }
        
        // Filtrer les champs invalides
        const validFields = (data.fields || []).filter(f => f !== null && f !== undefined);
        
        if (validFields.length === 0) {
            container.innerHTML = '<div class="alert alert-warning m-2">Aucun champ à afficher</div>';
            return;
        }
        
        // Détecter si c'est une liste groupée
        const isGrouped = data.is_grouped === true;
        
        let html = '<div class="table-responsive h-100"><table class="table table-sm mb-0">';
        
        // En-têtes
        html += '<thead class="table-light"><tr>';
        for (const f of validFields) {
            const label = typeof f === 'string' ? f : (f?.string || f?.name || 'Sans nom');
            const fieldType = f?.type || 'char';
            const isNumeric = ['integer', 'float', 'monetary'].includes(fieldType);
            const isAggregate = f?.is_aggregate === true;
            const alignClass = isNumeric ? 'text-end' : '';
            // Style spécial pour les colonnes d'agrégation
            const headerStyle = isAggregate ? 'background-color: #e3f2fd;' : '';
            html += `<th class="${alignClass}" style="white-space: nowrap; font-size: 0.875rem; overflow: hidden; text-overflow: ellipsis; max-width: 200px; padding: 0.25rem 0.5rem; ${headerStyle}" title="${label}">${label}</th>`;
        }
        html += '</tr></thead>';
        
        // Données
        html += '<tbody>';
        for (const row of data.data) {
            // Détecter si c'est une ligne d'en-tête de groupe (total de niveau 1)
            const isGroupHeader = row._is_group_header === true;
            const groupLevel = row._group_level || 1;
            
            // Style de la ligne selon le niveau
            let rowClass = '';
            let rowStyle = '';
            if (isGroupHeader) {
                // Ligne de total de groupe : fond coloré et texte en gras
                rowClass = 'table-primary';
                rowStyle = 'font-weight: 600;';
            } else if (groupLevel === 2) {
                // Ligne de détail niveau 2 : légèrement indentée visuellement
                rowStyle = 'background-color: #fafbfc;';
            }
            
            html += `<tr class="${rowClass}" style="${rowStyle}">`;
            for (const f of validFields) {
                const name = typeof f === 'string' ? f : (f?.name || '');
                const fieldType = f?.type || 'char';
                const digits = f?.digits;
                const isAggregate = f?.is_aggregate === true;
                const isGroupby = f?.is_groupby === true;
                let val = row[name];
                let displayVal = '';
                let alignClass = '';
                let cellStyle = '';
                
                // Style spécial pour les cellules d'agrégation
                if (isAggregate && !isGroupHeader) {
                    cellStyle = 'background-color: #f5faff;';
                }
                
                // Traitement selon le type de champ
                if (fieldType === 'integer' && val !== null && val !== undefined && val !== false && val !== '') {
                    // Entier avec séparateur de milliers
                    alignClass = 'text-end';
                    displayVal = parseInt(val).toLocaleString('fr-FR');
                } else if ((fieldType === 'float' || fieldType === 'monetary') && val !== null && val !== undefined && val !== false && val !== '') {
                    // Décimal avec séparateur de milliers et respect des décimales
                    alignClass = 'text-end';
                    const numDigits = digits !== undefined ? digits : 2;
                    displayVal = parseFloat(val).toLocaleString('fr-FR', {
                        minimumFractionDigits: numDigits,
                        maximumFractionDigits: numDigits
                    });
                } else if (Array.isArray(val)) {
                    // many2one: [id, display]
                    displayVal = val.length > 1 ? val[1] : val[0];
                } else if (val && typeof val === 'object') {
                    // divers formats -> stringify propre
                    displayVal = val.display_name || val.name || JSON.stringify(val);
                } else if (val !== null && val !== undefined && val !== false) {
                    // Valeur simple
                    displayVal = val;
                }
                
                html += `<td class="${alignClass}" style="${cellStyle}">${displayVal}</td>`;
            }
            html += '</tr>';
        }
        html += '</tbody>';
        
        html += `</table></div>`;
        
        // Afficher le compteur seulement si show_record_count est True
        if (data.show_record_count !== false && data.count !== undefined) {
            const countLabel = isGrouped ? 'Total enregistrements' : 'Total';
            html += `<div class="text-muted small p-2 border-top">${countLabel}: ${data.count} enregistrement(s)</div>`;
        }
        
        container.innerHTML = html;
        container.className = "dashboard-item h-100 d-flex flex-column";
    }

    renderGraphData(container, data) {
        // Préparer un canvas pour dessiner un vrai graphique si Chart.js est dispo
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

        // Si Chart global est disponible (injecté par Odoo web), dessiner; sinon fallback texte
    const el = document.getElementById(chartId);
    if (window.Chart && el) {
            const showLegend = data.show_legend !== undefined ? data.show_legend : true;
            const chartType = data.chart_type || 'bar';
            const isPieChart = chartType === 'pie';
            
            // Options spécifiques selon le type de graphique
            // Chart.js v2 (Odoo 16) utilise une syntaxe différente de v3+
            const chartOptions = {
                responsive: true,
                maintainAspectRatio: false,
                layout: {
                    padding: isPieChart ? 2 : 10
                },
                // Chart.js v2 syntax pour la légende (pas dans plugins)
                legend: {
                    display: showLegend,
                    position: isPieChart ? 'right' : 'top',
                    labels: {
                        boxWidth: isPieChart ? 10 : 40,
                        padding: isPieChart ? 4 : 10,
                        fontSize: isPieChart ? 9 : 12
                    }
                },
                // Chart.js v3+ syntax (au cas où)
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
            
            // Ajouter les scales uniquement pour les graphiques bar et line
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
            // Fallback: valeurs en gros comme avant
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
    }

    formatNumber(value) {
        return formatNumber(value);
    }

    renderPivotData(container, data) {
        // Support 2D matrix: data.data = { columns: [{label}], rows: [{row, values:[]}], measure_label, row_label, col_label }
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
            
            // header avec libellés améliorés
            html += '<thead class="table-light"><tr>';
            html += '<th class="border-end" style="background-color: #f8f9fa;">' + rowLabel + '</th>';
            for (const c of cols) html += '<th class="text-end">' + c.label + '</th>';
            if (showRowTotals) {
                html += '<th class="text-end border-start fw-bold" style="background-color: #e9ecef;">Total</th>';
            }
            html += '</tr></thead>';
            
            // body
            html += '<tbody>';
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
            
            // footer totals by column
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
                    // Calculer le grand total si pas fourni
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

        // 1D list fallback avec libellés améliorés
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
        
        // Ajouter une ligne de total UNIQUEMENT si fourni par le backend
        if (showTotal) {
            const formattedTotal = formatNumber(data.total);
            html += '<tr class="table-secondary border-top border-2"><td class="fw-bold">Total</td><td class="text-end fw-bold">' + formattedTotal + '</td></tr>';
        }
        
        html += '</tbody></table></div></div>';
        container.innerHTML = html;
        container.className = "dashboard-item h-100";
    }

    renderError(lineId, message) {
        const container = document.getElementById(`dashboard_item_${lineId}`);
        if (container) {
            container.innerHTML = `<div class="alert alert-warning m-2 h-100 d-flex align-items-center justify-content-center text-center">${message}</div>`;
            container.className = "dashboard-item h-100";
        }
    }
}

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
        
        // Attendre que le formulaire soit complètement chargé
        setTimeout(() => {
            this._createDashboardLayout();
            this._loadDashboardItems();
        }, 1500);
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
            const data = await this.rpc("/tableau_de_bord/get_filter_data/" + filterId, { line_id: lid, overrides, dashboard_id: dashboardId });
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
                DashboardFormController.prototype.renderListData.call(this, container, data);
                break;
            case 'graph':
                DashboardFormController.prototype.renderGraphData.call(this, container, data);
                break;
            case 'pivot':
                DashboardFormController.prototype.renderPivotData.call(this, container, data);
                break;
            default:
                this._renderError(lineId, "Type de données non supporté: " + data.type);
        }
    },

    _renderError(lineId, message) {
        const container = document.getElementById(`dashboard_item_${lineId}`);
        if (container) {
            container.innerHTML = `<div class="alert alert-warning m-2 h-100 d-flex align-items-center justify-content-center text-center">${message}</div>`;
            container.className = "dashboard-item h-100";
        }
    },

    _formatNumber(value) {
        if (value === null || value === undefined) return '0';
        const num = parseFloat(value);
        if (isNaN(num)) return value;
        if (Number.isInteger(num)) {
            return num.toLocaleString('fr-FR');
        }
        return num.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
