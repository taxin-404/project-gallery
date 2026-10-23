import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-gallery-skeleton',
  templateUrl: './gallery-skeleton.html',
  styleUrl: './gallery-skeleton.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GallerySkeleton {}
