import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { LayoutList, Moon, Plus, Sparkles, Sun, Wallet } from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { useTheme } from '@/context/ThemeContext'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('shrink-0 touch-manipulation', className)}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
    </Button>
  )
}

function mobileTabClass(active: boolean) {
  return cn(
    'flex min-h-[52px] min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-2 py-1.5 text-[10px] font-medium transition-colors touch-manipulation [-webkit-tap-highlight-color:transparent]',
    active ? 'bg-primary/12 text-primary' : 'text-muted-foreground active:bg-muted/60'
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
  const hideTabBar = pathname.startsWith('/bill/') && pathname !== '/bill/new'
  const isAuthRoute = pathname === '/auth'

  return (
    <div className="app-shell relative flex min-h-dvh flex-col overflow-x-clip bg-background">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[32rem] bg-[radial-gradient(circle_at_top_left,rgba(120,174,255,0.28),transparent_34%),radial-gradient(circle_at_top_right,rgba(255,255,255,0.95),transparent_22%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent)] dark:bg-[radial-gradient(circle_at_top_left,rgba(82,138,255,0.22),transparent_34%),radial-gradient(circle_at_top_right,rgba(120,173,255,0.12),transparent_20%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent)]" />
      <header className="sticky top-0 z-40 border-b border-white/35 bg-white/40 pt-[env(safe-area-inset-top,0px)] backdrop-blur-2xl supports-[backdrop-filter]:bg-white/25 dark:border-white/10 dark:bg-slate-950/40 dark:supports-[backdrop-filter]:bg-slate-950/28">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-3 px-4">
          <Link
            to="/"
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center gap-2 text-lg font-semibold tracking-tight touch-manipulation [-webkit-tap-highlight-color:transparent]"
          >
            <span className="flex size-8 items-center justify-center rounded-2xl bg-primary/14 text-primary shadow-[0_10px_24px_-18px_rgba(37,99,235,0.8)]">
              <Sparkles className="size-4" aria-hidden />
            </span>
            DebtCollector
          </Link>
          <nav className="hidden min-w-0 flex-1 items-center justify-end gap-2 md:flex">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/">List bill</Link>
            </Button>
            <Button variant="default" size="sm" asChild>
              <Link to="/bill/new">New bill</Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/debts">My debt</Link>
            </Button>
            <ThemeToggle />
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
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 md:hidden">
            <ThemeToggle />
            {user ? (
              <>
                <span className="min-w-0 max-w-[38vw] truncate text-xs text-muted-foreground" title={accountLabel(profile, user)}>
                  {accountLabel(profile, user)}
                </span>
                <Button variant="ghost" size="sm" className="h-10 shrink-0 px-2 text-xs" onClick={() => void signOut()}>
                  Out
                </Button>
              </>
            ) : !isAuthRoute ? (
              <Button variant="outline" size="sm" className="h-10 shrink-0" asChild>
                <Link to="/auth">Sign in</Link>
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      <main className={cn('mx-auto w-full max-w-4xl flex-1 px-4 pb-6 pt-5', !hideTabBar && 'pb-[calc(5.75rem+env(safe-area-inset-bottom,0px))] md:pb-6')}>
        <Outlet />
      </main>

      {!hideTabBar ? (
        <nav
          className="pointer-events-none fixed inset-x-0 bottom-0 z-50 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] md:hidden"
          aria-label="Main"
        >
          <div className="pointer-events-auto mx-auto flex max-w-md justify-center px-4">
            <div
              className={cn(
                'flex w-full max-w-sm items-end gap-1 rounded-[1.75rem] border border-white/45 bg-white/45 px-2 pb-2 pt-1 shadow-[0_-10px_36px_-16px_rgba(15,23,42,0.45)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/45 dark:shadow-[0_-8px_28px_-14px_rgba(0,0,0,0.6)]'
              )}
            >
              <NavLink to="/" end className={({ isActive }) => mobileTabClass(isActive)}>
                <LayoutList className="size-[22px] shrink-0 stroke-[1.75]" aria-hidden />
                <span>List bill</span>
              </NavLink>
              <Link
                to="/bill/new"
                className="-mt-5 mb-0.5 flex size-[3.25rem] shrink-0 items-center justify-center self-center rounded-2xl bg-primary text-primary-foreground shadow-md ring-[5px] ring-background transition-transform active:scale-95 dark:ring-background"
                aria-label="New bill"
              >
                <Plus className="size-7 shrink-0 stroke-[2.5]" aria-hidden />
              </Link>
              <NavLink to="/debts" className={({ isActive }) => mobileTabClass(isActive)}>
                <Wallet className="size-[22px] shrink-0 stroke-[1.75]" aria-hidden />
                <span>My debt</span>
              </NavLink>
            </div>
          </div>
        </nav>
      ) : null}
    </div>
  )
}
