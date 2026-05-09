function openMyProfile(){
  document.getElementById('user-dropdown').style.display='none';
  const p=sbProfile||{};
  document.getElementById('profile-name-display').textContent=p.full_name||p.username||sbUser?.email||'';
  document.getElementById('profile-username-display').textContent=p.username||sbUser?.email||'';
  var ph=document.getElementById('profile-phone-display');
  if(ph) ph.textContent=(p.phone_code&&p.phone)?(p.phone_code+' '+p.phone):(p.phone||'—');
  document.getElementById('profile-modal').style.display='flex';
}
function closeProfileModal(){document.getElementById('profile-modal').style.display='none';}
function openManageAccount(){
  document.getElementById('user-dropdown').style.display='none';
  const p=sbProfile||{};
  document.getElementById('acc-name').value=p.full_name||'';
  document.getElementById('acc-username').value=p.username||'';
  document.getElementById('acc-pass').value='';
  var phoneCode=p.phone_code||'+212';
  document.getElementById('acc-phone').value=p.phone||'';
  var codeEl=document.getElementById('acc-phone-code');
  if(codeEl){for(var i=0;i<codeEl.options.length;i++){if(codeEl.options[i].value===phoneCode){codeEl.selectedIndex=i;break;}}}
  document.getElementById('acc-err').style.display='none';
  document.getElementById('acc-ok').style.display='none';
  document.getElementById('account-modal').style.display='flex';
}
function closeAccountModal(){document.getElementById('account-modal').style.display='none';}
async function saveAccount(){
  var name=document.getElementById('acc-name').value.trim();
  var pass=document.getElementById('acc-pass').value;
  var phone=document.getElementById('acc-phone').value.trim();
  var phoneCode=document.getElementById('acc-phone-code').value;
  var err=document.getElementById('acc-err');
  var ok=document.getElementById('acc-ok');
  err.style.display='none'; ok.style.display='none';
  if(!name){err.textContent='Full name is required.';err.style.display='block';return;}
  if(pass && pass.length<6){err.textContent='Password must be at least 6 characters.';err.style.display='block';return;}
  // Update password if provided
  if(pass){
    const {error}=await sb.auth.updateUser({password:pass});
    if(error){err.textContent=error.message;err.style.display='block';return;}
  }
  // Update profile
  const {error:pe}=await sb.from('profiles').update({full_name:name,phone,phone_code:phoneCode,updated_at:new Date().toISOString()}).eq('id',sbUser.id);
  if(pe){err.textContent=pe.message;err.style.display='block';return;}
  if(sbProfile){sbProfile.full_name=name;sbProfile.phone=phone;sbProfile.phone_code=phoneCode;}
  updateUserChip(name);
  ok.textContent='Profile updated successfully.';ok.style.display='block';
  setTimeout(function(){closeAccountModal();},1200);
}
