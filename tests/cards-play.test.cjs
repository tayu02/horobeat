// 全カードの効果を、画面の操作だけで1枚ずつ動かして、印字どおりに動くかを確かめる
// （2026-10-09 依頼者の問い「君の方で動かして、効果通りの動きをしてるか確認した？」から）
//
// - 盤面の初期配置だけはスクリプトで並べる（シャッフルに左右されないように）
// - そこから先は、カードをタップ → メニューのボタン → 光ったカードをタップ → 質問のボタン、
//   という利用者と同じ操作だけで進める（内部の関数は呼ばない）
// - 期待値は能力欄の印字から決める。未確定の部分は「聞く／手で処理するよう案内する」ことを期待値にする
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

(async()=>{
  const b=await H.launch();
  const ctx=await b.newContext({viewport:{width:1280,height:1000}});
  const p=await ctx.newPage(); H.watch(p, 'pc'); const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
  await p.goto(H.URL);

  // ---- 盤面を並べる（ここだけスクリプト）----
  const setup=async(me,opp)=>{
    await p.evaluate(([me,opp])=>{
      let n=0; const mk=(k,o,ex)=>Object.assign({uid:'T'+(n++),owner:o,key:k,up:true,turned:false,note:''},ex||{});
      const P=(spec,o)=>{ const pl={heart:[],waza:[],ena:[],hand:[],grave:[],deck:[],line:[[],[],[],[],[]],decklist:{}};
        for(let i=0;i<10;i++) pl.deck.push(mk(null,o,{up:false}));
        for(const z of ['hand','ena','grave','heart','waza']) (spec[z]||[]).forEach(k=>pl[z].push(typeof k==='string'?mk(k,o):mk(k.k,o,k)));
        // deck は山札の上から順。指定しなければ中身の分からないカード10枚だけ
        (spec.deck||[]).slice().reverse().forEach(k=>pl.deck.unshift(typeof k==='string'?mk(k,o,{up:false}):mk(k.k,o,Object.assign({up:false},k))));
        (spec.line||[]).forEach((st,i)=>st.forEach(k=>pl.line[i].push(typeof k==='string'?mk(k,o):mk(k.k,o,k))));
        return pl; };
      state={round:1,phase:0,first:0,fxAuto:true,players:[P(me,0),P(opp,1)]};
      undoStack=[]; picking=null; fxAsk=null; fxClear(); closeSheet(); render();
    },[me||{},opp||{}]);
  };
  // ---- 読むだけ ----
  const S=()=>p.evaluate(()=>state);
  const top=async(pi,li)=>{ const st=(await S()).players[pi].line[li]; return st[st.length-1].uid; };
  const inZone=async(pi,zone,key)=>(await S()).players[pi][zone].find(c=>c.key===key).uid;
  const log=()=>p.evaluate(()=>fxLines.join(' / '));
  const q=()=>p.evaluate(()=>document.querySelector('#sheet .fxq')?.textContent||'');
  const sheet=()=>p.evaluate(()=>document.getElementById('sheet').textContent);
  const picks=()=>p.evaluate(()=>[...document.querySelectorAll('.card.pickable')].map(e=>e.dataset.cid));
  // 盤面の印。表示されている（on / q / wz）ものだけ
  const badges=(pi,li)=>p.evaluate(([pi,li])=>[...document.querySelectorAll('#side-'+pi+' .lineslot[data-idx="'+li+'"] .fxb span')]
    .filter(s=>getComputedStyle(s).display!=='none').map(s=>s.textContent).join(','),[pi,li]);
  const hand=async pi=>(await S()).players[pi].hand.length;
  // ---- 画面の操作だけ ----
  const tap=async uid=>{ const el=p.locator(`.card[data-cid="${uid}"]`); await el.scrollIntoViewIfNeeded(); await el.click(); await wait(460); };
  const click=async sel=>{ await wait(460); await p.click('#sheet '+sel); await wait(120); };
  const fxbtn=async text=>{ await wait(460); await p.locator('#sheet button.fxbtn',{hasText:text}).first().click(); await wait(120); };
  const ans=async i=>click(`button[data-fxa="${i}"]`);
  const close=async()=>{ if(await p.isVisible('#sheet button[data-close="1"]')) await click('button[data-close="1"]'); };
  // 手札のホロビトをラインに出すにはエナでコストを払う（足りなければ出せない）。効果を見る試験なので、
  // 手札のカードはいったん墓地に置き、墓地→ラインで動かす（支払いを聞かない。支払いは cost.test.cjs）
  const moveTo=async(uid,zone,idx)=>{
    if(zone==='line') await p.evaluate(u=>{ for(const P of state.players){ const i=P.hand.findIndex(c=>c.uid===u); if(i>=0){ P.grave.push(P.hand.splice(i,1)[0]); render(); } } },uid);
    await tap(uid); await click(`button[data-mv="${zone}"]`+(idx!==undefined?`[data-idx="${idx}"]`:'')); await wait(120); };
  const useWaza=async(wuid,huid)=>{ await tap(wuid); await click('button[data-wzuse]'); await wait(150); await tap(huid); };
  const R=c=>'HD01-001';  // 赤のホロビト（レオまる）
  const shots=[];
  const shot=async name=>{ const f=H.out('play-'+name+'.png'); await p.screenshot({path:f}); shots.push(f); };

  // ===== 常時の効果（盤面の印）=====
  // HB01-033 自分の赤のホロビトが4体以上ラインに出ているなら +5000
  await setup({line:[['HB01-033'],['HB01-001'],['HD01-001'],['HD01-003']]});
  let bd=await badges(0,0);
  ok(bd.includes('+5000') && bd.includes('ダブルダメージ'),'HB01-033: 赤4体 → +5000 とダブルダメージ（'+bd+'）');
  await setup({line:[['HB01-033'],['HB01-001'],['HD01-001'],['HD02-001']]});
  bd=await badges(0,0);
  ok(!bd.includes('+5000') && bd.includes('ダブルダメージ'),'HB01-033: 赤3体＋緑1体 → +5000 は付かない（'+bd+'）');

  // HB01-049 第1〜2ラインのホロビトの下のカードの合計が3枚以上なら +3000・ダブルダメージを得る
  await setup({line:[['HD01-001','HD01-001','HD01-001'],['HD01-001','HD01-001'],['HB01-049']]});
  bd=await badges(0,2);
  ok(bd.includes('+3000') && bd.includes('ダブルダメージ'),'HB01-049: 下のカードの合計 2+1=3 → +3000 とダブルダメージ（'+bd+'）');
  await setup({line:[['HD01-001','HD01-001'],['HD01-001'],['HB01-049']]});
  bd=await badges(0,2);
  ok(!bd.includes('+3000'),'HB01-049: 合計1 → 付かない（'+bd+'）');

  // HD02-017 このホロビトの下にカードが2枚以上あるなら +3000
  await setup({line:[['HD02-001','HD02-001','HD02-017']]});
  bd=await badges(0,0);
  ok(bd.includes('+3000') && bd.includes('ダブルダメージ'),'HD02-017: 下に2枚 → +3000（'+bd+'）');
  await setup({line:[['HD02-001','HD02-017']]});
  bd=await badges(0,0);
  ok(!bd.includes('+3000'),'HD02-017: 下に1枚 → 付かない（'+bd+'）');

  // HD01-005 第2〜5ラインにいるなら +2500
  await setup({line:[[],['HD01-005']]});
  ok((await badges(0,1)).includes('+2500'),'HD01-005: 第2ライン → +2500');
  await setup({line:[['HD01-005']]});
  ok(!(await badges(0,0)).includes('+2500'),'HD01-005: 第1ライン → 付かない');

  // HD01-015 自分のホロビトが4体以上（色を問わない）なら +4000
  await setup({line:[['HD01-015'],['HD02-001'],['HD02-002'],['HB01-001']]});
  ok((await badges(0,0)).includes('+4000'),'HD01-015: 色の違う4体 → +4000');
  await setup({line:[['HD01-015'],['HD02-001'],['HB01-001']]});
  ok(!(await badges(0,0)).includes('+4000'),'HD01-015: 3体 → 付かない');

  // HD01-011 エナ詠み③（赤3枚以上）・ダウンしていないなら +3000
  await setup({line:[['HD01-011']], ena:[R(),R(),R()]});
  ok((await badges(0,0)).includes('+3000'),'HD01-011: 赤のエナ3枚・縦向き → +3000');
  await setup({line:[[{k:'HD01-011',turned:true}]], ena:[R(),R(),R()]});
  ok(!(await badges(0,0)).includes('+3000'),'HD01-011: ダウンしている → 付かない');
  await setup({line:[['HD01-011']], ena:[R(),R(),'HD02-001']});
  ok(!(await badges(0,0)).includes('+3000'),'HD01-011: 赤のエナ2枚 → 付かない');

  // HB01-005 エナ詠み③（赤3枚以上）→ パワーを+2000
  await setup({line:[['HB01-005']], ena:[R(),R(),R()]});
  ok((await badges(0,0)).includes('+2000'),'HB01-005: 赤のエナ3枚 → +2000');
  await setup({line:[['HB01-005']], ena:[R(),R()]});
  ok(!(await badges(0,0)).includes('+2000'),'HB01-005: 赤のエナ2枚 → 付かない');

  // HB01-015 エナ詠み③（赤3枚以上）・ダウンしていないなら +3000
  await setup({line:[['HB01-015']], ena:[R(),R(),R()]});
  ok((await badges(0,0)).includes('+3000'),'HB01-015: 赤のエナ3枚・縦向き → +3000');
  await setup({line:[[{k:'HB01-015',turned:true}]], ena:[R(),R(),R()]});
  ok(!(await badges(0,0)).includes('+3000'),'HB01-015: ダウンしている → 付かない');

  // HB01-012 第2〜5ラインにいるなら +2000
  await setup({line:[[],['HB01-012']]});
  ok((await badges(0,1)).includes('+2000'),'HB01-012: 第2ライン → +2000');
  await setup({line:[['HB01-012']]});
  ok(!(await badges(0,0)).includes('+2000'),'HB01-012: 第1ライン → 付かない');

  // HB01-013 ダウンしていないなら +2000
  await setup({line:[['HB01-013']]});
  ok((await badges(0,0)).includes('+2000'),'HB01-013: 縦向き → +2000');
  await setup({line:[[{k:'HB01-013',turned:true}]]});
  ok(!(await badges(0,0)).includes('+2000'),'HB01-013: ダウンしている → 付かない');

  // HB01-011 このホロビトには、オーバービートできない（重ねられないことは cost.test.cjs で確かめる）
  await setup({line:[['HB01-011']]});
  ok((await badges(0,0)).includes('オーバービートされない'),'HB01-011: 「オーバービートされない」の印');

  // ラインに出ているなら、コストは1大きくなる（3枚）
  for(const k of ['HB01-034','HD02-001','HD02-014']){
    await setup({line:[[k]]});
    ok((await badges(0,0)).includes('コスト+1'),k+': ラインに出ている → コスト+1');
  }
  // HB01-023 破壊されない／ダウンしていないなら +3000 とダブルダメージ
  await setup({line:[['HB01-023']]});
  bd=await badges(0,0);
  ok(bd.includes('破壊されない') && bd.includes('+3000') && bd.includes('ダブルダメージ'),'HB01-023: 縦向き → 破壊されない・+3000・ダブルダメージ（'+bd+'）');
  await setup({line:[[{k:'HB01-023',turned:true}]]});
  bd=await badges(0,0);
  ok(bd.includes('破壊されない') && !bd.includes('+3000') && !bd.includes('ダブルダメージ'),'HB01-023: ダウンしている → 破壊されないだけ（'+bd+'）');

  // HB01-032 第2〜5ラインにいるならダブルダメージを得る
  await setup({line:[[],['HB01-032']]});
  ok((await badges(0,1)).includes('ダブルダメージ'),'HB01-032: 第2ライン → ダブルダメージの印');
  await setup({line:[['HB01-032']]});
  ok(!(await badges(0,0)).includes('ダブルダメージ'),'HB01-032: 第1ライン → 付かない');

  // HB01-047 エナ詠み③（緑3枚以上）。HD02-011 と同じ文面・同じコスト・同じパワーで、番号とフレーバーが違う
  await setup({hand:['HB01-047','HB01-061'], ena:['HD02-001','HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HB01-047'),'line',0);
  await tap((await picks())[0]);
  let s=await S();
  ok(s.players[0].deck.length===9 && s.players[0].hand.some(c=>c.key==='HB01-061'),'HB01-047: 緑のエナ3枚・コスト10を見せる → 1枚引く（見せたカードは手札に残る）');
  await setup({hand:['HB01-047','HB01-061'], ena:['HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HB01-047'),'line',0);
  ok((await S()).players[0].deck.length===10 && (await picks()).length===0,'HB01-047: 緑のエナ2枚 → エナ詠みを満たさず何もしない');

  // HB01-046 このホロビトにブーストを使っているなら、パワーは+2000される（印。使っていなければ付かない）
  await setup({line:[['HB01-046']]});
  ok(!(await badges(0,0)).includes('+2000'),'HB01-046: ブーストを使っていなければ +2000 の印は出ない');
  await tap(await top(0,0));
  ok((await sheet()).includes('+2000') && (await sheet()).includes('条件を満たしていない'),'HB01-046: メニューで「条件を満たしていない」と +2000 を示す');
  await close();

  // HB01-041 エナ詠み③（緑3枚以上）→ パワーを+3000
  await setup({line:[['HB01-041']], ena:['HD02-001','HD02-001','HD02-001']});
  ok((await badges(0,0)).includes('+3000'),'HB01-041: 緑のエナ3枚 → +3000');
  await setup({line:[['HB01-041']], ena:['HD02-001','HD02-001']});
  ok(!(await badges(0,0)).includes('+3000'),'HB01-041: 緑のエナ2枚 → 付かない');

  // HB01-071 自分のエナゾーンにカードが8枚以上あるなら +4000（色は問わない）
  await setup({line:[['HB01-071']], ena:Array(8).fill('HD01-001')});
  ok((await badges(0,0)).includes('+4000'),'HB01-071: エナ8枚（赤ばかり）→ +4000（色は問わない）');
  await setup({line:[['HB01-071']], ena:Array(7).fill('HD02-001')});
  ok(!(await badges(0,0)).includes('+4000'),'HB01-071: エナ7枚 → 付かない');

  // HB01-067 このホロビトがワザを使っているなら +3000（使っていなければ付かない）
  await setup({line:[['HB01-067']]});
  ok(!(await badges(0,0)).includes('+3000'),'HB01-067: ワザを使っていなければ +3000 の印は出ない');
  await tap(await top(0,0));
  ok((await sheet()).includes('+3000') && (await sheet()).includes('条件を満たしていない'),'HB01-067: メニューで「条件を満たしていない」と +3000 を示す');
  await close();

  // HB01-055 ラインに出ているなら、コストは1小さくなる
  await setup({line:[['HB01-055']]});
  ok((await badges(0,0)).includes('コスト-1'),'HB01-055: ラインに出ている → コスト-1 の印');
  // HB01-057 ラインに出ているなら、コストは1大きくなる（HB01-055 と逆）
  await setup({line:[['HB01-057']]});
  ok((await badges(0,0)).includes('コスト+1'),'HB01-057: ラインに出ている → コスト+1 の印');

  // HB01-056 このホロビトはワザを使えない（印。バトルの試験は下）
  await setup({line:[['HB01-056']]});
  ok((await badges(0,0)).includes('ワザを使えない'),'HB01-056: 「ワザを使えない」の印');

  // HB01-059 自分の第1〜2ラインにいるホロビトの下にあるカードの合計が5枚以上なら +5000
  await setup({line:[['HD02-001','HD02-003','HD02-003','HB01-059'],['HD02-001','HD02-003','HD02-003']]});
  ok((await badges(0,0)).includes('+5000'),'HB01-059: 下の合計 3＋2 ＝ 5枚 → +5000');
  await setup({line:[['HD02-001','HD02-003','HB01-059'],['HD02-001','HD02-003']]});
  ok(!(await badges(0,0)).includes('+5000'),'HB01-059: 下の合計 2＋1 ＝ 3枚 → 付かない');

  // HB01-048 バトル中、ワザやブーストでパワーが上がらない（印。計算は下のバトルの試験）
  await setup({line:[['HB01-048']]});
  ok((await badges(0,0)).includes('ワザ・ブーストで上がらない'),'HB01-048: 「ワザ・ブーストで上がらない」の印');

  // HB01-021 隣のラインにパワー4000以上がいないと出せない（印。出せるかは cost.test.cjs）
  await setup({line:[['HB01-021']]});
  ok((await badges(0,0)).includes('隣に 4000 以上が必要'),'HB01-021: 「隣に 4000 以上が必要」の印');
  // HB01-022 手札から出すならオーバービートでは出せない（印）
  await setup({line:[['HB01-022']]});
  ok((await badges(0,0)).includes('手札からはオーバービート不可'),'HB01-022: 「手札からはオーバービート不可」の印');
  // HB01-030 このホロビトには、オーバービートできない（印）
  await setup({line:[['HB01-030']]});
  ok((await badges(0,0)).includes('オーバービートされない'),'HB01-030: 「オーバービートされない」の印');

  // HB01-054 / HB01-066 2バリア（1バリアだけだったところに2が出た）
  for(const k of ['HB01-054','HB01-066']){
    await setup({line:[[k]]});
    ok((await badges(0,0)).includes('2バリア'),k+': 「2バリア」の印');
  }

  // キーワード・破壊されない（印だけ）
  for(const [k,t] of [['HB01-039','1バリア'],['HB01-064','ダブルダメージ'],['HB01-073','ダブルダメージ'],['HB01-050','ダブルダメージ'],['HB01-051','ダブルダメージ'],['HD02-002','1バリア'],['HD02-005','1バリア'],['HD02-010','1バリア'],['HD02-006','ダブルダメージ'],['HD01-016','ダブルダメージ'],['HD01-017','破壊されない'],['HD01-007','破壊されない'],['HB01-016','ダブルダメージ'],['HB01-018','ダブルダメージ'],['HB01-027','ダブルダメージ'],['HB01-025','ダブルダメージ']]){
    await setup({line:[[k]]});
    ok((await badges(0,0)).includes(t),k+': 「'+t+'」の印');
  }
  // ブースト（2026-10-15〜 バトル中に使ったものをシミュレーターが記録する）: 使っていなければ条件を満たさない
  for(const [k,n] of [['HD02-012','+2000'],['HD01-012','+3000']]){
    await setup({line:[[k]]});
    ok(!(await badges(0,0)).includes(n),k+': ブーストを使っていなければ '+n+' の印は出ない');
    await tap(await top(0,0));
    const sh=await sheet();
    ok(sh.includes(n) && sh.includes('条件を満たしていない'),k+': メニューで「条件を満たしていない」と '+n+' を示す');
    await close();
  }

  // ===== 出たとき（手札からラインへ動かす）=====
  // HD01-001 出たとき、カードを1枚引く
  await setup({hand:['HD01-001']});
  await moveTo(await inZone(0,'hand','HD01-001'),'line',0);
  s=await S();
  ok(s.players[0].line[0].length===1 && s.players[0].hand.length===1 && s.players[0].deck.length===9,'HD01-001: ラインに出す → 1枚引く');
  // HB01-002 出たとき、カードを1枚引く
  await setup({hand:['HB01-002']});
  await moveTo(await inZone(0,'hand','HB01-002'),'line',0);
  ok((await S()).players[0].deck.length===9,'HB01-002: ラインに出す → 1枚引く');
  // HB01-058 出たとき、相手のホロビトを1体選び、このホロビトの正面のホロビトと入れ替えてもよい
  await setup({hand:['HB01-058']},{line:[['HD01-001'],['HD02-003']]});
  await moveTo(await inZone(0,'hand','HB01-058'),'line',0);
  await tap(await top(1,1));      // 相手の第2ラインを選ぶ
  await ans(0);                   // 入れ替える
  s=await S();
  ok(s.players[1].line[0][0].key==='HD02-003' && s.players[1].line[1][0].key==='HD01-001','HB01-058: 選んだ相手のホロビトが、正面のホロビトと入れ替わる');
  // 正面にホロビトがいないなら入れ替えられない（印字の注記）
  await setup({hand:['HB01-058']},{line:[[],['HD02-003']]});
  await moveTo(await inZone(0,'hand','HB01-058'),'line',0);
  await tap(await top(1,1));
  ok((await log()).includes('正面にホロビトがいないので'),'HB01-058: 正面にホロビトがいなければ入れ替えない（印字の注記）');

  // HB01-037 出たとき、山札の一番上を見る。そのカードを山札の一番下に置いてもよい
  await setup({hand:['HB01-037']});
  let topUid=(await S()).players[0].deck[0].uid;
  await moveTo(await inZone(0,'hand','HB01-037'),'line',0);
  await close();   // 見たカードの画面を閉じる
  await ans(0);
  s=await S();
  ok(s.players[0].deck[s.players[0].deck.length-1].uid===topUid && s.players[0].deck.length===10,'HB01-037: 見たカードを山札の一番下に置く（枚数は変わらない）');
  await setup({hand:['HB01-037']});
  topUid=(await S()).players[0].deck[0].uid;
  await moveTo(await inZone(0,'hand','HB01-037'),'line',0);
  await close();
  await ans(1);
  ok((await S()).players[0].deck[0].uid===topUid,'HB01-037: 置かなければ一番上のまま');

  // HB01-045 出たとき、自分のホロビトを1体選ぶ。手札からコスト5以下のホロビトを1体選び、その一番下に置いてもよい
  await setup({hand:['HB01-045','HD02-003'], line:[[],['HD01-001']]});
  await moveTo(await inZone(0,'hand','HB01-045'),'line',0);
  await tap(await top(0,1));                       // 自分のホロビト（第2ラインのレオまる）を選ぶ
  await tap(await inZone(0,'hand','HD02-003'));    // 手札のつくものジャンボ（コスト2）を選ぶ
  await ans(0);
  s=await S();
  ok(s.players[0].line[1].length===2 && s.players[0].line[1][0].key==='HD02-003','HB01-045: 選んだホロビトの束の一番下に置く');
  ok(s.players[0].deck.length===9,'HB01-045: そうしたので1枚引く');

  // HB01-026 出たとき、自分のエナを1枚選び、墓地に置く
  await setup({hand:['HB01-026'], ena:['HD01-001','HD01-001']});
  await moveTo(await inZone(0,'hand','HB01-026'),'line',0);
  let pk=await picks();
  ok(pk.length===2,'HB01-026: 出たとき、自分のエナを選ばせる（2枚）');
  await tap(pk[0]);
  s=await S();
  ok(s.players[0].ena.length===1 && s.players[0].grave.some(c=>c.key==='HD01-001'),'HB01-026: 選んだエナが墓地へ');

  // HB01-024 出たとき、自分のホロビトを1体選び、それと位置を入れ替えてもよい
  await setup({hand:['HB01-024'], line:[[],['HD01-001']]});
  await moveTo(await inZone(0,'hand','HB01-024'),'line',0);
  pk=await picks();
  ok(pk.length===2,'HB01-024: 出たとき、自分のホロビトを選ばせる（自分自身も候補）');
  await tap(await top(0,1));   // 第2ラインのレオまるを選ぶ
  s=await S();
  ok(s.players[0].line[0][0].key==='HD01-001' && s.players[0].line[1][0].key==='HB01-024','HB01-024: 選んだホロビトと場所が入れ替わる（下にカードがなければ聞かない）');

  // HB01-030 出たとき、手札からコスト2以下の赤のホロビトを1体、ラインに出してもよい（コストは支払わない）
  await setup({hand:['HB01-030','HD01-001','HD01-012']});
  await moveTo(await inZone(0,'hand','HB01-030'),'line',0);
  pk=await picks();
  ok(pk.length===1,'HB01-030: 候補は手札のコスト2以下の赤のホロビトだけ（レオまるのみ。鼠合 キュウジロウはコスト5）');
  await tap(pk[0]);
  s=await S();
  ok(s.players[0].line[1].length===1 && s.players[0].line[1][0].key==='HD01-001' && !s.players[0].ena.length,'HB01-030: 第2ラインに出て、エナは払わない');

  // HD01-010 出たとき、下にカードがないなら1枚引く
  await setup({hand:['HD01-010']});
  await moveTo(await inZone(0,'hand','HD01-010'),'line',0);
  ok((await S()).players[0].deck.length===9,'HD01-010: 空のラインに出す → 1枚引く');
  await setup({hand:['HD01-010'], line:[['HD01-001']]});
  await moveTo(await inZone(0,'hand','HD01-010'),'line',0);
  ok((await S()).players[0].deck.length===10,'HD01-010: 束の上に出す → 引かない');
  // HD01-006 出たとき、自分のホロビトを1体選び、回復する（回復＝ダウンしているカードを縦向きに。手引書）
  await setup({hand:['HD01-006'], line:[[],[{k:'HD01-001',turned:true}]]});
  await moveTo(await inZone(0,'hand','HD01-006'),'line',0);
  pk=await picks(); s=await S();
  ok(pk.length===2 && pk.includes(s.players[0].line[1][0].uid),'HD01-006: 自分のラインのホロビトが光る（出た七尾自身も含む）');
  await tap(s.players[0].line[1][0].uid);
  ok(!(await S()).players[0].line[1][0].turned,'HD01-006: 選んだダウンしているホロビトが縦向きになる（回復）');
  let lg;
  // HD02-011 エナ詠み③（緑）・出たとき、手札からコスト7以上のホロビトを1体見せてもよい。そうしたなら1枚引く
  await setup({hand:['HD02-011','HB01-065','HD02-001'], ena:['HD02-001','HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HD02-011'),'line',0);
  pk=await picks(); s=await S();
  ok(pk.length===1 && pk[0]===s.players[0].hand.find(c=>c.key==='HB01-065').uid,'HD02-011: 見せる候補はコスト7以上のホロビト（コスト9の HB01-065）だけ');
  await tap(pk[0]);
  s=await S();
  ok(s.players[0].hand.length===3 && s.players[0].hand.some(c=>c.key==='HB01-065'),'HD02-011: 見せると1枚引く。見せたカードは手札に残る');
  await setup({hand:['HD02-011','HB01-065'], ena:['HD02-001','HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HD02-011'),'line',0);
  await p.click('#pickCancel'); await wait(150);
  ok((await S()).players[0].deck.length===10 && (await log()).includes('見せなかった'),'HD02-011: 見せなければ引かない');
  await setup({hand:['HD02-011','HB01-065'], ena:['HD02-001','HD02-001']});
  await moveTo(await inZone(0,'hand','HD02-011'),'line',0);
  ok((await S()).players[0].deck.length===10 && (await picks()).length===0,'HD02-011: 緑のエナ2枚 → エナ詠みを満たさず何もしない');

  // ===== オーバービートされるとき・ダウンしたとき =====
  // HD02-009 オーバービートされるとき、ダウンしているなら1枚引く（そのあとダウンは解除される）
  await setup({hand:['HB01-001'], line:[[{k:'HD02-009',turned:true}]]});
  s=await S();
  await moveTo(await inZone(0,'hand','HB01-001'),'line',0);
  s=await S();
  ok(s.players[0].deck.length===9 && !s.players[0].line[0][0].turned,'HD02-009: ダウン中に重ねられる → 1枚引き、そのあとダウンが解除される');
  await setup({hand:['HB01-001'], line:[['HD02-009']]});
  await moveTo(await inZone(0,'hand','HB01-001'),'line',0);
  ok((await S()).players[0].deck.length===10,'HD02-009: ダウンしていなければ引かない');
  // HD02-016 ダウンしたとき、カードを2枚引く
  await setup({line:[['HD02-016']]});
  await tap(await top(0,0)); await click('button[data-tg]'); await wait(150);
  s=await S();
  ok(s.players[0].line[0][0].turned && s.players[0].hand.length===2,'HD02-016: 横向き（ダウン）にする → 2枚引く');

  // ===== バトルの出来事（メニューのボタンで知らせる）=====
  // HB01-065 バトルに勝ったとき、パワーが正面の2倍以上なら、正面のホロビトを破壊する
  await setup({line:[['HB01-065']]},{line:[['HD01-001']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  ok((await q()).includes('2倍以上'),'HB01-065: パワーの比は計算せず聞く');
  await ans(0);
  s=await S();
  ok(s.players[1].line[0].length===0 && s.players[1].grave.some(c=>c.key==='HD01-001') && (await log()).includes('相手の第1ライン'),'HB01-065: 正面（相手の同じ番号のライン）が破壊され相手の墓地へ');
  await setup({line:[[],['HB01-065']]},{line:[['HD01-001']]});
  await tap(await top(0,1)); await fxbtn('バトルに勝ったとき'); await ans(0);
  ok((await S()).players[1].line[0].length===1,'HB01-065: 第2ラインにいて、相手の第2ラインが空なら何もしない（第1ラインは正面ではない）');
  await setup({line:[['HB01-065']]},{line:[['HD01-001']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき'); await ans(1);
  ok((await S()).players[1].line[0].length===1,'HB01-065: 2倍以上でないと答える → 破壊しない');
  // 正面が「このホロビトは破壊されない」を持つとき
  await setup({line:[['HB01-065']]},{line:[['HD01-017']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき'); await ans(0);
  s=await S();
  ok(s.players[1].line[0].length===1 && s.players[1].grave.length===0,'HB01-065 → HD01-017: 「このホロビトは破壊されない」を持つ正面は破壊しない');
  ok((await log()).includes('破壊されない'),'HB01-065 → HD01-017: 破壊しない理由が記録に出る');
  await setup({line:[['HB01-065']]},{line:[['HD01-007']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき'); await ans(0);
  ok((await S()).players[1].line[0].length===1,'HB01-065 → HD01-007: 破壊されない');

  // HB01-063 エナ詠み③（緑）・バトルに勝ったとき、第1〜2ラインにいるなら、相手は手札を1枚選んで捨てる
  await setup({line:[['HB01-063']], ena:['HD02-001','HD02-001','HD02-001']},{hand:['HD02-003','HD01-001']});
  ok((await badges(0,0)).includes('エナ詠み'),'HB01-063: 緑のエナ3枚 → エナ詠みの印');
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  pk=await picks(); s=await S();
  ok(pk.length===2 && s.players[1].hand.every(c=>pk.includes(c.uid)),'HB01-063: 相手の手札が光る（選ぶのは相手）');
  await tap(pk[0]);
  ok((await log()).includes('捨てるカード') && (await sheet()).includes('移動'),'HB01-063: 選ぶと、置き場所は未確定なのでそのカードのメニューを開く');
  await close();
  await setup({line:[['HB01-063']], ena:['HD02-001','HD02-001']},{hand:['HD02-003']});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  ok((await picks()).length===0 && (await log()).includes('満たしていない'),'HB01-063: 緑のエナ2枚 → 発動しない');
  await setup({line:[[],[],['HB01-063']], ena:['HD02-001','HD02-001','HD02-001']},{hand:['HD02-003']});
  await tap(await top(0,2)); await fxbtn('バトルに勝ったとき');
  ok((await picks()).length===0 && (await log()).includes('第1〜2ライン'),'HB01-063: 第3ライン → 発動しない');

  // HB01-031 バトルが終わったとき、自分の赤のエナを1枚選ぶ。それを未使用にし、このホロビトを回復する
  await setup({line:[[{k:'HB01-031',turned:true}]], ena:[{k:'HD01-001',turned:true},{k:'HD02-001',turned:true}]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  pk=await picks(); s=await S();
  ok(pk.length===1 && pk[0]===s.players[0].ena[0].uid,'HB01-031: 候補は赤のエナだけ（緑は光らない）');
  await tap(pk[0]);
  s=await S();
  ok(!s.players[0].ena[0].turned && s.players[0].ena[1].turned,'HB01-031: 選んだ赤のエナが未使用（縦向き）になる');
  ok(!s.players[0].line[0][0].turned && (await log()).includes('回復した'),'HB01-031: 「このホロビトを回復する」→ ダウンしていた七尾が縦向きになる');

  // HD01-014 バトルが終わったとき、自分のホロビトを1体選び、回復する
  await setup({line:[[{k:'HD01-014',turned:true}]]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  await tap((await picks())[0]);
  ok(!(await S()).players[0].line[0][0].turned,'HD01-014: 自分（ダウン中）を選ぶ → 回復して縦向きになる');

  // HB01-014 このホロビトのバトルが終わったとき、このホロビトを回復する
  await setup({line:[[{k:'HB01-014',turned:true}]]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  ok(!(await S()).players[0].line[0][0].turned,'HB01-014: ダウン中 → このホロビトが回復して縦向きになる');

  // HB01-032 第3〜5ラインにいるなら、バトルが終わったとき、正面のホロビトを回復させ、カードを1枚引く
  // （条件が発火条件より前に印字される初の形）
  await setup({line:[[],[],['HB01-032']]},{line:[[],[],[{k:'HD01-001',turned:true}]]});
  await tap(await top(0,2)); await fxbtn('バトルが終わったとき');
  s=await S();
  ok(!s.players[1].line[2][0].turned && s.players[0].deck.length===9,'HB01-032: 第3ライン → 正面のホロビトが回復し、1枚引く');
  await setup({line:[[],['HB01-032']]},{line:[[],[{k:'HD01-001',turned:true}]]});
  await tap(await top(0,1)); await fxbtn('バトルが終わったとき');
  s=await S();
  ok(s.players[1].line[1][0].turned && s.players[0].deck.length===10,'HB01-032: 第2ライン → 条件を満たさず、何も起きない');

  // HB01-044 このホロビトのバトルが終わったとき、このホロビトに1ダメージを与える
  await setup({line:[['HB01-044']]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  ok((await S()).players[0].line[0][0].turned,'HB01-044: 縦向き → 自分にダメージを与えてダウンする');
  await setup({line:[[{k:'HB01-044',turned:true}]]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  s=await S();
  ok(!s.players[0].line[0].length && s.players[0].grave.some(c=>c.key==='HB01-044'),'HB01-044: ダウン中 → 破壊されて墓地へ');

  // HB01-025 このホロビトのバトルが終わったとき、このホロビトを回復する
  await setup({line:[[{k:'HB01-025',turned:true}]]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  ok(!(await S()).players[0].line[0][0].turned,'HB01-025: ダウン中 → このホロビトが回復して縦向きになる');

  // HB01-070 このホロビトがダウンしたとき、自分のエナを1枚選び、未使用にする
  await setup({line:[['HB01-070']], ena:[{k:'HD01-001',turned:true},{k:'HD01-001',turned:true}]});
  await tap(await top(0,0)); await fxbtn('ダウンしたとき');
  pk=await picks();
  ok(pk.length===2,'HB01-070: ダウンしたとき、自分のエナを選ばせる');
  await tap(pk[0]);
  ok((await S()).players[0].ena.filter(c=>!c.turned).length===1,'HB01-070: 選んだエナが未使用（縦向き）になる');
  await close();

  // HD01-009 バトルに勝ったとき、第2〜5ラインにいるなら1枚引く
  await setup({line:[[],['HD01-009']]});
  await tap(await top(0,1)); await fxbtn('バトルに勝ったとき');
  ok((await hand(0))===1,'HD01-009: 第2ライン → 1枚引く');
  await setup({line:[['HD01-009']]});
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  ok((await hand(0))===0 && (await log()).includes('満たさない'),'HD01-009: 第1ライン → 引かない');

  // バトルに勝ったとき、カードを1枚引く（2枚）
  for(const k of ['HD02-012','HD02-015']){
    await setup({line:[[k]]});
    await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
    ok((await hand(0))===1,k+': バトルに勝ったとき → 1枚引く');
  }

  // ===== ワザ（2026-10-12〜 バトルフェイズの中で使う）=====
  // 相手の第1ラインにレオまる（2000）を置き、ハートを5枚にして（トドメにならないように）、フェイズ送りでバトルに入る。
  // ワザの手番で「使う」を選ぶ → コスト → 「使ったとき」→ パワーを比べる、を画面のボタンだけで進める
  // バトルの結果の画面（「続ける」だけ）は押して進める（2026-10-16〜 バトルごとに結果をカードの画像と並べて見せる）
  const settle=async()=>{ for(let i=0;i<10;i++){ await wait(60); if(!(await p.$('#sheet [data-kind="result"]'))) return; await wait(450); await p.click('#sheet [data-kind="result"] button[data-fxa="0"]'); await wait(150); } };
  const battle=async()=>{ await p.evaluate(()=>{ state.phase=1; render(); }); await p.click('#btnPhase'); await wait(200); await settle(); };
  const choose=async text=>{ await wait(460); await p.locator('#sheet button[data-fxa]',{hasText:text}).first().click(); await wait(150); await settle(); };
  const ansS=async i=>{ await ans(i); await settle(); };
  const opts=()=>p.evaluate(()=>[...document.querySelectorAll('#sheet button[data-fxa]')].map(b=>b.textContent));
  const H5=['HD01-001','HD01-001','HD01-001','HD01-001','HD01-001'].map(k=>({k,up:false}));
  // HD01-013 共鳴：ライガ／使ったとき1枚引く／このワザのパワーを+1000する
  await setup({hand:['HD01-013'], line:[['HB01-001']], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle();
  ok((await q()).includes('自分の番') && (await opts()).some(t=>t.includes('「以心電心」を使う')),'HD01-013: バトルのワザの手番で「以心電心を使う」が出る');
  await choose('以心電心');
  ok(!(await q()).includes('種族'),'HD01-013: 共鳴は、使ったホロビトの種族「ライガ・ファミリー」が「ライガ」を含むので、聞かずに満たす（総合ルール 9.9.2）');
  s=await S();
  ok(s.players[0].hand.length===1 && s.players[0].ena[0].turned && s.players[0].grave.some(c=>c.key==='HD01-013'),'HD01-013: 赤のエナ1枚を使用済みにし（色の内訳が1通りなので自動）、ワザを使い、1枚引く（バトルが終わってワザは墓地へ）');
  await shot('waza');
  ok((await log()).includes('7000') && (await log()).includes('自分の勝ち'),'HD01-013: パワーは 4000＋ワザ 2000＋1000（共鳴で、聞かずに足す）＝ 7000 で、2000 に勝つ');
  s=await S();
  ok(s.players[0].grave.some(c=>c.key==='HD01-013') && !s.players[0].waza.length,'HD01-013: バトルが終わると、使ったワザは墓地へ（手引書）');

  // HD02-013 共鳴：スザク／使ったとき相手は手札を1枚選んで捨てる／このバトルに勝ったとき自分は1枚引く
  await setup({hand:['HD02-013'], line:[['HD02-001']], ena:['HD02-001'], heart:H5},{hand:['HD02-003'], line:[['HD01-001']], heart:H5});
  await battle(); await choose('勝ちにいくぞ');
  ok(!(await q()).includes('種族'),'HD02-013: 共鳴は、種族「スザク・ブラッド」が「スザク」を含むので、聞かずに満たす');
  pk=await picks();
  ok(pk.length===1,'HD02-013: 使ったとき → 相手の手札が光る'); await tap(pk[0]);
  ok(await p.isVisible('#sheet button[data-mv="grave"]'),'HD02-013: 選んだ相手のカードのメニューが開き、置き場所を選べる（捨てる先は未確定）');
  await click('button[data-mv="grave"]');
  ok((await S()).players[1].grave.some(c=>c.key==='HD02-003'),'HD02-013: 相手のカードを墓地に置ける');
  await settle();
  ok(!(await q()).includes('どちらを先に') && (await hand(0))===1,'HD02-013: このバトルに勝ったとき → 自分は1枚引く（勝ったときの効果はダメージより先。順番は聞かない。総合ルール 6.3.2.7）');

  // HB01-097 2つ目のワザを使ったとき、正面のホロビトのコストが8以下なら、その一番上のカードを手札に戻す
  await setup({hand:['HD02-008','PR-013'], line:[['HB01-097']], ena:[R(),R(),'HD02-001','HD02-001'], heart:H5},{line:[['HB01-001','HD01-001']], heart:H5});
  await battle(); await choose('翠炎よ');
  ok((await opts()).some(t=>t.includes('おすすめで支払う（緑1・赤1）')) && (await q()).includes('7.2.2.1'),'HB01-097: 緑のワザ（コスト2）を、赤2・緑2のエナで払う → 緑を1枚含めればよいので、おすすめ（緑1・赤1）か自分で選ぶかを聞く（総合ルール 7.2.2.1）');
  await choose('おすすめ');
  ok(!(await log()).includes('2つ目'),'HB01-097: 1枚目では発動しない');
  await choose('電光攻火');
  ok((await log()).includes('2つ目のワザを使った'),'HB01-097: 2枚目で発動する');
  ok(!(await q()).includes('8以下') && (await q()).includes('誰の手札') && (await log()).includes('相手の第1ライン'),'HB01-097: 正面（相手の第1ライン。コスト2）は8以下なので聞かずに満たし、誰の手札に戻すかを聞く');
  s=await S();
  ok(await p.evaluate(([a,b])=>{ const src=document.querySelector('#sheet .fxcard.src[data-cid="'+a+'"]'), tgt=document.querySelector('#sheet .fxcard.tgt[data-cid="'+b+'"]');
      const ba=document.querySelector('.card[data-cid="'+a+'"]'), bb=document.querySelector('.card[data-cid="'+b+'"]');
      return src && tgt && src.textContent.includes('効果') && tgt.textContent.includes('対象') && ba.classList.contains('fx-src') && bb.classList.contains('fx-tgt'); },[s.players[0].line[0][0].uid, s.players[1].line[0][1].uid]),
    'HB01-097: 質問の画面に効果を出すカードと対象（正面）の画像を並べ、盤面でも金の枠「効果」・赤の枠「対象」を付ける');
  ok((await badges(0,0)).match(/ワザ\+5000/g).length===2,'HB01-097: 「ワザ+5000」の印が2つ');
  await ans(0);
  s=await S();
  ok(s.players[1].hand.some(c=>c.key==='HD01-001') && s.players[1].line[0].length===1,'HB01-097: 一番上だけが持ち主の手札に戻り、下のカードは残る');
  ok((await log()).includes('一番上になり') && (await log()).includes('9.10.3') && s.battle.users[1]===s.players[1].line[0][0].uid,
    'HB01-097: 下の「雷獣 レオ」が一番上になってその場に残り、そのホロビトがバトルを続ける（総合ルール 9.10.3）');
  await settle();
  ok((await log()).includes('自分 16000') && (await log()).includes('相手 4000') && (await log()).includes('自分の勝ち'),'HB01-097: パワーを比べる時点でいる両者で比べる（6000＋ワザ 5000×2 対 4000）');

  // ===== ブースト（ルール動画: 手札から横向きでワザゾーンに置き、バトル中のホロビトのパワーを+2000。左辺の丸数字はエナの数）=====
  // HD02-012 このホロビトにブーストを使っているなら、パワーは+2000される（ワザでは発動しない）
  await setup({hand:['HD02-010'], line:[['HD02-012']], ena:['HD02-001'], heart:H5},{hand:['PR-013'], ena:[R(),R()], line:[['HB01-033']], heart:H5});
  await battle();
  ok((await opts()).some(t=>t.includes('「ケサランパサラン」をブーストで使う（1エナ・+2000）')),'ブースト: 左辺に +2000 と丸数字のある手札のホロビトを、ブーストとして使える（1エナ）');
  await choose('ブーストで使う');
  s=await S();
  ok(s.players[0].waza.some(c=>c.key==='HD02-010' && c.turned) && s.players[0].ena[0].turned && !s.players[0].hand.length,'ブースト: 緑のエナ1枚を使用済みにし、手札から横向きでワザゾーンに置く');
  ok((await badges(0,0)).includes('ブースト+2000') && (await badges(0,0)).includes('+2000'),'HD02-012: ブーストを使ったので「+2000」の印が付く（使ったブーストの印も出る）');
  await choose('パス');   // 相手の番（相手はワザを使わずにパス）→ 自分は使えるものがないのでパス → パワーを比べる
  ok((await log()).includes('自分 10000') && (await log()).includes('ブースト「ケサランパサラン」+2000') && (await log()).includes('効果 +2000'),'HD02-012: パワーは 6000＋ブースト 2000＋効果 2000 ＝ 10000');
  await settle();
  s=await S();
  ok(s.players[0].grave.some(c=>c.key==='HD02-010') && !s.players[0].waza.length,'ブースト: バトルが終わると墓地へ（手引書「バトルで使い終わったワザ・ブースト」）');
  // 左辺に何も印字されていないホロビトは、ブーストとして使えない（2026-11-21 に左辺の誤記を直した3枚）
  await setup({hand:['HB01-015','HB01-041','HB01-047'], line:[['HD02-012']], ena:[R(),'HD02-001','HD02-001'], heart:H5},{line:[['HB01-033']], heart:H5});
  await battle();
  ok(!(await opts()).some(t=>t.includes('ブーストで使う')) && (await log()).includes('両者とも使えるものがない'),
     'HB01-015・HB01-041・HB01-047: 左辺に印字がないので、エナがあってもブーストとして使えない');
  await settle();
  // HD01-012 このホロビトがブーストを使っているなら、このホロビトのパワーは+3000される
  await setup({hand:['HD01-001'], line:[['HD01-012']], ena:[R()], heart:H5},{line:[['HB01-033']], heart:H5});
  await battle(); await choose('ブーストで使う');
  ok((await q()).includes('「このホロビトがブーストを使っている」に当たる') && (await q()).includes('同じ意味かは印字から分かりません'),'HD01-012: ブーストを使ったとき、「が使っている」に当たるかは聞く（「に使う」と同じ意味かは未確定）');
  await ans(0);
  ok((await log()).includes('自分 11000'),'HD01-012: 「当たる」→ 6000＋ブースト 2000＋3000 ＝ 11000');

  // HB01-014 ヒナタを導く七尾: 左辺のブーストが刷りによって違う（通常は +2000 ①、DR は印字なし）。
  // どちらで遊ぶかは未確定なので、黙って使えないことにせず、判定できないと伝える
  await setup({hand:['HB01-014','HD01-001'], line:[['HB01-001']], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle();
  ok((await q()).includes('ヒナタを導く七尾') && (await q()).includes('判定できません'),'HB01-014: 左辺が未確定の手札は、ブーストに使えるか判定できないと伝える');
  const bo=await opts();
  ok(bo.some(t=>t.includes('「レオまる」をブーストで使う')) && !bo.some(t=>t.includes('「ヒナタを導く七尾」をブーストで使う')),'HB01-014: 判定できないので、選択肢には出さない（レオまるは出る）');
  await choose('パス');

  // HB01-066 首領デカケゲン: 負けたとき、バリアで減らす分のダメージを相手に与える（トドメは刺せない）
  await setup({line:[['HB01-066']], heart:H5},{line:[['HB01-061']], heart:H5});
  await battle();
  ok((await log()).includes('バリアで減らす分（2）'),'HB01-066: 負けたとき、バリアで減らす分（2）を相手プレイヤーに与える');
  s=await S();
  ok(s.players[1].heart.length===4,'HB01-066: 相手のハートが1枚破壊される（1ダメージでダウン、2ダメージ目で破壊）');
  ok((await q()).includes('チェック処理'),'HB01-066: 破壊されたハートはチェック処理へ（負けたときの効果のダメージが先に処理される）');
  await choose('使わずに手札に');
  ok((await log()).includes('受けるダメージ：0') && (await S()).players[0].heart.filter(c=>c.turned).length===0,'HB01-066: 2バリアで、負けても自分のハートにダメージが入らない（1−2＝0）');

  // HB01-064 滅獣 ジャンボ: エナ詠み③（緑）・バトルに勝ったとき、カードを3枚引く
  await setup({line:[['HB01-064']], ena:['HD02-001','HD02-001','HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle();
  ok((await S()).players[0].deck.length===7,'HB01-064: 緑のエナ3枚で勝ったので、カードを3枚引く');

  // HB01-053 びゅーんといくジャン！: 自分がこのラウンドで先手なら、このワザのパワーを+2000
  await setup({hand:['HB01-053'], line:[['HD02-001']], ena:['HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('びゅーん');
  ok((await log()).includes('自分 6000'),'HB01-053: 自分が先手 → 2000＋ワザ 2000＋2000 ＝ 6000');
  await setup({hand:['HB01-053'], line:[['HD02-001']], ena:['HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await p.evaluate(()=>{ state.first=1; render(); });
  await battle(); await choose('びゅーん');
  ok((await log()).includes('自分 4000'),'HB01-053: 自分が後手 → 足さない（2000＋ワザ 2000）');

  // HB01-062 合術 不死の永炎！: 下にあるカードが2枚以上のホロビトのみ使える
  await setup({hand:['HB01-062'], line:[['HD02-001','HD02-003']], ena:['HD02-001','HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('不死の永炎');
  ok((await log()).includes('使えない') && (await S()).players[0].hand.length===1,'HB01-062: 下が1枚のホロビトでは使えず、手札に残る');
  await choose('パス');
  await setup({hand:['HB01-062'], line:[['HD02-001','HD02-001','HD02-003']], ena:['HD02-001','HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('不死の永炎');
  ok((await log()).includes('自分 8000'),'HB01-062: 下が2枚なら使える（4000＋ワザ 4000）');
  await choose('+1 する');
  ok((await log()).includes('受けるダメージ：2'),'HB01-062: 勝ったので、与えるダメージを+1して2');
  await choose('使わずに手札に');

  // HB01-056 怪鳥 シビロ: このホロビトはワザを使えない／相手のホロビトがワザを使っているなら +4000
  await setup({hand:['HB01-052'], line:[['HB01-056']], ena:['HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle();
  ok(!(await opts()).some(t=>t.includes('勝ちにいくぞ')) && (await log()).includes('両者とも使えるものがない'),'HB01-056: 「ワザを使えない」ので、ワザの選択肢が出ない');

  // HB01-060 森合 フルツキ: このホロビトと正面のホロビトはワザやブーストでパワーが上がらない
  await setup({hand:['PR-013'], line:[['HB01-001']], ena:[R(),R()], heart:H5},{line:[['HB01-060']], heart:H5});
  await battle(); await choose('電光攻火');
  ok((await log()).includes('自分 4000') && (await log()).includes('ワザ・ブーストの分は足さない'),'HB01-060: 正面にいるので、自分のワザの分も足されない（4000 のまま）');

  // HB01-043 1か！2か！どっちなんだい！: このワザは、第1〜2ラインのホロビトのみ使える
  await setup({hand:['HB01-043'], line:[[],[],['HD02-001']], ena:['HD02-001'], heart:H5},{line:[[],[],['HD01-001']], heart:H5});
  await battle(); await choose('どっちなんだい');
  ok((await log()).includes('使えない') && (await S()).players[0].hand.length===1,'HB01-043: 第3ラインのホロビトは使えず、手札に残る');
  await choose('パス');
  await setup({hand:['HB01-043'], line:[['HD02-001']], ena:['HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('どっちなんだい');
  ok((await log()).includes('自分 5000'),'HB01-043: 第1ラインのホロビトなら使える（2000＋ワザ 3000）');

  // HB01-042 私怨にて斬る！: 束の下のカードが正面より多いなら、このワザのパワーを+2000
  await setup({hand:['HB01-042'], line:[['HD02-001','HD02-003']], ena:['HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('私怨にて斬る');
  ok((await log()).includes('自分 8000'),'HB01-042: 自分の下が1枚・正面が0枚 → 4000＋ワザ 2000＋2000 ＝ 8000');
  await setup({hand:['HB01-042'], line:[['HD02-003']], ena:['HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('私怨にて斬る');
  ok((await log()).includes('自分 6000'),'HB01-042: 下が同じ0枚 → 足さない（4000＋ワザ 2000）');

  // HB01-048 ポツンといっけん爺: バトル中、ワザやブーストでパワーが上がらない
  await setup({hand:['PR-013'], line:[['HB01-048']], ena:[R(),R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('電光攻火');
  ok((await log()).includes('自分 8000') && (await log()).includes('ワザ・ブーストの分は足さない'),'HB01-048: ワザを使っても 8000 のまま（印字 8000＋ワザの分は足さない）');

  // HB01-010 二番戦陣: このワザは第2〜5ラインのホロビトのみ使える
  await setup({hand:['HB01-010'], line:[['HB01-001']], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('二番戦陣');
  ok((await log()).includes('使えない') && (await S()).players[0].hand.length===1,'HB01-010: 第1ラインのホロビトは使えず、手札に残る');
  await choose('パス');
  await setup({hand:['HB01-010'], line:[[],['HB01-001']], ena:[R()], heart:H5},{line:[[],['HD01-001']], heart:H5});
  await battle(); await choose('二番戦陣');
  ok((await log()).includes('自分 7000'),'HB01-010: 第2ラインのホロビトなら使える（4000＋ワザ 3000）');

  // HB01-020 和気愛々: このワザは下にカードが1枚以上あるホロビトのみ使える
  await setup({hand:['HB01-020'], line:[['HB01-001']], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('和気愛々');
  ok((await log()).includes('使えない') && (await S()).players[0].hand.length===1,'HB01-020: 下にカードがないホロビトでは使えず、手札に残る');
  await choose('パス');
  await setup({hand:['HB01-020'], line:[['HD01-001','HB01-001']], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('和気愛々');
  ok((await log()).includes('自分 7000'),'HB01-020: 下にカードが1枚あれば使える（4000＋ワザ 3000）');

  // HB01-028 合術 雷桜迅雷: 自分のホロビトが4体以上ラインに出ているときのみ使える／勝ったならダメージ+1
  await setup({hand:['HB01-028'], line:[['HB01-001']], ena:[R(),R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('雷桜迅雷');
  ok((await log()).includes('使えない') && (await S()).players[0].hand.length===1,'HB01-028: 自分のホロビトが1体では使えない');
  await choose('パス');
  await setup({hand:['HB01-028'], line:[['HB01-001'],['HD01-001'],['HD01-001'],['HD01-001']], ena:[R(),R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('雷桜迅雷');
  ok((await log()).includes('自分 8000'),'HB01-028: 4体いれば使える（4000＋ワザ 4000）');
  ok((await q()).includes('+1 しますか'),'HB01-028: 勝ったので「与えるダメージを+1する」を足すか聞く（「このホロビト」が誰かは印字から分からない）');
  await choose('+1 する');
  ok((await log()).includes('受けるダメージ：2'),'HB01-028: 「+1 する」→ ダメージは2');
  await choose('使わずに手札に');

  // HB01-019 以心電心（HB01-019）: 共鳴：ライガ。HD01-013 と同じ文面で、左辺は +2000
  await setup({hand:['HB01-019'], line:[['HB01-001']], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('以心電心');
  s=await S();
  ok(s.players[0].hand.length===1 && (await log()).includes('自分 7000'),'HB01-019: 共鳴を満たし、1枚引いて 4000＋2000＋1000 ＝ 7000');

  // HB01-029 心斬一転: 使ったとき相手プレイヤーに1ダメージ。ただしトドメは刺せない
  // （バトル自体は負ける組み合わせにして、相手のハートに入るダメージをこの効果の分だけにする）
  await setup({hand:['HB01-029'], line:[['HD01-001']], ena:[R(),R()], heart:H5},{line:[['HB01-001']], heart:H5});
  await battle(); await choose('心斬一転');
  s=await S();
  ok(s.players[1].heart.filter(c=>c.turned).length===1,'HB01-029: 使ったとき、相手のハート（一番上）がダウンする（1ダメージ）');
  // ハートが0枚の相手には、この効果でトドメを刺せない
  await setup({hand:['HB01-029'], line:[['HD01-001']], ena:[R(),R()], heart:H5},{line:[['HB01-001']], heart:[]});
  await battle(); await choose('心斬一転');
  ok((await log()).includes('トドメを刺せない') && (await S()).winner===undefined,'HB01-029: 相手のハートが0枚でも、この効果では勝ちにならない（印字の注記）');

  // 合術 うつし身の撃: このワザは自分がこのバトルで他のワザを使っているときのみ使える／勝ったならダメージ+1
  await setup({hand:['HB01-094'], line:[['HB01-001']], ena:[R(),'HB01-097'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('うつし身');
  ok((await S()).players[0].hand.length===1 && (await log()).includes('使えない') && (await log()).includes('他のワザを使っている'),'うつし身の撃: このバトルでまだワザを使っていなければ使えず、手札に残る（数えて判定）');
  await choose('パス');
  await setup({hand:['PR-013','HB01-094'], line:[['HB01-001']], ena:[R(),R(),'HB01-097','HB01-097'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('電光攻火'); await choose('おすすめ');
  ok((await log()).includes('（赤1・青1）'),'電光攻火（赤・コスト2）は、おすすめで赤1・青1で払う（赤を1枚含めばよい）');
  await choose('うつし身');
  ok((await log()).includes('コスト 2（青）') && (await log()).includes('（青1・赤1）'),'うつし身の撃: 他のワザを使ったあとなら使える → コスト2（青）。残りのエナ（青1・赤1）で払う（色の内訳が1通りなので聞かない）');
  // 2026-11-19 に鮮明な画像で左辺（+4000）が読めたので、パワーを計算できるようになった（以前は結果を聞いていた）
  ok((await log()).includes('自分 13000'),'うつし身の撃: 左辺が読めたので 4000＋電光攻火5000＋うつし身4000 ＝ 13000 を計算する');
  ok((await q()).includes('+1 しますか'),'うつし身の撃: 勝ったので「ダメージを+1する」の条件は満たす。「このホロビト」が誰かは印字から分からないので、足すか聞く');
  await choose('+1 する');
  ok((await log()).includes('受けるダメージ：2') && (await q()).includes('ハートから破壊された') && (await q()).includes('レオまる'),'うつし身の撃: ダメージは2。1ダメージを2回入れるので、一番上のハートがダウンしてから破壊される');
  await choose('使わずに手札に');

  // ===== 第7便（青。HB01-074〜HB01-088）=====
  const B=()=>'HB01-074';   // 青のカード（骸のガシャ）。エナの色を青にするために使う

  // HB01-080 カワエロ: このホロビトがダウンしているなら、このホロビトのパワーを+3000する
  await setup({line:[[{k:'HB01-080',turned:true}]]});
  ok((await badges(0,0)).includes('+3000'),'HB01-080: ダウンしている → +3000 の印が出る');
  await setup({line:[['HB01-080']]});
  ok(!(await badges(0,0)).includes('+3000'),'HB01-080: ダウンしていない → 印は出ない');

  // HB01-088 来たる！ 恐怖の蜘蛛: 破壊されたとき、墓地に置くかわりに自分のエナに未使用で置く
  await setup({line:[[{k:'HB01-088',turned:true}]], heart:H5},{line:[['HB01-001']], heart:H5});
  await battle();
  s=await S();
  ok(!s.players[0].grave.some(c=>c.key==='HB01-088') && s.players[0].ena.some(c=>c.key==='HB01-088'&&!c.turned),
     'HB01-088: ダウン中に負けて破壊された → 墓地ではなく自分のエナに未使用（縦向き）で置かれる');
  await close();

  // HB01-078 ナグレと用心棒ヘッドブル: 出たとき、手札からコスト2以上のワザ1枚を捨ててもよい。
  // そうしたなら、自分のエナを1枚選び、未使用にする
  await setup({line:[['HB01-078']], hand:['HB01-085'], ena:[{k:B(),turned:true},{k:B(),turned:true}]});
  await tap(await top(0,0)); await fxbtn('出たとき');
  pk=await picks();
  ok(pk.length===1,'HB01-078: 出たとき、手札のコスト2以上のワザだけを候補に出す');
  await tap(pk[0]);
  pk=await picks();
  ok(pk.length===2,'HB01-078: 捨てたので「そうしたなら」を満たし、自分のエナを選ばせる');
  await tap(pk[0]);
  s=await S();
  ok(s.players[0].grave.some(c=>c.key==='HB01-085') && s.players[0].ena.filter(c=>!c.turned).length===1,
     'HB01-078: 捨てたワザは墓地へ、選んだエナは未使用（縦向き）になる');
  await close();
  // 捨てなければ、「そうしたなら」を満たさないのでエナは未使用にならない
  await setup({line:[['HB01-078']], hand:['HB01-085'], ena:[{k:B(),turned:true}]});
  await tap(await top(0,0)); await fxbtn('出たとき');
  await p.click('#pickCancel'); await wait(460);
  ok((await S()).players[0].ena.every(c=>c.turned) && (await log()).includes('満たさないため'),
     'HB01-078: 捨てなければ「そうしたなら」を満たさず、エナは未使用にならない');
  await close();

  // HB01-082 闘牛合 ヘッドナグル: バトルが終わったとき、お互いのプレイヤーは自分の墓地のワザを1枚選び、
  // エナに使用済みで置いてもよい
  await setup({line:[['HB01-082']], grave:['HB01-085']},{grave:['HB01-084']});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  pk=await picks();
  ok(pk.length===1,'HB01-082: まず自分の墓地のワザを選ばせる');
  await tap(pk[0]);
  pk=await picks();
  ok(pk.length===1,'HB01-082: 続けて相手の墓地のワザを選ばせる（「お互いのプレイヤーは」）');
  await tap(pk[0]);
  s=await S();
  ok(s.players[0].ena.some(c=>c.key==='HB01-085'&&c.turned) && s.players[1].ena.some(c=>c.key==='HB01-084'&&c.turned),
     'HB01-082: 両方のエナに、選んだワザが使用済み（横向き）で置かれる');
  await close();

  // HB01-087 豆腐ナイスガイ: エナ詠み③（青）→ 出たとき、山札の上から5枚を見て、ワザ1枚を手札に加えてもよい。
  // 残りを好きな順で山札の一番下に置く
  await setup({line:[['HB01-087']], ena:[B(),B(),B()], deck:['HB01-085','HB01-074']});
  await tap(await top(0,0)); await fxbtn('出たとき');
  ok((await opts()).some(t=>t.includes('魂のまにまに')),'HB01-087: 見た5枚の中のワザだけを、手札に加える候補に出す');
  await ans(0);
  await ans(0);   // 残りは見た順のまま一番下へ
  s=await S();
  ok(s.players[0].hand.length===1 && s.players[0].hand[0].key==='HB01-085','HB01-087: 選んだワザが手札に加わる');
  ok(s.players[0].deck.length===11 && s.players[0].deck[0].key!=='HB01-074','HB01-087: 残り4枚は山札の一番下へ（上から6枚目が一番上になる）');
  await close();
  // 青のエナが足りなければ、エナ詠みの効果は発動しない
  await setup({line:[['HB01-087']], ena:[B()], deck:['HB01-085']});
  await tap(await top(0,0)); await fxbtn('出たとき');
  ok((await log()).includes('エナ詠み ③ の条件を満たしていないため発動しない'),'HB01-087: 青のエナが3枚未満 → エナ詠みの条件を満たさず発動しない');
  await close();

  // HB01-085 魂のまにまに: このワザを使ったとき、各プレイヤーは山札の一番上のカードをエナゾーンに使用済みで置く
  await setup({hand:['HB01-085'], line:[[B()]], ena:[B(),B()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('魂のまにまに');
  s=await S();
  ok(s.players[0].ena.length===3 && s.players[1].ena.length===1 && s.players[1].ena[0].turned,
     'HB01-085: 両方のプレイヤーが、山札の一番上を使用済み（横向き）でエナに置く');
  await close();

  // HB01-076 無知の視: このワザは下にあるカードが1枚以下のホロビトのみ使える
  await setup({hand:['HB01-076'], line:[[B(),B(),'HB01-079']], ena:[B()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('無知の視');
  ok((await log()).includes('使えない'),'HB01-076: 下にカードが2枚あるホロビトは使えない（1枚以下のみ）');
  await choose('パス'); await close();

  // HB01-079 義彦と正義の九郎坊: エナ詠み③（青）→ ワザを使っていれば +3000 し、ダブルダメージを得る
  await setup({hand:['HB01-076'], line:[['HB01-079']], ena:[B(),B(),B(),B()], heart:H5},{line:[['HB01-001']], heart:H5});
  await battle(); await choose('無知の視');
  ok((await log()).includes('自分 10000'),'HB01-079: ワザを使ったので 4000＋ワザ3000＋効果3000 ＝ 10000');
  s=await S();
  ok(s.players[1].heart.filter(c=>c.turned).length===0 && s.players[1].heart.length===4,
     'HB01-079: 効果で得たダブルダメージで、相手のハートが1枚破壊される（1ダメージ×2）');
  await close();

  // HB01-077 山姥ヤマヒメ: バトルが終わったとき、このバトルで使われていたコスト1のワザを1枚選ぶ。
  // 「次のラインに使ってもよい」は未確定のため処理しない
  await setup({hand:['HB01-076'], line:[['HB01-077']], ena:[B()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('無知の視');
  ok((await log()).includes('無知の視 を選んだ')||(await opts()).some(t=>t.includes('無知の視')),'HB01-077: バトルが終わったとき、このバトルで使われたコスト1のワザを選ばせる');
  if((await opts()).some(t=>t.includes('無知の視'))) await choose('無知の視');
  ok((await log()).includes('シミュレーターでは処理しません'),'HB01-077: 「次のラインに使ってもよい」は未確定のため処理せず、手で処理するよう案内する');
  await close();
  // バトルで破壊されたら発動しない: 「バトルが終わったとき」の効果を発動するのは、そのときラインにいるホロビトだけ（総合ルール 6.3.2.12）。
  // 破壊（ホロビトへのダメージ 6.3.2.10）はその前に済んでいる
  await setup({hand:['HB01-076'], line:[[{k:'HB01-077',turned:true}]], ena:[B()], heart:H5},{line:[['HB01-061']], heart:H5});   // 4500+3000 は 巨ダマ 18000 に負ける
  await battle(); await choose('無知の視');
  s=await S();
  ok(s.players[0].grave.some(c=>c.key==='HB01-077') && (await log()).includes('「山姥ヤマヒメ」はもうラインの一番上にいないので') &&
     !(await log()).includes('無知の視 を選んだ') && !(await opts()).some(t=>t.includes('無知の視')),
     'HB01-077: ダウン中に負けて破壊されたら、「バトルが終わったとき」は発動しない（総合ルール 6.3.2.12）');
  await close();

  // HB01-081 カッパダイバー / HB01-083 三味線鬼灯とMCガシャ: ダブルダメージ
  for(const k of ['HB01-081','HB01-083']){
    await setup({line:[[k]]});
    ok((await badges(0,0)).includes('ダブルダメージ'),k+': ダブルダメージの印が出る');
  }

  // HB01-075 石の上にも三念: エナ詠み③（青）→ このバトルが終わったとき、自分のエナを1枚選び、未使用にする
  await setup({hand:['HB01-075'], ena:[{k:B(),turned:true},{k:B(),turned:true},{k:B(),turned:true}]});
  await tap((await S()).players[0].hand[0].uid); await fxbtn('バトルが終わったとき');
  pk=await picks();
  ok(pk.length===3,'HB01-075: 青のエナが3枚 → エナ詠みを満たし、自分のエナを選ばせる');
  await tap(pk[0]);
  ok((await S()).players[0].ena.filter(c=>!c.turned).length===1,'HB01-075: 選んだエナが未使用（縦向き）になる');
  await close();
  await setup({hand:['HB01-075'], ena:[{k:B(),turned:true}]});
  await tap((await S()).players[0].hand[0].uid); await fxbtn('バトルが終わったとき');
  ok((await log()).includes('エナ詠み ③ の条件を満たしていないため発動しない'),'HB01-075: 青のエナが3枚未満 → 発動しない');
  await close();

  // ===== 第8便（青。HB01-089〜HB01-099）=====

  // HB01-089 斬ムクロ: 手札が6枚以上あるなら、このホロビトのパワーを+6000する
  await setup({line:[['HB01-089']], hand:[B(),B(),B(),B(),B(),B()]});
  ok((await badges(0,0)).includes('+6000'),'HB01-089: 手札が6枚 → +6000 の印が出る');
  await setup({line:[['HB01-089']], hand:[B(),B(),B(),B(),B()]});
  ok(!(await badges(0,0)).includes('+6000'),'HB01-089: 手札が5枚 → 印は出ない');

  // HB01-090 船長イクチ: 出たとき、各プレイヤーは山札の一番上のカードをエナゾーンに使用済みで置く
  await setup({line:[['HB01-090']]});
  await tap(await top(0,0)); await fxbtn('出たとき');
  s=await S();
  ok(s.players[0].ena.length===1 && s.players[0].ena[0].turned && s.players[1].ena.length===1,
     'HB01-090: 出たとき、両方のプレイヤーが山札の一番上を使用済みでエナに置く');
  await close();

  // HB01-091 滅獣 九郎坊: 出たとき、両隣のラインにいる自分のホロビト1体を選び、位置を入れ替えてもよい
  await setup({line:[[B()],['HB01-091'],[B()],['HB01-074']]});
  await tap(await top(0,1)); await fxbtn('出たとき');
  pk=await picks();
  ok(pk.length===2,'HB01-091: 両隣（第1・第3ライン）のホロビトだけを候補に出す（第4ラインは候補にしない）');
  await tap(pk[1]);
  await choose('一番上のカードだけ入れ替える').catch(async()=>{});
  s=await S();
  ok(s.players[0].line[1][0].key==='HB01-074x'||s.players[0].line[2][0].key==='HB01-091'||s.players[0].line[1][0].key!=='HB01-091',
     'HB01-091: 選んだホロビトと位置が入れ替わる');
  await close();

  // HB01-092 脅合 三本タダタラ: ダウンしたとき、このカードを手札に戻す（この下にあるカードはラインに残る）
  await setup({line:[[B(),'HB01-092']]});
  await tap(await top(0,0)); await fxbtn('ダウンしたとき');
  s=await S();
  ok(s.players[0].hand.some(c=>c.key==='HB01-092') && s.players[0].line[0].length===1 && s.players[0].line[0][0].key===B(),
     'HB01-092: 一番上のこのカードだけ手札に戻り、下のカードはラインに残る');
  await close();

  // HB01-093 八参る 鬼灯&ガシャ: バトルが始まったとき、自分のエナのコスト3以下の青のワザ1枚を選び、使用してもよい
  await setup({line:[['HB01-093']], ena:['HB01-085','HB01-074']});
  await tap(await top(0,0)); await fxbtn('バトルが始まったとき');
  pk=await picks();
  ok(pk.length===1,'HB01-093: エナのコスト3以下の青のワザだけを候補に出す（ホロビトは候補にしない）');
  await tap(pk[0]);
  ok((await log()).includes('シミュレーターでは処理しません'),'HB01-093: 「使用してもよい」はエナから使う経路が未実装のため、手で処理するよう案内する');
  await close();

  // HB01-095 行くも・ザ・ループ: バトルが終わったとき、このカードを手札に戻す
  await setup({waza:['HB01-095']});
  await tap((await S()).players[0].waza[0].uid); await fxbtn('バトルが終わったとき');
  ok((await S()).players[0].hand.some(c=>c.key==='HB01-095'),'HB01-095: バトルが終わったとき、ワザゾーンから手札に戻る');
  await close();

  // HB01-096 秩序の守り手 九郎坊&義彦: 自分が召喚フェイズを終えたとき、墓地のコスト1のワザを1枚選び、手札に戻してもよい
  await setup({line:[['HB01-096']], grave:['HB01-094','HB01-084']});
  await tap(await top(0,0)); await fxbtn('召喚フェイズを終えたとき');
  pk=await picks();
  ok(pk.length===1,'HB01-096: 墓地のコスト1のワザだけを候補に出す（コスト2の うつし身の撃 は候補にしない）');
  await tap(pk[0]);
  await ans(0);
  ok((await S()).players[0].hand.some(c=>c.key==='HB01-084'),'HB01-096: 選んだワザが手札に戻る');
  await close();
  // フェイズ送りでも発動する
  await setup({line:[['HB01-096']], grave:['HB01-084']});
  await p.evaluate(()=>{ state.phase=0; state.first=0; render(); });
  await p.click('#btnPhase'); await wait(600);
  ok((await log()).includes('自分が召喚フェイズを終えた'),'HB01-096: フェイズ送りで召喚フェイズを終えたときに発動する');
  await close();

  // HB01-098 大河童 ガタラ: ダウンしているハートがあるなら +4000／勝ったとき、あるなら回復、なければハートを増やす
  await setup({line:[['HB01-098']], heart:[{k:B(),up:false,turned:true},{k:B(),up:false}]});
  ok((await badges(0,0)).includes('+4000'),'HB01-098: 自分にダウンしているハートがある → +4000 の印が出る');
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  s=await S();
  ok(s.players[0].heart.every(c=>!c.turned) && s.players[0].heart.length===2,'HB01-098: ダウンしているハートがあるなら回復する（ハートは増えない）');
  await close();
  await setup({line:[['HB01-098']], heart:[{k:B(),up:false}]});
  ok(!(await badges(0,0)).includes('+4000'),'HB01-098: ダウンしているハートがない → 印は出ない');
  await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
  s=await S();
  ok(s.players[0].heart.length===2 && s.players[0].heart[1].turned,'HB01-098: ダウンしているハートがなければ、山札の上から1枚をダウンさせてハートに加える');
  await close();

  // HB01-099 滅獣 ガシャドクロ: バトルが終わったとき、エナを全て未使用にし、その後4枚選んで使用済みにする
  await setup({line:[['HB01-099']], ena:[{k:B(),turned:true},{k:B(),turned:true},{k:B(),turned:true},{k:B(),turned:true},{k:B(),turned:true},{k:B(),turned:true}]});
  await tap(await top(0,0)); await fxbtn('バトルが終わったとき');
  for(let i=0;i<4;i++){ pk=await picks(); ok(pk.length===6-i,'HB01-099: '+(i+1)+'枚目を選ばせる（残り '+(6-i)+' 枚から）'); await tap(pk[0]); }
  s=await S();
  ok(s.players[0].ena.filter(c=>c.turned).length===4 && s.players[0].ena.filter(c=>!c.turned).length===2,
     'HB01-099: 全て未使用にしたあと、選んだ4枚が使用済みに戻る');
  await close();

  // ===== 第9便（PR 系。PR-002〜PR-037）=====

  // PR-004 弾田ダンクとバケゾウリ: 破壊されたとき、カードを1枚引く（第8便で足した「破壊されたとき」を使う）
  await setup({line:[[{k:'PR-004',turned:true}]], heart:H5},{line:[['HB01-001']], heart:H5});
  await battle();
  ok((await hand(0))===1 && (await S()).players[0].grave.some(c=>c.key==='PR-004'),'PR-004: ダウン中に負けて破壊され、カードを1枚引く');
  await close();

  // PR-005 運命の出会い レオとジン: このホロビトにブーストを使ったとき、カードを1枚引く
  await setup({hand:['HD01-001'], line:[['PR-005']], ena:[R(),R()], heart:H5},{line:[['HB01-001']], heart:H5});
  await battle(); await choose('ブースト');
  ok((await log()).includes('ブーストを使った'),'PR-005: ブーストを使ったときの効果が発動する');
  s=await S();
  ok(s.players[0].hand.length===1,'PR-005: カードを1枚引く（使ったブーストは手札から出ている）');
  await close();

  // PR-006 お出迎え 七尾とヒナタ: バトルに負けてもダメージを受けない（自分のハートは受ける）
  await setup({line:[['PR-006']], heart:H5},{line:[['HB01-001']], heart:H5});
  await battle();
  s=await S();
  ok(!s.players[0].line[0][0].turned && (await log()).includes('負けてもダメージを受けない'),'PR-006: 負けてもダウンしない');
  ok(s.players[0].heart.some(c=>c.turned),'PR-006: 自分のハートはダメージを受ける（印字の注記）');
  await close();

  // PR-031 送り犬 クロシバ: このホロビトのバトル中、正面のホロビトはブーストを使えない
  await setup({hand:['HD01-001'], line:[['HB01-001']], ena:[R(),R()], heart:H5},{line:[['PR-031']], heart:H5});
  await battle();
  ok(!(await opts()).some(t=>t.includes('ブースト')),'PR-031: 正面にいるとき、相手はブーストを選べない');
  await close();

  // PR-032 翅けげん: 出たとき、相手のホロビトのみがいるラインを1つ選び、移動してもよい
  await setup({line:[['PR-032']]},{line:[[],[B()],[B()]]});
  await tap(await top(0,0)); await fxbtn('出たとき');
  ok((await opts()).some(t=>t.includes('第2ライン')) && (await opts()).some(t=>t.includes('第3ライン')),'PR-032: 相手のホロビトのみがいるラインだけを候補に出す');
  await ans(0); await ans(0);
  ok((await S()).players[0].line[1].some(c=>c.key==='PR-032'),'PR-032: 選んだラインへ移動する');
  await close();

  // PR-033 一本ダタラ: 出たとき、各プレイヤーはハートを回復する
  await setup({line:[['PR-033']], heart:[{k:B(),up:false,turned:true}]},{heart:[{k:B(),up:false,turned:true}]});
  await tap(await top(0,0)); await fxbtn('出たとき');
  s=await S();
  ok(s.players[0].heart.every(c=>!c.turned) && s.players[1].heart.every(c=>!c.turned),'PR-033: 両方のプレイヤーのダウンしているハートが回復する');
  await close();

  // PR-034 童子危うきに近寄らず: 勝ったとき、正面のホロビトはこのラウンド中効果を失う
  await setup({hand:['PR-034'], line:[['HB01-083']], ena:[B(),B()], heart:H5},{line:[['HB01-073']], heart:H5});
  ok((await badges(1,0)).includes('ダブルダメージ'),'PR-034: 効果を失う前は、正面のダブルダメージの印が出ている');
  await battle(); await choose('童子危うきに近寄らず');
  ok((await log()).includes('効果を失う'),'PR-034: バトルに勝ったので、正面のホロビトがこのラウンド中 効果を失う');
  ok(!(await badges(1,0)).includes('ダブルダメージ'),'PR-034: 効果を失ったので、印が出なくなる');
  await close();

  // PR-010 弾合 ダンゾウ: このホロビトにはオーバービートできない（読点のない印字）
  await setup({line:[['PR-010']]});
  ok((await badges(0,0)).includes('オーバービートされない'),'PR-010: 読点のない印字でも「オーバービートされない」の印が出る');

  // PR-011 合身 レオジン: 自分のホロビトが4体以上いるなら +3000
  await setup({line:[['PR-011'],[R()],[R()],[R()]]});
  ok((await badges(0,0)).includes('+3000') && (await badges(0,0)).includes('ダブルダメージ'),'PR-011: 4体いるので +3000。「2ダメージ与える」の印字でもダブルダメージの印が出る');
  await setup({line:[['PR-011'],[R()]]});
  ok(!(await badges(0,0)).includes('+3000'),'PR-011: 2体では +3000 の印は出ない');

  // ---- 盤面の印だけで確かめるもの（文面は HB01 の同じ効果で確かめてある）----
  for(const [k,b] of [['PR-009','ダブルダメージ'],['PR-023','ダブルダメージ'],['PR-035','ダブルダメージ'],['PR-018','1バリア']]){
    await setup({line:[[k]]});
    ok((await badges(0,0)).includes(b),k+': '+b+' の印が出る');
  }
  // PR-025 合身 不死火翔: ダブルダメージ／下にカードが2枚以上あるなら +2000
  await setup({line:[[B(),B(),'PR-025']]});
  ok((await badges(0,0)).includes('+2000') && (await badges(0,0)).includes('ダブルダメージ'),'PR-025: 下に2枚あるので +2000。ダブルダメージの印も出る');
  await setup({line:[['PR-025']]});
  ok(!(await badges(0,0)).includes('+2000'),'PR-025: 下にカードがなければ +2000 の印は出ない');
  // PR-016 ソロキャンしなずいさま: ブーストを使っているなら パワーは+2000される
  await setup({line:[['PR-016']]});
  ok(!(await badges(0,0)).includes('+2000'),'PR-016: ブーストを使っていなければ印は出ない');
  // PR-028 ジンと奮雷するレオ: エナ詠み③（赤）→ ダウンしていないなら +3000
  await setup({line:[['PR-028']], ena:[R(),R(),R()]});
  ok((await badges(0,0)).includes('+3000'),'PR-028: 赤のエナが3枚でダウンしていない → +3000 の印が出る');
  await setup({line:[['PR-028']], ena:[R()]});
  ok(!(await badges(0,0)).includes('+3000'),'PR-028: 赤のエナが足りなければ印は出ない');
  // PR-030 義彦と正義の九郎坊: エナ詠み③（青）→ ワザを使っていれば +3000・ダブルダメージ
  await setup({line:[['PR-030']], ena:[B(),B(),B()]});
  ok(!(await badges(0,0)).includes('+3000'),'PR-030: ワザを使っていなければ印は出ない');

  // ---- 発動のきっかけを押して確かめるもの ----
  // PR-008 ベトベトくん / PR-022 やっほー！ イロハとジャンボ: バトルに勝ったとき1枚引く
  for(const k of ['PR-008','PR-022']){
    await setup({line:[[k]]});
    await tap(await top(0,0)); await fxbtn('バトルに勝ったとき');
    ok((await hand(0))===1,k+': バトルに勝ったとき → 1枚引く（正面にいなくても発動する）');
    await close();
  }
  // PR-015 炎の不死火 / PR-020 必然の出会い 不死火とショウ: オーバービートされるとき、ダウンしているなら1枚引く
  for(const k of ['PR-015','PR-020']){
    await setup({line:[[{k,turned:true}]]});
    await tap(await top(0,0)); await fxbtn('オーバービートされるとき');
    ok((await hand(0))===1,k+': ダウン中にオーバービートされる → 1枚引く');
    await close();
    await setup({line:[[k]]});
    await tap(await top(0,0)); await fxbtn('オーバービートされるとき');
    ok((await hand(0))===0,k+': ダウンしていなければ引かない');
    await close();
  }
  // PR-029 ショウと夜に翔ける不死火: エナ詠み③（緑）→ 出たとき、手札のコスト7以上を見せたら1枚引く
  await setup({line:[['PR-029']], hand:['HB01-064'], ena:['HB01-064','HB01-064','HB01-064']});
  await tap(await top(0,0)); await fxbtn('出たとき');
  pk=await picks();
  ok(pk.length===1,'PR-029: 手札のコスト7以上のホロビトだけを候補に出す');
  await tap(pk[0]);
  ok((await hand(0))===2,'PR-029: 見せたので1枚引く（見せたカードは手札に残る）');
  await close();
  // PR-036 おぼろ車: 出たとき、相手のホロビトを選び、正面と入れ替えてもよい
  await setup({line:[['PR-036']]},{line:[[R()],[R()]]});
  await tap(await top(0,0)); await fxbtn('出たとき');
  pk=await picks();
  ok(pk.length===2,'PR-036: 相手のホロビトを選ばせる');
  await tap(pk[1]); await ans(0);
  ok((await S()).players[1].line[0][0].uid!==undefined && (await log()).includes('入れ替え'),'PR-036: 正面のホロビトと入れ替える');
  await close();

  // ---- バトルで使うワザ ----
  // PR-012 快復祈願: 使ったとき、このホロビトを回復する
  await setup({hand:['PR-012'], line:[[{k:'HB01-001',turned:true}]], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('快復祈願');
  ok(!(await S()).players[0].line[0][0].turned,'PR-012: 使ったとき、ダウンしていたホロビトが回復する');
  await close();
  // PR-014 雷風怒濤 / PR-027 長距離、葬！: 勝ったなら与えるダメージを+1する
  // PR-027 は緑のワザなので、エナも緑（HB01-061）にする
  for(const [k,nm2,col] of [['PR-014','雷風怒濤',R()],['PR-027','長距離','HB01-061']]){
    await setup({hand:[k], line:[['HB01-064']], ena:[col,col,col], heart:H5},{line:[['HD01-001']], heart:H5});
    await battle(); await choose(nm2);
    ok((await q()).includes('+1 しますか'),k+': 勝ったので「ダメージを+1する」を足すか聞く');
    await choose('+1 する');
    ok((await log()).includes('受けるダメージ：3')||(await log()).includes('受けるダメージ：2'),k+': ダメージが+1される');
    await close();
  }
  // PR-037 以心電心: 共鳴：ライガ → 使ったとき1枚引く／このワザのパワーを+1000する
  await setup({hand:['PR-037'], line:[['HB01-001']], ena:[R()], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle(); await choose('以心電心');
  ok((await hand(0))===1 && (await log()).includes('自分 7000'),'PR-037: 共鳴（ライガ）を満たし、1枚引いて 4000＋2000＋1000 ＝ 7000');
  await close();

  // ---- PR-038 紅合身 レオジン ----
  // 「ファミリー」が何を指すかは印字から決まらない（rules_guess.md B-8）。決めつけずに聞く／人に選ばせる
  // 自分のラインに他のホロビトがいなければ、どう読んでも条件を満たさない → 聞かずに 5000 のまま
  await setup({line:[['PR-038']], hand:['HB01-001','HD02-001','HB01-061'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle();
  ok((await log()).includes('自分 5000'),'PR-038: 自分のラインに他のホロビトがいないので +2000 しない（聞かない）');
  // 勝ったとき: 手札のコスト2以下のホロビトを、種族で絞らずに光らせ、何を指すかが未確定だと示す
  pk=await picks();
  const msg038=await p.textContent('#pickmsg');
  ok(pk.length===2 && msg038.includes('印字からは決まっていない') && msg038.includes('スザク・ブラッド') && msg038.includes('ライガ・ファミリー'),
     'PR-038: 勝ったとき、コスト2以下のホロビト（雷獣 レオ・しなずいさま）を光らせ、「ファミリー」が未確定であることと候補の種族を示す');
  await tap((await S()).players[0].hand.find(c=>c.key==='HB01-001').uid);
  s=await S();
  ok(s.players[0].line[1].length===1 && s.players[0].line[1][0].key==='HB01-001' && !s.players[0].ena.length,'PR-038: 選んだホロビトが第2ラインに出る（コストは支払わない）');
  await close();
  // 自分のラインに他のホロビトがいれば聞く。「満たしている」なら 5000＋2000＝7000
  await setup({line:[['PR-038'],['HB01-001']], hand:['HD02-001'], heart:H5},{line:[['HD01-001']], heart:H5});
  await battle();
  ok((await q()).includes('ファミリー') && (await q()).includes('雷獣 レオ（種族: ライガ・ファミリー）'),'PR-038: 自分のラインに他のホロビトがいるときは、他のホロビトと種族を示して聞く');
  await choose('満たしている');
  ok((await log()).includes('自分 7000'),'PR-038: 「満たしている」→ 5000＋2000＝7000');
  await p.click('#pickCancel'); await wait(460);
  ok((await log()).includes('出さなかった'),'PR-038: 手札から出すのはやめられる（任意）');
  await close();

  ok(errs.length===0,'JSエラーなし '+errs.join(' | '));
  await b.close();
  await H.finish();
})();
