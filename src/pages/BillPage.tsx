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
import { APP_CURRENCY } from '@/lib/money'
import type { BillRow } from '@/types'
import { todayLocalIsoDate, formatIsoDateLabel } from '@/lib/date'
import type { BillApplyMeta } from '@/features/bill/BillInput'
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

  const hostFullUi = isHost && hostEditMode
  /** Normal “pick your order” view — fixed bottom tabs + FABs; not host line-item editing. */
  const pickOrderView = !hostFullUi
  const showOrderFab =
    pickOrderView && splitTab === 'assign' && isHost && bill.status !== 'closed'

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
    <div
      className={
        pickOrderView
          ? 'space-y-5 pb-28 pt-0 md:space-y-6 md:pb-32'
          : 'space-y-5 md:space-y-6'
      }
    >
      <header
        className="sticky z-30 -mx-4 -mt-4 mb-0 flex items-start gap-2 border-b border-border/70 bg-background/95 px-4 pb-3 pt-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/85"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 3.5rem)',
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="mt-0.5 size-11 shrink-0 touch-manipulation md:hidden"
          aria-label="Back"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="size-5" />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted-foreground">
            {isHost ? (hostEditMode ? 'Host' : 'Host · pick your order') : 'Guest'}
          </p>
          <h1 className="truncate text-xl font-semibold leading-tight tracking-tight md:text-2xl">
            {bill.title || 'Untitled'}
          </h1>
          {bill.bill_date ? (
            <p className="text-sm text-muted-foreground">{formatIsoDateLabel(bill.bill_date)}</p>
          ) : null}
        </div>
      </header>

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
      ) : null}

      {joinErr ? <p className="text-sm text-destructive">{joinErr}</p> : null}

      {/* {pickOrderView ? (
        <p className="text-sm text-muted-foreground">
          {isHost
            ? 'Use Order details to set your units, then My total to see what you owe. Tap the pencil to change line items or close the bill.'
            : 'Only the host can change line items and charges. Use Order details to set your share, then My total for your amount.'}
        </p>
      ) : null} */}

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
            <ItemsEditor
              draft={editor}
              onChange={setEditor}
              onSave={() => void save()}
              disabled={saving}
              hideSaveButton
            />
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
        <div className="flex w-full flex-row gap-3">
          <Button
            type="button"
            variant="outline"
            className="min-h-12 min-w-0 flex-1 touch-manipulation sm:min-h-11"
            disabled={saving}
            onClick={() => setHostEditMode(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-12 min-w-0 flex-1 touch-manipulation sm:min-h-11"
            disabled={saving || !editor}
            onClick={() => void save()}
          >
            Save
          </Button>
        </div>
      ) : null}

      {pickOrderView ? (
        <Tabs value={splitTab} onValueChange={(v) => setSplitTab(v as 'assign' | 'results')} className="relative">
          <TabsContent value="assign" className="mt-4 space-y-5 focus-visible:outline-none">
            {bill.receipt_image_path ? (
              <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                <img
                  src={billReceiptPublicUrl(bill.receipt_image_path)}
                  alt="Bill receipt"
                  className="mx-auto max-h-[min(70vh,560px)] w-full object-contain"
                />
              </div>
            ) : null}
            {onBill ? (
              <AssignmentsPanel onOrderConfirmed={() => setSplitTab('results')} />
            ) : (
              <p className="text-sm text-muted-foreground">Joining the bill… you can pick your order in a moment.</p>
            )}
          </TabsContent>
          <TabsContent value="results" className="mt-4 focus-visible:outline-none">
            {onBill ? (
              <BillResults />
            ) : (
              <p className="text-sm text-muted-foreground">Joining the bill… your total will load shortly.</p>
            )}
          </TabsContent>
          <div
            className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/95 pb-[env(safe-area-inset-bottom,0px)] pt-1 shadow-[0_-4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md dark:shadow-[0_-4px_24px_rgba(0,0,0,0.25)]"
            role="navigation"
            aria-label="Bill sections"
          >
            <TabsList className="grid h-auto w-full grid-cols-2 gap-0.5 bg-transparent p-2">
              <TabsTrigger
                value="assign"
                className="min-h-12 w-full touch-manipulation rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Order details
              </TabsTrigger>
              <TabsTrigger
                value="results"
                className="min-h-12 w-full touch-manipulation rounded-lg data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                My total
              </TabsTrigger>
            </TabsList>
          </div>
          {showOrderFab ? (
            <div
              className="pointer-events-none fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] right-4 z-50 flex flex-col gap-3 md:bottom-8 md:right-6"
            >
              <div className="pointer-events-auto flex flex-col gap-3">
                <BillShareButton
                  billUrl={billShareUrl}
                  title={bill.title ?? 'Bill'}
                  iconOnly
                  className="size-14 shrink-0 touch-manipulation rounded-full border border-border/80 bg-card text-foreground shadow-lg"
                />
                <Button
                  type="button"
                  size="icon"
                  className="size-14 shrink-0 touch-manipulation rounded-full shadow-lg"
                  aria-label="Edit bill"
                  onClick={() => setHostEditMode(true)}
                >
                  <Pencil className="size-5 shrink-0" />
                </Button>
              </div>
            </div>
          ) : null}
        </Tabs>
      ) : null}

      {hostFullUi ? (
        <Button
          type="button"
          variant="destructive"
          className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
          onClick={() => void handleDeleteBill()}
        >
          Delete bill
        </Button>
      ) : null}

      {msg ? <p className="text-sm text-muted-foreground">{msg}</p> : null}
    </div>
  )
}
