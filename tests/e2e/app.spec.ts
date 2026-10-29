import { expect, test as base, type Page } from '@playwright/test';

/** Every test fails if the page logs an error or throws. */
const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', (e) => errors.push(String(e)));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

const nodes = (page: Page) => page.getByTestId('graph-node');
const node = (page: Page, id: string) => page.locator(`[data-node-id="${id}"]`);
const statNodes = (page: Page) => page.getByTestId('stat-nodes');

async function boot(page: Page) {
  await page.goto('/');
  await expect(nodes(page).first()).toBeVisible();
  // let the one-shot boot curtain lift
  await expect(page.locator('.boot')).toHaveCount(0);
}

async function loadSample(page: Page, format: string) {
  await page.getByTestId('samples-btn').click();
  await page.getByTestId(`sample-${format}`).click();
}

/** Replaces the editor's whole content in one edit (no transient empty document). */
async function setSource(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  if (text) await page.keyboard.insertText(text);
  else await page.keyboard.press('Delete');
}

const MINI_OTEL = `receivers:
  otlp: {}
processors:
  batch: {}
exporters:
  debug: {}
service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [debug]
`;

test.describe('boot & detection', () => {
  test('opens on the OTel sample, laid out as pipeline lanes', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('hud')).toContainText('OpenTelemetry');
    await expect(statNodes(page)).toHaveText('22');
    await expect(page.getByTestId('lane')).toHaveCount(4);
    await expect(page.getByTestId('count-warning')).toHaveText('1');
    await expect(page.locator('.fs-opt[data-detected="true"]')).toContainText('OTel');
  });

  for (const [format, label, minNodes] of [
    ['cloudformation', 'CloudFormation', 18],
    ['terraform', 'Terraform', 19],
    ['ansible', 'Ansible', 18],
  ] as const) {
    test(`auto-detects and renders the ${label} sample`, async ({ page }) => {
      await boot(page);
      await loadSample(page, format);
      await expect(page.getByTestId('hud')).toContainText(label);
      await expect(statNodes(page)).toHaveText(String(minNodes));
      await expect(nodes(page)).toHaveCount(minNodes);
      await expect(page.locator('.react-flow__edge').first()).toBeAttached();
    });
  }

  test('restores the last session after reload', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'terraform');
    await expect(page.getByTestId('hud')).toContainText('Terraform');
    await page.waitForTimeout(600); // storage write is debounced
    await page.reload();
    await expect(page.getByTestId('hud')).toContainText('Terraform');
  });
});

