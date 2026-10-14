import { defineConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

// Si el proyecto incluye navegadores locales (.cache/pw) se usan esos;
// si no, se respeta PLAYWRIGHT_BROWSERS_PATH o la caché por defecto.
// En un equipo normal basta con `npx playwright install chromium`.
const localBrowsers = path.join(process.cwd(), '.cache', 'pw');
if (fs.existsSync(localBrowsers)) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers;
}

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5198',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npx vite preview --port 5198',
    url: 'http://localhost:5198',
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
