// 能力文を部品（data/ability-parts.json）に分解し、また部品から組み立てる。
//
// 文の形:
//   [発火条件1]が[発火条件2]とき、[効果条件]なら、…[効果]。[補足]
//   効果が「。」で終わったあと、次の文の頭に [効果条件]なら、を置ける
//   （例: 「…見せてもよい。そうしたなら、カードを1枚引く。」）。これは効果の if に入る
//   [キーワード]（[説明]）[\n・続く文]
// のどちらか。各 [ ] は省略されうる（効果は1つ以上）。
//
// **守っていること:** 分解の結果は、組み立て直すと印字と1文字も違わない
// ものしか採用しない（parse の最後で render して比較する）。
// だから正規表現がどれだけ緩くても、印字にない文字が紛れ込むことはない。
// 分解できない文は「どこまで読めて、どこから先が辞書にないか」を返す。
//
// 使い方:
//   node tools/ability.mjs parse "このホロビトが出たとき、カードを1枚引く。"
//   node tools/ability.mjs render '{"trigger":{"subject":"this_holobito","event":"entered"},"effects":[{"part":"draw","args":{"n":2}}]}'
//   node tools/ability.mjs build   … data/abilities.json を作り直す
//   node tools/ability.mjs index   … rules_confirmed.md §11-4 を作り直す
import { readFileSync, writeFileSync } from "node:fs";

const PARTS_PATH = "data/ability-parts.json";
const CARDS_PATH = "data/cards.json";
const OUT_PATH = "data/abilities.json";
const DOC_PATH = "docs/rules_confirmed.md";
const SIM_PATH = "simulator.html";
const DESIGN_PATH = "docs/design.md";
const FX_BEGIN = "<!-- @@PART_FX_TABLE_BEGIN@@ -->";
const FX_END = "<!-- @@PART_FX_TABLE_END@@ -->";
const BEGIN = "<!-- @@ABILITY_INDEX_BEGIN@@ -->";
const END = "<!-- @@ABILITY_INDEX_END@@ -->";

const NUMERIC = new Set(["n", "m", "from", "to"]);
const circled = n => String.fromCharCode(0x2460 + n - 1);
const uncircled = ch => ch.charCodeAt(0) - 0x2460 + 1;

export function loadParts(path = PARTS_PATH) {
  return JSON.parse(readFileSync(path, "utf8")).parts;
}

// ---- 組み立て -------------------------------------------------------------

function fill(tpl, args = {}) {
  const has = n => args[n] !== undefined && args[n] !== "";
  const opt = tpl.replace(/\[([^\[\]]*)\]/g, (_, inner) =>
    [...inner.matchAll(/\{(\w+)(?::\w+)?\}/g)].every(m => has(m[1])) ? inner : "");
  return opt.replace(/\{(\w+)(?::(\w+))?\}/g, (_, n, fmt) => {
    if (!has(n)) throw new Error(`引数 ${n} が渡されていない: ${tpl}`);
    return fmt === "circled" ? circled(args[n]) : String(args[n]);
  });
}

const ref = r => typeof r === "string" ? { part: r } : r;

export function render(ab, parts = loadParts()) {
  const P = r => {
    r = ref(r);
    const p = parts[r.part];
    if (!p) throw new Error(`部品 ${r.part} が辞書にない`);
    return { p, args: r.args || {} };
  };
  if (ab.keyword) {
    const { p, args } = P(ab.keyword);
    let s = `${fill(p.text, args)}（${fill(p.reminder, args)}）`;
    if (ab.sub) s += "\n・" + render(ab.sub, parts);
    return s;
  }
  let s = "";
  if (ab.trigger) {
    const a = P(ab.trigger.subject), b = P(ab.trigger.event);
    s += `${fill(a.p.text, a.args)}が${fill(b.p.text, b.args)}とき、`;
  }
  for (const c of ab.conditions || []) {
    const { p, args } = P(c);
    s += `${fill(p.text, args)}なら、`;
  }
  const effs = ab.effects || [];
  if (!effs.length) throw new Error("効果が1つもない");
  effs.forEach((e, i) => {
    const { p, args } = P(e);
    const last = i === effs.length - 1;
    // 文の頭（最初の効果、または直前の効果が「。」で終わった）にだけ if の条件を書く
    if (ref(e).if && (i === 0 || ref(effs[i - 1]).then === "。"))
      s += ref(e).if.map(c => { const q = P(c); return fill(q.p.text, q.args) + "なら、"; }).join("");
    if (last || ref(e).then === "。") s += fill(p.text, args) + "。";
    else {
      if (!p.ren) throw new Error(`部品 ${ref(e).part} に「し」「び」で続ける形（ren）がない`);
      s += fill(p.ren, args) + "、";
    }
  });
  if (ab.note) {
    const { p } = P(ab.note);
    s += (ref(ab.note).sep || "") + p.text;
  }
  return s;
}

