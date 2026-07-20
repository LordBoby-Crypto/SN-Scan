(() => {
  let stream = null;
  let running = false;
  let detector = null;
  let lastValue = '';
  let lastSeenAt = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const sanitize = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

  function extractSerial(raw) {
    const text = String(raw || '').toUpperCase();
    const labelled = text.match(/(?:S\/?N|SERIAL(?:\s+NUMBER)?)[