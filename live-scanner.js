(() => {
  const ADDRESS_KEY = 'sn-scan-companion-ws';
  let stream = null;
  let socket = null;
  let running = false;
  let waiting = false;
  let timer = null;

  const $ = (selector, root = document) => root.querySelector(selector);
  const targetInput = () => $('#manualSerial') || $('.serial-field');

  function normalizeAddress(value) {
    let address = String(value || '').trim();
    if (!address) return '';
    if (!/^wss?:\/\//i.test(address)) address = `wss://${address}`;
    if (!/\/ws\/?$/i.test(address)) address = address.replace(/\/$/, '') + '/ws';
    return address;
  }

  function askForAddress(force = false) {
    const saved = localStorage.getItem(ADDRESS_KEY) || '';
    if (saved && !force) return saved;
    const entered = prompt(
      'Enter the SN-Scan Companion address shown on your Windows laptop.\n\nExample: wss://192.168.1.25:8765/ws',
      saved || 'wss://'
    );
    const normalized = normalizeAddress(entered);
    if (normalized) localStorage.setItem(ADDRESS_KEY, normalized);
    return normalized;
  }

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'liveScannerOverlay';
    overlay.innerHTML = `
      <style>
        #liveScannerOverlay{position:fixed;inset:0;z-index:99999;background:#02090b;color:#fff;display:grid;grid-template-rows:auto 1fr auto;font-family:inherit}
        #liveScannerOverlay .ls-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#071114;border-bottom:1px solid #183338;gap:10px}
        #liveScannerOverlay .ls-actions{display:flex;gap:8px}
        #liveScannerOverlay button{border:0;background:#123036;color:#d8ffff;border-radius:12px;padding:10px 14px;font-weight:750}
        #liveScannerOverlay .ls-stage{position:relative;overflow:hidden;background:#000}
        #liveScannerOverlay video{width:100%;height:100%;object-fit:cover}
        #liveScannerOverlay .ls-mask{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
        #liveScannerOverlay .ls-box{width:min(94vw,900px);height:min(30vh,270px);border:3px solid #2ee7d2;border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.22),0 0 28px rgba(46,231,210,.4);display:flex;align-items:flex-end;justify-content:center}
        #liveScannerOverlay .ls-box span{transform:translateY(34px);font-size:.86rem;color:#d8ffff;background:#071114;padding:7px 10px;border-radius:9px}
        #liveScannerOverlay .ls-foot{padding:14px 16px 18px;background:#071114;border-top:1px solid #183338;display:grid;gap:8px;text-align:center}
        #liveScannerOverlay .ls-status{font-weight:800;color:#2ee7d2}
        #liveScannerOverlay .ls-note{font-size:.84rem;color:#9eb7bc;line-height:1.4}
        #liveScannerOverlay canvas{display:none}
      </style>
      <div class="ls-head"><strong>Windows-powered S/N scanner</strong><div class="ls-actions"><button class="ls-address" type="button">Address</button><button class="ls-close" type="button">Cancel</button></div></div>
      <div class="ls-stage"><video playsinline muted autoplay></video><div class="ls-mask"><div class="ls-box"><span>Place the S/N text anywhere inside this box</span></div></div><canvas></canvas></div>
      <div class="ls-foot"><div class="ls-status">Connecting to laptop...</div><div class="ls-note">The laptop reads the text and sends only the serial number back.</div></div>`;
    document.body.append(overlay);
    return overlay;
  }

  function stopScanner() {
    running = false;
    waiting = false;
    clearTimeout(timer);
    timer = null;
    if (socket) {
      try { socket.close(); } catch {}
      socket = null;
    }
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    $('#liveScannerOverlay')?.remove();
  }

  function success(serial) {
    const value = String(serial || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
    if (value.length < 5) return;
    const input = targetInput();
    if (input) {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
    navigator.vibrate?.([80, 40, 80]);
    try {
      const context = new AudioContext();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.frequency.value = 920;
      gain.gain.value = 0.06;
      osc.connect(gain).connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.1);
    } catch {}
    stopScanner();
  }

  function captureFrame(video, canvas) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropW = Math.floor(vw * 0.94);
    const cropH = Math.floor(vh * 0.34);
    const sx = Math.floor((vw - cropW) / 2);
    const sy = Math.floor((vh - cropH) / 2);
    const targetW = Math.min(1280, cropW);
    canvas.width = targetW;
    canvas.height = Math.max(260, Math.floor(targetW * cropH / cropW));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.78);
  }

  function scheduleFrame(video, canvas, status) {
    clearTimeout(timer);
    timer = setTimeout(() => sendFrame(video, canvas, status), 120);
  }

  function sendFrame(video, canvas, status) {
    if (!running || waiting || !socket || socket.readyState !== WebSocket.OPEN || video.readyState < 2) {
      if (running) scheduleFrame(video, canvas, status);
      return;
    }
    waiting = true;
    status.textContent = 'Reading on Windows...';
    try {
      socket.send(JSON.stringify({ type: 'frame', image: captureFrame(video, canvas) }));
    } catch {
      waiting = false;
      status.textContent = 'Could not send frame to laptop';
      scheduleFrame(video, canvas, status);
    }
  }

  async function startScanner() {
    if (running) return;
    const address = askForAddress();
    if (!address) return;

    const overlay = buildOverlay();
    const video = $('video', overlay);
    const canvas = $('canvas', overlay);
    const status = $('.ls-status', overlay);
    $('.ls-close', overlay).onclick = stopScanner;
    $('.ls-address', overlay).onclick = () => {
      stopScanner();
      localStorage.removeItem(ADDRESS_KEY);
      setTimeout(startScanner, 50);
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      running = true;

      socket = new WebSocket(address);
      socket.onopen = () => {
        status.textContent = 'Connected — aim at the S/N text';
        scheduleFrame(video, canvas, status);
      };
      socket.onmessage = (event) => {
        waiting = false;
        let payload;
        try { payload = JSON.parse(event.data); } catch { payload = {}; }
        if (payload.type !== 'result') return scheduleFrame(video, canvas, status);
        if (payload.serial) {
          status.textContent = `Found ${payload.serial}`;
          return success(payload.serial);
        }
        const seen = Array.isArray(payload.seen) ? payload.seen.join(' | ').slice(0, 85) : '';
        status.textContent = seen ? `Laptop sees: ${seen}` : 'No serial yet — keep text inside the box';
        scheduleFrame(video, canvas, status);
      };
      socket.onerror = () => {
        waiting = false;
        status.textContent = 'Cannot connect. Check the laptop address and certificate.';
      };
      socket.onclose = () => {
        waiting = false;
        if (running) status.textContent = 'Laptop connection closed';
      };
    } catch (error) {
      console.error(error);
      status.textContent = 'Camera permission is required';
    }
  }

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('#takeSerialPhoto, .camera-button');
    if (!trigger) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startScanner();
  }, true);
})();
