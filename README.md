# Project Gallery

A standalone Angular gallery for a **separate** freeCodeCamp projects repository.

This repository contains no projects. The project source, the `projects/` folders, and the deployed project pages live in their own repository. This app only discovers, previews, and links to them.

- Gallery stack: Angular 22, standalone components, signals, lazy routes
- API: Cloudflare Worker + static assets
- Project discovery: GitHub tree API, with no generated manifest to maintain
- Preview: live cross-origin `<iframe>` from the deployed project site

## How it works

```
Browser
  └── Angular gallery
        ├── GET /api/projects  (Cloudflare Worker)
        │     └── GitHub tree API
        │           └── detects PROJECTS_ROOT/<category>/<folder>/index.html
        └── previews + links to PROJECT_SITE/<project path>
```

The Worker builds project URLs from the detected GitHub paths. The gallery generates one tab per detected category, plus an **All** tab. Search, counts, ordering, and cards all come from that response.

The project repository is never copied into or modified by this repository.

## Cloudflare environment variables

Set these in the Cloudflare dashboard for the Worker (or use `.dev.vars` locally):

| Variable | Required | Description |
| :-- | :-- | :-- |
| `PROJECT_REPO` | Yes | GitHub repository containing the projects, for example `taxin-404/Responsive-Web-Design` |
| `PROJECT_SITE` | Yes | Public URL of the deployed project site, for example `https://responsive-web-design.taxin-404.workers.dev` |
| `PROJECTS_ROOT` | No | Folder that contains the categories. Defaults to `projects` |
| `GITHUB_TOKEN` | No | GitHub token used by the Worker. Recommended: avoids the anonymous GitHub API rate limit |

`GITHUB_TOKEN` is a secret and must never be exposed to the browser. Set it in production with:

```bash
npx wrangler secret put GITHUB_TOKEN
```

If `PROJECT_REPO` or `PROJECT_SITE` is not set, the Worker falls back to `public/config.json`. Edit that file or set both variables in Cloudflare.

## Project layout expected in the project repository

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

Any folder matching this pattern is detected:

```
$PROJECTS_ROOT/<category>/<folder>/index.html
```

`index.htm` is also accepted. The leading number in the folder name sets the order, and the rest of the folder name becomes the card title. To add a project, add the folder to the project repository and deploy that site. Nothing needs to change in this repository.

## Local development

```bash
npm install
npm start
```

`npm start` runs the Angular dev server. Because the Worker API is not running there, the app falls back to `public/config.json` and queries the GitHub API directly. This is also useful when testing the GitHub-based fallback. The last successful project list is cached in `localStorage`.

For the full Worker API locally:

```bash
cp .dev.vars.example .dev.vars
npm run preview
```

`npm run preview` builds the app and starts `wrangler dev`, including `/api/config` and `/api/projects`.

The checked-in defaults in `public/config.json` are:

```json
{
  "projectRepo": "taxin-404/Responsive-Web-Design",
  "projectSite": "https://responsive-web-design.taxin-404.workers.dev",
  "projectsRoot": "projects"
}
```

The project site must be publicly reachable. Its pages must also allow iframe embedding: do not send `X-Frame-Options: SAMEORIGIN` or a `frame-ancestors` CSP rule for the project pages.

## Build and deploy

```bash
npm run build
npm run deploy
```

`npm run deploy` is `npm run build && wrangler deploy`. `wrangler.toml` serves the Angular output from `dist/project-gallery/browser` and routes every request through the Worker so `/api/*` can be handled before the static assets.

For Cloudflare Workers Builds (Git-connected deployment):

| Setting | Value |
| :-- | :-- |
| Root directory | `.` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

Add the environment variables from the table above in the Worker's Cloudflare settings.

## API

### `GET /api/config`

Returns the resolved configuration, without secrets:

```json
{
  "projectRepo": "taxin-404/Responsive-Web-Design",
  "projectSite": "https://responsive-web-design.taxin-404.workers.dev",
  "projectsRoot": "projects",
  "configured": true
}
```

### `GET /api/projects`

Fetches the project repository's Git tree and returns every detected project:

```json
{
  "projectRepo": "taxin-404/Responsive-Web-Design",
  "projectSite": "https://responsive-web-design.taxin-404.workers.dev",
  "projectsRoot": "projects",
  "generatedAt": "2026-10-23T19:00:00.000Z",
  "count": 12,
  "truncated": false,
  "projects": [
    {
      "folder": "1_Build_a_Curriculum_Outline",
      "title": "Build a Curriculum Outline",
      "category": "HTML",
      "order": 1,
      "url": "https://responsive-web-design.taxin-404.workers.dev/projects/HTML/1_Build_a_Curriculum_Outline/index.html"
    }
  ]
}
```

The Worker caches a successful response for five minutes. It returns `Cache-Control: no-store` to the browser and keeps the shared cache in the Worker, so configuration changes and newly added projects appear after the cache window without browser cache surprises.

## Troubleshooting

- **Project site returns 404/1042:** deploy the separate project repository and set `PROJECT_SITE` to that deployment's public URL.
- **Preview iframes are blank:** open a project URL directly. If it fails, the project site is down. If it works directly, check that the project site allows iframe embedding.
- **GitHub rate limit:** add a `GITHUB_TOKEN` Worker secret. The gallery can still show the last cached list in `localStorage`.
- **No projects found:** check `PROJECT_REPO`, `PROJECT_SITE`, and `PROJECTS_ROOT`. The detected path must be `PROJECTS_ROOT/<category>/<folder>/index.html`.
- **Local `npm start` cannot find `/api/projects`:** that is expected. The dev server has no Worker; the app falls back to `config.json` + GitHub. Use `npm run preview` to test the Worker API locally.

## Repository scope

This repository is only the base gallery. The separate project repository remains the source of truth and the deployment target for the project pages. Do not add a `projects/` folder or a generated `projects.json` here.
