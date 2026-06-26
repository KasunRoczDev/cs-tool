import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { IsEmail, IsString } from 'class-validator';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

class MfaDto {
  @IsString() mfa_token!: string;
  @IsString() code!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  // Step 2a: already-enrolled user submits their TOTP code.
  @Post('mfa/verify')
  verifyMfa(@Body() dto: MfaDto) {
    return this.auth.verifyMfa(dto.mfa_token, dto.code);
  }

  // Step 2b: first-time user confirms the code shown by their authenticator app.
  @Post('mfa/enroll')
  enrollMfa(@Body() dto: MfaDto) {
    return this.auth.enrollMfa(dto.mfa_token, dto.code);
  }

  // Returns the current authenticated user (from the JWT).
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }
}
