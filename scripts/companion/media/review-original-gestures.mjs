import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { DESKTOP_PET_MOTIONS } from '../../../src/shared/desktopPet/motionCatalog.ts';

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    clip: { type: 'string' },
    serve: { type: 'boolean' },
    port: { type: 'string' },
  },
});
const output = path.resolve(values.out ?? '/tmp/xiaoyuan-original-gestures');
const root = fileURLToPath(new URL('../../..', import.meta.url));
const original = (
  await fs.readFile(path.join(root, 'src/renderer/assets/desktop-pet/xiaoyuan-atlas.png'))
).toString('base64');
const clip = values.clip ?? 'wave';
if (!DESKTOP_PET_MOTIONS.some(motion => motion.id === clip))
  throw new Error('Unknown authored motion');
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>小远 · 原版关节动作</title>
<style>body{margin:0;background:#eceef2;color:#202631;font:14px system-ui}header{display:flex;gap:16px;align-items:center;padding:20px 28px}h1{font-size:18px;margin:0}button,select{font:inherit;padding:5px 10px}section{display:flex;justify-content:center;gap:32px;padding:20px}section.light{background:#f8fafc}section.dark{background:#111419;color:#e4e7ec}figure{margin:0;text-align:center}canvas{display:block;width:192px;height:192px}figcaption{margin-top:8px}.clips{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:12px;padding:20px}.clips img{width:100%;max-width:128px}.clips a{color:inherit;text-align:center}footer{padding:16px 28px}</style>
<header><h1>小远 · 原版关节动作</h1><select id="motion">${DESKTOP_PET_MOTIONS.map(motion => `<option value="${motion.id}">${motion.id} · ${motion.seconds}s</option>`).join('')}</select><button id="toggle">暂停</button></header>
${['light', 'dark'].map(theme => `<section class="${theme}"><figure><canvas width="384" height="384" data-original></canvas><figcaption>第一版</figcaption></figure><figure><canvas width="384" height="384" data-motion></canvas><figcaption>关节动作 · 192 DIP</figcaption></figure></section>`).join('')}
<div class="clips">${DESKTOP_PET_MOTIONS.map(motion => `<a href="#${motion.id}"><img src="${motion.id}-poster.png" alt=""><div>${motion.id}</div></a>`).join('')}</div>
<footer>制作预览；任务与产品流程另行验证。</footer>
<script>const original=new Image();original.src='data:image/png;base64,${original}';const video=document.createElement('video');video.muted=true;video.loop=true;video.playsInline=true;
const select=document.querySelector('#motion');select.value=${JSON.stringify(clip)};
window.draw=()=>{for(const canvas of document.querySelectorAll('canvas')){const c=canvas.getContext('2d');c.setTransform(2,0,0,2,0,0);c.clearRect(0,0,192,192);if(canvas.hasAttribute('data-original'))c.drawImage(original,0,0,512,512,0,0,192,192);else if(video.readyState>=2)c.drawImage(video,0,0,192,192)}};
window.selectMotion=async(id,time=0)=>{if(!${JSON.stringify(DESKTOP_PET_MOTIONS.map(motion => motion.id))}.includes(id))throw Error('Unknown motion');video.pause();video.src=id+'.webm';await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=reject;video.load()});if(time)await new Promise(resolve=>{video.onseeked=resolve;video.currentTime=Math.min(time,video.duration-.04)});select.value=id;window.draw();};
window.reviewReady=original.decode().then(()=>window.selectMotion(select.value)).then(()=>video.play()).then(()=>{const loop=()=>{window.draw();requestAnimationFrame(loop)};loop()});
select.onchange=async()=>{await window.selectMotion(select.value);await video.play()};document.querySelector('#toggle').onclick=async e=>{if(video.paused){await video.play();e.target.textContent='暂停'}else{video.pause();e.target.textContent='播放'}};
document.querySelectorAll('.clips a').forEach(a=>a.onclick=async e=>{e.preventDefault();await window.selectMotion(a.hash.slice(1));await video.play()});
</script></html>`;
await fs.writeFile(path.join(output, 'index.html'), html);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 760, height: 610 },
    deviceScaleFactor: 2,
  });
  await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
  await page.evaluate(() => window.reviewReady);
  await page.evaluate(async id => {
    await window.selectMotion(id, 3.5);
  }, clip);
  await page.screenshot({ path: path.join(output, `${clip}-review.png`) });
} finally {
  await browser.close();
}
console.log(JSON.stringify({ output, clip }));
if (values.serve) {
  const allowed = new Set([
    'index.html',
    ...DESKTOP_PET_MOTIONS.flatMap(motion => [`${motion.id}.webm`, `${motion.id}-poster.png`]),
  ]);
  const server = createServer(async (request, response) => {
    const filename = request.url === '/' ? 'index.html' : request.url?.slice(1);
    if (!allowed.has(filename)) {
      response.writeHead(404).end();
      return;
    }
    try {
      const bytes = await fs.readFile(path.join(output, filename));
      response.writeHead(200, {
        'Content-Type': filename.endsWith('.webm')
          ? 'video/webm'
          : filename.endsWith('.png')
            ? 'image/png'
            : 'text/html; charset=utf-8',
        'Content-Length': bytes.length,
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      response.writeHead(404).end();
    }
  });
  const port = Number(values.port ?? 55419);
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`Original owl review is available at http://127.0.0.1:${port}/`);
}
