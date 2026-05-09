var ncrEditId = null;
var ncrStatus = 'open';

function openNCRModal(){
  ncrEditId = null;
  hideNCRForm();
  renderNCRList();
  document.getElementById('ncr-modal').style.display='flex';
}
function closeNCRModal(){document.getElementById('ncr-modal').style.display='none';}

async function getNcrs(){
  try{
    const {data}=await sb.from('ncrs').select('*').order('created_at',{ascending:false});
    if(data) return data.map(r=>({
      id:r.id, ncrNumber:r.ncr_number, date:r.date, facadeZone:r.facade_zone,
      panelId:r.panel_id, category:r.category, severity:r.severity,
      description:r.description, correctiveAction:r.corrective_action,
      responsibleParty:r.responsible_party, dueDate:r.due_date, status:r.status
    }));
  }catch(e){}
  try{return JSON.parse(localStorage.getItem('bm_ncrs')||'[]');}catch(e){return[];}
}
async function saveNcrs(arr){
  try{localStorage.setItem('bm_ncrs',JSON.stringify(arr));}catch(e){}
}

function setNCRStatus(st){
  ncrStatus = st;
  ['open','in-progress','closed'].forEach(function(s){
    var el = document.getElementById('ncr-st-'+s);
    if(!el) return;
    var active = s === st;
    el.style.borderColor = active ? '#224F93' : 'rgba(34,79,147,0.2)';
    el.style.background = active ? 'rgba(34,79,147,0.06)' : 'transparent';
    el.style.color = active ? '#224F93' : '#1a2a3a';
  });
}

async function showNCRForm(editId){
  ncrEditId = editId || null;
  var today = new Date().toISOString().split('T')[0];
  document.getElementById('ncr-form-title').textContent = editId ? 'Edit Non Conformity Report' : 'New Non Conformity Report';
  if(editId){
    var ncrs = await getNcrs();
    var r = ncrs.find(function(x){return x.id===editId;});
    if(r){
      document.getElementById('ncr-number').value = r.ncr_number||r.number||'';
      document.getElementById('ncr-date').value = r.date||today;
      document.getElementById('ncr-zone').value = r.facade_zone||r.zone||'';
      document.getElementById('ncr-panel').value = r.panel_id||r.panel||'';
      document.getElementById('ncr-category').value = r.category||'';
      document.getElementById('ncr-severity').value = r.severity||'';
      document.getElementById('ncr-description').value = r.description||'';
      document.getElementById('ncr-action').value = r.corrective_action||r.action||'';
      document.getElementById('ncr-responsible').value = r.responsible_party||r.responsible||'';
      document.getElementById('ncr-due').value = r.due_date||r.due||'';
      setNCRStatus(r.status||'open');
    }
  } else {
    document.getElementById('ncr-number').value = await autoNCRNumber();
    document.getElementById('ncr-date').value = today;
    document.getElementById('ncr-zone').value = '';
    document.getElementById('ncr-panel').value = '';
    document.getElementById('ncr-category').value = '';
    document.getElementById('ncr-severity').value = '';
    document.getElementById('ncr-description').value = '';
    document.getElementById('ncr-action').value = '';
    document.getElementById('ncr-responsible').value = '';
    document.getElementById('ncr-due').value = '';
    setNCRStatus('open');
  }
  document.getElementById('ncr-err').style.display='none';
  document.getElementById('ncr-form-wrap').style.display='block';
  document.getElementById('ncr-empty').style.display='none';
}

function hideNCRForm(){
  document.getElementById('ncr-form-wrap').style.display='none';
  renderNCRList();
}

async function autoNCRNumber(){
  var ncrs = await getNcrs();
  var n = ncrs.length + 1;
  return 'NCR-' + String(n).padStart(3,'0');
}

