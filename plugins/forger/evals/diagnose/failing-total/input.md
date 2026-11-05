Slot: diagnose. The gate below is red; reproduce it, form one hypothesis, test it, and leave the diagnosis result.

Gate command: `bun test src/total.test.ts`

Its output:

```
src/total.test.ts:
error: expect(received).toBe(expected)
Expected: 30
Received: 20
  at total.test.ts:7  (sums the prices [10, 20])
(fail) total > sums every price
```

src/total.ts:

```ts
export function total(prices: number[]): number {
  let sum = 0;
  for (let i = 1; i < prices.length; i++) sum += prices[i];
  return sum;
}
```

Treat the output above as what the command printed (exit code 1).
