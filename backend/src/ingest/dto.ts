import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MetricDto {
  @IsOptional() @IsString() timestamp?: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) cpu?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) memory?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) disk?: number;
  @IsOptional() @IsNumber() net_in?: number;
  @IsOptional() @IsNumber() net_out?: number;
  @IsOptional() @IsNumber() load_avg?: number;
}

/** Agents may batch multiple samples per request. */
export class MetricsBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetricDto)
  metrics!: MetricDto[];
}

export class SecurityEventDto {
  @IsOptional() @IsString() timestamp?: string;
  @IsString() event_type!: string;
  @IsOptional() @IsIn(['low', 'medium', 'high', 'critical']) severity?: string;
  @IsOptional() @IsString() source_ip?: string;
  @IsOptional() @IsString() username?: string;
  @IsOptional() @IsString() message?: string;
}

export class SecurityEventsBatchDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SecurityEventDto)
  events!: SecurityEventDto[];
}
