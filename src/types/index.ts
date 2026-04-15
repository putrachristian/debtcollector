export type BillStatus = 'draft' | 'open' | 'closed'

export type DiscountType = 'percent' | 'amount'

export type AssignmentMode = 'individual' | 'shared_equal'

export type PaymentStatus =
  | 'pending_proof'
  | 'awaiting_confirmation'
  | 'settled'
  | 'rejected'

export interface Profile {
  id: string
  display_name: string | null
  avatar_url: string | null
  created_at: string
}

export interface BillRow {
  id: string
  host_id: string
  title: string | null
  invite_code: string
  status: BillStatus
  discount_type: DiscountType
  discount_value: number
  service_charge_cents: number
  tax_cents: number
  subtotal_cents: number | null
  /** ISO 4217; app uses IDR only. */
  currency: string
  created_at: string
}

export interface BillItemRow {
  id: string
  bill_id: string
  name: string
  unit_price_cents: number
  qty: number
  line_subtotal_cents: number
}

export interface ParticipantRow {
  id: string
  bill_id: string
  user_id: string
  joined_at: string
}

export interface ItemAssignmentRow {
  id: string
  bill_item_id: string
  user_id: string
  mode: AssignmentMode
  /** Present after migration 0009; defaults to 1 in the client if missing. */
  claimed_qty?: number
}

export interface PaymentRow {
  id: string
  from_user_id: string
  to_user_id: string
  bill_id: string | null
  amount_cents: number
  proof_path: string | null
  status: PaymentStatus
  created_at: string
  confirmed_at: string | null
}

/** AI parse response after normalization: amounts are smallest currency units (e.g. Rp or cents). */
export interface ParsedReceiptItem {
  name: string
  qty: number
  /** Unit price in minor units (same convention as `unit_price_cents` in the DB). */
  price: number
}

export interface ParsedReceipt {
  currency: string
  merchant?: string | null
  items: ParsedReceiptItem[]
  subtotal: number
  discount_type: DiscountType
  discount_value: number
  service_charge: number
  tax: number
  confidence?: number
  warnings?: unknown[]
}

export interface DraftBillPayload {
  version: 1
  updatedAt: string
  title: string
  /** ISO 4217; omit for legacy drafts (treated as USD). */
  currency?: string
  items: { id: string; name: string; unitPriceCents: number; qty: number }[]
  discountType: DiscountType
  discountValue: number
  serviceChargeCents: number
  taxCents: number
}
