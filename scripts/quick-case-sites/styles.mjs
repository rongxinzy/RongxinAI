export const commonCss = `
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:#202523;background:#f5f4ef;font:14px/1.6 Inter,-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}button,a{font:inherit}a{color:inherit;text-decoration:none}button{cursor:pointer;color:inherit}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}.shell{width:min(1180px,calc(100% - 64px));margin:auto}.eyebrow,.mono{font:10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#7e8982}.top{height:64px;border-bottom:1px solid #deded7;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:650;letter-spacing:.04em}.top nav{display:flex;gap:24px;color:#606862;font-size:12px}.hero{padding:66px 0 44px;display:grid;grid-template-columns:1.05fr .95fr;gap:46px;align-items:center}.hero h1{font-size:clamp(38px,5vw,66px);line-height:1.08;letter-spacing:-.055em;font-weight:560;margin:18px 0}.hero p{max-width:52ch;color:#657069;font-size:15px}.tag{display:inline-flex;padding:6px 10px;border:1px solid #d8dbd4;border-radius:999px;color:#536159;font-size:11px}.button{border:0;background:#202a26;color:#f7f4e9;padding:11px 16px;border-radius:4px}.outline{background:transparent;color:#202a26;border:1px solid #cbd0c9}.metrics{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #daddd6;border-bottom:1px solid #daddd6}.metric{padding:17px 20px;border-right:1px solid #daddd6;display:grid;gap:2px}.metric:last-child{border:0}.metric strong{font:500 24px/1.2 ui-monospace,monospace;letter-spacing:-.06em}.metric span{color:#79827c;font-size:11px}.section{padding:35px 0 46px;border-bottom:1px solid #deded7}.section h2{font-size:21px;letter-spacing:-.035em;margin:4px 0 17px}.section-head{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:17px}.section-head p{color:#78817b;font-size:12px;margin:0}.split{display:grid;grid-template-columns:1fr 1fr;gap:30px}.panel{background:#fff;border:1px solid #e3e4de;padding:20px}.rows{list-style:none;margin:0;padding:0}.rows li{padding:12px 0;border-bottom:1px solid #ebede8;display:flex;justify-content:space-between;gap:16px}.rows li:last-child{border:0}.bars{height:180px;display:flex;align-items:end;gap:16px;padding:15px 5px 0;border-bottom:1px solid #dce0da}.bar-col{height:100%;flex:1;display:flex;flex-direction:column;justify-content:end;align-items:center;gap:8px;color:#838d86;font-size:10px}.bar-col i{display:block;width:min(30px,72%);height:var(--h);background:var(--accent);opacity:.84;border-radius:3px 3px 0 0}.note{border-left:2px solid var(--accent);padding:12px 16px;background:#fff;font-size:13px;color:#4d5b53}.footer{padding:20px 0 35px;color:#818a84;font-size:10px;display:flex;justify-content:space-between}.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{padding:7px 11px;border:1px solid #d8ddd6;background:transparent;border-radius:999px;color:#66716a;font-size:11px}.chip[aria-pressed=true]{background:#202a26;color:#fff;border-color:#202a26}.image{width:100%;height:320px;object-fit:cover;display:block}.photo-panel{position:relative;overflow:hidden;background:#dfe4dc}.photo-panel img{height:100%;min-height:320px;object-fit:cover}.photo-caption{position:absolute;bottom:0;left:0;right:0;padding:28px 18px 14px;color:white;background:linear-gradient(transparent,rgba(10,20,18,.64));font:10px ui-monospace,monospace;letter-spacing:.1em}
@media(max-width:760px){.shell{width:calc(100% - 36px)}.top nav{gap:12px}.top nav a:nth-child(n+3){display:none}.hero{grid-template-columns:1fr;gap:24px;padding:42px 0 28px}.hero h1{font-size:42px}.metrics{grid-template-columns:1fr}.metric{border-right:0;border-bottom:1px solid #daddd6;padding:12px 15px}.metric strong{font-size:20px}.split{grid-template-columns:1fr}.section{padding:27px 0}.image,.photo-panel img{min-height:230px;height:230px}.footer{gap:12px;flex-direction:column}}
`;

