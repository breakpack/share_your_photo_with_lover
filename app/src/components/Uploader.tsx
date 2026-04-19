'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { TagSummary } from '@/lib/types';

type Item = {
  id: string;
  file: File;
  previewUrl: string;
  hidden: boolean;
  blurred: boolean;
  caption: string;
  tags: string[];
  selected: boolean;
  status: 'idle' | 'uploading' | 'done' | 'error';
  progress: number;
  errorMessage?: string;
};

type Props = {
  initialFiles: File[] | null;
  allTags: TagSummary[];
  onClose: () => void;
  onDone: () => void;
};

let idCounter = 0;
const nextId = () => `u${Date.now()}_${idCounter++}`;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 6;
const RETRY_LIMIT = 2;
const RETRY_BASE_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 8 * 60 * 1000;
const PROGRESS_THROTTLE_MS = 140;

export default function Uploader({ initialFiles, allTags, onClose, onDone }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [giftWrap, setGiftWrap] = useState(false);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<Record<string, { ts: number; pct: number }>>({});

  useEffect(() => {
    if (initialFiles && initialFiles.length) addFiles(initialFiles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      items.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files: File[] | FileList) {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
    );
    if (!list.length) return;
    const newItems: Item[] = list.map((file) => ({
      id: nextId(),
      file,
      previewUrl: URL.createObjectURL(file),
      hidden: false,
      blurred: false,
      caption: '',
      tags: [],
      selected: true,
      status: 'idle',
      progress: 0,
    }));
    setItems((prev) => [...prev, ...newItems]);
  }

  function removeItem(id: string) {
    setItems((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  function toggleSelect(id: string) {
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)),
    );
  }

  function selectAll(v: boolean) {
    setItems((prev) => prev.map((p) => ({ ...p, selected: v })));
  }

  function applyHiddenToSelected(v: boolean) {
    setItems((prev) => prev.map((p) => (p.selected ? { ...p, hidden: v } : p)));
  }

  function applyBlurredToSelected(v: boolean) {
    setItems((prev) => prev.map((p) => (p.selected ? { ...p, blurred: v } : p)));
  }

  function addTagToSelected(name: string) {
    const t = name.trim();
    if (!t) return;
    setItems((prev) =>
      prev.map((p) =>
        p.selected && !p.tags.includes(t) ? { ...p, tags: [...p.tags, t] } : p,
      ),
    );
  }

  function toggleItemTag(id: string, name: string) {
    setItems((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              tags: p.tags.includes(name)
                ? p.tags.filter((x) => x !== name)
                : [...p.tags, name],
            }
          : p,
      ),
    );
  }

  function toggleItemHidden(id: string) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, hidden: !p.hidden } : p)));
  }

  function toggleItemBlurred(id: string) {
    setItems((prev) =>
      prev.map((p) => (p.id === id ? { ...p, blurred: !p.blurred } : p)),
    );
  }

  function setItemCaption(id: string, caption: string) {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, caption } : p)));
  }

  function patchItem(itemId: string, patch: Partial<Item>) {
    setItems((prev) =>
      prev.map((p) => (p.id === itemId ? { ...p, ...patch } : p)),
    );
  }

  async function uploadOneAttempt(
    item: Item,
    opts: { bulkMode: boolean; giftBoxId: string | null; giftOrder: number | null },
  ): Promise<{ ok: boolean; retryable: boolean; message: string }> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const params = new URLSearchParams();
      params.set('filename', item.file.name);
      if (opts.bulkMode) params.set('bulk', '1');
      if (item.hidden) params.set('hidden', '1');
      if (item.blurred) params.set('blurred', '1');
      if (item.caption.trim()) {
        params.set('caption', item.caption.trim());
      }
      if (item.tags.length) params.set('tags', item.tags.join(','));
      if (opts.giftBoxId) {
        params.set('giftBoxId', opts.giftBoxId);
        if (opts.giftOrder != null) params.set('giftOrder', String(opts.giftOrder));
      }
      xhr.open('POST', `/api/photos/upload?${params}`);
      xhr.setRequestHeader(
        'content-type',
        item.file.type || 'application/octet-stream',
      );
      xhr.timeout = REQUEST_TIMEOUT_MS;
      if (Number.isFinite(item.file.lastModified) && item.file.lastModified > 0) {
        xhr.setRequestHeader('x-file-last-modified', String(item.file.lastModified));
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          const now = Date.now();
          const prev = progressRef.current[item.id];
          const fastTick =
            prev &&
            now - prev.ts < PROGRESS_THROTTLE_MS &&
            pct < 100 &&
            pct - prev.pct < 3;
          if (fastTick) return;
          progressRef.current[item.id] = { ts: now, pct };
          patchItem(item.id, { progress: pct });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          patchItem(item.id, {
            status: 'done',
            progress: 100,
            errorMessage: undefined,
          });
          resolve({ ok: true, retryable: false, message: '' });
        } else {
          const msg = xhr.responseText || `HTTP ${xhr.status}`;
          resolve({
            ok: false,
            retryable: xhr.status >= 500 || xhr.status === 429 || xhr.status === 408,
            message: msg,
          });
        }
      };
      xhr.onerror = () => {
        resolve({ ok: false, retryable: true, message: 'network error' });
      };
      xhr.ontimeout = () => {
        resolve({ ok: false, retryable: true, message: 'upload timeout' });
      };
      patchItem(item.id, {
        status: 'uploading',
        progress: 0,
        errorMessage: undefined,
      });
      xhr.send(item.file);
    });
  }

  async function uploadOne(
    item: Item,
    opts: { bulkMode: boolean; giftBoxId: string | null; giftOrder: number | null },
  ) {
    let lastMessage = '';
    const maxAttempts = RETRY_LIMIT + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const res = await uploadOneAttempt(item, opts);
      if (res.ok) return true;
      lastMessage = res.message;

      if (!res.retryable || attempt >= maxAttempts) {
        patchItem(item.id, {
          status: 'error',
          errorMessage: lastMessage || 'upload failed',
        });
        return false;
      }

      patchItem(item.id, {
        status: 'uploading',
        errorMessage: `재시도 ${attempt}/${RETRY_LIMIT}...`,
      });
      await sleep(RETRY_BASE_DELAY_MS * attempt);
    }
    patchItem(item.id, { status: 'error', errorMessage: lastMessage || 'upload failed' });
    return false;
  }

  async function startUpload() {
    if (uploading) return;
    const queue = items.filter((it) => it.status === 'idle' || it.status === 'error');
    if (!queue.length) return;
    setUploading(true);
    const bulkMode = queue.length >= 80;
    const giftBoxId = giftWrap ? buildGiftBoxId() : null;

    // Worker pool: up to CONCURRENCY uploads in flight at once. Each worker
    // pulls the next index from a shared cursor until the queue is drained.
    const CONCURRENCY = pickUploadConcurrency(queue);
    let cursor = 0;
    let anyOk = false;

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= queue.length) return;
        const ok = await uploadOne(queue[i], {
          bulkMode,
          giftBoxId,
          giftOrder: giftBoxId ? i : null,
        });
        if (ok) anyOk = true;
      }
    };

    const n = Math.min(CONCURRENCY, queue.length);
    await Promise.all(Array.from({ length: n }, () => worker()));

    setUploading(false);
    if (anyOk) setTimeout(() => onDone(), 500);
  }

  const selectedCount = items.filter((i) => i.selected).length;
  const canUpload = items.some((i) => i.status === 'idle' || i.status === 'error');
  const uploadStats = useMemo(() => {
    let idle = 0;
    let uploadingCount = 0;
    let done = 0;
    let error = 0;
    for (const it of items) {
      if (it.status === 'idle') idle += 1;
      if (it.status === 'uploading') uploadingCount += 1;
      if (it.status === 'done') done += 1;
      if (it.status === 'error') error += 1;
    }
    return { idle, uploadingCount, done, error };
  }, [items]);

  const commonTagSuggestions = useMemo(() => {
    return allTags.slice(0, 12).map((t) => t.name);
  }, [allTags]);

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col safe-pt">
      <div className="flex items-center p-3 sm:p-4 border-b border-neutral-800 gap-2 sm:gap-3">
        <h2 className="text-base sm:text-lg font-semibold">업로드</h2>
        <div className="text-xs sm:text-sm text-neutral-400">
          {items.length > 0 && `${items.length}개`}
        </div>
        {items.length > 0 && (
          <div className="hidden sm:block text-[11px] text-neutral-500">
            대기 {uploadStats.idle} / 업로드중 {uploadStats.uploadingCount} / 완료{' '}
            {uploadStats.done} / 실패 {uploadStats.error}
          </div>
        )}
        <div className="flex-1" />
        <button
          onClick={onClose}
          disabled={uploading}
          className="text-neutral-300 hover:text-white px-2 sm:px-3 py-1.5 text-sm disabled:opacity-50"
        >
          취소
        </button>
        <label className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-neutral-200 shrink-0">
          <input
            type="checkbox"
            checked={giftWrap}
            onChange={(e) => setGiftWrap(e.target.checked)}
            disabled={uploading || items.length === 0}
            className="accent-amber-400"
          />
          담아보내기
        </label>
        <button
          onClick={startUpload}
          disabled={!canUpload || uploading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg px-3 sm:px-4 py-1.5 text-sm font-medium"
        >
          {uploading ? '업로드 중...' : '업로드'}
        </button>
      </div>
      {giftWrap && (
        <div className="px-3 sm:px-4 py-2 border-b border-neutral-800 bg-amber-500/10 text-[11px] sm:text-xs text-amber-100">
          선택한 파일이 선물상자로 업로드됩니다. 갤러리에서 상자를 열면 사진이 펼쳐진 뒤 목록에 추가됩니다.
        </div>
      )}

      {items.length === 0 ? (
        <DropZone onFiles={addFiles} onPickClick={() => inputRef.current?.click()} />
      ) : (
        <>
          {/* Batch controls — collapsible on mobile */}
          <BatchControls
            selectedCount={selectedCount}
            totalCount={items.length}
            tagInput={tagInput}
            onTagInputChange={setTagInput}
            commonTagSuggestions={commonTagSuggestions}
            onAddFile={() => inputRef.current?.click()}
            onSelectAll={() => selectAll(true)}
            onDeselectAll={() => selectAll(false)}
            onApplyHidden={applyHiddenToSelected}
            onApplyBlurred={applyBlurredToSelected}
            onAddTagToSelected={(n) => {
              addTagToSelected(n);
              setTagInput('');
            }}
          />

          <div className="flex-1 overflow-auto p-2 sm:p-3 no-scrollbar safe-pb">
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3">
              {items.map((it) => (
                <ItemCard
                  key={it.id}
                  item={it}
                  onToggleSelect={() => toggleSelect(it.id)}
                  onRemove={() => removeItem(it.id)}
                  onToggleHidden={() => toggleItemHidden(it.id)}
                  onToggleBlurred={() => toggleItemBlurred(it.id)}
                  onCaptionChange={(c) => setItemCaption(it.id, c)}
                  onToggleTag={(name) => toggleItemTag(it.id, name)}
                  allTagSuggestions={commonTagSuggestions}
                />
              ))}
            </div>
          </div>
        </>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

function BatchControls({
  selectedCount,
  totalCount,
  tagInput,
  onTagInputChange,
  commonTagSuggestions,
  onAddFile,
  onSelectAll,
  onDeselectAll,
  onApplyHidden,
  onApplyBlurred,
  onAddTagToSelected,
}: {
  selectedCount: number;
  totalCount: number;
  tagInput: string;
  onTagInputChange: (v: string) => void;
  commonTagSuggestions: string[];
  onAddFile: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onApplyHidden: (v: boolean) => void;
  onApplyBlurred: (v: boolean) => void;
  onAddTagToSelected: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-neutral-800 bg-neutral-950 text-sm">
      {/* Always-visible top row */}
      <div className="flex items-center gap-2 px-3 sm:px-4 py-2">
        <button
          onClick={onAddFile}
          className="bg-neutral-800 hover:bg-neutral-700 rounded-lg px-2.5 py-1.5 text-xs sm:text-sm shrink-0"
        >
          + 파일 추가
        </button>
        <div className="text-xs text-neutral-400 shrink-0">
          선택됨 {selectedCount} / {totalCount}
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setOpen((v) => !v)}
          className={
            'rounded-lg px-3 py-1.5 text-xs sm:text-sm shrink-0 ' +
            (open ? 'bg-white text-black' : 'bg-neutral-800 hover:bg-neutral-700')
          }
        >
          일괄 설정 {open ? '▲' : '▼'}
        </button>
      </div>

      {/* Collapsible batch panel */}
      {open && (
        <div className="px-3 sm:px-4 pb-3 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onSelectAll}
              className="bg-neutral-800 hover:bg-neutral-700 rounded px-2.5 py-1 text-xs"
            >
              전체 선택
            </button>
            <button
              onClick={onDeselectAll}
              className="bg-neutral-800 hover:bg-neutral-700 rounded px-2.5 py-1 text-xs"
            >
              선택 해제
            </button>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1.5">
              선택된 {selectedCount}개 일괄:
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => onApplyHidden(true)}
                className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded px-2.5 py-1 text-xs"
                title="가리기: 썸네일/원본 모두 블러 잠금. 올린 사람만 해제 가능"
              >
                가리기
              </button>
              <button
                onClick={() => onApplyHidden(false)}
                className="bg-neutral-800 hover:bg-neutral-700 rounded px-2.5 py-1 text-xs"
              >
                가리기 해제
              </button>
              <button
                onClick={() => onApplyBlurred(true)}
                className="bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 rounded px-2.5 py-1 text-xs"
                title="바로보이지 않기: 썸네일 블러"
              >
                블러 켜기
              </button>
              <button
                onClick={() => onApplyBlurred(false)}
                className="bg-neutral-800 hover:bg-neutral-700 rounded px-2.5 py-1 text-xs"
              >
                블러 끄기
              </button>
            </div>
          </div>
          <div>
            <div className="text-xs text-neutral-400 mb-1.5">태그 일괄 추가:</div>
            <div className="flex flex-wrap gap-1.5 items-center">
              <input
                value={tagInput}
                onChange={(e) => onTagInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onAddTagToSelected(tagInput);
                }}
                placeholder="새 태그 입력 후 Enter"
                className="bg-neutral-800 rounded px-2 py-1.5 outline-none flex-1 min-w-[160px] text-sm"
              />
              {commonTagSuggestions.map((name) => (
                <button
                  key={name}
                  onClick={() => onAddTagToSelected(name)}
                  className="bg-neutral-800 hover:bg-neutral-700 rounded-full px-2.5 py-1 text-xs"
                >
                  + {name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DropZone({
  onFiles,
  onPickClick,
}: {
  onFiles: (files: FileList | File[]) => void;
  onPickClick: () => void;
}) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onDragEnter={(e) => {
        e.preventDefault();
        setHover(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => {
        e.preventDefault();
        setHover(false);
        if (e.dataTransfer.files) onFiles(e.dataTransfer.files);
      }}
      className={
        'flex-1 flex items-center justify-center m-6 rounded-2xl border-2 border-dashed transition ' +
        (hover
          ? 'border-blue-400 bg-blue-500/10'
          : 'border-neutral-700 bg-neutral-950')
      }
    >
      <div className="text-center space-y-4">
        <div className="text-2xl">여기에 사진을 드롭하세요</div>
        <div className="text-neutral-400">
          또는 Cmd/Ctrl+V 로 붙여넣기, 아래 버튼으로 파일 선택
        </div>
        <button
          onClick={onPickClick}
          className="bg-blue-600 hover:bg-blue-500 rounded-lg px-5 py-2 font-medium"
        >
          파일 선택
        </button>
      </div>
    </div>
  );
}

function ItemCard({
  item,
  onToggleSelect,
  onRemove,
  onToggleHidden,
  onToggleBlurred,
  onCaptionChange,
  onToggleTag,
  allTagSuggestions,
}: {
  item: Item;
  onToggleSelect: () => void;
  onRemove: () => void;
  onToggleHidden: () => void;
  onToggleBlurred: () => void;
  onCaptionChange: (c: string) => void;
  onToggleTag: (name: string) => void;
  allTagSuggestions: string[];
}) {
  return (
    <div
      className={
        'relative rounded-xl overflow-hidden border ' +
        (item.selected ? 'border-blue-400' : 'border-transparent')
      }
      style={{
        contentVisibility: 'auto',
        containIntrinsicSize: '240px 300px',
      }}
    >
      <div className="relative aspect-square bg-neutral-900">
        {item.file.type.startsWith('video/') ? (
          <>
            <video
              src={item.previewUrl}
              muted
              playsInline
              preload="none"
              className={
                'w-full h-full object-cover ' +
                (item.blurred ? 'blur-2xl scale-110' : '')
              }
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-8 h-8 rounded-full bg-black/60 flex items-center justify-center text-white text-sm">
                ▶
              </div>
            </div>
          </>
        ) : (
          <img
            src={item.previewUrl}
            alt={item.file.name}
            loading="lazy"
            decoding="async"
            className={
              'w-full h-full object-cover ' +
              (item.blurred ? 'blur-2xl scale-110' : '')
            }
          />
        )}
        <button
          onClick={onToggleSelect}
          title={item.selected ? '선택 해제' : '선택'}
          className={
            'absolute top-2 left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition ' +
            (item.selected
              ? 'bg-blue-500 text-white'
              : 'bg-black/60 border border-white/60 text-transparent hover:text-white')
          }
        >
          ✓
        </button>
        <button
          onClick={onRemove}
          title="목록에서 제거"
          className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/70 hover:bg-red-500 text-xs"
        >
          ×
        </button>
        {item.status === 'uploading' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <div className="text-sm">{item.progress}%</div>
          </div>
        )}
        {item.status === 'done' && (
          <div className="absolute inset-0 bg-green-500/40 flex items-center justify-center text-2xl">
            ✓
          </div>
        )}
        {item.status === 'error' && (
          <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center p-2 text-xs">
            {item.errorMessage || '실패'}
          </div>
        )}
      </div>
      <div className="p-2 bg-neutral-900 space-y-1.5">
        <div className="text-xs truncate" title={item.file.name}>
          {item.file.name}
        </div>
        <input
          value={item.caption}
          onChange={(e) => onCaptionChange(e.target.value)}
          placeholder="캡션 (선택)"
          className="w-full bg-neutral-800 rounded px-2 py-1 text-xs outline-none"
        />
        <div className="flex items-center justify-between text-[11px] gap-1">
          <span className="text-neutral-400">{formatSize(item.file.size)}</span>
          <div className="flex gap-1">
            <button
              onClick={onToggleHidden}
              className={
                'rounded-full px-1.5 py-0.5 ' +
                (item.hidden
                  ? 'bg-amber-500/30 text-amber-200'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400')
              }
              title="가리기: 썸네일/원본 모두 블러 잠금. 올린 사람만 해제 가능"
            >
              가리기
            </button>
            <button
              onClick={onToggleBlurred}
              className={
                'rounded-full px-1.5 py-0.5 ' +
                (item.blurred
                  ? 'bg-purple-500/30 text-purple-200'
                  : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-400')
              }
              title="바로보이지 않기: 썸네일 블러 처리"
            >
              블러
            </button>
          </div>
        </div>
        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.map((t) => (
              <button
                key={t}
                onClick={() => onToggleTag(t)}
                className="bg-blue-600/30 text-blue-200 rounded-full px-1.5 py-0.5 text-[10px]"
              >
                {t} ×
              </button>
            ))}
          </div>
        )}
        {allTagSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {allTagSuggestions
              .filter((n) => !item.tags.includes(n))
              .slice(0, 4)
              .map((t) => (
                <button
                  key={t}
                  onClick={() => onToggleTag(t)}
                  className="bg-neutral-800 hover:bg-neutral-700 rounded-full px-1.5 py-0.5 text-[10px]"
                >
                  + {t}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildGiftBoxId() {
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `gift_${Date.now()}_${random.slice(0, 16)}`;
}

function pickUploadConcurrency(queue: Item[]): number {
  let concurrency = DEFAULT_CONCURRENCY;
  if (queue.length >= 120) concurrency = 6;
  else if (queue.length >= 60) concurrency = 5;
  else if (queue.length >= 20) concurrency = 4;

  const hasHugeFile = queue.some((it) => it.file.size > 250 * 1024 * 1024);
  if (hasHugeFile) concurrency = Math.min(concurrency, 2);

  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/Android|iPhone|iPad|Mobile/i.test(ua)) {
      concurrency = Math.min(concurrency, 3);
    }
    const connectionType = (navigator as any).connection?.effectiveType as
      | string
      | undefined;
    if (connectionType === 'slow-2g' || connectionType === '2g') {
      concurrency = 2;
    } else if (connectionType === '3g') {
      concurrency = Math.min(concurrency, 3);
    }
  }

  return Math.max(2, Math.min(MAX_CONCURRENCY, concurrency));
}
