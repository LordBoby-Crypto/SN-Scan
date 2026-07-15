import { extractSerialCandidates, sanitizeSerial } from './serial-parser.js';

const STORAGE_KEY = 'sn-scan-data-v1';
const state = {
  view: 'schools',
  selectedSchoolId: null,
  scan: null,
  ocrWorker: null,
  ocrLoading: false,
  ocrProgressHandler: null,
  historyQuery: '',
};

const dom = {
  main: document.querySelector('#mainContent'),
  back: document.querySelector('#backButton'),
  headerAction: document.querySelector('#headerAction'),
  bottomNav: document.querySelector('#bottomNav'),
  modalRoot: document.querySelector('#modalRoot'),
  toast: document.querySelector('#toast'),
};

let data = loadData();

function loadData() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (stored && Array.isArray(stored.schools)) return stored;
  } catch {}
  return { schools: [], version: 1 };
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.classList.remove('show'), 2400);
}

function setChrome({ back = false, action = 'add-school', nav = true } = {}) {
  dom.back.classList.toggle('hidden', !back);
  dom.bottomNav.classList.toggle('hidden', !nav);
  dom.headerAction.classList.toggle('hidden', !action);
  dom.headerAction.dataset.action = action || '';
  dom.headerAction.setAttribute('aria-label', action === 'add-record' ? 'Add scan record' : 'Add school');
  dom.headerAction.innerHTML = action ? '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>' : '';
}

function setActiveNav(view) {
  dom.bottomNav.querySelectorAll('[data-nav]').forEach((button) => {
    button.classList.toggle('active', button.dataset.nav === view);
  });
}

function selectedSchool() {
  return data.schools.find((school) => school.id === state.selectedSchoolId) || null;
}

function allRecords() {
  return data.schools.flatMap((school) =>
    (school.records || []).map((record) => ({ ...record, schoolId: school.id, schoolName: school.name }))
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function render() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  switch (state.view) {
    case 'school': return renderSchool();
    case 'room': return renderRoomStep();
    case 'old-scan': return renderScanStep('old');
    case 'new-scan': return renderScanStep('new');
    case 'review': return renderReview();
    case 'success': return renderSuccess();
    case 'history': return renderHistory();
    case 'settings': return renderSettings();
    default: return renderSchools();
  }
}

function renderSchools() {
  state.view = 'schools';
  setChrome({ back: false, action: 'add-school', nav: true });
  setActiveNav('schools');
  const fragment = document.querySelector('#schoolListTemplate').content.cloneNode(true);
  const list = fragment.querySelector('#schoolList');

  if (!data.schools.length) {
    list.append(document.querySelector('#emptySchoolsTemplate').content.cloneNode(true));
  } else {
    [...data.schools].sort((a, b) => a.name.localeCompare(b.name)).forEach((school) => {
      const row = document.querySelector('#schoolRowTemplate').content.cloneNode(true).querySelector('.school-row');
      const records = school.records || [];
      const roomCount = new Set(records.map((record) => record.room)).size;
      row.querySelector('strong').textContent = school.name;
      row.querySelector('small').textContent = `${roomCount} ${roomCount === 1 ? 'room' : 'rooms'} - ${records.length} ${records.length === 1 ? 'scan' : 'scans'}`;
      row.addEventListener('click', () => {
        state.selectedSchoolId = school.id;
        state.view = 'school';
        render();
      });
      list.append(row);
    });
  }

  dom.main.replaceChildren(fragment);
}

function renderSchool() {
  const school = selectedSchool();
  if (!school) return renderSchools();
  setChrome({ back: true, action: 'add-record', nav: true });
  setActiveNav('schools');
  const records = [...(school.records || [])].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const rooms = new Set(records.map((record) => record.room));
  dom.main.innerHTML = `
    <section class="page">
      <div class="school-header">
        <div><h1>${esc(school.name)}</h1><p>Scan and track device replacements by room.</p></div>
      </div>
      <div class="stats-strip">
        <div class="stat"><strong>${records.length}</strong><span>Total scans</span></div>
        <div class="stat"><strong>${rooms.size}</strong><span>Rooms</span></div>
        <div class="stat"><strong>${records.filter((r) => isToday(r.createdAt)).length}</strong><span>Today</span></div>
      </div>
      <button class="primary-button full-width" data-action="start-scan" type="button">Scan a replacement</button>
      <div class="section-title"><h2>Recent records</h2>${records.length ? '<button data-action="export-school" type="button">Export CSV</button>' : ''}</div>
      <div class="record-list">${records.length ? records.map(recordCard).join('') : emptyRecords()}</div>
      <button class="fab" type="button" data-action="start-scan" aria-label="Add scan"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    </section>`;
}

function recordCard(record, includeSchool = false) {
  const schoolLine = includeSchool ? `<span>${esc(record.schoolName)} - </span>` : '';
  return `
    <article class="record-card">
      <div class="record-top">
        <div class="record-room">${schoolLine}Room ${esc(record.room)}</div>
        <time class="record-date">${formatDate(record.createdAt)}</time>
      </div>
      <div class="serial-pair">
        <div class="serial-box"><span>Old S/N</span><strong>${esc(record.oldSerial)}</strong></div>
        <svg class="serial-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12h14M14 7l5 5-5 5"/></svg>
        <div class="serial-box"><span>New S/N</span><strong>${esc(record.newSerial)}</strong></div>
      </div>
    </article>`;
}

function emptyRecords() {
  return `<div class="empty-state" style="min-height:260px;padding-top:18px"><h2>No scans yet</h2><p>Tap the plus button and enter the room number to begin.</p></div>`;
}

function renderRoomStep() {
  const school = selectedSchool();
  if (!school) return renderSchools();
  setChrome({ back: true, action: null, nav: false });
  dom.main.innerHTML = `
    <section class="page form-page">
      <div class="stepper"><span class="active"></span><span></span><span></span><span></span></div>
      <div class="scan-heading"><p class="step-label">Step 1 of 4</p><h1>Enter the room number</h1><p>This record will be saved under ${esc(school.name)}.</p></div>
      <form id="roomForm" class="form-card">
        <div class="field">
          <label for="roomField">Room number</label>
          <input id="roomField" class="text-input" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="B103" maxlength="20" required value="${esc(state.scan?.room || '')}" />
          <p class="field-note">Letters and numbers are allowed, such as B103, 204, or LIBRARY.</p>
        </div>
        <button class="primary-button full-width" type="submit">Continue to old S/N</button>
      </form>
    </section>`;
  const field = dom.main.querySelector('#roomField');
  setTimeout(() => field.focus(), 80);
  dom.main.querySelector('#roomForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const room = field.value.trim().toUpperCase();
    if (!room) return;
    state.scan.room = room;
    state.view = 'old-scan';
    render();
  });
}