const casePalettes = {
  'pptx-education': ['#425b38', '#f5f0dc', '#263226', '#fffdf3'],
  'pptx-ai-intro': ['#7c6df1', '#090d1c', '#eff1ff', '#171b34'],
  'pptx-training': ['#e35e43', '#f7eee7', '#332a25', '#fffaf4'],
  'pptx-product-plan': ['#d89045', '#ede9e0', '#272624', '#f8f6ef'],
  'pptx-content-research': ['#32a88d', '#e7f0ec', '#23332e', '#f6faf7'],
  'pptx-annual-review': ['#799252', '#e9eddf', '#293327', '#f8f8f0'],
  'pptx-fundraising': ['#62c8d2', '#071b2a', '#e5f5f0', '#102d3a'],
  'image-to-excel': ['#d28c39', '#fbf4e7', '#30291f', '#fffaf0'],
  'excel-summary': ['#bc6449', '#f4ece7', '#342c28', '#fffaf7'],
  'multi-excel-merge': ['#658a9b', '#edf2f3', '#253239', '#fbfdfd'],
  'excel-reconcile': ['#bd9b4f', '#20231e', '#f2efe5', '#2a2e27'],
  'excel-pivot': ['#a967b2', '#f5eef6', '#342839', '#fffaff'],
  'excel-anomaly': ['#ef7759', '#171e26', '#e5ecf0', '#222c36'],
  'excel-forecast': ['#68996a', '#f0f3e7', '#293326', '#fcfff6'],
  'web-resume': ['#65a9b1', '#edf5f2', '#233638', '#fbfffc'],
  'web-store': ['#bb6a3e', '#f3e7d6', '#392a20', '#fff8eb'],
  'web-event': ['#e55245', '#17100f', '#fff0dc', '#261917'],
  'web-product-launch': ['#73a9f5', '#111820', '#edf1f7', '#1d2933'],
  'web-ops-console': ['#a6dc77', '#141b18', '#edf3df', '#1c2721'],
  'web-survey': ['#7c66c5', '#f0edf9', '#2c2840', '#fffefe'],
  'web-game-2048': ['#f7c747', '#f6e7bd', '#263747', '#fff5db'],
  'research-industry': ['#2fa4b5', '#e9f1f1', '#1f3033', '#f8fbfa'],
  'research-policy': ['#7b8fc8', '#edf0f7', '#242b3a', '#fbfcff'],
  'research-literature': ['#b27948', '#f4eee4', '#342b20', '#fffaf2'],
  'research-user': ['#d17d62', '#f8efeb', '#352a28', '#fffaf7'],
  'research-market-entry': ['#518b68', '#eaf1e8', '#28382d', '#fbfff8'],
  'research-supply-chain': ['#cd6851', '#f4ece8', '#332b29', '#fffcfa'],
  'research-talent': ['#6b77ae', '#edf0f8', '#272a3a', '#fcfcff'],
  'academic-polish': ['#bd5d59', '#f8eeee', '#392928', '#fffafa'],
  'academic-review': ['#547cac', '#edf2f8', '#273241', '#fafcff'],
  'academic-data-analysis': ['#9c754b', '#f3eee6', '#372f27', '#fffaf3'],
  'academic-method': ['#5c8f86', '#eaf2ef', '#253631', '#fafffc'],
  'academic-defense': ['#654aa2', '#f0edf7', '#2f2a3c', '#fffefe'],
  'academic-grant': ['#759253', '#edf1e4', '#2d3628', '#fcfff7'],
  'academic-ethics': ['#bd7799', '#f7edf3', '#372b33', '#fffaff'],
  'docs-meeting': ['#468d79', '#edf3ed', '#27332e', '#fbfff9'],
  'docs-report': ['#c16c54', '#f5ece7', '#392d29', '#fffbf8'],
  'docs-summary': ['#4384a8', '#edf3f6', '#27323a', '#fbfdff'],
  'docs-notice': ['#ce873e', '#f6efe0', '#352f24', '#fffaf0'],
  'docs-api': ['#6f79d0', '#eff0fb', '#292b40', '#fbfbff'],
  'docs-polish': ['#c15d6f', '#f8ecef', '#3a2930', '#fffafd'],
  'docs-sop': ['#77914d', '#eff1e6', '#30362b', '#fdfff8'],
  'pptx-climate': ['#309aab', '#071d2a', '#e7f1ec', '#102c38'],
  'pptx-hiring': ['#e5ad42', '#f7f1e4', '#342d20', '#fffaf0'],
  'pptx-exhibit': ['#c85b3c', '#f4e9db', '#32251e', '#fff8ef'],
  'pptx-cyber': ['#57d7c4', '#101623', '#e7f3f0', '#1a2430'],
  'excel-carbon': ['#4f8971', '#eaf0e8', '#27342e', '#fbfff9'],
  'excel-staffing': ['#6386c1', '#edf1f8', '#283141', '#fcfdff'],
  'excel-energy': ['#d39845', '#27231b', '#f4ecdc', '#332c20'],
  'excel-clinic': ['#50a9a0', '#e8f3f1', '#263735', '#fafffe'],
  'web-museum': ['#d99a52', '#201810', '#f4ead7', '#2b2118'],
  'web-restaurant': ['#b74436', '#f4e9dc', '#36251f', '#fffaf2'],
  'web-climate-map': ['#417eab', '#eaf1f5', '#24323b', '#fbfdff'],
  'web-language': ['#47a69b', '#102b30', '#e5f3ed', '#19373b'],
  'research-water': ['#398aa8', '#eaf2f5', '#23343c', '#fbfeff'],
  'research-heat': ['#bc6745', '#f4ece6', '#372c27', '#fffaf7'],
  'research-reuse': ['#768a4d', '#eef0e3', '#303629', '#fdfff6'],
  'research-childcare': ['#b56f92', '#f5edf2', '#372b34', '#fffbff'],
  'academic-replication': ['#405bb7', '#edf0f9', '#292e41', '#fcfcff'],
  'academic-interview': ['#a96447', '#f5ede6', '#352b26', '#fffcf8'],
  'academic-survey': ['#4b9589', '#eaf2ed', '#273630', '#fbfff9'],
  'academic-open-data': ['#7b6eb5', '#f0edf7', '#302c3b', '#fffefe'],
  'docs-board': ['#286f91', '#eaf0f3', '#26323a', '#fcfeff'],
  'docs-grant': ['#729351', '#edf1e4', '#2f3828', '#fdfff7'],
  'docs-research-protocol': ['#bd8b43', '#f3eee2', '#353025', '#fffaf0'],
  'docs-incident-comms': ['#ba5660', '#f6ecec', '#392a2e', '#fffbfb'],
};

