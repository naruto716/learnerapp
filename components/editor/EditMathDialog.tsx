"use client";

import type { FormEvent } from "react";
import Dialog from "../Dialog";

export type EditableMath = {
  kind: "inline" | "block";
  latex: string;
  pos: number;
};

export default function EditMathDialog({
  math,
  onClose,
  onLatexChange,
  onSubmit,
}: {
  math: EditableMath | null;
  onClose: () => void;
  onLatexChange: (latex: string) => void;
  onSubmit: () => void;
}) {
  if (!math) return null;

  const formId = "edit-math-form";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <Dialog
      open={true}
      title={math.kind === "inline" ? "Edit inline math" : "Edit math block"}
      onClose={onClose}
      display={
        <form id={formId} onSubmit={handleSubmit}>
          <label className="mb-2 block text-xs text-white/60" htmlFor="edit-latex">
            LaTeX
          </label>
          <textarea
            id="edit-latex"
            autoFocus
            value={math.latex}
            onChange={(event) => onLatexChange(event.target.value)}
            rows={math.kind === "inline" ? 2 : 5}
            className="w-full resize-none rounded-md border border-white/10 bg-black/20 px-3 py-2 font-mono text-sm outline-none focus:border-white/30"
          />
        </form>
      }
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-white/10"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="rounded-md bg-white px-3 py-1.5 text-sm text-black hover:bg-white/90"
          >
            Save
          </button>
        </>
      }
    />
  );
}
