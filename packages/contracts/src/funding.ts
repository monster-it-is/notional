export type PerpFundingHistoryItem = {
  id: string;
  symbol: string;
  fundingTime: string;
  marginMode: "CROSS" | "ISOLATED";
  quantity: string;
  fundingRate: string;
  markPrice: string;
  fundingPayment: string;
  createdAt: string;
};

export type PerpFundingHistoryResponse = {
  funding: PerpFundingHistoryItem[];
};

export type FundingDataUnavailableError = {
  error: "FUNDING_DATA_UNAVAILABLE";
};
