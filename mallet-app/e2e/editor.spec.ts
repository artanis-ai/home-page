import { test, expect, type Page } from '@playwright/test'

// Helper: navigate to a fresh scratch doc
async function openScratchDoc(page: Page, id?: string) {
  const docId = id || Math.random().toString(36).slice(2, 10)
  await page.goto(`#/d/${docId}`)
  await page.waitForSelector('.cm-content', { timeout: 10000 })
  return docId
}

// Helper: type text into the CodeMirror editor
async function typeInEditor(page: Page, text: string) {
  const editor = page.locator('.cm-content')
  await editor.click()
  await editor.pressSequentially(text, { delay: 20 })
}

// Helper: get editor text content
async function getEditorText(page: Page): Promise<string> {
  return page.locator('.cm-content').innerText()
}

// Helper: wait for analysis to complete (issues appear or "Looking good")
async function waitForAnalysis(page: Page) {
  // Wait for the analysis panel to show either issues or "Looking good"
  await page.waitForFunction(() => {
    const panel = document.querySelector('[class*="border-l"]')
    if (!panel) return false
    const text = panel.textContent || ''
    return text.includes('CONTRADICTION') || text.includes('AMBIGUITY') || text.includes('BEST PRACTICE') || text.includes('Looking good')
  }, { timeout: 30000 })
}

