import { useEffect, useRef, useState } from 'react'

const LINES = [
  'You are a support agent for Acme.',
  'Always be professional and helpful.',
  'Refer pricing questions to /pricing.',
]

const USERS = [
  { name: 'Alice', color: '#9B4340' },
  { name: 'Bob', color: '#4A7C59' },
]

// Alice edits line index 1 ("Always be professional..."); Bob edits line index 0
// ("You are a support..."). Each user stays on their own line throughout.
const EDIT_SEQUENCE = [
  { line: 1, from: 'helpful', to: 'empathetic', user: 0 },
  { line: 0, from: 'support', to: 'customer success', user: 1 },
  { line: 1, from: 'empathetic', to: 'helpful', user: 0 },
  { line: 0, from: 'customer success', to: 'support', user: 1 },
]

// Initial cursor positions — each user on their line, at the word they'll edit
const INITIAL_CURSORS = [
  { line: 1, col: LINES[1].indexOf('helpful') + 'helpful'.length },  // Alice
  { line: 0, col: LINES[0].indexOf('support') + 'support'.length },  // Bob
]

export function StepCollaborate() {
  const [lines, setLines] = useState([...LINES])
  const [cursors, setCursors] = useState(INITIAL_CURSORS)
  const mountedRef = useRef(true)
  const timeoutsRef = useRef<ReturnType<typeof setTimeout>[]>([])

  function wait(ms: number): Promise<void> {
    return new Promise(resolve => {
      const t = setTimeout(() => resolve(), ms)
      timeoutsRef.current.push(t)
    })
  }

  useEffect(() => {
    mountedRef.current = true
    run()
    return () => {
      mountedRef.current = false
      timeoutsRef.current.forEach(clearTimeout)
    }
  }, [])

  async function run() {
    let currentLines = [...LINES]
    await wait(1500)

    while (mountedRef.current) {
      for (const edit of EDIT_SEQUENCE) {
        if (!mountedRef.current) return
        currentLines = await doEdit(currentLines, edit)
        await wait(800)
      }
    }
  }

  async function doEdit(currentLines: string[], edit: typeof EDIT_SEQUENCE[0]) {
    const lineText = currentLines[edit.line]
    const wordIdx = lineText.indexOf(edit.from)
    if (wordIdx === -1) return currentLines

    // Cursor is already near the word — just position at end of it
    setCursors(prev => {
      const next = [...prev]
      next[edit.user] = { line: edit.line, col: wordIdx + edit.from.length }
      return next
    })
    await wait(300)

    // Delete char by char
    let working = [...currentLines]
    const before = lineText.slice(0, wordIdx)
    const after = lineText.slice(wordIdx + edit.from.length)

    for (let i = edit.from.length; i > 0; i--) {
      if (!mountedRef.current) return working
      const remaining = edit.from.slice(0, i - 1)
      working = [...currentLines]
      working[edit.line] = before + remaining + after
      setLines([...working])
      setCursors(prev => {
        const next = [...prev]
        next[edit.user] = { line: edit.line, col: wordIdx + remaining.length }
        return next
      })
      await wait(55 + Math.random() * 30)
    }

    await wait(120)

    // Type new word char by char
    for (let i = 1; i <= edit.to.length; i++) {
      if (!mountedRef.current) return working
      const typed = edit.to.slice(0, i)
      working = [...working]
      working[edit.line] = before + typed + after
      setLines([...working])
      setCursors(prev => {
        const next = [...prev]
        next[edit.user] = { line: edit.line, col: wordIdx + i }
        return next
      })
      await wait(40 + Math.random() * 25)
    }

    currentLines = [...working]
    return currentLines
  }

  return (
    <div className="flex flex-col items-start gap-8 lg:flex-row lg:gap-16">
      <div className="flex-1">
        <h3 className="font-display text-2xl font-bold text-earth-dark">
          2. Edit prompts together, in real time
        </h3>
        <p className="mt-3 text-text-mid">
          Invite your team with a link. Everyone sees changes instantly with live cursors and selections.
        </p>
      </div>

      <div className="w-full max-w-md flex-1 self-center lg:self-auto">
        <div className="overflow-hidden rounded-xl border border-warm bg-white shadow-lg">
          <div className="px-5 py-4 font-mono text-xs text-earth-dark" style={{ whiteSpace: 'pre', overflowX: 'hidden' }}>
            {lines.map((line, lineIdx) => (
              <div key={lineIdx} className="flex h-7 items-center">
                <span className="mr-3 w-3 text-right text-text-muted select-none">{lineIdx + 1}</span>
                <span className="relative">
                  {line.split('').map((char, charIdx) => (
                    <span key={charIdx} className="relative">
                      {cursors[0].line === lineIdx && cursors[0].col === charIdx && (
                        <Caret name={USERS[0].name} color={USERS[0].color} />
                      )}
                      {cursors[1].line === lineIdx && cursors[1].col === charIdx && (
                        <Caret name={USERS[1].name} color={USERS[1].color} />
                      )}
                      {char}
                    </span>
                  ))}
                  {cursors[0].line === lineIdx && cursors[0].col === line.length && (
                    <span className="relative"><Caret name={USERS[0].name} color={USERS[0].color} /></span>
                  )}
                  {cursors[1].line === lineIdx && cursors[1].col === line.length && (
                    <span className="relative"><Caret name={USERS[1].name} color={USERS[1].color} /></span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Caret({ name, color }: { name: string; color: string }) {
  return (
    <span className="absolute" style={{ top: '-1px', left: '-1px', zIndex: 10 }}>
      <span
        className="absolute whitespace-nowrap rounded-t rounded-br px-1.5 py-0.5 text-[9px] font-semibold text-white leading-none"
        style={{ backgroundColor: color, bottom: '100%', left: '0' }}
      >
        {name}
      </span>
      <span
        className="block"
        style={{ backgroundColor: color, width: '2px', height: '16px' }}
      />
    </span>
  )
}
