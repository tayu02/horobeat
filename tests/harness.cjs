// 試験の共通部品。各 *.test.cjs はこれを読む。
//
// - ok(条件, 説明): 結果を1行出す。失敗したら、その瞬間の画面を
//   test-results/<試験名>-fail-<番号>.png に保存する（何が起きていたかを後から見られるように）
// - watch(page): 失敗時に撮る画面を指定する
// - finish(): 集計を出して終了コードを返す。確認が1つもなかった試験は失敗とみなす
//   （途中で黙って止まった試験を「成功」と見誤らないため）
const path = require("node:path");
const fs = require("node:fs");
const { chromium, devices } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "test-results");
const NAME = path.basename(require.main.filename).replace(/\.test\.cjs$/, "");
const URL = "file://" + path.join(ROOT, "simulator.html");
fs.mkdirSync(OUT, { recursive: true });

// この環境の Chromium を優先し（作業環境によって置き場所が違うので、あるものを使う）、無ければ Playwright の既定のものを使う
const PINNED = ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"].find(f => fs.existsSync(f));
// 盤面の動き（カードが飛ぶ・攻撃する など。2026-10-23〜）は tests/motion.test.cjs で確かめる。
// ほかの試験は「動きを減らす」設定で開く（動いている途中のカードを押したり、位置を測ったりしないように）。
// 動きを見たい試験は newContext / newPage に reducedMotion: "no-preference" を渡す
async function launch() {
  const b = await chromium.launch(PINNED ? { executablePath: PINNED } : {});
  const nc = b.newContext.bind(b), np = b.newPage.bind(b);
  b.newContext = (o = {}) => nc({ reducedMotion: "reduce", ...o });
  b.newPage = (o = {}) => np({ reducedMotion: "reduce", ...o });
  return b;
}

let pass = 0, fail = 0, page = null, label = "";
const pending = [];
function watch(p, l) {
  page = p; if (l !== undefined) label = l;
  // 公開先（アーティファクト）の画面ではブラウザの確認窓（confirm・alert・prompt）が出ず、confirm は押さずに「いいえ」になる。
  // 使っていたら、ここで失敗にする（2026-10-19「スターターを選択しても何も出ない」の原因）
  if (!p.__dialogWatch) { p.__dialogWatch = true; p.on("dialog", d => { ok(false, "ブラウザの確認窓を使っている（公開先では出ない）: " + d.message()); d.dismiss().catch(() => {}); }); }
}
function ok(cond, msg) {
  // PC と iPhone の両方で同じ確認をするので、どちらで起きたかを頭に付ける
  const m = (label ? `(${label}) ` : "") + msg;
  if (cond) { pass++; console.log("  PASS " + m); return; }
  fail++;
  const shot = path.join(OUT, `${NAME}-fail-${fail}.png`);
  console.log("  FAIL " + m + (page ? `  [画面: test-results/${path.basename(shot)}]` : ""));
  if (page) pending.push(page.screenshot({ path: shot, fullPage: false }).catch(() => {}));
}
function out(file) { return path.join(OUT, file); }
async function finish() {
  await Promise.all(pending);
  if (pass + fail === 0) { console.log("\n確認が1つも実行されなかった（途中で止まった可能性）"); process.exit(1); }
  console.log(fail ? `\n${fail} 件 FAIL（${pass} 件 PASS）` : `\n全て PASS（${pass} 件）`);
  process.exit(fail ? 1 : 0);
}
// 試験の外で例外が起きたら、それも失敗として止める（黙って落ちないように）
process.on("unhandledRejection", e => { console.log("  FAIL 試験が例外で止まった: " + (e && e.message || e)); fail++; finish(); });

// 準備を画面のボタンで済ませる: 先手を選んで配り（①②③）、両者「このまま」（④）→ ⑤⑥ → 召喚フェイズ（先手）
async function prep(p, first) {
  await p.click(`#flow button[data-prep="deal"][data-first="${first || 0}"]`);
  await p.click('#flow button[data-prep="mull"][data-pi="0"][data-redraw="0"]');
  await p.click('#flow button[data-prep="mull"][data-pi="1"][data-redraw="0"]');
}

// 画面内の確認のシートで「はい」（組み直す・やり直す など）を押す。
// シートは開いてから 0.4 秒は押しても効かない（誤タップ防止）ので、その分待つ
async function confirmYes(p) {
  await p.waitForSelector("#sheet button[data-cfm]");
  await p.waitForTimeout(450);
  await p.click("#sheet button[data-cfm]");
}
async function confirmNo(p) {
  await p.waitForSelector("#sheet button[data-cfm]");
  await p.waitForTimeout(450);
  await p.click('#sheet button[data-close="1"]');
}

// 再読み込みする前に、いまのページが保存した内容（localStorage）が、別のページからも読めることを確かめてから再読み込みする。
// 経緯（2026-11-23）: 試験を20本ほど同時に回して重いときに、「保存してすぐ再読み込み」すると、保存した内容が新しいページに
// 届いていないことがあった（ai の「再読み込みしても AI のまま」2回、deckbuilder の「再読み込みしても…残る」1回。どれも保存が丸ごと無い状態）。
// 保存の量（約8KB）や読み込みの処理には原因が見つからず、ブラウザが保存を受け取り終える前に再読み込みが始まったと見ている
// （負荷をかけた単純な再現 180 回では起きなかったので、断定はしていない）。別のページから読めれば、ブラウザが保存を受け取っている。
// 10 秒たっても読めなければ、そのことを失敗として出す（黙って再読み込みしない）
const PROBE_URL = "file://" + path.join(ROOT, "tests", "probe.html");
// 比べるたびに、元のページの保存も読み直す（確かめている間にページが保存を書き換えることがあるため。2026-11-23 に、最初に1回だけ
// 写し取った内容と比べ続けて、書き換えのあとの正しい保存を「読めない」と取り違えたことがあった）
const allStore = () => { const o = {}; for (let i = 0; i < localStorage.length; i++){ const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; };
async function reloadSaved(p, ms = 10000) {
  const probe = await p.context().newPage();
  await probe.goto(PROBE_URL);
  const t0 = Date.now(); let diff = null;
  while (Date.now() - t0 < ms) {
    const a = await p.evaluate(allStore), b = await probe.evaluate(allStore);
    diff = [...new Set(Object.keys(a).concat(Object.keys(b)))].filter(k => a[k] !== b[k]);
    if (!diff.length) break;
    await new Promise(r => setTimeout(r, 50));
  }
  await probe.close();
  if (diff.length) ok(false, "再読み込みの前に保存した内容が、" + (ms / 1000) + " 秒たっても別のページから同じに読めない（食い違う項目: " + diff.join("・") + "）");
  await p.reload();
}

module.exports = { chromium, devices, launch, ok, watch, finish, out, prep, confirmYes, confirmNo, reloadSaved, ROOT, URL };
