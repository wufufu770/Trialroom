// 落地页(公开):产品主张 + 定价 + 分享入座深链 + 埋点六事件之首(landing_uv)
// 分享卡形态:?code=123456 → 高亮入座入口(房主从工作台复制的邀请链接)
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { platformApi, track } from "@/api/platform";

export function LandingPage() {
  const [params] = useSearchParams();
  const inviteCode = params.get("code") ?? "";
  const [products, setProducts] = useState<any[]>([]);
  const [joinState, setJoinState] = useState("");
  const [code, setCode] = useState(inviteCode);

  useEffect(() => {
    track("landing_uv", inviteCode ? { via: "share_card" } : {});
    platformApi.products().then(r => setProducts(r.products)).catch(() => {});
  }, []);

  const join = async () => {
    try {
      const r = await platformApi.joinRoom(code.trim());
      setJoinState(`已入座(座位 ${r.seat_no})→ 前往平台工作台查看房间`);
      track("room_join", { room_code: code.trim() });
    } catch (e: any) { setJoinState(e.message); }
  };

  return (
    <div className="h-full overflow-y-auto bg-ide-bg text-ide-fg">
      <div className="mx-auto max-w-3xl px-6 py-10">
        {/* Hero */}
        <section className="border border-ide-border bg-ide-bg-alt p-8 font-mono">
          <div className="flex items-center gap-2 text-2xl font-bold">
            <span className="text-ide-accent">$</span> Trialroom
            <span className="prompt-cursor inline-block h-5 w-2 bg-ide-accent" aria-hidden />
          </div>
          <p className="mt-4 text-lg">模拟面试,评的是<b className="text-ide-accent">答案对不对</b>,不是"说得流不流畅"。</p>
          <p className="mt-2 text-sm text-ide-fg-muted">808 道带参考答案的题库作为客观基准 · AI 多面试官协同 · 群面模拟 · 数据零出本机</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/interview" onClick={() => track("practice_start")}
              className="border border-ide-accent bg-ide-accent px-4 py-2 text-sm text-ide-bg">开始免费练习</Link>
            <Link to="/platform" className="border border-ide-border px-4 py-2 text-sm hover:border-ide-accent">平台工作台</Link>
          </div>
          {/* 三个数字 */}
          <div className="mt-8 grid grid-cols-3 gap-3 text-center">
            {[["808", "道带参考答案的题"], ["0", "字节离开本机(可全离线)"], ["¥0.01", "首单体验价"]].map(([n, d]) => (
              <div key={d} className="border border-ide-border p-3">
                <div className="text-2xl text-ide-accent">{n}</div>
                <div className="mt-1 text-xs text-ide-fg-muted">{d}</div>
              </div>
            ))}
          </div>
        </section>

        {/* 分享入座(邀请深链高亮) */}
        {inviteCode && (
          <section className="mt-6 border border-ide-success bg-ide-success/10 p-4 font-mono">
            <div className="text-sm">你收到一个面试房间邀请 🎫</div>
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={code} onChange={e => setCode(e.target.value)} maxLength={6}
                className="w-28 border border-ide-border bg-ide-bg px-2 py-1.5 text-center text-lg tracking-widest" />
              <button onClick={join} className="border border-ide-success px-4 py-1.5 text-ide-success hover:bg-ide-success hover:text-ide-bg">入座</button>
              {joinState && <span className="self-center text-xs">{joinState}</span>}
            </div>
          </section>
        )}

        {/* 定价 */}
        <section className="mt-6">
          <h2 className="mb-3 font-mono text-sm text-ide-fg-muted">// 定价</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {products.map(p => (
              <div key={p.code} className="border border-ide-border bg-ide-bg-alt p-4 font-mono">
                <div className="text-xs text-ide-fg-muted">{p.name}</div>
                <div className="mt-1 text-xl text-ide-accent">¥{(p.amount_fen / 100).toFixed(2)}</div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-ide-fg-muted">退款仅对 ¥3.9 及以上档位开放;¥0.01 首单如遇系统失败按"补发次数"处理,不产生退款流水。</p>
        </section>

        <footer className="mt-10 border-t border-ide-border pt-4 text-xs text-ide-fg-muted">
          MIT License · <Link to="/about" className="text-ide-accent underline">关于与第三方许可</Link> · 支付由支付宝(网页应用收款)提供
        </footer>
      </div>
    </div>
  );
}

export default LandingPage;
