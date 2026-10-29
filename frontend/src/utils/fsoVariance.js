export const calculateFsoVariance = (netStock, netWater, vesselQuantity) =>
  Math.abs(netStock + netWater) - vesselQuantity
