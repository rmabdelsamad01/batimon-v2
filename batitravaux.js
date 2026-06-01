// ═══════════════════════════════════════════════════════════════════════════════
// BATITRAVAUX.JS  —  Suivi Travaux + Affectation Projet integration for Batimon
// Tables (bt_ prefix): bt_reports · bt_affectation · bt_history
// Uses Batimon's window.sb client and window.sbProfile for auth
// ═══════════════════════════════════════════════════════════════════════════════

// ─── State ──────────────────────────────────────────────────────────────────────
let _btReports      = [];
let _btAffectation  = [];
let _btHistoryCache = [];
let _btTravauxSub   = 'dashboard';   // active sub-tab in Suivi Travaux
let _btPendingFiles = new Map();
let _btFileIdCtr    = 0;
let _btCssInjected  = false;

// ─── Current user ───────────────────────────────────────────────────────────────
function _btUser() {
  if (window.sbProfile) {
    return window.sbProfile.full_name || window.sbProfile.username || window.sbUser?.email || 'Anonyme';
  }
  return 'Anonyme';
}

// ─── Supabase shorthand ─────────────────────────────────────────────────────────
function _btSb() { return window.sb; }

// ─── Utils ──────────────────────────────────────────────────────────────────────
function _btH(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function _btA(s) { return _btH(s); }
function _btFmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('fr-FR', {day:'2-digit',month:'short',year:'numeric'}); } catch { return d; }
}
function _btFmtMoney(n) {
  if (!n) return '0 MAD';
  return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(n) + ' MAD';
}
function _btFmtMoneyShort(n) {
  if (!n || n === 0) return '0';
  const v = parseFloat(n);
  if (v >= 1000000) return (v/1000000).toFixed(2)+' M';
  if (v >= 1000) return (v/1000).toFixed(0)+' k';
  return v.toFixed(0);
}
function _btStatLabel(s) {
  return ({attente:'En attente',cours:'En cours',valide:'Validé',bloque:'Bloqué','non-lance':'Non lancé',livre:'Livré'})[s] || s;
}
function _btCalcAv(p) {
  const mm = parseFloat(p.montantMarche)||0, ca = parseFloat(p.cumulAttache)||0;
  if (mm <= 0) return 0;
  return Math.min(100, Math.max(0, ca/mm*100));
}
function _btToast(msg, ok=true) {
  if (typeof toast === 'function') { toast(msg); return; }
  const t = document.getElementById('toast');
  if (t) { t.textContent = msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2400); }
}
function _btNextFileId() { return 'bf' + (++_btFileIdCtr) + Date.now(); }

