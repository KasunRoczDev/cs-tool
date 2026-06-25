import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../database/database.module';
import { TopologyService } from './topology.service';
import { TopologyController } from './topology.controller';

@Module({
  imports: [
    DatabaseModule,
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  providers: [TopologyService],
  controllers: [TopologyController],
  exports: [TopologyService],
})
export class TopologyModule {}
