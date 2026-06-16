import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ServersController } from './servers.controller';
import { ServersService } from './servers.service';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  controllers: [ServersController],
  providers: [ServersService],
})
export class ServersModule {}
