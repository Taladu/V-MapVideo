const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const source = fs.readFileSync('script.js', 'utf8');
const start = source.indexOf('function setupExactDirectionsReverse()');
const end = source.indexOf('function setupUserLocation()', start);
assert(start >= 0 && end > start, 'Không tìm thấy logic đảo A/B');

const functionSource = source.slice(start, end);
const listeners = {};
const button = {
    dataset: {},
    addEventListener(type, listener, capture) {
        listeners[type] = { listener, capture };
    }
};
const container = { classList: { add() {} } };
const document = {
    querySelector(selector) {
        assert.equal(selector, '.js-reverse-inputs');
        return button;
    },
    getElementById(id) {
        assert.equal(id, 'directions-container');
        return container;
    }
};

const origin = [106.84173, 10.84560];
const destination = [106.6985, 10.7797];
const events = {};
const calls = [];
const feature = coordinates => ({ geometry: { coordinates } });
const directions = {
    on(type, listener) { events[type] = listener; },
    getOrigin() { return feature(origin); },
    getDestination() { return feature(destination); },
    setOrigin(coords) { calls.push(['origin', coords.slice()]); },
    setDestination(coords) { calls.push(['destination', coords.slice()]); }
};

const context = {
    document,
    directions,
    MutationObserver: class {},
    exactDirectionsEndpoints: { origin: null, destination: null },
    directionsLocationRequestSeq: 0,
    isValidLngLat(coords) {
        return Array.isArray(coords) && Number.isFinite(coords[0]) && Number.isFinite(coords[1]);
    }
};
vm.createContext(context);
vm.runInContext(`${functionSource}; setupExactDirectionsReverse();`, context);

assert.equal(button.dataset.vmapExactReverse, '1');
assert.equal(listeners.click.capture, true, 'Phải chặn trước handler gốc của Mapbox');

const stopped = [];
listeners.click.listener({
    preventDefault() { stopped.push('preventDefault'); },
    stopPropagation() { stopped.push('stopPropagation'); },
    stopImmediatePropagation() { stopped.push('stopImmediatePropagation'); }
});

assert.deepStrictEqual(JSON.parse(JSON.stringify(calls)), [
    ['origin', destination],
    ['destination', origin]
]);
assert.deepStrictEqual(stopped, [
    'preventDefault',
    'stopPropagation',
    'stopImmediatePropagation'
]);
assert.equal(context.directionsLocationRequestSeq, 1);
console.log('PASS exact A/B reverse preserves coordinates and blocks native re-geocode');
