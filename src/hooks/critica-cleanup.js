#!/usr/bin/env node
// critique — SessionEnd hook: the last chance to win the migration race.
//
// Versions up to 1.3.1 re-add their settings.json entries from both of their hooks, so a
// cleanup at session start is undone by the legacy tracker on the very next prompt. This
// runs after the last prompt of the session, when nothing else will write those entries
// again until the next session start — and by then they are gone, so the legacy hooks
// never run again.
//
// Removed together with cleanupLegacyHooks in 1.6.0.

const { cleanupLegacyHooks } = require('./critica-activate.js');

if (require.main === module) {
  cleanupLegacyHooks();
}

module.exports = { cleanupLegacyHooks };
