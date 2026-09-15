import type { PrivateInvalidateReason, PrivateResource } from "@notional/contracts";

import type { Logger } from "../market-data/types.js";

export type CommittedPrivateEffect = {
  paperAccountId: string;
  reason: PrivateInvalidateReason;
  resources: PrivateResource[];
};

const FUNDING_RESOURCES: PrivateResource[] = ["account", "positions", "perpFunding"];

export function uniqueResources(resources: PrivateResource[]): PrivateResource[] {
  return [...new Set(resources)];
}

export function withFundingResources(
  resources: PrivateResource[],
  settledFunding: boolean,
): PrivateResource[] {
  if (!settledFunding) {
    return uniqueResources(resources);
  }

  return uniqueResources([...resources, ...FUNDING_RESOURCES]);
}

export function placeOrderEffect(params: {
  paperAccountId: string;
  created: boolean;
  status: string;
  settledFunding: boolean;
}): CommittedPrivateEffect | null {
  if (!params.created) {
    return null;
  }

  if (params.status === "OPEN") {
    return {
      paperAccountId: params.paperAccountId,
      reason: "ORDER_PLACED",
      resources: withFundingResources(["orders"], params.settledFunding),
    };
  }

  if (params.status === "FILLED") {
    return {
      paperAccountId: params.paperAccountId,
      reason: "ORDER_FILLED",
      resources: withFundingResources(
        ["orders", "executions", "positions", "account"],
        params.settledFunding,
      ),
    };
  }

  return null;
}

export function cancelOrderEffect(paperAccountId: string): CommittedPrivateEffect {
  return {
    paperAccountId,
    reason: "ORDER_CANCELLED",
    resources: ["orders"],
  };
}

export function matcherEffect(params: {
  paperAccountId: string;
  filled: boolean;
  settledFunding: boolean;
}): CommittedPrivateEffect | null {
  if (params.filled) {
    return {
      paperAccountId: params.paperAccountId,
      reason: "LIMIT_MATCHED",
      resources: withFundingResources(
        ["orders", "executions", "positions", "account"],
        params.settledFunding,
      ),
    };
  }

  if (params.settledFunding) {
    return {
      paperAccountId: params.paperAccountId,
      reason: "FUNDING_SETTLED",
      resources: uniqueResources(FUNDING_RESOURCES),
    };
  }

  return null;
}

export function liquidationEffect(params: {
  paperAccountId: string;
  liquidated: boolean;
  settledFunding: boolean;
}): CommittedPrivateEffect | null {
  if (params.liquidated) {
    return {
      paperAccountId: params.paperAccountId,
      reason: "LIQUIDATION",
      resources: withFundingResources(
        ["liquidations", "orders", "executions", "positions", "account"],
        params.settledFunding,
      ),
    };
  }

  if (params.settledFunding) {
    return {
      paperAccountId: params.paperAccountId,
      reason: "FUNDING_SETTLED",
      resources: uniqueResources(FUNDING_RESOURCES),
    };
  }

  return null;
}

export function fundingSettledEffect(paperAccountId: string): CommittedPrivateEffect {
  return {
    paperAccountId,
    reason: "FUNDING_SETTLED",
    resources: uniqueResources(FUNDING_RESOURCES),
  };
}

export function faucetEffect(params: {
  paperAccountId: string;
  settledFunding: boolean;
}): CommittedPrivateEffect {
  return {
    paperAccountId: params.paperAccountId,
    reason: "FAUCET_CLAIMED",
    resources: withFundingResources(["account", "walletFunding"], params.settledFunding),
  };
}

export function marginSettingsEffect(paperAccountId: string): CommittedPrivateEffect {
  return {
    paperAccountId,
    reason: "MARGIN_SETTINGS_CHANGED",
    resources: ["marginSettings"],
  };
}

export function accountInitializedEffect(paperAccountId: string): CommittedPrivateEffect {
  return {
    paperAccountId,
    reason: "ACCOUNT_INITIALIZED",
    resources: ["account", "walletFunding"],
  };
}

export function safeOnPrivateCommitted(
  callback: ((effect: CommittedPrivateEffect) => void) | undefined,
  effect: CommittedPrivateEffect | null,
  logger: Logger,
): void {
  if (!callback || !effect) {
    return;
  }

  try {
    callback(effect);
  } catch (error) {
    logger.error("private realtime publication failed", {
      paperAccountId: effect.paperAccountId,
      reason: effect.reason,
      detail: error instanceof Error ? error.message : "private realtime publication failed",
    });
  }
}
