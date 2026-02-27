/**
 * Tipi di eventi webhook supportati
 */
export enum WebhookEventType {
  // Event events
  EVENT_CREATED = 'event.created',
  EVENT_UPDATED = 'event.updated',
  EVENT_CANCELLED = 'event.cancelled',
  EVENT_PUBLISHED = 'event.published',
  EVENT_COMPLETED = 'event.completed',

  // Participant events
  PARTICIPANT_JOINED = 'participant.joined',
  PARTICIPANT_STATUS_CHANGED = 'participant.status_changed',
  PARTICIPANT_REMOVED = 'participant.removed',
  PARTICIPANT_CHECKED_IN = 'participant.checked_in',
}

/**
 * Payload base per tutti i webhook
 */
export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  clientId: string;
  data: any;
}

/**
 * Event notification payload
 */
export interface EventWebhookPayload extends WebhookPayload {
  data: {
    id: string;
    title: string;
    description?: string;
    authorId: string;
    authorName: string;
    authorEmail?: string;
    startTime: Date;
    endTime?: Date;
    timezone?: string;
    status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
    type?: string;
    coverImageUrl?: string;
    tags?: string[];
    categoryId?: string;
    locationName?: string;
    locationAddress?: string;
    locationUrl?: string;
    isOnline: boolean;
    maxParticipants?: number;
    isPublic: boolean;
    price?: number;
    currency?: string;
    isRecurring?: boolean;
    createdAt: Date;
    updatedAt: Date;
  };
}

/**
 * Participant notification payload
 */
export interface ParticipantWebhookPayload extends WebhookPayload {
  data: {
    id: string;
    eventId: string;
    eventTitle: string;
    userId: string;
    userName: string;
    email?: string;
    status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
    previousStatus?: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
    role: 'ATTENDEE' | 'SPEAKER' | 'ORGANIZER' | 'HOST';
    notes?: string;
    checkedIn: boolean;
    checkedInAt?: Date;
    createdAt: Date;
  };
}

