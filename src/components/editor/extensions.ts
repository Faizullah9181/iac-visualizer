import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { json } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { StateEffect, StateField, type Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import type { Format } from '../../core/types';

interface HclState {
  heredoc: string | null;
  comment: boolean;
}

/** Just enough HCL highlighting: blocks, attributes, references, heredocs. */
const hcl = StreamLanguage.define<HclState>({
  name: 'hcl',
  startState: () => ({ heredoc: null, comment: false }),
  token(stream, state) {
    if (state.comment) {
      if (stream.skipTo('*/')) {
        stream.match('*/');
        state.comment = false;
      } else stream.skipToEnd();
      return 'comment';
    }
    if (state.heredoc) {
      if (stream.sol() && stream.match(new RegExp(`^\\s*${state.heredoc}\\s*$`))) state.heredoc = null;
      else stream.skipToEnd();
      return 'string';
    }
    if (stream.eatSpace()) return null;
    if (stream.match('#') || stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match('/*')) {
      state.comment = true;
      return 'comment';
    }
    const h = stream.match(/^<<-?([A-Za-z_]\w*)/) as RegExpMatchArray | null;
    if (h) {
      state.heredoc = h[1];
      return 'string';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^(true|false|null)\b/)) return 'atom';
    if (stream.match(/^(resource|data|variable|output|module|provider|locals|terraform|dynamic|lifecycle|moved|import)\b(?=\s*["{A-Za-z])/)) return 'keyword';
    if (stream.match(/^(for|in|if)\b/)) return 'keyword';
    if (stream.match(/^(var|local|module|data|each|count|self|path)(?=\.)/)) return 'typeName';
    if (stream.match(/^[A-Za-z_][\w-]*(?=\s*=(?!=))/)) return 'propertyName';
    if (stream.match(/^[A-Za-z_][\w-]*(?=\()/)) return 'variableName.function';
    if (stream.match(/^[A-Za-z_][\w-]*/)) return 'variableName';
    if (stream.match(/^[{}[\]()]/)) return 'bracket';
    stream.next();
    return 'operator';
  },
  languageData: { commentTokens: { line: '#' } },
});

export function languageFor(format: Format, text: string): Extension {
  if (format === 'terraform') return hcl;
  if (format === 'cloudformation' && text.trimStart().startsWith('{')) return json();
  return yaml();
}

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword], color: '#c4b5fd', fontWeight: '600' },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: '#ffb27d' },
  { tag: [t.content], color: '#d4d4d8' },
  { tag: [t.string, t.special(t.string)], color: '#9fe2b0' },
  { tag: [t.number, t.integer, t.float], color: '#f8d06b' },
  { tag: [t.bool, t.null, t.atom], color: '#7dd3fc' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#585863', fontStyle: 'italic' },
  { tag: [t.typeName, t.tagName, t.labelName, t.meta], color: '#f49ac9' },
  { tag: [t.function(t.variableName)], color: '#7dd3fc' },
  { tag: [t.variableName], color: '#a5b4fc' },
  { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: '#6e6e7a' },
  { tag: [t.invalid], color: '#f87171' },
]);

const theme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#d4d4d8', height: '100%', fontSize: '12.5px' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.7', overflow: 'auto' },
    '.cm-content': { caretColor: 'var(--accent)', padding: '14px 0 40vh' },
    '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#45454e', border: 'none', paddingLeft: '6px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#d4d4d8' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.025)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'rgba(255,122,26,0.22) !important' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(255,255,255,0.08)', outline: 'none' },
    '.cm-foldPlaceholder': { background: 'rgba(255,255,255,.06)', border: 'none', color: '#a1a1aa' },
    '.cm-tooltip': { background: '#141418', border: '1px solid rgba(255,255,255,.1)', borderRadius: '10px', overflow: 'hidden' },
    '.cm-tooltip-lint': { fontFamily: 'var(--sans)' },
    '.cm-diagnostic': { padding: '6px 10px', borderLeftWidth: '3px' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy #f87171 1px', textUnderlineOffset: '3px' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy #facc15 1px', textUnderlineOffset: '3px' },
    '.cm-lintRange-info': { backgroundImage: 'none', textDecoration: 'underline dotted #60a5fa 1px', textUnderlineOffset: '3px' },
    '.cm-gutter-lint': { width: '14px' },
    '.cm-node-line': { backgroundColor: 'color-mix(in srgb, var(--hl, #ff7a1a) 9%, transparent)' },
    '.cm-node-line-edge': { boxShadow: 'inset 2px 0 0 var(--hl, #ff7a1a)' },
  },
  { dark: true },
);

export const editorChrome: Extension = [theme, syntaxHighlighting(highlight)];

/** Highlights the source range of the selected/hovered node. */
export const setNodeRange = StateEffect.define<{ from: number; to: number } | null>();

export const nodeRangeField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setNodeRange)) continue;
      if (!e.value) return Decoration.none;
      const b = new RangeSetBuilder<Decoration>();
      const doc = tr.state.doc;
      const from = Math.max(1, Math.min(e.value.from, doc.lines));
      const to = Math.max(from, Math.min(e.value.to, doc.lines));
      for (let l = from; l <= to; l++)
        b.add(doc.line(l).from, doc.line(l).from, Decoration.line({ class: 'cm-node-line cm-node-line-edge' }));
      return b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