export function caseSkin(c) {
  const palette = casePalettes[c.id];
  if (!palette) return '';
  const [accent, background, ink, surface] = palette;
  const root = `body[data-case="${c.id}"]`;
  const base = `${root}{--accent:${accent};--case-bg:${background};--case-ink:${ink};--case-surface:${surface};background:${background};color:${ink}}${root} .panel,${root} .slide-window,${root} .docblock,${root} .evidence,${root} .questionbox{background:${surface};color:${ink}}${root} .eyebrow{color:${accent}}${root} .metric strong{color:${ink}}`;
  const layouts = {
    'pptx-education': `${root} .deck main{grid-template-columns:1fr;gap:24px;align-content:start}${root} .deck aside{display:grid;grid-template-columns:1fr auto;align-items:end}${root} .deck aside h1{max-width:13ch}${root} .slides{display:grid;grid-template-columns:repeat(5,1fr);gap:4px}${root} .slide-window{grid-column:1/-1;grid-row:2;min-height:360px}${root} .slide-nav{border:1px solid #425b3833;padding:12px;display:grid}${root} .slide-nav.active{background:#425b3818}
`,
    'pptx-ai-intro': `${root} .deck main{grid-template-columns:.68fr 1.32fr;gap:5vw}${root} .deck aside h1{font-family:Inter,Arial,sans-serif;font-weight:750;letter-spacing:-.07em}${root} .slide-window{height:460px}${root} .slide h2{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .slide-nav{border-left:2px solid #ffffff14;border-bottom:0;padding-left:14px}${root} .slide-nav.active{border-left-color:${accent};background:#7c6df11a}
`,
    'pptx-training': `${root} .deck main{grid-template-columns:1fr;gap:20px}${root} .slides{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}${root} .slide-nav{border:1px solid #e35e4344;padding:10px;display:grid;min-height:66px}${root} .slide-window{grid-row:2;height:330px}${root} .slide h2{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .slide.current{border-top:7px solid ${accent}}
`,
    'pptx-product-plan': `${root} .deck main{grid-template-columns:.72fr 1.28fr;gap:3vw}${root} .deck aside h1{font-family:Georgia,serif;font-weight:400}${root} .slide-window{height:455px;background:#191a18;color:#f4f1e8}${root} .slide{background:linear-gradient(120deg,#191a18,#32302a);color:#f4f1e8}${root} .slide>p{color:#c3beb3}${root} .big-number{color:${accent}}${root} .slide-nav{font-size:10px}
`,
    'pptx-content-research': `${root} .deck main{grid-template-columns:1fr;align-content:start;gap:16px}${root} .deck aside{display:grid;grid-template-columns:1.2fr .8fr;align-items:center}${root} .deck aside h1{font-size:clamp(34px,4vw,54px)}${root} .deck aside .metrics{margin:0}${root} .slides{display:grid;grid-template-columns:200px 1fr;gap:18px}${root} .slide-window{height:390px}${root} .slide-nav{border-bottom:1px solid #23332e22}
`,
    'pptx-annual-review': `${root} .deck{max-width:1340px}${root} .deck main{grid-template-columns:.9fr 1.1fr}${root} .deck aside h1,.slide h2{font-family:Georgia,"Songti SC",serif;font-weight:400}${root} .slide-window{background:#e0e8d8;border:1px solid #79925255}${root} .slide{background:#e0e8d8}${root} .slide-nav{border-style:dotted}${root} .deck footer{color:#526244}
`,
    'pptx-fundraising': `${root} .deck{padding-left:9vw;padding-right:9vw}${root} .deck main{grid-template-columns:1fr;gap:15px;align-content:center}${root} .deck aside{display:grid;grid-template-columns:1fr auto;align-items:end}${root} .deck aside h1{font-size:clamp(40px,5vw,65px);max-width:14ch}${root} .deck aside .metrics{grid-column:1/-1;max-width:700px;margin-top:20px}${root} .slides{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}${root} .slide-window{grid-column:1/-1;grid-row:2;height:300px;background:#102d3a}${root} .slide{background:#102d3a;color:#e5f5f0}${root} .slide>p{color:#b3cbc5}${root} .big-number{font-size:58px}
`,
    'image-to-excel': `${root} .rail{background:#43311f}${root} .analysis{grid-template-columns:.72fr 1.28fr}${root} .analysis .panel:first-child{background:#30291f;color:#fff8ed}${root} .analysis .panel:first-child .eyebrow{color:#f0bd68}${root} .gridtable{border-top:4px solid ${accent}}${root} .sheethead h1{font-family:Georgia,serif}
`,
    'excel-summary': `${root} .app{grid-template-columns:1fr}${root} .rail{display:none}${root} .work{max-width:1220px;margin:auto;width:100%}${root} .analysis{grid-template-columns:1.25fr .75fr}${root} .kpis{border:0;border-bottom:2px solid ${accent};background:transparent}${root} .kpis .metric{border-top:1px solid #bc644944}${root} .gridtable{box-shadow:0 12px 32px #342c280c}
`,
    'multi-excel-merge': `${root} .app{grid-template-columns:86px 1fr}${root} .rail{padding:24px 10px}${root} .rail a{font-size:0}${root} .rail a:first-letter{font-size:15px}${root} .analysis{grid-template-columns:1fr}${root} .analysis .panel:first-child{display:none}${root} .gridtable{border-radius:0 20px 20px 20px;overflow:hidden}
`,
    'excel-reconcile': `${root} .app{grid-template-columns:1fr}${root} .rail{display:none}${root} .work{background:#20231e;color:#f2efe5;padding-left:7vw;padding-right:7vw}${root} .worktop{border-color:#ffffff22;color:#c0c4b9}${root} .worktop .button{color:#f2efe5;border-color:#ffffff33}${root} .sheethead p,${root} .table-head>span{color:#adb2a7}${root} .kpis,${root} .gridtable,${root} .panel{background:#2a2e27;color:#f2efe5;border-color:#ffffff20}${root} td,${root} th{border-color:#ffffff20}${root} th{background:#33382f;color:#c4c9bc}
`,
    'excel-pivot': `${root} .rail{background:#342839}${root} .analysis{grid-template-columns:.75fr 1.25fr}${root} .analysis .panel:first-child{grid-column:2;grid-row:1}${root} .analysis .panel:last-child{grid-column:1;grid-row:1}${root} .bars{height:230px}${root} .bar-col i{border-radius:14px 14px 0 0}
`,
    'excel-anomaly': `${root} .app{grid-template-columns:155px 1fr}${root} .rail{background:#222c36}${root} .work{background:#171e26;color:#e5ecf0}${root} .worktop{border-color:#ffffff20;color:#b6c4cb}${root} .sheethead p{color:#a3b0b8}${root} .kpis,${root} .panel,${root} .gridtable{background:#222c36;border-color:#35434d;color:#e5ecf0}${root} .analysis{grid-template-columns:1fr 1fr}${root} .bar-col i{box-shadow:0 0 18px #ef775955}
`,
    'excel-forecast': `${root} .app{grid-template-columns:1fr}${root} .rail{display:none}${root} .work{max-width:1080px;margin:auto;width:100%}${root} .sheethead h1{font-family:Georgia,serif;font-weight:450}${root} .analysis{grid-template-columns:1.4fr .6fr}${root} .analysis .panel:first-child{background:#e1ead7}${root} .bar-col i{border-radius:14px 14px 0 0}${root} .gridtable{border-left:5px solid ${accent}}
`,
    'web-resume': `${root} .hero{min-height:650px;position:relative;display:block;padding-top:130px}${root} .hero>div:first-child{position:relative;z-index:2;max-width:540px;background:#fbfffcf2;padding:28px}${root} .photo-panel{position:absolute;inset:0 0 0 28%;z-index:0}${root} .photo-panel img{height:100%;object-position:58% center}${root} .photo-caption{top:16px;bottom:auto;background:none;color:#fff;text-align:right}
`,
    'web-store': `${root} .top{border-bottom:2px solid #392a20}${root} .hero{grid-template-columns:.82fr 1.18fr;padding-top:34px}${root} .hero h1{font-family:Georgia,serif;font-weight:400}${root} .photo-panel{border-radius:48% 48% 2px 2px}${root} .photo-panel img{height:410px}${root} .button{background:#bb6a3e}${root} .section{border-bottom:0}
`,
    'web-event': `${root} .shell{width:min(760px,calc(100% - 40px))}${root} .top{height:54px;border-bottom-color:#ffffff28;color:#fff0dc}${root} .top nav{color:#d3bcb0}${root} .hero{display:flex;flex-direction:column;text-align:center;gap:0;padding:45px 0 35px}${root} .hero>div:first-child{order:2}${root} .photo-panel{order:1;width:100%;height:220px}${root} .photo-panel img{height:100%;min-height:0;filter:saturate(.7)}${root} .hero h1{font:400 clamp(42px,7vw,72px)/.98 Georgia,serif}${root} .button{background:#e55245}${root} .metrics{border-color:#ffffff30}${root} .metric{border-color:#ffffff30}
`,
    'web-product-launch': `${root} .shell{width:100%}${root} .top{padding:0 5vw;border-color:#ffffff20;color:#edf1f7}${root} .top nav{color:#bac4d0}${root} .hero{padding:0;min-height:610px;position:relative;display:flex;align-items:end}${root} .hero>div:first-child{position:relative;z-index:2;padding:5vw;max-width:650px;background:linear-gradient(90deg,#111820f0,#11182099,transparent);color:#edf1f7}${root} .hero p{color:#c1ccd6}${root} .photo-panel{position:absolute;inset:0 0 0 32%}${root} .photo-panel img{height:100%;min-height:0;object-position:62% center}${root} .metrics,${root} .section{margin-left:5vw;margin-right:5vw}${root} .button{background:#73a9f5;color:#111820}
`,
    'web-ops-console': `${root} .top{background:#1c2721;color:#edf3df;border:0;padding:0 24px}${root} .top nav{color:#aabca6}${root} .hero{grid-template-columns:.65fr 1.35fr;min-height:330px;padding:32px 0}${root} .hero h1{font:600 clamp(32px,4vw,48px)/1.1 ui-monospace,monospace;letter-spacing:-.07em}${root} .photo-panel{height:300px}${root} .panel{background:#1c2721;color:#edf3df;border-color:#344237}${root} .metrics{background:#1c2721;border-color:#344237;color:#edf3df}${root} .metric{border-color:#344237}
`,
    'web-survey': `${root} .hero{grid-template-columns:1fr 1fr;padding:55px 0}${root} .hero>div:first-child{background:#fff;padding:28px;border-radius:22px;box-shadow:0 18px 40px #372e5c12}${root} .panel.visual{border-radius:50% 50% 18px 18px;background:#7c66c5;min-height:360px}${root} .orbit{width:220px;height:220px;border-color:#fff8;left:18%;top:18%}${root} .sun{background:#f6cf58;left:63%}${root} .hero .button{background:#7c66c5}${root} .section{background:#fff;border:0;padding:30px;border-radius:20px;margin-top:24px}
`,
    'web-game-2048': `${root}{background:#f6e7bd}${root} .top{border:0}${root} .hero{grid-template-columns:.8fr 1.2fr}${root} .hero h1{font:800 clamp(38px,6vw,72px)/.95 Inter,Arial,sans-serif;color:#263747;text-transform:uppercase}${root} .panel.visual{border:8px solid #263747;border-radius:28px;background:#f7c747;min-height:360px}${root} .orbit{border:0;border-radius:16px;background:#fff5db;width:88px;height:88px;left:15%;top:25%;box-shadow:100px 90px #e88e53,185px 5px #67aaa0}${root} .sun{width:68px;height:68px;border-radius:16px;left:65%;top:52%;background:#df6349;box-shadow:none}${root} .hero .button{background:#263747}
`,
    'research-industry': `${root} .report{grid-template-columns:1fr;gap:28px}${root} .reportmeta{display:grid;grid-template-columns:repeat(4,1fr)}${root} .reporthero{max-width:860px}${root} .thesis{background:#d8eeee}${root} .evidence-grid{grid-template-columns:1fr 1fr 1fr}${root} .evidence{border-top:3px solid ${accent}}
`,
    'research-policy': `${root} .report{grid-template-columns:280px 1fr;gap:4vw}${root} .reportmeta{background:#242b3a;color:#fbfcff;padding:20px;height:max-content}${root} .reportmeta .eyebrow,${root} .reportmeta small{color:#aab8d8}${root} .reporthero h1{font-family:Inter,Arial,sans-serif;font-weight:680}${root} .thesis{background:#dce3f3;border-left-width:6px}${root} .evidence-grid{grid-template-columns:1fr}
`,
    'research-literature': `${root} .shell{max-width:980px}${root} .report{display:block;padding-top:30px}${root} .reportmeta{display:flex;flex-direction:row;flex-wrap:wrap;gap:12px 24px;border-bottom:1px solid #c9baa4;padding-bottom:15px}${root} .reportmeta .meta-block{min-width:140px}${root} .reporthero h1{font-family:Georgia,serif;font-weight:400}${root} .evidence-grid{grid-template-columns:1fr;border:0;background:transparent}${root} .evidence{border-bottom:1px solid #d9cdbd;background:transparent;min-height:0}
`,
    'research-user': `${root} .report{grid-template-columns:180px 1fr}${root} .reportmeta{border-left:4px solid ${accent};padding-left:14px}${root} .reporthero{background:#f2ddd3;padding:24px;margin:0 -24px}${root} .chart-layout{grid-template-columns:1fr}${root} .evidence-grid{grid-template-columns:repeat(3,1fr)}${root} .evidence{border-radius:18px;margin:5px}
`,
    'research-market-entry': `${root} .report{grid-template-columns:1fr;gap:20px;padding-top:30px}${root} .reportmeta{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid #c7d4c5;padding-bottom:15px}${root} .reporthero h1{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .thesis{background:#dae9d8}${root} .chart-layout{grid-template-columns:.75fr 1.25fr}${root} .nextsteps{border-radius:24px;overflow:hidden}
`,
    'research-supply-chain': `${root} .mast{background:#332b29;color:#fff}${root} .mastin,${root} .brand,${root} .brand span{color:#f4ece8}${root} .report{grid-template-columns:1fr;gap:24px}${root} .reportmeta{display:none}${root} .reporthero{max-width:700px}${root} .evidence-grid{grid-template-columns:repeat(3,1fr)}${root} .evidence:nth-child(2){transform:translateY(22px)}${root} .thesis{background:#f1ded8}
`,
    'research-talent': `${root} .report{grid-template-columns:200px 1fr}${root} .reportmeta{background:#272a3a;color:#fcfcff;padding:18px}${root} .reportmeta .eyebrow,${root} .reportmeta small{color:#bdc6e8}${root} .reporthero h1{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .evidence-grid{grid-template-columns:repeat(3,1fr)}${root} .evidence{border-top:2px solid ${accent}}
`,
    'academic-polish': `${root} .paper{display:block;max-width:920px}${root} .toc{display:none}${root} .paperhero h1{font-family:Georgia,serif;font-style:italic}${root} .questionbox{background:#f2dedd}${root} .method-table{border-radius:0 18px 18px 18px;overflow:hidden}
`,
    'academic-review': `${root} .paper{grid-template-columns:1fr 230px;gap:4vw}${root} .toc{grid-column:2;grid-row:1;position:sticky}${root} .paper article{grid-column:1;grid-row:1}${root} .paperhero h1{font-family:Inter,Arial,sans-serif;font-weight:700}${root} .logic div{border-radius:40px 8px 40px 8px}
`,
    'academic-data-analysis': `${root} .paper{grid-template-columns:1fr}${root} .toc{position:static;display:flex;flex-direction:row;flex-wrap:wrap;grid-row:1}${root} .paperhero{background:#372f27;color:#fffaf3;padding:30px;margin:0 -24px}${root} .paperhero>p,${root} .byline{color:#ddd0bd}${root} .method-table{border-radius:12px;overflow:hidden}
`,
    'academic-method': `${root} .paper{grid-template-columns:230px 1fr;gap:5vw}${root} .toc{border-right:1px solid #5c8f8633;padding-right:16px}${root} .paperhero h1{font-family:ui-monospace,monospace;font-size:clamp(31px,4vw,48px)}${root} .method-table>div{grid-template-columns:.9fr 1.2fr 1fr}
`,
    'academic-defense': `${root} .paper{max-width:1000px;display:block}${root} .toc{display:grid;grid-template-columns:repeat(5,1fr);margin-bottom:30px}${root} .toc a{display:grid;gap:5px}${root} .paperhero{background:#2f2a3c;color:#fff;padding:36px;margin:0 -32px}${root} .paperhero>p,${root} .byline{color:#d3cce4}${root} .logic div{background:#f0edf7;border-radius:50% 50% 8px 8px;text-align:center}
`,
    'academic-grant': `${root} .paper{grid-template-columns:1fr 200px;gap:3vw}${root} .toc{grid-column:2;grid-row:1;background:#e1ead5;padding:14px}${root} .paper article{grid-column:1;grid-row:1}${root} .paperhero h1{font-family:Georgia,serif;font-weight:400}${root} .questionbox{background:#e1ead5}${root} .callout{border-radius:24px 4px}
`,
    'academic-ethics': `${root} .paper{display:block;max-width:960px}${root} .toc{display:flex;flex-direction:row;flex-wrap:wrap;margin-bottom:24px}${root} .paperhero{border-left:6px solid ${accent};padding-left:20px}${root} .logic{grid-template-columns:repeat(5,1fr)}${root} .logic>i{display:none}${root} .logic div{border-radius:20px;text-align:center}
`,
    'docs-meeting': `${root} .doc{grid-template-columns:1fr}${root} .doc aside{display:none}${root} .doccover{background:#dcece2;padding:30px}${root} .docblock{border-left:1px solid #468d79;padding-left:16px}${root} .docblock .blocknum{font-size:18px}
`,
    'docs-report': `${root} .doc{grid-template-columns:220px 1fr;gap:4vw}${root} .doc aside{background:#392d29;color:#fffbf8;padding:18px}${root} .doc aside>a{color:#e1c7bc}${root} .doccover h1{font-family:ui-monospace,monospace;font-size:clamp(30px,4vw,48px)}${root} .docblock{background:#fff7f2;padding:18px;margin:12px 0}
`,
    'docs-summary': `${root} .doc{display:block;max-width:900px}${root} .doc aside{display:none}${root} .doccover{border-top:8px solid ${accent}}${root} .summary{background:#dceaf1;padding:26px}${root} .docblock{grid-template-columns:1fr 2fr;border:0;border-top:2px solid ${accent}}${root} .docblock .blocknum{font-size:25px}
`,
    'docs-notice': `${root} .doc{display:block;max-width:900px}${root} .doc aside{display:none}${root} .doccover{background:#f2e4c8;padding:28px}${root} .covermeta{background:#fffaf0;padding:12px}${root} .docblock{grid-template-columns:110px 1fr}${root} .docblock h2{font-family:Inter,Arial,sans-serif;font-weight:700}
`,
    'docs-api': `${root} .doc{grid-template-columns:1fr 235px;gap:4vw}${root} .doc aside{grid-column:2;grid-row:1;background:#292b40;color:#fbfbff;padding:16px}${root} .doc article{grid-column:1;grid-row:1}${root} .doccover h1{font-family:ui-monospace,monospace;font-size:clamp(31px,4vw,48px)}${root} .lineitem{font-family:ui-monospace,monospace;background:#eff0fb;padding:12px}
`,
    'docs-polish': `${root} .doc{grid-template-columns:1fr}${root} .doc aside{display:none}${root} .doccover{max-width:760px;margin:auto;border:0;text-align:center;padding:70px 0 45px}${root} .doccover h1{font-family:Georgia,serif;font-weight:400}${root} .summary{max-width:760px;margin:auto}${root} .docblock{border-top:1px dashed #c15d6f}
`,
    'docs-sop': `${root} .doc{grid-template-columns:200px 1fr}${root} .doc aside{background:#30362b;color:#fdfff8;padding:18px}${root} .doc aside>a{color:#d6dfc5}${root} .doccover{border-bottom:4px double ${accent}}${root} .questions label{padding:20px 10px;font-size:14px}${root} .questions input{width:19px;height:19px}
`,
  };
  const mobile = `@media(max-width:760px){
    body[data-case="research-policy"] .report,body[data-case="research-user"] .report,body[data-case="research-talent"] .report,body[data-case="docs-report"] .doc,body[data-case="docs-api"] .doc,body[data-case="docs-sop"] .doc{grid-template-columns:minmax(0,1fr)}
    body[data-case="research-policy"] .evidence-grid,body[data-case="research-user"] .evidence-grid,body[data-case="research-talent"] .evidence-grid{grid-template-columns:1fr}
    body[data-case="research-policy"] .reportmeta,body[data-case="research-talent"] .reportmeta{display:grid;grid-template-columns:1fr 1fr}
    body[data-case="research-user"] .reporthero{margin:0}
    body[data-case="academic-data-analysis"] .paperhero,body[data-case="academic-defense"] .paperhero{margin:0;padding:20px}
    body[data-case="docs-api"] .doc aside,body[data-case="docs-report"] .doc aside,body[data-case="docs-sop"] .doc aside{grid-column:auto;grid-row:auto}
    body[data-case="docs-api"] .doc article{grid-column:auto;grid-row:auto}
  }`;
  return `${base}${layouts[c.id] ?? ''}${mobile}`;
}
