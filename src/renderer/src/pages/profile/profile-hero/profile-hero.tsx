import { useCallback, useContext, useMemo, useState } from "react";
import { userProfileContext } from "@renderer/context";
import { PencilIcon, SignOutIcon } from "@primer/octicons-react";
import { buildGameDetailsPath } from "@renderer/helpers";
import {
  Avatar,
  Button,
  ConfirmationModal,
  FullscreenMediaModal,
  Link,
} from "@renderer/components";
import { useTranslation } from "react-i18next";
import {
  useAppSelector,
  useDate,
  useToast,
  useUserDetails,
} from "@renderer/hooks";
import { addSeconds } from "date-fns";
import { useNavigate } from "react-router-dom";
import { GameVisibilityBadge } from "@renderer/components/game-visibility-badge/game-visibility-badge";

import { EditProfileModal } from "../edit-profile-modal/edit-profile-modal";
import Skeleton from "react-loading-skeleton";
import { UploadBackgroundImageButton } from "../upload-background-image-button/upload-background-image-button";
import "./profile-hero.scss";

export function ProfileHero() {
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showFullscreenAvatar, setShowFullscreenAvatar] = useState(false);
  const [isPerformingAction, setIsPerformingAction] = useState(false);
  const [showSignOutModal, setShowSignOutModal] = useState(false);

  const { isMe, userProfile, heroBackground, backgroundImage } =
    useContext(userProfileContext);
  const { signOut } = useUserDetails();

  const { gameRunning } = useAppSelector((state) => state.gameRunning);

  const { t } = useTranslation("user_profile");
  const { formatDistance } = useDate();

  const { showSuccessToast } = useToast();

  const navigate = useNavigate();

  const handleSignOut = useCallback(async () => {
    setIsPerformingAction(true);

    try {
      await signOut();

      showSuccessToast(t("successfully_signed_out"));
    } finally {
      setIsPerformingAction(false);
      setShowSignOutModal(false);
    }
    navigate("/");
  }, [navigate, signOut, showSuccessToast, t]);

  const profileActions = useMemo(() => {
    if (!userProfile || !isMe) return null;

    return (
      <>
        <Button
          theme="outline"
          onClick={() => setShowEditProfileModal(true)}
          disabled={isPerformingAction}
          className="profile-hero__button--outline"
        >
          <PencilIcon />
          {t("edit_profile")}
        </Button>

        <Button
          theme="danger"
          onClick={() => setShowSignOutModal(true)}
          disabled={isPerformingAction}
        >
          <SignOutIcon />
          {t("sign_out")}
        </Button>
      </>
    );
  }, [isMe, t, isPerformingAction, userProfile]);

  const handleAvatarClick = useCallback(() => {
    if (userProfile?.profileImageUrl) {
      setShowFullscreenAvatar(true);
    } else if (isMe) {
      setShowEditProfileModal(true);
    }
  }, [isMe, userProfile?.profileImageUrl]);

  const currentGame = useMemo(() => {
    if (isMe) {
      if (gameRunning)
        return {
          ...gameRunning,
          objectId: gameRunning.objectId,
          sessionDurationInSeconds: gameRunning.sessionDurationInMillis / 1000,
        };

      return null;
    }
    return userProfile?.currentGame;
  }, [isMe, userProfile, gameRunning]);

  return (
    <>
      <EditProfileModal
        visible={showEditProfileModal}
        onClose={() => setShowEditProfileModal(false)}
      />

      <ConfirmationModal
        visible={showSignOutModal}
        title={t("sign_out_modal_title")}
        descriptionText={t("sign_out_modal_text")}
        confirmButtonLabel={t("sign_out")}
        cancelButtonLabel={t("cancel")}
        confirmButtonTheme="danger"
        buttonsIsDisabled={isPerformingAction}
        onConfirm={() => void handleSignOut()}
        onClose={() => setShowSignOutModal(false)}
      />

      <FullscreenMediaModal
        visible={showFullscreenAvatar}
        onClose={() => setShowFullscreenAvatar(false)}
        src={userProfile?.profileImageUrl}
        alt={userProfile?.displayName}
      />

      <section
        className="profile-hero__content-box"
        style={{ background: !backgroundImage ? heroBackground : undefined }}
      >
        {backgroundImage && (
          <img
            src={backgroundImage}
            alt=""
            className="profile-hero__background-image"
          />
        )}

        <div
          className={`profile-hero__background-overlay ${
            !backgroundImage
              ? "profile-hero__background-overlay--transparent"
              : ""
          }`}
        >
          <div className="profile-hero__user-information">
            <button
              type="button"
              className="profile-hero__avatar-button"
              onClick={handleAvatarClick}
            >
              <Avatar
                size={96}
                alt={userProfile?.displayName}
                src={userProfile?.profileImageUrl}
              />
            </button>

            <div className="profile-hero__information">
              {userProfile ? (
                <h2 className="profile-hero__display-name">
                  {userProfile?.displayName}
                </h2>
              ) : (
                <Skeleton width={150} height={28} />
              )}

              {currentGame && (
                <div className="profile-hero__current-game-wrapper">
                  <div className="profile-hero__current-game-details">
                    <Link
                      to={buildGameDetailsPath({
                        ...currentGame,
                        objectId: currentGame.objectId,
                      })}
                    >
                      {currentGame.title}
                    </Link>
                    <GameVisibilityBadge
                      isHiddenFromOthers={
                        "isHiddenFromOthers" in currentGame &&
                        currentGame.isHiddenFromOthers === true
                      }
                    />
                  </div>

                  <small>
                    {t("playing_for", {
                      amount: formatDistance(
                        addSeconds(
                          new Date(),
                          -currentGame.sessionDurationInSeconds
                        ),
                        new Date()
                      ),
                    })}
                  </small>
                </div>
              )}
            </div>

            <UploadBackgroundImageButton />
          </div>
        </div>

        <div
          className={`profile-hero__hero-panel ${
            !backgroundImage ? "profile-hero__hero-panel--transparent" : ""
          }`}
          style={{
            background: !backgroundImage ? heroBackground : undefined,
          }}
        >
          <div className="profile-hero__actions">{profileActions}</div>
        </div>
      </section>
    </>
  );
}
