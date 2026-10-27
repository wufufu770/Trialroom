// 面试尝试服务 —— 付费→练习→扣次的闭环核心(P0#1)。
// 依据:docs/ROADMAP-R2.md #1:开跑校验/扣减权益 → 建 interview_attempts;
//       结束回写三条件达标判定(qualification.mjs 的 evaluateQualification)。
import { getDb, genId, nowIso } from "./db.mjs";
import { consumeEntitlement } from "./payment/service.mjs";
import { evaluateQualification } from "./calibration/qualification.mjs";

export const ATTEMPT_NOT_FOUND = Object.freeze({ status: 404, code: "NOT_FOUND", message: "尝试不存在" });

/**
 * 开跑:扣减权益(次卡扣额度/时间卡校验期)并落 interview_attempts。
 * 无权益 → 402(带引导购买语义);并发双开跑被 UNIQUE(user, active) 挡住。
 */
export function startAttempt({ userId, roomCode = null, position = null, difficulty = null }) {
  const db = getDb();
  const ent = consumeEntitlement(userId, "attempt_pack")
    ?? consumeEntitlement(userId, "time_pass");
  if (!ent) {
    throw Object.assign(new Error("无可用权益:请先购买套餐(¥0.01 首单体验)"), { status: 402 });
  }
  const id = genId("att");
  db.prepare(`INSERT INTO interview_attempts (id, user_id, room_id, position, difficulty)
    VALUES (?, ?, ?, ?, ?)`)
    .run(id, userId,
      roomCode ? (db.prepare("SELECT room_id FROM rooms WHERE room_code = ?").get(String(roomCode).slice(0, 16))?.room_id ?? null) : null,
      String(position ?? "").slice(0, 64) || null, difficulty);
  db.prepare("INSERT INTO entitlement_ledger (id, entitlement_id, delta, reason, ref) VALUES (?, ?, -1, 'consume', ?)")
    .run(genId("elf"), ent.id, id);
  return { attempt_id: id, entitlement: { kind: ent.kind, quota_left: ent.quota_total ? ent.quota_total - ent.quota_used : null } };
}

/**
 * 纪律(R8):判据输入必须由服务端评分引擎写入;当前 qualification 仅回显给用户本人,
 * 不进统计/参评/证书 —— 接入任何此类消费方前必须改为服务端计算。
 * 收卷:回写 finished_at 与三条件达标判定(JSON);κ 不在其中(发布门禁纪律)。
 */
export function finishAttempt({ attemptId, userId, scoreAfter, baseline, dimsBefore, dimsAfter, recheckDeltas, recheckGrounded }) {
  const db = getDb();
  const row = db.prepare("SELECT * FROM interview_attempts WHERE id = ?").get(attemptId);
  if (!row || row.user_id !== userId) throw Object.assign(new Error("尝试不存在"), ATTEMPT_NOT_FOUND);
  if (row.finished_at) return { attempt_id: attemptId, qualification: JSON.parse(row.qualification ?? "null"), already_finished: true };
  const qualification = evaluateQualification({ scoreAfter, baseline, dimsBefore, dimsAfter, recheckDeltas, recheckGrounded });
  db.prepare("UPDATE interview_attempts SET finished_at = ?, qualification = ? WHERE id = ? AND finished_at IS NULL")
    .run(nowIso(), JSON.stringify(qualification), attemptId);
  return { attempt_id: attemptId, qualification };
}

export function myAttempts(userId, limit = 20) {
  return getDb().prepare(
    "SELECT id, room_id, position, difficulty, qualification, started_at, finished_at FROM interview_attempts WHERE user_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(userId, Number(limit) || 20);
}

// ── P1#8 房间生命周期 ─────────────────────────────────────────────────────
export function closeRoom({ roomId, userId }) {
  const db = getDb();
  const room = db.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
  const seat = room && db.prepare("SELECT * FROM room_seats WHERE room_id = ? AND user_id = ? AND left_at IS NULL").get(roomId, userId);
  if (!room || !seat?.is_host) return { error: ATTEMPT_NOT_FOUND }; // 房主判定与越权同响应
  db.prepare("UPDATE rooms SET status = 'closed', closed_at = ? WHERE room_id = ?").run(nowIso(), roomId);
  return { closed: true };
}

export function leaveRoom({ roomId, userId }) {
  const db = getDb();
  const seat = db.prepare("SELECT * FROM room_seats WHERE room_id = ? AND user_id = ? AND left_at IS NULL").get(roomId, userId);
  if (!seat) return { error: ATTEMPT_NOT_FOUND };
  db.prepare("UPDATE room_seats SET left_at = ? WHERE id = ?").run(nowIso(), seat.id);
  return { left: true };
}
