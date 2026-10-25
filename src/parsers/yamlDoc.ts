import {
  Document,
  LineCounter,
  parseAllDocuments,
  isMap,
  isSeq,
  isScalar,
  isPair,
  type Node as YNode,
  type YAMLMap,
} from 'yaml';
import type { Diagnostic } from '../core/types';

export interface YamlSource {
  doc: Document.Parsed;
  lines: LineCounter;
  /** 1-based line of a node's start. */
  lineOf: (node: unknown) => number | undefined;
  /** 1-based line of a node's end. */
  endLineOf: (node: unknown) => number | undefined;
}

export type YamlParse = { ok: true; src: YamlSource } | { ok: false; error: Diagnostic };

/**
 * Parses YAML (or JSON — it is a YAML subset) keeping source positions.
 * Unknown tags such as CloudFormation's `!Ref` are tolerated: their values
 * survive on the AST with `node.tag` set, which the CFN parser reads.
 */
export function parseYaml(text: string): YamlParse {
  const lines = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter: lines, prettyErrors: false, uniqueKeys: false });
  const list = Array.isArray(docs) ? docs : [];
  const doc = list.find((d) => d.contents !== null) ?? list[0];
  if (!doc) {
    return { ok: false, error: { severity: 'error', message: 'Empty document', line: 1 } };
  }
  if (doc.errors.length) {
    const err = doc.errors[0];
    const line = lines.linePos(err.pos[0]).line;
    return { ok: false, error: { severity: 'error', message: cleanYamlMessage(err.message), line } };
  }
  const posLine = (offset: number) => lines.linePos(offset).line;
  const lineOf = (node: unknown) => {
    const r = rangeOf(node);
    return r ? posLine(r[0]) : undefined;
  };
  const endLineOf = (node: unknown) => {
    const r = rangeOf(node);
    if (!r) return undefined;
    // range[1] is the end of the value; step back over trailing newline.
    return posLine(Math.max(r[0], r[1] - 1));
  };
  return { ok: true, src: { doc, lines, lineOf, endLineOf } };
}

function rangeOf(node: unknown): [number, number, number] | undefined {
  if (!node || typeof node !== 'object') return undefined;
  if (isPair(node)) {
    const k = rangeOf(node.key);
    const v = rangeOf(node.value);
    if (k && v) return [k[0], v[1], v[2]];
    return k ?? v;
  }
  const r = (node as { range?: [number, number, number] }).range;
  return r ?? undefined;
}

function cleanYamlMessage(msg: string) {
  return msg.split('\n')[0].replace(/ at line \d+, column \d+.*$/, '');
}

/** String value of a scalar, else undefined. */
export function str(node: unknown): string | undefined {
  if (isScalar(node) && node.value !== null && node.value !== undefined) return String(node.value);
  return undefined;
}

/** Iterate a map's entries as [keyString, valueNode, pair]. */
export function entries(node: unknown): [string, YNode | null, unknown][] {
  if (!isMap(node)) return [];
  return (node as YAMLMap).items.map((p) => [str(p.key) ?? '', (p.value ?? null) as YNode | null, p]);
}

export function get(node: unknown, key: string): YNode | null | undefined {
  if (!isMap(node)) return undefined;
  const pair = (node as YAMLMap).items.find((p) => str(p.key) === key);
  return pair ? ((pair.value ?? null) as YNode | null) : undefined;
}

export function getPair(node: unknown, key: string): unknown {
  if (!isMap(node)) return undefined;
  return (node as YAMLMap).items.find((p) => str(p.key) === key);
}

/** Sequence of strings (or a single string) → string[]. */
export function strList(node: unknown): string[] {
  if (isSeq(node)) return node.items.map(str).filter((s): s is string => s !== undefined);
  const s = str(node);
  return s !== undefined ? [s] : [];
}

/** Compact one-line preview of a value, for the inspector. */
export function preview(node: unknown, max = 80): string {
  let out: string;
  if (isScalar(node)) out = String(node.value);
  else if (node && typeof node === 'object' && 'toJSON' in node) {
    try {
      out = JSON.stringify((node as { toJSON: () => unknown }).toJSON());
    } catch {
      out = '…';
    }
  } else out = String(node ?? '');
  return out.length > max ? out.slice(0, max - 1) + '…' : out;
}

export { isMap, isSeq, isScalar, isPair };
