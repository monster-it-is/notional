export const APP_NAV = [
  { to: "/trade", label: "Trade" },
  { to: "/history", label: "History" },
  { to: "/account", label: "Account" },
] as const;

export const APP_MAIN_CLASS =
  "min-h-0 w-full flex-1 overflow-auto px-3 py-3 pb-[calc(3rem+env(safe-area-inset-bottom))] md:pb-3 xl:px-4 xl:pb-4";
