import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TrustedDeviceService } from './trusted-device.service';
import { PasskeyService } from './passkey.service';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  controllers: [AuthController],
  providers: [AuthService, TrustedDeviceService, PasskeyService],
})
export class AuthModule {}
