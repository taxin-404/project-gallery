import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { ProjectStore } from './project-store';

describe('ProjectStore', () => {
  let service: ProjectStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });

    service = TestBed.inject(ProjectStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('loads projects from the gallery API', async () => {
    const loading = service.load();
    const request = http.expectOne('/api/projects');

    request.flush({
      projectRepo: 'owner/repo',
      projectSite: 'https://projects.example.com',
      projectsRoot: 'projects',
      projects: [
        {
          folder: '2_Second',
          category: 'HTML',
          order: 2,
          url: 'https://projects.example.com/projects/HTML/2_Second/index.html',
        },
        {
          folder: '1_First',
          category: 'CSS',
          order: 1,
          url: 'https://projects.example.com/projects/CSS/1_First/index.html',
        },
      ],
    });

    await loading;

    expect(service.source()).toBe('Cloudflare API');
    expect(service.projects().length).toBe(2);
    expect(service.projects()[0].folder).toBe('2_Second');
    expect(service.categories()).toEqual(['HTML', 'CSS']);
    expect(service.counts()).toEqual({ all: 2, HTML: 1, CSS: 1 });
    expect(service.repoUrl()).toBe('https://github.com/owner/repo');
  });
});
