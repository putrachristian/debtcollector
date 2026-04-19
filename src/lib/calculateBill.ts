/**
 * Pure bill split engine. All money in integer cents. No I/O, no external deps.
 *
 * Rules:
 * - Shared items split equally BEFORE discount (on gross line cents).
 * - Bill discount merged (existing + optional manual), converted to total cents, capped at subtotal.
 * - Discount applied proportionally to each user's pre-discount subtotal; remainders reconciled.
 * - Service charge split equally across all participants.
 * - Tax allocated after discount, proportional to post-discount subtotals; if all zero, equal split.
 */

export type AssignmentMode = 'individual' | 'shared_equal'

export interface BillItemInput {
  id: string
  /** For friendlier error messages in the UI. */
  name?: string
  unitPriceCents: number
  qty: number
  /** Split line total across this many people (each claims slots with claimedQty). */
  shareAmong?: number | null
}

export interface AssignmentInput {
  billItemId: string
  userId: string
  mode: AssignmentMode
  /** Units of this line this person is responsible for; must sum to line `qty` when set for everyone on the line. */
  claimedQty?: number
}

/** percent uses basis points (10000 = 100%). amount is cents. */
export interface DiscountInput {
  kind: 'percent' | 'amount'
  value: number
}

export interface CalculateBillInput {
  items: BillItemInput[]
  /** Everyone on the bill; used for equal splits (service, edge tax) and output keys. */
  participantIds: string[]
  assignments: AssignmentInput[]
  billDiscount: DiscountInput
  manualDiscount?: DiscountInput
  serviceChargeCents: number
  taxCents: number
}

export interface UserBreakdown {
  userId: string
  preDiscountSubtotalCents: number
  discountCents: number
  postDiscountSubtotalCents: number
  serviceChargeCents: number
  taxCents: number
  totalCents: number
}

export interface CalculateBillSuccess {
  ok: true
  billSubtotalCents: number
  mergedDiscountCents: number
  effectiveDiscountBps: number
  warnings: string[]
  byUser: Record<string, UserBreakdown>
  usersOrdered: string[]
}

export interface CalculateBillFailure {
  ok: false
  errors: string[]
}

export type CalculateBillResult = CalculateBillSuccess | CalculateBillFailure

function cmpId(a: string, b: string): number {
  return a.localeCompare(b)
}

function uniqueSorted(ids: string[]): string[] {
  return [...new Set(ids)].sort(cmpId)
}

/** Split `total` cents across `orderedIds` equally; remainder to first ids in sort order. */
function allocateEqual(total: number, orderedIds: string[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of orderedIds) out.set(id, 0)
  const n = orderedIds.length
  if (n === 0 || total === 0) return out
  const base = Math.floor(total / n)
  const rem = total - base * n
  const sorted = [...orderedIds].sort(cmpId)
  for (let i = 0; i < sorted.length; i++) {
    out.set(sorted[i], base + (i < rem ? 1 : 0))
  }
  return out
}

/**
 * Allocate integer `total` across keys using weights (sum W).
 * Largest-remainder method; ties broken by user id asc.
 */
function allocateByWeights(
  total: number,
  weights: Map<string, number>,
  orderedUserIds: string[]
): Map<string, number> {
  const out = new Map<string, number>()
  for (const id of orderedUserIds) out.set(id, 0)
  if (total === 0) return out
  const W = orderedUserIds.reduce((s, id) => s + Math.max(0, weights.get(id) ?? 0), 0)
  if (W === 0) return allocateEqual(total, orderedUserIds)

  type Row = { id: string; q: number; r: number }
  const rows: Row[] = []
  let sumQ = 0
  for (const id of orderedUserIds) {
    const w = Math.max(0, weights.get(id) ?? 0)
    const num = total * w
    const q = Math.floor(num / W)
    const r = num % W
    rows.push({ id, q, r })
    sumQ += q
  }
  let leftover = total - sumQ
  rows.sort((a, b) => b.r - a.r || cmpId(a.id, b.id))
  for (let i = 0; i < rows.length && leftover > 0; i++) {
    rows[i].q += 1
    leftover -= 1
  }
  for (const row of rows) {
    out.set(row.id, row.q)
  }
  return out
}

function discountToCents(input: DiscountInput, billSubtotalCents: number): number {
  if (billSubtotalCents <= 0) return 0
  if (input.kind === 'amount') {
    const v = Math.max(0, Math.trunc(input.value))
    return Math.min(v, billSubtotalCents)
  }
  const bps = Math.max(0, Math.trunc(input.value))
  return Math.min(Math.floor((billSubtotalCents * bps) / 10000), billSubtotalCents)
}

