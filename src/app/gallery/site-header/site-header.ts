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
})
export class SiteHeader {
  readonly count = input<number>(0);
  readonly repoUrls = input<readonly RepositorySource[]>([]);

  protected readonly singleSource = computed<RepositorySource | null>(() => {
    const sources = this.repoUrls();
    return sources.length === 1 ? sources[0] : null;
  });
}
