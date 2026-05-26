# VR Map Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship 5 VR map fixes to the exported tour viewer (gaze-targetable bottom-middle icon, 3D floor buttons, 3D close button, editor-matching GUI, hotspot scaling, floor-switch freeze fix) as a single combined change.

**Architecture:** All edits go into the template literal in `vr-tour-editor.html` (lines ~1799 to ~4200) which generates the exported standalone tour HTML. No automated tests exist for the VR map — verification is manual on Quest 3 hardware at the end. All tasks below produce intermediate file states; ONE final commit ships everything together (per user request).

**Tech Stack:** Three.js r160 (WebXR `immersive-vr`), Canvas2D textures, vanilla JS embedded in HTML template literal.

**Spec:** `docs/superpowers/specs/2026-05-26-vr-map-improvements-design.md`

**Baseline:** GitHub `main` @ `c10a7b7` (the current `HEAD` after the spec commits `ca60567` and `72c049e`).

**Editing conventions:**
- File line numbers will shift as edits land. Use unique anchor strings (function signatures, comment markers) with the Edit tool rather than line numbers.
- All code in this file lives inside a JS template literal — backticks and `${...}` are template delimiters of the *outer* file, NOT of the embedded code. Do not introduce literal backticks or `${` inside the embedded code.
- Each step shows the FULL replacement code. Use Edit with `old_string` = current snippet, `new_string` = full new code.

---

## Task 1: Add `floorImageCache` and `preloadFloorImages()`

**Files:**
- Modify: `vr-tour-editor.html` (inside the export template literal, near the top of the IIFE around `const TOUR = ${JSON.stringify(tourData)};`)

**Goal:** Pre-decode all floor plan images at tour load so floor switching becomes synchronous. No behavior change yet — this just adds the cache.

- [ ] **Step 1: Find the insertion point**

Open `vr-tour-editor.html` and search for the line `const TOUR = ${JSON.stringify(tourData)};`. The cache should be added right after the `TOUR` is defined and before the VR minimap setup starts. A good anchor is just before:

```js
  // VR Minimap HUD (3D plane with canvas texture)
  const vrMinimapCanvas = document.createElement('canvas');
```

- [ ] **Step 2: Insert the cache + preload function**

Use Edit to replace:

```js
  // VR Minimap HUD (3D plane with canvas texture)
  const vrMinimapCanvas = document.createElement('canvas');
```

with:

```js
  // Pre-decoded floor plan images, keyed by floor id — avoids async image-load freezes during floor switching
  const floorImageCache = {};
  function preloadFloorImages() {
    if (!TOUR.floors) return;
    for (const f of TOUR.floors) {
      if (!f.floorPlanData) continue;
      const img = new Image();
      // Start with a default entry so cache lookups don't return undefined while loading
      floorImageCache[f.id] = { img: img, aspect: 0.754, w: 2048, h: Math.round(2048 * 0.754), ready: false };
      img.onload = function() {
        const aspect = this.naturalHeight / this.naturalWidth;
        let w = Math.min(this.naturalWidth, 4096);
        let h = Math.round(w * aspect);
        if (h > 4096) { h = 4096; w = Math.round(h / aspect); }
        floorImageCache[f.id] = { img: this, aspect: aspect, w: w, h: h, ready: true };
      };
      img.src = f.floorPlanData;
    }
  }
  preloadFloorImages();

  // VR Minimap HUD (3D plane with canvas texture)
  const vrMinimapCanvas = document.createElement('canvas');
```

- [ ] **Step 3: Verify by re-reading the file**

Use Grep to confirm `preloadFloorImages` appears exactly twice (definition + call) in the file:

```
Grep pattern="preloadFloorImages" path="vr-tour-editor.html" output_mode="files_with_matches"
```

Expected: 1 file match, and a content grep should show 2 occurrences.

---

## Task 2: Refactor `switchVRMapFloor()` to read from cache

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function switchVRMapFloor(direction) { ... }` block

**Goal:** Floor switching becomes synchronous. No `new Image()` mid-switch, no `onload` callback, no `mapImageReady = false` gap.

- [ ] **Step 1: Replace the function body**

Use Edit to replace the current `switchVRMapFloor` (find by signature `function switchVRMapFloor(direction) {`). The current function starts with `if (!TOUR.floors || TOUR.floors.length <= 1) return;` and ends with the closing `}` of the function. Replace the ENTIRE function with:

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

    const targetFloor = sorted[newIdx];
    const cached = floorImageCache[targetFloor.id];

    if (cached && cached.ready) {
      // Synchronous swap from cache — no async wait, no freeze
      minimapFloorImg = cached.img;
      mapAspect = cached.aspect;
      mapCanvasW = cached.w;
      mapCanvasH = cached.h;
    } else {
      // Cache miss (no floor plan for this floor, or still decoding) — fall back to dark box
      minimapFloorImg = null;
      mapAspect = 0.754;
      mapCanvasW = 2048;
      mapCanvasH = Math.round(2048 * mapAspect);
    }

    vrMinimapCanvas.width = mapCanvasW;
    vrMinimapCanvas.height = mapCanvasH;

    // Rebuild enlarged plane geometry with new aspect (only relevant if map is currently active)
    if (vrMinimapActive) {
      let bigW, bigH;
      if (mapAspect < 1) { bigW = 7; bigH = bigW * mapAspect; }
      else { bigH = 7; bigW = bigH / mapAspect; }
      vrMinimapMesh.geometry.dispose();
      vrMinimapMesh.geometry = new THREE.PlaneGeometry(bigW, bigH);
      repositionFloorButtons();
      repositionCloseButton();
    }

    mapImageReady = true;
    drawVRMinimap();
    vrMinimapTex.needsUpdate = true;
  }
```

(Note: `repositionFloorButtons()` and `repositionCloseButton()` will be defined in Task 6. They must be referenced here so the function is structurally complete after Task 6 lands.)

- [ ] **Step 2: Verify the function compiles**

Use Grep to confirm the function is well-formed:

```
Grep pattern="function switchVRMapFloor" path="vr-tour-editor.html" output_mode="content" -n=true
```

Expected: one match, line shifted from original ~3814.

---