test.describe('live editing', () => {
  test('graph follows the text as you type', async ({ page }) => {
    await boot(page);
    await setSource(page, MINI_OTEL);
    await expect(statNodes(page)).toHaveText('3');
    await expect(node(page, 'traces::exporters::debug')).toBeVisible();

    // Add a second exporter → a new node blooms in.
    await setSource(page, MINI_OTEL.replace('debug: {}', 'debug: {}\n  otlp/2: {}').replace('[debug]', '[debug, otlp/2]'));
    await expect(statNodes(page)).toHaveText('4');
    await expect(node(page, 'traces::exporters::otlp/2')).toBeVisible();
  });

  test('flags undefined components and badges the node', async ({ page }) => {
    await boot(page);
    await setSource(page, MINI_OTEL.replace('[debug]', '[debug, ghost]'));
    await expect(page.getByTestId('count-error')).toHaveText('1');
    await expect(page.getByTestId('problems-list')).toContainText('Exporter "ghost" used in pipeline "traces" is not defined');
    await expect(page.locator('.cm-lint-marker-error').first()).toBeVisible();
  });

  test('a syntax error keeps the last good graph and points at the line', async ({ page }) => {
    await boot(page);
    await setSource(page, MINI_OTEL);
    await expect(statNodes(page)).toHaveText('3');
    await setSource(page, MINI_OTEL + 'oops: [unclosed\n');
    const banner = page.getByTestId('error-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('showing last valid graph');
    await expect(nodes(page)).toHaveCount(3);
    await expect(page.locator('.sb-live')).toHaveText(/Syntax error/);
    await setSource(page, MINI_OTEL);
    await expect(banner).toBeHidden();
  });

  test('forcing a format overrides detection', async ({ page }) => {
    await boot(page);
    await page.getByTestId('format-switch').getByRole('button', { name: /TF/ }).click();
    await expect(page.getByTestId('error-banner')).toBeVisible(); // YAML is not HCL
    await page.getByTestId('format-switch').getByRole('button', { name: /Auto/ }).click();
    await expect(page.getByTestId('hud')).toContainText('OpenTelemetry');
  });

  test('shows the empty state with samples when the editor is cleared', async ({ page }) => {
    await boot(page);
    await setSource(page, '');
    await expect(page.getByTestId('empty-state')).toBeVisible();
    await page.getByTestId('empty-state').getByRole('button', { name: /Serverless API/ }).click();
    await expect(page.getByTestId('hud')).toContainText('CloudFormation');
  });
});

test.describe('graph ⇄ source linking', () => {
  test('clicking a node opens the inspector and highlights its source', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'terraform');
    await node(page, 'aws_security_group.web').click();
    const inspector = page.getByTestId('inspector');
    await expect(inspector).toBeVisible();
    await expect(page.getByTestId('inspector-title')).toHaveText('Security Group');
    await expect(inspector).toContainText('aws_security_group.web');
    await expect(page.getByTestId('blast-radius')).toHaveText('6');
    await expect(page.locator('.cm-node-line').first()).toBeVisible();
    await expect(page.locator('.cm-node-line').first()).toContainText('resource "aws_security_group" "web"');

    // Navigate upstream from the inspector.
    await inspector.getByRole('button', { name: /vpc/ }).click();
    await expect(page.getByTestId('inspector-title')).toHaveText('vpc');

    await page.keyboard.press('Escape');
    await expect(inspector).toBeHidden();
  });

  test('hovering traces lineage and dims everything else', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'cloudformation');
    // fit-view glides nodes for ~650ms; re-hover until the target sits still under the cursor
    await expect(async () => {
      await node(page, 'r:JobsQueue').hover();
      await expect(node(page, 'r:JobsQueue')).toHaveAttribute('data-state', 'focus', { timeout: 400 });
    }).toPass();
    await expect(node(page, 'r:JobsDLQ')).toHaveAttribute('data-state', 'lit'); // upstream
    await expect(node(page, 'r:WorkerEventSource')).toHaveAttribute('data-state', 'lit'); // downstream
    await expect(node(page, 'p:AlertEmail')).toHaveAttribute('data-state', 'dim');
    await expect(page.locator('.sedge[data-state="lit"]').first()).toBeAttached();
  });

  test('moving the editor cursor lights the node under it', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'terraform');
    await expect(page.getByTestId('hud')).toContainText('Terraform');
    await page.locator('.cm-line', { hasText: 'region = var.region' }).click();
    await expect(node(page, 'provider.aws')).toHaveAttribute('data-state', 'focus');
    await expect(node(page, 'aws_s3_bucket.logs')).toHaveAttribute('data-state', 'lit');
    await expect(page.locator('.cm-activeLine')).toContainText('region = var.region');
    await expect(page.getByTestId('statusbar')).toContainText(/Ln \d+/);
  });

  test('clicking a problem jumps to the line and selects the node', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'ansible');
    await expect(page.getByTestId('hud')).toContainText('Ansible');
    await page.getByTestId('problems-list').getByRole('button', { name: /never notified/ }).click();
    await expect(page.getByTestId('inspector-title')).toHaveText('restart nginx');
    await expect(page.locator('.cm-activeLine')).toContainText('restart nginx');
  });
});

