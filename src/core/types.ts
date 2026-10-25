export type Format = 'otel' | 'cloudformation' | 'terraform' | 'ansible';

export const FORMATS: Format[] = ['otel', 'cloudformation', 'terraform', 'ansible'];

export const FORMAT_LABEL: Record<Format, string> = {
  otel: 'OpenTelemetry',
  cloudformation: 'CloudFormation',
  terraform: 'Terraform',
  ansible: 'Ansible',
};

/** Visual family a node belongs to. Drives colour, glyph and legend. */
export type Kind =
  // otel
  | 'receiver'
  | 'processor'
  | 'exporter'
  | 'connector'
  | 'extension'
  // cloudformation
  | 'parameter'
  | 'resource'
  | 'output'
  | 'condition'
  | 'mapping'
  // terraform
  | 'variable'
  | 'local'
  | 'data'
  | 'module'
  | 'provider'
  // ansible
  | 'play'
  | 'role'
  | 'task'
  | 'handler'
  | 'block';

export type Category = 'compute' | 'network' | 'data' | 'security' | 'messaging' | 'observe' | 'other';

export type EdgeKind = 'flow' | 'ref' | 'depends' | 'notify' | 'bridge';

export interface GNode {
  id: string;
  label: string;
  kind: Kind;
  /** Secondary line — component type, resource type, module name. */
  sub?: string;
  /** Raw type or address as written in the source (`AWS::SQS::Queue`, `aws_lb.web`). */
  type?: string;
  /** Short category tag shown as a chip (e.g. "EC2", "aws"). */
  tag?: string;
  /** 1-based line range in the source. */
  line?: number;
  endLine?: number;
  /** Lane/group membership (OTel pipelines, Ansible plays). */
  group?: string;
  /** Cloud service family — tints resource nodes. */
  category?: Category;
  /** Flat key/value details for the inspector. */
  meta?: [string, string][];
}

export interface GEdge {
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  label?: string;
}

export interface GGroup {
  id: string;
  label: string;
  sub?: string;
  line?: number;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  line?: number;
}

export interface Graph {
  format: Format;
  nodes: GNode[];
  edges: GEdge[];
  groups: GGroup[];
  diagnostics: Diagnostic[];
}

export interface ParseResult {
  graph: Graph | null;
  /** Fatal parse error — the graph could not be produced at all. */
  error?: Diagnostic;
}

export const emptyGraph = (format: Format): Graph => ({
  format,
  nodes: [],
  edges: [],
  groups: [],
  diagnostics: [],
});

export function edgeId(source: string, target: string, kind: EdgeKind) {
  return `${kind}:${source}->${target}`;
}

/** Adds an edge unless the same (source, target, kind) is already present. */
export function pushEdge(edges: GEdge[], seen: Set<string>, e: Omit<GEdge, 'id'>) {
  const id = edgeId(e.source, e.target, e.kind);
  if (seen.has(id) || e.source === e.target) return;
  seen.add(id);
  edges.push({ id, ...e });
}
