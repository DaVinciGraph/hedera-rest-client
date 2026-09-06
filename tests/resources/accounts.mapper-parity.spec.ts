// tests/resources/accounts.mapper.spec.ts
import { describe, it, expect } from "vitest";

import { AccountsMapper } from "../../src/resources/accounts/mapper";
import {
	AccountsListQueryDSL,
	AccountOneQueryDSL,
	AccountCryptoAllowancesDSL,
	AccountTokenAllowancesDSL,
	AccountNftAllowancesDSL,
	AccountTokensDSL,
	AccountNftsOwnedDSL,
	AccountRewardsDSL,
	AccountOutstandingAirdropsDSL,
	AccountPendingAirdropsDSL,
} from "../../src/dsl/accounts";
import { ValidationError } from "../../src/core/errors";

/** Helper: parity compares ignore 'limit' because DSL stores it as requestedLimit instead of in params. */
function withoutLimit<T extends Record<string, any>>(o: T | undefined) {
	if (!o) return o;
	const { limit, ...rest } = o as Record<string, any>;
	return rest as T;
}

const EVM_ADDRESS = "ab".repeat(20);
const TOKEN_NUM_ALIAS = `${"0".repeat(39)}2`;

describe("AccountsMapper vs DSL — list()", () => {
	it("parity: object mapping equals DSL params (excluding limit)", () => {
		const obj = {
			accountId: "0.0.1001",
			accountBalance: "gt:100000",
			accountPublicKey: "302a300506032b6570032100cafedeadbeef",
			includeBalance: true,
			order: "desc",
			// limit intentionally present here to ensure we ignore it in parity comparison
			limit: 2,
		} as any;

		const mapped = AccountsMapper.list(obj);

		const dsl = new AccountsListQueryDSL()
			.accountId("0.0.1001")
			.accountBalance()
			.greaterThan(100000) // produces "gt:100000"
			.includeBalance(true)
			.accountPublicKey("302a300506032b6570032100cafedeadbeef")
			.order("desc")
			.limit(2) // lives in requestedLimit for DSL
			._build();

		expect(withoutLimit(mapped)).toEqual(dsl.params);
	});

	it("parity: comparator on accountId and equality on balance", () => {
		const obj = {
			accountId: "gte:0.0.500",
			accountBalance: 250, // equality (no "eq:")
		} as any;

		const mapped = AccountsMapper.list(obj);

		const dsl = new AccountsListQueryDSL().accountId().greaterThanOrEqualTo("0.0.500").accountBalance().equalTo(250)._build();

		expect(withoutLimit(mapped)).toEqual(dsl.params);
	});

	it("preserves repeated account IDs and balance predicates", () => {
		const mapped = AccountsMapper.list({
			accountId: ["0.0.1", "eq:0.0.2", "gte:0.0.3"],
			accountBalance: [0, "gt:10", "lte:20"],
		});
		const dsl = new AccountsListQueryDSL()
			.accountId(["0.0.1", "eq:0.0.2"])
			.accountId().greaterThanOrEqualTo("0.0.3")
			.accountBalance([0, "gt:10"])
			.accountBalance().lessThanOrEqualTo(20)
			._build();
		expect(mapped).toEqual(dsl.params);
		expect(mapped["account.balance"]).toEqual(["0", "gt:10", "lte:20"]);
	});

	it("preserves repeated balance flags from object and DSL queries", () => {
		const mapped = AccountsMapper.list({ includeBalance: [true, false, true] });
		const dsl = new AccountsListQueryDSL().includeBalance([true, false]).includeBalance(true)._build();

		expect(mapped).toEqual({ balance: [true, false, true] });
		expect(dsl.params).toEqual(mapped);
		expect(AccountsMapper.list({ includeBalance: false })).toEqual({ balance: false });
	});

	it("validates every balance occurrence and enforces its 1..100 cardinality", () => {
		expect(() => AccountsMapper.list({ includeBalance: [] })).toThrow(ValidationError);
		expect(() => AccountsMapper.list({ includeBalance: [true, "false"] } as any)).toThrow(ValidationError);
		expect(() => AccountsMapper.list({ includeBalance: Array(101).fill(true) })).toThrow(ValidationError);
		expect(() => new AccountsListQueryDSL().includeBalance([])).toThrow(ValidationError);
		expect(() => new AccountsListQueryDSL().includeBalance([true, "false"] as any)).toThrow(ValidationError);
		expect(() => new AccountsListQueryDSL().includeBalance(Array(101).fill(true))).toThrow(ValidationError);
	});
});