// ---- 分解 -----------------------------------------------------------------

// テンプレートを正規表現にする。引数はとりあえず緩く拾い、正誤は render で確かめる。
function compile(tpl) {
  const names = [];
  let src = "";
  for (let i = 0; i < tpl.length; i++) {
    const ch = tpl[i];
    if (ch === "[") { src += "(?:"; continue; }
    if (ch === "]") { src += ")?"; continue; }
    if (ch === "{") {
      const j = tpl.indexOf("}", i);
      const [name, fmt] = tpl.slice(i + 1, j).split(":");
      names.push({ name, fmt });
      // 自由な引数は文の区切り（、。（）改行）をまたがない。
      // またぐと「{target}」が節ごと飲み込んでも印字と一致してしまう。
      src += fmt === "circled" ? "([\\u2460-\\u2473])" : NUMERIC.has(name) ? "([0-9]+)" : "([^、。（）\\n]+?)";
      i = j;
      continue;
    }
    src += ch.replace(/[.*+?^${}()|\\\/]/g, "\\$&");
  }
  return { src, names };
}

// 1行が、ある部品の文面テンプレートにまるごと一致するか。
// 転記ゆれの検出で「同じ部品に違う値が入っているだけ」の組を除くのに使う。
export function sameTemplate(a, b, parts = loadParts()) {
  for (const p of Object.values(parts)) {
    const src = p.reminder ? compile(p.text).src + "（" + compile(p.reminder).src + "）" : compile(p.text).src;
    const re = new RegExp("^(?:" + src + ")$");
    if (re.test(a) && re.test(b)) return true;
  }
  return false;
}

// 同じ名前の引数が2回出たら、同じ値でなければ一致とみなさない
// （例: 「{n}バリア（…ダメージは{n}減る）」で数字が食い違う文は分解しない）
function collect(names, groups) {
  const args = {};
  for (let k = 0; k < names.length; k++) {
    const g = groups[k];
    if (g === undefined) continue;
    const { name, fmt } = names[k];
    const v = fmt === "circled" ? uncircled(g) : NUMERIC.has(name) ? Number(g) : g;
    if (name in args && args[name] !== v) return null;
    args[name] = v;
  }
  return args;
}

