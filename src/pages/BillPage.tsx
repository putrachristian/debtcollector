import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { useBill } from '@/context/BillContext'
import { useAuth } from '@/context/AuthContext'
import type { BillDraft } from '@/features/bill/BillInput'
import { BillInput, type BillInputTab } from '@/features/bill/BillInput'
import { ItemsEditor } from '@/features/bill/ItemsEditor'
import { AssignmentsPanel } from '@/features/bill/AssignmentsPanel'
import { BillResults } from '@/features/bill/BillResults'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { loadDraft } from '@/services/draftStorage'
import { APP_CURRENCY } from '@/lib/money'
import type { BillRow } from '@/types'
import { todayLocalIsoDate, formatIsoDateLabel } from '@/lib/date'
import type { BillApplyMeta } from '@/features/bill/BillInput'
import { CopyableAccountNumber } from '@/components/CopyableAccountNumber'
import { BillShareButton } from '@/components/BillShareButton'
import { billReceiptPublicUrl, uploadBillReceipt } from '@/services/receiptUpload'
import { billPublicPath, isLikelyBillUuid, resolveBillRefToId } from '@/lib/billPath'

function draftFromServer(bill: BillRow, items: ReturnType<typeof useBill>['items']): BillDraft {
  return {
    currency: bill.currency ?? APP_CURRENCY,
    items: items.map((i) => ({
      id: i.id,
      name: i.name,
      unitPriceCents: i.unit_price_cents,
      qty: i.qty,
      shareAmong: i.share_among ?? null,
    })),
    discountType: bill.discount_type,
    discountValue: Number(bill.discount_value),
    serviceChargeCents: bill.service_charge_cents,
    taxCents: bill.tax_cents,
    billDate: bill.bill_date ?? todayLocalIsoDate(),
  }
}

function isPlaceholderBillTitle(t: string | null | undefined): boolean {
  const s = (t ?? '').trim()
  return s === '' || /^new bill$/i.test(s) || /^untitled$/i.test(s)
}

