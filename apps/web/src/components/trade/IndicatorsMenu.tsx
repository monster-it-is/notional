import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "../ui/Button.tsx";
import { FormField } from "../ui/FormField.tsx";
import { Input } from "../ui/Input.tsx";
import { cn } from "../../lib/cn.ts";
import {
  indicatorEnabledCount,
  parseBollingerMultiplierInput,
  parseBollingerPeriod,
  parseEmaPeriod,
  parseMacdTripleInput,
  parseRsiPeriod,
  parseSmaPeriod,
  type IndicatorSettings,
} from "../../lib/chart/indicators/settings.ts";

const MACD_TRIPLE_ERROR = "Enter a valid MACD triple: fast 1–500, slow 2–500, signal 1–500, and fast less than slow.";

export function IndicatorsMenu({
  settings,
  onSettingsChange,
}: {
  settings: IndicatorSettings;
  onSettingsChange: (settings: IndicatorSettings) => void;
}) {
  const [open, setOpen] = useState(false);
  const [smaDraft, setSmaDraft] = useState(String(settings.sma.period));
  const [emaDraft, setEmaDraft] = useState(String(settings.ema.period));
  const [rsiDraft, setRsiDraft] = useState(String(settings.rsi.period));
  const [macdFastDraft, setMacdFastDraft] = useState(String(settings.macd.fast));
  const [macdSlowDraft, setMacdSlowDraft] = useState(String(settings.macd.slow));
  const [macdSignalDraft, setMacdSignalDraft] = useState(String(settings.macd.signal));
  const [bbPeriodDraft, setBbPeriodDraft] = useState(String(settings.bollinger.period));
  const [bbMultiplierDraft, setBbMultiplierDraft] = useState(settings.bollinger.multiplier);
  const [smaError, setSmaError] = useState<string | null>(null);
  const [emaError, setEmaError] = useState<string | null>(null);
  const [rsiError, setRsiError] = useState<string | null>(null);
  const [macdError, setMacdError] = useState<string | null>(null);
  const [bbPeriodError, setBbPeriodError] = useState<string | null>(null);
  const [bbMultiplierError, setBbMultiplierError] = useState<string | null>(null);
  const popoverId = useId();
  const smaPeriodId = useId();
  const emaPeriodId = useId();
  const rsiPeriodId = useId();
  const macdFastId = useId();
  const macdSlowId = useId();
  const macdSignalId = useId();
  const bbPeriodId = useId();
  const bbMultiplierId = useId();
  const smaErrorId = useId();
  const emaErrorId = useId();
  const rsiErrorId = useId();
  const macdErrorId = useId();
  const bbPeriodErrorId = useId();
  const bbMultiplierErrorId = useId();
  const triggerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const enabledCount = indicatorEnabledCount(settings);
  const triggerLabel = enabledCount > 0 ? `Indicators, ${enabledCount} enabled` : "Indicators";

  useEffect(() => {
    if (!open) {
      return;
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
        document.getElementById(triggerId)?.focus();
      }
    }

    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    window.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, triggerId]);

  function commitSmaPeriod(): void {
    const parsed = parseSmaPeriod(smaDraft);

    if (parsed === null) {
      setSmaError("Enter an integer from 1 to 500.");
      return;
    }

    setSmaError(null);
    onSettingsChange({ ...settings, sma: { ...settings.sma, period: parsed } });
  }

  function commitEmaPeriod(): void {
    const parsed = parseEmaPeriod(emaDraft);

    if (parsed === null) {
      setEmaError("Enter an integer from 1 to 500.");
      return;
    }

    setEmaError(null);
    onSettingsChange({ ...settings, ema: { ...settings.ema, period: parsed } });
  }

  function commitRsiPeriod(): void {
    const parsed = parseRsiPeriod(rsiDraft);

    if (parsed === null) {
      setRsiError("Enter an integer from 2 to 500.");
      return;
    }

    setRsiError(null);
    onSettingsChange({ ...settings, rsi: { ...settings.rsi, period: parsed } });
  }

  function commitMacdParams(): void {
    const parsed = parseMacdTripleInput(macdFastDraft, macdSlowDraft, macdSignalDraft);

    if (parsed === null) {
      setMacdError(MACD_TRIPLE_ERROR);
      return;
    }

    setMacdError(null);
    onSettingsChange({
      ...settings,
      macd: { ...settings.macd, fast: parsed.fast, slow: parsed.slow, signal: parsed.signal },
    });
  }

  function commitBbPeriod(): void {
    const parsed = parseBollingerPeriod(bbPeriodDraft);

    if (parsed === null) {
      setBbPeriodError("Enter an integer from 2 to 500.");
      return;
    }

    setBbPeriodError(null);
    onSettingsChange({
      ...settings,
      bollinger: { ...settings.bollinger, period: parsed },
    });
  }

  function commitBbMultiplier(): void {
    const parsed = parseBollingerMultiplierInput(bbMultiplierDraft);

    if (parsed === null) {
      setBbMultiplierError("Enter a decimal greater than 0 and at most 20.");
      return;
    }

    setBbMultiplierError(null);
    onSettingsChange({
      ...settings,
      bollinger: { ...settings.bollinger, multiplier: parsed },
    });
  }

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <Button
        type="button"
        size="sm"
        variant={enabledCount > 0 ? "primary" : "secondary"}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={triggerLabel}
        id={triggerId}
        onClick={() => setOpen((value) => !value)}
      >
        Indicators
      </Button>
      {open ? (
        <div
          className="absolute right-0 z-40 mt-1 w-[min(20rem,calc(100vw-2rem))] max-h-[min(24rem,70dvh)] overflow-y-auto border border-border bg-surface p-3"
          id={popoverId}
        >
          <IndicatorRow
            enabled={settings.sma.enabled}
            label="SMA"
            onEnabledChange={(enabled) =>
              onSettingsChange({ ...settings, sma: { ...settings.sma, enabled } })
            }
          >
            <FormField label="SMA period" htmlFor={smaPeriodId}>
              <Input
                id={smaPeriodId}
                numeric
                inputMode="numeric"
                value={smaDraft}
                invalid={Boolean(smaError)}
                aria-describedby={smaError ? smaErrorId : undefined}
                onChange={(event) => setSmaDraft(event.target.value)}
                onBlur={commitSmaPeriod}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitSmaPeriod();
                  }
                }}
              />
              {smaError ? (
                <p className="mt-1 text-xs text-warning" id={smaErrorId}>
                  {smaError}
                </p>
              ) : null}
            </FormField>
          </IndicatorRow>
          <IndicatorRow
            enabled={settings.ema.enabled}
            label="EMA"
            onEnabledChange={(enabled) =>
              onSettingsChange({ ...settings, ema: { ...settings.ema, enabled } })
            }
          >
            <FormField label="EMA period" htmlFor={emaPeriodId}>
              <Input
                id={emaPeriodId}
                numeric
                inputMode="numeric"
                value={emaDraft}
                invalid={Boolean(emaError)}
                aria-describedby={emaError ? emaErrorId : undefined}
                onChange={(event) => setEmaDraft(event.target.value)}
                onBlur={commitEmaPeriod}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitEmaPeriod();
                  }
                }}
              />
              {emaError ? (
                <p className="mt-1 text-xs text-warning" id={emaErrorId}>
                  {emaError}
                </p>
              ) : null}
            </FormField>
          </IndicatorRow>
          <IndicatorRow
            enabled={settings.bollinger.enabled}
            label="Bollinger Bands"
            onEnabledChange={(enabled) =>
              onSettingsChange({
                ...settings,
                bollinger: { ...settings.bollinger, enabled },
              })
            }
          >
            <FormField label="Bollinger period" htmlFor={bbPeriodId}>
              <Input
                id={bbPeriodId}
                numeric
                inputMode="numeric"
                value={bbPeriodDraft}
                invalid={Boolean(bbPeriodError)}
                aria-describedby={bbPeriodError ? bbPeriodErrorId : undefined}
                onChange={(event) => setBbPeriodDraft(event.target.value)}
                onBlur={commitBbPeriod}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitBbPeriod();
                  }
                }}
              />
              {bbPeriodError ? (
                <p className="mt-1 text-xs text-warning" id={bbPeriodErrorId}>
                  {bbPeriodError}
                </p>
              ) : null}
            </FormField>
            <FormField label="Bollinger multiplier" htmlFor={bbMultiplierId}>
              <Input
                id={bbMultiplierId}
                numeric
                inputMode="decimal"
                value={bbMultiplierDraft}
                invalid={Boolean(bbMultiplierError)}
                aria-describedby={bbMultiplierError ? bbMultiplierErrorId : undefined}
                onChange={(event) => setBbMultiplierDraft(event.target.value)}
                onBlur={commitBbMultiplier}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitBbMultiplier();
                  }
                }}
              />
              {bbMultiplierError ? (
                <p className="mt-1 text-xs text-warning" id={bbMultiplierErrorId}>
                  {bbMultiplierError}
                </p>
              ) : null}
            </FormField>
          </IndicatorRow>
          <IndicatorRow
            enabled={settings.rsi.enabled}
            label="RSI"
            onEnabledChange={(enabled) =>
              onSettingsChange({ ...settings, rsi: { ...settings.rsi, enabled } })
            }
          >
            <FormField label="RSI period" htmlFor={rsiPeriodId}>
              <Input
                id={rsiPeriodId}
                numeric
                inputMode="numeric"
                value={rsiDraft}
                invalid={Boolean(rsiError)}
                aria-describedby={rsiError ? rsiErrorId : undefined}
                onChange={(event) => setRsiDraft(event.target.value)}
                onBlur={commitRsiPeriod}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRsiPeriod();
                  }
                }}
              />
              {rsiError ? (
                <p className="mt-1 text-xs text-warning" id={rsiErrorId}>
                  {rsiError}
                </p>
              ) : null}
            </FormField>
          </IndicatorRow>
          <IndicatorRow
            enabled={settings.macd.enabled}
            label="MACD"
            onEnabledChange={(enabled) =>
              onSettingsChange({ ...settings, macd: { ...settings.macd, enabled } })
            }
          >
            <FormField label="MACD fast" htmlFor={macdFastId}>
              <Input
                id={macdFastId}
                numeric
                inputMode="numeric"
                value={macdFastDraft}
                invalid={Boolean(macdError)}
                aria-describedby={macdError ? macdErrorId : undefined}
                onChange={(event) => setMacdFastDraft(event.target.value)}
                onBlur={commitMacdParams}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitMacdParams();
                  }
                }}
              />
            </FormField>
            <FormField label="MACD slow" htmlFor={macdSlowId}>
              <Input
                id={macdSlowId}
                numeric
                inputMode="numeric"
                value={macdSlowDraft}
                invalid={Boolean(macdError)}
                aria-describedby={macdError ? macdErrorId : undefined}
                onChange={(event) => setMacdSlowDraft(event.target.value)}
                onBlur={commitMacdParams}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitMacdParams();
                  }
                }}
              />
            </FormField>
            <FormField label="MACD signal" htmlFor={macdSignalId}>
              <Input
                id={macdSignalId}
                numeric
                inputMode="numeric"
                value={macdSignalDraft}
                invalid={Boolean(macdError)}
                aria-describedby={macdError ? macdErrorId : undefined}
                onChange={(event) => setMacdSignalDraft(event.target.value)}
                onBlur={commitMacdParams}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitMacdParams();
                  }
                }}
              />
            </FormField>
            {macdError ? (
              <p className="text-xs text-warning" id={macdErrorId}>
                {macdError}
              </p>
            ) : null}
          </IndicatorRow>
        </div>
      ) : null}
    </div>
  );
}

function IndicatorRow({
  enabled,
  label,
  onEnabledChange,
  children,
}: {
  enabled: boolean;
  label: string;
  onEnabledChange: (enabled: boolean) => void;
  children: ReactNode;
}) {
  const checkboxId = useId();

  return (
    <fieldset className="mb-3 border-b border-border pb-3 last:mb-0 last:border-b-0 last:pb-0">
      <legend className="sr-only">{label}</legend>
      <label
        className={cn("mb-2 flex min-h-11 cursor-pointer items-center gap-2 text-sm text-foreground")}
        htmlFor={checkboxId}
      >
        <input
          id={checkboxId}
          type="checkbox"
          className="size-4 accent-accent"
          checked={enabled}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />
        {label}
      </label>
      <div className="grid gap-2">{children}</div>
    </fieldset>
  );
}