## Task 3: Refactor `deactivateVRMinimap()` to read from cache

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function deactivateVRMinimap()` block

- [ ] **Step 1: Replace the function body**

Use Edit to replace the current `deactivateVRMinimap` function (signature `function deactivateVRMinimap() {`). Replace the entire function with:

```js
  function deactivateVRMinimap() {
    vrMinimapActive = false;
    mapZoom = 1.0;
    mapPanX = 0;
    mapPanY = 0;
    mapDragStart = null;
    mapTriggerHeld = false;
    // Reset to actual current floor — read from cache, no async load
    const actualFloorId = getCurrentFloorId();
    mapViewFloorId = actualFloorId;
    const cached = floorImageCache[actualFloorId];

    if (cached && cached.ready) {
      minimapFloorImg = cached.img;
      mapAspect = cached.aspect;
      mapCanvasW = cached.w;
      mapCanvasH = cached.h;
    } else {
      minimapFloorImg = null;
      mapAspect = 0.754;
      mapCanvasW = 2048;
      mapCanvasH = Math.round(2048 * mapAspect);
    }
    vrMinimapCanvas.width = mapCanvasW;
    vrMinimapCanvas.height = mapCanvasH;

    // Map plane no longer used in small mode — hide it; the bottom-middle icon takes over
    vrMinimapMesh.visible = false;
    mapImageReady = true;

    // Hide map UI elements
    vrMinimapFloorPrev.visible = false;
    vrMinimapFloorNext.visible = false;
    vrMinimapCloseBtn.visible = false;

    // Re-show the bottom-middle icon and reposition it
    vrMinimapIcon.visible = !vrMinimapHidden;
    repositionMapIcon();

    drawVRMinimap();
    vrMinimapTex.needsUpdate = true;
  }
```

(Note: `vrMinimapIcon`, `vrMinimapFloorPrev`, `vrMinimapFloorNext`, `vrMinimapCloseBtn`, and `repositionMapIcon()` will be defined in Tasks 5–6. They are referenced here so the function is structurally complete after those tasks land.)

---

## Task 4: Update `drawVRMinimap()` styles to match editor

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function drawVRMinimap()` block

**Goal:** Match editor's flat minimap GUI: node sizes, label styles, header banner. Remove canvas-drawn floor arrows (replaced by 3D buttons in Task 6).

- [ ] **Step 1: Replace the drawVRMinimap function body**

Use Edit to replace the current `function drawVRMinimap() { ... }` (find by signature). Replace with:

```js
  function drawVRMinimap() {
    const ctx = vrMinimapCanvas.getContext('2d');
    const W = vrMinimapCanvas.width, H = vrMinimapCanvas.height;
    ctx.clearRect(0, 0, W, H);

    const activeMode = vrMinimapActive;

    ctx.save();
    if (activeMode && mapZoom > 1) {
      const maxPanX = (W * (mapZoom - 1)) / 2;
      const maxPanY = (H * (mapZoom - 1)) / 2;
      mapPanX = Math.max(-maxPanX, Math.min(maxPanX, mapPanX));
      mapPanY = Math.max(-maxPanY, Math.min(maxPanY, mapPanY));
      ctx.translate(W / 2 + mapPanX, H / 2 + mapPanY);
      ctx.scale(mapZoom, mapZoom);
      ctx.translate(-W / 2, -H / 2);
    }

    // Background: floor plan or dark box (editor uses 0.3 dim, rounded 10)
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 12);
    ctx.clip();
    if (minimapFloorImg && minimapFloorImg.complete && minimapFloorImg.naturalWidth) {
      ctx.drawImage(minimapFloorImg, 0, 0, W, H);
      if (!activeMode) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(0, 0, W, H);
      }
    } else {
      ctx.fillStyle = 'rgba(10, 15, 30, 0.7)';
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(4, 4, W - 8, H - 8, 12);
    ctx.strokeStyle = 'rgba(255,122,0,0.5)';
    ctx.lineWidth = activeMode ? 6 : 3;
    ctx.stroke();

    const floorId = (vrMinimapActive && mapViewFloorId) ? mapViewFloorId : getCurrentFloorId();
    const scenes = getScenesForFloor(floorId);
    if (!scenes.length) { ctx.restore(); vrMinimapTex.needsUpdate = true; return; }
    const pad = Math.max(40, W * 0.04);
    const positions = getScenePositions(W, H, pad, floorId);

    // MATCH EDITOR: nodeScale uses W/220 (editor's base scale), no 0.8 reduction
    const nodeScale = Math.max(1, W / 220);
    const zoomScale = activeMode && mapZoom > 1 ? 1.2 / mapZoom : 1;

    // Connection lines (editor lineWidth 1.5)
    ctx.lineWidth = 1.5 * nodeScale * zoomScale;
    scenes.forEach(s => {
      s.hotspots.forEach(hs => {
        if (hs.type === 'nav' && hs.target && positions[parseInt(hs.target)]) {
          const from = positions[s.id];
          const to = positions[parseInt(hs.target)];
          ctx.strokeStyle = s.id === currentSceneId ? 'rgba(255,122,0,0.6)' : 'rgba(255,255,255,0.25)';
          ctx.beginPath();
          ctx.moveTo(from.x, from.y);
          ctx.lineTo(to.x, to.y);
          ctx.stroke();
        }
      });
    });

    // Scene nodes — editor radii (current 16, others 12)
    scenes.forEach(s => {
      const p = positions[s.id];
      if (!p) return;
      const isCurrent = s.id === currentSceneId;
      const isHovered = s.id === mapHoveredSceneId;
      const r = (isCurrent ? 16 : 12) * nodeScale * zoomScale;

      if (isCurrent) { ctx.shadowColor = '#ff7a00'; ctx.shadowBlur = 16 * nodeScale * zoomScale; }
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = isCurrent ? '#ff7a00' : 'rgba(255, 160, 50, 0.6)';
      ctx.fill();
      ctx.strokeStyle = isCurrent ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.lineWidth = (isCurrent ? 2 : 1) * nodeScale * zoomScale;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Nav hotspot dots — editor offset 8, radius 4
      const navHs = s.hotspots.filter(h => h.type === 'nav');
      navHs.forEach((hs, hi) => {
        const a = (hi / navHs.length) * Math.PI * 2 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(p.x + (r + 8 * nodeScale * zoomScale) * Math.cos(a), p.y + (r + 8 * nodeScale * zoomScale) * Math.sin(a), 4 * nodeScale * zoomScale, 0, Math.PI * 2);
        ctx.fillStyle = '#ff7a00';
        ctx.fill();
      });

      // Label — match editor style (only for current or hovered, only when active/enlarged)
      if (activeMode && (isCurrent || isHovered)) {
        ctx.save();
        const label = s.name;
        const labelFontSize = Math.round(12 * nodeScale * zoomScale);
        ctx.font = (isCurrent ? 'bold ' : '') + labelFontSize + 'px sans-serif';
        const tw = ctx.measureText(label).width;
        const lx = p.x - tw / 2 - 6, ly = p.y + r + 6;
        ctx.fillStyle = 'rgba(10,10,24,0.85)';
        ctx.strokeStyle = isCurrent ? 'rgba(255,122,0,0.5)' : 'rgba(0,240,255,0.4)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(lx, ly, tw + 12, labelFontSize + 8, 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isCurrent ? '#ff7a00' : '#00f0ff';
        ctx.textAlign = 'center';
        ctx.fillText(label, p.x, ly + labelFontSize + 2);
        ctx.restore();
      }
    });

    ctx.restore(); // undo zoom/pan transform

    // Header — floor name banner (editor style, no canvas-drawn arrows — arrows are 3D meshes now)
    const viewFloor = (vrMinimapActive && mapViewFloorId) ? (TOUR.floors || []).find(f => f.id === mapViewFloorId) : getCurrentFloor();
    const headerFloorName = viewFloor ? viewFloor.name : 'PLAN VIEW';
    const isViewingOtherFloor = mapViewFloorId && mapViewFloorId !== getCurrentFloorId();
    const hdrScale = Math.max(1, W / 220);
    const hdrFontSize = Math.round(16 * hdrScale);
    const hdrY = 16 + hdrFontSize;
    ctx.font = 'bold ' + hdrFontSize + 'px sans-serif';
    const tw = ctx.measureText(headerFloorName).width;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(10,10,24,0.85)';
    ctx.beginPath();
    ctx.roundRect(14, 10, tw + 24, hdrFontSize + 14, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,122,0,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = isViewingOtherFloor ? 'rgba(100,200,255,0.95)' : '#ff7a00';
    ctx.fillText(headerFloorName, 26, hdrY);

    // Zoom indicator when active and zoomed
    if (activeMode && mapZoom !== 1) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(W - 180, 10, 170, 36);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('Zoom: ' + mapZoom.toFixed(1) + 'x', W - 20, 34);
    }

    vrMinimapTex.needsUpdate = true;
  }
```

Key changes vs original:
- `nodeScale` formula: `max(1, W/220)` (was `max(1, W/512) * 0.8`)
- Current node radius: 16 (was 32). Others: 12 (was 24).
- Nav dot offset 8 (was 12), radius 4 (was 5).
- Background dim: 0.3 (was 0.25).
- Labels on hover use editor style (rgba(10,10,24,0.85) bg, cyan/orange border, colored text).
- "3-char abbreviation inside circle" removed entirely.
- Header is a plain banner — no `◀ ▶` arrows in canvas anymore.

---

## Task 5: Add canvas-texture helpers for the 3D UI meshes

**Files:**
- Modify: `vr-tour-editor.html` — insert helpers near the floor-image preload section

**Goal:** Centralize the canvas-drawing for icon / floor buttons / close button so each mesh can update its texture (e.g. when entering a "hover" visual state).

- [ ] **Step 1: Insert helpers right after `preloadFloorImages()` call**

Find the line `preloadFloorImages();` (added in Task 1). Replace with:

```js
  preloadFloorImages();

  // Canvas-texture helpers for the 3D map UI meshes
  function drawMapIconTexture(canvas) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // Editor-style: black bg, orange border, map-pin glyph
    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, 24);
    ctx.fill();
    ctx.strokeStyle = '#ff7a00';
    ctx.lineWidth = 8;
    ctx.stroke();
    // Map-pin glyph (centered)
    ctx.fillStyle = '#ff7a00';
    ctx.strokeStyle = '#ff7a00';
    ctx.lineWidth = 6;
    const cx = W / 2, cy = H / 2 - 10;
    // Pin head circle
    ctx.beginPath();
    ctx.arc(cx, cy - 20, 30, 0, Math.PI * 2);
    ctx.fill();
    // Pin body (teardrop tail) — triangle from circle bottom to point
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy - 5);
    ctx.lineTo(cx + 22, cy - 5);
    ctx.lineTo(cx, cy + 50);
    ctx.closePath();
    ctx.fill();
    // Small hole in pin head (white dot)
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(cx, cy - 20, 10, 0, Math.PI * 2);
    ctx.fill();
    // Label "MAP" under pin
    ctx.fillStyle = '#ff7a00';
    ctx.font = 'bold 32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MAP', cx, H - 28);
  }

  function drawFloorButtonTexture(canvas, arrow, hovered) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // Editor's .minimap-floor-btn style
    ctx.fillStyle = hovered ? '#ff7a00' : 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.roundRect(8, 8, W - 16, H - 16, 24);
    ctx.fill();
    ctx.strokeStyle = '#ff7a00';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.fillStyle = hovered ? '#fff' : '#ff7a00';
    ctx.font = 'bold 220px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(arrow, W / 2, H / 2);
    ctx.textBaseline = 'alphabetic';
  }

  function drawCloseButtonTexture(canvas, hovered) {
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    // Editor's #minimap-close style
    ctx.fillStyle = hovered ? '#c00' : 'rgba(0,0,0,0.85)';
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, W / 2 - 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = hovered ? '#c00' : '#666';
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✕', W / 2, H / 2);
    ctx.textBaseline = 'alphabetic';
  }
```

---

## Task 6: Create the 3D UI meshes (icon, floor buttons, close button)

**Files:**
- Modify: `vr-tour-editor.html` — insert mesh setup right after the existing `vrMinimapMesh` setup block

**Goal:** Add the four new meshes (icon + 2 floor buttons + close), their textures, and the reposition helpers. The meshes start invisible.

- [ ] **Step 1: Find anchor**

Search for the existing line:

```js
  scene.add(vrMinimapMesh);
  vrMinimapMesh.visible = false;
```

(This is the existing setup that adds the big enlarged-map plane to the scene.)

- [ ] **Step 2: Insert new mesh setup after the anchor**

Replace the anchor block with:

```js
  scene.add(vrMinimapMesh);
  vrMinimapMesh.visible = false;

  // --- New 3D map UI meshes ---

  // Bottom-middle activation icon (replaces head-locked floating minimap)
  const vrMinimapIconCanvas = document.createElement('canvas');
  vrMinimapIconCanvas.width = 256;
  vrMinimapIconCanvas.height = 256;
  drawMapIconTexture(vrMinimapIconCanvas);
  const vrMinimapIconTex = new THREE.CanvasTexture(vrMinimapIconCanvas);
  vrMinimapIconTex.minFilter = THREE.LinearFilter;
  vrMinimapIconTex.magFilter = THREE.LinearFilter;
  const vrMinimapIcon = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: vrMinimapIconTex, transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  vrMinimapIcon.renderOrder = 998;
  vrMinimapIcon.userData._mapAction = 'activate';
  vrMinimapIcon.visible = false; // shown only once VR session is active
  scene.add(vrMinimapIcon);

  // Floor-prev button
  const vrMinimapFloorPrevCanvas = document.createElement('canvas');
  vrMinimapFloorPrevCanvas.width = 256;
  vrMinimapFloorPrevCanvas.height = 384;
  drawFloorButtonTexture(vrMinimapFloorPrevCanvas, '◀', false);
  const vrMinimapFloorPrevTex = new THREE.CanvasTexture(vrMinimapFloorPrevCanvas);
  vrMinimapFloorPrevTex.minFilter = THREE.LinearFilter;
  vrMinimapFloorPrevTex.magFilter = THREE.LinearFilter;
  const vrMinimapFloorPrev = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.7),
    new THREE.MeshBasicMaterial({ map: vrMinimapFloorPrevTex, transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  vrMinimapFloorPrev.renderOrder = 1000;
  vrMinimapFloorPrev.userData._mapAction = 'floorPrev';
  vrMinimapFloorPrev.userData._gazeDwell = 1.2;
  vrMinimapFloorPrev.visible = false;
  scene.add(vrMinimapFloorPrev);

  // Floor-next button
  const vrMinimapFloorNextCanvas = document.createElement('canvas');
  vrMinimapFloorNextCanvas.width = 256;
  vrMinimapFloorNextCanvas.height = 384;
  drawFloorButtonTexture(vrMinimapFloorNextCanvas, '▶', false);
  const vrMinimapFloorNextTex = new THREE.CanvasTexture(vrMinimapFloorNextCanvas);
  vrMinimapFloorNextTex.minFilter = THREE.LinearFilter;
  vrMinimapFloorNextTex.magFilter = THREE.LinearFilter;
  const vrMinimapFloorNext = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.7),
    new THREE.MeshBasicMaterial({ map: vrMinimapFloorNextTex, transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  vrMinimapFloorNext.renderOrder = 1000;
  vrMinimapFloorNext.userData._mapAction = 'floorNext';
  vrMinimapFloorNext.userData._gazeDwell = 1.2;
  vrMinimapFloorNext.visible = false;
  scene.add(vrMinimapFloorNext);

  // Close button
  const vrMinimapCloseBtnCanvas = document.createElement('canvas');
  vrMinimapCloseBtnCanvas.width = 128;
  vrMinimapCloseBtnCanvas.height = 128;
  drawCloseButtonTexture(vrMinimapCloseBtnCanvas, false);
  const vrMinimapCloseBtnTex = new THREE.CanvasTexture(vrMinimapCloseBtnCanvas);
  vrMinimapCloseBtnTex.minFilter = THREE.LinearFilter;
  vrMinimapCloseBtnTex.magFilter = THREE.LinearFilter;
  const vrMinimapCloseBtn = new THREE.Mesh(
    new THREE.CircleGeometry(0.15, 32),
    new THREE.MeshBasicMaterial({ map: vrMinimapCloseBtnTex, transparent: true, side: THREE.DoubleSide, depthTest: false })
  );
  vrMinimapCloseBtn.renderOrder = 1000;
  vrMinimapCloseBtn.userData._mapAction = 'close';
  vrMinimapCloseBtn.userData._gazeDwell = 1.8;
  vrMinimapCloseBtn.visible = false;
  scene.add(vrMinimapCloseBtn);

  // --- Reposition helpers ---

  function repositionMapIcon() {
    if (!renderer.xr.isPresenting) return;
    const xrCam = renderer.xr.getCamera();
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    xrCam.getWorldPosition(camPos);
    xrCam.getWorldDirection(camDir);
    // Project forward to horizontal plane (yaw only)
    camDir.y = 0;
    if (camDir.lengthSq() < 0.0001) camDir.set(0, 0, -1);
    camDir.normalize();
    // Place 2m forward, 0.8m below eye level
    const ICON_DIST = 2.0, ICON_DROP = 0.8;
    vrMinimapIcon.position.copy(camPos)
      .add(camDir.clone().multiplyScalar(ICON_DIST))
      .add(new THREE.Vector3(0, -ICON_DROP, 0));
    // Face the user
    vrMinimapIcon.lookAt(camPos);
  }

  function repositionFloorButtons() {
    if (!vrMinimapActive) return;
    const bigW = vrMinimapMesh.geometry.parameters.width;
    const mapRight = new THREE.Vector3(1, 0, 0).applyQuaternion(vrMinimapMesh.quaternion);
    const gap = 0.4;
    vrMinimapFloorPrev.position.copy(vrMinimapMesh.position)
      .add(mapRight.clone().multiplyScalar(-(bigW / 2 + gap)));
    vrMinimapFloorNext.position.copy(vrMinimapMesh.position)
      .add(mapRight.clone().multiplyScalar(bigW / 2 + gap));
    vrMinimapFloorPrev.quaternion.copy(vrMinimapMesh.quaternion);
    vrMinimapFloorNext.quaternion.copy(vrMinimapMesh.quaternion);
  }

  function repositionCloseButton() {
    if (!vrMinimapActive) return;
    const bigW = vrMinimapMesh.geometry.parameters.width;
    const bigH = vrMinimapMesh.geometry.parameters.height;
    const mapRight = new THREE.Vector3(1, 0, 0).applyQuaternion(vrMinimapMesh.quaternion);
    const mapUp = new THREE.Vector3(0, 1, 0).applyQuaternion(vrMinimapMesh.quaternion);
    vrMinimapCloseBtn.position.copy(vrMinimapMesh.position)
      .add(mapRight.clone().multiplyScalar(bigW / 2 - 0.15))
      .add(mapUp.clone().multiplyScalar(bigH / 2 - 0.15));
    vrMinimapCloseBtn.quaternion.copy(vrMinimapMesh.quaternion);
  }

  function setFloorButtonHover(which, hovered) {
    if (which === 'prev') {
      drawFloorButtonTexture(vrMinimapFloorPrevCanvas, '◀', hovered);
      vrMinimapFloorPrevTex.needsUpdate = true;
    } else {
      drawFloorButtonTexture(vrMinimapFloorNextCanvas, '▶', hovered);
      vrMinimapFloorNextTex.needsUpdate = true;
    }
  }

  function setCloseButtonHover(hovered) {
    drawCloseButtonTexture(vrMinimapCloseBtnCanvas, hovered);
    vrMinimapCloseBtnTex.needsUpdate = true;
  }
```

---

## Task 7: Update `activateVRMinimap()` to show new meshes

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function activateVRMinimap()` block

- [ ] **Step 1: Replace the function**

Replace the existing `activateVRMinimap` function with:

```js
  function activateVRMinimap() {
    vrMinimapActive = true;
    mapActivatedAt = performance.now();
    mapZoom = 1.0;
    mapPanX = 0;
    mapPanY = 0;
    mapViewFloorId = getCurrentFloorId();
    mapFloorSwitchCooldown = 0;

    // Make sure the map plane geometry matches the current floor aspect
    let bigW, bigH;
    if (mapAspect < 1) { bigW = 7; bigH = bigW * mapAspect; }
    else { bigH = 7; bigW = bigH / mapAspect; }
    vrMinimapMesh.geometry.dispose();
    vrMinimapMesh.geometry = new THREE.PlaneGeometry(bigW, bigH);
    vrMinimapMesh.material.opacity = 0.97;
    vrMinimapMesh.material.depthTest = true;
    vrMinimapMesh.material.depthWrite = true;
    vrMinimapMesh.visible = true;

    // Position centered in front of viewer
    const xrCam = renderer.xr.getCamera();
    const camPos = new THREE.Vector3();
    const camDir = new THREE.Vector3();
    xrCam.getWorldPosition(camPos);
    xrCam.getWorldDirection(camDir);
    vrMinimapMesh.position.copy(camPos).add(camDir.clone().multiplyScalar(3.5));
    vrMinimapMesh.lookAt(camPos);
    vrMinimapMesh.updateMatrixWorld(true);

    // Hide the bottom-middle icon while map is enlarged
    vrMinimapIcon.visible = false;

    // Show + position floor buttons (only if there are 2+ floors)
    const hasMultiFloor = TOUR.floors && TOUR.floors.length > 1;
    vrMinimapFloorPrev.visible = hasMultiFloor;
    vrMinimapFloorNext.visible = hasMultiFloor;
    if (hasMultiFloor) repositionFloorButtons();

    // Show + position close button
    vrMinimapCloseBtn.visible = true;
    repositionCloseButton();

    drawVRMinimap();
  }
```

---

## Task 8: Delete `updateVRMinimapPosition()` and small-mode plane handling

**Files:**
- Modify: `vr-tour-editor.html`

- [ ] **Step 1: Delete `updateVRMinimapPosition` function**

Find and delete the entire `function updateVRMinimapPosition() { ... }` block. The function starts with `function updateVRMinimapPosition() {` and ends with the matching `}`. Use Edit with the full function as `old_string` and an empty string (or whitespace) as `new_string`.

- [ ] **Step 2: Remove `getSmallPlaneSize()` function**

Find and delete the entire `function getSmallPlaneSize() { ... }` block AND the line `const smallSize = getSmallPlaneSize();` that follows.

- [ ] **Step 3: Update the existing `onload` handler for `minimapFloorImg`**

The current block at line ~3524 reads `if (minimapFloorImg) { minimapFloorImg.onload = function() { ... } }`. This used `getSmallPlaneSize()` and adjusted `vrMinimapMesh.geometry` for the small-mode plane. Since we no longer have a small-mode plane, simplify by removing the geometry-rebuild portion.

Use Edit to replace:

```js
  // Update everything when floor plan image loads
  if (minimapFloorImg) {
    minimapFloorImg.onload = function() {
      mapAspect = this.naturalHeight / this.naturalWidth;
      mapCanvasW = Math.min(this.naturalWidth, 4096);
      mapCanvasH = Math.round(mapCanvasW * mapAspect);
      if (mapCanvasH > 4096) { mapCanvasH = 4096; mapCanvasW = Math.round(mapCanvasH / mapAspect); }
      vrMinimapCanvas.width = mapCanvasW;
      vrMinimapCanvas.height = mapCanvasH;
      // Rebuild geometry with actual aspect ratio
      const sz = getSmallPlaneSize();
      vrMinimapMesh.geometry.dispose();
      vrMinimapMesh.geometry = new THREE.PlaneGeometry(sz.w, sz.h);
      mapImageReady = true;
      drawMinimap();
      drawVRMinimap();
      vrMinimapTex.needsUpdate = true;
    };
    // If already loaded (base64 data URL)
    if (minimapFloorImg.complete && minimapFloorImg.naturalWidth) {
      minimapFloorImg.onload();
    }
  }
```

with:

```js
  // Update canvas size when floor plan image loads (geometry rebuild happens in activateVRMinimap / switchVRMapFloor)
  if (minimapFloorImg) {
    minimapFloorImg.onload = function() {
      mapAspect = this.naturalHeight / this.naturalWidth;
      mapCanvasW = Math.min(this.naturalWidth, 4096);
      mapCanvasH = Math.round(mapCanvasW * mapAspect);
      if (mapCanvasH > 4096) { mapCanvasH = 4096; mapCanvasW = Math.round(mapCanvasH / mapAspect); }
      vrMinimapCanvas.width = mapCanvasW;
      vrMinimapCanvas.height = mapCanvasH;
      mapImageReady = true;
      drawMinimap();
      drawVRMinimap();
      vrMinimapTex.needsUpdate = true;
    };
    if (minimapFloorImg.complete && minimapFloorImg.naturalWidth) {
      minimapFloorImg.onload();
    }
  }
```

- [ ] **Step 4: Update the `vrMinimapMesh.visible = !vrMinimapHidden` logic in animate()**

Find the animate-loop block that toggles `vrMinimapMesh.visible`. Currently:

```js
        vrMinimapMesh.visible = !vrMinimapHidden;
        if (!vrMinimapHidden) updateVRMinimapPosition();
```

Replace with:

```js
        // Map plane is only shown when explicitly activated — never in small mode now
        if (!vrMinimapActive) vrMinimapMesh.visible = false;
        // Bottom-middle icon visibility tracks vrMinimapHidden + not-active
        if (!vrMinimapActive && !vrMinimapHidden) {
          if (!vrMinimapIcon.visible) {
            vrMinimapIcon.visible = true;
            repositionMapIcon();
          }
        } else {
          vrMinimapIcon.visible = false;
        }
```

---

## Task 9: Extend `updateGaze()` to target map UI meshes

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function updateGaze()` body

**Goal:** Gaze can now target the icon (when map is collapsed), and the close + floor buttons (when map is active). Hotspot gaze is suppressed when the map is open.

- [ ] **Step 1: Replace the target-finding section in `updateGaze()`**

Find the existing block:

```js
    const hits = raycaster.intersectObjects(vrHotspotGroup.children);
    const hsHit = hits.find(h => h.object.userData && h.object.userData.type);
    let hitTarget = hsHit ? hsHit.object : null;
```

Replace with:

```js
    // Build gaze target list based on current map state
    let gazeTargets;
    let isMapUITarget = false;
    if (vrMinimapActive) {
      // Map is open — gaze targets are the close button and (if multi-floor) the floor buttons
      gazeTargets = [vrMinimapCloseBtn];
      if (TOUR.floors && TOUR.floors.length > 1) {
        gazeTargets.push(vrMinimapFloorPrev, vrMinimapFloorNext);
      }
    } else if (vrMinimapIcon.visible) {
      // Map is collapsed — target hotspots AND the bottom-middle icon
      gazeTargets = [...vrHotspotGroup.children, vrMinimapIcon];
    } else {
      gazeTargets = vrHotspotGroup.children;
    }
    const hits = raycaster.intersectObjects(gazeTargets);
    // Pick first hit that is either a hotspot OR a map UI element
    const goodHit = hits.find(h => h.object.userData && (h.object.userData.type || h.object.userData._mapAction));
    let hitTarget = goodHit ? goodHit.object : null;
    if (hitTarget && hitTarget.userData._mapAction) isMapUITarget = true;
```

- [ ] **Step 2: Update the gaze-completion branch in `updateGaze()` to dispatch by `_mapAction`**

Find the existing gaze-completion line:

```js
      if (gazeTimer >= GAZE_DWELL) {
        handleHotspotClick(hitTarget.userData);
        gazeTarget = null;
        gazeTimer = 0;
        gazeGrace = 0;
        gazeCooldown = GAZE_COOLDOWN;
        gazeFillMesh.visible = false;
      }
```

Replace with:

```js
      const dwell = (hitTarget.userData && hitTarget.userData._gazeDwell) || GAZE_DWELL;
      if (gazeTimer >= dwell) {
        if (hitTarget.userData && hitTarget.userData._mapAction) {
          switch (hitTarget.userData._mapAction) {
            case 'activate': activateVRMinimap(); break;
            case 'close': deactivateVRMinimap(); break;
            case 'floorPrev': switchVRMapFloor(-1); break;
            case 'floorNext': switchVRMapFloor(+1); break;
          }
        } else {
          handleHotspotClick(hitTarget.userData);
        }
        gazeTarget = null;
        gazeTimer = 0;
        gazeGrace = 0;
        gazeCooldown = GAZE_COOLDOWN;
        gazeFillMesh.visible = false;
      }
```

- [ ] **Step 3: Add visual hover feedback for floor + close buttons**

Find the block that sets up the gazeFillMesh position (just before the gaze-completion code). It currently always uses hotspot world transforms. For map UI targets, the gazeFillMesh should sit on the button face. Locate the block:

```js
    if (hitTarget) {
      // Hotspots live inside vrHotspotGroup (rotated by scene yaw) — use world transforms so the fill plane lands on the hotspot
      const hsWorldPos = hitTarget.getWorldPosition(new THREE.Vector3());
      const hsWorldQuat = hitTarget.getWorldQuaternion(new THREE.Quaternion());
      gazeFillMesh.position.copy(hsWorldPos);
      gazeFillMesh.quaternion.copy(hsWorldQuat);
      // Push slightly toward camera so the fill sits in front of the hotspot
      const toCamera = camPos.clone().sub(hsWorldPos).normalize();
      gazeFillMesh.position.add(toCamera.multiplyScalar(0.3));
      gazeFillMesh.visible = true;
```

Replace the `if (hitTarget) { ... gazeFillMesh.visible = true;` opening (just those first lines) with:

```js
    if (hitTarget) {
      const hsWorldPos = hitTarget.getWorldPosition(new THREE.Vector3());
      const hsWorldQuat = hitTarget.getWorldQuaternion(new THREE.Quaternion());
      gazeFillMesh.position.copy(hsWorldPos);
      gazeFillMesh.quaternion.copy(hsWorldQuat);
      // Push slightly toward camera so the fill sits in front of the target
      const toCamera = camPos.clone().sub(hsWorldPos).normalize();
      // Map UI elements are flat planes sized in meters; hotspots are larger and farther — use smaller offset for UI
      const fillOffset = isMapUITarget ? 0.05 : 0.3;
      gazeFillMesh.position.add(toCamera.multiplyScalar(fillOffset));
      gazeFillMesh.visible = true;

      // Apply button-hover visual state (re-draw canvas) when newly targeted, clear it when target changes
      if (hitTarget !== gazeTarget) {
        // Clear previous map-UI hover state if any
        if (gazeTarget && gazeTarget.userData && gazeTarget.userData._mapAction) {
          if (gazeTarget === vrMinimapFloorPrev) setFloorButtonHover('prev', false);
          else if (gazeTarget === vrMinimapFloorNext) setFloorButtonHover('next', false);
          else if (gazeTarget === vrMinimapCloseBtn) setCloseButtonHover(false);
        }
        // Apply new hover state
        if (hitTarget === vrMinimapFloorPrev) setFloorButtonHover('prev', true);
        else if (hitTarget === vrMinimapFloorNext) setFloorButtonHover('next', true);
        else if (hitTarget === vrMinimapCloseBtn) setCloseButtonHover(true);
      }
```

- [ ] **Step 4: Clear hover state when target is lost**

Find the `else { gazeTarget = null; gazeTimer = 0; gazeGrace = 0; gazeFillMesh.visible = false; }` block at the end of `updateGaze()`. Replace with:

```js
    } else {
      // Lost target — clear any active hover visual on map UI
      if (gazeTarget && gazeTarget.userData && gazeTarget.userData._mapAction) {
        if (gazeTarget === vrMinimapFloorPrev) setFloorButtonHover('prev', false);
        else if (gazeTarget === vrMinimapFloorNext) setFloorButtonHover('next', false);
        else if (gazeTarget === vrMinimapCloseBtn) setCloseButtonHover(false);
      }
      gazeTarget = null;
      gazeTimer = 0;
      gazeGrace = 0;
      gazeFillMesh.visible = false;
```

Also update the `gazeCooldown > 0` early-return block — when cooldown is active and clears `gazeTarget`, also clear hover:

Find:

```js
    if (gazeCooldown > 0) {
      gazeCooldown -= dt;
      gazeFillMesh.visible = false;
      gazeTarget = null;
      gazeTimer = 0;
      reticleMat.opacity = 0.4;
      reticleMat.color.set(0xffffff);
      return;
    }
```

Replace with:

```js
    if (gazeCooldown > 0) {
      gazeCooldown -= dt;
      gazeFillMesh.visible = false;
      if (gazeTarget && gazeTarget.userData && gazeTarget.userData._mapAction) {
        if (gazeTarget === vrMinimapFloorPrev) setFloorButtonHover('prev', false);
        else if (gazeTarget === vrMinimapFloorNext) setFloorButtonHover('next', false);
        else if (gazeTarget === vrMinimapCloseBtn) setCloseButtonHover(false);
      }
      gazeTarget = null;
      gazeTimer = 0;
      reticleMat.opacity = 0.4;
      reticleMat.color.set(0xffffff);
      return;
    }
```

---

## Task 10: Extend `onVRSelect` (controller trigger) to handle map UI

**Files:**
- Modify: `vr-tour-editor.html` — the existing `onVRSelect` function (or `function onSelect()` — find by its `select`/`selectstart` event registration)

- [ ] **Step 1: Find the function**

Search for the existing controller-trigger handler. Anchor: the block that contains `if (vrMinimapActive) { if (!mapDidDrag) { const mapHits = raycaster.intersectObject(vrMinimapMesh);`. The enclosing function is the trigger handler.

- [ ] **Step 2: Insert map-UI handling at the top of the function**

Use Edit to replace:

```js
    // Check close button first
    if (vrPanelGroup.visible && vrPanelCloseMesh) {
      const panelHits = raycaster.intersectObject(vrPanelCloseMesh);
      if (panelHits.length > 0) { hideVRPanel(); return; }
      const fullPanelHits = raycaster.intersectObjects(vrPanelGroup.children);
      if (fullPanelHits.length > 0) { hideVRPanel(); return; }
    }
```

with:

```js
    // Check close button first (VR info panel)
    if (vrPanelGroup.visible && vrPanelCloseMesh) {
      const panelHits = raycaster.intersectObject(vrPanelCloseMesh);
      if (panelHits.length > 0) { hideVRPanel(); return; }
      const fullPanelHits = raycaster.intersectObjects(vrPanelGroup.children);
      if (fullPanelHits.length > 0) { hideVRPanel(); return; }
    }

    // Check map UI elements (icon, close, floor buttons) before hotspots / map plane navigation
    const mapUITargets = [];
    if (vrMinimapActive) {
      mapUITargets.push(vrMinimapCloseBtn);
      if (TOUR.floors && TOUR.floors.length > 1) {
        mapUITargets.push(vrMinimapFloorPrev, vrMinimapFloorNext);
      }
    } else if (vrMinimapIcon.visible) {
      mapUITargets.push(vrMinimapIcon);
    }
    if (mapUITargets.length > 0) {
      const uiHits = raycaster.intersectObjects(mapUITargets);
      if (uiHits.length > 0) {
        const action = uiHits[0].object.userData._mapAction;
        if (action === 'activate') activateVRMinimap();
        else if (action === 'close') deactivateVRMinimap();
        else if (action === 'floorPrev') switchVRMapFloor(-1);
        else if (action === 'floorNext') switchVRMapFloor(+1);
        return;
      }
    }
```

- [ ] **Step 3: Remove the old "No hotspot hit — check floating minimap" block**

Find:

```js
    // No hotspot hit — check floating minimap (to activate it)
    if (vrMinimapMesh.visible) {
      const mapHits = raycaster.intersectObject(vrMinimapMesh);
      if (mapHits.length > 0) {
        activateVRMinimap();
      }
    }
```

Replace with (empty — the icon handles activation now):

```js
    // (Floating minimap removed — activation handled by the bottom-middle icon above)
```

---

## Task 11: Show the icon when entering VR

**Files:**
- Modify: `vr-tour-editor.html` — the WebXR session-start block (anchor: `renderer.xr.setSession(session);`)

- [ ] **Step 1: Reposition icon when VR session starts**

Find:

```js
            renderer.xr.setSession(session);
            // Mark session start time — gaze + auto-audio are suppressed for VR_INITIAL_GRACE seconds so the first frame can paint
            vrSessionStartTime = performance.now();
```

Replace with:

```js
            renderer.xr.setSession(session);
            // Mark session start time — gaze + auto-audio are suppressed for VR_INITIAL_GRACE seconds so the first frame can paint
            vrSessionStartTime = performance.now();
            // Reposition the bottom-middle map icon for the new VR session (deferred one frame to let camera settle)
            setTimeout(function() {
              if (renderer.xr.isPresenting) {
                vrMinimapIcon.visible = !vrMinimapHidden;
                repositionMapIcon();
              }
            }, 200);
```

- [ ] **Step 2: Hide icon when VR ends**

Find the existing session-end handler:

```js
            session.addEventListener('end', () => {
              btn.textContent = 'Enter VR';
              btn.style.background = '#ff7a00';
              vrSessionStartTime = 0;
            });
```

Replace with:

```js
            session.addEventListener('end', () => {
              btn.textContent = 'Enter VR';
              btn.style.background = '#ff7a00';
              vrSessionStartTime = 0;
              // Hide all VR map UI when leaving VR
              vrMinimapIcon.visible = false;
              vrMinimapFloorPrev.visible = false;
              vrMinimapFloorNext.visible = false;
              vrMinimapCloseBtn.visible = false;
              vrMinimapMesh.visible = false;
              vrMinimapActive = false;
            });
```

---

## Task 12: Reposition icon on scene change

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function goToScene(sceneId) { ... }`

- [ ] **Step 1: Add icon reposition at the end of goToScene**

Find the existing `function goToScene(sceneId) {` block. At the very end of the function, just before the closing `}`, add:

```js
    // If we're in VR and the icon is visible, recenter it under the new view
    if (renderer.xr.isPresenting && vrMinimapIcon.visible) {
      repositionMapIcon();
    }
```

(Use a unique anchor near the end of `goToScene` — the line that calls `drawMinimap()` or `drawVRMinimap()` or the final `}` of the function — to position this insert. If the function ends with `drawVRMinimap();` use that as your old_string anchor.)

---

## Task 13: Update `onGrip` so grip toggles icon visibility (not the old small-mode plane)

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function onGrip() { ... }`

