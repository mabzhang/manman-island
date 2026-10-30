import { createHash, randomUUID } from 'node:crypto';
import { emptyRecord, validateOwnershipData, validateRecord, validateAgentNotes, plain, saveError, MAX_BYTES, CHOICE_KEY, ACTIVE_NOTE_STATES } from './ui/save-format.js';

export const STORE_KEY = 'manman-island-state.v2';
export const PREVIOUS_KEY = 'manman-island-before-replace.v2';
const signature = input => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const publicRecord = full => validateRecord(full);

// Game revisions and Agent notes share one atomic host-storage object. Updating
// notes does not bump the game's revision, so an AI result cannot collide with
// the five-second game autosave. Every writer uses this single serialization queue.
export function createRepository(storage, now = () => new Date()) {
  let tail = Promise.resolve();
  const exclusive = operation => {
    const task = tail.then(operation);
    tail = task.catch(() => {});
    return task;
  };
  async function readFull() {
    const raw = await storage.get(STORE_KEY);
    if (raw === undefined || raw === null) return { ...emptyRecord(), agentNotes: [], lastRequestHash: null };
    return { ...validateRecord(raw), agentNotes: validateAgentNotes(raw.agentNotes ?? []), lastRequestHash: raw.lastRequestHash ?? null };
  }
  return {
    read: () => exclusive(async () => publicRecord(await readFull())),
    readNotes: epoch => exclusive(async () => {
      const full = await readFull();
      if (epoch !== undefined && epoch !== full.islandEpoch) throw saveError('ISLAND_CHANGED', '小岛已更换，请重新打开页面。', 409);
      return { islandEpoch: full.islandEpoch, entries: full.agentNotes };
    }),
    updateNotes: (epoch, update) => exclusive(async () => {
      const full = await readFull();
      if (!epoch || epoch !== full.islandEpoch) throw saveError('ISLAND_CHANGED', '小岛已经更换，旧任务不会写入新岛。', 409);
      const notes = validateAgentNotes(await update(structuredClone(full.agentNotes), publicRecord(full)));
      await storage.set(STORE_KEY, { ...full, agentNotes: notes });
      return { islandEpoch: epoch, entries: notes };
    }),
    write: input => exclusive(async () => {
      const intent = input?.intent ?? 'save';
      if (!plain(input) || !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 0 || typeof input.changeId !== 'string' || !/^[a-zA-Z0-9-]{8,100}$/.test(input.changeId) || !['save', 'import', 'new-island'].includes(intent)) {
        throw saveError('INVALID_REQUEST', '保存请求格式不正确。');
      }
      const data = validateOwnershipData(input.data);
      const current = await readFull();
      const requestHash = signature({ baseRevision: input.baseRevision, intent, data, agentNotes: input.agentNotes ?? null, confirmedAbandon: input.confirmedAbandon === true });
      if (current.lastChangeId === input.changeId) {
        if (current.lastRequestHash !== requestHash) throw saveError('CHANGE_ID_REUSED', '同一个保存编号不能用于不同内容。', 409);
        return publicRecord(current);
      }
      if (current.revision !== input.baseRevision) throw saveError('SAVE_CONFLICT', '另一个窗口已保存新进度。本窗口已暂停，未覆盖它。', 409);
      if (current.revision >= Number.MAX_SAFE_INTEGER) throw saveError('REVISION_LIMIT', '存档版本号超出范围，未写入。', 409);
      const previousOwner = current.data[CHOICE_KEY] ?? null;
      const nextOwner = data[CHOICE_KEY] ?? null;
      if (previousOwner && intent === 'save' && previousOwner !== nextOwner) throw saveError('ISLAND_CONFIRMATION_REQUIRED', '参观其他岛不会更换归属；创建新岛需要明确确认放弃旧岛。', 409);
      if (intent === 'new-island') {
        if (!nextOwner || nextOwner === previousOwner || input.confirmedAbandon !== true || Object.keys(data).some(key => key !== CHOICE_KEY)) throw saveError('ISLAND_CONFIRMATION_REQUIRED', '请在创建新岛弹窗中明确确认，不能带入其他岛的进度。', 409);
      }
      const replacing = intent === 'import' || intent === 'new-island';
      if (replacing && current.agentNotes.some(note => ACTIVE_NOTE_STATES.has(note.status))) throw saveError('ISLAND_BUSY', '还有居民正在思考或工作，请先等待完成或取消任务，再更换小岛。', 409);
      let notes = current.agentNotes;
      if (intent === 'new-island') notes = [];
      if (intent === 'import') notes = validateAgentNotes(input.agentNotes ?? [], { forImport: true });
      if (!nextOwner && notes.length) throw saveError('INVALID_SAVE', '未创建小岛的备份不能包含 Agent 记录。');
      if (replacing) await storage.set(PREVIOUS_KEY, current);
      const islandEpoch = nextOwner ? (replacing || !current.islandEpoch ? randomUUID() : current.islandEpoch) : null;
      const next = { schemaVersion: 2, revision: current.revision + 1, updatedAt: now().toISOString(), lastChangeId: input.changeId, islandEpoch, data, agentNotes: notes, lastRequestHash: requestHash };
      await storage.set(STORE_KEY, next);
      return publicRecord(next);
    }),
  };
}

export const apiHandler = operation => async c => {
  try { return c.json(await operation(c)); }
  catch (error) {
    const known = typeof error?.code === 'string' && Number.isInteger(error?.status);
    return c.json({ code: known ? error.code : 'APP_OPERATION_FAILED', error: known ? error.message : '操作暂时不可用，请保留当前窗口并查看应用权限或稍后重试。' }, known ? error.status : 503);
  }
};
export async function readRequest(c, maxBytes = MAX_BYTES + 65536) {
  const length = Number(c.req.header('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw saveError('INVALID_REQUEST', '请求超过大小限制。', 413);
  const text = await c.req.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw saveError('INVALID_REQUEST', '请求超过大小限制。', 413);
  try { return JSON.parse(text); } catch { throw saveError('INVALID_REQUEST', '请求不是有效 JSON。'); }
}
export function registerSaveRoutes(app, repository) {
  app.get('/state', apiHandler(() => repository.read()));
  app.put('/state', apiHandler(async c => repository.write(await readRequest(c))));
}
