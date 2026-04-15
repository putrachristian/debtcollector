import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Receipt, Wallet } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function tabClass(active: boolean) {
  return cn(
    'flex min-h-[48px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1 text-[11px] font-medium transition-colors touch-manipulation',
    active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
  )
}

function accountLabel(
  profile: { display_name: string | null } | null,
  user: { email?: string; user_metadata?: Record<string, unknown> } | null
): string {
  const meta = user?.user_metadata
  const given = typeof meta?.given_name === 'string' ? meta.given_name.trim() : ''
  const family = typeof meta?.family_name === 'string' ? meta.family_name.trim() : ''
  const combined = [given, family].filter(Boolean).join(' ').trim()
  const metaName = meta?.full_name ?? meta?.name
  const fromMeta = typeof metaName === 'string' ? metaName.trim() : ''
  return (
    profile?.display_name?.trim() ||
    combined ||
    fromMeta ||
    (user?.email ? user.email.split('@')[0] ?? '' : '') ||
    user?.email ||
    ''
  )
}

export function AppLayout() {
  const { user, profile, signOut } = useAuth()
  const { pathname } = useLocation()
  const hideTabBar =
    (pathname.startsWith('/bill/') && pathname !== '/bill/new') || pathname.startsWith('/join/')
  const isAuthRoute = pathname === '/auth'

  return (
    <div className="app-shell flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-card/90 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md supports-[backdrop-filter]:bg-card/75">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
          <Link
            to="/"
            className="min-h-[44px] min-w-[44px] shrink-0 content-center text-lg font-semibold tracking-tight touch-manipulation [-webkit-tap-highlight-color:transparent]"
          >
            DebtCollector
          </Link>
          <nav className="hidden min-w-0 flex-1 items-center justify-end gap-2 md:flex">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">Bills</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/debts">My debt</Link>
            </Button>
            {user ? (
              <>
                <span className="max-w-[12rem] truncate text-sm text-muted-foreground" title={accountLabel(profile, user)}>
                  {accountLabel(profile, user)}
                </span>
                <Button variant="outline" size="sm" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </>
            ) : (
              <Button variant="outline" size="sm" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            )}
          </nav>
          <div className="flex min-w-0 max-w-[55vw] items-center gap-2 md:hidden">
            {user ? (
              <>
                <span className="truncate text-xs text-muted-foreground" title={accountLabel(profile, user)}>
                  {accountLabel(profile, user)}
                </span>
                <Button variant="ghost" size="sm" className="h-10 shrink-0 px-2 text-xs" onClick={() => void signOut()}>
                  Out
                </Button>
              </>
            ) : !isAuthRoute ? (
              <Button variant="outline" size="sm" className="h-10" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full max-w-4xl flex-1 px-4 pb-6 pt-4',
          !hideTabBar && 'pb-[calc(4.25rem+env(safe-area-inset-bottom,0px))] md:pb-6'
        )}
      >
        <Outlet />
      </main>

      {!hideTabBar ? (
        <nav
          className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur-lg md:hidden"
          aria-label="Main"
        >
          <div className="mx-auto flex max-w-lg items-stretch justify-around">
            <NavLink to="/" end className={({ isActive }) => tabClass(isActive)}>
              <Receipt className="size-5 shrink-0" aria-hidden />
              Bills
            </NavLink>
            <NavLink to="/debts" className={({ isActive }) => tabClass(isActive)}>
              <Wallet className="size-5 shrink-0" aria-hidden />
              My debt
            </NavLink>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
