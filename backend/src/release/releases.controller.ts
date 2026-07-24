import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Delete,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { ReleasesService } from './releases.service';

class CreateReleaseDto {
  @IsString() version!: string;
  @IsOptional() @IsString() name?: string;
}
class UpdateReleaseDto {
  @IsOptional() @IsString() name?: string;
}
class AddRepoDto {
  @IsString() repository_id!: string;
  @IsOptional() @IsString() commit_sha?: string;
  @IsOptional() @IsString() ref?: string;
  @IsOptional() @IsString() repo_version?: string;
  @IsOptional() @IsString() branch_name?: string;
}
class AddItemDto {
  @IsIn(['feature', 'bug', 'hotfix']) item_type!: 'feature' | 'bug' | 'hotfix';
  @IsString() item_key!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() author?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  list() {
    return this.releases.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.releases.get(id);
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateReleaseDto, @Req() req: any) {
    return this.releases.create(dto, req.user?.sub);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateReleaseDto) {
    return this.releases.update(id, dto);
  }

  @Roles('admin', 'operator')
  @Post(':id/repositories')
  addRepo(@Param('id') id: string, @Body() dto: AddRepoDto) {
    return this.releases.addRepository(id, dto);
  }

  @Roles('admin', 'operator')
  @Delete(':id/repositories/:linkId')
  removeRepo(@Param('id') id: string, @Param('linkId') linkId: string) {
    return this.releases.removeRepository(id, linkId);
  }

  @Roles('admin', 'operator')
  @Post(':id/items')
  addItem(@Param('id') id: string, @Body() dto: AddItemDto) {
    return this.releases.addItem(id, dto);
  }

  @Roles('admin', 'operator')
  @Delete(':id/items/:itemId')
  removeItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.releases.removeItem(id, itemId);
  }

  @Roles('admin', 'operator')
  @Post(':id/promote')
  promote(@Param('id') id: string, @Req() req: any) {
    return this.releases.promote(id, req.user.sub, req.user?.role);
  }

  @Roles('admin', 'operator')
  @Post(':id/archive')
  archive(@Param('id') id: string, @Req() req: any) {
    return this.releases.archive(id, req.user.sub, req.user?.role);
  }

  @Roles('admin', 'operator')
  @Post(':id/release-notes/generate')
  generateNotes(@Param('id') id: string) {
    return this.releases.generateNotes(id);
  }

  @Get(':id/release-notes')
  getNotes(@Param('id') id: string) {
    return this.releases.getNotes(id);
  }
}