describe("AccountsMapper vs DSL — one()", () => {
	it("parity: id + params (including limit here)", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.2001",
			limit: "max",
			order: "desc",
			timestamp: ["gte:1690000000.1", "lte:1690000900.9"],
			transactiontype: "TOKENCREATION",
			transactions: true,
		} as any;

		const mapped = AccountsMapper.one(obj);

		const dsl = new AccountOneQueryDSL()
			.idOrAliasOrEvmAddress("0.0.2001")
			.limit("max")
			.order("desc")
			.timestamp()
			.greaterThanOrEqualTo("1690000000.1")
			.timestamp()
			.lessThanOrEqualTo("1690000900.9")
			.transactiontype("TOKENCREATION" as any)
			.includeTransactions(true)
			._build();

		expect(mapped.id).toBe(dsl.id);
		expect(mapped.query).toEqual(dsl.params);
	});
});

describe("AccountsMapper vs DSL — cryptoAllowances()", () => {
	it("parity: spender, order, (limit excluded)", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.3001",
			spenderId: "0.0.7",
			order: "asc",
			limit: 10,
		} as any;

		const mapped = AccountsMapper.cryptoAllowances(obj);

		const dsl = new AccountCryptoAllowancesDSL().idOrAliasOrEvmAddress("0.0.3001").spenderId("0.0.7").order("asc").limit(10)._build();

		expect(mapped.id).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("supports spender.id range comparators but rejects ne", () => {
		const mapped = AccountsMapper.cryptoAllowances({
			idOrAliasOrEvmAddress: "0.0.3001",
			spenderId: "gte:0.0.7",
		});
		const dsl = new AccountCryptoAllowancesDSL().idOrAliasOrEvmAddress("0.0.3001").spenderId().lessThan("0.0.20")._build();

		expect(mapped.params["spender.id"]).toBe("gte:0.0.7");
		expect(dsl.params["spender.id"]).toBe("lt:0.0.20");
		expect(() => AccountsMapper.cryptoAllowances({ idOrAliasOrEvmAddress: "0.0.3001", spenderId: "ne:0.0.7" })).toThrow(ValidationError);
	});

	it("preserves repeated crypto-allowance spender filters", () => {
		const mapped = AccountsMapper.cryptoAllowances({
			idOrAliasOrEvmAddress: "0.0.3001",
			spenderId: ["0.0.7", "gte:0.0.8", "lte:0.0.9"],
		});
		const built = new AccountCryptoAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.3001")
			.spenderId(["0.0.7", "gte:0.0.8"])
			.spenderId().lessThanOrEqualTo("0.0.9")
			._build();
		expect(mapped.params).toEqual(built.params);
	});
});

describe("AccountsMapper vs DSL — tokenAllowances()", () => {
	it("parity: valid comparator case (lte/lt coupling)", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.4001",
			spenderId: "lte:0.0.100",
			tokenId: "lt:0.0.200",
			order: "desc",
			limit: 5,
		} as any;

		const mapped = AccountsMapper.tokenAllowances(obj);

		const dsl = new AccountTokenAllowancesDSL().idOrAliasOrEvmAddress("0.0.4001").spenderId().lessThanOrEqualTo("0.0.100").tokenId().lessThan("0.0.200").order("desc").limit(5)._build();

		expect(mapped.pathId).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("constraint: tokenId requires spenderId (both mapper and DSL throw)", () => {
		const badObj = {
			idOrAliasOrEvmAddress: "0.0.9",
			tokenId: "0.0.10",
		} as any;

		expect(() => AccountsMapper.tokenAllowances(badObj)).toThrow(ValidationError);

		const dsl = new AccountTokenAllowancesDSL().idOrAliasOrEvmAddress("0.0.9");
		expect(() => dsl.tokenId("0.0.10")._build()).toThrow(ValidationError);
	});

	it("allows tokenId before its required spenderId in the DSL", () => {
		const built = new AccountTokenAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.9")
			.tokenId("0.0.10")
			.spenderId("0.0.11")
			._build();
		expect(built.params).toEqual({ "spender.id": "0.0.11", "token.id": "0.0.10" });
	});

	it("constraint: coupling error — token lt requires spender lte/eq", () => {
		const badObj = {
			idOrAliasOrEvmAddress: "0.0.8",
			spenderId: "gte:0.0.1", // incompatible with token lt
			tokenId: "lt:0.0.2",
		} as any;
		expect(() => AccountsMapper.tokenAllowances(badObj)).toThrow(ValidationError);

		const dsl = new AccountTokenAllowancesDSL().idOrAliasOrEvmAddress("0.0.8").spenderId().greaterThanOrEqualTo("0.0.1").tokenId().lessThan("0.0.2");
		expect(() => dsl._build()).toThrow(ValidationError);
	});
});

