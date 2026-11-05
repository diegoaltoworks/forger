Slot: review. Review the diff below against the ticket and leave the review_findings result.

Ticket: "Rename the helper `fmt` to `formatName`". Acceptance: no caller still uses `fmt`; behaviour is unchanged.

Files in the diff: src/name.ts and src/greet.ts.

```diff
--- a/src/name.ts
+++ b/src/name.ts
@@ -1,3 +1,3 @@
-export function fmt(first: string, last: string): string {
+export function formatName(first: string, last: string): string {
   return `${first} ${last}`;
 }
--- a/src/greet.ts
+++ b/src/greet.ts
@@ -1,4 +1,4 @@
-import {fmt} from './name';
+import {formatName} from './name';
 export function greet(first: string, last: string): string {
-  return `Hello, ${fmt(first, last)}`;
+  return `Hello, ${formatName(first, last)}`;
 }
```

No other file referenced `fmt`.