export function BillPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile } = useAuth()
  const {
    billId,
    bill,
    items,
    participants,
    loading,
    error,
    setCurrentBillId,
    updateItems,
    updateBillMeta,
    deleteBill,
    persistDraft,
    restoreOfflineDraft,
    setManualDiscount,
    manualDiscount,
    joinBill,
  } = useBill()

  const [editor, setEditor] = useState<BillDraft | null>(null)
  const [addItemTab, setAddItemTab] = useState<BillInputTab>('upload')
  const [draftSource, setDraftSource] = useState<'image' | 'manual' | null>(null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [splitTab, setSplitTab] = useState<'assign' | 'results'>('assign')
  /** When false, host sees the same split flow as guests plus Edit bill. */
  const [hostEditMode, setHostEditMode] = useState(false)
  const hostOpenedBillId = useRef<string | null>(null)
  const [joinErr, setJoinErr] = useState<string | null>(null)
  const [pendingReceiptFile, setPendingReceiptFile] = useState<File | null>(null)
  const [refResolveError, setRefResolveError] = useState<string | null>(null)
  const [iAmPayer, setIAmPayer] = useState(true)
  const [payerNameEdit, setPayerNameEdit] = useState('')
  const [payerAccountEdit, setPayerAccountEdit] = useState('')

  useEffect(() => {
    if (!id) {
      setCurrentBillId(null)
      setRefResolveError(null)
      return
    }
    let cancelled = false
    setRefResolveError(null)
    void resolveBillRefToId(id).then((uuid) => {
      if (cancelled) return
      if (uuid) setCurrentBillId(uuid)
      else {
        setCurrentBillId(null)
        setRefResolveError('Bill not found.')
      }
    })
    return () => {
      cancelled = true
    }
  }, [id, setCurrentBillId])

  useEffect(() => {
    setSplitTab('assign')
  }, [id])

  useEffect(() => {
    hostOpenedBillId.current = null
  }, [id])

  const isHost = bill !== null && user !== null && bill.host_id === user.id
  const onBill =
    !!user && !!bill && (isHost || participants.some((p) => p.user_id === user.id))

  useEffect(() => {
    if (!bill?.id || !billId || bill.id !== billId || !user) return
    if (bill.host_id !== user.id) return
    if (hostOpenedBillId.current === bill.id) return
    hostOpenedBillId.current = bill.id
    setHostEditMode(false)
  }, [bill?.id, bill?.host_id, billId, user])

  useEffect(() => {
    if (!bill || !isHost) return
    if (items.length === 0) {
      setEditor(null)
      setDraftSource(null)
      return
    }
    setEditor(draftFromServer(bill, items))
    setDraftSource(null)
  }, [bill, items, isHost])

  useEffect(() => {
    setAddItemTab('upload')
  }, [bill?.id])

  useEffect(() => {
    if (!bill || !hostEditMode || !user || bill.host_id !== user.id) return
    const dn = profile?.display_name?.trim() || (user.email?.split('@')[0] ?? '') || ''
    const acct = (profile?.payment_account_number ?? '').trim()
    const bn = (bill.payer_name ?? '').trim()
    const ba = (bill.payer_account_number ?? '').trim()
    const matchesProfile = bn === dn && ba === acct
    const empty = !bn && !ba
    setIAmPayer(empty || matchesProfile)
    setPayerNameEdit(bn)
    setPayerAccountEdit(ba)
  }, [bill?.id, bill?.payer_name, bill?.payer_account_number, bill?.host_id, hostEditMode, user, profile])

  const billShareUrl = useMemo(() => {
    if (!bill) return ''
    return `${window.location.origin}${billPublicPath(bill)}`
  }, [bill])

  useEffect(() => {
    if (!bill?.slug || !id) return
    if (id === bill.slug) return
    if (id === bill.id || isLikelyBillUuid(id)) {
      navigate(`/bill/${bill.slug}`, { replace: true })
    }
  }, [bill?.slug, bill?.id, id, navigate])

  useEffect(() => {
    if (!user || !bill || bill.status === 'closed') return
    if (bill.host_id === user.id) return
    if (participants.some((p) => p.user_id === user.id)) return
    let cancelled = false
    void joinBill(bill.id)
      .then(() => {
        if (!cancelled) {
          setJoinErr(null)
          setMsg('You’re on the bill.')
        }
      })
      .catch((e) => {
        if (!cancelled) setJoinErr(e instanceof Error ? e.message : 'Could not join bill')
      })
    return () => {
      cancelled = true
    }
  }, [user, bill?.id, bill?.status, bill?.host_id, participants, joinBill])

  const save = useCallback(async () => {
    if (!editor || !bill) return
    setSaving(true)
    setMsg(null)
    try {
      await updateBillMeta({
        discount_type: editor.discountType,
        discount_value: editor.discountValue,
        service_charge_cents: editor.serviceChargeCents,
        tax_cents: editor.taxCents,
        currency: APP_CURRENCY,
        bill_date: editor.billDate ?? todayLocalIsoDate(),
      })
      await updateItems(
        editor.items.map((i) => ({
          id: i.id,
          name: i.name,
          unit_price_cents: i.unitPriceCents,
          qty: i.qty,
          share_among: i.shareAmong != null && i.shareAmong >= 2 ? i.shareAmong : null,
        }))
      )
      if (pendingReceiptFile) {
        await uploadBillReceipt(bill.id, pendingReceiptFile)
        setPendingReceiptFile(null)
      }
      setMsg('Saved')
      setHostEditMode(false)
      setSplitTab('assign')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }, [editor, bill, updateBillMeta, updateItems, pendingReceiptFile])

  async function handleDeleteBill() {
    if (!bill || bill.host_id !== user?.id) return
    if (!window.confirm('Delete this bill for all participants? This cannot be undone.')) return
    setMsg(null)
    try {
      await deleteBill()
      navigate('/', { replace: true })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  if (!user) {
    return <p className="text-sm text-muted-foreground">Sign in to view this bill.</p>
  }
  if (!id) {
    return <p className="text-sm text-muted-foreground">Missing bill link.</p>
  }
  if (refResolveError) {
    return <p className="text-sm text-destructive">{refResolveError}</p>
  }
  if (!billId) {
    return <p className="text-sm text-muted-foreground">Loading bill…</p>
  }
  if (loading && !bill) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }
  if (error) {
    return <p className="text-sm text-destructive">{error}</p>
  }
  if (!bill) {
    return <p className="text-sm text-destructive">Bill not found.</p>
  }

  const hasLocalDraft = isHost && hostEditMode && !!loadDraft(bill.id)
  const hostFullUi = isHost && hostEditMode

  const manualDraftHidden =
    editor !== null && draftSource === 'manual' && addItemTab !== 'manual'
  const showAddItemsCard =
    hostFullUi && items.length === 0 && (!editor || manualDraftHidden)
  const showLineItemsEditor =
    hostFullUi &&
    editor !== null &&
    (items.length > 0 ||
      draftSource === 'image' ||
      (draftSource === 'manual' && addItemTab === 'manual'))

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex items-center gap-1 md:hidden">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0 touch-manipulation"
          aria-label="Back"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {isHost ? (hostEditMode ? 'Host' : 'Host · pick your order') : 'Guest'}
          </p>
          <p className="truncate font-semibold leading-tight">{bill.title || 'Untitled'}</p>
        </div>
      </div>

      {hostFullUi ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              key={bill.title ?? ''}
              id="title"
              defaultValue={bill.title ?? ''}
              onBlur={(e) => {
                const v = e.target.value
                if (v !== (bill.title ?? '')) void updateBillMeta({ title: v })
              }}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Who receives payment?</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={iAmPayer ? 'default' : 'outline'}
                className="min-h-10 touch-manipulation"
                onClick={() => {
                  setIAmPayer(true)
                  if (!user) return
                  const dn =
                    profile?.display_name?.trim() || (user.email?.split('@')[0] ?? '') || null
                  const acct = profile?.payment_account_number?.trim() || null
                  void updateBillMeta({ payer_name: dn, payer_account_number: acct })
                }}
              >
                I’m the payer
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!iAmPayer ? 'default' : 'outline'}
                className="min-h-10 touch-manipulation"
                onClick={() => setIAmPayer(false)}
              >
                Someone else
              </Button>
            </div>
            {iAmPayer ? (
              <p className="text-xs text-muted-foreground">
                Guests will see your profile name and the account number from{' '}
                <Link to="/debts" className="font-medium text-primary underline-offset-2 hover:underline">
                  My debt
                </Link>
                . Add your account number there if you haven’t.
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="edit-payer-name" className="sr-only">
                    Payee name
                  </Label>
                  <Input
                    id="edit-payer-name"
                    className="min-h-10 text-base md:text-sm"
                    placeholder="Payee name"
                    value={payerNameEdit}
                    onChange={(e) => setPayerNameEdit(e.target.value)}
                    onBlur={() => {
                      const v = payerNameEdit.trim()
                      if (v !== (bill.payer_name ?? '').trim()) void updateBillMeta({ payer_name: v || null })
                    }}
                    autoComplete="name"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <Label htmlFor="edit-payer-account" className="sr-only">
                    Account number
                  </Label>
                  <Input
                    id="edit-payer-account"
                    className="min-h-10 font-mono text-base md:text-sm"
                    placeholder="Account / e-wallet number"
                    value={payerAccountEdit}
                    onChange={(e) => setPayerAccountEdit(e.target.value)}
                    onBlur={() => {
                      const v = payerAccountEdit.trim()
                      if (v !== (bill.payer_account_number ?? '').trim()) {
                        void updateBillMeta({ payer_account_number: v || null })
                      }
                    }}
                    inputMode="numeric"
                  />
                </div>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Trip groups are managed on{' '}
            <Link to="/" className="font-medium text-primary underline-offset-2 hover:underline">
              Home
            </Link>{' '}
            (create a group, add bills, or remove a bill from a group).
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader className="space-y-1 py-3">
            <CardTitle className="text-base">{bill.title || 'Untitled'}</CardTitle>
            {bill.bill_date ? (
              <p className="text-sm text-muted-foreground">Bill date: {formatIsoDateLabel(bill.bill_date)}</p>
            ) : null}
            {bill.payer_name?.trim() || bill.payer_account_number?.trim() ? (
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-md border border-border/80 bg-muted/30 px-3 py-2 text-sm">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Pay to</span>
                {bill.payer_name?.trim() ? <span className="font-medium">{bill.payer_name.trim()}</span> : null}
                {bill.payer_account_number?.trim() ? (
                  <CopyableAccountNumber value={bill.payer_account_number.trim()} copyLabel="Copy payee account number" />
                ) : null}
              </div>
            ) : null}
          </CardHeader>
        </Card>
      )}

      {bill.receipt_image_path ? (
        <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
          <img
            src={billReceiptPublicUrl(bill.receipt_image_path)}
            alt="Receipt"
            className="mx-auto max-h-[min(70vh,560px)] w-full object-contain"
          />
        </div>
      ) : null}

      {joinErr ? <p className="text-sm text-destructive">{joinErr}</p> : null}

      {isHost && bill.status !== 'closed' ? (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-base">Share this bill</CardTitle>
            <p className="text-xs text-muted-foreground">
              Anyone with the link can open the bill; sign-in is still required to pick items and see totals.
            </p>
          </CardHeader>
          <CardContent className="pt-0">
            <BillShareButton billUrl={billShareUrl} title={bill.title ?? 'Bill'} />
          </CardContent>
        </Card>
      ) : null}

      {isHost && !hostEditMode ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Button
            type="button"
            className="min-h-12 w-full touch-manipulation gap-2 sm:w-auto sm:min-h-10"
            onClick={() => setHostEditMode(true)}
          >
            <Pencil className="size-4 shrink-0" />
            Edit bill
          </Button>
          <p className="text-sm text-muted-foreground">
            Change line items or close the bill. Otherwise use{' '}
            <span className="font-medium text-foreground">My order</span> below like everyone else.
          </p>
        </div>
      ) : null}

      {!hostFullUi ? (
        <p className="text-sm text-muted-foreground">
          {isHost
            ? 'Use My order to set your units, then My total to see what you owe. Use Edit bill to change the receipt or settings.'
            : 'Only the host can change line items and charges. Use My order to set your share, then My total for your amount.'}
        </p>
      ) : null}

      {hostFullUi ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="secondary"
            className="min-h-11 w-full touch-manipulation sm:w-auto sm:min-h-9"
            onClick={() => persistDraft()}
          >
            Save offline draft
          </Button>
          {hasLocalDraft ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full touch-manipulation sm:w-auto sm:min-h-9"
              onClick={() => void restoreOfflineDraft().then((ok) => setMsg(ok ? 'Draft restored' : 'No draft'))}
            >
              Restore offline draft
            </Button>
          ) : null}
        </div>
      ) : null}

      {isHost && !hostEditMode && items.length === 0 ? (
        <p className="text-sm text-amber-600 dark:text-amber-500">
          This bill has no lines yet. Tap Edit bill to add items.
        </p>
      ) : null}

      {showAddItemsCard ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add items</CardTitle>
            <p className="text-xs text-muted-foreground">
              Scan a receipt from Upload or Photo, or open Manual to type lines.
            </p>
          </CardHeader>
          <CardContent>
            <BillInput
              tab={addItemTab}
              onTabChange={setAddItemTab}
              onApply={(d, source, meta?: BillApplyMeta) => {
                setEditor(d)
                setDraftSource(source)
                if (meta?.receiptFile) setPendingReceiptFile(meta.receiptFile)
                else if (source === 'manual') setPendingReceiptFile(null)
                const name = d.billTitle?.trim()
                if (name && bill && user && bill.host_id === user.id && isPlaceholderBillTitle(bill.title)) {
                  void updateBillMeta({ title: name })
                }
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      {showLineItemsEditor ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line items & charges</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemsEditor draft={editor} onChange={setEditor} onSave={() => void save()} disabled={saving} />
          </CardContent>
        </Card>
      ) : null}

      {hostFullUi ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Manual discount merge (optional)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Type</Label>
              <select
                className="h-11 w-full rounded-md border border-border bg-card px-2 text-base md:h-9 md:text-sm"
                value={manualDiscount?.kind ?? 'percent'}
                onChange={(e) =>
                  setManualDiscount({
                    kind: e.target.value as 'percent' | 'amount',
                    value: manualDiscount?.value ?? 0,
                  })
                }
              >
                <option value="percent">Percent (bps)</option>
                <option value="amount">Amount (cents)</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>Value</Label>
              <Input
                type="number"
                value={manualDiscount?.value ?? 0}
                onChange={(e) =>
                  setManualDiscount({
                    kind: manualDiscount?.kind ?? 'percent',
                    value: Math.round(Number(e.target.value) || 0),
                  })
                }
              />
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={() => setManualDiscount(null)}>
              Clear manual discount
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {hostFullUi ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 touch-manipulation sm:min-h-9"
            onClick={() => setHostEditMode(false)}
          >
            Done editing
          </Button>
          <span className="text-xs text-muted-foreground">Return to pick-your-order view.</span>
        </div>
      ) : null}

      <Tabs value={splitTab} onValueChange={(v) => setSplitTab(v as 'assign' | 'results')}>
        <TabsList className="grid h-auto w-full grid-cols-2 gap-0.5 p-1 sm:inline-flex sm:h-9 sm:w-auto sm:items-center sm:gap-0 sm:p-1">
          <TabsTrigger
            value="assign"
            className="min-h-11 w-full touch-manipulation sm:min-h-0 sm:w-auto sm:py-1"
          >
            My order
          </TabsTrigger>
          <TabsTrigger
            value="results"
            className="min-h-11 w-full touch-manipulation sm:min-h-0 sm:w-auto sm:py-1"
          >
            My total
          </TabsTrigger>
        </TabsList>
        <TabsContent value="assign">
          {onBill ? (
            <AssignmentsPanel onOrderConfirmed={() => setSplitTab('results')} />
          ) : (
            <p className="text-sm text-muted-foreground">Joining the bill… you can pick your order in a moment.</p>
          )}
        </TabsContent>
        <TabsContent value="results">
          {onBill ? (
            <BillResults />
          ) : (
            <p className="text-sm text-muted-foreground">Joining the bill… your total will load shortly.</p>
          )}
        </TabsContent>
      </Tabs>

      {hostFullUi ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Button
            type="button"
            variant="secondary"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            onClick={() => void updateBillMeta({ status: 'closed' })}
          >
            Close bill
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            onClick={() => void handleDeleteBill()}
          >
            Delete bill
          </Button>
        </div>
      ) : null}

      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
    </div>
  )
}
