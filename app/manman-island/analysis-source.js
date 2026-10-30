// 慢慢岛 Hana App · 会话文本采集（只读）
// 供「工作 / 思考」读取「本 Agent 最近 N 天全部会话」，不得静默漏读。
// 依赖 sdk.sessions.get / list / entries，类型见 sdk/app-contract/{bus-requests,sessions}.d.ts。
//
// 关键规则：
//  - 先 get({scope:'all', sessionId}) 验证参考会话的真实 Agent 身份（agentId / agentName）。
//  - 再 list({scope:'all', lifecycle:'all', agentId}) 拉取该 Agent 的全部会话（含归档）。
//  - 只保留该 Agent 的会话；其它 App 的私有会话（ownerPluginId 非空且 namespace/path 为 app）排除并记警告。
//  - modified 仅作可选候选过滤：能解析且明确早于窗口才跳过；无日期或不可解析一律读取。
//  - entries({scope:'all', sessionId}) 返回 {entries, leafId}；按 leafId -> parentId 恢复当前分支，旧分支不混入。
//  - 只提取 user / assistant 文本；剔除 thinking / reasoning / tool 结果；绝不把图片 base64 写进文本。
//  - 消息用自身 timestamp 筛近 7 天（截至快照 now）；时间戳缺失/结构损坏/断链一律抛错，不假装空会话。

import { createHash } from 'node:crypto';

export class AnalysisSourceError extends Error {
  constructor(code, message, cause) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AnalysisSourceError';
    this.code = code;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function fail(code, message, cause) {
  throw new AnalysisSourceError(code, message, cause);
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function toFiniteMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
    const d = Date.parse(v);
    if (Number.isFinite(d)) return d;
  }
  return null;
}

async function call(fn, code) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AnalysisSourceError) throw error;
    throw new AnalysisSourceError(code, `读取会话失败：${error && error.message ? error.message : String(error)}`, error);
  }
}

// 其它 App 的私有会话：被某个插件/App 拥有，且落在 app 私有空间。
function isOtherAppPrivate(s) {
  const owned = typeof s.ownerPluginId === 'string' && s.ownerPluginId !== '';
  if (!owned) return false;
  // Home/code/bridge are host-stamped user-facing namespaces; generic 'private'
  // there means local visibility, not another App's hidden conversation.
  if (['home', 'code', 'bridge'].includes(s.namespace) && s.visibility !== 'plugin_private') return false;
  return s.namespace === 'app' || s.visibility === 'plugin_private' || s.visibility === 'private' || s.path === 'app' || (typeof s.path === 'string' && s.path.startsWith('app/'));
}

// 从当前分支叶子出发，沿 parentId 回溯，返回属于当前分支的 id 集合。
function resolveBranch(entries, leafId, sessionId) {
  const byId = new Map();
  for (const e of entries) {
    if (isObject(e) && typeof e.id === 'string' && e.id !== '') {
      if (byId.has(e.id)) fail('BROKEN_CHAIN', `会话 ${sessionId} 有重复的条目编号。`);
      byId.set(e.id, e);
    }
  }
  const branch = new Set();
  let cur = leafId;
  let hops = 0;
  const limit = byId.size + 1;
  while (cur != null) {
    if (branch.has(cur)) fail('BROKEN_CHAIN', `会话 ${sessionId} 的分支链存在环：${cur}。`);
    const node = byId.get(cur);
    if (!node) fail('BROKEN_CHAIN', `会话 ${sessionId} 的分支链断裂：无法定位 ${cur}。`);
    branch.add(cur);
    const p = node.parentId;
    if (p == null || p === '') break;
    if (typeof p !== 'string') fail('BROKEN_CHAIN', `会话 ${sessionId} 消息 ${cur} 的 parentId 无效。`);
    cur = p;
    if (++hops > limit) fail('BROKEN_CHAIN', `会话 ${sessionId} 的分支链过长或存在环。`);
  }
  return branch;
}

