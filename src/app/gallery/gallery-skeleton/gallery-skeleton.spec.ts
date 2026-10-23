import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GallerySkeleton } from './gallery-skeleton';

describe('GallerySkeleton', () => {
  let component: GallerySkeleton;
  let fixture: ComponentFixture<GallerySkeleton>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [GallerySkeleton],
    }).compileComponents();

    fixture = TestBed.createComponent(GallerySkeleton);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
