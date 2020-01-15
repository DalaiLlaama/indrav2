import { MessagingConfig } from "@connext/messaging";
import {
  ContractAddresses,
  DefaultApp,
  SupportedApplication,
  SupportedApplications,
  SupportedNetworks,
} from "@connext/types";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { Wallet } from "ethers";
import { AddressZero } from "ethers/constants";
import { JsonRpcProvider } from "ethers/providers";
import { getAddress, Network as EthNetwork, parseEther } from "ethers/utils";

import { PaymentProfile } from "../paymentProfile/paymentProfile.entity";
import { OutcomeType } from "../util/cfCore";

type PostgresConfig = {
  database: string;
  host: string;
  password: string;
  port: number;
  username: string;
};

const singleAssetTwoPartyCoinTransferEncoding = `tuple(address to, uint256 amount)[2]`;

const multiAssetMultiPartyCoinTransferEncoding = `tuple(address to, uint256 amount)[][]`;

@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly envConfig: { [key: string]: string };
  private readonly ethProvider: JsonRpcProvider;
  private wallet: Wallet;

  constructor() {
    this.envConfig = process.env;
    this.ethProvider = new JsonRpcProvider(this.getEthRpcUrl());
  }

  get(key: string): string {
    return this.envConfig[key];
  }

  getEthRpcUrl(): string {
    return this.get("INDRA_ETH_RPC_URL");
  }

  getEthProvider(): JsonRpcProvider {
    return this.ethProvider;
  }

  getEthWallet(): Wallet {
    return this.wallet;
  }

  async getEthNetwork(): Promise<EthNetwork> {
    const ethNetwork = await this.getEthProvider().getNetwork();
    if (ethNetwork.name === "unknown" && ethNetwork.chainId === 4447) {
      ethNetwork.name = "ganache";
    } else if (ethNetwork.chainId === 1) {
      ethNetwork.name = "homestead";
    }
    return ethNetwork;
  }

  async getContractAddresses(): Promise<ContractAddresses> {
    const chainId = (await this.getEthNetwork()).chainId.toString();
    const ethAddresses = {} as any;
    const ethAddressBook = JSON.parse(this.get("INDRA_ETH_CONTRACT_ADDRESSES"));
    Object.keys(ethAddressBook[chainId]).map((contract: string): void => {
      ethAddresses[contract] = getAddress(ethAddressBook[chainId][contract].address);
    });
    return ethAddresses as ContractAddresses;
  }

  async getTokenAddress(token?: string): Promise<string> {
    const chainId = (await this.getEthNetwork()).chainId.toString();
    const ethAddressBook = JSON.parse(this.get("INDRA_ETH_CONTRACT_ADDRESSES"));
    const tokenAddress = (token && token === 'TIP') ?
        ethAddressBook[chainId].TipToken.address :
        ethAddressBook[chainId].Token.address
    return getAddress(tokenAddress);
  }

  async getDefaultAppByName(name: SupportedApplication): Promise<DefaultApp> {
    const apps = await this.getDefaultApps();
    return apps.filter((app: DefaultApp) => app.name === name)[0];
  }

  async getDefaultApps(): Promise<DefaultApp[]> {
    const ethNetwork = await this.getEthNetwork();
    const addressBook = await this.getContractAddresses();
    return [
      {
        allowNodeInstall: false,
        appDefinitionAddress: addressBook[SupportedApplications.SimpleTransferApp],
        name: "SimpleTransferApp",
        network: SupportedNetworks[ethNetwork.name.toLowerCase()],
        outcomeType: OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER,
        stateEncoding: `tuple(${singleAssetTwoPartyCoinTransferEncoding} coinTransfers)`,
      },
      {
        allowNodeInstall: true,
        appDefinitionAddress: addressBook[SupportedApplications.SimpleTwoPartySwapApp],
        name: "SimpleTwoPartySwapApp",
        network: SupportedNetworks[ethNetwork.name.toLowerCase()],
        outcomeType: OutcomeType.MULTI_ASSET_MULTI_PARTY_COIN_TRANSFER,
        stateEncoding: `tuple(${multiAssetMultiPartyCoinTransferEncoding} coinTransfers)`,
      },
      {
        actionEncoding: `tuple(bytes32 preImage)`,
        allowNodeInstall: true,
        appDefinitionAddress: addressBook[SupportedApplications.SimpleLinkedTransferApp],
        name: "SimpleLinkedTransferApp",
        network: SupportedNetworks[ethNetwork.name.toLowerCase()],
        outcomeType: OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER,
        stateEncoding: `tuple(${singleAssetTwoPartyCoinTransferEncoding} coinTransfers, bytes32 linkedHash, uint256 amount, address assetId, bytes32 paymentId, bytes32 preImage)`,
      },
      {
        allowNodeInstall: true,
        appDefinitionAddress: addressBook[SupportedApplications.CoinBalanceRefundApp],
        name: "CoinBalanceRefundApp",
        network: SupportedNetworks[ethNetwork.name.toLowerCase()],
        outcomeType: OutcomeType.SINGLE_ASSET_TWO_PARTY_COIN_TRANSFER,
        stateEncoding: `tuple(address recipient, address multisig, uint256 threshold, address tokenAddress)`,
      },
    ];
  }

  getLogLevel(): number {
    return parseInt(this.get("INDRA_LOG_LEVEL") || "3", 10);
  }

  isDevMode(): boolean {
    return this.get("NODE_ENV") !== "production";
  }

  getMnemonic(): string {
    return this.get("INDRA_ETH_MNEMONIC");
  }

  getMessagingConfig(): MessagingConfig {
    return {
      clusterId: this.get("INDRA_NATS_CLUSTER_ID"),
      logLevel: this.getLogLevel(), // <- this is very verbose just fyi
      messagingUrl: (this.get("INDRA_NATS_SERVERS") || "").split(","),
      token: this.get("INDRA_NATS_TOKEN"),
    };
  }

  getPort(): number {
    return parseInt(this.get("INDRA_PORT"), 10);
  }

  getPostgresConfig(): PostgresConfig {
    return {
      database: this.get("INDRA_PG_DATABASE"),
      host: this.get("INDRA_PG_HOST"),
      password: this.get("INDRA_PG_PASSWORD"),
      port: parseInt(this.get("INDRA_PG_PORT"), 10),
      username: this.get("INDRA_PG_USERNAME"),
    };
  }

  getRedisUrl(): string {
    return this.get("INDRA_REDIS_URL");
  }

  async getDefaultPaymentProfile(
    assetId: string = AddressZero,
  ): Promise<PaymentProfile | undefined> {
    const tokenAddress = await this.getTokenAddress();
    const tipTokenAddress = await this.getTokenAddress('TIP');
    switch (assetId) {
      case AddressZero:
        return {
          amountToCollateralize: parseEther("0.1"),
          assetId: AddressZero,
          channels: [],
          id: 0,
          minimumMaintainedCollateral: parseEther("0.05"),
        };
      case tokenAddress:
        return {
          amountToCollateralize: parseEther("10"),
          assetId: AddressZero,
          channels: [],
          id: 0,
          minimumMaintainedCollateral: parseEther("5"),
        };
      case tipTokenAddress:
        return {
          amountToCollateralize: parseEther("1000"),
          assetId: AddressZero,
          channels: [],
          id: 0,
          minimumMaintainedCollateral: parseEther("100"),
        };
      default:
        return undefined;
    }
  }

  onModuleInit(): void {
    const wallet = Wallet.fromMnemonic(this.getMnemonic());
    this.wallet = wallet.connect(this.getEthProvider());
  }
}