// 从消息对象提取文本与图片引用；图片只用于计数，绝不进入文本。
function messageTextAndImages(m) {
  const images = [];
  let text = '';
  const c = m.content;
  const ignored = new Set(['thinking', 'reasoning', 'toolCall', 'tool-call', 'toolResult', 'tool_result', 'redacted_thinking']);
  const attachmentTypes = new Set(['image', 'image_url', 'file', 'attachment', 'document', 'audio', 'video']);
  if (typeof c === 'string') {
    text = c;
  } else if (c == null) {
    text = '';
  } else if (Array.isArray(c)) {
    for (const part of c) {
      if (part == null) continue;
      if (typeof part === 'string') { text += part; continue; }
      if (!isObject(part)) fail('UNRECOGNIZED_ENTRY', '会话含无法识别的正文片段，未静默跳过。');
      if ((!part.type || part.type === 'text') && typeof part.text === 'string') text += part.text;
      else if (attachmentTypes.has(part.type) || part.image != null) images.push(part.image != null ? part.image : part);
      else if (!ignored.has(part.type)) fail('UNRECOGNIZED_ENTRY', '会话含无法识别的正文类型，未静默跳过。');
    }
  } else if (isObject(c)) {
    if ((!c.type || c.type === 'text') && typeof c.text === 'string') text = c.text;
    else if (attachmentTypes.has(c.type)) images.push(c);
    else if (!ignored.has(c.type) && c.image == null && !Array.isArray(c.images)) fail('UNRECOGNIZED_ENTRY', '会话正文对象无法识别，未当作空会话。');
    if (c.image != null) images.push(c.image);
    if (Array.isArray(c.images)) images.push(...c.images);
  }
  if (Array.isArray(m.images)) images.push(...m.images);
  if (Array.isArray(m.attachments)) images.push(...m.attachments);
  text = text.replace(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\r\n]+/g, image => { images.push(image); return '[图片数据未解析]'; });
  return { text, images };
}

function imageKey(img) {
  if (typeof img === 'string') return 's:' + createHash('sha256').update(img).digest('hex');
  if (isObject(img)) {
    const id = img.id ?? img.fileId ?? img.url ?? img.src;
    if (id != null) return 'o:' + String(id);
    if (typeof img.data === 'string') return 'd:' + createHash('sha256').update(img.data).digest('hex');
    return 'j:' + JSON.stringify(img).slice(0, 96);
  }
  return 'x:' + String(img);
}

function countUniqueImages(list) {
  const seen = new Set();
  let n = 0;
  for (const img of list) {
    const k = imageKey(img);
    if (!seen.has(k)) { seen.add(k); n++; }
  }
  return n;
}

function extractMessages(entries, branchIds, sessionId, from, to) {
  const msgs = [];
  for (const e of entries) {
    if (!isObject(e)) continue;
    if (e.type !== 'message') continue;             // 工具结果 / 思考 / 系统条目：剔除
    const m = e.message;
    if (!isObject(m)) { if (typeof e.id === 'string' && branchIds.has(e.id)) fail('UNRECOGNIZED_ENTRY', `会话 ${sessionId} 当前分支含有损坏的消息对象。`); continue; }
    const role = m.role;
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof e.id !== 'string' || e.id === '') {
      fail('UNRECOGNIZED_ENTRY', `会话 ${sessionId} 存在无法识别结构的消息（缺少 id）。`);
    }
    if (!branchIds.has(e.id)) continue;             // 旧分支不混入
    const c = m.content;
    if (!(typeof c === 'string' || c == null || Array.isArray(c) || isObject(c))) {
      fail('UNRECOGNIZED_ENTRY', `会话 ${sessionId} 消息 ${e.id} 的内容结构无法识别。`);
    }
    const tsRaw = m.timestamp !== undefined ? m.timestamp : e.timestamp;
    const ts = toFiniteMs(tsRaw);
    if (ts == null) fail('UNRECOGNIZED_TIMESTAMP', `会话 ${sessionId} 消息 ${e.id} 缺少有效时间戳。`);
    if (ts < from || ts > to) continue;
    const { text, images } = messageTextAndImages(m);
    msgs.push({ id: e.id, role, ts, text, images });
  }
  msgs.sort((a, b) => a.ts - b.ts); // Stable sort retains branch order for same-millisecond messages.
  return msgs;
}

