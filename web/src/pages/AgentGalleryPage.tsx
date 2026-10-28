import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Download, Copy, Check, ChevronDown, ChevronRight, ExternalLink, BookOpen } from "lucide-react";
import { cn } from "@/shared";

// 智能体广场:消费构建产物 /agents/index.json(build-agent-gallery.mjs 生成),
// 展示社区贡献的 .ix-agent.json 智能体,支持展开完整 prompt、下载导入、复制 JSON。
// 数据是纯静态构建产物,无服务器依赖——贡献流程见仓库 CONTRIBUTING.md。

interface GalleryEntry {
  id: string;
  name: string;
  description: string;
  tags: string[];
  difficulty: number;
  tone: string;
  role: string;
  avatar: string;
  author: string;
  focusAreas: string[];
  agentKind: string;
  detailPage: string;
  file: string;
  agent: Record<string, unknown>;
}

interface GalleryIndex {
  kind: string;
  version: number;
  generatedAt: string;
  count: number;
  agents: GalleryEntry[];
}

// 与 MarketPage 的角色徽章配色保持一致
const ROLE_BADGE: Record<string, string> = {
  hr: "bg-ide-accent/20 text-ide-accent",
  tech: "bg-ide-success/20 text-ide-success",
  ceo: "bg-ide-warning/20 text-ide-warning",
  custom: "bg-ide-fg-muted/20 text-ide-fg-muted",
};

const TONE_LABEL: Record<string, string> = {
  gentle: "温和",
  direct: "直接",
  aggressive: "犀利",
  neutral: "中性",
  professional: "专业",
};

const CONTRIBUTING_URL = "https://github.com/wufufu770/Tryout/blob/main/CONTRIBUTING.md";

function DifficultyDots({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" title={`难度 ${value}/10`}>
      {Array.from({ length: 10 }).map((_, i) => (
        <span key={i} className={cn("inline-block h-1.5 w-1.5 rounded-full", i < value ? "bg-ide-accent" : "bg-ide-border")} />
      ))}
      <span className="ml-1 text-[10px] text-ide-fg-muted">{value}/10</span>
    </span>
  );
}

// .ix-agent.json → data URI(encodeURIComponent),供 <a download> 一键保存
function agentDataUri(entry: GalleryEntry): string {
  return `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(entry.agent, null, 2))}`;
}

