import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-site-header',
  templateUrl: './site-header.html',
  styleUrl: './site-header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteHeader {
  readonly count = input<number>(0);
  readonly repoUrl = input<string | null>(null);
}
