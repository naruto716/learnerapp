import dagre from "@dagrejs/dagre";

export const graphNodeWidth = 180;
export const graphNodeHeight = 58;

export type GraphNodePosition = {
  x: number;
  y: number;
};

export async function layoutKnowledgeGraph(graph: KnowledgeDocumentGraph) {
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

  return new Map<number, GraphNodePosition>(
    graph.nodes.map((node) => [
      Number(node.id),
      {
        x: (dagreGraph.node(String(node.id))?.x ?? 0) - graphNodeWidth / 2,
        y: (dagreGraph.node(String(node.id))?.y ?? 0) - graphNodeHeight / 2,
      },
    ]),
  );
}
