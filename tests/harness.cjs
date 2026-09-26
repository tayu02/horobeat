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

// この環境の Chromium を優先し、無ければ Playwright の既定のものを使う
const PINNED = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
function launch() {
  return chromium.launch(fs.existsSync(PINNED) ? { executablePath: PINNED } : {});
}

let pass = 0, fail = 0, page = null, label = "";
const pending = [];
function watch(p, l) { page = p; if (l !== undefined) label = l; }
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

module.exports = { chromium, devices, launch, ok, watch, finish, out, ROOT, URL };
