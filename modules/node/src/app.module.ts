import { Module } from "@nestjs/common";

import { AdminModule } from "./admin/admin.module";
import { AppRegistryModule } from "./appRegistry/appRegistry.module";
import { AuthModule } from "./auth/auth.module";
import { CFCoreController } from "./cfCore/cfCore.controller";
import { CFCoreModule } from "./cfCore/cfCore.module";
import { ChannelModule } from "./channel/channel.module";
import { ConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { ListenerModule } from "./listener/listener.module";
import { LockModule } from "./lock/lock.module";
import { MessagingModule } from "./messaging/messaging.module";
import { RedisModule } from "./redis/redis.module";
import { SwapRateModule } from "./swapRate/swapRate.module";
import { TransferModule } from "./transfer/transfer.module";

@Module({
  controllers: [CFCoreController],
  exports: [ConfigModule],
  imports: [
    AdminModule,
    AppRegistryModule,
    AuthModule,
    CFCoreModule,
    ChannelModule,
    ConfigModule,
    DatabaseModule,
    ListenerModule,
    LockModule,
    MessagingModule,
    RedisModule,
    SwapRateModule,
    TransferModule,
  ],
  providers: [],
})
export class AppModule {}
