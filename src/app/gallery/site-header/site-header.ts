import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export interface RepositorySource {
  repo: string;
  url: string;
}

@Component({
  selector: 'app-site-header',
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'closeSources($event)',
    '(document:keydown.escape)': 'closeSources()',
  },
})
export class SiteHeader {
  readonly count = input<number>(0);
  readonly repoUrls = input<readonly RepositorySource[]>([]);

  // Close the Sources menu on outside click or Escape.
  protected closeSources(event?: Event): void {
    const menu = document.querySelector<HTMLDetailsElement>('details.sources');

    if (menu?.open && !(event?.target instanceof Node && menu.contains(event.target))) {
      menu.open = false;
    }
  }

  protected readonly singleSource = computed<RepositorySource | null>(() => {
    const sources = this.repoUrls();
    return sources.length === 1 ? sources[0] : null;
  });
}
