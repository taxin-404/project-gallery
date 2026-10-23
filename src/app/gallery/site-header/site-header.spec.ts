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

  it('shows the project count and repository link', () => {
    fixture.componentRef.setInput('count', 3);
    fixture.componentRef.setInput('repoUrl', 'https://github.com/owner/repo');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const link = element.querySelector('a') as HTMLAnchorElement;

    expect(element.textContent).toContain('3 projects');
    expect(link.href).toBe('https://github.com/owner/repo');
  });
});
