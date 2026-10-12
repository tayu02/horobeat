// ホロビトを出すときのコストの支払いと「使えない」の表示（依頼者の指示 2026-10-12）
// 確定（手引書 メインステップ）: 必要なエナを支払い（使用済みにし）、ホロビトをラインに出す。
//   新しいライン＝コスト分。オーバービート＝コストが小さいホロビトの上に、下のコスト分少なく
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const setup=async(me)=>{
    await p.evaluate((me)=>{
      let n=0; const mk=(k,o,ex)=>Object.assign({uid:'C'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
      const P=(spec,o)=>{ const pl={heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}};
        for(let i=0;i<10;i++) pl.deck.push(mk(null,o,{up:false}));
        for(const z of ['hand','ena']) (spec[z]||[]).forEach(k=>pl[z].push(typeof k==='string'?mk(k,o):mk(k.k,o,k)));
        (spec.line||[]).forEach((st,i)=>st.forEach(k=>pl.line[i].push(typeof k==='string'?mk(k,o):mk(k.k,o,k))));
        return pl; };
      state={round:1,phase:0,first:0,fxAuto:true,players:[P(me,0),P({},1)]};
      undoStack=[]; picking=null; fxAsk=null; fxClear(); closeSheet();
      document.querySelectorAll('details.doc').forEach(d=>d.open=false); render();
    },me);
  };
  const hand=async key=>(await S()).players[0].hand.find(c=>c.key===key).uid;
  const cant=async key=>p.evaluate(k=>{ const c=state.players[0].hand.find(x=>x.key===k); const e=document.querySelector('#side-0 .z-hand .card[data-cid="'+c.uid+'"] .cant'); return e?e.textContent:''; },key);
  const open=async uid=>{ await p.evaluate(u=>openCardSheet(u),uid); await wait(460); };
  const toLine=async(uid,idx)=>{ await open(uid); await p.click(`#sheet button[data-mv="line"][data-idx="${idx}"]`); await wait(460); };
  const q=()=>p.evaluate(()=>document.querySelector('#sheet .fxq')?.textContent||'');
  const title=()=>p.evaluate(()=>document.querySelector('#sheet h3')?.textContent||'');
  const btn=async text=>{ await p.locator('#sheet button',{hasText:text}).first().click(); await wait(150); };
  const turned=async()=>(await S()).players[0].ena.filter(c=>c.turned).length;

  // ---- 手札の「使えない」 ----
  await setup({hand:['HD01-001','HD01-017','PR-013','HD01-012'], ena:['HD01-001','HD01-001']});
  ok(await cant('HD01-001')==='','レオまる（コスト2）・未使用のエナ2枚 → 「使えない」は出ない');
  ok(await cant('HD01-017')==='使えない','雷合 レオジン（コスト7）・未使用のエナ2枚 → 「使えない」');
  ok(await cant('PR-013')==='','ワザ 電光攻火（コスト2）・エナ2枚 → 出ない');
  ok(await cant('HD01-012')==='使えない','鼠合 キュウジロウ（コスト5）・ラインが空・エナ2枚 → 「使えない」');
  await open(await hand('HD01-017'));
  ok((await p.evaluate(()=>document.querySelector('#sheet .costnote.no')?.textContent||'')).includes('使えない：'),'メニューにも「使えない：…」と理由が出る');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  // オーバービートなら安く出せる → 「使えない」にしない
  await setup({hand:['HD01-012'], line:[['HB01-001']], ena:['HD01-001','HD01-001','HD01-001']});
  ok(await cant('HD01-012')==='','キュウジロウ（5）を雷獣 レオ（2）にオーバービートすれば3 → エナ3枚なら「使えない」は出ない');
  await setup({hand:['PR-013'], ena:['HD01-001',{k:'HD01-001',turned:true}]});
  ok(await cant('PR-013')==='使えない','ワザも、未使用のエナが足りなければ「使えない」（使用済みのエナは数えない）');

  // ---- 新しいラインに出す: コスト分のエナを使用済みに ----
  await setup({hand:['HB01-001'], ena:['HD01-001','HD01-001','HD01-001']});
  await toLine(await hand('HB01-001'),0);
  ok(await title()==='コストの支払い' && (await q()).includes('新しいラインに出す：コスト 2'),'出すとコストの支払いを聞く（新しいライン：コスト2）');
  await btn('支払って出す');
  let s=await S();
  ok(s.players[0].line[0].length===1 && await turned()===2,'支払う → ラインに出て、エナが2枚使用済み（横向き）になる');
  ok((await p.evaluate(()=>fxLines.join('/'))).includes('使用済みにした'),'記録に支払いが出る');
  await p.click('#btnUndo'); await wait(80);
  s=await S();
  ok(s.players[0].hand.length===1 && await turned()===0,'「戻す」で支払いごと取り消せる');

  // ---- 足りない: 「使えない」 ----
  await setup({hand:['HD01-017'], ena:['HD01-001','HD01-001']});
  await toLine(await hand('HD01-017'),0);
  ok((await q()).startsWith('使えない：') && (await q()).includes('未使用のエナが 2 枚'),'エナが足りない → 「使えない：…未使用のエナが 2 枚しかありません」');
  await btn('やめる');
  s=await S();
  ok(s.players[0].hand.length===1 && s.players[0].line[0].length===0 && await turned()===0,'「やめる」→ 手札に残り、エナも変わらない');
  // トリガー・効果で出すときのために、払わずに出すこともできる
  await toLine(await hand('HD01-017'),0);
  await btn('コストを払わずに出す');
  s=await S();
  ok(s.players[0].line[0].length===1 && await turned()===0,'「コストを払わずに出す」→ エナを使わずに出る');

  // ---- オーバービート: 下のホロビトのコスト分だけ少なく ----
  await setup({hand:['HD01-012'], line:[['HB01-001']], ena:['HD01-001','HD01-001','HD01-001','HD01-001']});
  await toLine(await hand('HD01-012'),0);
  ok((await q()).includes('コスト 5 − 下の「雷獣 レオ」のコスト 2 ＝ 3'),'オーバービート：5 − 2 ＝ 3 を示す');
  await btn('支払って出す');
  s=await S();
  ok(s.players[0].line[0].length===2 && await turned()===3,'エナ3枚を使用済みにして重ねる');
  // コストが同じか大きいホロビトの上には重ねられない
  await setup({hand:['HD01-001'], line:[['HB01-001']], ena:['HD01-001','HD01-001']});
  await toLine(await hand('HD01-001'),0);
  ok((await q()).includes('使えない：オーバービートできるのは、コストが小さいホロビトの上だけ'),'同じコスト（2）の上には「使えない」（手引書「コストが小さいホロビトの上」）');
  await btn('やめる');
  ok((await S()).players[0].line[0].length===1,'やめる → 重ならない');

  // ---- 色: 同じ色が足りなければ、払うエナを選ぶ ----
  await setup({hand:['HD02-001'], ena:['HD02-001','HD01-001','HD01-001']});
  await toLine(await hand('HD02-001'),0);
  ok((await q()).includes('何枚が緑である必要があるかは未確定'),'緑のカードで緑のエナが1枚 → 色の決まりは未確定と示す');
  await btn('支払うエナを選ぶ');
  let pk=await p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  ok(pk.length===3,'未使用のエナ3枚が光る');
  s=await S();
  await p.evaluate(u=>{ const pk=picking; picking=null; render(); pk.pick(u); },s.players[0].ena[0].uid); await wait(80);
  await p.evaluate(u=>{ const pk=picking; picking=null; render(); pk.pick(u); },s.players[0].ena[2].uid); await wait(80);
  s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].ena[0].turned && !s.players[0].ena[1].turned && s.players[0].ena[2].turned,'選んだ2枚が使用済みになって出る');

  // ---- 未確定カードはコストが分からないので聞かずに動かす ----
  await setup({hand:[{k:null}]});
  await toLine((await S()).players[0].hand[0].uid,0);
  ok((await S()).players[0].line[0].length===1 && await title()!=='コストの支払い','未確定カードはそのまま動く（コストが分からない）');

  // ---- ドラッグで出しても支払いを聞く ----
  if(!touch){
    await setup({hand:['HB01-001'], ena:['HD01-001','HD01-001']});
    const uid=await hand('HB01-001');
    const src=p.locator(`.card[data-cid="${uid}"]`); await src.evaluate(e=>e.scrollIntoView({block:'center'}));
    const s1=await src.boundingBox(), d1=await p.locator('#side-0 .lineslot[data-idx="0"]').boundingBox();
    await p.mouse.move(s1.x+s1.width/2,s1.y+s1.height/2); await p.mouse.down();
    await p.mouse.move(s1.x+s1.width/2,s1.y+s1.height/2-30,{steps:4});
    await p.mouse.move(d1.x+d1.width/2,d1.y+d1.height/2,{steps:8}); await p.mouse.up(); await wait(460);
    ok(await title()==='コストの支払い','ドラッグでラインに出しても支払いを聞く');
    await btn('支払って出す');
    ok((await S()).players[0].line[0].length===1 && await turned()===2,'ドラッグ → 支払ってラインに出る');
  }

  // ---- ワザ: 足りなければ「使えない」 ----
  await setup({hand:['PR-013'], line:[['HB01-001']], ena:['HD01-001']});
  await open(await hand('PR-013')); await p.click('#sheet button[data-wzuse]'); await wait(150);
  await p.evaluate(u=>{ const pk=picking; picking=null; render(); pk.pick(u); },(await S()).players[0].line[0][0].uid); await wait(460);
  ok((await q()).startsWith('使えない：コスト 2'),'ワザ: エナが足りなければ「使えない：…」');

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
