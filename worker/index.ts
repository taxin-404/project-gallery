interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  PROJECT_REPO?: string;
  PROJECT_REPOS?: string;
  PROJECT_SITE?: string;
  PROJECTS_ROOT?: string;
  PREVIEW_MODE?: string;
  GITHUB_TOKEN?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type PreviewMode = 'proxy' | 'external';

interface GalleryConfig {
  projectRepos: string[];
  projectSite: string;
  projectsRoot: string;
  previewMode: PreviewMode;
}

interface GitHubTree {
  tree?: Array<{
    path: string;
    type: string;
  }>;
  truncated?: boolean;
}

interface DetectedProject {
  repo: string;
  folder: string;
  title: string;
  category: string;
  order: number;
  url: string;
}

interface RepoDetection {
  repo: string;
  projects: DetectedProject[];
  truncated: boolean;
  error?: string;
}

interface ProjectDetection {
  projects: DetectedProject[];
  truncated: boolean;
  warnings: Array<{ repo: string; error: string }>;
}

const CACHE_TTL_SECONDS = 300;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/config') {
      if (request.method !== 'GET') {
        return methodNotAllowed();
      }

      const config = await resolveConfig(env, request);

      return json(
        {
          projectRepo: config.projectRepos[0] ?? '',
          projectRepos: config.projectRepos,
          projectSite: config.projectSite,
          projectsRoot: config.projectsRoot,
          previewMode: config.previewMode,
          configured: config.projectRepos.length > 0,
        },
        200,
        { 'Cache-Control': 'no-store' },
      );
    }

    if (url.pathname === '/api/projects') {
      if (request.method !== 'GET') {
        return methodNotAllowed();
      }

      return projectsResponse(request, env, ctx);
    }

    if (url.pathname.startsWith('/preview/')) {
      return previewResponse(request, env, ctx);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

async function projectsResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const config = await resolveConfig(env, request);

  if (!config.projectRepos.length) {
    return json(
      {
        error: 'Set PROJECT_REPOS in the Cloudflare environment (or public/config.json).',
      },
      503,
      { 'Cache-Control': 'no-store' },
    );
  }

  if (config.previewMode === 'external' && !config.projectSite) {
    return json(
      {
        error:
          'PREVIEW_MODE is external, but PROJECT_SITE is not set. Set PROJECT_SITE or use PREVIEW_MODE=proxy.',
      },
      503,
      { 'Cache-Control': 'no-store' },
    );
  }

  const cacheUrl = new URL('/api/projects', request.url);
  cacheUrl.searchParams.set('repos', config.projectRepos.join(','));
  cacheUrl.searchParams.set('site', config.projectSite);
  cacheUrl.searchParams.set('root', config.projectsRoot);
  cacheUrl.searchParams.set('mode', config.previewMode);
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  const cached = await readCache(cacheKey);

  if (cached) {
    return noStore(cached);
  }

  const detection = await detectProjects(env, config);

  if (!detection.projects.length) {
    return json(
      {
        error: `No projects found under ${config.projectsRoot}/<category>/<folder>/index.html in ${config.projectRepos.join(', ')}.`,
        warnings: detection.warnings,
      },
      502,
      { 'Cache-Control': 'no-store' },
    );
  }

  const response = json(
    {
      projectRepo: config.projectRepos[0] ?? '',
      projectRepos: config.projectRepos,
      projectSite: config.projectSite,
      projectsRoot: config.projectsRoot,
      previewMode: config.previewMode,
      generatedAt: new Date().toISOString(),
      count: detection.projects.length,
      truncated: detection.truncated,
      warnings: detection.warnings,
      projects: detection.projects,
    },
    200,
    { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
  );

  writeCache(ctx, cacheKey, response.clone());
  return noStore(response);
}

async function previewResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return methodNotAllowed();
  }

  const config = await resolveConfig(env, request);

  if (!config.projectRepos.length) {
    return text('Project repository is not configured.', 503);
  }

  const url = new URL(request.url);
  const rawPath = url.pathname.slice('/preview/'.length);
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return text('Invalid preview path.', 400);
  }

  const segments = decodedPath.split('/');

  if (
    !segments.length ||
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'),
    )
  ) {
    return text('Invalid preview path.', 400);
  }

  const target = previewTarget(segments, config);

  if (!target || !target.pathSegments.length) {
    return text('Project file not found.', 404);
  }

  const path = target.pathSegments.map(encodeURIComponent).join('/');

  if (!path.startsWith(`${config.projectsRoot}/`)) {
    return text('Project file not found.', 404);
  }

  const cacheKey = new Request(`https://project-preview.cache/${target.repo}/${path}`, {
    method: 'GET',
  });

  if (request.method === 'GET') {
    const cached = await readCache(cacheKey);

    if (cached) {
      return withBackButton(request, cached);
    }
  }

  let upstream: Response;

  try {
    upstream = await fetch(`https://raw.githubusercontent.com/${target.repo}/HEAD/${path}`, {
      method: request.method,
      headers: {
        Accept: 'text/plain',
        'User-Agent': 'project-gallery',
      },
    });
  } catch {
    return text('Unable to fetch the project file.', 502);
  }

  if (!upstream.ok) {
    if (upstream.status === 404) {
      return text('Project file not found.', 404);
    }

    return text(`GitHub returned ${upstream.status}.`, 502);
  }

  const contentType = contentTypeFor(path);
  const headers = new Headers({
    'Cache-Control': 'public, max-age=300',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  });

  const response = new Response(request.method === 'HEAD' ? null : upstream.body, {
    status: 200,
    headers,
  });

  if (request.method === 'GET') {
    writeCache(ctx, cacheKey, response.clone());
  }

  return withBackButton(request, response);
}


