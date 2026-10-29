import { Code2, Waypoints } from 'lucide-react';
import { useBootstrap, useLiveParse, useShortcuts } from './app/actions';
import { Canvas } from './components/canvas/Canvas';
import { CommandPalette } from './components/chrome/CommandPalette';
import { BootIntro, DropZone, Resizer, ShortcutHelp, StatusBar, Toast } from './components/chrome/Misc';
import { TopBar } from './components/chrome/TopBar';
import { EditorPane } from './components/editor/EditorPane';
import { useStore } from './core/store';

export function App() {
  useBootstrap();
  useLiveParse();
  useShortcuts();
  const editorOpen = useStore((s) => s.editorOpen);
  const mobileView = useStore((s) => s.mobileView);
  const set = useStore((s) => s.set);
  const problems = useStore((s) => (s.graph?.diagnostics.filter((d) => d.severity !== 'info').length ?? 0) + (s.error ? 1 : 0));
  const hasErrors = useStore((s) => !!s.error || !!s.graph?.diagnostics.some((d) => d.severity === 'error'));

  return (
    <div className="app" data-editor={editorOpen} data-mobile-view={mobileView}>
      <div className="grain" aria-hidden />
      <TopBar />
      <main className="main">
        {editorOpen && (
          <>
            <EditorPane />
            <Resizer />
          </>
        )}
        <section className="stage" aria-label="Graph">
          <Canvas />
        </section>
      </main>
      <nav className="tabbar" aria-label="View">
        <button data-active={mobileView === 'editor'} aria-current={mobileView === 'editor'} onClick={() => set({ mobileView: 'editor', editorOpen: true })}>
          <Code2 size={18} />
          <span>Source</span>
          {problems > 0 && <i className="tab-badge" data-sev={hasErrors ? 'error' : 'warning'}>{problems}</i>}
        </button>
        <button data-active={mobileView === 'graph'} aria-current={mobileView === 'graph'} onClick={() => set({ mobileView: 'graph' })}>
          <Waypoints size={18} />
          <span>Graph</span>
        </button>
      </nav>
      <StatusBar />
      <CommandPalette />
      <ShortcutHelp />
      <DropZone />
      <Toast />
      <BootIntro />
    </div>
  );
}
