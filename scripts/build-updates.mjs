/**
 * Builds the static "Monthly Updates" newsletter archive from the Buttondown
 * export in /updates/_src (emails.json + one HTML body per slug). Run from
 * the repo root after editing anything in _src:
 *
 *   node scripts/build-updates.mjs
 *
 * Writes /updates/feed.json (list for the homepage), one body fragment per
 * issue at /updates/<slug>.html (loaded into the homepage modal on click), and
 * /updates/rss.xml. Slugs are the original Buttondown archive slugs; issues
 * deep-link as artanis.ai/#update-<slug>.
 *
 * Bodies are Buttondown's raw editor output: HTML for "fancy" mode, markdown
 * for "plaintext" mode (only #8). Markdown bodies are converted with pandoc.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const srcDir = join(root, 'updates', '_src')
const outDir = join(root, 'updates')
const site = 'https://artanis.ai'

const emails = JSON.parse(readFileSync(join(srcDir, 'emails.json'), 'utf8'))
  .filter((e) => e.email_type === 'public' && e.publish_date)
  .sort((a, b) => new Date(b.publish_date) - new Date(a.publish_date))

function rewriteBody(raw) {
  const mode = raw.match(/<!--\s*buttondown-editor-mode:\s*(\w+)/)?.[1]
  const html = mode === 'plaintext'
    ? execFileSync('pandoc', ['-f', 'gfm', '-t', 'html', '--wrap=none'], { input: raw.replace(/<!--[^>]*-->/, ''), encoding: 'utf8' })
    : raw
  return html
    .replace(/<!--\s*buttondown-editor-mode:[^>]*-->/g, '')
    .replace(/https:\/\/assets\.buttondown\.email\/images\/([0-9a-f-]+\.png)(\?[^"'\s)]*)?/g, '/img/updates/$1')
    .replace(/https:\/\/buttondown\.com\/artanis\/?(?=["'\s)])/g, '/updates/')
    .trim()
}

function stripTags(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function summary(html, max = 200) {
  const text = stripTags(html)
  return text.length > max ? text.slice(0, max).trimEnd() + '...' : text
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeXml(s) {
  return escapeHtml(s).replace(/'/g, '&apos;')
}


// Clear previously generated fragments so removed slugs don't linger.
for (const entry of readdirSync(outDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== '_src') rmSync(join(outDir, entry.name), { recursive: true })
  if (entry.isFile() && entry.name.endsWith('.html')) rmSync(join(outDir, entry.name))
}

const items = emails.map((e) => {
  const body = rewriteBody(readFileSync(join(srcDir, `${e.slug}.html`), 'utf8'))
  return {
    title: e.subject,
    slug: e.slug,
    link: `${site}/#update-${e.slug}`,
    pubDate: new Date(e.publish_date).toISOString(),
    summary: summary(body),
    body,
  }
})

for (const it of items) writeFileSync(join(outDir, `${it.slug}.html`), it.body + '\n')

writeFileSync(
  join(outDir, 'feed.json'),
  JSON.stringify(
    { title: 'Artanis Monthly Updates', link: `${site}/updates/`, items: items.map(({ title, slug, link, pubDate, summary }) => ({ title, slug, link, pubDate, summary })) },
    null,
    2,
  ) + '\n',
)

const rssItems = items
  .map(
    (it) => `
    <item>
      <title>${escapeXml(it.title)}</title>
      <link>${it.link}</link>
      <guid isPermaLink="false">${site}/updates/${it.slug}</guid>
      <pubDate>${new Date(it.pubDate).toUTCString()}</pubDate>
      <description>${escapeXml(it.summary)}</description>
      <content:encoded><![CDATA[${it.body.replace(/(src|href)="\/(img|updates)\//g, `$1="${site}/$2/`)}]]></content:encoded>
    </item>`,
  )
  .join('')

writeFileSync(
  join(outDir, 'rss.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Artanis Monthly Updates</title>
    <link>${site}/#blog</link>
    <atom:link href="${site}/updates/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Monthly updates from the Artanis team, May 2024 to June 2026.</description>
    <language>en</language>
    <lastBuildDate>${new Date(items[0].pubDate).toUTCString()}</lastBuildDate>${rssItems}
  </channel>
</rss>
`,
)

console.log(`built ${items.length} updates -> ${outDir}`)
