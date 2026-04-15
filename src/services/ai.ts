import type { DiscountType, ParsedReceipt, ParsedReceiptItem } from '@/types'
import { APP_CURRENCY, majorToMinor } from '@/lib/money'

/** Full POST URL for the workflow, e.g. …/api/workflows/19219/run/dev */
function workflowUrl(): string {
  const u = (import.meta.env.VITE_AI_API_URL as string | undefined)?.trim() ?? ''
  return u.replace(/\/$/, '')
}

function bearer(): string {
  const key = (import.meta.env.VITE_AI_API_KEY as string | undefined)?.trim()
  if (!key) throw new Error('VITE_AI_API_KEY is required (Authorization: Bearer …)')
  return key
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function inferCurrency(raw: Record<string, unknown>): string {
  if (typeof raw.currency === 'string' && raw.currency.trim().length === 3) {
    return raw.currency.trim().toUpperCase()
  }
  return 'IDR'
}

/** Map one API number to stored minor units (integer Rp for IDR; cents from major for USD). */
function apiScalarToMinor(n: number, currency: string): number {
  if (!Number.isFinite(n)) return 0
  return majorToMinor(n, currency)
}

function looksLikeParsedReceipt(o: Record<string, unknown>): boolean {
  return Array.isArray(o.items)
}

/** Insea-style workflow: `data.outputs.result` is often a ```json … ``` string. */
function stripMarkdownJsonFence(s: string): string {
  let t = s.trim()
  t = t.replace(/^```(?:json)?\s*/i, '')
  t = t.replace(/\s*```\s*$/i, '')
  return t.trim()
}

function parseJsonFromAiString(s: string): unknown {
  const trimmed = s.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    try {
      return JSON.parse(stripMarkdownJsonFence(trimmed)) as unknown
    } catch {
      const jsonMatch = trimmed.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]) as unknown
      }
      throw new Error('AI result is not valid JSON')
    }
  }
}

/** If `data` is a JSON string (some gateways), parse it. */
function maybeParseStringifiedRecord(x: unknown): unknown {
  if (typeof x !== 'string') return x
  const t = x.trim()
  if (!t.startsWith('{') && !t.startsWith('[')) return x
  try {
    return JSON.parse(t) as unknown
  } catch {
    try {
      return parseJsonFromAiString(t)
    } catch {
      return x
    }
  }
}

/** Collect likely workflow output blobs (strings or objects) from a `data` node. */
function receiptCandidatesFromWorkflowData(data: unknown): unknown[] {
  const d = maybeParseStringifiedRecord(data)
  const out: unknown[] = []
  if (!isRecord(d)) return out

  const nest = maybeParseStringifiedRecord(d.data)
  if (nest !== d && isRecord(nest)) {
    out.push(...receiptCandidatesFromWorkflowData(nest))
  }

  const outs = d.outputs ?? d.output
  if (isRecord(outs)) {
    for (const k of ['result', 'output', 'text', 'content', 'message', 'json', 'data', 'body']) {
      const v = outs[k]
      if (v !== undefined && v !== null) out.push(v)
    }
    out.push(outs)
  }

  for (const k of ['result', 'output', 'text', 'content', 'message', 'json', 'body', 'response']) {
    const v = d[k]
    if (v !== undefined && v !== null) out.push(v)
  }

  return out
}

/**
 * Last resort: walk the tree for any object with `items[]` (Insea nests vary by endpoint/version).
 */
function deepFindReceiptPayload(node: unknown, seen: WeakSet<object>, depth: number): ParsedReceipt | null {
  if (depth > 40 || node === null || node === undefined) return null

  if (typeof node === 'string') {
    const t = node.trim()
    if (t.length === 0) return null
    if (t.startsWith('{') || t.startsWith('[') || t.includes('```') || t.includes('"items"')) {
      try {
        return deepFindReceiptPayload(parseJsonFromAiString(t), seen, depth + 1)
      } catch {
        return null
      }
    }
    return null
  }

  if (Array.isArray(node)) {
    for (const el of node) {
      const r = deepFindReceiptPayload(el, seen, depth + 1)
      if (r) return r
    }
    return null
  }

  if (!isRecord(node)) return null
  if (seen.has(node)) return null
  seen.add(node)

  if (looksLikeParsedReceipt(node)) {
    try {
      return normalizeParsedReceipt(node)
    } catch {
      /* keep searching */
    }
  }

  for (const v of Object.values(node)) {
    const r = deepFindReceiptPayload(v, seen, depth + 1)
    if (r) return r
  }
  return null
}

