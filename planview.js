'use strict';
// ══════════════════════════════════════════════════════════════════════════════
// Plan View Module — Batimon
// Stores in project_info table:
//   key: planlayout__{facade}      → JSON {floor: {rects:[{id,cellKey,x,y,w,h,label}]}}
//   key: planbg__{facade}__{floor} → base64 image data URL
// ══════════════════════════════════════════════════════════════════════════════

const _pvLayouts = {};   // "pid|facade" → {floor: {rects:[...]}}
const _pvBgs     = {};   // "pid|facade|floor" → dataURL

let _pvState = {
  pid:null, facade:null, floor:null,
  drawMode:null,        // null | 'rect' | 'poly'
  selectedId:null,
};
let _pvMouse = {down:false, mode:null};
let _pvPendingRect  = null;
let _pvEditingRectId = null;
let _pvPolyPoints  = [];   // in-progress polyline [{x,y}] percentages
let _pvPolyNamePos = 'above'; // 'above' | 'inside'
let _pvUndoStack = [];
let _pvRedoStack = [];

function _pvUndoPush(){
  const {pid,facade,floor}=_pvState;
  const key=`${pid}|${facade}`;
  const snap=JSON.parse(JSON.stringify(_pvLayouts[key]?.[floor]||{rects:[]}));
  _pvUndoStack.push({pid,facade,floor,snap});
  if(_pvUndoStack.length>50) _pvUndoStack.shift();
  _pvRedoStack=[];
  _pvSyncPvUndoRedoBtns();
}
function _pvSyncPvUndoRedoBtns(){
  const ub=document.getElementById('pv-undo-btn');
  const rb=document.getElementById('pv-redo-btn');
  if(ub){ub.disabled=_pvUndoStack.length===0;ub.style.opacity=_pvUndoStack.length===0?'0.4':'1';}
  if(rb){rb.disabled=_pvRedoStack.length===0;rb.style.opacity=_pvRedoStack.length===0?'0.4':'1';}
}
function pvUndoLast(){
  if(!_pvUndoStack.length) return;
  const {pid,facade,floor,snap}=_pvUndoStack.pop();
  const key=`${pid}|${facade}`;
  if(!_pvLayouts[key]) _pvLayouts[key]={};
  _pvRedoStack.push({pid,facade,floor,snap:JSON.parse(JSON.stringify(_pvLayouts[key][floor]||{rects:[]}))});
  if(_pvRedoStack.length>50) _pvRedoStack.shift();
  _pvLayouts[key][floor]=snap;
  _pvRefreshSVG();
  pvSaveLayout(true);
  _pvSyncPvUndoRedoBtns();
}
function pvRedoLast(){
  if(!_pvRedoStack.length) return;
  const {pid,facade,floor,snap}=_pvRedoStack.pop();
  const key=`${pid}|${facade}`;
  if(!_pvLayouts[key]) _pvLayouts[key]={};
  _pvUndoStack.push({pid,facade,floor,snap:JSON.parse(JSON.stringify(_pvLayouts[key][floor]||{rects:[]}))});
  if(_pvUndoStack.length>50) _pvUndoStack.shift();
  _pvLayouts[key][floor]=snap;
  _pvRefreshSVG();
  pvSaveLayout(true);
  _pvSyncPvUndoRedoBtns();
}

function _pvIsDev(){
  if(typeof sbProfile==='undefined'||!sbProfile) return false;
  return sbProfile.role==='developer'||sbProfile.role==='admin';
}

// ── showToast shim ──────────────────────────────────────────────────────────
function _pvToast(msg){ if(typeof showToast==='function') showToast(msg); else alert(msg); }

// ─────────────────────────────────────────────────────────────────────────────
// STORAGE
// ─────────────────────────────────────────────────────────────────────────────

async function pvLoadLayout(pid, facade){
  const k=`${pid}|${facade}`;
  if(_pvLayouts[k]) return _pvLayouts[k];
  try{
    const {data}=await sb.from('project_info').select('value')
      .eq('project',pid).eq('key',`planlayout__${facade}`).maybeSingle();
    _pvLayouts[k]=data?JSON.parse(data.value):{};
  }catch(e){_pvLayouts[k]={};}
  return _pvLayouts[k];
}

async function pvSaveLayout(silent){
  const {pid,facade}=_pvState;
  const val=JSON.stringify(_pvLayouts[`${pid}|${facade}`]||{});
  try{
    await sb.from('project_info').upsert(
      {project:pid,key:`planlayout__${facade}`,value:val},
      {onConflict:'project,key'}
    );
    if(!silent) _pvToast('Layout saved');
  }catch(e){ _pvToast('Error saving layout'); }
}

async function pvLoadBg(pid,facade,floor){
  const k=`${pid}|${facade}|${floor}`;
  if(_pvBgs[k]!==undefined) return _pvBgs[k];
  try{
    const {data}=await sb.from('project_info').select('value')
      .eq('project',pid).eq('key',`planbg__${facade}__${floor}`).maybeSingle();
    _pvBgs[k]=data?data.value:'';
  }catch(e){_pvBgs[k]='';}
  return _pvBgs[k];
}

