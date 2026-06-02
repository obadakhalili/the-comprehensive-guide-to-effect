# The Comprehensive Guide to Effect — website

A static, multi-page HTML article. No build step, no framework. Drop the folder on any static host.

## Pages

| File | Page |
|---|---|
| `index.html` | Landing — banner, overview, links to both parts |
| `part-1.html` | Part 1 — What is Effect (the *why*) |
| `part-2.html` | Part 2 — overview + index into the six sections |
| `part-2-1.html` … `part-2-6.html` | Sections 2.1–2.6 |

`assets/style.css` is the theme. `assets/site.js` runs syntax highlighting and the interactive
trace steppers (2.1 and 2.4). Fonts come from Google Fonts; syntax highlighting from the
highlight.js CDN. Everything else is local.

## Deploy (Netlify)

Drag this `site/` folder into Netlify, or point a site at it with publish directory `site`. No build
command needed.

## Before you ship — two things to set

1. **Domain.** The canonical / Open Graph / sitemap URLs use the placeholder
   `https://effect-guide.netlify.app`. Find-and-replace it with your real domain across the `.html`
   files, `robots.txt`, and `sitemap.xml`.
2. **Social image.** The pages reference `og-image.png` for link embeds — add a `1200×630` image at
   `site/og-image.png`. The banner area on `index.html` (the `.banner`) is also where you said you may
   drop your own artwork later; replace the inline SVG there if you do.

`favicon.svg` is a placeholder mark — swap it for your icon whenever you have one.
