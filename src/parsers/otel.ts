import type { Diagnostic, GEdge, GGroup, GNode, Kind, ParseResult } from '../core/types';
import { pushEdge } from '../core/types';
import { entries, get, getPair, isMap, parseYaml, preview, strList, type YamlSource } from './yamlDoc';

type Section = 'receivers' | 'processors' | 'exporters' | 'connectors' | 'extensions';
const SECTIONS: Section[] = ['receivers', 'processors', 'exporters', 'connectors', 'extensions'];

interface Declared {
  name: string;
  section: Section;
  line?: number;
  endLine?: number;
  meta: [string, string][];
}

/** `otlp/2` → `otlp`. */
const typeOf = (name: string) => name.split('/')[0];

export const otelNodeId = (pipeline: string, role: string, name: string) => `${pipeline}::${role}::${name}`;

export function parseOtel(text: string): ParseResult {
  const parsed = parseYaml(text);
  if (!parsed.ok) return { graph: null, error: parsed.error };
  return { graph: buildOtel(parsed.src) };
}

export function buildOtel(src: YamlSource) {
  const root = src.doc.contents;
  const diagnostics: Diagnostic[] = [];
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const groups: GGroup[] = [];
  const seen = new Set<string>();

  if (!isMap(root)) {
    diagnostics.push({ severity: 'error', message: 'Collector config must be a mapping', line: 1 });
    return { format: 'otel' as const, nodes, edges, groups, diagnostics };
  }

  // 1. Declared components per section.
  const declared = new Map<string, Declared>(); // key: section/name
  for (const section of SECTIONS) {
    const sec = get(root, section);
    for (const [name, value, pair] of entries(sec)) {
      const meta: [string, string][] = [['type', typeOf(name)]];
      for (const [k, v] of entries(value)) meta.push([k, preview(v)]);
      declared.set(`${section}/${name}`, {
        name,
        section,
        line: src.lineOf(pair),
        endLine: src.endLineOf(pair),
        meta,
      });
    }
  }

  const service = get(root, 'service');
  if (!service) {
    diagnostics.push({ severity: 'error', message: 'Missing `service` section — nothing is wired up', line: 1 });
  }
  const pipelinesNode = get(service, 'pipelines');
  const used = new Set<string>();

  // connector name → pipelines where it is an exporter / a receiver
  const connectorOut = new Map<string, string[]>();
  const connectorIn = new Map<string, string[]>();

  for (const [pipeline, pnode, ppair] of entries(pipelinesNode)) {
    const signal = typeOf(pipeline);
    if (!['traces', 'metrics', 'logs', 'profiles'].includes(signal)) {
      diagnostics.push({
        severity: 'error',
        message: `Pipeline "${pipeline}" has unknown signal "${signal}" (expected traces, metrics, logs)`,
        line: src.lineOf(ppair),
      });
    }
    groups.push({ id: pipeline, label: pipeline, sub: signal, line: src.lineOf(ppair) });

    const roleList = (role: 'receivers' | 'processors' | 'exporters') => {
      const n = get(pnode, role);
      return { names: strList(n), line: src.lineOf(getPair(pnode, role)) };
    };
    const recv = roleList('receivers');
    const proc = roleList('processors');
    const exp = roleList('exporters');

    if (!recv.names.length)
      diagnostics.push({ severity: 'error', message: `Pipeline "${pipeline}" has no receivers`, line: src.lineOf(ppair) });
    if (!exp.names.length)
      diagnostics.push({ severity: 'error', message: `Pipeline "${pipeline}" has no exporters`, line: src.lineOf(ppair) });

    const addNode = (role: 'receivers' | 'processors' | 'exporters', name: string, roleLine?: number) => {
      // A connector may appear as receiver/exporter in pipelines.
      const asConnector = role !== 'processors' && declared.has(`connectors/${name}`);
      const section: Section = asConnector ? 'connectors' : role;
      const decl = declared.get(`${section}/${name}`);
      if (!decl) {
        diagnostics.push({
          severity: 'error',
          message: `${singular(role)} "${name}" used in pipeline "${pipeline}" is not defined in \`${role}\``,
          line: roleLine,
        });
      } else used.add(`${section}/${name}`);
      if (asConnector) {
        const map = role === 'exporters' ? connectorOut : connectorIn;
        map.set(name, [...(map.get(name) ?? []), pipeline]);
      }
      const kind: Kind = asConnector ? 'connector' : (singular(role).toLowerCase() as Kind);
      const id = otelNodeId(pipeline, role, name);
      nodes.push({
        id,
        label: name,
        kind,
        sub: typeOf(name),
        tag: asConnector ? `connector · ${role === 'exporters' ? 'out' : 'in'}` : undefined,
        line: decl?.line ?? roleLine,
        endLine: decl?.endLine,
        group: pipeline,
        meta: [['pipeline', pipeline], ['role', singular(role).toLowerCase()], ...(decl?.meta ?? [])],
      });
      return id;
    };

    const rIds = recv.names.map((n) => addNode('receivers', n, recv.line));
    const pIds = proc.names.map((n) => addNode('processors', n, proc.line));
    const eIds = exp.names.map((n) => addNode('exporters', n, exp.line));

    // Wire: receivers → p1 → p2 … → exporters
    const chain: string[][] = [rIds, ...pIds.map((p) => [p]), eIds];
    for (let i = 0; i < chain.length - 1; i++) {
      for (const a of chain[i]) for (const b of chain[i + 1]) pushEdge(edges, seen, { source: a, target: b, kind: 'flow' });
    }

    // Processor-order hints, as the collector docs recommend.
    const p = proc.names.map(typeOf);
    const ml = p.indexOf('memory_limiter');
    if (ml > 0)
      diagnostics.push({
        severity: 'warning',
        message: `"memory_limiter" should be the first processor in "${pipeline}"`,
        line: proc.line,
      });
    const batch = p.indexOf('batch');
    if (batch !== -1 && p.slice(batch + 1).some((t) => t !== 'batch'))
      diagnostics.push({
        severity: 'info',
        message: `"batch" is usually placed after other processors in "${pipeline}"`,
        line: proc.line,
      });
  }

  // Connectors bridge pipelines: exporter side → receiver side.
  for (const [name, outs] of connectorOut) {
    const ins = connectorIn.get(name) ?? [];
    if (!ins.length)
      diagnostics.push({
        severity: 'error',
        message: `Connector "${name}" is used as an exporter but never as a receiver`,
        line: declared.get(`connectors/${name}`)?.line,
      });
    for (const from of outs)
      for (const to of ins)
        pushEdge(edges, seen, {
          source: otelNodeId(from, 'exporters', name),
          target: otelNodeId(to, 'receivers', name),
          kind: 'bridge',
          label: name,
        });
  }
  for (const [name] of connectorIn)
    if (!connectorOut.has(name))
      diagnostics.push({
        severity: 'error',
        message: `Connector "${name}" is used as a receiver but never as an exporter`,
        line: declared.get(`connectors/${name}`)?.line,
      });

  // Extensions live outside pipelines.
  const enabledExt = strList(get(service, 'extensions'));
  const extLine = src.lineOf(getPair(service, 'extensions'));
  if (enabledExt.length) groups.push({ id: '__extensions', label: 'extensions', sub: 'service', line: extLine });
  for (const name of enabledExt) {
    const decl = declared.get(`extensions/${name}`);
    if (!decl)
      diagnostics.push({ severity: 'error', message: `Extension "${name}" is enabled but not defined`, line: extLine });
    else used.add(`extensions/${name}`);
    nodes.push({
      id: `__extensions::${name}`,
      label: name,
      kind: 'extension',
      sub: typeOf(name),
      line: decl?.line ?? extLine,
      endLine: decl?.endLine,
      group: '__extensions',
      meta: decl?.meta ?? [],
    });
  }

  for (const [key, d] of declared) {
    if (!used.has(key))
      diagnostics.push({
        severity: 'warning',
        message: `${singular(d.section)} "${d.name}" is defined but not used in any pipeline`,
        line: d.line,
      });
  }

  return { format: 'otel' as const, nodes, edges, groups, diagnostics };
}

function singular(s: string) {
  const base = s.endsWith('s') ? s.slice(0, -1) : s;
  return base.charAt(0).toUpperCase() + base.slice(1);
}