function tryAt(str, pos, pieces) {
  // pieces: [{tpl} | {lit}] を順に並べた1本の正規表現で pos から一致させる
  let src = "", names = [], owners = [];
  pieces.forEach((pc, idx) => {
    if (pc.lit !== undefined) { src += pc.lit.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&"); return; }
    const c = compile(pc.tpl);
    src += c.src;
    for (const n of c.names) { names.push(n); owners.push(idx); }
  });
  const re = new RegExp(src, "y");
  re.lastIndex = pos;
  const m = re.exec(str);
  if (!m) return null;
  // 部品ごとに引数を分けて集める
  const per = pieces.map(() => ({ names: [], groups: [] }));
  names.forEach((n, k) => { per[owners[k]].names.push(n); per[owners[k]].groups.push(m[k + 1]); });
  const args = per.map(x => collect(x.names, x.groups));
  if (args.some((a, i) => pieces[i].tpl !== undefined && a === null)) return null;
  return { end: re.lastIndex, args };
}

const argsOrNone = a => a && Object.keys(a).length ? { args: a } : {};
const mkref = (id, a) => Object.keys(a || {}).length ? { part: id, ...argsOrNone(a) } : id;

// 自由な文字列の引数に入った文字数。少ないほど「部品の文面で説明できている」。
const freeLen = a => Object.values(a || {}).reduce((n, v) => n + (typeof v === "string" ? v.length : 0), 0);

export function parse(text, parts = loadParts()) {
  const byRole = role => Object.entries(parts).filter(([, p]) => p.role === role);
  let best = { pos: -1, slot: "" }; // 失敗時の手がかり
  const note = (pos, slot) => { if (pos > best.pos) best = { pos, slot }; };

  // 以下はすべて「ありうる分解」を列挙するジェネレーター。{ab, end, cost} を返す。
  function* sentence(pos) {
    yield* conditions(pos, [], 0, null);
    for (const [sid, sp] of byRole("発火条件1"))
      for (const [eid, ep] of byRole("発火条件2")) {
        const r = tryAt(text, pos, [{ tpl: sp.text }, { lit: "が" }, { tpl: ep.text }, { lit: "とき、" }]);
        if (!r) continue;
        note(r.end, "効果条件 または 効果");
        const trig = { subject: mkref(sid, r.args[0]), event: mkref(eid, r.args[2]) };
        yield* conditions(r.end, [], freeLen(r.args[0]) + freeLen(r.args[2]), trig);
      }
  }
  function* conditions(pos, acc, cost, trig) {
    for (const x of effects(pos, [], cost))
      yield { ...x, ab: { ...(trig ? { trigger: trig } : {}), ...(acc.length ? { conditions: acc } : {}), ...x.ab } };
    for (const [id, p] of byRole("効果条件")) {
      const r = tryAt(text, pos, [{ tpl: p.text }, { lit: "なら、" }]);
      if (!r) continue;
      note(r.end, "効果条件 または 効果");
      yield* conditions(r.end, [...acc, mkref(id, r.args[0])], cost + freeLen(r.args[0]), trig);
    }
  }
  // 効果1つ分の記録。if は、その効果が属する文の頭にある条件
  const ent = (id, args, extra, ifs) => {
    const o = { part: id, ...argsOrNone(args), ...(extra || {}) };
    if (ifs.length) o.if = ifs;
    return Object.keys(o).length === 1 ? id : o;
  };
  function* effects(pos, acc, cost, ifs = []) {
    // 「。」のあとの文の頭には条件を置ける（「そうしたなら、」など）
    const last = acc[acc.length - 1];
    if (last && ref(last).then === "。")
      for (const [cid, cp] of byRole("効果条件")) {
        const r = tryAt(text, pos, [{ tpl: cp.text }, { lit: "なら、" }]);
        if (!r) continue;
        note(r.end, "効果");
        yield* effects(r.end, acc, cost + freeLen(r.args[0]), [...ifs, mkref(cid, r.args[0])]);
      }
    for (const [id, p] of [...byRole("効果"), ...byRole("制限")]) {
      const r = tryAt(text, pos, [{ tpl: p.text }, { lit: "。" }]);
      if (r) {
        const c = cost + freeLen(r.args[0]);
        const eff = [...acc, ent(id, r.args[0], null, ifs)];
        if (r.end === text.length || text.startsWith("\n・", r.end)) yield { ab: { effects: eff }, end: r.end, cost: c };
        for (const sep of ["", "\n"])
          for (const [nid, np] of byRole("補足"))
            if (text.slice(r.end) === sep + np.text)
              yield { ab: { effects: eff, note: sep ? { part: nid, sep } : nid }, end: text.length, cost: c };
        note(r.end, "補足 または 次の効果");
        yield* effects(r.end, [...acc, ent(id, r.args[0], { then: "。" }, ifs)], c);
      }
      if (p.ren) {
        const q = tryAt(text, pos, [{ tpl: p.ren }, { lit: "、" }]);
        if (q) {
          note(q.end, "続く効果");
          yield* effects(q.end, [...acc, ent(id, q.args[0], null, ifs)], cost + freeLen(q.args[0]), ifs);
        }
      }
    }
  }
  function* keyword(pos) {
    for (const [id, p] of byRole("キーワード")) {
      const r = tryAt(text, pos, [{ tpl: p.text }, { lit: "（" }, { tpl: p.reminder }, { lit: "）" }]);
      if (!r) continue;
      const a = r.args[0], b = r.args[2];
      // 名前と説明で同じ引数が食い違う文は分解しない（例: 「2バリア（…1減る）」）
      if (Object.keys(a).some(k => k in b && a[k] !== b[k])) continue;
      const kw = { keyword: mkref(id, { ...a, ...b }) };
      const c = freeLen(a) + freeLen(b);
      if (r.end === text.length) yield { ab: kw, end: r.end, cost: c };
      if (text.startsWith("\n・", r.end)) {
        note(r.end + 2, "キーワードに続く文");
        for (const x of sentence(r.end + 2))
          if (x.end === text.length) yield { ab: { ...kw, sub: x.ab }, end: x.end, cost: c + x.cost };
      }
    }
  }

  // 全候補のうち、印字と完全に一致し、自由な引数に入る文字が最も少ないものを採る
  let pick = null;
  for (const gen of [keyword(0), sentence(0)])
    for (const x of gen) {
      if (x.end !== text.length) continue;
      if (render(x.ab, parts) !== text) continue;
      if (!pick || x.cost < pick.cost) pick = x;
    }
  if (pick) return { ok: true, ability: pick.ab };
  return {
    ok: false,
    readUpTo: Math.max(best.pos, 0),
    expected: best.slot || "発火条件 / 効果条件 / 効果 / キーワード",
    rest: text.slice(Math.max(best.pos, 0)),
  };
}

// ---- シミュレーターでの扱い -------------------------------------------------
// simulator.html の PART_FX から、部品ごとの扱い（how）と理由（why）を読む。
// 部品を足したのに扱いを決めていない、という状態を検証で止めるため。
export function readPartFx(path = SIM_PATH) {
  const html = readFileSync(path, "utf8");
  const a = html.indexOf("/* @@PART_FX_BEGIN@@ */"), b = html.indexOf("/* @@PART_FX_END@@ */");
  if (a < 0 || b < 0) return null;
  const out = {};
  for (const m of html.slice(a, b).matchAll(/^\s{2}(\w+):\s*\{\s*how:"([^"]+)",\s*why:"([^"]+)"/gm))
    out[m[1]] = { how: m[2], why: m[3] };
  return out;
}

// ---- まとめて作る ----------------------------------------------------------

export function buildAll(cards = JSON.parse(readFileSync(CARDS_PATH, "utf8")).cards, parts = loadParts()) {
  const out = {}, errors = [];
  for (const c of cards) {
    if (c.abilities === "unknown" || !c.abilities.length) continue;
    out[c.key] = c.abilities.map((text, i) => {
      const r = parse(text, parts);
      if (r.ok) return r.ability;
      errors.push(`${c.key} の能力[${i}] を辞書の部品で組み立てられない。` +
        `${r.readUpTo} 文字目まで読めて、次に来るはずの「${r.expected}」が辞書にない:\n      …${r.rest}`);
      return null;
    });
  }
  // 使われていない部品は、印字に根拠がないので置かない
  const used = new Set();
  const mark = r => { if (r) used.add(ref(r).part); };
  const walk = ab => {
    if (!ab) return;
    mark(ab.keyword); mark(ab.note);
    if (ab.trigger) { mark(ab.trigger.subject); mark(ab.trigger.event); }
    (ab.conditions || []).forEach(mark);
    (ab.effects || []).forEach(e => { mark(e); (ref(e).if || []).forEach(mark); });
    walk(ab.sub);
  };
  Object.values(out).flat().forEach(walk);
  for (const id of Object.keys(parts))
    if (!used.has(id)) errors.push(`部品 ${id} はどのカードにも使われていない（印字に根拠のない部品は置かない）`);
  // どの部品も、シミュレーターでの扱いが1つだけ決まっていること
  const fx = readPartFx();
  if (fx) {
    for (const id of Object.keys(parts))
      if (!fx[id]) errors.push(`部品 ${id} のシミュレーターでの扱いが決まっていない（simulator.html の PART_FX に足すこと）`);
    for (const id of Object.keys(fx))
      if (!parts[id]) errors.push(`simulator.html の PART_FX にある ${id} は部品の辞書にない`);
  }
  return { abilities: out, errors, used };
}

function usage(abilities) {
  const u = new Map();
  const add = (r, key) => {
    if (!r) return;
    const id = ref(r).part;
    if (!u.has(id)) u.set(id, new Set());
    u.get(id).add(key);
  };
  const walk = (ab, key) => {
    if (!ab) return;
    add(ab.keyword, key); add(ab.note, key);
    if (ab.trigger) { add(ab.trigger.subject, key); add(ab.trigger.event, key); }
    (ab.conditions || []).forEach(r => add(r, key));
    (ab.effects || []).forEach(r => { add(r, key); (ref(r).if || []).forEach(c => add(c, key)); });
    walk(ab.sub, key);
  };
  for (const [key, list] of Object.entries(abilities)) list.forEach(ab => walk(ab, key));
  return u;
}

function indexMarkdown(abilities, parts) {
  const u = usage(abilities);
  const roles = ["発火条件1", "発火条件2", "効果条件", "効果", "制限", "補足", "キーワード"];
  const esc = s => s.replace(/\|/g, "\\|").replace(/\n/g, "<br>");
  const lines = [
    BEGIN, "",
    "**この節は `node tools/ability.mjs index` が生成する。手で書き換えない。**", "",
    "能力欄の印字文を、`data/ability-parts.json` の部品に分解したもの。",
    "**分解は、組み立て直すと印字と1文字も違わないものだけを採用している**（`tools/ability.mjs`）。",
    "役割名は文中の位置に付けた名前で、**ルール上の区別ではない**。",
    "`{n}` は数字、`[ ]` は引数を渡したときだけ現れる部分。", "",
    "文の形: `[発火条件1]が[発火条件2]とき、[効果条件]なら、[効果]。[補足]` ／ `[キーワード]（[説明]）`", "",
  ];
  for (const role of roles) {
    const rows = Object.entries(parts).filter(([, p]) => p.role === role);
    if (!rows.length) continue;
    lines.push(`#### ${role}`, "", "| 部品 | 文面 | 枚数 | カード |", "|---|---|---|---|");
    rows.sort((a, b) => (u.get(b[0])?.size || 0) - (u.get(a[0])?.size || 0));
    for (const [id, p] of rows) {
      const cards = [...(u.get(id) || [])];
      const t = p.reminder ? `${p.text}（${p.reminder}）` : p.text;
      lines.push(`| \`${id}\` | ${esc(t)} | ${cards.length} | ${cards.join(" / ")} |`);
    }
    lines.push("");
  }
  lines.push(END);
  return lines.join("\n");
}

// ---- CLI ------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  const parts = loadParts();
  if (cmd === "parse") {
    const r = parse(arg, parts);
    if (r.ok) console.log(JSON.stringify(r.ability, null, 2));
    else {
      console.error(`組み立てられない。${r.readUpTo} 文字目まで読めた。`);
      console.error(`次に来るはずの「${r.expected}」が辞書にない:\n  …${r.rest}`);
      process.exit(1);
    }
  } else if (cmd === "render") {
    console.log(render(JSON.parse(arg), parts));
  } else if (cmd === "build" || cmd === "index") {
    const { abilities, errors } = buildAll(undefined, parts);
    if (errors.length) { console.error(`NG: ${errors.length} 件`); errors.forEach(e => console.error("  - " + e)); process.exit(1); }
    if (cmd === "build") {
      writeFileSync(OUT_PATH, JSON.stringify(abilities, null, 2) + "\n");
      console.log(`wrote ${OUT_PATH} (${Object.keys(abilities).length} 枚)`);
    } else {
      const doc = readFileSync(DOC_PATH, "utf8");
      const i = doc.indexOf(BEGIN), j = doc.indexOf(END);
      if (i < 0 || j < 0) { console.error("マーカーが見つからない"); process.exit(1); }
      writeFileSync(DOC_PATH, doc.slice(0, i) + indexMarkdown(abilities, parts) + doc.slice(j + END.length));
      console.log(`wrote ${DOC_PATH}`);
      // 部品ごとのシミュレーターでの扱いを design.md に書く
      const fx = readPartFx();
      const des = readFileSync(DESIGN_PATH, "utf8");
      const p = des.indexOf(FX_BEGIN), q = des.indexOf(FX_END);
      if (fx && p >= 0 && q >= 0) {
        const esc = t => t.replace(/\|/g, "\\|");
        const order = ["自動", "ボタン", "選択", "選択＋質問", "質問", "表示", "手動"];
        const rows = Object.entries(parts)
          .sort((a, b) => order.indexOf(fx[a[0]].how) - order.indexOf(fx[b[0]].how))
          .map(([id, pt]) => `| ${fx[id].how} | \`${id}\` | ${pt.role} | ${esc(pt.text)} | ${esc(fx[id].why)} |`);
        const table = [FX_BEGIN, "",
          "**この表は `node tools/ability.mjs index` が simulator.html の `PART_FX` から生成する。手で書き換えない。**", "",
          "| 扱い | 部品 | 役割 | 文面 | 理由・根拠 |", "|---|---|---|---|---|", ...rows, "", FX_END].join("\n");
        writeFileSync(DESIGN_PATH, des.slice(0, p) + table + des.slice(q + FX_END.length));
        console.log(`wrote ${DESIGN_PATH}`);
      }
    }
  } else {
    console.error("使い方: node tools/ability.mjs parse|render|build|index ...");
    process.exit(2);
  }
}
