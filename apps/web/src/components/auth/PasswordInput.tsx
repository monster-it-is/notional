import { useState, type InputHTMLAttributes } from "react";

import { Input } from "../ui/Input.tsx";

export function PasswordInput({
  className,
  disabled,
  id,
  invalid = false,
  style,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const label = visible ? "Hide password" : "Show password";

  return (
    <div className="relative">
      <Input
        {...props}
        className={className}
        disabled={disabled}
        id={id}
        invalid={invalid}
        style={{ ...style, paddingRight: "3rem" }}
        type={visible ? "text" : "password"}
      />
      <button
        aria-controls={id}
        aria-label={label}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:text-muted"
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        onMouseDown={(event) => event.preventDefault()}
        type="button"
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
      <path
        d="M1.5 8s2.1-4.25 6.5-4.25S14.5 8 14.5 8s-2.1 4.25-6.5 4.25S1.5 8 1.5 8Z"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <circle cx="8" cy="8" r="1.75" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 16 16">
      <path d="M2.25 2.25 13.75 13.75" stroke="currentColor" strokeLinecap="square" strokeWidth="1.25" />
      <path
        d="M6.55 4.05A7.2 7.2 0 0 1 8 3.75c4.4 0 6.5 4.25 6.5 4.25a12.4 12.4 0 0 1-2.05 2.55M3.55 5.6A12.8 12.8 0 0 0 1.5 8S3.6 12.25 8 12.25c.72 0 1.4-.16 2.02-.42"
        stroke="currentColor"
        strokeWidth="1.25"
      />
      <path d="M6.7 6.85a1.75 1.75 0 0 0 2.45 2.45" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  );
}
