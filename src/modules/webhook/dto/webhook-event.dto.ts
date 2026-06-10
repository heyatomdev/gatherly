export enum WebhookEventType {
  EVENT_CREATED = 'event.created',
  EVENT_UPDATED = 'event.updated',
  EVENT_CANCELLED = 'event.cancelled',
  EVENT_PUBLISHED = 'event.published',
  EVENT_COMPLETED = 'event.completed',

  PARTICIPANT_JOINED = 'participant.joined',
  PARTICIPANT_STATUS_CHANGED = 'participant.status_changed',
  PARTICIPANT_REMOVED = 'participant.removed',
  PARTICIPANT_CHECKED_IN = 'participant.checked_in',
}

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  clientId: string;
  data: any;
}

export interface EventWebhookPayload extends WebhookPayload {
  data: {
    id: string;
    title: string;
    description?: string;
    locale: string;
    authorId: string;
    authorName: string;
    authorEmail?: string;
    startTime: Date;
    endTime?: Date;
    timezone?: string;
    status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED';
    type?: string;
    coverImageUrl?: string;
    tags: string[];
    categoryId?: string;
    categoryName?: string;
    locationName?: string;
    locationAddress?: string;
    locationUrl?: string;
    isOnline: boolean;
    maxParticipants?: number;
    isPublic: boolean;
    price?: any;
    currency?: string;
    createdAt: Date;
    updatedAt: Date;
  };
}

export interface ParticipantWebhookPayload extends WebhookPayload {
  data: {
    id: string;
    eventId: string;
    eventTitle: string;
    type: 'INLINE' | 'EXTERNAL';
    userName: string;
    email?: string;
    externalId?: string;
    externalSource?: string;
    status: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
    previousStatus?: 'REGISTERED' | 'WAITLIST' | 'CONFIRMED' | 'CANCELLED' | 'ATTENDED';
    role: 'ATTENDEE' | 'SPEAKER' | 'ORGANIZER' | 'HOST';
    notes?: string;
    checkedIn: boolean;
    checkedInAt?: Date;
    createdAt: Date;
  };
}
