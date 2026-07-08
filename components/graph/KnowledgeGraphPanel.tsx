"use client";

import {
  ArrowsClockwiseIcon,
  CaretRightIcon,
  CheckIcon,
  FileTextIcon,
  GraphIcon,
  LinkIcon,
  PencilSimpleIcon,
  PlusIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { documentTitle } from "@/components/documentPaths";
import ConceptCombobox from "./ConceptCombobox";
import { GraphTextArea, GraphTextField } from "./GraphField";
import GraphModal from "./GraphModal";
import { graphNodeHeight, graphNodeWidth, layoutKnowledgeGraph, type GraphNodePosition } from "./graphLayout";

type KnowledgeGraphPanelProps = {
  error: string | null;
  isDeleting: boolean;
  graph: KnowledgeDocumentGraph | null;
  getCurrentDocumentMarkdown: () => string | null;
  isLoading: boolean;
  isSidebarOpen: boolean;
  lastExtractionChanged: boolean | null;
  onClose: () => void;
  onDeleteGraph: () => void;
  onGraphChange: (graph: KnowledgeDocumentGraph) => void;
  onOpenDocument: (documentPath: string) => void;
  onRefresh: () => void;
  open: boolean;
};

type ConceptDialogMode = "create" | "edit";

const iconButtonClassName =
  "flex h-8 w-8 items-center justify-center rounded-full text-white/48 transition hover:bg-white/[0.08] hover:text-white/85 disabled:text-white/20";

const textButtonClassName =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-white/62 transition hover:bg-white/[0.08] hover:text-white/90 disabled:opacity-45";

type NodeVisualState = "selected" | "incoming" | "outgoing" | "current" | "dim" | "default";
type EdgeVisualState = "selected" | "incoming" | "outgoing" | "dim" | "default";

function getNodeVisualState(graph: KnowledgeDocumentGraph, node: KnowledgeGraphNode, selectedNodeId: number | null): NodeVisualState {
  if (!selectedNodeId) return node.inCurrentDocument ? "current" : "default";
  if (node.id === selectedNodeId) return "selected";

  const isIncomingSource = graph.edges.some((edge) => edge.source === node.id && edge.target === selectedNodeId);
  if (isIncomingSource) return "incoming";

  const isOutgoingTarget = graph.edges.some((edge) => edge.source === selectedNodeId && edge.target === node.id);
  if (isOutgoingTarget) return "outgoing";

  return "dim";
}

function nodeColors(state: NodeVisualState, inCurrentDocument: boolean) {
  switch (state) {
    case "selected":
      return {
        background: "rgba(200,236,186,0.2)",
        border: "1px solid rgba(200,236,186,0.95)",
        boxShadow: "0 0 0 5px rgba(200,236,186,0.1), 0 12px 34px rgba(0,0,0,0.35)",
        opacity: 1,
      };
    case "incoming":
      return {
        background: "rgba(125,211,252,0.2)",
        border: "1px solid rgba(125,211,252,0.78)",
        boxShadow: "0 0 0 4px rgba(125,211,252,0.09)",
        opacity: 1,
      };
    case "outgoing":
      return {
        background: "rgba(251,191,36,0.18)",
        border: "1px solid rgba(251,191,36,0.78)",
        boxShadow: "0 0 0 4px rgba(251,191,36,0.08)",
        opacity: 1,
      };
    case "current":
      return {
        background: "rgba(200,236,186,0.14)",
        border: "1px solid rgba(200,236,186,0.3)",
        boxShadow: "none",
        opacity: 1,
      };
    case "dim":
      return {
        background: inCurrentDocument ? "rgba(200,236,186,0.08)" : "rgba(255,255,255,0.045)",
        border: inCurrentDocument ? "1px solid rgba(200,236,186,0.16)" : "1px solid rgba(255,255,255,0.08)",
        boxShadow: "none",
        opacity: 0.42,
      };
    default:
      return {
        background: inCurrentDocument ? "rgba(200,236,186,0.16)" : "rgba(255,255,255,0.07)",
        border: inCurrentDocument ? "1px solid rgba(200,236,186,0.34)" : "1px solid rgba(255,255,255,0.12)",
        boxShadow: "none",
        opacity: 1,
      };
  }
}

function getEdgeVisualState(edge: KnowledgeGraphEdge, selectedNodeId: number | null, selectedEdgeId: number | null): EdgeVisualState {
  if (selectedEdgeId === edge.id) return "selected";
  if (selectedEdgeId !== null) return "dim";
  if (!selectedNodeId) return "default";
  if (edge.target === selectedNodeId) return "incoming";
  if (edge.source === selectedNodeId) return "outgoing";
  return "dim";
}

function edgeColors(state: EdgeVisualState) {
  switch (state) {
    case "selected":
      return {
        labelBackground: "rgba(200,236,186,0.22)",
        labelColor: "rgba(255,255,255,0.95)",
        stroke: "rgba(200,236,186,0.95)",
        strokeWidth: 3,
      };
    case "incoming":
      return {
        labelBackground: "rgba(125,211,252,0.22)",
        labelColor: "rgba(225,245,255,0.98)",
        stroke: "rgba(125,211,252,0.9)",
        strokeWidth: 2.7,
      };
    case "outgoing":
      return {
        labelBackground: "rgba(251,191,36,0.22)",
        labelColor: "rgba(255,246,214,0.98)",
        stroke: "rgba(251,191,36,0.9)",
        strokeWidth: 2.7,
      };
    case "dim":
      return {
        labelBackground: "rgba(20,20,20,0.55)",
        labelColor: "rgba(255,255,255,0.24)",
        stroke: "rgba(255,255,255,0.1)",
        strokeWidth: 1,
      };
    default:
      return {
        labelBackground: "rgba(20,20,20,0.78)",
        labelColor: "rgba(255,255,255,0.52)",
        stroke: "rgba(255,255,255,0.28)",
        strokeWidth: 1.4,
      };
  }
}

function buildFlowNodes(
  graph: KnowledgeDocumentGraph,
  nodePositions: Map<number, GraphNodePosition>,
  selectedNodeId: number | null,
  selectedEdgeId: number | null,
): Node[] {
  return graph.nodes.map((node) => {
    const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId);
    const visualState =
      selectedEdge && !selectedNodeId
        ? node.id === selectedEdge.source
          ? "incoming"
          : node.id === selectedEdge.target
            ? "outgoing"
            : "dim"
        : getNodeVisualState(graph, node, selectedNodeId);
    const colors = nodeColors(visualState, node.inCurrentDocument);
    const noteCount = node.mentions.length;

    return {
      id: String(node.id),
      data: {
        label: (
          <div className="relative min-w-0">
            {noteCount > 1 && (
              <span className="absolute -right-3.5 -top-3.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-black/50 px-1.5 text-[10px] font-semibold leading-none text-white/78 ring-1 ring-white/[0.18]">
                  {noteCount}
              </span>
            )}
            <p className="truncate text-sm font-semibold">{node.name}</p>
            {node.type && <p className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-white/45">{node.type}</p>}
          </div>
        ),
      },
      position: nodePositions.get(node.id) ?? { x: 0, y: 0 },
      style: {
        background: colors.background,
        border: colors.border,
        borderRadius: 14,
        boxShadow: colors.boxShadow,
        color: "rgba(255,255,255,0.9)",
        minHeight: graphNodeHeight,
        opacity: colors.opacity,
        padding: "10px 12px",
        width: graphNodeWidth,
      },
    };
  });
}

function buildFlowEdges(graph: KnowledgeDocumentGraph, selectedNodeId: number | null, selectedEdgeId: number | null): Edge[] {
  return graph.edges.map((edge) => {
    const visualState = getEdgeVisualState(edge, selectedNodeId, selectedEdgeId);
    const colors = edgeColors(visualState);
    const showLabel =
      visualState === "selected" ||
      (selectedNodeId !== null && (visualState === "incoming" || visualState === "outgoing"));

    return {
      id: String(edge.id),
      source: String(edge.source),
      target: String(edge.target),
      label: showLabel ? edge.relation.replace(/_/g, " ") : "",
      markerEnd: { type: MarkerType.ArrowClosed, color: colors.stroke },
      style: {
        stroke: colors.stroke,
        strokeWidth: colors.strokeWidth,
      },
      labelBgBorderRadius: 8,
      labelBgPadding: [8, 5],
      labelBgStyle: { fill: colors.labelBackground, fillOpacity: showLabel ? 0.96 : 0 },
      labelStyle: {
        fill: showLabel ? colors.labelColor : "transparent",
        fontSize: 11,
        fontWeight: 700,
      },
      type: "smoothstep",
    };
  });
}

function GraphHeaderButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={iconButtonClassName}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function GraphMention({
  mention,
  onOpenDocument,
}: {
  mention: KnowledgeConceptMention;
  onOpenDocument: (documentPath: string) => void;
}) {
  return (
    <details className="group rounded-xl bg-white/[0.045] px-3 py-2 open:bg-white/[0.065]">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <CaretRightIcon size={14} className="shrink-0 text-white/38 transition-transform group-open:rotate-90" />
        <FileTextIcon size={15} className="shrink-0 text-white/45" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-white/84">{documentTitle(mention.documentPath)}</span>
        {mention.mentionType && (
          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/42">
            {mention.mentionType.replace(/_/g, " ")}
          </span>
        )}
      </summary>
      {mention.sectionTitle && <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-white/35">{mention.sectionTitle}</p>}
      {mention.contribution && (
        <div className="mt-3 rounded-lg bg-black/14 px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/35">How this note fits</p>
          <p className="mt-1 text-sm leading-6 text-white/72">{mention.contribution}</p>
        </div>
      )}
      <div className="mt-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-white/35">Source excerpt</p>
        <div className="learner-ai-markdown text-sm leading-6 text-white/72">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{mention.excerptMarkdown}</ReactMarkdown>
        </div>
      </div>
      <button
        className="mt-2 rounded-full px-2 py-1 text-xs text-white/48 transition hover:bg-white/[0.07] hover:text-white/82"
        onClick={() => onOpenDocument(mention.documentPath)}
        type="button"
      >
        Open note
      </button>
    </details>
  );
}

export default function KnowledgeGraphPanel({
  error,
  getCurrentDocumentMarkdown,
  graph,
  isDeleting,
  isLoading,
  isSidebarOpen,
  lastExtractionChanged,
  onClose,
  onDeleteGraph,
  onGraphChange,
  onOpenDocument,
  onRefresh,
  open,
}: KnowledgeGraphPanelProps) {
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [nodePositions, setNodePositions] = useState<Map<number, GraphNodePosition>>(new Map());
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<number | null>(null);

  const [conceptDialogMode, setConceptDialogMode] = useState<ConceptDialogMode>("create");
  const [conceptDialogOpen, setConceptDialogOpen] = useState(false);
  const [conceptName, setConceptName] = useState("");
  const [conceptType, setConceptType] = useState("");
  const [conceptSummary, setConceptSummary] = useState("");
  const [conceptExplanation, setConceptExplanation] = useState("");

  const [connectionDialogOpen, setConnectionDialogOpen] = useState(false);
  const [targetConcept, setTargetConcept] = useState<KnowledgeConceptSearchResult | null>(null);
  const [targetConceptName, setTargetConceptName] = useState("");
  const [targetConceptType, setTargetConceptType] = useState("");
  const [targetConceptSummary, setTargetConceptSummary] = useState("");
  const [relationName, setRelationName] = useState("");
  const [relationExplanation, setRelationExplanation] = useState("");

  const [edgeDialogOpen, setEdgeDialogOpen] = useState(false);
  const [edgeRelationName, setEdgeRelationName] = useState("");
  const [edgeRelationExplanation, setEdgeRelationExplanation] = useState("");

  useEffect(() => {
    let active = true;

    if (!graph || graph.nodes.length === 0) {
      return;
    }

    layoutKnowledgeGraph(graph)
      .then((positions) => {
        if (active) setNodePositions(positions);
      })
      .catch(() => {
        if (active) setNodePositions(new Map());
      });

    return () => {
      active = false;
    };
  }, [graph]);

  const flowNodes = useMemo(
    () => (graph ? buildFlowNodes(graph, nodePositions, selectedNodeId, selectedEdgeId) : []),
    [graph, nodePositions, selectedEdgeId, selectedNodeId],
  );
  const flowEdges = useMemo(
    () => (graph ? buildFlowEdges(graph, selectedNodeId, selectedEdgeId) : []),
    [graph, selectedEdgeId, selectedNodeId],
  );
  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedEdge = graph?.edges.find((edge) => edge.id === selectedEdgeId) ?? null;
  const selectedEdgeSource = graph?.nodes.find((node) => node.id === selectedEdge?.source) ?? null;
  const selectedEdgeTarget = graph?.nodes.find((node) => node.id === selectedEdge?.target) ?? null;
  const selectedNodeMentions = selectedNode
    ? [...selectedNode.mentions].sort((first, second) => {
        if (first.documentPath === graph?.documentPath && second.documentPath !== graph?.documentPath) return -1;
        if (second.documentPath === graph?.documentPath && first.documentPath !== graph?.documentPath) return 1;
        return second.updatedAt - first.updatedAt;
      })
    : [];
  const isCreatingTargetConcept = Boolean(targetConceptName.trim()) && !targetConcept;

  function currentNoteExcerpt(fallbackTitle: string, fallbackSummary: string) {
    const markdown = getCurrentDocumentMarkdown()?.trim();
    if (markdown) return markdown;

    return [fallbackTitle.trim(), fallbackSummary.trim()].filter(Boolean).join("\n\n");
  }

  function openCreateConceptDialog() {
    setEditError(null);
    setConceptDialogMode("create");
    setConceptName("");
    setConceptType("");
    setConceptSummary("");
    setConceptExplanation("");
    setConceptDialogOpen(true);
  }

  function openEditConceptDialog() {
    if (!selectedNode) return;

    setEditError(null);
    setConceptDialogMode("edit");
    setConceptName(selectedNode.name);
    setConceptType(selectedNode.type ?? "");
    setConceptSummary(selectedNode.summary ?? "");
    setConceptExplanation(selectedNode.explanation ?? "");
    setConceptDialogOpen(true);
  }

  function openConnectionDialog() {
    if (!selectedNode) return;

    setEditError(null);
    setTargetConcept(null);
    setTargetConceptName("");
    setTargetConceptType("");
    setTargetConceptSummary("");
    setRelationName("");
    setRelationExplanation("");
    setConnectionDialogOpen(true);
  }

  function openEdgeDialog() {
    if (!selectedEdge) return;

    setEditError(null);
    setEdgeRelationName(selectedEdge.relation);
    setEdgeRelationExplanation(selectedEdge.explanation ?? "");
    setEdgeDialogOpen(true);
  }

  async function submitConceptDialog() {
    if (!graph) return;

    const cleanName = conceptName.trim();
    if (!cleanName) {
      setEditError("Concept name cannot be empty.");
      return;
    }

    setEditError(null);
    setIsSavingEdit(true);
    try {
      if (conceptDialogMode === "edit") {
        if (!selectedNode) return;

        const nextGraph = await window.learner?.updateGraphConcept(graph.documentPath, {
          conceptId: selectedNode.id,
          explanation: conceptExplanation,
          name: cleanName,
          summary: conceptSummary,
          type: conceptType,
        });
        if (nextGraph) onGraphChange(nextGraph);
      } else {
        const excerptMarkdown = currentNoteExcerpt(cleanName, conceptSummary || conceptExplanation);
        if (!excerptMarkdown.trim()) {
          setEditError("Add a name or summary before creating the concept.");
          return;
        }

        const nextGraph = await window.learner?.addGraphConceptMention(graph.documentPath, {
          concept: {
            explanation: conceptExplanation,
            name: cleanName,
            summary: conceptSummary,
            type: conceptType,
          },
          conceptId: null,
          contribution: conceptSummary || conceptExplanation,
          documentHash: graph.documentHash,
          excerptMarkdown,
          mentionType: "manual",
          sectionTitle: documentTitle(graph.documentPath),
        });
        if (nextGraph) onGraphChange(nextGraph);
      }

      setConceptDialogOpen(false);
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : "Could not save concept.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function submitConnectionDialog() {
    if (!graph || !selectedNode) return;

    const cleanRelation = relationName.trim();
    const cleanTargetName = targetConceptName.trim();
    if (!cleanRelation) {
      setEditError("Predicate cannot be empty.");
      return;
    }
    if (!targetConcept && !cleanTargetName) {
      setEditError("Choose an existing target concept or enter a new concept name.");
      return;
    }
    if (targetConcept?.id === selectedNode.id) {
      setEditError("Choose a different target concept.");
      return;
    }

    setEditError(null);
    setIsSavingEdit(true);
    try {
      const nextGraph = await window.learner?.addGraphRelation(graph.documentPath, {
        documentHash: graph.documentHash,
        evidenceMarkdown: currentNoteExcerpt(selectedNode.name, relationExplanation),
        explanation: relationExplanation,
        fromConceptId: selectedNode.id,
        relation: cleanRelation,
        targetConcept: targetConcept
          ? undefined
          : {
              name: cleanTargetName,
              summary: targetConceptSummary,
              type: targetConceptType,
            },
        toConceptId: targetConcept?.id ?? null,
      });
      if (nextGraph) onGraphChange(nextGraph);
      setConnectionDialogOpen(false);
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : "Could not create connection.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function submitEdgeDialog() {
    if (!graph || !selectedEdge) return;

    const cleanRelation = edgeRelationName.trim();
    if (!cleanRelation) {
      setEditError("Predicate cannot be empty.");
      return;
    }

    setEditError(null);
    setIsSavingEdit(true);
    try {
      const nextGraph = await window.learner?.updateGraphRelation(graph.documentPath, {
        explanation: edgeRelationExplanation,
        relation: cleanRelation,
        relationId: selectedEdge.id,
      });
      if (nextGraph) onGraphChange(nextGraph);
      setEdgeDialogOpen(false);
    } catch (saveError) {
      setEditError(saveError instanceof Error ? saveError.message : "Could not save connection.");
    } finally {
      setIsSavingEdit(false);
    }
  }

  return (
    <section
      aria-hidden={!open}
      className={`app-no-drag fixed bottom-0 right-0 top-10 z-30 flex flex-col bg-[#171717]/88 text-white shadow-[0_30px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08] backdrop-blur-[24px] transition-all duration-200 ${
        open ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      } ${isSidebarOpen ? "left-64" : "left-0"}`}
    >
      <header className="flex h-14 shrink-0 items-center justify-between px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.08] text-white/80">
            <GraphIcon size={18} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Knowledge Graph</p>
            <p className="truncate text-xs text-white/42">
              {graph
                ? `${graph.nodes.length} concepts, ${graph.edges.length} relations`
                : "Extract concepts and relations from this note"}
            </p>
          </div>
          {lastExtractionChanged !== null && (
            <span className="rounded-full bg-white/[0.07] px-2 py-1 text-[11px] text-white/46">
              {lastExtractionChanged ? "updated" : "cached"}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <GraphHeaderButton disabled={!graph} label="Add concept" onClick={openCreateConceptDialog}>
            <PlusIcon size={17} weight="bold" />
          </GraphHeaderButton>

          {deleteConfirming ? (
            <span className="flex items-center gap-1 rounded-full bg-red-300/10 px-1.5 py-1 text-xs text-red-100">
              <span className="px-1">Delete graph?</span>
              <button
                className="rounded-full px-2 py-1 text-white/45 transition hover:bg-white/[0.08] hover:text-white/85"
                onClick={() => setDeleteConfirming(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-full bg-red-200/90 px-2 py-1 font-medium text-red-950 transition hover:bg-red-100 disabled:opacity-45"
                disabled={isDeleting}
                onClick={() => {
                  setDeleteConfirming(false);
                  onDeleteGraph();
                }}
                type="button"
              >
                Delete
              </button>
            </span>
          ) : (
            <GraphHeaderButton
              disabled={isLoading || isDeleting || !graph?.extractedAt}
              label="Delete graph"
              onClick={() => setDeleteConfirming(true)}
            >
              <TrashIcon size={16} />
            </GraphHeaderButton>
          )}

          <GraphHeaderButton disabled={isLoading || isDeleting} label="Refresh graph" onClick={onRefresh}>
            <ArrowsClockwiseIcon size={17} className={isLoading ? "animate-spin" : ""} />
          </GraphHeaderButton>

          <GraphHeaderButton label="Close graph" onClick={onClose}>
            <XIcon size={16} />
          </GraphHeaderButton>
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="m-5 rounded-xl bg-red-300/10 px-4 py-3 text-sm text-red-200">{error}</div>
        ) : isLoading && !graph ? (
          <div className="flex h-full items-center justify-center text-sm text-white/45">Extracting graph...</div>
        ) : graph && graph.nodes.length > 0 ? (
          <>
            <ReactFlow
              colorMode="dark"
              edges={flowEdges}
              fitView
              minZoom={0.35}
              nodes={flowNodes}
              onEdgeClick={(_event, edge) => {
                setEditError(null);
                setSelectedNodeId(null);
                setSelectedEdgeId(Number(edge.id));
              }}
              onNodeClick={(_event, node) => {
                setEditError(null);
                setSelectedEdgeId(null);
                setSelectedNodeId(Number(node.id));
              }}
              onPaneClick={() => {
                setEditError(null);
                setSelectedEdgeId(null);
                setSelectedNodeId(null);
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(255,255,255,0.06)" gap={24} />
              <MiniMap
                maskColor="rgba(0,0,0,0.35)"
                nodeColor={(node) =>
                  graph.nodes.find((concept) => String(concept.id) === node.id)?.inCurrentDocument
                    ? "rgba(200,236,186,0.65)"
                    : "rgba(255,255,255,0.22)"
                }
                pannable
                zoomable
              />
              <Controls position="bottom-left" />
            </ReactFlow>

            {(selectedNode || selectedEdge) && (
              <aside className="absolute bottom-3 right-3 top-3 flex w-[370px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl bg-[#151515]/92 shadow-[0_18px_56px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.075] backdrop-blur-[22px]">
                <div className="flex shrink-0 items-start justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-white/38">
                      {selectedNode ? "Concept" : "Connection"}
                    </p>
                    <p className="mt-1 break-words text-lg font-semibold leading-6 text-white/92">
                      {selectedNode?.name ?? selectedEdge?.relation.replace(/_/g, " ")}
                    </p>
                  </div>
                  <button
                    aria-label="Close graph inspector"
                    className={iconButtonClassName}
                    onClick={() => {
                      setSelectedEdgeId(null);
                      setSelectedNodeId(null);
                    }}
                    type="button"
                  >
                    <XIcon size={15} />
                  </button>
                </div>

                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 pb-5">
                  {editError && <p className="rounded-lg bg-red-300/10 px-3 py-2 text-xs text-red-200">{editError}</p>}

                  {selectedNode && (
                    <>
                      <section className="space-y-3">
                        {selectedNode.type && (
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/38">{selectedNode.type}</p>
                        )}
                        {selectedNode.summary ? (
                          <p className="text-sm leading-6 text-white/74">{selectedNode.summary}</p>
                        ) : (
                          <p className="text-sm text-white/42">No summary yet.</p>
                        )}
                        {selectedNode.explanation && (
                          <p className="border-l border-white/12 pl-3 text-sm leading-6 text-white/56">{selectedNode.explanation}</p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <button className={textButtonClassName} onClick={openEditConceptDialog} type="button">
                            <PencilSimpleIcon size={15} />
                            Edit
                          </button>
                          <button className={textButtonClassName} onClick={openConnectionDialog} type="button">
                            <LinkIcon size={15} />
                            Add connection
                          </button>
                        </div>
                      </section>

                      <section className="space-y-2 border-t border-white/[0.07] pt-4">
                        <p className="text-sm font-medium text-white/72">Associated notes</p>
                        {selectedNodeMentions.length > 0 ? (
                          selectedNodeMentions.map((mention, index) => (
                            <GraphMention
                              key={`${mention.documentPath}-${mention.updatedAt}-${index}`}
                              mention={mention}
                              onOpenDocument={onOpenDocument}
                            />
                          ))
                        ) : (
                          <p className="text-sm text-white/42">No note excerpts are linked to this concept yet.</p>
                        )}
                      </section>
                    </>
                  )}

                  {selectedEdge && (
                    <section className="space-y-4">
                      <div className="rounded-xl bg-white/[0.04] px-3 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-white/36">From</p>
                        <p className="mt-1 break-words text-sm text-white/78">{selectedEdgeSource?.name ?? selectedEdge.source}</p>
                        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-white/36">Predicate</p>
                        <p className="mt-1 break-words text-sm font-medium text-white/88">
                          {selectedEdge.relation.replace(/_/g, " ")}
                        </p>
                        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-white/36">To</p>
                        <p className="mt-1 break-words text-sm text-white/78">{selectedEdgeTarget?.name ?? selectedEdge.target}</p>
                      </div>
                      {selectedEdge.explanation ? (
                        <p className="text-sm leading-6 text-white/66">{selectedEdge.explanation}</p>
                      ) : (
                        <p className="text-sm text-white/42">No explanation yet.</p>
                      )}
                      <button className={textButtonClassName} onClick={openEdgeDialog} type="button">
                        <PencilSimpleIcon size={15} />
                        Edit connection
                      </button>
                    </section>
                  )}
                </div>
              </aside>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/45">No graph extracted yet.</div>
        )}

        <GraphModal
          footer={
            <>
              <button
                className="rounded-full px-3 py-2 text-sm font-medium text-white/55 transition hover:bg-white/[0.08] hover:text-white/88"
                onClick={() => setConceptDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-50"
                disabled={isSavingEdit}
                onClick={submitConceptDialog}
                type="button"
              >
                <CheckIcon size={15} weight="bold" />
                {conceptDialogMode === "edit" ? "Save concept" : "Add concept"}
              </button>
            </>
          }
          onClose={() => setConceptDialogOpen(false)}
          open={conceptDialogOpen}
          subtitle={
            conceptDialogMode === "edit"
              ? "Update the concept name, type, and explanation."
              : "Create a concept in the current graph. Connections can be added after selecting it."
          }
          title={conceptDialogMode === "edit" ? "Edit concept" : "Add concept"}
        >
          {editError && <p className="rounded-lg bg-red-300/10 px-3 py-2 text-xs text-red-200">{editError}</p>}
          <GraphTextField label="Concept name" onChange={(event) => setConceptName(event.target.value)} value={conceptName} />
          <GraphTextField
            label="Type"
            onChange={(event) => setConceptType(event.target.value)}
            placeholder="protocol, tradeoff, mechanism..."
            value={conceptType}
          />
          <GraphTextArea
            label="Summary"
            minRows={3}
            onChange={(event) => setConceptSummary(event.target.value)}
            placeholder="Short explanation shown in the inspector."
            value={conceptSummary}
          />
          <GraphTextArea
            label="Details"
            minRows={4}
            onChange={(event) => setConceptExplanation(event.target.value)}
            placeholder="Longer notes, comparison, or study relevance."
            value={conceptExplanation}
          />
        </GraphModal>

        <GraphModal
          footer={
            <>
              <button
                className="rounded-full px-3 py-2 text-sm font-medium text-white/55 transition hover:bg-white/[0.08] hover:text-white/88"
                onClick={() => setConnectionDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-50"
                disabled={isSavingEdit}
                onClick={submitConnectionDialog}
                type="button"
              >
                <CheckIcon size={15} weight="bold" />
                Add connection
              </button>
            </>
          }
          onClose={() => setConnectionDialogOpen(false)}
          open={connectionDialogOpen}
          subtitle={selectedNode ? `Source: ${selectedNode.name}` : undefined}
          title="Add connection"
        >
          {editError && <p className="rounded-lg bg-red-300/10 px-3 py-2 text-xs text-red-200">{editError}</p>}
          <ConceptCombobox
            label="Target concept"
            onSelectConcept={setTargetConcept}
            onValueChange={setTargetConceptName}
            placeholder="Search existing or type a new concept"
            selectedConcept={targetConcept}
            value={targetConceptName}
          />
          {isCreatingTargetConcept && (
            <>
              <GraphTextField
                label="New target type"
                onChange={(event) => setTargetConceptType(event.target.value)}
                placeholder="protocol, tradeoff, mechanism..."
                value={targetConceptType}
              />
              <GraphTextArea
                label="New target summary"
                minRows={3}
                onChange={(event) => setTargetConceptSummary(event.target.value)}
                placeholder="What this new concept means."
                value={targetConceptSummary}
              />
            </>
          )}
          <GraphTextField
            label="Predicate"
            onChange={(event) => setRelationName(event.target.value)}
            placeholder="uses, causes, depends on, contrasts with..."
            value={relationName}
          />
          <GraphTextArea
            label="Why this connection matters"
            minRows={4}
            onChange={(event) => setRelationExplanation(event.target.value)}
            placeholder="Explain the relationship in study-friendly language."
            value={relationExplanation}
          />
        </GraphModal>

        <GraphModal
          footer={
            <>
              <button
                className="rounded-full px-3 py-2 text-sm font-medium text-white/55 transition hover:bg-white/[0.08] hover:text-white/88"
                onClick={() => setEdgeDialogOpen(false)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:opacity-50"
                disabled={isSavingEdit}
                onClick={submitEdgeDialog}
                type="button"
              >
                <CheckIcon size={15} weight="bold" />
                Save connection
              </button>
            </>
          }
          onClose={() => setEdgeDialogOpen(false)}
          open={edgeDialogOpen}
          subtitle={
            selectedEdgeSource && selectedEdgeTarget ? `${selectedEdgeSource.name} -> ${selectedEdgeTarget.name}` : undefined
          }
          title="Edit connection"
        >
          {editError && <p className="rounded-lg bg-red-300/10 px-3 py-2 text-xs text-red-200">{editError}</p>}
          <GraphTextField
            label="Predicate"
            onChange={(event) => setEdgeRelationName(event.target.value)}
            value={edgeRelationName}
          />
          <GraphTextArea
            label="Why this connection matters"
            minRows={4}
            onChange={(event) => setEdgeRelationExplanation(event.target.value)}
            value={edgeRelationExplanation}
          />
        </GraphModal>
      </div>
    </section>
  );
}
