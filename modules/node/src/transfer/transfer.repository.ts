import { EntityRepository, Repository } from "typeorm";

import { Channel } from "../channel/channel.entity";

import {
  LinkedTransfer,
  LinkedTransferStatus,
  PeerToPeerTransfer,
  Transfer,
} from "./transfer.entity";

@EntityRepository(PeerToPeerTransfer)
export class PeerToPeerTransferRepository extends Repository<PeerToPeerTransfer> {}

@EntityRepository(LinkedTransfer)
export class LinkedTransferRepository extends Repository<LinkedTransfer> {
  async findByPaymentId(paymentId: string): Promise<LinkedTransfer | undefined> {
    return await this.findOne({ where: { paymentId } });
  }

  async findByLinkedHash(linkedHash: string): Promise<LinkedTransfer | undefined> {
    return await this.findOne({ where: { linkedHash }, relations: ["senderChannel"] });
  }

  async findByReceiverAppInstanceId(appInstanceId: string): Promise<LinkedTransfer | undefined> {
    return await this.findOne({ where: { receiverAppInstanceId: appInstanceId } });
  }

  async findPendingByRecipient(recipientPublicIdentifier: string): Promise<LinkedTransfer[]> {
    return await this.find({
      where: { recipientPublicIdentifier, status: LinkedTransferStatus.PENDING },
    });
  }

  async findReclaimable(senderChannel: Channel): Promise<LinkedTransfer[]> {
    return await this.find({
      where: { senderChannel, status: LinkedTransferStatus.REDEEMED },
    });
  }

  async findAll(): Promise<LinkedTransfer[]> {
    return await this.find();
  }

  async markAsRedeemed(
    transfer: LinkedTransfer,
    receiverChannel: Channel,
  ): Promise<LinkedTransfer> {
    transfer.status = LinkedTransferStatus.REDEEMED;
    transfer.receiverChannel = receiverChannel;
    return await this.save(transfer);
  }

  async markAsReclaimed(transfer: LinkedTransfer): Promise<LinkedTransfer> {
    transfer.status = LinkedTransferStatus.RECLAIMED;
    return await this.save(transfer);
  }

  async addPreImage(transfer: LinkedTransfer, preImage: string): Promise<LinkedTransfer> {
    transfer.status = LinkedTransferStatus.REDEEMED;
    transfer.preImage = preImage;
    return await this.save(transfer);
  }

  async addRecipientPublicIdentifierAndEncryptedPreImage(
    transfer: LinkedTransfer,
    receiverChannel: Channel,
    encryptedPreImage: string,
  ): Promise<LinkedTransfer> {
    transfer.receiverChannel = receiverChannel;
    transfer.recipientPublicIdentifier = receiverChannel.userPublicIdentifier;
    transfer.encryptedPreImage = encryptedPreImage;
    return await this.save(transfer);
  }
}

@EntityRepository(Transfer)
export class TransferRepository extends Repository<Transfer> {
  async findByPublicIdentifier(publicIdentifier: string): Promise<Transfer[]> {
    return await this.find({
      where: [
        {
          senderPublicIdentifier: publicIdentifier,
        },
        {
          receiverPublicIdentifier: publicIdentifier,
        },
      ],
    });
  }

  async findByPaymentId(paymentId: string): Promise<Transfer> {
    return await this.findOne({
      where: { paymentId },
    });
  }
}
