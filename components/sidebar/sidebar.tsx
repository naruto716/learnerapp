"use client";

import { FilePlusIcon, FolderPlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import IconButton from "../IconButton";
import CreateMarkdownDialog, { type CreateMarkdownKind } from "./CreateMarkdownDialog";

export default function SideBar({ isSidebarOpen }: { isSidebarOpen: boolean }) {
  const [nodes, setNodes] = useState<MarkdownNode[]>([]);
  const [error, setError] = useState("");
  const [createKind, setCreateKind] = useState<CreateMarkdownKind | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const isMac =
    typeof window !== "undefined" &&
    (window.learner?.platform === "darwin" || navigator.platform.toLowerCase().includes("mac"));

  function openCreateDialog(kind: CreateMarkdownKind) {
    setCreateKind(kind);
    setDraftPath("");
    setError("");
  }

  function closeCreateDialog() {
    setCreateKind(null);
    setDraftPath("");
  }

  async function submitCreate(path: string) {
    if (!path || !createKind) return;

    try {
      const result =
        createKind === "folder"
          ? await window.learner?.createMarkdownFolder(path)
          : await window.learner?.createMarkdownFile(path);

      if (result) {
        setNodes(result.tree);
        setError("");
        closeCreateDialog();
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `Failed to create ${createKind}.`);
    }
  }

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        if (!window.learner) {
          if (!ignore) setError("Markdown files are available in Electron.");
          return;
        }

        const result = await window.learner.listMarkdownFiles();
        if (!ignore) {
          setNodes(result.tree);
          setError("");
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load markdown files.");
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, []);

  return (
    <div
      className={`border-r border-white/10 h-screen overflow-hidden bg-white/5 transition-all duration-300 ease-in-out ${
        isSidebarOpen ? "w-64" : "w-0 opacity-0"
      }`}
    >
      <div className={`flex h-10 items-center justify-between gap-2 pr-3 ${isMac ? "pl-[96px]" : "pl-3"}`}>
        <p className="text-sm font-medium">Files</p>
        <div className="app-no-drag flex gap-1">
          <IconButton
            ariaLabel="New folder"
            icon={<FolderPlusIcon size={18} />}
            onClick={() => openCreateDialog("folder")}
          />
          <IconButton
            ariaLabel="New markdown file"
            icon={<FilePlusIcon size={18} />}
            onClick={() => openCreateDialog("file")}
          />
        </div>
      </div>

      {error ? (
        <p className="px-3 text-xs text-red-300">{error}</p>
      ) : (
        <FileTree nodes={nodes} />
      )}

      <CreateMarkdownDialog
        kind={createKind}
        path={draftPath}
        onClose={closeCreateDialog}
        onPathChange={setDraftPath}
        onSubmit={submitCreate}
      />
    </div>
  );
}

function FileTree({ nodes }: { nodes: MarkdownNode[] }) {
  if (nodes.length === 0) {
    return <p className="px-3 text-xs text-white/50">No markdown files yet.</p>;
  }

  return (
    <ul className="space-y-1 px-2">
      {nodes.map((node) => (
        <li key={node.path}>
          <button
            type="button"
            className="block w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-white/10"
          >
            {node.type === "folder" ? node.name : node.name}
          </button>

          {node.type === "folder" && node.children && (
            <div className="pl-4">
              <FileTree nodes={node.children} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