describe("AccountsMapper vs DSL — nftAllowances()", () => {
	it("parity: view → owner=false, valid gt/gte coupling", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.5001",
			view: "spender",
			counterpartyId: "gte:0.0.77",
			tokenId: "gt:0.0.88",
			order: "asc",
			limit: 3,
		} as any;

		const mapped = AccountsMapper.nftAllowances(obj);

		const dsl = new AccountNftAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.5001")
			.view("spender") // owner=false
			.counterpartyId()
			.greaterThanOrEqualTo("0.0.77")
			.tokenId()
			.greaterThan("0.0.88")
			.order("asc")
			.limit(3)
			._build();

		expect(mapped.pathId).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("constraint: tokenId requires counterpartyId (both mapper and DSL throw)", () => {
		const badObj = {
			idOrAliasOrEvmAddress: "0.0.77",
			tokenId: "0.0.100",
		} as any;
		expect(() => AccountsMapper.nftAllowances(badObj)).toThrow(ValidationError);

		const dsl = new AccountNftAllowancesDSL().idOrAliasOrEvmAddress("0.0.77");
		expect(() => dsl.tokenId("0.0.100")._build()).toThrow(ValidationError);
	});

	it("allows tokenId before its required counterpartyId in the DSL", () => {
		const built = new AccountNftAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.77")
			.tokenId("0.0.100")
			.counterpartyId("0.0.5")
			._build();
		expect(built.params).toEqual({ owner: true, "account.id": "0.0.5", "token.id": "0.0.100" });
	});

	it("mapper-only constraint: 'ne' forbidden for counterpartyId", () => {
		const badObj = {
			idOrAliasOrEvmAddress: "0.0.77",
			counterpartyId: "ne:0.0.5",
		} as any;
		expect(() => AccountsMapper.nftAllowances(badObj)).toThrow(ValidationError);
	});

	it("supports paired lower/upper token-allowance bounds and rejects invalid shapes", () => {
		const query = {
			idOrAliasOrEvmAddress: "0.0.4001",
			spenderId: ["gte:0.0.7", "lte:0.0.9"],
			tokenId: ["gte:0.0.10", "lte:0.0.20"],
		};
		const mapped = AccountsMapper.tokenAllowances(query);
		const built = new AccountTokenAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.4001")
			.spenderId(["gte:0.0.7", "lte:0.0.9"])
			.tokenId().greaterThanOrEqualTo("0.0.10")
			.tokenId().lessThanOrEqualTo("0.0.20")
			._build();
		expect(mapped.params).toEqual(built.params);
		expect(() => AccountsMapper.tokenAllowances({ ...query, tokenId: ["0.0.10", "gte:0.0.11"] })).toThrow(ValidationError);
		expect(() => new AccountTokenAllowancesDSL().idOrAliasOrEvmAddress("0.0.1").spenderId("0.0.2").spenderId().greaterThan("0.0.3")).toThrow(ValidationError);
	});

	it("uses packed numeric ranges for NFT allowance account/token filters", () => {
		const leadingZero = "0000000000000000000000000000000000000002";
		const mapped = AccountsMapper.nftAllowances({
			idOrAliasOrEvmAddress: "0.0.77",
			counterpartyId: `gte:${leadingZero}`,
			tokenId: `gt:${leadingZero}`,
		});
		const dsl = new AccountNftAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.77")
			.counterpartyId(`gte:${leadingZero}`)
			.tokenId(`gt:${leadingZero}`)
			._build();
		expect(mapped.params).toEqual(dsl.params);

		expect(() =>
			AccountsMapper.nftAllowances({ idOrAliasOrEvmAddress: "0.0.77", counterpartyId: `eq:0x${EVM_ADDRESS}` })
		).toThrow(ValidationError);
		expect(() =>
			new AccountNftAllowancesDSL().idOrAliasOrEvmAddress("0.0.77").counterpartyId("0.0.2").tokenId(`eq:0x${TOKEN_NUM_ALIAS}`)
		).toThrow(ValidationError);
		expect(() => AccountsMapper.nftAllowances({ idOrAliasOrEvmAddress: "0.0.77", counterpartyId: "eq:512.0.0" })).toThrow(ValidationError);
	});

	it("preserves both NFT-allowance range bounds and enforces their structure", () => {
		const mapped = AccountsMapper.nftAllowances({
			idOrAliasOrEvmAddress: "0.0.77",
			counterpartyId: ["GTE:0.0.1", "lte:0.0.9"],
			tokenId: ["gte:0.0.2", "lte:0.0.8"],
		});
		const built = new AccountNftAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.77")
			.counterpartyId("GTE:0.0.1")
			.counterpartyId().lessThanOrEqualTo("0.0.9")
			.tokenId().greaterThanOrEqualTo("0.0.2")
			.tokenId().lessThanOrEqualTo("0.0.8")
			._build();
		expect(mapped.params).toEqual(built.params);
		expect(mapped.params["account.id"]).toEqual(["GTE:0.0.1", "lte:0.0.9"]);
		expect(() =>
			AccountsMapper.nftAllowances({ idOrAliasOrEvmAddress: "0.0.77", counterpartyId: ["gte:0.0.5", "lte:0.0.4"] })
		).toThrow(ValidationError);
		expect(() =>
			AccountsMapper.nftAllowances({ idOrAliasOrEvmAddress: "0.0.77", counterpartyId: ["eq:0.0.1", "gte:0.0.1"] })
		).toThrow(ValidationError);
	});
});

