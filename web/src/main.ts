import { preload, segmentForeground, type Config } from '@imgly/background-removal';
import './styles.css';

type PresetName = 'hq' | 'soft' | 'logo' | 'human' | 'classic' | 'fast';
type ModelName = 'isnet' | 'isnet_fp16' | 'isnet_quint8';

const els = {
  dropzone: byId<HTMLDivElement>('dropzone'),
  fileInput: byId<HTMLInputElement>('fileInput'),
  sourcePreview: byId<HTMLImageElement>('sourcePreview'),
  resultPreview: byId<HTMLImageElement>('resultPreview'),
  sourceEmpty: byId<HTMLSpanElement>('sourceEmpty'),
  resultEmpty: byId<HTMLSpanElement>('resultEmpty'),
  runtimeStatus: byId<HTMLSpanElement>('runtimeStatus'),
  presetSelect: byId<HTMLSelectElement>('presetSelect'),
  alphaMatting: byId<HTMLInputElement>('alphaMatting'),
  postProcessMask: byId<HTMLInputElement>('postProcessMask'),
  edgeAdjust: byId<HTMLInputElement>('edgeAdjust'),
  feather: byId<HTMLInputElement>('feather'),
  previewBg: byId<HTMLInputElement>('previewBg'),
  fgThreshold: byId<HTMLInputElement>('fgThreshold'),
  bgThreshold: byId<HTMLInputElement>('bgThreshold'),
  erodeSize: byId<HTMLInputElement>('erodeSize'),
  hardCutToggle: byId<HTMLInputElement>('hardCutToggle'),
  threshold: byId<HTMLInputElement>('threshold'),
  edgeValue: byId<HTMLOutputElement>('edgeValue'),
  featherValue: byId<HTMLOutputElement>('featherValue'),
  fgValue: byId<HTMLOutputElement>('fgValue'),
  bgValue: byId<HTMLOutputElement>('bgValue'),
  erodeValue: byId<HTMLOutputElement>('erodeValue'),
  thresholdValue: byId<HTMLOutputElement>('thresholdValue'),
  preloadButton: byId<HTMLButtonElement>('preloadButton'),
  runButton: byId<HTMLButtonElement>('runButton'),
  downloadLink: byId<HTMLAnchorElement>('downloadLink'),
  meterBar: byId<HTMLDivElement>('meterBar'),
  logText: byId<HTMLTextAreaElement>('logText')
};

let sourceFile: File | null = null;
let sourceUrl = '';
let resultUrl = '';
let webGpuAvailable = false;

init();

