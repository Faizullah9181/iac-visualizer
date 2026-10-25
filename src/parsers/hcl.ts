/**
 * A deliberately small HCL2 reader. It does not evaluate expressions — it keeps
 * enough structure (blocks, labels, attributes, line ranges) and enough of each
 * expression's text (with string literals stripped but interpolations kept) to
 * find references like `aws_vpc.main.id` or `var.region`.
 */

export interface HclAttr {
  name: string;
  line: number;
  endLine: number;
  /** Original expression source, trimmed. */
  raw: string;
  /** Expression text with string literal content removed, interpolations kept. */
  refText: string;
}

export interface HclBlock {
  type: string;
  labels: string[];
  line: number;
  endLine: number;
  attrs: HclAttr[];
  blocks: HclBlock[];
}

export class HclError extends Error {
  constructor(message: string, public line: number) {
    super(message);
  }
}

type TokType = 'ident' | 'string' | 'heredoc' | 'number' | 'punct' | 'nl' | 'eof';

interface Tok {
  type: TokType;
  value: string;
  start: number;
  end: number;
  line: number;
  /** For string/heredoc: the `${…}` interpolation bodies. */
  interps?: string[];
}

const PUNCT2 = ['==', '!=', '<=', '>=', '&&', '||', '=>', '...'];

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  let line = 1;
  const push = (type: TokType, start: number, value: string, extra?: Partial<Tok>) =>
    toks.push({ type, value, start, end: i, line: extra?.line ?? line, ...extra });

  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      i++;
      push('nl', i - 1, '\n');
      line++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '#' || (c === '/' && src[i + 1] === '/')) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const startLine = line;
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line++;
        i++;
      }
      if (i >= src.length) throw new HclError('Unterminated block comment', startLine);
      i += 2;
      continue;
    }
    if (c === '"') {
      const start = i;
      const startLine = line;
      const interps: string[] = [];
      i++;
      let value = '';
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') {
          value += src[i + 1] ?? '';
          i += 2;
          continue;
        }
        if (src[i] === '\n') throw new HclError('Unterminated string', startLine);
        if ((src[i] === '$' || src[i] === '%') && src[i + 1] === '{') {
          const body = readInterp(src, i + 2, startLine);
          interps.push(body.text);
          value += src.slice(i, body.end);
          i = body.end;
          continue;
        }
        value += src[i++];
      }
      if (i >= src.length) throw new HclError('Unterminated string', startLine);
      i++;
      push('string', start, value, { interps, line: startLine });
      continue;
    }
    if (c === '<' && src[i + 1] === '<' && /[-A-Za-z_]/.test(src[i + 2] ?? '')) {
      const start = i;
      const startLine = line;
      const m = /^<<-?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n/.exec(src.slice(i));
      if (!m) throw new HclError('Malformed heredoc', line);
      const marker = m[1];
      i += m[0].length;
      line++;
      const bodyStart = i;
      let found = false;
      while (i < src.length) {
        const eol = src.indexOf('\n', i);
        const lineEnd = eol === -1 ? src.length : eol;
        if (src.slice(i, lineEnd).trim() === marker) {
          const body = src.slice(bodyStart, i);
          i = lineEnd;
          found = true;
          const interps = [...body.matchAll(/[$%]\{([^}]*)\}/g)].map((x) => x[1]);
          push('heredoc', start, body, { interps, line: startLine });
          break;
        }
        i = lineEnd + 1;
        line++;
      }
      if (!found) throw new HclError(`Heredoc "${marker}" is never closed`, startLine);
      continue;
    }
    if (/[0-9]/.test(c)) {
      const start = i;
      while (i < src.length && /[0-9.eE+-]/.test(src[i]) && !(src[i] === '.' && !/[0-9]/.test(src[i + 1] ?? ''))) i++;
      push('number', start, src.slice(start, i));
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_-]/.test(src[i])) i++;
      push('ident', start, src.slice(start, i));
      continue;
    }
    const two = PUNCT2.find((p) => src.startsWith(p, i));
    const start = i;
    i += two ? two.length : 1;
    push('punct', start, two ?? c);
  }
  toks.push({ type: 'eof', value: '', start: i, end: i, line });
  return toks;
}

