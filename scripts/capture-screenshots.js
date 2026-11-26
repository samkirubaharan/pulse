#!/usr/bin/env node
// Captures Pulse dashboard screenshots to docs/ via puppeteer-core + system Chrome.
//
// Run after `pnpm --filter @pulse/dashboard dev` is up on port 3000
// and a `POST /api/dev/seed` has populated the smoke data.

const path = require('node:path');
const fs = require('node:fs');
const puppeteer = require('puppeteer-core');

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  process.env.LOCALAPPDATA &&
    path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
].filter(Boolean);

function findChrome() {
  for (const p of CHROME_PATHS) if (fs.existsSync(p)) return p;
  throw new Error('Chrome not found');
}

const PAGES = [
  { file: 'screenshot-observe.png', url: 'http://localhost:3100/', wait: 3500 },
  { file: 'screenshot-alerts.png', url: 'http://localhost:3100/alerts', wait: 2500 },
  { file: 'screenshot-debug.png', url: 'http://localhost:3100/debug', wait: 2500 },
  { file: 'screenshot-verify.png', url: 'http://localhost:3100/verify', wait: 2500 },
  {
    file: 'screenshot-flow-drift.png',
    url: 'http://localhost:3100/?flow=drift',
    wait: 3500,
  },
];

async function run() {
  const outDir = path.join(__dirname, '..', 'docs');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 2 },
  });
  try {
    for (const p of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({
        width: 1600,
        height: 1000,
        deviceScaleFactor: 2,
      });
      console.log(`→ ${p.url}`);
      await page.goto(p.url, { waitUntil: 'networkidle2', timeout: 15000 });
      await new Promise((r) => setTimeout(r, p.wait));
      const target = path.join(outDir, p.file);
      await page.screenshot({ path: target, fullPage: true });
      console.log(`   saved ${target}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
