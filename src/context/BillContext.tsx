import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/AuthContext'
import {
  calculateBill,
  calculateUserSharePartial,
  type CalculateBillResult,
  type UserSharePartialResult,
} from '@/lib/calculateBill'
import { APP_CURRENCY } from '@/lib/money'
import type { AssignmentMode, BillItemRow, BillRow, ItemAssignmentRow, ParticipantRow } from '@/types'
import { clearDraft } from '@/services/draftStorage'

type LocalItem = {
  id: string
  name: string
  unit_price_cents: number
  qty: number
  line_subtotal_cents: number
  share_among: number | null
}

type BillContextValue = {
  billId: string | null
  bill: BillRow | null
  items: LocalItem[]
  participants: ParticipantRow[]
  assignments: ItemAssignmentRow[]
  manualDiscount: { kind: 'percent' | 'amount'; value: number } | null
  loading: boolean
  error: string | null
  setCurrentBillId: (id: string | null) => void
  createBill: (title?: string) => Promise<{ id: string; publicPath: string }>
  deleteBill: () => Promise<void>
  /** Delete any bill you host (e.g. from home list without opening the bill). */
  deleteBillById: (targetBillId: string) => Promise<void>
  joinBill: (billId: string) => Promise<string>
  refresh: (overrideBillId?: string) => Promise<void>
  updateBillMeta: (
    patch: Partial<
      Pick<
        BillRow,
        | 'title'
        | 'status'
        | 'discount_type'
        | 'discount_value'
        | 'service_charge_cents'
        | 'tax_cents'
        | 'currency'
        | 'bill_date'
        | 'receipt_image_path'
        | 'payer_name'
        | 'payer_account_number'
        | 'group_id'
      >
    >,
    /** Use right after `createBill` returns, before React commits `billId` to context. */
    targetBillId?: string
  ) => Promise<void>
  updateItems: (
    items: Omit<LocalItem, 'line_subtotal_cents'>[],
    targetBillId?: string
  ) => Promise<void>
  /** Host-only bulk set (legacy). Guests use `claimBillItem`. */
  assignItem: (billItemId: string, userIds: string[], mode: AssignmentMode) => Promise<void>
  claimBillItem: (billItemId: string, claim: boolean) => Promise<void>
  /** Set how many units of each line are yours (0 = remove); batch then one refresh. */
  applyMyLineQty: (changes: { billItemId: string; qty: number }[]) => Promise<void>
  /** Participant or host: set/clear shared-dish slot count (≥2); clear only when nobody has claimed. */
  setItemShareAmong: (billItemId: string, shareAmong: number | null) => Promise<void>
  participantLabel: (userId: string) => string
  setManualDiscount: (d: { kind: 'percent' | 'amount'; value: number } | null) => void
  calculateResult: () => CalculateBillResult
  /** Your share from lines you claimed; works before the whole bill is fully assigned. */
  calculateMySharePartial: () => UserSharePartialResult
}

const BillContext = createContext<BillContextValue | null>(null)

