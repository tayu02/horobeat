// 文書の Markdown の表が崩れていないかを見る。
// 表の2行目が区切り行（|---|---|）でない、列の数が行によって違う、を検出する。
// 以前、表の途中に空行や段落を挟んで表を壊したことがあるため。
import { readFileSync } from "node:fs";

const FILES = ["CLAUDE.md", "docs/rules_confirmed.md", "docs/rules_guess.md", "docs/design.md"];
const cells = l => l.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;
const errors = [];
for (const f of FILES) {
  const lines = readFileSync(f, "utf8").split("\n");
  let inCode = false;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("```")) inCode = !inCode;
    if (inCode || !lines[i].trimStart().startsWith("|")) continue;
    const start = i, block = [];
    while (i < lines.length && lines[i].trimStart().startsWith("|")) block.push(lines[i++]);
    if (block.length < 2 || !/^\s*\|[\s:|-]+\|\s*$/.test(block[1]))
      errors.push(`${f}:${start + 1} 表の2行目が区切り行ではない: ${block[0].slice(0, 50)}`);
    else {
      const n = cells(block[0]);
      block.forEach((l, k) => { if (cells(l) !== n) errors.push(`${f}:${start + 1 + k} 列の数が見出し(${n})と違う(${cells(l)}): ${l.slice(0, 50)}`); });
    }
  }
}
if (errors.length) { console.error(`NG: ${errors.length} 件`); errors.forEach(e => console.error("  FAIL " + e)); process.exit(1); }
console.log(`OK: ${FILES.length} 文書の表に崩れなし`);