function renderScanStep(kind) {
  const isOld = kind === 'old';
  setChrome({ back: true, action: null, nav: false });
  const fragment = document.querySelector('#scanStepTemplate').content.cloneNode(true);
  const page = fragment.querySelector('.scan-page');
  const step = isOld ? 2 : 3;
  page.querySelectorAll('.stepper span').forEach((bar, index) => {
    if (index < step - 1) bar.classList.add('done');
    if (index === step - 1) bar.classList.add('active');
  });
  page.querySelector('.step-label').textContent = `Step ${step} of 4`;
  page.querySelector('h1').textContent = `Scan the ${isOld ? 'old' : 'new'} S/N`;
  page.querySelector('.step-help').textContent = `Take a clear photo of the ${isOld ? 'old device' : 'new device'} label. Only the serial number will be saved.`;
  const input = page.querySelector('.camera-input');
  const cameraButton = page.querySelector('.camera-button');
  const preview = page.querySelector('.camera-preview img');
  const placeholder = page.querySelector('.camera-placeholder');
  const resultPanel = page.querySelector('.serial-result');
  const serialField = page.querySelector('.serial-field');
  const candidateList = page.querySelector('.candidate-list');
  const existing = isOld ? state.scan.oldSerial : state.scan.newSerial;

  cameraButton.addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    preview.src = url;
    preview.classList.remove('hidden');
    placeholder.classList.add('hidden');
    try {
      const candidates = await recognizeSerial(file, page);
      resultPanel.classList.remove('hidden');
      serialField.value = candidates[0]?.value || '';
      renderCandidateChips(candidateList, serialField, candidates.slice(1, 5));
      serialField.focus();
      if (!candidates.length) showToast('No clear S/N found. Enter it manually or retake the photo.');
    } catch (error) {
      console.error(error);
      resultPanel.classList.remove('hidden');
      serialField.value = '';
      showToast('OCR could not finish. Enter the S/N manually or retake the photo.');
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  if (existing) {
    resultPanel.classList.remove('hidden');
    serialField.value = existing;
  }

  page.querySelector('.continue-button').addEventListener('click', () => {
    const serial = sanitizeSerial(serialField.value);
    if (serial.length < 5) {
      showToast('Check the serial number before continuing.');
      serialField.focus();
      return;
    }
    if (isOld) {
      state.scan.oldSerial = serial;
      state.view = 'new-scan';
    } else {
      state.scan.newSerial = serial;
      state.view = 'review';
    }
    render();
  });
  page.querySelector('.retake-button').addEventListener('click', () => {
    input.value = '';
    preview.src = '';
    preview.classList.add('hidden');
    placeholder.classList.remove('hidden');
    resultPanel.classList.add('hidden');
    input.click();
  });

  dom.main.replaceChildren(fragment);
}

function renderCandidateChips(container, input, candidates) {
  container.replaceChildren();
  candidates.forEach((candidate) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'candidate-chip';
    button.textContent = candidate.value;
    button.addEventListener('click', () => {
      input.value = candidate.value;
      input.focus();
    });
    container.append(button);
  });
}

