// Mirrors src/domain/registration/rules.ts for the assistant; keep both in step.
export const FIELD_HELP_COLLECTIONS = ['events', 'sessions', 'attendees', 'registrations', 'media', 'users'] as const
export type FieldHelpCollection = (typeof FIELD_HELP_COLLECTIONS)[number]

export const COLLECTION_RULES: Record<FieldHelpCollection, string[]> = {
  events: [
    'An event must end after it starts.',
    'The slug is created from the title when left empty and must be unique.',
    'Only published events accept new registrations. Draft and cancelled events do not.',
    'Changing the dates is refused if it would leave existing sessions outside the event.',
    'An event with sessions cannot be deleted; delete its sessions first.',
  ],
  sessions: [
    'A session must end after it starts, and both times must fall within its event’s start and end.',
    'Capacity is a whole number of at least 1.',
    'Capacity cannot be lowered below the number of confirmed registrations.',
    'Seats left = capacity minus confirmed registrations; it is calculated, not typed in.',
    'A session with registrations cannot be deleted.',
  ],
  attendees: [
    'Email is required, must be a valid address and must be unique: one attendee record per email.',
    'An attendee with registrations cannot be deleted.',
  ],
  registrations: [
    'A registration books one attendee into one session.',
    'New registrations are only possible when the session’s event is published and the session has not ended.',
    'A session never has more confirmed registrations than its capacity. When it is full, registration is refused with "Session is full".',
    'An attendee can hold only one confirmed registration per session ("Already registered for this session").',
    'An attendee cannot be confirmed in two sessions whose times overlap. Back-to-back sessions (one ends when the next starts) are fine.',
    'Cancelling is one-way: confirmed → cancelled. A cancelled registration cannot be confirmed again or edited; register again to create a new one.',
    'Attendee and session cannot be changed after saving. Cancel and create a new registration instead.',
    'Registered at, Cancelled at and Created by are filled in automatically.',
    'Several registrations can be cancelled at once from the list: tick them and use "Cancel selected registrations".',
    'Only admins can delete registrations.',
  ],
  media: [
    'Only JPEG, PNG and WebP images up to 2 MB are accepted.',
    'Alt text is required.',
    'Files are stored in cloud object storage, not on the server.',
  ],
  users: [
    'Admins have full access. Staff can read events and sessions, add and edit attendees, and create and cancel registrations.',
    'Only admins can change roles, and nobody can change their own role.',
    'The first account ever created becomes an admin.',
  ],
}
