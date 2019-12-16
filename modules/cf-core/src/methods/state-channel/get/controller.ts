import { jsonRpcMethod } from "rpc-server";

import { RequestHandler } from "../../../request-handler";
import { Node } from "../../../types";
import { NodeController } from "../../controller";

export default class GetAllChannelAddressesController extends NodeController {
  @jsonRpcMethod(Node.RpcMethodNames.chan_getChannelAddresses)
  public executeMethod = super.executeMethod;

  protected async executeMethodImplementation(
    requestHandler: RequestHandler
  ): Promise<Node.GetChannelAddressesResult> {
    return {
      multisigAddresses: [
        ...(await requestHandler.store.getStateChannelsMap()).keys()
      ]
    };
  }
}
