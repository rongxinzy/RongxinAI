"""Render setup HTML for visual review, never Windows installation acceptance."""
from pathlib import Path
import json
import shutil
from playwright.sync_api import sync_playwright

root = Path.cwd()
out = root / 'installer-style-evidence'
out.mkdir(exist_ok=True)
results = []
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,args=['--enable-unsafe-swiftshader'])
    source = root/'scripts/installer-shell/preview/index.html'
    name = 'main' if 'toggleInference' in source.read_text() else 'zhiyuan'
    for name, source in [(name, source)]:
        stage=out/name
        (stage/'assets').mkdir(parents=True,exist_ok=True)
        shutil.copy(root/'public/zhiyuan-logo-light-1600.png',stage/'assets/zhiyuan-logo-light-1600.png')
        shutil.copy(root/'build/icons/png/256x256.png',stage/'assets/256x256.png')
        html=source.read_text()
        (stage/'index.html').write_text(html)
        for language in ['zh','en']:
            page=browser.new_page(viewport={'width':860,'height':560},device_scale_factor=1)
            errors=[]
            page.on('pageerror',lambda error: errors.append(str(error)))
            page.add_init_script('''window.mockCalls=[]; window.chrome={webview:{hostObjects:{shell:{GetDefaultInstallDir:()=>Promise.resolve('C:\\\\Users\\\\Admin\\\\AppData\\\\Local\\\\Programs\\\\ZhiYuan Agent'), BrowseInstallDir:()=>Promise.resolve('D:\\\\Apps\\\\知远智能体'), GetLicenseText:()=>Promise.resolve('''+json.dumps((root/'LICENSE').read_text())+'''), StartInstall:(...args)=>{window.mockCalls.push(['install',...args]);return Promise.resolve()}, LaunchApp:()=>Promise.resolve(false), RequestClose:()=>Promise.resolve(), CancelInstall:()=>Promise.resolve()}},postMessage:()=>{},addEventListener:(_,cb)=>{window.engine=cb}}};''')
            page.goto((stage/'index.html').as_uri()+'?lang='+language)
            page.wait_for_timeout(250)
            assert page.locator('#btnInstall').is_disabled()
            page.screenshot(path=str(out/f'{name}-{language}-welcome.png'))
            page.locator('#btnLicense').click()
            page.locator('dialog[open]').wait_for()
            assert page.locator('#licenseText').inner_text()==(root/'LICENSE').read_text()
            assert page.locator('#btnInstall').is_disabled()
            page.screenshot(path=str(out/f'{name}-{language}-license.png'))
            page.keyboard.press('Escape')
            assert not page.locator('dialog').is_visible()
            page.locator('#licenseCheck').focus()
            page.keyboard.press('Space')
            assert page.locator('#btnInstall').is_enabled()
            page.wait_for_timeout(200)
            assert page.locator('#btnInstall').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(9, 13, 22)'
            page.screenshot(path=str(out/f'{name}-{language}-ready.png'))
            button=page.locator('#btnInstall')
            rect=button.bounding_box()
            cx,cy=rect['x']+rect['width']/2,rect['y']+rect['height']/2
            page.mouse.move(cx,cy)
            page.wait_for_timeout(150)
            page.screenshot(path=str(out/f'{name}-{language}-button-hover.png'))
            page.mouse.down()
            assert button.evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(51, 65, 85)'
            assert button.evaluate('(el)=>getComputedStyle(el).transform')=='none'
            assert button.bounding_box()==rect
            assert button.evaluate('(el)=>getComputedStyle(el).transitionDuration')=='0s'
            page.screenshot(path=str(out/f'{name}-{language}-button-pressed.png'))
            page.mouse.move(rect['x']-40,rect['y']-40)
            page.mouse.up()
            page.wait_for_timeout(150)
            assert page.evaluate('window.mockCalls.length')==0
            assert page.locator('#page-hero').is_visible()
            page.screenshot(path=str(out/f'{name}-{language}-button-release-outside.png'))
            page.locator('#btnCancelHero').focus()
            page.keyboard.press('Tab')
            assert page.evaluate('document.activeElement.id')=='btnInstall'
            assert button.evaluate('(el)=>getComputedStyle(el).outlineStyle')=='solid'
            page.screenshot(path=str(out/f'{name}-{language}-button-keyboard-focus.png'))
            page.locator('#btnBrowse').click()
            assert page.locator('#installPath').inner_text()=='D:\\Apps\\知远智能体'
            assert page.locator('#installPath').get_attribute('title')=='D:\\Apps\\知远智能体'
            if name=='main':
                page.locator('#toggleInference').check()
            page.locator('#btnInstall').focus()
            page.keyboard.press('Enter' if language=='zh' else 'Space')
            page.mouse.click(cx,cy,click_count=2,delay=30)
            assert page.evaluate('window.mockCalls.length')==1
            page.evaluate("window.engine({data:{type:'phase',label:'正在展开运行环境'}});window.engine({data:{type:'progress',percent:46}})")
            page.wait_for_timeout(600)
            page.screenshot(path=str(out/f'{name}-{language}-progress.png'))
            page.evaluate("window.engine({data:{type:'error',message:'无法写入安装目录。请关闭正在使用文件的应用后重试。',detail:'D:\\\\Apps\\\\知远智能体\\\\resources\\\\app.asar'}})")
            page.wait_for_timeout(250)
            page.screenshot(path=str(out/f'{name}-{language}-error.png'))
            if name=='zhiyuan': page.locator('#btnRetry').click()
            assert page.locator('#btnInstall').is_enabled()
            page.locator('#btnInstall').click()
            page.evaluate("window.engine({data:{type:'done',installDir:'D:\\\\Apps\\\\知远智能体'}})")
            page.wait_for_timeout(650)
            page.screenshot(path=str(out/f'{name}-{language}-complete.png'))
            assert page.locator('#btnLaunch').is_visible()
            page.evaluate("window.launchCalls=0; window.chrome.webview.hostObjects.shell.LaunchApp=()=>{window.launchCalls++;return new Promise(resolve=>window.resolveLaunch=resolve)}; void 0")
            page.locator('#btnLaunch').click()
            assert page.locator('#btnLaunch').is_disabled()
            assert page.locator('#btnLaunch').evaluate('(el)=>getComputedStyle(el).cursor')=='progress'
            assert page.locator('#btnLaunch').evaluate('(el)=>getComputedStyle(el).backgroundColor')=='rgb(220, 226, 233)'
            assert page.locator('#btnLaunch').evaluate('(el)=>getComputedStyle(el).color')=='rgb(82, 92, 113)'
            page.screenshot(path=str(out/f'{name}-{language}-launch-busy.png'))
            page.evaluate("document.getElementById('btnLaunch').click(); document.getElementById('btnLaunch').click()")
            assert page.evaluate('window.launchCalls')==1
            page.evaluate('window.resolveLaunch(false)')
            page.wait_for_function("!document.getElementById('btnLaunch').disabled")
            page.evaluate("window.engine({data:{type:'launch-error',message:'启动未成功，请重试。'}})")
            assert page.locator('#page-complete').is_visible()
            page.wait_for_timeout(150)
            page.screenshot(path=str(out/f'{name}-{language}-launch-retry.png'))
            page.evaluate("window.chrome.webview.hostObjects.shell.LaunchApp=()=>{window.launchCalls++;return Promise.reject(new Error('Launch rejected'))}; void 0")
            page.locator('#btnLaunch').click()
            page.wait_for_function("!document.getElementById('btnLaunch').disabled")
            assert page.evaluate('window.launchCalls')==2
            if name=='zhiyuan': assert 'Launch rejected' in page.locator('#launchError').inner_text()
            assert not errors,errors
            results.append({'repo':name,'language':language,'errors':errors,'calls':page.evaluate('window.mockCalls'),'checks':['license click and real text','no implicit consent','Escape dismiss','keyboard consent','path picker result','install admission','progress event','error/retry','done/launch visibility','pointer press immediate color and zero transition','no press transform or geometry shift','release outside cancels','Tab focus visible','Enter/Space admission','repeated click admits once','busy launch disables repeat and restores retry']})
            page.close()
        # Same production HTML at high density, constrained logical viewport,
        # reduced motion, high contrast and a very long mixed-language path.
        for label, width, height, density, contrast in [('2x',860,560,2,None), ('compact',560,420,1,None), ('contrast',860,560,1,'active')]:
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=density,reduced_motion='reduce',forced_colors=contrast)
            page.goto((stage/'index.html').as_uri()+'?lang=en')
            # Standalone preview assets resolve at repo-relative paths; use the staged
            # local brand assets for this viewport-only check, without touching the HTML.
            page.evaluate("document.querySelector('.demo-bar').remove(); document.querySelectorAll('[data-asset]').forEach(el=>el.src=el.dataset.asset==='wordmark'?'assets/zhiyuan-logo-light-1600.png':'assets/256x256.png')")
            long_path='D:\\客户项目与资料\\A very long folder name for the selected installation directory\\ZhiYuan Agent'
            page.evaluate('(value)=>setInstallPath(value)',long_path)
            assert page.locator('#installPath').get_attribute('title')==long_path
            assert page.locator('#installPath').get_attribute('aria-label')==long_path
            assert page.locator('#installPath').inner_text()==long_path
            page.locator('#licenseCheck').focus()
            page.keyboard.press('Space')
            assert page.locator('#btnInstall').is_enabled()
            page.locator('#btnInstall').scroll_into_view_if_needed()
            bounds=page.locator('#btnInstall').bounding_box()
            assert bounds['x']>=0 and bounds['y']>=0 and bounds['x']+bounds['width']<=width and bounds['y']+bounds['height']<=height
            assert page.locator('.page.active').evaluate('(el)=>el.scrollWidth<=el.clientWidth')
            page.screenshot(path=str(out/f'{name}-en-{label}-long-path.png'))
            results.append({'repo':name,'viewport':label,'checks':['full long-path text/title/accessible name','keyboard consent','install action reachable','no horizontal overflow']})
            page.close()
    browser.close()
(out/'browser-checks.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print('Rendered actual HTML and verified browser DOM flows. Host is mocked; not Windows acceptance.')
