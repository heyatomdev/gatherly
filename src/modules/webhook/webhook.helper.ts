import { Event, Participant } from '@prisma/client';

type EventWithRelations = Event & {
  translations?: { locale: string; title: string; description?: string | null }[];
  category?: { translations?: { locale: string; name: string }[] } | null;
  tags?: { tag: { slug: string } }[];
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

// No email/notes/metadata: the tenant can fetch the full row by id if it needs it.
export function formatParticipantForWebhook(participant: Participant): any {
  return {
    id: participant.id,
    eventId: participant.eventId,
    type: participant.type,
    userName: participant.userName,
    externalId: participant.externalId,
    externalSource: participant.externalSource,
    status: participant.status,
    role: participant.role,
    checkedIn: participant.checkedIn,
    checkedInAt: participant.checkedInAt,
    createdAt: participant.createdAt,
  };
}
