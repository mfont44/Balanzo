/**
 * Tally.app – Profile (public.users) fetch and update.
 * Requires: id, full_name, avatar_url, is_pro, created_at.
 */

import type { User as AuthUser } from '@supabase/supabase-js';
import { decode } from 'base64-arraybuffer';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { EncodingType, getInfoAsync, readAsStringAsync } from 'expo-file-system/legacy';
import type { User } from '@/types/database';
import { supabase } from './supabase';

const AVATAR_BUCKET = 'avatars';
const GIF_MAX_BYTES = 500_000;
/** Target max size for compressed JPEG avatars (bytes). */
const JPEG_TARGET_MAX_BYTES = 100_000;
// Set to true temporarily if you need to debug avatar upload/remove issues.
const AVATAR_DEBUG = false;

export const AVATAR_UPLOAD_ERROR_CODE = {
  GIF_TOO_LARGE: 'GIF_TOO_LARGE',
} as const;

function isGifSource(uri: string, mimeType?: string | null): boolean {
  if (mimeType === 'image/gif') return true;
  const u = uri.toLowerCase();
  return u.endsWith('.gif') || /\.gif(\?|#|$)/.test(u);
}

/** Path inside the bucket from a public object URL, or null if not from this bucket. */
export function extractAvatarStoragePathFromPublicUrl(
  publicUrl: string | null | undefined,
  bucket: string = AVATAR_BUCKET
): string | null {
  if (!publicUrl?.trim()) return null;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const i = publicUrl.indexOf(marker);
  if (i === -1) return null;
  const rawPath = publicUrl.slice(i + marker.length).split(/[?#]/)[0] ?? '';
  try {
    return decodeURIComponent(rawPath);
  } catch {
    return rawPath;
  }
}

/**
 * Object key for `storage.from('avatars').remove([key])`: last URL segment, query stripped.
 * Matches app uploads at bucket root: `avatar_<userId>_<timestamp>.<ext>`.
 */
export function extractAvatarObjectKeyFromPublicUrl(publicUrl: string | null | undefined): string | null {
  if (!publicUrl?.trim()) return null;
  const withoutQuery = publicUrl.trim().split(/[?#]/)[0] ?? '';
  const last = withoutQuery.split('/').filter(Boolean).pop();
  if (!last) return null;
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

/**
 * Resolves the storage object key for `remove([key])`: full public URLs, or raw keys like `file.jpg` / `avatars/file.jpg`.
 */
export function resolveAvatarStorageObjectKeyForRemove(
  raw: string | null | undefined,
  bucket: string = AVATAR_BUCKET
): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const strippedQuery = s.split(/[?#]/)[0] ?? '';

  // Most robust path: Supabase public URLs look like:
  // https://<project>.supabase.co/storage/v1/object/public/avatars/<objectKey>?t=123
  // We want <objectKey> (relative to bucket root) for storage.remove([<objectKey>]).
  const publicMarker = `/public/${bucket}/`;
  if (strippedQuery.includes(publicMarker)) {
    const parts = strippedQuery.split(publicMarker);
    const afterMarker = parts[1]; // everything after `/public/<bucket>/`
    if (afterMarker) {
      const candidate = afterMarker.replace(/^\/+/, '');
      try {
        return decodeURIComponent(candidate);
      } catch {
        return candidate;
      }
    }
  }

  // Fallback to older helper (handles `/storage/v1/object/public/<bucket>/...`).
  const fromPublic = extractAvatarStoragePathFromPublicUrl(strippedQuery, bucket);
  if (fromPublic) return fromPublic;

  // Raw key handling: allow `avatar_<...>.jpg` or `avatars/avatar_<...>.jpg`
  const noLead = strippedQuery.replace(/^\/+/, '');
  if (noLead.startsWith(`${bucket}/`)) {
    return noLead.slice(bucket.length + 1) || null;
  }
  return noLead || null;
}

async function removeStoredAvatarObject(objectKey: string): Promise<{ data: unknown; error: Error | null }> {
  try {
    const fileName = objectKey;
    const { data: removeData, error: removeError } = await supabase.storage.from('avatars').remove([fileName]);
    if (removeError) {
      if (AVATAR_DEBUG) console.error("[Tally] CRITICAL REMOVE ERROR:", removeError);
      return { data: removeData, error: new Error(removeError.message) };
    }
    return { data: removeData, error: null };
  } catch (e) {
    if (AVATAR_DEBUG) console.error('[Tally] CRITICAL: FAILED to delete old file from storage!', e);
    return { data: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/**
 * Opens the library to pick an avatar. `allowsEditing: false` and `quality: 1` are required so
 * animated GIFs stay intact on Android (expo-image-picker).
 */
export async function pickAvatarFromLibrary(): Promise<{
  uri: string;
  mimeType?: string | null;
} | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== 'granted') return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: false,
    aspect: [1, 1],
    quality: 1,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, mimeType: asset.mimeType };
}

/**
 * Compresses JPEG/PNG locally (target ≤100KB via extra passes if needed); GIFs skip manipulation
 * and must be ≤500KB. Removes the previous `avatars` object (if any) before uploading the new file.
 */
export async function uploadAvatar(
  userId: string,
  imageUri: string,
  oldAvatarUrl?: string | null,
  mimeTypeHint?: string | null
): Promise<{ avatar_url: string; error: null } | { avatar_url: null; error: Error }> {
  const isGif = isGifSource(imageUri, mimeTypeHint);
  let contentType: string;
  let uploadBody: ArrayBuffer;
  let fileExt: string;

  try {
    if (isGif) {
      const info = await getInfoAsync(imageUri);
      if (!info.exists || info.isDirectory) {
        if (AVATAR_DEBUG) console.error('[Tally] uploadAvatar GIF: file missing or directory', { imageUri, info });
        return { avatar_url: null, error: new Error('Avatar file not found') };
      }
      if (info.size > GIF_MAX_BYTES) {
        if (AVATAR_DEBUG) console.error('[Tally] uploadAvatar GIF: over 500KB', { size: info.size });
        return {
          avatar_url: null,
          error: new Error(AVATAR_UPLOAD_ERROR_CODE.GIF_TOO_LARGE),
        };
      }
      const base64 = await readAsStringAsync(imageUri, { encoding: EncodingType.Base64 });
      uploadBody = decode(base64);
      contentType = 'image/gif';
      fileExt = 'gif';
      if (AVATAR_DEBUG) {
        console.log('[Tally] uploadAvatar GIF: ready', {
          contentType,
          byteLength: uploadBody.byteLength,
        });
      }
    } else {
      const attempts: { width: number; compress: number }[] = [
        { width: 400, compress: 0.3 },
        { width: 480, compress: 0.28 },
        { width: 400, compress: 0.18 },
      ];
      let manipulated!: Awaited<ReturnType<typeof ImageManipulator.manipulateAsync>>;
      for (const opts of attempts) {
        manipulated = await ImageManipulator.manipulateAsync(
          imageUri,
          [{ resize: { width: opts.width } }],
          { compress: opts.compress, format: ImageManipulator.SaveFormat.JPEG }
        );
        const info = await getInfoAsync(manipulated.uri);
        if (info.exists && !info.isDirectory && info.size <= JPEG_TARGET_MAX_BYTES) {
          break;
        }
      }
      const base64 = await readAsStringAsync(manipulated.uri, { encoding: EncodingType.Base64 });
      uploadBody = decode(base64);
      contentType = 'image/jpeg';
      fileExt = 'jpg';
      if (AVATAR_DEBUG) {
        console.log('[Tally] uploadAvatar JPEG: ready', {
          contentType,
          byteLength: uploadBody.byteLength,
        });
      }
    }
  } catch (e) {
    if (AVATAR_DEBUG) console.error('[Tally] uploadAvatar: compression/read failed', e);
    return {
      avatar_url: null,
      error: e instanceof Error ? e : new Error(String(e)),
    };
  }

  const objectPath = `avatar_${userId}_${Date.now()}.${fileExt}`;

  const oldObjectKey = resolveAvatarStorageObjectKeyForRemove(oldAvatarUrl);
  if (oldObjectKey && oldObjectKey !== objectPath) {
    await removeStoredAvatarObject(oldObjectKey);
  }

  /** React Native + Supabase: `Uint8Array` is more reliable than raw `ArrayBuffer` for uploads. */
  const uploadPayload = new Uint8Array(uploadBody);

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(objectPath, uploadPayload, {
      contentType,
      upsert: false,
    });

  if (uploadError) {
    if (AVATAR_DEBUG)
      console.error('[Tally] uploadAvatar: storage.upload error', uploadError, {
      objectPath,
      contentType,
      byteLength: uploadPayload.byteLength,
      message: uploadError.message,
    });
    return { avatar_url: null, error: new Error(uploadError.message) };
  }
  if (AVATAR_DEBUG) {
    console.log('[Tally] uploadAvatar: storage.upload ok', { objectPath, uploadData, contentType });
  }

  const { data: publicData } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(objectPath);
  const publicUrl = publicData.publicUrl;

  const { data: updatedRow, error: updateError } = await supabase
    .from('users')
    .update({ avatar_url: publicUrl })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    if (AVATAR_DEBUG)
      console.error('[Tally] uploadAvatar: DB update error', updateError, {
      userId,
      message: updateError.message,
      details: updateError.details,
      hint: updateError.hint,
      code: updateError.code,
    });
    await supabase.storage.from(AVATAR_BUCKET).remove([objectPath]);
    return { avatar_url: null, error: new Error(updateError.message) };
  }
  if (!updatedRow) {
    if (AVATAR_DEBUG) console.error('[Tally] uploadAvatar: DB update matched 0 rows', { userId, publicUrl });
    await supabase.storage.from(AVATAR_BUCKET).remove([objectPath]);
    return {
      avatar_url: null,
      error: new Error('No profile row updated; check users table and RLS.'),
    };
  }

  return { avatar_url: publicUrl, error: null };
}

/**
 * Deletes the current avatar object from `avatars` (when URL maps to our bucket) and clears `users.avatar_url`.
 */
export async function removeAvatar(
  userId: string,
  oldAvatarUrl: string
): Promise<{ error: Error | null }> {
  const trimmed = oldAvatarUrl.trim();
  if (!trimmed) {
    const { data, error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: null })
      .eq('id', userId)
      .select('id')
      .maybeSingle();
    if (updateError) {
      if (AVATAR_DEBUG) console.error('[Tally] removeAvatar: DB update (empty url) error', updateError);
      return { error: new Error(updateError.message) };
    }
    if (!data) {
      if (AVATAR_DEBUG) console.error('[Tally] removeAvatar: DB update matched 0 rows', { userId });
    }
    return { error: null };
  }

  const oldObjectKey = resolveAvatarStorageObjectKeyForRemove(trimmed);
  if (oldObjectKey) {
    const { error: removeErr } = await removeStoredAvatarObject(oldObjectKey);
    if (removeErr) {
      return { error: removeErr };
    }
  }

  const { data: updatedRow, error: updateError } = await supabase
    .from('users')
    .update({ avatar_url: null })
    .eq('id', userId)
    .select('id')
    .maybeSingle();

  if (updateError) {
    if (AVATAR_DEBUG) console.error('[Tally] removeAvatar: DB update error', updateError);
    return { error: new Error(updateError.message) };
  }
  if (!updatedRow) {
    if (AVATAR_DEBUG) console.error('[Tally] removeAvatar: DB update matched 0 rows', { userId });
  }

  return { error: null };
}

export type ProfileRow = User;

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data as ProfileRow;
}

/**
 * Ensures a row exists in public.users for the authenticated user (id = auth.users.id).
 * expense_splits / FKs reference public.users, while group_members may only reference auth until sync.
 * Inserts a minimal row if missing; does not overwrite existing profiles.
 * Prefer empty full_name so isProfileComplete() stays false until onboarding.
 */
export async function ensurePublicUserFromAuthUser(authUser: AuthUser): Promise<{ error: Error | null }> {
  const { data: existing, error: selErr } = await supabase
    .from('users')
    .select('id')
    .eq('id', authUser.id)
    .maybeSingle();
  if (selErr) {
    if (AVATAR_DEBUG) console.error('[Tally] ensurePublicUserFromAuthUser select error:', selErr);
    return { error: new Error(selErr.message) };
  }
  if (existing) return { error: null };

  const meta = authUser.user_metadata as Record<string, unknown> | undefined;
  const fromMeta =
    (typeof meta?.full_name === 'string' && meta.full_name.trim()) ||
    (typeof meta?.name === 'string' && meta.name.trim()) ||
    '';
  const full_name = fromMeta || '';

  const row = {
    id: authUser.id,
    full_name,
    avatar_url: '',
    is_pro: false,
  };

  const { error } = await supabase.from('users').insert(row);
  if (error) {
    if (error.code === '23505') return { error: null };
    if (AVATAR_DEBUG) console.error('[Tally] ensurePublicUserFromAuthUser insert error:', error);
    return { error: new Error(error.message) };
  }
  return { error: null };
}

/** Comprova si un nom d'usuari està lliure (no l'usa un altre). currentUserId = qui el vol; si el troba i és el mateix usuari, és disponible. */
export async function checkUsernameAvailable(
  username: string,
  currentUserId: string
): Promise<{ available: boolean; errorMessage?: string }> {
  const value = username.trim();
  if (!value) return { available: false, errorMessage: 'Introdueix un nom d\'usuari.' };
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('username', value)
    .limit(1)
    .maybeSingle();
  if (error) return { available: false, errorMessage: 'No s\'ha pogut comprovar. Torna-ho a provar.' };
  if (data && data.id !== currentUserId) return { available: false, errorMessage: 'Aquest nom d\'usuari ja existeix.' };
  return { available: true };
}

export type UpdateProfilePayload = {
  username?: string | null;
  /** ISO timestamp when username was changed (15-day cooldown). */
  last_username_change?: string | null;
  full_name?: string;
  /** DB column: has_completed_tutorial */
  has_completed_tutorial?: boolean | null;
};

export async function updateProfile(
  userId: string,
  payload: UpdateProfilePayload
): Promise<{ error: Error | null }> {
  const row: Record<string, unknown> = {};
  if (payload.username !== undefined) row.username = payload.username ?? null;
  if (payload.last_username_change !== undefined) row.last_username_change = payload.last_username_change ?? null;
  if (payload.full_name !== undefined) row.full_name = payload.full_name;
  if (payload.has_completed_tutorial !== undefined) row.has_completed_tutorial = payload.has_completed_tutorial ?? null;
  const { error } = await supabase.from('users').update(row).eq('id', userId);
  return { error: error ? new Error(error.message) : null };
}

/** True if profile is complete.
 * Essentials only: full_name + username.
 */
export function isProfileComplete(profile: ProfileRow | null): boolean {
  if (!profile) return false;
  const name = (profile.full_name ?? '').trim();
  if (name.length === 0) return false;
  const username = (profile as { username?: string | null }).username ?? null;
  return Boolean(username && username.trim());
}

export interface ProfileStats {
  groupsCount: number;
  expensesCount: number;
  friendsCount: number;
}

/** Stats for profile page: groups, total expenses, other members (friends). */
export async function getProfileStats(userId: string): Promise<ProfileStats> {
  const { data: memberships } = await supabase
    .from('group_members')
    .select('group_id')
    .eq('user_id', userId);
  const groupIds = (memberships ?? []).map((m) => (m as { group_id: string }).group_id);
  if (groupIds.length === 0) {
    return { groupsCount: 0, expensesCount: 0, friendsCount: 0 };
  }

  const [{ count: expensesCount }, { data: allMembers }] = await Promise.all([
    supabase.from('expenses').select('*', { count: 'exact', head: true }).in('group_id', groupIds),
    supabase.from('group_members').select('user_id').in('group_id', groupIds),
  ]);

  const uniqueUserIds = new Set((allMembers ?? []).map((m) => (m as { user_id: string }).user_id));
  uniqueUserIds.delete(userId);
  return {
    groupsCount: groupIds.length,
    expensesCount: expensesCount ?? 0,
    friendsCount: uniqueUserIds.size,
  };
}
