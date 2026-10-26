import {
  Antenna, Blocks, Box, Cable, Cloud, Cog, Database, FileOutput, Filter, Globe,
  Layers, ListChecks, MailWarning, Package, PlayCircle, Plug, Puzzle, Radio, Send, Shield, SlidersHorizontal,
  Split, SquareFunction, Table2, Variable, Workflow, Zap, Activity, Cpu, Network, type LucideIcon,
} from 'lucide-react';
import type { Category, Format, Kind } from './types';

export interface KindVisual {
  label: string;
  color: string;
  icon: LucideIcon;
}

export const KIND: Record<Kind, KindVisual> = {
  receiver: { label: 'Receiver', color: '#4ade80', icon: Antenna },
  processor: { label: 'Processor', color: '#a78bfa', icon: Filter },
  exporter: { label: 'Exporter', color: '#ff8a3d', icon: Send },
  connector: { label: 'Connector', color: '#f472b6', icon: Cable },
  extension: { label: 'Extension', color: '#94a3b8', icon: Puzzle },

  parameter: { label: 'Parameter', color: '#60a5fa', icon: SlidersHorizontal },
  resource: { label: 'Resource', color: '#e4e4e7', icon: Box },
  output: { label: 'Output', color: '#ff8a3d', icon: FileOutput },
  condition: { label: 'Condition', color: '#facc15', icon: Split },
  mapping: { label: 'Mapping', color: '#2dd4bf', icon: Table2 },

  variable: { label: 'Variable', color: '#60a5fa', icon: Variable },
  local: { label: 'Local', color: '#2dd4bf', icon: SquareFunction },
  data: { label: 'Data source', color: '#c084fc', icon: Database },
  module: { label: 'Module', color: '#f472b6', icon: Package },
  provider: { label: 'Provider', color: '#94a3b8', icon: Plug },

  play: { label: 'Play', color: '#ff8a3d', icon: PlayCircle },
  role: { label: 'Role', color: '#f472b6', icon: Layers },
  task: { label: 'Task', color: '#e4e4e7', icon: ListChecks },
  block: { label: 'Block', color: '#a78bfa', icon: Blocks },
  handler: { label: 'Handler', color: '#facc15', icon: Zap },
};

export const CATEGORY: Record<Category, KindVisual> = {
  compute: { label: 'Compute', color: '#fb923c', icon: Cpu },
  network: { label: 'Network', color: '#38bdf8', icon: Network },
  data: { label: 'Data', color: '#34d399', icon: Database },
  security: { label: 'Security', color: '#f87171', icon: Shield },
  messaging: { label: 'Messaging', color: '#e879f9', icon: MailWarning },
  observe: { label: 'Observability', color: '#facc15', icon: Activity },
  other: { label: 'Other', color: '#a1a1aa', icon: Cog },
};

export const FORMAT_VISUAL: Record<Format, { short: string; icon: LucideIcon; color: string }> = {
  otel: { short: 'OTel', icon: Radio, color: '#ff8a3d' },
  cloudformation: { short: 'CFN', icon: Cloud, color: '#fbbf24' },
  terraform: { short: 'TF', icon: Globe, color: '#a78bfa' },
  ansible: { short: 'Ansible', icon: Workflow, color: '#f87171' },
};

export const SIGNAL_COLOR: Record<string, string> = {
  traces: '#ff8a3d',
  metrics: '#38bdf8',
  logs: '#4ade80',
  profiles: '#c084fc',
  service: '#94a3b8',
};

/** Colour and icon for a node: resources tint by service family. */
export function visualFor(kind: Kind, category?: Category): KindVisual {
  if ((kind === 'resource' || kind === 'data') && category) {
    const c = CATEGORY[category];
    return { ...KIND[kind], color: c.color, icon: kind === 'data' ? Database : c.icon };
  }
  return KIND[kind];
}

