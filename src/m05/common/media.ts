import type {
  MediaPort,
  MediaAccessInput,
} from "../../../contracts/shared_types.js";
export async function withMedia<T>(
  value: T,
  media: MediaPort | undefined,
  actorId: string | null = null,
): Promise<T> {
  if (!media || !value || typeof value !== "object") return value;
  if (Array.isArray(value))
    return (await Promise.all(
      value.map((v) => withMedia(v, media, actorId)),
    )) as T;
  const v = { ...value } as Record<string, any>;
  if (v.items) v.items = await withMedia(v.items, media, actorId);
  for (const [key, url, purpose] of [
    ["coverAssetId", "coverUrl", "activity_cover"],
    ["imageAssetId", "imageUrl", "reward_image"],
  ])
    if (v[key]) {
      const r = await media.createReadUrl({
        assetId: v[key],
        purpose,
        actorUserId: actorId,
        access: actorId ? "admin_material" : "public_display",
      } as MediaAccessInput);
      v[url] = r.readUrl;
      v[url + "ExpiresAt"] = r.readUrlExpiresAt;
    }
  return v as T;
}
