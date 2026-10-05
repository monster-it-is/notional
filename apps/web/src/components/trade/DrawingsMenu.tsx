import { useEffect, useId, useRef, useState } from "react";

import { Button } from "../ui/Button.tsx";
import { drawingToolLabel, type DrawingTool } from "../../lib/chart/drawings/types.ts";

const TOOLS: DrawingTool[] = ["select", "trend-line", "horizontal-line"];

export function DrawingsMenu({
  tool,
  onToolChange,
}: {
  tool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const triggerId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerLabel = tool === "select" ? "Drawings" : `Drawings, ${drawingToolLabel(tool)}`;

  useEffect(() => {
    if (!open) {
      return;
    }

    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }

      setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <Button
        type="button"
        size="sm"
        variant={tool === "select" ? "secondary" : "primary"}
        aria-expanded={open}
        aria-controls={popoverId}
        aria-label={triggerLabel}
        id={triggerId}
        onClick={() => setOpen((value) => !value)}
      >
        Drawings
      </Button>
      {open ? (
        <div
          className="absolute right-0 z-40 mt-1 flex w-[min(14rem,calc(100vw-2rem))] flex-col gap-1 border border-border bg-surface p-1"
          id={popoverId}
        >
          {TOOLS.map((value) => {
            const selected = value === tool;
            const label = drawingToolLabel(value);

            return (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={selected ? "primary" : "secondary"}
                aria-pressed={selected}
                aria-label={label}
                className="w-full justify-start"
                onClick={() => {
                  onToolChange(value);
                  setOpen(false);
                }}
              >
                {label}
              </Button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
