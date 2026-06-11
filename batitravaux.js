// ═══════════════════════════════════════════════════════════════════════════════
// BATITRAVAUX.JS  —  Suivi Travaux + Affectation Projet integration for Batimon
// Tables (bt_ prefix): bt_reports · bt_affectation · bt_history
// Uses Batimon's window.sb client and window.sbProfile for auth
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Fixed dropdown lists ───────────────────────────────────────────────────────
const BT_DIRECTORS      = ['Raed','Anas','Nabil G','Youssef Chbihi'];
const BT_CHEF_PROJETS   = ['ANAS','BENBATI','CHEBIHI YOUSSEF','EZZAHIA','IMANE','KHADIJA','LARBI BKS','MEHDI BENMADANI','NABIL FT','OTMANE IMMA','OUSSAMA','SAAD','SAFAA','SAMY','SBYK','SIHAM'];
const BT_CHEF_CHANTIERS = ['ABDELHAK','ABDELLAH','BAHLOUL','BENOMAR MOHAMED','EL OUAFI','JEDDA','KOUIDER','MOUFADAL','OUTMAN','SABATY','ZOUINE'];

// ─── Runtime editable lists (persisted in Supabase, localStorage fallback) ──────
const _BT_CFG_PROJECT = '__bt__';
var _btRtDirs, _btRtCPs, _btRtCTs, _btRtCCs;
var _btRtChannel = null;

function _btSubscribeRtLists() {
  if (_btRtChannel) { try { _btSb().removeChannel(_btRtChannel); } catch(e){} _btRtChannel = null; }
  try {
    _btRtChannel = _btSb().channel('bt-rt-lists')
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'bt_config'
      }, payload => {
        const row = payload.new || {};
        if (!row.key || row.value == null) return;
        try {
          const arr = JSON.parse(row.value);
          if      (row.key === 'bt_rt_dirs') _btRtDirs = arr;
          else if (row.key === 'bt_rt_cps')  _btRtCPs  = arr;
          else if (row.key === 'bt_rt_cts')  _btRtCTs  = arr;
          else if (row.key === 'bt_rt_ccs')  _btRtCCs  = arr;
          else return;
          _btRenderAffectation();
        } catch(e) {}
      })
      .subscribe();
  } catch(e) { console.warn('[BT] realtime subscribe failed', e); }
}

async function _btLoadRtLists() {
  const keys = ['bt_rt_dirs','bt_rt_cps','bt_rt_cts','bt_rt_ccs'];
  const defs = {
    bt_rt_dirs: BT_DIRECTORS,
    bt_rt_cps:  BT_CHEF_PROJETS,
    bt_rt_cts:  [],
    bt_rt_ccs:  BT_CHEF_CHANTIERS,
  };
  function _fromLS(k, d) { try { var v=localStorage.getItem(k); return v?JSON.parse(v):d.slice(); } catch(e){ return d.slice(); } }
  try {
    const { data } = await _btSb().from('bt_config').select('key,value').in('key', keys);
    const map = {};
    (data||[]).forEach(r => { try { map[r.key] = JSON.parse(r.value); } catch(e) {} });
    // If bt_config has no rows yet, migrate from localStorage once
    if (!Object.keys(map).length) {
      const migrated = {};
      keys.forEach(k => { migrated[k] = _fromLS(k, defs[k]); });
      // Save all to bt_config so every user gets them
      await Promise.all(keys.map(k =>
        _btSb().from('bt_config').upsert(
          { key: k, value: JSON.stringify(migrated[k]), updated_at: new Date().toISOString() },
          { onConflict: 'key' }
        ).catch(()=>{})
      ));
      _btRtDirs = migrated['bt_rt_dirs'];
      _btRtCPs  = migrated['bt_rt_cps'];
      _btRtCTs  = migrated['bt_rt_cts'];
      _btRtCCs  = migrated['bt_rt_ccs'];
    } else {
      _btRtDirs = map['bt_rt_dirs'] || defs.bt_rt_dirs.slice();
      _btRtCPs  = map['bt_rt_cps']  || defs.bt_rt_cps.slice();
      _btRtCTs  = map['bt_rt_cts']  || defs.bt_rt_cts.slice();
      _btRtCCs  = map['bt_rt_ccs']  || defs.bt_rt_ccs.slice();
    }
  } catch(e) {
    // Fallback to localStorage if Supabase unreachable
    _btRtDirs = _fromLS('bt_rt_dirs', defs.bt_rt_dirs);
    _btRtCPs  = _fromLS('bt_rt_cps',  defs.bt_rt_cps);
    _btRtCTs  = _fromLS('bt_rt_cts',  defs.bt_rt_cts);
    _btRtCCs  = _fromLS('bt_rt_ccs',  defs.bt_rt_ccs);
  }
}

