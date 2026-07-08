"use client";

import { GraphIcon } from "@phosphor-icons/react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FloatingIconButton from "@/components/FloatingIconButton";
import SideBar from "@/components/sidebar/sidebar";
import DocumentSearchDialog from "@/components/sidebar/DocumentSearchDialog";
import TopBar from "@/components/topbar/topbar";
import TiptapEditor, {
  type CurrentDocumentAgentTools,
  type PersistedEditorState,
} from "@/components/editor/TiptapEditor";
import { documentPathToRoute, routeToDocumentPath } from "@/components/documentPaths";
import KnowledgeGraphPanel from "@/components/graph/KnowledgeGraphPanel";
import ChatBubble from "./ai/ChatBubble";
import ChatPanel from "./ai/ChatPanel";

const workspaceStorageKey = "learner.workspace.v1";

type WorkspaceState = {
  openTabs: string[];
  lastActivePath: string | null;
  editorStates: Record<string, PersistedEditorState>;
};

function readWorkspaceState(): WorkspaceState {
  if (typeof window === "undefined") {
    return { openTabs: [], lastActivePath: null, editorStates: {} };
  }

  try {
    const stored = localStorage.getItem(workspaceStorageKey);
    if (!stored) {
      return { openTabs: [], lastActivePath: null, editorStates: {} };
    }

    const parsed = JSON.parse(stored) as Partial<WorkspaceState>;
    return {
      openTabs: Array.isArray(parsed.openTabs) ? parsed.openTabs : [],
      lastActivePath: parsed.lastActivePath ?? null,
      editorStates: parsed.editorStates ?? {},
    };
  } catch {
    return { openTabs: [], lastActivePath: null, editorStates: {} };
  }
}

function replacePath(paths: string[], oldPath: string, newPath: string) {
  return paths.map((path) => {
    if (path === oldPath) return newPath;
    if (path.startsWith(`${oldPath}/`)) return path.replace(oldPath, newPath);
    return path;
  });
}

function isDeletedDocumentPath(documentPath: string, deletedPath: string, deletedType: DocumentNode["type"]) {
  return deletedType === "folder" ? documentPath.startsWith(`${deletedPath}/`) : documentPath === deletedPath;
}

function reorderList(items: string[], source: string, target: string, position: "before" | "after") {
  if (source === target) return items;

  const next = items.filter((item) => item !== source);
  const targetIndex = next.indexOf(target);

  if (targetIndex === -1) {
    return items;
  }

  next.splice(position === "before" ? targetIndex : targetIndex + 1, 0, source);
  return next;
}

