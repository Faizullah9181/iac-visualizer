import { categorize } from '../core/categories';
import { humanizeCfnType } from '../core/humanize';
import type { Diagnostic, GEdge, GNode, Graph, Kind, ParseResult } from '../core/types';
import { pushEdge } from '../core/types';
import { entries, get, isMap, isScalar, isSeq, parseYaml, preview, str, strList, type YamlSource } from './yamlDoc';

interface Ref {
  name: string;
  line?: number;
  via: 'Ref' | 'GetAtt' | 'Sub' | 'FindInMap' | 'If' | 'Condition';
}

const SUB_VAR = /\$\{([^}!][^}]*)\}/g;

/** Collects every intrinsic-function reference beneath a node. */
export function collectRefs(node: unknown, src: YamlSource, out: Ref[] = []): Ref[] {
  if (!node || typeof node !== 'object') return out;
  const line = src.lineOf(node);
  const tag = (node as { tag?: string }).tag;

  const subRefs = (template: string | undefined, locals: Set<string>) => {
    if (!template) return;
    for (const m of template.matchAll(SUB_VAR)) {
      const name = m[1].split('.')[0].trim();
      if (!locals.has(name)) out.push({ name, line, via: 'Sub' });
    }
  };
  const localsOf = (n: unknown) => new Set(entries(n).map(([k]) => k));

  if (isScalar(node)) {
    const v = str(node);
    if (tag === '!Ref' && v) out.push({ name: v, line, via: 'Ref' });
    else if (tag === '!GetAtt' && v) out.push({ name: v.split('.')[0], line, via: 'GetAtt' });
    else if (tag === '!Sub') subRefs(v, new Set());
    else if (tag === '!Condition' && v) out.push({ name: v, line, via: 'Condition' });
    return out;
  }

  if (isSeq(node)) {
    const items = node.items;
    if (tag === '!GetAtt') {
      const first = str(items[0]);
      if (first) out.push({ name: first.split('.')[0], line, via: 'GetAtt' });
    } else if (tag === '!Sub') {
      subRefs(str(items[0]), localsOf(items[1]));
      if (items[1]) collectRefs(items[1], src, out);
      return out;
    } else if (tag === '!FindInMap') {
      const first = str(items[0]);
      if (first) out.push({ name: first, line, via: 'FindInMap' });
    } else if (tag === '!If') {
      const first = str(items[0]);
      if (first) out.push({ name: first, line, via: 'If' });
      items.slice(1).forEach((i) => collectRefs(i, src, out));
      return out;
    }
    for (const item of items) collectRefs(item, src, out);
    return out;
  }

  if (isMap(node)) {
    for (const [key, value] of entries(node)) {
      const vLine = src.lineOf(value) ?? line;
      switch (key) {
        case 'Ref': {
          const v = str(value);
          if (v) out.push({ name: v, line: vLine, via: 'Ref' });
          continue;
        }
        case 'Fn::GetAtt': {
          const first = isSeq(value) ? str(value.items[0]) : str(value)?.split('.')[0];
          if (first) out.push({ name: first, line: vLine, via: 'GetAtt' });
          continue;
        }
        case 'Fn::Sub': {
          if (isSeq(value)) {
            subRefs(str(value.items[0]), localsOf(value.items[1]));
            if (value.items[1]) collectRefs(value.items[1], src, out);
          } else subRefs(str(value), new Set());
          continue;
        }
        case 'Fn::FindInMap': {
          const first = isSeq(value) ? str(value.items[0]) : undefined;
          if (first) out.push({ name: first, line: vLine, via: 'FindInMap' });
          if (isSeq(value)) value.items.slice(1).forEach((i) => collectRefs(i, src, out));
          continue;
        }
        case 'Fn::If': {
          const first = isSeq(value) ? str(value.items[0]) : undefined;
          if (first) out.push({ name: first, line: vLine, via: 'If' });
          if (isSeq(value)) value.items.slice(1).forEach((i) => collectRefs(i, src, out));
          continue;
        }
        case 'Condition': {
          // A string is a condition name; a map is an IAM policy Condition block.
          const v = str(value);
          if (v) {
            out.push({ name: v, line: vLine, via: 'Condition' });
            continue;
          }
          break;
        }
      }
      collectRefs(value, src, out);
    }
  }
  return out;
}

export function parseCloudFormation(text: string): ParseResult {
  const parsed = parseYaml(text);
  if (!parsed.ok) return { graph: null, error: parsed.error };
  return { graph: buildCloudFormation(parsed.src) };
}

