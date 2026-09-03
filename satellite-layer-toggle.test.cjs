const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('satellite-layer-toggle.js', 'utf8');
assert(!/\bmap\s*\.\s*setStyle\s*\(/.test(source), 'Satellite toggle must never replace the map style');
assert(!/\bmap\s*\.\s*removeLayer\s*\(/.test(source), 'Satellite toggle must never remove existing layers');
assert(!/\bmap\s*\.\s*removeSource\s*\(/.test(source), 'Satellite toggle must never remove existing sources');

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
        emit(type) { for (const handler of handlers[type] || []) handler(); },
        isStyleLoaded() { return styleLoaded; },
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
            calls.push(['addLayer', definition, beforeId]);
        },
        setLayoutProperty(id, property, value) {
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
            addEventListener(type, handler) { windowListeners[type] = handler; }
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    windowListeners['vmap:runtime-ready']({ detail: { map } });
    return { satelliteButton, threeDButton, context };
}

// Mapbox Standard/import style: satellite uses middle slot and cleans only basemap clutter.
{
    const map = makeMap({
        imports: [{ id: 'basemap' }],
        layers: [
            { id: '3d-buildings', type: 'fill-extrusion' },
            { id: 'vmap-gps-video-line', type: 'line' },
            { id: 'places-source-layer', type: 'symbol' }
        ]
    });
    const { satelliteButton, context } = boot(map);
    assert.equal(satelliteButton.disabled, false, 'button remains clickable while style finishes');

    map.markStyleLoaded();
    map.emit('style.load');

    assert.equal(map.sources['vmap-satellite-source'].url, 'mapbox://mapbox.satellite');
    assert.equal(map.layers['vmap-satellite-layer'].slot, 'middle');
    assert.equal(map.layers['vmap-satellite-layer'].layout.visibility, 'none');

    satelliteButton.click();
    assert.equal(context.window.VMAP_SATELLITE_LAYER.isEnabled(), true);
    assert.equal(satelliteButton.attrs['aria-pressed'], 'true');
    assert(satelliteButton.classes.has('is-active'));

    assert.equal(map.config.show3dObjects, false);
    assert.equal(map.config.showPointOfInterestLabels, false);
    assert.equal(map.config.showTransitLabels, false);
    assert.equal(map.config.showPlaceLabels, false);
    assert.equal(map.config.showRoadLabels, true, 'road labels remain unchanged');
    assert.equal(map.paint['3d-buildings']['fill-extrusion-opacity'], 0);

    assert(
        map.calls.some(call =>
            call[0] === 'setLayoutProperty' &&
            call[1] === 'vmap-satellite-layer' &&
            call[3] === 'visible'
        ),
        'satellite raster must become visible'
    );
    assert(
        !map.calls.some(call =>
            call[0] === 'setLayoutProperty' &&
            call[1] !== 'vmap-satellite-layer'
        ),
        'GPS-video and other V-Map layers must never have visibility changed'
    );

    satelliteButton.click();
    assert.equal(context.window.VMAP_SATELLITE_LAYER.isEnabled(), false);
    assert.equal(map.config.show3dObjects, true);
    assert.equal(map.config.showPointOfInterestLabels, true);
    assert.equal(map.config.showTransitLabels, true);
    assert.equal(map.config.showPlaceLabels, true);
    assert.equal(map.config.showRoadLabels, true);
    assert.equal(map.paint['3d-buildings']['fill-extrusion-opacity'], 1);
}

// Legacy/custom style: imagery stays below the first text label; no Standard config mutation.
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

console.log('PASS V29.2 clean satellite: reversible 3D/label cleanup, GPS-video untouched');
