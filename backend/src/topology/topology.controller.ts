import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsArray, IsOptional } from 'class-validator';
import { JwtAuthGuard, Roles } from '../common/jwt-auth.guard';
import { TopologyService } from './topology.service';

class SaveGraphDto {
  @IsOptional() @IsArray() nodes?: any[];
  @IsOptional() @IsArray() edges?: any[];
}

@UseGuards(JwtAuthGuard)
@Controller('topology')
export class TopologyController {
  constructor(private readonly topology: TopologyService) {}

  /** Saved environments (with node counts) for a product. */
  @Get(':productId/environments')
  envs(@Param('productId') productId: string) {
    return this.topology.listEnvs(productId);
  }

  /** The graph for one product + environment. */
  @Get(':productId/:env')
  get(@Param('productId') productId: string, @Param('env') env: string) {
    return this.topology.get(productId, env);
  }

  /** Replace the graph for one product + environment. */
  @Roles('admin', 'operator')
  @Put(':productId/:env')
  save(
    @Param('productId') productId: string,
    @Param('env') env: string,
    @Body() body: SaveGraphDto,
    @Req() req: any,
  ) {
    return this.topology.save(productId, env, body, req.user?.email);
  }
}
