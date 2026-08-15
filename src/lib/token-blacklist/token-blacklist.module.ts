import { Global, Module } from '@nestjs/common';
import { TokenBlacklistService } from './token-blacklist.service';

/**
 * TokenBlacklistModule — global module exposing TokenBlacklistService.
 *
 * Imported once in AppModule. Guards and strategies can inject
 * TokenBlacklistService without re-importing this module.
 */
@Global()
@Module({
  providers: [TokenBlacklistService],
  exports: [TokenBlacklistService],
})
export class TokenBlacklistModule {}
