import { bigNumberify } from "ethers/utils";
import { EventEmitter } from "events";

import { ChannelRouter } from "./channelRouter";
import { ConnextClient } from "./connext";
import { Logger } from "./lib/logger";
import { stringify } from "./lib/utils";
import {
  AppInstanceInfo,
  CFCoreTypes,
  CreateChannelMessage,
  DepositConfirmationMessage,
  DepositFailedMessage,
  DepositStartedMessage,
  InstallMessage,
  InstallVirtualMessage,
  NodeMessageWrappedProtocolMessage,
  ProposeMessage,
  RegisteredAppDetails,
  RejectInstallVirtualMessage,
  RejectProposalMessage,
  SupportedApplications,
  UninstallMessage,
  UninstallVirtualMessage,
  UpdateStateMessage,
  WithdrawConfirmationMessage,
  WithdrawFailedMessage,
  WithdrawStartedMessage,
} from "./types";
import { appProposalValidation } from "./validation/appProposals";

// TODO: index of connext events only?
type CallbackStruct = {
  [index in keyof typeof CFCoreTypes.EventName]: (data: any) => Promise<any> | void;
};

export class ConnextListener extends EventEmitter {
  private log: Logger;
  private channelRouter: ChannelRouter;
  private connext: ConnextClient;

