"use client";

import type { FormEvent } from "react";
import Dialog from "../Dialog";

export type CreateDocumentKind = "folder" | "file";

export default function CreateDocumentDialog({
  basePath = "",
  kind,
  onClose,
  onPathChange,
  onSubmit,
  path,
}: {
  basePath?: string;
  kind: CreateDocumentKind | null;
  onClose: () => void;
  onPathChange: (path: string) => void;
  onSubmit: (path: string) => void;
  path: string;
}) {
  if (!kind) return null;

  const formId = "create-document-form";
  const title = kind === "folder" ? "New folder" : "New document";
  const label = basePath ? "Name" : "Path";

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
            {label}
          </label>
          {basePath && <p className="mb-2 truncate text-xs text-white/40">Inside {basePath}</p>}
          <input
            id="create-path"
            autoFocus
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
            placeholder={kind === "folder" ? "Course 1" : "intro"}
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
