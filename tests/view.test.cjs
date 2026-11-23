// 画面の見やすさ（依頼者の指示 2026-11-23）
// 1. 「🌐 対戦」は「🎮 試遊」の横のタブ
// 2. スマホで、下に出るログが自分の手札を隠さない（ログの高さの分だけページの下に余白を足す）
// 2b. ログはどこをタップしても消える／2c. カードの詳細は画像をタップすると閉じる
// 3. バトル中は、パワーの内訳（印字・効果・ワザ・ブースト）と合計、印字からの増減をいつも出す
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
  const setup=async(me,opp)=>{
    await p.evaluate(([me,opp])=>{
      let n=0; const mk=(k,o,ex)=>Object.assign({uid:'V'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
      const P=(spec,o)=>{ const pl={heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}};
        for(let i=0;i<10;i++) pl.deck.push(mk(null,o,{up:false}));
        for(const z of ['hand','ena','grave','heart','waza']) (spec[z]||[]).forEach(k=>pl[z].push(typeof k==='string'?mk(k,o):mk(k.k,o,k)));
        (spec.line||[]).forEach((st,i)=>st.forEach(k=>pl.line[i].push(typeof k==='string'?mk(k,o):mk(k.k,o,k))));
        return pl; };
      state={round:1,phase:1,first:0,fxAuto:true,players:[P(me,0),P(opp,1)]};
      undoStack=[]; picking=null; fxAsk=null; fxClear(); closeSheet(); render();
    },[me,opp]);
  };
  const H5=['HD01-001','HD01-001','HD01-001','HD01-001','HD01-001'].map(k=>({k,up:false}));
  const head=()=>p.evaluate(()=>[...document.querySelectorAll('#sheet .fxcards .fxcard')].map(e=>e.textContent));
  const choose=async t=>{ await wait(460); await p.locator('#sheet button[data-fxa]',{hasText:t}).first().click(); await wait(200); };
  const cpow=uid=>p.evaluate(u=>{ const e=document.querySelector('.card[data-cid="'+u+'"] .cpow'); return e ? {t:e.textContent, cls:e.className} : null; },uid);

  // ---- 1. 「🌐 対戦」のタブ ----
  ok(await p.evaluate(()=>{ const t=[...document.querySelectorAll('.navrow button.navbtn')].map(b=>b.id||b.dataset.view); return t.indexOf('btnOnline')===t.indexOf('play')+1; }),
     '「🌐 対戦」は上部のタブの並びで、「🎮 試遊」のすぐ右にある');
  ok(!(await p.$('.hrow.playonly #btnOnline')),'2段目（試遊の操作の段）には「🌐 対戦」を置かない');
  await p.click('.navbtn[data-view="deck"]'); await wait(80);
  await p.click('#btnOnline'); await wait(450);
  ok(await p.evaluate(()=>ui.view)==='play' && (await p.textContent('#sheet')).includes('オンライン対戦'),'「📋 デッキ」の画面から押しても、試遊の画面に切り替わって対戦の画面が開く（この試験の画面ではつなげないので、その旨が出る）');
  ok(await p.evaluate(()=>!document.getElementById('btnOnline').classList.contains('on')),'対戦のタブは、試遊のタブの「選択中」の色と取り違えない');
  await p.click('#sheet button[data-close="1"]'); await wait(80);

  // ---- 2. ログが手札を隠さない ----
  await p.evaluate(()=>{ runAction('reset',2); render(); });
  await H.prep(p);   // 配って両者「このまま」。ログに準備の流れが出る
  ok(await p.evaluate(()=>document.getElementById('fxlog').classList.contains('on')),'配るとログが出る');
  await p.evaluate(()=>document.querySelector('#side-0 .z-hand').scrollIntoView({block:'end'})); await wait(200);
  const r=await p.evaluate(()=>({hand:document.querySelector('#side-0 .z-hand').getBoundingClientRect().bottom, log:document.getElementById('fxlog').getBoundingClientRect().top}));
  ok(r.hand<=r.log+1,'自分の手札を画面の下端に合わせても、ログの上に出る（手札 '+Math.round(r.hand)+' ≦ ログ '+Math.round(r.log)+'）');
  await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight)); await wait(200);
  const r2=await p.evaluate(()=>({hand:document.querySelector('#side-0 .z-hand').getBoundingClientRect().bottom, log:document.getElementById('fxlog').getBoundingClientRect().top}));
  ok(r2.hand<=r2.log+1,'一番下まで動かしても、手札はログに隠れない');
  await p.click('#fxlog button[data-fxlog="close"]'); await wait(80);
  ok(await p.evaluate(()=>document.body.style.paddingBottom==='' && document.documentElement.style.scrollPaddingBottom===''),'ログを閉じると、足した余白はなくなる');

  // ---- 2b. ログは、どこをタップしても消える。「戻す」は戻す（依頼者の指示 2026-11-23）----
  await p.evaluate(()=>{ fxLines=['試しの行1','試しの行2']; fxShowLog(); });
  ok(await p.evaluate(()=>document.getElementById('fxlog').classList.contains('on')),'ログが出ている');
  await p.locator('#fxlog .fxlines div',{hasText:'試しの行2'}).click(); await wait(80);
  ok(await p.evaluate(()=>!document.getElementById('fxlog').classList.contains('on')),'ログの行をタップするとログが消える');
  ok(await p.evaluate(()=>document.body.style.paddingBottom===''),'タップで消したときも、足した余白はなくなる');
  const hand1=(await S()).players[0].hand.length;
  await p.evaluate(()=>{ snap(); runAction('draw1',0); render(); });
  ok((await S()).players[0].hand.length===hand1+1,'（準備）1枚引く');
  await p.evaluate(()=>{ fxLines=['引いた']; fxShowLog(); });
  const undoBtn=await p.$('#fxlog button[data-fxlog="undo"]');
  if (undoBtn){
    await undoBtn.click(); await wait(120);
    ok((await S()).players[0].hand.length===hand1 && await p.evaluate(()=>!document.getElementById('fxlog').classList.contains('on')),'ログの「戻す」は、これまでどおり1手戻してログを消す');
  } else ok(false,'ログに「戻す」がない');

  // ---- 2c. カードの詳細は、カードの画像をタップすると閉じる（依頼者の指示 2026-11-23）----
  await setup({line:[['HB01-001']], heart:H5},{heart:H5});
  const cu=(await S()).players[0].line[0][0].uid;
  await p.evaluate(u=>openCardSheet(u,0),cu); await wait(500);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on') && !!document.querySelector('#sheet .cimgwrap')),'盤面のカードの詳細に画像が出る');
  await p.click('#sheet .cimgwrap'); await wait(120);
  ok(await p.evaluate(()=>!document.getElementById('sheetwrap').classList.contains('on')),'画像をタップすると、カードの詳細が閉じる');
  ok(await p.evaluate(u=>state.players[0].line[0][0].uid===u,cu),'閉じるだけで、カードは動かない');
  // 開いた直後の誤タップでは閉じない（他のボタンと同じ 400ms の守り）
  await p.evaluate(u=>openCardSheet(u,0),cu); await wait(30);
  await p.evaluate(()=>document.querySelector('#sheet .cimgwrap').click()); await wait(50);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on')),'開いた直後（0.4秒以内）のタップでは閉じない');
  await wait(450); await p.click('#sheet .cimgwrap'); await wait(120);
  // カードの一覧の詳細も同じ
  await p.click('.navbtn[data-view="cards"]'); await wait(80);
  await p.evaluate(()=>openCatalogSheet('HB01-002')); await wait(500);
  ok(await p.evaluate(()=>!!document.querySelector('#sheet .cimgwrap')),'カードの一覧の詳細にも画像が出る');
  await p.click('#sheet .cimgwrap'); await wait(120);
  ok(await p.evaluate(()=>!document.getElementById('sheetwrap').classList.contains('on')),'カードの一覧の詳細も、画像をタップすると閉じる');
  await p.click('.navbtn[data-view="play"]'); await wait(80);

  // ---- 3. バトル中のパワーの内訳 ----
  // 学合 フラリンテ(HD02-012): このホロビトにブーストを使っているなら +2000。ケサランパサラン(HD02-010) をブーストで使う
  await setup({hand:['HD02-010'], line:[['HD02-012']], ena:['HD02-001'], heart:H5},{hand:['PR-013'], ena:['HD01-001','HD01-001'], line:[['HB01-033']], heart:H5});
  await p.click('#btnPhase'); await wait(500);
  let hd=await head(), s=await S();
  ok(hd[0].includes('印字 6000') && hd[0].includes('パワー 6000') && hd[1].includes('印字 7000') && hd[1].includes('パワー 7000'),'ワザ・ブーストを使う前から、両者の印字のパワーと合計を出す '+JSON.stringify(hd));
  await choose('ブーストで使う'); await wait(200);
  hd=await head();
  ok(hd[0].includes('ブースト「ケサランパサラン」+2000') && hd[0].includes('効果 +2000') && hd[0].includes('パワー 10000') && hd[0].includes('（+4000）'),
     'ブーストを使うと、ブーストの分と効果の分を1つずつ足して出し、合計と印字からの増減（+4000）を出す '+JSON.stringify(hd[0]));
  ok(await p.evaluate(()=>[...document.querySelectorAll('#sheet .fxcard')][0].querySelectorAll('.pwr.up').length)===2,'足す分は緑（＋）で出す');
  const me=s.players[0].line[0][0].uid, op=s.players[1].line[0][0].uid;
  let cp=await cpow(me);
  ok(cp && cp.t==='10000' && cp.cls.includes('up'),'盤面でも、バトル中のホロビトのパワーをいまの合計（10000）にして、上がっていれば緑で出す '+JSON.stringify(cp));
  cp=await cpow(op);
  ok(cp && cp.t==='7000' && !cp.cls.includes('up') && !cp.cls.includes('dn'),'変わっていない側は、そのままの色で出す '+JSON.stringify(cp));
  await choose('パス'); await wait(400);
  hd=await head();
  ok((await p.textContent('#sheet h3')).includes('結果') && hd[0].includes('パワー 10000') && hd[0].includes('勝ち'),'結果の画面でも内訳と合計を出す');
  ok(await p.evaluate(()=>{ const t=fxLines.join(' / '); return t.includes('自分 10000') && t.includes('相手 7000'); }),'内訳の合計は、パワーを比べた値と同じ');

  // 判定できない条件は「？」にして合計に入れず、答えたら足す（臨戦！ レオ HD01-015: 自分のホロビトが4体以上なら +4000。未確定カードがいると数が決まらない）
  await setup({line:[['HD01-015'],['HB01-001'],['HB01-001'],[{k:null}]], heart:H5},{line:[['HB01-033']], heart:H5});
  await p.click('#btnPhase'); await wait(500);
  hd=await head();
  ok(hd[0].includes('？（条件しだい）') && hd[0].includes('パワー 6000＋？'),'条件が判定できない効果は「？」として出し、合計には入れない '+JSON.stringify(hd[0]));
  s=await S();
  cp=await cpow(s.players[0].line[0][0].uid);
  ok(cp && cp.t==='6000?','盤面のパワーにも「?」を付ける '+JSON.stringify(cp));
  await choose('満たしている'); await wait(400);
  hd=await head();
  ok(hd[0].includes('パワー 10000') && hd[0].includes('（+4000）'),'「満たしている」と答えたら、その分を足して出す '+JSON.stringify(hd[0]));
  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