export function BillProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [billId, setBillId] = useState<string | null>(null)
  const [bill, setBill] = useState<BillRow | null>(null)
  const [items, setItems] = useState<LocalItem[]>([])
  const [participants, setParticipants] = useState<ParticipantRow[]>([])
  const [assignments, setAssignments] = useState<ItemAssignmentRow[]>([])
  const [participantNames, setParticipantNames] = useState<Record<string, string>>({})
  const [manualDiscount, setManualDiscount] = useState<{
    kind: 'percent' | 'amount'
    value: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null)

  const refresh = useCallback(
    async (overrideBillId?: string) => {
      const id = overrideBillId ?? billId
      if (!id || !user) return
      setLoading(true)
      setError(null)
      try {
        const [{ data: b, error: eb }, { data: its, error: ei }, { data: ps, error: ep }] = await Promise.all([
          supabase.from('bills').select('*').eq('id', id).single(),
          supabase.from('bill_items').select('*').eq('bill_id', id),
          supabase.from('participants').select('*').eq('bill_id', id),
        ])
        if (eb) throw eb
        if (ei) throw ei
        if (ep) throw ep
        const itemRows = (its as BillItemRow[]) ?? []
        const itemIds = itemRows.map((r) => r.id)
        let assigns: ItemAssignmentRow[] = []
        if (itemIds.length > 0) {
          const { data: as, error: ea } = await supabase
            .from('item_assignments')
            .select('*')
            .in('bill_item_id', itemIds)
          if (ea) throw ea
          assigns = (as as ItemAssignmentRow[]) ?? []
        }
        setBill(b as BillRow)
        setItems(
          itemRows.map((r) => ({
            id: r.id,
            name: r.name,
            unit_price_cents: r.unit_price_cents,
            qty: r.qty,
            line_subtotal_cents: r.line_subtotal_cents,
            share_among: r.share_among != null && r.share_among >= 2 ? r.share_among : null,
          }))
        )
        const partRows = (ps as ParticipantRow[]) ?? []
        setParticipants(partRows)
        const billRow = b as BillRow
        const ids = [
          ...new Set([
            billRow.host_id,
            ...partRows.map((p) => p.user_id),
            ...assigns.map((a) => a.user_id),
          ]),
        ]
        let names: Record<string, string> = {}
        if (ids.length > 0) {
          const { data: profs, error: epr } = await supabase.from('profiles').select('id, display_name').in('id', ids)
          if (!epr && profs) {
            for (const row of profs as { id: string; display_name: string | null }[]) {
              const dn = row.display_name?.trim()
              names[row.id] = dn && dn.length > 0 ? dn : `${row.id.slice(0, 8)}…`
            }
          }
        }
        for (const id of ids) {
          if (!names[id]) names[id] = `${id.slice(0, 8)}…`
        }
        setParticipantNames(names)
        setAssignments(assigns)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load bill')
      } finally {
        setLoading(false)
      }
    },
    [billId, user]
  )

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!billId) {
      channelRef.current?.unsubscribe()
      channelRef.current = null
      return
    }
    const ch = supabase
      .channel(`bill:${billId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bills', filter: `id=eq.${billId}` },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'bill_items', filter: `bill_id=eq.${billId}` },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'participants', filter: `bill_id=eq.${billId}` },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'item_assignments' },
        () => void refresh()
      )
      .subscribe()
    channelRef.current = ch
    return () => {
      void ch.unsubscribe()
      channelRef.current = null
    }
  }, [billId, refresh])

  const setCurrentBillId = useCallback((id: string | null) => {
    setBillId(id)
    setBill(null)
    setItems([])
    setParticipants([])
    setAssignments([])
    setParticipantNames({})
    setManualDiscount(null)
  }, [])

  const createBill = useCallback(async (title?: string) => {
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession()
    if (sessionError || !session?.user) {
      throw new Error('Your session expired. Sign in again.')
    }
    const { data, error } = await supabase.rpc('create_bill', {
      p_title: title ?? 'New bill',
      p_status: 'open',
      p_currency: APP_CURRENCY,
    })
    if (error) throw error
    const id = data as string
    setBillId(id)
    await refresh(id)
    const { data: row } = await supabase.from('bills').select('slug').eq('id', id).maybeSingle()
    const slug = (row as { slug?: string | null } | null)?.slug?.trim()
    const publicPath = slug && slug.length > 0 ? `/bill/${slug}` : `/bill/${id}`
    return { id, publicPath }
  }, [refresh])

  const deleteBill = useCallback(async () => {
    if (!billId) throw new Error('No bill')
    const { error } = await supabase.from('bills').delete().eq('id', billId)
    if (error) throw error
    clearDraft(billId)
    setBillId(null)
    setBill(null)
    setItems([])
    setParticipants([])
    setAssignments([])
    setParticipantNames({})
    setManualDiscount(null)
  }, [billId])

  const deleteBillById = useCallback(async (targetBillId: string) => {
    const { error } = await supabase.from('bills').delete().eq('id', targetBillId)
    if (error) throw error
    clearDraft(targetBillId)
    if (billId === targetBillId) {
      setBillId(null)
      setBill(null)
      setItems([])
      setParticipants([])
      setAssignments([])
      setParticipantNames({})
      setManualDiscount(null)
    }
  }, [billId])

  const joinBill = useCallback(
    async (targetBillId: string) => {
      const { data, error } = await supabase.rpc('join_bill_by_id', {
        p_bill_id: targetBillId,
      })
      if (error) throw error
      const id = data as string
      setBillId(id)
      await refresh(id)
      return id
    },
    [refresh]
  )

  const updateBillMeta = useCallback(
    async (
      patch: Partial<
        Pick<
          BillRow,
          | 'title'
          | 'status'
          | 'discount_type'
          | 'discount_value'
          | 'service_charge_cents'
          | 'tax_cents'
          | 'currency'
        | 'bill_date'
        | 'receipt_image_path'
        | 'payer_name'
        | 'payer_account_number'
        | 'group_id'
        >
      >,
      targetBillId?: string
    ) => {
      const id = targetBillId ?? billId
      if (!id) throw new Error('No bill')
      const { error } = await supabase.from('bills').update(patch).eq('id', id)
      if (error) throw error
      await refresh(id)
    },
    [billId, refresh]
  )

  const updateItems = useCallback(
    async (next: Omit<LocalItem, 'line_subtotal_cents'>[], targetBillId?: string) => {
      const id = targetBillId ?? billId
      if (!id) throw new Error('No bill')
      const { data: existing, error: exErr } = await supabase.from('bill_items').select('id').eq('bill_id', id)
      if (exErr) throw exErr
      const oldIds = ((existing as { id: string }[]) ?? []).map((r) => r.id)
      if (oldIds.length > 0) {
        const { error: aDel } = await supabase.from('item_assignments').delete().in('bill_item_id', oldIds)
        if (aDel) throw aDel
      }
      const { error: delErr } = await supabase.from('bill_items').delete().eq('bill_id', id)
      if (delErr) throw delErr
      const insertPayload = next.map((r) => ({
        bill_id: id,
        name: r.name,
        unit_price_cents: r.unit_price_cents,
        qty: r.qty,
        line_subtotal_cents: r.unit_price_cents * r.qty,
        share_among: r.share_among != null && r.share_among >= 2 ? r.share_among : null,
      }))
      const { data, error } = await supabase.from('bill_items').insert(insertPayload).select('*')
      if (error) throw error
      setItems(
        (data as BillItemRow[]).map((r) => ({
          id: r.id,
          name: r.name,
          unit_price_cents: r.unit_price_cents,
          qty: r.qty,
          line_subtotal_cents: r.line_subtotal_cents,
          share_among: r.share_among != null && r.share_among >= 2 ? r.share_among : null,
        }))
      )
      await refresh(id)
    },
    [billId, refresh]
  )

  const assignItem = useCallback(
    async (billItemId: string, userIds: string[], mode: AssignmentMode) => {
      if (!billId || !user) throw new Error('Not signed in')
      const { data: hostRow, error: he } = await supabase.from('bills').select('host_id').eq('id', billId).single()
      if (he) throw he
      if ((hostRow as { host_id: string }).host_id !== user.id) {
        throw new Error('Only the host can set assignments this way')
      }
      const { error: derr } = await supabase.from('item_assignments').delete().eq('bill_item_id', billItemId)
      if (derr) throw derr
      if (userIds.length === 0) return
      const row = items.find((x) => x.id === billItemId)
      const lineQty = row?.qty ?? 1
      const shareN = row?.share_among != null && row.share_among >= 2 ? row.share_among : null
      const cap = shareN ?? lineQty
      const n = userIds.length
      const sorted = [...userIds].sort((a, b) => a.localeCompare(b))
      const payload = sorted.map((user_id, idx) => ({
        bill_item_id: billItemId,
        user_id,
        mode,
        claimed_qty: Math.floor(cap / n) + (idx < cap % n ? 1 : 0),
      }))
      const { error } = await supabase.from('item_assignments').insert(payload)
      if (error) throw error
      await refresh()
    },
    [billId, user, items, refresh]
  )

  const claimBillItem = useCallback(
    async (billItemId: string, claim: boolean) => {
      const { error } = await supabase.rpc('claim_bill_item', {
        p_bill_item_id: billItemId,
        p_claim: claim,
      })
      if (error) throw error
      await refresh()
    },
    [refresh]
  )

  const applyMyLineQty = useCallback(
    async (changes: { billItemId: string; qty: number }[]) => {
      for (const { billItemId, qty } of changes) {
        const { error } = await supabase.rpc('set_my_item_claim_qty', {
          p_bill_item_id: billItemId,
          p_qty: qty,
        })
        if (error) throw error
      }
      if (changes.length > 0) await refresh()
    },
    [refresh]
  )

  const setItemShareAmong = useCallback(
    async (billItemId: string, shareAmong: number | null) => {
      const { error } = await supabase.rpc('set_bill_item_share_among', {
        p_bill_item_id: billItemId,
        p_share_among: shareAmong,
      })
      if (error) throw error
      await refresh()
    },
    [refresh]
  )

  const participantLabel = useCallback(
    (userId: string) => participantNames[userId] ?? `${userId.slice(0, 8)}…`,
    [participantNames]
  )

  const calculateResult = useCallback((): CalculateBillResult => {
    if (!bill) {
      return { ok: false, errors: ['No bill loaded'] }
    }
    const participantIds = [
      ...new Set([
        bill.host_id,
        ...participants.map((p) => p.user_id),
        ...assignments.map((a) => a.user_id),
      ]),
    ].sort((a, b) => a.localeCompare(b))
    const billDiscount =
      bill.discount_type === 'percent'
        ? { kind: 'percent' as const, value: Math.round(Number(bill.discount_value)) }
        : { kind: 'amount' as const, value: Math.round(Number(bill.discount_value)) }
    return calculateBill({
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        unitPriceCents: i.unit_price_cents,
        qty: i.qty,
        shareAmong: i.share_among,
      })),
      participantIds,
      assignments: assignments.map((a) => ({
        billItemId: a.bill_item_id,
        userId: a.user_id,
        mode: a.mode,
        claimedQty: a.claimed_qty ?? 1,
      })),
      billDiscount,
      manualDiscount: manualDiscount ?? undefined,
      serviceChargeCents: bill.service_charge_cents,
      taxCents: bill.tax_cents,
    })
  }, [bill, items, participants, assignments, manualDiscount])

  const calculateMySharePartial = useCallback((): UserSharePartialResult => {
    if (!bill || !user) {
      return { ok: false, errors: ['No bill loaded'] }
    }
    const participantIds = [
      ...new Set([
        bill.host_id,
        ...participants.map((p) => p.user_id),
        ...assignments.map((a) => a.user_id),
      ]),
    ].sort((a, b) => a.localeCompare(b))
    const billDiscount =
      bill.discount_type === 'percent'
        ? { kind: 'percent' as const, value: Math.round(Number(bill.discount_value)) }
        : { kind: 'amount' as const, value: Math.round(Number(bill.discount_value)) }
    return calculateUserSharePartial({
      items: items.map((i) => ({
        id: i.id,
        name: i.name,
        unitPriceCents: i.unit_price_cents,
        qty: i.qty,
        shareAmong: i.share_among,
      })),
      participantIds,
      assignments: assignments.map((a) => ({
        billItemId: a.bill_item_id,
        userId: a.user_id,
        mode: a.mode,
        claimedQty: a.claimed_qty ?? 1,
      })),
      billDiscount,
      manualDiscount: manualDiscount ?? undefined,
      serviceChargeCents: bill.service_charge_cents,
      taxCents: bill.tax_cents,
      viewerId: user.id,
    })
  }, [bill, user, items, participants, assignments, manualDiscount])

  const value = useMemo(
    () => ({
      billId,
      bill,
      items,
      participants,
      assignments,
      manualDiscount,
      loading,
      error,
      setCurrentBillId,
      createBill,
      deleteBill,
      deleteBillById,
      joinBill,
      refresh,
      updateBillMeta,
      updateItems,
      assignItem,
      claimBillItem,
      applyMyLineQty,
      setItemShareAmong,
      participantLabel,
      setManualDiscount,
      calculateResult,
      calculateMySharePartial,
    }),
    [
      billId,
      bill,
      items,
      participants,
      assignments,
      participantNames,
      manualDiscount,
      loading,
      error,
      setCurrentBillId,
      createBill,
      deleteBill,
      deleteBillById,
      joinBill,
      refresh,
      updateBillMeta,
      updateItems,
      assignItem,
      claimBillItem,
      applyMyLineQty,
      setItemShareAmong,
      participantLabel,
      calculateResult,
      calculateMySharePartial,
    ]
  )

  return <BillContext.Provider value={value}>{children}</BillContext.Provider>
}

export function useBill(): BillContextValue {
  const ctx = useContext(BillContext)
  if (!ctx) throw new Error('useBill must be used within BillProvider')
  return ctx
}
