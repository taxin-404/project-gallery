import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Service, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import {
  GalleryConfig,
  GitHubTree,
  Project,
  ProjectCounts,
  ProjectFeed,
  compareProjects,
  normalizeProjectRepo,
  normalizeProjectRepos,
  normalizeProjectSite,
  normalizeProjectsRoot,
  orderFromFolder,
  projectUrl,
  titleFromFolder,
} from './project';

const CACHE_KEY = 'project-gallery-v2';

type ProjectSource = 'Cloudflare API' | 'live GitHub API' | 'cached copy';

@Service()
export class ProjectStore {
  private readonly http = inject(HttpClient);

  readonly projects = signal<Project[]>([]);
  readonly loading = signal(false);
  readonly source = signal<ProjectSource | null>(null);
  readonly warning = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly repos = signal<string[]>([]);
  readonly projectSite = signal<string | null>(null);

  readonly repoUrls = computed<{ repo: string; url: string }[]>(() =>
    this.repos().map((repo) => ({
      repo,
      url: `https://github.com/${repo}`,
    })),
  );

  readonly categories = computed<string[]>(() => [
    ...new Set(this.projects().map((project) => project.category)),
  ]);

  readonly counts = computed<ProjectCounts>(() => {
    const counts: ProjectCounts = {
      all: this.projects().length,
    };

    for (const project of this.projects()) {
      counts[project.category] = (counts[project.category] ?? 0) + 1;
    }

    return counts;
  });

  private loadStarted = false;

