import type { Format, ParseResult } from '../core/types';
import { isPlaybook, moduleOf, parseAnsible } from './ansible';
import { parseCloudFormation } from './cloudformation';
import { parseOtel } from './otel';
import { parseTerraform } from './terraform';
import { entries, get, isMap, isSeq, parseYaml, str } from './yamlDoc';

const PARSERS: Record<Format, (text: string) => ParseResult> = {
  otel: parseOtel,
  cloudformation: parseCloudFormation,
  terraform: parseTerraform,
  ansible: parseAnsible,
};

export function parse(text: string, format: Format): ParseResult {
  if (!text.trim()) return { graph: null };
  return PARSERS[format](text);
}

const HCL_HINT = /^\s*(resource|data|variable|output|module|provider|locals|terraform)\b[^\n]*\{\s*$/m;
const OTEL_KEYS = ['receivers', 'processors', 'exporters', 'connectors', 'extensions', 'service'];

/** Best guess at what a blob of text is. Falls back to `null` when nothing matches. */
export function detectFormat(text: string): Format | null {
  if (!text.trim()) return null;
  const y = parseYaml(text);
  if (y.ok) {
    const root = y.src.doc.contents;
    if (isMap(root)) {
      if (get(root, 'AWSTemplateFormatVersion') !== undefined) return 'cloudformation';
      const res = get(root, 'Resources');
      if (res && entries(res).some(([, v]) => (str(get(v, 'Type')) ?? '').includes('::'))) return 'cloudformation';
      const keys = entries(root).map(([k]) => k);
      if (keys.filter((k) => OTEL_KEYS.includes(k)).length >= 2) return 'otel';
    }
    if (isSeq(root)) {
      if (isPlaybook(root)) return 'ansible';
      if (root.items.some((t) => isMap(t) && moduleOf(t) !== undefined)) return 'ansible';
    }
  }
  if (HCL_HINT.test(text)) return 'terraform';
  return null;
}
