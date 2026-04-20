import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Layers, MoreVertical, RefreshCcw, Search, Sparkles, Trash2 } from 'lucide-react'
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
import { HOME_OVERVIEW_ITEMS } from '@/lib/homeOverviewContent'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function isOpenBill(b: BillRow): boolean {
  return b.status !== 'closed'
}

function sortBillsByCreatedDesc(a: BillRow, b: BillRow): number {
  return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
}

type GroupMeta = { title: string; created_by: string }

type HomeListRow =
  | { kind: 'ungroupedBill'; bill: BillRow; sortKey: string }
  | { kind: 'group'; id: string; title: string; bills: BillRow[]; sortKey: string }

function sortRowsByTimeDesc(a: HomeListRow, b: HomeListRow): number {
  if (a.sortKey < b.sortKey) return 1
  if (a.sortKey > b.sortKey) return -1
  return 0
}

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
  const [showFilterSearch, setShowFilterSearch] = useState(false)
  const [openBillMenuId, setOpenBillMenuId] = useState<string | null>(null)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [groupNameDraft, setGroupNameDraft] = useState('')
  const [overviewIndex, setOverviewIndex] = useState(() => Math.floor(Math.random() * HOME_OVERVIEW_ITEMS.length))

  useEffect(() => {
    if (!openBillMenuId) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpenBillMenuId(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [openBillMenuId])

  useEffect(() => {
    if (groupingMode) setOpenBillMenuId(null)
  }, [groupingMode])

  const load = useCallback(async () => {
    if (!user) {
      setBills([])
      setGroupMeta(new Map())
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
      for (const b of [...((openRows as BillRow[]) ?? []), ...((hostedClosed as BillRow[]) ?? []), ...joinedClosed]) {
        map.set(b.id, b)
      }
      const merged = [...map.values()].sort(sortBillsByCreatedDesc)
      setBills(merged)

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

  const { openBills } = useMemo(() => {
    const open: BillRow[] = []
    for (const b of bills) {
      if (isOpenBill(b)) open.push(b)
    }
    return { openBills: open }
  }, [bills])

  const filterDay = filterDate.trim() || null
  const groupTitleLookup = useCallback((gid: string) => groupMeta.get(gid)?.title, [groupMeta])

  const filteredOpen = useMemo(() => {
    let list = openBills.filter((b) => passesBillSingleDay(b, filterDay))
    list = list.filter((b) => matchesBillSearch(b, searchQuery, groupTitleLookup))
    return list
  }, [openBills, filterDay, searchQuery, groupTitleLookup])

  const openRows = useMemo(() => buildHomeListRows(filteredOpen, groupMeta), [filteredOpen, groupMeta])

  function openBillsAddableToGroup(groupId: string): BillRow[] {
    return bills
      .filter((b) => isOpenBill(b) && b.group_id !== groupId)
      .sort(sortBillsByCreatedDesc)
  }

  async function confirmDeleteBill(b: BillRow) {
    if (b.host_id !== user?.id) return
    if (!window.confirm(`Delete "${b.title?.trim() || 'Untitled'}"? This removes the bill for everyone.`)) return
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
    if (selectedIds.length < 1) {
      window.alert('Select at least one bill.')
      return
    }
    if (!title) {
      window.alert('Enter a name for the group.')
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
        const { error: ue } = await supabase.rpc('set_bill_group_id', {
          p_bill_id: billId,
          p_group_id: gid,
        })
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

  async function renameGroup(groupId: string) {
    const title = groupNameDraft.trim()
    if (!title) {
      window.alert('Enter a group name.')
      return
    }
    try {
      const { error } = await supabase.from('bill_groups').update({ title }).eq('id', groupId)
      if (error) throw error
      setRenamingGroupId(null)
      setGroupNameDraft('')
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not rename group')
    }
  }

  async function deleteGroup(groupId: string) {
    if (!window.confirm('Delete this group? Bills will stay, but the group will be removed.')) return
    try {
      const { error } = await supabase.from('bill_groups').delete().eq('id', groupId)
      if (error) throw error
      setEditingGroupId((v) => (v === groupId ? null : v))
      setRenamingGroupId((v) => (v === groupId ? null : v))
      await load()
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Could not delete group')
    }
  }

  if (authLoading) return <p className="text-sm text-muted-foreground">Loading...</p>

  if (!user) {
    return (
      <div className="space-y-4">
        <PwaInstallPrompt />
        <section className="page-hero glass-panel">
          <div className="glass-inner space-y-6">
            <div className="space-y-3">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/45 bg-white/45 px-3 py-1 text-xs font-medium text-foreground/85 backdrop-blur-xl dark:border-white/10 dark:bg-white/8">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                Shared bill tracking
              </div>
              <div className="space-y-2">
                <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                  Split bills with a cleaner flow for hosts and guests.
                </h1>
                <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
                  Create polished bill rooms, group related receipts, and keep payment details visible when people need them.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-3xl border border-white/45 bg-white/36 p-4 text-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
                Receipt scan or manual entry
              </div>
              <div className="rounded-3xl border border-white/45 bg-white/36 p-4 text-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
                Group trip expenses into one timeline
              </div>
              <div className="rounded-3xl border border-white/45 bg-white/36 p-4 text-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
                Share links and confirm payments on mobile
              </div>
            </div>
          </div>
        </section>

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
      allowRemoveFromGroup?: boolean
    }
  ) {
    const isHost = b.host_id === uid
    const showGroupingCb = !!opts?.showCheckbox
    const groupTitle = b.group_id && !opts?.hideGroupLine ? groupMeta.get(b.group_id)?.title : null
    const showActions = !groupingMode && (isHost || (opts?.inGroupEditMode && opts?.allowRemoveFromGroup))

    return (
      <div key={b.id} className="glass-panel overflow-visible rounded-[1.45rem]">
        {showGroupingCb ? (
          <div className="absolute left-4 top-4 z-10 flex shrink-0 items-center">
            <input
              type="checkbox"
              className="size-5 touch-manipulation accent-primary"
              checked={!!opts?.checked}
              onChange={() => toggleSelectBill(b.id)}
              aria-label={`Select ${b.title ?? 'bill'}`}
            />
          </div>
        ) : null}
        <Link
          to={billPublicPath(b)}
          className="glass-inner block min-w-0 rounded-[1.45rem] px-5 py-4 pr-14 touch-manipulation transition-colors active:opacity-90 hover:bg-white/10 dark:hover:bg-white/4"
        >
          <div className={showGroupingCb ? 'pl-8' : ''}>
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold leading-tight tracking-tight">{b.title ?? 'Untitled'}</h3>
              {groupTitle ? (
                <p className="text-xs text-muted-foreground">
                  Trip group: <span className="font-medium text-foreground/90">{groupTitle}</span>
                </p>
              ) : null}
              {isHost ? <p className="text-xs font-medium text-primary/90">You're the host</p> : null}
              {b.bill_date ? <p className="text-xs text-muted-foreground">{formatIsoDateLabel(b.bill_date)}</p> : null}
              {!isOpenBill(b) ? (
                <p className="text-xs font-medium text-muted-foreground">Closed</p>
              ) : b.status === 'draft' ? (
                <p className="text-xs font-medium text-muted-foreground">Draft</p>
              ) : null}
            </div>
          </div>
        </Link>
        {showActions ? (
          <div className="absolute right-2 top-2 z-20">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-10 touch-manipulation text-muted-foreground hover:text-foreground"
              aria-label={`Options for ${b.title ?? 'bill'}`}
              aria-expanded={openBillMenuId === b.id}
              aria-haspopup="menu"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpenBillMenuId((id) => (id === b.id ? null : b.id))
              }}
            >
              <MoreVertical className="size-5" aria-hidden />
            </Button>
            {openBillMenuId === b.id ? (
              <>
                <div className="fixed inset-0 z-[60]" aria-hidden onClick={() => setOpenBillMenuId(null)} />
                <ul
                  role="menu"
                  className="absolute right-0 top-full z-[70] mt-1 min-w-[12rem] rounded-2xl border border-white/40 bg-white/88 py-1 shadow-[0_20px_45px_-24px_rgba(15,23,42,0.5)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/88"
                  onClick={(e) => e.stopPropagation()}
                >
                  {b.group_id && opts?.inGroupEditMode && opts?.allowRemoveFromGroup ? (
                    <li role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full px-3 py-2.5 text-left text-sm touch-manipulation hover:bg-muted/80"
                        onClick={() => {
                          setOpenBillMenuId(null)
                          if (!window.confirm('Remove this bill from its trip group? You can assign groups again from Home.')) {
                            return
                          }
                          void removeBillFromGroup(b.id)
                        }}
                      >
                        Remove from group
                      </button>
                    </li>
                  ) : null}
                  {isHost ? (
                    <li role="none">
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-destructive touch-manipulation hover:bg-destructive/10"
                        onClick={() => {
                          setOpenBillMenuId(null)
                          void confirmDeleteBill(b)
                        }}
                      >
                        <Trash2 className="size-4 shrink-0" aria-hidden />
                        Delete bill
                      </button>
                    </li>
                  ) : null}
                </ul>
              </>
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
          const canEditGroup = !!meta

          return (
            <details key={sec.id} className="glass-panel group rounded-[1.45rem]" open>
              <summary className="glass-inner flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium marker:hidden">
                <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                <span className="min-w-0 flex-1">{sec.title}</span>
                <span className="text-xs font-normal text-muted-foreground">{sec.bills.length} bill(s)</span>
              </summary>
              <div className="glass-inner space-y-3 border-t border-border/60 px-3 pb-3 pt-3">
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
                      {editingGroupId === sec.id ? 'Done' : 'Manage group'}
                    </Button>
                  ) : null}
                </div>
                {editingGroupId === sec.id && canEditGroup ? (
                  <div className="rounded-2xl border border-white/45 bg-white/40 p-3 text-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
                    <div className="space-y-2">
                      <Label className="text-xs">Group name</Label>
                      {renamingGroupId === sec.id ? (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                          <Input
                            className="h-10 flex-1 text-sm"
                            value={groupNameDraft}
                            onChange={(e) => setGroupNameDraft(e.target.value)}
                            placeholder="Trip name"
                          />
                          <Button type="button" size="sm" className="h-10" onClick={() => void renameGroup(sec.id)}>
                            Save name
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-10"
                            onClick={() => {
                              setRenamingGroupId(null)
                              setGroupNameDraft('')
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9"
                            onClick={() => {
                              setRenamingGroupId(sec.id)
                              setGroupNameDraft(sec.title)
                            }}
                          >
                            Rename group
                          </Button>
                          <Button type="button" size="sm" variant="destructive" className="h-9" onClick={() => void deleteGroup(sec.id)}>
                            Delete group
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
                {editingGroupId === sec.id && canEditGroup && openBillsAddableToGroup(sec.id).length > 0 ? (
                  <div className="rounded-2xl border border-white/45 bg-white/40 p-3 text-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
                    <div className="space-y-1">
                      <Label className="text-xs">Add an existing bill</Label>
                      <p className="text-xs text-muted-foreground">
                        Any open bill can be moved into this trip.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <select
                          className="h-10 w-full min-w-0 flex-1 rounded-xl border border-border/80 bg-white/55 px-2 text-sm backdrop-blur-xl dark:bg-white/10"
                          value={addToGroupChoice}
                          onChange={(e) => setAddToGroupChoice(e.target.value)}
                        >
                          <option value="">Choose a bill...</option>
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
                      allowRemoveFromGroup: editingGroupId === sec.id && canEditGroup,
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

  const filtersActive = !!filterDate.trim() || !!searchQuery.trim()

  return (
    <div className="space-y-6">
      <PwaInstallPrompt />

      <section className="glass-panel rounded-[1.55rem] px-4 py-4">
        <div className="glass-inner space-y-4">
          <div className="flex flex-col gap-3">
            <div className="max-w-2xl space-y-1.5">
              <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/45 bg-white/45 px-3 py-1 text-xs font-medium text-foreground/85 backdrop-blur-xl dark:border-white/10 dark:bg-white/8">
                <Sparkles className="size-3.5 text-primary" aria-hidden />
                {HOME_OVERVIEW_ITEMS[overviewIndex]?.category ?? 'Overview'}
              </div>
              <div className="flex items-start justify-between gap-3">
                <p className="max-w-2xl text-base leading-7 text-foreground/90 sm:text-lg">
                  {HOME_OVERVIEW_ITEMS[overviewIndex]?.text}
                </p>
                <button
                  type="button"
                  className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-white/45 bg-white/40 text-muted-foreground transition-colors hover:text-foreground dark:border-white/10 dark:bg-white/8"
                  onClick={() =>
                    setOverviewIndex((current) => {
                      if (HOME_OVERVIEW_ITEMS.length <= 1) return current
                      let next = current
                      while (next === current) {
                        next = Math.floor(Math.random() * HOME_OVERVIEW_ITEMS.length)
                      }
                      return next
                    })
                  }
                  aria-label="Show another overview message"
                  title="Ganti pesan"
                >
                  <RefreshCcw className="size-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:max-w-xs">
            <div className="rounded-[1.2rem] border border-white/45 bg-white/36 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Open</p>
              <p className="mt-1 text-2xl font-semibold">{openBills.length}</p>
            </div>
            <div className="rounded-[1.2rem] border border-white/45 bg-white/36 px-3 py-3 backdrop-blur-xl dark:border-white/10 dark:bg-white/6">
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">Groups</p>
              <p className="mt-1 text-2xl font-semibold">{groupMeta.size}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex min-h-10 flex-row flex-wrap items-center justify-between gap-2 gap-y-3">
          <h2 className="min-w-0 flex-1 text-lg font-semibold tracking-tight">Open bills</h2>
          <div className="flex shrink-0 items-center gap-2">
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
                setRenamingGroupId(null)
                setGroupNameDraft('')
              }}
            >
              <Layers className="size-4" aria-hidden />
              {groupingMode ? 'Cancel grouping' : 'Create trip'}
            </Button>
            <Button
              type="button"
              variant={showFilterSearch ? 'secondary' : 'outline'}
              size="sm"
              className={`h-10 touch-manipulation ${filtersActive && !showFilterSearch ? 'ring-2 ring-primary/35' : ''}`}
              aria-expanded={showFilterSearch}
              aria-label={showFilterSearch ? 'Hide search and day filter' : 'Show search and day filter'}
              title={filtersActive ? 'Search or filters active - click to edit' : 'Search and filter by day'}
              onClick={() => setShowFilterSearch((v) => !v)}
            >
              <Search className="size-4" aria-hidden />
            </Button>
          </div>
        </div>

        {showFilterSearch ? (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            <div
              className="glass-panel flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto rounded-[1.2rem] px-2 py-1.5 sm:gap-3 sm:px-3"
              title="Shows bills for this calendar day (bill date if set, otherwise created date). Leave empty to show all."
            >
              <div className="glass-inner flex min-w-0 flex-1 flex-nowrap items-center gap-2 overflow-x-auto sm:gap-3">
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0 px-2.5 text-xs sm:px-3 sm:text-sm"
                  onClick={() => setFilterDate('')}
                >
                  Clear
                </Button>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <Label htmlFor="home-search" className="sr-only">
                Search
              </Label>
              <Input
                id="home-search"
                type="search"
                placeholder="Search title or group..."
                className="h-10 min-w-0 flex-1 text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {groupingMode ? (
          <div className="glass-panel rounded-[1.4rem] px-4 py-3">
            <div className="glass-inner flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <span className="text-xs text-muted-foreground">{selectedIds.length} selected</span>
              <Input
                placeholder="Trip name"
                className="h-10 max-w-xs text-sm"
                value={newGroupTitle}
                onChange={(e) => setNewGroupTitle(e.target.value)}
              />
              <Button type="button" size="sm" className="h-10 touch-manipulation" onClick={() => void createGroupFromSelection()}>
                Create trip
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
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

    </div>
  )
}
