// ════════════════════════════════════════════════
// ADMIN PANEL LOGIC
// ════════════════════════════════════════════════
const ADMIN_USERNAME = 'Admin';
const ALL_PROJECTS = ['shift-tower'];

let adminUsers = [];
let aemUserId = null;
let aemStatus = 'pending';
let aemRole = 'viewer';
let aemRoles = [];
let aemProjects = [];
let aemViewerProjects = [];
let aemAllProjects = false;
let aemGedProjects = [];
let _allGedProjects = [];

const AEM_EXCLUSIVE_ROLES = ['admin', 'batidoc_user'];
const AEM_ROLE_COLORS = {admin:'#6d35d9', user:'#224F93', viewer:'#8099b0', batidoc_user:'#a07800', phone_only:'#0a7a5a', developer:'#c2410c'};
const AEM_ROLE_LABELS = {admin:'Admin', user:'User', viewer:'Viewer', batidoc_user:'BatiGED Only', phone_only:'Phone Only', developer:'Developer'};

// Called after login — check if username is Admin
function checkAdminRedirect(profile){
  if(!profile) return false;
  if(profile.username === ADMIN_USERNAME || profile.role === 'admin'){
    document.getElementById('auth-screen').style.display='none';
    document.getElementById('project-screen').style.display='none';
    showAdminScreen();
    return true;
  }
  return false;
}

async function showAdminScreen(){
  document.getElementById('admin-screen').style.display='flex';
  await adminRefresh();
}

async function adminRefresh(){
  document.getElementById('admin-list-pending').innerHTML='<div style="text-align:center;padding:20px;color:#8099b0;font-size:12px;">Loading…</div>';
  document.getElementById('admin-list-all').innerHTML='<div style="text-align:center;padding:20px;color:#8099b0;font-size:12px;">Loading…</div>';
  // Load custom projects so their names show in user cards
  if(typeof loadCustomProjects==='function') await loadCustomProjects();
  try{
    const {data,error}=await sb.from('profiles').select('*').order('updated_at',{ascending:false});
    if(error) throw error;
    adminUsers = data||[];
    renderAdminUsers();
  } catch(e){
    document.getElementById('admin-list-all').innerHTML=`<div style="text-align:center;padding:20px;color:#c02020;font-size:12px;">Error loading users: ${e.message}</div>`;
  }
  // Load project deletion requests
  try{
    const {data:delReqs}=await sb.from('project_delete_requests').select('*').eq('status','pending').order('created_at',{ascending:false});
    renderDelRequests(delReqs||[]);
  } catch(e){}
}

function renderDelRequests(reqs){
  const section = document.getElementById('admin-section-del-requests');
  const list    = document.getElementById('admin-list-del-requests');
  const badge   = document.getElementById('badge-del-requests');
  if(!section||!list) return;
  if(!reqs.length){ section.style.display='none'; return; }
  section.style.display='block';
  if(badge) badge.textContent=reqs.length;
  list.innerHTML = reqs.map(r=>`
    <div style="background:#fff;border:1px solid rgba(192,32,32,0.2);border-radius:10px;padding:16px 18px;margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
      <div>
        <div style="font-size:14px;font-weight:700;color:#1a2a3a;margin-bottom:3px;">${r.project_name}</div>
        <div style="font-size:11px;color:#8099b0;">Requested by <b>${r.requested_by_name||'Unknown'}</b> · ${new Date(r.created_at).toLocaleDateString()}</div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0;">
        <button onclick="rejectDelRequest('${r.id}')" style="padding:7px 14px;border:1px solid rgba(34,79,147,0.2);border-radius:7px;background:#f0f4f9;color:#8099b0;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Reject</button>
        <button onclick="approveDelRequest('${r.id}','${r.project_id}')" style="padding:7px 14px;border:none;border-radius:7px;background:#c02020;color:#fff;font-family:'Barlow',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Approve</button>
      </div>
    </div>`).join('');
}

async function approveDelRequest(reqId, projectId){
  await sb.from('project_delete_requests').update({status:'approved'}).eq('id',reqId);
  // Immediately delete the project and all its data from Supabase
  if(projectId){
    await sb.from('custom_projects').delete().eq('id',projectId);
    await sb.from('custom_project_facades').delete().eq('project_id',projectId);
    await sb.from('project_info').delete().eq('project',projectId);
  }
  await adminRefresh();
}

