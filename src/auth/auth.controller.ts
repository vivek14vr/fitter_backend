import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { toPublicUser, type AuthenticatedRequest } from './auth.types.js';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { SignupDto } from './dto/signup.dto.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { RateLimit } from '../common/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit.guard.js';

const REFRESH_COOKIE = 'deepti_refresh_token';
const REFRESH_COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function usesCrossSiteCookie() {
  const configuredSameSite = process.env.AUTH_COOKIE_SAMESITE?.trim().toLowerCase();
  if (configuredSameSite === 'none') return true;
  if (configuredSameSite === 'lax') return false;
  if (process.env.NODE_ENV === 'production') return true;

  return (process.env.FRONTEND_URL ?? '').split(',').some((origin) => {
    try {
      return new URL(origin.trim()).protocol === 'https:';
    } catch {
      return false;
    }
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 60_000)
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.login(loginDto);
    this.setRefreshCookie(response, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('signup')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(RateLimitGuard)
  @RateLimit(5, 60_000)
  async signup(@Body() signupDto: SignupDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.authService.signup(signupDto);
    this.setRefreshCookie(response, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = this.readRefreshCookie(request);
    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(response, result.refreshToken);

    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return { user: toPublicUser(request.user) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 60_000)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const authorization = request.headers.authorization;
    const refreshToken = this.readRefreshCookie(request);

    if (authorization?.startsWith('Bearer ') || refreshToken) {
      await this.authService.logout(
        authorization?.startsWith('Bearer ') ? authorization.slice(7) : '',
        refreshToken,
      );
    }

    this.clearRefreshCookie(response);
  }

  private setRefreshCookie(response: Response, refreshToken: string) {
    const crossSite = usesCrossSiteCookie();
    response.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      // The production frontend and API are hosted on different sites
      // (Amplify and the backend host), so the refresh cookie must be sent
      // with credentialed cross-site requests. Localhost remains same-site.
      sameSite: crossSite ? 'none' : 'lax',
      secure: crossSite,
      maxAge: REFRESH_COOKIE_MAX_AGE,
      path: '/auth',
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(REFRESH_COOKIE, { path: '/auth' });
  }

  private readRefreshCookie(request: Request) {
    const cookieHeader = request.headers.cookie ?? '';
    const refreshCookie = cookieHeader
      .split(';')
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${REFRESH_COOKIE}=`));

    if (!refreshCookie) {
      return '';
    }

    try {
      return decodeURIComponent(refreshCookie.slice(REFRESH_COOKIE.length + 1));
    } catch {
      return '';
    }
  }
}
