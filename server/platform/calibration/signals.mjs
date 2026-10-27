// 监控四信号(P2#16,方案 §4.7):从校准/评测指标计算发布期健康信号。
// 输入 metrics:{ anchorFlipRate, crossItemStd, kappaDeltaByDim, parseFailRate }
// 阈值(写死):M1 锚点翻转 >25% 红;M2 跨题标准差 <0.5 红;
//             M3 逐维 κ 相对变化 >0.10 红;M4 parse 失败率 >3% 红。
export const THRESHOLDS = Object.freeze({ M1: 0.25, M2_MIN: 0.5, M3: 0.10, M4: 0.03 });

export function computeSignals(metrics = {}) {
  const m1 = Number(metrics.anchorFlipRate);
  const m2 = Number(metrics.crossItemStd);
  const m4 = Number(metrics.parseFailRate);
  const dims = metrics.kappaDeltaByDim ?? {};
  const m3Worst = Object.entries(dims)
    .map(([d, v]) => [d, Math.abs(Number(v))])
    .sort((a, b) => b[1] - a[1])[0];
  const signals = {
    M1_anchor_flip: { value: Number.isFinite(m1) ? m1 : null, red: Number.isFinite(m1) && m1 > THRESHOLDS.M1 },
    M2_cross_item_std: { value: Number.isFinite(m2) ? m2 : null, red: Number.isFinite(m2) && m2 < THRESHOLDS.M2_MIN },
    M3_kappa_delta: m3Worst
      ? { dim: m3Worst[0], value: m3Worst[1], red: m3Worst[1] > THRESHOLDS.M3 }
      : { dim: null, value: null, red: false },
    M4_parse_fail: { value: Number.isFinite(m4) ? m4 : null, red: Number.isFinite(m4) && m4 > THRESHOLDS.M4 },
  };
  const reds = Object.values(signals).filter((s) => s.red).length;
  return { generated_at: new Date().toISOString(), signals, red_count: reds, verdict: reds === 0 ? "green" : "red" };
}
