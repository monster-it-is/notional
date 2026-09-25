import type { ReactNode } from "react";

export function FormField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  if (htmlFor) {
    return (
      <div className="text-sm">
        <label className="mb-1 block text-secondary" htmlFor={htmlFor}>
          {label}
        </label>
        {children}
      </div>
    );
  }

  return (
    <label className="block text-sm">
      <span className="mb-1 block text-secondary">{label}</span>
      {children}
    </label>
  );
}
