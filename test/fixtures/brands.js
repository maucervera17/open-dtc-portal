// Fictional competitor brands used only by the test-suite. Production ships with an empty SEED_BRANDS.
import {SEED_BRANDS} from '../../lib/inspiration/model.js';
export const FIXTURE_BRANDS = [
  {id:'sample', name:'Example Sample', website:'https://sample.example.com/', query:'Example Sample', page_id:'200000000000001'},
  {id:'alpha', name:'Example Alpha', website:'https://alpha.example.com/', query:'Example Alpha', page_id:'200000000000002'},
  {id:'beta', name:'Example Beta', website:'https://beta.example.com/', query:'Example Beta', page_id:'200000000000003'},
  {id:'gamma', name:'Example Gamma', website:'https://gamma.example.com/', query:'Example Gamma', page_id:'200000000000004'},
  {id:'delta', name:'Example Delta', website:'https://delta.example.com/', query:'Example Delta', page_id:'200000000000005'},
  {id:'epsilon', name:'Example Epsilon', website:'https://epsilon.example.com/', query:'Example Epsilon', page_id:'200000000000006'},
];
// node --test runs each file in its own process, so mutating the shared array here is isolated per test file.
if (SEED_BRANDS.length === 0) SEED_BRANDS.push(...FIXTURE_BRANDS);