/** Reads a `${ … }` body starting just after `${`, honouring nested braces and strings. */
function readInterp(src: string, from: number, line: number): { text: string; end: number } {
  let depth = 1;
  let i = from;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length && src[i] !== '"') i += src[i] === '\\' ? 2 : 1;
    } else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return { text: src.slice(from, i), end: i + 1 };
    } else if (c === '\n') throw new HclError('Unterminated interpolation', line);
    i++;
  }
  throw new HclError('Unterminated interpolation', line);
}

export function parseHcl(src: string): HclBlock {
  const toks = lex(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const skipNl = () => {
    while (peek().type === 'nl') p++;
  };

  const exprText = (from: number, to: number) => {
    let out = '';
    for (let k = from; k < to; k++) {
      const t = toks[k];
      if (t.type === 'string' || t.type === 'heredoc') out += ` ${(t.interps ?? []).join(' ')} `;
      else if (t.type === 'nl') out += ' ';
      else out += (needsSpace(toks[k - 1], t) ? ' ' : '') + t.value;
    }
    return out;
  };

  const parseBody = (closing: boolean): Omit<HclBlock, 'type' | 'labels' | 'line' | 'endLine'> & { endLine: number } => {
    const attrs: HclAttr[] = [];
    const blocks: HclBlock[] = [];
    for (;;) {
      skipNl();
      const t = peek();
      if (t.type === 'eof') {
        if (closing) throw new HclError('Missing closing "}"', t.line);
        return { attrs, blocks, endLine: t.line };
      }
      if (t.type === 'punct' && t.value === '}') {
        if (!closing) throw new HclError('Unexpected "}"', t.line);
        next();
        return { attrs, blocks, endLine: t.line };
      }
      if (t.type !== 'ident') throw new HclError(`Unexpected ${describe(t)} — expected an attribute or block`, t.line);
      next();
      const after = peek();
      if (after.type === 'punct' && (after.value === '=' || after.value === ':')) {
        next();
        const from = p;
        let depth = 0;
        let last = t.line;
        for (;;) {
          const x = peek();
          if (x.type === 'eof') break;
          if (depth === 0 && (x.type === 'nl' || (x.type === 'punct' && x.value === '}'))) break;
          if (x.type === 'punct' && '([{'.includes(x.value)) depth++;
          if (x.type === 'punct' && ')]}'.includes(x.value)) depth--;
          last = x.line + (x.type === 'heredoc' ? x.value.split('\n').length : 0);
          next();
        }
        if (p === from) throw new HclError(`Attribute "${t.value}" has no value`, t.line);
        if (depth > 0) throw new HclError(`Unclosed bracket in "${t.value}"`, t.line);
        attrs.push({
          name: t.value,
          line: t.line,
          endLine: last,
          raw: src.slice(toks[from].start, toks[p - 1].end).trim(),
          refText: exprText(from, p),
        });
        continue;
      }
      const labels: string[] = [];
      while (peek().type === 'string' || peek().type === 'ident') labels.push(next().value);
      const brace = next();
      if (brace.type !== 'punct' || brace.value !== '{')
        throw new HclError(`Expected "{" or "=" after "${t.value}"${labels.length ? ` "${labels.join('" "')}"` : ''}`, brace.line);
      const body = parseBody(true);
      blocks.push({ type: t.value, labels, line: t.line, ...body });
    }
  };

  const body = parseBody(false);
  return { type: '__root', labels: [], line: 1, ...body };
}

function needsSpace(prev: Tok | undefined, t: Tok) {
  if (!prev) return false;
  if (t.value === '.' || prev.value === '.' || t.value === '[' || prev.value === '[' || t.value === ']') return false;
  return true;
}

function describe(t: Tok) {
  if (t.type === 'string') return `string "${t.value}"`;
  if (t.type === 'punct') return `"${t.value}"`;
  return t.type;
}

/** Every attribute in a block, including those in nested blocks (e.g. `ingress {}`). */
export function allAttrs(block: HclBlock): HclAttr[] {
  return [...block.attrs, ...block.blocks.flatMap(allAttrs)];
}
