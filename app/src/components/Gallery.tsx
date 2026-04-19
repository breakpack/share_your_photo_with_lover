'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Photo, TagSummary, SortKey } from '@/lib/types';
import Grid from './Grid';
import Lightbox from './Lightbox';
import Uploader from './Uploader';
import Toolbar from './Toolbar';

const PAGE_SIZE = 60;

export default function Gallery({ currentUser }: { currentUser: string }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [nextOffset, setNextOffset] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [allTags, setAllTags] = useState<TagSummary[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('source-created-desc');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [dragHover, setDragHover] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[] | null>(null);
  const [columns, setColumns] = useState<number>(() => {
    if (typeof window === 'undefined') return 4;
    const stored = window.localStorage.getItem('photoshare.columns');
    if (stored) {
      const n = parseInt(stored, 10);
      if (!Number.isNaN(n) && n >= 1 && n <= 20) return n;
    }
    return window.innerWidth < 640 ? 3 : window.innerWidth < 1024 ? 5 : 7;
  });

  const dragCounter = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guards against stale responses from superseded queries (e.g. rapid filter
  // changes). Each fetch captures requestSeq.current; on completion it only
  // commits if still the latest.
  const requestSeq = useRef(0);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedPhotos = useMemo(
    () => photos.filter((p) => selectedIdSet.has(p.id)),
    [photos, selectedIdSet],
  );

  useEffect(() => {
    window.localStorage.setItem('photoshare.columns', String(columns));
  }, [columns]);

  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.length === 0) return prev;
      const valid = new Set(photos.map((p) => p.id));
      const next = prev.filter((id) => valid.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [photos]);

  const refreshTags = useCallback(async () => {
    const res = await fetch('/api/tags');
    if (!res.ok) return;
    const t = await res.json();
    setAllTags(t.tags);
  }, []);

  const fetchPage = useCallback(
    async (opts: { offset: number; cursor: string | null }) => {
      const sourceCreatedSort = sort === 'source-created-desc' || sort === 'taken-desc';
      const params = new URLSearchParams({
        sort,
        limit: String(PAGE_SIZE),
      });
      if (sourceCreatedSort) {
        if (opts.cursor) params.set('cursor', opts.cursor);
      } else {
        params.set('offset', String(opts.offset));
      }
      if (selectedTags.length) params.set('tags', selectedTags.join(','));
      const res = await fetch(`/api/photos?${params}`);
      if (res.status === 401) {
        window.location.href = '/login';
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as {
        photos: Photo[];
        hasMore: boolean;
        nextOffset: number | null;
        nextCursor: string | null;
      };
    },
    [sort, selectedTags],
  );

  const reset = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const [data] = await Promise.all([fetchPage({ offset: 0, cursor: null }), refreshTags()]);
    if (seq !== requestSeq.current) return;
    if (data) {
      setPhotos(data.photos);
      setNextOffset(data.nextOffset ?? 0);
      setNextCursor(data.nextCursor ?? null);
      setHasMore(data.hasMore);
    }
    setLoading(false);
  }, [fetchPage, refreshTags]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    const sourceCreatedSort = sort === 'source-created-desc' || sort === 'taken-desc';
    const data = await fetchPage({
      offset: sourceCreatedSort ? 0 : nextOffset,
      cursor: sourceCreatedSort ? nextCursor : null,
    });
    if (seq !== requestSeq.current) {
      setLoadingMore(false);
      return;
    }
    if (data) {
      setPhotos((prev) => {
        // De-dup in case an upload caused overlap with a concurrent reset.
        const seen = new Set(prev.map((p) => p.id));
        const fresh = data.photos.filter((p) => !seen.has(p.id));
        return [...prev, ...fresh];
      });
      setNextOffset(data.nextOffset ?? nextOffset);
      setNextCursor(data.nextCursor ?? nextCursor);
      setHasMore(data.hasMore);
    }
    setLoadingMore(false);
  }, [fetchPage, hasMore, loadingMore, nextCursor, nextOffset, sort]);

  // Reset when filter/sort changes
  useEffect(() => {
    reset();
  }, [reset]);

  // Infinite scroll: observe a sentinel div near the bottom of the list
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) loadMore();
        }
      },
      { rootMargin: '800px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const openUploaderWithFiles = useCallback((files: File[]) => {
    const media = files.filter(
      (f) => f.type.startsWith('image/') || f.type.startsWith('video/'),
    );
    if (!media.length) return;
    setPendingFiles(media);
    setUploaderOpen(true);
  }, []);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      dragCounter.current += 1;
      setDragHover(true);
    };
    const onDragLeave = () => {
      dragCounter.current -= 1;
      if (dragCounter.current <= 0) {
        dragCounter.current = 0;
        setDragHover(false);
      }
    };
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
    };
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      dragCounter.current = 0;
      setDragHover(false);
      openUploaderWithFiles(Array.from(e.dataTransfer.files));
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [openUploaderWithFiles]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const it of items) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f && (f.type.startsWith('image/') || f.type.startsWith('video/'))) {
            files.push(f);
          }
        }
      }
      if (files.length) openUploaderWithFiles(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [openUploaderWithFiles]);

  useEffect(() => {
    const onPopState = () => {
      setLightboxIndex((i) => (i == null ? i : null));
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const openLightbox = useCallback(
    (index: number) => {
      if (selectionMode) return;
      if (lightboxIndex == null) {
        window.history.pushState({ photoshareLightbox: true }, '', window.location.href);
      }
      setLightboxIndex(index);
    },
    [lightboxIndex, selectionMode],
  );

  const closeLightbox = useCallback(() => {
    if (lightboxIndex == null) return;
    if ((window.history.state as any)?.photoshareLightbox) {
      window.history.back();
      return;
    }
    setLightboxIndex(null);
  }, [lightboxIndex]);
  const navLightbox = useCallback(
    (delta: number) => {
      setLightboxIndex((i) => {
        if (i == null) return i;
        const n = i + delta;
        if (n < 0 || n >= photos.length) return i;
        // If we are near the end, eagerly load more so nav keeps going.
        if (n >= photos.length - 5 && hasMore && !loadingMore) loadMore();
        return n;
      });
    },
    [photos.length, hasMore, loadingMore, loadMore],
  );

  function toggleSelectionMode() {
    if (!selectionMode && lightboxIndex != null) closeLightbox();
    setSelectionMode((v) => {
      if (v) setSelectedIds([]);
      return !v;
    });
  }

  function toggleSelect(photoId: string) {
    setSelectedIds((prev) =>
      prev.includes(photoId)
        ? prev.filter((id) => id !== photoId)
        : [...prev, photoId],
    );
  }

  function selectAllVisible() {
    setSelectedIds(photos.map((p) => p.id));
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  async function patchPhotoById(photoId: string, patch: any) {
    const res = await fetch(`/api/photos/${photoId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (!res.ok) return null;
    return (await res.json()) as Photo;
  }

  async function patchPhoto(photo: Photo, patch: any, refetchTags = false) {
    const updated = await patchPhotoById(photo.id, patch);
    if (updated) {
      setPhotos((prev) =>
        sortPhotosLocal(
          prev.map((p) => (p.id === updated.id ? updated : p)),
          sort,
        ),
      );
      if (refetchTags) refreshTags();
    }
  }

  async function bulkUpdateSelected(patch: { hidden?: boolean; blurred?: boolean }) {
    if (bulkBusy || selectedPhotos.length === 0) return;
    const targets = selectedPhotos.filter((p) => {
      if ('hidden' in patch) return p.ownerName === currentUser;
      if ('blurred' in patch) return !p.hidden;
      return true;
    });
    if (targets.length === 0) return;

    setBulkBusy(true);
    try {
      const updated = (
        await Promise.all(targets.map((p) => patchPhotoById(p.id, patch)))
      ).filter((p): p is Photo => Boolean(p));
      if (updated.length) {
        const byId = new Map(updated.map((p) => [p.id, p]));
        setPhotos((prev) =>
          sortPhotosLocal(
            prev.map((p) => byId.get(p.id) ?? p),
            sort,
          ),
        );
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDeleteSelected() {
    if (bulkBusy || selectedPhotos.length === 0) return;
    const targets = selectedPhotos.filter((p) => p.ownerName === currentUser);
    if (targets.length === 0) return;
    if (!confirm(`선택한 ${targets.length}개 사진을 삭제할까요?`)) return;

    setBulkBusy(true);
    try {
      const deletedIds = (
        await Promise.all(
          targets.map(async (p) => {
            const res = await fetch(`/api/photos/${p.id}`, { method: 'DELETE' });
            if (res.status === 401) {
              window.location.href = '/login';
              return null;
            }
            return res.ok ? p.id : null;
          }),
        )
      ).filter((id): id is string => Boolean(id));

      if (deletedIds.length) {
        const deletedSet = new Set(deletedIds);
        setPhotos((prev) => prev.filter((p) => !deletedSet.has(p.id)));
        setSelectedIds((prev) => prev.filter((id) => !deletedSet.has(id)));
        setNextOffset((n) => Math.max(0, n - deletedIds.length));
        setLightboxIndex((idx) => {
          if (idx == null) return idx;
          const opened = photos[idx];
          if (!opened) return idx;
          return deletedSet.has(opened.id) ? null : idx;
        });
        refreshTags();
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function toggleHidden(photo: Photo) {
    if (photo.ownerName !== currentUser) return;
    await patchPhoto(photo, { hidden: !photo.hidden });
  }

  async function toggleBlurred(photo: Photo) {
    if (photo.hidden) return;
    await patchPhoto(photo, { blurred: !photo.blurred });
  }

  async function updateCaption(photo: Photo, caption: string) {
    if (photo.ownerName !== currentUser) return;
    await patchPhoto(photo, { caption });
  }

  async function updateTags(photo: Photo, tags: string[]) {
    if (photo.ownerName !== currentUser) return;
    await patchPhoto(photo, { tags }, true);
  }

  const markViewed = useCallback(
    async (photo: Photo) => {
      if (photo.ownerName === currentUser || !photo.unseen) return;
      const res = await fetch(`/api/photos/${photo.id}/view`, { method: 'POST' });
      if (res.ok) {
        setPhotos((prev) =>
          prev.map((p) => (p.id === photo.id ? { ...p, unseen: false } : p)),
        );
      }
    },
    [currentUser],
  );

  const reparsePhoto = useCallback(
    async (photo: Photo, opts?: { silent?: boolean }) => {
      if (!photo.mimeType.startsWith('image/')) return true;
      const res = await fetch(`/api/photos/${photo.id}/reparse`, { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/login';
        return false;
      }
      if (!res.ok) {
        if (!opts?.silent) {
          const message = await res.text().catch(() => '');
          console.error('reparse failed', message || `HTTP ${res.status}`);
        }
        return false;
      }
      const updated = await res.json();
      setPhotos((prev) =>
        sortPhotosLocal(
          prev.map((p) => (p.id === updated.id ? updated : p)),
          sort,
        ),
      );
      return true;
    },
    [sort],
  );

  async function deletePhoto(photo: Photo) {
    if (photo.ownerName !== currentUser) return;
    if (!confirm(`삭제할까요? "${photo.filename}"`)) return;
    const res = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' });
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      closeLightbox();
      // Account for the removed row so pagination offsets stay right.
      setNextOffset((n) => Math.max(0, n - 1));
      refreshTags();
    }
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }

  const tagsWithAll = useMemo(() => allTags, [allTags]);

  return (
    <div className="min-h-screen bg-black text-white">
      <Toolbar
        currentUser={currentUser}
        tags={tagsWithAll}
        selectedTags={selectedTags}
        onSelectedTagsChange={setSelectedTags}
        selectionMode={selectionMode}
        selectedPhotoCount={selectedIds.length}
        bulkBusy={bulkBusy}
        onToggleSelectionMode={toggleSelectionMode}
        sort={sort}
        onSortChange={setSort}
        columns={columns}
        onColumnsChange={setColumns}
        refreshing={loading}
        onRefreshClick={reset}
        onUploadClick={() => {
          setPendingFiles(null);
          setUploaderOpen(true);
        }}
        onLogout={logout}
      />

      {selectionMode && (
        <div className="fixed top-14 inset-x-0 z-20 border-b border-neutral-800 bg-neutral-950/95 backdrop-blur px-2 sm:px-3 py-2">
          <div className="flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar">
            <div className="text-xs text-neutral-300 shrink-0 min-w-fit pr-1">
              선택 {selectedIds.length}개
            </div>
            <button
              onClick={selectAllVisible}
              disabled={bulkBusy}
              className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded px-2 py-1 text-[11px] sm:text-xs shrink-0"
            >
              전체선택
            </button>
            <button
              onClick={clearSelection}
              disabled={bulkBusy || selectedIds.length === 0}
              className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded px-2 py-1 text-[11px] sm:text-xs shrink-0"
            >
              선택해제
            </button>
            <button
              onClick={() => bulkUpdateSelected({ hidden: true })}
              disabled={bulkBusy || selectedIds.length === 0}
              className="bg-amber-600/30 hover:bg-amber-600/40 disabled:opacity-50 rounded px-2 py-1 text-[11px] sm:text-xs shrink-0"
              title="내가 올린 사진만 적용"
            >
              가리기
            </button>
            <button
              onClick={() => bulkUpdateSelected({ hidden: false })}
              disabled={bulkBusy || selectedIds.length === 0}
              className="bg-amber-600/20 hover:bg-amber-600/30 disabled:opacity-50 rounded px-2 py-1 text-[11px] sm:text-xs shrink-0"
              title="내가 올린 사진만 적용"
            >
              가리기 해제
            </button>
            <button
              onClick={() => bulkUpdateSelected({ blurred: true })}
              disabled={bulkBusy || selectedIds.length === 0}
              className="bg-purple-600/30 hover:bg-purple-600/40 disabled:opacity-50 rounded px-2 py-1 text-[11px] sm:text-xs shrink-0"
            >
              블러
            </button>
            <button
              onClick={() => bulkUpdateSelected({ blurred: false })}
              disabled={bulkBusy || selectedIds.length === 0}
              className="bg-purple-600/20 hover:bg-purple-600/30 disabled:opacity-50 rounded px-2 py-1 text-[11px] sm:text-xs shrink-0"
            >
              블러 해제
            </button>
            <button
              onClick={bulkDeleteSelected}
              disabled={bulkBusy || selectedIds.length === 0}
              className="bg-red-600/30 hover:bg-red-600/40 disabled:opacity-50 rounded px-2 py-1 text-[11px] sm:text-xs shrink-0"
              title="내가 올린 사진만 삭제"
            >
              삭제
            </button>
          </div>
        </div>
      )}

      <main className={selectionMode ? 'pt-[6.5rem]' : 'pt-14'}>
        {loading ? (
          <div className="p-8 text-neutral-400">로딩중...</div>
        ) : photos.length === 0 ? (
          <div className="p-16 text-center text-neutral-400">
            사진이 없습니다. 드래그앤드롭, 붙여넣기(Cmd+V), 또는 업로드 버튼으로 추가해보세요.
          </div>
        ) : (
          <>
            <Grid
              photos={photos}
              currentUser={currentUser}
              columns={columns}
              selectionMode={selectionMode}
              selectedIds={selectedIdSet}
              onToggleSelect={toggleSelect}
              onOpen={openLightbox}
            />
            <div ref={sentinelRef} className="h-8" />
            {loadingMore && (
              <div className="py-6 text-center text-neutral-500 text-sm">
                더 불러오는 중…
              </div>
            )}
            {!hasMore && photos.length > PAGE_SIZE && (
              <div className="py-6 text-center text-neutral-600 text-xs">
                끝
              </div>
            )}
          </>
        )}
      </main>

      {!selectionMode && lightboxIndex != null && photos[lightboxIndex] && (
        <Lightbox
          photo={photos[lightboxIndex]}
          currentUser={currentUser}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < photos.length - 1 || hasMore}
          onClose={closeLightbox}
          onPrev={() => navLightbox(-1)}
          onNext={() => navLightbox(1)}
          onToggleHidden={() => toggleHidden(photos[lightboxIndex])}
          onToggleBlurred={() => toggleBlurred(photos[lightboxIndex])}
          onUpdateCaption={(c) => updateCaption(photos[lightboxIndex], c)}
          onUpdateTags={(tags) => updateTags(photos[lightboxIndex], tags)}
          onViewed={markViewed}
          onReparse={reparsePhoto}
          onDelete={() => deletePhoto(photos[lightboxIndex])}
          allTags={allTags}
        />
      )}

      {uploaderOpen && (
        <Uploader
          initialFiles={pendingFiles}
          allTags={allTags}
          onClose={() => {
            setUploaderOpen(false);
            setPendingFiles(null);
          }}
          onDone={() => {
            setUploaderOpen(false);
            setPendingFiles(null);
            reset();
          }}
        />
      )}

      {dragHover && !uploaderOpen && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-blue-500/20 border-4 border-dashed border-blue-400 flex items-center justify-center">
          <div className="bg-black/70 rounded-2xl px-6 py-4 text-xl">
            여기에 사진을 드롭하세요
          </div>
        </div>
      )}
    </div>
  );
}

function sortPhotosLocal(list: Photo[], sort: SortKey): Photo[] {
  const out = [...list];
  out.sort((a, b) => comparePhoto(a, b, sort));
  return out;
}

function comparePhoto(a: Photo, b: Photo, sort: SortKey): number {
  if (sort === 'source-created-desc' || sort === 'taken-desc') {
    const aSource = asMsOrNull(a.sourceCreatedAt) ?? asMs(a.createdAt);
    const bSource = asMsOrNull(b.sourceCreatedAt) ?? asMs(b.createdAt);
    if (aSource !== bSource) return bSource - aSource;
    const aCreated = asMs(a.createdAt);
    const bCreated = asMs(b.createdAt);
    if (aCreated !== bCreated) return bCreated - aCreated;
    return b.id.localeCompare(a.id);
  }
  if (sort === 'time-desc') {
    const aCreated = asMs(a.createdAt);
    const bCreated = asMs(b.createdAt);
    if (aCreated !== bCreated) return bCreated - aCreated;
    return b.id.localeCompare(a.id);
  }
  if (sort === 'time-asc') {
    const aCreated = asMs(a.createdAt);
    const bCreated = asMs(b.createdAt);
    if (aCreated !== bCreated) return aCreated - bCreated;
    return a.id.localeCompare(b.id);
  }
  if (sort === 'size-desc') {
    if (a.sizeBytes !== b.sizeBytes) return b.sizeBytes - a.sizeBytes;
    return b.id.localeCompare(a.id);
  }
  if (sort === 'size-asc') {
    if (a.sizeBytes !== b.sizeBytes) return a.sizeBytes - b.sizeBytes;
    return a.id.localeCompare(b.id);
  }
  return 0;
}

function asMs(v: string | null): number {
  if (!v) return 0;
  const n = Date.parse(v);
  return Number.isNaN(n) ? 0 : n;
}

function asMsOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Date.parse(v);
  return Number.isNaN(n) ? null : n;
}
