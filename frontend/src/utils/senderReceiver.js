/**
 * Clubbed Sender / Receiver location pairing.
 *
 * Operation Entry used to expose four location dropdowns: Origin, Sender,
 * Destination and Receiver. They are now two:
 *
 *   Sender   -> origin_location_code AND sender_location_code
 *   Receiver -> destination_location_code AND receiver_location_code
 *
 * The four database columns are kept, so records created before the change
 * still have only one side of each pair populated (normally origin /
 * destination; tracking receiver tickets also carry sender / receiver).
 * Nothing is rewritten - every read goes through the resolvers below, which
 * prefer the named column and fall back to its partner. Old and new records
 * therefore resolve to exactly one Sender and one Receiver.
 */

const clean = (value) => String(value ?? '').trim()

const first = (...values) => {
  for (const value of values) {
    const cleaned = clean(value)
    if (cleaned !== '') return cleaned
  }
  return ''
}

/**
 * Single "Sender" location code of any record (transaction, tracking ticket,
 * prefill payload). Accepts camelCase (frontend models) and snake_case (raw
 * API payloads) and honours the server-resolved `sender_code` when present.
 */
export const resolveSenderCode = (record) =>
  first(
    record?.senderCode,
    record?.sender_code,
    record?.senderLocationCode,
    record?.sender_location_code,
    record?.originLocationCode,
    record?.origin_location_code,
  )

/**
 * Single "Receiver" location code of any record.
 */
export const resolveReceiverCode = (record) =>
  first(
    record?.receiverCode,
    record?.receiver_code,
    record?.receiverLocationCode,
    record?.receiver_location_code,
    record?.destinationLocationCode,
    record?.destination_location_code,
  )

export const resolveSenderName = (record) =>
  first(
    record?.senderName,
    record?.sender_name,
    record?.senderLocationName,
    record?.sender_location_name,
    record?.originLocationName,
    record?.origin_location_name,
  )

export const resolveReceiverName = (record) =>
  first(
    record?.receiverName,
    record?.receiver_name,
    record?.receiverLocationName,
    record?.receiver_location_name,
    record?.destinationLocationName,
    record?.destination_location_name,
  )

/** "Lagos Terminal (LAG)" - falls back to the bare code, then to a dash. */
export const formatLocationLabel = (code, name) => {
  const cleanedCode = clean(code)
  const cleanedName = clean(name)

  if (cleanedCode === '') return '-'
  if (cleanedName === '') return cleanedCode
  return `${cleanedName} (${cleanedCode})`
}

export const formatSenderLabel = (record) =>
  formatLocationLabel(resolveSenderCode(record), resolveSenderName(record))

export const formatReceiverLabel = (record) =>
  formatLocationLabel(resolveReceiverCode(record), resolveReceiverName(record))

/* ------------------------------------------------------------------ *
 * Operation Entry form state helpers (camelCase `entry` object)
 * ------------------------------------------------------------------ */

/** Value shown in the single "Sender" dropdown of the entry form. */
export const entrySenderCode = (entry) =>
  first(entry?.senderLocationCode, entry?.originLocationCode)

/** Value shown in the single "Receiver" dropdown of the entry form. */
export const entryReceiverCode = (entry) =>
  first(entry?.receiverLocationCode, entry?.destinationLocationCode)

/** Apply one Sender choice to both columns of the pair. */
export const withClubbedSender = (entry, locationCode) => {
  const code = clean(locationCode)
  return {
    ...entry,
    originLocationCode: code,
    senderLocationCode: code,
  }
}

/** Apply one Receiver choice to both columns of the pair. */
export const withClubbedReceiver = (entry, locationCode) => {
  const code = clean(locationCode)
  return {
    ...entry,
    destinationLocationCode: code,
    receiverLocationCode: code,
  }
}
