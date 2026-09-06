import { HederaRestClient } from "../../src";

declare const client: HederaRestClient;

// Exported inferred values reproduce the declaration-emit scenario downstream
// packages hit when a library return type cannot be named portably.
export const scoped = client.useProvider("custom").useNetwork("private-network");
export const limits = scoped.limits();
export const accounts = scoped.accounts();
export const balances = scoped.balances();
export const blocks = scoped.blocks();
export const schedules = scoped.schedules();
export const tokens = scoped.tokens();
export const topics = scoped.topics();
export const transactions = scoped.transactions();
export const contracts = scoped.contracts();
export const network = scoped.network();

export const accountListRequest = accounts.list();
export const balanceListRequest = balances.list();
export const blockListRequest = blocks.list();
export const scheduleListRequest = schedules.list();
export const tokenListRequest = tokens.list();
export const transactionListRequest = transactions.list();
export const contractListRequest = contracts.list();
export const networkNodesRequest = network.nodes();
export const networkSupplyRequest = network.supply();
export const networkTotalSupplyRequest = network.supply({ q: "totalcoins" });
export const networkCirculatingSupplyRequest = network.supply((query) => query.q("circulating"));
export const topicMessagesRequest = topics.messages({ topicId: "0.0.7" });
