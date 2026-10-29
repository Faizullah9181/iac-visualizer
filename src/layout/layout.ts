import dagre from '@dagrejs/dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { Category, EdgeKind, GEdge, GGroup, GNode, Graph, Kind } from '../core/types';
import { CATEGORY, visualFor } from '../core/visual';

export type Direction = 'LR' | 'TB';

export const NODE_W = 228;
export const NODE_H = 64;
/** Inputs/outputs render as smaller chips so the resources carry the weight. */
export const CHIP_W = 196;
export const CHIP_H = 46;

export interface SchemaNodeData extends Record<string, unknown> {
  node: GNode;
  dir: Direction;
  /** Stagger index for the entrance animation. */
  order: number;
  issues: number;
  issueSeverity?: 'error' | 'warning' | 'info';
  compact?: boolean;
}

export type Zone = Category | 'inputs' | 'outputs';

export interface LaneNodeData extends Record<string, unknown> {
  group: GGroup;
  count: number;
  /** Set for infra lanes; OTel lanes colour by signal. */
  zone?: Zone;
}

export interface SchemaEdgeData extends Record<string, unknown> {
  kind: EdgeKind;
  label?: string;
  /** Source node's colour — edges carry their provenance. */
  color: string;
  /** Input/output wiring: hidden until a node on its path is focused. */
  quiet?: boolean;
  /** Always draw a smooth curve (no orthogonal detours). */
  bezier?: boolean;
}

export type FlowNode = Node<SchemaNodeData, 'schema'> | Node<LaneNodeData, 'lane'>;
export type FlowEdge = Edge<SchemaEdgeData, 'schema'>;

export const usesLanes = (format: Graph['format']) => format !== 'ansible';

const isInfra = (g: Graph) => g.format === 'cloudformation' || g.format === 'terraform';

export interface LayoutOptions {
  /**
   * The canvas is narrow (phone, tablet, desktop with the editor open): lanes wrap into
   * at most `maxCols` columns and wire vertically, so the graph scrolls down, not sideways.
   */
  narrow?: boolean;
  maxCols?: number;
}

export function layoutGraph(graph: Graph, dir: Direction, opts: LayoutOptions = {}): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const narrow = !!opts.narrow;
  const maxCols = Math.max(1, opts.maxCols ?? 99);
  const issues = issueIndex(graph);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const infra = isInfra(graph);
  const edges: FlowEdge[] = graph.edges.map((e) => {
    const fe = toFlowEdge(e, byId.get(e.source), graph.format === 'ansible' && e.kind === 'ref' ? '#60a5fa' : undefined);
    if (!infra) return fe;
    const from = zoneOf(byId.get(e.source)!);
    const to = zoneOf(byId.get(e.target)!);
    fe.data!.bezier = true;
    if (from === 'inputs' || to === 'outputs') fe.data!.quiet = true;
    if (narrow) Object.assign(fe, { sourceHandle: 'down', targetHandle: 'up' });
    // Chip rows sit above/below the lanes: wire them vertically, not around the lanes.
    if (from === 'inputs' && to !== 'inputs') Object.assign(fe, { sourceHandle: 'down', targetHandle: 'up' });
    if (to === 'outputs' && from !== 'inputs') Object.assign(fe, { sourceHandle: 'down', targetHandle: 'up' });
    return fe;
  });
  const nodes =
    graph.format === 'otel'
      ? narrow
        ? stackedLaneLayout(graph, issues, maxCols)
        : laneLayout(graph, issues)
      : infra
        ? infraLayout(graph, issues, narrow ? maxCols : 99)
        : dagreLayout(graph, dir, issues);
  return { nodes, edges };
}

const EDGE_TINT: Partial<Record<EdgeKind, string>> = { notify: '#facc15', bridge: '#f472b6' };

