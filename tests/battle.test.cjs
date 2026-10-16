// バトルフェイズの自動処理と、召喚フェイズのルール（依頼者の指示 2026-10-12）
// 確定（手引書）: 第1ラインから順にバトル／不戦勝／パワーの高いほうが勝つ／引き分けはお互いのホロビトだけがダメージ／
//   ダメージでダウン、ダウン中なら破壊（ホロビトは墓地・ハートは手札。代わりにトリガーを使える）／
//   ダブルダメージ・1バリア／ハートが0枚のときのダメージでトドメ／第1ラインの結果で次の先手
// 遊び方動画: ハートは上から順番に（重なりの一番上から）ダメージ。2ダメージはそのまま1ダメージを2回（依頼者の説明 2026-10-15）
// 召喚フェイズ: エナチャージは手札から1枚・ホロビトを出す前だけ／新しいラインは第1ラインに最も近い空きライン
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function run(label, viewport, touch){
  console.log('\n=== '+label+' ===');
  const b=await H.launch();
  const ctx=await b.newContext({...(touch?devices['iPhone 13']:{}),viewport,hasTouch:!!touch,isMobile:!!touch});
  const p=await ctx.newPage(); H.watch(p, label); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  p.on('dialog',d=>d.accept());
  await p.goto(H.URL);
  const S=()=>p.evaluate(()=>state);
  const log=()=>p.evaluate(()=>fxLines.join(' / '));
  const q=()=>p.evaluate(()=>document.querySelector('#sheet .fxq')?.textContent||'');
  const opts=()=>p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-fxa]')].map(b=>b.textContent));
  // バトルの結果の画面（「続ける」だけ）は押して進める（2026-10-16〜 バトルごとに結果をカードの画像と並べて見せる）
  const settle=async()=>{ for(let i=0;i<10;i++){ await wait(60); if(!(await p.$('#sheet [data-kind="result"]'))) return; await wait(450); await p.click('#sheet [data-kind="result"] button[data-fxa="0"]'); await wait(150); } };
  const choose0=async text=>{ await wait(450); await p.locator('#sheet button[data-fxa]',{hasText:text}).first().click(); await wait(150); };
  const choose=async text=>{ await choose0(text); await settle(); };
  const picks=()=>p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  const tap=async uid=>{ const el=p.locator(`.card[data-cid="${uid}"]`); await el.evaluate(e=>e.scrollIntoView({block:'center'})); if(touch) await el.tap(); else await el.click(); await wait(460); };
  const top=(s,pi,li)=>{ const st=s.players[pi].line[li]; return st[st.length-1]; };
  // 盤面を組む（ここだけスクリプト）。heart は数（裏向きの未確定カード）か、カードの配列
  const setup=async(me,opp,ex)=>{
    await p.evaluate(([me,opp,ex])=>{
      let n=0; const mk=(k,o,e)=>Object.assign({uid:'B'+(n++),owner:o,key:k,up:true,turned:false,note:''},e||{});
      const P=(spec,o)=>{ const pl={heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}};
        for(let i=0;i<10;i++) pl.deck.push(mk(null,o,{up:false}));
        const hs=spec.heart===undefined?5:spec.heart;
        if(typeof hs==='number') for(let i=0;i<hs;i++) pl.heart.push(mk(null,o,{up:false}));
        else hs.forEach(k=>pl.heart.push(typeof k==='string'?mk(k,o,{up:false}):mk(k.k,o,Object.assign({up:false},k))));
        for(const z of ['hand','ena','grave','waza']) (spec[z]||[]).forEach(k=>pl[z].push(typeof k==='string'?mk(k,o):mk(k.k,o,k)));
        (spec.line||[]).forEach((st,i)=>st.forEach(k=>pl.line[i].push(typeof k==='string'?mk(k,o):mk(k.k,o,k))));
        return pl; };
      state=Object.assign({v:3,round:1,phase:1,first:0,fxAuto:true,players:[P(me,0),P(opp,1)]},ex||{});
      undoStack=[]; picking=null; fxAsk=null; fxClear(); closeSheet();
      document.querySelectorAll('details.doc').forEach(d=>d.open=false); render();
    },[me,opp,ex||{}]);
  };
  // 召喚フェイズ（後手）からフェイズ送りでバトルフェイズへ
  const battle0=async()=>{ await p.click('#btnPhase'); await wait(200); };
  const battle=async()=>{ await battle0(); await settle(); };

  // ---- 1. 勝ち負け: 負けたホロビトとハート（列の一番上）がダウン。次の先手 ----
  await setup({line:[['HB01-001']]},{line:[['HD01-001']]},{first:1});
  await battle();
  let s=await S();
  ok(await p.textContent('#phaseLbl')==='バトルフェイズ','フェイズ送りでバトルフェイズに入り、自動でバトルが進む');
  ok((await log()).includes('自分 4000') && (await log()).includes('相手 2000') && (await log()).includes('自分の勝ち'),'パワーを比べる: 4000 対 2000 → 自分の勝ち');
  ok(top(s,1,0).turned && !top(s,0,0).turned,'負けた相手のホロビトがダウン（横向き）、勝った側はそのまま');
  ok(s.players[1].heart[4].turned && s.players[1].heart.slice(0,4).every(c=>!c.turned) && s.players[0].heart.every(c=>!c.turned),'負けた側のハートは、重なりの一番上の1枚だけがダウン（ルール動画「上から順番に」）');
  // 重なりの一番上は、持ち主にいちばん近い端（相手は上端）に、ほかのハートの上に重ねて表示する
  const hp=await p.evaluate(()=>{ const els=[...document.querySelectorAll('#side-1 .z-heart .card')]; const r=els.map(e=>e.getBoundingClientRect().top);
    const t=els.findIndex(e=>e.classList.contains('turned')); return {t, top:r[t], others:r.filter((_,i)=>i!==t), z:els[t]===document.elementFromPoint(els[t].getBoundingClientRect().left+8, els[t].getBoundingClientRect().top+8)?.closest('.card')}; });
  ok(hp.t===4 && hp.others.every(y=>y>hp.top) && hp.z,'相手のダウンしたハートは、相手の列の上端（相手に近い端）で、ほかのハートの上に重なって見える '+JSON.stringify(hp));
  ok(s.nextFirst===0 && (await log()).includes('次のラウンドの先手'),'第1ラインに勝った自分が次の先手（いまの先手は相手）');
  ok(s.battle===null && (await p.textContent('#flow')).includes('バトルフェイズ終了'),'5つのラインを終えるとバトルフェイズ終了と出る');
  ok(await p.evaluate(()=>!!document.querySelector('#side-1 .lineslot[data-idx="0"] .card.turned')),'盤面でもダウンしたカードが横向きに出る');
  await p.click('#btnPhase'); await wait(80); await p.click('#btnPhase'); await wait(80);
  s=await S();
  ok(s.round===2 && s.first===0 && s.phase===0,'次のラウンドで、第1ラインに勝った自分が先手になる');

  // ---- 2. 引き分け: お互いのホロビトがダメージ、ハートは受けない。第1ラインの引き分けで先手後手が入れ替わる ----
  await setup({line:[['HB01-001']]},{line:[['HD02-003']]});
  await battle(); s=await S();
  ok((await log()).includes('引き分け') && top(s,0,0).turned && top(s,1,0).turned,'引き分け（4000 対 4000）: お互いのホロビトがダウン');
  ok(s.players.every(P=>P.heart.every(c=>!c.turned)),'引き分け: ハートはダメージを受けない');
  ok(s.nextFirst===1,'第1ラインが引き分け → 次のラウンドは先手後手が入れ替わる');

  // ---- 3. ダウン中に負ける → 破壊されて墓地へ。束なら下をどうするか聞く ----
  await setup({line:[['HB01-001']]},{line:[[{k:'HD01-001',turned:true}],[{k:'HB01-001'},{k:'HD01-001',turned:true}]]},{});
  await p.evaluate(()=>{ state.players[0].line[1].push({uid:'X1',owner:0,key:'HB01-033',up:true,turned:false,note:''}); render(); });
  await battle();
  s=await S();
  ok(!s.players[1].line[0].length && s.players[1].grave.some(c=>c.key==='HD01-001'),'ダウン中のホロビトが負ける → 破壊されて墓地へ');
  ok((await q()).includes('下に 1 枚') && (await q()).includes('未確定'),'束の一番上が破壊されるときは、下のカードをどうするか聞く（未確定）');
  await choose('一番上だけ');
  s=await S();
  ok(s.players[1].line[1].length===1 && s.players[1].line[1][0].key==='HB01-001','「一番上だけ墓地へ」→ 下のカードはラインに残る');

  // ---- 4. 破壊されない（HD01-017）: ダウンしたまま残る ----
  await setup({line:[['HB01-065']]},{line:[[{k:'HD01-017',turned:true}]]});
  await battle();
  ok((await q()).includes('勝ったときの効果'),'勝ったときの効果（HB01-065）があれば、ダメージとの順番を聞く');
  await choose('ダメージを先に');
  s=await S();
  ok(s.players[1].line[0].length===1 && top(s,1,0).turned && (await log()).includes('ダウンしたままラインに残る'),'HD01-017 はダウン中に負けても破壊されず、ダウンしたまま残る');

  // ---- 5. 1バリア: プレイヤーが受けるダメージが1減る（ホロビトは減らない） ----
  await setup({line:[['HB01-001']]},{line:[['HD02-002']]});
  await battle(); s=await S();
  ok(top(s,1,0).turned && s.players[1].heart.every(c=>!c.turned) && (await log()).includes('1バリア −1'),'1バリア: 負けたホロビトはダウンするが、ハートへのダメージは 1−1＝0');

  // ---- 6. ダブルダメージ: 2ダメージはそのまま1ダメージを2回（遊び方動画。依頼者の説明 2026-10-15）----
  // 依頼者の例: 一番上のハートがダウンしているなら、それが破壊されてトリガーチェック、次のハートがダウン
  await setup({line:[['HD02-006']]},{line:[['HB01-001']], heart:['HD01-001','HD01-001','HD01-001',{k:'PR-013',turned:true}]});
  await battle();
  ok((await log()).includes('受けるダメージ：2') && (await log()).includes('1 回目') && (await q()).includes('電光攻火') && (await q()).includes('破壊されました'),
    'ダブルダメージ: 1回目で、一番上のダウンしているハート（電光攻火）が破壊され、トリガーを使うか聞く（トリガーチェック）');
  await choose('中断する');
  ok((await p.textContent('#flow')).includes('バトルを続ける'),'中断すると、上部に「バトルを続ける」が出る');
  await p.click('#flow button[data-flow="resume"]'); await wait(200);
  ok((await q()).includes('電光攻火') && (await S()).players[1].heart.length===4,'「バトルを続ける」で同じ所から再開する（ダメージを入れ直さない）');
  await choose('使わずに手札に');
  s=await S();
  ok(s.players[1].heart.length===3 && s.players[1].heart[2].turned && s.players[1].heart.slice(0,2).every(c=>!c.turned) && s.players[1].hand.some(c=>c.key==='PR-013'),
    'ダブルダメージ: 2回目で、次のハートがダウンする（依頼者の説明どおり）');
  ok(s.battle===null && (await log()).includes('2 回目'),'2回目まで入れて、残りのラインを処理して終わる');
  // ハートがすべて縦向きなら: 1回目で一番上がダウン、2回目でそのハートが破壊（動画にない場面。依頼者の判断 2026-10-16「2回とも同じハートにダメージが入る」）
  await setup({line:[['HD02-006']]},{line:[['HB01-001']]});
  await battle();
  ok((await q()).includes('破壊されました') && (await S()).players[1].heart.length===5,'すべて縦向き: 1回目で一番上がダウンし、2回目でそのハートが破壊される');
  await choose('使わずに手札に');
  s=await S();
  ok(s.players[1].heart.length===4 && s.players[1].heart.every(c=>!c.turned),'すべて縦向き: 残りの4枚は縦向きのまま');
  // 途中でハートが0枚になってもトドメにはならない
  await setup({line:[['HD02-006']]},{line:[['HB01-001']], heart:[{k:'PR-013',turned:true}]});
  await battle(); await choose('使わずに手札に');
  s=await S();
  ok(s.winner===undefined && !s.players[1].heart.length && (await log()).includes('トドメにはならない'),
    '1回目で最後のハートが破壊されて0枚になっても、2回目でトドメにはならない（手引書「相手のハートが残っている時は、何ダメージ与えてもトドメを刺せません」）');
  // ダブルダメージ × 1バリア → 1ダメージ（手引書）
  await setup({line:[['HD02-006']]},{line:[['HD02-002']]});
  await battle(); s=await S();
  ok((await log()).includes('受けるダメージ：1') && s.players[1].heart[4].turned,'ダブルダメージ × 1バリア → 1ダメージ（手引書）で、ハートがダウン');
  // 自分が負けたとき: 自分のハートは、自分の列の下端（自分に近い端）の1枚からダウンする
  await setup({line:[['HD01-001']]},{line:[['HB01-001']]});
  await battle(); s=await S();
  const mp=await p.evaluate(()=>{ const els=[...document.querySelectorAll('#side-0 .z-heart .card')]; const r=els.map(e=>e.getBoundingClientRect().top);
    const t=els.findIndex(e=>e.classList.contains('turned')); return {t, top:r[t], others:r.filter((_,i)=>i!==t)}; });
  ok(s.players[0].heart[4].turned && mp.t===4 && mp.others.every(y=>y<mp.top),'自分のハートは、自分の列の下端（自分に近い端）の1枚がダウンする '+JSON.stringify(mp));

  // ---- 7. トドメ: ハートが0枚のときにダメージ → 勝利（勝利条件①）。そこで止まる ----
  await setup({line:[['HB01-001'],['HB01-001']]},{line:[['HD01-001'],['HD01-001']], heart:0});
  await battle(); s=await S();
  ok(s.winner===0 && (await p.textContent('#flow')).includes('自分の勝利') && (await p.textContent('#flow')).includes('勝利条件①'),'ハートが0枚の相手にダメージ → 自分の勝利（勝利条件①）');
  ok(!top(s,1,1).turned,'勝敗が決まったら、残りのバトルは行わない');

  // ---- 8. ハートが破壊される → トリガー（任意）----
  // ドローT: 墓地へ置き、3枚引く
  await setup({line:[['HB01-001']]},{line:[['HD01-001']], heart:[{k:'PR-013',turned:true}]});
  await battle();
  ok((await q()).includes('ダメージで破壊されました') && (await q()).includes('電光攻火') && (await opts()).some(t=>t.includes('ドローT')),'ダウンしているハートにダメージ → 破壊。カード名を示し、トリガーを使うか聞く（任意）');
  await choose('トリガーを使う');
  s=await S();
  ok(s.players[1].grave.some(c=>c.key==='PR-013') && s.players[1].hand.length===3 && !s.players[1].heart.length,'ドロートリガー: 墓地へ置き、3枚引く');
  // 使わない → 手札に加える
  await setup({line:[['HB01-001']]},{line:[['HD01-001']], heart:['HD01-001',{k:'PR-013',turned:true}]});
  await battle(); await choose('使わずに手札に');
  s=await S();
  ok(s.players[1].hand.some(c=>c.key==='PR-013' && c.up) && s.players[1].heart.length===1,'トリガーを使わなければ手札に加える（表向き）');
  // エントリーT: 空いているラインの1番前に出す。出たときの効果も発動（アカナー: 下にカードがないなら1枚引く）
  await setup({line:[['HB01-001'],['HB01-001']]},{line:[['HD01-001'],['HB01-001']], heart:['HD01-001',{k:'HD01-010',turned:true}]});
  await battle();
  ok((await opts()).some(t=>t.includes('エントリーT')),'エントリートリガーを使うか聞く');
  await choose('トリガーを使う');
  ok((await opts()).some(t=>t.includes('第3ライン')) && (await opts()).some(t=>t.includes('オーバービート')),'エントリートリガー: 空いているラインの1番前（第3ライン）か、オーバービートで出すかを選ぶ（手引書）');
  await choose('第3ライン');
  let s8=await S();
  ok(s8.players[1].line[2].length===1 && s8.players[1].line[2][0].key==='HD01-010' && s8.players[1].hand.length===1,'エントリートリガー: 第3ラインに出て、「出たとき」で1枚引く（コストは支払わない）');
  ok((await log()).includes('第2ライン'),'そのあと第2ラインのバトルへ進む');
  // オーバーT: コストが小さいホロビトの上にオーバービートで出す
  await setup({line:[['HB01-001']]},{line:[['HD01-001'],['HB01-001']], heart:['HD01-001',{k:'HB01-033',turned:true}]});
  await battle(); await choose('トリガーを使う');
  let pk=await picks();
  s8=await S();
  ok(pk.length===2 && pk.includes(s8.players[1].line[1][0].uid),'オーバートリガー: 下にできるのは、コストが小さい（6より小さい）ラインの一番上のホロビト');
  await tap(s8.players[1].line[1][0].uid);
  s8=await S();
  ok(s8.players[1].line[1].length===2 && top(s8,1,1).key==='HB01-033','オーバートリガー: 選んだホロビトの上に出る（コストは支払わない）');
  // ラストオーバーT: 手札に加えて1枚引く。その時点のハートが1枚以下なら、オーバービートで出せる
  await setup({line:[['HB01-001']]},{line:[['HD01-001'],['HB01-001']], heart:[{k:'HD02-006',turned:true}]});
  await battle(); await choose('トリガーを使う');
  s8=await S();
  ok(s8.players[1].hand.length===2 && s8.players[1].hand.some(c=>c.key==='HD02-006') && (await q()).includes('ハートが 0 枚（1枚以下）'),'ラストオーバートリガー: 手札に加えて1枚引き、ハートが0枚なのでオーバービートで出せると聞く');
  await choose('オーバービートで出す');
  await tap(s8.players[1].line[1][0].uid);
  s8=await S();
  ok(top(s8,1,1).key==='HD02-006' && s8.players[1].hand.length===1,'ラストオーバートリガー: 手札からオーバービートで出る（コストは支払わない）');
  // ハートが2枚以上残っていれば、オーバービートでは出せない
  await setup({line:[['HB01-001']]},{line:[['HD01-001'],['HB01-001']], heart:['HD01-001','HD01-001',{k:'HD02-006',turned:true}]});
  await battle(); await choose('トリガーを使う');
  ok((await log()).includes('1枚以下ではない') && (await S()).players[1].hand.length===2,'ラストオーバートリガー: ハートが2枚残っていれば、手札に加えて1枚引くだけ');

  // エントリーT でオーバービートで出す: 下のホロビトのダウンが解除され、下の「オーバービートされるとき」も発動する
  await setup({line:[['HB01-001']]},{line:[['HD01-001'],[{k:'HD02-009',turned:true}]], heart:['HD01-001',{k:'HD01-010',turned:true}]});
  await battle(); await choose('トリガーを使う'); await choose('オーバービートで出す');
  s8=await S(); pk=await picks();
  ok(pk.length===2 && pk.includes(s8.players[1].line[1][0].uid),'エントリートリガー（オーバービート）: 下にできるのは、コストが小さい（3より小さい）ラインの一番上のホロビト');
  await tap(s8.players[1].line[1][0].uid);
  ok((await q()).includes('同時に 2 つの効果'),'出たとき（アカナー）とオーバービートされるとき（すやすやジャンボ）が同時に発動し、順番を選ぶ');
  await choose('すやすやジャンボ');
  s8=await S();
  ok(s8.players[1].line[1].length===2 && top(s8,1,1).key==='HD01-010' && !s8.players[1].line[1][0].turned && s8.players[1].hand.length===1,
    'エントリートリガー（オーバービート）: 重ねて出し、下のダウンを解除。すやすやジャンボで1枚引き、アカナーは下にカードがあるので引かない');
  // トリガーを使えないとき（空いたラインがなく、コストが小さいホロビトもいない）は、手札に加えるだけ
  await setup({line:[['HB01-001']]},{line:[['HD01-001'],['HB01-001'],['HB01-001'],['HB01-001'],['HB01-001']], heart:['HD01-001',{k:'HD01-001',turned:true}]});
  await battle();
  ok((await q()).includes('いまは使えません') && !(await opts()).some(t=>t.includes('トリガーを使う')) && (await opts()).some(t=>t.includes('使わずに手札に')),
    'エントリートリガーを使えない（空いたラインがなく、重ねられるホロビトもいない）ときは理由を示し、手札に加えるだけ');
  await choose('使わずに手札に');
  // 「効果: 手動」でも、トリガーはルールなので選べる（出たときの効果は処理しない）
  await setup({line:[['HB01-001']]},{line:[['HD01-001']], heart:['HD01-001',{k:'HD01-001',turned:true}]});
  await p.evaluate(()=>{ state.fxAuto=false; render(); });
  await battle();
  ok((await opts()).some(t=>t.includes('トリガーを使う')) && (await p.textContent('#sheet h3')).includes('トリガーチェック'),'「効果: 手動」のときも、ハートが破壊されたらトリガーを使うか聞く（トリガーチェック）');
  await choose('トリガーを使う');
  s8=await S();
  ok(s8.players[1].line[1].length===1 && s8.players[1].line[1][0].key==='HD01-001' && !s8.players[1].hand.length,'「効果: 手動」: エントリートリガーでラインに出る。レオまるの「出たとき」は手動なので引かない');

  // ---- 9. バトルのダメージでダウン → 「ダウンしたとき」（HD02-016） ----
  await setup({line:[['HD01-016']]},{line:[['HD02-016']]});
  await battle(); s=await S();
  ok(top(s,1,0).turned && s.players[1].hand.length===2,'HD02-016: バトルに負けてダウンすると、「ダウンしたとき」で2枚引く');

  // ---- 10. HB01-065: 勝ったとき正面を破壊（パワーの比は計算した値で判定）→ 1バリアは発動しない（印字） ----
  await setup({line:[['HB01-065']]},{line:[['HD02-002']]});
  await battle();
  await choose('勝ったときの効果を先に');
  s=await S();
  ok(s.players[1].grave.some(c=>c.key==='HD02-002') && !(await q()).includes('倍以上ですか'),'HB01-065: パワー 14000 は正面の 2000 の2倍以上 → 聞かずに正面を破壊');
  ok((await log()).includes('1バリアは発動しない') && (await log()).includes('受けるダメージ：2'),'HB01-065: 破壊した相手の1バリアは発動しない（印字）。ダブルダメージで2');
  ok((await q()).includes('破壊されました'),'HB01-065: 2ダメージ（1ダメージを2回）で、一番上のハートがダウンしてから破壊される');
  await choose('使わずに手札に');

  // ---- 11. 常時の効果のパワー: 判定できれば足す（疾風のカマイチ 第2ライン +2500） ----
  await setup({line:[[],['HD01-005']]},{line:[[],['HB01-001']]});
  await p.evaluate(()=>{ state.players[0].line[0].push({uid:'Y1',owner:0,key:'HB01-001',up:true,turned:false,note:''}); state.players[1].line[0].push({uid:'Y2',owner:1,key:'HB01-001',up:true,turned:false,note:''}); render(); });
  await battle();
  ok((await log()).includes('自分 5500') && (await log()).includes('効果 +2500'),'HD01-005: 第2ラインにいるので +2500（3000+2500＝5500）を足して比べる');
  // 判定できない条件は聞く（未確定カードがラインにいると、ホロビトの数が決まらない）
  await setup({line:[['HD01-015'],['HB01-001'],['HB01-001'],[{k:null}]]},{line:[['HB01-033']]});
  await battle();
  ok((await q()).includes('臨戦！ レオ') && (await q()).includes('4体以上'),'パワーの条件が判定できなければ聞く（HD01-015 の「4体以上」）');
  await choose('満たしている');
  ok((await log()).includes('自分 10000'),'「満たしている」→ 6000+4000＝10000');

  // ---- 12. バトルが終わったとき（HD01-014: 自分のホロビトを1体選び、回復する） ----
  await setup({line:[['HD01-014']]},{line:[['HD02-007']]});
  await battle();
  let pk2=await picks(); s=await S();
  ok(pk2.includes(top(s,0,0).uid) && top(s,0,0).turned,'HD01-014: 負けてダウンしたあと、「バトルが終わったとき」で回復するホロビトを選ぶ');
  await tap(top(s,0,0).uid);
  ok(!top(await S(),0,0).turned,'HD01-014: 選んだ自分（ダウン中）が回復する');

  // ---- 13. 両者ともいない第1ライン → 次の先手は聞く。途中でフェイズ送り → 確かめてから進む ----
  await setup({line:[[],['HB01-001']]},{line:[[],['HD01-001']]});
  await battle();
  ok((await q()).includes('次のラウンドの先手') && (await q()).includes('B-1'),'第1ラインにバトルがないときの次の先手は手引書にないので聞く');
  await choose('中断する');
  await p.click('#btnPhase'); await wait(100);
  ok((await S()).phase===3 && (await log()).includes('残りのバトルを行わずに'),'バトルの途中でフェイズ送り → 確かめてからエンドフェイズへ');

  // ---- 13b. バトルで第2ラインが破壊されたら、エンドフェイズのスライドステップで第3ラインを第2ラインへ詰める（手引書・ルール動画）----
  await setup({line:[['HB01-001'],[{k:'HD01-001',turned:true}],['HB01-001']]},{line:[['HD01-001'],['HB01-001'],['HD02-003']]});
  await battle();
  s=await S();
  ok(s.battle===null && !s.players[0].line[1].length && s.players[0].grave.some(c=>c.key==='HD01-001') && s.players[0].line[2].length===1,
    '第1〜第3ラインでバトルし、ダウンしていた自分の第2ラインのホロビトが負けて破壊され、第2ラインが空く');
  await p.click('#btnPhase'); await wait(100);
  s=await S();
  ok(s.phase===3 && s.players[0].line[1].length===1 && s.players[0].line[1][0].key==='HB01-001' && !s.players[0].line[2].length && s.players[0].line[0].length===1,
    'エンドフェイズのスライドステップで、第3ラインのホロビトが空いた第2ラインへ移る');
  ok(s.players[1].line.slice(0,3).every(st=>st.length===1),'相手のラインは空いていないので動かない（詰めるのはプレイヤーごと）');
  ok((await log()).includes('スライドステップ'),'記録にスライドステップが出る');

  // ---- 13c. 画面: バトルのカードを画像で並べる・結果・トリガーチェックの画像・盤面の印（依頼者の指示 2026-10-16）----
  await setup({hand:['PR-013'], ena:['HD01-001','HD01-001'], line:[['HB01-001']]},{line:[['HD02-009']], heart:['HD01-001',{k:'PR-013',turned:true}]});
  await battle0();
  s=await S();
  const head=()=>p.evaluate(()=>[...document.querySelectorAll('#sheet .fxcards .fxcard')].map(e=>({cid:e.dataset.cid||'', cls:e.className, t:e.textContent})));
  let hd=await head();
  ok(hd.length===2 && hd[0].cid===top(s,0,0).uid && hd[1].cid===top(s,1,0).uid && hd[0].t.includes('自分') && hd[0].t.includes('雷獣 レオ') && hd[1].t.includes('相手') && hd[1].t.includes('すやすやジャンボ'),
    'ワザの手番の画面に、バトルしている両者のカードを並べて出す（自分・相手） '+JSON.stringify(hd.map(h=>h.t)));
  ok(await p.evaluate(u=>picHTML(findCard(u).card,'','').includes('images/cards/HB01-001.webp'),top(s,0,0).uid),'カードの画像は images/cards/<番号>.webp を使う（画像がなければ名前とパワーを文字で出す）');
  ok(await p.evaluate(([a,b])=>[a,b].every(u=>{ const e=document.querySelector('.card[data-cid="'+u+'"]'); return e && e.classList.contains('fx-bat') && e.querySelector('.fxtag').textContent==='バトル'; }),[top(s,0,0).uid,top(s,1,0).uid]),
    '盤面でも、バトルしている2枚に太い枠と「バトル」の札を付ける');
  await choose0('ワザの使用を終えて');
  hd=await head();
  ok(!!(await p.$('#sheet [data-kind="result"]')) && (await p.textContent('#sheet h3')).includes('結果') && (await q()).includes('パワー 自分 4000 対 相手 2000 → 自分の勝ち'),'パワーを比べたら、結果の画面を出す');
  ok(hd.length===2 && hd[0].cls.includes('win') && hd[0].t.includes('勝ち') && hd[0].t.includes('パワー 4000') && hd[1].cls.includes('lose') && hd[1].t.includes('負け'),'結果の画面: 両者のカードを並べ、勝ち・負けとパワーを出す');
  await choose0('続ける');
  hd=await head();
  ok((await p.textContent('#sheet h3')).includes('トリガーチェック') && hd.length===1 && hd[0].cls.includes('tgt') && hd[0].t.includes('トリガーチェック') && hd[0].cid===s.players[1].heart[1].uid,
    'ハートが破壊されたら、そのカードの画像を出してトリガーチェックする');
  ok(await p.evaluate(u=>{ const e=document.querySelector('.card[data-cid="'+u+'"]'); return e && e.classList.contains('fx-tgt') && e.querySelector('.fxtag').textContent==='対象'; },s.players[1].heart[1].uid),
    '盤面でも、破壊されたハートに赤い太い枠と「対象」の札を付ける');
  await choose('使わずに手札に');
  ok(!(await p.$('.card.fx-tgt')) && !(await p.$('.card.fx-bat')),'処理が終わったら、盤面の印は消える');
  // 不戦勝の結果の画面
  await setup({line:[['HB01-001']]},{});
  await battle0();
  hd=await head();
  ok(!!(await p.$('#sheet [data-kind="result"]')) && hd.length===2 && hd[1].t.includes('ホロビトなし') && (await q()).includes('不戦勝'),'不戦勝も結果の画面を出す（相手側は「ホロビトなし」）');
  await settle();
  // 選ぶ候補は太い枠と「選ぶ」の札
  await setup({line:[['HB01-001']]},{line:[['HD01-001'],['HB01-001']], heart:['HD01-001',{k:'HB01-033',turned:true}]});
  await battle(); await choose('トリガーを使う');
  ok(await p.evaluate(()=>{ const e=[...document.querySelectorAll('.card.pickable')]; return e.length===2 && e.every(x=>x.querySelector('.fxtag').textContent==='選ぶ'); }),'選ぶ候補のカードには、太い枠と「選ぶ」の札を付ける');

  // ---- 14. 召喚フェイズ: エナチャージ・新しいライン・番 ----
  await setup({hand:['HD01-001','HB01-001','HD01-010','PR-013'], ena:['HD01-001','HD01-001','HD01-001','HD01-001']},{hand:['HD02-001']},{phase:0});
  const openH=async key=>{ const u=(await S()).players[0].hand.find(c=>c.key===key).uid; await p.evaluate(u=>openCardSheet(u),u); await wait(460); };
  await openH('PR-013');
  ok(await p.evaluate(()=>!document.querySelector('#sheet button[data-mv="ena"]').disabled),'エナチャージ: 自分の召喚フェイズなら、手札からエナへ動かせる');
  await p.click('#sheet button[data-mv="ena"]'); await wait(100);
  s=await S();
  ok(s.players[0].ena.length===5 && s.players[0].ena[4].key==='PR-013' && !s.players[0].ena[4].turned && s.players[0].enaCharged,'エナチャージ: 未使用（縦向き）で置く');
  await openH('HD01-010');
  ok(await p.evaluate(()=>document.querySelector('#sheet button[data-mv="ena"]').disabled && document.getElementById('sheet').textContent.includes('1枚だけ')),'エナチャージは1枚だけ（2枚目は押せない）');
  const lb=await p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-mv="line"]')].map(b=>b.disabled));
  ok(!lb[0] && lb[1] && lb[2] && lb[3] && lb[4],'新しいラインは、空いているラインのうち第1ラインに最も近いライン（第1）だけ');
  await p.click('#sheet button[data-mv="line"][data-idx="0"]'); await wait(460);
  await p.locator('#sheet button',{hasText:'支払って出す'}).click(); await wait(200);
  await openH('HD01-001');
  const lb2=await p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-mv="line"]')].map(b=>b.disabled));
  ok(lb2[0] && !lb2[1] && lb2[2],'1体出したあとは第2ラインに出す（第1はコストが同じなので重ねられない）');
  await p.click('#sheet button[data-close="1"]'); await wait(100);
  // メインステップのあとはエナチャージできない
  await setup({hand:['HD01-001','PR-013'], ena:['HD01-001','HD01-001']},{},{phase:0});
  await openH('HD01-001'); await p.click('#sheet button[data-mv="line"][data-idx="0"]'); await wait(460);
  await p.locator('#sheet button',{hasText:'支払って出す'}).click(); await wait(200);
  await p.evaluate(u=>{ snap(); enaCharge(u,0); },(await S()).players[0].hand.find(c=>c.key==='PR-013').uid);
  ok((await S()).players[0].ena.length===2 && (await log()).includes('メインステップ'),'ホロビトを出したあと（メインステップ）は、エナチャージできない');
  // 自分の番でない（後手の召喚フェイズ）とき、手札のホロビトは出せない
  await setup({hand:['HD01-001'], ena:['HD01-001','HD01-001']},{},{phase:1});
  await p.evaluate(u=>playFromHand(u,0,0),(await S()).players[0].hand[0].uid); await wait(100);
  ok(!(await S()).players[0].line[0].length && (await log()).includes('自分の召喚フェイズ'),'相手の召喚フェイズ中は、自分の手札のホロビトを出せない');
  // バトルフェイズ中も出せない（メニューのラインのボタンが押せない）
  await setup({hand:['HD01-001'], ena:['HD01-001','HD01-001']},{},{phase:3});
  await openH('HD01-001');
  ok(await p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-mv="line"]')].every(b=>b.disabled)),'召喚フェイズ以外では、手札のホロビトのラインのボタンは押せない');

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
}
(async()=>{
  await run('pc',{width:1280,height:1000},false);
  await run('iphone',{width:390,height:844},true);
  await H.finish();
})();
