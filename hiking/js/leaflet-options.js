// Read by Leaflet as it loads. On screens whose pixel ratio isn't a whole number (e.g. 2.625
// on many Android phones), 3D-positioned map tiles leave faint lines between them, so there
// Leaflet positions tiles without 3D transforms; the cost is that zooming jumps to the new
// level instead of animating. On whole-number ratios (1, 2, 3) Leaflet works as normal.
window.L_DISABLE_3D = !Number.isInteger(window.devicePixelRatio || 1);
