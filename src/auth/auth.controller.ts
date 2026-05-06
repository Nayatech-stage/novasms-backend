import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Param,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';

type JwtUser = { accountId: string; email: string; role?: string };
import { AuthService } from './auth.service';
import { ApiOperation, ApiBody, ApiTags, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { RegisterDto } from './dto/register.dto';

@ApiTags('Authentification')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

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

  // ✅ ENDPOINT LOGIN
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Connexion utilisateur (Email/Mdp)' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'contact@boutique.ci' },
        motDePasse: { type: 'string', example: 'MonMotDePasse123!' },
      },
    },
  })
  async login(@Body() body: { email: string; motDePasse: string }) {
    return this.authService.login(body.email, body.motDePasse);
  }

  // ✅ NOUVEL ENDPOINT — Marquer onboarding comme complété
  @Post('onboarding/complete')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Marquer l'onboarding comme complété" })
  async markOnboardingCompleted(
    @Request() req: ExpressRequest & { user?: JwtUser },
  ) {
    // req.user contient accountId grâce au JwtStrategy
    const user = req.user;
    if (!user) throw new BadRequestException('Utilisateur non authentifié');
    return this.authService.markOnboardingCompleted(user.accountId);
  }

  @Post('verify-2fa')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Vérification du code de double authentification' })
  async verifyTwoFactor(
    @Body() body: { twoFactorToken: string; code: string },
  ) {
    return this.authService.verifyTwoFactor(body.twoFactorToken, body.code);
  }

  @Post('generate-2fa-secret')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Générer un secret TOTP pour l'enrôlement 2FA" })
  async generateTwoFactorSecret(
    @Request() req: ExpressRequest & { user?: JwtUser },
  ) {
    const user = req.user;
    if (!user) throw new BadRequestException('Utilisateur non authentifié');
    return this.authService.generateTwoFactorSecret(user.accountId);
  }

  @Post('enable-2fa')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Activer la 2FA (TOTP) pour un compte' })
  async enableTwoFactor(
    @Request() req: ExpressRequest & { user?: JwtUser },
    @Body() body: { code: string },
  ) {
    const user = req.user;
    if (!user) throw new BadRequestException('Utilisateur non authentifié');
    return this.authService.enableTwoFactor(user.accountId, body.code);
  }

  @Post('disable-2fa')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Désactiver la 2FA pour un compte' })
  async disableTwoFactor(@Request() req: ExpressRequest & { user?: JwtUser }) {
    const user = req.user;
    if (!user) throw new BadRequestException('Utilisateur non authentifié');
    return this.authService.disableTwoFactor(user.accountId);
  }

  @Post('send-2fa-sms')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Envoyer un code 2FA par SMS (placeholder)' })
  async sendTwoFactorSms(
    @Request() req: ExpressRequest & { user?: JwtUser },
    @Body() body: { phone?: string },
  ) {
    const user = req.user;
    if (!user) throw new BadRequestException('Utilisateur non authentifié');
    return this.authService.sendTwoFactorSms(user.accountId, body.phone);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Récupérer les informations du compte courant' })
  async me(@Request() req: ExpressRequest & { user?: JwtUser }) {
    const user = req.user;
    if (!user) throw new BadRequestException('Utilisateur non authentifié');
    return this.authService.getAccount(user.accountId);
  }
}