- [ ] **Step 1: Replace the function**

Find:

```js
  function onGrip() {
    if (vrMinimapActive) {
      // Only exit if map has been open for at least 300ms (prevent accidental close)
      if (performance.now() - mapActivatedAt > 300) {
        deactivateVRMinimap();
      }
    } else {
      vrMinimapHidden = !vrMinimapHidden;
    }
  }
```

Replace with:

```js
  function onGrip() {
    if (vrMinimapActive) {
      // Only exit if map has been open for at least 300ms (prevent accidental close)
      if (performance.now() - mapActivatedAt > 300) {
        deactivateVRMinimap();
      }
    } else {
      vrMinimapHidden = !vrMinimapHidden;
      // Icon visibility tracks vrMinimapHidden — animate-loop will reposition on next visible frame
      vrMinimapIcon.visible = !vrMinimapHidden && renderer.xr.isPresenting;
      if (vrMinimapIcon.visible) repositionMapIcon();
    }
  }
```

---

## Task 14: Handle floor-arrow click suppression in `handleVRMinimapClick`

**Files:**
- Modify: `vr-tour-editor.html` — the existing `function handleVRMinimapClick(uv) { ... }`

**Goal:** Remove the canvas-header-arrow click detection (since arrows are now 3D meshes handled in `onVRSelect`). Keep only the scene-node navigation logic.

