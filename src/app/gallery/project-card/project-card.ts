import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { Project } from '../../core/project';
import { CategoryIcon } from '../category-icon/category-icon';

@Component({
  selector: 'app-project-card',
  imports: [CategoryIcon],
  templateUrl: './project-card.html',
  styleUrl: './project-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--delay]': 'delay()' },
})
export class ProjectCard {
  readonly project = input.required<Project>();
  readonly showRepo = input(false);
  readonly index = input(0);

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly previewUrl = computed<SafeResourceUrl>(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.project().url),
  );

  // Stagger the entrance animation, capped so long lists don't wait forever.
  protected readonly delay = computed(() => `${Math.min(this.index(), 12) * 55}ms`);

  protected readonly isCustomCategory = computed(
    () => !['HTML', 'CSS'].includes(this.project().category),
  );

  // A stable hue per category name so every non-HTML/CSS category gets its own colour.
  protected readonly hue = computed(() => {
    let hash = 0;

    for (const char of this.project().category) {
      hash = (hash * 31 + char.charCodeAt(0)) % 360;
    }

    return hash;
  });
}
