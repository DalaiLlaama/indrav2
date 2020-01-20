import { AppInstanceProposal, AppInstanceJson } from "./app";
import { SingleAssetTwoPartyIntermediaryAgreement } from "./contracts";

// Contract addresses that must be provided to withdraw funds from a channel
// Losing track to a channel's critical addresses means losing access to the funds in that channel
// Each channel must track it's own critical addresses because there's no
//   guarantee that these addresses will be the same across different channels
export type CriticalAddresses = {
  proxyFactory: string;
  multisigMastercopy: string;
}

export type StateChannelJSON = {
  readonly multisigAddress: string;
  readonly proxyFactoryAddress: string;
  readonly userNeuteredExtendedKeys: string[];
  readonly proposedAppInstances: [string, AppInstanceProposal][];
  readonly appInstances: [string, AppInstanceJson][];
  readonly singleAssetTwoPartyIntermediaryAgreements: [
    string,
    SingleAssetTwoPartyIntermediaryAgreement
  ][];
  readonly freeBalanceAppInstance: AppInstanceJson | undefined;
  readonly monotonicNumProposedApps: number;
};

