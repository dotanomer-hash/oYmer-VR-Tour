# VR Map Improvements — Design Spec

**Date:** 2026-05-26
**Baseline commit:** `c10a7b7` (GitHub `main`)
**File touched:** `vr-tour-editor.html` (exported tour HTML generator inside this file)

## Problem

The current VR minimap in the exported tour has five issues:

1. **Small floating minimap is unusable.** It follows the user's head (`updateVRMinimapPosition` is called every frame), so when the user tries to look at it with their eyes, it moves away. The map is also too small to read.
2. **Floor-switching arrows (`◀ ▶` drawn into canvas header) cause problems.** Clicking the left/right half of the header switches floors, but the click target is hard to hit and the gaze system can't target canvas pixels.
3. **VR map GUI doesn't match the editor's flat minimap GUI.** Different node sizes, label styles, colors, and floor-name banner.
4. **Hotspots are too big at start.** `nodeScale = max(1, W/512) * 0.8` produces hotspots noticeably larger than the editor's flat minimap. User wants the VR map's 1x-zoom appearance to match the editor exactly. (The shrink-on-zoom behavior stays — user explicitly wants hotspots to remain proportional to visible area when zoomed in.)
5. **Floor switching freezes everything.** `switchVRMapFloor()` sets `mapImageReady = false`, creates a new `Image()`, waits for async `onload`. During the load, the canvas shows nothing and the animate loop reads stale state.

## Goals

- Replace the head-locked small map with a small icon at a fixed world-space position so gaze can target it.
- Match the VR enlarged map's visual style exactly to the editor's flat minimap.
- Replace canvas-drawn floor arrows with separate 3D button meshes that gaze can target.
- Fix the floor-switch freeze by pre-decoding floor plan images at tour load.
- Adjust hotspot initial scale to match the editor's flat minimap (1x zoom). Keep the existing shrink-on-zoom behavior so hotspots stay proportional to the visible area when zoomed.

## Non-goals

- No hand-tracking / fist gesture (added complexity, controller incompatibility — see brainstorming notes).
- No look-down gesture (icon + gaze already covers it).
- No changes to the desktop/flat minimap (already working).
- No changes to controller interaction model (trigger=click, grip=close still applies).

## Architecture

### Three meshes in the VR map system

| Mesh | Purpose | Visibility |
|------|---------|------------|
| `vrMinimapIcon` | Small bottom-middle activation icon | Visible when map is collapsed and not hidden |
| `vrMinimapMesh` | Large enlarged map plane (existing, repurposed — no longer used in small mode) | Visible when `vrMinimapActive` |
| `vrMinimapFloorPrev` / `vrMinimapFloorNext` | Floor switch buttons (new) | Visible when `vrMinimapActive && floors.length > 1` |
| `vrMinimapCloseBtn` | Close button (new) | Visible when `vrMinimapActive` |

All four are added to `scene` directly, positioned in world space.

### 1. Bottom-middle map icon

**Mesh:** `THREE.PlaneGeometry(0.3, 0.3)` with a `MeshBasicMaterial` whose map is a small canvas texture (`256×256`) drawn once at init with a map-pin glyph styled like editor: black background `rgba(0,0,0,0.8)`, orange border `#ff7a00` lineWidth 8, centered map-pin/compass SVG glyph in orange.

**Position:** Recomputed only at specific moments (not every frame):
- On VR session start
- After `deactivateVRMinimap()`
- After `goToScene()` (current scene change)
- After `vrMinimapHidden` toggles from `true` to `false`

Position formula (recompute = "teleport to current bottom-middle"):
```js
function repositionMapIcon() {
  const xrCam = renderer.xr.getCamera();
  const camPos = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  xrCam.getWorldPosition(camPos);
  xrCam.getWorldDirection(camDir);
  // Project forward direction onto horizontal plane (yaw only — ignore pitch)
  camDir.y = 0; camDir.normalize();
  const right = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();
  // 2m forward, 0.8m down → ~22° below horizon at center
  const ICON_DIST = 2.0, ICON_DROP = 0.8;
  vrMinimapIcon.position.copy(camPos)
    .add(camDir.clone().multiplyScalar(ICON_DIST))
    .add(new THREE.Vector3(0, -ICON_DROP, 0));
  vrMinimapIcon.lookAt(camPos);
}
```

