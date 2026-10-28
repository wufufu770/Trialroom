import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import type { TranscriptItem } from "@/api/client";
import { cn, formatTime } from "@/shared";
import { EVALUATION_DIMENSIONS } from "@/lib/evaluation/starEvaluator";
import { computePersonalBaseline, shouldShowBaseline } from "@/lib/evaluation/baseline";
import { scoreWithRetry, aggregateScores } from "@/lib/evaluation/scoringEngine";
import { createLimit } from "@/lib/limit";
import { scoreExpression } from "@/lib/evaluation/expressionScorer";
import { analyzeWeakness, type WeaknessResult } from "@/lib/analysis/weaknessAnalyzer";
import { computeGroupSummaryLocal, type GroupSummary } from "@/lib/groupSummary";
import { exportSessionAsMarkdown, exportSessionAsJSON, exportSessionAsPDF } from "@/lib/exporter";
import { ProgressCurve } from "@/components/charts/ProgressCurve";
import { EvaluationRadar } from "@/components/charts/EvaluationRadar";
import { SessionReviewCard } from "@/components/SessionReviewCard";
import { WeaknessRecommendCard } from "@/components/WeaknessRecommendCard";
import { GroupSummaryCard } from "@/components/GroupSummaryCard";
import { InfoTip } from "@/components/InfoTip";
import { Heatmap } from "@/components/Heatmap";
import { SessionGroupSidebar } from "@/components/SessionGroupSidebar";
import { ReviewDiscussion } from "@/components/ReviewDiscussion";
import { useGroupStore } from "@/stores/groupStore";
import { useI18n } from "@/i18n";
import { buildHeatmapData } from "@/lib/heatmapData";
import { normalizeAgent, type Agent } from "@/types/agent";
import type { SessionInfo, SessionReview } from "@/types/session";
import { Sparkles, Loader2, AlertCircle, Star, TrendingUp, AlertTriangle, FolderOpen, Flame, MessagesSquare, Download, FileJson, FileText, BookX, Mic } from "lucide-react";

// 错题列表项(★3:GET /api/missed-questions 聚合行,camelCase)
interface MissedQuestion {
  question: string;
  answer: string;
  sessionId?: string;
  weaknessTags?: string[];
  betterAnswer?: string | null;
  lastMissedAt?: string;
  missedCount?: number;
}

interface Message {
  id?: string;
  messageId?: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt?: string;
}

interface Evaluation {
  evaluationId: string;
  sessionId?: string;
  messageId?: string;
  overallScore?: number;
  report?: string;
  improvementAdvice?: string;
  betterAnswerSample?: string;
  dimensions?: { dimensionName: string; score: number; comment: string }[];
  generatedAt?: string;
  createdAt?: string;
  // API 可能返回 snake_case 字段(兼容后端直返)
  created_at?: string;
  id?: string;
}

// 并发限流统一走 @/lib/limit(该实现有单测覆盖:抛错必须释放槽位、
// 并发数 <=0 归一化为 1 以免死锁)。此处不再保留副本。