test.describe('infra architecture view', () => {
  test('groups resources into service lanes with inputs and outputs as chips', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'cloudformation');
    await expect(page.getByTestId('hud')).toContainText('CloudFormation');
    const zones = await page.getByTestId('lane').evaluateAll((els) => els.map((e) => e.getAttribute('data-zone')));
    expect(zones).toEqual(['inputs', 'network', 'security', 'compute', 'data', 'messaging', 'observe', 'outputs']);
    await expect(node(page, 'p:Stage')).toHaveClass(/is-compact/);
    await expect(node(page, 'r:ApiFunction')).not.toHaveClass(/is-compact/);
    await expect(node(page, 'r:ApiFunction')).toContainText('Function');
  });

  test('dependencies read left → right', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'terraform');
    await expect(page.getByTestId('hud')).toContainText('Terraform');
    await page.waitForTimeout(900);
    const x = async (id: string) => (await node(page, id).boundingBox())!.x;
    expect(await x('module.vpc')).toBeLessThan(await x('aws_lb.web'));
    expect(await x('aws_lb.web')).toBeLessThan(await x('aws_lb_listener.https'));
    expect(await x('aws_lb_listener.https')).toBeLessThan(await x('aws_autoscaling_group.web'));
    await expect(node(page, 'aws_lb.web')).toContainText('LB');
  });

  test('AWS resources show official AWS Architecture icons', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'cloudformation');
    await expect(page.getByTestId('hud')).toContainText('CloudFormation');
    const icon = (id: string) => node(page, id).getByTestId('aws-icon');
    await expect(icon('r:ApiFunction')).toHaveAttribute('src', /AWSLambda/);
    await expect(icon('r:ItemsTable')).toHaveAttribute('src', /AmazonDynamoDB/);
    await expect(icon('r:JobsQueue')).toHaveAttribute('src', /AmazonSimpleQueueService/);
    await expect(icon('r:HttpApi')).toHaveAttribute('src', /AmazonAPIGateway/);
    // the SVG actually loads
    expect(await icon('r:ApiFunction').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    // non-resource nodes keep their glyphs
    await expect(icon('p:Stage')).toHaveCount(0);

    await loadSample(page, 'terraform');
    await expect(page.getByTestId('hud')).toContainText('Terraform');
    await expect(icon('aws_security_group.web')).toHaveAttribute('src', /AmazonVirtualPrivateCloud/);
    await expect(icon('aws_lb_listener.https')).toHaveAttribute('src', /ElasticLoadBalancing/);
    await expect(icon('module.vpc')).toHaveAttribute('src', /AmazonVirtualPrivateCloud/);
    await node(page, 'aws_s3_bucket.logs').click();
    await expect(page.locator('.ins-aws')).toHaveAttribute('src', /AmazonSimpleStorageService/);
  });

  test('input wiring stays hidden until hovered or toggled on', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'terraform');
    await expect(page.getByTestId('hud')).toContainText('Terraform');
    const providerEdge = page.locator('[data-testid="rf__edge-depends:provider.aws->aws_s3_bucket.logs"] .sedge-line');
    await expect(providerEdge).toHaveCount(0);
    await page.getByTestId('toggle-wiring').click();
    await expect(providerEdge).toHaveCount(1);
    await page.keyboard.press('w');
    await expect(providerEdge).toHaveCount(0);
    // hovering the input reveals its wiring
    await expect(async () => {
      await node(page, 'provider.aws').hover();
      await expect(providerEdge).toHaveCount(1, { timeout: 400 });
    }).toPass();
  });
});

