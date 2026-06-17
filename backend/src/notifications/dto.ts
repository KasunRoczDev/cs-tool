import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  IsArray,
  ValidateNested,
  IsObject,
} from 'class-validator';
import { Type } from 'class-transformer';

// ── Channel ──────────────────────────────────────────────────────────────────

export class EmailConfig {
  @IsString() to!: string;           // comma-separated recipient list
  @IsOptional() @IsString() cc?: string;
  @IsOptional() @IsString() subject_prefix?: string; // defaults to "[Monitor Alert]"
}

export class CreateChannelDto {
  @IsString() name!: string;
  /** Only 'email' for now; extend later. */
  @IsIn(['email']) type!: string;
  @IsObject() config!: Record<string, any>;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateChannelDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsObject() config?: Record<string, any>;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

// ── Rule ─────────────────────────────────────────────────────────────────────

const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const ALERT_TYPES = [
  'cpu_high', 'mem_high', 'disk_full', 'offline', 'ssh_bruteforce',
  'brute_force', 'ssh_failed_login', 'firewall_block', 'port_scan',
  'privilege_escalation', 'sudo', 'malware', 'data_exfiltration',
];

export class CreateRuleDto {
  @IsUUID() channel_id!: string;
  @IsOptional() @IsUUID() server_id?: string;
  @IsOptional() @IsIn(ALERT_TYPES) alert_type?: string;
  @IsOptional() @IsArray() @IsIn(SEVERITIES, { each: true }) severities?: string[];
  @IsOptional() @IsBoolean() on_open?: boolean;
  @IsOptional() @IsBoolean() on_resolve?: boolean;
  @IsOptional() @IsInt() @Min(0) cooldown_minutes?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateRuleDto {
  @IsOptional() @IsUUID() server_id?: string | null;
  @IsOptional() @IsIn(ALERT_TYPES) alert_type?: string | null;
  @IsOptional() @IsArray() @IsIn(SEVERITIES, { each: true }) severities?: string[];
  @IsOptional() @IsBoolean() on_open?: boolean;
  @IsOptional() @IsBoolean() on_resolve?: boolean;
  @IsOptional() @IsInt() @Min(0) cooldown_minutes?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class TestChannelDto {
  @IsUUID() channel_id!: string;
}
