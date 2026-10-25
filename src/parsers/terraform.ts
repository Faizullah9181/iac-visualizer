import { categorize } from '../core/categories';
import { humanizeTfType } from '../core/humanize';
import type { Diagnostic, GEdge, GNode, Graph, ParseResult } from '../core/types';
import { pushEdge } from '../core/types';
import { findCycle } from './cloudformation';
import { allAttrs, HclError, parseHcl, type HclAttr, type HclBlock } from './hcl';

const clip = (s: string, n = 90) => (s.length > n ? s.slice(0, n - 1) + '…' : s).replace(/\s+/g, ' ');

const REF_PATTERNS: { re: RegExp; to: (m: RegExpMatchArray) => string; kind: string }[] = [
  { re: /(?<![\w.])var\.([A-Za-z_][\w-]*)/g, to: (m) => `var.${m[1]}`, kind: 'variable' },
  { re: /(?<![\w.])local\.([A-Za-z_][\w-]*)/g, to: (m) => `local.${m[1]}`, kind: 'local' },
  { re: /(?<![\w.])module\.([A-Za-z_][\w-]*)/g, to: (m) => `module.${m[1]}`, kind: 'module' },
  { re: /(?<![\w.])data\.([A-Za-z_][\w-]*)\.([A-Za-z_][\w-]*)/g, to: (m) => `data.${m[1]}.${m[2]}`, kind: 'data source' },
  { re: /(?<![\w.])([a-z][a-z0-9]*_[a-z0-9_]+)\.([A-Za-z_][\w-]*)/g, to: (m) => `${m[1]}.${m[2]}`, kind: 'resource' },
];

/** All reference targets mentioned in an expression. Resource matches are filtered by the caller. */
export function refsIn(text: string): { id: string; kind: string }[] {
  const out: { id: string; kind: string }[] = [];
  for (const { re, to, kind } of REF_PATTERNS) for (const m of text.matchAll(re)) out.push({ id: to(m), kind });
  return out;
}

export function parseTerraform(text: string): ParseResult {
  let root: HclBlock;
  try {
    root = parseHcl(text);
  } catch (e) {
    if (e instanceof HclError) return { graph: null, error: { severity: 'error', message: e.message, line: e.line } };
    throw e;
  }
  return { graph: buildTerraform(root) };
}

interface Decl {
  node: GNode;
  /** Attributes whose expressions may reference other declarations. */
  attrs: HclAttr[];
}

