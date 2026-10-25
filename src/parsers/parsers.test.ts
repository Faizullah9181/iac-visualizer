import { describe, expect, it } from 'vitest';
import type { Graph } from '../core/types';
import { SAMPLES } from '../samples';
import { detectFormat, parse } from './index';

const ok = (g: Graph | null): Graph => {
  expect(g).not.toBeNull();
  return g!;
};
const has = (g: Graph, source: string, target: string, kind?: string) =>
  g.edges.some((e) => e.source === source && e.target === target && (!kind || e.kind === kind));
const msgs = (g: Graph) => g.diagnostics.map((d) => `${d.severity}: ${d.message}`);

describe('detectFormat', () => {
  it.each(SAMPLES.map((s) => [s.format, s] as const))('detects the %s sample', (format, s) => {
    expect(detectFormat(s.text)).toBe(format);
  });
  it('detects CloudFormation JSON', () => {
    expect(detectFormat('{"Resources":{"B":{"Type":"AWS::S3::Bucket"}}}')).toBe('cloudformation');
  });
  it('detects a bare Ansible task list', () => {
    expect(detectFormat('- name: hi\n  ansible.builtin.debug:\n    msg: x\n')).toBe('ansible');
  });
  it('returns null for prose', () => {
    expect(detectFormat('hello there, this is not config')).toBeNull();
  });
});

describe('every sample parses', () => {
  it.each(SAMPLES.map((s) => [s.id, s] as const))('%s', (_, s) => {
    const r = parse(s.text, s.format);
    expect(r.error).toBeUndefined();
    const g = ok(r.graph);
    expect(g.nodes.length).toBeGreaterThan(5);
    expect(g.edges.length).toBeGreaterThan(4);
    // Every edge endpoint resolves to a node.
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      expect(ids.has(e.source), `missing source ${e.source}`).toBe(true);
      expect(ids.has(e.target), `missing target ${e.target}`).toBe(true);
    }
    // Every node knows where it lives in the source.
    for (const n of g.nodes) expect(n.line, n.id).toBeGreaterThan(0);
  });
});

describe('otel', () => {
  const g = ok(parse(SAMPLES[0].text, 'otel').graph);
  it('builds one lane per pipeline plus extensions', () => {
    expect(g.groups.map((x) => x.id)).toEqual(['traces', 'metrics', 'logs', '__extensions']);
  });
  it('chains receivers → processors → exporters in order', () => {
    expect(has(g, 'traces::receivers::otlp', 'traces::processors::memory_limiter')).toBe(true);
    expect(has(g, 'traces::processors::memory_limiter', 'traces::processors::resource')).toBe(true);
    expect(has(g, 'traces::processors::batch', 'traces::exporters::otlp/tempo')).toBe(true);
  });
  it('bridges the spanmetrics connector across pipelines', () => {
    expect(has(g, 'traces::exporters::spanmetrics', 'metrics::receivers::spanmetrics', 'bridge')).toBe(true);
    expect(g.nodes.find((n) => n.id === 'metrics::receivers::spanmetrics')?.kind).toBe('connector');
  });
  it('flags defined-but-unused components', () => {
    expect(msgs(g)).toContain('warning: Exporter "debug" is defined but not used in any pipeline');
  });
  it('flags undefined components and bad processor order', () => {
    const bad = ok(
      parse(
        `receivers: {otlp: {}}\nprocessors: {batch: {}, memory_limiter: {}}\nexporters: {}\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      processors: [batch, memory_limiter]\n      exporters: [nope]\n`,
        'otel',
      ).graph,
    );
    const m = msgs(bad);
    expect(m).toContain('error: Exporter "nope" used in pipeline "traces" is not defined in `exporters`');
    expect(m).toContain('warning: "memory_limiter" should be the first processor in "traces"');
    expect(m).toContain('info: "batch" is usually placed after other processors in "traces"');
  });
  it('reports YAML syntax errors with a line', () => {
    const r = parse('receivers:\n  otlp: {\n', 'otel');
    expect(r.graph).toBeNull();
    expect(r.error?.line).toBeGreaterThan(0);
  });
});

