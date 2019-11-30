import * as connext from "@connext/client";
import { CFCoreTypes, ClientOptions, IConnextClient, makeChecksum } from "@connext/types";
import { AddressZero } from "ethers/constants";
import { parseEther } from "ethers/utils";

import { config } from "./config";
import { Store } from "./store";
import { logEthFreeBalance } from "./utils";

export const getOrCreateChannel = async (assetId?: string): Promise<IConnextClient> => {
  const store = new Store();

  const connextOpts: ClientOptions = {
    ethProviderUrl: config.ethProviderUrl,
    logLevel: config.logLevel,
    mnemonic: config.mnemonic,
    nodeUrl: config.nodeUrl,
    store,
  };
  const client = await connext.connect(connextOpts);
  await client.isAvailable;
  const nodeFBAddress = connext.utils.xpubToAddress(client.nodePublicIdentifier);
  console.log("Payment bot launched:");
  console.log(` - mnemonic: ${connextOpts.mnemonic}`);
  console.log(` - ethProviderUrl: ${connextOpts.ethProviderUrl}`);
  console.log(` - nodeUrl: ${connextOpts.nodeUrl}`);
  console.log(` - publicIdentifier: ${client.publicIdentifier}`);
  console.log(` - multisigAddress: ${client.multisigAddress}`);
  console.log(` - User freeBalanceAddress: ${client.freeBalanceAddress}`);
  console.log(` - Node freeBalance address: ${nodeFBAddress}`);

  await client.addPaymentProfile({
    amountToCollateralize: parseEther("0.1").toString(),
    assetId: AddressZero,
    minimumMaintainedCollateral: parseEther("0.01").toString(),
  });

  if (assetId) {
    await client.addPaymentProfile({
      amountToCollateralize: parseEther("10").toString(),
      assetId: makeChecksum(assetId),
      minimumMaintainedCollateral: parseEther("5").toString(),
    });
  }

  client.on(
    CFCoreTypes.EventName.UNINSTALL_VIRTUAL,
    async (data: CFCoreTypes.UninstallVirtualResult): Promise<void> => {
      console.log(`Bot event caught: ${CFCoreTypes.EventName.UNINSTALL_VIRTUAL}`);
      logEthFreeBalance(AddressZero, await client.getFreeBalance());
      if (assetId) {
        logEthFreeBalance(assetId, await client.getFreeBalance(assetId));
      }
    },
  );

  client.on(
    CFCoreTypes.EventName.WITHDRAWAL_CONFIRMED,
    async (data: any): Promise<void> => {
      console.log(`Bot event caught: ${CFCoreTypes.EventName.WITHDRAWAL_CONFIRMED}`);
      logEthFreeBalance(AddressZero, await client.getFreeBalance());
      if (assetId) {
        logEthFreeBalance(assetId, await client.getFreeBalance(assetId));
      }
    },
  );

  return client;
};
