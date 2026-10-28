// 题库取题器(P0#2):按房间 industry 从 808 题库顺序取未用题。
// 纪律:返回体只含题干与元信息;referenceAnswer 永不出服务端(评分期由隔离引擎使用)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "./db.mjs";

const BANK_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "questionbank.json");
let cache = null;

function loadBank() {
  if (cache) return cache;
  const base = JSON.parse(fs.readFileSync(BANK_PATH, "utf8"));
  cache = { questions: base.questions ?? base };
  // P2#14 Pro 轨新制题(带 rubricHints,provenance=trialroom 原创),存在则并入
  try {
    const pro = JSON.parse(fs.readFileSync(path.join(path.dirname(BANK_PATH), "pro-bank.json"), "utf8"));
    cache.questions = [...(pro.questions ?? []), ...cache.questions]; // Pro 优先
  } catch { /* 无 Pro 题库时仅基座 */ }
  return cache;
}

/** 房间难度(若未来落库)映射到题库三档;junior/mid/senior 直通。 */
const DIFF_MAP = { easy: "junior", normal: "mid", hard: "senior", extreme: "senior", hell: "senior" };

// ── 简历感知出题 ───────────────────────────────────────────────────────────
// 词库从题库全部 questions 的 keyPoints+tags 派生(小写去重),随 loadBank 缓存。
// 纯词面匹配,无 LLM:简历文本里出现词库中的技术词(含中文词,包含匹配)即命中。
let vocabCache = null;
function skillVocab() {
  if (vocabCache) return vocabCache;
  const set = new Set();
  for (const q of loadBank().questions) {
    for (const s of [...(q.keyPoints ?? []), ...(q.tags ?? [])]) {
      const w = String(s ?? "").trim().toLowerCase();
      if (w) set.add(w);
    }
  }
  vocabCache = [...set];
  return vocabCache;
}

/** 从文本提取技术关键词:按出现频次降序(同频保持词库序),最多 20 个。 */
export function extractSkillKeywords(text) {
  const t = String(text ?? "").toLowerCase();
  if (!t) return [];
  const hits = [];
  for (const w of skillVocab()) {
    if (w.length < 2) continue; // 单字符噪声
    let count = 0, i = t.indexOf(w);
    while (i !== -1) { count += 1; i = t.indexOf(w, i + w.length); }
    if (count > 0) hits.push({ w, count });
  }
  hits.sort((a, b) => b.count - a.count); // sort 稳定:同频保持原(词库)序
  return hits.slice(0, 20).map((h) => h.w);
}

/** 题与关键词的交集数:keyPoints/tags 任一条目包含关键词即记 1。 */
function resumeScore(q, keywords) {
  const hay = [...(q.keyPoints ?? []), ...(q.tags ?? [])].join("\n").toLowerCase();
  return keywords.reduce((n, k) => n + (hay.includes(k) ? 1 : 0), 0);
}

export function pickQuestion({ roomId, industry = null, difficulty = null, resumeText = null }) {
  const bank = loadBank().questions;
  const used = new Set(
    getDb().prepare("SELECT content FROM room_messages WHERE room_id = ? AND role = 'interviewer'").all(roomId)
      .map((r) => { try { return JSON.parse(r.content).question_ref; } catch { return null; } })
      .filter(Boolean));
  const wantDiff = DIFF_MAP[difficulty] ?? null;
  const keywords = resumeText ? extractSkillKeywords(resumeText) : [];
  const tiers = [
    (q) => q.industry === industry && (!wantDiff || q.difficulty === wantDiff),
    (q) => q.industry === industry,                       // 放宽难度
    () => true,                                           // 放宽行业(全库兜底)
  ];
  for (const tier of tiers) {
    const candidates = bank.filter((x) => tier(x) && !used.has(x.id));
    if (candidates.length === 0) continue;
    // 简历加权:同 tier 内按交集数降序(稳定排序,交集 0 保持题库原序);
    // 无简历/无命中词时与旧行为完全一致(题库顺序第一题)。
    const q = keywords.length
      ? candidates.map((x) => ({ x, s: resumeScore(x, keywords) })).sort((a, b) => b.s - a.s)[0].x
      : candidates[0];
    return {
      question_ref: q.id, title: q.title, content: q.content.slice(0, 2000),
      type: q.type, difficulty: q.difficulty, industry: q.industry,
      estimated_minutes: q.estimatedMinutes ?? null,
    };
  }
  return null; // 题库耗尽(全部用过)
}
