import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

// Standalone review artifact: first-release draw size, current video, and the isolated quality study.
const root = fileURLToPath(new URL('../../..', import.meta.url));
const output = path.resolve(process.argv[2] ?? '/tmp/xiaoyuan-quality-v2');
const data = async (file, mime) =>
  `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
const sources = {
  original: await data(
    path.join(root, 'src/renderer/assets/desktop-pet/xiaoyuan-atlas.png'),
    'image/png',
  ),
  current: await data(
    path.join(root, 'src/renderer/assets/desktop-pet/motion/xiaoyuan/idle.webm'),
    'video/webm',
  ),
  study: await data(path.join(output, 'idle.webm'), 'video/webm'),
};
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>小远：形象与待机对照</title>
<style>body{margin:0;font:14px system-ui;color:#202631;background:#eceef2}header{display:flex;align-items:center;gap:20px;padding:20px 28px}h1{font-size:18px;margin:0}button{font:inherit;padding:5px 12px}section{display:grid;grid-template-columns:repeat(3,224px);gap:12px;justify-content:center;padding:16px}article{text-align:center}canvas{display:block;width:192px;height:192px;margin:0 auto}p{margin:8px}section[data-theme=light]{background:#f8fafc;color:#202631}section[data-theme=dark]{background:#111419;color:#e4e7ec}footer{padding:12px 28px;font-size:12px}</style>
<header><h1>小远：形象与待机对照</h1><button id="play">暂停</button></header>
${['light', 'dark'].map(theme => `<section data-theme="${theme}">${['第一版原图', '当前分层动画', '小远修订样片'].map((label, index) => `<article><canvas width="384" height="384" data-kind="${index}"></canvas><p>${label}</p></article>`).join('')}</section>`).join('')}
<footer>每只均为 192 DIP；第一版按当时的原始绘制比例。修订仅是四秒待机样片，尚未替换正式动作。</footer>
<script>const sources=${JSON.stringify(sources)};const image=new Image();image.src=sources.original;
const videos=[sources.current,sources.study].map(src=>{const v=document.createElement('video');v.src=src;v.loop=true;v.muted=true;v.playsInline=true;return v});
window.drawStudy=()=>{for(const canvas of document.querySelectorAll('canvas')){const c=canvas.getContext('2d');c.setTransform(2,0,0,2,0,0);c.clearRect(0,0,192,192);const kind=Number(canvas.dataset.kind);if(kind===0)c.drawImage(image,0,0,image.naturalWidth/3,image.naturalHeight/2,0,0,192,192);else if(videos[kind-1].readyState>=2)c.drawImage(videos[kind-1],0,0,192,192)}};
const loop=()=>{window.drawStudy();requestAnimationFrame(loop)};
window.studyReady=Promise.all([image.decode(),...videos.map(v=>new Promise((resolve,reject)=>{v.onloadeddata=resolve;v.onerror=reject}))]).then(async()=>{await Promise.all(videos.map(v=>v.play()));loop();return true});
window.studyVideos=videos;document.querySelector('#play').onclick=async e=>{const paused=videos[0].paused;for(const v of videos){if(paused)await v.play();else v.pause()}e.target.textContent=paused?'暂停':'播放'};
</script></html>`;
await fs.writeFile(path.join(output, 'review.html'), html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 760, height: 628 },
    deviceScaleFactor: 2,
  });
  await page.goto(new URL(`file://${path.join(output, 'review.html')}`).href);
  await page.evaluate(() => window.studyReady);
  await page.evaluate(async () => {
    await Promise.all(
      window.studyVideos.map(
        v =>
          new Promise(resolve => {
            v.pause();
            v.onseeked = resolve;
            v.currentTime = 0.8;
          }),
      ),
    );
    window.drawStudy();
  });
  await page.screenshot({ path: path.join(output, 'review.png'), fullPage: true });
  await page.evaluate(async () => {
    const video = window.studyVideos[1];
    await new Promise(resolve => {
      video.onseeked = resolve;
      video.currentTime = 1.6;
    });
    window.drawStudy();
  });
  await page.screenshot({ path: path.join(output, 'review-blink.png'), fullPage: true });
  console.log(
    JSON.stringify({
      review: path.join(output, 'review.html'),
      screenshot: path.join(output, 'review.png'),
      nativeSize: 192,
    }),
  );
} finally {
  await browser.close();
}
