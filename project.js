// Active person filter — null means show all
let _projFilter = null;

// ── Custom project storage (Supabase) ──────────────────────────────────────
let _customProjectsCache = [];

function getCustomProjects(){ return _customProjectsCache; }

async function loadCustomProjects(){
  try{
    const {data} = await sb.from('custom_projects').select('*').order('created_at');
    _customProjectsCache = data || [];
  }catch(e){ _customProjectsCache = []; }
}

// ── Project deletion request ───────────────────────────────────────────────
async function requestProjectDeletion(projId, projName){
  if(!confirm(`Request admin approval to delete "${projName}"?`)) return;
  const user = sbUser;
  const name = sbProfile?.full_name || sbProfile?.username || user?.email || 'Unknown';
  const {error} = await sb.from('project_delete_requests').insert({
    project_id: projId,
    project_name: projName,
    requested_by: user?.id,
    requested_by_name: name,
    status: 'pending'
  });
  if(error){ alert('Failed to send request: '+error.message); return; }
  // Mark in Supabase and cache
  await sb.from('custom_projects').update({deletion_requested:true}).eq('id',projId);
  const idx = _customProjectsCache.findIndex(p=>p.id===projId);
  if(idx>=0) _customProjectsCache[idx].deletion_requested = true;
  renderProjectScreen();
  if(typeof toast==='function') toast('Deletion request sent to admin');
}

// Check Supabase for approved deletions and remove those projects locally
async function checkApprovedDeletions(){
  try{
    const list = _customProjectsCache;
    if(!list.length) return;
    const ids = list.filter(p=>p.deletion_requested).map(p=>p.id);
    if(!ids.length) return;
    const {data} = await sb.from('project_delete_requests')
      .select('project_id')
      .in('project_id', ids)
      .eq('status','approved');
    if(!data||!data.length) return;
    const approvedIds = data.map(r=>r.project_id);
    // Remove from Supabase
    await sb.from('custom_projects').delete().in('id', approvedIds);
    await sb.from('custom_project_facades').delete().in('project_id', approvedIds);
    // Update cache
    _customProjectsCache = _customProjectsCache.filter(p=>!approvedIds.includes(p.id));
  }catch(e){}
}

// ── Rename Project ─────────────────────────────────────────────────────────
function showRenameProjectModal(projId, currentName){
  const modal = document.getElementById('rename-project-modal');
  if(!modal) return;
  document.getElementById('rename-project-id').value = projId;
  document.getElementById('rename-project-input').value = currentName;
  document.getElementById('rename-project-err').style.display = 'none';
  modal.style.display = 'flex';
  setTimeout(()=>document.getElementById('rename-project-input').focus(),50);
}
function closeRenameProjectModal(){
  const modal = document.getElementById('rename-project-modal');
  if(modal) modal.style.display = 'none';
}
async function confirmRenameProject(){
  const id   = document.getElementById('rename-project-id').value;
  const name = document.getElementById('rename-project-input').value.trim();
  const err  = document.getElementById('rename-project-err');
  if(!name){ err.textContent='Please enter a name.'; err.style.display='block'; return; }
  await sb.from('custom_projects').update({name}).eq('id', id);
  const idx = _customProjectsCache.findIndex(p=>p.id===id);
  if(idx>=0) _customProjectsCache[idx].name = name;
  closeRenameProjectModal();
  renderProjectScreen();
}