function envelopeDebugKeys(raw: Record<string, unknown>): string {
  const bits: string[] = [`root: ${Object.keys(raw).join(', ')}`]
  const d = maybeParseStringifiedRecord(raw.data)
  if (isRecord(d)) {
    bits.push(`data: ${Object.keys(d).slice(0, 24).join(', ')}${Object.keys(d).length > 24 ? '…' : ''}`)
    const outs = d.outputs ?? d.output
    if (isRecord(outs)) {
      bits.push(`outputs: ${Object.keys(outs).join(', ')}`)
    }
    const st = d.status
    if (typeof st === 'string') bits.push(`status=${st}`)
  }
  return bits.join(' | ')
}

function normalizeParsedReceipt(raw: Record<string, unknown>): ParsedReceipt {
  const currency = inferCurrency(raw)
  const itemsRaw = raw.items
  if (!Array.isArray(itemsRaw)) {
    throw new Error('AI response missing items[]')
  }

  const items: ParsedReceiptItem[] = itemsRaw.map((row, i) => {
    if (!isRecord(row)) throw new Error(`AI items[${i}] is not an object`)
    const name = typeof row.name === 'string' ? row.name : ''
    const qty = typeof row.qty === 'number' && Number.isFinite(row.qty) ? row.qty : 1
    const pr = row.price
    if (typeof pr !== 'number' || !Number.isFinite(pr)) {
      throw new Error(`AI items[${i}].price is not a number`)
    }
    return { name, qty, price: apiScalarToMinor(pr, currency) }
  })

  const subNum = raw.subtotal
  if (typeof subNum !== 'number' || !Number.isFinite(subNum)) {
    throw new Error('AI response missing numeric subtotal')
  }
  const subtotal = apiScalarToMinor(subNum, currency)

  let discount_type: DiscountType = 'percent'
  let discount_value = 0
  const disc = raw.discount
  if (disc === null || disc === undefined) {
    discount_type = 'percent'
    discount_value = 0
  } else if (isRecord(disc)) {
    discount_type = disc.kind === 'amount' ? 'amount' : 'percent'
    const v = Number(disc.value)
    if (Number.isFinite(v)) {
      if (discount_type === 'percent') {
        discount_value = Math.round(v * 100)
      } else {
        discount_value = apiScalarToMinor(v, currency)
      }
    }
  } else {
    discount_type = raw.discount_type === 'amount' ? 'amount' : 'percent'
    const dv = Number(raw.discount_value)
    if (Number.isFinite(dv)) {
      if (discount_type === 'percent') {
        if (Number.isInteger(dv) && dv > 100) discount_value = Math.round(dv)
        else discount_value = Math.round(dv * 100)
      } else {
        discount_value = apiScalarToMinor(dv, currency)
      }
    }
  }

  const svcRaw = raw.service_charge
  const service_charge =
    svcRaw === null || svcRaw === undefined
      ? 0
      : typeof svcRaw === 'number' && Number.isFinite(svcRaw)
        ? apiScalarToMinor(svcRaw, currency)
        : 0

  let tax = 0
  const taxRaw = raw.tax
  if (taxRaw === null || taxRaw === undefined) {
    tax = 0
  } else if (isRecord(taxRaw)) {
    const kind = taxRaw.kind === 'amount' ? 'amount' : 'percent'
    const val = Number(taxRaw.value)
    if (kind === 'percent' && Number.isFinite(val)) {
      const totalRaw = raw.total
      if (typeof totalRaw === 'number' && Number.isFinite(totalRaw)) {
        const totalMinor = apiScalarToMinor(totalRaw, currency)
        tax = Math.max(0, Math.round(totalMinor - subtotal - service_charge))
      } else {
        tax = Math.round((subtotal * val) / 100)
      }
    } else if (kind === 'amount' && Number.isFinite(val)) {
      tax = apiScalarToMinor(val, currency)
    }
  } else if (typeof taxRaw === 'number' && Number.isFinite(taxRaw)) {
    tax = apiScalarToMinor(taxRaw, currency)
  }

  const merchantRaw =
    raw.merchant ?? raw.merchant_name ?? raw.store_name ?? raw.vendor ?? raw.store
  const merchant =
    typeof merchantRaw === 'string'
      ? merchantRaw.trim() || null
      : merchantRaw === null
        ? null
        : undefined
  const confidence =
    typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) ? raw.confidence : undefined
  const warnings = Array.isArray(raw.warnings) ? raw.warnings : undefined

  return {
    currency,
    merchant,
    items,
    subtotal,
    discount_type,
    discount_value,
    service_charge,
    tax,
    confidence,
    warnings,
  }
}

