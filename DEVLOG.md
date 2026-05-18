# BATIMON — Developer Reference & Change Log

> Façade monitoring SPA for Shift Tower. Single-page app, no framework, no build step.  
> Deploy: drag-and-drop the `batimon/` folder to Netlify.

---

## 1. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML + CSS + JavaScript (no framework) |
| Backend / DB | Supabase (Postgres + Realtime) |
| Auth | Supabase Auth |
| Hosting | Netlify (drag-and-drop deploy) |
| PWA | Service Worker (`sw.js`) + Web App Manifest (`manifest.json`) |
| Fonts | Google Fonts — Barlow + DM Mono |

---

## 2. File Structure

```
batimon/
├── index.html          ← Single HTML shell — all modals, auth screen, root div
├── app.js              ← All application logic (~10,000+ lines)
├── styles.css          ← All styles
├── auth.js             ← Supabase auth flow (login/logout/session)
├── config.js           ← Supabase URL + anon key
├── profile.js          ← User profile helpers
├── project.js          ← Project info page logic
├── bulk-admin.js       ← Bulk status update admin tools
├── ncr.js              ← NCR (Non-Conformance Report) logic
├── sw.js               ← Service Worker (PWA offline cache)
├── manifest.json       ← PWA manifest
├── icon.svg            ← App icon
├── logo.png            ← BATIMON logo
└── shift-tower-bg.jpg  ← Welcome page background image
```

---

## 3. Routing Architecture

Hash-based client-side routing. No page reloads — everything is a DOM swap.

```javascript
// Core pattern
function goPage(id) {
  if (location.hash === '#' + id) _renderPage(id);
  else location.hash = '#' + id;
}
window.addEventListener('hashchange', router);

// On load
(async () => { await load(); updateTabs(); router(); startRealtimeSync(); })();
```

**`#root`** in `index.html` has `display:contents` (layout-transparent wrapper).  
Each page call wipes `root.innerHTML` and renders fresh content.

### Page IDs (routes)

| Hash | Page |
|---|---|
| `#welcome` | Welcome / landing |
| `#dashboard` | Project overview dashboard |
| `#NF` / `#SF` / `#EF` / `#WF` | UCW facade tables |
| `#BM-NF` / `#BM-SF` / `#BM-EF` / `#BM-WF` | Bracket Monitoring grids |
| `#cadence` | Cadence rates modal launcher |
| `#proj-financial` | Financial info |
| `#planning` | Planning |
| `#batidoc` | BatiDoc iframe |
| `#logs` | Issue logs |
| `#qc` | Quality Control |

---

## 4. Data Model

### Panel Object

```javascript
panels[id] = {
  status: 'pending',        // see Status Values below
  fabDate: '',              // ISO date string e.g. '2026-03-15'
  installDate: '',          // ISO date string
  installRef: '',           // Installation reference text
  deliveryDate: '',         // ISO date string
  notes: '',                // (legacy, kept for DB compat)
  assigned: '',             // (legacy, kept for DB compat)
  ref: '',                  // panel ref code e.g. 'T01'
  type: '',                 // panel type
}
```

### Panel ID Format

```
{ZONE}-{FLOOR}-{COL}          UCW panels     e.g. WF-R34-31
BM-{ZONE}-{FLOOR}-{COL}       Bracket panels e.g. BM-WF-R34-31
```

Floor `+` is stripped: `R+34` → `R34` in IDs.

### Status Values

| Status key | Label | Color |
|---|---|---|
| `pending` | Pending | Blue tint `#E8F0FB` |
| `cl_not_issued` | CL Not Issued | Pink `#FFB3B3` |
| `cip` | CL in Progress | Purple `#A349A4` |
| `cutting` | CL Issued | Lavender `#C98BCA` |
| `fabricated` | Fabricated | Blue `#002DFF` |
| `delivered` | Delivered | Yellow `#FFF000` |
| `installed` | Installed | Green `#00FF32` |
| `defect` | Defect | Red `#ED1C24` |

---

## 5. Zones & Data Structure

### UCW Zones

