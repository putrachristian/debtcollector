/** ISO 4217 minor units (fraction digits). Fallback 2 for unknown codes. */
export function currencyFractionDigits(currency: string): number {
  const c = currency.toUpperCase()
  if (c === 'IDR' || c === 'JPY' || c === 'VND' || c === 'KRW' || c === 'CLP' || c === 'PYG') return 0
  return 2
}

/** Convert a major-unit decimal (e.g. dollars) to minor units (e.g. cents). USD-style. */
export function toCents(amountMajor: number): number {
  if (!Number.isFinite(amountMajor)) return 0
  return Math.round(amountMajor * 100)
}

export function majorToMinor(amountMajor: number, currency: string): number {
  if (!Number.isFinite(amountMajor)) return 0
  const f = currencyFractionDigits(currency)
  return Math.round(amountMajor * 10 ** f)
}

export function minorToMajor(minor: number, currency: string): number {
  if (!Number.isFinite(minor)) return 0
  const f = currencyFractionDigits(currency)
  return minor / 10 ** f
}

/** App bills are always IDR; parameter kept for shared helpers/tests. */
export const APP_CURRENCY = 'IDR' as const

/** Format stored minor units (bill item prices, tax totals, etc.). */
export function formatCents(minor: number, currency: string = APP_CURRENCY): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(minorToMajor(minor, currency))
}

/** Pretty string for major-unit inputs bound to minor-unit state (e.g. unit price field). */
export function formatMajorForInput(minor: number, currency: string): string {
  if (minor === 0) return ''
  const f = currencyFractionDigits(currency)
  const m = minorToMajor(minor, currency)
  return f === 0 ? String(Math.round(m)) : m.toFixed(f)
}
