import {
  IsString,
  IsOptional,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CategoryTranslationDto {
  @ApiProperty({ example: 'it' })
  @IsString()
  @MaxLength(10)
  locale: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;
}

export class CreateCategoryDto {
  @ApiProperty({ type: [CategoryTranslationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationDto)
  translations: CategoryTranslationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional({ type: [CategoryTranslationDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationDto)
  translations?: CategoryTranslationDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  icon?: string;
}

export class CategoryTranslationResponseDto {
  locale: string;
  name: string;
}

export class CategoryResponseDto {
  id: string;
  clientId: string;
  color?: string;
  icon?: string;
  translations: CategoryTranslationResponseDto[];
  _count?: { events: number };
}
