export type InstrumentQuoteAsset = "USDT";

export type InstrumentContractType = "PERPETUAL";

export type InstrumentStatus = "ACTIVE" | "INACTIVE";

export type InstrumentResponse = {
  id: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: InstrumentQuoteAsset;
  contractType: InstrumentContractType;
  status: InstrumentStatus;
  tickSize: string;
  minPrice: string;
  maxPrice: string;
  stepSize: string;
  minQty: string;
  maxQty: string;
  marketStepSize: string;
  marketMinQty: string;
  marketMaxQty: string;
  minNotional: string;
};

export type InstrumentListResponse = {
  instruments: InstrumentResponse[];
};

export type InstrumentNotFoundError = {
  error: "INSTRUMENT_NOT_FOUND";
};
