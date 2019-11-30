import { IMessagingService } from "@connext/messaging";
import { FactoryProvider } from "@nestjs/common/interfaces";
import { Lock } from "redlock";

import { AuthService } from "../auth/auth.service";
import { LockProviderId, MessagingProviderId } from "../constants";
import { AbstractMessagingProvider } from "../util";

import { LockService } from "./lock.service";

class LockMessaging extends AbstractMessagingProvider {
  constructor(
    messaging: IMessagingService,
    private readonly lockService: LockService,
    private readonly authService: AuthService,
  ) {
    super(messaging);
  }

  async acquireLock(multisig: string, data: { lockTTL: number }): Promise<string> {
    return await this.lockService.acquireLock(multisig, data.lockTTL);
  }

  async releaseLock(multisig: string, data: { lockValue: string }): Promise<void> {
    return await this.lockService.releaseLock(multisig, data.lockValue);
  }

  async setupSubscriptions(): Promise<void> {
    super.connectRequestReponse(
      "lock.acquire.>",
      this.authService.useVerifiedMultisig(this.acquireLock.bind(this)),
    );
    super.connectRequestReponse(
      "lock.release.>",
      this.authService.useVerifiedMultisig(this.releaseLock.bind(this)),
    );
  }
}

export const lockProviderFactory: FactoryProvider<Promise<void>> = {
  inject: [MessagingProviderId, LockService, AuthService],
  provide: LockProviderId,
  useFactory: async (
    messaging: IMessagingService,
    lockService: LockService,
    authService: AuthService,
  ): Promise<void> => {
    const lock = new LockMessaging(messaging, lockService, authService);
    await lock.setupSubscriptions();
  },
};
