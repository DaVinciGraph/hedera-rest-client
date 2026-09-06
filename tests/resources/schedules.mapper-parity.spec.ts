// tests/resources/schedules.mapper-parity.spec.ts
import { describe, it, expect } from "vitest";
import { SchedulesMapper } from "../../src/resources/schedules/mapper";
import { SchedulesListQueryBuilder, SchedulesOneQueryBuilder } from "../../src/dsl/schedules";
import { ValidationError } from "../../src/core/errors";

describe("SchedulesMapper — parity (object vs DSL)", () => {
	const EVM_ADDRESS = `0x${"ab".repeat(20)}`;

	/* ---------------------------------
     /api/v1/schedules (list)
     --------------------------------- */
	it("list: empty → empty params parity", () => {
		const obj = undefined;
		const mapObj = SchedulesMapper.list(obj);

		const dsl = new SchedulesListQueryBuilder().build();
		const mapDsl = SchedulesMapper.list(dsl);

		expect(mapObj).toEqual({});
		expect(mapDsl).toEqual(mapObj);
	});

	it("list: accountId comparator + scheduleId equality + order/limit parity", () => {
		const obj = {
			accountId: "gt:0.0.100",
			scheduleId: "0.0.500",
			order: "desc",
			limit: 7,
		} as any;

		const mapObj = SchedulesMapper.list(obj);

		const dsl = new SchedulesListQueryBuilder().accountId().greaterThan("0.0.100").scheduleId("0.0.500").order("desc").limit(7).build();
		const mapDsl = SchedulesMapper.list(dsl);

		expect(mapObj).toEqual({
			"account.id": "gt:0.0.100",
			"schedule.id": "0.0.500",
			order: "desc",
			limit: 7,
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("list: 'ne' comparator allowed for both accountId and scheduleId", () => {
		const obj = {
			accountId: "ne:0.0.123",
			scheduleId: "ne:0.0.456",
		} as any;

		const mapObj = SchedulesMapper.list(obj);

		const dsl = new SchedulesListQueryBuilder().accountId().notEqualTo("0.0.123").scheduleId().notEqualTo("0.0.456").build();
		const mapDsl = SchedulesMapper.list(dsl);

		expect(mapObj).toEqual({
			"account.id": "ne:0.0.123",
			"schedule.id": "ne:0.0.456",
		});
		expect(mapDsl).toEqual(mapObj);
	});

	it("list: accepts and preserves one-/two-part request IDs", () => {
		const objectMapped = SchedulesMapper.list({ accountId: "123", scheduleId: "0.456" });
		const dslMapped = SchedulesMapper.list(new SchedulesListQueryBuilder().accountId("123").scheduleId("0.456").build());

		expect(objectMapped).toEqual({ "account.id": "123", "schedule.id": "0.456" });
		expect(dslMapped).toEqual(objectMapped);
	});

	it("list: accepts EVM-address comparator payloads for both generic filters", () => {
		const objectMapped = SchedulesMapper.list({ accountId: `gte:${EVM_ADDRESS}`, scheduleId: `ne:${EVM_ADDRESS}` });
		const dslMapped = SchedulesMapper.list(
			new SchedulesListQueryBuilder().accountId().greaterThanOrEqualTo(EVM_ADDRESS).scheduleId().notEqualTo(EVM_ADDRESS).build()
		);

		expect(objectMapped).toEqual({ "account.id": `gte:${EVM_ADDRESS}`, "schedule.id": `ne:${EVM_ADDRESS}` });
		expect(dslMapped).toEqual(objectMapped);
	});

	it("list: rejects invalid comparator payloads in direct and fluent forms", () => {
		expect(() => SchedulesMapper.list({ accountId: "gte:not-an-id" } as any)).toThrow(ValidationError);
		expect(() => SchedulesMapper.list({ scheduleId: "gte:not-an-id" } as any)).toThrow(ValidationError);
		expect(() => new SchedulesListQueryBuilder().accountId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => new SchedulesListQueryBuilder().scheduleId("gte:not-an-id")).toThrow(ValidationError);
		expect(() => new SchedulesListQueryBuilder().accountId().greaterThanOrEqualTo("not-an-id")).toThrow(ValidationError);
		expect(() => new SchedulesListQueryBuilder().scheduleId().greaterThanOrEqualTo("not-an-id")).toThrow(ValidationError);
	});

	it("list: invalid entity id (object) throws", () => {
		const obj = { accountId: "0.0.bad" } as any;
		expect(() => SchedulesMapper.list(obj)).toThrow(ValidationError);
	});

	it("list: invalid entity id (DSL) throws on setter", () => {
		const dsl = new SchedulesListQueryBuilder();
		expect(() => dsl.accountId("0.0.bad")).toThrow(ValidationError);
	});

	it("list: invalid comparator string throws (object + DSL)", () => {
		const obj = { scheduleId: "bogus:0.0.1" } as any;
		expect(() => SchedulesMapper.list(obj)).toThrow(ValidationError);

		// The DSL validates on the setter when a comparator string is provided.
		expect(() => new SchedulesListQueryBuilder().scheduleId("bogus:0.0.1")).toThrow(ValidationError);
	});

	/* ---------------------------------
     /api/v1/schedules/{id} (one)
     --------------------------------- */
	it("one: parity for id + cacheKey", () => {
		const obj = { scheduleId: "0.0.321", useCache: true } as any;
		const mapObj = SchedulesMapper.one(obj);

		const dsl = new SchedulesOneQueryBuilder().scheduleId("0.0.321").useCache(true).build();
		const mapDsl = SchedulesMapper.one(dsl);

		expect(mapObj).toEqual({ id: "0.0.321", cacheKey: "schedules:0.0.321" });
		expect(mapDsl).toEqual(mapObj);
	});

	it("list: preserves repeated account and schedule filters", () => {
		const objectMapped = SchedulesMapper.list({
			accountId: ["0.0.1", "gte:0.0.2"],
			scheduleId: ["0.0.3", "lte:0.0.9"],
		});
		const dslMapped = SchedulesMapper.list(
			new SchedulesListQueryBuilder()
				.accountId("0.0.1")
				.accountId().greaterThanOrEqualTo("0.0.2")
				.scheduleId(["0.0.3", "lte:0.0.9"])
				.build()
		);
		expect(dslMapped).toEqual(objectMapped);
	});

	it.each(["321", "0.321"])("one: accepts and preserves request-ID shorthand %s", (scheduleId) => {
		const objectMapped = SchedulesMapper.one({ scheduleId });
		const dslMapped = SchedulesMapper.one(new SchedulesOneQueryBuilder().scheduleId(scheduleId).build());

		expect(objectMapped).toEqual({ id: scheduleId, cacheKey: `schedules:${scheduleId}` });
		expect(dslMapped).toEqual(objectMapped);
	});

	it("one: missing id (object) throws ValidationError", () => {
		expect(() => SchedulesMapper.one({} as any)).toThrow(ValidationError);
	});

	it("one: invalid id throws (object + DSL)", () => {
		expect(() => SchedulesMapper.one({ scheduleId: "0.0.bad" } as any)).toThrow(ValidationError);
		expect(() => SchedulesMapper.one({ scheduleId: EVM_ADDRESS })).toThrow(ValidationError);
		const dsl = new SchedulesOneQueryBuilder();
		expect(() => dsl.scheduleId("0.0.bad")).toThrow(ValidationError);
		expect(() => dsl.scheduleId(EVM_ADDRESS)).toThrow(ValidationError);
	});
});