// ── Delete Project panel ───────────────────────────────────────────────────
function showDeleteProjectPanel(){
  const custom = getCustomProjects().filter(p => !_projFilter || p.owner === _projFilter);
  const list = document.getElementById('del-proj-list');
  const modal = document.getElementById('del-project-modal');
  if(!modal||!list) return;
  if(!custom.length){
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#8099b0;font-size:13px;">No projects to delete.</div>';
  } else {
    list.innerHTML = custom.map(p=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:8px;background:#f8faff;border:1px solid rgba(34,79,147,0.1);">
        <span style="font-size:14px;font-weight:600;color:#1a2a3a;">${p.name}</span>
        <button onclick="requestProjectDeletion('${p.id}','${p.name.replace(/'/g,"\\'")}');closeDelProjectModal();"
          style="padding:5px 14px;border:none;border-radius:6px;background:#c02020;color:#fff;font-family:'Barlow',sans-serif;font-size:11px;font-weight:700;cursor:pointer;"
          ${p.deletion_requested?'disabled':''}>
          ${p.deletion_requested?'Pending…':'Request Deletion'}
        </button>
      </div>`).join('');
  }
  modal.style.display = 'flex';
}
function closeDelProjectModal(){
  const modal = document.getElementById('del-project-modal');
  if(modal) modal.style.display = 'none';
}

// ── Add New Project modal ──────────────────────────────────────────────────
function showAddProjectModal(){
  const modal = document.getElementById('add-project-modal');
  if(!modal) return;
  document.getElementById('add-project-input').value='';
  document.getElementById('add-project-err').style.display='none';
  modal.style.display='flex';
  setTimeout(()=>document.getElementById('add-project-input').focus(),50);
}
function closeAddProjectModal(){
  const modal = document.getElementById('add-project-modal');
  if(modal) modal.style.display='none';
}
async function confirmAddProject(){
  const input = document.getElementById('add-project-input');
  const err   = document.getElementById('add-project-err');
  const name  = (input?.value||'').trim();
  if(!name){ err.textContent='Please enter a project name.'; err.style.display='block'; return; }
  const id = 'proj-'+Date.now();
  const proj = { id, name, owner: _projFilter||'', created_at: new Date().toISOString(), deletion_requested: false };
  const {error} = await sb.from('custom_projects').insert(proj);
  if(error){ err.textContent='Failed to create project: '+error.message; err.style.display='block'; return; }
  _customProjectsCache.push(proj);

  // Auto-sync to BatiGED
  await sb.from('ged_projects').insert({id, name, director: _projFilter||'', active: true});
  // Create default deliverables structure for new project
  const _defDeliv=[
    {id:1,code:'PEC-RAP-ESS',name:"Piece Ecrite - Rapport et Rapports d'essais",blue:false,date:''},
    {id:2,code:'FTC',name:'Fiche Technique',blue:false,date:''},
    {id:3,code:'ECH',name:'Fiche Echantillon',blue:false,date:''},
    {id:4,code:'NDC',name:'Note de Calcul',blue:false,date:''},
    {id:5,code:'PLA',name:"Plans D'execution, Elevation et Details",blue:false,date:''},
    {id:6,code:'',name:'Rapports Topographiques',blue:false,date:''},
    {id:7,code:'DOE',name:'DOE (Dossiers Ouvrage Exécutés)',blue:false,date:''},
  ];
  await sb.from('project_info').insert({project:id, key:'deliverables', value:JSON.stringify(_defDeliv), updated_at:new Date().toISOString()});

  closeAddProjectModal();
  renderProjectScreen();
}

function setProjectFilter(person){
  _projFilter = (_projFilter === person) ? null : person;
  const people = ['raed','anas'];
  people.forEach(p => {
    const btn = document.getElementById(`pf-${p}`);
    if(!btn) return;
    const on = _projFilter === p;
    btn.style.background   = on ? '#224F93' : '#f0f4f9';
    btn.style.color        = on ? '#fff'     : '#1a2a3a';
    btn.style.borderColor  = on ? '#224F93'  : 'rgba(34,79,147,0.25)';
  });
  renderProjectScreen();
}

// Tracks which project IDs the current user has viewer-only access to
let _userViewerProjectsList = [];

// Desired display order — names matched case-insensitively; unknowns append at end
const _PROJECT_DISPLAY_ORDER = [
  'shift tower','casaone','coeur d\'anfa','gaiapolis','my way ii',
  'anp','tmpa','riad el andalous','taghazout'
];

function _projSortKey(name){
  const n = (name||'').toLowerCase().trim();
  const idx = _PROJECT_DISPLAY_ORDER.indexOf(n);
  return idx >= 0 ? idx : 999;
}

function renderProjectScreen(){
  const profile = sbProfile || {};
  const isAdmin = profile.role === 'admin' || profile.username === 'Admin';
  const grid = document.getElementById('projects-grid');
  if(!grid) return;

  if(isAdmin){ grid.innerHTML=''; return; }

  const isDev = (sbProfile?.role === 'developer');
  const userAssignedProjects = Array.isArray(profile.projects) ? profile.projects : [];
  const hasAllProjects = userAssignedProjects.includes('*');
  const userProjects = hasAllProjects
    ? Object.keys(PROJECT_META)
    : (userAssignedProjects.length > 0 ? userAssignedProjects : Object.keys(PROJECT_META));
  const userViewerProjects = Array.isArray(profile.viewer_projects) ? profile.viewer_projects : [];
  _userViewerProjectsList = userViewerProjects;

  // Build unified list of all visible projects
  const allProjects = [];

  // PROJECT_META entries
  Object.entries(PROJECT_META).forEach(([id, meta]) => {
    if(!hasAllProjects && !userProjects.includes(id)) return;
    if(_projFilter && !(meta.members||[]).includes(_projFilter)) return;
    allProjects.push({ id, name: meta.name, type: 'meta', meta, viewerOnly: false });
  });

  // Custom projects
  getCustomProjects().forEach(proj => {
    if(_projFilter && proj.owner !== _projFilter) return;
    const hasFullAccess = hasAllProjects || userAssignedProjects.includes(proj.id);
    const hasViewerAccess = userViewerProjects.includes(proj.id);
    if(!hasFullAccess && !hasViewerAccess) return;
    allProjects.push({ id: proj.id, name: proj.name, type: 'custom', proj, viewerOnly: !hasFullAccess && hasViewerAccess });
  });

  // Sort by defined order
  allProjects.sort((a,b) => _projSortKey(a.name) - _projSortKey(b.name));

  // Generate cards
  const cards = allProjects.map(p => {
    if(p.type === 'meta'){
      const meta = p.meta;
      if(!meta.active){
        return `<div style="background:#fff;border:1px solid rgba(34,79,147,0.12);border-radius:14px;padding:24px;cursor:not-allowed;opacity:0.5;position:relative;">
          <div style="position:absolute;top:14px;right:14px;background:#b0bec5;color:#fff;font-size:9px;font-weight:700;letter-spacing:0.1em;padding:3px 8px;border-radius:20px;text-transform:uppercase;">Coming soon</div>
          <div style="width:48px;height:48px;background:#f0f4f9;border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#b0bec5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
          </div>
          <div style="font-size:17px;font-weight:700;color:#8099b0;margin-bottom:5px;">${meta.name}</div>
        </div>`;
      }
      return `<div onclick="openProject('${p.id}')" style="background:#fff;border:2px solid #224F93;border-radius:14px;padding:24px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;position:relative;overflow:hidden;" onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 28px rgba(34,79,147,0.18)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
        <div style="position:absolute;top:14px;right:14px;background:#224F93;color:#fff;font-size:9px;font-weight:700;letter-spacing:0.1em;padding:3px 8px;border-radius:20px;text-transform:uppercase;">Active</div>
        <div style="width:48px;height:48px;background:rgba(34,79,147,0.08);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#224F93" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        </div>
        <div style="font-size:17px;font-weight:700;color:#1a2a3a;margin-bottom:5px;">${meta.name}</div>
      </div>`;
    } else {
      const proj = p.proj;
      const isPendingDel = proj.deletion_requested;
      const editBtn = isDev
        ? `<button onclick="event.stopPropagation();showRenameProjectModal('${proj.id}','${proj.name.replace(/'/g,"\\'")}')"
             title="Rename project"
             style="position:absolute;bottom:14px;right:14px;width:28px;height:28px;border-radius:6px;border:1px solid rgba(34,79,147,0.2);background:#f0f4f9;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;"
             onmouseover="this.style.background='#224F93'" onmouseout="this.style.background='#f0f4f9'">
             <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
           </button>` : '';
      const borderColor = isPendingDel?'#c02020':p.viewerOnly?'#8099b0':'#1a9458';
      const badgeText = isPendingDel?'Pending deletion':p.viewerOnly?'Viewer':'Active';
      const badgeBg = isPendingDel?'#c02020':p.viewerOnly?'#8099b0':'#1a9458';
      const iconColor = p.viewerOnly?'#8099b0':'#1a9458';
      return `<div onclick="openProject('${proj.id}')" style="background:#fff;border:2px solid ${borderColor};border-radius:14px;padding:24px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;position:relative;" onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 28px rgba(26,148,88,0.18)'" onmouseout="this.style.transform='';this.style.boxShadow=''">
        <div style="position:absolute;top:14px;right:14px;background:${badgeBg};color:#fff;font-size:9px;font-weight:700;letter-spacing:0.1em;padding:3px 8px;border-radius:20px;text-transform:uppercase;">${badgeText}</div>
        <div style="width:48px;height:48px;background:rgba(26,148,88,0.08);border-radius:10px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
        </div>
        <div style="font-size:17px;font-weight:700;color:#1a2a3a;margin-bottom:5px;">${proj.name}</div>
        ${editBtn}
      </div>`;
    }
  }).join('');

  const actionBtns = document.getElementById('proj-action-btns');
  if(actionBtns) actionBtns.style.display = isDev ? 'flex' : 'none';

  grid.innerHTML = cards;
}

async function openProject(id){
  window._activeProjectId = id;
  window._projectViewerMode = _userViewerProjectsList.includes(id);
  if(window._projectViewerMode) document.body.classList.add('viewer-mode');
  else document.body.classList.remove('viewer-mode');
  const customProj = getCustomProjects().find(p=>p.id===id);
  window._activeProjectName = customProj ? customProj.name : (PROJECT_META[id]?.name||id);

  // Hide mobile screen if navigating from mobile project list
  const _mob = document.getElementById('mobile-screen');
  if(_mob && _mob.style.display !== 'none') _mob.style.display = 'none';

  // ── phone_only always gets mobile view regardless of device ─────────────────
  if(sbProfile?.role==='phone_only'){
    document.getElementById('project-screen').style.display='none';
    if(id==='shift-tower'){
      // Shift Tower has a phone UI — open it
      if(typeof renderMobileApp==='function') renderMobileApp(sbProfile);
      else document.getElementById('mobile-screen').style.display='flex';
    } else {
      // No phone UI yet for this project
      _showMobileComingSoon(id);
    }
    return;
  }
  // ───────────────────────────────────────────────────────────────────────────

  document.getElementById('project-screen').style.display='none';
  const _rootEl=document.getElementById('root');if(_rootEl)_rootEl.innerHTML='';
  location.hash='#welcome'; // reset hash before any awaits so a concurrent router() call doesn't re-render a stale page
  if(sbProfile) updateUserChip(sbProfile.full_name||sbProfile.username||sbUser?.email||'');
  // Load project metadata (categories + facade names) from Supabase before rendering
  if(typeof _loadProjectMetaFromSB==='function') await _loadProjectMetaFromSB(id);

  // On phone (Full App mode) → show menu immediately, load data in background
  if(typeof _isOnPhone==='function' && _isOnPhone()){
    _showMobileProjectMenu();
    load(); // non-blocking — data ready by the time user taps a section
    return;
  }

  await load();
  goPage('welcome');
}

// ── Mobile project menu (Full App mode on phone) ────────────────────────────

function _mobileShowNav(title){
  // Hide mobile screen (the project menu overlay)
  const mob = document.getElementById('mobile-screen');
  if(mob) mob.style.display = 'none';

  // Remove any old top bar
  const oldBar = document.getElementById('mob-section-bar');
  if(oldBar) oldBar.remove();

  // Activate mobile section view: hides nav.nav-tabs and .sb via CSS
  document.body.classList.add('mobile-section-view');

  // Create fixed top bar with back button + page title
  const bar = document.createElement('div');
  bar.id = 'mob-section-bar';
  bar.innerHTML = `
    <button onclick="_mobileCloseSection()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;font-size:11px;font-weight:700;padding:6px 12px;border-radius:7px;cursor:pointer;font-family:'Barlow',sans-serif;flex-shrink:0;letter-spacing:0.02em;">← Menu</button>
    <span style="font-size:13px;font-weight:700;color:#fff;font-family:'Barlow',sans-serif;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.95;">${title||''}</span>
  `;
  document.body.appendChild(bar);
}

window._mobileCloseSection = function(){
  document.body.classList.remove('mobile-section-view');
  const bar = document.getElementById('mob-section-bar');
  if(bar) bar.remove();
  // Close any open modal backdrops
  document.querySelectorAll('.mbk').forEach(m => { m.style.display = 'none'; });
  _showMobileProjectMenu();
};

window.mobileOpenSection = function(pageId, title){ _mobileShowNav(title); goPage(pageId); };

window.mobileNavKey = function(key, title){
  _mobileShowNav(title);
  const fn = window._mobNavMap && window._mobNavMap[key];
  if(fn) fn();
};

window.mobToggle = function(id){
  const sub = document.getElementById('mob-sub-'+id);
  const arr = document.getElementById('mob-arr-'+id);
  if(!sub) return;
  const open = sub.style.display !== 'none';
  sub.style.display = open ? 'none' : 'block';
  if(arr) arr.style.transform = open ? '' : 'rotate(90deg)';
};

function _showMobileProjectMenu(){
  const projName = window._activeProjectName || 'Project';
  const old = document.getElementById('mobile-menu-btn');
  if(old) old.remove();

  const _sbn = (typeof activeFacadeNames==='function' && activeFacadeNames()) ||
    {NF:'North Facade', SF:'South Facade', EF:'East Facade', WF:'West Facade'};

  window._mobNavMap = {
    'proj-general':     ()=>goPage('proj-general'),
    'proj-bati-org':    ()=>goPage('proj-bati-org'),
    'proj-org':         ()=>goPage('proj-org'),
    'proj-financial':   ()=>goPage('proj-financial'),
    'bm-overview':      ()=>{ navMode='bracket'; goPage('BM-dashboard'); },
    'bm-nf':            ()=>{ navMode='bracket'; goPage('BM-NF'); },
    'bm-sf':            ()=>{ navMode='bracket'; goPage('BM-SF'); },
    'bm-ef':            ()=>{ navMode='bracket'; goPage('BM-EF'); },
    'bm-wf':            ()=>{ navMode='bracket'; goPage('BM-WF'); },
    'ucw-overview':     ()=>{ navMode='ucw'; goPage('dashboard'); setTimeout(()=>{if(typeof activateUCWMonitoring==='function')activateUCWMonitoring();},80); },
    'ucw-nf':           ()=>{ navMode='ucw'; goPage('NF'); setTimeout(()=>{if(typeof activateUCWMonitoring==='function')activateUCWMonitoring();},80); },
    'ucw-sf':           ()=>{ navMode='ucw'; goPage('SF'); setTimeout(()=>{if(typeof activateUCWMonitoring==='function')activateUCWMonitoring();},80); },
    'ucw-ef':           ()=>{ navMode='ucw'; goPage('EF'); setTimeout(()=>{if(typeof activateUCWMonitoring==='function')activateUCWMonitoring();},80); },
    'ucw-wf':           ()=>{ navMode='ucw'; goPage('WF'); setTimeout(()=>{if(typeof activateUCWMonitoring==='function')activateUCWMonitoring();},80); },
    'fab-rate':         ()=>{ if(typeof openFabRateModal==='function') openFabRateModal(); },
    'del-rate':         ()=>{ if(typeof openDeliveryRateModal==='function') openDeliveryRateModal(); },
    'inst-rate':        ()=>{ if(typeof openInstallRateModal==='function') openInstallRateModal(); },
    'fab-counting':     ()=>{ if(typeof openFabCountingModal==='function') openFabCountingModal(); },
    'of-log':           ()=>goPage('of-log'),
    'deliverables':     ()=>{ if(typeof openBatidoc==='function') openBatidoc('deliverables',null); },
    'payments':         ()=>{ if(typeof openBatidoc==='function') openBatidoc('payments',null); },
    'planning':         ()=>goPage('planning'),
    'po-log':           ()=>goPage('po-log'),
    'aging-report':     ()=>goPage('aging-report'),
    'cash-in':          ()=>goPage('cash-in'),
    'monthly-cost':     ()=>goPage('monthly-cost'),
    'fournitures':      ()=>goPage('fournitures'),
    'other-costs':      ()=>goPage('other-costs'),
    'cash-flow':        ()=>goPage('cash-flow'),
    'demo':             ()=>{ if(typeof _demoGate==='function') _demoGate(); },
    'agenda':           ()=>goPage('agenda'),
    'qc-bracket':       ()=>{ if(typeof openQCChecklist==='function') openQCChecklist('bracket-installation','Bracket Installation'); },
    'qc-panel-assy':    ()=>{ if(typeof openQCChecklist==='function') openQCChecklist('panel-assembly','Panel Assembly'); },
    'qc-panel-prep':    ()=>{ if(typeof openQCChecklist==='function') openQCChecklist('panel-preparation','Panel Prep et Inst'); },
    'signed-bracket':   ()=>{ if(typeof openSignedChecklistsView==='function') openSignedChecklistsView('bracket-installation','Signed Bracket Installation'); },
    'signed-panel-assy':()=>{ if(typeof openSignedChecklistsView==='function') openSignedChecklistsView('panel-assembly','Signed Panel Assembly'); },
    'signed-panel-prep':()=>{ if(typeof openSignedChecklistsView==='function') openSignedChecklistsView('panel-preparation','Signed Panel Prep et Inst'); },
    'ncr':              ()=>{ if(typeof openNCRModal==='function') openNCRModal(); },
    'supabase':         ()=>{ if(typeof _supaPasswordGate==='function') _supaPasswordGate(); },
    'site-stock':       ()=>goPage('site-stock'),
    'monitoring':       ()=>{
      // Go straight to the phone monitoring view — undo section-view first
      document.body.classList.remove('mobile-section-view');
      const bar = document.getElementById('mob-section-bar');
      if(bar) bar.remove();
      if(typeof renderMobileApp==='function') renderMobileApp(sbProfile);
    },
  };

  const sections = [
    { id:'projinfo',  label:'Project Info',          icon:'🏗️', color:'#2d6a8f',
      subs:[{label:'General Description',nav:'proj-general'},{label:'Batiglobe Organigram',nav:'proj-bati-org'},{label:'Project Organigram',nav:'proj-org'},{label:'Financial Info',nav:'proj-financial'}]},
    { id:'monitoring',label:'Monitoring Sheet',       icon:'📊', color:'#6d35d9', nav:'monitoring'},
    { id:'cadence',   label:'Cadence',               icon:'📈', color:'#1a9458',
      subs:[{label:'Fabrication Rate',nav:'fab-rate'},{label:'Delivery Rate',nav:'del-rate'},{label:'Installation Rate',nav:'inst-rate'},{label:'Fabrication Counting',nav:'fab-counting'}]},
    { id:'of-log',    label:'OF Logs',               icon:'🏭', color:'#e65100', nav:'of-log'},
    { id:'eng',       label:'List of Deliverables',  icon:'📋', color:'#1a5fa8', nav:'deliverables'},
    { id:'pay',       label:'Payments',              icon:'💳', color:'#1a7a3a', nav:'payments'},
    { id:'plan',      label:'Planning',              icon:'📅', color:'#e05c00', nav:'planning'},
    { id:'logs',      label:'Procurement Logs',      icon:'🗂️', color:'#c02020',
      subs:[{label:'CF Logs (PO)',nav:'po-log'},{label:'BR Logs (Aging Report)',nav:'aging-report'}]},
    { id:'cashflow',  label:'Cash Flow',             icon:'💰', color:'#00796b',
      subs:[
        {label:'Cash-In',nav:'cash-in'},
        {label:'Cash-Out',subs:[{label:'Employees Cost',nav:'monthly-cost'},{label:'Material Cost',nav:'fournitures'},{label:'Other Costs',nav:'other-costs'}]},
        {label:'Cash-Flow',nav:'cash-flow'},
      ]},
    { id:'demo',      label:'Demo',                 icon:'🎬', color:'#a855f7', nav:'demo'},
    { id:'agenda',    label:'Agenda',               icon:'📅', color:'#10b981', nav:'agenda'},
    { id:'qc',        label:'Quality Control',      icon:'✅', color:'#0097a7',
      subs:[
        {label:'Template Checklist',subs:[{label:'Bracket Installation',nav:'qc-bracket'},{label:'Panel Assembly',nav:'qc-panel-assy'},{label:'Panel Prep et Inst',nav:'qc-panel-prep'}]},
        {label:'Signed Checklist',  subs:[{label:'Signed Bracket Installation',nav:'signed-bracket'},{label:'Signed Panel Assembly',nav:'signed-panel-assy'},{label:'Signed Panel Prep et Inst',nav:'signed-panel-prep'}]},
        {label:'NCR',nav:'ncr'},
      ]},
    { id:'supabase',  label:'My Database',          icon:'⚡', color:'#3ecf8e', nav:'supabase'},
    { id:'site-stock',label:'Site Stock',           icon:'📦', color:'#0d9488', nav:'site-stock'},
  ];

  function renderSubSub(items, color){
    return items.map(item=>`
      <div onclick="mobileNavKey('${item.nav}','${item.label.replace(/'/g,"\\'")}')"
        style="display:flex;align-items:center;padding:10px 14px;border-radius:7px;cursor:pointer;"
        ontouchstart="this.style.background='${color}18'" ontouchend="this.style.background='transparent'">
        <span style="width:5px;height:5px;border-radius:50%;background:${color};flex-shrink:0;margin-right:10px;"></span>
        <span style="font-size:13px;color:#1a2a3a;font-family:'Barlow',sans-serif;font-weight:500;">${item.label}</span>
      </div>`).join('');
  }

  function renderSub(subs, color, pid){
    return subs.map((sub,i)=>{
      const sid = pid+'-s'+i;
      if(sub.subs) return `
        <div style="margin-bottom:2px;">
          <div onclick="mobToggle('${sid}')"
            style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-radius:8px;cursor:pointer;"
            ontouchstart="this.style.background='${color}18'" ontouchend="this.style.background='transparent'">
            <span style="font-size:13px;color:#1a2a3a;font-family:'Barlow',sans-serif;font-weight:600;">${sub.label}</span>
            <span id="mob-arr-${sid}" style="font-size:10px;color:#8099b0;transition:transform 0.2s;">▸</span>
          </div>
          <div id="mob-sub-${sid}" style="display:none;padding-left:8px;border-left:2px solid ${color}30;margin-left:6px;">
            ${renderSubSub(sub.subs, color)}
          </div>
        </div>`;
      return `
        <div onclick="mobileNavKey('${sub.nav}','${sub.label.replace(/'/g,"\\'")}')"
          style="display:flex;align-items:center;padding:11px 14px;border-radius:8px;cursor:pointer;"
          ontouchstart="this.style.background='${color}18'" ontouchend="this.style.background='transparent'">
          <span style="font-size:13px;color:#1a2a3a;font-family:'Barlow',sans-serif;font-weight:500;">${sub.label}</span>
        </div>`;
    }).join('');
  }

  function renderSection(s, i){
    const hasSubs = s.subs && s.subs.length;
    const click = s.nav ? `onclick="mobileNavKey('${s.nav}','${s.label.replace(/'/g,"\\'")}')"` : hasSubs ? `onclick="mobToggle('sec-${i}')"` : '';
    return `
      <div style="margin-bottom:8px;">
        <div ${click}
          style="display:flex;align-items:center;gap:12px;padding:13px 16px;background:#fff;border-radius:10px;border:1.5px solid rgba(34,79,147,0.12);cursor:pointer;"
          ontouchstart="this.style.background='${s.color}12'" ontouchend="this.style.background='#fff'">
          <div style="width:38px;height:38px;background:${s.color}18;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
            <span style="font-size:19px;line-height:1;">${s.icon}</span>
          </div>
          <span style="flex:1;font-size:15px;font-weight:600;color:#1a2a3a;font-family:'Barlow',sans-serif;">${s.label}</span>
          ${hasSubs
            ? `<span id="mob-arr-sec-${i}" style="font-size:12px;color:#8099b0;transition:transform 0.2s;">▸</span>`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`}
        </div>
        ${hasSubs ? `
        <div id="mob-sub-sec-${i}" style="display:none;background:${s.color}08;border-radius:0 0 10px 10px;padding:6px 8px 8px;border:1.5px solid ${s.color}20;border-top:none;margin-top:-4px;">
          ${renderSub(s.subs, s.color, 'sec-'+i)}
        </div>` : ''}
      </div>`;
  }

  const mob = document.getElementById('mobile-screen');
  mob.style.display = 'flex';
  mob.innerHTML = `
    <div style="background:#224F93;color:#fff;flex-shrink:0;padding-top:env(safe-area-inset-top,0px);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;">
        <button onclick="mobileBackToProjects()" style="background:rgba(255,255,255,0.18);border:none;color:#fff;font-size:11px;font-weight:600;padding:5px 11px;border-radius:6px;cursor:pointer;font-family:'Barlow',sans-serif;">← Projects</button>
        <div style="font-size:15px;font-weight:700;letter-spacing:0.03em;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${projName}</div>
        <div style="width:72px;"></div>
      </div>
    </div>
    <div style="flex:1;overflow-y:scroll;-webkit-overflow-scrolling:touch;background:#f0f4f9;padding:12px 16px 32px;">
      ${sections.map((s,i)=>renderSection(s,i)).join('')}
    </div>`;
}
// ────────────────────────────────────────────────────────────────────────────

// ── Mobile project list (phone_only multi-project) ──────────────────────────
let _mobileAllProjects = [];
let _mobileDirectorFilter = null;

async function renderMobileProjectList(){
  const prof = sbProfile || {};
  const userAssignedProjects = Array.isArray(prof.projects) ? prof.projects : [];
  const hasAllProjects = userAssignedProjects.includes('*');
  const userViewerProjects = Array.isArray(prof.viewer_projects) ? prof.viewer_projects : [];
  _userViewerProjectsList = userViewerProjects;

  const isDev = prof.role === 'developer';

  // Build full project list
  _mobileAllProjects = [];
  Object.entries(PROJECT_META).forEach(([id, meta]) => {
    if(!hasAllProjects && !userAssignedProjects.includes(id)) return;
    _mobileAllProjects.push({ id, name: meta.name, active: meta.active, members: meta.members||[] });
  });
  getCustomProjects().forEach(proj => {
    const hasFullAccess = hasAllProjects || userAssignedProjects.includes(proj.id);
    const hasViewerAccess = userViewerProjects.includes(proj.id);
    if(!hasFullAccess && !hasViewerAccess) return;
    _mobileAllProjects.push({ id: proj.id, name: proj.name, active: true, members: proj.owner ? [proj.owner] : [] });
  });
  _mobileAllProjects.sort((a,b) => _projSortKey(a.name) - _projSortKey(b.name));
  _mobileDirectorFilter = null;

  const name = prof?.full_name || prof?.username || '';
  const _allRoles = Array.isArray(prof?.roles) && prof.roles.length ? prof.roles : [prof?.role];
  const _canSwitch = _allRoles.includes('user') && _allRoles.includes('phone_only');
  const _isFullApp = prof.role === 'user';
  const switchBtn = _canSwitch ? `
    <div style="display:flex;align-items:center;gap:5px;">
      <span style="font-size:10px;color:rgba(255,255,255,0.8);font-family:'Barlow',sans-serif;font-weight:600;">Full App</span>
      <div onclick="${_isFullApp ? 'mobileSwitchToPhoneOnly()' : 'mobileSwitchToUser()'}"
        style="width:40px;height:22px;background:${_isFullApp ? '#4cd964' : 'rgba(255,255,255,0.25)'};border-radius:11px;position:relative;cursor:pointer;flex-shrink:0;transition:background 0.25s;">
        <div style="width:18px;height:18px;background:#fff;border-radius:50%;position:absolute;top:2px;left:${_isFullApp ? '20px' : '2px'};box-shadow:0 1px 3px rgba(0,0,0,0.25);transition:left 0.25s;"></div>
      </div>
    </div>` : '';

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('project-screen').style.display = 'none';
  const mob = document.getElementById('mobile-screen');
  mob.style.display = 'flex';
  mob.innerHTML = `
    <div style="background:#224F93;color:#fff;flex-shrink:0;padding-top:env(safe-area-inset-top,0px);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;">
        <div style="font-size:16px;font-weight:700;letter-spacing:0.05em;">BATIMON</div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;opacity:0.75;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
          ${switchBtn}
          <button onclick="mobileLogout()" style="background:rgba(255,255,255,0.18);border:none;color:#fff;font-size:11px;font-weight:600;padding:5px 11px;border-radius:6px;cursor:pointer;font-family:'Barlow',sans-serif;">Logout</button>
        </div>
      </div>
    </div>
    <div style="padding:16px 16px 10px;flex-shrink:0;background:#f0f4f9;border-bottom:1px solid #e0e8f0;">
      <div style="font-size:17px;font-weight:700;color:#1a2a3a;margin-bottom:12px;">Select a Director</div>
      <div style="display:flex;gap:8px;">
        <button id="mpf-raed"  onclick="setMobileProjectFilter('raed')"  style="flex:1;padding:9px 4px;border-radius:20px;border:1.5px solid rgba(34,79,147,0.25);background:#fff;color:#1a2a3a;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Raed</button>
        <button id="mpf-anas"  onclick="setMobileProjectFilter('anas')"  style="flex:1;padding:9px 4px;border-radius:20px;border:1.5px solid rgba(34,79,147,0.25);background:#fff;color:#1a2a3a;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Anas</button>
      </div>
    </div>
    <div id="mob-proj-list" style="flex:1;overflow-y:scroll;-webkit-overflow-scrolling:touch;background:#f0f4f9;padding:12px 16px 24px;"></div>
  `;
  _renderMobileProjItems();
}

function _renderMobileProjItems(){
  const list = document.getElementById('mob-proj-list');
  if(!list) return;
  const filtered = _mobileDirectorFilter
    ? _mobileAllProjects.filter(p => (p.members||[]).includes(_mobileDirectorFilter))
    : _mobileAllProjects;

  if(!filtered.length){
    list.innerHTML = `<div style="text-align:center;color:#8099b0;font-family:'Barlow',sans-serif;font-size:13px;padding:48px 0;">No projects found</div>`;
    return;
  }

  list.innerHTML = filtered.map(p => {
    if(!p.active){
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:15px 16px;margin-bottom:8px;background:#fff;border-radius:10px;border:1px solid #e0e8f0;opacity:0.5;">
        <span style="font-size:15px;font-weight:600;color:#8099b0;font-family:'Barlow',sans-serif;">${p.name}</span>
        <span style="font-size:10px;font-weight:700;color:#8099b0;background:#f0f4f9;padding:3px 8px;border-radius:10px;letter-spacing:0.06em;text-transform:uppercase;">Coming Soon</span>
      </div>`;
    }
    return `<div onclick="openProject('${p.id}')"
      style="display:flex;align-items:center;justify-content:space-between;padding:15px 16px;margin-bottom:8px;background:#fff;border-radius:10px;border:1.5px solid rgba(34,79,147,0.15);cursor:pointer;-webkit-tap-highlight-color:rgba(34,79,147,0.08);"
      ontouchstart="this.style.background='#eaf0fb'" ontouchend="this.style.background='#fff'">
      <span style="font-size:15px;font-weight:600;color:#1a2a3a;font-family:'Barlow',sans-serif;">${p.name}</span>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#224F93" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>`;
  }).join('');
}

