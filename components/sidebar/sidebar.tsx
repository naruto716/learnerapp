"use client";

import { FilePlusIcon, FolderPlusIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useDocumentSelection } from "../DocumentContext";
import IconButton from "../IconButton";
import CreateDocumentDialog, { type CreateDocumentKind } from "./CreateDocumentDialog";

export default function SideBar({ isSidebarOpen }: { isSidebarOpen: boolean }) {
  const [nodes, setNodes] = useState<DocumentNode[]>([]);
  const [error, setError] = useState("");
  const [createKind, setCreateKind] = useState<CreateDocumentKind | null>(null);
  const [draftPath, setDraftPath] = useState("");
  const { selectedDocumentPath, setSelectedDocumentPath } = useDocumentSelection();

  function openCreateDialog(kind: CreateDocumentKind) {
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
          ? await window.learner?.createDocumentFolder(path)
          : await window.learner?.createDocumentFile(path);

      if (result) {
        setNodes(result.tree);
        setError("");
        if (createKind === "file") {
          setSelectedDocumentPath(path.toLowerCase().endsWith(".json") ? path : `${path}.json`);
        }
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
          if (!ignore) setError("Documents are available in Electron.");
          return;
        }

        const result = await window.learner.listDocuments();
        if (!ignore) {
          setNodes(result.tree);
          setError("");
        }
      } catch (loadError) {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load documents.");
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
      <div className="mac-traffic-padding flex h-10 items-center justify-between gap-2 pr-3">
        <p className="text-sm font-medium">Files</p>
        <div className="app-no-drag flex gap-1">
          <IconButton
            ariaLabel="New folder"
            icon={<FolderPlusIcon size={18} />}
            onClick={() => openCreateDialog("folder")}
          />
          <IconButton
            ariaLabel="New document"
            icon={<FilePlusIcon size={18} />}
            onClick={() => openCreateDialog("file")}
          />
        </div>
      </div>

      {error ? (
        <p className="px-3 text-xs text-red-300">{error}</p>
      ) : (
        <FileTree nodes={nodes} onSelectFile={setSelectedDocumentPath} selectedPath={selectedDocumentPath} />
      )}

      <CreateDocumentDialog
        kind={createKind}
        path={draftPath}
        onClose={closeCreateDialog}
        onPathChange={setDraftPath}
        onSubmit={submitCreate}
      />
    </div>
  );
}

function FileTree({
  nodes,
  onSelectFile,
  selectedPath,
}: {
  nodes: DocumentNode[];
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}) {
  if (nodes.length === 0) {
    return <p className="px-3 text-xs text-white/50">No documents yet.</p>;
  }

  return (
    <ul className="space-y-1 px-2">
      {nodes.map((node) => (
        <li key={node.path}>
          <button
            type="button"
            onClick={() => {
              if (node.type === "file") onSelectFile(node.path);
            }}
            className={`block w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-white/10 ${
              selectedPath === node.path ? "bg-white/10 text-white" : ""
            }`}
          >
            {node.type === "folder" ? node.name : node.name}
          </button>

          {node.type === "folder" && node.children && (
            <div className="pl-4">
              <FileTree nodes={node.children} onSelectFile={onSelectFile} selectedPath={selectedPath} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
