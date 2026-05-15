// ════════════════════════════════════════════════
// ADMIN PANEL LOGIC
// ════════════════════════════════════════════════
const ADMIN_USERNAME = 'Admin';
const ALL_PROJECTS = ['shift-tower','tanger-med','riad-el-andalous','anp','taghazout','casaone'];

let adminUsers = [];
let aemUserId = null;
let aemStatus = 'pending';
let aemRole = 'viewer';
let aemProjects = [];

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
  try{
    const {data,error}=await sb.from('profiles').select('*').order('updated_at',{ascending:false});
    if(error) throw error;
    adminUsers = data||[];
    renderAdminUsers();
  } catch(e){
    document.getElementById('admin-list-all').innerHTML=`<div style="text-align:center;padding:20px;color:#c02020;font-size:12px;">Error loading users: ${e.message}</div>`;
  }
}

function renderAdminUsers(){
  const pending = adminUsers.filter(u=>!u.status || u.status==='pending');
  const all = adminUsers;

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
  const roleColor = {admin:'#6d35d9', user:'#224F93', viewer:'#8099b0', batidoc_user:'#a07800', phone_only:'#0a7a5a'}[u.role]||'#8099b0';
  const roleLabel = {admin:'Admin', user:'User', viewer:'Viewer', batidoc_user:'Batidoc Only', phone_only:'Phone Only'}[u.role]||u.role||'Viewer';
  const projects = (u.projects||[]);
  const projStr = projects.length ? projects.map(p=>PROJECT_META[p]?.name||p).join(', ') : '—';
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
        <span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;background:rgba(34,79,147,0.07);color:${roleColor};">${roleLabel}</span>
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

function openAdminEdit(userId){
  const u = adminUsers.find(u=>u.id===userId);
  if(!u) return;
  aemUserId = userId;
  aemStatus = u.status||'pending';
  aemRole = u.role||'viewer';
  aemProjects = Array.isArray(u.projects) ? [...u.projects] : [];

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
  document.querySelectorAll('.aem-role-btn').forEach(b=>{
    const active = b.dataset.val===aemRole;
    b.style.borderColor = active ? '#224F93' : 'rgba(34,79,147,0.15)';
    b.style.background = active ? 'rgba(34,79,147,0.09)' : '#f4f8fd';
    b.style.color = active ? '#224F93' : '#1a2a3a';
  });

  // Set project checkboxes
  document.querySelectorAll('#aem-projects input[type=checkbox]').forEach(cb=>{
    cb.checked = aemProjects.includes(cb.value);
    const lbl = cb.closest('label');
    if(lbl){
      lbl.style.borderColor = cb.checked ? '#224F93' : 'rgba(34,79,147,0.15)';
      lbl.style.background = cb.checked ? 'rgba(34,79,147,0.07)' : '#f4f8fd';
    }
  });
  // Sync Select All button label
  const allChecked = ALL_PROJECTS.every(p=>aemProjects.includes(p));
  const allBtn = document.getElementById('aem-all-btn');
  if(allBtn) allBtn.textContent = allChecked ? 'Deselect All' : 'Select All';

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

function aemSetRole(val, el){
  aemRole=val;
  document.querySelectorAll('.aem-role-btn').forEach(b=>{
    const active = b.dataset.val===val;
    b.style.borderColor = active ? '#224F93' : 'rgba(34,79,147,0.15)';
    b.style.background = active ? 'rgba(34,79,147,0.09)' : '#f4f8fd';
    b.style.color = active ? '#224F93' : '#1a2a3a';
  });
}

function aemToggleProject(cb){
  const val = cb.value;
  if(cb.checked){
    if(!aemProjects.includes(val)) aemProjects.push(val);
  } else {
    aemProjects = aemProjects.filter(p=>p!==val);
  }
  const lbl = cb.closest('label');
  if(lbl){
    lbl.style.borderColor = cb.checked ? '#224F93' : 'rgba(34,79,147,0.15)';
    lbl.style.background = cb.checked ? 'rgba(34,79,147,0.07)' : '#f4f8fd';
  }
  // Update Select All / Deselect All button label
  const allChecked = ALL_PROJECTS.every(p=>aemProjects.includes(p));
  const btn = document.getElementById('aem-all-btn');
  if(btn) btn.textContent = allChecked ? 'Deselect All' : 'Select All';
}

function aemToggleAllProjects(){
  const allChecked = ALL_PROJECTS.every(p=>aemProjects.includes(p));
  if(allChecked){
    // Deselect all
    aemProjects = [];
    document.querySelectorAll('#aem-projects input[type=checkbox]').forEach(cb=>{
      cb.checked = false;
      const lbl = cb.closest('label');
      if(lbl){ lbl.style.borderColor='rgba(34,79,147,0.15)'; lbl.style.background='#f4f8fd'; }
    });
    const btn = document.getElementById('aem-all-btn');
    if(btn) btn.textContent = 'Select All';
  } else {
    // Select all
    aemProjects = [...ALL_PROJECTS];
    document.querySelectorAll('#aem-projects input[type=checkbox]').forEach(cb=>{
      cb.checked = true;
      const lbl = cb.closest('label');
      if(lbl){ lbl.style.borderColor='#224F93'; lbl.style.background='rgba(34,79,147,0.07)'; }
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
    const {error} = await sb.from('profiles').update({
      status: aemStatus,
      role: aemRole,
      projects: aemProjects,
      updated_at: new Date().toISOString()
    }).eq('id', aemUserId);

    if(error){
      // If 'projects' column missing, retry without it but keep status
      if(error.message.includes('projects')){
        const {error:e2} = await sb.from('profiles').update({
          status: aemStatus,
          role: aemRole,
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
    if(idx>=0){ adminUsers[idx].status=aemStatus; adminUsers[idx].role=aemRole; adminUsers[idx].projects=aemProjects; }
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