/** Unwrap nested workflow responses until we find ParsedReceipt shape. */
function coerceParsedReceipt(raw: unknown): ParsedReceipt {
  if (raw === null || raw === undefined) {
    throw new Error('AI returned empty body')
  }
  if (typeof raw === 'string') {
    try {
      return coerceParsedReceipt(parseJsonFromAiString(raw))
    } catch {
      throw new Error('AI returned non-JSON text')
    }
  }
  if (!isRecord(raw)) {
    throw new Error('AI returned unexpected JSON type')
  }
  if (looksLikeParsedReceipt(raw)) {
    return normalizeParsedReceipt(raw)
  }

  const dataRaw = maybeParseStringifiedRecord(raw.data)
  if (dataRaw !== undefined && dataRaw !== null) {
    for (const cand of receiptCandidatesFromWorkflowData(raw.data)) {
      try {
        return coerceParsedReceipt(cand)
      } catch {
        /* next candidate */
      }
    }
    try {
      return coerceParsedReceipt(dataRaw)
    } catch {
      /* generic unwrap below */
    }
  }

  for (const key of ['data', 'output', 'outputs', 'result', 'body', 'response', 'payload']) {
    const inner = raw[key]
    if (inner !== undefined && inner !== null) {
      try {
        return coerceParsedReceipt(inner)
      } catch {
        /* try next key */
      }
    }
  }
  if (typeof raw.json === 'string') {
    try {
      return coerceParsedReceipt(JSON.parse(raw.json) as unknown)
    } catch {
      /* fall through */
    }
  }

  const found = deepFindReceiptPayload(raw, new WeakSet(), 0)
  if (found) return found

  throw new Error(
    `AI response missing expected receipt fields (items[]). ${envelopeDebugKeys(raw)}`
  )
}

/**
 * POST workflow URL with multipart form (field `image`) and Bearer auth,
 * matching the Pokemon PWA pattern (FormData + file blob, no manual Content-Type).
 */
export async function parseReceipt(file: File, signal?: AbortSignal): Promise<ParsedReceipt> {
  const url = workflowUrl()
  if (!url) {
    throw new Error('VITE_AI_API_URL is not configured (full workflow POST URL)')
  }

  const formData = new FormData()
  formData.append('image', file, file.name || 'receipt.jpg')

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer()}`,
    },
    body: formData,
    signal,
  })

  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`AI workflow failed: ${res.status} ${text.slice(0, 500)}`)
  }

  let json: unknown
  try {
    json = text ? (JSON.parse(text) as unknown) : null
  } catch {
    throw new Error(`AI response is not JSON: ${text.slice(0, 200)}`)
  }

  return coerceParsedReceipt(json)
}

/** Map normalized receipt (minor units + bps discount) into editor / DB fields. */
export function parsedReceiptToCentsModel(p: ParsedReceipt) {
  const items = p.items.map((it, i) => ({
    id: `ai-${i}`,
    name: it.name,
    unitPriceCents: Math.round(it.price),
    qty: Math.max(1, Math.round(it.qty || 1)),
  }))
  const subtotalCents = Math.round(p.subtotal)
  const serviceChargeCents = Math.round(p.service_charge)
  const taxCents = Math.round(p.tax)
  const discountStored = Math.round(p.discount_value)

  return {
    currency: APP_CURRENCY,
    items,
    subtotalCents,
    discountType: p.discount_type,
    discountValue: discountStored,
    serviceChargeCents,
    taxCents,
  }
}
