/* =====================================================
   app.js — Revenue Settlement Analysis & Comment Generation
   ===================================================== */
'use strict';

// ─────────────────────────────────────────────
// DATA STORE
// ─────────────────────────────────────────────
const DataStore = {
    raw: [],
    processed: [],
    clear() { this.raw = []; this.processed = []; },
};

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────
const Router = {
    init() {
        document.querySelectorAll('.nav-btn[data-page]').forEach(btn => {
            btn.addEventListener('click', () => this.goto(btn.dataset.page));
        });
        this.goto('upload');
    },
    goto(pageId) {
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.querySelectorAll('.nav-btn[data-page]').forEach(b => b.classList.remove('active'));
        const page = document.getElementById('page-' + pageId);
        if (page) page.classList.add('active');
        const btn = document.querySelector(`.nav-btn[data-page="${pageId}"]`);
        if (btn) btn.classList.add('active');
        if (pageId === 'dashboard') DashboardRenderer.render();
        if (pageId === 'comments') CommentsRenderer.render();
        if (pageId === 'export') ExportPage.render();
    },
};

// ─────────────────────────────────────────────
// CSV PARSER  (uses PapaParse CDN)
// ─────────────────────────────────────────────
const CSVParser = {
    REQUIRED_COLS: [
        'Property Name', 'Month', 'OCC', 'ADR', 'Total Sales', 'Settlement Revenue',
        'Prev OCC', 'Prev ADR', 'Prev Total Sales', 'Prev Settlement Revenue',
    ],

    parse(file) {
        return new Promise((resolve, reject) => {
            Papa.parse(file, {
                header: true,
                skipEmptyLines: true,
                complete: results => {
                    if (results.errors.length && results.data.length === 0) {
                        reject(new Error('CSV parse error: ' + results.errors[0].message));
                    }
                    resolve(results.data);
                },
                error: err => reject(err),
            });
        });
    },

    parseText(text) {
        return new Promise((resolve, reject) => {
            const results = Papa.parse(text, { header: true, skipEmptyLines: true });
            if (results.errors.length && results.data.length === 0) {
                reject(new Error('Parse error: ' + results.errors[0].message));
            }
            resolve(results.data);
        });
    },

    normalize(rows) {
        // Attempt to map common column name variants
        const aliases = {
            'Property Name': ['property', 'property name', 'name', 'hotel', 'location'],
            'Month': ['month', 'period', 'date', 'ym'],
            'OCC': ['occ', 'occupancy', 'occupancy rate', 'occ%', 'occ (%)'],
            'ADR': ['adr', 'average daily rate', 'avg rate', 'adr (krw)'],
            'Total Sales': ['total sales', 'sales', 'revenue', 'total revenue', 'gross sales'],
            'Settlement Revenue': ['settlement revenue', 'settlement', 'deposited', 'net revenue', 'net settlement'],
            'Prev OCC': ['prev occ', 'previous occ', 'last occ', 'prior occ'],
            'Prev ADR': ['prev adr', 'previous adr', 'last adr', 'prior adr'],
            'Prev Total Sales': ['prev total sales', 'previous total sales', 'last sales', 'prior sales'],
            'Prev Settlement Revenue': ['prev settlement revenue', 'previous settlement', 'last settlement'],
        };

        if (!rows || rows.length === 0) return [];
        const rawKeys = Object.keys(rows[0]);
        const keyMap = {};

        for (const [canonical, variants] of Object.entries(aliases)) {
            // Direct match first
            const direct = rawKeys.find(k => k.trim() === canonical);
            if (direct) { keyMap[canonical] = direct; continue; }
            // Fuzzy alias match
            const fuzzy = rawKeys.find(k =>
                variants.some(v => k.trim().toLowerCase() === v)
            );
            if (fuzzy) keyMap[canonical] = fuzzy;
        }

        return rows.map(row => {
            const mapped = {};
            for (const [canon, raw] of Object.entries(keyMap)) {
                mapped[canon] = row[raw] ?? '';
            }
            return mapped;
        }).filter(r => r['Property Name']);
    },
};

