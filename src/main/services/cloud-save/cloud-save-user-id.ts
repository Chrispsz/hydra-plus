/**
 * Hydra Plus has no Hydra account. Cloud save is bound to this machine with a
 * stable local user id, which keeps the LevelDB key shapes (sync anchors,
 * pending deletions, custom paths) predictable without any sign-in.
 */
export const CLOUD_SAVE_LOCAL_USER_ID = "local";

export const getCurrentCloudSaveUserId = async (): Promise<string> =>
  CLOUD_SAVE_LOCAL_USER_ID;
