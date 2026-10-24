import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
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

  it('loads and aggregates projects from multiple repositories', async () => {
    const loading = service.load();
    const request = http.expectOne('/api/projects');

    request.flush({
      projectRepos: ['owner/one', 'owner/two'],
      projectSite: '',
      projectsRoot: 'projects',
      projects: [
        {
          repo: 'owner/two',
          folder: '1_First',
          category: 'Basics',
          order: 1,
        },
        {
          repo: 'owner/one',
          folder: '2_Second',
          category: 'HTML',
          order: 2,
          url: '/preview/owner/one/projects/HTML/2_Second/index.html',
        },
        {
          repo: 'owner/two',
          folder: '2_Second',
          category: 'HTML',
          order: 2,
          url: '/preview/owner/two/projects/HTML/2_Second/index.html',
        },
      ],
    });

    await loading;

    expect(service.source()).toBe('Cloudflare API');
    expect(service.repos()).toEqual(['owner/one', 'owner/two']);
    expect(service.repoUrls()).toEqual([
      { repo: 'owner/one', url: 'https://github.com/owner/one' },
      { repo: 'owner/two', url: 'https://github.com/owner/two' },
    ]);
    expect(service.projects().map((project) => project.folder)).toEqual([
      '2_Second',
      '2_Second',
      '1_First',
    ]);
    expect(service.projects()[2].url).toBe('/preview/owner/two/projects/Basics/1_First/index.html');
    expect(service.categories()).toEqual(['HTML', 'Basics']);
    expect(service.counts()).toEqual({ all: 3, HTML: 2, Basics: 1 });
  });

  it('accepts the legacy single-repository feed', async () => {
    const loading = service.load();
    const request = http.expectOne('/api/projects');

    request.flush({
      projectRepo: 'owner/repo',
      projectSite: 'https://projects.example.com',
      projectsRoot: 'projects',
      projects: [
        {
          folder: '1_First',
          category: 'HTML',
          order: 1,
        },
      ],
    });

    await loading;

    expect(service.repos()).toEqual(['owner/repo']);
    expect(service.projects()[0].repo).toBe('owner/repo');
    expect(service.projects()[0].url).toBe(
      'https://projects.example.com/projects/HTML/1_First/index.html',
    );
  });
});
