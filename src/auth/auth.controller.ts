import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  UseGuards,
  BadRequestException,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { ApiOperation, ApiTags, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtBlacklistService } from './jwt-blacklist.service';
import type { RegisterDto } from './dto/register.dto';
import { Tenant } from '../common/decorators/tenant.decorator';
import { ForgotPasswordSchema } from './dto/forgot-password.dto';
import { ResetPasswordSchema } from './dto/reset-password.dto';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly blacklist: JwtBlacklistService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Inscription nouveau compte marchand' })
  async register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Get('verify-email/:token')
  @ApiOperation({ summary: 'Vérification email via token (path parameter)' })
  @ApiParam({
    name: 'token',
    description: 'Token de confirmation reçu par email',
  })
  async verifyEmail(@Param('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('resend-confirmation')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renvoyer le lien de confirmation email' })
  async resendConfirmation(@Body() body: { email: string }) {
    return this.authService.resendConfirmationEmail(body.email);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion utilisateur (Email/Mdp)' })
  async login(@Body() body: { email: string; motDePasse: string }) {
    return this.authService.login(body.email, body.motDePasse);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Demande de réinitialisation du mot de passe' })
  async forgotPassword(@Body() body: { email: string }) {
    ForgotPasswordSchema.parse(body);
    return this.authService.requestPasswordReset(body.email);
  }

  @Post('reset-password/:token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Réinitialiser le mot de passe (token fourni)' })
  async resetPassword(
    @Param('token') token: string,
    @Body() body: { newPassword: string },
  ) {
    ResetPasswordSchema.parse({ token, newPassword: body.newPassword });
    return this.authService.resetPassword(token, body.newPassword);
  }

  @Post('onboarding/complete')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Marquer onboarding comme complété' })
  async markOnboardingCompleted(@Tenant() accountId: string | null) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }
    return this.authService.markOnboardingCompleted(accountId);
  }

  @Post('profile')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Persister le profil initial du wizard' })
  async updateProfile(
    @Tenant() accountId: string | null,
    @Body()
    body: {
      companyName: string;
      role?: string;
      sector?: string;
      primaryChannels?: string[];
    },
  ) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }
    return this.authService.updateProfile(accountId, body);
  }

  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérification du code de double authentification' })
  async verifyTwoFactor(
    @Body() body: { twoFactorToken: string; code: string },
  ) {
    return this.authService.verifyTwoFactor(body.twoFactorToken, body.code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Rafraîchir les tokens d'authentification" })
  async refresh(@Body() body: { refreshToken: string }) {
    return this.authService.refreshTokens(body.refreshToken);
  }

  /**
   * US-015 – Logout: immediately revoke the current access token via Redis.
   * The token remains in Redis until its natural expiry time.
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Déconnexion — révocation immédiate du token JWT' })
  async logout(
    @Req()
    req: Request & { user?: { accountId: string; iat?: number; exp?: number } },
  ) {
    const user = req.user;
    if (user?.accountId && user.iat !== undefined && user.exp !== undefined) {
      await this.blacklist.revoke(user.accountId, user.iat, user.exp);
    }
    return { success: true, message: 'Déconnecté avec succès' };
  }

  @Post('generate-2fa-secret')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Générer un secret TOTP pour l’enrôlement 2FA' })
  async generateTwoFactorSecret(@Tenant() accountId: string | null) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }
    return this.authService.generateTwoFactorSecret(accountId);
  }

  @Post('enable-2fa')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Activer la 2FA (TOTP) pour un compte' })
  async enableTwoFactor(
    @Tenant() accountId: string | null,
    @Body() body: { code: string },
  ) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }
    return this.authService.enableTwoFactor(accountId, body.code);
  }

  @Post('disable-2fa')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Désactiver la 2FA pour un compte' })
  async disableTwoFactor(@Tenant() accountId: string | null) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }
    return this.authService.disableTwoFactor(accountId);
  }

  @Post('send-2fa-sms')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Envoyer un code 2FA par SMS (placeholder)' })
  async sendTwoFactorSms(
    @Tenant() accountId: string | null,
    @Body() body: { phone?: string },
  ) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }
    return this.authService.sendTwoFactorSms(accountId, body.phone);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Récupérer les informations du compte courant' })
  async me(@Tenant() accountId: string | null) {
    if (!accountId) {
      throw new BadRequestException('Utilisateur non authentifié');
    }
    return this.authService.getAccount(accountId);
  }
}
