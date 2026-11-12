import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // PGlite spins up a WASM Postgres per store instance; the 5s default
    // testTimeout is too tight on slower machines, so widen it package-wide.
    // Fast in-memory tests are unaffected.
    testTimeout: 60000,
  },
});
