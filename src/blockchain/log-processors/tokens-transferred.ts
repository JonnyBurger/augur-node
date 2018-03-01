import Augur from "augur.js";
import * as Knex from "knex";
import { parallel } from "async";
import { FormattedEventLog, ErrorCallback, AsyncCallback } from "../../types";
import { augurEmitter } from "../../events";
import { TokenType } from "../../constants";
import { updateShareTokenTransfer } from "./token/share-token-transfer";
import { increaseTokenBalance } from "./token/increase-token-balance";
import { decreaseTokenBalance } from "./token/decrease-token-balance";
import { logError } from "../../utils/log-error";

export function processTokensTransferredLog(db: Knex, augur: Augur, log: FormattedEventLog, callback: ErrorCallback): void {
  const token = log.token || log.address;
  const value = log.value || log.amount;
  const tokenTransferDataToInsert = {
    transactionHash: log.transactionHash,
    logIndex: log.logIndex,
    sender: log.from,
    recipient: log.to,
    token,
    value,
    blockNumber: log.blockNumber,
  };
  db.insert(tokenTransferDataToInsert).into("transfers").asCallback((err: Error|null): void => {
    if (err) return callback(err);
    augurEmitter.emit("TokensTransferred", tokenTransferDataToInsert);
    parallel([
      (next: AsyncCallback): void => increaseTokenBalance(db, augur, token, log.to, Number(value), next),
      (next: AsyncCallback): void => decreaseTokenBalance(db, augur, token, log.from, Number(value), next),
    ], (err: Error|null): void => {
      if (err) logError(err); // TODO: callback(err)
      handleShareTokenTransfer(db, augur, log, callback);
    });
  });
}

export function processTokensTransferredLogRemoval(db: Knex, augur: Augur, log: FormattedEventLog, callback: ErrorCallback): void {
  db.from("transfers").where({ transactionHash: log.transactionHash, logIndex: log.logIndex }).del().asCallback((err: Error|null): void => {
    if (err) return callback(err);
    augurEmitter.emit("TokensTransferred", log);
    parallel([
      (next: AsyncCallback): void => increaseTokenBalance(db, augur, log.token, log.from, Number(log.value), next),
      (next: AsyncCallback): void => decreaseTokenBalance(db, augur, log.token, log.to, Number(log.value), next),
    ], (err: Error|null): void => {
      if (err) return callback(err);
      handleShareTokenTransfer(db, augur, log, callback);
    });
  });
}

function handleShareTokenTransfer(db: Knex, augur: Augur, log: FormattedEventLog, callback: ErrorCallback) {
  if (log.tokenType === TokenType.ShareToken && log.to !== log.market) {
    updateShareTokenTransfer(db, augur, log.market, log.from, log.to, callback);
  } else {
    callback(null);
  }
}
