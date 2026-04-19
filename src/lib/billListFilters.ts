import type { BillRow } from '@/types'

/** Calendar day used for filtering (bill_date or created_at date). */
export function billDayIso(b: BillRow): string {
  const bd = b.bill_date?.trim()
  if (bd && /^\d{4}-\d{2}-\d{2}/.test(bd)) return bd.slice(0, 10)
  return b.created_at.slice(0, 10)
}

/** When `dayIso` is set (YYYY-MM-DD), keep only bills on that day; otherwise show all. */
export function passesBillSingleDay(b: BillRow, dayIso: string | null): boolean {
  if (!dayIso) return true
  return billDayIso(b) === dayIso
}

/** Case-insensitive match on bill title and optional group title. */
export function matchesBillSearch(
  b: BillRow,
  query: string,
  groupTitle: (groupId: string) => string | undefined
): boolean {
  const s = query.trim().toLowerCase()
  if (!s) return true
  if ((b.title ?? '').toLowerCase().includes(s)) return true
  if (b.group_id) {
    const gt = groupTitle(b.group_id) ?? ''
    if (gt.toLowerCase().includes(s)) return true
  }
  return false
}
