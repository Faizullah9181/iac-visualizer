/**
 * Kachua (कछुआ) — a line-art tortoise whose shell is a tiny graph.
 * `walking` animates legs, a bobbing body, data flowing through the shell, and a treadmill ground.
 * Keep in sync with the inline pre-React loader in index.html.
 */
export function Tortoise({ size = 40, walking = false, ground = false, className = '' }: { size?: number; walking?: boolean; ground?: boolean; className?: string }) {
  return (
    <svg
      className={`tortoise ${walking ? 'is-walking' : ''} ${className}`}
      width={size}
      height={(size * 48) / 72}
      viewBox="0 0 72 48"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ground && <path className="t-ground" d="M2 45.5 H70" />}
      {/* far legs sit behind the body */}
      <path className="t-leg t-leg-b t-far" d="M25 34 V40.5" />
      <path className="t-leg t-leg-a t-far" d="M49 34 V40.5" />
      <g className="t-body">
        <path className="t-tail" d="M12 30.5 L5.5 34 L12 34.5 Z" />
        <path className="t-neck" d="M54 31.5 C57.5 29 59 27.5 61 26.5" />
        <g className="t-head">
          <ellipse cx="64.2" cy="25" rx="6" ry="4.9" className="t-skin" />
          <circle cx="66" cy="23.6" r="1.25" className="t-eye" />
        </g>
        <path className="t-shell" d="M11 34 C11 18.5 21.5 9.5 34 9.5 C46.5 9.5 57 18.5 57 34 Z" />
        <path className="t-rim" d="M8.5 34 H59.5" />
        <g className="t-graph">
          <path className="t-edge" d="M23 27 L34 18 L45 27" />
          <path className="t-edge" d="M23 27 L34 29.5 L45 27" />
          <path className="t-edge" d="M34 18 L34 29.5" />
          <circle className="t-node n1" cx="23" cy="27" r="2.3" />
          <circle className="t-node n2" cx="34" cy="18" r="2.3" />
          <circle className="t-node n3" cx="45" cy="27" r="2.3" />
          <circle className="t-node n4 t-core" cx="34" cy="29.5" r="2.6" />
        </g>
      </g>
      <path className="t-leg t-leg-a" d="M19.5 34.5 V41.5" />
      <path className="t-leg t-leg-b" d="M45.5 34.5 V41.5" />
    </svg>
  );
}

/** The top-bar mark. Walks while the brand is hovered. */
export function Logo({ size = 40 }: { size?: number }) {
  return <Tortoise size={size} className="logo" />;
}
