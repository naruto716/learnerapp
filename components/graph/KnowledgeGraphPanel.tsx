"use client";

import {
  ArrowsClockwiseIcon,
  FileTextIcon,
  GraphIcon,
  TrashIcon,
  XIcon,
} from "@phosphor-icons/react";
import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { documentTitle } from "@/components/documentPaths";

type KnowledgeGraphPanelProps = {
  error: string | null;
  isDeleting: boolean;
  graph: KnowledgeDocumentGraph | null;
  isLoading: boolean;
  isSidebarOpen: boolean;
  lastExtractionChanged: boolean | null;
  onClose: () => void;
  onDeleteGraph: () => void;
  onOpenDocument: (documentPath: string) => void;
  onRefresh: () => void;
  open: boolean;
};

const graphNodeWidth = 180;
const graphNodeHeight = 58;

function layoutGraph(graph: KnowledgeDocumentGraph) {
  const dagreGraph = new dagre.graphlib.Graph();

  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({
    acyclicer: "greedy",
    edgesep: 24,
    marginx: 48,
    marginy: 48,
    nodesep: 54,
    rankdir: "LR",
    ranksep: 120,
  });

  for (const node of graph.nodes) {
    dagreGraph.setNode(String(node.id), {
      height: graphNodeHeight,
      width: graphNodeWidth,
    });
  }

  for (const edge of graph.edges) {
    dagreGraph.setEdge(String(edge.source), String(edge.target));
  }

  dagre.layout(dagreGraph);

  return new Map(
    graph.nodes.map((node) => {
      const layoutNode = dagreGraph.node(String(node.id));
      return [
        node.id,
        {
          x: (layoutNode?.x ?? 0) - graphNodeWidth / 2,
          y: (layoutNode?.y ?? 0) - graphNodeHeight / 2,
        },
      ];
    }),
  );
}

function buildFlowNodes(graph: KnowledgeDocumentGraph, selectedNodeId: number | null): Node[] {
  const nodePositions = layoutGraph(graph);

  return graph.nodes.map((node) => ({
    id: String(node.id),
    data: {
      label: (
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{node.name}</p>
          {node.type && <p className="mt-0.5 truncate text-[10px] uppercase tracking-wide text-white/45">{node.type}</p>}
        </div>
      ),
    },
    position: nodePositions.get(node.id) ?? { x: 0, y: 0 },
    style: {
      background: node.inCurrentDocument ? "rgba(200,236,186,0.16)" : "rgba(255,255,255,0.07)",
      border:
        selectedNodeId === node.id
          ? "1px solid rgba(200,236,186,0.9)"
          : node.inCurrentDocument
            ? "1px solid rgba(200,236,186,0.34)"
            : "1px solid rgba(255,255,255,0.12)",
      borderRadius: 14,
      boxShadow: selectedNodeId === node.id ? "0 0 0 4px rgba(200,236,186,0.08)" : "none",
      color: "rgba(255,255,255,0.9)",
      padding: "10px 12px",
      width: graphNodeWidth,
    },
  }));
}

function buildFlowEdges(graph: KnowledgeDocumentGraph): Edge[] {
  return graph.edges.map((edge) => ({
    id: String(edge.id),
    source: String(edge.source),
    target: String(edge.target),
    label: edge.relation.replace(/_/g, " "),
    markerEnd: { type: MarkerType.ArrowClosed },
    style: {
      stroke: "rgba(255,255,255,0.34)",
      strokeWidth: 1.5,
    },
    labelBgBorderRadius: 8,
    labelBgPadding: [6, 3],
    labelBgStyle: { fill: "rgba(18,18,18,0.86)" },
    labelStyle: {
      fill: "rgba(255,255,255,0.62)",
      fontSize: 11,
      fontWeight: 600,
    },
    type: "smoothstep",
  }));
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
        <FileTextIcon size={15} className="shrink-0 text-white/45" />
        <span className="min-w-0 flex-1 truncate text-sm text-white/82">{documentTitle(mention.documentPath)}</span>
        {mention.mentionType && (
          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] uppercase tracking-wide text-white/42">
            {mention.mentionType.replace(/_/g, " ")}
          </span>
        )}
      </summary>
      {mention.sectionTitle && <p className="mt-2 text-xs text-white/42">{mention.sectionTitle}</p>}
      <div className="learner-ai-markdown mt-2 text-sm leading-6 text-white/72">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{mention.excerptMarkdown}</ReactMarkdown>
      </div>
      <button
        type="button"
        className="mt-2 rounded-full px-2 py-1 text-xs text-white/48 transition hover:bg-white/[0.07] hover:text-white/82"
        onClick={() => onOpenDocument(mention.documentPath)}
      >
        Open note
      </button>
    </details>
  );
}

