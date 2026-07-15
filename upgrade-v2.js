import { extractSerialCandidates, sanitizeSerial } from './serial-parser.js';

const STORAGE_KEY = 'sn-scan-data-v1';
const state = { view: 'schools', selectedSchoolId: null, batch: null, ocrWorker: null, ocrLoading: false, ocrProgressHandler: null, historyQuery: '' };
const dom = { main: document.querySelector('#mainContent'), back: document.querySelector('#backButton'), headerAction: document.querySelector('#headerAction'), bottomNav: document.querySelector('#bottomNav'), modalRoot: document.querySelector('#modalRoot'), toast: document.querySelector('#toast') };
let data = loadData();
injectUpgradeStyles();

function load