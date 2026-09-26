// data/cards.json を data/cards.schema.json で検証する。
// スキーマで表せない整合性（key の一意性、判読が高いのに unknown がある等）もここで見る。
import { readFileSync } from "node:fs";
import Ajv from "ajv";
import { existsSync } from "node:fs";
import { buildAll, sameTemplate } from "./ability.mjs";

export function validateCards(path = "data/cards.json") {
  const data = JSON.parse(readFileSync(path, "utf8"));
  const schema = JSON.parse(readFileSync("data/cards.schema.json", "utf8"));
  const ajv = new Ajv({ allErrors: true, strict: true });
  const ok = ajv.validate(schema, data);
  const errors = [];
  if (!ok) for (const e of ajv.errors) errors.push(`${e.instancePath || "/"} ${e.message}`);

  const seen = new Set();
  for (const c of data.cards) {
    if (seen.has(c.key)) errors.push(`${c.key}: key が重複`);
    seen.add(c.key);

    if (c.id === "unknown" && !c.key.startsWith("UNKNOWN-"))
      errors.push(`${c.key}: id が unknown なら key は UNKNOWN- で始める`);
    if (c.id !== "unknown" && c.key !== c.id)
      errors.push(`${c.key}: id が判明しているなら key は id と一致させる`);

    // ワザにパワー欄はない。ホロビトにはある。
    if (c.type === "ワザ" && c.power !== null)
      errors.push(`${c.key}: ワザの power は null（パワー欄が印字されない）`);
    if (c.type === "ホロビト" && c.power === null)
      errors.push(`${c.key}: ホロビトの power に null は使えない（存在するはずなので unknown か数値）`);

    // 高解像度で読めている版があるなら、unknown が残っているのはおかしい
    const hasHigh = c.printings.some(p => p.legibility === "high");
    if (hasHigh) {
      const unk = [];
      const walk = (v, path) => {
        if (v === "unknown") unk.push(path);
        else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
        else if (v && typeof v === "object") for (const k in v) walk(v[k], `${path}.${k}`);
      };
      for (const f of ["id","name_ruby","color_mark","cost","power","family","left_edge","abilities","flavor","trigger"]) walk(c[f], f);
      if (unk.length) errors.push(`${c.key}: legibility=high の版があるのに unknown が残っている: ${unk.join(", ")}`);
    }
  }

  // --- 転記ゆれの検出 ---------------------------------------------------
  // カードが増えるほど、同じ文面を少しだけ違えて写す事故が起きやすい。
  // 「完全一致か、まったく別物か」のどちらかであるべき箇所で、
  // **惜しい違い**が出たら止める。誤検出が出たら閾値ではなく例外で直すこと。

  // 同じトリガーのキーワードなら、アイコンと効果文は一致するはず
  const trig = new Map();
  for (const c of data.cards) {
    const t = c.trigger;
    if (!t || t.keyword === "unknown") continue;
    if (!trig.has(t.keyword)) trig.set(t.keyword, []);
    trig.get(t.keyword).push(c);
  }
  for (const [kw, list] of trig) {
    for (const f of ["icon", "text"]) {
      const byVal = new Map();
      for (const c of list) {
        const v = c.trigger[f];
        if (v === "unknown") continue;
        if (!byVal.has(v)) byVal.set(v, []);
        byVal.get(v).push(c.key);
      }
      if (byVal.size > 1)
        errors.push(`トリガー「${kw}」の ${f} が一致しない:\n` +
          [...byVal].map(([v, keys]) => `      ${JSON.stringify(v)} … ${keys.length}枚 (${keys.join(", ")})`).join("\n"));
    }
  }

  // 能力文どうしの「惜しい違い」
  const dist = (a, b) => {
    // レーベンシュタイン距離。短い方の長さを超えたら打ち切る。
    if (Math.abs(a.length - b.length) > 4) return 99;
    const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      let diag = prev[0];
      prev[0] = i;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
        diag = tmp;
      }
    }
    return prev[b.length];
  };
  // 同じ文面はまず1つにまとめる。まとめた「種類」どうしを比べるので、
  // 1件の取り違えが枚数分の警告に膨らまない。
  const byLine = new Map();
  for (const c of data.cards) {
    if (c.abilities === "unknown") continue;
    for (const a of c.abilities) for (const l of a.split("\n")) {
      if (l.length < 12) continue;
      if (!byLine.has(l)) byLine.set(l, []);
      byLine.get(l).push(c.key);
    }
  }
  const uniq = [...byLine.keys()];
  for (let i = 0; i < uniq.length; i++)
    for (let j = i + 1; j < uniq.length; j++) {
      const d = dist(uniq[i], uniq[j]);
      // 同じ部品に違う値が入っているだけなら正当（例: エナ詠みの「緑」と「赤」）
      if (d > 0 && d <= 3 && !sameTemplate(uniq[i], uniq[j]))
        errors.push(`能力文が ${d} 文字だけ違う。転記ミスでないか確認すること:\n` +
          `      ${uniq[i]}\n        … ${byLine.get(uniq[i]).join(", ")}\n` +
          `      ${uniq[j]}\n        … ${byLine.get(uniq[j]).join(", ")}`);
    }

  // フレーバー中の書名（『…』）の表記ゆれ
  const titles = new Map();
  for (const c of data.cards) {
    if (typeof c.flavor !== "string") continue;
    for (const m of c.flavor.matchAll(/『([^』]+)』/g)) {
      if (!titles.has(m[1])) titles.set(m[1], []);
      titles.get(m[1]).push(c.key);
    }
  }
  const tkeys = [...titles.keys()];
  for (let i = 0; i < tkeys.length; i++)
    for (let j = i + 1; j < tkeys.length; j++)
      if (dist(tkeys[i], tkeys[j]) <= 1)
        errors.push(`フレーバー中の書名が1文字違いで2種類ある: 『${tkeys[i]}』(${titles.get(tkeys[i]).join(", ")}) / 『${tkeys[j]}』(${titles.get(tkeys[j]).join(", ")})`);

  // --- 能力文の部品分解 -------------------------------------------------
  // 印字された能力文はすべて data/ability-parts.json の部品で組み立て直せること。
  // 組み立て直した文が印字と1文字でも違えば、分解は採用されない（tools/ability.mjs）。
  if (path === "data/cards.json") {
    const built = buildAll(data.cards);
    errors.push(...built.errors);
    const saved = existsSync("data/abilities.json") ? readFileSync("data/abilities.json", "utf8") : "";
    if (!built.errors.length && saved !== JSON.stringify(built.abilities, null, 2) + "\n")
      errors.push("data/abilities.json が古い。node tools/ability.mjs build で作り直すこと");
  }

  return { data, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { data, errors } = validateCards();
  if (errors.length) {
    console.error(`NG: ${errors.length} 件`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log(`OK: ${data.cards.length} 枚、問題なし`);
}