export function AgentGalleryPage() {
  const [index, setIndex] = useState<GalleryIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/agents/index.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GalleryIndex>;
      })
      .then((data) => {
        if (!cancelled) setIndex(data);
      })
      .catch((e) => {
        if (!cancelled) setError(`广场数据加载失败(${e.message})。请先在 web/ 目录执行 npm run build:agents 生成 /agents/index.json。`);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopy = async (entry: GalleryEntry) => {
    const text = JSON.stringify(entry.agent, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(entry.id);
      setTimeout(() => setCopiedId((cur) => (cur === entry.id ? null : cur)), 2000);
    } catch {
      setError("复制失败:浏览器未授权剪贴板权限,请改用「下载导入」按钮。");
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4">
        {/* 页头 */}
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold text-ide-fg">
              <Users size={16} className="text-ide-accent" /> 智能体广场
            </h1>
            <p className="mt-1 text-xs text-ide-fg-muted">
              社区贡献的面试官智能体(.ix-agent.json),下载后一键导入你的 Agent 工作台。
              {index && <span className="ml-1">共 {index.count} 个。</span>}
            </p>
          </div>
          <a
            href={CONTRIBUTING_URL}
            target="_blank"
            rel="noreferrer"
            className="flex h-7 shrink-0 items-center gap-1 border border-ide-border bg-ide-bg-alt px-2 text-xs text-ide-accent hover:border-ide-accent"
          >
            <BookOpen size={12} /> 提交我的智能体
          </a>
        </div>

        {/* 使用说明 */}
        <div className="mb-4 border border-ide-border bg-ide-bg-alt p-3 text-xs text-ide-fg-muted">
          <div className="mb-1 font-semibold text-ide-fg">使用方法</div>
          <ol className="list-decimal space-y-0.5 pl-5">
            <li>点击卡片展开完整 prompt,确认风格适合你;</li>
            <li>点「下载导入」保存 .ix-agent.json 文件;</li>
            <li>
              打开{" "}
              <Link to="/agents" className="text-ide-accent hover:underline">
                Agent 工作台
              </Link>{" "}
              → 列表上方「导入」按钮 → 选择刚下载的文件,即可开始陪练。
            </li>
          </ol>
        </div>

        {error && (
          <div role="alert" className="mb-4 border border-ide-danger/40 bg-ide-danger/10 p-3 text-xs text-ide-danger">
            {error}
          </div>
        )}

        {!index && !error && <div className="p-8 text-center text-xs text-ide-fg-muted">加载中...</div>}

        {/* 智能体卡片列表 */}
        <div className="flex flex-col gap-2">
          {(index?.agents || []).map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id} className={cn("border bg-ide-bg", expanded ? "border-ide-accent" : "border-ide-border")}>
                {/* 卡片头(点击展开/收起) */}
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-3 p-3 text-left hover:bg-ide-bg-active focus-visible:outline focus-visible:outline-ide-accent"
                >
                  {expanded ? (
                    <ChevronDown size={14} className="shrink-0 text-ide-fg-muted" />
                  ) : (
                    <ChevronRight size={14} className="shrink-0 text-ide-fg-muted" />
                  )}
                  <span className="shrink-0 text-xl leading-none">{entry.avatar}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-ide-fg">{entry.name}</span>
                      <span className={cn("px-1 text-[10px]", ROLE_BADGE[entry.role] || ROLE_BADGE.custom)}>
                        {entry.role}
                      </span>
                      <span className="text-[10px] text-ide-fg-muted">{TONE_LABEL[entry.tone] || entry.tone}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ide-fg-muted">{entry.description}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5">
                      {entry.tags.map((tag) => (
                        <span key={tag} className="border border-ide-border px-1 text-[10px] text-ide-fg-muted">
                          {tag}
                        </span>
                      ))}
                      <DifficultyDots value={entry.difficulty} />
                      <span className="text-[10px] text-ide-fg-muted">by {entry.author}</span>
                    </span>
                  </span>
                </button>

                {/* 展开区:完整 prompt + 操作 */}
                {expanded && (
                  <div className="border-t border-ide-border p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <a
                        href={agentDataUri(entry)}
                        download={entry.file}
                        className="flex h-7 items-center gap-1 bg-ide-accent px-2 text-xs text-ide-accent-fg hover:bg-ide-accent-hover"
                      >
                        <Download size={12} /> 下载导入
                      </a>
                      <button
                        type="button"
                        onClick={() => handleCopy(entry)}
                        className="flex h-7 items-center gap-1 border border-ide-border px-2 text-xs text-ide-fg hover:border-ide-accent hover:text-ide-accent"
                      >
                        {copiedId === entry.id ? <Check size={12} className="text-ide-success" /> : <Copy size={12} />}
                        {copiedId === entry.id ? "已复制" : "复制 JSON"}
                      </button>
                      <a
                        href={entry.detailPage}
                        target="_blank"
                        rel="noreferrer"
                        className="flex h-7 items-center gap-1 border border-ide-border px-2 text-xs text-ide-fg-muted hover:border-ide-accent hover:text-ide-accent"
                      >
                        <ExternalLink size={12} /> 静态详情页
                      </a>
                      <span className="ml-auto text-[10px] text-ide-fg-muted">
                        考察方向:{entry.focusAreas.join(" / ")}
                      </span>
                    </div>
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap border border-ide-border bg-ide-bg-alt p-3 text-xs leading-relaxed text-ide-fg">
                      {typeof entry.agent.promptTemplate === "string" ? entry.agent.promptTemplate : ""}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 提交入口 */}
        <div className="mt-4 border border-ide-border bg-ide-bg-alt p-3 text-xs text-ide-fg-muted">
          想上架你自己的智能体?把 .ix-agent.json 放进仓库{" "}
          <code className="bg-ide-bg px-1 text-ide-accent">data/community-agents/</code> 并跑{" "}
          <code className="bg-ide-bg px-1 text-ide-accent">npm run build:agents</code> 校验,提 PR 即可。完整流程与内容红线见{" "}
          <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer" className="text-ide-accent hover:underline">
            CONTRIBUTING.md「提交你的智能体到广场」
          </a>
          。
        </div>
      </div>
    </div>
  );
}

export default AgentGalleryPage;
