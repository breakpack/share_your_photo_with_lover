'use client';

import type { Photo } from '@/lib/types';

type Props = {
  photos: Photo[];
  currentUser: string;
  columns: number;
  onOpen: (index: number) => void;
};

export default function Grid({ photos, currentUser, columns, onOpen }: Props) {
  const cols = Math.max(1, Math.min(20, columns));
  return (
    <div
      className="grid gap-1 p-1"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {photos.map((p, i) => {
        const isVideo = p.mimeType.startsWith('video/');
        const mediaClass =
          'w-full h-full object-cover transition group-hover:scale-[1.02] ' +
          (p.blurred ? 'blur-2xl scale-110' : '');
        return (
          <button
            key={p.id}
            onClick={() => onOpen(i)}
            className="relative aspect-square overflow-hidden bg-neutral-900 group"
          >
            {isVideo ? (
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
            ) : (
              <img
                src={`/api/photos/${p.id}/thumb`}
                alt={p.filename}
                loading="lazy"
                className={mediaClass}
              />
            )}
            {isVideo && !p.blurred && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-white text-lg">
                  ▶
                </div>
              </div>
            )}
            {p.blurred && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="bg-black/60 rounded-full px-2 py-0.5 text-[10px]">
                  눌러서 보기
                </div>
              </div>
            )}
            {p.hidden && p.ownerName === currentUser && (
              <div className="absolute top-1 right-1 bg-black/70 rounded-full px-1.5 py-0.5 text-[10px]">
                가리기
              </div>
            )}
            {p.ownerName !== currentUser && (
              <div className="absolute bottom-1 left-1 bg-black/60 rounded-full px-1.5 py-0.5 text-[10px]">
                {p.ownerName}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
