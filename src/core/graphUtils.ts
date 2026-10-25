import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { Format, GNode, Graph } from './types';

/** Innermost node whose source range contains `line` (a task beats its enclosing play). */
export function nodeAtLine(nodes: GNode[], line: number): GNode | undefined {
  let best: GNode | undefined;
  const span = (n: GNode) => (n.endLine ?? n.line!) - n.line!;
  for (const n of nodes) {
    if (!n.line || line < n.line || line > (n.endLine ?? n.line)) continue;
    if (!best || span(n) < span(best)) best = n;
  }
  return best;
}

export interface Lineage {
  up: Set<string>;
  down: Set<string>;
  edges: Set<string>;
}

/** Everything upstream and downstream of `id`, plus the edges on those paths. */
export function lineage(graph: Graph, id: string): Lineage {
  const out = new Map<string, { to: string; id: string }[]>();
  const inc = new Map<string, { from: string; id: string }[]>();
  for (const e of graph.edges) {
    out.set(e.source, [...(out.get(e.source) ?? []), { to: e.target, id: e.id }]);
    inc.set(e.target, [...(inc.get(e.target) ?? []), { from: e.source, id: e.id }]);
  }
  const edges = new Set<string>();
  const walk = (start: string, next: (n: string) => { node: string; id: string }[]) => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const { node, id: eid } of next(cur)) {
        edges.add(eid);
        if (!seen.has(node) && node !== id) {
          seen.add(node);
          stack.push(node);
        }
      }
    }
    return seen;
  };
  const down = walk(id, (n) => (out.get(n) ?? []).map((x) => ({ node: x.to, id: x.id })));
  const up = walk(id, (n) => (inc.get(n) ?? []).map((x) => ({ node: x.from, id: x.id })));
  return { up, down, edges };
}

export function neighbours(graph: Graph, id: string) {
  return {
    incoming: graph.edges.filter((e) => e.target === id),
    outgoing: graph.edges.filter((e) => e.source === id),
  };
}

const ARROWS = { flow: '-->', ref: '-.->', depends: '==>', notify: '-.->', bridge: '==>' } as const;

/** Graph → Mermaid flowchart source. */
export function toMermaid(graph: Graph, dir: 'LR' | 'TB' = 'LR'): string {
  const safe = new Map<string, string>();
  graph.nodes.forEach((n, i) => safe.set(n.id, `n${i}`));
  const esc = (s: string) => s.replace(/"/g, '#quot;');
  const lines = [`flowchart ${dir}`];
  const byGroup = new Map<string | undefined, typeof graph.nodes>();
  for (const n of graph.nodes) byGroup.set(n.group, [...(byGroup.get(n.group) ?? []), n]);
  for (const [group, members] of byGroup) {
    const g = graph.groups.find((x) => x.id === group);
    if (g) lines.push(`  subgraph ${safe.get(members[0].id)}_g["${esc(g.label)}"]`);
    for (const n of members) lines.push(`${g ? '    ' : '  '}${safe.get(n.id)}["${esc(n.label)}${n.sub ? `<br/><small>${esc(n.sub)}</small>` : ''}"]`);
    if (g) lines.push('  end');
  }
  for (const e of graph.edges) {
    const label = e.label ? `|${esc(e.label)}|` : '';
    lines.push(`  ${safe.get(e.source)} ${ARROWS[e.kind]}${label} ${safe.get(e.target)}`);
  }
  return lines.join('\n');
}

export interface SharePayload {
  text: string;
  mode: Format | 'auto';
}

export function encodeShare(p: SharePayload) {
  return compressToEncodedURIComponent(JSON.stringify({ t: p.text, m: p.mode }));
}

export function decodeShare(hash: string): SharePayload | null {
  const m = /[#&]s=([^&]+)/.exec(hash);
  if (!m) return null;
  try {
    const raw = decompressFromEncodedURIComponent(m[1]);
    if (!raw) return null;
    const j = JSON.parse(raw) as { t?: unknown; m?: unknown };
    if (typeof j.t !== 'string') return null;
    const mode = (['auto', 'otel', 'cloudformation', 'terraform', 'ansible'] as const).find((x) => x === j.m) ?? 'auto';
    return { text: j.t, mode };
  } catch {
    return null;
  }
}
