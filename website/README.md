# LEO Official Website

This directory contains the official product website for **LEO** (RongxinAI), a local-first AI Agent workspace.

## Tech

- Single `index.html` with embedded CSS + JS — zero dependencies, zero build step
- Dark theme matching the Electron app's brand identity
- Fully responsive (mobile, tablet, desktop)
- Scroll-triggered fade-in animations via IntersectionObserver

## Preview Locally

```bash
# Start a simple HTTP server in this directory
npx serve website/
# or
python -m http.server 8080 -d website/
```

Open `http://localhost:8080` (or whichever port the server uses).

## Deploy

The website is fully static and can be deployed to any static host:

- **GitHub Pages**: push the `website/` directory or set it as the Pages root
- **Vercel / Netlify**: point to the `website/` folder
- **Any CDN / S3**: upload `website/index.html`

## Structure

```
website/
├── index.html     # Single-page website (all-in-one)
└── README.md      # This file
```
