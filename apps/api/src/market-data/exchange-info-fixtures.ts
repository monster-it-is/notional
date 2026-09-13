export function coin(
  symbol: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    symbol,
    pair: symbol,
    baseAsset: symbol.replace("USDT", "").replace("USDC", ""),
    quoteAsset: "USDT",
    marginAsset: "USDT",
    contractType: "PERPETUAL",
    underlyingType: "COIN",
    status: "TRADING",
    filters: requiredFilters(),
    ...overrides,
  };
}

export function requiredFilters() {
  return [
    {
      filterType: "PRICE_FILTER",
      minPrice: "0.1",
      maxPrice: "1000000",
      tickSize: "0.1",
    },
    {
      filterType: "LOT_SIZE",
      minQty: "0.001",
      maxQty: "1000",
      stepSize: "0.001",
    },
    {
      filterType: "MARKET_LOT_SIZE",
      minQty: "0.001",
      maxQty: "120",
      stepSize: "0.001",
    },
    { filterType: "MIN_NOTIONAL", notional: "50" },
  ];
}