function toFlowEdge(e: GEdge, source?: GNode, tint?: string): FlowEdge {
  const color = tint ?? EDGE_TINT[e.kind] ?? (source ? visualFor(source.kind, source.category).color : '#a1a1aa');
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: 'out',
    targetHandle: 'in',
    type: 'schema',
    zIndex: e.kind === 'bridge' ? 5 : 0,
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    data: { kind: e.kind, label: e.label, color },
  };
}

/** Node id → worst diagnostic whose line falls in its source range. */
function issueIndex(graph: Graph) {
  const rank = { error: 3, warning: 2, info: 1 } as const;
  const out = new Map<string, { n: number; sev: 'error' | 'warning' | 'info' }>();
  for (const d of graph.diagnostics) {
    if (!d.line) continue;
    for (const n of graph.nodes) {
      if (!n.line || d.line < n.line || d.line > (n.endLine ?? n.line)) continue;
      const cur = out.get(n.id);
      if (!cur) out.set(n.id, { n: 1, sev: d.severity });
      else out.set(n.id, { n: cur.n + 1, sev: rank[d.severity] > rank[cur.sev] ? d.severity : cur.sev });
    }
  }
  return out;
}

function schemaNode(
  n: GNode,
  x: number,
  y: number,
  dir: Direction,
  order: number,
  issues: ReturnType<typeof issueIndex>,
  parentId?: string,
  compact = false,
): FlowNode {
  const iss = issues.get(n.id);
  return {
    id: n.id,
    type: 'schema',
    position: { x, y },
    width: compact ? CHIP_W : NODE_W,
    height: compact ? CHIP_H : NODE_H,
    data: { node: n, dir, order, issues: iss?.n ?? 0, issueSeverity: iss?.sev, compact },
    ...(parentId ? { parentId, extent: 'parent' as const } : {}),
  };
}

function dagreLayout(graph: Graph, dir: Direction, issues: ReturnType<typeof issueIndex>): FlowNode[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: dir, nodesep: dir === 'LR' ? 26 : 36, ranksep: dir === 'LR' ? 96 : 64, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of graph.nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of graph.edges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  // Stagger by rank so the graph "grows" along its flow direction.
  return graph.nodes
    .map((n) => {
      const p = g.node(n.id);
      return { n, x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 };
    })
    .sort((a, b) => (dir === 'LR' ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x))
    .map(({ n, x, y }, i) => schemaNode(n, x, y, dir, i, issues));
}

export const LANE_PAD = 22;
export const LANE_HEAD = 46;
const COL_GAP = 64;
const ROW_GAP = 18;
const LANE_GAP = 40;

/**
 * OTel pipelines as horizontal swim-lanes: receivers | processors… | exporters.
 * Every lane shares the widest lane's width so exporter columns line up.
 */
