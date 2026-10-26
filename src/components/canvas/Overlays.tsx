import { useReactFlow } from '@xyflow/react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownUp, ArrowRightLeft, Cable, CircleAlert, Eye, EyeOff, ImageDown, Maximize2, TriangleAlert, ZoomIn, ZoomOut } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { useStore } from '../../core/store';
import { FORMAT_LABEL, type Format, type Kind } from '../../core/types';
import { FORMAT_VISUAL, KIND } from '../../core/visual';
import { usesLanes } from '../../layout/layout';
import { SAMPLES } from '../../samples';
import { Tortoise } from '../chrome/Logo';
import { Inspector } from './Inspector';

const ease = [0.16, 1, 0.3, 1] as const;

export function Overlays() {
  return (
    <>
      <Hud />
      <Legend />
      <Toolbar />
      <ErrorBanner />
      <EmptyState />
      <Inspector />
    </>
  );
}

function Hud() {
  const graph = useStore((s) => s.graph);
  const set = useStore((s) => s.set);
  if (!graph) return null;
  const v = FORMAT_VISUAL[graph.format];
  const Icon = v.icon;
  const errors = graph.diagnostics.filter((d) => d.severity === 'error').length;
  const warnings = graph.diagnostics.filter((d) => d.severity === 'warning').length;
  const groupWord = graph.format === 'otel' ? 'pipelines' : graph.format === 'ansible' ? 'plays' : null;
  const groupCount = graph.groups.filter((g) => !g.id.startsWith('__')).length;

  return (
    <motion.div className="hud glass" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }} data-testid="hud">
      <div className="hud-format" style={{ '--c': v.color } as CSSProperties}>
        <Icon size={14} />
        <span>{FORMAT_LABEL[graph.format]}</span>
      </div>
      <div className="hud-stats">
        <Stat n={graph.nodes.length} label="nodes" testId="stat-nodes" />
        <Stat n={graph.edges.length} label="edges" testId="stat-edges" />
        {groupWord && <Stat n={groupCount} label={groupWord} />}
      </div>
      {(errors > 0 || warnings > 0) && (
        <button className="hud-issues" onClick={() => set({ problemsOpen: true, editorOpen: true })} title="Show problems">
          {errors > 0 && (
            <span className="sev-error">
              <CircleAlert size={12} /> {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="sev-warning">
              <TriangleAlert size={12} /> {warnings}
            </span>
          )}
        </button>
      )}
    </motion.div>
  );
}

function Stat({ n, label, testId }: { n: number; label: string; testId?: string }) {
  return (
    <span className="stat">
      <motion.b key={n} initial={{ y: 6, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.3, ease }} data-testid={testId}>
        {n}
      </motion.b>
      {label}
    </span>
  );
}

function Legend() {
  const graph = useStore((s) => s.graph);
  const hidden = useStore((s) => s.hiddenKinds);
  const toggle = useStore((s) => s.toggleKind);
  const kinds = useMemo(() => {
    const counts = new Map<Kind, number>();
    for (const n of graph?.nodes ?? []) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
    return [...counts];
  }, [graph]);
  if (!graph || !kinds.length) return null;

  return (
    <div className="legend glass" data-testid="legend">
      <div className="legend-row">
        {kinds.map(([k, n]) => {
          const off = hidden.includes(k);
          const v = KIND[k];
          return (
            <button key={k} className="legend-item" data-off={off} onClick={() => toggle(k)} style={{ '--c': v.color } as CSSProperties} title={off ? `Show ${v.label}` : `Hide ${v.label}`}>
              <span className="legend-dot" />
              {v.label}
              <span className="legend-n">{n}</span>
              {off ? <EyeOff size={11} /> : <Eye size={11} className="legend-eye" />}
            </button>
          );
        })}
      </div>
      <EdgeKey format={graph.format} />
    </div>
  );
}

const EDGE_KEY: Record<Format, { dash?: string; label: string; color?: string }[]> = {
  otel: [{ label: 'data flow' }, { label: 'connector', color: '#f472b6' }],
  cloudformation: [{ label: 'references' }, { dash: '2 4', label: 'DependsOn' }],
  terraform: [{ label: 'references' }, { dash: '2 4', label: 'depends_on / provider' }],
  ansible: [{ label: 'runs next' }, { dash: '6 4', label: 'notifies handler', color: '#facc15' }, { label: 'uses registered result', color: '#60a5fa' }],
};

