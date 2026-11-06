import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spendingOverview } from '../src/live/overview.ts'

const now = new Date(2026, 0, 8, 12)
const row = (date, gross = '10', refunded = '0', merchant = 'tea') => ({ settledAt: date.toISOString(), gross, refunded, merchant: { id: merchant, name: merchant } })
test('spending periods include calendar boundaries and subtract refunds', () => {
  const result = spendingOverview([
    row(new Date(2026, 0, 2), '10', '2'), row(new Date(2026, 0, 8, 23), '5'),
    row(new Date(2026, 0, 1, 23)), row(new Date(2026, 0, 9)),
  ], '7d', now)
  assert.equal(result.count, 2)
  assert.equal(result.total, 13)
  assert.equal(result.buckets[0].value, 8)
  assert.equal(result.buckets[6].value, 5)
  assert.equal(result.merchants.length, 1)
})
test('six-month chart handles a year boundary and groups shops by ID', () => {
  const result = spendingOverview([row(new Date(2025, 7, 1), '4'), row(new Date(2025, 11, 1), '6', '0', 'books'), row(new Date(2026, 0, 1), '8')], '6m', now)
  assert.equal(result.total, 18)
  assert.equal(result.buckets[0].value, 4)
  assert.equal(result.buckets[5].value, 8)
  assert.equal(result.merchants[0].total, 12)
})
test('invalid amounts and excessive refunds cannot produce NaN or negative spending', () => {
  const result = spendingOverview([row(now, 'not-a-number'), row(now, '3', '9')], '30d', now)
  assert.equal(result.total, 0)
  assert.ok(result.buckets.every((bucket) => Number.isFinite(bucket.value)))
})
