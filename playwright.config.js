import { defineConfig } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fakeAudio = join(here, 'e2e', 'fixtures', 'voice.wav');
// 8080 (serve.mjs default) is often taken by other local tools; E2E uses its own port.
const PORT = Number(process.env.E2E_PORT) || 8173;
// BASE_URL (e.g. the published site) runs the suite against it instead of a local server.
// Specs navigate with relative paths, so a base URL with a path works; keep a trailing slash.
const REMOTE = process.env.BASE_URL ? process.env.BASE_URL.replace(/\/?$/, '/') : null;

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.js',
  timeout: 60_000,
  // the first fake-mic open in a fresh browser can be slow
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: REMOTE || `http://localhost:${PORT}/`,
    browserName: 'chromium',
    permissions: ['microphone'],
    viewport: { width: 390, height: 844 },
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${fakeAudio}`,
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  ...(REMOTE ? {} : {
    webServer: {
      command: 'node scripts/serve.mjs',
      url: `http://localhost:${PORT}/`,
      env: { PORT: String(PORT) },
      reuseExistingServer: false,
    },
  }),
});
