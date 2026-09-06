import { describe, expect, expectTypeOf, it } from "vitest";

import { AccountHookStorageDSL } from "../src/dsl/accounts";
import type {
	AccountHooksPage,
	AccountHooksQuery,
	AccountHookStoragePage,
	AccountHookStorageQuery,
	EntityIdNullable,
	Hook,
	HooksStorageResponse,
	Int64,
	JavaLongRangeFilter,
	JavaLongValue,
	Key,
} from "../src";

describe("account hook public types", () => {
	it("preserves int64 precision, response nullability, literals, and page metadata", () => {
		expectTypeOf<AccountHooksQuery["hookId"]>().toEqualTypeOf<JavaLongRangeFilter | readonly JavaLongRangeFilter[] | undefined>();
		expectTypeOf<AccountHookStorageQuery["hookId"]>().toEqualTypeOf<JavaLongValue>();
		new AccountHookStorageDSL().hookId("+1").hookId("-0").hookId("0000000000000000000000000000000001");
		expectTypeOf<Hook["admin_key"]>().toEqualTypeOf<Key | null>();
		expectTypeOf<Hook["contract_id"]>().toEqualTypeOf<EntityIdNullable>();
		expectTypeOf<Hook["extension_point"]>().toEqualTypeOf<"ACCOUNT_ALLOWANCE_HOOK">();
		expectTypeOf<Hook["type"]>().toEqualTypeOf<"EVM">();
		expectTypeOf<HooksStorageResponse["owner_id"]>().toEqualTypeOf<EntityIdNullable>();
		expectTypeOf<AccountHooksPage["hooks"]>().toEqualTypeOf<Hook[]>();
		expectTypeOf<AccountHookStoragePage["hook_id"]>().toEqualTypeOf<Int64>();
		expectTypeOf<AccountHookStoragePage["owner_id"]>().toEqualTypeOf<EntityIdNullable>();
		expectTypeOf<ReturnType<AccountHookStoragePage["next"]["url"]>>().toEqualTypeOf<string | null>();
		expect(true).toBe(true);
	});

	it("exposes no `notEqualTo` comparator for keys or timestamps", () => {
		const key = new AccountHookStorageDSL().key();
		key.equalTo("01");
		key.greaterThan("01");
		key.greaterThanOrEqualTo("01");
		key.lessThan("ff");
		key.lessThanOrEqualTo("ff");
		if (false) {
			// @ts-expect-error Hook storage keys do not support the `ne` operator.
			key.notEqualTo("01");
		}

		new AccountHookStorageDSL().timestamp().equalTo("1");
		new AccountHookStorageDSL().timestamp().greaterThan("3");
		new AccountHookStorageDSL().timestamp().greaterThanOrEqualTo("4");
		new AccountHookStorageDSL().timestamp().lessThan("5");
		new AccountHookStorageDSL().timestamp().lessThanOrEqualTo("6");
		if (false) {
			// @ts-expect-error Hook storage timestamps do not support the `ne` operator.
			new AccountHookStorageDSL().timestamp().notEqualTo("2");
		}
		expect(true).toBe(true);
	});
});
