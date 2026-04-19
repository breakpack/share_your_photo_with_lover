'use client';

import type { GiftBoxSummary, Photo } from '@/lib/types';

type Props = {
  photos: Photo[];
  giftBoxes: GiftBoxSummary[];
  currentUser: string;
  columns: number;
  selectionMode: boolean;
  selectedIds: Set<string>;
  openingGiftId: string | null;
  onToggleSelect: (photoId: string) => void;
  onOpen: (index: number) => void;
  onOpenGift: (gift: GiftBoxSummary) => void;
};

export default function Grid({
  photos,
  giftBoxes,
  currentUser,
  columns,
  selectionMode,
  selectedIds,
  openingGiftId,
  onToggleSelect,
  onOpen,
  onOpenGift,
}: Props) {
  const cols = Math.max(1, Math.min(20, columns));
  return (
    <div
      className="grid gap-1 p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {giftBoxes.map((gift) => {
        const opening = openingGiftId === gift.id;
        return (
          <button
            key={`gift-${gift.id}`}
            onClick={() => {
              if (selectionMode || opening) return;
              onOpenGift(gift);
            }}
            disabled={selectionMode || opening}
            className="relative aspect-square overflow-hidden bg-gradient-to-br from-amber-600 via-orange-700 to-rose-800 group disabled:opacity-80"
            style={{
              contentVisibility: 'auto',
              containIntrinsicSize: '240px 240px',
            }}
          >
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.45),transparent_38%),radial-gradient(circle_at_80%_80%,rgba(255,255,255,0.2),transparent_45%)]" />
            <div className="absolute left-1/2 top-0 -translate-x-1/2 h-full w-2.5 bg-yellow-100/70 mix-blend-screen" />
            <div className="absolute top-1/2 left-0 -translate-y-1/2 h-2.5 w-full bg-yellow-100/70 mix-blend-screen" />
            <div className="relative z-10 h-full w-full flex flex-col items-center justify-center gap-2">
              <div className="rounded-xl border border-white/60 bg-black/25 px-3 py-1 text-[11px] tracking-[0.14em] uppercase">
                담아보내기
              </div>
              <div className="rounded-full bg-black/45 px-2.5 py-0.5 text-[11px]">
                {gift.photoCount}장
              </div>
              <div className="text-[10px] text-white/85">
                {opening ? '열어보는 중...' : '눌러서 열기'}
              </div>
            </div>
            {gift.ownerName !== currentUser && (
              <div className="absolute bottom-1 left-1 bg-black/60 rounded-full px-1.5 py-0.5 text-[10px]">
                {gift.ownerName}
              </div>
            )}
          </button>
        );
      })}
      {photos.map((p, i) => {
        const isVideo = p.mimeType.startsWith('video/');
        const hiddenMode = p.hidden;
        const showVideoPreview = isVideo && !hiddenMode;
        const mediaClass =
          'w-full h-full object-cover transition group-hover:scale-[1.02] ' +
          (p.blurred ? 'blur-2xl scale-110' : '');
        return (
          <button
            key={p.id}
            onClick={() => {
              if (selectionMode) {
                onToggleSelect(p.id);
                return;
              }
              onOpen(i);
            }}
            className="relative aspect-square overflow-hidden bg-neutral-900 group"
            style={{
              // Large galleries keep many tiles in the DOM; this lets the
              // browser skip work for off-screen cells.
              contentVisibility: 'auto',
              containIntrinsicSize: '240px 240px',
            }}
          >
            {showVideoPreview ? (
              // Use the original file with a #t fragment so the browser paints
              // a frame near the start as a cheap poster. preload="metadata"
              // keeps bandwidth modest; Range support on /file makes this fast.
              <video
                src={`/api/photos/${p.id}/file#t=0.1`}
                preload="metadata"
                muted
                playsInline
                className={mediaClass}
              />
            ) : isVideo ? (
              <div className={mediaClass + ' flex items-center justify-center bg-neutral-800'}>
                <span className="text-xs text-neutral-400">가리기 모드</span>
              </div>
            ) : (
              <img
                src={`/api/photos/${p.id}/thumb`}
                alt={p.filename}
                loading="lazy"
                className={mediaClass}
              />
            )}
            {isVideo && hiddenMode && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 rounded-full px-2 py-0.5 text-[10px]">가리기</div>
              </div>
            )}
            {showVideoPreview && !p.blurred && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white text-lg">
                  ▶
                </div>
              </div>
            )}
            {p.blurred && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 rounded-full px-2 py-0.5 text-[10px]">
                  {hiddenMode ? '가리기 모드' : '눌러서 보기'}
                </div>
              </div>
            )}
            {p.hidden && p.ownerName === currentUser && (
              <div className="absolute top-1 right-1 bg-black/70 rounded-full px-1.5 py-0.5 text-[10px]">
                가리기
              </div>
            )}
            {p.unseen && p.ownerName !== currentUser && (
              <div className="absolute top-1 left-1 bg-blue-500 text-white rounded-full px-1.5 py-0.5 text-[10px] font-medium">
                NEW
              </div>
            )}
            {p.ownerName !== currentUser && (
              <div className="absolute bottom-1 left-1 bg-black/60 rounded-full px-1.5 py-0.5 text-[10px]">
                {p.ownerName}
              </div>
            )}
            {selectionMode && (
              <div className="absolute top-1.5 left-1.5 pointer-events-none">
                <div
                  className={
                    'w-5 h-5 rounded border flex items-center justify-center text-xs font-bold ' +
                    (selectedIds.has(p.id)
                      ? 'bg-blue-500 border-blue-300 text-white'
                      : 'bg-black/50 border-white/60 text-transparent')
                  }
                >
                  ✓
                </div>
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
