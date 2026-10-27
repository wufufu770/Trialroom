// 证据抽取器(P2#15,11-final-plan §3.6 两段式):
//   第一段 边界化:单条 ≤8KB、每次 ≤20 条、stripInvisibleChars(不可见字符攻击面)
//   第二段 结构化:固定 JSON Schema {facts:[{who,when,what,result,metric}]},
//                  additionalProperties=false;失败整条丢弃 + 审计(audit 表)
// LLM 路径复用 TRIALROOM_LLM_*(与判官同源,出网主机校验);无 key → 规则降级抽取。
// 纪律(A4):抽取产物只进证据区;评分 prompt 永不拼接原始证据字段(门禁静态断言)。
import { getDb, genId } from "../db.mjs";

export const LIMITS = Object.freeze({ ITEM_MAX: 8192, ITEMS_MAX: 20, IN_TOKENS: 6000, OUT_TOKENS: 1500 });

// 不可见字符/双向文本/零宽 —— 洗掉(提示注入与视觉欺骗的常见载体)
export function stripInvisibleChars(s) {
  return String(s)
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

function assertSafeHost(urlStr) {
  const u = new URL(urlStr);
  const h = u.hostname;
  if (!/^https?:$/.test(u.protocol) || h === "localhost" || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h === "::1") {
    throw new Error("LLM 地址不安全,已拒绝");
  }
}

const SCHEMA_HINT = `只输出 JSON:{"facts":[{"who":"≤120字","when":"≤60字","what":"≤120字","result":"≤200字","metric":"≤60字"}]} 不含其他文本。抽取客观事实,不要评价。`;

async function llmExtract(items) {
  const key = process.env.TRIALROOM_LLM_API_KEY;
  if (!key) return null;
  const base = `${process.env.TRIALROOM_LLM_BASE_URL ?? "https://api.minimax.chat/v1"}/chat/completions`;
  assertSafeHost(base);
  const res = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.TRIALROOM_LLM_MODEL ?? "MiniMax-M2",
      temperature: 0, max_tokens: LIMITS.OUT_TOKENS,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `你是事实抽取器。${SCHEMA_HINT}` },
        { role: "user", content: items.map((x, i) => `[${i}] ${x.slice(0, LIMITS.ITEM_MAX)}`).join("\n").slice(0, LIMITS.IN_TOKENS * 2) },
      ],
    }),
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? null;
}

const clip = (v, n) => String(v ?? "").slice(0, n);

/** 规则降级抽取:句子切分取前 N 条客观句(无 LLM 时的可用路径,标注 source)。 */
function ruleExtract(items) {
  const facts = [];
  for (const raw of items) {
    for (const sent of stripInvisibleChars(raw).split(/[。;\n]/)) {
      const s = sent.trim();
      if (s.length >= 8 && facts.length < LIMITS.ITEMS_MAX) {
        facts.push({ who: "unknown", when: "", what: clip(s, 120), result: "", metric: "" });
      }
    }
  }
  return { facts: facts.slice(0, LIMITS.ITEMS_MAX), source: "rule" };
}

function validateFacts(obj) {
  const facts = Array.isArray(obj?.facts) ? obj.facts : null;
  if (!facts) return null;
  return {
    facts: facts.slice(0, LIMITS.ITEMS_MAX).map((f) => ({
      who: clip(f.who, 120), when: clip(f.when, 60), what: clip(f.what, 120),
      result: clip(f.result, 200), metric: clip(f.metric, 60),
    })),
    source: "llm",
  };
}

/**
 * 两段式抽取入口。返回 {facts, source, dropped} —— 任何失败整批丢弃并审计,
 * 绝不返回未校验结构(证据区只收结构化事实,不收自由文本)。
 */
export async function extractFacts(items) {
  const db = getDb();
  const bounded = (Array.isArray(items) ? items : [])
    .map((x) => stripInvisibleChars(String(x ?? "")))
    .filter((x) => x.trim().length > 0)
    .slice(0, LIMITS.ITEMS_MAX);
  if (bounded.length === 0) return { facts: [], source: "noop", dropped: 0 };
  let out = null;
  try {
    const raw = await llmExtract(bounded);
    if (raw) out = validateFacts(JSON.parse(raw));
  } catch (e) {
    db.prepare(`INSERT INTO mcp_audit (id, decision, deny_reason, method) VALUES (?, 'deny', ?, 'evidence.extractor')`)
      .run(genId("aud"), `EXTRACT_FAIL:${String(e.message).slice(0, 48)}`);
  }
  if (!out) out = ruleExtract(bounded);
  return { ...out, dropped: bounded.length - out.facts.length };
}