function EdgeKey({ format }: { format: Format }) {
  const showWiring = useStore((s) => s.showWiring);
  const set = useStore((s) => s.set);
  const infra = format === 'cloudformation' || format === 'terraform';
  return (
    <div className="legend-row legend-key" data-testid="edge-key">
      {EDGE_KEY[format].map((k) => (
        <span key={k.label} className="key-item">
          <svg width="26" height="8" aria-hidden>
            <line x1="1" y1="4" x2="19" y2="4" stroke={k.color ?? '#a1a1aa'} strokeWidth="1.6" strokeDasharray={k.dash} strokeLinecap="round" />
            <path d="M19 1 L25 4 L19 7 Z" fill={k.color ?? '#a1a1aa'} />
          </svg>
          {k.label}
        </span>
      ))}
      {infra && (
        <button className="key-wiring" onClick={() => set({ showWiring: !showWiring })} data-testid="wiring-hint">
          {showWiring ? 'hide input/output wires' : 'input/output wires show on hover — show all'}
        </button>
      )}
    </div>
  );
}

function Toolbar() {
  const rf = useReactFlow();
  const graph = useStore((s) => s.graph);
  const direction = useStore((s) => s.direction);
  const set = useStore((s) => s.set);
  const fitView = useStore((s) => s.fitView);
  const requestExport = useStore((s) => s.requestExport);
  const showWiring = useStore((s) => s.showWiring);
  const lanes = !!graph && usesLanes(graph.format);
  const infra = graph?.format === 'cloudformation' || graph?.format === 'terraform';
  const DirIcon = direction === 'LR' ? ArrowDownUp : ArrowRightLeft;

  return (
    <div className="toolbar glass" role="toolbar" aria-label="Canvas controls">
      <button onClick={() => void rf.zoomIn({ duration: 250 })} title="Zoom in" aria-label="Zoom in">
        <ZoomIn size={15} />
      </button>
      <button onClick={() => void rf.zoomOut({ duration: 250 })} title="Zoom out" aria-label="Zoom out">
        <ZoomOut size={15} />
      </button>
      <button onClick={fitView} title="Fit view (F)" aria-label="Fit view">
        <Maximize2 size={15} />
      </button>
      <span className="toolbar-sep" />
      <button
        onClick={() => set({ direction: direction === 'LR' ? 'TB' : 'LR' })}
        disabled={lanes}
        title={lanes ? 'Lanes always flow left → right' : `Layout: ${direction === 'LR' ? 'left → right' : 'top → bottom'} (L)`}
        aria-label="Toggle layout direction"
        data-testid="toggle-direction"
      >
        <DirIcon size={15} />
      </button>
      {infra && (
        <button
          onClick={() => set({ showWiring: !showWiring })}
          data-active={showWiring}
          title={showWiring ? 'Hide input/output wiring (W)' : 'Show all input/output wiring (W)'}
          aria-label="Toggle input and output wiring"
          aria-pressed={showWiring}
          data-testid="toggle-wiring"
        >
          <Cable size={15} />
        </button>
      )}
      <button onClick={requestExport} title="Export PNG" aria-label="Export PNG" data-testid="export-png">
        <ImageDown size={15} />
      </button>
    </div>
  );
}

function ErrorBanner() {
  const error = useStore((s) => s.error);
  const graph = useStore((s) => s.graph);
  const revealLine = useStore((s) => s.revealLine);
  return (
    <AnimatePresence>
      {error && (
        <motion.button
          className="error-banner"
          initial={{ opacity: 0, y: -12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease }}
          onClick={() => error.line && revealLine(error.line)}
          data-testid="error-banner"
        >
          <CircleAlert size={14} />
          <span>
            {error.line ? <b>Line {error.line}</b> : null} {error.message}
          </span>
          {graph && <span className="error-hint">showing last valid graph</span>}
        </motion.button>
      )}
    </AnimatePresence>
  );
}

function EmptyState() {
  const graph = useStore((s) => s.graph);
  const text = useStore((s) => s.text);
  const error = useStore((s) => s.error);
  const set = useStore((s) => s.set);
  if (graph && graph.nodes.length) return null;
  const unknown = text.trim() && !error;

  return (
    <div className="empty" data-testid="empty-state">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="empty-inner">
        <div className="empty-mark" aria-hidden>
          <Tortoise size={96} walking ground />
        </div>
        <h2>{unknown ? 'Kachua can’t tell what this is yet' : 'Paste a config. Watch it wire itself.'}</h2>
        <p>
          {unknown
            ? 'Pick a format in the top bar, or start from a sample.'
            : 'OpenTelemetry Collector, CloudFormation, Terraform or Ansible. Drop a file anywhere, or start from one of these.'}
        </p>
        <div className="empty-samples">
          {SAMPLES.map((s, i) => {
            const v = FORMAT_VISUAL[s.format];
            const Icon = v.icon;
            return (
              <motion.button
                key={s.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.06, duration: 0.5, ease }}
                className="sample-card"
                style={{ '--c': v.color } as CSSProperties}
                onClick={() => set({ text: s.text, mode: 'auto', selectedId: null })}
              >
                <Icon size={16} />
                <b>{s.title}</b>
                <span>{s.blurb}</span>
              </motion.button>
            );
          })}
        </div>
      </motion.div>
    </div>
  );
}