| Zone ID | Name | Cols | Floors | Renderer |
|---|---|---|---|---|
| `NF` | North Facade | 45 cols | 39 floors | `buildComplexTable` |
| `SF` | South Facade | 35 cols | 39 floors | `buildComplexTable` |
| `EF` | East Facade | ~60 cols | 39 floors | `buildComplexTable` |
| `WF` | West Facade | 18 cols | 39 floors | `buildComplexTable` |

Defined in `ZONES` array (~line 235):
```javascript
{id:'WF', name:'West Facade', cols:WF_COLS.length, rows:WF_FLOORS.length,
 color:'#6d35d9', simple:false, floors:WF_FLOORS, colNums:WF_COLS,
 types:WF_TYPES, refs:WF_REFS}
```

Simple zones (no complex cell types) use `renderSimpleGrid`.

### Bracket Monitoring Zones

| Zone | IDs Prefix | Cols structure |
|---|---|---|
| `BM-NF` | `BM-NF-` | Left wing 65a→54, Right wing 41→31 |
| `BM-SF` | `BM-SF-` | Left wing 15a→4, Right wing 93→81 |
| `BM-EF` | `BM-EF-` | Single wing 81a→65C |
| `BM-WF` | `BM-WF-` | Single wing 31a→15 |

---

## 6. Key Functions

### Table Rendering

```javascript
renderComplexFP(zone)      // Builds page shell + calls buildComplexTable
buildComplexTable(zone)    // Renders thead + tbody for complex zones (NF/SF/EF/WF)
renderSimpleGrid(zone)     // Renders grid for simple zones
renderSimpleFP(zone)       // Builds page shell + calls renderSimpleGrid
```

### Panel Modal

```javascript
openComplexModal(id, fl, col, ref, type, zone)   // Opens status modal for UCW panel
openSimpleModal(id, row, col, zoneId)            // Opens status modal for simple zones
setSt(s, el)               // Status button click — shows/hides date fields
savePanel()                // Reads modal, saves to panels{}, triggers cloud sync
```

### Status Modal Fields Logic

- `installed` → shows `m-install-date-wrap` + `m-install-ref-wrap`
- `fabricated` → shows `m-fab-date-wrap`
- `delivered` → shows `m-del-date-wrap`

### Filtering

```javascript
fFilters[zoneId]           // Per-zone filter state ('all' | status key)
setFF(zid, f, el)          // Sets filter + re-renders table
```

Filter implementation in `buildComplexTable` — two checks:
1. **Early check** (~line 3502) — catches all special-case cell renderers (orange R+18/R+17, split cells, etc.)
2. **Late check** (~line 4553) — catches standard cells

Hidden cells use: `wfc-empty wfc-filtered` → `background:transparent; border:transparent`

### Cloud Sync

```javascript
_doCloudSync()             // Upserts all panels to Supabase 'panels' table
startRealtimeSync()        // Subscribes to Supabase Realtime for live updates
```

Supabase columns: `id, status, notes, assigned, panel_ref, panel_type, fab_date, install_date, install_ref, delivery_date, updated_at`

### Counts

```javascript
gC()                       // Returns global status counts object
gcActiveTotal              // = installed + delivered + fabricated + cutting + cip + cl_not_issued + defect
                           // (excludes pending) — matches dashboard "Total" card
```

---

## 7. CSS Conventions

### Key Classes

| Class | Purpose |
|---|---|
| `.fpw` | Full-page wrapper (flex row: sidebar + main) |
| `.fpm` | Facade page main (flex column: toolbar + scroll area) |
| `.gw` | Scrollable content area (`overflow:auto`) |
| `.wf-wrap` | Table zoom wrapper |
| `.wft` | Facade table |
| `.thc` | Corner "Floor" header cell |
| `.thh` | Column number header cells |
| `.tdf` | Floor label cells (left column) |
| `.tdc` | Data cells |
| `.wfc` | Panel cell |
| `.wfc-empty` | Empty/placeholder cell |
| `.wfc-filtered` | Hidden filtered cell (transparent) |
| `.tb` | Toolbar / filter bar |
| `.fb` | Filter button |
| `.fb.af` | Active filter button |
| `.sb` | Sidebar |
| `.mbk` | Modal backdrop |
| `.mbk.open` | Open modal |

### Status Cell Classes

