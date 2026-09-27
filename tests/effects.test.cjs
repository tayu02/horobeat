// 効果の自動処理
const H = require('./harness.cjs');
const { chromium, devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const tapCard=async uid=>{ const el=p.locator(`.card[data-cid="${uid}"]`); await el.scrollIntoViewIfNeeded(); if(touch) await el.tap(); else await el.click(); await wait(450); };
  const clickSheet=async sel=>{ await wait(450); await p.click('#sheet '+sel); await wait(80); };  // シートの誤タップ防止(400ms)を待つ
  const log=()=>p.evaluate(()=>fxLines.join(' / '));
  // 盤面を組む。cards: {zone:[key...]} を陣地ごとに。deck は未確定カード
  const setup=async(me,opp)=>{
    await p.evaluate(([me,opp])=>{
      let n=0; const mk=(k,o,extra)=>Object.assign({uid:'T'+(n++),owner:o,key:k,up:true,turned:false,note:''},extra||{});
      const P=(spec,o)=>{ const pl={heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}};
        for(let i=0;i<10;i++) pl.deck.push(mk(null,o,{up:false}));
        for(const z of ['hand','ena','grave','heart','waza']) (spec[z]||[]).forEach(k=>pl[z].push(typeof k==='string'?mk(k,o):mk(k.k,o,k)));
        (spec.line||[]).forEach((st,i)=>st.forEach(k=>pl.line[i].push(typeof k==='string'?mk(k,o):mk(k.k,o,k))));
        return pl; };
      state={round:1,phase:0,first:0,fxAuto:true,players:[P(me,0),P(opp,1)]};
      undoStack=[]; picking=null; fxAsk=null; fxClear(); closeSheet(); render();
    },[me,opp]);
  };
  const uidOf=(s,pi,zone,key,li)=>{ const P=s.players[pi]; const arr= zone==='line'? P.line[li] : P[zone]; return arr.find(c=>c.key===key).uid; };
  const moveTo=async(uid,zone,idx)=>{ await p.evaluate(u=>openCardSheet(u),uid); await wait(450);
    await clickSheet(`button[data-mv="${zone}"]`+(idx!==undefined?`[data-idx="${idx}"]`:'')); await wait(100); };

  // 1. 出たとき、カードを1枚引く
  await setup({hand:['HD01-001']},{});
  let s=await S(); await moveTo(uidOf(s,0,'hand','HD01-001'),'line',0);
  s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].hand.length===1 && s.players[0].deck.length===9,'HD01-001: ラインに出す → 1枚引く（手札1・山札9）');
  ok((await log()).includes('1枚引いた'),'処理の記録が出る');

  // 2. 戻すで効果だけ取り消す
  await p.click('#fxlog button[data-fxlog="undo"]'); await wait(80);
  s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].hand.length===0 && s.players[0].deck.length===10,'「戻す」で引いた分だけ取り消され、ラインのカードは残る');

  // 3. 出たとき、下にカードがないなら → 空のラインでは引く／束の上では引かない
  await setup({hand:['HD01-010','HD01-010'], line:[['HB01-001']]},{});
  s=await S(); await moveTo(s.players[0].hand[0].uid,'line',1);
  s=await S(); ok(s.players[0].deck.length===9,'HD01-010: 空のラインに出す → 下にカードがないので引く');
  await moveTo(s.players[0].hand.find(c=>c.key==='HD01-010').uid,'line',0);
  s=await S(); ok(s.players[0].deck.length===9 && s.players[0].line[0].length===2,'HD01-010: 束の上に出す → 下にカードがあるので引かない');
  ok((await log()).includes('満たさない'),'満たさない理由が記録される');

  // 4. オーバービートされるとき、ダウンしているなら（下になる側）
  await setup({hand:['HB01-001','HB01-001'], line:[[{k:'HD02-009',turned:true}],[{k:'HD02-009',turned:false}]]},{});
  s=await S(); await moveTo(s.players[0].hand[0].uid,'line',0);
  s=await S(); ok(s.players[0].deck.length===9,'HD02-009: ダウン中にオーバービートされる → 1枚引く');
  await moveTo(s.players[0].hand.find(c=>c.key==='HB01-001').uid,'line',1);
  s=await S(); ok(s.players[0].deck.length===9,'HD02-009: ダウンしていなければ引かない');

  // 5. 同時に2つ → 順番を選ばせる
  await setup({hand:['HD01-001'], line:[[{k:'HD02-009',turned:true}]]},{});
  s=await S(); await moveTo(s.players[0].hand[0].uid,'line',0);
  const choose=await p.evaluate(()=>document.querySelectorAll('#sheet button[data-fxa]').length);
  ok(choose===3 && (await p.evaluate(()=>document.querySelector('#sheet .fxq').textContent)).includes('順番は未確定'),'同時に2つ発動 → 順番を選ぶ画面（2択＋中断）');
  await clickSheet('button[data-fxa="1"]'); await wait(100);
  s=await S(); ok(s.players[0].deck.length===8,'順番を選ぶと、残りも続けて処理され合計2枚引く');

  // 6. 常時の効果の印: 第2〜5ラインにいるなら +2500
  await setup({line:[['HD01-005']]},{});
  let badge=await p.evaluate(()=>document.querySelector('#side-0 .fxb')?.textContent||'');
  ok(badge==='','HD01-005: 第1ラインでは +2500 の印が出ない');
  s=await S(); await p.evaluate(u=>{ const f=findCard(u); f.list.splice(f.idx,1); state.players[0].line[2].push(f.card); render(); }, s.players[0].line[0][0].uid);
  badge=await p.evaluate(()=>document.querySelector('#side-0 .fxb')?.textContent||'');
  ok(badge.includes('+2500'),'HD01-005: 第3ラインに移すと +2500 の印が出る');

  // 7. 自分の赤のホロビトが4体以上 → 束の数え方で割れないとき確定
  await setup({line:[['HB01-033'],['HB01-001'],['HD01-001'],['HD01-003']]},{});
  badge=await p.evaluate(()=>[...document.querySelectorAll('#side-0 .fxb span')].map(x=>x.textContent+':'+x.className).join(','));
  ok(badge.includes('+5000:on') && badge.includes('ダブルダメージ:on'),'HB01-033: 赤4体 → +5000 が確定で有効、ダブルダメージも表示');
  // 束の下も数えるかで割れる → ?
  await setup({line:[['HB01-033'],['HB01-001','HD01-001'],['HD01-003']]},{});
  badge=await p.evaluate(()=>[...document.querySelectorAll('#side-0 .fxb span')].map(x=>x.textContent).join(','));
  ok(badge.includes('+5000?'),'HB01-033: 束の一番上だけなら3体・下も含めると4体 → 未確定の「?」');

  // 8. エナ詠み③: 緑のエナの枚数
  await setup({line:[['HB01-063']], ena:['HD02-001','HD02-002']},{});
  badge=await p.evaluate(()=>document.querySelector('#side-0 .fxb')?.textContent||'');
  ok(badge==='','HB01-063: 緑のエナ2枚 → エナ詠みは無効（印を出さない）');
  await setup({line:[['HB01-063']], ena:['HD02-001','HD02-002','HD02-003']},{});
  badge=await p.evaluate(()=>[...document.querySelectorAll('#side-0 .fxb span')].map(x=>x.textContent+':'+x.className).join(','));
  ok(badge==='エナ詠み③:on','HB01-063: 緑のエナ3枚 → エナ詠み③ 有効');

  // 9. バトルが終わったとき（ボタン）→ 赤のエナを選ぶ → 未使用に。回復は手で
  await setup({line:[['HB01-031']], ena:[{k:'HB01-001',turned:true},{k:'HD02-001',turned:true}]},{});
  s=await S(); await p.evaluate(u=>openCardSheet(u),s.players[0].line[0][0].uid); await wait(450);
  ok(await p.evaluate(()=>!!document.querySelector('#sheet .fxbtn')),'HB01-031 のメニューに「バトルが終わったとき の効果を処理する」ボタン');
  await clickSheet('.fxbtn'); await wait(150);
  const pk=await p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  s=await S();
  ok(pk.length===1 && pk[0]===s.players[0].ena[0].uid,'候補として光るのは赤のエナだけ（緑は光らない）');
  ok(await p.evaluate(()=>document.getElementById('pickbar').classList.contains('on')),'画面上部に「選んでください」の案内が出る');
  await tapCard(pk[0]);
  s=await S();
  ok(s.players[0].ena[0].turned===false && s.players[0].ena[1].turned===true,'選んだ赤のエナが未使用（縦向き）になる。緑はそのまま');
  ok((await log()).includes('回復する」は定義が未確定'),'「回復する」は処理せず、手で処理するよう案内');

  // 10. 2つ目のワザを使ったとき → 正面を選ばせる → コストを聞く → 一番上を手札に戻す
  await setup({line:[['HB01-097']]},{line:[['HB01-001','HD01-001'],['HB01-033']]});
  s=await S(); await p.evaluate(u=>openCardSheet(u),s.players[0].line[0][0].uid); await wait(450);
  await clickSheet('.fxbtn'); await wait(150);
  const fronts=await p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  s=await S();
  ok(fronts.length===2 && fronts.includes(s.players[1].line[0][1].uid),'正面の候補は相手の各ラインの一番上（シミュレーターは正面を決めない）');
  await tapCard(s.players[1].line[0][1].uid); await wait(100);
  const q=await p.evaluate(()=>document.querySelector('#sheet .fxq')?.textContent||'');
  ok(q.includes('印字のコストは 2') && q.includes('8以下'),'印字のコストを示して「8以下として扱うか」を聞く');
  await clickSheet('button[data-fxa="0"]'); await wait(100);
  s=await S();
  ok(s.players[1].line[0].length===1 && s.players[1].hand.some(c=>c.key==='HD01-001'),'はい → 正面の一番上（HD01-001）が相手の手札に戻る。下のカードは残る');

  // 11. バトルに勝ったとき → パワー比を聞く → 正面を選ぶ → 束なら扱いを聞く → 墓地
  await setup({line:[['HB01-065']]},{line:[['HD01-001']]});
  s=await S(); await p.evaluate(u=>openCardSheet(u),s.players[0].line[0][0].uid); await wait(450);
  await clickSheet('.fxbtn'); await wait(100);
  ok((await p.evaluate(()=>document.querySelector('#sheet .fxq').textContent)).includes('2倍以上'),'HB01-065: パワー比は計算せずに聞く');
  await clickSheet('button[data-fxa="0"]'); await wait(150);
  s=await S(); await tapCard(s.players[1].line[0][0].uid); await wait(100);
  s=await S();
  ok(s.players[1].line[0].length===0 && s.players[1].grave.some(c=>c.key==='HD01-001'),'正面を選ぶと破壊され、相手の墓地へ');

  // 11b. 正面が束のとき、下のカードの扱いは決めずに聞く
  await setup({line:[['HB01-065']]},{line:[['HB01-001','HD01-001']]});
  s=await S(); await p.evaluate(u=>openCardSheet(u),s.players[0].line[0][0].uid); await wait(450);
  await clickSheet('.fxbtn'); await wait(100); await clickSheet('button[data-fxa="0"]'); await wait(150);
  s=await S(); await tapCard(s.players[1].line[0][1].uid); await wait(100);
  const opts=await p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-fxa]')].map(b=>b.textContent));
  ok(opts.includes('一番上だけ墓地へ') && opts.includes('束ごと墓地へ') && opts.some(t=>t.includes('手で')),'正面が束 → 下のカードをどうするかを聞く（決めない）');
  await clickSheet('button[data-fxa="0"]'); await wait(100);
  s=await S();
  ok(s.players[1].line[0].length===1 && s.players[1].line[0][0].key==='HB01-001' && s.players[1].grave.length===1,'「一番上だけ」→ 上の1枚だけ墓地、下は残る');

  // 12. エナ詠み③ の下の効果: 勝ったとき、第1〜2ラインなら、相手が手札を選んで捨てる
  await setup({line:[['HB01-063']], ena:['HD02-001','HD02-002','HD02-003']},{hand:['HB01-001','HD01-005']});
  s=await S(); await p.evaluate(u=>openCardSheet(u),s.players[0].line[0][0].uid); await wait(450);
  await clickSheet('.fxbtn'); await wait(150);
  const hc=await p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].length);
  ok(hc===2,'相手の手札2枚が候補として光る');
  s=await S(); await tapCard(s.players[1].hand[1].uid); await wait(100);
  ok(await p.evaluate(()=>document.getElementById('sheetwrap').classList.contains('on') && document.querySelector('#sheet h3').textContent.includes('疾風のカマイチ')),'選んだカードのメニューが開き、置き場所は手で選ぶ（捨てる先は未確定）');

  // 13. エナ詠みの条件を満たさないとき
  await setup({line:[['HB01-063']], ena:['HD02-001']},{hand:['HB01-001']});
  s=await S(); await p.evaluate(u=>openCardSheet(u),s.players[0].line[0][0].uid); await wait(450);
  await clickSheet('.fxbtn'); await wait(100);
  ok((await log()).includes('条件を満たしていない') && !(await p.evaluate(()=>!!picking)),'緑のエナ1枚 → エナ詠みの条件を満たさず、相手の手札は選ばせない');

  // 13b. エナ詠みの下の常時効果: ダウンしていないなら +3000（HD01-011）
  await setup({line:[['HD01-011']], ena:['HB01-001','HD01-001','HD01-003']},{});
  badge=await p.evaluate(()=>[...document.querySelectorAll('#side-0 .fxb span')].map(x=>x.textContent).join(','));
  ok(badge==='エナ詠み③,+3000','HD01-011: 赤のエナ3枚・縦向き → エナ詠み③ と +3000');
  s=await S(); await p.evaluate(u=>{ findCard(u).card.turned=true; render(); }, s.players[0].line[0][0].uid);
  badge=await p.evaluate(()=>[...document.querySelectorAll('#side-0 .fxb span')].map(x=>x.textContent).join(','));
  ok(badge==='エナ詠み③','HD01-011: ダウンすると +3000 が消える（エナ詠み③ は残る）');
  await setup({line:[['HD01-011']], ena:['HB01-001','HD02-001','HD02-002']},{});
  badge=await p.evaluate(()=>document.querySelector('#side-0 .fxb')?.textContent||'');
  ok(badge==='','HD01-011: 赤のエナ1枚 → エナ詠みも +3000 も出ない');

  // 13c. 「〜てもよい。そうしたなら、〜」（HD02-011）
  await setup({hand:['HD02-011','HB01-061','HD02-001'], ena:['HD02-001','HD02-002','HD02-003']},{});
  s=await S(); await moveTo(uidOf(s,0,'hand','HD02-011'),'line',0);
  const rv=await p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>findCard(e.dataset.cid).card.key));
  ok(rv.length===1 && rv[0]==='HB01-061','HD02-011: 見せる候補はコスト7以上のホロビトだけ（コスト10の巨ダマ。コスト2は光らない）');
  ok(await p.evaluate(()=>document.getElementById('pickCancel').textContent)==='見せない','任意なので「やめる」ではなく「見せない」ボタン');
  s=await S(); await tapCard(uidOf(s,0,'hand','HB01-061'));
  s=await S();
  ok(s.players[0].deck.length===9 && s.players[0].hand.some(c=>c.key==='HB01-061'),'見せる → 1枚引く。見せたカードは手札に残る');
  await setup({hand:['HD02-011','HB01-061'], ena:['HD02-001','HD02-002','HD02-003']},{});
  s=await S(); await moveTo(uidOf(s,0,'hand','HD02-011'),'line',0);
  await p.click('#pickCancel'); await wait(100);
  s=await S();
  ok(s.players[0].deck.length===10 && (await log()).includes('見せなかった') && (await log()).includes('行わない'),'「見せない」→ 引かない（そうしたなら、を満たさない）');
  await setup({hand:['HD02-011','HB01-061'], ena:['HD02-001','HD02-002']},{});
  s=await S(); await moveTo(uidOf(s,0,'hand','HD02-011'),'line',0);
  s=await S();
  ok(!(await p.evaluate(()=>!!picking)) && s.players[0].deck.length===10,'緑のエナ2枚 → エナ詠みを満たさず、選ばせもしない');

  // 13d. バトルが終わったとき → 自分のホロビトを1体選び、回復する（HD01-014）
  // 「自分のホロビト」を選ぶ範囲と「回復する」の定義は未確定なので、どちらも手で処理するよう案内する
  await setup({line:[['HD01-014'],[{k:'HD01-001',turned:true}]]},{});
  s=await S(); await p.evaluate(u=>openCardSheet(u),s.players[0].line[0][0].uid); await wait(450);
  ok(await p.evaluate(()=>(document.querySelector('#sheet .fxbtn')||{}).textContent||'').then(t=>t.includes('バトルが終わったとき')),'HD01-014: メニューに「バトルが終わったとき」の効果のボタン');
  await clickSheet('.fxbtn'); await wait(150);
  s=await S();
  ok(!(await p.evaluate(()=>!!picking)) && s.players[0].line[1][0].turned===true,'HD01-014: 候補を光らせず、盤面も勝手に変えない（ダウンしたホロビトは横向きのまま）');
  ok((await log()).includes('手で処理') && (await log()).includes('回復する」は定義が未確定'),'HD01-014: 選ぶ範囲と「回復する」は手で処理するよう案内');

  // 14. 手動に切り替えると何もしない
  await setup({hand:['HD01-001']},{});
  await p.click('#btnFx'); await wait(50);
  ok(await p.evaluate(()=>document.getElementById('btnFx').textContent)==='効果: 手動','ヘッダーで「効果: 手動」に切り替えられる');
  s=await S(); await moveTo(s.players[0].hand[0].uid,'line',0);
  s=await S(); ok(s.players[0].deck.length===10,'手動のときは出しても引かない');
  ok(await p.evaluate(()=>!document.querySelector('.fxb')),'手動のときは印も出ない');

  // 15. ドラッグで出しても発動する
  await setup({hand:['HD01-001']},{});
  if(!touch){
    s=await S();
    const src=p.locator(`.card[data-cid="${s.players[0].hand[0].uid}"]`); await src.scrollIntoViewIfNeeded();
    const bb=await src.boundingBox();
    const dst=p.locator('#side-0 .lineslot[data-idx="0"]'); await dst.scrollIntoViewIfNeeded();
    const b2=await src.boundingBox(), db=await dst.boundingBox();
    await p.mouse.move(b2.x+b2.width/2,b2.y+b2.height/2); await p.mouse.down();
    await p.mouse.move(b2.x+b2.width/2,b2.y+b2.height/2-30,{steps:4});
    await p.mouse.move(db.x+db.width/2,db.y+db.height/2,{steps:8}); await p.mouse.up(); await wait(100);
    s=await S(); ok(s.players[0].line[0].length===1 && s.players[0].deck.length===9,'ドラッグでラインに出しても 1枚引く');
  }

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