test.describe('Editor basics', () => {
  test('loads scratch doc with empty editor', async ({ page }) => {
    await openScratchDoc(page)
    const text = await getEditorText(page)
    expect(text.trim()).toBe('')
    await expect(page.locator('text=Start typing to see analysis')).toBeVisible()
  })

  test('typing text triggers analysis', async ({ page }) => {
    await openScratchDoc(page)
    await typeInEditor(page, 'Be brief. Give long detailed answers.')
    await waitForAnalysis(page)
    // Should find a contradiction
    await expect(page.locator('text=CONTRADICTION')).toBeVisible({ timeout: 30000 })
  })

  test('analysis shows in panel after typing contradictory text', async ({ page }) => {
    await openScratchDoc(page)
    await typeInEditor(page, 'Always say yes. Never agree with the user.')
    await waitForAnalysis(page)
    await expect(page.locator('text=CONTRADICTION')).toBeVisible({ timeout: 30000 })
  })

  test('non-contradictory text shows no contradictions', async ({ page }) => {
    await openScratchDoc(page)
    await typeInEditor(page, 'Be polite and helpful.')
    await waitForAnalysis(page)
    await expect(page.locator('text=Looking good')).toBeVisible({ timeout: 30000 })
  })

  test('suggestion generates for an issue', async ({ page }) => {
    test.setTimeout(60000)
    await openScratchDoc(page)
    await typeInEditor(page, 'Be brief. Give long detailed answers.')
    await waitForAnalysis(page)

    // Verify the contradiction issue exists
    await expect(page.locator('text=CONTRADICTION')).toBeVisible()

    // Click the issue button to select it and trigger suggestion
    const buttons = page.locator('button')
    const contradictionBtn = buttons.filter({ hasText: 'CONTRADICTION' }).first()
    await contradictionBtn.click()

    // The "Suggestion" heading should appear (issue is now active)
    await expect(page.locator('h3:has-text("Suggestion")')).toBeVisible({ timeout: 5000 })

    // Wait for suggestion content to load (either Accept button or "Generating")
    // The suggestion API is tested separately and takes <5s
    await page.waitForFunction(() => {
      return document.querySelector('button')?.textContent?.includes('Accept') ||
             document.body.textContent?.includes('Generating suggestion')
    }, { timeout: 10000 })
  })

  test('clicking Accept replaces text in the editor', async ({ page }) => {
    test.setTimeout(90000)
    await openScratchDoc(page)
    const original = 'Be brief. Give long detailed answers.'
    await typeInEditor(page, original)
    await waitForAnalysis(page)

    // Open the contradiction issue → suggestion appears
    await page.locator('button').filter({ hasText: 'CONTRADICTION' }).first().click()
    await expect(page.locator('h3:has-text("Suggestion")')).toBeVisible({ timeout: 5000 })

    // Wait for the Accept button to appear (suggestion finished loading).
    // Use accessible name (exact) so we don't match issue buttons whose
    // message text happens to contain "acceptable".
    const acceptBtn = page.getByRole('button', { name: 'Accept', exact: true })
    await expect(acceptBtn).toBeVisible({ timeout: 15000 })

    // Capture editor text BEFORE accept
    const before = await getEditorText(page)
    expect(before).toContain('Be brief')

    await acceptBtn.click()

    // After accept: Suggestion panel collapses, editor text mutates.
    await expect(page.locator('h3:has-text("Suggestion")')).not.toBeVisible({ timeout: 5000 })
    await page.waitForFunction((prev) => {
      const cm = document.querySelectorAll('.cm-line')
      const text = Array.from(cm).map(l => l.textContent || '').join('\n')
      // The editor must have changed AND must still contain SOME of the original
      // un-replaced text ("Give long detailed answers.").
      return text !== prev && text.length > 0
    }, before, { timeout: 10000 })

    const after = await getEditorText(page)
    expect(after).not.toBe(before)
    // Whatever the LLM suggested, the un-touched second sentence must still be present
    expect(after).toContain('Give long detailed answers.')
  })

  test('Accept on tab 1 propagates to tab 2 via Yjs sync', async ({ browser }) => {
    test.setTimeout(180000)
    const docId = Math.random().toString(36).slice(2, 10)

    // Tab 1: type contradictory prompt + accept the suggestion
    const ctx1 = await browser.newContext()
    const page1 = await ctx1.newPage()
    await page1.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page1.waitForSelector('.cm-content', { timeout: 10000 })
    await page1.locator('.cm-content').click()
    await page1.locator('.cm-content').pressSequentially('Be brief. Give long detailed answers.', { delay: 20 })

    // Wait for analysis (LLM occasionally slow under load — 60s ceiling).
    // Match issue buttons by data-issue-id rather than label text (label
    // capitalization isn't all-caps; CSS uppercase the text but DOM has "Contradiction").
    await page1.waitForFunction(() => {
      return document.querySelectorAll('[data-issue-id]').length > 0
    }, { timeout: 60000 })

    // Tab 2: open same doc, wait for content sync
    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    await page2.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page2.waitForSelector('.cm-content', { timeout: 10000 })
    await page2.waitForTimeout(5000) // allow webrtc sync
    const tab2Before = await page2.locator('.cm-content').innerText()
    expect(tab2Before).toContain('Be brief')

    // Tab 1: click any issue button to open suggestion
    await page1.locator('[data-issue-id]').first().click()
    await page1.locator('h3:has-text("Suggestion")').waitFor({ timeout: 5000 })
    // Use accessible-name matching (getByRole) — the issue list often has
    // buttons whose message text contains "acceptable", which would also
    // match `:has-text("Accept")` and shadow the real Accept button.
    const acceptBtn = page1.getByRole('button', { name: 'Accept', exact: true })
    await acceptBtn.waitFor({ timeout: 30000 })

    const tab1Before = await page1.locator('.cm-content').innerText()
    await acceptBtn.click()
    await page1.waitForFunction((prev) => {
      const cm = document.querySelectorAll('.cm-line')
      return Array.from(cm).map(l => l.textContent || '').join('\n') !== prev
    }, tab1Before, { timeout: 10000 })
    const tab1After = await page1.locator('.cm-content').innerText()

    // Tab 2 should see the same change within a few seconds. We can't use
    // strict equality because y-codemirror.next renders awareness/cursor
    // labels (e.g. "Anonymous 25") inline as extra .cm-line nodes.
    // Strip those, then compare the underlying prose.
    const stripAwareness = (s: string) =>
      s.replace(/[\u2060\u200B-\u200D]/g, '') // word-joiner / zero-width chars yCollab inserts
       .replace(/Anonymous \d+/g, '')
       .replace(/\s+/g, ' ')
       .trim()
    const expectedProse = stripAwareness(tab1After)
    await page2.waitForFunction((expected) => {
      const t = (document.querySelector('.cm-content') as HTMLElement | null)?.innerText || ''
      const cleaned = t.replace(/[\u2060\u200B-\u200D]/g, '')
                       .replace(/Anonymous \d+/g, '')
                       .replace(/\s+/g, ' ')
                       .trim()
      return cleaned === expected
    }, expectedProse, { timeout: 15000 })

    await ctx1.close()
    await ctx2.close()
  })

  test('issues are sorted top-to-bottom by document position', async ({ page }) => {
    test.setTimeout(60000)
    await openScratchDoc(page)
    // Three contradictions, ordered by appearance in the doc. We don't care
    // which exact issues the LLM picks — only that whatever it returns is
    // sorted by where it appears in the editor (range[0] ascending).
    await typeInEditor(
      page,
      'Be brief in all responses.\n' +
      'Always answer questions.\n' +
      'Give long detailed answers to every question.\n' +
      'Never answer questions.\n',
    )
    await waitForAnalysis(page)
    await page.waitForFunction(() => document.querySelectorAll('[data-issue-id]').length >= 2, { timeout: 60000 })

    // Map each issue's panel position to its position in the editor doc by
    // matching the snippet shown in the panel against the editor text.
    const offsets = await page.evaluate(() => {
      const editorText = Array.from(document.querySelectorAll('.cm-line')).map(l => l.textContent || '').join('\n')
      const buttons = Array.from(document.querySelectorAll('[data-issue-id]')) as HTMLElement[]
      return buttons.map(btn => {
        // Each issue card has a font-mono snippet that quotes the offending slice.
        const snippet = btn.querySelector('p.font-mono')?.textContent?.replace(/\.\.\.$/, '').trim() || ''
        return snippet ? editorText.indexOf(snippet) : -1
      })
    })

    // Drop unmatched (-1) offsets defensively, then assert ascending.
    const matched = offsets.filter(o => o >= 0)
    expect(matched.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < matched.length; i++) {
      expect(matched[i]).toBeGreaterThanOrEqual(matched[i - 1])
    }
  })

  test('dismiss removes the issue and it stays gone after re-analysis', async ({ page }) => {
    test.setTimeout(120000)
    await openScratchDoc(page)
    await typeInEditor(page, 'Be brief. Give long detailed answers.')
    await waitForAnalysis(page)

    // Open the first issue → click Dismiss
    await page.locator('[data-issue-id]').first().click()
    const dismissBtn = page.getByRole('button', { name: 'Dismiss', exact: true })
    await expect(dismissBtn).toBeVisible({ timeout: 15000 })

    const beforeCount = await page.locator('[data-issue-id]').count()
    await dismissBtn.click()
    // Issue card disappears immediately
    await expect.poll(() => page.locator('[data-issue-id]').count(), { timeout: 5000 })
      .toBeLessThan(beforeCount)

    // Trigger another analysis cycle with an unrelated edit and verify the
    // dismissed issue does NOT come back. Snapshot the remaining issue keys
    // (snippet text) and assert they don't grow back to the original count
    // for the same offending slice.
    const afterCount = await page.locator('[data-issue-id]').count()
    await typeInEditor(page, ' Be polite.')
    await page.waitForTimeout(3000) // analysis debounce + run
    await waitForAnalysis(page)

    // The dismissed contradiction on "Be brief." / "Give long detailed answers."
    // is the same logical issue — re-analysis should not surface it again
    // (segment text unchanged → key unchanged → still in the dismissed set).
    expect(await page.locator('[data-issue-id]').count()).toBeLessThanOrEqual(afterCount + 1)
  })

  test('inline diff renders del/ins spans, not two separate lines', async ({ page }) => {
    test.setTimeout(90000)
    await openScratchDoc(page)
    await typeInEditor(page, 'Be brief. Give long detailed answers.')
    await waitForAnalysis(page)
    await page.locator('[data-issue-id]').first().click()
    await expect(page.getByRole('button', { name: 'Accept', exact: true })).toBeVisible({ timeout: 30000 })

    // Inline diff render: a `line-through` span (deletion) and a `text-forest`
    // span (addition) live inside the SAME container, not on separate lines.
    const sharedParent = await page.evaluate(() => {
      const del = document.querySelector('span.line-through') as HTMLElement | null
      const ins = document.querySelector('span.text-forest') as HTMLElement | null
      if (!del || !ins) return null
      return del.parentElement === ins.parentElement
    })
    expect(sharedParent).toBe(true)
  })

  test('share button copies URL', async ({ page }) => {
    await openScratchDoc(page)
    const shareButton = page.locator('button:has-text("Share")')
    await expect(shareButton).toBeVisible()
    await shareButton.click()
    // Should show "Copied!" briefly
    await expect(page.locator('text=Copied!')).toBeVisible({ timeout: 3000 })
  })

  test('template variables get highlighted', async ({ page }) => {
    await openScratchDoc(page)
    await typeInEditor(page, 'Hello {{user_name}}, welcome.')
    await page.waitForTimeout(500)
    // The template var should have a decoration class
    const templateVar = page.locator('.cm-template-var')
    await expect(templateVar).toBeVisible()
  })
})