const BACK_BUTTON_HTML = `
<style>
  html { animation: pg-page-in 0.45s ease-out both; }

  #pg-back {
    --pg-water: #2f81f7;
    --pg-ease: cubic-bezier(0.34, 1.56, 0.64, 1);
    position: fixed; left: 0; top: 50%; z-index: 2147483647;
    width: 36px; height: 190px; transform: translateY(-50%);
    font: 600 14px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-tap-highlight-color: transparent;
  }
  #pg-back, #pg-back * { box-sizing: border-box; }
  #pg-back:hover, #pg-back:focus-within { width: 210px; }

  /* Liquid layer: the goo filter fuses the edge blob and the drop into one body of water. */
  #pg-back .pg-goo {
    position: absolute; left: 0; top: 0; width: 210px; height: 100%;
    pointer-events: none;
    filter: url(#pg-goo) drop-shadow(0 6px 14px rgba(8, 40, 110, 0.55));
  }
  #pg-back .pg-edge, #pg-back .pg-drop { position: absolute; background: var(--pg-water); }
  #pg-back .pg-btn { position: absolute; }

  /* Resting state: a small breathing meniscus hugging the edge, tinted so people notice it. */
  #pg-back .pg-edge {
    left: -13px; top: 50%; width: 28px; height: 66px; margin-top: -33px;
    border-radius: 50%;
    animation: pg-breathe 3.2s ease-in-out infinite;
    transition: transform 0.5s var(--pg-ease);
  }
  #pg-back .pg-drop, #pg-back .pg-btn {
    left: 8px; top: 50%; width: 52px; height: 52px; margin-top: -26px; border-radius: 26px;
    transform: translateX(-52px) scale(0.2);
    transition: transform 0.6s var(--pg-ease), width 0.5s cubic-bezier(0.34, 1.25, 0.64, 1) 0.18s, opacity 0.12s ease;
  }

  /* Glassy, wet-looking face of the drop (sits above the filtered layer, so it stays crisp). */
  #pg-back .pg-btn {
    display: flex; align-items: center; gap: 9px; padding: 0 16px; overflow: hidden;
    color: #fff; text-decoration: none; white-space: nowrap; opacity: 0; pointer-events: none;
    background:
      radial-gradient(70% 55% at 30% 18%, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0) 70%),
      linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(0, 20, 80, 0.2)),
      rgba(47, 129, 247, 0.6);
    box-shadow:
      inset 0 1px 1.5px rgba(255, 255, 255, 0.7),
      inset 0 -7px 12px rgba(0, 25, 100, 0.4),
      0 0 0 1px rgba(255, 255, 255, 0.2);
    text-shadow: 0 1px 2px rgba(0, 20, 80, 0.5);
  }
  #pg-back .pg-btn svg { flex: none; display: block; transition: transform 0.3s ease; }
  #pg-back .pg-btn:hover svg { transform: translateX(-3px); }
  #pg-back .pg-label { opacity: 0; transform: translateX(-6px); transition: opacity 0.25s ease 0.3s, transform 0.3s ease 0.3s; }
  #pg-back .pg-btn:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }

  /* Open: hover, keyboard focus, or the one-time peek on load. */
  #pg-back:hover .pg-edge, #pg-back:focus-within .pg-edge, #pg-back.pg-open .pg-edge { transform: scale(1.35, 1.1) translateX(5px); }
  #pg-back:hover .pg-drop, #pg-back:focus-within .pg-drop, #pg-back.pg-open .pg-drop,
  #pg-back:hover .pg-btn, #pg-back:focus-within .pg-btn, #pg-back.pg-open .pg-btn { transform: none; width: 116px; opacity: 1; }
  #pg-back:hover .pg-label, #pg-back:focus-within .pg-label, #pg-back.pg-open .pg-label { opacity: 1; transform: none; }
  #pg-back:hover .pg-btn, #pg-back:focus-within .pg-btn { pointer-events: auto; cursor: pointer; }

  /* Ripples spreading from the drop once it lands. */
  #pg-back .pg-ripple {
    position: absolute; left: 8px; top: 50%; width: 116px; height: 52px; margin-top: -26px;
    border-radius: 26px; border: 2px solid rgba(121, 192, 255, 0.8); opacity: 0; pointer-events: none;
  }
  #pg-back:hover .pg-ripple, #pg-back:focus-within .pg-ripple, #pg-back.pg-open .pg-ripple {
    animation: pg-ripple 1.5s ease-out 0.55s 2;
  }

  @keyframes pg-breathe {
    0%, 100% { transform: scale(1, 1); }
    50% { transform: scale(1.25, 1.12) translateX(3px); }
  }
  @keyframes pg-ripple {
    0% { opacity: 0.8; transform: scale(1); }
    100% { opacity: 0; transform: scale(1.35, 1.9); }
  }
  @keyframes pg-page-in { from { opacity: 0; } to { opacity: 1; } }

  /* Touch screens: no hover, so keep a compact drop half-tucked into the edge. */
  @media (hover: none) {
    #pg-back, #pg-back:hover, #pg-back:focus-within { width: 60px; height: 90px; }
    #pg-back .pg-edge, #pg-back .pg-ripple, #pg-back .pg-label { display: none; }
    #pg-back .pg-drop, #pg-back .pg-btn {
      left: -16px; width: 62px; transform: none; opacity: 1; padding: 0 12px 0 22px;
    }
    #pg-back .pg-btn { pointer-events: auto; }
  }

  @media (prefers-reduced-motion: reduce) {
    html, #pg-back .pg-edge, #pg-back .pg-ripple { animation: none !important; }
    #pg-back .pg-drop, #pg-back .pg-btn, #pg-back .pg-edge, #pg-back .pg-label, #pg-back .pg-btn svg { transition: none; }
  }
</style>
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <defs>
    <filter id="pg-goo" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur"/>
      <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -9"/>
    </filter>
  </defs>
</svg>
<div id="pg-back">
  <div class="pg-goo" aria-hidden="true"><span class="pg-edge"></span><span class="pg-drop"></span></div>
  <span class="pg-ripple" aria-hidden="true"></span>
  <a class="pg-btn" href="/" aria-label="Back to gallery">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
    <span class="pg-label">Back</span>
  </a>
</div>
<script>
  (function () {
    var root = document.getElementById('pg-back');
    var link = root.querySelector('.pg-btn');
    link.addEventListener('click', function (event) {
      event.preventDefault();
      var fromGallery = document.referrer && document.referrer.indexOf(location.origin) === 0;
      if (fromGallery && history.length > 1) {
        history.back();
      } else {
        location.href = '/';
      }
    });
    // One-time peek so people learn the drop exists.
    setTimeout(function () {
      root.classList.add('pg-open');
      setTimeout(function () { root.classList.remove('pg-open'); }, 2400);
    }, 1000);
  })();
</script>`;

