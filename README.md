# Project Gallery

A standalone Angular gallery for one or more **separate** project repositories.

This repository contains no projects. Project source and `projects/` folders live in their own repositories. The gallery discovers them through the GitHub tree API and serves their files through a small read-only preview proxy built into the Cloudflare Worker.

- Gallery stack: Angular 22, standalone components, signals, lazy routes
- API: Cloudflare Worker + static assets
- Project discovery: GitHub tree API across multiple repositories, with no generated manifest to maintain
- Preview: live same-origin `<iframe>` served by the gallery Worker from the source repository
- Categories: the union of every repository's `projects/<category>/` folders

## How it works

```
Browser
  └── Angular gallery
        ├── GET /api/projects                 (Cloudflare Worker)
        │     └── GitHub tree API for each repo in PROJECT_REPOS
        │           └── detects PROJECTS_ROOT/<category>/<folder>/index.html
        ├── GET /preview/<owner>/<repo>/<path> (Cloudflare Worker)
        │     └── raw.githubusercontent.com/<owner>/<repo>/HEAD/<path>
        └── iframe + project links to the preview URL
```

The Worker builds project URLs from the detected GitHub paths. The gallery generates one tab per detected category across all configured repositories, plus an **All** tab. `HTML` and `CSS` stay first; remaining categories are alphabetical. Search, counts, ordering, and cards all come from that response.

When more than one repository is configured, each card shows its source repository and the header exposes a **Sources** menu.

The project repositories are never copied into or modified by this repository. Project files are streamed from GitHub on request and cached at the edge for five minutes.

If the projects are already deployed somewhere else, set `PREVIEW_MODE=external` and point `PROJECT_SITE` at that deployment. In that mode the gallery links and iframes use the external site instead of the built-in proxy.

## Cloudflare environment variables

Set these in the Cloudflare dashboard for the Worker (or use `.dev.vars` locally):

| Variable        | Required             | Description                                                                                                         |
| :-------------- | :------------------- | :------------------------------------------------------------------------------------------------------------------ |
| `PROJECT_REPOS` | Recommended          | Comma- or newline-separated GitHub repositories, for example `taxin-404/Responsive-Web-Design,taxin-404/JavaScript` |
| `PROJECT_REPO`  | No                   | Legacy single-repository setting. Still supported and deduplicated against the configured list                      |
| `PROJECTS_ROOT` | No                   | Folder that contains the categories. Defaults to `projects`                                                         |
| `PREVIEW_MODE`  | No                   | `proxy` (default) serves project files through the gallery Worker. `external` uses `PROJECT_SITE`                   |
| `PROJECT_SITE`  | Only with `external` | Public URL of a separately deployed project site                                                                    |
| `GITHUB_TOKEN`  | No                   | GitHub token used by the Worker. Recommended: avoids the anonymous GitHub API rate limit                            |

`GITHUB_TOKEN` is a secret and must never be exposed to the browser. Set it in production with:

```bash
npx wrangler secret put GITHUB_TOKEN
```

When `PROJECT_REPOS` is not set, the Worker uses the `projectRepos` list in `public/config.json` and appends `PROJECT_REPO` if it is configured. This makes it safe to add a repository to the checked-in defaults without changing the Worker settings.

The checked-in `wrangler.toml` also defines `PROJECT_REPOS` so Git-connected deployments keep the same repository list.

## Project layout expected in a project repository

```
projects/
  HTML/
    1_Build_a_Curriculum_Outline/
      index.html
    2_Debug_Camperbot's_Profile_Page/
      index.html
  CSS/
    1_Design_a_Cafe_Menu/
      index.html
      styles.css
```

A second repository can contribute its own categories:

```
projects/
  Basics/
    1_Counter/
      index.html
      styles.css
      script.js
  DOM/
    1_Color_Changer/
      index.html
      styles.css
      script.js
  Apps/
    1_Tip_Calculator/
      index.html
      styles.css
      script.js
```

Any folder matching this pattern is detected:

```
$PROJECTS_ROOT/<category>/<folder>/index.html
```

`index.htm` is also accepted. The leading number in the folder name sets the order, and the rest of the folder name becomes the card title. To add a project, add the folder to any configured project repository and push. Nothing needs to change in this repository, and no separate project deployment is required in the default `proxy` mode.

## Local development

```bash
npm install
npm start
```

`npm start` runs the Angular dev server. Because the Worker API is not running there, the app falls back to `public/config.json` and queries the GitHub API directly. Project discovery works, but the `/preview/*` proxy is served only by the Worker. Use `npm run preview` for full previews.

