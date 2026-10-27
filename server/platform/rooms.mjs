// 房间服务(REST 侧;MCP 工具直接操作 db,此处为 Web 提供同语义服务)。
// 纪律与 MCP 一致:room_code 只在创建/入座时出现一次;列表与详情永不回显;
// 越权与不存在同响应(NOT_FOUND)。
import { getDb, genId, newRoomId, newRoomCode } from "./db.mjs";

export const ROOM_NOT_FOUND = Object.freeze({ status: 404, code: "NOT_FOUND", message: "房间不存在" });

export function createRoom({ hostUserId, industry = null, position = null }) {
  const db = getDb();
  const roomId = newRoomId();
  // 碰撞换码重试:code 必须在循环内重新生成(审查 F1:循环外生成使重试形同虚设)
  let created = false;
  for (let i = 0; i < 5 && !created; i++) {
    const code = newRoomCode();
    try {
      db.prepare("INSERT INTO rooms (room_id, room_code, host_user_id, industry, position) VALUES (?, ?, ?, ?, ?)")
        .run(roomId, code, hostUserId, industry, position);
      created = true;
      db.prepare("INSERT INTO room_seats (id, room_id, user_id, seat_no, is_host) VALUES (?, ?, ?, 1, 1)")
        .run(genId("seat"), roomId, hostUserId);
      return { room_id: roomId, room_code: code }; // code 仅此一次返回给房主
    } catch (e) {
      if (!String(e.message).includes("UNIQUE")) throw e;
    }
  }
  throw Object.assign(new Error("房号空间紧张,创建失败请重试"), { status: 503 });
}

export function myRooms(userId) {
  return getDb().prepare(`SELECT r.room_id, r.status, r.industry, r.position, r.created_at, s.is_host, s.seat_no
    FROM rooms r JOIN room_seats s ON s.room_id = r.room_id
    WHERE s.user_id = ? AND s.left_at IS NULL ORDER BY r.created_at DESC LIMIT 50`).all(userId);
}

export function joinRoom({ userId, roomCode }) {
  const db = getDb();
  const room = db.prepare("SELECT * FROM rooms WHERE room_code = ? AND status != 'closed'")
    .get(String(roomCode ?? ""));
  if (!room) return { error: ROOM_NOT_FOUND };
  const seat = db.prepare("SELECT * FROM room_seats WHERE room_id = ? AND user_id = ?")
    .get(room.room_id, userId);
  if (seat && !seat.left_at) return { room_id: room.room_id, seat_no: seat.seat_no, already_seated: true };
  // 原子取号 + 软离开后重入座(审查 F8:裸 INSERT 撞 UNIQUE(room_id,user_id) 会 500)
  db.prepare(`INSERT INTO room_seats (id, room_id, user_id, seat_no, is_host)
    VALUES (?, ?, ?, (SELECT COALESCE(MAX(seat_no), 0) + 1 FROM room_seats WHERE room_id = ?), 0)
    ON CONFLICT(room_id, user_id) DO UPDATE SET left_at = NULL`)
    .run(genId("seat"), room.room_id, userId, room.room_id);
  const nowSeat = db.prepare("SELECT seat_no FROM room_seats WHERE room_id = ? AND user_id = ?").get(room.room_id, userId);
  db.prepare("INSERT INTO funnel_events (id, event, user_hash, room_code) VALUES (?, 'room_join', ?, ?)")
    .run(genId("fev"), userId, room.room_code);
  return { room_id: room.room_id, seat_no: nowSeat.seat_no };
}

export function roomDetail({ roomId, userId }) {
  const db = getDb();
  const room = db.prepare("SELECT * FROM rooms WHERE room_id = ?").get(roomId);
  const seat = room && db.prepare("SELECT * FROM room_seats WHERE room_id = ? AND user_id = ? AND left_at IS NULL")
    .get(roomId, userId);
  if (!room || !seat) return { error: ROOM_NOT_FOUND };
  const seats = db.prepare("SELECT seat_no, is_host, joined_at FROM room_seats WHERE room_id = ? AND left_at IS NULL ORDER BY seat_no").all(roomId);
  const { room_code, ...safe } = room; // 脱敏:详情永不回显房号
  return { room: safe, seats, your_seat_no: seat.seat_no, is_host: !!seat.is_host };
}

export function listMessages({ roomId, userId, afterTurn = 0 }) {
  const detail = roomDetail({ roomId, userId });
  if (detail.error) return detail;
  const rows = getDb().prepare(`SELECT turn_index, role, content, created_at FROM room_messages
    WHERE room_id = ? AND turn_index > ? ORDER BY turn_index LIMIT 100`).all(roomId, Number(afterTurn) || 0);
  return { messages: rows };
}

/** 候选人发言(非房主也可;内容 ≤8KB;turn 取当前最大轮)。 */
export function postMessage({ roomId, userId, content, role = "candidate" }) {
  const db = getDb();
  const detail = roomDetail({ roomId, userId });
  if (detail.error) return detail;
  if (!["candidate", "system"].includes(role)) role = "candidate";
  const text = String(content ?? "").slice(0, 8192);
  if (!text.trim()) return { error: { status: 400, code: "VALIDATION", message: "内容不能为空" } };
  const seat = db.prepare("SELECT id FROM room_seats WHERE room_id = ? AND user_id = ?").get(roomId, userId);
  const last = db.prepare("SELECT turn_index FROM room_messages WHERE room_id = ? ORDER BY turn_index DESC LIMIT 1").get(roomId);
  const turn = (last?.turn_index ?? 0) + 1;
  db.prepare("INSERT INTO room_messages (id, room_id, seat_id, turn_index, role, content) VALUES (?, ?, ?, ?, ?, ?)")
    .run(genId("msg"), roomId, seat.id, turn, role, text);
  return { turn_index: turn };
}

export function trackEvent({ event, userHash = null, sessionTicket = null, roomCode = null, props = {} }) {
  const allowed = new Set(["landing_uv", "practice_start", "practice_complete", "review_view", "first_redo", "first_pay", "room_join", "room_paid_by_invitee"]);
  if (!allowed.has(event)) return { error: { status: 400, code: "VALIDATION", message: `未知事件 ${event}` } };
  // 匿名端点字段截断(审查 F6:防匿名灌库膨胀)
  const clip = (v, n) => (v == null ? null : String(v).slice(0, n));
  getDb().prepare("INSERT INTO funnel_events (id, event, user_hash, session_ticket, room_code, props) VALUES (?, ?, ?, ?, ?, ?)")
    .run(genId("fev"), event, clip(userHash, 64), clip(sessionTicket, 64), clip(roomCode, 16), JSON.stringify(props).slice(0, 2048));
  return { tracked: true };
}