// Adds a floating "Back" button to project pages opened directly (not the gallery's
// preview iframes). Runs after the cache so the cached HTML stays untouched.
function withBackButton(request: Request, response: Response): Response {
  const isHtml = (response.headers.get('Content-Type') ?? '').includes('text/html');

  if (!isHtml || request.method !== 'GET' || !response.body) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.append('Vary', 'Sec-Fetch-Dest');

  // Iframes (the gallery cards) send Sec-Fetch-Dest: iframe, so they get the clean page.
  if (request.headers.get('Sec-Fetch-Dest') !== 'document') {
    return new Response(response.body, { status: response.status, headers });
  }

  const injected = new Response(response.body, { status: response.status, headers });

  return new HTMLRewriter()
    .onDocument({
      end(end) {
        end.append(BACK_BUTTON_HTML, { html: true });
      },
    })
    .transform(injected);
}

function previewTarget(
  segments: string[],
  config: GalleryConfig,
): { repo: string; pathSegments: string[] } | null {
  const candidateRepo = segments.length >= 2 ? normalizeRepo(`${segments[0]}/${segments[1]}`) : '';

  if (candidateRepo && config.projectRepos.includes(candidateRepo)) {
    return {
      repo: candidateRepo,
      pathSegments: segments.slice(2),
    };
  }

  // Keep old /preview/projects/... links working by treating them as the
  // first configured repository.
  if (segments[0] === config.projectsRoot) {
    return {
      repo: config.projectRepos[0],
      pathSegments: segments,
    };
  }

  return null;
}

