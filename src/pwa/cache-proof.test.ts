import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isVerifiedCacheMessage } from './cache-proof.ts'

test('an old complete cache cannot certify a new running shell; incomplete cache never qualifies', () => {
  assert.equal(isVerifiedCacheMessage({ ready: true, version: 'wortzeit-shell-old' }, 'new'), false)
  assert.equal(isVerifiedCacheMessage({ ready: false, version: 'wortzeit-shell-new' }, 'new'), false)
  assert.equal(isVerifiedCacheMessage({ ready: true, version: 'wortzeit-shell-new' }, 'new'), true)
  assert.equal(isVerifiedCacheMessage({ ready: true }, 'new'), false)
})
