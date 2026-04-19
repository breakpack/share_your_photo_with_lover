export function serializePhoto(p: any) {
  return {
    id: p.id,
    filename: p.filename,
    mimeType: p.mimeType,
    sizeBytes: Number(p.sizeBytes),
    width: p.width,
    height: p.height,
    hidden: p.hidden,
    // Hidden mode enforces blur regardless of blurred flag.
    blurred: Boolean(p.hidden || p.blurred),
    caption: p.caption,
    takenAt: p.takenAt,
    sourceCreatedAt: p.sourceCreatedAt ?? null,
    sourceModifiedAt: p.sourceModifiedAt ?? null,
    lastViewedAt: p.lastViewedAt ?? null,
    gpsLat: p.gpsLat,
    gpsLng: p.gpsLng,
    cameraMake: p.cameraMake,
    cameraModel: p.cameraModel,
    artist: p.artist,
    ownerName: p.ownerName,
    createdAt: p.createdAt,
    unseen: Boolean(p.unseen),
    tags: (p.tags ?? []).map((t: any) => ({ id: t.tag.id, name: t.tag.name })),
  };
}