function lineCents(item: BillItemInput): number {
  const u = Math.max(0, Math.trunc(item.unitPriceCents))
  const q = Math.max(0, Math.trunc(item.qty))
  return u * q
}

function itemLabel(item: BillItemInput): string {
  const n = item.name?.trim()
  if (n) return n
  return `Item ${item.id.slice(0, 8)}…`
}

function validateAndBuildPreDiscount(
  items: BillItemInput[],
  assignments: AssignmentInput[]
): { pre: Map<string, number>; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const pre = new Map<string, number>()
  const byItem = new Map<string, AssignmentInput[]>()
  for (const a of assignments) {
    const list = byItem.get(a.billItemId) ?? []
    list.push(a)
    byItem.set(a.billItemId, list)
  }

  for (const item of items) {
    const gross = lineCents(item)
    const label = itemLabel(item)
    const rows = byItem.get(item.id) ?? []
    const shareAmong =
      item.shareAmong != null && item.shareAmong >= 2 ? Math.trunc(item.shareAmong) : null

    if (shareAmong != null) {
      if (rows.length === 0) {
        errors.push(`${label}: nobody has claimed this line yet`)
        continue
      }
      const modes = new Set(rows.map((r) => r.mode))
      if (modes.size > 1) {
        errors.push(`${label}: mixes individual and shared split modes`)
        continue
      }
      const allHaveQty = rows.every(
        (r) => r.claimedQty != null && Number.isFinite(r.claimedQty) && Math.trunc(r.claimedQty!) > 0
      )
      if (!allHaveQty) {
        errors.push(`${label}: set how many slots each person has for this shared dish`)
        continue
      }
      const sumClaimed = rows.reduce((s, r) => s + Math.max(0, Math.trunc(r.claimedQty ?? 0)), 0)
      if (sumClaimed > shareAmong) {
        errors.push(`${label}: too many slots claimed (max ${shareAmong} for this shared dish)`)
        continue
      }
      if (sumClaimed < shareAmong) {
        errors.push(
          `${label}: shared among ${shareAmong} — ${sumClaimed} slot(s) claimed (need all ${shareAmong} to close the bill)`
        )
        continue
      }
      const userIds = uniqueSorted(rows.map((r) => r.userId))
      const weights = new Map<string, number>()
      for (const r of rows) {
        weights.set(r.userId, Math.max(0, Math.trunc(r.claimedQty!)))
      }
      const shares = allocateByWeights(gross, weights, userIds)
      for (const [uid, cents] of shares) {
        pre.set(uid, (pre.get(uid) ?? 0) + cents)
      }
      continue
    }

    if (rows.length === 0) {
      errors.push(`${label}: nobody has claimed this line yet`)
      continue
    }

    const modes = new Set(rows.map((r) => r.mode))
    if (modes.size > 1) {
      errors.push(`${label}: mixes individual and shared split modes`)
      continue
    }

    const qty = Math.max(0, Math.trunc(item.qty))
    const userIds = uniqueSorted(rows.map((r) => r.userId))

    const allHaveQty = rows.every(
      (r) => r.claimedQty != null && Number.isFinite(r.claimedQty) && Math.trunc(r.claimedQty!) > 0
    )
    const sumClaimed = rows.reduce((s, r) => s + Math.max(0, Math.trunc(r.claimedQty ?? 0)), 0)
    const anyHaveQty = rows.some((r) => r.claimedQty != null)

    // Several people on one dish (qty 1): split money evenly (legacy behaviour).
    if (qty === 1 && rows.length > 1) {
      const shares = allocateEqual(gross, userIds)
      for (const [uid, cents] of shares) {
        pre.set(uid, (pre.get(uid) ?? 0) + cents)
      }
      if (allHaveQty && sumClaimed !== 1) {
        warnings.push(`${label}: multiple people on a single dish — price split evenly`)
      }
      continue
    }

    if (anyHaveQty && !allHaveQty) {
      errors.push(`${label}: set how many units each person had for everyone on this line`)
      continue
    }

    if (allHaveQty && sumClaimed === qty) {
      const weights = new Map<string, number>()
      for (const r of rows) {
        weights.set(r.userId, Math.max(0, Math.trunc(r.claimedQty!)))
      }
      const shares = allocateByWeights(gross, weights, userIds)
      for (const [uid, cents] of shares) {
        pre.set(uid, (pre.get(uid) ?? 0) + cents)
      }
      continue
    }

    if (!anyHaveQty) {
      const mode = rows[0]!.mode
      if (mode === 'individual') {
        if (rows.length !== 1) {
          errors.push(`${label}: one person must take the whole line in individual mode`)
          continue
        }
        const uid = rows[0]!.userId
        pre.set(uid, (pre.get(uid) ?? 0) + gross)
        continue
      }
      if (userIds.length === 1) {
        warnings.push(`${label}: one person on a shared line — full amount`)
      }
      const shares = allocateEqual(gross, userIds)
      for (const [uid, cents] of shares) {
        pre.set(uid, (pre.get(uid) ?? 0) + cents)
      }
      continue
    }

    errors.push(
      `${label}: claimed units (${sumClaimed}) must equal line quantity (${qty}). Adjust units per person.`
    )
  }

  return { pre, errors, warnings }
}

