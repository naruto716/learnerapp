"use client";

import {
  CaretDownIcon,
  CaretRightIcon,
  FileIcon,
  FilePlusIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { DragEvent, MouseEvent, useEffect, useState } from "react";
import Dialog from "../Dialog";
import IconButton from "../IconButton";
import { filePathWithExtension } from "../documentPaths";
import CreateDocumentDialog, { type CreateDocumentKind } from "./CreateDocumentDialog";

function displayName(node: DocumentNode) {
  return node.type === "file" ? node.name.replace(/\.json$/i, "") : node.name;
}

function joinPath(parentPath: string, childPath: string) {
  const cleanParent = parentPath.replace(/\/+$/g, "");
  const cleanChild = childPath.replace(/^\/+/g, "");
  return cleanParent ? `${cleanParent}/${cleanChild}` : cleanChild;
}

function movedPath(sourcePath: string, targetFolderPath: string) {
  return joinPath(targetFolderPath, sourcePath.split("/").at(-1) ?? sourcePath);
}

function reorderedPath(sourcePath: string, targetPath: string) {
  const targetParent = targetPath.split("/").slice(0, -1).join("/");
  return movedPath(sourcePath, targetParent);
}

type DragTarget =
  | { type: "row"; path: string; position: "before" | "after" }
  | { type: "container"; folderPath: string }
  | null;

type ContextMenuState = {
  node: DocumentNode;
  x: number;
  y: number;
} | null;

export default function SideBar({
  activeDocumentPath,
  documentsVersion,
  isSidebarOpen,
  onDocumentCreated,
  onDocumentDeleted,
  onDocumentMoved,
  onOpenSearch,
  onOpenDocument,
}: {
  activeDocumentPath: string | null;
  documentsVersion: number;
  isSidebarOpen: boolean;
  onDocumentCreated: (documentPath: string) => void;
  onDocumentDeleted: (deletedPath: string, deletedType: DocumentNode["type"]) => void;
  onDocumentMoved: (oldPath: string, newPath: string) => void;
  onOpenSearch: () => void;
  onOpenDocument: (documentPath: string) => void;
}) {
  const [nodes, setNodes] = useState<DocumentNode[]>([]);
  const [error, setError] = useState("");
  const [createKind, setCreateKind] = useState<CreateDocumentKind | null>(null);
  const [createParentPath, setCreateParentPath] = useState("");
  const [draftPath, setDraftPath] = useState("");
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [deleteTarget, setDeleteTarget] = useState<DocumentNode | null>(null);

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

  function openContextMenu(event: MouseEvent, node: DocumentNode) {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ node, x: event.clientX, y: event.clientY });
  }

  function closeDeleteDialog() {
    setDeleteTarget(null);
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
          onDocumentCreated(filePathWithExtension(finalPath));
        }
        closeCreateDialog();
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : `Failed to create ${createKind}.`);
    }
  }

  async function moveEntry(sourcePath: string, targetFolderPath: string) {
    if (!sourcePath || sourcePath === targetFolderPath) {
      setDragTarget(null);
      return;
    }

    try {
      const result = await window.learner?.moveDocumentEntry(sourcePath, targetFolderPath);
      if (!result) return;

      const nextPath = movedPath(sourcePath, targetFolderPath);
      setNodes(result.tree);
      setError("");
      setDragTarget(null);

      onDocumentMoved(sourcePath, nextPath);
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : "Failed to move item.");
    }
  }

  async function reorderEntry(reorderRequest: DocumentReorderRequest) {
    if (!reorderRequest.sourcePath || reorderRequest.sourcePath === reorderRequest.targetPath) {
      setDragTarget(null);
      return;
    }

    try {
      const result = await window.learner?.reorderDocumentEntry(reorderRequest);
      if (!result) return;

      const nextPath = reorderedPath(reorderRequest.sourcePath, reorderRequest.targetPath);
      setNodes(result.tree);
      setError("");
      setDragTarget(null);
      onDocumentMoved(reorderRequest.sourcePath, nextPath);
    } catch (reorderError) {
      setError(reorderError instanceof Error ? reorderError.message : "Failed to reorder item.");
    }
  }

  async function deleteEntry() {
    if (!deleteTarget) return;

    try {
      const result = await window.learner?.deleteDocumentEntry(deleteTarget.path);
      if (!result) return;

      setNodes(result.tree);
      setError("");
      setExpandedFolders((current) => {
        const next = new Set(current);
        for (const path of current) {
          if (path === deleteTarget.path || path.startsWith(`${deleteTarget.path}/`)) {
            next.delete(path);
          }
        }
        return next;
      });
      onDocumentDeleted(deleteTarget.path, deleteTarget.type);
      closeDeleteDialog();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete item.");
    }
  }

  function handleRootDrop(event: DragEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    handleContainerDrop(event, "");
  }

  function handleContainerDrop(event: DragEvent<HTMLElement>, folderPath: string) {
    event.preventDefault();
    event.stopPropagation();
    moveEntry(event.dataTransfer.getData("application/x-learner-path"), folderPath);
  }

  function handleContainerDragOver(event: DragEvent<HTMLElement>, folderPath: string) {
    event.preventDefault();
    event.stopPropagation();
    setDragTarget({ type: "container", folderPath });
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
  }, [documentsVersion]);

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleRootDrop}
      onDragEnd={() => setDragTarget(null)}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragTarget(null);
      }}
      className={`flex h-screen flex-col overflow-hidden border-r border-white/10 bg-white/5 transition-all duration-300 ease-in-out ${
        isSidebarOpen ? "w-64" : "w-0 opacity-0"
      }`}
    >
      <div className="mac-traffic-padding flex h-10 items-center justify-between gap-2 pr-3">
        <p className="text-sm font-medium">Files</p>
        <div className="app-no-drag flex gap-1">
          <IconButton
            ariaLabel="Search notes"
            icon={<MagnifyingGlassIcon size={18} />}
            onClick={onOpenSearch}
          />
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
        <div
          className={`min-h-0 flex-1 transition-colors ${
            dragTarget?.type === "container" && dragTarget.folderPath === "" ? "bg-white/[0.03]" : ""
          }`}
          onDragOver={(event) => handleContainerDragOver(event, "")}
          onDrop={(event) => handleContainerDrop(event, "")}
        >
          <FileTree
            dragTarget={dragTarget}
            expandedFolders={expandedFolders}
            folderPath=""
            nodes={nodes}
            onCreate={openCreateDialog}
            onContainerDragOver={handleContainerDragOver}
            onContextMenu={openContextMenu}
            onDropIntoFolder={handleContainerDrop}
            onRowDragOver={setDragTarget}
            onReorder={reorderEntry}
            onSelectFile={onOpenDocument}
            onToggleFolder={toggleFolder}
            selectedPath={activeDocumentPath}
          />
        </div>
      )}

      <CreateDocumentDialog
        basePath={createParentPath}
        kind={createKind}
        path={draftPath}
        onClose={closeCreateDialog}
        onPathChange={setDraftPath}
        onSubmit={submitCreate}
      />

      <DeleteDocumentDialog
        node={deleteTarget}
        onClose={closeDeleteDialog}
        onDelete={deleteEntry}
      />

      {contextMenu && (
        <>
          <button
            type="button"
            aria-label="Close file menu"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="app-no-drag fixed z-50 min-w-32 rounded-lg bg-[#252525] p-1 text-sm shadow-xl ring-1 ring-white/10"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-red-200 transition-colors hover:bg-red-400/10"
              onClick={() => {
                setDeleteTarget(contextMenu.node);
                setContextMenu(null);
              }}
            >
              <TrashIcon size={15} />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function FileTree({
  dragTarget,
  expandedFolders,
  folderPath,
  nodes,
  onCreate,
  onContainerDragOver,
  onContextMenu,
  onDropIntoFolder,
  onRowDragOver,
  onReorder,
  onSelectFile,
  onToggleFolder,
  selectedPath,
}: {
  dragTarget: DragTarget;
  expandedFolders: Set<string>;
  folderPath: string;
  nodes: DocumentNode[];
  onCreate: (kind: CreateDocumentKind, parentPath?: string) => void;
  onContainerDragOver: (event: DragEvent<HTMLElement>, folderPath: string) => void;
  onContextMenu: (event: MouseEvent, node: DocumentNode) => void;
  onDropIntoFolder: (event: DragEvent<HTMLElement>, folderPath: string) => void;
  onRowDragOver: (target: DragTarget) => void;
  onReorder: (reorderRequest: DocumentReorderRequest) => void;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
  selectedPath: string | null;
}) {
  const isContainerTarget = dragTarget?.type === "container" && dragTarget.folderPath === folderPath;

  return (
    <ul
      onDragOver={(event) => onContainerDragOver(event, folderPath)}
      onDrop={(event) => onDropIntoFolder(event, folderPath)}
      className={`min-h-8 space-y-0.5 px-2 py-1 transition-colors ${
        isContainerTarget ? "rounded-md bg-white/[0.04] ring-1 ring-white/10" : ""
      }`}
    >
      {nodes.length === 0 && <li className="px-1 text-xs text-white/50">No documents yet.</li>}
      {nodes.map((node) => (
        <FileTreeItem
          dragTarget={dragTarget}
          expandedFolders={expandedFolders}
          key={node.path}
          node={node}
          onCreate={onCreate}
          onContainerDragOver={onContainerDragOver}
          onContextMenu={onContextMenu}
          onDropIntoFolder={onDropIntoFolder}
          onRowDragOver={onRowDragOver}
          onReorder={onReorder}
          onSelectFile={onSelectFile}
          onToggleFolder={onToggleFolder}
          selectedPath={selectedPath}
        />
      ))}
    </ul>
  );
}

function FileTreeItem({
  dragTarget,
  expandedFolders,
  node,
  onCreate,
  onContainerDragOver,
  onContextMenu,
  onDropIntoFolder,
  onRowDragOver,
  onReorder,
  onSelectFile,
  onToggleFolder,
  selectedPath,
}: {
  dragTarget: DragTarget;
  expandedFolders: Set<string>;
  node: DocumentNode;
  onCreate: (kind: CreateDocumentKind, parentPath?: string) => void;
  onContainerDragOver: (event: DragEvent<HTMLElement>, folderPath: string) => void;
  onContextMenu: (event: MouseEvent, node: DocumentNode) => void;
  onDropIntoFolder: (event: DragEvent<HTMLElement>, folderPath: string) => void;
  onRowDragOver: (target: DragTarget) => void;
  onReorder: (reorderRequest: DocumentReorderRequest) => void;
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

  function handleDragEnd() {
    onRowDragOver(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const sourcePath = event.dataTransfer.getData("application/x-learner-path");
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;

    onReorder({
      sourcePath,
      targetPath: node.path,
      position: y < rect.height / 2 ? "before" : "after",
    });
  }

  function handleRowDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const y = event.clientY - rect.top;
    onRowDragOver({
      type: "row",
      path: node.path,
      position: y < rect.height / 2 ? "before" : "after",
    });
  }

  const rowDropPosition =
    dragTarget?.type === "row" && dragTarget.path === node.path ? dragTarget.position : null;

  return (
    <li className="relative">
      {rowDropPosition === "before" && (
        <div className="pointer-events-none absolute left-2 right-2 top-0 z-10 h-0.5 rounded-full bg-white/70" />
      )}
      <div
        draggable
        onDragEnd={handleDragEnd}
        onDragStart={handleDragStart}
        onDragOver={handleRowDragOver}
        onDrop={handleDrop}
        onContextMenu={(event) => onContextMenu(event, node)}
        className={`group flex h-8 items-center gap-1 rounded-md px-2 text-sm transition-colors hover:bg-white/10 ${
          selectedPath === node.path ? "bg-white/10 text-white" : ""
        } ${rowDropPosition ? "bg-white/[0.06]" : ""
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
      {rowDropPosition === "after" && (
        <div className="pointer-events-none absolute bottom-0 left-2 right-2 z-10 h-0.5 rounded-full bg-white/70" />
      )}

      {isFolder && isExpanded && node.children && (
        <div
          onDragOver={(event) => onContainerDragOver(event, node.path)}
          onDrop={(event) => onDropIntoFolder(event, node.path)}
          className={`pl-4 transition-colors ${
            dragTarget?.type === "container" && dragTarget.folderPath === node.path
              ? "rounded-md bg-white/[0.04] ring-1 ring-white/10"
              : ""
          }`}
        >
          <FileTree
            dragTarget={dragTarget}
            expandedFolders={expandedFolders}
            folderPath={node.path}
            nodes={node.children}
            onCreate={onCreate}
            onContainerDragOver={onContainerDragOver}
            onContextMenu={onContextMenu}
            onDropIntoFolder={onDropIntoFolder}
            onRowDragOver={onRowDragOver}
            onReorder={onReorder}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
            selectedPath={selectedPath}
          />
        </div>
      )}
    </li>
  );
}

function DeleteDocumentDialog({
  node,
  onClose,
  onDelete,
}: {
  node: DocumentNode | null;
  onClose: () => void;
  onDelete: () => void;
}) {
  if (!node) return null;

  const name = displayName(node);
  const isFolder = node.type === "folder";

  return (
    <Dialog
      open={true}
      title={`Delete ${isFolder ? "folder" : "note"}`}
      onClose={onClose}
      display={
        <div className="space-y-2 text-sm">
          <p>
            Delete <span className="font-medium text-white">{name}</span>?
          </p>
          {isFolder && <p className="text-xs text-white/50">This also deletes every note and folder inside it.</p>}
        </div>
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
            type="button"
            onClick={onDelete}
            className="rounded-md bg-red-300 px-3 py-1.5 text-sm text-black hover:bg-red-200"
          >
            Delete
          </button>
        </>
      }
    />
  );
}