async function pvSaveBg(pid,facade,floor,dataUrl){
  _pvBgs[`${pid}|${facade}|${floor}`]=dataUrl;
  try{
    await sb.from('project_info').upsert(
      {project:pid,key:`planbg__${facade}__${floor}`,value:dataUrl},
      {onConflict:'project,key'}
    );
  }catch(e){ _pvToast('Error saving background'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY
// ─────────────────────────────────────────────────────────────────────────────

async function renderPlanView(pid, facade, container){
  _pvState.pid=pid; _pvState.facade=facade;
  _pvState.drawMode=null; _pvState.selectedId=null;
  _pvPolyPoints=[];

  const isDev=_pvIsDev();
  const meta=_custGetMeta(pid,facade);
  const floors=meta.rows.map(r=>r.label);
  if(!_pvState.floor||!floors.includes(_pvState.floor)) _pvState.floor=floors[0];

  await pvLoadLayout(pid,facade);
  await pvLoadBg(pid,facade,_pvState.floor);
  _pvBuild(container,isDev,floors);
}

function _pvBuild(container, isDev, floors){
  const {pid,facade,floor}=_pvState;
  const layout=_pvLayouts[`${pid}|${facade}`]||{};
  const bgUrl=_pvBgs[`${pid}|${facade}|${floor}`]||'';

  const floorBtns=floors.map(f=>`
    <button onclick="pvSelectFloor('${f}')"
      style="padding:3px 10px;border-radius:5px;font-family:var(--font);font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all 0.12s;
      ${f===floor?'background:#224F93;color:#fff;border:1px solid #224F93;':'background:var(--surface);color:var(--text2);border:1px solid var(--border);'}">${f}</button>
  `).join('');

  const devBar=isDev?`
    <div id="pv-devbar" style="display:flex;align-items:center;gap:6px;padding:6px 14px;background:#fffbea;border-bottom:1px solid #f0d060;flex-shrink:0;flex-wrap:wrap;">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#a07800" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
      <span style="font-size:10px;font-weight:700;color:#a07800;text-transform:uppercase;letter-spacing:0.06em;">Dev Tools</span>
      <div style="width:1px;height:14px;background:rgba(0,0,0,0.1);margin:0 2px;"></div>
      <label style="display:flex;align-items:center;gap:5px;padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:var(--surface);cursor:pointer;font-size:11px;font-weight:600;color:var(--text2);">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Upload Plan
        <input type="file" id="pv-bg-input" accept="image/*,application/pdf" onchange="pvUploadBg(this)" style="display:none;">
      </label>
      <button id="pv-draw-rect-btn" onclick="pvToggleDrawRect()"
        style="padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text2);font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
        Draw Rect
      </button>
      <button id="pv-draw-poly-btn" onclick="pvToggleDrawPoly()"
        style="padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text2);font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 22 9.5 18 21 6 21 2 9.5"/></svg>
        Draw Poly
      </button>
      <button onclick="pvDeleteSelected()"
        style="padding:3px 9px;border:1px solid rgba(192,32,32,0.25);border-radius:5px;background:#fff5f5;color:#c02020;font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;">Delete</button>
      <button onclick="pvInsertTitleBlock()"
        style="padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text2);font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:5px;">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>
        Title
      </button>
      <button onclick="pvShowDupModal()"
        style="padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text2);font-family:var(--font);font-size:11px;font-weight:600;cursor:pointer;">Duplicate from…</button>
      <span id="pv-hint" style="font-size:10px;color:#a07800;font-style:italic;"></span>
      <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
        <button id="pv-undo-btn" onclick="pvUndoLast()" disabled style="padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text2);font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;opacity:0.4;" title="Nothing to undo">↩ Undo</button>
        <button id="pv-redo-btn" onclick="pvRedoLast()" disabled style="padding:3px 9px;border:1px solid var(--border);border-radius:5px;background:var(--surface);color:var(--text2);font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;opacity:0.4;" title="Nothing to redo">↪ Redo</button>
        <button onclick="pvSaveLayout(false)"
          style="padding:3px 13px;border:none;border-radius:5px;background:#224F93;color:#fff;font-family:var(--font);font-size:11px;font-weight:700;cursor:pointer;">Save Layout</button>
      </div>
    </div>` : '';

  const bgHtml=bgUrl
    ? `<img id="pv-bg-img" src="${bgUrl}" style="display:block;max-width:100%;max-height:calc(100vh - 220px);pointer-events:none;user-select:none;" draggable="false">`
    : `<div style="width:700px;height:480px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;color:#8099b0;background:#f8fafd;border:2px dashed rgba(34,79,147,0.15);border-radius:8px;">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 3v18"/></svg>
        <div style="font-size:13px;font-weight:600;">${isDev?'Upload a floor plan to begin':'No plan uploaded for this floor'}</div>
        ${isDev?'<div style="font-size:11px;">Use the Upload Plan button above</div>':''}
      </div>`;

  container.innerHTML=`
    <div style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
      ${devBar}
      <div style="display:flex;align-items:center;gap:5px;padding:7px 16px;border-bottom:1px solid var(--border);flex-shrink:0;overflow-x:auto;">
        <span style="font-size:10px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.06em;flex-shrink:0;">Floor:</span>
        <div style="display:flex;gap:4px;flex-wrap:nowrap;">${floorBtns}</div>
      </div>
      <div style="flex:1;overflow:auto;background:#dce6f4;display:flex;align-items:flex-start;justify-content:center;padding:20px;">
        <div id="pv-canvas-wrap" style="position:relative;background:#fff;box-shadow:0 4px 24px rgba(34,79,147,0.15);line-height:0;display:inline-block;border-radius:4px;overflow:hidden;">
          ${bgHtml}
          <svg id="pv-svg" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;"
            onmousedown="pvMD(event)" onmousemove="pvMM(event)" onmouseup="pvMU(event)"
            oncontextmenu="return false;">
            <rect id="pv-ghost" x="0" y="0" width="0" height="0"
              fill="rgba(34,79,147,0.12)" stroke="#224F93" stroke-width="1.5" stroke-dasharray="5,3"
              style="display:none;pointer-events:none;"/>
            <polyline id="pv-poly-ghost" points="" fill="none" stroke="#224F93" stroke-width="1.5" stroke-dasharray="5,3"
              style="display:none;pointer-events:none;"/>
            <g id="pv-poly-dots" style="pointer-events:none;"></g>
            <circle id="pv-snap-dot" cx="0" cy="0" r="0" fill="rgba(34,79,147,0.15)" stroke="#224F93" stroke-width="1.5"
              style="pointer-events:none;"/>
          </svg>
        </div>
      </div>
    </div>
  `;

  ['pv-link-modal','pv-dup-modal'].forEach(id=>{
    const old=document.getElementById(id); if(old) old.remove();
  });
  const _modWrap=document.createElement('div');
  _modWrap.id='pv-modals-root';
  _modWrap.innerHTML=_pvLinkModalHTML()+_pvDupModalHTML(pid,facade);
  document.body.appendChild(_modWrap);

  // ResizeObserver keeps pixel-based poly rendering accurate on canvas resize
  const canvasWrap=document.getElementById('pv-canvas-wrap');
  if(canvasWrap&&window.ResizeObserver&&!canvasWrap._pvRO){
    const ro=new ResizeObserver(()=>_pvRefreshSVG());
    ro.observe(canvasWrap);
    canvasWrap._pvRO=ro;
  }

  requestAnimationFrame(_pvRefreshSVG);
}

// ─────────────────────────────────────────────────────────────────────────────
// TITLE BLOCK HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _pvGetTitleLines(pid, facade){
  const projName=(window.PROJECT_META&&window.PROJECT_META[pid])
    ? window.PROJECT_META[pid].name
    : (window._activeProjectName||pid||'Project');
  const cats=(typeof getProjectCategories==='function')?getProjectCategories(pid):[];
  const pageId=window._currentCustomPage||'';
  let catNum=1, facadeDir=facade;
  const catFM=pageId.match(/^c(\d+)-([A-Z]+)$/);
  if(catFM){
    catNum=parseInt(catFM[1]); facadeDir=catFM[2];
  } else {
    const leg={NF:'NF','BM-NF':'NF',SF:'SF','BM-SF':'SF',EF:'EF','BM-EF':'EF',WF:'WF','BM-WF':'WF'};
    facadeDir=leg[pageId]||pageId; catNum=1;
  }
  const cat=cats.find(x=>x.num===catNum);
  const catNick=cat?.name||cat?.nick||('CAT'+catNum);
  const rawName=cat?.facadeNames?.[facadeDir];
  const formatted=(typeof _fmtFacadeDisplay==='function'&&rawName)
    ? (_fmtFacadeDisplay(rawName)||facadeDir)
    : (rawName||facadeDir);
  const facNick=(typeof _stripTrailingNum==='function')
    ? (_stripTrailingNum(formatted)||facadeDir)
    : formatted;
  return [projName, catNick, facNick, _pvState.floor||''];
}

function pvInsertTitleBlock(){
  const {pid,facade,floor}=_pvState;
  if(!_pvLayouts[`${pid}|${facade}`]) _pvLayouts[`${pid}|${facade}`]={};
  if(!_pvLayouts[`${pid}|${facade}`][floor]) _pvLayouts[`${pid}|${facade}`][floor]={rects:[]};
  _pvUndoPush();
  const rects=_pvLayouts[`${pid}|${facade}`][floor].rects;
  const id='t'+Date.now();
  rects.push({id, type:'title', cellKey:'', label:'title', x:1, y:1, w:28, h:18});
  _pvState.selectedId=id;
  _pvRefreshSVG();
  _pvToast('Title block added — move/resize, then Save Layout');
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG RECT RENDERING
// ─────────────────────────────────────────────────────────────────────────────

function _pvRectSVG(rect, pid, facade){
  const isSel=_pvState.selectedId===rect.id;
  const isDev=_pvIsDev();
  const x=`${rect.x}%`, y=`${rect.y}%`, w=`${rect.w}%`, h=`${rect.h}%`;
  const handles=(isSel&&isDev)?_pvHandlesSVG(rect):'';

  if(rect.type==='title'){
    const lines=_pvGetTitleLines(pid,facade);
    const cx=rect.x+rect.w/2, cy=rect.y+rect.h/2;
    const tspans=lines.map((ln,i)=>{
      const bold=i===0?'font-weight:800;':'font-weight:600;';
      const opacity=i===0?'1':'0.75';
      return `<tspan x="${cx}%" dy="${i===0?'0':'1.25em'}" style="${bold}opacity:${opacity};">${ln||''}</tspan>`;
    }).join('');
    return `
      <g id="pvrg-${rect.id}" class="pv-rg pv-title-rg" data-id="${rect.id}"
         onmousedown="pvRectMD(event,'${rect.id}');event.stopPropagation();"
         style="cursor:${isDev?'move':'default'};">
        <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3"
          fill="transparent" fill-opacity="0"
          stroke="${isSel?'#224F93':'transparent'}" stroke-width="${isSel?2:0}"
          ${isSel?'stroke-dasharray="6,3"':''}/>
        <text class="pv-title-text" x="${cx}%" y="${rect.y+rect.h*0.22}%"
          text-anchor="middle" dominant-baseline="middle"
          fill="#224F93" font-family="Barlow,sans-serif"
          style="pointer-events:none;user-select:none;font-size:10px;">
          ${tspans}
        </text>
        ${handles}
      </g>`;
  }

  const cells=_custFacadeCache[`${pid}|${facade}`]||{};
  const cellData=cells[rect.cellKey]||{};
  const st=cellData.status||'pending';
  const bg=_custStBg[st]||'#f0f4f9';
  const tc=_custStText[st]||'#4a6080';
  const lbl=cellData.panelRef||rect.label||rect.cellKey;
  const isPortrait=rect.h>rect.w;
  const rot=rect.rotation||0;
  const cx_pct=rect.x+rect.w/2, cy_pct=rect.y+rect.h/2;
  const grpRotStyle=rot?`transform-box:view-box;transform-origin:${cx_pct}% ${cy_pct}%;transform:rotate(${rot}deg);`:'';
  const txtStyle=`pointer-events:none;user-select:none;font-size:10px;${isPortrait?'transform-box:fill-box;transform-origin:center;transform:rotate(-90deg);':''}`;
  return `
    <g id="pvrg-${rect.id}" class="pv-rg${isPortrait?' pv-portrait':''}" data-id="${rect.id}"
       onclick="pvRectClick(event,'${rect.id}','${rect.cellKey}','${pid}','${facade}')"
       oncontextmenu="pvRectRC(event,'${rect.id}','${rect.cellKey}','${pid}','${facade}');return false;"
       onmousedown="pvRectMD(event,'${rect.id}');event.stopPropagation();"
       style="cursor:pointer;${grpRotStyle}">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2"
        fill="${bg}" fill-opacity="${st==='pending'?0.3:0.72}"
        stroke="${isSel?'#224F93':tc}" stroke-width="${isSel?2:1}"
        ${isSel?'stroke-dasharray="5,3"':''}/>
      <svg x="${x}" y="${y}" width="${w}" height="${h}" overflow="hidden" style="pointer-events:none;">
        <text x="50%" y="50%"
          text-anchor="middle" dominant-baseline="middle"
          fill="${tc}" font-family="Barlow,sans-serif" font-weight="700"
          style="${txtStyle}">${lbl}</text>
      </svg>
      ${handles}
    </g>`;
}

const _PV_HW=7;
function _pvHandlesSVG(rect){
  const pts=[
    {cx:rect.x,          cy:rect.y,          pos:'nw'},
    {cx:rect.x+rect.w/2, cy:rect.y,          pos:'n'},
    {cx:rect.x+rect.w,   cy:rect.y,          pos:'ne'},
    {cx:rect.x+rect.w,   cy:rect.y+rect.h/2, pos:'e'},
    {cx:rect.x+rect.w,   cy:rect.y+rect.h,   pos:'se'},
    {cx:rect.x+rect.w/2, cy:rect.y+rect.h,   pos:'s'},
    {cx:rect.x,          cy:rect.y+rect.h,   pos:'sw'},
    {cx:rect.x,          cy:rect.y+rect.h/2, pos:'w'},
  ];
  const resizeHandles=pts.map(p=>`
    <circle class="pv-handle" data-pos="${p.pos}"
      cx="${p.cx}%" cy="${p.cy}%" r="4"
      fill="#fff" stroke="#224F93" stroke-width="1.5"
      style="cursor:${p.pos}-resize;"
      onmousedown="pvHandleMD(event,'${p.pos}');event.stopPropagation();"/>`).join('');
  const rcx=rect.x+rect.w/2;
  const rcy=rect.y-4;
  const rotHandle=`
    <line x1="${rcx}%" y1="${rect.y}%" x2="${rcx}%" y2="${rcy}%"
      stroke="#d08020" stroke-width="1" stroke-dasharray="3,2" style="pointer-events:none;"/>
    <circle class="pv-rot-handle"
      cx="${rcx}%" cy="${rcy}%" r="5"
      fill="#fffbe6" stroke="#d08020" stroke-width="1.5"
      style="cursor:grab;"
      onmousedown="pvRotHandleMD(event);event.stopPropagation();"/>`;
  return resizeHandles+rotHandle;
}

// ─────────────────────────────────────────────────────────────────────────────
// POLYLINE RENDERING
// ─────────────────────────────────────────────────────────────────────────────

function _pvPolySVG(poly, pid, facade){
  const isSel=_pvState.selectedId===poly.id;
  const isDev=_pvIsDev();
  const svg=document.getElementById('pv-svg');
  if(!svg||!poly.points||poly.points.length<2) return '';
  const b=svg.getBoundingClientRect();
  if(!b||!b.width||!b.height) return '';

  const pxPts=poly.points.map(p=>`${p.x/100*b.width},${p.y/100*b.height}`).join(' ');

  // Centroid
  const cx=poly.points.reduce((s,p)=>s+p.x,0)/poly.points.length;
  const cy=poly.points.reduce((s,p)=>s+p.y,0)/poly.points.length;
  const topY=Math.min(...poly.points.map(p=>p.y));
  const cxPx=cx/100*b.width;
  const lblY=(poly.namePos==='inside') ? cy/100*b.height : (topY/100*b.height-14);

  const cells=_custFacadeCache[`${pid}|${facade}`]||{};
  const cellData=cells[poly.cellKey]||{};
  const st=cellData.status||'pending';
  const fillBg=poly.cellKey?(_custStBg[st]||'rgba(34,79,147,0.15)'):'rgba(34,79,147,0.12)';
  const fillOp=poly.cellKey?(st==='pending'?'0.3':'0.6'):'1';
  const strokeClr=isSel?'#224F93':(poly.cellKey?(_custStText[st]||'#4a6080'):'#4a6080');
  const lbl=poly.label||'';

  const vertexHandles=(isSel&&isDev)?poly.points.map((p,i)=>{
    const px=p.x/100*b.width, py=p.y/100*b.height;
    return `<circle class="pv-handle pv-poly-vx" data-idx="${i}"
      cx="${px}" cy="${py}" r="5"
      fill="#fff" stroke="#224F93" stroke-width="1.5" style="cursor:move;"
      onmousedown="pvPolyVertexMD(event,${i});event.stopPropagation();"/>`;
  }).join('') : '';

  return `<g id="pvrg-${poly.id}" class="pv-rg pv-poly-rg" data-id="${poly.id}"
    onclick="pvPolyClick(event,'${poly.id}','${pid}','${facade}')"
    oncontextmenu="pvPolyRC(event,'${poly.id}','${pid}','${facade}');return false;"
    onmousedown="pvPolyMD(event,'${poly.id}');event.stopPropagation();"
    style="cursor:${isDev?'move':'pointer'};">
    <polygon points="${pxPts}"
      fill="${fillBg}" fill-opacity="${fillOp}"
      stroke="${strokeClr}" stroke-width="${isSel?2:1.5}"
      ${isSel?'stroke-dasharray="5,3"':''}/>
    ${lbl?`<text x="${cxPx}" y="${lblY}"
      text-anchor="middle" dominant-baseline="middle"
      fill="${isSel?'#224F93':strokeClr}" font-family="Barlow,sans-serif" font-weight="700" font-size="11"
      style="pointer-events:none;user-select:none;">${lbl}</text>`:''}
    ${vertexHandles}
  </g>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// COORDINATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _pvPct(e){
  const wrap=document.getElementById('pv-canvas-wrap');
  if(!wrap) return {x:0,y:0};
  const b=wrap.getBoundingClientRect();
  return {
    x:Math.max(0,Math.min(100,(e.clientX-b.left)/b.width*100)),
    y:Math.max(0,Math.min(100,(e.clientY-b.top)/b.height*100))
  };
}

// Update ghost polyline preview during draw
function _pvUpdatePolyGhost(pts){
  const ghost=document.getElementById('pv-poly-ghost');
  const dots=document.getElementById('pv-poly-dots');
  if(!ghost) return;
  const wrap=document.getElementById('pv-canvas-wrap');
  const b=wrap?wrap.getBoundingClientRect():null;
  if(!b||!pts||pts.length===0){
    if(ghost){ghost.style.display='none';ghost.setAttribute('points','');}
    if(dots) dots.innerHTML='';
    return;
  }
  ghost.style.display='';
  ghost.setAttribute('points',pts.map(p=>`${p.x/100*b.width},${p.y/100*b.height}`).join(' '));
  // Committed point markers (all but last which is the live cursor)
  if(dots){
    dots.innerHTML=_pvPolyPoints.map(p=>{
      const px=p.x/100*b.width, py=p.y/100*b.height;
      return `<circle cx="${px}" cy="${py}" r="3" fill="#224F93" stroke="#fff" stroke-width="1.5"/>`;
    }).join('');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MOUSE EVENTS
// ─────────────────────────────────────────────────────────────────────────────

function pvMD(e){
  if(e.button!==0) return;

  // ── Polyline draw mode: click to place points ──────────────────────────────
  if(_pvState.drawMode==='poly'){
    if(e.target.closest('.pv-rg')) return;
    const pt=_pvPct(e);
    if(_pvPolyPoints.length>=3){
      // Check proximity to first point
      const first=_pvPolyPoints[0];
      const wrap=document.getElementById('pv-canvas-wrap');
      const b=wrap?wrap.getBoundingClientRect():null;
      if(b){
        const dx=(pt.x-first.x)/100*b.width;
        const dy=(pt.y-first.y)/100*b.height;
        if(Math.sqrt(dx*dx+dy*dy)<15){
          // Close the polyline
          const pts=[..._pvPolyPoints];
          _pvPolyPoints=[];
          _pvUpdatePolyGhost([]);
          const snap=document.getElementById('pv-snap-dot');
          if(snap) snap.setAttribute('r','0');
          _pvPolyFinalize(pts);
          e.preventDefault();
          return;
        }
      }
    }
    _pvPolyPoints.push(pt);
    _pvUpdatePolyGhost([..._pvPolyPoints, pt]);
    _pvMouse={down:true,mode:'poly-point'};
    e.preventDefault();
    return;
  }

  // ── Rect draw mode: drag to draw ──────────────────────────────────────────
  if(_pvState.drawMode==='rect'){
    if(e.target.closest('.pv-rg')) return;
    const pt=_pvPct(e);
    _pvMouse={down:true,mode:'draw',startX:pt.x,startY:pt.y};
    const g=document.getElementById('pv-ghost');
    if(g){g.style.display='';g.setAttribute('x',pt.x+'%');g.setAttribute('y',pt.y+'%');g.setAttribute('width','0%');g.setAttribute('height','0%');}
    e.preventDefault();
  }
}

function pvMM(e){
  // Poly ghost preview (runs even without mouse.down)
  if(_pvState.drawMode==='poly'&&_pvPolyPoints.length>0){
    const pt=_pvPct(e);
    const wrap=document.getElementById('pv-canvas-wrap');
    const b=wrap?wrap.getBoundingClientRect():null;
    // Snap indicator near first point
    const snap=document.getElementById('pv-snap-dot');
    if(snap&&b&&_pvPolyPoints.length>=3){
      const first=_pvPolyPoints[0];
      const dx=(pt.x-first.x)/100*b.width;
      const dy=(pt.y-first.y)/100*b.height;
      if(Math.sqrt(dx*dx+dy*dy)<15){
        snap.setAttribute('cx', first.x/100*b.width);
        snap.setAttribute('cy', first.y/100*b.height);
        snap.setAttribute('r','10');
      } else {
        snap.setAttribute('r','0');
      }
    }
    _pvUpdatePolyGhost([..._pvPolyPoints, pt]);
    return;
  }

  if(!_pvMouse.down) return;
  const pt=_pvPct(e);
  if(_pvMouse.mode==='draw'){
    const x=Math.min(pt.x,_pvMouse.startX), y=Math.min(pt.y,_pvMouse.startY);
    const w=Math.abs(pt.x-_pvMouse.startX), h=Math.abs(pt.y-_pvMouse.startY);
    const g=document.getElementById('pv-ghost');
    if(g){g.setAttribute('x',x+'%');g.setAttribute('y',y+'%');g.setAttribute('width',w+'%');g.setAttribute('height',h+'%');}
  } else if(_pvMouse.mode==='drag'){
    const dx=pt.x-_pvMouse.startX, dy=pt.y-_pvMouse.startY;
    const {pid,facade,floor}=_pvState;
    const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===_pvMouse.rectId);
    if(rect){rect.x=Math.max(0,_pvMouse.origX+dx); rect.y=Math.max(0,_pvMouse.origY+dy); _pvRefreshSVG();}
  } else if(_pvMouse.mode==='drag-poly'){
    const dx=pt.x-_pvMouse.startX, dy=pt.y-_pvMouse.startY;
    const {pid,facade,floor}=_pvState;
    const poly=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===_pvMouse.rectId);
    if(poly&&poly.points){
      poly.points=_pvMouse.origPts.map(p=>({
        x:Math.max(0,Math.min(100,p.x+dx)),
        y:Math.max(0,Math.min(100,p.y+dy))
      }));
      _pvRefreshSVG();
    }
  } else if(_pvMouse.mode==='drag-poly-vertex'){
    const dx=pt.x-_pvMouse.startX, dy=pt.y-_pvMouse.startY;
    const {pid,facade,floor}=_pvState;
    const poly=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===_pvMouse.rectId);
    if(poly&&poly.points){
      poly.points[_pvMouse.vertexIdx]={
        x:Math.max(0,Math.min(100,_pvMouse.origPts[_pvMouse.vertexIdx].x+dx)),
        y:Math.max(0,Math.min(100,_pvMouse.origPts[_pvMouse.vertexIdx].y+dy))
      };
      _pvRefreshSVG();
    }
  } else if(_pvMouse.mode==='resize'){
    const dx=pt.x-_pvMouse.startX, dy=pt.y-_pvMouse.startY;
    const {pid,facade,floor}=_pvState;
    const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===_pvMouse.rectId);
    if(rect){
      const or=_pvMouse.orig; const pos=_pvMouse.pos; const mn=0.1;
      if(pos.includes('e')) rect.w=Math.max(mn,or.w+dx);
      if(pos.includes('s')) rect.h=Math.max(mn,or.h+dy);
      if(pos.includes('w')){rect.x=or.x+dx; rect.w=Math.max(mn,or.w-dx);}
      if(pos.includes('n')){rect.y=or.y+dy; rect.h=Math.max(mn,or.h-dy);}
      _pvRefreshSVG();
    }
  } else if(_pvMouse.mode==='rotate'){
    const angle=Math.atan2(e.clientY-_pvMouse.cy,e.clientX-_pvMouse.cx)*180/Math.PI;
    const da=angle-_pvMouse.startAngle;
    const {pid,facade,floor}=_pvState;
    const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===_pvMouse.rectId);
    if(rect){rect.rotation=((_pvMouse.origRot+da)%360+360)%360; _pvRefreshSVG();}
  }
  e.preventDefault();
}

function pvMU(e){
  if(!_pvMouse.down) return;
  if(_pvMouse.mode==='poly-point'){
    _pvMouse={down:false,mode:null};
    return;
  }
  if(_pvMouse.mode==='draw'){
    const pt=_pvPct(e);
    const x=Math.min(pt.x,_pvMouse.startX), y=Math.min(pt.y,_pvMouse.startY);
    const w=Math.abs(pt.x-_pvMouse.startX), h=Math.abs(pt.y-_pvMouse.startY);
    const g=document.getElementById('pv-ghost');
    if(g){g.style.display='none';g.setAttribute('width','0%');g.setAttribute('height','0%');}
    if(w>0.1&&h>0.1){
      _pvPendingRect={id:'r'+Date.now(),x,y,w,h,cellKey:'',label:''};
      _pvEditingRectId=null;
      pvShowLinkModal();
    }
  } else if(_pvMouse.mode==='drag'||_pvMouse.mode==='resize'||_pvMouse.mode==='rotate'||
            _pvMouse.mode==='drag-poly'||_pvMouse.mode==='drag-poly-vertex'){
    pvSaveLayout(true);
  }
  _pvMouse={down:false,mode:null};
}

function pvRectMD(e,id){
  if(e.button!==0) return;
  if(_pvState.drawMode) return;
  const isDev=_pvIsDev();
  if(!isDev) return;
  _pvState.selectedId=id;
  const {pid,facade,floor}=_pvState;
  const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id);
  if(!rect) return;
  _pvUndoPush();
  const pt=_pvPct(e);
  _pvMouse={down:true,mode:'drag',rectId:id,startX:pt.x,startY:pt.y,origX:rect.x,origY:rect.y};
  _pvRefreshSVG();
}

function pvPolyMD(e,id){
  if(e.button!==0) return;
  if(_pvState.drawMode) return;
  const isDev=_pvIsDev();
  if(!isDev){
    // Non-dev: just select
    _pvState.selectedId=id;
    _pvRefreshSVG();
    return;
  }
  _pvState.selectedId=id;
  const {pid,facade,floor}=_pvState;
  const poly=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id);
  if(!poly) return;
  _pvUndoPush();
  const pt=_pvPct(e);
  _pvMouse={down:true,mode:'drag-poly',rectId:id,startX:pt.x,startY:pt.y,origPts:poly.points.map(p=>({...p}))};
  _pvRefreshSVG();
}

function pvPolyVertexMD(e,vertexIdx){
  if(e.button!==0||!_pvIsDev()) return;
  const id=_pvState.selectedId; if(!id) return;
  const {pid,facade,floor}=_pvState;
  const poly=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id&&r.type==='poly');
  if(!poly) return;
  _pvUndoPush();
  const pt=_pvPct(e);
  _pvMouse={down:true,mode:'drag-poly-vertex',rectId:id,vertexIdx,startX:pt.x,startY:pt.y,origPts:poly.points.map(p=>({...p}))};
}

function pvHandleMD(e,pos){
  if(e.button!==0) return;
  if(!_pvIsDev()) return;
  const id=_pvState.selectedId; if(!id) return;
  const {pid,facade,floor}=_pvState;
  const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id);
  if(!rect) return;
  _pvUndoPush();
  const pt=_pvPct(e);
  _pvMouse={down:true,mode:'resize',rectId:id,pos,startX:pt.x,startY:pt.y,orig:{...rect}};
}

function pvRotHandleMD(e){
  if(e.button!==0) return;
  if(!_pvIsDev()) return;
  const id=_pvState.selectedId; if(!id) return;
  const {pid,facade,floor}=_pvState;
  const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id);
  if(!rect) return;
  const wrap=document.getElementById('pv-canvas-wrap'); if(!wrap) return;
  const b=wrap.getBoundingClientRect();
  const cx=b.left+(rect.x+rect.w/2)/100*b.width;
  const cy=b.top+(rect.y+rect.h/2)/100*b.height;
  const startAngle=Math.atan2(e.clientY-cy,e.clientX-cx)*180/Math.PI;
  _pvUndoPush();
  _pvMouse={down:true,mode:'rotate',rectId:id,cx,cy,startAngle,origRot:rect.rotation||0};
  e.preventDefault();
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG REFRESH
// ─────────────────────────────────────────────────────────────────────────────

function _pvRefreshSVG(){
  const {pid,facade,floor}=_pvState;
  const shapes=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects)||[];
  const svg=document.getElementById('pv-svg'); if(!svg) return;
  const ghost=document.getElementById('pv-ghost');
  svg.querySelectorAll('.pv-rg').forEach(g=>g.remove());
  shapes.forEach(r=>{
    const tmp=document.createElementNS('http://www.w3.org/2000/svg','svg');
    tmp.innerHTML=(r.type==='poly')?_pvPolySVG(r,pid,facade):_pvRectSVG(r,pid,facade);
    const grp=tmp.querySelector('.pv-rg');
    if(grp) svg.insertBefore(grp,ghost);
  });
  _pvFitLabels();
}

function _pvFitLabels(){
  const svg=document.getElementById('pv-svg'); if(!svg) return;
  svg.querySelectorAll('.pv-rg:not(.pv-poly-rg)').forEach(g=>{
    const r=g.querySelector('rect');
    const t=g.querySelector('text');
    if(!r||!t) return;
    const rb=r.getBoundingClientRect();
    const rw=rb.width, rh=rb.height;
    if(rw<=0||rh<=0) return;
    const isTitle=g.classList.contains('pv-title-rg');
    if(isTitle){
      let fs=Math.max(6, Math.min(rw*0.18, rh*0.18));
      t.style.fontSize=fs+'px';
      const tspans=t.querySelectorAll('tspan');
      let i=0;
      while(fs>5&&i<15){
        let overflow=false;
        tspans.forEach(ts=>{if(typeof ts.getComputedTextLength==='function'&&ts.getComputedTextLength()>rw*0.88) overflow=true;});
        if(!overflow) break;
        fs-=1; t.style.fontSize=fs+'px'; i++;
      }
    } else {
      const isPortrait=g.classList.contains('pv-portrait');
      const run=isPortrait?rh:rw;
      const cap=isPortrait?rw:rh;
      const MIN_FS=1;
      let fs=Math.max(MIN_FS, Math.min(run*0.3, cap*0.6));
      t.style.fontSize=fs+'px';
      let i=0;
      while(typeof t.getComputedTextLength==='function'&&t.getComputedTextLength()>run*0.88&&fs>MIN_FS&&i<20){
        fs=Math.max(MIN_FS,fs-0.5); t.style.fontSize=fs+'px'; i++;
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CELL CLICK HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

function pvRectClick(e,id,cellKey,pid,facade){
  if(_pvState.drawMode) return;
  if(_pvMouse.mode==='drag') return;
  e.stopPropagation();
  const {floor}=_pvState;
  const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id);
  if(!rect||!rect.cellKey) return;

  const m=rect.cellKey.match(/^r(\d+)_c(\d+)$/); if(!m) return;
  const ri=parseInt(m[1]),ci=parseInt(m[2]);
  const cacheEntry=(_custFacadeCache[`${pid}|${facade}`]||{})[rect.cellKey]||{};
  const curSt=cacheEntry.status||'pending';

  _custCurPid=pid; _custCurFacade=facade; _custCurCellKey=rect.cellKey;

  const meta=_custGetMeta(pid,facade);
  const rLbl=meta.rows[ri]?.label||String(ri+1);
  const cLbl=meta.cols[ci]?.label||String(ci+1);
  const _cats=getProjectCategories(pid);
  const _cpFM=(window._currentCustomPage||'').match(/^c(\d+)-([A-Z]+)$/);
  let catNick='CAT1',facNick=facade;
  if(_cpFM){const cn=parseInt(_cpFM[1]);const cd=_cpFM[2];const cat=_cats.find(x=>x.num===cn);catNick=cat?.nick||'CAT'+cn;facNick=cat?.facadeNicks?.[cd]||cd+cn;}
  _custCurCellRef=`${catNick}-${facNick}-${rLbl}-${cLbl}`;

  openCustStatusModal(false,curSt,cacheEntry);
}

function pvPolyClick(e,id,pid,facade){
  if(_pvState.drawMode) return;
  if(_pvMouse.mode==='drag-poly'||_pvMouse.mode==='drag-poly-vertex') return;
  e.stopPropagation();
  _pvState.selectedId=(_pvState.selectedId===id)?null:id;
  _pvRefreshSVG();
}

async function pvRectRC(e,id,cellKey,pid,facade){
  e.preventDefault(); e.stopPropagation();
  const {floor}=_pvState;
  const rect=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id);
  if(!rect||!rect.cellKey) return;
  const m=rect.cellKey.match(/^r(\d+)_c(\d+)$/); if(!m) return;
  const ri=parseInt(m[1]),ci=parseInt(m[2]);
  const meta=_custGetMeta(pid,facade);
  const rLbl=meta.rows[ri]?.label||String(ri+1);
  const cLbl=meta.cols[ci]?.label||String(ci+1);
  const _cats=getProjectCategories(pid);
  const _cpFM=(window._currentCustomPage||'').match(/^c(\d+)-([A-Z]+)$/);
  let catNick='CAT1',facNick=facade;
  if(_cpFM){const cn=parseInt(_cpFM[1]);const cd=_cpFM[2];const cat=_cats.find(x=>x.num===cn);catNick=cat?.nick||'CAT'+cn;facNick=cat?.facadeNicks?.[cd]||cd+cn;}
  const cellRef=`${catNick}-${facNick}-${rLbl}-${cLbl}`;
  await custCellOpenPanel(e,pid,facade,rect.cellKey,cellRef);
}

async function pvPolyRC(e,id,pid,facade){
  e.preventDefault(); e.stopPropagation();
  const {floor}=_pvState;
  const poly=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===id);
  if(!poly||!poly.cellKey) return;
  const m=poly.cellKey.match(/^r(\d+)_c(\d+)$/); if(!m) return;
  const ri=parseInt(m[1]),ci=parseInt(m[2]);
  const meta=_custGetMeta(pid,facade);
  const rLbl=meta.rows[ri]?.label||String(ri+1);
  const cLbl=meta.cols[ci]?.label||String(ci+1);
  const _cats=getProjectCategories(pid);
  const _cpFM=(window._currentCustomPage||'').match(/^c(\d+)-([A-Z]+)$/);
  let catNick='CAT1',facNick=facade;
  if(_cpFM){const cn=parseInt(_cpFM[1]);const cd=_cpFM[2];const cat=_cats.find(x=>x.num===cn);catNick=cat?.nick||'CAT'+cn;facNick=cat?.facadeNicks?.[cd]||cd+cn;}
  const cellRef=`${catNick}-${facNick}-${rLbl}-${cLbl}`;
  await custCellOpenPanel(e,pid,facade,poly.cellKey,cellRef);
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS SYNC
// ─────────────────────────────────────────────────────────────────────────────

function pvSyncStatus(){
  const container=document.getElementById('pv-container');
  if(!container||container.style.display==='none') return;
  _pvRefreshSVG();
}

function pvApplyFilter(status){
  const container=document.getElementById('pv-container');
  if(!container||container.style.display==='none') return;
  const {pid,facade}=_pvState;
  const cells=_custFacadeCache[`${pid}|${facade}`]||{};
  document.querySelectorAll('#pv-svg .pv-rg').forEach(g=>{
    const id=g.dataset.id;
    const {floor}=_pvState;
    const layout=_pvLayouts[`${pid}|${facade}`]||{};
    const rect=(layout[floor]?.rects||[]).find(r=>r.id===id);
    if(!rect||!rect.cellKey){g.style.opacity='';return;}
    const st=cells[rect.cellKey]?.status||'pending';
    if(status==='all'||st===status){g.style.opacity='';}
    else{g.style.opacity='0.12';}
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// FLOOR SELECTION
// ─────────────────────────────────────────────────────────────────────────────

async function pvSelectFloor(floor){
  const {pid,facade}=_pvState;
  _pvState.floor=floor; _pvState.selectedId=null;
  _pvPolyPoints=[]; _pvUpdatePolyGhost([]);
  await pvLoadBg(pid,facade,floor);
  const meta=_custGetMeta(pid,facade);
  const floors=meta.rows.map(r=>r.label);
  const isDev=_pvIsDev();
  const container=document.getElementById('pv-container');
  if(container) _pvBuild(container,isDev,floors);
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND UPLOAD
// ─────────────────────────────────────────────────────────────────────────────

async function pvUploadBg(input){
  const file=input.files[0]; if(!file) return;
  const {pid,facade,floor}=_pvState;
  _pvToast('Processing…');
  if(file.type==='application/pdf'){
    if(typeof pdfjsLib==='undefined'){_pvToast('PDF.js not loaded');return;}
    const buf=await file.arrayBuffer();
    try{
      const pdf=await pdfjsLib.getDocument({data:new Uint8Array(buf)}).promise;
      const page=await pdf.getPage(1);
      const scale=2;
      const vp=page.getViewport({scale});
      const canvas=document.createElement('canvas');
      canvas.width=vp.width; canvas.height=vp.height;
      await page.render({canvasContext:canvas.getContext('2d'),viewport:vp}).promise;
      const dataUrl=canvas.toDataURL('image/jpeg',0.88);
      await pvSaveBg(pid,facade,floor,dataUrl);
      _pvToast('Plan uploaded');
      pvSelectFloor(floor);
    }catch(err){_pvToast('Error processing PDF');console.error(err);}
  } else {
    const reader=new FileReader();
    reader.onload=async ev=>{
      await pvSaveBg(pid,facade,floor,ev.target.result);
      _pvToast('Plan uploaded');
      pvSelectFloor(floor);
    };
    reader.readAsDataURL(file);
  }
  input.value='';
}

// ─────────────────────────────────────────────────────────────────────────────
// DRAW MODE TOGGLE
// ─────────────────────────────────────────────────────────────────────────────

function pvToggleDrawRect(){
  if(_pvState.drawMode==='rect') _pvSetDrawMode(null);
  else { _pvPolyPoints=[]; _pvUpdatePolyGhost([]); _pvSetDrawMode('rect'); }
}

function pvToggleDrawPoly(){
  if(_pvState.drawMode==='poly'){
    _pvPolyPoints=[]; _pvUpdatePolyGhost([]);
    const snap=document.getElementById('pv-snap-dot'); if(snap) snap.setAttribute('r','0');
    _pvSetDrawMode(null);
  } else {
    _pvPolyPoints=[]; _pvSetDrawMode('poly');
  }
}

function _pvSetDrawMode(mode){
  _pvState.drawMode=mode;
  const rb=document.getElementById('pv-draw-rect-btn');
  const pb=document.getElementById('pv-draw-poly-btn');
  const svg=document.getElementById('pv-svg');
  const hint=document.getElementById('pv-hint');
  if(rb){
    const a=mode==='rect';
    rb.style.background=a?'#eef4ff':'var(--surface)';
    rb.style.color=a?'#224F93':'var(--text2)';
    rb.style.borderColor=a?'#224F93':'var(--border)';
  }
  if(pb){
    const a=mode==='poly';
    pb.style.background=a?'#eef4ff':'var(--surface)';
    pb.style.color=a?'#224F93':'var(--text2)';
    pb.style.borderColor=a?'#224F93':'var(--border)';
  }
  if(svg) svg.style.cursor=mode?'crosshair':'';
  if(hint){
    if(mode==='rect') hint.textContent='Click and drag on the plan to draw a rectangle';
    else if(mode==='poly') hint.textContent='Click points one by one — click the first point again to close';
    else hint.textContent='';
  }
}

// Legacy alias kept for backwards compatibility with any other callers
function pvToggleDraw(){ pvToggleDrawRect(); }

// ─────────────────────────────────────────────────────────────────────────────
// POLYLINE FINALIZE
// ─────────────────────────────────────────────────────────────────────────────

function _pvPolyFinalize(points){
  _pvPendingRect={
    id:'poly'+Date.now(),
    type:'poly',
    points,
    label:'',
    namePos:'above',
    cellKey:'',
  };
  _pvPolyNamePos='above';
  _pvEditingRectId=null;
  pvShowLinkModal(null,null,true);
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE SELECTED
// ─────────────────────────────────────────────────────────────────────────────

function pvDeleteSelected(){
  const id=_pvState.selectedId;
  if(!id){_pvToast('Select an element first');return;}
  _pvUndoPush();
  const {pid,facade,floor}=_pvState;
  const layout=_pvLayouts[`${pid}|${facade}`]||{};
  if(layout[floor]?.rects) layout[floor].rects=layout[floor].rects.filter(r=>r.id!==id);
  _pvState.selectedId=null;
  _pvRefreshSVG();
  _pvToast('Element deleted — click Save Layout to persist');
}

// ─────────────────────────────────────────────────────────────────────────────
// LINK / CONFIGURE MODAL
// ─────────────────────────────────────────────────────────────────────────────

function _pvCellRefFromKey(key){
  if(!key) return '';
  const {pid,facade}=_pvState;
  const meta=_custGetMeta(pid,facade);
  const m=key.match(/^r(\d+)_c(\d+)$/);
  if(!m) return key;
  const ri=parseInt(m[1]),ci=parseInt(m[2]);
  const rLbl=meta.rows[ri]?.label||String(ri+1);
  const cLbl=meta.cols[ci]?.label||String(ci+1);
  return `${rLbl}-${cLbl}`;
}

function pvFloorSelectChanged(){
  const {pid,facade}=_pvState;
  const meta=_custGetMeta(pid,facade);
  const ri=parseInt(document.getElementById('pv-floor-select')?.value);
  const colSel=document.getElementById('pv-col-select');
  if(!colSel||isNaN(ri)) return;
  colSel.innerHTML=meta.cols.map((col,ci)=>`<option value="${ci}">${col.label}</option>`).join('');
  pvColSelectChanged();
}

function pvColSelectChanged(){
  const li=document.getElementById('pv-label-input');
  const key=pvGetSelectedCellKey();
  if(li) li.value=_pvCellRefFromKey(key);
}

function pvGetSelectedCellKey(){
  const ri=document.getElementById('pv-floor-select')?.value;
  const ci=document.getElementById('pv-col-select')?.value;
  if(ri===undefined||ri===null||ci===undefined||ci===null) return '';
  return `r${ri}_c${ci}`;
}

function pvSetNamePos(pos){
  _pvPolyNamePos=pos;
  const ab=document.getElementById('pv-np-above');
  const ins=document.getElementById('pv-np-inside');
  if(ab){ab.style.background=pos==='above'?'#224F93':'#f0f4f9';ab.style.color=pos==='above'?'#fff':'#1a2a3a';}
  if(ins){ins.style.background=pos==='inside'?'#224F93':'#f0f4f9';ins.style.color=pos==='inside'?'#fff':'#1a2a3a';}
}

function pvShowLinkModal(selectedKey, label, isPoly){
  const {pid,facade,floor}=_pvState;
  const meta=_custGetMeta(pid,facade);

  let selRi=0, selCi=0;
  if(selectedKey){
    const m=selectedKey.match(/^r(\d+)_c(\d+)$/);
    if(m){selRi=parseInt(m[1]);selCi=parseInt(m[2]);}
  } else {
    // Default floor to current floor being viewed
    const floorIdx=meta.rows.findIndex(row=>row.label===floor);
    if(floorIdx>=0) selRi=floorIdx;
    // Default col to next after last linked shape on this floor
    const rects=(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]);
    const linkedRects=rects.filter(r=>r.cellKey);
    if(linkedRects.length){
      const lastKey=linkedRects[linkedRects.length-1].cellKey;
      const lm=lastKey.match(/^r(\d+)_c(\d+)$/);
      if(lm) selCi=Math.min(parseInt(lm[2])+1, meta.cols.length-1);
    }
  }

  const floorSel=document.getElementById('pv-floor-select');
  if(floorSel){
    floorSel.innerHTML=meta.rows.map((row,ri)=>`<option value="${ri}"${ri===selRi?' selected':''}>${row.label}</option>`).join('');
  }
  const colSel=document.getElementById('pv-col-select');
  if(colSel){
    colSel.innerHTML=meta.cols.map((col,ci)=>`<option value="${ci}"${ci===selCi?' selected':''}>${col.label}</option>`).join('');
  }
  const li=document.getElementById('pv-label-input');
  if(li) li.value=label||_pvCellRefFromKey(selectedKey)||_pvCellRefFromKey(pvGetSelectedCellKey())||'';

  // Modal title
  const mt=document.getElementById('pv-modal-title');
  if(mt) mt.textContent=isPoly?'Configure Polyline':'Link Element to Cell';

  // Name position row (poly only)
  const npRow=document.getElementById('pv-namepos-row');
  if(npRow) npRow.style.display=isPoly?'':'none';
  if(isPoly) pvSetNamePos(_pvPolyNamePos);

  // Cell link hint
  const clHint=document.getElementById('pv-cell-optional-hint');
  if(clHint) clHint.style.display=isPoly?'':'none';

  const m=document.getElementById('pv-link-modal');
  if(m) m.style.display='flex';
}

function pvLinkSave(){
  const cellKey=pvGetSelectedCellKey();
  const label=(document.getElementById('pv-label-input')?.value||'').trim();
  const {pid,facade,floor}=_pvState;

  const isPoly=_pvPendingRect?.type==='poly'||
    (_pvEditingRectId&&(_pvLayouts[`${pid}|${facade}`]?.[floor]?.rects||[]).find(r=>r.id===_pvEditingRectId)?.type==='poly');

  if(!cellKey&&!isPoly){pvLinkCancel();return;}

  _pvUndoPush();
  if(!_pvLayouts[`${pid}|${facade}`]) _pvLayouts[`${pid}|${facade}`]={};
  if(!_pvLayouts[`${pid}|${facade}`][floor]) _pvLayouts[`${pid}|${facade}`][floor]={rects:[]};
  const rects=_pvLayouts[`${pid}|${facade}`][floor].rects;

  if(_pvEditingRectId){
    const existing=rects.find(r=>r.id===_pvEditingRectId);
    if(existing){
      existing.cellKey=cellKey||'';
      existing.label=label||(cellKey?_pvCellRefFromKey(cellKey):'');
      if(existing.type==='poly') existing.namePos=_pvPolyNamePos;
    }
  } else if(_pvPendingRect){
    const rec={..._pvPendingRect,cellKey:cellKey||'',label:label||(cellKey?_pvCellRefFromKey(cellKey):_pvPendingRect.label||'')};
    if(isPoly) rec.namePos=_pvPolyNamePos;
    rects.push(rec);
  }
  _pvPendingRect=null; _pvEditingRectId=null;
  pvLinkCancel();
  _pvRefreshSVG();
}

function pvLinkCancel(){
  const m=document.getElementById('pv-link-modal');
  if(m) m.style.display='none';
  _pvPendingRect=null;
}

function _pvLinkModalHTML(){
  const btnBase='padding:8px 0;flex:1;border-radius:7px;font-family:\'Barlow\',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border:1px solid rgba(34,79,147,0.2);';
  return `
    <div id="pv-link-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:15000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:12px;padding:24px 24px 20px;width:380px;box-shadow:0 8px 32px rgba(34,79,147,0.2);font-family:'Barlow',sans-serif;">
        <div id="pv-modal-title" style="font-size:14px;font-weight:700;color:#1a2a3a;margin-bottom:18px;">Link Element to Cell</div>

        <div id="pv-namepos-row" style="display:none;margin-bottom:16px;">
          <label style="display:block;font-size:10px;font-weight:700;color:#8099b0;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:7px;">Label Position</label>
          <div style="display:flex;gap:8px;">
            <button id="pv-np-above" onclick="pvSetNamePos('above')"
              style="${btnBase}background:#224F93;color:#fff;">Above</button>
            <button id="pv-np-inside" onclick="pvSetNamePos('inside')"
              style="${btnBase}background:#f0f4f9;color:#1a2a3a;">Inside</button>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-bottom:14px;">
          <div style="flex:1;">
            <label style="display:block;font-size:10px;font-weight:700;color:#8099b0;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px;">Floor</label>
            <select id="pv-floor-select" onchange="pvFloorSelectChanged()" style="width:100%;padding:8px 10px;border:1px solid rgba(34,79,147,0.2);border-radius:7px;font-family:'Barlow',sans-serif;font-size:12px;color:#1a2a3a;outline:none;"></select>
          </div>
          <div style="flex:1;">
            <label style="display:block;font-size:10px;font-weight:700;color:#8099b0;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px;">Column</label>
            <select id="pv-col-select" onchange="pvColSelectChanged()" style="width:100%;padding:8px 10px;border:1px solid rgba(34,79,147,0.2);border-radius:7px;font-family:'Barlow',sans-serif;font-size:12px;color:#1a2a3a;outline:none;"></select>
          </div>
        </div>
        <span id="pv-cell-optional-hint" style="display:none;font-size:10px;color:#8099b0;font-style:italic;margin-bottom:10px;display:block;">Cell link is optional for polylines — you can leave a zone unlabeled to a cell.</span>

        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:10px;font-weight:700;color:#8099b0;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px;">Label <span style="font-weight:400;text-transform:none;">(shown on the shape)</span></label>
          <input id="pv-label-input" type="text" placeholder="e.g. Zone A or W-01"
            style="width:100%;padding:8px 10px;border:1px solid rgba(34,79,147,0.2);border-radius:7px;font-family:'Barlow',sans-serif;font-size:12px;color:#1a2a3a;outline:none;box-sizing:border-box;">
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="pvLinkCancel()" style="padding:8px 16px;border:1px solid rgba(34,79,147,0.2);border-radius:7px;background:#f0f4f9;color:#1a2a3a;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
          <button onclick="pvLinkSave()" style="padding:8px 18px;border:none;border-radius:7px;background:#224F93;color:#fff;font-family:'Barlow',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Confirm</button>
        </div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// DUPLICATE FROM MODAL
// ─────────────────────────────────────────────────────────────────────────────

function pvShowDupModal(){
  const m=document.getElementById('pv-dup-modal'); if(m) m.style.display='flex';
}
function pvCloseDupModal(){
  const m=document.getElementById('pv-dup-modal'); if(m) m.style.display='none';
}

function pvDupExecute(){
  const {pid,facade,floor}=_pvState;
  const src=document.getElementById('pv-dup-src')?.value; if(!src) return;
  const layout=_pvLayouts[`${pid}|${facade}`]||{};
  const srcRects=layout[src]?.rects;
  if(!srcRects||!srcRects.length){_pvToast('Source floor has no elements');return;}
  const checks=[...document.querySelectorAll('.pv-dup-tgt:checked')];
  if(!checks.length){_pvToast('Select at least one target floor');return;}
  checks.forEach(cb=>{
    const tf=cb.value; if(tf===src) return;
    if(!layout[tf]) layout[tf]={rects:[]};
    layout[tf].rects=srcRects.map(r=>({...r,id:'r'+Date.now()+Math.random().toString(36).slice(2,6),
      points:r.points?r.points.map(p=>({...p})):undefined}));
  });
  pvCloseDupModal();
  pvSaveLayout(false);
  pvSelectFloor(floor);
}

function _pvDupModalHTML(pid,facade){
  const meta=_custGetMeta(pid,facade);
  const floors=meta.rows.map(r=>r.label);
  const opts=floors.map(f=>`<option value="${f}">${f}</option>`).join('');
  const tgts=floors.map(f=>`
    <label style="display:flex;align-items:center;gap:7px;font-size:12px;color:#1a2a3a;cursor:pointer;padding:3px 0;">
      <input type="checkbox" class="pv-dup-tgt" value="${f}" style="accent-color:#224F93;width:14px;height:14px;"> ${f}
    </label>`).join('');
  return `
    <div id="pv-dup-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:15000;align-items:center;justify-content:center;">
      <div style="background:#fff;border-radius:12px;padding:24px 24px 20px;width:380px;box-shadow:0 8px 32px rgba(34,79,147,0.2);font-family:'Barlow',sans-serif;">
        <div style="font-size:14px;font-weight:700;color:#1a2a3a;margin-bottom:18px;">Duplicate Floor Layout</div>
        <div style="margin-bottom:14px;">
          <label style="display:block;font-size:10px;font-weight:700;color:#8099b0;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:5px;">Copy Layout From</label>
          <select id="pv-dup-src" style="width:100%;padding:8px 10px;border:1px solid rgba(34,79,147,0.2);border-radius:7px;font-family:'Barlow',sans-serif;font-size:12px;color:#1a2a3a;outline:none;">${opts}</select>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-size:10px;font-weight:700;color:#8099b0;text-transform:uppercase;letter-spacing:0.07em;margin-bottom:8px;">Apply To Floors</label>
          <div style="max-height:180px;overflow-y:auto;padding:8px 10px;border:1px solid rgba(34,79,147,0.15);border-radius:7px;background:#fafcff;">${tgts}</div>
          <div style="font-size:10px;color:#8099b0;margin-top:6px;">Only element positions are copied. Each floor keeps its own statuses.</div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button onclick="pvCloseDupModal()" style="padding:8px 16px;border:1px solid rgba(34,79,147,0.2);border-radius:7px;background:#f0f4f9;color:#1a2a3a;font-family:'Barlow',sans-serif;font-size:12px;font-weight:600;cursor:pointer;">Cancel</button>
          <button onclick="pvDupExecute()" style="padding:8px 18px;border:none;border-radius:7px;background:#224F93;color:#fff;font-family:'Barlow',sans-serif;font-size:12px;font-weight:700;cursor:pointer;">Duplicate</button>
        </div>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW TOGGLE
// ─────────────────────────────────────────────────────────────────────────────

let _pvActiveView='facade';

async function pvSwitchView(view){
  _pvActiveView=view;
  const fv=document.getElementById('pv-facade-view');
  const pv=document.getElementById('pv-container');
  const fb=document.getElementById('pv-tab-facade');
  const pb=document.getElementById('pv-tab-plan');
  if(!fv||!pv) return;

  if(view==='plan'){
    fv.style.display='none'; pv.style.display='flex'; pv.style.flexDirection='column';
    if(pb){pb.style.background='#224F93';pb.style.color='#fff';pb.style.borderColor='#224F93';}
    if(fb){fb.style.background='var(--surface)';fb.style.color='var(--text2)';fb.style.borderColor='var(--border)';}
    const {pid,facade}=_pvState;
    if(pid&&facade) await renderPlanView(pid,facade,pv);
  } else {
    pv.style.display='none'; fv.style.display='flex'; fv.style.flexDirection='column';
    if(fb){fb.style.background='#224F93';fb.style.color='#fff';fb.style.borderColor='#224F93';}
    if(pb){pb.style.background='var(--surface)';pb.style.color='var(--text2)';pb.style.borderColor='var(--border)';}
    const mr=document.getElementById('pv-modals-root'); if(mr) mr.remove();
  }
}
