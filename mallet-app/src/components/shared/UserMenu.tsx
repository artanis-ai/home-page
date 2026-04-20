import { useState, useEffect, useRef } from 'react'
import { LogOut } from 'lucide-react'
import { useSession } from '../../hooks/useSession'
import { track } from '../../lib/track'

export function UserMenu() {
  const { user, signOut } = useSession()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (!user) return null

  const initial = (user.name || user.login || '?')[0]?.toUpperCase() || '?'

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-warm text-sm font-semibold text-earth-dark ring-1 ring-warm transition hover:ring-primary/40"
        title={user.name}
        style={{ cursor: 'pointer' }}
      >
        {user.avatar ? (
          <img src={user.avatar} alt={user.name} className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-56 overflow-hidden rounded-lg border border-warm bg-white shadow-lg">
          <div className="border-b border-warm px-3 py-2">
            <div className="truncate text-sm font-medium text-earth-dark">{user.name}</div>
            <div className="truncate text-xs text-text-muted">@{user.login}</div>
          </div>
          <button
            onClick={() => {
              track('signout.clicked')
              setOpen(false)
              signOut()
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-text-mid transition hover:bg-warm"
            style={{ cursor: 'pointer' }}
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
