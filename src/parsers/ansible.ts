import type { Diagnostic, GEdge, GGroup, GNode, Graph, ParseResult } from '../core/types';
import { pushEdge } from '../core/types';
import { entries, get, isMap, isSeq, parseYaml, preview, str, strList, type YamlSource } from './yamlDoc';

const TASK_KEYWORDS = new Set([
  'name', 'when', 'loop', 'loop_control', 'register', 'notify', 'tags', 'become', 'become_user', 'become_method',
  'vars', 'ignore_errors', 'changed_when', 'failed_when', 'delegate_to', 'delegate_facts', 'run_once', 'until',
  'retries', 'delay', 'environment', 'no_log', 'listen', 'check_mode', 'diff', 'async', 'poll', 'args', 'block',
  'rescue', 'always', 'any_errors_fatal', 'throttle', 'timeout', 'debugger', 'collections', 'module_defaults',
  'connection', 'remote_user', 'ignore_unreachable', 'local_action',
]);

const PLAY_SECTIONS = ['pre_tasks', 'roles', 'tasks', 'post_tasks'] as const;

/** `ansible.builtin.apt` → `apt`. */
const shortModule = (m: string) => m.split('.').pop() ?? m;

export function moduleOf(task: unknown): string | undefined {
  for (const [k] of entries(task)) if (!TASK_KEYWORDS.has(k) && !k.startsWith('with_')) return k;
  return undefined;
}

export function isPlaybook(root: unknown) {
  return isSeq(root) && root.items.some((p) => isMap(p) && (get(p, 'hosts') !== undefined || importPlaybook(p) !== undefined));
}

function importPlaybook(p: unknown) {
  return str(get(p, 'import_playbook') ?? get(p, 'ansible.builtin.import_playbook'));
}

export function parseAnsible(text: string): ParseResult {
  const parsed = parseYaml(text);
  if (!parsed.ok) return { graph: null, error: parsed.error };
  return { graph: buildAnsible(parsed.src) };
}

