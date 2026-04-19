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

export default function Uploader({ initialFiles, allTags, onClose, onDone }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  async function uploadOne(item: Item): Promise<boolean> {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      const params = new URLSearchParams();
      params.set('filename', item.file.name);
      if (item.hidden) params.set('hidden', '1');
      if (item.blurred) params.set('blurred', '1');
      if (item.caption.trim()) {
        params.set('caption', item.caption.trim());
      }
      if (item.tags.length) params.set('tags', item.tags.join(','));
      xhr.open('POST', `/api/photos/upload?${params}`);
      xhr.setRequestHeader(
        'content-type',
        item.file.type || 'application/octet-stream',
      );
      if (Number.isFinite(item.file.lastModified) && item.file.lastModified > 0) {
        xhr.setRequestHeader('x-file-last-modified', String(item.file.lastModified));
      }
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setItems((prev) =>
            prev.map((p) => (p.id === item.id ? { ...p, progress: pct } : p)),
          );
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id ? { ...p, status: 'done', progress: 100 } : p,
            ),
          );
          resolve(true);
        } else {
          setItems((prev) =>
            prev.map((p) =>
              p.id === item.id
                ? {
                    ...p,
                    status: 'error',
                    errorMessage: xhr.responseText || `HTTP ${xhr.status}`,
                  }
                : p,
            ),
          );
          resolve(false);
        }
      };
      xhr.onerror = () => {
        setItems((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, status: 'error', errorMessage: 'network error' }
              : p,
          ),
        );
        resolve(false);
      };
      setItems((prev) =>
        prev.map((p) =>
          p.id === item.id ? { ...p, status: 'uploading', progress: 0 } : p,
        ),
      );
      xhr.send(item.file);
    });
  }

  async function startUpload() {
    if (uploading) return;
    const queue = items.filter((it) => it.status === 'idle' || it.status === 'error');
    if (!queue.length) return;
    setUploading(true);

    // Worker pool: up to CONCURRENCY uploads in flight at once. Each worker
    // pulls the next index from a shared cursor until the queue is drained.
    const CONCURRENCY = 3;
    let cursor = 0;
    let anyOk = false;

    const getFresh = (id: string): Promise<Item> =>
      new Promise((resolve) => {
        setItems((prev) => {
          const f = prev.find((p) => p.id === id);
          resolve(f!);
          return prev;
        });
      });

    const worker = async () => {
      while (true) {
        const i = cursor++;
        if (i >= queue.length) return;
        const fresh = await getFresh(queue[i].id);
        const ok = await uploadOne(fresh);
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
        <div className="flex-1" />
        <button
          onClick={onClose}
          disabled={uploading}
          className="text-neutral-300 hover:text-white px-2 sm:px-3 py-1.5 text-sm disabled:opacity-50"
        >
          취소
        </button>
        <button
          onClick={startUpload}
          disabled={!canUpload || uploading}
          className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-lg px-3 sm:px-4 py-1.5 text-sm font-medium"
        >
          {uploading ? '업로드 중...' : '업로드'}
        </button>
      </div>

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
    >
      <div className="relative aspect-square bg-neutral-900">
        {item.file.type.startsWith('video/') ? (
          <>
            <video
              src={item.previewUrl}
              muted
              playsInline
              preload="metadata"
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
