import { AnimatePresence, motion } from 'framer-motion';
import { Check, CircleAlert, FileUp } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { loadFile } from '../../app/actions';
import { useStore } from '../../core/store';
import { FORMAT_LABEL } from '../../core/types';
import { Tortoise } from './Logo';

const ease = [0.16, 1, 0.3, 1] as const;

export function StatusBar() {
  const graph = useStore((s) => s.graph);
  const error = useStore((s) => s.error);
  const format = useStore((s) => s.format);
  const mode = useStore((s) => s.mode);
  const parseMs = useStore((s) => s.parseMs);
  const cursorLine = useStore((s) => s.cursorLine);
  const set = useStore((s) => s.set);

  return (
    <footer className="statusbar" data-testid="statusbar">
      <span className="sb-live" data-state={error ? 'err' : 'ok'}>
        <span className="sb-dot" />
        {error ? 'Syntax error' : 'Live'}
      </span>
      <span>
        {FORMAT_LABEL[format]}
        {mode === 'auto' && <em> · auto</em>}
      </span>
      <span>Ln {cursorLine}</span>
      <span className="sb-spacer" />
      {graph && (
        <span data-testid="parse-time">
          {graph.nodes.length} nodes · {graph.edges.length} edges · parsed in {parseMs < 1 ? '<1' : parseMs.toFixed(1)} ms
        </span>
      )}
      <button className="sb-help" onClick={() => set({ helpOpen: true })}>
        ? shortcuts
      </button>
    </footer>
  );
}

export function Resizer() {
  const [dragging, setDragging] = useState(false);
  const onDown = (e: RPointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.max(300, ev.clientX), window.innerWidth * 0.7);
      document.documentElement.style.setProperty('--editor-w', `${w}px`);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      try {
        localStorage.setItem('kachua:editor-w', getComputedStyle(document.documentElement).getPropertyValue('--editor-w'));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    try {
      const w = localStorage.getItem('kachua:editor-w');
      if (w) document.documentElement.style.setProperty('--editor-w', w);
    } catch {
      /* ignore */
    }
  }, []);
  return <div className="resizer" data-dragging={dragging} onPointerDown={onDown} role="separator" aria-orientation="vertical" aria-label="Resize editor" />;
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 2400);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <AnimatePresence>
      {visible && toast && (
        <motion.div
          key={toast.nonce}
          className="toast glass"
          data-tone={toast.tone}
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ duration: 0.3, ease }}
          role="status"
          data-testid="toast"
        >
          {toast.tone === 'err' ? <CircleAlert size={14} /> : <Check size={14} />}
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function DropZone() {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const overFn = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = () => {
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const f = e.dataTransfer?.files[0];
      if (f) void loadFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overFn);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overFn);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);
  return (
    <AnimatePresence>
      {over && (
        <motion.div className="dropzone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <motion.div className="dropzone-inner" initial={{ scale: 0.94 }} animate={{ scale: 1 }} transition={{ duration: 0.35, ease }}>
            <FileUp size={28} />
            <b>Drop to visualise</b>
            <span>.yaml · .yml · .json · .tf</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const SHORTCUTS: [string, string][] = [
  ['⌘ K', 'Command palette — jump to any node'],
  ['/', 'Search nodes'],
  ['⌘ S', 'Copy share link'],
  ['⌘ \\  or  E', 'Toggle editor'],
  ['F', 'Fit graph'],
  ['L', 'Flip layout (Ansible)'],
  ['W', 'Show all input/output wiring'],
  ['Esc', 'Clear selection'],
  ['Hover', 'Trace upstream + downstream'],
  ['Click', 'Inspect node, jump to source'],
  ['Cursor', 'Editor caret lights its node'],
];

export function ShortcutHelp() {
  const open = useStore((s) => s.helpOpen);
  const set = useStore((s) => s.set);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(e) => e.target === e.currentTarget && set({ helpOpen: false })}>
          <motion.div
            className="help glass"
            role="dialog"
            aria-label="Keyboard shortcuts"
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.26, ease }}
            data-testid="help"
          >
            <h3>Shortcuts</h3>
            <dl>
              {SHORTCUTS.map(([k, v], i) => (
                <motion.div key={k} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.03 * i, duration: 0.3, ease }}>
                  <dt>
                    <kbd>{k}</kbd>
                  </dt>
                  <dd>{v}</dd>
                </motion.div>
              ))}
            </dl>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const BOOT_STEPS = ['reading config', 'resolving references', 'laying out lanes'];

/**
 * Boot loader: Kachua walks in place while data pulses through its shell, the name rises,
 * captions tick through what a parse does, then the curtain blurs away. Picks up seamlessly
 * from the pre-React loader in index.html.
 */
export function BootIntro() {
  const [show, setShow] = useState(true);
  const [step, setStep] = useState(0);
  useEffect(() => {
    const ticks = BOOT_STEPS.map((_, i) => setTimeout(() => setStep(i), i * 480));
    const done = setTimeout(() => setShow(false), 1550);
    return () => [...ticks, done].forEach(clearTimeout);
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div className="boot" exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.03 }} transition={{ duration: 0.5, ease }} aria-hidden data-testid="boot">
          <div className="boot-inner">
            <Tortoise size={112} walking ground />
            <div className="boot-word">
              {'kachua'.split('').map((c, i) => (
                <motion.span key={i} initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ delay: 0.15 + i * 0.05, duration: 0.6, ease }}>
                  {c}
                </motion.span>
              ))}
              <motion.span className="accent" initial={{ y: '110%' }} animate={{ y: 0 }} transition={{ delay: 0.5, duration: 0.6, ease }}>
                .
              </motion.span>
            </div>
            <div className="boot-caption">
              <AnimatePresence mode="wait">
                <motion.div key={step} initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -12, opacity: 0 }} transition={{ duration: 0.22, ease }}>
                  {BOOT_STEPS[step]}…
                </motion.div>
              </AnimatePresence>
            </div>
            <div className="boot-bar">
              <i />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
