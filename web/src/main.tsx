import '@heroui/react/styles';
import {
  Button,
  Card,
  Checkbox,
  Chip
} from '@heroui/react';
import { preload, segmentForeground, type Config } from '@imgly/background-removal';
import { StrictMode, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type PresetName = 'hq' | 'soft' | 'logo' | 'human' | 'classic' | 'fast';
type ModelName = 'isnet' | 'isnet_fp16' | 'isnet_quint8';
type StatusName = '준비됨' | '이미지 준비됨' | '모델 받는 중' | '작업 중' | '완료' | '실패';

type Settings = {
  preset: PresetName;
  alphaMatting: boolean;
  postProcessMask: boolean;
  edgeAdjust: number;
  feather: number;
  previewBg: string;
  fgThreshold: number;
  bgThreshold: number;
  erodeSize: number;
  hardCut: boolean;
  hardThreshold: number;
};

const initialSettings: Settings = {
  preset: 'hq',
  alphaMatting: true,
  postProcessMask: true,
  edgeAdjust: -1,
  feather: 0,
  previewBg: '',
  fgThreshold: 240,
  bgThreshold: 10,
  erodeSize: 10,
  hardCut: false,
  hardThreshold: 128
};

function App() {
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [sourceFile, setSourceFileState] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [log, setLog] = useState('준비됨.');
  const [status, setStatus] = useState<StatusName>('준비됨');
  const [progress, setProgress] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const webGpuAvailable = useMemo(() => 'gpu' in navigator, []);

  useEffect(() => {
    if (!webGpuAvailable) {
      setLog('이 브라우저에서는 WebGPU를 사용할 수 없어 CPU로 실행합니다.');
    }
  }, [webGpuAvailable]);

  useEffect(() => {
    return () => {
      revokeUrl(sourceUrl);
      revokeUrl(resultUrl);
    };
  }, [sourceUrl, resultUrl]);

  const isDownloadReady = Boolean(resultUrl);

  function updateSettings(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function applyPreset(preset: PresetName) {
    const defaults: Partial<Settings> =
      preset === 'logo'
        ? { alphaMatting: false, edgeAdjust: -1, feather: 0, hardCut: true, hardThreshold: 150 }
        : preset === 'soft'
          ? { alphaMatting: true, edgeAdjust: -1, feather: 0.25, hardCut: false, hardThreshold: 128 }
          : preset === 'fast'
            ? { alphaMatting: false, edgeAdjust: 0, feather: 0, hardCut: false, hardThreshold: 128 }
            : { alphaMatting: true, edgeAdjust: -1, feather: 0, hardCut: false, hardThreshold: 128 };

    setSettings((current) => ({ ...current, preset, ...defaults }));
  }

  function setSourceFile(file: File) {
    revokeUrl(sourceUrl);
    const nextUrl = URL.createObjectURL(file);
    setSourceFileState(file);
    setSourceUrl(nextUrl);
    resetResult();
    setProgress(0);
    setStatus('이미지 준비됨');
    setLog(`불러온 파일: ${file.name}\n크기: ${formatBytes(file.size)}`);
  }

  async function runPreload() {
    await withBusy('모델 받는 중', async () => {
      await preload(buildConfig(settings, webGpuAvailable, setProgress, setLog));
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
      const lines = [
        `프리셋: ${presetLabel(settings.preset)}`,
        `모델: ${modelForPreset(settings.preset)}`,
        `알파 매팅: ${settings.alphaMatting ? '켜짐' : '꺼짐'}`,
        '실행 중...'
      ];
      if (settings.preset === 'fast') {
        lines.splice(1, 0, '주의: 빠른 미리보기는 품질이 낮습니다. 최종 결과는 HQ를 권장합니다.');
      }
      setLog(lines.join('\n'));

      const maskBlob = await removeMaskWithFallback(
        file,
        buildConfig(settings, webGpuAvailable, setProgress, setLog)
      );
      const outputBlob = await composeOutput(file, maskBlob, settings);

      revokeUrl(resultUrl);
      const nextResultUrl = URL.createObjectURL(outputBlob);
      setResultUrl(nextResultUrl);
      setProgress(100);
      setLog(`${lines.join('\n')}\n완료되었습니다. 아래에서 PNG를 다운로드하세요.`);
    });
  }

  async function withBusy(nextStatus: StatusName, task: () => Promise<void>) {
    setIsBusy(true);
    setStatus(nextStatus);
    try {
      await task();
      setStatus('완료');
    } catch (error) {
      console.error(error);
      setStatus('실패');
      setLog(error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsBusy(false);
    }
  }

  function resetResult() {
    revokeUrl(resultUrl);
    setResultUrl('');
  }

  function handleFileInput(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file?.type.startsWith('image/')) setSourceFile(file);
  }

  return (
    <main className="app-page">
        <section className="hero">
          <div className="hero-copy">
            <Chip className="hero-chip" variant="primary">
              브라우저 AI 배경 제거
            </Chip>
            <h1>BG Remover Pro v6 HQ</h1>
            <p>
              이미지는 서버로 업로드하지 않고 브라우저에서 바로 처리합니다. 첫 실행만
              모델 다운로드 때문에 시간이 조금 걸릴 수 있습니다.
            </p>
          </div>
          <Card className="hero-status-card">
            <Card.Content>
              <span className="status-label">현재 상태</span>
              <strong>{status}</strong>
              <div className="hero-progress" aria-label="진행률">
                <div style={{ width: `${progress}%` }} />
              </div>
            </Card.Content>
          </Card>
        </section>

        <section className="image-row">
          <ImagePanel
            title="원본 이미지"
            url={sourceUrl}
            emptyText="이미지를 여기에 놓거나 클릭해서 업로드"
            isUpload
            isDragging={isDragging}
            isBusy={isBusy}
            inputRef={fileInputRef}
            onFileInput={handleFileInput}
            onClick={() => fileInputRef.current?.click()}
            onDragState={setIsDragging}
            onDropFile={setSourceFile}
          />

          <ImagePanel
            title="결과 PNG"
            url={resultUrl}
            emptyText="처리 결과가 여기에 표시됩니다"
            checker
          />
        </section>

        <section className="control-grid">
          <Card className="control-card main-control-card">
            <Card.Header>
              <div>
                <Card.Title>기본 설정</Card.Title>
                <Card.Description>
                  로컬 앱의 프리셋 흐름은 유지하면서 웹용 모델로 실행합니다.
                </Card.Description>
              </div>
            </Card.Header>
            <Card.Content>
              <div className="form-row three">
                <NativeSelect
                  label="품질 프리셋"
                  value={settings.preset}
                  onChange={(value) => applyPreset(value as PresetName)}
                  options={[
                    ['hq', 'HQ 일반 / 제품 - 추천'],
                    ['soft', '부드러운 가장자리 / 머리카락 / 털'],
                    ['logo', '로고 / 아이콘 선명한 컷'],
                    ['human', '인물 사진 클래식'],
                    ['classic', '클래식 U2Net'],
                    ['fast', '빠른 미리보기 전용']
                  ]}
                />
                <HeroCheckbox
                  isSelected={settings.alphaMatting}
                  onChange={(alphaMatting) => updateSettings({ alphaMatting })}
                  title="알파 매팅"
                  description="가장자리 품질 개선"
                />
                <HeroCheckbox
                  isSelected={settings.postProcessMask}
                  onChange={(postProcessMask) => updateSettings({ postProcessMask })}
                  title="마스크 정리"
                  description="작은 점과 거친 부분 완화"
                />
              </div>

              <div className="form-row three">
                <RangeField
                  label="가장자리 보정"
                  hint="음수는 테두리 제거, 양수는 가장자리 보존"
                  min={-5}
                  max={5}
                  step={1}
                  value={settings.edgeAdjust}
                  format={(value) => value.toFixed(0)}
                  onChange={(edgeAdjust) => updateSettings({ edgeAdjust })}
                />
                <RangeField
                  label="부드럽게 / 소프트 엣지"
                  min={0}
                  max={2}
                  step={0.05}
                  value={settings.feather}
                  format={(value) => value.toFixed(2)}
                  onChange={(feather) => updateSettings({ feather })}
                />
                <TextField
                  label="선택 배경"
                  value={settings.previewBg}
                  placeholder="비우면 투명 PNG"
                  onChange={(previewBg) => updateSettings({ previewBg })}
                />
              </div>
            </Card.Content>
          </Card>

          <Card className="control-card">
            <Card.Header>
              <div>
                <Card.Title>고급 설정</Card.Title>
                <Card.Description>필요할 때만 조정하세요.</Card.Description>
              </div>
            </Card.Header>
            <Card.Content>
              <div className="form-row three">
                <RangeField
                  label="전경 기준값"
                  min={1}
                  max={255}
                  step={1}
                  value={settings.fgThreshold}
                  format={(value) => value.toFixed(0)}
                  onChange={(fgThreshold) => updateSettings({ fgThreshold })}
                />
                <RangeField
                  label="배경 기준값"
                  min={0}
                  max={254}
                  step={1}
                  value={settings.bgThreshold}
                  format={(value) => value.toFixed(0)}
                  onChange={(bgThreshold) => updateSettings({ bgThreshold })}
                />
                <RangeField
                  label="침식 크기"
                  min={1}
                  max={30}
                  step={1}
                  value={settings.erodeSize}
                  format={(value) => value.toFixed(0)}
                  onChange={(erodeSize) => updateSettings({ erodeSize })}
                />
              </div>
              <div className="form-row two">
                <HeroCheckbox
                  isSelected={settings.hardCut}
                  onChange={(hardCut) => updateSettings({ hardCut })}
                  title="하드컷 마스크"
                  description="로고에는 좋고 머리카락에는 부적합"
                />
                <RangeField
                  label="하드컷 기준값"
                  min={0}
                  max={255}
                  step={1}
                  value={settings.hardThreshold}
                  format={(value) => value.toFixed(0)}
                  onChange={(hardThreshold) => updateSettings({ hardThreshold })}
                />
              </div>
            </Card.Content>
          </Card>

          <Card className="control-card action-card">
            <Card.Content>
              <div className="button-row">
                <Button
                  className="primary-button"
                  isDisabled={isBusy}
                  size="lg"
                  onPress={() => void runRemoval()}
                >
                  배경 제거
                </Button>
                <Button
                  className="secondary-button"
                  isDisabled={isBusy}
                  size="lg"
                  variant="outline"
                  onPress={() => void runPreload()}
                >
                  모델 미리 받기
                </Button>
                <a
                  className={`download-button ${isDownloadReady ? '' : 'is-disabled'}`}
                  download={sourceFile ? makeDownloadName(sourceFile.name) : 'bg-removed.png'}
                  href={isDownloadReady ? resultUrl : undefined}
                >
                  PNG 다운로드
                </a>
              </div>
              <label className="log-field">
                <span>상태 / 로그</span>
                <textarea value={log} readOnly rows={8} />
              </label>
            </Card.Content>
          </Card>
        </section>
    </main>
  );
}

type ImagePanelProps = {
  title: string;
  url: string;
  emptyText: string;
  checker?: boolean;
  isUpload?: boolean;
  isDragging?: boolean;
  isBusy?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onFileInput?: (files: FileList | null) => void;
  onClick?: () => void;
  onDragState?: (dragging: boolean) => void;
  onDropFile?: (file: File) => void;
};

function ImagePanel({
  title,
  url,
  emptyText,
  checker,
  isUpload,
  isDragging,
  isBusy,
  inputRef,
  onFileInput,
  onClick,
  onDragState,
  onDropFile
}: ImagePanelProps) {
  return (
    <Card className="image-card">
      <Card.Header>
        <Card.Title>{title}</Card.Title>
      </Card.Header>
      <Card.Content>
        <div
          className={[
            'image-stage',
            checker ? 'checker' : '',
            isUpload ? 'upload-stage' : '',
            isDragging ? 'is-dragging' : '',
            isBusy ? 'is-disabled' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          role={isUpload ? 'button' : undefined}
          tabIndex={isUpload ? 0 : undefined}
          onClick={isUpload ? onClick : undefined}
          onKeyDown={(event) => {
            if (isUpload && (event.key === 'Enter' || event.key === ' ')) onClick?.();
          }}
          onDragOver={(event) => {
            if (!isUpload) return;
            event.preventDefault();
            onDragState?.(true);
          }}
          onDragLeave={() => onDragState?.(false)}
          onDrop={(event) => {
            if (!isUpload) return;
            event.preventDefault();
            onDragState?.(false);
            const file = event.dataTransfer.files?.[0];
            if (file?.type.startsWith('image/')) onDropFile?.(file);
          }}
        >
          {isUpload ? (
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              onChange={(event) => onFileInput?.(event.currentTarget.files)}
            />
          ) : null}
          {url ? (
            <div className="image-fit-shell">
              <img src={url} alt={title} />
            </div>
          ) : (
            <div className="empty-state">
              <span>{emptyText}</span>
              {isUpload ? <small>PNG, JPG, WEBP 지원</small> : null}
            </div>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}

function HeroCheckbox({
  isSelected,
  onChange,
  title,
  description
}: {
  isSelected: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <Checkbox className="hero-checkbox" isSelected={isSelected} onChange={onChange}>
      <div>
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
    </Checkbox>
  );
}

function NativeSelect({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-shell">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field-shell">
      <span>{label}</span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function RangeField({
  label,
  hint,
  min,
  max,
  step,
  value,
  format,
  onChange
}: {
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field-shell range-shell">
      <span>{label}</span>
      {hint ? <small>{hint}</small> : null}
      <div className="range-line">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <output>{format(value)}</output>
      </div>
    </label>
  );
}

function buildConfig(
  settings: Settings,
  webGpuAvailable: boolean,
  setProgress: (value: number) => void,
  setLog: (value: string) => void
): Config {
  return {
    debug: false,
    device: webGpuAvailable ? 'gpu' : 'cpu',
    model: modelForPreset(settings.preset),
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

async function removeMaskWithFallback(file: File, config: Config): Promise<Blob> {
  try {
    return await segmentForeground(file, config);
  } catch (error) {
    if (config.device === 'gpu') {
      return await segmentForeground(file, { ...config, device: 'cpu' });
    }
    throw error;
  }
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

async function composeOutput(imageFile: File, maskBlob: Blob, settings: Settings): Promise<Blob> {
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

  if (settings.postProcessMask) {
    alpha = cleanMask(alpha, width, height);
  }

  if (settings.hardCut) {
    alpha = hardThreshold(alpha, settings.hardThreshold);
  }

  if (settings.edgeAdjust !== 0) {
    alpha = morphAlpha(alpha, width, height, settings.edgeAdjust);
  }

  if (settings.feather > 0) {
    alpha = blurAlpha(alpha, width, height, settings.feather);
  }

  if (settings.alphaMatting && !settings.hardCut) {
    alpha = softenSemiTransparentEdges(alpha);
  }

  applyAlpha(sourceData, alpha);

  const background = normalizeBackground(settings.previewBg);
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

function cleanMask(alpha: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
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

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
