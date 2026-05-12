/**
 * Renders /gravel/og.html at 1200x630 and writes the result to
 * /img/gravel-og.png. Run from the repo root:
 *
 *   node scripts/build-gravel-og.mjs
 *
 * Uses Playwright via the mallet-app workspace (already a dev dep there).
 * The local server only needs to be up while this runs — we hit it on
 * 127.0.0.1:8767 by default; override via OG_PORT if that's taken.
 */
import { chromium } from '/home/amar/proj/code/artanis/home-page/mallet-app/node_modules/playwright/index.mjs'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const port = Number(process.env.OG_PORT || 8767)
const url = `http://127.0.0.1:${port}/gravel/og.html`
const out = join(root, 'img', 'gravel-og.png')

async function withServer(fn) {
  const server = spawn('python3', ['-m', 'http.server', String(port)], {
    cwd: root,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  // Give it a beat to bind.
  await new Promise((res) => setTimeout(res, 350))
  try {
    return await fn()
  } finally {
    server.kill('SIGTERM')
  }
}

await withServer(async () => {
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'networkidle' })
    // Belt-and-braces wait for webfonts to actually paint.
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: out, type: 'png', omitBackground: false })
  } finally {
    await browser.close()
  }
})
console.log('wrote', out)