// ─────────────────────────────────────────────
// GOOGLE SHEETS LOADER
// ─────────────────────────────────────────────
const GoogleSheetsLoader = {
    // Converts a Google Sheets URL to a CSV export URL
    toCSVUrl(sheetUrl) {
        const patterns = [
            /https:\/\/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
            /spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
        ];
        let fileId = null;
        for (const pat of patterns) {
            const m = sheetUrl.match(pat);
            if (m) { fileId = m[1]; break; }
        }
        if (!fileId) throw new Error('Could not extract Sheets file ID from URL.');
        // Attempt to extract gid (sheet id)
        const gidMatch = sheetUrl.match(/gid=(\d+)/);
        const gid = gidMatch ? gidMatch[1] : '0';
        return `https://docs.google.com/spreadsheets/d/${fileId}/export?format=csv&gid=${gid}`;
    },

    async load(sheetUrl) {
        const csvUrl = this.toCSVUrl(sheetUrl);
        const resp = await fetch(csvUrl);
        if (!resp.ok) throw new Error(`Failed to fetch sheet (${resp.status}). Make sure it is set to "Anyone with link can view".`);
        return resp.text();
    },
};

// ─────────────────────────────────────────────
// KPI ENGINE
// ─────────────────────────────────────────────
const KPIEngine = {
    num(v) {
        if (v === null || v === undefined || v === '') return 0;
        return parseFloat(String(v).replace(/[,%\s₩$]/g, '')) || 0;
    },

    pctChange(curr, prev) {
        if (!prev || prev === 0) return 0;
        return ((curr - prev) / Math.abs(prev)) * 100;
    },

    process(rows) {
        return rows.map(row => {
            const currOCC = this.num(row['OCC']);
            const prevOCC = this.num(row['Prev OCC']);
            const currADR = this.num(row['ADR']);
            const prevADR = this.num(row['Prev ADR']);
            const currSales = this.num(row['Total Sales']);
            const prevSales = this.num(row['Prev Total Sales']);
            const currRev = this.num(row['Settlement Revenue']);
            const prevRev = this.num(row['Prev Settlement Revenue']);

            const dOCC = currOCC - prevOCC;
            const dADR = currADR - prevADR;
            const dSales = currSales - prevSales;
            const dRev = currRev - prevRev;

            const pOCC = this.pctChange(currOCC, prevOCC);
            const pADR = this.pctChange(currADR, prevADR);
            const pSales = this.pctChange(currSales, prevSales);
            const pRev = this.pctChange(currRev, prevRev);

            return {
                property: row['Property Name'],
                month: row['Month'],
                currOCC, prevOCC, dOCC, pOCC,
                currADR, prevADR, dADR, pADR,
                currSales, prevSales, dSales, pSales,
                currRev, prevRev, dRev, pRev,
                ruleComment: '',
                aiComment: '',
                commentSource: 'none',
            };
        });
    },
};

// ─────────────────────────────────────────────
// RULE ENGINE
// ─────────────────────────────────────────────
const RuleEngine = {
    generate(kpi) {
        const occUp = kpi.dOCC >= 0;
        const adrUp = kpi.dADR >= 0;
        const revUp = kpi.dRev >= 0;
        const salesUp = kpi.dSales >= 0;

        let base = '';
        if (occUp && adrUp) {
            base = 'Strong demand growth with improved pricing strategy — occupancy and ADR both moved higher, indicating a healthy revenue environment.';
        } else if (occUp && !adrUp) {
            base = 'Demand recovery is underway with occupancy improving, however ADR softened — pricing power appears to be weakening relative to the prior period.';
        } else if (!occUp && adrUp) {
            base = 'Occupancy declined while ADR improved, suggesting a shift toward higher-value guests with lower overall volume — a selective pricing strategy.';
        } else {
            base = 'Both occupancy and ADR declined during the period, signaling weakened demand and reduced pricing power that require operational review.';
        }

        // Settlement anomaly
        if (salesUp && !revUp) {
            base += ' Note: Sales increased while settlement revenue declined — this may indicate delayed settlement remittances from sales channels or OTA partners.';
        } else if (!salesUp && revUp) {
            base += ' Settlement revenue outperformed sales, possibly reflecting prior-period delayed remittances clearing this month.';
        }

        // Magnitude context
        if (Math.abs(kpi.pOCC) > 10) {
            base += ` Occupancy movement of ${kpi.pOCC > 0 ? '+' : ''}${kpi.pOCC.toFixed(1)}% is notably significant and warrants close monitoring.`;
        }

        return base;
    },

    applyAll(processed) {
        processed.forEach(row => {
            row.ruleComment = this.generate(row);
            if (row.commentSource === 'none' || row.commentSource === 'rule') {
                row.commentSource = 'rule';
            }
        });
        return processed;
    },
};

