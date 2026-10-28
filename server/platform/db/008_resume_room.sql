-- 008 · 简历感知出题:rooms 可绑定一份基座资料(简历)ID。
-- 取题时(questions.pickQuestion)按简历文本与题库 keyPoints/tags 的交集加权,
-- "简历写了 Redis 就问 Redis"。材料内容仍留在基座 material_contents,本列只存 ID。
-- 幂等:登记表 platform_migrations 保证单次应用;ALTER ADD COLUMN 若被重放会直接
-- 报 duplicate column 错误,天然防重放(与 001-007 同一套迁移纪律)。
ALTER TABLE rooms ADD COLUMN resume_material_id TEXT;
