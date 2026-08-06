import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { IsArray, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { BillingRecordsService } from './billing-records.service';

class BulkEntryDto {
  @IsUUID() service_id!: string;
  @IsNumber() amount!: number;
  @IsOptional() @IsString() notes?: string;
}
class BulkUpsertDto {
  @IsUUID() product_id!: string;
  @IsString() month!: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => BulkEntryDto) entries!: BulkEntryDto[];
}
class UpdateBillingRecordDto {
  @IsOptional() @IsNumber() amount?: number;
  @IsOptional() @IsString() notes?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingRecordsController {
  constructor(private readonly records: BillingRecordsService) {}

  @Get('monthly-form')
  monthlyForm(@Query('product_id') productId: string, @Query('month') month: string) {
    return this.records.monthlyForm(productId, month);
  }

  @Roles('admin', 'operator')
  @Post('records/bulk')
  bulkUpsert(@Body() dto: BulkUpsertDto, @Req() req: any) {
    return this.records.bulkUpsert(dto.product_id, dto.month, dto.entries, req.user.sub);
  }

  @Get('records')
  list(
    @Query('product_id') productId?: string,
    @Query('service_id') serviceId?: string,
    @Query('service_type_id') typeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.records.list({ product_id: productId, service_id: serviceId, service_type_id: typeId, from, to });
  }

  @Get('records/export.csv')
  async exportCsv(
    @Query('product_id') productId: string | undefined,
    @Query('service_id') serviceId: string | undefined,
    @Query('service_type_id') typeId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Res() res: Response,
  ) {
    const rows = await this.records.list({ product_id: productId, service_id: serviceId, service_type_id: typeId, from, to });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="billing-history.csv"');
    res.send(this.records.toCsv(rows));
  }

  @Roles('admin', 'operator')
  @Patch('records/:id')
  update(@Param('id') id: string, @Body() dto: UpdateBillingRecordDto) {
    return this.records.update(id, dto);
  }

  @Roles('admin', 'operator')
  @Delete('records/:id')
  remove(@Param('id') id: string) {
    return this.records.remove(id);
  }
}