// ─────────────────────────────────────────────
// AI ENGINE
// ─────────────────────────────────────────────
const AIEngine = {
    getKey() {
        return localStorage.getItem('openai_api_key') || '';
    },
    setKey(key) {
        localStorage.setItem('openai_api_key', key.trim());
    },

    buildPrompt(kpi) {
        const fmt = (n, prefix = '', decimals = 1) =>
            `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}${prefix}`;
        return `You are an expert hospitality operations analyst. Write a concise, professional operational comment (2-3 sentences) for the following property KPI data. The comment should be suitable for an internal management report or owner report. Be specific about the KPI movements and their operational implications.

Property: ${kpi.property}
Reporting Month: ${kpi.month}

KPI Performance:
- Occupancy (OCC): ${kpi.prevOCC.toFixed(1)}% → ${kpi.currOCC.toFixed(1)}% (${fmt(kpi.dOCC, 'pp')}, ${fmt(kpi.pOCC, '%')})
- Average Daily Rate (ADR): ${fmt(kpi.prevADR, '', 0).replace('+', '')} → ${fmt(kpi.currADR, '', 0).replace('+', '')} (${fmt(kpi.dADR, '', 0)}, ${fmt(kpi.pADR, '%')})
- Total Sales: ${kpi.prevSales.toLocaleString()} → ${kpi.currSales.toLocaleString()} (${fmt(kpi.pSales, '%')})
- Settlement Revenue: ${kpi.prevRev.toLocaleString()} → ${kpi.currRev.toLocaleString()} (${fmt(kpi.pRev, '%')})

Rule-based insight: ${kpi.ruleComment}

Write only the operational comment, no preamble or labels.`;
    },

    async generateOne(kpi) {
        const key = this.getKey();
        if (!key) throw new Error('No OpenAI API key configured.');
        const resp = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
            },
            body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a hospitality revenue operations analyst writing professional internal reports.' },
                    { role: 'user', content: this.buildPrompt(kpi) },
                ],
                max_tokens: 200,
                temperature: 0.5,
            }),
        });
        if (!resp.ok) {
            const err = await resp.json();
            throw new Error(err?.error?.message || `API error ${resp.status}`);
        }
        const data = await resp.json();
        return data.choices[0].message.content.trim();
    },

    async generateAll(processed, onProgress) {
        for (let i = 0; i < processed.length; i++) {
            const kpi = processed[i];
            try {
                kpi.aiComment = await this.generateOne(kpi);
                kpi.commentSource = 'ai';
            } catch (e) {
                kpi.aiComment = '';
                kpi.commentSource = 'rule';
            }
            if (onProgress) onProgress(i + 1, processed.length);
        }
        return processed;
    },
};

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────
const Utils = {
    fmtNum(n, decimals = 1) {
        if (n === undefined || n === null || isNaN(n)) return '—';
        return Number(n).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    },
    fmtPct(n) {
        const s = (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
        return s;
    },
    fmtMoney(n) {
        if (!n && n !== 0) return '—';
        return '₩' + Math.round(n).toLocaleString();
    },
    fmtDelta(abs, pct, isMonetary = false) {
        const cls = pct >= 0 ? 'positive' : 'negative';
        const icon = pct >= 0 ? '▲' : '▼';
        const absStr = isMonetary ? Utils.fmtMoney(abs) : Utils.fmtNum(abs);
        return `<span class="delta ${cls}">${icon} ${absStr} (${Utils.fmtPct(pct)})</span>`;
    },
    getComment(kpi) {
        if (kpi.commentSource === 'ai' && kpi.aiComment) return kpi.aiComment;
        return kpi.ruleComment || '—';
    },
    toast(msg, type = 'success') {
        const container = document.getElementById('toast-container');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<span>${type === 'success' ? '✅' : '❌'}</span> ${msg}`;
        container.appendChild(el);
        setTimeout(() => el.remove(), 3800);
    },
};

// ─────────────────────────────────────────────
// UPLOAD PAGE
// ─────────────────────────────────────────────
const UploadPage = {
    previewData: [],

    init() {
        const zone = document.getElementById('drop-zone');
        const fileInput = document.getElementById('csv-file-input');
        const sheetBtn = document.getElementById('sheets-load-btn');
        const analyzeBtn = document.getElementById('analyze-btn');

        // Drag & drop
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
        zone.addEventListener('drop', async e => {
            e.preventDefault(); zone.classList.remove('dragover');
            const file = e.dataTransfer.files[0];
            if (file) await this.handleFile(file);
        });
        fileInput.addEventListener('change', async () => {
            if (fileInput.files[0]) await this.handleFile(fileInput.files[0]);
        });

        // Google Sheets
        sheetBtn.addEventListener('click', () => this.handleSheets());

        // Analyze
        analyzeBtn.addEventListener('click', () => this.analyze());

        // AI Key save
        const saveKeyBtn = document.getElementById('save-key-btn');
        const keyInput = document.getElementById('ai-key-input');
        keyInput.value = AIEngine.getKey();
        saveKeyBtn.addEventListener('click', () => {
            AIEngine.setKey(keyInput.value);
            Utils.toast('API key saved.', 'success');
        });
    },

    async handleFile(file) {
        try {
            document.getElementById('upload-filename').textContent = file.name;
            const rows = await CSVParser.parse(file);
            const normalized = CSVParser.normalize(rows);
            this.previewData = normalized;
            this.renderPreview(normalized);
            document.getElementById('analyze-btn').disabled = normalized.length === 0;
        } catch (e) {
            Utils.toast('Failed to parse CSV: ' + e.message, 'error');
        }
    },

    async handleSheets() {
        const url = document.getElementById('sheets-url').value.trim();
        if (!url) { Utils.toast('Please enter a Google Sheets URL.', 'error'); return; }
        const btn = document.getElementById('sheets-load-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Loading…';
        try {
            const csvText = await GoogleSheetsLoader.load(url);
            const rows = await CSVParser.parseText(csvText);
            const normalized = CSVParser.normalize(rows);
            this.previewData = normalized;
            this.renderPreview(normalized);
            document.getElementById('upload-filename').textContent = `Google Sheets (${normalized.length} rows)`;
            document.getElementById('analyze-btn').disabled = normalized.length === 0;
            Utils.toast(`Loaded ${normalized.length} rows from Google Sheets.`);
        } catch (e) {
            Utils.toast('Sheets error: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '🔗 Load Sheet';
        }
    },

    renderPreview(data) {
        const section = document.getElementById('preview-section');
        const tbody = document.getElementById('preview-tbody');
        const count = document.getElementById('preview-count');
        if (!data || data.length === 0) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        count.textContent = `${data.length} rows detected`;
        const cols = ['Property Name', 'Month', 'OCC', 'ADR', 'Total Sales', 'Settlement Revenue'];
        tbody.innerHTML = data.slice(0, 6).map(row =>
            `<tr>${cols.map(c => `<td>${row[c] ?? '—'}</td>`).join('')}</tr>`
        ).join('');
    },

    analyze() {
        if (!this.previewData || this.previewData.length === 0) {
            Utils.toast('No data to analyze.', 'error'); return;
        }
        DataStore.raw = this.previewData;
        DataStore.processed = KPIEngine.process(this.previewData);
        RuleEngine.applyAll(DataStore.processed);

        // Update nav status
        document.getElementById('status-dot').className = 'status-dot ready';
        document.getElementById('status-text').textContent = `${DataStore.processed.length} Properties Loaded`;

        Utils.toast(`Analyzed ${DataStore.processed.length} properties.`, 'success');
        Router.goto('dashboard');
    },
};

// ─────────────────────────────────────────────
// DASHBOARD RENDERER
// ─────────────────────────────────────────────
const DashboardRenderer = {
    sortCol: null,
    sortDir: 1,
    filterText: '',

    render() {
        const data = DataStore.processed;
        if (!data || data.length === 0) {
            document.getElementById('dashboard-content').innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📊</div>
          <h3>No data yet</h3>
          <p>Upload settlement data to see the KPI dashboard.</p>
        </div>`;
            document.getElementById('stat-grid').innerHTML = '';
            return;
        }
        this.renderStats(data);
        this.renderTable(data);
    },

    renderStats(data) {
        const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
        const avgOCC = avg(data.map(d => d.pOCC));
        const avgADR = avg(data.map(d => d.pADR));
        const avgSales = avg(data.map(d => d.pSales));
        const avgRev = avg(data.map(d => d.pRev));
        const sign = n => n >= 0 ? 'text-green' : 'text-red';

        document.getElementById('stat-grid').innerHTML = `
      <div class="stat-card">
        <div class="stat-label">Properties</div>
        <div class="stat-value text-accent">${data.length}</div>
        <div class="stat-sub">Analyzed this period</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg OCC Change</div>
        <div class="stat-value ${sign(avgOCC)}">${Utils.fmtPct(avgOCC)}</div>
        <div class="stat-sub">Occupancy rate shift</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg ADR Change</div>
        <div class="stat-value ${sign(avgADR)}">${Utils.fmtPct(avgADR)}</div>
        <div class="stat-sub">Average daily rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Sales Change</div>
        <div class="stat-value ${sign(avgSales)}">${Utils.fmtPct(avgSales)}</div>
        <div class="stat-sub">Total revenue shift</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Avg Settlement Δ</div>
        <div class="stat-value ${sign(avgRev)}">${Utils.fmtPct(avgRev)}</div>
        <div class="stat-sub">Settlement revenue</div>
      </div>
    `;
    },

    getFiltered(data) {
        let rows = [...data];
        if (this.filterText) {
            const q = this.filterText.toLowerCase();
            rows = rows.filter(r =>
                r.property.toLowerCase().includes(q) ||
                r.month.toLowerCase().includes(q) ||
                Utils.getComment(r).toLowerCase().includes(q)
            );
        }
        if (this.sortCol) {
            rows.sort((a, b) => {
                let av = a[this.sortCol], bv = b[this.sortCol];
                if (typeof av === 'string') av = av.toLowerCase();
                if (typeof bv === 'string') bv = bv.toLowerCase();
                return av < bv ? -this.sortDir : av > bv ? this.sortDir : 0;
            });
        }
        return rows;
    },

    renderTable(data) {
        const rows = this.getFiltered(data);
        const cols = [
            { label: 'Property', key: 'property' },
            { label: 'Month', key: 'month' },
            { label: 'OCC', key: 'currOCC' },
            { label: 'Δ OCC', key: 'pOCC' },
            { label: 'ADR', key: 'currADR' },
            { label: 'Δ ADR', key: 'pADR' },
            { label: 'Sales', key: 'currSales' },
            { label: 'Δ Sales', key: 'pSales' },
            { label: 'Settlement Rev', key: 'currRev' },
            { label: 'Δ Rev', key: 'pRev' },
            { label: 'Comment', key: null },
        ];

        const thHTML = cols.map(c => {
            const sortCls = c.key === this.sortCol ? (this.sortDir === 1 ? 'sort-asc' : 'sort-desc') : '';
            const clickAttr = c.key ? `onclick="DashboardRenderer.sort('${c.key}')"` : '';
            return `<th class="${sortCls}" ${clickAttr}>${c.label}<span class="sort-icon"></span></th>`;
        }).join('');

        const tdHTML = rows.map(r => `
      <tr>
        <td class="td-property">${r.property}</td>
        <td class="td-month">${r.month}</td>
        <td><strong>${r.currOCC.toFixed(1)}%</strong></td>
        <td>${Utils.fmtDelta(r.dOCC, r.pOCC)}</td>
        <td>${Utils.fmtMoney(r.currADR)}</td>
        <td>${Utils.fmtDelta(r.dADR, r.pADR, true)}</td>
        <td>${Utils.fmtMoney(r.currSales)}</td>
        <td>${Utils.fmtDelta(r.dSales, r.pSales, true)}</td>
        <td>${Utils.fmtMoney(r.currRev)}</td>
        <td>${Utils.fmtDelta(r.dRev, r.pRev, true)}</td>
        <td class="td-comment">${Utils.getComment(r)}</td>
      </tr>`).join('');

        document.getElementById('dashboard-content').innerHTML = `
      <div class="table-toolbar">
        <div class="search-box">
          <span class="search-icon">🔍</span>
          <input class="form-control" id="dash-search" type="text" placeholder="Search properties or comments…" value="${this.filterText}">
        </div>
        <span class="text-muted" style="font-size:0.8rem;">${rows.length} of ${data.length} properties</span>
      </div>
      <div class="table-wrapper">
        <table>
          <thead><tr>${thHTML}</tr></thead>
          <tbody>${tdHTML || '<tr><td colspan="11" style="text-align:center;padding:32px;color:var(--text-muted)">No matching properties.</td></tr>'}</tbody>
        </table>
      </div>`;

        document.getElementById('dash-search').addEventListener('input', e => {
            this.filterText = e.target.value;
            this.render();
        });
    },

    sort(key) {
        if (this.sortCol === key) this.sortDir *= -1;
        else { this.sortCol = key; this.sortDir = 1; }
        this.render();
    },
};