function formatLine(key, role, ts, content) {
  return `[${key}|${role}|${new Date(ts).toISOString()}] ${content}`;
}

/**
 * 采集本 Agent 最近 days 天的全部会话文本（含归档）。
 * 返回 { agentId, agentName, referenceSessionId, from, to, sources, totalMessages, attachmentCount, warnings }。
 */
export async function collectRecentText(sdk, options = {}) {
  const { referenceSessionId, now = Date.now(), days = 7, onProgress = async () => {}, signal } = options;
  if (typeof referenceSessionId !== 'string' || referenceSessionId === '') fail('INVALID_ARGS', 'referenceSessionId 缺失。');
  if (!Number.isFinite(now)) fail('INVALID_ARGS', 'now 无效。');
  if (!Number.isFinite(days) || days <= 0) fail('INVALID_ARGS', 'days 必须为正数。');
  if (typeof onProgress !== 'function') fail('INVALID_ARGS', 'onProgress 必须是函数。');
  const checkAbort = () => { if (signal && signal.aborted) fail('ABORTED', '采集已取消。'); };

  const from = now - days * DAY_MS;
  const to = now;

  checkAbort();
  const got = await call(() => sdk.sessions.get({ scope: 'all', sessionId: referenceSessionId }), 'READ_FAILED');
  const ref = got && got.session;
  if (!ref) fail('REFERENCE_NOT_FOUND', `找不到参考会话 ${referenceSessionId}。`);
  if (isOtherAppPrivate(ref)) fail('REFERENCE_PRIVATE', '不能把其它 App 的私有会话作为联动入口。');
  const agentId = ref.agentId;
  if (typeof agentId !== 'string' || agentId === '') fail('AGENT_UNKNOWN', `参考会话 ${referenceSessionId} 未关联真实 Agent。`);
  const agentName = typeof ref.agentName === 'string' ? ref.agentName : null;
  await onProgress({ phase: 'agent', sessionId: referenceSessionId, agentId, agentName });
  checkAbort();

  const listed = await call(() => sdk.sessions.list({ scope: 'all', lifecycle: 'all', agentId }), 'READ_FAILED');
  const sessions = listed && Array.isArray(listed.sessions) ? listed.sessions : fail('LIST_INVALID', 'sessions.list 返回结构无效。');
  await onProgress({ phase: 'list', total: sessions.length });
  checkAbort();

  const warnings = [];
  const candidates = [];
  for (const s of sessions) {
    if (!isObject(s)) continue;
    if (s.agentId !== agentId) continue;                        // 其它 Agent
    if (isOtherAppPrivate(s)) {
      warnings.push({ code: 'EXCLUDED_OTHER_APP_SESSION', sessionId: s.sessionId, ownerPluginId: s.ownerPluginId, message: `跳过其它 App 的私有会话 ${s.sessionId}。` });
      continue;
    }
    const mMs = toFiniteMs(s.modified);
    if (mMs != null && mMs < from) continue;                     // 明确早于窗口才跳过；无日期则读取
    candidates.push(s);
  }

  const sources = [];
  let totalMessages = 0;
  let totalAttachments = 0;
  let index = 0;
  for (const s of candidates) {
    checkAbort();
    index++;
    if (typeof s.sessionId !== 'string' || !s.sessionId) fail('SESSION_ID_MISSING', '近期会话缺少稳定身份，未静默跳过。');
    await onProgress({ phase: 'entries', sessionId: s.sessionId, index, done: index, total: candidates.length });
    let er;
    try {
      er = await call(() => sdk.sessions.entries({ scope: 'all', sessionId: s.sessionId }), 'READ_FAILED');
    } catch (error) {
      if (s.lifecycle === 'archived' && (error?.code === 'READ_FAILED' || /active desktop session|archived/i.test(String(error?.message)))) {
        warnings.push({ code: 'ARCHIVED_NOT_READABLE', sessionId: s.sessionId, message: `归档会话 ${s.sessionId} 当前无法通过扩展接口读取内容，已明确提示，未悄悄跳过。` });
        continue;
      }
      throw error;
    }
    const entries = er && Array.isArray(er.entries) ? er.entries : fail('ENTRIES_INVALID', `会话 ${s.sessionId} 的 entries 结构无效。`);
    const leafId = er && er.leafId != null ? er.leafId : null;
    const hasMessages = entries.some(e => isObject(e) && e.type === 'message' && isObject(e.message) && (e.message.role === 'user' || e.message.role === 'assistant'));
    if (hasMessages && leafId == null) fail('BROKEN_CHAIN', `会话 ${s.sessionId} 有消息但缺少 leafId，无法确定当前分支。`);
    const branchIds = leafId != null ? resolveBranch(entries, leafId, s.sessionId) : new Set();
    const msgs = extractMessages(entries, branchIds, s.sessionId, from, to);
    const images = [];
    for (const m of msgs) images.push(...m.images);
    const attachmentCount = countUniqueImages(images);
    const readable = msgs.filter(m => m.text.trim().length > 0);
    const key = 'S' + (sources.length + 1);
    const text = readable.map(m => formatLine(key, m.role, m.ts, m.text)).join('\n');
    if (attachmentCount > 0) {
      warnings.push({ code: 'IMAGE_ATTACHMENTS_NOT_READ', sessionId: s.sessionId, count: attachmentCount, message: `会话 ${s.sessionId} 有 ${attachmentCount} 个图片附件未解析，未写入文本。` });
    }
    totalAttachments += attachmentCount;
    if (!readable.length) continue;
    sources.push({
      key,
      sessionId: s.sessionId,
      title: typeof s.title === 'string' && s.title.trim() ? s.title : '未命名会话',
      messageCount: readable.length,
      firstAt: readable[0].ts,
      lastAt: readable.at(-1).ts,
      attachmentCount,
      text,
    });
    totalMessages += readable.length;
  }
  await onProgress({ phase: 'done', totalMessages, totalAttachments });
  if (!sources.length && warnings.some(w => w.code === 'ARCHIVED_NOT_READABLE')) {
    fail('ARCHIVED_ONLY', '最近7天的可读范围里只有归档会话，而 Hana 当前的扩展接口无法读取归档会话内容。可在 Hana 中打开相关会话后再安排居民。', null);
  }
  return { agentId, agentName, referenceSessionId, from, to, sources, totalMessages, attachmentCount: totalAttachments, warnings };
}