async function rejectDelRequest(reqId){
  await sb.from('project_delete_requests').update({status:'rejected'}).eq('id',reqId);
  await adminRefresh();
}

function renderAdminUsers(){
  const pending = adminUsers.filter(u=>!u.status || u.status==='pending');
  const q = (document.getElementById('admin-search')?.value||'').toLowerCase().trim();
  const all = q ? adminUsers.filter(u=>{
    return (u.full_name||'').toLowerCase().includes(q)
        || (u.username||'').toLowerCase().includes(q)
        || (u.email||'').toLowerCase().includes(q);
  }) : adminUsers;

  // Stats bar
  const total = all.length;
  const approved = all.filter(u=>u.status==='approved').length;
  const suspended = all.filter(u=>u.status==='suspended').length;
  const admins = all.filter(u=>u.role==='admin').length;
  document.getElementById('admin-stats').innerHTML = [
    {label:'Total Users', value:total, color:'#224F93'},
    {label:'Approved', value:approved, color:'#1a9458'},
    {label:'Pending', value:pending.length, color:'#e05c00'},
    {label:'Suspended', value:suspended, color:'#c02020'},
    {label:'Admins', value:admins, color:'#6d35d9'},
  ].map(s=>`
    <div style="flex:1;padding:14px 20px;border-right:1px solid rgba(34,79,147,0.1);">
      <div style="font-size:9px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#8099b0;margin-bottom:4px;">${s.label}</div>
      <div style="font-size:22px;font-weight:700;color:${s.color};font-family:'DM Mono',monospace;">${s.value}</div>
    </div>`).join('');

  // Pending banner
  const banner = document.getElementById('admin-pending-banner');
  const pendingText = document.getElementById('admin-pending-text');
  const pendingSection = document.getElementById('admin-section-pending');
  const badgePending = document.getElementById('badge-pending');
  if(pending.length>0){
    banner.style.display='flex';
    pendingText.textContent = `${pending.length} account${pending.length>1?'s':''} waiting for approval`;
    pendingSection.style.display='block';
    badgePending.textContent=pending.length;
  } else {
    banner.style.display='none';
    pendingSection.style.display='none';
  }

  document.getElementById('badge-all').textContent=total;
  document.getElementById('admin-list-pending').innerHTML = pending.length ? pending.map(u=>adminUserCard(u)).join('') : '';
  document.getElementById('admin-list-all').innerHTML = all.length ? all.map(u=>adminUserCard(u)).join('') : '<div style="text-align:center;padding:24px;color:#8099b0;font-size:12px;">No users found.</div>';
}

