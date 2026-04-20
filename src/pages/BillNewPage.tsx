import { useEffect, useState } from 'react'
import { ReceiptText, WandSparkles } from 'lucide-react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '@/context/AuthContext'
import { useBill } from '@/context/BillContext'
import { BillInput, type BillInputTab } from '@/features/bill/BillInput'
import type { BillDraft } from '@/features/bill/BillInput'
import { ItemsEditor } from '@/features/bill/ItemsEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { APP_CURRENCY } from '@/lib/money'
import { todayLocalIsoDate } from '@/lib/date'
import type { BillApplyMeta } from '@/features/bill/BillInput'
import { uploadBillReceipt } from '@/services/receiptUpload'
import { supabase } from '@/services/supabase'

export function BillNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const groupFromUrl = searchParams.get('group')?.trim() || null

  const { user, profile } = useAuth()
  const { setCurrentBillId, createBill, updateBillMeta, updateItems } = useBill()
  const [title, setTitle] = useState('')
  const [iAmPayer, setIAmPayer] = useState(true)
  const [payerName, setPayerName] = useState('')
  const [payerAccount, setPayerAccount] = useState('')
  const [showGroupOptions, setShowGroupOptions] = useState(!!groupFromUrl)
  const [tripGroupName, setTripGroupName] = useState('')
  const [urlGroupTitle, setUrlGroupTitle] = useState<string | null>(null)
  const [inputTab, setInputTab] = useState<BillInputTab>('upload')
  const [draft, setDraft] = useState<BillDraft | null>(null)
  const [draftSource, setDraftSource] = useState<'image' | 'manual' | null>(null)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setCurrentBillId(null)
  }, [setCurrentBillId])

  useEffect(() => {
    if (!groupFromUrl) {
      setUrlGroupTitle(null)
      return
    }
    void supabase
      .from('bill_groups')
      .select('title')
      .eq('id', groupFromUrl)
      .maybeSingle()
      .then(({ data }) => {
        setUrlGroupTitle((data as { title: string } | null)?.title ?? null)
      })
  }, [groupFromUrl])

  const showLineEditor =
    draft !== null &&
    (draftSource === 'image' || (draftSource === 'manual' && inputTab === 'manual'))

  function payerDetailsForCreate(): { name: string | null; account: string | null } {
    if (iAmPayer) {
      const dn = profile?.display_name?.trim() || (user?.email ? user.email.split('@')[0] : null) || 'Host'
      const acct = profile?.payment_account_number?.trim() || null
      return { name: dn, account: acct }
    }
    return {
      name: payerName.trim() || null,
      account: payerAccount.trim() || null,
    }
  }

  async function handleCreate() {
    setErr(null)
    if (!draft) {
      setErr('Add line items: scan a receipt or use Manual.')
      return
    }
    setBusy(true)
    try {
      const { id, publicPath } = await createBill(title.trim() || 'New bill')
      let groupId: string | null = groupFromUrl
      if (!groupId && showGroupOptions && tripGroupName.trim() && user) {
        const { data: g, error: ge } = await supabase
          .from('bill_groups')
          .insert({ title: tripGroupName.trim(), created_by: user.id })
          .select('id')
          .single()
        if (ge) throw ge
        groupId = (g as { id: string }).id
      }
      const pay = payerDetailsForCreate()
      await updateBillMeta(
        {
          currency: APP_CURRENCY,
          discount_type: draft.discountType,
          discount_value: draft.discountValue,
          service_charge_cents: draft.serviceChargeCents,
          tax_cents: draft.taxCents,
          bill_date: draft.billDate ?? todayLocalIsoDate(),
          payer_name: pay.name,
          payer_account_number: pay.account,
          group_id: groupId,
        },
        id
      )
      await updateItems(
        draft.items.map((i) => ({
          id: i.id,
          name: i.name,
          unit_price_cents: i.unitPriceCents,
          qty: i.qty,
          share_among: i.shareAmong != null && i.shareAmong >= 2 ? i.shareAmong : null,
        })),
        id
      )
      if (receiptFile) {
        try {
          await uploadBillReceipt(id, receiptFile)
        } catch (e) {
          setErr(e instanceof Error ? e.message : 'Bill created but receipt upload failed')
        }
      }
      navigate(publicPath, { replace: true })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to create bill')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return <p className="text-sm text-muted-foreground">Sign in to create a bill.</p>
  }

  return (
    <div className="space-y-5 md:space-y-6">
      <section className="glass-panel rounded-[1.5rem] px-4 py-4">
        <div className="glass-inner flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="max-w-2xl">
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-white/45 bg-white/45 px-3 py-1 text-xs font-medium text-foreground/85 backdrop-blur-xl dark:border-white/10 dark:bg-white/8">
              <ReceiptText className="size-4 text-primary" aria-hidden />
              Create bill
            </div>
            <h1 className="text-2xl font-semibold tracking-tight">Start with a receipt.</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Scan a receipt or switch to Manual, then review the items before saving.
            </p>
          </div>
          <div className="rounded-[1.25rem] border border-white/45 bg-white/36 p-3 backdrop-blur-xl dark:border-white/10 dark:bg-white/6 sm:max-w-xs">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-2xl bg-primary/14 text-primary">
                <WandSparkles className="size-4.5" aria-hidden />
              </span>
              <p className="text-sm text-foreground/85">Scan first, refine later.</p>
            </div>
          </div>
        </div>
      </section>

      <div className="space-y-2">
        <Label htmlFor="new-title">Title</Label>
        <Input
          id="new-title"
          className="min-h-11 text-base md:min-h-10 md:text-sm"
          placeholder="e.g. Dinner at Solaria"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
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
            onClick={() => setIAmPayer(true)}
          >
            I'm the payer
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
            . Add your account number there if you haven't.
          </p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="payer-name" className="sr-only">
                Payee name
              </Label>
              <Input
                id="payer-name"
                className="min-h-10 text-base md:text-sm"
                placeholder="Payee name"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="payer-account" className="sr-only">
                Account number
              </Label>
              <Input
                id="payer-account"
                className="min-h-10 font-mono text-base md:text-sm"
                placeholder="Account / e-wallet number"
                value={payerAccount}
                onChange={(e) => setPayerAccount(e.target.value)}
                inputMode="numeric"
              />
            </div>
          </div>
        )}
      </div>

      {showGroupOptions ? (
        <div className="glass-panel space-y-2 rounded-[1.4rem] px-3 py-3">
          <div className="glass-inner space-y-2">
            <Label className="text-sm">Trip / group</Label>
            {groupFromUrl ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Adding to </span>
                <span className="font-medium">{urlGroupTitle ?? '...'}</span>
              </p>
            ) : (
              <>
                <Input
                  className="min-h-10 text-base md:text-sm"
                  placeholder="e.g. Touring to Puncak"
                  value={tripGroupName}
                  onChange={(e) => setTripGroupName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Creates a named group on the home list.</p>
              </>
            )}
            {!groupFromUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => {
                  setShowGroupOptions(false)
                  setTripGroupName('')
                }}
              >
                Hide group options
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full min-h-10 touch-manipulation sm:w-auto"
          onClick={() => setShowGroupOptions(true)}
        >
          Assign to trip group (optional)
        </Button>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Scan receipt (optional)</CardTitle>
          <p className="text-xs text-muted-foreground">
            Line-by-line editing appears after a photo scan, or when you use Manual.
          </p>
        </CardHeader>
        <CardContent>
          <BillInput
            tab={inputTab}
            onTabChange={setInputTab}
            onApply={(d, source, meta?: BillApplyMeta) => {
              setDraft(d)
              setDraftSource(source)
              setReceiptFile(meta?.receiptFile ?? null)
              const n = d.billTitle?.trim()
              if (n) setTitle((prev) => (prev.trim() === '' ? n : prev))
            }}
          />
        </CardContent>
      </Card>

      {showLineEditor && draft ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Line items & charges</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemsEditor
              draft={draft}
              onChange={setDraft}
              onSave={() => void handleCreate()}
              disabled={busy}
              saveLabel="Create bill"
            />
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          {inputTab === 'manual'
            ? 'Tap "Start manual bill" above to add rows.'
            : 'Choose Manual to type lines, or upload / photograph a receipt to fill them automatically.'}
        </p>
      )}

      <Button type="button" variant="outline" className="min-h-11 w-full touch-manipulation sm:w-auto" asChild>
        <Link to="/">Cancel</Link>
      </Button>

      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </div>
  )
}