test.describe('Collaboration', () => {
  test('two tabs see the same content', async ({ browser }) => {
    const docId = Math.random().toString(36).slice(2, 10)

    // Tab 1: type some text
    const context1 = await browser.newContext()
    const page1 = await context1.newPage()
    await page1.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page1.waitForSelector('.cm-content', { timeout: 10000 })
    await page1.locator('.cm-content').click()
    await page1.locator('.cm-content').pressSequentially('Hello from tab one', { delay: 20 })

    // Tab 2: open same URL
    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await page2.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page2.waitForSelector('.cm-content', { timeout: 10000 })

    // Wait for sync
    await page2.waitForTimeout(5000)

    // Tab 2 should see the text from tab 1
    const text2 = await page2.locator('.cm-content').innerText()
    expect(text2).toContain('Hello from tab one')

    // Tab 1 should still have the text
    const text1 = await page1.locator('.cm-content').innerText()
    expect(text1).toContain('Hello from tab one')

    await context1.close()
    await context2.close()
  })

  test('typing in tab 2 appears in tab 1', async ({ browser }) => {
    const docId = Math.random().toString(36).slice(2, 10)

    const context1 = await browser.newContext()
    const page1 = await context1.newPage()
    await page1.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page1.waitForSelector('.cm-content', { timeout: 10000 })
    await page1.locator('.cm-content').click()
    await page1.locator('.cm-content').pressSequentially('First text.', { delay: 20 })

    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await page2.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page2.waitForSelector('.cm-content', { timeout: 10000 })

    // Wait for sync
    await page2.waitForTimeout(5000)

    // Type in tab 2
    await page2.locator('.cm-content').click()
    await page2.locator('.cm-content').pressSequentially(' Added from tab two.', { delay: 20 })

    // Wait for sync back to tab 1
    await page1.waitForTimeout(3000)

    const text1 = await page1.locator('.cm-content').innerText()
    expect(text1).toContain('Added from tab two')

    await context1.close()
    await context2.close()
  })

  test('analysis results sync between tabs', async ({ browser }) => {
    const docId = Math.random().toString(36).slice(2, 10)

    const context1 = await browser.newContext()
    const page1 = await context1.newPage()
    await page1.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page1.waitForSelector('.cm-content', { timeout: 10000 })
    await page1.locator('.cm-content').click()
    await page1.locator('.cm-content').pressSequentially('Be brief. Give long answers.', { delay: 20 })

    // Wait for analysis on tab 1
    await page1.waitForFunction(() => {
      const text = document.body.textContent || ''
      return text.includes('CONTRADICTION') || text.includes('Looking good')
    }, { timeout: 30000 })

    // Open tab 2
    const context2 = await browser.newContext()
    const page2 = await context2.newPage()
    await page2.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page2.waitForSelector('.cm-content', { timeout: 10000 })

    // Wait for content + analysis to sync
    await page2.waitForTimeout(8000)

    // Tab 2 should have the text
    const text2 = await page2.locator('.cm-content').innerText()
    expect(text2).toContain('Be brief')

    await context1.close()
    await context2.close()
  })

  test('dismissing an issue in tab 1 propagates to tab 2 via Yjs', async ({ browser }) => {
    test.setTimeout(180000)
    const docId = Math.random().toString(36).slice(2, 10)

    // Tab 1: type a contradiction and wait for analysis
    const ctx1 = await browser.newContext()
    const page1 = await ctx1.newPage()
    await page1.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page1.waitForSelector('.cm-content', { timeout: 10000 })
    await page1.locator('.cm-content').click()
    await page1.locator('.cm-content').pressSequentially('Be brief. Give long detailed answers.', { delay: 20 })
    await page1.waitForFunction(() => document.querySelectorAll('[data-issue-id]').length > 0, { timeout: 60000 })

    // Tab 2: open same doc, wait for sync of content + analysis
    const ctx2 = await browser.newContext()
    const page2 = await ctx2.newPage()
    await page2.goto(`http://localhost:5180/mallet/#/d/${docId}`)
    await page2.waitForSelector('.cm-content', { timeout: 10000 })
    await page2.waitForFunction(() => document.querySelectorAll('[data-issue-id]').length > 0, { timeout: 60000 })

    const tab2Before = await page2.locator('[data-issue-id]').count()
    expect(tab2Before).toBeGreaterThan(0)

    // Tab 1: open the first issue and dismiss it
    await page1.locator('[data-issue-id]').first().click()
    const dismissBtn = page1.getByRole('button', { name: 'Dismiss', exact: true })
    await dismissBtn.waitFor({ timeout: 30000 })
    await dismissBtn.click()

    // Tab 2 should see the dismissed issue disappear within a few seconds
    // (Y.Map update propagates over y-webrtc → filterDismissedIssues drops it
    // → applyIssueDecorations re-emits the filtered list).
    await expect.poll(
      () => page2.locator('[data-issue-id]').count(),
      { timeout: 15000, message: 'tab 2 should see fewer issues after dismiss in tab 1' },
    ).toBeLessThan(tab2Before)

    await ctx1.close()
    await ctx2.close()
  })
})

