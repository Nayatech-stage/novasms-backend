import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
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

  validate(payload: {
    sub?: string;
    email?: string;
    role?: string;
    [key: string]: unknown;
  }) {
    // payload contient: { sub: accountId, email, iat, exp }
    if (!payload.sub || !payload.email) {
      throw new UnauthorizedException('Token invalide');
    }

    return {
      accountId: payload.sub,
      email: payload.email,
      role: payload.role || 'merchant',
    };
  }
}
