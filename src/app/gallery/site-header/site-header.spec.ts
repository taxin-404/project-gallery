import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SiteHeader } from './site-header';

describe('SiteHeader', () => {
  let component: SiteHeader;
  let fixture: ComponentFixture<SiteHeader>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SiteHeader],
    }).compileComponents();

    fixture = TestBed.createComponent(SiteHeader);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the project count and a single repository link', () => {
    fixture.componentRef.setInput('count', 3);
    fixture.componentRef.setInput('repoUrls', [
      {
        repo: 'owner/repo',
        url: 'https://github.com/owner/repo',
      },
    ]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const link = element.querySelector('a') as HTMLAnchorElement;

    expect(element.textContent).toContain('3 projects');
    expect(link.href).toBe('https://github.com/owner/repo');
  });

  it('lists every repository when multiple sources are configured', () => {
    fixture.componentRef.setInput('count', 5);
    fixture.componentRef.setInput('repoUrls', [
      {
        repo: 'owner/one',
        url: 'https://github.com/owner/one',
      },
      {
        repo: 'owner/two',
        url: 'https://github.com/owner/two',
      },
    ]);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const links = [...element.querySelectorAll('a')].map((link) => link.getAttribute('href'));

    expect(element.textContent).toContain('Sources');
    expect(links).toEqual(['https://github.com/owner/one', 'https://github.com/owner/two']);
  });
});
