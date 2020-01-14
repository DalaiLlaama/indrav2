import { IMessagingService } from "@connext/messaging";
import {
  ChannelAppSequences,
  convert,
  GetChannelResponse,
  GetConfigResponse,
  PaymentProfile as PaymentProfileRes,
  RequestCollateralResponse,
  StateChannelJSON,
} from "@connext/types";
import { FactoryProvider } from "@nestjs/common/interfaces";
import { TransactionResponse } from "ethers/providers";
import { bigNumberify, getAddress } from "ethers/utils";

import { AuthService } from "../auth/auth.service";
import { CFCoreRecord } from "../cfCore/cfCore.entity";
import { ConfigService } from "../config/config.service";
import { CFCoreProviderId, ChannelMessagingProviderId, MessagingProviderId } from "../constants";
import { OnchainTransaction } from "../onchainTransactions/onchainTransaction.entity";
import { AbstractMessagingProvider } from "../util";
import { CFCore, CFCoreTypes } from "../util/cfCore";

import { ChannelRepository } from "./channel.repository";
import { ChannelService } from "./channel.service";

// This should be done in the config module but i didnt want to create a circular dependency
class ConfigMessaging extends AbstractMessagingProvider {
  constructor(
    messaging: IMessagingService,
    private readonly cfCore: CFCore,
    private readonly configService: ConfigService,
  ) {
    super(messaging);
  }

  async getConfig(): Promise<GetConfigResponse> {
    return {
      contractAddresses: await this.configService.getContractAddresses(),
      ethNetwork: await this.configService.getEthNetwork(),
      messaging: this.configService.getMessagingConfig(),
      nodePublicIdentifier: this.cfCore.publicIdentifier,
    };
  }

  async setupSubscriptions(): Promise<void> {
    super.connectRequestReponse("config.get", this.getConfig.bind(this));
  }
}

class ChannelMessaging extends AbstractMessagingProvider {
  constructor(
    messaging: IMessagingService,
    private readonly channelRepository: ChannelRepository,
    private readonly channelService: ChannelService,
    private readonly authService: AuthService,
  ) {
    super(messaging);
  }

  async getChannel(pubId: string, data?: unknown): Promise<GetChannelResponse> {
    return (await this.channelRepository.findByUserPublicIdentifier(pubId)) as GetChannelResponse;
  }

  async createChannel(pubId: string): Promise<CFCoreTypes.CreateChannelResult> {
    return await this.channelService.create(pubId);
  }

  async verifyAppSequenceNumber(
    pubId: string,
    data: { userAppSequenceNumber: number },
  ): Promise<ChannelAppSequences> {
    return await this.channelService.verifyAppSequenceNumber(pubId, data.userAppSequenceNumber);
  }

  async requestCollateral(
    pubId: string,
    data: { assetId?: string },
  ): Promise<CFCoreTypes.DepositResult> {
    // do not allow clients to specify an amount to collateralize with
    return this.channelService.requestCollateral(pubId, getAddress(data.assetId));
  }

  async withdraw(
    pubId: string,
    data: { tx: CFCoreTypes.MinimalTransaction },
  ): Promise<TransactionResponse> {
    return this.channelService.withdrawForClient(pubId, data.tx);
  }

  async addPaymentProfile(
    pubId: string,
    data: {
      assetId: string;
      minimumMaintainedCollateral: string;
      amountToCollateralize: string;
    },
  ): Promise<PaymentProfileRes> {
    const {
      amountToCollateralize,
      minimumMaintainedCollateral,
      assetId,
    } = await this.channelService.addPaymentProfileToChannel(
      pubId,
      data.assetId,
      bigNumberify(data.minimumMaintainedCollateral),
      bigNumberify(data.amountToCollateralize),
    );

    return convert.PaymentProfile("str", {
      amountToCollateralize,
      assetId,
      minimumMaintainedCollateral,
    });
  }

  async getPaymentProfile(
    pubId: string,
    data: { assetId?: string },
  ): Promise<PaymentProfileRes | undefined> {
    const prof = await this.channelRepository.getPaymentProfileForChannelAndToken(
      pubId,
      data.assetId,
    );

    if (!prof) {
      return undefined;
    }

    const { amountToCollateralize, minimumMaintainedCollateral, assetId } = prof;
    return convert.PaymentProfile("str", {
      amountToCollateralize,
      assetId,
      minimumMaintainedCollateral,
    });
  }

  async getLatestWithdrawal(subject: string, data: {}): Promise<OnchainTransaction | undefined> {
    const pubId = this.getPublicIdentifierFromSubject(subject);

    const onchainTx = await this.channelService.getLatestWithdrawal(pubId);
    // TODO: conversions needed?
    return onchainTx;
  }

  async getStatesForRestore(pubId: string): Promise<StateChannelJSON> {
    return await this.channelService.getStateChannel(pubId);
  }

  async setupSubscriptions(): Promise<void> {
    await super.connectRequestReponse(
      "channel.get.>",
      this.authService.useVerifiedPublicIdentifier(this.getChannel.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.create.>",
      this.authService.useVerifiedPublicIdentifier(this.createChannel.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.withdraw.>",
      this.authService.useVerifiedPublicIdentifier(this.withdraw.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.request-collateral.>",
      this.authService.useVerifiedPublicIdentifier(this.requestCollateral.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.add-profile.>",
      this.authService.useAdminToken(this.addPaymentProfile.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.get-profile.>",
      this.authService.useVerifiedPublicIdentifier(this.getPaymentProfile.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.verify-app-sequence.>",
      this.authService.useVerifiedPublicIdentifier(this.verifyAppSequenceNumber.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.restore-states.>",
      this.authService.useVerifiedPublicIdentifier(this.getStatesForRestore.bind(this)),
    );
    await super.connectRequestReponse(
      "channel.latestWithdrawal.>",
      this.getLatestWithdrawal.bind(this),
    );
  }
}

export const channelProviderFactory: FactoryProvider<Promise<void>> = {
  inject: [
    MessagingProviderId,
    ChannelRepository,
    ConfigService,
    CFCoreProviderId,
    ChannelService,
    AuthService,
  ],
  provide: ChannelMessagingProviderId,
  useFactory: async (
    messaging: IMessagingService,
    channelRepo: ChannelRepository,
    configService: ConfigService,
    cfCore: CFCore,
    channelService: ChannelService,
    authService: AuthService,
  ): Promise<void> => {
    const channel = new ChannelMessaging(messaging, channelRepo, channelService, authService);
    await channel.setupSubscriptions();
    const config = new ConfigMessaging(messaging, cfCore, configService);
    await config.setupSubscriptions();
  },
};
