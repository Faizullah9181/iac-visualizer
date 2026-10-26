import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDownLeft, ArrowUpRight, CircleAlert, CornerDownLeft, Info, Radar, TriangleAlert, X } from 'lucide-react';
import { useMemo, type CSSProperties } from 'react';
import { lineage, neighbours } from '../../core/graphUtils';
import { useStore } from '../../core/store';
import type { GEdge, Graph } from '../../core/types';
import { awsIconFor } from '../../core/awsIcons';
import { CATEGORY, KIND, visualFor } from '../../core/visual';
import { awsIconUrl } from '../awsIconUrl';

const SEV_ICON = { error: CircleAlert, warning: TriangleAlert, info: Info };

const BLAST_WORD: Record<string, string> = {
  otel: 'components downstream',
  cloudformation: 'resources affected if this changes',
  terraform: 'things affected if this changes',
  ansible: 'steps after this',
};

export function Inspector() {
  const graph = useStore((s) => s.graph);
  const selectedId = useStore((s) => s.selectedId);
  const node = selectedId ? graph?.nodes.find((n) => n.id === selectedId) : undefined;

  return (
    <AnimatePresence>
      {graph && node && (
        <motion.aside
          key="inspector"
          className="inspector glass"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
          data-testid="inspector"
          aria-label="Node details"
        >
          <InspectorBody graph={graph} id={node.id} />
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function InspectorBody({ graph, id }: { graph: Graph; id: string }) {
  const select = useStore((s) => s.select);
  const revealLine = useStore((s) => s.revealLine);
  const set = useStore((s) => s.set);
  const node = graph.nodes.find((n) => n.id === id)!;
  const v = visualFor(node.kind, node.category);
  const Icon = v.icon;
  const aws = awsIconUrl(awsIconFor(node));

  const { incoming, outgoing } = useMemo(() => neighbours(graph, id), [graph, id]);
  const blast = useMemo(() => lineage(graph, id).down.size, [graph, id]);
  const issues = graph.diagnostics.filter((d) => d.line && node.line && d.line >= node.line && d.line <= (node.endLine ?? node.line));

  const go = (otherId: string) => select(otherId, { reveal: true, focus: true });
  const label = (nid: string) => graph.nodes.find((n) => n.id === nid);

  const link = (e: GEdge, dir: 'in' | 'out') => {
    const other = label(dir === 'in' ? e.source : e.target);
    if (!other) return null;
    const ov = visualFor(other.kind, other.category);
    return (
      <li key={e.id}>
        <button className="ins-link" onClick={() => go(other.id)} onMouseEnter={() => set({ hoveredId: other.id })} onMouseLeave={() => set({ hoveredId: null })} style={{ '--c': ov.color } as CSSProperties}>
          {dir === 'in' ? <ArrowDownLeft size={12} /> : <ArrowUpRight size={12} />}
          <span className="ins-link-label">{other.label}</span>
          {(other.type ?? other.sub) && <span className="ins-link-sub">{other.type ?? other.sub}</span>}
          {e.kind !== 'flow' && <span className="ins-link-kind">{e.label ?? e.kind}</span>}
        </button>
      </li>
    );
  };

  return (
    <>
      <header className="ins-head" style={{ '--c': v.color } as CSSProperties}>
        {aws ? (
          <img className="ins-aws" src={aws} alt="" />
        ) : (
          <div className="ins-glyph">
            <Icon size={18} />
          </div>
        )}
        <div className="ins-title">
          <span className="ins-kind">
            {KIND[node.kind].label}
            {node.category && ` · ${CATEGORY[node.category].label}`}
          </span>
          <h3 data-testid="inspector-title">{node.label}</h3>
          {(node.type ?? node.sub) && <code>{node.type ?? node.sub}</code>}
        </div>
        <button className="icon-btn" onClick={() => select(null)} aria-label="Close inspector">
          <X size={15} />
        </button>
      </header>

      <div className="ins-actions">
        {node.line && (
          <button className="chip-btn" onClick={() => revealLine(node.line!, node.endLine)}>
            <CornerDownLeft size={12} /> Source L{node.line}
            {node.endLine && node.endLine !== node.line ? `–${node.endLine}` : ''}
          </button>
        )}
        <div className="blast" title="Transitive dependents">
          <Radar size={13} />
          <b data-testid="blast-radius">{blast}</b> {BLAST_WORD[graph.format]}
        </div>
      </div>

      <div className="ins-scroll">
        {issues.length > 0 && (
          <section>
            <h4>Problems</h4>
            <ul className="ins-issues">
              {issues.map((d, i) => {
                const SIcon = SEV_ICON[d.severity];
                return (
                  <li key={i} className={`sev-${d.severity}`}>
                    <SIcon size={12} /> {d.message}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {incoming.length > 0 && (
          <section>
            <h4>
              Upstream <span>{incoming.length}</span>
            </h4>
            <ul className="ins-links">{incoming.map((e) => link(e, 'in'))}</ul>
          </section>
        )}
        {outgoing.length > 0 && (
          <section>
            <h4>
              Downstream <span>{outgoing.length}</span>
            </h4>
            <ul className="ins-links">{outgoing.map((e) => link(e, 'out'))}</ul>
          </section>
        )}
        {node.meta && node.meta.length > 0 && (
          <section>
            <h4>Properties</h4>
            <dl className="ins-props">
              {node.meta.map(([k, val], i) => (
                <div key={`${k}-${i}`}>
                  <dt>{k}</dt>
                  <dd>{val}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </>
  );
}