  async load(): Promise<void> {
    if (this.loadStarted) {
      return;
    }

    this.loadStarted = true;
    this.loading.set(true);
    this.error.set(null);
    this.warning.set(null);

    try {
      const fromWorker = await this.loadFromWorker();

      if (fromWorker) {
        this.apply(fromWorker, 'Cloudflare API');
        return;
      }

      const config = await this.resolveConfig();

      if (config) {
        const repos = normalizeProjectRepos(
          config.projectRepos?.length ? config.projectRepos : config.projectRepo,
        );
        const site = normalizeProjectSite(config.projectSite);

        if (repos.length) {
          this.repos.set(repos);
        }

        if (site) {
          this.projectSite.set(site);
        }

        const live = await this.loadFromGitHub(
          repos,
          site,
          normalizeProjectsRoot(config.projectsRoot),
        );

        if (live) {
          this.apply(live, 'live GitHub API');
          return;
        }
      } else {
        this.error.set(
          'No project source is configured. Set PROJECT_REPOS in Cloudflare, or edit public/config.json.',
        );
      }

      const cached = this.readCache();

      if (cached?.length) {
        this.projects.set(cached);
        this.source.set('cached copy');
        this.error.set(null);
        this.warning.set(this.warning() ?? 'Using the last cached project list.');
        return;
      }

      this.error.set(
        this.error() ??
          'No projects were found. Check the configured project repos and the projects root.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadFromWorker(): Promise<Project[] | null> {
    try {
      const feed = await firstValueFrom(this.http.get<ProjectFeed>('/api/projects'));
      const projects = this.fromFeed(feed);

      if (!projects.length) {
        return null;
      }

      const repos = normalizeProjectRepos(
        feed.projectRepos?.length ? feed.projectRepos : feed.projectRepo,
      );
      const site = normalizeProjectSite(feed.projectSite);

      if (repos.length) {
        this.repos.set(repos);
      }

      if (site) {
        this.projectSite.set(site);
      }

      const warnings = (feed.warnings ?? []).map((warning) => `${warning.repo}: ${warning.error}`);

      if (feed.truncated) {
        warnings.push('The GitHub tree response was truncated; some projects may be missing.');
      }

      if (warnings.length) {
        this.warning.set(warnings.join(' '));
      }

      return projects;
    } catch {
      // The local dev server has no Worker API; the config + GitHub path follows.
      return null;
    }
  }

  private async resolveConfig(): Promise<GalleryConfig | null> {
    try {
      return await firstValueFrom(this.http.get<GalleryConfig>('/api/config'));
    } catch {
      // Fall through to the checked-in local defaults.
    }

    try {
      return await firstValueFrom(this.http.get<GalleryConfig>('/config.json'));
    } catch {
      return null;
    }
  }

  private async loadFromGitHub(
    repos: string[],
    site: string,
    root: string,
  ): Promise<Project[] | null> {
    if (!repos.length) {
      this.warning.set('Set PROJECT_REPOS to point at the repositories that contain the projects.');
      return null;
    }

    const projects: Project[] = [];
    const warnings: string[] = [];

    for (const repo of repos) {
      try {
        const tree = await firstValueFrom(
          this.http.get<GitHubTree>(
            `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`,
          ),
        );

        if (tree.truncated) {
          warnings.push(
            `${repo}: the GitHub tree response was truncated; some projects may be missing.`,
          );
        }

        const repoProjects = this.fromTree(tree, repo, site, root);

        if (!repoProjects.length) {
          warnings.push(`${repo}: no index.html files found under ${root}/<category>/<folder>/.`);
        }

        projects.push(...repoProjects);
      } catch (error) {
        warnings.push(`${repo}: ${describeError(error)}`);
      }
    }

    if (warnings.length) {
      this.warning.set(warnings.join(' '));
    }

    if (!projects.length) {
      return null;
    }

    return projects.sort(compareProjects);
  }

  private fromFeed(feed: ProjectFeed): Project[] {
    const site = normalizeProjectSite(feed.projectSite);
    const root = normalizeProjectsRoot(feed.projectsRoot);
    const repos = normalizeProjectRepos(
      feed.projectRepos?.length ? feed.projectRepos : feed.projectRepo,
    );
    const fallbackRepo = repos[0] ?? '';

    return (feed.projects ?? [])
      .filter((project) => Boolean(project.folder))
      .map((project): Project | null => {
        const repo = normalizeProjectRepo(project.repo) || fallbackRepo;

        if (!repo) {
          return null;
        }

        const category = project.category ?? 'HTML';
        const folder = project.folder;

        return {
          repo,
          folder,
          title: project.title ?? titleFromFolder(folder),
          category,
          order: project.order ?? orderFromFolder(folder),
          url: project.url ?? projectUrl(repo, category, folder, site, root),
        };
      })
      .filter((project): project is Project => project !== null)
      .sort(compareProjects);
  }

  private fromTree(tree: GitHubTree, repo: string, site: string, root: string): Project[] {
    const prefix = `${root}/`;

    return (tree.tree ?? [])
      .filter(
        (entry) =>
          entry.type === 'blob' &&
          entry.path.startsWith(prefix) &&
          /\/index\.html?$/.test(entry.path),
      )
      .map((entry): Project | null => {
        const parts = entry.path.slice(prefix.length).split('/');

        if (parts.length !== 3) {
          return null;
        }

        const [category, folder, indexFile] = parts;

        return {
          repo,
          folder,
          title: titleFromFolder(folder),
          category,
          order: orderFromFolder(folder),
          url: projectUrl(repo, category, folder, site, root, indexFile),
        };
      })
      .filter((project): project is Project => project !== null)
      .sort(compareProjects);
  }

  private apply(projects: Project[], source: ProjectSource): void {
    this.projects.set(projects);
    this.source.set(source);
    this.error.set(null);
    this.cache(projects);
  }

  private cache(projects: Project[]): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(projects));
    } catch {
      // Storage can be unavailable in private browsing; the app still works.
    }
  }

  private readCache(): Project[] | null {
    try {
      const cached = localStorage.getItem(CACHE_KEY);

      if (!cached) {
        return null;
      }

      const parsed: unknown = JSON.parse(cached);

      if (!Array.isArray(parsed)) {
        return null;
      }

      return parsed.filter(isProject).sort(compareProjects);
    } catch {
      return null;
    }
  }
}

function isProject(value: unknown): value is Project {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const project = value as Partial<Project>;

  return (
    typeof project.repo === 'string' &&
    typeof project.folder === 'string' &&
    typeof project.title === 'string' &&
    typeof project.category === 'string' &&
    typeof project.order === 'number' &&
    typeof project.url === 'string'
  );
}

function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 403) {
      return 'GitHub API rate limit reached; add a GITHUB_TOKEN secret in Cloudflare.';
    }

    return error.status ? `HTTP ${error.status}` : error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
