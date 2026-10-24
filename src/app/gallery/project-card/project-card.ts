import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';

import { Project } from '../../core/project';

@Component({
  selector: 'app-project-card',
  templateUrl: './project-card.html',
  styleUrl: './project-card.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--delay]': 'delay()' },
})
export class ProjectCard {
  readonly project = input.required<Project>();
  readonly showRepo = input(false);
  readonly index = input(0);

  // Stagger the entrance animation, capped so long lists don't wait forever.
  protected readonly delay = computed(() => `${Math.min(this.index(), 12) * 55}ms`);

  private readonly sanitizer = inject(DomSanitizer);

  protected readonly previewUrl = computed<SafeResourceUrl>(() =>
    this.sanitizer.bypassSecurityTrustResourceUrl(this.project().url),
  );
}
