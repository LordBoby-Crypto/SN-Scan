(() => {
  const STORAGE_KEY = 'sn-scan-data-v1';
  let bypassOriginal = false;
  let flow = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const main = () => $('#mainContent');
  const toast = (message) => {
    const el = $('#toast');
    if (!el) return alert(message);
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
  };
  const esc = (value) => String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const sanitize = (value) => String(value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

  function readData() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.schools)) return parsed;
    } catch {}
    return { schools: [], version: 2 };
  }

  function writeData(data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function currentSchool() {
    const heading = $('.school-header h1') || $('.page h1');
    const name = heading?.textContent?.trim();
    if (!name || ['Schools', 'History', 'Settings'].includes(name)) return null;
    const data = readData();
    return data.schools.find((school) => school.name === name) || null;
  }

  function setShell(backVisible) {
    $('#bottomNav')?.classList.add('hidden');
    $('#headerAction')?.classList.add('hidden');
    const back = $('#backButton');
    if (back) back.classList.toggle('hidden', !backVisible);
  }

  function restoreApp() {
    location.reload();
  }

  function openModePicker() {
    const school = currentSchool();
    if (!school) return;
    flow = {
      schoolId: school.id,
      schoolName: school.name,
      room: '',
      mode: 'paired',
      phase: 'old',
      pendingOld: '',
      oldSerials: [],
      newSerials: [],
      pairs: []
    };
    setShell(true);
    main().innerHTML = `
      <section class="page form-page">
        <div class="scan-heading">
          <p class="step-label">Room setup</p>
          <h1>Add one or multiple devices</h1>
          <p>Choose the order that matches how you are working in ${esc(school.name)}.</p>
        </div>
        <form id="multiModeForm" class="form-card">
          <div class="field">
            <label for="multiRoom">Room number</label>
            <input id="multiRoom" class="text-input" type="text" autocapitalize="characters" spellcheck="false" placeholder="B103" maxlength="20" required />
          </div>
          <fieldset class="mode-picker" style="border:0;padding:0;margin:0;display:grid;gap:12px">
            <legend style="font-size:.8rem;color:#c6d3d7;font-weight:720;margin-bottom:8px">Choose your scanning order</legend>
            ${modeOption('paired', 'Scan each pair together', 'Old S/N, then matching new S/N. Repeat for each device.', true)}
            ${modeOption('new-first', 'Stage new devices first', 'Scan all new S/Ns first, then scan all old S/Ns. They pair in order.')}
            ${modeOption('old-first', 'Stage old devices first', 'Scan all old S/Ns first, then scan all new S/Ns. They pair in order.')}
          </fieldset>
          <button class="primary-button full-width" type="submit">Start scanning</button>
        </form>
      </section>`;
    $('#multiRoom')?.focus();
    $('#multiModeForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const room = $('#multiRoom').value.trim().toUpperCase();
      if (!room) return;
      flow.room = room;
      flow.mode = new FormData(event.currentTarget).get('mode');
      if (flow.mode === 'paired') {
        bypassOriginal = true;
        restoreOriginalAndStart(room);
        return;
      }
      flow.phase = flow.mode === 'new-first' ? 'new' : 'old';
      renderStagedScan();
    });
  }

  function modeOption(value, title, help, checked = false) {
    return `<label style="display:grid;grid-template-columns:24px 1fr;gap:12px;align-items:start;padding:15px;border:1px solid var(--line);border-radius:15px;background:var(--surface)">
      <input type="radio" name="mode" value="${value}" ${checked ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)" />
      <span style="display:grid;gap:5px"><strong>${title}</strong><small style="color:var(--muted);line-height:1.4">${help}</small></span>
    </label>`;
  }

  function restoreOriginalAndStart(room) {
    sessionStorage.setItem('sn-scan-prefill-room', room);
    location.reload();
  }

  function queueForPhase() {
    return flow.phase === 'old' ? flow.oldSerials : flow.newSerials;
  }

  function renderStagedScan() {
    setShell(true);
    const isOld = flow.phase === 'old';
    const queue = queueForPhase();
    const firstPhase = flow.mode === 'old-first' ? 'old' : 'new';
    const isFirst = flow.phase === firstPhase;
    const counterpart = isOld ? flow.newSerials : flow.oldSerials;
    main().innerHTML = `
      <section class="page form-page">
        <div class="scan-heading">
          <p class="step-label">Room ${esc(flow.room)}</p>
          <h1>Scan ${isOld ? 'old' : 'new'} device S/Ns</h1>
          <p>${isFirst ? `Add every ${isOld ? 'old' : 'new'} serial number, then continue to the other group.` : `Item ${queue.length + 1} will pair with ${esc(counterpart[queue.length] || 'the matching device')}.`}</p>
        </div>
        <div class="form-card" style="display:grid;gap:14px">
          <div style="display:flex;justify-content:space-between;align-items:center"><strong>${isOld ? 'Old' : 'New'} S/N queue</strong><span style="color:var(--accent);font-weight:800">${queue.length}</span></div>
          ${queue.length ? `<ol style="margin:0;padding-left:22px;display:grid;gap:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${queue.map((serial) => `<li>${esc(serial)}</li>`).join('')}</ol>` : '<p style="margin:0;color:var(--muted)">No serial numbers added yet.</p>'}
          <button id="takeSerialPhoto" class="primary-button full-width" type="button">Take S/N photo</button>
          <input id="serialPhotoInput" class="hidden" type="file" accept="image/*" capture="environment" />
          <div class="field">
            <label for="manualSerial">Detected or manually entered S/N</label>
            <input id="manualSerial" class="text-input" type="text" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="Serial number" />
          </div>
          <button id="addSerial" class="secondary-button full-width" type="button">Add ${isOld ? 'old' : 'new'} S/N</button>
          <button id="undoSerial" class="text-button" type="button" ${queue.length ? '' : 'disabled'}>Undo last</button>
          <button id="finishPhase" class="primary-button full-width" type="button" ${queue.length ? '' : 'disabled'}>${isFirst ? `Done scanning ${isOld ? 'old' : 'new'} devices` : 'Review automatic pairs'}</button>
        </div>
      </section>`;

    $('#takeSerialPhoto').onclick = () => $('#serialPhotoInput').click();
    $('#serialPhotoInput').onchange = async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      $('#takeSerialPhoto').textContent = 'Reading S/N...';
      try {
        const serial = await recognize(file);
        $('#manualSerial').value = serial;
        if (!serial) toast('No clear S/N found. Type it manually.');
      } catch {
        toast('Could not read the photo. Type the S/N manually.');
      } finally {
        $('#takeSerialPhoto').textContent = 'Take S/N photo';
      }
    };
    $('#addSerial').onclick = addSerial;
    $('#undoSerial').onclick = () => { queue.pop(); renderStagedScan(); };
    $('#finishPhase').onclick = finishPhase;
  }

  async function recognize(file) {
    if (!window.Tesseract) return '';
    const worker = await window.Tesseract.createWorker('eng');
    try {
      await worker.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:.- ' });
      const result = await worker.recognize(file);
      return extractSerial(result.data.text);
    } finally {
      await worker.terminate();
    }
  }

  function extractSerial(text) {
    const lines = String(text || '').toUpperCase().split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const labelled = line.match(/(?:S\/?N|SERIAL(?:\s+NUMBER)?)[^A-Z0-9]{0,8}([A-Z0-9]{5,24})/);
      if (labelled) return sanitize(labelled[1]);
    }
    const candidates = (String(text || '').toUpperCase().match(/[A-Z0-9]{6,24}/g) || [])
      .map(sanitize).filter((value) => /[A-Z]/.test(value) && /\d/.test(value));
    return candidates.sort((a, b) => b.length - a.length)[0] || '';
  }

  function addSerial() {
    const input = $('#manualSerial');
    const serial = sanitize(input.value);
    if (serial.length < 5) return toast('Check the serial number before adding it.');
    const data = readData();
    const duplicate = data.schools.flatMap((s) => (s.records || []).map((r) => ({ ...r, schoolName: s.name })))
      .find((r) => r.oldSerial === serial || r.newSerial === serial);
    if (duplicate && !confirm(`${serial} already exists in ${duplicate.schoolName}, Room ${duplicate.room}. Add it anyway?`)) return;
    const queue = queueForPhase();
    if (queue.includes(serial)) return toast('That S/N is already in this room queue.');
    queue.push(serial);
    renderStagedScan();
  }

  function finishPhase() {
    const firstPhase = flow.mode === 'old-first' ? 'old' : 'new';
    if (flow.phase === firstPhase) {
      flow.phase = flow.phase === 'old' ? 'new' : 'old';
      renderStagedScan();
      return;
    }
    if (flow.oldSerials.length !== flow.newSerials.length) {
      return toast(`Counts do not match: ${flow.oldSerials.length} old and ${flow.newSerials.length} new.`);
    }
    flow.pairs = flow.oldSerials.map((oldSerial, index) => ({ oldSerial, newSerial: flow.newSerials[index] }));
    renderReview();
  }

  function renderReview() {
    setShell(true);
    main().innerHTML = `
      <section class="page form-page">
        <div class="scan-heading"><p class="step-label">Review room batch</p><h1>${flow.pairs.length} ${flow.pairs.length === 1 ? 'device' : 'devices'} for Room ${esc(flow.room)}</h1><p>Pairs are assigned top-to-bottom.</p></div>
        <div style="display:grid;gap:10px;margin:20px 0">${flow.pairs.map((pair, index) => `
          <div style="display:grid;grid-template-columns:28px 1fr 24px 1fr;gap:9px;align-items:center;padding:13px;border:1px solid var(--line);border-radius:15px;background:var(--surface)">
            <span style="font-weight:800;color:var(--accent)">${index + 1}</span>
            <div><small style="color:var(--muted)">Old S/N</small><strong style="display:block;overflow-wrap:anywhere">${esc(pair.oldSerial)}</strong></div>
            <span>→</span>
            <div><small style="color:var(--muted)">New S/N</small><strong style="display:block;overflow-wrap:anywhere">${esc(pair.newSerial)}</strong></div>
          </div>`).join('')}</div>
        <button id="saveStagedPairs" class="primary-button full-width" type="button">Save all ${flow.pairs.length}</button>
        <button id="backToScanning" class="text-button full-width" type="button">Back to scanning</button>
      </section>`;
    $('#saveStagedPairs').onclick = savePairs;
    $('#backToScanning').onclick = () => { flow.phase = flow.mode === 'old-first' ? 'new' : 'old'; renderStagedScan(); };
  }

  function savePairs() {
    const data = readData();
    const school = data.schools.find((item) => item.id === flow.schoolId);
    if (!school) return toast('School could not be found.');
    school.records ||= [];
    const now = Date.now();
    flow.pairs.forEach((pair, index) => school.records.push({
      id: uid(), room: flow.room, oldSerial: pair.oldSerial, newSerial: pair.newSerial,
      createdAt: new Date(now + index).toISOString()
    }));
    writeData(data);
    alert(`Saved ${flow.pairs.length} device${flow.pairs.length === 1 ? '' : 's'} for Room ${flow.room}.`);
    restoreApp();
  }

  document.addEventListener('click', (event) => {
    if (bypassOriginal) return;
    const trigger = event.target.closest('[data-action="start-scan"], [data-action="start-batch"], #headerAction[data-action="add-record"]');
    if (!trigger || !currentSchool()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openModePicker();
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    const room = sessionStorage.getItem('sn-scan-prefill-room');
    if (!room) return;
    sessionStorage.removeItem('sn-scan-prefill-room');
    const timer = setInterval(() => {
      const field = $('#roomField');
      if (!field) return;
      clearInterval(timer);
      field.value = room;
    }, 50);
    setTimeout(() => clearInterval(timer), 3000);
  });
})();