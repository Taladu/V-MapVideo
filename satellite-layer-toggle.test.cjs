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
        addEventListener(type, handler) { listeners[type] = handler; },
        click() { listeners.click?.(); },
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
    let styleLoaded = false;
    return {
        calls,
        sources,
        layers,
        on(type, handler) { (handlers[type] ??= []).push(handler); },
        emit(type) { for (const handler of handlers[type] || []) handler(); },
        isStyleLoaded() { return styleLoaded; },
        markStyleLoaded() { styleLoaded = true; },
        getStyle() { return style; },
        getSource(id) { return sources[id]; },
        addSource(id, definition) { sources[id] = definition; calls.push(['addSource', id, definition]); },
        getLayer(id) { return layers[id]; },
        addLayer(definition, beforeId) { layers[definition.id] = definition; calls.push(['addLayer', definition, beforeId]); },
        setLayoutProperty(id, property, value) { calls.push(['setLayoutProperty', id, property, value]); }
    };
}

function boot(map) {
    const button = makeButton();
    const windowListeners = {};
    const context = {
        console,
        document: { getElementById: id => id === 'toggleSatelliteBtn' ? button : null },
        setTimeout(handler) { return 1; },
        clearTimeout() {},
        window: {
            addEventListener(type, handler) { windowListeners[type] = handler; }
        }
    };
    vm.createContext(context);
    vm.runInContext(source, context);
    windowListeners['vmap:runtime-ready']({ detail: { map } });
    return { button, context };
}

// Mapbox Standard/import style: use the stable bottom slot.
{
    const map = makeMap({ imports: [{ id: 'basemap' }], layers: [] });
    const { button, context } = boot(map);
    assert.equal(button.disabled, false, 'button remains clickable while the style finishes');
    map.markStyleLoaded();
    map.emit('style.load');
    assert.equal(button.disabled, false, 'button must enable after safe layer install');
    assert.equal(map.sources['vmap-satellite-source'].url, 'mapbox://mapbox.satellite');
    assert.equal(map.layers['vmap-satellite-layer'].slot, 'middle');
    assert.equal(map.layers['vmap-satellite-layer'].layout.visibility, 'none');

    button.click();
    assert.equal(context.window.VMAP_SATELLITE_LAYER.isEnabled(), true);
    assert.equal(button.attrs['aria-pressed'], 'true');
    assert(button.classes.has('is-active'));
    assert.deepEqual(map.calls.at(-1), ['setLayoutProperty', 'vmap-satellite-layer', 'visibility', 'visible']);

    button.click();
    assert.equal(context.window.VMAP_SATELLITE_LAYER.isEnabled(), false);
    assert.deepEqual(map.calls.at(-1), ['setLayoutProperty', 'vmap-satellite-layer', 'visibility', 'none']);
}

// Legacy/custom style: place imagery immediately below the first text-label layer.
{
    const map = makeMap({ imports: [], layers: [
        { id: 'land', type: 'fill' },
        { id: 'road-label', type: 'symbol', layout: { 'text-field': ['get', 'name'] } }
    ] });
    map.markStyleLoaded();
    boot(map);
    const addLayerCall = map.calls.find(call => call[0] === 'addLayer');
    assert.equal(addLayerCall[2], 'road-label');
    assert.equal(addLayerCall[1].slot, undefined);
}

console.log('PASS V29.1 satellite layer: no style reload, visible Standard slot, retry-safe toggle');