  // TODO: add custom parsing functions here to convert event data
  // to something more usable?
  private defaultCallbacks: CallbackStruct = {
    COUNTER_DEPOSIT_CONFIRMED: (msg: DepositConfirmationMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.COUNTER_DEPOSIT_CONFIRMED, msg.data);
    },
    CREATE_CHANNEL: (msg: CreateChannelMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.CREATE_CHANNEL, msg.data);
    },
    DEPOSIT_CONFIRMED: async (msg: DepositConfirmationMessage): Promise<void> => {
      this.emitAndLog(CFCoreTypes.EventName.DEPOSIT_CONFIRMED, msg.data);
    },
    DEPOSIT_FAILED: (msg: DepositFailedMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.DEPOSIT_FAILED, msg.data);
    },
    DEPOSIT_STARTED: (msg: DepositStartedMessage): void => {
      const { value, txHash } = msg.data;
      this.log.info(`deposit for ${value.toString()} started. hash: ${txHash}`);
      this.emitAndLog(CFCoreTypes.EventName.DEPOSIT_STARTED, msg.data);
    },
    INSTALL: (msg: InstallMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.INSTALL, msg.data);
    },
    // TODO: make cf return app instance id and app def?
    INSTALL_VIRTUAL: (msg: InstallVirtualMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.INSTALL_VIRTUAL, msg.data);
    },
    PROPOSE_INSTALL: async (msg: ProposeMessage): Promise<void> => {
      // validate and automatically install for the known and supported
      // applications
      this.emitAndLog(CFCoreTypes.EventName.PROPOSE_INSTALL, msg.data);
      // check based on supported applications
      // matched app, take appropriate default actions
      const matchedResult = await this.matchAppInstance(msg);
      if (!matchedResult) {
        this.log.warn(`No matched app, doing nothing, ${stringify(msg)}`);
        return;
      }
      // return if its from us
      if (msg.from === this.connext.publicIdentifier) {
        this.log.info(`Received proposal from our own node, doing nothing: ${stringify(msg)}`);
        return;
      }
      // matched app, take appropriate default actions
      const { appInfo, matchedApp } = matchedResult;
      await this.verifyAndInstallKnownApp(appInfo, matchedApp);
      return;
    },
    PROTOCOL_MESSAGE_EVENT: (msg: NodeMessageWrappedProtocolMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.PROTOCOL_MESSAGE_EVENT, msg.data);
    },

    REJECT_INSTALL: (msg: RejectProposalMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.REJECT_INSTALL, msg.data);
    },
    REJECT_INSTALL_VIRTUAL: (msg: RejectInstallVirtualMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.REJECT_INSTALL_VIRTUAL, msg.data);
    },
    UNINSTALL: (msg: UninstallMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.UNINSTALL, msg.data);
    },
    UNINSTALL_VIRTUAL: (msg: UninstallVirtualMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.UNINSTALL_VIRTUAL, msg.data);
    },
    UPDATE_STATE: (msg: UpdateStateMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.UPDATE_STATE, msg.data);
    },
    WITHDRAWAL_CONFIRMED: (msg: WithdrawConfirmationMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.WITHDRAWAL_CONFIRMED, msg.data);
    },
    WITHDRAWAL_FAILED: (msg: WithdrawFailedMessage): void => {
      this.emitAndLog(CFCoreTypes.EventName.WITHDRAWAL_FAILED, msg.data);
    },
    WITHDRAWAL_STARTED: (msg: WithdrawStartedMessage): void => {
      const {
        params: { amount },
        txHash,
      } = msg.data;
      this.log.info(`withdrawal for ${amount.toString()} started. hash: ${txHash}`);
      this.emitAndLog(CFCoreTypes.EventName.WITHDRAWAL_STARTED, msg.data);
    },
  };

  constructor(channelRouter: ChannelRouter, connext: ConnextClient) {
    super();
    this.channelRouter = channelRouter;
    this.connext = connext;
    this.log = new Logger("ConnextListener", connext.log.logLevel);
  }

  public register = async (): Promise<void> => {
    await this.registerAvailabilitySubscription();
    this.registerDefaultListeners();
    await this.registerLinkedTransferSubscription();
    return;
  };

  public registerCfListener = (event: CFCoreTypes.EventName, cb: Function): void => {
    // replace with new fn
    this.log.debug(`Registering listener for ${event}`);
    this.channelRouter.on(
      event,
      async (res: any): Promise<void> => {
        await cb(res);
        this.emit(event, res);
      },
    );
  };

  public removeCfListener = (event: CFCoreTypes.EventName, cb: Function): boolean => {
    this.log.debug(`Removing listener for ${event}`);
    try {
      this.removeListener(event, cb as any);
      return true;
    } catch (e) {
      this.log.error(
        `Error trying to remove registered listener from event: ${event}. Error: ${e.message}`,
      );
      return false;
    }
  };

  public registerDefaultListeners = (): void => {
    Object.entries(this.defaultCallbacks).forEach(([event, callback]: any): any => {
      this.channelRouter.on(CFCoreTypes.EventName[event], callback);
    });

    this.channelRouter.on(
      CFCoreTypes.RpcMethodName.INSTALL,
      async (msg: any): Promise<void> => {
        const {
          result: {
            result: { appInstance },
          },
        } = msg;
        await this.connext.messaging.publish(
          `indra.client.${this.connext.publicIdentifier}.install.${appInstance.identityHash}`,
          stringify(appInstance),
        );
      },
    );

    this.channelRouter.on(CFCoreTypes.RpcMethodName.UNINSTALL, (data: any): any => {
      const result = data.result.result;
      this.log.debug(`Emitting CFCoreTypes.RpcMethodName.UNINSTALL event: ${stringify(result)}`);
      this.connext.messaging.publish(
        `indra.client.${this.connext.publicIdentifier}.uninstall.${result.appInstanceId}`,
        stringify(result),
      );
    });
  };

  private emitAndLog = (event: CFCoreTypes.EventName, data: any): void => {
    this.log.debug(`Emitted ${event} with data ${stringify(data)} at ${Date.now()}`);
    this.emit(event, data);
  };

  private matchAppInstance = async (
    msg: ProposeMessage,
  ): Promise<{ matchedApp: RegisteredAppDetails; appInfo: AppInstanceInfo } | undefined> => {
    const filteredApps = this.connext.appRegistry.filter((app: RegisteredAppDetails): boolean => {
      return app.appDefinitionAddress === msg.data.params.appDefinition;
    });

    if (!filteredApps || filteredApps.length === 0) {
      this.log.info(`Proposed app not in registered applications. App: ${stringify(msg)}`);
      return undefined;
    }

    if (filteredApps.length > 1) {
      // TODO: throw error here?
      this.log.error(
        `Proposed app matched ${
          filteredApps.length
        } registered applications by definition address. App: ${stringify(msg)}`,
      );
      return undefined;
    }
    const { params, appInstanceId } = msg.data;
    const {
      initiatorDeposit,
      initiatorDepositTokenAddress,
      responderDeposit,
      responderDepositTokenAddress,
    } = params;
    // matched app, take appropriate default actions
    return {
      appInfo: {
        ...params,
        identityHash: appInstanceId,
        initiatorDeposit: bigNumberify(initiatorDeposit),
        initiatorDepositTokenAddress,
        proposedByIdentifier: msg.from,
        proposedToIdentifier: this.connext.publicIdentifier,
        responderDeposit: bigNumberify(responderDeposit),
        responderDepositTokenAddress,
      },
      matchedApp: filteredApps[0],
    };
  };

  private verifyAndInstallKnownApp = async (
    appInstance: AppInstanceInfo,
    matchedApp: RegisteredAppDetails,
  ): Promise<void> => {
    // virtual is now determined by presence of intermediary identifier
    const isVirtual = !!appInstance.intermediaryIdentifier;
    const invalidProposal = await appProposalValidation[matchedApp.name](
      appInstance,
      matchedApp,
      isVirtual,
      this.connext,
    );

    if (invalidProposal) {
      // reject app installation
      this.log.error(`Proposed app is invalid. ${invalidProposal}`);
      await this.connext.rejectInstallApp(appInstance.identityHash);
      return;
    }

    // proposal is valid, automatically install known app, but
    // do not ever automatically install swap app since theres no
    // way to validate the exchange in app against the rate input
    // to controller
    // this means the hub can only install apps, and cannot propose a swap
    // and there cant easily be an automatic install swap app between users
    if (matchedApp.name === SupportedApplications.SimpleTwoPartySwapApp) {
      return;
    }

    if (matchedApp.name === SupportedApplications.SimpleTransferApp) {
      // request collateral in token of the app
      await this.connext.requestCollateral(appInstance.initiatorDepositTokenAddress);
    }
    this.log.debug(`Proposal for app install successful, attempting install now...`);
    let res: CFCoreTypes.InstallResult;
    if (isVirtual) {
      res = await this.connext.installVirtualApp(appInstance.identityHash);
    } else {
      res = await this.connext.installApp(appInstance.identityHash);
    }
    this.log.debug(`App installed, res: ${stringify(res)}`);
    return;
  };

  private registerAvailabilitySubscription = async (): Promise<void> => {
    const subject = `online.${this.connext.publicIdentifier}`;
    await this.connext.messaging.subscribe(
      subject,
      async (msg: any): Promise<any> => {
        if (!msg.reply) {
          this.log.warn(`No reply found for msg: ${msg}`);
          return;
        }

        const response = true;
        this.connext.messaging.publish(msg.reply, {
          err: null,
          response,
        });
      },
    );
    this.log.debug(`Connected message pattern "${subject}"`);
  };

  private registerLinkedTransferSubscription = async (): Promise<void> => {
    const subject = `transfer.send-async.${this.connext.publicIdentifier}`;
    await this.connext.messaging.subscribe(subject, async (data: any) => {
      this.log.info(`Received message for subscription: ${stringify(data)}`);
      let paymentId: string;
      let encryptedPreImage: string;
      let amount: string;
      let assetId: string;
      if (data.paymentId) {
        this.log.debug(`Not nested data`);
        paymentId = data.paymentId;
        encryptedPreImage = data.encryptedPreImage;
        amount = data.amount;
        assetId = data.assetId;
      } else if (data.data) {
        this.log.debug(`Nested data`);
        const parsedData = JSON.parse(data.data);
        paymentId = parsedData.paymentId;
        encryptedPreImage = parsedData.encryptedPreImage;
        amount = parsedData.amount;
        assetId = parsedData.assetId;
      } else {
        throw new Error(`Could not parse data from message: ${stringify(data)}`);
      }

      if (!paymentId || !encryptedPreImage) {
        throw new Error(`Unable to parse transfer details from message ${stringify(data)}`);
      }
      await this.connext.reclaimPendingAsyncTransfer(paymentId, encryptedPreImage);
      this.log.info(`Successfully reclaimed transfer with paymentId: ${paymentId}`);
    });
  };
}
