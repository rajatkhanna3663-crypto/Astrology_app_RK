import { createRequire } from 'node:module';
const loaded = createRequire(import.meta.url)('../vendor/astronomy.browser.min.js');
if (!globalThis.Astronomy || !globalThis.Astronomy.MakeTime) globalThis.Astronomy = loaded;
