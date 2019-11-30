import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module";
import { CFCoreModule } from "../cfCore/cfCore.module";
import { ChannelModule } from "../channel/channel.module";
import { MessagingModule } from "../messaging/messaging.module";

import { adminProviderFactory } from "./admin.provider";
import { AdminService } from "./admin.service";

@Module({
  controllers: [],
  exports: [AdminService],
  imports: [MessagingModule, CFCoreModule, ChannelModule, AuthModule],
  providers: [AdminService, adminProviderFactory],
})
export class AdminModule {}