`.st-i` (installed) · `.st-d` (delivered) · `.st-f` (fabricated)  
`.st-c` (cutting/CL issued) · `.st-cip` (CL in progress) · `.st-cn` (CL not issued)  
`.st-x` (defect) · `.st-p` (pending)

### CSS Variables

```css
--blue: #224F93
--blue-lt: #2d65bd
--blue-dim: #1a3d72
--text: #1a2a3a
--text2: #4a6080
--text3: #8099b0
--border: rgba(34,79,147,0.15)
--border2: rgba(34,79,147,0.3)
--surface: #fff
--surface2: #f4f8fd
--surface3: #e8f0fa
--font: 'Barlow', sans-serif
--mono: 'DM Mono', monospace
--cw: 50px     /* cell width */
--ch: 100px    /* cell height (150px for NF/SF/EF/WF) */
```

---

## 8. Freeze Pane Implementation

### UCW Tables (NF / SF / EF / WF)

CSS sticky on table cells. Works because zoom uses CSS `zoom` property (not `transform:scale` which breaks sticky).

```css
/* In styles.css */
#gw-WF, #gw-EF, #gw-NF, #gw-SF { padding-top:0; padding-left:0; }
#tbl-WF thead th, ... { position:sticky; top:0; z-index:30; background:var(--surface); }
#tbl-WF .tdf, ...     { position:sticky; left:0; z-index:25; background:#fff; }
#tbl-WF thead th.thc, ... { left:0; z-index:35; background:var(--surface); }
```

**IMPORTANT:** Zoom functions use CSS `zoom` not `transform:scale`:
```javascript
function applyWFZoom() {
  wrap.style.zoom = z;
  wrap.style.transform = '';  // must clear transform
}
```
If you ever switch back to `transform:scale`, sticky freeze pane will break.

### Bracket Monitoring (BM pages)

Div-based flex layout — sticky applied via inline styles on label divs:
- Floor label div: `position:sticky; left:0; z-index:25; background:var(--surface); border-right:2px solid var(--border2)`
- Header row: `position:sticky; top:0; z-index:30`
- Corner cell: `position:sticky; left:0; z-index:35`
- Scroll containers have `padding:0 20px 10px 0` (no top/left padding for 0px gap)

---

## 9. Zoom System

Each facade has independent zoom levels and index:

```javascript
const WF_ZOOM_LEVELS = [0.25, 0.35, 0.5, 0.65, 0.8, 1, 1.25, 1.5, 2];
let wfZoomIdx = 5; // default = 1x (index 5)
```

Print functions temporarily set `zoom:1` to measure natural dimensions:
```javascript
const origZoom = wrap.style.zoom;
wrap.style.zoom = 1;
const tableW = wrap.scrollWidth; // natural size
wrap.style.zoom = origZoom;      // restore
```

---

## 10. Body Layout Lock

```css
body { height:100vh; overflow:hidden; display:flex; flex-direction:column; }
```

**Critical:** Must be `height:100vh` (not `min-height:100vh`). If changed to `min-height`, the whole page scrolls instead of the `.gw` containers scrolling internally. The flex chain is:

```
body (height:100vh, overflow:hidden)
  header (80px, flex-shrink:0)
  .nav-tabs (40px, flex-shrink:0)
  #root (display:contents — transparent)
    .page.active (flex:1, overflow:hidden)
      .fpw (flex:1, overflow:hidden)
        sidebar
        .fpm (flex:1, overflow:hidden)
          .tb (filter bar, flex-shrink:0)
          .gw (flex:1, overflow:auto) ← THE SCROLL CONTAINER
```

---

## 11. Cache Busting

Versioned query strings on JS and CSS files in `index.html`:
```html
<link rel="stylesheet" href="styles.css?v=20260502a">
<script src="app.js?v=20260502a"></script>
```

**Convention used:** `YYYYMMDD` + letter suffix (a, b, c…)  
After any change to `app.js` or `styles.css`, bump the version letter in `index.html`.

---

## 12. Mobile App

Shown only to users with `role === 'phone_only'`. Entirely separate UI inside `#mobile-screen`.

### State
```javascript
window._mobTab    // 'brackets' | 'ucw'
window._mobFacade // 'overview' | 'NF' | 'SF' | 'EF' | 'WF' | 'BM-NF' etc.
window._mobFilter // 'all' | status key
```

