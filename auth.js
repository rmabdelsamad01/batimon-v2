function switchTab(tab){
  const isLogin=tab==='login';
  document.getElementById('form-login').style.display=isLogin?'block':'none';
  document.getElementById('form-signup').style.display=isLogin?'none':'block';
  const tl=document.getElementById('tab-login'),ts=document.getElementById('tab-signup');
  tl.style.background=isLogin?'#224F93':'transparent';tl.style.color=isLogin?'#fff':'#8099b0';
  ts.style.background=isLogin?'transparent':'#224F93';ts.style.color=isLogin?'#8099b0':'#fff';
  document.getElementById('login-err').style.display='none';
  document.getElementById('su-err').style.display='none';
  document.getElementById('su-ok').style.display='none';
}

async function resolveEmail(input){
  // 1. Try email column in profiles
  const {data:byEmail} = await sb.from('profiles').select('email').eq('email', input).maybeSingle();
  if(byEmail?.email) return byEmail.email;

  // 2. Try username
  const {data:byUser} = await sb.from('profiles').select('email,id').eq('username', input).maybeSingle();
  if(byUser?.email) return byUser.email;

  // 3. Try phone — fetch all profiles and do flexible matching
  const normalized = input.replace(/[\s\-().+]/g,'');
  const {data:allProfs} = await sb.from('profiles').select('email,phone,phone_code');
  if(allProfs){
    const match = allProfs.find(r=>{
      if(!r.phone) return false;
      const full = ((r.phone_code||'')+r.phone).replace(/[\s\-().+]/g,'');
      const phoneOnly = r.phone.replace(/[\s\-().+]/g,'');
      return full===normalized || phoneOnly===normalized ||
             full.endsWith(normalized) || normalized.endsWith(phoneOnly);
    });
    if(match?.email) return match.email;
  }

  return null;
}

async function doLogin(){
  const input = document.getElementById('login-user').value.trim();
  const pass  = document.getElementById('login-pass').value;
  const err   = document.getElementById('login-err');

  if(!input || !pass){
    err.textContent='Please enter your identifier and password.';
    err.style.display='block'; return;
  }

  err.textContent='Signing in…'; err.style.display='block';

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input);
  let emailToUse = isEmail ? input : null;

  if(!emailToUse){
    err.textContent='Looking up account…';
    emailToUse = await resolveEmail(input);
    if(!emailToUse){
      err.textContent='No account found with that username or phone number.';
      err.style.display='block'; return;
    }
  }

  err.textContent='Signing in…';
  const {data, error} = await sb.auth.signInWithPassword({email: emailToUse, password: pass});
  if(error){
    if(error.message.includes('Email not confirmed') || error.message.includes('email_not_confirmed')){
      err.textContent='Your email is not confirmed. Please contact your admin.';
    } else if(error.message.includes('Invalid login') || error.message.includes('invalid_credentials')){
      err.textContent='Incorrect password.';
    } else {
      err.textContent = error.message;
    }
    err.style.display='block'; return;
  }
  err.style.display='none';
  await afterLogin(data.user);
}

async function doSignup(){
  const name=document.getElementById('su-name').value.trim();
  const user=document.getElementById('su-user').value.trim();
  const email=document.getElementById('su-email').value.trim();
  const pass=document.getElementById('su-pass').value;
  const pass2=document.getElementById('su-pass2').value;
  const err=document.getElementById('su-err');
  const ok=document.getElementById('su-ok');
  err.style.display='none';ok.style.display='none';
  if(!name||!user||!email||!pass||!pass2){err.textContent='All fields are required.';err.style.display='block';return;}
  if(pass.length<6){err.textContent='Password must be at least 6 characters.';err.style.display='block';return;}
  if(pass!==pass2){err.textContent='Passwords do not match.';err.style.display='block';return;}
  err.textContent='Creating account…';err.style.display='block';

  // Step 1: Create auth user
  const {data,error}=await sb.auth.signUp({email,password:pass,options:{data:{username:user,full_name:name}}});
  if(error){err.textContent=error.message;err.style.display='block';return;}
  err.style.display='none';

  if(data.user){
    // Step 2: Manually upsert profile row — status 'pending' until admin approves
    await sb.from('profiles').upsert({
      id: data.user.id,
      username: user,
      full_name: name,
      email: email,
      role: 'viewer',
      status: 'pending',
      updated_at: new Date().toISOString()
    }, {onConflict:'id'});

    // Sign the user back out — they cannot access anything until approved
    await sb.auth.signOut();
    err.style.display='none';
    ok.innerHTML=`✅ Account created for <strong>${name}</strong>!<br>Your request has been sent to the admin for approval.<br><span style="opacity:0.8;">Returning to login in 4 seconds…</span>`;
    ok.style.display='block';
    // Clear all signup fields
    ['su-name','su-user','su-email','su-pass','su-pass2'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value='';
    });
    setTimeout(()=>{ ok.style.display='none'; switchTab('login'); }, 4000);
  } else {
    ok.textContent=`Account created! You can now log in, ${name}.`;ok.style.display='block';
    setTimeout(()=>switchTab('login'),1800);
  }
}

