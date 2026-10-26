import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { memo, type CSSProperties } from 'react';
import { FileOutput, SlidersHorizontal } from 'lucide-react';
import { awsIconFor } from '../../core/awsIcons';
import { CATEGORY, SIGNAL_COLOR, visualFor } from '../../core/visual';
import { awsIconUrl } from '../awsIconUrl';
import { zoneColor, type LaneNodeData, type SchemaNodeData } from '../../layout/layout';
import { useHighlight } from './highlight';

function SchemaNodeView({ id, data, selected }: NodeProps<Node<SchemaNodeData, 'schema'>>) {
  const { node, dir, order, issues, issueSeverity, compact } = data;
  const v = visualFor(node.kind, node.category);
  const hl = useHighlight();
  const state = hl.focusId === id ? 'focus' : hl.lit.has(id) ? 'lit' : hl.active ? 'dim' : 'idle';
  const Icon = v.icon;
  const aws = awsIconUrl(awsIconFor(node));

  return (
    <div
      className={`snode ${aws ? 'has-aws' : ''} ${compact ? 'is-compact' : ''} ${selected ? 'is-selected' : ''} ${hl.fresh.has(id) ? 'is-fresh' : ''}`}
      data-state={state}
      data-kind={node.kind}
      data-testid="graph-node"
      data-node-id={id}
      title={node.sub ? `${node.label} — ${node.sub}` : node.label}
      style={{ '--c': v.color, '--i': Math.min(order, 60) } as CSSProperties}
    >
      <Handle id="in" type="target" position={dir === 'LR' ? Position.Left : Position.Top} className="shandle" isConnectable={false} />
      <Handle id="up" type="target" position={Position.Top} className="shandle" isConnectable={false} />
      <span className="snode-rail" />
      {aws ? (
        <img className="snode-aws" src={aws} alt="" draggable={false} data-testid="aws-icon" />
      ) : (
        <div className="snode-glyph">
          <Icon size={compact ? 13 : 15} strokeWidth={1.8} />
        </div>
      )}
      <div className="snode-text">
        <div className="snode-label">{node.label}</div>
        {node.sub && <div className="snode-sub">{node.sub}</div>}
      </div>
      {/* the provider tag is redundant once the official AWS icon is showing */}
      {node.tag && !(aws && node.tag === 'aws') && <span className="snode-tag">{node.tag}</span>}
      {issues > 0 && (
        <span className={`snode-issue sev-${issueSeverity}`} aria-label={`${issues} problem${issues > 1 ? 's' : ''}`}>
          {issues}
        </span>
      )}
      <Handle id="out" type="source" position={dir === 'LR' ? Position.Right : Position.Bottom} className="shandle" isConnectable={false} />
      <Handle id="down" type="source" position={Position.Bottom} className="shandle" isConnectable={false} />
    </div>
  );
}

export const SchemaNode = memo(SchemaNodeView);

function LaneNodeView({ data }: NodeProps<Node<LaneNodeData, 'lane'>>) {
  const { group, count, zone } = data;
  const color = zone ? zoneColor(zone) : SIGNAL_COLOR[group.sub ?? ''] ?? '#a1a1aa';
  const ZoneIcon = !zone ? null : zone === 'inputs' ? SlidersHorizontal : zone === 'outputs' ? FileOutput : CATEGORY[zone].icon;
  return (
    <div className={`lane ${zone ? `is-zone zone-${zone}` : ''}`} style={{ '--c': color } as CSSProperties} data-testid="lane" data-zone={zone}>
      <div className="lane-head">
        {ZoneIcon ? <ZoneIcon size={13} className="lane-icon" /> : <span className="lane-pulse" />}
        <span className="lane-name">{group.label}</span>
        {group.sub && group.sub !== group.label && <span className="lane-sub">{group.sub}</span>}
        <span className="lane-count">{count}</span>
      </div>
    </div>
  );
}

export const LaneNode = memo(LaneNodeView);