test.describe('chrome', () => {
  test('command palette jumps to a node', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'cloudformation');
    await expect(page.getByTestId('hud')).toContainText('CloudFormation');
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByTestId('palette');
    await expect(palette).toBeVisible();
    await page.keyboard.type('workerevent');
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
    await expect(page.getByTestId('inspector-title')).toHaveText('WorkerEventSource');
  });

  test('command palette runs actions and loads samples', async ({ page }) => {
    await boot(page);
    await page.getByTestId('open-palette').click();
    await page.keyboard.type('playbook');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('hud')).toContainText('Ansible');
  });

  test('share link round-trips the config through the URL', async ({ page, context }) => {
    await boot(page);
    await setSource(page, MINI_OTEL);
    await expect(statNodes(page)).toHaveText('3');
    await page.getByTestId('share').click();
    await expect(page.getByTestId('toast')).toContainText('Share link copied');
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(url).toContain('#s=');

    const fresh = await context.newPage();
    await fresh.goto(url);
    await expect(fresh.getByTestId('stat-nodes')).toHaveText('3');
    await expect(fresh.locator('.cm-content')).toContainText('exporters: [debug]');
  });

  test('opens a file from disk', async ({ page }) => {
    await boot(page);
    await page.getByTestId('file-input').setInputFiles({
      name: 'main.tf',
      mimeType: 'text/plain',
      buffer: Buffer.from('variable "name" {}\nresource "aws_s3_bucket" "b" {\n  bucket = var.name\n}\n'),
    });
    await expect(page.getByTestId('toast')).toContainText('Loaded main.tf');
    await expect(page.getByTestId('hud')).toContainText('Terraform');
    await expect(statNodes(page)).toHaveText('2');
  });

  test('accepts a dropped file', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.items.add(new File(['Resources:\n  Q:\n    Type: AWS::SQS::Queue\n'], 'stack.yaml'));
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt }));
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt }));
    });
    await expect(page.getByTestId('hud')).toContainText('CloudFormation');
    await expect(statNodes(page)).toHaveText('1');
  });

  test('legend toggles hide a kind', async ({ page }) => {
    await boot(page);
    await loadSample(page, 'terraform');
    await expect(nodes(page)).toHaveCount(19);
    await page.getByTestId('legend').getByRole('button', { name: /Variable/ }).click();
    await expect(nodes(page)).toHaveCount(15);
    await page.getByTestId('legend').getByRole('button', { name: /Variable/ }).click();
    await expect(nodes(page)).toHaveCount(19);
  });

  test('layout direction flips for Ansible and is locked for lane views', async ({ page }) => {
    await boot(page);
    await expect(page.getByTestId('toggle-direction')).toBeDisabled();
    await loadSample(page, 'terraform');
    await expect(page.getByTestId('hud')).toContainText('Terraform');
    await expect(page.getByTestId('toggle-direction')).toBeDisabled();
    await loadSample(page, 'ansible');
    await expect(page.getByTestId('hud')).toContainText('Ansible');
    const delta = async () => {
      const a = (await node(page, 'play0').boundingBox())!;
      const b = (await node(page, 'play1').boundingBox())!;
      return { dx: b.x - a.x, dy: b.y - a.y };
    };
    await page.waitForTimeout(900);
    expect((await delta()).dy).toBeGreaterThan(0); // TB: later play is below
    await page.getByTestId('toggle-direction').click();
    await page.waitForTimeout(1400);
    expect((await delta()).dx).toBeGreaterThan(0); // LR: later play is to the right
  });

  test('exports a PNG', async ({ page }) => {
    await boot(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('export-png').click();
    const d = await download;
    expect(d.suggestedFilename()).toBe('kachua-otel.png');
  });

  test('shortcut help opens with ?', async ({ page }) => {
    await boot(page);
    await page.locator('.react-flow__pane').click({ position: { x: 20, y: 300 } });
    await page.keyboard.press('?');
    await expect(page.getByTestId('help')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('help')).toBeHidden();
  });
});

test.describe('seo', () => {
  test('ships title, description, social cards, structured data and manifest', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Kachua/);
    const meta = (sel: string) => page.locator(sel).first().getAttribute('content');
    expect((await meta('meta[name="description"]'))!.length).toBeGreaterThan(80);
    expect(await meta('meta[property="og:title"]')).toContain('Kachua');
    expect(await meta('meta[property="og:image"]')).toMatch(/og-image\.png$/);
    expect(await meta('meta[name="twitter:card"]')).toBe('summary_large_image');
    expect(await page.locator('link[rel="canonical"]').getAttribute('href')).not.toContain('%VITE_SITE_URL%');
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    expect(ld['@type']).toBe('SoftwareApplication');
    for (const path of ['/og-image.png', '/site.webmanifest', '/robots.txt', '/apple-touch-icon.png', '/icon-512.png'])
      expect((await request.get(path)).status(), path).toBe(200);
    expect((await (await request.get('/site.webmanifest')).json()).short_name).toBe('Kachua');
  });
});

