import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.MLSM_PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../',import.meta.url)),temp=mkdtempSync(join(tmpdir(),'mlsm-peak-'));
const app=root+'apps/desktop/';
execFileSync(root+'node_modules/.bin/esbuild',['--bundle','--format=esm','--loader=tsx','--jsx=automatic',`--outfile=${temp}/peak.js`],{input:`import React from ${JSON.stringify(root+'node_modules/react')};import {createRoot} from ${JSON.stringify(root+'node_modules/react-dom/client')};import {AnalyzerCanvas} from ${JSON.stringify(app+'src/streamer/AnalyzerCanvas.tsx')};const runtime={frame:{peak:[-7,-6.1],truePeak:[-6.5,-6.1],hold:[-4,-3],clip:[true,true],momentary:-86.7,shortTerm:-12.7,integrated:-17.1,lra:10.4,maxMomentary:-14.9,maxShortTerm:-16.6,maxTruePeak:-3.9,sampleRate:48000,elapsed:2,sequence:1},get receivedAt(){return performance.now()}};createRoot(document.getElementById('root')).render(<AnalyzerCanvas kind={location.pathname.includes("loudness")?"loudness":"peaks"} runtime={runtime} language="en" theme="night"/>);`,cwd:app});
const browser=await chromium.launch({headless:true,executablePath:process.env.MLSM_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();page.on("pageerror",error=>console.error(error.message));
 await page.addInitScript(()=>{
  const proto=CanvasRenderingContext2D.prototype,fill=proto.fillRect,text=proto.fillText;
  proto.fillRect=function(x,y,w,h){if(x===0&&y===0)this.canvas.labels=[];return fill.call(this,x,y,w,h);};
  proto.fillText=function(value,x,y,...rest){const m=this.measureText(value);(this.canvas.labels??=[]).push({value,x:x-m.actualBoundingBoxLeft,right:x+m.actualBoundingBoxRight,y:y-m.actualBoundingBoxAscent,bottom:y+m.actualBoundingBoxDescent});return text.call(this,value,x,y,...rest);};
 });
 await page.route('https://mlsm.test/**',route=>route.fulfill({contentType:route.request().url().endsWith('.js')?'application/javascript':'text/html',body:route.request().url().endsWith('.js')?readFileSync(temp+'/peak.js'):'<style>body{margin:0;background:#222225}#root{width:240px;height:300px}.sav-canvas{display:block;width:100%;height:100%}</style><div id="root"></div><script type="module" src="/peak.js"></script>'}));
 for(const kind of ['peaks','loudness']) {
 await page.goto('https://mlsm.test/'+kind);await page.locator('canvas').waitFor();await page.waitForFunction(()=>document.querySelector('canvas')?.labels?.length>0);
 for(const width of (kind==='peaks'?[90,120,160,240,360]:[240,360,500]))for(const height of [110,130,160,180,200,300]){
  await page.locator('#root').evaluate((e,{width,height})=>{e.style.width=width+'px';e.style.height=height+'px';},{width,height});await page.waitForTimeout(100);
  const labels=await page.locator('canvas').evaluate(e=>e.labels);
  assert.ok(labels.some(l=>l.value===(kind==='peaks'?'R':'LUFS · M')));
  for(const label of labels)assert.ok(label.x>=0&&label.y>=0&&label.right<=width&&label.bottom<=height,`${width}x${height}: out of bounds ${JSON.stringify(label)}`);
  for(let i=0;i<labels.length;i++)for(let j=i+1;j<labels.length;j++){const a=labels[i],b=labels[j];assert.ok(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,`${width}x${height}: overlapping ${a.value} / ${b.value}`);}
  await page.locator('canvas').screenshot({path:`/private/tmp/${kind}-${width}-${height}.png`});
 }
 }
 console.log('PASS: peak and loudness labels stay within canvas without overlaps at six heights (110–300px), across narrow/wide widgets.');
}finally{await browser.close();rmSync(temp,{recursive:true,force:true});}