- [ ] **Step 1: Replace the function**

Find the existing `function handleVRMinimapClick(uv) {` block and replace the entire function with:

```js
  function handleVRMinimapClick(uv) {
    const W = vrMinimapCanvas.width, H = vrMinimapCanvas.height;
    let mx = uv.x * W;
    let my = (1 - uv.y) * H;

    // Reverse the zoom/pan transform to get original canvas coordinates
    if (mapZoom > 1) {
      mx = (mx - W / 2 - mapPanX) / mapZoom + W / 2;
      my = (my - H / 2 - mapPanY) / mapZoom + H / 2;
    }
    const pad = Math.max(40, W * 0.04);
    const clickFloorId = (vrMinimapActive && mapViewFloorId) ? mapViewFloorId : getCurrentFloorId();
    const positions = getScenePositions(W, H, pad, clickFloorId);
    const floorScenes = getScenesForFloor(clickFloorId);
    let closest = null;
    let closestDist = Infinity;
    for (const s of floorScenes) {
      if (s.id === currentSceneId) continue;
      const p = positions[s.id];
      if (!p) continue;
      const dist = Math.sqrt((mx - p.x) ** 2 + (my - p.y) ** 2);
      if (dist < closestDist) { closestDist = dist; closest = s; }
    }
    const nodeScale = Math.max(1, W / 220);
    const hitRadius = 28 * nodeScale; // hit radius for the new editor-matched node sizes
    if (closest && closestDist < hitRadius) {
      goToScene(closest.id);
      drawVRMinimap();
      return true;
    }
    return false;
  }
```

