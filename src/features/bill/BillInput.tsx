import { useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { parseReceipt, parsedReceiptToCentsModel } from '@/services/ai'
import { APP_CURRENCY } from '@/lib/money'
import { todayLocalIsoDate } from '@/lib/date'
import type { DiscountType } from '@/types'

export type DraftLine = {
  id: string
  name: string
  unitPriceCents: number
  qty: number
  /** Split line total across N people (each claims slots). */
  shareAmong?: number | null
}

export type BillDraft = {
  /** Always IDR for this app (kept for typing / future). */
  currency: string
  items: DraftLine[]
  discountType: DiscountType
  discountValue: number
  serviceChargeCents: number
  taxCents: number
  /** From receipt AI (`merchant`); used to pre-fill bill title when empty. */
  billTitle?: string
  /** YYYY-MM-DD; AI or manual default (today). */
  billDate?: string
}

export function defaultBillDraft(): BillDraft {
  return {
    currency: APP_CURRENCY,
    items: [
      {
        id: `tmp-${crypto.randomUUID()}`,
        name: 'Item',
        unitPriceCents: 0,
        qty: 1,
      },
    ],
    discountType: 'percent',
    discountValue: 0,
    serviceChargeCents: 0,
    taxCents: 0,
    billDate: todayLocalIsoDate(),
  }
}

export type BillInputTab = 'upload' | 'camera' | 'manual'

export type BillApplyMeta = {
  /** Present when draft came from upload/camera — upload after bill is created. */
  receiptFile?: File | null
}

type Props = {
  onApply: (draft: BillDraft, source: 'image' | 'manual', meta?: BillApplyMeta) => void
  tab: BillInputTab
  onTabChange: (tab: BillInputTab) => void
}

export function BillInput({ onApply, tab, onTabChange }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const camRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File | null) {
    if (!file) return
    setErr(null)
    setBusy(true)
    try {
      const raw = await parseReceipt(file)
      const m = parsedReceiptToCentsModel(raw)
      const merchantName = typeof raw.merchant === 'string' ? raw.merchant.trim() : ''
      const billDateFromAi = m.billDate?.trim() || undefined
      onApply(
        {
          currency: APP_CURRENCY,
          items: m.items.map((i) => ({
            id: i.id,
            name: i.name,
            unitPriceCents: i.unitPriceCents,
            qty: i.qty,
          })),
          discountType: m.discountType,
          discountValue: m.discountValue,
          serviceChargeCents: m.serviceChargeCents,
          taxCents: m.taxCents,
          ...(merchantName ? { billTitle: merchantName } : {}),
          ...(billDateFromAi ? { billDate: billDateFromAi } : { billDate: todayLocalIsoDate() }),
        },
        'image',
        { receiptFile: file }
      )
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Parse failed')
    } finally {
      setBusy(false)
    }
  }

  function startManual() {
    onApply(defaultBillDraft(), 'manual', {})
  }

  return (
    <div className="space-y-3">
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as BillInputTab)}>
        <TabsList className="grid h-auto w-full grid-cols-3 gap-0.5 p-1 sm:inline-flex sm:h-9 sm:w-auto sm:items-center sm:gap-0 sm:p-1">
          <TabsTrigger
            value="upload"
            className="min-h-11 w-full touch-manipulation px-2 text-xs sm:min-h-0 sm:w-auto sm:py-1 sm:text-sm"
          >
            Upload
          </TabsTrigger>
          <TabsTrigger
            value="camera"
            className="min-h-11 w-full touch-manipulation px-2 text-xs sm:min-h-0 sm:w-auto sm:py-1 sm:text-sm"
          >
            Photo
          </TabsTrigger>
          <TabsTrigger
            value="manual"
            className="min-h-11 w-full touch-manipulation px-2 text-xs sm:min-h-0 sm:w-auto sm:py-1 sm:text-sm"
          >
            Manual
          </TabsTrigger>
        </TabsList>
        <TabsContent value="upload" className="space-y-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? 'Parsing…' : 'Choose image'}
          </Button>
        </TabsContent>
        <TabsContent value="camera" className="space-y-2">
          <input
            ref={camRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          <Button
            type="button"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            disabled={busy}
            onClick={() => camRef.current?.click()}
          >
            {busy ? 'Parsing…' : 'Open camera'}
          </Button>
        </TabsContent>
        <TabsContent value="manual">
          <Button
            type="button"
            variant="secondary"
            className="min-h-12 w-full touch-manipulation sm:w-auto sm:min-h-10"
            onClick={startManual}
          >
            Start manual bill
          </Button>
        </TabsContent>
      </Tabs>
      {err ? <p className="text-sm text-destructive">{err}</p> : null}
    </div>
  )
}
