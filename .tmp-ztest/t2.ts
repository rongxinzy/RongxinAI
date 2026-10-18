import { z } from 'zod';

const Loose = z.object({ a: z.string().optional() }).passthrough();
type LooseIn = z.input<typeof Loose>;
interface Plain { a?: string }
declare const plain: Plain;
declare function take(x: LooseIn): void;
take(plain); // does this error?

const Strict = z.object({ a: z.string().optional() });
declare function take2(x: z.input<typeof Strict>): void;
take2(plain);

// tuple rest-params type helper
const Tuple = z.tuple([z.string(), Strict.optional()]);
declare function f(...args: z.input<typeof Tuple>): void;
f('a');
f('a', undefined);
f('a', { a: 'b' });