---

## Task 15: Verify no broken references remain

**Files:**
- Read: `vr-tour-editor.html`

- [ ] **Step 1: Confirm `updateVRMinimapPosition` is fully gone**

Use Grep:

```
Grep pattern="updateVRMinimapPosition" path="vr-tour-editor.html"
```

Expected: 0 matches.

- [ ] **Step 2: Confirm `getSmallPlaneSize` is fully gone**

```
Grep pattern="getSmallPlaneSize" path="vr-tour-editor.html"
```

Expected: 0 matches.

- [ ] **Step 3: Confirm all new identifiers exist exactly once at definition**

```
Grep pattern="const vrMinimapIcon = " path="vr-tour-editor.html"
Grep pattern="const vrMinimapFloorPrev = " path="vr-tour-editor.html"
Grep pattern="const vrMinimapFloorNext = " path="vr-tour-editor.html"
Grep pattern="const vrMinimapCloseBtn = " path="vr-tour-editor.html"
Grep pattern="function repositionMapIcon" path="vr-tour-editor.html"
Grep pattern="function repositionFloorButtons" path="vr-tour-editor.html"
Grep pattern="function repositionCloseButton" path="vr-tour-editor.html"
Grep pattern="const floorImageCache = " path="vr-tour-editor.html"
```

