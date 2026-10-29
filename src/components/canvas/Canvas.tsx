import {
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  getViewportForBounds,
  useNodesState,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import { toPng } from 'html-to-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { lineage } from '../../core/graphUtils';
import { useStore } from '../../core/store';
import type { Graph } from '../../core/types';
import { visualFor } from '../../core/visual';
import { layoutGraph, zoneOf, type FlowNode, type SchemaNodeData } from '../../layout/layout';
import { HighlightContext, type Highlight } from './highlight';
import { Overlays } from './Overlays';
import { LaneNode, SchemaNode } from './SchemaNode';
import { SchemaEdge } from './SchemaEdge';

const nodeTypes = { schema: SchemaNode, lane: LaneNode };
const edgeTypes = { schema: SchemaEdge };

function filterGraph(graph: Graph, hidden: string[]): Graph {
  if (!hidden.length) return graph;
  const nodes = graph.nodes.filter((n) => !hidden.includes(n.kind));
  const keep = new Set(nodes.map((n) => n.id));
  return { ...graph, nodes, edges: graph.edges.filter((e) => keep.has(e.source) && keep.has(e.target)) };
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** Canvas width, bucketed into what the layout cares about. */
function useCanvasSize() {
  const [size, setSize] = useState({ w: 1200, h: 800 });
  useEffect(() => {
    const el = document.querySelector<HTMLElement>('.canvas');
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Narrow canvases wrap lanes into as many columns as fit at a readable (~0.88) zoom.
  const narrow = size.w < 820;
  const maxCols = narrow ? Math.max(1, Math.floor((size.w / 0.88 - 24 + 56) / (228 + 56))) : 99;
  return { ...size, narrow, maxCols };
}

const canHover = () => window.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? true;

function CanvasInner() {
  const rf = useReactFlow();
  const graph = useStore((s) => s.graph);
  const direction = useStore((s) => s.direction);
  const hiddenKinds = useStore((s) => s.hiddenKinds);
  const selectedId = useStore((s) => s.selectedId);
  const hoveredId = useStore((s) => s.hoveredId);
  const cursorId = useStore((s) => s.cursorId);
  const focus = useStore((s) => s.focus);
  const fit = useStore((s) => s.fit);
  const exportReq = useStore((s) => s.exportReq);
  const set = useStore((s) => s.set);
  const select = useStore((s) => s.select);
  const notify = useStore((s) => s.notify);
  const reducedMotion = usePrefersReducedMotion();
  const canvas = useCanvasSize();
  const narrowRef = useRef(canvas.narrow);
  narrowRef.current = canvas.narrow;

  const view = useMemo(() => (graph ? filterGraph(graph, hiddenKinds) : null), [graph, hiddenKinds]);
  const { narrow, maxCols } = canvas;
  const layout = useMemo(
    () => (view ? layoutGraph(view, direction, { narrow, maxCols }) : { nodes: [], edges: [] }),
    [view, direction, narrow, maxCols],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(layout.nodes);
  useEffect(() => setNodes(layout.nodes), [layout, setNodes]);

  // Track which nodes are new since the previous parse so they can bloom in.
  const prevIds = useRef<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const signature = layout.nodes.map((n) => n.id).join('|');
  useEffect(() => {
    const ids = new Set(layout.nodes.map((n) => n.id));
    const prev = prevIds.current;
    const added = prev.size ? [...ids].filter((id) => !prev.has(id)) : [];
    prevIds.current = ids;
    if (added.length) {
      setFresh(new Set(added));
      const t = setTimeout(() => setFresh(new Set()), 1400);
      return () => clearTimeout(t);
    }
  }, [signature]);

  /**
   * Fit the graph — unless that would shrink labels below legibility. Then hold a readable
   * zoom and anchor at the top-left (inputs + first column), leaving the rest to pan/minimap.
   */
  const frame = useCallback(() => {
    const all = rf.getNodes();
    const el = document.querySelector<HTMLElement>('.canvas .react-flow');
    if (!all.length || !el) return;
    const b = rf.getNodesBounds(all);
    const W = el.clientWidth;
    const pad = W < 520 ? 14 : 32;
    const top = 64; // clear the HUD
    const zoomW = (W - pad * 2) / b.width;
    const fitZoom = Math.min(zoomW, (el.clientHeight - top - pad) / b.height);
    const MIN = 0.6;
    if (fitZoom >= MIN) {
      void rf.fitView({ padding: 0.14, duration: 650, maxZoom: 1.1 });
      return;
    }
    // Too tall/wide to fit legibly: on narrow canvases fit the width and scroll down like a
    // page; elsewhere hold a readable zoom anchored at the top-left.
    const z = narrowRef.current ? Math.min(1.1, Math.max(MIN, zoomW)) : MIN;
    const x = b.width * z < W - pad * 2 ? (W - b.width * z) / 2 - b.x * z : pad - b.x * z;
    void rf.setViewport({ x, y: top - b.y * z, zoom: z }, { duration: 650 });
  }, [rf]);

  // Re-frame when the graph's structure (or direction) changes — not on every keystroke.
  useEffect(() => {
    if (!layout.nodes.length) return;
    const t = setTimeout(frame, 60);
    return () => clearTimeout(t);
  }, [signature, direction, narrow, maxCols]);

  useEffect(() => {
    if (fit) frame();
  }, [fit, frame]);

  useEffect(() => {
    if (!focus) return;
    const n = rf.getInternalNode(focus.id);
    if (!n) return;
    const { x, y } = n.internals.positionAbsolute;
    const zoom = Math.max(rf.getZoom(), narrowRef.current ? 0.9 : 1.05);
    // On narrow canvases the inspector is a bottom sheet: centre the node in the space above it.
    const sheet = narrowRef.current && useStore.getState().selectedId ? (document.querySelector('.canvas')!.clientHeight * 0.3) / zoom : 0;
    void rf.setCenter(x + (n.measured.width ?? 0) / 2, y + (n.measured.height ?? 0) / 2 + sheet, { zoom, duration: 700 });
  }, [focus, rf]);

  useEffect(() => {
    if (!exportReq) return;
    const el = document.querySelector<HTMLElement>('.react-flow__viewport');
    if (!el || !layout.nodes.length) return;
    const pad = 64;
    const bounds = rf.getNodesBounds(rf.getNodes());
    const width = Math.min(4096, Math.round(bounds.width + pad * 2));
    const height = Math.min(4096, Math.round(bounds.height + pad * 2));
    const vp = getViewportForBounds(bounds, width, height, 0.2, 2, 0);
    toPng(el, {
      backgroundColor: '#08080a',
      width,
      height,
      pixelRatio: 2,
      style: { width: `${width}px`, height: `${height}px`, transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})` },
    })
      .then((url) => {
        const a = document.createElement('a');
        a.download = `kachua-${graph?.format ?? 'graph'}.png`;
        a.href = url;
        a.click();
        notify('PNG exported');
      })
      .catch(() => notify('Export failed', 'err'));
  }, [exportReq]);

  const focusId = hoveredId ?? selectedId ?? cursorId;
  const highlight = useMemo<Highlight>(() => {
    if (!focusId || !view || !view.nodes.some((n) => n.id === focusId))
      return { active: false, focusId: null, lit: new Set(), edges: new Set(), fresh, reducedMotion };
    const l = lineage(view, focusId);
    const focusNode = view.nodes.find((n) => n.id === focusId)!;
    const infra = view.format === 'cloudformation' || view.format === 'terraform';
    if (infra && zoneOf(focusNode) !== 'inputs' && zoneOf(focusNode) !== 'outputs') {
      // A resource shows its full resource lineage, but only its *direct* inputs/outputs —
      // transitive var → local → provider chains just tangle the chip rows.
      const byId = new Map(view.nodes.map((n) => [n.id, n]));
      const edge = new Map(view.edges.map((e) => [e.id, e]));
      const chip = (id: string) => ['inputs', 'outputs'].includes(zoneOf(byId.get(id)!));
      const edges = new Set([...l.edges].filter((id) => {
        const e = edge.get(id)!;
        return e.source === focusId || e.target === focusId || (!chip(e.source) && !chip(e.target));
      }));
      const lit = new Set([focusId]);
      for (const id of edges) {
        lit.add(edge.get(id)!.source);
        lit.add(edge.get(id)!.target);
      }
      return { active: true, focusId, lit, edges, fresh, reducedMotion };
    }
    return { active: true, focusId, lit: new Set([focusId, ...l.up, ...l.down]), edges: l.edges, fresh, reducedMotion };
  }, [focusId, view, fresh, reducedMotion]);

  const onNodeClick: NodeMouseHandler<FlowNode> = (_, n) => {
    if (n.type !== 'schema') return;
    select(n.id, { reveal: true, focus: narrowRef.current });
  };

  return (
    <HighlightContext.Provider value={highlight}>
      <ReactFlow<FlowNode>
        nodes={nodes}
        edges={layout.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick}
        // Touch screens fire emulated mouseenter on tap and never leave: hover is mouse-only.
        onNodeMouseEnter={(_, n) => n.type === 'schema' && canHover() && set({ hoveredId: n.id })}
        onNodeMouseLeave={() => set({ hoveredId: null })}
        onPaneClick={() => {
          select(null);
          set({ hoveredId: null });
        }}
        nodesConnectable={false}
        edgesFocusable={false}
        minZoom={0.15}
        zoomOnDoubleClick={false}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        className={reducedMotion ? 'reduced-motion' : ''}
      >
        <Background id="dots" variant={BackgroundVariant.Dots} gap={22} size={1.1} color="rgba(255,255,255,0.075)" />
        <Background id="grid" variant={BackgroundVariant.Lines} gap={176} lineWidth={1} color="rgba(255,255,255,0.025)" />
        <MiniMap
          className="minimap"
          pannable
          zoomable
          nodeBorderRadius={6}
          maskColor="rgba(8,8,10,0.78)"
          nodeColor={(n) => {
            if (n.type !== 'schema') return 'rgba(255,255,255,0.04)';
            const d = n.data as SchemaNodeData;
            return visualFor(d.node.kind, d.node.category).color;
          }}
          nodeStrokeWidth={0}
          style={{ width: 168, height: 112 }}
        />
      </ReactFlow>
      <Overlays />
    </HighlightContext.Provider>
  );
}

export function Canvas() {
  return (
    <ReactFlowProvider>
      <div className="canvas" data-testid="canvas">
        <div className="canvas-glow" aria-hidden />
        <CanvasInner />
      </div>
    </ReactFlowProvider>
  );
}