function laneLayout(graph: Graph, issues: ReturnType<typeof issueIndex>): FlowNode[] {
  const out: FlowNode[] = [];
  const pipelines = graph.groups.filter((g) => g.id !== '__extensions');
  const ext = graph.groups.find((g) => g.id === '__extensions');
  const role = (n: GNode) => n.meta?.find(([k]) => k === 'role')?.[1];

  const cols = Math.max(2, ...pipelines.map((p) => graph.nodes.filter((n) => n.group === p.id && role(n) === 'processor').length + 2));
  const extCount = ext ? graph.nodes.filter((n) => n.group === ext.id).length : 0;
  const laneW = Math.max(cols * NODE_W + (cols - 1) * COL_GAP, extCount * NODE_W + (extCount - 1) * 20) + LANE_PAD * 2;
  const colX = (c: number) => LANE_PAD + c * (NODE_W + COL_GAP);

  let y = 0;
  let order = 0;
  for (const lane of pipelines) {
    const members = graph.nodes.filter((n) => n.group === lane.id);
    const recv = members.filter((n) => role(n) === 'receiver');
    const proc = members.filter((n) => role(n) === 'processor');
    const exp = members.filter((n) => role(n) === 'exporter');
    const rows = Math.max(1, recv.length, exp.length);
    const innerH = rows * NODE_H + (rows - 1) * ROW_GAP;
    const laneH = LANE_HEAD + innerH + LANE_PAD;
    out.push({
      id: `lane:${lane.id}`,
      type: 'lane',
      position: { x: 0, y },
      width: laneW,
      height: laneH,
      style: { width: laneW, height: laneH },
      data: { group: lane, count: members.length },
      selectable: false,
    });
    const stackY = (i: number, n: number) => LANE_HEAD + (innerH - (n * NODE_H + (n - 1) * ROW_GAP)) / 2 + i * (NODE_H + ROW_GAP);
    const children: FlowNode[] = [];
    recv.forEach((n, i) => children.push(schemaNode(n, colX(0), stackY(i, recv.length), 'LR', order++, issues, `lane:${lane.id}`)));
    proc.forEach((n, i) => children.push(schemaNode(n, colX(i + 1), stackY(0, 1), 'LR', order++, issues, `lane:${lane.id}`)));
    exp.forEach((n, i) => children.push(schemaNode(n, colX(cols - 1), stackY(i, exp.length), 'LR', order++, issues, `lane:${lane.id}`)));
    out.push(...children);
    y += laneH + LANE_GAP;
  }

  if (ext) {
    const members = graph.nodes.filter((n) => n.group === ext.id);
    const laneH = LANE_HEAD + NODE_H + LANE_PAD;
    out.push({
      id: `lane:${ext.id}`,
      type: 'lane',
      position: { x: 0, y },
      width: laneW,
      height: laneH,
      style: { width: laneW, height: laneH },
      data: { group: ext, count: members.length },
      selectable: false,
    });
    members.forEach((n, i) => out.push(schemaNode(n, LANE_PAD + i * (NODE_W + 20), LANE_HEAD, 'LR', order++, issues, `lane:${ext.id}`)));
  }
  return out;
}

const S_GAP_X = 20;
const S_GAP_Y = 30;

/**
 * Narrow-canvas OTel: each pipeline flows top → bottom inside its lane —
 * receivers row, processor chain, exporters row — and lanes stack vertically.
 */
function stackedLaneLayout(graph: Graph, issues: ReturnType<typeof issueIndex>, maxCols: number): FlowNode[] {
  const out: FlowNode[] = [];
  const role = (n: GNode) => n.meta?.find(([k]) => k === 'role')?.[1];
  const rowW = (n: number) => n * NODE_W + (n - 1) * S_GAP_X;
  const widest = Math.max(1, ...graph.groups.map((g) => Math.min(maxCols, graph.nodes.filter((n) => n.group === g.id && role(n) !== 'processor').length || 1)));
  const innerW = rowW(Math.min(maxCols, Math.max(widest, 1)));
  const laneW = innerW + LANE_PAD * 2;
  let y = 0;
  let order = 0;

  for (const lane of graph.groups) {
    const members = graph.nodes.filter((n) => n.group === lane.id);
    const parent = `lane:${lane.id}`;
    const children: FlowNode[] = [];
    let cy = LANE_HEAD;
    /** Lays out a wrapped, centred row block; returns its height. */
    const row = (list: GNode[]) => {
      if (!list.length) return;
      const per = Math.min(maxCols, list.length);
      list.forEach((n, i) => {
        const r = Math.floor(i / per);
        const inRow = Math.min(per, list.length - r * per);
        const x = LANE_PAD + (innerW - rowW(inRow)) / 2 + (i % per) * (NODE_W + S_GAP_X);
        children.push(schemaNode(n, x, cy + r * (NODE_H + S_GAP_X), 'TB', order++, issues, parent));
      });
      const rows = Math.ceil(list.length / per);
      cy += rows * NODE_H + (rows - 1) * S_GAP_X + S_GAP_Y;
    };
    if (lane.id === '__extensions') row(members);
    else {
      row(members.filter((n) => role(n) === 'receiver'));
      for (const p of members.filter((n) => role(n) === 'processor')) row([p]);
      row(members.filter((n) => role(n) === 'exporter'));
    }
    const laneH = cy - S_GAP_Y + LANE_PAD;
    out.push({
      id: parent,
      type: 'lane',
      position: { x: 0, y },
      width: laneW,
      height: laneH,
      style: { width: laneW, height: laneH },
      data: { group: lane, count: members.length },
      selectable: false,
    });
    out.push(...children);
    y += laneH + LANE_GAP;
  }
  return out;
}

