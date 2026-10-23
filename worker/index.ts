interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
  PROJECT_REPO?: string;
  PROJECT_SITE?: string;
  PROJECTS_ROOT?: string;
  GITHUB_TOKEN?: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface GalleryConfig {
  projectRepo: string;
  projectSite: string;
  projectsRoot: string;
}

interface GitHubTree {
  tree?: Array<{
    path: string;
    type: string;
  }>;
  truncated?: boolean;
}

interface DetectedProject {
  folder: string;
  title: string;
  category: string;
  order: number;
  url: string;
}

const CACHE_TTL_SECONDS = 300;

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/config') {
      if (request.method !== 'GET') {
        return methodNotAllowed();
      }

      const config = await resolveConfig(env, request);

      return json(
        {
          projectRepo: config.projectRepo,
          projectSite: config.projectSite,
          projectsRoot: config.projectsRoot,
          configured: Boolean(config.projectRepo && config.projectSite),
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

  if (!config.projectRepo || !config.projectSite) {
    return json(
      {
        error:
          'Set PROJECT_REPO and PROJECT_SITE in the Cloudflare environment (or public/config.json).',
      },
      503,
      { 'Cache-Control': 'no-store' },
    );
  }

  const cacheUrl = new URL('/api/projects', request.url);
  cacheUrl.searchParams.set('repo', config.projectRepo);
  cacheUrl.searchParams.set('site', config.projectSite);
  cacheUrl.searchParams.set('root', config.projectsRoot);
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  const cached = await readCache(cacheKey);

  if (cached) {
    return noStore(cached);
  }

  try {
    const { projects, truncated } = await detectProjects(env, config);

    if (!projects.length) {
      throw new Error(
        `No projects found under ${config.projectsRoot}/<category>/<folder>/index.html.`,
      );
    }

    const response = json(
      {
        projectRepo: config.projectRepo,
        projectSite: config.projectSite,
        projectsRoot: config.projectsRoot,
        generatedAt: new Date().toISOString(),
        count: projects.length,
        truncated,
        projects,
      },
      200,
      { 'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}` },
    );

    writeCache(ctx, cacheKey, response.clone());
    return noStore(response);
  } catch (error) {
    return json(
      { error: errorMessage(error) },
      502,
      { 'Cache-Control': 'no-store' },
    );
  }
}

async function detectProjects(
  env: Env,
  config: GalleryConfig,
): Promise<{ projects: DetectedProject[]; truncated: boolean }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'project-gallery',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  if (env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${config.projectRepo}/git/trees/HEAD?recursive=1`,
    { headers },
  );

  if (!response.ok) {
    const hint =
      response.status === 403 || response.status === 429
        ? ' Add a GITHUB_TOKEN secret to raise the GitHub rate limit.'
        : '';

    throw new Error(`GitHub API returned ${response.status}.${hint}`);
  }

  const tree = (await response.json()) as GitHubTree;
  const prefix = `${config.projectsRoot}/`;
  const projects: DetectedProject[] = [];

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

    projects.push({
      folder,
      title: titleFromFolder(folder),
      category,
      order: orderFromFolder(folder),
      url: `${config.projectSite}/${entry.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
    });
  }

  projects.sort(compareProjects);
  return { projects, truncated: Boolean(tree.truncated) };
}

async function resolveConfig(
  env: Env,
  request: Request,
): Promise<GalleryConfig> {
  const envRepo = normalizeRepo(env.PROJECT_REPO);
  const envSite = normalizeSite(env.PROJECT_SITE);
  const envRoot = normalizeRoot(env.PROJECTS_ROOT);

  if (envRepo && envSite) {
    return {
      projectRepo: envRepo,
      projectSite: envSite,
      projectsRoot: envRoot,
    };
  }

  const defaults = await readDefaults(env, request);

  return {
    projectRepo: envRepo || normalizeRepo(defaults.projectRepo),
    projectSite: envSite || normalizeSite(defaults.projectSite),
    projectsRoot: envRoot || normalizeRoot(defaults.projectsRoot),
  };
}

async function readDefaults(
  env: Env,
  request: Request,
): Promise<Partial<GalleryConfig>> {
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

function writeCache(
  ctx: ExecutionContext,
  key: Request,
  response: Response,
): void {
  try {
    ctx.waitUntil(caches.default.put(key, response));
  } catch {
    // Caching is best-effort; the API response is still valid without it.
  }
}

function normalizeRepo(value: string | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function normalizeSite(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function normalizeRoot(value: string | undefined): string {
  return (value ?? '').trim().replace(/^\/+|\/+$/g, '') || 'projects';
}

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
    a.title.localeCompare(b.title)
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

function json(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers,
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
  return json(
    { error: 'Method not allowed' },
    405,
    { Allow: 'GET', 'Cache-Control': 'no-store' },
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
