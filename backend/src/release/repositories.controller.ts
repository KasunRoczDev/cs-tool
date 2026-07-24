import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsOptional,
  IsString,
  IsBoolean,
} from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { RepositoriesService } from './repositories.service';

class CreateRepoDto {
  @IsString() name!: string;
  @IsString() slug!: string;
  @IsString() remote_url!: string;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() default_branch?: string;
  @IsOptional() @IsArray() tech_stack?: string[];
  @IsOptional() @IsString() docker_image_name?: string;
  @IsOptional() @IsString() container_registry?: string;
  @IsOptional() @IsString() product_id?: string;
  @IsOptional() @IsString() github_token?: string;
}

class UpdateRepoDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsString() remote_url?: string;
  @IsOptional() @IsString() provider?: string;
  @IsOptional() @IsString() default_branch?: string;
  @IsOptional() @IsArray() tech_stack?: string[];
  @IsOptional() @IsString() docker_image_name?: string;
  @IsOptional() @IsString() container_registry?: string;
  @IsOptional() @IsString() product_id?: string;
  @IsOptional() @IsBoolean() is_active?: boolean;
  // Empty string clears the stored token; a value sets/rotates it.
  @IsOptional() @IsString() github_token?: string;
}

class CreateVersionDto {
  @IsString() version!: string;
  @IsOptional() @IsString() commit_sha?: string;
  @IsOptional() @IsString() prerelease?: string;
}

class CreateBranchDto {
  @IsString() name!: string;
  // Base ref to branch from; defaults to the repo's default branch.
  @IsOptional() @IsString() from?: string;
}

@UseGuards(JwtAuthGuard)
@Controller('repositories')
export class RepositoriesController {
  constructor(private readonly repos: RepositoriesService) {}

  @Get()
  list() {
    return this.repos.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.repos.get(id);
  }

  @Roles('admin', 'operator')
  @Post()
  create(@Body() dto: CreateRepoDto) {
    return this.repos.create(dto);
  }

  @Roles('admin', 'operator')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateRepoDto) {
    return this.repos.update(id, dto);
  }

  @Roles('admin')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.repos.remove(id);
  }

  @Roles('admin', 'operator')
  @Post(':id/sync')
  sync(@Param('id') id: string) {
    return this.repos.sync(id);
  }

  @Get(':id/branches')
  branches(@Param('id') id: string) {
    return this.repos.branches(id);
  }

  @Roles('admin', 'operator')
  @Post(':id/branches')
  createBranch(@Param('id') id: string, @Body() dto: CreateBranchDto) {
    return this.repos.createBranch(id, dto.name, dto.from);
  }

  // Branch names contain slashes (feature/x), so take the name as a query param.
  @Roles('admin', 'operator')
  @Delete(':id/branches')
  deleteBranch(@Param('id') id: string, @Query('name') name: string) {
    return this.repos.deleteBranch(id, name);
  }

  @Get(':id/branches/compare')
  compareBranches(
    @Param('id') id: string,
    @Query('base') base: string,
    @Query('head') head: string,
  ) {
    return this.repos.compareBranches(id, base, head);
  }

  @Get(':id/branches/conflicts')
  detectConflicts(
    @Param('id') id: string,
    @Query('base') base: string,
    @Query('head') head: string,
  ) {
    return this.repos.detectConflicts(id, base, head);
  }

  @Get(':id/branches/history')
  branchHistory(
    @Param('id') id: string,
    @Query('branch') branch: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : undefined;
    return this.repos.branchHistory(id, branch, Number.isFinite(n) ? n : undefined);
  }

  @Get(':id/commits')
  commits(
    @Param('id') id: string,
    @Query('branch') branch?: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : undefined;
    return this.repos.commits(id, branch, Number.isFinite(n) ? n : undefined);
  }

  @Get(':id/versions')
  listVersions(@Param('id') id: string) {
    return this.repos.listVersions(id);
  }

  @Roles('admin', 'operator')
  @Post(':id/versions')
  createVersion(@Param('id') id: string, @Body() dto: CreateVersionDto) {
    return this.repos.createVersion(id, dto);
  }
}
