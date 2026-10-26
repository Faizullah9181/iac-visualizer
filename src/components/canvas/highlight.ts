import { createContext, useContext } from 'react';

export interface Highlight {
  /** A node is being hovered, selected or pointed at by the editor cursor. */
  active: boolean;
  focusId: string | null;
  /** Nodes on the focus node's upstream/downstream paths (incl. itself). */
  lit: Set<string>;
  edges: Set<string>;
  /** Nodes that appeared in the latest re-parse. */
  fresh: Set<string>;
  reducedMotion: boolean;
}

export const HighlightContext = createContext<Highlight>({
  active: false,
  focusId: null,
  lit: new Set(),
  edges: new Set(),
  fresh: new Set(),
  reducedMotion: false,
});

export const useHighlight = () => useContext(HighlightContext);
