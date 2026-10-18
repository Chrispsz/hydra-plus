// Values are persisted in LevelDB and come from the catalogue, so the
// remaining members keep their original numeric values.
export enum Downloader {
  Torrent = 1,
  Gofile = 2,
  PixelDrain = 3,
  Datanodes = 4,
  Mediafire = 5,
  Hydra = 7,
  FuckingFast = 9,
  Rootz = 11,
  ArchiveOrg = 14,
}

export enum AuthPage {
  SignIn = "/",
}

export enum DownloadSourceStatus {
  PendingMatching = "PENDING_MATCHING",
  Matched = "MATCHED",
  Matching = "MATCHING",
  Failed = "FAILED",
}

export enum CatalogueCategory {
  Hot = "hot",
  Weekly = "weekly",
}

export enum SteamContentDescriptor {
  SomeNudityOrSexualContent = 1,
  FrequenceViolenceOrGore = 2,
  AdultOnlySexualContent = 3,
  FrequentNudityOrSexualContent = 4,
  GeneralMatureContent = 5,
}

export enum Cracker {
  codex = "CODEX",
  rune = "RUNE",
  onlineFix = "OnlineFix",
  goldberg = "Goldberg",
  userstats = "user_stats",
  Steam = "Steam",
  rld = "RLD!",
  empress = "EMPRESS",
  skidrow = "SKIDROW",
  creamAPI = "CreamAPI",
  smartSteamEmu = "SmartSteamEmu",
  _3dm = "3dm",
  flt = "FLT",
  rle = "RLE",
  razor1911 = "RAZOR1911",
  ali213 = "ALI213",
}

export enum DownloadError {
  GofileQuotaExceeded = "download_error_gofile_quota_exceeded",
  NotCachedOnHydra = "download_error_not_cached_on_hydra",
  HosterUnlockLoginRequired = "download_error_hoster_unlock_login_required",
  HosterUnlockFileNotFound = "download_error_hoster_unlock_file_not_found",
  HosterUnlockUnavailable = "download_error_hoster_unlock_unavailable",
  DownloadLinkReturnedWebPage = "download_error_link_returned_web_page",
  InvalidMagnet = "download_error_invalid_magnet",
  TorrentMetadataTimeout = "download_error_torrent_metadata_timeout",
  TorrentMetadataIncomplete = "download_error_torrent_metadata_incomplete",
  TorrentNoFilesSelected = "download_error_torrent_no_files_selected",
  TorrentInvalidFileSelection = "download_error_torrent_invalid_file_selection",
  TorrentTooManyFiles = "download_error_torrent_too_many_files",
  TorrentFilesUnavailable = "download_error_torrent_files_unavailable",
  TorrentInvalidTrackers = "download_error_torrent_invalid_trackers",
  ArchiveOrgInvalidFileUrl = "download_error_archive_org_invalid_file_url",
  NetworkUnreachable = "download_error_network_unreachable",
  NetworkCertificateRejected = "download_error_network_certificate_rejected",
}

export const MINIMUM_FREE_DISK_SPACE_BYTES = 512 * 1024 * 1024;

export const FILE_EXTENSIONS_TO_EXTRACT = [".rar", ".zip", ".7z"];

export const WINDOWS_GAME_EXECUTABLE_EXTENSIONS = ["exe", "lnk", "bat", "cmd"];

export const LINUX_GAME_EXECUTABLE_EXTENSIONS = [
  ...WINDOWS_GAME_EXECUTABLE_EXTENSIONS,
  "AppImage",
  "sh",
  "x86_64",
  "x86",
  "run",
  "bin",
];

export const DARWIN_GAME_EXECUTABLE_EXTENSIONS = ["app"];

export const getGameExecutableFilters = (
  platform: string,
  labels: { executable: string; allFiles: string }
) => {
  if (platform === "linux") {
    return [
      { name: labels.executable, extensions: LINUX_GAME_EXECUTABLE_EXTENSIONS },
      { name: labels.allFiles, extensions: ["*"] },
    ];
  }

  if (platform === "darwin") {
    return [
      {
        name: labels.executable,
        extensions: DARWIN_GAME_EXECUTABLE_EXTENSIONS,
      },
    ];
  }

  return [
    { name: labels.executable, extensions: WINDOWS_GAME_EXECUTABLE_EXTENSIONS },
  ];
};

export const GAMEMODE_SITE_URL = "https://github.com/FeralInteractive/gamemode";
export const MANGOHUD_SITE_URL = "https://github.com/flightlessmango/MangoHud";
