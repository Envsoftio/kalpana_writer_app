import assert from 'node:assert/strict'
import {
  apiErrorMessage,
  countWords,
  isDeleted,
  toWriterDate,
} from '../utils/writer.ts'

assert.equal(toWriterDate(1_616_748_684)?.getTime(), 1_616_748_684_000)
assert.equal(toWriterDate(1_616_748_684_000)?.getTime(), 1_616_748_684_000)
assert.equal(toWriterDate(0), null)
assert.equal(toWriterDate('invalid'), null)

assert.equal(countWords(''), 0)
assert.equal(countWords(' one\n two\tthree '), 3)
assert.equal(isDeleted(1), true)
assert.equal(isDeleted(false), false)
assert.equal(
  apiErrorMessage({ data: { statusMessage: 'Expected' } }, 'Fallback'),
  'Expected',
)
assert.equal(apiErrorMessage(null, 'Fallback'), 'Fallback')

console.log('UI utility validation passed.')
