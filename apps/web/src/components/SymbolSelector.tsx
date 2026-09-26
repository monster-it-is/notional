import type { InstrumentResponse } from "@notional/contracts";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "../lib/cn.ts";
import { filterInstruments } from "../lib/filter-instruments.ts";
import { FormField } from "./ui/FormField.tsx";
import { Input } from "./ui/Input.tsx";

export function SymbolSelector({
  instruments,
  value,
  onChange,
  disabled = false,
}: {
  instruments: InstrumentResponse[];
  value: string | null;
  onChange: (symbol: string) => void;
  disabled?: boolean;
}) {
  const reactId = useId();
  const inputId = `${reactId}-instrument`;
  const listboxId = `${reactId}-listbox`;
  const rootRef = useRef<HTMLDivElement>(null);
  const optionPointerRef = useRef(false);
  const skipFocusOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);

  const filtered = useMemo(
    () => filterInstruments(instruments, open ? searchQuery : ""),
    [instruments, open, searchQuery],
  );
  const activeIndex = indexForPreferred(filtered, activeSymbol);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      closeWithoutCommit();
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) {
      return;
    }

    const option = document.getElementById(optionId(listboxId, activeIndex));
    option?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, listboxId]);

  const committed = value ?? "";
  const displayValue = open ? searchQuery : committed;
  const emptyCatalog = instruments.length === 0;
  const activeOptionId =
    open && activeIndex >= 0 ? optionId(listboxId, activeIndex) : undefined;

  function focusInput(): void {
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.focus();
    }
  }

  function openPicker(): void {
    if (disabled || open || skipFocusOpenRef.current) {
      return;
    }

    setSearchQuery("");
    setActiveSymbol(value);
    setOpen(true);
  }

  function closeWithoutCommit(): void {
    setOpen(false);
    setSearchQuery("");
    setActiveSymbol(null);
  }

  function commit(instrument: InstrumentResponse): void {
    optionPointerRef.current = false;
    onChange(instrument.symbol);
    setOpen(false);
    setSearchQuery("");
    setActiveSymbol(null);
    skipFocusOpenRef.current = true;
    focusInput();
    skipFocusOpenRef.current = false;
  }

  function armOptionPointer(): void {
    if (optionPointerRef.current) {
      return;
    }

    optionPointerRef.current = true;

    function release(): void {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      queueMicrotask(() => {
        optionPointerRef.current = false;
      });
    }

    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
  }

  function moveActive(delta: number): void {
    const nextIndex = clampIndex(activeIndex + delta, filtered.length);
    setActiveSymbol(filtered[nextIndex]?.symbol ?? null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (disabled) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        openPicker();
        return;
      }
      moveActive(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openPicker();
        return;
      }
      moveActive(-1);
      return;
    }

    if (event.key === "Enter") {
      if (!open) {
        return;
      }

      const active = activeIndex >= 0 ? filtered[activeIndex] : undefined;
      if (!active) {
        return;
      }

      event.preventDefault();
      commit(active);
      return;
    }

    if (event.key === "Escape" && open) {
      event.preventDefault();
      closeWithoutCommit();
      return;
    }

    if (
      !open &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      event.key.length === 1
    ) {
      event.preventDefault();
      setSearchQuery(event.key);
      setActiveSymbol(value);
      setOpen(true);
    }
  }

  return (
    <FormField htmlFor={inputId} label="Instrument">
      <div className="relative" ref={rootRef}>
        <Input
          id={inputId}
          role="combobox"
          aria-label="Instrument"
          aria-autocomplete="list"
          aria-controls={open ? listboxId : undefined}
          aria-expanded={open}
          aria-activedescendant={activeOptionId}
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => {
            if (!open) {
              return;
            }

            setSearchQuery(event.target.value);
          }}
          onBlur={(event) => {
            if (optionPointerRef.current) {
              return;
            }

            const next = event.relatedTarget;
            if (next instanceof Node && rootRef.current?.contains(next)) {
              return;
            }

            closeWithoutCommit();
          }}
          onClick={() => {
            openPicker();
          }}
          onFocus={() => {
            openPicker();
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          value={displayValue}
        />
        {emptyCatalog ? <p className="mt-1 text-sm text-secondary">No instruments</p> : null}
        {open && !disabled ? (
          <div className="absolute inset-x-0 z-40 mt-1 border border-border bg-surface">
            <p className="border-b border-border px-3 py-1.5 text-xs text-secondary">
              USDT perpetual
            </p>
            <div className="max-h-[50vh] overflow-y-auto" id={listboxId} role="listbox">
              {filtered.length === 0 ? (
                <p className="px-3 py-2 text-sm text-secondary">No matching instruments</p>
              ) : (
                filtered.map((instrument, index) => {
                  const selected = instrument.symbol === value;
                  const active = index === activeIndex;

                  return (
                    <div
                      aria-selected={selected}
                      className={cn(
                        "cursor-pointer px-3 py-2",
                        active && "bg-surface-subtle",
                        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      )}
                      id={optionId(listboxId, index)}
                      key={instrument.id}
                      onClick={() => {
                        commit(instrument);
                      }}
                      onPointerDown={(event) => {
                        if (event.button !== 0) {
                          return;
                        }

                        armOptionPointer();
                      }}
                      role="option"
                    >
                      <p className="font-numeric text-sm text-foreground">{instrument.symbol}</p>
                      <p className="text-xs text-secondary">
                        {instrument.baseAsset} / {instrument.quoteAsset}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
    </FormField>
  );
}

function optionId(listboxId: string, index: number): string {
  return `${listboxId}-option-${index}`;
}

function indexForPreferred(
  options: readonly InstrumentResponse[],
  preferred: string | null | undefined,
): number {
  if (options.length === 0) {
    return -1;
  }

  if (preferred) {
    const index = options.findIndex((row) => row.symbol === preferred);
    if (index >= 0) {
      return index;
    }
  }

  return 0;
}

function clampIndex(index: number, length: number): number {
  if (length === 0) {
    return -1;
  }

  if (index < 0) {
    return 0;
  }

  if (index >= length) {
    return length - 1;
  }

  return index;
}
