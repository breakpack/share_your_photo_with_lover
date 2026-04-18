'use client';

import { useEffect, useState } from 'react';
import type { Photo, TagSummary } from '@/lib/types';

type Props = {
  photo: Photo;
  currentUser: string;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleHidden: () => void;
  onToggleBlurred: () => void;
  onUpdateCaption: (caption: string) => void;
  onUpdateTags: (tags: string[]) => void;
  onDelete: () => void;
  allTags: TagSummary[];
};

export default function Lightbox({
  photo,
  currentUser,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
  onToggleHidden,
  onToggleBlurred,
  onUpdateCaption,
  onUpdateTags,
  onDelete,
  allTags,
}: Props) {
  const [showInfo, setShowInfo] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [captionDraft, setCaptionDraft] = useState(photo.caption ?? '');
  const [captionEditing, setCaptionEditing] = useState(false);

  useEffect(() => {
    setCaptionDraft(photo.caption ?? '');
    setCaptionEditing(false);
  }, [photo.id, photo.caption]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (captionEditing) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      else if (e.key === 'ArrowRight' && hasNext) onNext();
      else if (e.key === 'i') setShowInfo((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hasPrev, hasNext, onClose, onPrev, onNext, captionEditing]);

  const isOwner = photo.ownerName === currentUser;
  const tagNames = photo.tags.map((t) => t.name);

  function addTag(name: string) {
    const t = name.trim();
    if (!t || tagNames.includes(t)) return;
    onUpdateTags([...tagNames, t]);
  }

  function removeTag(name: string) {
    onUpdateTags(tagNames.filter((t) => t !== name));
  }

  function saveCaption() {
    onUpdateCaption(captionDraft);
    setCaptionEditing(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col safe-pt">
      <div className="flex items-center gap-2 px-2 sm:px-3 py-2 sm:py-3 text-sm">
        <button
          onClick={onClose}
          className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 shrink-0"
          aria-label="Close"
        >
          <span className="hidden sm:inline">← 닫기</span>
          <span className="sm:hidden">✕</span>
        </button>
        <div className="text-neutral-400 truncate min-w-0 flex-1 text-xs sm:text-sm">
          <div className="truncate">{photo.filename}</div>
          <div className="truncate text-neutral-500 text-[11px] sm:text-xs">
            {photo.ownerName}
            {photo.takenAt
              ? ` · 촬영 ${new Date(photo.takenAt).toLocaleDateString()}`
              : ` · 업로드 ${new Date(photo.createdAt).toLocaleDateString()}`}
          </div>
        </div>
        <button
          onClick={onToggleBlurred}
          className={
            'rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm shrink-0 ' +
            (photo.blurred
              ? 'bg-purple-500/30 text-purple-200 hover:bg-purple-500/40'
              : 'bg-neutral-900 hover:bg-neutral-800')
          }
          title="썸네일 블러 — 모든 사용자에게 적용. 누구나 토글 가능."
        >
          {photo.blurred ? '블러 해제' : '블러'}
        </button>
        {isOwner && (
          <>
            <button
              onClick={onToggleHidden}
              className={
                'rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm shrink-0 ' +
                (photo.hidden
                  ? 'bg-amber-500/30 text-amber-200 hover:bg-amber-500/40'
                  : 'bg-neutral-900 hover:bg-neutral-800')
              }
            >
              {photo.hidden ? '가리기 해제' : '가리기'}
            </button>
            <button
              onClick={onDelete}
              className="hidden sm:block rounded-lg px-3 py-1.5 bg-neutral-900 hover:bg-red-600"
            >
              삭제
            </button>
          </>
        )}
        <button
          onClick={() => setShowInfo((v) => !v)}
          className={
            'rounded-lg px-2 sm:px-3 py-1.5 text-xs sm:text-sm shrink-0 ' +
            (showInfo ? 'bg-white text-black' : 'bg-neutral-900 hover:bg-neutral-800')
          }
        >
          정보
        </button>
      </div>

      <div className="flex-1 min-h-0 relative flex items-center justify-center select-none overflow-hidden">
        {photo.mimeType.startsWith('video/') ? (
          <video
            key={photo.id}
            src={`/api/photos/${photo.id}/file`}
            controls
            playsInline
            preload="metadata"
            className="max-w-full max-h-full"
          />
        ) : (
          <img
            src={`/api/photos/${photo.id}/file`}
            alt={photo.filename}
            className="max-w-full max-h-full object-contain"
          />
        )}
        {hasPrev && (
          <button
            onClick={onPrev}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 hover:bg-black/80 text-2xl"
            aria-label="Previous"
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            onClick={onNext}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/50 hover:bg-black/80 text-2xl"
            aria-label="Next"
          >
            ›
          </button>
        )}
        {photo.caption && !showInfo && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 max-w-[80%] bg-black/70 backdrop-blur px-4 py-2 rounded-xl text-center text-sm">
            {photo.caption}
          </div>
        )}
      </div>

      {showInfo && (
        <>
          {/* Backdrop for mobile bottom sheet */}
          <button
            onClick={() => setShowInfo(false)}
            className="md:hidden absolute inset-0 bg-black/40 z-0"
            aria-label="정보 닫기"
          />
          <div
            className="absolute bg-neutral-950/95 backdrop-blur-xl p-4 space-y-4 overflow-auto text-sm
              md:right-0 md:top-[56px] md:bottom-0 md:w-[340px] md:border-l md:border-neutral-800
              inset-x-0 bottom-0 top-auto max-h-[70vh] rounded-t-2xl border-t border-neutral-800 z-10"
          >
            {/* Mobile drag handle */}
            <div className="md:hidden -mt-2 mb-2 flex justify-center">
              <div className="w-10 h-1 rounded-full bg-neutral-700" />
            </div>
            {/* Mobile-only delete button */}
            {isOwner && (
              <button
                onClick={onDelete}
                className="md:hidden w-full bg-red-600/20 hover:bg-red-600/30 text-red-200 rounded px-3 py-2 text-sm"
              >
                삭제
              </button>
            )}
          <section>
            <div className="text-neutral-500 mb-1">캡션</div>
            {isOwner ? (
              captionEditing ? (
                <div className="space-y-2">
                  <textarea
                    value={captionDraft}
                    onChange={(e) => setCaptionDraft(e.target.value)}
                    rows={3}
                    placeholder="캡션을 입력하세요"
                    className="w-full bg-neutral-800 rounded px-2 py-1 outline-none text-sm resize-none"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveCaption}
                      className="bg-blue-600 hover:bg-blue-500 rounded px-3 py-1 text-xs"
                    >
                      저장
                    </button>
                    <button
                      onClick={() => {
                        setCaptionDraft(photo.caption ?? '');
                        setCaptionEditing(false);
                      }}
                      className="bg-neutral-800 hover:bg-neutral-700 rounded px-3 py-1 text-xs"
                    >
                      취소
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCaptionEditing(true)}
                  className="w-full text-left bg-neutral-900 hover:bg-neutral-800 rounded p-2 min-h-[44px]"
                >
                  {photo.caption ? (
                    <span>{photo.caption}</span>
                  ) : (
                    <span className="text-neutral-500">+ 캡션 추가</span>
                  )}
                </button>
              )
            ) : photo.caption ? (
              <div className="bg-neutral-900 rounded p-2">{photo.caption}</div>
            ) : (
              <div className="text-neutral-600 text-xs">없음</div>
            )}
          </section>

          <section>
            <div className="text-neutral-500 mb-1">메타데이터</div>
            <div className="space-y-1.5 bg-neutral-900 rounded p-2">
              <Row label="파일명" value={photo.filename} break />
              <Row label="파일 크기" value={formatSize(photo.sizeBytes)} />
              {photo.width && photo.height && (
                <Row label="해상도" value={`${photo.width} × ${photo.height}`} />
              )}
              <Row label="올린 사람" value={photo.ownerName} />
              <Row label="업로드 시각" value={new Date(photo.createdAt).toLocaleString()} />
              {photo.takenAt && (
                <Row label="촬영 시각" value={new Date(photo.takenAt).toLocaleString()} />
              )}
              {(photo.cameraMake || photo.cameraModel) && (
                <Row
                  label="카메라"
                  value={[photo.cameraMake, photo.cameraModel].filter(Boolean).join(' ')}
                />
              )}
              {photo.artist && <Row label="찍은 사람" value={photo.artist} />}
              {photo.gpsLat != null && photo.gpsLng != null && (
                <div className="flex justify-between gap-2">
                  <span className="text-neutral-500 shrink-0">위치</span>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${photo.gpsLat}&mlon=${photo.gpsLng}#map=15/${photo.gpsLat}/${photo.gpsLng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-blue-400 hover:underline text-right"
                  >
                    {photo.gpsLat.toFixed(5)}, {photo.gpsLng.toFixed(5)} ↗
                  </a>
                </div>
              )}
              <Row
                label="공개 상태"
                value={
                  photo.hidden ? '가리기 (상대방에게 숨김)' : '공개'
                }
              />
              <Row label="블러" value={photo.blurred ? '켜짐' : '꺼짐'} />
            </div>
          </section>

          <section>
            <div className="text-neutral-500 mb-1">태그</div>
            <div className="flex flex-wrap gap-1 mb-2">
              {photo.tags.length === 0 && (
                <span className="text-neutral-600 text-xs">없음</span>
              )}
              {photo.tags.map((t) => (
                <span
                  key={t.id}
                  className="inline-flex items-center gap-1 bg-blue-600/30 text-blue-200 rounded-full px-2 py-0.5 text-xs"
                >
                  {t.name}
                  {isOwner && (
                    <button
                      onClick={() => removeTag(t.name)}
                      className="hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
            {isOwner && (
              <>
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addTag(tagInput);
                      setTagInput('');
                    }
                  }}
                  placeholder="태그 추가 (Enter)"
                  className="w-full bg-neutral-800 rounded px-2 py-1 outline-none text-xs"
                />
                {allTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {allTags
                      .filter((t) => !tagNames.includes(t.name))
                      .slice(0, 12)
                      .map((t) => (
                        <button
                          key={t.id}
                          onClick={() => addTag(t.name)}
                          className="bg-neutral-800 hover:bg-neutral-700 rounded-full px-2 py-0.5 text-xs"
                        >
                          + {t.name}
                        </button>
                      ))}
                  </div>
                )}
              </>
            )}
          </section>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, break: breakAll }: { label: string; value: string; break?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-neutral-500 shrink-0">{label}</span>
      <span className={'text-right ' + (breakAll ? 'break-all' : '')}>{value}</span>
    </div>
  );
}

function formatSize(n: number) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)}KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)}MB`;
  return `${(n / 1024 ** 3).toFixed(2)}GB`;
}
