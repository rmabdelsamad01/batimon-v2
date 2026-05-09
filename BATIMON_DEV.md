# BATIMON — Developer Reference

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
<rect x="1" y="1" width="48" height="98" fill="none" stroke="#2a3a52" stroke-width="3.5"/>          <!-- outer frame -->
<rect x="1" y="75" width="48" height="24" fill="rgba(0,0,0,0.18)"/>                                   <!-- bottom transom rail (25px) -->
<rect x="1" y="75" width="48" height="24" fill="none" stroke="#2a3a52" stroke-width="1.5"/>
<line x1="3" y1="77" x2="47" y2="77" stroke="#2a3a52" stroke-width="0.8" opacity="0.35"/>             <!-- rail inner line -->
<rect x="6" y="8" width="38" height="62" fill="none" stroke="#2a3a52" stroke-width="2.5"/>            <!-- sash frame -->
<rect x="7.5" y="9.5" width="35" height="59" fill="rgba(255,255,255,0.35)"/>                          <!-- glass -->
<line x1="42.5" y1="9.5" x2="7.5" y2="39" stroke="#2a3a52" stroke-width="1.1" opacity="0.6"/>        <!-- opening diagonal 1 (hinge left → opens right) -->
<line x1="42.5" y1="68.5" x2="7.5" y2="39" stroke="#2a3a52" stroke-width="1.1" opacity="0.6"/>       <!-- opening diagonal 2 -->
<!-- W01 label: absolute bottom 25px of cell, centered, 13px bold -->
```

---

*Last updated: May 2026*
