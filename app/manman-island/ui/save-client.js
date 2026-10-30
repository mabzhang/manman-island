import { ALLOWED_KEYS, validateRecord, validateOwnershipData, validateAgentNotes, saveError } from './save-format.js';

// Pure logic, independently tested from the Hana bridge and the Canvas engine.
export class SaveClient {
  constructor({ initial, transport, onStatus = () => {}, delay = 120, makeId = () => crypto.randomUUID() }) {
    const record = validateRecord(initial);
    this.transport = transport;
    this.onStatus = onStatus;
    this.delay = delay;
    this.makeId = makeId;
    this.data = record.data;
    this.revision = record.revision;
    this.updatedAt = record.updatedAt;
    this.islandEpoch = record.islandEpoch;
    this.generation = 0;
    this.savedGeneration = 0;
    this.pending = null;
    this.flight = null;
    this.timer = null;
    this.mode = 'ready';
    this.error = null;
    this.intent = 'save';
    this.extras = {};
    this.replacement = null;
    this.storage = Object.freeze({
      getItem: key => Object.hasOwn(this.data, key) ? this.data[key] : null,
      setItem: (key, value) => this.setItem(key, value),
    });
  }
  get dirty() { return this.generation !== this.savedGeneration; }
  get blocked() { return this.mode === 'error' || this.mode === 'conflict'; }
  status() { return { mode: this.mode, dirty: this.dirty, revision: this.revision, islandEpoch: this.islandEpoch, updatedAt: this.updatedAt, replacementPending: this.replacement !== null, error: this.error }; }
  publish(mode, error = null) {
    this.mode = mode; this.error = error;
    this.onStatus(this.status());
  }
  assertWritable() {
    if (this.blocked) throw this.error || saveError('SAVE_BLOCKED', '当前窗口已暂停保存。');
  }
  setItem(key, value) {
    this.assertWritable();
    if (this.replacement) throw saveError('SAVE_REPLACE_IN_PROGRESS', '正在确认替换存档，旧画面暂不写入。', 409);
    if (!ALLOWED_KEYS.has(key) || typeof value !== 'string') throw saveError('INVALID_SAVE', '存档字段无效。');
    if (this.data[key] === value) return;
    this.data[key] = value;
    this.generation++;
    this.publish('saving');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, this.delay);
  }
  replace(data, { intent = 'import', agentNotes = [], confirmedAbandon = false } = {}) {
    this.assertWritable();
    if (this.flight || this.pending || this.dirty || this.replacement) throw saveError('SAVE_BUSY', '请等待当前保存完成后再恢复备份。', 409);
    const nextData = validateOwnershipData(data);
    const nextExtras = intent === 'import' ? { agentNotes: validateAgentNotes(agentNotes, { forImport: true }) } : { confirmedAbandon: confirmedAbandon === true };
    this.replacement = { data: this.exportData(), islandEpoch: this.islandEpoch, generation: this.generation, savedGeneration: this.savedGeneration };
    this.data = nextData;
    this.generation++;
    this.intent = intent;
    this.extras = nextExtras;
    this.publish('saving');
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.flight) return this.flight;
    if (this.blocked) return Promise.reject(this.error);
    if (!this.dirty && !this.pending) return Promise.resolve(this.status());
    this.flight = this.run().finally(() => { this.flight = null; });
    return this.flight;
  }
  async run() {
    let explicitlyRejected = false;
    try {
      while (this.dirty || this.pending) {
        if (!this.pending) {
          this.pending = { generation: this.generation, request: { baseRevision: this.revision, changeId: this.makeId(), intent: this.intent, data: validateOwnershipData(this.data), ...this.extras } };
        }
        this.publish('saving');
        const sent = this.pending;
        let response;
        try { response = await this.transport(sent.request); }
        catch (error) { explicitlyRejected = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500; throw error; }
        const record = validateRecord(response);
        if (record.lastChangeId !== sent.request.changeId || record.revision !== sent.request.baseRevision + 1) throw saveError('INVALID_ACK', '没有收到有效的存档确认。');
        this.revision = record.revision;
        this.updatedAt = record.updatedAt;
        this.islandEpoch = record.islandEpoch;
        this.savedGeneration = sent.generation;
        this.pending = null;
        this.intent = 'save';
        this.extras = {};
        this.replacement = null;
      }
      this.publish('ready');
      return this.status();
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('保存失败。');
      if (this.replacement && explicitlyRejected) {
        const before = this.replacement;
        this.data = before.data; this.islandEpoch = before.islandEpoch;
        this.generation = before.generation; this.savedGeneration = before.savedGeneration;
        this.pending = null; this.replacement = null; this.intent = 'save'; this.extras = {};
        if (failure.code !== 'SAVE_CONFLICT' && failure.code !== 'CHANGE_ID_REUSED') {
          this.publish('ready'); // Authoritative rejection: keep the old island usable, including its cancel button.
          throw failure;
        }
      }
      this.publish(failure.code === 'SAVE_CONFLICT' || failure.code === 'CHANGE_ID_REUSED' ? 'conflict' : 'error', failure);
      throw failure;
    }
  }
  async retry() {
    if (this.mode === 'conflict') throw this.error;
    if (!this.dirty && !this.pending) { this.publish('ready'); return this.status(); }
    this.publish('saving');
    return this.flush();
  }
  exportData() { return validateOwnershipData(this.data); }
  beforeReplacement() { return this.replacement ? { data: validateOwnershipData(this.replacement.data), islandEpoch: this.replacement.islandEpoch } : null; }
  dispose() { clearTimeout(this.timer); this.timer = null; }
}
