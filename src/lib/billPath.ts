import { supabase } from '@/services/supabase'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isLikelyBillUuid(ref: string): boolean {
  return UUID_RE.test(ref.trim())
}

/** Resolve route segment (UUID or `slug`) to bill primary key. */
export async function resolveBillRefToId(ref: string): Promise<string | null> {
  const t = ref.trim()
  if (!t) return null
  if (isLikelyBillUuid(t)) {
    const id = t.toLowerCase()
    const { data, error } = await supabase.from('bills').select('id').eq('id', id).maybeSingle()
    if (error) return null
    return (data as { id?: string } | null)?.id ?? null
  }
  const slug = t.toLowerCase()
  const { data, error } = await supabase.from('bills').select('id').eq('slug', slug).maybeSingle()
  if (error) return null
  return (data as { id?: string } | null)?.id ?? null
}

/** Path segment for links (prefers slug when present). */
export function billPublicPath(bill: { id: string; slug?: string | null }): string {
  const s = bill.slug?.trim().toLowerCase()
  if (s && s.length > 0) return `/bill/${s}`
  return `/bill/${bill.id}`
}

export async function billPublicPathForBillId(billId: string): Promise<string> {
  const { data, error } = await supabase.from('bills').select('id, slug').eq('id', billId).maybeSingle()
  if (error || !data) return `/bill/${billId}`
  return billPublicPath(data as { id: string; slug?: string | null })
}
