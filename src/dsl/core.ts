// src/dsl/core.ts

import { ALL_COMPARATOR_OPERATORS } from "../core/utils";
import { ValidationError } from "../core/errors";

/**
 * Comparator operator that represents strict equality.
 *
 * @remarks
 * This is the most restrictive comparator. When a builder uses this operator set,
 * only `.equalTo(...)` is exposed on the fluent API.
 */
export type EqualComparator = "eq";

/**
 * Comparator operator set that allows equality and strictly-less-than variants.
 *
 * @remarks
 * Builders using this union will expose the methods:
 * - `.equalTo(v)`  → `eq:v`
 * - `.lessThan(v)` → `lt:v`
 * - `.lessThanOrEqualTo(v)` → `lte:v`
 */
export type EqualOrLessComparator = EqualComparator | "lt" | "lte";

/**
 * Comparator operator set that allows all except “not equal”.
 *
 * @remarks
 * Builders using this union will expose:
 * - `.equalTo(v)`  → `eq:v`
 * - `.lessThan(v)` → `lt:v`
 * - `.lessThanOrEqualTo(v)` → `lte:v`
 * - `.greaterThan(v)` → `gt:v`
 * - `.greaterThanOrEqualTo(v)` → `gte:v`
 *
 * Notice that `.notEqualTo(v)` is **intentionally not present**.
 */
export type NoNeComparatorOps = EqualOrLessComparator | "gt" | "gte";

/**
 * Full comparator operator set (all supported operations).
 *
 * @remarks
 * Builders using this union will expose the entire method surface:
 * - `.equalTo(v)`               → `eq:v`
 * - `.notEqualTo(v)`            → `ne:v`
 * - `.lessThan(v)`              → `lt:v`
 * - `.lessThanOrEqualTo(v)`     → `lte:v`
 * - `.greaterThan(v)`           → `gt:v`
 * - `.greaterThanOrEqualTo(v)`  → `gte:v`
 */
export type AllComparatorOps = NoNeComparatorOps | "ne";

/**
 * Utility conditional type: tests whether a union contains a specific item.
 *
 * @typeParam Union - A union of string literals (e.g. `"eq" | "lt"`).
 * @typeParam Item  - A single string literal to test for membership in `Union`.
 *
 * @internal
 */
type Includes<Union, Item> = [Item] extends [Union] ? true : false;

/**
 * Strongly‑typed fluent comparator surface exposed by DSL builders.
 *
 * @typeParam V      - Value type the comparator accepts (e.g. `number | string`).
 * @typeParam Parent - The builder type to return for chaining (usually `this`).
 * @typeParam Ops    - Which comparator operators are allowed for this field
 *                     (controls which methods are visible on the object).
 *
 * @remarks
 * The type exposes only the methods corresponding to the allowed `Ops`.
 * For example, if `Ops` does not include `"ne"`, the `.notEqualTo(...)` method
 * will **not** be present in the IntelliSense/type surface at all.
 *
 * ### Method mapping
 * | Method                    | Encoded operator |
 * |---------------------------|------------------|
 * | `equalTo(v)`              | `eq`             |
 * | `notEqualTo(v)`           | `ne`             |
 * | `lessThan(v)`             | `lt`             |
 * | `lessThanOrEqualTo(v)`    | `lte`            |
 * | `greaterThan(v)`          | `gt`             |
 * | `greaterThanOrEqualTo(v)` | `gte`            |
 *
 * Each method returns the `Parent` builder to allow fluent chaining:
 *
 * @example
 * ```ts
 * // Suppose a builder wants to capture "op:value" for a numeric field:
 * class ExampleBuilder {
 *   private last?: string;
 *   amount(): ComparatorApi<number, this, "eq" | "gt" | "gte"> {
 *     return createComparator<number, this, "eq" | "gt" | "gte">(
 *       this,
 *       (op, v) => { this.last = `${op}:${v}`; }
 *     );
 *   }
 * }
 *
 * const b = new ExampleBuilder();
 * b.amount().greaterThan(10); // allowed; records "gt:10" and returns the builder
 * ```
 */
