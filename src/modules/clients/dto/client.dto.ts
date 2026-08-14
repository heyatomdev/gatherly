import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClientDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ default: 'it', example: 'it' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLocale?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  emailActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;
}

export class UpdateClientDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  defaultLocale?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  emailActive?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  webhookUrl?: string;
}