function adminUserCard(u){
  const statusColor = {approved:'#1a9458', pending:'#e05c00', suspended:'#c02020'}[u.status]||'#8099b0';
  const statusBg = {approved:'rgba(26,148,88,0.08)', pending:'rgba(224,92,0,0.08)', suspended:'rgba(192,32,32,0.08)'}[u.status]||'rgba(128,153,176,0.08)';
  const statusLabel = {approved:'Approved', pending:'Pending', suspended:'Suspended'}[u.status]||'Pending';
  const allRoles = (Array.isArray(u.roles) && u.roles.length) ? u.roles : [u.role||'viewer'];
  const roleBadges = allRoles.map(r=>`<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(34,79,147,0.07);color:${AEM_ROLE_COLORS[r]||'#8099b0'};">${AEM_ROLE_LABELS[r]||r}</span>`).join('');
  const projects = (u.projects||[]);
  const projStr = projects.length ? projects.map(p=>{
    if(PROJECT_META[p]) return PROJECT_META[p].name;
    const cp = (typeof getCustomProjects==='function'?getCustomProjects():[]).find(c=>c.id===p);
    return cp ? cp.name : p;
  }).join(', ') : '—';
  const isSelf = sbUser && u.id === sbUser.id;

  const safeName = (u.full_name||u.username||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'");
  return `<div style="background:#fff;border:1px solid rgba(34,79,147,0.12);border-radius:12px;padding:16px 20px;margin-bottom:10px;display:flex;align-items:center;gap:16px;transition:box-shadow 0.15s;" onmouseover="this.style.boxShadow='0 4px 18px rgba(34,79,147,0.09)'" onmouseout="this.style.boxShadow='none'">
    <!-- Avatar -->
    <div style="width:42px;height:42px;border-radius:50%;background:rgba(34,79,147,0.1);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:16px;font-weight:700;color:#224F93;text-transform:uppercase;">${(u.full_name||u.username||'?')[0]}</div>
    <!-- Info -->
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px;">
        <span style="font-size:13px;font-weight:700;color:#1a2a3a;">${u.full_name||'—'}</span>
        <span style="font-size:10px;font-family:'DM Mono',monospace;color:#8099b0;">@${u.username||'—'}</span>
        ${isSelf?'<span style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(109,53,217,0.1);color:#6d35d9;">You</span>':''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:${statusBg};color:${statusColor};">${statusLabel}</span>
        ${roleBadges}
        <span style="font-size:10px;color:#8099b0;font-family:'DM Mono',monospace;">${projStr}</span>
      </div>
    </div>
    <!-- Actions -->
    <div style="display:flex;gap:7px;flex-shrink:0;">
      <button onclick="openAdminEdit('${u.id}')" style="padding:7px 14px;background:#f0f4f9;border:1px solid rgba(34,79,147,0.18);border-radius:7px;cursor:pointer;font-family:'Barlow',sans-serif;font-size:11px;font-weight:700;color:#224F93;transition:all 0.15s;" onmouseover="this.style.background='#224F93';this.style.color='#fff'" onmouseout="this.style.background='#f0f4f9';this.style.color='#224F93'">Edit</button>
      ${!isSelf?`<button onclick="confirmDeleteUser('${u.id}','${safeName}')" style="padding:7px 10px;background:#fff5f5;border:1px solid rgba(192,32,32,0.2);border-radius:7px;cursor:pointer;font-family:'Barlow',sans-serif;font-size:11px;font-weight:700;color:#c02020;transition:all 0.15s;" onmouseover="this.style.background='#c02020';this.style.color='#fff'" onmouseout="this.style.background='#fff5f5';this.style.color='#c02020'">Delete</button>`:''}
    </div>
  </div>`;
}

// Delete user confirmation + execution
let deleteTargetId = null;
function closeDeleteConfirm(){
  document.getElementById('del-confirm-modal').style.display='none';
  document.getElementById('del-err').style.display='none';
  document.getElementById('del-err').innerHTML='';
  const btn = document.getElementById('del-confirm-btn');
  btn.textContent='Delete';
  btn.disabled=false;
  deleteTargetId = null;
}
function confirmDeleteUser(userId, userName){
  deleteTargetId = userId;
  document.getElementById('del-user-name').textContent = userName || 'this user';
  document.getElementById('del-err').style.display='none';
  document.getElementById('del-err').innerHTML='';
  const btn = document.getElementById('del-confirm-btn');
  btn.textContent='Delete';
  btn.disabled=false;
  document.getElementById('del-confirm-modal').style.display='flex';
}
async function executeDeleteUser(){
  if(!deleteTargetId) return;
  const btn = document.getElementById('del-confirm-btn');
  const errEl = document.getElementById('del-err');
  errEl.style.display='none';
  btn.textContent='Deleting…'; btn.disabled=true;

  const targetUser = adminUsers.find(u=>u.id===deleteTargetId);
  const targetName = targetUser?.full_name || targetUser?.username || '';

  try{
    // 1. Delete agenda tasks assigned to this user
    if(targetName){
      await sb.from('agenda_tasks').delete().eq('who', targetName);
    }

    // 2. Delete any issues reported by this user
    await sb.from('issues').delete().eq('panel_id', deleteTargetId).then(()=>{}).catch(()=>{});

    // 3. Delete the profile row — this is the critical step.
    //    Once the profile is gone, afterLogin() will permanently block
    //    this auth user from entering, even if they still know their password.
    const {error, data} = await sb.from('profiles').delete().eq('id', deleteTargetId).select();
    if(error) throw error;
    if(!data || data.length === 0){
      throw new Error('Delete was blocked — please run the SQL below in Supabase to allow admin deletions.');
    }

    adminUsers = adminUsers.filter(u=>u.id !== deleteTargetId);
    closeDeleteConfirm();
    renderAdminUsers();

    // Advisory: the Supabase auth user still exists in auth.users.
    // They are fully locked out of Batimon (no profile = no entry).
    // To fully erase their credentials, go to:
    // Supabase Dashboard → Authentication → Users → find them → Delete.
    console.info(`[Security] Profile deleted for ${targetName}. Auth credentials still exist in Supabase auth.users — remove manually from the Supabase Dashboard if needed.`);

  } catch(e){
    btn.textContent='Delete';
    btn.disabled=false;
    errEl.innerHTML = e.message.includes('blocked')
      ? `${e.message}<br><br><code style="font-size:10px;background:#f4f8fd;padding:4px 8px;border-radius:4px;display:block;margin-top:6px;">ALTER TABLE profiles DISABLE ROW LEVEL SECURITY;</code><span style="font-size:10px;color:#8099b0;">or add a permissive RLS policy for admins.</span>`
      : 'Error: '+e.message;
    errEl.style.display='block';
  }
}

async function openAdminEdit(userId){
  const u = adminUsers.find(u=>u.id===userId);
  if(!u) return;
  aemUserId = userId;
  aemStatus = u.status||'pending';
  aemRole = u.role||'viewer';
  aemRoles = Array.isArray(u.roles) && u.roles.length ? [...u.roles] : [aemRole];
  aemProjects = Array.isArray(u.projects) ? [...u.projects] : [];
  aemViewerProjects = Array.isArray(u.viewer_projects) ? [...u.viewer_projects] : [];
  aemAllProjects = aemProjects.includes('*');
  if(aemAllProjects) aemProjects = [];
  aemGedProjects = Array.isArray(u.ged_projects) ? [...u.ged_projects] : [];

  // Load GED projects list
  try{
    const {data} = await sb.from('ged_projects').select('id,name,director').order('created_at');
    _allGedProjects = [{id:'shift-tower',name:'Shift Tower',director:'raed'}, ...(data||[]).filter(p=>p.id!=='shift-tower')];
  }catch(e){ _allGedProjects = [{id:'shift-tower',name:'Shift Tower',director:'raed'}]; }

  document.getElementById('aem-subtitle').textContent = `${u.full_name||''}  @${u.username||''}`;
  document.getElementById('aem-err').style.display='none';
  document.getElementById('aem-ok').style.display='none';

  // Highlight status buttons
  document.querySelectorAll('.aem-status-btn').forEach(b=>{
    const active = b.dataset.val===aemStatus;
    b.style.borderColor = active ? '#224F93' : 'rgba(34,79,147,0.15)';
    b.style.background = active ? 'rgba(34,79,147,0.09)' : '#f4f8fd';
    b.style.color = active ? '#224F93' : '#1a2a3a';
  });

  // Highlight role buttons
  _aemRefreshRoleButtons();

  // Build unified project list: hardcoded + custom
  const customProjects = typeof getCustomProjects==='function' ? getCustomProjects() : [];
  const customIds = customProjects.map(p=>p.id);
  const allProjIds = [...ALL_PROJECTS, ...customIds];

  // Combine into one list and sort by _PROJECT_DISPLAY_ORDER
  const order = typeof _PROJECT_DISPLAY_ORDER!=='undefined' ? _PROJECT_DISPLAY_ORDER : [];
  const sortKey = name => { const i=order.indexOf((name||'').toLowerCase().trim()); return i>=0?i:999; };

  const metaEntries = ALL_PROJECTS.map(id=>({
    id, name:(typeof PROJECT_META!=='undefined'&&PROJECT_META[id])?PROJECT_META[id].name:id, isCustom:false
  }));
  const customEntries = customProjects.map(p=>({ id:p.id, name:p.name, isCustom:true }));
  const combined = [...metaEntries, ...customEntries].sort((a,b)=>sortKey(a.name)-sortKey(b.name));

  // Render all projects into one grid
  const projGrid = document.getElementById('aem-projects');
  if(projGrid){
    projGrid.innerHTML = combined.map(p=>{
      const isViewer = aemViewerProjects.includes(p.id);
      const hasAccess = aemProjects.includes(p.id) || isViewer;
      const border = hasAccess?(p.isCustom?'#1a9458':'#224F93'):(p.isCustom?'rgba(26,148,88,0.2)':'rgba(34,79,147,0.15)');
      const bg = hasAccess?(p.isCustom?'rgba(26,148,88,0.07)':'rgba(34,79,147,0.07)'):(p.isCustom?'#f4faf7':'#f4f8fd');
      const accent = p.isCustom?'#1a9458':'#224F93';
      const eyeColor = isViewer ? '#224F93' : '#c0cde0';
      const eyeBg = isViewer ? 'rgba(34,79,147,0.1)' : 'transparent';
      return `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;border:2px solid ${border};background:${bg};transition:all 0.15s;" id="aem-proj-row-${p.id}">
        <input type="checkbox" value="${p.id}" onchange="aemToggleProject(this)" style="width:15px;height:15px;accent-color:${accent};cursor:pointer;flex-shrink:0;" ${hasAccess?'checked':''}>
        <span style="flex:1;font-size:12px;font-weight:600;color:#1a2a3a;cursor:pointer;" onclick="document.querySelector('#aem-proj-row-${p.id} input').click()">${p.name}</span>
        <button onclick="aemToggleViewer('${p.id}',event)" title="Viewer only" style="border:none;background:${eyeBg};border-radius:5px;padding:3px 5px;cursor:pointer;color:${eyeColor};font-size:13px;line-height:1;flex-shrink:0;transition:all 0.15s;" id="aem-eye-${p.id}">👁</button>
      </div>`;
    }).join('');
  }

  // Sync Select All button label
  const allChecked = allProjIds.every(p=>aemProjects.includes(p));
  const allBtn = document.getElementById('aem-all-btn');
  if(allBtn) allBtn.textContent = allChecked ? 'Deselect All' : 'Select All';

  // Sync All Projects button and apply disabled state if active
  _aemRefreshAllProjectsBtn();

  // Render GED project access section (visible only for batidoc_user role)
  _aemRenderGedSection();

  document.getElementById('admin-edit-modal').style.display='flex';
}

function closeAdminEdit(){
  document.getElementById('admin-edit-modal').style.display='none';
  aemUserId=null;
}

function aemSetStatus(val, el){
  aemStatus=val;
  document.querySelectorAll('.aem-status-btn').forEach(b=>{
    const active = b.dataset.val===val;
    b.style.borderColor = active ? '#224F93' : 'rgba(34,79,147,0.15)';
    b.style.background = active ? 'rgba(34,79,147,0.09)' : '#f4f8fd';
    b.style.color = active ? '#224F93' : '#1a2a3a';
  });
}

function _aemRefreshRoleButtons(){
  document.querySelectorAll('.aem-role-btn').forEach(b=>{
    const active = aemRoles.includes(b.dataset.val);
    const isPrimary = b.dataset.val === aemRole;
    const color = AEM_ROLE_COLORS[b.dataset.val] || '#224F93';
    b.style.borderColor = active ? color : 'rgba(34,79,147,0.15)';
    b.style.background = active ? color+'18' : '#f4f8fd';
    b.style.color = active ? color : '#1a2a3a';
    b.style.fontWeight = isPrimary ? '800' : '600';
  });
}

function _aemRenderGedSection(){
  const wrap = document.getElementById('aem-ged-section');
  if(!wrap) return;
  const isBatidocUser = aemRoles.includes('batidoc_user');
  wrap.style.display = isBatidocUser ? 'block' : 'none';
  if(!isBatidocUser) return;
  const grid = document.getElementById('aem-ged-projects');
  if(!grid) return;
  grid.innerHTML = _allGedProjects.map(p=>{
    const checked = aemGedProjects.includes(p.id);
    const border = checked ? '#a07800' : 'rgba(160,120,0,0.2)';
    const bg = checked ? 'rgba(160,120,0,0.07)' : '#fdfaf0';
    return `<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:8px;border:2px solid ${border};background:${bg};transition:all 0.15s;" id="aem-ged-row-${p.id}">
      <input type="checkbox" value="${p.id}" onchange="aemToggleGedProject(this)" style="width:15px;height:15px;accent-color:#a07800;cursor:pointer;flex-shrink:0;" ${checked?'checked':''}>
      <span style="flex:1;font-size:12px;font-weight:600;color:#1a2a3a;cursor:pointer;" onclick="document.querySelector('#aem-ged-row-${p.id} input').click()">${p.name}</span>
    </div>`;
  }).join('');
}

function aemToggleGedProject(cb){
  const val = cb.value;
  if(cb.checked){ if(!aemGedProjects.includes(val)) aemGedProjects.push(val); }
  else { aemGedProjects = aemGedProjects.filter(p=>p!==val); }
  const row = document.getElementById('aem-ged-row-'+val);
  if(row){
    row.style.borderColor = cb.checked ? '#a07800' : 'rgba(160,120,0,0.2)';
    row.style.background = cb.checked ? 'rgba(160,120,0,0.07)' : '#fdfaf0';
  }
}

function aemToggleRole(val){
  const isExclusive = AEM_EXCLUSIVE_ROLES.includes(val);
  if(isExclusive){
    // Toggle: if this is the only selected role, deselect it; otherwise set exclusively
    aemRoles = (aemRoles.length===1 && aemRoles[0]===val) ? [] : [val];
  } else {
    // Combinable: clear any exclusive, then toggle this role
    aemRoles = aemRoles.filter(r=>!AEM_EXCLUSIVE_ROLES.includes(r));
    if(aemRoles.includes(val)) aemRoles = aemRoles.filter(r=>r!==val);
    else aemRoles.push(val);
  }
  aemRole = aemRoles[0] || 'viewer';
  _aemRefreshRoleButtons();
  _aemRenderGedSection();
}

// Legacy - kept for any lingering references
function aemSetRole(val, el){
  aemRoles=[val]; aemRole=val;
  document.querySelectorAll('.aem-role-btn').forEach(b=>{
    const active = b.dataset.val===val;
    b.style.borderColor = active ? '#224F93' : 'rgba(34,79,147,0.15)';
    b.style.background = active ? 'rgba(34,79,147,0.09)' : '#f4f8fd';
    b.style.color = active ? '#224F93' : '#1a2a3a';
  });
}

function _aemRefreshProjRow(id){
  const isCustom = !ALL_PROJECTS.includes(id);
  const isViewer = !aemAllProjects && aemViewerProjects.includes(id);
  const hasAccess = aemAllProjects || aemProjects.includes(id) || aemViewerProjects.includes(id);
  const row = document.getElementById('aem-proj-row-'+id);
  const eye = document.getElementById('aem-eye-'+id);
  const cb = row?.querySelector('input[type=checkbox]');
  if(row){
    row.style.borderColor = hasAccess?(isCustom?'#1a9458':'#224F93'):(isCustom?'rgba(26,148,88,0.2)':'rgba(34,79,147,0.15)');
    row.style.background = hasAccess?(isCustom?'rgba(26,148,88,0.07)':'rgba(34,79,147,0.07)'):(isCustom?'#f4faf7':'#f4f8fd');
    row.style.opacity = aemAllProjects ? '0.6' : '1';
    row.style.pointerEvents = aemAllProjects ? 'none' : '';
  }
  if(cb){ cb.checked = hasAccess; cb.disabled = aemAllProjects; }
  if(eye){
    eye.style.color = isViewer?'#224F93':'#c0cde0';
    eye.style.background = isViewer?'rgba(34,79,147,0.1)':'transparent';
  }
}

function aemToggleProject(cb){
  const val = cb.value;
  if(cb.checked){
    // Grant full access — remove from viewer list
    aemViewerProjects = aemViewerProjects.filter(p=>p!==val);
    if(!aemProjects.includes(val)) aemProjects.push(val);
  } else {
    // Remove all access
    aemProjects = aemProjects.filter(p=>p!==val);
    aemViewerProjects = aemViewerProjects.filter(p=>p!==val);
  }
  _aemRefreshProjRow(val);
  const customIds = (typeof getCustomProjects==='function' ? getCustomProjects() : []).map(p=>p.id);
  const allProjIds = [...ALL_PROJECTS, ...customIds];
  const btn = document.getElementById('aem-all-btn');
  if(btn) btn.textContent = allProjIds.every(p=>aemProjects.includes(p)||aemViewerProjects.includes(p)) ? 'Deselect All' : 'Select All';
}

function aemToggleViewer(id, e){
  e.preventDefault(); e.stopPropagation();
  const isViewer = aemViewerProjects.includes(id);
  if(isViewer){
    // Switch from viewer to full access
    aemViewerProjects = aemViewerProjects.filter(p=>p!==id);
    if(!aemProjects.includes(id)) aemProjects.push(id);
  } else {
    // Switch to viewer only (remove from full access)
    aemProjects = aemProjects.filter(p=>p!==id);
    if(!aemViewerProjects.includes(id)) aemViewerProjects.push(id);
  }
  _aemRefreshProjRow(id);
}

function _aemRefreshAllProjectsBtn(){
  const btn = document.getElementById('aem-allprojects-btn');
  if(!btn) return;
  if(aemAllProjects){
    btn.style.background = '#6d35d9';
    btn.style.color = '#fff';
    btn.style.borderColor = '#6d35d9';
    btn.textContent = '⭐ All Projects (Active)';
  } else {
    btn.style.background = '#f4f8fd';
    btn.style.color = '#6d35d9';
    btn.style.borderColor = 'rgba(109,53,217,0.3)';
    btn.textContent = '⭐ All Projects';
  }
  // Refresh all rows to apply/remove disabled state
  const customProjects = typeof getCustomProjects==='function' ? getCustomProjects() : [];
  const allIds = [...ALL_PROJECTS, ...customProjects.map(p=>p.id)];
  allIds.forEach(id=>_aemRefreshProjRow(id));
}

function aemToggleAllProjectsFlag(){
  aemAllProjects = !aemAllProjects;
  if(aemAllProjects){
    // Turning ON: individual lists are overridden by '*'
    // Keep aemProjects/aemViewerProjects as-is for if they turn it back off
  } else {
    // Turning OFF: pre-fill with all projects so user can selectively remove
    const customProjects = typeof getCustomProjects==='function' ? getCustomProjects() : [];
    const allIds = [...ALL_PROJECTS, ...customProjects.map(p=>p.id)];
    aemProjects = [...allIds];
    aemViewerProjects = [];
  }
  _aemRefreshAllProjectsBtn();
}


function aemSelectOwner(owner){
  const customProjects = typeof getCustomProjects==='function' ? getCustomProjects() : [];
  const ownerIds = customProjects.filter(p=>p.owner===owner).map(p=>p.id);
  // For raed, also include shift-tower
  const ids = owner==='raed' ? ['shift-tower',...ownerIds] : ownerIds;
  // Uncheck all, then check matching
  aemProjects = [...ids];
  document.querySelectorAll('#aem-projects input[type=checkbox]').forEach(cb=>{
    const isCustom = !ALL_PROJECTS.includes(cb.value);
    cb.checked = ids.includes(cb.value);
    const lbl = cb.closest('label');
    if(lbl){
      lbl.style.borderColor = cb.checked ? (isCustom?'#1a9458':'#224F93') : (isCustom?'rgba(26,148,88,0.2)':'rgba(34,79,147,0.15)');
      lbl.style.background = cb.checked ? (isCustom?'rgba(26,148,88,0.07)':'rgba(34,79,147,0.07)') : (isCustom?'#f4faf7':'#f4f8fd');
    }
  });
  const customIds = customProjects.map(p=>p.id);
  const allProjIds = [...ALL_PROJECTS,...customIds];
  const btn = document.getElementById('aem-all-btn');
  if(btn) btn.textContent = allProjIds.every(p=>aemProjects.includes(p)) ? 'Deselect All' : 'Select All';
}

function aemToggleAllProjects(){
  const customIds = (typeof getCustomProjects==='function' ? getCustomProjects() : []).map(p=>p.id);
  const allProjIds = [...ALL_PROJECTS, ...customIds];
  const allChecked = allProjIds.every(p=>aemProjects.includes(p)||aemViewerProjects.includes(p));
  if(allChecked){
    aemProjects = []; aemViewerProjects = [];
    allProjIds.forEach(id=>_aemRefreshProjRow(id));
    const btn = document.getElementById('aem-all-btn');
    if(btn) btn.textContent = 'Select All';
  } else {
    // Grant full access to all (keep viewer flags as-is, just add missing ones to projects)
    allProjIds.forEach(id=>{
      if(!aemViewerProjects.includes(id) && !aemProjects.includes(id)) aemProjects.push(id);
      _aemRefreshProjRow(id);
    });
    const btn = document.getElementById('aem-all-btn');
    if(btn) btn.textContent = 'Deselect All';
  }
}

async function saveAdminEdit(){
  if(!aemUserId) return;
  const err = document.getElementById('aem-err');
  const ok = document.getElementById('aem-ok');
  err.style.display='none'; ok.style.display='none';
  // Check for role changes and warn before saving
  const currentUser = adminUsers.find(u=>u.id===aemUserId);
  const oldRole = currentUser?.role||'viewer';
  const oldStatus = currentUser?.status||'pending';
  if(aemRole!==oldRole || aemStatus!==oldStatus){
    const changes=[];
    if(aemRole!==oldRole) changes.push(`Role: "${oldRole}" → "${aemRole}"`);
    if(aemStatus!==oldStatus) changes.push(`Status: "${oldStatus}" → "${aemStatus}"`);
    const confirmed=window.confirm(`⚠️ You are about to change:\n\n${changes.join('\n')}\n\nFor user: ${currentUser?.full_name||''} (@${currentUser?.username||''})\n\nAre you sure?`);
    if(!confirmed) return;
    // Extra protection: changing a phone_only role requires typing CONFIRM
    if(aemRole!==oldRole && (oldRole==='phone_only' || aemRole==='phone_only')){
      const typed=window.prompt(
        `🔒 SECURITY CHECK\n\nYou are changing a phone-only user's role.\nThis user has restricted access for a reason.\n\nType  CONFIRM  (uppercase) to proceed:`
      );
      if(typed!=='CONFIRM'){
        err.textContent='Role change cancelled — CONFIRM was not typed correctly.';
        err.style.display='block';
        return;
      }
    }
  }
  ok.textContent='Saving…'; ok.style.display='block';

  try{
    // Try full update first
    const projectsToSave = aemAllProjects ? ['*'] : aemProjects;
    const rolesToSave = aemRoles.length ? aemRoles : [aemRole];
    const {error} = await sb.from('profiles').update({
      status: aemStatus,
      role: aemRole,
      roles: rolesToSave,
      projects: projectsToSave,
      viewer_projects: aemViewerProjects,
      ged_projects: aemGedProjects,
      updated_at: new Date().toISOString()
    }).eq('id', aemUserId);

    if(error){
      // If 'projects' column missing, retry without it but keep status
      if(/column.*\bprojects\b/.test(error.message) && !/ged_projects/.test(error.message)){
        const {error:e2} = await sb.from('profiles').update({
          status: aemStatus,
          role: aemRole,
          ged_projects: aemGedProjects,
          updated_at: new Date().toISOString()
        }).eq('id', aemUserId);
        if(!e2){
          ok.textContent='✓ Saved successfully';
          const idx = adminUsers.findIndex(u=>u.id===aemUserId);
          if(idx>=0){ adminUsers[idx].status=aemStatus; adminUsers[idx].role=aemRole; }
          setTimeout(()=>{ closeAdminEdit(); renderAdminUsers(); }, 900);
          return;
        }
        // If status column also missing, fall back to role only
        if(e2.message.includes('status')){
          const {error:e3} = await sb.from('profiles').update({
            role: aemRole,
            updated_at: new Date().toISOString()
          }).eq('id', aemUserId);
          if(e3) throw e3;
          ok.textContent='✓ Role saved (status/projects columns missing in DB).';
          ok.style.background='rgba(224,92,0,0.08)';
          ok.style.borderColor='rgba(224,92,0,0.3)';
          ok.style.color='#c04800';
          const idx = adminUsers.findIndex(u=>u.id===aemUserId);
          if(idx>=0){ adminUsers[idx].role=aemRole; }
          setTimeout(()=>{ closeAdminEdit(); renderAdminUsers(); }, 2200);
          return;
        }
        throw e2;
      }
      throw error;
    }

    ok.textContent='✓ Saved successfully';
    const idx = adminUsers.findIndex(u=>u.id===aemUserId);
    if(idx>=0){ adminUsers[idx].status=aemStatus; adminUsers[idx].role=aemRole; adminUsers[idx].roles=rolesToSave; adminUsers[idx].projects=projectsToSave; adminUsers[idx].viewer_projects=aemViewerProjects; adminUsers[idx].ged_projects=aemGedProjects; }
    setTimeout(()=>{ closeAdminEdit(); renderAdminUsers(); }, 900);
  } catch(e){
    ok.style.display='none';
    err.textContent='Error: '+e.message;
    err.style.display='block';
  }
}

async function adminLogout(){
  await sb.auth.signOut();
  document.getElementById('admin-screen').style.display='none';
  document.getElementById('auth-screen').style.display='flex';
  sbUser=null; sbProfile=null;
}
