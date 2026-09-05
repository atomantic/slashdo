'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');

// Inspect the complete reachable contract without requiring production renderers
// to eagerly load it. Preserve directives so tests can also inspect routing.
function readCommandDocs(name, { eager = false } = {}) {
  const seen = new Set();
  function visit(file) {
    if (seen.has(file)) return '';
    seen.add(file);
    const body = fs.readFileSync(path.join(root, file), 'utf8');
    return body.replace(/^!read (lib\/[\w.-]+\.md)$|!`cat ~\/\.claude\/lib\/([\w.-]+\.md)`/gm,
      (directive, required, included) => {
        if (!required && !eager) return directive;
        return `${directive}\n${visit(required || `lib/${included}`)}`;
      });
  }
  return visit(`commands/do/${name}`);
}

module.exports = { readCommandDocs };
