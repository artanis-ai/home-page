/**
 * Builds the static "Monthly Updates" newsletter archive from the Buttondown
 * export in /updates/_src (emails.json + one HTML body per slug). Run from
 * the repo root after editing anything in _src:
 *
 *   node scripts/build-updates.mjs
 *
 * Writes /updates/index.html, /updates/<slug>/index.html, /updates/feed.json
 * and /updates/rss.xml. Slugs are the original Buttondown archive slugs, so
 * buttondown.com/artanis/archive/<slug>/ maps 1:1 to artanis.ai/updates/<slug>/.
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

function longDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
}

const head = (title, description, path) => `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)} - Artanis AI</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${site}${path}">
    <meta property="og:type" content="article">
    <meta property="og:url" content="${site}${path}">
    <meta property="og:title" content="${escapeHtml(title)} - Artanis AI">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${site}/img/og-image.png">
    <meta property="og:site_name" content="Artanis AI">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)} - Artanis AI">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${site}/img/og-image.png">
    <link rel="alternate" type="application/rss+xml" title="Artanis Monthly Updates" href="/updates/rss.xml">
    <link rel="icon" href="/img/favicon.ico" sizes="any">
    <link rel="icon" type="image/svg+xml" href="/img/favicon.svg">
    <link rel="icon" type="image/png" sizes="96x96" href="/img/favicon-96x96.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/img/apple-touch-icon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                fontSize: {
                    xs: ['0.75rem', { lineHeight: '1rem' }],
                    sm: ['0.875rem', { lineHeight: '1.5rem' }],
                    base: ['1rem', { lineHeight: '1.75rem' }],
                    lg: ['1.125rem', { lineHeight: '2rem' }],
                    xl: ['1.25rem', { lineHeight: '2rem' }],
                    '2xl': ['1.5rem', { lineHeight: '2rem' }],
                    '3xl': ['2rem', { lineHeight: '2.5rem' }],
                    '4xl': ['2.5rem', { lineHeight: '3.5rem' }],
                    '5xl': ['3rem', { lineHeight: '3.5rem' }],
                    '6xl': ['3.75rem', { lineHeight: '1' }],
                    '7xl': ['4.5rem', { lineHeight: '1.1' }],
                    '8xl': ['6rem', { lineHeight: '1' }],
                    '9xl': ['8rem', { lineHeight: '1' }],
                },
                extend: {
                    borderRadius: { '4xl': '2rem' },
                    fontFamily: {
                        sans: ['DM Sans', 'sans-serif'],
                        display: ['Fredoka', 'sans-serif'],
                    },
                    colors: {
                        primary: '#9B4340',
                        'primary-light': '#C4716A',
                        'primary-dark': '#7A3835',
                        accent: '#D4A76A',
                        'accent-light': '#F0D9A8',
                        'earth-dark': '#4E3222',
                        earth: '#6B4226',
                        'earth-light': '#8B5E3C',
                        'earth-warm': '#7A5238',
                        forest: '#4A7C59',
                        'forest-light': '#6BA37A',
                        cream: '#FFFBF5',
                        warm: '#F5EDE3',
                        'text-dark': '#2D1810',
                        'text-mid': '#6B5744',
                        'text-muted': '#9A8B7A',
                    },
                },
            },
        }
    </script>
    <style>
        .update-body { color: #2D1810; font-size: 1.0625rem; line-height: 1.75; }
        .update-body p, .update-body ul, .update-body ol { margin: 1.1em 0; }
        .update-body ul { list-style: disc; padding-left: 1.5rem; }
        .update-body ol { list-style: decimal; padding-left: 1.5rem; }
        .update-body li > p { margin: 0.25em 0; }
        .update-body a { color: #9B4340; text-decoration: underline; text-underline-offset: 2px; }
        .update-body a:hover { color: #C4716A; }
        .update-body img { max-width: 100%; height: auto; border-radius: 1rem; margin: 1.5em auto; display: block; }
        .update-body h1, .update-body h2, .update-body h3 { font-weight: 600; margin: 1.5em 0 0.5em; }
        .update-body blockquote { border-left: 3px solid #D4A76A; padding-left: 1rem; color: #6B5744; }
        .update-body hr { border: 0; border-top: 1px solid #F5EDE3; margin: 2em 0; }
    </style>
</head>
<body class="bg-cream antialiased">

    <header class="sticky top-0 z-50 bg-cream/95 backdrop-blur-sm border-b border-warm">
        <nav class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
            <div class="flex items-center md:gap-x-12">
                <a href="/" aria-label="Home">
                    <img src="/img/artanis.png" alt="Artanis" class="h-10 w-auto">
                </a>
                <div class="hidden md:flex md:gap-x-6">
                    <a href="/blog" class="inline-block rounded-lg px-2 py-1 text-sm text-text-mid hover:bg-warm hover:text-text-dark">Blog</a>
                    <a href="/updates/" class="inline-block rounded-lg px-2 py-1 text-sm text-text-mid hover:bg-warm hover:text-text-dark">Updates</a>
                    <a href="/team" class="inline-block rounded-lg px-2 py-1 text-sm text-text-mid hover:bg-warm hover:text-text-dark">Team</a>
                </div>
            </div>
            <button type="button" class="-mr-1 md:hidden" aria-label="Toggle Navigation" onclick="document.getElementById('mobile-menu').classList.toggle('hidden')">
                <svg aria-hidden="true" class="h-3.5 w-3.5 overflow-visible stroke-text-dark" fill="none" stroke-width="2" stroke-linecap="round">
                    <path d="M0 1H14M0 7H14M0 13H14"></path>
                </svg>
            </button>
        </nav>
        <div id="mobile-menu" class="hidden mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 md:hidden pb-4">
            <div class="rounded-2xl bg-white p-4 text-lg tracking-tight text-text-dark shadow-xl ring-1 ring-earth-dark/5">
                <a href="/blog" class="block w-full p-2">Blog</a>
                <a href="/updates/" class="block w-full p-2">Updates</a>
                <a href="/team" class="block w-full p-2">Team</a>
            </div>
        </div>
    </header>
`

const footer = `
    <footer style="background: #0f0a05;">
        <div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div class="flex flex-col items-center py-10 sm:flex-row sm:justify-between">
                <p class="text-sm text-warm/50">
                    &copy; 2026 Artanis Ltd. All rights reserved.
                </p>
                <div class="mt-6 flex gap-x-6 text-sm sm:mt-0">
                    <a href="/terms" class="text-warm/50 hover:text-warm transition-colors">Terms</a>
                    <a href="/privacy" class="text-warm/50 hover:text-warm transition-colors">Privacy</a>
                    <a href="/dpa" class="text-warm/50 hover:text-warm transition-colors">DPA</a>
                </div>
            </div>
        </div>
    </footer>
</body>
</html>
`

// Clear previously generated issue dirs so removed slugs don't linger.
for (const entry of readdirSync(outDir, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== '_src') rmSync(join(outDir, entry.name), { recursive: true })
}

const items = emails.map((e) => {
  const raw = readFileSync(join(srcDir, `${e.slug}.html`), 'utf8')
  const body = rewriteBody(raw)
  return {
    title: e.subject,
    slug: e.slug,
    link: `${site}/updates/${e.slug}/`,
    pubDate: new Date(e.publish_date).toISOString(),
    summary: summary(body),
    body,
  }
})

for (let i = 0; i < items.length; i++) {
  const it = items[i]
  const newer = items[i - 1]
  const older = items[i + 1]
  const nav = `
            <nav class="mt-16 flex justify-between gap-6 text-sm font-semibold text-primary border-t border-warm pt-8">
                <span class="min-w-0">${older ? `<a href="/updates/${older.slug}/" class="hover:text-primary-light">&larr; ${escapeHtml(older.title)}</a>` : ''}</span>
                <span class="min-w-0 text-right">${newer ? `<a href="/updates/${newer.slug}/" class="hover:text-primary-light">${escapeHtml(newer.title)} &rarr;</a>` : ''}</span>
            </nav>`
  const page = `${head(it.title, it.summary, `/updates/${it.slug}/`)}
    <main class="bg-warm py-16 sm:py-24">
        <article class="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
            <p class="text-sm font-semibold text-primary"><a href="/updates/" class="hover:text-primary-light">&larr; All monthly updates</a></p>
            <h1 class="mt-6 font-display text-3xl font-semibold tracking-tight text-text-dark sm:text-4xl">${escapeHtml(it.title)}</h1>
            <p class="mt-3 text-sm text-text-muted"><time datetime="${it.pubDate}">${longDate(it.pubDate)}</time></p>
            <div class="update-body mt-10 rounded-2xl bg-cream p-6 sm:p-10 shadow-xl shadow-earth/10">
${it.body}
            </div>${nav}
        </article>
    </main>
${footer}`
  mkdirSync(join(outDir, it.slug), { recursive: true })
  writeFileSync(join(outDir, it.slug, 'index.html'), page)
}

const list = items
  .map(
    (it) => `
                <li>
                    <a href="/updates/${it.slug}/" class="block rounded-2xl bg-cream p-5 shadow-xl shadow-earth/10 hover:shadow-earth/20 hover:border-primary-light border border-transparent transition-all group">
                        <h2 class="text-base font-semibold text-text-dark group-hover:text-primary transition-colors">${escapeHtml(it.title)}</h2>
                        <p class="mt-1 text-sm text-text-mid">${escapeHtml(it.summary)}</p>
                        <p class="mt-2 text-xs text-text-muted"><time datetime="${it.pubDate}">${longDate(it.pubDate)}</time></p>
                    </a>
                </li>`,
  )
  .join('')

const indexDescription = `Every Artanis monthly update, ${longDate(items[items.length - 1].pubDate)} to ${longDate(items[0].pubDate)}.`
writeFileSync(
  join(outDir, 'index.html'),
  `${head('Monthly Updates', indexDescription, '/updates/')}
    <main class="bg-warm py-16 sm:py-24">
        <div class="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
            <h1 class="font-display text-3xl font-semibold tracking-tight text-text-dark sm:text-4xl">Monthly Updates</h1>
            <p class="mt-4 text-lg tracking-tight text-text-mid">${escapeHtml(indexDescription)} <a href="/updates/rss.xml" class="font-semibold text-primary hover:text-primary-light">RSS</a></p>
            <ul class="mt-12 space-y-4">${list}
            </ul>
        </div>
    </main>
${footer}`,
)

writeFileSync(
  join(outDir, 'feed.json'),
  JSON.stringify(
    { title: 'Artanis Monthly Updates', link: `${site}/updates/`, items: items.map(({ title, link, pubDate, summary }) => ({ title, link, pubDate, summary })) },
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
      <guid isPermaLink="true">${it.link}</guid>
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
    <link>${site}/updates/</link>
    <atom:link href="${site}/updates/rss.xml" rel="self" type="application/rss+xml"/>
    <description>Monthly updates from the Artanis team, May 2024 to June 2026.</description>
    <language>en</language>
    <lastBuildDate>${new Date(items[0].pubDate).toUTCString()}</lastBuildDate>${rssItems}
  </channel>
</rss>
`,
)

console.log(`built ${items.length} updates -> ${outDir}`)
