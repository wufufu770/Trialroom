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

export function pickQuestion({ roomId, industry = null, difficulty = null }) {
  const bank = loadBank().questions;
  const used = new Set(
    getDb().prepare("SELECT content FROM room_messages WHERE room_id = ? AND role = 'interviewer'").all(roomId)
      .map((r) => { try { return JSON.parse(r.content).question_ref; } catch { return null; } })
      .filter(Boolean));
  const wantDiff = DIFF_MAP[difficulty] ?? null;
  const tiers = [
    (q) => q.industry === industry && (!wantDiff || q.difficulty === wantDiff),
    (q) => q.industry === industry,                       // 放宽难度
    () => true,                                           // 放宽行业(全库兜底)
  ];
  for (const tier of tiers) {
    const q = bank.find((x) => tier(x) && !used.has(x.id));
    if (q) {
      return {
        question_ref: q.id, title: q.title, content: q.content.slice(0, 2000),
        type: q.type, difficulty: q.difficulty, industry: q.industry,
        estimated_minutes: q.estimatedMinutes ?? null,
      };
    }
  }
  return null; // 题库耗尽(全部用过)
}
