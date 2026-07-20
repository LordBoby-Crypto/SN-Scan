(() => {
  let stream = null;
  let workerPromise = null;
  let running = false;
  let busy = false;
  let lastText = '';

  const $ = (selector, root = document) => root.querySelector(selector);
  const sanitize = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

  function extractSerial(text) {
    const raw = String(text || '').toUpperCase().replace(/[|]/g, 'I');
    const labelled = raw.match(/(?:S\s*\/?\s*N|SERIAL(?:\s+NUMBER)?)\s*[:#-]?\s*([A-Z0-9][A-Z0-9\s-]{4,23})/);
    if (labelled) {
      const value = sanitize(labelled[1]);
      if (value.length >= 6) return value;
    }
    const tokens = (raw.match(/[A-Z0-9][A-Z0-9\s-]{5,23}/g) || [])
      .map(sanitize)
      .filter((value) => value.length >= 6 && value.length <= 16 && /[A-Z]/.test(value) && /\d/.test(value));
    return tokens.sort((a, b) => {
      const aScore = (a.length >= 7 && a.length <= 10 ? 5 : 0) + (/^[A-Z0-9]+$/.test(a) ? 2 : 0);
      const bScore = (b.length >= 7 && b.length <= 10 ? 5 : 0) + (/^[A-Z0-9]+$/.test(b) ? 2 : 0);
      return bScore - aScore || a.length - b.length;
    })[0] || '';
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
          tessedit_pageseg_mode: '6',
          preserve_interword_spaces: '1',
          user_defined_dpi: '300'
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
        #liveScannerOverlay .ls-close{border:0;background:#123036;color:#d8ffff;border-radius:12px;padding:10px 14px;font-weight:750}
        #liveScannerOverlay .ls-stage{position:relative;overflow:hidden;background:#000}
        #liveScannerOverlay video{width:100%;height:100%;object-fit:cover}
        #liveScannerOverlay .ls-mask{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
        #liveScannerOverlay .ls-box{width:min(94vw,900px);height:min(34vh,300px);border:3px solid #2ee7d2;border-radius:18px;box-shadow:0 0 0 9999px rgba(0,0,0,.22),0 0 28px rgba(46,231,210,.4);display:flex;align-items:flex-end;justify-content:center}
        #liveScannerOverlay .ls-box span{transform:translateY(34px);font-size:.86rem;color:#d8ffff;background:#071114;padding:7px 10px;border-radius:9px}
        #liveScannerOverlay .ls-foot{padding:14px 16px 18px;background:#071114;border-top:1px solid #183338;display:grid;gap:8px;text-align:center}
        #liveScannerOverlay .ls-status{font-weight:800;color:#2ee7d2}
        #liveScannerOverlay .ls-note{font-size:.84rem;color:#9eb7bc;line-height:1.4}
        #liveScannerOverlay canvas{display:none}
      </style>
      <div class="ls-head"><strong>Live S/N scanner</strong><button class="ls-close" type="button">Cancel</button></div>
      <div class="ls-stage"><video playsinline muted autoplay></video><div class="ls-mask"><div class="ls-box"><span>Place the S/N text anywhere inside this box</span></div></div><canvas></canvas></div>
      <div class="ls-foot"><div class="ls-status">Starting camera...</div><div class="ls-note">Hold the phone steady for a moment. Alt + V screens and sticker labels are supported.</div></div>`;
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

  function preprocess(video, canvas, mode) {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const cropW = Math.floor(vw * 0.96);
    const cropH = Math.floor(vh * 0.38);
    const sx = Math.floor((vw - cropW) / 2);
    const sy = Math.floor((vh - cropH) / 2);
    const scale = 1.6;
    canvas.width = Math.min(1800, Math.floor(cropW * scale));
    canvas.height = Math.max(320, Math.floor(cropH * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.filter = mode === 0 ? 'grayscale(1) contrast(2.3)' : 'grayscale(1) contrast(3) brightness(1.15)';
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    if (mode === 1) {
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = image.data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i];
      const threshold = Math.max(90, Math.min(190, sum / (d.length / 4) * 0.92));
      for (let i = 0; i < d.length; i += 4) {
        const v = d[i] > threshold ? 255 : 0;
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(image, 0, 0);
    }
  }

  async function recognizeCanvas(canvas, worker) {
    const result = await worker.recognize(canvas);
    return result.data.text || '';
  }

  async function scanFrame(video, canvas, status) {
    if (!running || busy || video.readyState < 2) return;
    busy = true;
    try {
      const worker = await getWorker();
      if (!worker) throw new Error('OCR unavailable');
      let combined = '';
      for (let mode = 0; mode < 2; mode++) {
        preprocess(video, canvas, mode);
        combined += '\n' + await recognizeCanvas(canvas, worker);
        const candidate = extractSerial(combined);
        if (candidate) {
          status.textContent = `Found ${candidate}`;
          return success(candidate);
        }
      }
      lastText = combined.replace(/\s+/g, ' ').trim().slice(0, 60);
      status.textContent = lastText ? `Seeing: ${lastText}` : 'Could not read that frame - hold steady';
    } catch (error) {
      console.error('Live scanner error', error);
      status.textContent = 'Could not read that frame - hold steady';
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
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 }
        },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0];
      const caps = track.getCapabilities?.();
      if (caps?.focusMode?.includes('continuous')) {
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
      }
      running = true;
      status.textContent = 'Loading text reader...';
      await getWorker();
      status.textContent = 'Aim at the S/N text and hold steady';
      const loop = async () => {
        if (!running) return;
        await scanFrame(video, canvas, status);
        setTimeout(loop, 80);
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