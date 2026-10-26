/**
 * Official AWS Architecture icons from the `aws-icons` package. Each SVG is emitted as its
 * own file (see `assetsInlineLimit` in vite.config.ts) so the browser only fetches the
 * icons a graph actually uses.
 */
const files = import.meta.glob<string>(
  ['/node_modules/aws-icons/icons/architecture-service/*.svg', '/node_modules/aws-icons/icons/architecture-group/AWSCloudlogo.svg'],
  { query: '?url', import: 'default', eager: true },
);

const byStem = new Map(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace('.svg', ''), url]));

export const awsIconUrl = (stem: string | undefined) => (stem ? byStem.get(stem) : undefined);