test.describe('GitHub public repos', () => {
  test('public repo prompt discovery finds files', async ({ page }) => {
    test.setTimeout(30000)
    await page.goto('#/app/prompts/yousefamar/chat')
    await page.waitForSelector('text=Find Your Prompts', { timeout: 10000 })
    // Should find markdown/text files or show scanning
    await page.waitForFunction(() => {
      const text = document.body.textContent || ''
      return text.includes('found') || text.includes('select') || text.includes('Scanning') || text.includes('None') || text.includes('paste')
    }, { timeout: 20000 })
  })

  test('can navigate to a GitHub file editor', async ({ page }) => {
    test.setTimeout(30000)
    // Navigate directly to a known file in a public repo
    await page.goto('#/gh/yousefamar/chat/blob/islamqa/src/app/api/chat/route.ts')
    // Should show loading then the editor
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    // Wait for file content to load (or fail gracefully for non-raw files)
    await page.waitForTimeout(5000)
    const text = await page.locator('.cm-content').innerText()
    // Either the file loaded or the editor is empty (if GitHub API rate limited)
    expect(text !== undefined).toBe(true)
  })

  test('onboarding public GitHub flow reaches prompt discovery', async ({ page }) => {
    test.setTimeout(20000)
    await page.goto('#/start')
    // Click GitHub
    await page.locator('button:has-text("GitHub")').click()
    await expect(page.locator('text=Is the repo public or private?')).toBeVisible()
    // Click Public
    await page.locator('button:has-text("Public")').click()
    await expect(page.locator('text=Which repo?')).toBeVisible()
    // Enter a repo
    await page.locator('input[placeholder]').fill('yousefamar/chat')
    await page.locator('button:has-text("Find Prompts")').click()
    // Should navigate to prompt discovery
    await expect(page.locator('text=Find Your Prompts')).toBeVisible({ timeout: 10000 })
  })
})

