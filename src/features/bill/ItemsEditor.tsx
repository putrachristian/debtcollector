import { useMemo, useState } from 'react'
import type { BillDraft, DraftLine } from '@/features/bill/BillInput'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APP_CURRENCY, formatCents, formatMajorForInput, majorToMinor } from '@/lib/money'
import { todayLocalIsoDate } from '@/lib/date'

type Props = {
  draft: BillDraft
  onChange: (next: BillDraft) => void
  onSave: () => void
  disabled?: boolean
  /** Primary action label (e.g. "Create bill" on the new-bill page). */
  saveLabel?: string
}

function lineTotal(line: DraftLine): number {
  return line.unitPriceCents * line.qty
}

/** Same cap as `calculateBill`’s bill discount (manual merge not shown here). */
function draftBillDiscountCents(lineSubtotal: number, draft: BillDraft): number {
  if (lineSubtotal <= 0) return 0
  if (draft.discountType === 'amount') {
    const v = Math.max(0, Math.trunc(draft.discountValue))
    return Math.min(v, lineSubtotal)
  }
  const bps = Math.max(0, Math.trunc(draft.discountValue))
  return Math.min(Math.floor((lineSubtotal * bps) / 10000), lineSubtotal)
}

export function ItemsEditor({ draft, onChange, onSave, disabled, saveLabel = 'Save bill to server' }: Props) {
  const cur = draft.currency ?? APP_CURRENCY
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({})

  const subtotal = useMemo(
    () => draft.items.reduce((s, it) => s + lineTotal(it), 0),
    [draft.items]
  )

  const discountCents = useMemo(
    () => draftBillDiscountCents(subtotal, draft),
    [subtotal, draft.discountType, draft.discountValue]
  )

  const afterDiscount = subtotal - discountCents
  const serviceCents = Math.max(0, Math.trunc(draft.serviceChargeCents))
  const taxCents = Math.max(0, Math.trunc(draft.taxCents))
  const estimatedBillTotal = afterDiscount + serviceCents + taxCents

  function updateItem(id: string, patch: Partial<DraftLine>) {
    onChange({
      ...draft,
      items: draft.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    })
  }

  function addRow() {
    onChange({
      ...draft,
      items: [
        ...draft.items,
        {
          id: `tmp-${crypto.randomUUID()}`,
          name: 'Item',
          unitPriceCents: 0,
          qty: 1,
        },
      ],
    })
  }

  function removeRow(id: string) {
    onChange({ ...draft, items: draft.items.filter((it) => it.id !== id) })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="bill-date">Bill date</Label>
        <Input
          id="bill-date"
          type="date"
          className="min-h-11 max-w-full text-base md:min-h-10 md:text-sm sm:max-w-xs"
          disabled={disabled}
          value={draft.billDate ?? todayLocalIsoDate()}
          onChange={(e) => onChange({ ...draft, billDate: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">Used on the bill detail; receipt scans pre-fill when the AI returns a date.</p>
      </div>

      <div className="space-y-3">
        {draft.items.map((it) => (
          <div key={it.id} className="rounded-lg border border-border bg-card/40 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Line item</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 shrink-0 text-muted-foreground"
                disabled={disabled || draft.items.length <= 1}
                onClick={() => removeRow(it.id)}
              >
                Remove
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor={`name-${it.id}`}>Name</Label>
              <Input
                id={`name-${it.id}`}
                className="min-h-11 text-base md:min-h-10 md:text-sm"
                value={it.name}
                disabled={disabled}
                onChange={(e) => updateItem(it.id, { name: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`price-${it.id}`}>Unit price (Rp)</Label>
              <Input
                id={`price-${it.id}`}
                inputMode="numeric"
                className="min-h-11 text-base md:min-h-10 md:text-sm"
                disabled={disabled}
                value={priceInputs[it.id] ?? formatMajorForInput(it.unitPriceCents, cur)}
                onChange={(e) => {
                  const raw = e.target.value
                  setPriceInputs((m) => ({ ...m, [it.id]: raw }))
                  const n = Number.parseFloat(raw)
                  if (Number.isFinite(n)) {
                    updateItem(it.id, { unitPriceCents: majorToMinor(n, cur) })
                  }
                }}
                onBlur={() => {
                  setPriceInputs((m) => {
                    const next = { ...m }
                    delete next[it.id]
                    return next
                  })
                }}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`qty-${it.id}`}>Qty</Label>
              <Input
                id={`qty-${it.id}`}
                type="number"
                min={1}
                className="min-h-11 max-w-[8rem] text-base md:min-h-10 md:text-sm"
                disabled={disabled}
                value={it.qty}
                onChange={(e) =>
                  updateItem(it.id, { qty: Math.max(1, Math.round(Number(e.target.value) || 1)) })
                }
              />
            </div>
            <div className="flex items-center justify-between border-t border-border pt-3 text-sm">
              <span className="text-muted-foreground">Line total</span>
              <span className="font-medium tabular-nums">{formatCents(lineTotal(it), cur)}</span>
            </div>
          </div>
        ))}
      </div>

      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={addRow}>
        Add line
      </Button>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label>Discount type</Label>
          <select
            className="h-11 w-full rounded-md border border-border bg-card px-2 text-base md:h-9 md:text-sm"
            disabled={disabled}
            value={draft.discountType}
            onChange={(e) =>
              onChange({
                ...draft,
                discountType: e.target.value as BillDraft['discountType'],
              })
            }
          >
            <option value="percent">Percent (stored as basis points)</option>
            <option value="amount">Amount (Rp)</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label>{draft.discountType === 'percent' ? 'Discount (%)' : 'Discount (Rp)'}</Label>
          <Input
            type="number"
            className="min-h-11 text-base md:min-h-10 md:text-sm"
            disabled={disabled}
            value={
              draft.discountType === 'percent'
                ? draft.discountValue / 100
                : draft.discountValue
            }
            onChange={(e) => {
              const v = Number(e.target.value)
              if (!Number.isFinite(v)) return
              onChange({
                ...draft,
                discountValue: draft.discountType === 'percent' ? Math.round(v * 100) : Math.round(v),
              })
            }}
          />
        </div>
        <div className="space-y-1">
          <Label>Service charge (Rp)</Label>
          <Input
            type="number"
            inputMode="decimal"
            className="min-h-11 text-base md:min-h-10 md:text-sm"
            disabled={disabled}
            value={formatMajorForInput(draft.serviceChargeCents, cur)}
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value)
              if (!Number.isFinite(n)) return
              onChange({ ...draft, serviceChargeCents: majorToMinor(n, cur) })
            }}
          />
        </div>
        <div className="space-y-1">
          <Label>Tax total (Rp)</Label>
          <Input
            type="number"
            inputMode="decimal"
            className="min-h-11 text-base md:min-h-10 md:text-sm"
            disabled={disabled}
            value={formatMajorForInput(draft.taxCents, cur)}
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value)
              if (!Number.isFinite(n)) return
              onChange({ ...draft, taxCents: majorToMinor(n, cur) })
            }}
          />
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Lines subtotal</span>
          <span className="tabular-nums">{formatCents(subtotal, cur)}</span>
        </div>
        {discountCents > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Bill discount</span>
            <span className="tabular-nums text-destructive">−{formatCents(discountCents, cur)}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Service charge</span>
          <span className="tabular-nums">{formatCents(serviceCents, cur)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">Tax (total)</span>
          <span className="tabular-nums">{formatCents(taxCents, cur)}</span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 font-medium">
          <span>Estimated bill total</span>
          <span className="tabular-nums">{formatCents(estimatedBillTotal, cur)}</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Split results use the same total (after discount) plus service and tax per person.
        </p>
      </div>

      <Button
        type="button"
        disabled={disabled}
        className="min-h-12 w-full touch-manipulation text-base md:w-auto md:min-h-10 md:text-sm"
        onClick={onSave}
      >
        {saveLabel}
      </Button>

    </div>
  )
}
