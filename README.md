# Nemo Explores

Interactive explainers that recreate and simulate scientific papers. Each
project rebuilds a paper's actual model so you can run it — change a parameter,
watch the system respond — rather than just read about it.

The site is plain static HTML. No build step, no dependencies, no server.

---

## Layout

```
nemoexplores/
├── index.html              The landing page. Links to every project.
├── README.md               This file.
├── assets/                 Landing-page assets ONLY.
│   ├── site.css            Landing-page styles.
│   ├── favicon.svg         Site icon.
│   └── tiles/              One preview image per project.
│       └── daisyworld.jpg
└── daisyworld/             One folder per project, self-contained.
    ├── index.html
    ├── three.min.js
    └── ...
```

Two rules keep this simple as it grows:

1. **One folder per project, at the root.** The folder name is the URL
   (`/daisyworld/`), so keep it short, lowercase, and hyphenated.
2. **Projects are self-contained.** A project owns its own HTML, CSS, JS, and
   libraries. It never imports from `assets/` — that directory belongs to the
   landing page. This means a project can be copied, zipped, or opened straight
   from disk years later and still work.

The landing page's palette and type deliberately match Daisyworld's, so
clicking a tile feels like moving deeper into one site rather than leaving for
another.

---

## Adding a project

### 1. Create the folder

```bash
mkdir ~/code/nemoexplores/lorenz-attractor
# put index.html and anything it needs inside
```

Everything the page needs must live in that folder. Referencing a CDN is fine
while drafting, but vendoring the file is what keeps the page working when the
CDN changes or disappears.

### 2. Make a tile

A 16:10 screenshot of the project's most recognisable visual — for Daisyworld,
the globe. Save it as `assets/tiles/<folder-name>.jpg`.

The tile should be **imagery, not a screenshot of a title**: the card supplies
the project name, so a tile filled with small unreadable text wastes the space.
Frame the thing itself.

Then size it down — around 1600px wide is plenty for a card, even on a retina
display:

```bash
sips -Z 1600 assets/tiles/lorenz-attractor.jpg
```

Aim for roughly 100–200 KB. Ten projects at 2 MB each makes a slow landing page.

### 3. Add the card

In `index.html`, find the `PROJECTS` comment block and copy the existing
`<a class="card">` block. Newest first.

```html
<a class="card" href="lorenz-attractor/">
  <div class="card-img">
    <img src="assets/tiles/lorenz-attractor.jpg"
         alt="Describe the image for screen readers and when it fails to load."
         loading="lazy" width="1600" height="1000">
  </div>
  <div class="card-body">
    <h3>Lorenz Attractor</h3>
    <p class="paper">Lorenz · J. Atmos. Sci. · 1963</p>
    <p>One or two sentences on the question the paper asks.</p>
    <div class="tags">
      <span class="tag">Chaos</span>
      <span class="tag">Live model</span>
    </div>
  </div>
</a>
```

Update the `01 published` count in the section header, and delete the
`card soon` placeholder once there are enough real cards to fill the row.

---

## Previewing locally

Opening `index.html` directly with `file://` works, but relative links behave
slightly differently than on a real host. A local server matches production:

```bash
cd ~/code/nemoexplores
python3 -m http.server 8000
# then open http://127.0.0.1:8000/
```

Note that `python3 -m http.server` prints `http://[::]:8000/` — prefer
`http://127.0.0.1:8000/`.

---

## Deploying

Any static host works, since there is nothing to build: point it at this
directory and serve it. GitHub Pages, Netlify, Cloudflare Pages, or plain
nginx all serve it as-is.

### Fill these in when the site goes live

- **`index.html` footer** — there is a commented-out `<a>` for the YouTube
  channel URL. Uncomment it and add the link.
- **`index.html` About section** — the `Publications ↗` link in the `.bio`
  block currently points at `#`. Replace it with the Google Scholar profile URL.
- **`index.html` `og:image`** — currently a relative path. Most platforms will
  not resolve that when generating a link preview, so make it absolute
  (`https://your-domain/assets/tiles/daisyworld.jpg`) once you have a domain.
  This is what shows when you paste a link in a YouTube description or a chat.

---

## Conventions worth keeping

| Thing | Convention |
|---|---|
| Folder name | lowercase, hyphenated, matches the tile filename |
| Tile | `assets/tiles/<folder>.jpg`, 16:10, ~1600px wide |
| Paper credit | `Author · Journal · Year` in the `.paper` line |
| Tags | 2–3, short, uppercase-styled by CSS — write them normally |
| Alt text | Describe the visual, not the project |

The landing page is hand-edited on purpose. A generator or a JSON manifest
would add a build step and a failure mode to a site whose entire virtue is that
it is a folder of files that open in a browser.