export function calculateBill(input: CalculateBillInput): CalculateBillResult {
  const participants = uniqueSorted(input.participantIds)
  if (participants.length === 0) {
    return { ok: false, errors: ['At least one participant is required'] }
  }
  const pset = new Set(participants)
  for (const a of input.assignments) {
    if (!pset.has(a.userId)) {
      return {
        ok: false,
        errors: [`Assignment references unknown participant "${a.userId}"`],
      }
    }
  }

  const { pre: preDiscount, errors, warnings } = validateAndBuildPreDiscount(
    input.items,
    input.assignments
  )
  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const billSubtotalCents = input.items.reduce((s, it) => s + lineCents(it), 0)
  const assignedSum = [...preDiscount.values()].reduce((a, b) => a + b, 0)
  if (assignedSum !== billSubtotalCents) {
    return {
      ok: false,
      errors: [
        `Internal mismatch: assigned sum ${assignedSum} != bill subtotal ${billSubtotalCents}`,
      ],
    }
  }

  const d1 = discountToCents(input.billDiscount, billSubtotalCents)
  const d2 = input.manualDiscount
    ? discountToCents(input.manualDiscount, billSubtotalCents)
    : 0
  const mergedDiscountCents = Math.min(d1 + d2, billSubtotalCents)
  const effectiveDiscountBps =
    billSubtotalCents > 0
      ? Math.min(10000, Math.floor((mergedDiscountCents * 10000) / billSubtotalCents))
      : 0

  const weightMap = new Map<string, number>()
  for (const id of participants) {
    weightMap.set(id, preDiscount.get(id) ?? 0)
  }

  const discountAlloc = allocateByWeights(mergedDiscountCents, weightMap, participants)

  const postMap = new Map<string, number>()
  for (const id of participants) {
    const pre = weightMap.get(id) ?? 0
    const disc = discountAlloc.get(id) ?? 0
    postMap.set(id, pre - disc)
  }

  const serviceAlloc = allocateEqual(Math.max(0, Math.trunc(input.serviceChargeCents)), participants)

  const postSum = [...postMap.values()].reduce((a, b) => a + b, 0)
  const taxTotal = Math.max(0, Math.trunc(input.taxCents))
  let taxAlloc: Map<string, number>
  if (postSum === 0 && taxTotal > 0) {
    taxAlloc = allocateEqual(taxTotal, participants)
  } else {
    taxAlloc = allocateByWeights(taxTotal, postMap, participants)
  }

  const byUser: Record<string, UserBreakdown> = {}
  for (const id of participants) {
    const pre = weightMap.get(id) ?? 0
    const disc = discountAlloc.get(id) ?? 0
    const post = postMap.get(id) ?? 0
    const svc = serviceAlloc.get(id) ?? 0
    const tax = taxAlloc.get(id) ?? 0
    byUser[id] = {
      userId: id,
      preDiscountSubtotalCents: pre,
      discountCents: disc,
      postDiscountSubtotalCents: post,
      serviceChargeCents: svc,
      taxCents: tax,
      totalCents: post + svc + tax,
    }
  }

  return {
    ok: true,
    billSubtotalCents,
    mergedDiscountCents,
    effectiveDiscountBps,
    warnings,
    byUser,
    usersOrdered: participants,
  }
}

/** Pre-discount food cents from this line for one viewer (matches full-bill split logic). */
export function foodSubtotalCentsForViewerOnLine(
  item: BillItemInput,
  rows: AssignmentInput[],
  viewerId: string
): number {
  return viewerLineFoodCents(item, rows, viewerId)
}

