type Tab<T extends string> = {
  id: T;
  label: string;
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
    <div role="tablist" className="flex flex-wrap gap-2 border-b border-app-border pb-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={`rounded-md px-3 py-1.5 text-sm ${
            tab.id === value
              ? "bg-app-accent-bg text-app-heading"
              : "text-app-text hover:bg-app-accent-bg"
          }`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
