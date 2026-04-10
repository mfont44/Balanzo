export { supabase } from './supabase';
export { fetchGroups, createGroup } from './groups';
export {
  getProfile,
  updateProfile,
  isProfileComplete,
  getProfileStats,
  ensurePublicUserFromAuthUser,
  uploadAvatar,
  removeAvatar,
  pickAvatarFromLibrary,
  extractAvatarStoragePathFromPublicUrl,
  extractAvatarObjectKeyFromPublicUrl,
  resolveAvatarStorageObjectKeyForRemove,
  AVATAR_UPLOAD_ERROR_CODE,
} from './profile';
export type { ProfileRow, UpdateProfilePayload, ProfileStats } from './profile';
