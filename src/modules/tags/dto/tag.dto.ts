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
  id: string;
  clientId: string;
  slug: string;
  label?: Record<string, string>;
}