### Key Functions
```javascript
renderMobileApp(prof)       // Entry point — loads data, builds shell
_buildMobileShell(prof)     // Renders bottom tab bar + facade bar containers
_refreshMobileContent()     // Re-renders facade bar + filter bar + grid
_renderMobileFacadeBar()    // Overview + North/South/East/West tabs
_renderMobileOverview()     // Summary cards per facade (when Overview selected)
_renderMobileBMGrid()       // Bracket monitoring grid
_renderMobileUCWGrid()      // UCW panel grid
```

### Bottom Tabs
- **Brackets** — shows BM-NF/SF/EF/WF grids
- **UCW** — shows NF/SF/EF/WF panel grids

### Facade Bar
- **Overview** tab — always first, shows per-facade status count cards
- North / South / East / West — facade-specific grids

---

## 13. Cadence Modals

Three UCW rate modals + one bracket rate modal, opened from the sidebar cadence section:

| Modal ID | Function | Data source |
|---|---|---|
| `frm` | `openFabRateModal()` | `p.fabDate` where `status === 'fabricated'` |
| `drm` | `openDeliveryRateModal()` | `p.deliveryDate` where `status === 'delivered'` |
| `irm` | `openInstallRateModal()` | `p.installDate` where `status === 'installed'` |
| `birm` | `openBracketInstallRateModal()` | BM panel install dates |

Total quantity used in all modals matches dashboard "Total":
```javascript
const _gc = gC();
const total = (_gc.installed||0) + (_gc.delivered||0) + (_gc.fabricated||0)
            + (_gc.cutting||0) + (_gc.cip||0) + (_gc.cl_not_issued||0) + (_gc.defect||0);
```

---

## 14. Supabase Table: `panels`

| Column | Type | Notes |
|---|---|---|
| `id` | text PK | Panel ID e.g. `WF-R34-31` |
| `status` | text | Status key |
| `notes` | text | Legacy field |
| `assigned` | text | Legacy field |
| `panel_ref` | text | e.g. `T01` |
| `panel_type` | text | Panel type |
| `fab_date` | date | Fabrication date |
| `install_date` | date | Installation date |
| `install_ref` | text | Installation reference |
| `delivery_date` | date | Delivery date |
| `updated_at` | timestamptz | Auto-updated |

Realtime subscription: SELECT on all columns above.

---

## 15. Development Checklist

Before deploying any change:

- [ ] Bump version in `index.html` (`styles.css?v=...` and/or `app.js?v=...`)
- [ ] Test in browser with hard refresh (`Ctrl+Shift+R`)
- [ ] Check filter behavior on the changed facade
- [ ] Verify no `#REF!` / console errors
- [ ] Drag-and-drop full `batimon/` folder to Netlify

### Common Pitfalls

| Pitfall | Fix |
|---|---|
| Freeze pane stops working after zoom | Never use `transform:scale` — use CSS `zoom` only |
| Whole page scrolls instead of table | `body` must be `height:100vh` not `min-height:100vh` |
| Filter not hiding orange R+18/R+17 cells | Early filter check at line ~3502 in `buildComplexTable` |
| Panels visible behind frozen header/column | Sticky elements need `z-index > 20` (panel hover = z-index:10, selected = z-index:20) |
| Cache not clearing after deploy | Bump version suffix in `index.html` |
| `File has been modified since read` error (when editing) | Read the file first before using Edit tool |

---

## 16. Color Coding Reference (Panel Cells)

```
Green  (#00FF32)  → Installed
Yellow (#FFF000)  → Delivered  
Blue   (#002DFF)  → Fabricated
Purple (#A349A4)  → CL in Progress
Lavender (#C98BCA)→ CL Issued
Pink   (#FFB3B3)  → CL Not Issued
Red    (#ED1C24)  → Defect
Blue tint (#E8F0FB) → Pending
Orange (#FF8C00)  → Special structural cells (R+18/R+17 in WF/SF)
```

---

## 17. Window Cell Types (W-types)

Window cells are special 150px-tall panel cells used in WF (and potentially other facades).  
They always have the same two-zone structure:
- **Top 50 px** — dot texture (`radial-gradient` 5×5 px grid, same as T04 top zone)
- **Bottom 100 px** — SVG window drawing

