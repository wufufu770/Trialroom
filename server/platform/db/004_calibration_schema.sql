-- 004_calibration_schema.sql —— κ 校准四表(重建版)
-- 依据:docs/spec/11-final-plan.md §4.2.6
-- 纪律:标签只存 A–E 锚点(有序类别),不存分数;逐维结果不合并;
--       一次 run 出现两种 model_version 即作废(§4.6)。

-- ── calibration_items ─────────────────────────────────────────────────────
-- 校准条目 = 题 × 判定维 × 回答。采样按 difficulty × type 分层,不按 industry(P2-11)。
CREATE TABLE IF NOT EXISTS calibration_items (
  id            TEXT PRIMARY KEY,
  question_ref  TEXT NOT NULL,                        -- 基座题库题号
  dimension     TEXT NOT NULL
                CHECK (dimension IN ('logic','problem_solving','technical_depth')),
  answer_text   TEXT NOT NULL CHECK (length(answer_text) <= 2500),
  industry      TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('L1','L2','L3','L4','L5')),
  q_type        TEXT NOT NULL,
  answer_len    INTEGER NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (question_ref, dimension, answer_len)        -- 同题同维多回答可共存(按长度区分)
);

-- ── calibration_labels ────────────────────────────────────────────────────
-- 标注。rater ∈ h1/h2/h1_consensus/h2_consensus/judge(J-28:两人标签分别存,禁均值)。
CREATE TABLE IF NOT EXISTS calibration_labels (
  id            TEXT PRIMARY KEY,
  item_id       TEXT NOT NULL REFERENCES calibration_items(id),
  rater_id      TEXT NOT NULL
                CHECK (rater_id IN ('h1','h2','h1_consensus','h2_consensus','judge')),
  label         TEXT NOT NULL CHECK (label IN ('A','B','C','D','E')),
  rationale     TEXT,
  run_id        TEXT,                                 -- judge 标签所属 run
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (item_id, rater_id, run_id)
);
CREATE INDEX IF NOT EXISTS idx_cal_labels_item ON calibration_labels(item_id, rater_id);

-- ── calibration_runs ──────────────────────────────────────────────────────
-- 一次校准运行的五指纹(J-27:model/rubric/prompt/temperature/votes)。
CREATE TABLE IF NOT EXISTS calibration_runs (
  id              TEXT PRIMARY KEY,
  model_version   TEXT NOT NULL,
  rubric_version  TEXT NOT NULL,
  prompt_hash     TEXT NOT NULL,
  temperature     REAL NOT NULL,
  votes           INTEGER NOT NULL DEFAULT 1,         -- 生产恒 1(J-26)
  provider        TEXT NOT NULL DEFAULT 'mock',
  item_count      INTEGER NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── calibration_results ───────────────────────────────────────────────────
-- 逐维结果(不合并单一 κ;G14 断言四键齐全:κ_QW/AC1/κ_HH 双口径/区间)。
CREATE TABLE IF NOT EXISTS calibration_results (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES calibration_runs(id),
  dimension     TEXT NOT NULL,
  n             INTEGER NOT NULL,
  kappa_qw      REAL,                                 -- 象限加权 κ(主口径)
  kappa_hh      REAL,                                 -- 双人一致性(天花板)
  kappa_hh_blind REAL,                                -- 双盲口径(与共识口径分开)
  ac1           REAL,                                 -- Gwet AC1(边际依赖纠正)
  raw_agree     REAL,
  ci_lo         REAL,                                 -- bootstrap 2.5 分位
  ci_hi         REAL,                                 -- bootstrap 97.5 分位
  prevalence    TEXT NOT NULL DEFAULT '{}',           -- 各类别边际 JSON
  verdict       TEXT NOT NULL
                CHECK (verdict IN ('placeholder','measured','invalid')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (run_id, dimension)
);