function init() {
  webGpuAvailable = 'gpu' in navigator;
  if (!webGpuAvailable) {
    setLog('이 브라우저에서는 WebGPU를 사용할 수 없어 CPU로 실행합니다.');
  }

  els.fileInput.addEventListener('change', () => {
    const file = els.fileInput.files?.[0];
    if (file) setSourceFile(file);
  });

  els.dropzone.addEventListener('click', () => els.fileInput.click());
  els.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    els.dropzone.classList.add('is-dragging');
  });
  els.dropzone.addEventListener('dragleave', () => {
    els.dropzone.classList.remove('is-dragging');
  });
  els.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    els.dropzone.classList.remove('is-dragging');
    const file = event.dataTransfer?.files?.[0];
    if (file?.type.startsWith('image/')) setSourceFile(file);
  });

  els.presetSelect.addEventListener('change', applyPresetDefaults);
  els.preloadButton.addEventListener('click', () => runPreload());
  els.runButton.addEventListener('click', () => runRemoval());

  for (const input of [
    els.edgeAdjust,
    els.feather,
    els.fgThreshold,
    els.bgThreshold,
    els.erodeSize,
    els.threshold
  ]) {
    input.addEventListener('input', syncControlLabels);
  }

  syncControlLabels();
}

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element: ${id}`);
  return element as T;
}

function applyPresetDefaults() {
  const preset = els.presetSelect.value as PresetName;

  if (preset === 'logo') {
    els.alphaMatting.checked = false;
    els.edgeAdjust.value = '-1';
    els.feather.value = '0';
    els.hardCutToggle.checked = true;
    els.threshold.value = '150';
  } else if (preset === 'soft') {
    els.alphaMatting.checked = true;
    els.edgeAdjust.value = '-1';
    els.feather.value = '0.25';
    els.hardCutToggle.checked = false;
    els.threshold.value = '128';
  } else if (preset === 'fast') {
    els.alphaMatting.checked = false;
    els.edgeAdjust.value = '0';
    els.feather.value = '0';
    els.hardCutToggle.checked = false;
    els.threshold.value = '128';
  } else {
    els.alphaMatting.checked = true;
    els.edgeAdjust.value = '-1';
    els.feather.value = '0';
    els.hardCutToggle.checked = false;
    els.threshold.value = '128';
  }

  syncControlLabels();
}

function setSourceFile(file: File) {
  sourceFile = file;
  revokeUrl(sourceUrl);
  sourceUrl = URL.createObjectURL(file);
  els.sourcePreview.src = sourceUrl;
  els.sourcePreview.classList.add('has-image');
  els.sourceEmpty.hidden = true;
  resetResult();
  setProgress(0);
  setStatus('이미지 준비됨');
  setLog(`불러온 파일: ${file.name}\n크기: ${formatBytes(file.size)}`);
}

async function runPreload() {
  await withBusy('모델 받는 중', async () => {
    await preload(buildConfig());
    setProgress(100);
    setLog('모델 캐시가 완료되었습니다. 다음 실행부터 더 빠르게 시작됩니다.');
  });
}

async function runRemoval() {
  if (!sourceFile) {
    setLog('먼저 이미지를 넣어주세요.');
    return;
  }

  const file = sourceFile;
  await withBusy('작업 중', async () => {
    resetResult();
    const preset = els.presetSelect.value as PresetName;
    const lines = [
      `프리셋: ${presetLabel(preset)}`,
      `모델: ${modelForPreset(preset)}`,
      `알파 매팅: ${els.alphaMatting.checked ? '켜짐' : '꺼짐'}`,
      '실행 중...'
    ];
    if (preset === 'fast') {
      lines.splice(1, 0, '주의: 빠른 미리보기는 품질이 낮습니다. 최종 결과는 HQ를 권장합니다.');
    }
    setLog(lines.join('\n'));

    const maskBlob = await removeMaskWithFallback(file);
    const outputBlob = await composeOutput(file, maskBlob);

    revokeUrl(resultUrl);
    resultUrl = URL.createObjectURL(outputBlob);
    els.resultPreview.src = resultUrl;
    els.resultPreview.classList.add('has-image');
    els.resultEmpty.hidden = true;

    els.downloadLink.href = resultUrl;
    els.downloadLink.classList.remove('disabled');
    els.downloadLink.download = makeDownloadName(file.name);
    setProgress(100);
    setLog(`${lines.join('\n')}\n완료되었습니다. 아래에서 PNG를 다운로드하세요.`);
  });
}

async function removeMaskWithFallback(file: File): Promise<Blob> {
  const config = buildConfig();
  try {
    return await segmentForeground(file, config);
  } catch (error) {
    if (config.device === 'gpu') {
      setLog('WebGPU 실행에 실패했습니다. CPU로 다시 시도합니다...');
      return await segmentForeground(file, { ...config, device: 'cpu' });
    }
    throw error;
  }
}

function buildConfig(): Config {
  return {
    debug: false,
    device: webGpuAvailable ? 'gpu' : 'cpu',
    model: modelForPreset(els.presetSelect.value as PresetName),
    output: {
      format: 'image/png',
      quality: 1
    },
    progress: (key, current, total) => {
      if (total > 0) {
        setProgress(Math.round((current / total) * 100));
        setLog(`${key} 다운로드 중: ${formatBytes(current)} / ${formatBytes(total)}`);
      }
    }
  };
}

function presetLabel(preset: PresetName): string {
  if (preset === 'hq') return 'HQ 일반 / 제품 - 추천';
  if (preset === 'soft') return '부드러운 가장자리 / 머리카락 / 털';
  if (preset === 'logo') return '로고 / 아이콘 선명한 컷';
  if (preset === 'human') return '인물 사진 클래식';
  if (preset === 'classic') return '클래식 U2Net';
  return '빠른 미리보기 전용';
}

function modelForPreset(preset: PresetName): ModelName {
  if (preset === 'fast') return 'isnet_quint8';
  if (preset === 'classic') return 'isnet_quint8';
  if (preset === 'human') return 'isnet_fp16';
  if (preset === 'logo') return 'isnet';
  return 'isnet_fp16';
}

async function composeOutput(imageFile: File, maskBlob: Blob): Promise<Blob> {
  const [sourceImage, maskImage] = await Promise.all([
    loadImage(imageFile),
    loadImage(maskBlob)
  ]);

  const width = sourceImage.naturalWidth;
  const height = sourceImage.naturalHeight;
  const sourceCanvas = makeCanvas(width, height);
  const sourceContext = mustContext(sourceCanvas);
  sourceContext.drawImage(sourceImage, 0, 0, width, height);

  const maskCanvas = makeCanvas(width, height);
  const maskContext = mustContext(maskCanvas);
  maskContext.drawImage(maskImage, 0, 0, width, height);

  const sourceData = sourceContext.getImageData(0, 0, width, height);
  const maskData = maskContext.getImageData(0, 0, width, height);
  let alpha = maskToAlpha(maskData);

  if (els.postProcessMask.checked) {
    alpha = cleanMask(alpha, width, height);
  }

  if (els.hardCutToggle.checked) {
    alpha = hardThreshold(alpha, Number(els.threshold.value));
  }

  const edge = Number(els.edgeAdjust.value);
  if (edge !== 0) {
    alpha = morphAlpha(alpha, width, height, edge);
  }

  const feather = Number(els.feather.value);
  if (feather > 0) {
    alpha = blurAlpha(alpha, width, height, feather);
  }

  if (els.alphaMatting.checked && !els.hardCutToggle.checked) {
    alpha = softenSemiTransparentEdges(alpha);
  }

  applyAlpha(sourceData, alpha);

  const background = normalizeBackground(els.previewBg.value);
  if (background) {
    const outputCanvas = makeCanvas(width, height);
    const outputContext = mustContext(outputCanvas);
    outputContext.fillStyle = background;
    outputContext.fillRect(0, 0, width, height);
    sourceContext.putImageData(sourceData, 0, 0);
    outputContext.drawImage(sourceCanvas, 0, 0);
    return canvasToPng(outputCanvas);
  }

  sourceContext.putImageData(sourceData, 0, 0);
  return canvasToPng(sourceCanvas);
}

function maskToAlpha(maskData: ImageData): Uint8ClampedArray {
  const data = maskData.data;
  const alpha = new Uint8ClampedArray(maskData.width * maskData.height);
  for (let source = 0, target = 0; source < data.length; source += 4, target += 1) {
    alpha[target] = Math.round((data[source] + data[source + 1] + data[source + 2]) / 3);
  }
  return alpha;
}

function cleanMask(
  alpha: Uint8ClampedArray,
  width: number,
  height: number
): Uint8ClampedArray {
  const opened = morphAlpha(morphAlpha(alpha, width, height, -1), width, height, 1);
  const output = new Uint8ClampedArray(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    output[index] = Math.round(alpha[index] * 0.75 + opened[index] * 0.25);
  }
  return output;
}

function softenSemiTransparentEdges(alpha: Uint8ClampedArray): Uint8ClampedArray {
  const output = new Uint8ClampedArray(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    const value = alpha[index];
    output[index] = value > 14 && value < 242 ? Math.round(value * 0.96) : value;
  }
  return output;
}

function hardThreshold(alpha: Uint8ClampedArray, threshold: number): Uint8ClampedArray {
  const output = new Uint8ClampedArray(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    output[index] = alpha[index] >= threshold ? 255 : 0;
  }
  return output;
}

function morphAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number
): Uint8ClampedArray {
  const radius = Math.min(5, Math.abs(Math.trunc(amount)));
  const erode = amount < 0;
  const output = new Uint8ClampedArray(alpha.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let best = erode ? 255 : 0;
      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = clamp(y + dy, 0, height - 1);
        const row = yy * width;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = clamp(x + dx, 0, width - 1);
          const value = alpha[row + xx];
          best = erode ? Math.min(best, value) : Math.max(best, value);
        }
      }
      output[y * width + x] = best;
    }
  }

  return output;
}

function blurAlpha(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius: number
): Uint8ClampedArray {
  const input = makeCanvas(width, height);
  const inputContext = mustContext(input);
  const imageData = inputContext.createImageData(width, height);
  for (let index = 0; index < alpha.length; index += 1) {
    const value = alpha[index];
    const offset = index * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  inputContext.putImageData(imageData, 0, 0);

  const output = makeCanvas(width, height);
  const outputContext = mustContext(output);
  outputContext.filter = `blur(${radius}px)`;
  outputContext.drawImage(input, 0, 0);
  const blurred = outputContext.getImageData(0, 0, width, height);
  return maskToAlpha(blurred);
}

function applyAlpha(imageData: ImageData, alpha: Uint8ClampedArray) {
  for (let index = 0; index < alpha.length; index += 1) {
    imageData.data[index * 4 + 3] = alpha[index];
  }
}

function normalizeBackground(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === 'transparent' || trimmed.toLowerCase() === 'none') {
    return null;
  }
  return trimmed;
}

function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('이미지를 읽지 못했습니다.'));
    };
    image.src = url;
  });
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function mustContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D를 사용할 수 없습니다.');
  return context;
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('PNG 내보내기에 실패했습니다.'));
    }, 'image/png');
  });
}

async function withBusy(label: string, task: () => Promise<void>) {
  setBusy(true);
  setStatus(label);
  try {
    await task();
    setStatus('완료');
  } catch (error) {
    console.error(error);
    setStatus('실패');
    setLog(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy: boolean) {
  els.runButton.disabled = isBusy;
  els.preloadButton.disabled = isBusy;
  els.dropzone.classList.toggle('is-disabled', isBusy);
}

function setProgress(value: number) {
  els.meterBar.style.width = `${clamp(value, 0, 100)}%`;
}

function setStatus(text: string) {
  els.runtimeStatus.textContent = text;
}

function setLog(text: string) {
  els.logText.value = text;
}

function resetResult() {
  revokeUrl(resultUrl);
  resultUrl = '';
  els.resultPreview.removeAttribute('src');
  els.resultPreview.classList.remove('has-image');
  els.resultEmpty.hidden = false;
  els.downloadLink.removeAttribute('href');
  els.downloadLink.classList.add('disabled');
}

function syncControlLabels() {
  els.edgeValue.value = els.edgeAdjust.value;
  els.featherValue.value = Number(els.feather.value).toFixed(2);
  els.fgValue.value = els.fgThreshold.value;
  els.bgValue.value = els.bgThreshold.value;
  els.erodeValue.value = els.erodeSize.value;
  els.thresholdValue.value = els.threshold.value;
}

function makeDownloadName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}-bg-removed.png`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function revokeUrl(url: string) {
  if (url) URL.revokeObjectURL(url);
}
