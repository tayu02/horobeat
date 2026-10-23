// オンライン対戦（依頼者の指示 2026-10-22。A: 公開したシミュレーターのまま。データからも手札を隠す）
// 2つのブラウザの画面（別々の端末のつもり。保存も別）を、試験の中継でつなぐ。中継は、公開したシミュレーターの
// データの保存（db）と同じように、書いたものを両方の画面に届け、あとから開いた画面には最新を渡す。
// 部屋を作る → コードで入る → 先手を選んで始める → 相手の引き直しは相手の画面に出る（読み込み直しても出る）→ ⑥のエナの中身が届く →
// 番でない側は触れない → 番を渡す → 読み込み直しても続きから → 両方を AI に任せて最後まで →
// 相手の手札・山札・ハートの中身は、送られたものにも画面の中にも一度も入らない → 両方の盤面が一致 → やめると1人の盤面に戻る
const H = require('./harness.cjs');
const { devices, ok } = H;
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms){ const t0 = Date.now(); while (Date.now() - t0 < (ms || 5000)){ if (await fn()) return true; await wait(40); } return false; }

// 試験の中継。msgs に、送られたものをすべて残す（中身が漏れていないかを後で調べる）
function relay(){
  const R = { docs:{}, msgs:[], pages:[], q:new Map(), errs:[] };
  // 受け取った画面の中で起きたエラーも数える（読み込み直している最中に届かなかったものは、開き直したときに最新を受け取る）
  R.deliver = (p, path, data) => {
    const n = (R.q.get(p) || Promise.resolve()).then(() => p.evaluate(([a, d]) => { if (window.__olNetRecv) window.__olNetRecv(a, d); }, [path, data]))
      .catch(e => { if (!/context was destroyed|Target .*closed|navigat/i.test(String(e))) R.errs.push(path + ': ' + String(e).split('\n').slice(0, 3).join(' ')); });
    R.q.set(p, n);
  };
  R.attach = async (p, who) => {
    await p.exposeFunction('__olNetSet', (path, data) => {
      R.docs[path] = data; R.msgs.push({ who, path, data });
      R.pages.forEach(x => R.deliver(x, path, data));
    });
    await p.exposeFunction('__olNetGet', path => R.docs[path] || null);
    R.pages.push(p);
  };
  return R;
}
// 送られたものに、伏せたカードの中身が入っていないか
const HIDDEN = ['hand', 'deck', 'heart'];
function leaks(R){
  const bad = [], reqs = {}, revealed = new Set();
  const cards = (P, fn) => { ['hand', 'deck', 'heart', 'ena', 'waza', 'grave'].forEach(z => P[z].forEach(c => fn(c, z))); P.line.forEach(st => st.forEach(c => fn(c, 'line'))); };
  R.msgs.forEach(m => {
    const d = m.data;
    if (/^games\/[^/]+$/.test(m.path)){
      d.s.players.forEach((P, pi) => {
        if ('decklist' in P) bad.push('デッキの中身を送った（' + m.who + '）');
        cards(P, (c, z) => {
          if (c.key && (HIDDEN.includes(z) || !c.up)) bad.push(m.who + ' が ' + z + ' の ' + c.uid + ' の中身を送った');
          if (c.key) revealed.add(c.uid);
        });
      });
    } else if (/\/seat\//.test(m.path)){
      if (d.deck.some(c => c.key)) bad.push('部屋に入るときに山札の中身を送った');
    } else if (/\/rpc\/req/.test(m.path)){
      reqs[d.seq] = d;
    } else if (/\/rpc\/res/.test(m.path)){
      const q = reqs[d.seq] || {}, k = q.kind, r = d.data || {};
      const keyed = [].concat(r.key ? [r.key] : [], r.use && r.use.key ? [r.use.key] : [], Object.values(r.keys || {}));
      if ((k === 'mull' || k === 'pick') && keyed.length) bad.push(k + ' の答えにカードの中身が入っている');
      if (k === 'heart' && r.key && !r.use) bad.push('トリガーを使わないハートの中身を送った');
      if (keyed.length > 6) bad.push(k + ' の答えに中身が多すぎる（' + keyed.length + '）');
      if (r.uid && r.key) revealed.add(r.uid);
      if (k === 'heart' && r.use && r.key) revealed.add(q.data.uid);   // トリガーを使ったハート（ラストオーバーT は公開して手札に加える）
      if (r.use && r.use.key) revealed.add(r.use.uid);
      Object.keys(r.keys || {}).forEach(u => revealed.add(u));
    }
  });
  return { bad, revealed };
}

