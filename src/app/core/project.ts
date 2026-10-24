export type ProjectFilter = string;

export interface ProjectCounts {
  all: number;
  [category: string]: number;
}

export interface Project {
  repo: string;
  folder: string;
  title: string;
  category: string;
  order: number;
  url: string;
}

export interface RawProject {
  repo?: string;
  folder: string;
  title?: string;
  category?: string;
  order?: number;
  url?: string;
}

export interface ProjectFeed {
  projectRepo?: string;
  projectRepos?: string[];
  projectSite?: string;
  projectsRoot?: string;
  previewMode?: 'proxy' | 'external';
  generatedAt?: string;
  count?: number;
  truncated?: boolean;
  warnings?: Array<{ repo: string; error: string }>;
  projects?: RawProject[];
}

export interface GalleryConfig {
  projectRepo?: string;
  projectRepos?: string[];
  projectSite?: string;
  projectsRoot?: string;
  previewMode?: 'proxy' | 'external';
}

export interface GitHubTree {
  tree?: Array<{
    path: string;
    type: string;
  }>;
  truncated?: boolean;
}

export function projectKey(repo: string, category: string, folder: string): string {
  return `${repo}/${category}/${folder}`;
}

export function titleFromFolder(folder: string): string {
  return folder
    .replace(/^\d+[_-]/, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

export function orderFromFolder(folder: string): number {
  const match = folder.match(/^(\d+)[_-]/);
  return match ? Number(match[1]) : 999;
}

export function normalizeProjectRepo(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

export function normalizeProjectRepos(value: string | string[] | null | undefined): string[] {
  const values = Array.isArray(value) ? value : (value ?? '').split(/[,\n]/);

  return [...new Set(values.map(normalizeProjectRepo).filter(Boolean))];
}

export function normalizeProjectSite(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

export function normalizeProjectsRoot(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^\/+|\/+$/g, '') || 'projects';
}

/**
 * Points at a project. With no external site configured, the gallery Worker
 * proxies the original file from the project repository.
 */
export function projectUrl(
  repo: string,
  category: string,
  folder: string,
  projectSite = '',
  projectsRoot = 'projects',
  indexFile = 'index.html',
): string {
  const path = [projectsRoot, category, folder, indexFile]
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  const site = normalizeProjectSite(projectSite);

  if (site) {
    return `${site}/${path}`;
  }

  const repoParts = normalizeProjectRepo(repo).split('/');
  const repoPath =
    repoParts.length === 2 ? `${repoParts.map((part) => encodeURIComponent(part)).join('/')}/` : '';

  return `/preview/${repoPath}${path}`;
}

export function compareProjects(a: Project, b: Project): number {
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
