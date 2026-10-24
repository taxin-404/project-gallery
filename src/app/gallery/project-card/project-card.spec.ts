import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProjectCard } from './project-card';

describe('ProjectCard', () => {
  let component: ProjectCard;
  let fixture: ComponentFixture<ProjectCard>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectCard],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectCard);
    component = fixture.componentInstance;

    fixture.componentRef.setInput('project', {
      repo: 'owner/repo',
      folder: '1_Test_Project',
      title: 'Test Project',
      category: 'HTML',
      order: 1,
      url: 'https://projects.example.com/projects/HTML/1_Test_Project/index.html',
    });

    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('links to the original project page', () => {
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;

    expect(link.getAttribute('href')).toBe(
      'https://projects.example.com/projects/HTML/1_Test_Project/index.html',
    );
  });

  it('shows the source repository when multiple repositories are configured', () => {
    fixture.componentRef.setInput('showRepo', true);
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).textContent).toContain('owner/repo');
  });
});
