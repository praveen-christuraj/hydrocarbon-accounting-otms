/*
 * Clubbed Sender / Receiver pairing - contract test.
 *
 * Operation Entry used to expose four location dropdowns (Origin, Sender,
 * Destination, Receiver). It now exposes two:
 *
 *     Sender   -> origin_location_code AND sender_location_code
 *     Receiver -> destination_location_code AND receiver_location_code
 *
 * The four database columns are kept, so records created before the change
 * only carry one side of each pair. Nothing is rewritten - every read goes
 * through the resolvers in `src/utils/senderReceiver.js`, which prefer the
 * named column and fall back to its partner.
 *
 * The second half of this file covers the operation date: the Operation
 * Date / Start Date-Time / End Date-Time inputs were removed from the
 * metadata because the date is captured inside the data-entry payload
 * (gauging date, tanker transaction date, reading date, multi-tank
 * before/after dates, FSO / Shuttle operation date). `operation_date` is
 * still a mandatory column, so `src/utils/operationDate.js` derives it.
 *
 * Usage: npm run test:sender-receiver
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import {
  entryReceiverCode,
  entrySenderCode,
  formatReceiverLabel,
  formatSenderLabel,
  resolveReceiverCode,
  resolveSenderCode,
  withClubbedReceiver,
  withClubbedSender,
} from '../src/utils/senderReceiver.js'
import {
  resolveOperationDate,
  resolveOperationDateFromValues,
} from '../src/utils/operationDate.js'

const checks = []

const check = (label, ok, detail = '') => {
  checks.push({ label, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  ${detail}` : ''}`)
}

/* ------------------------------------------------------------------ *
 * 1. Resolvers: old records and new records read identically
 * ------------------------------------------------------------------ */

console.log('\nSender / Receiver resolution')

const clubbed = {
  originLocationCode: 'AGGE',
  senderLocationCode: 'AGGE',
  destinationLocationCode: 'UTP',
  receiverLocationCode: 'UTP',
}

check(
  'a clubbed record resolves to its two ends',
  resolveSenderCode(clubbed) === 'AGGE' && resolveReceiverCode(clubbed) === 'UTP',
  `${resolveSenderCode(clubbed)} -> ${resolveReceiverCode(clubbed)}`,
)

// A ticket stored before the change: only origin / destination populated.
const legacy = {
  originLocationCode: 'AGGE',
  senderLocationCode: '',
  destinationLocationCode: 'UTP',
  receiverLocationCode: '',
}

check(
  'a legacy record (origin / destination only) resolves the same way',
  resolveSenderCode(legacy) === 'AGGE' && resolveReceiverCode(legacy) === 'UTP',
  `${resolveSenderCode(legacy)} -> ${resolveReceiverCode(legacy)}`,
)

// A raw API row (snake_case) with the server-resolved pair.
const apiRow = {
  origin_location_code: 'UTP',
  sender_location_code: 'AGGE',
  destination_location_code: 'UTP',
  receiver_location_code: 'UTP',
  sender_code: 'AGGE',
  receiver_code: 'UTP',
}

check(
  'a raw API row resolves from the server-side pair',
  resolveSenderCode(apiRow) === 'AGGE' && resolveReceiverCode(apiRow) === 'UTP',
)

check(
  'labels fall back to the bare code, then to a dash',
  formatSenderLabel({ sender_code: 'AGGE', sender_name: 'Agge' }) === 'Agge (AGGE)' &&
    formatSenderLabel({ sender_code: 'AGGE' }) === 'AGGE' &&
    formatReceiverLabel({}) === '-',
  formatSenderLabel({ sender_code: 'AGGE', sender_name: 'Agge' }),
)

/* ------------------------------------------------------------------ *
 * 2. The entry form writes both columns of a pair
 * ------------------------------------------------------------------ */

console.log('\nOperation Entry form state')

const base = {
  originLocationCode: '',
  senderLocationCode: '',
  destinationLocationCode: '',
  receiverLocationCode: '',
}

const withSender = withClubbedSender(base, 'AGGE')
check(
  'one Sender choice writes Origin and Sender',
  withSender.originLocationCode === 'AGGE' && withSender.senderLocationCode === 'AGGE',
)

const withReceiver = withClubbedReceiver(withSender, 'UTP')
check(
  'one Receiver choice writes Destination and Receiver',
  withReceiver.destinationLocationCode === 'UTP' &&
    withReceiver.receiverLocationCode === 'UTP',
)

check(
  'the dropdown reads back the clubbed value',
  entrySenderCode(withReceiver) === 'AGGE' && entryReceiverCode(withReceiver) === 'UTP',
)

// A linked receiver ticket keeps the receiving terminal as its origin: the
// dropdown must still show the dispatching terminal (the stored Sender).
const linkedEntry = {
  originLocationCode: 'UTP',
  senderLocationCode: 'AGGE',
  destinationLocationCode: 'UTP',
  receiverLocationCode: 'UTP',
}
check(
  'a linked receiver ticket shows the dispatching terminal as Sender',
  entrySenderCode(linkedEntry) === 'AGGE',
  entrySenderCode(linkedEntry),
)

/* ------------------------------------------------------------------ *
 * 3. Operation date comes from the data-entry payload
 * ------------------------------------------------------------------ */

console.log('\nOperation date resolution')

const dateCases = [
  ['tank gauging', { inputs: { gaugingDate: '2026-09-02', gaugingTime: '10:00' }, calibration: { effective_date: '2020-01-01' } }, '2026-09-02'],
  ['tanker loading', { inputs: { tankerTransactionDate: '2026-08-15', tankerTransactionTime: '09:00:00' } }, '2026-08-15'],
  ['flowmeter: typed reading beats the mirrored operation_date', { inputs: { operation_date: '2026-01-01', reading_date: '2026-07-07' } }, '2026-07-07'],
  ['flowmeter: mirrored operation_date when nothing is typed', { inputs: { operation_date: '2026-01-01', reading_date: '' } }, '2026-01-01'],
  ['multi-tank before/after', { inputs: { before: { date: '2026-05-05', time: '08:00' }, after: { date: '2026-05-06', time: '09:00' } } }, '2026-05-05'],
  ['FSO / Shuttle', { inputs: { operation_date: '2026-03-03', event_time: '11:00' } }, '2026-03-03'],
]

for (const [label, payload, expected] of dateCases) {
  const got = resolveOperationDateFromValues([{ fieldValue: payload }])
  check(label, got === expected, `${got} (want ${expected})`)
}

const stringified = resolveOperationDateFromValues([
  { fieldValue: JSON.stringify({ inputs: { gaugingDate: '2026-04-04' } }) },
])
check('a payload stored as a JSON string is parsed', stringified === '2026-04-04', stringified)

const keptStored = resolveOperationDate({
  values: [{ fieldValue: { inputs: { gaugingDate: '' } } }],
  operationDate: '2026-02-02',
})
check('an edited draft keeps its stored date when the payload has none', keptStored === '2026-02-02', keptStored)

const today = resolveOperationDate({ values: [], operationDate: '' })
check(
  'a brand new ticket falls back to today',
  /^\d{4}-\d{2}-\d{2}$/.test(today),
  today,
)

/* ------------------------------------------------------------------ */

const failed = checks.filter((c) => !c.ok)
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
process.exit(failed.length === 0 ? 0 : 1)
