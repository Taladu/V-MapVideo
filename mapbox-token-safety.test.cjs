const fs = require('fs');
const path = require('path');
const assert = require('assert');

const tokenPattern = /\b(?:pk|sk)\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/;
const textExtensions = new Set(['.css', '.cjs', '.html', '.js', '.json', '.md', '.txt', '.yml', '.yaml']);

function walk(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        if (entry.name === '.git') return [];
        const target = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
    });
}

const leaks = walk('.').filter(file => {
    if (!textExtensions.has(path.extname(file).toLowerCase())) return false;
    return tokenPattern.test(fs.readFileSync(file, 'utf8'));
});
assert.deepEqual(leaks, [], `Mapbox token found in tracked source: ${leaks.join(', ')}`);

const ignored = fs.readFileSync('.gitignore', 'utf8');
assert(/^mapbox-token\.js$/m.test(ignored), 'mapbox-token.js must stay ignored');

const index = fs.readFileSync('index.html', 'utf8');
assert(index.includes('<script src="mapbox-token-runtime.js?v=29c"></script>'), 'index must load safe runtime token setup');
assert(!index.includes('<script src="mapbox-token.js"></script>'), 'downloaded build must not depend on a missing local token file');
assert(index.indexOf('mapbox-token-runtime.js') < index.indexOf('script.js?v='), 'runtime token setup must load before script.js');

const runtime = fs.readFileSync('mapbox-token-runtime.js', 'utf8');
assert(runtime.includes('localStorage'), 'runtime setup must store token locally in the browser');
assert(runtime.includes('vmap_mapbox_public_token_v1'), 'runtime setup must use the expected isolated storage key');
assert(runtime.includes('showSetup'), 'runtime setup must provide first-run configuration UI');

const app = fs.readFileSync('script.js', 'utf8');
assert(app.includes('window.VMAP_MAPBOX_TOKEN'), 'app must read the runtime token');
assert(app.includes('if (!initMap()) return;'), 'app must stop cleanly when token config is missing');

const gpsTest = fs.readFileSync('gps-route-test.html', 'utf8');
assert(gpsTest.includes('mapbox-token-runtime.js?v=29c'), 'GPS test must use the same safe runtime token setup');

console.log('PASS Mapbox token stays out of GitHub and downloaded V29 can self-configure on first run');