async function getOcrWorker() {
  if (state.ocrWorker) return state.ocrWorker;
  if (!window.Tesseract) throw new Error('OCR library unavailable');
  if (state.ocrLoading) {
    while (state.ocrLoading) await new Promise((resolve) => setTimeout(resolve, 100));
    return state.ocrWorker;
  }
  state.ocrLoading = true;
  try {
    const worker = await window.Tesseract.createWorker('eng', 1, {
      logger: (message) => state.ocrProgressHandler?.(message),
    });
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:.- ',
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
    });
    state.ocrWorker = worker;
    return worker;
  } finally {
    state.ocrLoading = false;
  }
}

async function recognizeSerial(file, page) {
  const panel = page.querySelector('.ocr-panel');
  const percent = page.querySelector('.ocr-percent');
  const progress = page.querySelector('.progress-track span');
  panel.classList.remove('hidden');
  const source = await enhanceImage(file);
  const logger = (message) => {
    if (typeof message.progress === 'number') {
      const value = Math.round(message.progress * 100);
      percent.textContent = `${value}%`;
      progress.style.width = `${value}%`;
    }
  };
  state.ocrProgressHandler = logger;
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(source);
    const candidates = extractSerialCandidates(result.data.text);
    console.info('OCR text:', result.data.text, 'Candidates:', candidates);
    return candidates;
  } finally {
    state.ocrProgressHandler = null;
    panel.classList.add('hidden');
  }
}

function enhanceImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const max = 1800;
      const scale = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(image, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height);
      const d = pixels.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
        const contrast = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
        d[i] = d[i + 1] = d[i + 2] = contrast;
      }
      context.putImageData(pixels, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image processing failed')), 'image/jpeg', .94);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be loaded'));
    };
    image.src = url;
  });
}

function renderReview() {
  const school = selectedSchool();
  setChrome({ back: true, action: null, nav: false });
  dom.main.innerHTML = `
    <section class="page form-page">
      <div class="stepper"><span class="done"></span><span class="done"></span><span class="done"></span><span class="active"></span></div>
      <div class="scan-heading"><p class="step-label">Step 4 of 4</p><h1>Review and save</h1><p>Confirm the room and both serial numbers before saving.</p></div>
      <div class="review-grid">
        <div class="review-row"><span>School</span><strong>${esc(school?.name)}</strong></div>
        <div class="review-row"><span>Room</span><strong>${esc(state.scan.room)}</strong></div>
        <div class="review-row"><span>Old S/N</span><strong>${esc(state.scan.oldSerial)}</strong></div>
        <div class="review-row"><span>New S/N</span><strong>${esc(state.scan.newSerial)}</strong></div>
      </div>
      <div class="review-actions">
        <button class="primary-button" type="button" data-action="save-record">Save record</button>
        <button class="secondary-button" type="button" data-action="edit-old">Edit old S/N</button>
        <button class="secondary-button" type="button" data-action="edit-new">Edit new S/N</button>
      </div>
    </section>`;
}