window.setMobileProjectFilter = function(person){
  _mobileDirectorFilter = (_mobileDirectorFilter === person) ? null : person;
  ['raed','anas'].forEach(d => {
    const btn = document.getElementById('mpf-'+d);
    if(!btn) return;
    const on = _mobileDirectorFilter === d;
    btn.style.background   = on ? '#224F93' : '#fff';
    btn.style.color        = on ? '#fff'     : '#1a2a3a';
    btn.style.borderColor  = on ? '#224F93'  : 'rgba(34,79,147,0.25)';
  });
  _renderMobileProjItems();
};

function _showMobileComingSoon(projectId){
  const name = PROJECT_META[projectId]?.name || getCustomProjects().find(p=>p.id===projectId)?.name || projectId;
  const mob = document.getElementById('mobile-screen');
  mob.style.display = 'flex';
  mob.innerHTML = `
    <div style="background:#224F93;color:#fff;flex-shrink:0;padding-top:env(safe-area-inset-top,0px);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px 10px;">
        <button onclick="mobileBackToProjects()" style="background:rgba(255,255,255,0.18);border:none;color:#fff;font-size:11px;font-weight:600;padding:5px 11px;border-radius:6px;cursor:pointer;font-family:'Barlow',sans-serif;">← Back</button>
        <div style="font-size:16px;font-weight:700;letter-spacing:0.05em;">${name}</div>
        <div style="width:60px;"></div>
      </div>
    </div>
    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:32px;text-align:center;background:#f0f4f9;">
      <div style="width:72px;height:72px;background:rgba(34,79,147,0.08);border-radius:18px;display:flex;align-items:center;justify-content:center;">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#224F93" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>
      <div style="font-size:24px;font-weight:700;color:#1a2a3a;font-family:'Barlow',sans-serif;letter-spacing:0.02em;">Coming Soon</div>
      <div style="font-size:14px;color:#8099b0;font-family:'Barlow',sans-serif;line-height:1.7;max-width:280px;">The mobile view for <strong style="color:#224F93;">${name}</strong> is currently under development.</div>
    </div>
  `;
}

