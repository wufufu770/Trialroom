// v11:分析路由 —— 语音转写 / 逐题反馈 / 简历押题
// 挂载在 /api 下(通用限流已覆盖;LLM 调用走 chatProxy 复用故障转移 + PII 脱敏 + token 记录)
import express from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { genId } from "../db.js";
import { chatProxy } from "../llm.js";
import { transcribeAudio, estimateWPM } from "../services/whisper.js";
import {
  DB_DIR_EXPORT,
  createAnswerRecording,
  listAnswerRecordings,
  createQuestionFeedback,
  listQuestionFeedback,
  listMissedQuestions,
  setQuestionMissed,
  deleteQuestionFeedback,
  getSession,
  getSessionTranscript,
  getMaterialContent,
  getActiveProvider,
  getTodayTokenUsage,
  recordTokenUsage,
  ValidationError,
  NotFoundError,
} from "../db.js";

const router = express.Router();
const UPLOAD_DIR = path.join(DB_DIR_EXPORT, "uploads");
const DAILY_TOKEN_BUDGET = Number(process.env.DAILY_TOKEN_BUDGET) || 500000;

// 从 LLM 回复提取 JSON(容错处理):
// 1. 剥离 <think>...</think> 思考块(MiniMax 等推理模型默认输出,会污染 JSON 解析)
// 2. 剥离 markdown 代码围栏
// 3. 截取首个 { 或 [ 到末尾对应括号之间的内容
function extractJson(content) {
  let s = String(content || "");
  // 剥 think 块(含嵌套标签变体)
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // 剥代码围栏
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  // 定位 JSON 主体(对象或数组)
  const first = s.search(/[[{]/);
  if (first < 0) return null;
  const lastBrace = s.lastIndexOf("}");
  const lastBracket = s.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (end <= first) return null;
  const slice = s.slice(first, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    return null;
  }
}

// ---- 群面个人表现报告(纯函数 + 路由) ----
// 背景:群面结束后用户发言无任何评估("玩完即丢")。
// 本节:把群面消息中的用户发言提取 → 清洗 → 截断 → 单次 LLM 评估 → 强校验后返回。
// 安全:发言进 LLM 前由 chatProxy 自带 PII 脱敏;此处额外做不可见字符清洗
// (零宽字符/双向控制符,防提示注入伪装与长度统计失真,stripInvisibleChars 简版内联)。
const GROUP_INVISIBLE_RE = /[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g;
const GROUP_REPORT_MAX_MESSAGES = 40;   // 条数护栏
const GROUP_REPORT_MAX_CHARS = 6000;    // 总长护栏(字符)
const GROUP_REPORT_DIMENSIONS = [
  ["logic", "逻辑思维"],
  ["communication", "沟通表达"],
  ["teamwork", "团队协作"],
];

// 清洗单条文本:去不可见字符 + 统一换行 + 去首尾空白
function cleanGroupSpeech(s) {
  return String(s || "")
    .replace(GROUP_INVISIBLE_RE, "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

// 纯函数:从群面消息中提取用户发言并拼接为评估文本。
// 兼容两种消息形态:analysis 约定 {role:"user"} 与群面页原生的
// {speakerKind:"user"} / {speakerId:"user"}(MeetingMessage 结构)。
// 护栏:最多取 40 条;拼接总长超 6000 字符即截断(末尾标注)。
// 返回拼接后的 transcript 字符串(无用户发言时返回空串)。
export function buildGroupReportTranscript(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const speeches = [];
  for (const m of list) {
    if (!m || typeof m !== "object") continue;
    const isUser = m.role === "user" || m.speakerKind === "user" || m.speakerId === "user";
    if (!isUser) continue;
    const content = cleanGroupSpeech(m.content);
    if (!content) continue;
    speeches.push(content);
    if (speeches.length >= GROUP_REPORT_MAX_MESSAGES) break;
  }
  if (speeches.length === 0) return "";
  let transcript = speeches.join("\n");
  if (transcript.length > GROUP_REPORT_MAX_CHARS) {
    transcript = `${transcript.slice(0, GROUP_REPORT_MAX_CHARS)}\n…(发言过长,已截断)`;
  }
  return transcript;
}

// 纯函数:解析并强校验群面报告的 LLM 输出。
// 任何不合法(JSON 解析失败/字段缺失/分数越界/列表为空)都抛 ValidationError
// (全局错误处理器映射为 400 VALIDATION_ERROR),绝不返回未校验结构。
// 合法输出:{dimensions:{logic,communication,teamwork 各 1-5 整数},
//           strengths:[≤3 条非空字符串], improvements:[≤3 条非空字符串]}
export function parseGroupReport(raw) {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ValidationError("群面报告解析失败:模型输出不是合法 JSON 对象,请重试");
  }
  const dims = parsed.dimensions;
  if (!dims || typeof dims !== "object" || Array.isArray(dims)) {
    throw new ValidationError("群面报告解析失败:缺少 dimensions 字段,请重试");
  }
  const dimensions = {};
  for (const [key, label] of GROUP_REPORT_DIMENSIONS) {
    const v = Number(dims[key]);
    if (!Number.isInteger(v) || v < 1 || v > 5) {
      throw new ValidationError(
        `群面报告解析失败:维度「${label}」分数缺失或越界(需 1-5 整数,实际为 ${JSON.stringify(dims[key]) ?? "undefined"})`,
      );
    }
    dimensions[key] = v;
  }
  const toList = (value, label) => {
    if (!Array.isArray(value)) {
      throw new ValidationError(`群面报告解析失败:缺少 ${label} 列表,请重试`);
    }
    const items = value
      .filter((x) => typeof x === "string" && x.trim())
      .map((x) => x.trim())
      .slice(0, 3);
    if (items.length === 0) {
      throw new ValidationError(`群面报告解析失败:${label} 列表为空,请重试`);
    }
    return items;
  };
  return {
    dimensions,
    strengths: toList(parsed.strengths, "strengths"),
    improvements: toList(parsed.improvements, "improvements"),
  };
}

// 音频 MIME 白名单(MediaRecorder 常见输出)
const ALLOWED_AUDIO_MIMES = new Set([
  "audio/webm", "audio/ogg", "audio/wav", "audio/x-wav",
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a",
]);

const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_AUDIO_MIMES.has(file.mimetype)) return cb(null, true);
    cb(new ValidationError(`不支持的音频类型:${file.mimetype}(支持 webm/ogg/wav/mp3/m4a)`));
  },
});

