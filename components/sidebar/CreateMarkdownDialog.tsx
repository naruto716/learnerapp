"use client";

import type { FormEvent } from "react";
import Dialog from "../Dialog";

export type CreateMarkdownKind = "folder" | "file";

export default function CreateMarkdownDialog({
  kind,
  onClose,
  onPathChange,
  onSubmit,
  path,
}: {
  kind: CreateMarkdownKind | null;
  onClose: () => void;
  onPathChange: (path: string) => void;
  onSubmit: (path: string) => void;
  path: string;
}) {
  if (!kind) return null;

  const formId = "create-markdown-form";
  const title = kind === "folder" ? "New folder" : "New markdown file";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit(path.trim());
  }

  return (
    <Dialog
      open={true}
      title={title}
      onClose={onClose}
      display={
        <form id={formId} onSubmit={handleSubmit}>
          <label className="mb-2 block text-xs text-white/60" htmlFor="create-path">
            Name
          </label>
          <input
            id="create-path"
            autoFocus
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
            placeholder={kind === "folder" ? "Course 1" : "Course 1/intro.md"}
            className="w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-white/30"
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
            Create
          </button>
        </>
      }
    />
  );
}