window.mobileBackToProjects = function(){
  renderMobileProjectList();
};

// Copy logo to project screen — called explicitly when screen is shown
function copyLogoToProjectScreen(){
  const headerLogo = document.getElementById('header-logo') || document.querySelector('header img[alt="BATIMON"]');
  const projLogo   = document.getElementById('proj-logo');
  if(projLogo){
    if(headerLogo && headerLogo.src) projLogo.src = headerLogo.src;
    else {
      // Build white SVG logo as fallback
      const whiteSrc = headerLogo ? headerLogo.src : '';
      projLogo.src = whiteSrc;
    }
  }
}

// Legacy IIFE kept for initial header logo setup only
(function copyLogo(){
  setTimeout(()=>{
    const headerLogo=document.querySelector('img[alt="BATIMON"]');
    const projLogo=document.getElementById('proj-logo');
    if(headerLogo&&projLogo){projLogo.src=headerLogo.src;}
  },200);
})();


// Sync project logo from header logo
(function setProjLogo(){
  setTimeout(()=>{
    const projLogo=document.getElementById('proj-logo');
    const headerLogo=document.getElementById('header-logo');
    if(projLogo&&headerLogo){projLogo.src=headerLogo.src;}
  },300);
})();

// Show username on project screen - handled by afterLogin
