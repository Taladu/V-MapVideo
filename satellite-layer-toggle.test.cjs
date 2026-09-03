const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('satellite-layer-toggle.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');
const gpsRouteTest = fs.readFileSync('gps-route-test.html', 'utf8');

assert(!/\bmap\s*\.\s*setStyle\s*\(/.test(source), 'Satellite toggle must never replace the map style');
assert(!/\bmap\s*\.\s*removeLayer\s*\(/.test(source), 'Satellite toggle must never remove existing layers');
assert(!/\bmap\s*\.\s*removeSource\s*\(/.test(source), 'Satellite toggle must never remove existing sources');

const glVersion = '3.29.0';
assert(index.includes(`mapbox-gl-js/v${glVersion}/mapbox-gl.css`), 'index must use Mapbox GL JS 3.29.0 CSS');
assert(index.includes(`mapbox-gl-js/v${glVersion}/mapbox-gl.js`), 'index must use Mapbox GL JS 3.29.0 JS');
assert(gpsRouteTest.includes(`mapbox-gl-js/v${glVersion}/mapbox-gl.css`), 'GPS test must use the same Mapbox GL JS version');
assert(gpsRouteTest.includes(`mapbox-gl-js/v${glVersion}/mapbox-gl.js`), 'GPS test JS must match the app version');
assert(index.includes('mapbox-gl-directions/v4.1.1/mapbox-gl-directions.js'), 'Directions plugin version must stay unchanged');

function makeButton() {
    const listeners = {};
    const attrs = {};
    const classes = new Set();
    return {
        disabled: true,
        title: '',
        addEventListener(type, handler) { (listeners[type] ??= []).push(handler); },
        click() { for (const handler of listeners.click || []) handler(); },
        setAttribute(name, value) { attrs[name] = String(value); },
        classList: {
            toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }
        },
        attrs,
        classes
    };
}

function makeMap(style) {
    const handlers = {};
    const sources = {};
    const layers = {};
    const calls = [];
    const config = {
        show3dObjects: true,
        show3dBuildings: true,
        show3dTrees: true,
        show3dLandmarks: true,
        show3dFacades: true,
        showPointOfInterestLabels: true,
        showTransitLabels: true,
        showPlaceLabels: true,
        showRoadLabels: true
    };
    const paint = {};

    for (const layer of style.layers || []) {
        layers[layer.id] = { ...layer };
        if (layer.id === '3d-buildings') {
            paint[layer.id] = { 'fill-extrusion-opacity': 1 };
        }
    }

    let styleLoaded = false;
    return {
        calls,
        sources,
        layers,
        config,
        paint,
        on(type, handler) { (handlers[type] ??= []).push(handler); },
        once(type, handler) { (handlers[type] ??= []).push(handler); },
        emit(type) { for (const handler of handlers[type] || []) handler(); },
        isStyleLoaded() { return styleLoaded; },
        isSourceLoaded(id) { return Boolean(sources[id]); },
        markStyleLoaded() { styleLoaded = true; },
        getStyle() { return style; },
        getSource(id) { return sources[id]; },
        addSource(id, definition) {
            sources[id] = definition;
            calls.push(['addSource', id, definition]);
        },
        getLayer(id) { return layers[id]; },
        addLayer(definition, beforeId) {
            layers[definition.id] = definition;
            paint[definition.id] = { ...(definition.paint || {}) };
            calls.push(['addLayer', definition, beforeId]);
        },
        setLayoutProperty(id, property, value) {
            layers[id] ??= { id };
            layers[id].layout ??= {};
            layers[id].layout[property] = value;
            calls.push(['setLayoutProperty', id, property, value]);
        },
        getConfigProperty(importId, property) {
            assert.equal(importId, 'basemap');
            return config[property];
        },
        setConfigProperty(importId, property, value) {
            assert.equal(importId, 'basemap');
            config[property] = value;
            calls.push(['setConfigProperty', importId, property, value]);
        },
        getPaintProperty(id, property) {
            return paint[id]?.[property];
        },
        setPaintProperty(id, property, value) {
            paint[id] ??= {};
            paint[id][property] = value;
            calls.push(['setPaintProperty', id, property, value]);
        }
    };
}

function boot(map) {
    const satelliteButton = makeButton();
    const threeDButton = makeButton();
    const windowListeners = {};
    const context = {
        console,
        Object,
        document: {
            getElementById(id) {
                if (id === 'toggleSatelliteBtn') return satelliteButton;
                if (id === 'toggle3DBtn') return threeDButton;
                return null;
            }
        },
        setTimeout() { return 1; },
        clearTimeout() {},
        window: {
            mapboxgl: { version: '3.29.0' },
            addEventListener(type, handler) { windowListeners[type] = handler; }
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    windowListeners['vmap:runtime-ready']({ detail: { map } });
    return { satelliteButton, threeDButton, context };
}

// Standard/import style: raster stays visible at tiny opacity to preload tiles.
{
    const map = makeMap({
        imports: [{ id: 'basemap' }],
        layers: [
            { id: '3d-buildings', type: 'fill-extrusion' },
            { id: 'vmap-gps-video-line', type: 'line' },
            { id: 'vmap-gps-video-hit', type: 'line' },
            { id: 'directions-route-line', type: 'line' },
            { id: 'unclustered-point', type: 'symbol' }
        ]
    });
    const { satelliteButton, context } = boot(map);
    assert.equal(satelliteButton.disabled, false);

    map.markStyleLoaded();
    map.emit('style.load');

    const sat = map.layers['vmap-satellite-layer'];
    assert.equal(map.sources['vmap-satellite-source'].url, 'mapbox://mapbox.satellite');
    assert.equal(sat.slot, 'middle');
    assert.equal(sat.layout.visibility, 'visible', 'satellite layer must never be visibility:none');
    assert.equal(map.paint['vmap-satellite-layer']['raster-opacity'], 0.0001, 'normal mode must keep a tiny preload opacity');

    satelliteButton.click();
    assert.equal(context.window.VMAP_SATELLITE_LAYER.isEnabled(), true);
    assert.equal(satelliteButton.attrs['aria-pressed'], 'true');
    assert(satelliteButton.classes.has('is-active'));
    assert.equal(map.paint['vmap-satellite-layer']['raster-opacity'], 1);

    for (const key of [
        'show3dObjects',
        'show3dBuildings',
        'show3dTrees',
        'show3dLandmarks',
        'show3dFacades',
        'showPointOfInterestLabels',
        'showTransitLabels',
        'showPlaceLabels'
    ]) {
        assert.equal(map.config[key], false, `${key} must be disabled in satellite mode`);
    }
    assert.equal(map.config.showRoadLabels, true, 'road labels remain unchanged');
    assert.equal(map.paint['3d-buildings']['fill-extrusion-opacity'], 0);

    assert(
        !map.calls.some(call =>
            call[0] === 'setLayoutProperty' &&
            ['vmap-gps-video-line','vmap-gps-video-hit','directions-route-line','unclustered-point'].includes(call[1])
        ),
        'V-Map GPS/route/POI layers must never have visibility changed'
    );
    assert(
        !map.calls.some(call =>
            call[0] === 'setPaintProperty' &&
            ['vmap-gps-video-line','vmap-gps-video-hit','directions-route-line','unclustered-point'].includes(call[1])
        ),
        'V-Map GPS/route/POI paint must never be changed'
    );

    satelliteButton.click();
    assert.equal(context.window.VMAP_SATELLITE_LAYER.isEnabled(), false);
    assert.equal(map.paint['vmap-satellite-layer']['raster-opacity'], 0.0001);

    for (const key of [
        'show3dObjects',
        'show3dBuildings',
        'show3dTrees',
        'show3dLandmarks',
        'show3dFacades',
        'showPointOfInterestLabels',
        'showTransitLabels',
        'showPlaceLabels',
        'showRoadLabels'
    ]) {
        assert.equal(map.config[key], true, `${key} must restore after leaving satellite mode`);
    }
    assert.equal(map.paint['3d-buildings']['fill-extrusion-opacity'], 1);
}

// Legacy/custom style remains supported without Standard config calls.
{
    const map = makeMap({
        imports: [],
        layers: [
            { id: 'land', type: 'fill' },
            { id: 'road-label', type: 'symbol', layout: { 'text-field': ['get', 'name'] } }
        ]
    });
    map.markStyleLoaded();
    boot(map);
    const addLayerCall = map.calls.find(call => call[0] === 'addLayer');
    assert.equal(addLayerCall[2], 'road-label');
    assert.equal(addLayerCall[1].slot, undefined);
    assert(!map.calls.some(call => call[0] === 'setConfigProperty'));
}

console.log('PASS V29.3: GL 3.29, warm satellite preload, reversible 3D/label cleanup, core overlays untouched');