test.describe('phone (touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function openSample(page: Page, format: string, label: string) {
    await page.getByTestId('more-btn').tap();
    await page.getByTestId(`more-sample-${format}`).tap();
    await expect(page.getByTestId('hud')).toContainText(label);
    await page.waitForTimeout(900); // framing animation
  }

  test('switches between source and graph with the tab bar', async ({ page }) => {
    await boot(page);
    const tabs = page.locator('.tabbar');
    await expect(page.getByTestId('editor')).toBeHidden();
    await expect(page.getByTestId('statusbar')).toBeHidden();
    await tabs.getByRole('button', { name: /Source/ }).tap();
    await expect(page.getByTestId('editor')).toBeVisible();
    await expect(page.getByTestId('canvas')).toBeHidden();
    await expect(tabs.locator('.tab-badge')).toHaveText('1'); // OTel sample: one warning
    await tabs.getByRole('button', { name: /Graph/ }).tap();
    await expect(page.getByTestId('canvas')).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('infra lanes wrap to the screen width instead of scrolling sideways', async ({ page }) => {
    await boot(page);
    await openSample(page, 'cloudformation', 'CloudFormation');
    for (const id of ['r:ItemsTable', 'r:ApiFunction', 'r:HttpApi', 'r:ErrorAlarm']) {
      const box = (await node(page, id).boundingBox())!;
      expect(box.x, id).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, id).toBeLessThanOrEqual(390);
    }
  });

  test('tapping a node opens a bottom sheet and keeps the node visible above it', async ({ page }) => {
    await boot(page);
    await openSample(page, 'cloudformation', 'CloudFormation');
    await node(page, 'r:HttpApi').tap();
    const sheet = page.getByTestId('inspector');
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId('inspector-title')).toHaveText('HttpApi');
    await page.waitForTimeout(900); // centring animation
    const s = (await sheet.boundingBox())!;
    const n = (await node(page, 'r:HttpApi').boundingBox())!;
    expect(s.width).toBeGreaterThan(340); // full-width sheet, not a side panel
    expect(n.y + n.height).toBeLessThanOrEqual(s.y);
    expect(n.y).toBeGreaterThan(0);
  });

  test('a tap does not leave a stuck hover highlight', async ({ page }) => {
    await boot(page);
    await openSample(page, 'cloudformation', 'CloudFormation');
    await node(page, 'r:HttpApi').tap();
    await expect(page.locator('[data-state="dim"]').first()).toBeAttached();
    await page.getByTestId('inspector').getByRole('button', { name: 'Close inspector' }).tap();
    await page.locator('.react-flow__pane').tap({ position: { x: 20, y: 600 } });
    await expect(page.locator('.snode[data-state="dim"]')).toHaveCount(0);
  });

  test('search opens the command palette', async ({ page }) => {
    await boot(page);
    await page.getByTestId('mobile-search').tap();
    await expect(page.getByTestId('palette')).toBeVisible();
  });

  test('OpenTelemetry pipelines flow top to bottom', async ({ page }) => {
    await boot(page);
    const a = (await node(page, 'traces::receivers::otlp').boundingBox())!;
    const b = (await node(page, 'traces::processors::memory_limiter').boundingBox())!;
    expect(b.y).toBeGreaterThan(a.y + a.height);
    expect(a.x + a.width).toBeLessThanOrEqual(390);
  });
});

test.describe('tablet & desktop sizes', () => {
  test('tablet portrait fits the whole CloudFormation stack across', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await boot(page);
    await page.getByTestId('more-btn').click();
    await page.getByTestId('more-sample-cloudformation').click();
    await expect(page.getByTestId('hud')).toContainText('CloudFormation');
    await page.waitForTimeout(900);
    const right = await page.getByTestId('graph-node').evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
    expect(right).toBeLessThanOrEqual(768);
  });

  test('a narrow canvas next to the editor uses the bottom sheet and hides the toolbar', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await boot(page);
    await loadSample(page, 'cloudformation');
    await expect(page.getByTestId('hud')).toContainText('CloudFormation');
    await page.waitForTimeout(900);
    await node(page, 'r:ItemsTable').click();
    await expect(page.getByTestId('inspector')).toBeVisible();
    await expect(page.locator('.toolbar')).toBeHidden();
    await expect(page.locator('.minimap')).toBeHidden();
  });

  test('large screens get a roomier editor', async ({ page }) => {
    await page.setViewportSize({ width: 2560, height: 1440 });
    await boot(page);
    const size = await page.locator('.cm-editor').evaluate((el) => getComputedStyle(el).fontSize);
    expect(size).toBe('14.5px');
    const editorW = (await page.getByTestId('editor').boundingBox())!.width;
    expect(editorW).toBeGreaterThan(500);
  });
});
