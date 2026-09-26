// カード画像の台帳（data/card-images.json）を検査する。
// 画像そのものは公開リポジトリに入れない。images/cards/<key>.webp に置き、
// 非公開のアーティファクトにだけ載せる（→ docs/design.md §2-3）。
//
// 使い方:
//   node tools/card-images.mjs           … 台帳の検査（validate からも呼ばれる）
//   node tools/card-images.mjs --files   … アーティファクトに載せる files の対応表を JSON で出す
import { readFileSync, existsSync } from "node:fs";

export function checkImages(cards) {
  const m = JSON.parse(readFileSync("data/card-images.json", "utf8"));
  const errors = [], missing = [];
  const keys = new Set(cards.map(c => c.key));
  const imgs = m.images || {}, pend = m.pending || {};
  for (const k of Object.keys(imgs)) {
    if (!keys.has(k)) errors.push(`画像の台帳に ${k} があるが、cards.json にない`);
    if (k in pend) errors.push(`${k} が images と pending の両方にある`);
    if (!existsSync(`${m.dir}/${k}.webp`)) missing.push(k);
  }
  for (const k of Object.keys(pend)) if (!keys.has(k)) errors.push(`画像の保留に ${k} があるが、cards.json にない`);
  // どのカードも、画像を載せるか、理由を書いて保留するかを決めてあること
  for (const k of keys)
    if (!(k in imgs) && !(k in pend))
      errors.push(`${k} の画像をどうするか決まっていない（data/card-images.json の images に足すか、pending に理由を書く）`);
  return { manifest: m, errors, missing };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cards = JSON.parse(readFileSync("data/cards.json", "utf8")).cards;
  const { manifest, errors, missing } = checkImages(cards);
  if (process.argv.includes("--files")) {
    const files = {};
    for (const k of Object.keys(manifest.images)) if (!missing.includes(k)) files[`${manifest.dir}/${k}.webp`] = `${manifest.dir}/${k}.webp`;
    console.log(JSON.stringify(files));
    if (missing.length) console.error(`手元にない画像 ${missing.length} 枚（アーティファクトに既にあれば問題ない）: ${missing.join(", ")}`);
  } else {
    if (errors.length) { console.error(`NG: ${errors.length} 件`); errors.forEach(e => console.error("  - " + e)); process.exit(1); }
    console.log(`OK: 画像 ${Object.keys(manifest.images).length} 枚、保留 ${Object.keys(manifest.pending).length} 枚` +
      (missing.length ? `（手元にない画像 ${missing.length} 枚: ${missing.join(", ")}）` : ""));
  }
}