async function saveNCR(){
  var number = document.getElementById('ncr-number').value.trim();
  var date = document.getElementById('ncr-date').value;
  var zone = document.getElementById('ncr-zone').value;
  var description = document.getElementById('ncr-description').value.trim();
  var err = document.getElementById('ncr-err');
  err.style.display='none';
  if(!number){err.textContent='NCR Number is required.';err.style.display='block';return;}
  if(!description){err.textContent='Description is required.';err.style.display='block';return;}
  var record = {
    id: ncrEditId || ('ncr_'+Date.now()),
    ncr_number: number,
    date: date||null,
    facade_zone: zone,
    panel_id: document.getElementById('ncr-panel').value.trim()||null,
    category: document.getElementById('ncr-category').value,
    severity: document.getElementById('ncr-severity').value,
    description: description,
    corrective_action: document.getElementById('ncr-action').value.trim()||null,
    responsible_party: document.getElementById('ncr-responsible').value.trim()||null,
    due_date: document.getElementById('ncr-due').value||null,
    status: ncrStatus,
    created_by: sbUser?.id||null,
    updated_at: new Date().toISOString()
  };
  try{
    await sb.from('ncrs').upsert(record,{onConflict:'id'});
  }catch(e){
    // fallback: save to localStorage
    var ncrs=JSON.parse(localStorage.getItem('bm_ncrs')||'[]');
    var idx=ncrs.findIndex(function(x){return x.id===record.id;});
    if(idx>=0) ncrs[idx]=record; else ncrs.push(record);
    localStorage.setItem('bm_ncrs',JSON.stringify(ncrs));
  }
  hideNCRForm();
  renderNCRList();
}

async function deleteNCR(id){
  if(!confirm('Delete this NCR?')) return;
  try{
    await sb.from('ncrs').delete().eq('id',id);
  }catch(e){
    var ncrs=JSON.parse(localStorage.getItem('bm_ncrs')||'[]').filter(function(x){return x.id!==id;});
    localStorage.setItem('bm_ncrs',JSON.stringify(ncrs));
  }
  renderNCRList();
}

async function renderNCRList(){
  var ncrs = await getNcrs();
  var list = document.getElementById('ncr-list');
  var empty = document.getElementById('ncr-empty');
  if(!ncrs.length){
    list.innerHTML='';
    empty.style.display='block';
    return;
  }
  empty.style.display='none';
  var sevColor={'critical':'#c02020','major':'#e07020','minor':'#c09000','observation':'#1a6fbd'};
  var stBg={'open':'rgba(192,32,32,0.08)','in-progress':'rgba(224,112,32,0.08)','closed':'rgba(26,148,88,0.08)'};
  var stColor={'open':'#c02020','in-progress':'#c07010','closed':'#1a9458'};
  var stLabel={'open':'Open','in-progress':'In Progress','closed':'Closed'};
  list.innerHTML = ncrs.map(function(r){
    return '<div style="background:#f4f8fd;border:1px solid rgba(34,79,147,0.1);border-radius:9px;padding:12px 14px;margin-bottom:8px;">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">' +
        '<div style="flex:1;">' +
          '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px;">' +
            '<span style="font-size:12px;font-weight:700;color:#224F93;">' + r.number + '</span>' +
            (r.severity ? '<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:' + (sevColor[r.severity]||'#888') + '22;color:' + (sevColor[r.severity]||'#888') + ';">' + r.severity.charAt(0).toUpperCase()+r.severity.slice(1) + '</span>' : '') +
            '<span style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px;background:' + (stBg[r.status]||'#eee') + ';color:' + (stColor[r.status]||'#888') + ';">' + (stLabel[r.status]||r.status) + '</span>' +
          '</div>' +
          (r.category ? '<div style="font-size:11px;color:#4a6080;margin-bottom:3px;">' + r.category + (r.zone ? ' · ' + r.zone : '') + (r.panel ? ' · ' + r.panel : '') + '</div>' : '') +
          '<div style="font-size:11px;color:#1a2a3a;margin-bottom:4px;">' + r.description + '</div>' +
          (r.action ? '<div style="font-size:10px;color:#8099b0;"><b>Action:</b> ' + r.action + '</div>' : '') +
          (r.responsible || r.due ? '<div style="font-size:10px;color:#8099b0;margin-top:2px;">' + (r.responsible?'<b>Responsible:</b> '+r.responsible+' ':'') + (r.due?'· <b>Due:</b> '+r.due:'') + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;gap:5px;flex-shrink:0;">' +
          '<button onclick="showNCRForm(\'' + r.id + '\')" style="padding:4px 9px;background:#fff;border:1px solid rgba(34,79,147,0.2);border-radius:5px;cursor:pointer;font-family:\'Barlow\',sans-serif;font-size:10px;font-weight:600;color:#224F93;" onmouseover="this.style.background=\'#f0f4f9\'" onmouseout="this.style.background=\'#fff\'">Edit</button>' +
          '<button onclick="deleteNCR(\'' + r.id + '\')" style="padding:4px 9px;background:#fff;border:1px solid rgba(192,32,32,0.2);border-radius:5px;cursor:pointer;font-family:\'Barlow\',sans-serif;font-size:10px;font-weight:600;color:#c02020;" onmouseover="this.style.background=\'#fff5f5\'" onmouseout="this.style.background=\'#fff\'">✕</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}
