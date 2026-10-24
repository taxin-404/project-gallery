import { projectUrl } from './project';

describe('projectUrl', () => {
  it('uses the gallery preview proxy when no project site is configured', () => {
    expect(projectUrl('HTML', '1_Test_Project', '', 'projects')).toBe(
      '/preview/projects/HTML/1_Test_Project/index.html',
    );
  });

  it('uses an external project site when one is configured', () => {
    expect(projectUrl('CSS', '2_Test_Project', 'https://projects.example.com/', 'projects')).toBe(
      'https://projects.example.com/projects/CSS/2_Test_Project/index.html',
    );
  });
});
