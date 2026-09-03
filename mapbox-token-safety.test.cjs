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
assert(index.includes('<script src="mapbox-token.js"></script>'), 'index must load the local token config');
assert(index.indexOf('mapbox-token.js') < index.indexOf('script.js?v='), 'token config must load before script.js');

const app = fs.readFileSync('script.js', 'utf8');
assert(app.includes('window.VMAP_MAPBOX_TOKEN'), 'app must read the runtime token');
assert(app.includes('if (!initMap()) return;'), 'app must stop cleanly when token config is missing');

console.log('PASS Mapbox token is externalized and excluded from GitHub source');
