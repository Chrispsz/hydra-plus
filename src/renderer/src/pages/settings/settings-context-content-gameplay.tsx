import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useAppSelector } from "@renderer/hooks";
import type { UserPreferences } from "@types";

import "./settings-behavior.scss";

const buildForm = (preferences: UserPreferences | null) => ({
  autoplayGameTrailers: preferences?.autoplayGameTrailers ?? true,
  disableNsfwAlert: preferences?.disableNsfwAlert ?? false,
  enableNewDownloadOptionsBadges:
    preferences?.enableNewDownloadOptionsBadges ?? true,
  hideClassicsBookmark: preferences?.hideClassicsBookmark ?? false,
  classicsUseHeroLayout: preferences?.classicsUseHeroLayout ?? false,
  hideLibraryGameBadges: preferences?.hideLibraryGameBadges ?? false,
  hideLibraryReadySizeBadges: preferences?.hideLibraryReadySizeBadges ?? false,
  hideLibraryClassicsBadges: preferences?.hideLibraryClassicsBadges ?? false,
  hideSteamLibraryBadges: preferences?.hideSteamLibraryBadges ?? false,
  autoplayAnimatedArtwork: preferences?.autoplayAnimatedArtwork ?? false,
  persistFiltersAndSorting: preferences?.persistFiltersAndSorting ?? false,
});

export function SettingsContextContentGameplay() {
  const { t } = useTranslation("settings");
  const { updateUserPreferences } = useContext(settingsContext);

  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );

  const [form, setForm] = useState(() => buildForm(userPreferences));

  const handleChange = (values: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...values }));
    updateUserPreferences(values);
  };

  return (
    <div className="settings-context-panel">
      <div className="settings-context-panel__group">
        <h3>{t("content_preferences")}</h3>

        <CheckboxField
          label={t("autoplay_trailers_on_game_page")}
          checked={form.autoplayGameTrailers}
          onChange={() =>
            handleChange({
              autoplayGameTrailers: !form.autoplayGameTrailers,
            })
          }
        />

        <CheckboxField
          label={t("disable_nsfw_alert")}
          checked={form.disableNsfwAlert}
          onChange={() =>
            handleChange({ disableNsfwAlert: !form.disableNsfwAlert })
          }
        />

        <CheckboxField
          label={t("enable_new_download_options_badges")}
          checked={form.enableNewDownloadOptionsBadges}
          onChange={() =>
            handleChange({
              enableNewDownloadOptionsBadges:
                !form.enableNewDownloadOptionsBadges,
            })
          }
        />

        <CheckboxField
          label={t("persist_filters_and_sorting")}
          checked={form.persistFiltersAndSorting}
          onChange={() =>
            handleChange({
              persistFiltersAndSorting: !form.persistFiltersAndSorting,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("library_appearance")}</h3>

        <CheckboxField
          label={t("hide_library_game_badges")}
          checked={form.hideLibraryGameBadges}
          onChange={() =>
            handleChange({
              hideLibraryGameBadges: !form.hideLibraryGameBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_ready_size_badges")}
          checked={form.hideLibraryReadySizeBadges}
          onChange={() =>
            handleChange({
              hideLibraryReadySizeBadges: !form.hideLibraryReadySizeBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_classics_badges")}
          checked={form.hideLibraryClassicsBadges}
          onChange={() =>
            handleChange({
              hideLibraryClassicsBadges: !form.hideLibraryClassicsBadges,
            })
          }
        />

        <CheckboxField
          label={t("hide_library_steam_badges")}
          checked={form.hideSteamLibraryBadges}
          onChange={() =>
            handleChange({
              hideSteamLibraryBadges: !form.hideSteamLibraryBadges,
            })
          }
        />

        <CheckboxField
          label={t("autoplay_animated_artwork")}
          checked={form.autoplayAnimatedArtwork}
          onChange={() =>
            handleChange({
              autoplayAnimatedArtwork: !form.autoplayAnimatedArtwork,
            })
          }
        />
      </div>

      <div className="settings-context-panel__group">
        <h3>{t("classics_appearance")}</h3>

        <CheckboxField
          label={t("hide_classics_bookmark")}
          checked={form.hideClassicsBookmark}
          onChange={() =>
            handleChange({
              hideClassicsBookmark: !form.hideClassicsBookmark,
            })
          }
        />

        <CheckboxField
          label={t("classics_use_hero_layout")}
          checked={form.classicsUseHeroLayout}
          onChange={() =>
            handleChange({
              classicsUseHeroLayout: !form.classicsUseHeroLayout,
            })
          }
        />
      </div>
    </div>
  );
}
