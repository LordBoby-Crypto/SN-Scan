(() => {
  let stream = null;
  let workerPromise = null;
  let running = false;
  let busy = false;
  let lastCandidate = '';
  let lastSeenAt = 0;

  const $ = (selector, root = document) => root.querySelector(selector);
  const sanitize = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

  function extractSerial(text) {
    const raw = String(text || '').toUpperCase();
    const labelled = raw.match(/(?:S\/?N|SERIAL(?:\s+NUMBER)?)[^A-Z0-9]{0,10}([A-Z0-9]{5,24})/);
    if (labelled) return sanitize(labelled[1]);
    const candidates = (raw.match(/[A-Z0-9]{6,24}/g) || [])
      .map(sanitize)
      .filter((value) => /[A-Z]/.test(value) && /\d/.test(value));
    return candidates.sort((a, b) => b.length - a.length)[0] || '';
  }

  function targetInput() {
    return $('#manualSerial') || $('.serial-field');
  }

  async function getWorker() {
    if (!window.Tesseract) return null;
    if (!workerPromise) {
      workerPromise = window.Tesseract.createWorker('eng').then(async (worker) => {
        await worker.setParameters({
          tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/:.- ',
          tessedit_pageseg_mode: '7',
          preserve_interword_spaces: '1'
        });
        return worker;
      });
    }
    return workerPromise;
  }

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'liveScannerOverlay';
    overlay.innerHTML = `
      <style>
        #liveScannerOverlay{position:fixed;inset:0;z-index:99999;background:#02090b;color:#fff;display:grid;grid-template-rows:auto 1fr auto;font-family:inherit}
        #liveScannerOverlay .ls-head{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#071114;border-bottom:1px solid #183338}
        #liveScannerOverlay .ls-head strong{font-size:1rem}
        #liveScannerOverlay .ls-close{border:0;background:#123036;color:#d8ffff;border-radius:12px;padding:10px 14px;font-weight:750}
        #liveScannerOverlay .ls-stage{position:relative;overflow:hidden;background:#000}
        #liveScannerOverlay video{width:100%;height:100%;object-fit:cover}
        #liveScannerOverlay .ls-mask{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none;background:linear-gradient(rgba(0,0,0,.5),rgba(0,0,0,.08) 35%,rgba(0,0,0,.08) 65%,rgba(0,0,0,.5))}
        #liveScannerOverlay .ls-box{width:min(92vw,820px);height:min(25vh,210px);border:3px solid #2ee7d2;border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.28),0 0 28px rgba(46,231,210,.4);display:flex;align-items:flex-end;justify-content:center}
        #liveScannerOverlay .ls-box span{transform:translateY(34px);font-size:.86rem;color:#d8ffff;background:#071114;padding:7px 10px;border-radius:9px}
        #liveScannerOverlay .ls-foot{padding:14px 16px 18px;background:#071114;border-top:1px solid #183338;display:grid;gap:8px;text-align:center}
        #liveScannerOverlay .ls-status{font-weight:800;color:#2ee7d2}
        #liveScannerOverlay .ls-note{font-size:.84rem;color:#9eb7bc;line-height:1.4}
        #liveScannerOverlay canvas{display:none}
      </style>
      <div class="ls-head"><strong>Live S/N scanner</strong><button class="ls-close" type="button">Cancel</button></div>
      <div class="ls-stage"><video playsinline muted autoplay></video><div class="ls-mask"><div class="ls-box"><span>Place only the S/N line inside this box</span></div></div><canvas></canvas></div>
      <div class="ls-foot"><div class="ls-status">Starting camera...</div><div class="ls-note">Hold steady. The S/N will be entered automatically when detected.</div></div>`;
    document.body.append(overlay);
    return overlay;
  }

  function stopScanner() {
    running = false;
    busy = false;
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    $('#liveScannerOverlay')?.remove();
  }

  function success(serial) {
    const input = targetInput();
    if (input) {
      input.value = serial;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      input.select?.();
    }
    navigator.vibrate?.([80, 40, 80]);
    try {
      const context = new AudioContext();
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.05;
      osc.connect(gain).connect(context.destination);
      osc.start();
      osc.stop(context.currentTime + 0.09);
    } catch {}
    stopScanner();
  }

  async function scanFrame(video, canvas, status) {
    if (!running || busy || video.readyState < 2) return;
    busy = true;
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const cropW = Math.floor(vw * 0.92);
      const cropH = Math.floor(vh * 0.23);
      const sx = Math.floor((vw - cropW) / 2);
      const sy = Math.floor((vh - cropH) / 2);
      canvas.width = Math.min(1100, cropW);
      canvas.height = Math.max(150, Math.floor(canvas.width * cropH / cropW));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'grayscale(1) contrast(1.8)';
      ctx.drawImage(canvas, 0, 0);

      let text = '';
      if ('TextDetector' in window) {
        try {
          const blocks = await new window.TextDetector().detect(canvas);
          text = blocks.map((block) => block.rawValue).join('\n');
        } catch {}
      }
      if (!text) {
        status.textContent = 'Reading S/N...';
        const worker = await getWorker();
        if (worker) {
          const result = await worker.recognize(canvas);
          text = result.data.text;
        }
      }

      const candidate = extractSerial(text);
      if (candidate) {
        const now = Date.now();
        if (candidate === lastCandidate && now - lastSeenAt < 2200) return success(candidate);
        lastCandidate = candidate;
        lastSeenAt = now;
        status.textContent = `Checking ${candidate}...`;
      } else {
        status.textContent = 'Aim at the S/N line';
      }
    } catch (error) {
      console.error('Live scanner error', error);
      status.textContent = 'Keep the S/N line centered';
    } finally {
      busy = false;
    }
  }

  async function startScanner() {
    if (running) return;
    const overlay = buildOverlay();
    const video = $('video', overlay);
    const canvas = $('canvas', overlay);
    const status = $('.ls-status', overlay);
    $('.ls-close', overlay).onclick = stopScanner;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      running = true;
      status.textContent = 'Aim at the S/N line';
      getWorker().catch(() => {});
      const loop = async () => {
        if (!running) return;
        await scanFrame(video, canvas, status);
        setTimeout(loop, 120);
      };
      loop();
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