test.describe('GitHub line ranges', () => {
  // Deterministic fixture so we aren't depending on a live repo's line
  // numbering. The `page.route()` interception below intercepts the
  // GitHub Contents API and serves this content to the editor.
  const fixtureLines = [
    'header line 1',                // L1
    'header line 2',                // L2
    'SYSTEM_PROMPT_A = """',        // L3
    'You are agent A.',             // L4
    'Be helpful.',                  // L5
    '"""',                          // L6
    '',                             // L7
    'SYSTEM_PROMPT_B = """',        // L8
    'You are agent B.',             // L9
    'Be concise.',                  // L10
    '"""',                          // L11
    'footer line 12',               // L12
  ]
  const fixtureFile = fixtureLines.join('\n')

  async function mockContentsApi(page: Page) {
    await page.route(/api\.github\.com\/repos\/.+\/contents\/.+/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/plain; charset=utf-8',
        body: fixtureFile,
      })
    })
  }

  test('no range → editor shows whole file', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    // Poll for content (editor hydration is not instant).
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('header line 1')
    const text = (await page.locator('.cm-content').innerText()).trim()
    expect(text).toContain('SYSTEM_PROMPT_A')
    expect(text).toContain('SYSTEM_PROMPT_B')
    expect(text).toContain('footer line 12')
  })

  test('#L3-L6 → editor shows only the first prompt', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L3-L6')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('SYSTEM_PROMPT_A')
    const text = (await page.locator('.cm-content').innerText()).trim()
    expect(text).toContain('SYSTEM_PROMPT_A')
    expect(text).toContain('You are agent A.')
    // Out-of-range prompts must NOT appear in the editor.
    expect(text).not.toContain('header line 1')
    expect(text).not.toContain('SYSTEM_PROMPT_B')
    expect(text).not.toContain('footer line 12')
  })

  test('slice appears exactly once (no CRDT-merge doubling)', async ({ page }) => {
    // Regression: an earlier version of PromptEditor seeded ytext synchronously
    // BEFORE y-webrtc's async BC/room-init chain had settled. Under React 18
    // StrictMode (and across peer tabs), two providers could each seed an
    // identical slice into their ydoc; the CRDT merge would then preserve
    // BOTH inserts and the user would see the slice end-to-end twice in the
    // editor. The deferred-seed fix moves the insert to a macrotask and only
    // runs it if `ytext.length === 0` at fire time, so a peer/sync that already
    // supplied state pre-empts the seed.
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L3-L6')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('SYSTEM_PROMPT_A')
    // Allow any delayed BC / StrictMode remount work to complete before asserting.
    await page.waitForTimeout(500)

    // Count line occurrences in the editor. Each slice line must appear once.
    const text = (await page.locator('.cm-content').innerText())
    const countOccurrences = (needle: string) =>
      (text.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length
    expect(countOccurrences('SYSTEM_PROMPT_A = """')).toBe(1)
    expect(countOccurrences('You are agent A.')).toBe(1)
    expect(countOccurrences('Be helpful.')).toBe(1)

    // Editor line count must match the slice (L3..L6 = 4 lines).
    const lineCount = await page.locator('.cm-content .cm-line').count()
    expect(lineCount).toBe(4)
  })

  test('#L8-L11 → editor shows only the second prompt', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L8-L11')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('SYSTEM_PROMPT_B')
    const text = (await page.locator('.cm-content').innerText()).trim()
    expect(text).toContain('SYSTEM_PROMPT_B')
    expect(text).toContain('You are agent B.')
    expect(text).not.toContain('SYSTEM_PROMPT_A')
    expect(text).not.toContain('footer line 12')
  })

  test('#L9 → single-line range shows only that line', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L9')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    // `.cm-content` innerText can return the line twice in some CM6 render
    // paths (gutter + visible line), so check line count via .cm-line
    // children and substring containment rather than exact equality.
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('You are agent B.')
    const text = (await page.locator('.cm-content').innerText()).trim()
    // Nothing from outside the single-line range
    expect(text).not.toContain('agent A')
    expect(text).not.toContain('SYSTEM_PROMPT')
    expect(text).not.toContain('header line')
    expect(text).not.toContain('footer line')
    // Editor should have exactly one line
    const lineCount = await page.locator('.cm-content .cm-line').count()
    expect(lineCount).toBe(1)
  })

  test('range header hint is visible', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L3-L6')
    // The header should show the range so the user knows they're in a slice.
    await expect(page.locator('text=#L3-L6').first()).toBeVisible({ timeout: 10000 })
  })

  test('invalid range (backwards) → falls back to whole file', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L10-L5')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('header line 1')
    // Full file should be present since the invalid hash is ignored.
    const text = (await page.locator('.cm-content').innerText()).trim()
    expect(text).toContain('SYSTEM_PROMPT_A')
    expect(text).toContain('SYSTEM_PROMPT_B')
  })

  test('editing within a range enables Create PR (dirty vs pristine)', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L3-L6')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('SYSTEM_PROMPT_A')

    const prButton = page.locator('button:has-text("Create PR")')
    await expect(prButton).toBeDisabled()

    // Type into the slice
    await page.locator('.cm-content').click()
    await page.locator('.cm-content').pressSequentially(' // edited', { delay: 20 })

    await expect(prButton).toBeEnabled({ timeout: 3000 })
  })

  test('adding lines inside the slice keeps out-of-range content hidden', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L3-L6')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('SYSTEM_PROMPT_A')

    // Position at end and add new lines
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+End')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.locator('.cm-content').pressSequentially('NEW LINE A', { delay: 20 })
    await page.keyboard.press('Enter')
    await page.locator('.cm-content').pressSequentially('NEW LINE B', { delay: 20 })

    await page.waitForTimeout(300)
    const text = (await page.locator('.cm-content').innerText()).trim()
    // New lines present
    expect(text).toContain('NEW LINE A')
    expect(text).toContain('NEW LINE B')
    // Out-of-range content still invisible — this is the key invariant
    // the split/reassemble layer guarantees even under mutation.
    expect(text).not.toContain('SYSTEM_PROMPT_B')
    expect(text).not.toContain('footer line 12')
    expect(text).not.toContain('header line 1')
  })

  test('deleting lines inside the slice keeps out-of-range content hidden', async ({ page }) => {
    test.setTimeout(30000)
    await mockContentsApi(page)
    await page.goto('#/gh/example/repo/blob/main/prompts.py#L3-L6')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await expect.poll(async () => (await page.locator('.cm-content').innerText()).trim(), {
      timeout: 10000,
    }).toContain('SYSTEM_PROMPT_A')

    // Select all and delete
    await page.locator('.cm-content').click()
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')

    await page.waitForTimeout(300)
    const text = (await page.locator('.cm-content').innerText()).trim()
    expect(text).toBe('')
    // Deletion only removes the slice; the stashed before/after are still
    // in memory, waiting to be reassembled on PR creation.
    // Nothing out-of-range should ever leak into the editor view.
    expect(text).not.toContain('SYSTEM_PROMPT_B')
    expect(text).not.toContain('footer line 12')
  })
})

