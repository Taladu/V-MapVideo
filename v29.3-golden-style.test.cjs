const fs = require('fs');
const assert = require('assert');

const EXPECTED_STYLE = 'mapbox://styles/taladu/cml928jj3004c01s95ns59gwa';
const EXPECTED_GL_VERSION = '3.29.0';
const EXPECTED_DIRECTIONS_VERSION = '4.1.1';

const app = fs.readFileSync('script.js', 'utf8');
const index = fs.readFileSync('index.html', 'utf8');

const styleRefs = [...app.matchAll(/style\s*:\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
assert(
  styleRefs.includes(EXPECTED_STYLE),
  `Golden V-Map style changed or missing. Expected: ${EXPECTED_STYLE}`
);
assert.equal(
  styleRefs.filter(x => x.startsWith('mapbox://styles/')).length,
  1,
  'V-Map core must have exactly one Mapbox style URI'
);
assert(
  !styleRefs.some(x => /^mapbox:\/\/styles\/mapbox\//.test(x)),
  'Do not fall back to a generic Mapbox style in V29.3 Golden'
);

assert(
  index.includes(`mapbox-gl-js/v${EXPECTED_GL_VERSION}/mapbox-gl.css`) &&
  index.includes(`mapbox-gl-js/v${EXPECTED_GL_VERSION}/mapbox-gl.js`),
  'Golden Mapbox GL JS version changed'
);
assert(
  index.includes(`mapbox-gl-directions/v${EXPECTED_DIRECTIONS_VERSION}/mapbox-gl-directions.js`),
  'Golden Mapbox Directions version changed'
);

console.log('PASS V29.3 Golden presentation lock:', EXPECTED_STYLE);
