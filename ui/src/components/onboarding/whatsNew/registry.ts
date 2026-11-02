import type { WhatsNewTour } from "../../../lib/whatsNew";

/** Guided tours by What's New note id. A note without an entry here is read in the release notes
 *  page instead. Release 1 ships no notes, so the list is empty.
 *  To add one: add the note on the server (api/stowge/whats_new.py NOTES) and a component here
 *  keyed by the same id (see WelcomeTour for the react-joyride pattern). */
export const WHATS_NEW_TOURS: Record<string, WhatsNewTour> = {};
