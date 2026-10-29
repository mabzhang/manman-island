// Shared, dependency-free save validation. The original game's string-valued keys stay intact.
export const FORMAT = 'manman-island.hana-save';
export const VERSION = 2;
export const MAX_BYTES = 8 * 1024 * 1024;
export const MAX_GAME_BYTES = 2 * 1024 * 1024;
export const MAX_NOTES_BYTES = 4 * 1024 * 1024;
export const ACTIVE_NOTE_STATES = new Set(['queued', 'reading', 'analyzing', 'summarizing']);
export const THEME_IDS = ['panda', 'corgi', 'sheep', 'duck', 'rabbit', 'fox', 'penguin'];
export const CHOICE_KEY = 'slow-island.selected-theme.v1';
export const RESIDENT_PREFIX = 'slow-island.residents.v1.';
export const JOURNAL_PREFIX = 'slow-island.keeper.v1.';
const ACTIONS = new Set(['walk', 'active', 'work', 'think', 'eat', 'poop', 'fart', 'rest', 'company']);
export const ALLOWED_KEYS = new Set([CHOICE_KEY, ...THEME_IDS.flatMap(id => [RESIDENT_PREFIX + id, JOURNAL_PREFIX + id])]);
const encoder = new TextEncoder();
export function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function saveError(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
function requireValue(condition, message) {
  if (!condition) throw saveError('INVALID_SAVE', message);
}
function checkResidents(value) {
  requireValue(plain(value) && value.version === 1 && Array.isArray(value.agents) && value.agents.length <= 30, '居民存档格式不正确或超过 30 位。');
  const ids = new Set();
  for (const a of value.agents) {
    requireValue(plain(a) && Number.isSafeInteger(a.id) && a.id > 0 && !ids.has(a.id), '居民编号缺失或重复。');
    ids.add(a.id);
    requireValue(['u', 'v', 'size'].every(key => Number.isFinite(a[key])) && a.size > 0 && a.size <= .42, '居民位置或体型无效。');
    for (const key of ['birthSize', 'maxSize', 'growthAge', 'range']) {
      if (a[key] !== undefined) requireValue(Number.isFinite(a[key]) && a[key] >= 0, '居民成长字段无效。');
    }
    if (a.name !== undefined) requireValue(typeof a.name === 'string' && Array.from(a.name).length <= 16, '居民名字超过 16 个字。');
    if (a.palette !== undefined) requireValue(Number.isInteger(a.palette) && a.palette >= 0 && a.palette <= 14, '居民配色无效。');
    if (a.phraseBag != null) requireValue(Array.isArray(a.phraseBag) && a.phraseBag.length === 200 && new Set(a.phraseBag).size === 200 && a.phraseBag.every(x => Number.isInteger(x) && x >= 0 && x < 200), '居民台词顺序无效。');
  }
}
function checkJournal(value) {
  requireValue(plain(value) && value.version === 1 && plain(value.clock), '记录本格式不正确。');
  const c = value.clock;
  requireValue(Number.isFinite(c.elapsed) && c.elapsed >= 0 && c.elapsed <= 300 && Number.isInteger(c.count) && c.count >= 1 && c.count <= 4 && Number.isInteger(c.slot) && c.slot >= 0 && c.slot < c.count, '记录本计时进度无效。');
  requireValue(Array.isArray(value.entries) && value.entries.length <= 200 && Array.isArray(value.pending) && value.pending.length <= 160, '记录本条目数量无效。');
  for (const e of value.entries) {
    requireValue(plain(e) && typeof e.text === 'string' && e.text.length < 500 && Number.isFinite(e.at) && ACTIONS.has(e.action), '记录本含有无效条目。');
  }
  for (const e of value.pending) {
    requireValue(plain(e) && Number.isFinite(e.at) && typeof e.name === 'string' && e.name.length <= 64 && ACTIONS.has(e.action), '记录本待记条目无效。');
    if (e.action === 'work' || e.action === 'think') requireValue(e.manual === true, '工作与思考只能来自手动安排。');
  }
}
export function validateData(data) {
  requireValue(plain(data), '存档必须是一个对象。');
  requireValue(Object.keys(data).length <= ALLOWED_KEYS.size, '存档包含过多字段。');
  const serialized = JSON.stringify(data);
  requireValue(encoder.encode(serialized).byteLength <= MAX_GAME_BYTES, '小岛进度超过 2 MiB，未写入。');
  for (const [key, raw] of Object.entries(data)) {
    requireValue(ALLOWED_KEYS.has(key) && typeof raw === 'string', '存档包含未知字段或非字符串内容。');
    if (key === CHOICE_KEY) {
      requireValue(THEME_IDS.includes(raw), '存档中的小岛不存在。');
      continue;
    }
    let value;
    try { value = JSON.parse(raw); } catch { throw saveError('INVALID_SAVE', '存档中的居民或记录本 JSON 损坏。'); }
    if (key.startsWith(RESIDENT_PREFIX)) checkResidents(value); else checkJournal(value);
  }
  return JSON.parse(serialized);
}
export function emptyRecord() {
  return { schemaVersion: VERSION, revision: 0, updatedAt: null, lastChangeId: null, islandEpoch: null, data: {} };
}
export function validateRecord(record) {
  requireValue(plain(record) && record.schemaVersion === VERSION && Number.isSafeInteger(record.revision) && record.revision >= 0, 'Hana 存档版本不受支持，已停止写入。');
  requireValue(record.updatedAt === null || (typeof record.updatedAt === 'string' && Number.isFinite(Date.parse(record.updatedAt))), '存档时间戳无效。');
  requireValue(record.lastChangeId === null || (typeof record.lastChangeId === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(record.lastChangeId)), '存档变更编号无效。');
  const data = validateOwnershipData(record.data);
  requireValue(data[CHOICE_KEY] ? typeof record.islandEpoch === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(record.islandEpoch) : record.islandEpoch === null, '小岛归属标识无效。');
  return { schemaVersion: VERSION, revision: record.revision, updatedAt: record.updatedAt, lastChangeId: record.lastChangeId, islandEpoch: record.islandEpoch, data };
}
export function encodeBackup(data, { saved = true, now = new Date(), agentNotes = [] } = {}) {
  return JSON.stringify({ format: FORMAT, version: VERSION, exportedAt: now.toISOString(), savedToHana: saved, data: validateOwnershipData(data), agentNotes: validateAgentNotes(agentNotes) }, null, 2);
}
export function decodeBackup(text) {
  if (typeof text !== 'string' || encoder.encode(text).byteLength > MAX_BYTES) throw saveError('INVALID_SAVE', '备份为空或超过 8 MiB。');
  let backup;
  try { backup = JSON.parse(text); } catch { throw saveError('INVALID_SAVE', '无法读取备份 JSON。'); }
  requireValue(plain(backup) && backup.format === FORMAT && backup.version === VERSION, '请选择慢慢岛 Hana 联动版导出的备份（v2）。');
  return { data: validateOwnershipData(backup.data), agentNotes: validateAgentNotes(backup.agentNotes ?? [], { forImport: true }) };
}
export function validateOwnershipData(input) {
  const data = validateData(input);
  const owner = data[CHOICE_KEY];
  requireValue(owner || Object.keys(data).length === 0, '请先创建属于自己的小岛。');
  for (const key of Object.keys(data)) requireValue(key === CHOICE_KEY || key === RESIDENT_PREFIX + owner || key === JOURNAL_PREFIX + owner, '一次只能拥有一座小岛，不能写入参观岛屿的进度。');
  return data;
}
export function validateAgentNotes(input, { forImport = false } = {}) {
  requireValue(Array.isArray(input), 'Agent 记录本格式无效。');
  requireValue(encoder.encode(JSON.stringify(input)).byteLength <= MAX_NOTES_BYTES, 'Agent 记录本超过 4 MiB，请备份后再创建新岛，不会自动删除记录。');
  const allowedStates = new Set([...ACTIVE_NOTE_STATES, 'completed', 'failed', 'canceled']);
  const seen = new Set();
  return input.map(raw => {
    requireValue(plain(raw) && typeof raw.id === 'string' && /^[a-zA-Z0-9-]{8,100}$/.test(raw.id) && !seen.has(raw.id), 'Agent 记录编号无效或重复。');
    seen.add(raw.id);
    requireValue(['think', 'work'].includes(raw.kind) && allowedStates.has(raw.status), 'Agent 记录类型或状态无效。');
    requireValue(Number.isFinite(raw.createdAt) && Number.isFinite(raw.updatedAt), 'Agent 记录时间无效。');
    requireValue(typeof raw.text === 'string' && raw.text.length <= 60000, 'Agent 记录正文无效。');
    requireValue(Array.isArray(raw.sources) && raw.sources.every(source => plain(source) && typeof source.key === 'string' && /^S\d+$/.test(source.key) && typeof source.sessionId === 'string' && source.sessionId.length <= 200 && typeof source.title === 'string' && source.title.length <= 1000), 'Agent 记录来源无效。');
    requireValue(raw.error === null || typeof raw.error === 'string', 'Agent 记录错误字段无效。');
    const note = JSON.parse(JSON.stringify(raw));
    if (forImport) {
      note.taskId = null;
      if (ACTIVE_NOTE_STATES.has(note.status)) { note.status = 'failed'; note.error = '这是备份中的未完成任务，未自动重新调用模型。请手动发起新任务。'; }
    }
    return note;
  });
}
export function describeData(data) {
  let islands = 0, residents = 0, entries = 0;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith(RESIDENT_PREFIX)) { islands++; residents += JSON.parse(value).agents.length; }
    else if (key.startsWith(JOURNAL_PREFIX)) entries += JSON.parse(value).entries.length;
  }
  return { islands, residents, entries, selected: data[CHOICE_KEY] ?? null };
}
