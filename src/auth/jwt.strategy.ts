import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtBlacklistService } from './jwt-blacklist.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly blacklist: JwtBlacklistService) {
    const secret = process.env.JWT_ACCESS_SECRET;

    if (!secret) {
      throw new Error('JWT_ACCESS_SECRET is not defined');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: {
    sub?: string;
    email?: string;
    role?: string;
    iat?: number;
    exp?: number;
    [key: string]: unknown;
  }) {
    // payload contient: { sub: accountId, email, iat, exp }
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Token invalide');
    }

    // US-015: refuse revoked tokens immediately
    if (payload.iat !== undefined) {
      const revoked = await this.blacklist.isRevoked(payload.sub, payload.iat);
      if (revoked) {
        throw new UnauthorizedException(
          'Token révoqué — veuillez vous reconnecter',
        );
      }
    }

    return {
      accountId: payload.sub,
      email: payload.email,
      role: payload.role || 'merchant',
      iat: payload.iat,
      exp: payload.exp,
    };
  }
}