describe("AccountsMapper vs DSL — accountTokens()", () => {
	it("parity: token.id equality only", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.6001",
			tokenId: "0.0.9",
			order: "desc",
			limit: 10,
		} as any;

		const mapped = AccountsMapper.accountTokens(obj);

		const dsl = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.6001").tokenId("0.0.9").order("desc").limit(10)._build();

		expect(mapped.id).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("supports token.id range comparators but rejects ne", () => {
		const objectMapped = AccountsMapper.accountTokens({
			idOrAliasOrEvmAddress: "0.0.6001",
			tokenId: "gte:0.0.9",
		});
		const dsl = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.6001").tokenId().lessThan("0.0.20")._build();

		expect(objectMapped.params["token.id"]).toBe("gte:0.0.9");
		expect(dsl.params["token.id"]).toBe("lt:0.0.20");
		expect(() => AccountsMapper.accountTokens({ idOrAliasOrEvmAddress: "0.0.6001", tokenId: "ne:0.0.9" })).toThrow(ValidationError);
		expect(() => new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.6001").tokenId("ne:0.0.9")).toThrow(ValidationError);
	});

	it("preserves repeated account-token filters", () => {
		const mapped = AccountsMapper.accountTokens({ idOrAliasOrEvmAddress: "0.0.1", tokenId: ["0.0.2", "gte:0.0.3"] });
		const built = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.1").tokenId("0.0.2").tokenId().greaterThanOrEqualTo("0.0.3")._build();
		expect(mapped.params).toEqual(built.params);
	});
});

describe("AccountsMapper vs DSL — accountNftsOwned()", () => {
	it("parity: valid token lte with serial lt + spender lte", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.7001",
			tokenId: "lte:0.0.123",
			serialNumber: "lt:10",
			spenderId: "lte:0.0.500",
			order: "asc",
			limit: 4,
		} as any;

		const mapped = AccountsMapper.accountNftsOwned(obj);

		const dsl = new AccountNftsOwnedDSL()
			.idOrAliasOrEvmAddress("0.0.7001")
			.tokenId()
			.lessThanOrEqualTo("0.0.123")
			.serialNumber()
			.lessThan(10)
			.spenderId()
			.lessThanOrEqualTo("0.0.500")
			.order("asc")
			.limit(4)
			._build();

		expect(mapped.id).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("constraint: serialNumber requires tokenId (both mapper and DSL throw)", () => {
		const badObj = {
			idOrAliasOrEvmAddress: "0.0.55",
			serialNumber: 3,
		} as any;
		expect(() => AccountsMapper.accountNftsOwned(badObj)).toThrow(ValidationError);

		const dsl = new AccountNftsOwnedDSL().idOrAliasOrEvmAddress("0.0.55");
		expect(() => dsl.serialNumber(3)._build()).toThrow(ValidationError);
	});

	it("allows serialNumber before its required tokenId in the DSL", () => {
		const built = new AccountNftsOwnedDSL().idOrAliasOrEvmAddress("0.0.55").serialNumber(3).tokenId("0.0.7")._build();
		expect(built.params).toEqual({ "token.id": "0.0.7", serialnumber: "3" });
	});

	it("accepts and validates direct serial-number comparator strings", () => {
		const dsl = new AccountNftsOwnedDSL().idOrAliasOrEvmAddress("0.0.55").tokenId("0.0.7").serialNumber("gte:3")._build();
		expect(dsl.params.serialnumber).toBe("gte:3");
		expect(() => new AccountNftsOwnedDSL().idOrAliasOrEvmAddress("0.0.55").tokenId("0.0.7").serialNumber("ne:3" as any)).toThrow(ValidationError);
	});

	it("constraint: coupling error — serial lt requires token lte/eq", () => {
		const badObj = {
			idOrAliasOrEvmAddress: "0.0.88",
			tokenId: "gte:0.0.10", // incompatible with serial lt
			serialNumber: "lt:5",
		} as any;
		expect(() => AccountsMapper.accountNftsOwned(badObj)).toThrow(ValidationError);

		const dsl = new AccountNftsOwnedDSL().idOrAliasOrEvmAddress("0.0.88").tokenId().greaterThanOrEqualTo("0.0.10").serialNumber().lessThan(5);
		expect(() => dsl._build()).toThrow(ValidationError);
	});
});

describe("AccountsMapper vs DSL — rewards()", () => {
	it("parity: timestamp range array (excluding limit)", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.8001",
			timestamp: ["gte:1700000000.1", "lte:1700000900.9"],
			order: "desc",
			limit: 2,
		} as any;

		const mapped = AccountsMapper.rewards(obj);

		const dsl = new AccountRewardsDSL()
			.idOrAliasOrEvmAddress("0.0.8001")
			.timestamp()
			.greaterThanOrEqualTo("1700000000.1")
			.timestamp()
			.lessThanOrEqualTo("1700000900.9")
			.order("desc")
			.limit(2)
			._build();

		expect(mapped.id).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("supports owned-NFT ranges and repeated spender equality filters", () => {
		const query = {
			idOrAliasOrEvmAddress: "0.0.88",
			tokenId: ["gte:0.0.10", "lte:0.0.20"],
			serialNumber: ["gte:1", "lte:9"],
			spenderId: ["0.0.30", "eq:0.0.31", "gte:0.0.20", "lte:0.0.40"],
		};
		const mapped = AccountsMapper.accountNftsOwned(query);
		const built = new AccountNftsOwnedDSL()
			.idOrAliasOrEvmAddress("0.0.88")
			.tokenId(["gte:0.0.10", "lte:0.0.20"])
			.serialNumber(["gte:1", "lte:9"])
			.spenderId(["0.0.30", "eq:0.0.31", "gte:0.0.20"])
			.spenderId().lessThanOrEqualTo("0.0.40")
			._build();
		expect(mapped.params).toEqual(built.params);
		expect(() => AccountsMapper.accountNftsOwned({ ...query, serialNumber: ["gte:1", "gt:2"] })).toThrow(ValidationError);
	});

	it("rejects the unsupported ne timestamp comparator", () => {
		expect(() => AccountsMapper.rewards({ idOrAliasOrEvmAddress: "0.0.8001", timestamp: "ne:1" })).toThrow(ValidationError);
		expect(() => new AccountRewardsDSL().idOrAliasOrEvmAddress("0.0.8001").timestamp("ne:1")).toThrow(ValidationError);
		expect(() => (new AccountRewardsDSL().idOrAliasOrEvmAddress("0.0.8001").timestamp() as any).notEqualTo("1")).toThrow(ValidationError);
	});
});

describe("AccountsMapper vs DSL — outstandingAirdrops()", () => {
	it("parity: receiverId, tokenId, serialNumber comparator, order (excluding limit)", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.9001",
			receiverId: "gte:0.0.1",
			tokenId: "lte:0.0.2",
			serialNumber: "gte:5",
			order: "asc",
			limit: 7,
		} as any;

		const mapped = AccountsMapper.outstandingAirdrops(obj);

		const dsl = new AccountOutstandingAirdropsDSL()
			.idOrAliasOrEvmAddress("0.0.9001")
			.receiverId()
			.greaterThanOrEqualTo("0.0.1")
			.tokenId()
			.lessThanOrEqualTo("0.0.2")
			.serialNumber()
			.greaterThanOrEqualTo(5)
			.order("asc")
			.limit(7)
			._build();

		expect(mapped.id).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("accepts an independent serialNumber without tokenId", () => {
		const objectQuery = {
			idOrAliasOrEvmAddress: "0.0.42",
			serialNumber: 1,
		};
		expect(AccountsMapper.outstandingAirdrops(objectQuery).params.serialnumber).toBe("1");

		const dsl = new AccountOutstandingAirdropsDSL().idOrAliasOrEvmAddress("0.0.42").serialNumber(1)._build();
		expect(dsl.params.serialnumber).toBe("1");
	});

	it("rejects airdrop ID `ne` filters because the server silently ignores them", () => {
		expect(() => AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.42", receiverId: "ne:1" })).toThrow(ValidationError);
		expect(() => new AccountOutstandingAirdropsDSL().idOrAliasOrEvmAddress("0.0.42").tokenId("ne:7")).toThrow(ValidationError);
	});

	it("accepts a direct serial-number comparator string", () => {
		const dsl = new AccountOutstandingAirdropsDSL().idOrAliasOrEvmAddress("0.0.42").tokenId("0.0.7").serialNumber("lte:9")._build();
		expect(dsl.params.serialnumber).toBe("lte:9");
	});

	it("preserves two bounds for every outstanding-airdrop range field", () => {
		const mapped = AccountsMapper.outstandingAirdrops({
			idOrAliasOrEvmAddress: "0.0.42",
			receiverId: ["GTE:0.0.1", "lte:0.0.9"],
			tokenId: ["gte:2", "lte:8"],
			serialNumber: ["gte:+1", "lte:0005"],
		});
		const built = new AccountOutstandingAirdropsDSL()
			.idOrAliasOrEvmAddress("0.0.42")
			.receiverId("GTE:0.0.1")
			.receiverId().lessThanOrEqualTo("0.0.9")
			.tokenId().greaterThanOrEqualTo("2")
			.tokenId().lessThanOrEqualTo("8")
			.serialNumber("gte:+1")
			.serialNumber().lessThanOrEqualTo("0005")
			._build();
		expect(mapped.params).toEqual(built.params);
		expect(() => AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.42", receiverId: ["gte:1", "lte:2", "eq:1"] })).toThrow(ValidationError);
	});

	it("accepts the fungible serial zero sentinel but still rejects ne", () => {
		const mapped = AccountsMapper.outstandingAirdrops({
			idOrAliasOrEvmAddress: "0.0.42",
			tokenId: "7",
			serialNumber: "lte:0",
		});
		const dsl = new AccountOutstandingAirdropsDSL()
			.idOrAliasOrEvmAddress("0.0.42")
			.tokenId("7")
			.serialNumber()
			.lessThanOrEqualTo(0)
			._build();

		expect(mapped.params.serialnumber).toBe("lte:0");
		expect(dsl.params.serialnumber).toBe("lte:0");
		expect(() =>
			AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.42", tokenId: "7", serialNumber: "ne:0" })
		).toThrow(ValidationError);
	});
});

describe("AccountsMapper vs DSL — pendingAirdrops()", () => {
	it("parity: senderId, tokenId, serialNumber comparator (excluding limit)", () => {
		const obj = {
			idOrAliasOrEvmAddress: "0.0.9002",
			senderId: "gte:0.0.10",
			tokenId: "0.0.77", // equality form
			serialNumber: "gt:9",
			order: "desc",
			limit: 3,
		} as any;

		const mapped = AccountsMapper.pendingAirdrops(obj);

		const dsl = new AccountPendingAirdropsDSL().idOrAliasOrEvmAddress("0.0.9002").senderId().greaterThanOrEqualTo("0.0.10").tokenId("0.0.77").serialNumber().greaterThan(9).order("desc").limit(3)._build();

		expect(mapped.id).toBe(dsl.id);
		expect(withoutLimit(mapped.params)).toEqual(dsl.params);
	});

	it("accepts an independent serialNumber without tokenId", () => {
		const objectQuery = {
			idOrAliasOrEvmAddress: "0.0.101",
			serialNumber: 2,
		};
		expect(AccountsMapper.pendingAirdrops(objectQuery).params.serialnumber).toBe("2");

		const dsl = new AccountPendingAirdropsDSL().idOrAliasOrEvmAddress("0.0.101").serialNumber(2)._build();
		expect(dsl.params.serialnumber).toBe("2");
	});

	it("accepts a direct serial-number comparator string", () => {
		const dsl = new AccountPendingAirdropsDSL().idOrAliasOrEvmAddress("0.0.101").tokenId("0.0.7").serialNumber("gt:2")._build();
		expect(dsl.params.serialnumber).toBe("gt:2");
	});

	it("preserves repeated pending-airdrop participant, token, and serial bounds", () => {
		const mapped = AccountsMapper.pendingAirdrops({
			idOrAliasOrEvmAddress: "0.0.101",
			senderId: ["gte:1", "lte:9"],
			tokenId: ["gte:2", "lte:8"],
			serialNumber: ["gte:1", "lte:5"],
		});
		const built = new AccountPendingAirdropsDSL()
			.idOrAliasOrEvmAddress("0.0.101")
			.senderId().greaterThanOrEqualTo("1")
			.senderId().lessThanOrEqualTo("9")
			.tokenId().greaterThanOrEqualTo("2")
			.tokenId().lessThanOrEqualTo("8")
			.serialNumber().greaterThanOrEqualTo(1)
			.serialNumber().lessThanOrEqualTo(5)
			._build();
		expect(mapped.params).toEqual(built.params);
	});
});

describe("AccountsMapper vs DSL — identifier filter validation", () => {
	it.each(["7", "1.7", "0.1.7", "gt:7", "lte:1.7", "eq:0.1.7"])(
		"preserves valid account.id request shorthand: %s",
		(accountId) => {
			const mapped = AccountsMapper.list({ accountId });
			const dsl = new AccountsListQueryDSL().accountId(accountId)._build();

			expect(mapped["account.id"]).toBe(accountId);
			expect(dsl.params["account.id"]).toBe(accountId);
		}
	);

	it("preserves comparator-wrapped EVM account IDs and token num aliases", () => {
		const accountId = `gte:0x${EVM_ADDRESS}`;
		const tokenId = `lte:0x${TOKEN_NUM_ALIAS}`;
		const mappedAccount = AccountsMapper.list({ accountId });
		const directAccount = new AccountsListQueryDSL().accountId(accountId)._build();
		const fluentAccount = new AccountsListQueryDSL().accountId().greaterThanOrEqualTo(`0x${EVM_ADDRESS}`)._build();
		const mappedToken = AccountsMapper.accountTokens({ idOrAliasOrEvmAddress: "0.0.1", tokenId });
		const directToken = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.1").tokenId(tokenId)._build();
		const fluentToken = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.1").tokenId().lessThanOrEqualTo(`0x${TOKEN_NUM_ALIAS}`)._build();

		expect(mappedAccount["account.id"]).toBe(accountId);
		expect(directAccount.params["account.id"]).toBe(accountId);
		expect(fluentAccount.params["account.id"]).toBe(accountId);
		expect(mappedToken.params["token.id"]).toBe(tokenId);
		expect(directToken.params["token.id"]).toBe(tokenId);
		expect(fluentToken.params["token.id"]).toBe(tokenId);
	});

	it("keeps airdrop filters numeric while preserving long leading-zero decimals", () => {
		expect(() =>
			AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", receiverId: `gte:0x${EVM_ADDRESS}` })
		).toThrow(ValidationError);
		const leadingZeroToken = "0000000000000000000000000000000000000064";
		expect(
			AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", tokenId: `eq:${leadingZeroToken}` }).params["token.id"]
		).toBe(`eq:${leadingZeroToken}`);
		expect(() =>
			new AccountPendingAirdropsDSL().idOrAliasOrEvmAddress("0.0.1").tokenId(`gte:0x${TOKEN_NUM_ALIAS}`)
		).toThrow(ValidationError);
		expect(() => AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", receiverId: "lt:0.0.0" })).toThrow(ValidationError);
		expect(() => new AccountPendingAirdropsDSL().idOrAliasOrEvmAddress("0.0.1").senderId().lessThan("0.0.0")).toThrow(ValidationError);
		expect(AccountsMapper.pendingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", tokenId: "lt:0" }).params["token.id"]).toBe("lt:0");
	});

	it("preserves pagination coupling for direct comparator-prefixed overloads", () => {
		const mapped = AccountsMapper.tokenAllowances({
			idOrAliasOrEvmAddress: "0.0.1",
			spenderId: "lte:1.2",
			tokenId: "lt:2.3",
		});
		const dsl = new AccountTokenAllowancesDSL()
			.idOrAliasOrEvmAddress("0.0.1")
			.spenderId("lte:1.2")
			.tokenId("lt:2.3")
			._build();

		expect(mapped.params).toEqual(dsl.params);
		expect(dsl.params).toEqual({ "spender.id": "lte:1.2", "token.id": "lt:2.3" });
	});

	it.each(["7", "1.7", "0.1.7", "gt:7", "lte:1.7", "eq:0.1.7"])(
		"preserves valid token.id request shorthand: %s",
		(tokenId) => {
			const mapped = AccountsMapper.accountTokens({ idOrAliasOrEvmAddress: "0.0.6001", tokenId });
			const dsl = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.6001").tokenId(tokenId)._build();

			expect(mapped.params["token.id"]).toBe(tokenId);
			expect(dsl.params["token.id"]).toBe(tokenId);
		}
	);

	it.each([
		["accounts list account.id", () => AccountsMapper.list({ accountId: "gte:not-an-id" } as any)],
		[
			"crypto allowances spender.id",
			() => AccountsMapper.cryptoAllowances({ idOrAliasOrEvmAddress: "0.0.1", spenderId: "gte:not-an-id" } as any),
		],
		[
			"token allowances spender.id",
			() => AccountsMapper.tokenAllowances({ idOrAliasOrEvmAddress: "0.0.1", spenderId: "gte:not-an-id" } as any),
		],
		[
			"token allowances token.id",
			() =>
				AccountsMapper.tokenAllowances({
					idOrAliasOrEvmAddress: "0.0.1",
					spenderId: "0.0.2",
					tokenId: "gte:not-an-id",
				} as any),
		],
		[
			"NFT allowances account.id",
			() => AccountsMapper.nftAllowances({ idOrAliasOrEvmAddress: "0.0.1", counterpartyId: "gte:not-an-id" } as any),
		],
		[
			"NFT allowances token.id",
			() =>
				AccountsMapper.nftAllowances({
					idOrAliasOrEvmAddress: "0.0.1",
					counterpartyId: "0.0.2",
					tokenId: "gte:not-an-id",
				} as any),
		],
		[
			"account tokens token.id",
			() => AccountsMapper.accountTokens({ idOrAliasOrEvmAddress: "0.0.1", tokenId: "gte:not-an-id" } as any),
		],
		[
			"owned NFTs token.id",
			() => AccountsMapper.accountNftsOwned({ idOrAliasOrEvmAddress: "0.0.1", tokenId: "gte:not-an-id" } as any),
		],
		[
			"owned NFTs spender.id",
			() => AccountsMapper.accountNftsOwned({ idOrAliasOrEvmAddress: "0.0.1", spenderId: "gte:not-an-id" } as any),
		],
		[
			"outstanding airdrops receiver.id",
			() => AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", receiverId: "gte:not-an-id" } as any),
		],
		[
			"outstanding airdrops token.id",
			() => AccountsMapper.outstandingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", tokenId: "gte:not-an-id" } as any),
		],
		[
			"pending airdrops sender.id",
			() => AccountsMapper.pendingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", senderId: "gte:not-an-id" } as any),
		],
		[
			"pending airdrops token.id",
			() => AccountsMapper.pendingAirdrops({ idOrAliasOrEvmAddress: "0.0.1", tokenId: "gte:not-an-id" } as any),
		],
	] as const)("rejects a malformed comparator payload in %s", (_name, invoke) => {
		expect(invoke).toThrow(ValidationError);
	});

	it.each([
		["accounts list account.id", () => new AccountsListQueryDSL().accountId("gte:not-an-id")],
		[
			"crypto allowances spender.id",
			() => new AccountCryptoAllowancesDSL().idOrAliasOrEvmAddress("0.0.1").spenderId("gte:not-an-id"),
		],
		[
			"token allowances spender.id",
			() => new AccountTokenAllowancesDSL().idOrAliasOrEvmAddress("0.0.1").spenderId("gte:not-an-id"),
		],
		[
			"token allowances token.id",
			() => new AccountTokenAllowancesDSL().idOrAliasOrEvmAddress("0.0.1").spenderId("0.0.2").tokenId("gte:not-an-id"),
		],
		[
			"NFT allowances account.id",
			() => new AccountNftAllowancesDSL().idOrAliasOrEvmAddress("0.0.1").counterpartyId("gte:not-an-id"),
		],
		[
			"NFT allowances token.id",
			() => new AccountNftAllowancesDSL().idOrAliasOrEvmAddress("0.0.1").counterpartyId("0.0.2").tokenId("gte:not-an-id"),
		],
		["account tokens token.id", () => new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.1").tokenId("gte:not-an-id")],
		["owned NFTs token.id", () => new AccountNftsOwnedDSL().idOrAliasOrEvmAddress("0.0.1").tokenId("gte:not-an-id")],
		[
			"owned NFTs spender.id",
			() => new AccountNftsOwnedDSL().idOrAliasOrEvmAddress("0.0.1").spenderId("gte:not-an-id"),
		],
		[
			"outstanding airdrops receiver.id",
			() => new AccountOutstandingAirdropsDSL().idOrAliasOrEvmAddress("0.0.1").receiverId("gte:not-an-id"),
		],
		[
			"outstanding airdrops token.id",
			() => new AccountOutstandingAirdropsDSL().idOrAliasOrEvmAddress("0.0.1").tokenId("gte:not-an-id"),
		],
		[
			"pending airdrops sender.id",
			() => new AccountPendingAirdropsDSL().idOrAliasOrEvmAddress("0.0.1").senderId("gte:not-an-id"),
		],
		[
			"pending airdrops token.id",
			() => new AccountPendingAirdropsDSL().idOrAliasOrEvmAddress("0.0.1").tokenId("gte:not-an-id"),
		],
	] as const)("rejects a malformed direct DSL comparator payload in %s", (_name, invoke) => {
		expect(invoke).toThrow(ValidationError);
	});

	it("validates payloads supplied through fluent comparator callbacks", () => {
		expect(() => new AccountsListQueryDSL().accountId().greaterThanOrEqualTo("not-an-id")).toThrow(ValidationError);
		expect(() =>
			new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.1").tokenId().greaterThanOrEqualTo("not-an-id")
		).toThrow(ValidationError);

		const account = new AccountsListQueryDSL().accountId().greaterThanOrEqualTo("1.7")._build();
		const token = new AccountTokensDSL().idOrAliasOrEvmAddress("0.0.1").tokenId().lessThanOrEqualTo("1.7")._build();
		expect(account.params["account.id"]).toBe("gte:1.7");
		expect(token.params["token.id"]).toBe("lte:1.7");
	});
});
