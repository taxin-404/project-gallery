import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GalleryPage } from './gallery-page';

describe('GalleryPage', () => {
  let component: GalleryPage;
  let fixture: ComponentFixture<GalleryPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GalleryPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(GalleryPage);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);

    fixture.detectChanges();

    http.expectOne('/api/projects').flush({
      projectRepos: ['owner/one', 'owner/two'],
      projectsRoot: 'projects',
      projects: [
        {
          repo: 'owner/one',
          folder: '1_HTML',
          title: 'HTML Project',
          category: 'HTML',
          order: 1,
          url: '/preview/owner/one/projects/HTML/1_HTML/index.html',
        },
        {
          repo: 'owner/one',
          folder: '1_CSS',
          title: 'CSS Project',
          category: 'CSS',
          order: 1,
          url: '/preview/owner/one/projects/CSS/1_CSS/index.html',
        },
        {
          repo: 'owner/two',
          folder: '1_Basics',
          title: 'Basics Project',
          category: 'Basics',
          order: 1,
          url: '/preview/owner/two/projects/Basics/1_Basics/index.html',
        },
        {
          repo: 'owner/two',
          folder: '1_DOM',
          title: 'DOM Project',
          category: 'DOM',
          order: 1,
          url: '/preview/owner/two/projects/DOM/1_DOM/index.html',
        },
        {
          repo: 'owner/two',
          folder: '1_Apps',
          title: 'Apps Project',
          category: 'Apps',
          order: 1,
          url: '/preview/owner/two/projects/Apps/1_Apps/index.html',
        },
      ],
    });

    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('renders a card for each detected project', () => {
    const cards = fixture.nativeElement.querySelectorAll('app-project-card');

    expect(cards.length).toBe(5);
  });

  it('aggregates category tabs from every repository', () => {
    const tabs = [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll('button[role="tab"]'),
    ].map((tab) => {
      const clone = tab.cloneNode(true) as HTMLElement;
      clone.querySelector('.n')?.remove();
      return clone.textContent?.trim();
    });

    expect(tabs).toEqual(['All', 'HTML', 'CSS', 'Apps', 'Basics', 'DOM']);
  });

  it('shows both repository sources and labels cards with their repo', () => {
    const element = fixture.nativeElement as HTMLElement;
    const sourceLinks = [...element.querySelectorAll('.sources a')].map((link) =>
      link.getAttribute('href'),
    );

    expect(sourceLinks).toEqual(['https://github.com/owner/one', 'https://github.com/owner/two']);
    expect(element.querySelector('app-project-card')?.textContent).toContain('owner/one');
  });
});
