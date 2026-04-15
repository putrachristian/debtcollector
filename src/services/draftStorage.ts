import type { DraftBillPayload } from '@/types'

const PREFIX = 'debtcollector:draft:'

export function draftKey(billId: string): string {
  return `${PREFIX}${billId}`
}

export function loadDraft(billId: string): DraftBillPayload | null {
  try {
    const raw = localStorage.getItem(draftKey(billId))
    if (!raw) return null
    const v = JSON.parse(raw) as DraftBillPayload
    if (v?.version !== 1) return null
    return v
  } catch {
    return null
  }
}

export function saveDraft(payload: DraftBillPayload & { billId: string }): void {
  const { billId, ...rest } = payload
  localStorage.setItem(draftKey(billId), JSON.stringify(rest))
}

export function clearDraft(billId: string): void {
  localStorage.removeItem(draftKey(billId))
}
