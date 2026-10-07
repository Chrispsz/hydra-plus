import {
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { PencilIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { HeroPanel } from "./hero";
import { DescriptionHeader } from "./description-header/description-header";
import { GallerySlider } from "./gallery-slider/gallery-slider";
import { Sidebar } from "./sidebar/sidebar";
import { GameReviews } from "./game-reviews";
import { ReviewPromptBanner } from "./review-prompt-banner";
import { useReviewPrompt } from "./use-review-prompt";
import { useUserReviewStatus } from "./use-user-review-status";
import { GameLogo } from "./game-logo";
import { CloudSaveWidget } from "./cloud-save-v2";
import { getCloudSaveVisibility } from "./cloud-save-visibility";
import { SimilarGames } from "./similar-games/similar-games";

import { getDisplayedPlayTimeInMilliseconds } from "@shared";
import { cloudSyncContext, gameDetailsContext } from "@renderer/context";

import { useUserDetails, useLibrary } from "@renderer/hooks";
import "./game-details.scss";
import "./hero.scss";

const processMediaElements = (document: Document) => {
  const $images = Array.from(document.querySelectorAll("img"));
  $images.forEach(($image) => {
    $image.loading = "lazy";
    $image.removeAttribute("width");
    $image.removeAttribute("height");
    $image.removeAttribute("style");
    $image.style.maxWidth = "100%";
    $image.style.width = "auto";
    $image.style.height = "auto";
    $image.style.boxSizing = "border-box";
  });

  // Handle videos the same way
  const $videos = Array.from(document.querySelectorAll("video"));
  $videos.forEach(($video) => {
    $video.removeAttribute("width");
    $video.removeAttribute("height");
    $video.removeAttribute("style");
    $video.style.maxWidth = "100%";
    $video.style.width = "auto";
    $video.style.height = "auto";
    $video.style.boxSizing = "border-box";
  });
};

const getImageWithCustomPriority = (
  customUrl: string | null | undefined,
  originalUrl: string | null | undefined,
  fallbackUrl?: string | null | undefined
) => {
  return customUrl || originalUrl || fallbackUrl || "";
};

export function GameDetailsContent() {
  const { t } = useTranslation("game_details");
  const [searchParams] = useSearchParams();
  const reviewsRef = useRef<HTMLDivElement>(null);

  const {
    objectId,
    shopDetails,
    game,
    hasNSFWContentBlocked,
    shop,
    setShowGameOptionsModal,
    setGameOptionsInitialCategory,
  } = useContext(gameDetailsContext);

  const { userDetails } = useUserDetails();
  const { library } = useLibrary();

  const { getGameArtifacts } = useContext(cloudSyncContext);
  const cloudSaveVisibility = game
    ? getCloudSaveVisibility(game.shop, game.platform)
    : null;

  const aboutTheGame = useMemo(() => {
    const aboutTheGame = shopDetails?.about_the_game;
    if (aboutTheGame) {
      const document = new DOMParser().parseFromString(
        aboutTheGame,
        "text/html"
      );

      processMediaElements(document);

      return document.body.outerHTML;
    }

    if (game?.shop === "custom") {
      return "";
    }

    return t("no_shop_details");
  }, [shopDetails, t, game?.shop]);

  const [backdropOpacity, setBackdropOpacity] = useState(1);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDescriptionOverflowing, setIsDescriptionOverflowing] =
    useState(false);
  const descriptionRef = useRef<HTMLDivElement>(null);

  // Check if the current game is in the user's library
  const isGameInLibrary = useMemo(() => {
    if (!library || !shop || !objectId) return false;
    return library.some(
      (libItem) => libItem.shop === shop && libItem.objectId === objectId
    );
  }, [library, shop, objectId]);

  const { hasUserReviewed, isCheckingUserReview, updateHasUserReviewed } =
    useUserReviewStatus({
      shop,
      objectId,
      userDetailsId: userDetails?.id,
    });

  const { showPrompt, dismissPrompt } = useReviewPrompt({
    shop,
    objectId,
    playTimeInMilliseconds: getDisplayedPlayTimeInMilliseconds({
      playTimeInMilliseconds: game?.playTimeInMilliseconds ?? 0,
      steamPlayTimeInMilliseconds: game?.steamPlayTimeInMilliseconds,
    }),
    userDetailsId: userDetails?.id,
    isGameInLibrary,
    hasUserReviewed,
    isCheckingUserReview,
  });

  const handleReviewPromptYes = () => {
    dismissPrompt({ persist: false });
    reviewsRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleReviewPromptLater = () => {
    dismissPrompt({ persist: true });
  };

  useEffect(() => {
    setBackdropOpacity(1);
  }, [objectId]);

  useLayoutEffect(() => {
    const el = descriptionRef.current;
    if (!el) {
      setIsDescriptionOverflowing(false);
      return;
    }

    const measure = () => {
      const collapsedMaxHeight = 300;
      setIsDescriptionOverflowing(el.scrollHeight > collapsedMaxHeight);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    const images = Array.from(el.querySelectorAll("img"));
    const onMediaLoad = () => measure();
    images.forEach((img) => {
      if (!img.complete) img.addEventListener("load", onMediaLoad);
    });

    return () => {
      observer.disconnect();
      images.forEach((img) => img.removeEventListener("load", onMediaLoad));
    };
  }, [aboutTheGame]);

  const handleEditGameClick = () => {
    setGameOptionsInitialCategory("assets");
    setShowGameOptionsModal(true);
  };

  useEffect(() => {
    getGameArtifacts();
  }, [getGameArtifacts]);

  // Scroll to reviews section if reviews=true in URL
  useEffect(() => {
    const shouldScrollToReviews = searchParams.get("reviews") === "true";
    if (shouldScrollToReviews && reviewsRef.current) {
      setTimeout(() => {
        reviewsRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 500);
    }
  }, [searchParams, objectId]);

  const isCustomGame = game?.shop === "custom";

  const heroImage = isCustomGame
    ? game?.libraryHeroImageUrl || game?.iconUrl || ""
    : getImageWithCustomPriority(
        game?.customHeroImageUrl,
        shopDetails?.assets?.libraryHeroImageUrl
      );

  const heroImageContent = heroImage ? (
    <img
      src={heroImage}
      className="game-details__hero-image"
      alt={game?.title}
    />
  ) : (
    <div className="game-details__hero-image game-details__hero-image--placeholder" />
  );

  return (
    <div
      className={`game-details__wrapper ${hasNSFWContentBlocked ? "game-details__wrapper--blurred" : ""}`}
    >
      <section className="game-details__container">
        <div className="game-details__hero">
          {heroImageContent}

          <div
            className="game-details__hero-logo-backdrop"
            style={{ opacity: backdropOpacity }}
          >
            <div className="game-details__hero-content">
              <div className="game-details__hero-standard-meta">
                <GameLogo game={game} shopDetails={shopDetails} />
              </div>

              <div className="game-details__hero-buttons game-details__hero-buttons--right">
                {game && (
                  <button
                    type="button"
                    className="game-details__edit-custom-game-button"
                    onClick={handleEditGameClick}
                    title={t("edit_game_modal_button")}
                  >
                    <PencilIcon size={16} />
                  </button>
                )}

                {game && objectId && cloudSaveVisibility?.hero === "v2" && (
                  <CloudSaveWidget />
                )}
              </div>
            </div>

            <div className="game-details__hero-panel">
              <HeroPanel />
            </div>
          </div>
        </div>

        <div className="game-details__description-container">
          <div className="game-details__description-content">
            <DescriptionHeader />

            {showPrompt && (
              <ReviewPromptBanner
                onYesClick={handleReviewPromptYes}
                onLaterClick={handleReviewPromptLater}
              />
            )}

            <GallerySlider />

            {shopDetails?.about_the_game && (
              <h2 className="game-details__description-title">
                {t("about_this_game")}
              </h2>
            )}

            <div
              ref={descriptionRef}
              dangerouslySetInnerHTML={{
                __html: aboutTheGame,
              }}
              className={`game-details__description ${
                isDescriptionExpanded
                  ? "game-details__description--expanded"
                  : isDescriptionOverflowing
                    ? "game-details__description--collapsed"
                    : ""
              }`}
            />

            {aboutTheGame && isDescriptionOverflowing && (
              <button
                type="button"
                className="game-details__description-toggle"
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
              >
                {isDescriptionExpanded ? t("show_less") : t("show_more")}
              </button>
            )}

            {shop && objectId && (
              <SimilarGames objectId={objectId} shop={shop} />
            )}

            {shop !== "custom" && shop && objectId && (
              <div ref={reviewsRef}>
                <GameReviews
                  shop={shop}
                  objectId={objectId}
                  game={game}
                  userDetailsId={userDetails?.id}
                  hasUserReviewed={hasUserReviewed}
                  isCheckingUserReview={isCheckingUserReview}
                  onUserReviewedChange={updateHasUserReviewed}
                />
              </div>
            )}
          </div>

          {shop !== "custom" && <Sidebar />}
        </div>
      </section>
    </div>
  );
}
