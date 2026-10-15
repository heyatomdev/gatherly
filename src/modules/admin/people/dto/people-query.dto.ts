import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PageParams } from '@heyatom/nest-common';

export enum PersonSegment {
  NEW = 'new',
  RETURNING = 'returning',
  VIP = 'vip',
  AT_RISK = 'at_risk',
}

export class PeopleQueryDto extends PageParams {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: PersonSegment })
  @IsOptional()
  @IsEnum(PersonSegment)
  segment?: PersonSegment;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minEvents?: number = 1;
}
