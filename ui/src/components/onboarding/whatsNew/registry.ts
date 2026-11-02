import type { WhatsNewTour } from "../../../lib/whatsNew";
import { TagsAndHintsTour } from "./TagsAndHintsTour";

/** Guided tours by What's New note id. A note without an entry here is read in the release notes
 *  page instead.
 *  To add one: add the note on the server (api/stowge/whats_new.py NOTES) and a component here
 *  keyed by the same id (see GuidedTour for the react-joyride pattern). */
export const WHATS_NEW_TOURS: Record<string, WhatsNewTour> = {
  "tags-and-hints": TagsAndHintsTour,
};