/** 把一段文本按 code point 切成 <= maxChars 的分片，无遗漏（join 后还原原文）。 */
export function splitText(text, maxChars) {
  if (!Number.isInteger(maxChars) || maxChars <= 0) fail('INVALID_ARGS', 'maxChars 必须是正整数。');
  const s = String(text ?? '');
  const cps = Array.from(s);
  const chunks = [];
  for (let i = 0; i < cps.length; i += maxChars) chunks.push(cps.slice(i, i + maxChars).join(''));
  return chunks;
}

/** 把 sources 的全部可读文本切成 <= maxChars 的块；每块带来源 key；长消息完整切片，不设会话数上限、不静默截断。 */
export function chunkSources(sources, maxChars) {
  if (!Number.isInteger(maxChars) || maxChars <= 0) fail('INVALID_ARGS', 'maxChars 必须是正整数。');
  if (!Array.isArray(sources)) fail('INVALID_ARGS', 'sources 必须是数组。');
  const chunks = [];
  for (const src of sources) {
    const key = src && src.key != null ? String(src.key) : 'S?';
    const tag = `[${key}] `;
    const tagLen = Array.from(tag).length;
    if (tagLen >= maxChars) fail('INVALID_ARGS', `maxChars 过小，无法容纳来源标记 [${key}]。`);
    const text = src && typeof src.text === 'string' ? src.text : '';
    if (text === '') continue;
    for (const piece of splitText(text, maxChars - tagLen)) chunks.push(tag + piece);
  }
  return chunks;
}
