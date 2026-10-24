import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';

import { Project, ProjectFilter, projectKey } from '../../core/project';
import { ProjectStore } from '../../core/project-store';
import { CategoryIcon } from '../category-icon/category-icon';
import { GallerySkeleton } from '../gallery-skeleton/gallery-skeleton';
import { ProjectCard } from '../project-card/project-card';
import { SiteHeader } from '../site-header/site-header';

interface GalleryTab {
  value: ProjectFilter;
  label: string;
}

@Component({
  selector: 'app-gallery-page',
  imports: [SiteHeader, ProjectCard, GallerySkeleton, CategoryIcon],
  templateUrl: './gallery-page.html',
  styleUrl: './gallery-page.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GalleryPage implements OnInit {
  protected readonly store = inject(ProjectStore);
  protected readonly skeletonItems = [1, 2, 3, 4, 5, 6];
  protected readonly filter = signal<ProjectFilter>('all');
  protected readonly query = signal('');

  protected readonly tabs = computed<readonly GalleryTab[]>(() => [
    { value: 'all', label: 'All' },
    ...this.store.categories().map((category) => ({
      value: category,
      label: category,
    })),
  ]);

  protected readonly visibleProjects = computed(() => {
    const filter = this.filter();
    const query = this.query().trim().toLowerCase();

    return this.store.projects().filter((project) => {
      if (filter !== 'all' && project.category !== filter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return `${project.title} ${project.folder} ${project.category} ${project.repo}`
        .toLowerCase()
        .includes(query);
    });
  });

  protected readonly statusText = computed(() => {
    if (this.store.loading()) {
      return 'Loading projects…';
    }

    const error = this.store.error();

    if (error) {
      return error;
    }

    const warning = this.store.warning();
    return `${this.store.projects().length} projects · source: ${
      this.store.source() ?? 'unknown'
    }${warning ? ` (${warning})` : ''}`;
  });

  protected readonly statusState = computed<'live' | 'fail' | null>(() => {
    if (this.store.error()) {
      return 'fail';
    }

    return this.store.loading() ? null : 'live';
  });

  ngOnInit(): void {
    void this.store.load();
  }

  protected selectFilter(filter: ProjectFilter): void {
    this.filter.set(filter);
  }

  protected updateQuery(event: Event): void {
    if (event.target instanceof HTMLInputElement) {
      this.query.set(event.target.value);
    }
  }

  protected clearQuery(input: HTMLInputElement): void {
    this.query.set('');
    input.focus();
  }

  protected onTabKeydown(event: KeyboardEvent, index: number): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      return;
    }

    event.preventDefault();

    const tabs = this.tabs();
    let nextIndex = index;

    if (event.key === 'ArrowLeft') {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'ArrowRight') {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    this.filter.set(tabs[nextIndex].value);

    const tabButtons = (
      event.currentTarget as HTMLElement
    ).parentElement?.querySelectorAll<HTMLButtonElement>('button[role="tab"]');

    tabButtons?.[nextIndex]?.focus();
  }

  protected trackProject(_index: number, project: Project): string {
    return projectKey(project.repo, project.category, project.folder);
  }
}
