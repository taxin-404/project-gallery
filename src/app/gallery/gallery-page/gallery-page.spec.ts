import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
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
      projectRepo: 'owner/repo',
      projectSite: 'https://projects.example.com',
      projectsRoot: 'projects',
      projects: [
        {
          folder: '1_Test_Project',
          title: 'Test Project',
          category: 'HTML',
          order: 1,
          url: 'https://projects.example.com/projects/HTML/1_Test_Project/index.html',
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

    expect(cards.length).toBe(1);
  });
});