For the full Worker API and preview proxy locally:

```bash
cp .dev.vars.example .dev.vars
npm run preview
```

`npm run preview` builds the app and starts `wrangler dev`, including `/api/config`, `/api/projects`, and `/preview/*`.

The checked-in defaults in `public/config.json` are:

```json
{
  "projectRepos": ["taxin-404/Responsive-Web-Design", "taxin-404/JavaScript"],
  "projectsRoot": "projects"
}
```

## Build and deploy

```bash
npm run build
npm run deploy
```

`npm run deploy` is `npm run build && wrangler deploy`. `wrangler.toml` serves the Angular output from `dist/project-gallery/browser` and routes every request through the Worker so `/api/*` and `/preview/*` can be handled before the static assets.

For Cloudflare Workers Builds (Git-connected deployment):

| Setting        | Value                 |
| :------------- | :-------------------- |
| Root directory | `.`                   |
| Build command  | `npm run build`       |
| Deploy command | `npx wrangler deploy` |

Add the environment variables from the table above in the Worker's Cloudflare settings.

## API

### `GET /api/config`

Returns the resolved configuration, without secrets:

```json
{
  "projectRepo": "taxin-404/Responsive-Web-Design",
  "projectRepos": ["taxin-404/Responsive-Web-Design", "taxin-404/JavaScript"],
  "projectSite": "",
  "projectsRoot": "projects",
  "previewMode": "proxy",
  "configured": true
}
```

### `GET /api/projects`

Fetches each project repository's Git tree and returns every detected project:

```json
{
  "projectRepo": "taxin-404/Responsive-Web-Design",
  "projectRepos": ["taxin-404/Responsive-Web-Design", "taxin-404/JavaScript"],
  "projectSite": "",
  "projectsRoot": "projects",
  "previewMode": "proxy",
  "generatedAt": "2026-10-24T03:00:00.000Z",
  "count": 15,
  "truncated": false,
  "warnings": [],
  "projects": [
    {
      "repo": "taxin-404/Responsive-Web-Design",
      "folder": "1_Build_a_Curriculum_Outline",
      "title": "Build a Curriculum Outline",
      "category": "HTML",
      "order": 1,
      "url": "/preview/taxin-404/Responsive-Web-Design/projects/HTML/1_Build_a_Curriculum_Outline/index.html"
    }
  ]
}
```

If one repository fails, the Worker still returns projects from the other repositories and adds an entry to `warnings`. The Worker caches a successful response for five minutes. It returns `Cache-Control: no-store` to the browser and keeps the shared cache in the Worker, so configuration changes and newly added projects appear after the cache window without browser cache surprises.

### `GET /preview/<owner>/<repo>/<path>`

Streams a file from a configured project repository at `HEAD`, with a content type inferred from the file extension so HTML, CSS, and JavaScript render correctly in an iframe. Only paths under `PROJECTS_ROOT` are served, and only for repositories in the configured list. Responses are cached for five minutes. The gallery iframes are sandboxed so project scripts cannot read or modify the gallery page.

Old single-repository preview links in the form `/preview/<path>` are also accepted and resolve against the first configured repository.

## Troubleshooting

- **Preview iframes are blank:** open the `/preview/<owner>/<repo>/projects/...` URL directly. If it returns a project, check the iframe sandbox and the browser console. If it fails, check the repository name, `PROJECTS_ROOT`, and the GitHub raw URL.
- **External project site returns 404/1042:** either keep the default `PREVIEW_MODE=proxy`, or deploy the project repository and set `PROJECT_SITE` to that deployment's public URL with `PREVIEW_MODE=external`.
- **GitHub rate limit:** add a `GITHUB_TOKEN` Worker secret. The gallery can still show the last cached list in `localStorage`.
- **No projects found:** check `PROJECT_REPOS` and `PROJECTS_ROOT`. The detected path must be `PROJECTS_ROOT/<category>/<folder>/index.html` in at least one configured repository.
- **One repository is missing:** inspect the `warnings` array in `/api/projects`; the other repositories continue to load.
- **Local `npm start` cannot find `/api/projects`:** that is expected. The dev server has no Worker; the app falls back to `config.json` + GitHub. Use `npm run preview` to test the Worker API and previews.
- **Private project repository:** the preview proxy is intended for public repositories. A private repository would require forwarding a token to raw GitHub and should be handled deliberately.

## Repository scope

This repository is only the base gallery. The separate project repositories remain the source of truth. Do not add a `projects/` folder or a generated `projects.json` here.