export function buildCloudFormation(src: YamlSource): Graph {
  const root = src.doc.contents;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  if (!isMap(root)) {
    diagnostics.push({ severity: 'error', message: 'Template must be a mapping', line: 1 });
    return { format: 'cloudformation', nodes, edges, groups: [], diagnostics };
  }

  const ids = new Map<string, Kind>(); // logical name → kind
  const nodeByName = new Map<string, GNode>();
  const add = (n: GNode) => {
    nodes.push(n);
    nodeByName.set(n.label, n);
    ids.set(n.label, n.kind);
  };

  for (const [name, value, pair] of entries(get(root, 'Parameters'))) {
    const type = str(get(value, 'Type')) ?? 'String';
    const meta: [string, string][] = [['Type', type]];
    for (const [k, v] of entries(value)) if (k !== 'Type') meta.push([k, preview(v)]);
    add({ id: `p:${name}`, label: name, kind: 'parameter', sub: type, line: src.lineOf(pair), endLine: src.endLineOf(pair), meta });
  }
  for (const [name, value, pair] of entries(get(root, 'Mappings'))) {
    add({
      id: `m:${name}`,
      label: name,
      kind: 'mapping',
      sub: `${entries(value).length} keys`,
      line: src.lineOf(pair),
      endLine: src.endLineOf(pair),
      meta: entries(value).map(([k, v]) => [k, preview(v)]),
    });
  }
  for (const [name, value, pair] of entries(get(root, 'Conditions'))) {
    add({
      id: `c:${name}`,
      label: name,
      kind: 'condition',
      sub: 'condition',
      line: src.lineOf(pair),
      endLine: src.endLineOf(pair),
      meta: [['expression', preview(value, 140)]],
    });
  }

  const resources = get(root, 'Resources');
  if (!resources || !entries(resources).length)
    diagnostics.push({ severity: 'error', message: 'Template has no `Resources` — CloudFormation requires at least one', line: 1 });

  for (const [name, value, pair] of entries(resources)) {
    const type = str(get(value, 'Type'));
    const line = src.lineOf(pair);
    if (!type) diagnostics.push({ severity: 'error', message: `Resource "${name}" has no Type`, line });
    const parts = (type ?? 'Unknown::Unknown::Unknown').split('::');
    const service = parts[1] ?? 'Custom';
    const short = parts.slice(2).join('::') || parts[parts.length - 1];
    const meta: [string, string][] = [['Type', type ?? '—']];
    for (const [k, v] of entries(get(value, 'Properties'))) meta.push([k, preview(v)]);
    add({
      id: `r:${name}`,
      label: name,
      kind: 'resource',
      sub: humanizeCfnType(short),
      type: type ?? undefined,
      tag: service,
      category: categorize(parts.slice(1).join('::')),
      line,
      endLine: src.endLineOf(pair),
      meta,
    });
  }
  for (const [name, value, pair] of entries(get(root, 'Outputs'))) {
    const exp = get(get(value, 'Export'), 'Name');
    add({
      id: `o:${name}`,
      label: name,
      kind: 'output',
      sub: exp ? 'exported' : 'output',
      line: src.lineOf(pair),
      endLine: src.endLineOf(pair),
      meta: [['Value', preview(get(value, 'Value'))], ...(exp ? ([['Export', preview(exp)]] as [string, string][]) : [])],
    });
  }

  const referenced = new Set<string>();
  const wire = (fromNode: GNode, value: unknown) => {
    for (const ref of collectRefs(value, src)) {
      if (ref.name.startsWith('AWS::')) continue;
      const target = nodeByName.get(ref.name);
      if (!target) {
        diagnostics.push({
          severity: 'error',
          message: `${fromNode.label}: unresolved ${ref.via} "${ref.name}"`,
          line: ref.line,
        });
        continue;
      }
      referenced.add(ref.name);
      pushEdge(edges, seen, {
        source: target.id,
        target: fromNode.id,
        kind: 'ref',
        label: ref.via === 'Ref' ? undefined : ref.via,
      });
    }
  };

  for (const [name, value] of entries(get(root, 'Conditions'))) wire(nodeByName.get(name)!, value);
  for (const [name, value] of entries(resources)) {
    const node = nodeByName.get(name)!;
    for (const [k, v] of entries(value)) {
      if (k === 'DependsOn') {
        for (const dep of strList(v)) {
          if (!nodeByName.has(dep) || ids.get(dep) !== 'resource') {
            diagnostics.push({ severity: 'error', message: `${name}: DependsOn unknown resource "${dep}"`, line: src.lineOf(v) });
            continue;
          }
          referenced.add(dep);
          pushEdge(edges, seen, { source: `r:${dep}`, target: node.id, kind: 'depends', label: 'DependsOn' });
        }
      } else if (k !== 'Type' && k !== 'Condition') wire(node, v);
      if (k === 'Condition') {
        const c = str(v);
        if (c && nodeByName.has(c)) {
          referenced.add(c);
          pushEdge(edges, seen, { source: `c:${c}`, target: node.id, kind: 'ref', label: 'Condition' });
        } else if (c)
          diagnostics.push({ severity: 'error', message: `${name}: unknown Condition "${c}"`, line: src.lineOf(v) });
      }
    }
  }
  for (const [name, value] of entries(get(root, 'Outputs'))) wire(nodeByName.get(name)!, value);

  for (const n of nodes)
    if (n.kind === 'parameter' && !referenced.has(n.label))
      diagnostics.push({ severity: 'warning', message: `Parameter "${n.label}" is never referenced`, line: n.line });

  const cycle = findCycle(nodes, edges);
  if (cycle)
    diagnostics.push({
      severity: 'error',
      message: `Circular dependency: ${cycle.map((id) => id.slice(2)).join(' → ')}`,
      line: nodes.find((n) => n.id === cycle[0])?.line,
    });

  return { format: 'cloudformation', nodes, edges, groups: [], diagnostics };
}

/** Returns one cycle as a list of node ids, or null. Shared with Terraform. */
export function findCycle(nodes: GNode[], edges: GEdge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const e of edges) adj.set(e.source, [...(adj.get(e.source) ?? []), e.target]);
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const dfs = (id: string): string[] | null => {
    state.set(id, 1);
    stack.push(id);
    for (const next of adj.get(id) ?? []) {
      if (state.get(next) === 1) return [...stack.slice(stack.indexOf(next)), next];
      if (!state.has(next)) {
        const c = dfs(next);
        if (c) return c;
      }
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  for (const n of nodes) if (!state.has(n.id)) {
    const c = dfs(n.id);
    if (c) return c;
  }
  return null;
}
