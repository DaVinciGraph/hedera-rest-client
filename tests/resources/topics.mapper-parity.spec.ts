import { describe, it, expect } from "vitest";
import { TopicsMapper } from "../../src/resources/topics/mapper";
import { TopicOneQueryBuilder, TopicMessagesListQueryBuilder, TopicMessageBySequenceQueryBuilder, TopicMessageByTimestampQueryBuilder } from "../../src/dsl/topics";
import { ValidationError } from "../../src/core/errors";

describe("TopicsMapper — parity (object vs DSL)", () => {
	const TOPIC = "0.0.100";

	describe("topicOne()", () => {
		it("parity: valid id, cacheKey", () => {
			const obj = { topicId: TOPIC, useCache: true };
			const mapObj = TopicsMapper.topicOne(obj as any);
			expect(mapObj).toEqual({ id: TOPIC, cacheKey: `topic:${TOPIC}` });

			const dsl = new TopicOneQueryBuilder().topicId(TOPIC).useCache(true).build();
			const mapDsl = TopicsMapper.topicOne(dsl);
			expect(mapDsl).toEqual(mapObj);
		});

		it("invalid id throws (object + DSL)", () => {
			const badObj = { topicId: "abc.def" } as any; // not a request EntityId
			expect(() => TopicsMapper.topicOne(badObj)).toThrow(ValidationError);

			expect(() => new TopicOneQueryBuilder().topicId("abc.def")).toThrow(ValidationError);
		});

		it.each(["100", "0.100"])("accepts and preserves request-ID shorthand %s", (topicId) => {
			const objectMapped = TopicsMapper.topicOne({ topicId });
			const dslMapped = TopicsMapper.topicOne(new TopicOneQueryBuilder().topicId(topicId).build());

			expect(objectMapped).toEqual({ id: topicId, cacheKey: `topic:${topicId}` });
			expect(dslMapped).toEqual(objectMapped);
		});
	});

	describe("messagesList()", () => {
		it("accepts and preserves a two-part topic ID", () => {
			const objectMapped = TopicsMapper.messagesList({ topicId: "0.100" });
			const dslMapped = TopicsMapper.messagesList(new TopicMessagesListQueryBuilder().topicId("0.100").build());

			expect(objectMapped).toEqual({ id: "0.100", params: {} });
			expect(dslMapped).toEqual(objectMapped);
		});

		it("parity: encoding base64 + sequencenumber comparator + timestamp range + order/limit", () => {
			const obj = {
				topicId: TOPIC,
				encoding: "base64",
				sequenceNumber: "gte:100",
				timestamp: ["gte:1700000000", "lte:1700000010"],
				order: "desc",
				limit: 25,
			} as any;

			const mapObj = TopicsMapper.messagesList(obj);
			expect(mapObj.id).toBe(TOPIC);
			expect(mapObj.params).toEqual({
				encoding: "base64",
				sequencenumber: "gte:100",
				timestamp: ["gte:1700000000", "lte:1700000010"],
				order: "desc",
				limit: 25,
			});

			const dslBuilt = new TopicMessagesListQueryBuilder()
				.topicId(TOPIC)
				.encoding("base64")
				.sequenceNumber()
				.greaterThanOrEqualTo(100)
				.timestamp()
				.greaterThanOrEqualTo("1700000000")
				.timestamp()
				.lessThanOrEqualTo("1700000010")
				.order("desc")
				.limit(25)
				.build();

			const mapDsl = TopicsMapper.messagesList(dslBuilt);
			expect(mapDsl).toEqual(mapObj);
		});

		it.each(["base64", "BASE64", "BaSe64", "utf8", "UTF8", "uTf8", "utf-8", "UTF-8", "UtF-8"])(
			"accepts encoding %s case-insensitively and preserves its spelling",
			(encoding) => {
				const objectMapped = TopicsMapper.messagesList({ topicId: TOPIC, encoding } as any);
				const dslQuery = new TopicMessagesListQueryBuilder().topicId(TOPIC).encoding(encoding as any).build();

				expect(objectMapped.params.encoding).toBe(encoding);
				expect(dslQuery.encoding).toBe(encoding);
				expect(TopicsMapper.messagesList(dslQuery)).toEqual(objectMapped);
			}
		);

		it("parity: sequencenumber eq int + exact numeric timestamp (single)", () => {
			const obj = {
				topicId: TOPIC,
				sequenceNumber: 123,
				timestamp: 1700000000,
			} as any;

			const mapObj = TopicsMapper.messagesList(obj);
			expect(mapObj.params).toEqual({
				sequencenumber: 123,
				timestamp: [1700000000],
			});

			const dslBuilt = new TopicMessagesListQueryBuilder().topicId(TOPIC).sequenceNumber(123).timestamp(1700000000).build();

			const mapDsl = TopicsMapper.messagesList(dslBuilt);
			expect(mapDsl).toEqual(mapObj);
		});

		it.each(["hex", "", "base64 ", null, 1])("rejects invalid encoding %j in object and DSL forms", (encoding) => {
			expect(() => TopicsMapper.messagesList({ topicId: TOPIC, encoding } as any)).toThrow(ValidationError);
			expect(() => new TopicMessagesListQueryBuilder().topicId(TOPIC).encoding(encoding as any)).toThrow(ValidationError);
		});

		it("invalid sequencenumber comparator shape throws", () => {
			const obj = { topicId: TOPIC, sequenceNumber: "gte:notAnInt" } as any;
			expect(() => TopicsMapper.messagesList(obj)).toThrow(ValidationError);
			expect(() => new TopicMessagesListQueryBuilder().topicId(TOPIC).sequenceNumber("gte:notAnInt" as any)).toThrow(ValidationError);
			expect(() =>
				new TopicMessagesListQueryBuilder()
					.topicId(TOPIC)
					.sequenceNumber()
					.greaterThanOrEqualTo("notAnInt" as any)
					.build()
			).toThrow(ValidationError);
		});

		it("rejects the unsupported ne comparator for sequencenumber", () => {
			expect(() => TopicsMapper.messagesList({ topicId: TOPIC, sequenceNumber: "ne:1" } as any)).toThrow(ValidationError);
			expect(() => new TopicMessagesListQueryBuilder().topicId(TOPIC).sequenceNumber("ne:1")).toThrow(ValidationError);
		});

		it("rejects the unsupported ne comparator for timestamp", () => {
			expect(() => TopicsMapper.messagesList({ topicId: TOPIC, timestamp: "ne:1700000000" } as any)).toThrow(ValidationError);
			expect(() => new TopicMessagesListQueryBuilder().topicId(TOPIC).timestamp("ne:1700000000" as any)).toThrow(ValidationError);

			const fluent = new TopicMessagesListQueryBuilder().topicId(TOPIC).timestamp() as any;
			expect(() => fluent.notEqualTo("1700000000")).toThrow(ValidationError);
		});
	});

	describe("messageBySequence()", () => {
		it("accepts and preserves a one-part topic ID", () => {
			const objectMapped = TopicsMapper.messageBySequence({ topicId: "100", sequenceNumber: 1 });
			const dslMapped = TopicsMapper.messageBySequence(new TopicMessageBySequenceQueryBuilder().topicId("100").sequenceNumber(1).build());

			expect(objectMapped.id).toBe("100");
			expect(dslMapped).toEqual(objectMapped);
		});

		it("parity: id + positive seq -> id/seq string + cacheKey", () => {
			const obj = { topicId: TOPIC, sequenceNumber: 123, useCache: true } as any;
			const mapObj = TopicsMapper.messageBySequence(obj);
			expect(mapObj).toEqual({
				id: TOPIC,
				seq: "123",
				params: {},
				cacheKey: `topicmsg:${TOPIC}:123`,
			});

			const dsl = new TopicMessageBySequenceQueryBuilder().topicId(TOPIC).sequenceNumber(123).useCache(true).build();
			const mapDsl = TopicsMapper.messageBySequence(dsl);
			expect(mapDsl).toEqual(mapObj);
		});

		it("invalid seq (negative) throws", () => {
			const obj = { topicId: TOPIC, sequenceNumber: -5 } as any;
			expect(() => TopicsMapper.messageBySequence(obj)).toThrow(ValidationError);

			expect(() => new TopicMessageBySequenceQueryBuilder().topicId(TOPIC).sequenceNumber(-5).build()).toThrow(ValidationError);
		});
	});

	describe("messageByTimestamp()", () => {
		it("parity: exact timestamp only + cacheKey", () => {
			const ts = "1700000000.123456789";
			const obj = { timestamp: ts, useCache: true } as any;
			const mapObj = TopicsMapper.messageByTimestamp(obj);
			expect(mapObj).toEqual({ ts, params: {}, cacheKey: `topicmsgts:${ts}` });

			const dsl = new TopicMessageByTimestampQueryBuilder().timestamp(ts).useCache(true).build();
			const mapDsl = TopicsMapper.messageByTimestamp(dsl);
			expect(mapDsl).toEqual(mapObj);
		});

		it("invalid timestamp comparator throws for object and DSL callers", () => {
			const badObj = { timestamp: "gte:1700000000" } as any;
			expect(() => TopicsMapper.messageByTimestamp(badObj)).toThrow(ValidationError);

			expect(() => new TopicMessageByTimestampQueryBuilder().timestamp("gte:1700000000" as any)).toThrow(ValidationError);
		});
	});
});