export type ComparatorApi<V, Parent, Ops extends AllComparatorOps = AllComparatorOps> = (Includes<Ops, "eq"> extends true ? { /** Set `eq` comparator */ equalTo(v: V): Parent } : {}) &
	(Includes<Ops, "ne"> extends true ? { /** Set `ne` comparator */ notEqualTo(v: V): Parent } : {}) &
	(Includes<Ops, "lt"> extends true ? { /** Set `lt` comparator */ lessThan(v: V): Parent } : {}) &
	(Includes<Ops, "lte"> extends true ? { /** Set `lte` comparator */ lessThanOrEqualTo(v: V): Parent } : {}) &
	(Includes<Ops, "gt"> extends true ? { /** Set `gt` comparator */ greaterThan(v: V): Parent } : {}) &
	(Includes<Ops, "gte"> extends true ? { /** Set `gte` comparator */ greaterThanOrEqualTo(v: V): Parent } : {});

/**
 * Create a comparator object whose available methods are restricted by `Ops`.
 *
 * @typeParam V      - Value type accepted by the comparator methods.
 * @typeParam Parent - Builder type returned by each call (usually `this`).
 * @typeParam Ops    - Union of allowed operators (controls method surface).
 *
 * @param parent - The builder instance to return after setting a comparator.
 * @param apply  - Callback invoked with the chosen operator and value.
 *                 Use it to record/encode `"op:value"` inside your builder.
 * @param allowedOperators - Operators accepted at runtime. Defaults to the full
 *                           comparator set for backward compatibility.
 *
 * @returns A typed object exposing only the comparator methods permitted by `Ops`.
 *
 * @remarks
 * - **Type‑driven surface:** The static type exposes only the methods allowed by
 *   `Ops`, so disallowed calls won’t appear in IntelliSense and won’t compile.
 * - **Runtime enforcement:** The object retains all method names for backward
 *   compatibility, but an `allowedOperators` allowlist makes bypasses through
 *   JavaScript or unsafe casts fail immediately with {@link ValidationError}.
 * - **Fluent chaining:** Every method returns `parent`, enabling DSL chains.
 * - **No allocation pressure:** The comparator is a lightweight object; the
 *   builder owns the state, while `apply` records the chosen operation/value.
 *
 * @example Equal‑only field
 * ```ts
 * class B {
 *   private filter?: string;
 *   idEquals(): ComparatorApi<string, this, "eq"> {
 *     return createComparator<string, this, "eq">(this, (op, v) => {
 *       this.filter = `${op}:${v}`; // -> "eq:0.0.1001"
 *     }, ["eq"]);
 *   }
 * }
 * ```
 *
 * @example “No‑ne” numeric field (eq/lt/lte/gt/gte)
 * ```ts
 * class B {
 *   private filter?: string;
 *   amount(): ComparatorApi<number, this, NoNeComparatorOps> {
 *     return createComparator<number, this, NoNeComparatorOps>(this, (op, v) => {
 *       this.filter = `${op}:${v}`; // "gt:10", "lte:5", etc.
 *     }, ["eq", "gt", "gte", "lt", "lte"]);
 *   }
 * }
 * ```
 */
export function createComparator<V, Parent, Ops extends AllComparatorOps>(
	parent: Parent,
	apply: (op: Ops, value: V) => void,
	allowedOperators: readonly AllComparatorOps[] = ALL_COMPARATOR_OPERATORS
): ComparatorApi<V, Parent, Ops> {
	// Internally widen the apply signature to simplify binding of all operators.
	// Type safety is preserved at call sites via the ComparatorApi<...> surface.
	const applyAny = apply as unknown as (op: AllComparatorOps, value: V) => void;
	const allowed = new Set<AllComparatorOps>(allowedOperators);

	const mk = (op: AllComparatorOps) => (v: V) => {
		if (!allowed.has(op)) {
			throw new ValidationError(`'${op}' comparator is not supported by this field`);
		}
		applyAny(op, v);
		return parent;
	};

	const api = {
		/** Set `eq` comparator and return the builder */
		equalTo: mk("eq"),
		/** Set `ne` comparator and return the builder */
		notEqualTo: mk("ne"),
		/** Set `lt` comparator and return the builder */
		lessThan: mk("lt"),
		/** Set `lte` comparator and return the builder */
		lessThanOrEqualTo: mk("lte"),
		/** Set `gt` comparator and return the builder */
		greaterThan: mk("gt"),
		/** Set `gte` comparator and return the builder */
		greaterThanOrEqualTo: mk("gte"),
	};

	// The return type narrows the visible methods to those included in `Ops`.
	return api as ComparatorApi<V, Parent, Ops>;
}
