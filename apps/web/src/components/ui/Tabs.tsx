import { cn } from "../../lib/cn.ts";

type Tab<T extends string> = {
  id: T;
  label: string;
  disabled?: boolean;
};

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: Tab<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex flex-wrap gap-2 border-b border-border pb-2">
      {tabs.map((tab) => {
        const selected = tab.id === value;
        const disabled = tab.disabled === true;

        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            className={cn(
              "rounded-md px-3 py-2 text-sm min-h-11 lg:min-h-9",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              "disabled:pointer-events-none disabled:text-muted disabled:opacity-70",
              selected
                ? "bg-accent-soft font-medium text-foreground"
                : "text-secondary hover:bg-surface-subtle hover:text-foreground",
            )}
            onClick={() => {
              if (disabled) {
                return;
              }

              onChange(tab.id);
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
