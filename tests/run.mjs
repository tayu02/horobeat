// すべての検査をまとめて走らせ、失敗を名前つきで一覧にする。
//
//   npm test                 … すべて1回
//   npm test -- --repeat 5   … ブラウザの試験を5回ずつ回し、たまにしか落ちない確認を洗い出す
//
// やっていること:
//   1. 速い検査（データ・文書の表・画像の台帳・生成物が最新か）
//   2. ブラウザの試験（tests/*.test.cjs）を並列に実行
//   3. それぞれの全出力を test-results/<名前>.log に保存
//      （あとから「何が落ちたか」を必ず確かめられるように。以前、出力を捨てていて分からなくなった）
//   4. FAIL の行をすべて、試験名つきで最後にまとめて表示。失敗時の画面の保存先も出す
//   5. 1回ごとの結果を test-results/history.log に1行ずつ追記（たまに落ちる確認を後から追える）
//
// 1つでも失敗すれば終了コード 1。コミット前のフック（.githooks/pre-commit）がこれを使う。
import { spawn, execFileSync } from "node:child_process";
import { readdirSync, mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "test-results");
const ri = process.argv.indexOf("--repeat");
const REPEAT = ri > 0 ? Math.max(1, parseInt(process.argv[ri + 1], 10) || 1) : 1;

// 前回の失敗時の画面が残っていると紛らわしいので消す（history.log は残す）
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png") || f.endsWith(".log") && f !== "history.log") rmSync(path.join(OUT, f));

const run = (label, cmd, args) => new Promise(resolve => {
  const t0 = Date.now();
  const ch = spawn(cmd, args, { cwd: ROOT, env: process.env });
  let log = "";
  ch.stdout.on("data", d => log += d); ch.stderr.on("data", d => log += d);
  ch.on("close", code => resolve({ label, code, log, sec: ((Date.now() - t0) / 1000).toFixed(1) }));
});

// ---- 1. 速い検査 ----
const quick = [
  ["カードデータ・能力の部品・画像の台帳", "node", ["tools/validate-cards.mjs"]],
  ["文書の表の崩れ", "node", ["tools/check-docs.mjs"]],
  ["生成物が最新か", "node", ["tools/check-generated.mjs"]],
  ["全カードの効果を画面で確かめる試験があるか", "node", ["tools/check-play-coverage.mjs"]],
];
const results = [];
for (const [label, cmd, args] of quick) results.push(await run(label, cmd, args));

// ---- 2. ブラウザの試験 ----
const suites = readdirSync(path.join(ROOT, "tests")).filter(f => f.endsWith(".test.cjs")).sort();
const browser = [];
for (let r = 1; r <= REPEAT; r++) {
  const batch = await Promise.all(suites.map(f =>
    run(f.replace(".test.cjs", "") + (REPEAT > 1 ? `#${r}` : ""), "node", [path.join("tests", f)])));
  browser.push(...batch);
}
results.push(...browser);

// ---- 3〜4. 保存と一覧 ----
const fails = [];
const rows = results.map(r => {
  writeFileSync(path.join(OUT, r.label.replace(/[^\w#-]/g, "_") + ".log"), r.log);
  const pass = (r.log.match(/^\s+PASS /gm) || []).length;
  const failLines = r.log.split("\n").filter(l => /^\s+FAIL /.test(l)).map(l => l.trim().replace(/^FAIL /, ""));
  let status = r.code === 0 ? "OK" : "NG";
  // 終了コードが失敗なのに FAIL 行がない ＝ 異常終了。最後の数行を出す
  if (r.code !== 0 && !failLines.length) {
    const tail = r.log.trim().split("\n").slice(-6).join("\n        ");
    failLines.push("異常終了（FAIL 行なしで止まった）:\n        " + tail);
  }
  failLines.forEach(l => fails.push(`[${r.label}] ${l}`));
  return { ...r, pass, nfail: failLines.length, status };
});

console.log("\n検査の結果");
console.log("─".repeat(60));
for (const r of rows)
  console.log(`${r.status === "OK" ? "✓" : "✗"} ${r.label.padEnd(28)} ${String(r.pass).padStart(4)} PASS  ${String(r.nfail).padStart(3)} FAIL  ${r.sec}s`);
console.log("─".repeat(60));
const totalPass = rows.reduce((n, r) => n + r.pass, 0);

let commit = "";
try { commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim(); } catch {}
appendFileSync(path.join(OUT, "history.log"),
  `${new Date().toISOString()} HEAD=${commit} repeat=${REPEAT} pass=${totalPass} fail=${fails.length}` +
  (fails.length ? " | " + fails.map(f => f.split("\n")[0]).join(" | ") : "") + "\n");

if (fails.length) {
  console.log(`\n✗ 失敗 ${fails.length} 件:`);
  fails.forEach(f => console.log("  - " + f));
  console.log("\n全出力は test-results/<名前>.log、失敗時の画面は test-results/*.png にある。");
  // --repeat のとき、たまにしか落ちない確認を数える
  if (REPEAT > 1) {
    const cnt = {};
    for (const f of fails) { const k = f.replace(/^\[([^#\]]+)#\d+\]/, "[$1]").split("  [画面")[0]; cnt[k] = (cnt[k] || 0) + 1; }
    console.log(`\n${REPEAT} 回のうち落ちた回数:`);
    Object.entries(cnt).sort((a, b) => b[1] - a[1]).forEach(([k, n]) => console.log(`  ${n}/${REPEAT}  ${k}`));
  }
  process.exit(1);
}
console.log(`\n✓ すべて通過（${totalPass} 件）`);
