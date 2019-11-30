import { Transaction } from "ethers/utils";
import { EntityRepository, Repository } from "typeorm";

import { Channel } from "../channel/channel.entity";

import { OnchainTransaction, TransactionReason } from "./onchainTransaction.entity";

@EntityRepository(OnchainTransaction)
export class OnchainTransactionRepository extends Repository<OnchainTransaction> {
  async findByHash(txHash: string): Promise<OnchainTransaction | undefined> {
    return await this.findOne({
      where: { hash: txHash },
    });
  }

  async findByUserPublicIdentifier(
    userPublicIdentifier: string,
  ): Promise<OnchainTransaction[] | undefined> {
    const txs = await this.createQueryBuilder("onchainTransaction")
      .leftJoinAndSelect("onchainTransaction.channel", "channel")
      .where("channel.userPublicIdentifier = :userPublicIdentifier", { userPublicIdentifier })
      .orderBy("onchainTransaction.id", "ASC")
      .getMany();
    return txs;
  }

  async findLatestWithdrawalByUserPublicIdentifier(
    userPublicIdentifier: string,
  ): Promise<OnchainTransaction | undefined> {
    const tx = await this.createQueryBuilder("onchainTransaction")
      .leftJoinAndSelect("onchainTransaction.channel", "channel")
      .where("channel.userPublicIdentifier = :userPublicIdentifier", { userPublicIdentifier })
      .where("onchainTransaction.reason = :reason", { reason: TransactionReason.USER_WITHDRAWAL })
      .orderBy("onchainTransaction.id", "DESC")
      .getOne();
    return tx;
  }

  async addUserWithdrawal(tx: Transaction, channel: Channel): Promise<OnchainTransaction> {
    const onchain = new OnchainTransaction();
    onchain.reason = TransactionReason.USER_WITHDRAWAL;
    onchain.value = tx.value;
    onchain.gasPrice = tx.gasPrice;
    onchain.gasLimit = tx.gasLimit;
    onchain.nonce = tx.nonce;
    onchain.to = tx.to;
    onchain.from = tx.from;
    onchain.hash = tx.hash;
    onchain.data = tx.data;
    onchain.v = tx.v;
    onchain.r = tx.r;
    onchain.s = tx.s;

    onchain.channel = channel;
    return await this.save(onchain);
  }
}
