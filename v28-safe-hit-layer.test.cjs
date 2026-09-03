const fs=require('fs'),assert=require('assert');
const overlay=fs.readFileSync('gps-route-overlay.js','utf8');
const script=fs.readFileSync('script.js','utf8');
const index=fs.readFileSync('index.html','utf8');

assert(overlay.includes("id:HIT_ID,type:'line',source:SOURCE_ID"),'20px GPS hit layer missing');
assert(overlay.includes("'line-width':20,'line-opacity':0"),'GPS hit layer must be transparent and wide');
assert(script.includes("const getRouteHitAtPoint = (point) =>"),'separate click-query bridge missing');
assert(script.includes("const gpsLayerIds = ['vmap-gps-video-hit', 'vmap-gps-video-line']"),'GPS hit layers missing');
assert(script.includes("renderedRouteCoords = hit.directionsFeature?.geometry?.type === 'LineString'"),'local rendered geometry must be passed explicitly');
assert(script.includes("[[point.x - 6, point.y - 6], [point.x + 6, point.y + 6]]"),'6px Directions fallback box missing');
assert(!script.includes("overlay.handleMapClick({ ...e, routeCoords })"),'old ambiguous routeCoords click contract must not return');
assert(index.includes('script.js?v=29s')&&index.includes('gps-route-overlay.js?v=28e')&&index.includes('gps-video-library.js?v=28e'),'runtime cache bust missing');
console.log('PASS V28 Safe hit-layer and rendered-local click contract');
