import type { GameShop } from "@types";
import { isCloudSaveV2Eligible } from "../../../../shared/cloud-save-v2-eligibility.js";

export type CloudSaveUiMode = "v2";

export interface CloudSaveSettingsVisibility {
  showV2: boolean;
}

export interface CloudSaveVisibility {
  hero: CloudSaveUiMode | null;
  settings: CloudSaveSettingsVisibility;
}

/**
 * Hydra Plus is Drive-only: the v2 engine is the only cloud save UI.
 * Steam and custom (manually imported) games are both eligible.
 */
export const getCloudSaveVisibility = (
  shop: GameShop,
  platform?: string | null
): CloudSaveVisibility => {
  if (isCloudSaveV2Eligible(shop, platform)) {
    return {
      hero: "v2",
      settings: {
        showV2: true,
      },
    };
  }

  return {
    hero: null,
    settings: {
      showV2: false,
    },
  };
};