// ─────────────────────────────────────────────
// COMMENTS RENDERER
// ─────────────────────────────────────────────
const CommentsRenderer = {
    render() {
        const data = DataStore.processed;
        const container = document.getElementById('comments-grid');
        if (!data || data.length === 0) {
            container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">💬</div>
          <h3>No data yet</h3>
          <p>Upload and analyze data first.</p>
        </div>`;
            return;
        }
        container.innerHTML = data.map((kpi, i) => this.cardHTML(kpi, i)).join('');
        // Attach event listeners
        data.forEach((kpi, i) => {
            const regen = document.getElementById(`regen-${i}`);
            const textarea = document.getElementById(`comment-text-${i}`);
            regen.addEventListener('click', () => this.regenerateAI(kpi, i));
            textarea.addEventListener('input', e => {
                kpi.aiComment = e.target.value;
                kpi.commentSource = 'ai';
                this.updateBadge(i, 'ai');
            });
        });
    },

    cardHTML(kpi, i) {
        const comment = Utils.getComment(kpi);
        const badgeCls = kpi.commentSource === 'ai' ? 'badge-ai' : 'badge-rule';
        const badgeLabel = kpi.commentSource === 'ai' ? '✦ AI' : '⚙ Rule';
        return `
      <div class="comment-card">
        <div class="comment-card-header">
          <div>
            <div class="comment-card-title">${kpi.property}</div>
            <div class="comment-card-month">${kpi.month}</div>
          </div>
          <button class="btn btn-sm btn-secondary" id="regen-${i}">✦ AI</button>
        </div>
        <div class="kpi-mini-grid">
          <div class="kpi-mini">
            <div class="kpi-mini-label">OCC</div>
            <div class="kpi-mini-values">
              <span>${kpi.prevOCC.toFixed(1)}%</span>
              <span class="arrow-icon">→</span>
              <span class="font-700">${kpi.currOCC.toFixed(1)}%</span>
              <span class="delta ${kpi.dOCC >= 0 ? 'positive' : 'negative'}" style="font-size:0.68rem">${kpi.dOCC >= 0 ? '+' : ''}${kpi.dOCC.toFixed(1)}pp</span>
            </div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">ADR</div>
            <div class="kpi-mini-values">
              <span>${Utils.fmtMoney(kpi.prevADR)}</span>
              <span class="arrow-icon">→</span>
              <span class="font-700">${Utils.fmtMoney(kpi.currADR)}</span>
              <span class="delta ${kpi.dADR >= 0 ? 'positive' : 'negative'}" style="font-size:0.68rem">${Utils.fmtPct(kpi.pADR)}</span>
            </div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">Total Sales</div>
            <div class="kpi-mini-values">
              <span>${Utils.fmtMoney(kpi.prevSales)}</span>
              <span class="arrow-icon">→</span>
              <span class="font-700">${Utils.fmtMoney(kpi.currSales)}</span>
              <span class="delta ${kpi.dSales >= 0 ? 'positive' : 'negative'}" style="font-size:0.68rem">${Utils.fmtPct(kpi.pSales)}</span>
            </div>
          </div>
          <div class="kpi-mini">
            <div class="kpi-mini-label">Settlement Rev</div>
            <div class="kpi-mini-values">
              <span>${Utils.fmtMoney(kpi.prevRev)}</span>
              <span class="arrow-icon">→</span>
              <span class="font-700">${Utils.fmtMoney(kpi.currRev)}</span>
              <span class="delta ${kpi.dRev >= 0 ? 'positive' : 'negative'}" style="font-size:0.68rem">${Utils.fmtPct(kpi.pRev)}</span>
            </div>
          </div>
        </div>
        <textarea class="comment-text-area" id="comment-text-${i}" rows="4">${comment}</textarea>
        <div class="comment-card-footer">
          <span class="comment-source-badge ${badgeCls}" id="badge-${i}">${badgeLabel}</span>
          <span class="text-muted" style="font-size:0.75rem;">Click ✦ AI to regenerate with OpenAI</span>
        </div>
      </div>`;
    },

    async regenerateAI(kpi, i) {
        const btn = document.getElementById(`regen-${i}`);
        const textarea = document.getElementById(`comment-text-${i}`);
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';
        try {
            const comment = await AIEngine.generateOne(kpi);
            kpi.aiComment = comment;
            kpi.commentSource = 'ai';
            textarea.value = comment;
            this.updateBadge(i, 'ai');
            Utils.toast('AI comment generated.', 'success');
        } catch (e) {
            Utils.toast('AI error: ' + e.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = '✦ AI';
        }
    },

    updateBadge(i, source) {
        const badge = document.getElementById(`badge-${i}`);
        if (!badge) return;
        badge.className = `comment-source-badge ${source === 'ai' ? 'badge-ai' : 'badge-rule'}`;
        badge.textContent = source === 'ai' ? '✦ AI' : '⚙ Rule';
    },
};

// ─────────────────────────────────────────────
// EXPORT ENGINE
// ─────────────────────────────────────────────
const ExportEngine = {
    exportCSV() {
        const data = DataStore.processed;
        if (!data || data.length === 0) { Utils.toast('No data to export.', 'error'); return; }
        const headers = [
            'Property', 'Month',
            'OCC', 'Prev OCC', 'OCC Change (pp)', 'OCC Change (%)',
            'ADR', 'Prev ADR', 'ADR Change', 'ADR Change (%)',
            'Total Sales', 'Prev Total Sales', 'Sales Change', 'Sales Change (%)',
            'Settlement Revenue', 'Prev Settlement Revenue', 'Revenue Change', 'Revenue Change (%)',
            'Generated Comment',
        ];
        const rows = data.map(r => [
            r.property, r.month,
            r.currOCC, r.prevOCC, r.dOCC, r.pOCC.toFixed(2),
            r.currADR, r.prevADR, r.dADR, r.pADR.toFixed(2),
            r.currSales, r.prevSales, r.dSales, r.pSales.toFixed(2),
            r.currRev, r.prevRev, r.dRev, r.pRev.toFixed(2),
            `"${Utils.getComment(r).replace(/"/g, '""')}"`,
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'settlement_analysis.csv';
        a.click(); URL.revokeObjectURL(url);
        Utils.toast('CSV exported.', 'success');
    },

    exportPDF() {
        const data = DataStore.processed;
        if (!data || data.length === 0) { Utils.toast('No data to export.', 'error'); return; }
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const pageW = 210; const margin = 16;
        const contentW = pageW - margin * 2;
        let y = margin;

        const addTitle = () => {
            doc.setFillColor(13, 21, 33); doc.rect(0, 0, pageW, 20, 'F');
            doc.setFontSize(12); doc.setTextColor(79, 142, 247);
            doc.setFont('helvetica', 'bold');
            doc.text('Revenue Settlement Analysis Report', margin, 13);
            doc.setFontSize(8); doc.setTextColor(138, 155, 181);
            doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageW - margin, 13, { align: 'right' });
            y = 26;
        };

        const checkPage = (needed = 20) => {
            if (y + needed > 285) { doc.addPage(); y = margin; }
        };

        addTitle();

        data.forEach((r, idx) => {
            checkPage(55);
            // Property header
            doc.setFillColor(17, 25, 39);
            doc.roundedRect(margin, y, contentW, 8, 1.5, 1.5, 'F');
            doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(232, 237, 245);
            doc.text(`${r.property}`, margin + 3, y + 5.5);
            doc.setFontSize(7); doc.setTextColor(138, 155, 181);
            doc.text(r.month, pageW - margin - 3, y + 5.5, { align: 'right' });
            y += 11;

            // KPI row
            const kpis = [
                { label: 'OCC', curr: r.currOCC.toFixed(1) + '%', d: r.dOCC >= 0, dp: Utils.fmtPct(r.pOCC) },
                { label: 'ADR', curr: Utils.fmtMoney(r.currADR), d: r.dADR >= 0, dp: Utils.fmtPct(r.pADR) },
                { label: 'Sales', curr: Utils.fmtMoney(r.currSales), d: r.dSales >= 0, dp: Utils.fmtPct(r.pSales) },
                { label: 'Settlement', curr: Utils.fmtMoney(r.currRev), d: r.dRev >= 0, dp: Utils.fmtPct(r.pRev) },
            ];
            const kpiCellW = contentW / 4;
            kpis.forEach((k, ki) => {
                const cx = margin + ki * kpiCellW;
                doc.setFillColor(8, 12, 20);
                doc.rect(cx, y, kpiCellW - 1.5, 14, 'F');
                doc.setFontSize(6); doc.setFont('helvetica', 'normal'); doc.setTextColor(74, 88, 112);
                doc.text(k.label.toUpperCase(), cx + 3, y + 4);
                doc.setFontSize(7.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(232, 237, 245);
                doc.text(k.curr, cx + 3, y + 9);
                doc.setFontSize(6.5);
                doc.setTextColor(k.d ? 48 : 240, k.d ? 199 : 82, k.d ? 123 : 82);
                doc.text(k.dp, cx + 3, y + 13.5);
            });
            y += 17;

            // Comment
            checkPage(20);
            doc.setFillColor(13, 21, 33);
            doc.rect(margin, y, contentW, 0.3, 'F');
            y += 4;
            const cmt = Utils.getComment(r);
            doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(138, 155, 181);
            const lines = doc.splitTextToSize(cmt, contentW - 2);
            checkPage(lines.length * 4 + 3);
            doc.text(lines, margin + 1, y);
            y += lines.length * 3.8 + 6;
        });

        doc.save('settlement_report.pdf');
        Utils.toast('PDF exported.', 'success');
    },

    copyComments() {
        const data = DataStore.processed;
        if (!data || data.length === 0) { Utils.toast('No data to copy.', 'error'); return; }
        const text = data.map(r => [
            `【${r.property}】 ${r.month}`,
            `OCC: ${r.prevOCC.toFixed(1)}% → ${r.currOCC.toFixed(1)}%  |  ADR: ${Utils.fmtMoney(r.prevADR)} → ${Utils.fmtMoney(r.currADR)}`,
            `Sales: ${Utils.fmtMoney(r.prevSales)} → ${Utils.fmtMoney(r.currSales)}  |  Settlement: ${Utils.fmtMoney(r.prevRev)} → ${Utils.fmtMoney(r.currRev)}`,
            `Comment: ${Utils.getComment(r)}`,
            '',
        ].join('\n')).join('\n');
        navigator.clipboard.writeText(text)
            .then(() => Utils.toast('Comments copied to clipboard.', 'success'))
            .catch(() => Utils.toast('Clipboard access denied.', 'error'));
    },
};

