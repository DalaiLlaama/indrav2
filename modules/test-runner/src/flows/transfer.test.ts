import { xkeyKthAddress } from "@connext/cf-core";
import { IConnextClient } from "@connext/types";
import { AddressZero } from "ethers/constants";

import {
  createClient,
  ETH_AMOUNT_SM,
  fundChannel,
  requestCollateral,
  TOKEN_AMOUNT_SM,
} from "../util";
import { asyncTransferAsset } from "../util/helpers/asyncTransferAsset";

describe("Full Flow: Transfer", function(): void {
  // @ts-ignore
  this.timeout(60_000);
  let clientA: IConnextClient;
  let tokenAddress: string;

  beforeEach(async () => {
    clientA = await createClient();
    tokenAddress = clientA.config.contractAddresses.Token;
  });

  it("User transfers ETH to multiple clients", async () => {
    const clientB = await createClient();
    const clientC = await createClient();
    const clientD = await createClient();
    const clientE = await createClient();

    // fund sender
    await fundChannel(clientA, ETH_AMOUNT_SM.mul(4), AddressZero);

    // collateralize recipients
    await requestCollateral(clientB, AddressZero);
    await requestCollateral(clientC, AddressZero);
    await requestCollateral(clientD, AddressZero);
    await requestCollateral(clientE, AddressZero);

    await asyncTransferAsset(clientA, clientB, ETH_AMOUNT_SM, AddressZero);
    await asyncTransferAsset(clientA, clientC, ETH_AMOUNT_SM, AddressZero);
    await asyncTransferAsset(clientA, clientD, ETH_AMOUNT_SM, AddressZero);
    await asyncTransferAsset(clientA, clientE, ETH_AMOUNT_SM, AddressZero);
  });

  it("User transfers tokens to multiple clients", async () => {
    const clientB = await createClient();
    const clientC = await createClient();
    const clientD = await createClient();
    const clientE = await createClient();

    // fund sender
    await fundChannel(clientA, TOKEN_AMOUNT_SM.mul(4), tokenAddress);

    // collateralize recipients
    await requestCollateral(clientB, tokenAddress);
    await requestCollateral(clientC, tokenAddress);
    await requestCollateral(clientD, tokenAddress);
    await requestCollateral(clientE, tokenAddress);

    await asyncTransferAsset(clientA, clientB, TOKEN_AMOUNT_SM, tokenAddress);
    await asyncTransferAsset(clientA, clientC, TOKEN_AMOUNT_SM, tokenAddress);
    await asyncTransferAsset(clientA, clientD, TOKEN_AMOUNT_SM, tokenAddress);
    await asyncTransferAsset(clientA, clientE, TOKEN_AMOUNT_SM, tokenAddress);
  });

  it("User receives multiple ETH transfers ", async () => {
    const clientB = await createClient();
    const clientC = await createClient();
    const clientD = await createClient();
    const clientE = await createClient();

    // fund senders
    await fundChannel(clientB, ETH_AMOUNT_SM, AddressZero);
    await fundChannel(clientC, ETH_AMOUNT_SM, AddressZero);
    await fundChannel(clientD, ETH_AMOUNT_SM, AddressZero);
    await fundChannel(clientE, ETH_AMOUNT_SM, AddressZero);

    await requestCollateral(clientA, AddressZero);

    await asyncTransferAsset(clientB, clientA, ETH_AMOUNT_SM, AddressZero);
    await asyncTransferAsset(clientC, clientA, ETH_AMOUNT_SM, AddressZero);
    await asyncTransferAsset(clientD, clientA, ETH_AMOUNT_SM, AddressZero);
    await asyncTransferAsset(clientE, clientA, ETH_AMOUNT_SM, AddressZero);
  });

  it("User receives multiple token transfers ", async () => {
    const clientB = await createClient();
    const clientC = await createClient();
    const clientD = await createClient();
    const clientE = await createClient();

    // fund senders
    await fundChannel(clientB, TOKEN_AMOUNT_SM, tokenAddress);
    await fundChannel(clientC, TOKEN_AMOUNT_SM, tokenAddress);
    await fundChannel(clientD, TOKEN_AMOUNT_SM, tokenAddress);
    await fundChannel(clientE, TOKEN_AMOUNT_SM, tokenAddress);

    await requestCollateral(clientA, tokenAddress);

    await asyncTransferAsset(clientB, clientA, TOKEN_AMOUNT_SM, tokenAddress);
    await asyncTransferAsset(clientC, clientA, TOKEN_AMOUNT_SM, tokenAddress);
    await asyncTransferAsset(clientD, clientA, TOKEN_AMOUNT_SM, tokenAddress);
    await asyncTransferAsset(clientE, clientA, TOKEN_AMOUNT_SM, tokenAddress);
  });
});
