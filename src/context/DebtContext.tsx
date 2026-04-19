import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/services/supabase'
import { useAuth } from '@/context/AuthContext'
import { calculateUserSharePartial } from '@/lib/calculateBill'
import type { BillRow, BillItemRow, ItemAssignmentRow, ParticipantRow, PaymentRow, Profile } from '@/types'
import { billPublicPath } from '@/lib/billPath'

export type OutstandingDebt = {
  billId: string
  billPath: string
  title: string | null
  hostId: string
  hostDisplayName: string
  shareTotalCents: number
  settledCents: number
  remainingCents: number
  /** Who to transfer to (host profile name, or payee name from the bill when you host but aren’t the payer). */
  payToLabel: string
  /** Payee account from the bill when you host but someone else receives payment (for display only). */
  payToAccountHint: string | null
  /**
   * `payments.to_user_id` when recording “Confirm paid”: the host if you owe them, or **your own user id** if you
   * hosted and paid someone off-app (self-referencing row — only for your ledger; money did not go to another app user).
   */
  paymentToUserId: string
}

type DebtContextValue = {
  payments: PaymentRow[]
  outstandingDebts: OutstandingDebt[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  /** `toUserId` is usually the host; use your own user id when you settled to an external payee (see OutstandingDebt). */
  recordBillSharePaid: (input: { billId: string; toUserId: string; amountCents: number }) => Promise<void>
  requestSettlement: (input: {
    toUserId: string
    amountCents: number
    billId?: string | null
  }) => Promise<string>
  uploadProof: (paymentId: string, file: File) => Promise<void>
  confirmPayment: (paymentId: string) => Promise<void>
  rejectPayment: (paymentId: string) => Promise<void>
}

const DebtContext = createContext<DebtContextValue | null>(null)

/** True when the bill’s payee fields match the host’s profile (I’m the payer / you receive transfers). */
function hostIsBillPayee(b: BillRow, profile: Profile | null, user: { id: string; email?: string | null }): boolean {
  const dn = profile?.display_name?.trim() || (user.email?.split('@')[0] ?? '') || ''
  const acct = (profile?.payment_account_number ?? '').trim()
  const pn = (b.payer_name ?? '').trim()
  const pa = (b.payer_account_number ?? '').trim()
  if (!pn && !pa) return true
  return pn === dn && pa === acct
}

export function DebtProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth()
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [outstandingDebts, setOutstandingDebts] = useState<OutstandingDebt[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPayments = useCallback(async () => {
    if (!user) {
      setPayments([])
      return
    }
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .or(`from_user_id.eq.${user.id},to_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false })
    if (error) throw error
    setPayments((data as PaymentRow[]) ?? [])
  }, [user])

  const loadOutstandingDebts = useCallback(async () => {
    if (!user) {
      setOutstandingDebts([])
      return
    }

    const { data: partRows, error: pe } = await supabase
      .from('participants')
      .select('bill_id')
      .eq('user_id', user.id)
    if (pe) throw pe
    const billIds = [...new Set((partRows ?? []).map((r) => (r as { bill_id: string }).bill_id))]
    if (billIds.length === 0) {
      setOutstandingDebts([])
      return
    }

    const { data: billsRaw, error: be } = await supabase.from('bills').select('*').in('id', billIds)
    if (be) throw be
    const bills = (billsRaw as BillRow[]) ?? []
    if (bills.length === 0) {
      setOutstandingDebts([])
      return
    }

    const owingIds = bills.map((b) => b.id)
    const [{ data: itemsRaw, error: ie }, { data: allParticipants, error: pae }, { data: payRows, error: paye }] =
      await Promise.all([
        supabase.from('bill_items').select('*').in('bill_id', owingIds),
        supabase.from('participants').select('*').in('bill_id', owingIds),
        supabase
          .from('payments')
          .select('*')
          .eq('from_user_id', user.id)
          .eq('status', 'settled')
          .in('bill_id', owingIds),
      ])
    if (ie) throw ie
    if (pae) throw pae
    if (paye) throw paye

    const items = (itemsRaw as BillItemRow[]) ?? []
    const participants = (allParticipants as ParticipantRow[]) ?? []
    const settledPayments = (payRows as PaymentRow[]) ?? []

    const itemsByBill = new Map<string, BillItemRow[]>()
    for (const it of items) {
      const list = itemsByBill.get(it.bill_id) ?? []
      list.push(it)
      itemsByBill.set(it.bill_id, list)
    }

    const participantsByBill = new Map<string, ParticipantRow[]>()
    for (const p of participants) {
      const list = participantsByBill.get(p.bill_id) ?? []
      list.push(p)
      participantsByBill.set(p.bill_id, list)
    }

    const itemIds = items.map((it) => it.id)
    let assigns: ItemAssignmentRow[] = []
    if (itemIds.length > 0) {
      const { data: asg, error: ae } = await supabase.from('item_assignments').select('*').in('bill_item_id', itemIds)
      if (ae) throw ae
      assigns = (asg as ItemAssignmentRow[]) ?? []
    }

    const assignsByItem = new Map<string, ItemAssignmentRow[]>()
    for (const a of assigns) {
      const list = assignsByItem.get(a.bill_item_id) ?? []
      list.push(a)
      assignsByItem.set(a.bill_item_id, list)
    }

    const settledByBill = new Map<string, number>()
    for (const p of settledPayments) {
      if (!p.bill_id) continue
      settledByBill.set(p.bill_id, (settledByBill.get(p.bill_id) ?? 0) + p.amount_cents)
    }

    const hostIds = [...new Set(bills.map((b) => b.host_id))]
    const { data: profs, error: profe } = await supabase
      .from('profiles')
      .select('id, display_name')
      .in('id', hostIds)
    if (profe) throw profe
    const hostNames: Record<string, string> = {}
    for (const row of (profs as { id: string; display_name: string | null }[]) ?? []) {
      const dn = row.display_name?.trim()
      hostNames[row.id] = dn && dn.length > 0 ? dn : `${row.id.slice(0, 8)}…`
    }

    const out: OutstandingDebt[] = []
    for (const b of bills) {
      const its = itemsByBill.get(b.id) ?? []
      const parts = participantsByBill.get(b.id) ?? []
      const localAssignments: ItemAssignmentRow[] = []
      for (const it of its) {
        const rows = assignsByItem.get(it.id) ?? []
        localAssignments.push(...rows)
      }
      const participantIds = [
        ...new Set([b.host_id, ...parts.map((p) => p.user_id), ...localAssignments.map((a) => a.user_id)]),
      ].sort((a, c) => a.localeCompare(c))

      const share = calculateUserSharePartial({
        items: its.map((it) => ({
          id: it.id,
          name: it.name,
          unitPriceCents: it.unit_price_cents,
          qty: it.qty,
          shareAmong: it.share_among ?? null,
        })),
        participantIds,
        assignments: localAssignments.map((a) => ({
          billItemId: a.bill_item_id,
          userId: a.user_id,
          mode: a.mode,
          claimedQty: a.claimed_qty ?? 1,
        })),
        billDiscount:
          b.discount_type === 'percent'
            ? { kind: 'percent' as const, value: Math.round(Number(b.discount_value)) }
            : { kind: 'amount' as const, value: Math.round(Number(b.discount_value)) },
        serviceChargeCents: b.service_charge_cents,
        taxCents: b.tax_cents,
        viewerId: user.id,
      })

      if (!share.ok) continue

      const settledCents = settledByBill.get(b.id) ?? 0
      const remainingCents = Math.max(0, share.totalCents - settledCents)
      if (remainingCents <= 0) continue

      const viewerHosts = b.host_id === user.id
      if (viewerHosts && hostIsBillPayee(b, profile, user)) {
        continue
      }

      const hostLabel = hostNames[b.host_id] ?? `${b.host_id.slice(0, 8)}…`
      let payToLabel: string
      let payToAccountHint: string | null = null
      /** Host receives in-app payment record; if you’re the host paying an external payee, we store from=to=self so it still counts toward settled share. */
      const paymentToUserId = viewerHosts ? user.id : b.host_id

      if (viewerHosts) {
        payToLabel = (b.payer_name ?? '').trim() || 'Payee (see bill)'
        const acct = (b.payer_account_number ?? '').trim()
        payToAccountHint = acct || null
      } else {
        payToLabel = hostLabel
      }

      out.push({
        billId: b.id,
        billPath: billPublicPath(b as BillRow),
        title: b.title,
        hostId: b.host_id,
        hostDisplayName: hostLabel,
        shareTotalCents: share.totalCents,
        settledCents,
        remainingCents,
        payToLabel,
        payToAccountHint,
        paymentToUserId,
      })
    }

    out.sort((a, b) => b.remainingCents - a.remainingCents)
    setOutstandingDebts(out)
  }, [user, profile])

  const refresh = useCallback(async () => {
    if (!user) {
      setPayments([])
      setOutstandingDebts([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      await Promise.all([loadPayments(), loadOutstandingDebts()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }, [user, loadPayments, loadOutstandingDebts])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!user) return
    const ch = supabase
      .channel('debt-payments-sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `from_user_id=eq.${user.id}` },
        () => void refresh()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'payments', filter: `to_user_id=eq.${user.id}` },
        () => void refresh()
      )
      .subscribe()
    return () => {
      void ch.unsubscribe()
    }
  }, [user, refresh])

  const recordBillSharePaid = useCallback(
    async (input: { billId: string; toUserId: string; amountCents: number }) => {
      if (!user) throw new Error('Sign in required')
      if (input.amountCents <= 0) throw new Error('Amount must be positive')
      const { error } = await supabase.from('payments').insert({
        from_user_id: user.id,
        to_user_id: input.toUserId,
        bill_id: input.billId,
        amount_cents: input.amountCents,
        status: 'settled',
        confirmed_at: new Date().toISOString(),
      })
      if (error) throw error
      await refresh()
    },
    [user, refresh]
  )

  const requestSettlement = useCallback(
    async (input: { toUserId: string; amountCents: number; billId?: string | null }) => {
      if (!user) throw new Error('Sign in required')
      const { data, error } = await supabase
        .from('payments')
        .insert({
          from_user_id: user.id,
          to_user_id: input.toUserId,
          bill_id: input.billId ?? null,
          amount_cents: input.amountCents,
          status: 'pending_proof',
        })
        .select('id')
        .single()
      if (error) throw error
      await refresh()
      return (data as { id: string }).id
    },
    [user, refresh]
  )

  const uploadProof = useCallback(
    async (paymentId: string, file: File) => {
      if (!user) throw new Error('Sign in required')
      const path = `${user.id}/${paymentId}/${file.name}`
      const { error: upErr } = await supabase.storage.from('payment-proofs').upload(path, file, {
        upsert: true,
      })
      if (upErr) throw upErr
      const { error } = await supabase
        .from('payments')
        .update({ proof_path: path, status: 'awaiting_confirmation' })
        .eq('id', paymentId)
        .eq('from_user_id', user.id)
      if (error) throw error
      await refresh()
    },
    [user, refresh]
  )

  const confirmPayment = useCallback(
    async (paymentId: string) => {
      if (!user) throw new Error('Sign in required')
      const { error } = await supabase
        .from('payments')
        .update({ status: 'settled', confirmed_at: new Date().toISOString() })
        .eq('id', paymentId)
        .eq('to_user_id', user.id)
      if (error) throw error
      await refresh()
    },
    [user, refresh]
  )

  const rejectPayment = useCallback(
    async (paymentId: string) => {
      if (!user) throw new Error('Sign in required')
      const { error } = await supabase
        .from('payments')
        .update({ status: 'rejected' })
        .eq('id', paymentId)
        .eq('to_user_id', user.id)
      if (error) throw error
      await refresh()
    },
    [user, refresh]
  )

  const value = useMemo(
    () => ({
      payments,
      outstandingDebts,
      loading,
      error,
      refresh,
      recordBillSharePaid,
      requestSettlement,
      uploadProof,
      confirmPayment,
      rejectPayment,
    }),
    [
      payments,
      outstandingDebts,
      loading,
      error,
      refresh,
      recordBillSharePaid,
      requestSettlement,
      uploadProof,
      confirmPayment,
      rejectPayment,
    ]
  )

  return <DebtContext.Provider value={value}>{children}</DebtContext.Provider>
}

export function useDebt(): DebtContextValue {
  const ctx = useContext(DebtContext)
  if (!ctx) throw new Error('useDebt must be used within DebtProvider')
  return ctx
}
