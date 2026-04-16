import { supabase } from '@/services/supabase'

function receiptObjectPath(billId: string, file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase()
  const safe = ext && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg'
  return `${billId}/receipt.${safe}`
}

/** Uploads image to `bill-receipts` and sets `bills.receipt_image_path`. Host-only (RLS). */
export async function uploadBillReceipt(billId: string, file: File): Promise<string> {
  const path = receiptObjectPath(billId, file)
  const { error: up } = await supabase.storage
    .from('bill-receipts')
    .upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (up) throw up
  const { error: db } = await supabase.from('bills').update({ receipt_image_path: path }).eq('id', billId)
  if (db) throw db
  return path
}

export function billReceiptPublicUrl(path: string): string {
  const { data } = supabase.storage.from('bill-receipts').getPublicUrl(path)
  return data.publicUrl
}
