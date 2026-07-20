import { formatNumber } from '../../utils/tankQuantityEngine'

const parsePayload = (rawValue) => {
  if (!rawValue) {
    return null
  }

  if (typeof rawValue === 'object') {
    return rawValue
  }

  const text = String(rawValue || '').trim()

  if (!text || text === '[object Object]') {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const getTankerPayloadFromValues = (values = []) => {
  const payloadValue = values.find((item) => {
    return item.fieldCode === 'tanker_payload'
  })

  return parsePayload(payloadValue?.fieldValue)
}

const getValue = (...values) => {
  for (const value of values) {
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      return value
    }
  }

  return '-'
}

const numberOrDash = (value, decimals = 3) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    return '-'
  }

  return formatNumber(Number(value || 0), decimals)
}

function PreviewCard({ title, children }) {
  return (
    <div className="tanker-preview-card">
      <h4>{title}</h4>
      <div className="tanker-preview-grid">{children}</div>
    </div>
  )
}

function PreviewItem({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function TankerPayloadPreview({
  entry = null,
  values = [],
  payload = null,
  title = 'Tanker Ticket Preview',
}) {
  const tankerPayload =
    payload || getTankerPayloadFromValues(entry?.values || values)

  if (!tankerPayload) {
    return (
      <div className="info-box">
        No tanker payload found for this ticket. Please confirm that the
        operation template has the JSON/System field{' '}
        <strong>tanker_payload</strong>.
      </div>
    )
  }

  const inputs = tankerPayload.inputs || {}
  const calculated = tankerPayload.calculated || {}
  const validation = tankerPayload.validation || {}
  const calibration = tankerPayload.calibration || {}

  const tankerAsset =
    tankerPayload.tanker_trailer_asset ||
    tankerPayload.linked_tanker_asset ||
    tankerPayload.tanker_asset ||
    tankerPayload.asset ||
    {}

  const primeMoverAsset = tankerPayload.prime_mover_asset || {}
  const senderReference = tankerPayload.sender_reference || {}

  return (
    <div className="tanker-preview-panel">
      <div className="tanker-preview-header">
        <div>
          <h3>{title}</h3>
          <p>
            Read-only preview for review / approval. This data is taken from the
            saved tanker_payload.
          </p>
        </div>

        <span
          className={`status-badge ${
            validation?.isValid === false ? 'rejected' : 'active'
          }`}
        >
          {validation?.isValid === false ? 'Validation Warning' : 'Calculated'}
        </span>
      </div>

      {validation?.messages && validation.messages.length > 0 && (
        <div className="info-box">
          {validation.messages.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      )}

      <div className="tanker-preview-section-grid">
        <PreviewCard title="Trip / Asset">
          <PreviewItem
            label="Tanker"
            value={`${getValue(
              tankerAsset.asset_name,
              tankerAsset.assetName,
              inputs.tankerName
            )} (${getValue(
              tankerAsset.asset_code,
              tankerAsset.assetCode,
              '-'
            )})`}
          />

          <PreviewItem
            label="Prime Mover"
            value={`${getValue(
              primeMoverAsset.asset_name,
              primeMoverAsset.assetName,
              inputs.primeMoverNumber
            )} (${getValue(
              primeMoverAsset.asset_code,
              primeMoverAsset.assetCode,
              '-'
            )})`}
          />

          <PreviewItem
            label="Chassis"
            value={getValue(
              tankerAsset.serial_number,
              tankerAsset.serialNumber,
              inputs.chassisNumber
            )}
          />

          <PreviewItem
            label="Convoy"
            value={getValue(inputs.convoyNumber, entry?.convoyNumber)}
          />

          <PreviewItem
            label="Product"
            value={getValue(inputs.cargo, entry?.productName)}
          />

          <PreviewItem
            label="Date / Time"
            value={`${getValue(
              inputs.tankerTransactionDate,
              entry?.operationDate
            )} ${getValue(inputs.tankerTransactionTime, '')}`}
          />

          <PreviewItem
            label="Calibration"
            value={getValue(
              calibration.calibration_name,
              calibration.calibrationName
            )}
          />

          <PreviewItem
            label="Input → Output"
            value={`${getValue(
              calibration.input_column,
              calibration.inputColumn
            )} → ${getValue(
              calibration.output_column,
              calibration.outputColumn
            )}`}
          />
        </PreviewCard>

        <PreviewCard title="Dips / Quality">
          <PreviewItem
            label="Compartment"
            value={getValue(inputs.compartment)}
          />

          <PreviewItem
            label="Total Dip"
            value={`${numberOrDash(inputs.totalDipCm, 1)} cm`}
          />

          <PreviewItem
            label="Water Dip"
            value={`${numberOrDash(inputs.waterDipCm, 1)} cm`}
          />

          <PreviewItem
            label="BS&W"
            value={`${numberOrDash(inputs.bswPercent, 2)} %`}
          />

          <PreviewItem
            label="Tank Temperature"
            value={`${numberOrDash(inputs.tankTemperature, 2)} ${getValue(
              inputs.tankTemperatureUnit,
              ''
            )}`}
          />

          <PreviewItem
            label="Sample Temperature"
            value={`${numberOrDash(inputs.sampleTemperature, 2)} ${getValue(
              inputs.sampleTemperatureUnit,
              ''
            )}`}
          />

          <PreviewItem
            label="Observed API"
            value={numberOrDash(
              getValue(inputs.observedApi, calculated.observedApi, ''),
              2
            )}
          />

          <PreviewItem
            label="Observed Density"
            value={numberOrDash(
              getValue(inputs.observedDensity, calculated.observedDensity, ''),
              4
            )}
          />
        </PreviewCard>

        <PreviewCard title="Calculated Quantity">
          <PreviewItem
            label="TOV"
            value={`${numberOrDash(
              getValue(calculated.tovBbl, calculated.totalVolumeBbl, ''),
              3
            )} bbl`}
          />

          <PreviewItem
            label="Free Water"
            value={`${numberOrDash(
              getValue(calculated.freeWaterBbl, calculated.waterVolumeBbl, ''),
              3
            )} bbl`}
          />

          <PreviewItem
            label="GOV"
            value={`${numberOrDash(calculated.govBbl, 3)} bbl`}
          />

          <PreviewItem
            label="VCF"
            value={numberOrDash(calculated.vcf, 6)}
          />

          <PreviewItem
            label="GSV"
            value={`${numberOrDash(calculated.gsvBbl, 3)} bbl`}
          />

          <PreviewItem
            label="BS&W Volume"
            value={`${numberOrDash(
              getValue(calculated.bswBbl, calculated.bswVolumeBbl, ''),
              3
            )} bbl`}
          />

          <PreviewItem
            label="NSV"
            value={`${numberOrDash(calculated.nsvBbl, 3)} bbl`}
          />

          <PreviewItem
            label="API @ 60"
            value={numberOrDash(calculated.api60, 2)}
          />

          <PreviewItem label="LT Factor" value={numberOrDash(calculated.ltFactor, 6)} />

          <PreviewItem label="LT" value={numberOrDash(calculated.lt, 3)} />

          <PreviewItem label="MT" value={numberOrDash(calculated.mt, 3)} />
        </PreviewCard>

        <PreviewCard title="Seal / Remarks">
          <PreviewItem label="Seal C1" value={getValue(inputs.sealC1)} />
          <PreviewItem label="Seal C2" value={getValue(inputs.sealC2)} />
          <PreviewItem label="Seal M1" value={getValue(inputs.sealM1)} />
          <PreviewItem label="Seal M2" value={getValue(inputs.sealM2)} />

          <div className="tanker-preview-wide">
            <span>Remarks</span>
            <strong>{getValue(inputs.remarks, entry?.remarks)}</strong>
          </div>
        </PreviewCard>

        {senderReference && senderReference.sender_transaction_id && (
          <PreviewCard title="Sender Reference">
            <PreviewItem
              label="Sender Ticket"
              value={getValue(
                senderReference.ticket_number,
                senderReference.operation_number
              )}
            />

            <PreviewItem
              label="Sender Transaction ID"
              value={senderReference.sender_transaction_id}
            />

            <PreviewItem
              label="Sender NSV"
              value={`${numberOrDash(senderReference.sender_nsv_bbl, 3)} bbl`}
            />

            <PreviewItem
              label="Sender GSV"
              value={`${numberOrDash(senderReference.sender_gsv_bbl, 3)} bbl`}
            />

            <PreviewItem
              label="Sender GOV"
              value={`${numberOrDash(senderReference.sender_gov_bbl, 3)} bbl`}
            />

            <PreviewItem
              label="Sender Seals"
              value={`C1: ${getValue(
                senderReference.sender_seal_c1
              )} / C2: ${getValue(
                senderReference.sender_seal_c2
              )} / M1: ${getValue(
                senderReference.sender_seal_m1
              )} / M2: ${getValue(senderReference.sender_seal_m2)}`}
            />
          </PreviewCard>
        )}
      </div>
    </div>
  )
}

export default TankerPayloadPreview