function saveRecord() {
  const school = selectedSchool();
  if (!school || !state.scan) return;
  school.records ||= [];
  const duplicate = school.records.some((record) => record.newSerial === state.scan.newSerial);
  school.records.push({
    id: uid(),
    room: state.scan.room,
    oldSerial: state.scan.oldSerial,
    newSerial: state.scan.newSerial,
    createdAt: new Date().toISOString(),
  });
  saveData();
  state.view = 'success';
  state.scan.savedDuplicate = duplicate;
  render();
}

function renderSuccess() {
  setChrome({ back: false, action: null, nav: false });
  dom.main.innerHTML = `
    <section class="page form-page" style="text-align:center">
      <div class="success-mark"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 12l4 4L19 6"/></svg></div>
      <h1>Record saved</h1>
      <p style="color:var(--muted);line-height:1.55;margin-bottom:24px">Room ${esc(state.scan.room)} now has the old and new serial numbers recorded.${state.scan.savedDuplicate ? ' The new S/N also appears in another record, so review it when convenient.' : ''}</p>
      <div class="review-actions">
        <button class="primary-button" type="button" data-action="scan-another">Scan another room</button>
        <button class="secondary-button" type="button" data-action="finish-scanning">Return to school</button>
      </div>
    </section>`;
}

function startScan() {
  state.scan = { room: '', oldSerial: '', newSerial: '', savedDuplicate: false };
  state.view = 'room';
  render();
}

function renderHistory() {
  state.view = 'history';
  setChrome({ back: false, action: null, nav: true });
  setActiveNav('history');
  const records = allRecords().filter((record) => {
    const haystack = `${record.schoolName} ${record.room} ${record.oldSerial} ${record.newSerial}`.toLowerCase();
    return haystack.includes(state.historyQuery.toLowerCase());
  });
  dom.main.innerHTML = `
    <section class="page">
      <div class="page-heading"><div><h1>History</h1><p>Search every saved replacement record.</p></div></div>
      <div class="toolbar"><input class="search-input" id="historySearch" type="search" placeholder="School, room, or S/N" value="${esc(state.historyQuery)}" /><button class="filter-button" data-action="export-all" type="button" aria-label="Export all records"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 21h16"/></svg></button></div>
      <div class="record-list">${records.length ? records.map((record) => recordCard(record, true)).join('') : emptyRecords()}</div>
    </section>`;
  const search = dom.main.querySelector('#historySearch');
  search.addEventListener('input', () => {
    state.historyQuery = search.value;
    const position = search.selectionStart;
    renderHistory();
    const next = dom.main.querySelector('#historySearch');
    next.focus();
    next.setSelectionRange(position, position);
  });
}

function renderSettings() {
  state.view = 'settings';
  setChrome({ back: false, action: 'add-school', nav: true });
  setActiveNav('settings');
  dom.main.innerHTML = `
    <section class="page">
      <div class="page-heading"><div><h1>Settings</h1><p>Manage schools and back up your scan data.</p></div></div>
      <div class="settings-list">
        <div class="settings-card"><h2>Schools</h2><p>Delete a school only when its records are no longer needed.</p><div>${data.schools.length ? data.schools.map((school) => `<div class="school-manage-row"><div><strong>${esc(school.name)}</strong><br><small>${school.records?.length || 0} records</small></div><button class="mini-danger" type="button" data-delete-school="${school.id}">Delete</button></div>`).join('') : '<p>No schools created yet.</p>'}</div></div>
        <div class="settings-card"><h2>Backup and export</h2><p>Photos are never stored. Backups include school names, rooms, and serial numbers.</p><div class="settings-actions"><button class="secondary-button" data-action="export-json" type="button">Download JSON backup</button><button class="secondary-button" data-action="import-json" type="button">Import JSON backup</button><input id="backupInput" class="hidden" type="file" accept="application/json,.json" /></div></div>
        <div class="settings-card"><h2>Privacy</h2><p>OCR runs in your browser. The app saves only the text you confirm, and all records stay in this browser unless you export them.</p></div>
      </div>
    </section>`;
}

