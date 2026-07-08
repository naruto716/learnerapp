"use client";

import type { ChangeEventHandler, ReactNode } from "react";

export const graphInputClassName =
  "w-full rounded-lg bg-white/[0.065] px-3 py-2 text-sm leading-5 text-white/86 outline-none ring-1 ring-white/[0.08] transition placeholder:text-white/28 focus:bg-white/[0.085] focus:ring-white/[0.24]";

export function GraphFieldShell({
  children,
  help,
  label,
}: {
  children: ReactNode;
  help?: string;
  label: string;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-white/42">{label}</span>
      {children}
      {help && <span className="block text-xs leading-5 text-white/38">{help}</span>}
    </label>
  );
}

export function GraphTextField({
  help,
  label,
  onChange,
  placeholder,
  value,
}: {
  help?: string;
  label: string;
  onChange: ChangeEventHandler<HTMLInputElement>;
  placeholder?: string;
  value: string;
}) {
  return (
    <GraphFieldShell help={help} label={label}>
      <input className={graphInputClassName} onChange={onChange} placeholder={placeholder} value={value} />
    </GraphFieldShell>
  );
}

export function GraphTextArea({
  help,
  label,
  minRows = 3,
  onChange,
  placeholder,
  value,
}: {
  help?: string;
  label: string;
  minRows?: number;
  onChange: ChangeEventHandler<HTMLTextAreaElement>;
  placeholder?: string;
  value: string;
}) {
  return (
    <GraphFieldShell help={help} label={label}>
      <textarea
        className={`${graphInputClassName} resize-none`}
        onChange={onChange}
        placeholder={placeholder}
        rows={minRows}
        value={value}
      />
    </GraphFieldShell>
  );
}