The `pType` value in `WF_TYPES` and the renderer block in `app.js` (search for `if(pType==='W01')`) control which variant is drawn.

### Type Definitions

| Code | Base | Left border | Bottom border | Description |
|------|------|-------------|---------------|-------------|
| **W01** | Window (dots top + SVG window bottom) | — | — | Plain single-leaf hinged window. Hinge on left, opens right. |
| **W02** | W01 | — | `5px double #ED1C24` | W01 + double red horizontal line on the bottom edge |
| **W03** | W01 | `5px double #ED1C24` | — | W01 + double red vertical line on the left edge |
| **W04** | W02 | `5px double #ED1C24` | `5px double #ED1C24` | W02 + double red vertical line on the left (bottom + left borders) |

### Implementation Pattern

Each W-type is rendered by its own `if(pType==='Wxx')` block inserted **before** the standard EF/WF/SF/NF rendering.  
The block must:
1. Set `cell.style.cssText` with `position:relative; overflow:hidden; display:flex; flex-direction:column; align-items:stretch`
2. Append a `<div>` for the dot-texture top (50 px, `flex-shrink:0`)
3. Append a `<div>` for the SVG window area (bottom, `flex:1`, `position:relative`)
4. Apply border overrides (`border-left`, `border-bottom`) directly on the outer `cell` element
5. End with `td.appendChild(cell); tr.appendChild(td); return;`

Border color is always `#ED1C24` (same red used throughout the app for structural lines).  
Border style is always `5px double`.

### SVG Window Drawing (shared across all W-types)

```svg
<!-- viewBox="0 0 50 100" preserveAspectRatio="none" width:100% height:100% -->
<rect x="1" y="1" width="48" height="98" fill="none" stroke="#2a3a52" stroke-width="3.5"/>
<rect x="1" y="75" width="48" height="24" fill="rgba(0,0,0,0.18)"/>
<rect x="1" y="75" width="48" height="24" fill="none" stroke="#2a3a52" stroke-width="1.5"/>
<line x1="3" y1="77" x2="47" y2="77" stroke="#2a3a52" stroke-width="0.8" opacity="0.35"/>
<rect x="6" y="8" width="38" height="62" fill="none" stroke="#2a3a52" stroke-width="2.5"/>
<rect x="7.5" y="9.5" width="35" height="59" fill="rgba(255,255,255,0.35)"/>
<line x1="42.5" y1="9.5" x2="7.5" y2="39" stroke="#2a3a52" stroke-width="1.1" opacity="0.6"/>
<line x1="42.5" y1="68.5" x2="7.5" y2="39" stroke="#2a3a52" stroke-width="1.1" opacity="0.6"/>
```

---

---

# Change Log

> All entries are technical changes only. Append a new dated section at the end of each work session.

---

## Session — May 2026 | 3D Facade Box Overview (`renderAAAPage`)

### 1. Revert — Restored clean baseline

All changes from the previous session (which caused incorrect JOINT/black columns and a red-screen bug) were fully reverted:

- `_renderPage` `aaa` branch: reverted to `renderAAAPage()` only (removed `setTimeout(_refreshAAAColors,100)`)
- `_reRenderCurrentPage`: removed the `curPage==='aaa'` branch
- `_refreshAAAColors` function: removed entirely
- `faceGrid` cell loop: removed `data-pid` attributes, reverted `statClr` back to `sb`, restored `!type` branch to plain `background:${JOINT}`
- Cell output line: reverted to `<div style="${s}"></div>`

---

### 2. R+01 Row Height — East & South Facades (cols 81–99)

**Request:** Enlarge R+01 to normal cell height in the East and South facades (columns 81–99).

**Root cause:** `TABLE_ROW_H['R+01'] = 25` (table px) → only **4 px** in 3D, making it barely visible.

**Fix:** Removed `'R+01': 25` from `TABLE_ROW_H`.

> R+01 now falls back to `BASE_H = 150` → **21 px** in 3D (same as any normal floor), consistent across all four faces so the 3D box geometry stays intact.

---

### 3. R+01 Row Height — Split (cols 54–78 small, cols 79–99 normal)