function viewerLineFoodCents(item: BillItemInput, rows: AssignmentInput[], viewerId: string): number {
  if (rows.length === 0) return 0
  const gross = lineCents(item)
  const shareAmong =
    item.shareAmong != null && item.shareAmong >= 2 ? Math.trunc(item.shareAmong) : null
  if (shareAmong != null) {
    const mine = rows.filter((r) => r.userId === viewerId)
    const myQ = mine.length ? Math.max(0, Math.trunc(mine[0]!.claimedQty ?? 0)) : 0
    return Math.floor((gross * myQ) / shareAmong)
  }
  const qty = Math.max(0, Math.trunc(item.qty))
  const userIds = uniqueSorted(rows.map((r) => r.userId))
  const mine = rows.filter((r) => r.userId === viewerId)
  if (mine.length === 0) return 0

  if (qty === 1 && rows.length > 1) {
    const m = allocateEqual(gross, userIds)
    return m.get(viewerId) ?? 0
  }

  const allHaveQty = rows.every(
    (r) => r.claimedQty != null && Number.isFinite(r.claimedQty) && Math.trunc(r.claimedQty!) > 0
  )
  if (allHaveQty) {
    const myC = Math.max(0, Math.trunc(mine[0]!.claimedQty!))
    return Math.max(0, Math.trunc(item.unitPriceCents)) * myC
  }

  if (rows.length === 1 && rows[0]!.userId === viewerId) return gross

  const m = allocateEqual(gross, userIds)
  return m.get(viewerId) ?? 0
}

export interface UserSharePartialSuccess {
  ok: true
  viewerId: string
  foodSubtotalCents: number
  discountCents: number
  postDiscountSubtotalCents: number
  serviceChargeCents: number
  taxCents: number
  totalCents: number
  warnings: string[]
}

export type UserSharePartialResult = UserSharePartialSuccess | { ok: false; errors: string[] }

/**
 * Your share of the bill from lines you claimed, scaled discount/tax to your food share,
 * plus an equal split of service across all participants. Does not require every line to be fully assigned.
 */
export function calculateUserSharePartial(
  input: CalculateBillInput & { viewerId: string }
): UserSharePartialResult {
  const viewerId = input.viewerId
  const participants = uniqueSorted([
    ...input.participantIds,
    ...input.assignments.map((a) => a.userId),
    viewerId,
  ])

  if (participants.length === 0) {
    return { ok: false, errors: ['At least one participant is required'] }
  }

  const byItem = new Map<string, AssignmentInput[]>()
  for (const a of input.assignments) {
    const list = byItem.get(a.billItemId) ?? []
    list.push(a)
    byItem.set(a.billItemId, list)
  }

  const warnings: string[] = []
  for (const item of input.items) {
    const rows = byItem.get(item.id) ?? []
    if (rows.length === 0) {
      warnings.push(`${itemLabel(item)} is not assigned yet — totals may change when it is.`)
    }
  }

  let userFood = 0
  for (const item of input.items) {
    const rows = byItem.get(item.id) ?? []
    userFood += viewerLineFoodCents(item, rows, viewerId)
  }

  const billSubtotalCents = input.items.reduce((s, it) => s + lineCents(it), 0)
  const d1 = discountToCents(input.billDiscount, billSubtotalCents)
  const d2 = input.manualDiscount ? discountToCents(input.manualDiscount, billSubtotalCents) : 0
  const mergedDiscountCents = Math.min(d1 + d2, billSubtotalCents)

  const discountCents =
    billSubtotalCents > 0 && userFood > 0
      ? Math.min(mergedDiscountCents, Math.floor((mergedDiscountCents * userFood) / billSubtotalCents))
      : 0

  const postDiscountSubtotalCents = userFood - discountCents

  const serviceAlloc = allocateEqual(Math.max(0, Math.trunc(input.serviceChargeCents)), participants)
  const serviceChargeCents = serviceAlloc.get(viewerId) ?? 0

  const taxTotal = Math.max(0, Math.trunc(input.taxCents))
  const taxCents =
    billSubtotalCents > 0 && userFood > 0
      ? Math.min(taxTotal, Math.floor((taxTotal * userFood) / billSubtotalCents))
      : taxTotal > 0 && userFood === 0
        ? 0
        : 0

  const totalCents = postDiscountSubtotalCents + serviceChargeCents + taxCents

  return {
    ok: true,
    viewerId,
    foodSubtotalCents: userFood,
    discountCents,
    postDiscountSubtotalCents,
    serviceChargeCents,
    taxCents,
    totalCents,
    warnings,
  }
}
