import { useEffect } from 'react';
import { decodeShare, encodeShare, toMermaid } from '../core/graphUtils';
import { useStore } from '../core/store';
import { FORMATS, type Format } from '../core/types';
import { detectFormat, parse } from '../parsers';
import { SAMPLES, sampleFor } from '../samples';

const STORAGE_KEY = 'kachua:v1';

const store = () => useStore.getState();

export function loadText(text: string, mode: Format | 'auto' = 'auto') {
  store().set({ text, mode, selectedId: null, hoveredId: null, cursorId: null, hiddenKinds: [] });
}

export function loadSample(id: string) {
  const s = SAMPLES.find((x) => x.id === id);
  if (!s) return;
  loadText(s.text, 'auto');
  store().set({ direction: s.format === 'ansible' ? 'TB' : 'LR' });
}

const EXT_FORMAT: Record<string, Format> = { tf: 'terraform', hcl: 'terraform' };

export async function loadFile(file: File) {
  if (file.size > 2_000_000) {
    store().notify('File is over 2 MB — that is not a config', 'err');
    return;
  }
  const text = await file.text();
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  loadText(text, EXT_FORMAT[ext] ?? 'auto');
  store().notify(`Loaded ${file.name}`);
}

export function shareUrl() {
  const { text, mode } = store();
  return `${location.origin}${location.pathname}#s=${encodeShare({ text, mode })}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function share() {
  const url = shareUrl();
  history.replaceState(null, '', url);
  const ok = await copy(url);
  store().notify(ok ? 'Share link copied — the config lives in the URL' : 'Link is in the address bar', ok ? 'ok' : 'err');
}

export async function copyMermaid() {
  const { graph, direction } = store();
  if (!graph) return;
  const ok = await copy(toMermaid(graph, direction));
  store().notify(ok ? 'Mermaid flowchart copied' : 'Clipboard blocked', ok ? 'ok' : 'err');
}

export function setFormat(mode: Format | 'auto') {
  store().set({ mode, selectedId: null });
  if (mode === 'ansible') store().set({ direction: 'TB' });
  else if (mode !== 'auto') store().set({ direction: 'LR' });
}

/** Initial content: share link → last session → default sample. */
export function useBootstrap() {
  useEffect(() => {
    const fromHash = () => {
      const shared = decodeShare(location.hash);
      if (shared) {
        loadText(shared.text, shared.mode);
        return true;
      }
      return false;
    };
    if (!fromHash()) {
      let restored = false;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const j = JSON.parse(raw) as { text?: string; mode?: string; direction?: string };
          if (typeof j.text === 'string' && j.text.trim()) {
            const mode = FORMATS.find((f) => f === j.mode) ?? 'auto';
            loadText(j.text, mode);
            if (j.direction === 'TB' || j.direction === 'LR') store().set({ direction: j.direction });
            restored = true;
          }
        }
      } catch {
        /* storage unavailable — fall through to the sample */
      }
      if (!restored) loadSample(sampleFor('otel').id);
    }
    const onHash = () => void fromHash();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
}

/** Debounced parse on every edit; keeps the last good graph on syntax errors. */
export function useLiveParse() {
  const text = useStore((s) => s.text);
  const mode = useStore((s) => s.mode);
  const direction = useStore((s) => s.direction);

  useEffect(() => {
    const t = setTimeout(() => {
      const s = store();
      const t0 = performance.now();
      const detected = detectFormat(text);
      const format: Format = mode === 'auto' ? detected ?? s.format : mode;
      let result;
      try {
        result = parse(text, format);
      } catch (e) {
        result = { graph: null, error: { severity: 'error' as const, message: e instanceof Error ? e.message : String(e), line: 1 } };
      }
      const keepOld = !result.graph && result.error && s.graph?.format === format;
      const graph = result.graph ?? (keepOld ? s.graph : null);
      const ids = new Set(graph?.nodes.map((n) => n.id));
      // A new format gets its natural reading direction; after that the user's toggle wins.
      const direction = format !== s.format ? (format === 'ansible' ? 'TB' : 'LR') : s.direction;
      s.set({
        detected,
        format,
        direction,
        graph,
        error: result.error ?? null,
        parseMs: performance.now() - t0,
        selectedId: s.selectedId && ids.has(s.selectedId) ? s.selectedId : null,
        cursorId: s.cursorId && ids.has(s.cursorId) ? s.cursorId : null,
      });
    }, 140);
    return () => clearTimeout(t);
  }, [text, mode]);

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ text, mode, direction }));
      } catch {
        /* private mode */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [text, mode, direction]);
}

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || !!el.closest('.cm-editor'));
};

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = store();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        s.set({ paletteOpen: !s.paletteOpen });
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void share();
        return;
      }
      if (mod && e.key === '\\') {
        e.preventDefault();
        s.set({ editorOpen: !s.editorOpen });
        return;
      }
      if (e.key === 'Escape') {
        if (s.paletteOpen || s.helpOpen) s.set({ paletteOpen: false, helpOpen: false });
        else s.select(null);
        return;
      }
      if (mod || e.altKey || isTyping(e) || s.paletteOpen) return;
      switch (e.key) {
        case 'f':
          s.fitView();
          break;
        case 'l':
          if (s.graph?.format === 'ansible') s.set({ direction: s.direction === 'LR' ? 'TB' : 'LR' });
          break;
        case 'w':
          s.set({ showWiring: !s.showWiring });
          break;
        case '?':
          s.set({ helpOpen: !s.helpOpen });
          break;
        case '/':
          e.preventDefault();
          s.set({ paletteOpen: true });
          break;
        case 'e':
          s.set({ editorOpen: !s.editorOpen });
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
