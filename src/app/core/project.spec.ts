import { normalizeProjectRepos, projectKey, projectUrl } from './project';

describe('projectUrl', () => {
  it('uses the gallery preview proxy and includes the project repo', () => {
    expect(
      projectUrl('taxin-404/Responsive-Web-Design', 'HTML', '1_Test_Project', '', 'projects'),
    ).toBe('/preview/taxin-404/Responsive-Web-Design/projects/HTML/1_Test_Project/index.html');
  });

  it('uses an external project site when one is configured', () => {
    expect(
      projectUrl(
        'taxin-404/Responsive-Web-Design',
        'CSS',
        '2_Test_Project',
        'https://projects.example.com/',
        'projects',
      ),
    ).toBe('https://projects.example.com/projects/CSS/2_Test_Project/index.html');
  });
});

describe('normalizeProjectRepos', () => {
  it('accepts an array and removes duplicate repositories', () => {
    expect(
      normalizeProjectRepos([
        'taxin-404/Responsive-Web-Design',
        ' taxin-404/Responsive-Web-Design ',
        'https://github.com/taxin-404/JavaScript.git',
      ]),
    ).toEqual(['taxin-404/Responsive-Web-Design', 'taxin-404/JavaScript']);
  });

  it('accepts comma and newline separated repositories', () => {
    expect(normalizeProjectRepos('taxin-404/Responsive-Web-Design,\ntaxin-404/JavaScript')).toEqual(
      ['taxin-404/Responsive-Web-Design', 'taxin-404/JavaScript'],
    );
  });
});

describe('projectKey', () => {
  it('keeps projects with the same folder in different repos separate', () => {
    expect(projectKey('owner/one', 'HTML', '1_Test')).not.toBe(
      projectKey('owner/two', 'HTML', '1_Test'),
    );
  });
});
