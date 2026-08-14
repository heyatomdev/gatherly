import { Event, Participant } from '@prisma/client';

type EventWithRelations = Event & {
  translations?: { locale: string; title: string; description?: string | null }[];
  category?: { translations?: { locale: string; name: string }[] } | null;
  tags?: { tag: { slug: string } }[];
};

type ParticipantWithEvent = Participant & {
  event?: { translations?: { locale: string; title: string }[] } | null;
};

function pickTranslation<T extends { locale: string }>(
  items: T[] | undefined,
  locale: string,
): T | undefined {
  return items?.find((t) => t.locale === locale) ?? items?.[0];
}

export function formatEventForWebhook(event: EventWithRelations, locale?: string): any {
  const l = locale ?? event.defaultLocale;
  const translation = pickTranslation(event.translations, l);
  const categoryName = pickTranslation(event.category?.translations ?? [], l)?.name;

  return {
    id: event.id,
    title: translation?.title ?? '',
    description: translation?.description,
    locale: l,
    authorId: event.authorId,
    authorName: event.authorName,
    authorEmail: event.authorEmail,
    startTime: event.startTime,
    endTime: event.endTime,
    timezone: event.timezone,
    status: event.status,
    type: event.type,
    coverImageUrl: event.coverImageUrl,
    tags: event.tags?.map((et) => et.tag.slug) ?? [],
    categoryId: event.categoryId,
    categoryName,
    locationName: event.locationName,
    locationAddress: event.locationAddress,
    locationUrl: event.locationUrl,
    isOnline: event.isOnline,
    maxParticipants: event.maxParticipants,
    isPublic: event.isPublic,
    price: event.price,
    currency: event.currency,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}

export function formatParticipantForWebhook(participant: ParticipantWithEvent, locale?: string): any {
  const l = locale ?? 'it';
  const eventTitle = pickTranslation(participant.event?.translations ?? [], l)?.title ?? 'Unknown Event';

  return {
    id: participant.id,
    eventId: participant.eventId,
    eventTitle,
    type: participant.type,
    userName: participant.userName,
    email: participant.email,
    externalId: participant.externalId,
    externalSource: participant.externalSource,
    status: participant.status,
    role: participant.role,
    notes: participant.notes,
    checkedIn: participant.checkedIn,
    checkedInAt: participant.checkedInAt,
    createdAt: participant.createdAt,
  };
}

export function enrichEventData(event: EventWithRelations, locale?: string, additionalData?: Record<string, any>) {
  return { ...formatEventForWebhook(event, locale), ...additionalData };
}

export function enrichParticipantData(
  participant: ParticipantWithEvent,
  locale?: string,
  additionalData?: Record<string, any>,
) {
  return { ...formatParticipantForWebhook(participant, locale), ...additionalData };
}
