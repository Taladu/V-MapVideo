const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('gps-video-library.js','utf8');
assert(source.includes("const orderedSources = manifest.sources.slice().sort((a, b) => (Number(b?.priority) || 0) - (Number(a?.priority) || 0));"),'priority-before-dedupe missing');

const manifest={version:'test',sources:[
  {id:'low',file:'low.json',enabled:true,priority:0},
  {id:'high',file:'high.json',enabled:true,priority:200}
]};
const low={routes:[{id:'same-id',name:'LOW',youtube:'abcdefghijk',points:[[106.8,10.8,0],[106.801,10.8,1]]}]};
const high={routes:[{id:'same-id',name:'HIGH',youtube:'abcdefghijk',points:[[106.8,10.8,0],[106.802,10.8,1]]}]};

const nativeFetch=async input=>{
  const s=String(input);
  if(s.includes('route-video-library.json'))return new Response(JSON.stringify(manifest),{status:200});
  if(s.includes('low.json'))return new Response(JSON.stringify(low),{status:200});
  if(s.includes('high.json'))return new Response(JSON.stringify(high),{status:200});
  throw new Error('unexpected '+s);
};
const ctx={console,URL,URLSearchParams,Response,Promise,window:null,location:{href:'http://x/'},fetch:nativeFetch};
ctx.window=ctx;vm.createContext(ctx);vm.runInContext(source,ctx);

(async()=>{
  const response=await ctx.fetch('route-videos.json');
  const data=await response.json();
  assert.equal(data.routes.length,1);
  assert.equal(data.routes[0].name,'HIGH');
  assert.equal(data.routes[0].priority,200);
  console.log('PASS V28 source priority wins before duplicate filtering');
})().catch(err=>{console.error(err);process.exit(1)});
