import {
  Button,
  Card,
  Chip,
  Description,
  Input,
  Label,
  ListBox,
  ProgressBar,
  Select,
  Skeleton,
  Slider,
  Switch,
  Tabs,
  TextField,
  ToastProvider,
  toast,
} from '@heroui/react';
import { type Config, preload, segmentForeground } from '@imgly/background-removal';
import { type RefObject, StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

type PresetName = 'ultra' | 'hq' | 'soft' | 'logo' | 'human' | 'classic' | 'fast';
type ModelName = 'isnet' | 'isnet_fp16' | 'isnet_quint8';
type StatusName = '대기 중' | '이미지 준비됨' | '모델 받는 중' | '처리 중' | '완료' | '실패';

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

type AuthUser = {
  id: string;
  username: string;
  global_name?: string | null;
};

type AuthState =
  | { status: 'checking' }
  | { status: 'authorized'; user: AuthUser }
  | { status: 'local' };

type PresetOption = {
  value: PresetName;
  label: string;
  desc: string;
};

const presetOptions: PresetOption[] = [
  { value: 'ultra', label: 'Ultra HQ', desc: '가장자리까지 최대 품질로 정리' },
  { value: 'hq', label: 'HQ 일반 / 제품', desc: '대부분의 제품 사진에 추천' },
  {
    value: 'soft',
    label: '머리카락 / 털',
    desc: '부드러운 가장자리를 자연스럽게 보존',
  },
  { value: 'logo', label: '로고 / 아이콘', desc: '선명한 하드컷 마스크' },
  { value: 'human', label: '인물 사진', desc: '사람 중심 이미지에 적합' },
  { value: 'classic', label: '클래식 U2Net', desc: '가벼운 호환 모드' },
  { value: 'fast', label: '빠른 미리보기', desc: '작은 모델로 빠르게 확인' },
];

const initialSettings: Settings = {
  preset: 'ultra',
  alphaMatting: true,
  postProcessMask: true,
  edgeAdjust: -1,
  feather: 0,
  previewBg: '',
  fgThreshold: 240,
  bgThreshold: 10,
  erodeSize: 10,
  hardCut: false,
  hardThreshold: 128,
};

function App() {
  const [authState, setAuthState] = useState<AuthState>({ status: 'checking' });
  const [settings, setSettings] = useState<Settings>(initialSettings);
  const [sourceFile, setSourceFileState] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [, setLog] = useState('이미지를 넣으면 브라우저에서 바로 배경 제거를 실행합니다.');
  const [status, setStatus] = useState<StatusName>('대기 중');
  const [progress, setProgress] = useState(0);
  const [isBusy, setIsBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const downloadRef = useRef<HTMLAnchorElement>(null);
  const hasShownFirstRunNoticeRef = useRef(false);
  const webGpuAvailable = useMemo(() => typeof navigator !== 'undefined' && 'gpu' in navigator, []);

  useEffect(() => {
    if (!webGpuAvailable) {
      setLog('현재 브라우저에서 WebGPU를 사용할 수 없어 CPU 모드로 실행합니다.');
    }
  }, [webGpuAvailable]);

  useEffect(() => {
    let cancelled = false;

    async function loadAuth() {
      try {
        const response = await fetch('/api/auth/me', {
          cache: 'no-store',
          credentials: 'include',
        });

        if (cancelled) return;

        if (response.ok) {
          const data = (await response.json()) as { user: AuthUser };
          setAuthState({ status: 'authorized', user: data.user });
          return;
        }

        if (response.status === 404) {
          setAuthState({ status: 'local' });
          return;
        }

        window.location.assign('/api/auth/login');
      } catch {
        if (!cancelled) setAuthState({ status: 'local' });
      }
    }

    void loadAuth();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => revokeUrl(sourceUrl), [sourceUrl]);
  useEffect(() => () => revokeUrl(resultUrl), [resultUrl]);

  function updateSettings(patch: Partial<Settings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function applyPreset(preset: PresetName) {
    const defaults: Partial<Settings> =
      preset === 'ultra'
        ? {
            alphaMatting: true,
            edgeAdjust: -1,
            feather: 0.2,
            hardCut: false,
            hardThreshold: 128,
            postProcessMask: true,
          }
        : preset === 'logo'
          ? {
              alphaMatting: false,
              edgeAdjust: -1,
              feather: 0,
              hardCut: true,
              hardThreshold: 150,
            }
          : preset === 'soft'
            ? {
                alphaMatting: true,
                edgeAdjust: -1,
                feather: 0.25,
                hardCut: false,
                hardThreshold: 128,
              }
            : preset === 'fast'
              ? {
                  alphaMatting: false,
                  edgeAdjust: 0,
                  feather: 0,
                  hardCut: false,
                  hardThreshold: 128,
                }
              : {
                  alphaMatting: true,
                  edgeAdjust: -1,
                  feather: 0,
                  hardCut: false,
                  hardThreshold: 128,
                };

    setSettings((current) => ({ ...current, preset, ...defaults }));
  }

  function setSourceFile(file: File) {
    const nextUrl = URL.createObjectURL(file);
    setSourceFileState(file);
    setSourceUrl(nextUrl);
    resetResult();
    setProgress(0);
    setStatus('이미지 준비됨');
    setLog(`불러온 파일: ${file.name}\n크기: ${formatBytes(file.size)}`);
    showToast('info', '이미지 준비 완료', '배경 제거를 누르면 브라우저에서 바로 처리합니다.');
  }

  function resetResult() {
    setResultUrl('');
  }

  function handleFileInput(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file?.type.startsWith('image/')) setSourceFile(file);
  }

  function openFilePicker() {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }

  async function runPreload() {
    showToast(
      'info',
      'AI 모델을 미리 받는 중',
      '처음 한 번은 모델 다운로드 때문에 조금 걸릴 수 있습니다.',
    );
    await withBusy('모델 받는 중', async () => {
      await preload(buildConfig(settings, webGpuAvailable, setProgress, setLog));
      setProgress(100);
      setLog('모델 캐시가 완료되었습니다. 다음 실행부터 더 빠르게 시작합니다.');
      showToast('success', 'AI 모델 준비 완료', '이제 배경 제거를 더 빠르게 시작할 수 있습니다.');
    });
  }

  async function runRemoval() {
    if (!sourceFile) {
      setLog('먼저 이미지를 업로드해 주세요.');
      showToast('warning', '이미지가 필요합니다', '배경을 제거할 이미지를 먼저 선택해 주세요.');
      return;
    }

    const isFirstRemoval = !hasShownFirstRunNoticeRef.current;

    if (isFirstRemoval) {
      hasShownFirstRunNoticeRef.current = true;
      showToast(
        'warning',
        '처음 실행은 조금 느릴 수 있어요',
        'AI 모델을 브라우저에 다운로드한 뒤 처리해서 첫 이미지는 시간이 더 걸릴 수 있습니다.',
        7000,
      );
    }

    const file = sourceFile;
    await withBusy('처리 중', async () => {
      resetResult();
      const lines = [
        `프리셋: ${presetLabel(settings.preset)}`,
        `모델: ${modelForPreset(settings.preset)}`,
        `알파 매팅: ${settings.alphaMatting ? '켜짐' : '꺼짐'}`,
        '처리 중...',
      ];

      if (settings.preset === 'fast') {
        lines.splice(
          1,
          0,
          '주의: 빠른 미리보기는 품질이 낮을 수 있습니다. 최종 결과는 HQ를 권장합니다.',
        );
      }

      setLog(lines.join('\n'));
      if (!isFirstRemoval) {
        showToast(
          'info',
          '배경 제거 시작',
          `${presetLabel(settings.preset)} 프리셋으로 처리합니다.`,
        );
      }

      const config = buildConfig(settings, webGpuAvailable, setProgress, setLog);
      const maskBlob = await removeMaskWithFallback(file, config, setLog);
      const outputBlob = await composeOutput(file, maskBlob, settings);

      setResultUrl(URL.createObjectURL(outputBlob));
      setProgress(100);
      setLog(`${lines.join('\n')}\n완료되었습니다. PNG를 다운로드할 수 있습니다.`);
      showToast(
        'success',
        '배경 제거 완료',
        '결과 PNG가 준비되었습니다. 아래 버튼으로 다운로드할 수 있어요.',
      );
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
      showToast(
        'danger',
        '작업에 실패했습니다',
        error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.',
      );
    } finally {
      setIsBusy(false);
    }
  }

  const currentPreset = presetOptions.find((option) => option.value === settings.preset);
  const isDownloadReady = Boolean(resultUrl);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-5 px-4 py-5 text-foreground sm:px-6 lg:px-8">
      <Card className="border-border bg-surface shadow-sm">
        <Card.Content className="grid gap-3 p-4">
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Card.Title className="text-xl font-bold">
                  BACKGROUND REMOVER for 기여움 디자인팀
                </Card.Title>
              </div>
              <Card.Description className="mt-1">
                {currentPreset
                  ? `현재 프리셋: ${presetLabel(currentPreset.value)}`
                  : '프리셋을 선택하세요.'}
              </Card.Description>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <AuthBadge authState={authState} />
              <Chip
                color={status === '실패' ? 'danger' : status === '완료' ? 'success' : 'accent'}
                variant="soft"
                className="text-base px-3 py-2"
              >
                {status}
              </Chip>
              <Chip variant="secondary" className="text-base px-3 py-2">
                {progress}%
              </Chip>
            </div>
          </div>

          <ProgressBar.Root aria-label="진행률" color="accent" maxValue={100} value={progress}>
            <ProgressBar.Track className="h-1.5">
              <ProgressBar.Fill />
            </ProgressBar.Track>
          </ProgressBar.Root>
        </Card.Content>
      </Card>

      <section className="grid gap-5 lg:grid-cols-2">
        <ImagePanel
          title="원본 이미지"
          subtitle="클릭하거나 드래그해서 업로드"
          url={sourceUrl}
          emptyText="이미지를 여기에 놓거나 클릭해서 선택하세요"
          isUpload
          isDragging={isDragging}
          isBusy={isBusy}
          inputRef={fileInputRef}
          onFileInput={handleFileInput}
          onClick={openFilePicker}
          onDragState={setIsDragging}
          onDropFile={setSourceFile}
          actions={
            <>
              {isDownloadReady ? (
                <Button
                  fullWidth
                  isDisabled={isBusy}
                  size="lg"
                  variant="secondary"
                  onPress={openFilePicker}
                >
                  다른 이미지 선택
                </Button>
              ) : (
                <Button
                  fullWidth
                  isDisabled={isBusy}
                  size="lg"
                  variant="secondary"
                  onPress={() => void runPreload()}
                >
                  모델 미리 받기
                </Button>
              )}
              <Button
                fullWidth
                isDisabled={isBusy}
                size="lg"
                variant="primary"
                onPress={() => void runRemoval()}
              >
                배경 제거
              </Button>
            </>
          }
        />

        <ImagePanel
          title="결과 PNG"
          subtitle="투명 배경은 체크 패턴으로 표시"
          url={resultUrl}
          emptyText="처리 결과가 여기에 표시됩니다"
          checker
          isLoading={status === '처리 중'}
          actionsClassName="grid gap-2"
          actions={
            <>
              <Button
                fullWidth
                isDisabled={!isDownloadReady}
                size="lg"
                variant="outline"
                onPress={() => downloadRef.current?.click()}
              >
                PNG 다운로드
              </Button>
              <a
                ref={downloadRef}
                className="hidden"
                download={sourceFile ? makeDownloadName(sourceFile.name) : 'bg-removed.png'}
                href={isDownloadReady ? resultUrl : undefined}
              >
                PNG 다운로드
              </a>
            </>
          }
        />
      </section>

      <section>
        <Card className="border-border bg-surface shadow-sm">
          <Card.Header className="flex flex-wrap items-start justify-between gap-4 p-5 pb-0">
            <div className="min-w-0">
              <Card.Title className="text-xl font-bold">작업 설정</Card.Title>
              <Card.Description className="mt-1">
                현재 프리셋과 마스크 보정값을 한 번에 조정합니다.
              </Card.Description>
            </div>
          </Card.Header>
          <Card.Content className="p-5">
            <Tabs className="grid gap-5" defaultSelectedKey="basic" variant="secondary">
              <Tabs.ListContainer>
                <Tabs.List aria-label="설정 탭">
                  <Tabs.Tab id="basic">기본</Tabs.Tab>
                  <Tabs.Tab id="advanced">고급</Tabs.Tab>
                </Tabs.List>
              </Tabs.ListContainer>

              <Tabs.Panel className="grid gap-4" id="basic">
                <div className="grid gap-4 rounded-lg border border-border bg-surface-secondary p-4 lg:grid-cols-3">
                  <HeroSelect
                    label="프리셋"
                    value={settings.preset}
                    options={presetOptions}
                    onChange={(preset) => applyPreset(preset as PresetName)}
                  />
                  <HeroSwitch
                    isSelected={settings.alphaMatting}
                    onChange={(alphaMatting) => updateSettings({ alphaMatting })}
                    title="알파 매팅"
                    description="머리카락과 가장자리를 부드럽게 개선"
                  />
                  <HeroSwitch
                    isSelected={settings.postProcessMask}
                    onChange={(postProcessMask) => updateSettings({ postProcessMask })}
                    title="마스크 정리"
                    description="작은 노이즈와 거친 부분을 완화"
                  />
                  <RangeField
                    label="가장자리 보존정도"
                    min={-5}
                    max={5}
                    step={1}
                    value={settings.edgeAdjust}
                    format={(value) => value.toFixed(0)}
                    onChange={(edgeAdjust) => updateSettings({ edgeAdjust })}
                  />
                  <RangeField
                    label="경계선 부드럽게"
                    min={0}
                    max={2}
                    step={0.05}
                    value={settings.feather}
                    format={(value) => value.toFixed(2)}
                    onChange={(feather) => updateSettings({ feather })}
                  />
                  <HeroTextInput
                    label="배경색"
                    value={settings.previewBg}
                    description=""
                    placeholder="비우면 투명 PNG"
                    onChange={(previewBg) => updateSettings({ previewBg })}
                  />
                </div>
              </Tabs.Panel>

              <Tabs.Panel className="grid gap-4" id="advanced">
                <div className="grid gap-4 rounded-lg border border-border bg-surface-secondary p-4 lg:grid-cols-3">
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
                  <HeroSwitch
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
              </Tabs.Panel>
            </Tabs>
          </Card.Content>
        </Card>
      </section>
    </main>
  );
}

type ImagePanelProps = {
  title: string;
  subtitle: string;
  url: string;
  emptyText: string;
  checker?: boolean;
  isUpload?: boolean;
  isDragging?: boolean;
  isBusy?: boolean;
  isLoading?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onFileInput?: (files: FileList | null) => void;
  onClick?: () => void;
  onDragState?: (dragging: boolean) => void;
  onDropFile?: (file: File) => void;
  actions?: React.ReactNode;
  actionsClassName?: string;
};

function AuthBadge({ authState }: { authState: AuthState }) {
  if (authState.status === 'authorized') {
    const name = authState.user.global_name || authState.user.username;

    return (
      <>
        <Chip variant="secondary" className="text-base px-3 py-2">
          Discord: {name}
        </Chip>
        <Button
          size="sm"
          variant="secondary"
          onPress={() => {
            window.location.assign('/api/auth/logout');
          }}
        >
          로그아웃
        </Button>
      </>
    );
  }

  if (authState.status === 'checking') {
    return (
      <Chip color="warning" variant="soft" className="text-base px-3 py-2">
        로그인 확인 중
      </Chip>
    );
  }

  return (
    <Chip color="warning" variant="soft" className="text-base px-3 py-2">
      로컬 개발 모드
    </Chip>
  );
}

function ImagePanel({
  title,
  subtitle,
  url,
  emptyText,
  checker,
  isUpload,
  isDragging,
  isBusy,
  isLoading,
  inputRef,
  onFileInput,
  onClick,
  onDragState,
  onDropFile,
  actions,
  actionsClassName = 'grid gap-2 sm:grid-cols-2',
}: ImagePanelProps) {
  const stageClassName = cx(
    'relative grid aspect-[4/3] min-h-[360px] w-full place-items-center overflow-hidden rounded-lg border border-border bg-surface-secondary p-4 sm:min-h-[448px]',
    checker && !isLoading && 'checkerboard',
    isUpload && 'cursor-pointer border-dashed transition hover:border-accent hover:bg-accent-soft',
    isDragging && 'border-accent bg-accent-soft',
    isBusy && 'pointer-events-none opacity-60',
  );

  const stageContent = (
    <>
      {isLoading ? (
        <div className="grid w-full max-w-sm justify-items-center gap-3 text-center">
          <Skeleton className="h-8 w-44 rounded-lg" animationType="none" />
          <Skeleton className="h-4 w-64 max-w-full rounded-lg" animationType="none" />
          <Skeleton className="h-4 w-40 rounded-lg" animationType="none" />
        </div>
      ) : url ? (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <img className="h-full w-full rounded-md object-contain" src={url} alt={title} />
        </div>
      ) : (
        <div className="grid max-w-sm justify-items-center gap-3 text-center">
          <span className="text-base font-bold text-foreground">{emptyText}</span>
          {isUpload ? (
            <Chip color="accent" size="sm" variant="soft">
              PNG · JPG · WEBP
            </Chip>
          ) : null}
        </div>
      )}
    </>
  );

  return (
    <Card className="overflow-hidden border-border bg-surface shadow-sm">
      <Card.Header className="p-5 pb-0">
        <div>
          <Card.Title className="text-xl">{title}</Card.Title>
          <Card.Description className="mt-1">{subtitle}</Card.Description>
        </div>
      </Card.Header>
      <Card.Content className="p-3 sm:p-5">
        {isUpload ? (
          <input
            ref={inputRef}
            className="hidden"
            type="file"
            accept="image/*"
            onChange={(event) => onFileInput?.(event.currentTarget.files)}
          />
        ) : null}
        {isUpload ? (
          // biome-ignore lint/a11y/useSemanticElements: This is a drag-and-drop file dropzone, not a plain button.
          <div
            className={stageClassName}
            role="button"
            tabIndex={0}
            onClick={onClick}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') onClick?.();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              onDragState?.(true);
            }}
            onDragLeave={() => onDragState?.(false)}
            onDrop={(event) => {
              event.preventDefault();
              onDragState?.(false);
              const file = event.dataTransfer.files?.[0];
              if (file?.type.startsWith('image/')) onDropFile?.(file);
            }}
          >
            {stageContent}
          </div>
        ) : (
          <div className={stageClassName}>{stageContent}</div>
        )}
      </Card.Content>
      {actions ? (
        <Card.Footer className={cx('p-5 pt-0', actionsClassName)}>{actions}</Card.Footer>
      ) : null}
    </Card>
  );
}

function HeroSwitch({
  isSelected,
  onChange,
  title,
  description,
}: {
  isSelected: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <div className="grid min-h-32 content-start gap-2 rounded-lg border border-border bg-surface p-4">
      <Switch isSelected={isSelected} onChange={onChange} size="lg">
        <Switch.Content className="flex w-full items-center justify-between gap-4">
          <Label className="text-sm font-semibold text-foreground">{title}</Label>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
      <Description className="text-sm leading-5 text-muted">{description}</Description>
    </div>
  );
}

function HeroSelect({
  label,
  description,
  value,
  options,
  onChange,
}: {
  label: string;
  description?: string;
  value: string;
  options: PresetOption[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      className="grid min-h-32 content-start gap-3 rounded-lg border border-border bg-surface p-4"
      fullWidth
      selectedKey={value}
      onSelectionChange={(key) => {
        if (key != null) onChange(String(key));
      }}
    >
      <div className="grid gap-1">
        <Label className="text-sm font-semibold text-foreground">{label}</Label>
        {description ? (
          <Description className="text-sm leading-5 text-muted">{description}</Description>
        ) : null}
      </div>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
              <div className="grid gap-1">
                <strong>{option.label}</strong>
                <span className="text-sm text-muted">{option.desc}</span>
              </div>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

function HeroTextInput({
  label,
  value,
  placeholder,
  description,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  description: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField
      className="grid min-h-32 content-start gap-3 rounded-lg border border-border bg-surface p-4"
      fullWidth
    >
      <Label className="text-sm font-semibold text-foreground">{label}</Label>
      <Input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <Description className="text-sm leading-5 text-muted">{description}</Description>
    </TextField>
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
  onChange,
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
    <Slider
      className="grid min-h-32 content-start gap-3 rounded-lg border border-border bg-surface p-4"
      minValue={min}
      maxValue={max}
      step={step}
      value={value}
      onChange={(nextValue) => {
        if (typeof nextValue === 'number') onChange(nextValue);
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm font-semibold text-foreground">{label}</Label>
        <Slider.Output className="font-mono text-sm font-semibold text-foreground">
          {format(value)}
        </Slider.Output>
      </div>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
      {hint ? <Description className="text-sm leading-5 text-muted">{hint}</Description> : null}
    </Slider>
  );
}

function buildConfig(
  settings: Settings,
  webGpuAvailable: boolean,
  setProgress: (value: number) => void,
  setLog: (value: string) => void,
): Config {
  return {
    debug: false,
    device: webGpuAvailable ? 'gpu' : 'cpu',
    model: modelForPreset(settings.preset),
    output: {
      format: 'image/png',
      quality: 1,
    },
    progress: (key, current, total) => {
      if (total > 0) {
        setProgress(Math.round((current / total) * 100));
        setLog(`${key} 다운로드 중: ${formatBytes(current)} / ${formatBytes(total)}`);
      }
    },
  };
}

async function removeMaskWithFallback(
  file: File,
  config: Config,
  setLog: (value: string) => void,
): Promise<Blob> {
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

function presetLabel(preset: PresetName): string {
  if (preset === 'ultra') return 'Ultra HQ - 최대 품질';
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
  if (preset === 'ultra') return 'isnet_fp16';
  return 'isnet_fp16';
}

async function composeOutput(imageFile: File, maskBlob: Blob, settings: Settings): Promise<Blob> {
  const [sourceImage, maskImage] = await Promise.all([loadImage(imageFile), loadImage(maskBlob)]);

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

  if (settings.preset === 'ultra' && !settings.hardCut) {
    alpha = refineUltraAlpha(alpha, sourceData, width, height);
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

function refineUltraAlpha(
  alpha: Uint8ClampedArray,
  imageData: ImageData,
  width: number,
  height: number,
): Uint8ClampedArray {
  let output = edgeAwareSmoothAlpha(alpha, imageData, width, height);
  output = edgeAwareSmoothAlpha(output, imageData, width, height);
  output = snapConfidentAlpha(output);
  return output;
}

function edgeAwareSmoothAlpha(
  alpha: Uint8ClampedArray,
  imageData: ImageData,
  width: number,
  height: number,
): Uint8ClampedArray {
  const output = new Uint8ClampedArray(alpha);
  const data = imageData.data;
  const radius = 2;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const centerAlpha = alpha[index];
      if (!isRefinementCandidate(alpha, width, height, x, y, centerAlpha)) continue;

      const sourceOffset = index * 4;
      const red = data[sourceOffset];
      const green = data[sourceOffset + 1];
      const blue = data[sourceOffset + 2];
      let weightedAlpha = 0;
      let totalWeight = 0;

      for (let dy = -radius; dy <= radius; dy += 1) {
        const yy = clamp(y + dy, 0, height - 1);
        const row = yy * width;
        for (let dx = -radius; dx <= radius; dx += 1) {
          const xx = clamp(x + dx, 0, width - 1);
          const neighborIndex = row + xx;
          const neighborOffset = neighborIndex * 4;
          const colorDistance =
            Math.abs(red - data[neighborOffset]) +
            Math.abs(green - data[neighborOffset + 1]) +
            Math.abs(blue - data[neighborOffset + 2]);
          const spatialWeight = dx === 0 && dy === 0 ? 1.6 : 1 / (1 + Math.hypot(dx, dy));
          const colorWeight = Math.exp(-colorDistance / 70);
          const weight = spatialWeight * colorWeight;

          weightedAlpha += alpha[neighborIndex] * weight;
          totalWeight += weight;
        }
      }

      output[index] = Math.round(weightedAlpha / totalWeight);
    }
  }

  return output;
}

function isRefinementCandidate(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number,
): boolean {
  if (value > 8 && value < 247) return true;

  const index = y * width + x;
  const left = alpha[y * width + clamp(x - 1, 0, width - 1)];
  const right = alpha[y * width + clamp(x + 1, 0, width - 1)];
  const top = alpha[clamp(y - 1, 0, height - 1) * width + x];
  const bottom = alpha[clamp(y + 1, 0, height - 1) * width + x];

  return (
    Math.abs(value - left) > 36 ||
    Math.abs(value - right) > 36 ||
    Math.abs(value - top) > 36 ||
    Math.abs(value - bottom) > 36 ||
    (alpha[index] > 0 && alpha[index] < 255)
  );
}

function snapConfidentAlpha(alpha: Uint8ClampedArray): Uint8ClampedArray {
  const output = new Uint8ClampedArray(alpha.length);
  for (let index = 0; index < alpha.length; index += 1) {
    const value = alpha[index];
    output[index] = value < 5 ? 0 : value > 250 ? 255 : value;
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
  amount: number,
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
  radius: number,
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

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

function showToast(
  variant: 'info' | 'success' | 'warning' | 'danger',
  title: string,
  description: string,
  timeout?: number,
) {
  toast.clear();
  toast[variant](title, { description, timeout });
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element.');

createRoot(root).render(
  <StrictMode>
    <App />
    <ToastProvider maxVisibleToasts={4} placement="top end" />
  </StrictMode>,
);
