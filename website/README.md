# 知远智能体 Official Website

This directory contains the official product website for **知远智能体 (ZhiYuan Agent)**, a local-first AI Agent workspace with a fully self-developed stack.

## Tech

- Static HTML with embedded or linked CSS — zero dependencies, zero build step
- Dark theme matching the Electron app's brand identity
- Fully responsive (mobile, tablet, desktop)
- Scroll-triggered fade-in animations via IntersectionObserver (homepage)

## Preview Locally

```bash
# Start a simple HTTP server in this directory
npx serve website/
# or
python -m http.server 8080 -d website/
```

Open `http://localhost:8080` (or whichever port the server uses). Blog pages live under `/blog/`.

## Deploy

The website is fully static and can be deployed to any static host:

- **GitHub Pages**: push the `website/` directory or set it as the Pages root
- **Vercel / Netlify**: point to the `website/` folder
- **Any CDN / S3**: upload the `website/` tree

## Structure

```
website/
├── index.html          # Landing page (embedded CSS + JS)
├── css/
│   └── common.css      # Shared styles for blog pages
├── blog/
│   ├── index.html      # Blog list
│   ├── xiaoyuan.html   # Desktop companion 「小远」 introduction
│   └── images/         # Blog assets (optimized previews)
└── README.md           # This file
```