async function afterLogin(user){
  sbUser=user;
  // Load profile first to check role
  let {data:prof}=await sb.from('profiles').select('*').eq('id',user.id).single();
  // If profile doesn't exist yet, create it from user metadata
  // IMPORTANT: ignoreDuplicates:true ensures we NEVER overwrite an existing profile's role
  // (a failed SELECT returning null must not be treated as "no profile exists")
  if(!prof){
    // No profile = account was deleted by admin or never fully set up.
    // Never auto-create — that is the exact hole that lets deleted users back in.
    await sb.auth.signOut();
    const err=document.getElementById('login-err');
    if(err){err.textContent='Your account has been removed. Please contact your administrator.';err.style.display='block';}
    return;
  }
  sbProfile=prof;

  // ── phone_only safety net ──────────────────────────────────────
  // If this user was previously phone_only (stored in their auth metadata)
  // and the DB now shows a different role, silently fix it back and
  // still route to mobile — prevents any external reset from exposing
  // confidential desktop content to mobile-only clients.
  const metaRole = user.user_metadata?.intended_role || user.user_metadata?.role || null;
  if(metaRole === 'phone_only' && prof?.role !== 'phone_only'){
    // Silently restore the correct role
    await sb.from('profiles').update({role:'phone_only', updated_at: new Date().toISOString()}).eq('id', user.id);
    if(sbProfile) sbProfile.role = 'phone_only';
    prof.role = 'phone_only';
  }
  // ──────────────────────────────────────────────────────────────

  // Block batidoc_user
  if(prof?.role==='batidoc_user'){
    await sb.auth.signOut();
    const err=document.getElementById('login-err');
    err.textContent='Access denied. Your account is for Batidoc only.';
    err.style.display='block';
    return;
  }
  // Redirect phone_only users to the mobile app
  if(prof?.role==='phone_only'){
    document.getElementById('auth-screen').style.display='none';
    if(typeof renderMobileApp==='function') renderMobileApp(prof);
    else document.getElementById('mobile-screen').style.display='flex';
    return;
  }
  // Block pending (not yet approved) users
  if(prof?.status==='pending'){
    await sb.auth.signOut();
    const err=document.getElementById('login-err');
    err.textContent='Your account is pending admin approval. Please wait or contact your admin.';
    err.style.display='block';
    return;
  }
  // Block suspended users
  if(prof?.status==='suspended'){
    await sb.auth.signOut();
    const err=document.getElementById('login-err');
    err.textContent='Your account has been suspended. Please contact your admin.';
    err.style.display='block';
    return;
  }
  // Redirect Admin users to admin panel
  if(checkAdminRedirect(prof)) return;
  // Show project screen
  document.getElementById('auth-screen').style.display='none';
  document.getElementById('project-screen').style.display='flex';
  // Run write-permission diagnostic — shows a red banner if Supabase rejects writes
  if(typeof _diagnoseSyncPermission==='function') _diagnoseSyncPermission();
  // Set username and logo on project screen
  const displayName = prof?.full_name||prof?.username||user.email||'';
  const projUser = document.getElementById('proj-user');
  if(projUser) projUser.textContent = displayName;
  copyLogoToProjectScreen();
  renderProjectScreen();
  updateUserChip(displayName);
}

// Open Batidoc in new tab at the specified folder
const BATIDOC_URL='https://batidoc.netlify.app'; // update with your Batidoc URL
function openBatidoc(folder, el){
  // Highlight active sidebar button
  document.querySelectorAll('.batidoc-active').forEach(b=>{
    b.classList.remove('batidoc-active');
    b.style.borderColor='var(--border)';
    b.style.background='var(--surface2)';
  });
  const btn = el?.closest('[id^="ef-sec-"]');
  if(btn){btn.classList.add('batidoc-active');btn.style.borderColor='#224F93';btn.style.background='rgba(34,79,147,0.08)';}
  const url=`${BATIDOC_URL}?folder=${folder}&token=${sbUser?.id||''}`;
  window.open(url,'_blank');
}

function updateUserChip(name){
  const chip=document.getElementById('user-chip');
  if(chip)chip.textContent=name;
  const label=document.getElementById('user-chip-label');
  if(label)label.textContent=name;
  const dn=document.getElementById('dropdown-user-name');
  if(dn)dn.textContent=name;
  const pu=document.getElementById('proj-user');
  if(pu)pu.textContent=name;
}

function toggleUserDropdown(){
  var d=document.getElementById('user-dropdown');
  d.style.display=d.style.display==='none'?'block':'none';
}
document.addEventListener('click',function(e){
  var wrap=document.getElementById('user-dropdown-wrap');
  if(wrap&&!wrap.contains(e.target)){
    var d=document.getElementById('user-dropdown');
    if(d)d.style.display='none';
  }
});

async function doLogout(){
  await sb.auth.signOut();
  sbUser=null;sbProfile=null;
  document.getElementById('project-screen').style.display='none';
  document.getElementById('auth-screen').style.display='flex';
  document.getElementById('login-user').value='';
  document.getElementById('login-pass').value='';
  document.getElementById('login-err').style.display='none';
  switchTab('login');
}

// Auto-login if Supabase session exists
(async function(){
  const {data:{session}}=await sb.auth.getSession();
  if(session?.user) await afterLogin(session.user);
})();
