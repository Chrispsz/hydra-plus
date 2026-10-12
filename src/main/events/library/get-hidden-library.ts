import { registerEvent } from "../register-event";
import { getLibrary } from "./get-library";

/**
 * Local "hidden" library (games the user concealed). There is no account:
 * the list is the LevelDB games whose isConcealed flag is set.
 */
registerEvent("getHiddenLibrary", async () => {
  return getLibrary("hidden");
});
