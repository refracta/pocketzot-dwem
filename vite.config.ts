import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/pocketzot-dwem/',
  build: {
    sourcemap: false,
  },
  test: {
    environmentOptions: {
      happyDOM: {
        settings: {
          // The tile path (exercised by monster-list.test.ts) lazily appends
          // <script src=…/tileinfo-*.js> to load AMD tileinfo modules. happy-dom
          // can't execute external scripts and otherwise logs a noisy
          // DOMException per attempt. Treat the disabled load as a silent no-op
          // (fires a 'load' event instead of console.error'ing): the tile
          // painters already no-op without real atlas/module loads, and those
          // tests only assert DOM row structure.
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
  },
})