// ─────────────────────────────────────────────
// EXPORT PAGE
// ─────────────────────────────────────────────
const ExportPage = {
    render() {
        const data = DataStore.processed;
        const preview = document.getElementById('export-preview');
        if (!data || data.length === 0) {
            preview.innerHTML = '<em style="color:var(--text-muted)">No data loaded. Upload and analyze data first.</em>';
            return;
        }
        preview.innerHTML = data.map(r => `
      <div class="preview-prop">
        <div class="preview-prop-name">${r.property} — ${r.month}</div>
        OCC: ${r.prevOCC.toFixed(1)}% → ${r.currOCC.toFixed(1)}% (${Utils.fmtPct(r.pOCC)})  |  ADR: ${Utils.fmtMoney(r.prevADR)} → ${Utils.fmtMoney(r.currADR)} (${Utils.fmtPct(r.pADR)})
Sales: ${Utils.fmtMoney(r.prevSales)} → ${Utils.fmtMoney(r.currSales)} (${Utils.fmtPct(r.pSales)})  |  Settlement: ${Utils.fmtMoney(r.prevRev)} → ${Utils.fmtMoney(r.currRev)} (${Utils.fmtPct(r.pRev)})
Comment: ${Utils.getComment(r)}
      </div>`).join('');
    },
};

