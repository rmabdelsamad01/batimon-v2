# Batimon 3D View — Development Session Changelog

## Session Overview

All changes in this session are in `app.js` and affect the **3D Facade Box Overview** (`renderAAAPage`) and its related helpers.

---

## 1. Revert — Restored clean baseline

All changes from the previous session (which caused incorrect JOINT/black columns and a red-screen bug) were fully reverted:

- `_renderPage` `aaa` branch: reverted to `renderAAAPage()` only (removed `setTimeout(_refreshAAAColors,100)`)
- `_reRenderCurrentPage`: removed the `curPage==='aaa'` branch
- `_refreshAAAColors` function: removed entirely
- `faceGrid` cell loop: removed `data-pid` attributes, reverted `statClr` back to `sb`, restored `!type` branch to plain `background:${JOINT}`
- Cell output line: reverted to `<div style="${s}"></div>`

---

## 2. R+01 Row Height — East & South Facades (cols 81–99)

**Request:** Enlarge R+01 to normal cell height in the East and South facades (columns 81–99).

**Root cause:** `TABLE_ROW_H['R+01'] = 25` (table px) → only **4 px** in 3D, making it barely visible.

**Fix:** Removed `'R+01': 25` from `TABLE_ROW_H`.

> R+01 now falls back to `BASE_H = 150` → **21 px** in 3D (same as any normal floor), consistent across all four faces so the 3D box geometry stays intact.

---

## 3. R+01 Row Height — Split (cols 54–78 small, cols 79–99 normal)

**Request:** Keep cols 54–78 at the small R+01 height; cols 79–99 stay normal.

**Technical constraint:** CSS Grid applies one row height to all columns in a row. Partial heights require splitting the face into two side-by-side sub-grids.

### Changes

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

## 4. R+02 Row Height — Split (cols 54–99 normal, cols 4–40 small)

**Request:** Enlarge R+02 to normal height for cols 54–99; keep small for cols 4–40.

### Changes

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

## 5. Merged Cells — R207/208/209/210 and Door 1/2/3

**Request:** In the 3D, merge R207/R208/R209/R210 and Door 1/2/3 the same way they appear in the monitoring (rowspan spanning R+02 + R+01).

### Affected columns

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

### Implementation

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

## 6. 3D Rotation — Shift + Left-click (was Right-click)

**Request:** Use **Shift + Left-click drag** to rotate the 3D building instead of right-click drag.

### Changes in the `renderAAAPage` interaction block

| Before | After |
|---|---|
| `vp.addEventListener('contextmenu', e=>e.preventDefault())` | Removed (right-click no longer used) |
| `mousedown`: any button starts drag | `mousedown`: only `button === 0` (left click); cursor = `grabbing` if `shiftKey`, else `move` |
| `mousemove`: `e.buttons === 2` → orbit | `mousemove`: `e.shiftKey && e.buttons === 1` → orbit |

Pan (left-click drag) behaviour is unchanged.

---

## 7. R+17T — West Facade Visibility Fix

**Request:** "Why is R+17 in the West facade not visible?"

**Root cause:** `STRUCT_FLOORS` contained `'R+17T'`, which forces every cell in that row to render as `STRUCT_CLR = '#1c1000'` (dark structural brown), regardless of whether actual UCW panels exist there. `WF_TYPES['R+17T']` has real panel codes (`C1702`, `R1701`, `R1706`, etc.), so those panels were being hidden.

**Fix:**
```js
// Before
const STRUCT_FLOORS = new Set(['R+18M','R+18MD','R+18B','R+17T']);

// After
const STRUCT_FLOORS = new Set(['R+18M','R+18MD','R+18B']);
// R+17T is NOT structural — WF has real UCW panels there (C1702, R17xx types)
```

Facades that have no `R+17T` types (SF, NF, EF) fall back to JOINT colour, which looks the same as the old structural band at this scale.

---

## 8. R+17B — West Facade Visibility Fix

**Request:** "What about 17B?"

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

## Summary of `app.js` Locations Modified

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