// ─── CSS injection (once) ──────────────────────────────────────────────────────
function _btInjectCss() {
  if (_btCssInjected) return;
  _btCssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
/* ─── BT shared ─── */
.bt-page { font-family:'Barlow',sans-serif; color:var(--text,#1a2a3a); }
.bt-header { padding:20px 28px 14px; border-bottom:1px solid var(--border,#dde3ee); background:#fff; display:flex; align-items:center; gap:12px; flex-wrap:wrap; justify-content:space-between; }
.bt-header-left { display:flex; align-items:center; gap:12px; }
.bt-header-icon { font-size:22px; }
.bt-header-title { font-size:16px; font-weight:700; color:#224F93; }
.bt-header-sub { font-size:11px; color:var(--text3,#8099b0); margin-top:2px; }
.bt-sub-nav { display:flex; gap:0; border-bottom:2px solid var(--border,#dde3ee); background:#fff; padding:0 28px; }
.bt-sub-tab { background:none; border:none; border-bottom:3px solid transparent; padding:11px 18px; font-family:'Barlow',sans-serif; font-size:12px; font-weight:600; color:var(--text3,#8099b0); cursor:pointer; transition:all 0.15s; margin-bottom:-2px; }
.bt-sub-tab:hover { color:#224F93; }
.bt-sub-tab.active { color:#224F93; border-bottom-color:#224F93; }
.bt-body { padding:24px 28px; overflow-y:auto; }
.bt-kpi-row { display:flex; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
.bt-kpi { background:#fff; border:1px solid var(--border,#dde3ee); border-radius:10px; padding:14px 18px; min-width:120px; flex:1; }
.bt-kpi-val { font-size:22px; font-weight:700; color:#224F93; }
.bt-kpi-lbl { font-size:11px; color:var(--text3,#8099b0); margin-top:2px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; }
.bt-kpi.red .bt-kpi-val { color:#c02020; }
.bt-kpi.green .bt-kpi-val { color:#1a9458; }
.bt-kpi.amber .bt-kpi-val { color:#b08400; }
.bt-card { background:#fff; border:1px solid var(--border,#dde3ee); border-radius:10px; margin-bottom:18px; overflow:hidden; }
.bt-card-title { font-size:13px; font-weight:700; color:var(--text,#1a2a3a); padding:14px 18px 10px; border-bottom:1px solid var(--border,#dde3ee); }
.bt-table-wrap { overflow-x:auto; }
.bt-table { width:100%; border-collapse:collapse; font-size:12px; }
.bt-table th { background:#f0f4f9; color:#445; font-weight:700; padding:8px 10px; text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; border-bottom:2px solid #dde3ee; white-space:nowrap; }
.bt-table td { padding:8px 10px; border-bottom:1px solid #f0f2f5; vertical-align:middle; }
.bt-table tr:hover td { background:#f7f9fc; }
.bt-badge { display:inline-block; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; }
.bt-badge.attente { background:#fff3cd; color:#856404; }
.bt-badge.cours { background:#cce5ff; color:#004085; }
.bt-badge.valide { background:#d4edda; color:#155724; }
.bt-badge.bloque { background:#f8d7da; color:#721c24; }
.bt-badge.livre { background:#d4edda; color:#155724; }
.bt-badge.non-lance { background:#f0f2f5; color:#445; }
.bt-prog { display:flex; align-items:center; gap:7px; }
.bt-prog-bar { flex:1; height:6px; background:#e0e6ef; border-radius:3px; min-width:50px; }
.bt-prog-fill { height:100%; border-radius:3px; background:#224F93; transition:width 0.3s; }
.bt-prog-fill.green { background:#1a9458; }
.bt-prog-fill.amber { background:#b08400; }
.bt-prog-fill.low { background:#c02020; }
.bt-btn { display:inline-flex; align-items:center; gap:5px; padding:7px 14px; border-radius:7px; border:none; font-family:'Barlow',sans-serif; font-size:12px; font-weight:600; cursor:pointer; transition:all 0.15s; }
.bt-btn-primary { background:#224F93; color:#fff; }
.bt-btn-primary:hover { background:#1a3d7a; }
.bt-btn-secondary { background:#fff; color:#224F93; border:1.5px solid #224F93; }
.bt-btn-secondary:hover { background:#eef3fb; }
.bt-btn-danger { background:#fff; color:#c02020; border:1.5px solid #e08080; }
.bt-btn-danger:hover { background:#fdf0f0; }
.bt-btn-sm { padding:4px 10px; font-size:11px; border-radius:5px; }
.bt-alert { background:#fff8e1; border:1px solid #ffe082; border-radius:8px; padding:10px 14px; margin-bottom:14px; font-size:12px; color:#856404; display:flex; align-items:center; gap:8px; }
/* ─── FORM ─── */
.bt-form-section { background:#fff; border:1px solid var(--border,#dde3ee); border-radius:10px; margin-bottom:18px; }
.bt-form-section-title { padding:13px 18px; border-bottom:1px solid var(--border,#dde3ee); font-size:13px; font-weight:700; color:#224F93; display:flex; align-items:center; gap:7px; }
.bt-form-body { padding:18px; }
.bt-field-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
.bt-field { display:flex; flex-direction:column; gap:4px; }
.bt-field label { font-size:11px; font-weight:700; color:#445; text-transform:uppercase; letter-spacing:0.04em; }
.bt-field input,.bt-field select,.bt-field textarea { padding:7px 10px; border:1.5px solid #dde3ee; border-radius:7px; font-family:'Barlow',sans-serif; font-size:13px; color:var(--text,#1a2a3a); outline:none; transition:border-color 0.15s; background:#fff; }
.bt-field input:focus,.bt-field select:focus,.bt-field textarea:focus { border-color:#224F93; }
.bt-field input[readonly] { background:#f7f9fc; cursor:default; }
.bt-calc-display { background:#eef3fb; border-color:#c4d3ee; font-weight:700; color:#224F93; }
.bt-item-row { position:relative; background:#f7f9fc; border:1px solid #dde3ee; border-radius:8px; padding:12px 14px; margin-bottom:8px; display:grid; grid-template-columns:repeat(auto-fill,minmax(160px,1fr)); gap:10px; align-items:start; }
.bt-item-row .bt-remove { position:absolute; top:8px; right:8px; background:none; border:none; color:#c02020; cursor:pointer; font-size:16px; line-height:1; padding:0 3px; }
.bt-item-row .bt-remove:hover { color:#900; }
.bt-add-btn { background:#eef3fb; border:1.5px dashed #224F93; color:#224F93; border-radius:7px; padding:7px 14px; font-family:'Barlow',sans-serif; font-size:12px; font-weight:600; cursor:pointer; width:100%; margin-top:4px; }
.bt-add-btn:hover { background:#dde7f5; }
.bt-submit-btn { background:#224F93; color:#fff; border:none; border-radius:8px; padding:10px 24px; font-family:'Barlow',sans-serif; font-size:13px; font-weight:700; cursor:pointer; }
.bt-submit-btn:hover { background:#1a3d7a; }
/* ─── AFFECTATION ─── */
.bt-aff-wrap { overflow:auto; max-height:calc(100vh - 250px); border:1px solid var(--border,#dde3ee); border-radius:10px; }
.bt-aff-table { border-collapse:separate; border-spacing:0; font-size:12px; min-width:1400px; width:100%; }
.bt-aff-table th { background:#224F93; color:#fff; padding:9px 8px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; white-space:nowrap; position:sticky; top:0; z-index:2; }
.bt-aff-table td { padding:7px 8px; border-bottom:1px solid #f0f2f5; vertical-align:middle; }
.bt-aff-table tbody tr:hover td { background:#f7f9fc; }
.bt-aff-table .sticky-col { position:sticky; left:0; background:#f0f4f9; z-index:1; font-weight:600; font-size:11px; color:#445; min-width:36px; text-align:center; }
.bt-aff-table .sticky-col-2 { position:sticky; left:80px; background:#fff; z-index:1; min-width:200px; font-weight:600; }
.bt-aff-cell { cursor:pointer; display:block; border-radius:4px; padding:1px 3px; }
.bt-aff-cell:hover { background:#dde7f5; }
.bt-aff-cell input { width:100%; border:1.5px solid #224F93; border-radius:4px; padding:3px 6px; font-family:'Barlow',sans-serif; font-size:12px; outline:none; }
.bt-mini-prog { display:flex; align-items:center; gap:5px; }
.bt-mini-prog .bar { flex:1; height:5px; background:#e0e6ef; border-radius:3px; min-width:40px; }
.bt-mini-prog .fill { height:100%; border-radius:3px; background:#224F93; }
.bt-mini-prog .fill.full { background:#1a9458; }
.bt-mini-prog .fill.low { background:#c02020; }
.bt-mini-prog .pct { font-size:10px; font-weight:700; color:#445; white-space:nowrap; }
.bt-del-btn { background:none; border:none; color:#c02020; cursor:pointer; font-size:14px; padding:2px 5px; }
.bt-del-btn:hover { background:#fdf0f0; border-radius:4px; }
.bt-filters { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
.bt-filters input,.bt-filters select { padding:6px 10px; border:1.5px solid #dde3ee; border-radius:7px; font-family:'Barlow',sans-serif; font-size:12px; color:var(--text,#1a2a3a); outline:none; background:#fff; }
.bt-filters input:focus,.bt-filters select:focus { border-color:#224F93; }
.bt-tot-row td { background:#f0f4f9 !important; font-weight:700; border-top:2px solid #224F93; }
/* ─── History ─── */
.bt-hist-row { padding:10px 14px; border-bottom:1px solid #f0f2f5; display:grid; grid-template-columns:140px 120px 90px 90px 160px 100px 1fr 1fr; gap:8px; align-items:center; font-size:12px; }
.bt-hist-row:hover { background:#f7f9fc; }
/* ─── Modal ─── */
.bt-modal-backdrop { position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:9000; display:flex; align-items:center; justify-content:center; padding:20px; }
.bt-modal { background:#fff; border-radius:12px; max-width:780px; width:100%; max-height:85vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,0.2); }
.bt-modal-header { padding:16px 22px; border-bottom:1px solid #dde3ee; display:flex; align-items:center; justify-content:space-between; position:sticky; top:0; background:#fff; z-index:1; }
.bt-modal-header h3 { font-size:15px; font-weight:700; color:#224F93; }
.bt-modal-close { background:none; border:none; font-size:20px; cursor:pointer; color:#8099b0; padding:0 4px; }
.bt-modal-body { padding:22px; }
`;
  document.head.appendChild(style);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HISTORY
// ═══════════════════════════════════════════════════════════════════════════════
async function _btLogHistory(action, tableName, recordId, recordLabel, fieldName, oldVal, newVal) {
  const db = _btSb();
  if (!db) return;
  try {
    await db.from('bt_history').insert({
      user_name: _btUser(), action, table_name: tableName,
      record_id: recordId, record_label: recordLabel,
      field_name: fieldName, old_value: oldVal ? String(oldVal) : null,
      new_value: newVal ? String(newVal) : null
    });
  } catch(e) { console.warn('[BT] history log failed', e); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// REPORTS — load / save
// ═══════════════════════════════════════════════════════════════════════════════
async function _btLoadReports() {
  const db = _btSb();
  if (!db) return;
  try {
    const { data } = await db.from('bt_reports').select('*').order('created_at', { ascending: false });
    _btReports = (data || []).map(r => typeof r.data === 'string' ? JSON.parse(r.data) : r.data).filter(Boolean);
    // Migration: ensure required arrays exist
    _btReports.forEach(r => {
      if (!r.demandesBET) r.demandesBET = [];
      if (!r.ofs) r.ofs = [];
      if (!r.demandes) r.demandes = [];
      if (!r.blocages) r.blocages = [];
    });
    if (_btReports.length === 0) {
      _btReports = BT_REPORTS_SEED.map(r => ({...r}));
      await _btSaveReports(_btReports);
    }
  } catch(e) { console.warn('[BT] loadReports failed', e); }
}

async function _btSaveReport(report) {
  const db = _btSb();
  if (!db) return;
  try {
    await db.from('bt_reports').upsert({ id: report.id, data: report, created_by: _btUser() }, { onConflict: 'id' });
  } catch(e) { console.warn('[BT] saveReport failed', e); }
}

async function _btSaveReports(list) {
  const db = _btSb();
  if (!db) return;
  try {
    for (const r of list) {
      await db.from('bt_reports').upsert({ id: r.id, data: r, created_by: _btUser() }, { onConflict: 'id' });
    }
  } catch(e) { console.warn('[BT] saveReports failed', e); }
}

async function _btDeleteReport(id) {
  const db = _btSb();
  if (!db) return;
  try { await db.from('bt_reports').delete().eq('id', id); } catch(e) {}
}

// ═══════════════════════════════════════════════════════════════════════════════
// AFFECTATION — load / save
// ═══════════════════════════════════════════════════════════════════════════════
async function _btLoadAffectation() {
  const db = _btSb();
  if (!db) return;
  try {
    const { data } = await db.from('bt_affectation').select('*').order('num_ligne', { ascending: true });
    if (data && data.length > 0) {
      _btAffectation = data.map(r => ({
        id: r.id,
        numLigne: r.num_ligne || '',
        numAff: r.num_aff || '',
        projet: r.projet || '',
        directeurProjet: r.directeur_projet || '',
        chefProjet: r.chef_projet || '',
        chefChantier: r.chef_chantier || '',
        effectif: r.effectif || '',
        dateDebut: r.date_debut || '',
        dateFin: r.date_fin || '',
        montantMarche: parseFloat(r.montant_marche) || 0,
        cumulAttache: parseFloat(r.cumul_attache) || 0,
        bet: r.bet || '',
        achat: r.achat || '',
        production: r.production || '',
        pose: r.pose || '',
        observations: r.observations || ''
      }));
    } else {
      _btAffectation = BT_AFFECTATION_SEED.map((p, i) => ({ id: 'aff-'+Date.now()+'-'+i, ...p }));
      await _btSaveAllAffectation();
    }
  } catch(e) {
    console.warn('[BT] loadAffectation failed', e);
    _btAffectation = [];
  }
}

async function _btSaveAllAffectation() {
  const db = _btSb();
  if (!db) return;
  try {
    for (const p of _btAffectation) {
      await db.from('bt_affectation').upsert({
        id: p.id, num_ligne: p.numLigne||'', num_aff: p.numAff||'',
        projet: p.projet||'', directeur_projet: p.directeurProjet||'',
        chef_projet: p.chefProjet||'', chef_chantier: p.chefChantier||'',
        effectif: p.effectif||'', date_debut: p.dateDebut||'', date_fin: p.dateFin||'',
        montant_marche: parseFloat(p.montantMarche)||0,
        cumul_attache: parseFloat(p.cumulAttache)||0,
        bet: p.bet||'', achat: p.achat||'', production: p.production||'',
        pose: p.pose||'', observations: p.observations||'',
        updated_at: new Date().toISOString(), updated_by: _btUser()
      }, { onConflict: 'id' });
    }
  } catch(e) { console.warn('[BT] saveAllAffectation failed', e); }
}

async function _btSaveAffRow(p, oldVal, newField, newVal) {
  const db = _btSb();
  if (!db) return;
  try {
    await db.from('bt_affectation').upsert({
      id: p.id, num_ligne: p.numLigne||'', num_aff: p.numAff||'',
      projet: p.projet||'', directeur_projet: p.directeurProjet||'',
      chef_projet: p.chefProjet||'', chef_chantier: p.chefChantier||'',
      effectif: p.effectif||'', date_debut: p.dateDebut||'', date_fin: p.dateFin||'',
      montant_marche: parseFloat(p.montantMarche)||0,
      cumul_attache: parseFloat(p.cumulAttache)||0,
      bet: p.bet||'', achat: p.achat||'', production: p.production||'',
      pose: p.pose||'', observations: p.observations||'',
      updated_at: new Date().toISOString(), updated_by: _btUser()
    }, { onConflict: 'id' });
    if (newField) {
      _btLogHistory('UPDATE', 'bt_affectation', p.id, p.projet, newField, oldVal, newVal);
    }
  } catch(e) { console.warn('[BT] saveAffRow failed', e); }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUIVI TRAVAUX — render & init
// ═══════════════════════════════════════════════════════════════════════════════
window.btInitTravaux = async function() {
  _btInjectCss();
  const wrap = document.getElementById('proj-view-travaux');
  if (!wrap) return;
  wrap.innerHTML = `<div class="bt-page" style="display:flex;flex-direction:column;height:100%;">
    <div class="bt-header">
      <div class="bt-header-left">
        <span class="bt-header-icon">🔧</span>
        <div>
          <div class="bt-header-title">Suivi Travaux</div>
          <div class="bt-header-sub">Reporting hebdomadaire · OFs · Blocages</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="bt-btn bt-btn-secondary bt-btn-sm" onclick="btTravauxSubTab('form')">+ Nouveau rapport</button>
        <button class="bt-btn bt-btn-secondary bt-btn-sm" onclick="_btRefreshTravaux()">↻ Actualiser</button>
      </div>
    </div>
    <div class="bt-sub-nav">
      <button class="bt-sub-tab active" id="bt-stab-dashboard" onclick="btTravauxSubTab('dashboard')">Dashboard</button>
      <button class="bt-sub-tab" id="bt-stab-form" onclick="btTravauxSubTab('form')">Formulaire</button>
      <button class="bt-sub-tab" id="bt-stab-reports" onclick="btTravauxSubTab('reports')">Rapports</button>
      <button class="bt-sub-tab" id="bt-stab-of" onclick="btTravauxSubTab('of')">OF Tracker</button>
    </div>
    <div id="bt-travaux-body" style="flex:1;overflow-y:auto;padding:20px 24px;">
      <div style="text-align:center;padding:40px;color:var(--text3,#8099b0);">Chargement…</div>
    </div>
  </div>`;
  await _btLoadReports();
  _btTravauxSub = 'dashboard';
  _btRenderTravauxBody();
};

window._btRefreshTravaux = async function() {
  await _btLoadReports();
  _btRenderTravauxBody();
  _btToast('Actualisé ✓');
};

window.btTravauxSubTab = function(tab) {
  _btTravauxSub = tab;
  ['dashboard','form','reports','of'].forEach(t => {
    const el = document.getElementById('bt-stab-'+t);
    if (el) el.className = 'bt-sub-tab' + (t===tab ? ' active' : '');
  });
  _btRenderTravauxBody();
};

function _btRenderTravauxBody() {
  const body = document.getElementById('bt-travaux-body');
  if (!body) return;
  if (_btTravauxSub === 'dashboard') { _btRenderDashboard(body); return; }
  if (_btTravauxSub === 'form') { _btRenderForm(body); return; }
  if (_btTravauxSub === 'reports') { _btRenderReports(body); return; }
  if (_btTravauxSub === 'of') { _btRenderOfTracker(body); return; }
}

// ─── Dashboard ──────────────────────────────────────────────────────────────────
function _btGetLatest() {
  const map = new Map();
  _btReports.forEach(r => {
    if (!map.has(r.projet) || new Date(r.dateReporting) > new Date(map.get(r.projet).dateReporting)) {
      map.set(r.projet, r);
    }
  });
  return [...map.values()];
}

function _btRenderDashboard(body) {
  const latest = _btGetLatest();
  let ofAttente=0, ofCours=0, ofLivres=0, blocages=0, betAttente=0;
  let montantTotal=0, weightedAv=0, cumulAtt=0, cumulFact=0;
  latest.forEach(r => {
    (r.ofs||[]).forEach(o => {
      if (o.statut==='non-lance') ofAttente++;
      else if (o.statut==='cours') ofCours++;
      else if (o.statut==='livre') ofLivres++;
    });
    (r.demandesBET||[]).forEach(d => { betAttente += (d.statut==='attente'||d.statut==='cours') ? 1 : 0; });
    blocages += (r.blocages||[]).length;
    const mm = r.montantMarche||0;
    if (mm > 0) { weightedAv += (r.avancement||0)*mm; montantTotal += mm; }
    cumulAtt += r.cumulAttache||0;
    cumulFact += r.cumulFacture||0;
  });
  const avgAv = montantTotal > 0 ? weightedAv/montantTotal : 0;

  const alerts = [];
  if (ofAttente>0) alerts.push(`${ofAttente} OF en attente de lancement`);
  if (betAttente>0) alerts.push(`${betAttente} demande(s) BET sans réponse`);
  if (blocages>0) alerts.push(`${blocages} point(s) bloquant(s)`);

  body.innerHTML = `
    ${alerts.length ? `<div class="bt-alert">⚠️ ${alerts.join(' · ')}</div>` : ''}
    <div class="bt-kpi-row">
      <div class="bt-kpi"><div class="bt-kpi-val">${latest.length}</div><div class="bt-kpi-lbl">Projets actifs</div></div>
      <div class="bt-kpi amber"><div class="bt-kpi-val">${ofAttente}</div><div class="bt-kpi-lbl">OF à lancer</div></div>
      <div class="bt-kpi"><div class="bt-kpi-val">${ofCours}</div><div class="bt-kpi-lbl">OF en cours</div></div>
      <div class="bt-kpi green"><div class="bt-kpi-val">${ofLivres}</div><div class="bt-kpi-lbl">OF livrés</div></div>
      <div class="bt-kpi ${blocages>0?'red':''}"><div class="bt-kpi-val">${blocages}</div><div class="bt-kpi-lbl">Blocages</div></div>
      <div class="bt-kpi"><div class="bt-kpi-val">${avgAv.toFixed(1)}%</div><div class="bt-kpi-lbl">Avancement moy.</div></div>
      <div class="bt-kpi"><div class="bt-kpi-val" style="font-size:14px;">${_btFmtMoneyShort(cumulAtt)} MAD</div><div class="bt-kpi-lbl">Cumul attaché</div></div>
      <div class="bt-kpi"><div class="bt-kpi-val" style="font-size:14px;">${_btFmtMoneyShort(cumulFact)} MAD</div><div class="bt-kpi-lbl">Cumul facturé</div></div>
    </div>

    <div class="bt-card">
      <div class="bt-card-title">Projets — dernier reporting</div>
      <div class="bt-table-wrap">
        <table class="bt-table">
          <thead><tr>
            <th>Projet</th><th>Client</th><th>CP</th><th style="min-width:120px;">Avancement</th>
            <th>Facturation</th><th>OFs</th><th>Blocages</th><th>Date reporting</th>
          </tr></thead>
          <tbody>
            ${latest.length===0 ? `<tr><td colspan="8" style="text-align:center;padding:30px;color:#8099b0;">Aucun reporting — ajoutez un rapport via "Formulaire"</td></tr>` :
              latest.map(r => `<tr>
                <td><strong>${_btH(r.projet)}</strong>${r.lot?`<div style="font-size:10px;color:#8099b0;">${_btH(r.lot)}</div>`:''}</td>
                <td>${_btH(r.client||'—')}</td>
                <td>${_btH(r.cp||'—')}</td>
                <td><div class="bt-prog"><div class="bt-prog-bar"><div class="bt-prog-fill ${r.avancement>=80?'green':''}" style="width:${r.avancement||0}%"></div></div><span style="font-size:11px;font-weight:700;">${(r.avancement||0).toFixed(1)}%</span></div></td>
                <td>${(r.facturation||0).toFixed(1)}%</td>
                <td><strong>${(r.ofs||[]).length}</strong></td>
                <td>${(r.blocages||[]).length>0?`<span class="bt-badge bloque">${r.blocages.length}</span>`:'—'}</td>
                <td style="font-size:11px;">${_btFmtDate(r.dateReporting)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <div class="bt-card">
      <div class="bt-card-title">Tableau des attachements</div>
      <div class="bt-table-wrap">
        <table class="bt-table">
          <thead><tr>
            <th>Projet</th><th>Client</th><th>CP</th>
            <th style="text-align:right;">Montant marché</th>
            <th style="text-align:right;">Cumul attaché</th>
            <th style="text-align:right;">Cumul facturé</th>
            <th style="text-align:right;">Restant</th>
            <th style="min-width:100px;">% Av.</th>
            <th>% Fact/Att</th>
          </tr></thead>
          <tbody>
            ${latest.length===0 ? `<tr><td colspan="9" style="text-align:center;padding:30px;color:#8099b0;">Aucun rapport</td></tr>` :
              latest.map(r => {
                const reste = (r.montantMarche||0)-(r.cumulAttache||0);
                const pct = r.montantMarche>0 ? ((r.cumulAttache||0)/r.montantMarche*100) : 0;
                const pctFA = (r.cumulAttache||0)>0 ? ((r.cumulFacture||0)/(r.cumulAttache||0)*100) : 0;
                return `<tr>
                  <td><strong>${_btH(r.projet)}</strong></td>
                  <td>${_btH(r.client||'—')}</td><td>${_btH(r.cp||'—')}</td>
                  <td style="text-align:right;font-size:11px;">${_btFmtMoney(r.montantMarche)}</td>
                  <td style="text-align:right;font-size:11px;color:#224F93;font-weight:700;">${_btFmtMoney(r.cumulAttache)}</td>
                  <td style="text-align:right;font-size:11px;">${_btFmtMoney(r.cumulFacture)}</td>
                  <td style="text-align:right;font-size:11px;">${_btFmtMoney(reste)}</td>
                  <td><div class="bt-prog"><div class="bt-prog-bar"><div class="bt-prog-fill" style="width:${pct}%"></div></div><span style="font-size:10px;">${pct.toFixed(1)}%</span></div></td>
                  <td style="font-size:11px;font-weight:700;color:#b08400;">${(r.cumulAttache||0)>0?pctFA.toFixed(1)+'%':'—'}</td>
                </tr>`;
              }).join('')}
          </tbody>
          ${latest.length>1?`<tfoot><tr class="bt-tot-row">
            <td colspan="3" style="font-weight:700;">TOTAL</td>
            <td style="text-align:right;font-size:11px;">${_btFmtMoney(latest.reduce((s,r)=>s+(r.montantMarche||0),0))}</td>
            <td style="text-align:right;font-size:11px;color:#224F93;">${_btFmtMoney(latest.reduce((s,r)=>s+(r.cumulAttache||0),0))}</td>
            <td style="text-align:right;font-size:11px;">${_btFmtMoney(latest.reduce((s,r)=>s+(r.cumulFacture||0),0))}</td>
            <td colspan="3"></td>
          </tr></tfoot>`:''}
        </table>
      </div>
    </div>

    ${blocages>0 ? `<div class="bt-card">
      <div class="bt-card-title">Points bloquants</div>
      <div style="padding:14px 18px;">
        ${latest.flatMap(r=>(r.blocages||[]).map(b=>({proj:r.projet,desc:b.description}))).map(b=>`
          <div style="padding:10px 14px;background:#fdf0f0;border-left:3px solid #c02020;border-radius:4px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start;">
            <span style="color:#c02020;flex-shrink:0;">⛔</span>
            <div><div style="font-size:11px;font-weight:700;color:#c02020;margin-bottom:2px;">${_btH(b.proj)}</div><div style="font-size:12px;">${_btH(b.desc)}</div></div>
          </div>`).join('')}
      </div>
    </div>` : ''}
  `;
}

// ─── Form ────────────────────────────────────────────────────────────────────────
function _btRenderForm(body) {
  const currentCp = _btUser();
  const today = new Date().toISOString().slice(0,10);
  body.innerHTML = `
    <form id="bt-report-form" onsubmit="btSubmitReport(event)">
    <div class="bt-form-section">
      <div class="bt-form-section-title">📋 Informations générales</div>
      <div class="bt-form-body">
        <div class="bt-field-grid">
          <div class="bt-field"><label>Projet *</label><input name="projet" required placeholder="Nom du projet"></div>
          <div class="bt-field"><label>Client</label><input name="client" placeholder="Nom du client"></div>
          <div class="bt-field"><label>Lot</label><input name="lot" placeholder="Ex: Menuiserie Aluminium"></div>
          <div class="bt-field"><label>Chef de projet</label><input name="cp" value="${_btH(currentCp)}" readonly></div>
          <div class="bt-field"><label>Date reporting *</label><input type="date" name="dateReporting" value="${today}" required></div>
          <div class="bt-field"><label>Effectif</label><input type="number" name="effectif" min="0" placeholder="0"></div>
        </div>
      </div>
    </div>

    <div class="bt-form-section">
      <div class="bt-form-section-title">💰 Financier</div>
      <div class="bt-form-body">
        <div class="bt-field-grid">
          <div class="bt-field"><label>Montant marché HT (MAD)</label><input type="number" name="montantMarche" step="0.01" oninput="_btRecalc()" placeholder="0"></div>
          <div class="bt-field"><label>Cumul attachement (MAD)</label><input type="number" name="cumulAttache" step="0.01" oninput="_btRecalc()" placeholder="0"></div>
          <div class="bt-field"><label>Cumul facturé (MAD)</label><input type="number" name="cumulFacture" step="0.01" oninput="_btRecalc()" placeholder="0"></div>
          <div class="bt-field"><label>% Avancement (auto)</label><input readonly id="bt-av-display" class="bt-calc-display" value="0.00 %"></div>
          <div class="bt-field"><label>% Facturation/Marché (auto)</label><input readonly id="bt-fact-display" class="bt-calc-display" value="0.00 %"></div>
          <div class="bt-field"><label>% Fact/Att (auto)</label><input readonly id="bt-factatt-display" class="bt-calc-display" value="0.00 %"></div>
        </div>
      </div>
    </div>

    <div class="bt-form-section">
      <div class="bt-form-section-title">🏗️ OFs en production</div>
      <div class="bt-form-body">
        <div id="bt-of-list"></div>
        <button type="button" class="bt-add-btn" onclick="_btAddOF()">+ Ajouter un OF</button>
        <div id="bt-of-livres-preview" style="margin-top:10px;"></div>
      </div>
    </div>

    <div class="bt-form-section">
      <div class="bt-form-section-title">📝 Travaux</div>
      <div class="bt-form-body">
        <div class="bt-field-grid" style="grid-template-columns:1fr 1fr;">
          <div class="bt-field"><label>Travaux réalisés cette semaine</label><textarea name="travauxRealises" rows="4" placeholder="Décrire les travaux effectués…"></textarea></div>
          <div class="bt-field"><label>Travaux prévus semaine prochaine</label><textarea name="travauxPrevus" rows="4" placeholder="Décrire les travaux planifiés…"></textarea></div>
        </div>
      </div>
    </div>

    <div class="bt-form-section">
      <div class="bt-form-section-title">⛔ Points bloquants</div>
      <div class="bt-form-body">
        <div id="bt-blocage-list"></div>
        <button type="button" class="bt-add-btn" onclick="_btAddBlocage()">+ Ajouter un blocage</button>
      </div>
    </div>

    <div class="bt-form-section">
      <div class="bt-form-section-title">📬 Demandes OF / BCP</div>
      <div class="bt-form-body">
        <div id="bt-demande-list"></div>
        <button type="button" class="bt-add-btn" onclick="_btAddDemande()">+ Ajouter une demande</button>
      </div>
    </div>

    <div style="display:flex;gap:10px;justify-content:flex-end;padding:8px 0 16px;">
      <button type="button" class="bt-btn bt-btn-secondary" onclick="btTravauxSubTab('dashboard')">Annuler</button>
      <button type="submit" class="bt-submit-btn">✓ Enregistrer le rapport</button>
    </div>
    </form>
  `;
}

window._btRecalc = function() {
  const mm = parseFloat(document.querySelector('[name="montantMarche"]')?.value)||0;
  const ca = parseFloat(document.querySelector('[name="cumulAttache"]')?.value)||0;
  const cf = parseFloat(document.querySelector('[name="cumulFacture"]')?.value)||0;
  const av = mm>0 ? Math.min(100,Math.max(0,ca/mm*100)) : 0;
  const factAtt = ca>0 ? Math.max(0,cf/ca*100) : 0;
  const fact = mm>0 ? Math.min(100,Math.max(0,cf/mm*100)) : 0;
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
  set('bt-av-display', av.toFixed(2)+' %');
  set('bt-fact-display', fact.toFixed(2)+' %');
  set('bt-factatt-display', factAtt.toFixed(2)+' %');
  _btRefreshOfLivresPreview();
};

window._btAddOF = function(data) {
  const list = document.getElementById('bt-of-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'bt-item-row';
  row.innerHTML = `
    <div class="bt-field"><label>N° OF *</label><input type="text" name="of-ref" placeholder="OF26-133"></div>
    <div class="bt-field"><label>Date livraison souhaitée</label><input type="date" name="of-date"></div>
    <div class="bt-field"><label>Avancement fab. (%)</label><input type="number" name="of-avancement" min="0" max="100" value="0"></div>
    <div class="bt-field"><label>Statut</label>
      <select name="of-statut" onchange="_btTogglePose(this)">
        <option value="non-lance">Non lancé</option><option value="cours">En cours</option>
        <option value="livre">Livré</option><option value="bloque">Bloqué</option>
      </select>
    </div>
    <div class="bt-field of-pose" style="display:none;"><label>% Pose chantier</label><input type="number" name="of-pose" min="0" max="100" value="0" oninput="_btRefreshOfLivresPreview()"></div>
    <div class="bt-field" style="grid-column:span 2;"><label>Commentaire</label><input type="text" name="of-commentaire" placeholder="Détail…" oninput="_btRefreshOfLivresPreview()"></div>
    <button type="button" class="bt-remove" onclick="this.closest('.bt-item-row').remove();_btRefreshOfLivresPreview()">×</button>
  `;
  list.appendChild(row);
  if (data) {
    row.querySelector('[name="of-ref"]').value = data.ref||'';
    row.querySelector('[name="of-date"]').value = data.dateLivraison||'';
    row.querySelector('[name="of-avancement"]').value = data.avancement||0;
    row.querySelector('[name="of-statut"]').value = data.statut||'non-lance';
    row.querySelector('[name="of-pose"]').value = data.posePct||0;
    row.querySelector('[name="of-commentaire"]').value = data.commentaire||'';
    _btTogglePose(row.querySelector('[name="of-statut"]'));
  }
};

window._btTogglePose = function(sel) {
  const poseEl = sel.closest('.bt-item-row')?.querySelector('.of-pose');
  if (poseEl) poseEl.style.display = sel.value==='livre' ? '' : 'none';
  _btRefreshOfLivresPreview();
};

window._btRefreshOfLivresPreview = function() {
  const preview = document.getElementById('bt-of-livres-preview');
  if (!preview) return;
  const livres = [];
  document.querySelectorAll('#bt-of-list .bt-item-row').forEach(row => {
    if (row.querySelector('[name="of-statut"]')?.value === 'livre') {
      livres.push({
        ref: row.querySelector('[name="of-ref"]')?.value||'(sans réf)',
        pose: row.querySelector('[name="of-pose"]')?.value||'0'
      });
    }
  });
  preview.innerHTML = livres.length===0 ? '' :
    `<div style="padding:10px 12px;background:#d4edda;border-left:3px solid #1a9458;border-radius:4px;font-size:12px;color:#155724;">
      <strong>${livres.length} OF livré(s)</strong>: ${livres.map(l=>`${_btH(l.ref)}${parseInt(l.pose)>0?' (pose '+l.pose+'%)':''}`).join(', ')}
    </div>`;
};

window._btAddBlocage = function(data) {
  const list = document.getElementById('bt-blocage-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'bt-item-row';
  row.innerHTML = `
    <div class="bt-field" style="grid-column:span 3;"><label>Description du blocage</label><textarea name="b-desc" rows="2" placeholder="Décrire le point bloquant…"></textarea></div>
    <button type="button" class="bt-remove" onclick="this.closest('.bt-item-row').remove()">×</button>
  `;
  list.appendChild(row);
  if (data) row.querySelector('[name="b-desc"]').value = data.description||'';
};

window._btAddDemande = function(data) {
  const list = document.getElementById('bt-demande-list');
  if (!list) return;
  const row = document.createElement('div');
  row.className = 'bt-item-row';
  row.innerHTML = `
    <div class="bt-field"><label>Type</label>
      <select name="d-type"><option>OF</option><option>BCP</option><option>Plans EXE</option><option>MAJ PLAN EXE</option><option>Suivi chantier</option></select>
    </div>
    <div class="bt-field"><label>N° OF associé</label><input type="text" name="d-numof" placeholder="OF26-133"></div>
    <div class="bt-field"><label>Nature produit</label>
      <select name="d-nature"><option>VR</option><option>CH</option><option>MR</option><option>HAB</option><option>GC</option><option>STR Métal</option><option>Autre</option></select>
    </div>
    <div class="bt-field"><label>Date demande</label><input type="date" name="d-date"></div>
    <div class="bt-field"><label>Statut</label>
      <select name="d-statut"><option value="attente">En attente</option><option value="cours">En cours</option><option value="valide">Validé</option><option value="bloque">Bloqué</option></select>
    </div>
    <button type="button" class="bt-remove" onclick="this.closest('.bt-item-row').remove()">×</button>
  `;
  list.appendChild(row);
  if (data) {
    row.querySelector('[name="d-type"]').value = data.type||'OF';
    row.querySelector('[name="d-numof"]').value = data.numOF||'';
    row.querySelector('[name="d-nature"]').value = data.nature||'VR';
    row.querySelector('[name="d-date"]').value = data.date||'';
    row.querySelector('[name="d-statut"]').value = data.statut||'attente';
  }
};

window.btSubmitReport = async function(e) {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const data = Object.fromEntries(fd.entries());
  const mm = parseFloat(data.montantMarche)||0;
  const ca = parseFloat(data.cumulAttache)||0;
  const cf = parseFloat(data.cumulFacture)||0;
  const avancement = mm>0 ? Math.min(100,Math.max(0,ca/mm*100)) : 0;
  const facturation = mm>0 ? Math.min(100,Math.max(0,cf/mm*100)) : 0;
  const pctFactAtt = ca>0 ? Math.max(0,cf/ca*100) : 0;

  const ofs = [...document.querySelectorAll('#bt-of-list .bt-item-row')].map(r => ({
    ref: r.querySelector('[name="of-ref"]')?.value||'',
    dateLivraison: r.querySelector('[name="of-date"]')?.value||'',
    avancement: parseFloat(r.querySelector('[name="of-avancement"]')?.value)||0,
    posePct: parseFloat(r.querySelector('[name="of-pose"]')?.value)||0,
    statut: r.querySelector('[name="of-statut"]')?.value||'non-lance',
    commentaire: r.querySelector('[name="of-commentaire"]')?.value||''
  }));
  const blocages = [...document.querySelectorAll('#bt-blocage-list .bt-item-row')]
    .map(r => ({ description: r.querySelector('[name="b-desc"]')?.value||'' }))
    .filter(b => b.description.trim());
  const demandes = [...document.querySelectorAll('#bt-demande-list .bt-item-row')].map(r => ({
    type: r.querySelector('[name="d-type"]')?.value||'OF',
    numOF: r.querySelector('[name="d-numof"]')?.value||'',
    nature: r.querySelector('[name="d-nature"]')?.value||'',
    date: r.querySelector('[name="d-date"]')?.value||'',
    statut: r.querySelector('[name="d-statut"]')?.value||'attente'
  }));

  const report = {
    id: 'r-'+Date.now(),
    createdAt: new Date().toISOString(),
    projet: data.projet, client: data.client, lot: data.lot, cp: data.cp,
    dateReporting: data.dateReporting, effectif: parseInt(data.effectif)||0,
    montantMarche: mm, cumulAttache: ca, cumulFacture: cf,
    avancement, facturation, pctFactAtt,
    travauxRealises: data.travauxRealises||'',
    travauxPrevus: data.travauxPrevus||'',
    ofs, blocages, demandes, demandesBET: []
  };

  _btReports.unshift(report);
  await _btSaveReport(report);
  await _btLogHistory('CREATE','bt_reports',report.id,report.projet,null,null,null);
  _btToast('Rapport enregistré ✓');
  _btTravauxSub = 'dashboard';
  document.getElementById('bt-stab-dashboard').classList.add('active');
  document.getElementById('bt-stab-form').classList.remove('active');
  const body = document.getElementById('bt-travaux-body');
  if (body) _btRenderDashboard(body);
};

// ─── Reports list ───────────────────────────────────────────────────────────────
function _btRenderReports(body) {
  body.innerHTML = `
    <div class="bt-filters">
      <input id="bt-rep-search" placeholder="Rechercher projet, CP…" oninput="_btFilterReports()" style="min-width:200px;">
      <select id="bt-rep-filter-proj" onchange="_btFilterReports()"><option value="">Tous les projets</option>
        ${[...new Set(_btReports.map(r=>r.projet))].sort().map(p=>`<option value="${_btA(p)}">${_btH(p)}</option>`).join('')}
      </select>
    </div>
    <div class="bt-card">
      <div class="bt-card-title">Tous les rapports (${_btReports.length})</div>
      <div class="bt-table-wrap">
        <table class="bt-table" id="bt-rep-table">
          <thead><tr>
            <th>Projet</th><th>Client</th><th>CP</th><th>Date</th>
            <th style="text-align:right;">Marché HT</th>
            <th style="text-align:right;">Attaché</th>
            <th>Avancement</th><th>OFs</th><th>Blocages</th><th></th>
          </tr></thead>
          <tbody id="bt-rep-tbody"></tbody>
        </table>
      </div>
    </div>
  `;
  _btFilterReports();
}

window._btFilterReports = function() {
  const search = (document.getElementById('bt-rep-search')?.value||'').toLowerCase().trim();
  const projFilter = document.getElementById('bt-rep-filter-proj')?.value||'';
  const filtered = _btReports.filter(r => {
    if (projFilter && r.projet !== projFilter) return false;
    if (search) {
      const blob = [r.projet, r.client, r.cp, r.lot].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });
  const tbody = document.getElementById('bt-rep-tbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.length===0 ? `<tr><td colspan="10" style="text-align:center;padding:30px;color:#8099b0;">Aucun rapport</td></tr>` :
    filtered.map(r => `<tr>
      <td><strong>${_btH(r.projet)}</strong>${r.lot?`<div style="font-size:10px;color:#8099b0;">${_btH(r.lot)}</div>`:''}</td>
      <td>${_btH(r.client||'—')}</td><td>${_btH(r.cp||'—')}</td>
      <td style="font-size:11px;">${_btFmtDate(r.dateReporting)}</td>
      <td style="text-align:right;font-size:11px;">${_btFmtMoney(r.montantMarche)}</td>
      <td style="text-align:right;font-size:11px;color:#224F93;font-weight:700;">${_btFmtMoney(r.cumulAttache)}</td>
      <td><div class="bt-prog"><div class="bt-prog-bar"><div class="bt-prog-fill ${(r.avancement||0)>=80?'green':''}" style="width:${r.avancement||0}%"></div></div><span style="font-size:11px;">${(r.avancement||0).toFixed(1)}%</span></div></td>
      <td><strong>${(r.ofs||[]).length}</strong></td>
      <td>${(r.blocages||[]).length>0?`<span class="bt-badge bloque">${r.blocages.length}</span>`:'—'}</td>
      <td style="display:flex;gap:5px;">
        <button class="bt-btn bt-btn-secondary bt-btn-sm" onclick="_btOpenReportModal('${r.id}')">Voir</button>
        <button class="bt-btn bt-btn-danger bt-btn-sm" onclick="_btDeleteReportConfirm('${r.id}')">×</button>
      </td>
    </tr>`).join('');
};

window._btDeleteReportConfirm = async function(id) {
  const r = _btReports.find(x=>x.id===id);
  if (!r) return;
  if (!confirm(`Supprimer le rapport "${r.projet}" du ${_btFmtDate(r.dateReporting)} ?`)) return;
  _btReports = _btReports.filter(x=>x.id!==id);
  await _btDeleteReport(id);
  _btToast('Rapport supprimé');
  const body = document.getElementById('bt-travaux-body');
  if (body) _btRenderReports(body);
};

window._btOpenReportModal = function(id) {
  const r = _btReports.find(x=>x.id===id);
  if (!r) return;
  const backdrop = document.createElement('div');
  backdrop.className = 'bt-modal-backdrop';
  backdrop.onclick = (e)=>{ if(e.target===backdrop) backdrop.remove(); };
  backdrop.innerHTML = `
    <div class="bt-modal">
      <div class="bt-modal-header">
        <h3>${_btH(r.projet)} — ${_btFmtDate(r.dateReporting)}</h3>
        <button class="bt-modal-close" onclick="this.closest('.bt-modal-backdrop').remove()">×</button>
      </div>
      <div class="bt-modal-body">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px;">
          <div class="bt-kpi"><div class="bt-kpi-val">${(r.avancement||0).toFixed(1)}%</div><div class="bt-kpi-lbl">Avancement</div></div>
          <div class="bt-kpi"><div class="bt-kpi-val" style="font-size:14px;">${_btFmtMoneyShort(r.cumulAttache)} MAD</div><div class="bt-kpi-lbl">Cumul attaché</div></div>
          <div class="bt-kpi"><div class="bt-kpi-val">${r.effectif||0}</div><div class="bt-kpi-lbl">Effectif</div></div>
        </div>
        ${r.travauxRealises?`<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;color:#445;text-transform:uppercase;margin-bottom:5px;">Travaux réalisés</div><div style="background:#f7f9fc;border-radius:7px;padding:10px 12px;font-size:12px;white-space:pre-line;">${_btH(r.travauxRealises)}</div></div>`:''}
        ${r.travauxPrevus?`<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;color:#445;text-transform:uppercase;margin-bottom:5px;">Travaux prévus</div><div style="background:#f7f9fc;border-radius:7px;padding:10px 12px;font-size:12px;white-space:pre-line;">${_btH(r.travauxPrevus)}</div></div>`:''}
        ${(r.ofs||[]).length?`<div style="margin-bottom:14px;"><div style="font-size:11px;font-weight:700;color:#445;text-transform:uppercase;margin-bottom:5px;">OFs (${r.ofs.length})</div>
          <table class="bt-table"><thead><tr><th>N° OF</th><th>Statut</th><th>Avancement fab.</th><th>% Pose</th><th>Commentaire</th></tr></thead><tbody>
          ${r.ofs.map(o=>`<tr><td><strong>${_btH(o.ref||'—')}</strong></td><td><span class="bt-badge ${o.statut}">${_btStatLabel(o.statut)}</span></td><td>${o.avancement}%</td><td>${o.statut==='livre'?(o.posePct||0)+'%':'—'}</td><td>${_btH(o.commentaire||'—')}</td></tr>`).join('')}
          </tbody></table></div>`:''}
        ${(r.blocages||[]).length?`<div><div style="font-size:11px;font-weight:700;color:#c02020;text-transform:uppercase;margin-bottom:5px;">Blocages (${r.blocages.length})</div>
          ${r.blocages.map(b=>`<div style="padding:8px 12px;background:#fdf0f0;border-left:3px solid #c02020;border-radius:4px;margin-bottom:5px;font-size:12px;">⛔ ${_btH(b.description)}</div>`).join('')}
        </div>`:''}
      </div>
    </div>
  `;
  document.body.appendChild(backdrop);
};

// ─── OF Tracker ─────────────────────────────────────────────────────────────────
function _btRenderOfTracker(body) {
  const latest = _btGetLatest();
  const allOfs = [];
  latest.forEach(r => (r.ofs||[]).forEach(o => allOfs.push({...o, projet:r.projet, cp:r.cp})));
  const projects = [...new Set(allOfs.map(o=>o.projet))].sort();

  body.innerHTML = `
    <div class="bt-kpi-row">
      <div class="bt-kpi amber"><div class="bt-kpi-val">${allOfs.filter(o=>o.statut==='non-lance').length}</div><div class="bt-kpi-lbl">Non lancés</div></div>
      <div class="bt-kpi"><div class="bt-kpi-val">${allOfs.filter(o=>o.statut==='cours').length}</div><div class="bt-kpi-lbl">En cours</div></div>
      <div class="bt-kpi green"><div class="bt-kpi-val">${allOfs.filter(o=>o.statut==='livre').length}</div><div class="bt-kpi-lbl">Livrés</div></div>
      <div class="bt-kpi red"><div class="bt-kpi-val">${allOfs.filter(o=>o.statut==='bloque').length}</div><div class="bt-kpi-lbl">Bloqués</div></div>
    </div>
    <div class="bt-filters">
      <select id="bt-of-filter-status" onchange="_btFilterOfs()">
        <option value="">Tous statuts</option>
        <option value="non-lance">Non lancé</option><option value="cours">En cours</option>
        <option value="livre">Livré</option><option value="bloque">Bloqué</option>
      </select>
      <select id="bt-of-filter-proj" onchange="_btFilterOfs()">
        <option value="">Tous projets</option>
        ${projects.map(p=>`<option value="${_btA(p)}">${_btH(p)}</option>`).join('')}
      </select>
    </div>
    <div class="bt-card">
      <div class="bt-card-title">Suivi des OFs</div>
      <div class="bt-table-wrap">
        <table class="bt-table" id="bt-of-table">
          <thead><tr><th>N° OF</th><th>Projet</th><th>CP</th><th>Livraison</th><th style="min-width:100px;">Avancement fab.</th><th>% Pose</th><th>Statut</th><th>Commentaire</th></tr></thead>
          <tbody id="bt-of-tbody"></tbody>
        </table>
      </div>
    </div>
  `;
  window._btAllOfsCache = allOfs;
  _btFilterOfs();
}

window._btFilterOfs = function() {
  const allOfs = window._btAllOfsCache || [];
  const s = document.getElementById('bt-of-filter-status')?.value||'';
  const p = document.getElementById('bt-of-filter-proj')?.value||'';
  let filtered = allOfs;
  if (s) filtered = filtered.filter(o=>o.statut===s);
  if (p) filtered = filtered.filter(o=>o.projet===p);
  const order = {'non-lance':0,'bloque':1,'cours':2,'livre':3};
  filtered.sort((a,b)=>(order[a.statut]||9)-(order[b.statut]||9));
  const tbody = document.getElementById('bt-of-tbody');
  if (!tbody) return;
  tbody.innerHTML = filtered.length===0 ? `<tr><td colspan="8" style="text-align:center;padding:30px;color:#8099b0;">Aucun OF</td></tr>` :
    filtered.map(o => `<tr>
      <td><strong>${_btH(o.ref||'—')}</strong></td>
      <td>${_btH(o.projet)}</td><td>${_btH(o.cp||'—')}</td>
      <td style="font-size:11px;">${o.dateLivraison?_btFmtDate(o.dateLivraison):'—'}</td>
      <td><div class="bt-prog"><div class="bt-prog-bar"><div class="bt-prog-fill ${(o.avancement||0)>=80?'green':''}" style="width:${o.avancement||0}%"></div></div><span style="font-size:11px;">${o.avancement||0}%</span></div></td>
      <td>${o.statut==='livre'?`<div class="bt-prog"><div class="bt-prog-bar"><div class="bt-prog-fill ${(o.posePct||0)>=80?'green':'amber'}" style="width:${o.posePct||0}%"></div></div><span style="font-size:11px;">${o.posePct||0}%</span></div>`:'—'}</td>
      <td><span class="bt-badge ${o.statut}">${_btStatLabel(o.statut)}</span></td>
      <td style="font-size:11px;">${_btH(o.commentaire||'—')}</td>
    </tr>`).join('');
};

// ═══════════════════════════════════════════════════════════════════════════════
// AFFECTATION PROJET — render & init
// ═══════════════════════════════════════════════════════════════════════════════
window.btInitAffectation = async function() {
  _btInjectCss();
  const wrap = document.getElementById('proj-view-affectation');
  if (!wrap) return;
  wrap.innerHTML = `<div class="bt-page" style="display:flex;flex-direction:column;height:100%;">
    <div class="bt-header">
      <div class="bt-header-left">
        <span class="bt-header-icon">👥</span>
        <div>
          <div class="bt-header-title">Affectation Projet</div>
          <div class="bt-header-sub">Tableau de suivi d'affectation des projets</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="bt-btn bt-btn-primary bt-btn-sm" onclick="_btAddAffRow()">+ Ajouter</button>
        <button class="bt-btn bt-btn-secondary bt-btn-sm" onclick="_btExportAff()">↓ CSV</button>
        <button class="bt-btn bt-btn-secondary bt-btn-sm" onclick="_btRefreshAff()">↻ Actualiser</button>
      </div>
    </div>
    <div style="padding:14px 24px 0;background:#fff;border-bottom:1px solid var(--border,#dde3ee);">
      <div class="bt-kpi-row" id="bt-aff-kpis" style="margin-bottom:14px;"></div>
      <div class="bt-filters">
        <input id="bt-aff-search" placeholder="Rechercher projet, CP, chef chantier…" oninput="_btApplyAffFilters()" style="min-width:220px;">
        <select id="bt-aff-dir" onchange="_btApplyAffFilters()"><option value="">Tous directeurs</option></select>
        <select id="bt-aff-cp" onchange="_btApplyAffFilters()"><option value="">Tous CPs</option></select>
        <select id="bt-aff-cc" onchange="_btApplyAffFilters()"><option value="">Tous chefs chantier</option></select>
        <select id="bt-aff-av" onchange="_btApplyAffFilters()">
          <option value="">Tous avancements</option>
          <option value="0">Pas démarré (0%)</option>
          <option value="low">Faible (0–25%)</option>
          <option value="mid">Moyen (25–75%)</option>
          <option value="high">Avancé (75–100%)</option>
          <option value="done">Terminé (100%)</option>
        </select>
      </div>
    </div>
    <div style="flex:1;overflow:auto;padding:14px 24px;">
      <div class="bt-aff-wrap">
        <table class="bt-aff-table" id="bt-aff-table">
          <thead><tr>
            <th class="sticky-col">#</th>
            <th style="min-width:80px;">N° Aff</th>
            <th class="sticky-col-2" style="min-width:200px;">Projet</th>
            <th style="min-width:120px;">Directeur</th>
            <th style="min-width:120px;">Chef Projet</th>
            <th style="min-width:120px;">Chef Chantier</th>
            <th style="min-width:60px;">Effectif</th>
            <th style="min-width:100px;text-align:right;">Montant marché</th>
            <th style="min-width:100px;text-align:right;">Cumul attaché</th>
            <th style="min-width:120px;">Avancement</th>
            <th style="min-width:60px;">BET</th>
            <th style="min-width:60px;">Achat</th>
            <th style="min-width:80px;">Production</th>
            <th style="min-width:60px;">Pose</th>
            <th style="min-width:120px;">Observations</th>
            <th style="min-width:36px;"></th>
          </tr></thead>
          <tbody id="bt-aff-tbody"><tr><td colspan="16" style="text-align:center;padding:30px;color:#8099b0;">Chargement…</td></tr></tbody>
          <tfoot><tr class="bt-tot-row">
            <td colspan="7" id="bt-aff-tot-label" style="font-weight:700;text-align:right;">TOTAL</td>
            <td id="bt-aff-tot-marche" style="text-align:right;font-size:11px;"></td>
            <td id="bt-aff-tot-attache" style="text-align:right;font-size:11px;color:#224F93;"></td>
            <td id="bt-aff-tot-av" style="font-size:11px;font-weight:700;"></td>
            <td colspan="6"></td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  </div>`;
  await _btLoadAffectation();
  _btRenderAffectation();
};

window._btRefreshAff = async function() {
  await _btLoadAffectation();
  _btRenderAffectation();
  _btToast('Actualisé ✓');
};

function _btRenderAffectation() {
  const dirs = [...new Set(_btAffectation.map(p=>p.directeurProjet).filter(v=>v&&v!=='VIDE'))].sort();
  const cps  = [...new Set(_btAffectation.map(p=>p.chefProjet).filter(v=>v&&v!=='VIDE'))].sort();
  const ccs  = [...new Set(_btAffectation.map(p=>p.chefChantier).filter(v=>v&&v!=='VIDE'))].sort();
  const fillSel = (id, items) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = sel.options[0].outerHTML + items.map(v=>`<option value="${_btA(v)}">${_btH(v)}</option>`).join('');
    sel.value = cur;
  };
  fillSel('bt-aff-dir', dirs);
  fillSel('bt-aff-cp', cps);
  fillSel('bt-aff-cc', ccs);
  _btApplyAffFilters();
}

window._btApplyAffFilters = function() {
  const search = (document.getElementById('bt-aff-search')?.value||'').toLowerCase().trim();
  const fDir = document.getElementById('bt-aff-dir')?.value||'';
  const fCp  = document.getElementById('bt-aff-cp')?.value||'';
  const fCc  = document.getElementById('bt-aff-cc')?.value||'';
  const fAv  = document.getElementById('bt-aff-av')?.value||'';

  let filtered = _btAffectation.filter(p => {
    if (fDir && p.directeurProjet !== fDir) return false;
    if (fCp  && p.chefProjet !== fCp) return false;
    if (fCc  && p.chefChantier !== fCc) return false;
    if (fAv) {
      const av = _btCalcAv(p);
      if (fAv==='0' && av!==0) return false;
      else if (fAv==='low' && (av===0||av>=25)) return false;
      else if (fAv==='mid' && (av<25||av>=75)) return false;
      else if (fAv==='high' && (av<75||av>=100)) return false;
      else if (fAv==='done' && av<100) return false;
    }
    if (search) {
      const blob = [p.projet,p.numAff,p.directeurProjet,p.chefProjet,p.chefChantier,p.numLigne].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  // KPIs
  let totMm=0, totCa=0, totW=0, done=0;
  filtered.forEach(p => {
    const mm=parseFloat(p.montantMarche)||0, ca=parseFloat(p.cumulAttache)||0;
    totMm+=mm; totCa+=ca; totW+=_btCalcAv(p)*mm;
    if (_btCalcAv(p)>=100) done++;
  });
  const avgAv = totMm>0 ? totW/totMm : 0;
  const kpis = document.getElementById('bt-aff-kpis');
  if (kpis) kpis.innerHTML = `
    <div class="bt-kpi"><div class="bt-kpi-val">${filtered.length}</div><div class="bt-kpi-lbl">Projets</div></div>
    <div class="bt-kpi"><div class="bt-kpi-val" style="font-size:14px;">${_btFmtMoneyShort(totMm)} MAD</div><div class="bt-kpi-lbl">Total marché</div></div>
    <div class="bt-kpi"><div class="bt-kpi-val" style="font-size:14px;color:#224F93;">${_btFmtMoneyShort(totCa)} MAD</div><div class="bt-kpi-lbl">Total attaché</div></div>
    <div class="bt-kpi"><div class="bt-kpi-val">${avgAv.toFixed(1)}%</div><div class="bt-kpi-lbl">Avancement moy.</div></div>
    <div class="bt-kpi green"><div class="bt-kpi-val">${done}</div><div class="bt-kpi-lbl">Terminés</div></div>
  `;

  _btRenderAffRows(filtered, totMm, totCa, avgAv);
};

function _btRenderAffRows(rows, totMm, totCa, avgAv) {
  const tbody = document.getElementById('bt-aff-tbody');
  if (!tbody) return;
  const isVide = v => !v || v==='VIDE';
  tbody.innerHTML = rows.length===0 ?
    `<tr><td colspan="16" style="text-align:center;padding:40px;color:#8099b0;font-style:italic;">Aucun projet ne correspond aux filtres</td></tr>` :
    rows.map((p, idx) => {
      const av = _btCalcAv(p);
      const avClass = av>=100?'full':(av<20?'low':'');
      return `<tr data-id="${p.id}">
        <td class="sticky-col">${p.numLigne||(idx+1)}</td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','numAff')">${_btH(p.numAff||'—')}</span></td>
        <td class="sticky-col-2"><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','projet')" style="font-weight:600;">${_btH(p.projet||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','directeurProjet')" ${isVide(p.directeurProjet)?'style="color:#8099b0;font-style:italic;"':''}>${_btH(p.directeurProjet||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','chefProjet')" ${isVide(p.chefProjet)?'style="color:#c02020;font-style:italic;"':''}>${_btH(p.chefProjet||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','chefChantier')" ${isVide(p.chefChantier)?'style="color:#c02020;font-style:italic;"':''}>${_btH(p.chefChantier||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','effectif','number')">${p.effectif||'—'}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','montantMarche','number')" style="display:block;text-align:right;">${p.montantMarche?_btFmtMoneyShort(p.montantMarche):'—'}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','cumulAttache','number')" style="display:block;text-align:right;color:#224F93;font-weight:600;">${p.cumulAttache?_btFmtMoneyShort(p.cumulAttache):'0'}</span></td>
        <td><div class="bt-mini-prog"><div class="bar"><div class="fill ${avClass}" style="width:${av}%"></div></div><span class="pct">${av.toFixed(1)}%</span></div></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','bet')">${_btH(p.bet||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','achat')">${_btH(p.achat||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','production')">${_btH(p.production||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','pose')">${_btH(p.pose||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','observations')">${_btH(p.observations||'—')}</span></td>
        <td><button class="bt-del-btn" onclick="_btDeleteAff('${p.id}')" title="Supprimer">×</button></td>
      </tr>`;
    }).join('');

  // Totals footer
  const totL = document.getElementById('bt-aff-tot-label');
  const totM = document.getElementById('bt-aff-tot-marche');
  const totA = document.getElementById('bt-aff-tot-attache');
  const totAv = document.getElementById('bt-aff-tot-av');
  if (totL) totL.textContent = `TOTAL (${rows.length})`;
  if (totM) totM.textContent = _btFmtMoney(totMm);
  if (totA) totA.textContent = _btFmtMoney(totCa);
  if (totAv) totAv.textContent = avgAv.toFixed(1)+'%';
}

window._btEditAffCell = function(cellSpan, projectId, field, type) {
  if (cellSpan.classList.contains('editing')) return;
  const project = _btAffectation.find(p=>p.id===projectId);
  if (!project) return;
  const oldHtml = cellSpan.innerHTML;
  const oldValue = project[field] !== undefined ? project[field] : '';
  cellSpan.classList.add('editing');
  let inp;
  if (type==='number') { inp = document.createElement('input'); inp.type='number'; inp.step='0.01'; inp.value=oldValue; }
  else { inp = document.createElement('input'); inp.type='text'; inp.value=oldValue; }
  cellSpan.innerHTML = ''; cellSpan.appendChild(inp);
  inp.focus(); if (inp.type==='text') inp.select();

  const commit = async () => {
    let newVal = inp.value;
    if (type==='number') newVal = parseFloat(newVal)||0;
    cellSpan.classList.remove('editing');
    if (String(newVal) === String(oldValue)) { cellSpan.innerHTML=oldHtml; return; }
    project[field] = newVal;
    await _btSaveAffRow(project, oldValue, field, newVal);
    _btApplyAffFilters();
    _btToast('Modifié ✓');
  };
  const cancel = () => { cellSpan.classList.remove('editing'); cellSpan.innerHTML=oldHtml; };
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', e => {
    if (e.key==='Enter') { e.preventDefault(); inp.blur(); }
    if (e.key==='Escape') cancel();
  });
};

window._btAddAffRow = async function() {
  const p = {
    id: 'aff-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),
    numLigne:'', numAff:'', projet:'Nouveau projet', directeurProjet:'',
    chefProjet:'', chefChantier:'', effectif:'', dateDebut:'', dateFin:'',
    montantMarche:0, cumulAttache:0, bet:'', achat:'', production:'', pose:'', observations:''
  };
  _btAffectation.unshift(p);
  await _btSaveAffRow(p, null, null, null);
  await _btLogHistory('CREATE','bt_affectation',p.id,p.projet,null,null,null);
  _btApplyAffFilters();
  _btToast('Projet ajouté en haut du tableau');
};

window._btDeleteAff = async function(id) {
  const p = _btAffectation.find(x=>x.id===id);
  if (!p || !confirm(`Supprimer le projet "${p.projet}" ?`)) return;
  _btAffectation = _btAffectation.filter(x=>x.id!==id);
  const db = _btSb();
  if (db) {
    await db.from('bt_affectation').delete().eq('id', id);
    await _btLogHistory('DELETE','bt_affectation',id,p.projet,null,null,null);
  }
  _btApplyAffFilters();
  _btToast('Projet supprimé');
};

window._btExportAff = function() {
  const headers = ['#','N° Aff','Projet','Directeur','Chef Projet','Chef Chantier','Effectif','Montant Marché HT','Cumul Attaché','% Avancement','BET','Achat','Production','Pose','Observations'];
  const rows = _btAffectation.map((p,i) => [
    p.numLigne||(i+1), p.numAff, p.projet, p.directeurProjet, p.chefProjet,
    p.chefChantier, p.effectif, p.montantMarche, p.cumulAttache,
    _btCalcAv(p).toFixed(2)+'%', p.bet, p.achat, p.production, p.pose, p.observations
  ]);
  const csv = [headers,...rows].map(r=>r.map(c=>{
    const s=(c==null)?'':String(c);
    return '"'+s.replace(/"/g,'""')+'"';
  }).join(';')).join('\n');
  const blob = new Blob(['﻿'+csv],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download='affectation_'+new Date().toISOString().slice(0,10)+'.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEED DATA
// ═══════════════════════════════════════════════════════════════════════════════
const BT_REPORTS_SEED = [
  { id:'r-twf-001', createdAt:'2026-05-08T08:00:00Z', projet:'TWF', client:'SEG', lot:'Menuiserie Aluminium', cp:'LARBI BOUKHRISS', dateReporting:'2026-05-08', effectif:6, montantMarche:11837241.0, cumulFacture:4973223.07, cumulAttache:4973223.07, avancement:42.01, facturation:42.01, pctFactAtt:100, demandes:[{type:'OF',numOF:'',nature:'VITRAGE GC',date:'2026-04-17',statut:'attente'},{type:'OF',numOF:'',nature:'PAROI DOUCHE',date:'2026-04-17',statut:'attente'}], demandesBET:[], ofs:[], travauxRealises:'POSE VR\nPOSE U GC\nPOSE HABILLAGE ISOLBOX', travauxPrevus:'POSE DORMANTS\nPOSE VR\nPOSE U GC', blocages:[{description:'RECEVOIR RELIQUAT MP SCHUCCO'}] },
  { id:'r-helices-t2-001', createdAt:'2026-05-08T08:00:00Z', projet:"LES HELICES D'ANFA T2", client:'OUCHTAR', lot:'Menuiserie Aluminium', cp:'LARBI BOUKHRISS', dateReporting:'2026-05-08', effectif:6, montantMarche:4162839.2, cumulFacture:2528367.43, cumulAttache:2528367.43, avancement:60.74, facturation:60.74, pctFactAtt:100, demandes:[], demandesBET:[], ofs:[{ref:'OF 26-156 CH ALU',dateLivraison:'',avancement:0,posePct:0,statut:'cours',commentaire:''}], travauxRealises:'POSE VR RDC\nPOSE CR TOUR 11', travauxPrevus:'POSE CR IMB 11 ET 3', blocages:[] },
  { id:'r-lot7-001', createdAt:'2026-05-15T08:00:00Z', projet:'Clinique LOT 7', client:'MAYDANE', lot:'Menuiserie', cp:'OUSSAMA', dateReporting:'2026-05-15', effectif:12, montantMarche:4959959.82, cumulFacture:4721238.89, cumulAttache:4721238.89, avancement:95.19, facturation:95.19, pctFactAtt:100, demandes:[], demandesBET:[], ofs:[{ref:'OF26-92/OF26-98',dateLivraison:'2026-05-18',avancement:0,posePct:0,statut:'non-lance',commentaire:'Attente compléments livraison'}], travauxRealises:'Pose Vitrage des châssis 3ème et 2ème étage', travauxPrevus:'Finition châssis 8ème étage', blocages:[{description:'Montage des Poignées OF26-48 (en urgence)'}] }
];

const BT_AFFECTATION_SEED = [
  {numLigne:'',numAff:'AF25-51',projet:'CHRIFIA - PARCELLE M2 - TR1 1 & 2',directeurProjet:'ANAS',chefProjet:'ANAS',chefChantier:'ABDELLAH',effectif:'3',dateDebut:'',dateFin:'',montantMarche:16500000.16,cumulAttache:30314.73,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF25-69',projet:'VILLAS TAGHAZOUT BAY',directeurProjet:'ANAS',chefProjet:'ANAS',chefChantier:'ABDELLAH',effectif:'1',dateDebut:'',dateFin:'',montantMarche:44622337.38,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'12',numAff:'AF25-31',projet:'SICOREP',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:705898.1,cumulAttache:54634.02,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'50',numAff:'AF25-4',projet:'VILLAS MENZEH TR2',directeurProjet:'ANAS',chefProjet:'SIHAM',chefChantier:'KOUIDER',effectif:'1',dateDebut:'',dateFin:'',montantMarche:2348312.7,cumulAttache:2014641.23,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'15',numAff:'AF25-59',projet:'RENAISSANCE-LOT35',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'VIDE',effectif:'4',dateDebut:'',dateFin:'',montantMarche:7359540.75,cumulAttache:299837.48,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'55',numAff:'AF25-70',projet:'IMMEUBLE KETTANI',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:1435098.0,cumulAttache:71754.9,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF26-5',projet:'RIAD ANDALOUS',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:23546312.56,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'37',numAff:'AF25-49',projet:'CABINETS MEDICAUX LOT 7.2',directeurProjet:'ANAS',chefProjet:'OUSSAMA',chefChantier:'ABDELHAK',effectif:'6',dateDebut:'',dateFin:'',montantMarche:4959959.82,cumulAttache:4721238.89,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF25-50',projet:'SIEGE CO COM',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:4000001.2,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'56',numAff:'AF25-39',projet:'DAMIA RADISSON HOTEL GC',directeurProjet:'ANAS',chefProjet:'OUSSAMA',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:282552.75,cumulAttache:282552.75,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'89',numAff:'AF25-63',projet:'Tour ANFA PARK',directeurProjet:'ANAS',chefProjet:'OUSSAMA',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:236238.69,cumulAttache:236238.69,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF25-60/61',projet:'TREMIE LOT1/LOT2',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'VIDE',effectif:'7',dateDebut:'',dateFin:'',montantMarche:4356000.0,cumulAttache:847000.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF26-8',projet:'VILLA SEKKAT MOHAMED',directeurProjet:'CHBIHI YOUSEF',chefProjet:'BENBATI',chefChantier:'BENOMAR MOHAMED',effectif:'',dateDebut:'',dateFin:'',montantMarche:58198.0,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'91',numAff:'AF25-62',projet:'CASA GREEN TOWN - PARCELLE 635',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:17489301.15,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF26-14',projet:'ABADI ADIL ARCHITECTE',directeurProjet:'CHBIHI YOUSEF',chefProjet:'CHEBIHI YOUSSEF',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:269364.0,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'8',numAff:'AF24-23',projet:"LES HELICES D'ANFA GC-TR.2",directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'ABDELHAK',effectif:'',dateDebut:'',dateFin:'',montantMarche:2682300.0,cumulAttache:1806392.3,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'86',numAff:'AF24-36',projet:'ANAE',directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'SABATY',effectif:'3',dateDebut:'',dateFin:'',montantMarche:4166666.67,cumulAttache:3928379.91,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'70',numAff:'AF24-50',projet:'VERDANA Men Alu+GC',directeurProjet:'ANAS',chefProjet:'EZZAHIA',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:7325011.0,cumulAttache:3813544.55,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'18',numAff:'AF25-41',projet:'CABO DEL RIO2',directeurProjet:'ANAS',chefProjet:'SIHAM',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:6090193.81,cumulAttache:691561.4,bet:'Fait',achat:'RAS',production:'FAB EN COURS',pose:'POSE EN COURS',observations:''},
  {numLigne:'',numAff:'AF26-10',projet:'GAIAPOLIS',directeurProjet:'RAID',chefProjet:'SIHAM',chefChantier:'SABATY',effectif:'',dateDebut:'',dateFin:'',montantMarche:14398562.11,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'44',numAff:'AF25-52',projet:'SHIFT TOWER',directeurProjet:'RAED',chefProjet:'SAFAA',chefChantier:'Outman',effectif:'9',dateDebut:'',dateFin:'',montantMarche:45000000.0,cumulAttache:7264234.99,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'6',numAff:'AF26-9',projet:'CASA ONE',directeurProjet:'RAED',chefProjet:'SAMY',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:63482025.41,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'9',numAff:'AF25-48',projet:'G3C VERIERE',directeurProjet:'VIDE',chefProjet:'SBYK',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:3393270.0,cumulAttache:2714616.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'66',numAff:'AF23-7',projet:'CURIO',directeurProjet:'VIDE',chefProjet:'SBYK',chefChantier:'SABATY',effectif:'',dateDebut:'',dateFin:'',montantMarche:9106055.97,cumulAttache:6538205.76,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'36',numAff:'AF23-35',projet:'HOTEL CANOPY',directeurProjet:'VIDE',chefProjet:'SBYK',chefChantier:'SABATY',effectif:'6',dateDebut:'',dateFin:'',montantMarche:22880390.92,cumulAttache:18042635.41,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'17',numAff:'AF24-30',projet:'BRANDED',directeurProjet:'VIDE',chefProjet:'SBYK',chefChantier:'SABATY',effectif:'9',dateDebut:'',dateFin:'',montantMarche:6808610.86,cumulAttache:6298891.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'69',numAff:'AF24-58',projet:'HUIM6',directeurProjet:'',chefProjet:'SBYK',chefChantier:'BAHLOUL',effectif:'2',dateDebut:'',dateFin:'',montantMarche:11839258.0,cumulAttache:11839258.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'51',numAff:'AF25-35',projet:'IFMS PERGOLA',directeurProjet:'',chefProjet:'SBYK',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:3004575.0,cumulAttache:3004575.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'60',numAff:'AF25-25',projet:'Les 3Golfs T5',directeurProjet:'ANAS',chefProjet:'SIHAM',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:7558827.22,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'16',numAff:'AF25-34',projet:'Les 3Golfs T6',directeurProjet:'ANAS',chefProjet:'SIHAM',chefChantier:'ABDELLAH',effectif:'8',dateDebut:'',dateFin:'',montantMarche:5500000.04,cumulAttache:2747309.52,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'75',numAff:'AF25-36',projet:'Villas BIANCA',directeurProjet:'ANAS',chefProjet:'SIHAM',chefChantier:'KOUIDER',effectif:'',dateDebut:'',dateFin:'',montantMarche:5120277.0,cumulAttache:370972.39,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'7',numAff:'AF24-21',projet:'Villa Othman Alaoui',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:672291.86,cumulAttache:672291.86,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'61',numAff:'AF24-40',projet:'Villa Kaaam',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:437083.44,cumulAttache:437083.44,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'64',numAff:'AF24-43',projet:'VILLA KAPSET',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:1034069.33,cumulAttache:1034069.33,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'35',numAff:'AF24-51',projet:'VILLA AMANA A BOUSKOURA',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:939115.0,cumulAttache:939115.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'24',numAff:'AF24-56',projet:'VILLA BOUGHALEB',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:731221.8,cumulAttache:731221.8,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'73',numAff:'AF24-9',projet:'Villa SH - ain diab',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:1027112.6,cumulAttache:1027112.6,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'23',numAff:'AF25-13',projet:'Villa Mme Loubna CHRAIBI',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:144600.0,cumulAttache:144600.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'65',numAff:'AF25-27',projet:'Villa S&Y - BIR JDID',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:480115.0,cumulAttache:480115.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'54',numAff:'AF25-33',projet:'Bureaux Maydane',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:92300.0,cumulAttache:92300.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'14',numAff:'AF24-60',projet:'VILLA MR RAHMOUNI HAMZA',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'ZOUINE',effectif:'2',dateDebut:'',dateFin:'',montantMarche:233722.13,cumulAttache:223951.86,bet:'Fait',achat:'',production:'',pose:'',observations:''},
  {numLigne:'88',numAff:'AF24-66',projet:'VILLA Siham OUAZANI',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:524211.55,cumulAttache:450873.73,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'28',numAff:'AF25-23',projet:'Villa Zineb BENIS',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:505454.25,cumulAttache:483107.7,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'40',numAff:'AF25-46',projet:'KEPAR DAKAR BLOC6',directeurProjet:'',chefProjet:'ANAS',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:2188772.0,cumulAttache:2188772.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'46',numAff:'AF25-18',projet:'EXTENSION AKDITAL MARRAKECH',directeurProjet:'',chefProjet:'',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:2634018.98,cumulAttache:2634018.98,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'',projet:'MOHAMED FASSI EL FIHRI',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'0',dateDebut:'',dateFin:'',montantMarche:80830.8,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''}
];
