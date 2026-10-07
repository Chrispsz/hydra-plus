import { lazy, Suspense, useContext, useEffect, useState } from "react";
import type {
  HowLongToBeatCategory,
  ProtonDBData,
  SteamAppDetails,
} from "@types";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components/button/button";
import { StarRating } from "@renderer/components/star-rating/star-rating";

import { gameDetailsContext } from "@renderer/context";
import { useFormat } from "@renderer/hooks";
import { DownloadIcon, PeopleIcon, StarIcon } from "@primer/octicons-react";
import { HowLongToBeatSection } from "./how-long-to-beat-section";
import { LaunchboxDetailsSection } from "./launchbox-details-section";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import "./sidebar.scss";
import { GameLanguageSection } from "./game-language-section";
import { ControllerSupportSection } from "./controller-support-section";

const ProtonDBSection = lazy(async () => {
  const mod = await import("./protondb-section");
  return { default: mod.ProtonDBSection };
});

const protonDBResponseCache = new Map<string, ProtonDBData | null>();
const protonDBInFlightRequests = new Map<
  string,
  Promise<ProtonDBData | null>
>();

const getProtonDBData = (shop: string, objectId: string) => {
  const cacheKey = `${shop}:${objectId}`;

  if (protonDBResponseCache.has(cacheKey)) {
    return Promise.resolve(protonDBResponseCache.get(cacheKey) ?? null);
  }

  const inFlightRequest = protonDBInFlightRequests.get(cacheKey);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const request = window.electron.hydraApi
    .get<ProtonDBData | null>(`/games/${shop}/${objectId}/protondb`, {
      needsAuth: false,
    })
    .then((protonData) => {
      protonDBResponseCache.set(cacheKey, protonData);
      return protonData;
    })
    .catch(() => null)
    .finally(() => {
      protonDBInFlightRequests.delete(cacheKey);
    });

  protonDBInFlightRequests.set(cacheKey, request);
  return request;
};

export function Sidebar() {
  const shouldShowProtonFeatures = window.electron.platform === "linux";
  const [howLongToBeat, setHowLongToBeat] = useState<{
    isLoading: boolean;
    data: HowLongToBeatCategory[] | null;
  }>({ isLoading: true, data: null });
  const [protonDB, setProtonDB] = useState<{
    isLoading: boolean;
    data: ProtonDBData | null;
  }>({ isLoading: shouldShowProtonFeatures, data: null });

  const [activeRequirement, setActiveRequirement] =
    useState<keyof SteamAppDetails["pc_requirements"]>("minimum");

  const { gameTitle, shopDetails, objectId, shop, stats } =
    useContext(gameDetailsContext);

  const { t } = useTranslation("game_details");
  const { numberFormatter } = useFormat();

  useEffect(() => {
    if (objectId) {
      setHowLongToBeat({ isLoading: true, data: null });

      // Directly fetch from API without checking cache
      window.electron.hydraApi
        .get<HowLongToBeatCategory[] | null>(
          `/games/${shop}/${objectId}/how-long-to-beat`,
          {
            needsAuth: false,
          }
        )
        .then((howLongToBeatData) => {
          setHowLongToBeat({
            isLoading: false,
            data: Array.isArray(howLongToBeatData) ? howLongToBeatData : null,
          });
        })
        .catch(() => {
          setHowLongToBeat({ isLoading: false, data: null });
        });
    }
  }, [objectId, shop]);

  useEffect(() => {
    if (!shouldShowProtonFeatures || !objectId) {
      setProtonDB({ isLoading: false, data: null });
      return;
    }

    setProtonDB({ isLoading: true, data: null });

    getProtonDBData(shop, objectId)
      .then((protonData) => {
        setProtonDB({ isLoading: false, data: protonData });
      })
      .catch(() => {
        setProtonDB({ isLoading: false, data: null });
      });
  }, [shouldShowProtonFeatures, objectId, shop]);

  return (
    <aside className="content-sidebar">
      {shouldShowProtonFeatures && (
        <Suspense fallback={null}>
          <ProtonDBSection
            protonDBData={protonDB.data}
            isLoading={protonDB.isLoading}
            objectId={objectId ?? ""}
          />
        </Suspense>
      )}

      {stats && (
        <SidebarSection title={t("stats")}>
          <div className="stats__section">
            <div className="stats__category">
              <p className="stats__category-title">
                <DownloadIcon size={18} />
                {t("download_count")}
              </p>
              <p>{numberFormatter.format(stats?.downloadCount)}</p>
            </div>

            <div className="stats__category">
              <p className="stats__category-title">
                <PeopleIcon size={18} />
                {t("player_count")}
              </p>
              <p>{numberFormatter.format(stats?.playerCount)}</p>
            </div>

            <div className="stats__category">
              <p className="stats__category-title">
                <StarIcon size={18} />
                {t("rating_count")}
              </p>
              <StarRating
                rating={
                  stats?.averageScore === 0
                    ? null
                    : (stats?.averageScore ?? null)
                }
                size={16}
              />
            </div>
          </div>
        </SidebarSection>
      )}

      {shop === "launchbox" && (
        <LaunchboxDetailsSection
          platform={shopDetails?.platform}
          genres={shopDetails?.genres?.map((g) => g.name)}
          skus={shopDetails?.skus}
        />
      )}

      <HowLongToBeatSection
        howLongToBeatData={howLongToBeat.data}
        isLoading={howLongToBeat.isLoading}
      />

      <ControllerSupportSection />

      {shop !== "launchbox" && (
        <SidebarSection title={t("requirements")}>
          <div className="requirement__button-container">
            <Button
              className="requirement__button"
              onClick={() => setActiveRequirement("minimum")}
              theme={activeRequirement === "minimum" ? "primary" : "outline"}
            >
              {t("minimum")}
            </Button>

            <Button
              className="requirement__button"
              onClick={() => setActiveRequirement("recommended")}
              theme={
                activeRequirement === "recommended" ? "primary" : "outline"
              }
            >
              {t("recommended")}
            </Button>
          </div>

          <div
            className="requirement__details"
            dangerouslySetInnerHTML={{
              __html:
                shopDetails?.pc_requirements?.[activeRequirement] ??
                t(`no_${activeRequirement}_requirements`, {
                  gameTitle,
                }),
            }}
          />
        </SidebarSection>
      )}

      <GameLanguageSection />
    </aside>
  );
}
