import type { GameShop } from "@types";
import { isCloudSaveV2Eligible } from "../../../../shared/cloud-save-v2-eligibility.js";

export type CloudSaveUiMode = "legacy" | "v2";
export type LegacyCloudSavePurpose = "active" | "archive";

export interface CloudSaveSettingsVisibility {
  showV2: boolean;
  showLegacy: boolean;
  legacyPurpose: LegacyCloudSavePurpose;
}

export interface CloudSaveVisibility {
  hero: CloudSaveUiMode | null;
  settings: CloudSaveSettingsVisibility;
}

export const isLegacyCloudSaveSettingsAvailable = (
  settings: CloudSaveSettingsVisibility,
  hasActiveSubscription: boolean,
  artifactCount: number
): boolean =>
  settings.showLegacy &&
  (settings.legacyPurpose === "active" ||
    (hasActiveSubscription && artifactCount > 0));

export const getCloudSaveVisibility = (
  shop: GameShop,
  platform?: string | null
): CloudSaveVisibility => {
  if (isCloudSaveV2Eligible(shop, platform)) {
    return {
      hero: "v2",
      settings: {
        showV2: true,
        showLegacy: true,
        legacyPurpose: "archive",
      },
    };
  }

  return {
    hero: null,
    settings: {
      showV2: false,
      showLegacy: true,
      legacyPurpose: "active",
    },
  };
};