Expected: each returns 1 match.

- [ ] **Step 4: Confirm `vrMinimapHidden` and `vrMinimapActive` are still defined**

```
Grep pattern="let vrMinimapHidden" path="vr-tour-editor.html"
Grep pattern="let vrMinimapActive" path="vr-tour-editor.html"
```

Expected: 1 match each.

- [ ] **Step 5: Sanity-check the template literal is still well-formed**

```
Grep pattern="^</html>\`" path="vr-tour-editor.html" -n=true
```

Expected: 1 match near the original line 4200 (the closing backtick of the template literal).

---

## Task 16: Manual VR verification on Quest 3 + final commit

**Files:**
- None (testing + commit)

- [ ] **Step 1: Start the local HTTPS server**

```
node serve.js
```

Quest 3 should be on the same Wi-Fi. Visit `https://<host-ip>:8443/vr-tour-editor.html` from the Quest browser.

- [ ] **Step 2: Open an existing project with multiple floors and floor plan images**

Use Open Project or the Recent list. Confirm the flat editor minimap still works (sanity check that nothing broke outside VR).

- [ ] **Step 3: Click "Enter VR" — verify the icon**

Expected:
- Bottom-middle of view shows the orange/black map-pin icon
- Icon does NOT move when you turn your head
- Look at the icon — gaze fill animates over ~1.5s — map enlarges
- Press grip — icon hides; press grip again — icon reappears at bottom-middle

