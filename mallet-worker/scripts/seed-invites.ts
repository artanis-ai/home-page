/**
 * Seed the INVITES KV namespace from a CSV of cold-email recipients.
 *
 * Usage:
 *   npx tsx scripts/seed-invites.ts <input.csv> <output.csv> [--env production] [--campaign <name>]
 *
 * Input CSV (header required, comma-separated):
 *   email,name,company
 *   alice@example.com,Alice,Acme
 *
 * Output CSV (appended with the assigned slug + link):
 *   email,name,company,v,url
 *   alice@example.com,Alice,Acme,4217,https://artanis.ai/mallet/v4217
 *
 * What it does:
 *   1. Reads input rows.
 *   2. Assigns each recipient a random 4-digit integer (1000–9999) drawn
 *      from a shuffled pool, so numbers aren't sequential.
 *   3. Writes each `v:<n> → {email, name, company, campaign, sentAt}` entry
 *      to KV via `wrangler kv key put`.
 *   4. Emits the output CSV for your mail-merge tool.
 *
 * Flags:
 *   --env production   Target the production KV namespace (default: dev)
 *   --campaign <name>  Stamp a campaign label into each KV entry
 *   --base-url <url>   Override the mallet URL (default: https://artanis.ai/mallet)
 *   --dry-run          Print what would be written without touching KV
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'

interface Row {
  email: string
  [key: string]: string
}

interface Flags {
  env: 'production' | null
  campaign: string | null
  baseUrl: string
  dryRun: boolean
}

function parseArgs(argv: string[]): { input: string; output: string; flags: Flags } {
  const positional: string[] = []
  const flags: Flags = { env: null, campaign: null, baseUrl: 'https://artanis.ai/mallet', dryRun: false }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--env') flags.env = argv[++i] === 'production' ? 'production' : null
    else if (a === '--campaign') flags.campaign = argv[++i]
    else if (a === '--base-url') flags.baseUrl = argv[++i]
    else if (a === '--dry-run') flags.dryRun = true
    else positional.push(a)
  }

  if (positional.length < 2) {
    console.error('Usage: seed-invites.ts <input.csv> <output.csv> [--env production] [--campaign <name>] [--base-url <url>] [--dry-run]')
    process.exit(1)
  }
  return { input: positional[0], output: positional[1], flags }
}

function parseCsv(text: string): Row[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length < 2) return []
  const headers = splitCsvLine(lines[0])
  if (!headers.includes('email')) throw new Error(`CSV must have an "email" column; got: ${headers.join(', ')}`)
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line)
    const row: Row = { email: '' }
    headers.forEach((h, i) => (row[h] = cells[i] ?? ''))
    return row
  })
}

// Minimal CSV splitter — handles quoted fields with commas and doubled quotes.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++ }
      else if (ch === '"') inQ = false
      else cur += ch
    } else {
      if (ch === '"') inQ = true
      else if (ch === ',') { out.push(cur); cur = '' }
      else cur += ch
    }
  }
  out.push(cur)
  return out.map(s => s.trim())
}

function csvEscape(s: string): string {
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// Shuffle via Fisher-Yates.
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function kvPut(n: string, value: string, env: Flags['env'], dry: boolean) {
  const cmd = [
    'npx', 'wrangler', 'kv', 'key', 'put',
    '--binding=INVITES',
    ...(env === 'production' ? ['--env', 'production', '--remote'] : ['--local']),
    `v:${n}`,
    JSON.stringify(value),
  ].join(' ')
  if (dry) {
    console.log(`[dry-run] ${cmd}`)
    return
  }
  execSync(cmd, { stdio: 'inherit' })
}

function main() {
  const { input, output, flags } = parseArgs(process.argv.slice(2))
  if (!existsSync(input)) { console.error(`Input not found: ${input}`); process.exit(1) }

  const rows = parseCsv(readFileSync(input, 'utf-8'))
  if (rows.length === 0) { console.error('Empty CSV'); process.exit(1) }
  if (rows.length > 8000) { console.error(`Too many rows (${rows.length}); 4-digit pool is 9000. Use more digits.`); process.exit(1) }

  const pool = shuffle(Array.from({ length: 9000 }, (_, i) => 1000 + i))
  const sentAt = Date.now()
  const extraHeaders = Object.keys(rows[0]).filter(k => k !== 'email')

  const outLines: string[] = []
  outLines.push(['email', ...extraHeaders, 'v', 'url'].map(csvEscape).join(','))

  rows.forEach((row, i) => {
    const n = String(pool[i])
    const entry: Record<string, unknown> = {
      email: row.email,
      sentAt,
    }
    for (const h of extraHeaders) if (row[h]) entry[h] = row[h]
    if (flags.campaign) entry.campaign = flags.campaign

    kvPut(n, JSON.stringify(entry), flags.env, flags.dryRun)

    const url = `${flags.baseUrl.replace(/\/$/, '')}/v${n}`
    outLines.push([row.email, ...extraHeaders.map(h => row[h] ?? ''), n, url].map(csvEscape).join(','))
  })

  writeFileSync(output, outLines.join('\n') + '\n')
  console.log(`Seeded ${rows.length} invites → ${output}`)
  if (flags.dryRun) console.log('(dry-run: no KV writes)')
}

main()
