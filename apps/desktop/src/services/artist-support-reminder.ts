export const FIRST_ARTIST_SUPPORT_REMINDER_MS = 5 * 60 * 1_000;
export const REPEAT_ARTIST_SUPPORT_REMINDER_MS = 8 * 60 * 60 * 1_000;

export interface ArtistSupportClock { firstSeenAt: number; lastOpenedAt: number | null; }

export function supportReminderDue(clock: ArtistSupportClock, now: number): boolean {
  return now >= (clock.lastOpenedAt === null
    ? clock.firstSeenAt + FIRST_ARTIST_SUPPORT_REMINDER_MS
    : clock.lastOpenedAt + REPEAT_ARTIST_SUPPORT_REMINDER_MS);
}
