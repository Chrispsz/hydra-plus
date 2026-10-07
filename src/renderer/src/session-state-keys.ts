export const SETTINGS_CATEGORY_STORAGE_KEY = "settings-category";

export const LIBRARY_PLATFORMS_STORAGE_KEY = "library-platforms";
export const LIBRARY_SOURCES_STORAGE_KEY = "library-sources";
export const LIBRARY_INSTALLED_ONLY_STORAGE_KEY = "library-installed-only";
export const SIDEBAR_SOURCES_STORAGE_KEY = "sidebar-sources";
export const SIDEBAR_PLAYABLE_ONLY_STORAGE_KEY = "sidebar-playable-only";

export const SESSION_SCOPED_KEY_PREFIXES: string[] = [];

const ALWAYS_SESSION_SCOPED_KEYS = [
  SETTINGS_CATEGORY_STORAGE_KEY,
  "library-view-mode",
];

const FILTER_SESSION_SCOPED_KEYS = [
  "library-sort-by",
  "library-category",
  "library-collection",
  LIBRARY_PLATFORMS_STORAGE_KEY,
  LIBRARY_SOURCES_STORAGE_KEY,
  LIBRARY_INSTALLED_ONLY_STORAGE_KEY,
  "sidebar-category",
  "sidebar-sort-by",
  "sidebar-favorites-first",
  SIDEBAR_SOURCES_STORAGE_KEY,
  SIDEBAR_PLAYABLE_ONLY_STORAGE_KEY,
  "profile-sort-by",
  "profile-platform",
  "profile-souvenir-sort-by",
  "profile-souvenir-grouping",
];

export const getSessionScopedKeysToClear = (
  persistFiltersAndSorting: boolean
): string[] =>
  persistFiltersAndSorting
    ? [...ALWAYS_SESSION_SCOPED_KEYS]
    : [...ALWAYS_SESSION_SCOPED_KEYS, ...FILTER_SESSION_SCOPED_KEYS];
