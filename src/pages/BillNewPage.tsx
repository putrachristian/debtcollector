import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
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

export function BillNewPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { setCurrentBillId, createBill, updateBillMeta, updateItems } = useBill()
  const [title, setTitle] = useState('')
  const [inputTab, setInputTab] = useState<BillInputTab>('upload')
  const [draft, setDraft] = useState<BillDraft | null>(null)
  const [draftSource, setDraftSource] = useState<'image' | 'manual' | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setCurrentBillId(null)
  }, [setCurrentBillId])

  const showLineEditor =
    draft !== null &&
    (draftSource === 'image' || (draftSource === 'manual' && inputTab === 'manual'))

  async function handleCreate() {
    setErr(null)
    if (!draft) {
      setErr('Add line items: scan a receipt or use Manual.')
      return
    }
    setBusy(true)
    try {
      const id = await createBill(title.trim() || 'New bill')
      // Pass `id`: context `billId` can still be null here (stale closure on /bill/new where billId is cleared).
      await updateBillMeta(
        {
          currency: APP_CURRENCY,
          discount_type: draft.discountType,
          discount_value: draft.discountValue,
          service_charge_cents: draft.serviceChargeCents,
          tax_cents: draft.taxCents,
        },
        id
      )
      await updateItems(
        draft.items.map((i) => ({
          id: i.id,
          name: i.name,
          unit_price_cents: i.unitPriceCents,
          qty: i.qty,
        })),
        id
      )
      navigate(`/bill/${id}`, { replace: true })
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
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New bill</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Scan a receipt or use Manual to enter lines, then create the bill on the server.
        </p>
      </div>

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
            onApply={(d, source) => {
              setDraft(d)
              setDraftSource(source)
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
            ? 'Tap “Start manual bill” above to add rows.'
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
