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
  closeAddProjectModal();
  renderProjectScreen();
}

function setProjectFilter(person){
  _projFilter = (_projFilter === person) ? null : person;
  const people = ['raed','anas','nabil'];
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
  const hasAllProjects = !isDev && userAssignedProjects.includes('*');
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
    const hasFullAccess = isDev || hasAllProjects || userAssignedProjects.includes(proj.id);
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

  // ── phone_only routing ──────────────────────────────────────────────────────
  if(sbProfile?.role==='phone_only' && (typeof _isOnPhone==='function' ? _isOnPhone() : false)){
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
  if(sbProfile) updateUserChip(sbProfile.full_name||sbProfile.username||sbUser?.email||'');
  // Load project metadata (categories + facade names) from Supabase before rendering
  if(typeof _loadProjectMetaFromSB==='function') await _loadProjectMetaFromSB(id);
  await load();
  goPage('dashboard');
}

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
    if(!isDev && !hasAllProjects && !userAssignedProjects.includes(id)) return;
    _mobileAllProjects.push({ id, name: meta.name, active: meta.active, members: meta.members||[] });
  });
  getCustomProjects().forEach(proj => {
    const hasFullAccess = isDev || hasAllProjects || userAssignedProjects.includes(proj.id);
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
        <button id="mpf-nabil" onclick="setMobileProjectFilter('nabil')" style="flex:1;padding:9px 4px;border-radius:20px;border:1.5px solid rgba(34,79,147,0.25);background:#fff;color:#1a2a3a;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Nabil</button>
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
  ['raed','anas','nabil'].forEach(d => {
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


// Set project logo with inverted colors
(function setProjLogo(){
  setTimeout(()=>{
    const projLogo=document.getElementById('proj-logo');
    const headerLogo=document.getElementById('header-logo');
    const whiteSrc='data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPCFET0NUWVBFIHN2ZyBQVUJMSUMgIi0vL1czQy8vRFREIFNWRyAxLjEvL0VOIiAiaHR0cDovL3d3dy53My5vcmcvR3JhcGhpY3MvU1ZHLzEuMS9EVEQvc3ZnMTEuZHRkIj4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMSIgd2lkdGg9IjgzNnB4IiBoZWlnaHQ9IjQ3M3B4IiBzdHlsZT0ic2hhcGUtcmVuZGVyaW5nOmdlb21ldHJpY1ByZWNpc2lvbjsgdGV4dC1yZW5kZXJpbmc6Z2VvbWV0cmljUHJlY2lzaW9uOyBpbWFnZS1yZW5kZXJpbmc6b3B0aW1pemVRdWFsaXR5OyBmaWxsLXJ1bGU6ZXZlbm9kZDsgY2xpcC1ydWxlOmV2ZW5vZGQiIHhtbG5zOnhsaW5rPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hsaW5rIj4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0idHJhbnNwYXJlbnQiIGQ9Ik0gLTAuNSwtMC41IEMgMjc4LjE2NywtMC41IDU1Ni44MzMsLTAuNSA4MzUuNSwtMC41QyA4MzUuNSwxNTcuMTY3IDgzNS41LDMxNC44MzMgODM1LjUsNDcyLjVDIDU1Ni44MzMsNDcyLjUgMjc4LjE2Nyw0NzIuNSAtMC41LDQ3Mi41QyAtMC41LDMxNC44MzMgLTAuNSwxNTcuMTY3IC0wLjUsLTAuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBkPSJNIDc4LjUsNTQuNSBDIDExNy41MDEsNTQuMzMzMyAxNTYuNTAxLDU0LjUgMTk1LjUsNTVDIDIwOS45MjIsNTkuMDk0MiAyMTguNDIyLDY4LjU5NDIgMjIxLDgzLjVDIDIyMS41LDExNy44MzIgMjIxLjY2NywxNTIuMTY1IDIyMS41LDE4Ni41QyAyMTkuODMzLDE4Ni41IDIxOC4xNjcsMTg2LjUgMjE2LjUsMTg2LjVDIDIxNi42NjcsMTUyLjQ5OCAyMTYuNSwxMTguNDk4IDIxNiw4NC41QyAyMTQuMjEzLDcyLjA1MDkgMjA3LjM3OSw2My44ODQyIDE5NS41LDYwQyAxNTYuNSw1OS4zMzMzIDExNy41LDU5LjMzMzMgNzguNSw2MEMgNzEuNjQ1OCw2MS41MTYxIDY2LjQ3OTEsNjUuMzQ5NCA2Myw3MS41QyA2MC41MzM5LDc2LjIzMTYgNTguODY3Myw4MS4yMzE2IDU4LDg2LjVDIDU3LjMzMzMsMTM5LjgzMyA1Ny4zMzMzLDE5My4xNjcgNTgsMjQ2LjVDIDU5LjEzMzMsMjU2Ljk0NCA2My45NjY2LDI2NS4xMTEgNzIuNSwyNzFDIDc0Ljc4ODUsMjcxLjgyMiA3Ny4xMjE4LDI3Mi40ODkgNzkuNSwyNzNDIDg4LjUsMjczLjMzMyA5Ny41LDI3My42NjcgMTA2LjUsMjc0QyAxMDguNSwyNzQuNjY3IDEwOS44MzMsMjc2IDExMC41LDI3OEMgMTAwLjE2NywyNzguNjY3IDg5LjgzMzMsMjc4LjY2NyA3OS41LDI3OEMgNzAuNjEzMSwyNzYuNjM5IDYzLjc3OTcsMjcyLjEzOSA1OSwyNjQuNUMgNTUuODAxNywyNTguOTA1IDUzLjgwMTcsMjUyLjkwNSA1MywyNDYuNUMgNTIuMzMzMywxOTMuMTY3IDUyLjMzMzMsMTM5LjgzMyA1Myw4Ni41QyA1NC42NjczLDcwLjA2ODcgNjMuMTY3Myw1OS40MDIxIDc4LjUsNTQuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBkPSJNIDQyNS41LDg2LjUgQyA0NTAuODMzLDg2LjUgNDc2LjE2Nyw4Ni41IDUwMS41LDg2LjVDIDUwMS41LDkwLjE2NjcgNTAxLjUsOTMuODMzMyA1MDEuNSw5Ny41QyA0OTAuNjU0LDk3LjE3MjIgNDc5Ljk4Nyw5Ny41MDU2IDQ2OS41LDk4LjVDIDQ2OS41LDEyMy4xNjcgNDY5LjUsMTQ3LjgzMyA0NjkuNSwxNzIuNUMgNDY1LjUsMTcyLjUgNDYxLjUsMTcyLjUgNDU3LjUsMTcyLjVDIDQ1Ny41LDE0Ny44MzMgNDU3LjUsMTIzLjE2NyA0NTcuNSw5OC41QyA0NDcuMDEzLDk3LjUwNTYgNDM2LjM0Niw5Ny4xNzIyIDQyNS41LDk3LjVDIDQyNS41LDkzLjgzMzMgNDI1LjUsOTAuMTY2NyA0MjUuNSw4Ni41IFoiLz48L2c+CjxnPjxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmZmZmZmYiIGQ9Ik0gNTUzLjUsODYuNSBDIDU2MS41MTEsODUuNDM4IDU2OC44NDQsODcuMTA0NiA1NzUuNSw5MS41QyA1NzcuNzcyLDg5LjM0ODkgNTgwLjQzOSw4Ny44NDg5IDU4My41LDg3QyA1OTUuNzEsODQuMDU3NiA2MDQuODc2LDg3Ljg5MSA2MTEsOTguNUMgNjExLjUsMTIzLjE2NCA2MTEuNjY3LDE0Ny44MzEgNjExLjUsMTcyLjVDIDYwNy44MzMsMTcyLjUgNjA0LjE2NywxNzIuNSA2MDAuNSwxNzIuNUMgNjAwLjY2NywxNDkuNDk4IDYwMC41LDEyNi40OTggNjAwLDEwMy41QyA1OTQuMzY4LDk3LjIwODkgNTg4LjM2OCw5Ni44NzU2IDU4MiwxMDIuNUMgNTgwLjczLDEyNS44MzcgNTgwLjU2NCwxNDkuMTcxIDU4MS41LDE3Mi41QyA1NzcuNSwxNzIuNSA1NzMuNSwxNzIuNSA1NjkuNSwxNzIuNUMgNTY5LjY2NywxNTAuMTY0IDU2OS41LDEyNy44MzEgNTY5LDEwNS41QyA1NjYuODk3LDk5LjUzMDYgNTYyLjczLDk3LjM2MzkgNTU2LjUsOTlDIDU1NS4wMTksOTkuOTgwMyA1NTMuNjg1LDEwMS4xNDcgNTUyLjUsMTAyLjVDIDU1MC43MzEsMTI1LjgyMyA1NTAuMzk4LDE0OS4xNTcgNTUxLjUsMTcyLjVDIDU0Ny41LDE3Mi41IDU0My41LDE3Mi41IDUzOS41LDE3Mi41QyA1MzkuMzMzLDE0OC4xNjQgNTM5LjUsMTIzLjgzMSA1NDAsOTkuNUMgNTQyLjc0Nyw5My4yNTE4IDU0Ny4yNDcsODguOTE4NSA1NTMuNSw4Ni41IFoiLz48L2c+CjxnPjxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmZmZmZmYiIGQ9Ik0gNzIzLjUsODYuNSBDIDczOC41MDQsODYuMzMzNCA3NTMuNTA0LDg2LjUwMDEgNzY4LjUsODdDIDc3Nyw4OC44MzMzIDc4Mi4xNjcsOTQgNzg0LDEwMi41QyA3ODQuNSwxMjUuODMxIDc4NC42NjcsMTQ5LjE2NCA3ODQuNSwxNzIuNUMgNzgwLjUsMTcyLjUgNzc2LjUsMTcyLjUgNzcyLjUsMTcyLjVDIDc3Mi42NjcsMTQ5LjgzMSA3NzIuNSwxMjcuMTY0IDc3MiwxMDQuNUMgNzcxLjE2NywxMDEuNjY3IDc2OS4zMzMsOTkuODMzMyA3NjYuNSw5OUMgNzUzLjUsOTguMzMzMyA3NDAuNSw5OC4zMzMzIDcyNy41LDk5QyA3MjQuODAxLDk5Ljk2NjQgNzIyLjk2NywxMDEuOCA3MjIsMTA0LjVDIDcyMS41LDEyNy4xNjQgNzIxLjMzMywxNDkuODMxIDcyMS41LDE3Mi41QyA3MTcuNSwxNzIuNSA3MTMuNSwxNzIuNSA3MDkuNSwxNzIuNUMgNzA5LjMzMywxNDkuMTY0IDcwOS41LDEyNS44MzEgNzEwLDEwMi41QyA3MTEuODMxLDk0Ljg0MTggNzE2LjMzMSw4OS41MDg0IDcyMy41LDg2LjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZmZmZmZiIgZD0iTSAxODcuNSw4Ny41IEMgMTg5LjgzMyw4Ny41IDE5Mi4xNjcsODcuNSAxOTQuNSw4Ny41QyAxOTQuNjY3LDEyNi41MDEgMTk0LjUsMTY1LjUwMSAxOTQsMjA0LjVDIDE4MC40MzgsMjE2LjkyOSAxNjYuMjcxLDIyOC4yNjIgMTUxLjUsMjM4LjVDIDE1MC4zNDksMTkzLjE5NSAxNTAuMTgyLDE0Ny44NjIgMTUxLDEwMi41QyAxNjMuMjksOTcuNTc2MSAxNzUuNDU3LDkyLjU3NjEgMTg3LjUsODcuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBkPSJNIDUxMy41LDg2LjUgQyA1MTcuMTY3LDg2LjUgNTIwLjgzMyw4Ni41IDUyNC41LDg2LjVDIDUyNC41LDExNS4xNjcgNTI0LjUsMTQzLjgzMyA1MjQuNSwxNzIuNUMgNTIwLjgzMywxNzIuNSA1MTcuMTY3LDE3Mi41IDUxMy41LDE3Mi41QyA1MTMuNSwxNDMuODMzIDUxMy41LDExNS4xNjcgNTEzLjUsODYuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSJ0cmFuc3BhcmVudCIgZD0iTSA0MjUuNSw4Ni41IEMgNDI1LjUsOTAuMTY2NyA0MjUuNSw5My44MzMzIDQyNS41LDk3LjVDIDQzNi4zNDYsOTcuMTcyMiA0NDcuMDEzLDk3LjUwNTYgNDU3LjUsOTguNUMgNDQ2LjUsOTguNSA0MzUuNSw5OC41IDQyNC41LDk4LjVDIDQyNC4xODMsOTQuMjk4NCA0MjQuNTE3LDkwLjI5ODQgNDI1LjUsODYuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSJ0cmFuc3BhcmVudCIgZD0iTSA1MDEuNSw4Ni41IEMgNTAyLjQ4Myw5MC4yOTg0IDUwMi44MTcsOTQuMjk4NCA1MDIuNSw5OC41QyA0OTEuNSw5OC41IDQ4MC41LDk4LjUgNDY5LjUsOTguNUMgNDc5Ljk4Nyw5Ny41MDU2IDQ5MC42NTQsOTcuMTcyMiA1MDEuNSw5Ny41QyA1MDEuNSw5My44MzMzIDUwMS41LDkwLjE2NjcgNTAxLjUsODYuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSJ0cmFuc3BhcmVudCIgZD0iTSAxODEuNSwxMDEuNSBDIDE4Mi44MjIsMTAxLjMzIDE4My45ODksMTAxLjY2MyAxODUsMTAyLjVDIDE4NS42NjcsMTExLjgzMyAxODUuNjY3LDEyMS4xNjcgMTg1LDEzMC41QyAxNzYuMDA5LDEzMy45OTcgMTY2Ljg0MiwxMzYuOTk3IDE1Ny41LDEzOS41QyAxNTcuMzM0LDEyOS44MjggMTU3LjUsMTIwLjE2MSAxNTgsMTEwLjVDIDE2NS44NzcsMTA3LjM3OCAxNzMuNzEsMTA0LjM3OCAxODEuNSwxMDEuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBkPSJNIDEzNS41LDI0Ny41IEMgMTM0LjU2NiwyNDYuNDMyIDEzNC4yMzIsMjQ1LjA5OSAxMzQuNSwyNDMuNUMgMTMxLjgzMywyNDMuNSAxMjkuMTY3LDI0My41IDEyNi41LDI0My41QyAxMjUuMTY3LDI0My41IDEyMy44MzMsMjQzLjUgMTIyLjUsMjQzLjVDIDEyMi41LDIxNi4xNjcgMTIyLjUsMTg4LjgzMyAxMjIuNSwxNjEuNUMgMTIyLjMzNCwxNTIuODI3IDEyMi41LDE0NC4xNiAxMjMsMTM1LjVDIDEzMC42NjcsMTMyLjUgMTM4LjMzMywxMjkuNSAxNDYsMTI2LjVDIDE0Ni44MzMsMTY2LjUwNCAxNDYuNjY3LDIwNi41MDQgMTQ1LjUsMjQ2LjVDIDE0Mi4yNDIsMjQ3LjQxNyAxMzguOTA5LDI0Ny43NTEgMTM1LjUsMjQ3LjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0idHJhbnNwYXJlbnQiIGQ9Ik0gMTM5LjUsMTM1LjUgQyAxNDAuNDk2LDEzNS40MTQgMTQxLjMyOSwxMzUuNzQ4IDE0MiwxMzYuNUMgMTQyLjY2NywxNDAuODMzIDE0Mi42NjcsMTQ1LjE2NyAxNDIsMTQ5LjVDIDEzNy4yMTcsMTUxLjIyNSAxMzIuNTUxLDE1My4yMjUgMTI4LDE1NS41QyAxMjcuNTAxLDE1MC4xNzcgMTI3LjMzNCwxNDQuODQ0IDEyNy41LDEzOS41QyAxMzEuNzg0LDEzOC43MzkgMTM1Ljc4NCwxMzcuNDA1IDEzOS41LDEzNS41IFoiLz48L2c+CjxnPjxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmZmZmZmYiIGQ9Ik0gOTYuNSwxNjYuNSBDIDk2LjUsMTY3LjUgOTYuNSwxNjguNSA5Ni41LDE2OS41QyA5My45MjI5LDE3MC42OSA5My4wODk1LDE3Mi42OSA5NCwxNzUuNUMgOTQuNjcwOCwxNzQuNzQ4IDk1LjUwNDEsMTc0LjQxNCA5Ni41LDE3NC41QyA5NS44NDYsMTkzLjg2MyA5Ni41MTI2LDIxMi44NjMgOTguNSwyMzEuNUMgOTguNSwyMzQuMTY3IDk4LjUsMjM2LjgzMyA5OC41LDIzOS41QyA5Ny44NDY2LDI0MC44MDcgOTcuMTc5OSwyNDIuMTQgOTYuNSwyNDMuNUMgOTQuMjUyOSwyNDQuMjQ1IDkyLjQxOTYsMjQ1LjU3OCA5MSwyNDcuNUMgOTAuMzMzMywyMjEuMTY3IDkwLjMzMzMsMTk0LjgzMyA5MSwxNjguNUMgOTIuNzI1NSwxNjcuNTM2IDk0LjU1ODgsMTY2Ljg2OSA5Ni41LDE2Ni41IFoiLz48L2c+CjxnPjxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9InRyYW5zcGFyZW50IiBkPSJNIDk2LjUsMTY5LjUgQyA5Ni41LDE3MS4xNjcgOTYuNSwxNzIuODMzIDk2LjUsMTc0LjVDIDk1LjUwNDEsMTc0LjQxNCA5NC42NzA4LDE3NC43NDggOTQsMTc1LjVDIDkzLjA4OTUsMTcyLjY5IDkzLjkyMjksMTcwLjY5IDk2LjUsMTY5LjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZmZmZmZiIgZD0iTSAxMjIuNSwxNjEuNSBDIDEyMi41LDE4OC44MzMgMTIyLjUsMjE2LjE2NyAxMjIuNSwyNDMuNUMgMTIwLjk4MywyNDMuNDg5IDExOS44MTYsMjQyLjgyMyAxMTksMjQxLjVDIDExOC41LDIxNC44MzUgMTE4LjMzMywxODguMTY5IDExOC41LDE2MS41QyAxMTkuODMzLDE2MS41IDEyMS4xNjcsMTYxLjUgMTIyLjUsMTYxLjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZmZmZmZiIgZD0iTSAxMzUuNSwyODUuNSBDIDEzMy41LDI4NS41IDEzMS41LDI4NS41IDEyOS41LDI4NS41QyAxMjIuNTcyLDI3OS41NzUgMTE1LjkwNSwyNzMuMjQyIDEwOS41LDI2Ni41QyAxMDMuNDc1LDI2My4xNDIgOTguODA4MiwyNTguNDc1IDk1LjUsMjUyLjVDIDk3Ljk3MTEsMjQ2LjcgMTAyLjMwNCwyNDMuMDMzIDEwOC41LDI0MS41QyAxMTYuNDEzLDI0Ni40MDIgMTI0LjA4LDI1MS43MzYgMTMxLjUsMjU3LjVDIDEzMS42MiwyNTguNTg2IDEzMi4yODcsMjU5LjI1MyAxMzMuNSwyNTkuNUMgMTM0LjcxMywyNTkuMjUzIDEzNS4zOCwyNTguNTg2IDEzNS41LDI1Ny41QyAxNDEuNDQxLDI1My4xODUgMTQ3LjQ0MSwyNDguODUyIDE1My41LDI0NC41QyAxNTUuMDA1LDI0My4xNTggMTU1LjY3MiwyNDEuNDkyIDE1NS41LDIzOS41QyAxNjEuNDEsMjM4LjUzOSAxNjYuMDc3LDIzNS41MzkgMTY5LjUsMjMwLjVDIDE3Ni41ODUsMjI3LjI4MyAxODIuNTg1LDIyMi42MTcgMTg3LjUsMjE2LjVDIDE5OS4xODQsMjA4Ljk5MiAyMTAuNTE3LDIwMC45OTIgMjIxLjUsMTkyLjVDIDIyMy41LDE5MC41IDIyNS41LDE4OC41IDIyNy41LDE4Ni41QyAyMzAuNzY4LDE4NS41MTMgMjM0LjEwMiwxODUuMTggMjM3LjUsMTg1LjVDIDIzNy43OTksMTg3LjYwNCAyMzcuNDY2LDE4OS42MDQgMjM2LjUsMTkxLjVDIDIyNC43NzEsMjAzLjg5OCAyMTIuNDM4LDIxNS41NjUgMTk5LjUsMjI2LjVDIDE5MC4yNSwyMzYuNTg4IDE4MC4yNSwyNDUuNzU1IDE2OS41LDI1NEMgMTU5LjA5NCwyNjUuNjY4IDE0Ny43NjEsMjc2LjE2OCAxMzUuNSwyODUuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBkPSJNIDk4LjUsMjM5LjUgQyA5OC41LDIzNi44MzMgOTguNSwyMzQuMTY3IDk4LjUsMjMxLjVDIDk4LjUsMjA5LjUgOTguNSwxODcuNSA5OC41LDE2NS41QyA5OS4yNjEzLDE2NC42MDkgMTAwLjI2MSwxNjMuOTQyIDEwMS41LDE2My41QyAxMDIuNjY2LDE4Ny40OTMgMTAyLjgzMywyMTEuNDkzIDEwMiwyMzUuNUMgMTAxLjk0MywyMzcuOTEgMTAwLjc3NiwyMzkuMjQ0IDk4LjUsMjM5LjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZmZmZmZiIgZD0iTSA5OC41LDE2NS41IEMgOTguNSwxODcuNSA5OC41LDIwOS41IDk4LjUsMjMxLjVDIDk2LjUxMjYsMjEyLjg2MyA5NS44NDYsMTkzLjg2MyA5Ni41LDE3NC41QyA5Ni41LDE3Mi44MzMgOTYuNSwxNzEuMTY3IDk2LjUsMTY5LjVDIDk2LjUsMTY4LjUgOTYuNSwxNjcuNSA5Ni41LDE2Ni41QyA5Ni44NDE3LDE2NS42NjIgOTcuNTA4NCwxNjUuMzI4IDk4LjUsMTY1LjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZmZmZmZiIgZD0iTSAyMjAuNSwyMTQuNSBDIDIyMS42NTksMjI1Ljk5MyAyMjEuODI2LDIzNy42NTkgMjIxLDI0OS41QyAyMTguMzA5LDI2NC44NTMgMjA5LjQ3NiwyNzQuMzUzIDE5NC41LDI3OEMgMTgxLjgzMywyNzguNjY3IDE2OS4xNjcsMjc4LjY2NyAxNTYuNSwyNzhDIDE1Ny44MzMsMjc2LjY2NyAxNTkuMTY3LDI3NS4zMzMgMTYwLjUsMjc0QyAyMDIuMTczLDI4Mi4zMTYgMjIxLjAwNywyNjUuNDgyIDIxNywyMjMuNUMgMjE2LjkxMywyMTkuOTIgMjE4LjA4LDIxNi45MiAyMjAuNSwyMTQuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBkPSJNIDE5NC41LDI0Ny41IEMgMTkxLjgzMywyNDcuNSAxODkuMTY3LDI0Ny41IDE4Ni41LDI0Ny41QyAxODguNzk1LDI0NC43MDMgMTkxLjI5NSwyNDIuMDM2IDE5NCwyMzkuNUMgMTk0LjQ5NywyNDIuMTQ2IDE5NC42NjQsMjQ0LjgxMyAxOTQuNSwyNDcuNSBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBkPSJNIDEyNi41LDI0My41IEMgMTI5LjE2NywyNDMuNSAxMzEuODMzLDI0My41IDEzNC41LDI0My41QyAxMzQuMjMyLDI0NS4wOTkgMTM0LjU2NiwyNDYuNDMyIDEzNS41LDI0Ny41QyAxMzUuMzgsMjQ4LjU4NiAxMzQuNzEzLDI0OS4yNTMgMTMzLjUsMjQ5LjVDIDEzMS4zNTQsMjQ4LjEwNiAxMjkuMDIxLDI0Ny40NCAxMjYuNSwyNDcuNUMgMTI2LjUsMjQ2LjE2NyAxMjYuNSwyNDQuODMzIDEyNi41LDI0My41IFoiLz48L2c+CjxnPjxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9IiNmZmZmZmYiIGQ9Ik0gMTg2LjUsMjQ3LjUgQyAxODkuMTY3LDI0Ny41IDE5MS44MzMsMjQ3LjUgMTk0LjUsMjQ3LjVDIDE5NC41LDI0OC44MzMgMTk0LjUsMjUwLjE2NyAxOTQuNSwyNTEuNUMgMTkxLjgzMywyNTEuNSAxODkuMTY3LDI1MS41IDE4Ni41LDI1MS41QyAxODYuNSwyNTAuMTY3IDE4Ni41LDI0OC44MzMgMTg2LjUsMjQ3LjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0idHJhbnNwYXJlbnQiIGQ9Ik0gMTMxLjUsMjU3LjUgQyAxMzIuODMzLDI1Ny41IDEzNC4xNjcsMjU3LjUgMTM1LjUsMjU3LjVDIDEzNS4zOCwyNTguNTg2IDEzNC43MTMsMjU5LjI1MyAxMzMuNSwyNTkuNUMgMTMyLjI4NywyNTkuMjUzIDEzMS42MiwyNTguNTg2IDEzMS41LDI1Ny41IFoiLz48L2c+CjxnPjxwYXRoIHN0eWxlPSJvcGFjaXR5OjEiIGZpbGw9InRyYW5zcGFyZW50IiBkPSJNIDEyOS41LDI4NS41IEMgMTMxLjUsMjg1LjUgMTMzLjUsMjg1LjUgMTM1LjUsMjg1LjVDIDEzMy4yOTUsMjg3LjkxNiAxMzEuMjk1LDI4Ny45MTYgMTI5LjUsMjg1LjUgWiIvPjwvZz4KPGc+PHBhdGggc3R5bGU9Im9wYWNpdHk6MSIgZmlsbD0iI2ZmZmZmZiIgZmlsbC1ydWxlPSJldmVub2RkIiBkPSJNIDI2NS41LDg2LjUgQyAyODYuODM2LDg2LjMzMzQgMzA4LjE2OSw4Ni41IDMyOS41LDg3QyAzNDAuMTg1LDkxLjM5NTcgMzQ0LjUxOSw5OS4zOTU3IDM0Mi41LDExMUMgMzQzLjU0NSwxMTguMTU5IDM0MS44NzgsMTI0LjQ5MyAzMzcuNSwxMzBDIDMzOS44NzgsMTMxLjkxNSAzNDEuMzc4LDEzNC40MTUgMzQyLDEzNy41QyAzNDIuODcsMTQ1Ljg5NyAzNDIuNTM3LDE1NC4yMyAzNDEsMTYyLjVDIDMzOC40NDgsMTY2LjcxOSAzMzQuOTQ4LDE2OS44ODYgMzMwLjUsMTcyQyAzMDguODM2LDE3Mi41IDI4Ny4xNjksMTcyLjY2NyAyNjUuNSwxNzIuNUMgMjY1LjUsMTQzLjgzMyAyNjUuNSwxMTUuMTY3IDI2NS41LDg2LjUgWiBNIDMyMi41LDk4LjUgQyAzMjYuOTIzLDk4Ljc0NDUgMzI5Ljc1NiwxMDEuMDc4IDMzMSwxMDUuNUMgMzMyLjcwMiwxMTIuMjQ1IDMzMS4yMDIsMTE4LjA3OCAzMjYuNSwxMjNDIDMxMC4xNywxMjMuNSAyOTMuODM3LDEyMy42NjcgMjc3LjUsMTIzLjVDIDI3Ny41LDExNS4xNjcgMjc3LjUsMTA2LjgzMyAyNzcuNSw5OC41QyAyOTIuNSw5OC41IDMwNy41LDk4LjUgMzIyLjUsOTguNSBaIFogTSAyNzcuNSwxMzUuNSBDIDI5My41MDMsMTM1LjMzMyAzMDkuNTAzLDEzNS41IDMyNS41LDEzNkMgMzI5Ljg3MiwxMzguNzQzIDMzMS44NzIsMTQyLjc0MyAzMzEuNSwxNDhDIDMzMS43MiwxNTIuMzg5IDMzMC4zODcsMTU2LjIyMiAzMjcuNSwxNTkuNUMgMzI2LjMxMSwxNjAuNDI5IDMyNC45NzgsMTYwLjc2MiAzMjMuNSwxNjAuNUMgMzA4LjE2NywxNjAuNSAyOTIuODMzLDE2MC41IDI3Ny41LDE2MC41QyAyNzcuNSwxNTIuMTY3IDI3Ny41LDE0My44MzMgMjc3LjUsMTM1LjUgWiBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0gMzgzLjUsODYuNSBDIDM4OC44MzMsODYuNSAzOTQuMTY3LDg2LjUgMzk5LjUsODYuNUMgNDEwLjQxOCwxMTQuOTA2IDQyMS43NTIsMTQzLjIzOSA0MzMuNSwxNzEuNUMgNDI5LjI4NSwxNzIuNzk4IDQyNS4xMTgsMTcyLjc5OCA0MjEsMTcxLjVDIDQxOS40NjUsMTY2LjM5NiA0MTcuNjMyLDE2MS4zOTYgNDE1LjUsMTU2LjVDIDM5OS41LDE1NS4xNjcgMzgzLjUsMTU1LjE2NyAzNjcuNSwxNTYuNUMgMzY1LjMxNCwxNjEuNjA1IDM2Mi45OCwxNjYuNjA1IDM2MC41LDE3MS41QyAzNTYuNSwxNzIuODMzIDM1Mi41LDE3Mi44MzMgMzQ4LjUsMTcxLjVDIDM2MC42ODgsMTQzLjMzNSAzNzIuMzU0LDExNS4wMDIgMzgzLjUsODYuNSBaIE0gMzkwLjUsOTguNSBDIDM5Ny45MjUsMTEzLjM1NSA0MDQuMjU5LDEyOC42ODggNDA5LjUsMTQ0LjVDIDM5Ni44MjksMTQ0LjY2NyAzODQuMTYyLDE0NC41IDM3MS41LDE0NEMgMzc4LjUxLDEyOS4xNDQgMzg0Ljg0MywxMTMuOTc4IDM5MC41LDk4LjUgWiBaIi8+PC9nPgo8Zz48cGF0aCBzdHlsZT0ib3BhY2l0eToxIiBmaWxsPSIjZmZmZmZmIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0gNjM3LjUsODYuNSBDIDY1My4xNyw4Ni4zMzM0IDY2OC44MzcsODYuNTAwMSA2ODQuNSw4N0MgNjkxLjU5OCw4OS4wOTkzIDY5Ni40MzIsOTMuNTk5MyA2OTksMTAwLjVDIDY5OS42NjcsMTE5LjgzMyA2OTkuNjY3LDEzOS4xNjcgNjk5LDE1OC41QyA2OTcuNjk4LDE2NC4yNTggNjk0LjUzMSwxNjguNzU4IDY4OS41LDE3MkMgNjcyLjIxMSwxNzMuNTk1IDY1NC44NzgsMTczLjkyOCA2MzcuNSwxNzNDIDYyOS42NzcsMTcxLjE3NyA2MjQuODQzLDE2Ni4zNDMgNjIzLDE1OC41QyA2MjIuMzMzLDEzOS44MzMgNjIyLjMzMywxMjEuMTY3IDYyMywxMDIuNUMgNjIzLjI2OSw5OS42NDg0IDYyNC4xMDMsOTYuOTgxOCA2MjUuNSw5NC41QyA2MjkuMDE4LDkwLjk1ODkgNjMzLjAxOCw4OC4yOTIyIDYzNy41LDg2LjUgWiBNIDYzNy41LDk4LjUgQyA2NTMuMTcsOTguMzMzNCA2NjguODM3LDk4LjUwMDEgNjg0LjUsOTlDIDY4NS42NjcsMTAwLjE2NyA2ODYuODMzLDEwMS4zMzMgNjg4LDEwMi41QyA2ODguNjY3LDEyMC44MzMgNjg4LjY2NywxMzkuMTY3IDY4OCwxNTcuNUMgNjg2LjgzMywxNTkuMzMzIDY4NS4zMzMsMTYwLjgzMyA2ODMuNSwxNjJDIDY2OC41LDE2Mi42NjcgNjUzLjUsMTYyLjY2NyA2MzguNSwxNjJDIDYzNi42NjcsMTYwLjgzMyA2MzUuMTY3LDE1OS4zMzMgNjM0LDE1Ny41QyA2MzMuMTY3LDEzOS4xNTggNjMzLjMzNCwxMjAuODI0IDYzNC41LDEwMi41QyA2MzUuNTI0LDEwMS4xNDggNjM2LjUyNCw5OS44MTQ5IDYzNy41LDk4LjUgWiBaIi8+PC9nPgo8dGV4dCB4PSI1MzgiIHk9IjIzNSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZm9udC1mYW1pbHk9IkJhcmxvdywgc2Fucy1zZXJpZiIgZm9udC1zaXplPSIyMyIgZm9udC13ZWlnaHQ9IjMwMCIgZmlsbD0iI2ZmZmZmZiIgbGV0dGVyLXNwYWNpbmc9IjE4Ij5NT05JVE9SSU5HIFNIRUVUPC90ZXh0Pgo8L3N2Zz4=';
    if(projLogo){projLogo.src=whiteSrc;}
    if(headerLogo){headerLogo.src=whiteSrc;}
  },300);
})();

// Show username on project screen - handled by afterLogin
