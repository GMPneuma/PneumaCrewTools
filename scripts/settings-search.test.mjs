import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {test} from 'node:test';
import ts from 'typescript';
const config={"file":"src/settings-layout.ts","fn":"groupModuleSettings","keys":["payoutAcknowledgmentsEnabled","rentSettings","actorExclusions","discordMarkdownEnabled","discordLinksMenu"],"extra":null};
const root=new URL('../',import.meta.url);
const nativePath=process.env.PNEUMA_FOUNDRY_SOURCE;
test('grouped settings retain native v12 search categories, hints and reset',{skip:!nativePath},async()=>{
 const {chromium}=await import(process.env.PNEUMA_PLAYWRIGHT_MODULE||'playwright');
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const source=await readFile(nativePath,'utf8');
  const start=source.indexOf('  _onSearchFilter(',source.indexOf('class PackageConfiguration extends'));
  assert.ok(start>0);const method=source.slice(start,source.indexOf('\n  }',start)+4);
  const moduleId=JSON.parse(await readFile(new URL('package.json',root),'utf8')).name;
  const load=async file=>ts.transpileModule(process.env.PNEUMA_SEARCH_BASELINE?execFileSync('git',['show','HEAD:'+file],{cwd:root,encoding:'utf8'}):await readFile(new URL(file,root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace(/^import .*;\s*/gm,'').replace(/export /g,'');
  const layout=await load(config.file),extra=config.extra?await load(config.extra):'';
  for(const reverse of config.extra?[false,true]:[false]){
   const page=await browser.newPage();
   await page.setContent('<div class="category" data-category="'+moduleId+'">'+config.keys.map((key,i)=>'<div class="form-group"><label>SearchLabel'+i+'</label><div class="form-fields">'+(key.endsWith('Menu')||key==='configureEvasion'?'<button data-key="'+moduleId+'.'+key+'">Configure</button>':key==='combatBarDock'||key==='combatBarOrientation'?'<select name="'+moduleId+'.'+key+'"><option value="bottom-docked">Dock</option><option value="horizontal">Horizontal</option></select>':'<input type="checkbox" name="'+moduleId+'.'+key+'" checked>')+'</div><p class="notes">SearchHint'+i+'</p></div>').join('')+'</div><div class="category" data-category="other"><div class="form-group"><label>Unrelated</label></div></div>');
   await page.addScriptTag({content:'const MODULE_ID='+JSON.stringify(moduleId)+';window.game={user:{isGM:true}};window.SearchFilter={cleanQuery:s=>s.toLowerCase()};'+layout+'\n'+extra+'\nwindow.group=()=>{'+(config.extra&&reverse?'groupRevealSettings(document.body);':'')+config.fn+'(document.body);'+(config.extra&&!reverse?'groupRevealSettings(document.body);':'')+'};window.nativeFilter=(new (class {'+method+'})())._onSearchFilter;'});
   await page.evaluate(()=>{window.original=document.querySelector('input');window.draft=original?.checked;group();group();});
   for(let i=0;i<config.keys.length;i++)for(const text of ['searchlabel'+i,'searchhint'+i]){
    const visible=await page.evaluate(({text,moduleId})=>{nativeFilter(null,text,new RegExp(text,'i'),document.body);return !document.querySelector('.category[data-category="'+moduleId+'"]').classList.contains('hidden');},{text,moduleId});
    assert.equal(visible,!process.env.PNEUMA_SEARCH_BASELINE,text);
   }
   await page.evaluate(()=>nativeFilter(null,'no-such-setting',/no-such-setting/,document.body));
   assert.equal(await page.locator('.category:not(.hidden)').count(),0);
   await page.evaluate(()=>nativeFilter(null,'',/(?:)/,document.body));
   assert.equal(await page.locator('.category.hidden,.form-group.hidden').count(),0);
   assert.equal(await page.evaluate(()=>original.isConnected&&original.checked===draft),true);
   await page.close();
  }
 } finally {await browser.close();}
});