function isToday(value) {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function formatDate(value) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function openSchoolModal() {
  dom.modalRoot.innerHTML = `
    <div class="modal-backdrop" role="presentation">
      <form class="modal" id="schoolModal" role="dialog" aria-modal="true" aria-labelledby="schoolModalTitle">
        <h2 id="schoolModalTitle">Create a school</h2><p>Add the school name exactly as you want it shown in records and exports.</p>
        <div class="field"><label for="schoolName">School name</label><input id="schoolName" class="text-input" type="text" autocomplete="organization" maxlength="80" required placeholder="Greenville High School" /></div>
        <div class="modal-actions"><button class="secondary-button" type="button" data-action="close-modal">Cancel</button><button class="primary-button" type="submit">Create school</button></div>
      </form>
    </div>`;
  const field = dom.modalRoot.querySelector('#schoolName');
  setTimeout(() => field.focus(), 50);
  dom.modalRoot.querySelector('#schoolModal').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = field.value.trim();
    if (!name) return;
    const existing = data.schools.find((school) => school.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      showToast('That school already exists.');
      return;
    }
    const school = { id: uid(), name, records: [] };
    data.schools.push(school);
    saveData();
    closeModal();
    state.selectedSchoolId = school.id;
    state.view = 'school';
    render();
  });
}

function closeModal() {
  dom.modalRoot.replaceChildren();
}

function exportCsv(records, filename) {
  if (!records.length) return showToast('There are no records to export.');
  const rows = [['School', 'Room', 'Old Serial Number', 'New Serial Number', 'Scanned At'], ...records.map((record) => [record.schoolName, record.room, record.oldSerial, record.newSerial, record.createdAt])];
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), filename);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function exportSchool() {
  const school = selectedSchool();
  if (!school) return;
  const records = (school.records || []).map((record) => ({ ...record, schoolName: school.name }));
  exportCsv(records, `${school.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-sn-scan.csv`);
}

function exportJson() {
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `sn-scan-backup-${new Date().toISOString().slice(0, 10)}.json`);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      if (!imported || !Array.isArray(imported.schools)) throw new Error('Invalid backup');
      data = imported;
      saveData();
      showToast('Backup imported.');
      renderSettings();
    } catch {
      showToast('That file is not a valid SN-Scan backup.');
    }
  };
  reader.readAsText(file);
}

function deleteSchool(id) {
  const school = data.schools.find((item) => item.id === id);
  if (!school) return;
  const recordText = school.records?.length ? ` and its ${school.records.length} records` : '';
  if (!confirm(`Delete ${school.name}${recordText}? This cannot be undone.`)) return;
  data.schools = data.schools.filter((item) => item.id !== id);
  if (state.selectedSchoolId === id) state.selectedSchoolId = null;
  saveData();
  showToast('School deleted.');
  renderSettings();
}

function goBack() {
  switch (state.view) {
    case 'school': state.view = 'schools'; break;
    case 'room': state.view = 'school'; break;
    case 'old-scan': state.view = 'room'; break;
    case 'new-scan': state.view = 'old-scan'; break;
    case 'review': state.view = 'new-scan'; break;
    default: state.view = 'schools';
  }
  render();
}

dom.back.addEventListener('click', goBack);
dom.headerAction.addEventListener('click', () => {
  if (dom.headerAction.dataset.action === 'add-record') startScan();
  else openSchoolModal();
});
dom.bottomNav.addEventListener('click', (event) => {
  const button = event.target.closest('[data-nav]');
  if (!button) return;
  state.view = button.dataset.nav;
  render();
});
dom.modalRoot.addEventListener('click', (event) => {
  if (event.target.matches('.modal-backdrop') || event.target.closest('[data-action="close-modal"]')) closeModal();
});
dom.main.addEventListener('click', (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'create-school') openSchoolModal();
  if (action === 'start-scan') startScan();
  if (action === 'save-record') saveRecord();
  if (action === 'edit-old') { state.view = 'old-scan'; render(); }
  if (action === 'edit-new') { state.view = 'new-scan'; render(); }
  if (action === 'scan-another') startScan();
  if (action === 'finish-scanning') { state.scan = null; state.view = 'school'; render(); }
  if (action === 'export-school') exportSchool();
  if (action === 'export-all') exportCsv(allRecords(), 'sn-scan-all-records.csv');
  if (action === 'export-json') exportJson();
  if (action === 'import-json') dom.main.querySelector('#backupInput')?.click();
  const deleteButton = event.target.closest('[data-delete-school]');
  if (deleteButton) deleteSchool(deleteButton.dataset.deleteSchool);
});
dom.main.addEventListener('change', (event) => {
  if (event.target.id === 'backupInput' && event.target.files?.[0]) importJson(event.target.files[0]);
});

window.addEventListener('beforeunload', () => state.ocrWorker?.terminate?.());
render();
