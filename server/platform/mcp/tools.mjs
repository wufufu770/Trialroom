// MCP 六工具实现(与 config/mcp-tools.json 冻结件一一对应)。
// 安全纪律(11-final-plan §3.3/§3.4):
//   * 任何返回值不得包含 room_code(入座凭证不回显)
//   * 越权与不存在同响应(NOT_FOUND),不做 403 —— 防 10^6 房号存在性预言机
//   * ask_next_question 推进权判 room_seats.is_host,不判 scope
//   * evidence.search 只检索本人有座位的房间(证据区),永不跨房
import { getDb, genId, nowIso } from "../db.mjs";

// join_room 错码锁定(11-final-plan §3.4.4:按房号失败限流锁定)。
// 单进程内存态;多副本部署时换共享存储。锁定期一律返回 NOT_FOUND(不泄露锁定状态)。
const joinFails = new Map(); // token_id -> { fails, lockedUntil }
const JOIN_FAIL_LIMIT = 10;
const JOIN_LOCK_MS = 15 * 60_000;
function joinLocked(tokenId) {
  const st = joinFails.get(tokenId);
  return Boolean(st && st.lockedUntil > Date.now());
}
function recordJoinFail(tokenId) {
  const st = joinFails.get(tokenId) ?? { fails: 0, lockedUntil: 0 };
  st.fails += 1;
  if (st.fails >= JOIN_FAIL_LIMIT) { st.lockedUntil = Date.now() + JOIN_LOCK_MS; st.fails = 0; }
  joinFails.set(tokenId, st);
}
function clearJoinFails(tokenId) { joinFails.delete(tokenId); }

export const NOT_FOUND = Object.freeze({ code: -32004, message: "房间不存在" }); // 越权同款

function seatOf(roomId, userId) {
  return getDb().prepare(
    "SELECT * FROM room_seats WHERE room_id = ? AND user_id = ? AND left_at IS NULL").get(roomId, userId);
}

function roomVisible(roomId, userId) {
  const room = getDb().prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
  if (!room) return { room: null, seat: null };
  const seat = seatOf(roomId, userId);
  if (!seat) return { room: null, seat: null }; // 越权 → 与不存在同响应
  return { room, seat };
}

const stripCode = (room) => room ? (({ room_code, ...rest }) => rest)(room) : null;

