import { useTranslation } from "react-i18next";

import { CheckboxField } from "@renderer/components";
import { LAUNCH_FLAG_CATALOG } from "@shared/launch-flags";
import { Tooltip } from "react-tooltip";

import { isLaunchFlagDisabled } from "./launch-flags-selection";

interface LaunchFlagsSectionProps {
  /** Flag ids currently persisted on the game record. */
  launchFlags: string[];
  gamemodeAvailable: boolean;
  mangohudAvailable: boolean;
  onChangeLaunchFlag: (flagId: string, enabled: boolean) => void;
}

/**
 * Per-game launch flags (Linux compatibility context only): one checkbox
 * per catalog entry, labels and descriptions come from the
 * `launch_flags` i18n namespace keyed by the catalog id.
 *
 * Wrapper flags whose host tool is unavailable render disabled with the
 * same "not available in your PATH" tooltips the legacy MangoHud/GameMode
 * toggles use. gamescope has no renderer-side probe (follow-up), so its
 * checkbox stays enabled — the main process drops the wrapper safely at
 * launch time when the tool is missing.
 */
export function LaunchFlagsSection({
  launchFlags,
  gamemodeAvailable,
  mangohudAvailable,
  onChangeLaunchFlag,
}: Readonly<LaunchFlagsSectionProps>) {
  const { t } = useTranslation("launch_flags");
  const { t: tGameDetails } = useTranslation("game_details");

  return (
    <div className="game-options-modal__launch-flags">
      <div className="game-options-modal__header">
        <h2>{t("section_title")}</h2>
        <h4 className="game-options-modal__header-description">
          {t("section_description")}
        </h4>
      </div>

      <ul className="game-options-modal__launch-flags-list">
        {LAUNCH_FLAG_CATALOG.map((definition) => {
          const disabled = isLaunchFlagDisabled(definition, {
            mangohud: mangohudAvailable,
            gamemode: gamemodeAvailable,
          });

          const tooltipId = `launch-flag-${definition.id}-unavailable-tooltip`;
          const tooltipContent =
            definition.availability === "mangohud"
              ? tGameDetails("mangohud_not_available_tooltip", {
                  defaultValue: "MangoHud is not available in your PATH",
                })
              : definition.availability === "gamemode"
                ? tGameDetails("gamemode_not_available_tooltip", {
                    defaultValue: "GameMode is not available in your PATH",
                  })
                : undefined;

          return (
            <li key={definition.id} className="game-options-modal__launch-flag">
              <CheckboxField
                label={
                  <span
                    className={`game-options-modal__launch-flag-label ${
                      disabled
                        ? "game-options-modal__launch-flag-label--disabled"
                        : ""
                    }`}
                    data-tooltip-id={disabled ? tooltipId : undefined}
                    data-tooltip-content={disabled ? tooltipContent : undefined}
                  >
                    <span className="game-options-modal__launch-flag-name">
                      {t(`${definition.id}.label`)}
                    </span>
                    <span className="game-options-modal__launch-flag-description">
                      {t(`${definition.id}.description`)}
                    </span>
                  </span>
                }
                checked={launchFlags.includes(definition.id)}
                disabled={disabled}
                onChange={(event) =>
                  onChangeLaunchFlag(definition.id, event.target.checked)
                }
              />

              {disabled && <Tooltip id={tooltipId} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