export default function AppShell() {
  const router = useRouter();
  const pathname = usePathname();
  const activeDocumentPath = useMemo(() => routeToDocumentPath(pathname), [pathname]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [isDocumentSearchOpen, setIsDocumentSearchOpen] = useState(false);
  const [isBubbleOpen, setIsBubbleOpen] = useState(false);
  const [isKnowledgeGraphOpen, setIsKnowledgeGraphOpen] = useState(false);
  const [isKnowledgeGraphLoading, setIsKnowledgeGraphLoading] = useState(false);
  const [isKnowledgeGraphDeleting, setIsKnowledgeGraphDeleting] = useState(false);
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeDocumentGraph | null>(null);
  const [knowledgeGraphError, setKnowledgeGraphError] = useState<string | null>(null);
  const [lastKnowledgeGraphExtractionChanged, setLastKnowledgeGraphExtractionChanged] = useState<boolean | null>(null);
  const [editorStates, setEditorStates] = useState<Record<string, PersistedEditorState>>({});
  const [documentsVersion, setDocumentsVersion] = useState(0);
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
  const restoredWorkspaceRef = useRef(false);
  const editorAgentToolsRef = useRef<Record<string, CurrentDocumentAgentTools>>({});

  useEffect(() => {
    const root = document.documentElement;
    const platform = window.learner?.platform ?? navigator.platform.toLowerCase();
    root.dataset.platform = platform === "darwin" || platform.includes("mac") ? "darwin" : platform;

    let isMounted = true;
    const setFullScreenAttribute = (isFullScreen: boolean) => {
      root.dataset.fullscreen = isFullScreen ? "true" : "false";
    };

    setFullScreenAttribute(false);
    window.learner?.isFullScreen?.().then((isFullScreen) => {
      if (isMounted) setFullScreenAttribute(isFullScreen);
    });
    const removeFullScreenListener = window.learner?.onFullScreenChange?.(setFullScreenAttribute);

    return () => {
      isMounted = false;
      removeFullScreenListener?.();
    };
  }, []);

  useEffect(() => {
    if (restoredWorkspaceRef.current) return;
    restoredWorkspaceRef.current = true;

    const workspace = readWorkspaceState();
    const timer = window.setTimeout(() => {
      setOpenTabs(workspace.openTabs);
      setEditorStates(workspace.editorStates);
      setWorkspaceLoaded(true);

      if (pathname === "/" && workspace.lastActivePath) {
        router.replace(documentPathToRoute(workspace.lastActivePath));
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, [pathname, router]);

  useEffect(() => {
    if (!workspaceLoaded) return;

    const previousWorkspace = readWorkspaceState();

    localStorage.setItem(
      workspaceStorageKey,
      JSON.stringify({
        openTabs,
        lastActivePath: activeDocumentPath ?? previousWorkspace.lastActivePath,
        editorStates,
      }),
    );
  }, [activeDocumentPath, editorStates, openTabs, workspaceLoaded]);

  useEffect(() => {
    if (!activeDocumentPath) return;

    const timer = window.setTimeout(() => {
      setOpenTabs((current) => {
        if (current.includes(activeDocumentPath)) return current;
        return [...current, activeDocumentPath];
      });
    }, 0);

    return () => window.clearTimeout(timer);
  }, [activeDocumentPath]);

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setIsDocumentSearchOpen(true);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function openDocument(documentPath: string) {
    setOpenTabs((current) => (current.includes(documentPath) ? current : [...current, documentPath]));
    router.push(documentPathToRoute(documentPath));
  }

  function markDocumentsChanged() {
    setDocumentsVersion((version) => version + 1);
  }

  function handleDocumentMoved(oldPath: string, newPath: string) {
    setOpenTabs((current) => replacePath(current, oldPath, newPath));
    setEditorStates((current) => {
      const next = { ...current };
      for (const [path, state] of Object.entries(current)) {
        if (path === oldPath || path.startsWith(`${oldPath}/`)) {
          delete next[path];
          next[path.replace(oldPath, newPath)] = state;
        }
      }
      return next;
    });

    if (activeDocumentPath === oldPath || activeDocumentPath?.startsWith(`${oldPath}/`)) {
      router.replace(documentPathToRoute(activeDocumentPath.replace(oldPath, newPath)));
    }

    markDocumentsChanged();
  }

  function handleDocumentDeleted(deletedPath: string, deletedType: DocumentNode["type"]) {
    setOpenTabs((current) => {
      const activeIndex = activeDocumentPath ? current.indexOf(activeDocumentPath) : -1;
      const nextTabs = current.filter((path) => !isDeletedDocumentPath(path, deletedPath, deletedType));

      if (activeDocumentPath && isDeletedDocumentPath(activeDocumentPath, deletedPath, deletedType)) {
        const nextActivePath = nextTabs[activeIndex] ?? nextTabs[activeIndex - 1] ?? nextTabs[0] ?? null;
        router.push(nextActivePath ? documentPathToRoute(nextActivePath) : "/");
      }

      return nextTabs;
    });

    setEditorStates((current) => {
      const next = { ...current };
      for (const path of Object.keys(current)) {
        if (isDeletedDocumentPath(path, deletedPath, deletedType)) {
          delete next[path];
        }
      }
      return next;
    });

    for (const path of Object.keys(editorAgentToolsRef.current)) {
      if (isDeletedDocumentPath(path, deletedPath, deletedType)) {
        delete editorAgentToolsRef.current[path];
      }
    }

    markDocumentsChanged();
  }

  function handleDocumentRenamed(oldPath: string, newPath: string) {
    setOpenTabs((current) => current.map((path) => (path === oldPath ? newPath : path)));
    setEditorStates((current) => {
      const next = { ...current };
      if (next[oldPath]) {
        next[newPath] = next[oldPath];
        delete next[oldPath];
      }
      return next;
    });
    router.replace(documentPathToRoute(newPath));
    markDocumentsChanged();
  }

  function updateEditorState(documentPath: string, state: PersistedEditorState) {
    setEditorStates((current) => ({
      ...current,
      [documentPath]: state,
    }));
  }

  function closeTab(documentPath: string) {
    setOpenTabs((current) => {
      const tabIndex = current.indexOf(documentPath);
      const nextTabs = current.filter((path) => path !== documentPath);

      if (documentPath === activeDocumentPath) {
        const nextActivePath = nextTabs[tabIndex] ?? nextTabs[tabIndex - 1] ?? null;
        router.push(nextActivePath ? documentPathToRoute(nextActivePath) : "/");
      }

      return nextTabs;
    });
  }

  const updateEditorAgentTools = useCallback((documentPath: string, tools: CurrentDocumentAgentTools | null) => {
    if (tools) {
      editorAgentToolsRef.current[documentPath] = tools;
    } else {
      delete editorAgentToolsRef.current[documentPath];
    }
  }, []);

  const getCurrentDocumentTools = useCallback(() => {
    if (!activeDocumentPath) return null;
    return editorAgentToolsRef.current[activeDocumentPath] ?? null;
  }, [activeDocumentPath]);

  const getCurrentDocumentMarkdown = useCallback(() => {
    return getCurrentDocumentTools()?.read().markdown ?? null;
  }, [getCurrentDocumentTools]);

  const openKnowledgeGraph = useCallback(async () => {
    setIsKnowledgeGraphOpen(true);
    setKnowledgeGraphError(null);
    setLastKnowledgeGraphExtractionChanged(null);

    if (!activeDocumentPath) {
      setKnowledgeGraph(null);
      setKnowledgeGraphError("Open a document before viewing its graph.");
      return;
    }

    const tools = getCurrentDocumentTools();
    if (!tools) {
      setKnowledgeGraph(null);
      setKnowledgeGraphError("The active editor is not ready yet.");
      return;
    }

    const documentSnapshot = tools.read();
    if (!documentSnapshot.markdown.trim()) {
      setKnowledgeGraph(null);
      setKnowledgeGraphError("This document is empty, so there is nothing to extract yet.");
      return;
    }

    setKnowledgeGraph((current) => (current?.documentPath === documentSnapshot.path ? current : null));
    setIsKnowledgeGraphLoading(true);

    try {
      const result = await window.learner?.extractDocumentGraph(documentSnapshot.path, documentSnapshot.markdown);
      if (!result) {
        throw new Error("Graph extraction is not available in this renderer.");
      }

      setKnowledgeGraph(result.graph);
      setLastKnowledgeGraphExtractionChanged(result.extracted);
    } catch (error) {
      setKnowledgeGraphError(error instanceof Error ? error.message : "Graph extraction failed.");
    } finally {
      setIsKnowledgeGraphLoading(false);
    }
  }, [activeDocumentPath, getCurrentDocumentTools]);

  const deleteKnowledgeGraph = useCallback(async () => {
    if (!activeDocumentPath) return;

    setKnowledgeGraphError(null);
    setIsKnowledgeGraphDeleting(true);

    try {
      const graph = await window.learner?.deleteDocumentGraph(activeDocumentPath);
      if (!graph) {
        throw new Error("Graph deletion is not available in this renderer.");
      }

      setKnowledgeGraph(graph);
      setLastKnowledgeGraphExtractionChanged(null);
    } catch (error) {
      setKnowledgeGraphError(error instanceof Error ? error.message : "Graph deletion failed.");
    } finally {
      setIsKnowledgeGraphDeleting(false);
    }
  }, [activeDocumentPath]);

  return (
    <div className="relative flex h-screen overflow-hidden">
      <SideBar
        activeDocumentPath={activeDocumentPath}
        documentsVersion={documentsVersion}
        isSidebarOpen={isSidebarOpen}
        onDocumentCreated={(documentPath) => {
          markDocumentsChanged();
          openDocument(documentPath);
        }}
        onDocumentDeleted={handleDocumentDeleted}
        onDocumentMoved={handleDocumentMoved}
        onOpenSearch={() => setIsDocumentSearchOpen(true)}
        onOpenDocument={openDocument}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          activeDocumentPath={activeDocumentPath}
          isSidebarOpen={isSidebarOpen}
          openTabs={openTabs}
          onCloseTab={closeTab}
          onReorderTabs={(sourcePath, targetPath, position) => {
            setOpenTabs((current) => reorderList(current, sourcePath, targetPath, position));
          }}
          onSelectTab={openDocument}
          toggleSidebar={() => setIsSidebarOpen((isOpen) => !isOpen)}
        />
        <main className="relative min-h-0 flex-1 overflow-hidden">
          {openTabs.length === 0 ? (
            <div className="p-4 text-sm text-white/50">Select or create a document.</div>
          ) : (
            openTabs.map((documentPath) => (
              <TiptapEditor
                active={documentPath === activeDocumentPath}
                documentPath={documentPath}
                initialState={editorStates[documentPath]}
                key={documentPath}
                onAgentToolsChange={updateEditorAgentTools}
                onPersistedStateChange={(state) => updateEditorState(documentPath, state)}
                onRename={handleDocumentRenamed}
              />
            ))
          )}
          {activeDocumentPath && !isKnowledgeGraphOpen && (
            <FloatingIconButton
              ariaLabel="View knowledge graph"
              className="right-5 top-15"
              disabled={isKnowledgeGraphLoading}
              icon={<GraphIcon size={16} className={isKnowledgeGraphLoading ? "animate-pulse" : ""} />}
              onClick={() => {
                if (isKnowledgeGraphOpen) {
                  setIsKnowledgeGraphOpen(false);
                  return;
                }

                void openKnowledgeGraph();
              }}
              size={8}
              tooltip={
                isKnowledgeGraphLoading
                  ? "Building graph"
                  : isKnowledgeGraphOpen
                    ? "Close graph"
                    : "View graph"
              }
            />
          )}
        </main>
      </div>
      <KnowledgeGraphPanel
        error={knowledgeGraphError}
        getCurrentDocumentMarkdown={getCurrentDocumentMarkdown}
        graph={knowledgeGraph}
        isDeleting={isKnowledgeGraphDeleting}
        isLoading={isKnowledgeGraphLoading}
        isSidebarOpen={isSidebarOpen}
        lastExtractionChanged={lastKnowledgeGraphExtractionChanged}
        onClose={() => setIsKnowledgeGraphOpen(false)}
        onDeleteGraph={deleteKnowledgeGraph}
        onGraphChange={setKnowledgeGraph}
        onOpenDocument={openDocument}
        onRefresh={openKnowledgeGraph}
        open={isKnowledgeGraphOpen}
      />
      <ChatPanel
        getCurrentDocumentTools={getCurrentDocumentTools}
        isOpen={isBubbleOpen}
        isSidebarOpen={isSidebarOpen}
        onClose={() => setIsBubbleOpen(false)}
        onOpenDocument={openDocument}
      />
      <DocumentSearchDialog
        open={isDocumentSearchOpen}
        onClose={() => setIsDocumentSearchOpen(false)}
        onOpenDocument={openDocument}
      />
      <ChatBubble isOpen={isBubbleOpen} toggleBubbleOpen={() => setIsBubbleOpen((isOpen) => !isOpen)} />
    </div>
  );
}
