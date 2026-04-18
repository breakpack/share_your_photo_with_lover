export function serializePhoto(p: any) {
  return {
    id: p.id,
    filename: p.filename,
    mimeType: p.mimeType,
    sizeBytes: Number(p.sizeBytes),
    width: p.width,
    height: p.height,
    hidden: p.hidden,
    blurred: p.blurred,
    caption: p.caption,
    takenAt: p.takenAt,
    gpsLat: p.gpsLat,
    gpsLng: p.gpsLng,
    cameraMake: p.cameraMake,
    cameraModel: p.cameraModel,
    artist: p.artist,
    ownerName: p.ownerName,
    createdAt: p.createdAt,
    tags: (p.tags ?? []).map((t: any) => ({ id: t.tag.id, name: t.tag.name })),
  };
}