- [ ] **Step 4: Inside the enlarged map — verify floor buttons**

Expected:
- Two large buttons flank the map (only if 2+ floors exist)
- Buttons look like editor's floor buttons (black bg, orange border, orange ◀ ▶ glyph)
- Gaze at a button — turns orange/white, dwell 1.2s — floor switches WITHOUT freeze
- Switch back and forth several times rapidly — no freeze, no stale image

- [ ] **Step 5: Inside the enlarged map — verify close button**

Expected:
- Small circular ✕ button at top-right corner of the map
- Gaze at it — fills, 1.8s — map closes, icon reappears below

- [ ] **Step 6: Inside the enlarged map — verify GUI matches editor**

Compare side-by-side with the editor's enlarged flat minimap (open the editor in a desktop browser tab):
- Node sizes match (current ≈ same size, others ≈ same size)
- Connection lines same color/width
- Current scene label has orange border; hovered label has cyan border (both with dark bg)
- Floor name banner top-left: orange text on dark bg with orange border
- No `◀ ▶` text glyphs inside the canvas anymore

- [ ] **Step 7: Verify hotspot scaling under zoom**

In VR with the map active:
- Push thumbstick forward/back to zoom — hotspots shrink proportionally to the visible area
- At 1x zoom, hotspots match the editor flat-map size
- At max zoom (6x), hotspots are noticeably smaller but still hittable

