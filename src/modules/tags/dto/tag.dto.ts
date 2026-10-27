import { IsString, IsOptional, IsObject, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTagDto {
  @ApiProperty({ description: 'Lowercase slug e.g. "5v5", "yoga"' })
  @IsString()
  @MaxLength(50)
  slug: string;

  @ApiPropertyOptional({
    description: 'Localized display labels',
    example: { it: 'Competitivo', en: 'Competitive' },
  })
  @IsOptional()
  @IsObject()
  label?: Record<string, string>;
}

export class UpdateTagDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  label?: Record<string, string>;
}

export class TagResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  clientId: string;

  @ApiProperty()
  slug: string;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { it: 'Competitivo', en: 'Competitive' },
  })
  label: Record<string, string> | null;

  @ApiPropertyOptional({
    description: 'Present on admin list with withUsage=true',
    example: { events: 3 },
  })
  _count?: { events: number };
}
