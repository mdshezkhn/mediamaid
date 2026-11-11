# Gemini Watermark Remover — Site Clone

A complete, verified clone of **[Gemini Watermark Remover](https://ishara-madu.github.io/gemini-watermark-remover/)** — a free, 100% client-side tool that removes Gemini / Nano Banana watermarks from AI images and videos using "mathematical alpha unblending" (all processing happens in the browser; no uploads).

- **Original author:** Ishara Madushanka ([ishara-madu](https://github.com/ishara-madu))
- **Original project:** https://github.com/ishara-madu/gemini-watermark-remover (MIT License — kept verbatim in [LICENSE](LICENSE))
- **Original live site:** https://ishara-madu.github.io/gemini-watermark-remover/
- **Original README:** preserved as [ORIGINAL-README.md](ORIGINAL-README.md)

## How this clone was made

Produced with two skills, following a capture → fetch-missing → verify pipeline:

1. **[Website-downloader](https://github.com/AhmadIbrahiim/Website-downloader)** — mirrored the live site with its exact wget recipe (`wget -mkEpnp --no-if-modified-since --quota=100m <url>`), capturing all 18 HTML/CSS/JS/asset files linked from the pages.
2. **[Remake](https://github.com/rubenhassid1/remake)** methodology — "fetch missing one at a time" repair (8 additional files referenced only from JS/manifests: `portfolio_images/`, manifest icons, `sitemap.xml`, `robots.txt`), then verification against the original.

**Verification result:** every file is byte-identical to the author's published source (line endings aside); the live site was in sync with the source repo at capture time. The only divergent copies (wget's `--convert-links` HTML rewrites) were replaced with the author's canonical bytes.

## What's inside

| Path | What it is |
| --- | --- |
| `index.html` | Home — image & video watermark remover (upload → remove → download) |
| `about.html`, `contact.html`, `disclaimer.html`, `privacy-policy.html`, `terms-of-service.html` | Secondary pages |
| `main.js` | All the image/video processing logic (client-side) |
| `style.css` | Full stylesheet (Ubuntu font via Google Fonts, Iconify icons via CDN) |
| `assets/`, `portfolio_images/` | Images, favicons, PWA manifest + icons |

## Run it locally

It's a static site — any web server works:

```bash
cd gemini-watermark-remover
python -m http.server 8080
# open http://localhost:8080
```

Or enable GitHub Pages on this repo (Settings → Pages → deploy from branch).

> Note: the Ubuntu font (fonts.googleapis.com) and Iconify icons (code.iconify.design) load from CDNs — on networks where those are slow/blocked the site still works, with default fonts and missing icon glyphs.

## License

MIT — © 2026 Ishara Madushanka. Cloned and redistributed with attribution under the terms of the original license. All credit for the tool, design and code goes to the original author.
