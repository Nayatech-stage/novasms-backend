import { Module } from '@nestjs/common';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtBlacklistService } from './jwt-blacklist.service';

// Validation des variables d'environnement JWT
const jwtAccessSecret = process.env.JWT_ACCESS_SECRET;
const jwtAccessExpiration = process.env.JWT_ACCESS_EXPIRATION;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;
const jwtRefreshExpiration = process.env.JWT_REFRESH_EXPIRATION;

if (
  !jwtAccessSecret ||
  !jwtAccessExpiration ||
  !jwtRefreshSecret ||
  !jwtRefreshExpiration
) {
  throw new Error('Missing required JWT environment variables');
}

// Assertion de type correcte pour expiresIn
const accessExpiresIn = jwtAccessExpiration as JwtSignOptions['expiresIn'];

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: jwtAccessSecret,
      signOptions: { expiresIn: accessExpiresIn },
    }),
  ],
  providers: [JwtStrategy, JwtAuthGuard, JwtBlacklistService],
  exports: [JwtAuthGuard, JwtBlacklistService],
})
export class JwtAuthModule {
  private readonly __moduleBrand = true;
}