export function HistoryPage() {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [review, setReview] = useState<SessionReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  // 工程 P0:STAR 评估并发进度反馈
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  // 方案 5:复盘群聊覆盖层
  const [showReviewDiscussion, setShowReviewDiscussion] = useState(false);
  const [reviewAgents, setReviewAgents] = useState<Agent[]>([]);

  // 全局分析数据
  const [progressData, setProgressData] = useState<{ score: number; date: string; sessionId: string }[]>([]);
  const [weakness, setWeakness] = useState<WeaknessResult | null>(null);
  const [weaknessLoading, setWeaknessLoading] = useState(false);

  // 分组归纳数据
  const [allReviews, setAllReviews] = useState<any[]>([]);
  const [allEvals, setAllEvals] = useState<Evaluation[]>([]);

  // ★3 错题本:跨会话聚合 is_missed=1 的逐题反馈。静默失败(未登录/接口不可用)时不显示该区块。
  const [missedQuestions, setMissedQuestions] = useState<MissedQuestion[]>([]);
  const [missedLoaded, setMissedLoaded] = useState(false);
  const [missedExpanded, setMissedExpanded] = useState<string | null>(null); // 展开的题干(去重主键)
  const [missedTag, setMissedTag] = useState<string | null>(null);           // weakness tag 筛选

  // 逐字稿回放:时间轴合并 问答消息 + 逐题评估 + 语音录音(GET /sessions/:id/transcript)。
  // 懒加载:首次展开才拉取,避免给复盘页的常规浏览(曲线/雷达/错题本)增加一个串行请求。
  const [transcript, setTranscript] = useState<TranscriptItem[] | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const navigate = useNavigate();
  // W5-1(P2-4):个人历史基准,替代此前硬编码 3.5 的"同岗位平均"假线。
  // 数据来自用户自己的全部评估;样本不足时不显示,而不是画一条编出来的线。
  const personalBaseline = useMemo(
    () => computePersonalBaseline((allEvals as any[]).map((e) => e.dimensions || [])),
    [allEvals]
  );
  const showBaseline = shouldShowBaseline(allEvals.length);
  const [groupSummary, setGroupSummary] = useState<GroupSummary | null>(null);

  // 成长热力图数据(基于全局评估聚合最近 26 周活跃度)
  const heatmapData = useMemo(() => buildHeatmapData(allEvals as any[]), [allEvals]);

  // ★3:错题本的 weakness tag 全集(取前 12 个防刷屏)与筛选后的列表
  const missedAllTags = useMemo(() => {
    const s = new Set<string>();
    for (const q of missedQuestions) {
      for (const tg of q.weaknessTags || []) {
        if (tg) s.add(String(tg));
      }
    }
    return Array.from(s).slice(0, 12);
  }, [missedQuestions]);
  const filteredMissed = useMemo(
    () => (missedTag ? missedQuestions.filter((q) => (q.weaknessTags || []).includes(missedTag)) : missedQuestions),
    [missedQuestions, missedTag]
  );
  // 摘要截断:题干/回答在列表里只露一行,展开看全文
  const clip = (s: string | null | undefined, n = 60) => {
    const t = String(s || "").trim();
    return t.length > n ? t.slice(0, n) + "…" : t;
  };

  // C4:跨场能力雷达 - 聚合所有评估的 dimensions,展示综合能力分布
  const crossFieldRadar = useMemo(() => {
    const byDim = new Map<string, { sum: number; weight: number }>();
    let evalCount = 0;
    for (const e of allEvals) {
      if (!e.dimensions || e.dimensions.length === 0) continue;
      evalCount++;
      for (const d of e.dimensions) {
        const cur = byDim.get(d.dimensionName) || { sum: 0, weight: 0 };
        cur.sum += d.score;
        cur.weight += 1;
        byDim.set(d.dimensionName, cur);
      }
    }
    return {
      dimensions: Array.from(byDim.entries()).map(([name, v]) => ({
        dimensionName: name,
        score: v.weight > 0 ? Number((v.sum / v.weight).toFixed(2)) : 0,
      })),
      evalCount,
    };
  }, [allEvals]);

  // C4 P2.3:维度演进历史 - 每个维度的历史得分序列(按时间排序)
  // 用于 ProgressCurve 真正的演进曲线(每维度一条 Line)
  const dimensionHistory = useMemo(() => {
    // 按 createdAt 升序排序(最早的在最前面)
    const sorted = [...allEvals].sort((a, b) =>
      new Date(a.createdAt || a.created_at || 0).getTime() - new Date(b.createdAt || b.created_at || 0).getTime()
    );
    // 收集所有维度名
    const dimNames = new Set<string>();
    for (const e of sorted) {
      if (e.dimensions) {
        for (const d of e.dimensions) dimNames.add(d.dimensionName);
      }
    }
    // 每个维度提取历史得分序列
    return Array.from(dimNames).map(dimName => ({
      dimensionName: dimName,
      points: sorted
        .filter(e => e.dimensions && e.dimensions.some(d => d.dimensionName === dimName))
        .map(e => {
          const d = e.dimensions?.find((x) => x.dimensionName === dimName);
          if (!d) return null;
          return {
            score: d.score,
            date: e.createdAt || e.created_at || "",
            evaluationId: e.evaluationId || e.id || "",
          };
        })
        .filter((p): p is { score: number; date: string; evaluationId: string } => p !== null),
    }));
  }, [allEvals]);

  // 分组 store
  const groups = useGroupStore((s) => s.groups);
  const loadGroups = useGroupStore((s) => s.loadGroups);
  const createGroup = useGroupStore((s) => s.createGroup);
  const updateGroup = useGroupStore((s) => s.updateGroup);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);

  const loadSessions = useCallback(async () => {
    try {
      const list = (await api.listSessions()) || [];
      setSessions(list as SessionInfo[]);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].sessionId);
    } catch (e: any) {
      setError(t("history.loadSessionsFailed", { msg: e.message }));
    }
  }, [selectedId, t]);

  // 加载全局评估数据(进步曲线 + 弱项分析 + 所有评价/评估供分组归纳用)
  const loadGlobalAnalysis = useCallback(async () => {
    try {
      const [allE, allR] = await Promise.all([
        api.listAllEvaluations(),
        api.listAllReviews().catch(() => []),
      ]);
      const evals = (allE as any[]) || [];
      const reviews = (allR as any[]) || [];
      setAllEvals(evals);
      setAllReviews(reviews);

      const points = evals
        .filter((e) => e.overallScore != null && (e.generatedAt || e.createdAt))
        .map((e) => ({
          score: e.overallScore,
          date: e.generatedAt || e.createdAt,
          sessionId: e.sessionId || "",
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      setProgressData(points);
    } catch {
      // 静默失败
    }

    setWeaknessLoading(true);
    try {
      const result = await analyzeWeakness(10);
      setWeakness(result);
    } catch {
      // 静默失败
    } finally {
      setWeaknessLoading(false);
    }

    // ★3:错题本聚合(基座认证,登录态私有)。失败静默 —— 区块整体不展示。
    try {
      setMissedQuestions((await api.listMissedQuestions()) || []);
    } catch {
      // 静默失败(未登录 401 / 题库接口不可用)
    } finally {
      setMissedLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    loadGlobalAnalysis();
    loadGroups();
  }, [loadSessions, loadGlobalAnalysis, loadGroups]);

  // 选中会话后加载详情(消息 + 评估 + 整场评价)
  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const [msgs, evals, rv] = await Promise.all([
        api.listMessages(selectedId),
        api.listEvaluations(selectedId),
        api.getSessionReview(selectedId).catch(() => null),
      ]);
      setMessages((msgs as any[]) || []);
      setEvaluations((evals as any[]) || []);
      setReview((rv as SessionReview | null) || null);
    } catch (e: any) {
      setError(t("history.loadDetailFailed", { msg: e.message }));
    } finally {
      setLoading(false);
    }
  }, [selectedId, t]);

  useEffect(() => {
    if (selectedId) loadDetail();
  }, [loadDetail]);

  // 逐字稿回放:切换会话时清空缓存并收起(下一场的时间轴懒加载重新拉)
  useEffect(() => {
    setTranscript(null);
    setShowTranscript(false);
  }, [selectedId]);

  // 逐字稿回放:展开/收起 + 首次展开时懒加载
  const handleToggleTranscript = async () => {
    if (showTranscript) {
      setShowTranscript(false);
      return;
    }
    setShowTranscript(true);
    if (transcript !== null || !selectedId) return;
    setTranscriptLoading(true);
    try {
      const r = await api.fetchSessionTranscript(selectedId);
      setTranscript((r?.transcript as TranscriptItem[]) || []);
    } catch (e: any) {
      setError(t("history.loadDetailFailed", { msg: e.message }));
      setTranscript([]);
    } finally {
      setTranscriptLoading(false);
    }
  };

  // 逐字稿时间轴条目渲染:question 左绿 / answer 右默认 / evaluation 黄卡 / recording 灰
  const renderTranscriptItem = (item: TranscriptItem, i: number) => {
    const timeLabel = item.t ? formatTime(item.t) : "";
    if (item.kind === "evaluation") {
      return (
        <div key={item.key || i} className="mx-auto w-full max-w-[92%] border border-ide-warning/40 bg-ide-warning/10 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-2 text-[10px] text-ide-warning">
            <span className="font-semibold uppercase">评估</span>
            {item.overallScore != null && (
              <span className="bg-ide-warning/20 px-1 font-semibold">{item.overallScore}/10</span>
            )}
            {timeLabel && <span className="ml-auto opacity-70">{timeLabel}</span>}
          </div>
          {(item.dims || []).length > 0 && (
            <div className="mb-1 grid gap-0.5">
              {(item.dims || []).map((d, di) => (
                <div key={di} className="flex items-baseline gap-2">
                  <span className="shrink-0 text-ide-fg-muted">{d.name}</span>
                  <span className="shrink-0 font-semibold text-ide-warning">{d.score}/5</span>
                  {d.evidence && (
                    <span className="min-w-0 truncate text-ide-fg-muted" title={d.evidence}>
                      「{clip(d.evidence, 48)}」
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
          {item.evidence && !(item.dims || []).length && (
            <div className="text-ide-fg-muted">{clip(item.evidence, 80)}</div>
          )}
        </div>
      );
    }
    if (item.kind === "recording") {
      const sec = Math.round((item.durationMs || 0) / 1000);
      return (
        <div key={item.key || i} className="w-full max-w-[92%] border-l-2 border-ide-border bg-ide-bg-alt px-2 py-1.5 text-ide-fg-muted">
          <div className="mb-1 flex items-center gap-2 text-[10px]">
            <Mic size={10} />
            <span className="font-semibold uppercase">录音</span>
            {!!sec && <span>{Math.floor(sec / 60)}:{String(sec % 60).padStart(2, "0")}</span>}
            {!!item.wpm && <span>{item.wpm} 字/分</span>}
            {timeLabel && <span className="ml-auto opacity-70">{timeLabel}</span>}
          </div>
          <div className="whitespace-pre-wrap">{item.text || "(无转写记录)"}</div>
          {item.question && <div className="mt-0.5 truncate opacity-70">题:{clip(item.question, 60)}</div>}
        </div>
      );
    }
    const isAnswer = item.kind === "answer";
    return (
      <div key={item.key || i} className={cn("flex w-full", isAnswer ? "justify-end" : "justify-start")}>
        <div
          className={cn(
            "max-w-[85%] border-l-2 px-2 py-1.5",
            isAnswer
              ? "border-ide-border bg-ide-bg-alt text-ide-fg"
              : "border-ide-success bg-ide-success/10 text-ide-fg"
          )}
        >
          <div className={cn("mb-1 text-[10px]", isAnswer ? "text-ide-fg-muted" : "text-ide-success")}>
            {isAnswer ? "A · 我" : "Q · 面试官"}
            {timeLabel && ` · ${timeLabel}`}
          </div>
          <div className="whitespace-pre-wrap">{item.text}</div>
        </div>
      </div>
    );
  };

  // 选中分组时计算归纳
  useEffect(() => {
    if (!selectedGroupId) {
      setGroupSummary(null);
      return;
    }
    const groupSessions = sessions.filter((s) => s.groupId === selectedGroupId);
    const groupSessionIds = new Set(groupSessions.map((s) => s.sessionId));
    const groupReviews = allReviews.filter((r: any) => groupSessionIds.has(r.sessionId));
    const groupEvals = allEvals.filter((e) => e.sessionId && groupSessionIds.has(e.sessionId));
    const summary = computeGroupSummaryLocal(groupSessions as any[], groupReviews, groupEvals as any[]);
    setGroupSummary(summary);
  }, [selectedGroupId, sessions, allReviews, allEvals]);

  const selected = sessions.find((s) => s.sessionId === selectedId);
  const selectedGroup = groups.find((g) => g.groupId === selectedGroupId);

  // 生成 STAR 评估
  const handleGenerateStar = async () => {
    if (!selected) return;
    setError(null);
    setGenerating(true);
    setProgress({ done: 0, total: 0 });
    try {
      const providers = (await api.listProviders()) || [];
      const providerId = selected.modelId || providers[0]?.id;
      if (!providerId) {
        setError(t("history.noModelAvailable"));
        setGenerating(false);
        setProgress(null);
        return;
      }

      const pairs: { question: string; answer: string; messageId?: string }[] = [];
      for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (m.role === "assistant") {
          const next = messages[i + 1];
          if (next && next.role === "user") {
            pairs.push({ question: m.content, answer: next.content, messageId: next.messageId || next.id });
          }
        }
      }

      if (pairs.length === 0) {
        setError(t("history.noQaPairs"));
        setGenerating(false);
        setProgress(null);
        return;
      }

      setProgress({ done: 0, total: pairs.length });
      // 工程 P0:串行 N+1 LLM 改并发(信号量限流 3 并发),每个 pair 完成后立即写 DB
      const limit = createLimit(3);
      let successCount = 0;
      let doneCount = 0;

      const evaluatePair = async (pair: { question: string; answer: string; messageId?: string }) => {
        try {
          /*
           * v2(ADR-001):每个维度独立评分,互不可见。
           * 旧实现是"一次调用输出 6 个维度 + 总分",会让维度间互相污染
           * (arXiv:2608.14684:联合评估仅 36% 样本级一致),且总分由 LLM 直接
           * 给出会重新引入锚定偏见(d=0.71)。现在总分由 6 个独立分数推导。
           */
          const scores = await Promise.all(
            EVALUATION_DIMENSIONS.map((d) =>
              limit(() => scoreWithRetry(d, pair.question, pair.answer, undefined, providerId))
            )
          );
          const agg = aggregateScores(scores);

          // P1-1:接入表达能力评分(纯文本分析,零 LLM 调用)
          const expr = scoreExpression(pair.answer);
          const speedLabel = expr.speedLevel === "slow" ? t("history.speedSlow") : expr.speedLevel === "fast" ? t("history.speedFast") : t("history.speedNormal");
          const exprLine = t("history.expressionLine", {
            speed: expr.speakingSpeed,
            speedLabel,
            fillerCount: expr.fillerCount,
            fillerFreq: expr.fillerFrequency,
            avgLen: expr.avgSentenceLength,
            connectorCount: expr.connectorCount,
          });
          // report 由可解释的汇总 + 逐维度锚点判定 + 原文依据拼成
          const dimLines = agg.dimensions
            .map(
              (d) =>
                `- ${d.dimensionName}: ${d.score}/5 (锚点 ${d.matchedAnchorId}${
                  d.noEvidence ? ",缺原文依据" : ""
                })${d.evidence.length ? ` 例:"${d.evidence[0].slice(0, 40)}"` : ""}`
            )
            .join("\n");
          const fullReport = [agg.overallSummary, dimLines, exprLine].join("\n");

          // 每个 pair 完成后立即写入 DB,不等全部完成
          await api.createEvaluation({
            sessionId: selected.sessionId,
            messageId: pair.messageId,
            overallScore: agg.overallScore,
            report: fullReport,
            improvementAdvice: agg.weaknesses.length
              ? `建议重点改进:${agg.weaknesses.map((w) => w.dimensionName).join("、")}`
              : undefined,
            dimensions: agg.dimensions.map((d) => ({
              dimensionName: d.dimensionName,
              // 雷达图量纲是 1-5,与维度分一致
              score: d.score,
              comment: `锚点 ${d.matchedAnchorId}${d.noEvidence ? "（缺原文依据）" : ""}${
                d.evidence.length ? ` 依据:${d.evidence[0].slice(0, 60)}` : ""
              }`,
            })),
          });
          successCount++;
        } catch (e) {
          // 单个 pair 失败不阻塞其他 pair;记录日志便于排查
          console.warn("[HistoryPage] evaluatePair 失败", e);
        } finally {
          doneCount++;
          setProgress({ done: doneCount, total: pairs.length });
        }
      };

      await Promise.all(pairs.map((p) => limit(() => evaluatePair(p))));
      await loadDetail();
      await loadGlobalAnalysis();
      if (successCount === 0) {
        setError(t("history.parseStarFailed"));
      }
    } catch (e: any) {
      setError(t("history.generateEvalFailed", { msg: e.message }));
    } finally {
      setGenerating(false);
      setProgress(null);
    }
  };

  // 分组操作回调
  const handleCreateGroup = async (name: string) => {
    try {
      await createGroup({ name, color: "#4f46e5" });
    } catch (e: any) {
      setError(t("history.createGroupFailed", { msg: e.message }));
    }
  };
  const handleRenameGroup = async (id: string, name: string) => {
    try {
      const g = groups.find((x) => x.groupId === id);
      await updateGroup(id, { name, color: g?.color, description: g?.description });
    } catch (e: any) {
      setError(t("history.renameGroupFailed", { msg: e.message }));
    }
  };
  const handleDeleteGroup = async (id: string) => {
    try {
      await deleteGroup(id);
      // 该组内的会话变为未分组,本地同步 groupId
      setSessions((prev) => prev.map((s) => (s.groupId === id ? { ...s, groupId: null } : s)));
    } catch (e: any) {
      setError(t("history.deleteGroupFailed", { msg: e.message }));
    }
  };
  const handleAssignSession = async (sessionId: string, groupId: string | null) => {
    try {
      await api.setSessionGroup(sessionId, groupId);
      setSessions((prev) => prev.map((s) => (s.sessionId === sessionId ? { ...s, groupId } : s)));
    } catch (e: any) {
      setError(t("history.moveSessionFailed", { msg: e.message }));
    }
  };

  // 选中会话/分组互斥
  const handleSelectSession = (id: string) => {
    setSelectedId(id);
    setSelectedGroupId(null);
  };
  const handleSelectGroup = (gid: string | null) => {
    setSelectedGroupId(gid);
    if (gid) setSelectedId(""); // 选中分组时清空会话选中
  };

  // 导出报告(MD / JSON / PDF)
  const handleExport = (format: "md" | "json" | "pdf") => {
    if (!selected || messages.length === 0) return;
    const session = {
      title: selected.title || t("history.defaultSessionTitle"),
      difficulty: selected.difficulty,
      flowTemplate: selected.flowTemplate,
      createdAt: selected.createdAt,
    };
    if (format === "md") {
      exportSessionAsMarkdown(session, messages, evaluations as any);
    } else if (format === "json") {
      exportSessionAsJSON(session, messages, evaluations as any);
    } else {
      exportSessionAsPDF(session, messages, evaluations as any);
    }
  };

  // 方案 5:打开复盘群聊
  // 取前 3 个面试官模板参与讨论;若无模板则使用全部
  const handleOpenReviewDiscussion = async () => {
    if (!selected || messages.length === 0) return;
    try {
      const list = (await api.listAgents("interviewer")) || [];
      const normalized = list.map(normalizeAgent);
      // 优先模板(isTemplate),取前 3;不足则补全
      const templates = normalized.filter((a) => a.isTemplate);
      const picked = templates.length > 0 ? templates.slice(0, 3) : normalized.slice(0, 3);
      // 前置检查:无可用面试官模板时直接报错并返回,避免打开空白群聊
      if (picked.length === 0) {
        setError(t("history.noInterviewerAgents"));
        return;
      }
      setReviewAgents(picked);
      setShowReviewDiscussion(true);
    } catch (e: any) {
      setError(t("history.loadAgentsFailed", { msg: e.message }));
    }
  };

  // 分组归纳模式
  if (selectedGroupId && selectedGroup) {
    return (
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-64 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
          <SessionGroupSidebar
            groups={groups}
            sessions={sessions}
            selectedSessionId={selectedId}
            selectedGroupId={selectedGroupId}
            onSelectSession={handleSelectSession}
            onSelectGroup={handleSelectGroup}
            onCreateGroup={handleCreateGroup}
            onRenameGroup={handleRenameGroup}
            onDeleteGroup={handleDeleteGroup}
            onAssignSession={handleAssignSession}
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
            <FolderOpen size={13} className="text-ide-accent" />
            <span className="truncate text-ide-fg">{selectedGroup.name}</span>
            <span className="text-ide-fg-muted">{t("history.groupSummary")}</span>
          </div>
          {error && (
            <div role="alert" className="flex items-center gap-2 border-b border-ide-danger/30 bg-ide-danger/10 px-3 py-2 text-xs text-ide-danger">
              <AlertCircle size={14} />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="hover:underline">{t("common.close")}</button>
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {groupSummary ? (
              <GroupSummaryCard
                groupId={selectedGroup.groupId}
                groupName={selectedGroup.name}
                summary={groupSummary}
                cachedLlmAdvice={selectedGroup.summary}
                cachedSummaryGeneratedAt={selectedGroup.summaryGeneratedAt}
              />
            ) : (
              <div className="p-3 text-xs text-ide-fg-muted">{t("history.calculating")}</div>
            )}
          </div>
        </section>
      </div>
    );
  }

  // 会话详情模式
  return (
    <>
    <div className="flex min-h-0 flex-1">
      {/* 左栏 分组侧边栏 */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-ide-border bg-ide-bg-alt">
        <SessionGroupSidebar
          groups={groups}
          sessions={sessions}
          selectedSessionId={selectedId}
          selectedGroupId={selectedGroupId}
          onSelectSession={handleSelectSession}
          onSelectGroup={handleSelectGroup}
          onCreateGroup={handleCreateGroup}
          onRenameGroup={handleRenameGroup}
          onDeleteGroup={handleDeleteGroup}
          onAssignSession={handleAssignSession}
        />
      </aside>

      {/* 右栏 */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-ide-border bg-ide-bg-alt px-3 text-xs">
          <div className="truncate text-ide-fg">
            {selected?.title || t("history.noSessionSelected")}
          </div>
          <button
            onClick={handleGenerateStar}
            disabled={generating || !selected || messages.length === 0}
            className="flex h-6 items-center gap-1 bg-ide-accent px-2 text-ide-accent-fg hover:bg-ide-accent-hover disabled:opacity-50"
          >
            {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {t("history.generateSTAR")}
            {generating && progress && progress.total > 0 && (
              <span className="ml-1 font-mono text-[10px] opacity-90">{progress.done}/{progress.total}</span>
            )}
          </button>
        </div>

        {error && (
          <div role="alert" className="flex items-center gap-2 border-b border-ide-danger/30 bg-ide-danger/10 px-3 py-2 text-xs text-ide-danger">
            <AlertCircle size={14} />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} className="hover:underline">{t("common.close")}</button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* 整场回顾评价(顶部) */}
          {selected && (
            <div className="border-b border-ide-border p-3">
              <SessionReviewCard review={review} loading={reviewLoading} compact />
            </div>
          )}

          {/* C5:弱点闭环推荐 - 在 SessionReviewCard 下方,基于薄弱维度推荐下次练习场景 */}
          {selected && weakness && (
            <div className="border-b border-ide-border p-3">
              <WeaknessRecommendCard weakness={weakness} />
            </div>
          )}

          {/* 成长热力图 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <Flame size={12} />
              {t("history.growthHeatmap")}
              <InfoTip text={t("history.heatmapTip1")} />
              <InfoTip text={t("history.heatmapTip2")} />
            </div>
            <Heatmap data={heatmapData} />
          </div>

          {/* C4:跨场能力雷达 - 聚合所有评估的维度得分 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <Star size={12} />
              {t("history.crossFieldRadar")}
              <InfoTip text={t("history.crossFieldRadarTip")} />
              {crossFieldRadar.evalCount > 0 && (
                <span className="ml-auto text-[10px] font-normal text-ide-fg-muted">
                  {t("history.crossFieldRadarCount", { count: crossFieldRadar.evalCount })}
                </span>
              )}
            </div>
            {crossFieldRadar.dimensions.length < 3 ? (
              <div className="py-3 text-center text-xs text-ide-fg-muted">
                {t("history.crossFieldRadarEmpty")}
              </div>
            ) : (
              <EvaluationRadar
                dimensions={crossFieldRadar.dimensions}
                maxScore={5}
                baseline={showBaseline ? personalBaseline : undefined}
              />
            )}
          </div>

          {/* 进步曲线 + C4 维度演进 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <TrendingUp size={12} />
              {t("history.progressCurve")}
              <InfoTip text={t("history.progressCurveTip")} />
            </div>
            <ProgressCurve data={progressData} dimensionHistory={dimensionHistory} />
          </div>

          {/* 弱项分析卡片 */}
          <div className="border-b border-ide-border p-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
              <AlertTriangle size={12} />
              {t("history.weaknessAnalysis")}
              <InfoTip text={t("history.weaknessTip")} />
            </div>
            {weaknessLoading ? (
              <div className="flex items-center gap-2 py-2 text-xs text-ide-fg-muted">
                <Loader2 size={12} className="animate-spin" />
                {t("history.analyzing")}
              </div>
            ) : !weakness || !weakness.hasData ? (
              <div className="py-2 text-xs text-ide-fg-muted">
                {weakness?.message || t("history.insufficientWeaknessData")}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {weakness.advice && (
                  <div className="border border-ide-border bg-ide-bg-alt p-2 text-xs text-ide-fg">
                    <div className="mb-1 text-ide-fg-muted">{t("history.advice")}</div>
                    <div className="whitespace-pre-wrap">{weakness.advice}</div>
                  </div>
                )}
                {weakness.weakestDimensions && weakness.weakestDimensions.length > 0 && (
                  <div className="border border-ide-border bg-ide-bg-alt p-2 text-xs">
                    <div className="mb-1 text-ide-fg-muted">{t("history.weakestDimensions")}</div>
                    <div className="flex flex-wrap gap-2">
                      {weakness.weakestDimensions.map((d, i) => (
                        <span
                          key={i}
                          className="flex items-center gap-1 bg-ide-danger/20 px-1.5 py-0.5 text-ide-danger"
                        >
                          {d.dimensionName}
                          <span className="font-mono">{d.avgScore.toFixed(1)}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {weakness.totalEvaluations != null && (
                  <div className="text-[11px] text-ide-fg-muted">
                    {t("history.totalEvalRecords", { n: weakness.totalEvaluations })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ★3:错题本 —— 跨会话聚合 is_missed=1 的逐题反馈,最近优先 */}
          {missedLoaded && (
            <div className="border-b border-ide-border p-3">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-ide-fg-muted">
                <BookX size={12} />
                错题本
                <span className="text-[10px] font-normal normal-case text-ide-fg-muted">{filteredMissed.length} 题</span>
                {missedTag && (
                  <button
                    onClick={() => setMissedTag(null)}
                    className="ml-auto text-[10px] font-normal normal-case text-ide-accent hover:underline"
                  >
                    清除筛选「{missedTag}」
                  </button>
                )}
              </div>

              {/* weakness tag 筛选(数据有标签时才显示) */}
              {missedAllTags.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {missedAllTags.map((tg) => (
                    <button
                      key={tg}
                      onClick={() => setMissedTag(missedTag === tg ? null : tg)}
                      className={cn(
                        "px-1.5 py-0.5 text-[10px]",
                        missedTag === tg
                          ? "bg-ide-accent text-ide-accent-fg"
                          : "bg-ide-bg-alt text-ide-fg-muted hover:text-ide-fg"
                      )}
                    >
                      {tg}
                    </button>
                  ))}
                </div>
              )}

              {filteredMissed.length === 0 ? (
                <div className="py-2 text-xs text-ide-fg-muted">
                  {missedQuestions.length === 0
                    ? "暂无错题。练习中把答错的题标记为错题,即可在这里跨会话复习。"
                    : "该筛选下没有错题。"}
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {filteredMissed.map((q) => {
                    const expanded = missedExpanded === q.question;
                    return (
                      <div key={q.question} className="border border-ide-border bg-ide-bg-alt p-2 text-xs">
                        <button
                          onClick={() => setMissedExpanded(expanded ? null : q.question)}
                          className="block w-full text-left"
                          title={expanded ? "收起" : "展开看参考答案"}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate font-medium text-ide-fg">{clip(q.question)}</span>
                            <span className="shrink-0 bg-ide-danger/20 px-1.5 py-0.5 text-[10px] text-ide-danger">
                              错 {q.missedCount ?? 1} 次
                            </span>
                            {q.lastMissedAt && (
                              <span className="shrink-0 text-[10px] text-ide-fg-muted">{formatTime(q.lastMissedAt)}</span>
                            )}
                          </div>
                          <div className="mt-1 truncate text-[11px] text-ide-fg-muted">
                            我的回答:{clip(q.answer) || "(无记录)"}
                          </div>
                        </button>

                        {(q.weaknessTags || []).length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {(q.weaknessTags || []).slice(0, 4).map((tg) => (
                              <button
                                key={tg}
                                onClick={() => setMissedTag(tg)}
                                title="按此短板筛选"
                                className="bg-ide-danger/10 px-1 py-0.5 text-[10px] text-ide-danger hover:bg-ide-danger/20"
                              >
                                {tg}
                              </button>
                            ))}
                          </div>
                        )}

                        {expanded && (
                          <div className="mt-2 border-t border-ide-border pt-2">
                            <div className="mb-1 text-ide-fg-muted">题目全文</div>
                            <div className="mb-2 whitespace-pre-wrap text-ide-fg">{q.question}</div>
                            <div className="mb-1 text-ide-fg-muted">我的最后回答</div>
                            <div className="mb-2 whitespace-pre-wrap text-ide-fg">{q.answer || "(无记录)"}</div>
                            <div className="mb-1 text-ide-fg-muted">参考答案</div>
                            {q.betterAnswer ? (
                              <div className="whitespace-pre-wrap text-ide-success">{q.betterAnswer}</div>
                            ) : (
                              <div className="text-[11px] text-ide-fg-muted">
                                暂无参考答案(该题评估时未生成"更好的回答")
                              </div>
                            )}
                          </div>
                        )}

                        <div className="mt-2 flex justify-end">
                          <button
                            onClick={() => navigate(`/interview?focus=${encodeURIComponent(q.question)}`)}
                            title="带着这道题去练习页"
                            className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg px-2 text-[11px] text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                          >
                            <Sparkles size={11} />
                            去练这道
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 评估报告区 */}
          <div className="border-b border-ide-border">
            <div className="flex items-center justify-between border-b border-ide-border px-3 py-1.5 text-xs font-semibold uppercase text-ide-fg-muted">
              <div className="flex items-center gap-2">
                <Star size={12} />
                {t("history.evaluationReports", { n: evaluations.length })}
                <InfoTip text={t("history.evalReportTip")} />
              </div>
              {selected && messages.length > 0 && (
                <div className="flex items-center gap-1 normal-case">
                  <button
                    onClick={() => handleExport("md")}
                    title={t("history.exportMarkdown")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                  >
                    <Download size={12} />
                    MD
                  </button>
                  <button
                    onClick={() => handleExport("json")}
                    title={t("history.exportJSON")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                  >
                    <FileJson size={12} />
                    JSON
                  </button>
                  <button
                    onClick={() => handleExport("pdf")}
                    title={t("history.exportPDF")}
                    className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                  >
                    <FileText size={12} />
                    PDF
                  </button>
                </div>
              )}
            </div>
            <div className="p-3">
              {loading ? (
                <div className="text-xs text-ide-fg-muted">{t("common.loading")}</div>
              ) : evaluations.length === 0 ? (
                <div className="text-xs text-ide-fg-muted">{t("history.noEvaluations")}</div>
              ) : (
                <div className="flex flex-col gap-3">
                  {evaluations.map((ev) => {
                    const evTime = ev.generatedAt || ev.createdAt;
                    return (
                      <div key={ev.evaluationId} className="border border-ide-border bg-ide-bg-alt p-3 text-xs">
                        <div className="mb-2 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-ide-fg-muted">{t("history.overallScore")}</span>
                            <span className="bg-ide-accent/20 px-1.5 py-0.5 font-mono text-ide-accent">
                              {ev.overallScore ?? "-"}
                            </span>
                          </div>
                          {evTime && (
                            <span className="text-[10px] text-ide-fg-muted">{formatTime(evTime)}</span>
                          )}
                        </div>
                        {ev.dimensions && ev.dimensions.length > 0 && (
                          <div className="mb-2">
                            <EvaluationRadar dimensions={ev.dimensions} maxScore={5} baseline={showBaseline ? personalBaseline : undefined} />
                          </div>
                        )}
                        {ev.dimensions && ev.dimensions.length > 0 && (
                          <div className="mb-2 grid grid-cols-2 gap-1">
                            {ev.dimensions.map((d, i) => (
                              <div key={i} className="flex items-center gap-2 bg-ide-bg px-2 py-1">
                                <span className="text-ide-fg-muted">{d.dimensionName}</span>
                                <span className="font-mono text-ide-accent">{d.score}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {ev.report && (
                          <div className="mb-2">
                            <div className="text-ide-fg-muted">{t("history.report")}</div>
                            <div className="editable mt-1 whitespace-pre-wrap text-ide-fg">{ev.report}</div>
                          </div>
                        )}
                        {ev.improvementAdvice && (
                          <div className="mb-2">
                            <div className="text-ide-fg-muted">{t("history.improvementAdvice")}</div>
                            <div className="editable mt-1 whitespace-pre-wrap text-ide-fg">{ev.improvementAdvice}</div>
                          </div>
                        )}
                        {ev.betterAnswerSample && (
                          <div>
                            <div className="text-ide-fg-muted">{t("history.betterAnswerSample")}</div>
                            <div className="editable mt-1 whitespace-pre-wrap text-ide-success">{ev.betterAnswerSample}</div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 逐字稿回放 —— 问答/评估/录音按时间合并的时间轴复盘视图(懒加载) */}
          <div className="border-t border-ide-border">
            <div className="flex items-center justify-between gap-1 border-b border-ide-border px-3 py-1.5 text-xs font-semibold uppercase text-ide-fg-muted">
              <div className="flex items-center gap-2">
                <Mic size={12} />
                逐字稿回放
                {transcript !== null && (
                  <span className="text-[10px] font-normal normal-case text-ide-fg-muted">
                    {transcript.length} 条 · 问答 {transcript.filter((x) => x.kind === "answer" || x.kind === "question").length}
                    {" "}· 评估 {transcript.filter((x) => x.kind === "evaluation").length}
                    {" "}· 录音 {transcript.filter((x) => x.kind === "recording").length}
                  </span>
                )}
              </div>
              {selected && (
                <button
                  onClick={handleToggleTranscript}
                  disabled={transcriptLoading}
                  className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 normal-case text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent disabled:opacity-50"
                >
                  {transcriptLoading ? <Loader2 size={12} className="animate-spin" /> : <Mic size={12} />}
                  {transcriptLoading ? "加载中…" : showTranscript ? "收起" : "展开时间轴"}
                </button>
              )}
            </div>
            {showTranscript && (
              <div className="p-3 font-mono text-[11px] leading-relaxed">
                {transcriptLoading ? (
                  <div className="flex items-center gap-2 text-ide-fg-muted">
                    <Loader2 size={12} className="animate-spin" />
                    正在合并问答、评估与录音…
                  </div>
                ) : !transcript || transcript.length === 0 ? (
                  <div className="py-2 text-ide-fg-muted">
                    本场没有可回放的逐字稿:先完成一轮问答(或语音答题/逐题评估),时间轴会在这里按时间合并展示。
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5">{transcript.map(renderTranscriptItem)}</div>
                )}
              </div>
            )}
          </div>

          {/* 对话回看区 */}
          <div>
            <div className="flex items-center justify-between gap-1 border-b border-ide-border px-3 py-1.5 text-xs font-semibold uppercase text-ide-fg-muted">
              <div className="flex items-center gap-1">
                {t("history.conversationReview", { n: messages.length })}
                <InfoTip text={t("history.conversationReviewTip")} />
              </div>
              {selected && messages.length > 0 && (
                <button
                  onClick={handleOpenReviewDiscussion}
                  title={t("history.reviewDiscussionTip")}
                  className="flex h-6 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 normal-case text-ide-fg hover:bg-ide-accent/10 hover:text-ide-accent"
                >
                  <MessagesSquare size={12} />
                  {t("history.reviewDiscussion")}
                </button>
              )}
            </div>
            <div className="p-3">
              {messages.length === 0 ? (
                <div className="text-xs text-ide-fg-muted">{t("history.noMessages")}</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((m, i) => (
                    <div
                      key={m.messageId || m.id || i}
                      className={cn(
                        "flex w-full",
                        m.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      <div
                        className={cn(
                          "bubble",
                          m.role === "user"
                            ? "bubble-user"
                            : m.role === "system"
                            ? "bubble-system"
                            : "bubble-assistant"
                        )}
                      >
                        <div className="mb-1 text-[10px] opacity-60">
                          {m.role === "user" ? t("history.roleUser") : m.role === "assistant" ? t("history.roleAI") : t("history.roleSystem")}
                          {m.createdAt && ` · ${formatTime(m.createdAt)}`}
                        </div>
                        {m.content}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>

      {/* 方案 5:复盘群聊覆盖层(z-50,与 modal 同级) */}
      {showReviewDiscussion && selected && (
        <ReviewDiscussion
          sessionId={selected.sessionId}
          messages={messages}
          evaluation={evaluations[0] || null}
          agents={reviewAgents}
          onClose={() => setShowReviewDiscussion(false)}
        />
      )}
    </>
  );
}
