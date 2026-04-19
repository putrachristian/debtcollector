import type { BillRow, Profile } from '@/types'

/** True when the bill’s payee fields match the host’s profile (I’m the payer — you receive transfers). */
export function hostIsBillPayee(
  b: BillRow,
  profile: Profile | null,
  user: { id: string; email?: string | null }
): boolean {
  const dn = profile?.display_name?.trim() || (user.email?.split('@')[0] ?? '') || ''
  const acct = (profile?.payment_account_number ?? '').trim()
  const pn = (b.payer_name ?? '').trim()
  const pa = (b.payer_account_number ?? '').trim()
  if (!pn && !pa) return true
  return pn === dn && pa === acct
}
