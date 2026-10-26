import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Command, FolderOpen, PanelLeftClose, PanelLeftOpen, Share2, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { loadFile, loadSample, setFormat, share } from '../../app/actions';
import { useStore, type Mode } from '../../core/store';
import { FORMATS, FORMAT_LABEL } from '../../core/types';
import { FORMAT_VISUAL } from '../../core/visual';
import { SAMPLES } from '../../samples';
import { Logo } from './Logo';

const ease = [0.16, 1, 0.3, 1] as const;

export function TopBar() {
  const editorOpen = useStore((s) => s.editorOpen);
  const set = useStore((s) => s.set);
  const fileRef = useRef<HTMLInputElement>(null);
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <header className="topbar">
      <div className="brand">
        <button className="icon-btn" onClick={() => set({ editorOpen: !editorOpen })} aria-label={editorOpen ? 'Hide editor' : 'Show editor'} title={`Toggle editor (${isMac ? '⌘' : 'Ctrl'}\\)`}>
          {editorOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
        <Logo />
        <span className="wordmark" title="Kachua — कछुआ, the tortoise">
          kachua<span className="wordmark-dot">.</span>
        </span>
        <span className="tagline">IaC, made visible</span>
      </div>

      <FormatSwitch />

      <div className="actions">
        <SamplesMenu />
        <button className="btn ghost" onClick={() => fileRef.current?.click()} title="Open a file">
          <FolderOpen size={14} />
          <span className="btn-label">Open</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".yaml,.yml,.json,.tf,.hcl,.txt"
          data-testid="file-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = '';
          }}
        />
        <button className="btn ghost" onClick={() => void share()} title="Copy share link" data-testid="share">
          <Share2 size={14} />
          <span className="btn-label">Share</span>
        </button>
        <button className="btn kbd-btn" onClick={() => set({ paletteOpen: true })} data-testid="open-palette" aria-label="Open command palette">
          <Command size={13} />
          <kbd>{isMac ? '⌘K' : 'Ctrl K'}</kbd>
        </button>
      </div>
    </header>
  );
}

function FormatSwitch() {
  const mode = useStore((s) => s.mode);
  const detected = useStore((s) => s.detected);
  const options: Mode[] = ['auto', ...FORMATS];

  return (
    <nav className="format-switch" aria-label="Config format" data-testid="format-switch">
      {options.map((m) => {
        const active = mode === m;
        const v = m === 'auto' ? null : FORMAT_VISUAL[m];
        const Icon = v?.icon ?? Sparkles;
        const isDetected = mode === 'auto' && m === detected;
        return (
          <button
            key={m}
            className="fs-opt"
            data-active={active}
            data-detected={isDetected}
            onClick={() => setFormat(m)}
            title={m === 'auto' ? 'Detect automatically' : FORMAT_LABEL[m]}
            style={{ '--c': v?.color ?? '#ededf0' } as CSSProperties}
            aria-pressed={active}
          >
            {active && <motion.span layoutId="fs-pill" className="fs-pill" transition={{ type: 'spring', stiffness: 520, damping: 40 }} />}
            <Icon size={13} className="fs-icon" />
            <span className="fs-label">{m === 'auto' ? 'Auto' : v!.short}</span>
            {isDetected && <motion.span layoutId="fs-detected" className="fs-detected" />}
          </button>
        );
      })}
    </nav>
  );
}

function SamplesMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="btn ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} data-testid="samples-btn">
        <Sparkles size={14} />
        <span className="btn-label">Samples</span>
        <ChevronDown size={13} className="chev" data-open={open} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu glass"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.22, ease }}
            role="menu"
          >
            {SAMPLES.map((s) => {
              const v = FORMAT_VISUAL[s.format];
              const Icon = v.icon;
              return (
                <button
                  key={s.id}
                  role="menuitem"
                  className="menu-item"
                  style={{ '--c': v.color } as CSSProperties}
                  onClick={() => {
                    loadSample(s.id);
                    setOpen(false);
                  }}
                  data-testid={`sample-${s.format}`}
                >
                  <span className="menu-glyph">
                    <Icon size={15} />
                  </span>
                  <span className="menu-text">
                    <b>{s.title}</b>
                    <span>
                      {FORMAT_LABEL[s.format]} · {s.blurb}
                    </span>
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
