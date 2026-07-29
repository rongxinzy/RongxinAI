#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SLIDE_FILE_PATTERN = /^slide-(\d+)\.js$/;
const SLIDE_SCRIPT_PATTERN =
  /\s*<script\s+type="module"\s+src="\/src\/slides\/slide-\d+\.js"><\/script>\s*/g;

function loadPptProject(projectDirectory) {
  const projectFile = path.join(projectDirectory, 'docs', 'project.json');
  if (!fs.existsSync(projectFile)) throw new Error(`project file not found: ${projectFile}`);
  const project = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
  if (project.project_type !== 'ppt')
    throw new Error(`workspace is not a PPT project: ${projectFile}`);
}

function listSlides(slidesDirectory) {
  if (!fs.existsSync(slidesDirectory)) return [];
  return fs
    .readdirSync(slidesDirectory)
    .map(fileName => {
      const match = fileName.match(SLIDE_FILE_PATTERN);
      return match ? { fileName, pageNumber: Number.parseInt(match[1], 10) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

function validateTargetSlide(slidesDirectory, slideFile) {
  const absoluteSlideFile = path.resolve(slideFile);
  const relative = path.relative(slidesDirectory, absoluteSlideFile);
  if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`slide file must be inside ${slidesDirectory}: ${absoluteSlideFile}`);
  }
  if (!SLIDE_FILE_PATTERN.test(path.basename(absoluteSlideFile))) {
    throw new Error(`slide file must match slide-N.js: ${absoluteSlideFile}`);
  }
  if (!fs.existsSync(absoluteSlideFile))
    throw new Error(`slide file not found: ${absoluteSlideFile}`);
}

function syncIndex(indexFile, slides) {
  if (!fs.existsSync(indexFile)) throw new Error(`frontend index not found: ${indexFile}`);
  let content = fs.readFileSync(indexFile, 'utf8').replace(SLIDE_SCRIPT_PATTERN, '\n');
  const scriptTags = slides
    .map(
      ({ pageNumber }) =>
        `    <script type="module" src="/src/slides/slide-${pageNumber}.js"></script>`,
    )
    .join('\n');
  if (!content.includes('</body>'))
    throw new Error(`frontend index has no closing body tag: ${indexFile}`);
  content = content.replace('</body>', `${scriptTags}${scriptTags ? '\n' : ''}  </body>`);
  fs.writeFileSync(indexFile, content, 'utf8');
}

function syncPages(projectDirectory, slides) {
  const pagesFile = path.join(projectDirectory, 'docs', 'pages.json');
  let previousPages = [];
  if (fs.existsSync(pagesFile)) {
    const parsed = JSON.parse(fs.readFileSync(pagesFile, 'utf8'));
    if (Array.isArray(parsed)) previousPages = parsed;
  }
  const previousByNumber = new Map(previousPages.map(page => [page.pageNum, page]));
  const pages = slides.map(({ pageNumber }) => ({
    ...previousByNumber.get(pageNumber),
    pageKey: `ppt-${pageNumber}`,
    title: previousByNumber.get(pageNumber)?.title || '',
    url: `/index.html?page=${pageNumber}`,
    poster: previousByNumber.get(pageNumber)?.poster || '',
    pageNum: pageNumber,
  }));
  fs.writeFileSync(pagesFile, JSON.stringify(pages, null, 2), 'utf8');
}

function syncProject(projectDirectory, targetSlide) {
  loadPptProject(projectDirectory);
  const slidesDirectory = path.join(projectDirectory, 'frontend', 'src', 'slides');
  if (targetSlide) validateTargetSlide(slidesDirectory, targetSlide);
  const slides = listSlides(slidesDirectory);
  syncIndex(path.join(projectDirectory, 'frontend', 'index.html'), slides);
  syncPages(projectDirectory, slides);
  console.log(`[PptSync] synchronized ${slides.length} slide(s)`);
  return slides;
}

function main() {
  const projectArgument = process.argv[2];
  const slideArgument = process.argv[3];
  if (!projectArgument || !slideArgument) {
    console.error('Usage: node post-slide.js <workspace-dir> <absolute-slide-file>');
    process.exit(1);
  }
  syncProject(path.resolve(projectArgument), path.resolve(slideArgument));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error('[PptSync] synchronization failed:', error);
    process.exit(1);
  }
}

module.exports = { listSlides, syncProject };
