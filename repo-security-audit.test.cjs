const fs = require('fs');
const path = require('path');
const assert = require('assert');

const textExt = new Set(['.js','.cjs','.mjs','.html','.css','.json','.md','.txt','.yml','.yaml']);
const bannedNames = [/^\.env(?:\..+)?$/i, /^id_rsa$/i, /\.pem$/i, /\.key$/i, /\.p12$/i, /\.pfx$/i];
const secretPatterns = [
  { name: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'mapbox-token', re: /\b(?:pk|sk)\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/ }
];

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name === '.git') return [];
    const target = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(target) : [target];
  });
}

const files = walk('.');
const banned = files.filter(f => bannedNames.some(re => re.test(path.basename(f))));
assert.deepEqual(banned, [], 'Sensitive credential-like files must not be tracked: ' + banned.join(', '));

const leaks = [];
for (const file of files) {
  if (!textExt.has(path.extname(file).toLowerCase())) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const { name, re } of secretPatterns) {
    if (re.test(content)) leaks.push(name + ':' + file);
  }
}
assert.deepEqual(leaks, [], 'Potential credential leak(s): ' + leaks.join(', '));

console.log('PASS repository security audit: no tracked credential files or known secret patterns');