export default function KnowledgeGraphPanel({
  error,
  graph,
  isDeleting,
  isLoading,
  isSidebarOpen,
  lastExtractionChanged,
  onClose,
  onDeleteGraph,
  onOpenDocument,
  onRefresh,
  open,
}: KnowledgeGraphPanelProps) {
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);

  const flowNodes = useMemo(() => (graph ? buildFlowNodes(graph, selectedNodeId) : []), [graph, selectedNodeId]);
  const flowEdges = useMemo(() => (graph ? buildFlowEdges(graph) : []), [graph]);
  const selectedNode = graph?.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const mentions = selectedNode
    ? [...selectedNode.mentions].sort((first, second) => {
        if (first.documentPath === graph?.documentPath && second.documentPath !== graph?.documentPath) return -1;
        if (second.documentPath === graph?.documentPath && first.documentPath !== graph?.documentPath) return 1;
        return second.updatedAt - first.updatedAt;
      })
    : [];

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
          {deleteConfirming ? (
            <span className="flex items-center gap-1 rounded-full bg-red-300/10 px-1.5 py-1 text-xs text-red-100">
              <span className="px-1">Delete graph?</span>
              <button
                type="button"
                className="rounded-full px-2 py-1 text-white/45 transition hover:bg-white/[0.08] hover:text-white/85"
                onClick={() => setDeleteConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-full bg-red-200/90 px-2 py-1 font-medium text-red-950 transition hover:bg-red-100 disabled:opacity-45"
                disabled={isDeleting}
                onClick={() => {
                  setDeleteConfirming(false);
                  onDeleteGraph();
                }}
              >
                Delete
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/48 transition hover:bg-white/[0.08] hover:text-white/85 disabled:text-white/20"
              disabled={isLoading || isDeleting || !graph?.extractedAt}
              onClick={() => setDeleteConfirming(true)}
              aria-label="Delete graph"
            >
              <TrashIcon size={16} />
            </button>
          )}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/48 transition hover:bg-white/[0.08] hover:text-white/85 disabled:text-white/20"
            disabled={isLoading || isDeleting}
            onClick={onRefresh}
            aria-label="Refresh graph"
          >
            <ArrowsClockwiseIcon size={17} className={isLoading ? "animate-spin" : ""} />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/48 transition hover:bg-white/[0.08] hover:text-white/85"
            onClick={onClose}
            aria-label="Close graph"
          >
            <XIcon size={16} />
          </button>
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
              onNodeClick={(_event, node) => setSelectedNodeId(Number(node.id))}
              onPaneClick={() => setSelectedNodeId(null)}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="rgba(255,255,255,0.06)" gap={24} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(node) =>
                  graph.nodes.find((concept) => String(concept.id) === node.id)?.inCurrentDocument
                    ? "rgba(200,236,186,0.65)"
                    : "rgba(255,255,255,0.22)"
                }
                maskColor="rgba(0,0,0,0.35)"
              />
              <Controls position="bottom-left" />
            </ReactFlow>

            {selectedNode && (
              <aside className="absolute bottom-4 right-4 top-4 flex w-[360px] max-w-[calc(100%-2rem)] flex-col rounded-2xl bg-[#151515]/86 shadow-[0_20px_70px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.08] backdrop-blur-[20px]">
                <div className="shrink-0 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-white/38">Selected Concept</p>
                  <p className="mt-1 text-lg font-semibold text-white/90">{selectedNode.name}</p>
                  {selectedNode.summary && <p className="mt-2 text-sm leading-6 text-white/58">{selectedNode.summary}</p>}
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
                  {mentions.length > 0 ? (
                    <div className="space-y-2">
                      {mentions.map((mention, index) => (
                        <GraphMention
                          key={`${mention.documentPath}-${mention.updatedAt}-${index}`}
                          mention={mention}
                          onOpenDocument={onOpenDocument}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="px-1 text-sm text-white/42">No note excerpts are linked to this concept yet.</p>
                  )}
                </div>
              </aside>
            )}
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/45">No graph extracted yet.</div>
        )}
      </div>
    </section>
  );
}
