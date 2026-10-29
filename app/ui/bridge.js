import { hana as defaultHana } from './assets/sdk.js';
import { SaveClient } from './save-client.js';
import { decodeBackup, encodeBackup, describeData, MAX_BYTES, saveError, CHOICE_KEY, ACTIVE_NOTE_STATES } from './save-format.js';
const $ = id => document.getElementById(id);
const STATE_KEY = 'manman-island-state.v2';
const noteStates = { queued: '准备中', reading: '读会话', analyzing: '分析中', summarizing: '整理中', completed: '已记下', failed: '未完成', canceled: '已取消' };
function utf8Base64(text) {
  const bytes = new TextEncoder().encode(text); let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function timeLabel(iso) { return iso ? new Date(iso).toLocaleTimeString('zh-CN', { hour12: false }) : '还没有需要保存的进度'; }
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function renderProse(container, text) {
  for (const line of text.split('\n')) {
    const node = element(/^#{1,4}\s/.test(line) ? 'h4' : 'p');
    const clean = line.replace(/^#{1,4}\s+/, '');
    let at = 0;
    for (const match of clean.matchAll(/\*\*([^*]+)\*\*/g)) { node.append(document.createTextNode(clean.slice(at, match.index)), element('strong', '', match[1])); at = match.index + match[0].length; }
    node.append(document.createTextNode(clean.slice(at))); container.append(node);
  }
}

export async function connectIsland(hana = defaultHana) {
  let game = null, navigation = null, client = null, manualPause = false, disposed = false, replacingGame = false;
  let hostVisible = true, pendingImport = null, currentView = null, activeSession = null;
  let notes = [], notesEpoch = null, notesSignature = '', notesFlight = null, refreshAgain = false, requestStarting = false;
  let offSessions = () => {}, offStorage = () => {};
  const dialog = $('hanaSaveDialog'), newIslandDialog = $('newIslandDialog');
  const effectiveVisible = () => hostVisible && !document.hidden && !manualPause;
  const canRun = () => effectiveVisible() && !client?.blocked;
  const ownerId = () => client?.storage.getItem(CHOICE_KEY);
  const reportMessage = message => { $('hanaSaveMessage').textContent = message; };
  const connectionMessage = message => { $('agentConnectionStatus').textContent = message; };
  const busyNote = () => notes.find(note => ACTIVE_NOTE_STATES.has(note.status));
  function reflectVisibility({ save = true } = {}) {
    if (!game) return;
    if (canRun()) game.resume(); else game.suspend(save && !client.blocked);
  }
  function statusChanged(status) {
    $('hanaSaveButton').dataset.status = status.mode;
    $('hanaSaveButton').title = status.mode === 'ready' ? `Hana 存档 · ${timeLabel(status.updatedAt)}` : status.mode === 'saving' ? '正在保存到 Hana' : '存档需要处理，小岛已暂停';
    $('hanaSaveStatus').textContent = status.mode === 'ready' ? `已保存到 Hana · ${timeLabel(status.updatedAt)}` : status.mode === 'saving' ? '正在保存，请稍候…' : (status.error?.message || '保存暂时不可用。');
    const blocked = status.mode === 'error' || status.mode === 'conflict';
    $('hanaNotice').hidden = !blocked;
    $('home').inert = blocked; $('studio').inert = blocked; $('residentMenu').inert = blocked;
    $('islandBrowseButton').disabled = blocked || !game;
    if (blocked) {
      $('hanaNoticeText').textContent = status.mode === 'conflict'
        ? '另一个窗口已经保存了新进度。本窗口已暂停，未覆盖它。可先导出本窗口备份，再载入最新存档。'
        : `保存尚未确认，小岛已暂停。${status.error?.message || '请检查 Hana 连接。'} 当前草稿仍在本窗口，关闭前请重试或导出备份。`;
      $('hanaRetrySave').hidden = status.mode === 'conflict';
      $('hanaReloadSave').hidden = false;
    }
    reflectVisibility({ save: false });
    if (status.mode === 'ready' && game && status.islandEpoch && notesEpoch !== status.islandEpoch) void refreshNotes();
  }
  async function api(path, init) {
    const response = await hana.api.fetch(path, init);
    let result;
    try { result = await response.json(); } catch { throw saveError('APP_RESPONSE_INVALID', 'Hana 没有返回有效数据。', 503); }
    if (!response.ok) throw saveError(typeof result.code === 'string' ? result.code : 'APP_UNAVAILABLE', typeof result.error === 'string' ? result.error : 'Hana 操作暂时不可用。', response.status);
    return result;
  }
  const post = (path, data) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  try {
    await hana.ready();
    hostVisible = hana.lifecycle.getSnapshot().visible !== false;
    const initial = await api('/state');
    client = new SaveClient({ initial, transport: request => api('/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) }), onStatus: statusChanged });
    statusChanged(client.status());
  } catch (error) {
    $('hanaStartup').hidden = false; $('hanaStartup').dataset.error = 'true';
    $('hanaStartupText').textContent = `小岛还没有启动：${error.message || '无法连接 Hana 存档。'} 没有创建或覆盖存档，请重新打开此页面。`;
    $('hanaStartupRetry').hidden = false; $('hanaStartupRetry').onclick = () => location.reload();
    throw error;
  }

  function updateImportControls() {
    $('hanaConfirmImport').disabled = !pendingImport || !$('hanaImportAcknowledge').checked || !!busyNote() || client.blocked;
    if (pendingImport && busyNote() && dialog.open) reportMessage('居民正在思考或工作，暂时不能导入。可以先导出备份，关闭本窗口后到记录本取消任务，或等待完成。');
  }
  async function applyReplacement(data, options) {
    await client.flush();
    replacingGame = true;
    try {
      client.replace(data, options);
      await client.flush();
      // The old world's pagehide handler must not overwrite the just-imported
      // snapshot while the navigation is being committed.
      location.reload();
    } catch (error) {
      if (!client.beforeReplacement()) replacingGame = false;
      throw error;
    }
  }
  function updateVisitControls() {
    const visiting = currentView && !currentView.owned;
    $('islandVisitNotice').hidden = !visiting;
    if (visiting) {
      $('islandVisitText').textContent = `正在参观「${currentView.name}」 · 只看风景，不操作居民、不保存进度。${busyNote() ? '原岛有居民正在忙，暂时不能创建新岛。' : ''}`;
      $('createViewedIsland').disabled = !!busyNote() || client.blocked;
    }
  }
  function renderNotes() {
    const container = $('agentNoteList');
    const openIds = new Set([...container.querySelectorAll('details.agent-record[open]')].map(node => node.dataset.noteId));
    const hadRecords = container.childElementCount > 0;
    container.replaceChildren();
    const active = busyNote();
    $('agentBookCount').textContent = active ? `${active.residentName}正在${active.kind === 'think' ? '思考' : '工作'}…` : `Agent 记录 ${notes.length} 则`;
    if (!notes.length) container.append(element('p', 'agent-empty', '安排一位居民思考或工作，它会把有依据的观察留在这里。'));
    for (const [index, note] of [...notes].reverse().entries()) {
      const details = element('details', `agent-record agent-${note.kind}`); details.dataset.noteId = note.id;
      details.open = openIds.has(note.id) || (!hadRecords && index === 0) || ACTIVE_NOTE_STATES.has(note.status);
      const summary = element('summary', 'agent-record-summary');
      summary.append(element('strong', '', `${note.residentName} · ${note.kind === 'think' ? '思考' : '工作'}`), element('span', `agent-state ${note.status}`, noteStates[note.status] || note.status), element('time', '', new Date(note.createdAt).toLocaleString('zh-CN', { hour12: false })));
      details.append(summary);
      let built = false;
      const buildBody = () => {
        if (built) return; built = true;
        const body = element('div', 'agent-record-body');
        if (note.agentName || note.agentId) body.append(element('p', 'agent-record-meta', `联动 ${note.agentName || note.agentId} · ${note.model?.name || '读取资料中'}`));
        if (ACTIVE_NOTE_STATES.has(note.status)) {
          body.append(element('p', 'agent-progress', note.progress?.message || '正在处理…'));
          const cancel = element('button', 'plain', '取消这个任务'); cancel.type = 'button';
          cancel.onclick = async () => { cancel.disabled = true; try { await post('/analysis/cancel', { id: note.id, islandEpoch: client.islandEpoch }); await refreshNotes(); } catch (error) { connectionMessage(error.message); cancel.disabled = false; } };
          body.append(cancel);
        }
        if (note.text) renderProse(body, note.text);
        if (note.error) body.append(element('p', 'agent-error', note.error));
        if (note.taskReceiptWarning) body.append(element('p', 'agent-error', note.taskReceiptWarning));
        if (note.coverage) {
          const c = note.coverage;
          body.append(element('p', 'agent-record-meta', `覆盖 ${c.conversations} 个会话、${c.messages} 条文字；范围 ${new Date(c.from).toLocaleString('zh-CN')} 至 ${new Date(c.to).toLocaleString('zh-CN')}。${c.attachmentsNotRead ? `有 ${c.attachmentsNotRead} 项图片/附件未解析。` : ''}`));
          for (const warning of c.warnings || []) body.append(element('p', 'agent-record-meta', typeof warning === 'string' ? warning : String(warning.message || warning.code || '有未解析的内容')));
        }
        if (note.sources.length) {
          const sources = element('details', 'agent-sources'); sources.append(element('summary', '', `依据的会话（${note.sources.length}）`));
          for (const source of note.sources) {
            const button = element('button', 'agent-source-button', `[${source.key}] ${source.title}`); button.type = 'button';
            button.onclick = async () => { try { await hana.sessions.focus({ sessionId: source.sessionId }); } catch (error) { connectionMessage(`无法打开来源会话：${error.message}`); } };
            sources.append(button);
          }
          body.append(sources);
        }
        if (note.usage?.requests) body.append(element('p', 'agent-record-meta', `模型请求 ${note.usage.requests} 次 · 已报告用量 ${note.usage.totalTokens || note.usage.input + note.usage.output} token`));
        details.append(body);
      };
      if (details.open) buildBody(); details.addEventListener('toggle', () => { if (details.open) buildBody(); });
      container.append(details);
    }
    game?.setAgentTasks(notes); updateVisitControls(); updateImportControls();
  }
  async function refreshNotes() {
    if (!client.islandEpoch || disposed) return;
    if (notesFlight) { refreshAgain = true; return notesFlight; }
    const epoch = client.islandEpoch;
    notesFlight = (async () => {
      try {
        const result = await api('/analysis?epoch=' + encodeURIComponent(epoch));
        if (client.islandEpoch !== epoch) return;
        const signature = JSON.stringify(result.entries);
        notes = result.entries; notesEpoch = epoch;
        if (signature !== notesSignature) { notesSignature = signature; renderNotes(); }
      } catch (error) { connectionMessage(`Agent 记录暂未刷新：${error.message}`); }
      finally { notesFlight = null; if (refreshAgain && !disposed) { refreshAgain = false; void refreshNotes(); } }
    })();
    return notesFlight;
  }
  function reflectSession(session) {
    activeSession = session;
    connectionMessage(session?.agentId ? `当前联动 Agent：${session.agentId} · 点击时读取过去7×24小时的全部可读取文字会话。` : '请先在 Hana 打开本 Agent 的一个会话，再回小岛安排思考或工作。日常玩法不受影响。');
  }
  async function connectSession() {
    try {
      reflectSession(await hana.sessions.getActive());
      offSessions();
      offSessions = hana.sessions.onActiveChanged(change => reflectSession(change.current), error => connectionMessage(`会话联动不可用：${error.message}。请检查“读取会话”权限。`));
    } catch (error) { connectionMessage(`尚未连接会话：${error.message}。授予读取会话、模型推理和任务权限后，点击居民重试即可。`); }
  }
  async function requestAnalysis({ kind, residentId }) {
    try {
      if (!currentView?.owned) throw new Error('参观模式不能安排居民执行动作。');
      if (requestStarting || busyNote()) throw new Error('已经有居民在思考或工作，请等待完成或先取消任务。');
      requestStarting = true;
      game.save(); await client.flush();
      const selected = await hana.sessions.getActive(); reflectSession(selected);
      if (!selected?.sessionId || !selected.agentId) throw new Error('请先在 Hana 打开本 Agent 的一个会话。');
      const note = await post('/analysis', { requestId: crypto.randomUUID(), kind, residentId, referenceSessionId: selected.sessionId, islandEpoch: client.islandEpoch });
      await refreshNotes();
      connectionMessage(`任务已交给 ${selected.agentId}，结果会写入下方记录。模型调用可能产生费用，可随时取消。`);
      return note;
    } catch (error) { connectionMessage(`没有启动联动：${error.message}`); game?.openJournal(); throw error; }
    finally { requestStarting = false; }
  }

  function pauseForDialog() { manualPause = true; reflectVisibility(); }
  function resumeAfterDialog() { manualPause = dialog.open || newIslandDialog.open; reflectVisibility({ save: false }); }
  function showSaveDialog() {
    pauseForDialog(); pendingImport = null;
    $('hanaImportConfirm').hidden = true; $('hanaImportFile').value = '';
    reportMessage(busyNote() ? '居民正在思考或工作：可以导出备份，暂时不能导入。关闭此对话框后可在记录本取消任务。' : '备份包含当前岛的居民、生活记录和已载入的 Agent 记录。选择备份文件不会立即替换进度。');
    if (!dialog.open) dialog.showModal();
    if (!client.blocked) client.flush().catch(() => {});
  }
  async function exportBackup() {
    $('hanaExportSave').disabled = true;
    try {
      if (!client.blocked) { game?.save(); try { await client.flush(); } catch {} }
      await refreshNotes();
      const now = new Date(), pad = n => String(n).padStart(2, '0');
      const stamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const beforeReplacement = client.beforeReplacement();
      const exportEpoch = beforeReplacement?.islandEpoch ?? client.islandEpoch;
      const sameEpoch = notesEpoch === exportEpoch;
      const text = encodeBackup(beforeReplacement?.data ?? client.exportData(), { saved: !client.dirty, now, agentNotes: sameEpoch ? notes : [] });
      const result = await hana.resources.saveFile({ suggestedName: `慢慢岛-存档-${stamp}.json`, mimeType: 'application/json', contentBase64: utf8Base64(text) });
      if (result.kind === 'saved') reportMessage(beforeReplacement ? '已导出替换前的小岛备份。本次替换的服务器状态尚未确认，请重新载入检查，不能把这份备份当作服务器当前状态。' : sameEpoch ? '备份文件已保存，包含当前岛进度和本窗口已载入的 Agent 记录。进行中的任务不会在恢复备份时自动重跑。' : '备份已保存，但本窗口未载入匹配的 Agent 记录，本份备份不包含 Agent 分析。');
      else if (result.kind === 'download-started') reportMessage('浏览器已开始下载，请在下载列表确认文件是否保存完成。');
      else if (result.kind === 'canceled') reportMessage('已取消导出，没有改动任何存档。');
      else if (result.kind === 'conflict') reportMessage(result.mayHaveWritten ? '目标文件写入后的状态未确认，请检查文件并另选新文件名。' : '目标文件发生变化，未确认覆盖，请另选新文件名。');
      else reportMessage('没有收到文件保存确认，请检查目标位置。');
    } catch (error) { reportMessage(`备份未完成：${error.message}`); }
    finally { $('hanaExportSave').disabled = false; }
  }
  $('hanaSaveButton').onclick = showSaveDialog; $('hanaNoticeBackup').onclick = showSaveDialog;
  $('hanaCloseSave').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { pendingImport = null; resumeAfterDialog(); });
  $('hanaExportSave').onclick = exportBackup;
  $('hanaRetrySave').onclick = async () => { $('hanaRetrySave').disabled = true; try { await client.retry(); if (replacingGame) location.reload(); } catch {} finally { $('hanaRetrySave').disabled = false; } };
  $('hanaReloadSave').onclick = () => location.reload();
  $('hanaSaveNow').onclick = async () => {
    $('hanaSaveNow').disabled = true;
    try { if (client.blocked) await client.retry(); else { game?.save(); await client.flush(); } if (replacingGame) location.reload(); else reportMessage('当前游戏进度已收到 Hana 的保存确认。Agent 任务结果由后端独立保存。'); }
    catch (error) { reportMessage(error.message); }
    finally { $('hanaSaveNow').disabled = false; }
  };
  $('hanaImportFile').addEventListener('change', async event => {
    pendingImport = null; $('hanaImportConfirm').hidden = true;
    const file = event.target.files?.[0]; if (!file) return;
    try {
      if (file.size > MAX_BYTES) throw new Error('备份超过 8 MiB。');
      pendingImport = decodeBackup(await file.text());
      const info = describeData(pendingImport.data);
      $('hanaImportSummary').textContent = `这份备份包含 ${info.residents} 位居民、${info.entries} 则生活记录、${pendingImport.agentNotes.length} 则 Agent 记录。确认后替换当前小岛全部进度；未完成的模型任务不会自动续跑。建议先导出当前备份。`;
      $('hanaImportAcknowledge').checked = false; $('hanaConfirmImport').disabled = true; $('hanaImportConfirm').hidden = false;
      reportMessage('备份检查通过，尚未写入。'); updateImportControls();
    } catch (error) { pendingImport = null; reportMessage(`没有导入：${error.message}`); }
  });
  $('hanaImportAcknowledge').onchange = updateImportControls;
  $('hanaConfirmImport').onclick = async () => {
    if (!pendingImport || !$('hanaImportAcknowledge').checked) return;
    if (busyNote()) { updateImportControls(); return; }
    $('hanaConfirmImport').disabled = true;
    try {
      await refreshNotes();
      if (busyNote()) { updateImportControls(); return; }
      await applyReplacement(pendingImport.data, { agentNotes: pendingImport.agentNotes });
    } catch (error) { reportMessage(`恢复未完成或尚未确认：${error.message}`); updateImportControls(); }
  };

  $('islandBrowseButton').onclick = () => { if (!client.blocked) navigation?.showChoices(); };
  $('returnOwnedIsland').onclick = () => { const index = navigation?.themes.findIndex(theme => theme.id === ownerId()); if (index >= 0) navigation.enter(index); };
  $('createViewedIsland').onclick = () => {
    if (!currentView || currentView.owned || busyNote()) return;
    pauseForDialog();
    const owned = navigation.themes.find(theme => theme.id === ownerId());
    const info = describeData(client.exportData());
    $('newIslandWarning').textContent = `你正在参观「${currentView.name}」。创建它将放弃「${owned?.name || '原来的小岛'}」及其中的 ${info.residents} 位居民、${info.entries} 则生活记录和 ${notes.length} 则 Agent 记录。请谨慎确认。`;
    $('newIslandAcknowledge').checked = false; $('confirmNewIsland').disabled = true; $('newIslandError').textContent = '';
    newIslandDialog.showModal();
  };
  $('newIslandAcknowledge').onchange = event => { $('confirmNewIsland').disabled = !event.target.checked; };
  $('cancelNewIsland').onclick = () => { if (client.blocked) location.reload(); else newIslandDialog.close(); };
  newIslandDialog.addEventListener('close', resumeAfterDialog);
  $('confirmNewIsland').onclick = async () => {
    if (!$('newIslandAcknowledge').checked || !currentView || currentView.owned) return;
    $('confirmNewIsland').disabled = true;
    try {
      await applyReplacement({ [CHOICE_KEY]: currentView.id }, { intent: 'new-island', confirmedAbandon: true });
    } catch (error) {
      $('newIslandError').textContent = `创建尚未确认：${error.message} 可以返回服务器已保存的小岛，或在问题解决后重试。`;
      $('cancelNewIsland').textContent = '重新载入已保存的小岛';
    }
  };

  const flushQuietly = () => { if (!client.blocked) client.flush().catch(() => {}); };
  const onVisibility = () => { reflectVisibility(); if (!canRun()) flushQuietly(); else void refreshNotes(); };
  const offLifecycle = hana.lifecycle.subscribe(snapshot => { hostVisible = snapshot.visible !== false; onVisibility(); });
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', () => { if (!disposed) { game?.suspend(!client.blocked); flushQuietly(); } });
  offStorage = hana.storage.global.onChanged(keys => { if (keys.includes(STATE_KEY)) void refreshNotes(); });
  const gameStorage = Object.freeze({ getItem: key => client.storage.getItem(key), setItem: (key, value) => { if (!replacingGame) client.storage.setItem(key, value); } });
  const bridge = {
    storage: gameStorage, canRun, requestAnalysis,
    requestAnimationFrame: callback => hana.performance.requestAnimationFrame(callback),
    cancelAnimationFrame: handle => hana.performance.cancelAnimationFrame(handle),
    report(error) { if (!client.blocked) client.publish('error', error); },
    setView(view) { currentView = view; updateVisitControls(); if (view.owned) game?.setAgentTasks(notes); },
    bindGame(value, nav) {
      game = value; navigation = nav;
      $('hanaStartup').hidden = true; $('hanaSaveButton').disabled = false; $('islandBrowseButton').disabled = false;
      document.documentElement.dataset.appReady = 'true'; reflectVisibility(); renderNotes();
      void connectSession(); void refreshNotes();
    },
    inspect() { return { ...client.status(), visible: effectiveVisible(), view: currentView, agentId: activeSession?.agentId ?? null, activeTaskCount: notes.filter(note => ACTIVE_NOTE_STATES.has(note.status)).length, noteCount: notes.length, ...describeData(client.exportData()) }; },
    dispose() { disposed = true; offLifecycle(); offStorage(); offSessions(); document.removeEventListener('visibilitychange', onVisibility); client.dispose(); },
  };
  window.manmanIsland = Object.freeze({ inspect: () => bridge.inspect() });
  return bridge;
}