// ───────────────────────── infra (CloudFormation / Terraform) ─────────────────────────

const INPUT_KINDS = new Set<Kind>(['parameter', 'mapping', 'condition', 'variable', 'local', 'data', 'provider']);
const INPUT_ORDER: Kind[] = ['provider', 'parameter', 'variable', 'local', 'mapping', 'condition', 'data'];
const ZONE_ORDER: Zone[] = ['inputs', 'network', 'security', 'compute', 'data', 'messaging', 'observe', 'other', 'outputs'];

export const ZONE_LABEL: Record<Zone, { label: string; hint: string }> = {
  inputs: { label: 'Inputs', hint: 'parameters, variables, lookups' },
  network: { label: 'Network', hint: 'VPCs, subnets, load balancers, APIs' },
  security: { label: 'Security', hint: 'IAM, security groups, keys' },
  compute: { label: 'Compute', hint: 'instances, functions, containers' },
  data: { label: 'Data', hint: 'databases, buckets, storage' },
  messaging: { label: 'Messaging', hint: 'queues, topics, events' },
  observe: { label: 'Observability', hint: 'logs, metrics, alarms' },
  other: { label: 'Other', hint: 'everything else' },
  outputs: { label: 'Outputs', hint: 'values this stack exposes' },
};

export function zoneOf(n: GNode): Zone {
  if (INPUT_KINDS.has(n.kind)) return 'inputs';
  if (n.kind === 'output') return 'outputs';
  return n.category ?? 'other';
}

const I_COL_GAP = 56;
const I_ROW_GAP = 12;
const I_LANE_GAP = 12;
const I_HEAD = 34;
const I_PAD = 12;
const CHIP_GAP = 12;

/**
 * Architecture view: one horizontal lane per service family, columns by dependency
 * depth (left = built first). Inputs and outputs sit in compact chip rows top and bottom.
 */