- [ ] **Step 8: Verify icon repositions on scene change**

- Click a scene node on the map (or close map and use a hotspot in VR)
- Confirm the icon respawns at the new bottom-middle position after the scene change

- [ ] **Step 9: Verify controller trigger still works**

- Pull trigger while gazing at the icon — instant activation
- Pull trigger on a floor button — instant switch
- Pull trigger on close button — instant close
- Pull trigger on a scene node in the active map — navigates to that scene

- [ ] **Step 10: Single combined commit**

If all manual checks pass:

```
git add vr-tour-editor.html docs/superpowers/plans/2026-05-26-vr-map-improvements.md
git commit -m "$(cat <<'EOF'
Ship VR map improvements: bottom-middle icon, 3D floor buttons, editor-matching GUI

5 fixes shipped together:
1. Replace head-locked small minimap with fixed bottom-middle 3D icon
   (gaze-targetable; never moves; repositions on VR start / scene
   change / map close)
2. Replace canvas-drawn floor arrows with separate 3D button meshes
   matching editor's .minimap-floor-btn style (gaze 1.2s or trigger)
3. Add 3D close button matching editor's #minimap-close style
   (gaze 1.8s or trigger)
4. Match VR enlarged-map GUI to editor's flat minimap: node radii
   16/12, nodeScale=max(1,W/220), editor label styles, banner header
5. Pre-decode floor plan images at tour load — switchVRMapFloor and
   deactivateVRMinimap are now synchronous (fixes floor-switch freeze)

Spec: docs/superpowers/specs/2026-05-26-vr-map-improvements-design.md
Plan: docs/superpowers/plans/2026-05-26-vr-map-improvements.md

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 11: Push to GitHub**

```
git push origin main
```

(Only after user explicitly confirms — pushing to a public repo affects shared state. Do not push without confirmation.)

---

## Self-review notes

Spec coverage:
- Problem 1 (floating minimap moves away on gaze) → Tasks 5, 6, 8, 11, 12, 13
- Problem 2 (floor arrows in canvas) → Tasks 4, 6, 9, 10, 14
- Problem 3 (GUI doesn't match editor) → Task 4, plus button textures in Task 5
- Problem 4 (hotspots too big at start) → Task 4 (nodeScale + radii change)
- Problem 5 (floor switch freeze) → Tasks 1, 2, 3

Risks (from spec) addressed:
- Gaze target ordering: handled via mutually exclusive target lists in Task 9 step 1 (icon only added when map is collapsed; floor/close only when active)
- Map-button depth fighting: same `renderOrder` family, depthTest off — already covered in Task 6 material setup
- Floor image preload cost: data URLs decode fast; lazy-load fallback already present (cache miss → dark box) — Task 2 step 1
