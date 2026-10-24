# Project Gallery

A standalone Angular gallery for a **separate** freeCodeCamp projects repository.

This repository contains no projects. The project source and the `projects/` folders live in their own repository. The gallery discovers them through the GitHub tree API and serves their files through a small read-only preview proxy built into the Cloudflare Worker.

- Gallery stack: Angular 22, standalone components, signals, lazy routes
- API: Cloudflare Worker + static assets
- Project discovery: GitHub tree API, with no generated manifest to maintain
- Preview: live same-origin `<iframe>` served by the gallery Worker from the project repository

## How it works

```
Browser
  └── Angular gallery
        ├── GET /api/projects       (Cloudflare Worker)
        │     └── GitHub tree API
        │           └── detects PROJECTS_ROOT/<category>/<folder>/index.html
        ├── GET /preview/<path>     (Cloudflare Worker)
        │     └── raw.githubusercontent.com/<PROJECT_REPO>/HEAD/<path>
        └── iframe + project links to /preview/<path>
```

The Worker builds project URLs from the detected GitHub paths. The gallery generates one tab per detected category, plus an **All** tab. Search, counts, ordering, and cards all come from that response.

The project repository is never copied into or modified by this repository. Project files are streamed from GitHub on request and cached at the edge for five minutes.

If the project repository is already deployed somewhere else, set `PREVIEW_MODE=external` and point `PROJECT_SITE` at that deployment. In that mode the gallery links and iframes use the external site instead of the built-in proxy.

## Cloudflare environment variables

Set these in the Cloudflare dashboard for the Worker (or use `.dev.vars` locally):

| Variable        | Required             | Description                                                                                       |
| :-------------- | :------------------- | :------------------------------------------------------------------------------------------------ |
| `PROJECT_REPO`  | Yes                  | GitHub repository containing the projects, for example `taxin-404/Responsive-Web-Design`          |
| `PROJECTS_ROOT` | No                   | Folder that contains the categories. Defaults to `projects`                                       |
| `PREVIEW_MODE`  | No                   | `proxy` (default) serves project files through the gallery Worker. `external` uses `PROJECT_SITE` |
| `PROJECT_SITE`  | Only with `external` | Public URL of a separately deployed project site                                                  |
| `GITHUB_TOKEN`  | No                   | GitHub token used by the Worker. Recommended: avoids the anonymous GitHub API rate limit          |

`GITHUB_TOKEN` is a secret and must never be exposed to the browser. Set it in production with:

```bash
npx wrangler secret put GITHUB_TOKEN
```

If `PROJECT_REPO` is not set, the Worker falls back to `public/config.json`. Edit that file or set the variable in Cloudflare.

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

`index.htm` is also accepted. The leading number in the folder name sets the order, and the rest of the folder name becomes the card title. To add a project, add the folder to the project repository and push. Nothing needs to change in this repository, and no separate project deployment is required in the default `proxy` mode.

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
  "projectRepo": "taxin-404/Responsive-Web-Design",
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
  "projectSite": "",
  "projectsRoot": "projects",
  "previewMode": "proxy",
  "configured": true
}
```

### `GET /api/projects`

Fetches the project repository's Git tree and returns every detected project:

```json
{
  "projectRepo": "taxin-404/Responsive-Web-Design",
  "projectSite": "",
  "projectsRoot": "projects",
  "previewMode": "proxy",
  "generatedAt": "2026-10-23T19:00:00.000Z",
  "count": 12,
  "truncated": false,
  "projects": [
    {
      "folder": "1_Build_a_Curriculum_Outline",
      "title": "Build a Curriculum Outline",
      "category": "HTML",
      "order": 1,
      "url": "/preview/projects/HTML/1_Build_a_Curriculum_Outline/index.html"
    }
  ]
}
```

The Worker caches a successful response for five minutes. It returns `Cache-Control: no-store` to the browser and keeps the shared cache in the Worker, so configuration changes and newly added projects appear after the cache window without browser cache surprises.

### `GET /preview/<path>`

Streams a file from the configured project repository at `HEAD`, with a content type inferred from the file extension so HTML and CSS render correctly in an iframe. Only paths under `PROJECTS_ROOT` are served. Responses are cached for five minutes. The gallery iframes are sandboxed so project scripts cannot read or modify the gallery page.

## Troubleshooting

- **Preview iframes are blank:** open the `/preview/projects/...` URL directly. If it returns a project, check the iframe sandbox and the browser console. If it fails, check `PROJECT_REPO`, `PROJECTS_ROOT`, and the GitHub raw URL.
- **External project site returns 404/1042:** either keep the default `PREVIEW_MODE=proxy`, or deploy the project repository and set `PROJECT_SITE` to that deployment's public URL with `PREVIEW_MODE=external`.
- **GitHub rate limit:** add a `GITHUB_TOKEN` Worker secret. The gallery can still show the last cached list in `localStorage`.
- **No projects found:** check `PROJECT_REPO` and `PROJECTS_ROOT`. The detected path must be `PROJECTS_ROOT/<category>/<folder>/index.html`.
- **Local `npm start` cannot find `/api/projects`:** that is expected. The dev server has no Worker; the app falls back to `config.json` + GitHub. Use `npm run preview` to test the Worker API and previews.
- **Private project repository:** the preview proxy is intended for public repositories. A private repository would require forwarding a token to raw GitHub and should be handled deliberately.

## Repository scope

This repository is only the base gallery. The separate project repository remains the source of truth. Do not add a `projects/` folder or a generated `projects.json` here.
