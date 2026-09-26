// 生成物が最新かを見る。生成し直して、中身が変わったら失敗にする。
// 変わっていた場合は、この検査で正しい内容に作り直されているので、git add すればよい。
// （生成物を手で直したり、元データを直して生成し忘れたりしたまま、コミットしないため）
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const GENERATED = ["simulator.html", "data/abilities.json", "docs/rules_confirmed.md", "docs/design.md"];
const before = Object.fromEntries(GENERATED.map(f => [f, existsSync(f) ? readFileSync(f, "utf8") : ""]));
try {
  execSync("node tools/ability.mjs build && node tools/ability.mjs index && node tools/build-cards.mjs && node tools/card-index.mjs --write",
    { stdio: "pipe" });
} catch (e) {
  console.error("  FAIL 生成に失敗した:\n" + (e.stderr || e.stdout || e.message).toString());
  process.exit(1);
}
const stale = GENERATED.filter(f => readFileSync(f, "utf8") !== before[f]);
if (stale.length) {
  stale.forEach(f => console.error(`  FAIL 生成物が古かった（いま作り直した。git add すること）: ${f}`));
  process.exit(1);
}
console.log(`OK: 生成物 ${GENERATED.length} 件は最新`);
