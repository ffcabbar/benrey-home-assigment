// The rename hooks build the same strings in SQL; keep the separators in sync.
export const SESSION_EVENT_SEPARATOR = ' — '
export const ATTENDEE_SESSION_SEPARATOR = ' → '

export const sessionDisplayTitle = (sessionTitle: string, eventTitle: string | null | undefined) =>
  eventTitle ? `${sessionTitle}${SESSION_EVENT_SEPARATOR}${eventTitle}` : sessionTitle

export const registrationLabel = (attendeeName: string, sessionTitle: string) =>
  `${attendeeName}${ATTENDEE_SESSION_SEPARATOR}${sessionTitle}`
