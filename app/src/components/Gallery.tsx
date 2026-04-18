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
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const [allTags, setAllTags] = useState<TagSummary[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>('time-desc');
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

  useEffect(() => {
    window.localStorage.setItem('photoshare.columns', String(columns));
  }, [columns]);

  const refreshTags = useCallback(async () => {
    const res = await fetch('/api/tags');
    if (!res.ok) return;
    const t = await res.json();
    setAllTags(t.tags);
  }, []);

  const fetchPage = useCallback(
    async (offset: number) => {
      const params = new URLSearchParams({
        sort,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
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
        nextOffset: number;
      };
    },
    [sort, selectedTags],
  );

  const reset = useCallback(async () => {
    const seq = ++requestSeq.current;
    setLoading(true);
    const [data] = await Promise.all([fetchPage(0), refreshTags()]);
    if (seq !== requestSeq.current) return;
    if (data) {
      setPhotos(data.photos);
      setNextOffset(data.nextOffset);
      setHasMore(data.hasMore);
    }
    setLoading(false);
  }, [fetchPage, refreshTags]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    const data = await fetchPage(nextOffset);
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
      setNextOffset(data.nextOffset);
      setHasMore(data.hasMore);
    }
    setLoadingMore(false);
  }, [fetchPage, hasMore, loadingMore, nextOffset]);

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

  const closeLightbox = useCallback(() => setLightboxIndex(null), []);
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

  async function patchPhoto(photo: Photo, patch: any, refetchTags = false) {
    const res = await fetch(`/api/photos/${photo.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (res.ok) {
      const updated = await res.json();
      setPhotos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      if (refetchTags) refreshTags();
    }
  }

  async function toggleHidden(photo: Photo) {
    if (photo.ownerName !== currentUser) return;
    await patchPhoto(photo, { hidden: !photo.hidden });
  }

  async function toggleBlurred(photo: Photo) {
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

  async function deletePhoto(photo: Photo) {
    if (photo.ownerName !== currentUser) return;
    if (!confirm(`삭제할까요? "${photo.filename}"`)) return;
    const res = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' });
    if (res.ok) {
      setPhotos((prev) => prev.filter((p) => p.id !== photo.id));
      setLightboxIndex(null);
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
        sort={sort}
        onSortChange={setSort}
        columns={columns}
        onColumnsChange={setColumns}
        onUploadClick={() => {
          setPendingFiles(null);
          setUploaderOpen(true);
        }}
        onLogout={logout}
      />

      <main className="pt-14">
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
              onOpen={(i) => setLightboxIndex(i)}
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

      {lightboxIndex != null && photos[lightboxIndex] && (
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
