// 平台工作台:收银台 / 房间 / 复盘对照 / 令牌
// P8b(platform)。页面文案为中文硬编码(平台层新增功能,暂不进 i18n key 体系)
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getApiToken } from "@/api/client";
import { platformApi, getPlatformToken, setPlatformToken, fenToYuan, track, PlatformProduct, PlatformOrder, PlatformRoom } from "@/api/platform";

type Tab = "checkout" | "rooms" | "review" | "admin" | "token";

export function PlatformPage() {
  const [tab, setTab] = useState<Tab>("checkout");
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get("tab") === "rooms") setTab("rooms");
    track("review_view", { page: "platform" });
  }, [params]);

  const hasToken = Boolean(getPlatformToken());

  return (
    <div className="h-full overflow-y-auto bg-ide-bg text-ide-fg">
      <div className="mx-auto max-w-4xl px-6 py-8">
        <header className="mb-6 flex items-center gap-2 font-mono text-xl font-bold">
          <span className="text-ide-accent">$</span> trialroom · 平台工作台
          {!hasToken && <span className="ml-2 border border-ide-warning px-2 py-0.5 text-xs text-ide-warning">未登录平台</span>}
        </header>
        <nav className="mb-6 flex gap-1 border-b border-ide-border font-mono text-sm">
          {([["checkout", "收银台"], ["rooms", "面试房间"], ["review", "复盘对照"], ["admin", "管理"], ["token", "平台令牌"]] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 ${tab === id ? "border-b-2 border-ide-accent text-ide-accent" : "text-ide-fg-muted hover:text-ide-fg"}`}>
              {label}
            </button>
          ))}
        </nav>
        {tab === "checkout" && <CheckoutTab />}
        {tab === "rooms" && <RoomsTab initialCode={params.get("code") ?? ""} />}
        {tab === "review" && <ReviewTab />}
        {tab === "admin" && <AdminTab />}
        {tab === "token" && <TokenTab />}
      </div>
    </div>
  );
}

// ── 收银台 ────────────────────────────────────────────────────────────────
function CheckoutTab() {
  const [products, setProducts] = useState<PlatformProduct[]>([]);
  const [provider, setProvider] = useState("mock");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [orders, setOrders] = useState<PlatformOrder[]>([]);

  const loadProducts = async () => {
    const r = await platformApi.products();
    setProducts(r.products); setProvider(r.provider);
  };
  useEffect(() => { loadProducts().catch(e => setNotice(e.message)); }, []);

  const buy = async (code: string) => {
    setBusy(code); setNotice("");
    try {
      const key = `${code}:${Date.now().toString(36)}`; // 幂等键:本会话本次点击
      const order = await platformApi.createOrder(code, key);
      if (order.pay_form) {
        // 真实支付:后端产出的自提交表单挂到独立容器再提交,不 document.write
        // 替换整文档(审查 F6:SPA 状态/历史全毁,且是"服务端字符串→同源脚本"直通管道)
        const holder = document.createElement("div");
        holder.innerHTML = order.pay_form;
        document.body.appendChild(holder);
        const form = holder.querySelector("form");
        if (form) { form.submit(); return; }
        setNotice("支付表单异常,请联系管理员");
        return;
      }
      const paid = await platformApi.mockPay(order.order_no);
      setNotice(`订单 ${paid.order.order_no} 已支付(mock 轨,自动打内控标)`);
    } catch (e: any) {
      setNotice(e.message);
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-ide-fg-muted">
        支付通道:<span className="text-ide-accent">{provider === "mock" ? "mock(配置支付宝密钥后自动切换真实收款)" : "支付宝网页应用收款"}</span>
        　·　¥0.01 首单每人限一次 · 权益即买即到账
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {products.map(p => (
          <div key={p.code} className="border border-ide-border bg-ide-bg-alt p-4 font-mono">
            <div className="text-sm text-ide-fg-muted">{p.name}</div>
            <div className="mt-1 text-2xl text-ide-accent">{fenToYuan(p.amount_fen)}</div>
            <div className="mt-1 text-xs text-ide-fg-muted">
              {p.kind === "time_pass" ? `${p.days} 天不限次` : `${p.quota} 次`}
              {p.first_only ? " · 限首单" : ""}
            </div>
            <button disabled={busy === p.code} onClick={() => buy(p.code)}
              className="mt-3 w-full border border-ide-accent px-3 py-1.5 text-sm text-ide-accent hover:bg-ide-accent hover:text-ide-bg disabled:opacity-50">
              {busy === p.code ? "处理中…" : "购买"}
            </button>
          </div>
        ))}
      </div>
      {notice && <div className="border border-ide-success bg-ide-success/10 p-3 font-mono text-xs text-ide-success">{notice}</div>}
    </div>
  );
}

// ── 房间 ──────────────────────────────────────────────────────────────────
function RoomsTab({ initialCode }: { initialCode: string }) {
  const [rooms, setRooms] = useState<PlatformRoom[]>([]);
  const [code, setCode] = useState(initialCode);
  const [created, setCreated] = useState<{ room_id: string; room_code: string } | null>(null);
  const [notice, setNotice] = useState("");
  const refresh = async () => setRooms((await platformApi.myRooms()).rooms);
  useEffect(() => { refresh().catch(e => setNotice(e.message)); }, []);

  const createRoom = async () => {
    try {
      const r = await platformApi.createRoom();
      setCreated(r);
      setNotice("房号只显示这一次,请立即分享给队友");
      refresh();
    } catch (e: any) { setNotice(e.message); }
  };
  const join = async () => {
    try {
      const r = await platformApi.joinRoom(code.trim());
      setNotice(`已入座 ${r.room_id.slice(0, 12)}…(座位 ${r.seat_no})`);
      refresh();
    } catch (e: any) { setNotice(e.message); }
  };

  return (
    <div className="space-y-4 font-mono text-sm">
      <div className="flex flex-wrap gap-2">
        <button onClick={createRoom} className="border border-ide-accent px-3 py-1.5 text-ide-accent hover:bg-ide-accent hover:text-ide-bg">创建房间(我是房主)</button>
        <input value={code} onChange={e => setCode(e.target.value)} placeholder="6 位房号" maxLength={6}
          className="w-32 border border-ide-border bg-ide-bg px-2 py-1.5" />
        <button onClick={join} className="border border-ide-border px-3 py-1.5 hover:border-ide-accent">凭房号入座</button>
      </div>
      {created && (
        <div className="border border-ide-success bg-ide-success/10 p-3">
          房间号:<span className="text-lg text-ide-accent">{created.room_code}</span>
          <span className="ml-3 text-xs text-ide-fg-muted">room_id:{created.room_id}</span>
          <button
            className="ml-3 border border-ide-accent px-2 py-0.5 text-xs text-ide-accent hover:bg-ide-accent hover:text-ide-bg"
            onClick={() => {
              const url = `${location.origin}/welcome?code=${created.room_code}`;
              navigator.clipboard?.writeText(url).then(
                () => setNotice("邀请链接已复制:" + url),
                () => setNotice("复制失败,请手动复制:" + url),
              );
            }}>
            复制邀请链接
          </button>
          <button onClick={() => platformApi.closeRoom(created.room_id).then(refresh).catch((e: any) => setNotice(e.message))}
            className="ml-2 border border-ide-danger px-2 py-0.5 text-xs text-ide-danger">关闭房间</button>
        </div>
      )}
      {notice && <div className="text-xs text-ide-warning">{notice}</div>}
      <div className="border border-ide-border">
        <div className="border-b border-ide-border bg-ide-bg-alt px-3 py-2 text-xs text-ide-fg-muted">我的房间(接口永不回显房号)</div>
        {rooms.length === 0 ? <div className="p-3 text-xs text-ide-fg-muted">暂无房间</div> :
          rooms.map(r => (
            <div key={r.room_id} className="flex items-center justify-between border-b border-ide-border px-3 py-2 last:border-0">
              <span className="truncate">{r.room_id}{r.is_host ? <span className="ml-2 text-ide-accent">[房主]</span> : <span className="ml-2 text-ide-fg-muted">[座位 {r.seat_no}]</span>}</span>
              <span className="text-xs text-ide-fg-muted">{r.industry ?? "—"} · {r.position ?? "—"} · {r.status}</span>
            </div>
          ))}
      </div>
      <p className="text-xs text-ide-fg-muted">外部 AI agent 可通过 /mcp 端点(Bearer mcp token)以六工具接入房间;越权访问与不存在房间同响应。</p>
    </div>
  );
}

// ── 复盘对照(并排展示,不判优劣 —— 11-final-plan §4.8 的 A 期纪律) ──────────
function ReviewTab() {
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");
  const [left, setLeft] = useState<any>(null);
  const [right, setRight] = useState<any>(null);
  const [err, setErr] = useState("");
  const [attemptsMode, setAttemptsMode] = useState(false);

  // 基座会话 token 从 client 的 getApiToken 取(sessionStorage,审查 F4:
  // 此前直读 localStorage 永远 null,复盘对照恒 401)
  const authHeaders = (): Record<string, string> => {
    const token = getApiToken();
    return token ? { authorization: `Bearer ${token}` } : {};
  };
  const loadSessions = async () => {
    // P1#10:优先平台 attempts(带三条件判定),为空回退基座会话
    try {
      const att = await platformApi.myAttempts();
      const list = (att.attempts ?? []).filter((a: any) => a.finished_at).slice(0, 2);
      if (list.length > 0) {
        if (list[0]) setA(list[0].id);
        if (list[1]) setB(list[1].id);
        setAttemptsMode(true);
        return;
      }
    } catch { /* 未登录平台则回退 */ }
    try {
      const res = await fetch("/api/sessions", { headers: authHeaders() });
      if (!res.ok) return setErr(`读取会话失败(${res.status}):需要先在设置页配置访问 token`);
      const j = await res.json();
      const list = (Array.isArray(j) ? j : j.data ?? []).slice(0, 2);
      if (list[0]) setA(list[0].id);
      if (list[1]) setB(list[1].id);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { loadSessions(); }, []);

  const load = async (id: string, setter: (v: any) => void) => {
    if (!id) return setter(null);
    if (attemptsMode) {
      const att = await platformApi.myAttempts();
      const one = (att.attempts ?? []).find((x: any) => x.id === id);
      const q = one ? JSON.parse(one.qualification ?? "{}") : {};
      return setter({ position: one?.position ?? "attempt", evaluation: {
        dimensions: Object.entries(q).filter(([k]) => k.startsWith("cond")).map(([k, v]) => ({ name: k, score: v ? 1 : 0 })),
      }, qualification: q });
    }
    try {
      const res = await fetch(`/api/sessions/${id}`, { headers: authHeaders() });
      if (!res.ok) return setter(null);
      const j = await res.json();
      setter(j.data ?? j);
    } catch { setter(null); }
  };
  useEffect(() => { load(a, setLeft); load(b, setRight); }, [a, b, attemptsMode]);

  return (
    <div className="space-y-3 font-mono text-sm">
      <p className="text-xs text-ide-fg-muted">并排对照两次会话的评分(仅展示,不判定孰优 —— 判定需人工校准后的发布门禁)</p>
      <div className="grid grid-cols-2 gap-3">
        <SessionCard title="对照 A" session={left} />
        <SessionCard title="对照 B" session={right} />
      </div>
      {err && <div className="text-xs text-ide-warning">{err}</div>}
    </div>
  );
}

function SessionCard({ title, session }: { title: string; session: any }) {
  const dims = session?.evaluation?.dimensions ?? session?.dimensions ?? [];
  return (
    <div className="border border-ide-border bg-ide-bg-alt p-3">
      <div className="mb-2 text-xs text-ide-fg-muted">{title} · {session?.position ?? session?.title ?? "—"}</div>
      {dims.length === 0 ? <div className="text-xs text-ide-fg-muted">无评估数据</div> :
        dims.map((d: any) => (
          <div key={d.name ?? d.dimension} className="flex items-center justify-between border-b border-ide-border py-1 last:border-0">
            <span>{d.name ?? d.dimension}</span>
            <span className="text-ide-accent">{d.score}{d.evidence ? <span className="ml-2 text-xs text-ide-fg-muted">有依据</span> : null}</span>
          </div>
        ))}
    </div>
  );
}

// ── 令牌 ──────────────────────────────────────────────────────────────────
function TokenTab() {
  const [name, setName] = useState("");
  const [notice, setNotice] = useState("");
  const bootstrap = async () => {
    try {
      const r = await platformApi.devToken(name || "web-user");
      setPlatformToken(r.token);
      setNotice("平台令牌已签发并保存(仅显示一次,已写入本机存储)");
    } catch (e: any) { setNotice(e.message); }
  };
  return (
    <div className="space-y-3 font-mono text-sm">
      <p className="text-xs text-ide-fg-muted">平台令牌(api_tokens class)用于收银台/房间;与外部 agent 的 MCP 令牌(mcp_tokens class)物理隔离。生产部署应改用正式登录后由服务端签发。</p>
      <div className="flex gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="昵称(可选)"
          className="w-48 border border-ide-border bg-ide-bg px-2 py-1.5" />
        <button onClick={bootstrap} className="border border-ide-accent px-3 py-1.5 text-ide-accent hover:bg-ide-accent hover:text-ide-bg">签发开发令牌</button>
      </div>
      {notice && <div className="text-xs text-ide-success">{notice}</div>}
    </div>
  );
}

export default PlatformPage;

// ── 管理标签页(P1#9):多口径统计卡 + 订单审计(admin token 专属) ──────────
function AdminTab() {
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [orders, setOrders] = useState<PlatformOrder[]>([]);
  const [err, setErr] = useState("");
  const load = async () => {
    try {
      setStats((await platformApi.paidStats()).stats);
      setOrders((await platformApi.adminOrders(30)).orders);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  const cards: [string, string, string][] = [
    ["dedup_account", "去重付费(账号)", "官方 A1 口径"],
    ["dedup_account_excl_001", "去重付费(排除 ¥0.01)", "A2 口径"],
    ["dedup_account_excl_refund", "去重付费(剔除退款)", "A3 口径"],
    ["order_count", "有效订单数", "paid 口径"],
    ["gross_fen", "毛额(分)", "paid 口径"],
    ["refunded_fen", "退款(分)", "含部分退款"],
  ];
  return (
    <div className="space-y-4 font-mono text-sm">
      {err && <div className="border border-ide-warning p-2 text-xs text-ide-warning">{err}(需 TRIALROOM_ADMIN_TOKEN 对应的管理员令牌)</div>}
      <div className="grid grid-cols-3 gap-2">
        {cards.map(([k, label, note]) => (
          <div key={k} className="border border-ide-border bg-ide-bg-alt p-3">
            <div className="text-xs text-ide-fg-muted">{label}</div>
            <div className="mt-1 text-xl text-ide-accent">{stats ? (stats[k] ?? 0) : "…"}</div>
            <div className="text-[10px] text-ide-fg-muted">{note}</div>
          </div>
        ))}
      </div>
      <div className="border border-ide-border">
        <div className="border-b border-ide-border bg-ide-bg-alt px-3 py-2 text-xs text-ide-fg-muted">最近订单(全部渠道/状态)</div>
        {orders.length === 0 ? <div className="p-3 text-xs text-ide-fg-muted">无订单或无权限</div> : orders.map((o) => (
          <div key={o.order_no} className="flex items-center justify-between border-b border-ide-border px-3 py-1.5 text-xs last:border-0">
            <span className="truncate">{o.order_no} · {o.product_name}</span>
            <span className={o.status === "paid" ? "text-ide-success" : o.status === "refunded" ? "text-ide-warning" : "text-ide-fg-muted"}>
              {o.status} · {fenToYuan(o.amount_fen)}{o.is_internal_verification ? " · 内控" : ""}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
