import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownUp, Cable, ClipboardCopy, CornerDownLeft, ImageDown, Keyboard, Maximize2, PanelLeft, Search, Share2, Sparkles, type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { copyMermaid, loadSample, setFormat, share } from '../../app/actions';
import { useStore } from '../../core/store';
import { FORMATS, FORMAT_LABEL } from '../../core/types';
import { awsIconFor } from '../../core/awsIcons';
import { FORMAT_VISUAL, KIND, visualFor } from '../../core/visual';
import { awsIconUrl } from '../awsIconUrl';
import { SAMPLES } from '../../samples';

interface Item {
  id: string;
  section: 'Nodes' | 'Actions' | 'Format' | 'Samples';
  label: string;
  hint?: string;
  icon: LucideIcon;
  img?: string;
  color?: string;
  run: () => void;
}

/** Subsequence match with a bonus for contiguous runs and word starts. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let qi = 0;
  let score = 0;
  let run = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      qi++;
      run++;
      score += run * 2 + (i === 0 || /[\s._/:-]/.test(t[i - 1]) ? 4 : 0);
    } else run = 0;
  }
  return qi === q.length ? score : 0;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const set = useStore((s) => s.set);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e) => e.target === e.currentTarget && set({ paletteOpen: false })}
        >
          <Palette />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Palette() {
  const s = useStore();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => s.set({ paletteOpen: false });

  const items = useMemo<Item[]>(() => {
    const nodes: Item[] = (s.graph?.nodes ?? []).map((n) => {
      const v = visualFor(n.kind, n.category);
      return {
        id: `node:${n.id}`,
        section: 'Nodes',
        label: n.label,
        hint: `${KIND[n.kind].label}${n.type ?? n.sub ? ` · ${n.type ?? n.sub}` : ''}${n.group && !n.group.startsWith('__') ? ` · ${n.group}` : ''}`,
        icon: v.icon,
        img: awsIconUrl(awsIconFor(n)),
        color: v.color,
        run: () => s.select(n.id, { reveal: true, focus: true }),
      };
    });
    const actions: Item[] = [
      { id: 'a:share', section: 'Actions', label: 'Copy share link', hint: '⌘S', icon: Share2, run: () => void share() },
      { id: 'a:png', section: 'Actions', label: 'Export graph as PNG', icon: ImageDown, run: s.requestExport },
      { id: 'a:mermaid', section: 'Actions', label: 'Copy as Mermaid flowchart', icon: ClipboardCopy, run: () => void copyMermaid() },
      { id: 'a:fit', section: 'Actions', label: 'Fit graph to screen', hint: 'F', icon: Maximize2, run: s.fitView },
      ...(s.graph?.format === 'cloudformation' || s.graph?.format === 'terraform'
        ? [{ id: 'a:wiring', section: 'Actions' as const, label: s.showWiring ? 'Hide input/output wiring' : 'Show all input/output wiring', hint: 'W', icon: Cable, run: () => s.set({ showWiring: !s.showWiring }) }]
        : []),
      ...(s.graph?.format !== 'ansible' ? [] : [{ id: 'a:dir', section: 'Actions' as const, label: `Switch layout to ${s.direction === 'LR' ? 'top → bottom' : 'left → right'}`, hint: 'L', icon: ArrowDownUp, run: () => s.set({ direction: s.direction === 'LR' ? 'TB' : 'LR' }) }]),
      { id: 'a:editor', section: 'Actions', label: s.editorOpen ? 'Hide editor' : 'Show editor', hint: 'E', icon: PanelLeft, run: () => s.set({ editorOpen: !s.editorOpen }) },
      { id: 'a:keys', section: 'Actions', label: 'Keyboard shortcuts', hint: '?', icon: Keyboard, run: () => s.set({ helpOpen: true }) },
    ];
    const formats: Item[] = [
      { id: 'f:auto', section: 'Format', label: 'Auto-detect format', icon: Sparkles, run: () => setFormat('auto') },
      ...FORMATS.map((f) => ({ id: `f:${f}`, section: 'Format' as const, label: `Treat as ${FORMAT_LABEL[f]}`, icon: FORMAT_VISUAL[f].icon, color: FORMAT_VISUAL[f].color, run: () => setFormat(f) })),
    ];
    const samples: Item[] = SAMPLES.map((x) => ({
      id: `s:${x.id}`,
      section: 'Samples',
      label: `Load sample: ${x.title}`,
      hint: FORMAT_LABEL[x.format],
      icon: FORMAT_VISUAL[x.format].icon,
      color: FORMAT_VISUAL[x.format].color,
      run: () => loadSample(x.id),
    }));
    return [...nodes, ...actions, ...formats, ...samples];
  }, [s]);

  const results = useMemo(() => {
    if (!q.trim()) return items.filter((i) => i.section !== 'Nodes').concat(items.filter((i) => i.section === 'Nodes').slice(0, 8));
    return items
      .map((i) => ({ i, score: Math.max(fuzzyScore(q, i.label), fuzzyScore(q, i.hint ?? '') * 0.6) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map((x) => x.i)
      // Keep sections contiguous, ordered by their best match.
      .reduce<Item[][]>((groups, item) => {
        const g = groups.find((x) => x[0].section === item.section);
        if (g) g.push(item);
        else groups.push([item]);
        return groups;
      }, [])
      .flat();
  }, [q, items]);

  useEffect(() => setIdx(0), [q]);
  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  const run = (item?: Item) => {
    if (!item) return;
    close();
    item.run();
  };

  let lastSection = '';
  return (
    <motion.div
      className="palette glass"
      role="dialog"
      aria-label="Command palette"
      initial={{ opacity: 0, y: -14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -10, scale: 0.98 }}
      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
      data-testid="palette"
    >
      <div className="palette-input">
        <Search size={16} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Jump to a node, run an action, load a sample…"
          aria-label="Search"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(results[idx]);
            }
          }}
        />
        <kbd>esc</kbd>
      </div>
      <div className="palette-list" ref={listRef}>
        {results.length === 0 && <div className="palette-empty">Nothing matches “{q}”.</div>}
        {results.map((item, i) => {
          const header = item.section !== lastSection ? item.section : null;
          lastSection = item.section;
          const Icon = item.icon;
          return (
            <div key={item.id}>
              {header && <div className="palette-section">{header}</div>}
              <button
                className="palette-item"
                data-active={i === idx}
                onMouseMove={() => setIdx(i)}
                onClick={() => run(item)}
                style={{ '--c': item.color ?? '#a1a1aa' } as CSSProperties}
              >
                {item.img ? (
                  <img className="palette-aws" src={item.img} alt="" />
                ) : (
                  <span className="palette-icon">
                    <Icon size={14} />
                  </span>
                )}
                <span className="palette-label">{item.label}</span>
                {item.hint && <span className="palette-hint">{item.hint}</span>}
                {i === idx && <CornerDownLeft size={13} className="palette-enter" />}
              </button>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
