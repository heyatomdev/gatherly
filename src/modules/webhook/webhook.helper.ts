/**
 * Webhook Helper Utilities
 *
 * Utility functions to prepare event and participant data for webhook notifications
 */

import { Event, Participant } from '@prisma/client';

/**
 * Transforms an Event entity into webhook payload format
 */
export function formatEventForWebhook(event: Event & { category?: any }): any {
  return {
    id: event.id,
    title: event.title,
    description: event.description,
    authorId: event.authorId,
    authorName: event.authorName,
    authorEmail: event.authorEmail,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone,
    status: event.status,
    type: event.type,
    coverImageUrl: event.coverImageUrl,
    tags: event.tags,
    categoryId: event.categoryId,
    category: event.category?.name,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    locationUrl: event.locationUrl,
    isOnline: event.isOnline,
    maxParticipants: event.maxParticipants,
    isPublic: event.isPublic,
    price: event.price,
    currency: event.currency,
    isRecurring: event.isRecurring,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

/**
 * Transforms a Participant entity into webhook payload format
 */
export function formatParticipantForWebhook(
  participant: Participant & { event?: { title: string } }
): any {
  return {
    id: participant.id,
    eventId: participant.eventId,
    eventTitle: participant.event?.title || 'Unknown Event',
    userId: participant.userId,
    userName: participant.userName,
    email: participant.email,
    status: participant.status,
    role: participant.role,
    notes: participant.notes,
    checkedIn: participant.checkedIn,
    checkedInAt: participant.checkedInAt,
    createdAt: participant.createdAt,
  };
}

/**
 * Prepares event data with additional metadata
 */
export function enrichEventData(event: Event, additionalData?: Record<string, any>) {
  return {
    ...formatEventForWebhook(event),
    ...additionalData,
  };
}

/**
 * Prepares participant data with additional metadata
 */
export function enrichParticipantData(
  participant: Participant & { event?: { title: string } },
  additionalData?: Record<string, any>
) {
  return {
    ...formatParticipantForWebhook(participant),
    ...additionalData,
  };
}