async function detectProjects(env: Env, config: GalleryConfig): Promise<ProjectDetection> {
  const detections = await Promise.all(
    config.projectRepos.map((repo) => detectRepoProjects(env, config, repo)),
  );
  const projects: DetectedProject[] = [];
  const warnings: Array<{ repo: string; error: string }> = [];
  let truncated = false;

  for (const detection of detections) {
    projects.push(...detection.projects);
    truncated ||= detection.truncated;

    if (detection.error) {
      warnings.push({ repo: detection.repo, error: detection.error });
    }
  }

  projects.sort(compareProjects);
  return { projects, truncated, warnings };
}

async function detectRepoProjects(
  env: Env,
  config: GalleryConfig,
  repo: string,
): Promise<RepoDetection> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'project-gallery',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`,
      { headers },
    );

    if (!response.ok) {
      const hint =
        response.status === 403 || response.status === 429
          ? ' Add a GITHUB_TOKEN secret to raise the GitHub rate limit.'
          : response.status === 404
            ? ' Check that the repository exists and is public.'
            : '';

      throw new Error(`GitHub API returned ${response.status}.${hint}`);
    }

    const tree = (await response.json()) as GitHubTree;
    const prefix = `${config.projectsRoot}/`;
    const projects: DetectedProject[] = [];
    const encodedRepo = repo.split('/').map(encodeURIComponent).join('/');

    for (const entry of tree.tree ?? []) {
      if (
        entry.type !== 'blob' ||
        !entry.path.startsWith(prefix) ||
        !/\/index\.html?$/.test(entry.path)
      ) {
        continue;
      }

      const parts = entry.path.slice(prefix.length).split('/');

      if (parts.length !== 3) {
        continue;
      }

      const [category, folder] = parts;
      const encodedPath = entry.path.split('/').map(encodeURIComponent).join('/');

      projects.push({
        repo,
        folder,
        title: titleFromFolder(folder),
        category,
        order: orderFromFolder(folder),
        url:
          config.previewMode === 'external'
            ? `${config.projectSite}/${encodedPath}`
            : `/preview/${encodedRepo}/${encodedPath}`,
      });
    }

    projects.sort(compareProjects);
    return { repo, projects, truncated: Boolean(tree.truncated) };
  } catch (error) {
    return {
      repo,
      projects: [],
      truncated: false,
      error: errorMessage(error),
    };
  }
}

async function resolveConfig(env: Env, request: Request): Promise<GalleryConfig> {
  const envRepos = normalizeRepoList(env.PROJECT_REPOS);
  const envSingle = normalizeRepo(env.PROJECT_REPO);
  const envSite = normalizeSite(env.PROJECT_SITE);
  const envRoot = normalizeRoot(env.PROJECTS_ROOT);
  const envPreviewMode = normalizePreviewMode(env.PREVIEW_MODE);
  const defaults = await readDefaults(env, request);
  const defaultRepos = normalizeRepoList(
    defaults.projectRepos?.length ? defaults.projectRepos : defaults.projectRepo,
  );
  const projectRepos = dedupeRepos(
    envRepos.length
      ? [...envRepos, ...(envSingle ? [envSingle] : [])]
      : [...defaultRepos, ...(envSingle ? [envSingle] : [])],
  );

  return {
    projectRepos,
    projectSite: envSite || normalizeSite(defaults.projectSite),
    projectsRoot: envRoot || normalizeRoot(defaults.projectsRoot),
    previewMode: envPreviewMode ?? normalizePreviewMode(defaults.previewMode) ?? 'proxy',
  };
}

async function readDefaults(env: Env, request: Request): Promise<Partial<GalleryConfig>> {
  try {
    const configUrl = new URL('/config.json', request.url);
    const response = await env.ASSETS.fetch(
      new Request(configUrl.toString(), {
        headers: { Accept: 'application/json' },
      }),
    );

    if (!response.ok) {
      return {};
    }

    return (await response.json()) as Partial<GalleryConfig>;
  } catch {
    return {};
  }
}

async function readCache(key: Request): Promise<Response | null> {
  try {
    return await caches.default.match(key);
  } catch {
    return null;
  }
}

function writeCache(ctx: ExecutionContext, key: Request, response: Response): void {
  try {
    ctx.waitUntil(caches.default.put(key, response));
  } catch {
    // Caching is best-effort; the API response is still valid without it.
  }
}

function normalizeRepo(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function normalizeRepoList(value: string | string[] | null | undefined): string[] {
  const values = Array.isArray(value) ? value : (value ?? '').split(/[,\n]/);

  return dedupeRepos(values.map(normalizeRepo));
}

function dedupeRepos(repos: string[]): string[] {
  return [...new Set(repos.filter(Boolean))];
}

function normalizeSite(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function normalizeRoot(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^\/+|\/+$/g, '') || 'projects';
}

function normalizePreviewMode(value: string | null | undefined): PreviewMode | null {
  const mode = value?.trim().toLowerCase();

  if (mode === 'external') {
    return 'external';
  }

  if (mode === 'proxy') {
    return 'proxy';
  }

  return null;
}

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');

  if (dot === -1) {
    return 'application/octet-stream';
  }

  return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
};

function titleFromFolder(folder: string): string {
  return folder
    .replace(/^\d+[_-]/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

function orderFromFolder(folder: string): number {
  const match = folder.match(/^(\d+)[_-]/);
  return match ? Number(match[1]) : 999;
}

function compareProjects(a: DetectedProject, b: DetectedProject): number {
  return (
    categoryOrder(a.category) - categoryOrder(b.category) ||
    a.category.localeCompare(b.category) ||
    a.order - b.order ||
    a.title.localeCompare(b.title) ||
    a.repo.localeCompare(b.repo)
  );
}

function categoryOrder(category: string): number {
  if (category === 'HTML') {
    return 0;
  }

  if (category === 'CSS') {
    return 1;
  }

  return 2;
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
    },
  });
}

function text(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function methodNotAllowed(): Response {
  return json({ error: 'Method not allowed' }, 405, { Allow: 'GET', 'Cache-Control': 'no-store' });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