// ─────────────────────────────────────────────
// BULK AI GENERATE
// ─────────────────────────────────────────────
async function bulkGenerateAI() {
    const data = DataStore.processed;
    if (!data || data.length === 0) { Utils.toast('No data loaded.', 'error'); return; }
    const key = AIEngine.getKey();
    if (!key) { Utils.toast('Enter an OpenAI API key first.', 'error'); return; }

    const btn = document.getElementById('bulk-ai-btn');
    btn.disabled = true;
    const total = data.length;
    let done = 0;

    btn.innerHTML = `<span class="spinner"></span> 0 / ${total}`;
    await AIEngine.generateAll(data, (i) => {
        done = i;
        btn.innerHTML = `<span class="spinner"></span> ${done} / ${total}`;
    });
    btn.disabled = false;
    btn.innerHTML = '✦ Bulk AI Generate All';
    CommentsRenderer.render();
    Utils.toast(`AI comments generated for ${total} properties.`, 'success');
}

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    Router.init();
    UploadPage.init();

    // Export buttons
    document.getElementById('export-pdf-btn').addEventListener('click', () => ExportEngine.exportPDF());
    document.getElementById('export-csv-btn').addEventListener('click', () => ExportEngine.exportCSV());
    document.getElementById('copy-comments-btn').addEventListener('click', () => ExportEngine.copyComments());

    // Bulk AI
    document.getElementById('bulk-ai-btn').addEventListener('click', bulkGenerateAI);
});