export const tools = {
  list_rooms: (mcp) => {
    const rows = getDb().prepare(`SELECT r.* FROM rooms r
      JOIN room_seats s ON s.room_id = r.room_id
      WHERE s.user_id = ? AND s.left_at IS NULL ORDER BY r.created_at DESC LIMIT 50`).all(mcp.user_id);
    return { rooms: rows.map(stripCode) };
  },

  get_room: (mcp, { room_id }) => {
    const { room, seat } = roomVisible(room_id, mcp.user_id);
    if (!room) return { error: NOT_FOUND };
    const seats = getDb().prepare(
      "SELECT id, seat_no, is_host, joined_at FROM room_seats WHERE room_id = ? AND left_at IS NULL ORDER BY seat_no").all(room_id);
    return { room: stripCode(room), seats, your_seat_no: seat.seat_no };
  },

  join_room: (mcp, { room_code }) => {
    const db = getDb();
    if (joinLocked(mcp.token_id)) return { error: NOT_FOUND };
    const room = db.prepare("SELECT * FROM rooms WHERE room_code = ? AND status != 'closed'").get(String(room_code ?? ""));
    if (!room) { recordJoinFail(mcp.token_id); return { error: NOT_FOUND }; }
    const existing = seatOf(room.room_id, mcp.user_id);
    if (existing) { clearJoinFails(mcp.token_id); return { room_id: room.room_id, seat_no: existing.seat_no, already_seated: true }; }
    // 原子取号(MAX+1 单语句,并发不重号)+ 软离开后重入座(ON CONFLICT 复活原座位)
    db.prepare(`INSERT INTO room_seats (id, room_id, user_id, seat_no, is_host)
      VALUES (?, ?, ?, (SELECT COALESCE(MAX(seat_no), 0) + 1 FROM room_seats WHERE room_id = ?), 0)
      ON CONFLICT(room_id, user_id) DO UPDATE SET left_at = NULL`)
      .run(genId("seat"), room.room_id, mcp.user_id, room.room_id);
    clearJoinFails(mcp.token_id);
    const seat = seatOf(room.room_id, mcp.user_id);
    return { room_id: room.room_id, seat_no: seat.seat_no }; // 只回 room_id,不回显房号
  },

  ask_next_question: (mcp, { room_id, idempotency_key }) => {
    const db = getDb();
    const { room, seat } = roomVisible(room_id, mcp.user_id);
    if (!room) return { error: NOT_FOUND };
    if (!seat.is_host) return { error: NOT_FOUND }; // 推进判 seat 不判 scope;非房主与无房同响应
    const last = db.prepare(`SELECT turn_index FROM room_messages WHERE room_id = ?
      ORDER BY turn_index DESC LIMIT 1`).get(room_id);
    const turn = (last?.turn_index ?? 0) + 1;
    // 服务端幂等键:客户端请求键优先(重放同一请求返回同一结果);
    // 未携带键时按"推进前轮次"派生 —— 同一轮的重放安全,连续推进(换轮)不受影响。
    // 本工具注解 idempotentHint=false:客户端必须显式带键才获得重放保护。
    const clientKey = String(idempotency_key ?? "auto:" + (turn - 1)).slice(0, 128);
    const idemKey = `mcp:${mcp.user_id}:ask_next_question:${room_id}:${clientKey}`;
    const existing = db.prepare("SELECT * FROM idempotency_keys WHERE key = ?").get(idemKey);
    if (existing?.status === "done" && existing.expires_at > nowIso()) {
      return { ...JSON.parse(existing.response), replayed: true };
    }
    const claim = db.prepare("INSERT OR IGNORE INTO idempotency_keys (key, principal, operation, status, expires_at) VALUES (?, ?, 'ask_next_question', 'reserved', ?)")
      .run(idemKey, mcp.user_id, new Date(Date.now() + 86400_000).toISOString());
    if (claim.changes === 0 && existing?.status === "reserved") {
      // 并发/残留占位:该键正被另一执行体持有,拒绝而非重复推进(审查 P1-4)
      return { error: { code: -32005, message: "idempotency key in flight" } };
    }
    const question = { turn_index: turn, question: `第 ${turn} 题(由面试官 Agent 生成,基座题库注入)` };
    db.prepare(`INSERT INTO room_messages (id, room_id, seat_id, turn_index, role, content) VALUES (?, ?, ?, ?, 'interviewer', ?)`)
      .run(genId("msg"), room_id, seat.id, turn, JSON.stringify(question));
    db.prepare("UPDATE idempotency_keys SET status='done', response=? WHERE key=?")
      .run(JSON.stringify(question), idemKey);
    return question;
  },

  submit_self_review: (mcp, { room_id, turn_index, content }) => {
    const db = getDb();
    const { room, seat } = roomVisible(room_id, mcp.user_id);
    if (!room) return { error: NOT_FOUND };
    const text = String(content ?? "").slice(0, 8192);
    if (!text.trim()) return { error: { code: -32602, message: "content 不能为空" } };
    if (!Number.isInteger(turn_index) || turn_index < 1 || turn_index > 1000) {
      return { error: { code: -32602, message: "turn_index 必须是 1..1000 的整数" } };
    }
    db.prepare(`INSERT INTO self_reviews (id, room_id, seat_id, turn_index, content) VALUES (?, ?, ?, ?, ?)`)
      .run(genId("sr"), room_id, seat.id, Number(turn_index), text); // UNIQUE 冲突自动 REPLACE(幂等)
    return { saved: true, turn_index: Number(turn_index) };
  },

  "evidence.search": (mcp, { query, room_id }) => {
    const db = getDb();
    // LIKE 通配符转义(%/_/\\),防"query=% 拖走全房消息"(审查 P2-6)
    const q = `%${String(query ?? "").slice(0, 120).replace(/[\\%_]/g, (c) => "\\" + c)}%`;
    const rooms = room_id
      ? [roomVisible(room_id, mcp.user_id).room?.room_id].filter(Boolean)
      : db.prepare(`SELECT room_id FROM room_seats WHERE user_id = ? AND left_at IS NULL`).all(mcp.user_id).map((r) => r.room_id);
    if (rooms.length === 0) return { results: [] };
    const ph = rooms.map(() => "?").join(",");
    const msgs = db.prepare(`SELECT room_id, turn_index, role, substr(content, 1, 300) AS excerpt, created_at
      FROM room_messages WHERE room_id IN (${ph}) AND content LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT 20`).all(...rooms, q);
    const revs = db.prepare(`SELECT r.room_id, r.turn_index, substr(r.content, 1, 300) AS excerpt, r.created_at
      FROM self_reviews r JOIN room_seats s ON s.id = r.seat_id
      WHERE r.room_id IN (${ph}) AND s.user_id = ? AND r.content LIKE ? ESCAPE '\\' ORDER BY r.created_at DESC LIMIT 20`)
      .all(...rooms, mcp.user_id, q);
    // 证据区出口:只给摘要与定位,不给全量;不进入评分 prompt(§3.6 职责分离)
    return { results: [
      ...msgs.map((m) => ({ source: "room_message", ...m })),
      ...revs.map((r) => ({ source: "self_review", ...r })),
    ], note: "evidence zone:仅作证据引用,不参与评分结论" };
  },
};
