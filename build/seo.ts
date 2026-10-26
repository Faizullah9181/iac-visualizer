import type { Plugin } from 'vite';

/**
 * SEO wiring that depends on where the app is deployed:
 * - fills `%VITE_SITE_URL%` in index.html (canonical, Open Graph, JSON-LD), falling back to
 *   site-relative URLs when unset;
 * - emits robots.txt always, and sitemap.xml when a site URL is configured.
 */
export function seo(siteUrl: string | undefined): Plugin {
  const origin = (siteUrl ?? '').trim().replace(/\/+$/, '');
  return {
    name: 'kachua-seo',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) => html.replaceAll('%VITE_SITE_URL%', origin),
    },
    generateBundle() {
      const robots = ['User-agent: *', 'Allow: /', ...(origin ? ['', `Sitemap: ${origin}/sitemap.xml`] : [])].join('\n');
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `${robots}\n` });
      if (!origin) return;
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${origin}/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>
`;
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
    },
  };
}
