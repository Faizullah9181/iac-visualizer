import { setDiagnostics, lintGutter, type Diagnostic as CmDiagnostic } from '@codemirror/lint';
import { EditorView } from '@codemirror/view';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, CircleAlert, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../../core/store';
import { nodeAtLine } from '../../core/graphUtils';
import type { Diagnostic } from '../../core/types';
import { FORMAT_VISUAL, visualFor } from '../../core/visual';
import { editorChrome, languageFor, nodeRangeField, setNodeRange } from './extensions';

const FILE_NAME = { otel: 'collector.yaml', cloudformation: 'template.yaml', terraform: 'main.tf', ansible: 'playbook.yml' } as const;

export function EditorPane() {
  const ref = useRef<ReactCodeMirrorRef>(null);
  const text = useStore((s) => s.text);
  const format = useStore((s) => s.format);
  const graph = useStore((s) => s.graph);
  const error = useStore((s) => s.error);
  const reveal = useStore((s) => s.reveal);
  const selectedId = useStore((s) => s.selectedId);
  const hoveredId = useStore((s) => s.hoveredId);
  const set = useStore((s) => s.set);

  // Language switches only when the format (or JSON-ness) changes, not per keystroke.
  const isJson = text.trimStart().startsWith('{');
  const extensions = useMemo(
    () => [
      languageFor(format, isJson ? '{' : ''),
      editorChrome,
      lintGutter(),
      nodeRangeField,
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (!u.selectionSet || !u.view.hasFocus) return;
        const line = u.state.doc.lineAt(u.state.selection.main.head).number;
        const nodes = useStore.getState().graph?.nodes ?? [];
        useStore.getState().set({ cursorLine: line, cursorId: nodeAtLine(nodes, line)?.id ?? null });
      }),
      EditorView.domEventHandlers({ blur: () => void useStore.getState().set({ cursorId: null }) }),
    ],
    [format, isJson],
  );

  // Push diagnostics into the lint gutter.
  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    const all: Diagnostic[] = [...(error ? [error] : []), ...(graph?.diagnostics ?? [])];
    const doc = view.state.doc;
    const cm: CmDiagnostic[] = all
      .filter((d) => d.line)
      .map((d) => {
        const line = doc.line(Math.min(Math.max(1, d.line!), doc.lines));
        const indent = /^\s*/.exec(line.text)?.[0].length ?? 0;
        return { from: line.from + indent, to: Math.max(line.from + indent, line.to), severity: d.severity, message: d.message };
      });
    view.dispatch(setDiagnostics(view.state, cm));
  }, [graph, error, text]);

  // Highlight the hovered/selected node's source.
  const hlId = hoveredId ?? selectedId;
  const hlNode = hlId ? graph?.nodes.find((n) => n.id === hlId) : undefined;
  useEffect(() => {
    const view = ref.current?.view;
    if (!view) return;
    view.dispatch({ effects: setNodeRange.of(hlNode?.line ? { from: hlNode.line, to: hlNode.endLine ?? hlNode.line } : null) });
    view.dom.style.setProperty('--hl', hlNode ? visualFor(hlNode.kind, hlNode.category).color : '#ff7a1a');
  }, [hlNode]);

  // Scroll to a line on request.
  useEffect(() => {
    const view = ref.current?.view;
    if (!view || !reveal) return;
    const doc = view.state.doc;
    const line = doc.line(Math.min(Math.max(1, reveal.line), doc.lines));
    view.dispatch({
      selection: { anchor: line.from },
      effects: [
        EditorView.scrollIntoView(line.from, { y: 'center' }),
        setNodeRange.of({ from: reveal.line, to: reveal.endLine ?? reveal.line }),
      ],
    });
    const el = view.dom.closest('.editor-body');
    el?.classList.remove('flash');
    void (el as HTMLElement | null)?.offsetWidth;
    el?.classList.add('flash');
  }, [reveal]);

  const FIcon = FORMAT_VISUAL[format].icon;
  const lines = text.split('\n').length;

  return (
    <section className="editor-pane" aria-label="Source editor">
      <header className="pane-head">
        <div className="file-tab">
          <FIcon size={13} style={{ color: FORMAT_VISUAL[format].color }} />
          <span>{FILE_NAME[format]}</span>
          <span className="file-dot" data-state={error ? 'err' : 'ok'} />
        </div>
        <span className="pane-meta">{lines} lines</span>
      </header>
      <div className="editor-body" data-testid="editor">
        <CodeMirror
          ref={ref}
          value={text}
          height="100%"
          theme="none"
          extensions={extensions}
          onChange={(v) => set({ text: v })}
          basicSetup={{ highlightActiveLine: true, foldGutter: true, autocompletion: false, searchKeymap: true, tabSize: 2 }}
          aria-label="Configuration source"
        />
      </div>
      <Problems />
    </section>
  );
}

const SEV_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info };

function Problems() {
  const graph = useStore((s) => s.graph);
  const error = useStore((s) => s.error);
  const open = useStore((s) => s.problemsOpen);
  const set = useStore((s) => s.set);
  const revealLine = useStore((s) => s.revealLine);
  const select = useStore((s) => s.select);

  const all = useMemo(() => {
    const rank = { error: 0, warning: 1, info: 2 };
    return [...(error ? [{ ...error, message: `Parse error: ${error.message}` }] : []), ...(graph?.diagnostics ?? [])].sort(
      (a, b) => rank[a.severity] - rank[b.severity] || (a.line ?? 0) - (b.line ?? 0),
    );
  }, [graph, error]);
  const count = (s: Diagnostic['severity']) => all.filter((d) => d.severity === s).length;

  const jump = (d: Diagnostic) => {
    if (!d.line) return;
    revealLine(d.line);
    const n = graph && nodeAtLine(graph.nodes, d.line);
    if (n) select(n.id, { focus: true });
  };

  return (
    <div className="problems" data-open={open}>
      <button className="problems-head" onClick={() => set({ problemsOpen: !open })} aria-expanded={open} data-testid="problems-toggle">
        <span className="problems-title">Problems</span>
        <span className="sev-count sev-error" data-testid="count-error"><CircleAlert size={12} />{count('error')}</span>
        <span className="sev-count sev-warning" data-testid="count-warning"><TriangleAlert size={12} />{count('warning')}</span>
        <span className="sev-count sev-info"><Info size={12} />{count('info')}</span>
        <ChevronDown size={14} className="problems-chevron" />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.ul
            className="problems-list"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            data-testid="problems-list"
          >
            {all.length === 0 && <li className="problems-empty">No problems. Clean config. ✦</li>}
            {all.map((d, i) => {
              const Icon = SEV_ICON[d.severity];
              return (
                <li key={`${i}-${d.message}`}>
                  <button className={`problem sev-${d.severity}`} onClick={() => jump(d)}>
                    <Icon size={13} />
                    <span className="problem-msg">{d.message}</span>
                    {d.line && <span className="problem-line">L{d.line}</span>}
                  </button>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
