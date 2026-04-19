import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Layers, Trash2 } from 'lucide-react'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/AuthContext'
import { useBill } from '@/context/BillContext'
import type { BillGroupRow, BillRow } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GoogleIcon } from '@/components/GoogleIcon'
import { PwaInstallPrompt } from '@/components/PwaInstallPrompt'
import { formatIsoDateLabel } from '@/lib/date'
import { billPublicPath } from '@/lib/billPath'
import { matchesBillSearch, passesBillSingleDay } from '@/lib/billListFilters'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function isOpenBill(b: BillRow): boolean {
  return b.status !== 'closed'
}

function sortBillsByCreatedDesc(a: BillRow, b: BillRow): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
}

type GroupMeta = { title: string; created_by: string }

/** One timeline row: either a lone ungrouped bill or a trip group block (positioned by newest bill in group). */
type HomeListRow =
  | { kind: 'ungroupedBill'; bill: BillRow; sortKey: string }
  | { kind: 'group'; id: string; title: string; bills: BillRow[]; sortKey: string }

function sortRowsByTimeDesc(a: HomeListRow, b: HomeListRow): number {
  if (a.sortKey < b.sortKey) return 1
  if (a.sortKey > b.sortKey) return -1
  return 0
}

/** Interleaves ungrouped bills with trip groups; order is newest `created_at` first (groups use latest bill in group). */
function buildHomeListRows(bills: BillRow[], groupMeta: Map<string, GroupMeta>): HomeListRow[] {
  const byGroup = new Map<string, BillRow[]>()
  const ungrouped: BillRow[] = []
  for (const b of bills) {
    if (b.group_id) {
      const arr = byGroup.get(b.group_id) ?? []
      arr.push(b)
      byGroup.set(b.group_id, arr)
    } else {
      ungrouped.push(b)
    }
  }
  const rows: HomeListRow[] = []
  for (const b of ungrouped) {
    rows.push({ kind: 'ungroupedBill', bill: b, sortKey: b.created_at })
  }
  for (const [gid, list] of byGroup) {
    const sorted = [...list].sort(sortBillsByCreatedDesc)
    const sortKey = sorted[0]?.created_at ?? ''
    const title = groupMeta.get(gid)?.title ?? 'Group'
    rows.push({ kind: 'group', id: gid, title, bills: sorted, sortKey })
  }
  rows.sort(sortRowsByTimeDesc)
  return rows
}

