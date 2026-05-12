# VR Tour App - Changelog

## How to revert to a previous version
```bash
# List all tagged milestones
git tag -l

# View what a tag contains
git log --oneline v0.8-map-controls

# Revert to a milestone (creates a new branch so you don't lose current work)
git checkout -b revert-to-v08 v0.8-map-controls

# Or just view a file at that point without switching
git show v0.8-map-controls:vr-tour-editor.html > editor-v08.html
```

---

## v0.9-map-final (2026-05-11) `f763654`
**Map navigation finalized - single click with jitter dead zone**
- Single trigger click on scene node to navigate (no double-click or gaze)
- 30px drag dead zone prevents hand jitter from triggering false drags
- handleVRMinimapClick accounts for zoom/pan transform (click works when zoomed)
- Scene nodes are orange (`rgba(255,160,50)`) not blue-gray
- Only nav-type hotspot dots shown on map (orange, no blue info/teal media)
- Marker sizes: 0.8x at default zoom, `1.2/zoom` scaling (bigger at full zoom than before)
- Pan speed 6.0 multiplier (was 7.5)
- Pan limits: `W*(zoom-1)/2` allows reaching all edges
- Cache-busting meta headers added

## v0.8-map-controls (2026-05-11) `b2625a8`
**Stable map zoom/pan/markers**
- Thumbstick zoom (axes[3]), range 1x-6x
- Trigger hold + controller move = pan
- Grip = exit enlarged map
- Markers scale down with zoom: `1/(zoom*zoom)`
- Pan clamping to prevent drift
- Zoom preserves pan position proportionally

## v0.7-hires-map (2026-05-11) `fd2c4fd`
**High-resolution VR floor plan with zoom/pan**
- PDF rendered at ~4000px on longest side (scale up to 8x)
- Canvas sized to match floor plan image (up to 4096px)
- Image onload rebuilds geometry with actual aspect ratio
- Enlarged map: 7m wide plane, positioned 3.5m in front of viewer
- Mini HUD: proportional to actual floor plan aspect ratio

## v0.6-floor-wall (2026-05-11) `6f9a172`
**Floor/Wall hotspot placement**
- Hotspots have `placement: 'wall'|'floor'` property
- Floor hotspots tilted 70deg toward ground (`rotateX(PI*0.38)`)
- Floor hotspots have colored ring halo for visibility
- Export includes placement field

## v0.5-gaze-hotspots (2026-05-10) `dda30b4`
**Gaze-based hotspot selection**
- Clockwise pie fill animation on gaze (transparent to opaque)
- Pie fill matches hotspot appearance (color, icon, texture)
- Smaller gaze rings, narrower hit area
- Squeeze button toggles minimap visibility

## v0.4-quest-input (2026-05-10) `6744750`
**Quest flat-mode input**
- Device orientation for head-look in flat browser mode
- Mouse/touch drag fallbacks
- touch-action none on body+canvas
- Stable gaze: bigger hit area, grace period, slower dwell

## v0.3-pdf-floorplan (2026-05-10) `3c765df`
**PDF floor plan support**
- Upload PDF as floor plan image using PDF.js
- Renders first page to canvas

## v0.2-minimap (2026-05-10) `d454466`
**Interactive VR minimap**
- Laser click to enlarge map
- Click scene nodes to navigate between rooms
- Laser pointer dot shows hit point

## v0.1-initial (2026-05-10) `ff57dea`
**Initial release**
- VR Tour Editor: upload 360 panoramas, place hotspots, link rooms
- VR Tour Viewer: Three.js + WebXR, Enter VR button, 360 viewing
- Single HTML file architecture, no build step
- Export standalone VR tour HTML files