function infraLayout(graph: Graph, issues: ReturnType<typeof issueIndex>, maxCols: number): FlowNode[] {
  const core = graph.nodes.filter((n) => zoneOf(n) !== 'inputs' && zoneOf(n) !== 'outputs');
  const coreIds = new Set(core.map((n) => n.id));

  // Longest-path rank over core→core edges (cycles are cut, not fatal).
  const preds = new Map<string, string[]>();
  for (const e of graph.edges)
    if (coreIds.has(e.source) && coreIds.has(e.target)) preds.set(e.target, [...(preds.get(e.target) ?? []), e.source]);
  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const r = Math.max(-1, ...(preds.get(id) ?? []).map(rankOf)) + 1;
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  core.forEach((n) => rankOf(n.id));
  const rankCols = Math.max(1, ...core.map((n) => rank.get(n.id)! + 1));
  // Too many dependency columns for the canvas: wrap each lane, still in dependency order.
  const wrap = rankCols > maxCols;
  const cols = wrap ? maxCols : rankCols;
  const colX = (c: number) => I_PAD + c * (NODE_W + I_COL_GAP);
  const coreW = cols * NODE_W + (cols - 1) * I_COL_GAP;
  const perRow = Math.max(wrap ? 1 : 4, Math.floor((coreW + CHIP_GAP) / (CHIP_W + CHIP_GAP)));
  const laneW = Math.max(coreW, perRow * (CHIP_W + CHIP_GAP) - CHIP_GAP) + I_PAD * 2;

  // Chips line up under/over the column of the resources they touch.
  const touchRank = (n: GNode, dir: 'out' | 'in') => {
    const rs = graph.edges
      .filter((e) => (dir === 'out' ? e.source === n.id : e.target === n.id))
      .map((e) => rank.get(dir === 'out' ? e.target : e.source))
      .filter((r): r is number => r !== undefined);
    return rs.length ? (dir === 'out' ? Math.min(...rs) : Math.max(...rs)) : Infinity;
  };

  const out: FlowNode[] = [];
  let y = 0;
  let order = 0;
  const lane = (zone: Zone, members: GNode[], h: number) => {
    out.push({
      id: `lane:zone:${zone}`,
      type: 'lane',
      position: { x: 0, y },
      width: laneW,
      height: h,
      style: { width: laneW, height: h },
      data: { group: { id: `zone:${zone}`, label: ZONE_LABEL[zone].label, sub: ZONE_LABEL[zone].hint }, count: members.length, zone },
      selectable: false,
    });
  };

  for (const zone of ZONE_ORDER) {
    const members = graph.nodes.filter((n) => zoneOf(n) === zone);
    if (!members.length) continue;
    const parent = `lane:zone:${zone}`;

    if (zone === 'inputs' || zone === 'outputs') {
      const sorted = [...members].sort((a, b) =>
        zone === 'inputs'
          ? touchRank(a, 'out') - touchRank(b, 'out') || INPUT_ORDER.indexOf(a.kind) - INPUT_ORDER.indexOf(b.kind) || (a.line ?? 0) - (b.line ?? 0)
          : touchRank(a, 'in') - touchRank(b, 'in') || (a.line ?? 0) - (b.line ?? 0),
      );
      const rows = Math.ceil(sorted.length / perRow);
      const h = I_HEAD + rows * CHIP_H + (rows - 1) * I_ROW_GAP + I_PAD;
      lane(zone, members, h);
      sorted.forEach((n, i) =>
        out.push(
          schemaNode(n, I_PAD + (i % perRow) * (CHIP_W + CHIP_GAP), I_HEAD + Math.floor(i / perRow) * (CHIP_H + I_ROW_GAP), 'LR', order++, issues, parent, true),
        ),
      );
      y += h + I_LANE_GAP;
      continue;
    }

    if (wrap) {
      const sorted = [...members].sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || (a.line ?? 0) - (b.line ?? 0));
      const rows = Math.ceil(sorted.length / cols);
      const h = I_HEAD + rows * NODE_H + (rows - 1) * I_ROW_GAP + I_PAD;
      lane(zone, members, h);
      sorted.forEach((n, i) =>
        out.push(schemaNode(n, colX(i % cols), I_HEAD + Math.floor(i / cols) * (NODE_H + I_ROW_GAP), 'LR', order++, issues, parent)),
      );
      y += h + I_LANE_GAP;
      continue;
    }

    const cells = new Map<number, GNode[]>();
    for (const n of [...members].sort((a, b) => (a.line ?? 0) - (b.line ?? 0))) {
      const r = rank.get(n.id)!;
      cells.set(r, [...(cells.get(r) ?? []), n]);
    }
    const stack = Math.max(...[...cells.values()].map((c) => c.length));
    const h = I_HEAD + stack * NODE_H + (stack - 1) * I_ROW_GAP + I_PAD;
    lane(zone, members, h);
    for (const [r, cell] of [...cells].sort((a, b) => a[0] - b[0]))
      cell.forEach((n, i) => out.push(schemaNode(n, colX(r), I_HEAD + i * (NODE_H + I_ROW_GAP), 'LR', order++, issues, parent)));
    y += h + I_LANE_GAP;
  }
  return out;
}

export const zoneColor = (zone: Zone) =>
  zone === 'inputs' ? '#94a3b8' : zone === 'outputs' ? '#ff8a3d' : CATEGORY[zone].color;
