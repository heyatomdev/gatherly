import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const DATE = { type: String, format: 'date-time' } as const;

/** Never carries `token` or `webhookSecret`. */
export class ClientResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true, type: String }) tenantId:
    string | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty({ example: 'it' }) defaultLocale: string;
  @ApiProperty() emailActive: boolean;
  @ApiPropertyOptional({ nullable: true, type: String }) webhookUrl:
    string | null;
  @ApiProperty(DATE) createdAt: string;
  @ApiPropertyOptional({ ...DATE, nullable: true }) revokedAt: string | null;
}

export class ClientCreatedResponseDto extends ClientResponseDto {
  @ApiProperty({ description: 'Shown once, on creation' }) token: string;
}

export class ClientTokenResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() token: string;
}

export class WebhookSecretResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'HMAC secret for the webhook-signature header' })
  webhookSecret: string;
}

export class WebhookDeliveryResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() clientId: string;
  @ApiProperty({ example: 'event.created' }) eventType: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  payload: Record<string, unknown>;
  @ApiProperty({ description: 'URL at enqueue time, audit only' })
  webhookUrl: string;
  @ApiProperty() attempts: number;
  @ApiProperty() maxAttempts: number;
  @ApiProperty(DATE) nextRetryAt: string;
  @ApiPropertyOptional({ nullable: true, type: String }) lastError:
    string | null;
  @ApiProperty({ enum: ['PENDING', 'DELIVERED', 'FAILED'] })
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  @ApiProperty(DATE) createdAt: string;
  @ApiProperty(DATE) updatedAt: string;
}