**Activation:**
- Add `vrMinimapIcon` to the gaze raycaster's target list (currently only `vrHotspotGroup.children`). When gaze dwell completes, call `activateVRMinimap()`. Reuse the existing gaze fill ring on the icon for visual feedback.
- Controller trigger handler (`onVRSelect`) also raycasts against `vrMinimapIcon`. If hit, `activateVRMinimap()` instantly.

**Removed:** The old small-mode floating minimap code path. `updateVRMinimapPosition()` is deleted. The small-mode `getSmallPlaneSize()` is deleted. The `vrMinimapMesh` is only ever shown in enlarged mode now.

### 2. Floor switch buttons (3D meshes)

**Meshes:** Two `THREE.PlaneGeometry(0.5, 0.7)` planes, each with a `256×384` canvas texture drawn at init.

**Styling (matches editor's `.minimap-floor-btn`):**
- Background: `rgba(0,0,0,0.8)`
- Border: 4px orange `#ff7a00`, rounded 16px
- Arrow glyph: `◀` or `▶`, large orange `#ff7a00`, centered
- Hover/gaze state: redraw canvas with orange fill `#ff7a00` background, white arrow

**Position:** Recomputed inside `activateVRMinimap()` and any time the enlarged map plane is repositioned. Placed in world-space flanking `vrMinimapMesh`:
```js
// Get the map plane's right vector and place buttons to its left/right
const mapRight = new THREE.Vector3(1, 0, 0).applyQuaternion(vrMinimapMesh.quaternion);
const mapHalfW = (bigW / 2) + 0.4; // gap from map edge
vrMinimapFloorPrev.position.copy(vrMinimapMesh.position)
  .add(mapRight.clone().multiplyScalar(-mapHalfW));
vrMinimapFloorNext.position.copy(vrMinimapMesh.position)
  .add(mapRight.clone().multiplyScalar(mapHalfW));
vrMinimapFloorPrev.quaternion.copy(vrMinimapMesh.quaternion);
vrMinimapFloorNext.quaternion.copy(vrMinimapMesh.quaternion);
```

**Interaction:**
- Add both buttons to gaze raycaster target list when `vrMinimapActive`.
- Gaze dwell: 1.2s (faster than the 1.8s navigation dwell — feels snappy for a toggle).
- Gaze fill animates on the button face (reuse `gazeFillMesh`).
- Trigger click: instant. Reuse `onVRSelect` — if hit, call `switchVRMapFloor(-1)` or `switchVRMapFloor(+1)`.
- 500ms cooldown stays (prevents rapid stacking).

**Visibility:** `mesh.visible = vrMinimapActive && TOUR.floors && TOUR.floors.length > 1`.

### 3. Close button (3D mesh)

**Mesh:** `THREE.CircleGeometry(0.15, 32)` with a `128×128` canvas texture.

**Styling (matches editor's `#minimap-close`):**
- Black bg `rgba(0,0,0,0.8)`, grey border `#666`, white `✕` glyph
- Hover/gaze state: red fill `#c00`, red border, white `✕`

**Position:** Top-right corner of the enlarged map:
```js
const mapUp = new THREE.Vector3(0, 1, 0).applyQuaternion(vrMinimapMesh.quaternion);
vrMinimapCloseBtn.position.copy(vrMinimapMesh.position)
  .add(mapRight.clone().multiplyScalar(bigW / 2 - 0.1))
  .add(mapUp.clone().multiplyScalar(bigH / 2 - 0.1));
vrMinimapCloseBtn.quaternion.copy(vrMinimapMesh.quaternion);
```

**Interaction:**
- Gaze dwell: 1.8s (matches `GAZE_DWELL` — prevents accidental close)
- Trigger: instant
- On activation: `deactivateVRMinimap()`

### 4. GUI matching the editor

Changes inside `drawVRMinimap()`:

| Element | Current (VR) | New (match editor) |
|---------|--------------|---------------------|
| Background dim (when not zoomed) | `rgba(0,0,0,0.25)` | `rgba(0,0,0,0.3)` |
| Border stroke | `rgba(255,122,0,0.5)`, lineWidth 6 | `rgba(255,122,0,0.5)`, lineWidth 6 (unchanged — already matches enlarged editor style) |
| Node scale base | `max(1, W/512) * 0.8` | `max(1, W/220)` (editor's formula) |
| Current node radius | `32 * nodeScale * zoomScale` | `16 * nodeScale * zoomScale` (editor uses 16) |
| Other node radius | `24 * nodeScale * zoomScale` | `12 * nodeScale * zoomScale` (editor uses 12) |
| Nav-dot offset | `r + 12` | `r + 8` (editor: 8) |
| Nav-dot radius | `5 * nodeScale * zoomScale` | `4 * nodeScale * zoomScale` (editor: 4) |
| Hovered label background | `rgba(0,0,0,0.7)` | `rgba(10,10,24,0.85)` (editor) |
| Hovered label border | none | `rgba(0,240,255,0.4)` (editor's hover cyan) |
| Hovered label text color | white | `#00f0ff` cyan (editor) |
| Current label | not drawn | `rgba(255,122,0,0.5)` border, `#ff7a00` text (editor) |
| Header (floor name) | rendered inline in canvas with floor arrows | Rendered as banner only — no arrows in canvas anymore (buttons are 3D meshes). Banner style matches editor's `#minimap-title`: orange `#ff7a00` text on black `rgba(10,10,24,0.85)` rounded background. |

The "abbreviated name inside circle" feature (3-char abbreviation when hovered) is **removed** — the editor doesn't have this, and labels-on-hover already provide the info.

### 5. Hotspot scaling

**Current:**
```js
const nodeScale = Math.max(1, W / 512) * 0.8;
const zoomScale = activeMode && mapZoom > 1 ? 1.2 / mapZoom : 1;
const r = (isCurrent ? 32 : 24) * nodeScale * zoomScale;
```

**New:**
```js
const nodeScale = Math.max(1, W / 220); // match editor flat-minimap base
const zoomScale = activeMode && mapZoom > 1 ? 1.2 / mapZoom : 1; // unchanged
const r = (isCurrent ? 16 : 12) * nodeScale * zoomScale;
```

This gives the editor's exact base size and keeps the existing zoom shrink behavior (user explicitly approved keeping shrink-on-zoom).

### 6. Floor-switch freeze fix

**Root cause:** `switchVRMapFloor()` and `deactivateVRMinimap()` create new `Image()` objects and rely on async `onload` callbacks. During the load:
- `mapImageReady` is `false`
- `drawVRMinimap()` may run and find `minimapFloorImg.complete === false`, drawing the dark fallback
- The animate loop continues running but with stale canvas + texture state
- `vrMinimapMesh.geometry.dispose()` happens before the new `Image` loads, leaving the plane briefly malformed

**Fix:** Pre-decode all floor plan images at tour init.

```js
// Add near start of IIFE, before VR minimap setup
const floorImageCache = {}; // floorId → { img, aspect, w, h }
function preloadFloorImages() {
  if (!TOUR.floors) return;
  for (const f of TOUR.floors) {
    if (!f.floorPlanData) continue;
    const img = new Image();
    img.src = f.floorPlanData;
    floorImageCache[f.id] = { img, aspect: 0.754, w: 2048, h: Math.round(2048 * 0.754) };
    img.onload = function() {
      const aspect = this.naturalHeight / this.naturalWidth;
      let w = Math.min(this.naturalWidth, 4096);
      let h = Math.round(w * aspect);
      if (h > 4096) { h = 4096; w = Math.round(h / aspect); }
      floorImageCache[f.id] = { img: this, aspect, w, h };
    };
  }
}
preloadFloorImages();
```

`switchVRMapFloor()` becomes synchronous:
```js
function switchVRMapFloor(direction) {
  if (!TOUR.floors || TOUR.floors.length <= 1) return;
  if (performance.now() - mapFloorSwitchCooldown < 500) return;
  const sorted = [...TOUR.floors].sort((a, b) => a.level - b.level);
  const curIdx = sorted.findIndex(f => f.id === mapViewFloorId);
  const newIdx = direction > 0 ? Math.min(curIdx + 1, sorted.length - 1) : Math.max(curIdx - 1, 0);
  if (newIdx === curIdx) return;

  mapViewFloorId = sorted[newIdx].id;
  mapZoom = 1.0;
  mapPanX = 0;
  mapPanY = 0;
  mapFloorSwitchCooldown = performance.now();

  const cached = floorImageCache[sorted[newIdx].id];
  if (cached && cached.img.complete && cached.img.naturalWidth) {
    minimapFloorImg = cached.img;
    mapAspect = cached.aspect;
    mapCanvasW = cached.w;
    mapCanvasH = cached.h;
    vrMinimapCanvas.width = mapCanvasW;
    vrMinimapCanvas.height = mapCanvasH;
    // Rebuild enlarged plane geometry with new aspect
    let bigW, bigH;
    if (mapAspect < 1) { bigW = 7; bigH = bigW * mapAspect; }
    else { bigH = 7; bigW = bigH / mapAspect; }
    vrMinimapMesh.geometry.dispose();
    vrMinimapMesh.geometry = new THREE.PlaneGeometry(bigW, bigH);
    repositionFloorButtons();
    repositionCloseButton();
    mapImageReady = true;
    drawVRMinimap();
    vrMinimapTex.needsUpdate = true;
  } else {
    // Cache miss (no floor plan for this floor) — clear and redraw
    minimapFloorImg = null;
    mapAspect = 0.754;
    mapCanvasW = 2048;
    mapCanvasH = Math.round(2048 * mapAspect);
    vrMinimapCanvas.width = mapCanvasW;
    vrMinimapCanvas.height = mapCanvasH;
    let bigW = 7, bigH = bigW * mapAspect;
    vrMinimapMesh.geometry.dispose();
    vrMinimapMesh.geometry = new THREE.PlaneGeometry(bigW, bigH);
    repositionFloorButtons();
    repositionCloseButton();
    drawVRMinimap();
    vrMinimapTex.needsUpdate = true;
  }
}
```

Same simplification applies to `deactivateVRMinimap()` (no async wait — read from cache).

### Gaze targeting integration

`updateGaze()` currently only checks `vrHotspotGroup.children`. Extend it to also check map UI meshes when relevant:

```js
// Build target list dynamically
let gazeTargets;
if (vrMinimapActive) {
  // Map is open — only target map UI (no hotspots)
  gazeTargets = [vrMinimapCloseBtn];
  if (TOUR.floors && TOUR.floors.length > 1) {
    gazeTargets.push(vrMinimapFloorPrev, vrMinimapFloorNext);
  }
} else if (vrMinimapIcon.visible) {
  // Map is collapsed — target hotspots AND the map icon
  gazeTargets = [...vrHotspotGroup.children, vrMinimapIcon];
} else {
  gazeTargets = vrHotspotGroup.children;
}
const hits = raycaster.intersectObjects(gazeTargets);
```

Each new gaze target gets a `userData._mapAction` field so the gaze-completion handler knows what to do:
- `vrMinimapIcon.userData._mapAction = 'activate'`
- `vrMinimapCloseBtn.userData._mapAction = 'close'`
- `vrMinimapFloorPrev.userData._mapAction = 'floorPrev'`
- `vrMinimapFloorNext.userData._mapAction = 'floorNext'`

In the gaze-fired branch:
```js
if (hitTarget.userData._mapAction) {
  switch (hitTarget.userData._mapAction) {
    case 'activate': activateVRMinimap(); break;
    case 'close': deactivateVRMinimap(); break;
    case 'floorPrev': switchVRMapFloor(-1); break;
    case 'floorNext': switchVRMapFloor(+1); break;
  }
} else {
  handleHotspotClick(hitTarget.userData);
}
```

The floor buttons get a shorter dwell (1.2s) via per-target override:
```js
const dwellFor = hitTarget.userData._gazeDwell || GAZE_DWELL;
if (gazeTimer >= dwellFor) { ... }
```

`vrMinimapFloorPrev.userData._gazeDwell = 1.2`
`vrMinimapFloorNext.userData._gazeDwell = 1.2`

### Controller integration

`onVRSelect` (trigger click) — extend the existing raycast path:
```js
// Existing: check vrMinimapMesh when active to activate scene navigation
// New: also check vrMinimapIcon (small icon), close button, floor buttons
const mapUITargets = [];
if (vrMinimapActive) {
  mapUITargets.push(vrMinimapCloseBtn);
  if (TOUR.floors.length > 1) mapUITargets.push(vrMinimapFloorPrev, vrMinimapFloorNext);
}
if (vrMinimapIcon.visible && !vrMinimapActive) mapUITargets.push(vrMinimapIcon);

const uiHits = raycaster.intersectObjects(mapUITargets);
if (uiHits.length > 0) {
  const action = uiHits[0].object.userData._mapAction;
  if (action === 'activate') activateVRMinimap();
  else if (action === 'close') deactivateVRMinimap();
  else if (action === 'floorPrev') switchVRMapFloor(-1);
  else if (action === 'floorNext') switchVRMapFloor(+1);
  return;
}
// ... existing flow (hotspots, scene-node click on map)
```

## Implementation Order

All 5 fixes ship together as a single change. The work touches related code paths in `vr-tour-editor.html` (mesh setup, gaze loop, controller handler, `drawVRMinimap`, floor switching) — splitting into separate commits would mean touching the same regions multiple times. One coherent change is easier to review and test.

Internal ordering within the single change (helps avoid intermediate broken states while editing):

1. Add `floorImageCache` + `preloadFloorImages()` (no behavior change yet)
2. Refactor `switchVRMapFloor()` and `deactivateVRMinimap()` to read from cache (fixes freeze)
3. Update `drawVRMinimap()` — editor-matching styles, new node scale formula, remove canvas-drawn header arrows
4. Create new 3D meshes: `vrMinimapIcon`, `vrMinimapFloorPrev/Next`, `vrMinimapCloseBtn` + their canvas textures
5. Add `repositionMapIcon()`, `repositionFloorButtons()`, `repositionCloseButton()`
6. Delete `updateVRMinimapPosition()` and the small-mode plane geometry path
7. Extend `updateGaze()` to target the new meshes (with per-target dwell overrides)
8. Extend `onVRSelect` to handle map UI clicks

## Testing Plan

Verify on Quest 3 after the change ships:

- **Freeze fix:** Switch floors multiple times in a row. No freeze, smooth swap.
- **Icon:** Enter VR — bottom-middle icon visible. Look at it — confirm it doesn't move. Gaze 1.5s activates map. Trigger click also activates. Close map — icon respawns to new bottom-middle. Navigate to new scene — icon respawns.
- **Floor buttons:** Enlarged map shows two flanking buttons. Gaze 1.2s on left/right switches floor. Trigger click also works. Buttons visually match editor's `.minimap-floor-btn`.
- **Close button:** Top-right of enlarged map. Gaze 1.8s closes. Trigger click closes.
- **GUI match:** Side-by-side screenshot of VR enlarged map vs editor's enlarged flat minimap. Node sizes, colors, labels, header banner all match.
- **Hotspot scaling:** At zoom 1x, hotspots match editor size. At zoom 3x, hotspots shrink proportionally (existing zoom behavior preserved).

## Risks

- **Gaze target list ordering matters.** If `vrMinimapIcon` is checked before hotspots, looking at a hotspot that overlaps with the icon's screen position might mis-fire. Mitigation: icon is bottom-middle and 2m away; hotspots are typically at horizon level on the panorama sphere (5m+ radius), so they don't overlap in practice. If a conflict shows up in testing, exclude the icon when gaze direction pitch is above -10° (i.e. user is looking forward/up).
- **3D buttons may visually conflict with the enlarged map plane.** Mitigation: place buttons 0.4m beyond the map edge with the same quaternion, so they're coplanar but offset. Use `renderOrder` 999 (same as map) to avoid depth-fighting.
- **Floor images may be large enough to slow `preloadFloorImages()`.** Each is base64 in JSON; decoding happens on the main thread. Should be fine for typical 2-5 floor tours (~1MB each). Worst case: lazy-load on first map-open.
