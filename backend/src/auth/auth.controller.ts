import { Body, Controller, Delete, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { IsBoolean, IsEmail, IsObject, IsOptional, IsString } from 'class-validator';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TrustedDeviceService } from './trusted-device.service';
import { PasskeyService } from './passkey.service';
import { JwtAuthGuard } from '../common/jwt-auth.guard';

const DEVICE_COOKIE = 'device_token';
const DEVICE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/auth',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

class LoginDto {
  @IsEmail() email!: string;
  @IsString() password!: string;
}

class MfaDto {
  @IsString() mfa_token!: string;
  @IsString() code!: string;
  @IsOptional() @IsBoolean() trust_device?: boolean;
}

class PasskeyEmailDto {
  @IsEmail() email!: string;
}

class PasskeyRegisterVerifyDto {
  @IsString() reg_token!: string;
  @IsObject() credential!: Record<string, any>;
}

class PasskeyLoginVerifyDto {
  @IsString() auth_token!: string;
  @IsObject() credential!: Record<string, any>;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly trustedDevices: TrustedDeviceService,
    private readonly passkeys: PasskeyService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, req.cookies?.[DEVICE_COOKIE]);
  }

  @Post('mfa/verify')
  async verifyMfa(@Body() dto: MfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyMfa(
      dto.mfa_token, dto.code, !!dto.trust_device, req.headers['user-agent'], req.ip,
    );
    return this.finishWithDeviceCookie(result, res);
  }

  @Post('mfa/enroll')
  async enrollMfa(@Body() dto: MfaDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.enrollMfa(
      dto.mfa_token, dto.code, !!dto.trust_device, req.headers['user-agent'], req.ip,
    );
    return this.finishWithDeviceCookie(result, res);
  }

  private finishWithDeviceCookie(result: any, res: Response) {
    if (result.device_token) {
      res.cookie(DEVICE_COOKIE, result.device_token, DEVICE_COOKIE_OPTS);
      delete result.device_token;
      delete result.device_expires_at;
    }
    return result;
  }

  // Returns the current authenticated user (from the JWT).
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: any) {
    return req.user;
  }

  // ── Trusted devices ─────────────────────────────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('devices')
  listDevices(@Req() req: any) {
    const currentTokenHash = req.cookies?.[DEVICE_COOKIE] ? this.trustedDevices.hash(req.cookies[DEVICE_COOKIE]) : null;
    return this.trustedDevices.list(req.user.sub, currentTokenHash);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('devices')
  async revokeAllDevices(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    await this.trustedDevices.revokeAll(req.user.sub);
    res.clearCookie(DEVICE_COOKIE, { path: '/api/v1/auth' });
    return { ok: true };
  }

  @UseGuards(JwtAuthGuard)
  @Delete('devices/:id')
  async revokeDevice(@Param('id') id: string, @Req() req: any, @Res({ passthrough: true }) res: Response) {
    const currentTokenHash = req.cookies?.[DEVICE_COOKIE] ? this.trustedDevices.hash(req.cookies[DEVICE_COOKIE]) : null;
    const { revoked, wasCurrent } = await this.trustedDevices.revoke(req.user.sub, id, currentTokenHash);
    if (wasCurrent) res.clearCookie(DEVICE_COOKIE, { path: '/api/v1/auth' });
    return { ok: revoked };
  }

  // ── Passkeys: management (must be logged in) ────────────────────────────
  @UseGuards(JwtAuthGuard)
  @Get('passkeys')
  listPasskeys(@Req() req: any) {
    return this.passkeys.list(req.user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('passkeys/:id')
  async removePasskey(@Param('id') id: string, @Req() req: any) {
    return { ok: await this.passkeys.remove(req.user.sub, id) };
  }

  @UseGuards(JwtAuthGuard)
  @Post('passkeys/register/options')
  async passkeyRegisterOptions(@Req() req: any) {
    const options = await this.passkeys.registrationOptions(req.user.sub, req.user.email);
    const reg_token = this.auth.signChallenge('passkey_reg', req.user.sub, options.challenge);
    return { options, reg_token };
  }

  @UseGuards(JwtAuthGuard)
  @Post('passkeys/register/verify')
  async passkeyRegisterVerify(@Body() dto: PasskeyRegisterVerifyDto, @Req() req: any) {
    const claims = this.auth.verifyChallenge('passkey_reg', dto.reg_token, req.user.sub);
    await this.passkeys.verifyRegistration(req.user.sub, claims.challenge, dto.credential);
    return { ok: true };
  }

  // ── Passkeys: passwordless login (unauthenticated) ──────────────────────
  @Post('passkeys/login/options')
  async passkeyLoginOptions(@Body() dto: PasskeyEmailDto) {
    const { options, userId } = await this.passkeys.authenticationOptions(dto.email);
    const auth_token = this.auth.signChallenge('passkey_auth', userId ?? 'unknown', options.challenge);
    return { options, auth_token };
  }

  @Post('passkeys/login/verify')
  async passkeyLoginVerify(@Body() dto: PasskeyLoginVerifyDto) {
    const claims = this.auth.verifyChallenge('passkey_auth', dto.auth_token);
    const user = await this.passkeys.verifyAuthentication(claims.challenge, dto.credential);
    return this.auth.issueAccessToken(user);
  }
}
