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
    position: fixed; top: 16px; left: 16px; z-index: 2147483647;
    display: inline-flex; align-items: center; gap: 8px;
    margin: 0; padding: 10px 16px 10px 12px; border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(13, 17, 23, 0.85); color: #e6edf3;
    font: 600 14px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    text-decoration: none; cursor: pointer;
    -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    animation: pg-back-in 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) 0.2s both;
    transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  }
  #pg-back:hover { transform: scale(1.05); border-color: #58a6ff; box-shadow: 0 10px 26px rgba(0, 0, 0, 0.45); }
  #pg-back:active { transform: scale(0.97); }
  #pg-back:focus-visible { outline: 2px solid #58a6ff; outline-offset: 3px; }
  #pg-back svg { display: block; transition: transform 0.2s ease; }
  #pg-back:hover svg { transform: translateX(-4px); }
  @keyframes pg-back-in { from { opacity: 0; transform: translateX(-28px); } to { opacity: 1; transform: none; } }
  @keyframes pg-page-in { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) {
    html, #pg-back, #pg-back svg { animation: none; transition: none; }
  }
</style>
<a id="pg-back" href="/" aria-label="Back to gallery">
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19 12H5M12 19l-7-7 7-7"/>
  </svg>
  Back
</a>
<script>
  document.getElementById('pg-back').addEventListener('click', function (event) {
    event.preventDefault();
    var fromGallery = document.referrer && document.referrer.indexOf(location.origin) === 0;
    if (fromGallery && history.length > 1) {
      history.back();
    } else {
      location.href = '/';
    }
  });
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
