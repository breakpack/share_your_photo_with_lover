'use client';

import { useMemo, useState } from 'react';
import type { TagSummary, SortKey } from '@/lib/types';

type Props = {
  currentUser: string;
  tags: TagSummary[];
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
  excludedTags: string[];
  onExcludedTagsChange: (tags: string[]) => void;
  onResetTagFilters: () => void;
  selectionMode: boolean;
  selectedPhotoCount: number;
  bulkBusy: boolean;
  onToggleSelectionMode: () => void;
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  columns: number;
  onColumnsChange: (n: number) => void;
  refreshing: boolean;
  onRefreshClick: () => void;
  onUploadClick: () => void;
  onLogout: () => void;
};

const MIN_COLS = 1;
const MAX_COLS = 12;
const DEFAULT_EXCLUDED_TAG = '중복파일';

type TagMode = 'none' | 'include' | 'exclude';

export default function Toolbar({
  currentUser,
  tags,
  selectedTags,
  onSelectedTagsChange,
  excludedTags,
  onExcludedTagsChange,
  onResetTagFilters,
  selectionMode,
  selectedPhotoCount,
  bulkBusy,
  onToggleSelectionMode,
  sort,
  onSortChange,
  columns,
  onColumnsChange,
  refreshing,
  onRefreshClick,
  onUploadClick,
  onLogout,
}: Props) {
  const [filterOpen, setFilterOpen] = useState(false);

  const dec = () => onColumnsChange(Math.max(MIN_COLS, columns - 1));
  const inc = () => onColumnsChange(Math.min(MAX_COLS, columns + 1));

  const selectedTagSet = useMemo(() => new Set(selectedTags), [selectedTags]);
  const excludedTagSet = useMemo(() => new Set(excludedTags), [excludedTags]);

  const onlyDefaultExclude =
    selectedTags.length === 0 &&
    excludedTags.length === 1 &&
    excludedTags[0] === DEFAULT_EXCLUDED_TAG;
  const activeFilterCount = onlyDefaultExclude ? 0 : selectedTags.length + excludedTags.length;

  function modeOf(name: string): TagMode {
    if (selectedTagSet.has(name)) return 'include';
    if (excludedTagSet.has(name)) return 'exclude';
    return 'none';
  }

  function toggleTagMode(name: string) {
    const mode = modeOf(name);
    if (mode === 'none') {
      onSelectedTagsChange(uniq([...selectedTags, name]));
      onExcludedTagsChange(excludedTags.filter((t) => t !== name));
      return;
    }
    if (mode === 'include') {
      onSelectedTagsChange(selectedTags.filter((t) => t !== name));
      onExcludedTagsChange(uniq([...excludedTags, name]));
      return;
    }
    onExcludedTagsChange(excludedTags.filter((t) => t !== name));
  }

  return (
    <header className="fixed top-0 inset-x-0 bg-black/70 backdrop-blur-xl border-b border-neutral-800 z-30">
      <div className="h-14 flex items-center px-3 gap-2">
        <div className="font-semibold text-base sm:text-lg shrink-0">
          <span className="sm:hidden">PS</span>
          <span className="hidden sm:inline">PhotoShare</span>
        </div>

        {/* Desktop: inline tri-state tag chips (none -> include -> exclude -> none) */}
        <div className="hidden md:flex gap-1 items-center flex-1 min-w-0 overflow-x-auto no-scrollbar pl-2 ml-2 border-l border-neutral-800">
          {tags.map((t) => {
            const mode = modeOf(t.name);
            return (
              <button
                key={t.id}
                onClick={() => toggleTagMode(t.name)}
                className={
                  'px-2.5 py-1 rounded-full text-xs transition shrink-0 ' +
                  (mode === 'include'
                    ? 'bg-white text-black'
                    : mode === 'exclude'
                      ? 'bg-red-500/25 text-red-100 border border-red-400/40'
                      : 'bg-neutral-800 hover:bg-neutral-700 text-neutral-200')
                }
                title={
                  mode === 'include'
                    ? '포함 필터'
                    : mode === 'exclude'
                      ? '제외 필터'
                      : '필터 없음'
                }
              >
                {mode === 'include' ? '+' : mode === 'exclude' ? '−' : ''}
                {mode === 'include' || mode === 'exclude' ? ' ' : ''}
                {t.name}
                <span className="ml-1 opacity-60">{t.count}</span>
              </button>
            );
          })}
          {(activeFilterCount > 0 || !onlyDefaultExclude) && (
            <button
              onClick={onResetTagFilters}
              className="text-xs text-neutral-400 hover:text-white px-2 shrink-0"
            >
              필터 초기화
            </button>
          )}
        </div>

        {/* Mobile: filter button with badge */}
        <button
          onClick={() => setFilterOpen((v) => !v)}
          className={
            'md:hidden ml-auto shrink-0 rounded-lg px-2.5 py-1.5 text-sm flex items-center gap-1 ' +
            (filterOpen || activeFilterCount > 0
              ? 'bg-white text-black'
              : 'bg-neutral-800 text-neutral-200')
          }
          aria-label="필터"
        >
          필터
          {activeFilterCount > 0 && (
            <span
              className={
                'rounded-full text-[10px] px-1.5 py-0.5 ' +
                (filterOpen ? 'bg-black text-white' : 'bg-blue-500 text-white')
              }
            >
              {activeFilterCount}
            </span>
          )}
        </button>

        <div className="hidden md:block flex-1" />

        <div className="hidden sm:flex items-center bg-neutral-800 rounded-lg shrink-0 overflow-hidden">
          <button
            onClick={dec}
            disabled={columns <= MIN_COLS}
            className="w-8 h-8 flex items-center justify-center hover:bg-neutral-700 disabled:opacity-30 text-lg"
            aria-label="열 수 감소 (사진 크게)"
            title="열 수 감소 (사진 크게)"
          >
            −
          </button>
          <div className="min-w-[24px] text-center text-xs text-neutral-300 tabular-nums">
            {columns}
          </div>
          <button
            onClick={inc}
            disabled={columns >= MAX_COLS}
            className="w-8 h-8 flex items-center justify-center hover:bg-neutral-700 disabled:opacity-30 text-lg"
            aria-label="열 수 증가 (사진 작게)"
            title="열 수 증가 (사진 작게)"
          >
            +
          </button>
        </div>

        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as SortKey)}
          className="bg-neutral-800 rounded-lg px-2 py-1.5 text-xs sm:text-sm outline-none shrink-0 w-[128px] sm:w-auto"
        >
          <option value="source-created-desc">원본생성시각</option>
          <option value="time-desc">최신순</option>
          <option value="time-asc">오래된순</option>
          <option value="size-desc">큰 크기순</option>
          <option value="size-asc">작은 크기순</option>
        </select>

        <button
          onClick={onToggleSelectionMode}
          disabled={bulkBusy}
          className={
            'bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm shrink-0 ' +
            (selectionMode ? 'ring-1 ring-blue-400 text-blue-200' : '')
          }
          aria-label={selectionMode ? '선택 모드 종료' : '선택 모드 시작'}
          title={selectionMode ? '선택 모드 종료' : '선택 모드 시작'}
        >
          {selectionMode ? `선택중 ${selectedPhotoCount}` : '선택'}
        </button>

        <button
          onClick={onRefreshClick}
          disabled={refreshing}
          className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 rounded-lg px-2.5 sm:px-3 py-1.5 text-xs sm:text-sm shrink-0"
          aria-label="새로고침"
          title="새로고침"
        >
          <span className={'inline-block ' + (refreshing ? 'animate-spin' : '')}>
            ↻
          </span>
          <span className="hidden sm:inline ml-1">새로고침</span>
        </button>

        <button
          onClick={onUploadClick}
          className="bg-blue-600 hover:bg-blue-500 rounded-lg px-3 py-1.5 text-sm font-medium shrink-0"
          aria-label="업로드"
        >
          <span className="hidden sm:inline">+ 업로드</span>
          <span className="sm:hidden">+</span>
        </button>

        <div className="hidden sm:flex items-center gap-2 shrink-0 pl-2 border-l border-neutral-800">
          <span className="text-sm text-neutral-300">{currentUser}</span>
          <button
            onClick={onLogout}
            className="text-xs text-neutral-400 hover:text-white"
          >
            로그아웃
          </button>
        </div>
        <button
          onClick={onLogout}
          className="sm:hidden bg-neutral-800 hover:bg-neutral-700 rounded-lg px-2 py-1.5 text-[11px] text-neutral-100 shrink-0"
          title={`${currentUser} 로그아웃`}
          aria-label="로그아웃"
        >
          로그아웃
        </button>
      </div>

      {/* Mobile filter drawer */}
      {filterOpen && (
        <div className="md:hidden border-t border-neutral-800 p-3 max-h-[50vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-3 pb-2 border-b border-neutral-800">
            <span className="text-sm text-neutral-300">{currentUser}</span>
            <button
              onClick={onLogout}
              className="bg-neutral-800 hover:bg-neutral-700 rounded px-2.5 py-1 text-xs text-neutral-100"
            >
              로그아웃
            </button>
          </div>
          <div className="text-[11px] text-neutral-500 mb-2">
            기본값: 중복파일 태그는 제외 상태로 시작합니다.
          </div>
          {tags.length === 0 ? (
            <div className="text-sm text-neutral-500">태그가 없습니다.</div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-neutral-400">
                  태그 필터 (탭할 때마다 없음 → 포함 → 제외 순환)
                </span>
                <button
                  onClick={onResetTagFilters}
                  className="text-xs text-neutral-400 hover:text-white"
                >
                  필터 초기화
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => {
                  const mode = modeOf(t.name);
                  return (
                    <button
                      key={t.id}
                      onClick={() => toggleTagMode(t.name)}
                      className={
                        'px-3 py-1.5 rounded-full text-sm transition ' +
                        (mode === 'include'
                          ? 'bg-white text-black'
                          : mode === 'exclude'
                            ? 'bg-red-500/25 text-red-100 border border-red-400/40'
                            : 'bg-neutral-800 text-neutral-200')
                      }
                    >
                      {mode === 'include' ? '+' : mode === 'exclude' ? '−' : ''}
                      {mode === 'include' || mode === 'exclude' ? ' ' : ''}
                      {t.name}
                      <span className="ml-1 opacity-60 text-xs">{t.count}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </header>
  );
}

function uniq(values: string[]) {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}
