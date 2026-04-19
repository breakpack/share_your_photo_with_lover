export type PhotoTag = { id: string; name: string };

export type TagSummary = { id: string; name: string; count: number };

export type GiftBoxSummary = {
  id: string;
  ownerName: string;
  createdAt: string;
  photoCount: number;
  previewPhotoIds: string[];
};

export type Photo = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  hidden: boolean;
  blurred: boolean;
  caption: string | null;
  takenAt: string | null;
  sourceCreatedAt: string | null;
  sourceModifiedAt: string | null;
  lastViewedAt: string | null;
  gpsLat: number | null;
  gpsLng: number | null;
  cameraMake: string | null;
  cameraModel: string | null;
  artist: string | null;
  ownerName: string;
  giftBoxId: string | null;
  createdAt: string;
  unseen: boolean;
  tags: PhotoTag[];
};

export type SortKey =
  | 'source-created-desc'
  | 'time-desc'
  | 'time-asc'
  | 'size-desc'
  | 'size-asc'
  | 'taken-desc';