export function buildTerraform(root: HclBlock): Graph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const decls = new Map<string, Decl>();

  const declare = (node: GNode, attrs: HclAttr[]) => {
    if (decls.has(node.id)) {
      diagnostics.push({ severity: 'error', message: `Duplicate declaration "${node.id}"`, line: node.line });
      return;
    }
    nodes.push(node);
    decls.set(node.id, { node, attrs });
  };
  const metaOf = (b: HclBlock): [string, string][] => [
    ...b.attrs.map((a): [string, string] => [a.name, clip(a.raw)]),
    ...b.blocks.map((nb): [string, string] => [nb.type, `{ ${nb.attrs.length} attrs }`]),
  ];
  const need = (b: HclBlock, n: number) => {
    if (b.labels.length !== n) {
      diagnostics.push({
        severity: 'error',
        message: `"${b.type}" block needs ${n} label${n > 1 ? 's' : ''}, got ${b.labels.length}`,
        line: b.line,
      });
      return false;
    }
    return true;
  };

  for (const b of root.blocks) {
    const base = { line: b.line, endLine: b.endLine, meta: metaOf(b) };
    switch (b.type) {
      case 'resource': {
        if (!need(b, 2)) break;
        const [type, name] = b.labels;
        const provider = type.split('_')[0];
        declare(
          // Names like "web"/"main"/"this" repeat across types, so the type leads and the address disambiguates.
          { id: `${type}.${name}`, label: humanizeTfType(type), sub: `${type}.${name}`, type: `${type}.${name}`, kind: 'resource', tag: provider, category: categorize(type), ...base },
          allAttrs(b),
        );
        break;
      }
      case 'data': {
        if (!need(b, 2)) break;
        const [type, name] = b.labels;
        declare(
          { id: `data.${type}.${name}`, label: humanizeTfType(type), sub: `data.${type}.${name}`, type: `data.${type}.${name}`, kind: 'data', tag: 'data', category: categorize(type), ...base },
          allAttrs(b),
        );
        break;
      }
      case 'variable': {
        if (!need(b, 1)) break;
        const type = b.attrs.find((a) => a.name === 'type')?.raw;
        declare({ id: `var.${b.labels[0]}`, label: b.labels[0], sub: type ?? 'any', kind: 'variable', ...base }, allAttrs(b).filter((a) => a.name === 'default'));
        break;
      }
      case 'output': {
        if (!need(b, 1)) break;
        declare({ id: `output.${b.labels[0]}`, label: b.labels[0], sub: 'output', kind: 'output', ...base }, allAttrs(b));
        break;
      }
      case 'module': {
        if (!need(b, 1)) break;
        const source = b.attrs.find((a) => a.name === 'source')?.raw.replace(/^"|"$/g, '');
        declare(
          { id: `module.${b.labels[0]}`, label: b.labels[0], sub: source ?? 'module', type: `module.${b.labels[0]}`, kind: 'module', tag: 'module', category: categorize(`${source ?? ''} ${b.labels[0]}`), ...base },
          allAttrs(b),
        );
        break;
      }
      case 'locals': {
        for (const a of b.attrs)
          declare({ id: `local.${a.name}`, label: a.name, sub: clip(a.raw, 36), kind: 'local', line: a.line, endLine: a.endLine, meta: [['value', clip(a.raw, 200)]] }, [a]);
        break;
      }
      case 'provider': {
        if (!need(b, 1)) break;
        const alias = b.attrs.find((a) => a.name === 'alias')?.raw.replace(/^"|"$/g, '');
        const id = alias ? `provider.${b.labels[0]}.${alias}` : `provider.${b.labels[0]}`;
        declare({ id, label: alias ? `${b.labels[0]}.${alias}` : b.labels[0], sub: 'provider', kind: 'provider', tag: b.labels[0], ...base }, allAttrs(b));
        break;
      }
      case 'terraform':
      case 'moved':
      case 'import':
      case 'check':
      case 'removed':
        break;
      default:
        diagnostics.push({ severity: 'warning', message: `Unknown top-level block "${b.type}"`, line: b.line });
    }
  }

  const referenced = new Set<string>();
  for (const { node, attrs } of decls.values()) {
    for (const a of attrs) {
      const kind = a.name === 'depends_on' ? 'depends' : 'ref';
      if (a.name === 'provider' && (node.kind === 'resource' || node.kind === 'data')) {
        const pid = `provider.${a.refText.trim()}`;
        if (decls.has(pid)) {
          referenced.add(pid);
          pushEdge(edges, seen, { source: pid, target: node.id, kind: 'depends' });
        }
        continue;
      }
      for (const ref of refsIn(a.refText)) {
        if (!decls.has(ref.id)) {
          if (ref.kind !== 'resource')
            diagnostics.push({ severity: 'error', message: `${node.id}: reference to undeclared ${ref.kind} "${ref.id}"`, line: a.line });
          continue;
        }
        referenced.add(ref.id);
        pushEdge(edges, seen, { source: ref.id, target: node.id, kind });
      }
    }
  }

  // Implicit default provider for resources that didn't name one.
  for (const n of nodes) {
    if (n.kind !== 'resource' && n.kind !== 'data') continue;
    const prefix = n.id.replace(/^data\./, '').split('_')[0];
    const pid = `provider.${prefix}`;
    const explicit = edges.some((e) => e.target === n.id && e.source.startsWith('provider.'));
    if (!explicit && decls.has(pid)) {
      referenced.add(pid);
      pushEdge(edges, seen, { source: pid, target: n.id, kind: 'depends' });
    }
  }

  for (const n of nodes)
    if ((n.kind === 'variable' || n.kind === 'local') && !referenced.has(n.id))
      diagnostics.push({ severity: 'warning', message: `${n.kind === 'variable' ? 'Variable' : 'Local'} "${n.id}" is declared but never used`, line: n.line });

  const cycle = findCycle(nodes, edges);
  if (cycle)
    diagnostics.push({
      severity: 'error',
      message: `Cycle: ${cycle.join(' → ')}`,
      line: decls.get(cycle[0])?.node.line,
    });

  return { format: 'terraform', nodes, edges, groups: [], diagnostics };
}