// 画面の中: 相手のカードの中身を持っていないか（山札・ハート・裏向きは必ず空。手札は見せられたものだけ）
const inner = p => p.evaluate(() => {
  const mine = ol.host ? 'A-' : 'B-', opp = ol.host ? 'B-' : 'A-', bad = [], handKeys = [];
  state.players.forEach((P, pi) => olEachCard(P, (c, z) => {
    if (!c.uid.startsWith(pi ? opp : mine) || c.owner !== pi) bad.push('側が違う ' + c.uid);
    if (pi === 1 && c.key){
      if (z === 'deck' || z === 'heart' || (!c.up && z !== 'hand')) bad.push(z + ' ' + c.uid);
      if (z === 'hand') handKeys.push(c.uid);
    }
  }));
  if (Object.keys(ol.priv).some(u => !u.startsWith(mine))) bad.push('控えに相手のカード');
  if (state.players[1].decklist && Object.keys(state.players[1].decklist).length) bad.push('相手のデッキの中身');
  return { bad, handKeys };
});

// 試験で、自分の側を AI に任せる（両方の画面で）。ルールが未確定でシミュレーターが聞くことは、ai-bench と同じく最初の選択肢で答える。
// 捨てる先（未確定）は墓地。ワザ・ブーストは、同じバトルで2回目の「使わない」を選んだら使用を終える（両方が AI だと誰も「終える」を押さないため）
function aiInstall(){
  AI_DELAY = 0; aiForce = { 0:"normal" };
  if (window.__drv) return;
  var orig = openCardSheet;
  openCardSheet = function(uid, pi, force, after){
    if (force){ var f = findCard(uid); if (f) moveCard(uid, f.card.owner, "grave"); if (after) setTimeout(after, 0); return; }
    return orig.apply(null, arguments);
  };
  var ow = aiWazaChoice, passes = {};
  aiWazaChoice = function(p, acts, oppCan){
    var i = ow(p, acts, oppCan), k = ol.gid + "-" + state.round + "-" + (state.battle && state.battle.line);
    if (i === acts.length && oppCan){ passes[k] = (passes[k] || 0) + 1; if (passes[k] >= 2) return acts.length + 1; }
    return i;
  };
  window.__drv = setInterval(function(){
    if (!ol.on || state.winner !== undefined || !olHolder() || ol.wait || aiBusy || aiTimer) return;
    if (fxAsk){ var a = fxAsk; fxAsk = null; closeSheet(); a.cb(0); return; }
    if (picking){ var pk = picking, u = Object.keys(pk.set)[0]; picking = null; pk.pick(u); return; }
    if (sheetWrap.classList.contains("on")){ closeSheet(); render(); return; }
    if (state.phase === 2 && state.battle){ battleRun(); return; }
    if (state.phase === 2 || state.phase === 3){ snap(); nextPhase(); render(); return; }
    aiKick();
  }, 25);
}

// 両方の画面で勝敗が決まるまで待つ。途中で、両方の画面の中身を調べる（samples に足す）
async function playOut(A, B, samples){
  const ev = (p, f, x) => p.evaluate(f, x);
  const t0 = Date.now(); let lastV = -1, still = 0, done = false;
  while (Date.now() - t0 < 180000){
    await wait(300);
    const [a, b] = await Promise.all([inner(A), inner(B)]);
    samples.push(a, b);
    const s = await ev(A, () => ({ w:state.winner, v:ol.ver }));
    if (s.w !== undefined && await ev(B, () => state.winner !== undefined)){ done = true; break; }
    if (s.v === lastV){ if (++still > 40) break; } else { still = 0; lastV = s.v; }
  }
  if (!done){
    const why = await Promise.all([A, B].map(p => ev(p, () => JSON.stringify({ holder:olHolder(), wait:ol.wait && ol.wait.kind, phase:state.phase, round:state.round, battle:state.battle && state.battle.stage, fxAsk:!!fxAsk, picking:!!picking, log:fxLines.slice(-4) }))));
    console.log('  止まった: A ' + why[0] + '\n           B ' + why[1]);
  }
  const fin = await Promise.all([A, B].map(p => ev(p, () => ({ w:state.winner, r:state.round, n:ol.ver }))));
  await wait(300);
  const same = await ev(A, () => JSON.stringify(olToShared(state))) === await ev(B, () => JSON.stringify(olToShared(state)));
  return { done, fin, same, ok: done && (fin[0].w === 0 || fin[0].w === 1) && fin[1].w === 1 - fin[0].w };
}

