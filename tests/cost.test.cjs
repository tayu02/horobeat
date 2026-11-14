// ホロビトを出すときのコストの支払い。エナが足りなければ使えない（依頼者の指示 2026-10-12）
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
  const lineBtns=()=>p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-mv="line"]')].map(b=>({t:b.textContent,dis:b.disabled})));
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

  // ---- 足りない: 使えない（ボタンを押せない） ----
  await setup({hand:['HD01-017'], ena:['HD01-001','HD01-001']});
  await open(await hand('HD01-017'));
  let lb=await lineBtns();
  ok(lb.length===5 && lb.every(x=>x.dis && x.t.includes('使えない')),'エナが足りない → ラインのボタンが5つとも「使えない」で押せない');
  ok(!(await p.evaluate(()=>document.getElementById('sheet').textContent)).includes('コストを払わずに'),'「コストを払わずに出す」の道はない');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  // 内部から呼んでも出さない
  await p.evaluate(u=>playFromHand(u,0,0),await hand('HD01-017')); await wait(100);
  s=await S();
  ok(s.players[0].hand.length===1 && s.players[0].line[0].length===0 && await turned()===0,'出す処理を直接呼んでも、手札に残りエナも変わらない');
  ok((await p.evaluate(()=>fxLines.join('/'))).includes('使えない：'),'記録に「使えない：…」と理由が出る');
  // ラインごとに必要なエナを示し、足りるラインだけ押せる
  await setup({hand:['HD01-012'], line:[['HB01-001'],['HD01-017']], ena:['HD01-001','HD01-001','HD01-001']});
  await open(await hand('HD01-012'));
  lb=await lineBtns();
  ok(!lb[0].dis && lb[0].t.includes('重ねる・エナ 3'),'第1ライン（雷獣 レオ 2 の上）: 「重ねる・エナ 3」で押せる');
  ok(lb[1].dis && lb.slice(2).every(x=>x.dis),'第2ライン（雷合 レオジン 7 の上）は重ねられず、空のライン（コスト5）はエナ3枚では使えない');
  await p.click('#sheet button[data-close="1"]'); await wait(100);

  // ---- オーバービート: 下のホロビトのコスト分だけ少なく ----
  await setup({hand:['HD01-012'], line:[['HB01-001']], ena:['HD01-001','HD01-001','HD01-001','HD01-001']});
  await toLine(await hand('HD01-012'),0);
  ok((await q()).includes('コスト 5 − 下の「雷獣 レオ」のコスト 2 ＝ 3'),'オーバービート：5 − 2 ＝ 3 を示す');
  await btn('支払って出す');
  s=await S();
  ok(s.players[0].line[0].length===2 && await turned()===3,'エナ3枚を使用済みにして重ねる');
  // コストが同じか大きいホロビトの上には重ねられない
  await setup({hand:['HD01-001'], line:[['HB01-001']], ena:['HD01-001','HD01-001']});
  await open(await hand('HD01-001'));
  lb=await lineBtns();
  ok(lb[0].dis && !lb[1].dis,'同じコスト（2）のホロビトの上（第1ライン）は押せない。空の第2ラインは押せる（手引書「コストが小さいホロビトの上」・よくある質問「同じコストにはできません」）');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  // どのラインのホロビトに重ねるかは自由に選べる。一番数字が小さいラインでなくてよい（公式「よくある質問」）
  await setup({hand:['HD01-012'], line:[['HB01-001'],['HD01-001'],['HB01-001']], ena:['HD01-001','HD01-001','HD01-001','HD01-001']});
  await open(await hand('HD01-012'));
  lb=await lineBtns();
  ok(!lb[0].dis && !lb[1].dis && !lb[2].dis,'コストが小さいホロビトが3つのラインにいれば、どのラインにも重ねられる（よくある質問）');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  await toLine(await hand('HD01-012'),2);
  await btn('支払って出す');
  s=await S();
  ok(s.players[0].line[2].length===2 && s.players[0].line[0].length===1 && s.players[0].line[1].length===1 && await turned()===3,'第3ラインのホロビトを選んで重ねられる（第1ラインでなくてよい）');

  // ---- 色（総合ルール 7.2.2.1）: 選んだエナかオーバービート元の色に、カードの色が含まれていればよい ----
  // 緑のカード（コスト2）を、緑1・赤2のエナで出す → 色の内訳が何通りかあるので、おすすめか自分で選ぶかを聞く
  await setup({hand:['HD02-001'], ena:['HD02-001','HD01-001','HD01-001']});
  await toLine(await hand('HD02-001'),0);
  ok((await q()).includes('7.2.2.1') && (await q()).includes('緑が含まれていれば'),'色の決まり（選んだエナに緑が含まれていればよい）を示す');
  ok(await p.evaluate(()=>[...document.querySelectorAll('#sheet button')].some(b=>b.textContent==='おすすめで支払う（緑1・赤1）')),'おすすめは「緑1・赤1」（緑を1枚含め、残りはほかの色から）');
  await btn('支払うエナを自分で選ぶ');
  let pk=await p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  ok(pk.length===3,'1枚目は、未使用のエナ3枚のどれでも選べる');
  s=await S();
  await p.evaluate(u=>{ const pk=picking; picking=null; render(); pk.pick(u); },s.players[0].ena[1].uid); await wait(80);
  pk=await p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  ok(pk.length===1 && pk[0]===s.players[0].ena[0].uid,'1枚目に赤を選ぶと、2枚目は緑だけが光る（赤2枚では緑が含まれない）');
  await p.evaluate(u=>{ const pk=picking; picking=null; render(); pk.pick(u); },s.players[0].ena[0].uid); await wait(80);
  s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].ena[0].turned && s.players[0].ena[1].turned && !s.players[0].ena[2].turned,'選んだ2枚（緑1・赤1）が使用済みになって出る');
  // 緑のカードを、赤のエナだけでは出せない
  await setup({hand:['HD02-001'], ena:['HD01-001','HD01-001','HD01-001']});
  await open(await hand('HD02-001'));
  lb=await lineBtns();
  ok(lb.every(b=>b.dis) && (await p.textContent('#sheet')).includes('7.2.2.1'),'緑のカードは、未使用のエナに緑がなければ出せない（理由に総合ルール 7.2.2.1）');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  ok((await p.evaluate(()=>!!document.querySelector('#side-0 .z-hand .card .cant'))),'手札にも「使えない」の帯');
  // オーバービート元が同じ色なら、エナは何色でもよい（場のつくものジャンボ（緑2）に、ケサランパサラン（緑3）を赤のエナ1枚で）
  await setup({hand:['HD02-010'], line:[['HD02-003']], ena:['HD01-001']});
  await toLine(await hand('HD02-010'),0);
  ok((await q()).includes('コスト 3 − 下の「つくものジャンボ」のコスト 2 ＝ 1') && (await q()).includes('赤1'),'オーバービート元が緑なので、赤のエナ1枚で払える（総合ルール 7.2.2.1）');
  await btn('支払って出す');
  s=await S();
  ok(s.players[0].line[0].length===2 && s.players[0].ena[0].turned,'赤のエナ1枚で、緑のホロビトに緑のホロビトを重ねる');
  // オーバービート元が違う色なら、エナに同じ色が要る（場の雷獣 レオ（赤2）に、ケサランパサラン（緑3）を赤のエナ1枚では重ねられない）
  await setup({hand:['HD02-010'], line:[['HB01-001']], ena:['HD01-001']});
  await open(await hand('HD02-010'));
  lb=await lineBtns();
  ok(lb[0].dis,'オーバービート元が赤で、エナに緑がなければ重ねられない');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  // 「このホロビトには、オーバービートできない」（シビレ提灯）: コストが足りていても重ねられない
  await setup({hand:['HD01-012'], line:[['HB01-011']], ena:['HD01-001','HD01-001','HD01-001','HD01-001','HD01-001']});
  await open(await hand('HD01-012'));
  lb=await lineBtns();
  ok(lb[0].dis && (await p.textContent('#sheet')).includes('オーバービートできません'),'シビレ提灯（コスト2）の上には、コスト5のホロビトでも重ねられない（印字の効果）');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  // 「このホロビトを手札から出すなら、オーバービートでは出せない」（カオナシライダー）
  await setup({hand:['HB01-022'], line:[['HD01-001']], ena:['HD01-001','HD01-001','HD01-001','HD01-001']});
  await open(await hand('HB01-022'));
  lb=await lineBtns();
  ok(lb[0].dis && (await p.textContent('#sheet')).includes('手札から出すならオーバービートでは出せません'),'カオナシライダー（コスト4）は、コスト2のホロビトの上にも重ねられない（印字の効果）');
  ok(!lb[1].dis,'同じカードを、空いている第2ラインには出せる');
  await p.click('#sheet button[data-close="1"]'); await wait(100);

  // 「隣のラインにパワー4000以上のホロビトがいないなら出せない」（ヨスズメ）
  await setup({hand:['HB01-021'], line:[['HD01-001']], ena:['HD01-001','HD01-001','HD01-001']});
  await open(await hand('HB01-021'));
  lb=await lineBtns();
  ok(lb[1].dis && (await p.textContent('#sheet')).includes('パワー 4000 以上のホロビトがいないと出せません'),'ヨスズメ: 隣（第1ライン）がレオまる 2000 だけなら、第2ラインに出せない');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  await setup({hand:['HB01-021'], line:[['HB01-001']], ena:['HD01-001','HD01-001','HD01-001']});
  await open(await hand('HB01-021'));
  lb=await lineBtns();
  ok(!lb[1].dis,'ヨスズメ: 隣（第1ライン）が雷獣 レオ 4000 なら、第2ラインに出せる');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  // 隣のパワーが印字だけでは決められないとき（パワーを変える効果を持つホロビトが隣にいる）は、判定できないと伝える
  await setup({hand:['HB01-021'], line:[['HD01-005']], ena:['HD01-001','HD01-001','HD01-001']});
  await open(await hand('HB01-021'));
  ok((await p.textContent('#sheet')).includes('判定できません'),'ヨスズメ: 隣にパワーを変える効果のホロビトがいると、出せるかを判定できないと伝える');
  await p.click('#sheet button[data-close="1"]'); await wait(100);

  // 「コストは1大きくなる」（しなずいさま）: ラインにいる間はコスト3として数える（総合ルール 6.2.5.5.1.1。印字の「コスト」はカードのコスト）
  await setup({hand:['HD02-004','HD02-005'], line:[['HD02-001']], ena:['HD02-001','HD02-001']});
  await open(await hand('HD02-004'));
  lb=await lineBtns();
  ok(lb[0].dis && (await p.textContent('#sheet')).includes('コスト 3'),'しなずいさま（印字2・ラインにいるので3）の上に、コスト3のホロビトは重ねられない');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  await toLine(await hand('HD02-005'),0);
  ok((await q()).includes('コスト 4 − 下の「しなずいさま」のコスト 3（印字 2。ラインに出ているので「コストは1大きくなる」） ＝ 1'),'コスト4のホロビトは重ねられ、支払うエナは 4 − 3 ＝ 1 枚');
  await btn('支払って出す');
  ok(await turned()===1,'エナ1枚を使用済みにして重ねる');

  // ---- 未確定カードはコストが分からないので聞かずに動かす ----
  await setup({hand:[{k:null}]});
  await toLine((await S()).players[0].hand[0].uid,0);
  ok((await S()).players[0].line[0].length===1 && await title()!=='コストの支払い','未確定カードはそのまま動く（コストが分からない）');

  // ---- ドラッグ ----
  if(!touch){
    const drag=async(uid,idx)=>{
      const src=p.locator(`.card[data-cid="${uid}"]`); await src.evaluate(e=>e.scrollIntoView({block:'center'}));
      const s1=await src.boundingBox(), d1=await p.locator(`#side-0 .lineslot[data-idx="${idx}"]`).boundingBox();
      await p.mouse.move(s1.x+s1.width/2,s1.y+s1.height/2); await p.mouse.down();
      await p.mouse.move(s1.x+s1.width/2,s1.y+s1.height/2-30,{steps:4});
      await p.mouse.move(d1.x+d1.width/2,d1.y+d1.height/2,{steps:8}); await p.mouse.up(); await wait(460); };
    await setup({hand:['HD01-017'], ena:['HD01-001','HD01-001']});
    await drag(await hand('HD01-017'),0);
    s=await S();
    ok(s.players[0].hand.length===1 && s.players[0].line[0].length===0 && (await p.evaluate(()=>fxLines.join('/'))).includes('使えない'),'エナが足りないカードはドラッグしてもラインに置けない（「使えない」と出る）');
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

  // ---- ワザ: 足りなければ使えない（バトルのワザの手番で、使う候補に出ない） ----
  await setup({hand:['PR-013'], line:[['HB01-001']], ena:['HD01-001']});
  await p.evaluate(()=>{ state.players[1].line[0].push({uid:'X1',owner:1,key:'HD01-001',up:true,turned:false,note:''});
    for(let i=0;i<5;i++) state.players[1].heart.push({uid:'XH'+i,owner:1,key:null,up:false,turned:false,note:''});
    state.phase=2; startBattle(); battleRun(); });
  await wait(460);
  ok(!(await q()).includes('電光攻火') && (await p.evaluate(()=>fxLines.join('/'))).includes('両者とも使えるものがない') && (await S()).players[0].hand.length===1,
    'ワザ: エナが足りなければ、バトルのワザの手番で使う候補に出ない（手札に残る）');
  await setup({hand:['PR-013'], line:[['HB01-001']], ena:['HD01-001']});
  await p.evaluate(u=>useWaza(u, state.players[0].line[0][0], function(){}),await hand('PR-013')); await wait(100);
  ok((await S()).players[0].hand.length===1 && !(await p.evaluate(()=>!!picking)) && (await p.evaluate(()=>fxLines.join('/'))).includes('使えない：'),'ワザ: 使う処理を直接呼んでも使えず、手札に残る');

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