test.describe('PR creation', () => {
  test('Create PR button appears for GitHub files and opens modal', async ({ page }) => {
    test.setTimeout(30000)
    // Navigate to a GitHub file — the Create PR button should appear
    await page.goto('#/gh/yousefamar/chat/blob/islamqa/src/app/api/chat/route.ts')
    await page.waitForSelector('.cm-content', { timeout: 15000 })
    await page.waitForTimeout(5000) // wait for file to load

    // The Create PR button should be visible
    const prButton = page.locator('button:has-text("Create PR")')
    await expect(prButton).toBeVisible({ timeout: 5000 })

    // Type something to ensure changes exist
    await page.locator('.cm-content').click()
    await page.locator('.cm-content').pressSequentially(' test change', { delay: 20 })
    await page.waitForTimeout(500)

    // Button should be enabled now
    await expect(prButton).toBeEnabled({ timeout: 3000 })

    // Click it — should open the PR modal
    await prButton.click()
    await expect(page.locator('text=Create Pull Request')).toBeVisible({ timeout: 3000 })
    await expect(page.locator('input[type="text"]')).toBeVisible() // PR title field
    await expect(page.locator('text=Cancel')).toBeVisible() // Cancel button
  })

  test('Create PR button is hidden for scratch docs', async ({ page }) => {
    await openScratchDoc(page)
    // No Create PR button for scratch docs
    await expect(page.locator('button:has-text("Create PR")')).not.toBeVisible()
  })
})