export function buildAnsible(src: YamlSource): Graph {
  const root = src.doc.contents;
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const groups: GGroup[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();

  if (!isSeq(root)) {
    diagnostics.push({ severity: 'error', message: 'A playbook is a list of plays (or a list of tasks)', line: 1 });
    return { format: 'ansible', nodes, edges, groups, diagnostics };
  }

  // A bare task list (roles/x/tasks/main.yml) is treated as one implicit play.
  const plays: unknown[] = isPlaybook(root) ? root.items : [null];
  let prevTail: string | null = null;

  plays.forEach((play, pi) => {
    const pid = `play${pi}`;
    const imported = play ? importPlaybook(play) : undefined;
    const hosts = play ? strList(get(play, 'hosts')).join(', ') : undefined;
    const title = imported ? `import ${imported}` : str(get(play, 'name')) ?? (play ? `play on ${hosts ?? '?'}` : 'tasks');
    groups.push({ id: pid, label: title, sub: hosts, line: play ? src.lineOf(play) : 1 });

    const meta: [string, string][] = [];
    if (play) for (const [k, v] of entries(play)) if (!PLAY_SECTIONS.includes(k as never) && k !== 'handlers') meta.push([k, preview(v)]);
    nodes.push({
      id: pid,
      label: title,
      kind: 'play',
      sub: imported ? 'import_playbook' : hosts ? `hosts: ${hosts}` : 'task list',
      tag: play ? `play ${pi + 1}` : undefined,
      line: play ? src.lineOf(play) : 1,
      endLine: play ? src.endLineOf(play) : undefined,
      group: pid,
      meta,
    });
    if (prevTail) pushEdge(edges, seen, { source: prevTail, target: pid, kind: 'flow' });
    if (play && !imported && hosts === undefined)
      diagnostics.push({ severity: 'error', message: `Play "${title}" has no hosts`, line: src.lineOf(play) });
    if (imported) {
      prevTail = pid;
      return;
    }

    let counter = 0;
    const registered = new Map<string, string>(); // var → task id
    const notifies: { from: string; handler: string; line?: number }[] = [];

    /** Adds a task node; returns its id. */
    const addTask = (task: unknown, kind: 'task' | 'handler' | 'block', section: string): string => {
      const id = `${pid}:${kind[0]}${counter++}`;
      const mod = moduleOf(task);
      const name = str(get(task, 'name'));
      const line = src.lineOf(task);
      const meta: [string, string][] = [['section', section]];
      for (const [k, v] of entries(task)) if (!['block', 'rescue', 'always'].includes(k)) meta.push([k, preview(v)]);
      const short = mod ? shortModule(mod) : kind === 'block' ? 'block' : '?';
      nodes.push({
        id,
        label: name ?? (kind === 'block' ? 'block' : short),
        kind,
        sub: kind === 'block' ? `block · ${entries(task).length} keys` : mod ?? 'unknown module',
        tag: get(task, 'when') !== undefined ? 'when' : get(task, 'loop') !== undefined || entries(task).some(([k]) => k.startsWith('with_')) ? 'loop' : undefined,
        line,
        endLine: src.endLineOf(task),
        group: pid,
        meta,
      });

      if (kind !== 'block' && !name)
        diagnostics.push({ severity: 'info', message: `Unnamed ${kind} using "${short}" — name it for readable output`, line });
      if (kind !== 'block' && !mod)
        diagnostics.push({ severity: 'error', message: `${kind === 'handler' ? 'Handler' : 'Task'} "${name ?? '?'}" has no module/action`, line });
      if ((short === 'shell' || short === 'command') && get(task, 'changed_when') === undefined && kind !== 'handler')
        diagnostics.push({ severity: 'info', message: `"${name ?? short}": ${short} without changed_when always reports changed`, line });
      for (const [k] of entries(task))
        if (k.startsWith('with_')) diagnostics.push({ severity: 'info', message: `"${name ?? short}": prefer \`loop\` over \`${k}\``, line });

      for (const h of strList(get(task, 'notify'))) notifies.push({ from: id, handler: h, line: src.lineOf(get(task, 'notify')) });

      // register → later use in when/loop/args
      const body = JSON.stringify(
        Object.fromEntries(entries(task).filter(([k]) => !['name', 'register', 'block', 'rescue', 'always'].includes(k)).map(([k, v]) => [k, preview(v, 2000)])),
      );
      for (const [v, from] of registered) if (new RegExp(`\\b${escapeRe(v)}\\b`).test(body)) pushEdge(edges, seen, { source: from, target: id, kind: 'ref', label: v });
      const reg = str(get(task, 'register'));
      if (reg) registered.set(reg, id);
      return id;
    };

    /** Lays out a list of tasks as a chain starting after `head`. Returns the tail id. */
    const chain = (list: unknown, head: string, section: string, label?: string): string => {
      let tail = head;
      let first = true;
      if (!isSeq(list)) return tail;
      for (const task of list.items) {
        if (!isMap(task)) continue;
        const isBlock = get(task, 'block') !== undefined;
        const id = addTask(task, isBlock ? 'block' : 'task', section);
        pushEdge(edges, seen, { source: tail, target: id, kind: 'flow', label: first ? label : undefined });
        first = false;
        if (isBlock) {
          chain(get(task, 'block'), id, section);
          const rescue = get(task, 'rescue');
          const always = get(task, 'always');
          if (rescue) chain(rescue, id, section, 'rescue');
          if (always) chain(always, id, section, 'always');
        }
        tail = id;
      }
      return tail;
    };

    let tail = pid;
    if (play) {
      for (const section of PLAY_SECTIONS) {
        const list = get(play, section);
        if (section === 'roles') {
          if (!isSeq(list)) continue;
          for (const r of list.items) {
            const name = str(r) ?? str(get(r, 'role')) ?? str(get(r, 'name')) ?? '?';
            const id = `${pid}:role:${name}:${counter++}`;
            nodes.push({ id, label: name, kind: 'role', sub: 'role', tag: 'role', line: src.lineOf(r), endLine: src.endLineOf(r), group: pid, meta: entries(r).map(([k, v]) => [k, preview(v)]) });
            pushEdge(edges, seen, { source: tail, target: id, kind: 'flow' });
            tail = id;
          }
        } else tail = chain(list, tail, section, tail === pid && section !== 'tasks' ? section : undefined);
      }
    } else tail = chain(root, tail, 'tasks');

    // Handlers sit beside the chain, reached only by notify.
    const handlerByName = new Map<string, string>();
    const notified = new Set<string>();
    const handlers = play ? get(play, 'handlers') : undefined;
    if (isSeq(handlers))
      for (const h of handlers.items) {
        const id = addTask(h, 'handler', 'handlers');
        const name = str(get(h, 'name'));
        if (name) handlerByName.set(name, id);
        for (const topic of strList(get(h, 'listen'))) handlerByName.set(topic, id);
      }
    for (const n of notifies) {
      const target = handlerByName.get(n.handler);
      if (!target) {
        if (play) diagnostics.push({ severity: 'error', message: `notify "${n.handler}" — no handler with that name or listen topic`, line: n.line });
        continue;
      }
      notified.add(target);
      pushEdge(edges, seen, { source: n.from, target, kind: 'notify' });
    }
    for (const id of new Set(handlerByName.values()))
      if (!notified.has(id)) {
        const n = nodes.find((x) => x.id === id)!;
        diagnostics.push({ severity: 'warning', message: `Handler "${n.label}" is never notified`, line: n.line });
      }

    prevTail = tail;
  });

  return { format: 'ansible', nodes, edges, groups, diagnostics };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
