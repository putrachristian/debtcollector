import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/AuthContext'
import { useBill } from '@/context/BillContext'
import type { BillRow } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GoogleIcon } from '@/components/GoogleIcon'

function isOpenBill(b: BillRow): boolean {
  return b.status !== 'closed'
}

export function HomePage() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth()
  const [oauthErr, setOauthErr] = useState<string | null>(null)
  const { setCurrentBillId } = useBill()
  const [bills, setBills] = useState<BillRow[]>([])
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!user) {
      setBills([])
      return
    }
    setLoading(true)
    try {
      const [{ data: openRows, error: eo }, { data: partRows, error: ep }, { data: hostedClosed, error: ehc }] =
        await Promise.all([
          supabase.from('bills').select('*').neq('status', 'closed').order('created_at', { ascending: false }),
          supabase.from('participants').select('bill_id').eq('user_id', user.id),
          supabase.from('bills').select('*').eq('host_id', user.id).eq('status', 'closed').order('created_at', { ascending: false }),
        ])
      if (eo) throw eo
      if (ep) throw ep
      if (ehc) throw ehc
      const partIds = [...new Set((partRows ?? []).map((p) => (p as { bill_id: string }).bill_id))]
      let joinedClosed: BillRow[] = []
      if (partIds.length > 0) {
        const { data: jc, error: ejc } = await supabase
          .from('bills')
          .select('*')
          .in('id', partIds)
          .eq('status', 'closed')
          .order('created_at', { ascending: false })
        if (ejc) throw ejc
        joinedClosed = (jc as BillRow[]) ?? []
      }
      const map = new Map<string, BillRow>()
      for (const b of [
        ...((openRows as BillRow[]) ?? []),
        ...((hostedClosed as BillRow[]) ?? []),
        ...joinedClosed,
      ]) {
        map.set(b.id, b)
      }
      setBills([...map.values()].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)))
    } catch {
      setBills([])
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    setCurrentBillId(null)
  }, [setCurrentBillId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!user) return
    const onFocus = () => void load()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [user, load])

  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('home-open-bills')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bills' }, () => void load())
      .subscribe()
    return () => {
      void ch.unsubscribe()
    }
  }, [user, load])

  const { openBills, closedBills } = useMemo(() => {
    const open: BillRow[] = []
    const closed: BillRow[] = []
    for (const b of bills) {
      if (isOpenBill(b)) open.push(b)
      else closed.push(b)
    }
    return { openBills: open, closedBills: closed }
  }, [bills])

  if (authLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Sign in to create and share bills.</p>
          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-full touch-manipulation gap-3 sm:min-h-10"
            onClick={() => {
              setOauthErr(null)
              void signInWithGoogle('/').catch((e) =>
                setOauthErr(e instanceof Error ? e.message : 'Google sign-in failed')
              )
            }}
          >
            <GoogleIcon className="h-5 w-5 shrink-0" />
            Continue with Google
          </Button>
          {oauthErr ? <p className="text-sm text-destructive">{oauthErr}</p> : null}
          <Button asChild variant="secondary" className="min-h-12 w-full touch-manipulation sm:min-h-10">
            <Link to="/auth">Email sign in</Link>
          </Button>
        </CardContent>
      </Card>
    )
  }

  function billCard(b: BillRow, uid: string) {
    return (
      <Link key={b.id} to={`/bill/${b.id}`} className="block touch-manipulation active:opacity-90">
        <Card className="transition-colors hover:bg-muted/40 active:bg-muted/60">
          <CardHeader className="py-5 sm:py-4">
            <CardTitle className="text-base">{b.title ?? 'Untitled'}</CardTitle>
            {b.host_id === uid ? (
              <p className="text-xs font-medium text-primary/90">You’re the host</p>
            ) : null}
            <p className="text-xs text-muted-foreground font-mono">Invite {b.invite_code}</p>
            {!isOpenBill(b) ? (
              <p className="text-xs font-medium text-muted-foreground">Closed</p>
            ) : b.status === 'draft' ? (
              <p className="text-xs font-medium text-muted-foreground">Draft</p>
            ) : null}
          </CardHeader>
        </Card>
      </Link>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Home</h1>
        <Button
          className="min-h-12 w-full touch-manipulation text-base sm:w-auto sm:min-h-10 sm:text-sm"
          asChild
        >
          <Link to="/bill/new">New bill</Link>
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Open bills</h2>
        <p className="text-sm text-muted-foreground">
          Every signed-in user sees all <span className="font-medium text-foreground">open</span> bills. Open one to
          browse; tap <span className="font-medium text-foreground">Join this bill</span> there to add yourself and pick
          your order.
        </p>
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : null}
        <div className="grid gap-3">
          {openBills.map((b) => billCard(b, user.id))}
          {!loading && openBills.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open bills yet. Create one or open an invite link.</p>
          ) : null}
        </div>
      </section>

      {closedBills.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-muted-foreground">Closed</h2>
          <div className="grid gap-3 opacity-90">{closedBills.map((b) => billCard(b, user.id))}</div>
        </section>
      ) : null}
    </div>
  )
}