async function run(label, viewport, touch){
  console.log('\n=== ' + label + ' ===');
  const b = await H.launch();
  const R = relay();
  const mk = async who => {
    const ctx = await b.newContext({ ...(touch ? devices['iPhone 13'] : {}), viewport, hasTouch:!!touch, isMobile:!!touch });
    const p = await ctx.newPage(); H.watch(p, label + ' ' + who);
    p.__errs = []; p.on('pageerror', e => p.__errs.push(String(e)));
    await R.attach(p, who); await p.goto(H.URL);
    return p;
  };
  const A = await mk('A'), B = await mk('B');
  H.watch(A, label);
  const ev = (p, f, x) => p.evaluate(f, x);
  const flow = p => p.textContent('#flow');
  const sheet = p => p.evaluate(() => sheetWrap.classList.contains('on') ? document.getElementById('sheet').textContent : '');
  const tapSheet = async (p, sel) => { await p.waitForSelector('#sheet ' + sel); await wait(450); await p.click('#sheet ' + sel); };

  // 1人で遊んでいた盤面（やめたら戻る）
  await ev(A, () => { loadStarter(0, 'HB-SD01'); loadStarter(1, 'HB-SD02'); render(); });
  await ev(B, () => { loadStarter(0, 'HB-SD02'); loadStarter(1, 'HB-SD01'); render(); });
  const offA = await ev(A, () => JSON.stringify(state));
  ok(await ev(A, () => !!ol.net && !ol.on) && (await A.textContent('#btnOnline')).includes('対戦'), 'つなぐ部分が見つかり、ヘッダーに「🌐 対戦」が出る');

  // ---- 部屋を作る ----
  await A.click('#btnOnline'); await tapSheet(A, 'button[data-ol="create"]');
  const gid = await ev(A, () => ol.gid);
  ok(/^[A-Z0-9]{6}$/.test(gid) && (await A.textContent('#btnOnline')).includes(gid), '部屋を作ると6文字のコードができ、ヘッダーに出る（' + gid + '）');
  ok((await sheet(A)).includes(gid) && (await sheet(A)).includes('相手が入るのを待っています'), '部屋のシートにコードと「相手が入るのを待っています」');
  await tapSheet(A, 'button[data-close="1"]');
  ok((await flow(A)).includes('相手が部屋に入るのを待っています'), '入るまでは「相手が部屋に入るのを待っています」');

  // ---- コードで入る ----
  await B.click('#btnOnline'); await B.waitForSelector('#olCode'); await wait(450);
  await B.fill('#olCode', gid.toLowerCase()); await B.click('#sheet button[data-ol="join"]');
  ok(await until(async () => (await flow(B)).includes('相手が始めるのを待っています')), '部屋に入った側は「相手が始めるのを待っています」（小文字のコードでも入れる）');
  ok(await until(async () => (await sheet(A)).includes('相手が入りました')), '作った側に、相手が入ったことと「先手を選んで始める」が出る');
  const seat = R.docs['games/' + gid + '/seat/guest'];
  ok(seat && seat.deck.length === await ev(B, () => DECK_SIZE) && seat.deck.every(c => c.key === null && /^B-[A-Z0-9]{6}$/.test(c.uid)), '入るときに送る山札は' + seat.deck.length + '枚の番号だけ（中身なし。番号はでたらめ）');

  // ---- 先手を選んで始める → 相手の引き直しは相手の画面に出る ----
  await tapSheet(A, 'button[data-ol="start"][data-first="0"]');
  ok(await until(async () => (await sheet(B)).includes('引き直しますか')), '始めると、相手（入った側）の画面に「④引き直しますか？」が出る');
  ok((await flow(A)).includes('相手が選んでいます'), '作った側は「相手が選んでいます…」');
  ok(await ev(B, () => state.players[0].hand.length === 6 && state.players[0].hand.every(c => c.key) && state.players[1].hand.length === 6 && state.players[1].hand.every(c => !c.key)),
     '入った側の画面: 自分の手札6枚は中身がある。相手の手札6枚は中身がない');
  ok(await ev(B, () => state.first === 1) && (await ev(A, () => state.first === 0)), '先手は作った側（入った側の画面では「相手が先手」。左右を入れ替えて自分を下に描く）');
  ok(await ev(A, () => document.querySelectorAll('#side-1 .z-hand .card.hid').length === 6 && !document.querySelector('#side-1 .z-hand .card:not(.hid)')), '相手の手札は伏せて描く（6枚）');
  // 読み込み直しても、質問がまた出る
  await B.reload();
  ok(await until(async () => (await sheet(B)).includes('引き直しますか')), '入った側が読み込み直しても、部屋に戻り、引き直しの質問がまた出る');
  ok(await ev(B, () => ol.on && !ol.host && state.players[0].hand.every(c => c.key)), '読み込み直したあとも、自分の手札の中身が分かる（自分の端末の控えから）');
  await tapSheet(B, 'button[data-fxa="1"]');   // このまま
  ok(await until(() => ev(A, () => state.players[1].mull === 'keep' && !ol.wait)), '相手の答え（このまま）が作った側に届く');
  ok(await until(async () => (await flow(B)).includes('相手の番です') || (await flow(B)).includes('自分：このまま')), '入った側は、自分の答えのあとは相手の番の表示');
  await A.click('#flow button[data-prep="mull"][data-pi="0"][data-redraw="1"]');
  ok(await until(() => ev(A, () => state.phase === 0 && state.players[1].ena.length === 1 && !!state.players[1].ena[0].key && !ol.wait)),
     '⑤⑥のあと、相手の⑥のエナ（表向き）の中身は相手の端末から届く');
  ok(await until(() => ev(B, () => state.phase === 0 && state.players[1].ena.length === 1 && !!state.players[1].ena[0].key && state.players[0].heart.length === 5)), '入った側にも準備完了の盤面が届く');
  ok(await ev(A, () => state.players[1].heart.every(c => !c.key) && state.players[1].deck.every(c => !c.key)), '相手のハート・山札の中身は届かない');
  ok(await until(async () => (await B.textContent('#fxlog')).includes('相手：④引き直した') && (await B.textContent('#fxlog')).includes('自分：④引き直さない')),
     '記録は相手の向きに直して届く（作った側の「自分：引き直した」→「相手：引き直した」）');
  ok(!(await B.textContent('#fxlog')).match(/「[^」]*」を手札/), '記録に、相手の手札のカード名は出ない');

  // ---- 番でない側は触れない ----
  ok((await flow(B)).includes('相手の番です') && await ev(B, () => document.getElementById('btnPhase').disabled && document.getElementById('btnUndo').disabled && !!lockOf(0)),
     '番でない側は「相手の番です」。フェイズ送り・戻すを押せず、自分のカードも動かせない');
  ok(await ev(A, () => !document.getElementById('btnPhase').disabled && document.getElementById('btnUndo').disabled && document.getElementById('btnAi').disabled && !!lockOf(1)),
     '番の側はフェイズ送りを押せる（戻す・AI の切り替えは押せない。相手の側は動かせない）');

  // ---- 番を渡す ----
  await ev(A, () => { enaCharge(state.players[0].hand[0].uid, 0); render(); });
  await A.click('#btnPhase');
  ok(await until(() => ev(B, () => state.phase === 1 && olHolder() && !document.getElementById('btnPhase').disabled)), '「フェイズ送り」で番を渡すと、相手の端末で操作できるようになる（番を渡した盤面も届く）');
  ok(await ev(B, () => state.players[1].ena.length === 2 && state.players[1].ena.every(c => !!c.key) && state.players[1].hand.length === 5),
     '相手がエナにしたカード（表向き）は中身が届き、手札は5枚に見える');
  ok((await flow(A)).includes('相手の番です') && await ev(A, () => document.getElementById('btnPhase').disabled), '渡した側は「相手の番です」');
  // 番の側が読み込み直しても、続きから
  const handB = await ev(B, () => JSON.stringify(state.players[0].hand.map(c => c.uid + c.key)));
  await B.reload();
  ok(await until(() => ev(B, h => ol.on && state.phase === 1 && olHolder() && JSON.stringify(state.players[0].hand.map(c => c.uid + c.key)) === h, handB)),
     '番の側が読み込み直しても、同じ盤面（自分の手札の中身も）で続けられる');
  // 部屋を作った側（いまは番でない）が読み込み直しても、盤面が戻る。部屋の画面（先手を選ぶ）は出ない
  const handA = await ev(A, () => JSON.stringify(state.players[0].hand.map(c => c.uid + c.key)));
  await A.reload();
  ok(await until(() => ev(A, h => ol.on && ol.host && !ol.loading && state.phase === 1 && !olHolder() && JSON.stringify(state.players[0].hand.map(c => c.uid + c.key)) === h, handA)),
     '部屋を作った側が読み込み直しても、同じ盤面（自分の手札の中身も）に戻る');
  ok(!(await sheet(A)) && (await flow(A)).includes('相手の番です') && await ev(A, () => !!ol.peer), '読み込み直したときは、部屋の画面も「相手が入りました」も出さない');

  // ---- 両方を AI に任せて最後まで ----
  const samples = [];
  await ev(A, aiInstall); await ev(B, aiInstall);
  await ev(B, () => render());
  const G = await playOut(A, B, samples), fin = G.fin;
  ok(G.ok, '両方を AI に任せると、最後まで進み、両方の画面で同じ側が勝つ（' + fin[0].r + ' ラウンド・盤面を ' + fin[0].n + ' 回送った。勝ち: ' + (fin[0].w === 0 ? '作った側' : '入った側') + '）');
  ok(G.same, '終わったとき、両方の画面の共有の盤面が一致する');
  // 盤面の動き（攻撃・攻撃を受ける）の知らせも、共有の盤面と一緒に届く（相手の端末でも同じ動きを見せる。カードの番号だけで、中身は入らない）
  const fxMsgs = R.msgs.filter(m => /^games\/[^/]+$/.test(m.path) && (m.data.fx || []).some(e => e.k === 'attack'));
  const fxSeen = await Promise.all([A, B].map(p => ev(p, () => Object.keys(ol.fxSeen).length)));
  ok(fxMsgs.length > 0 && fxMsgs.every(m => m.data.fx.every(e => Object.keys(e).every(k => ['k', 'a', 't', 'u', 'clash', 'n'].includes(k)))) && fxSeen[0] + fxSeen[1] > 0,
     '攻撃・攻撃を受ける動きの知らせが、共有の盤面と一緒に相手に届く（カードの番号だけ）');
  const L = leaks(R), bad = samples.flatMap(s => s.bad), sneak = samples.flatMap(s => s.handKeys).filter(u => !L.revealed.has(u));
  ok(L.bad.length === 0, '送られたもの（' + R.msgs.length + ' 件）に、手札・山札・ハート・裏向きのカードの中身もデッキの中身も入っていない' + (L.bad.length ? ': ' + L.bad.slice(0, 3).join(' / ') : ''));
  ok(samples.length > 10 && bad.length === 0, '対戦中ずっと（' + samples.length + ' 回調べた）、どちらの画面にも相手の山札・ハート・裏向きのカードの中身がない' + (bad.length ? ': ' + bad.slice(0, 3).join(' / ') : ''));
  ok(sneak.length === 0, '相手の手札で中身が分かるのは、見せられた（表になった）カードだけ' + (sneak.length ? ': ' + sneak.slice(0, 3).join(' / ') : ''));
  if (sneak.length && process.env.OL_DEBUG) R.msgs.forEach((m, i) => { const j = JSON.stringify(m.data); if (j.includes(sneak[0])) console.log(i, m.who, m.path, j.slice(Math.max(0, j.indexOf(sneak[0]) - 200), j.indexOf(sneak[0]) + 200)); });
  ok(await ev(A, () => { const s = localStorage.getItem('horobeat-online-priv-' + ol.gid + '-A') || ''; return s.includes('A-') && !s.includes('B-'); }) &&
     await ev(B, () => { const s = localStorage.getItem('horobeat-online-priv-' + ol.gid + '-B') || ''; return s.includes('B-') && !s.includes('A-'); }),
     '自分の端末の控えには、自分のカードだけ。控えは部屋と側ごとに分ける（同じアカウントの2台でも上書きしない）');
  ok((await flow(A)).includes('勝利') && (await flow(B)).includes('勝利'), '両方の画面に勝敗が出る');
  ok(await ev(B, () => document.querySelectorAll('#side-1 .z-hand .card.hid').length === 0), '勝敗が決まったら、相手の手札の伏せ（描き方）は外す（中身は届いていないので、分からないカードとして描く）');

  // ---- やめると、1人で遊んでいた盤面に戻る ----
  await ev(A, () => { clearInterval(window.__drv); window.__drv = null; aiForce = null; });
  await ev(B, () => { clearInterval(window.__drv); window.__drv = null; aiForce = null; });
  // 終わったあとに読み込み直しても、勝敗の出た盤面に戻る
  await A.reload();
  ok(await until(() => ev(A, w => ol.on && !ol.loading && state.winner === w, fin[0].w)) && !(await sheet(A)), '終わったあとに読み込み直しても、勝敗の出た盤面に戻る');
  const big = Math.max(...R.msgs.filter(m => /^games\/[^/]+$/.test(m.path)).map(m => JSON.stringify(m.data).length));
  ok(big < 128 * 1024, '共有の盤面の大きさは、いちばん大きいときでも ' + Math.round(big / 1024) + ' KB（データの保存の1文書の上限 256 KB より十分小さい）');
  await A.click('#btnOnline'); await tapSheet(A, 'button[data-ol="leave"]');
  ok((await sheet(A)).includes('やめますか'), '「対戦をやめる」は、やめてよいかを確かめる');
  await H.confirmYes(A);
  ok(await ev(A, () => !ol.on && JSON.stringify(state)) === offA && (await A.textContent('#btnOnline')).includes('対戦'), '「対戦をやめる」で、1人で遊んでいた盤面に戻る');
  await A.reload(); await wait(200);
  ok(await ev(A, () => !ol.on && localStorage.getItem('horobeat-online') === 'null'), 'やめたあとは、読み込み直しても部屋に戻らない');
  ok(await ev(B, () => document.documentElement.scrollWidth <= window.innerWidth + 1), '横にはみ出さない');

  // ---- PC では、デッキ・先手を入れ替えて、AI どうしでさらに6局（引き直しも AI。相手に聞くことを多く通す）----
  if (!touch){
    await ev(B, () => olLeave());
    const s2 = [], res = [], m0 = R.msgs.length;
    for (let g = 0; g < 6; g++){
      const dA = g % 2 ? 'HB-SD02' : 'HB-SD01', dB = g % 2 ? 'HB-SD01' : 'HB-SD02', first = (g >> 1) % 2;
      await ev(A, d => { loadStarter(0, d); render(); olCreate(); }, dA);
      const code = await ev(A, () => ol.gid);
      await ev(B, ([d, c]) => { loadStarter(0, d); render(); olJoin(c); }, [dB, code]);
      await until(() => ev(A, () => !!ol.peer));
      await ev(A, aiInstall); await ev(B, aiInstall);
      await ev(A, f => olStart(f), first);
      const r = await playOut(A, B, s2); res.push(r);
      await ev(A, () => olLeave()); await ev(B, () => olLeave());
    }
    const kinds = {}; R.msgs.slice(m0).forEach(m => { if (/\/rpc\/req/.test(m.path)) kinds[m.data.kind] = (kinds[m.data.kind] || 0) + 1; });
    const L2 = leaks(R), bad2 = s2.flatMap(s => s.bad), sneak2 = s2.flatMap(s => s.handKeys).filter(u => !L2.revealed.has(u));
    ok(res.every(r => r.ok && r.same), 'デッキ・先手を入れ替えた6局も、最後まで進み、両方の画面で勝敗と盤面が一致する（' + res.map(r => r.fin[0].r + 'R').join('・') + '）');
    ok(L2.bad.length === 0 && bad2.length === 0 && sneak2.length === 0, '6局とも、相手の手札・山札・ハートの中身は送られず、画面の中にもない（' + s2.length + ' 回調べた）' + L2.bad.concat(bad2, sneak2).slice(0, 3).join(' / '));
    console.log('  （相手に聞いたこと: ' + JSON.stringify(kinds) + '）');
    // 作った側が先手なら、⑥のあと作った側が入った側のエナを見せてもらう。入った側が先手なら、入った側が自分のエナを盤面と一緒に送る
    ok((kinds.reveal || 0) >= 4, '作った側が先手の4局では、⑥のエナの中身を相手の端末に見せてもらう（' + (kinds.reveal || 0) + ' 回）');
    ok(await ev(A, () => !ol.on && localStorage.getItem('horobeat-online') === 'null'), '6局のあと、やめた状態に戻っている');
  }
  ok(A.__errs.length === 0 && B.__errs.length === 0 && R.errs.length === 0, 'JSエラーなし（受け取ったときのものも） ' + A.__errs.concat(B.__errs, R.errs).slice(0, 3).join(' | '));
  await b.close();
}
(async () => {
  await run('pc', { width:1280, height:900 }, false);
  await run('iphone', { width:390, height:844 }, true);
  await H.finish();
})();
