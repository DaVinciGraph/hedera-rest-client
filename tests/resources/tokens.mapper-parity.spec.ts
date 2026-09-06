// tests/resources/tokens.mapper-parity.spec.ts
import { describe, it, expect } from "vitest";
import { TokensMapper } from "../../src/resources/tokens/mapper";
import { TokensListQueryBuilder, TokenOneQueryBuilder, TokenBalancesQueryBuilder, TokenNftsListQueryBuilder, TokenNftOneQueryBuilder, TokenNftTransactionsQueryBuilder } from "../../src/dsl/tokens";
import { ValidationError } from "../../src/core/errors";

describe("TokensMapper — parity (object vs DSL)", () => {
	const TOKEN_ADDRESS = "000000000000000000000000000000000001a44a";
	const ACCOUNT_EVM_ADDRESS = `0x${"ab".repeat(20)}`;

	/* ============ /tokens (list) ============ */

	it("list: empty → {}", () => {
		expect(TokensMapper.list(undefined)).toEqual({});
		const dsl = new TokensListQueryBuilder().build();
		expect(TokensMapper.list(dsl)).toEqual({});
	});

	it("list: exact accountId + tokenId comparator + type + order + limit", () => {
		const obj = {
			accountId: "0.0.100",
			tokenId: "gte:0.0.200",
			type: "FUNGIBLE_COMMON",
			order: "desc",
			limit: 7,
		} as any;

		const mapObj = TokensMapper.list(obj);

		const dsl = new TokensListQueryBuilder().accountId("0.0.100").tokenId().greaterThanOrEqualTo("0.0.200").type("FUNGIBLE_COMMON").order("desc").limit(7).build();

		const mapDsl = TokensMapper.list(dsl);

		expect(mapObj).toEqual({
			"account.id": "0.0.100",
			"token.id": "gte:0.0.200",
			type: "FUNGIBLE_COMMON",
			order: "desc",
			limit: 7,
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("list: name is mutually exclusive with accountId/tokenId (object + DSL)", () => {
		const badObj = { name: "USDC", accountId: "0.0.2" } as any;
		expect(() => TokensMapper.list(badObj)).toThrow(ValidationError);

		expect(() => new TokensListQueryBuilder().name("USDC").accountId("0.0.2").build()).toThrow(ValidationError);

		expect(() => new TokensListQueryBuilder().name("USDC").tokenId("0.0.3").build()).toThrow(ValidationError);
	});

	it("list: future token types pass through while empty values are rejected", () => {
		expect(TokensMapper.list({ type: "FUTURE_TOKEN_TYPE" })).toEqual({ type: "FUTURE_TOKEN_TYPE" });
		expect(new TokensListQueryBuilder().type("PROVIDER_SPECIFIC_TYPE").build().type).toBe("PROVIDER_SPECIFIC_TYPE");

		expect(() => TokensMapper.list({ type: "" })).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().type("")).toThrow(ValidationError);
		expect(() => TokensMapper.list({ type: ["ALL", ""] })).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().type(["ALL", ""])).toThrow(ValidationError);
	});

	it("list: preserves repeated token type filters from object and DSL queries", () => {
		const types = ["FUNGIBLE_COMMON", "NON_FUNGIBLE_UNIQUE"] as const;
		expect(TokensMapper.list({ type: types })).toEqual({ type: [...types] });

		const dsl = new TokensListQueryBuilder().type("FUNGIBLE_COMMON").type("NON_FUNGIBLE_UNIQUE").build();
		expect(TokensMapper.list(dsl)).toEqual({ type: [...types] });
	});

	it("list: preserves supplied token type casing", () => {
		const types = ["all", "FuNgIbLe_CoMmOn", "NON_fUnGiBlE_UnIqUe"] as any;
		expect(TokensMapper.list({ type: types })).toEqual({ type: types });

		const dsl = new TokensListQueryBuilder()
			.type("all")
			.type("FuNgIbLe_CoMmOn" as any)
			.type("NON_fUnGiBlE_UnIqUe" as any)
			.build();
		expect(TokensMapper.list(dsl)).toEqual({ type: types });
	});

	it("list: token type occurrences must contain one to 100 valid values", () => {
		expect(() => TokensMapper.list({ type: [] } as any)).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().type([])).toThrow(ValidationError);

		const tooMany = Array.from({ length: 101 }, () => "ALL") as any;
		expect(() => TokensMapper.list({ type: tooMany })).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().type(tooMany)).toThrow(ValidationError);

		const accumulated = new TokensListQueryBuilder();
		for (let index = 0; index < 100; index += 1) accumulated.type("ALL");
		expect(() => accumulated.type("ALL")).toThrow(ValidationError);
	});

	it("list: preserves repeated token.id equality and range filters", () => {
		const filters = ["0.0.1", "eq:0.0.2", "gte:0.0.3"];
		const objectMapped = TokensMapper.list({ tokenId: filters });
		const dslMapped = TokensMapper.list(
			new TokensListQueryBuilder().tokenId(["0.0.1", "eq:0.0.2"]).tokenId().greaterThanOrEqualTo("0.0.3").build()
		);
		expect(objectMapped).toEqual({ "token.id": filters });
		expect(dslMapped).toEqual(objectMapped);
	});

	it("list: public key + name only", () => {
		const obj = { publicKey: "302a300506032b6570032100deadbeef", name: "HTS" } as any;
		const mapObj = TokensMapper.list(obj);

		const dsl = new TokensListQueryBuilder().publicKey("302a300506032b6570032100deadbeef").name("HTS").build();
		const mapDsl = TokensMapper.list(dsl);

		expect(mapObj).toEqual({
			publickey: "302a300506032b6570032100deadbeef",
			name: "HTS",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("list: accepts request-ID shorthand and an exact token Solidity address", () => {
		const objectMapped = TokensMapper.list({
			accountId: "0.100",
			tokenId: TOKEN_ADDRESS,
		});
		const dslMapped = TokensMapper.list(new TokensListQueryBuilder().accountId("0.100").tokenId(TOKEN_ADDRESS).build());

		expect(objectMapped).toEqual({
			"account.id": "0.100",
			"token.id": TOKEN_ADDRESS,
		});
		expect(dslMapped).toEqual(objectMapped);
	});

	it("list: accepts an exact account EVM address and token-address comparators", () => {
		const tokenFilter = `gte:0x${TOKEN_ADDRESS}`;
		const objectMapped = TokensMapper.list({ accountId: ACCOUNT_EVM_ADDRESS, tokenId: tokenFilter });
		const dslMapped = TokensMapper.list(
			new TokensListQueryBuilder().accountId(ACCOUNT_EVM_ADDRESS).tokenId().greaterThanOrEqualTo(`0x${TOKEN_ADDRESS}`).build()
		);

		expect(objectMapped).toEqual({ "account.id": ACCOUNT_EVM_ADDRESS, "token.id": tokenFilter });
		expect(dslMapped).toEqual(objectMapped);
	});

	it("list: rejects account comparators/base32 aliases and invalid token comparator payloads", () => {
		expect(() => TokensMapper.list({ accountId: "eq:0.0.100" } as any)).toThrow(ValidationError);
		expect(() => TokensMapper.list({ accountId: "gte:not-an-id" } as any)).toThrow(ValidationError);
		expect(() => TokensMapper.list({ accountId: "A".repeat(66) } as any)).toThrow(ValidationError);
		expect(() => TokensMapper.list({ tokenId: "gte:not-an-id" } as any)).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().accountId("eq:0.0.100")).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().accountId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().accountId("A".repeat(66))).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().tokenId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().tokenId().greaterThanOrEqualTo("not-an-id")).toThrow(ValidationError);
	});

	it("list: rejects non-long-zero 40-byte token addresses", () => {
		const arbitraryAddress = `0x${"ab".repeat(20)}`;
		expect(() => TokensMapper.list({ tokenId: arbitraryAddress })).toThrow(ValidationError);
		expect(() => new TokensListQueryBuilder().tokenId(arbitraryAddress)).toThrow(ValidationError);
	});

	/* ============ /tokens/{id} (one) ============ */

	it("one: full tokenId, no timestamp", () => {
		const obj = { tokenId: "0.0.1001" } as any;
		const mapObj = TokensMapper.one(obj);

		const dslQ = new TokenOneQueryBuilder().tokenId("0.0.1001").build();
		const mapDsl = TokensMapper.one(dslQ);

		expect(mapObj.id).toBe("0.0.1001");
		expect(mapObj.params).toEqual({});
		expect(mapObj.cacheKey).toBe("token:0.0.1001:");

		expect(mapDsl).toEqual(mapObj);
	});

	it("token paths: preserve one-/two-part IDs and documented Solidity-address forms", () => {
		const pathIds = ["1001", "0.1001", `0x${TOKEN_ADDRESS}`, `0.0.${TOKEN_ADDRESS}`];

		for (const tokenId of pathIds) {
			expect(TokensMapper.one({ tokenId }).id).toBe(tokenId);
			expect(new TokenOneQueryBuilder().tokenId(tokenId).build().tokenId).toBe(tokenId);

			expect(TokensMapper.balances({ tokenId }).id).toBe(tokenId);
			expect(new TokenBalancesQueryBuilder().tokenId(tokenId).build().tokenId).toBe(tokenId);

			expect(TokensMapper.nftsList({ tokenId }).id).toBe(tokenId);
			expect(new TokenNftsListQueryBuilder().tokenId(tokenId).build().tokenId).toBe(tokenId);

			expect(TokensMapper.nftOne({ tokenId, serialNumber: 1 }).id).toBe(tokenId);
			expect(new TokenNftOneQueryBuilder().tokenId(tokenId).serialNumber(1).build().tokenId).toBe(tokenId);

			expect(TokensMapper.nftTx({ tokenId, serialNumber: 1 }).id).toBe(tokenId);
			expect(new TokenNftTransactionsQueryBuilder().tokenId(tokenId).serialNumber(1).build().tokenId).toBe(tokenId);
		}
	});

	it("one: with exact timestamp", () => {
		const obj = { tokenId: "0.0.9", timestamp: "1700000000.123" } as any;
		const mapObj = TokensMapper.one(obj);

		const dslQ = new TokenOneQueryBuilder().tokenId("0.0.9").timestamp("1700000000.123").build();
		const mapDsl = TokensMapper.one(dslQ);

		expect(mapObj).toEqual({
			id: "0.0.9",
			params: { timestamp: "1700000000.123" },
			cacheKey: "token:0.0.9:1700000000.123",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("one: comparator timestamp (lte)", () => {
		const obj = { tokenId: "0.0.9", timestamp: "lte:1700000000.125" } as any;
		const mapObj = TokensMapper.one(obj);

		const dslQ = new TokenOneQueryBuilder().tokenId("0.0.9").timestamp().lessThanOrEqualTo("1700000000.125").build();
		const mapDsl = TokensMapper.one(dslQ);

		expect(mapObj.params).toEqual({ timestamp: "lte:1700000000.125" });
		expect(mapDsl).toEqual(mapObj);
	});

	it("one: repeated timestamps preserve every occurrence and key the effective last value", () => {
		const timestamps = ["eq:1700000000.1", "lt:1700000001", "lte:1700000002.2"];
		const mapObj = TokensMapper.one({ tokenId: "0.0.9", timestamp: timestamps });

		const dslQ = new TokenOneQueryBuilder()
			.tokenId("0.0.9")
			.timestamp(["eq:1700000000.1", "lt:1700000001"])
			.timestamp()
			.lessThanOrEqualTo("1700000002.2")
			.build();
		const mapDsl = TokensMapper.one(dslQ);

		expect(mapObj).toEqual({
			id: "0.0.9",
			params: { timestamp: timestamps },
			cacheKey: "token:0.0.9:lte:1700000002.2",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("one: validates every timestamp and enforces one to 100 occurrences", () => {
		const invalidEarlier = ["gte:1700000000", "lte:1700000001"];
		expect(() => TokensMapper.one({ tokenId: "0.0.9", timestamp: invalidEarlier } as any)).toThrow(ValidationError);
		expect(() => new TokenOneQueryBuilder().tokenId("0.0.9").timestamp(invalidEarlier as any)).toThrow(ValidationError);

		expect(() => TokensMapper.one({ tokenId: "0.0.9", timestamp: [] } as any)).toThrow(ValidationError);
		expect(() => new TokenOneQueryBuilder().tokenId("0.0.9").timestamp([])).toThrow(ValidationError);

		const tooMany = Array.from({ length: 101 }, () => "lte:1700000001");
		expect(() => TokensMapper.one({ tokenId: "0.0.9", timestamp: tooMany })).toThrow(ValidationError);
		expect(() => new TokenOneQueryBuilder().tokenId("0.0.9").timestamp(tooMany)).toThrow(ValidationError);

		const accumulated = new TokenOneQueryBuilder().tokenId("0.0.9");
		for (let index = 0; index < 100; index += 1) accumulated.timestamp("lte:1700000001");
		expect(() => accumulated.timestamp("lte:1700000001")).toThrow(ValidationError);
	});

	it("one: invalid timestamp form throws (object + DSL)", () => {
		const badObj = { tokenId: "0.0.9", timestamp: "gte:1700000000" } as any; // no ".fraction"
		expect(() => TokensMapper.one(badObj)).toThrow(ValidationError);

		// The DSL validates the timestamp eagerly.
		expect(() => new TokenOneQueryBuilder().tokenId("0.0.9").timestamp("gte:1700000000")).toThrow(ValidationError);
	});

	/* ============ /tokens/{id}/balances ============ */

	it("balances: accountId comparator + accountBalance eq number + timestamps array + order/limit", () => {
		const obj = {
			tokenId: "0.0.7",
			accountId: "gt:0.0.10",
			accountBalance: 1000,
			timestamp: ["gte:1700000000", "lte:1700000010"],
			order: "asc",
			limit: 3,
		} as any;

		const mapObj = TokensMapper.balances(obj);

		const dslQ = new TokenBalancesQueryBuilder()
			.tokenId("0.0.7")
			.accountId()
			.greaterThan("0.0.10")
			.accountBalance(1000)
			.timestamp("gte:1700000000")
			.timestamp("lte:1700000010")
			.order("asc")
			.limit(3)
			.build();
		const mapDsl = TokensMapper.balances(dslQ);

		expect(mapObj).toEqual({
			id: "0.0.7",
			params: {
				"account.id": "gt:0.0.10",
				"account.balance": 1000,
				timestamp: ["gte:1700000000", "lte:1700000010"],
				order: "asc",
				limit: 3,
			},
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("balances: accountPublicKey + accountBalance comparator", () => {
		const obj = {
			tokenId: "0.0.8",
			accountPublicKey: "abcd",
			accountBalance: "gte:500",
		} as any;

		const mapObj = TokensMapper.balances(obj);

		const dslQ = new TokenBalancesQueryBuilder().tokenId("0.0.8").accountPublicKey("abcd").accountBalance().greaterThanOrEqualTo(500).build();
		const mapDsl = TokensMapper.balances(dslQ);

		expect(mapObj.params).toEqual({
			"account.publickey": "abcd",
			"account.balance": "gte:500",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("balances: preserves an exact zero balance filter", () => {
		expect(TokensMapper.balances({ tokenId: "0.0.8", accountBalance: 0 }).params).toEqual({
			"account.balance": 0,
		});
	});

	it("balances: account.id supports EVM comparator payloads", () => {
		const filter = `gt:${ACCOUNT_EVM_ADDRESS}`;
		const objectMapped = TokensMapper.balances({ tokenId: "0.0.8", accountId: filter });
		const dslMapped = TokensMapper.balances(
			new TokenBalancesQueryBuilder().tokenId("0.0.8").accountId().greaterThan(ACCOUNT_EVM_ADDRESS).build()
		);

		expect(objectMapped.params["account.id"]).toBe(filter);
		expect(dslMapped).toEqual(objectMapped);
	});

	it("balances: preserves repeated account and balance filters", () => {
		const objectMapped = TokensMapper.balances({
			tokenId: "0.0.8",
			accountId: ["0.0.1", "gte:0.0.2"],
			accountBalance: [0, "gt:10", "lte:20"],
		});
		const dslMapped = TokensMapper.balances(
			new TokenBalancesQueryBuilder()
				.tokenId("0.0.8")
				.accountId("0.0.1")
				.accountId().greaterThanOrEqualTo("0.0.2")
				.accountBalance([0, "gt:10"])
				.accountBalance().lessThanOrEqualTo(20)
				.build()
		);
		expect(dslMapped).toEqual(objectMapped);
	});

	it("balances and NFT lists reject invalid account.id comparator payloads", () => {
		expect(() => TokensMapper.balances({ tokenId: "0.0.8", accountId: "gte:not-an-id" })).toThrow(ValidationError);
		expect(() => new TokenBalancesQueryBuilder().tokenId("0.0.8").accountId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => new TokenBalancesQueryBuilder().tokenId("0.0.8").accountId().greaterThanOrEqualTo("not-an-id")).toThrow(ValidationError);

		expect(() => TokensMapper.nftsList({ tokenId: "0.0.8", accountId: "gte:not-an-id" })).toThrow(ValidationError);
		expect(() => new TokenNftsListQueryBuilder().tokenId("0.0.8").accountId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => new TokenNftsListQueryBuilder().tokenId("0.0.8").accountId().greaterThanOrEqualTo("not-an-id")).toThrow(ValidationError);
	});

	/* ============ /tokens/{id}/nfts (list) ============ */

	it("nftsList: accountId + serialNumber eq int", () => {
		const obj = {
			tokenId: "0.0.77",
			accountId: "0.0.5",
			serialNumber: 42,
			order: "desc",
			limit: 2,
		} as any;

		const mapObj = TokensMapper.nftsList(obj);

		const dslQ = new TokenNftsListQueryBuilder().tokenId("0.0.77").accountId("0.0.5").serialNumber(42).order("desc").limit(2).build();

		const mapDsl = TokensMapper.nftsList(dslQ);
		expect(mapDsl).toEqual(mapObj);
		expect(mapObj).toEqual({
			id: "0.0.77",
			params: {
				"account.id": "0.0.5",
				serialnumber: "42",
				order: "desc",
				limit: 2,
			},
		});
	});

	it("nftsList: serialNumber supports lte and ne comparators", () => {
		const okObj = { tokenId: "0.0.10", serialNumber: "lte:500" } as any;
		const mapOk = TokensMapper.nftsList(okObj);
		expect(mapOk.params.serialnumber).toBe("lte:500");

		const objectMapped = TokensMapper.nftsList({ tokenId: "0.0.10", serialNumber: "ne:5" });
		const dslMapped = TokensMapper.nftsList(
			new TokenNftsListQueryBuilder()
				.tokenId("0.0.10")
				.serialNumber()
				.notEqualTo(5)
				.build()
		);

		expect(objectMapped.params.serialnumber).toBe("ne:5");
		expect(dslMapped).toEqual(objectMapped);
	});

	it("nftsList: account.id supports numeric and EVM comparators", () => {
		const objectMapped = TokensMapper.nftsList({ tokenId: "0.0.10", accountId: `ne:${ACCOUNT_EVM_ADDRESS}` });
		const dsl = new TokenNftsListQueryBuilder().tokenId("0.0.10").accountId().notEqualTo(ACCOUNT_EVM_ADDRESS).build();

		expect(objectMapped.params["account.id"]).toBe(`ne:${ACCOUNT_EVM_ADDRESS}`);
		expect(TokensMapper.nftsList(dsl)).toEqual(objectMapped);
	});

	it("nftsList: preserves repeated account and serial filters", () => {
		const objectMapped = TokensMapper.nftsList({
			tokenId: "0.0.10",
			accountId: ["0.0.1", "ne:0.0.2"],
			serialNumber: [1, "gte:2", "lte:9"],
		});
		const dslMapped = TokensMapper.nftsList(
			new TokenNftsListQueryBuilder()
				.tokenId("0.0.10")
				.accountId(["0.0.1", "ne:0.0.2"])
				.serialNumber([1, "gte:2"])
				.serialNumber().lessThanOrEqualTo(9)
				.build()
		);
		expect(dslMapped).toEqual(objectMapped);
		expect(() => TokensMapper.nftsList({ tokenId: "0.0.10", serialNumber: Array.from({ length: 101 }, () => 1) })).toThrow(ValidationError);
	});

	/* ============ /tokens/{id}/nfts/{serial} (one) ============ */

	it("nftOne: id + serial, cacheKey", () => {
		const obj = { tokenId: "0.0.1", serialNumber: 7 } as any;
		const mapObj = TokensMapper.nftOne(obj);

		const dslQ = new TokenNftOneQueryBuilder().tokenId("0.0.1").serialNumber(7).build();
		const mapDsl = TokensMapper.nftOne(dslQ);

		expect(mapObj).toEqual({
			id: "0.0.1",
			serial: "7",
			cacheKey: "nft:0.0.1:7",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	/* ============ /tokens/{id}/nfts/{serial}/transactions ============ */

	it("nftTx: timestamps array (mixed exact & comparator) + order/limit", () => {
		const obj = {
			tokenId: "0.0.2",
			serialNumber: 11,
			timestamp: ["gte:1700000000", "1700000005.12345"],
			order: "asc",
			limit: 5,
		} as any;
		const mapObj = TokensMapper.nftTx(obj);

		const dslQ = new TokenNftTransactionsQueryBuilder().tokenId("0.0.2").serialNumber(11).timestamp("gte:1700000000").timestamp("1700000005.12345").order("asc").limit(5).build();
		const mapDsl = TokensMapper.nftTx(dslQ);

		expect(mapObj).toEqual({
			id: "0.0.2",
			serial: "11",
			params: {
				timestamp: ["gte:1700000000", "1700000005.12345"],
				order: "asc",
				limit: 5,
			},
		});
		expect(mapDsl).toEqual(mapObj);
	});
});