// token 预算守卫(与 chat 端点一致,防 LLM 滥用)
function assertBudget() {
  const used = getTodayTokenUsage();
  if (used > DAILY_TOKEN_BUDGET) {
    throw new ValidationError(`已达日 token 预算(${DAILY_TOKEN_BUDGET}),请明天再试`, { code: "RATE_LIMITED" });
  }
}

function makeUsageRecorder(provider, sessionId) {
  return (totalTokens) => {
    try {
      recordTokenUsage(totalTokens, provider, sessionId);
    } catch (e) {
      // token 记录失败不阻塞主流程
    }
  };
}

// ---- 语音转写(本地 whisper) ----
// POST /api/transcribe  multipart: audio(必填), sessionId(必填), agentId?, question?, language?, durationMs?
router.post("/transcribe", audioUpload.single("audio"), async (req, res, next) => {
  try {
    if (!req.file) throw new ValidationError("audio 文件为必填");
    const { sessionId, agentId, question, language, durationMs } = req.body;
    if (!sessionId) throw new ValidationError("sessionId 为必填");
    if (!getSession(sessionId)) throw new NotFoundError("会话");

    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    // 安全加固(platform 2026-10-27,二轮):文件名彻底去用户化 —— 存储名恒为
    // <随机id>.webm,原始扩展名不参与路径构造(此前白名单方案仍被静态扫描判
    // 为入口)。转写走 req.file.buffer,扩展名仅是磁盘命名,无功能影响。
    const audioName = `${genId("rec")}.webm`;
    const audioPath = path.join(UPLOAD_DIR, audioName);
    fs.writeFileSync(audioPath, req.file.buffer);

    // 本地 whisper 转写(模型缺失时返回 ok:false,前端降级提示)
    const result = await transcribeAudio(req.file.buffer, language || "zh", DB_DIR_EXPORT);
    const durationSec = Math.max(Number(durationMs) || 0, 0) / 1000;
    const wpm = result.ok ? estimateWPM(result.text, durationSec || (result.chunks.length ? result.chunks.at(-1).timestamp[1] : 0)) : 0;

    let recordingId = null;
    if (result.ok) {
      recordingId = createAnswerRecording({
        sessionId,
        agentId: agentId || null,
        question: question || "",
        audioPath: audioName,
        transcript: result.text,
        wpm,
        durationMs: Number(durationMs) || 0,
        model: result.model,
      }).recordingId;
    }

    res.ok({
      ok: result.ok,
      recordingId,
      text: result.text,
      wpm,
      chunks: result.chunks,
      mode: result.mode,
      error: result.error || null,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/sessions/:id/recordings 语音答题记录列表
router.get("/sessions/:id/recordings", (req, res) => {
  res.ok(listAnswerRecordings(req.params.id));
});

// ---- 逐题反馈(LLM 单题评估) ----
// POST /api/sessions/:id/answers/score  { provider, question, answer }
router.post("/sessions/:id/answers/score", async (req, res, next) => {
  try {
    const sessionId = req.params.id;
    if (!getSession(sessionId)) throw new NotFoundError("会话");
    const { provider, question, answer } = req.body;
    if (!provider) throw new ValidationError("provider 为必填");
    if (!question || !String(question).trim()) throw new ValidationError("question 为必填");
    if (!answer || !String(answer).trim()) throw new ValidationError("answer 为必填");
    assertBudget();

    const prompt = `请以资深面试官视角,对这道面试题的回答做逐题反馈。题目: ${question}
用户回答: ${answer}

严格输出 JSON(不要输出其他内容,不要 markdown 代码块,不要输出思考过程/think 标签):
{
  "score": 1-10 的整数或一位小数,
  "starAnalysis": {"situation": "是否描述情境(1-2句)", "task": "任务目标(1-2句)", "action": "行动(1-2句)", "result": "结果是否量化(1-2句)"},
  "weaknessTags": ["短板标签1", "短板标签2"(2-4个,如: 缺乏量化结果/逻辑跳跃/未用STAR)],
  "improvement": "针对这个回答的具体改进建议(2-3句)",
  "betterAnswer": "更好的回答示例(用STAR结构,150字以内)"
}`;

    const result = await chatProxy(provider, {
      messages: [{ role: "user", content: prompt }],
      stream: false,
      sessionId,
    }, null, makeUsageRecorder(provider, sessionId));

    const parsed = extractJson(result?.content || "");
    if (!parsed || typeof parsed.score !== "number") {
      return res.ok({
        ok: false,
        error: "评估结果解析失败,请重试",
        feedbackId: null,
        raw: (result?.content || "").slice(0, 500),
      });
    }

    const feedbackId = createQuestionFeedback({
      sessionId,
      question: String(question),
      answer: String(answer),
      score: Math.min(Math.max(parsed.score, 0), 10),
      weaknessTags: Array.isArray(parsed.weaknessTags) ? parsed.weaknessTags.slice(0, 6) : [],
      improvement: parsed.improvement || null,
      betterAnswer: parsed.betterAnswer || null,
    }).feedbackId;

    res.ok({
      ok: true,
      feedbackId,
      score: parsed.score,
      starAnalysis: parsed.starAnalysis || null,
      weaknessTags: Array.isArray(parsed.weaknessTags) ? parsed.weaknessTags : [],
      improvement: parsed.improvement || "",
      betterAnswer: parsed.betterAnswer || "",
      degraded: !!result.degraded,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/sessions/:id/answers 逐题反馈列表
router.get("/sessions/:id/answers", (req, res) => {
  res.ok(listQuestionFeedback(req.params.id));
});

// PUT /api/answers/:feedbackId/missed  { isMissed } 错题标记
router.put("/answers/:feedbackId/missed", (req, res) => {
  const isMissed = !!req.body?.isMissed;
  setQuestionMissed(req.params.feedbackId, isMissed);
  res.ok({ ok: true, isMissed });
});

// GET /api/missed-questions 跨会话错题本(★3)
// 聚合 question_feedback WHERE is_missed=1:按题干去重,保留最近一次
// myAnswer/sessionId/时间与短板标签,累计 missed 次数,最近优先,默认 LIMIT 100。
// 与同文件其他 analysis 路由一致,鉴权由全局 /api authMiddleware 覆盖(登录态私有)。
router.get("/missed-questions", (req, res) => {
  res.ok(listMissedQuestions(req.query.limit));
});

// DELETE /api/answers/:feedbackId 删除一条反馈
router.delete("/answers/:feedbackId", (req, res) => {
  deleteQuestionFeedback(req.params.feedbackId);
  res.ok({ ok: true });
});

// ---- 简历/JD 押题 ----
// POST /api/analysis/predict-questions  { provider, materialId?, resumeText?, jdText? }
router.post("/analysis/predict-questions", async (req, res, next) => {
  try {
    const { provider, materialId, resumeText, jdText } = req.body;
    if (!provider) throw new ValidationError("provider 为必填");

    // W4-4:与服务端/前端统一的长度上限。
    // 此前这里是硬编码 20000/10000,而主链路无上限 —— 两条路径标准不一致,
    // 导致同一份资料在押题时被截断、在正式面试时却全量注入。
    const RESUME_LIMIT = 20000;
    const JD_LIMIT = 10000;
    const clip = (s, max) => {
      const src = String(s || "");
      return src.length <= max ? src : `${src.slice(0, max)}\n…(已省略 ${src.length - max} 字符)`;
    };

    let resume = resumeText || "";
    if (!resume && materialId) {
      const mat = getMaterialContent(materialId);
      if (mat?.rawText) resume = clip(mat.rawText, RESUME_LIMIT);
    }
    if (!resume || !resume.trim()) throw new ValidationError("需要简历文本(materialId 或 resumeText)");
    assertBudget();

    const jd = (jdText || "").trim();
    const prompt = `你是一位资深面试官,根据候选人的简历${jd ? "和目标岗位 JD" : ""},预测面试最可能被问到的问题。
简历: ${clip(resume, RESUME_LIMIT)}
${jd ? `岗位 JD: ${clip(jd, JD_LIMIT)}` : ""}

输出 6-8 道押题,严格输出 JSON 数组(不要输出其他内容,不要 markdown 代码块,不要输出思考过程/think 标签,字符串内不要使用换行):
[
  {"question": "具体问题(一句话)", "category": "技术/项目/行为/场景/动机", "difficulty": 3, "intent": "面试官想考察什么(一句话)", "keyPoints": "要点1;要点2;要点3(用分号分隔,不要用数组)"}
]`;

    const result = await chatProxy(provider, {
      messages: [{ role: "user", content: prompt }],
      stream: false,
    }, null, makeUsageRecorder(provider, null));

    let questions = [];
    const parsed = extractJson(result?.content || "");
    if (Array.isArray(parsed)) {
      questions = parsed.filter((q) => q && typeof q.question === "string").slice(0, 8);
    }

    if (questions.length === 0) {
      return res.ok({ ok: false, questions: [], error: "押题结果解析失败,请重试" });
    }
    res.ok({ ok: true, questions, degraded: !!result.degraded });
  } catch (e) {
    next(e);
  }
});

// ---- 群面个人表现报告 ----
// POST /api/group-report  { provider?, messages: [{role, content}...], position? }
// 鉴权:与同文件其他 analysis 路由一致,由全局 /api authMiddleware 覆盖(登录态私有)。
// messages 兼容群面页原生 MeetingMessage 形态(role/speakerKind/speakerId 任一为 "user"
// 即视为用户发言);provider 缺省时回退当前激活供应商。
router.post("/group-report", async (req, res, next) => {
  try {
    const { provider, position } = req.body || {};
    // 纯函数提取用户发言(含 40 条 / 6000 字符护栏),空串即无有效用户发言
    const transcript = buildGroupReportTranscript(req.body?.messages);
    if (!transcript) {
      throw new ValidationError("没有可评估的用户发言(messages 中未找到非空的用户发言)");
    }
    const providerId = provider || getActiveProvider()?.providerId;
    if (!providerId) {
      throw new ValidationError("provider 为必填(或先在设置中激活一个模型供应商)");
    }
    assertBudget();

    const pos = cleanGroupSpeech(position).slice(0, 200);
    const prompt = `你是一位资深群面(无领导小组讨论)面试官,请仅基于下面这位候选人在群面中的全部发言,评估其个人表现。
${pos ? `讨论主题/目标岗位: ${pos}\n` : ""}候选人发言记录(按时间顺序,已脱敏):
${transcript}

请从六个面试维度中选取以下三个维度打分(1-5 整数):logic=逻辑思维, communication=沟通表达, teamwork=团队协作。
严格输出 JSON(不要输出其他内容,不要 markdown 代码块,不要输出思考过程/think 标签,字符串内不要使用换行):
{"dimensions":{"logic":1到5的整数,"communication":1到5的整数,"teamwork":1到5的整数},"strengths":["优势1","优势2","优势3"(最多3条,每条一句话,须具体到其发言行为)],"improvements":["改进建议1","改进建议2","改进建议3"(最多3条,可执行)]}
若发言过少不足以评估某维度,该维度给最低分并在 improvements 中说明。`;

    // 单次 LLM 调用:复用 chatProxy 故障转移 + PII 脱敏 + token 记账
    const result = await chatProxy(providerId, {
      messages: [{ role: "user", content: prompt }],
      stream: false,
      maxTokens: 600,
      temperature: 0.3,
    }, null, makeUsageRecorder(providerId, null));

    // 解析容错:任何不合法都以 400 VALIDATION 透出(带原因与模型输出片段便于排查),
    // 绝不把未校验结构返回给客户端
    let report;
    try {
      report = parseGroupReport(result?.content);
    } catch (e) {
      const rawPreview = String(result?.content || "").slice(0, 200);
      throw new ValidationError(`${e instanceof Error ? e.message : "群面报告解析失败"}(模型输出片段: ${rawPreview})`);
    }

    res.ok({ ok: true, report, degraded: !!result.degraded });
  } catch (e) {
    next(e);
  }
});

// ---- 逐字稿回放(纯函数 + 路由) ----
// 背景:一场面试的复盘数据散落三张表(问答 messages / 逐题评估 evaluations /
// 语音答题 answer_recordings),db.getSessionTranscript 负责聚合原料行,
// 这里做两件事:
//   1. buildTranscriptTimeline(raw):纯函数 —— 去重(显式 key 优先,缺失时按
//      kind+t+text 合成)、同 key 评估行合并维度、按 t 稳定升序、文本截断。
//      抽成纯函数是为了不建库也能单测排序/去重/截断这些最容易回归的逻辑。
//   2. GET /api/sessions/:id/transcript:鉴权与同文件其他 analysis 路由一致 ——
//      index.js 的全局 /api authMiddleware 挂载在本路由之前(2026-10-27 修复后
//      的顺序,见 index.js:120-141),登录态私有;session 不存在 → 404。
const TRANSCRIPT_KINDS = new Set(["question", "answer", "evaluation", "recording"]);
const TRANSCRIPT_TEXT_LIMIT = 300;
const TRANSCRIPT_EVIDENCE_LIMIT = 200;

function clipTranscriptText(value, n) {
  const s = String(value ?? "").trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

// SQLite datetime('now') 是 "YYYY-MM-DD HH:MM:SS"(UTC),空格分隔符 Date.parse
// 在部分引擎拒收;换 "T" 后即可解析。解析失败(字段脏数据)返回 null,
// 由调用方回退字典序比较(SQLite 格式本身字典序即时间序)。
function parseTimelineTs(s) {
  const v = Date.parse(String(s ?? "").replace(" ", "T"));
  return Number.isNaN(v) ? null : v;
}

// 纯函数:聚合行 → 去重排序后的逐字稿时间轴。
// 输入:db.getSessionTranscript 的原料行(或测试构造的等形态行),
//   每行 { t, kind, role, text, key?, dims?, evidence?, overallScore?, question?, wpm?, durationMs? }。
// 输出:[{ t, kind, role, text(≤300), key, dims?, evidence?, ... }] 按 t 升序;
//   同 key 的多行(如评估维度被拆成多行)合并为一条,dim 按名去重;
//   非法行(null / 缺 kind / 未知 kind)直接丢弃,绝不透传脏结构。
export function buildTranscriptTimeline(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  const byKey = new Map();
  const items = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const kind = row.kind;
    if (!TRANSCRIPT_KINDS.has(kind)) continue;
    const t = row.t == null ? "" : String(row.t);
    // 去重主键:显式 key 优先;无 key 时同一时刻同一句话只保留第一条
    const key = row.key ? String(row.key) : `${kind}|${t}|${String(row.text || "")}`;

    const existing = byKey.get(key);
    if (existing) {
      // 同 key 合并:维度分多行来源时并进同一条评估(按维度名去重)
      if (Array.isArray(row.dims)) {
        const seen = new Set(existing.dims.map((d) => d.name));
        for (const d of row.dims) {
          if (d && d.name && !seen.has(d.name)) {
            existing.dims.push({
              name: String(d.name),
              score: Number(d.score) || 0,
              evidence: clipTranscriptText(d.evidence ?? d.comment, TRANSCRIPT_EVIDENCE_LIMIT),
            });
            seen.add(d.name);
          }
        }
      }
      continue;
    }

    const item = {
      t,
      kind,
      role: String(row.role || ""),
      text: clipTranscriptText(row.text, TRANSCRIPT_TEXT_LIMIT),
      key,
    };
    if (kind === "evaluation") {
      const overall = Number(row.overallScore);
      item.overallScore = Number.isFinite(overall) ? overall : null;
      item.dims = (Array.isArray(row.dims) ? row.dims : [])
        .filter((d) => d && d.name)
        .map((d) => ({
          name: String(d.name),
          score: Number(d.score) || 0,
          evidence: clipTranscriptText(d.evidence ?? d.comment, TRANSCRIPT_EVIDENCE_LIMIT),
        }));
      item.evidence = clipTranscriptText(row.evidence, TRANSCRIPT_EVIDENCE_LIMIT);
    }
    if (kind === "recording") {
      item.question = clipTranscriptText(row.question, 120);
      item.wpm = Number(row.wpm) || 0;
      item.durationMs = Number(row.durationMs) || 0;
    }
    byKey.set(key, item);
    items.push(item);
  }

  // 稳定排序:t 升序,同 t(同秒写入)按 key 决出确定序
  return items.sort((a, b) => {
    const ta = parseTimelineTs(a.t);
    const tb = parseTimelineTs(b.t);
    if (ta !== null && tb !== null && ta !== tb) return ta - tb;
    return String(a.t).localeCompare(String(b.t)) || a.key.localeCompare(b.key);
  });
}

// GET /api/sessions/:id/transcript 逐字稿回放时间轴
router.get("/sessions/:id/transcript", (req, res, next) => {
  try {
    const raw = getSessionTranscript(req.params.id);
    if (raw === null) throw new NotFoundError("会话");
    // 对抗审查 R4-P2:行数封顶 2000(取最新),truncated 供前端提示
    res.ok({ ok: true, transcript: buildTranscriptTimeline(raw), truncated: raw.length >= 2000 });
  } catch (e) {
    next(e);
  }
});

export default router;
