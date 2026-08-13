'use strict';
// Repository invariants.
//
// These were CI jobs until the workflow was removed. They are assertions about the
// repo's shape rather than about a function's behaviour, but they belong somewhere
// that actually runs — `npm test` is that place now. Each one guards a bug that
// already shipped once.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

describe('manifests', () => {
  test('the version lives in exactly one file', () => {
    assert.equal(exists('plugin.json'), false, 'root plugin.json is back — version now lives in two files');
    assert.equal(exists('marketplace.json'), false, 'root marketplace.json is back');
    assert.equal(exists('.claude-plugin/plugin.json'), true);
  });

  test('version is semver', () => {
    const v = JSON.parse(read('.claude-plugin/plugin.json')).version;
    assert.match(v, /^\d+\.\d+\.\d+$/);
  });

  test('plugin.json and marketplace.json agree on name and description', () => {
    const p = JSON.parse(read('.claude-plugin/plugin.json'));
    const m = JSON.parse(read('.claude-plugin/marketplace.json')).plugins[0];
    assert.equal(p.name, m.name);
    assert.equal(p.description, m.description);
  });

  test('category stays out of plugin.json — the validator warns it is ignored there', () => {
    assert.equal(JSON.parse(read('.claude-plugin/plugin.json')).category, undefined);
    assert.ok(JSON.parse(read('.claude-plugin/marketplace.json')).plugins[0].category);
  });
});

describe('documentation keeps up with the code', () => {
  test('the current version has a CHANGELOG entry', () => {
    const v = JSON.parse(read('.claude-plugin/plugin.json')).version;
    assert.ok(read('CHANGELOG.md').includes('## [' + v + ']'),
      'CHANGELOG.md has no entry for ' + v + ' — bump and entry must land together');
  });

  test('a security disclosure channel is documented', () => {
    assert.ok(read('SECURITY.md').includes('security/advisories'));
  });

  test('README links to files that exist', () => {
    for (const m of read('README.md').matchAll(/\]\((?!https?:)([A-Za-z0-9_./-]+\.md)\)/g)) {
      assert.equal(exists(m[1]), true, 'README links to missing ' + m[1]);
    }
  });
});

describe('hook registration', () => {
  // Up to 1.3.1 the hooks were declared in hooks.json AND copied into
  // ~/.claude/settings.json by setupHooks(). Both fired: the banner and the per-turn
  // additionalContext were injected twice on every turn.
  test('hooks.json registers each event exactly once', () => {
    const hooks = JSON.parse(read('hooks/hooks.json')).hooks;
    for (const event of ['SessionStart', 'UserPromptSubmit']) {
      const n = (hooks[event] || []).flatMap(g => g.hooks || []).length;
      assert.equal(n, 1, event + ' has ' + n + ' hooks, expected 1');
    }
  });

  test('setupHooks does not come back', () => {
    assert.equal(/function setupHooks/.test(read('src/hooks/critica-activate.js')), false,
      'setupHooks double-registers against hooks/hooks.json');
  });
});

describe('the badge stays opt-in', () => {
  // Installing writes to ~/.claude/settings.json and appends to a script the user owns.
  // SessionStart must never do that on its own.
  const src = read('src/hooks/critica-activate.js');

  for (const banned of ['badge.install', 'setupStatusline', 'injectIntoBadgeAggregator']) {
    test('critica-activate.js does not call ' + banned, () => {
      assert.equal(src.includes(banned), false, banned + ' in the activation hook makes the badge automatic again');
    });
  }

  test('the refresh-only path survives', () => {
    assert.ok(src.includes('refreshIfInstalled'), 'without it an installed badge goes stale across upgrades');
  });

  test('a badge skill exists for the user to invoke', () => {
    assert.equal(exists('skills/badge/SKILL.md'), true);
  });
});

describe('skills', () => {
  test('every skill directory has a SKILL.md with frontmatter', () => {
    for (const name of fs.readdirSync(path.join(ROOT, 'skills'))) {
      const file = path.join('skills', name, 'SKILL.md');
      assert.equal(exists(file), true, file + ' is missing');
      assert.ok(read(file).startsWith('---\n'), file + ' has no frontmatter');
    }
  });
});
