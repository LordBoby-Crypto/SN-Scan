(() => {
  if (!window.Tesseract?.createWorker) return;

  const originalCreateWorker = window.Tesseract.createWorker.bind(window.Tesseract);

  window.Tesseract.createWorker = async (...args) => {
    const optionsIndex = 2;
    const originalOptions = args[optionsIndex] || {};
    const userLogger = originalOptions.logger;
    let currentPass = 0;
    let totalPasses = 1;

    args[optionsIndex] = {
      ...originalOptions,
      logger(message) {
        if (typeof message.progress === 'number' && totalPasses > 1) {
          userLogger?.({
            ...message,
            progress: Math.min(1, (currentPass + message.progress) / totalPasses),
          });
        } else {
          userLogger?.(message);
        }
      },
    };

    const worker = await originalCreateWorker(...args);
    const originalRecognize = worker.recognize.bind(worker);
    const originalSetParameters = worker.setParameters.bind(worker);

    worker.recognize = async (source, options, output) => {
      const variants = await createVariants(source);
      totalPasses = variants.length;
      const texts = [];
      let primaryResult = null;

      try {
        for (currentPass = 0; currentPass < variants.length; currentPass += 1) {
          const variant = variants[currentPass];
          await originalSetParameters({ tessedit_pageseg_mode: variant.psm });
          const result = await originalRecognize(variant.blob, options, output);
          primaryResult ||= result;
          texts.push(result?.data?.text || '');
        }
      } finally {
        currentPass = 0;
        totalPasses = 1;
      }

      if (primaryResult?.data) primaryResult.data.text = texts.join('\n');
      return primaryResult;
    };

    return worker;
  };

  async function createVariants(source) {
    const image = await loadImage(source);
    try {
      const [contrastBand, thresholdBand] = await Promise.all([
        renderVariant(image, 'contrast'),
        renderVariant(image, 'threshold'),
      ]);
      return [
        { blob: source, psm: '11' },
        { blob: contrastBand, psm: '6' },
        { blob: thresholdBand, psm: '6' },
      ];
    } finally {
      image.cleanup();
    }
  }

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = typeof source === 'string' ? source : URL.createObjectURL(source);
      image.onload = () => {
        image.cleanup = () => {
          if (typeof source !== 'string') URL.revokeObjectURL(url);
        };
        resolve(image);
      };
      image.onerror = () => {
        if (typeof source !== 'string') URL.revokeObjectURL(url);
        reject(new Error('OCR image could not be loaded'));
      };
      image.src = url;
    });
  }

  function renderVariant(image, mode) {
    const left = .02;
    const right = .98;
    const top = .34;
    const bottom = .69;
    const sourceWidth = Math.max(1, Math.round(image.naturalWidth * (right - left)));
    const sourceHeight = Math.max(1, Math.round(image.naturalHeight * (bottom - top)));
    const scale = Math.min(3, 2400 / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      Math.round(image.naturalWidth * left),
      Math.round(image.naturalHeight * top),
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );

    const pixels = context.getImageData(0, 0, width, height);
    const values = pixels.data;
    for (let index = 0; index < values.length; index += 4) {
      const gray = values[index] * .299 + values[index + 1] * .587 + values[index + 2] * .114;
      let value = Math.max(0, Math.min(255, (gray - 128) * 1.85 + 128));
      if (mode === 'threshold') value = value > 145 ? 255 : 0;
      values[index] = values[index + 1] = values[index + 2] = value;
    }
    context.putImageData(pixels, 0, 0);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('OCR preprocessing failed')),
        mode === 'threshold' ? 'image/png' : 'image/jpeg',
        .94,
      );
    });
  }
})();
