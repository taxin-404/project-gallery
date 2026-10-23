import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Project Gallery',
    loadComponent: () =>
      import('./gallery/gallery-page/gallery-page').then(
        (module) => module.GalleryPage,
      ),
  },
  {
    path: '**',
    title: 'Page not found · Project Gallery',
    loadComponent: () =>
      import('./not-found/not-found').then((module) => module.NotFound),
  },
];