export function HomePage() {
  const { user, loading: authLoading, signInWithGoogle } = useAuth()
  const [oauthErr, setOauthErr] = useState<string | null>(null)
  const { setCurrentBillId, deleteBillById } = useBill()
  const [bills, setBills] = useState<BillRow[]>([])
  const [groupMeta, setGroupMeta] = useState<Map<string, GroupMeta>>(new Map())
  const [loading, setLoading] = useState(false)
  const [filterDate, setFilterDate] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [groupingMode, setGroupingMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [newGroupTitle, setNewGroupTitle] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [addToGroupChoice, setAddToGroupChoice] = useState('')
  /** Bills where the current user is a participant (not necessarily host). */
  const [participantBillIds, setParticipantBillIds] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    if (!user) {
      setBills([])
      setGroupMeta(new Map())
      setParticipantBillIds(new Set())
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
      const merged = [...map.values()].sort(sortBillsByCreatedDesc)
      setBills(merged)
      setParticipantBillIds(new Set(partIds))

      const gids = [...new Set(merged.map((b) => b.group_id).filter(Boolean))] as string[]
      if (gids.length > 0) {
        const { data: gr, error: eg } = await supabase.from('bill_groups').select('id, title, created_by').in('id', gids)
        if (eg) throw eg
        const m = new Map<string, GroupMeta>()
        for (const row of (gr as BillGroupRow[]) ?? []) {
          m.set(row.id, { title: row.title, created_by: row.created_by })
        }
        setGroupMeta(m)
      } else {
        setGroupMeta(new Map())
      }
    } catch {
      setBills([])
      setGroupMeta(new Map())
      setParticipantBillIds(new Set())
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bill_groups' }, () => void load())
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

  const filterDay = filterDate.trim() || null

  const groupTitleLookup = useCallback((gid: string) => groupMeta.get(gid)?.title, [groupMeta])

  const filteredOpen = useMemo(() => {
    let list = openBills.filter((b) => passesBillSingleDay(b, filterDay))
    list = list.filter((b) => matchesBillSearch(b, searchQuery, groupTitleLookup))
    return list
  }, [openBills, filterDay, searchQuery, groupTitleLookup])

  const filteredClosed = useMemo(() => {
    let list = closedBills.filter((b) => passesBillSingleDay(b, filterDay))
    list = list.filter((b) => matchesBillSearch(b, searchQuery, groupTitleLookup))
    return list
  }, [closedBills, filterDay, searchQuery, groupTitleLookup])

  const openRows = useMemo(
    () => buildHomeListRows(filteredOpen, groupMeta),
    [filteredOpen, groupMeta]
  )
  const closedRows = useMemo(
    () => buildHomeListRows(filteredClosed, groupMeta),
    [filteredClosed, groupMeta]
  )

  const canManageBillGroup = useCallback(
    (b: BillRow) => {
      if (!user) return false
      return b.host_id === user.id || participantBillIds.has(b.id)
    },
    [user, participantBillIds]
  )

  /** Open bills you host or participate in, not already in this trip group (or in another group). */
  function openBillsAddableToGroup(groupId: string): BillRow[] {
    if (!user) return []
    return bills
      .filter((b) => canManageBillGroup(b) && isOpenBill(b) && b.group_id !== groupId)
      .sort(sortBillsByCreatedDesc)
  }

  async function confirmDeleteBill(b: BillRow) {
    if (b.host_id !== user?.id) return
    if (!window.confirm(`Delete “${b.title?.trim() || 'Untitled'}”? This removes the bill for everyone.`)) return
    try {
      await deleteBillById(b.id)
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  function toggleSelectBill(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function createGroupFromSelection() {
    if (!user) return
    const title = newGroupTitle.trim()
    if (selectedIds.length < 2) {
      window.alert('Select at least two bills you host.')
      return
    }
    if (!title) {
      window.alert('Enter a name for the group.')
      return
    }
    const ok = selectedIds.every((id) => {
      const b = bills.find((x) => x.id === id)
      return b && b.host_id === user.id
    })
    if (!ok) {
      window.alert('You can only group bills where you are the host.')
      return
    }
    try {
      const { data: g, error: ge } = await supabase
        .from('bill_groups')
        .insert({ title, created_by: user.id })
        .select('id')
        .single()
      if (ge) throw ge
      const gid = (g as { id: string }).id
      for (const billId of selectedIds) {
        const { error: ue } = await supabase.from('bills').update({ group_id: gid }).eq('id', billId).eq('host_id', user.id)
        if (ue) throw ue
      }
      setGroupingMode(false)
      setSelectedIds([])
      setNewGroupTitle('')
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not create group')
    }
  }

  async function removeBillFromGroup(billId: string) {
    if (!user) return
    try {
      const { error } = await supabase.rpc('set_bill_group_id', {
        p_bill_id: billId,
        p_group_id: null,
      })
      if (error) throw error
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not update bill')
    }
  }

  async function addBillToGroup(billId: string, groupId: string) {
    if (!user) return
    try {
      const { error } = await supabase.rpc('set_bill_group_id', {
        p_bill_id: billId,
        p_group_id: groupId,
      })
      if (error) throw error
      setAddToGroupChoice('')
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not add bill')
    }
  }

  if (authLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!user) {
    return (
      <div className="space-y-4">
        <PwaInstallPrompt />
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
          </CardContent>
        </Card>
      </div>
    )
  }

  function billCardRow(
    b: BillRow,
    uid: string,
    opts?: {
      showCheckbox?: boolean
      checked?: boolean
      hideGroupLine?: boolean
      inGroupEditMode?: boolean
      /** Host or participant can remove a bill from a trip when Edit group is on. */
      allowRemoveFromGroup?: boolean
    }
  ) {
    const isHost = b.host_id === uid
    const showGroupingCb = !!opts?.showCheckbox && isHost
    const groupTitle =
      b.group_id && !opts?.hideGroupLine ? groupMeta.get(b.group_id)?.title : null
    const showActions = !groupingMode && (isHost || (opts?.inGroupEditMode && opts?.allowRemoveFromGroup))
    return (
      <div
        key={b.id}
        className="flex gap-2 rounded-lg border border-border/80 bg-card/50 p-1 pl-0 shadow-sm"
      >
        {showGroupingCb ? (
          <div className="flex shrink-0 items-center pl-2">
            <input
              type="checkbox"
              className="size-5 touch-manipulation accent-primary"
              checked={!!opts?.checked}
              onChange={() => toggleSelectBill(b.id)}
              aria-label={`Select ${b.title ?? 'bill'}`}
            />
          </div>
        ) : null}
        <Link to={billPublicPath(b)} className="min-w-0 flex-1 touch-manipulation active:opacity-90">
          <Card className="border-0 shadow-none transition-colors hover:bg-muted/40 active:bg-muted/60">
            <CardHeader className="py-4 sm:py-3">
              <CardTitle className="text-base">{b.title ?? 'Untitled'}</CardTitle>
              {groupTitle ? (
                <p className="text-xs text-muted-foreground">
                  Trip group: <span className="font-medium text-foreground/90">{groupTitle}</span>
                </p>
              ) : null}
              {isHost ? <p className="text-xs font-medium text-primary/90">You’re the host</p> : null}
              {b.bill_date ? (
                <p className="text-xs text-muted-foreground">{formatIsoDateLabel(b.bill_date)}</p>
              ) : null}
              {!isOpenBill(b) ? (
                <p className="text-xs font-medium text-muted-foreground">Closed</p>
              ) : b.status === 'draft' ? (
                <p className="text-xs font-medium text-muted-foreground">Draft</p>
              ) : null}
            </CardHeader>
          </Card>
        </Link>
        {showActions ? (
          <div className="flex shrink-0 flex-col items-end justify-center gap-1.5 pr-1">
            {b.group_id && opts?.inGroupEditMode && opts?.allowRemoveFromGroup ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 touch-manipulation px-2 text-xs"
                onClick={(e) => {
                  e.preventDefault()
                  if (
                    !window.confirm(
                      'Remove this bill from its trip group? You can assign groups again from Home.'
                    )
                  ) {
                    return
                  }
                  void removeBillFromGroup(b.id)
                }}
              >
                Remove from group
              </Button>
            ) : null}
            {isHost ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 text-destructive hover:bg-destructive/10 hover:text-destructive"
                aria-label="Delete bill"
                onClick={(e) => {
                  e.preventDefault()
                  void confirmDeleteBill(b)
                }}
              >
                <Trash2 className="size-5" />
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  function renderBillRows(rows: HomeListRow[], uid: string, emptyHint: string) {
    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground">{emptyHint}</p>
    }
    return (
      <div className="space-y-3">
        {rows.map((row) => {
          if (row.kind === 'ungroupedBill') {
            const b = row.bill
            return (
              <div key={b.id}>
                {billCardRow(b, uid, {
                  showCheckbox: groupingMode,
                  checked: selectedIds.includes(b.id),
                })}
              </div>
            )
          }
          const sec = row
          const meta = groupMeta.get(sec.id)
          const canEditGroup =
            !!meta &&
            (meta.created_by === uid ||
              sec.bills.some((bill) => bill.host_id === uid || participantBillIds.has(bill.id)))
          return (
            <details
              key={sec.id}
              className="group rounded-xl border border-border bg-muted/20 open:bg-muted/30"
              open
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-3 text-sm font-medium marker:hidden sm:px-4">
                <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                <span className="min-w-0 flex-1">{sec.title}</span>
                <span className="text-xs font-normal text-muted-foreground">{sec.bills.length} bill(s)</span>
              </summary>
              <div className="space-y-2 border-t border-border/60 px-2 pb-3 pt-2 sm:px-3">
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="h-9 touch-manipulation" asChild>
                    <Link to={`/bill/new?group=${sec.id}`}>Add bill</Link>
                  </Button>
                  {canEditGroup ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 touch-manipulation"
                      onClick={() => setEditingGroupId((v) => (v === sec.id ? null : sec.id))}
                    >
                      {editingGroupId === sec.id ? 'Done editing' : 'Edit group'}
                    </Button>
                  ) : null}
                </div>
                {editingGroupId === sec.id && canEditGroup && openBillsAddableToGroup(sec.id).length > 0 ? (
                  <div className="rounded-md border border-border/80 bg-card/60 p-3 text-sm">
                    <div className="space-y-1">
                      <Label className="text-xs">Add an existing bill</Label>
                      <p className="text-xs text-muted-foreground">
                        Bills you host or are on as a guest; ungrouped or from another trip.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          className="h-10 w-full min-w-0 flex-1 rounded-md border border-border bg-card px-2 text-sm"
                          value={addToGroupChoice}
                          onChange={(e) => setAddToGroupChoice(e.target.value)}
                        >
                          <option value="">Choose a bill…</option>
                          {openBillsAddableToGroup(sec.id).map((b) => {
                            const fromOther = b.group_id ? groupMeta.get(b.group_id)?.title : null
                            return (
                              <option key={b.id} value={b.id}>
                                {b.title ?? 'Untitled'}
                                {fromOther ? ` (from ${fromOther})` : ''}
                              </option>
                            )
                          })}
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          className="h-10 shrink-0"
                          disabled={!addToGroupChoice}
                          onClick={() => void addBillToGroup(addToGroupChoice, sec.id)}
                        >
                          Add to group
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="grid gap-2">
                  {sec.bills.map((b) =>
                    billCardRow(b, uid, {
                      showCheckbox: groupingMode,
                      checked: selectedIds.includes(b.id),
                      hideGroupLine: true,
                      inGroupEditMode: editingGroupId === sec.id && canEditGroup,
                      allowRemoveFromGroup:
                        editingGroupId === sec.id && canEditGroup && canManageBillGroup(b),
                    })
                  )}
                </div>
              </div>
            </details>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Home</h1>

      <PwaInstallPrompt />

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div
          className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto rounded-lg border border-border bg-card/40 px-2 py-1.5 sm:gap-3 sm:px-3"
          title="Shows bills for this calendar day (bill date if set, otherwise created date). Leave empty to show all."
        >
          <span className="shrink-0 text-xs text-muted-foreground">Day</span>
          <label htmlFor="filter-date" className="sr-only">
            Filter by date
          </label>
          <Input
            id="filter-date"
            type="date"
            className="h-9 w-[min(52vw,11rem)] min-w-[9.25rem] shrink-0 py-1 text-sm sm:w-44"
            value={filterDate}
            onChange={(e) => setFilterDate(e.target.value)}
          />
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 px-2.5 text-xs sm:px-3 sm:text-sm" onClick={() => setFilterDate('')}>
            Clear
          </Button>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Label htmlFor="home-search" className="sr-only">
            Search
          </Label>
          <Input
            id="home-search"
            type="search"
            placeholder="Search title or group…"
            className="h-9 min-w-0 flex-1 text-sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <Button
          type="button"
          variant={groupingMode ? 'secondary' : 'outline'}
          size="sm"
          className="h-10 touch-manipulation gap-2"
          onClick={() => {
            setGroupingMode((v) => !v)
            setSelectedIds([])
            setNewGroupTitle('')
            setEditingGroupId(null)
          }}
        >
          <Layers className="size-4" aria-hidden />
          {groupingMode ? 'Cancel grouping' : 'Group bills'}
        </Button>
        {groupingMode ? (
          <>
            <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
            <Input
              placeholder="New group name"
              className="h-10 max-w-xs text-sm"
              value={newGroupTitle}
              onChange={(e) => setNewGroupTitle(e.target.value)}
            />
            <Button type="button" size="sm" className="h-10 touch-manipulation" onClick={() => void createGroupFromSelection()}>
              Create group
            </Button>
          </>
        ) : null}
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Open bills</h2>
        <p className="text-sm text-muted-foreground">
          Every signed-in user sees all <span className="font-medium text-foreground">open</span> bills. Open one to
          browse; you are added automatically so you can pick your order.
        </p>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          renderBillRows(
            openRows,
            user.id,
            filterDay || searchQuery.trim()
              ? 'No open bills match filters.'
              : 'No open bills yet. Create one or open a bill link.'
          )
        )}
      </section>

      {closedBills.length > 0 ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight text-muted-foreground">Closed</h2>
          <div className="opacity-95">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              renderBillRows(
                closedRows,
                user.id,
                filterDay || searchQuery.trim() ? 'No closed bills match filters.' : 'No closed bills.'
              )
            )}
          </div>
        </section>
      ) : null}
    </div>
  )
}
