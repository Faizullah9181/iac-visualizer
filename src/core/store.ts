import { create } from 'zustand';
import type { Diagnostic, Format, Graph, Kind } from './types';
import type { Direction } from '../layout/layout';

export type Mode = Format | 'auto';

interface Pulse {
  nonce: number;
}

interface State {
  text: string;
  mode: Mode;
  /** Effective format after auto-detection. */
  format: Format;
  detected: Format | null;
  graph: Graph | null;
  /** Fatal parse error; `graph` keeps the last good result. */
  error: Diagnostic | null;
  parseMs: number;

  selectedId: string | null;
  hoveredId: string | null;
  /** Node under the editor cursor. */
  cursorId: string | null;
  cursorLine: number;

  direction: Direction;
  /** Infra views: draw input/output wiring even when nothing is focused. */
  showWiring: boolean;
  hiddenKinds: Kind[];
  editorOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  problemsOpen: boolean;
  mobileView: 'editor' | 'graph';

  /** Ask the editor to reveal a line range. */
  reveal: (Pulse & { line: number; endLine?: number }) | null;
  /** Ask the canvas to centre on a node. */
  focus: (Pulse & { id: string }) | null;
  fit: Pulse | null;
  exportReq: Pulse | null;
  toast: (Pulse & { text: string; tone?: 'ok' | 'err' }) | null;

  set: (p: Partial<State>) => void;
  setText: (text: string) => void;
  select: (id: string | null, opts?: { reveal?: boolean; focus?: boolean }) => void;
  revealLine: (line: number, endLine?: number) => void;
  focusNode: (id: string) => void;
  fitView: () => void;
  requestExport: () => void;
  notify: (text: string, tone?: 'ok' | 'err') => void;
  toggleKind: (k: Kind) => void;
}

let nonce = 0;
const n = () => ++nonce;

export const useStore = create<State>((set, get) => ({
  text: '',
  mode: 'auto',
  format: 'otel',
  detected: null,
  graph: null,
  error: null,
  parseMs: 0,
  selectedId: null,
  hoveredId: null,
  cursorId: null,
  cursorLine: 1,
  direction: 'LR',
  showWiring: false,
  hiddenKinds: [],
  editorOpen: true,
  paletteOpen: false,
  helpOpen: false,
  problemsOpen: true,
  mobileView: 'graph',
  reveal: null,
  focus: null,
  fit: null,
  exportReq: null,
  toast: null,

  set: (p) => set(p),
  setText: (text) => set({ text }),
  select: (id, opts) => {
    set({ selectedId: id });
    if (!id) return;
    const node = get().graph?.nodes.find((x) => x.id === id);
    if (opts?.reveal && node?.line) get().revealLine(node.line, node.endLine);
    if (opts?.focus) get().focusNode(id);
  },
  revealLine: (line, endLine) => set({ reveal: { line, endLine, nonce: n() } }),
  focusNode: (id) => set({ focus: { id, nonce: n() } }),
  fitView: () => set({ fit: { nonce: n() } }),
  requestExport: () => set({ exportReq: { nonce: n() } }),
  notify: (text, tone = 'ok') => set({ toast: { text, tone, nonce: n() } }),
  toggleKind: (k) => set((s) => ({ hiddenKinds: s.hiddenKinds.includes(k) ? s.hiddenKinds.filter((x) => x !== k) : [...s.hiddenKinds, k] })),
}));