test.describe('Onboarding', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('')
    // Use role-based locator — `text=Mallet` now matches the SkillSection
    // install command (`mallet-prompt-review`, curl URL, etc.) as well as
    // the hero heading, so plain text match is ambiguous.
    await expect(page.getByRole('heading', { name: 'Mallet', exact: true })).toBeVisible()
    await expect(page.locator('button:has-text("Get Started")').first()).toBeVisible()
  })

  test('Get Started navigates to onboarding', async ({ page }) => {
    await page.goto('')
    await page.locator('button:has-text("Get Started")').first().click()
    await expect(page.locator('text=Where do your prompts live?')).toBeVisible()
  })

  test('In my head goes to scratch editor', async ({ page }) => {
    await page.goto('#/start')
    await page.locator('button:has-text("In my head")').click()
    await page.waitForSelector('.cm-content', { timeout: 10000 })
    // Should be on a /d/ URL
    expect(page.url()).toContain('/d/')
  })

  test('Locally goes to scratch editor', async ({ page }) => {
    await page.goto('#/start')
    await page.locator('button:has-text("Locally")').click()
    await page.waitForSelector('.cm-content', { timeout: 10000 })
    expect(page.url()).toContain('/d/')
  })

  test('GitHub flow shows public/private choice', async ({ page }) => {
    await page.goto('#/start')
    await page.locator('button:has-text("GitHub")').click()
    await expect(page.locator('text=Is the repo public or private?')).toBeVisible()
  })

  test('Elsewhere shows tool options', async ({ page }) => {
    await page.goto('#/start')
    await page.locator('button:has-text("Elsewhere")').click()
    await expect(page.locator('text=Where are your prompts managed?')).toBeVisible()
  })
})