**Request:** Keep cols 54–78 at the small R+01 height; cols 79–99 stay normal.

**Technical constraint:** CSS Grid applies one row height to all columns in a row. Partial heights require splitting the face into two side-by-side sub-grids.

#### `faceGrid` signature
```js
function faceGrid(zid, cols, floors, types, extraRowH)
```
Added `extraRowH` parameter. Inside the function a local `faceRowPx(fl)` helper checks `extraRowH[fl]` before falling back to the global `rowPx(fl)`. Row heights and total height `h` are now computed from this local helper.

#### Pre-render — NF split (at index 12)
| Sub-grid | Columns | `extraRowH` |
|---|---|---|
| `nfSmCols` | 65 → 54 (12 cols) | `{ 'R+01': 25 }` — small R+01 |
| `nfNmCols` | 53 → 31 (21 cols) | none — normal R+01 |

Both sub-grids are placed inside a `display:flex` wrapper div (`width:nfW, height:fH, background:JOINT`). The JOINT background fills the 17 px gap at the bottom of the shorter sub-grid.

#### Pre-render — EF split (at index 3)
| Sub-grid | Columns | `extraRowH` |
|---|---|---|
| `efNmCols` | 81, 80, 79 (3 cols) | none — normal R+01 |
| `efSmCols` | 78 → 65 (14 cols) | `{ 'R+01': 25 }` — small R+01 |

SF and WF: no split needed (all SF cols 81–99 are normal; WF not in scope).

---

### 4. R+02 Row Height — Split (cols 54–99 normal, cols 4–40 small)

**Request:** Enlarge R+02 to normal height for cols 54–99; keep small for cols 4–40.

#### `TABLE_ROW_H`
Removed `'R+02': 50`, so `fH` now uses `BASE_H` (21 px) for R+02. Sections needing the small height pass `extraRowH = { 'R+02': 50 }` → **7 px**.

#### Constants added
```js
const SMALL_R01 = { 'R+01': 25 };
const SMALL_R02 = { 'R+02': 50 };
const SMALL_R01_R02 = { 'R+01': 25, 'R+02': 50 }; // reserved for future use
```

#### Per-face assignment

| Face | Sub-grid | Columns | R+01 | R+02 |
|---|---|---|---|---|
| NF | `nfSmCols` | 65→54 | small | normal |
| NF | `nfNmCols` | 53→31 | normal | **small** |
| SF | `sfSmCols` | 15→1 (15 cols) | normal | **small** |
| SF | `sfNmCols` | 99→81 (18 cols) | normal | normal |
| EF | `efNmCols` | 81→79 | normal | normal |
| EF | `efSmCols` | 78→65 | small | normal |
| WF | all | 31→15 | normal | **small** |

SF is now also split into two sub-grids (split at `sfCols3D` index 15). Types are sliced accordingly for each sub-grid.

---

### 5. Merged Cells — R207/208/209/210 and Door 1/2/3

**Request:** In the 3D, merge R207/R208/R209/R210 and Door 1/2/3 the same way they appear in the monitoring (rowspan spanning R+02 + R+01).

#### Affected columns

| Face | Col | Type | Note |
|---|---|---|---|
| NF | 60 | R210 | merged R+02 + R+01 |
| NF | 59 | Door | Door 1 |
| NF | 58 | R208 | |
| EF | 75 | R207 | |
| EF | 74 | Door | Door 3 |
| EF | 73 | R208 | |
| EF | 71 | R209 | |
| EF | 70 | Door | Door 2 |
| EF | 69 | R208 | |

All of these fall within the `nfSmCols` and `efSmCols` sub-grids.

#### `faceGrid` — 6th parameter `merges`
```js
function faceGrid(zid, cols, floors, types, extraRowH, merges)
```

When `merges` is provided, `faceGrid`:
1. Computes `rowTops` (cumulative y-offsets per floor) and `colLefts` (cumulative x-offsets per column, keyed by column number as string).
2. For each `{ fl1, fl2, mCols }` entry, generates an **absolutely-positioned overlay div** spanning both rows:
   - `height = rowHeights[fi1] + GAP + rowHeights[fi2]` (e.g. 21 + 1 + 4 = **26 px**)
   - `background` = panel status colour from `panels[zid-fl1-Ccol]`
