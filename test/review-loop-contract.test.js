'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const readLib = (name) => fs.readFileSync(path.join(__dirname, '..', 'lib', name), 'utf8');

describe('review-loop parse contracts', () => {
  it('requires structured local-agent verdicts without weakening Codex handling', () => {
    const body = readLib('local-agent-review-loop.md');
    assert.match(body, /after stripping blank lines, the result must be either exactly `NO FINDINGS`/);
    assert.match(body, /Treat a missing, malformed, or contradictory result .* `STATUS=cli-error`/);
    assert.match(body, /For `codex`, retain its native severity-tagged output handling/);
    assert.doesNotMatch(body, /If the log contains `NO FINDINGS` \(or no actionable findings/);
  });

  it('treats malformed Ollama output as a coverage gap rather than an empty review', () => {
    const body = readLib('ollama-review-loop.md');
    assert.match(body, /PARSE_ERRORS=0/);
    assert.match(body, /is a \*\*parse error\*\*, not a clean file/);
    assert.match(body, /`STATUS=incomplete`, never `clean`/);
    assert.match(body, /REVIEW_ERRORS \+ PARSE_ERRORS == REVIEWABLE/);
    assert.doesNotMatch(body, /Treat a section that fails to parse .* as no findings/);
  });
});