describe('cloudformation', () => {
  const g = ok(parse(SAMPLES[1].text, 'cloudformation').graph);
  it('resolves short-form tags', () => {
    expect(has(g, 'r:JobsDLQ', 'r:JobsQueue')).toBe(true); // !GetAtt
    expect(has(g, 'r:ItemsTable', 'r:ApiFunction')).toBe(true); // !Ref
    expect(has(g, 'p:Stage', 'r:ItemsTable')).toBe(true); // !Sub ${Stage}
    expect(has(g, 'm:StageConfig', 'r:ApiFunction')).toBe(true); // !FindInMap
    expect(has(g, 'r:HttpApi', 'r:ApiInvokePermission')).toBe(true); // ${HttpApi} in Sub
  });
  it('wires DependsOn and Condition', () => {
    expect(has(g, 'r:ApiFunction', 'r:ErrorAlarm', 'depends')).toBe(true);
    expect(has(g, 'c:IsProd', 'r:ErrorAlarm')).toBe(true);
    expect(has(g, 'p:Stage', 'c:IsProd')).toBe(true);
  });
  it('ignores pseudo parameters and warns on unused params', () => {
    expect(msgs(g).filter((m) => m.startsWith('error'))).toEqual([]);
    expect(msgs(g)).toContain('warning: Parameter "TableReadCapacity" is never referenced');
  });
  it('categorises resources by service', () => {
    const cat = (id: string) => g.nodes.find((n) => n.id === id)?.category;
    expect(cat('r:ApiFunction')).toBe('compute');
    expect(cat('r:ItemsTable')).toBe('data');
    expect(cat('r:ApiRole')).toBe('security');
    expect(cat('r:JobsQueue')).toBe('messaging');
  });
  it('handles long-form JSON intrinsics', () => {
    const j = ok(
      parse(
        JSON.stringify({
          Resources: {
            A: { Type: 'AWS::S3::Bucket' },
            B: { Type: 'AWS::S3::BucketPolicy', Properties: { Bucket: { Ref: 'A' }, X: { 'Fn::GetAtt': ['A', 'Arn'] }, Y: { 'Fn::Sub': ['${V}-${A}', { V: 'x' }] } } },
          },
        }),
        'cloudformation',
      ).graph,
    );
    expect(has(j, 'r:A', 'r:B')).toBe(true);
    expect(j.diagnostics).toEqual([]);
  });
  it('reports unresolved refs and cycles', () => {
    const bad = ok(
      parse(
        'Resources:\n  A:\n    Type: AWS::SNS::Topic\n    Properties: {X: !Ref B}\n  B:\n    Type: AWS::SNS::Topic\n    Properties: {X: !GetAtt A.Arn, Y: !Ref Ghost}\n',
        'cloudformation',
      ).graph,
    );
    const m = msgs(bad);
    expect(m).toContain('error: B: unresolved Ref "Ghost"');
    expect(m.some((x) => x.startsWith('error: Circular dependency'))).toBe(true);
  });
});

describe('terraform', () => {
  const g = ok(parse(SAMPLES[2].text, 'terraform').graph);
  it('declares every block kind', () => {
    const ids = g.nodes.map((n) => n.id);
    for (const id of ['var.region', 'local.name', 'local.tags', 'data.aws_ami.ubuntu', 'module.vpc', 'aws_lb.web', 'output.lb_dns', 'provider.aws'])
      expect(ids).toContain(id);
  });
  it('finds references in expressions, interpolations and heredocs', () => {
    expect(has(g, 'var.env', 'local.name')).toBe(true); // "web-${var.env}"
    expect(has(g, 'local.name', 'aws_launch_template.web')).toBe(true); // heredoc
    expect(has(g, 'data.aws_ami.ubuntu', 'aws_launch_template.web')).toBe(true);
    expect(has(g, 'aws_lb_target_group.web', 'aws_lb_listener.https')).toBe(true); // nested block
    expect(has(g, 'module.vpc', 'aws_security_group.web')).toBe(true);
    expect(has(g, 'aws_lb_listener.https', 'aws_autoscaling_group.web', 'depends')).toBe(true);
    expect(has(g, 'provider.aws', 'aws_s3_bucket.logs', 'depends')).toBe(true);
  });
  it('does not treat literal strings as references', () => {
    expect(g.edges.some((e) => e.source.includes('hashicorp'))).toBe(false);
  });
  it('warns on unused variables', () => {
    expect(msgs(g)).toContain('warning: Variable "var.legacy_ami" is declared but never used');
  });
  it('errors on undeclared references and reports syntax errors with a line', () => {
    const bad = ok(parse('resource "aws_s3_bucket" "b" {\n  bucket = var.nope\n}\n', 'terraform').graph);
    expect(msgs(bad)).toContain('error: aws_s3_bucket.b: reference to undeclared variable "var.nope"');
    const broken = parse('resource "aws_s3_bucket" "b" {\n  bucket = "x"\n', 'terraform');
    expect(broken.graph).toBeNull();
    expect(broken.error?.message).toMatch(/closing/);
  });
});

describe('ansible', () => {
  const g = ok(parse(SAMPLES[3].text, 'ansible').graph);
  const byLabel = (l: string) => g.nodes.find((n) => n.label === l)!;
  it('chains pre_tasks → roles → tasks', () => {
    expect(has(g, 'play0', byLabel('Update apt cache').id, 'flow')).toBe(true);
    expect(has(g, byLabel('Update apt cache').id, byLabel('common').id, 'flow')).toBe(true);
    expect(has(g, byLabel('nginx').id, byLabel('Install runtime packages').id, 'flow')).toBe(true);
  });
  it('links notify to handlers and register to its consumer', () => {
    expect(has(g, byLabel('Clone repository').id, byLabel('restart app').id, 'notify')).toBe(true);
    expect(has(g, byLabel('Render systemd unit').id, byLabel('reload systemd').id, 'notify')).toBe(true);
    expect(has(g, byLabel('Check for existing release').id, byLabel('Clone repository').id, 'ref')).toBe(true);
  });
  it('runs plays in sequence', () => {
    expect(g.edges.some((e) => e.target === 'play1' && e.kind === 'flow')).toBe(true);
  });
  it('lints like ansible-lint', () => {
    const m = msgs(g);
    expect(m).toContain('warning: Handler "restart nginx" is never notified');
    expect(m).toContain('error: notify "page oncall" — no handler with that name or listen topic');
    expect(m).toContain('info: "Run migrations": command without changed_when always reports changed');
    expect(m).toContain('info: "Open firewall": prefer `loop` over `with_items`');
  });
});

describe('nodeAtLine', () => {
  it('prefers the innermost node over its enclosing play', async () => {
    const { nodeAtLine } = await import('../core/graphUtils');
    const g = ok(parse(SAMPLES[3].text, 'ansible').graph);
    const handler = g.nodes.find((n) => n.label === 'restart nginx')!;
    expect(nodeAtLine(g.nodes, handler.line!)?.id).toBe(handler.id);
  });
});