3. Returns a `position:relative` wrapper containing the base grid + overlays (instead of the plain grid div).

The base grid cells at the merged positions still exist in the DOM but are visually covered by the overlays. Status colour updates automatically from the live `panels` object.

#### Call sites
```js
faceGrid('NF', nfSmCols, NF_FLOORS, nfTypSm, SMALL_R01,
  [{ fl1:'R+02', fl2:'R+01', mCols:[60,59,58] }])

faceGrid('EF', efSmCols, EF_FLOORS, efTypSm, SMALL_R01,
  [{ fl1:'R+02', fl2:'R+01', mCols:[75,74,73,71,70,69] }])
```

---

### 6. 3D Rotation — Shift + Left-click (was Right-click)

**Request:** Use **Shift + Left-click drag** to rotate the 3D building instead of right-click drag.

| Before | After |
|---|---|
| `vp.addEventListener('contextmenu', e=>e.preventDefault())` | Removed (right-click no longer used) |
| `mousedown`: any button starts drag | `mousedown`: only `button === 0` (left click); cursor = `grabbing` if `shiftKey`, else `move` |
| `mousemove`: `e.buttons === 2` → orbit | `mousemove`: `e.shiftKey && e.buttons === 1` → orbit |

Pan (left-click drag) behaviour is unchanged.

---

### 7. R+17T — West Facade Visibility Fix

**Root cause:** `STRUCT_FLOORS` contained `'R+17T'`, which forces every cell in that row to render as `STRUCT_CLR = '#1c1000'` (dark structural brown), regardless of whether actual UCW panels exist there. `WF_TYPES['R+17T']` has real panel codes (`C1702`, `R1701`, `R1706`, etc.), so those panels were being hidden.

**Fix:**
```js
// Before
const STRUCT_FLOORS = new Set(['R+18M','R+18MD','R+18B','R+17T']);

// After
const STRUCT_FLOORS = new Set(['R+18M','R+18MD','R+18B']);
```

Facades that have no `R+17T` types (SF, NF, EF) fall back to JOINT colour, which looks the same as the old structural band at this scale.

---

### 8. R+17B — West Facade Visibility Fix

**Root cause:** `WF_TYPES` had no `'R+17B'` entry. All cells fell into the `!type` branch → rendered as JOINT colour (invisible dark).

**Discovery:** The monitoring rendering code (line 4624) contains:
```js
// WF: R+17B ref data is stored in R+17T row
const r17ref = (zone.types['R+17T']||[])[ci] || ...
```

This confirms that WF R+17B uses the **same type codes** as R+17T for each column position.

**Fix:** Added `'R+17B'` to `WF_TYPES` with the same array as `'R+17T'`:
```js
'R+17T': ['C1702','R1701','R1706','R1701','R1703','R1702','R1704','R1702','R1703','R1702','R1701','R1703','R1702','R1706','R1701','R1701','C1701',''],
'R+17B': ['C1702','R1701','R1706','R1701','R1703','R1702','R1704','R1702','R1703','R1702','R1701','R1703','R1702','R1706','R1701','R1701','C1701',''],
```

---

### Summary of `app.js` Locations Modified (May 2026 session)

| Area | Approx. line | What changed |
|---|---|---|
| `WF_TYPES` | ~160 | Added `'R+17B'` row |
| `renderAAAPage` → `TABLE_ROW_H` | ~13580 | Removed `'R+01':25` and `'R+02':50` |
| `renderAAAPage` → `STRUCT_FLOORS` | ~13585 | Removed `'R+17T'` |
| `renderAAAPage` → `faceGrid` signature | ~13626 | Added `extraRowH`, `merges` params |
| `renderAAAPage` → `faceGrid` internals | ~13627 | Local `faceRowPx`, local `h` calculation |
| `renderAAAPage` → `faceGrid` return | ~13759 | Overlay logic for merged cells |
| `renderAAAPage` → pre-render grids | ~13770 | NF/SF/EF split sub-grids; WF with `SMALL_R02` |
| `renderAAAPage` → mouse interaction | ~13870 | Shift+Left-click for orbit; right-click removed |
