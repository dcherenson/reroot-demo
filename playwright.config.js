import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/budget-planning/browser',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4180', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure' },
  projects: [{name:'chromium',use:{browserName:'chromium',launchOptions:{args:process.platform==='darwin'?['--use-angle=metal']:[]}}},{name:'firefox',use:{browserName:'firefox'}},{name:'webkit',use:{browserName:'webkit'}}],
  webServer: {command:'npm run serve',url:'http://127.0.0.1:4180',reuseExistingServer:true},
});
