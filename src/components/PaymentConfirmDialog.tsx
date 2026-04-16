import { Button } from '@/components/ui/button'

/** Oath shown before recording a guest “paid the host” confirmation. */
export const PAYMENT_CONFIRMATION_OATH =
  'Saya mengonfirmasi pembayaran ini adalah kebenaran. Jika saya berbohong, saya secara sadar menyerahkan tempat saya di surga dan memilih api abadi sebagai rumah masa depan saya.'

type Props = {
  open: boolean
  onConfirm: () => void | Promise<void>
  onCancel: () => void
  busy?: boolean
}

export function PaymentConfirmDialog({ open, onConfirm, onCancel, busy }: Props) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="presentation"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="payment-confirm-title" className="text-base font-semibold">
          Confirm payment
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-foreground/90">{PAYMENT_CONFIRMATION_OATH}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" className="min-h-11 touch-manipulation" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            className="min-h-11 touch-manipulation"
            disabled={busy}
            onClick={() => void Promise.resolve(onConfirm())}
          >
            {busy ? 'Saving…' : 'Confirm'}
          </Button>
        </div>
      </div>
    </div>
  )
}
