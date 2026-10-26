import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';
import { useStore } from '../../core/store';
import type { SchemaEdgeData } from '../../layout/layout';
import { useHighlight } from './highlight';

/** Cheap stable hash → staggers comets so they don't march in lockstep. */
const phase = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
};

function SchemaEdgeView(props: EdgeProps<Edge<SchemaEdgeData, 'schema'>>) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd } = props;
  const hl = useHighlight();
  const showWiring = useStore((s) => s.showWiring);
  const kind = data?.kind ?? 'flow';
  const color = data?.color ?? '#a1a1aa';

  const backwards = sourcePosition === 'right' ? targetX < sourceX : targetY < sourceY;
  const [path, lx, ly] =
    !data?.bezier && (kind === 'bridge' || backwards)
      ? getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 16, offset: 26 })
      : getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.32 });

  const lit = hl.edges.has(id);
  // Input/output wiring stays out of the way until something on its path is focused.
  if (data?.quiet && !lit && !showWiring) return null;
  const state = lit ? 'lit' : hl.active ? 'dim' : 'idle';
  const comet = !hl.reducedMotion && state !== 'dim' && (kind === 'flow' || kind === 'bridge' || lit);
  const dur = kind === 'bridge' ? 3.2 : lit ? 1.4 : 2.6;

  return (
    <g className={`sedge k-${kind}`} data-state={state} style={{ '--c': color } as CSSProperties}>
      {lit && <path d={path} className="sedge-glow" />}
      <BaseEdge id={id} path={path} markerEnd={markerEnd} className="sedge-line" interactionWidth={14} />
      {comet && (
        <circle r={kind === 'bridge' ? 3.4 : 2.6} className="sedge-comet">
          <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} begin={`-${(phase(id) * dur).toFixed(2)}s`} />
        </circle>
      )}
      {data?.label && (
        <EdgeLabelRenderer>
          <div
            className="sedge-label nodrag nopan"
            data-state={state}
            data-always={kind !== 'ref'}
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, '--c': color } as CSSProperties}
          >
            {data.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}

export const SchemaEdge = memo(SchemaEdgeView);
