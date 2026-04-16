import { describe, expect, it } from 'vitest'
import { calculateBill } from './calculateBill'

describe('calculateBill', () => {
  const alice = 'user_alice'
  const bob = 'user_bob'
  const carol = 'user_carol'

  it('splits shared item before discount and reconciles odd cents', () => {
    const r = calculateBill({
      items: [{ id: 'i1', unitPriceCents: 100, qty: 1 }],
      participantIds: [alice, bob, carol],
      assignments: [
        { billItemId: 'i1', userId: alice, mode: 'shared_equal', claimedQty: 1 },
        { billItemId: 'i1', userId: bob, mode: 'shared_equal', claimedQty: 1 },
        { billItemId: 'i1', userId: carol, mode: 'shared_equal', claimedQty: 1 },
      ],
      billDiscount: { kind: 'amount', value: 0 },
      serviceChargeCents: 0,
      taxCents: 0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.billSubtotalCents).toBe(100)
    const sumPre = r.usersOrdered.reduce((s, id) => s + r.byUser[id].preDiscountSubtotalCents, 0)
    expect(sumPre).toBe(100)
    // 100 / 3 -> 34,33,33
    const vals = r.usersOrdered.map((id) => r.byUser[id].preDiscountSubtotalCents).sort((a, b) => b - a)
    expect(vals).toEqual([34, 33, 33])
  })

  it('applies proportional discount with exact total discount', () => {
    const r = calculateBill({
      items: [
        { id: 'a', unitPriceCents: 6000, qty: 1 },
        { id: 'b', unitPriceCents: 4000, qty: 1 },
      ],
      participantIds: [alice, bob],
      assignments: [
        { billItemId: 'a', userId: alice, mode: 'individual', claimedQty: 1 },
        { billItemId: 'b', userId: bob, mode: 'individual', claimedQty: 1 },
      ],
      billDiscount: { kind: 'percent', value: 1000 }, // 10%
      serviceChargeCents: 0,
      taxCents: 0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mergedDiscountCents).toBe(1000)
    expect(r.byUser[alice].discountCents).toBe(600)
    expect(r.byUser[bob].discountCents).toBe(400)
    expect(r.byUser[alice].postDiscountSubtotalCents).toBe(5400)
    expect(r.byUser[bob].postDiscountSubtotalCents).toBe(3600)
  })

  it('merges manual discount with bill discount as additive cents capped at subtotal', () => {
    const r = calculateBill({
      items: [{ id: 'x', unitPriceCents: 10000, qty: 1 }],
      participantIds: [alice],
      assignments: [{ billItemId: 'x', userId: alice, mode: 'individual', claimedQty: 1 }],
      billDiscount: { kind: 'percent', value: 5000 }, // 50% -> 5000
      manualDiscount: { kind: 'amount', value: 4000 },
      serviceChargeCents: 0,
      taxCents: 0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.mergedDiscountCents).toBe(9000)
    expect(r.byUser[alice].postDiscountSubtotalCents).toBe(1000)
  })

  it('splits service equally and tax after discount proportionally', () => {
    const r = calculateBill({
      items: [
        { id: 'a', unitPriceCents: 50, qty: 1 },
        { id: 'b', unitPriceCents: 50, qty: 1 },
      ],
      participantIds: [alice, bob],
      assignments: [
        { billItemId: 'a', userId: alice, mode: 'individual', claimedQty: 1 },
        { billItemId: 'b', userId: bob, mode: 'individual', claimedQty: 1 },
      ],
      billDiscount: { kind: 'amount', value: 20 },
      serviceChargeCents: 3,
      taxCents: 10,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.byUser[alice].serviceChargeCents + r.byUser[bob].serviceChargeCents).toBe(3)
    expect(r.byUser[alice].taxCents + r.byUser[bob].taxCents).toBe(10)
    const total =
      r.byUser[alice].totalCents +
      r.byUser[bob].totalCents
    // post-discount bill = 80, +3 service +10 tax
    expect(total).toBe(93)
  })

  it('returns error when item has no assignments', () => {
    const r = calculateBill({
      items: [{ id: 'x', unitPriceCents: 100, qty: 1 }],
      participantIds: [alice],
      assignments: [],
      billDiscount: { kind: 'amount', value: 0 },
      serviceChargeCents: 0,
      taxCents: 0,
    })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.some((e) => e.includes('nobody has claimed'))).toBe(true)
  })

  it('weights shared line by claimed units when qty > 1', () => {
    const r = calculateBill({
      items: [{ id: 'dish', unitPriceCents: 100, qty: 3 }],
      participantIds: [alice, bob],
      assignments: [
        { billItemId: 'dish', userId: alice, mode: 'shared_equal', claimedQty: 1 },
        { billItemId: 'dish', userId: bob, mode: 'shared_equal', claimedQty: 2 },
      ],
      billDiscount: { kind: 'amount', value: 0 },
      serviceChargeCents: 0,
      taxCents: 0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.billSubtotalCents).toBe(300)
    expect(r.byUser[alice].preDiscountSubtotalCents).toBe(100)
    expect(r.byUser[bob].preDiscountSubtotalCents).toBe(200)
  })

  it('splits shareAmong line by claimed slots when all slots are assigned', () => {
    const r = calculateBill({
      items: [{ id: 'pizza', name: 'Pizza', unitPriceCents: 300, qty: 1, shareAmong: 3 }],
      participantIds: [alice, bob],
      assignments: [
        { billItemId: 'pizza', userId: alice, mode: 'shared_equal', claimedQty: 1 },
        { billItemId: 'pizza', userId: bob, mode: 'shared_equal', claimedQty: 2 },
      ],
      billDiscount: { kind: 'amount', value: 0 },
      serviceChargeCents: 0,
      taxCents: 0,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.byUser[alice].preDiscountSubtotalCents).toBe(100)
    expect(r.byUser[bob].preDiscountSubtotalCents).toBe(200)
  })

  it('returns error when shareAmong slots are not fully claimed', () => {
    const r = calculateBill({
      items: [{ id: 'pizza', unitPriceCents: 300, qty: 1, shareAmong: 3 }],
      participantIds: [alice, bob],
      assignments: [
        { billItemId: 'pizza', userId: alice, mode: 'shared_equal', claimedQty: 1 },
        { billItemId: 'pizza', userId: bob, mode: 'shared_equal', claimedQty: 1 },
      ],
      billDiscount: { kind: 'amount', value: 0 },
      serviceChargeCents: 0,
      taxCents: 0,
    })
    expect(r.ok).toBe(false)
  })

  it('allocates tax equally when post-discount totals are all zero', () => {
    const r = calculateBill({
      items: [{ id: 'x', unitPriceCents: 100, qty: 1 }],
      participantIds: [alice, bob],
      assignments: [{ billItemId: 'x', userId: alice, mode: 'individual', claimedQty: 1 }],
      billDiscount: { kind: 'percent', value: 10000 },
      serviceChargeCents: 0,
      taxCents: 5,
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.byUser[bob].postDiscountSubtotalCents).toBe(0)
    expect(r.byUser[alice].postDiscountSubtotalCents).toBe(0)
    expect(r.byUser[alice].taxCents + r.byUser[bob].taxCents).toBe(5)
  })
})