function _btSaveRtList(key, arr) {
  // Update in-memory immediately so UI re-renders with correct data right away
  if (key === 'bt_rt_dirs') _btRtDirs = arr;
  else if (key === 'bt_rt_cps') _btRtCPs = arr;
  else if (key === 'bt_rt_cts') _btRtCTs = arr;
  else if (key === 'bt_rt_ccs') _btRtCCs = arr;
  // Persist to bt_config table asynchronously
  (async () => {
    try {
      await _btSb().from('bt_config').upsert(
        { key, value: JSON.stringify(arr), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );
    } catch(e) {
      console.warn('[BT] saveRtList failed', e);
    }
  })();
}

// ─── Multi-value array helpers ──────────────────────────────────────────────────
// Normalise a stored value (string or JSON array) to a JS array
function _btNormArr(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (!v || v === 'VIDE') return [];
  try { var p = JSON.parse(v); if (Array.isArray(p)) return p.filter(Boolean); } catch(e) {}
  return v.trim() ? [v.trim()] : [];
}
// Serialise an array for storage: single item stays plain string (backward compat)
function _btArrStr(arr) {
  if (!arr || arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  return JSON.stringify(arr);
}
// Flat-join array or string to space-separated string (for search blobs)
function _btFlatArr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }

// Returns true when the logged-in user is the developer (username R1)
function _btIsDeveloper() {
  return (typeof sbProfile !== 'undefined' && sbProfile) &&
         (sbProfile.role === 'developer' || (sbProfile.username || '').toLowerCase() === 'r1');
}

// Returns the effective cumul attaché for an affectation row.
// Looks up the most recent bt_reports entry with matching numAff.
// Returns { value, linked } — linked=true when pulled from a report.
function _btLinkedCa(p) {
  if (p.numAff && _btReports.length > 0) {
    const match = _btReports
      .filter(r => r.numAff && r.numAff.trim() === p.numAff.trim())
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
    if (match) return { value: parseFloat(match.cumulAttache) || 0, linked: true };
  }
  return { value: parseFloat(p.cumulAttache) || 0, linked: false };
}

// ─── State ──────────────────────────────────────────────────────────────────────
let _btReports      = [];
let _btAffectation  = [];
let _btHistoryCache = [];
let _btTravauxSub   = 'dashboard';   // active sub-tab in Suivi Travaux
let _btPendingFiles = new Map();
let _btFileIdCtr    = 0;
let _btCssInjected  = false;
let _btAffSortField = null;          // active sort column
let _btAffSortDir   = 1;             // 1 = asc, -1 = desc
let _btLastAffRows  = [];            // last filtered+sorted rows (used by CSV export)

// ─── Current user ───────────────────────────────────────────────────────────────
function _btUser() {
  if (window.sbProfile) {
    return window.sbProfile.full_name || window.sbProfile.username || window.sbUser?.email || 'Anonyme';
  }
  return 'Anonyme';
}

// ─── Supabase shorthand ─────────────────────────────────────────────────────────
function _btSb() { return (typeof sb !== 'undefined') ? sb : window.sb; }

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
function _btFmtFull(n) {
  return new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}).format(parseFloat(n)||0);
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
.bt-aff-table td.sticky-col-2 { position:sticky; left:80px; background:#fff; z-index:1; min-width:200px; font-weight:600; color:#1a2a3a; }
.bt-aff-table th.sticky-col-2 { position:sticky; left:80px; background:#224F93; z-index:3; min-width:200px; }
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
.bt-aff-table th.bt-sortable { cursor:pointer; user-select:none; }
.bt-aff-table th.bt-sortable:hover { background:#1a3d7a; }
.bt-sort-ind { margin-left:4px; font-size:10px; opacity:0.45; }
.bt-aff-table th.bt-sort-active .bt-sort-ind { opacity:1; color:#7ecfff; }
.bt-aff-locked { cursor:default !important; color:#8099b0; }
.bt-aff-locked:hover { background:none !important; }
.bt-aff-linked-ca { cursor:default; border-radius:4px; padding:1px 3px; }
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
      if (r.numAff === undefined) r.numAff = '';
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
        client: r.client || '',
        directeurProjet: r.directeur_projet || '',
        chefProjet: _btNormArr(r.chef_projet || ''),
        chefChantier: _btNormArr(r.chef_chantier || ''),
        conducteurTravaux: _btNormArr(r.observations || ''),
        effectif: r.effectif || '',
        dateDebut: r.date_debut || '',
        dateFin: r.date_fin || '',
        montantMarche: parseFloat(r.montant_marche) || 0,
        cumulAttache: parseFloat(r.cumul_attache) || 0,
        bet: r.bet || '',
        achat: r.achat || '',
        production: r.production || '',
        pose: r.pose || '',
        observations: ''
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
        projet: p.projet||'', client: p.client||'', directeur_projet: p.directeurProjet||'',
        chef_projet: _btArrStr(p.chefProjet)||'', chef_chantier: _btArrStr(p.chefChantier)||'',
        effectif: p.effectif||'', date_debut: p.dateDebut||'', date_fin: p.dateFin||'',
        montant_marche: parseFloat(p.montantMarche)||0,
        cumul_attache: parseFloat(p.cumulAttache)||0,
        bet: p.bet||'', achat: p.achat||'', production: p.production||'',
        pose: p.pose||'', observations: _btArrStr(p.conducteurTravaux)||'',
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
      projet: p.projet||'', client: p.client||'', directeur_projet: p.directeurProjet||'',
      chef_projet: _btArrStr(p.chefProjet)||'', chef_chantier: _btArrStr(p.chefChantier)||'',
      effectif: p.effectif||'', date_debut: p.dateDebut||'', date_fin: p.dateFin||'',
      montant_marche: parseFloat(p.montantMarche)||0,
      cumul_attache: parseFloat(p.cumulAttache)||0,
      bet: p.bet||'', achat: p.achat||'', production: p.production||'',
      pose: p.pose||'', observations: _btArrStr(p.conducteurTravaux)||'',
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
          <div class="bt-field"><label>N° Affectation</label><input name="numAff" placeholder="Ex: AF25-49" style="font-family:monospace;"></div>
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
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
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
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
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
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
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
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
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
    projet: data.projet, numAff: (data.numAff||'').trim(),
    client: data.client, lot: data.lot, cp: data.cp,
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
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
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
        <button class="bt-btn bt-btn-sm" onclick="_btDeleteSelectedAff()" style="background:#c02020;color:#fff;border-color:#c02020;">🗑 Supprimer</button>
        <button class="bt-btn bt-btn-secondary bt-btn-sm" onclick="_btImportExcel()">↑ Import Excel</button>
        <button class="bt-btn bt-btn-secondary bt-btn-sm" onclick="_btExportAff()">↓ Export Excel</button>
      </div>
    </div>
    <div style="padding:14px 24px 0;background:#fff;border-bottom:1px solid var(--border,#dde3ee);">
      <div class="bt-kpi-row" id="bt-aff-kpis" style="margin-bottom:14px;"></div>
      <div id="bt-aff-dash-panel" style="display:none;margin-bottom:14px;"></div>
      <div id="bt-aff-mgr-panel" style="display:none;margin-bottom:14px;"></div>
      <div class="bt-filters">
        <input id="bt-aff-search" placeholder="Rechercher projet, CP, chef chantier…" oninput="_btApplyAffFilters()" style="min-width:220px;">
        <select id="bt-aff-dir" onchange="_btApplyAffFilters()"><option value="">Tous directeurs</option></select>
        <select id="bt-aff-cp" onchange="_btApplyAffFilters()"><option value="">Tous CPs</option></select>
        <select id="bt-aff-ct" onchange="_btApplyAffFilters()"><option value="">Tous conducteurs</option></select>
        <select id="bt-aff-cc" onchange="_btApplyAffFilters()"><option value="">Tous chefs chantier</option></select>
        <div id="bt-av-wrap" style="position:relative;">
          <button id="bt-av-btn" onclick="_btAvToggle(event)"
            style="padding:6px 10px;border:1px solid #dde3ee;border-radius:6px;background:#fff;color:#445;font-family:Barlow,sans-serif;font-size:12px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;min-width:150px;justify-content:space-between;">
            <span id="bt-av-label">Tous avancements</span><span style="opacity:.5;">▾</span>
          </button>
          <div id="bt-av-panel" style="display:none;position:absolute;top:calc(100% + 4px);left:0;background:#fff;border:1px solid #dde3ee;border-radius:8px;box-shadow:0 4px 16px rgba(34,79,147,0.12);z-index:500;min-width:180px;padding:6px 0;">
            <label style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-family:Barlow,sans-serif;border-bottom:1px solid #f0f4f9;color:#224F93;font-weight:600;" onclick="_btAvClear()">
              <span>✕ Effacer sélection</span>
            </label>
            ${[['0','Pas démarré (0%)'],['low','Faible (0–25%)'],['mid','Moyen (25–75%)'],['high','Avancé (75–100%)'],['done','Terminé (100%)']].map(([v,l])=>`
            <label style="display:flex;align-items:center;gap:8px;padding:6px 12px;cursor:pointer;font-size:12px;font-family:Barlow,sans-serif;user-select:none;" onmouseover="this.style.background='#f0f4f9'" onmouseout="this.style.background=''">
              <input type="checkbox" value="${v}" class="bt-av-chk" onchange="_btAvChange()" style="accent-color:#224F93;width:14px;height:14px;cursor:pointer;"> ${l}
            </label>`).join('')}
          </div>
        </div>
        <button id="bt-aff-mgr-btn" style="display:none;" onclick="btAffMgr()" class="bt-btn bt-btn-secondary bt-btn-sm">⚙️ Gérer listes</button>
      </div>
    </div>
    <div style="flex:1;overflow:auto;padding:14px 24px;">
      <div class="bt-aff-wrap">
        <table class="bt-aff-table" id="bt-aff-table">
          <thead><tr>
            <th class="sticky-col" style="width:32px;min-width:32px;text-align:center;padding:4px;"><input type="checkbox" id="bt-aff-chk-all" title="Tout sélectionner" onclick="_btAffToggleAll(this)" style="cursor:pointer;accent-color:#224F93;width:14px;height:14px;"></th>
            <th class="sticky-col">#</th>
            <th id="th-numaff" class="bt-sortable" style="min-width:80px;" onclick="_btSortAff('numAff')">N° Aff <span class="bt-sort-ind">⇅</span></th>
            <th id="th-projet" class="bt-sortable sticky-col-2" style="min-width:200px;" onclick="_btSortAff('projet')">Projet <span class="bt-sort-ind">⇅</span></th>
            <th id="th-client" class="bt-sortable" style="min-width:200px;" onclick="_btSortAff('client')">Client <span class="bt-sort-ind">⇅</span></th>
            <th id="th-dir" class="bt-sortable" style="min-width:80px;white-space:normal;" onclick="_btSortAff('directeurProjet')">Directeur <span class="bt-sort-ind">⇅</span></th>
            <th id="th-cp" class="bt-sortable" style="min-width:80px;white-space:normal;" onclick="_btSortAff('chefProjet')">Chef Projet <span class="bt-sort-ind">⇅</span></th>
            <th id="th-ct" class="bt-sortable" style="min-width:80px;white-space:normal;" onclick="_btSortAff('conducteurTravaux')">Conducteur Travaux <span class="bt-sort-ind">⇅</span></th>
            <th id="th-cc" class="bt-sortable" style="min-width:80px;white-space:normal;" onclick="_btSortAff('chefChantier')">Chef Chantier <span class="bt-sort-ind">⇅</span></th>
            <th id="th-eff" class="bt-sortable" style="min-width:20px;width:20px;" onclick="_btSortAff('effectif')">Eff. <span class="bt-sort-ind">⇅</span></th>
            <th id="th-mm" class="bt-sortable" style="min-width:100px;text-align:right;" onclick="_btSortAff('montantMarche')">Montant marché <span class="bt-sort-ind">⇅</span></th>
            <th id="th-ca" class="bt-sortable" style="min-width:100px;text-align:right;" onclick="_btSortAff('cumulAttache')">Cumul attaché <span class="bt-sort-ind">⇅</span></th>
            <th id="th-av" class="bt-sortable" style="min-width:120px;" onclick="_btSortAff('avancement')">Avancement <span class="bt-sort-ind">⇅</span></th>
            <th style="min-width:36px;"></th>
          </tr></thead>
          <tbody id="bt-aff-tbody"><tr><td colspan="13" style="text-align:center;padding:30px;color:#8099b0;">Chargement…</td></tr></tbody>
          <tfoot><tr class="bt-tot-row">
            <td colspan="9" id="bt-aff-tot-label" style="font-weight:700;text-align:right;">TOTAL</td>
            <td id="bt-aff-tot-marche" style="text-align:right;font-size:11px;"></td>
            <td id="bt-aff-tot-attache" style="text-align:right;font-size:11px;color:#224F93;"></td>
            <td id="bt-aff-tot-av" style="font-size:11px;font-weight:700;"></td>
            <td colspan="1"></td>
          </tr></tfoot>
        </table>
      </div>
    </div>
  </div>`;
  await _btLoadRtLists();
  _btSubscribeRtLists();
  if (_btReports.length === 0) await _btLoadReports();
  await _btLoadAffectation();
  _btRenderAffectation();
};

window._btRefreshAff = async function() {
  await Promise.all([_btLoadRtLists(), _btLoadReports(), _btLoadAffectation()]);
  _btRenderAffectation();
  _btToast('Actualisé ✓');
};

function _btAvToggle(e) {
  e.stopPropagation();
  const panel = document.getElementById('bt-av-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    setTimeout(() => {
      document.addEventListener('click', function handler(ev) {
        if (!document.getElementById('bt-av-wrap')?.contains(ev.target)) {
          panel.style.display = 'none';
          document.removeEventListener('click', handler);
        }
      });
    }, 0);
  }
}

function _btAvChange() {
  const checked = [...document.querySelectorAll('.bt-av-chk:checked')];
  const label = document.getElementById('bt-av-label');
  if (label) label.textContent = checked.length ? checked.length + ' sélectionné(s)' : 'Tous avancements';
  _btRenderAffectation();
}

function _btAvClear() {
  document.querySelectorAll('.bt-av-chk').forEach(c => c.checked = false);
  _btAvChange();
}

function _btRenderAffectation() {
  const fixedFill = (id, list) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = sel.options[0].outerHTML +
      list.map(v=>`<option value="${_btA(v)}">${_btH(v)}</option>`).join('');
    sel.value = cur;
  };
  fixedFill('bt-aff-dir', _btRtDirs || BT_DIRECTORS);
  fixedFill('bt-aff-cp',  _btRtCPs  || BT_CHEF_PROJETS);
  fixedFill('bt-aff-cc',  _btRtCCs  || BT_CHEF_CHANTIERS);
  // Conducteur Travaux — runtime list merged with data
  const ctSel = document.getElementById('bt-aff-ct');
  if (ctSel) {
    const cur = ctSel.value;
    const ctData = _btAffectation.flatMap(p=>_btFlatArr(p.conducteurTravaux)).filter(v=>v&&v!=='VIDE');
    const cts = [...new Set([...(_btRtCTs||[]), ...ctData])].sort();
    ctSel.innerHTML = '<option value="">Tous conducteurs</option>' + cts.map(v=>`<option value="${_btA(v)}">${_btH(v)}</option>`).join('');
    ctSel.value = cur;
  }
  // Show manager button for developer only
  const mgrBtn = document.getElementById('bt-aff-mgr-btn');
  if (mgrBtn) mgrBtn.style.display = _btIsDeveloper() ? 'inline-flex' : 'none';
  _btApplyAffFilters();
}

window._btApplyAffFilters = function() {
  const search = (document.getElementById('bt-aff-search')?.value||'').toLowerCase().trim();
  const fDir = document.getElementById('bt-aff-dir')?.value||'';
  const fCp  = document.getElementById('bt-aff-cp')?.value||'';
  const fCt  = document.getElementById('bt-aff-ct')?.value||'';
  const fCc  = document.getElementById('bt-aff-cc')?.value||'';
  const fAvChecked = [...document.querySelectorAll('.bt-av-chk:checked')].map(c=>c.value);
  const fAv = fAvChecked.length ? fAvChecked : null;

  let filtered = _btAffectation.filter(p => {
    if (fDir && p.directeurProjet !== fDir) return false;
    if (fCp  && !_btFlatArr(p.chefProjet).includes(fCp)) return false;
    if (fCt  && !_btFlatArr(p.conducteurTravaux).includes(fCt)) return false;
    if (fCc  && !_btFlatArr(p.chefChantier).includes(fCc)) return false;
    if (fAv) {
      const av = _btCalcAv(p);
      const avMatch = v => {
        if (v==='0')    return av===0;
        if (v==='low')  return av>0&&av<25;
        if (v==='mid')  return av>=25&&av<75;
        if (v==='high') return av>=75&&av<100;
        if (v==='done') return av>=100;
        return false;
      };
      if (!fAv.some(avMatch)) return false;
    }
    if (search) {
      const blob = [p.projet,p.client,p.numAff,p.directeurProjet,..._btFlatArr(p.chefProjet),..._btFlatArr(p.conducteurTravaux),..._btFlatArr(p.chefChantier),p.numLigne].filter(Boolean).join(' ').toLowerCase();
      if (!blob.includes(search)) return false;
    }
    return true;
  });

  // KPIs — use linked cumul attaché when available
  let totMm=0, totCa=0, totW=0, done=0;
  filtered.forEach(p => {
    const mm = parseFloat(p.montantMarche)||0;
    const ca = _btLinkedCa(p).value;
    const av = mm>0 ? Math.min(100,Math.max(0,ca/mm*100)) : 0;
    totMm+=mm; totCa+=ca; totW+=av*mm;
    if (av>=100) done++;
  });
  const avgAv = totMm>0 ? totW/totMm : 0;
  const kpis = document.getElementById('bt-aff-kpis');
  if (kpis) kpis.innerHTML = `
    <div class="bt-kpi"><div class="bt-kpi-val">${filtered.length}</div><div class="bt-kpi-lbl">Projets</div></div>
    <div class="bt-kpi"><div class="bt-kpi-val">${_btFmtFull(totMm)} MAD</div><div class="bt-kpi-lbl">Total marché</div></div>
    <div class="bt-kpi"><div class="bt-kpi-val" style="color:#224F93;">${_btFmtFull(totCa)} MAD</div><div class="bt-kpi-lbl">Total attaché</div></div>
    <div class="bt-kpi"><div class="bt-kpi-val">${avgAv.toFixed(1)}%</div><div class="bt-kpi-lbl">Avancement moy.</div></div>
    <div class="bt-kpi green"><div class="bt-kpi-val">${done}</div><div class="bt-kpi-lbl">Terminés</div></div>
    <button class="bt-btn bt-btn-primary" onclick="btAffDash()" style="align-self:stretch;white-space:nowrap;margin-left:4px;padding:14px 18px;border-radius:10px;font-size:13px;">📊 Dashboard</button>
  `;

  // Apply sort
  if (_btAffSortField) {
    filtered.sort((a, b) => {
      let va, vb;
      if (_btAffSortField === 'avancement') {
        const av = p => { const mm=parseFloat(p.montantMarche)||0; const ca=_btLinkedCa(p).value; return mm>0?Math.min(100,Math.max(0,ca/mm*100)):0; };
        va = av(a); vb = av(b);
      } else if (_btAffSortField === 'cumulAttache') {
        va = _btLinkedCa(a).value; vb = _btLinkedCa(b).value;
      } else if (_btAffSortField === 'montantMarche' || _btAffSortField === 'effectif') {
        va = parseFloat(a[_btAffSortField])||0; vb = parseFloat(b[_btAffSortField])||0;
      } else {
        va = Array.isArray(a[_btAffSortField]) ? a[_btAffSortField].filter(Boolean).join(', ') : (a[_btAffSortField]||'');
        vb = Array.isArray(b[_btAffSortField]) ? b[_btAffSortField].filter(Boolean).join(', ') : (b[_btAffSortField]||'');
      }
      if (typeof va === 'number') return (va - vb) * _btAffSortDir;
      return String(va).localeCompare(String(vb), 'fr', {sensitivity:'base'}) * _btAffSortDir;
    });
  }

  _btLastAffRows = filtered;
  _btRenderAffRows(filtered, totMm, totCa, avgAv);
};

window._btSortAff = function(field) {
  if (_btAffSortField === field) {
    _btAffSortDir = -_btAffSortDir;
  } else {
    _btAffSortField = field;
    _btAffSortDir = 1;
  }
  _btApplyAffFilters();
};

function _btUpdateAffSortHeaders() {
  const cols = [
    { id:'th-numaff',   field:'numAff',           label:'N° Aff' },
    { id:'th-projet',   field:'projet',            label:'Projet' },
    { id:'th-client',   field:'client',            label:'Client' },
    { id:'th-dir',      field:'directeurProjet',   label:'Directeur' },
    { id:'th-cp',       field:'chefProjet',        label:'Chef Projet' },
    { id:'th-ct',       field:'conducteurTravaux', label:'Conducteur Travaux' },
    { id:'th-cc',       field:'chefChantier',      label:'Chef Chantier' },
    { id:'th-eff',      field:'effectif',          label:'Effectif' },
    { id:'th-mm',       field:'montantMarche',     label:'Montant marché' },
    { id:'th-ca',       field:'cumulAttache',      label:'Cumul attaché' },
    { id:'th-av',       field:'avancement',        label:'Avancement' },
  ];
  cols.forEach(c => {
    const th = document.getElementById(c.id);
    if (!th) return;
    const isActive = _btAffSortField === c.field;
    const ind = isActive ? (_btAffSortDir === 1 ? ' ↑' : ' ↓') : ' ⇅';
    th.className = 'bt-sortable' + (isActive ? ' bt-sort-active' : '') +
                   (['montantMarche','cumulAttache'].includes(c.field) ? ' text-right' : '');
    th.innerHTML = c.label + `<span class="bt-sort-ind">${ind}</span>`;
  });
}

function _btRenderAffRows(rows, totMm, totCa, avgAv) {
  const tbody = document.getElementById('bt-aff-tbody');
  if (!tbody) return;
  const isVide = v => Array.isArray(v) ? v.filter(Boolean).length===0 : (!v||v==='VIDE');
  const showArr = v => { const a=_btFlatArr(v).filter(Boolean); return a.length>0 ? a.map(_btH).join(', ') : '—'; };
  tbody.innerHTML = rows.length===0 ?
    `<tr><td colspan="13" style="text-align:center;padding:40px;color:#8099b0;font-style:italic;">Aucun projet ne correspond aux filtres</td></tr>` :
    rows.map((p, idx) => {
      const caInfo = _btLinkedCa(p);
      const mm = parseFloat(p.montantMarche)||0;
      const av = mm>0 ? Math.min(100,Math.max(0,caInfo.value/mm*100)) : 0;
      const avClass = av>=100?'full':(av<20?'low':'');
      const isDev = _btIsDeveloper();
      return `<tr data-id="${p.id}">
        <td class="sticky-col" style="text-align:center;padding:4px;"><input type="checkbox" class="bt-aff-row-chk" data-id="${p.id}" onclick="_btAffRowChkChange()" style="cursor:pointer;accent-color:#224F93;width:14px;height:14px;"></td>
        <td class="sticky-col">${idx+1}</td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','numAff')">${_btH(p.numAff||'—')}</span></td>
        <td class="sticky-col-2"><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','projet')" style="font-weight:600;">${_btH(p.projet||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','client')" style="font-weight:600;">${_btH(p.client||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','directeurProjet')" ${isVide(p.directeurProjet)?'style="color:#8099b0;font-style:italic;"':''}>${_btH(p.directeurProjet||'—')}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','chefProjet')" ${isVide(p.chefProjet)?'style="color:#c02020;font-style:italic;"':''}>${showArr(p.chefProjet)}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','conducteurTravaux')" ${isVide(p.conducteurTravaux)?'style="color:#8099b0;font-style:italic;"':''}>${showArr(p.conducteurTravaux)}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','chefChantier')" ${isVide(p.chefChantier)?'style="color:#c02020;font-style:italic;"':''}>${showArr(p.chefChantier)}</span></td>
        <td><span class="bt-aff-cell" onclick="_btEditAffCell(this,'${p.id}','effectif','number')">${p.effectif||'—'}</span></td>
        <td><span class="bt-aff-cell${isDev?'':' bt-aff-locked'}" ${isDev?`onclick="_btEditAffCell(this,'${p.id}','montantMarche','number')"`:''} style="display:block;text-align:right;">${p.montantMarche?_btFmtFull(p.montantMarche):'—'}${isDev?'':' <span style="opacity:.5;font-size:10px;">🔒</span>'}</span></td>
        <td><span class="bt-aff-linked-ca" title="${caInfo.linked?'Lié au rapport Suivi Travaux (N° Aff)':'Valeur stockée — aucun rapport lié'}" style="display:block;text-align:right;color:#224F93;font-weight:600;">${caInfo.value?_btFmtFull(caInfo.value):'0.00'}${caInfo.linked?' <span style="font-size:10px;color:#1a9458;">🔗</span>':''}</span></td>
        <td><div class="bt-mini-prog"><div class="bar"><div class="fill ${avClass}" style="width:${av}%"></div></div><span class="pct">${av.toFixed(1)}%</span></div></td>
        <td><button class="bt-del-btn" onclick="_btDeleteAff('${p.id}')" title="Supprimer">×</button></td>
      </tr>`;
    }).join('');

  // Totals footer
  const totL = document.getElementById('bt-aff-tot-label');
  const totM = document.getElementById('bt-aff-tot-marche');
  const totA = document.getElementById('bt-aff-tot-attache');
  const totAv = document.getElementById('bt-aff-tot-av');
  if (totL) totL.textContent = `TOTAL (${rows.length})`;
  if (totM) totM.textContent = _btFmtFull(totMm) + ' MAD';
  if (totA) totA.textContent = _btFmtFull(totCa) + ' MAD';
  if (totAv) totAv.textContent = avgAv.toFixed(1)+'%';
  _btUpdateAffSortHeaders();
}

window._btEditAffCell = function(cellSpan, projectId, field, type) {
  if (cellSpan.classList.contains('editing')) return;
  // Cumul attaché is always read-only
  if (field === 'cumulAttache') return;
  // Montant marché locked for non-developers
  if (field === 'montantMarche' && !_btIsDeveloper()) {
    _btToast('Montant marché verrouillé 🔒', false);
    return;
  }
  const project = _btAffectation.find(p=>p.id===projectId);
  if (!project) return;
  const oldHtml = cellSpan.innerHTML;
  const oldValue = project[field] !== undefined ? project[field] : '';
  cellSpan.classList.add('editing');

  // Multi-select fields: Chef Projet, Conducteur Travaux, Chef Chantier
  const _btMsFields = ['chefProjet', 'conducteurTravaux', 'chefChantier'];
  if (_btMsFields.includes(field)) {
    const ctFlatData = _btAffectation.flatMap(p => _btFlatArr(p.conducteurTravaux)).filter(Boolean);
    const msList = field === 'chefProjet' ? (_btRtCPs || BT_CHEF_PROJETS) :
                   field === 'chefChantier' ? (_btRtCCs || BT_CHEF_CHANTIERS) :
                   [...new Set([...(_btRtCTs || []), ...ctFlatData])].sort();
    const currentArr = _btFlatArr(oldValue).filter(Boolean);
    const panel = document.createElement('div');
    panel.style.cssText = 'position:fixed;z-index:10000;background:#fff;border:1.5px solid #224F93;border-radius:8px;padding:10px 12px;box-shadow:0 4px 20px rgba(0,0,0,0.18);min-width:210px;max-width:300px;';
    const rect = cellSpan.getBoundingClientRect();
    panel.style.top = Math.min(rect.bottom + 4, window.innerHeight - 320) + 'px';
    panel.style.left = Math.min(rect.left, window.innerWidth - 220) + 'px';
    const msLabel = {'chefProjet':'Chef Projet','conducteurTravaux':'Conducteur Travaux','chefChantier':'Chef Chantier'}[field];
    let ph = `<div style="font-size:10px;font-weight:700;color:#224F93;text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px;">${msLabel}</div>`;
    ph += `<div id="_btMsChecks" style="max-height:170px;overflow-y:auto;margin-bottom:8px;">`;
    ph += msList.map(v =>
      `<label style="display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer;font-size:12px;font-family:Barlow,sans-serif;white-space:nowrap;">
        <input type="checkbox" class="_btMs" value="${_btA(v)}" ${currentArr.includes(v)?'checked':''} style="cursor:pointer;accent-color:#224F93;">
        ${_btH(v)}
      </label>`
    ).join('');
    ph += `</div>`;
    ph += `<div style="display:flex;gap:5px;margin-bottom:8px;">
      <input id="_btMsNewInp" placeholder="Ajouter un nom…" style="flex:1;padding:4px 7px;border:1.5px solid #dde3ee;border-radius:5px;font-size:11px;font-family:Barlow,sans-serif;outline:none;">
      <button id="_btMsAddBtn" style="padding:4px 9px;background:#eef3fb;color:#224F93;border:1.5px solid #224F93;border-radius:5px;font-size:11px;cursor:pointer;font-weight:700;">+</button>
    </div>`;
    ph += `<div style="display:flex;gap:6px;justify-content:flex-end;border-top:1px solid #f0f2f5;padding-top:8px;">
      <button id="_btMsCancelBtn" style="padding:4px 12px;border:1.5px solid #dde3ee;border-radius:5px;background:#fff;font-size:11px;font-family:Barlow,sans-serif;cursor:pointer;">Annuler</button>
      <button id="_btMsOkBtn" style="padding:4px 12px;background:#224F93;color:#fff;border:none;border-radius:5px;font-size:11px;font-family:Barlow,sans-serif;cursor:pointer;font-weight:700;">✓ OK</button>
    </div>`;
    panel.innerHTML = ph;
    document.body.appendChild(panel);
    cellSpan.innerHTML = '<span style="color:#224F93;font-style:italic;font-size:11px;">sélection…</span>';

    // Inline add: type a new name → add as checked checkbox
    const addInline = () => {
      const inp = panel.querySelector('#_btMsNewInp');
      const val = (inp?.value||'').trim();
      if (!val) return;
      const checks = panel.querySelector('#_btMsChecks');
      // Check if already exists
      const existing = [...checks.querySelectorAll('input._btMs')].find(cb => cb.value.toLowerCase() === val.toLowerCase());
      if (existing) { existing.checked = true; inp.value=''; return; }
      const lbl = document.createElement('label');
      lbl.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 2px;cursor:pointer;font-size:12px;font-family:Barlow,sans-serif;white-space:nowrap;';
      lbl.innerHTML = `<input type="checkbox" class="_btMs" value="${_btA(val)}" checked style="cursor:pointer;accent-color:#224F93;"> ${_btH(val)}`;
      checks.appendChild(lbl);
      inp.value = '';
      // Also persist to runtime list for CT so it shows next time
      if (field === 'conducteurTravaux') {
        const rtArr = _btMgrGetArr('bt_rt_cts');
        if (!rtArr.includes(val)) { rtArr.push(val); _btSaveRtList('bt_rt_cts', rtArr); }
      }
    };
    panel.querySelector('#_btMsAddBtn').addEventListener('click', addInline);
    panel.querySelector('#_btMsNewInp').addEventListener('keydown', e => { if (e.key==='Enter') { e.preventDefault(); addInline(); } });

    const closeMs = () => {
      panel.remove();
      cellSpan.classList.remove('editing');
      cellSpan.innerHTML = oldHtml;
    };
    const confirmMs = async () => {
      const newArr = [...panel.querySelectorAll('input._btMs:checked')].map(cb => cb.value);
      panel.remove();
      cellSpan.classList.remove('editing');
      const oldStr = JSON.stringify(currentArr.slice().sort());
      const newStr = JSON.stringify(newArr.slice().sort());
      if (oldStr === newStr) { cellSpan.innerHTML = oldHtml; return; }
      project[field] = newArr;
      await _btSaveAffRow(project, _btArrStr(currentArr), field, _btArrStr(newArr));
      _btApplyAffFilters();
      _btToast('Modifié ✓');
    };
    panel.querySelector('#_btMsOkBtn').addEventListener('click', confirmMs);
    panel.querySelector('#_btMsCancelBtn').addEventListener('click', closeMs);
    const outsideMs = (e) => {
      if (!panel.contains(e.target) && e.target !== cellSpan) {
        closeMs();
        document.removeEventListener('mousedown', outsideMs);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', outsideMs), 50);
    return;
  }

  // Single-value dropdown: Directeur only
  const ctList = [...new Set([...(_btRtCTs||[]), ..._btAffectation.flatMap(p=>_btFlatArr(p.conducteurTravaux)).filter(v=>v&&v!=='VIDE')])].sort();
  const dropdownLists = {
    directeurProjet: _btRtDirs || BT_DIRECTORS
  };
  if (field in dropdownLists && dropdownLists[field] !== null) {
    const sel = document.createElement('select');
    sel.style.cssText = 'width:100%;border:1.5px solid #224F93;border-radius:4px;padding:3px 6px;font-family:Barlow,sans-serif;font-size:12px;outline:none;';
    sel.innerHTML = `<option value="">—</option>` +
      dropdownLists[field].map(v=>`<option value="${_btA(v)}"${v===oldValue?' selected':''}>${_btH(v)}</option>`).join('');
    cellSpan.innerHTML = ''; cellSpan.appendChild(sel);
    sel.focus();
    const commitSel = async () => {
      const newVal = sel.value;
      cellSpan.classList.remove('editing');
      if (newVal === oldValue) { cellSpan.innerHTML=oldHtml; return; }
      project[field] = newVal;
      await _btSaveAffRow(project, oldValue, field, newVal);
      _btApplyAffFilters();
      _btToast('Modifié ✓');
    };
    sel.addEventListener('change', commitSel);
    sel.addEventListener('blur', commitSel);
    sel.addEventListener('keydown', e => {
      if (e.key==='Escape') { cellSpan.classList.remove('editing'); cellSpan.innerHTML=oldHtml; }
    });
    return;
  }

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
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
  const p = {
    id: 'aff-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),
    numLigne:'', numAff:'', projet:'Nouveau projet', directeurProjet:'',
    chefProjet:[], conducteurTravaux:[], chefChantier:[], effectif:'', dateDebut:'', dateFin:'',
    montantMarche:0, cumulAttache:0, bet:'', achat:'', production:'', pose:'', observations:''
  };
  _btAffectation.push(p);
  await _btSaveAffRow(p, null, null, null);
  await _btLogHistory('CREATE','bt_affectation',p.id,p.projet,null,null,null);
  _btApplyAffFilters();
  _btToast('Projet ajouté en bas du tableau');
};

window._btImportExcel = function() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.xlsx,.xls';
  inp.onchange = async function(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(ev) {
      try {
        const wb = XLSX.read(new Uint8Array(ev.target.result), { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        if (!rows.length) { _btToast('Aucune donnée trouvée dans le fichier'); return; }

        // Flexible column mapping (case-insensitive, accent-insensitive)
        function norm(s) { return String(s||'').toLowerCase().replace(/[éèê]/g,'e').replace(/[àâ]/g,'a').replace(/[ùû]/g,'u').replace(/[îï]/g,'i').replace(/[ôö]/g,'o').trim(); }
        const COL_MAP = {
          'num_ligne':         ['num ligne','numligne','n ligne','n°ligne','no ligne','num_ligne'],
          'num_aff':           ['num aff','numaff','n aff','numero affectation','num_aff'],
          'projet':            ['projet','project','nom projet'],
          'client':            ['client'],
          'directeurProjet':   ['directeur','directeur projet','dir projet','directeurprojet'],
          'chefProjet':        ['chef projet','chefprojet','cp'],
          'conducteurTravaux': ['conducteur','conducteur travaux','conducteurtravaux','ct'],
          'chefChantier':      ['chef chantier','chefchantier','cc'],
          'effectif':          ['effectif'],
          'dateDebut':         ['date debut','datedebut','debut','date de debut','date début'],
          'dateFin':           ['date fin','datefin','fin','date de fin'],
          'montantMarche':     ['montant marche','montantmarche','montant','marche','montant marché'],
          'cumulAttache':      ['cumul attache','cumulattache','cumul','attache','cumul attaché'],
          'bet':               ['bet'],
          'achat':             ['achat'],
          'production':        ['production'],
          'pose':              ['pose'],
          'observations':      ['observations','observation','obs'],
        };

        // Map actual header names to field names
        const headers = Object.keys(rows[0]);
        const headerMap = {};
        headers.forEach(h => {
          const hn = norm(h);
          for (const [field, aliases] of Object.entries(COL_MAP)) {
            if (aliases.includes(hn)) { headerMap[h] = field; break; }
          }
        });

        let added = 0;
        for (const row of rows) {
          const p = {
            id: 'aff-'+Date.now()+'-'+Math.random().toString(36).slice(2,6),
            numLigne:'', numAff:'', projet:'', client:'', directeurProjet:'',
            chefProjet:[], conducteurTravaux:[], chefChantier:[], effectif:'',
            dateDebut:'', dateFin:'', montantMarche:0, cumulAttache:0,
            bet:'', achat:'', production:'', pose:'', observations:''
          };
          for (const [h, field] of Object.entries(headerMap)) {
            const val = String(row[h]||'').trim();
            if (['chefProjet','conducteurTravaux','chefChantier'].includes(field)) {
              p[field] = val ? val.split(/[,;]+/).map(s=>s.trim()).filter(Boolean) : [];
            } else if (['montantMarche','cumulAttache'].includes(field)) {
              p[field] = parseFloat(val.replace(/\s/g,'').replace(',','.')) || 0;
            } else {
              p[field] = val;
            }
          }
          if (!p.projet) continue; // skip empty rows
          _btAffectation.push(p);
          await _btSaveAffRow(p, null, null, null);
          await _btLogHistory('CREATE','bt_affectation',p.id,p.projet,null,null,null);
          added++;
        }
        _btApplyAffFilters();
        _btToast(added + ' ligne(s) importée(s) depuis Excel');
      } catch(err) {
        console.error('[BT] importExcel error', err);
        _btToast('Erreur lors de l\'import: ' + (err.message||err));
      }
    };
    reader.readAsArrayBuffer(file);
  };
  inp.click();
};

window._btDeleteAff = async function(id) {
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
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

function _btAffToggleAll(masterChk) {
  document.querySelectorAll('.bt-aff-row-chk').forEach(c => c.checked = masterChk.checked);
}
function _btAffRowChkChange() {
  const all = [...document.querySelectorAll('.bt-aff-row-chk')];
  const master = document.getElementById('bt-aff-chk-all');
  if (master) master.checked = all.length > 0 && all.every(c => c.checked);
}
window._btDeleteSelectedAff = async function() {
  if (window._projectViewerMode) { if (typeof toast==='function') toast('Viewer access — read only'); return; }
  const checked = [...document.querySelectorAll('.bt-aff-row-chk:checked')];
  if (checked.length === 0) { _btToast('Aucune ligne sélectionnée'); return; }
  const ids = checked.map(c => c.dataset.id);
  const names = ids.map(id => _btAffectation.find(x=>x.id===id)?.projet||id).join(', ');
  if (!confirm(`Supprimer ${ids.length} projet(s) ?\n${names}`)) return;
  const db = _btSb();
  for (const id of ids) {
    const p = _btAffectation.find(x=>x.id===id);
    _btAffectation = _btAffectation.filter(x=>x.id!==id);
    if (db && p) {
      await db.from('bt_affectation').delete().eq('id', id);
      await _btLogHistory('DELETE','bt_affectation',id,p.projet,null,null,null);
    }
  }
  _btApplyAffFilters();
  _btToast(`${ids.length} projet(s) supprimé(s)`);
};

// ═══════════════════════════════════════════════════════════════════════════════
// AFFECTATION DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
var _btDashOnlyIP = false; // "only in progress" toggle — excludes 100% projects

// Called by the toggle button; flips state and re-renders current tab
function btAffDashToggleIP() {
  _btDashOnlyIP = !_btDashOnlyIP;
  var panel = document.getElementById('bt-aff-dash-panel');
  var tab = (panel && panel.getAttribute('data-tab')) || 'dir';
  _btDashRender(tab);
}

// ─── Affectation Dashboard (inline panel) ──────────────────────────────────────
function btAffDash(tab) {
  var panel = document.getElementById('bt-aff-dash-panel');
  if (!panel) return;
  tab = tab || 'dir';

  // Toggle off if same tab clicked while open AND toggle is inactive
  if (panel.style.display !== 'none' && panel.getAttribute('data-tab') === tab) {
    panel.style.display = 'none';
    return;
  }
  panel.setAttribute('data-tab', tab);
  panel.style.display = 'block';
  _btDashRender(tab);
}

function _btDashRender(tab) {
  var panel = document.getElementById('bt-aff-dash-panel');
  if (!panel) return;
  panel.setAttribute('data-tab', tab);
  panel.style.display = 'block';

  var fieldMap = { dir:'directeurProjet', cp:'chefProjet', ct:'conducteurTravaux', cc:'chefChantier' };
  var field = fieldMap[tab];
  var stats = {};
  (_btAffectation || []).forEach(function(p) {
    var mm = parseFloat(p.montantMarche) || 0;
    var ca = _btLinkedCa(p).value;
    var av = mm > 0 ? Math.min(100, Math.max(0, ca / mm * 100)) : 0;
    // Skip 100% projects when "only in progress" is active
    if (_btDashOnlyIP && av >= 100) return;
    // For multi-value fields, distribute into each person's stats
    var keys = tab === 'dir'
      ? [(p[field] || '').trim()]
      : _btFlatArr(p[field]).map(function(v){ return v.trim(); }).filter(Boolean);
    if (keys.length === 0) keys = ['Non assigné'];
    keys.forEach(function(key) {
      if (!key || key === 'VIDE') key = 'Non assigné';
      if (!stats[key]) stats[key] = { count:0, mm:0, ca:0, w:0, done:0, inProgress:0 };
      var s = stats[key];
      s.count++; s.mm += mm; s.ca += ca; s.w += av * mm;
      if (av >= 100) s.done++;
      else s.inProgress++;
    });
  });
  var rows = Object.keys(stats)
    .map(function(k) { return { name: k, s: stats[k] }; })
    .sort(function(a, b) { return b.s.count - a.s.count; });

  var tabLabels = { dir:'Directeurs', cp:'Chef Projet', ct:'Conducteur Travaux', cc:'Chef Chantier' };
  var ipActive = _btDashOnlyIP;
  var h = '<div style="background:#f7f9fc;border:1px solid #dde3ee;border-radius:10px;padding:14px 18px;">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px;">';
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">';
  ['dir','cp','ct','cc'].forEach(function(t) {
    var active = t === tab;
    h += '<button onclick="btAffDash(\'' + t + '\')" style="padding:5px 12px;border-radius:6px;border:1.5px solid #224F93;font-family:Barlow,sans-serif;font-size:11px;font-weight:700;cursor:pointer;background:' + (active?'#224F93':'#fff') + ';color:' + (active?'#fff':'#224F93') + ';">' + tabLabels[t] + '</button>';
  });
  // "Only in progress" toggle button
  h += '<div style="width:1px;height:20px;background:#dde3ee;margin:0 2px;"></div>';
  h += '<button onclick="btAffDashToggleIP()" title="Masquer les projets terminés (100%)" style="padding:5px 12px;border-radius:6px;border:1.5px solid ' + (ipActive?'#b08400':'#dde3ee') + ';font-family:Barlow,sans-serif;font-size:11px;font-weight:700;cursor:pointer;background:' + (ipActive?'#fff8e1':'#fff') + ';color:' + (ipActive?'#b08400':'#8099b0') + ';">'
    + (ipActive ? '🟡 En cours uniquement' : '⬜ En cours uniquement') + '</button>';
  h += '</div>';
  h += '<button onclick="document.getElementById(\'bt-aff-dash-panel\').style.display=\'none\'" style="background:none;border:none;font-size:18px;cursor:pointer;color:#8099b0;line-height:1;">×</button>';
  h += '</div>';
  if (ipActive) {
    h += '<div style="display:inline-flex;align-items:center;gap:6px;background:#fff8e1;border:1px solid #ffe082;border-radius:6px;padding:4px 10px;margin-bottom:10px;font-size:11px;color:#856404;">🟡 Projets terminés (100%) exclus des totaux</div>';
  }
  h += '<table style="width:100%;border-collapse:collapse;font-size:12px;">';
  h += '<thead><tr style="background:#224F93;color:#fff;">';
  h += '<th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:700;">Nom</th>';
  h += '<th style="padding:7px 10px;text-align:center;font-size:11px;font-weight:700;">Projets</th>';
  h += '<th style="padding:7px 10px;text-align:center;font-size:11px;font-weight:700;">En cours</th>';
  if (!ipActive) h += '<th style="padding:7px 10px;text-align:center;font-size:11px;font-weight:700;">Terminés</th>';
  h += '<th style="padding:7px 10px;text-align:right;font-size:11px;font-weight:700;">Total marché</th>';
  h += '<th style="padding:7px 10px;text-align:right;font-size:11px;font-weight:700;">Total attaché</th>';
  h += '<th style="padding:7px 10px;text-align:left;font-size:11px;font-weight:700;min-width:120px;">Avanc. moy.</th>';
  h += '</tr></thead><tbody>';
  rows.forEach(function(r, i) {
    var s = r.s;
    var avgAv = s.mm > 0 ? s.w / s.mm : 0;
    var avColor = avgAv >= 75 ? '#1a9458' : avgAv >= 25 ? '#224F93' : '#c02020';
    var bg = i % 2 === 0 ? '#fff' : '#f7f9fc';
    h += '<tr style="background:' + bg + ';">';
    h += '<td style="padding:7px 10px;font-weight:700;color:#1a2a3a;">' + _btH(r.name) + '</td>';
    h += '<td style="padding:7px 10px;text-align:center;font-weight:700;color:#224F93;">' + s.count + '</td>';
    h += '<td style="padding:7px 10px;text-align:center;color:#b08400;font-weight:700;">' + s.inProgress + '</td>';
    if (!ipActive) h += '<td style="padding:7px 10px;text-align:center;color:#1a9458;font-weight:700;">' + s.done + '</td>';
    h += '<td style="padding:7px 10px;text-align:right;">' + _btFmtFull(s.mm) + '</td>';
    h += '<td style="padding:7px 10px;text-align:right;color:#224F93;font-weight:700;">' + _btFmtFull(s.ca) + '</td>';
    h += '<td style="padding:7px 10px;"><div style="display:flex;align-items:center;gap:6px;">';
    h += '<div style="flex:1;background:#e0e6ef;border-radius:3px;height:6px;"><div style="height:100%;border-radius:3px;background:' + avColor + ';width:' + Math.min(100, avgAv).toFixed(1) + '%;"></div></div>';
    h += '<span style="font-size:11px;font-weight:700;color:' + avColor + ';white-space:nowrap;">' + avgAv.toFixed(1) + '%</span>';
    h += '</div></td>';
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  panel.innerHTML = h;
}

// ─── Developer list manager ─────────────────────────────────────────────────────
function btAffMgr() {
  if (!_btIsDeveloper()) return;
  var panel = document.getElementById('bt-aff-mgr-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = 'block';
  btAffMgrRender();
}

function btAffMgrRender() {
  var panel = document.getElementById('bt-aff-mgr-panel');
  if (!panel) return;
  var lists = [
    { key:'bt_rt_dirs', label:'Directeurs',         arr: _btRtDirs || [] },
    { key:'bt_rt_cps',  label:'Chef Projet',        arr: _btRtCPs  || [] },
    { key:'bt_rt_cts',  label:'Conducteur Travaux', arr: _btRtCTs  || [] },
    { key:'bt_rt_ccs',  label:'Chef Chantier',      arr: _btRtCCs  || [] }
  ];

  var h = '<div style="background:#f7f9fc;border:1px solid #dde3ee;border-radius:10px;padding:16px 18px;">';
  h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">';
  h += '<span style="font-size:13px;font-weight:700;color:#224F93;">⚙️ Gestion des listes (Développeur)</span>';
  h += '<div style="display:flex;align-items:center;gap:8px;">';
  h += '<button onclick="btMgrSyncAll()" style="padding:4px 12px;background:#1a7a4a;color:#fff;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;font-family:Barlow,sans-serif;">↑ Sync Supabase</button>';
  h += '<button onclick="document.getElementById(\'bt-aff-mgr-panel\').style.display=\'none\'" style="background:none;border:none;font-size:18px;cursor:pointer;color:#8099b0;">×</button>';
  h += '</div></div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;">';

  lists.forEach(function(lst) {
    h += '<div style="background:#fff;border:1px solid #dde3ee;border-radius:8px;padding:12px;">';
    h += '<div style="font-size:11px;font-weight:700;color:#224F93;text-transform:uppercase;letter-spacing:.04em;margin-bottom:10px;">' + _btH(lst.label) + '</div>';
    h += '<div id="bt-mgr-list-' + lst.key + '">';
    lst.arr.forEach(function(name, idx) {
      h += '<div style="display:flex;align-items:center;gap:4px;margin-bottom:5px;" id="bt-mgr-item-' + lst.key + '-' + idx + '">';
      h += '<span style="flex:1;font-size:12px;padding:3px 6px;background:#f7f9fc;border-radius:4px;border:1px solid #e0e6ef;">' + _btH(name) + '</span>';
      h += '<button onclick="btMgrEdit(\'' + lst.key + '\',' + idx + ')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;" title="Renommer">✏️</button>';
      h += '<button onclick="btMgrDel(\'' + lst.key + '\',' + idx + ')" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;color:#c02020;" title="Supprimer">🗑️</button>';
      h += '</div>';
    });
    h += '</div>';
    h += '<div style="display:flex;gap:4px;margin-top:6px;">';
    h += '<input id="bt-mgr-add-' + lst.key + '" placeholder="Ajouter…" style="flex:1;padding:4px 7px;border:1.5px solid #dde3ee;border-radius:5px;font-size:12px;font-family:Barlow,sans-serif;outline:none;" onkeydown="if(event.key===\'Enter\')btMgrAdd(\'' + lst.key + '\')">';
    h += '<button onclick="btMgrAdd(\'' + lst.key + '\')" style="padding:4px 9px;background:#224F93;color:#fff;border:none;border-radius:5px;font-size:12px;cursor:pointer;">+</button>';
    h += '</div></div>';
  });

  h += '</div></div>';
  panel.innerHTML = h;
}

async function btMgrSyncAll() {
  const btn = document.querySelector('[onclick="btMgrSyncAll()"]');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.textContent = '⏳ Sync en cours…'; btn.disabled = true; }
  const keys = ['bt_rt_dirs','bt_rt_cps','bt_rt_cts','bt_rt_ccs'];
  const arrs  = [_btRtDirs, _btRtCPs, _btRtCTs, _btRtCCs];
  try {
    await Promise.all(keys.map((k,i) =>
      _btSb().from('bt_config').upsert(
        { key: k, value: JSON.stringify(arrs[i]||[]), updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      )
    ));
    if (btn) { btn.textContent = '✓ Sync complété'; btn.style.background='#0f5c32'; }
    setTimeout(() => { if (btn) { btn.textContent = orig; btn.style.background=''; btn.disabled = false; } }, 3000);
  } catch(e) {
    const msg = e?.message || JSON.stringify(e);
    console.error('[BT] btMgrSyncAll error:', e);
    if (btn) { btn.textContent = '✗ ' + msg; btn.style.background='#c02020'; btn.title = msg; }
    setTimeout(() => { if (btn) { btn.textContent = orig; btn.style.background=''; btn.style.color=''; btn.disabled = false; btn.title=''; } }, 6000);
  }
}

function _btMgrGetArr(key) {
  const m = { bt_rt_dirs:_btRtDirs, bt_rt_cps:_btRtCPs, bt_rt_cts:_btRtCTs, bt_rt_ccs:_btRtCCs };
  return (m[key] || []).slice();
}

function btMgrAdd(key) {
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
  var inp = document.getElementById('bt-mgr-add-' + key);
  if (!inp) return;
  var val = inp.value.trim();
  if (!val) return;
  var arr = _btMgrGetArr(key);
  if (arr.indexOf(val) === -1) arr.push(val);
  _btSaveRtList(key, arr);
  inp.value = '';
  btAffMgrRender();
  _btRenderAffectation();
}

function btMgrDel(key, idx) {
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
  var arr = _btMgrGetArr(key);
  arr.splice(idx, 1);
  _btSaveRtList(key, arr);
  btAffMgrRender();
  _btRenderAffectation();
}

function btMgrEdit(key, idx) {
  var itemDiv = document.getElementById('bt-mgr-item-' + key + '-' + idx);
  if (!itemDiv) return;
  var arr = _btMgrGetArr(key);
  var current = arr[idx] || '';
  itemDiv.innerHTML = '<input id="bt-mgr-edit-inp" value="' + _btA(current) + '" style="flex:1;padding:3px 6px;border:1.5px solid #224F93;border-radius:4px;font-size:12px;font-family:Barlow,sans-serif;outline:none;">'
    + '<button onclick="btMgrSaveEdit(\'' + key + '\',' + idx + ')" style="padding:2px 8px;background:#224F93;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer;">✓</button>'
    + '<button onclick="btAffMgrRender()" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 4px;color:#8099b0;">✕</button>';
  var inp = document.getElementById('bt-mgr-edit-inp');
  if (inp) { inp.focus(); inp.select(); inp.onkeydown = function(e){ if(e.key==='Enter') btMgrSaveEdit(key,idx); if(e.key==='Escape') btAffMgrRender(); }; }
}

function btMgrSaveEdit(key, idx) {
  if(window._projectViewerMode){ if(typeof toast==='function') toast('Viewer access — read only'); return; }
  var inp = document.getElementById('bt-mgr-edit-inp');
  if (!inp) return;
  var val = inp.value.trim();
  if (!val) return;
  var arr = _btMgrGetArr(key);
  var oldName = arr[idx];
  arr[idx] = val;
  _btSaveRtList(key, arr);
  btAffMgrRender();
  _btRenderAffectation();
  // Auto-rename matching rows in bt_affectation
  if (oldName && oldName !== val) _btRenameInAffectation(key, oldName, val);
}

async function _btRenameInAffectation(key, oldName, newName) {
  const fieldMap = {
    'bt_rt_dirs': 'directeurProjet',
    'bt_rt_cps':  'chefProjet',
    'bt_rt_cts':  'conducteurTravaux',
    'bt_rt_ccs':  'chefChantier',
  };
  const field = fieldMap[key];
  if (!field) return;
  const toSave = [];
  _btAffectation.forEach(function(p) {
    var vals = _btNormArr(p[field]);
    if (!vals.includes(oldName)) return;
    var updated = vals.map(function(v){ return v === oldName ? newName : v; });
    p[field] = updated.length === 1 ? updated[0] : updated;
    toSave.push(p);
  });
  for (var i = 0; i < toSave.length; i++) {
    await _btSaveAffRow(toSave[i], oldName, field, newName);
  }
  if (toSave.length) _btRenderAffectation();
}

window._btExportAff = function() {
  // Export the rows exactly as currently displayed (same filter + sort order)
  const source = _btLastAffRows.length > 0 ? _btLastAffRows : _btAffectation;
  const headers = ['#','N° Aff','Projet','Client','Directeur','Chef Projet','Conducteur Travaux','Chef Chantier','Effectif','Montant Marché HT','Cumul Attaché','% Avancement'];
  const rows = source.map((p, i) => {
    const caInfo = _btLinkedCa(p);
    const mm = parseFloat(p.montantMarche)||0;
    const av = mm > 0 ? Math.min(100, Math.max(0, caInfo.value / mm * 100)) : 0;
    const arrStr = v => _btFlatArr(v).filter(Boolean).join(', ');
    return [
      i + 1,                    // SQN matches display
      p.numAff,
      p.projet,
      p.client,
      p.directeurProjet,
      arrStr(p.chefProjet),
      arrStr(p.conducteurTravaux),
      arrStr(p.chefChantier),
      p.effectif,
      p.montantMarche,
      caInfo.value,             // linked cumul attaché (same as display)
      av.toFixed(2) + '%'
    ];
  });
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
// SEED DATA  — 12 reports · 93 affectation
// ═══════════════════════════════════════════════════════════════════════════════
const BT_REPORTS_SEED = [
  {id:'r-twfb-001',createdAt:'2026-05-08T08:00:00Z',projet:'TWF',client:'SEG',lot:'Menuiserie Aluminium',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:6,montantMarche:11837241.0,cumulFacture:4973223.07,cumulAttache:4973223.07,avancement:42.01,facturation:42.01,pctFactAtt:100,demandes:[{type:'OF',numOF:'',nature:'VITRAGE GC',date:'2026-04-17',statut:'attente',commentaire:''},{type:'OF',numOF:'',nature:'PAROI DOUCHE',date:'2026-04-17',statut:'attente',commentaire:''},{type:'OF',numOF:'',nature:'CH ALU RDC',date:'2026-05-08',statut:'attente',commentaire:''}],demandesBET:[],ofs:[],travauxRealises:'POSE VR\nPOSE U GC\nPOSE HABILLAGE ISOLBOX',travauxPrevus:'POSE DORMANTS\nPOSE VR\nPOSE U GC',blocages:[{description:'RECEVOIR RELIQUAT MP SCHUCCO'}]},
  {id:'r-helices-t2-001',createdAt:'2026-05-08T08:00:00Z',projet:"LES HELICES D'ANFA T2",client:'OUCHTAR',lot:'Menuiserie Aluminium',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:6,montantMarche:4162839.2,cumulFacture:2528367.43,cumulAttache:2528367.43,avancement:60.74,facturation:60.74,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[{ref:'OF 26-156 CH ALU',dateLivraison:'',avancement:0,posePct:0,statut:'cours',commentaire:''}],travauxRealises:'POSE VR RDC\nPOSE CR TOUR 11',travauxPrevus:'POSE CR IMB 11 ET 3',blocages:[]},
  {id:'r-helices-t2-gc-001',createdAt:'2026-05-08T08:00:00Z',projet:"LES HELICES D'ANFA T2 GC",client:'OUCHTAR',lot:'Grand Cadre',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:3,montantMarche:2682300.0,cumulFacture:1806392.3,cumulAttache:1806392.3,avancement:67.34,facturation:67.34,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[{ref:'OF 26-132 U GC',dateLivraison:'',avancement:50,posePct:0,statut:'cours',commentaire:'URGENT'}],travauxRealises:'POSE VITRAGE GC\nPOSE U GC',travauxPrevus:'POSE VITRAGE GC\nPOSE U GC',blocages:[]},
  {id:'r-lot7-001',createdAt:'2026-05-15T08:00:00Z',projet:'Clinique LOT 7 (ONCOLOGIE + POLYCLINIQUE)',client:'MAYDANE',lot:'Menuiserie',cp:'OUSSAMA',dateReporting:'2026-05-15',effectif:12,montantMarche:4959959.82,cumulFacture:4721238.89,cumulAttache:4721238.89,avancement:95.19,facturation:95.19,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[{ref:'OF26-92/OF26-98/OF26-152',dateLivraison:'2026-05-18',avancement:0,posePct:0,statut:'non-lance',commentaire:'Attente complements livraison chassis et vitrage (MR + POLYCLINIQUE)'}],travauxRealises:'Pose Vitrage des chassis 3eme et 2eme etage et finition (ONCOLOGIE)\nPose des chassis 8eme etage (Polyclinique)',travauxPrevus:'Finition chassis 8eme etage (Polyclinique)\nPose chassis 7eme etage (Polyclinique)\nPose MR RDC (ONCOLOGIE)',blocages:[{description:'Montage des Poignees OF26-48 (en urgence)'}]},
  {id:'r-oceania-001',createdAt:'2026-05-08T08:00:00Z',projet:'OCEANIA ZENATA',client:'CASA BAY',lot:'Menuiserie Aluminium',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:2,montantMarche:10000000.0,cumulFacture:1002618.72,cumulAttache:1002618.72,avancement:10.03,facturation:10.03,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[{ref:'OF 26-140 CH ALU IMB 6',dateLivraison:'',avancement:0,posePct:0,statut:'non-lance',commentaire:''},{ref:'OF 26-81 CH ALU',dateLivraison:'',avancement:80,posePct:0,statut:'cours',commentaire:''}],travauxRealises:'POSE AXE MOTEUR IMB 7\nPOSE VR IMB 7 ET 6',travauxPrevus:'POSE VR IMB 6\nPOSE DORMANT IMB 7',blocages:[]},
  {id:'r-canopy-001',createdAt:'2026-05-08T08:00:00Z',projet:'HOTEL CANOPY',client:'YAMED',lot:'Facade & Menuiserie',cp:'EL MEHDI ROUMAN',dateReporting:'2026-05-08',effectif:7,montantMarche:22880390.92,cumulFacture:18042635.41,cumulAttache:18042635.41,avancement:78.86,facturation:78.86,pctFactAtt:100,demandes:[{type:'OF',numOF:'',nature:'Lamelles',date:'2026-01-07',statut:'attente',commentaire:'Manque Sabots'},{type:'BCP',numOF:'',nature:'Porte metallique',date:'2026-01-15',statut:'attente',commentaire:'Attente date livraison'},{type:'OF',numOF:'',nature:'Structure nacelle nettoyage',date:'2026-02-04',statut:'attente',commentaire:'Attente avance sous-traitant'},{type:'OF',numOF:'',nature:'Vitrage MR 11eme etage',date:'2026-05-04',statut:'attente',commentaire:'Attente date livraison'}],demandesBET:[],ofs:[{ref:'OF 25-146',dateLivraison:'',avancement:50,posePct:0,statut:'cours',commentaire:'Attente livraison vitrage casse verriere'},{ref:'OF 26-30',dateLivraison:'',avancement:70,posePct:0,statut:'cours',commentaire:'Manque Sabot pour fixation lamelles 11e etage'},{ref:'OF 25-632',dateLivraison:'',avancement:90,posePct:0,statut:'cours',commentaire:'Cloison CF 1/2h Manque joint parclose'},{ref:'OF 25-427',dateLivraison:'',avancement:70,posePct:0,statut:'cours',commentaire:'Attente livraison complement Vitrage Emaille RDC'},{ref:"MR SAS entree",dateLivraison:'2026-02-20',avancement:0,posePct:0,statut:'non-lance',commentaire:'Attente pose auvent metallique'}],travauxRealises:'Lever des reserves pour les MR\nPose Serreur MR 11eme etage\nPose faux plafond tole composite 11eme etage\nPose complement Structure Auvent metallique RDC\nPose Echantillon Lamelles 11eme etage\nPose Structure Equitone 1er et 2eme etage Facade PATIO',travauxPrevus:'Pose complement structure Auvent metallique\nPose Tole nervesco auvent\nPose Structure Equitone Facades OUMAIMA SAYEH et YAALA IFRANI\nPose Echantillon GC Roof TOP\nDemarrage pose MR 11eme etage',blocages:[{description:'Manque Echafaudage pour pose habillage auvent metallique'},{description:'Attente livraison Sabots pour fixation GC Roof-Top'},{description:'Attente livraison Vitrage Emaille pour MR RDC (Partie Shadow Box)'},{description:'Attente livraison Vitrage Roof-Top'}]},
  {id:'r-technopolis-001',createdAt:'2026-05-08T08:00:00Z',projet:'TECHNOPOLIS Parcelle 10 A',client:'EWANE ASSETS',lot:'Facade',cp:'EL MAHDI BENMADANI',dateReporting:'2026-05-08',effectif:18,montantMarche:9761533.65,cumulFacture:0,cumulAttache:0,avancement:0,facturation:0,pctFactAtt:0,demandes:[{type:'OF',numOF:'',nature:'BRISE SOLEIL',date:'2026-04-13',statut:'attente',commentaire:''},{type:'OF',numOF:'',nature:'MAIN COURANTE',date:'2026-04-06',statut:'attente',commentaire:'Non encore livre sur chantier'}],demandesBET:[],ofs:[{ref:'OF25-582.0',dateLivraison:'',avancement:97,posePct:0,statut:'cours',commentaire:''},{ref:'Vitrage OF25-582.0',dateLivraison:'',avancement:95,posePct:0,statut:'cours',commentaire:''},{ref:'OF25-597',dateLivraison:'',avancement:100,posePct:50,statut:'livre',commentaire:'Livraison vitrage prevue lundi'},{ref:'OF26-142',dateLivraison:'',avancement:0,posePct:0,statut:'non-lance',commentaire:'Retard livraison'}],travauxRealises:'Pose MR rideau bloc B 100%, C 100%, D 90%, A 80%\nPose U GCV 100%\nPose Vitrage MR rideau BLOC B 50%, BLOC C 45%, BLOC D 40%\nPrise de mesures main courante',travauxPrevus:'Pose Mur rideau Bloc A 100%, Bloc D 100%\nPose mur rideau terrasses EV-1 et EV-2\nPose Vitrage Mur Rideau Bloc B 80%, Bloc C 100%, Bloc D 90%\nDebut pose Pre-platine Brise-soleil',blocages:[{description:'Support non pret pour la pose'},{description:"Travaux d'etancheite pour les terrasses"},{description:'Attente finition des appuis de fenetre pour commencer la pose de vitrage'}]},
  {id:'r-anfa-blue-001',createdAt:'2026-05-08T08:00:00Z',projet:'ANFA BLEU',client:'ARC',lot:'Menuiserie Aluminium',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:4,montantMarche:7414829.38,cumulFacture:2453549.7,cumulAttache:2453549.7,avancement:33.08,facturation:33.08,pctFactAtt:100,demandes:[{type:'DA',numOF:'',nature:'CH ET VR (14 VILLAS)',date:'2026-04-27',statut:'attente',commentaire:''},{type:'DA',numOF:'',nature:'U GC VITRE',date:'2026-04-29',statut:'attente',commentaire:''},{type:'DA',numOF:'',nature:'VITRAGE GC',date:'2026-05-05',statut:'attente',commentaire:''},{type:'DA',numOF:'',nature:'GC PERFORE',date:'2026-05-05',statut:'attente',commentaire:''}],demandesBET:[],ofs:[{ref:'OF 26-118 CH ALU',dateLivraison:'',avancement:0,posePct:0,statut:'non-lance',commentaire:'URGENT'}],travauxRealises:'POSE DORMANT\nPOSE VANTAUX\nPOSE VR',travauxPrevus:'POSE DORMANT\nPOSE VANTAUX\nPOSE VR',blocages:[]},
  {id:'r-gpz-001',createdAt:'2026-05-08T08:00:00Z',projet:'GPZ',client:'REALITE MAROC',lot:'Menuiserie',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:2,montantMarche:7651505.33,cumulFacture:674827.58,cumulAttache:674827.58,avancement:8.82,facturation:8.82,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[{ref:'OF 26-72 CH',dateLivraison:'',avancement:65,posePct:0,statut:'cours',commentaire:''},{ref:'OF 26-57 VR',dateLivraison:'',avancement:40,posePct:0,statut:'cours',commentaire:''}],travauxRealises:'',travauxPrevus:'PREPARER SUPPORT\nPOSE AXE MOTEUR VR',blocages:[]},
  {id:'r-anae-001',createdAt:'2026-05-08T08:00:00Z',projet:'ANAE',client:'AL HOUCEINIA',lot:'Menuiserie',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:6,montantMarche:4166666.67,cumulFacture:3928379.91,cumulAttache:3928379.91,avancement:94.28,facturation:94.28,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[],travauxRealises:'POSE DORMANT RDC\nPOSE VANTAUX RDC\nPOSE CR',travauxPrevus:'POSE DORMANT RELIQUAT\nPOSE VANTAUX RELIQUAT\nPOSE CR',blocages:[]},
  {id:'r-zenata-r10-001',createdAt:'2026-05-08T08:00:00Z',projet:'ZENATA R+10',client:'RS PROMOTION',lot:'Menuiserie',cp:'LARBI BOUKHRISS',dateReporting:'2026-05-08',effectif:3,montantMarche:2538478.0,cumulFacture:2538478.0,cumulAttache:2538478.0,avancement:100,facturation:100,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[],travauxRealises:'POSE DORMANT RDC\nPOSE CR RELIQUAT',travauxPrevus:'POSE DORMANT RDC\nPOSE CR RELIQUAT\nPOSE VANTAUX RDC\nPOSE PORTES RDC',blocages:[]},
  {id:'r-sceno-001',createdAt:'2026-05-09T08:00:00Z',projet:'SCENO',client:'DPS',lot:'Menuiserie',cp:'IMANE',dateReporting:'2026-05-09',effectif:2,montantMarche:677196.06,cumulFacture:284739.4,cumulAttache:284739.4,avancement:42.05,facturation:42.05,pctFactAtt:100,demandes:[],demandesBET:[],ofs:[{ref:'OF DES CH en sepalumic',dateLivraison:'2026-04-20',avancement:0,posePct:0,statut:'non-lance',commentaire:''},{ref:'OF2-41',dateLivraison:'',avancement:100,posePct:100,statut:'livre',commentaire:'Tous les elements sont poses'},{ref:'OF26-60',dateLivraison:'',avancement:100,posePct:50,statut:'livre',commentaire:''},{ref:'OF26-82',dateLivraison:'',avancement:100,posePct:100,statut:'livre',commentaire:"L'OF des faux cadres, deja poses sur chantier"}],travauxRealises:"Suite des finitions sur MR\nPose du dormant d'un OB (attente finition support)\nPose de la vitre qui a ete cassee",travauxPrevus:'Suite des finitions du MR',blocages:[{description:'Risque de retard sur la livraison des elements de Sepalumic'}]}
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
  {numLigne:'8',numAff:'AF24-23',projet:"LES HELICES D'ANFA GC- TR.2",directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'ABDELHAK',effectif:'',dateDebut:'',dateFin:'',montantMarche:2682300.0,cumulAttache:1806392.3,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'86',numAff:'AF24-36',projet:'ANAE',directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'SABATY',effectif:'3',dateDebut:'',dateFin:'',montantMarche:4166666.67,cumulAttache:3928379.91,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'70',numAff:'AF24-50',projet:'VERDANA Men Alu+ GC',directeurProjet:'ANAS',chefProjet:'EZZAHIA',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:7325011.0,cumulAttache:3813544.55,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'48',numAff:'AF25-64',projet:'METROPOLIS TR2',directeurProjet:'ANAS',chefProjet:'EZZAHIA',chefChantier:'JEDDA',effectif:'5',dateDebut:'',dateFin:'',montantMarche:2013047.82,cumulAttache:948534.2,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'59',numAff:'AF25-28',projet:'VILLA JS',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:450000.0,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'31',numAff:'AF25-55',projet:'SCENO',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'ZOUINE',effectif:'1',dateDebut:'',dateFin:'',montantMarche:677196.06,cumulAttache:284739.4,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF25-7',projet:'IMM R+10 ZENATA',directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'SABATY',effectif:'1',dateDebut:'',dateFin:'',montantMarche:2538478.0,cumulAttache:2538478.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF25-54',projet:'COEUR D\'ANFA C04',directeurProjet:'ANAS',chefProjet:'KHADIJA',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:29400332.0,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'43',numAff:'AF24-23',projet:'METROPOLIS TR1',directeurProjet:'ANAS',chefProjet:'EZZAHIA',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:2549872.04,cumulAttache:2549872.04,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'27',numAff:'AF24-64',projet:'PALERMO',directeurProjet:'ANAS',chefProjet:'EZZAHIA',chefChantier:'SABATY',effectif:'',dateDebut:'',dateFin:'',montantMarche:648944.34,cumulAttache:648944.34,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'58',numAff:'AF24-53',projet:"LES HELICES D'ANFA T2 RESIDENTIEL 3 BLOCS",directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'ABDELHAK',effectif:'12',dateDebut:'',dateFin:'',montantMarche:4162839.2,cumulAttache:2528367.43,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'33',numAff:'AF25-17',projet:'VERDANA Men MET',directeurProjet:'ANAS',chefProjet:'EZZAHIA',chefChantier:'ABDELLAH',effectif:'4',dateDebut:'',dateFin:'',montantMarche:2600885.12,cumulAttache:1595904.61,bet:'RAS',achat:'',production:'',pose:'',observations:'ATT VALIDATION OFFRE'},
  {numLigne:'90',numAff:'AF25-1',projet:'ANFA BLUE',directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'VIDE',effectif:'5',dateDebut:'',dateFin:'',montantMarche:7414829.38,cumulAttache:2447728.7,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'76',numAff:'AF25-14',projet:'TANGER WATER FRONT',directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'JEDDA',effectif:'5',dateDebut:'',dateFin:'',montantMarche:11837241.0,cumulAttache:4973223.07,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'92',numAff:'AF25-66',projet:'OLIVIER',directeurProjet:'ANAS',chefProjet:'EZZAHIA',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:208532.8,cumulAttache:208532.8,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'13',numAff:'AF25-29',projet:'Immeuble SOLMARI',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'ZOUINE',effectif:'2',dateDebut:'',dateFin:'',montantMarche:1482213.86,cumulAttache:1430873.21,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF25-22',projet:'GARDENIA PARC ZENATA GPZ',directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'SABATY',effectif:'1',dateDebut:'',dateFin:'',montantMarche:7651505.33,cumulAttache:674827.58,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'77',numAff:'AF25-53',projet:'VILLAS THE RITZ CARLTON PHASE 2',directeurProjet:'ANAS',chefProjet:'BENBATI',chefChantier:'MOUFADAL',effectif:'',dateDebut:'',dateFin:'',montantMarche:3978998.1,cumulAttache:3183198.48,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'41',numAff:'AF25-24',projet:'OCEANIA ZENATA',directeurProjet:'ANAS',chefProjet:'LARBI BKS',chefChantier:'SABATY',effectif:'3',dateDebut:'',dateFin:'',montantMarche:10000000.0,cumulAttache:1002618.72,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'85',numAff:'AF25-45',projet:'PARCELLE 3- FES SHORE',directeurProjet:'ANAS',chefProjet:'MEHDI BELMADANI',chefChantier:'VIDE',effectif:'4',dateDebut:'',dateFin:'',montantMarche:6186609.07,cumulAttache:580375.24,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'57',numAff:'AF25-11',projet:'PARCELLE 10',directeurProjet:'ANAS',chefProjet:'MEHDI BENMADANI',chefChantier:'VIDE',effectif:'19',dateDebut:'',dateFin:'',montantMarche:9761533.65,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'82',numAff:'AF25-40',projet:'LES ARBORELLES',directeurProjet:'ANAS',chefProjet:'NABIL FT',chefChantier:'KOUIDER',effectif:'8',dateDebut:'',dateFin:'',montantMarche:7043730.0,cumulAttache:3164046.67,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'1',numAff:'AF22-6',projet:'CGI Casa Green Town P660',directeurProjet:'ANAS',chefProjet:'ANAS',chefChantier:'ABDELLAH',effectif:'3',dateDebut:'',dateFin:'',montantMarche:26819134.9,cumulAttache:26819134.9,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'25',numAff:'AF24-2',projet:'GEST PARK IMMEUBLES SIDNA',directeurProjet:'ANAS',chefProjet:'ANAS',chefChantier:'SABATY',effectif:'5',dateDebut:'',dateFin:'',montantMarche:6939049.97,cumulAttache:6939049.97,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'38',numAff:'AF24-48',projet:'CAMPUS TR3',directeurProjet:'ANAS',chefProjet:'ANAS',chefChantier:'ABDELHAK',effectif:'',dateDebut:'',dateFin:'',montantMarche:33409781.66,cumulAttache:33409781.66,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'78',numAff:'AF24-64',projet:'CLINIQUE AKDITAL MARRAKECH',directeurProjet:'ANAS',chefProjet:'ANAS',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:2810417.82,cumulAttache:2810417.82,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'67',numAff:'AF24-15',projet:'CLUB GAUTHIER',directeurProjet:'ANAS',chefProjet:'',chefChantier:'SABATY',effectif:'',dateDebut:'',dateFin:'',montantMarche:603420.0,cumulAttache:600040.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'22',numAff:'AF25-50',projet:'CLINIQUE LOT 7',directeurProjet:'ANAS',chefProjet:'OUSSAMA',chefChantier:'ABDELLAH',effectif:'12',dateDebut:'',dateFin:'',montantMarche:6491588.57,cumulAttache:1506295.09,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'18',numAff:'AF25-41',projet:'CABO DEL RIO2',directeurProjet:'ANAS',chefProjet:'SIHAM',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:6090193.81,cumulAttache:691561.4,bet:'Fait',achat:'RAS',production:'FAB EN COURS',pose:'POSE EN COURS',observations:''},
  {numLigne:'',numAff:'AF26-10',projet:'GAIAPOLIS',directeurProjet:'RAID',chefProjet:'SIHAM',chefChantier:'SABATY',effectif:'',dateDebut:'',dateFin:'',montantMarche:14398562.11,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'44',numAff:'AF25-52',projet:'SHIFT TOWER',directeurProjet:'RAED',chefProjet:'SAFAA',chefChantier:'Outman',effectif:'9',dateDebut:'',dateFin:'',montantMarche:45000000.0,cumulAttache:7264234.99,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'6',numAff:'AF26-9',projet:'CASA ONE',directeurProjet:'RAED',chefProjet:'SAMY',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:63482025.41,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'79',numAff:'AF26-6',projet:'MY WAY',directeurProjet:'RAID',chefProjet:'NABIL FT',chefChantier:'ABDELHAK',effectif:'',dateDebut:'',dateFin:'',montantMarche:14398562.11,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'53',numAff:'AF25-57',projet:'TMPA TANGER',directeurProjet:'NABAIL GAICH',chefProjet:'OTMANE IMMA',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:33728748.69,cumulAttache:514062.5,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'21',numAff:'AF26-2',projet:'AGENCE ANP',directeurProjet:'NABAIL GAICH',chefProjet:'OTMANE IMMA',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:29911550.73,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'45',numAff:'AF24-44',projet:'VILLA ATMANI',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'BAHLOUL',effectif:'2',dateDebut:'',dateFin:'',montantMarche:1826594.24,cumulAttache:1703776.57,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'30',numAff:'AF25-65',projet:'ANFA TOWN HOUSES',directeurProjet:'NABAIL GAICH',chefProjet:'SAAD',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:6286590.2,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'62',numAff:'AF24-19',projet:'VILLA AZAHARA - RABAT',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'VIDE',effectif:'1',dateDebut:'',dateFin:'',montantMarche:1946223.0,cumulAttache:1861863.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'39',numAff:'AF25-16',projet:'Villa Fehri',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:854133.0,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'49',numAff:'AF25-21',projet:'Villa JAM - RABAT',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:375000.0,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'71',numAff:'AF25-37',projet:'VILLA KMA',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'1',dateDebut:'',dateFin:'',montantMarche:989725.92,cumulAttache:322899.13,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'14',numAff:'AF24-60',projet:'VILLA MR RAHMOUNI HAMZA - BOUSKOURA',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'ZOUINE',effectif:'2',dateDebut:'',dateFin:'',montantMarche:233722.13,cumulAttache:223951.86,bet:'Fait',achat:'',production:'',pose:'',observations:''},
  {numLigne:'88',numAff:'AF24-66',projet:'VILLA Siham OUAZANI',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:524211.55,cumulAttache:450873.73,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'28',numAff:'AF25-23',projet:'Villa Zineb BENIS',directeurProjet:'CHBIHI YOUSEF',chefProjet:'IMANE',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:505454.25,cumulAttache:483107.7,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF25-13',projet:'Villa Mme Loubna CHRAIBI',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:201249.0,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'AF24-43',projet:'VILLA KAPSET',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'',dateDebut:'',dateFin:'',montantMarche:861724.45,cumulAttache:858250.03,bet:'',achat:'',production:'',pose:'',observations:''},
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
  {numLigne:'83',numAff:'AF25-3',projet:'AKDITAL ANFA',directeurProjet:'',chefProjet:'NABIL FT',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:6698000.53,cumulAttache:6698000.53,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'5',numAff:'AF24-41',projet:'HARHOURA HILLS - 7 IMM',directeurProjet:'',chefProjet:'LARBI BKS',chefChantier:'KOUIDER',effectif:'2',dateDebut:'',dateFin:'',montantMarche:9028418.29,cumulAttache:9028418.29,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'34',numAff:'AF25-26',projet:'USINE INDUSTRIEL TANGER',directeurProjet:'',chefProjet:'LARBI BKS',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:934280.0,cumulAttache:934280.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'84',numAff:'AF25-32',projet:'EXE CO PARTNERS B-LUGA',directeurProjet:'',chefProjet:'EZZAHIA',chefChantier:'SABATY',effectif:'',dateDebut:'',dateFin:'',montantMarche:256370.0,cumulAttache:256370.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'20',numAff:'AF20-22',projet:'COMPLEXE BALNEAIRE DAR BOUAZZA',directeurProjet:'',chefProjet:'BENBATI',chefChantier:'',effectif:'',dateDebut:'',dateFin:'',montantMarche:15631082.8,cumulAttache:15631082.8,bet:'Fait',achat:'RAS',production:'FAB EN COURS',pose:'RAS',observations:'FAB FXC EN COURS'},
  {numLigne:'19',numAff:'AF21-7',projet:'OCEAN PARK',directeurProjet:'',chefProjet:'BENBATI',chefChantier:'',effectif:'1',dateDebut:'',dateFin:'',montantMarche:17715634.89,cumulAttache:17715634.89,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'26',numAff:'AF24-22',projet:'LABORATOIRE SPI',directeurProjet:'',chefProjet:'BENBATI',chefChantier:'EL OUAFI',effectif:'',dateDebut:'',dateFin:'',montantMarche:1740742.27,cumulAttache:1740742.27,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'63',numAff:'AF25-10',projet:'SIGMA',directeurProjet:'',chefProjet:'BENBATI',chefChantier:'VIDE',effectif:'',dateDebut:'',dateFin:'',montantMarche:1065283.66,cumulAttache:1065283.66,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'81',numAff:'AF25-19',projet:'BO 52',directeurProjet:'',chefProjet:'BENBATI',chefChantier:'EL OUAFI',effectif:'',dateDebut:'',dateFin:'',montantMarche:6106988.0,cumulAttache:6106988.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'68',numAff:'AF24-29',projet:'KEPAR - SENEGAL IMM R+6 ET IMMR+8',directeurProjet:'',chefProjet:'ANAS',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:4141101.03,cumulAttache:4141101.03,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'10',numAff:'AF25-12',projet:'MPR5',directeurProjet:'',chefProjet:'ANAS',chefChantier:'BAHLOUL',effectif:'',dateDebut:'',dateFin:'',montantMarche:476880.0,cumulAttache:476880.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'40',numAff:'AF25-46',projet:'KEPAR DAKAR BLOC6',directeurProjet:'',chefProjet:'ANAS',chefChantier:'JEDDA',effectif:'',dateDebut:'',dateFin:'',montantMarche:2188772.0,cumulAttache:2188772.0,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'46',numAff:'AF25-18',projet:'EXTENSION AKDITAL MARRAKECH',directeurProjet:'',chefProjet:'',chefChantier:'ABDELLAH',effectif:'',dateDebut:'',dateFin:'',montantMarche:2634018.98,cumulAttache:2634018.98,bet:'',achat:'',production:'',pose:'',observations:''},
  {numLigne:'',numAff:'',projet:'MOHAMED FASSI EL FIHRI',directeurProjet:'CHBIHI YOUSEF',chefProjet:'SAAD',chefChantier:'ZOUINE',effectif:'0',dateDebut:'',dateFin:'',montantMarche:80830.8,cumulAttache:0,bet:'',achat:'',production:'',pose:'',observations:''}
];
