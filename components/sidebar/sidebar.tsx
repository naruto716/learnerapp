"use client";

import {
  CaretDownIcon,
  CaretRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderPlusIcon,
} from "@phosphor-icons/react";
import { DragEvent, useEffect, useState } from "react";
import { useDocumentSelection } from "../DocumentContext";
import IconButton from "../IconButton";
import CreateDocumentDialog, { type CreateDocumentKind } from "./CreateDocumentDialog";

function displayName(node: DocumentNode) {
  return node.type === "file" ? node.name.replace(/\.json$/i, "") : node.name;
}

function joinPath(parentPath: string, childPath: string) {
  const cleanParent = parentPath.replace(/\/+$/g, "");
  const cleanChild = childPath.replace(/^\/+/g, "");
  return cleanParent ? `${cleanParent}/${cleanChild}` : cleanChild;
}

function filePathWithExtension(filePath: string) {
  return filePath.toLowerCase().endsWith(".json") ? filePath : `${filePath}.json`;
}

function movedPath(sourcePath: string, targetFolderPath: string) {
  return joinPath(targetFolderPath, sourcePath.split("/").at(-1) ?? sourcePath);
}

export default function SideBar({ isSidebarOpen }: { isSidebarOpen: boolean }) {
  const [nodes, setNodes] = useState<DocumentNode[]>([]);
  const [error, setError] = useState("");
  const [createKind, setCreateKind] = useState<CreateDocumentKind | null>(null);
  const [createParentPath, setCreateParentPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const { selectedDocumentPath, setSelectedDocumentPath } = useDocumentSelection();

  function openCreateDialog(kind: CreateDocumentKind, parentPath = "") {
    setCreateKind(kind);
    setCreateParentPath(parentPath);
    setDraftPath("");
    setError("");
  }

  function closeCreateDialog() {
    setCreateKind(null);
    setCreateParentPath("");
    setDraftPath("");
  }

  function toggleFolder(path: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  async function submitCreate(path: string) {
    if (!path || !createKind) return;

    const finalPath = joinPath(createParentPath, path);

    try {
      const result =
        createKind === "folder"
          ? await window.learner?.createDocumentFolder(finalPath)
          : await window.learner?.createDocumentFile(finalPath);

      if (result) {
        setNodes(result.tree);
        setError("");
        if (createKind === "folder") {
          setExpandedFolders((current) => new Set(current).add(finalPath));
        } else {
          setSelectedDocumentPath(filePathWithExtension(finalPath));
        }
        closeCreateDialog();
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `Failed to create ${createKind}.`);
    }
  }

  async function moveEntry(sourcePath: string, targetFolderPath: string) {
    if (!sourcePath || sourcePath === targetFolderPath) return;

    try {
      const result = await window.learner?.moveDocumentEntry(sourcePath, targetFolderPath);
      if (!result) return;

      const nextPath = movedPath(sourcePath, targetFolderPath);
      setNodes(result.tree);
      setError("");

      if (selectedDocumentPath === sourcePath) {
        setSelectedDocumentPath(nextPath);
      } else if (selectedDocumentPath?.startsWith(`${sourcePath}/`)) {
        setSelectedDocumentPath(selectedDocumentPath.replace(sourcePath, nextPath));
      }
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to move item.");
    }
  }

  function handleRootDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    moveEntry(event.dataTransfer.getData("application/x-learner-path"), "");
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
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleRootDrop}
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
        <FileTree
          expandedFolders={expandedFolders}
          nodes={nodes}
          onCreate={openCreateDialog}
          onMove={moveEntry}
          onSelectFile={setSelectedDocumentPath}
          onToggleFolder={toggleFolder}
          selectedPath={selectedDocumentPath}
        />
      )}

      <CreateDocumentDialog
        basePath={createParentPath}
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
  expandedFolders,
  nodes,
  onCreate,
  onMove,
  onSelectFile,
  onToggleFolder,
  selectedPath,
}: {
  expandedFolders: Set<string>;
  nodes: DocumentNode[];
  onCreate: (kind: CreateDocumentKind, parentPath?: string) => void;
  onMove: (sourcePath: string, targetFolderPath: string) => void;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  selectedPath: string | null;
}) {
  if (nodes.length === 0) {
    return <p className="px-3 text-xs text-white/50">No documents yet.</p>;
  }

  return (
    <ul className="space-y-1 px-2">
      {nodes.map((node) => (
        <FileTreeItem
          expandedFolders={expandedFolders}
          key={node.path}
          node={node}
          onCreate={onCreate}
          onMove={onMove}
          onSelectFile={onSelectFile}
          onToggleFolder={onToggleFolder}
          selectedPath={selectedPath}
        />
      ))}
    </ul>
  );
}

function FileTreeItem({
  expandedFolders,
  node,
  onCreate,
  onMove,
  onSelectFile,
  onToggleFolder,
  selectedPath,
}: {
  expandedFolders: Set<string>;
  node: DocumentNode;
  onCreate: (kind: CreateDocumentKind, parentPath?: string) => void;
  onMove: (sourcePath: string, targetFolderPath: string) => void;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  selectedPath: string | null;
}) {
  const isFolder = node.type === "folder";
  const isExpanded = expandedFolders.has(node.path);

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-learner-path", node.path);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    if (!isFolder) return;
    event.preventDefault();
    event.stopPropagation();
    onMove(event.dataTransfer.getData("application/x-learner-path"), node.path);
  }

  return (
    <li>
      <div
        draggable
        onDragStart={handleDragStart}
        onDragOver={(event) => {
          if (isFolder) event.preventDefault();
        }}
        onDrop={handleDrop}
        className={`group flex h-8 items-center gap-1 rounded-md px-2 text-sm hover:bg-white/10 ${
          selectedPath === node.path ? "bg-white/10 text-white" : ""
        }`}
      >
        {isFolder ? (
          <button
            type="button"
            aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
            onClick={() => onToggleFolder(node.path)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-white/10"
          >
            {isExpanded ? <CaretDownIcon size={14} /> : <CaretRightIcon size={14} />}
          </button>
        ) : (
          <FileIcon size={16} className="h-5 w-5 shrink-0" />
        )}

        <button
          type="button"
          onClick={() => {
            if (isFolder) {
              onToggleFolder(node.path);
            } else {
              onSelectFile(node.path);
            }
          }}
          className="min-w-0 flex-1 truncate text-left"
        >
          {displayName(node)}
        </button>

        {isFolder && (
          <div className="hidden shrink-0 gap-1 group-hover:flex">
            <IconButton
              ariaLabel={`New folder in ${node.name}`}
              className="h-5 w-5"
              icon={<FolderPlusIcon size={14} />}
              onClick={() => onCreate("folder", node.path)}
            />
            <IconButton
              ariaLabel={`New document in ${node.name}`}
              className="h-5 w-5"
              icon={<FilePlusIcon size={14} />}
              onClick={() => onCreate("file", node.path)}
            />
          </div>
        )}
      </div>

      {isFolder && isExpanded && node.children && (
        <div className="pl-4">
          <FileTree
            expandedFolders={expandedFolders}
            nodes={node.children}
            onCreate={onCreate}
            onMove={onMove}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            selectedPath={selectedPath}
          />
        </div>
      )}
    </li>
  );
}
