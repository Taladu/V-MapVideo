const fs = require('fs');
const assert = require('assert');

const app = fs.readFileSync('script.js', 'utf8');

const forbidden = [
  '<h3>${place.name}</h3>',
  'alt="Video thumbnail for ${place.name}"',
  'categoryTitle.innerHTML = `${category} <span>▶</span>`;',
  '<h4>${place.name}</h4>'
];

for (const pattern of forbidden) {
  assert(!app.includes(pattern), 'Unsafe POI HTML interpolation found: ' + pattern);
}

const required = [
  '<h3>${escapeHtml(place.name)}</h3>',
  'alt="Video thumbnail for ${escapeHtml(place.name)}"',
  'categoryTitle.innerHTML = `${escapeHtml(category)} <span>▶</span>`;',
  '<h4>${escapeHtml(place.name)}</h4>'
];

for (const pattern of required) {
  assert(app.includes(pattern), 'Expected escaped POI interpolation missing: ' + pattern);
}

assert(/function\s+escapeHtml\s*\(/.test(app), 'escapeHtml helper must remain present');

console.log('PASS V29.3 POI XSS hardening: HTML sinks escape place/category text');
