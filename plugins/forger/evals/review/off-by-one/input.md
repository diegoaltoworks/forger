Slot: review. Review the diff below against the ticket and leave the review_findings result.

Ticket: "Return the last N items of a list". Acceptance: `lastN(items, n)` returns the final n items, or all of them when n exceeds the length.

File src/list.ts in the diff (the only file changed):

```diff
--- a/src/list.ts
+++ b/src/list.ts
@@ -1,3 +1,7 @@
 export function first<T>(items: T[]): T | undefined {
   return items[0];
 }
+
+export function lastN<T>(items: T[], n: number): T[] {
+  return items.slice(items.length - n + 1);
+}
```

`lastN([1, 2, 3], 2)` returns `[3]`, not `[2, 3]`. Treat the diff as the whole repository change.
