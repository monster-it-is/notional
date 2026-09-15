import { useSearchParams } from "react-router";

export function useSelectedSymbol(fallback: string | null): {
  symbol: string | null;
  setSymbol: (symbol: string) => void;
} {
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("symbol");
  const symbol = fromUrl && fromUrl.length > 0 ? fromUrl : fallback;

  function setSymbol(next: string): void {
    const nextParams = new URLSearchParams(params);
    nextParams.set("symbol", next);
    setParams(nextParams, { replace: true });
  }

  return { symbol, setSymbol };
}
