-- ============================================================
-- Avatar OS — Memory Lite SQLite Schema (v1)
-- ============================================================
-- 设计原则：不搞重型 RAG，只做 append-only 行为历史 + 用户画像。
-- 这是壁垒从 PPT 变资产的那一刻——FSM 每次状态迁移都写入这里。
-- ============================================================

-- 1. 用户基础属性与习惯 (User Identity & Habits)
CREATE TABLE IF NOT EXISTS user_profile (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  updated_at INTEGER NOT NULL
);

-- 2. 关键事件记录表 (Key Lifecycle & Behavior Events)
CREATE TABLE IF NOT EXISTS lifecycle_event (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,          -- e.g., 'WORK_LATE', 'CLICK_TOUCH', 'WORK_FATIGUE'
  payload TEXT,                      -- JSON 数据
  importance_score REAL DEFAULT 0.5, -- > 0.8 才进入长期回忆
  timestamp INTEGER NOT NULL
);

-- 预置示例数据：第二天唤醒时能够说出"昨天你晚上11点才结束工作"
INSERT OR REPLACE INTO user_profile (key, value, updated_at) VALUES
('user_name', '张老师', 1784534400000),
('work_style', '习惯深夜备课', 1784534400000);
