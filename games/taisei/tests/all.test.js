// Single-process test entrypoint keeps the zero-dependency suite usable in
// restricted Windows environments that disallow test-runner child processes.

import './auth.test.js';
import './saves.test.js';
import './static.test.js';
import './upstream.test.js';
